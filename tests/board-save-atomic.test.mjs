/**
 * Saving a meeting while anything else writes it (QA round 2, Nov 19 2026: race-two-saves.mjs, race-yield.mjs,
 * 25-delete-open.mjs). A save reads the meeting, checks the editor's base and writes: anything written between the read
 * and the write (another tab's save, the agenda email's record, the minutes approved, the numbers locked, a presenter's
 * report) is never written over. The editor is told instead (409, with theirs to merge), and nothing either side was
 * told "saved" is lost. A meeting deleted in one tab never comes back when another tab saves it. Made-up people only.
 * Run: node --test tests/
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import { getMeeting, patchMeeting, saveMeeting, createPractice } from '../functions/api/_board.js';
import { mergeMeeting, cleanMeeting, todayEastern } from '../public/admin/board-shared.js';
import { agendaApproved } from './lib/agenda-approved.mjs';

const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function signIn(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

const FOUNDER = 'jane@soardcharity.com';
const SAM = 'sam.board@example.org';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
];
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let env;
const realFetch = globalThis.fetch;
const RealDate = Date;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  for (const [slug, email] of [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', SAM]]) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  _resetKeyCacheForTests();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const body = JSON.parse(init.body);
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; globalThis.Date = RealDate; });

async function call(email, path, { method = 'GET', body = null, handler }) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' };
  if (body) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => handler(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : await res.text() };
}
const adminApi = (body) => call(FOUNDER, '/api/board-admin', { method: 'POST', body, handler: admin.onRequestPost });
const portalApi = (email, body) => call(email, '/api/board-portal', { method: 'POST', body, handler: portal.onRequestPost });

/**
 * The next write to a meeting's row (`table`), held there until opened: what a D1 round trip does while something else
 * writes. `reached` opens when the held write gets there. Every other statement goes straight through
 */
function holdNextWrite(table = 'board_meetings') {
  const real = env.DB.prepare.bind(env.DB);
  const re = new RegExp(`^\\s*(INSERT OR REPLACE INTO|INSERT OR IGNORE INTO|INSERT INTO|UPDATE) ${table}\\b`);
  let open; const opened = new Promise((r) => { open = r; });
  let hit; const reached = new Promise((r) => { hit = r; });
  let armed = true;
  env.DB.prepare = (sql) => {
    const st = real(sql);
    if (!armed || !re.test(sql)) return st;
    armed = false;
    return { bind: (...p) => { const b = st.bind(...p); return { run: async () => { hit(); await opened; return b.run(); }, first: (...a) => b.first(...a), all: (...a) => b.all(...a) }; } };
  };
  return { reached, open: () => { env.DB.prepare = real; open(); } };
}

/** A meeting ahead with its agenda approved and shared, Sam presenting Financial */
async function meetingAhead() {
  const m = (await adminApi({ action: 'new-meeting', date: inDays(5) })).body.meeting;
  m.sections[0].items.push({ id: 'i_samfin1', title: 'Financial', who: ['sam-ortiz'], presenter: 'Sam Ortiz' });
  await agendaApproved(env.DB, m.id);
  await env.DB.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(JSON.stringify({ sentAt: '2026-11-01T00:00:00Z' }), '2026-11-01T00:00:00Z').run();
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, shared: true }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
const samsItem = (m) => m.sections.flatMap((s) => s.items).find((it) => it.id === 'i_samfin1');

/**
 * An editor's save (the place changed, from `opened`) held at its write while `other` writes the meeting; then the save
 * goes on. → { save: its answer, after: the meeting then }
 */
async function saveWhile(opened, other) {
  const held = holdNextWrite();
  const saving = adminApi({ action: 'save-meeting', meeting: { ...opened, location: 'Room 2' }, base: opened.updatedAt });
  await held.reached;
  const r = await other();
  held.open();
  const save = await saving;
  return { save, other: r, after: await getMeeting(env.DB, opened.id) };
}
/** Nothing anyone was told was saved is gone: a 200 save keeps its place; a 409 hands back theirs to merge */
function savedOrTold(save, after) {
  if (save.status === 200) assert.equal(after.location, 'Room 2', 'a save answered 200 is there');
  else {
    assert.equal(save.status, 409, JSON.stringify(save.body));
    assert.ok(save.body.current, 'the editor gets theirs, to merge');
  }
}

// ─── Never written over ─────────────────────────────────────────────

test('two tabs saving at once: the one that writes second is told to merge, never written over the first', async () => {
  const m = await meetingAhead();
  const { save, other, after } = await saveWhile(m, () => adminApi({ action: 'save-meeting', meeting: { ...m, inviteNote: 'Park on Elm' }, base: m.updatedAt }));
  assert.equal(other.status, 200);
  assert.equal(after.inviteNote, 'Park on Elm', 'tab 2’s save, answered 200, is there');
  assert.equal(save.status, 409, 'tab 1 wrote after tab 2: told, never written over it');
  savedOrTold(save, after);
  // Tab 1 merges (as its editor does) and saves again: both
  const { merged, clashes } = mergeMeeting(cleanMeeting(m), cleanMeeting({ ...m, location: 'Room 2' }), cleanMeeting(save.body.current));
  assert.deepEqual(clashes, []);
  const again = await adminApi({ action: 'save-meeting', meeting: merged, base: save.body.current.updatedAt });
  assert.equal(again.status, 200);
  assert.deepEqual([again.body.meeting.location, again.body.meeting.inviteNote], ['Room 2', 'Park on Elm']);
});

test('the agenda email’s record, the minutes approved, the numbers locked and a presenter’s report, written during a save, all stay', async () => {
  const m = await meetingAhead();
  const writes = {
    'the email’s record': [() => patchMeeting(env.DB, m.id, (cur) => ({ ...cur, packetSentAt: new Date().toISOString(), packetSentTo: 2 })), (x) => !!x.packetSentAt && x.packetSentTo === 2],
    'the minutes approved': [() => adminApi({ action: 'approve-minutes', id: m.id }), (x) => x.minutes === 'approved'],
    'the numbers locked': [() => patchMeeting(env.DB, m.id, (cur) => ({ ...cur, snapshot: { at: new Date().toISOString(), meetings: [], thisYear: [] } })), (x) => !!x.snapshot?.at],
    'Sam’s report': [() => portalApi(SAM, { action: 'report', meetingId: m.id, itemId: 'i_samfin1', text: 'Cash is steady.', base: '' }), (x) => samsItem(x).report === 'Cash is steady.'],
  };
  for (const [what, [write, kept]] of Object.entries(writes)) {
    // (each from the meeting as it is now, the minutes held first so approving them is allowed)
    await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, date: inDays(-1), minutes: 'draft', approvedOn: '', minutesFrom: { name: 'Minutes.pdf', at: new Date().toISOString() }, location: '' }));
    const opened = await getMeeting(env.DB, m.id);
    const { save, other, after } = await saveWhile(opened, write);
    assert.ok(!other || other.status === undefined || other.status === 200, `${what}: ${JSON.stringify(other?.body)}`);
    assert.ok(kept(after), `${what} is there after the save`);
    savedOrTold(save, after);
  }
});

test('a write in the same millisecond as the last one still has a time of its own, so an editor holding the last one is told', async () => {
  const m = await meetingAhead();
  // The clock stands still (every new Date() and Date.now() the same millisecond), as two writes close together can
  const frozen = RealDate.now();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [frozen])); } static now() { return frozen; } };
  const saved = (await adminApi({ action: 'save-meeting', meeting: { ...m, title: 'Fall board meeting' }, base: m.updatedAt })).body.meeting;
  const sent = await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, packetSentAt: new Date(frozen).toISOString(), packetSentTo: 2 }));
  assert.ok(sent.updatedAt > saved.updatedAt, 'the email’s record has its own, later time');
  // The editor (its last save is what it has) saves again: told, never written over the email's record
  const r = await adminApi({ action: 'save-meeting', meeting: { ...saved, location: 'Room 3' }, base: saved.updatedAt });
  assert.equal(r.status, 409);
  assert.ok((await getMeeting(env.DB, m.id)).packetSentAt);
});

test('a save with no base (the server’s own) is made again from what’s there, never over a write in between', async () => {
  const m = await meetingAhead();
  const held = holdNextWrite();
  const saving = saveMeeting(env.DB, { ...m, location: 'Room 4' }, { by: FOUNDER });
  await held.reached;
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, packetSentAt: new Date().toISOString(), packetSentTo: 2 }));
  held.open();
  const out = await saving;
  assert.deepEqual([out.location, !!out.packetSentAt], ['Room 4', true]);
});

test('a practice meeting saved from two places at once: the second is told, never written over the first', async () => {
  const p = await createPractice(env, { by: FOUNDER });
  const held = holdNextWrite('board_practice');
  const one = adminApi({ action: 'save-meeting', meeting: { ...p, title: 'Practice, tab one' }, base: p.updatedAt });
  await held.reached;
  const two = await adminApi({ action: 'save-meeting', meeting: { ...p, location: 'Practice room' }, base: p.updatedAt });
  held.open();
  const first = await one;
  assert.equal(two.status, 200);
  assert.equal(first.status, 409);
  const rows = (await env.DB.prepare('SELECT data FROM board_practice WHERE id = ?').bind(p.id).all()).results;
  assert.equal(JSON.parse(rows[0].data).location, 'Practice room', 'the save answered 200 is there');
});

// ─── Deleted in another tab ─────────────────────────────────────────

test('a meeting deleted in one tab never comes back when another tab saves it: the save is refused in words', async () => {
  const m = await meetingAhead();
  assert.equal((await adminApi({ action: 'delete-meeting', id: m.id })).status, 200);
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, title: 'Typed in B after A deleted' }, base: m.updatedAt });
  assert.equal(r.status, 404);
  assert.equal(r.body.gone, true);
  assert.equal(r.body.error, 'This meeting was deleted, maybe in another tab. Nothing here was saved, and it stays deleted.');
  assert.equal(await getMeeting(env.DB, m.id), null, 'not made again');
  // The same when the stale tab was sharing it (its agenda never approved): told it was deleted, never about the approval
  const quiet = (await adminApi({ action: 'new-meeting', date: inDays(9) })).body.meeting;
  await adminApi({ action: 'delete-meeting', id: quiet.id });
  const sharing = await adminApi({ action: 'save-meeting', meeting: { ...quiet, shared: true }, base: quiet.updatedAt });
  assert.deepEqual([sharing.status, sharing.body.gone], [404, true], JSON.stringify(sharing.body));
  // Deleted while the save was on its way (between its read and its write): the same
  const n = await meetingAhead();
  const held = holdNextWrite();
  const saving = adminApi({ action: 'save-meeting', meeting: { ...n, title: 'Typed as it went' }, base: n.updatedAt });
  await held.reached;
  await env.DB.prepare('DELETE FROM board_meetings WHERE id = ?').bind(n.id).run();
  held.open();
  const late = await saving;
  assert.equal(late.status, 404);
  assert.equal(late.body.gone, true);
  assert.equal(await getMeeting(env.DB, n.id), null);
});
