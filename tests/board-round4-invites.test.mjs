/**
 * Board, QA round 4 (Nov 21 2026): a board meeting's calendar invite.
 *   - Held is one rule for the meeting page and the site (board-shared.js meetingHeld): its day gone by, the chair ended
 *     it, or on its day its minutes are in or its end time has passed
 *   - an invite is a record (left exactly as it is) only when both the meeting and the invite's own slot are held; while
 *     either is ahead it's live: changes reach it, it follows People → Board, and deleting the meeting cancels it
 *   - a meeting moved to a day gone by takes its invite there, with one email from Google; then it's a record
 *   - one send of a meeting's invite at a time: two presses at once, or a press while the heartbeat sends the same
 *     change, email the guests once
 * The clock is held at 3 pm in Atlanta on a Wednesday (some tests move it on), so "its end time has passed" doesn't hang
 * on when the suite runs. Made-up people only. Google and Resend are faked.
 * Run: node --test tests/board-round4-invites.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { holdClockAt } from './lib/clock.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { getMeeting, patchMeeting, ensureSchema } from '../functions/api/_board.js';
import { readState, writeState } from '../functions/api/_board-roles.js';
import { maybeRefreshInvites, maybeFollowBoard, cancelInvite, pendingInvites } from '../functions/api/_board-invite.js';
import { syncBoardCalendar } from '../functions/api/_board-calendar.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
// (as a whole, so this file loads on code from before this round, where the rule wasn't one function yet)
import * as shared from '../public/admin/board-shared.js';

const { todayEastern } = shared;
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
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const GOOGLE_KEY = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', private_key: PEM, token_uri: 'https://oauth2.googleapis.com/token' });

const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
];
// Wednesday Dec 2 2026 in Atlanta (EST, UTC-5): noon, 3 pm, half past 4
const NOON = '2026-12-02T17:00:00Z';
const THREE = '2026-12-02T20:00:00Z';
const HALF_FOUR = '2026-12-02T21:30:00Z';
const MIN = 60_000;
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let env;
let raw;
let restore = () => {};
/** The clock held at this instant from here on */
const clockAt = (iso) => { restore(); restore = holdClockAt(iso); };
/** Google Calendar, faked: events by id, every call, and `delay` ms before each answer (so two sends overlap) */
let google;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  clockAt(THREE);
  raw = await createD1();
  env = { DB: raw, CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', GOOGLE_CALENDAR_KEY: GOOGLE_KEY };
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  ]) await raw.exec(sql);
  for (const [slug, d] of PEOPLE) await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ ...d, slug })).run();
  for (const [slug, email] of [['alex-rivera', ALEX], ['sam-ortiz', SAM]]) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  clearTokenCache();
  google = { events: {}, calls: [], delay: 0, refuse: false };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const body = JSON.parse(init.body);
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      const u = new URL(url);
      google.calls.push({ method, url, sendUpdates: u.searchParams.get('sendUpdates'), body });
      if (google.delay) await sleep(google.delay);
      if (google.refuse) return Response.json({ error: { message: 'Backend Error' } }, { status: 503 });
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
      if (method === 'DELETE') {
        if (e.status === 'cancelled') return Response.json({ error: { message: 'Resource has been deleted' } }, { status: 410 });
        e.status = 'cancelled';
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') Object.assign(e, body);
      return Response.json(e);
    }
    if (url.startsWith('https://gmail.googleapis.com/')) return Response.json({ error: { message: 'not here' } }, { status: 403 });
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; restore(); restore = () => {}; });

async function adminApi(body) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(FOUNDER), Origin: 'https://sunshineonaranneyday.com', 'Content-Type': 'application/json' };
  const request = new Request('https://sunshineonaranneyday.com/api/board-admin', { method: 'POST', headers, body: JSON.stringify(body) });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => admin.onRequestPost(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: await res.json() };
}
/** A meeting saved from Board (as its editor saves it), `days` from today */
async function meeting(days, fields = {}) {
  const m = (await adminApi({ action: 'new-meeting', date: inDays(days) })).body.meeting;
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, ...fields }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
/** A save of the meeting as Board has it now, with these changes */
async function change(id, fields) {
  const cur = await getMeeting(env.DB, id);
  const r = await adminApi({ action: 'save-meeting', meeting: { ...cur, ...fields }, base: cur.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
const sendIt = (id) => adminApi({ action: 'send-invite', id });
const writes = () => google.calls.filter((c) => c.method !== 'GET');
/** What reached Google from here on: [method, sendUpdates] */
const mark = () => { const n = writes().length; return () => writes().slice(n).map((c) => [c.method, c.sendUpdates]); };
/** Every change noted for the heartbeat, as if it had stood its two minutes */
async function settled() {
  const p = await pendingInvites(env.DB);
  for (const [id, x] of Object.entries(p)) await writeState(env.DB, `invite-pending:${id}`, { ...x, at: '2000-01-01T00:00:00.000Z' });
}
/** Another send of this meeting's invite under way right now (a tab, or Board by itself), as the site marks it */
const claimed = (id, by = 'Board', at = Date.now()) => raw.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`board-invite-sending:${id}`, JSON.stringify({ by, n: 'other' }), new Date(at).toISOString()).run();
const HELD_WORDS = 'This meeting has already been held, so no calendar invite goes out for it.';
const RECORD_WORDS = `${HELD_WORDS} The one it had stays as it was.`;

// ─── Rule 1: held is one rule ───────────────────────────────────────

test('rule 1: held is one rule (board-shared.js meetingHeld), the meeting page’s: its day gone by, ended by the chair, or on its day its minutes in or its end time passed', () => {
  const now = Date.parse(THREE);
  const today = '2026-12-02';
  assert.equal(typeof shared.meetingHeld, 'function', 'one function, in the module the editor and the server both import');
  const held = (m) => shared.meetingHeld(m, now);
  assert.equal(held({ date: '2026-12-03', start: '08:00', end: '10:00' }), false, 'tomorrow');
  assert.equal(held({ date: today, start: '14:00', end: '16:00' }), false, 'today, under way');
  assert.equal(held({ date: today, start: '08:00', end: '' }), false, 'today with no end time: held once the day is over');
  assert.equal(held({ date: today, start: '13:00', end: '14:59' }), true, 'today, its end time passed');
  assert.equal(held({ date: today, start: '13:00', end: '15:00' }), true, 'today, ending this minute');
  assert.equal(held({ date: today, start: '14:00', end: '16:00', minutesFrom: { name: 'Minutes.docx' } }), true, 'today, its minutes in');
  assert.equal(held({ date: '2026-12-01', start: '18:00', end: '20:00' }), true, 'yesterday');
  assert.equal(held({ date: '2026-12-20', live: { startedAt: '2026-12-02T15:00:00Z', endedAt: '2026-12-02T16:00:00Z' } }), true, 'moved up and ended early by the chair');
  // The meeting page and Board's home read "over on its day" from the same module
  assert.equal(typeof shared.meetingOver, 'function');
  assert.equal(shared.meetingOver({ end: '14:59' }, now), true);
  assert.equal(shared.meetingOver({ end: '15:01' }, now), false);
});

// ─── A-m2 and rule 5: no new invite for a meeting held on its day ───

test('A-m2, rule 5: Send the invite for a meeting today whose end time has passed, or whose minutes are in, is refused in words, and Google is never asked', async () => {
  // (one meeting a day: each is deleted before the next is made)
  const gone = async (id) => assert.equal((await adminApi({ action: 'delete-meeting', id })).status, 200);
  const ended = await meeting(0, { start: '13:00', end: '14:00', location: 'Example Hall' });
  const r1 = await sendIt(ended.id);
  assert.deepEqual([r1.status, r1.body.error], [409, HELD_WORDS], JSON.stringify(r1.body));
  await gone(ended.id);
  const minuted = await meeting(0, { start: '14:00', end: '17:00' });
  await patchMeeting(env.DB, minuted.id, (cur) => ({ ...cur, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() } }));
  const r2 = await sendIt(minuted.id);
  assert.deepEqual([r2.status, r2.body.error], [409, HELD_WORDS]);
  await gone(minuted.id);
  const yesterday = await meeting(-1);
  assert.equal((await sendIt(yesterday.id)).status, 409, 'a day gone by, as before');
  assert.deepEqual(writes(), [], 'Google emailed nobody');
  // Today, not over yet: it goes
  const later = await meeting(0, { start: '16:00', end: '17:00' });
  const r3 = await sendIt(later.id);
  assert.equal(r3.status, 200, JSON.stringify(r3.body));
  assert.deepEqual(writes().map((c) => [c.method, c.sendUpdates]), [['POST', 'all']]);
});

// ─── A-m2 and rule 4: held on its day, its invite at that slot, is a record ───

test('A-m2, rule 4: held on its day with its invite at that same slot, correcting its time or place sends nothing to Google, and Send the invite is refused in words', async () => {
  const m = await meeting(0, { start: '13:00', end: '16:00', location: 'Example Hall' });
  assert.equal((await sendIt(m.id)).status, 200, 'its invite went while it was under way');
  // Half past four: its end time has gone by, so it's held (the page says Held)
  clockAt(HALF_FOUR);
  const since = mark();
  await change(m.id, { end: '15:40', address: '200 Other Street, Atlanta, GA 30301' });
  assert.equal((await pendingInvites(env.DB))[m.id], undefined, 'nothing waits to go onto the invite');
  await maybeRefreshInvites(env, { now: Date.now() + 3 * MIN });
  assert.deepEqual(since(), [], 'no update for the board from Google');
  const r = await sendIt(m.id);
  assert.deepEqual([r.status, r.body.error], [409, RECORD_WORDS]);
  assert.deepEqual(since(), [], 'and none from the press');
  assert.equal((await getMeeting(env.DB, m.id)).invite.when, `${inDays(0)} 13:00-16:00`, 'the invite is as it went');
});

test('A-m2: the hourly look puts nothing back on an invite that’s a record, even one moved by hand in Google Calendar', async () => {
  const m = await meeting(0, { start: '13:00', end: '16:00', location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  clockAt(HALF_FOUR);
  Object.assign(google.events[sent.invite.eventId], { start: { dateTime: `${inDays(0)}T17:00:00`, timeZone: 'America/New_York' }, end: { dateTime: `${inDays(0)}T18:00:00`, timeZone: 'America/New_York' } });
  const since = mark();
  await syncBoardCalendar(env, { now: Date.now() });
  assert.deepEqual(since(), [], 'Google was never asked to put Board’s back, so nobody was emailed');
});

test('A-m2: Board’s new words go quietly onto every live invite, and never onto a record', async () => {
  const ahead = await meeting(40);
  await sendIt(ahead.id);
  const today = await meeting(0, { start: '13:00', end: '16:00' });
  await sendIt(today.id);
  clockAt(HALF_FOUR);
  // Both invites carry words from before Board's were changed
  for (const id of [ahead.id, today.id]) await patchMeeting(env.DB, id, (cur) => ({ ...cur, invite: { ...cur.invite, notes: 'old' } }));
  await raw.prepare("DELETE FROM board_state WHERE key = 'invite-notes'").run();
  const since = mark();
  const before = writes().length;
  await maybeRefreshInvites(env, { now: Date.now() });
  assert.deepEqual(since(), [['PATCH', 'none']], 'one invite, without emailing anyone');
  assert.ok(writes()[before].url.includes(encodeURIComponent((await getMeeting(env.DB, ahead.id)).invite.eventId)), 'the one ahead');
});

// ─── P-M1 and rules 2, 3: a meeting moved to a day gone by ──────────

test('P-M1: a meeting whose invite is out, moved to yesterday and then deleted, has its invite cancelled, and Google tells the guests', async () => {
  const m = await meeting(30, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  await change(m.id, { date: inDays(-1) });
  // The heartbeat, before the change has stood its two minutes
  await maybeRefreshInvites(env, { now: Date.now() });
  const since = mark();
  const del = await adminApi({ action: 'delete-meeting', id: m.id });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.cancelled, true, 'its invite was cancelled');
  assert.deepEqual(since(), [['DELETE', 'all']], 'and Google told everyone on it');
  assert.equal(google.events[sent.invite.eventId].status, 'cancelled', 'nothing left on the board’s calendars');
});

test('P-M1, rule 3: a kept meeting moved to yesterday takes its invite to that day with one email from Google; after that it’s a record', async () => {
  const m = await meeting(35, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  const ev = sent.invite.eventId;
  await change(m.id, { date: inDays(-1), location: 'A new hall', address: '2 New Road' });
  const since = mark();
  await maybeRefreshInvites(env, { now: Date.now() + 3 * MIN });
  assert.deepEqual(since(), [['PATCH', 'all']], 'the guests are emailed once: their calendar had the wrong day');
  assert.ok(String(google.events[ev].start.dateTime).startsWith(inDays(-1)), `the invite is on its day now (${google.events[ev].start.dateTime})`);
  assert.equal(google.events[ev].location, 'A new hall, 2 New Road');
  assert.ok((await getMeeting(env.DB, m.id)).invite.when.startsWith(inDays(-1)));
  // Held, with its invite held: a record from here on
  const after = mark();
  await change(m.id, { location: 'Another hall' });
  await maybeRefreshInvites(env, { now: Date.now() + 6 * MIN });
  const r = await sendIt(m.id);
  assert.deepEqual([r.status, r.body.error], [409, RECORD_WORDS]);
  const del = await adminApi({ action: 'delete-meeting', id: m.id });
  assert.equal(del.body.cancelled, false, 'deleting it leaves the record');
  assert.deepEqual(after(), [], 'nothing more went to Google');
  assert.equal(google.events[ev].status, 'confirmed');
});

test('P-M1, rule 2: a meeting moved to a day gone by was held with the board of that day: a member who leaves after keeps their place on it, even before the move reaches the invite', async () => {
  const m = await meeting(35, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  assert.ok(sent.invite.emails.includes(SAM));
  await change(m.id, { date: inDays(-1) });
  // Sam leaves the board before the move has gone onto the invite
  await raw.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind('alumni', JSON.stringify({ name: 'Sam Ortiz', group: 'alumni', title: 'Board Treasurer', slug: 'sam-ortiz' }), 'sam-ortiz').run();
  const since = mark();
  await maybeFollowBoard(env, { now: Date.now() });
  assert.deepEqual(since(), [], 'nothing changes on it: its roll is the record');
  assert.ok(google.events[sent.invite.eventId].attendees.some((a) => a.email === SAM), 'Sam is still on it');
});

test('P-M1, rule 2: a meeting still ahead, its new day not on its invite yet: a member who leaves comes off it', async () => {
  const m = await meeting(35, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  await change(m.id, { date: inDays(20) });
  await raw.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind('alumni', JSON.stringify({ name: 'Sam Ortiz', group: 'alumni', title: 'Board Treasurer', slug: 'sam-ortiz' }), 'sam-ortiz').run();
  const since = mark();
  await maybeFollowBoard(env, { now: Date.now() });
  assert.deepEqual(since(), [['PATCH', 'all']], 'only who went off hears about it');
  const ev = google.events[sent.invite.eventId];
  assert.ok(!ev.attendees.some((a) => a.email === SAM), 'Sam is off the invite');
  assert.ok(ev.attendees.some((a) => a.email === ALEX), 'Alex is still on it');
});

// ─── P-m2 and rule 6: one send at a time ────────────────────────────

test('P-m2: two Send the invite presses at once on a changed invite: Google emails the guests once, and the other press is told in plain words', async () => {
  const m = await meeting(150, { location: 'Example Hall' });
  assert.equal((await sendIt(m.id)).status, 200);
  await change(m.id, { location: 'Moved hall', address: '1 Elm St' });
  google.delay = 30;
  const since = mark();
  const [a, b] = await Promise.all([sendIt(m.id), sendIt(m.id)]);
  assert.deepEqual(since().filter(([, s]) => s === 'all'), [['PATCH', 'all']], 'one update email from Google');
  const [won, lost] = a.status === 200 ? [a, b] : [b, a];
  assert.equal(won.status, 200, JSON.stringify(won.body));
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.equal(lost.body.error, 'This meeting’s invite is going out from another tab right now. Look again in a moment.');
  assert.equal(lost.body.sending, true);
  assert.ok(lost.body.meeting?.id === m.id, 'with the meeting as the site has it');
  // One after the other is right: the next press reads the meeting after the send, and says it's out
  google.delay = 0;
  const again = await sendIt(m.id);
  assert.equal(again.status, 409);
  assert.equal(again.body.already, true);
  assert.deepEqual(since().filter(([, s]) => s === 'all'), [['PATCH', 'all']]);
});

test('P-m2: a double first press makes one event', async () => {
  const m = await meeting(151, { location: 'Example Hall' });
  google.delay = 30;
  const [a, b] = await Promise.all([sendIt(m.id), sendIt(m.id)]);
  assert.deepEqual(writes().map((c) => [c.method, c.sendUpdates]), [['POST', 'all']], 'one event, one invite email');
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('P-m2: a press while the heartbeat sends the same settled change: one email from Google, and the heartbeat leaves a claimed invite for its next beat', async () => {
  const m = await meeting(170, { location: 'Example Hall' });
  await sendIt(m.id);
  await change(m.id, { location: 'Moved hall', address: '1 Oak St' });
  await settled();
  google.delay = 30;
  const since = mark();
  const [press] = await Promise.all([sendIt(m.id), maybeRefreshInvites(env, { now: Date.now() })]);
  google.delay = 0;
  await maybeRefreshInvites(env, { now: Date.now() + 3 * MIN });
  assert.deepEqual(since().filter(([, s]) => s === 'all'), [['PATCH', 'all']], 'one update email from Google');
  if (press.status !== 200) assert.equal(press.body.error, 'This meeting’s invite is going out from Board by itself right now. Look again in a moment.');
  assert.deepEqual(await pendingInvites(env.DB), {}, 'nothing left waiting');

  // An invite being sent right now (another tab): the heartbeat skips it, and sends it on the next beat once it's free
  const n = await meeting(171, { location: 'Example Hall' });
  await sendIt(n.id);
  await change(n.id, { location: 'Second hall' });
  await settled();
  await claimed(n.id, FOUNDER);
  const next = mark();
  await maybeRefreshInvites(env, { now: Date.now() });
  assert.deepEqual(next(), [], 'skipped while another send has it');
  assert.ok((await pendingInvites(env.DB))[n.id], 'and kept for the next beat');
  await raw.prepare('DELETE FROM board_state WHERE key = ?').bind(`board-invite-sending:${n.id}`).run();
  await maybeRefreshInvites(env, { now: Date.now() });
  assert.deepEqual(next(), [['PATCH', 'all']], 'then it goes, once');
});

test('rule 6: a press while another send has the invite is refused before anything is read; the claim is always let go, and a stale one expires', async () => {
  const m = await meeting(60, { location: 'Example Hall' });
  // Board sending it by itself (the heartbeat): the press is told so, and Google isn't asked anything
  await claimed(m.id, 'Board');
  const r = await sendIt(m.id);
  assert.deepEqual([r.status, r.body.error, r.body.sending], [409, 'This meeting’s invite is going out from Board by itself right now. Look again in a moment.', true]);
  assert.deepEqual(google.calls, []);
  // One that never finished (its Worker stopped) lets the next go after two minutes
  await claimed(m.id, FOUNDER, Date.now() - 3 * MIN);
  assert.equal((await sendIt(m.id)).status, 200, 'a stale claim expires');
  assert.equal(await raw.prepare('SELECT key FROM board_state WHERE key = ?').bind(`board-invite-sending:${m.id}`).first(), null, 'and the send let go of its own');
  // Google refusing: the claim still comes off, so the next press goes
  await change(m.id, { location: 'Moved hall' });
  google.refuse = true;
  assert.notEqual((await sendIt(m.id)).status, 200);
  google.refuse = false;
  const again = await sendIt(m.id);
  assert.equal(again.status, 200, JSON.stringify(again.body));
});

// ─── The Advisory Board's meetings keep their invite the same way ───

test('Advisory Board meetings: deleting one moved to a day gone by cancels its invite still ahead; one held with its invite held keeps it as a record', async () => {
  const organizer = FOUNDER;
  const advisory = (date, when) => ({ ...shared.newMeeting({ date }), id: 'am_test1', start: '18:30', end: '20:00', invite: { eventId: 'advisorboardtest1', organizer, when } });
  google.events.advisorboardtest1 = { id: 'advisorboardtest1', status: 'confirmed' };
  assert.equal(await cancelInvite(env, advisory(inDays(-1), `${inDays(30)} 18:30-20:00`), { now: Date.now() }), true, 'still ahead at Google: cancelled');
  assert.deepEqual(writes().map((c) => [c.method, c.sendUpdates]), [['DELETE', 'all']]);
  google.events.advisorboardtest1 = { id: 'advisorboardtest1', status: 'confirmed' };
  const since = mark();
  assert.equal(await cancelInvite(env, advisory(inDays(-1), `${inDays(-1)} 18:30-20:00`), { now: Date.now() }), false, 'held, at its own day: a record');
  assert.equal(await cancelInvite(env, advisory(inDays(14), `${inDays(14)} 18:30-20:00`), { now: Date.now() }), true, 'ahead: cancelled, as before');
  assert.deepEqual(since(), [['DELETE', 'all']]);
});

// ─── After the fixers (Nov 21 2026): nothing waiting is ever dropped, and moves from before the fix still go ───

test('a change Google turns away stays to go again, later each time, goes once Google takes it, and the staff hear after a day of it', async () => {
  const m = await meeting(40, { location: 'Example Hall' });
  assert.equal((await sendIt(m.id)).status, 200);
  await change(m.id, { location: 'Moved hall', address: '1 Elm St' });
  await settled();
  const t0 = Date.now();
  google.refuse = true;
  await maybeRefreshInvites(env, { now: t0 });
  let p = (await pendingInvites(env.DB))[m.id];
  assert.ok(p, 'still waiting after Google turned it away');
  assert.equal(p.tries, 1);
  assert.equal(Date.parse(p.retryAt) - t0, 5 * MIN, 'tried again in five minutes');
  // Before then: nothing goes
  google.refuse = false;
  let since = mark();
  await maybeRefreshInvites(env, { now: t0 + 4 * MIN });
  assert.deepEqual(since(), [], 'not before its time');
  // Turned away again, then for a day: the staff are told, once
  google.refuse = true;
  await maybeRefreshInvites(env, { now: t0 + 6 * MIN });
  p = (await pendingInvites(env.DB))[m.id];
  assert.equal(p.tries, 2);
  assert.equal(Date.parse(p.retryAt) - (t0 + 6 * MIN), 30 * MIN, 'then in half an hour');
  assert.equal((await readState(env.DB, `invite-told:${m.id}`)).at, undefined, 'not told yet');
  await maybeRefreshInvites(env, { now: t0 + 25 * 60 * MIN });
  p = (await pendingInvites(env.DB))[m.id];
  assert.ok((await readState(env.DB, `invite-told:${m.id}`)).at, 'a day of it: the staff hear');
  // Google takes it: it goes, once, and nothing is left waiting
  google.refuse = false;
  since = mark();
  await maybeRefreshInvites(env, { now: Date.parse(p.retryAt) + MIN });
  assert.deepEqual(since(), [['PATCH', 'all']]);
  assert.equal(google.events[(await getMeeting(env.DB, m.id)).invite.eventId].location.startsWith('Moved hall'), true);
  assert.equal((await pendingInvites(env.DB))[m.id], undefined);
});

test('a meeting moved to a day gone by before this fix, its invite still ahead and nothing waiting: the next beat takes the invite to that day, with one email', async () => {
  const m = await meeting(30, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  // (as the site had it: the date changed, nothing noted for the heartbeat)
  const { patchMeeting } = await import('../functions/api/_board.js');
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, date: inDays(-2) }), { by: 'x' });
  assert.deepEqual(await pendingInvites(env.DB), {});
  const since = mark();
  await maybeRefreshInvites(env, { now: Date.now() });
  assert.deepEqual(since(), [['PATCH', 'all']], 'one update, so the guests’ calendars have the day it was held');
  assert.equal(google.events[sent.invite.eventId].start.dateTime?.slice(0, 10) || google.events[sent.invite.eventId].start.date, inDays(-2));
  const again = mark();
  await maybeRefreshInvites(env, { now: Date.now() + 11 * MIN });
  assert.deepEqual(again(), [], 'and then it’s a record');
});

// ─── Board QA round 5 (Nov 21 2026) ─────────────────────────────────

const leaves = (slug, name) => raw.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind('alumni', JSON.stringify({ name, group: 'alumni', slug }), slug).run();
const onIt = (id) => (google.events[id]?.attendees || []).map((a) => a.email);

test('round 5, M1: someone who left the board comes off the invite when it’s sent again before the follow runs, by a press', async () => {
  const m = await meeting(40, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  assert.ok(onIt(sent.invite.eventId).includes(SAM));
  await leaves('sam-ortiz', 'Sam Ortiz');
  await change(m.id, { location: 'A new hall', address: '2 New Road' });
  const r = await sendIt(m.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!onIt(sent.invite.eventId).includes(SAM), 'off Google’s guest list');
  const after = await getMeeting(env.DB, m.id);
  assert.ok(!after.invite.emails.includes(SAM) && !Object.values(after.invite.who).includes(SAM), 'and off Board’s record of it');
  assert.ok(onIt(sent.invite.eventId).includes(ALEX), 'Alex stays');
  // and the follow after it finds nothing to do
  const since = mark();
  await maybeFollowBoard(env, { now: Date.now() + 10 * MIN });
  assert.deepEqual(since(), []);
});

test('round 5, M1: the same when the heartbeat sends a settled change in the same beat, and a new address replaces the old one', async () => {
  const m = await meeting(40, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  await raw.prepare('UPDATE reveal_board_emails SET email = ? WHERE slug = ?').bind('sam.new@example.org', 'sam-ortiz').run();
  await change(m.id, { location: 'A new hall', address: '2 New Road' });
  await settled();
  await maybeRefreshInvites(env, { now: Date.now() });
  const on = onIt(sent.invite.eventId);
  assert.ok(!on.includes(SAM) && on.includes('sam.new@example.org'), `the old address off, the new one on (${on.join(', ')})`);
  assert.equal((await getMeeting(env.DB, m.id)).invite.who['sam-ortiz'], 'sam.new@example.org');
});

test('round 5, m3: a meeting moved to a day gone by keeps the board of its day: nobody who joined since is put on its invite', async () => {
  const m = await meeting(30, { location: 'Example Hall' });
  const sent = (await sendIt(m.id)).body.meeting;
  await change(m.id, { date: inDays(-2) });
  await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind('ada-example', 'Ada Example', 'board', JSON.stringify({ name: 'Ada Example', group: 'board', slug: 'ada-example' })).run();
  await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('ada-example', 'ada@example.com').run();
  await settled();
  const since = mark();
  await maybeRefreshInvites(env, { now: Date.now() });
  assert.deepEqual(since(), [['PATCH', 'all']], 'the move, once');
  assert.ok(!onIt(sent.invite.eventId).includes('ada@example.com'), 'Ada isn’t invited to a meeting held before she joined');
  assert.equal((await getMeeting(env.DB, m.id)).invite.who['ada-example'], undefined);
  assert.ok(onIt(sent.invite.eventId).includes(SAM), 'and whoever it had stays');
});

test('round 5, m1: two meetings’ changes noted at the same moment are both kept, and both reach their invites', async () => {
  const { noteInviteChange } = await import('../functions/api/_board-invite.js');
  const a = (await sendIt((await meeting(40, { location: 'Hall A' })).id)).body.meeting;
  const b = (await sendIt((await meeting(41, { location: 'Hall B' })).id)).body.meeting;
  // D1 as it is for real: every call a round trip, so two saves' reads and writes interleave
  const real = env.DB;
  const pause = () => new Promise((r) => setTimeout(r, 3));
  const slow = (st) => ({ bind: (...v) => slow(st.bind(...v)), first: async (...x) => { await pause(); return st.first(...x); }, run: async () => { await pause(); return st.run(); }, all: async () => { await pause(); return st.all(); } });
  const yielding = { prepare: (sql) => slow(real.prepare(sql)), batch: (...x) => real.batch(...x), exec: (...x) => real.exec(...x) };
  await Promise.all([
    noteInviteChange({ ...env, DB: yielding }, { ...a, location: 'Hall A2' }),
    noteInviteChange({ ...env, DB: yielding }, { ...b, location: 'Hall B2' }),
  ]);
  const p = await pendingInvites(env.DB);
  assert.ok(p[a.id] && p[b.id], `both noted (${Object.keys(p).join(', ')})`);
});

test('round 5, m2: the staff told a change couldn’t reach its invite hear it did, however it got there (a press), and once nothing is left to send', async () => {
  const m = await meeting(40, { location: 'Example Hall' });
  assert.equal((await sendIt(m.id)).status, 200);
  await writeState(env.DB, `invite-told:${m.id}`, { at: new Date().toISOString() });
  await change(m.id, { location: 'A new hall', address: '2 New Road' });
  assert.equal((await sendIt(m.id)).status, 200);
  assert.equal((await readState(env.DB, `invite-told:${m.id}`)).at, undefined, 'a press that gets it there clears it');
  // A meeting deleted with its change still waiting, after the staff were told: cleared too
  const n = await meeting(42, { location: 'Example Hall' });
  assert.equal((await sendIt(n.id)).status, 200);
  await change(n.id, { location: 'Elsewhere', address: '3 Far Lane' });
  await writeState(env.DB, `invite-told:${n.id}`, { at: new Date().toISOString() });
  await adminApi({ action: 'delete-meeting', id: n.id });
  await settled();
  await maybeRefreshInvites(env, { now: Date.now() });
  assert.equal((await readState(env.DB, `invite-told:${n.id}`)).at, undefined, 'nothing left to send clears it');
  assert.equal((await pendingInvites(env.DB))[n.id], undefined);
});

test('round 5 follow-up: Board’s quick read (a send’s question, the tab back in view) never waits on the invites’ answers being read from Google', async () => {
  const get = async (query = '') => {
    const headers = { 'CF-Access-JWT-Assertion': await signIn(FOUNDER), Origin: 'https://sunshineonaranneyday.com' };
    const ctx = { request: new Request(`https://sunshineonaranneyday.com/api/board-admin${query}`, { headers }), env, data: {}, waitUntil: () => {} };
    ctx.next = async () => admin.onRequestGet(ctx);
    const t0 = Date.now();
    const res = await onRequest(ctx);
    return { status: res.status, ms: Date.now() - t0 };
  };
  const m = await meeting(30, { location: 'Example Hall' });
  assert.equal((await sendIt(m.id)).status, 200);
  // Google slow to answer, and the last look at the invites' answers long ago
  await writeState(env.DB, 'calendar', {});
  google.delay = 8000;
  const quick = await get('?quick');
  assert.equal(quick.status, 200);
  assert.ok(quick.ms < 3000, `answered in ${quick.ms} ms`);
  google.delay = 0;
});

// ─── Board QA round 6 (Nov 21 2026) ─────────────────────────────────

test('round 6: someone taken off Who runs Board comes off the board’s invites ahead, by the follow and by a send', async () => {
  const PAT = 'pat@soardcharity.com';
  await writeState(env.DB, 'settings', { ...(await readState(env.DB, 'settings')), admins: [FOUNDER, PAT] });
  const m = await meeting(30, { location: 'Example Hall' });
  const n = await meeting(31, { location: 'Example Hall' });
  const a = (await sendIt(m.id)).body.meeting;
  const b = (await sendIt(n.id)).body.meeting;
  assert.ok(onIt(a.invite.eventId).includes(PAT), 'Pat is on it while running Board');
  await writeState(env.DB, 'settings', { ...(await readState(env.DB, 'settings')), admins: [FOUNDER] });
  await maybeFollowBoard(env, { now: Date.now() + 10 * MIN });
  assert.ok(!onIt(a.invite.eventId).includes(PAT), 'the follow takes Pat off');
  assert.ok(!(await getMeeting(env.DB, m.id)).invite.emails.includes(PAT));
  // A send, before any follow, takes them off too
  await writeState(env.DB, 'settings', { ...(await readState(env.DB, 'settings')), admins: [FOUNDER, PAT] });
  assert.equal((await sendIt(n.id)).status === 200 || (await sendIt(n.id)).status === 409, true);
  await writeState(env.DB, 'settings', { ...(await readState(env.DB, 'settings')), admins: [FOUNDER] });
  await change(n.id, { location: 'A new hall', address: '2 New Road' });
  assert.equal((await sendIt(n.id)).status, 200);
  assert.ok(!onIt(b.invite.eventId).includes(PAT), 'a send takes Pat off');
  assert.ok(onIt(b.invite.eventId).includes(ALEX), 'the board stays on it');
});

test('round 6: the staff told a change couldn’t reach its invite hear the end of it when it’s undone, when Send the invite finds it already there, and at once when the meeting is deleted', async () => {
  const told = (id) => writeState(env.DB, `invite-told:${id}`, { at: new Date().toISOString() });
  const cleared = async (id) => (await readState(env.DB, `invite-told:${id}`)).at === undefined;
  // Undone by a save
  const m = await meeting(40, { location: 'Example Hall', address: '1 Main St' });
  assert.equal((await sendIt(m.id)).status, 200);
  await change(m.id, { location: 'A new hall', address: '2 New Road' });
  await told(m.id);
  await change(m.id, { location: 'Example Hall', address: '1 Main St' });
  assert.ok(await cleared(m.id), 'undone: cleared');
  assert.equal((await pendingInvites(env.DB))[m.id], undefined);
  // Send the invite finding it already as it is now
  await told(m.id);
  assert.equal((await sendIt(m.id)).status, 409);
  assert.ok(await cleared(m.id), 'already there: cleared');
  // Deleted, with its change waiting: cleared at once
  const d = await meeting(41, { location: 'Example Hall' });
  assert.equal((await sendIt(d.id)).status, 200);
  await change(d.id, { location: 'Elsewhere', address: '3 Far Lane' });
  await told(d.id);
  assert.equal((await adminApi({ action: 'delete-meeting', id: d.id })).status, 200);
  assert.ok(await cleared(d.id), 'deleted: cleared at once');
  assert.equal((await pendingInvites(env.DB))[d.id], undefined);
});

// ─── Board QA round 7 (Nov 21 2026) ─────────────────────────────────

test('round 7: a change made in Google by hand, then Send the invite: Board’s record says so, nothing waits, and the staff are never told again it can’t go', async () => {
  const m = await meeting(40, { location: 'Example Hall', address: '1 Main St' });
  const sent = (await sendIt(m.id)).body.meeting;
  await change(m.id, { location: 'A new hall', address: '2 New Road' });
  await writeState(env.DB, `invite-told:${m.id}`, { at: new Date().toISOString() });
  // (someone types the new place into the event in Google)
  google.events[sent.invite.eventId].location = 'A new hall, 2 New Road';
  const r = await sendIt(m.id);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.already, true);
  assert.equal((await readState(env.DB, `invite-told:${m.id}`)).at, undefined, 'the alert cleared');
  assert.equal((await pendingInvites(env.DB))[m.id], undefined, 'nothing waits to go onto it');
  assert.equal((await getMeeting(env.DB, m.id)).invite.place, 'A new hall, 2 New Road', 'Board’s record of the invite has the new place');
  // The heartbeat after it, as if a day of refusals had gone by: nothing goes, nobody is told
  const since = mark();
  await settled();
  await maybeRefreshInvites(env, { now: Date.now() + 25 * 60 * MIN });
  assert.deepEqual(since(), [], 'no write to Google');
  assert.equal((await readState(env.DB, `invite-told:${m.id}`)).at, undefined, 'and no new alert');
});
