/**
 * Board QA round 8 (Nov 21 2026), the founders' admin tester's findings: the server's side of
 *   F1  Replace the minutes is Undo of the earlier read and a new read, in one step: the replaced file's notes,
 *       decisions, action items and its approval of the last meeting come off, a change since is kept and named, and
 *       minutes approved since are refused in Undo's words
 *   F2  a reminder to answer the invite leaves a record every tab reads (who was asked, when), never kept on the meeting
 *       nor shown on the board page; the 10-minute guard stays
 *   F4  the heartbeat never changes approved minutes: what it would have added is named for the founders only
 *   F5  Undo names every change since the read that it keeps, not only the ones both ways changed
 *   F6  the read names the last meeting's minutes it marked approved, and Undo names putting them back to draft
 * Made-up people only. Run: node --test tests/board-round8-admin.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { saveMeeting, getMeeting, putFile, patchMeeting, ensureSchema, listMeetings, boardCopy, getSettings } from '../functions/api/_board.js';
import { maybeFinishMinutes } from '../functions/api/_board-minutes.js';
import { cleanMeeting, todayEastern, askedOf } from '../public/admin/board-shared.js'; /* r11: askedOf */

const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
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
class FakeR2 {
  constructor() { this.map = new Map(); }
  async put(key, bytes, opts) { this.map.set(key, { bytes: new Uint8Array(bytes), type: opts?.httpMetadata?.contentType }); }
  async get(key) { const o = this.map.get(key); return o ? { body: o.bytes, size: o.bytes.length, httpMetadata: { contentType: o.type } } : null; }
  async delete(key) { this.map.delete(key); }
}
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
];
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net']];

// The tester's minutes (A: notes under four items; E: under two; F: a motion carried; G: held, no motion; B: approves
// the last meeting's minutes), as the reader's text
const MIN_A = `Q4 Board Meeting Minutes
1. CALL TO ORDER
1. Roll Call
a. Quorum present
2. FINANCE
1. Year to date
a. ALPHA revenue is ahead of budget
2. The 2027 budget
a. ALPHA budget discussed
3. OPEN FORUM
1. Questions from the board
a. ALPHA no questions`;
const MIN_E = `Q4 Board Meeting Minutes
1. CALL TO ORDER
1. Roll Call
a. ECHO quorum present, corrected
2. FINANCE
1. Year to date
a. ECHO revenue is ahead of budget, corrected
3. OPEN FORUM
1. Questions from the board`;
const MIN_F = `Q4 Board Meeting Minutes
1. CALL TO ORDER
1. Roll Call
a. FOXTROT quorum present
2. FINANCE
1. Year to date
a. Sam Ortiz moved to adopt the FOXTROT reserve policy, and Alex Rivera seconded. The motion carried.
3. OPEN FORUM
1. Questions from the board
a. FOXTROT none`;
const MIN_G = `Q4 Board Meeting Minutes
1. CALL TO ORDER
1. Roll Call
a. GOLF quorum present
2. FINANCE
1. Year to date
a. GOLF the reserve policy was discussed and held to the next meeting; no motion was made.
3. OPEN FORUM
1. Questions from the board
a. GOLF none`;
const MIN_B = `Q4 Board Meeting Minutes
1. CALL TO ORDER
1. Roll Call
a. Quorum present
2. APPROVE MEETING MINUTES
1. Q3 Board Meeting
a. The minutes of the last meeting were approved as presented.
3. FINANCE
1. Year to date
a. BRAVO revenue is ahead of budget`;
/** What Workers AI reads from them when it answers */
const MODEL = { attendance: [], motions: [{ text: 'Approve the 2027 budget', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }], actions: [{ text: 'Send the venue contract', owner: 'Alex Rivera', due: '' }], approvedPrev: false };

let env;
let texts;
let ai;
let sent;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  texts = {};
  sent = [];
  ai = { down: true };
  env = {
    DB: await createD1(), FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test',
    AI: { toMarkdown: async (doc) => ({ name: doc.name, format: 'text', data: texts[doc.name] || '' }), run: async () => { if (ai.down) throw new Error('test: Workers AI down'); return { response: MODEL }; } },
  };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  for (const [slug, email] of EMAILS) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const b = JSON.parse(init.body);
      sent.push(...[].concat(b));
      return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function api(body, who = FOUNDER) {
  const request = new Request('https://sunshineonaranneyday.com/api/board-admin', {
    method: 'POST', headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => admin.onRequestPost(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: await res.json() };
}
const pdf = (name) => new File([new TextEncoder().encode(`%PDF-1.7\n% ${name}\n`)], name, { type: 'application/pdf' });
/** The last meeting (Q3, its minutes a draft) and the meeting held yesterday whose minutes are read in */
async function held() {
  const prev = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-90), title: 'Q3 Board Meeting', minutes: 'draft', shared: true }), { by: FOUNDER });
  const m = await saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), title: 'Q4 Board Meeting', shared: true, agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
    attendance: [{ slug: 'alex-rivera', name: 'Alex Rivera', kind: 'board' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board' }, { slug: 'kim-park', name: 'Kim Park', kind: 'board' }],
    sections: [
      { title: 'Call to order', items: [{ title: 'Roll call' }] },
      { title: 'Finance', items: [{ title: 'Year to date', notes: '- Revenue against budget' }, { title: 'The 2027 budget' }] },
      { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
    ],
  }), { by: FOUNDER });
  return { prev, m };
}
/** A minutes file put on the meeting, as the page's drop uploads it */
async function file(m, name, words) {
  texts[name] = words;
  return putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf(name), kind: 'other', by: FOUNDER });
}
const itemOf = (sections, title) => sections.flatMap((x) => x.items).find((it) => it.title === title);
const notesOf = (m, title) => m.sections.flatMap((s) => s.items).find((it) => it.title === title)?.notes || '';
const noted = (m) => m.sections.flatMap((s) => s.items).filter((it) => it.notes).map((it) => `${it.title}: ${it.notes}`);
/** A founder adds an action item on the meeting, as Board's editor saves it */
async function addAction(id, text, owner) {
  const cur = await getMeeting(env.DB, id);
  const r = await api({ action: 'save-meeting', meeting: { ...cur, actions: [...cur.actions, { id: 'a_bookvenue', text, owner: owner.slug, ownerName: owner.name }] }, base: cur.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

// ─── F1: Replace the minutes ────────────────────────────────────────

test('F1: Replace the minutes takes the replaced file’s notes off: only the new file’s notes are on the meeting and the board page', async () => {
  const { m } = await held();
  const a = await file(m, 'Minutes-A.pdf', MIN_A);
  assert.equal((await api({ action: 'read-minutes', id: m.id, fileId: a.id })).status, 200);
  assert.equal(noted(await getMeeting(env.DB, m.id)).length, 4, 'setup: notes under four items');
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(noted(after), ['Roll call: - ECHO quorum present, corrected', 'Year to date: - ECHO revenue is ahead of budget, corrected'], `only Minutes E’s notes (${JSON.stringify(noted(after))})`);
  assert.equal(after.minutesFrom?.name, 'Minutes-E.pdf');
  assert.ok(!after.files.some((f) => f.id === a.id), 'the replaced file is off');
  assert.equal(r.body.read.notes, 2, 'the toast’s count is the new file’s');
  assert.equal(r.body.replaced?.name, 'Minutes-A.pdf');
  assert.deepEqual(r.body.replaced?.left, [], 'nothing changed since: nothing to name');
  assert.deepEqual(noted(boardCopy(after)), noted(after), 'the board page shows only the new file’s notes');
  /* r9: Undo of a Replace is the meeting as it was before the Replace (round 6's rule, decided again in round 9): Minutes
     A's notes back, and their file asked for again, never a meeting with no minutes at all */
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: e.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const back = await getMeeting(env.DB, m.id);
  assert.deepEqual([back.minutesFrom?.name, notesOf(back, 'Year to date'), noted(back).length], ['Minutes-A.pdf', '- ALPHA revenue is ahead of budget', 4]);
  assert.deepEqual(u.body.left, ['The earlier minutes (Minutes A) are back on the meeting, but their file was removed when these were read in: drop it in again to keep it with them.']);
});

test('F1: Replace takes the replaced file’s decision off: minutes that held the motion over never show it as passed', async () => {
  const { m } = await held();
  const f = await file(m, 'Minutes-F.pdf', MIN_F);
  await api({ action: 'read-minutes', id: m.id, fileId: f.id });
  assert.deepEqual((await getMeeting(env.DB, m.id)).motions.map((x) => x.text), ['Adopt the FOXTROT reserve policy'], 'setup: the motion carried');
  const g = await file(m, 'Minutes-G.pdf', MIN_G);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: g.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(after.motions, [], `no decision from the replaced file (${JSON.stringify(after.motions.map((x) => x.text))})`);
  assert.deepEqual(boardCopy(after).motions, [], 'nor on the board page');
  assert.match(notesOf(after, 'Year to date'), /held to the next meeting/);
});

test('F1: a change made since the first read is kept and named; minutes marked approved since are never replaced, in Undo’s words', async () => {
  const { m } = await held();
  const a = await file(m, 'Minutes-A.pdf', MIN_A);
  await api({ action: 'read-minutes', id: m.id, fileId: a.id });
  await addAction(m.id, 'Book the spring venue', { slug: 'taylor-nguyen', name: 'Taylor Nguyen' });
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(after.actions.map((x) => x.text), ['Book the spring venue'], 'the founder’s action item stays');
  assert.deepEqual(r.body.replaced.left, ['The action item “Book the spring venue”, added since, is kept.']);
  assert.ok(!noted(after).some((x) => /ALPHA/.test(x)), 'and nothing of Minutes A');
  // Marked approved since: Replace refuses as Undo does, and nothing changes
  const cur = await getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: cur.date }, base: cur.updatedAt })).status, 200);
  const g = await file(m, 'Minutes-G.pdf', MIN_G);
  const no = await api({ action: 'read-minutes', id: m.id, fileId: g.id });
  const undoNo = await api({ action: 'undo-minutes', id: m.id, fileId: e.id });
  assert.deepEqual([no.status, no.body.error], [409, undoNo.body.error], 'Replace refuses in Undo’s words');
  assert.match(no.body.error, /^These minutes were marked approved after they were read in/);
  assert.equal((await getMeeting(env.DB, m.id)).minutesFrom?.name, 'Minutes-E.pdf', 'nothing changed');
});

// ─── F6: the last meeting's minutes, named ──────────────────────────

test('F6: the read names the last meeting whose minutes it marked approved; Undo names putting them back; Replace with minutes that don’t approve them says they’re a draft again', async () => {
  const { prev, m } = await held();
  const b = await file(m, 'Minutes-B.pdf', MIN_B);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: b.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.approvedPrev, prev.id, 'setup: the Q3 minutes are approved by the read');
  assert.deepEqual(r.body.prevApproved, { id: prev.id, date: prev.date, title: 'Q3 Board Meeting' }, 'the answer names them');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: b.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body.prevBack, { id: prev.id, date: prev.date, title: 'Q3 Board Meeting' }, 'Undo names putting them back');
  assert.equal((await getMeeting(env.DB, prev.id)).minutes, 'draft');
  // Read again, then replaced by minutes that don't approve them: a draft again, and said
  const b2 = await file(m, 'Minutes-B.pdf', MIN_B);
  await api({ action: 'read-minutes', id: m.id, fileId: b2.id });
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r2 = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal((await getMeeting(env.DB, prev.id)).minutes, 'draft', 'the replaced read’s approval is off');
  assert.deepEqual([r2.body.prevApproved, r2.body.replaced?.prevBack?.id], [null, prev.id]);
  // ...and replaced by minutes that approve them too: approved, said as these approving them
  const b3 = await file(m, 'Minutes-B2.pdf', MIN_B);
  const r3 = await api({ action: 'read-minutes', id: m.id, fileId: b3.id });
  const r4 = await api({ action: 'read-minutes', id: m.id, fileId: (await file(m, 'Minutes-B3.pdf', MIN_B)).id });
  assert.equal(r3.body.prevApproved?.id, prev.id);
  assert.deepEqual([r4.body.prevApproved?.id, r4.body.replaced?.prevBack], [prev.id, null], 'approved by the new read: never “a draft again”');
  assert.equal((await getMeeting(env.DB, prev.id)).minutes, 'approved');
});

// ─── F5: Undo names what it keeps ───────────────────────────────────

test('F5: Undo names an action item added since that it keeps, and never says “as it was” for it; with the heartbeat too', async () => {
  const { m } = await held();
  const a = await file(m, 'Minutes-A.pdf', MIN_A);
  await api({ action: 'read-minutes', id: m.id, fileId: a.id });
  await addAction(m.id, 'Book the spring venue', { slug: 'taylor-nguyen', name: 'Taylor Nguyen' });
  ai.down = false;
  assert.equal(await maybeFinishMinutes(env, { now: Date.now() }), m.id, 'setup: the heartbeat reads them again');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: a.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body.left, ['The action item “Book the spring venue”, added since, is kept.']);
  assert.equal(u.body.also, 'The decision and the action item Board read from them afterwards are off too.');
  assert.deepEqual((await getMeeting(env.DB, m.id)).actions.map((x) => x.text), ['Book the spring venue']);
});

// ─── F4: the heartbeat and approved minutes ─────────────────────────

test('F4: the heartbeat adds nothing to minutes approved before its read finished; it’s done with them, and names what it didn’t add for the founders only', async () => {
  const { m } = await held();
  const a = await file(m, 'Minutes-A.pdf', MIN_A);
  await api({ action: 'read-minutes', id: m.id, fileId: a.id });
  const cur = await getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: cur.date }, base: cur.updatedAt })).status, 200);
  ai.down = false;
  await maybeFinishMinutes(env, { now: Date.now() });
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.motions, after.actions], [[], []], `approved minutes gain nothing (${JSON.stringify([after.motions.map((x) => x.text), after.actions.map((x) => x.text)])})`);
  assert.deepEqual(after.minutesFrom.late, { motions: ['Approve the 2027 budget'], actions: ['Send the venue contract'] }, 'what it didn’t add is named');
  assert.equal(boardCopy(after).minutesFrom.late, undefined, 'never on the board page');
  assert.equal(await maybeFinishMinutes(env, { now: Date.now() + 5 * 60 * 1000 }), null, 'the pending read is cleared: never read again');
  assert.equal(JSON.stringify((await getMeeting(env.DB, m.id)).motions), '[]');
});

// ─── F2: the reminder's record ──────────────────────────────────────

test('F2: a reminder to answer the invite leaves who was asked and when on the site, read by every tab, never stored on the meeting or shown on the board page', async () => {
  const made = (await api({ action: 'new-meeting', date: inDays(9) })).body.meeting;
  await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, shared: true, invite: { eventId: 'ev_r8remind', organizer: FOUNDER, sentAt: new Date().toISOString(), replies: { 'alex-rivera': 'invited', 'sam-ortiz': 'invited', 'taylor-nguyen': 'yes' } } }));
  const r = await api({ action: 'remind-rsvp', id: made.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, 2);
  /* r11: who was asked is kept by email, as it went, and Board's page matches each to the member at that address from its
     own list of the board (board-shared.js askedOf): never a read of People in every meeting read (Board QA round 11) */
  const asked = r.body.meeting?.reminded || {};
  assert.deepEqual(Object.keys(asked).sort(), ['alex.board@example.com', 'sam.board@example.org'], `the answer carries who was asked (${JSON.stringify(r.body.meeting?.reminded)})`);
  assert.deepEqual(Object.keys(askedOf(r.body.meeting, [{ slug: 'alex-rivera', email: 'Alex.Board@example.com' }, { slug: 'sam-ortiz', email: 'sam.board@example.org' }, { slug: 'taylor-nguyen', email: 'taylor.board@example.net' }])).sort(), ['alex-rivera', 'sam-ortiz'], 'the page names them');
  assert.ok(Object.values(asked).every((t) => Date.now() - Date.parse(t) < 60_000), 'and when');
  // Another tab, or a reload: Board's data has it
  const other = (await listMeetings(env.DB)).find((x) => x.id === made.id);
  assert.deepEqual(other.reminded, asked, 'every tab reads it');
  // The 10-minute guard stays
  const again = await api({ action: 'remind-rsvp', id: made.id });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /didn’t go again/);
  // Eleven minutes on: still said, with its time
  await env.DB.prepare("UPDATE board_state SET data = json_set(data, '$.had.\"alex.board@example.com\"', ?, '$.had.\"sam.board@example.org\"', ?) WHERE key = ?")
    .bind(new Date(Date.now() - 11 * 60_000).toISOString(), new Date(Date.now() - 11 * 60_000).toISOString(), `board-send:remind:${made.id}`).run();
  const aged = (await getMeeting(env.DB, made.id)).reminded;
  /* r11: by email (above) */
  assert.ok(Math.round((Date.now() - Date.parse(aged['alex.board@example.com'])) / 60_000) === 11, 'the record’s own time');
  // Never on the meeting's own record (a save, a server write), nor on the board page
  await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, title: 'Q1 Board Meeting' }));
  const row = await env.DB.prepare('SELECT data FROM board_meetings WHERE id = ?').bind(made.id).first();
  assert.ok(!/reminded/.test(row.data), 'not kept on the meeting');
  assert.equal(boardCopy(await getMeeting(env.DB, made.id)).reminded, undefined, 'not on the board page');
});

// ─── The coordinator's answers (round 8) ────────────────────────────

const { applyMinutes, readMinutes, secretarySends } = await import('../functions/api/_board-minutes.js');
const UNTOLD = /^Board can’t tell which notes came from the old minutes \(Old minutes\), so it won’t mix the two files\. Take the old notes, decisions and action items off by hand, then add the new file\.$/;
/** Minutes put on the meeting the way Board's email reader puts them (applyMinutes, no Undo record): marked */
async function byEmail(m, name, words) {
  texts[name] = words;
  const read = await readMinutes(env, { name, text: words, meeting: m, people: [] });
  return patchMeeting(env.DB, m.id, (cur) => applyMinutes(cur, read, { fileName: name, keepMarked: true }));
}

test('answer 1: minutes with no Undo record (Board’s email reader’s): Replace takes off what their marks show came from them, keeps what a founder added, and reads the new file', async () => {
  const { m } = await held();
  await byEmail(m, 'Minutes-A.pdf', MIN_A);
  const had = await getMeeting(env.DB, m.id);
  assert.equal(noted(had).length, 4, 'setup: the email reader put notes under four items');
  assert.ok(had.minutesFrom.marks, 'and marked what it put on');
  await addAction(m.id, 'Book the spring venue', { slug: 'taylor-nguyen', name: 'Taylor Nguyen' });
  // A founder changes one note the email's minutes put there: theirs now
  const cur = await getMeeting(env.DB, m.id);
  const edited = { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.title === 'The 2027 budget' ? { ...it, notes: `${it.notes}\n- Jane to send the detail` } : it)) })) };
  assert.equal((await api({ action: 'save-meeting', meeting: edited, base: cur.updatedAt })).status, 200);
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(noted(after), ['Roll call: - ECHO quorum present, corrected', 'Year to date: - ECHO revenue is ahead of budget, corrected', 'The 2027 budget: - ALPHA budget discussed\n- Jane to send the detail'],
    `the email’s notes are off, the founder’s changed note stays, the new file’s are on (${JSON.stringify(noted(after))})`);
  assert.deepEqual(after.actions.map((x) => x.text), ['Book the spring venue'], 'the founder’s action item stays');
  assert.equal(after.minutesFrom.name, 'Minutes-E.pdf');
});

test('answer 1: minutes with no marks and no Undo record (read before either existed): never mixed, refused in plain words; with nothing on to mix, the new file goes', async () => {
  const { m } = await held();
  // As older minutes were left: notes and a decision on, which minutes they came from, nothing marked
  await patchMeeting(env.DB, m.id, (cur) => ({ ...cur, minutesFrom: { name: 'Old minutes.pdf', at: new Date().toISOString(), ai: true, tries: 0 }, motions: [{ id: 'v_oldone01', text: 'Adopt the old policy', result: 'passed' }],
    sections: cur.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.title === 'Roll call' ? { ...it, notes: '- Old notes' } : it)) })) }));
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, UNTOLD);
  const same = await getMeeting(env.DB, m.id);
  assert.deepEqual([same.minutesFrom.name, notesOf(same, 'Roll call'), same.motions.length], ['Old minutes.pdf', '- Old notes', 1], 'nothing changed');
  // The founder takes the old notes and decision off by hand: then the new file goes
  const cur = await getMeeting(env.DB, m.id);
  const cleared = { ...cur, motions: [], sections: cur.sections.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, notes: '' })) })) };
  assert.equal((await api({ action: 'save-meeting', meeting: cleared, base: cur.updatedAt })).status, 200);
  const r2 = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(noted(await getMeeting(env.DB, m.id)).length, 2);
});

test('answer 2: the secretary’s typed send refused as the minutes are is said for their page, naming nothing only founders see; founders keep Undo’s words', async () => {
  const { m } = await held();
  const a = await file(m, 'Minutes-A.pdf', MIN_A);
  await api({ action: 'read-minutes', id: m.id, fileId: a.id });
  const cur = await getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: cur.date }, base: cur.updatedAt })).status, 200);
  const secretary = { member: { slug: 'taylor-nguyen', name: 'Taylor Nguyen', seat: 'secretary', email: 'taylor.board@example.net' } };
  texts['Typed minutes.pdf'] = MIN_E;
  let err = null;
  try { await secretarySends(env, m.id, pdf('Typed minutes.pdf'), secretary, { anyway: true }); } catch (e) { err = e; }
  assert.equal(err?.status, 409);
  assert.equal(err.message, 'These minutes were marked approved since. A founder can mark them a draft again if they need changing. It wasn’t kept.');
  // The same file from a founder: Undo's words
  const f2 = await file(m, 'Minutes-E.pdf', MIN_E);
  assert.match((await api({ action: 'read-minutes', id: m.id, fileId: f2.id })).body.error, /^These minutes were marked approved after they were read in, so Undo leaves them as they are/);
  // Minutes it can't tell apart: said for their page too
  const { m: m2 } = await held();
  await patchMeeting(env.DB, m2.id, (x) => ({ ...x, minutesFrom: { name: 'Old minutes.pdf', at: new Date().toISOString(), ai: true, tries: 0 }, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.title === 'Roll call' ? { ...it, notes: '- Old notes' } : it)) })) }));
  err = null;
  try { await secretarySends(env, m2.id, pdf('Typed minutes.pdf'), secretary, { anyway: true }); } catch (e) { err = e; }
  assert.equal(err?.message, 'Board can’t tell these from the minutes already on this meeting, so it won’t mix the two. A founder can take the old minutes off first. It wasn’t kept.');
});

test('answer 3: a save never brings back an address its person has left: a meeting, a practice meeting and the agenda template, the first-moment pick and the kept-mine merge alike; an address nobody was renamed from stays', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const made = (await api({ action: 'new-meeting', date: inDays(30) })).body.meeting;
  const s0 = (await api({ action: 'save-settings', settings: {}, base: null })).body.settings;
  const { createPractice } = await import('../functions/api/_board.js');
  const practice = await createPractice(env, { by: FOUNDER });
  const r0 = await rename(env, { collection: 'team', from: 'sam-ortiz', to: 'sam-ortiz-new' }, FOUNDER, async () => Response.json({ success: true }));
  assert.equal(r0.status, 200, JSON.stringify(r0.body));
  // A page whose list of people was read before the rename picks Sam at his old address: presenter, roll and to-do
  const cur = await getMeeting(env.DB, made.id);
  const stale = {
    ...cur,
    sections: cur.sections.map((s, i) => (i === 0 ? { ...s, items: [...s.items, { id: 'i_stalesam', title: 'Treasurer’s report', who: ['sam-ortiz', 'nobody-here'], presenter: 'Sam Ortiz' }] } : s)),
    attendance: [...cur.attendance.filter((p) => p.slug !== 'sam-ortiz-new'), { slug: 'sam-ortiz', key: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board' }],
    actions: [{ id: 'a_stalesam', text: 'Send the budget', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }],
  };
  const r = await api({ action: 'save-meeting', meeting: stale, base: cur.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const saved = await getMeeting(env.DB, made.id);
  const rep = saved.sections.flatMap((x) => x.items).find((it) => it.id === 'i_stalesam');
  assert.deepEqual(rep.who, ['sam-ortiz-new', 'nobody-here'], 'the presenter at his new address; one nobody was renamed from stays');
  assert.deepEqual([saved.attendance.filter((p) => /^sam-ortiz/.test(p.slug || '')).map((p) => p.slug), saved.actions[0].owner], [['sam-ortiz-new'], 'sam-ortiz-new'], 'the roll (once) and the to-do too');
  assert.deepEqual(r.body.meeting.addressesNow, { 'sam-ortiz': 'sam-ortiz-new' }, 'and the answer says so, for the page to take');
  const row = await env.DB.prepare('SELECT data FROM board_meetings WHERE id = ?').bind(made.id).first();
  assert.ok(!/addressesNow/.test(row.data) && !row.data.includes('"sam-ortiz"'), 'never kept on the meeting, nor the old address');
  // The template, its merge keeping the page's own change to Financial (Sam at his old address, and Kim)
  const tpl = s0.template.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.title === 'Financial' ? { ...it, who: ['sam-ortiz', 'kim-park'], presenter: 'Sam Ortiz & Kim Park' } : it)) }));
  const t = await api({ action: 'save-settings', settings: { template: tpl }, base: (await getSettings(env.DB)).templateAt });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.deepEqual(itemOf((await getSettings(env.DB)).template, 'Financial').who, ['sam-ortiz-new', 'kim-park']);
  assert.deepEqual(t.body.settings.addressesNow, { 'sam-ortiz': 'sam-ortiz-new' });
  // A practice meeting the same
  // (as the practice meeting is after the rename moved its roll)
  const p1 = await (await import('../functions/api/_board.js')).getPractice(env.DB, practice.id);
  const ps = p1.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_pracstale', title: 'Practice report', who: ['sam-ortiz'] }] } : sec));
  const pr = await saveMeeting(env.DB, { ...p1, sections: ps }, { by: FOUNDER, base: p1.updatedAt });
  assert.deepEqual(pr.sections.flatMap((x) => x.items).find((it) => it.id === 'i_pracstale').who, ['sam-ortiz-new']);
});

test('answer 3: an address someone else had after its person left it is never followed to the one who left it', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const { deleteItem } = await import('../functions/api/delete-content.js');
  assert.equal((await rename(env, { collection: 'team', from: 'kim-park', to: 'kim-park-2' }, FOUNDER, async () => Response.json({ success: true }))).status, 200);
  // A newcomer added at kim-park, then taken off People: the address is nobody's, and was theirs last
  const { onRequestPost: saveContent } = await import('../functions/api/save-content.js');
  const req = { env, request: new Request('https://site.test/api/save-content', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'src/content/team/kim-park.json', content: JSON.stringify({ slug: 'kim-park', name: 'Kim Newcomer', group: 'board', title: 'Board Member', status: 'active' }), message: 'Add Kim Newcomer', create: true }) }), data: { userEmail: FOUNDER }, waitUntil: () => {} };
  const add = await saveContent(req);
  if (add.status === 200) {
    await deleteItem(env, { path: 'src/content/team/kim-park.json', message: 'Remove Kim Newcomer' }, FOUNDER, (p) => p?.catch?.(() => {}));
    const made = (await api({ action: 'new-meeting', date: inDays(31) })).body.meeting;
    const cur = await getMeeting(env.DB, made.id);
    const r = await api({ action: 'save-meeting', meeting: { ...cur, sections: cur.sections.map((s, i) => (i === 0 ? { ...s, items: [...s.items, { id: 'i_kimold', title: 'Kim’s item', who: ['kim-park'] }] } : s)) }, base: cur.updatedAt });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual((await getMeeting(env.DB, made.id)).sections.flatMap((x) => x.items).find((it) => it.id === 'i_kimold').who, ['kim-park'], 'not followed to the renamed Kim');
  } else {
    // (the site keeps the old address for the renamed Kim's records: nobody else can have had it)
    assert.equal(add.status, 409);
  }
});
