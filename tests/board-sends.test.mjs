/**
 * Emailing the board (the agenda's email, the minutes notice, the reminder to answer the invite) while people work:
 * what a send keeps on the meeting is its own fields, put on the meeting as it is then, so a report or an edit saved
 * while Resend was answering stays (and so does locking the numbers, which waits on the banks); and each email goes
 * once, whatever presses it (a double press, a second tab, a retry after Resend's answer was lost).
 * QA, Nov 19 2026 (race-packet-report.mjs, race-send-save.mjs, double.mjs, retry.mjs). Made-up people only.
 * Run: node --test tests/
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import { getMeeting, patchMeeting, provideBoardFinance } from '../functions/api/_board.js';
import { mergeMeeting, cleanMeeting, todayEastern } from '../public/admin/board-shared.js';
import { agendaApproved } from './lib/agenda-approved.mjs';

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
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
];
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

let env;
const realFetch = globalThis.fetch;
/**
 * Resend, as it behaves: an Idempotency-Key it has seen answers with the first answer and sends nothing (the same key with
 * other words: 409). `called` opens when a send reaches it; `hold`, when set, keeps the next answer until the test opens it;
 * `lose`: that many answers that never come back (it sent them all the same)
 */
let resend;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  for (const [slug, email] of [['alex-rivera', ALEX], ['sam-ortiz', SAM]]) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  _resetKeyCacheForTests();
  resend = { delivered: [], calls: [], keys: new Map(), called: gate(), hold: null, lose: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const key = init.headers?.['Idempotency-Key'] || '';
      resend.calls.push({ url, key });
      resend.called.open();
      // (the hold keeps the first call waiting; any other goes straight through, as a second request would)
      const hold = resend.hold;
      resend.hold = null;
      if (hold) await hold.p;
      if (key && resend.keys.has(key)) {
        const had = resend.keys.get(key);
        return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request', message: 'Same key, other words' }, { status: 409 });
      }
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      resend.delivered.push(...list.map((m) => ({ to: m.to[0], subject: m.subject })));
      const res = Array.isArray(body) ? { data: list.map((_, i) => ({ id: `em_${resend.delivered.length}_${i}` })) } : { id: `em_${resend.delivered.length}` };
      if (key) resend.keys.set(key, { body: init.body, res });
      if (resend.lose > 0) { resend.lose -= 1; throw new TypeError('Network connection lost'); }
      return Response.json(res);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; provideBoardFinance(null); });

async function call(email, path, { method = 'GET', body = null, handler }) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' };
  if (body) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => handler(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : await res.text() };
}
const adminApi = (body) => call(FOUNDER, '/api/board-admin', body ? { method: 'POST', body, handler: admin.onRequestPost } : { handler: admin.onRequestGet });
const portalApi = (email, body) => call(email, '/api/board-portal', { method: 'POST', body, handler: portal.onRequestPost });
const perPerson = () => resend.delivered.reduce((n, m) => ({ ...n, [m.to]: (n[m.to] || 0) + 1 }), {});
const samsItem = (m) => m.sections.flatMap((s) => s.items).find((it) => it.id === 'i_samfin1');

/** A meeting ahead, its agenda approved and shared, with Sam presenting Financial (`shared: false`: approved, not shared yet) */
async function meetingAhead({ shared = true, days = 5 } = {}) {
  const m = (await adminApi({ action: 'new-meeting', date: inDays(days) })).body.meeting;
  m.sections[0].items.push({ id: 'i_samfin1', title: 'Financial', who: ['sam-ortiz'], presenter: 'Sam Ortiz' });
  await agendaApproved(env.DB, m.id);
  // (the board has had the sign-in email, so the approval sends the agenda at once)
  await env.DB.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(JSON.stringify({ sentAt: '2026-11-01T00:00:00Z' }), '2026-11-01T00:00:00Z').run();
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, shared }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}

/**
 * While a send waits on Resend: Sam saves his report on the board page and Jane saves an edit in Board. Then Resend
 * answers. → { sent, report, save } (each response)
 */
async function workWhileSending(id, send) {
  const held = gate();
  resend.hold = held;
  const sending = send();
  await resend.called.p;
  const cur = await getMeeting(env.DB, id);
  const report = await portalApi(SAM, { action: 'report', meetingId: id, itemId: 'i_samfin1', text: 'Cash is steady.', base: samsItem(cur).reportAt || '' });
  const now = await getMeeting(env.DB, id);
  const save = await adminApi({ action: 'save-meeting', meeting: { ...now, location: 'Room 2' }, base: now.updatedAt });
  held.open();
  return { sent: await sending, report, save };
}

// ─── What a send writes ─────────────────────────────────────────────

test('a report and an edit saved while the agenda’s email goes out are kept, and the editor’s next save keeps both', async () => {
  const m = await meetingAhead();
  const { sent, report, save } = await workWhileSending(m.id, () => adminApi({ action: 'send-packet', id: m.id }));
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const after = await getMeeting(env.DB, m.id);
  assert.equal(samsItem(after).report, 'Cash is steady.', 'Sam’s report stays');
  assert.equal(after.location, 'Room 2', 'Jane’s edit stays');
  assert.ok(after.packetSentAt);
  assert.equal(after.packetSentTo, 2);
  assert.ok(after.updatedAt > save.body.meeting.updatedAt, 'the send is a change after Jane’s, never her save’s time put back');
  // Jane's editor (its last save is what it has) saves again: told someone saved since, it merges, and keeps everything
  const mine = { ...save.body.meeting, address: '1 Main Street' };
  const refused = await adminApi({ action: 'save-meeting', meeting: mine, base: save.body.meeting.updatedAt });
  assert.equal(refused.status, 409);
  const { merged, clashes } = mergeMeeting(cleanMeeting(save.body.meeting), cleanMeeting(mine), cleanMeeting(refused.body.current));
  assert.deepEqual(clashes, []);
  const again = await adminApi({ action: 'save-meeting', meeting: merged, base: refused.body.current.updatedAt });
  assert.equal(again.status, 200);
  const last = await getMeeting(env.DB, m.id);
  assert.deepEqual([last.location, last.address, samsItem(last).report, !!last.packetSentAt], ['Room 2', '1 Main Street', 'Cash is steady.', true]);
});

test('the approval’s own send of the agenda keeps what was saved while it went', async () => {
  const m = await meetingAhead({ shared: false });
  // (approved again in Board: the review's record is taken back first, so the approval is this one)
  await env.DB.prepare("DELETE FROM board_asks WHERE kind = 'chair'").run();
  const { sent, report, save } = await workWhileSending(m.id, () => adminApi({ action: 'approve-agenda', id: m.id }));
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.agenda, 'sent');
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([samsItem(after).report, after.location, after.shared, !!after.packetSentAt], ['Cash is steady.', 'Room 2', true, true]);
});

test('the minutes notice keeps an edit saved while it went', async () => {
  const m = await meetingAhead();
  // (held, with its minutes in: QA round 2, the board is never told minutes are up before there are any)
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, date: inDays(-3), minutesFrom: { name: 'Minutes.pdf', at: new Date().toISOString() } }));
  const { sent, save } = await workWhileSending(m.id, () => adminApi({ action: 'send-minutes', id: m.id }));
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(save.status, 200);
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.location, samsItem(after).report, !!after.minutesSentAt], ['Room 2', 'Cash is steady.', true]);
});

test('locking the numbers keeps a report saved while the banks were answering', async () => {
  const m = await meetingAhead();
  const asked = gate();
  const answer = gate();
  provideBoardFinance(async () => { asked.open(); await answer.p; return { months: [] }; });
  const locking = adminApi({ action: 'snapshot', id: m.id });
  await asked.p;
  const report = await portalApi(SAM, { action: 'report', meetingId: m.id, itemId: 'i_samfin1', text: 'Cash is steady.', base: '' });
  assert.equal(report.status, 200);
  answer.open();
  assert.equal((await locking).status, 200);
  const after = await getMeeting(env.DB, m.id);
  assert.ok(after.snapshot?.at, 'the numbers are locked');
  assert.equal(samsItem(after).report, 'Cash is steady.', 'and Sam’s report stays');
});

// ─── Once ───────────────────────────────────────────────────────────

test('a double press and a second tab send the agenda’s email once', async () => {
  const m = await meetingAhead();
  const held = gate();
  resend.hold = held;
  const first = adminApi({ action: 'send-packet', id: m.id });
  await resend.called.p;
  // A second press while it's going out
  const second = await adminApi({ action: 'send-packet', id: m.id });
  held.open();
  assert.equal(second.status, 409);
  // (the same founder pressing it again, from this tab or another, is "you", never their own name: QA round 6 m8, Nov 21 2026)
  assert.match(second.body.error, /^You’re sending this email to the board right now, maybe in another tab\. It goes once, so there’s nothing to press\.$/);
  assert.equal((await first).status, 200);
  // A second tab that still offers Email the board, a minute later: told it went, with the meeting as it is now
  const tab = await adminApi({ action: 'send-packet', id: m.id });
  assert.equal(tab.status, 409);
  assert.match(tab.body.error, /^You sent this email to the board a moment ago, maybe in another tab, so it didn’t go again\. It can go again 10 minutes after the last one\.$/);
  assert.ok(tab.body.meeting.packetSentAt);
  assert.deepEqual(perPerson(), { [ALEX]: 1, [SAM]: 1 });
});

test('a retry after Resend’s answer was lost sends nothing twice: Resend is asked with the same key', async () => {
  const m = await meetingAhead();
  resend.lose = 1;
  const lost = await adminApi({ action: 'send-packet', id: m.id });
  assert.equal(lost.body.ok, false);
  assert.deepEqual(perPerson(), { [ALEX]: 1, [SAM]: 1 }, 'Resend sent them');
  assert.equal((await getMeeting(env.DB, m.id)).packetSentAt, '', 'not said to have gone before Resend says so');
  // Pressed again, as the message says: the same call, so Resend sends nothing more, and the page hears it went
  const again = await adminApi({ action: 'send-packet', id: m.id });
  assert.deepEqual(perPerson(), { [ALEX]: 1, [SAM]: 1 }, 'nobody got it twice');
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.ok, true);
  assert.ok(again.body.meeting.packetSentAt);
  assert.equal(lost.body.error, 'Resend didn’t answer, so these emails may have gone. Press it again: Resend sends each one only if it hasn’t already.');
  assert.equal(resend.calls.length, 2);
  assert.ok(resend.calls[0].key && resend.calls[0].key === resend.calls[1].key, 'one key, both times');
  // A send that never reached Resend goes on the retry
  const other = await meetingAhead({ days: 6 });
  resend.delivered = [];
  const down = globalThis.fetch;
  globalThis.fetch = async (input, init) => (String(input).startsWith('https://api.resend.com/') ? Promise.reject(new TypeError('Network connection lost')) : down(input, init));
  assert.match((await adminApi({ action: 'send-packet', id: other.id })).body.error, /^Resend didn’t answer/);
  globalThis.fetch = down;
  assert.equal((await adminApi({ action: 'send-packet', id: other.id })).status, 200);
  assert.deepEqual(perPerson(), { [ALEX]: 1, [SAM]: 1 });
});

test('the minutes notice and the reminder to answer the invite go once too', async () => {
  const past = await meetingAhead();
  // (held, with its minutes in: QA round 2, the board is never told minutes are up before there are any)
  await patchMeeting(env.DB, past.id, (cur) => ({ ...cur, date: inDays(-3), minutesFrom: { name: 'Minutes.pdf', at: new Date().toISOString() } }));
  const held = gate();
  resend.hold = held;
  const first = adminApi({ action: 'send-minutes', id: past.id });
  await resend.called.p;
  const second = await adminApi({ action: 'send-minutes', id: past.id });
  held.open();
  assert.equal(second.status, 409);
  assert.equal((await first).status, 200);
  assert.equal((await adminApi({ action: 'send-minutes', id: past.id })).status, 409, 'a second tab');
  assert.deepEqual(perPerson(), { [ALEX]: 1, [SAM]: 1 });

  const ahead = await meetingAhead({ days: 7 });
  await patchMeeting(env.DB, ahead.id, (cur) => ({ ...cur, invite: { eventId: 'ev_once0001', organizer: FOUNDER, sentAt: new Date().toISOString(), replies: { 'alex-rivera': 'invited', 'sam-ortiz': 'invited' } } }));
  resend.delivered = [];
  resend.called = gate();
  const asked = gate();
  resend.hold = asked;
  const asking = adminApi({ action: 'remind-rsvp', id: ahead.id });
  await resend.called.p;
  const twice = await adminApi({ action: 'remind-rsvp', id: ahead.id });
  asked.open();
  assert.equal(twice.status, 409);
  assert.match(twice.body.error, /^You’re sending this email to everyone who hasn’t answered right now, maybe in another tab\./);
  assert.equal((await asking).body.sent, 2);
  assert.equal((await adminApi({ action: 'remind-rsvp', id: ahead.id })).status, 409, 'a second tab');
  assert.deepEqual(perPerson(), { [ALEX]: 1, [SAM]: 1 });
});
