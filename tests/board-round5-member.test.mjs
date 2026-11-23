/**
 * Board QA round 5 (Nov 21 2026), the board page as members see it: the rules under what they saw.
 *   m4  Approved minutes: the secretary's signature on record ends the asking (one rule, board-shared.js
 *       minutesToSign, for Home's For you and the meeting's Sign the minutes), never waiting on the signed copy made
 *       from it; minutes changed after it ask again
 *   m5  A chair's review link that doesn't open the review says why (_board-asks.js reviewShutWhy, portalExtras'
 *       reviewShut): the agenda already approved, not written yet, more than two weeks ahead (and the day it opens), or
 *       the review not on for the chair yet; said to the chair and Board's admins, nobody else
 *   m9  The map's key counts the way the line over it and a phone's track count: approved and awaiting funding each
 *       apart from the makeovers being built (stages.js keyOf against phaseCount)
 * Made-up people only (the repo is public).
 * Run: node --test tests/board-round5-member.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { saveMeeting, getMeeting, listMeetings, ensureSchema } from '../functions/api/_board.js';
import { signMinutes, signedMinutes } from '../functions/api/_board-minutes-sign.js';
import * as boardAsks from '../functions/api/_board-asks.js';
import { agendaApproved } from './lib/agenda-approved.mjs';
import { minutesToSign, todayEastern } from '../public/admin/board-shared.js';
import { keyOf, phaseCount, countsOf, STAGE_KEYS, STAGES } from '../public/admin/board/stages.js';
import * as kanban from '../public/admin/board/kanban.js';

// (namespaces, so each test says what's missing on code from before these rules: a test, never the whole file, fails)
const { portalExtras } = boardAsks;
const reviewShutWhy = (...a) => { assert.equal(typeof boardAsks.reviewShutWhy, 'function', 'no reviewShutWhy'); return boardAsks.reviewShutWhy(...a); };
const stageNameWidth = (s) => { assert.equal(typeof kanban.stageNameWidth, 'function', 'no stageNameWidth'); return kanban.stageNameWidth(s); };

const TODAY = todayEastern();
const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary' }],
];
const ALEX = { slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex.board@example.com', seat: 'chair' };
const SAM = { slug: 'sam-ortiz', name: 'Sam Ortiz', email: 'sam.board@example.org', seat: 'treasurer' };
const TAYLOR = { slug: 'taylor-nguyen', name: 'Taylor Nguyen', email: 'taylor.board@example.net', seat: 'secretary', title: 'Board Secretary' };
const MARK = { type: 'typed', style: 'dancing', text: 'Taylor Nguyen', initials: 'TN' };
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
const meeting = (id, date, more = {}) => saveMeeting(env.DB, { id, date, start: '08:00', end: '10:00', shared: true, sections: AGENDA, agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() }, ...more }, { by: 'jane@soardcharity.com' });
const asks = async (mode) => {
  await env.DB.exec('CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.prepare('INSERT OR REPLACE INTO board_state (key, data) VALUES (?, ?)').bind('settings', JSON.stringify({ asks: mode })).run();
};

// ─── m4 ───
test('m4: the signature ends the asking the moment it’s given, before its signed copy is made; changed minutes ask again', () => {
  const m = { minutes: 'approved', approvedOn: TODAY, files: [] };
  const signed = { name: 'Taylor Nguyen', at: `${TODAY}T15:00:00Z`, how: 'typed', made: false, changed: false };
  assert.equal(minutesToSign(m), true, 'approved, nobody has signed: asked');
  assert.equal(minutesToSign(m, signed), false, 'signed, the copy still being made: not asked');
  assert.equal(minutesToSign(m, { ...signed, made: true }), false, 'signed, the copy made: not asked');
  assert.equal(minutesToSign({ ...m, files: [{ kind: 'signed' }] }, { ...signed, made: true, changed: true }), true, 'changed after the signature: asked again');
  assert.equal(minutesToSign({ ...m, files: [{ kind: 'signed' }] }), false, 'a signed copy put in by hand, no signature here: not asked');
  assert.equal(minutesToSign({ ...m, approvedOn: '2025-06-11' }), false, 'years gone by: never asked');
  assert.equal(minutesToSign({ ...m, minutes: 'draft' }, null), false, 'not approved: not asked');
});

test('m4: signed on the server, and the page’s record of it ends the asking though no browser made the copy', async () => {
  await meeting('m_r5sign01', day(-40), { minutes: 'approved', approvedOn: TODAY, attendance: [{ slug: 'taylor-nguyen', name: 'Taylor Nguyen', kind: 'board', status: 'present' }] });
  assert.equal(minutesToSign(await getMeeting(env.DB, 'm_r5sign01'), (await signedMinutes(env.DB))['m_r5sign01']), true);
  await signMinutes(env, 'm_r5sign01', TAYLOR, { mark: MARK, consent: true });
  const m = await getMeeting(env.DB, 'm_r5sign01');
  const record = (await signedMinutes(env.DB, null, { boardOnly: true }))['m_r5sign01'];
  assert.deepEqual([record.name, record.made, record.changed], ['Taylor Nguyen', false, false], 'signed; the copy isn’t made here (no browser)');
  assert.ok(!m.files.some((f) => f.kind === 'signed'), 'no signed file yet');
  assert.equal(minutesToSign(m, record), false, 'and it isn’t asked again');
});

// ─── m5 ───
test('m5: why a review isn’t open, case by case', () => {
  const m = { id: 'm_next', date: day(9), sections: AGENDA, agendaFrom: { kind: 'typed' } };
  assert.equal(reviewShutWhy(m, { today: TODAY, on: true }), null, 'written, within two weeks, the review on: open');
  assert.deepEqual(reviewShutWhy(m, { today: TODAY, approved: { name: 'Alex Rivera', inAt: `${TODAY}T14:00:00Z` }, on: false }), { meetingId: 'm_next', why: 'approved', approvedBy: 'Alex Rivera', approvedAt: `${TODAY}T14:00:00Z` });
  assert.deepEqual(reviewShutWhy({ ...m, date: day(30) }, { today: TODAY }), { meetingId: 'm_next', why: 'early', opens: day(16), draft: false });
  assert.deepEqual(reviewShutWhy({ ...m, date: day(30), agendaFrom: { kind: 'template' } }, { today: TODAY }), { meetingId: 'm_next', why: 'early', opens: day(16), draft: true });
  assert.deepEqual(reviewShutWhy({ ...m, agendaFrom: { kind: 'template' } }, { today: TODAY }), { meetingId: 'm_next', why: 'draft' });
  assert.deepEqual(reviewShutWhy(m, { today: TODAY, on: false }), { meetingId: 'm_next', why: 'off' });
  // (on the board page already, with no approval kept: nothing ahead goes there before its agenda is approved)
  assert.deepEqual(reviewShutWhy({ ...m, shared: true }, { today: TODAY, on: false }), { meetingId: 'm_next', why: 'approved', approvedBy: '', approvedAt: '' });
  assert.equal(reviewShutWhy({ ...m, shared: true, date: day(30) }, { today: TODAY }).why, 'approved');
  assert.equal(reviewShutWhy(null, { today: TODAY }), null);
});

test('m5: an approved agenda, the review not on for the chair: the chair is told it’s approved, who did and when; nobody else is told anything', async () => {
  await asks('test');
  await meeting('m_r5next1', day(9));
  await agendaApproved(env.DB, 'm_r5next1', 'Alex Rivera');
  const meetings = await listMeetings(env.DB);
  const chair = await portalExtras(env, { member: ALEX, meetings, today: TODAY });
  assert.equal(chair.review, null, 'the review itself isn’t the chair’s while it’s off');
  assert.equal(chair.reviewShut?.why, 'approved', JSON.stringify(chair.reviewShut));
  assert.deepEqual([chair.reviewShut.meetingId, chair.reviewShut.approvedBy], ['m_r5next1', 'Alex Rivera']);
  assert.match(chair.reviewShut.approvedAt, /^\d{4}-\d{2}-\d{2}T/);
  const sam = await portalExtras(env, { member: SAM, meetings, today: TODAY });
  assert.equal(sam.reviewShut ?? null, null, 'a member who isn’t the chair is told nothing of it');
  const admin = await portalExtras(env, { admin: true, meetings, today: TODAY });
  assert.ok(admin.review && !admin.reviewShut, 'Board’s admins have the review itself');
  // (on the board page and approved: shown as over, who approved it and when, never one to approve. QA round 7, Nov 21 2026)
  assert.deepEqual([admin.review.over, admin.review.approvedBy], [true, 'Alex Rivera']);
});

test('m5: further off than two weeks, the chair (review on) is told the day it opens', async () => {
  await asks('on');
  await meeting('m_r5far01', day(30), { shared: false });
  const x = await portalExtras(env, { member: ALEX, meetings: await listMeetings(env.DB), today: TODAY });
  assert.equal(x.review, null);
  assert.deepEqual(x.reviewShut, { meetingId: 'm_r5far01', why: 'early', opens: day(16), draft: false });
});

// ─── m9 ───
test('m9: the map’s key says Approved and Building as the line over it does, never an approved family as Building', () => {
  const list = [
    { stage: 'applied' }, { stage: 'review' }, { stage: 'approved' }, { stage: 'funding' },
    { stage: 'design' }, { stage: 'mobilization' }, { stage: 'build' }, { stage: 'revealed' }, { stage: 'denied' }, { stage: '' },
  ];
  const key = {};
  for (const f of list) key[keyOf(f)] = (key[keyOf(f)] || 0) + 1;
  const building = phaseCount(countsOf(list), 'building');
  assert.equal(key.building, building.n, `Building on the key is what the track counts as being built (${JSON.stringify(key)})`);
  assert.deepEqual(building.also, ['1 approved', '1 awaiting funding']);
  assert.equal(key.approved, 1, 'an approved family is keyed Approved');
  assert.equal(key.funding, 1, 'and one awaiting funding, Awaiting funding');
  for (const k of Object.keys(key)) assert.ok(STAGE_KEYS.some((r) => r.key === k), `${k} has a row on the key`);
  assert.equal(new Set(STAGE_KEYS.map((r) => r.color)).size, STAGE_KEYS.length, 'each row its own color');
  assert.equal(STAGE_KEYS.find((r) => r.key === 'approved').label, STAGES.find((s) => s.key === 'approved').label);
});

// ─── m3 (the rule; the browser suite measures it on the screen) ───
test('m3: a stage’s column is never narrower than its name on the track', () => {
  // (Outfit 800 in capitals, 0.11em apart, 1.2 units tall: "MOBILIZATION" measures 10.3 units in Chrome)
  assert.ok(stageNameWidth('Mobilization') >= 10.3, stageNameWidth('Mobilization'));
  assert.ok(stageNameWidth('Finalization') >= 10.0, stageNameWidth('Finalization'));
  // (two words go on two lines when that's narrower: the widest line counts)
  assert.ok(stageNameWidth('Awaiting funding') < stageNameWidth('Awaitingfunding'));
  assert.ok(stageNameWidth('Awaiting funding') >= 7.4);
});
