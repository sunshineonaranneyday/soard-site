/**
 * Board QA round 11 (Nov 23 2026), the founders' admin tester's findings 1 and 2:
 *   1  approved minutes' file is judged by the approval's record (approvedFile; for an approval that kept none, the
 *      minutes file the meeting had then, fixed by the first look that finds it), never by which files still carry
 *      Minutes or sit on an item. Their file can't come off them while they're approved (File it under another kind,
 *      Delete, an agenda item: refused in words), and whatever happened to it, a file brought in later is an ordinary
 *      file in round 10's words (Add files, an item's upload, the upload API, ⋯ Minutes), a drop and the email reader
 *      leave the minutes as they are, and the editor and the board page open the same file, the approved one
 *   2  the merge question names everyone whose change clashes however many saves came since the page's copy (31, 300:
 *      a meeting, a practice meeting, the agenda template), and when Board can't know who saved since, it says so in
 *      words, never "your other tab"
 * Made-up people only (the repo is public). Run: node --test tests/board-round11-minutes.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import { ensureSchema, getMeeting, saveMeeting, saveSettings, getSettings, putFile, patchMeeting, updateFile, createPractice } from '../functions/api/_board.js';
import { readBoardMail } from '../functions/api/_board-mail.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import * as shared from '../public/admin/board-shared.js';
import * as page from '../public/admin/board-meeting.js';

const { cleanMeeting, mergeMeeting, todayEastern, forBoard, minutesFileOf, ownMinutesFile, minutesIn } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const PAT = 'pat@soardcharity.com';
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const { privateKey: SA_PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
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
  ['pat-lane', { name: 'Pat Lane', group: 'team', title: 'Program Director' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
];
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net']];
// The words decided (written out here, so a run on the code before them fails on what it says, never on an import)
const AS_A_FILE = 'The minutes are approved, so this was added as a file, not as the minutes. Mark them as draft first to replace them.';
const NOT_THE_MINUTES = 'The minutes are approved, so this stays a file, not the minutes. Mark them as draft first to replace them.';
const FILE_STAYS = 'These minutes are approved, so their file stays. Mark them as draft first to change it.';
const APPROVED_NOW = 'These minutes are marked approved, so Board leaves them as they are. Mark them as draft first (After the meeting), then drop in the new file.';

let env;
let texts;
/* r15: what each request left running after its answer (waitUntil), finished inside its own test with its own fakes,
   never thrown away to run on into the next test (Board QA round 15's full check: tests/board.test.mjs) */
let leftRunning = [];
const realFetch = globalThis.fetch;
beforeEach(async () => {
  leftRunning = [];
  texts = {};
  env = {
    DB: await createD1(), FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD,
    GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', private_key: SA_PEM }),
    AI: {
      toMarkdown: async (doc) => ({ name: doc.name, format: 'text', data: texts[doc.name] || '' }),
      // (the email reader's sorting asks the model what a file is: minutes, for these; anything else, the model is down)
      run: async (model, opts) => {
        if (/File name:/.test(opts?.messages?.[1]?.content || '')) return { response: { kind: 'minutes', meetingDate: '', reason: 'the minutes' } };
        throw new Error('test: Workers AI down');
      },
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
  clearTokenCache();
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(async () => {
  for (let n = 0; leftRunning.length && n < 10; n++) { const going = leftRunning; leftRunning = []; await Promise.allSettled(going); }
  globalThis.fetch = realFetch;
});

/** /api/board-admin behind the real sign-in middleware, as `who`: JSON, or a file as the page's upload sends it (`form`) */
async function call(who, { body = null, form = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com/api/board-admin${form ? '?upload=1' : ''}`, {
    method: 'POST', headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || JSON.stringify(body),
  });
  const ctx = { request, env, data: {}, waitUntil: (p) => { leftRunning.push(p); } };
  ctx.next = async () => admin.onRequestPost(ctx);
  const res = await onRequest(ctx);
  return { status: res.status, body: await res.json() };
}
const api = (body, who = FOUNDER) => call(who, { body });
const pdf = (name) => new File([new TextEncoder().encode(`%PDF-1.7\n% ${name}\n`)], name, { type: 'application/pdf' });
const docx = (name) => new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, ...new TextEncoder().encode(name)])], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
/** Every file's Add files (or an item's upload: `forItem`), as the page's upload sends it */
async function addFile(m, f, kind, { forItem = false } = {}) {
  const form = new FormData();
  form.set('ownerType', 'meeting');
  form.set('ownerId', m.id);
  form.set('kind', kind);
  form.set('file', f);
  if (forItem) form.set('forItem', 'true');
  return call(FOUNDER, { form });
}
const later = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const kinds = (m) => m.files.map((f) => `${f.name}[${f.kind}]`);
/** Which file each side opens as the minutes: the editor's "Written up in", the board page's "The minutes as written" */
const opened = (m) => ({ editor: ownMinutesFile(m)?.name || null, board: minutesFileOf(forBoard({ ...m, shared: true }))?.name || null });
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ title: 'Year to date' }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const MIN = (tag) => `Q3 Board Meeting Minutes
1. CALL TO ORDER
1. Roll Call
a. ${tag} quorum present
2. FINANCE
1. Year to date
a. ${tag} revenue is ahead of budget`;
const noted = (m) => m.sections.flatMap((s) => s.items).filter((it) => it.notes).map((it) => it.notes);
const GALA = 'The gala sold out.';

/**
 * The tester's held meeting: 60 days ago, its minutes approved a month ago and kept only as Minutes.docx (never read
 * in), a note typed on its last item. `fixed`: approved after round 10 (Mark them approved, so the approval kept its
 * file); else approved before approval kept one (approvedFile empty as it's written)
 */
async function heldMeeting({ fixed = false } = {}) {
  const sections = AGENDA.map((s, i) => ({ ...s, items: s.items.map((it) => ({ ...it, notes: i === 2 ? GALA : '' })) }));
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-60), title: 'Q3 Board Meeting', shared: true, sections, minutes: fixed ? 'draft' : 'approved', approvedOn: fixed ? '' : inDays(-30) }), { by: FOUNDER });
  const f = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: docx('Minutes.docx'), kind: 'minutes', by: FOUNDER });
  if (fixed) {
    const cur = await getMeeting(env.DB, m.id);
    const r = await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: inDays(-30) }, base: cur.updatedAt });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.meeting.approvedFile, f.id, 'setup: the approval kept its file');
  } else {
    const row = await env.DB.prepare("SELECT json_extract(data, '$.approvedFile') AS f FROM board_meetings WHERE id = ?").bind(m.id).first();
    assert.ok(!row.f, 'setup: approved before approval kept a file');
  }
  return { m: await getMeeting(env.DB, m.id), file: f };
}
const lastItem = (m) => m.sections.flatMap((s) => s.items).at(-1);
const withDoc = (m, itemId, fileId) => ({ ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === itemId ? { ...it, docs: [...(it.docs || []), fileId] } : it)) })) });

// ─── 1: the approved file stays theirs ──────────────────────────────

for (const fixed of [false, true]) {
  const when = fixed ? 'approved after round 10' : 'approved before approval kept a file';
  test(`1 (${when}): File it under → Other on the approved minutes' file is refused in words, nothing changed; the next Minutes file is an ordinary file`, async () => {
    const { m, file } = await heldMeeting({ fixed });
    const r = await api({ action: 'update-file', id: file.id, kind: 'other' });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, FILE_STAYS);
    // (any other kind too; Minutes, its rename and staff only, as ever)
    for (const kind of ['financials', 'packet', 'agenda', 'signed']) assert.equal((await api({ action: 'update-file', id: file.id, kind })).status, 409, kind);
    assert.equal((await api({ action: 'update-file', id: file.id, kind: 'minutes' })).status, 200);
    assert.equal((await api({ action: 'update-file', id: file.id, name: 'Minutes Sep.docx' })).status, 200);
    const add = await addFile(m, pdf('Minutes-revised.pdf'), 'minutes');
    assert.deepEqual([add.body.file?.kind, add.body.asFile], ['other', AS_A_FILE]);
    const after = await getMeeting(env.DB, m.id);
    assert.deepEqual(kinds(after), ['Minutes Sep.docx[minutes]', 'Minutes-revised.pdf[other]']);
    assert.deepEqual(opened(after), { editor: 'Minutes Sep.docx', board: 'Minutes Sep.docx' });
    // (another file of the meeting still files under anything but Minutes)
    assert.equal((await api({ action: 'update-file', id: add.body.file.id, kind: 'financials' })).status, 200);
  });

  test(`1 (${when}): Delete on the approved minutes' file is refused in words, it stays; the next Minutes file is an ordinary file`, async () => {
    const { m, file } = await heldMeeting({ fixed });
    const r = await api({ action: 'delete-file', id: file.id });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, FILE_STAYS);
    const add = await addFile(m, pdf('Minutes-revised.pdf'), 'minutes');
    assert.deepEqual([add.body.file?.kind, add.body.asFile], ['other', AS_A_FILE]);
    const after = await getMeeting(env.DB, m.id);
    assert.deepEqual(kinds(after), ['Minutes.docx[minutes]', 'Minutes-revised.pdf[other]']);
    assert.deepEqual(opened(after), { editor: 'Minutes.docx', board: 'Minutes.docx' });
    // (the other file deletes as ever)
    assert.equal((await api({ action: 'delete-file', id: add.body.file.id })).status, 200);
  });

  test(`1 (${when}): the approved minutes' file put on an agenda item is refused by name, the rest of the save goes; an item's upload of minutes is an ordinary file`, async () => {
    const { m, file } = await heldMeeting({ fixed });
    const it = lastItem(m);
    /* r15: the rest of the save is a change to the invite's notes, not the place: approved minutes' place is what they state, refused whole (Board QA round 15) */
    const r = await api({ action: 'save-meeting', meeting: { ...withDoc(m, it.id, file.id), inviteNote: 'Parking behind the building' }, base: m.updatedAt });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, FILE_STAYS);
    assert.deepEqual([r.body.refused, r.body.fileId], [['docs'], file.id], 'refused by name, for the page to take only that back');
    let after = await getMeeting(env.DB, m.id);
    assert.deepEqual(lastItem(after).docs || [], [], 'nothing changed');
    // The page takes the file off the item and the rest goes
    const again = await api({ action: 'save-meeting', meeting: { ...m, inviteNote: 'Parking behind the building' }, base: m.updatedAt });
    assert.equal(again.status, 200);
    // An item's upload ("Upload a file" in its Add a document) of new minutes: an ordinary file, said
    const up = await addFile(again.body.meeting, pdf('Minutes-revised.pdf'), 'minutes', { forItem: true });
    assert.deepEqual([up.body.file?.kind, up.body.asFile], ['other', AS_A_FILE]);
    const placed = await api({ action: 'save-meeting', meeting: withDoc(again.body.meeting, it.id, up.body.file.id), base: again.body.meeting.updatedAt });
    assert.equal(placed.status, 200, 'an ordinary file goes with the item');
    after = await getMeeting(env.DB, m.id);
    assert.deepEqual(opened(after), { editor: 'Minutes.docx', board: 'Minutes.docx' });
    assert.equal(after.inviteNote, 'Parking behind the building');
  });
}

/**
 * The approved file taken off them before this was fixed (or by a page from before it): filed under Other, deleted, or
 * put on an agenda item, as the code before did it
 */
const STEPS = {
  other: async (m, file) => updateFile(env.DB, file.id, { kind: 'other' }),
  deleted: async (m, file) => { await env.DB.prepare('DELETE FROM board_files WHERE id = ?').bind(file.id).run(); },
  item: async (m, file) => patchMeeting(env.DB, m.id, (cur) => withDoc(cur, lastItem(cur).id, file.id)),
};
for (const [step, takeOff] of Object.entries(STEPS)) {
  test(`1 (the approved file ${step === 'item' ? 'put on an item' : step === 'deleted' ? 'deleted' : 'filed under Other'} before this was fixed): whatever happened to it, a file brought in later is an ordinary file in round 10's words, and the editor and the board page open the same file`, async () => {
    for (const fixed of [false, true]) {
      const { m, file } = await heldMeeting({ fixed });
      await takeOff(m, file);
      // Every file's Add files, and the upload API
      const add = await addFile(m, pdf('Minutes-revised.pdf'), 'minutes');
      assert.deepEqual([add.body.file?.kind, add.body.asFile], ['other', AS_A_FILE], `${step}, ${fixed}: Add files`);
      // ⋯ Minutes on another of its files
      const other = await addFile(m, pdf('Minutes-final.pdf'), 'other');
      const k = await api({ action: 'update-file', id: other.body.file.id, kind: 'minutes' });
      assert.deepEqual([k.status, k.body.error], [409, NOT_THE_MINUTES], `${step}, ${fixed}: ⋯ Minutes`);
      const after = await getMeeting(env.DB, m.id);
      assert.equal(minutesIn(after), true, `${step}, ${fixed}: the minutes are in Board, by the approval`);
      const want = step === 'deleted' ? null : 'Minutes.docx';
      assert.deepEqual(opened(after), { editor: want, board: want }, `${step}, ${fixed}: the approved file, or none, never a newer one`);
      assert.ok(after.files.every((f) => f.id === file.id || f.kind !== 'minutes'), `${step}, ${fixed}: no file became their minutes`);
    }
  });
}

test('1: a drop in the minutes box after the approved file was taken off them reads nothing over them, in round 9\'s words', async () => {
  for (const [step, takeOff] of Object.entries(STEPS)) {
    const { m, file } = await heldMeeting({ fixed: true });
    await takeOff(m, file);
    texts['Minutes-A.pdf'] = MIN('ALPHA');
    const a = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes-A.pdf'), kind: 'other', by: FOUNDER });
    const r = await api({ action: 'read-minutes', id: m.id, fileId: a.id });
    assert.deepEqual([r.status, r.body.error], [409, APPROVED_NOW], step);
    const after = await getMeeting(env.DB, m.id);
    assert.deepEqual([after.minutesFrom, noted(after)], [null, [GALA]], `${step}: the minutes as they were`);
  }
});

test('1: Board\'s email reader, after the approved file was filed under Other: the emailed minutes are kept for staff, never read over the approved ones', async () => {
  const { m, file } = await heldMeeting({ fixed: true });
  await updateFile(env.DB, file.id, { kind: 'other' });
  texts['Minutes-A.pdf'] = MIN('ALPHA');
  const mid = 'qa-r11-1';
  const msg = {
    id: mid, internalDate: String(Date.now()), snippet: 'The minutes, attached.',
    payload: {
      headers: [['Subject', `Minutes of the ${m.date} board meeting`], ['From', 'Taylor Nguyen <taylor.board@example.net>'], ['To', 'board@soardcharity.com'], ['Message-ID', `<${mid}@mail.example>`]].map(([name, value]) => ({ name, value })),
      parts: [{ filename: 'Minutes-A.pdf', mimeType: 'application/pdf', body: { attachmentId: '0', size: 40 } }],
    },
  };
  const fetchImpl = async (u) => {
    const s = String(u);
    if (s === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'tok', expires_in: 3600 });
    const p = new URL(s).pathname;
    if (p.endsWith('/messages')) return Response.json({ messages: [{ id: mid }] });
    if (p.endsWith(`/messages/${mid}`)) return Response.json(msg);
    if (p.includes(`/messages/${mid}/attachments/`)) return Response.json({ data: Buffer.from(new TextEncoder().encode('%PDF-1.7\n% Minutes-A.pdf\n')).toString('base64url') });
    throw new Error(`unexpected Google call ${s}`);
  };
  await readBoardMail(env, { fetchImpl });
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.minutesFrom, noted(after)], [null, [GALA]], 'the approved minutes as they were');
  assert.deepEqual(after.files.map((f) => `${f.name}[${f.kind}${f.staffOnly ? ',staff' : ''}]`), ['Minutes.docx[other]', 'Minutes-A.pdf[other,staff]'], 'kept for staff, never their file');
  assert.deepEqual(opened(after), { editor: 'Minutes.docx', board: 'Minutes.docx' });
  const log = (await env.DB.prepare('SELECT result FROM board_mail').first())?.result || '';
  assert.match(log, /not read: the approved minutes stand/);
});

test('1: an approval that kept no file has the one the meeting had for them fixed by the first look that finds it, the meeting\'s time untouched; a draft keeps none', async () => {
  const { m, file } = await heldMeeting({ fixed: false });
  const row = await env.DB.prepare("SELECT json_extract(data, '$.approvedFile') AS f, updated_at AS at FROM board_meetings WHERE id = ?").bind(m.id).first();
  assert.deepEqual([row.f, row.at], [file.id, m.updatedAt], 'fixed as theirs, and nobody changed the meeting');
  // (a newer minutes file put there after, by a way that skips the check: never theirs, nor opened)
  await later();
  await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes-final.pdf'), kind: 'minutes', by: FOUNDER });
  await updateFile(env.DB, file.id, { name: 'Renamed.docx' });
  assert.deepEqual(opened(await getMeeting(env.DB, m.id)), { editor: 'Renamed.docx', board: 'Renamed.docx' });
  // Marked as draft: no approved file, and everything can change again
  const cur = await getMeeting(env.DB, m.id);
  const back = await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'draft' }, base: cur.updatedAt });
  assert.equal(back.body.meeting.approvedFile, '');
  assert.equal((await api({ action: 'update-file', id: file.id, kind: 'other' })).status, 200);
  assert.equal((await api({ action: 'delete-file', id: file.id })).status, 200);
});

test('1: minutes approved with none in Board take the first that comes, and Undo of its read leaves them with none again, truthfully', async () => {
  const m = await saveMeeting(env.DB, cleanMeeting({ date: inDays(-200), title: 'Q1 Board Meeting', shared: true, sections: AGENDA, minutes: 'approved', approvedOn: inDays(-150) }), { by: FOUNDER });
  texts['Minutes-E.pdf'] = MIN('ECHO');
  const e = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: pdf('Minutes-E.pdf'), kind: 'other', by: FOUNDER });
  const r = await api({ action: 'read-minutes', id: m.id, fileId: e.id, anyway: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await getMeeting(env.DB, m.id)).approvedFile, e.id, 'these are them');
  const u = await api({ action: 'undo-minutes', id: m.id, fileId: e.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const after = await getMeeting(env.DB, m.id);
  assert.deepEqual([after.approvedFile, minutesIn(after), after.files.length], ['', false, 0], 'none in Board again, as before the read');
  // ...so the next minutes are theirs, as round 10 has it
  const f = await addFile(after, pdf('Minutes-F.pdf'), 'minutes');
  assert.deepEqual([f.body.file?.kind, f.body.asFile], ['minutes', undefined]);
  // (and an item's upload on such a meeting is an ordinary file of the item, never its minutes)
  const it = await addFile(after, pdf('Minutes-Q4.pdf'), 'minutes', { forItem: true });
  assert.equal(it.body.file?.kind, 'other');
});

// ─── 2: who changed what clashes, however many saves since ──────────

const MEETING = [
  { id: 's_r11a', title: 'Call to order', items: [{ id: 'i_r11roll', title: 'Roll call' }] },
  { id: 's_r11b', title: 'Open forum', items: [{ id: 'i_r11q', title: 'Questions from the board' }] },
];
const retitle = (x, id, title) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, title } : it)) })) });
const renote = (x, id, notes) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, notes } : it)) })) });
/** A save that meets the saves since its copy: the 409's answer, as the page has it ({ status, current, saves, savers }) */
async function clash(save) {
  try { await save(); } catch (e) { return { status: e.status, current: e.current, ...(e.extra || {}) }; }
  return null;
}

for (const n of [31, 300]) {
  test(`2: a meeting: Pat's change, then ${n} saves in the founder's other tab: the question names Pat, and with the other tab clashing too, both`, async () => {
    for (const both of [false, true]) {
      const made = await saveMeeting(env.DB, cleanMeeting({ date: inDays(30), title: 'Q4 Board Meeting', sections: MEETING }), { by: FOUNDER });
      const opened0 = await getMeeting(env.DB, made.id);
      await later();
      // Pat renames Roll call and saves; the founder's other tab (opened after) saves n times, one autosave per pause
      let cur = await saveMeeting(env.DB, retitle(opened0, 'i_r11roll', 'Roll call (Pat)'), { by: PAT, base: opened0.updatedAt, edit: true });
      for (let i = 0; i < n; i++) {
        const next = renote(both && i === 0 ? retitle(cur, 'i_r11roll', 'Roll call (other tab)') : cur, 'i_r11q', `Note ${i + 1}`);
        cur = await saveMeeting(env.DB, next, { by: FOUNDER, base: cur.updatedAt, edit: true });
      }
      // Tab A, opened before both, renames Roll call (it was offline) and saves
      const mine = retitle(opened0, 'i_r11roll', 'Roll call (Jane)');
      const j = await clash(() => saveMeeting(env.DB, mine, { by: FOUNDER, base: opened0.updatedAt, edit: true }));
      assert.equal(j?.status, 409);
      const was = cleanMeeting(opened0);
      const { clashes } = mergeMeeting(was, cleanMeeting(mine), cleanMeeting(j.current));
      assert.deepEqual(clashes, ['“Roll call (Jane)”']);
      const who = page.clashWho({ clashes, was, mine: cleanMeeting(mine), saves: j.saves, savers: j.savers, by: j.current.updatedBy, shape: cleanMeeting });
      const q = page.clashQuestion({ by: j.current.updatedBy, me: FOUNDER, what: 'this meeting', clashes, who, unknown: who === null });
      if (!both) {
        assert.deepEqual(who, [{ by: PAT, clashes }], `${n} saves: Pat changed it, never only the other tab`);
        assert.equal(q.title, 'Pat changed this meeting too');
        assert.equal(q.text, 'You both changed “Roll call (Jane)”. Keep yours there, or take theirs? Everything else from both of you is kept.');
      } else {
        assert.deepEqual(who.map((x) => x.by), [PAT, FOUNDER]);
        assert.equal(q.title, 'Your other tab and Pat changed this meeting too');
      }
    }
  });

  test(`2: the agenda template: Pat's change, then ${n} saves in the founder's other tab: the question names Pat`, async () => {
    const s0 = await getSettings(env.DB);
    const asM = (sections) => cleanMeeting({ sections });
    const opened0 = await saveSettings(env.DB, { template: MEETING }, FOUNDER, { base: s0.templateAt });
    await later();
    let cur = await saveSettings(env.DB, { template: retitle({ sections: opened0.template }, 'i_r11roll', 'Governance (Pat)').sections }, PAT, { base: opened0.templateAt });
    // (the template keeps each item's name and who presents: the other tab renames another item, a pause at a time)
    for (let i = 0; i < n; i++) cur = await saveSettings(env.DB, { template: retitle({ sections: cur.template }, 'i_r11q', `Questions ${i + 1}`).sections }, FOUNDER, { base: cur.templateAt });
    const mine = retitle({ sections: opened0.template }, 'i_r11roll', 'Governance (Jane)').sections;
    const j = await clash(() => saveSettings(env.DB, { template: mine }, FOUNDER, { base: opened0.templateAt }));
    assert.equal(j?.status, 409);
    const was = asM(opened0.template);
    const { clashes } = mergeMeeting(was, asM(mine), asM(j.current.template));
    assert.deepEqual(clashes, ['“Governance (Jane)”']);
    const who = page.clashWho({ clashes, was, mine: asM(mine), saves: j.saves, savers: j.savers, by: j.current.by, shape: asM });
    assert.deepEqual(who, [{ by: PAT, clashes }], `${n} saves: Pat changed it`);
    const q = page.clashQuestion({ by: j.current.by, me: FOUNDER, what: 'the agenda template', clashes, who, unknown: who === null });
    assert.equal(q.title, 'Pat changed the agenda template too');
  });
}

test('2: a practice meeting: Pat\'s change, then 31 saves in the founder\'s other tab: the question names Pat', async () => {
  const p0 = await createPractice(env, { by: FOUNDER });
  const it = p0.sections.flatMap((s) => s.items).filter((x) => x.title);
  assert.ok(it.length >= 2, 'setup: a practice agenda');
  const [a, b] = it;
  const opened0 = await saveMeeting(env.DB, retitle(p0, a.id, 'First'), { by: FOUNDER, base: p0.updatedAt });
  await later();
  let cur = await saveMeeting(env.DB, retitle(opened0, a.id, 'First (Pat)'), { by: PAT, base: opened0.updatedAt });
  for (let i = 0; i < 31; i++) cur = await saveMeeting(env.DB, renote(cur, b.id, `Note ${i + 1}`), { by: FOUNDER, base: cur.updatedAt });
  const mine = retitle(opened0, a.id, 'First (Jane)');
  const j = await clash(() => saveMeeting(env.DB, mine, { by: FOUNDER, base: opened0.updatedAt }));
  assert.equal(j?.status, 409);
  const { clashes } = mergeMeeting(cleanMeeting(opened0), cleanMeeting(mine), cleanMeeting(j.current));
  assert.deepEqual(page.clashWho({ clashes, was: cleanMeeting(opened0), mine: cleanMeeting(mine), saves: j.saves, savers: j.savers, by: j.current.updatedBy, shape: cleanMeeting }), [{ by: PAT, clashes }]);
});

test('2: a copy older than the history Board keeps: the 409 says it can\'t tell who saved since, and the question says so in words, naming nobody', async () => {
  const made = await saveMeeting(env.DB, cleanMeeting({ date: inDays(30), title: 'Q4 Board Meeting', sections: MEETING }), { by: FOUNDER });
  const opened0 = await getMeeting(env.DB, made.id);
  await later();
  const pat = await saveMeeting(env.DB, retitle(opened0, 'i_r11roll', 'Roll call (Pat)'), { by: PAT, base: opened0.updatedAt, edit: true });
  await later();
  await saveMeeting(env.DB, renote(pat, 'i_r11q', 'A note'), { by: 'holly@soardcharity.com', base: pat.updatedAt, edit: true });
  // (the history before the last save gone: older than Board keeps, say)
  await env.DB.prepare('DELETE FROM board_saves WHERE record = ? AND by != ?').bind(`board_meetings:${made.id}`, 'holly@soardcharity.com').run();
  const mine = retitle(opened0, 'i_r11roll', 'Roll call (Jane)');
  const j = await clash(() => saveMeeting(env.DB, mine, { by: FOUNDER, base: opened0.updatedAt, edit: true }));
  assert.equal(j?.status, 409);
  assert.deepEqual([j.saves, j.savers], [null, null], 'nobody named from the saves it has left');
  const { clashes } = mergeMeeting(cleanMeeting(opened0), cleanMeeting(mine), cleanMeeting(j.current));
  const who = page.clashWho({ clashes, was: cleanMeeting(opened0), mine: cleanMeeting(mine), saves: j.saves, savers: j.savers, by: j.current.updatedBy, shape: cleanMeeting });
  assert.equal(who, null);
  const q = page.clashQuestion({ by: j.current.updatedBy, me: FOUNDER, what: 'this meeting', clashes, who, unknown: who === null });
  assert.equal(q.title, 'This meeting changed since this page opened it');
  assert.equal(q.text, '“Roll call (Jane)” changed here and on the site since this page opened it, too long ago for Board to know who changed it. Keep what’s here, or take what’s saved? Everything else from both is kept.');
  assert.ok(!/Holly|other tab|[—–]/.test(q.title + q.text), 'no name guessed, no long dashes');
});

test('2: a page whose copy is from the middle of one person\'s run of saves (kept as one) still has them named for what they changed after it', async () => {
  const made = await saveMeeting(env.DB, cleanMeeting({ date: inDays(30), title: 'Q4 Board Meeting', sections: MEETING }), { by: FOUNDER });
  await later();
  let cur = await saveMeeting(env.DB, renote(await getMeeting(env.DB, made.id), 'i_r11q', 'Note 1'), { by: PAT, base: made.updatedAt, edit: true });
  const opened0 = cur; // (a tab opened here, after Pat's first save)
  for (let i = 2; i <= 5; i++) cur = await saveMeeting(env.DB, renote(i === 3 ? retitle(cur, 'i_r11roll', 'Roll call (Pat)') : cur, 'i_r11q', `Note ${i}`), { by: PAT, base: cur.updatedAt, edit: true });
  const rows = (await env.DB.prepare('SELECT by FROM board_saves WHERE record = ? ORDER BY at').bind(`board_meetings:${made.id}`).all()).results.map((r) => r.by);
  assert.deepEqual(rows, [FOUNDER, PAT], 'Pat\'s five saves kept as one');
  const mine = retitle(opened0, 'i_r11roll', 'Roll call (Jane)');
  const j = await clash(() => saveMeeting(env.DB, mine, { by: FOUNDER, base: opened0.updatedAt, edit: true }));
  const { clashes } = mergeMeeting(cleanMeeting(opened0), cleanMeeting(mine), cleanMeeting(j.current));
  assert.deepEqual(page.clashWho({ clashes, was: cleanMeeting(opened0), mine: cleanMeeting(mine), saves: j.saves, savers: j.savers, by: j.current.updatedBy, shape: cleanMeeting }), [{ by: PAT, clashes: ['“Roll call (Jane)”'] }]);
});
