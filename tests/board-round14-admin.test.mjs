/**
 * Board QA round 14 (Nov 24 2026), the admin tester's findings 2 to 6.
 *   B2  One fact says which file is the minutes (board-shared.js minutesFileOf): the Word file the secretary sent stays
 *       the minutes file wherever a founder puts it (on an agenda item too), so a correction brings it up, approving
 *       keeps it and taking the minutes back takes it off everywhere; a file only uploaded counts the same way in Board
 *       and on the board page (on an item, it's that item's, never the minutes); the editor names the file the board reads
 *   B3  A press whose answer was lost (Mark them approved, Mark as draft, Share, Take it off) looks at the site before it
 *       says anything, and shows what the site has; "can't tell yet" only when that look fails too (board-meeting.js
 *       pressSave)
 *   B4  An upload whose answers are lost looks, and keeps sending under the same id, however many are lost, before
 *       anything says to try again; never a second copy, and the file lands where the press put it (board-meeting.js
 *       sendUp, board-shared.js sendUntilAnswered, the board page's presenter upload)
 *   B5  A file kept Staff only is never the board's minutes: not "in" (minutesIn), Board says they're staff only and what
 *       to do, and Email the board is refused in those words; marking them approved still works
 *   B6  Bytes put under a key whose row never landed (the put's answer lost, the step after it failing) are taken by the
 *       heartbeat after a safe wait, only when no row names them, for every route that puts bytes first: its look over
 *       the file store (_board.js takeLooseBytes), with nothing written before a put, so no press says anything new
 * The sweeps are the testers' (lib12/lib13 sweepAll): the same press from the same saved state, cleanly, then with each
 * statement it makes failing once in turn, each write landing with its answer lost, the file store's put failing, and
 * the put landing with its answer lost; after each, what the database, the file store and the board page hold is whole,
 * one rule says which file is the minutes, and the answer's words say what happened.
 * Made-up people only (the repo is public). Run: node --test tests/board-round14-admin.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as portal from '../functions/api/board-portal.js';
import * as admin from '../functions/api/board-admin.js';
import * as boardFile from '../functions/api/board-file.js';
import * as board from '../functions/api/_board.js';
import { saveNotes } from '../functions/api/_board-notes.js';
import * as notesApi from '../functions/api/_board-notes.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import * as shared from '../public/admin/board-shared.js';
import * as editor from '../public/admin/board-meeting.js';

const { cleanMeeting, todayEastern, minutesFileOf, ownMinutesFile, docxText, minutesIn, forBoard } = shared;
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
const UNSURE = 'The site didn’t answer, so we can’t tell yet whether that was saved. Reload the page in a moment to see.';
const STAFF_ONLY = 'Minutes revised is staff only, so the board can’t read these minutes. To share them, switch it to Board sees it in Every file.';
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
const SETUP_DOWN = 'The site couldn’t open the board’s records just now. Please try again in a moment.';
const NOTHING = /nothing was (sent|changed|saved)/i;
const HOUR = 60 * 60 * 1000;
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
// `fail`: the k-th statement the press makes fails before it runs. `lose`: the k-th write lands, and its answer is lost
// on the way back. `put`: the file store's k-th put fails. `putlose`: the file store's k-th put lands, and its answer is
// lost on the way back (Board QA round 14's /__qa/r2nth?op=put&mode=lose)
let raw;
let fault = null; // { mode, k, seen, failed }
const isWrite = (sql) => !/^\s*SELECT\b/i.test(String(sql || ''));
function hit(sql, write) {
  if (!fault || fault.mode === 'put' || fault.mode === 'putlose' || (fault.mode === 'lose' && !write)) return false;
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
// (when each key's bytes were put, as R2's list says it: `uploaded`)
const putAt = new Map();
let mail = [];
let later = [];
const realFetch = globalThis.fetch;
const asBytes = async (v) => new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : v instanceof Uint8Array ? v : await new Response(v).arrayBuffer());
beforeEach(async () => {
  fault = null;
  raw = await createD1();
  files.clear();
  putAt.clear();
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test',
    FILES: {
      get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length, httpMetadata: {} } : null),
      put: async (k, v) => {
        const mine = (fault?.mode === 'put' || fault?.mode === 'putlose') && fault.seen++ === fault.k;
        if (mine && fault.mode === 'put') { fault.failed.push(`put ${k}`); throw new Error('R2: we encountered an internal error'); }
        files.set(k, await asBytes(v));
        putAt.set(k, new Date());
        if (mine) { fault.failed.push(`put (landed, its answer lost) ${k}`); throw new Error('R2: Network connection lost.'); }
      },
      delete: async (k) => { files.delete(k); putAt.delete(k); },
      // (as R2 lists them: by key, a page at a time, each with when it was put)
      list: async ({ prefix = '', limit = 1000, cursor = '' } = {}) => {
        const keys = [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
        const from = Number(cursor) || 0;
        const truncated = from + limit < keys.length;
        return { objects: keys.slice(from, from + limit).map((key) => ({ key, size: files.get(key).length, uploaded: putAt.get(key) })), truncated, ...(truncated ? { cursor: String(from + limit) } : {}) };
      },
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
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '', subject: e.subject || '' });
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

// ─── Saved states, and the sweep (round 13's) ───────────────────────

const saveState = () => ({ bytes: raw._db.export(), files: new Map(files), putAt: new Map(putAt) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  putAt.clear();
  for (const [k, v] of s.putAt) putAt.set(k, v);
  later = [];
  mail = [];
}
/**
 * The press from `from`: cleanly (the control), then in each mode with its k-th statement (or put) going wrong once,
 * k = 0, 1, … until none is left. `judge({ mode, k, r, failed, before, after, control, again })` → '' or what's wrong
 */
async function sweep(name, from, press, judge, { observe, modes = ['fail', 'lose', 'put', 'putlose'], then = null, max = 400 }) {
  const problems = [];
  const failedSql = [];
  let runs = 0;
  let control = null;
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
/** The heartbeat's file steps, run now or once the safe wait for bytes no row names is over (`late`: two hours on) */
const heartbeat = async ({ late = true } = {}) => {
  await notesApi.maybeBringUpMinutesFiles(env);
  await board.finishBytesOff(env);
  await board.takeLooseBytes(env, { now: Date.now() + (late ? 2 * HOUR : 0) });
};
/** Bytes no file row names in the file store, under this meeting */
async function looseBytes(id) {
  const named = new Set((await sql('SELECT r2_key FROM board_files')).map((r) => r.r2_key));
  return [...files.keys()].filter((k) => k.startsWith(`board/meeting/${id}/`) && !named.has(k));
}
/** Rows naming bytes the file store doesn't have */
async function missingBytes() {
  return (await sql('SELECT id, r2_key FROM board_files')).filter((r) => !files.has(r.r2_key)).map((r) => r.id);
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
const saveAs = async (m, change) => {
  const r = await onAdmin({ action: 'save-meeting', meeting: change(m), base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
};
const withDocs = (itemId, docs) => (x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === itemId ? { ...it, docs } : it)) })) });
const withWords = (words) => (x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: words } : it)) })) });
/** Held, Taylor's notes sent, and a founder has put the Word file with 2.1 Year to date */
async function sentOnItem() {
  const { m, fileId } = await heldSent();
  const on = await saveAs(await board.getMeeting(env.DB, m.id), withDocs('i_ytd', [fileId]));
  assert.deepEqual(item(on, 'i_ytd').docs, [fileId]);
  return { m: await board.getMeeting(env.DB, m.id), fileId };
}
/**
 * What each page takes as the minutes file, and what it says: Board's (the founders' copy: ownMinutesFile, and whether
 * they're in: minutesIn), Alex's board page ("The minutes as written": minutesFileOf, opened as Alex opens it), and the
 * file's own bytes
 */
async function oneFact(id) {
  const m = await board.getMeeting(env.DB, id);
  const page = (await route(portal, '/api/board-portal', ALEX)).body?.meetings?.find((x) => x.id === id) || null;
  const mine = m ? ownMinutesFile(m) : null;
  const theirs = page ? minutesFileOf(page) : null;
  const opened = theirs ? await route(boardFile, `/api/board-file?id=${theirs.id}`, ALEX, { bytes: true }) : null;
  const words = opened?.status === 200 ? await textOf(opened.bytes) : '';
  return { m, board: mine?.id || null, alex: theirs?.id || null, in: m ? minutesIn(m) : false, alexWords: words, opens: opened ? opened.status : null, notes: item(page, 'i_budget')?.notes || '' };
}
/** The one rule broken: Board and the board page name different files, or the board page's file says other words than its minutes */
function factWrong(f, words) {
  if (f.board !== f.alex) return `Board names ${f.board || 'no file'} as the minutes, the board page ${f.alex || 'none'}`;
  if (f.alex && f.opens !== 200) return `“The minutes as written” opens ${f.opens}`;
  if (f.alex && words && !f.alexWords.includes(words)) return `“The minutes as written” doesn’t say “${words}”`;
  return '';
}

// ─── B2: one fact says which file is the minutes ────────────────────

test('B2: the secretary’s Word file put with 2.1 Year to date by a founder stays the minutes file: Board and the board page name it, and the line corrected in Board brings it up (every statement failing in turn, every write lost, the put failing or lost)', async () => {
  const { m, fileId } = await sentOnItem();
  const f0 = await oneFact(m.id);
  assert.deepEqual([f0.board, f0.alex, f0.in], [fileId, fileId, true], 'on the item, still the minutes, both ways');
  const mine = withWords(V2)(m);
  const observe = async () => ({ words: item(await meetingRow(m.id), 'i_budget')?.notes || '' });
  const out = await sweep('a correction with the file on an item', saveState(), () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, after }) => {
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
    const f = await oneFact(m.id);
    const wrong = factWrong(f, landed ? V2 : V1);
    if (wrong) return `the minutes say “${after.words}”, and ${wrong}`;
    if (f.board !== fileId) return `the minutes file is ${f.board}, not the secretary’s ${fileId}`;
    if (!item(f.m, 'i_ytd').docs.includes(fileId)) return 'it came off the item it was put on';
    if ((await missingBytes()).length) return `a row names bytes that are gone: ${(await missingBytes()).join(', ')}`;
    await heartbeat();
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left after the heartbeat: ${loose.join(', ')}`;
    const fh = await oneFact(m.id);
    if (factWrong(fh, landed ? V2 : V1)) return `after the heartbeat: ${factWrong(fh, landed ? V2 : V1)}`;
    if (landed) return answeredDone(r);
    return refused(r);
  }, { observe });
  report(out);
  assert.ok(out.failedSql.some((q) => /^put board\/meeting\//.test(q)), 'the Word file’s put failed in turn');
  assert.ok(out.failedSql.some((q) => /^put \(landed/.test(q)), 'and landed with its answer lost');
});

for (const [how, press] of [
  ['Mark them approved (a save, with the line corrected)', (m) => onAdmin({ action: 'save-meeting', meeting: { ...withWords(V2)(m), minutes: 'approved', approvedOn: inDays(0) }, base: m.updatedAt })],
  ['Board’s Approve', (m) => onAdmin({ action: 'approve-minutes', id: m.id, on: inDays(0) })],
]) {
  test(`B2: ${how} with the secretary’s Word file on an item: approved as that file, which says what they say, and the board page opens it (every statement failing in turn, every write lost, the put failing or lost)`, async () => {
    const { m, fileId } = await sentOnItem();
    const words = how.startsWith('Mark') ? V2 : V1;
    const observe = async () => { const row = await meetingRow(m.id); return { approved: row.minutes === 'approved', approvedFile: row.approvedFile || '', words: item(row, 'i_budget')?.notes || '' }; };
    const out = await sweep(how, saveState(), () => press(m), async ({ mode, r, after }) => {
      if (!mode && !(after.approved && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status})`;
      const f = await oneFact(m.id);
      if (after.approved) {
        if (after.approvedFile !== fileId) return `approved as ${after.approvedFile || 'no file'}, not the secretary’s Word file`;
        const wrong = factWrong(f, words);
        if (wrong) return `approved, and ${wrong}`;
      } else {
        const wrong = factWrong(f, V1);
        if (wrong) return `still a draft, and ${wrong}`;
      }
      if ((await missingBytes()).length) return `a row names bytes that are gone: ${(await missingBytes()).join(', ')}`;
      await heartbeat();
      const loose = await looseBytes(m.id);
      if (loose.length) return `bytes nobody names are left after the heartbeat: ${loose.join(', ')}`;
      return after.approved ? answeredDone(r) : refused(r, NOT_APPROVED);
    }, { observe });
    report(out);
  });
}

test('B2: the secretary takes the minutes back with their Word file on an item: it goes from everywhere (its row, its bytes, the item), so the board page never offers withdrawn minutes; every statement failing in turn, every write lost', async () => {
  const { m, fileId } = await sentOnItem();
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': null, 'r:sam-ortiz': null, 'r:taylor-nguyen': null, 'n:i_budget': null } }, TAYLOR_W);
  const observe = async () => ({ typed: !!(await meetingRow(m.id)).minutesFrom?.typed, row: (await sql('SELECT 1 FROM board_files WHERE id = ?', fileId)).length });
  const out = await sweep('taken back', saveState(), () => onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id }), async ({ mode, r, after }) => {
    const back = !after.typed;
    if (!mode && !(back && r.status === 200 && r.body?.cleared)) return `the control: ${JSON.stringify(after)} (${r.status} ${JSON.stringify(r.body)})`;
    const f = await oneFact(m.id);
    if (back) {
      if (after.row) return 'taken back, and their Word file is still on the meeting';
      if (f.alex) return `taken back, and the board page offers ${f.alex} as the minutes as written`;
      if (f.in) return 'taken back, and Board says the minutes are in';
      if ((item(f.m, 'i_ytd').docs || []).includes(fileId)) return 'taken back, and the item still names the file';
      await heartbeat();
      if (files.size && (await looseBytes(m.id)).length) return `bytes nobody names are left after the heartbeat: ${(await looseBytes(m.id)).join(', ')}`;
      return answeredDone(r);
    }
    const wrong = factWrong(f, V1);
    if (wrong) return `not taken back, and ${wrong}`;
    if (!after.row || f.board !== fileId) return 'not taken back, and the Word file is gone';
    return refused(r);
  }, { observe, modes: ['fail', 'lose'] });
  report(out);
});

test('B2: a correction suggested on the board page and made by a founder, with the secretary’s Word file on an item: the file says the corrected words, and the board page opens it (every statement failing in turn, every write lost, the put failing or lost)', async () => {
  const { m, fileId } = await sentOnItem();
  const c = await onPortal(SAM, { action: 'correction', meetingId: m.id, target: 'n:i_budget', words: V2, was: V1 });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const observe = async () => ({ words: item(await meetingRow(m.id), 'i_budget')?.notes || '' });
  const out = await sweep('a correction made', saveState(), () => route(portal, '/api/board-portal', FOUNDER, { method: 'POST', body: { action: 'correction-decide', id: c.body.correction.id, make: true } }), async ({ mode, r, after }) => {
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status} ${JSON.stringify(r.body).slice(0, 200)})`;
    const f = await oneFact(m.id);
    const wrong = factWrong(f, landed ? V2 : V1);
    if (wrong) return `the minutes say “${after.words}”, and ${wrong}`;
    if (f.board !== fileId) return `the minutes file is ${f.board}, not the secretary’s ${fileId}`;
    if ((await missingBytes()).length) return `a row names bytes that are gone: ${(await missingBytes()).join(', ')}`;
    await heartbeat();
    const loose = await looseBytes(m.id);
    if (loose.length) return `bytes nobody names are left after the heartbeat: ${loose.join(', ')}`;
    if (landed) return r.status === 200 && r.body?.ok !== false ? '' : `it landed, and it answered ${r.status} “${said(r)}”`;
    return refused(r);
  }, { observe });
  report(out);
});

test('B2: the secretary’s next Send approving the last minutes, whose Word file a founder put on an item: approved as that file, brought up to what they say (every statement failing in turn, every write lost, the put failing or lost)', async () => {
  const { m, fileId } = await sentOnItem();
  // (the line corrected in a write that didn't carry the file: the approval brings it up)
  await board.saveMeeting(env.DB, withWords(V2)(await board.getMeeting(env.DB, m.id)), { by: FOUNDER });
  const next = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(0), start: '07:00', end: '07:30', shared: true,
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [{ id: 's_open', title: 'Opening', items: [{ id: 'i_mins', title: 'Approve the last meeting’s minutes', live: 'minutes', about: m.id }] }],
  }), { by: 'test' });
  await saveNotes(env, next.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'm:i_mins': { result: 'passed', by: 'Alex Rivera', second: 'Sam Ortiz' } } }, TAYLOR_W);
  const observe = async () => { const row = await meetingRow(m.id); return { approved: row.minutes === 'approved', approvedFile: row.approvedFile || '' }; };
  const out = await sweep('the approving send', saveState(), () => onPortal(TAYLOR, { action: 'notes-send', meetingId: next.id }), async ({ mode, r, after }) => {
    if (!mode && !(after.approved && r.status === 200)) return `the control: ${JSON.stringify(after)} (${r.status} ${JSON.stringify(r.body).slice(0, 200)})`;
    const f = await oneFact(m.id);
    if (after.approved) {
      if (after.approvedFile !== fileId) return `approved as ${after.approvedFile || 'no file'}, not the secretary’s Word file`;
      const wrong = factWrong(f, V2);
      if (wrong) return `approved, and ${wrong}`;
    } else if (factWrong(f, '')) return `not approved, and ${factWrong(f, '')}`;
    if ((await missingBytes()).length) return `a row names bytes that are gone: ${(await missingBytes()).join(', ')}`;
    await heartbeat();
    for (const id of [m.id, next.id]) { const loose = await looseBytes(id); if (loose.length) return `bytes nobody names are left after the heartbeat: ${loose.join(', ')}`; }
    return after.approved ? answeredDone(r) : refused(r);
  }, { observe });
  report(out);
});

test('B2: a minutes file only uploaded counts the same way in Board and on the board page: in while it’s the meeting’s own, and on an item it’s that item’s, never the minutes, on either page; the editor names the file the board reads', async () => {
  const m = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-150), start: '08:00', end: '10:00', shared: true, attendance: [],
    sections: [{ id: 's_a', title: 'Looking ahead', items: [{ id: 'i_five', title: 'The next five years' }] }],
  }), { by: 'test' });
  const form = new FormData();
  form.set('file', new File([PDF()], 'Minutes revised.pdf', { type: 'application/pdf' }));
  form.set('ownerType', 'meeting'); form.set('ownerId', m.id); form.set('kind', 'minutes'); form.set('staffOnly', 'false');
  const up = await route(admin, '/api/board-admin?upload=1', FOUNDER, { method: 'POST', form });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const fid = up.body.file.id;
  let f = await oneFact(m.id);
  assert.deepEqual([f.board, f.alex, f.in], [fid, fid, true], 'its own: the minutes, both ways');
  await saveAs(await board.getMeeting(env.DB, m.id), withDocs('i_five', [fid]));
  f = await oneFact(m.id);
  assert.deepEqual([f.board, f.alex, f.in], [null, null, false], 'on an item: that item’s, on both pages');
  const step = editor.pathOf(f.m, { approvals: {}, meetings: [f.m], members: [], settings: { admins: [] }, minutesTypedBy: {} }, 'held').find((s) => s.id === 'minutes');
  assert.equal(step.sub, 'Drop them in');
  // Two of the meeting's own: the editor names the one the board reads (the PDF before the Word copy)
  const two = cleanMeeting({ ...f.m, sections: [], files: [{ id: 'f_wordaaaa', name: 'Minutes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 9, kind: 'minutes', at: '2026-06-28T10:00:00.000Z' }, { id: 'f_pdfaaaaa', name: 'Minutes.pdf', type: 'application/pdf', size: 9, kind: 'minutes', at: '2026-06-28T09:00:00.000Z' }, { id: 'f_wordbbbb', name: 'Minutes final.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 9, kind: 'minutes', at: '2026-06-29T10:00:00.000Z' }] });
  assert.equal(ownMinutesFile(two).id, minutesFileOf(forBoard({ ...two, shared: true })).id, 'the editor and the board page, one file');
});

// ─── B3: a press whose answer was lost looks before it speaks ───────

/** The meeting page's pieces a pressed change goes through (MeetingEditor's set, save and saved; Board's look; take) */
function pressRig({ site, lose = true, lookFails = 0 }) {
  const page = { minutes: 'draft', approvedOn: '' };
  const saved = { current: { ...site.before } };
  const toasts = [];
  let looks = 0;
  return {
    page, toasts, get looks() { return looks; },
    p: {
      set: (patch) => Object.assign(page, typeof patch === 'function' ? patch(page) : patch),
      saved,
      addToast: (t) => toasts.push(t),
      // (the save goes, lands or not as `site` says, and its answer is lost: useAutosave hands that to `own`)
      save: async ({ own }) => { site.landed = { ...site.before, ...(site.lands ? { minutes: page.minutes, approvedOn: page.approvedOn } : {}) }; if (lose) own({ ok: false, unknown: true, error: 'No answer came back from the site. Try again in a moment.' }); else saved.current = site.landed; return null; },
      look: async () => { looks += 1; if (looks <= lookFails) return null; return site.landed; },
      take: (sv) => { saved.current = { ...sv }; Object.assign(page, { minutes: sv.minutes, approvedOn: sv.approvedOn }); },
    },
  };
}
const APPROVE = (day) => [{ minutes: 'approved', approvedOn: day }, {
  has: (sv) => sv.minutes === 'approved', back: (sv) => ({ minutes: sv.minutes, approvedOn: sv.approvedOn }), what: 'Not marked approved', again: 'Mark them approved again',
}];

test('B3: Mark them approved, its save landed and its answer lost: the page looks, shows them approved as the site has them, and says nothing of reloading', async () => {
  assert.equal(typeof editor.pressSave, 'function', 'pressSave');
  const site = { before: { minutes: 'draft', approvedOn: '' }, lands: true };
  const rig = pressRig({ site });
  const went = await editor.pressSave(rig.p, ...APPROVE(inDays(0)));
  assert.equal(went, true, 'the site has them approved: done');
  assert.equal(rig.page.minutes, 'approved', 'never put back to draft');
  assert.equal(rig.looks, 1, 'it looked');
  assert.deepEqual(rig.toasts, [], 'no “reload”, no “can’t tell”');
});

test('B3: Mark them approved, its save never landed and its answer lost: the page looks, puts back what the site has (draft), and says it wasn’t saved, with how to do it again', async () => {
  const site = { before: { minutes: 'draft', approvedOn: '' }, lands: false };
  const rig = pressRig({ site });
  const went = await editor.pressSave(rig.p, ...APPROVE(inDays(0)));
  assert.equal(went, false);
  assert.equal(rig.page.minutes, 'draft');
  assert.equal(rig.toasts.length, 1);
  assert.match(rig.toasts[0], /^Not marked approved: the site didn’t answer, so that wasn’t saved\. Mark them approved again\.$/);
});

test('B3: Mark as draft, landed with its answer lost, and the first look failing: the page looks again and shows them as the site has them; the look failing every time: “can’t tell yet”, and nothing put back that the site may not have', async () => {
  const draft = [{ minutes: 'draft', approvedOn: '' }, { has: (sv) => sv.minutes !== 'approved', back: (sv) => ({ minutes: sv.minutes, approvedOn: sv.approvedOn }), what: 'Still approved', again: 'Mark them as draft again' }];
  const site = { before: { minutes: 'approved', approvedOn: inDays(-1) }, lands: true };
  const rig = pressRig({ site, lookFails: 1 });
  rig.page.minutes = 'approved';
  assert.equal(await editor.pressSave(rig.p, ...draft), true);
  assert.equal(rig.page.minutes, 'draft');
  assert.deepEqual(rig.toasts, []);
  const site2 = { before: { minutes: 'approved', approvedOn: inDays(-1) }, lands: true };
  const rig2 = pressRig({ site: site2, lookFails: 9 });
  rig2.page.minutes = 'approved';
  assert.equal(await editor.pressSave(rig2.p, ...draft), false);
  assert.equal(rig2.page.minutes, 'draft', 'as pressed: never put back to approved, which the site may not have');
  assert.deepEqual(rig2.toasts, [UNSURE]);
});

test('B3: Mark them approved, its answer lost, and Board’s own try again landing while the look is out: the look’s older copy (still a draft) never puts the page back; it shows them approved, as the site has them now', async () => {
  const site = { before: { minutes: 'draft', approvedOn: '', updatedAt: '2026-11-24T10:00:00.000Z' }, lands: false };
  const rig = pressRig({ site });
  const look = rig.p.look;
  // (the retry's answer came while the look was out: the page has the newer copy from the site, approved)
  rig.p.look = async () => { const old = await look(); rig.p.saved.current = { minutes: 'approved', approvedOn: inDays(0), updatedAt: '2026-11-24T10:00:05.000Z' }; return old; };
  const went = await editor.pressSave(rig.p, ...APPROVE(inDays(0)));
  assert.equal(went, true, 'the site has them approved');
  assert.equal(rig.page.minutes, 'approved', 'never put back to draft by the older copy');
  assert.deepEqual(rig.toasts, []);
});

test('B3: Share and Take it off go the same way (putOnPage is pressSave): landed with the answer lost, shown as the site has it', async () => {
  const site = { before: { minutes: 'draft', approvedOn: '', shared: false }, lands: true };
  const rig = pressRig({ site });
  rig.p.save = async ({ own }) => { site.landed = { ...site.before, shared: true }; own({ ok: false, unknown: true }); return null; };
  rig.p.take = (sv) => { rig.p.saved.current = { ...sv }; rig.page.shared = sv.shared; };
  const went = await editor.pressSave(rig.p, { shared: true }, { has: (sv) => sv.shared === true, back: (sv) => ({ shared: sv.shared }), what: 'Not on the board page', again: 'Share it again' });
  assert.equal(went, true);
  assert.equal(rig.page.shared, true);
  assert.deepEqual(rig.toasts, []);
});

// ─── B4: an upload never says "Try again" for a file the site has ───

/** The page's own fetch, onto the real handlers: `cut(kind, n)` → whether the n-th answer of that kind is lost (a gateway's 502) */
function pageFetch(cut) {
  const seen = { upload: 0, look: 0, attach: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (!url.startsWith('/api/')) return new Response('{}', { status: 503 });
    const kind = /upload=1/.test(url) ? 'upload' : /attach=/.test(url) ? 'attach' : /\?quick/.test(url) ? 'look' : 'other';
    const n = kind in seen ? ++seen[kind] : 0;
    const r = url.startsWith('/api/board-portal')
      ? await route(portal, url, SAM, { method: init.method || 'GET', form: init.body instanceof FormData ? init.body : null })
      : await route(admin, url, FOUNDER, { method: init.method || 'GET', form: init.body instanceof FormData ? init.body : null, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (cut(kind, n)) return new Response('<html>502 Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    return Response.json(r.body, { status: r.status });
  };
  return seen;
}
const noSleep = { waits: [1, 1, 1, 1, 1, 1] };
/** The Dec 3 meeting, ahead and on the board page, Sam presenting Year to date */
async function ahead() {
  return board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(9), start: '08:00', end: '10:00', shared: true, attendance: [],
    sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_ytd', title: 'Year to date', who: ['sam-ortiz'] }, { id: 'i_budget', title: 'The 2027 budget' }] }],
  }), { by: 'test' });
}
const statements = async (id) => (await sql("SELECT id, r2_key FROM board_files WHERE owner_type = 'meeting' AND owner_id = ? AND name = 'Statement.pdf'", id));
const boardCtx = () => ({ load: async ({ quick = false } = {}) => { const r = await fetch(`/api/board-admin${quick ? '?quick' : ''}`, { cache: 'no-store' }); try { return { ...(await r.json()), ok: r.ok }; } catch { return { ok: false, unknown: true }; } } });

test('B4: Board’s item upload, its answer lost twice and the look between them failing (the tester’s): the page keeps looking under the same id, and answers with the file kept, once; never “Try again”', async () => {
  assert.equal(typeof editor.sendUp, 'function', 'sendUp');
  const m = await ahead();
  const seen = pageFetch((kind, n) => (kind === 'upload' && n <= 2) || (kind === 'look' && n === 1));
  const f = new File([PDF()], 'Statement.pdf', { type: 'application/pdf' });
  const j = await editor.sendUp(boardCtx(), f, { ownerType: 'meeting', ownerId: m.id, kind: 'financials', forItem: true, place: 'i_ytd' });
  assert.equal(j.ok, true, JSON.stringify(j));
  assert.ok(!/Try again/i.test(j.error || ''));
  const rows = await statements(m.id);
  assert.equal(rows.length, 1, 'one copy');
  assert.equal(j.file.id, rows[0].id, 'the answer is the file kept');
  assert.ok(seen.upload >= 2);
});

test('B4: an upload whose answers are lost every time ends in “can’t tell yet”, never “Try again”; the same file chosen again goes under the same id, so it’s never kept twice', async () => {
  const m = await ahead();
  let lostAll = true;
  pageFetch((kind) => (kind === 'upload' && lostAll) || kind === 'look');
  const f = new File([PDF()], 'Statement.pdf', { type: 'application/pdf', lastModified: 1 });
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, Math.min(ms, 1), ...a);
  try {
    const j = await editor.sendUp(boardCtx(), f, { ownerType: 'meeting', ownerId: m.id, kind: 'financials' });
    assert.equal(j.ok, false);
    assert.equal(j.error, UNSURE);
    assert.equal((await statements(m.id)).length, 1, 'kept once, however many times it went');
    lostAll = false;
    const again = await editor.sendUp(boardCtx(), f, { ownerType: 'meeting', ownerId: m.id, kind: 'financials' });
    assert.equal(again.ok, true, JSON.stringify(again));
    const rows = await statements(m.id);
    assert.equal(rows.length, 1, 'chosen again: the same upload, never a second copy');
    assert.equal(again.file.id, rows[0].id);
  } finally { globalThis.setTimeout = realTimeout; }
});

test('B4: the presenter’s upload on the board page, its answer lost twice: sent again under the same id until it answers, one copy, on its item (sendUntilAnswered)', async () => {
  assert.equal(typeof shared.sendUntilAnswered, 'function', 'sendUntilAnswered');
  const m = await ahead();
  const seen = pageFetch((kind, n) => kind === 'attach' && n <= 2);
  const fileId = 'f_sampagex';
  const send = async () => {
    const fd = new FormData();
    fd.append('file', new File([PDF()], 'Statement.pdf', { type: 'application/pdf' }));
    fd.append('fileId', fileId);
    const r = await fetch(`/api/board-portal?attach=${m.id}&item=i_ytd`, { method: 'POST', body: fd });
    return r.json().catch(() => ({ ok: false, lost: true, error: 'The site didn’t answer. Try again in a moment.' }));
  };
  const j = await shared.sendUntilAnswered(send, { lost: (x) => !x.ok && !!x.lost, ...noSleep });
  assert.equal(j.ok, true, JSON.stringify(j));
  assert.equal(seen.attach, 3);
  assert.equal((await statements(m.id)).length, 1, 'one copy');
  assert.deepEqual(item(await board.getMeeting(env.DB, m.id), 'i_ytd').docs, [fileId], 'on its item, once');
  assert.deepEqual(j.docs, [fileId]);
});

// ─── B5: a staff-only file is never the board's minutes ─────────────

/** Held Jun 27 with no minutes; Every file → Add files "Minutes revised.pdf" (filed as Minutes), then switched to Staff only */
async function staffOnlyMinutes() {
  const m = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-150), start: '08:00', end: '10:00', shared: true, attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [{ id: 's_a', title: 'Reports', items: [{ id: 'i_a', title: 'Treasurer' }] }],
  }), { by: 'test' });
  const form = new FormData();
  form.set('file', new File([PDF()], 'Minutes revised.pdf', { type: 'application/pdf' }));
  form.set('ownerType', 'meeting'); form.set('ownerId', m.id); form.set('kind', 'minutes'); form.set('staffOnly', 'false');
  const up = await route(admin, '/api/board-admin?upload=1', FOUNDER, { method: 'POST', form });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const sw = await onAdmin({ action: 'update-file', id: up.body.file.id, staffOnly: true });
  assert.equal(sw.status, 200, JSON.stringify(sw.body));
  return { m: await board.getMeeting(env.DB, m.id), fileId: up.body.file.id };
}

test('B5: minutes kept only as a Staff only file aren’t in: the status line says they’re staff only, never “In”; the board page has none; Board names the file and what to do', async () => {
  const { m, fileId } = await staffOnlyMinutes();
  assert.equal(minutesIn(m), false, 'not the minutes in');
  assert.equal(shared.minutesStaffOnly(m)?.id, fileId);
  assert.equal(shared.staffOnlyWords(shared.minutesStaffOnly(m)), STAFF_ONLY);
  const data = { approvals: {}, meetings: [m], members: [], settings: { admins: [] }, minutesTypedBy: {} };
  const step = editor.pathOf(m, data, 'held').find((s) => s.id === 'minutes');
  assert.equal(step.sub, 'Staff only, not shared');
  const page = (await route(portal, '/api/board-portal', ALEX)).body.meetings.find((x) => x.id === m.id);
  assert.equal(minutesFileOf(page), null, 'the board page: none');
  assert.equal(ownMinutesFile(m).id, fileId, 'the founders still have it');
});

test('B5: Email the board for minutes kept Staff only is refused in words that say so and what to do, every statement failing in turn, every write lost: nobody is emailed', async () => {
  const { m } = await staffOnlyMinutes();
  const observe = async () => ({ sentAt: (await meetingRow(m.id)).minutesSentAt || '' });
  const out = await sweep('minutes notice, staff only', saveState(), () => onAdmin({ action: 'send-minutes', id: m.id }), async ({ mode, r, after }) => {
    if (mail.length) return `${mail.length} emailed: ${mail.map((x) => x.subject).join(' | ')}`;
    if (after.sentAt) return 'the meeting says the board was told';
    if (!mode) return r.status === 409 && r.body?.error === STAFF_ONLY ? '' : `the control: ${r.status} “${said(r)}”`;
    // (a read that failed before it could tell: refused in words that say nothing was sent; else the staff-only words)
    return r.status === 409 && said(r) === STAFF_ONLY ? '' : refused(r);
  }, { observe, modes: ['fail', 'lose'] });
  report(out, 2);
  // Switched to Board sees it: in, and the email goes
  const sw = await onAdmin({ action: 'update-file', id: (await board.getMeeting(env.DB, m.id)).files[0].id, staffOnly: false });
  assert.equal(sw.status, 200);
  assert.equal(minutesIn(await board.getMeeting(env.DB, m.id)), true);
  const r = await onAdmin({ action: 'send-minutes', id: m.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('B5: minutes kept Staff only can still be marked approved, as ever: approved as that file, which the board page never shows', async () => {
  const { m, fileId } = await staffOnlyMinutes();
  const r = await onAdmin({ action: 'save-meeting', meeting: { ...m, minutes: 'approved', approvedOn: inDays(0) }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.meeting.approvedFile, fileId);
  const page = (await route(portal, '/api/board-portal', ALEX)).body.meetings.find((x) => x.id === m.id);
  assert.equal(minutesFileOf(page), null);
});

// ─── B6: bytes nothing names, taken by the heartbeat ────────────────

const upload = (meetingId, fileId) => {
  const form = new FormData();
  form.set('file', new File([PDF()], 'Statement.pdf', { type: 'application/pdf' }));
  form.set('ownerType', 'meeting'); form.set('ownerId', meetingId); form.set('kind', 'financials'); form.set('staffOnly', 'false'); form.set('forItem', 'true');
  if (fileId) form.set('fileId', fileId);
  return route(admin, '/api/board-admin?upload=1', FOUNDER, { method: 'POST', form });
};
const attach = (meetingId, fileId) => {
  const form = new FormData();
  form.set('file', new File([PDF()], 'Statement.pdf', { type: 'application/pdf' }));
  if (fileId) form.set('fileId', fileId);
  return route(portal, `/api/board-portal?attach=${meetingId}&item=i_ytd`, SAM, { method: 'POST', form });
};
// (whether the press's own work landed, as the database has it: the file kept, on its item; the words sent or saved; the
// minutes approved. And the words its refusal says when it didn't, if not the usual "…so nothing was …")
const kept = (id) => async () => (await sql('SELECT 1 FROM board_files WHERE id = ?', id)).length > 0;
const onItemNow = (id) => async (m) => (await kept(id)()) && (item(await meetingRow(m.id), 'i_ytd')?.docs || []).includes(id);
const saysV2 = async (m) => item(await meetingRow(m.id), 'i_budget')?.notes === V2;
for (const [how, setup, press, landedOf, no = null] of [
  ['Board’s upload', ahead, (m) => upload(m.id, 'f_pageputl'), kept('f_pageputl')],
  ['the presenter’s upload', ahead, (m) => attach(m.id, 'f_sampputl'), onItemNow('f_sampputl')],
  ['the secretary’s Send again', async () => { const { m } = await heldSent(); await saveNotes(env, m.id, { changes: { 'n:i_budget': V2 } }, TAYLOR_W); return m; }, (m) => onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id }), saysV2],
  ['a correction in Board', async () => (await heldSent()).m, (m) => onAdmin({ action: 'save-meeting', meeting: withWords(V2)(m), base: m.updatedAt }), saysV2],
  ['Mark them approved with a correction', async () => (await heldSent()).m, (m) => onAdmin({ action: 'save-meeting', meeting: { ...withWords(V2)(m), minutes: 'approved', approvedOn: inDays(0) }, base: m.updatedAt }), async (m) => (await meetingRow(m.id)).minutes === 'approved', NOT_APPROVED],
]) {
  test(`B6: ${how}, the file store’s put landing with its answer lost (and every other statement failing or lost in turn): no bytes nothing names once the heartbeat’s safe wait is over, none taken sooner, never bytes a row names; the answer says what happened`, async () => {
    const m = await setup();
    const observe = async () => ({});
    const out = await sweep(how, saveState(), () => press(m), async ({ mode, failed, r }) => {
      const landed = await landedOf(m);
      if (!mode && !(landed && r.status === 200)) return `the control: ${r.status} ${JSON.stringify(r.body)}`;
      // (the answer's words say what happened: done as done, else refused in words that say nothing was done)
      const words = landed ? answeredDone(r) : refused(r, no);
      if (words) return words;
      if ((await missingBytes()).length) return `a row names bytes that are gone: ${(await missingBytes()).join(', ')}`;
      // (the heartbeat before the wait is over takes none of the bytes nobody names yet: they may be on their way to their
      // row. Bytes marked to go, a row's old bytes, go at once as ever)
      const marks = new Set((await sql('SELECT key FROM board_state')).map((x) => x.key));
      const left = (await looseBytes(m.id)).filter((k) => !marks.has(`file-bytes:${k}`));
      await heartbeat({ late: false });
      if ((await missingBytes()).length) return 'the heartbeat took bytes a row names';
      const early = await looseBytes(m.id);
      if (left.some((k) => !early.includes(k))) return `the heartbeat took bytes before the wait was over: ${left.filter((k) => !early.includes(k)).join(', ')}`;
      await heartbeat({ late: true });
      if ((await missingBytes()).length) return 'the heartbeat took bytes a row names';
      const loose = await looseBytes(m.id);
      if (loose.length) return `bytes nobody names are left for good${/^put \(landed/.test(failed) ? ' (the put landed, its answer lost)' : ''}: ${loose.join(', ')}`;
      return '';
    }, { observe, modes: ['putlose', 'put', 'fail', 'lose'] });
    report(out, 4);
    assert.ok(out.failedSql.some((q) => /^put \(landed/.test(q)), 'a put landed with its answer lost');
  });
}

test('B6: the heartbeat’s look over the file store: never bytes a row names, however old, nor any before the safe wait is over; a page at a time, going on where it got to, then not again within the hour', async () => {
  const m = await ahead();
  assert.equal((await upload(m.id, 'f_pagekept')).status, 200);
  const lose = async (id) => { fault = { mode: 'putlose', k: 0, seen: 0, failed: [] }; const r = await upload(m.id, id); fault = null; assert.ok(r.status >= 400, 'the lost put is refused'); };
  await lose('f_pagelost');
  const kept = (await sql('SELECT r2_key FROM board_files WHERE id = ?', 'f_pagekept'))[0].r2_key;
  const [lost] = await looseBytes(m.id);
  assert.ok(lost && files.has(kept), 'bytes nobody names, beside bytes a row names');
  const t0 = Date.now();
  assert.equal(await board.takeLooseBytes(env, { now: t0 }), 0, 'none before the wait is over');
  assert.ok(files.has(lost));
  // (two hours on, a page of one key at a time: the look goes on where it got to)
  let gone = 0;
  for (let i = 0; i < 3; i++) gone += await board.takeLooseBytes(env, { now: t0 + 2 * HOUR, pages: 1, limit: 1 });
  assert.equal(gone, 1);
  assert.ok(files.has(kept), 'bytes a row names stay, however old');
  assert.ok(!files.has(lost), 'bytes nobody names go');
  // (a look done: not again within the hour; after it, the next bytes nobody names go too)
  await lose('f_pagelos2');
  assert.equal(await board.takeLooseBytes(env, { now: t0 + 2 * HOUR + HOUR / 2 }), 0);
  assert.equal((await looseBytes(m.id)).length, 1);
  assert.equal(await board.takeLooseBytes(env, { now: t0 + 4 * HOUR }), 1);
  assert.deepEqual(await looseBytes(m.id), []);
  assert.ok(files.has(kept));
});

test('B6: the heartbeat’s look, every statement it makes failing once in turn, and each write landing with its answer lost: never bytes a row names, and the next look takes the bytes nobody names', async () => {
  const m = await ahead();
  // (one kept, on its row; one whose put landed with its answer lost, so no row names it)
  assert.equal((await upload(m.id, 'f_pagekept')).status, 200);
  fault = { mode: 'putlose', k: 0, seen: 0, failed: [] };
  const lostOne = await upload(m.id, 'f_pagelost');
  fault = null;
  assert.equal(lostOne.status >= 400, true, 'the lost put is refused');
  assert.equal((await looseBytes(m.id)).length, 1, 'its bytes are there, named by nothing');
  const observe = async () => ({});
  const out = await sweep('the heartbeat', saveState(), async () => { await board.takeLooseBytes(env, { now: Date.now() + 2 * HOUR }); return { status: 200, body: { ok: true } }; }, async () => {
    if ((await missingBytes()).length) return `took bytes a row names: ${(await missingBytes()).join(', ')}`;
    await board.takeLooseBytes(env, { now: Date.now() + 4 * HOUR });
    if ((await missingBytes()).length) return 'the next look took bytes a row names';
    const loose = await looseBytes(m.id);
    return loose.length ? `bytes nobody names are left after the next look: ${loose.join(', ')}` : '';
  }, { observe, modes: ['fail', 'lose'] });
  report(out, 2);
});
