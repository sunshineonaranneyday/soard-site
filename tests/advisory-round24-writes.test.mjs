/**
 * Advisory Board QA round 24, the follow-up to decided 2 (a step's result comes from its own write, never a read after
 * it), for the Advisory Board's staff writes: an introduction's status, a hosted fundraiser's status and its Zeffy page,
 * who we're looking for, a paper, the monthly ask (saved, and put out), a meeting (made, saved, shared, a file renamed),
 * and the money (a gift credited or taken off, a page matched). Each answered with a read made after its write; that read
 * not answering said "That didn't go through" of a change that had landed, and pressing again saved a second ask, wish
 * or paper, or had the editor's next save refused as someone else's. Now each answers with what its own write saved
 * (RETURNING), and the money, whose answer is the totals across every gift, answers its change done whatever its refresh.
 * Each: every read of what it wrote, after the write, fails; the change answers, as a fresh read has it, and is there once.
 * Made-up people only (the repo is public); nothing leaves this machine.
 * Run: node --test tests/advisory-round24-writes.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import * as A from '../functions/api/_advisory.js';
import { writeState } from '../functions/api/_board-roles.js';

const D1_DOWN = () => new Error('D1_ERROR: the database didn’t answer');
/**
 * The database as the change meets it: once a statement that writes `table` (a table's name, or the write's own SQL as a
 * pattern) has run, every later read matching `reads` fails (D1's error), as a read after a write that landed, not
 * answering. → { DB, state: { wrote, failed } }
 */
function readsFailAfterWrite(DB, table, reads) {
  const writes = typeof table === 'string' ? (sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql) && sql.includes(table) : (sql) => table.test(sql);
  const state = { wrote: false, failed: 0 };
  const gate = async (sql, run) => {
    if (state.wrote && /^\s*SELECT/i.test(sql) && reads.test(sql)) { state.failed += 1; throw D1_DOWN(); }
    const out = await run();
    if (writes(sql)) state.wrote = true;
    return out;
  };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: (c) => gate(st._sql, () => st.first(c)), all: () => gate(st._sql, () => st.all()), run: () => gate(st._sql, () => st.run()) });
  return { DB: { ...DB, prepare: (sql) => wrap(DB.prepare(sql)), batch: (s) => DB.batch(s) }, state };
}
const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };
const outcome = (p) => quietly(() => p.then((value) => ({ value }), (e) => ({ failed: e.message || String(e) })));

async function world() {
  const DB = await createD1();
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind('ivy-member', 'Ivy Member', 'advisory', JSON.stringify({ name: 'Ivy Member', group: 'advisory', status: 'active' })).run();
  await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('ivy-member', 'ivy.m@example.org').run();
  await A.ensureAdvisory(DB);
  await writeState(DB, 'advisory', { emails: false });
  return { DB };
}
const count = async (DB, table) => (await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;

const who = { slug: 'ivy-member', email: 'ivy.m@example.org' };
/** The change made with every read of what it wrote failing after its write: it answers, and as a fresh read has it */
async function answersFromItsWrite(label, change, { fresh, check = () => true }) {
  const out = await outcome(change());
  assert.ok(!out.failed, `${label}: said "${out.failed}" of a change that landed`);
  assert.ok(check(out.value), `${label}: ${JSON.stringify(out.value).slice(0, 300)}`);
  if (fresh) assert.deepEqual(out.value, await fresh(out.value), `${label}: as a fresh read has it`);
  return out.value;
}

// ─── The monthly ask ───────────────────────────────────────────────

test('the monthly ask, saved new: answers as its write saved it; one ask, never a second', async () => {
  const { DB } = await world();
  const f = readsFailAfterWrite(DB, 'advisory_asks', /FROM advisory_asks/);
  const ask = await answersFromItsWrite('saved', () => A.saveAsk(f.DB, { title: 'A plumber for three rooms', body: 'An introduction is all it takes.' }, { by: 'x' }), {
    fresh: async (v) => (await A.listAsks(DB)).find((a) => a.id === v.id), check: (v) => v.title === 'A plumber for three rooms' });
  assert.equal((await A.listAsks(DB)).filter((a) => a.title === ask.title).length, 1, 'one ask');
});
test('the monthly ask, put out: answers as its write saved it', async () => {
  const { DB } = await world();
  const ask = await A.saveAsk(DB, { title: 'A plumber for three rooms' }, { by: 'x' });
  const f = readsFailAfterWrite(DB, 'advisory_asks', /FROM advisory_asks WHERE id/);
  await answersFromItsWrite('put out', () => A.putAskOut(f.DB, ask.id), { fresh: async (v) => (await A.listAsks(DB)).find((a) => a.id === v.id), check: (v) => !!v.sentAt && !v.closedAt });
  await assert.rejects(() => A.putAskOut(DB, 'ask_nothere1'), (e) => e.status === 404);
});

// ─── Who we're looking for ───────────────────────────────────────────

test('who we\'re looking for, saved new: answers as its write saved it; one entry, never a second', async () => {
  const { DB } = await world();
  const f = readsFailAfterWrite(DB, 'advisory_wishlist', /FROM advisory_wishlist/);
  await answersFromItsWrite('made', () => A.saveWish(f.DB, { title: 'A licensed electrician', detail: 'North Fulton' }, { by: 'x' }), {
    fresh: async (v) => (await A.listWishes(DB)).find((w) => w.id === v.id), check: (v) => v.title === 'A licensed electrician' });
  assert.equal(await count(DB, 'advisory_wishlist'), 1, 'one entry');
});
test('who we\'re looking for, changed: answers as its write saved it', async () => {
  const { DB } = await world();
  const wish = await A.saveWish(DB, { title: 'A licensed electrician' }, { by: 'x' });
  const f = readsFailAfterWrite(DB, 'advisory_wishlist', /FROM advisory_wishlist(?! WHERE id = \? *$)/);
  await answersFromItsWrite('changed', () => A.saveWish(f.DB, { id: wish.id, title: 'A licensed electrician or two' }, { by: 'x' }), {
    fresh: async (v) => (await A.listWishes(DB)).find((w) => w.id === v.id), check: (v) => v.title === 'A licensed electrician or two' });
});

// ─── Introductions and fundraisers ───────────────────────────────────

test('an introduction\'s status: answers as its write saved it, the change said changed; one deleted meanwhile is said as gone', async () => {
  const { DB } = await world();
  const intro = await A.addIntro(DB, who, { name: 'Pat Plumber', company: 'Pat Plumbing' });
  const f = readsFailAfterWrite(DB, 'advisory_intros', /FROM advisory_intros/);
  await answersFromItsWrite('intro', () => A.setIntroStatus(f.DB, intro.id, { status: 'talking', note: 'Called Pat.' }, { by: 'x' }), {
    fresh: async (v) => ({ intro: (await A.listIntros(DB)).find((x) => x.id === intro.id), changed: true }), check: (v) => v.intro.status === 'talking' && v.intro.note === 'Called Pat.' && v.changed });
  await DB.prepare('DELETE FROM advisory_intros WHERE id = ?').bind(intro.id).run();
  await assert.rejects(() => A.setIntroStatus(DB, intro.id, { status: 'talking' }), (e) => e.status === 404);
});
test('a fundraiser\'s status: answers as its write saved it, the change said changed', async () => {
  const { DB } = await world();
  const hosted = await A.requestHost(DB, who, { title: 'A backyard dinner' });
  const f = readsFailAfterWrite(DB, 'advisory_hosted', /FROM advisory_hosted/);
  await answersFromItsWrite('hosted', () => A.setHosted(f.DB, hosted.id, { status: 'approved', date: '2031-05-01' }, { by: 'x' }), {
    fresh: async () => ({ hosted: (await A.listHosted(DB)).find((x) => x.id === hosted.id), changed: true }), check: (v) => v.hosted.status === 'approved' && v.hosted.date === '2031-05-01' && v.changed });
});
test('a fundraiser\'s Zeffy page: answers as its write saved it', async () => {
  const { DB } = await world();
  const hosted = await A.requestHost(DB, who, { title: 'A backyard dinner' });
  await A.setHosted(DB, hosted.id, { status: 'approved' }, { by: 'x' });
  const f = readsFailAfterWrite(DB, 'advisory_hosted', /FROM advisory_hosted/);
  const url = 'https://www.zeffy.com/en-US/peer-to-peer/a-backyard-dinner';
  await answersFromItsWrite('link', () => A.setHostedLink(f.DB, hosted.id, url, { by: 'x' }), { fresh: async () => (await A.listHosted(DB)).find((x) => x.id === hosted.id), check: (v) => v.giveUrl === url });
});

// ─── Papers ───────────────────────────────────────────────────────────

test('a paper, saved new: answers as its write saved it; one paper, never a second', async () => {
  const { DB } = await world();
  await (await import('../functions/api/_board.js')).ensureSchema(DB);
  const papers0 = await count(DB, 'advisory_docs');
  const f = readsFailAfterWrite(DB, 'advisory_docs', /FROM advisory_docs|FROM board_files/);
  await answersFromItsWrite('made', () => A.saveDoc(f.DB, { kind: 'pitch', title: 'Our 30-second pitch', body: 'Kids, rooms, joy.' }, { by: 'x' }), {
    fresh: async (v) => (await A.listDocs(DB)).find((d) => d.id === v.id), check: (v) => v.title === 'Our 30-second pitch' });
  assert.equal(await count(DB, 'advisory_docs'), papers0 + 1, 'one paper');
});
test('a paper with a file on it, changed: answers as its write saved it, its file kept', async () => {
  const { DB } = await world();
  await (await import('../functions/api/_board.js')).ensureSchema(DB);
  const doc = await A.saveDoc(DB, { kind: 'pitch', title: 'Our 30-second pitch', body: 'Kids, rooms, joy.' }, { by: 'x' });
  await DB.prepare("INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by) VALUES ('f_pitchfile1', 'advisory-doc', ?, 'k', 'pitch.pdf', 'application/pdf', 10, 'other', 0, ?, 'x')").bind(doc.id, new Date().toISOString()).run();
  const f = readsFailAfterWrite(DB, 'advisory_docs', /FROM advisory_docs|FROM board_files/);
  await answersFromItsWrite('changed', () => A.saveDoc(f.DB, { ...doc, body: 'Kids, rooms, joy, and you.' }, { by: 'x', base: doc.updatedAt }), {
    fresh: async (v) => (await A.listDocs(DB)).find((d) => d.id === v.id), check: (v) => v.body === 'Kids, rooms, joy, and you.' && v.files.map((x) => x.id).join() === 'f_pitchfile1' });
});

// ─── Meetings ─────────────────────────────────────────────────────────

const MEET_READS = /FROM advisory_meetings|FROM board_files/;
const meetingWorld = async () => {
  const w = await world();
  const M = await import('../functions/api/_advisory-meetings.js');
  const act = (DBx, action, body) => M.meetingAction({ env: { DB: DBx }, request: new Request('https://site.test/api/advisory-admin', { method: 'POST' }), data: {} }, { action, body, by: 'x', w: { runs: true, kind: 'admin' } })
    .then(async (r) => ({ status: r.status, ...(await r.json()) }));
  return { ...w, M, act };
};
test('a meeting, made: answers as its write saved it', async () => {
  const { DB, M } = await meetingWorld();
  const f = readsFailAfterWrite(DB, 'advisory_meetings', MEET_READS);
  await answersFromItsWrite('made', () => M.createAdvisoryMeeting({ DB: f.DB }, { date: '2031-03-12', by: 'x' }), {
    fresh: async (v) => ({ meeting: await M.getAdvisoryMeeting(DB, v.meeting.id), existing: false }), check: (v) => v.meeting?.date === '2031-03-12' });
});
test('a meeting, saved: answers as its write saved it, and the editor\'s next save, from that answer, is its own (never "someone saved this meeting since")', async () => {
  const { DB, M } = await meetingWorld();
  const { meeting: m } = await M.createAdvisoryMeeting({ DB }, { date: '2031-03-12', by: 'x' });
  const f = readsFailAfterWrite(DB, 'advisory_meetings', MEET_READS);
  const saved = await answersFromItsWrite('saved', () => M.saveAdvisoryMeeting(f.DB, { ...m, title: 'Spring check-in' }, { by: 'x', base: m.updatedAt }), {
    fresh: () => M.getAdvisoryMeeting(DB, m.id), check: (v) => v.title === 'Spring check-in' });
  const next = await M.saveAdvisoryMeeting(DB, { ...saved, title: 'Spring check-in, 6:30' }, { by: 'x', base: saved.updatedAt });
  assert.equal(next.title, 'Spring check-in, 6:30');
});
test('a meeting, shared: answers as its write saved it', async () => {
  const { DB, M, act } = await meetingWorld();
  const { meeting: m } = await M.createAdvisoryMeeting({ DB }, { date: '2031-03-12', by: 'x' });
  const f = readsFailAfterWrite(DB, 'advisory_meetings', MEET_READS);
  const r = await quietly(() => act(f.DB, 'share-meeting', { id: m.id, shared: true }));
  assert.equal(r.status, 200, `shared: said "${r.error}" of a change that landed`);
  assert.equal(r.meeting.shared, true);
  assert.deepEqual(r.meeting, await M.getAdvisoryMeeting(DB, m.id));
});
test('a file on a meeting, renamed: answers with the file as its change saved it, on the meeting', async () => {
  const { DB, M, act } = await meetingWorld();
  const { meeting: m } = await M.createAdvisoryMeeting({ DB }, { date: '2031-03-12', by: 'x' });
  await DB.prepare("INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by) VALUES ('f_meetfile1', 'advisory-meeting', ?, 'k', 'agenda.pdf', 'application/pdf', 10, 'other', 0, ?, 'x')").bind(m.id, new Date().toISOString()).run();
  // (the file's own change: Board's file setup writes board_files too, before anything)
  const f = readsFailAfterWrite(DB, /^UPDATE board_files SET kind = \?/, MEET_READS);
  const r = await quietly(() => act(f.DB, 'update-meeting-file', { fileId: 'f_meetfile1', name: 'Agenda, spring.pdf' }));
  assert.equal(r.status, 200, `renamed: said "${r.error}" of a change that landed`);
  assert.equal(r.file.name, 'Agenda, spring.pdf');
  assert.deepEqual(r.meeting, await M.getAdvisoryMeeting(DB, m.id));
});

// ─── The money ────────────────────────────────────────────────────────

const offline = async () => { throw new Error('offline'); };
const MONEY_READS = /FROM advisory_credits|FROM board_state|FROM team/;
test('a gift credited: done once its write is, whatever the refresh of the totals after it; credited once', async () => {
  const { DB } = await world();
  const money = await import('../functions/api/_advisory-money.js');
  const f = readsFailAfterWrite(DB, 'advisory_credits', MONEY_READS);
  const settings = await A.getSettings(DB);
  await answersFromItsWrite('credited', () => money.creditGift({ DB: f.DB }, settings, { paymentId: 'pay_roundtwentyfour', slug: 'ivy-member' }, { by: 'x', fetchImpl: offline }), {});
  assert.deepEqual((await DB.prepare("SELECT slug FROM advisory_credits WHERE payment_id = 'pay_roundtwentyfour'").all()).results.map((r) => r.slug), ['ivy-member']);
  // (with everything answering, the money as it is, as before)
  const view = await money.creditGift({ DB }, await A.getSettings(DB), { paymentId: 'pay_roundtwentyfive', slug: '' }, { by: 'x', fetchImpl: offline });
  assert.ok(Array.isArray(view?.credits) && view.credits.length === 2, JSON.stringify(view).slice(0, 200));
});
test('a gift taken off: done once its write is, whatever the refresh after it', async () => {
  const { DB } = await world();
  const money = await import('../functions/api/_advisory-money.js');
  await DB.prepare("INSERT OR REPLACE INTO advisory_credits (payment_id, slug, note, at, by) VALUES ('pay_roundtwentyfour', NULL, '', ?, 'x')").bind(new Date().toISOString()).run();
  const f = readsFailAfterWrite(DB, 'advisory_credits', MONEY_READS);
  const settings = await A.getSettings(DB);
  await answersFromItsWrite('taken off', () => money.uncreditGift({ DB: f.DB }, settings, { paymentId: 'pay_roundtwentyfour' }, { fetchImpl: offline }), {});
  assert.equal(await count(DB, 'advisory_credits'), 0);
});
test('a Zeffy page matched to a member: done once its write is, whatever the refresh after it', async () => {
  const { DB } = await world();
  const money = await import('../functions/api/_advisory-money.js');
  const f = readsFailAfterWrite(DB, 'board_state', MONEY_READS);
  const settings = await A.getSettings(DB);
  await answersFromItsWrite('matched', () => money.matchPage({ DB: f.DB }, settings, { campaignId: 'camp_roundtwentyfour', slug: 'ivy-member' }, { fetchImpl: offline }), {});
  assert.equal((await A.getSettings(DB)).pages.camp_roundtwentyfour, 'ivy-member');
});
