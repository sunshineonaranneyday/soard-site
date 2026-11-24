/**
 * Board QA round 12 (Nov 23 2026), the privacy tester's findings 2 and 3: the minutes' Word files.
 *   F2  Send the minutes takes the last send's Word file off in the same one step that puts the new notes (and the new
 *       file's row) on the meeting: all of it or none of it. A file's row goes before its bytes (deleteFile and every
 *       delete), the bytes only once that step lands, and bytes whose delete fails then are the heartbeat's
 *       (finishBytesOff): never a row naming bytes that are gone, never two minutes files, never a withdrawn minutes'
 *       file the board page opens as "The minutes as written"
 *   F3  a correction and its Word file land together: the file's new bytes made before the one step (every read they
 *       go by first), and that step writes the corrected minutes, the notes' record, the decision, the notice owed and
 *       the file's row; a file that can't be made leaves nothing made, said in words, the correction waiting again.
 *       And approving minutes never approves a file older than their last change: the approving send (and Board's
 *       approve) brings the file up to what the minutes say first, in the same step, or refuses in words
 *   A3  (the admin tester's 3) a refusal because the site knows more than the tab shows carries the meeting as the site
 *       has it, for the page to take: every no on a meeting's files (File it under, Delete, a signed copy kept, Read in
 *       over typed or approved minutes, a file kept as an ordinary one), never to a board member, whose refusals carry no
 *       meeting as Board keeps it
 *   A4  a meeting file and its place on its agenda item land together, Board's and the Advisory Board's (the shared file
 *       code, ./functions/api/_board.js putFileWith and deleteFile): an upload's bytes staged, then its row and the item
 *       in one write over the meeting as read, the bytes back should it not land; a delete's row and its places on the
 *       agenda in one write, the bytes after. A press again after a failure never keeps a second copy, nor says "That
 *       file is gone" of a file still on its item
 * The sweeps are the tester's (lib12.mjs sweepAll): the same press from the same saved state, cleanly and then with
 * each statement it makes (reads, writes, batches) failing once in turn; after each, the meeting names only files that
 * open with the minutes' current words, the board page opens the right one, and the answer's words say what happened.
 * Made-up people only (the repo is public). Run: node --test tests/board-round12-files.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as portal from '../functions/api/board-portal.js';
import * as admin from '../functions/api/board-admin.js';
import * as boardFile from '../functions/api/board-file.js';
import * as board from '../functions/api/_board.js';
import { saveNotes, sendNotes } from '../functions/api/_board-notes.js';
import { suggestCorrection } from '../functions/api/_board-corrections.js';
import { maybeRunSigning } from '../functions/api/_board-sign.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { meetingAction, createAdvisoryMeeting } from '../functions/api/_advisory-meetings.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
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
// The words decided (written out, so a run on the code before them fails on what it says, never on an import)
const NOT_SENT = 'We couldn’t send the minutes just now, so nothing was changed. Please try again in a moment.';
const NOT_DECIDED = 'We couldn’t save that just now, so nothing was changed. Please try again in a moment.';
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
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

// ─── The database not answering one statement, and the bucket not deleting ─
// Every statement the press makes is counted (one in a batch too, which then fails whole, as D1's does), and the k-th
// fails once
let raw;
let fault = null; // { k, seen, failed, test }
function check(sql) {
  if (!fault || (fault.test && !fault.test(String(sql || '')))) return;
  const i = fault.seen++;
  if (i === fault.k) { fault.failed.push(String(sql)); throw new Error('D1_ERROR: Network connection lost.'); }
}
const wrap = (st) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => { check(s._sql); return s[m](...a); } : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => { for (const s of stmts) check(s._sql); return raw.batch(stmts); }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});

let env;
const files = new Map();
let deletesFail = 0; // the bucket refuses this many deletes
let mail = []; // every email Resend took: { to, kind }
let later = [];
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
  deletesFail = 0;
  raw = await createD1();
  files.clear();
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test',
    FILES: {
      get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length, httpMetadata: {} } : null),
      put: async (k, v) => { files.set(k, new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); },
      delete: async (k) => { if (deletesFail > 0) { deletesFail -= 1; throw new Error('R2: we encountered an internal error'); } files.delete(k); },
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
  mail = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '' });
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
    }
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; deletesFail = 0; });

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
const sql = async (q, ...b) => (await raw.prepare(q).bind(...b).all()).results || [];
const meetingRow = async (id) => { const r = (await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0]; return r ? JSON.parse(r.data) : null; };
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''}`.trim();
const textOf = async (bytes) => { try { return await docxText(bytes); } catch { return ''; } };

// ─── Saved states, and the sweep ────────────────────────────────────

const saveState = () => ({ bytes: raw._db.export(), files: new Map(files), mail: [...mail] });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  mail = [...s.mail];
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  later = [];
  deletesFail = 0;
}
/**
 * The press from `from`, cleanly (k = -1, the control) and then with the k-th statement failing once, k = 0, 1, … until
 * none is left to fail. `judge({ k, r, failed, before, after, control })` → '' or what's wrong. → { problems, runs, failedSql }
 */
async function sweep(name, from, press, judge, { observe, max = 400 }) {
  const problems = [];
  const failedSql = [];
  let control = null;
  let runs = 0;
  for (let k = -1; k < max; k++) {
    await restore(from);
    const before = await observe();
    fault = k < 0 ? null : { k, seen: 0, failed: [] };
    let r;
    try { r = await press(); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
    const f = fault;
    fault = null;
    const failed = f?.failed?.[0] || '';
    if (k >= 0 && !failed) break;
    const after = await observe();
    if (k < 0) control = { r, before, after };
    const why = await judge({ k, r, failed, before, after, control });
    if (why) problems.push(`${name} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90) || 'control'}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 200)}: ${why}`);
    runs += 1;
    if (failed) failedSql.push(failed);
  }
  return { problems, runs, failedSql };
}
const report = (out, least = 30) => {
  console.log(`# swept: ${out.runs} runs, ${out.problems.length} wrong`);
  assert.deepEqual(out.problems, [], `${out.problems.length} of ${out.runs} runs:\n${out.problems.join('\n')}`);
  assert.ok(out.runs > least, `swept every statement (${out.runs})`);
};
/** A refusal that says nothing was done: never "something went wrong" over a step that left nothing changed */
function refused(r) {
  if (typeof r.status !== 'number' || r.status < 400) return `nothing landed, and it answered ${r.status}`;
  if (r.status === 500 || /Something went wrong/i.test(said(r))) return `nothing landed, and it said “${said(r)}”, not that nothing was changed`;
  if (!NOTHING.test(said(r)) && said(r) !== SIGN_IN_DOWN) return `nothing landed, and it said “${said(r)}”`;
  return '';
}
/** Done: answered as done, never in a refusal's words */
const answeredDone = (r) => (r.status === 200 && !NOTHING.test(said(r)) ? '' : `it landed, and it answered ${r.status} “${said(r)}”`);

// ─── The meetings ───────────────────────────────────────────────────

const V1 = 'Budget passed at forty thousand.';
const V2 = 'Budget passed at fifty thousand.';
const item = (m, id) => (m?.sections || []).flatMap((s) => s.items).find((it) => it.id === id);
/** The last meeting (minutes read from a file, draft), and one held yesterday with Taylor's notes typed: a vote that approves the last minutes */
async function heldWithNotes({ prevTyped = false } = {}) {
  let prev;
  if (prevTyped) {
    prev = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-100), start: '08:00', end: '10:00', shared: true, attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })), sections: [{ id: 's_old', title: 'Reports', items: [{ id: 'i_cash', title: 'Treasurer’s report' }] }] }), { by: 'test' });
    await saveNotes(env, prev.id, { changes: { 'r:sam-ortiz': 'present', 'n:i_cash': 'Cash is low.' } }, TAYLOR_W);
    await sendNotes(env, prev.id, TAYLOR_W);
    prev = await board.getMeeting(env.DB, prev.id);
  } else {
    prev = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-100), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Q3 minutes.docx', at: new Date().toISOString() }, attendance: [], sections: [{ title: 'New business', items: [{ title: 'Gala' }] }] }), { by: 'test' });
  }
  const m = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), start: '08:00', end: '10:00', shared: true,
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [
      { id: 's_prev', title: 'Approve meeting minutes', items: [{ id: 'i_prev', title: 'Last minutes', live: 'minutes' }] },
      { id: 's_new', title: 'New business', items: [{ id: 'i_budget', title: 'Budget' }] },
    ],
  }), { by: 'test' });
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'r:kim-park': 'excused', 'm:i_prev': { by: 'Sam Ortiz', second: 'Alex Rivera', result: 'passed' }, 'n:i_budget': V1 } }, TAYLOR_W);
  return { prev, m };
}

/**
 * What a meeting's minutes files are, and what the board page opens: every minutes file the meeting names (its rows),
 * whether its bytes are there and whether it says `words` (and never `not`); the board page's list and its "The
 * minutes as written" (minutesFileOf), each opened as Sam opens it
 */
async function filesOf(id, words, not) {
  const rows = await sql("SELECT id, r2_key, kind FROM board_files WHERE owner_type = 'meeting' AND owner_id = ? AND kind = 'minutes'", id);
  const out = [];
  for (const f of rows) {
    const t = files.has(f.r2_key) ? await textOf(files.get(f.r2_key)) : null;
    out.push({ id: f.id, there: t !== null, says: !!t && t.includes(words), stale: !!t && !!not && t.includes(not) });
  }
  const page = (await route(portal, '/api/board-portal', SAM)).body?.meetings?.find((x) => x.id === id) || null;
  const pick = page ? minutesFileOf(page) : null;
  const opened = pick ? await route(boardFile, `/api/board-file?id=${pick.id}`, SAM, { bytes: true }) : null;
  const pickText = opened?.status === 200 ? await textOf(opened.bytes) : '';
  const listed = [];
  for (const f of (page?.files || []).filter((x) => x.kind === 'minutes')) listed.push({ id: f.id, status: (await route(boardFile, `/api/board-file?id=${f.id}`, SAM, { bytes: true })).status });
  return { rows: out, page: !!page, pick: pick ? { id: pick.id, status: opened.status, says: pickText.includes(words), stale: !!not && pickText.includes(not) } : null, listed };
}
/** What's wrong with a meeting's minutes files, given what the minutes now say ('' when nothing is) */
function filesWrong(fl, { on, words }) {
  if (!on) {
    if (fl.rows.length) return `withdrawn minutes leave ${fl.rows.length} minutes file(s)`;
    if (fl.pick) return `the board page opens ${fl.pick.id} as the minutes of withdrawn minutes`;
    return '';
  }
  if (fl.rows.length !== 1) return `the meeting names ${fl.rows.length} minutes files`;
  const bad = fl.rows.find((f) => !f.there || !f.says || f.stale);
  if (bad) return `its minutes file ${bad.id} ${!bad.there ? 'opens to nothing (its bytes are gone)' : `doesn’t say “${words}”`}`;
  if (!fl.pick) return 'the board page opens no minutes';
  if (fl.pick.status !== 200 || !fl.pick.says || fl.pick.stale) return `the board page’s “The minutes as written” opens ${fl.pick.status}${fl.pick.status === 200 ? ' with other words' : ''}`;
  const dead = fl.listed.find((x) => x.status !== 200);
  if (dead) return `the board page lists ${dead.id}, which opens ${dead.status}`;
  return '';
}
/** The heartbeat's tidy of bytes left to go (none before round 12: what a delete left was left) */
const heartbeat = async () => { if (typeof board.finishBytesOff === 'function') await board.finishBytesOff(env); };
/** Every stored byte of a meeting's files is a file's (after the heartbeat takes what was left to go) */
async function looseBytes(id) {
  await heartbeat();
  const named = new Set((await sql('SELECT r2_key FROM board_files')).map((r) => r.r2_key));
  return [...files.keys()].filter((k) => k.startsWith(`board/meeting/${id}/`) && !named.has(k));
}

// ─── F2: Send the minutes, the last send's Word file goes with it ───

/** One of the three sends from a saved state, swept: the meeting's minutes files after each say what the minutes say */
async function sendSweep(name, from, m, prev, { words, other, on, approves }) {
  const observe = async () => {
    const mm = await meetingRow(m.id);
    const p = await meetingRow(prev.id);
    const rec = JSON.parse((await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', m.id))[0]?.sent || 'null');
    return { words: item(mm, 'i_budget')?.notes || '', on: !!mm.minutesFrom?.typed, approved: p.minutes === 'approved', recordAt: rec?.at || '', recordFile: rec?.fileId || '' };
  };
  return sweep(name, from, () => onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id }), async ({ r, before, after, k }) => {
    const landed = after.words !== before.words || after.on !== before.on || after.recordAt !== before.recordAt || after.approved !== before.approved;
    const fl = await filesOf(m.id, after.words || words, after.words === words ? other : words);
    if (k < 0) {
      if (!landed || after.on !== on || (on && after.words !== words) || after.approved !== approves || r.status !== 200) return `the control: ${JSON.stringify(after)} (${r.status})`;
    } else if (landed && (after.on !== on || (on && after.words !== words) || after.approved !== approves)) return `half done: ${JSON.stringify(before)} → ${JSON.stringify(after)}`;
    const wrong = filesWrong(fl, { on: after.on, words: after.words });
    if (wrong) return wrong;
    if (after.recordFile && !fl.rows.some((f) => f.id === after.recordFile)) return 'the send’s record names a file that isn’t the meeting’s';
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return landed ? answeredDone(r) : refused(r);
  }, { observe });
}

test('F2: Send the minutes, the first send, with every statement failing in turn: the notes, the approval, the Word file and the record land together, and the board page opens that file', async () => {
  const { prev, m } = await heldWithNotes();
  report(await sendSweep('first send', saveState(), m, prev, { words: V1, other: V2, on: true, approves: true }));
});

test('F2: Send the minutes again after the notes changed, with every statement failing in turn: the last send’s Word file goes with the send, never two, never one that opens 404', async () => {
  const { prev, m } = await heldWithNotes();
  assert.equal((await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id })).status, 200);
  await saveNotes(env, m.id, { changes: { 'n:i_budget': V2, 'm:i_prev': { by: 'Sam Ortiz', second: 'Alex Rivera', result: 'failed' } } }, TAYLOR_W);
  const out = await sendSweep('second send', saveState(), m, prev, { words: V2, other: V1, on: true, approves: false });
  report(out);
  // (the tester's two: the last file's row read, and its row's delete)
  assert.ok(out.failedSql.some((q) => /^SELECT r2_key, owner_type, owner_id FROM board_files WHERE id = \?/.test(q)), 'the last file’s row read failed in turn');
  assert.ok(out.failedSql.some((q) => /^DELETE FROM board_files WHERE id = \?/.test(q)), 'the last file’s row delete failed in turn');
});

test('F2: the minutes taken back off (every box emptied, then Send), with every statement failing in turn: no minutes file is left, and the board page opens none', async () => {
  const { prev, m } = await heldWithNotes();
  assert.equal((await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id })).status, 200);
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': null, 'r:sam-ortiz': null, 'r:taylor-nguyen': null, 'r:kim-park': null, 'm:i_prev': null, 'n:i_budget': null } }, TAYLOR_W);
  const out = await sendSweep('withdrawing send', saveState(), m, prev, { words: '', other: V1, on: false, approves: false });
  report(out, 20);
  assert.ok(out.failedSql.some((q) => /^SELECT r2_key, owner_type, owner_id FROM board_files WHERE id = \?/.test(q)), 'the last file’s row read failed in turn');
  assert.ok(out.failedSql.some((q) => /^DELETE FROM board_files WHERE id = \?/.test(q)), 'the last file’s row delete failed in turn');
});

test('F2: the tester’s steps: the last file’s row read, or its row’s delete, failing once: the send doesn’t happen and says so; the one file stays and opens with the minutes’ words', async () => {
  const { m } = await heldWithNotes();
  assert.equal((await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id })).status, 200);
  const first = (await sql("SELECT id FROM board_files WHERE owner_type = 'meeting' AND owner_id = ?", m.id)).map((f) => f.id);
  const sentOnce = saveState();
  for (const [what, pick] of [['read', /^SELECT r2_key, owner_type, owner_id FROM board_files WHERE id = \?/], ['delete', /^DELETE FROM board_files WHERE id = \?/]]) {
    for (const withdraw of [false, true]) {
      await restore(sentOnce);
      await saveNotes(env, m.id, { changes: withdraw ? { 'r:alex-rivera': null, 'r:sam-ortiz': null, 'r:taylor-nguyen': null, 'r:kim-park': null, 'm:i_prev': null, 'n:i_budget': null } : { 'n:i_budget': V2 } }, TAYLOR_W);
      fault = { test: (q) => pick.test(q), k: 0, seen: 0, failed: [] };
      const r = await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id });
      const failed = fault.failed.length;
      fault = null;
      const label = `${what} failing, ${withdraw ? 'taken back off' : 'changed'}`;
      assert.equal(failed, 1, `${label}: the step was reached`);
      assert.equal(r.status, 503, `${label}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, NOT_SENT, label);
      const after = await meetingRow(m.id);
      assert.equal(item(after, 'i_budget').notes, V1, `${label}: the minutes as they were`);
      assert.deepEqual((await sql("SELECT id FROM board_files WHERE owner_type = 'meeting' AND owner_id = ?", m.id)).map((f) => f.id), first, `${label}: the one file, as it was`);
      assert.equal(filesWrong(await filesOf(m.id, V1, V2), { on: true, words: V1 }), '', label);
      // Sent again, it goes: the last file off, its bytes too
      const again = await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id });
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.equal(filesWrong(await filesOf(m.id, withdraw ? '' : V2, V1), { on: !withdraw, words: V2 }), '', `${label}, sent again`);
      assert.deepEqual(await looseBytes(m.id), []);
    }
  }
});

// ─── A file's row goes before its bytes ─────────────────────────────

test('F2: deleting a file takes its row off first and its bytes after: a failure at any statement never leaves a row naming bytes that are gone, and bytes whose delete fails are the heartbeat’s', async () => {
  const m = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-3), start: '08:00', end: '10:00', shared: true, attendance: [], sections: [] }), { by: 'test' });
  const f = await board.putFile(env, { ownerType: 'meeting', ownerId: m.id, file: new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'Budget.pdf', { type: 'application/pdf' }), kind: 'financials', by: FOUNDER });
  const from = saveState();
  const observe = async () => ({ row: (await sql('SELECT r2_key FROM board_files WHERE id = ?', f.id))[0]?.r2_key || '', bytes: [...files.keys()] });
  const out = await sweep('deleteFile', from, async () => {
    try { return { status: (await board.deleteFile(env, f.id)) ? 200 : 404, body: {} }; } catch (err) { return { status: 'threw', body: { error: err.message } }; }
  }, async ({ after, r }) => {
    if (after.row && !after.bytes.includes(after.row)) return 'a row naming bytes that are gone';
    if (!after.row && r.status !== 200) return `the row went, and it answered ${r.status}`;
    if (after.row && r.status === 200) return 'it answered deleted, and the row is there';
    await heartbeat();
    if (!after.row && files.size) return 'its bytes are left for good';
    return '';
  }, { observe });
  report(out, 2);
  // The bucket refusing the delete: the row is gone (the file is), and the heartbeat deletes the bytes
  await restore(from);
  deletesFail = 1;
  assert.equal(await board.deleteFile(env, f.id), true);
  assert.equal((await sql('SELECT 1 FROM board_files WHERE id = ?', f.id)).length, 0);
  assert.equal(files.size, 1, 'the bytes left behind');
  assert.equal((await sql("SELECT key FROM board_state WHERE key LIKE 'file-bytes:%'")).length, 1, 'marked to go');
  assert.equal(typeof board.finishBytesOff, 'function', 'the heartbeat takes them');
  assert.equal(await board.finishBytesOff(env), 1);
  assert.equal(files.size, 0);
  assert.equal((await sql("SELECT key FROM board_state WHERE key LIKE 'file-bytes:%'")).length, 0);
});

// ─── F3: a correction and its Word file land together ───────────────

/** Typed minutes sent, and Sam's correction to the budget's line waiting */
async function corrected() {
  const { prev, m } = await heldWithNotes();
  assert.equal((await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id })).status, 200);
  const sug = await onPortal(SAM, { action: 'correction', meetingId: m.id, target: 'n:i_budget', words: V2, was: V1 });
  assert.equal(sug.status, 200, JSON.stringify(sug.body));
  await maybeRunSigning(env).catch(() => {});
  return { prev, m, cid: sug.body.correction.id };
}
const decideObserve = (m, cid) => async () => {
  const mm = await meetingRow(m.id);
  const c = (await sql('SELECT state, decided_by FROM board_minutes_corrections WHERE id = ?', cid))[0];
  const sent = JSON.parse((await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', m.id))[0]?.sent || '{}');
  return {
    words: item(mm, 'i_budget')?.notes || '', kept: sent.notes?.['n:i_budget'] || '', state: c.state, by: c.decided_by || '',
    owed: (await sql('SELECT 1 FROM board_state WHERE key = ?', `notice-due:correction-decided:${cid}`)).length > 0 || mail.some((x) => x.kind === 'board-correction-decided' && x.to.includes(SAM)),
  };
};

test('F3: a correction made with every statement failing in turn: the minutes, the notes’ record, the decision, the notice owed and the Word file all say it, or none does and it waits again, said in words', async () => {
  const { m, cid } = await corrected();
  const out = await sweep('correction made', saveState(), () => route(portal, '/api/board-portal', FOUNDER, { method: 'POST', body: { action: 'correction-decide', id: cid, make: true } }), async ({ r, after, k }) => {
    const made = after.words === V2;
    const fl = await filesOf(m.id, after.words, made ? V1 : V2);
    if (k < 0 && !(made && after.state === 'made' && after.owed && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (made !== (after.kept === V2)) return `the minutes ${made ? 'changed' : 'didn’t change'} and the notes’ record ${after.kept === V2 ? 'did' : 'didn’t'}`;
    const wrong = filesWrong(fl, { on: true, words: after.words });
    if (wrong) return `the minutes say “${after.words}”, and ${wrong}`;
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    if (made) {
      if (after.state !== 'made' || !after.by) return `made, and the correction is “${after.state}”`;
      if (!after.owed) return 'made, and Sam is owed nothing';
      if (r.body?.fileKeeps) return 'made, and it says the file keeps its words';
      return answeredDone(r);
    }
    if (after.state !== 'waiting' || after.by) return `nothing changed, and the correction is “${after.state}”`;
    if (r.status === 503 && r.body?.error !== NOT_DECIDED && !NOTHING.test(said(r)) && said(r) !== SIGN_IN_DOWN) return `nothing changed, and it said “${said(r)}”`;
    return refused(r);
  }, { observe: decideObserve(m, cid) });
  report(out);
});

test('F3: a correction declined with every statement failing in turn: the minutes and their Word file stay as they are, decided whole or waiting again', async () => {
  const { m, cid } = await corrected();
  const out = await sweep('correction declined', saveState(), () => route(portal, '/api/board-portal', FOUNDER, { method: 'POST', body: { action: 'correction-decide', id: cid, make: false, reason: 'Kim left early' } }), async ({ r, after, k }) => {
    if (after.words !== V1 || after.kept !== V1) return `declined, and the minutes say “${after.words}”`;
    const wrong = filesWrong(await filesOf(m.id, V1, V2), { on: true, words: V1 });
    if (wrong) return wrong;
    if (k < 0 && !(after.state === 'declined' && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (after.state === 'declined') return after.by && after.owed ? answeredDone(r) : 'declined with nobody deciding, or nobody told';
    if (after.state !== 'waiting' || after.by) return `the correction is “${after.state}”`;
    return refused(r);
  }, { observe: decideObserve(m, cid) });
  report(out, 10);
});

test('F3: the tester’s steps: the Word file’s rewrite can’t read the check-ins: nothing is made, in words, and it waits; made after, the file says it, and the next meeting approves that file', async () => {
  const { m, cid } = await corrected();
  fault = { test: (q) => /FROM board_checkins WHERE meeting_id/.test(q), k: 0, seen: 0, failed: [] };
  const r = await route(portal, '/api/board-portal', FOUNDER, { method: 'POST', body: { action: 'correction-decide', id: cid, make: true } });
  assert.equal(fault.failed.length, 1);
  fault = null;
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error, NOT_DECIDED);
  const row = await meetingRow(m.id);
  assert.equal(item(row, 'i_budget').notes, V1, 'nothing made');
  assert.equal((await sql('SELECT state FROM board_minutes_corrections WHERE id = ?', cid))[0].state, 'waiting', 'the claim put back');
  assert.equal(filesWrong(await filesOf(m.id, V1, V2), { on: true, words: V1 }), '');
  const again = await route(portal, '/api/board-portal', FOUNDER, { method: 'POST', body: { action: 'correction-decide', id: cid, make: true } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.state, 'made');
  assert.equal(again.body.fileKeeps, undefined, '“Made. The minutes say that now.”, and they do');
  const fileId = (await board.getMeeting(env.DB, m.id)).files.find((f) => f.kind === 'minutes').id;
  assert.equal(filesWrong(await filesOf(m.id, V2, V1), { on: true, words: V2 }), '');
  // The next meeting's vote approves these minutes, as the file that says them
  const next = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(0), start: '08:00', end: '09:00', shared: true, attendance: [], sections: [{ id: 's_n1', title: 'Call to order', items: [{ id: 'i_nmin', title: 'Approve the last meeting’s minutes', live: 'minutes' }] }] }), { by: 'test' });
  await saveNotes(env, next.id, { changes: { 'm:i_nmin': { by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' } } }, TAYLOR_W);
  assert.equal((await onPortal(TAYLOR, { action: 'notes-send', meetingId: next.id })).status, 200);
  const approved = await meetingRow(m.id);
  assert.equal(approved.minutes, 'approved');
  assert.equal(approved.approvedFile, fileId, 'the same file');
  const key = (await sql('SELECT r2_key FROM board_files WHERE id = ?', fileId))[0].r2_key;
  assert.ok((await textOf(files.get(key))).includes(V2), 'approved as the file that says what the minutes say');
});

// ─── F3: approving never approves a file older than the minutes ─────

/** The last meeting's typed minutes with a Word file left behind their words (a Board save whose follow-up didn't go) */
async function staleApproval() {
  const { prev, m } = await heldWithNotes({ prevTyped: true });
  const p = await board.getMeeting(env.DB, prev.id);
  // (a founder's fix in Board, saved, its Word file's follow-up never ran)
  await board.saveMeeting(env.DB, { ...p, sections: p.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_cash' ? { ...it, notes: 'Cash is healthy: 9 months of reserves.' } : it)) })) }, { by: FOUNDER });
  const fileId = p.files.find((f) => f.kind === 'minutes').id;
  const key = (await sql('SELECT r2_key FROM board_files WHERE id = ?', fileId))[0].r2_key;
  assert.match(await textOf(files.get(key)), /Cash is low/, 'the file is behind the minutes');
  return { prev, m, fileId };
}
const approvedFileSays = async (id) => {
  const p = await meetingRow(id);
  if (p.minutes !== 'approved') return { approved: false };
  const row = (await sql('SELECT r2_key FROM board_files WHERE id = ?', p.approvedFile))[0];
  const t = row && files.has(row.r2_key) ? await textOf(files.get(row.r2_key)) : null;
  return { approved: true, file: p.approvedFile, there: t !== null, current: !!t && t.includes('9 months of reserves') && !t.includes('Cash is low') };
};

test('F3: the send whose vote approves the last minutes, with every statement failing in turn: they’re approved as a Word file that says what they say, or not approved and nothing sent, said in words', async () => {
  const { prev, m, fileId } = await staleApproval();
  const observe = async () => ({ words: item(await meetingRow(m.id), 'i_budget')?.notes || '', ...(await approvedFileSays(prev.id)) });
  const out = await sweep('approving send', saveState(), () => onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id }), async ({ r, before, after, k }) => {
    const landed = after.words !== before.words;
    if (k < 0 && !(landed && after.approved && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (landed !== after.approved) return `half done: the notes ${landed ? 'went on' : 'didn’t'}, and the last minutes are ${after.approved ? '' : 'not '}approved`;
    if (after.approved && (after.file !== fileId || !after.there || !after.current)) return `approved as ${after.file}, which ${!after.there ? 'is gone' : 'keeps words corrected since'}`;
    const loose = await looseBytes(prev.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return landed ? answeredDone(r) : refused(r);
  }, { observe });
  report(out);
});

test('F3: Board’s approve brings typed minutes’ Word file up to them first, the same file', async () => {
  const { prev, fileId } = await staleApproval();
  const m = await board.approveMinutes(env, prev.id, { on: inDays(-1), by: FOUNDER, press: true });
  assert.equal(m.minutes, 'approved');
  assert.deepEqual(await approvedFileSays(prev.id), { approved: true, file: fileId, there: true, current: true });
  assert.deepEqual(await looseBytes(prev.id), []);
});

// ─── A3: a no on a meeting's files carries the meeting as the site has it ─

const FILE_STAYS = 'These minutes are approved, so their file stays. Mark them as draft first to change it.';
const onAdmin = (body) => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body });
async function uploadAs(who, path, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method: 'POST', headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com' }, body: form });
  const handler = path.startsWith('/api/board-portal') ? portal : admin;
  const ctx = { request, env, data: {}, waitUntil: (p) => { later.push(p); } };
  ctx.next = async () => handler.onRequestPost(ctx);
  const res = await onRequest(ctx);
  const json = await res.json().catch(() => null);
  await Promise.allSettled(later.splice(0));
  return { status: res.status, body: json };
}
/** A meeting held in June with draft minutes kept as a file, a staff-only file and a founder's private note, then approved in "another tab" */
async function approvedElsewhere() {
  const { minutesDocx } = await import('../public/admin/board-minutes-template.js');
  const m = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-150), start: '08:00', end: '10:00', shared: true, attendance: [], sections: [{ id: 's_a', title: 'Reports', items: [{ id: 'i_a', title: 'Treasurer', staffNote: 'Private: the audit fee is under review' }] }] }), { by: FOUNDER });
  const bytes = minutesDocx(m, { meetings: [], quorum: 0, people: [] });
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const minutes = await board.putFile(env, { ownerType: 'meeting', ownerId: m.id, file: new File([bytes], 'Minutes.docx', { type: DOCX }), kind: 'minutes', by: FOUNDER });
  const other = await board.putFile(env, { ownerType: 'meeting', ownerId: m.id, file: new File([bytes], 'Notes.docx', { type: DOCX }), kind: 'other', by: FOUNDER, staffOnly: true });
  const signed = await board.putFile(env, { ownerType: 'meeting', ownerId: m.id, file: new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'Signed minutes.pdf', { type: 'application/pdf' }), kind: 'signed', by: FOUNDER });
  await raw.prepare('INSERT INTO board_minutes_signed (meeting_id, slug, name, at, how, file_id) VALUES (?, ?, ?, ?, ?, ?)').bind(m.id, 'taylor-nguyen', 'Taylor Nguyen', new Date().toISOString(), 'typed', signed.id).run();
  const draft = await board.getMeeting(env.DB, m.id);
  // (the other tab: marked approved there, so the site has them approved and this page doesn't know)
  const r = await onAdmin({ action: 'save-meeting', base: draft.updatedAt, meeting: { ...draft, minutes: 'approved', approvedOn: inDays(-120) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.meeting.approvedFile, minutes.id);
  return { m, minutes, other, signed, bytes, DOCX };
}
const carries = (r, id, label) => {
  assert.equal(r.status, 409, `${label}: ${JSON.stringify(r.body).slice(0, 200)}`);
  assert.equal(r.body.meeting?.id, id, `${label}: the refusal carries the meeting as the site has it`);
  assert.equal(r.body.meeting.minutes, 'approved', `${label}: approved, as the site has it`);
  assert.equal(r.body.meeting.approvedFile, r.body.meeting.files.find((f) => f.name === 'Minutes.docx')?.id, label);
};

test('A3: every no on a meeting’s files carries the meeting as the site has it: File it under, Delete, a signed copy, the minutes as a file, Read in', async () => {
  const { m, minutes, other, signed, bytes, DOCX } = await approvedElsewhere();
  const refile = await onAdmin({ action: 'update-file', id: minutes.id, kind: 'other' });
  carries(refile, m.id, 'the approved file filed under Other');
  assert.equal(refile.body.error, FILE_STAYS);
  carries(await onAdmin({ action: 'update-file', id: other.id, kind: 'minutes' }), m.id, 'another file filed under Minutes');
  const del = await onAdmin({ action: 'delete-file', id: minutes.id });
  carries(del, m.id, 'the approved file deleted');
  assert.equal(del.body.error, FILE_STAYS);
  carries(await onAdmin({ action: 'delete-file', id: signed.id }), m.id, 'the signed copy deleted');
  carries(await onAdmin({ action: 'read-minutes', id: m.id, fileId: other.id }), m.id, 'another file read in over approved minutes');
  // (Add files as the minutes: kept as an ordinary file, said, with the meeting as the site has it)
  const up = await uploadAs(FOUNDER, '/api/board-admin?upload=1', { file: new File([bytes], 'Minutes v2.docx', { type: DOCX }), ownerType: 'meeting', ownerId: m.id, kind: 'minutes', staffOnly: 'false' });
  assert.equal(up.status, 200, JSON.stringify(up.body).slice(0, 200));
  assert.ok(up.body.asFile, 'kept as an ordinary file, and said');
  assert.equal(up.body.meeting?.minutes, 'approved', 'with the meeting as the site has it');
  // Nothing changed by any of them
  const now = await board.getMeeting(env.DB, m.id);
  assert.deepEqual(now.files.filter((f) => f.kind === 'minutes').map((f) => f.id), [minutes.id]);
  assert.ok(now.files.some((f) => f.id === signed.id));
});

test('A3: typed minutes a tab still shows as a file’s: Read in is refused with the meeting as the site has it', async () => {
  const { m } = await heldWithNotes();
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const f = await board.putFile(env, { ownerType: 'meeting', ownerId: m.id, file: new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])], 'Minutes.docx', { type: DOCX }), kind: 'other', by: FOUNDER });
  assert.equal((await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id })).status, 200);
  const r = await onAdmin({ action: 'read-minutes', id: m.id, fileId: f.id });
  assert.equal(r.status, 409, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.meeting?.id, m.id, 'the refusal carries the meeting');
  assert.equal(r.body.meeting.minutesFrom?.typed, true, 'typed, as the site has it');
});

test('A3: the secretary’s minutes refused over approved ones carry no meeting as Board keeps it (its private notes, its staff-only files)', async () => {
  const { m, bytes, DOCX } = await approvedElsewhere();
  const r = await uploadAs(TAYLOR, `/api/board-portal?minutes=${m.id}`, { file: new File([bytes], 'Our minutes.docx', { type: DOCX }) });
  assert.equal(r.status, 409, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.meeting, undefined, 'no meeting in a board member’s answer');
  assert.doesNotMatch(JSON.stringify(r.body), /audit fee|Notes\.docx/, 'nothing only the founders see');
});

// ─── A4: a meeting file and its place on its item, in one write ─────

const PDF = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], 'Budget detail.pdf', { type: 'application/pdf' });
/** A meeting's files and its items' documents, as stored: each named file there and stored once, its bytes there */
async function placesOf(table, ownerType, id, itemId, name) {
  const row = (await sql(`SELECT data FROM ${table} WHERE id = ?`, id))[0];
  const m = row ? JSON.parse(row.data) : null;
  const docs = (m?.sections || []).flatMap((x) => x.items).flatMap((it) => (it.docs || []).map((d) => [it.id, d]));
  const rows = await sql('SELECT id, r2_key, name FROM board_files WHERE owner_type = ? AND owner_id = ?', ownerType, id);
  const named = rows.filter((f) => f.name === name);
  return {
    rows, named, onItem: docs.filter(([it]) => it === itemId).map(([, d]) => d),
    dangling: docs.filter(([, d]) => !rows.some((f) => f.id === d)).map(([, d]) => d),
    noBytes: rows.filter((f) => !files.has(f.r2_key)).map((f) => f.id),
  };
}
/** What's wrong with where a meeting's file is ('' when nothing is) */
function placesWrong(p) {
  if (p.dangling.length) return `an item names ${p.dangling.join(', ')}, which isn’t there`;
  if (p.noBytes.length) return `${p.noBytes.join(', ')} opens to nothing`;
  if (p.named.length > 1) return `kept ${p.named.length} times`;
  return '';
}

/** One file step, swept, then pressed again cleanly after each one that didn't land */
async function fileSweep(name, from, { press, again, table, ownerType, id, itemId, fileName, landedIf, after }) {
  return sweep(name, from, press, async ({ r, k }) => {
    const p = await placesOf(table, ownerType, id, itemId, fileName);
    const wrong = placesWrong(p);
    if (wrong) return wrong;
    const landed = landedIf(p);
    if (landed === null) return `half done: ${JSON.stringify({ rows: p.named.map((f) => f.id), onItem: p.onItem })}`;
    if (k < 0 && !landed) return `the control didn’t land (${r.status} ${JSON.stringify(r.body).slice(0, 120)})`;
    await heartbeat();
    const loose = [...files.keys()].filter((key) => key.startsWith(`board/${ownerType}/${id}/`) && !p.rows.some((f) => f.r2_key === key));
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    const said = landed ? answeredDone(r) : refused(r);
    if (said) return said;
    if (landed) return '';
    // Pressed again, as a person would: it goes, once
    const r2 = await again();
    const p2 = await placesOf(table, ownerType, id, itemId, fileName);
    if (r2.status !== 200) return `pressed again, it answered ${r2.status} “${said2(r2)}”`;
    return placesWrong(p2) || (after(p2) ? '' : `pressed again: ${JSON.stringify({ rows: p2.named.map((f) => f.id), onItem: p2.onItem })}`);
  }, { observe: async () => ({}) });
}
const said2 = (r) => `${r.body?.error || ''}`;

// Board: a presenter's upload onto their item (the board page), and its delete from Board (Every file → Delete) and the
// presenter's own take-off (the board page)
const SAM_W = { slug: 'sam-ortiz', name: 'Sam Ortiz', email: SAM };
async function boardWithItem() {
  return board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), start: '08:00', end: '10:00', shared: true, attendance: [],
    sections: [{ id: 's_r', title: 'Reports', items: [{ id: 'i_fin', title: 'Treasurer’s report', who: ['sam-ortiz'] }, { id: 'i_other', title: 'Gala' }] }],
  }), { by: FOUNDER });
}
const attach = (who, mid, itemId) => uploadAs(who, `/api/board-portal?attach=${mid}&item=${itemId}`, { file: PDF() });

test('A4: Board, a presenter’s upload onto their item with every statement failing in turn: its row and its place on the item land together or not at all, never twice, and pressing again keeps it once', async () => {
  const m = await boardWithItem();
  const press = () => attach(SAM, m.id, 'i_fin');
  const out = await fileSweep('board upload', saveState(), { press, again: press, table: 'board_meetings', ownerType: 'meeting', id: m.id, itemId: 'i_fin', fileName: 'Budget detail.pdf',
    landedIf: (p) => (p.named.length === 1 && p.onItem.includes(p.named[0].id) ? true : p.named.length === 0 ? false : null),
    after: (p) => p.named.length === 1 && p.onItem.includes(p.named[0].id) });
  report(out, 15);
});

test('A4: Board, a file on an item deleted (Every file → Delete) with every statement failing in turn: its row and its place on the item go together, its bytes after; pressing again never says it’s gone while the item names it', async () => {
  const m = await boardWithItem();
  const up = await attach(SAM, m.id, 'i_fin');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const fid = up.body.file.id;
  const press = () => onAdmin({ action: 'delete-file', id: fid });
  const out = await fileSweep('board delete', saveState(), { press, again: press, table: 'board_meetings', ownerType: 'meeting', id: m.id, itemId: 'i_fin', fileName: 'Budget detail.pdf',
    landedIf: (p) => (p.named.length === 0 && !p.onItem.includes(fid) ? true : p.named.length === 1 && p.onItem.includes(fid) ? false : null),
    after: (p) => p.named.length === 0 && !p.onItem.includes(fid) });
  report(out, 10);
});

test('A4: Board, the presenter takes their own document off their item with every statement failing in turn: off the item and gone together, or still on it', async () => {
  const m = await boardWithItem();
  const up = await attach(SAM, m.id, 'i_fin');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const fid = up.body.file.id;
  const press = () => onPortal(SAM, { action: 'detach', meetingId: m.id, itemId: 'i_fin', fileId: fid });
  const out = await fileSweep('board take-off', saveState(), { press, again: press, table: 'board_meetings', ownerType: 'meeting', id: m.id, itemId: 'i_fin', fileName: 'Budget detail.pdf',
    landedIf: (p) => (p.named.length === 0 && !p.onItem.includes(fid) ? true : p.named.length === 1 && p.onItem.includes(fid) ? false : null),
    after: (p) => p.named.length === 0 && !p.onItem.includes(fid) });
  report(out, 10);
});

// The Advisory Board: the same file code, its own meetings
const RUNS = { runs: true };
const advisory = async (action, { body = {}, form = null } = {}) => {
  const res = await meetingAction({ env, request: null, waitUntil: () => {} }, { action, body, form, by: FOUNDER, w: RUNS });
  return { status: res.status, body: await res.json() };
};
async function advisoryWithItem() {
  const { meeting } = await createAdvisoryMeeting(env, { date: inDays(20), by: FOUNDER });
  const itemId = meeting.sections.flatMap((x) => x.items)[0].id;
  return { meeting, itemId };
}
const advisoryUpload = (mid, itemId) => { const form = new FormData(); form.set('meetingId', mid); form.set('file', PDF()); form.set('itemId', itemId); form.set('kind', 'other'); return advisory('upload', { form }); };

test('A4: the Advisory Board, an upload onto an item with every statement failing in turn: its row and its place land together or not at all, never twice', async () => {
  const { meeting, itemId } = await advisoryWithItem();
  const press = () => advisoryUpload(meeting.id, itemId);
  const out = await fileSweep('advisory upload', saveState(), { press, again: press, table: 'advisory_meetings', ownerType: 'advisory-meeting', id: meeting.id, itemId, fileName: 'Budget detail.pdf',
    landedIf: (p) => (p.named.length === 1 && p.onItem.includes(p.named[0].id) ? true : p.named.length === 0 ? false : null),
    after: (p) => p.named.length === 1 && p.onItem.includes(p.named[0].id) });
  report(out, 5);
});

test('A4: the Advisory Board, a file on an item deleted with every statement failing in turn: its row and its place go together; pressing again never says it’s gone while the item names it', async () => {
  const { meeting, itemId } = await advisoryWithItem();
  const up = await advisoryUpload(meeting.id, itemId);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const fid = up.body.file.id;
  const press = () => advisory('delete-meeting-file', { body: { fileId: fid } });
  const out = await fileSweep('advisory delete', saveState(), { press, again: press, table: 'advisory_meetings', ownerType: 'advisory-meeting', id: meeting.id, itemId, fileName: 'Budget detail.pdf',
    landedIf: (p) => (p.named.length === 0 && !p.onItem.includes(fid) ? true : p.named.length === 1 && p.onItem.includes(fid) ? false : null),
    after: (p) => p.named.length === 0 && !p.onItem.includes(fid) });
  report(out, 5);
});
