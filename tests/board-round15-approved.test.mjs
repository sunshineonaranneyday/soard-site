/**
 * Board QA round 15 (Nov 26 2026), the admin tester's finding 1 (major): approved typed minutes changed with a plain save
 * of Board's agenda editor. "Budget passed at forty thousand." made "fifty", a decision's result and who was there
 * changed by the same save: 200, "Saved", the board page showed the change, and their approved Word file ("The minutes as
 * written") still said what the board approved.
 *   S1  What approved minutes state can't change while they're approved, by any route: everything their Word file prints
 *       from the meeting but its to-dos (decided Nov 26: their words under each part and item and the vote an item asks
 *       for, their decisions, the roll and guests, the meeting's name, day, time and place, each part and item printed, in
 *       order, with its name, time and who presents it). Approved each way (Board's Approve, Mark them approved, the
 *       secretary's approving send), a save of each, alone and with an unrelated change (a to-do added or changed, the
 *       board page, a document on an item), is refused (409) in the decided words with nothing changed, the whole save,
 *       and the approved file's bytes and id the same. Marked as draft, the same save lands. The to-dos are the founders'
 *       tracker, not the minutes: reworded, reassigned, re-dated, added or taken out on approved minutes, each saves
 *   S2  The sweep: the save on approved minutes, cleanly, then with each statement failing once in turn, then each write
 *       landing with its answer lost: refused or saved in true words, never a change to what they state
 *   S3  The rule is one, for every write of a meeting (functions/api/_board.js keepStated): the server's own steps
 *       (patchMeeting, patchTogether), setOnMeeting kept to what minutes never state, the Meet heartbeat keeping who
 *       joined beside the approved roll, a rename on People moving an address on them; what they don't state (a report,
 *       the invite's notes, a to-do) still saves. The rule itself (board-shared.js minutesStated, minutesStay) and what the
 *       editor puts back when it's refused (withStated, typedOver)
 *   S4  The rule and the file can't drift: the Word file made again (_board-notes.js minutesFileBytes) for every change a
 *       meeting can have, one at a time; whenever it prints differently, minutesStated says so too, its ACTION ITEMS
 *       section alone excused (the to-dos, decided Nov 26)
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
import { saveNotes, fileInputs, minutesFileBytes } from '../functions/api/_board-notes.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import { moveBoardSlug } from '../functions/api/_board-rename.js';
import { maybeFillAttendance } from '../functions/api/_board-attendance.js';
import * as shared from '../public/admin/board-shared.js';
import * as template from '../public/admin/board-minutes-template.js';

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
/** The action item the secretary recorded */
const TODO = 'a_r15bank';
const REPORT = 'Revenue is ahead of the plan.';
const NOTE = 'Parking behind the building';
const onPart = (m, id, patch) => ({ ...m, sections: m.sections.map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)) });
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
      { id: 's_fin', title: 'Finance', items: [{ id: 'i_ytd', title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }, { id: 'i_budget', title: 'The 2027 budget', motion: ASKS }] },
    ],
  }), { by: 'test' });
  // (an ordinary file of the meeting, for a save that puts it on an item)
  const map = await board.putFile(env, { ownerType: 'meeting', ownerId: held.id, file: new File([new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')], 'Parking-map.pdf', { type: 'application/pdf' }), kind: 'other', by: FOUNDER });
  await saveNotes(env, held.id, { changes: {
    'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'r:kim-park': 'present', guests: 'Dana Smith',
    'n:i_budget': V1, 'm:i_budget': { text: 'Approve the 2027 budget', by: 'Sam Ortiz', second: 'Alex Rivera', result: 'passed' },
    'm:i_prev': { by: 'Alex Rivera', second: 'Sam Ortiz', result: 'tabled' },
    [`a:${TODO}`]: { text: 'Send the budget to the bank', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(14) },
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
  assert.ok(now.actions.some((a) => a.id === TODO && a.ownerName === 'Sam Ortiz'), 'the action item is on the meeting');
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
  // (decided Nov 26: everything the Word file prints from the meeting)
  'an item’s name': (m) => onItem(m, 'i_ytd', { title: 'Year to date, through October' }),
  'a part’s name': (m) => onPart(m, 's_fin', { title: 'The money' }),
  'who presents an item': (m) => onItem(m, 'i_ytd', { who: ['kim-park'], presenter: 'Kim Park' }),
  'the order of the items': (m) => onPart(m, 's_fin', (s) => ({ items: [...s.items].reverse() })),
  'the order of the parts': (m) => ({ ...m, sections: [...m.sections].reverse() }),
  'an item added': (m) => onPart(m, 's_fin', (s) => ({ items: [...s.items, { id: 'i_r15new', title: 'Something new' }] })),
  'an item taken out': (m) => onPart(m, 's_fin', (s) => ({ items: s.items.filter((it) => it.id !== 'i_ytd') })),
  'a part’s time': (m) => onPart(m, 's_fin', { minutes: 45 }),
};
/** The to-dos, as the founders keep working them after the meeting: the tracker, never what the minutes state (decided Nov 26) */
const TODOS = {
  reworded: (m) => ({ ...m, actions: m.actions.map((a) => (a.id === TODO ? { ...a, text: 'Send the budget to the auditor' } : a)) }),
  reassigned: (m) => ({ ...m, actions: m.actions.map((a) => (a.id === TODO ? { ...a, owner: 'kim-park', ownerName: 'Kim Park' } : a)) }),
  're-dated': (m) => ({ ...m, actions: m.actions.map((a) => (a.id === TODO ? { ...a, due: inDays(30) } : a)) }),
  added: (m) => ({ ...m, actions: [...m.actions, { id: 'a_r15todo', text: 'Book the next room', owner: 'kim-park', ownerName: 'Kim Park', due: inDays(20) }] }),
  'taken out': (m) => ({ ...m, actions: m.actions.filter((a) => a.id !== TODO) }),
};
/** An unrelated change with it: a to-do added, a to-do changed, the board page, a document on an item (or none) */
const MIXES = {
  alone: (m) => m,
  'with a to-do added': (m) => TODOS.added(m),
  'with a to-do reworded, reassigned and re-dated': (m) => TODOS['re-dated'](TODOS.reassigned(TODOS.reworded(m))),
  'with the board page': (m) => ({ ...m, shared: false }),
  'with a document on an item': (m, ms) => onItem(m, 'i_budget', { docs: [ms.mapId] }),
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
 * on what it does): the name, day, time and place, who was there and how, each part and item with something in it, in
 * order, with its name, time, who presents it, the words and vote under it, and the decisions
 */
const statedOf = (m) => {
  const c = cleanMeeting(m || {});
  return JSON.stringify({
    name: shared.meetingName(c), date: c.date, start: c.start, end: c.end, place: [c.location, c.address],
    roll: c.attendance.map((p) => [p.kind, p.name, p.status]),
    parts: c.sections.map((s) => [s.id, s.title, s.minutes, s.notes, s.items.filter(shared.isFilled).map((it) => [it.id, it.title, it.presenter, it.who, it.guests, it.notes, it.motion || ''])]),
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
  test(`S1: approved by ${how}: a save of each thing the minutes state, alone and with a to-do added or changed, the board page or a document, is refused in the decided words with nothing changed and the approved file the same; marked as draft, the same save lands`, async () => {
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
      const mine = MIXES['with a to-do added'](change(m), ms);
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

for (const how of Object.keys(APPROVE_ROUTES)) {
  test(`S1: approved by ${how}: the to-dos are the founders’ tracker, not the minutes: reworded, reassigned, re-dated, added and taken out, each saves (200) with the minutes still approved and their approved file’s id and bytes unchanged`, async () => {
    const ms = await heldApproved(how);
    const id = ms.held.id;
    const file = await approvedFile(id);
    const reads = await boardReads(id);
    const wrong = [];
    for (const [what, change] of Object.entries(TODOS)) {
      const m = await board.getMeeting(env.DB, id);
      const mine = change(m);
      const r = await onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt });
      const now = await board.getMeeting(env.DB, id);
      const todos = (x) => JSON.stringify(cleanMeeting(x).actions.map(({ done, doneOn, ...a }) => a));
      if (r.status !== 200 || r.body?.ok === false) wrong.push(`${what}: ${r.status} “${said(r)}”`);
      else if (todos(now) !== todos(mine)) wrong.push(`${what}: the site has ${todos(now)}`);
      if (now.minutes !== 'approved') wrong.push(`${what}: no longer approved`);
      if (JSON.stringify(await approvedFile(id)) !== JSON.stringify(file)) wrong.push(`${what}: the approved file changed`);
    }
    assert.deepEqual(wrong, []);
    const m = await board.getMeeting(env.DB, id);
    assert.ok(!m.actions.some((a) => a.id === TODO) && m.actions.some((a) => a.id === 'a_r15todo'), 'the to-dos as the founders left them');
    assert.equal(await boardReads(id), reads, 'the board page reads the minutes as approved');
    const words = await docxText(files.get((await sql('SELECT r2_key FROM board_files WHERE id = ?', file.id))[0].r2_key));
    assert.ok(words.includes('Send the budget to the bank'), 'the approved file keeps the to-do as it was assigned at the meeting');
  });
}

test('S1: what the Word file never prints still saves on approved minutes: a report, a document on an item, Board only, a private note, the invite’s notes, an empty row, the board page, a to-do ticked done', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const file = await approvedFile(id);
  const reads = await boardReads(id);
  let m = await board.getMeeting(env.DB, id);
  const mine = onPart(onItem(onItem({ ...m, inviteNote: NOTE }, 'i_ytd', { report: REPORT, docs: [ms.mapId], confidential: true }), 'i_budget', { staffNote: 'Ask the bank first' }), 's_fin', (s) => ({ items: [...s.items, { id: 'i_r15row', title: '' }] }));
  const r = await onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  m = await board.getMeeting(env.DB, id);
  assert.deepEqual([m.inviteNote, item(m, 'i_ytd').report, item(m, 'i_ytd').docs, item(m, 'i_ytd').confidential, item(m, 'i_budget').staffNote, !!item(m, 'i_r15row')], [NOTE, REPORT, [ms.mapId], true, 'Ask the bank first', true]);
  assert.equal(statedOf(m), statedOf(ms.held), 'what the minutes state is as approved');
  const done = await onAdmin({ action: 'action-done', actionId: TODO, done: true });
  assert.equal(done.status, 200, JSON.stringify(done.body));
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
  return { stated: m ? statedOf(m) : '', todo: !!m?.actions.some((a) => a.id === 'a_r15todo'), docs: item(m, 'i_budget')?.docs || [], approved: m?.minutes === 'approved', file: await approvedFile(id) };
};

test('S2: approved, then a save of their words with a to-do: cleanly, each statement failing once in turn, each write landing with its answer lost: refused whole in true words, never a change to what they state, the to-do never half saved', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const m = await board.getMeeting(env.DB, id);
  const mine = MIXES['with a to-do added'](CHANGES['the words under an item'](m));
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

test('S2: approved, then a save of a to-do alone (the tracker, not the minutes): cleanly, each statement failing once in turn, each write landing with its answer lost: saved or refused in true words, and what they state never changes', async () => {
  const ms = await heldApproved('Mark them approved');
  const id = ms.held.id;
  const m = await board.getMeeting(env.DB, id);
  const mine = MIXES['with a to-do added'](m);
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

test('S2: approved, then a save of an item’s name with a document on another item, every statement failing in turn, every write lost: refused whole in true words, the document never half saved', async () => {
  const ms = await heldApproved('Mark them approved');
  const id = ms.held.id;
  const m = await board.getMeeting(env.DB, id);
  const mine = MIXES['with a document on an item'](CHANGES['an item’s name'](m), ms);
  const out = await sweep('a name with a document', saveState(), () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, before, after }) => {
    if (!mode && !(r.status === 409 && said(r) === STAY)) return `the control: ${r.status} “${said(r)}”`;
    if (after.stated !== before.stated) return 'what the approved minutes state changed';
    if (after.docs.length) return 'the document went on without the rest: half saved';
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

test('S3: a rename on People moves an address on approved minutes, of someone on the roll who presents an item and has an action item: followed, the same person, their names and words as they were; the approved file stays as approved', async () => {
  const ms = await heldApproved('Board’s Approve');
  const id = ms.held.id;
  const file = await approvedFile(id);
  const before = await board.getMeeting(env.DB, id);
  const moves = { 'sam-ortiz': 'sam-ortiz-lee' };
  await moveBoardSlug(env.DB, 'sam-ortiz', 'sam-ortiz-lee', { by: FOUNDER });
  const m = await board.getMeeting(env.DB, id);
  assert.ok(m.attendance.some((p) => p.slug === 'sam-ortiz-lee' && p.name === 'Sam Ortiz' && p.status === 'present'), 'Sam at his new address on the roll, still there');
  assert.deepEqual(item(m, 'i_ytd').who, ['sam-ortiz-lee'], 'presenting at his new address');
  assert.equal(m.actions.find((a) => a.id === TODO)?.owner, 'sam-ortiz-lee', 'his action item at his new address');
  assert.equal(statedOf(m), statedOf(shared.followAddresses(before, moves)), 'what they say, the address followed');
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

test('S3: the rule itself: what minutes state, and only that; approved minutes in Board keep it, a draft and minutes approved with none in Board don’t; what the editor puts back when a save is refused', () => {
  const base = cleanMeeting({
    id: 'm_rule', date: '2026-11-05', start: '08:00', end: '10:00', title: '', location: 'Example Hall', address: '1 Example Way', shared: true,
    minutes: 'approved', approvedOn: '2026-11-20', minutesFrom: { name: 'Minutes.docx', at: '2026-11-06T12:00:00.000Z', typed: true },
    attendance: [{ slug: 'kim-park', name: 'Kim Park', kind: 'board', status: 'present' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board', status: 'present' }, { name: 'Dana Smith', kind: 'guest', status: 'present' }],
    sections: [{ id: 's_a', title: 'Finance', notes: '', items: [{ id: 'i_a', title: 'Budget', presenter: 'Sam Ortiz', who: ['sam-ortiz'], notes: `- ${V1}`, motion: ASKS }, { id: 'i_b', title: 'Year to date' }, { id: 'i_e', title: '' }] }, { id: 's_b', title: 'Open forum', items: [] }],
    motions: [{ id: 'v_a', text: 'Approve the 2027 budget', by: 'Sam Ortiz', second: 'Alex Rivera', result: 'passed' }],
    actions: [{ id: 'a_a', text: 'Send it to the bank', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: '2026-12-01' }],
  });
  const S = template.minutesStated;
  const same = {
    'an address followed (a rename) of someone on the roll': shared.followAddresses(base, { 'kim-park': 'kim-park-lee' }),
    'a to-do ticked done': { ...base, actions: base.actions.map((a) => ({ ...a, done: true, doneOn: '2026-11-21' })) },
    // (the to-dos are the founders' tracker, never what the minutes state: decided Nov 26)
    'a to-do reworded': { ...base, actions: [{ ...base.actions[0], text: 'Send it to the auditor' }] },
    'a to-do reassigned': { ...base, actions: [{ ...base.actions[0], ownerName: 'Kim Park', owner: 'kim-park' }] },
    'a to-do re-dated': { ...base, actions: [{ ...base.actions[0], due: '2026-12-15' }] },
    'a to-do added': { ...base, actions: [...base.actions, { id: 'a_b', text: 'Book the next room', owner: 'kim-park', ownerName: 'Kim Park' }] },
    'a to-do taken out': { ...base, actions: [] },
    'the board page': { ...base, shared: false },
    'the invite’s notes': { ...base, inviteNote: 'Parking in the back' },
    'an item’s report, private note, documents, Board only': onItem(base, 'i_a', { report: 'A report', staffNote: 'Private', docs: ['f_abcdefgh'], confidential: true }),
    'an empty row taken out': { ...base, sections: [{ ...base.sections[0], items: base.sections[0].items.slice(0, 2) }, base.sections[1]] },
    'an empty row added': onPart(base, 's_b', (sec) => ({ items: [{ id: 'i_f', title: '' }] })),
  };
  for (const [what, m] of Object.entries(same)) {
    assert.equal(S(m), S(base), `not stated: ${what}`);
    assert.equal(template.minutesStay(base, m), '', `may change: ${what}`);
  }
  const differ = {
    'the words': onItem(base, 'i_a', { notes: V2 }),
    'the words without their list mark (the board page shows a paragraph, not a point)': onItem(base, 'i_a', { notes: V1 }),
    'the vote an item asks for': onItem(base, 'i_a', { motion: 'Move to approve it at fifty.' }),
    'a part’s own words': onPart(base, 's_a', { notes: 'Questions from the board.' }),
    'an item with words deleted': onPart(base, 's_a', (sec) => ({ items: sec.items.filter((it) => it.id !== 'i_a') })),
    'an item’s name': onItem(base, 'i_b', { title: 'Year to date, through October' }),
    'a part’s name': onPart(base, 's_b', { title: 'Questions' }),
    'who presents (picked)': onItem(base, 'i_a', { who: ['kim-park'] }),
    // (who presents is named as the file names them, by address: a rename moving one is followed first, the one step that
    // does: _board.js keepStated `follows`, from _board-rename.js moveBoardSlug, in S3's rename)
    'who presents (an address moved, not followed)': shared.followAddresses(base, { 'sam-ortiz': 'sam-ortiz-lee' }),
    'who presents (written)': onItem(base, 'i_b', { presenter: 'Pat Lee' }),
    'who presents (a guest)': onItem(base, 'i_b', { guests: ['Dana Smith'] }),
    'the order of the items': onPart(base, 's_a', (sec) => ({ items: [sec.items[1], sec.items[0], sec.items[2]] })),
    'the order of the parts': { ...base, sections: [...base.sections].reverse() },
    'an item moved to another part': { ...base, sections: [{ ...base.sections[0], items: base.sections[0].items.slice(1) }, { ...base.sections[1], items: [base.sections[0].items[0]] }] },
    'an item added with a name': onPart(base, 's_b', { items: [{ id: 'i_n', title: 'New' }] }),
    'a part’s time': onPart(base, 's_a', { minutes: 45 }),
    'what an item shows live (its time)': onItem(base, 'i_b', { live: 'cash' }),
    'a decision’s result': { ...base, motions: [{ ...base.motions[0], result: 'failed' }] },
    'a decision’s words': { ...base, motions: [{ ...base.motions[0], text: 'Approve the 2027 budget as amended' }] },
    'who seconded': { ...base, motions: [{ ...base.motions[0], second: 'Kim Park' }] },
    'a decision taken out': { ...base, motions: [] },
    'the roll': { ...base, attendance: [{ ...base.attendance[0], status: 'remote' }, base.attendance[1], base.attendance[2]] },
    'the roll in another order': { ...base, attendance: [base.attendance[1], base.attendance[0], base.attendance[2]] },
    'someone off the roll': { ...base, attendance: base.attendance.slice(1) },
    'a guest': { ...base, attendance: [...base.attendance, { name: 'Pat Lee', kind: 'guest', status: 'present' }] },
    'a guest’s name': { ...base, attendance: [base.attendance[0], base.attendance[1], { ...base.attendance[2], name: 'Dana Smyth' }] },
    'when the chair adjourned it': { ...base, live: { ...base.live, startedAt: '2026-11-05T13:00:00.000Z', endedAt: '2026-11-05T14:47:00.000Z' } },
    'the name': { ...base, title: 'Q4 Board Meeting, held' },
    'the day': { ...base, date: '2026-11-06' },
    'the start': { ...base, start: '08:30' },
    'the end': { ...base, end: '11:00' },
    'the place': { ...base, location: 'Example Hall, Room 2' },
    'the address': { ...base, address: '2 Example Way' },
  };
  for (const [what, m] of Object.entries(differ)) {
    assert.notEqual(S(m), S(base), `stated: ${what}`);
    assert.equal(template.minutesStay(base, m), STAY, `refused: ${what}`);
    assert.equal(template.minutesStay(base, { ...m, minutes: 'draft' }), '', `taking the approval back with it: ${what}`);
    assert.equal(template.minutesStay({ ...base, minutes: 'draft' }, m), '', `draft minutes: ${what}`);
    assert.equal(template.minutesStay({ ...base, minutesFrom: null, approvedFile: '', files: [] }, m), '', `approved with none in Board: ${what}`);
    assert.equal(template.minutesStay({ ...base, practice: true }, m), '', `a practice meeting: ${what}`);
  }
  // What the editor puts back when a save is refused: what they state as the site has it, what the file never prints as typed
  const typed = { ...onItem(onItem(base, 'i_a', { notes: V2, title: 'The 2027 budget', report: 'A report', docs: ['f_abcdefgh'] }), 'i_b', { staffNote: 'Private' }), location: 'Example Hall, Room 2', actions: [], inviteNote: 'Parking in the back', sections: undefined };
  typed.sections = [{ ...onItem(base, 'i_a', { notes: V2, title: 'The 2027 budget', report: 'A report', docs: ['f_abcdefgh'] }).sections[0], items: [...onItem(base, 'i_a', { notes: V2, title: 'The 2027 budget', report: 'A report', docs: ['f_abcdefgh'] }).sections[0].items.slice(0, 1), { ...base.sections[0].items[1], staffNote: 'Private' }, { id: 'i_g', title: 'Added here' }] }];
  const back = template.withStated(typed, base);
  assert.equal(S(back), S(base), 'what they state, as the site has it');
  assert.deepEqual([item(back, 'i_a').title, item(back, 'i_a').report, item(back, 'i_a').docs, item(back, 'i_b').staffNote, back.inviteNote, back.actions.length, back.sections.length], ['Budget', 'A report', ['f_abcdefgh'], 'Private', 'Parking in the back', 0, 2], 'the to-dos and what the file never prints, as typed');
  assert.deepEqual(template.typedOver(typed, base).map((x) => [x.key, x.label, x.text]), [
    ['place', 'The place', 'Example Hall, Room 2, 1 Example Way'],
    ['t:i_a', 'The item named Budget', 'The 2027 budget'], ['n:i_a', 'Under The 2027 budget', V2],
    ['t:i_g', 'An item’s name', 'Added here'],
  ], 'what was typed, to copy');
  // (a copy whose kept parts would print otherwise, an item filled only by its document: the site's agenda whole)
  const docOnly = onItem(base, 'i_e', { docs: ['f_abcdefgh'] });
  assert.equal(S(template.withStated(docOnly, base)), S(base));
});

// ─── S4: the rule and the file can't drift ──────────────────────────
//
// The Word file approved minutes are made as (_board-notes.js minutesFileBytes, the template's documentXml from
// minutesOutline and the send's record), made again for every change a meeting can have, one at a time: every leaf of
// the meeting given each kind of value it can take (the clean meeting's own rules keep only the ones it can), every list
// with each entry taken out, a copy added and its order turned round, every object taken away. Whenever the file prints
// differently, minutesStated has to say so too. A new line in the template that minutesStated doesn't cover fails here.
// One section is excused, and only it: ACTION ITEMS. The to-dos are follow-ups the founders keep working after the meeting
// (due dates move, owners change, reminders and "late" track them across meetings); the approved file keeps them as they
// were assigned at the meeting, and the live to-do moving on after that is the tracker, not a change to the minutes
// (decided Nov 26 2026). Every change the excuse hides is checked to be a to-do's.
const ENTRIES = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml'];
/** The ACTION ITEMS part's heading, and the item lines under it up to the next part, close or fact (documentXml) */
const ACTION_ITEMS = /(<w:t xml:space="preserve">ACTION ITEMS<\/w:t><\/w:r><\/w:p>)((?:<w:p><w:pPr><w:pStyle w:val="Item"\/>(?:(?!<\/w:p>)[\s\S])*<\/w:p>)*)/;
/** What a Word file prints, as one string: every part of it, its ACTION ITEMS section left out (`excuse`) */
async function printedOf(bytes, { excuse = true } = {}) {
  const parts = await shared.unzip(bytes, ENTRIES);
  return ENTRIES.map((n) => { const t = new TextDecoder().decode(parts[n] || new Uint8Array()); return n === 'word/document.xml' && excuse ? t.replace(ACTION_ITEMS, '$1') : t; }).join('\n');
}

const POOL = ['Changed words', '', '2026-07-15', '09:15', '11:45', '2026-07-15T13:47:00.000Z', 'present', 'remote', 'absent', 'excused', 'passed', 'failed', 'tabled',
  'board', 'staff', 'guest', 'projects', 'cash', 'minutes', 'events', 'meetings', 'costs', 'sam-ortiz', 'kim-park', 'jane-doe', 'Kim Park', 'Dana Smith',
  'i_zzzzzzzz', 's_zzzzzzzz', 'v_zzzzzzzz', 'a_zzzzzzzz', 'f_abcdefgh', 'typed', 'template', 'https://meet.google.com/abc-defg-hij'];
function* leaves(o, path = []) {
  if (Array.isArray(o)) { yield { path, value: o }; for (const [i, v] of o.entries()) yield* leaves(v, [...path, i]); return; }
  if (o && typeof o === 'object') { yield { path, value: o }; for (const [k, v] of Object.entries(o)) yield* leaves(v, [...path, k]); return; }
  yield { path, value: o };
}
const setAt = (o, path, v) => { const c = structuredClone(o); let x = c; for (const k of path.slice(0, -1)) x = x[k]; x[path.at(-1)] = v; return c; };
const freshId = (v) => (typeof v?.id === 'string' ? { ...v, id: `${v.id.slice(0, 2)}r15copy` } : v);
function candidates(value, path) {
  if (typeof value === 'string') return [...POOL, `${value} changed`];
  if (typeof value === 'number') return [value + 5, 0, 30];
  if (typeof value === 'boolean') return [!value];
  if (Array.isArray(value)) {
    const out = value.map((_, i) => value.filter((__, j) => j !== i));
    if (value.length > 1) out.push([...value].reverse());
    if (value.length && value[0] && typeof value[0] === 'object') out.push([...value, freshId(value[0])]);
    else for (const x of ['kim-park', 'jane-doe', 'Dana Smith', 'f_abcdefgh', 'cash']) out.push([...value, x]);
    return out;
  }
  if (value && typeof value === 'object') return path.length ? [null] : [];
  return value === null ? ['Changed words'] : [];
}

test('S4: what minutes state is what their Word file prints but its to-dos: every change a meeting can have, made one at a time, the file made again; whenever it prints differently outside ACTION ITEMS, minutesStated says so too (and a rule that left out the names would fail here)', async () => {
  const ms = await heldSent();
  const id = ms.held.id;
  const last = JSON.parse((await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', id))[0].sent);
  const held = await board.getMeeting(env.DB, id);
  const inputs = await fileInputs(env, held, last);
  // (more for the file to print: the chair's end on its day, a founder on the roll as staff, a part's own words, a decision
  // from the floor with its count, a guest presenting, a second item in a part)
  const base = cleanMeeting({
    ...held,
    live: { ...held.live, startedAt: `${held.date}T13:00:00.000Z`, endedAt: `${held.date}T14:47:00.000Z` },
    attendance: [...held.attendance, { slug: 'jane-doe', name: 'Jane Doe', kind: 'staff', status: 'present' }],
    sections: held.sections.map((s) => (s.id === 's_open' ? { ...s, notes: 'Called to order at 8:02.', items: [...s.items, { id: 'i_roll', title: 'Roll call', guests: ['Dana Smith'], presenter: 'Dana Smith' }] } : s)),
    motions: [...held.motions, { id: 'v_floor', text: 'Thank the volunteers', by: 'Kim Park', second: 'Sam Ortiz', result: 'passed', tally: { for: 4, against: 0, abstain: 1, of: 4, at: '' } }],
  });
  const file = (m) => { try { return Buffer.from(minutesFileBytes(m, last, inputs, Date.parse('2026-11-26T12:00:00Z'))); } catch { return null; } };
  const doc0 = file(base);
  assert.ok(doc0, 'the file is made');
  const text0 = await docxText(doc0);
  for (const said of ['Year to date (Sam Ortiz)', 'CALL TO ORDER', 'Roll call (Dana Smith)', 'Called to order at 8:02.', 'Thank the volunteers', 'ACTION ITEMS', 'Send the budget to the bank', 'Jane Doe', 'Adjourned at']) assert.ok(text0.includes(said), `setup: the file prints “${said}”`);
  assert.ok(ACTION_ITEMS.test(new TextDecoder().decode((await shared.unzip(doc0, ['word/document.xml']))['word/document.xml'])), 'setup: the file has its ACTION ITEMS section');
  const clean0 = JSON.stringify(base);
  const print0 = await printedOf(doc0);
  const raw0 = await printedOf(doc0, { excuse: false });
  const check = async (stated) => {
    const misses = [];
    const excused = [];
    let printed = 0;
    let tried = 0;
    for (const { path, value } of leaves(base)) {
      for (const v of candidates(value, path)) {
        if (!path.length) continue;
        const m = cleanMeeting(setAt(base, path, v));
        if (JSON.stringify(m) === clean0) continue;
        tried += 1;
        const doc = file(m);
        if (!doc || doc.equals(doc0)) continue;
        const said = `${path.join('.')} = ${JSON.stringify(v)?.slice(0, 60)}`;
        if ((await printedOf(doc)) === print0) { if ((await printedOf(doc, { excuse: false })) !== raw0) excused.push(said); continue; }
        printed += 1;
        if (stated(m) === stated(base)) misses.push(said);
      }
    }
    return { misses: [...new Set(misses)], excused: [...new Set(excused)], printed, tried };
  };
  const out = await check(template.minutesStated);
  console.log(`# ${out.tried} changes tried, ${out.printed} printed differently, ${out.excused.length} only in ACTION ITEMS (excused), ${out.misses.length} not covered`);
  assert.deepEqual(out.misses, [], 'every change the file prints is a change minutesStated says');
  assert.ok(out.printed > 60, `the file printed differently for many of them (${out.printed})`);
  // (the excuse is the ACTION ITEMS section and nothing else: every change it hid is a to-do's, and to-dos did print there)
  assert.ok(out.excused.length > 0, 'changes to the to-dos printed in ACTION ITEMS, and were excused');
  assert.deepEqual(out.excused.filter((x) => !/^actions(\.| = )/.test(x)), [], 'nothing but a to-do is excused');
  // (the check bites: a rule that left the parts' and items' names out, as round 15's first fix did, misses them here)
  const weaker = (m) => { const x = JSON.parse(template.minutesStated(m)); return JSON.stringify({ ...x, parts: x.parts.map((p) => ({ ...p, title: '', items: p.items.map((it) => ({ ...it, title: '', presenter: '' })) })), presentedBy: [] }); };
  const bites = await check(weaker);
  assert.ok(bites.misses.some((x) => /\.title = /.test(x)) && bites.misses.some((x) => /\.(presenter|who|guests)/.test(x)), `a rule without the names misses them (${bites.misses.slice(0, 4).join(' | ')})`);
});
