/**
 * Board QA round 6 (Nov 21 2026), the board page as members see it: the rules under what they saw.
 *   m1  The chair's review link while the review isn't on for the chair says so, whatever the date or the agenda's
 *       state (_board-asks.js reviewShutWhy decides "on" before "early" and "draft"; an approved agenda is still said
 *       to be approved, as round 5 decided)
 *   m5  The Makeovers map: the makeovers it has no pin for are said beside its key, stage by stage, so the line over
 *       the map and the key add up (board/family-map.js awayLine)
 *   m6  An amount is shown and marked as it's found, however it's written: the search's pattern for a term (find.js
 *       termRe) agrees with how it finds it (prep, planOf), with or without cents, "$" or commas
 * The screen's makeovers slide (the freeze, the names, the tags) and the notes' lines are checked in a browser:
 * scripts/test-board-round6-member.mjs. Made-up people only (the repo is public).
 * Run: node --test tests/board-round6-member.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { saveMeeting, listMeetings, ensureSchema } from '../functions/api/_board.js';
import * as boardAsks from '../functions/api/_board-asks.js';
import { agendaApproved } from './lib/agenda-approved.mjs';
import { todayEastern } from '../public/admin/board-shared.js';
import * as find from '../public/admin/board/find.js';
import * as familyMap from '../public/admin/board/family-map.js';
import { STAGE_SCHEME, sumLine } from '../public/admin/board/lifecycle.js';
import { keyOf } from '../public/admin/board/stages.js';

// (namespaces, so each test says what's missing on code from before these rules: a test, never the whole file, fails)
const { portalExtras, reviewShutWhy } = boardAsks;
const termRe = (t) => { assert.equal(typeof find.termRe, 'function', 'no termRe in find.js'); return find.termRe(t); };
const awayLine = (...a) => { assert.equal(typeof familyMap.awayLine, 'function', 'no awayLine'); return familyMap.awayLine(...a); };

const TODAY = todayEastern();
const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
];
const ALEX = { slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex.board@example.com', seat: 'chair' };
const AGENDA = [
  { id: 's_open', title: 'Call to order', items: [{ id: 'i_roll', title: 'Roll call' }] },
  { id: 's_fin', title: 'Finance', items: [{ id: 'i_fin', title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
];

let env;
beforeEach(async () => {
  env = { DB: await createD1() };
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  ]) await env.DB.exec(sql);
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  await ensureSchema(env.DB);
});
const meeting = (id, date, more = {}) => saveMeeting(env.DB, { id, date, start: '08:00', end: '10:00', shared: false, sections: AGENDA, agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() }, ...more }, { by: 'jane@soardcharity.com' });
const asks = async (mode) => {
  await env.DB.exec('CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.prepare('INSERT OR REPLACE INTO board_state (key, data) VALUES (?, ?)').bind('settings', JSON.stringify({ asks: mode })).run();
};

// ─── m1 ───
test('m1: the review not on for the chair: said so whatever the date or the agenda’s state, never a day it opens', () => {
  const m = { id: 'm_next', date: day(9), sections: AGENDA, agendaFrom: { kind: 'typed' } };
  const off = { meetingId: 'm_next', why: 'off' };
  assert.deepEqual(reviewShutWhy({ ...m, date: day(30) }, { today: TODAY, on: false }), off, '30 days off, written: off, not "opens Monday"');
  assert.deepEqual(reviewShutWhy({ ...m, date: day(30), agendaFrom: { kind: 'template' } }, { today: TODAY, on: false }), off, '30 days off, a draft: off');
  assert.deepEqual(reviewShutWhy({ ...m, agendaFrom: { kind: 'template' } }, { today: TODAY, on: false }), off, '9 days off, a draft: off, not "once SOARD has written it"');
  assert.deepEqual(reviewShutWhy({ ...m, date: day(14) }, { today: TODAY, on: false }), off, '14 days off, written: off');
  // (on: the day it opens and whether it's written, as before; approved stays approved, as round 5 decided)
  assert.deepEqual(reviewShutWhy({ ...m, date: day(30) }, { today: TODAY, on: true }), { meetingId: 'm_next', why: 'early', opens: day(16), draft: false });
  assert.deepEqual(reviewShutWhy({ ...m, agendaFrom: { kind: 'template' } }, { today: TODAY, on: true }), { meetingId: 'm_next', why: 'draft' });
  assert.equal(reviewShutWhy({ ...m, shared: true, date: day(30) }, { today: TODAY, on: false }).why, 'approved');
  assert.equal(reviewShutWhy(m, { today: TODAY, approved: { name: 'Alex Rivera', inAt: `${TODAY}T14:00:00Z` }, on: false }).why, 'approved');
});

test('m1: the chair, the review not on yet, a meeting a month off and one being drafted: told it isn’t on; Board’s admins the day it opens', async () => {
  await asks('test');
  await meeting('m_r6far01', day(30));
  let meetings = await listMeetings(env.DB);
  assert.deepEqual((await portalExtras(env, { member: ALEX, meetings, today: TODAY })).reviewShut, { meetingId: 'm_r6far01', why: 'off' }, 'a month off: off');
  assert.equal((await portalExtras(env, { admin: true, meetings, today: TODAY })).reviewShut?.why, 'early', 'Board’s admins review either way: the day it opens');
  await meeting('m_r6far01', day(9), { agendaFrom: { kind: 'template' } });
  meetings = await listMeetings(env.DB);
  assert.deepEqual((await portalExtras(env, { member: ALEX, meetings, today: TODAY })).reviewShut, { meetingId: 'm_r6far01', why: 'off' }, 'a draft: off');
  await agendaApproved(env.DB, 'm_r6far01', 'Alex Rivera');
  assert.equal((await portalExtras(env, { member: ALEX, meetings: await listMeetings(env.DB), today: TODAY })).reviewShut?.why, 'approved', 'approved: said so');
});

// ─── m5 ───
test('m5: the makeovers with no pin, said beside the key stage by stage: the line over the map and the key add up', () => {
  // On the map: an approved family and one being built; no application (so no pin): two being built, one awaiting funding
  const pinned = [{ id: 'a1', stage: 'approved', lat: 34, lng: -84 }, { id: 'a2', stage: 'build', lat: 34.1, lng: -84.2 }];
  const away = [{ id: 'job-j2', stage: 'design' }, { id: 'job-j3', stage: 'funding' }, { id: 'job-j4', stage: 'mobilization' }];
  const line = awayLine(away, STAGE_SCHEME);
  // (the reason only what's known, as round 7 decided: no application in Board for them)
  assert.equal(line, '3 more makeovers aren’t on the map (1 awaiting funding, 2 building): no application in Board for them, so no address');
  assert.equal(awayLine([away[1]], STAGE_SCHEME), '1 more makeover isn’t on the map (1 awaiting funding): no application in Board for it, so no address');
  assert.equal(awayLine([], STAGE_SCHEME), '');
  // The key's counts (the pins) and the note's add up to the line's
  const key = {};
  for (const f of pinned) key[keyOf(f)] = (key[keyOf(f)] || 0) + 1;
  const said = Object.fromEntries(line.match(/\(([^)]*)\)/)[1].split(', ').map((x) => { const [n, ...w] = x.split(' '); return [w.join(' '), Number(n)]; }));
  const sum = sumLine([...pinned, ...away], 'now', null);
  const n = (re) => Number((sum.match(re) || [])[1] || 0);
  assert.equal((key.approved || 0) + (said.approved || 0), n(/(\d+) approved/), sum);
  assert.equal((key.funding || 0) + (said['awaiting funding'] || 0), n(/(\d+) awaiting funding/), sum);
  assert.equal((key.building || 0) + (said.building || 0), n(/(\d+) makeovers? being built/), sum);
});

// ─── m6 ───
test('m6: an amount is marked where it’s found, with or without cents, “$” or commas; never a different amount', () => {
  const { prep, termsOf, planOf, matches } = find;
  const text = 'Statement of Financial Position · Total for Bank Accounts $375,000.00 · Example Operating $250,000.50 · Budget $2,000,000 · starts 6:05 pm · 1.2 million · 1,234.5 in kind';
  const marked = (q) => { const re = new RegExp(termsOf(q).map(termRe).join('|'), 'ig'); return text.match(re) || []; };
  const found = (q) => matches(prep(text), planOf(termsOf(q)));
  for (const [q, want] of [
    ['375,000', '375,000.00'], ['$375,000', '375,000.00'], ['375000', '375,000.00'], ['375,000.00', '375,000.00'], ['$375,000.00', '375,000.00'],
    ['250,000.50', '250,000.50'], ['$250,000.50', '250,000.50'], ['2,000,000', '2,000,000'], ['2000000', '2,000,000'], ['2,000,000.00', '2,000,000'],
    ['6:05', '6:05'], ['1.2', '1.2'], ['1234.5', '1,234.5'], ['1,234.5', '1,234.5'],
  ]) {
    assert.ok(found(q), `“${q}” is found`);
    assert.deepEqual(marked(q), [want], `“${q}” is marked as ${want}`);
  }
  // A different amount is neither found nor marked: 250,000 isn't 250,000.50, 375 isn't the start of 375,000
  for (const q of ['250,000', '250000', '375', '41605', '000']) {
    assert.equal(found(q), false, `“${q}” isn’t found`);
    assert.deepEqual(marked(q), [], `“${q}” isn’t marked`);
  }
});
