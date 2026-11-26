/**
 * Board QA round 15 (Nov 26 2026), the admin tester's finding 1 (major): approved typed minutes changed with a plain save
 * of Board's agenda editor. "Budget passed at forty thousand." made "fifty", a decision's result and who was there
 * changed by the same save: 200, "Saved", the board page showed the change, and their approved Word file ("The minutes as
 * written") still said what the board approved.
 *   S1  What approved minutes state can't change while they're approved, by any route: their words (under each part and
 *       item, and the vote an item asks for), their decisions, the roll and guests, and the meeting's name, day, time and
 *       place. Approved each way (Board's Approve, Mark them approved, the secretary's approving send), a save of each,
 *       alone and with an unrelated change (a to-do, the board page, a document on an item), is refused (409) in the
 *       decided words with nothing changed, the whole save, and the approved file's bytes and id the same. Marked as draft,
 *       the same save lands
 *   S2  The sweep: the save on approved minutes, cleanly, then with each statement failing once in turn, then each write
 *       landing with its answer lost: refused or saved in true words, never a change to what they state
 *   S3  The rule is one, for every write of a meeting (functions/api/_board.js keepStated): the server's own steps
 *       (patchMeeting, patchTogether), setOnMeeting kept to what minutes never state, the Meet heartbeat keeping who
 *       joined beside the approved roll, a rename on People moving an address on them; what they don't state (a report,
 *       the invite's notes, a to-do) still saves. The rule itself (board-shared.js minutesStated, minutesStay) and what the
 *       editor puts back when it's refused (withStated, typedOver)
 * The words are written out, so a run on the code before fails on what it says, never on an import.
 * Made-up people only (the repo is public). Run: node --test tests/board-round15-approved.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as portal from '../functions/api/board-portal.js';
import * as admin from '../functions/api/board-admin.js';
import * as boardFile from '../functions/api/board-file.js';
import * as board from '../functions/api/_board.js';
import { saveNotes } from '../functions/api/_board-notes.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import { moveBoardSlug } from '../functions/api/_board-rename.js';
import { maybeFillAttendance } from '../functions/api/_board-attendance.js';
import * as shared from '../public/admin/board-shared.js';

const { cleanMeeting, todayEastern, minutesFileOf, docxText } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const KIM = 'kim.board@example.com';
// The words decided
const STAY = 'These minutes are approved, so they can’t change here. Mark them as draft first to change them.';
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
const SETUP_DOWN = 'The site couldn’t open the board’s records just now. Please try again in a moment.';
const NOTHING = /nothing was (sent|changed)/i;
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
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', seat: 'chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['kim-park', KIM]];
const TAYLOR_W = { member: { slug: 'taylor-nguyen', name: 'Taylor Nguyen', email: TAYLOR, seat: 'secretary' }, admin: false };

// ─── The database not answering, once ───────────────────────────────
// `fail`: the k-th statement the press makes (one in a batch too, which then fails whole, as D1's does) fails before it
// runs. `lose`: the k-th write (a write statement, or a batch) lands, and its answer is lost on the way back
let raw;
let fault = null; // { mode, k, seen, failed }
const isWrite = (sql) => !/^\s*SELECT\b/i.test(String(sql || ''));
function hit(sql, write) {
  if (!fault || (fault.mode === 'lose' && !write)) return false;
  const i = fault.seen++;
  if (i !== fault.k) return false;
  fault.failed.push(`${fault.mode === 'lose' ? 'lost: ' : ''}${String(sql)}`);
  return true;
}
const LOST = () => new Error('D1_ERROR: Network connection lost.');
const wrap = (st) => new Proxy(st, {
  get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => {
    if (fault?.mode !== 'lose') { if (hit(s._sql, isWrite(s._sql))) throw LOST(); return s[m](...a); }
    const out = await s[m](...a);
    if (hit(s._sql, isWrite(s._sql))) throw LOST();
    return out;
  } : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
});
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => {
      if (fault?.mode !== 'lose') { for (const s of stmts) if (hit(s._sql, isWrite(s._sql))) throw LOST(); return raw.batch(stmts); }
      const out = await raw.batch(stmts);
      if (hit(`batch: ${stmts[0]?._sql}`, true)) throw LOST();
      return out;
    }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});

let env;
const files = new Map();
let later = [];
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
  raw = await createD1();
  files.clear();
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test',
    FILES: {
      get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length, httpMetadata: {} } : null),
      put: async (k, v) => { files.set(k, new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : v instanceof Uint8Array ? v : await new Response(v).arrayBuffer())); },
      delete: async (k) => { files.delete(k); },
    },
  };
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  ]) await raw.exec(sql);
  for (const [slug, d] of PEOPLE) await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
  for (const [slug, email] of EMAILS) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await board.ensureSchema(env.DB);
  await stateReady(env.DB);
  await ensureAsks(env.DB);
  _resetKeyCacheForTests();
  later = [];
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) return Response.json({ id: 'em_1' });
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

/** A route behind the real sign-in middleware, as `who`; what it left running is finished before it answers here */
async function route(handler, path, who, { method = 'GET', body = null, bytes = false } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = { request, env, data: {}, waitUntil: (p) => { later.push(p); } };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
  if (bytes) { const b = new Uint8Array(await res.arrayBuffer()); await Promise.allSettled(later.splice(0)); return { status: res.status, bytes: b }; }
  const text = await res.text();
  await Promise.allSettled(later.splice(0));
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}
const onPortal = (who, body) => route(portal, '/api/board-portal', who, { method: 'POST', body });
const onAdmin = (body) => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body });
const sql = async (q, ...b) => (await raw.prepare(q).bind(...b).all()).results || [];
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''}`.trim();
const sha = (bytes) => (bytes ? createHash('sha256').update(bytes).digest('hex') : '');
const saveState = () => ({ bytes: raw._db.export(), files: new Map(files) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  later = [];
}

// ─── The meetings ───────────────────────────────────────────────────
//
// The last meeting (whose minutes the held one's agenda votes on), and the held one (yesterday, on Google Meet), whose
// minutes Taylor typed and sent: everyone there, a guest, "forty thousand" under the budget and its vote passed

const V1 = 'Budget passed at forty thousand.';
const V2 = 'Budget passed at fifty thousand.';
const ASKS = 'Move to approve the 2027 budget as presented.';
/** The decision the secretary recorded on the budget's vote */
const DECISION = 'vn_i_budget';
const item = (m, id) => (m?.sections || []).flatMap((s) => s.items).find((it) => it.id === id);
const onItem = (m, id, patch) => ({ ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })) });

async function heldSent() {
  await board.saveSettings(env.DB, { quorum: 3 }, FOUNDER);
  const prev = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-90), start: '08:00', end: '10:00', shared: true, title: 'Summer Board Meeting', attendance: [], sections: [{ id: 's_p1', title: 'Finance', items: [{ id: 'i_pfin', title: 'Year to date' }] }] }), { by: 'test' });
  const held = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), start: '08:00', end: '10:00', shared: true, location: 'Example Hall', address: '1 Example Way, Atlanta',
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [
      { id: 's_open', title: 'Call to order', items: [{ id: 'i_prev', title: 'Approve the last meeting’s minutes', live: 'minutes', about: prev.id }] },
      { id: 's_fin', title: 'Finance', items: [{ id: 'i_ytd', title: 'Year to date' }, { id: 'i_budget', title: 'The 2027 budget', motion: ASKS }] },
    ],
  }), { by: 'test' });
  // (an ordinary file of the meeting, for a save that puts it on an item)
  const map = await board.putFile(env, { ownerType: 'meeting', ownerId: held.id, file: new File([new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')], 'Parking-map.pdf', { type: 'application/pdf' }), kind: 'other', by: FOUNDER });
  await saveNotes(env, held.id, { changes: {
    'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'r:kim-park': 'present', guests: 'Dana Smith',
    'n:i_budget': V1, 'm:i_budget': { text: 'Approve the 2027 budget', by: 'Sam Ortiz', second: 'Alex Rivera', result: 'passed' },
    'm:i_prev': { by: 'Alex Rivera', second: 'Sam Ortiz', result: 'tabled' },
  } }, TAYLOR_W);
  const sent = await onPortal(TAYLOR, { action: 'notes-send', meetingId: held.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const now = await board.getMeeting(env.DB, held.id);
  const file = now.files.find((f) => f.kind === 'minutes');
  assert.ok(file, 'the send kept a Word file');
  assert.equal(item(now, 'i_budget').notes, V1);
  // (the vote's words are the ones the item asks for)
  assert.deepEqual(now.motions.filter((x) => x.id === DECISION).map((x) => [x.text, x.result]), [[ASKS, 'passed']]);
  assert.ok(now.attendance.some((p) => p.kind === 'guest' && p.name === 'Dana Smith' && p.status === 'present'), 'the guest is on the roll');
  return { prev, held: now, fileId: file.id, mapId: map.id };
}
const approver = (held) => board.saveMeeting(env.DB, cleanMeeting({ date: inDays(0), start: '07:00', end: '07:30', shared: true, attendance: [], sections: [{ id: 's_n1', title: 'Call to order', items: [{ id: 'i_nmin', title: 'Approve the last meeting’s minutes', live: 'minutes', about: held.id }] }] }), { by: 'test' });
const APPROVE_ROUTES = {
  'Board’s Approve': async ({ held }) => onAdmin({ action: 'approve-minutes', id: held.id, on: inDays(0) }),
  'Mark them approved': async ({ held }) => { const m = await board.getMeeting(env.DB, held.id); return onAdmin({ action: 'save-meeting', meeting: { ...m, minutes: 'approved', approvedOn: inDays(0) }, base: m.updatedAt }); },
  'the secretary’s approving send': async ({ held }) => {
    const next = await approver(held);
    await saveNotes(env, next.id, { changes: { 'r:alex-rivera': 'present', 'm:i_nmin': { by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' } } }, TAYLOR_W);
    return onPortal(TAYLOR, { action: 'notes-send', meetingId: next.id });
  },
};
async function heldApproved(how) {
  const ms = await heldSent();
  const r = await APPROVE_ROUTES[how](ms);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = await board.getMeeting(env.DB, ms.held.id);
  assert.equal(m.minutes, 'approved');
  assert.equal(m.approvedFile, ms.fileId, 'approved as the Word file the send kept');
  return { ...ms, held: m };
}

/** Each thing approved minutes state, changed on a copy of the meeting as Board's editor would send it */
const CHANGES = {
  'the words under an item': (m) => onItem(m, 'i_budget', { notes: V2 }),
  'the vote an item asks for': (m) => onItem(m, 'i_budget', { motion: 'Move to approve the 2027 budget at fifty thousand.' }),
  'a decision’s result': (m) => ({ ...m, motions: m.motions.map((x) => (x.id === DECISION ? { ...x, result: 'failed' } : x)) }),
  'who moved a decision': (m) => ({ ...m, motions: m.motions.map((x) => (x.id === DECISION ? { ...x, by: 'Kim Park' } : x)) }),
  'the roll (Kim there, then not)': (m) => ({ ...m, attendance: m.attendance.map((p) => (p.slug === 'kim-park' ? { ...p, status: 'absent' } : p)) }),
  'a guest added': (m) => ({ ...m, attendance: [...m.attendance, { name: 'Pat Lee', kind: 'guest', status: 'present' }] }),
  'the name': (m) => ({ ...m, title: 'Q4 Board Meeting, held at the office' }),
  'the day': (m) => ({ ...m, date: inDays(-2) }),
  'the time': (m) => ({ ...m, start: '08:30' }),
  'the place': (m) => ({ ...m, location: 'Example Hall, Room 2' }),
};
/** An unrelated change with it: a to-do, the board page, a document on an item (or none) */
const MIXES = {
  alone: (m) => m,
  'with a to-do': (m) => ({ ...m, actions: [...m.actions, { id: 'a_r15todo', text: 'Send the budget to the bank', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(14) }] }),
  'with the board page': (m) => ({ ...m, shared: false }),
  'with a document on an item': (m, ms) => onItem(m, 'i_ytd', { docs: [ms.mapId] }),
};
/** Everything the site keeps of the meeting and its files, to tell "nothing changed" */
async function kept(id) {
  const row = (await sql('SELECT data, updated_at FROM board_meetings WHERE id = ?', id))[0];
  const rows = await sql('SELECT id, name, kind, staff_only, r2_key, sha256 FROM board_files WHERE owner_id = ? ORDER BY id', id);
  return { row, rows, notes: (await sql('SELECT data, sent FROM board_minutes_notes WHERE meeting_id = ?', id))[0] || null };
}
/** The approved Word file: its id, its bytes' sha, what it says, and what Alex's board page opens as the minutes */
async function approvedFile(id) {
  const m = JSON.parse((await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0].data);
  const f = (await sql('SELECT id, r2_key, sha256 FROM board_files WHERE id = ?', m.approvedFile || ''))[0] || null;
  const bytes = f && files.has(f.r2_key) ? files.get(f.r2_key) : null;
  const text = bytes ? await docxText(bytes).catch(() => '') : '';
  const page = (await route(portal, '/api/board-portal', ALEX)).body?.meetings?.find((x) => x.id === id) || null;
  return { id: f?.id || '', sha: sha(bytes), rowSha: f?.sha256 || '', words: text.includes(V2) ? V2 : text.includes(V1) ? V1 : '', opens: page ? minutesFileOf(page)?.id || '' : '' };
}
/**
 * What minutes say, as this test reads them (its own reading, never the site's rule, so a run on the code before fails
 * on what it does): the name, day, time and place, who was there and how, the words and vote under each part and item,
 * and the decisions
 */
const statedOf = (m) => {
  const c = cleanMeeting(m || {});
  return JSON.stringify({
    name: shared.meetingName(c), date: c.date, start: c.start, end: c.end, place: [c.location, c.address],
    roll: c.attendance.map((p) => JSON.stringify([p.kind, p.name, p.status])).sort(),
    words: c.sections.flatMap((s) => [[s.id, s.notes, ''], ...s.items.map((it) => [it.id, it.notes, it.motion || ''])]).filter((x) => x[1] || x[2]).sort((a, b) => a[0].localeCompare(b[0])),
    decisions: c.motions.map((x) => [x.text, x.by, x.second, x.result]),
  });
};
/** What Alex's board page reads of the minutes */
async function boardReads(id) {
  const page = (await route(portal, '/api/board-portal', ALEX)).body?.meetings?.find((x) => x.id === id) || null;
  return page ? statedOf(page) : '';
}

// ─── S1: approved minutes state what they stated, by any route ───────

for (const how of Object.keys(APPROVE_ROUTES)) {
  test(`S1: approved by ${how}: a save of each thing the minutes state, alone and with a to-do, the board page or a document, is refused in the decided words with nothing changed and the approved file the same; marked as draft, the same save lands`, async () => {
    const ms = await heldApproved(how);
    const id = ms.held.id;
    const was = await kept(id);
    const file = await approvedFile(id);
    assert.deepEqual([file.id, file.words, file.opens, !!file.sha && file.sha === file.rowSha], [ms.fileId, V1, ms.fileId, true], 'approved as the file that says forty');
    const reads = await boardReads(id);
    const wrong = [];
    for (const [what, change] of Object.entries(CHANGES)) {
      for (const [mix, also] of Object.entries(MIXES)) {
        const m = await board.getMeeting(env.DB, id);
        const r = await onAdmin({ action: 'save-meeting', meeting: also(change(m), ms), base: m.updatedAt });
        if (r.status !== 409 || said(r) !== STAY || r.body?.ok !== false) wrong.push(`${what} ${mix}: ${r.status} “${said(r)}”`);
        else if (JSON.stringify(r.body.refused) !== JSON.stringify(['stated'])) wrong.push(`${what} ${mix}: refused ${JSON.stringify(r.body.refused)}`);
        if (JSON.stringify(await kept(id)) !== JSON.stringify(was)) wrong.push(`${what} ${mix}: something changed`);
      }
    }
    assert.deepEqual(wrong, []);
    assert.deepEqual(await approvedFile(id), file, 'the approved file’s id, bytes and words, and what the board page opens, as approved');
    assert.equal(await boardReads(id), reads, 'the board page reads the minutes as approved');
    // Marked as draft (After the meeting's Mark as draft): the same save lands, each change and its to-do
    const before = saveState();
    const landed = [];
    for (const [what, change] of Object.entries(CHANGES)) {
      await restore(before);
      let m = await board.getMeeting(env.DB, id);
      const back = await onAdmin({ action: 'save-meeting', meeting: { ...m, minutes: 'draft', approvedOn: '' }, base: m.updatedAt });
      assert.equal(back.status, 200, JSON.stringify(back.body));
      m = await board.getMeeting(env.DB, id);
      const mine = MIXES['with a to-do'](change(m), ms);
      const r = await onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt });
      const now = await board.getMeeting(env.DB, id);
      const ok = r.status === 200 && statedOf(now) === statedOf(mine) && statedOf(now) !== statedOf(ms.held) && now.actions.some((a) => a.id === 'a_r15todo') && now.minutes === 'draft';
      if (!ok) landed.push(`${what}: ${r.status} “${said(r)}”`);
    }
    assert.deepEqual(landed, [], 'as draft, each save lands');
  });
}

test('S1: the tester’s three saves (the words, a decision’s result, the roll) after Board’s Approve, as their script sent them: refused, the board page and the approved file still agree, the heartbeat after changes nothing', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const file = await approvedFile(id);
  const reads = await boardReads(id);
  for (const fn of [(x) => onItem(x, 'i_budget', { notes: V2 }), (x) => ({ ...x, motions: x.motions.map((mo) => ({ ...mo, result: 'failed' })) }), (x) => ({ ...x, attendance: x.attendance.map((p) => (p.slug === 'kim-park' ? { ...p, status: 'absent' } : p)) })]) {
    const m = await board.getMeeting(env.DB, id);
    const r = await onAdmin({ action: 'save-meeting', meeting: fn(JSON.parse(JSON.stringify(m))), base: m.updatedAt });
    assert.deepEqual([r.status, said(r)], [409, STAY]);
  }
  await board.maybeRunBoard(env).catch(() => {});
  assert.equal(await boardReads(id), reads);
  assert.deepEqual(await approvedFile(id), file);
  const m = await board.getMeeting(env.DB, id);
  assert.deepEqual([item(m, 'i_budget').notes, m.motions.find((x) => x.id === DECISION).result, m.attendance.find((p) => p.slug === 'kim-park').status], [V1, 'passed', 'present']);
});

test('S1: what approved minutes don’t state still saves: a to-do, the board page, a document on an item, the invite’s notes, a report, who presents, an item’s name, the order of the agenda', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const file = await approvedFile(id);
  const reads = await boardReads(id);
  let m = await board.getMeeting(env.DB, id);
  const mine = {
    ...MIXES['with a document on an item'](MIXES['with a to-do'](m), ms),
    inviteNote: 'Parking behind the building',
    sections: [...m.sections].reverse().map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_ytd' ? { ...it, title: 'Year to date, through October', report: 'Revenue is ahead of the plan.', who: ['sam-ortiz'], docs: [ms.mapId] } : it)) })),
  };
  const r = await onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  m = await board.getMeeting(env.DB, id);
  assert.deepEqual([m.inviteNote, item(m, 'i_ytd').title, item(m, 'i_ytd').report, m.actions.some((a) => a.id === 'a_r15todo'), m.sections[0].id], ['Parking behind the building', 'Year to date, through October', 'Revenue is ahead of the plan.', true, 's_fin']);
  const off = await onAdmin({ action: 'save-meeting', meeting: { ...m, shared: false }, base: m.updatedAt });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.meeting.shared, false);
  assert.equal(statedOf(off.body.meeting), statedOf(ms.held), 'what the minutes state is as approved');
  const back = await onAdmin({ action: 'save-meeting', meeting: { ...off.body.meeting, shared: true }, base: off.body.meeting.updatedAt });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual(await approvedFile(id), file);
  assert.equal(await boardReads(id), reads);
});

// ─── S2: the sweep ──────────────────────────────────────────────────

/**
 * The press from `from`: cleanly (the control), then in each mode with its k-th statement going wrong once, k = 0, 1, …
 * until none is left. `judge({ mode, k, r, failed, before, after, control })` → '' or what's wrong
 */
async function sweep(name, from, press, judge, { observe, modes = ['fail', 'lose'], max = 400 }) {
  const problems = [];
  let control = null;
  let runs = 0;
  const counts = {};
  for (const mode of [null, ...modes]) {
    for (let k = mode ? 0 : -1; k < (mode ? max : 0); k++) {
      await restore(from);
      const before = await observe();
      fault = mode ? { mode, k, seen: 0, failed: [] } : null;
      let r;
      try { r = await press(); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
      const f = fault;
      fault = null;
      const failed = f?.failed?.[0] || '';
      if (mode && !failed) break;
      const after = await observe();
      if (!mode) control = { r, before, after };
      const why = await judge({ mode, k, r, failed, before, after, control });
      if (why) problems.push(`${name} ${mode || 'control'} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90)}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 200)}: ${why}`);
      runs += 1;
      counts[mode || 'control'] = (counts[mode || 'control'] || 0) + 1;
    }
  }
  return { problems, runs, counts };
}
const report = (out, least = 10) => {
  console.log(`# swept: ${out.runs} runs ${JSON.stringify(out.counts)}, ${out.problems.length} wrong`);
  assert.deepEqual(out.problems, [], `${out.problems.length} of ${out.runs} runs:\n${out.problems.join('\n')}`);
  assert.ok(out.runs > least, `swept every statement (${out.runs})`);
};
/** Refused, saying nothing was done: in the decided words, or the database's "nothing was changed" (or the sign-in's) */
function refusedTruly(r) {
  if (typeof r.status !== 'number' || r.status < 400 || r.body?.ok !== false) return `it answered ${r.status}, and nothing landed`;
  const w = said(r);
  if (w === STAY && r.status === 409) return '';
  if ([SIGN_IN_DOWN, SETUP_DOWN].includes(w) || (r.status === 503 && /People just now, so nothing was changed/.test(w))) return '';
  if (r.status === 500 || /Something went wrong/i.test(w) || !NOTHING.test(w)) return `nothing landed, and it said “${w}”`;
  return '';
}
const answeredDone = (r) => (r.status === 200 && r.body?.ok !== false && !NOTHING.test(said(r)) ? '' : `it landed, and it answered ${r.status} “${said(r)}”`);
const observeOf = (id) => async () => {
  const row = (await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0];
  const m = row ? cleanMeeting(JSON.parse(row.data)) : null;
  return { stated: m ? statedOf(m) : '', todo: !!m?.actions.some((a) => a.id === 'a_r15todo'), approved: m?.minutes === 'approved', file: await approvedFile(id) };
};

test('S2: approved, then a save of their words with a to-do: cleanly, each statement failing once in turn, each write landing with its answer lost: refused whole in true words, never a change to what they state, the to-do never half saved', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const m = await board.getMeeting(env.DB, id);
  const mine = MIXES['with a to-do'](CHANGES['the words under an item'](m));
  const from = saveState();
  const out = await sweep('words with a to-do', from, () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, before, after }) => {
    if (!mode && !(r.status === 409 && said(r) === STAY)) return `the control: ${r.status} “${said(r)}”`;
    if (after.stated !== before.stated) return 'what the approved minutes state changed';
    if (after.todo) return 'the to-do went in without the rest: half saved';
    if (!after.approved) return 'no longer approved';
    if (JSON.stringify(after.file) !== JSON.stringify(before.file)) return 'the approved file changed';
    return refusedTruly(r);
  }, { observe: observeOf(id) });
  report(out, 5);
});

test('S2: approved, then a save of a to-do alone: cleanly, each statement failing once in turn, each write landing with its answer lost: saved or refused in true words, and what they state never changes', async () => {
  const ms = await heldApproved('Mark them approved');
  const id = ms.held.id;
  const m = await board.getMeeting(env.DB, id);
  const mine = MIXES['with a to-do'](m);
  const out = await sweep('a to-do alone', saveState(), () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, before, after }) => {
    if (!mode && !(r.status === 200 && after.todo)) return `the control: ${r.status} “${said(r)}”`;
    if (after.stated !== before.stated) return 'what the approved minutes state changed';
    if (!after.approved) return 'no longer approved';
    if (JSON.stringify(after.file) !== JSON.stringify(before.file)) return 'the approved file changed';
    return after.todo ? answeredDone(r) : refusedTruly(r);
  }, { observe: observeOf(id) });
  report(out, 10);
  assert.ok(out.counts.lose > 0, 'writes landed with their answers lost');
});

test('S2: the secretary’s approving send, then a save of the roll mixed with the board page, every statement failing in turn, every write lost: refused whole in true words', async () => {
  const ms = await heldApproved('the secretary’s approving send');
  const id = ms.held.id;
  const m = await board.getMeeting(env.DB, id);
  const mine = MIXES['with the board page'](CHANGES['the roll (Kim there, then not)'](m));
  const out = await sweep('roll with the board page', saveState(), () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, before, after }) => {
    if (!mode && !(r.status === 409 && said(r) === STAY)) return `the control: ${r.status} “${said(r)}”`;
    if (after.stated !== before.stated) return 'what the approved minutes state changed';
    const row = JSON.parse((await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0].data);
    if (row.shared !== true) return 'taken off the board page without the rest: half saved';
    return refusedTruly(r);
  }, { observe: observeOf(id) });
  report(out, 5);
});

// ─── S3: one rule, every write ──────────────────────────────────────

test('S3: the server’s own steps go by the same rule: patchMeeting and patchTogether refuse a change to what approved minutes state, with nothing written; setOnMeeting writes only what they never state', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const was = await kept(id);
  await assert.rejects(board.patchMeeting(env.DB, id, (cur) => onItem(cur, 'i_budget', { notes: V2 }), { by: 'test' }), (e) => e.status === 409 && e.message === STAY);
  await assert.rejects(board.patchTogether(env.DB, [id], ([cur]) => ({ writes: [[cur, { ...cur, location: 'Elsewhere' }]] })), (e) => e.status === 409 && e.message === STAY);
  await assert.rejects(board.setOnMeeting(env.DB, id, { title: 'Another name' }, { by: 'test' }), /setOnMeeting writes only what minutes never state/);
  assert.deepEqual(await kept(id), was, 'nothing written');
  // (what they don't state goes as ever: a report, by Board's admins any time; the invite's video)
  const rep = await board.saveReport(env, id, 'i_ytd', 'Revenue is ahead of the plan.', { admin: true, adminEmail: FOUNDER });
  assert.equal(rep.report, 'Revenue is ahead of the plan.');
  const v = await board.setOnMeeting(env.DB, id, { video: 'https://meet.google.com/abc-defg-hij' }, { by: 'Board' });
  assert.equal(v.video, 'https://meet.google.com/abc-defg-hij');
  // Marked as draft, a server step changes them as ever
  await board.patchMeeting(env.DB, id, (cur) => ({ ...cur, minutes: 'draft', approvedOn: '' }), { by: 'test' });
  const fixed = await board.patchMeeting(env.DB, id, (cur) => onItem(cur, 'i_budget', { notes: V2 }), { by: 'test' });
  assert.equal(item(fixed, 'i_budget').notes, V2);
});

test('S3: a rename on People moves an address on approved minutes (their names and words stay), and the approved file stays as approved', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const file = await approvedFile(id);
  const stated = statedOf(await board.getMeeting(env.DB, id));
  await moveBoardSlug(env.DB, 'kim-park', 'kim-park-lee', { by: FOUNDER });
  const m = await board.getMeeting(env.DB, id);
  assert.ok(m.attendance.some((p) => p.slug === 'kim-park-lee' && p.name === 'Kim Park' && p.status === 'present'), 'Kim at her new address, still there');
  assert.equal(statedOf(m), stated);
  const after = await approvedFile(id);
  assert.deepEqual([after.id, after.sha, after.words], [file.id, file.sha, file.words]);
});

const { privateKey: SA_PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
/** Google answering who joined the meeting's Meet: Alex and Kim, the whole meeting */
const meetAnswers = (day) => async (url) => {
  const u = String(url);
  if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 't', expires_in: 3600 });
  if (/\/v2\/spaces\//.test(u)) return Response.json({ name: 'spaces/abc-space', meetingCode: 'abc-defg-hij' });
  if (/\/v2\/conferenceRecords\?/.test(u)) return Response.json({ conferenceRecords: [{ name: 'conferenceRecords/r1', startTime: `${day}T13:00:00Z`, endTime: `${day}T15:00:00Z` }] });
  if (/\/participants/.test(u)) return Response.json({ participants: ['Alex Rivera', 'Kim Park'].map((n, i) => ({ signedinUser: { user: `users/${i}`, displayName: n }, earliestStartTime: `${day}T13:00:00Z`, latestEndTime: `${day}T14:58:00Z` })) });
  throw new Error(`unexpected ${u}`);
};

test('S3: the Meet heartbeat after the minutes are approved keeps who joined beside them, never on their roll; draft minutes take it as ever', async () => {
  env.GOOGLE_CALENDAR_KEY = JSON.stringify({ type: 'service_account', client_email: 'board-reader@example.iam.gserviceaccount.com', private_key: SA_PEM });
  const day = inDays(-1);
  const make = (minutes) => board.saveMeeting(env.DB, cleanMeeting({
    date: day, start: '08:00', end: '10:00', shared: true, video: 'https://meet.google.com/abc-defg-hij', minutes, approvedOn: minutes === 'approved' ? inDays(0) : '',
    minutesFrom: { name: 'Minutes.pdf', at: new Date().toISOString(), ai: false, tries: 3 },
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board', status: slug === 'kim-park' ? '' : 'present' })),
    sections: [{ id: 's_x', title: 'Finance', items: [{ id: 'i_x', title: 'Year to date', notes: V1 }] }],
  }), { by: 'test' });
  for (const minutes of ['approved', 'draft']) {
    await raw.prepare("DELETE FROM board_state WHERE key = 'attendance-runs'").run();
    let m = await make(minutes);
    m = await board.setOnMeeting(env.DB, m.id, { invite: { eventId: 'ev1', organizer: FOUNDER, meet: 'https://meet.google.com/abc-defg-hij', guests: 4 } }, { by: 'Board' });
    const stated = statedOf(m);
    const done = await maybeFillAttendance(env, { fetchImpl: meetAnswers(day) });
    assert.ok(done.includes(m.id), `${minutes}: read for who joined`);
    m = await board.getMeeting(env.DB, m.id);
    assert.equal(m.fromMeet?.status, 'ok', `${minutes}: who joined is kept`);
    assert.ok(m.fromMeet.joined.some((j) => j.slug === 'kim-park'), `${minutes}: Kim joined, as Meet saw it`);
    const kim = m.attendance.find((p) => p.slug === 'kim-park').status;
    if (minutes === 'approved') {
      assert.equal(kim, '', 'approved: their roll is the record');
      assert.equal(statedOf(m), stated);
    } else assert.equal(kim, 'remote', 'draft: marked By video, as ever');
    await raw.prepare('DELETE FROM board_meetings WHERE id = ?').bind(m.id).run();
  }
  delete env.GOOGLE_CALENDAR_KEY;
});

test('S3: the rule itself: what minutes state, and only that; approved minutes in Board keep it, a draft and minutes approved with none in Board don’t', () => {
  const base = cleanMeeting({
    id: 'm_rule', date: '2026-11-05', start: '08:00', end: '10:00', title: '', location: 'Example Hall', address: '1 Example Way', shared: true,
    minutes: 'approved', approvedOn: '2026-11-20', minutesFrom: { name: 'Minutes.docx', at: '2026-11-06T12:00:00.000Z', typed: true },
    attendance: [{ slug: 'kim-park', name: 'Kim Park', kind: 'board', status: 'present' }, { name: 'Dana Smith', kind: 'guest', status: 'present' }],
    sections: [{ id: 's_a', title: 'Finance', notes: '', items: [{ id: 'i_a', title: 'Budget', notes: `- ${V1}`, motion: ASKS }, { id: 'i_b', title: 'Year to date' }] }, { id: 's_b', title: 'Open forum', items: [] }],
    motions: [{ id: 'v_a', text: 'Approve the 2027 budget', by: 'Sam Ortiz', second: 'Alex Rivera', result: 'passed' }],
    actions: [{ id: 'a_a', text: 'Send it to the bank', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }],
  });
  const S = shared.minutesStated;
  const same = {
    'an address followed (a rename)': { ...base, attendance: base.attendance.map((p) => (p.slug ? { ...p, slug: 'kim-park-lee', key: 'kim-park-lee' } : p)) },
    'a to-do': { ...base, actions: [] },
    'the board page': { ...base, shared: false },
    'the invite’s notes': { ...base, inviteNote: 'Parking in the back' },
    'an item’s name, report, private note, documents': onItem(base, 'i_a', { title: 'The 2027 budget', report: 'A report', staffNote: 'Private', docs: ['f_abcdefgh'] }),
    'the order of the parts, an item moved to another part': { ...base, sections: [{ ...base.sections[1], items: [base.sections[0].items[0]] }, { ...base.sections[0], items: [base.sections[0].items[1]] }] },
    'the words without their list mark': onItem(base, 'i_a', { notes: V1 }),
    'the roll in another order': { ...base, attendance: [...base.attendance].reverse() },
    'an item added with nothing under it': { ...base, sections: [{ ...base.sections[0], items: [...base.sections[0].items, { id: 'i_c', title: 'New' }] }, base.sections[1]] },
  };
  for (const [what, m] of Object.entries(same)) {
    assert.equal(S(m), S(base), `not stated: ${what}`);
    assert.equal(shared.minutesStay(base, m), '', `may change: ${what}`);
  }
  const differ = {
    'the words': onItem(base, 'i_a', { notes: V2 }),
    'the vote an item asks for': onItem(base, 'i_a', { motion: 'Move to approve it at fifty.' }),
    'a part’s own words': { ...base, sections: [{ ...base.sections[0], notes: 'Questions from the board.' }, base.sections[1]] },
    'an item with words deleted': { ...base, sections: [{ ...base.sections[0], items: [base.sections[0].items[1]] }, base.sections[1]] },
    'a decision’s result': { ...base, motions: [{ ...base.motions[0], result: 'failed' }] },
    'a decision’s words': { ...base, motions: [{ ...base.motions[0], text: 'Approve the 2027 budget as amended' }] },
    'who seconded': { ...base, motions: [{ ...base.motions[0], second: 'Kim Park' }] },
    'a decision taken out': { ...base, motions: [] },
    'the roll': { ...base, attendance: [{ ...base.attendance[0], status: 'remote' }, base.attendance[1]] },
    'someone off the roll': { ...base, attendance: [base.attendance[1]] },
    'a guest': { ...base, attendance: [...base.attendance, { name: 'Pat Lee', kind: 'guest', status: 'present' }] },
    'a guest’s name': { ...base, attendance: [base.attendance[0], { ...base.attendance[1], name: 'Dana Smyth' }] },
    'the name': { ...base, title: 'Q4 Board Meeting, held' },
    'the day': { ...base, date: '2026-11-06' },
    'the start': { ...base, start: '08:30' },
    'the end': { ...base, end: '11:00' },
    'the place': { ...base, location: 'Example Hall, Room 2' },
    'the address': { ...base, address: '2 Example Way' },
  };
  for (const [what, m] of Object.entries(differ)) {
    assert.notEqual(S(m), S(base), `stated: ${what}`);
    assert.equal(shared.minutesStay(base, m), STAY, `refused: ${what}`);
    assert.equal(shared.minutesStay(base, { ...m, minutes: 'draft' }), '', `taking the approval back with it: ${what}`);
    assert.equal(shared.minutesStay({ ...base, minutes: 'draft' }, m), '', `draft minutes: ${what}`);
    assert.equal(shared.minutesStay({ ...base, minutesFrom: null, approvedFile: '', files: [] }, m), '', `approved with none in Board: ${what}`);
    assert.equal(shared.minutesStay({ ...base, practice: true }, m), '', `a practice meeting: ${what}`);
  }
  // What the editor puts back when a save is refused: what they state as the site has it, the rest as typed
  const typed = { ...onItem(base, 'i_a', { notes: V2, title: 'The 2027 budget' }), location: 'Example Hall, Room 2', actions: [], inviteNote: 'Parking in the back' };
  const back = shared.withStated(typed, base);
  assert.equal(S(back), S(base), 'what they state, as the site has it');
  assert.deepEqual([item(back, 'i_a').title, back.actions.length, back.inviteNote], ['The 2027 budget', 0, 'Parking in the back'], 'the rest as typed');
  const gone = shared.withStated({ ...base, sections: [{ ...base.sections[0], items: [base.sections[0].items[1]] }] }, base);
  assert.equal(S(gone), S(base), 'an item with words taken out goes back');
  assert.deepEqual(shared.typedOver(typed, base).map((x) => [x.key, x.label, x.text]), [['place', 'The place', 'Example Hall, Room 2, 1 Example Way'], ['n:i_a', 'Under The 2027 budget', V2]], 'what was typed, to copy');
});
