/**
 * Board, QA round 2 (Nov 19 2026), the server's part: what a presenter sees and opens of a meeting not shared yet, the
 * minutes approved and announced only when there are some, a meeting kept off the board page kept off everywhere, a
 * visit that lasts while the member is on the page, guest presenters in the agenda email, failed sends said in words,
 * the to-do reminder's preview from real to-dos, and a second tab's Send the invite. Made-up people only.
 * Run: node --test tests/
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { getMeeting, patchMeeting, portalData, agendaParts, ensureSchema } from '../functions/api/_board.js';
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

class FakeR2 {
  constructor() { this.map = new Map(); }
  async put(key, bytes) { this.map.set(key, new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes)); }
  async get(key) { const b = this.map.get(key); return b ? { body: b, size: b.length, httpMetadata: { contentType: 'application/pdf' } } : null; }
  async head(key) { return this.map.has(key) ? { size: this.map.get(key).length } : null; }
  async delete(key) { this.map.delete(key); }
}

let env;
/** Resend, faked: what it was sent, and how it answers (`mode`: ok | 422 | 502 | lost) */
let resend;
/** Google Calendar, faked: its events by id, and every call */
let google;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', FILES: new FakeR2(), GOOGLE_CALENDAR_KEY: GOOGLE_KEY };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  for (const [slug, email] of [['alex-rivera', ALEX], ['sam-ortiz', SAM]]) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  clearTokenCache();
  resend = { sent: [], mode: 'ok' };
  google = { events: {}, calls: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      if (resend.mode === '422') return Response.json({ name: 'validation_error', message: 'The from address domain is not verified' }, { status: 422 });
      if (resend.mode === '502') return new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
      if (resend.mode === 'lost') throw new TypeError('Network connection lost');
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      resend.sent.push(...list.map((m) => ({ to: [m.to].flat()[0], subject: m.subject, html: m.html, text: m.text })));
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
        return Response.json(e);
      }
      const e = google.events[id];
      if (!e) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
      if (method === 'PATCH') Object.assign(e, body);
      return Response.json(e);
    }
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
const fileGet = (email, id) => call(email, `/api/board-file?id=${id}`, { handler: boardFile.onRequestGet });
/** A board file on a meeting, its bytes in R2 */
async function file(meetingId, id, { staffOnly = false, by = FOUNDER, name = `${id}.pdf` } = {}) {
  await env.DB.prepare('INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by) VALUES (?, \'meeting\', ?, ?, ?, \'application/pdf\', 9, \'other\', ?, ?, ?)')
    .bind(id, meetingId, `board/${id}`, name, staffOnly ? 1 : 0, new Date().toISOString(), by).run();
  await env.FILES.put(`board/${id}`, new TextEncoder().encode('%PDF-1.4\n'));
  return id;
}
/** A meeting saved from Board (as its editor saves it), `days` ahead */
async function meeting(days, fields = {}) {
  const m = (await adminApi({ action: 'new-meeting', date: inDays(days) })).body.meeting;
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, ...fields }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}

// ─── A presenter on a meeting not shared yet ────────────────────────

/** Ten days ahead, not shared, agenda typed: Sam presents his budget in a part with the secretary's notes, Alex another item */
async function presenting(days = 10) {
  const m = await meeting(days, {
    title: 'Presenting probe', inviteNote: 'SECRET gate code 4321', location: 'Probe Hall',
    sections: [
      { id: 's_p1', title: 'Finance', notes: 'SECRET part note', minutes: 20, items: [
        { id: 'i_sam1', title: 'Sam’s budget', who: ['sam-ortiz'], notes: 'Sam’s own notes', staffNote: 'SECRET staff note' },
        { id: 'i_alex1', title: 'SECRET Alex’s item', who: ['alex-rivera'], notes: 'SECRET Alex notes', report: 'SECRET Alex report' },
      ] },
      { id: 's_p2', title: 'SECRET Executive session', notes: 'SECRET too', items: [{ id: 'i_conf', title: 'SECRET a confidential item', confidential: true, presenter: 'Jane Doe' }] },
    ],
    motions: [{ id: 'v_secret1', text: 'SECRET motion' }],
    actions: [{ id: 'a_secret1', text: 'SECRET action', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }],
  });
  const fBoard = await file(m.id, 'f_samboard');
  const fStaff = await file(m.id, 'f_samstaff', { staffOnly: true });
  const fAlex = await file(m.id, 'f_alexfile');
  const fOther = await file(m.id, 'f_onnoitem');
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === 'i_sam1' ? { ...it, docs: [fBoard, fStaff] } : it.id === 'i_alex1' ? { ...it, docs: [fAlex] } : it)) })) }));
  return { m: await getMeeting(env.DB, m.id), fBoard, fStaff, fAlex, fOther };
}

test('a presenter’s view of a meeting not shared yet is only its name, day, time, place, minutes status and their own items: never a part’s notes', async () => {
  const { m } = await presenting();
  const page = (await portalGet(SAM)).body;
  const entry = page.presenting.find((x) => x.id === m.id);
  assert.ok(entry, 'Sam sees the meeting he presents in');
  assert.deepEqual(entry.sections.map((s) => [s.title, s.items.map((i) => i.title)]), [['Finance', ['Sam’s budget']]]);
  assert.deepEqual(entry.sections.map((s) => s.notes), [''], 'the part’s notes stay off');
  assert.equal(entry.sections[0].minutes, 20, 'its time, for his item');
  assert.doesNotMatch(JSON.stringify(page), /SECRET/, 'nothing else of it anywhere on his page');
});

test('a presenter opens their own items’ documents on a meeting not shared yet, inside the same window, and nothing else of it', async () => {
  const { m, fBoard, fStaff, fAlex, fOther } = await presenting();
  assert.equal((await fileGet(SAM, fBoard)).status, 200, 'the document on his own item');
  for (const id of [fStaff, fAlex, fOther]) assert.equal((await fileGet(SAM, id)).status, 404, `${id}: not his to open`);
  for (const id of [fBoard, fAlex]) assert.equal((await fileGet(ALEX, id)).status, id === fAlex ? 200 : 404, `${id} for Alex`);
  // His own upload to his item opens too (as the page lists it with the item)
  const form = new FormData();
  form.set('file', new File([new TextEncoder().encode('%PDF-1.4\n% Sam\n')], 'sam-upload.pdf', { type: 'application/pdf' }));
  const up = await call(SAM, `/api/board-portal?attach=${m.id}&item=i_sam1`, { method: 'POST', form, handler: portal.onRequestPost });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal((await fileGet(SAM, up.body.file.id)).status, 200);
  // Outside the window the board page shows it to him in (more than two weeks ahead): nothing
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, date: inDays(30) }));
  assert.equal((await fileGet(SAM, fBoard)).status, 404);
});

// ─── Minutes ────────────────────────────────────────────────────────

test('the minutes can’t be approved, or the board told they’re up, for a meeting not held or with no minutes: said in words', async () => {
  const ahead = await meeting(7, { shared: false });
  for (const action of ['approve-minutes', 'send-minutes']) {
    const r = await adminApi({ action, id: ahead.id });
    assert.equal(r.status, 409, action);
    assert.equal(r.body.error, 'This meeting hasn’t happened yet, so it has no minutes to approve or send.');
  }
  const held = await meeting(-3);
  await agendaApproved(env.DB, held.id);
  await patchMeeting(env.DB, held.id, (cur) => ({ ...cur, shared: true }));
  for (const body of [{ action: 'approve-minutes', id: held.id }, { action: 'send-minutes', id: held.id }, { action: 'send-minutes', id: held.id, test: true }]) {
    const r = await adminApi(body);
    assert.equal(r.status, 409, JSON.stringify(body));
    assert.equal(r.body.error, 'This meeting’s minutes aren’t in Board yet. Drop them in first.');
  }
  assert.equal((await getMeeting(env.DB, held.id)).minutes, 'draft');
  assert.equal(resend.sent.length, 0, 'nobody was emailed');
  // With its minutes in: both go
  await patchMeeting(env.DB, held.id, (cur) => ({ ...cur, minutesFrom: { name: 'Minutes.pdf', at: new Date().toISOString() } }));
  assert.equal((await adminApi({ action: 'approve-minutes', id: held.id })).status, 200);
  assert.equal((await adminApi({ action: 'send-minutes', id: held.id })).status, 200);
});

// ─── Kept off the board page ────────────────────────────────────────

test('a shared meeting Board keeps off the board page (not a board meeting) is off it everywhere: lists, Home, files, to-dos, the screen and emails', async () => {
  const coffee = await meeting(6, { title: 'Coffee with a major donor', actions: [{ id: 'a_coffee01', text: 'Send the coffee notes', owner: 'alex-rivera', ownerName: 'Alex Rivera' }] });
  await patchMeeting(env.DB, coffee.id, (cur) => ({ ...cur, shared: true, notBoard: true }));
  const fCoffee = await file(coffee.id, 'f_coffee01');
  const page = (await portalGet(ALEX)).body;
  assert.ok(!page.meetings.some((m) => m.id === coffee.id), 'not in the meetings');
  assert.notEqual(page.next, coffee.id, 'not Home’s next');
  assert.ok(!page.actions.some((a) => a.id === 'a_coffee01'), 'its to-dos aren’t theirs to see');
  assert.doesNotMatch(JSON.stringify(page), /Coffee with a major donor/);
  assert.equal((await fileGet(ALEX, fCoffee)).status, 404, 'its files');
  assert.equal((await portalApi(ALEX, { action: 'action-done', actionId: 'a_coffee01', done: true })).status, 404, 'its to-do');
  assert.equal((await portalGet(ALEX, `?live=${coffee.id}`)).status, 404, 'its screen');
  assert.equal((await portalApi(ALEX, { action: 'correction', meetingId: coffee.id, target: 'motions', words: 'x' })).status, 404, 'its minutes, as before');
  const words = (await portalGet(ALEX, '?words')).body;
  assert.ok(!Object.keys(words.files || {}).includes(fCoffee), 'its files aren’t searched');
  // An email to the board about it would open nothing: refused in words
  const r = await adminApi({ action: 'send-packet', id: coffee.id });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'This meeting is kept off the board page (it isn’t a board meeting), so an email about it would open nothing for the board.');
  assert.equal(resend.sent.length, 0);
});

// ─── New since the last visit ───────────────────────────────────────

test('what’s new stays new while the member is on the page: a visit lasts until thirty minutes go by with no look', async () => {
  const member = { slug: 'alex-rivera', name: 'Alex Rivera', email: ALEX, title: 'Board Chair' };
  const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind('alex-rivera', threeDays).run();
  const t0 = Date.now();
  const look = async (min) => (await portalData(env, { member, now: t0 + min * 60_000 })).me.lastSeen;
  // Forty minutes on the page, a look every five (the page reads itself again on focus, a tab, the paper page's refresh)
  for (let min = 0; min <= 40; min += 5) assert.equal(await look(min), threeDays, `still the same visit at ${min} minutes`);
  // (QA round 3: one rule for a visit, Board → Members' sitting too: board-shared.js VISIT_GAP_MS, thirty minutes)
  assert.equal(await look(69), threeDays, 'twenty-nine minutes with no look: the same visit');
  // Thirty minutes and more with no look: the next visit, new since this one began
  assert.equal(await look(100), new Date(t0).toISOString());
  assert.equal(await look(105), new Date(t0).toISOString(), 'and that stays for the new visit');
});

// ─── The agenda email ───────────────────────────────────────────────

test('the agenda email names a guest presenter beside a board member presenting with them', () => {
  const people = [{ slug: 'sam-ortiz', name: 'Sam Ortiz' }, { slug: 'alex-rivera', name: 'Alex Rivera' }];
  const m = { date: inDays(5), start: '08:00', end: '10:00', sections: [{ id: 's_one', title: 'Reports', minutes: 0, items: [
    { id: 'i_fin', title: 'Financial', who: ['sam-ortiz'], guests: ['Dana Smith, CPA'], presenter: 'Sam Ortiz & Dana Smith, CPA' },
    { id: 'i_two', title: 'Programs', who: ['alex-rivera', 'sam-ortiz'], guests: [], presenter: 'Alex Rivera & Sam Ortiz' },
    { id: 'i_typ', title: 'Audit', who: [], guests: [], presenter: 'A&M Partners' },
    { id: 'i_gst', title: 'Gala', who: [], guests: ['Pat Example'], presenter: 'Pat Example' },
  ] }] };
  const by = agendaParts(m, people)[0].open.map((it) => it.by);
  assert.deepEqual(by, ['Sam Ortiz & Dana Smith, CPA', 'Alex Rivera & Sam Ortiz', 'A&M Partners', 'Pat Example']);
});

// ─── Failed sends, in words ─────────────────────────────────────────

test('a send that fails is said in words: never Resend’s code or a page of HTML, and whether it may have gone', async () => {
  const m = await meeting(5, { sections: [{ id: 's_r', title: 'Reports', items: [{ id: 'i_f', title: 'Financial', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] }] });
  await agendaApproved(env.DB, m.id);
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true }));
  resend.mode = '422';
  const refused = await adminApi({ action: 'send-packet', id: m.id });
  assert.equal(refused.body.error, 'Resend said no to these emails, so they didn’t go. Its reason: The from address domain is not verified.');
  resend.mode = '502';
  const gateway = await adminApi({ action: 'send-packet', id: m.id });
  assert.equal(gateway.body.error, 'Resend’s servers had trouble and didn’t say whether these emails went, so they may have gone. Press it again: Resend sends each one only if it hasn’t already.');
  // "Send me the email": no answer may have sent it too
  resend.mode = 'lost';
  const test1 = await adminApi({ action: 'send-packet', id: m.id, test: true });
  assert.equal(test1.body.error, 'Resend didn’t answer, so these emails may have gone. Look in your inbox before sending it again.');
  resend.mode = '502';
  const test2 = await adminApi({ action: 'remind-rsvp', id: m.id, test: true });
  assert.match(test2.body.error, /may have gone\. Look in your inbox before sending it again\.$/);
  for (const r of [refused, gateway, test1, test2]) {
    assert.doesNotMatch(JSON.stringify(r.body), /Resend \d{3}|<html|<\/|Network connection lost/, 'never the code, the HTML or the raw error');
    assert.doesNotMatch(r.body.error, /[–—]/);
  }
});

// ─── The to-do reminder's preview ───────────────────────────────────

test('the to-do reminder’s preview shows the real to-dos it would send, or says there are none', async () => {
  const none = await adminApi({ action: 'action-remind-preview' });
  assert.equal(none.body.ok, false);
  assert.equal(none.body.none, true);
  assert.equal(none.body.error, 'Nobody has an open to-do from a meeting on the board page, so there’s no reminder to show yet.');
  assert.equal(resend.sent.length, 0, 'nothing sent');
  // Sam has one, on a meeting on the board page (Jane, asking, has none): his, as it would go to him
  const m = await meeting(-2, { actions: [{ id: 'a_venue01', text: 'Send the venue contract', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(5) }] });
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true }));
  const r = await adminApi({ action: 'action-remind-preview' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.as, 'Sam Ortiz');
  const mail = resend.sent.at(-1);
  assert.equal(mail.to, FOUNDER, 'the preview goes to who asked');
  assert.match(mail.subject, /^\[Preview\] /);
  assert.match(mail.text, /Sam, you have a to-do from the board/);
  assert.match(mail.text, /Send the venue contract/);
  assert.doesNotMatch(mail.text, /Confirm the venue with the committee|Send the sponsor list/, 'never made-up ones');
});

// ─── Send the invite, from a second tab ─────────────────────────────

test('a second tab’s Send the invite, with nothing changed, never sends it again: it’s told it’s out; only a real change goes as an update', async () => {
  const m = await meeting(20, { location: 'Example Hall' });
  const a = await adminApi({ action: 'send-invite', id: m.id });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const writes = () => google.calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(writes().map((c) => [c.method, new URL(c.url).searchParams.get('sendUpdates')]), [['POST', 'all']]);
  // Tab B, never refreshed (it still has no invite), presses it
  google.calls = [];
  const b = await adminApi({ action: 'send-invite', id: m.id });
  assert.equal(b.status, 409);
  assert.equal(b.body.already, true);
  assert.equal(b.body.error, 'The invite is already out (sent a moment ago), with everything as it is now, so nobody was emailed again.');
  assert.ok(b.body.meeting?.invite?.sentAt, 'with the meeting as it is now');
  assert.deepEqual(writes(), [], 'Google wasn’t asked to email anyone');
  // A real change (the place) goes as an update, and Google emails the guests
  const now = await getMeeting(env.DB, m.id);
  await adminApi({ action: 'save-meeting', meeting: { ...now, location: 'Example Center' }, base: now.updatedAt });
  google.calls = [];
  assert.equal((await adminApi({ action: 'send-invite', id: m.id })).status, 200);
  assert.deepEqual(writes().map((c) => new URL(c.url).searchParams.get('sendUpdates')), ['all']);
  // Its name alone changed: it goes on the invite without emailing anyone
  const again = await getMeeting(env.DB, m.id);
  await adminApi({ action: 'save-meeting', meeting: { ...again, title: 'Annual Meeting' }, base: again.updatedAt });
  google.calls = [];
  assert.equal((await adminApi({ action: 'send-invite', id: m.id })).status, 200);
  assert.deepEqual(writes().map((c) => new URL(c.url).searchParams.get('sendUpdates')), ['none']);
});

// ─── Round two, after the merge: what the server fixes left to line up ────────

test('marked approved from an editor (Mark them approved) goes by the same rule as approve-minutes: never a meeting ahead, nor one with no minutes', async () => {
  const ahead = await meeting(9);
  const r = await adminApi({ action: 'save-meeting', meeting: { ...ahead, minutes: 'approved' }, base: ahead.updatedAt });
  assert.deepEqual([r.status, r.body.error], [409, 'This meeting hasn’t happened yet, so it has no minutes to approve or send.']);
  assert.equal((await getMeeting(env.DB, ahead.id)).minutes, 'draft');
  const held = await meeting(-3);
  const r2 = await adminApi({ action: 'save-meeting', meeting: { ...held, minutes: 'approved' }, base: held.updatedAt });
  assert.deepEqual([r2.status, r2.body.error], [409, 'This meeting’s minutes aren’t in Board yet. Drop them in first.']);
});

test('a meeting kept off the board page as "not a board meeting", shared by a person, is one again: on the board page, as its tag says', async () => {
  const m = await meeting(9);
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, notBoard: true, shared: false }));
  const cur = await getMeeting(env.DB, m.id);
  await agendaApproved(env.DB, m.id);
  const now = await getMeeting(env.DB, m.id);
  const r = await adminApi({ action: 'save-meeting', meeting: { ...now, shared: true }, base: now.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.meeting.shared, r.body.meeting.notBoard], [true, false]);
  assert.ok((await portalGet(ALEX)).body.meetings.some((x) => x.id === m.id), 'on the board page');
  assert.ok(cur.notBoard);
});

test('a one-tap answer link for a meeting kept off the board page answers nothing, as every list the board sees leaves it out', async () => {
  const { answerLink } = await import('../functions/api/_board-rsvp.js');
  const m = await meeting(9);
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true, notBoard: true }));
  // (a link as the emails carried them: 32 hex, kept by its hash)
  const tok = '0123456789abcdef'.repeat(2);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok))).toString('hex');
  await env.DB.prepare('INSERT INTO board_rsvp_links (hash, meeting_id, slug, expires) VALUES (?, ?, ?, ?)').bind(hash, m.id, 'alex-rivera', inDays(10)).run();
  assert.equal(await answerLink(env, tok), null, 'kept off the board page: nothing');
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, notBoard: false }));
  assert.equal((await answerLink(env, tok))?.meeting?.id, m.id, 'and once it is one, the link answers');
});
