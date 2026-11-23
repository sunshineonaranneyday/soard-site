/**
 * Board QA round 7 (Nov 21 2026), the board page as members see it: the rules under what they saw.
 *   m2  The Makeovers map: the families with no home in JobTread are named by stage beside the key, as the makeovers with
 *       no application are, so the key and the line over the map add up stage by stage (board/family-map.js
 *       byStageWords, awayLine)
 *   m3  A makeover with no application in Board is in the season it belongs to, from what's known about it: its kid
 *       page's year, else the year in its JobTread name, else its reveal's (_board-families.js makeoverSeason,
 *       familiesList; board/lifecycle.js itemsOf, inSeason), and the words say only that ("no application in Board")
 *   m4  The chair's review link with the review off says so for every meeting ahead, not the next alone (_board-asks.js
 *       reviewShutFor, through portalExtras' reviewShut: `later`)
 *   m7  Rounded parts add up to the total said beside them, by the largest remainder (board/money.js partsAddingUp,
 *       moneyTiles' cash)
 * The screen's statements on a phone, the reveal tags, the map's keyboard order, the search for amounts and the review
 * page itself are checked in a browser: scripts/test-board-round7-member.mjs. Made-up people only (the repo is public).
 * Run: node --test tests/board-round7-member.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { saveMeeting, listMeetings, ensureSchema } from '../functions/api/_board.js';
import * as boardAsks from '../functions/api/_board-asks.js';
import * as boardFamilies from '../functions/api/_board-families.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { agendaApproved } from './lib/agenda-approved.mjs';
import { todayEastern } from '../public/admin/board-shared.js';
import * as familyMap from '../public/admin/board/family-map.js';
import * as money from '../public/admin/board/money.js';
import { STAGE_SCHEME, sumLine, itemsOf, inSeason } from '../public/admin/board/lifecycle.js';
import { keyOf } from '../public/admin/board/stages.js';

// (each looked up when its test runs, so on code from before these rules a test fails, never the whole file)
const need = (mod, name) => { assert.equal(typeof mod[name], 'function', `no ${name}`); return mod[name]; };

const TODAY = todayEastern();
const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const Y0 = Number(TODAY.slice(0, 4));

// ─── m2 ───
test('m2: the families with no home in JobTread named by stage: the key, they and the makeovers with no pin add up to the line', () => {
  const byStageWords = need(familyMap, 'byStageWords');
  const pin = { lat: 34, lng: -84 };
  // On the map: one applied, one in review, one approved, one being built; no home in JobTread yet: one in review, one
  // approved; no application (so no pin): two being built, one awaiting funding
  const pinned = [{ id: 'a1', stage: 'applied', ...pin }, { id: 'a2', stage: 'review', ...pin }, { id: 'a3', stage: 'approved', ...pin }, { id: 'a4', stage: 'build', ...pin }];
  const noHome = [{ id: 'n1', stage: 'review' }, { id: 'n2', stage: 'approved' }];
  const away = [{ id: 'job-j2', stage: 'design' }, { id: 'job-j3', stage: 'funding' }, { id: 'job-j4', stage: 'mobilization' }];
  assert.equal(byStageWords(noHome, STAGE_SCHEME), '1 in review, 1 approved', 'in the key’s own words and order');
  assert.equal(byStageWords(away, STAGE_SCHEME), '1 awaiting funding, 2 building');
  assert.equal(byStageWords([], STAGE_SCHEME), '');
  // The key (the pins), the no-home note and the away note, stage by stage, are the line's counts
  const key = {};
  for (const f of pinned) key[keyOf(f)] = (key[keyOf(f)] || 0) + 1;
  const said = (words) => Object.fromEntries(words.split(', ').filter(Boolean).map((x) => { const [n, ...w] = x.split(' '); return [w.join(' '), Number(n)]; }));
  const home = said(byStageWords(noHome, STAGE_SCHEME));
  const off = said(byStageWords(away, STAGE_SCHEME));
  const sum = sumLine([...pinned, ...noHome, ...away], 'now', null);
  const n = (re) => Number((sum.match(re) || [])[1] || 0);
  const all = (k, word) => (key[k] || 0) + (home[word] || 0) + (off[word] || 0);
  assert.equal(all('applied', 'applied') + all('review', 'in review'), n(/(\d+) famil(?:y|ies) applying/), sum);
  assert.equal(all('approved', 'approved'), n(/(\d+) approved/), sum);
  assert.equal(all('funding', 'awaiting funding'), n(/(\d+) awaiting funding/), sum);
  assert.equal(all('building', 'building'), n(/(\d+) makeovers? being built/), sum);
});

// ─── m3 ───
test('m3: a makeover with no application: its season from its kid page’s year, else its JobTread name’s, else its reveal’s', () => {
  const makeoverSeason = need(boardFamilies, 'makeoverSeason');
  const pages = new Map([['leo-2026', { year: 2026 }], ['ivy', { year: null }]]);
  const reveals = [{ slug: 'ivy', confirmed: true, date: '2027-01-15' }, { slug: 'oak', confirmed: false, window: { month: '2026-12', label: 'mid December' } }];
  assert.equal(makeoverSeason({ slug: 'leo-2026', year: 2025 }, { pages, reveals }), '2026', 'its kid page’s year first');
  assert.equal(makeoverSeason({ slug: null, year: 2026 }, { pages, reveals }), '2026', 'else the year in its JobTread name');
  assert.equal(makeoverSeason({ slug: 'ivy' }, { pages, reveals }), '2027', 'else its reveal’s day');
  assert.equal(makeoverSeason({ slug: 'oak' }, { pages, reveals }), '2026', 'or the month it’s planned for');
  assert.equal(makeoverSeason({ slug: null }, { pages, reveals }), '', 'nothing known: no season, never a guess');
});

test('m3: the families list gives each makeover with no application its season; the page keeps it, and the season shows it', async () => {
  const DB = await createD1();
  await ensureApplicantSchema(DB);
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, jt_account_id TEXT, lang TEXT, jt_state TEXT, files TEXT, is_test INTEGER DEFAULT 0, submitted_at TEXT, kind TEXT, deleted_at TEXT)',
    'CREATE TABLE IF NOT EXISTS kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)',
    'CREATE TABLE IF NOT EXISTS community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
    'CREATE TABLE IF NOT EXISTS site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  ]) await DB.exec(sql);
  // Maya's family applied (her makeover being built); Leo's makeover has no application, his kid page says this year
  await DB.prepare(`INSERT INTO applicants (account_id, name, status, year, types, fields, contacts, synced_at, job_id) VALUES (?, ?, ?, ?, '["Bedroom"]', '{}', '[]', ?, ?)`).bind('acctMaya01', 'Maya Example', 'Approved', String(Y0), new Date().toISOString(), 'jMaya').run();
  await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(`leo-${Y0}`, 'Leo', Y0, JSON.stringify({ name: 'Leo', year: Y0 })).run();
  const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
  const was = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) !== 'https://api.jobtread.com/pave') throw new Error(`unexpected ${input}`);
    return Response.json({ organization: { jobs: { nodes: [JOB('jMaya', `Maya (${Y0})`, 'Build'), JOB('jLeo', `Leo (${Y0})`, 'Design')], nextPage: null } } });
  };
  try {
    const env = { DB, JOBTREAD_GRANT_KEY: 'jt' };
    const fam = await boardFamilies.familiesList(env);
    const leo = fam.makeovers.find((m) => m.jobId === 'jLeo');
    assert.ok(leo, JSON.stringify(fam.makeovers));
    assert.equal(leo.season, String(Y0), 'Leo’s makeover is in its season');
    // The page: Leo with Maya in this season, the line counting both as being built
    const projects = { building: [{ jobId: 'jMaya', name: 'Maya', slug: null, status: 'Build' }, { jobId: 'jLeo', name: 'Leo', slug: `leo-${Y0}`, status: 'Design' }], waiting: [] };
    const all = itemsOf(fam, projects);
    const season = inSeason(all, String(Y0), fam.application);
    assert.deepEqual(season.map((x) => x.card?.name || x.name).sort(), ['Leo', 'Maya'], JSON.stringify(all.map((x) => [x.id, x.season])));
    assert.equal(sumLine(season, String(Y0), null), '2 makeovers being built');
  } finally { globalThis.fetch = was; }
});

test('m3: the makeovers with no pin are said to have no application in Board, never to be “from before the applications”', () => {
  const awayLine = need(familyMap, 'awayLine');
  const away = [{ id: 'job-j2', stage: 'design' }, { id: 'job-j3', stage: 'funding' }];
  assert.equal(awayLine(away, STAGE_SCHEME), '2 more makeovers aren’t on the map (1 awaiting funding, 1 building): no application in Board for them, so no address');
  assert.equal(awayLine([away[0]], STAGE_SCHEME), '1 more makeover isn’t on the map (1 building): no application in Board for it, so no address');
});

// ─── m4 ───
let env;
const AGENDA = [{ id: 's_open', title: 'Call to order', items: [{ id: 'i_roll', title: 'Roll call' }] }];
const ALEX = { slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex.board@example.com', seat: 'chair' };
const meeting = (id, date, more = {}) => saveMeeting(env.DB, { id, date, start: '08:00', end: '10:00', shared: false, sections: AGENDA, agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() }, ...more }, { by: 'jane@soardcharity.com' });
beforeEach(async () => {
  env = { DB: await createD1() };
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  ]) await env.DB.exec(sql);
  for (const [slug, d] of [['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }], ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }]]) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  await ensureSchema(env.DB);
  // The review not on for the chair (Board → Settings has the asks in test)
  await env.DB.exec('CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.prepare('INSERT OR REPLACE INTO board_state (key, data) VALUES (?, ?)').bind('settings', JSON.stringify({ asks: 'test' })).run();
});
afterEach(() => { env = null; });

test('m4: the review off: every meeting ahead is said to be off, the meeting after next too, not the next alone', async () => {
  await meeting('m_r7next1', day(9));
  await meeting('m_r7later', day(100), { agendaFrom: { kind: 'template' } });
  await meeting('m_r7held1', day(-20));
  let shut = (await boardAsks.portalExtras(env, { member: ALEX, meetings: await listMeetings(env.DB), today: TODAY })).reviewShut;
  assert.equal(shut?.meetingId, 'm_r7next1', JSON.stringify(shut));
  assert.equal(shut.why, 'off');
  assert.deepEqual(shut.later, ['m_r7later'], 'the meeting after next: off too (one held isn’t ahead)');
  // The next one approved (on the board page): still said to be approved, the one after it still off
  await agendaApproved(env.DB, 'm_r7next1', 'Alex Rivera');
  shut = (await boardAsks.portalExtras(env, { member: ALEX, meetings: await listMeetings(env.DB), today: TODAY })).reviewShut;
  assert.equal(shut?.why, 'approved', JSON.stringify(shut));
  assert.deepEqual(shut.later, ['m_r7later']);
  // Board's admins review whether it's on or not: no "off" for them
  const admin = (await boardAsks.portalExtras(env, { admin: true, meetings: await listMeetings(env.DB), today: TODAY })).reviewShut;
  assert.equal(admin?.later, undefined, JSON.stringify(admin));
});

// ─── m7 ───
test('m7: rounded parts add up to their total rounded the same way, by the largest remainder', () => {
  const partsAddingUp = need(money, 'partsAddingUp');
  // The tester's: $312,500 and $62,500 (each alone $313K and $63K, $376K)
  assert.deepEqual(partsAddingUp([312500, 62500]), ['$313K', '$62K']);
  // Any parts: what they say adds up to their total at the same step
  const value = (s) => { const m = s.replace(/[$,]/g, '').replace('−', '-').match(/^(-?[\d.]+)([KM]?)$/); return Math.round(Number(m[1]) * ({ K: 1e3, M: 1e6 }[m[2]] || 1)); };
  const step = (v) => (Math.abs(v) >= 1e6 ? 1e4 : Math.abs(v) >= 1e4 ? 1e3 : 1);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 300; i++) {
    const parts = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => Math.round(rand() * (rand() < 0.2 ? 5e6 : 5e5)) + (rand() < 0.1 ? 0.5 : 0));
    const at = Math.min(...parts.map(step));
    const said = partsAddingUp(parts);
    const sum = said.map(value).reduce((a, b) => a + b, 0);
    assert.equal(sum, Math.round(parts.reduce((a, b) => a + b, 0) / at) * at, `${parts.join(' + ')} said as ${said.join(' + ')}`);
  }
  // A small account says its dollars, and the rest go to dollars with it: never "$0K"
  assert.deepEqual(partsAddingUp([312400, 450]), ['$312,400', '$450']);
});

test('m7: the cash’s accounts beside the cash add up to it', () => {
  const tiles = money.moneyTiles({ cash: { live: true, total: 375000, accounts: [{ bank: 'Mercury', name: 'Operating', balance: 312500 }, { bank: 'Mercury', name: 'Reserve', balance: 62500 }], banks: ['Mercury'], asOf: `Nov 21, ${Y0}`, owed: [], stale: [] }, budget: null, n: {} });
  const bank = tiles.find((t) => t.k === 'bank');
  assert.equal(bank.value, '$375,000');
  assert.equal(bank.sub, 'Operating $313K · Reserve $62K, as of Nov 21');
});
