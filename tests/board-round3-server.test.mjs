/**
 * Board, QA round 3 (Nov 20 2026), the server's part: a meeting deleted while its invite goes out never leaves the
 * invite on anyone's calendar, and Send the invite never goes for a meeting held or kept off the board page; an email
 * to the board that went is always recorded and never goes twice, however busy the meeting is; a new meeting carries
 * nothing of a meeting kept off the board page; nothing gets past the agenda's approval by way of "not a board meeting", and a
 * stale tab never puts that tag back; a member's new web address moves everywhere Board keeps it; a program's error
 * is never what a person reads, and two Approve presses are one approval; a save without a base goes by the same
 * rules; a refused agenda email is said as that. Made-up people only.
 * Run: node --test tests/
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import { getMeeting, patchMeeting, ensureSchema, maybeSendApprovedAgendas, setActionDone, presenterGate } from '../functions/api/_board.js';
import { writeState } from '../functions/api/_board-roles.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import { todayEastern } from '../public/admin/board-shared.js';
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
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tick = () => new Promise((r) => setImmediate(r));
const until = async (ok) => { for (let i = 0; i < 2000 && !ok(); i++) await tick(); assert.ok(ok(), 'it got there'); };

class FakeR2 {
  constructor() { this.map = new Map(); }
  async put(key, bytes) { this.map.set(key, new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes)); }
  async get(key) { const b = this.map.get(key); return b ? { body: b, size: b.length, httpMetadata: { contentType: 'application/pdf' } } : null; }
  async head(key) { return this.map.has(key) ? { size: this.map.get(key).length } : null; }
  async delete(key) { this.map.delete(key); }
}

/**
 * D1 with a look before each statement (`hooks.before(sql, params)`): what lands in between a read and its write, a
 * delete midway, a round trip's wait. `raw` is D1 itself, for what the hook does
 */
let hooks;
let raw;
function hooked(DB) {
  const wrap = (st) => ({
    ...st,
    bind: (...p) => wrap(st.bind(...p)),
    first: async (c) => { await hooks.before(st._sql, st._params); return st.first(c); },
    all: async () => { await hooks.before(st._sql, st._params); return st.all(); },
    run: async () => { await hooks.before(st._sql, st._params); return st.run(); },
  });
  return { ...DB, prepare: (sql) => wrap(DB.prepare(sql)) };
}
/** patchMeeting's write (writeOver): a read of the meeting comes before it */
const WRITE_OVER = /^UPDATE board_meetings SET date = \?, data = \?/;
/** Any write to a meeting: someone else's save lands just before each one */
const ANY_WRITE = /^UPDATE board_meetings SET/;
/** Someone else's save of the meeting, landed this moment (a new updatedAt, as every save has) */
async function saveLands(id, n) {
  const row = await raw.prepare('SELECT updated_at FROM board_meetings WHERE id = ?').bind(id).first();
  if (!row) return;
  const at = new Date(Math.max(Date.now(), Date.parse(row.updated_at || 0) + 1)).toISOString();
  await raw.prepare("UPDATE board_meetings SET updated_at = ?, data = json_set(data, '$.updatedAt', ?, '$.inviteNote', ?) WHERE id = ?").bind(at, at, `Edit ${n}`, id).run();
}

let env;
/** Resend, faked: what it was sent, how it answers (`mode`: ok | 422), and `onSend` as it takes them */
let resend;
/** Google Calendar, faked: its events by id, every call, and `onWrite(method)` while it answers a write */
let google;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  raw = await createD1();
  hooks = { before: async () => {} };
  env = { DB: hooked(raw), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', FILES: new FakeR2(), GOOGLE_CALENDAR_KEY: GOOGLE_KEY };
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
  resend = { sent: [], mode: 'ok', onSend: null };
  google = { events: {}, calls: [], onWrite: null };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      if (resend.mode === '422') return Response.json({ name: 'validation_error', message: 'The from address domain is not verified' }, { status: 422 });
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      resend.sent.push(...list.map((m) => ({ to: [m.to].flat()[0], subject: m.subject, text: m.text })));
      resend.onSend?.();
      return Response.json(Array.isArray(body) ? { data: list.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      google.calls.push({ method, url, body });
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop());
      if (method === 'POST') {
        const e = { ...body, status: 'confirmed', hangoutLink: 'https://meet.google.com/abc-defg-hij', attendees: (body.attendees || []).map((a) => ({ ...a, responseStatus: 'needsAction' })) };
        google.events[e.id] = e;
        await google.onWrite?.(method);
        return Response.json(e);
      }
      const e = google.events[id];
      if (!e) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
      if (method === 'DELETE') {
        if (e.status === 'cancelled') return Response.json({ error: { message: 'Resource has been deleted' } }, { status: 410 });
        e.status = 'cancelled';
        await google.onWrite?.(method);
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') { Object.assign(e, body); await google.onWrite?.(method); }
      return Response.json(e);
    }
    // (Gmail, for the approval's note to the founders: not set up here, and never in the way of the approval)
    if (url.startsWith('https://gmail.googleapis.com/')) return Response.json({ error: { message: 'not here' } }, { status: 403 });
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call(email, path, { method = 'GET', body = null, form = null, handler }) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' };
  if (body) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => handler(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : await res.text() };
}
const adminApi = (body) => call(FOUNDER, '/api/board-admin', { method: 'POST', body, handler: admin.onRequestPost });
const portalGet = (email, q = '') => call(email, `/api/board-portal${q}`, { handler: portal.onRequestGet });
const portalApi = (email, body) => call(email, '/api/board-portal', { method: 'POST', body, handler: portal.onRequestPost });
/** A meeting saved from Board (as its editor saves it), `days` ahead */
async function meeting(days, fields = {}) {
  const m = (await adminApi({ action: 'new-meeting', date: inDays(days) })).body.meeting;
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, ...fields }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
const writes = () => google.calls.filter((c) => c.method !== 'GET');
const toldHowToSignIn = () => writeState(env.DB, 'welcome', { sentAt: new Date().toISOString() });
const emailsTo = () => resend.sent.reduce((o, m) => ({ ...o, [m.to]: (o[m.to] || 0) + 1 }), {});
/** Ten minutes and more ago: the send's record as it would be by then (Email again's ten minutes gone by) */
async function sentLongAgo(kind, id) {
  const key = `board-send:${kind}:${id}`;
  const was = JSON.parse((await raw.prepare('SELECT data FROM board_state WHERE key = ?').bind(key).first()).data);
  const earlier = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  await raw.prepare('UPDATE board_state SET data = ? WHERE key = ?').bind(JSON.stringify({ ...was, at: earlier, had: Object.fromEntries(Object.keys(was.had || {}).map((e) => [e, earlier])) }), key).run();
}

// ─── M1: Send the invite and Delete at once ─────────────────────────

test('M1: a meeting deleted while its invite is going out has the invite taken back off the calendar, and Send the invite says so', async () => {
  const m = await meeting(20, { location: 'Example Hall' });
  let deleted = null;
  // The other admin deletes it while Google is making the event
  google.onWrite = async (method) => { if (method === 'POST' && !deleted) deleted = await adminApi({ action: 'delete-meeting', id: m.id }); };
  const sent = await adminApi({ action: 'send-invite', id: m.id });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(await getMeeting(env.DB, m.id), null, 'the meeting is gone');
  const events = Object.values(google.events);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'cancelled', 'no event left on the calendar for a meeting that isn’t there');
  assert.deepEqual(writes().map((c) => [c.method, new URL(c.url).searchParams.get('sendUpdates')]), [['POST', 'all'], ['DELETE', 'all']], 'and Google told the guests');
  assert.equal(sent.status, 404);
  assert.equal(sent.body.gone, true);
  assert.equal(sent.body.error, 'This meeting was deleted while its invite was going out, so Board took the invite back off the calendar and Google told everyone on it.');
});

test('M1: an invite recorded after the delete read the meeting is cancelled too: the meeting goes only as it was read', async () => {
  const m = await meeting(20, { location: 'Example Hall' });
  let release;
  const gate = new Promise((r) => { release = r; });
  google.onWrite = async (method) => { if (method === 'POST') await gate; };
  const sending = adminApi({ action: 'send-invite', id: m.id });
  await until(() => google.calls.some((c) => c.method === 'POST'));
  // The delete has read the meeting (no invite on it yet): the invite lands and is recorded just before the meeting goes
  let once = false;
  hooks.before = async (sql) => {
    if (once || !/^DELETE FROM board_meetings WHERE id = \?/.test(sql)) return;
    once = true;
    release();
    await sending;
  };
  const del = await adminApi({ action: 'delete-meeting', id: m.id });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await sending).status, 200, 'the invite went while the meeting was there');
  assert.equal(await getMeeting(env.DB, m.id), null);
  assert.equal(Object.values(google.events)[0].status, 'cancelled', 'and it came off the calendar with the meeting');
  assert.equal(del.body.cancelled, true);
});

test('M1: Send the invite pressed while the meeting is being deleted doesn’t go: nobody is invited to a meeting going away', async () => {
  const m = await meeting(20, { location: 'Example Hall' });
  assert.equal((await adminApi({ action: 'send-invite', id: m.id })).status, 200);
  let pressed = null;
  // Pressed in another tab while Google is cancelling the invite for the delete
  google.onWrite = async (method) => { if (method === 'DELETE' && !pressed) pressed = await adminApi({ action: 'send-invite', id: m.id }); };
  google.calls = [];
  const del = await adminApi({ action: 'delete-meeting', id: m.id });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.cancelled, true);
  assert.equal(await getMeeting(env.DB, m.id), null);
  assert.equal(pressed.status, 409, JSON.stringify(pressed.body));
  assert.equal(pressed.body.error, 'This meeting is being deleted, so its invite didn’t go.');
  assert.equal(Object.values(google.events)[0].status, 'cancelled');
  assert.deepEqual(writes().map((c) => c.method), ['DELETE'], 'Google was never asked to send it again');
});

// ─── Send the invite from a stale tab (admin round 3, minor 1) ──────

test('Send the invite for a meeting held, ended by the chair, or kept off the board page is refused in words: Google is never asked', async () => {
  const yesterday = await meeting(-1);
  const r1 = await adminApi({ action: 'send-invite', id: yesterday.id });
  assert.deepEqual([r1.status, r1.body.error], [409, 'This meeting has already been held, so no calendar invite goes out for it.']);
  const long = await meeting(-60);
  assert.equal((await adminApi({ action: 'send-invite', id: long.id })).status, 409);
  const ended = await meeting(0);
  await patchMeeting(env.DB, ended.id, (cur) => ({ ...cur, live: { ...cur.live, startedAt: new Date(Date.now() - 3600_000).toISOString(), endedAt: new Date().toISOString() } }));
  assert.equal((await adminApi({ action: 'send-invite', id: ended.id })).status, 409);
  const coffee = await meeting(12, { title: 'Coffee with a donor' });
  await patchMeeting(env.DB, coffee.id, (cur) => ({ ...cur, notBoard: true }));
  const r4 = await adminApi({ action: 'send-invite', id: coffee.id });
  assert.deepEqual([r4.status, r4.body.error], [409, 'This meeting is kept off the board page (it isn’t a board meeting), so no calendar invite goes out for it.']);
  assert.deepEqual(writes(), [], 'nobody was emailed by Google');
  // A meeting ahead still goes
  assert.equal((await adminApi({ action: 'send-invite', id: (await meeting(9)).id })).status, 200);
});

// ─── M2: a send's record ────────────────────────────────────────────

test('M2: an email to the board that went is recorded on the meeting however many saves land while it goes, and never called "nothing was lost"', async () => {
  const m = await meeting(5);
  await agendaApproved(env.DB, m.id);
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true }));
  // Once the emails are going, someone saves the meeting between every read of it and its write
  let busy = false;
  let n = 0;
  resend.onSend = () => { busy = true; };
  hooks.before = async (sql) => { if (busy && ANY_WRITE.test(sql)) await saveLands(m.id, ++n); };
  const r = await adminApi({ action: 'send-packet', id: m.id });
  busy = false;
  assert.deepEqual(emailsTo(), { [ALEX]: 1, [SAM]: 1 }, 'the emails went');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.doesNotMatch(JSON.stringify(r.body), /Nothing was lost/);
  const now = await getMeeting(env.DB, m.id);
  assert.ok(now.packetSentAt, 'and the meeting says so');
  assert.equal(now.packetSentTo, 2);
  assert.ok(now.inviteNote.startsWith('Edit'), 'with every save made meanwhile kept');

  // The minutes notice too, on a meeting held with its minutes in
  const held = await meeting(-3, { shared: true });
  await patchMeeting(env.DB, held.id, (cur) => ({ ...cur, minutesFrom: { name: 'Minutes.pdf', at: new Date().toISOString() } }));
  resend.sent = [];
  hooks.before = async (sql) => { if (busy && ANY_WRITE.test(sql)) await saveLands(held.id, ++n); };
  const r2 = await adminApi({ action: 'send-minutes', id: held.id });
  busy = false;
  assert.equal(resend.sent.length, 2);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.ok((await getMeeting(env.DB, held.id)).minutesSentAt);
});

test('M2: the approved agenda goes to the board once: recorded however busy the meeting is, so the heartbeat never sends it again', async () => {
  await toldHowToSignIn();
  const m = await meeting(10);
  let busy = false;
  let n = 0;
  resend.onSend = () => { busy = true; };
  hooks.before = async (sql) => { if (busy && ANY_WRITE.test(sql)) await saveLands(m.id, ++n); };
  const r = await adminApi({ action: 'approve-agenda', id: m.id });
  busy = false;
  hooks.before = async () => {};
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Eleven minutes on (past Email again's ten), the heartbeat
  await sentLongAgo('packet', m.id);
  await maybeSendApprovedAgendas(env, { now: Date.now() + 11 * 60 * 1000 });
  assert.deepEqual(emailsTo(), { [ALEX]: 1, [SAM]: 1 }, 'each board member had the agenda once');
  assert.equal(r.body.agenda, 'sent');
  assert.ok((await getMeeting(env.DB, m.id)).packetSentAt);
});

test('M2: a send that may have gone keeps the approved agenda’s claim: the heartbeat never sends it a second time', async () => {
  await toldHowToSignIn();
  const m = await meeting(10);
  // The meeting's record can't be written after the emails went (the database stops answering then)
  let after = false;
  resend.onSend = () => { after = true; };
  hooks.before = async (sql) => { if (after && ANY_WRITE.test(sql)) throw new Error('D1_ERROR: Network connection lost'); };
  const r = await adminApi({ action: 'approve-agenda', id: m.id });
  hooks.before = async () => {};
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.agenda, 'failed');
  assert.match(r.body.agendaError, /may have gone/);
  await sentLongAgo('packet', m.id);
  await maybeSendApprovedAgendas(env, { now: Date.now() + 11 * 60 * 1000 });
  assert.deepEqual(emailsTo(), { [ALEX]: 1, [SAM]: 1 }, 'never twice');
});

test('M2: Email the board stopped after its emails went is said as that: they may have gone, never "try again" nor the database’s words', async () => {
  const m = await meeting(5);
  await agendaApproved(env.DB, m.id);
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true }));
  let after = false;
  resend.onSend = () => { after = true; };
  hooks.before = async (sql) => { if (after && ANY_WRITE.test(sql)) throw new Error('D1_ERROR: Network connection lost'); };
  const r = await adminApi({ action: 'send-packet', id: m.id });
  hooks.before = async () => {};
  assert.equal(resend.sent.length, 2);
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'These emails may have gone: the site stopped partway through sending them. Ask a board member whether theirs came before pressing it again.');
  assert.doesNotMatch(JSON.stringify(r.body), /D1_ERROR|Nothing was lost|try again/);
  // Pressed again a moment later: the send's own record says they went
  const again = await adminApi({ action: 'send-packet', id: m.id });
  assert.equal(again.status, 409);
  assert.equal(again.body.already, true);
  assert.equal(resend.sent.length, 2, 'never a second copy');
});

// ─── M3: the to-dos a new meeting carries ───────────────────────────

test('M3: a new meeting carries the board’s own open to-dos, never one from a meeting kept off the board page, nor that meeting as the one before', async () => {
  await meeting(-30, { shared: true, actions: [{ id: 'a_shared01', text: 'Send the venue contract', owner: 'alex-rivera', ownerName: 'Alex Rivera' }] });
  // The last board meeting, its minutes in and not shared yet: its to-dos are the board's follow-up (test-board.mjs walks it)
  const held = await meeting(-10, { actions: [{ id: 'a_boards01', text: 'Call the bank about the line of credit', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }] });
  const coffee = await meeting(-5, { title: 'Coffee with a donor', actions: [{ id: 'a_offpage1', text: 'OFFPAGE confidential donor list', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }] });
  await patchMeeting(env.DB, coffee.id, (cur) => ({ ...cur, notBoard: true }));
  const next = (await adminApi({ action: 'new-meeting', date: inDays(15) })).body.meeting;
  assert.deepEqual(next.actions.map((a) => a.id), ['a_shared01', 'a_boards01']);
  // Its minutes item is the last board meeting's, never the coffee's
  const minutes = next.sections.flatMap((s) => s.items).find((it) => it.live === 'minutes');
  assert.equal(minutes.about, held.id);
  assert.doesNotMatch(JSON.stringify(next), /Coffee|OFFPAGE/);
  // Approved and shared: Sam's board page has his own to-do, and nothing of the coffee
  await agendaApproved(env.DB, next.id);
  const now = await getMeeting(env.DB, next.id);
  assert.equal((await adminApi({ action: 'save-meeting', meeting: { ...now, shared: true }, base: now.updatedAt })).status, 200);
  const page = (await portalGet(SAM)).body;
  assert.ok(page.meetings.some((x) => x.id === next.id));
  assert.ok(page.actions.some((a) => a.id === 'a_boards01' && a.mine));
  assert.doesNotMatch(JSON.stringify(page), /OFFPAGE|Coffee with a donor/);
});

// ─── M4: "not a board meeting" and the agenda's approval ────────────

test('M4: a meeting ahead kept off the board page as "not a board meeting" can’t be shared past its agenda’s approval', async () => {
  const m = await meeting(12);
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, notBoard: true }));
  const now = await getMeeting(env.DB, m.id);
  const r = await adminApi({ action: 'save-meeting', meeting: { ...now, shared: true }, base: now.updatedAt });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'The agenda goes to the board once it’s approved');
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.shared, after.notBoard], [false, true]);
  assert.ok(!(await portalGet(ALEX)).body.meetings.some((x) => x.id === m.id));
  // Approved: it goes on the board page, a board meeting
  await agendaApproved(env.DB, m.id);
  const ok = await adminApi({ action: 'save-meeting', meeting: { ...after, shared: true }, base: after.updatedAt });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.meeting.shared, ok.body.meeting.notBoard], [true, false]);
});

test('M4: an editor’s copy never tags a meeting "not a board meeting": a request saying so, then Share, still waits for the approval', async () => {
  const m = await meeting(12);
  const tagged = await adminApi({ action: 'save-meeting', meeting: { ...m, notBoard: true }, base: m.updatedAt });
  assert.equal(tagged.status, 200);
  assert.equal(tagged.body.meeting.notBoard, false, 'Board has nothing that sets it');
  const share = await adminApi({ action: 'save-meeting', meeting: { ...tagged.body.meeting, notBoard: true, shared: true }, base: tagged.body.meeting.updatedAt });
  assert.equal(share.status, 409);
  // (nor by a request calling it a practice meeting: that's the server's to know)
  const sneak = await adminApi({ action: 'save-meeting', meeting: { ...tagged.body.meeting, practice: true, shared: true }, base: tagged.body.meeting.updatedAt });
  assert.equal(sneak.status, 409, JSON.stringify(sneak.body));
  assert.equal((await getMeeting(env.DB, m.id)).shared, false);
  assert.ok(!(await portalGet(ALEX)).body.meetings.some((x) => x.id === m.id));
});

test('M4 (admin round 3): a "not a board meeting" shared from the editor stays on the board page: the tab’s next save never tags it again', async () => {
  const m = await meeting(-5);
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, notBoard: true }));
  const tab = await getMeeting(env.DB, m.id);
  const shared = await adminApi({ action: 'save-meeting', meeting: { ...tab, shared: true }, base: tab.updatedAt });
  assert.equal(shared.status, 200, JSON.stringify(shared.body));
  assert.deepEqual([shared.body.meeting.shared, shared.body.meeting.notBoard], [true, false]);
  // The tab's copy still has notBoard (it never took it from the answer), and it saves the next thing typed
  const stale = await adminApi({ action: 'save-meeting', meeting: { ...tab, shared: true, notBoard: true, inviteNote: 'Typed after sharing' }, base: shared.body.meeting.updatedAt });
  assert.equal(stale.status, 200, JSON.stringify(stale.body));
  const now = await getMeeting(env.DB, m.id);
  assert.deepEqual([now.shared, now.notBoard, now.inviteNote], [true, false, 'Typed after sharing']);
  assert.ok((await portalGet(ALEX)).body.meetings.some((x) => x.id === m.id), 'still on the board page');
  const minutes = await adminApi({ action: 'send-minutes', id: m.id });
  assert.doesNotMatch(String(minutes.body.error || ''), /kept off the board page/);
});

test('M4: a meeting on the board page already stays there whatever its day (its agenda has reached the board): a held one given a day ahead saves, never a refusal the editor could only put back as it is and ask again', async () => {
  const m = await meeting(-5, { shared: true });
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, date: inDays(30) }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([(await getMeeting(env.DB, m.id)).date, (await getMeeting(env.DB, m.id)).shared], [inDays(30), true]);
  // ...and one not on it, given a day ahead and shared in the same save, still waits: refused by name
  const n = await meeting(-5, { shared: false });
  const q = await adminApi({ action: 'save-meeting', meeting: { ...n, date: inDays(30), shared: true }, base: n.updatedAt });
  assert.equal(q.status, 409, JSON.stringify(q.body));
  assert.deepEqual(q.body.refused, ['shared']);
  assert.equal((await getMeeting(env.DB, n.id)).shared, false);
});

// ─── m1: a member's new web address ─────────────────────────────────

test('m1: a renamed board member keeps their to-dos, the items they present, their answers, notes and reminders: every place Board keeps their address moves', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const { ensureAsks } = await import('../functions/api/_board-asks.js');
  for (const sql of ['CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)', 'CREATE TABLE community (slug TEXT PRIMARY KEY, data TEXT)', 'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)']) await raw.exec(sql);
  const m = await meeting(-20, {
    shared: true,
    sections: [{ id: 's_fin1', title: 'Finance', items: [{ id: 'i_samrep1', title: 'Treasurer’s report', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] }],
    actions: [{ id: 'a_samtodo', text: 'Share the store plan', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(5) }],
  });
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, invite: { eventId: 'evsam1', organizer: FOUNDER, sentAt: new Date().toISOString(), replies: { 'sam-ortiz': 'accepted', 'alex-rivera': 'invited' }, who: { 'sam-ortiz': SAM } }, live: { ...cur.live, itemId: 'i_samrep1', floor: 'sam-ortiz' } }));
  await ensureAsks(env.DB);
  await raw.prepare("INSERT INTO board_line_notes (meeting_id, item_id, key, line, text, by_slug, by_name, at) VALUES (?, 'i_samrep1', 'cash', 'Cash', 'Up from last month', 'sam-ortiz', 'Sam Ortiz', ?)").bind(m.id, new Date().toISOString()).run();
  await raw.prepare("INSERT INTO board_rsvps (meeting_id, slug, answer, at) VALUES (?, 'sam-ortiz', 'yes', ?)").bind(m.id, new Date().toISOString()).run();
  await raw.prepare("INSERT INTO board_minutes_corrections (id, meeting_id, target, kind, words, by_slug, by_name, at, state) VALUES ('c_sam1', ?, 'n:i_samrep1', 'notes', 'A fix', 'sam-ortiz', 'Sam Ortiz', ?, 'open')").bind(m.id, new Date().toISOString()).run();
  await raw.prepare('INSERT INTO board_minutes_notes (meeting_id, data, sent, updated_at) VALUES (?, ?, ?, ?)').bind(m.id,
    JSON.stringify({ 'r:sam-ortiz': 'present', 'r:alex-rivera': 'remote', 'a:a_new1': { text: 'Call the bank', owner: 'sam-ortiz' } }),
    JSON.stringify({ at: new Date().toISOString(), rollPut: { 'sam-ortiz': 'present' }, rollWas: { 'sam-ortiz': '' }, keeper: 'sam-ortiz', extra: [], actionPrints: { a_new1: JSON.stringify(['Call the bank', '', '', '', 'sam-ortiz', '', '', '']) } }),
    new Date().toISOString()).run();
  await writeState(env.DB, 'settings', { template: [{ title: 'Finance', items: [{ title: 'Treasurer’s report', who: ['sam-ortiz'] }] }] });

  const r = await rename(env, { collection: 'team', from: 'sam-ortiz', to: 'sam-ortiz-lee' }, FOUNDER, async () => new Response('{}', { status: 404 }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(after.sections[0].items[0].who, ['sam-ortiz-lee']);
  assert.equal(after.actions[0].owner, 'sam-ortiz-lee');
  assert.ok(after.attendance.some((p) => p.slug === 'sam-ortiz-lee') && !after.attendance.some((p) => p.slug === 'sam-ortiz'));
  assert.deepEqual(after.invite.replies, { 'sam-ortiz-lee': 'accepted', 'alex-rivera': 'invited' });
  assert.deepEqual(after.invite.who, { 'sam-ortiz-lee': SAM });
  assert.equal(after.live.floor, 'sam-ortiz-lee');
  for (const [table, col] of [['board_line_notes', 'by_slug'], ['board_rsvps', 'slug'], ['board_minutes_corrections', 'by_slug']]) {
    assert.deepEqual((await raw.prepare(`SELECT ${col} AS s FROM ${table}`).all()).results.map((x) => x.s), ['sam-ortiz-lee'], table);
  }
  const notes = await raw.prepare('SELECT data, sent FROM board_minutes_notes WHERE meeting_id = ?').bind(m.id).first();
  assert.deepEqual(JSON.parse(notes.data), { 'r:sam-ortiz-lee': 'present', 'r:alex-rivera': 'remote', 'a:a_new1': { text: 'Call the bank', owner: 'sam-ortiz-lee' } });
  const sent = JSON.parse(notes.sent);
  assert.deepEqual([sent.rollPut, sent.rollWas, sent.keeper, JSON.parse(sent.actionPrints.a_new1)[4]], [{ 'sam-ortiz-lee': 'present' }, { 'sam-ortiz-lee': '' }, 'sam-ortiz-lee', 'sam-ortiz-lee']);
  const settings = JSON.parse((await raw.prepare("SELECT data FROM board_state WHERE key = 'settings'").first()).data);
  assert.deepEqual(settings.template[0].items[0].who, ['sam-ortiz-lee']);
  // And what he does on the board page is his: his own to-do, his own report
  const member = { slug: 'sam-ortiz-lee', name: 'Sam Ortiz', email: SAM };
  assert.equal((await setActionDone(env.DB, 'a_samtodo', true, { by: SAM, slug: member.slug })).done, true);
  assert.equal((await presenterGate(env, m.id, 'i_samrep1', { member })).it.id, 'i_samrep1');
});

// ─── m3: what a person reads when something goes wrong ──────────────

test('m3: a report, motion, slide order or document saved as the meeting is deleted answers that it’s gone: never a program’s error', async () => {
  const ahead = async () => {
    const m = await meeting(9, { sections: [{ id: 's_fin2', title: 'Finance', items: [{ id: 'i_sam2', title: 'Budget', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] }] });
    await agendaApproved(env.DB, m.id);
    await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true }));
    return m;
  };
  /** The other admin deletes the meeting just as the change is written */
  const deletedAsWritten = (id) => {
    let once = false;
    hooks.before = async (sql) => {
      if (once || !WRITE_OVER.test(sql)) return;
      once = true;
      await raw.prepare('DELETE FROM board_meetings WHERE id = ?').bind(id).run();
    };
  };
  const pdf = () => { const f = new FormData(); f.append('file', new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'Budget.pdf', { type: 'application/pdf' })); return f; };
  const said = [];
  for (const send of [
    (id) => portalApi(SAM, { action: 'report', meetingId: id, itemId: 'i_sam2', text: 'Up from last month' }),
    (id) => portalApi(SAM, { action: 'motion', meetingId: id, itemId: 'i_sam2', text: 'Move to approve the budget' }),
    (id) => portalApi(SAM, { action: 'slide-order', meetingId: id, itemId: 'i_sam2', order: [] }),
    (id) => call(SAM, `/api/board-portal?attach=${id}&item=i_sam2`, { method: 'POST', form: pdf(), handler: portal.onRequestPost }),
  ]) {
    const m = await ahead();
    deletedAsWritten(m.id);
    const r = await send(m.id);
    hooks.before = async () => {};
    said.push(r);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.error, 'That meeting isn’t on the board page');
  }
  assert.deepEqual((await raw.prepare("SELECT id FROM board_files WHERE owner_type = 'meeting'").all()).results, [], 'never a document nothing shows');
  for (const r of said) assert.doesNotMatch(JSON.stringify(r.body), /Cannot read|null|TypeError/);
});

test('m3: two Approve presses at once are one approval: both answer, one says it’s approved already, and the agenda goes once', async () => {
  await toldHowToSignIn();
  const m = await meeting(10);
  // The two presses side by side: each has looked for an approval (none yet) before either writes one
  let writing = 0;
  hooks.before = async (sql) => {
    if (!/^INSERT (OR IGNORE )?INTO board_asks .*'chair'/s.test(sql) || writing >= 2) return;
    writing += 1;
    await until(() => writing >= 2);
  };
  const both = await Promise.all([adminApi({ action: 'approve-agenda', id: m.id }), adminApi({ action: 'approve-agenda', id: m.id })]);
  hooks.before = async () => {};
  for (const r of both) {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.doesNotMatch(JSON.stringify(r.body), /UNIQUE|constraint|board_asks/);
  }
  assert.deepEqual(both.map((r) => !!r.body.already).sort(), [false, true]);
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM board_asks WHERE kind = 'chair' AND meeting_id = ?").bind(m.id).first()).n, 1);
  assert.deepEqual(emailsTo(), { [ALEX]: 1, [SAM]: 1 });
});

test('m3: an error the code never meant to say reaches a person as plain words; one it means to say stays as it is', async () => {
  const { sayable } = await import('../functions/api/_board.js');
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const e of [new TypeError("Cannot read properties of null (reading 'sections')"), new Error('UNIQUE constraint failed: board_asks.kind, board_asks.meeting_id'), new Error('D1_ERROR: Network connection lost')]) {
      assert.equal(sayable(e), 'Something went wrong on the site’s side. Reload the page to see what was saved, then try again.');
    }
  } finally { console.error = quiet; }
  assert.equal(sayable(new Error('The meeting kept changing while it was saved. Nothing was lost: try again.')), 'The meeting kept changing while it was saved. Nothing was lost: try again.');
});

// ─── m4: a save without a base ──────────────────────────────────────

test('m4: a save without a base goes by the same rules: minutes never marked approved on a meeting ahead, and a deleted meeting never comes back', async () => {
  const ahead = await meeting(9);
  const r = await adminApi({ action: 'save-meeting', meeting: { ...ahead, minutes: 'approved' } });
  assert.deepEqual([r.status, r.body.error], [409, 'This meeting hasn’t happened yet, so it has no minutes to approve or send.']);
  assert.equal((await getMeeting(env.DB, ahead.id)).minutes, 'draft');
  const gone = await meeting(15);
  assert.equal((await adminApi({ action: 'delete-meeting', id: gone.id })).status, 200);
  const back = await adminApi({ action: 'save-meeting', meeting: { ...gone, title: 'Brought back' } });
  assert.equal(back.status, 404, JSON.stringify(back.body));
  assert.equal(back.body.gone, true);
  assert.equal(await getMeeting(env.DB, gone.id), null, 'it stays deleted');
});

// ─── m5: the agenda email refused ───────────────────────────────────

test('m5: when Resend says no to the approved agenda’s email, Approve says so in words, never that it waits on the sign-in email', async () => {
  await toldHowToSignIn();
  const m = await meeting(10);
  resend.mode = '422';
  const r = await adminApi({ action: 'approve-agenda', id: m.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.agenda, 'failed');
  assert.equal(r.body.agendaError, 'The agenda is approved. Resend said no to these emails, so they didn’t go. Its reason: The from address domain is not verified. Board tries again by itself in a few minutes, or press Email the board.');
  assert.doesNotMatch(r.body.agendaError, /Resend \d{3}|[–—]/);
  assert.ok(r.body.approvals[m.id], 'approved all the same');
  // Once Resend takes it, the heartbeat sends it, once
  resend.mode = 'ok';
  await maybeSendApprovedAgendas(env);
  await maybeSendApprovedAgendas(env);
  assert.deepEqual(emailsTo(), { [ALEX]: 1, [SAM]: 1 });
  assert.ok((await getMeeting(env.DB, m.id)).packetSentAt);
});
