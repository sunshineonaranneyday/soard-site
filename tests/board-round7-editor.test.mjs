/**
 * Board admin, QA round 7 (Nov 21 2026), the founders' Board editor: the server's side of
 *   - M1: what the heartbeat adds while finishing the same read of the minutes (maybeFinishMinutes: the model's decision
 *     and action item) is part of that read: Undo takes it off too and says so, and a person's change since is still
 *     kept and named (functions/api/_board-minutes.js finishUndo, undoMinutes)
 *   - M2: Undo's no carries the meeting as the site has it, so the page shows why (approved in another tab)
 *   - m5: "notes under N items" counts the items the minutes put notes under, never an agenda item's own background
 *     notes (functions/api/_board-minutes.js notesRead), the look first (dry) the same
 * (m3, the chair's review of a meeting already on the board page: tests/board-asks.test.mjs, "round 7 m3".)
 * Made-up people only. Run: node --test tests/board-round7-editor.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { saveMeeting, getMeeting, putFile, ensureSchema } from '../functions/api/_board.js';
import { maybeFinishMinutes } from '../functions/api/_board-minutes.js';
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
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org']];

/** The tester's Minutes-A (out-p1-hb.txt): notes under four items, and nothing the rules read as a motion or a task */
const NOTES_ONLY = `Q4 Board Meeting Minutes
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
/** The tester's Minutes-D (out-p1-att.txt): who was there, and nothing under any item */
const WHO_ONLY = `Q4 Board Meeting Minutes
Present: Alex Rivera, Sam Ortiz
Absent: Kim Park
The meeting was called to order at 8:02 AM and adjourned at 9:55 AM.`;
/** Who was there, and notes under one item (Year to date) */
const ONE_NOTE = `Q4 Board Meeting Minutes
Present: Alex Rivera, Sam Ortiz
Absent: Kim Park
1. CALL TO ORDER
1. Roll Call
2. FINANCE
1. Year to date
a. Cash is steady`;
/** What Workers AI reads from them when it answers (the tester's /__qa/aifail model) */
const MODEL = { attendance: [], motions: [{ text: 'Approve the 2027 budget', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }], actions: [{ text: 'Send the venue contract', owner: 'Alex Rivera', due: '' }], approvedPrev: false };

let env;
let texts;
let ai;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  texts = {};
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
/** What a read of the minutes changes, as the tester compared it (out-p1-hb.txt) */
const pick = (m) => ({
  minutes: m.minutes, minutesFrom: m.minutesFrom?.name || null, attendance: m.attendance.filter((a) => a.status).map((a) => `${a.name}:${a.status}`),
  motions: m.motions.map((x) => x.text), actions: m.actions.map((x) => x.text),
  notes: m.sections.flatMap((s) => s.items.map((i) => `${i.title}: ${i.notes || ''}`)),
});
/** The tester's Nov 30, held yesterday: its 2.1 has background notes written on the agenda */
async function held(name, words) {
  const m = await saveMeeting(env.DB, cleanMeeting({
    date: inDays(-1), title: 'Q4 Board Meeting', shared: true, agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
    attendance: [{ slug: 'alex-rivera', name: 'Alex Rivera', kind: 'board' }, { slug: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board' }, { slug: 'kim-park', name: 'Kim Park', kind: 'board' }],
    sections: [
      { title: 'Call to order', items: [{ title: 'Roll call' }] },
      { title: 'Finance', items: [{ title: 'Year to date', notes: '- Revenue against budget\n- Cash over the next 13 weeks' }, { title: 'The 2027 budget' }] },
      { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
    ],
  }), { by: FOUNDER });
  const file = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf(name), kind: 'other', by: FOUNDER });
  texts[name] = words;
  return { m, file };
}
const notesOf = (m, title) => m.sections.flatMap((s) => s.items).find((it) => it.title === title)?.notes || '';

// ─── M1: Undo after the heartbeat finished reading the minutes ──────

test('M1: Undo after the heartbeat finished the minutes takes their decision and action item off too, and says so', async () => {
  const { m, file } = await held('Minutes-A.pdf', NOTES_ONLY);
  const before = pick(await getMeeting(env.DB, m.id));
  // Read with Workers AI down: the rules read the notes; the decision and the to-do wait for the heartbeat
  const r = await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.read.ai, r.body.read.motions, r.body.read.actions], [false, 0, 0], 'setup: read by the rules alone');
  ai.down = false;
  assert.equal(await maybeFinishMinutes(env, { now: Date.now() }), m.id, 'setup: the heartbeat reads them again');
  const done = await getMeeting(env.DB, m.id);
  assert.deepEqual([done.motions.map((x) => x.text), done.actions.map((x) => x.text), done.minutesFrom.ai], [['Approve the 2027 budget'], ['Send the venue contract'], true], 'setup: the model’s decision and action item are on');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(after.motions, [], 'the decision the heartbeat read is off');
  assert.deepEqual(after.actions, [], 'and its action item (it would be in reminder emails)');
  assert.deepEqual(pick(after), before, 'the meeting is as it was before the read');
  assert.deepEqual(u.body.left, [], 'nothing left over: nobody changed anything since');
  assert.equal(u.body.also, 'The decision and the action item Board read from them afterwards are off too.', 'and the words say what it put back');
});

test('M1: a person’s change between the read and the heartbeat is still kept and named; the heartbeat’s additions come off', async () => {
  const { m, file } = await held('Minutes-A.pdf', NOTES_ONLY);
  await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  // Jane adds to the notes the read put under Questions from the board
  const cur = await getMeeting(env.DB, m.id);
  const q = cur.sections.flatMap((s) => s.items).find((it) => it.title === 'Questions from the board');
  assert.match(q.notes, /ALPHA no questions/, 'setup: the read put notes there');
  const edited = { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === q.id ? { ...it, notes: `${it.notes}\n- Jane to follow up` } : it)) })) };
  const s = await api({ action: 'save-meeting', meeting: edited, base: cur.updatedAt });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  ai.down = false;
  await maybeFinishMinutes(env, { now: Date.now() });
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.motions, after.actions], [[], []], 'the heartbeat’s decision and action item are off');
  assert.equal(notesOf(after, 'Questions from the board'), `${q.notes}\n- Jane to follow up`, 'what Jane wrote stays');
  assert.deepEqual(u.body.left, ['“Questions from the board” was changed after the minutes were read, so it stays as it is now.']);
  assert.equal(u.body.also, 'The decision and the action item Board read from them afterwards are off too.');
  assert.equal(after.minutesFrom, null);
});

test('M1: read with the model the first time, Undo says nothing of afterwards', async () => {
  ai.down = false;
  const { m, file } = await held('Minutes-A.pdf', NOTES_ONLY);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  assert.equal(r.body.read.ai, true);
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  assert.equal(u.status, 200);
  assert.deepEqual([(await getMeeting(env.DB, m.id)).motions, u.body.also], [[], '']);
});

// ─── M2: Undo's no carries the meeting ──────────────────────────────

test('M2: Undo refused because the minutes were marked approved elsewhere carries the meeting as the site has it', async () => {
  ai.down = false;
  const { m, file } = await held('Minutes-A.pdf', NOTES_ONLY);
  await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  // The other tab marks them approved
  const cur = await getMeeting(env.DB, m.id);
  const s = await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: cur.date }, base: cur.updatedAt });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: file.id });
  assert.equal(u.status, 409);
  assert.match(u.body.error, /^These minutes were marked approved after they were read in/);
  assert.equal(u.body.meeting?.id, m.id, 'the no carries the meeting');
  assert.deepEqual([u.body.meeting.minutes, u.body.meeting.updatedAt], ['approved', (await getMeeting(env.DB, m.id)).updatedAt], 'as the site has it now');
  // Nothing left to undo: said, with the meeting too
  const v = await api({ action: 'undo-minutes', id: m.id, fileId: 'f_nothing01' });
  assert.equal(v.status, 409);
  assert.equal(v.body.meeting?.minutes, 'approved');
});

// ─── m5: "notes under N items" ──────────────────────────────────────

test('m5: minutes with only who was there say nothing of notes, never counting the agenda’s own background notes', async () => {
  const { m, file } = await held('Minutes-D.pdf', WHO_ONLY);
  const dry = await api({ action: 'read-minutes', id: m.id, fileId: file.id, dry: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.equal(dry.body.read.notes, 0, 'the look first: no notes');
  const r = await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.read.attendance.here, r.body.read.attendance.of], [2, 3], 'setup: who was there is read');
  assert.equal(r.body.read.notes, 0, '2.1’s background notes are the agenda’s, not the minutes’');
  assert.equal(notesOf(await getMeeting(env.DB, m.id), 'Year to date'), '- Revenue against budget\n- Cash over the next 13 weeks', 'and they stay as written');
});

test('m5: minutes with notes under one item count that item only', async () => {
  const { m, file } = await held('Minutes-one.pdf', ONE_NOTE);
  const r = await api({ action: 'read-minutes', id: m.id, fileId: file.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(notesOf(await getMeeting(env.DB, m.id), 'Year to date'), '- Cash is steady', 'setup: the minutes’ notes went under 2.1');
  assert.equal(r.body.read.notes, 1);
});
