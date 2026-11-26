/**
 * Board QA round 15 (Nov 26 2026), the admin tester's findings 2 to 4.
 *   C2  Print prints the minutes the board page shows: one function says which minutes document the board reads now
 *       (board-shared.js minutesDocOf), and the board page's links, Print it all and the presenting screen go by it. A
 *       signed copy is the minutes only while they're approved and the signature is on their words as they stand;
 *       otherwise the Word file is, and the signed copy is only an earlier one (board/print.js minutesDocs)
 *   C3  A Staff only file is never the board's minutes, approved or not: minutesIn and minutesStaffOnly (board-shared.js)
 *       go by it for approved minutes too, so Board says round 14's staff-only words, Email the board is refused in them
 *       and the board page says they're approved and not shared yet, with nothing to read. Marking them approved still
 *       works, and the approval still holds them (no other file becomes their minutes)
 *   C4  A press whose answer is lost (pressSave) first checks the copy the page already has from Board's own try again
 *       (saved), and answers in its own words from it; "can't tell yet" only when neither that copy nor the looks can
 *       tell, so the words never go "Saved" then "can't tell"
 * The sweeps are round 14's: the same press from the same saved state, cleanly, then with each statement it makes failing
 * once in turn and each write landing with its answer lost (and, for the presses, the answer then lost on the way back
 * too, with Board's own try again); after each, what the database and the page hold, and the words said, agree.
 * Made-up people only (the repo is public). Run: node --test tests/board-round15-admin.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as portal from '../functions/api/board-portal.js';
import * as admin from '../functions/api/board-admin.js';
import * as board from '../functions/api/_board.js';
import { saveNotes } from '../functions/api/_board-notes.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import * as shared from '../public/admin/board-shared.js';
import * as editor from '../public/admin/board-meeting.js';
import * as print from '../public/admin/board/print.js';
import { minutesState } from '../public/admin/board/minutes.js';
import { call } from '../public/admin/board-ui.js';

const { cleanMeeting, todayEastern, minutesFileOf, minutesIn, itemFiles } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const KIM = 'kim.board@example.com';
// The words decided (written out, so a run on the code before them fails on what it says, never on an import)
const UNSURE = 'The site didn’t answer, so we can’t tell yet whether that was saved. Reload the page in a moment to see.';
const STAFF_ONLY = 'Minutes revised is staff only, so the board can’t read these minutes. To share them, switch it to Board sees it in Every file.';
const AS_A_FILE = 'The minutes are approved, so this was added as a file, not as the minutes. Mark them as draft first to replace them.';
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
const SETUP_DOWN = 'The site couldn’t open the board’s records just now. Please try again in a moment.';
const NOTHING = /nothing was (sent|changed|saved)/i;
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

// ─── The database not answering, once (round 14's) ──────────────────
// `fail`: the k-th statement the press makes fails before it runs. `lose`: the k-th write lands, and its answer is lost
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
let mail = [];
let later = [];
const realFetch = globalThis.fetch;
const asBytes = async (v) => new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : v instanceof Uint8Array ? v : await new Response(v).arrayBuffer());
const siteFetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) {
    const body = JSON.parse(init.body);
    for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '', subject: e.subject || '' });
    return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
  }
  return new Response('{}', { status: 503 });
};
beforeEach(async () => {
  fault = null;
  raw = await createD1();
  files.clear();
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test',
    FILES: {
      get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length, httpMetadata: {} } : null),
      put: async (k, v) => { files.set(k, await asBytes(v)); },
      delete: async (k) => { files.delete(k); },
      list: async ({ prefix = '' } = {}) => ({ objects: [...files.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key, size: files.get(key).length, uploaded: new Date() })), truncated: false }),
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
  globalThis.fetch = siteFetch;
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

/** A route behind the real sign-in middleware, as `who`; what it left running is finished before it answers here */
async function route(handler, path, who, { method = 'GET', body = null, form = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined),
  });
  const ctx = { request, env, data: {}, waitUntil: (p) => { later.push(p); } };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
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
const PDF = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x45, 0x4f, 0x46]);
const uploadTo = async (id, name, kind, { staffOnly = false } = {}) => {
  const form = new FormData();
  form.set('file', new File([PDF()], name, { type: 'application/pdf' }));
  form.set('ownerType', 'meeting'); form.set('ownerId', id); form.set('kind', kind); form.set('staffOnly', String(staffOnly));
  return route(admin, '/api/board-admin?upload=1', FOUNDER, { method: 'POST', form });
};
/** Alex's board page: the meeting as the board has it, who signed its minutes, and the parts not read */
async function alexPage(id) {
  const r = await route(portal, '/api/board-portal', ALEX);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  return { m: r.body.meetings.find((x) => x.id === id) || null, data: r.body };
}

const saveState = () => ({ bytes: raw._db.export(), files: new Map(files) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  later = [];
  mail = [];
}
/**
 * The press from `from`: cleanly (the control), then in each mode with its k-th statement going wrong once, k = 0, 1, …
 * until none is left. `judge({ mode, k, r, failed, before, after, control })` → '' or what's wrong
 */
async function sweep(name, from, press, judge, { observe, modes = ['fail', 'lose'], max = 400 }) {
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
      const after = await observe();
      if (!mode) control = { r, before, after };
      const why = await judge({ mode, k, r, failed, before, after, control });
      if (why) problems.push(`${name} ${mode || 'control'} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90)}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 220)}: ${why}`);
      runs += 1;
      if (failed) failedSql.push(failed);
    }
  }
  return { problems, runs, failedSql };
}
const report = (out, least = 2) => {
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

// ─── The meetings ───────────────────────────────────────────────────

const V1 = 'Budget passed at forty thousand.';
const V2 = 'Budget passed at fifty thousand.';
const withWords = (words) => (x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_budget' ? { ...it, notes: words } : it)) })) });
const saveAs = async (id, change) => {
  const m = await board.getMeeting(env.DB, id);
  const r = await onAdmin({ action: 'save-meeting', meeting: change(m), base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  return r.body.meeting;
};
/** The Dec 3 meeting moved to yesterday: Taylor's typed notes sent, the Word file the send kept saying "forty thousand" */
async function heldSent() {
  const m = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), start: '08:00', end: '10:00', shared: true,
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_ytd', title: 'Year to date' }, { id: 'i_budget', title: 'The 2027 budget' }] }],
  }), { by: 'test' });
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'n:i_budget': V1 } }, TAYLOR_W);
  const sent = await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const now = await board.getMeeting(env.DB, m.id);
  const file = now.files.find((f) => f.kind === 'minutes');
  assert.ok(file, 'the send kept a Word file');
  return { m: now, wordId: file.id };
}
/**
 * The tester's walk: typed minutes sent and approved with Board's Approve, Taylor signs them on the board page, a founder
 * keeps the signed copy (After the meeting → The signed copy → Upload it). → { id, wordId, signedId }
 */
async function signedAndKept() {
  const { m, wordId } = await heldSent();
  const ap = await onAdmin({ action: 'approve-minutes', id: m.id, on: inDays(0) });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const sg = await onPortal(TAYLOR, { action: 'sign-minutes', meetingId: m.id, mark: { type: 'typed', text: 'Taylor Nguyen', style: 'script' }, consent: true });
  assert.equal(sg.status, 200, JSON.stringify(sg.body));
  const up = await uploadTo(m.id, 'Signed minutes, Q4 2026 Board Meeting.pdf', 'signed');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.file.kind, 'signed');
  return { id: m.id, wordId, signedId: up.body.file.id };
}
/** What Print it all prints as the minutes for Alex (print.js minutesDocs, from the board page's data), and what the page links */
async function printed(id, { lostSigned = false } = {}) {
  const { m, data } = await alexPage(id);
  const d = lostSigned ? { ...data, minutesSigned: {}, unread: { ...(data.unread || {}), minutesSigned: true } } : data;
  assert.equal(typeof print.minutesDocs, 'function', 'print.js minutesDocs: the minutes as Print it all prints them');
  assert.equal(typeof shared.minutesDocOf, 'function', 'board-shared.js minutesDocOf: the one rule');
  const doc = shared.minutesDocOf(m, d.minutesSigned?.[id] || null, { known: !lostSigned });
  return { m, docs: print.minutesDocs(m, d).map((x) => [x.label, x.f.id]), doc, signature: d.minutesSigned?.[id] || null };
}

// ─── C2: Print prints the minutes the board page shows ──────────────

test('C2: minutes taken back to draft and changed (the tester’s walk): Print prints the Word file as “The minutes as written”, the one the board page links, and the old signed copy only as an earlier one; never “The minutes, signed”', async () => {
  const { id, wordId, signedId } = await signedAndKept();
  // Approved and signed, the words as signed: the signed copy is the minutes, and the Word file beside it
  let p = await printed(id);
  assert.deepEqual(p.docs, [['The minutes, signed', signedId]], 'approved, the signature on their words: the signed copy');
  assert.deepEqual([p.doc.written?.id, p.doc.copy?.id, p.doc.copyWords], [wordId, signedId, 'The signed copy']);
  // Mark as draft (the words not changed yet): no longer the minutes as approved, so the signed copy isn't them
  await saveAs(id, (x) => ({ ...x, minutes: 'draft', approvedOn: '' }));
  p = await printed(id);
  assert.deepEqual(p.docs, [['The minutes as written', wordId], ['An earlier signed copy', signedId]], 'draft: the Word file, then the signed copy as an earlier one');
  // A founder fixes a word: the page says "The minutes changed after that"; Print agrees with the page
  await saveAs(id, withWords(V2));
  p = await printed(id);
  assert.equal(p.signature?.changed, true, 'the board page says the minutes changed after the signature');
  assert.equal(p.m.minutes, 'draft');
  assert.equal(minutesFileOf(p.m)?.id, wordId, 'the board page’s “The minutes as written”');
  assert.deepEqual(p.docs, [['The minutes as written', wordId], ['An earlier signed copy', signedId]]);
  assert.equal(p.doc.file.id, minutesFileOf(p.m).id, 'the one rule names the file the board page links');
  assert.equal(p.doc.copyWords, 'An earlier signed copy', 'the board page’s link to it, in the same words');
  // Approved again with the changed words: approved, but the signature is on the old ones, so still the Word file
  const ap = await onAdmin({ action: 'approve-minutes', id, on: inDays(0) });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  p = await printed(id);
  assert.equal(p.signature?.changed, true);
  assert.deepEqual(p.docs, [['The minutes as written', wordId], ['An earlier signed copy', signedId]], 'approved again, the signature on old words: never “The minutes, signed”');
});

test('C2: who signed not read just now: Print never takes the signed copy for the minutes (it can’t tell whether the signature is on their words); a signed copy put in by hand, with no signature on record, stands for approved minutes as ever', async () => {
  const { id, wordId, signedId } = await signedAndKept();
  const p = await printed(id, { lostSigned: true });
  assert.deepEqual(p.docs, [['The minutes as written', wordId], ['The signed copy', signedId]], 'not known: the Word file is the minutes, the signed copy named as it is');
  // (a hand-kept signed copy, nobody signed on the board page: approved, it stands for them)
  const { m, wordId: w2 } = await heldSent();
  const ap = await onAdmin({ action: 'approve-minutes', id: m.id, on: inDays(0) });
  assert.equal(ap.status, 200);
  const up = await uploadTo(m.id, 'Signed minutes.pdf', 'signed');
  assert.equal(up.status, 200);
  const q = await printed(m.id);
  assert.equal(q.signature, null, 'no signature on record');
  assert.deepEqual(q.docs, [['The minutes, signed', up.body.file.id]]);
  assert.equal(q.doc.written.id, w2);
  // (taken back to draft: the hand-kept copy isn't them any more)
  await saveAs(m.id, (x) => ({ ...x, minutes: 'draft', approvedOn: '' }));
  assert.deepEqual((await printed(m.id)).docs, [['The minutes as written', w2], ['An earlier signed copy', up.body.file.id]]);
});

test('C2: the presenting screen and the next meeting’s “approve the minutes” item go by the same rule: the minutes as written, never a signed copy taken for them', async () => {
  const { id, wordId } = await signedAndKept();
  await saveAs(id, (x) => ({ ...x, minutes: 'draft', approvedOn: '' }));
  await saveAs(id, withWords(V2));
  const next = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(0), start: '07:00', end: '09:00', shared: true,
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [{ id: 's_open', title: 'Opening', items: [{ id: 'i_mins', title: 'Approve the last meeting’s minutes', live: 'minutes', about: id }] }],
  }), { by: 'test' });
  // (the screen's view, from the site: the last meeting's minutes for the item that approves them)
  const view = await board.liveView(env, next.id, { admin: true, adminEmail: FOUNDER });
  const prior = view.prior.find((x) => x.id === id);
  assert.deepEqual(prior.files.map((f) => f.id), [wordId], 'the screen: the Word file');
  const it = view.sections[0].items[0];
  assert.deepEqual(itemFiles(view, it, view.prior).map((f) => f.id), [wordId], 'the screen’s item');
  // (the board page's item, and Print's, from the board page's meetings)
  const { data } = await alexPage(next.id);
  const pageNext = data.meetings.find((x) => x.id === next.id);
  assert.deepEqual(itemFiles(pageNext, pageNext.sections[0].items[0], data.meetings).map((f) => f.id), [wordId], 'the board page’s item');
});

// ─── C3: a staff-only file is never the board's minutes, approved or not ─

/** Held Jun 29 with no minutes; Every file → Add files "Minutes revised.pdf" filed as Minutes, Staff only */
async function staffOnlyMinutes() {
  const m = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-150), start: '08:00', end: '10:00', shared: true, attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [{ id: 's_a', title: 'Reports', items: [{ id: 'i_a', title: 'Treasurer' }] }],
  }), { by: 'test' });
  const up = await uploadTo(m.id, 'Minutes revised.pdf', 'minutes', { staffOnly: true });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.file.staffOnly, true);
  return { m: await board.getMeeting(env.DB, m.id), fileId: up.body.file.id };
}
const APPROVALS = [
  ['Mark them approved', (m) => onAdmin({ action: 'save-meeting', meeting: { ...m, minutes: 'approved', approvedOn: inDays(0) }, base: m.updatedAt })],
  ['Board’s Approve', (m) => onAdmin({ action: 'approve-minutes', id: m.id, on: inDays(0) })],
];

for (const [how, approve] of APPROVALS) {
  test(`C3: minutes kept only as a Staff only file, approved by ${how}: approved as that file, still not in (the staff-only words, never “The board can read them now”); the board page has them approved, not shared yet, nothing to read`, async () => {
    const { m, fileId } = await staffOnlyMinutes();
    const r = await approve(m);
    assert.equal(r.status, 200, `marking them approved still works: ${JSON.stringify(r.body)}`);
    const now = await board.getMeeting(env.DB, m.id);
    assert.equal(now.minutes, 'approved');
    assert.equal(now.approvedFile, fileId, 'approved as that file');
    assert.equal(minutesIn(now), false, 'not in: the board can’t read them');
    assert.equal(shared.minutesStaffOnly(now)?.id, fileId, 'staff only, said with their file');
    assert.equal(shared.staffOnlyWords(shared.minutesStaffOnly(now)), STAFF_ONLY);
    // (the status line says approved, as ever)
    const data = { approvals: {}, meetings: [now], members: [], settings: { admins: [] }, minutesTypedBy: {} };
    assert.match(editor.pathOf(now, data, 'held').find((s) => s.id === 'minutes').sub, /^Approved/);
    // The board page: approved, not shared yet, nothing offered to read
    const { m: page } = await alexPage(m.id);
    assert.equal(minutesState(page), 'approved');
    assert.equal(shared.approvedNotShared(page), true, 'the board page says they aren’t shared yet');
    assert.equal(minutesIn(page), false);
    assert.equal(minutesFileOf(page), null, 'no “The minutes as written”');
    assert.equal(shared.minutesDocOf(page).file, null, 'nothing for Print to print as the minutes');
    assert.equal(shared.minutesStaffOnly(page), null, 'the board’s copy names no staff-only file');
  });

  test(`C3: Email the board for approved minutes kept Staff only (${how}) is refused in the staff-only words, every statement failing in turn, every write lost: nobody is emailed`, async () => {
    const { m } = await staffOnlyMinutes();
    assert.equal((await approve(m)).status, 200);
    const observe = async () => ({ sentAt: (await meetingRow(m.id)).minutesSentAt || '' });
    const from = saveState();
    for (const test of [false, true]) {
      const out = await sweep(`minutes notice, approved, staff only${test ? ' (Send me the email)' : ''}`, from, () => onAdmin({ action: 'send-minutes', id: m.id, test }), async ({ mode, r, after }) => {
        if (mail.length) return `${mail.length} emailed: ${mail.map((x) => `${x.to.join(',')} ${x.subject}`).join(' | ')}`;
        if (after.sentAt) return 'the meeting says the board was told';
        if (!mode) return r.status === 409 && r.body?.error === STAFF_ONLY ? '' : `the control: ${r.status} “${said(r)}”`;
        // (a read that failed before it could tell: refused in words that say nothing was sent; else the staff-only words)
        return r.status === 409 && said(r) === STAFF_ONLY ? '' : refused(r);
      }, { observe });
      report(out);
    }
    // Switched to Board sees it: in, the board page reads it as the minutes, and the email goes
    const fid = (await board.getMeeting(env.DB, m.id)).files[0].id;
    assert.equal((await onAdmin({ action: 'update-file', id: fid, staffOnly: false })).status, 200);
    const shown = await board.getMeeting(env.DB, m.id);
    assert.equal(minutesIn(shown), true);
    assert.equal(shared.minutesStaffOnly(shown), null);
    const { m: page } = await alexPage(m.id);
    assert.equal(minutesFileOf(page)?.id, fid);
    assert.equal(shared.approvedNotShared(page), false);
    const r = await onAdmin({ action: 'send-minutes', id: m.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(mail.filter((x) => x.kind !== 'board-minutes-test').length >= 1, true);
  });
}

test('C3: the approval still holds approved staff-only minutes: a new minutes file is kept as a file, never their minutes, and their own file stays theirs', async () => {
  const { m, fileId } = await staffOnlyMinutes();
  assert.equal((await APPROVALS[1][1](m)).status, 200);
  const up = await uploadTo(m.id, 'Minutes final.pdf', 'minutes');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.file.kind, 'other', 'kept as an ordinary file');
  assert.equal(up.body.asFile, AS_A_FILE, 'said so');
  const now = await board.getMeeting(env.DB, m.id);
  assert.equal(shared.approvedFileOf(now), fileId);
  assert.equal(minutesIn(now), false, 'still staff only');
  assert.equal(minutesFileOf((await alexPage(m.id)).m), null, 'the board page never takes another file in its place');
});

test('C3: approved typed minutes whose Word file is switched to Staff only are still in: the board reads their words on its page, so Email the board goes (only a file the board can’t read is held back)', async () => {
  const { m, wordId } = await heldSent();
  assert.equal((await onAdmin({ action: 'approve-minutes', id: m.id, on: inDays(0) })).status, 200);
  const sw = await onAdmin({ action: 'update-file', id: wordId, staffOnly: true });
  assert.equal(sw.status, 200, JSON.stringify(sw.body));
  const now = await board.getMeeting(env.DB, m.id);
  assert.equal(minutesIn(now), true);
  assert.equal(shared.minutesStaffOnly(now), null);
  assert.equal(shared.approvedNotShared(now), false);
  const r = await onAdmin({ action: 'send-minutes', id: m.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

// ─── C4: a lost press answers from the copy the page already has ────

/** The meeting page's pieces a pressed change goes through, as round 14's B3 rig, with Board's own try again (useAutosave) */
function pressRig({ site, retryIn = 1, lookFails = 99 }) {
  const page = { minutes: site.before.minutes, approvedOn: site.before.approvedOn, shared: site.before.shared };
  const saved = { current: { ...site.before } };
  const toasts = [];
  let looks = 0;
  // (Board's own try again: the same save sent again, whose answer comes back with the site's copy: "Saved", and the
  // copy is the page's from the site now)
  const retry = () => { site.landed = { ...site.before, minutes: page.minutes, approvedOn: page.approvedOn, shared: page.shared, updatedAt: '2026-11-26T10:00:05.000Z' }; saved.current = { ...site.landed }; toasts.push('Saved'); };
  return {
    page, toasts, saved, get looks() { return looks; },
    p: {
      set: (patch) => Object.assign(page, typeof patch === 'function' ? patch(page) : patch),
      saved,
      addToast: (t) => toasts.push(t),
      save: async ({ own }) => { site.landed = { ...site.before, ...(site.lands ? { minutes: page.minutes, approvedOn: page.approvedOn, shared: page.shared } : {}) }; own({ ok: false, unknown: true, error: 'No answer came back from the site. Try again in a moment.' }); return null; },
      // (`retryIn`: which look the try again's answer comes back during: 1, the first; 2, the second; 0, never)
      look: async () => { looks += 1; if (looks === retryIn) retry(); if (looks <= lookFails) return null; return site.landed; },
      take: (sv) => { saved.current = { ...sv }; Object.assign(page, { minutes: sv.minutes, approvedOn: sv.approvedOn, shared: sv.shared }); },
    },
  };
}
const PRESSES = {
  approve: { before: { minutes: 'draft', approvedOn: '', shared: true }, patch: () => ({ minutes: 'approved', approvedOn: inDays(0) }), opts: { has: (sv) => sv.minutes === 'approved', back: (sv) => ({ minutes: sv.minutes, approvedOn: sv.approvedOn }), what: 'Not marked approved', again: 'Mark them approved again' } },
  draft: { before: { minutes: 'approved', approvedOn: inDays(-1), shared: true }, patch: () => ({ minutes: 'draft', approvedOn: '' }), opts: { has: (sv) => sv.minutes !== 'approved', back: (sv) => ({ minutes: sv.minutes, approvedOn: sv.approvedOn }), what: 'Still approved', again: 'Mark them as draft again' } },
  share: { before: { minutes: 'draft', approvedOn: '', shared: false }, patch: () => ({ shared: true }), opts: { has: (sv) => sv.shared === true, back: (sv) => ({ shared: sv.shared }), what: 'Not on the board page', again: 'Share it again' } },
  takeoff: { before: { minutes: 'draft', approvedOn: '', shared: true }, patch: () => ({ shared: false }), opts: { has: (sv) => sv.shared === false, back: (sv) => ({ shared: sv.shared }), what: 'Still on the board page', also: 'The board can still see it.', again: 'Take it off again' } },
};
const noUnsureAfterSaved = (toasts) => { const i = toasts.indexOf('Saved'); return i < 0 || !toasts.slice(i).includes(UNSURE); };

for (const [name, pr] of Object.entries(PRESSES)) {
  for (const [lands, retryIn] of [[true, 1], [false, 1], [true, 2], [false, 2]]) {
    test(`C4: ${name}, its answer lost (${lands ? 'landed' : 'never reached the site'}), both looks failing, Board’s own try again answering during look ${retryIn}: the press is settled from the copy the page has, in its own words; never “Saved” then “can’t tell”`, async () => {
      const site = { before: { ...pr.before, updatedAt: '2026-11-26T10:00:00.000Z' }, lands };
      const rig = pressRig({ site, retryIn });
      const went = await editor.pressSave(rig.p, pr.patch(), pr.opts);
      assert.equal(went, true, `the site has it: the press says its own words (${JSON.stringify(rig.toasts)})`);
      assert.ok(pr.opts.has(rig.page), 'the page shows it as the site has it');
      assert.deepEqual(rig.toasts, ['Saved'], 'only the save line’s “Saved”: never “can’t tell yet”');
      assert.ok(noUnsureAfterSaved(rig.toasts));
    });
  }
}

test('C4: the copy the page has already shows the press done when its answer is lost: settled at once, with no look', async () => {
  const pr = PRESSES.approve;
  const site = { before: { ...pr.before, updatedAt: '2026-11-26T10:00:00.000Z' }, lands: true };
  const rig = pressRig({ site, retryIn: 0 });
  // (Board's own try again had the site's answer before the lost one was told: the copy says approved)
  rig.p.save = async ({ own }) => { rig.saved.current = { ...site.before, minutes: 'approved', approvedOn: inDays(0), updatedAt: '2026-11-26T10:00:05.000Z' }; own({ ok: false, unknown: true }); return null; };
  assert.equal(await editor.pressSave(rig.p, pr.patch(), pr.opts), true);
  assert.equal(rig.looks, 0, 'no look needed');
  assert.deepEqual(rig.toasts, []);
});

test('C4: neither the copy nor the looks can tell (Board’s own try again not back yet, both looks failing): “can’t tell yet”, and nothing put back that the site may have', async () => {
  for (const [name, pr] of Object.entries(PRESSES)) {
    const site = { before: { ...pr.before, updatedAt: '2026-11-26T10:00:00.000Z' }, lands: true };
    const rig = pressRig({ site, retryIn: 0 });
    assert.equal(await editor.pressSave(rig.p, pr.patch(), pr.opts), false, name);
    assert.deepEqual(rig.toasts, [UNSURE], name);
    assert.ok(pr.opts.has(rig.page), `${name}: as pressed, never put back`);
    assert.equal(rig.looks, 2, `${name}: it looked twice`);
  }
});

test('C4: one look failing (the tester’s control): the second look settles it, as round 14 has it', async () => {
  for (const [name, pr] of Object.entries(PRESSES)) {
    for (const lands of [true, false]) {
      const site = { before: { ...pr.before, updatedAt: '2026-11-26T10:00:00.000Z' }, lands };
      const rig = pressRig({ site, retryIn: 0, lookFails: 1 });
      const went = await editor.pressSave(rig.p, pr.patch(), pr.opts);
      assert.equal(went, lands, `${name} ${lands}`);
      assert.deepEqual(rig.toasts, lands ? [] : [`${pr.opts.what}: the site didn’t answer, so that wasn’t saved.${pr.opts.also ? ` ${pr.opts.also}` : ''} ${pr.opts.again}.`], `${name} ${lands}`);
    }
  }
});

// ─── C4: the presses on the real site, every statement failing in turn ─

/**
 * The meeting page as it saves a pressed change (MeetingEditor's useAutosave, as far as a press goes): the page's copy and
 * the site's copy as last seen (saved), each save through the page's own call() onto the real handlers, merged once
 * when the site has a newer copy (409), and Board's own try again after an answer lost on the way back (a gateway's 502:
 * `gateway`, 'after' the site did its work, or 'before' it ever reached it). Board's looks fail (`looksFail`), so only
 * the copy the try again brought can settle a lost answer. → the pieces pressSave takes, and what was said
 */
function sitePage(m0, { gateway = '', looksFail = true } = {}) {
  let page = cleanMeeting(m0);
  const saved = { current: cleanMeeting(m0) };
  let base = m0.updatedAt;
  const toasts = [];
  let failing = 0;
  let retryDue = false;
  let saves = 0;
  // (the page's own fetch onto the real handlers; the first save's answer cut as `gateway` says)
  const pageFetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (!url.startsWith('/api/')) return siteFetch(input, init);
    const cut = saves === 1 && !cutDone ? gateway : '';
    if (cut) cutDone = true;
    if (cut === 'before') return new Response('<html>502 Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    const r = await route(admin, url, FOUNDER, { method: init.method || 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (cut === 'after') return new Response('<html>502 Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    return Response.json(r.body, { status: r.status });
  };
  let cutDone = false;
  const send = async () => {
    saves += 1;
    globalThis.fetch = pageFetch;
    try {
      let j = await call({ action: 'save-meeting', meeting: page, base });
      if (j.status === 409 && j.current) {
        // (saved meanwhile: the site's copy, with what's pressed here on it, goes again)
        const theirs = cleanMeeting(j.current);
        page = cleanMeeting({ ...theirs, minutes: page.minutes, approvedOn: page.approvedOn, shared: page.shared });
        saved.current = theirs;
        base = theirs.updatedAt;
        j = await call({ action: 'save-meeting', meeting: page, base });
      }
      return j;
    } finally { globalThis.fetch = siteFetch; }
  };
  const took = (j) => { saved.current = cleanMeeting(j.meeting); base = j.meeting.updatedAt; page = cleanMeeting(j.meeting); if (failing) toasts.push('Saved'); failing = 0; };
  return {
    toasts, saved, get page() { return page; },
    p: {
      set: (patch) => { page = cleanMeeting({ ...page, ...(typeof patch === 'function' ? patch(page) : patch) }); },
      saved,
      addToast: (t) => toasts.push(t),
      save: async ({ own }) => {
        const j = await send();
        if (j.ok) { took(j); return j; }
        // (refused for good by name: put back as the site has it, said in its words, never the press's own)
        if (j.status === 409 && Array.isArray(j.refused)) {
          const sv = j.meeting ? cleanMeeting(j.meeting) : saved.current;
          page = cleanMeeting({ ...page, ...Object.fromEntries(j.refused.map((f) => [f, sv[f]])) });
          toasts.push(`${j.refused.includes('shared') ? (sv.shared ? 'Still on the board page' : 'Not on the board page') : j.refused.includes('minutes') ? (sv.minutes === 'approved' ? 'Still approved' : 'Not marked approved') : 'Not saved'}: ${j.error}`);
          return j;
        }
        failing += 1;
        if (j.unknown) retryDue = true;
        own(j);
        return j;
      },
      // (Board's look fails; Board's own try again, due after an answer lost, comes back while it's out)
      look: async () => {
        if (retryDue) { retryDue = false; const j = await send(); if (j.ok) took(j); }
        if (looksFail) return null;
        return cleanMeeting(await board.getMeeting(env.DB, m0.id));
      },
      take: (sv) => { saved.current = cleanMeeting(sv); base = sv.updatedAt; page = cleanMeeting(sv); },
    },
  };
}
/** The four presses pressSave carries, each from the state the tester pressed it in */
const SITE_PRESSES = [
  ['Mark them approved', async () => (await heldSent()).m, PRESSES.approve, (row) => row.minutes === 'approved'],
  ['Mark as draft', async () => { const { m } = await heldSent(); assert.equal((await onAdmin({ action: 'approve-minutes', id: m.id, on: inDays(0) })).status, 200); return board.getMeeting(env.DB, m.id); }, PRESSES.draft, (row) => row.minutes !== 'approved'],
  ['Take it off', async () => (await heldSent()).m, PRESSES.takeoff, (row) => row.shared === false],
  ['Share with the board', async () => { const { m } = await heldSent(); await saveAs(m.id, (x) => ({ ...x, shared: false })); return board.getMeeting(env.DB, m.id); }, PRESSES.share, (row) => row.shared === true],
];
for (const [how, setup, pr, landedOf] of SITE_PRESSES) {
  test(`C4: ${how} on the real site, each statement failing once in turn and each write landing with its answer lost, and then the answer lost on the way back too (Board’s own try again answering, the looks failing): the words say what the site has, never “Saved” then “can’t tell”`, async () => {
    const m = await setup();
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, Math.min(ms, 1), ...a);
    // (each way from the same saved state)
    const from = saveState();
    try {
      for (const gateway of ['', 'after', 'before']) {
        const observe = async () => ({});
        const out = await sweep(`${how}${gateway ? `, the answer lost ${gateway === 'after' ? 'on the way back' : 'before it reached the site'}` : ''}`, from, async () => {
          // (the page as it opened, read before anything goes wrong)
          const f = fault;
          fault = null;
          const m0 = await board.getMeeting(env.DB, m.id);
          fault = f;
          const rig = sitePage(m0, { gateway });
          const went = await editor.pressSave(rig.p, pr.patch(), pr.opts);
          return { status: 200, body: { went, toasts: rig.toasts, page: { minutes: rig.page.minutes, shared: rig.page.shared }, copyHas: pr.opts.has(rig.saved.current) } };
        }, async ({ mode, r }) => {
          const row = await meetingRow(m.id);
          const landed = landedOf(row);
          if (r.status !== 200) return `the press threw: ${JSON.stringify(r.body)}`;
          const { went, toasts, page, copyHas } = r.body;
          if (!mode && !(landed && went && toasts.every((t) => t === 'Saved'))) return `the control: ${JSON.stringify(r.body)}`;
          if (!noUnsureAfterSaved(toasts)) return `“Saved”, then “can’t tell”: ${JSON.stringify(toasts)}`;
          // (neither the copy Board's own try again brought nor a look could tell: "can't tell yet", and the page as pressed)
          if (toasts.includes(UNSURE)) {
            if (copyHas) return `the page’s copy from the site shows it done, and it said it can’t tell: ${JSON.stringify(toasts)}`;
            if (went || toasts.filter((t) => t !== 'Saved').length !== 1) return `it can’t tell, and it said ${JSON.stringify(r.body)}`;
            return pr.opts.has(page) ? '' : 'it can’t tell, and the page was put back';
          }
          if (pr.opts.has(page) !== landed) return `the page shows ${JSON.stringify(page)}, the site has ${JSON.stringify({ minutes: row.minutes, shared: row.shared })}`;
          if (landed) {
            if (!went) return `the site has it, and the press says ${JSON.stringify(toasts)}`;
            if (toasts.some((t) => t !== 'Saved')) return `the site has it, and it said ${JSON.stringify(toasts)}`;
            return '';
          }
          if (went) return 'the site hasn’t got it, and the press answers as done';
          const own = toasts.filter((t) => t !== 'Saved');
          if (own.length !== 1 || !own[0].startsWith(`${pr.opts.what}: `) || own[0] === UNSURE) return `the site hasn’t got it, and it said ${JSON.stringify(toasts)}`;
          return NOTHING.test(own[0]) || /wasn’t saved/.test(own[0]) || /couldn’t/.test(own[0]) ? '' : `not said as not saved: ${own[0]}`;
        }, { observe });
        report(out);
      }
    } finally { globalThis.setTimeout = realTimeout; }
  });
}
