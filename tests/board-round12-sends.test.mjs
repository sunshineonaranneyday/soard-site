/**
 * Board QA round 12 (Nov 23 2026), the privacy tester's findings 1, 4 and 5, and a fresh server's first request:
 *   F1  a board email, once it has gone, is noted and never goes again: the send's own record (kept before it goes) and
 *       what it keeps on its meeting are written together; that failing once is tried again, and an answer never says
 *       less than went ("may have gone" only when the site truly can't tell). Email the board, the minutes notice,
 *       Remind, Approve the agenda's send, the sign-in email and Send the invite, each swept with every statement it
 *       makes failing once in turn, then pressed again at once, 11 minutes on and 2 days on: nobody ever gets it twice,
 *       the page shows the send, and the words match what happened
 *   F4  an answer never carries a meeting the site doesn't have: setOnMeeting answers with the row as written
 *   F5  "no longer signs in with this email" never goes to an address that signs a member in when it's sent, and two
 *       changes of one member's email at once each record what they replaced
 *   S   Board's tables not set up on a fresh server: said in words (503), never the platform's error page
 * Made-up people only (the repo is public). Run: node --test tests/board-round12-sends.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { holdClockAt } from './lib/clock.mjs';
import { holdable } from './lib/interleave.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import * as invitesAdmin from '../functions/api/reveal-invites-admin.js';
import * as board from '../functions/api/_board.js';
import { maybeRunSigning } from '../functions/api/_board-sign.js';
import { setBoardEmail } from '../functions/api/_reveal-invites.js';
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
const NOTHING = /nothing was (sent|changed)/i;
const MIN = 60_000;
const LATER = [['at once', 0], ['11 minutes on', 11 * MIN], ['2 days on', 2 * 86_400_000]];
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
// Every statement a press makes is counted (one in a batch too, which then fails whole, as D1's does), and the k-th
// that `test` picks fails once. Board's own table setup (CREATE, ALTER, PRAGMA) is left out, as the tester's sweep has it
let raw;
let fault = null; // { test, k, seen, failed }
const SETUP = /^\s*(CREATE|ALTER|PRAGMA)\b/i;
const ANY = (sql) => !SETUP.test(sql);
function check(sql) {
  if (!fault || !fault.test(String(sql || ''))) return;
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
let google; // { events, calls }
let mail; // every email Resend took: { to, subject, kind }
let resendKeys; // Resend's own idempotency keys: the same call again is answered as the first was, and sends nothing
let googleHold = null; // a promise Google's next write waits on (F4)
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
  resendKeys = new Map();
  googleHold = null;
  later = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const key = init.headers?.['Idempotency-Key'] || '';
      if (key && resendKeys.has(key)) { const had = resendKeys.get(key); return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }); }
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), subject: e.subject, kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '' });
      const res = Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` };
      if (key) resendKeys.set(key, { body: init.body, res });
      return Response.json(res);
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      const u = new URL(url);
      google.calls.push({ method, url, body });
      if (method !== 'GET' && googleHold) { const h = googleHold; googleHold = null; await h.wait(); }
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
  // (what this request left running, its own only: another press held midway never holds up this one's answer)
  const own = [];
  const ctx = { request, env, data: {}, waitUntil: (p) => { own.push(p); later.push(p); } };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
  const text = await res.text();
  await Promise.allSettled(own);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const api = (body) => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body });
const sql = async (q, ...b) => (await raw.prepare(q).bind(...b).all()).results || [];
const meetingRow = async (id) => { const r = (await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0]; return r ? JSON.parse(r.data) : null; };
const kinds = (list, kind) => list.filter((m) => m.kind === kind);
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''} ${r.body?.agendaError || ''}`;
/** How many of `kind` each address has had */
const perPerson = (kind) => Object.fromEntries(BOARD.map((e) => [e, kinds(mail, kind).filter((x) => x.to.includes(e)).length]));

// ─── Saved states ───────────────────────────────────────────────────

const saveState = () => ({ bytes: raw._db.export(), mail: [...mail], google: structuredClone(google), files: new Map(files), keys: new Map(resendKeys) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  mail = [...s.mail];
  google = structuredClone(s.google);
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  resendKeys = new Map(s.keys);
  later = [];
}

/** A press made later (`ms` on): the whole site's clock moved on that far */
async function pressedLater(ms, press) {
  const back = ms ? holdClockAt(Date.now() + ms) : () => {};
  try { return await press(); } finally { back(); }
}

/** A meeting ahead with its invite out, a paper the board signs */
async function ahead({ days = 9 } = {}) {
  await board.saveDoc(env.DB, { title: 'Board Member Expectations', kind: 'policy', sign: true, body: '### Attendance\n\n- Come to three of four meetings' }, { by: FOUNDER });
  const made = await api({ action: 'new-meeting', date: inDays(days) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const saved = await api({ action: 'save-meeting', base: made.body.meeting.updatedAt, meeting: { ...made.body.meeting, start: '08:00', end: '10:00', location: 'Example Hall' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const sent = await api({ action: 'send-invite', id: made.body.meeting.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  return sent.body.meeting;
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
/** A meeting held three days ago with its minutes in, on the board page */
async function heldWithMinutes() {
  return board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-3), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() }, attendance: EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board', status: 'present' })), sections: [{ title: 'New business', items: [{ title: 'Budget', notes: 'The budget passed.' }] }] }), { by: 'test' });
}

/**
 * A send's sweep: the press from `from`, cleanly (k = -1) and then with the k-th statement failing once, k = 0, 1, … until
 * none is left to fail; each run followed by the heartbeat's settling of sends and the same press again at once, 11
 * minutes on and 2 days on (no page ever told it went: a press that didn't know). `went(before)` → the emails (or Google
 * writes) the press made; `shows(went)` → '' or why the page doesn't show it. Judged on every run:
 *   - nobody ever has it twice (`each(addr)`: how many of it each has had)
 *   - the first press: what went is said (200, never "nothing was sent", never "may have gone"), and a press that sent
 *     nothing is refused in words that say so (never "Something went wrong")
 *   - the page shows the send once it went, after the heartbeat at the latest
 *   - a press after it went sends nothing and says when it went (409 already); after a refusal, the next press sends it
 */
async function sweepSend(name, from, press, { went, each, shows, firstOk = (r, n) => r.status === 200 && r.body?.ok !== false && (r.body?.sent === undefined || r.body.sent === true || r.body.sent === n), notSentOk = () => false, max = 400 }) {
  const problems = [];
  let runs = 0;
  for (let k = -1; k < max; k++) {
    await restore(from);
    const before = { mail: mail.length, google: google.calls.length };
    fault = k < 0 ? null : { test: ANY, k, seen: 0, failed: [] };
    let r;
    try { r = await press(); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
    const failed = fault?.failed?.[0] || '';
    fault = null;
    if (k >= 0 && !failed) break;
    runs += 1;
    const tag = `${name} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90) || 'control'}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 240)}`;
    const n = went(before).length;
    if (k < 0 && !n) { problems.push(`${tag}: the control sent nothing`); continue; }
    if (n) {
      if (!firstOk(r, n)) problems.push(`${tag}: ${n} went, and it answered so`);
      if (NOTHING.test(said(r))) problems.push(`${tag}: ${n} went, and it said nothing did`);
      if (/may have gone/i.test(said(r))) problems.push(`${tag}: Resend took them all, and it said they may have gone`);
    } else if (!notSentOk(r)) {
      if (typeof r.status !== 'number' || r.status < 400) problems.push(`${tag}: nothing went, and it answered ${r.status}`);
      else if (!/nothing was sent|nothing was changed|couldn’t check your sign-in|couldn’t open/i.test(said(r))) problems.push(`${tag}: nothing went, and it said “${said(r).trim()}”`);
    }
    // The heartbeat's part: a send noted on its meeting from its own record (none before round 12's)
    await board.settleSends?.(env);
    if (n) { const why = await shows(); if (why) problems.push(`${tag}: after the heartbeat, ${why}`); }
    // Pressed again by a page that never showed it: at once, 11 minutes on, 2 days on
    let sentBy = n ? 'first' : '';
    for (const [when, ms] of LATER) {
      const b = { mail: mail.length, google: google.calls.length };
      const r2 = await pressedLater(ms, press);
      const n2 = went(b).length;
      if (n2 && sentBy) problems.push(`${tag}: pressed again ${when}, it went again (${n2}) after the ${sentBy} press: ${r2.status} ${JSON.stringify(r2.body || {}).slice(0, 160)}`);
      if (n2) sentBy ||= when;
      if (!n2 && sentBy && (r2.status !== 409 || !/didn’t go again|goes once|already out|nobody was emailed again/i.test(said(r2)))) problems.push(`${tag}: pressed again ${when} after it went: ${r2.status} “${said(r2).trim()}”`);
    }
    for (const [addr, c] of Object.entries(each())) if (c > 1) problems.push(`${tag}: ${addr} had it ${c} times`);
    if (!sentBy) problems.push(`${tag}: never went, even when pressed again`);
  }
  return { problems, runs };
}
const report = (out) => {
  console.log(`# swept: ${out.runs} runs, ${out.problems.length} wrong`);
  assert.deepEqual(out.problems, [], `${out.problems.length} problems in ${out.runs} runs:\n${out.problems.join('\n')}`);
};

// ─── F1: the tester's own case, exactly ─────────────────────────────

test('F1: Email the board with the meeting’s “emailed” write failing once after Resend took them: said as gone, the page shows it, and nobody has it twice at once, 11 minutes or 2 days on', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  // (the clean press's own statements: the last write onto the meeting is its "emailed")
  for (const pick of [/^UPDATE board_meetings SET data = json_set/, /^INSERT OR REPLACE INTO board_state/]) {
    const from = saveState();
    let n = 0;
    fault = { test: (q) => pick.test(q), k: 1e9, seen: 0, failed: [] };
    await api({ action: 'send-packet', id: m.id });
    n = fault.seen;
    fault = null;
    await restore(from);
    fault = { test: (q) => pick.test(q), k: Math.max(0, n - 1), seen: 0, failed: [] };
    const r = await api({ action: 'send-packet', id: m.id });
    const failed = fault.failed[0] || '';
    fault = null;
    assert.ok(failed, `${pick}: a statement failed`);
    assert.deepEqual(perPerson('board-packet'), Object.fromEntries(BOARD.map((e) => [e, 1])), 'Resend took all 4');
    assert.equal(r.status, 200, `${failed.slice(0, 60)}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.sent, 4);
    assert.doesNotMatch(said(r), /may have gone|nothing was sent/i);
    assert.ok((await board.getMeeting(env.DB, m.id)).packetSentAt, 'the page shows it emailed');
    for (const [when, ms] of LATER) {
      const again = await pressedLater(ms, () => api({ action: 'send-packet', id: m.id }));
      assert.equal(again.status, 409, `${when}: ${JSON.stringify(again.body)}`);
      assert.ok(again.body.meeting?.packetSentAt, `${when}: the answer shows it emailed`);
    }
    assert.deepEqual(perPerson('board-packet'), Object.fromEntries(BOARD.map((e) => [e, 1])), 'nobody had it twice');
    // (a press that didn't know, 2 days on: told when it went, in plain words)
    const words = (await pressedLater(2 * 86_400_000, () => api({ action: 'send-packet', id: m.id }))).body.error;
    assert.match(words, /^You emailed the board this on \w{3} \d{1,2} at \d{1,2}:\d{2} [AP]M\. It goes once, so there’s nothing to press\.$/);
    await restore(from);
  }
});

test('F1: “Email again” on purpose still goes, once: a press that names the send its page showed', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  assert.equal((await api({ action: 'send-packet', id: m.id })).status, 200);
  const seen = (await board.getMeeting(env.DB, m.id)).packetSentAt;
  // within ten minutes: not again
  assert.equal((await api({ action: 'send-packet', id: m.id, seen })).status, 409);
  // 11 minutes on, from a page that showed it: once more to each
  const again = await pressedLater(11 * MIN, () => api({ action: 'send-packet', id: m.id, seen }));
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(perPerson('board-packet'), Object.fromEntries(BOARD.map((e) => [e, 2])));
  // the same page pressing again with the older send: nobody has it a third time
  const stale = await pressedLater(30 * MIN, () => api({ action: 'send-packet', id: m.id, seen }));
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.deepEqual(perPerson('board-packet'), Object.fromEntries(BOARD.map((e) => [e, 2])));
});

// ─── F1: every statement of every send, then pressed again ──────────

test('F1: Email the board with every statement failing once in turn, then pressed again at once, 11 minutes and 2 days on', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  report(await sweepSend('send-packet', saveState(), () => api({ action: 'send-packet', id: m.id }), {
    went: (b) => kinds(mail.slice(b.mail), 'board-packet'),
    each: () => perPerson('board-packet'),
    shows: async () => ((await board.getMeeting(env.DB, m.id)).packetSentAt ? '' : 'the meeting doesn’t show it emailed'),
  }));
});

test('F1: Tell the board the minutes are up with every statement failing once in turn, then pressed again', async () => {
  const p = await heldWithMinutes();
  report(await sweepSend('send-minutes', saveState(), () => api({ action: 'send-minutes', id: p.id }), {
    went: (b) => kinds(mail.slice(b.mail), 'board-minutes'),
    each: () => perPerson('board-minutes'),
    shows: async () => ((await board.getMeeting(env.DB, p.id)).minutesSentAt ? '' : 'the meeting doesn’t show the board told'),
  }));
});

test('F1: Remind those who haven’t answered with every statement failing once in turn, then pressed again', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  report(await sweepSend('remind-rsvp', saveState(), () => api({ action: 'remind-rsvp', id: m.id }), {
    went: (b) => kinds(mail.slice(b.mail), 'board-reminder'),
    each: () => perPerson('board-reminder'),
    shows: async () => {
      const asked = Object.keys((await board.getMeeting(env.DB, m.id)).reminded || {});
      return BOARD.every((e) => asked.includes(e)) ? '' : `the meeting shows ${asked.length} asked`;
    },
  }));
});

test('F1: Approve the agenda once the board has had the sign-in email, every statement failing once in turn; then Email the board pressed again', async () => {
  const m = await ahead();
  await told();
  report(await sweepSend('approve-agenda', saveState(), async () => {
    // (approved already: the press again is Email the board, as the page offers it)
    const approved = (await sql("SELECT 1 FROM board_asks WHERE kind = 'chair' AND status = 'approved' AND meeting_id = ?", m.id)).length > 0;
    if (!approved) return api({ action: 'approve-agenda', id: m.id });
    // (the heartbeat sends an approved agenda that didn't go: part of "pressed again")
    await board.maybeSendApprovedAgendas(env);
    return api({ action: 'send-packet', id: m.id });
  }, {
    went: (b) => kinds(mail.slice(b.mail), 'board-packet'),
    each: () => perPerson('board-packet'),
    shows: async () => ((await board.getMeeting(env.DB, m.id)).packetSentAt ? '' : 'the meeting doesn’t show it emailed'),
    // (approved, and its email went: said as on its way)
    firstOk: (r) => r.status === 200 && r.body?.agenda === 'sent' && !/may have gone|didn’t go/i.test(said(r)),
    // (approved, and its email stopped before it went: said as that, and Board sends it by itself, as the next press's
    // heartbeat shows: the approval and its email can't be one write, so the email is the heartbeat's to finish)
    notSentOk: (r) => r.status === 200 && r.body?.agenda === 'failed' && /didn’t go\. Board tries again by itself/.test(r.body.agendaError || ''),
  }));
});

test('F1: Send the sign-in email with every statement failing once in turn, then pressed again: never “Something went wrong … then try again” after they went', async () => {
  const welcomed = async () => JSON.parse((await sql("SELECT data FROM board_state WHERE key = 'welcome'"))[0]?.data || '{}');
  report(await sweepSend('send-welcome', saveState(), () => api({ action: 'send-welcome' }), {
    went: (b) => kinds(mail.slice(b.mail), 'board-welcome'),
    each: () => perPerson('board-welcome'),
    shows: async () => {
      const w = await welcomed();
      return EMAILS.every(([slug]) => w.members?.[slug]) ? '' : `Members shows ${Object.keys(w.members || {}).length} sent`;
    },
    // (a press again finds they have it: 200, nobody sent, never a second copy)
    firstOk: (r, n) => r.status === 200 && r.body?.sent === n && !/Something went wrong/i.test(said(r)),
  }).then((out) => ({ ...out, problems: out.problems.filter((p) => !/pressed again .* after it went: 200/.test(p)) })));
});

test('F1: Send the invite after a change of place with every statement failing once in turn: once Google has emailed the guests it’s said as sent, noted, and never sent to Google again', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  const now = await board.getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'save-meeting', base: now.updatedAt, meeting: { ...now, location: 'Example Hall, Room 2' } })).status, 200);
  const loud = (calls) => calls.filter((c) => c.method !== 'GET' && /sendUpdates=all/.test(c.url));
  report(await sweepSend('send-invite', saveState(), () => api({ action: 'send-invite', id: m.id }), {
    went: (b) => loud(google.calls.slice(b.google)),
    each: () => ({ 'the guests (Google’s emails)': loud(google.calls).length - 1 }),
    shows: async () => ((await meetingRow(m.id)).invite?.place === 'Example Hall, Room 2' ? '' : 'the meeting’s invite doesn’t have the new place'),
    firstOk: (r) => r.status === 200 && r.body?.ok === true,
  }).then(async (out) => out));
});

// ─── F4: an answer is the meeting as the site has it ───────────────

test('F4: Send the invite while another tab saves: with its read back failing, the answer is the row as written, and that tab’s next save keeps the other tab’s change', async () => {
  const m = await ahead();
  const cur = await board.getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'save-meeting', base: cur.updatedAt, meeting: { ...cur, location: 'Example Hall, Room 2' } })).status, 200);
  const item = (await board.getMeeting(env.DB, m.id)).sections.flatMap((s) => s.items)[0];
  // Google answers slowly: tab B saves meanwhile
  let open;
  const reached = new Promise((res) => { googleHold = { wait: () => { res(); return new Promise((r) => { open = r; }); } }; });
  const pA = api({ action: 'send-invite', id: m.id });
  await reached;
  const b0 = await board.getMeeting(env.DB, m.id);
  const renamed = { ...b0, sections: b0.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === item.id ? { ...it, title: `${it.title} (tab B’s new name)` } : it)) })) };
  const rB = await api({ action: 'save-meeting', base: b0.updatedAt, meeting: renamed });
  assert.equal(rB.status, 200, JSON.stringify(rB.body));
  // the invite's read back after its write fails once
  fault = { test: (q) => /^SELECT data FROM board_meetings WHERE id = \?$/.test(q), k: 0, seen: 0, failed: [] };
  open();
  const rA = await pA;
  const failed = fault.failed[0];
  fault = null;
  assert.ok(failed, 'the read back failed');
  assert.equal(rA.status, 200, JSON.stringify(rA.body));
  const row = (await sql('SELECT updated_at, data FROM board_meetings WHERE id = ?', m.id))[0];
  const title = (x) => x.sections.flatMap((s) => s.items).find((it) => it.id === item.id).title;
  assert.equal(title(rA.body.meeting), title(JSON.parse(row.data)), 'the answer has what the site has');
  assert.equal(rA.body.meeting.updatedAt, row.updated_at);
  assert.ok(rA.body.meeting.invite?.place === 'Example Hall, Room 2', 'with the invite it wrote');
  // tab A takes the answer, and saves a parking note a minute later
  const rA2 = await api({ action: 'save-meeting', base: rA.body.meeting.updatedAt, meeting: { ...rA.body.meeting, inviteNote: 'Bring your badge.' } });
  const after = await board.getMeeting(env.DB, m.id);
  assert.ok(rA2.status === 409 || title(after) === `${item.title} (tab B’s new name)`, `tab B’s change kept or asked about: ${rA2.status}, “${title(after)}”`);
});

test('F4: setOnMeeting answers from its own write (RETURNING), never the copy read before, whatever was saved in between', async () => {
  const m = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(5), start: '08:00', end: '10:00', title: 'Old title', sections: [{ title: 'New business', items: [{ title: 'Budget' }] }] }), { by: 'test' });
  const was = await board.getMeeting(env.DB, m.id);
  const b = await board.saveMeeting(env.DB, { ...was, title: 'Tab B’s title' }, { by: 'other@soardcharity.com', base: was.updatedAt, edit: true });
  fault = { test: (q) => /^SELECT data FROM board_meetings WHERE id = \?$/.test(q), k: 0, seen: 0, failed: [] };
  const got = await board.setOnMeeting(env.DB, m.id, { snapshot: { at: new Date().toISOString(), by: FOUNDER } }, { was });
  assert.ok(fault.failed.length, 'its read back failed');
  fault = null;
  const row = (await sql('SELECT updated_at FROM board_meetings WHERE id = ?', m.id))[0];
  assert.equal(got.title, 'Tab B’s title');
  assert.equal(got.updatedAt, row.updated_at);
  assert.ok(got.updatedAt > b.updatedAt);
  assert.ok(got.snapshot?.at);
});

// ─── F5: the old address told, checked when it goes ─────────────────

test('F5: an email changed by mistake and put straight back: the address that signs her in is never told it doesn’t; the typo is', async () => {
  // (the board's addresses as the signing look last saw them: its chain starts here)
  for (let i = 0; i < 2; i++) await maybeRunSigning(env);
  const m0 = mail.length;
  const set = (email) => route(invitesAdmin, '/api/reveal-invites-admin', FOUNDER, { method: 'POST', body: { boardEmail: { slug: 'sam-ortiz', email } } });
  assert.equal((await set('sam.bord@example.org')).status, 200);
  assert.equal((await set(SAM)).status, 200);
  for (let i = 0; i < 4; i++) { await board.maybeRunBoard(env).catch(() => {}); await maybeRunSigning(env); }
  const notices = kinds(mail.slice(m0), 'board-email-changed');
  assert.deepEqual(notices.map((x) => x.to[0]), ['sam.bord@example.org'], 'only the typo is told');
  const skipped = (await sql("SELECT detail FROM board_sign_events WHERE kind = 'notice-sent'")).map((r) => JSON.parse(r.detail));
  assert.ok(skipped.some((d) => d.skipped === 'signs in with it now'), 'the other change is closed in the chain, as not told and why');
  assert.equal((await route(portal, '/api/board-portal', SAM)).status, 200, 'Sam signs in with it');
});

test('F5: two founders changing one member’s email at once: the second records what it replaced, never the original twice', async () => {
  const from = saveState();
  const one = (DB) => () => setBoardEmail(DB, 'kim-park', 'kim.one@example.com');
  const two = (DB) => () => setBoardEmail(DB, 'kim-park', 'kim.two@example.com');
  const h = holdable(raw);
  const { n } = await h.count('one', one(h.DB));
  assert.ok(n > 3, `statements: ${n}`);
  let held = 0;
  for (let k = 1; k <= n + 1; k++) {
    await restore(from);
    const hh = holdable(raw);
    const run = await hh.heldAt('one', k, one(hh.DB), two(hh.DB));
    if (!run.hit) break;
    held += 1;
    const events = (await sql("SELECT detail FROM board_sign_events WHERE kind = 'email-changed' AND slug = 'kim-park' ORDER BY seq")).map((r) => JSON.parse(r.detail));
    const now = (await sql("SELECT email FROM reveal_board_emails WHERE slug = 'kim-park'"))[0]?.email;
    const froms = events.map((e) => e.from);
    assert.equal(new Set(froms).size, froms.length, `held at ${k}: two changes from one address: ${JSON.stringify(events)}`);
    // the chain says how it got here: each change from what the one before it left
    let at = KIM;
    for (const e of events) { assert.equal(e.from, at, `held at ${k}: ${JSON.stringify(events)}`); at = e.to; }
    assert.equal(at, now, `held at ${k}: the chain ends at the address it has (${now})`);
    for (const r of [run.first, run.second]) assert.ok(r.ok || /kept changing/.test(r.err?.message || ''), `held at ${k}: ${r.err?.message}`);
  }
  assert.ok(held > 3, `held at ${held} places`);
});

// ─── S: Board's tables on a fresh server ────────────────────────────

test('S: Board’s table setup failing on a fresh server is said in words (503), on Board, the board page and a file, never the platform’s error page', async () => {
  for (const [name, call] of [
    ['Board admin, a press', () => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body: { action: 'new-meeting', date: inDays(30) } })],
    ['Board admin, its page', () => route(admin, '/api/board-admin', FOUNDER)],
    ['the board page', () => route(portal, '/api/board-portal', ALEX)],
    ['the board page, a press', () => route(portal, '/api/board-portal', ALEX, { method: 'POST', body: { action: 'opened', docId: 'd_none' } })],
    ['a board file', () => route(boardFile, '/api/board-file?id=f_none', FOUNDER)],
  ]) {
    // (a database Board has never set up: its first CREATE TABLE fails once)
    raw = await createD1({ bytes: raw._db.export() });
    const fresh = hookedDB();
    env.DB = fresh;
    fault = { test: (q) => /^\s*CREATE TABLE IF NOT EXISTS board_meetings\b/i.test(q), k: 0, seen: 0, failed: [] };
    let r;
    try { r = await call(); } catch (err) { r = { status: 'threw', text: String(err?.message || err) }; }
    const failed = fault.failed[0];
    fault = null;
    assert.ok(failed, `${name}: a CREATE TABLE failed`);
    assert.equal(r.status, 503, `${name}: ${r.status} ${String(r.text).slice(0, 200)}`);
    assert.match(r.text, /couldn’t (open|check)/, `${name}: in words`);
    assert.doesNotMatch(r.text, /D1_ERROR|SQLITE|CREATE/i, `${name}: never the database's own words`);
  }
});

// ─── Admin 1 (item 5): a held meeting is never asked about coming or reading ahead ─────

const { HELD_NO_SEND, heldNoSend } = shared;
/** The meeting held: moved to a day gone by (`days` < 0), or today with the chair's End pressed (as Board's holding it) */
async function holdIt(id, { days = -1 } = {}) {
  const d = days < 0 ? inDays(days) : inDays(0);
  const ended = days < 0 ? null : new Date(Date.now() - 5 * MIN).toISOString();
  await raw.prepare(`UPDATE board_meetings SET date = ?, data = json_set(data, '$.date', ?${ended ? ", '$.live', json(?)" : ''}) WHERE id = ?`)
    .bind(d, d, ...(ended ? [JSON.stringify({ startedAt: new Date(Date.now() - 65 * MIN).toISOString(), endedAt: ended })] : []), id).run();
  assert.ok(shared.meetingHeld(await board.getMeeting(env.DB, id)), 'held');
}

test('Admin 1: Remind, Email the board, Approve and the heartbeat’s approved agenda never go for a meeting held (yesterday, or today once it ended), from the read at the press, in one set of words', async () => {
  for (const days of [-1, 0]) {
    const m = await ahead({ days: 9 - (days === 0 ? 1 : 0) });
    await approvedAndShared(m.id);
    // (a second meeting, ahead and not approved, for Approve)
    const other = (await api({ action: 'new-meeting', date: inDays(12 + days) })).body.meeting;
    await holdIt(m.id, { days });
    await holdIt(other.id, { days });
    const m0 = mail.length;
    for (const action of ['remind-rsvp', 'send-packet']) {
      const r = await api({ action, id: m.id });
      assert.equal(r.status, 409, `${action}, held ${days ? 'yesterday' : 'today'}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, HELD_NO_SEND);
      assert.ok(r.body.meeting && shared.meetingHeld(r.body.meeting), 'with the meeting as it is now, for the page to show it held');
    }
    const ap = await api({ action: 'approve-agenda', id: other.id });
    assert.ok(ap.status >= 400 && /isn’t ahead|already been held/.test(ap.body.error), `approve, held: ${ap.status} ${ap.body.error}`);
    if (days === 0) assert.equal(ap.body.error, HELD_NO_SEND);
    // The approved agenda's heartbeat send: the board told, and it's held
    await told();
    await board.maybeSendApprovedAgendas(env);
    assert.equal(await board.sendApprovedAgenda(env, m.id), null, 'nothing to send for a held meeting');
    assert.equal(mail.length, m0, `held ${days ? 'yesterday' : 'today'}: nothing asked of the board`);
    // (Send the invite has its own: noInviteFor, the same idea in its words)
    const inv = await api({ action: 'send-invite', id: other.id });
    assert.ok(inv.status === 409 && /already been held/.test(inv.body.error), JSON.stringify(inv.body));
    await raw.prepare("DELETE FROM board_state WHERE key = 'welcome'").run();
  }
  assert.equal(typeof heldNoSend, 'function', 'one check every send that looks ahead makes (board-shared.js), the page’s too');
});

// ─── Admin 2 (item 6): a send going out elsewhere: the page told to look again ─────────

test('Admin 2: a press told the email is going out right now is told to look again by itself (Email the board, the minutes notice, the invite), with the meeting', async () => {
  const m = await ahead();
  await approvedAndShared(m.id);
  const p = await heldWithMinutes();
  for (const [action, id] of [['send-packet', m.id], ['send-minutes', p.id]]) {
    // (the first press holds the send while Resend answers)
    let open;
    const held = new Promise((r) => { open = r; });
    const realF = globalThis.fetch;
    let reached;
    const at = new Promise((r) => { reached = r; });
    globalThis.fetch = async (input, init) => { if (String(input).startsWith('https://api.resend.com/')) { reached(); await held; } return realF(input, init); };
    const first = api({ action, id });
    await at;
    const second = await api({ action, id });
    open();
    await first;
    globalThis.fetch = realF;
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.sending, true);
    assert.equal(second.body.lookAgain, true, `${action}: the page looks again by itself until it shows it sent`);
    assert.ok(second.body.meeting?.id === id, 'with the meeting as it is now');
    // looked again: it shows it sent
    const now = await board.getMeeting(env.DB, id);
    assert.ok(action === 'send-packet' ? now.packetSentAt : now.minutesSentAt, `${action}: shown sent once it has gone`);
  }
  // The invite going out from another tab: the same
  const cur = await board.getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'save-meeting', base: cur.updatedAt, meeting: { ...cur, location: 'Example Hall, Room 2' } })).status, 200);
  let open;
  const reached = new Promise((res) => { googleHold = { wait: () => { res(); return new Promise((r) => { open = r; }); } }; });
  const first = api({ action: 'send-invite', id: m.id });
  await reached;
  const second = await api({ action: 'send-invite', id: m.id });
  open();
  await first;
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body.lookAgain, true, 'the invite: looks again by itself');
});

// ─── Admin 4 (item 7): a failed read of the sign-in email's record is never "nobody" ───

test('Admin 4: the sign-in email’s record not read is said as that, never an empty record stamped now: Board access’s look, Board’s page and the send’s answer', async () => {
  const sent = await api({ action: 'send-welcome' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const RE = /^SELECT key, data, updated_at FROM board_state WHERE key IN \('welcome', 'welcome-sending'\)$/;
  // Board access's quick look
  fault = { test: (q) => RE.test(q), k: 0, seen: 0, failed: [] };
  const quick = await route(admin, '/api/board-admin?welcome=1', FOUNDER);
  assert.ok(fault.failed.length, 'the read failed');
  fault = null;
  assert.equal(quick.status, 503, JSON.stringify(quick.body));
  assert.ok(!quick.body?.welcome && !quick.body?.welcomeAt, 'no record, no time: the panel keeps what it showed');
  assert.match(quick.body.error, /couldn’t check/);
  // Board's page
  fault = { test: (q) => RE.test(q), k: 0, seen: 0, failed: [] };
  const page = await route(admin, '/api/board-admin', FOUNDER);
  fault = null;
  assert.equal(page.status, 200);
  assert.equal(page.body.welcomeUnread, true);
  assert.equal(page.body.welcomeAt, undefined, 'never stamped now');
  assert.ok(Object.keys(page.body.welcome?.members || {}).length === 4, `the record as it is (${JSON.stringify(page.body.welcome)})`);
  // The send's answer (nobody new to send to; its read for who has it fails)
  fault = { test: (q) => RE.test(q), k: 0, seen: 0, failed: [] };
  const again = await api({ action: 'send-welcome', slugs: ['sam-ortiz'] });
  fault = null;
  assert.ok(!again.body?.welcome || Object.keys(again.body.welcome.members || {}).length, `never an empty record: ${JSON.stringify(again.body).slice(0, 300)}`);
});

// ─── Admin 5 (item 8): "already approved", said to whoever presses ─────────────────────

test('Admin 5: Approve pressed again by the founder who approved it (another tab) is “you”; by someone else, their name with when', async () => {
  const m = await ahead();
  assert.equal((await api({ action: 'approve-agenda', id: m.id })).status, 200);
  const mine = await api({ action: 'approve-agenda', id: m.id });
  assert.equal(mine.body.already, true);
  assert.equal(mine.body.mine, true, JSON.stringify(mine.body));
  const other = await route(admin, '/api/board-admin', 'pat@soardcharity.com', { method: 'POST', body: { action: 'approve-agenda', id: m.id } });
  // (Pat may not run Board: then refused as that; the words are the page's, from the answer)
  if (other.status === 200) assert.ok(!other.body.mine, JSON.stringify(other.body));
  const appr = (await route(admin, '/api/board-admin', FOUNDER)).body.approvals[m.id];
  assert.equal(appr.email, FOUNDER, 'whose approval it is');
  const { approvedAlready } = await import('../public/admin/board-ui.js');
  assert.equal(typeof approvedAlready, 'function');
  assert.equal(approvedAlready({ by: 'Jane Doe', at: appr.at, mine: true }), 'You approved it already, maybe in another tab.');
  assert.match(approvedAlready({ by: 'Jane Doe', at: appr.at }), /^Jane Doe approved it already, at \d{1,2}:\d{2} [AP]M\.$/);
  assert.match(approvedAlready({ by: 'Jane Doe', at: '2026-11-20T21:12:00Z' }, Date.parse('2026-11-23T21:12:00Z')), /^Jane Doe approved it already, on Nov 20 at 4:12 PM\.$/);
});
