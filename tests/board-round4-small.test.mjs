/**
 * Board QA round 4 (Nov 21 2026), the small ones: what the board page says about a meeting it doesn't show, and what
 * Home's to-do reminders say. Made-up people only.
 * Run: node --test tests/board-round4-small.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { saveMeeting, ensureSchema, patchMeeting } from '../functions/api/_board.js';
import { saveNotes, sendNotes } from '../functions/api/_board-notes.js';
import { signMinutes, signedMinutes } from '../functions/api/_board-minutes-sign.js';
import { todayEastern } from '../public/admin/board-shared.js';
import * as portal from '../functions/api/board-portal.js';

const TODAY = todayEastern();
const ID = 'm_r4sign001';
const SECRETARY = { slug: 'kim-park', name: 'Kim Park', email: 'kim@example.com', seat: 'secretary', title: 'Board Secretary' };
const SAM = { slug: 'sam-ortiz', name: 'Sam Ortiz', email: 'sam@example.com' };
const MARK = { type: 'typed', style: 'dancing', text: 'Kim Park', initials: 'KP' };

let env;
const objects = new Map();
const bucket = {
  put: async (k, v) => { objects.set(k, new Uint8Array(v)); },
  get: async (k) => (objects.has(k) ? { body: new Blob([objects.get(k)]).stream() } : null),
  delete: async (k) => { objects.delete(k); },
};
const asMember = async (member) => (await portal.onRequestGet({ env, request: new Request('https://x/api/board-portal'), data: { boardMember: member }, waitUntil: () => {} })).json();

beforeEach(async () => {
  objects.clear();
  const DB = await createD1();
  env = { DB, FILES: bucket };
  await ensureSchema(DB);
  await DB.prepare('CREATE TABLE IF NOT EXISTS team (slug TEXT PRIMARY KEY, data TEXT)').run().catch(() => {});
  await DB.prepare('INSERT OR REPLACE INTO team (slug, data) VALUES (?, ?)').bind('kim-park', JSON.stringify({ name: 'Kim Park', group: 'board', status: 'active', seat: 'secretary', email: 'kim@example.com' })).run();
  await DB.prepare('INSERT OR REPLACE INTO team (slug, data) VALUES (?, ?)').bind('sam-ortiz', JSON.stringify({ name: 'Sam Ortiz', group: 'board', status: 'active', email: 'sam@example.com' })).run();
  await saveMeeting(DB, {
    id: ID, title: 'Confidential merger talks', date: TODAY, start: '08:00', end: '10:00', shared: true, location: 'The office',
    attendance: [{ slug: 'kim-park', name: 'Kim Park', kind: 'board', status: 'present' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board', status: 'present' }],
    sections: [{ id: 's_a', title: 'New business', items: [{ id: 'i_a', title: 'Budget', notes: 'First line' }] }],
  }, { by: 'jane@example.com' });
  await saveNotes(env, ID, { changes: { 'n:i_a': 'First line', 'r:kim-park': 'present' } }, { member: SECRETARY, admin: false });
  await sendNotes(env, ID, { member: SECRETARY, admin: false });
  await patchMeeting(DB, ID, (m) => ({ ...m, minutes: 'approved', approvedOn: TODAY }), { by: 'x' });
  await signMinutes(env, ID, SECRETARY, { mark: MARK, consent: true });
});

test('round 4: a signature on minutes of a meeting on the board page shows there (control)', async () => {
  const page = await asMember(SAM);
  assert.equal(page.ok, true, page.error);
  assert.equal(page.minutesSigned?.[ID]?.name, 'Kim Park');
});

test('round 4: a meeting taken off the board page says nothing there, not even who signed its minutes', async () => {
  await patchMeeting(env.DB, ID, (m) => ({ ...m, shared: false }), { by: 'x' });
  const page = await asMember(SAM);
  assert.equal(page.ok, true, page.error);
  assert.equal(page.minutesSigned?.[ID], undefined, JSON.stringify(page.minutesSigned));
  assert.ok(!JSON.stringify(page).includes(ID), 'its id is nowhere on the page');
});

test('round 4: a meeting marked not a board meeting says nothing on the board page either', async () => {
  await patchMeeting(env.DB, ID, (m) => ({ ...m, notBoard: true }), { by: 'x' });
  const page = await asMember(SAM);
  assert.equal(page.minutesSigned?.[ID], undefined, JSON.stringify(page.minutesSigned));
  assert.ok(!JSON.stringify(page).includes(ID), 'its id is nowhere on the page');
});

test('round 4: Board admin still has every signature (founders see every meeting)', async () => {
  await patchMeeting(env.DB, ID, (m) => ({ ...m, shared: false, notBoard: true }), { by: 'x' });
  assert.equal((await signedMinutes(env.DB))[ID]?.name, 'Kim Park');
});

// ─── Home's to-do reminders: every open to-do Home lists is accounted for, and only those who'd get one are named ───
import * as actions from '../functions/api/_board-actions.js';
import { listMeetings } from '../functions/api/_board.js';

const inDays = (n) => todayEastern(Date.now() + n * 86400000);
// A board member on People; their email, when they have one, in the private table People keeps it in
const person = async (slug, { email = '', ...data }) => {
  await env.DB.prepare('INSERT OR REPLACE INTO team (slug, data) VALUES (?, ?)').bind(slug, JSON.stringify({ group: 'board', status: 'active', ...data })).run();
  await env.DB.exec('CREATE TABLE IF NOT EXISTS reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  if (email) await env.DB.prepare('INSERT OR REPLACE INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
};
const todos = async (onPage, offPage = []) => {
  await env.DB.prepare('DELETE FROM board_meetings').run();
  await saveMeeting(env.DB, { id: 'm_r4todo001', date: inDays(-10), shared: true, sections: [], actions: onPage }, { by: 'x' });
  if (offPage.length) await saveMeeting(env.DB, { id: 'm_r4todo002', date: inDays(-20), shared: false, sections: [], actions: offPage }, { by: 'x' });
};
const KIM = { id: 'a_r4kim001', text: 'Book the venue', owner: 'kim-park', ownerName: 'Kim Park', due: inDays(5) };
const DANA = { id: 'a_r4dana01', text: 'Ask the gala chair about the date', owner: '', ownerName: 'Dana Example', due: inDays(6) };
const ALEX = { id: 'a_r4alex01', text: 'Draft the budget', owner: 'alex-rivera', ownerName: 'Alex Rivera', due: inDays(7) };
const SAMS = { id: 'a_r4sam001', text: 'Call the caterer', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(8) };
const MAXS = { id: 'a_r4max001', text: 'Order the banners', owner: 'max-sample', ownerName: 'Max Sample', due: inDays(9) };
const preview = async () => (await actions.sendActionPreview(env, 'jane@example.com')).error;
const kimNoEmail = () => person('kim-park', { name: 'Kim Park', seat: 'secretary' });

test('round 4: a to-do with a name that isn’t anyone on People says so, never that it has no one’s name on it', async () => {
  await todos([DANA]);
  assert.equal(await preview(), 'No reminder can go: the open to-do is for Dana Example, whose name isn’t linked to anyone on People.');
});

test('round 4: the preview accounts for every open to-do Home lists, each with its own reason', async () => {
  await kimNoEmail();
  await person('alex-rivera', { name: 'Alex Rivera', email: 'alex@example.com' });
  await todos([KIM], [ALEX]);
  assert.equal(await preview(), 'No reminder can go. Kim Park has no email on file. The to-do for Alex Rivera is from a meeting not on the board page. Add theirs in People → Board, and the reminder shows here.');
  await todos([KIM, DANA, { id: 'a_r4none01', text: 'Find a sponsor', owner: '', ownerName: '' }], [ALEX]);
  assert.equal(await preview(), 'No reminder can go. Kim Park has no email on file. The to-do for Dana Example isn’t linked to anyone on People. One open to-do has no one’s name on it. The to-do for Alex Rivera is from a meeting not on the board page. Add theirs in People → Board, and the reminder shows here.');
});

test('round 4: one to-do from a meeting not on the board page is said as one', async () => {
  await person('alex-rivera', { name: 'Alex Rivera', email: 'alex@example.com' });
  await todos([], [ALEX]);
  assert.equal(await preview(), 'No reminder goes yet: the open to-do is from a meeting not on the board page.');
});

test('round 4: turning reminders on names only the people who’d get an email, joined with “and”, and says why the rest get none', async () => {
  await kimNoEmail();
  await person('alex-rivera', { name: 'Alex Rivera', email: 'alex@example.com' });
  await person('sam-ortiz', { name: 'Sam Ortiz', email: 'sam@example.com' });
  await person('max-sample', { name: 'Max Sample', email: 'max@example.com' });
  await todos([KIM, SAMS, MAXS], [ALEX]);
  const r = await actions.reminderReach(env.DB, await listMeetings(env.DB));
  assert.deepEqual(r.to.sort(), ['Max Sample', 'Sam Ortiz']);
  assert.match(r.who, /^(Sam Ortiz and Max Sample|Max Sample and Sam Ortiz)$/);
  assert.equal(r.why, 'Kim Park has no email on file. The to-do for Alex Rivera is from a meeting not on the board page. Add theirs in People → Board, and the reminder shows here.');
  // Nobody reachable: nobody named, and why
  await todos([KIM], [ALEX]);
  const none = await actions.reminderReach(env.DB, await listMeetings(env.DB));
  assert.deepEqual(none.to, []);
  assert.match(none.why, /^Kim Park has no email on file\. The to-do for Alex Rivera/);
});

// ─── Board QA round 5: only to-dos a reminder would still go to ───

test('round 5: a to-do more than three weeks late has had its last reminder: nobody is named for it, and the preview says why', async () => {
  await person('alex-rivera', { name: 'Alex Rivera', email: 'alex@example.com' });
  await todos([{ ...ALEX, due: inDays(-30) }]);
  const r = await actions.reminderReach(env.DB, await listMeetings(env.DB));
  assert.deepEqual(r.to, [], 'nobody gets an email for it');
  assert.equal(r.why, 'The to-do for Alex Rivera is more than three weeks late, so its reminders have stopped.');
  assert.equal(await preview(), 'No reminder can go. The to-do for Alex Rivera is more than three weeks late, so its reminders have stopped.');
  // Twenty days late: one more is still to come
  await todos([{ ...ALEX, due: inDays(-20) }]);
  assert.deepEqual((await actions.reminderReach(env.DB, await listMeetings(env.DB))).to, ['Alex Rivera']);
});

test('round 5: a to-do with no due date and no meeting after it has nothing to be reminded of, and says so', async () => {
  await person('alex-rivera', { name: 'Alex Rivera', email: 'alex@example.com' });
  await todos([{ ...ALEX, due: '' }]);
  const r = await actions.reminderReach(env.DB, await listMeetings(env.DB));
  assert.deepEqual(r.to, []);
  assert.equal(r.why, 'The to-do for Alex Rivera has no due date and no meeting after it yet, so there’s nothing to remind them of.');
});
