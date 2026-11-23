/**
 * Board QA round 9 (Nov 22 2026), the founders' admin tester's minutes findings: the server's side of
 *   1  minutes marked approved are left as they are however they came onto the meeting (read in, typed, or only a file
 *      kept with it): a drop onto them is refused in read-in approved minutes' words, and their file is never deleted.
 *      Which minutes file a meeting keeps is the site's to say, in the same step as the read; Undo names a file it
 *      can't bring back, never "as it was"
 *   2  Undo right after Replace puts the replaced minutes back (notes, decisions, action items, the last meeting's
 *      approval they made) and asks for their file again, never leaving the meeting with no minutes
 *   6  a drop from a page that hasn't seen the email reader's minutes takes their file off too
 *   8  the costs slide's heading is built from its parts: no comma with nothing after it
 * Made-up people only. Run: node --test tests/board-round9-minutes.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { saveMeeting, getMeeting, putFile, patchMeeting, ensureSchema, boardCopy } from '../functions/api/_board.js';
import { readMinutes, applyMinutes, minutesNewer, minutesPeople } from '../functions/api/_board-minutes.js';
import { MAIL_BY } from '../functions/api/_board-mail.js';
import { cleanMeeting, todayEastern } from '../public/admin/board-shared.js';

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
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
];

// The tester's minutes, as the reader's text (A: notes under four items; E: under two; B: approves the last meeting's)
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
const MODEL = { attendance: [], motions: [{ text: 'Approve the 2027 budget', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }], actions: [{ text: 'Send the venue contract', owner: 'Alex Rivera', due: '' }], approvedPrev: false };

let env;
let texts;
let ai;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  texts = {};
  ai = { down: true };
  env = {
    DB: await createD1(), FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD,
    AI: { toMarkdown: async (doc) => ({ name: doc.name, format: 'text', data: texts[doc.name] || '' }), run: async () => { if (ai.down) throw new Error('test: Workers AI down'); return { response: MODEL }; } },
  };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
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
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ title: 'Year to date', notes: '- Revenue against budget' }, { title: 'The 2027 budget' }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const ROLL = [{ slug: 'alex-rivera', name: 'Alex Rivera', kind: 'board' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board' }, { slug: 'kim-park', name: 'Kim Park', kind: 'board' }];
/** The last meeting (Q3, its minutes a draft) and the meeting held yesterday whose minutes are read in */
async function held(extra = {}) {
  const prev = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-90), title: 'Q3 Board Meeting', minutes: 'draft', shared: true }), { by: FOUNDER });
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-1), title: 'Q4 Board Meeting', shared: true, agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() }, attendance: ROLL, sections: AGENDA, ...extra }), { by: FOUNDER });
  return { prev, m };
}
/** A minutes file put on the meeting, as the page's drop uploads it (or kept as the minutes, never read in: `kind`) */
async function file(m, name, words, kind = 'other', by = FOUNDER) {
  texts[name] = words;
  return putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf(name), kind, by });
}
/** Board's email reader reading minutes onto a past meeting and filing their file, as ../functions/api/_board-mail.js bringIn does */
async function mailed(m, name, words) {
  texts[name] = words;
  const read = await readMinutes(env, { name, text: words, meeting: m, people: await minutesPeople(env.DB), prev: null, quick: true });
  const now = Date.now();
  await patchMeeting(env.DB, m.id, (cur) => (minutesNewer(cur, { name, at: new Date(now).toISOString() }) ? applyMinutes(cur, read, { fileName: name, now, keepMarked: true, minSections: 2, agendaFrom: { kind: 'email', name, at: new Date(now).toISOString(), v: 1 } }) : cur));
  return putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf(name), kind: 'minutes', by: MAIL_BY });
}
const notesOf = (m, title) => m.sections.flatMap((s) => s.items).find((it) => it.title === title)?.notes || '';
const noted = (m) => m.sections.flatMap((s) => s.items).filter((it) => it.notes).map((it) => `${it.title}: ${it.notes}`);
const fileNames = (m) => m.files.map((f) => `${f.name}[${f.kind}]`);
const sameRecord = (m) => JSON.stringify({ ...m, updatedAt: '', updatedBy: '' });

// ─── 1: approved minutes, however they came onto the meeting ────────

test('1: approved minutes kept only as a file: a drop is refused in read-in approved minutes’ words, the file stays, the meeting and the board page are unchanged', async () => {
  const { m } = await held({
    minutes: 'approved', approvedOn: inDays(-1),
    motions: [{ text: 'Approve the 2027 budget as presented', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }],
    sections: AGENDA.map((s) => (s.title === 'Finance' ? { ...s, items: [{ title: 'Year to date', notes: '- The gala sold out' }, { title: 'The 2027 budget' }] } : s)),
  });
  const kept = await file(m, 'Minutes.pdf', MIN_A, 'minutes');
  // (the page's drop uploads Minutes E first: a no takes that copy off again, BoardMeeting MinutesDrop refuse)
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const before = await getMeeting(env.DB, m.id);
  assert.equal(before.minutesFrom, null, 'setup: never read in, only a file kept with them');
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'These minutes are marked approved, so Board leaves them as they are. Mark them as draft first (After the meeting), then drop in the new file.');
  const after = await getMeeting(env.DB, m.id);
  assert.ok(after.files.some((f) => f.id === kept.id && f.kind === 'minutes'), 'Minutes.pdf is still the minutes');
  assert.deepEqual([after.minutesFrom, notesOf(after, 'Year to date'), after.motions.map((x) => x.text)], [null, '- The gala sold out', ['Approve the 2027 budget as presented']]);
  assert.equal(sameRecord(after), sameRecord(before), 'nothing on the meeting changed');
  assert.equal(JSON.stringify(boardCopy(after)), JSON.stringify(boardCopy(before)), 'nor on the board page');
  // ...nor asked to read anyway (another meeting's file), nor by the board's secretary's route: the same refusal
  const again = await api({ action: 'read-minutes', id: m.id, fileId: e.id, anyway: true });
  assert.deepEqual([again.status, again.body.error], [409, r.body.error]);
});

test('1: read-in minutes with no Undo record (the email reader’s) are refused alike once approved; a meeting marked approved with no minutes in Board yet still takes them', async () => {
  // A past meeting added from its old agenda comes in marked approved, its minutes not in Board yet (minutesNotReady:
  // "Drop them in first"): the drop reads them in, as the main board suite does
  const { m } = await held({ minutes: 'approved', approvedOn: inDays(-1) });
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const first = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual([(await getMeeting(env.DB, m.id)).minutesFrom?.name, (await getMeeting(env.DB, m.id)).minutes], ['Minutes-E.pdf', 'approved']);
  // ...and once they're in, approved, nothing more goes over them
  const a0 = await file(m, 'Minutes-A.pdf', MIN_A);
  const over = await api({ action: 'read-minutes', id: m.id, fileId: a0.id });
  assert.equal(over.status, 409);
  assert.match(notesOf(await getMeeting(env.DB, m.id), 'Year to date'), /ECHO/);
  // The email reader's minutes, approved: no Undo record, the same words, its file kept
  const { m: m2 } = await held({ date: inDays(-2) });
  const a = await mailed(m2, 'Minutes-A.pdf', MIN_A);
  const cur = await getMeeting(env.DB, m2.id);
  assert.equal((await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: cur.date }, base: cur.updatedAt })).status, 200);
  const e2 = await file(m2, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m2.id, fileId: e2.id });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /^These minutes are marked approved, so Board leaves them as they are/);
  const after = await getMeeting(env.DB, m2.id);
  assert.ok(after.files.some((f) => f.id === a.id), 'the approved file stays');
  assert.match(notesOf(after, 'Year to date'), /ALPHA/);
});

test('1: a draft meeting’s minutes kept only as a file: the site takes that file off with the read, the page’s copy never decides; Undo names it, never “as it was”', async () => {
  const { m } = await held();
  const kept = await file(m, 'Minutes.pdf', MIN_A, 'minutes');
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.filesOff, [kept.id], 'the answer names the file that came off');
  assert.deepEqual(fileNames(await getMeeting(env.DB, m.id)), ['Minutes-E.pdf[minutes]'], 'one minutes file: the one read in');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: e.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body.left, ['The earlier minutes file (Minutes) was removed when these were read in: drop it in again to keep it with the meeting.']);
  const back = await getMeeting(env.DB, m.id);
  assert.deepEqual([back.minutesFrom, notesOf(back, 'Year to date'), back.files.length], [null, '- Revenue against budget', 0]);
});

// ─── 2: Undo right after Replace ────────────────────────────────────

test('2: Undo right after Replace puts Minutes A back (notes, decision, action item) and asks for its file again; the board page shows them', async () => {
  const { m } = await held();
  ai.down = false;
  const a = await file(m, 'Minutes-A.pdf', MIN_A);
  assert.equal((await api({ action: 'read-minutes', id: m.id, fileId: a.id })).status, 200);
  const withA = await getMeeting(env.DB, m.id);
  assert.deepEqual([withA.motions.map((x) => x.text), withA.actions.map((x) => x.text), noted(withA).length], [['Approve the 2027 budget'], ['Send the venue contract'], 4], 'setup: Minutes A read in');
  ai.down = true;
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(noted(await getMeeting(env.DB, m.id)), ['Roll call: - ECHO quorum present, corrected', 'Year to date: - ECHO revenue is ahead of budget, corrected'], 'Replace: only Minutes E');
  assert.deepEqual(r.body.filesOff, [a.id]);
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: e.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body.left, ['The earlier minutes (Minutes A) are back on the meeting, but their file was removed when these were read in: drop it in again to keep it with them.']);
  const back = await getMeeting(env.DB, m.id);
  assert.equal(back.minutesFrom?.name, 'Minutes-A.pdf');
  assert.deepEqual(noted(back), noted(withA), 'Minutes A’s notes, as they were');
  assert.deepEqual([back.motions.map((x) => x.text), back.actions.map((x) => x.text)], [['Approve the 2027 budget'], ['Send the venue contract']]);
  assert.deepEqual(back.files, [], 'Minutes E’s file is off; Minutes A’s was removed at the Replace (said)');
  assert.deepEqual(noted(boardCopy(back)), noted(withA), 'the board page has Minutes A again');
  // Minutes A dropped in again: read over by their marks, never mixed with what was there
  const a2 = await file(m, 'Minutes-A.pdf', MIN_A);
  assert.equal((await api({ action: 'read-minutes', id: m.id, fileId: a2.id })).status, 200);
  const again = await getMeeting(env.DB, m.id);
  assert.deepEqual([noted(again), fileNames(again)], [noted(withA), ['Minutes-A.pdf[minutes]']]);
});

test('2: Replace over a Replace still reads only the newest file (the record keeps what each read went onto)', async () => {
  const { m } = await held();
  for (const [name, words] of [['Minutes-A.pdf', MIN_A], ['Minutes-B.pdf', MIN_B]]) {
    const f = await file(m, name, words);
    assert.equal((await api({ action: 'read-minutes', id: m.id, fileId: f.id })).status, 200);
  }
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(noted(after), ['Roll call: - ECHO quorum present, corrected', 'Year to date: - ECHO revenue is ahead of budget, corrected'], `nothing of A or B (${JSON.stringify(noted(after))})`);
  assert.deepEqual([fileNames(after), r.body.replaced?.left], [['Minutes-E.pdf[minutes]'], []]);
});

test('2: the replaced minutes approved the last meeting’s and the new ones don’t: Undo marks them approved again, and says so', async () => {
  const { prev, m } = await held();
  const b = await file(m, 'Minutes-B.pdf', MIN_B);
  const rb = await api({ action: 'read-minutes', id: m.id, fileId: b.id });
  assert.equal(rb.body.approvedPrev, prev.id, 'setup: Minutes B approve the Q3 minutes');
  const approvedOn = (await getMeeting(env.DB, prev.id)).approvedOn;
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.body.replaced?.prevBack?.id, prev.id, 'Replace: the Q3 minutes are a draft again (round 8)');
  assert.equal((await getMeeting(env.DB, prev.id)).minutes, 'draft');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: e.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual([u.body.prevAgain, u.body.prevBack], [{ id: prev.id, date: prev.date, title: 'Q3 Board Meeting' }, null], 'named as approved again');
  const p = await getMeeting(env.DB, prev.id);
  assert.deepEqual([p.minutes, p.approvedOn], ['approved', approvedOn], 'as Minutes B left them');
  assert.match(notesOf(await getMeeting(env.DB, m.id), 'Year to date'), /BRAVO/);
});

test('2: the replaced minutes and the new ones both approve the last meeting’s: Undo leaves them approved, and says nothing of it', async () => {
  const { prev: prev2, m: m2 } = await held();
  for (const name of ['Minutes-B.pdf', 'Minutes-B2.pdf']) await api({ action: 'read-minutes', id: m2.id, fileId: (await file(m2, name, MIN_B)).id });
  assert.equal((await getMeeting(env.DB, prev2.id)).minutes, 'approved');
  const files = (await getMeeting(env.DB, m2.id)).files;
  const u2 = await api({ action: 'undo-minutes', id: m2.id, fileId: files.at(-1).id });
  assert.equal(u2.status, 200, JSON.stringify(u2.body));
  assert.deepEqual([u2.body.prevAgain, u2.body.prevBack, (await getMeeting(env.DB, prev2.id)).minutes], [null, null, 'approved']);
});

// ─── 6: the email reader's minutes, a page that hadn't seen them ────

test('6: minutes the email reader brought in, then a drop from a page that never saw them: their file comes off on the site, the board page lists only the new one; Undo puts them back and asks for their file', async () => {
  const { m } = await held();
  const pageCopy = await getMeeting(env.DB, m.id); // the page, opened before the email reader's minutes came in
  assert.equal(pageCopy.files.length, 0);
  const a = await mailed(m, 'Minutes-A.pdf', MIN_A);
  assert.equal((await getMeeting(env.DB, m.id)).minutesFrom?.name, 'Minutes-A.pdf', 'setup: the email reader read them in');
  const e = await file(m, 'Minutes-E.pdf', MIN_E);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.filesOff, [a.id], 'the email reader’s file came off with the read, whatever the page knew');
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(fileNames(after), ['Minutes-E.pdf[minutes]']);
  assert.deepEqual(boardCopy(after).files.map((f) => f.name), ['Minutes-E.pdf'], 'the board page lists only the new file');
  assert.ok(!noted(after).some((x) => /ALPHA/.test(x)), 'and none of Minutes A’s notes');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: e.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body.left, ['The earlier minutes (Minutes A) are back on the meeting, but their file was removed when these were read in: drop it in again to keep it with them.']);
  assert.match(notesOf(await getMeeting(env.DB, m.id), 'Year to date'), /ALPHA/);
});

// ─── 8: the costs slide's heading ───────────────────────────────────

test('8: the costs headings are built from their parts: no comma with nothing after it', async () => {
  const { seasonsTitle } = await import('../public/admin/board/costs.js');
  assert.equal(seasonsTitle('Completed makeovers by room', []), 'Completed makeovers by room');
  assert.equal(seasonsTitle('Completed makeovers by room', null), 'Completed makeovers by room');
  assert.equal(seasonsTitle('Completed makeovers by room', [2026, 2025]), 'Completed makeovers by room, 2025 and 2026');
  assert.equal(seasonsTitle('Median makeover', ['', null]), 'Median makeover');
});
