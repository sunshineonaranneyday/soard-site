/**
 * Board admin, QA round 6 (Nov 21 2026), the founders' Board editor, Home and Members: the server's side of
 *   - B1: Undo right after reading minutes in puts the meeting back on the site as it was before the read, in one step
 *     (functions/api/_board-minutes.js undoMinutes): every field the read changed, the file, and the last meeting's
 *     approval; what was changed since is left and said; a tab opened before the Undo can't mark them approved
 *   - m3: a "not a board meeting" ahead can be approved in Board, and approving it makes it a board meeting (never
 *     "That meeting isn't ahead" for one that is)
 *   - m4: the chair's review is named only when it will happen, with its day (./board-shared.js chairReviewDay)
 *   - m6: a to-do with no date whose next meeting isn't on the board page yet names that meeting, never "no meeting after it"
 *   - m8: the same founder pressing a send twice (another tab) is told "You sent", never their own name
 * Made-up people only. Run: node --test tests/board-round6-editor.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { agendaApproved } from './lib/agenda-approved.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { saveMeeting, getMeeting, putFile, patchMeeting, ensureSchema, listMeetings } from '../functions/api/_board.js';
import { reminderReach } from '../functions/api/_board-actions.js';
import * as shared from '../public/admin/board-shared.js';

const { cleanMeeting, todayEastern } = shared;

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
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
];
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org']];

/** Minutes the way SOARD writes them (tests/board-minutes.test.mjs): who was there, each part's notes, a motion, the last minutes approved */
const MINUTES = `MEETING Example Board – Minutes
LOCATION Example Hall TIME 8:00a - 10:00a
ATTENDEE COMPANY ATTENDEE COMPANY
x Alex Rivera Rivera Builders x Jane Doe SOARD
Kim Park Park Media
x Sam Ortiz Ortiz & Co
1. CALL TO ORDER
1. Roll Call
2. APPROVE MEETING MINUTES
1. Q2 Board Meeting
a. Minutes approved
3. COMMITTEE REPORTS
1. Financial (Sam)
a. Reserves grew this quarter
b. Motion to approve the 2027 budget by Alex, seconded by Sam. Motion passed.`;

let env;
let texts;
let sent;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  texts = {};
  sent = [];
  env = { DB: await createD1(), FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', AI: { toMarkdown: async (doc) => ({ name: doc.name, format: 'text', data: texts[doc.name] || '' }) } };
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
/** What a read of the minutes changes, as the tester compared it (out-p6*.txt) */
const pick = (m) => ({
  minutes: m.minutes, approvedOn: m.approvedOn, minutesFrom: m.minutesFrom?.name || null, agendaFrom: m.agendaFrom ? `${m.agendaFrom.kind}:${m.agendaFrom.name}` : null,
  attendance: m.attendance.map((a) => `${a.name}:${a.status}`), motions: m.motions.map((x) => x.text), actions: m.actions.map((x) => x.text),
  sections: m.sections.map((s) => `${s.title}: ${s.items.map((i) => `${i.title}${i.notes ? ` (${i.notes})` : ''}`).join(', ')}`),
});
const AT = new Date().toISOString();

/** The last meeting (draft minutes) and the one whose minutes are read in, with its file */
async function twoMeetings() {
  const prev = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-120), title: 'Q2 Board Meeting', minutes: 'draft' }), { by: FOUNDER });
  const m = await saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), title: 'Q3 Board Meeting', agendaFrom: { kind: 'typed', name: '', at: AT },
    sections: [{ title: 'Approve meeting minutes', items: [{ title: 'Minutes of the Q2 Board Meeting', live: 'minutes', about: prev.id }] }, { title: 'Committee reports', items: [{ title: 'Financial', live: 'cash', notes: '- Revenue against budget' }] }],
    attendance: [{ slug: 'alex-rivera', name: 'Alex Rivera', kind: 'board' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board' }, { slug: 'kim-park', name: 'Kim Park', kind: 'board' }],
  }), { by: FOUNDER });
  const file = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes-approve.pdf'), kind: 'other', by: FOUNDER });
  texts['Minutes-approve.pdf'] = MINUTES;
  return { prev, m, file };
}

// ─── B1: Undo of reading minutes in ─────────────────────────────────

test('B1: Undo right after reading minutes in puts the meeting back on the site as it was, takes the file off, and undoes the last meeting’s approval', async () => {
  const { prev, m, file } = await twoMeetings();
  const before = pick(await getMeeting(env.DB, m.id));
  const r = await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.approvedPrev, prev.id, 'setup: the read approved the last meeting’s minutes');
  assert.notDeepEqual(pick(await getMeeting(env.DB, m.id)), before, 'setup: the read changed the meeting');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  assert.equal(u.status, 200, `the site has an Undo of its own: ${JSON.stringify(u.body)}`);
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(pick(after), before, 'every field the read changed is as it was');
  assert.ok(!after.files.some((f) => f.id === file.id), 'the file is gone');
  assert.deepEqual(u.body.left, [], 'nothing left over');
  assert.deepEqual(pick(u.body.meeting), before, 'the answer is the meeting as the site has it now');
  const p = await getMeeting(env.DB, prev.id);
  assert.deepEqual([p.minutes, p.approvedOn], ['draft', ''], 'the last meeting’s minutes are back to draft');
  assert.deepEqual([u.body.prev?.id, u.body.prev?.minutes], [prev.id, 'draft'], 'and the answer carries it');
  // Once: a second press has nothing to undo, and says so in words
  const again = await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /nothing to undo/i);
  const log = (await env.DB.prepare('SELECT entity_name FROM audit_log').all()).results.map((x) => x.entity_name);
  assert.ok(log.some((x) => /^Board minutes read in, then undone: /.test(x)), log.join(' | '));
});

test('B1: changed since the read, Undo puts back what it safely can and says what it couldn’t; the last meeting approved again stays approved', async () => {
  const { prev, m, file } = await twoMeetings();
  await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  // Someone writes under one item the read filled in, and the last meeting's minutes are approved again on another day
  const cur = await getMeeting(env.DB, m.id);
  const fin = cur.sections.flatMap((s) => s.items).find((it) => it.title === 'Financial');
  assert.ok(fin && /Reserves grew/.test(fin.notes), `setup: the read put notes under Financial (${fin?.notes})`);
  const edited = { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === fin.id ? { ...it, notes: `${it.notes}\n- Sam to send the detail` } : it)) })) };
  const saved = await saveMeeting(env.DB, edited, { by: FOUNDER, base: cur.updatedAt, edit: true });
  await patchMeeting(env.DB, prev.id, (x) => ({ ...x, minutes: 'approved', approvedOn: inDays(-2) }));
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const after = await getMeeting(env.DB, m.id);
  assert.equal(after.minutesFrom, null, 'which minutes it was read from is put back');
  assert.deepEqual(after.motions, [], 'the motion the read added is gone');
  assert.equal(after.sections.flatMap((s) => s.items).find((it) => it.id === fin.id)?.notes, saved.sections.flatMap((s) => s.items).find((it) => it.id === fin.id).notes, 'the notes written since stay');
  assert.ok(u.body.left.some((x) => /^“Financial” was changed after the minutes were read, so it stays as it is now\.$/.test(x)), u.body.left.join(' | '));
  assert.ok(u.body.left.some((x) => /^The Q2 Board Meeting \(.+\) minutes stay approved: they were marked approved again after these were read\.$/.test(x)), u.body.left.join(' | '));
  assert.deepEqual([(await getMeeting(env.DB, prev.id)).minutes], ['approved']);
});

test('B1: after the Undo, a tab opened before it can’t mark the minutes approved: the site refuses, as they aren’t in Board', async () => {
  const { m, file } = await twoMeetings();
  await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  const stale = await getMeeting(env.DB, m.id); // the second tab's copy, opened before the Undo
  assert.equal(stale.minutesFrom?.name, 'Minutes-approve.pdf');
  await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  const now = await getMeeting(env.DB, m.id);
  // (its save merged onto the site's copy, or made by hand: its own minutes and file still in it)
  const r = await api({ action: 'save-meeting', meeting: { ...stale, minutes: 'approved', approvedOn: stale.date }, base: now.updatedAt });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.deepEqual(r.body.refused, ['minutes', 'approvedOn']);
  assert.equal(r.body.error, 'This meeting’s minutes aren’t in Board yet. Drop them in first.');
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.minutes, after.minutesFrom], ['draft', null], 'nothing marked approved, and the minutes stay out');
});

// ─── m3: approving a "not a board meeting" ahead ────────────────────

test('m3: a “not a board meeting” ahead can be approved in Board, and approving it makes it a board meeting', async () => {
  const made = (await api({ action: 'new-meeting', date: inDays(3) })).body.meeting;
  await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, notBoard: true, shared: false, title: 'Coffee with the gala chair' }));
  const r = await api({ action: 'approve-agenda', id: made.id });
  assert.equal(r.status, 200, `never “That meeting isn’t ahead”: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.madeBoard, true);
  const after = await getMeeting(env.DB, made.id);
  assert.equal(after.notBoard, false, 'it’s a board meeting now');
  assert.ok(r.body.approvals?.[made.id], 'and its agenda is approved');
  // A meeting gone by is still "isn't ahead"; one that's gone says so
  const past = (await api({ action: 'new-meeting', date: inDays(-3) })).body.meeting;
  assert.equal((await api({ action: 'approve-agenda', id: past.id })).body.error, 'That meeting isn’t ahead');
  assert.equal((await api({ action: 'approve-agenda', id: 'm_gone0001' })).body.error, 'That meeting is gone');
});

// ─── m4: the chair's review, only when it will happen ───────────────

test('m4: the chair’s review is named only when it will happen, with its day', () => {
  assert.equal(typeof shared.chairReviewDay, 'function', 'board-shared.js has the rule');
  const today = '2026-11-21';
  const m = (more = {}) => cleanMeeting({ id: 'm_r6rev001', date: '2026-11-30', ...more });
  const on = { asks: 'on', chair: true, approved: false, today };
  assert.equal(shared.chairReviewDay(m(), on), '2026-11-24', 'nine days ahead: six days before it');
  assert.equal(shared.chairReviewDay(m(), { ...on, asks: 'test' }), '', 'the review emails in Test: the chair gets nothing');
  assert.equal(shared.chairReviewDay(m(), { ...on, chair: false }), '', 'no chair with an email');
  assert.equal(shared.chairReviewDay(m(), { ...on, approved: true }), '', 'approved already');
  assert.equal(shared.chairReviewDay(m({ shared: true }), on), '', 'on the board page: its review is shut as approved');
  assert.equal(shared.chairReviewDay(m({ notBoard: true }), on), '', 'not a board meeting');
  assert.equal(shared.chairReviewDay(m({ date: today }), on), '', 'its own day');
  assert.equal(shared.chairReviewDay(m({ date: '2026-11-27' }), on), '', 'six days ahead or fewer: gone, or never');
});

// ─── m6: reminders, a to-do whose next meeting isn't on the board page ─

test('m6: a to-do with no date whose next meeting isn’t on the board page yet names it, never “no meeting after it”', async () => {
  const held = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-1), title: 'Q4 2026 Board Meeting', actions: [{ text: 'Find a caterer for the gala', owner: 'alex-rivera', ownerName: 'Alex Rivera', due: '' }] }), { by: FOUNDER });
  await patchMeeting(env.DB, held.id, (cur) => ({ ...cur, shared: true }));
  const next = await saveMeeting(env.DB, cleanMeeting({ date: inDays(100), title: 'Q1 2027 Board Meeting' }), { by: FOUNDER });
  let r = await reminderReach(env.DB, await listMeetings(env.DB));
  const short = shared.shortDate(next.date).replace(/, \d{4}$/, '');
  assert.ok(!/no meeting after/.test(r.why), r.why);
  assert.equal(r.why, `The to-do for Alex Rivera has no due date, so it’s due by the next meeting, the Q1 2027 Board Meeting on ${short}, and that isn’t on the board page yet: no reminder goes until it is.`);
  // With no meeting after it at all: said as that
  await env.DB.prepare('DELETE FROM board_meetings WHERE id = ?').bind(next.id).run();
  r = await reminderReach(env.DB, await listMeetings(env.DB));
  assert.match(r.why, /has no due date and no meeting after it yet/);
});

// ─── m8: your own other tab is "you" ────────────────────────────────

test('m8: pressing a send again in another tab is told “You sent this email”, never the founder’s own name', async () => {
  const made = (await api({ action: 'new-meeting', date: inDays(12) })).body.meeting;
  await patchMeeting(env.DB, made.id, (cur) => ({ ...cur, shared: true }));
  await agendaApproved(env.DB, made.id);
  const first = await api({ action: 'send-packet', id: made.id });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await api({ action: 'send-packet', id: made.id });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'You sent this email to the board a moment ago, maybe in another tab, so it didn’t go again. It can go again 10 minutes after the last one.');
  assert.doesNotMatch(second.body.error, /Jane/);
});
