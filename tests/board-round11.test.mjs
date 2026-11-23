/**
 * Board QA round 11 (Nov 23 2026): an answer never says less than what happened, and a press's work lands whole or not
 * at all. The privacy tester's findings 1, 2, 5, 8 and 12, and the admin tester's 3, 4 and 5:
 *   F1  who was asked to answer the invite is a label on the founders' card: every meeting read carries the send's own
 *       record by email, and People is never read for it, so one failed read of People never fails a meeting read; and
 *       the presses that do their work and then read for their answer (the reminder, Email the board, the minutes
 *       notice, Ask to sign, Send the invite, Approve the agenda) answer with what was done
 *   F2  a correction decided: every read first, then the minutes, the notes' record, the decision and the notice owed
 *       to whoever suggested it, in one step; never stuck "being made", never "nothing was changed" once it's made
 *   F5  Send the minutes: the notes, the last minutes' approval, the Word file and the send's record in one step; a
 *       failure leaves none of it, and never deletes a file a meeting names
 *   F8  the to-do reminders' hour is marked only with their sends: a failed read loses no hour of them, and the next
 *       look sends each once
 *   F12 the board page opens when its visit can't be kept (a line missed)
 *   A3  Ask to sign goes once whoever presses: two tabs, or one member's own ask, at any spacing
 *   A4  Approve the agenda reads everything that decides who gets it before the approval is written
 *   A5  a send refused because People couldn't be read says "so nothing was sent"
 * The sweeps are the testers' (lib11.mjs sweep): the same press from the same saved state, once cleanly and then with
 * each statement it makes (each read, or every statement at all) failing once in turn, and the answer's words held to
 * what the database and the fakes show happened. Made-up people only (the repo is public).
 * Run: node --test tests/board-round11.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as board from '../functions/api/_board.js';
import { saveNotes } from '../functions/api/_board-notes.js';
import { maybeRemindActions } from '../functions/api/_board-actions.js';
import { maybeRunSigning } from '../functions/api/_board-sign.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import * as shared from '../public/admin/board-shared.js';

const { cleanMeeting, todayEastern } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const KIM = 'kim.board@example.com';
const BOARD = [ALEX, SAM, TAYLOR, KIM];
// (round 9's and 10's words: ./functions/api/_board-roles.js)
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
const PEOPLE_DOWN = 'We couldn’t check People just now, so nothing was changed. Please try again in a moment.';
const PEOPLE_DOWN_SENT = 'We couldn’t check People just now, so nothing was sent. Please try again in a moment.';
const NOTHING = /nothing was (sent|changed)/i;
const MIN = 60_000;
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
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const GOOGLE_KEY = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', private_key: PEM, token_uri: 'https://oauth2.googleapis.com/token' });
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', seat: 'chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['kim-park', KIM]];

// ─── The database not answering one statement ───────────────────────
// Every statement the press makes is counted (one in a batch too, which then fails whole, as D1's does), and the k-th
// that `test` picks fails once
let raw;
let fault = null; // { test, k, seen, failed }
const READ = (sql) => /^\s*(SELECT|WITH)\b/i.test(sql);
const ANY = () => true;
const PEOPLE_SQL = /\bteam\b|reveal_board_emails/;
function check(sql) {
  if (!fault || !fault.test(String(sql || ''))) return;
  const i = fault.seen++;
  if (i === fault.k) { fault.failed.push(String(sql)); throw new Error('D1_ERROR: Network connection lost.'); }
}
const wrap = (st) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => { check(s._sql); return s[m](...a); } : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
// (one per test, over whichever database `raw` is now: a saved state put back keeps the same one, and what's ready on it)
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => { for (const s of stmts) check(s._sql); return raw.batch(stmts); }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});

let env;
const files = new Map();
let google; // { events, calls }
let mail; // every email Resend took: { to, subject, kind }
let resendSeen;
let resendDelay = 0;
let later = [];
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
  raw = await createD1();
  files.clear();
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', GOOGLE_CALENDAR_KEY: GOOGLE_KEY,
    FILES: { get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length } : null), put: async (k, v) => { files.set(k, new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); }, delete: async (k) => { files.delete(k); } },
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
  clearTokenCache();
  google = { events: {}, calls: [] };
  mail = [];
  resendSeen = new Set();
  resendDelay = 0;
  later = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      if (resendDelay) await new Promise((r) => setTimeout(r, resendDelay));
      const key = init.headers?.['Idempotency-Key'] || '';
      if (key && resendSeen.has(key)) return new Response('{}', { status: 409 });
      if (key) resendSeen.add(key);
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), subject: e.subject, kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '' });
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      const u = new URL(url);
      google.calls.push({ method, url, body });
      if (method === 'GET' && u.pathname.endsWith('/events')) return Response.json({ items: [] });
      const id = decodeURIComponent(u.pathname.split('/').pop());
      if (method === 'POST') {
        const e = { ...body, status: 'confirmed', hangoutLink: 'https://meet.google.com/abc-defg-hij', attendees: (body.attendees || []).map((a) => ({ ...a, responseStatus: 'needsAction' })) };
        google.events[e.id] = e;
        return Response.json(e);
      }
      const e = google.events[id];
      if (!e) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
      if (method === 'PATCH') Object.assign(e, body, body.attendees ? { attendees: body.attendees.map((a) => ({ responseStatus: 'needsAction', ...(e.attendees || []).find((x) => x.email === a.email), ...a })) } : {});
      return Response.json(e);
    }
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

/** A route behind the real sign-in middleware, as `who`; what it left running is finished before it answers here */
async function route(handler, path, who, { method = 'GET', body = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
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
const api = (body) => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body });
const onPortal = (who, body) => route(portal, '/api/board-portal', who, { method: 'POST', body });
const sql = async (q, ...b) => (await raw.prepare(q).bind(...b).all()).results || [];
const meetingRow = async (id) => { const r = (await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0]; return r ? JSON.parse(r.data) : null; };
const kinds = (list, kind) => list.filter((m) => m.kind === kind);
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''}`;

// ─── Saved states, and the sweep ────────────────────────────────────

const saveState = () => ({ bytes: raw._db.export(), mail: [...mail], google: structuredClone(google), files: new Map(files), seen: new Set(resendSeen) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  mail = [...s.mail];
  google = structuredClone(s.google);
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  resendSeen = new Set(s.seen);
  later = [];
}
/**
 * The press from `from`, cleanly (k = -1, the control) and then with the k-th statement `test` picks failing once, k = 0,
 * 1, … until none is left to fail. `judge({ k, r, failed, before, after, control })` → '' or what's wrong. → { problems, runs, failedReads }
 */
async function sweep(name, from, press, judge, { test: pick = READ, max = 400, observe }) {
  const problems = [];
  let control = null;
  let runs = 0;
  const failedSql = [];
  for (let k = -1; k < max; k++) {
    await restore(from);
    const before = await observe();
    fault = k < 0 ? null : { test: pick, k, seen: 0, failed: [] };
    let r;
    try { r = await press(); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
    const f = fault;
    fault = null;
    const failed = f?.failed?.[0] || '';
    if (k >= 0 && !failed) break;
    const after = await observe();
    if (k < 0) control = { r, before, after };
    const why = await judge({ k, r, failed, before, after, control });
    if (why) problems.push(`${name} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 80) || 'control'}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 220)}: ${why}`);
    runs += 1;
    if (failed) failedSql.push(failed);
  }
  return { problems, runs, failedSql };
}
const report = (out) => {
  console.log(`# swept: ${out.runs} runs, ${out.problems.length} wrong`);
  assert.deepEqual(out.problems, [], `${out.problems.length} of ${out.runs} runs:\n${out.problems.join('\n')}`);
};

/** A send's answer when nothing went: refused, in People's words when People is what failed (A5) */
function refusedSend(r, failed) {
  if (typeof r.status !== 'number' || r.status < 400) return `nothing went, and it answered ${r.status}`;
  if (PEOPLE_SQL.test(failed) && ![PEOPLE_DOWN_SENT, SIGN_IN_DOWN].includes(r.body?.error)) return `People couldn’t be read, and it said “${r.body?.error}”, not that nothing was sent`;
  return '';
}

/** A meeting ahead with its invite out, its reminder to answer it sent two hours ago, a paper the board signs */
async function ahead() {
  await board.saveDoc(env.DB, { title: 'Board Member Expectations', kind: 'policy', sign: true, body: '### Attendance\n\n- Come to three of four meetings' }, { by: FOUNDER });
  const made = await api({ action: 'new-meeting', date: inDays(9) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const saved = await api({ action: 'save-meeting', base: made.body.meeting.updatedAt, meeting: { ...made.body.meeting, start: '08:00', end: '10:00', location: 'Example Hall' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const sent = await api({ action: 'send-invite', id: made.body.meeting.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const m = sent.body.meeting;
  // (the send's own record of a reminder that went two hours ago: every read of this meeting carries who was asked)
  const at = new Date(Date.now() - 120 * MIN).toISOString();
  await raw.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`board-send:remind:${m.id}`, JSON.stringify({ n: 1, at, by: FOUNDER, to: [ALEX], had: { [ALEX]: at } }), at).run();
  return m;
}
/** Approved (the board not told yet, so nothing went) and put on the board page */
async function approvedAndShared(id) {
  const ok = await api({ action: 'approve-agenda', id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const cur = await board.getMeeting(env.DB, id);
  const r = await api({ action: 'save-meeting', base: cur.updatedAt, meeting: { ...cur, shared: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
const told = () => raw.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(JSON.stringify({ sentAt: new Date().toISOString() }), new Date().toISOString()).run();

// ─── F1: who was asked is the send's record, never a read of People ─

test('F1: every meeting read carries who was asked by email, as the send kept it, and none fails when People can’t be read; the page names them from its own list', async () => {
  const m = await ahead();
  for (const pick of [/LEFT JOIN reveal_board_emails/, /^SELECT slug, data FROM team$/, /^SELECT slug, email FROM reveal_board_emails$/]) {
    for (let k = 0; k < 3; k++) {
      fault = { test: (q) => pick.test(q), k, seen: 0, failed: [] };
      const got = await board.getMeeting(env.DB, m.id).then((x) => x, (e) => e);
      const list = await board.listMeetings(env.DB).then((x) => x, (e) => e);
      fault = null;
      assert.ok(got?.id === m.id && !(got instanceof Error), `the meeting read with ${pick} #${k} failing: ${got?.message || 'read'}`);
      assert.ok(Array.isArray(list), `every meeting read with ${pick} #${k} failing: ${list?.message || 'read'}`);
    }
  }
  const read = await board.getMeeting(env.DB, m.id);
  assert.deepEqual(Object.keys(read.reminded || {}), [ALEX], 'by email, as it went');
  assert.equal(typeof shared.askedOf, 'function', 'Board’s page matches them against its own list of the board');
  const members = [{ slug: 'alex-rivera', email: 'Alex.Board@Example.com' }, { slug: 'sam-ortiz', email: SAM }];
  assert.deepEqual(Object.keys(shared.askedOf(read, members)), ['alex-rivera']);
  assert.deepEqual(shared.askedOf(read, []), {}, 'nobody named from no list: the page’s own list loads with Board or not at all');
  assert.equal(shared.forBoard({ ...read, shared: true }).reminded, undefined, 'never on the board page');
});

test('F1: Remind those who haven’t answered: with each read failing in turn, an answer never says less than went', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  const from = saveState();
  const out = await sweep('remind-rsvp', from, () => api({ action: 'remind-rsvp', id: m.id }), ({ r, failed, before, after, k }) => {
    const went = kinds(after.mail, 'board-reminder').length - kinds(before.mail, 'board-reminder').length;
    if (k < 0 && !went) return 'the control sent nothing';
    if (!went) return refusedSend(r, failed);
    if (r.status !== 200) return `${went} went, and it answered ${r.status}`;
    if (NOTHING.test(said(r))) return `${went} went, and it said nothing did`;
    if (r.body.sent !== went) return `${went} went, and it said ${r.body.sent}`;
    if (!r.body.meeting && !(r.body.reread && r.body.later)) return 'neither the meeting nor words that it shows in a moment';
    return '';
  }, { observe: async () => ({ mail: [...mail] }) });
  report(out);
  assert.ok(out.runs > 10, `swept (${out.runs})`);
});

test('F1 and A5: Email the board and the minutes notice, with each read failing in turn: what went is said, and a refusal for People says nothing was sent', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  const out = await sweep('send-packet', saveState(), () => api({ action: 'send-packet', id: m.id }), ({ r, failed, before, after, k }) => {
    const went = kinds(after.mail, 'board-packet').length - kinds(before.mail, 'board-packet').length;
    if (k < 0 && !went) return 'the control sent nothing';
    if (!went) return refusedSend(r, failed);
    if (NOTHING.test(said(r))) return `${went} went, and it said nothing did`;
    if (r.status === 200 && r.body.sent === went && (r.body.meeting || (r.body.reread && r.body.later))) return '';
    // (the send's own record of it couldn't be kept: "may have gone", never nothing)
    if (r.status === 500 && r.body?.unsure) return '';
    return `${went} went, and it answered ${r.status} ${r.body?.sent}`;
  }, { observe: async () => ({ mail: [...mail] }) });
  report(out);
  assert.ok(out.failedSql.some((q) => PEOPLE_SQL.test(q)), 'People’s reads failed too');
});

test('F1 and A5: the minutes notice, with each read failing in turn', async () => {
  const p = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-3), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() }, attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board', status: 'present' })), sections: [{ title: 'New business', items: [{ title: 'Budget', notes: 'The budget passed.' }] }] }), { by: 'test' });
  const at = new Date(Date.now() - 120 * MIN).toISOString();
  await raw.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`board-send:remind:${p.id}`, JSON.stringify({ n: 1, at, by: FOUNDER, to: [ALEX], had: { [ALEX]: at } }), at).run();
  const out = await sweep('send-minutes', saveState(), () => api({ action: 'send-minutes', id: p.id }), ({ r, failed, before, after, k }) => {
    const went = kinds(after.mail, 'board-minutes').length - kinds(before.mail, 'board-minutes').length;
    if (k < 0 && !went) return 'the control sent nothing';
    if (!went) return refusedSend(r, failed);
    if (NOTHING.test(said(r))) return `${went} went, and it said nothing did`;
    if (r.status === 200 && r.body.sent === went && (r.body.meeting || (r.body.reread && r.body.later))) return '';
    if (r.status === 500 && r.body?.unsure) return '';
    return `${went} went, and it answered ${r.status} ${r.body?.sent}`;
  }, { observe: async () => ({ mail: [...mail] }) });
  report(out);
});

test('F1 and A5: Ask to sign, with each read failing in turn: what went is said, with how many', async () => {
  await ahead();
  const out = await sweep('ask-to-sign', saveState(), () => api({ action: 'ask-to-sign' }), ({ r, failed, before, after, k }) => {
    const went = kinds(after.mail, 'board-sign-ask').length - kinds(before.mail, 'board-sign-ask').length;
    if (k < 0 && went !== 4) return `the control sent ${went}`;
    if (!went) return refusedSend(r, failed);
    if (NOTHING.test(said(r))) return `${went} went, and it said nothing did`;
    if (r.status === 200 && r.body.sent === went && (r.body.members || (r.body.reread && r.body.later))) return '';
    // (Members' record of it couldn't be written: said with how many went)
    if (r.status === 500 && r.body?.unrecorded && r.body.sent === went && new RegExp(`went to ${went} board members`).test(r.body.error)) return '';
    return `${went} went, and it answered ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`;
  }, { observe: async () => ({ mail: [...mail] }) });
  report(out);
});

test('F1: Send the invite after a change of place, with each read failing in turn: once Google has it, the answer says so', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  const now = await board.getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'save-meeting', base: now.updatedAt, meeting: { ...now, location: 'Example Hall, Room 2' } })).status, 200);
  const out = await sweep('send-invite', saveState(), () => api({ action: 'send-invite', id: m.id }), async ({ r, failed, before, after, k }) => {
    const wrote = after.google.slice(before.google.length).filter((c) => c.method !== 'GET' && /sendUpdates=all/.test(c.url));
    if (k < 0 && !wrote.length) return 'the control changed nothing at Google';
    if (!wrote.length) return refusedSend(r, failed);
    if (NOTHING.test(said(r))) return 'Google emailed the guests, and it said nothing was sent';
    if (r.status !== 200 || !r.body.meeting?.invite) return `Google emailed the guests, and it answered ${r.status}`;
    if ((await meetingRow(m.id)).invite?.place !== 'Example Hall, Room 2') return 'Google has it, and the meeting’s record of the invite doesn’t';
    return '';
  }, { observe: async () => ({ google: [...google.calls] }) });
  report(out);
});

// ─── F1 and A4: Approve the agenda ──────────────────────────────────

/** Approve the agenda's sweep from `from`: approved or not, as the site says, and the agenda's email as the control has it */
async function approveSweep(name, from, id, { told: isTold }) {
  return sweep(name, from, () => api({ action: 'approve-agenda', id }), async ({ r, failed, before, after, control, k }) => {
    const agenda = kinds(after.mail, 'board-packet').length - kinds(before.mail, 'board-packet').length;
    if (k < 0) return (isTold ? agenda === 4 && r.body?.agenda === 'sent' : !agenda && r.body?.agenda === 'waiting') ? '' : `the control: ${agenda} sent, ${r.body?.agenda}`;
    if (!after.approved) {
      if (agenda) return 'the agenda went with no approval kept';
      if (typeof r.status !== 'number' || r.status < 400) return `nothing kept, and it answered ${r.status}`;
      if (PEOPLE_SQL.test(failed) && ![PEOPLE_DOWN, SIGN_IN_DOWN].includes(r.body?.error)) return `People couldn’t be read, and it said “${r.body?.error}”`;
      return '';
    }
    if (r.status !== 200) return `approved, and it answered ${r.status}`;
    if (NOTHING.test(said(r))) return 'approved, and it said nothing was changed';
    if (agenda) return agenda === 4 && r.body.agenda === 'sent' ? '' : `${agenda} agenda emails, said ${r.body.agenda}`;
    if (!isTold) return r.body.agenda === 'waiting' ? '' : `the board hasn’t had the sign-in email, and it said “${r.body.agenda}: ${r.body.agendaError || ''}”`;
    // Told, not sent: said as failed, and Board does try again by itself
    if (r.body.agenda !== 'failed' || !/tries again by itself/.test(r.body.agendaError || '')) return `not sent, and it said ${r.body.agenda} ${r.body.agendaError || ''}`;
    await board.maybeSendApprovedAgendas(env);
    return kinds(mail, 'board-packet').length - kinds(before.mail, 'board-packet').length === 4 ? '' : 'it said Board tries again by itself, and the heartbeat sent nothing';
  }, { observe: async () => ({ mail: [...mail], approved: (await sql("SELECT 1 FROM board_asks WHERE kind = 'chair' AND status = 'approved' AND meeting_id = ?", id)).length > 0 }) });
}

test('F1 and A4: Approve the agenda before the board has had the sign-in email: approved and waiting, or refused with nothing kept, never “didn’t go … tries again”', async () => {
  const m = await ahead();
  const out = await approveSweep('approve-agenda (not told)', saveState(), m.id, { told: false });
  report(out);
  assert.ok(out.failedSql.some((q) => /LEFT JOIN reveal_board_emails/.test(q)), 'the read of the board and their emails failed in turn');
});

test('F1 and A4: Approve the agenda once the board has had the sign-in email: what went is said, and a refusal keeps nothing', async () => {
  const m = await ahead();
  await told();
  report(await approveSweep('approve-agenda (told)', saveState(), m.id, { told: true }));
});

// ─── A3: Ask to sign goes once ──────────────────────────────────────

test('A3: Ask to sign pressed twice (two tabs, or one member’s own ask) 0, 100 and 300 ms apart with a slow Resend: each member gets one email, and the second press is told it just went', async () => {
  await ahead();
  const from = saveState();
  for (const gap of [0, 100, 300]) {
    for (const second of [{ action: 'ask-to-sign' }, { action: 'ask-to-sign', slugs: ['alex-rivera'] }]) {
      await restore(from);
      resendDelay = 400;
      const one = api({ action: 'ask-to-sign' });
      await new Promise((r) => setTimeout(r, gap));
      const two = api(second);
      const [a, b] = await Promise.all([one, two]);
      resendDelay = 0;
      const asks = kinds(mail, 'board-sign-ask');
      for (const e of BOARD) assert.equal(asks.filter((x) => x.to.includes(e)).length, 1, `${gap} ms, ${second.slugs ? 'Alex’s own' : 'the whole board'}: ${e} got ${asks.filter((x) => x.to.includes(e)).length}`);
      const [first, then] = a.body?.sent ? [a, b] : [b, a];
      assert.equal(first.body?.sent > 0, true, JSON.stringify(first.body));
      const toldIt = (then.status === 409 && then.body?.sending && /right now/.test(then.body.error)) || (then.status === 200 && then.body.sent === 0 && then.body.recent?.length > 0);
      assert.ok(toldIt, `${gap} ms: the second press is told it just went (${then.status} ${JSON.stringify(then.body)})`);
    }
  }
});

// ─── F5: Send the minutes, all or nothing ───────────────────────────

const TAYLOR_W = { member: { slug: 'taylor-nguyen', name: 'Taylor Nguyen', email: TAYLOR, seat: 'secretary' }, admin: false };
/** The last meeting (draft minutes, once reminded), and one held yesterday with Taylor's notes typed: a vote that approves the last minutes */
async function heldWithNotes({ kim = 'excused' } = {}) {
  const prev = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-100), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Q3 minutes.docx', at: new Date().toISOString() }, attendance: [], sections: [{ title: 'New business', items: [{ title: 'Gala' }] }] }), { by: 'test' });
  const at = new Date(Date.now() - 100 * 86_400_000).toISOString();
  await raw.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`board-send:remind:${prev.id}`, JSON.stringify({ n: 1, at, by: FOUNDER, to: [ALEX], had: { [ALEX]: at } }), at).run();
  const m = await board.saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), start: '08:00', end: '10:00', shared: true,
    attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' })),
    sections: [
      { id: 's_prev', title: 'Approve meeting minutes', items: [{ id: 'i_prev', title: 'Last minutes', live: 'minutes' }] },
      { id: 's_new', title: 'New business', items: [{ id: 'i_budget', title: 'Budget', motion: 'Approve the 2027 budget' }] },
    ],
  }), { by: 'test' });
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'r:kim-park': kim, 'm:i_prev': { by: 'Sam Ortiz', second: 'Alex Rivera', result: 'passed' }, 'n:i_budget': 'The budget passed.' } }, TAYLOR_W);
  return { prev, m };
}

test('F5: Send the minutes with every statement failing in turn: the notes, the last minutes’ approval, the Word file and the send’s record all land or none do, and a file the meeting names is never deleted', async () => {
  const { prev, m } = await heldWithNotes();
  const observe = async () => {
    const mm = await meetingRow(m.id);
    const p = await meetingRow(prev.id);
    const fileRows = await sql("SELECT id, name FROM board_files WHERE owner_type = 'meeting' AND owner_id = ?", m.id);
    const notes = (await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', m.id))[0];
    return {
      notes: !!mm.minutesFrom?.typed && (mm.sections || []).some((s) => s.items.some((it) => /budget passed/.test(it.notes || ''))),
      approved: p.minutes === 'approved',
      file: fileRows.some((f) => f.name === mm.minutesFrom?.name) || (!mm.minutesFrom?.typed && fileRows.some((f) => /\.docx$/.test(f.name))),
      named: mm.minutesFrom?.typed ? fileRows.some((f) => f.name === mm.minutesFrom.name) : null,
      record: !!JSON.parse(notes?.sent || 'null')?.at,
      bytes: files.size,
    };
  };
  const out = await sweep('notes-send', saveState(), () => onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id }), ({ r, before, after, k }) => {
    const parts = ['notes', 'approved', 'file', 'record'];
    const landed = parts.filter((x) => after[x] && !before[x]);
    if (k < 0) return landed.length === 4 && r.status === 200 ? '' : `the control: ${landed.join(', ')} (${r.status})`;
    if (after.named === false) return 'the meeting names a Word file that isn’t there';
    if (landed.length && landed.length < 4) return `half done: ${landed.join(', ')} landed, ${parts.filter((x) => !landed.includes(x)).join(', ')} didn’t`;
    if (landed.length === 4) return r.status === 200 && !NOTHING.test(said(r)) ? '' : `it all landed, and it answered ${r.status} “${said(r).trim()}”`;
    if (typeof r.status !== 'number' || r.status < 400) return `nothing landed, and it answered ${r.status}`;
    return after.bytes > before.bytes ? 'nothing landed, and the Word file’s bytes were left behind' : '';
  }, { test: ANY, observe });
  report(out);
  assert.ok(out.runs > 40, `swept every statement (${out.runs})`);
});

// ─── F2: a correction decided whole ─────────────────────────────────

test('F2: deciding a correction with every statement failing in turn: made, recorded decided and its notice owed, or nothing changed and waiting again; never stuck being made', async () => {
  const { m } = await heldWithNotes();
  assert.equal((await onPortal(TAYLOR, { action: 'notes-send', meetingId: m.id })).status, 200);
  const sug = await onPortal(SAM, { action: 'correction', meetingId: m.id, target: 'r:kim-park', words: 'present' });
  assert.equal(sug.status, 200, JSON.stringify(sug.body));
  await maybeRunSigning(env).catch(() => {});
  const cid = sug.body.correction.id;
  const observe = async () => {
    const mm = await meetingRow(m.id);
    const c = (await sql('SELECT state, decided_by FROM board_minutes_corrections WHERE id = ?', cid))[0];
    const sent = JSON.parse((await sql('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', m.id))[0]?.sent || '{}');
    return {
      made: mm.attendance.find((p) => p.slug === 'kim-park')?.status === 'present',
      kept: sent.notes?.['r:kim-park'] === 'present',
      state: c.state, by: c.decided_by || '',
      owed: (await sql("SELECT 1 FROM board_state WHERE key = ?", `notice-due:correction-decided:${cid}`)).length > 0 || kinds(mail, 'board-correction-decided').some((x) => x.to.includes(SAM)),
    };
  };
  const out = await sweep('correction-decide', saveState(), () => route(portal, '/api/board-portal', FOUNDER, { method: 'POST', body: { action: 'correction-decide', id: cid, make: true } }), ({ r, after, k }) => {
    if (k < 0) return after.made && after.state === 'made' && after.owed ? '' : `the control: ${JSON.stringify(after)}`;
    if (after.made !== after.kept) return `the minutes ${after.made ? 'changed' : 'didn’t change'} and the notes’ record ${after.kept ? 'did' : 'didn’t'}`;
    if (after.made) {
      if (after.state !== 'made' || !after.by) return `the minutes changed, and the correction is “${after.state}” with nobody deciding`;
      if (!after.owed) return 'the minutes changed, and Sam is owed nothing';
      return r.status === 200 && !NOTHING.test(said(r)) ? '' : `made, and it answered ${r.status} “${said(r).trim()}”`;
    }
    if (after.state !== 'waiting' || after.by || after.owed) return `nothing changed, and the correction is “${after.state}”${after.by ? ', decided' : ''}${after.owed ? ', a notice owed' : ''}`;
    return typeof r.status === 'number' && r.status >= 400 ? '' : `nothing changed, and it answered ${r.status}`;
  }, { test: ANY, observe });
  report(out);
});

// ─── F8: the to-do reminders' hour ──────────────────────────────────

test('F8: the to-do reminders with each read failing in turn: the hour is marked only with the sends, and the next look sends each once', async () => {
  const NOW = Date.parse('2026-11-24T15:00:00Z'); // a Tuesday, 10 in the morning in Florida
  const day = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
  await board.saveSettings(env.DB, { actionRemind: 'on' }, FOUNDER);
  await board.saveMeeting(env.DB, cleanMeeting({ date: day(-7), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() }, attendance: [], sections: [{ title: 'New business', items: [{ title: 'Budget' }] }], actions: [{ id: 'a_venue001', text: 'Book the spring venue', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: day(1) }] }), { by: 'test' });
  const reminded = await board.saveMeeting(env.DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', shared: true, sections: [{ title: 'New business', items: [{ title: 'Budget' }] }] }), { by: 'test' });
  // (a reminder record: every meeting read once read People for it)
  await raw.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`board-send:remind:${reminded.id}`, JSON.stringify({ n: 1, at: new Date(NOW - 3 * 3600e3).toISOString(), to: [ALEX], had: { [ALEX]: new Date(NOW - 3 * 3600e3).toISOString() } }), new Date(NOW).toISOString()).run();
  const out = await sweep('to-do reminders', saveState(), async () => {
    await maybeRemindActions(env, { now: NOW }).catch(() => {});
    return { status: 0, body: {} };
  }, async ({ failed, k }) => {
    const first = kinds(mail, 'board-action-reminder').length;
    const state = JSON.parse((await sql("SELECT data FROM board_state WHERE key = 'action-reminds'"))[0]?.data || '{}');
    if (failed && PEOPLE_SQL.test(failed) && first === 0 && !state.unread) return 'People couldn’t be read, and the look kept no word of it';
    await maybeRemindActions(env, { now: NOW + 5 * MIN });
    await maybeRemindActions(env, { now: NOW + 70 * MIN });
    const all = kinds(mail, 'board-action-reminder').filter((x) => x.to.includes(SAM)).length;
    return all === 1 ? '' : `Sam had ${all} reminders (the look itself ${first})${k < 0 ? ' in the control' : ''}`;
  }, { observe: async () => ({}) });
  report(out);
  assert.ok(out.runs > 5, `swept (${out.runs})`);
});

// ─── F12: the board page opens without its visit kept ───────────────

test('F12: the board page opens when the visit’s record can’t be written or read', async () => {
  await ahead();
  const from = saveState();
  for (let k = 0; k < 4; k++) {
    await restore(from);
    fault = { test: (q) => /board_seen/.test(q), k, seen: 0, failed: [] };
    const r = await route(portal, '/api/board-portal', ALEX);
    const failed = fault.failed[0] || '';
    fault = null;
    if (!failed) break;
    assert.equal(r.status, 200, `${failed.slice(0, 60)} failing: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.ok(r.body?.ok && r.body.me?.slug === 'alex-rivera', 'the page as it is, the line about the last visit missed at most');
  }
});
