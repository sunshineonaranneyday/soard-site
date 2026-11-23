/**
 * What a board member can reach on the board page, and what it tells them: the chair approves only the agenda their
 * review shows them; the board's lists of meetings hold only board meetings on the board page; who presents in a
 * meeting not shared yet gets its name, day, time and place and their own items, nothing else; anything a member
 * can't see answers as not there (never "someone else's"); what's new since their last visit stays so for the whole
 * visit, on every device; and other staff are told truly who Board is for.
 * QA, Nov 19 2026 (chair-approve-draft.mjs, member-probe.mjs, presenting.mjs, page-next-meetings.mjs). Made-up people only.
 * Run: node --test tests/
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import { saveMeeting, getMeeting, patchMeeting, saveDoc, ensureSchema } from '../functions/api/_board.js';
import { todayEastern } from '../public/admin/board-shared.js';
import { writeState } from '../functions/api/_board-roles.js';
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
const STAFF = 'pat@soardcharity.com';
const ALEX = 'alex.board@example.com'; // the chair
const SAM = 'sam.board@example.org';
const MARIA = 'maria.board@example.com';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['pat-lee', { name: 'Pat Lee', group: 'team', title: 'Program Director' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['maria-ruiz', { name: 'Maria Ruiz', group: 'board', title: 'Board Member' }],
];
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TYPED = { kind: 'typed', name: '', at: '' };

let env;
let resendCalls;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  for (const [slug, email] of [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['maria-ruiz', MARIA]]) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  resendCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) { resendCalls += 1; const b = JSON.parse(init.body); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call(email, path, { method = 'GET', body = null, handler }) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' };
  if (body) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => handler(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : await res.text() };
}
const page = (email) => call(email, '/api/board-portal', { handler: portal.onRequestGet });
const post = (email, body) => call(email, '/api/board-portal', { method: 'POST', body, handler: portal.onRequestPost });
const adminGet = (email) => call(email, '/api/board-admin', { handler: admin.onRequestGet });

/** A board meeting (saved as Board saves one) */
const meeting = (id, days, more = {}) => saveMeeting(env.DB, {
  id, date: inDays(days), start: '08:00', end: '10:00', location: 'Example Hall', agendaFrom: TYPED,
  sections: [{ id: `s_${id.slice(2)}`, title: 'Committee reports', items: [
    { id: `i_${id.slice(2)}fin`, title: 'Financial', who: ['sam-ortiz'], presenter: 'Sam Ortiz' },
    { id: `i_${id.slice(2)}eve`, title: 'Events', who: ['maria-ruiz'], presenter: 'Maria Ruiz' },
  ] }],
  ...more,
}, { by: FOUNDER });

// ─── The chair ──────────────────────────────────────────────────────

test('the chair approves only the agenda their review shows them: never a meeting further ahead, nor a draft', async () => {
  await writeState(env.DB, 'settings', { asks: 'on' });
  await env.DB.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(JSON.stringify({ sentAt: '2026-11-01T00:00:00Z' }), '2026-11-01T00:00:00Z').run();
  const near = await meeting('m_near001', 5);
  const far = await meeting('m_far0001', 120);
  // The review offers the near one only
  assert.equal((await page(ALEX)).body.review?.meeting?.id, near.id);
  for (const action of [{ action: 'chair-approve' }, { action: 'chair-note', itemId: 'i_far0001fin', text: 'A note' }, { action: 'ask-presenter', itemId: 'i_far0001fin', question: 'Why?' }]) {
    const r = await post(ALEX, { ...action, meetingId: far.id });
    assert.equal(r.status, 404, `${action.action}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'That agenda isn’t up for your review');
  }
  const after = await getMeeting(env.DB, far.id);
  assert.equal(after.shared, false, 'not shared');
  assert.equal(after.packetSentAt, '', 'not emailed');
  assert.equal(resendCalls, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM board_asks WHERE kind = 'chair'").first()).n, 0, 'nothing kept as approved');
  // A meeting that doesn't exist answers the same
  assert.equal((await post(ALEX, { action: 'chair-approve', meetingId: 'm_nothere1' })).body.error, 'That agenda isn’t up for your review');
  // The next meeting with a draft agenda (the template's) isn't up for review either
  await patchMeeting(env.DB, near.id, (cur) => ({ ...cur, agendaFrom: { kind: 'template', name: '', at: '' } }));
  assert.equal((await post(ALEX, { action: 'chair-approve', meetingId: near.id })).status, 404);
  // Board's own Approve still reaches any meeting ahead
  const r = await call(FOUNDER, '/api/board-admin', { method: 'POST', body: { action: 'approve-agenda', id: far.id }, handler: admin.onRequestPost });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

// ─── Lists of meetings ──────────────────────────────────────────────

test('the board’s lists of meetings hold only board meetings on the board page, in the numbers and in a locked packet', async () => {
  const shared = await meeting('m_shar001', 5, { shared: true });
  await agendaApproved(env.DB, shared.id);
  await meeting('m_coff001', 8, { title: 'Coffee with a major donor', notBoard: true });
  const invited = await meeting('m_invi001', 12);
  await patchMeeting(env.DB, invited.id, (cur) => ({ ...cur, invite: { eventId: 'ev_invited1', sentAt: new Date().toISOString() } }));
  await meeting('m_quie001', 15, { title: 'Not on anyone’s calendar yet' });
  // A packet locked before this rule, naming them all
  const old = [{ id: 'm_coff001', name: 'Coffee with a major donor', date: inDays(8) }, { id: 'm_invi001', name: 'Q1', date: inDays(12) }, { id: 'm_quie001', name: 'Not on anyone’s calendar yet', date: inDays(15) }];
  await patchMeeting(env.DB, shared.id, (cur) => ({ ...cur, snapshot: { at: new Date().toISOString(), meetings: old, thisYear: old } }));

  const r = await page(MARIA);
  assert.equal(r.status, 200);
  const ids = (list) => (list || []).map((x) => x.id);
  assert.deepEqual(ids(r.body.numbers.meetings), [shared.id, invited.id], 'shared, or on their calendars; never the coffee or one not on their calendars');
  for (const id of ids(r.body.numbers.thisYear)) assert.ok([shared.id, invited.id].includes(id), id);
  const snap = r.body.meetings.find((x) => x.id === shared.id).snapshot;
  assert.deepEqual(ids(snap.meetings), [invited.id]);
  assert.deepEqual(ids(snap.thisYear), [invited.id]);
  assert.doesNotMatch(JSON.stringify(r.body), /Coffee with a major donor|Not on anyone’s calendar yet/);
  // The screen as it's held says the same
  const live = await call(MARIA, `/api/board-portal?live=${shared.id}`, { handler: portal.onRequestGet });
  assert.deepEqual(ids(live.body.snapshot.meetings), [invited.id]);
});

// ─── A meeting not shared yet ───────────────────────────────────────

test('who presents in a meeting not shared yet gets its name, day, time and place and their own items, nothing else', async () => {
  const m = await meeting('m_pres001', 5, {
    inviteNote: 'SECRET-NOTE gate code 1234', video: 'https://meet.google.com/abc-defg-hij',
    attendance: [{ slug: 'alex-rivera', name: 'Alex Rivera', kind: 'board', status: 'present' }, { name: 'SECRET-GUEST Donor', kind: 'guest' }],
    motions: [{ id: 'v_secret01', text: 'SECRET-MOTION to buy a building' }],
    actions: [{ id: 'a_secret01', text: 'SECRET-ACTION call the bank', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }],
  });
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, snapshot: { at: new Date().toISOString(), cash: { total: 999999 } }, invite: { eventId: 'ev_pres0001', sentAt: new Date().toISOString(), meet: 'https://meet.google.com/abc-defg-hij' } }));
  const r = await page(MARIA);
  const p = r.body.presenting.find((x) => x.id === m.id);
  assert.ok(p, 'she presents in it');
  assert.deepEqual([p.date, p.start, p.end, p.location, p.presenting, p.shared], [m.date, '08:00', '10:00', 'Example Hall', true, false]);
  assert.ok(p.title);
  assert.deepEqual(p.sections.flatMap((s) => s.items.map((it) => it.title)), ['Events'], 'her item only');
  assert.deepEqual([p.motions, p.actions, p.attendance, p.inviteNote, p.snapshot, p.video, p.invite], [[], [], [], '', null, '', null]);
  assert.doesNotMatch(JSON.stringify(p), /SECRET-|999999|abc-defg-hij/);
  // (its Meet link is on the page only as the invite on their calendar already gives it: the next meeting's day, time and place)
  assert.doesNotMatch(JSON.stringify(r.body), /SECRET-|999999/);
});

// ─── Not there ──────────────────────────────────────────────────────

test('anything a member can’t see answers as not there, never as someone else’s', async () => {
  // A meeting far ahead, not shared: nobody on the board sees it yet, not even who presents in it
  await meeting('m_hide001', 60, { actions: [{ id: 'a_hidesam', text: 'Hidden task', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }] });
  const notThere = async (email, body) => {
    const r = await post(email, body);
    assert.equal(r.status, 404, `${email} ${body.action}: ${JSON.stringify(r.body)}`);
  };
  await notThere(ALEX, { action: 'action-done', actionId: 'a_hidesam', done: true });
  await notThere(SAM, { action: 'action-done', actionId: 'a_hidesam', done: true });
  await notThere(ALEX, { action: 'report', meetingId: 'm_hide001', itemId: 'i_hide001fin', text: 'x', base: '' });
  await notThere(SAM, { action: 'report', meetingId: 'm_hide001', itemId: 'i_hide001fin', text: 'x', base: '' });
  await notThere(ALEX, { action: 'motion', meetingId: 'm_hide001', itemId: 'i_hide001fin', text: 'x' });
  await notThere(ALEX, { action: 'line-note', meetingId: 'm_hide001', itemId: 'i_hide001fin', key: 'act|Income', text: 'x' });
  await notThere(ALEX, { action: 'slide-order', meetingId: 'm_hide001', itemId: 'i_hide001fin', order: [] });
  // In the presenting window, the items she doesn't present aren't there for Maria; hers is
  await meeting('m_soon001', 5);
  await notThere(MARIA, { action: 'report', meetingId: 'm_soon001', itemId: 'i_soon001fin', text: 'x', base: '' });
  await notThere(MARIA, { action: 'line-note', meetingId: 'm_soon001', itemId: 'i_soon001fin', key: 'act|Income', text: 'x' });
  assert.equal((await post(MARIA, { action: 'report', meetingId: 'm_soon001', itemId: 'i_soon001eve', text: 'Gala is set', base: '' })).status, 200);
  // A paper not on the board page, or none at all: the same answer
  const hidden = await saveDoc(env.DB, { title: 'Hidden policy', body: 'Words', sign: true, shared: false }, { by: FOUNDER });
  await notThere(ALEX, { action: 'opened', docId: hidden.id });
  await notThere(ALEX, { action: 'opened', docId: 'd_nothere1' });
  // A staff-only file on his own item isn't there to take off
  const shared = await meeting('m_shar002', 5, { shared: true });
  await agendaApproved(env.DB, shared.id);
  await env.DB.prepare("INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by) VALUES ('f_staff001', 'meeting', ?, 'k', 'Draft.pdf', 'application/pdf', 10, 'other', 1, ?, ?)").bind(shared.id, new Date().toISOString(), FOUNDER).run();
  await patchMeeting(env.DB, shared.id, (cur) => ({ ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_shar002fin' ? { ...it, docs: ['f_staff001'] } : it)) })) }));
  await notThere(SAM, { action: 'detach', meetingId: shared.id, itemId: 'i_shar002fin', fileId: 'f_staff001' });
  // What they can see still says whose it is
  const theirs = await post(ALEX, { action: 'report', meetingId: shared.id, itemId: 'i_shar002fin', text: 'x', base: '' });
  assert.equal(theirs.status, 403);
});

// ─── New since the last visit ───────────────────────────────────────

test('what’s new since the last visit stays new for the whole visit, on every reload, tab and device', async () => {
  const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind('alex-rivera', threeDays).run();
  const phone = await page(ALEX);
  assert.equal(phone.body.me.lastSeen, threeDays, 'the visit before this one');
  // A reload, another tab, the laptop: minutes later, the same visit
  for (let i = 0; i < 3; i++) assert.equal((await page(ALEX)).body.me.lastSeen, threeDays);
  // Board → Members: when they were last on the page (this visit)
  const visit = (await env.DB.prepare('SELECT at FROM board_seen WHERE slug = ?').bind('alex-rivera').first()).at;
  assert.ok(visit > threeDays);
  assert.equal((await adminGet(FOUNDER)).body.members.find((p) => p.slug === 'alex-rivera').lastSeen, visit);
  // Over thirty minutes with no look, the next visit: new since this one began
  // (QA round 2: a visit is counted from its last look, not its first, so this visit's last look goes back too; round 3:
  // thirty minutes, one rule with Board → Members' sittings, board-shared.js VISIT_GAP_MS)
  const earlier = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  await env.DB.prepare('UPDATE board_seen SET at = ?, last = ? WHERE slug = ?').bind(earlier, new Date(Date.now() - 31 * 60 * 1000).toISOString(), 'alex-rivera').run();
  assert.equal((await page(ALEX)).body.me.lastSeen, earlier);
  assert.equal((await page(ALEX)).body.me.lastSeen, earlier);
  // The first visit ever: nothing to call new
  assert.equal((await page(SAM)).body.me.lastSeen, null);
});

// ─── Other staff ────────────────────────────────────────────────────

test('other staff are told who Board is for, as it is now (there’s no Settings tab)', async () => {
  const r = await adminGet(STAFF);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'The Board area is open only to the staff who run Board');
  assert.doesNotMatch(r.body.error, /Settings/);
});
