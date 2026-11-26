/**
 * Board QA round 13 (Nov 24 2026), the admin tester's findings 1 to 4.
 *   A1  There is one way minutes are approved, and every route uses it: Board's approve, the secretary's approving send,
 *       and the editor's Mark them approved (a save with minutes: 'approved'). It brings typed minutes' Word file up to
 *       what they say in the same step, or refuses in words with nothing changed. More generally a save that changes the
 *       minutes' words carries their Word file in its own one write (the new bytes put first, under a key of their own),
 *       never a follow-up that fails quietly; and anything that still leaves a file behind, the heartbeat brings up
 *   A2  An upload carries the page's own id for the file it chose: sent again (its answer lost), it's the file already
 *       kept, on its item, never a second copy; Board's item upload and the presenter's own
 *   A3  The secretary's next Send replaces only a Word file that's still the last send's: one a founder has filed under
 *       Other, put on an item or renamed stays theirs. A file is taken off one way (takeFileOff): its row, its bytes and
 *       every item that names it, in one write; nothing can name a file that's gone
 *   A4  The meeting page's status line goes by the one fact the minutes card goes by (minutesIn)
 * The sweeps are the testers' (lib12/lib13 sweepAll): the same press from the same saved state, cleanly, then with each
 * statement it makes (reads, writes, batches) failing once in turn, then each write landing with its answer lost on the
 * way back, then the file store's put failing; after each, what the database and the file store hold is whole, and the
 * answer's words say what happened.
 * Made-up people only (the repo is public). Run: node --test tests/board-round13-admin.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as portal from '../functions/api/board-portal.js';
import * as admin from '../functions/api/board-admin.js';
import * as boardFile from '../functions/api/board-file.js';
import * as board from '../functions/api/_board.js';
import * as notesApi from '../functions/api/_board-notes.js';
import { saveNotes } from '../functions/api/_board-notes.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import * as shared from '../public/admin/board-shared.js';
import * as editor from '../public/admin/board-meeting.js';

const { cleanMeeting, todayEastern, minutesFileOf, docxText, minutesIn } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const KIM = 'kim.board@example.com';
// The words decided (written out, so a run on the code before them fails on what it says, never on an import)
const NOT_APPROVED = 'We couldn’t approve the minutes just now, so nothing was changed. Please try again in a moment.';
const NOT_SAVED = 'We couldn’t save that just now, so nothing was changed. Please try again in a moment.';
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

// ─── The database and the file store not answering, once ────────────
// `fail`: the k-th statement the press makes (one in a batch too, which then fails whole, as D1's does) fails before it
// runs. `lose`: the k-th write (a write statement, or a batch) lands, and its answer is lost on the way back. `put`: the
// file store's k-th put fails
let raw;
let fault = null; // { mode, k, seen, failed }
const isWrite = (sql) => !/^\s*SELECT\b/i.test(String(sql || ''));
function hit(sql, write) {
  if (!fault || fault.mode === 'put' || (fault.mode === 'lose' && !write)) return false;
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
let puts = 0;
let mail = [];
let later = [];
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
  raw = await createD1();
  files.clear();
  puts = 0;
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test',
    FILES: {
      get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length, httpMetadata: {} } : null),
      put: async (k, v) => {
        puts += 1;
        if (fault?.mode === 'put' && fault.seen++ === fault.k) { fault.failed.push(`put ${k}`); throw new Error('R2: we encountered an internal error'); }
        files.set(k, new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : v instanceof Uint8Array ? v : await new Response(v).arrayBuffer()));
      },
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
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

/** A route behind the real sign-in middleware, as `who`; what it left running is finished before it answers here */
async function route(handler, path, who, { method = 'GET', body = null, form = null, bytes = false } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined),
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
const meetingRow = async (id) => { const r = (await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0]; return r ? JSON.parse(r.data) : null; };
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''}`.trim();
const textOf = async (bytes) => { try { return await docxText(bytes); } catch { return ''; } };
const PDF = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x45, 0x4f, 0x46]);

// ─── Saved states, and the sweep ────────────────────────────────────

const saveState = () => ({ bytes: raw._db.export(), files: new Map(files) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  later = [];
}
/**
 * The press from `from`: cleanly (the control), then in each mode (`fail`, `lose`, `put`) with its k-th statement (or put)
 * going wrong once, k = 0, 1, … until none is left. `judge({ mode, k, r, failed, before, after, control })` → '' or
 * what's wrong. `then`: a press after it (a press again), whose answer goes to the judge as `again`
 */
async function sweep(name, from, press, judge, { observe, modes = ['fail', 'lose', 'put'], then = null, max = 400 }) {
  const problems = [];
  const failedSql = [];
  let control = null;
  let runs = 0;
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
      const again = then ? await then().catch((err) => ({ status: 'threw', body: { error: String(err?.message || err) } })) : null;
      const after = await observe();
      if (!mode) control = { r, before, after, again };
      const why = await judge({ mode, k, r, failed, before, after, control, again });
      if (why) problems.push(`${name} ${mode || 'control'} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90)}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 220)}: ${why}`);
      runs += 1;
      if (failed) failedSql.push(failed);
    }
  }
  return { problems, runs, failedSql };
}
const report = (out, least = 20) => {
  console.log(`# swept: ${out.runs} runs, ${out.problems.length} wrong`);
  assert.deepEqual(out.problems, [], `${out.problems.length} of ${out.runs} runs:\n${out.problems.join('\n')}`);
  assert.ok(out.runs > least, `swept every statement (${out.runs})`);
};
/** A refusal that says nothing was done, in `words` (or the sign-in's, the setup's, People's): never "something went wrong" */
function refused(r, words = null) {
  if (typeof r.status !== 'number' || r.status < 400) return `nothing landed, and it answered ${r.status}`;
  if (r.body?.ok !== false && r.body?.success !== false) return 'nothing landed, and it didn’t say no';
  const w = said(r);
  if ([SIGN_IN_DOWN, SETUP_DOWN].includes(w) || (r.status === 503 && /People just now, so nothing was changed/.test(w))) return '';
  if (words && w !== words) return `nothing landed, and it said “${w}”, not “${words}”`;
  if (!words && (r.status === 500 || /Something went wrong/i.test(w) || !NOTHING.test(w))) return `nothing landed, and it said “${w}”`;
  return '';
}
/** Done: answered as done, never in a refusal's words */
const answeredDone = (r) => (r.status === 200 && r.body?.ok !== false && !NOTHING.test(said(r)) ? '' : `it landed, and it answered ${r.status} “${said(r)}”`);
/** The heartbeat's two file steps: bytes left to go, and a minutes' Word file behind its minutes */
const heartbeat = async () => {
  if (typeof notesApi.maybeBringUpMinutesFiles === 'function') await notesApi.maybeBringUpMinutesFiles(env);
  await board.finishBytesOff(env);
};
/** Bytes no file row names, left after the heartbeat */
async function looseBytes(id) {
  await board.finishBytesOff(env);
  const named = new Set((await sql('SELECT r2_key FROM board_files')).map((r) => r.r2_key));
  return [...files.keys()].filter((k) => k.startsWith(`board/meeting/${id}/`) && !named.has(k));
}

// ─── The meeting ────────────────────────────────────────────────────

const V1 = 'Budget passed at forty thousand.';
const V2 = 'Budget passed at fifty thousand.';
const item = (m, id) => (m?.sections || []).flatMap((s) => s.items).find((it) => it.id === id);
/** The Dec 3 meeting moved to yesterday: Taylor's typed notes sent, the Word file the send kept saying "forty thousand" */
async function heldSent() {
  const m = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), start: '08:00', end: '10:00', shared: true,
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [
      { id: 's_fin', title: 'Finance', items: [{ id: 'i_ytd', title: 'Year to date' }, { id: 'i_budget', title: 'The 2027 budget' }] },
    ],
  }), { by: 'test' });
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'n:i_budget': V1 } }, TAYLOR_W);
  const sent = await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const now = await board.getMeeting(env.DB, m.id);
  const file = now.files.find((f) => f.kind === 'minutes');
  assert.ok(file, 'the send kept a Word file');
  return { m: now, fileId: file.id };
}
/**
 * The meeting's minutes files and what the board page opens: every minutes file (its bytes there, saying `words`, never
 * `not`), and Alex's "The minutes as written", opened as Alex opens it
 */
async function filesOf(id, words, not) {
  const rows = await sql("SELECT id, r2_key FROM board_files WHERE owner_type = 'meeting' AND owner_id = ? AND kind = 'minutes'", id);
  const out = [];
  for (const f of rows) {
    const t = files.has(f.r2_key) ? await textOf(files.get(f.r2_key)) : null;
    out.push({ id: f.id, there: t !== null, says: !!t && t.includes(words), stale: !!t && !!not && t.includes(not) });
  }
  const page = (await route(portal, '/api/board-portal', ALEX)).body?.meetings?.find((x) => x.id === id) || null;
  const pick = page ? minutesFileOf(page) : null;
  const opened = pick ? await route(boardFile, `/api/board-file?id=${pick.id}`, ALEX, { bytes: true }) : null;
  const pickText = opened?.status === 200 ? await textOf(opened.bytes) : '';
  return { rows: out, pick: pick ? { id: pick.id, status: opened.status, says: pickText.includes(words), stale: !!not && pickText.includes(not) } : null };
}
function filesWrong(fl, words) {
  if (fl.rows.length !== 1) return `the meeting names ${fl.rows.length} minutes files`;
  const bad = fl.rows.find((f) => !f.there || !f.says || f.stale);
  if (bad) return `its minutes file ${!bad.there ? 'opens to nothing' : `doesn’t say “${words}”`}`;
  if (!fl.pick) return 'the board page opens no minutes';
  if (fl.pick.status !== 200 || !fl.pick.says || fl.pick.stale) return `the board page’s “The minutes as written” opens ${fl.pick.status}${fl.pick.status === 200 ? ` without “${words}”` : ''}`;
  return '';
}
/** What the minutes say and whether they're approved, as the site has them */
const minutesNow = (id) => async () => {
  const row = await meetingRow(id);
  return { words: item(row, 'i_budget')?.notes || '', approved: row.minutes === 'approved', approvedFile: row.approvedFile || '' };
};

// ─── A1: Mark them approved, with the line corrected in the same save ──

test('A1: Mark them approved with the budget line corrected in the same save, every statement failing in turn, every write landing with its answer lost, the file store’s put failing: approved as a Word file that says what they say, or refused in the approval’s words, nothing changed', async () => {
  const { m, fileId } = await heldSent();
  const mine = { ...m, minutes: 'approved', approvedOn: inDays(0), sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: V2 } : it)) })) };
  const out = await sweep('Mark them approved', saveState(), () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, after }) => {
    const landed = after.words === V2 || after.approved;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (landed && !(after.words === V2 && after.approved)) return `half done: ${JSON.stringify(after)}`;
    const wrong = filesWrong(await filesOf(m.id, landed ? V2 : V1, landed ? V1 : V2), landed ? V2 : V1);
    if (wrong) return `the minutes say “${after.words}”${after.approved ? ', approved,' : ''} and ${wrong}`;
    if (after.approved && after.approvedFile !== fileId) return `approved as ${after.approvedFile || 'no file'}, not their Word file`;
    await heartbeat();
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return landed ? answeredDone(r) : refused(r, NOT_APPROVED);
  }, { observe: minutesNow(m.id) });
  report(out);
  // (the tester's two: the file store's put, and the file's one write)
  assert.ok(out.failedSql.some((q) => /^put board\/meeting\//.test(q)), 'the Word file’s put failed in turn');
  assert.ok(out.failedSql.some((q) => /^UPDATE board_files SET r2_key/.test(q)), 'the Word file’s row move failed in turn');
});

test('A1: the tester’s blip: the file store’s put failing once as the line is changed and Mark them approved pressed at once: refused in words, nothing approved; pressed again, approved as the file that says “fifty thousand”', async () => {
  const { m, fileId } = await heldSent();
  const mine = { ...m, minutes: 'approved', approvedOn: inDays(0), sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: V2 } : it)) })) };
  fault = { mode: 'put', k: 0, seen: 0, failed: [] };
  const r = await onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt });
  assert.equal(fault.failed.length, 1, 'the put was reached');
  fault = null;
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error, NOT_APPROVED);
  assert.deepEqual(await minutesNow(m.id)(), { words: V1, approved: false, approvedFile: '' });
  assert.equal(filesWrong(await filesOf(m.id, V1, V2), V1), '');
  const again = await onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.meeting.minutes, 'approved');
  assert.equal(again.body.meeting.approvedFile, fileId);
  assert.equal(filesWrong(await filesOf(m.id, V2, V1), V2), '');
  assert.deepEqual(await looseBytes(m.id), []);
});

test('A1: a fix to typed draft minutes’ words in Board, every statement failing in turn, every write landing with its answer lost, the put failing: the minutes and their Word file change together, or neither does', async () => {
  const { m } = await heldSent();
  const mine = { ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: V2 } : it)) })) };
  const out = await sweep('draft fix', saveState(), () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, after, failed }) => {
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (after.approved) return 'approved by a draft fix';
    const wrong = filesWrong(await filesOf(m.id, landed ? V2 : V1, landed ? V1 : V2), landed ? V2 : V1);
    if (wrong) return `the minutes say “${after.words}”, and ${wrong}`;
    await heartbeat();
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    if (landed) return answeredDone(r);
    // (the Word file's own step: its reads, its put, the one write: said in the save's words. A read before it is the
    // save's own refusal, in whatever words the site gives a save that didn't land: never one that says it saved)
    if (/^put |^(lost: )?(batch: )?UPDATE board_meetings SET date|FROM board_minutes_notes|FROM board_checkins|r2_key, type, name|^(lost: )?UPDATE board_files/.test(failed)) return refused(r, NOT_SAVED);
    return typeof r.status === 'number' && r.status >= 400 && r.body?.ok === false ? '' : `nothing landed, and it answered ${r.status}`;
  }, { observe: minutesNow(m.id) });
  report(out);
});

test('A1: Board’s approve after a fix saved without its Word file (a write that didn’t carry it), every statement failing in turn, every write landing with its answer lost, the put failing: approved as the file brought up, or refused in the approval’s words', async () => {
  const { m, fileId } = await heldSent();
  // (a write that didn't carry the file: the server's own, with no file store)
  await board.saveMeeting(env.DB, { ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: V2 } : it)) })) }, { by: FOUNDER });
  assert.equal(filesWrong(await filesOf(m.id, V1, V2), V1), '', 'the file is behind the minutes');
  const out = await sweep('approve-minutes', saveState(), () => onAdmin({ action: 'approve-minutes', id: m.id, on: inDays(0) }), async ({ mode, r, after }) => {
    if (!mode && !(after.approved && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (after.approved) {
      const wrong = filesWrong(await filesOf(m.id, V2, V1), V2);
      if (wrong) return `approved, and ${wrong}`;
      if (after.approvedFile !== fileId) return `approved as ${after.approvedFile || 'no file'}`;
    }
    await heartbeat();
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return after.approved ? answeredDone(r) : refused(r, NOT_APPROVED);
  }, { observe: minutesNow(m.id) });
  report(out);
});

test('A1: anything that still leaves the Word file behind its minutes, the heartbeat brings up: the same file, saying what they say; one that says it already isn’t put again', async () => {
  const { m, fileId } = await heldSent();
  assert.equal(typeof notesApi.maybeBringUpMinutesFiles, 'function', 'the heartbeat has a step for it');
  const sentPuts = puts;
  assert.equal(await notesApi.maybeBringUpMinutesFiles(env), 0, 'a file just sent says what its minutes say: nothing to bring up');
  assert.equal(puts, sentPuts);
  await board.saveMeeting(env.DB, { ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: V2 } : it)) })) }, { by: FOUNDER });
  assert.equal(filesWrong(await filesOf(m.id, V1, V2), V1), '', 'behind');
  await board.maybeRunBoard(env);
  assert.equal(filesWrong(await filesOf(m.id, V2, V1), V2), '', 'brought up by the heartbeat');
  assert.deepEqual((await board.getMeeting(env.DB, m.id)).files.filter((f) => f.kind === 'minutes').map((f) => f.id), [fileId], 'the same file');
  const was = puts;
  assert.equal(await notesApi.maybeBringUpMinutesFiles(env), 0, 'nothing more to bring up');
  assert.equal(puts, was, 'a file that says it already isn’t put again');
  assert.deepEqual(await looseBytes(m.id), []);
});

test('A1: the approving send and Send the minutes again, every write landing with its answer lost: said as sent, and the Word files are whole (a step that landed is never taken back)', async () => {
  const { m } = await heldSent();
  await saveNotes(env, m.id, { changes: { 'n:i_budget': V2 } }, TAYLOR_W);
  const out = await sweep('send again', saveState(), () => onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id }), async ({ mode, r, after }) => {
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    const wrong = filesWrong(await filesOf(m.id, landed ? V2 : V1, landed ? V1 : V2), landed ? V2 : V1);
    if (wrong) return `the minutes say “${after.words}”, and ${wrong}`;
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return landed ? answeredDone(r) : refused(r);
  }, { observe: minutesNow(m.id), modes: ['lose', 'put'] });
  report(out, 5);
});

// ─── A2: an upload sent again is the file already kept ──────────────

const upload = (meetingId, fileId, { forItem = true, name = 'Statement.pdf' } = {}) => {
  const form = new FormData();
  form.set('file', new File([PDF()], name, { type: 'application/pdf' }));
  form.set('ownerType', 'meeting'); form.set('ownerId', meetingId); form.set('kind', 'financials'); form.set('staffOnly', 'false');
  if (forItem) form.set('forItem', 'true');
  if (fileId) form.set('fileId', fileId);
  return route(admin, '/api/board-admin?upload=1', FOUNDER, { method: 'POST', form });
};
const attach = (who, meetingId, itemId, fileId) => {
  const form = new FormData();
  form.set('file', new File([PDF()], 'Statement.pdf', { type: 'application/pdf' }));
  if (fileId) form.set('fileId', fileId);
  return route(portal, `/api/board-portal?attach=${meetingId}&item=${itemId}`, who, { method: 'POST', form });
};
/** The Dec 3 meeting, ahead and on the board page, Sam presenting Year to date */
async function ahead() {
  return board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(9), start: '08:00', end: '10:00', shared: true, attendance: [],
    sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_ytd', title: 'Year to date', who: ['sam-ortiz'] }, { id: 'i_budget', title: 'The 2027 budget' }] }],
  }), { by: 'test' });
}
const statements = async (id) => (await sql("SELECT id, r2_key FROM board_files WHERE owner_type = 'meeting' AND owner_id = ? AND name = 'Statement.pdf'", id));

test('A2: Board’s item upload sent twice under the page’s id for the file: the file once, the second answer the file already kept; a new choice (a new id) is a new file', async () => {
  const m = await ahead();
  const a = await upload(m.id, 'f_page0001');
  const b = await upload(m.id, 'f_page0001');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(a.body.file.id, 'f_page0001');
  assert.equal(b.body.file.id, 'f_page0001', 'the file already kept');
  assert.equal((await statements(m.id)).length, 1, 'never a second copy');
  // Both at once (the press and its look's send, crossing): once
  const [c, d] = await Promise.all([upload(m.id, 'f_page0002'), upload(m.id, 'f_page0002')]);
  assert.deepEqual([c.status, d.status, c.body.file.id, d.body.file.id], [200, 200, 'f_page0002', 'f_page0002']);
  assert.equal((await statements(m.id)).length, 2);
  // Chosen again on purpose: a new id, a new file
  const e = await upload(m.id, 'f_page0003');
  assert.equal(e.body.file.id, 'f_page0003');
  assert.equal((await statements(m.id)).length, 3);
  assert.deepEqual(await looseBytes(m.id), []);
  // An id that's another meeting's file is never this upload's: a new file, the other untouched
  const other = await ahead();
  const f = await upload(other.id, 'f_page0001');
  assert.equal(f.status, 200);
  assert.notEqual(f.body.file.id, 'f_page0001');
  assert.equal((await sql('SELECT owner_id FROM board_files WHERE id = ?', 'f_page0001'))[0].owner_id, m.id);
});

test('A2: Board’s item upload with every statement failing in turn, every write landing with its answer lost, the put failing, then sent again under the same id as the page does: the file once, said as kept', async () => {
  const m = await ahead();
  const id = 'f_pageswp1';
  const observe = async () => ({ rows: (await statements(m.id)).length });
  const out = await sweep('item upload', saveState(), () => upload(m.id, id), async ({ mode, r, after, again }) => {
    if (!mode && !(r.status === 200 && after.rows === 1)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (after.rows !== 1) return `${after.rows} copies after it was sent again`;
    if (again.status !== 200 || again.body?.file?.id !== id) return `sent again: ${again.status} ${JSON.stringify(again.body).slice(0, 160)}`;
    const row = (await sql('SELECT r2_key FROM board_files WHERE id = ?', id))[0];
    if (!row || !files.has(row.r2_key)) return 'the file kept opens to nothing';
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    // (the first answer: the file, or a refusal in words that nothing was changed)
    if (r.status === 200) return r.body?.file?.id === id ? '' : `answered with ${r.body?.file?.id}`;
    return refused(r);
  }, { observe, then: () => upload(m.id, id) });
  report(out, 10);
});

test('A2: the presenter’s own upload on the board page, sent twice under the page’s id, and with every statement failing, every write landing lost, the put failing, then sent again: the file once, on the item once', async () => {
  const m = await ahead();
  const a = await attach(SAM, m.id, 'i_ytd', 'f_sampage1');
  const b = await attach(SAM, m.id, 'i_ytd', 'f_sampage1');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual([a.body.file.id, b.body.file.id, b.body.docs], ['f_sampage1', 'f_sampage1', ['f_sampage1']]);
  assert.equal((await statements(m.id)).length, 1);
  assert.deepEqual(item(await board.getMeeting(env.DB, m.id), 'i_ytd').docs, ['f_sampage1']);
  // Another member's id isn't Sam's upload: never put on Sam's item as theirs
  const id = 'f_sampage2';
  const observe = async () => ({ rows: (await statements(m.id)).length, docs: item(await board.getMeeting(env.DB, m.id), 'i_ytd').docs });
  const out = await sweep('presenter upload', saveState(), () => attach(SAM, m.id, 'i_ytd', id), async ({ mode, r, after, again }) => {
    if (!mode && !(r.status === 200 && after.rows === 2)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (after.rows !== 2) return `${after.rows - 1} copies after it was sent again`;
    if (JSON.stringify(after.docs) !== JSON.stringify(['f_sampage1', id])) return `the item has ${JSON.stringify(after.docs)}`;
    if (again.status !== 200 || again.body?.file?.id !== id) return `sent again: ${again.status} ${JSON.stringify(again.body).slice(0, 160)}`;
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    if (r.status === 200) return r.body?.file?.id === id ? '' : `answered with ${r.body?.file?.id}`;
    return refused(r);
  }, { observe, then: () => attach(SAM, m.id, 'i_ytd', id) });
  report(out, 10);
});

// ─── A3: the secretary's next send and a file Board has made its own ──

/** Held, Taylor's notes sent, and the line changed for a second send */
async function sentThenChanged() {
  const { m, fileId } = await heldSent();
  await saveNotes(env, m.id, { changes: { 'n:i_budget': V2 } }, TAYLOR_W);
  return { m, fileId };
}
const saveAs = async (m, change) => {
  const r = await onAdmin({ action: 'save-meeting', meeting: change(m), base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
};
/** Whether an item names a file the meeting doesn't have, and the founder's file's row, bytes and what it says */
async function after3(id, fileId) {
  const m = await board.getMeeting(env.DB, id);
  const has = new Set(m.files.map((f) => f.id));
  const dangling = m.sections.flatMap((s) => s.items).flatMap((it) => (it.docs || []).filter((d) => !has.has(d)));
  const row = (await sql('SELECT kind, name, r2_key FROM board_files WHERE id = ?', fileId))[0] || null;
  const opened = row ? await route(boardFile, `/api/board-file?id=${fileId}`, FOUNDER, { bytes: true }) : null;
  return { m, dangling, row, opens: opened?.status === 200 };
}

for (const [how, change] of [
  ['filed under Other', async (m, fileId) => { const r = await onAdmin({ action: 'update-file', id: fileId, kind: 'other' }); assert.equal(r.status, 200, JSON.stringify(r.body)); }],
  ['put on 2.2 The 2027 budget', async (m, fileId) => { await saveAs(m, (x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, docs: [fileId] } : it)) })) })); }],
  ['renamed', async (m, fileId) => { const r = await onAdmin({ action: 'update-file', id: fileId, name: 'Our Q4 minutes, for the auditor.docx' }); assert.equal(r.status, 200, JSON.stringify(r.body)); }],
]) {
  test(`A3: the last send’s Word file ${how} by a founder: the secretary’s next Send keeps it, theirs, and no item names a file that’s gone; the new minutes file says the new words`, async () => {
    const { m, fileId } = await sentThenChanged();
    await change(await board.getMeeting(env.DB, m.id), fileId);
    const before = (await sql('SELECT kind, name, r2_key FROM board_files WHERE id = ?', fileId))[0];
    const r = await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const a = await after3(m.id, fileId);
    assert.deepEqual(a.row, before, 'the founder’s file, as they left it');
    assert.ok(a.opens, 'and it opens');
    assert.deepEqual(a.dangling, [], 'no item names a file that’s gone');
    if (how.startsWith('put on')) assert.deepEqual(item(a.m, 'i_budget').docs, [fileId], 'still on its item');
    const sentFile = JSON.parse((await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', m.id))[0].sent).fileId;
    assert.notEqual(sentFile, fileId);
    const key = (await sql('SELECT r2_key FROM board_files WHERE id = ?', sentFile))[0].r2_key;
    assert.ok((await textOf(files.get(key))).includes(V2), 'the new minutes file says the new words');
    assert.deepEqual(await looseBytes(m.id), []);
  });
}

test('A3: the last send’s Word file left as the send made it: the next Send replaces it (one minutes file, the new words, the old bytes gone)', async () => {
  const { m, fileId } = await sentThenChanged();
  const old = (await sql('SELECT r2_key FROM board_files WHERE id = ?', fileId))[0].r2_key;
  const r = await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await sql('SELECT 1 FROM board_files WHERE id = ?', fileId)).length, 0);
  assert.equal(files.has(old), false);
  assert.equal(filesWrong(await filesOf(m.id, V2, V1), V2), '');
});

test('A3: the next Send with its file on an item, every statement failing in turn, every write landing lost: the item never names a file that’s gone, and the founder’s file stays', async () => {
  const { m, fileId } = await sentThenChanged();
  await saveAs(await board.getMeeting(env.DB, m.id), (x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, docs: [fileId] } : it)) })) }));
  const observe = async () => ({ words: item(await meetingRow(m.id), 'i_budget').notes || '' });
  const out = await sweep('send with an item’s file', saveState(), () => onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id }), async ({ mode, r, after }) => {
    const a = await after3(m.id, fileId);
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    if (a.dangling.length) return `an item names ${a.dangling.join(', ')}, which is gone`;
    if (!a.row || !a.opens) return 'the founder’s file is gone';
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return landed ? answeredDone(r) : refused(r);
  }, { observe, modes: ['fail', 'lose'] });
  report(out);
});

test('A3: a file filed under Other between the send’s read and its write stays (taken off only while it’s still as read); deleteFile takes a file off every item that names it in the same write', async () => {
  const { m, fileId } = await heldSent();
  const row = await board.fileRowOf(env.DB, fileId);
  const minutesName = (await board.getMeeting(env.DB, m.id)).files.find((f) => f.id === fileId).name;
  await raw.prepare("UPDATE board_files SET kind = 'other' WHERE id = ?").bind(fileId).run();
  const off = board.takeFileOff(await board.getMeeting(env.DB, m.id), fileId, row, { only: { kind: 'minutes', name: minutesName } });
  await env.DB.batch(off.also.map((s) => env.DB.prepare(s.sql).bind(...s.bind)));
  await board.bytesOff(env, [row.r2_key]);
  assert.equal((await sql('SELECT 1 FROM board_files WHERE id = ?', fileId)).length, 1, 'still theirs');
  assert.ok(files.has(row.r2_key), 'its bytes too');
  // A file on two items, deleted: off both, in the meeting's own write
  const cur = await board.getMeeting(env.DB, m.id);
  await saveAs(cur, (x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, docs: [fileId] })) })) }));
  const del = await onAdmin({ action: 'delete-file', id: fileId });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.deepEqual((await after3(m.id, fileId)).dangling, []);
  assert.deepEqual(del.body.meeting.sections.flatMap((s) => s.items).map((it) => it.docs), [[], []]);
});

test('A3: a save never keeps an item naming a file the meeting doesn’t have', async () => {
  const { m } = await heldSent();
  const r = await onAdmin({ action: 'save-meeting', meeting: { ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_ytd' ? { ...it, docs: ['f_gonegone'] } : it)) })) }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(item(r.body.meeting, 'i_ytd').docs, []);
  assert.deepEqual(item(await meetingRow(m.id), 'i_ytd').docs || [], []);
});

// ─── A4: the status line and the minutes card, one fact ─────────────

test('A4: a held meeting’s minutes file filed by its name: the status line says they’re in, as the card does (minutesIn), never “Drop them in”', () => {
  const m = cleanMeeting({
    id: 'm_jun27', date: '2026-06-27', start: '08:00', end: '10:00', shared: true, attendance: [], sections: [{ id: 's_a', title: 'Reports', items: [{ id: 'i_a', title: 'Treasurer' }] }],
    files: [{ id: 'f_rev1', name: 'Minutes revised.pdf', type: 'application/pdf', size: 900, kind: 'minutes', at: '2026-06-28T12:00:00.000Z' }],
  });
  const data = { approvals: {}, meetings: [m], members: [], settings: { admins: [] }, minutesTypedBy: {} };
  assert.equal(minutesIn(m), true, 'the card’s fact: the minutes are in');
  const step = editor.pathOf(m, data, 'held').find((s) => s.id === 'minutes');
  assert.notEqual(step.sub, 'Drop them in');
  assert.equal(step.sub, 'In, to approve next time');
  // No minutes at all: still “Drop them in”
  const none = cleanMeeting({ ...m, files: [] });
  assert.equal(editor.pathOf(none, { ...data, meetings: [none] }, 'held').find((s) => s.id === 'minutes').sub, 'Drop them in');
});
