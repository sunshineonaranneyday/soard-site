/**
 * One Advisory Board member's sign-in email, sent from their row on Members (Peter, Nov 18 2026: "yes add it, works
 * with switch off"): through /api/advisory-admin as whoever runs the group presses it. As Board's: never to someone who
 * has signed in, never twice within ten minutes, and only once the sign-in knows their address.
 * Run: node --test tests/
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { ensureAdvisory, saveSettings } from '../functions/api/_advisory.js';
import { readState, writeState } from '../functions/api/_board-roles.js';
import { sendWelcomeTo, sendWelcome, queueWelcome, sendWaitingWelcomes, AGAIN_MS } from '../functions/api/_advisory-mail.js';
import { onRequestGet, onRequestPost } from '../functions/api/advisory-admin.js';

const PEOPLE = [
  ['ada-advisor', { name: 'Ada Advisor', group: 'advisory' }, 'ada@private.example'],
  ['ben-advisor', { name: 'Ben Advisor', group: 'advisory' }, 'ben@private.example'],
  ['dee-draft', { name: 'Dee Draft', group: 'advisory', publishStatus: 'draft' }, 'dee@private.example'],
  ['old-advisor', { name: 'Old Advisor', group: 'advisory', status: 'alumni' }, 'old@private.example'],
  ['mary-atchley', { name: 'Mary Atchley', group: 'board', committees: ['Advisory Board'] }, 'mary@private.example'],
  ['travis-couick', { name: 'Travis Couick', group: 'board', committees: ['Advisory Board'] }, 'travis@private.example'],
];
const MARY = { slug: 'mary-atchley', name: 'Mary Atchley', email: 'mary@private.example', committees: ['Advisory Board'] };
const TRAVIS = { slug: 'travis-couick', name: 'Travis Couick', email: 'travis@private.example', committees: ['Advisory Board'] };

let env;
let sent;
let access;
let resendDown;
let resendSilent; // no answer at all (a timeout, a dropped connection): 'throw', or a gateway's status (503)
const realFetch = globalThis.fetch;

/** Cloudflare Access, faked: the group the site keeps, its policy, the admin's app using it. down: refuses */
function fakeAccess() {
  const st = { groups: [], policies: [], down: false };
  env.CF_ACCESS_API_TOKEN = 'access-token';
  env.CF_ACCESS_AUD = 'aud-admin';
  st.route = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = url.pathname.replace('/client/v4/accounts/acct', '');
    const ok = (result) => Response.json({ success: true, result });
    if (st.down) return Response.json({ success: false, errors: [{ message: 'Access is down' }] }, { status: 500 });
    if (path === '/access/groups' && method === 'GET') return ok(st.groups);
    if (path === '/access/groups' && method === 'POST') { const g = { id: 'g1', ...JSON.parse(init.body) }; st.groups.push(g); return ok(g); }
    if (path === '/access/groups/g1' && method === 'GET') return ok(st.groups[0]);
    if (path === '/access/groups/g1' && method === 'PUT') { Object.assign(st.groups[0], JSON.parse(init.body)); return ok(st.groups[0]); }
    if (path === '/access/policies' && method === 'GET') return ok(st.policies);
    if (path === '/access/policies' && method === 'POST') { const p = { id: 'p1', ...JSON.parse(init.body) }; st.policies.push(p); return ok(p); }
    if (path === '/access/apps' && method === 'GET') return ok([{ aud: 'aud-admin', name: 'SOARD admin', policies: st.policies.map((p) => ({ id: p.id })) }]);
    throw new Error(`no Access route ${method} ${path}`);
  };
  return st;
}
const inGroup = () => (access.groups[0]?.include || []).map((r) => r.email?.email);

beforeEach(async () => {
  env = { DB: await createD1(), RESEND_API_KEY: 'resend', CF_ACCOUNT_ID: 'acct' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  await env.DB.exec('CREATE TABLE board_signins (slug TEXT NOT NULL, iat INTEGER NOT NULL, at TEXT NOT NULL, device TEXT, added TEXT, PRIMARY KEY (slug, iat))');
  // (what else Members reads, as the site has it)
  await env.DB.exec('CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, status TEXT, featured INTEGER, child_count INTEGER, room_count INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE partners (slug TEXT PRIMARY KEY, name TEXT, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT NOT NULL)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
  for (const [slug, d, email] of PEOPLE) {
    await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ status: 'active', ...d })).run();
    await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  }
  await ensureAdvisory(env.DB);
  await saveSettings(env.DB, { lead: 'mary-atchley', emails: false });
  sent = [];
  resendDown = false;
  resendSilent = null;
  access = fakeAccess();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'api.resend.com') {
      if (resendSilent === 'throw') { sent.push(...[JSON.parse(init.body)].flat()); throw new Error('The operation was aborted due to timeout'); }
      if (resendSilent) { sent.push(...[JSON.parse(init.body)].flat()); return new Response('Bad gateway', { status: resendSilent }); }
      if (resendDown) return Response.json({ message: 'down' }, { status: 422 }); /* r26: Resend's own no is a 4xx (a 5xx now leaves the welcome owed under its key, Advisory Board QA round 26) */
      const batch = [JSON.parse(init.body)].flat();
      sent.push(...batch);
      return Response.json({ data: batch.map((_, i) => ({ id: `em${i}` })) });
    }
    if (url.host === 'api.cloudflare.com' && url.pathname.startsWith('/client/v4/accounts/acct/access/')) return access.route(url, init);
    throw new Error(`no route for ${url.href}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const as = (data) => ({ env, data, request: null, waitUntil: () => {} });
const press = async (slug, who = { boardMember: MARY }) => {
  const res = await onRequestPost({ ...as(who), request: new Request('https://x/api/advisory-admin', { method: 'POST', body: JSON.stringify({ action: 'send-welcome-to', slug }) }) });
  return { status: res.status, ...(await res.json()) };
};
const look = async () => {
  const j = await (await onRequestGet({ ...as({ boardMember: MARY }), request: new Request('https://x/api/advisory-admin') })).json();
  assert.equal(j.ok, true, j.error);
  return j;
};
const rowOf = async (slug) => (await look()).advisors.find((a) => a.slug === slug);
const welcomes = () => sent.filter((e) => e.subject === 'Your Advisory Board page is ready');
const record = async (slug) => (await readState(env.DB, 'advisory-mail')).welcomed?.[slug];

test('with the Advisory Board’s emails off, a press on their row sends their sign-in email, once the sign-in list has them', async () => {
  assert.equal((await rowOf('ada-advisor')).welcome.at, undefined);
  const r = await press('ada-advisor');
  assert.equal(r.ok, true);
  assert.equal(r.sent, 1);
  assert.equal(r.again, false);
  assert.ok(inGroup().includes('ada@private.example'), 'the sign-in list was brought up to date before it went');
  assert.deepEqual(welcomes().map((e) => [e.to].flat()[0]), ['ada@private.example']);
  // (r20: "Ada Advisor" ends in an office word, "Advisor", so no name in the welcome's heading)
  assert.match(welcomes()[0].html, /Welcome to the Advisory Board/);
  assert.deepEqual([welcomes()[0].reply_to].flat(), ['mary@private.example'], 'replies reach whoever runs the group');
  // The row says when it went, and the record is had at her address
  const row = await rowOf('ada-advisor');
  assert.equal(row.welcome.at, r.at);
  assert.equal((await record('ada-advisor')).to, 'ada@private.example');
  // Nobody else was emailed, and the switch is still off
  assert.equal(welcomes().length, 1);
  assert.equal((await look()).settings.emails, false);
  // "What's gone out" names her, and the audit log has it
  assert.equal((await look()).mail[0].what, 'Your page is ready, to Ada Advisor');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_name LIKE '%sign-in email sent%'").first()).n, 1);
});

test('the switch still holds what the site sends by itself: Send the sign-in email to everyone stays off', async () => {
  const r = await onRequestPost({ ...as({ boardMember: MARY }), request: new Request('https://x/api/advisory-admin', { method: 'POST', body: JSON.stringify({ action: 'send-welcome', slugs: ['ada-advisor', 'ben-advisor'] }) }) });
  assert.deepEqual(await r.json(), { ok: true, off: true, sent: 0, said: 'Nothing went out: emails are off.' }); /* r26: the group's words come from the server's facts (welcomesSaid) */
  assert.equal(welcomes().length, 0);
});

test('Send it again: not within ten minutes of the last one (pressed twice, two tabs), then it goes again', async () => {
  const t0 = Date.now();
  assert.equal((await press('ada-advisor')).sent, 1);
  const twice = await press('ada-advisor');
  assert.equal(twice.sent, undefined);
  assert.equal(twice.tooSoon, true);
  assert.equal(welcomes().length, 1, 'not emailed twice');
  // Nine minutes on: still held
  assert.equal((await sendWelcomeTo(env, 'ada-advisor', { now: t0 + 9 * 60 * 1000 })).tooSoon, true);
  assert.equal(welcomes().length, 1);
  // Ten minutes on: it goes again, and the row's date is the new one
  const later = t0 + AGAIN_MS + 1000;
  const again = await sendWelcomeTo(env, 'ada-advisor', { now: later });
  assert.deepEqual(again, { sent: 1, again: true, at: new Date(later).toISOString() });
  assert.equal(welcomes().length, 2);
  assert.equal((await record('ada-advisor')).at, new Date(later).toISOString());
});

test('never to someone who has signed in already', async () => {
  await env.DB.prepare('INSERT INTO board_signins (slug, iat, at) VALUES (?, ?, ?)').bind('ben-advisor', 1, '2026-11-10T15:00:00.000Z').run();
  const r = await press('ben-advisor');
  assert.equal(r.signedIn, true);
  assert.equal(welcomes().length, 0);
  assert.equal((await rowOf('ben-advisor')).lastSeen, '2026-11-10T15:00:00.000Z');
});

test('an email that can’t be their sign-in is never sent to: none, a SOARD address, a group inbox, half an address', async () => {
  await env.DB.prepare('DELETE FROM reveal_board_emails WHERE slug = ?').bind('ada-advisor').run();
  assert.deepEqual(await press('ada-advisor'), { status: 200, ok: true, noEmail: true, why: 'none' });
  assert.equal((await rowOf('ada-advisor')).emailWhy, 'none');
  for (const [email, why] of [['holly@soardcharity.com', 'staff'], ['advisory@soardcharity.com', 'group'], ['ada@gmail', 'bad']]) {
    await env.DB.prepare('INSERT OR REPLACE INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('ada-advisor', email).run();
    const r = await press('ada-advisor');
    assert.equal(r.noEmail, true, email);
    assert.equal(r.why, why, email);
    assert.equal((await rowOf('ada-advisor')).emailWhy, why, email);
  }
  assert.equal(welcomes().length, 0);
  assert.equal((await rowOf('ben-advisor')).emailWhy, '', 'a member’s own address can be their sign-in');
});

test('it waits for the sign-in to know them: Cloudflare not answering, or the sign-in not set up, sends nothing', async () => {
  access.down = true;
  const r = await press('ada-advisor');
  assert.deepEqual({ notReady: r.notReady, why: r.why }, { notReady: true, why: 'sign-in' });
  assert.equal(welcomes().length, 0);
  assert.equal(await record('ada-advisor'), undefined, 'not marked as had');
  // No Access key at all: the sign-in isn't set up
  delete env.CF_ACCESS_API_TOKEN;
  const r2 = await press('ada-advisor');
  assert.deepEqual({ notReady: r2.notReady, why: r2.why }, { notReady: true, why: 'setup' });
  // Back: it goes
  env.CF_ACCESS_API_TOKEN = 'access-token';
  access.down = false;
  assert.equal((await press('ada-advisor')).sent, 1);
});

test('a send the email service turns down is not counted: the first can be pressed again at once, and Send it again keeps the earlier date', async () => {
  resendDown = true;
  const r = await press('ada-advisor');
  assert.equal(r.refused, 1); /* r26: Resend's own no is said as a refusal */
  assert.equal(await record('ada-advisor'), undefined);
  assert.equal((await rowOf('ada-advisor')).welcome.at, undefined, 'the row still offers Send the sign-in email');
  resendDown = false;
  const t0 = Date.now();
  assert.equal((await press('ada-advisor')).sent, 1);
  const first = (await record('ada-advisor')).at;
  resendDown = true;
  assert.equal((await sendWelcomeTo(env, 'ada-advisor', { now: t0 + AGAIN_MS + 1000 })).refused, 1); /* r26: said as a refusal */
  assert.equal((await record('ada-advisor')).at, first, 'still had it, on the day it really went');
  assert.equal((await rowOf('ada-advisor')).welcome.at, first);
});

test('one already on its way (Add, the heartbeat, another tab) is never sent beside it', async () => {
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'ada-advisor': { sending: new Date().toISOString() } } });
  assert.equal((await press('ada-advisor')).going, true);
  assert.equal((await rowOf('ada-advisor')).welcome.going, true);
  assert.equal(welcomes().length, 0);
  // A claim a dead request left (over ten minutes old) doesn't hold it up
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'ada-advisor': { sending: new Date(Date.now() - 11 * 60 * 1000).toISOString() } } });
  assert.equal((await rowOf('ada-advisor')).welcome.going, undefined);
  assert.equal((await press('ada-advisor')).sent, 1);
});

test('one waiting for the switch (Add with emails off) goes from the row with the name they asked for, and isn’t sent again when the switch goes on', async () => {
  await queueWelcome(env.DB, 'dee-draft', { by: 'peter@soardcharity.com', greet: 'Deedee' });
  const r = await press('dee-draft');
  assert.equal(r.sent, 1);
  assert.match(welcomes()[0].html, /Welcome, Deedee/);
  assert.equal((await readState(env.DB, 'advisory-mail')).waiting?.['dee-draft'], undefined, 'no longer waiting');
  await saveSettings(env.DB, { emails: true });
  await sendWaitingWelcomes(env);
  await sendWelcome(env, { slugs: ['dee-draft'] });
  assert.equal(welcomes().length, 1, 'turning the switch on sends her nothing more');
});

test('only whoever runs the group can press it; someone not on the Advisory Board is never sent it', async () => {
  const travis = await press('ada-advisor', { boardMember: TRAVIS });
  assert.equal(travis.status, 403);
  const ada = await press('ben-advisor', { advisor: { slug: 'ada-advisor', name: 'Ada Advisor', email: 'ada@private.example' } });
  assert.equal(ada.status, 403);
  assert.equal((await press('old-advisor')).gone, true, 'moved to alumni');
  assert.equal((await press('mary-atchley')).gone, true, 'a board member');
  assert.equal((await press('nobody')).gone, true);
  assert.equal(welcomes().length, 0);
});

test('a hidden member (Add makes them hidden) is sent theirs like anyone on the Advisory Board', async () => {
  assert.equal((await press('dee-draft')).sent, 1);
  assert.deepEqual(welcomes().map((e) => [e.to].flat()[0]), ['dee@private.example']);
});

/* r26: no answer that says either way (a timeout, a gateway's 503) is no longer counted as sent: it stays owed, written
 * down with its key, and the heartbeat (or a second press) asks Resend again under that same key, which never sends a
 * second (Advisory Board QA round 26). Resend is faked here as it is: the same key again sends nothing new */
test('no answer from the email service (a timeout, a gateway’s 503) is owed, never counted as sent: the heartbeat sends it with the switch off, and a second press or the switch never sends a second copy', async () => {
  const keyed = globalThis.fetch;
  const keys = new Set();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = init.headers?.['Idempotency-Key'];
    if (url.host === 'api.resend.com' && key && keys.has(key)) return Response.json({ data: [{ id: 'again' }] });
    // (kept as Resend takes it: one whose answer was lost, or a gateway's 503 in front of it, went all the same here)
    if (url.host === 'api.resend.com' && key && !resendDown) keys.add(key);
    return keyed(input, init);
  };
  for (const silent of ['throw', 503]) {
    sent = [];
    keys.clear();
    await writeState(env.DB, 'advisory-mail', {});
    await saveSettings(env.DB, { emails: false });
    resendSilent = silent;
    const r = await press('ada-advisor');
    assert.equal(r.owed, 1, String(silent));
    assert.equal(r.sent, undefined, String(silent));
    assert.equal(await record('ada-advisor'), undefined, 'not marked had');
    assert.deepEqual((await rowOf('ada-advisor')).welcome, { owed: true }, 'the row: goes in a few minutes, never "going out now"');
    resendSilent = null;
    // (a person's press: the heartbeat sends it with the switch off, as the press would have)
    await sendWaitingWelcomes(env);
    assert.equal(welcomes().length, 1, `the one that may have gone, once (${silent})`);
    assert.ok((await record('ada-advisor')).at, 'marked had');
    assert.equal((await press('ada-advisor')).tooSoon, true, 'pressed again at once: held');
    await saveSettings(env.DB, { emails: true });
    await sendWelcome(env, { slugs: ['ada-advisor'] });
    await sendWaitingWelcomes(env);
    assert.equal(welcomes().length, 1, `still once (${silent})`);
  }
  globalThis.fetch = keyed;
  // Resend's own refusal is a sure no: not counted
  sent = [];
  await writeState(env.DB, 'advisory-mail', {});
  resendDown = true;
  assert.equal((await press('ben-advisor')).refused, 1); /* r26: said as a refusal */
  assert.equal(await record('ben-advisor'), undefined);
});

test('Send it again that dies partway (the tab closed mid-send) leaves them had, with the earlier date: nothing sends it by itself, and the row can send it again', async () => {
  const earlier = '2026-11-01T12:00:00.000Z';
  // The claim an "again" leaves while it goes: when the last one went, kept
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'ada-advisor': { at: earlier, to: 'ada@private.example', sending: new Date().toISOString() } } });
  assert.deepEqual((await rowOf('ada-advisor')).welcome, { going: true });
  assert.equal((await press('ada-advisor')).going, true);
  // Eleven minutes later the request is long dead: had it, on the earlier date
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'ada-advisor': { at: earlier, to: 'ada@private.example', sending: new Date(Date.now() - 11 * 60 * 1000).toISOString() } } });
  assert.deepEqual((await rowOf('ada-advisor')).welcome, { at: earlier });
  assert.equal((await look()).welcomed['ada-advisor'], true, 'the send-to-everyone button leaves her out');
  await saveSettings(env.DB, { emails: true });
  await queueWelcome(env.DB, 'ada-advisor');
  await sendWelcome(env, { slugs: ['ada-advisor'] });
  await sendWaitingWelcomes(env);
  assert.equal(welcomes().length, 0, 'nothing sent her it by itself');
  // A person's press sends it again
  const r = await press('ada-advisor');
  assert.equal(r.sent, 1);
  assert.equal(r.again, true);
  assert.equal(welcomes().length, 1);
});

test('Send it again, claimed: the earlier date rides along while it goes, and a failure leaves it as it was', async () => {
  const t0 = Date.now();
  assert.equal((await press('ada-advisor')).sent, 1);
  const first = (await record('ada-advisor')).at;
  let seen = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (new URL(typeof input === 'string' ? input : input.url).host === 'api.resend.com') seen = await record('ada-advisor');
    return real(input, init);
  };
  resendDown = true;
  assert.equal((await sendWelcomeTo(env, 'ada-advisor', { now: t0 + AGAIN_MS + 1000 })).refused, 1); /* r26: said as a refusal */
  assert.equal(seen.at, first, 'while it went, her record still said when the last one went');
  assert.ok(seen.sending);
  assert.deepEqual(await record('ada-advisor'), { at: first, to: 'ada@private.example', via: 'run-it' }); /* r27: a sign-in email kept with where it went from (Run it), so Add's refusal can say so */
});

test('the row’s light look gives each member’s sign-in email alone', async () => {
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'ada-advisor': { sending: new Date().toISOString() }, 'ben-advisor': { at: '2026-11-02T12:00:00.000Z', to: 'ben@private.example' } } });
  const res = await onRequestGet({ ...as({ boardMember: MARY }), request: new Request('https://x/api/advisory-admin?welcomes=1') });
  const j = await res.json();
  assert.deepEqual(j, { ok: true, welcomes: { 'ada-advisor': { going: true }, 'ben-advisor': { at: '2026-11-02T12:00:00.000Z' }, 'dee-draft': {} } });
  const refused = await onRequestGet({ ...as({ boardMember: TRAVIS }), request: new Request('https://x/api/advisory-admin?welcomes=1') });
  assert.equal(refused.status, 403);
});
