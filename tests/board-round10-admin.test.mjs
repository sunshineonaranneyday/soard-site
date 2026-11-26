/**
 * Board QA round 10 (Nov 22 2026), the founders' admin tester's findings:
 *   1  approved minutes in Board are the record however a file comes to them: one sent as the minutes (Every file's Add
 *      files, the upload API) is kept as an ordinary file of the meeting, and said; a change of kind to Minutes is refused
 *      in the same words. Approval keeps which file it was, and the editor (ownMinutesFile) and the board page
 *      (minutesFileOf) both open that one, never a newer file nor any PDF
 *   2  (the founders' page: a send's question is built only from the read at the press; see
 *      scripts/test-board-round10-admin.mjs, which presses it in a browser)
 *   3  a save that meets saves made meanwhile is told every one of them, and the question names everyone whose save
 *      changed what clashes (a rename that only followed an address never counts): the agenda template, a meeting, and
 *      a practice meeting, which share the question
 *   4  a Replace of the minutes that loses to another at the same moment says so in its own words, naming what won
 * Made-up people only (the repo is public). Run: node --test tests/board-round10-admin.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { ensureSchema, getMeeting, saveMeeting, saveSettings, getSettings, putFile, createPractice, setOnMeeting } from '../functions/api/_board.js';
import * as shared from '../public/admin/board-shared.js';
import * as page from '../public/admin/board-meeting.js';

const { cleanMeeting, mergeMeeting, todayEastern, followAddresses, forBoard, minutesFileOf, ownMinutesFile } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const OTHER = 'holly@soardcharity.com';
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
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
];
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net']];
const AS_A_FILE = 'The minutes are approved, so this was added as a file, not as the minutes. Mark them as draft first to replace them.';
const NOT_THE_MINUTES = 'The minutes are approved, so this stays a file, not the minutes. Mark them as draft first to replace them.';

let env;
let texts;
let gate; // (a read held part way: { name, reached, release }, so another can finish meanwhile)
const realFetch = globalThis.fetch;
beforeEach(async () => {
  texts = {};
  gate = null;
  env = {
    DB: await createD1(), FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD,
    AI: {
      toMarkdown: async (doc) => {
        if (gate && doc.name === gate.name) { gate.reached(); await gate.held; }
        return { name: doc.name, format: 'text', data: texts[doc.name] || '' };
      },
      run: async () => { throw new Error('test: Workers AI down'); },
    },
  };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
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

/** /api/board-admin behind the real sign-in middleware, as `who`: JSON, or a file as the page's upload sends it (`form`) */
async function call(who, { body = null, form = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com/api/board-admin${form ? '?upload=1' : ''}`, {
    method: 'POST', headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || JSON.stringify(body),
  });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => admin.onRequestPost(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: await res.json() };
}
const api = (body, who = FOUNDER) => call(who, { body });
const pdf = (name) => new File([new TextEncoder().encode(`%PDF-1.7\n% ${name}\n`)], name, { type: 'application/pdf' });
const docx = (name) => new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, ...new TextEncoder().encode(name)])], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
/** Every file's Add files: the page's upload, filed by its name ("Minutes…" as the minutes) */
async function addFile(m, f, kind) {
  const form = new FormData();
  form.set('ownerType', 'meeting');
  form.set('ownerId', m.id);
  form.set('kind', kind);
  form.set('file', f);
  return call(FOUNDER, { form });
}
const rename = async (from, to) => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, FOUNDER, async () => Response.json({ success: true }));
const addPerson = (slug, d) => env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
const itemOf = (sections, title) => sections.flatMap((s) => s.items).find((it) => it.title === title);
const later = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const kinds = (m) => m.files.map((f) => `${f.name}[${f.kind}]`);
/** Which file each side opens as the minutes: the editor's "Written up in", the board page's "The minutes as written" */
const opened = (m) => ({ editor: ownMinutesFile(m)?.name || null, board: minutesFileOf(forBoard({ ...m, shared: true }))?.name || null });

/** The tester's held meeting: 60 days ago, "Approved" a month ago, its minutes only as Minutes.docx, never read in */
async function approvedAsAFile() {
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-60), title: 'Q3 Board Meeting', shared: true, minutes: 'approved', approvedOn: inDays(-30) }), { by: FOUNDER });
  await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: docx('Minutes.docx'), kind: 'minutes', by: FOUNDER });
  return getMeeting(env.DB, m.id);
}

// ─── 1: approved minutes, whatever way a file comes ─────────────────

test('1: approved minutes kept only as a file: a file added as the minutes (Every file) is kept as an ordinary file and said; the editor and the board page still open Minutes', async () => {
  const m = await approvedAsAFile();
  assert.deepEqual(opened(m), { editor: 'Minutes.docx', board: 'Minutes.docx' }, 'setup');
  for (const f of [pdf('Minutes-revised.pdf'), docx('Minutes-final.docx')]) {
    const r = await addFile(m, f, 'minutes');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.file.kind, 'other', `${f.name}: an ordinary file of the meeting`);
    assert.equal(r.body.asFile, AS_A_FILE, `${f.name}: said in the decided words`);
  }
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(kinds(after), ['Minutes.docx[minutes]', 'Minutes-revised.pdf[other]', 'Minutes-final.docx[other]']);
  assert.deepEqual(opened(after), { editor: 'Minutes.docx', board: 'Minutes.docx' }, 'the minutes as written are the ones approved, both ways');
  assert.equal(after.minutes, 'approved');
});

test('1: a file’s ⋯ → Minutes on approved minutes is refused in the same words, nothing changed; any other change to it still goes', async () => {
  const m = await approvedAsAFile();
  const map = await addFile(m, pdf('Parking-map.pdf'), 'other');
  assert.equal(map.body.asFile, undefined, 'an ordinary file, asked as one: nothing to say');
  const r = await api({ action: 'update-file', id: map.body.file.id, kind: 'minutes' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, NOT_THE_MINUTES);
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(kinds(after), ['Minutes.docx[minutes]', 'Parking-map.pdf[other]']);
  assert.deepEqual(opened(after), { editor: 'Minutes.docx', board: 'Minutes.docx' });
  // (renamed, made staff only, filed under Financial statements: as ever; and the approved file itself, filed as it is)
  assert.equal((await api({ action: 'update-file', id: map.body.file.id, name: 'Parking.pdf', kind: 'financials' })).status, 200);
  const own = after.files.find((f) => f.name === 'Minutes.docx');
  assert.equal((await api({ action: 'update-file', id: own.id, kind: 'minutes' })).status, 200, 'the minutes’ own file, already the minutes');
});

test('1: minutes in draft, and minutes marked approved with none in Board yet, still take a file as the minutes', async () => {
  const draft = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-20), title: 'Q4 Board Meeting', shared: true }), { by: FOUNDER });
  const d = await addFile(draft, pdf('Minutes.pdf'), 'minutes');
  assert.deepEqual([d.body.file.kind, d.body.asFile], ['minutes', undefined]);
  const empty = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-200), title: 'Q1 Board Meeting', shared: true, minutes: 'approved', approvedOn: inDays(-150) }), { by: FOUNDER });
  const first = await addFile(empty, pdf('Minutes-Q1.pdf'), 'minutes');
  assert.deepEqual([first.body.file.kind, first.body.asFile], ['minutes', undefined], 'approved with no minutes in Board: these are them');
  const second = await addFile(empty, pdf('Minutes-Q1-revised.pdf'), 'minutes');
  assert.deepEqual([second.body.file.kind, second.body.asFile], ['other', AS_A_FILE], '...and once they are, the next is a file');
  assert.deepEqual(opened(await getMeeting(env.DB, empty.id)), { editor: 'Minutes-Q1.pdf', board: 'Minutes-Q1.pdf' });
});

test('1: approval keeps which file it was: a newer minutes file (however it got there) never becomes the minutes as written, for the editor or the board; a draft again goes by the usual rule', async () => {
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-10), title: 'Q4 Board Meeting', shared: true }), { by: FOUNDER });
  const word = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: docx('Minutes.docx'), kind: 'minutes', by: FOUNDER });
  const copy = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes.pdf'), kind: 'minutes', by: FOUNDER });
  const shown = minutesFileOf(await getMeeting(env.DB, m.id));
  assert.equal(shown.id, copy.id, 'setup: the board is shown the PDF before the Word copy');
  // Marked approved from the editor (Mark them approved): the file the board was shown is the approved one
  const cur = await getMeeting(env.DB, m.id);
  const saved = await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: inDays(-1) }, base: cur.updatedAt });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  // A newer minutes file put on them by a way that skips the check (a page from before it, a request at the very moment)
  await later();
  await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes-final.pdf'), kind: 'minutes', by: FOUNDER });
  await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: docx('Minutes-final.docx'), kind: 'minutes', by: FOUNDER });
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(opened(after), { editor: 'Minutes.pdf', board: 'Minutes.pdf' }, 'the approved file, both ways');
  assert.equal(saved.body.meeting.approvedFile, copy.id, 'approval kept which file it was');
  assert.equal(shared.minutesIn(after), true);
  // A save from the page never moves it (the site's to set), nor does a later write
  /* r15: a change to the invite's notes, not the name: approved minutes' name is what they state, refused whole (Board QA round 15) */
  const again = await api({ action: 'save-meeting', meeting: { ...after, approvedFile: after.files.at(-1).id, inviteNote: 'Parking behind the building' }, base: after.updatedAt });
  assert.equal(again.body.meeting.approvedFile, copy.id);
  // Marked a draft again: no approved file, and the usual rule (the PDF first)
  const back = await api({ action: 'save-meeting', meeting: { ...again.body.meeting, minutes: 'draft' }, base: again.body.meeting.updatedAt });
  assert.equal(back.body.meeting.approvedFile, '');
  /* r14: one fact says which file is the minutes (Board QA round 14, finding 2): the editor names the file the board reads, never the newest in its place */
  assert.deepEqual(opened(back.body.meeting), { editor: 'Minutes.pdf', board: 'Minutes.pdf' });
  void word;
});

test('1: approved by the board (approve-minutes) keeps the file too; approved minutes whose file is staff only show the board none, never another in its place', async () => {
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-10), title: 'Q4 Board Meeting', shared: true }), { by: FOUNDER });
  const word = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: docx('Minutes.docx'), kind: 'minutes', by: FOUNDER });
  const copy = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes.pdf'), kind: 'minutes', by: FOUNDER });
  const r = await api({ action: 'approve-minutes', id: m.id, on: inDays(-1) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const approved = await getMeeting(env.DB, m.id);
  assert.equal((await api({ action: 'update-file', id: copy.id, staffOnly: true })).status, 200);
  const after = await getMeeting(env.DB, m.id);
  assert.equal(minutesFileOf(after), null, 'the board’s file is staff only: none');
  assert.equal(minutesFileOf(forBoard(after)), null, 'the board page: none, never the Word copy in its place');
  assert.equal(ownMinutesFile(after).id, copy.id, 'the founders still have it');
  assert.equal(approved.approvedFile, copy.id, 'approval kept which file it was');
  void word;
});

test('1: approved minutes from before approval kept a file (or with none yet): the editor and the board page open the same file, never a newer one', async () => {
  const m = await approvedAsAFile();
  await later();
  // (a newer one put on them by the bug this fixes, before it was fixed)
  await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: docx('Minutes-final.docx'), kind: 'minutes', by: FOUNDER });
  await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes-revised.pdf'), kind: 'minutes', by: FOUNDER });
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual(opened(after), { editor: 'Minutes.docx', board: 'Minutes.docx' }, 'the first that came, both ways: never the newest, never any PDF');
  /* r11: an approval that kept no file has the one the meeting had for them fixed as theirs by the first look that finds it (round 11, item 1) */
  assert.equal(after.approvedFile, after.files.find((f) => f.name === 'Minutes.docx').id, 'approved with no file kept: fixed by the first look that finds one');
  // ...and the next write keeps that one as the approved file
  /* r15: a change to the invite's notes, not the place: approved minutes' place is what they state, refused whole (Board QA round 15) */
  const kept = await api({ action: 'save-meeting', meeting: { ...after, inviteNote: 'Parking behind the building' }, base: after.updatedAt });
  assert.equal(kept.body.meeting.approvedFile, after.files.find((f) => f.name === 'Minutes.docx').id);
});

// ─── 4: two Replaces at the same moment ─────────────────────────────

const MIN = (tag) => `Q4 Board Meeting Minutes
1. CALL TO ORDER
1. Roll Call
a. ${tag} quorum present
2. FINANCE
1. Year to date
a. ${tag} revenue is ahead of budget`;
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ title: 'Year to date' }] },
];
const noted = (m) => m.sections.flatMap((s) => s.items).filter((it) => it.notes).map((it) => it.notes);
/** A minutes file as the page's drop uploads it (unfiled until it's read in) */
async function dropped(m, name, tag) {
  texts[name] = MIN(tag);
  return putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf(name), kind: 'other', by: FOUNDER });
}
/** Two reads at the same moment: `slow`'s read held part way (its file being read) while `fast` goes all the way */
async function race(m, slow, fast) {
  let reached;
  const at = new Promise((r) => { reached = r; });
  let release;
  gate = { name: slow.name, reached, held: new Promise((r) => { release = r; }) };
  const pSlow = api({ action: 'read-minutes', id: m.id, fileId: slow.id });
  await at;
  const rFast = await api({ action: 'read-minutes', id: m.id, fileId: fast.id });
  release();
  return [rFast, await pSlow];
}

test('4: two Replaces at the same moment: the one that loses says so in Replace’s words, naming the minutes that went on, and nothing of it is read in', async () => {
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-1), title: 'Q4 Board Meeting', shared: true, sections: AGENDA }), { by: FOUNDER });
  const a = await dropped(m, 'Minutes-A.pdf', 'ALPHA');
  assert.equal((await api({ action: 'read-minutes', id: m.id, fileId: a.id })).status, 200, 'setup: Minutes A read in');
  const e = await dropped(m, 'Minutes-E.pdf', 'ECHO');
  const b = await dropped(m, 'Minutes-B.pdf', 'BRAVO');
  const [rE, rB] = await race(m, b, e);
  assert.equal(rE.status, 200, JSON.stringify(rE.body));
  assert.equal(rB.status, 409, JSON.stringify(rB.body));
  assert.equal(rB.body.error, 'Other minutes went onto this meeting just now (Minutes E), so Minutes B wasn’t read in. Nothing was changed.');
  const after = await getMeeting(env.DB, m.id);
  assert.equal(after.minutesFrom?.name, 'Minutes-E.pdf');
  assert.deepEqual(noted(after), ['- ECHO quorum present', '- ECHO revenue is ahead of budget'], 'only Minutes E');
  // (Undo of the one that won still works, as Replace's own)
  assert.equal((await api({ action: 'undo-minutes', id: m.id, fileId: e.id })).status, 200);
});

test('4: two first drops at the same moment: the second is refused alike, never read over the first (the two files’ notes never mixed)', async () => {
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-1), title: 'Q4 Board Meeting', shared: true, sections: [...AGENDA, { title: 'Open forum', items: [{ title: 'Questions' }] }] }), { by: FOUNDER });
  const e = await dropped(m, 'Minutes-E.pdf', 'ECHO');
  const b = await dropped(m, 'Minutes-B.pdf', 'BRAVO');
  const [rE, rB] = await race(m, b, e);
  assert.equal(rE.status, 200);
  assert.equal(rB.status, 409, JSON.stringify(rB.body));
  assert.equal(rB.body.error, 'Other minutes went onto this meeting just now (Minutes E), so Minutes B wasn’t read in. Nothing was changed.');
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.minutesFrom?.name, noted(after)], ['Minutes-E.pdf', ['- ECHO quorum present', '- ECHO revenue is ahead of budget']]);
  assert.ok(after.files.some((f) => f.id === e.id), 'the minutes that went on keep their file');
});

// ─── 3: who changed what clashes, save by save ──────────────────────

test('3: the agenda template: a founder’s other tab, then a rename that only followed Sam: the question names the other tab, never the rename', async () => {
  const s0 = await getSettings(env.DB);
  const withSam = s0.template.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_r10fin', title: 'Financial', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec));
  const opened0 = await saveSettings(env.DB, { template: withSam }, FOUNDER, { base: s0.templateAt });
  const pick = (t, who, presenter) => t.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.id === 'i_r10fin' ? { ...it, who, presenter } : it)) }));
  // Tab B adds Taylor and saves; People renames Sam and puts a newcomer at his old address
  await later();
  await saveSettings(env.DB, { template: pick(opened0.template, ['sam-ortiz', 'taylor-nguyen'], 'Sam Ortiz & Taylor Nguyen') }, FOUNDER, { base: opened0.templateAt });
  await later();
  assert.equal((await rename('sam-ortiz', 'sam-ortiz-new')).status, 200);
  await addPerson('sam-ortiz', { name: 'Nora Newcomer', group: 'board', title: 'Board Member' });
  assert.equal((await getSettings(env.DB)).templateBy, 'People (renaming Sam Ortiz)', 'setup: the rename saved it last');
  // Tab A, opened before both, adds Alex
  const mine = pick(opened0.template, ['sam-ortiz', 'alex-rivera'], 'Sam Ortiz & Alex Rivera');
  let j = null;
  try { await saveSettings(env.DB, { template: mine }, FOUNDER, { base: opened0.templateAt }); } catch (e) { j = { status: e.status, current: e.current, ...(e.extra || {}) }; }
  assert.equal(j?.status, 409);
  assert.deepEqual(j.saves?.map((s) => s.by), [FOUNDER, 'People (renaming Sam Ortiz)'], 'every save since the page read it, in turn');
  // The page (AgendaTemplate): the rename followed in all it has, then who changed what clashes
  // (People as the page has them: read again since the rename, or still as it opened, a tab not looked at)
  const asM = (sections) => cleanMeeting({ sections });
  const slugs = (x) => asM(followAddresses({ sections: x.sections }, j.addressesNow).sections);
  let who = null;
  for (const people of [
    [{ slug: 'sam-ortiz', name: 'Nora Newcomer' }, { slug: 'sam-ortiz-new', name: 'Sam Ortiz' }, { slug: 'alex-rivera', name: 'Alex Rivera' }, { slug: 'taylor-nguyen', name: 'Taylor Nguyen' }],
    [{ slug: 'sam-ortiz', name: 'Sam Ortiz' }, { slug: 'alex-rivera', name: 'Alex Rivera' }, { slug: 'taylor-nguyen', name: 'Taylor Nguyen' }],
  ]) {
    const follow = (x) => asM(followAddresses({ sections: x.sections }, j.addressesNow, { people }).sections);
    const was = follow(asM(opened0.template));
    const now = follow(asM(mine));
    const { clashes } = mergeMeeting(was, now, asM(j.current.template));
    assert.deepEqual(clashes, ['“Financial”']);
    // (as AgendaTemplate asks: the copy it opened and each save since, the renames' addresses followed as the site does)
    who = page.clashWho({ clashes, was: slugs(asM(opened0.template)), mine: now, saves: j.saves, savers: j.savers, by: j.current.by, shape: asM, follow: slugs });
    assert.deepEqual(who, [{ by: FOUNDER, clashes: ['“Financial”'] }], `the other tab changed it; the rename only followed Sam (People: ${people[0].name} at sam-ortiz)`);
  }
  const clashes = ['“Financial”'];
  const q = page.clashQuestion({ by: j.current.by, me: FOUNDER, what: 'the agenda template', clashes, who });
  assert.equal(q.title, 'You changed the agenda template in another tab too');
  assert.equal(q.text, 'You changed “Financial” here and in the other tab. Keep what’s here, or take the other tab’s? Everything else from both is kept.');
});

test('3: two people changed what clashes: the question names both, each with what they changed; with no history to go by, everyone who saved since', () => {
  const item = (who) => ({ id: 'i_x', title: 'Financial', who, presenter: '' });
  const at = (who, start = '08:00') => cleanMeeting({ start, sections: [{ id: 's_a', title: 'Reports', items: [item(who)] }] });
  const was = at(['sam-ortiz']);
  const mine = at(['sam-ortiz', 'alex-rivera'], '09:00');
  const saves = [
    { at: '2026-11-22T10:00:00.000Z', by: FOUNDER, data: at(['sam-ortiz', 'taylor-nguyen']) },
    { at: '2026-11-22T10:01:00.000Z', by: 'calendar@soardcharity.com', data: null },
    { at: '2026-11-22T10:02:00.000Z', by: OTHER, data: at(['kim-park'], '10:00') },
  ];
  const theirs = saves[2].data;
  const { clashes } = mergeMeeting(was, mine, theirs);
  assert.deepEqual(clashes, ['the time', '“Financial”']);
  const who = page.clashWho({ clashes, was, mine, saves, by: OTHER });
  assert.deepEqual(who, [{ by: FOUNDER, clashes: ['“Financial”'] }, { by: OTHER, clashes: ['the time', '“Financial”'] }]);
  const q = page.clashQuestion({ by: OTHER, me: FOUNDER, what: 'this meeting', clashes, who });
  assert.equal(q.title, 'Your other tab and Holly changed this meeting too');
  assert.equal(q.text, 'You changed “Financial” in another tab, and Holly changed the time, “Financial”. Keep what’s here, or take theirs? Everything else from all of them is kept.');
  assert.ok(!/[—–]/.test(q.title + q.text), 'no long dashes');
  // The same change by both: "it too"
  const same = page.clashQuestion({ me: FOUNDER, clashes: ['“Financial”'], who: [{ by: FOUNDER, clashes: ['“Financial”'] }, { by: 'People (renaming Sam Ortiz)', clashes: ['“Financial”'] }] });
  assert.equal(same.text, 'You changed “Financial” in another tab, and People (renaming Sam Ortiz) changed it too. Keep what’s here, or take theirs? Everything else from all of them is kept.');
  // No history the site can vouch for: everyone who saved since, each with every clash
  assert.deepEqual(page.clashWho({ clashes: ['“Financial”'], was, mine, saves: null, savers: [FOUNDER, OTHER], by: OTHER }), [{ by: FOUNDER, clashes: ['“Financial”'] }, { by: OTHER, clashes: ['“Financial”'] }]);
  // One person: the words as before
  assert.equal(page.clashQuestion({ by: OTHER, me: FOUNDER, clashes: ['the time'], who: [{ by: OTHER, clashes: ['the time'] }] }).title, 'Holly changed this meeting too');
});

test('3: a meeting and a practice meeting: every save since the page read it comes with the 409, in turn, a rename’s included, and a write that changed nothing a person edits keeps nothing to compare', async () => {
  const made = (await api({ action: 'new-meeting', date: inDays(30) })).body.meeting;
  const m0 = await getMeeting(env.DB, made.id);
  const withSam = { ...m0, sections: m0.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_r10ytd', title: 'Year to date', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec)) };
  const opened1 = (await api({ action: 'save-meeting', meeting: withSam, base: m0.updatedAt })).body.meeting;
  const NAMES = { 'sam-ortiz': 'Sam Ortiz', 'taylor-nguyen': 'Taylor Nguyen', 'alex-rivera': 'Alex Rivera' };
  const pick = (mm, who) => ({ ...mm, sections: mm.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.id === 'i_r10ytd' ? { ...it, who, presenter: who.map((x) => NAMES[x]).join(' & ') } : it)) })) });
  await later();
  const b = await api({ action: 'save-meeting', meeting: pick(opened1, ['sam-ortiz', 'taylor-nguyen']), base: opened1.updatedAt });
  assert.equal(b.status, 200);
  // (the site's own records written in one statement between, a send's and the invite's Meet link: in the history too)
  await later();
  await setOnMeeting(env.DB, made.id, { packetSentAt: new Date().toISOString(), packetSentTo: 3 });
  await later();
  await setOnMeeting(env.DB, made.id, { video: 'https://meet.google.com/abc-defg-hij' }, { by: 'Board' });
  await later();
  assert.equal((await rename('sam-ortiz', 'sam-ortiz-new')).status, 200);
  const r = await api({ action: 'save-meeting', meeting: pick(opened1, ['sam-ortiz', 'alex-rivera']), base: opened1.updatedAt });
  assert.equal(r.status, 409);
  assert.ok(Array.isArray(r.body.saves), JSON.stringify(r.body.savers));
  assert.deepEqual(r.body.saves.map((s) => [s.by, !!s.data]), [[FOUNDER, true], [FOUNDER, false], ['Board', true], ['People (renaming Sam Ortiz)', true]], 'each write in turn: the packet’s record changed nothing a person edits');
  assert.equal(r.body.saves.at(-1).at, r.body.current.updatedAt, 'up to the copy it meets');
  // (People as the page has them after the rename, as pickable(data.people) gives them)
  const people = [{ slug: 'sam-ortiz-new', name: 'Sam Ortiz' }, { slug: 'taylor-nguyen', name: 'Taylor Nguyen' }, { slug: 'alex-rivera', name: 'Alex Rivera' }, { slug: 'kim-park', name: 'Kim Park' }];
  const follow = (x) => cleanMeeting(followAddresses(x, r.body.addressesNow, { people }));
  const was = follow(cleanMeeting(opened1));
  const mine = follow(cleanMeeting(pick(opened1, ['sam-ortiz', 'alex-rivera'])));
  const { clashes } = mergeMeeting(was, mine, cleanMeeting(r.body.current));
  assert.deepEqual(clashes, ['“Year to date”']);
  const slugs = (x) => cleanMeeting(followAddresses(x, r.body.addressesNow));
  assert.deepEqual(page.clashWho({ clashes, was: slugs(cleanMeeting(opened1)), mine, saves: r.body.saves, savers: r.body.savers, by: r.body.current.updatedBy, shape: cleanMeeting, follow: slugs }), [{ by: FOUNDER, clashes: ['“Year to date”'] }]);

  // A practice meeting: the same, from its own history
  const p0 = await createPractice(env, { by: FOUNDER });
  const p1 = await saveMeeting(env.DB, { ...p0, title: 'Practice, first look' }, { by: FOUNDER, base: p0.updatedAt });
  await later();
  await saveMeeting(env.DB, { ...p1, start: '09:30' }, { by: OTHER, base: p1.updatedAt });
  let p409 = null;
  try { await saveMeeting(env.DB, { ...p1, start: '10:00' }, { by: FOUNDER, base: p1.updatedAt }); } catch (e) { p409 = e; }
  assert.equal(p409?.status, 409);
  assert.deepEqual(p409.extra?.saves?.map((s) => s.by), [OTHER]);
  const pc = mergeMeeting(cleanMeeting(p1), cleanMeeting({ ...p1, start: '10:00' }), cleanMeeting(p409.current)).clashes;
  assert.deepEqual(page.clashWho({ clashes: pc, was: cleanMeeting(p1), mine: cleanMeeting({ ...p1, start: '10:00' }), saves: p409.extra.saves, by: p409.current.updatedBy, shape: cleanMeeting }), [{ by: OTHER, clashes: ['the time'] }]);
});
