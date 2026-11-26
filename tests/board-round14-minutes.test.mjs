/**
 * Board QA round 14 (Nov 24 2026), the admin tester's finding 1: approved minutes' Word file was made again after they
 * were approved, once the next meeting moved or Settings' quorum changed (by the heartbeat, and by a founder's later
 * save of the held meeting), and the board's "The minutes as written" said what the board never approved.
 *   M1  Approved minutes are the record, and nothing rewrites their Word file (round 8's rule): once approved, by any
 *       route (Board's approve, Mark them approved, the secretary's approving send), no step changes their file's bytes
 *       or which file they are: another meeting moved or renamed, Settings' quorum changed, a save of the held meeting,
 *       the heartbeat now and a month on. One guard says so where the file is made (_board-notes.js fileMayChange)
 *   M2  A minutes file says only what the minutes say: the quorum, the next meeting and the meeting their vote approves
 *       are kept with the minutes as they're written (the send's record, `facts`), never read from Settings or another
 *       meeting when the file is made again. Draft minutes' file follows their own words only; older minutes, sent before
 *       their record kept those, are made as their file said them at its last write
 * The sweeps are the testers' (lib12/lib13 sweepAll): the same press from the same saved state, cleanly, then with each
 * statement it makes (reads, writes, batches) failing once in turn, then each write landing with its answer lost on the
 * way back, then the file store's put (and, for older minutes, its read) failing; after each, what the database and the
 * file store hold is whole, the file says only what the minutes say, and the answer's words say what happened.
 * Made-up people only (the repo is public). Run: node --test tests/board-round14-minutes.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { maybeRunSigning } from '../functions/api/_board-sign.js';
import * as shared from '../public/admin/board-shared.js';

const { cleanMeeting, todayEastern, minutesFileOf, docxText, longDate } = shared;
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
// file store's k-th put fails. `get`: its k-th read fails
let raw;
let fault = null; // { mode, k, seen, failed }
const isWrite = (sql) => !/^\s*SELECT\b/i.test(String(sql || ''));
function hit(sql, write) {
  if (!fault || fault.mode === 'put' || fault.mode === 'get' || (fault.mode === 'lose' && !write)) return false;
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
      get: async (k) => {
        if (fault?.mode === 'get' && fault.seen++ === fault.k) { fault.failed.push(`get ${k}`); throw new Error('R2: we encountered an internal error'); }
        return files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length, httpMetadata: {} } : null;
      },
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
const meetingRow = async (id) => { const r = (await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0]; return r ? JSON.parse(r.data) : null; };
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''}`.trim();
const textOf = async (bytes) => { try { return await docxText(bytes); } catch { return ''; } };
const sha = (bytes) => (bytes ? createHash('sha256').update(bytes).digest('hex') : '');

// ─── Saved states, and the sweep ────────────────────────────────────

const saveState = () => ({ bytes: raw._db.export(), files: new Map(files) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  later = [];
}
/**
 * The press from `from`: cleanly (the control), then in each mode with its k-th statement (or put, or read of a file)
 * going wrong once, k = 0, 1, … until none is left. `judge({ mode, k, r, failed, before, after, control })` → '' or what's wrong
 */
async function sweep(name, from, press, judge, { observe, modes = ['fail', 'lose', 'put'], max = 400 }) {
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
      const after = await observe();
      if (!mode) control = { r, before, after };
      const why = await judge({ mode, k, r, failed, before, after, control });
      if (why) problems.push(`${name} ${mode || 'control'} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90)}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 200)}: ${why}`);
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
/** Bytes no file row names, left after the heartbeat */
async function looseBytes(id) {
  await board.finishBytesOff(env);
  const named = new Set((await sql('SELECT r2_key FROM board_files')).map((r) => r.r2_key));
  return [...files.keys()].filter((k) => k.startsWith(`board/meeting/${id}/`) && !named.has(k));
}

// ─── The meetings ───────────────────────────────────────────────────
//
// The last meeting (whose minutes the held one's agenda takes a vote on), the held one (yesterday, Taylor's typed notes
// sent), the next one ahead (March in the tester's run), and a meeting today whose agenda approves the held one's minutes.
// Settings' quorum is 3 when the minutes are written.

const V1 = 'Budget passed at forty thousand.';
const V2 = 'Budget passed at fifty thousand.';
const NEXT_DAY = inDays(60);
const MOVED_DAY = inDays(67);
const item = (m, id) => (m?.sections || []).flatMap((s) => s.items).find((it) => it.id === id);
const withWords = (m, words) => ({ ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: words } : it)) })) });

async function meetings() {
  await board.saveSettings(env.DB, { quorum: 3 }, FOUNDER);
  const prev = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-90), start: '08:00', end: '10:00', shared: true, title: 'Summer Board Meeting', attendance: [], sections: [{ id: 's_p1', title: 'Finance', items: [{ id: 'i_pfin', title: 'Year to date' }] }] }), { by: 'test' });
  const held = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), start: '08:00', end: '10:00', shared: true, location: 'Example Hall',
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [
      { id: 's_open', title: 'Call to order', items: [{ id: 'i_prev', title: 'Approve the last meeting’s minutes', live: 'minutes', about: prev.id }] },
      { id: 's_fin', title: 'Finance', items: [{ id: 'i_ytd', title: 'Year to date' }, { id: 'i_budget', title: 'The 2027 budget' }] },
    ],
  }), { by: 'test' });
  const ahead = await board.saveMeeting(env.DB, cleanMeeting({ date: NEXT_DAY, start: '08:00', end: '10:00', shared: false, attendance: [], sections: [{ id: 's_a1', title: 'Finance', items: [{ id: 'i_afin', title: 'Year to date' }] }] }), { by: 'test' });
  return { prev, held, ahead };
}
/** Held, Taylor's notes sent (the last meeting's vote tabled): the Word file the send kept, as draft minutes */
async function heldSent() {
  const ms = await meetings();
  await saveNotes(env, ms.held.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'n:i_budget': V1, 'm:i_prev': { by: 'Alex Rivera', second: 'Sam Ortiz', result: 'tabled' } } }, TAYLOR_W);
  const sent = await onPortal(TAYLOR, { action: 'notes-send', meetingId: ms.held.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const now = await board.getMeeting(env.DB, ms.held.id);
  const file = now.files.find((f) => f.kind === 'minutes');
  assert.ok(file, 'the send kept a Word file');
  return { ...ms, held: now, fileId: file.id };
}
/** A meeting today whose agenda approves the held one's minutes, for the secretary's approving send */
const approver = (held) => board.saveMeeting(env.DB, cleanMeeting({ date: inDays(0), start: '07:00', end: '07:30', shared: true, attendance: [], sections: [{ id: 's_n1', title: 'Call to order', items: [{ id: 'i_nmin', title: 'Approve the last meeting’s minutes', live: 'minutes', about: held.id }] }] }), { by: 'test' });
const APPROVE_ROUTES = {
  'Board’s approve': async ({ held }) => onAdmin({ action: 'approve-minutes', id: held.id, on: inDays(0) }),
  'Mark them approved': async ({ held }) => { const m = await board.getMeeting(env.DB, held.id); return onAdmin({ action: 'save-meeting', meeting: { ...m, minutes: 'approved', approvedOn: inDays(0) }, base: m.updatedAt }); },
  'the secretary’s approving send': async ({ held }) => {
    const next = await approver(held);
    await saveNotes(env, next.id, { changes: { 'r:alex-rivera': 'present', 'm:i_nmin': { by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' } } }, TAYLOR_W);
    return onPortal(TAYLOR, { action: 'notes-send', meetingId: next.id });
  },
};

/** The minutes' Word file as the site keeps it: its row, its bytes, what they say, and what the board page opens */
async function fileOf(id) {
  const m = await meetingRow(id);
  const rows = await sql("SELECT id, r2_key, sha256 FROM board_files WHERE owner_type = 'meeting' AND owner_id = ? AND kind = 'minutes'", id);
  const f = rows.find((x) => x.id === (m.approvedFile || rows[0]?.id)) || null;
  const bytes = f && files.has(f.r2_key) ? files.get(f.r2_key) : null;
  const text = bytes ? await textOf(bytes) : '';
  return {
    minutes: m.minutes || 'draft', count: rows.length, id: f?.id || '', approvedFile: m.approvedFile || '', key: f?.r2_key || '', sha: sha(bytes), rowSha: f?.sha256 || '',
    quorum: (/Quorum: [^\n]*/.exec(text) || [''])[0], next: (/Next meeting: [^\n]*/.exec(text) || [''])[0], votes: (/Approve the minutes of [^\n]*/.exec(text) || [''])[0],
    words: text.includes(V2) ? V2 : text.includes(V1) ? V1 : '',
  };
}
/** What Alex's board page opens as "The minutes as written" */
async function boardOpens(id) {
  const page = (await route(portal, '/api/board-portal', ALEX)).body?.meetings?.find((x) => x.id === id) || null;
  const pick = page ? minutesFileOf(page) : null;
  const opened = pick ? await route(boardFile, `/api/board-file?id=${pick.id}`, ALEX, { bytes: true }) : null;
  return { id: pick?.id || '', status: opened?.status || 0, sha: opened?.status === 200 ? sha(opened.bytes) : '' };
}
/** The lines the minutes state as they were written: Settings' quorum 3 of the 4 on the roll, the next meeting on its first day, the last meeting by its first name */
const STATED = {
  quorum: 'Quorum: 3 of 4 board members, here or on video.',
  next: `Next meeting: Q${Math.ceil(Number(NEXT_DAY.slice(5, 7)) / 3)} ${NEXT_DAY.slice(0, 4)} Board Meeting, ${longDate(NEXT_DAY)}, 8:00 AM`,
  votes: 'Approve the minutes of the Summer Board Meeting',
};
const statedWrong = (f) => ['quorum', 'next', 'votes'].filter((k) => f[k] !== STATED[k]).map((k) => `its file says “${f[k]}”, not “${STATED[k]}”`).join('; ');

/** Everything else changes: the next meeting moved a week (a founder's save), Settings' quorum to 2, the last meeting renamed */
async function everythingElse({ ahead, prev }) {
  const a = await board.getMeeting(env.DB, ahead.id);
  const moved = await onAdmin({ action: 'save-meeting', meeting: { ...a, date: MOVED_DAY }, base: a.updatedAt });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  await board.saveSettings(env.DB, { quorum: 2 }, FOUNDER);
  const p = await board.getMeeting(env.DB, prev.id);
  const renamed = await onAdmin({ action: 'save-meeting', meeting: { ...p, title: 'Q3 Board Meeting (rescheduled)' }, base: p.updatedAt });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
}
/** The heartbeat, whole, now and a month on (the minutes' meeting written more than 31 days before), and its minutes-file step alone */
async function heartbeats() {
  await board.maybeRunBoard(env).catch(() => {});
  await notesApi.maybeBringUpMinutesFiles(env);
  await board.maybeRunBoard(env, { now: Date.now() + 31 * 86_400_000 }).catch(() => {});
  await notesApi.maybeBringUpMinutesFiles(env, { now: Date.now() + 31 * 86_400_000 });
}

// ─── M1: approved minutes' Word file is their record ─────────────────

for (const [how, approve] of Object.entries(APPROVE_ROUTES)) {
  test(`M1: approved by ${how}, then the next meeting moved, Settings’ quorum changed, the last meeting renamed, the held meeting saved again (its room, then its words), and the heartbeat now and a month on: the approved Word file’s bytes and id are what was approved`, async () => {
    const ms = await heldSent();
    const r = await approve(ms);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const approved = await fileOf(ms.held.id);
    assert.equal(approved.minutes, 'approved');
    assert.equal(approved.approvedFile, ms.fileId, 'approved as the Word file the send kept');
    assert.equal(statedWrong(approved), '', 'approved saying what the minutes said');
    const opened = await boardOpens(ms.held.id);
    assert.deepEqual([opened.id, opened.status, opened.sha], [ms.fileId, 200, approved.sha], 'the board opens the approved file');
    const same = async (when) => {
      const now = await fileOf(ms.held.id);
      assert.deepEqual({ ...now }, { ...approved }, `${when}: the approved file is as it was approved`);
      assert.deepEqual(await boardOpens(ms.held.id), opened, `${when}: the board page opens the file as approved`);
    };
    await everythingElse(ms);
    await same('the next meeting moved, Settings changed, the last meeting renamed');
    await heartbeats();
    await same('after the heartbeat, now and a month on');
    // A founder's later saves of the held meeting: its room, then its words
    /* r15: approved minutes' place and words are what they state, so each save is refused in words with nothing changed
       (Board QA round 15, decided: "Round 14's tests that saved the held meeting's room after approval now expect that
       save refused in words with the file unchanged") */
    const STAY = 'These minutes are approved, so they can’t change here. Mark them as draft first to change them.';
    let m = await board.getMeeting(env.DB, ms.held.id);
    let sv = await onAdmin({ action: 'save-meeting', meeting: { ...m, location: 'Example Hall, Room 2' }, base: m.updatedAt });
    assert.deepEqual([sv.status, sv.body?.error], [409, STAY], JSON.stringify(sv.body));
    m = await board.getMeeting(env.DB, ms.held.id);
    sv = await onAdmin({ action: 'save-meeting', meeting: withWords(m, V2), base: m.updatedAt });
    assert.deepEqual([sv.status, sv.body?.error], [409, STAY], JSON.stringify(sv.body));
    const after = await board.getMeeting(env.DB, ms.held.id);
    assert.deepEqual([after.location, item(after, 'i_budget').notes, after.updatedAt], [m.location, V1, m.updatedAt], 'nothing changed');
    await same('the held meeting saved again');
    await heartbeats();
    await same('the heartbeat after those saves');
    assert.deepEqual(await looseBytes(ms.held.id), []);
  });
}

test('M1: the guard is one, where the Word file is made: approved minutes, as the site has them and as the step leaves them, never; a step that approves them or takes the approval back may', async () => {
  assert.equal(typeof notesApi.fileMayChange, 'function');
  assert.equal(notesApi.fileMayChange({ minutes: 'approved' }, { minutes: 'approved' }), false, 'approved, staying approved');
  assert.equal(notesApi.fileMayChange({ minutes: 'approved' }), false, 'a step that doesn’t say what was there: as it leaves them');
  assert.equal(notesApi.fileMayChange({ minutes: 'approved' }, { minutes: 'draft' }), true, 'approving them');
  assert.equal(notesApi.fileMayChange({ minutes: 'draft' }, { minutes: 'approved' }), true, 'taking the approval back');
  // Every way the file is made again goes through it: approved, and nothing is read, put or staged
  const ms = await heldSent();
  assert.equal((await onAdmin({ action: 'approve-minutes', id: ms.held.id, on: inDays(0) })).status, 200);
  await everythingElse(ms);
  const m = await board.getMeeting(env.DB, ms.held.id);
  const was = puts;
  assert.equal(await notesApi.stageMinutesFile(env, m), null, 'stageMinutesFile');
  assert.equal(await notesApi.minutesFileStep(env, m), null, 'minutesFileStep');
  assert.equal(await notesApi.freshMinutesFile(env, m), null, 'freshMinutesFile');
  assert.equal(await notesApi.refreshMinutesFile(env, m.id), false, 'refreshMinutesFile');
  assert.equal(puts, was, 'nothing put');
});

test('M1: approved, then a founder’s save of the held meeting (its room) after Settings and the next meeting changed, every statement failing in turn, every write landing with its answer lost, the put failing: saved or refused in words, and the approved file never changes', async () => {
  const ms = await heldSent();
  assert.equal((await onAdmin({ action: 'approve-minutes', id: ms.held.id, on: inDays(0) })).status, 200);
  const approved = await fileOf(ms.held.id);
  await everythingElse(ms);
  const m = await board.getMeeting(env.DB, ms.held.id);
  const mine = { ...m, location: 'Example Hall, Room 2' };
  const observe = async () => ({ location: (await meetingRow(ms.held.id)).location || '', file: await fileOf(ms.held.id) });
  /* r15: the place is what approved minutes state, so the control is refused in words with nothing changed, and so is
     every run; none ever lands (Board QA round 15, decided 3) */
  const STAY = 'These minutes are approved, so they can’t change here. Mark them as draft first to change them.';
  const out = await sweep('approved, saved again', saveState(), () => onAdmin({ action: 'save-meeting', meeting: mine, base: m.updatedAt }), async ({ mode, r, after }) => {
    const landed = after.location === mine.location;
    if (landed) return 'the place of approved minutes changed';
    if (!mode && !(r.status === 409 && said(r) === STAY)) return `the control: ${JSON.stringify(after.location)} (${r.status} “${said(r)}”)`;
    if (r.status === 409 && said(r) === STAY && r.body?.ok === false) return JSON.stringify(after.file) !== JSON.stringify(approved) ? 'the approved file changed' : '';
    if (JSON.stringify(after.file) !== JSON.stringify(approved)) return `the approved file changed: ${JSON.stringify(after.file).slice(0, 200)}`;
    await notesApi.maybeBringUpMinutesFiles(env);
    if (JSON.stringify(await fileOf(ms.held.id)) !== JSON.stringify(approved)) return 'the heartbeat changed the approved file';
    const loose = await looseBytes(ms.held.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return landed ? answeredDone(r) : refused(r);
  }, { observe });
  report(out, 10);
});

// ─── M2: a minutes file says only what the minutes say ───────────────

test('M2: the send keeps what the minutes state (Settings’ quorum, the next meeting, the meeting their vote is about) with its record, and its file says the same', async () => {
  const ms = await heldSent();
  const sent = JSON.parse((await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', ms.held.id))[0].sent);
  assert.deepEqual(sent.facts, { quorum: 3, next: { name: STATED.next.replace(/^Next meeting: /, '').split(', ')[0], when: STATED.next.replace(/^Next meeting: [^,]+, /, '') }, target: { id: ms.prev.id, name: 'Summer Board Meeting' } });
  assert.equal(statedWrong(await fileOf(ms.held.id)), '');
});

test('M2: draft minutes: the next meeting moved, Settings’ quorum changed, the last meeting renamed, the heartbeat now and a month on: their Word file never changes; a founder’s fix to their words is what changes it, saying what they stated; approved, the same', async () => {
  const ms = await heldSent();
  const sent = await fileOf(ms.held.id);
  assert.equal(statedWrong(sent), '');
  await everythingElse(ms);
  assert.deepEqual(await fileOf(ms.held.id), sent, 'Settings and other meetings never change the file');
  await heartbeats();
  assert.deepEqual(await fileOf(ms.held.id), sent, 'nor does the heartbeat: the file isn’t behind its own minutes');
  // Their own words changed (a founder's fix in Board): the file follows them, and still says what the minutes stated
  const m = await board.getMeeting(env.DB, ms.held.id);
  const sv = await onAdmin({ action: 'save-meeting', meeting: withWords(m, V2), base: m.updatedAt });
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  const fixed = await fileOf(ms.held.id);
  assert.equal(fixed.words, V2, 'the file follows their words');
  assert.equal(fixed.id, ms.fileId, 'the same file');
  assert.equal(statedWrong(fixed), '');
  await heartbeats();
  assert.deepEqual(await fileOf(ms.held.id), fixed);
  // Approved now: approved as the file that says what they say, with what they stated
  assert.equal((await onAdmin({ action: 'approve-minutes', id: ms.held.id, on: inDays(0) })).status, 200);
  const approved = await fileOf(ms.held.id);
  assert.deepEqual({ ...approved, minutes: 'draft', approvedFile: '' }, { ...fixed, approvedFile: '' });
  assert.deepEqual(await looseBytes(ms.held.id), []);
});

test('M2: older minutes, sent before their record kept what they state: made again (a founder’s fix to their words) as their file said it at its last write, never from Settings or the meetings as they are now', async () => {
  const ms = await heldSent();
  await raw.prepare("UPDATE board_minutes_notes SET sent = json_remove(sent, '$.facts') WHERE meeting_id = ?").bind(ms.held.id).run();
  const sent = await fileOf(ms.held.id);
  await everythingElse(ms);
  await heartbeats();
  assert.deepEqual(await fileOf(ms.held.id), sent, 'the heartbeat leaves it: it isn’t behind its own minutes');
  const m = await board.getMeeting(env.DB, ms.held.id);
  const sv = await onAdmin({ action: 'save-meeting', meeting: withWords(m, V2), base: m.updatedAt });
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  const fixed = await fileOf(ms.held.id);
  assert.equal(fixed.words, V2);
  assert.equal(statedWrong(fixed), '', 'what the file said at its last write');
});

// The presses that make the Word file again, swept after everything else changed: what they make says what the minutes
// stated, or nothing changed and the file is as it was

/** Held, sent, then everything else changed */
async function changedAround() {
  const ms = await heldSent();
  await everythingElse(ms);
  return ms;
}
const filesNow = (id) => async () => {
  const row = await meetingRow(id);
  return { words: item(row, 'i_budget')?.notes || '', approved: row.minutes === 'approved', file: await fileOf(id) };
};
/** The file as it is after a press: one minutes file, the same one, with bytes, saying the minutes' words and what they stated */
function fileWrong(after, ms, { words }) {
  const f = after.file;
  if (f.count !== 1) return `the meeting names ${f.count} minutes files`;
  if (f.id !== ms.fileId) return `the minutes file is ${f.id}, not ${ms.fileId}`;
  if (!f.sha || f.sha !== f.rowSha) return 'its bytes aren’t the ones its row names';
  if (f.words !== words) return `its file says “${f.words}”, the minutes “${words}”`;
  return statedWrong(f);
}

test('M2: a founder’s fix to draft minutes’ words after everything else changed, every statement failing in turn, every write landing with its answer lost, the put failing: the file says their words and what they stated, or nothing changed', async () => {
  const ms = await changedAround();
  const m = await board.getMeeting(env.DB, ms.held.id);
  const out = await sweep('draft fix', saveState(), () => onAdmin({ action: 'save-meeting', meeting: withWords(m, V2), base: m.updatedAt }), async ({ mode, r, after, failed }) => {
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after.words)} (${r.status})`;
    const wrong = fileWrong(after, ms, { words: after.words });
    if (wrong) return wrong;
    await notesApi.maybeBringUpMinutesFiles(env);
    const wrong2 = fileWrong(await filesNow(ms.held.id)(), ms, { words: after.words });
    if (wrong2) return `after the heartbeat, ${wrong2}`;
    const loose = await looseBytes(ms.held.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    if (landed) return answeredDone(r);
    if (/^put |^(lost: )?(batch: )?UPDATE board_meetings|FROM board_minutes_notes|FROM board_checkins|r2_key|^(lost: )?UPDATE board_files/.test(failed)) return refused(r, NOT_SAVED);
    return typeof r.status === 'number' && r.status >= 400 && r.body?.ok === false ? '' : `nothing landed, and it answered ${r.status}`;
  }, { observe: filesNow(ms.held.id) });
  report(out);
});

test('M2: older minutes (no kept record of what they state): a founder’s fix with every statement failing in turn, every write landing lost, the put and the file’s read failing: the file says their words and what it said before, or nothing changed, in words', async () => {
  const ms = await changedAround();
  await raw.prepare("UPDATE board_minutes_notes SET sent = json_remove(sent, '$.facts') WHERE meeting_id = ?").bind(ms.held.id).run();
  const m = await board.getMeeting(env.DB, ms.held.id);
  const out = await sweep('older fix', saveState(), () => onAdmin({ action: 'save-meeting', meeting: withWords(m, V2), base: m.updatedAt }), async ({ mode, r, after, failed }) => {
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after.words)} (${r.status})`;
    const wrong = fileWrong(after, ms, { words: after.words });
    if (wrong) return wrong;
    const loose = await looseBytes(ms.held.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    if (landed) return answeredDone(r);
    if (/^get |^put /.test(failed)) return refused(r, NOT_SAVED);
    return typeof r.status === 'number' && r.status >= 400 && r.body?.ok === false ? '' : `nothing landed, and it answered ${r.status}`;
  }, { observe: filesNow(ms.held.id), modes: ['fail', 'lose', 'put', 'get'] });
  report(out);
  assert.ok(out.failedSql.some((q) => /^get board\/meeting\//.test(q)), 'the file’s read failed in turn');
});

for (const [how, approve] of Object.entries(APPROVE_ROUTES)) {
  test(`M2: approved by ${how} after everything else changed, every statement failing in turn, every write landing with its answer lost, the put failing: approved as a file that says what the minutes stated, or not approved, in words`, async () => {
    const ms = await changedAround();
    // (the secretary's: the meeting whose vote approves them made first, so only the send is swept)
    const press = how === 'the secretary’s approving send' ? await (async () => {
      const next = await approver(ms.held);
      await saveNotes(env, next.id, { changes: { 'r:alex-rivera': 'present', 'm:i_nmin': { by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' } } }, TAYLOR_W);
      return () => onPortal(TAYLOR, { action: 'notes-send', meetingId: next.id });
    })() : how === 'Mark them approved' ? await (async () => {
      const m = await board.getMeeting(env.DB, ms.held.id);
      return () => onAdmin({ action: 'save-meeting', meeting: { ...m, minutes: 'approved', approvedOn: inDays(0) }, base: m.updatedAt });
    })() : () => approve(ms);
    const out = await sweep(how, saveState(), press, async ({ mode, r, after }) => {
      if (!mode && !(after.approved && r.status === 200)) return `the control: ${JSON.stringify(after.approved)} (${r.status})`;
      const wrong = fileWrong(after, ms, { words: V1 });
      if (wrong) return `${after.approved ? 'approved' : 'not approved'}, and ${wrong}`;
      if (after.approved && after.file.approvedFile !== ms.fileId) return `approved as ${after.file.approvedFile || 'no file'}`;
      await heartbeats();
      const wrong2 = fileWrong(await filesNow(ms.held.id)(), ms, { words: V1 });
      if (wrong2) return `after the heartbeat, ${wrong2}`;
      const loose = await looseBytes(ms.held.id);
      if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
      if (after.approved) return answeredDone(r);
      return how === 'the secretary’s approving send' ? refused(r) : refused(r, NOT_APPROVED);
    }, { observe: filesNow(ms.held.id) });
    report(out, 10);
  });
}

test('M2: a correction made after everything else changed, every statement failing in turn, every write landing with its answer lost, the put failing: the file says the corrected words and what the minutes stated, or nothing changed', async () => {
  const ms = await changedAround();
  const sug = await onPortal(SAM, { action: 'correction', meetingId: ms.held.id, target: 'n:i_budget', words: V2, was: V1 });
  assert.equal(sug.status, 200, JSON.stringify(sug.body));
  await maybeRunSigning(env).catch(() => {});
  const cid = sug.body.correction.id;
  const out = await sweep('correction made', saveState(), () => route(portal, '/api/board-portal', FOUNDER, { method: 'POST', body: { action: 'correction-decide', id: cid, make: true } }), async ({ mode, r, after }) => {
    const made = after.words === V2;
    if (!mode && !(made && r.status === 200)) return `the control: ${JSON.stringify(after.words)} (${r.status})`;
    const wrong = fileWrong(after, ms, { words: after.words });
    if (wrong) return wrong;
    const loose = await looseBytes(ms.held.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return made ? answeredDone(r) : refused(r);
  }, { observe: filesNow(ms.held.id) });
  report(out);
});

test('M2: the heartbeat bringing up a file left behind its own words (a write that didn’t carry it), after everything else changed, every statement failing in turn, every write landing lost, the put failing: brought up saying what the minutes stated, or left as it was', async () => {
  const ms = await changedAround();
  // (a write that didn't carry the file: the server's own, with no file store)
  await board.saveMeeting(env.DB, withWords(await board.getMeeting(env.DB, ms.held.id), V2), { by: FOUNDER });
  const out = await sweep('heartbeat', saveState(), async () => ({ status: 200, body: { n: await notesApi.maybeBringUpMinutesFiles(env) } }), async ({ mode, after }) => {
    const f = after.file;
    if (!mode && f.words !== V2) return 'the control didn’t bring it up';
    if (f.words === V1) return fileWrong({ file: { ...f } }, ms, { words: V1 });
    return fileWrong(after, ms, { words: V2 });
  }, { observe: filesNow(ms.held.id) });
  report(out, 5);
});

test('M2: the secretary sends again after everything else changed, every statement failing in turn, every write landing with its answer lost, the put failing: a send writes the minutes, so what they state is as it is now, kept with the record and said in the file; the heartbeat after changes nothing', async () => {
  const ms = await changedAround();
  await saveNotes(env, ms.held.id, { changes: { 'n:i_budget': V2 } }, TAYLOR_W);
  const now = {
    quorum: 'Quorum: 2 of 4 board members, here or on video.',
    next: `Next meeting: Q${Math.ceil(Number(MOVED_DAY.slice(5, 7)) / 3)} ${MOVED_DAY.slice(0, 4)} Board Meeting, ${longDate(MOVED_DAY)}, 8:00 AM`,
    votes: 'Approve the minutes of the Q3 Board Meeting (rescheduled)',
  };
  const kept = async () => {
    const row = (await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', ms.held.id))[0];
    return JSON.parse(row?.sent || '{}').facts || null;
  };
  const out = await sweep('send again', saveState(), () => onPortal(TAYLOR, { action: 'notes-send', meetingId: ms.held.id }), async ({ mode, r, after }) => {
    const landed = after.words === V2;
    if (!mode && !(landed && r.status === 200)) return `the control: ${JSON.stringify(after.words)} (${r.status})`;
    const f = after.file;
    if (f.count !== 1 || !f.sha || f.sha !== f.rowSha) return `${f.count} minutes files, or bytes that aren’t its row’s`;
    if (f.words !== after.words) return `its file says “${f.words}”, the minutes “${after.words}”`;
    const want = landed ? now : STATED;
    const wrong = ['quorum', 'next', 'votes'].filter((k) => f[k] !== want[k]).map((k) => `“${f[k]}”, not “${want[k]}”`).join('; ');
    if (wrong) return `its file says ${wrong}`;
    const facts = await kept();
    if (!facts || facts.quorum !== (landed ? 2 : 3)) return `the send’s record keeps ${JSON.stringify(facts)}`;
    await board.saveSettings(env.DB, { quorum: 5 }, FOUNDER);
    await heartbeats();
    const later = await fileOf(ms.held.id);
    if (later.sha !== f.sha) return 'a Settings change and the heartbeat after it changed the file';
    const loose = await looseBytes(ms.held.id);
    if (loose.length) return `bytes nobody names are left for good: ${loose.join(', ')}`;
    return landed ? answeredDone(r) : refused(r);
  }, { observe: filesNow(ms.held.id) });
  report(out);
});
