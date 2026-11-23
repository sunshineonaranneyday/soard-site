/**
 * Board admin, QA round 3 (Nov 20 2026), the server's part and the shared rules: the agenda template saved only over the
 * one an editor opened (two tabs merge, never lose a change), settings saved at once never dropping either; a save the
 * site refuses for good names what it refuses, by the same rule Board offers Share by; a meeting still ahead lists the
 * board as People → Board has it now (a held one keeps its record), written down by the heartbeat; the to-do preview says
 * why no reminder can go; and "yesterday" is Atlanta's yesterday. Made-up people only.
 * Run: node --test tests/
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as board from '../functions/api/_board.js';
import * as shared from '../public/admin/board-shared.js';
import { ago } from '../public/admin/board-ui.js';
import { agendaApproved } from './lib/agenda-approved.mjs';

const { getMeeting, listMeetings, patchMeeting, ensureSchema, saveSettings, getSettings, holdUntilApproved } = board;
const { todayEastern, quorumFor, cleanMeeting } = shared;

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
const OTHER = 'holly@soardcharity.com';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['holly-doe', { name: 'Holly Doe', group: 'team', title: 'Co-Founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
  ['chris-okafor', { name: 'Chris Okafor', group: 'board', title: 'Board Member' }],
  ['ada-example', { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member' }],
];
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net']];
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let env;
let resend;
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
  resend = { sent: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      resend.sent.push(...list.map((m) => ({ to: [m.to].flat()[0], subject: m.subject, text: m.text })));
      return Response.json(Array.isArray(body) ? { data: list.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call(email, path, { method = 'GET', body = null, handler }) {
  const headers = { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' };
  if (body) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => handler(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : await res.text() };
}
const adminApi = (body, email = FOUNDER) => call(email, '/api/board-admin', { method: 'POST', body, handler: admin.onRequestPost });
/** A meeting made in Board (from the template, with the board as People has it then), `days` ahead */
async function meeting(days, fields = {}) {
  const m = (await adminApi({ action: 'new-meeting', date: inDays(days) })).body.meeting;
  if (!Object.keys(fields).length) return m;
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, ...fields }, base: m.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.meeting;
}
const person = (slug, group) => env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first()
  .then((row) => env.DB.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind(group, JSON.stringify({ ...JSON.parse(row.data), group }), slug).run());
/** Someone who's left: no longer active on People at all */
const leaves = (slug) => env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first()
  .then((row) => env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...JSON.parse(row.data), status: 'alumni' }), slug).run());
const boardOn = (m) => m.attendance.filter((p) => p.kind === 'board').map((p) => p.slug).sort();
const storedRoll = async (id) => cleanMeeting(JSON.parse((await env.DB.prepare('SELECT data FROM board_meetings WHERE id = ?').bind(id).first()).data)).attendance.filter((p) => p.kind === 'board').map((p) => p.slug).sort();
const titles = (t) => t.map((s) => `${s.title}: ${s.items.map((it) => it.title).join(' | ')}`);

// ─── MAJOR 2: the agenda template, from two tabs ────────────────────

test('the agenda template is saved only over the one an editor opened: a second tab is told, with theirs to merge, and loses nothing', async () => {
  const opened = await getSettings(env.DB);
  assert.equal(opened.templateAt, '', 'never saved: no time yet');
  // Every part and item has an id, the same for every tab that opens it (the default, never saved, numbered by place)
  assert.ok(opened.template.every((s) => s.id && s.items.every((it) => it.id)));
  assert.deepEqual((await getSettings(env.DB)).template.map((s) => s.id), opened.template.map((s) => s.id), 'the same ids each time it opens');
  // Tab A renames 1.1
  const mine = structuredClone(opened.template);
  mine[0].items[0].title = 'Roll call (A)';
  const a = await adminApi({ action: 'save-settings', settings: { template: mine }, base: opened.templateAt });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.settings.template[0].items[0].title, 'Roll call (A)');
  assert.ok(a.body.settings.templateAt > '', 'the time it was saved');
  assert.equal(a.body.settings.templateBy, FOUNDER);
  assert.deepEqual(a.body.settings.template.map((s) => s.id), opened.template.map((s) => s.id), 'its ids kept');
  // Tab B, opened before A saved, renames part 1: refused, with A's template to merge (never written over it)
  const theirs = structuredClone(opened.template);
  theirs[0].title = 'Call to order (B)';
  const b = await adminApi({ action: 'save-settings', settings: { template: theirs }, base: opened.templateAt }, OTHER);
  assert.equal(b.status, 409);
  assert.equal(b.body.current.template[0].items[0].title, 'Roll call (A)', 'A’s change comes back to merge');
  assert.equal(b.body.current.at, a.body.settings.templateAt);
  assert.equal(b.body.current.by, FOUNDER);
  assert.equal((await getSettings(env.DB)).template[0].items[0].title, 'Roll call (A)', 'nothing written over it');
  // Merged (both changes) and sent again on A's time: both kept
  const merged = structuredClone(b.body.current.template);
  merged[0].title = 'Call to order (B)';
  const again = await adminApi({ action: 'save-settings', settings: { template: merged }, base: b.body.current.at }, OTHER);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(titles(again.body.settings.template).slice(0, 1), ['Call to order (B): Roll call (A) | Welcome and introductions | Personal Best, Business Best, Sunshine Bragging Rights']);
  assert.ok(again.body.settings.templateAt > a.body.settings.templateAt);
  // A template saved before templates kept ids is numbered by place, the same in every tab
  await env.DB.prepare("UPDATE board_state SET data = ? WHERE key = 'settings'").bind(JSON.stringify({ template: [{ title: 'Old part', items: [{ title: 'Old item' }] }] })).run();
  const old = await getSettings(env.DB);
  assert.deepEqual([old.template[0].id, old.template[0].items[0].id], ['s_tpl0', 'i_tpl0_0']);
});

test('settings saved at the same moment never drop either one, and a save without the template needs no base', async () => {
  await Promise.all([
    saveSettings(env.DB, { quorum: 4 }, FOUNDER),
    saveSettings(env.DB, { actionRemind: 'on' }, FOUNDER),
    saveSettings(env.DB, { asks: 'on' }, OTHER),
    saveSettings(env.DB, { template: [{ title: 'Only part', items: [{ title: 'Only item' }] }] }, FOUNDER),
  ]);
  const s = await getSettings(env.DB);
  assert.equal(s.quorum, 4);
  assert.equal(s.actionRemind, 'on');
  assert.equal(s.asks, 'on');
  assert.deepEqual(titles(s.template), ['Only part: Only item']);
});

// ─── MAJOR 3: a save refused for good, by name ──────────────────────

test('Board offers Share by the rule the site holds it by: the day of the meeting waits for the approval, a held one never does', async () => {
  const today = todayEastern();
  const cases = [
    [{ date: inDays(0) }, true, 'today, not ended in Board'],
    [{ date: inDays(5) }, true, 'ahead'],
    [{ date: inDays(-1) }, false, 'its day gone'],
    [{ date: inDays(0), live: { endedAt: new Date().toISOString() } }, false, 'ended in Board'],
    [{ date: inDays(0), notBoard: true }, false, 'not a board meeting'],
    [{ date: inDays(0), practice: true }, false, 'a practice'],
  ];
  for (const [m, waits, why] of cases) {
    assert.equal(shared.waitsForApproval(m, today), waits, why);
    // (the site's own hold: refused exactly when Board says it waits)
    const refused = await holdUntilApproved(env.DB, { id: 'm_rule0001', ...m }).then(() => false, (err) => err.status === 409);
    assert.equal(refused, waits, `the site agrees: ${why}`);
  }
});

test('a save the site refuses for good names what it refuses, so the editor puts back only that and saves the rest', async () => {
  // Shared on the meeting's day before its agenda is approved
  const m = await meeting(0);
  const r = await adminApi({ action: 'save-meeting', meeting: { ...m, shared: true, title: 'Typed with it' }, base: m.updatedAt });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'The agenda goes to the board once it’s approved');
  assert.deepEqual(r.body.refused, ['shared']);
  assert.equal(r.body.current, undefined, 'a refusal, not someone else’s save to merge');
  // The rest, sent again without it, goes
  const rest = await adminApi({ action: 'save-meeting', meeting: { ...m, shared: false, title: 'Typed with it' }, base: m.updatedAt });
  assert.equal(rest.status, 200, JSON.stringify(rest.body));
  assert.equal(rest.body.meeting.title, 'Typed with it');
  // Approved, the same share goes
  await agendaApproved(env.DB, m.id);
  const shared = await adminApi({ action: 'save-meeting', meeting: { ...rest.body.meeting, shared: true }, base: rest.body.meeting.updatedAt });
  assert.equal(shared.status, 200, JSON.stringify(shared.body));
  assert.equal(shared.body.meeting.shared, true);
  // Minutes marked approved that aren't in Board
  const held = await meeting(-3);
  const approve = await adminApi({ action: 'save-meeting', meeting: { ...held, minutes: 'approved', approvedOn: inDays(0) }, base: held.updatedAt });
  assert.equal(approve.status, 409);
  assert.match(approve.body.error, /minutes aren’t in Board yet/);
  assert.deepEqual(approve.body.refused, ['minutes', 'approvedOn']);
  assert.equal((await getMeeting(env.DB, held.id)).minutes, 'draft');
});

// ─── MAJOR 5: who's on the board, for a meeting ahead ───────────────

test('a meeting still ahead lists the board as People → Board has it now; a held one keeps who was on it', async () => {
  const held = await meeting(-10);
  const ahead = await meeting(9);
  assert.deepEqual(boardOn(ahead), ['alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz', 'taylor-nguyen']);
  // Taylor leaves the board, Ada joins it
  await person('taylor-nguyen', 'alumni');
  await person('ada-example', 'board');
  const now = await getMeeting(env.DB, ahead.id);
  assert.deepEqual(boardOn(now), ['ada-example', 'alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz'], 'Ada on it, Taylor off it, at once');
  assert.equal(quorumFor(now), 3, 'a majority of the five on the board now');
  assert.deepEqual(boardOn((await listMeetings(env.DB)).find((x) => x.id === ahead.id)), boardOn(now), 'every list says the same');
  const page = await call(FOUNDER, '/api/board-admin', { handler: admin.onRequestGet });
  assert.deepEqual(boardOn(page.body.meetings.find((x) => x.id === ahead.id)), boardOn(now), 'Board’s own page too');
  // The held meeting keeps its record
  assert.deepEqual(boardOn(await getMeeting(env.DB, held.id)), ['alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz', 'taylor-nguyen']);
  // Someone marked stays on it, and People reading empty leaves the list as it is (a bad read)
  await patchMeeting(env.DB, ahead.id, (cur) => cur);
  await env.DB.prepare("UPDATE team SET \"group\" = 'alumni', data = json_set(data, '$.group', 'alumni')").run();
  assert.deepEqual(boardOn(await getMeeting(env.DB, ahead.id)), boardOn(now), 'nobody taken off by a list that reads empty');
});

test('the heartbeat writes the board of now onto each meeting still ahead, so the day it’s held its record is that day’s', async () => {
  const held = await meeting(-10);
  const ahead = await meeting(9);
  await person('taylor-nguyen', 'alumni');
  await person('ada-example', 'board');
  assert.deepEqual(await storedRoll(ahead.id), ['alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz', 'taylor-nguyen'], 'as it was made');
  assert.deepEqual(await board.maybeKeepRolls(env), [ahead.id]);
  assert.deepEqual(await storedRoll(ahead.id), ['ada-example', 'alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz']);
  assert.deepEqual(await storedRoll(held.id), ['alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz', 'taylor-nguyen'], 'a held one is never touched');
  assert.deepEqual(await board.maybeKeepRolls(env), [], 'nothing again once it’s written');
});

// ─── MINOR 4: the to-do preview, when no reminder can go ────────────

test('the to-do preview says why no reminder can go: whose they are and that they have no email, never that nobody has one', async () => {
  const m = await meeting(-2, { actions: [
    { id: 'a_kim00001', text: 'Book the venue', owner: 'kim-park', ownerName: 'Kim Park', due: inDays(5) },
    { id: 'a_chris001', text: 'Call the caterer', owner: 'chris-okafor', ownerName: 'Chris Okafor', due: inDays(6) },
  ] });
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: true }));
  const r = await adminApi({ action: 'action-remind-preview' });
  assert.equal(r.body.none, true);
  assert.equal(r.body.error, 'No reminder can go: the open to-dos are for Kim Park and Chris Okafor, who have no email on file. Add theirs in People → Board, and the reminder shows here.');
  assert.doesNotMatch(r.body.error, /Nobody has/);
  assert.equal(resend.sent.length, 0);
  // Someone who left the board is said as that
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, actions: [{ id: 'a_tay00001', text: 'Send the minutes', owner: 'taylor-nguyen', ownerName: 'Taylor Nguyen', due: inDays(5) }] }));
  await leaves('taylor-nguyen');
  assert.equal((await adminApi({ action: 'action-remind-preview' })).body.error, 'No reminder can go: the open to-do is for Taylor Nguyen, who isn’t on the board or staff now.');
  // Nobody's name on them
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, actions: [{ id: 'a_none0001', text: 'Find a sponsor', owner: '', ownerName: '', due: '' }] }));
  assert.equal((await adminApi({ action: 'action-remind-preview' })).body.error, 'No reminder goes: the open to-do has no one’s name on it.');
  // On a meeting not on the board page
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, shared: false, actions: [{ id: 'a_sam00001', text: 'Draft the budget', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(5) }] }));
  assert.equal((await adminApi({ action: 'action-remind-preview' })).body.error, 'No reminder goes yet: the open to-do is from a meeting not on the board page.');
});

// ─── MINOR 2: "yesterday" is Atlanta's ──────────────────────────────

test('how long ago counts Atlanta’s calendar days, never 24-hour blocks', () => {
  const realNow = Date.now;
  const at = (iso) => { Date.now = () => Date.parse(iso); };
  try {
    // 9 AM Nov 19 seen at 11 PM Nov 20 (Atlanta): the day before
    at('2026-11-21T04:00:00Z');
    assert.equal(ago('2026-11-19T14:00:00Z'), 'yesterday');
    // 11 PM Nov 18 seen at 1 AM Nov 20: two days back, though only 26 hours
    at('2026-11-20T06:00:00Z');
    assert.equal(ago('2026-11-19T04:00:00Z'), '2 days ago');
    // The tester's: approved 1:14 AM Nov 20, seen 11:22 PM Nov 21: yesterday, as "Approved Jane, Nov 20" beside it says
    at('2026-11-22T04:22:00Z');
    assert.equal(ago('2026-11-20T06:14:00Z'), 'yesterday');
    // Within the day: hours, as before
    at('2026-11-20T18:00:00Z');
    assert.equal(ago('2026-11-20T15:00:00Z'), '3 hr ago');
    // The day the clocks go back (Nov 1 2026 has 25 hours): 24 hours on is still that day, never "yesterday"
    at('2026-11-02T04:30:00Z');
    assert.equal(ago('2026-11-01T04:30:00Z'), '24 hr ago');
  } finally {
    Date.now = realNow;
  }
});

// ─── Board QA round 5 (Nov 21 2026): held is one rule for who was on the board ───

test('round 5: a meeting held this morning keeps the board it was held with; one still to come follows People → Board', async (t) => {
  const { holdClockAt } = await import('./lib/clock.mjs');
  // 3 pm in Atlanta, today
  t.after(holdClockAt(`${shared.todayEastern()}T20:00:00Z`));
  const morning = await meeting(0, { start: '08:00', end: '10:00' });
  // (Board makes one meeting a day: the one still to come is tomorrow's)
  const evening = await meeting(1, { start: '16:00', end: '18:00' });
  assert.equal(shared.meetingHeld(morning), true, 'its end time has passed: held');
  assert.equal(shared.meetingHeld(evening), false);
  await person('taylor-nguyen', 'alumni');
  await person('ada-example', 'board');
  assert.deepEqual(boardOn(await getMeeting(env.DB, morning.id)), ['alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz', 'taylor-nguyen'], 'the board it was held with: Taylor on it, Ada not');
  assert.deepEqual(boardOn(await getMeeting(env.DB, evening.id)), ['ada-example', 'alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz'], 'still ahead: the board as it is now');
  assert.deepEqual(await board.maybeKeepRolls(env), [evening.id], 'the heartbeat writes the board of now onto the one ahead only');
  assert.deepEqual(await storedRoll(morning.id), ['alex-rivera', 'chris-okafor', 'kim-park', 'sam-ortiz', 'taylor-nguyen']);
});
