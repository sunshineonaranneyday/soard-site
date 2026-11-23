/**
 * Board admin's words and the rules under them (QA round of Nov 19 2026): a guest presenter typed with a comma is one
 * person; minutes the board already approved aren't put to it again on the next agenda; what approving an agenda does
 * depends on whether the board has had the email on how to sign in; two meetings in one quarter are told apart; a call
 * whose answer never came back says so in words (never "HTTP 502"); and no dash in words people read.
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './lib/d1-shim.mjs';
import * as shared from '../public/admin/board-shared.js';
import * as ui from '../public/admin/board-ui.js';
import { saveMeeting, getMeeting, maybeTemplateAgendas } from '../functions/api/_board.js';

// (each rule by name, so one that isn't there fails its own test, never the file)
const { presentersOf, namesText, cleanMeeting, templateAgenda, newMeeting, tallyText, pagesText, meetingName, todayEastern, DEFAULT_TEMPLATE } = shared;
const { call } = ui;

const PEOPLE = [{ slug: 'alex-rivera', name: 'Alex Rivera' }, { slug: 'sam-ortiz', name: 'Sam Ortiz' }];
const day = (n) => todayEastern(Date.now() + n * 86400000);

// ─── Who presents ───────────────────────────────────────────────────

test('a guest typed in as “Dana Smith, CPA” is one presenter, alone or beside someone picked from People', () => {
  // As the agenda's picker keeps them: who (People), guests (typed), and the names as one line
  const pick = (list) => ({ who: list.filter((x) => x.slug).map((x) => x.slug), guests: list.filter((x) => !x.slug).map((x) => x.name), presenter: namesText(list.map((x) => x.name)) });
  const alone = cleanMeeting({ sections: [{ items: [{ title: 'Roll call', ...pick([{ name: 'Dana Smith, CPA' }]) }] }] }).sections[0].items[0];
  assert.deepEqual(alone.guests, ['Dana Smith, CPA'], 'the guest is kept, whole');
  assert.deepEqual(presentersOf(alone, PEOPLE).map((p) => p.name), ['Dana Smith, CPA']);
  const two = cleanMeeting({ sections: [{ items: [{ title: 'Audit', ...pick([PEOPLE[0], { name: 'Dana Smith, CPA' }]) }] }] }).sections[0].items[0];
  assert.equal(two.presenter, 'Alex Rivera & Dana Smith, CPA');
  assert.deepEqual(presentersOf(two, PEOPLE).map((p) => [p.slug || '', p.name]), [['alex-rivera', 'Alex Rivera'], ['', 'Dana Smith, CPA']]);
  // ...and where People isn't at hand, the rest of the line still splits, the guest whole
  assert.deepEqual(presentersOf(two).map((p) => p.name), ['Alex Rivera', 'Dana Smith, CPA']);
  // A guest's name inside someone else's is never cut out of it
  assert.deepEqual(presentersOf({ presenter: 'Sam Ortiz, Sam & Bo', guests: ['Sam'] }).map((p) => p.name), ['Sam Ortiz', 'Bo', 'Sam']);
  // An agenda written before guests were kept, or read from an email, still splits its names as written
  assert.deepEqual(presentersOf({ presenter: 'Alex & Sam Ortiz' }, PEOPLE).map((p) => p.slug || p.name), ['alex-rivera', 'sam-ortiz']);
  assert.deepEqual(presentersOf({ presenter: 'Traci + Holly / Bo and Cy' }, PEOPLE).map((p) => p.name), ['Traci', 'Holly', 'Bo', 'Cy']);
});

// ─── The last minutes, on the next agenda ───────────────────────────

test('minutes the board approved before a meeting aren’t put to it again; approved on its day, its agenda keeps the item', () => {
  const prev = { id: 'm_prev1234', date: '2026-11-28', title: '', minutes: 'draft', approvedOn: '' };
  const minutesItems = (sections) => sections.flatMap((s) => s.items.filter((it) => it.live === 'minutes'));
  // Approved before the meeting (marked approved early, or by a vote in between): no item, and no empty "Approve meeting minutes" part
  const early = { ...prev, minutes: 'approved', approvedOn: '2026-12-01' };
  const sections = templateAgenda(early, { date: '2027-02-11' });
  assert.deepEqual(minutesItems(sections).map((it) => it.title), []);
  assert.ok(!sections.some((s) => s.title === 'Approve meeting minutes'), 'the part that was only that item goes with it');
  assert.ok(sections.some((s) => s.title === 'New business' && !s.items.length), 'a part the template keeps empty stays');
  // Waiting for the vote: up for approval, with the meeting it's about
  assert.deepEqual(minutesItems(templateAgenda(prev, { date: '2027-02-11' })).map((it) => [it.title, it.about]), [[`Minutes of the ${meetingName(prev)} (Nov 28, 2026)`, 'm_prev1234']]);
  const { minutesUpFor } = shared;
  assert.equal(minutesUpFor(prev, '2027-02-11'), true);
  assert.equal(minutesUpFor(early, '2027-02-11'), false);
  // Approved on the meeting's own day: approved at it, so its agenda keeps the item it was approved by
  const atIt = { ...prev, minutes: 'approved', approvedOn: '2027-02-11' };
  assert.equal(minutesItems(templateAgenda(atIt, { date: '2027-02-11' })).length, 1);
  // Approved with no day on record (an old import): approved, so not again
  assert.equal(minutesUpFor({ ...prev, minutes: 'approved', approvedOn: '' }, '2027-02-11'), false);
  // A minutes item inside a part with others: only the item goes
  const template = [{ title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Minutes', live: 'minutes' }] }];
  assert.deepEqual(templateAgenda(early, { template, date: '2027-02-11' }).map((s) => [s.title, s.items.map((it) => it.title)]), [['Call to order', ['Roll call']]]);
  // A new meeting goes by its own day
  assert.deepEqual(minutesItems(newMeeting({ date: '2027-02-11', meetings: [early] }).sections), []);
  assert.equal(minutesItems(newMeeting({ date: '2027-02-11', meetings: [prev] }).sections).length, 1);
});

test('the server’s template follow leaves approved minutes off a meeting ahead, and never takes them off one on its day', async () => {
  const env = { DB: await createD1() };
  const by = { by: 'Board' };
  const held = await saveMeeting(env.DB, cleanMeeting({ date: day(-20), shared: true, minutes: 'approved', approvedOn: day(-5), sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }] }), by);
  // Ahead, its agenda still the template from before the approval (with the item asking for it)
  const stale = templateAgenda({ ...held, minutes: 'draft', approvedOn: '' }, { date: day(30) });
  const ahead = await saveMeeting(env.DB, cleanMeeting({ date: day(30), sections: stale, agendaFrom: { kind: 'template', name: 'x', at: '' } }), by);
  assert.equal(ahead.sections.flatMap((s) => s.items).filter((it) => it.live === 'minutes').length, 1, 'setup: the item from before');
  assert.deepEqual(await maybeTemplateAgendas(env, { force: true }), [ahead.id]);
  const after = await getMeeting(env.DB, ahead.id);
  assert.deepEqual(after.sections.flatMap((s) => s.items).filter((it) => it.live === 'minutes'), []);
  assert.ok(!after.sections.some((s) => s.title === 'Approve meeting minutes'));

  // On its own day, minutes approved that day were approved at it: its agenda keeps the item
  const env2 = { DB: await createD1() };
  const prev = await saveMeeting(env2.DB, cleanMeeting({ date: day(-90), shared: true, minutes: 'approved', approvedOn: day(0), sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }] }), by);
  const today = await saveMeeting(env2.DB, cleanMeeting({ date: day(0), sections: templateAgenda({ ...prev, minutes: 'draft' }, { date: day(0) }), agendaFrom: { kind: 'template', name: 'x', at: '' } }), by);
  await maybeTemplateAgendas(env2, { force: true });
  assert.equal((await getMeeting(env2.DB, today.id)).sections.flatMap((s) => s.items).filter((it) => it.live === 'minutes' && it.about === prev.id).length, 1);
});

// ─── Approving an agenda: what goes, and when ───────────────────────

test('the board knows how to sign in once the whole board was sent the email, or each has had it or signed in', () => {
  const { signInKnown } = shared;
  const board = [{ slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex@example.com' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', email: 'sam@example.org', lastSeen: '2026-11-01T00:00:00Z' }, { slug: 'kim-park', name: 'Kim Park', email: '' }];
  assert.deepEqual(signInKnown({}, board), { told: false, waiting: [board[0]] }, 'Alex hasn’t had it (Sam signed in; Kim has no email)');
  assert.equal(signInKnown({ members: { 'alex-rivera': '2026-11-02T00:00:00Z' }, addresses: { 'alex-rivera': 'alex@example.com' } }, board).told, true);
  assert.equal(signInKnown({ members: { 'alex-rivera': '2026-11-02T00:00:00Z' }, addresses: { 'alex-rivera': 'old@example.com' } }, board).told, false, 'sent to an address that isn’t theirs now');
  assert.deepEqual(signInKnown({ sentAt: '2026-11-01T00:00:00Z' }, board), { told: true, waiting: [] }, 'the whole board’s send');
  assert.equal(signInKnown({ sentAt: '2026-11-01T00:00:00Z' }, board, { sending: true }).told, false, 'not while one is going out');
  assert.equal(signInKnown({}, [{ slug: 'kim-park', name: 'Kim Park', email: '' }]).told, false, 'nobody it could reach');
});

// ─── Two meetings in one quarter ────────────────────────────────────

test('a meeting’s name stands alone where it’s the only one; beside another of the same name, with its day', () => {
  const { nameIn } = ui;
  const a = { id: 'm_a', date: '2026-11-28', title: '' };
  const b = { id: 'm_b', date: '2026-12-03', title: '' };
  const c = { id: 'm_c', date: '2027-02-11', title: '' };
  assert.equal(meetingName(a), meetingName(b));
  assert.equal(nameIn(b, [a, b, c]), 'Q4 2026 Board Meeting (Dec 3, 2026)');
  assert.equal(nameIn(c, [a, b, c]), 'Q1 2027 Board Meeting');
});

// ─── A call whose answer never came back ────────────────────────────

test('a call whose answer is lost says so in words, never a code, and marks it as maybe done', async () => {
  const { answerLost, sentence } = ui;
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>502 Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    let j = await call({ action: 'send-packet', id: 'm_x' });
    assert.equal(j.ok, false);
    assert.doesNotMatch(j.error, /HTTP|\d{3}/);
    assert.equal(answerLost(j), true);
    globalThis.fetch = async () => new Response('<html>ok</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    j = await call({ action: 'send-invite', id: 'm_x' });
    assert.equal(answerLost(j), true, 'an answer cut off');
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    j = await call({ action: 'remind-rsvp', id: 'm_x' });
    assert.equal(answerLost(j), true, 'the connection dropped: it may have reached the site');
    globalThis.fetch = async () => new Response('<html>too big</html>', { status: 413, headers: { 'Content-Type': 'text/html' } });
    j = await call(null, { form: new FormData(), query: '?upload=1' });
    assert.equal(answerLost(j), false, 'refused on the way: nothing happened');
    assert.doesNotMatch(j.error, /HTTP|413/);
    globalThis.fetch = async () => Response.json({ ok: false, error: 'Share the meeting with the board first' }, { status: 409 });
    j = await call({ action: 'remind-rsvp', id: 'm_x' });
    assert.equal(answerLost(j), false, 'the site’s own no');
    assert.equal(j.error, 'Share the meeting with the board first');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sentence('No connection. Check your internet and try again.'), 'No connection. Check your internet and try again.', 'one full stop, never two');
  assert.equal(sentence('A meeting needs a date'), 'A meeting needs a date.');
});

// ─── No dash in words people read ───────────────────────────────────

test('a vote, a spread’s pages and a file that can’t be shown are said without a dash', () => {
  assert.equal(tallyText({ result: 'passed', tally: { for: 8, against: 1, abstain: 1 } }), 'Passed 8 to 1, 1 abstained');
  assert.equal(pagesText([0, 1]), 'pages 1 and 2');
  assert.equal(pagesText([0, 1], 'slide'), 'slides 1 and 2');
  // The screen's tallies and docs.js's names for old Office files (browser modules: read as written)
  const screen = readFileSync(new URL('../public/admin/board/screen.js', import.meta.url), 'utf8');
  assert.doesNotMatch(screen, /tally\.for\}–/, 'the screen says “8 to 1”');
  const docs = readFileSync(new URL('../public/admin/board/docs.js', import.meta.url), 'utf8');
  assert.doesNotMatch(docs.match(/function formatName[\s\S]*?\n}/)[0], /–/, 'Word 97-2003, with a hyphen');
  assert.ok(DEFAULT_TEMPLATE.length);
});
