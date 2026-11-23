/**
 * Board admin, QA round 5 (Nov 21 2026), the founders' Board editor and Home, their rules:
 *   - A-m1: a meeting that isn't a board meeting is never Home's next meeting, never has an invite as its next step, and
 *     Board says why no invite goes out in the site's own words (./board-shared.js noInviteFor, the same answer as
 *     functions/api/_board-invite.js noInviteFor for every meeting)
 *   - A-m2: Email the board waits by the site's own rule (waitsForApproval, holdUntilApproved's): a meeting already on the
 *     board page whose agenda isn't approved is held, and the site refuses it; once approved, neither holds it
 *   - A-m4: the meeting that approves a meeting's minutes is the one whose agenda has them (minutesTarget from the other
 *     side), never the next one ahead when an earlier one after it had them; the day a meeting was held
 *   - A-m5: a refusal by a page that isn't the site's own answer (a 429 or a block page) says what happened, and never
 *     "Reload the page"
 * Made-up people only. Run: node --test tests/board-round5-editor.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { agendaApproved } from './lib/agenda-approved.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as board from '../functions/api/_board.js';
import * as invites from '../functions/api/_board-invite.js';
import * as shared from '../public/admin/board-shared.js';
import * as meetingPage from '../public/admin/board-meeting.js';
import * as ui from '../public/admin/board-ui.js';

const { getMeeting, patchMeeting, ensureSchema, agendaApprovals } = board;
const { todayEastern, cleanMeeting, nextMeeting, waitsForApproval } = shared;
const { pathOf } = meetingPage;

const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
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

const FOUNDER = 'jane@soardcharity.com';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
];
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org']];
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
];
const m = (id, date, more = {}) => cleanMeeting({ id, date, start: '08:00', end: '10:00', sections: AGENDA, attendance: [{ slug: 'alex-rivera', name: 'Alex Rivera', kind: 'board' }], ...more });

let env;
let sent;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  for (const [slug, email] of EMAILS) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const b = JSON.parse(init.body);
      sent.push(...[].concat(b));
      return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function api(body) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(FOUNDER), Origin: 'https://sunshineonaranneyday.com', 'Content-Type': 'application/json' };
  const request = new Request('https://sunshineonaranneyday.com/api/board-admin', { method: 'POST', headers, body: JSON.stringify(body) });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => admin.onRequestPost(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: await res.json() };
}

// ─── A-m1: a meeting that isn't a board meeting ─────────────────────

test('Home’s next meeting is the next board meeting: a “not a board meeting” sooner, or a practice, is never it', () => {
  const today = todayEastern();
  const coffee = m('coffee', inDays(3), { notBoard: true, title: 'Coffee with the gala chair' });
  const practice = m('practice', inDays(0), { practice: true });
  const q4 = m('q4_next', inDays(9));
  assert.equal(nextMeeting([coffee, practice, q4], today)?.id, 'q4_next');
  assert.equal(nextMeeting([coffee], today), null, 'only a coffee ahead: no next board meeting');
});

test('a “not a board meeting” ahead: its invite is never the next step, and says so in words', () => {
  const coffee = m('coffee', inDays(3), { notBoard: true, title: 'Coffee with the gala chair' });
  const data = { members: [{ slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex.board@example.com' }], settings: { admins: [FOUNDER] }, approvals: {}, meetings: [coffee] };
  const path = pathOf(coffee, data, 'ahead');
  const inv = path.find((s) => s.id === 'invite');
  assert.equal(inv.state, 'skip', JSON.stringify(inv));
  assert.equal(inv.sub, 'None: not a board meeting');
  assert.equal(path.find((s) => s.state === 'next')?.id, 'approved', 'the next step is the approval, never the invite');
  // (a board meeting the same day still has its invite to send)
  assert.equal(pathOf({ ...coffee, notBoard: false }, data, 'ahead').find((s) => s.state === 'next')?.id, 'invite');
});

test('why no invite goes out: Board’s words are the site’s, for every kind of meeting', () => {
  assert.equal(typeof shared.noInviteFor, 'function', 'board-shared.js has the rule');
  const now = Date.now();
  const out = { eventId: 'ev1', organizer: FOUNDER, emails: [], when: `${inDays(-30)} 08:00-10:00` };
  const cases = [
    m('coffee', inDays(3), { notBoard: true }),
    m('ahead', inDays(9)),
    m('held', inDays(-30)),
    m('held-out', inDays(-30), { invite: out }),
    m('moved-back', inDays(-30), { invite: { ...out, when: `${inDays(5)} 08:00-10:00` } }),
    m('ended-early', inDays(4), { live: { startedAt: new Date(now - 3600e3).toISOString(), endedAt: new Date(now - 60e3).toISOString() } }),
  ];
  for (const x of cases) assert.equal(shared.noInviteFor(x, now), invites.noInviteFor(x, now), x.id);
  assert.match(shared.noInviteFor(cases[0], now), /isn’t a board meeting\), so no calendar invite goes out for it\.$/);
  assert.equal(shared.noInviteFor(cases[1], now), '');
});

// ─── A-m2: Email the board waits by the site's own rule ─────────────

test('a meeting on the board page whose agenda isn’t approved: Board’s rule holds Email the board, the site refuses it; approved, neither holds it', async () => {
  const made = (await api({ action: 'new-meeting', date: inDays(12) })).body.meeting;
  const on = await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, shared: true }));
  // What Board offers by (./board-meeting.js Getting ready: emailWaits)
  const holds = async (x) => waitsForApproval(x) && !(await agendaApprovals(env.DB))[x.id];
  assert.equal(await holds(on), true, 'Board holds it');
  const no = await api({ action: 'send-packet', id: made.id });
  assert.equal(no.status, 409, JSON.stringify(no.body));
  assert.equal(no.body.error, 'The agenda goes to the board once it’s approved');
  assert.equal(sent.length, 0, 'nothing went');
  await agendaApproved(env.DB, made.id);
  assert.equal(await holds(await getMeeting(env.DB, made.id)), false, 'approved: Board offers it');
  const yes = await api({ action: 'send-packet', id: made.id });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.sent, 2);
});

// ─── A-m4: the meeting that approves these minutes ──────────────────

test('older draft minutes are approved by the meeting whose agenda had them, held or not, never the next one ahead', () => {
  assert.equal(typeof shared.minutesApprover, 'function', 'board-shared.js has the rule');
  const jun = m('jun', inDays(-150), { shared: true, minutes: 'draft' });
  const sep = m('sep', inDays(-60), { shared: true, minutes: 'draft' });
  const nov = m('nov', inDays(9));
  const all = [nov, sep, jun];
  // (Nov's agenda approves Sep's: minutesTarget)
  assert.equal(shared.minutesTarget(nov, all)?.id, 'sep');
  assert.equal(shared.minutesApprover(jun, all)?.id, 'sep', 'Jun’s by Sep, held');
  assert.equal(shared.minutesApprover(sep, all)?.id, 'nov', 'Sep’s by Nov, ahead');
  assert.equal(shared.minutesApprover(nov, all), null, 'nothing after Nov yet');
  // An agenda that names them explicitly wins
  const named = { ...nov, sections: [{ ...AGENDA[0], id: 's1', items: [{ id: 'i1', title: 'Approve the minutes', live: 'minutes', about: 'jun' }] }] };
  assert.equal(shared.minutesApprover(jun, [named, sep, jun])?.id, 'nov');
  // A "not a board meeting" or a practice in between is never it
  const coffee = m('coffee', inDays(-100), { notBoard: true });
  const practice = m('practice', inDays(-90), { practice: true });
  assert.equal(shared.minutesApprover(jun, [nov, sep, practice, coffee, jun])?.id, 'sep');
});

test('the day a meeting was held: its date, or the day the chair ended it when that came first; none while it’s ahead', () => {
  assert.equal(typeof shared.heldOn, 'function', 'board-shared.js has it');
  const now = Date.now();
  assert.equal(shared.heldOn(m('sep', inDays(-60)), now), inDays(-60));
  assert.equal(shared.heldOn(m('nov', inDays(9)), now), '');
  const early = m('early', inDays(4), { live: { startedAt: new Date(now - 3600e3).toISOString(), endedAt: new Date(now - 60e3).toISOString() } });
  assert.equal(shared.heldOn(early, now), todayEastern(now - 60e3));
});

// ─── A-m5: a refusal that isn't the site's own answer ───────────────

test('a 429 or a block page says the site refused it, with no “Reload the page”; too big says so; the site’s own words are untouched', async () => {
  const answer = (status, body, type) => { globalThis.fetch = async () => new Response(body, { status, headers: { 'Content-Type': type } }); };
  answer(429, '<html>Too many requests</html>', 'text/html');
  const j = await ui.call({ action: 'save-meeting' });
  assert.equal(j.ok, false);
  assert.equal(j.status, 429);
  assert.doesNotMatch(j.error, /reload/i, j.error);
  assert.equal(j.page, true);
  assert.equal(j.what, 'The site refused that');
  answer(403, '<html>Blocked</html>', 'text/html');
  assert.doesNotMatch((await ui.call({ action: 'save-meeting' })).error, /reload/i);
  answer(413, '<html>Too large</html>', 'text/html');
  assert.equal((await ui.call({ action: 'save-meeting' })).error, 'That’s too big to send.');
  answer(409, JSON.stringify({ ok: false, error: 'The agenda goes to the board once it’s approved' }), 'application/json');
  const own = await ui.call({ action: 'save-meeting' });
  assert.equal(own.error, 'The agenda goes to the board once it’s approved');
  assert.equal(own.page, undefined);
});
