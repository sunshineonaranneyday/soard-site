/**
 * Board QA round 10 (Nov 22 2026): the privacy tester's findings 1 to 5, and the reads seen with the same pattern.
 *   The cause: a read of People and their emails that wasn't sure, so one failure read as an empty board. The rule is now
 *   the default where the reads are made (./functions/api/_board-roles.js and the helpers built on it): a read that fails
 *   throws, in words (readDown), unless its caller says `sure: false` with its reason beside it.
 *   1  the calendar's hourly look keeps every invite's answers on a failed read, and says so in its status
 *   2  Send the invite with a failed read sends nothing (503, "nothing was sent"), never an invite to nobody
 *   3  the invites' follow is quiet on a failed read (a warning only after half an hour); "reads empty" only when it does
 *   4  new words on a paper the board signs, with a failed read: refused (503), never saved without asking
 *   5  a changed sign-in email's notice to the old address stays due on a failed read, and the chain gets nothing untrue
 *   also: Board's page, the board page, the packet, minutes notice and sign-in email, the auditor's export, the secretary's
 *   notes, the RSVP link, the reveal invites' board and the Advisory Board's committee
 *   and a check that keeps it so: every call of these helpers in functions/ either relies on the default or is one of the
 *   few opt-outs listed here, each with its reason
 * Failures are made as tests/board-round9.test.mjs makes them: the database's prepare wrapped, so a statement matching
 * `fault.re` fails (after `skip` that pass) `n` times. Most findings are swept over every place in turn a read could fail,
 * so the proof doesn't hang on the order the reads are made in. Made-up people only (the repo is public).
 * Run: node --test tests/board-round10.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { agendaApproved } from './lib/agenda-approved.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as rsvp from '../functions/api/board-rsvp.js';
import * as roles from '../functions/api/_board-roles.js';
import * as board from '../functions/api/_board.js';
import * as invites from '../functions/api/_board-invite.js';
import { syncBoardCalendar } from '../functions/api/_board-calendar.js';
import { maybeRunSigning } from '../functions/api/_board-sign.js';
import { saveNotes, sendNotes } from '../functions/api/_board-notes.js';
import * as reveal from '../functions/api/_reveal-invites.js';
import * as advApps from '../functions/api/_advisory-applications.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import { cleanMeeting, todayEastern } from '../public/admin/board-shared.js';

const ROOT = new URL('../', import.meta.url).pathname;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const BOARD = [ALEX, SAM, TAYLOR];
// (the words, as round 9 decided them: ./functions/api/_board-roles.js)
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
const PEOPLE_DOWN = 'We couldn’t check People just now, so nothing was changed. Please try again in a moment.';
const PEOPLE_DOWN_SENT = 'We couldn’t check People just now, so nothing was sent. Please try again in a moment.';
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
  ['ada-example', { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['ada-example', 'ada.adv@example.org']];

// ─── The database not answering one statement ───────────────────────
let fault = null; // { re, n, skip, failed }
// The reads of People and their emails: with their emails in one statement (peopleWithEmails), People alone, the emails alone
const JOIN = /LEFT JOIN reveal_board_emails/;
const TEAM_READ = /^SELECT slug, data FROM team$/;
const EMAILS_READ = /^SELECT slug, email FROM reveal_board_emails$/;
const PEOPLE_READS = [['the read with emails', JOIN], ['People alone', TEAM_READ], ['the emails alone', EMAILS_READ]];
const hit = () => { if (fault.skip > 0) { fault.skip -= 1; return false; } if (fault.n === 0) return false; fault.n -= 1; fault.failed += 1; return true; };
function hooked(DB) {
  const prepare = DB.prepare.bind(DB);
  const no = () => { throw new Error('D1_ERROR: Network connection lost.'); };
  const wrap = (st) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => (hit() ? no() : s[m](...a)) : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
  return new Proxy(DB, { get: (t, k) => (k === 'prepare' ? (sql) => (fault && fault.re.test(sql) ? wrap(prepare(sql)) : prepare(sql)) : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
}
const failOnce = (re, { n = 1, skip = 0 } = {}) => { fault = { re, n, skip, failed: 0 }; return fault; };
const answers = () => { const f = fault; fault = null; return f?.failed || 0; };
/** A read that failed, as the helpers throw it now: in words, 503, with the database's error as its cause */
const down = (words = PEOPLE_DOWN) => (e) => e?.unread === true && e.status === 503 && e.message === words;

let env;
let raw;
/* r15: what each request left running after its answer (waitUntil), finished inside its own test with its own fakes,
   never thrown away to run on into the next test (Board QA round 15's full check: tests/board.test.mjs) */
let leftRunning = [];
const realFetch = globalThis.fetch;
let google; // { events, calls }
let mail; // every email Resend was asked to send: { to, subject }
beforeEach(async () => {
  leftRunning = [];
  fault = null;
  raw = await createD1();
  const files = new Map();
  env = {
    DB: hooked(raw), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', GOOGLE_CALENDAR_KEY: GOOGLE_KEY, ALERT_EMAILS: 'alerts@example.com',
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
  _resetKeyCacheForTests();
  clearTokenCache();
  google = { events: {}, calls: [] };
  mail = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), subject: e.subject });
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      const u = new URL(url);
      google.calls.push({ method, url, body });
      // (an admin's calendar, read for board meeting invites Board didn't send: none here)
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
    // (the numbers' outside services: nothing answers in these tests)
    return new Response('{}', { status: 503 });
  };
});
afterEach(async () => {
  for (let n = 0; leftRunning.length && n < 10; n++) { const going = leftRunning; leftRunning = []; await Promise.allSettled(going); }
  globalThis.fetch = realFetch; fault = null;
});

/** A route behind the real sign-in middleware, as `who` */
async function route(handler, path, who, { method = 'GET', body = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = { request, env, data: {}, waitUntil: (p) => { leftRunning.push(p); } };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json = null;
  try { json = JSON.parse(text); } catch { /* a file, or a page */ }
  return { status: res.status, body: json, text, bytes, type: res.headers.get('Content-Type') || '' };
}
const api = (body) => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body });
const googleWrites = () => google.calls.filter((c) => c.method !== 'GET');
const boardMail = () => mail.filter((m) => m.to.some((t) => BOARD.includes(t)));

/** A meeting ahead with a time and a place, saved from Board as its editor saves it */
async function meeting(days, fields = {}) {
  const made = await api({ action: 'new-meeting', date: inDays(days) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const r = await api({ action: 'save-meeting', base: made.body.meeting.updatedAt, meeting: { ...made.body.meeting, start: '08:00', end: '10:00', location: 'Example Hall', ...fields } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
/** That meeting with its invite out (Send the invite, read cleanly) */
async function invited(days, fields = {}) {
  const m = await meeting(days, fields);
  const r = await api({ action: 'send-invite', id: m.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
/** How the board answered at Google */
function answerAtGoogle(eventId, answered) {
  for (const a of google.events[eventId].attendees) if (answered[a.email]) a.responseStatus = answered[a.email];
}
/** A meeting the server keeps (not a person's save), with its fields as given */
const kept = async (fields) => board.saveMeeting(env.DB, cleanMeeting({ sections: [{ title: 'New business', items: [{ title: 'Budget' }] }], ...fields }), { by: 'test' });

// ─── The rule, kept: every read of People in functions/ chooses ─────

// The helpers that read People or their emails, and the reads built on them that decide who is on the board, the
// Advisory Board or the staff, and at which address
const HELPERS = ['peopleRows', 'privateEmails', 'peopleWithEmails', 'activeBoard', 'activeAdvisors', 'boardMemberFor', 'advisorFor', 'boardAdmins', 'roster', 'packetList', 'organizerFor', 'guestsFor', 'boardRoster', 'committeeMembers'];
/**
 * The few callers that want "nobody" on a failure, each read-only and harmless, each with its reason beside it
 * (a "not sure:" comment): file → helper → how many. A new one has to be added here, with its reason in the source
 */
const OPT_OUTS = {
  'functions/api/_board.js': { activeBoard: 1 }, // a meeting's roll follows People only when it's read; a failure keeps every roll as stored
  'functions/api/_process-docs.js': { peopleRows: 1 }, /* r11: whose Drive to ask as is a sure read now (a failure keeps every Doc as it was and is looked at again), so only the review notice's stays */ // the review notice (nothing sent or marked)
  'functions/api/messages-admin.js': { organizerFor: 1 }, // a sample email's "from" line in a preview
};
const jsFiles = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : []; });
// (comments blanked, lines kept: a name in a comment is no call)
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (c, lead) => lead + ' '.repeat(c.length - lead.length));
/** The text inside the parentheses that open at `at` (strings and nested parentheses kept whole), and where it ends */
function inside(s, at) {
  let depth = 0;
  let quote = '';
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (!depth) return { args: s.slice(at + 1, i), end: i + 1 }; }
  }
  return { args: s.slice(at + 1), end: s.length };
}
const topLevelCommas = (s) => { let d = 0; let n = 0; for (const c of s) { if ('([{'.includes(c)) d += 1; else if (')]}'.includes(c)) d -= 1; else if (c === ',' && d === 0) n += 1; } return n; };
function peopleReads() {
  const out = [];
  const re = new RegExp(`(?<![\\w$])(?:[\\w$]+\\.)?(${HELPERS.join('|')})\\(`, 'g');
  for (const file of jsFiles(join(ROOT, 'functions'))) {
    const src = readFileSync(file, 'utf8');
    const code = blank(src);
    const lines = src.split('\n');
    let m;
    while ((m = re.exec(code))) {
      if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue; // its definition
      const open = m.index + m[0].length - 1;
      const { args, end } = inside(code, open);
      const after = code.slice(end).match(/^\s*\.(catch|then)\(/);
      let swallows = false;
      if (after) {
        const handler = inside(code, end + after[0].length - 1).args;
        swallows = after[1] === 'catch' ? !/\bthrow\b/.test(handler) : topLevelCommas(handler) > 0 && !/\bthrow\b/.test(handler.slice(handler.lastIndexOf(','))) ;
      }
      const line = code.slice(0, m.index).split('\n').length;
      const reason = lines.slice(Math.max(0, line - 4), line).some((l) => /not sure:/.test(l));
      out.push({ file: relative(ROOT, file), line, helper: m[1], args, swallows, unsure: /\bsure:\s*false\b/.test(args), passes: /\bsure\b/.test(args) && !/\bsure:\s*false\b/.test(args), reason, text: lines[line - 1].trim() });
    }
  }
  return out;
}

test('every read of People in functions/ is sure by default, or one of the listed opt-outs with its reason beside it', () => {
  const reads = peopleReads();
  assert.ok(reads.length > 100, `found the reads (${reads.length})`);
  const problems = [];
  const optOuts = {};
  for (const r of reads) {
    const where = `${r.file}:${r.line} ${r.text}`;
    // (`sure` passed along only inside the helpers themselves: ./_board-roles.js, and roster built on them)
    if (r.passes && !(r.file === 'functions/api/_board-roles.js' || (r.file === 'functions/api/_board.js' && /\{ sure \}/.test(r.args)))) problems.push(`passes its own "sure" (the default is sure: say nothing, or sure: false with a reason): ${where}`);
    if (r.unsure || r.swallows) {
      if (!r.reason) problems.push(`reads a failure as nobody with no "not sure:" reason beside it: ${where}`);
      ((optOuts[r.file] ||= {})[r.helper] ||= 0);
      optOuts[r.file][r.helper] += 1;
    }
  }
  assert.deepEqual(problems, []);
  assert.deepEqual(optOuts, OPT_OUTS, 'the opt-outs are exactly the listed ones: a new read that wants "nobody" has to choose, here');
});

test('each helper throws in words on a failed read (503, unread), and only `sure: false` reads it as nobody', async () => {
  const calls = {
    peopleRows: (o) => roles.peopleRows(env.DB, o), privateEmails: (o) => roles.privateEmails(env.DB, o), peopleWithEmails: (o) => roles.peopleWithEmails(env.DB, o),
    activeBoard: (o) => roles.activeBoard(env.DB, o), activeAdvisors: (o) => roles.activeAdvisors(env.DB, o),
    boardMemberFor: (o) => roles.boardMemberFor(env.DB, ALEX, o), advisorFor: (o) => roles.advisorFor(env.DB, 'ada.adv@example.org', o),
    roster: (o) => board.roster(env.DB, { withEmails: true, ...o }),
  };
  for (const [name, call] of Object.entries(calls)) {
    for (const [what, re] of [['every statement', /./], ...PEOPLE_READS]) {
      failOnce(re, { n: 5 });
      const failed = await call().then(() => null, (e) => e);
      const n = answers();
      if (!n) continue; // (this helper doesn't make that read)
      assert.ok(down()(failed), `${name}, ${what} failing: ${failed?.message || 'answered as if it had read it'}`);
    }
    failOnce(/./, { n: 5 });
    await call({ sure: false }); // (resolves: nobody, as asked)
    answers();
  }
  for (const [name, call] of Object.entries({
    packetList: () => board.packetList(env.DB), guestsFor: () => invites.guestsFor(env.DB), organizerFor: () => invites.organizerFor(env.DB),
    boardRoster: () => reveal.boardRoster(env.DB), 'boardRoster (Advisory Board)': () => reveal.boardRoster(env.DB, 'advisory'), fetchBoard: () => reveal.fetchBoard(env),
    committeeMembers: () => advApps.committeeMembers(env.DB, 'Advisory Board'),
  })) {
    for (const [what, re] of PEOPLE_READS) {
      failOnce(re, { n: 5 });
      const failed = await call().then(() => null, (e) => e);
      const n = answers();
      if (!n) continue;
      assert.ok(failed?.unread === true && failed.status === 503, `${name}, ${what} failing: ${failed?.message || 'answered as if it had read it'}`);
    }
  }
  // (packetList is a send's list: said as nothing sent)
  failOnce(JOIN);
  await assert.rejects(() => board.packetList(env.DB), down(PEOPLE_DOWN_SENT));
});

// ─── 1: the calendar's hourly look ─────────────────────────────────

test('1: one failed read of People in the calendar look keeps every invite’s answers, says so in its status, and the next look reads them', async () => {
  const m = await invited(9);
  answerAtGoogle(m.invite.eventId, { [ALEX]: 'accepted', [SAM]: 'declined' });
  assert.equal((await syncBoardCalendar(env, { now: Date.now() })).ok, true);
  const before = (await board.getMeeting(env.DB, m.id)).invite.replies;
  assert.deepEqual(before, { 'alex-rivera': 'accepted', 'sam-ortiz': 'declined', 'taylor-nguyen': 'invited' });

  failOnce(JOIN);
  const st = await syncBoardCalendar(env, { now: Date.now() + 61 * MIN });
  assert.equal(answers(), 1, 'the read failed');
  assert.deepEqual((await board.getMeeting(env.DB, m.id)).invite.replies, before, 'every answer kept');
  assert.deepEqual([st.ok, st.unread, st.error], [false, true, PEOPLE_DOWN], 'the look says it couldn’t check People');
  assert.ok(st.failingSince, 'with when it began (a passing note for half an hour, then a warning)');
  // Alex's page still has his answer, and the reminder goes to the one who hasn't answered, never the false words
  const page = await route(portal, '/api/board-portal', ALEX);
  assert.equal(page.status, 200);
  const mine = [...(page.body.meetings || []), page.body.nextPending].find((x) => x?.id === m.id);
  assert.deepEqual([mine?.myInvite, mine?.onCalendar], ['accepted', true]);
  await board.patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true }), { by: 'test' });
  const r = await api({ action: 'remind-rsvp', id: m.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(boardMail().map((x) => x.to[0]), [TAYLOR], 'asked: only Taylor, who hasn’t answered');
  // It stays due: the next heartbeat's look reads People and is ok again
  const again = await syncBoardCalendar(env, { now: Date.now() + 62 * MIN });
  assert.deepEqual([again.ok, again.unread, again.failingSince], [true, undefined, undefined]);
  assert.deepEqual((await board.getMeeting(env.DB, m.id)).invite.replies, before);
});

test('1: every read of People failing in turn in the calendar look: no invite ever loses an answer', async () => {
  const m = await invited(9);
  answerAtGoogle(m.invite.eventId, { [ALEX]: 'accepted', [SAM]: 'declined' });
  await syncBoardCalendar(env, { now: Date.now() });
  const before = (await board.getMeeting(env.DB, m.id)).invite.replies;
  let failedAny = 0;
  for (const [what, re] of [...PEOPLE_READS, ['any statement', /./]]) {
    for (let skip = 0; skip < 12; skip++) {
      failOnce(re, { skip });
      await syncBoardCalendar(env, { now: Date.now() + (skip + 2) * 61 * MIN }).catch(() => null);
      failedAny += answers();
      assert.deepEqual((await board.getMeeting(env.DB, m.id)).invite.replies, before, `${what}, the read after ${skip} failing`);
    }
  }
  assert.ok(failedAny > 10, 'the reads did fail');
});

// ─── 2: Send the invite ────────────────────────────────────────────

test('2: Send the invite with any read of People failing sends nothing and says so (503), never an invite to nobody', async () => {
  let refused = 0;
  let day = 20;
  for (const [what, re] of PEOPLE_READS) {
    for (let skip = 0; skip < 6; skip++) {
      const m = await meeting(day++);
      const writes = googleWrites().length;
      failOnce(re, { skip });
      const r = await api({ action: 'send-invite', id: m.id });
      const failed = answers();
      const now = await board.getMeeting(env.DB, m.id);
      if (r.status === 200) {
        // (the failure fell on a read that changes nothing: the invite went whole)
        const ev = google.events[now.invite.eventId];
        assert.deepEqual(ev.attendees.map((a) => a.email).filter((e) => BOARD.includes(e)).sort(), [...BOARD].sort(), `${what} after ${skip}: everyone on it`);
        assert.equal(Object.keys(now.invite.who).length, 3, `${what} after ${skip}: Board knows it put the whole board on`);
        continue;
      }
      assert.ok(failed, `${what} after ${skip}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.status, 503, `${what} after ${skip}: ${JSON.stringify(r.body)}`);
      assert.ok([PEOPLE_DOWN_SENT, SIGN_IN_DOWN].includes(r.body.error), r.body.error);
      assert.equal(googleWrites().length, writes, `${what} after ${skip}: Google asked to write nothing`);
      assert.equal(now.invite, null, 'no invite recorded');
      refused += 1;
    }
  }
  assert.ok(refused >= 3, 'the reads Send the invite goes by did fail');
});

test('2: an invite already out, sent again after a new place with a read of People failing: its answers stay, nothing is sent', async () => {
  const m = await invited(9);
  answerAtGoogle(m.invite.eventId, { [ALEX]: 'accepted', [SAM]: 'declined' });
  await syncBoardCalendar(env, { now: Date.now() });
  const before = (await board.getMeeting(env.DB, m.id)).invite.replies;
  let refused = 0;
  for (let skip = 0; skip < 5; skip++) {
    const cur = await board.getMeeting(env.DB, m.id);
    assert.equal((await api({ action: 'save-meeting', base: cur.updatedAt, meeting: { ...cur, location: `Example Hall ${skip}` } })).status, 200);
    const writes = googleWrites().length;
    failOnce(JOIN, { skip });
    const r = await api({ action: 'send-invite', id: m.id });
    answers();
    const replies = (await board.getMeeting(env.DB, m.id)).invite.replies;
    assert.deepEqual(replies, before, `the read after ${skip} failing: ${r.status} ${JSON.stringify(r.body?.error)}`);
    if (r.status !== 200) {
      assert.deepEqual([r.status, r.body.error], [503, PEOPLE_DOWN_SENT]);
      assert.equal(googleWrites().length, writes, 'nothing went to Google');
      refused += 1;
    }
  }
  assert.ok(refused >= 1);
});

// ─── 3: the invites' follow ────────────────────────────────────────

test('3: the follow is quiet on a failed read (no alert, nothing changed), warns after half an hour of it, and "reads empty" is only for a board that does', async () => {
  const m = await invited(9);
  const follow = (minutes) => invites.maybeFollowBoard(env, { now: Date.now() + minutes * MIN });
  await follow(0);
  mail = [];
  const writes = googleWrites().length;
  const invite = (await board.getMeeting(env.DB, m.id)).invite;

  failOnce(JOIN);
  await follow(6);
  assert.equal(answers(), 1);
  assert.deepEqual(mail.map((x) => x.subject), [], 'nobody told People reads empty: it was never read');
  assert.equal(googleWrites().length, writes, 'no invite changed');
  assert.deepEqual((await board.getMeeting(env.DB, m.id)).invite, invite);
  const st = await roles.readState(env.DB, 'invite-follow');
  assert.deepEqual([st.unread, st.error, !!st.unreadSince], [true, PEOPLE_DOWN, true], 'said in its status, quietly');

  // Still failing half an hour on: the staff are told once, in the true words
  failOnce(JOIN, { n: 99 });
  await follow(18);
  await follow(37);
  await follow(43);
  answers();
  const told = mail.map((x) => x.subject);
  assert.equal(told.length, 1, JSON.stringify(told));
  assert.match(told[0], /can’t check People/);
  assert.doesNotMatch(told[0], /reads empty/);
  // People answers again: the follow is itself again
  await follow(50);
  const fine = await roles.readState(env.DB, 'invite-follow');
  assert.deepEqual([fine.unread, fine.error, fine.told], [false, '', '']);

  // A board that does read empty is still said, once
  await raw.prepare("UPDATE team SET data = json_set(data, '$.status', 'alumni') WHERE \"group\" = 'board'").run();
  mail = [];
  await follow(60);
  assert.match(mail.map((x) => x.subject).join(' | '), /reads empty/);
  assert.equal(googleWrites().length, writes, 'and nothing comes off');
});

// ─── 4: new words on a paper the board signs ───────────────────────

test('4: new words on a paper Alex signed, saved with the read of the board failing: refused (503), never version 2 with his signature counted', async () => {
  const d = (await api({ action: 'save-doc', doc: { title: 'Gift Acceptance Policy', kind: 'policy', sign: true, shared: true, body: 'SOARD accepts gifts of cash and stock.' } })).body.doc;
  const year = Number(todayEastern().slice(0, 4));
  const signed = await route(portal, '/api/board-portal', ALEX, { method: 'POST', body: { action: 'sign', docId: d.id, name: 'Alex Rivera', version: d.version, year, mark: { type: 'typed', style: 'caveat', text: 'Alex Rivera', initials: 'AR' }, consent: true } });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const words = 'SOARD accepts gifts of cash, stock and real estate, and may sell any gift at once.';
  let refused = 0;
  for (const [what, re] of PEOPLE_READS) {
    for (let skip = 0; skip < 4; skip++) {
      const cur = (await board.listDocs(env.DB)).find((x) => x.id === d.id);
      failOnce(re, { skip });
      const r = await api({ action: 'save-doc', base: cur.version, doc: { ...cur, body: words } });
      answers();
      const now = (await board.listDocs(env.DB)).find((x) => x.id === d.id);
      assert.notEqual(r.status, 200, `${what} after ${skip}: never saved without asking (${JSON.stringify(r.body?.doc && { version: r.body.doc.version, signFrom: r.body.doc.signFrom })})`);
      assert.deepEqual([now.version, now.body], [cur.version, cur.body], 'nothing changed');
      if (r.status === 503) { assert.ok([PEOPLE_DOWN, SIGN_IN_DOWN].includes(r.body.error)); refused += 1; continue; }
      assert.deepEqual([r.status, r.body.error, r.body.ask?.names], [409, 'Do they sign the new version?', ['Alex Rivera']]);
    }
  }
  assert.ok(refused >= 1, 'the read of the board did fail');
  const ask = await api({ action: 'save-doc', base: d.version, doc: { ...(await board.listDocs(env.DB)).find((x) => x.id === d.id), body: words } });
  assert.deepEqual([ask.status, ask.body.ask?.names], [409, ['Alex Rivera']], 'answered, it asks');
});

// ─── 5: a changed sign-in email, the old address told ──────────────

test('5: a changed email’s notice stays due on a failed read, the chain gets nothing untrue, and the next clean look tells the old address', async () => {
  let unreadSeen = 0;
  for (let skip = 0; skip < 4; skip++) {
    const fresh = `taylor.new${skip}@example.net`;
    const was = normalize((await raw.prepare("SELECT email FROM reveal_board_emails WHERE slug = 'taylor-nguyen'").first()).email);
    await reveal.setBoardEmail(env.DB, 'taylor-nguyen', fresh);
    const changed = (await raw.prepare("SELECT seq FROM board_sign_events WHERE kind = 'email-changed' ORDER BY seq DESC LIMIT 1").first()).seq;
    mail = [];
    failOnce(JOIN, { skip });
    await maybeRunSigning(env);
    answers();
    const notices = async () => ((await raw.prepare("SELECT detail FROM board_sign_events WHERE kind = 'notice-sent'").all()).results || []).map((r) => JSON.parse(r.detail)).filter((x) => x.for === changed);
    assert.deepEqual((await notices()).filter((x) => x.skipped), [], `the read after ${skip} failing: never "not on the board" for a sitting member`);
    if (!(await notices()).length) {
      assert.deepEqual(mail.filter((x) => x.to.includes(was)), [], 'nothing sent yet');
      unreadSeen += (await roles.readState(env.DB, 'signing-look')).unread ? 1 : 0;
    }
    // The next clean looks: told once, at the old address only
    for (let i = 0; i < 3; i++) await maybeRunSigning(env);
    assert.equal(mail.filter((x) => x.to.includes(was)).length, 1, `told at ${was} once`);
    assert.deepEqual((await notices()).map((x) => x.to), [was]);
    assert.ok(!mail.some((x) => x.to.includes(fresh)), 'never at the new one');
    assert.equal((await roles.readState(env.DB, 'signing-look')).unread, undefined, 'the look is itself again');
  }
  assert.ok(unreadSeen >= 1, 'a look whose read failed waited, and said so');
});
const normalize = (e) => String(e || '').trim().toLowerCase();

test('5: the email change itself, its old address or its person not read: nothing is saved, so no change goes untold', async () => {
  for (const re of [/^SELECT email FROM reveal_board_emails WHERE slug = \?$/, /^SELECT data FROM team WHERE slug = \?$/]) {
    failOnce(re);
    await assert.rejects(() => reveal.setBoardEmail(env.DB, 'taylor-nguyen', 'taylor.elsewhere@example.net'), down());
    assert.equal(answers(), 1);
    assert.equal((await raw.prepare("SELECT email FROM reveal_board_emails WHERE slug = 'taylor-nguyen'").first()).email, TAYLOR, 'the address is as it was');
  }
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM board_sign_events WHERE kind = 'email-changed'").first()).n, 0);
  // Read cleanly: saved, and in the chain to be told
  await reveal.setBoardEmail(env.DB, 'taylor-nguyen', 'taylor.elsewhere@example.net');
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM board_sign_events WHERE kind = 'email-changed'").first()).n, 1);
});

// ─── Also seen: the pages, the sends, the export ───────────────────

test('also: Board’s page with any read of People failing is the sign-in words with Try again, never Members empty or "has no email"', async () => {
  delete env.GOOGLE_CALENDAR_KEY;
  await kept({ date: inDays(12), actions: [{ id: 'a_sponsor1', text: 'Send the sponsor list to the board', owner: 'alex-rivera', ownerName: 'Alex Rivera', date: inDays(5) }] });
  let refused = 0;
  for (const [what, re] of PEOPLE_READS) {
    for (let skip = 0; skip < 10; skip++) {
      failOnce(re, { skip });
      const r = await route(admin, '/api/board-admin?quick=1', FOUNDER);
      const failed = answers();
      if (r.status === 200) {
        assert.equal(r.body.members.length, 3, `${what} after ${skip}${failed ? ' (failed)' : ''}: Members has the board`);
        assert.equal(r.body.packetTo, 3, `${what} after ${skip}: the packet goes to them all`);
        assert.equal(r.body.people.board.length, 3);
        assert.doesNotMatch(r.body.reminders.why, /no email/, `${what} after ${skip}: ${r.body.reminders.why}`);
        continue;
      }
      assert.deepEqual([r.status, r.body.error], [503, SIGN_IN_DOWN], `${what} after ${skip}`);
      refused += 1;
    }
  }
  assert.ok(refused >= 3);
});

test('also: a member’s page with any read of People failing is the sign-in words with Try again, never an empty directory or emails missing', async () => {
  delete env.GOOGLE_CALENDAR_KEY;
  let refused = 0;
  for (const [what, re] of PEOPLE_READS) {
    for (let skip = 0; skip < 10; skip++) {
      failOnce(re, { skip });
      const r = await route(portal, '/api/board-portal', ALEX);
      answers();
      if (r.status === 200) {
        assert.equal(r.body.people.board.length, 3, `${what} after ${skip}: the board directory`);
        assert.ok(r.body.people.board.every((p) => p.email), `${what} after ${skip}: with their emails`);
        continue;
      }
      assert.ok([403, 503].includes(r.status) && [SIGN_IN_DOWN, 'We couldn’t check your sign-in just now. Please try again in a moment.'].includes(r.body.error), `${what} after ${skip}: ${r.status} ${JSON.stringify(r.body)}`);
      refused += 1;
    }
  }
  assert.ok(refused >= 3);
});

test('also: the packet, the minutes notice and the sign-in email with the board’s read failing send nothing and say so, never to fewer', async () => {
  delete env.GOOGLE_CALENDAR_KEY;
  const past = await kept({ date: inDays(-10), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() } });
  /* r12: the packet never goes for a meeting held, so Email the board's is a meeting ahead, its agenda approved */
  const next = await kept({ date: inDays(10), start: '08:00', end: '10:00', shared: true });
  await agendaApproved(env.DB, next.id);
  await roles.readState(env.DB, 'welcome'); // (makes board_state)
  const sends = {
    'Email the board (the packet)': { action: 'send-packet', id: next.id },
    'the minutes are up': { action: 'send-minutes', id: past.id },
    'the sign-in email': { action: 'send-welcome' },
  };
  for (const [name, body] of Object.entries(sends)) {
    let refused = 0;
    for (let skip = 0; skip < 4; skip++) {
      mail = [];
      // (each send's own record of who had it, cleared, so each try is a first)
      await raw.prepare("DELETE FROM board_state WHERE key LIKE 'board-send:%' OR key IN ('welcome', 'welcome-sending')").run();
      failOnce(JOIN, { skip });
      const r = await api(body);
      answers();
      const to = boardMail().flatMap((x) => x.to).filter((e) => BOARD.includes(e));
      if (r.status === 200) { assert.deepEqual([...new Set(to)].sort(), [...BOARD].sort(), `${name} after ${skip}: to the whole board`); continue; }
      assert.deepEqual([r.status, r.body.error], [503, PEOPLE_DOWN_SENT], `${name} after ${skip}: ${JSON.stringify(r.body)}`);
      assert.deepEqual(to, [], `${name} after ${skip}: nothing sent`);
      refused += 1;
    }
    assert.ok(refused >= 1, `${name}: the board’s read did fail`);
  }
});

test('also: the auditor’s export with the board’s read failing is refused in words, never a ZIP missing who hasn’t signed', async () => {
  delete env.GOOGLE_CALENDAR_KEY;
  const d = (await api({ action: 'save-doc', doc: { title: 'Conflict of Interest Policy', kind: 'policy', sign: true, shared: true, body: 'Each member tells the board of any conflict.' } })).body.doc;
  const year = Number(todayEastern().slice(0, 4));
  let refused = 0;
  for (let skip = 0; skip < 4; skip++) {
    failOnce(JOIN, { skip });
    const r = await route(admin, `/api/board-admin?record=${d.id}&year=${year}`, FOUNDER);
    answers();
    if (r.status === 200) {
      const zip = new TextDecoder().decode(r.bytes);
      for (const name of ['Alex Rivera', 'Sam Ortiz', 'Taylor Nguyen']) assert.match(zip, new RegExp(`${name}[^\\n]*Not signed`), `after ${skip}: ${name} is in it, not signed`);
      continue;
    }
    assert.deepEqual([r.status, r.body.error], [503, PEOPLE_DOWN], `after ${skip}`);
    refused += 1;
  }
  assert.ok(refused >= 1);
});

test('also: the secretary’s notes sent with People not read send nothing and say so', async () => {
  delete env.GOOGLE_CALENDAR_KEY;
  const m = await kept({ date: todayEastern(), start: '08:00', end: '10:00', shared: true, attendance: [{ slug: 'alex-rivera', name: 'Alex Rivera', kind: 'board' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board' }], sections: [{ id: 's_new', title: 'New business', items: [{ id: 'i_budget', title: 'Budget' }] }] });
  const w = { member: null, admin: true, adminEmail: FOUNDER };
  await saveNotes(env, m.id, { changes: { 'n:i_budget': 'The budget passed', 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present' } }, w);
  let refused = 0;
  for (const [what, re] of [['People alone', TEAM_READ], ['the emails alone', EMAILS_READ]]) {
    for (let skip = 0; skip < 4; skip++) {
      const before = await board.getMeeting(env.DB, m.id);
      failOnce(re, { skip });
      const r = await sendNotes(env, m.id, w).then((x) => ({ ok: x }), (e) => ({ e }));
      const failed = answers();
      if (r.ok) { assert.ok(!failed || r.ok.read, `${what} after ${skip}`); continue; }
      assert.ok(down(PEOPLE_DOWN_SENT)(r.e), `${what} after ${skip}: ${r.e?.message}`);
      const after = await board.getMeeting(env.DB, m.id);
      assert.deepEqual([after.files.length, after.minutesFrom], [before.files.length, before.minutesFrom], 'nothing put on the meeting');
      refused += 1;
    }
  }
  assert.ok(refused >= 1);
});

test('also: an old RSVP link with the board’s read failing says it couldn’t check, never "This link is from an older email"', async () => {
  const m = await kept({ date: inDays(9), start: '08:00', end: '10:00', shared: true });
  const tok = 'ab'.repeat(16);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await raw.prepare('INSERT INTO board_rsvp_links (hash, meeting_id, slug, expires) VALUES (?, ?, ?, ?)').bind(hash, m.id, 'alex-rivera', inDays(10)).run();
  const open = async () => { const res = await rsvp.onRequestGet({ request: new Request(`https://sunshineonaranneyday.com/api/board-rsvp?t=${tok}`), env }); return { status: res.status, text: await res.text() }; };
  assert.match((await open()).text, /Alex, will you be at/);
  let refused = 0;
  for (let skip = 0; skip < 3; skip++) {
    failOnce(JOIN, { skip });
    const r = await open();
    answers();
    assert.doesNotMatch(r.text, /older email/, `after ${skip}`);
    if (r.status === 503) { assert.match(r.text, /couldn’t check this link just now/); refused += 1; }
  }
  assert.ok(refused >= 1);
});

test('also: a reveal’s invite never loses the board to a failed read (the board read throws, and a reconcile changes nothing)', async () => {
  for (const [what, re] of [['People alone', TEAM_READ], ['the emails alone', EMAILS_READ]]) {
    failOnce(re);
    await assert.rejects(() => reveal.fetchBoard(env), (e) => e?.unread === true, `${what}: never the board as nobody`);
    answers();
  }
  const all = await reveal.fetchBoard(env);
  assert.deepEqual(all.map((x) => x.email).sort(), [...BOARD, 'ada.adv@example.org'].sort(), 'read cleanly: the board and the Advisory Board');
});
