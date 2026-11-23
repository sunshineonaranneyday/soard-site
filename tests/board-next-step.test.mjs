/**
 * Board admin's next step, its held meetings and its days (QA round 2, Nov 19 2026): one rule (./board-meeting.js pathOf)
 * says where a meeting stands for its status line, its Getting ready and Board's home, so they never name different
 * next steps; a held meeting's line says what happened, never a chore that no longer applies; a moment becomes the day it
 * was in Atlanta, never its UTC date; and a save refused because the meeting was deleted is known as that.
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as meeting from '../public/admin/board-meeting.js';
import * as ui from '../public/admin/board-ui.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const { pathOf, inviteMissing, saveGone, GONE_STATUS } = meeting;
const { dayOf } = ui;

const MEMBERS = [
  { slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex.board@example.com' },
  { slug: 'sam-ortiz', name: 'Sam Ortiz', email: 'sam.board@example.org' },
  { slug: 'kim-park', name: 'Kim Park', email: '' },
];
const ADMINS = ['jane@soardcharity.com'];
const dataFor = (m, more = {}) => ({ members: MEMBERS, settings: { admins: ADMINS }, approvals: {}, meetings: [m], ...more });
const invited = (emails = ['alex.board@example.com', 'sam.board@example.org']) => ({ eventId: 'ev1', organizer: 'jane@soardcharity.com', emails, guests: emails.length, when: '2026-11-28 08:00-10:00', place: 'Example Hall' });
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }, { title: 'The 2027 budget', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const ahead = (more = {}) => ({ ...cleanMeeting({ id: 'm_next0001', date: '2026-11-28', start: '08:00', end: '10:00', sections: AGENDA, ...more }), id: 'm_next0001' });
const by = (path) => Object.fromEntries(path.map((s) => [s.id, s]));
/** Board's home: the steps up to the day (./board-admin.js prepOf), and the one it names next */
const homeOf = (m, data) => { const prep = pathOf(m, data, 'ahead').filter((x) => x.id !== 'day' && x.id !== 'minutes'); return { prep, next: prep.find((x) => x.state === 'next') || null }; };

// ─── One next step ──────────────────────────────────────────────────

test('after the invite, a meeting not shared names approving the agenda next, on its line and on Board’s home alike', () => {
  const m = ahead({ invite: invited(), shared: false });
  const data = dataFor(m);
  const path = by(pathOf(m, data, 'ahead'));
  assert.equal(path.invite.state, 'done');
  assert.equal(path.approved.state, 'next', 'the page shows no Share until the agenda is approved');
  assert.equal(path.shared.state, 'todo');
  const home = homeOf(m, data);
  assert.equal(home.next.id, 'approved');
  assert.equal(home.next.todo, 'approve the agenda');
  assert.notEqual(home.next.todo, 'put the meeting on the board page');
  // The agenda: two reports asked for and none in, as the page says it (never ticked on home while the page says otherwise)
  assert.equal(path.agenda.state, 'todo');
  assert.equal(path.agenda.sub, '5 items · 0 of 2 reports in');
  assert.equal(home.prep.find((x) => x.id === 'agenda').done, false);
  assert.deepEqual(home.prep.map((x) => x.title), ['Agenda', 'Invite', 'Approved', 'Board page', 'Board emailed']);
});

test('the next step walks the same order everywhere: invite, approval, board page, email, then the reports', () => {
  const steps = [
    [{}, {}, 'invite', 'send the invite'],
    [{ inviteGone: '2026-11-18T15:00:00Z' }, {}, 'invite', 'send the invite again (it was deleted in Google Calendar)'],
    [{ invite: invited(['alex.board@example.com']) }, {}, 'invite', 'add Sam Ortiz to the invite'],
    [{ invite: invited() }, {}, 'approved', 'approve the agenda'],
    [{ invite: invited() }, { approvals: { m_next0001: { by: 'Alex Rivera', at: '2026-11-19T14:00:00Z' } } }, 'shared', 'put the meeting on the board page'],
    [{ invite: invited(), shared: true }, { approvals: { m_next0001: { by: 'Alex Rivera', at: '2026-11-19T14:00:00Z' } } }, 'emailed', 'email the board the link to the agenda and documents'],
    [{ invite: invited(), shared: true, packetSentAt: '2026-11-19T15:00:00Z', packetSentTo: 2 }, { approvals: { m_next0001: { by: 'Alex Rivera', at: '2026-11-19T14:00:00Z' } } }, 'agenda', 'the reports, 0 of 2 in so far'],
  ];
  for (const [mm, dd, id, todo] of steps) {
    const m = ahead(mm);
    const data = dataFor(m, dd);
    const next = pathOf(m, data, 'ahead').find((x) => x.state === 'next');
    assert.equal(next.id, id, JSON.stringify(mm));
    assert.equal(next.todo, todo);
    assert.equal(homeOf(m, data).next?.id, id, 'home names the same one');
  }
  // Every report in too: the meeting's day is next, and home has nothing left (Ready)
  const done = ahead({ invite: invited(), shared: true, packetSentAt: '2026-11-19T15:00:00Z', packetSentTo: 2, sections: AGENDA.map((s) => ({ ...s, items: s.items.map((it) => (it.presenter ? { ...it, report: 'In.' } : it)) })) });
  const data = dataFor(done, { approvals: { m_next0001: { by: 'Alex Rivera', at: '2026-11-19T14:00:00Z' } } });
  assert.equal(pathOf(done, data, 'ahead').find((x) => x.state === 'next').id, 'day');
  assert.equal(homeOf(done, data).next, null);
});

test('who the invite is missing: a board member with an email added after it went', () => {
  const m = ahead({ invite: invited(['alex.board@example.com']) });
  assert.deepEqual(inviteMissing(m, dataFor(m)), ['sam.board@example.org']);
  assert.deepEqual(inviteMissing(ahead(), dataFor(ahead())), [], 'none before it goes');
  const path = by(pathOf(m, dataFor(m), 'ahead'));
  assert.equal(path.invite.state, 'next');
  assert.equal(path.invite.sub, 'On Jane’s calendar · Sam Ortiz not on it');
});

test('one report asked for is one report', () => {
  const m = ahead({ sections: [{ title: 'Programs', items: [{ title: 'Every makeover this year', presenter: 'Jane Doe' }, { title: 'Roll call' }] }] });
  assert.equal(by(pathOf(m, dataFor(m), 'ahead')).agenda.sub, '2 items · 0 of 1 report in');
});

// ─── Held: what happened ────────────────────────────────────────────

test('a held meeting’s line says what happened, never a chore that no longer applies', () => {
  // Years ago: no invite from Board, no email before it, minutes approved
  const old = cleanMeeting({ id: 'm_old00001', date: '2022-10-11', start: '08:00', shared: true, minutes: 'approved', approvedOn: '2022-12-10', sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }, { title: 'Year 1', items: [{ title: 'Makeovers this year' }] }] });
  const path = pathOf(old, dataFor(old), 'held');
  const s = by(path);
  assert.ok(!path.some((x) => x.state === 'todo' || x.state === 'next'), path.map((x) => `${x.title}: ${x.sub} (${x.state})`).join(' · '));
  assert.equal(s.invite.state, 'skip');
  assert.equal(s.invite.sub, 'None sent from Board');
  assert.equal(s.emailed.state, 'skip');
  assert.equal(s.emailed.sub, 'Not before the meeting');
  assert.equal(s.agenda.state, 'done');
  assert.equal(s.agenda.sub, '2 items');
  assert.ok(!s.approved, 'no approval step once it’s held');
  // Reports asked for before it, none written, then the minutes read in with items of their own: never "0 of 3"
  const read = cleanMeeting({ id: 'm_sep00001', date: '2026-09-20', shared: true, minutes: 'approved', minutesFrom: { name: 'Minutes.docx', at: '2026-09-21T14:00:00Z' },
    sections: [...AGENDA, { title: 'Committee reports', items: [{ title: 'Financial', presenter: 'Sam' }] }] });
  const r = by(pathOf(read, dataFor(read), 'held'));
  assert.equal(r.agenda.state, 'done');
  assert.equal(r.agenda.sub, '6 items');
  // ...and a report that was written is said as one
  const wrote = cleanMeeting({ ...read, sections: [{ title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', report: 'Cash is healthy.' }] }] });
  assert.equal(by(pathOf(wrote, dataFor(wrote), 'held')).agenda.sub, '1 item · 1 report');
  // Its invite did go: said as done; not on the board page yet: still to do (After shares it)
  const sent = cleanMeeting({ ...old, invite: invited(), shared: false, minutes: 'draft', approvedOn: '' });
  const t = by(pathOf(sent, dataFor(sent), 'held'));
  assert.equal(t.invite.state, 'done');
  assert.equal(t.shared.state, 'todo');
  assert.equal(t.minutes.state, 'next');
});

// ─── Days ───────────────────────────────────────────────────────────

test('a moment is the day it was in Atlanta, never the first ten characters of its UTC time', () => {
  // 10 PM on Nov 19 in Atlanta (EST) is Nov 20 in UTC; 11:30 PM on Jul 4 (EDT) is Jul 5
  assert.equal(dayOf('2026-11-20T03:00:00.000Z'), 'Nov 19, 2026');
  assert.equal(dayOf('2026-07-05T03:30:00Z'), 'Jul 4, 2026');
  assert.equal(dayOf('2026-11-19T14:00:00Z'), 'Nov 19, 2026');
  // A plain day is that day (never the evening before)
  assert.equal(dayOf('2026-11-19'), 'Nov 19, 2026');
  assert.equal(dayOf(''), '');
  assert.equal(dayOf('not a time'), '');
  // The status line's approval and email say it so
  const m = ahead({ invite: invited(), shared: true, packetSentAt: '2026-11-20T03:00:00.000Z', packetSentTo: 4 });
  const s = by(pathOf(m, dataFor(m, { approvals: { m_next0001: { by: 'Jane Doe', at: '2026-11-20T03:00:00.000Z' } } }), 'ahead'));
  assert.equal(s.approved.sub, 'Jane, Nov 19, 2026');
  assert.equal(s.emailed.sub, '4 members, Nov 19, 2026');
});

test('no Board admin screen turns a time into a day by its first ten characters', () => {
  const files = ['board-meeting.js', 'board-admin.js', 'board-ui.js', 'board-report.js'];
  const bad = [];
  for (const f of files) {
    readFileSync(new URL(`../public/admin/${f}`, import.meta.url), 'utf8').split('\n').forEach((line, i) => {
      // shortDate or longDate of something cut to ten characters: a time's UTC date
      if (/(?:shortDate|longDate)\([^()]*(?:\([^()]*\)[^()]*)*\.slice\(0,\s*10\)/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(bad, []);
});

// ─── Deleted elsewhere ──────────────────────────────────────────────

test('a save refused because the meeting was deleted is known by its status, never a lost answer or no connection', () => {
  assert.deepEqual(GONE_STATUS, [404, 410]);
  assert.equal(saveGone({ ok: false, status: 404, error: 'This meeting was deleted.' }), true);
  assert.equal(saveGone({ ok: false, status: 410, error: 'Gone' }), true);
  assert.equal(saveGone({ ok: false, status: 409, error: 'Changed meanwhile' }), false);
  assert.equal(saveGone({ ok: false, status: 502, unknown: true }), false);
  assert.equal(saveGone({ ok: false, offline: true }), false);
  assert.equal(saveGone({ ok: true, status: 200 }), false);
});
