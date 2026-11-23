/**
 * Board, QA round 3 (Nov 20 2026), the board page as members see it, the server's part: one rule for a visit to the
 * board page, kept going by what the member does on it. What's new since their last visit stays new while they read
 * one page for longer than the visit's gap (the page's tracker reports every minute; the page reads itself again only
 * when its tab comes back), an answer or the calendar file keeps it going too, the visit and Board → Members' sitting
 * end at the same gap, and an Advisory Board member's looks (kept here for their own page) are never a board visit.
 * Made-up people only (the repo is public).
 * Run: node --test tests/
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { portalData, ensureSchema } from '../functions/api/_board.js';
import { noteEvents, noteAnswer, noteLook, visitsOf } from '../functions/api/_board-activity.js';

const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
];
const ALEX = { slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex.board@example.com', title: 'Board Chair' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const MIN = 60_000;
// The one rule (public/admin/board-shared.js VISIT_GAP_MS), said here as the board would: thirty minutes
const GAP_MIN = 30;

let env;
beforeEach(async () => {
  env = { DB: await createD1() };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('alex-rivera', ALEX.email).run();
  await ensureSchema(env.DB);
});

const request = () => new Request('https://sunshineonaranneyday.com/api/board-portal', { method: 'POST', headers: { 'User-Agent': IPHONE } });
/** The board page read at `t` (a load, a reload, its tab coming back): what's new since */
const pageAt = async (t) => (await portalData(env, { member: ALEX, now: t })).me.lastSeen;
/** The tracker's report at `t`: one look at a page since `from`, its time so far (someone at it the whole while) */
const reportAt = (t, look, from, ref = 'gifts') => noteEvents(env, ALEX, request(), { events: [{ id: look, kind: 'view', ref, at: from, end: t, secs: Math.round((t - from) / 1000), touched: Math.round((t - from) / 1000) }], touch: false, now: t }, { now: t });
const visitStart = async () => (await env.DB.prepare('SELECT at FROM board_seen WHERE slug = ?').bind(ALEX.slug).first())?.at;

test('R3.1 what’s new stays new while a member reads one page past the gap: the tracker’s reports keep the visit going', async () => {
  const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind(ALEX.slug, threeDays).run();
  const t0 = Date.now() - 2 * 3600_000;
  assert.equal(await pageAt(t0), threeDays, 'the visit before this one');
  // Forty minutes on Financials' gifts, reading and scrolling: the page doesn't read itself again, its tracker reports
  // each minute
  for (let k = 1; k <= 40; k++) assert.equal((await reportAt(t0 + k * MIN, 'lookgifts01', t0)).kept, 1, `the report at ${k} minutes is kept`);
  // Over to the email tab and back a moment later: the page reads itself again, the same visit
  assert.equal(await pageAt(t0 + 41 * MIN), threeDays, 'back to the tab after forty minutes on the page: still new since three days ago');
  assert.equal(await visitStart(), new Date(t0).toISOString(), 'still the visit that began forty-one minutes ago');
  // Then nothing for longer than the gap: the next visit, new since the one that just ended began
  assert.equal(await pageAt(t0 + (41 + GAP_MIN + 1) * MIN), new Date(t0).toISOString());
});

test('R3.1 one rule for a visit: the page’s “new since” and Board → Members’ sittings both end at thirty minutes with nothing', async () => {
  const { VISIT_GAP_MS } = await import('../public/admin/board-shared.js');
  assert.equal(VISIT_GAP_MS, GAP_MIN * MIN, 'the one gap, in one place');
  const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind(ALEX.slug, threeDays).run();
  const t0 = Date.now() - 3 * 3600_000;
  const looks = [0, GAP_MIN - 1, 2 * GAP_MIN - 2];
  // Looks twenty-nine minutes apart: one visit, one sitting
  for (const m of looks) assert.equal(await pageAt(t0 + m * MIN), threeDays, `${m} minutes in: the same visit`);
  assert.equal(visitsOf(looks.map((m) => ({ at: t0 + m * MIN, until: t0 + m * MIN, secs: 0 }))).length, 1, 'one sitting on Board → Members');
  // Thirty-one minutes after the last: a new visit, and a second sitting
  const next = 2 * GAP_MIN - 2 + GAP_MIN + 1;
  assert.equal(await pageAt(t0 + next * MIN), new Date(t0).toISOString(), 'a new visit, new since the last began');
  assert.equal(visitsOf([...looks, next].map((m) => ({ at: t0 + m * MIN, until: t0 + m * MIN, secs: 0 }))).length, 2, 'two sittings on Board → Members');
});

test('R3.1 an answer and the calendar file keep the visit going; an admin’s look is never a member’s visit', async () => {
  const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind(ALEX.slug, threeDays).run();
  const t0 = Date.now() - 3 * 3600_000;
  assert.equal(await pageAt(t0), threeDays);
  // Writing their report for an hour: each save is an answer (the tracker would report too; here only the answers)
  for (let m = 20; m <= 60; m += 20) await noteAnswer(env, ALEX, request(), { kind: 'report', ref: 'm_example1', sub: 'i_example1' }, { now: t0 + m * MIN });
  await noteLook(env, ALEX, request(), 'calendar', 'm_example1', { now: t0 + 80 * MIN });
  assert.equal(await pageAt(t0 + 100 * MIN), threeDays, 'an hour and forty minutes in, twenty since the calendar file: the same visit');
  // Nobody's visit but a board member's: an admin looking keeps nothing of theirs, and an Advisory Board member's looks
  // on their own page (kept here too) are never a visit to the board page
  await noteEvents(env, null, request(), { events: [{ id: 'lookadmin01', kind: 'view', ref: 'home', at: t0, end: t0 + MIN, secs: 60 }], now: t0 + MIN }, { now: t0 + MIN });
  const ada = { kind: 'advisor', slug: 'ada-example', name: 'Ada Example', email: 'ada@example.com' };
  /* r9: Ada on People with her sign-in email, as every Advisory Board member is: a look is kept only at an address that's theirs */
  await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(ada.slug, ada.name, 'advisory', JSON.stringify({ name: ada.name, group: 'advisory', status: 'active' })).run();
  await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(ada.slug, ada.email).run();
  assert.equal((await noteEvents(env, ada, request(), { events: [{ id: 'lookadvis01', kind: 'view', ref: 'home', at: t0, end: t0 + 2 * MIN, secs: 120 }], now: t0 + 2 * MIN }, { now: t0 + 2 * MIN })).kept, 1, 'the Advisory Board member’s look is kept, for their own page');
  assert.deepEqual(((await env.DB.prepare('SELECT slug FROM board_seen').all()).results || []).map((r) => r.slug), ['alex-rivera']);
});

test('R3.1 a report sent again late, or one from a tab nobody was at, keeps nothing going', async () => {
  const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind(ALEX.slug, threeDays).run();
  const t0 = Date.now() - 3 * 3600_000;
  assert.equal(await pageAt(t0), threeDays);
  await reportAt(t0 + 5 * MIN, 'lookhome0001', t0, 'home');
  // An hour later the tab is back in front, nobody at it yet: a look with no time in it
  await noteEvents(env, ALEX, request(), { events: [{ id: 'lookhome0002', kind: 'view', ref: 'home', at: t0 + 65 * MIN, end: t0 + 65 * MIN, secs: 0 }], now: t0 + 65 * MIN }, { now: t0 + 65 * MIN });
  assert.equal(await visitStart(), new Date(t0).toISOString(), 'no time in it: no visit kept or begun');
  // The first report sent again an hour on (no connection then), ending where it did: it doesn't move the visit's last look
  const late = t0 + 65 * MIN;
  assert.equal((await noteEvents(env, ALEX, request(), { events: [{ id: 'lookhome0001', kind: 'view', ref: 'home', at: t0, end: t0 + 5 * MIN, secs: 300, touched: 300 }], now: late }, { now: late })).kept, 1);
  const row = await env.DB.prepare('SELECT at, last FROM board_seen WHERE slug = ?').bind(ALEX.slug).first();
  assert.equal(row.last, new Date(t0 + 5 * MIN).toISOString());
  // So the page read now, an hour on, begins the next visit
  assert.equal(await pageAt(t0 + 66 * MIN), new Date(t0).toISOString());
});
