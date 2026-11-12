/**
 * Donors & Partners, step 5: thank-yous (functions/api/_donor-thanks.js), owners, notes and History on a donor's page
 * (functions/api/_donor-crm.js), the To thank list, and the Slack "Major gift" link. Names, emails and amounts are made up.
 * Run: node --test tests/donor-thanks.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import * as D from '../functions/api/_donors.js';
import * as C from '../functions/api/_donor-crm.js';
import * as T from '../functions/api/_donor-thanks.js';
import { giftMessage } from '../functions/api/_zeffy.js';
import { RUNTIME_TYPES } from '../functions/api/pending-changes.js';

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = Date.parse('2026-11-12T15:00:00Z');
const S = (ms) => Math.floor(ms / 1000);
let db;
let env;
let n = 0;
const pay = (o = {}) => ({
  id: o.id || `pay_${++n}`, object: 'payment', created: o.created ?? S(START + HOUR), amount: o.amount ?? 10000,
  status: o.status || 'succeeded', type: o.type || 'online', refund_status: o.refund || 'none', refunds: o.refunds || [], description: o.description ?? 'Help Build a Brighter Home',
  contact: o.contact === undefined ? 'ct_jane' : o.contact, payment_method: { type: o.method || 'card' },
  buyer: { email: o.email ?? 'jane@example.com', first_name: o.first ?? 'Jane', last_name: o.last ?? 'Doe', is_corporate: !!o.company, company_name: o.company || null },
  campaign_category: o.category || 'donation', items: o.items || [{ type: 'donation', amount: o.amount ?? 10000 }],
  buyer_questions: [], recurring: o.every ? { is_recurring: true, interval: o.every, subscription_id: o.sub || null } : null, metadata: {},
});
const note = async (p, at = START + 2 * HOUR) => D.noteDonorPayment(env, p, { now: at });
const todo = async () => (await db.prepare("SELECT id, ids, state, why, cents FROM donor_thanks WHERE state = 'todo' ORDER BY at").all()).results;
const row = async (id) => (await db.prepare('SELECT * FROM donor_thanks WHERE id = ?').bind(id).first());
const by = 'alex@soardcharity.com';
const doIt = (body, at = START + 3 * HOUR) => C.act(env, body, by, { now: at });
const partner = (slug, name, level = 'friend') => `INSERT INTO partners VALUES ('${slug}', '${JSON.stringify({ name, level, category: ['funding'] }).replace(/'/g, "''")}')`;
const directory = (accounts) => `INSERT INTO staff_state (key, data) VALUES ('directory', '${JSON.stringify({ ok: true, accounts }).replace(/'/g, "''")}')`;

beforeEach(async () => {
  db = await createD1({ schemaSql: [
    'CREATE TABLE kids (slug TEXT, name TEXT, data TEXT)',
    'CREATE TABLE partners (slug TEXT PRIMARY KEY, data TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
    'CREATE TABLE staff_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)',
    partner('acme', 'Acme Builders'),
    directory([
      { email: 'alex@soardcharity.com', aliases: [], name: 'Alex Rivera', active: true },
      { email: 'jordan@soardcharity.com', aliases: [], name: 'Jordan Hale', active: true },
      { email: 'automation@soardcharity.com', aliases: [], name: 'Agent Gracie', active: true },
      { email: 'gone@soardcharity.com', aliases: [], name: 'Old Teammate', active: false },
    ]),
  ] });
  env = { DB: db };
  // Thank-yous begin
  await T.syncThanks(env, { now: START });
});

// ─── Which gifts ────────────────────────────────────────────────────

test('the rule: anything Zeffy didn’t take online, and $1,000 or more however it came; never tickets or refunds', () => {
  const g = (o) => ({ cents: 10000, method: 'card', type: 'online', ...o });
  assert.equal(T.thankWhy(g({ method: 'cheque' })), 'check');
  assert.equal(T.thankWhy(g({ method: 'daf' })), 'daf');
  assert.equal(T.thankWhy(g({ method: 'in_kind', inKind: true })), 'kind');
  assert.equal(T.thankWhy(g({ type: 'manual', method: 'cash' })), 'hand');
  assert.equal(T.thankWhy(g({ type: 'manual', method: 'card' })), 'hand', 'a card typed in by hand: Zeffy sends nothing');
  assert.equal(T.thankWhy(g({})), null, 'online under $1,000: Zeffy thanked them');
  assert.equal(T.thankWhy(g({ cents: 100000 })), 'major');
  assert.equal(T.thankWhy(g({ cents: 99999 })), null);
  assert.equal(T.thankWhy(g({ type: 'imported', method: 'cheque' })), 'check', 'an imported check: Zeffy sends nothing (whether it is new is the date’s to say)');
  assert.equal(T.thankWhy(g({ type: 'imported', method: 'card', cents: 50000 })), null, 'an imported card gift under $1,000: its platform sent the receipt');
  assert.equal(T.thankWhy(g({ type: 'imported', method: 'card', cents: 250000 })), 'major');
  assert.equal(T.thankWhy(g({ cents: 0, method: 'cheque' })), null, 'a ticket, or refunded in full');
  assert.equal(T.thankWhy(g({ every: 'monthly', cents: 200000 }), { first: false }), null, 'a monthly gift only its first time');
  assert.equal(T.thankWhy(g({ every: 'monthly', cents: 200000 }), { first: true }), 'major');
});

test('new gifts become To thank as they come in: a check, a DAF gift, a big card gift; a small card gift and a ticket don’t', async () => {
  await note(pay({ id: 'chk_1', method: 'cheque', amount: 50000 }));
  await note(pay({ id: 'daf_1', method: 'daf', company: 'Fidelity Charitable', amount: 25000, contact: 'ct_sam', first: 'Sam', last: 'Lee', email: 'sam@example.com' }));
  await note(pay({ id: 'big_1', amount: 150000, contact: 'ct_ann', first: 'Ann', last: 'Wu', email: 'ann@example.com' }));
  await note(pay({ id: 'small_1', amount: 5000 }));
  await note(pay({ id: 'tix_1', amount: 20000, method: 'cheque', category: 'event', items: [{ type: 'ticket', amount: 20000, rate_title: 'Foursome' }] }));
  const t = await todo();
  assert.deepEqual(t.map((x) => [x.id, x.why]).sort(), [['big_1', 'major'], ['chk_1', 'check'], ['daf_1', 'daf']]);
  assert.equal((await C.listView(env, { now: START + 3 * HOUR })).thanks, 3, 'the Donors list counts them');
});

test('gifts from before thank-yous began are taken as thanked; a back-dated check first seen after the whole history read is new', async () => {
  // History, read by the first nightly read (dated before it began)
  await D.noteDonorPayment(env, pay({ id: 'old_chk', method: 'cheque', created: S(START - 30 * DAY), amount: 90000 }), { now: START + 10 * MIN, thanks: false });
  await T.syncThanks(env, { now: START + 20 * MIN });
  assert.equal((await todo()).length, 0, 'an old check is not asked about');
  // The history read finishes
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('donors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ filledAt: new Date(START + HOUR).toISOString() })).run();
  await T.syncThanks(env, { now: START + HOUR + MIN });
  // A check dated last month, typed into Zeffy today
  await note(pay({ id: 'late_chk', method: 'cheque', created: S(START - 20 * DAY), amount: 30000 }), START + 2 * HOUR);
  assert.deepEqual((await todo()).map((x) => x.id), ['late_chk']);
});

test('an import: a gala’s gifts dated after thank-yous began are To thank; old history imported later never is', async () => {
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('donors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ filledAt: new Date(START + HOUR).toISOString() })).run();
  await T.syncThanks(env, { now: START + HOUR + MIN });
  // Last year's gifts, imported today: first seen after the history read, dated long before
  await note(pay({ id: 'imp_old_big', type: 'imported', created: S(START - 400 * DAY), amount: 500000, contact: 'ct_old', first: 'Olive', last: 'Old', email: 'olive@example.com' }), START + 2 * HOUR);
  await note(pay({ id: 'imp_old_chk', type: 'imported', method: 'cheque', created: S(START - 400 * DAY), amount: 20000, contact: 'ct_old', first: 'Olive', last: 'Old', email: 'olive@example.com' }), START + 2 * HOUR);
  assert.equal((await todo()).length, 0, 'old history, imported now, was thanked long ago');
  // A gala held after thank-yous began, imported from its auction platform weeks later
  const gala = START + 10 * DAY;
  for (const p of [
    pay({ id: 'gala_big', type: 'imported', created: S(gala), amount: 250000, contact: 'ct_gb', first: 'Gil', last: 'Big', email: 'gil@example.com', description: 'Gala Donations & Auction - Import' }),
    pay({ id: 'gala_chk', type: 'imported', method: 'cheque', created: S(gala), amount: 30000, contact: 'ct_gc', first: 'Cora', last: 'Check', email: 'cora@example.com', description: 'Gala Donations & Auction - Import' }),
    pay({ id: 'gala_small', type: 'imported', created: S(gala), amount: 15000, contact: 'ct_gs', first: 'Sal', last: 'Small', email: 'sal@example.com', description: 'Gala Donations & Auction - Import' }),
  ]) await note(p, gala + 40 * DAY);
  assert.deepEqual((await todo()).map((x) => [x.id, x.why]).sort(), [['gala_big', 'major'], ['gala_chk', 'check']], 'its $1,000 gift and its check; a card gift under $1,000 needs nothing');
});

test('a gift Zeffy split into charges is one gift: two card charges of $600 within the hour are a $1,200 gift to thank, once', async () => {
  await note(pay({ id: 'split_a', amount: 60000, created: S(START + HOUR) }));
  assert.equal((await todo()).length, 0, '$600 alone needs nothing');
  await note(pay({ id: 'split_b', amount: 60000, created: S(START + HOUR + 10 * MIN) }));
  const t = await todo();
  assert.equal(t.length, 1);
  assert.equal(t[0].cents, 120000);
  assert.deepEqual(t[0].ids.split(' ').sort(), ['split_a', 'split_b']);
  // A third charge joins the same one
  await note(pay({ id: 'split_c', amount: 10000, created: S(START + HOUR + 20 * MIN) }));
  const t2 = await todo();
  assert.equal(t2.length, 1);
  assert.equal(t2[0].cents, 130000);
});

test('a monthly gift: To thank its first time only, and only once the whole history is read', async () => {
  await note(pay({ id: 'm1', amount: 150000, every: 'monthly', sub: 'sub_9', created: S(START + HOUR) }));
  assert.equal((await todo()).length, 0, 'waits for the whole history (its first time isn’t known yet)');
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('donors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ filledAt: new Date(START + 2 * HOUR).toISOString() })).run();
  await T.syncThanks(env, { now: START + 2 * HOUR + MIN });
  assert.deepEqual((await todo()).map((x) => x.id), ['m1']);
  await note(pay({ id: 'm2', amount: 150000, every: 'monthly', sub: 'sub_9', created: S(START + 31 * DAY) }), START + 31 * DAY);
  assert.deepEqual((await todo()).map((x) => x.id), ['m1'], 'the second month isn’t asked about');
});

test('a plan already going before thank-yous began is never asked about', async () => {
  await D.noteDonorPayment(env, pay({ id: 'mo_old', amount: 150000, every: 'monthly', sub: 'sub_1', created: S(START - 40 * DAY) }), { now: START + MIN, thanks: false });
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('donors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ filledAt: new Date(START + HOUR).toISOString() })).run();
  await note(pay({ id: 'mo_new', amount: 150000, every: 'monthly', sub: 'sub_1', created: S(START + 2 * HOUR) }), START + 2 * HOUR);
  assert.equal((await todo()).length, 0);
});

// ─── Saying it ──────────────────────────────────────────────────────

test('Thanked records who and when; Undo puts it back; Not needed is said too; the History of the donor has each', async () => {
  await note(pay({ id: 'chk_9', method: 'cheque', amount: 50000 }));
  await doIt({ act: 'thanks', id: 'chk_9', state: 'thanked' });
  let r = await row('chk_9');
  assert.equal(r.state, 'thanked');
  assert.equal(r.done_by, by);
  assert.ok(r.done_at);
  assert.equal((await todo()).length, 0);
  await doIt({ act: 'thanks', id: 'chk_9', state: 'todo' });
  r = await row('chk_9');
  assert.equal(r.state, 'todo');
  assert.equal(r.done_by, null);
  await doIt({ act: 'thanks', id: 'chk_9', state: 'skipped' });
  assert.equal((await row('chk_9')).state, 'skipped');
  const page = await C.personView(env, 'ct_jane', { now: START + 4 * HOUR });
  assert.equal(page.gifts[0].thanks.state, 'skipped');
  assert.equal(page.gifts[0].thanks.by, by);
  assert.deepEqual(page.history.map((h) => h.what.split(':')[0]), ['No thank-you needed', 'To thank again', 'Thanked']);
  assert.ok(page.history.every((h) => h.by === by));
  await assert.rejects(doIt({ act: 'thanks', id: 'nope', state: 'thanked' }), /no thank-you/);
});

test('a To thank closes by itself when Zeffy shows the gift refunded in full, never because a read left it out', async () => {
  await note(pay({ id: 'chk_r', method: 'cheque', amount: 50000 }));
  // Refunded in full
  await note(pay({ id: 'chk_r', method: 'cheque', amount: 50000, refund: 'full', refunds: [{ status: 'succeeded', amount: 50000 }] }), START + 5 * HOUR);
  const r = await row('chk_r');
  assert.equal(r.state, 'gone');
  assert.equal(r.gone, 'refunded');
});

test('a To thank the list lost: Zeffy asked; it stays until Zeffy says twice, hours apart, it has no such payment', async () => {
  await note(pay({ id: 'chk_lost', method: 'cheque', amount: 50000 }));
  await db.prepare("DELETE FROM donor_payments WHERE id = 'chk_lost'").run();
  env.ZEFFY_API_KEY = 'zk_test';
  let asks = 0;
  const gone = async () => { asks++; return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 }); };
  await T.syncThanks(env, { now: START + 6 * HOUR, fetchImpl: gone });
  assert.equal((await row('chk_lost')).state, 'todo', 'one answer isn’t enough');
  await T.syncThanks(env, { now: START + 7 * HOUR, fetchImpl: gone });
  assert.equal(asks, 1, 'not asked again within hours');
  await T.syncThanks(env, { now: START + 13 * HOUR, fetchImpl: gone });
  const r = await row('chk_lost');
  assert.equal(r.state, 'gone');
  assert.equal(r.gone, 'deleted');
});

test('a To thank the list lost that Zeffy still has goes back in the list and stays To thank', async () => {
  const p = pay({ id: 'chk_back', method: 'cheque', amount: 50000 });
  await note(p);
  await db.prepare("DELETE FROM donor_payments WHERE id = 'chk_back'").run();
  env.ZEFFY_API_KEY = 'zk_test';
  await T.syncThanks(env, { now: START + 6 * HOUR, fetchImpl: async () => new Response(JSON.stringify(p), { status: 200 }) });
  assert.equal((await row('chk_back')).state, 'todo');
  assert.ok(await db.prepare("SELECT 1 FROM donor_payments WHERE id = 'chk_back'").first());
});

test('the To thank list: the one waiting longest first, whose it is, and who looks after them', async () => {
  await note(pay({ id: 'chk_a', method: 'cheque', amount: 50000, created: S(START + HOUR) }));
  await note(pay({ id: 'chk_b', method: 'cheque', amount: 70000, company: 'Acme Builders', contact: 'ct_bob', first: 'Bob', last: 'Ray', email: 'bob@example.com', created: S(START + 2 * HOUR) }), START + 3 * HOUR);
  await doIt({ act: 'owner', key: 'p:acme', email: 'jordan@soardcharity.com' });
  const v = await C.thanksView(env, { now: START + 4 * HOUR });
  assert.deepEqual(v.items.map((x) => x.id), ['chk_a', 'chk_b']);
  assert.equal(v.items[0].ref, 'ct_jane');
  assert.equal(v.items[0].org, null);
  assert.deepEqual(v.items[1].org, { key: 'p:acme', name: 'Acme Builders' }, 'a gift for a partner is thanked as the partner’s');
  assert.equal(v.items[1].owner, 'jordan@soardcharity.com');
  assert.equal(v.items[1].whyText, T.WHY.check);
});

// ─── Owners, notes, History ─────────────────────────────────────────

test('an owner is someone on the team: the site’s own account, someone who left, or anyone else is refused', async () => {
  await note(pay({ id: 'c1', amount: 5000 }));
  const staff = await C.staffList(db);
  assert.deepEqual(staff.map((s) => s.email), ['alex@soardcharity.com', 'jordan@soardcharity.com'], 'active people, by name; not Agent Gracie, not who left');
  await doIt({ act: 'owner', key: 'c:ct_jane', email: 'Alex@soardcharity.com' });
  let page = await C.personView(env, 'ct_jane', { now: START + 4 * HOUR });
  assert.equal(page.owner, 'alex@soardcharity.com');
  assert.deepEqual(page.staff.map((s) => s.email), ['alex@soardcharity.com', 'jordan@soardcharity.com']);
  assert.equal((await C.listView(env, { now: START + 4 * HOUR })).people.find((p) => p.key === 'c:ct_jane').owner, 'alex@soardcharity.com');
  await assert.rejects(doIt({ act: 'owner', key: 'c:ct_jane', email: 'automation@soardcharity.com' }), /someone on the team/);
  await assert.rejects(doIt({ act: 'owner', key: 'c:ct_jane', email: 'someone@example.com' }), /someone on the team/);
  await doIt({ act: 'owner', key: 'c:ct_jane', email: '' });
  page = await C.personView(env, 'ct_jane', { now: START + 5 * HOUR });
  assert.equal(page.owner, null);
  assert.deepEqual(page.history.map((h) => h.what), ['No one looks after them now', 'Looked after by Alex Rivera']);
});

test('an owner who left the team still shows, so their donors can be given to someone else', async () => {
  await note(pay({ id: 'c2', amount: 5000 }));
  await doIt({ act: 'owner', key: 'c:ct_jane', email: 'alex@soardcharity.com' });
  await db.prepare("UPDATE staff_state SET data = ? WHERE key = 'directory'").bind(JSON.stringify({ ok: true, accounts: [{ email: 'jordan@soardcharity.com', aliases: [], name: 'Jordan Hale', active: true }] })).run();
  const page = await C.personView(env, 'ct_jane', { now: START + 4 * HOUR });
  assert.equal(page.owner, 'alex@soardcharity.com');
  assert.deepEqual(page.staff.find((s) => s.email === 'alex@soardcharity.com'), { email: 'alex@soardcharity.com', name: 'alex', left: true });
});

test('one person, one owner: joined records keep the latest said; their notes are all on the person’s page', async () => {
  await note(pay({ id: 'j1', amount: 5000 }));
  await note(pay({ id: 'j2', amount: 5000, contact: 'ct_jane2', email: 'jane.doe@example.com' }));
  await doIt({ act: 'owner', key: 'c:ct_jane2', email: 'jordan@soardcharity.com' }, START + 3 * HOUR);
  await doIt({ act: 'note-add', key: 'c:ct_jane2', body: 'Met at the gala' }, START + 3 * HOUR);
  await doIt({ act: 'note-add', key: 'c:ct_jane', body: 'Prefers a call' }, START + 4 * HOUR);
  await doIt({ act: 'same', a: 'c:ct_jane', b: 'c:ct_jane2', same: true }, START + 5 * HOUR);
  const page = await C.personView(env, 'ct_jane', { now: START + 6 * HOUR });
  assert.equal(page.owner, 'jordan@soardcharity.com');
  assert.deepEqual(page.notes.map((x) => x.body), ['Prefers a call', 'Met at the gala']);
  await doIt({ act: 'owner', key: 'c:ct_jane', email: 'alex@soardcharity.com' }, START + 7 * HOUR);
  assert.equal((await C.personView(env, 'ct_jane', { now: START + 8 * HOUR })).owner, 'alex@soardcharity.com', 'one owner now, not two');
  const owners = (await db.prepare("SELECT subject FROM donor_calls WHERE kind = 'owner'").all()).results;
  assert.equal(owners.length, 1);
});

test('notes: added, changed (who and when kept), deleted; an empty note isn’t saved; History says so without the words', async () => {
  await note(pay({ id: 'n1', amount: 5000 }));
  const { id } = await doIt({ act: 'note-add', key: 'c:ct_jane', body: '  Called to say thanks.\r\nShe loved the reveal. ' });
  let page = await C.personView(env, 'ct_jane', { now: START + 4 * HOUR });
  assert.equal(page.notes[0].body, 'Called to say thanks.\nShe loved the reveal.');
  assert.equal(page.notes[0].by, by);
  await assert.rejects(doIt({ act: 'note-add', key: 'c:ct_jane', body: '   ' }), /Write the note/);
  await C.act(env, { act: 'note-edit', id, body: 'Called. She loved the reveal.' }, 'jordan@soardcharity.com', { now: START + 5 * HOUR });
  page = await C.personView(env, 'ct_jane', { now: START + 6 * HOUR });
  assert.equal(page.notes[0].body, 'Called. She loved the reveal.');
  assert.equal(page.notes[0].editedBy, 'jordan@soardcharity.com');
  assert.ok(!page.history.some((h) => /reveal/i.test(h.what)), 'a note’s words stay on the page, not in History');
  await doIt({ act: 'note-delete', id });
  assert.equal((await C.personView(env, 'ct_jane', { now: START + 7 * HOUR })).notes.length, 0);
  await assert.rejects(doIt({ act: 'note-delete', id }), /isn’t here any more/);
});

test('an organization’s notes and owner go with it to the website, and go when it’s taken out', async () => {
  await note(pay({ id: 'o1', amount: 5000, company: 'Bright Futures LLC', contact: 'ct_bf', first: 'Kim', last: 'Ng', email: 'kim@example.com' }));
  const { key } = await doIt({ act: 'org-new', name: 'Bright Futures', links: [{ kind: 'company', subject: 'Bright Futures LLC' }] });
  await doIt({ act: 'note-add', key, body: 'Board member’s company' });
  await doIt({ act: 'owner', key, email: 'jordan@soardcharity.com' });
  await db.prepare(partner('bright-futures', 'Bright Futures')).run();
  await doIt({ act: 'website', key, slug: 'bright-futures' });
  const page = await C.orgView(env, 'p:bright-futures', { now: START + 5 * HOUR });
  assert.deepEqual(page.notes.map((x) => x.body), ['Board member’s company']);
  assert.equal(page.owner, 'jordan@soardcharity.com');
  // A private one taken out: its notes go with it
  const { key: k2 } = await doIt({ act: 'org-new', name: 'Small Co' });
  await doIt({ act: 'note-add', key: k2, body: 'x' });
  await doIt({ act: 'org-delete', key: k2 });
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM donor_notes WHERE subject = ?').bind(k2).first()).n), 0);
});

test('a record split off a person: the notes and owner stay with the person', async () => {
  await note(pay({ id: 's1', amount: 5000 }));
  await note(pay({ id: 's2', amount: 5000, contact: 'ct_other', first: 'Jane', last: 'Doe', email: 'other@example.com' }));
  await doIt({ act: 'same', a: 'c:ct_jane', b: 'c:ct_other', same: true });
  const lead = (await C.loadCrm(db)).canon('c:ct_other');
  await doIt({ act: 'note-add', key: lead, body: 'Keep' });
  await doIt({ act: 'owner', key: lead, email: 'alex@soardcharity.com' });
  const r = await doIt({ act: 'split', key: lead });
  const page = await C.personView(env, r.ref, { now: START + 5 * HOUR });
  assert.deepEqual(page.notes.map((x) => x.body), ['Keep']);
  assert.equal(page.owner, 'alex@soardcharity.com');
});

// ─── Elsewhere ──────────────────────────────────────────────────────

test('the Slack “Major gift” post opens the gift in Donors; smaller gifts and the self-test have no button', () => {
  const button = (card) => card.blocks.find((b) => b.type === 'actions')?.elements?.[0];
  const big = giftMessage(pay({ id: 'pay_big_1', amount: 250000 }));
  assert.equal(button(big).url, 'https://sunshineonaranneyday.com/admin/#donors/gift/pay_big_1');
  assert.equal(button(big).text.text, 'Open in Donors');
  assert.equal(button(giftMessage(pay({ id: 'pay_small_1', amount: 5000 }))), undefined);
  assert.equal(button(giftMessage({ ...pay({ id: 'pay_test_1', amount: 250000 }), metadata: { soardSelfTest: true } })), undefined);
});

test('a gift the list hasn’t got yet (a Slack link opened at once) is read from Zeffy and opens its donor', async () => {
  env.ZEFFY_API_KEY = 'zk_test';
  const p = pay({ id: 'pay_fresh_1', amount: 250000, contact: 'ct_new', first: 'Nia', last: 'Bell', email: 'nia@example.com' });
  const o = await C.giftOwner(env, 'pay_fresh_1', { now: START + HOUR, fetchImpl: async () => new Response(JSON.stringify(p), { status: 200 }) });
  assert.deepEqual(o, { ref: 'ct_new' });
  assert.deepEqual((await todo()).map((x) => x.id), ['pay_fresh_1'], 'and it’s To thank');
  const none = await C.giftOwner(env, 'pay_nothing_1', { now: START + HOUR, fetchImpl: async () => new Response('{}', { status: 404 }) });
  assert.equal(none, null);
});

test('what the team says about donors never waits for Publish', () => {
  assert.ok(RUNTIME_TYPES.includes('donor-crm'));
});

test('the run that finishes the first whole read: everything it read is history, not new (no flood of old checks on day one)', async () => {
  const done = START + HOUR;
  await D.noteDonorPayment(env, pay({ id: 'hist_chk', method: 'cheque', created: S(START - 400 * DAY), amount: 90000 }), { now: done, thanks: false });
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('donors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ filledAt: new Date(done).toISOString() })).run();
  await T.syncThanks(env, { now: done });
  await T.syncThanks(env, { now: done + MIN });
  assert.equal((await todo()).length, 0);
});

// ─── Found in review, Nov 12 ────────────────────────────────────────

const rows = async () => (await db.prepare('SELECT id, ids, state, why, cents, gone FROM donor_thanks ORDER BY at').all()).results;

test('one charge of a joined gift refunded: the rest is still To thank, and Thanked works on it', async () => {
  await note(pay({ id: 'sa', amount: 500000, created: S(START + HOUR) }));
  await note(pay({ id: 'sb', amount: 100000, created: S(START + HOUR + 10 * MIN) }));
  assert.deepEqual((await todo()).map((x) => [x.id, x.cents]), [['sa', 600000]]);
  await note(pay({ id: 'sb', amount: 100000, created: S(START + HOUR + 10 * MIN), refund: 'full', refunds: [{ status: 'succeeded', amount: 100000 }] }), START + 5 * HOUR);
  assert.deepEqual((await todo()).map((x) => [x.ids, x.cents]), [['sa', 500000]], 'the $5,000 given');
  // Paid twice by mistake, the first charge refunded: its row is the gift's first charge, and still says
  await note(pay({ id: 'd1', amount: 150000, created: S(START + 6 * HOUR), contact: 'ct_d', email: 'd@example.com', first: 'Dee' }), START + 6 * HOUR);
  await note(pay({ id: 'd2', amount: 150000, created: S(START + 6 * HOUR + 3 * MIN), contact: 'ct_d', email: 'd@example.com', first: 'Dee' }), START + 6 * HOUR + 5 * MIN);
  await note(pay({ id: 'd1', amount: 150000, created: S(START + 6 * HOUR), contact: 'ct_d', email: 'd@example.com', first: 'Dee', refund: 'full', refunds: [{ status: 'succeeded', amount: 150000 }] }), START + 7 * HOUR);
  const d = (await todo()).find((x) => x.id === 'd1');
  assert.deepEqual([d.ids, d.cents], ['d2', 150000]);
  await doIt({ act: 'thanks', id: 'd1', state: 'thanked' }, START + 8 * HOUR);
  assert.equal((await row('d1')).state, 'thanked', 'by its own id, though that charge was refunded');
  // Every charge refunded: nothing was given, it closes
  await note(pay({ id: 'sa', amount: 500000, created: S(START + HOUR), refund: 'full', refunds: [{ status: 'succeeded', amount: 500000 }] }), START + 9 * HOUR);
  assert.deepEqual([(await row('sa')).state, (await row('sa')).gone], ['gone', 'refunded']);
});

test('a check joined to a card charge (one giver, one campaign, one hour) is To thank as a check', async () => {
  await note(pay({ id: 'card1', amount: 10000, created: S(START + HOUR) }));
  await note(pay({ id: 'chk1', amount: 30000, method: 'cheque', type: 'manual', created: S(START + HOUR + 20 * MIN) }));
  assert.deepEqual((await todo()).map((x) => [x.why, x.cents]), [['check', 40000]]);
});

test('a monthly gift Zeffy knows by nothing but a name: its first time only; by nothing at all: never', async () => {
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('donors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ filledAt: new Date(START + HOUR).toISOString() })).run();
  await T.syncThanks(env, { now: START + HOUR + MIN });
  await note(pay({ id: 'mo1', amount: 150000, every: 'monthly', contact: null, email: '', created: S(START + 2 * HOUR) }), START + 2 * HOUR);
  await note(pay({ id: 'mo2', amount: 150000, every: 'monthly', contact: null, email: '', created: S(START + 32 * DAY) }), START + 32 * DAY);
  assert.deepEqual((await todo()).map((x) => x.id), ['mo1']);
  await note(pay({ id: 'mx1', amount: 150000, every: 'monthly', contact: null, email: '', first: '', last: '', created: S(START + 33 * DAY) }), START + 33 * DAY);
  assert.deepEqual((await todo()).map((x) => x.id), ['mo1'], 'known by nothing, it could come back every month');
});

test('two thank-yous for one gift (runs that overlapped) become one; one run at a time from then on', async () => {
  await note(pay({ id: 'xb', amount: 500000, created: S(START + HOUR + 10 * MIN) }));
  await D.noteDonorPayment(env, pay({ id: 'xa', amount: 500000, created: S(START + HOUR) }), { now: START + 2 * HOUR, thanks: false });
  const xb = await row('xb');
  await db.prepare("DELETE FROM donor_thanks WHERE id = 'xb'").run();
  await T.syncThanks(env, { now: START + 2 * HOUR, ask: false });
  await db.prepare('INSERT INTO donor_thanks (id, ids, state, why, at, cents, in_kind, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(xb.id, xb.ids, xb.state, xb.why, xb.at, xb.cents, xb.in_kind, xb.name, xb.created_at).run();
  await T.syncThanks(env, { now: START + 3 * HOUR, ask: false });
  assert.deepEqual((await todo()).map((x) => [x.ids, x.cents]), [['xa xb', 1000000]]);
  // A run going: another starting now leaves it to that one
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('thanks-turn', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(new Date(START + 4 * HOUR).toISOString()).run();
  assert.deepEqual(await T.syncThanks(env, { now: START + 4 * HOUR + MIN, ask: false }), { busy: true });
  assert.notDeepEqual(await T.syncThanks(env, { now: START + 4 * HOUR + 5 * MIN, ask: false }), { busy: true }, 'a turn that died lets go');
});

test('said in another tab since: Thanked or Undo changes nothing and says who', async () => {
  await note(pay({ id: 'tt', amount: 30000, method: 'cheque', type: 'manual' }));
  await doIt({ act: 'thanks', id: 'tt', state: 'thanked', was: 'todo' });
  await assert.rejects(doIt({ act: 'thanks', id: 'tt', state: 'skipped', was: 'todo' }), (e) => e.status === 409 && /Thanked, said by alex/.test(e.message));
  assert.equal((await row('tt')).state, 'thanked');
  // B says Not needed after reloading; A's Undo of "Thanked" no longer undoes anything
  await C.act(env, { act: 'thanks', id: 'tt', state: 'skipped', was: 'thanked' }, 'jordan@soardcharity.com', { now: START + 4 * HOUR });
  await assert.rejects(doIt({ act: 'thanks', id: 'tt', state: 'todo', was: 'thanked' }), (e) => e.status === 409);
  assert.equal((await row('tt')).state, 'skipped');
});

test('To thank: the one waiting longest first (since it came in), named as the list names them', async () => {
  await note(pay({ id: 'w1', amount: 30000, method: 'cheque', type: 'manual', created: S(START + HOUR) }), START + 2 * HOUR);
  // A check dated before it, typed in later
  await note(pay({ id: 'w2', amount: 30000, method: 'cheque', type: 'manual', created: S(START + 10 * MIN), contact: 'ct_n', email: 'nobody.named@example.com', first: '', last: '' }), START + 3 * HOUR);
  assert.deepEqual((await T.thanksToDo(db)).map((x) => [x.id, x.name]), [['w1', 'Jane Doe'], ['w2', 'nobody.named@example.com']]);
});

// ─── Found in the second review: a thank-you covers the charges it was said for ───

test('a check that joins a gift already said Not needed is To thank on its own; a $50 card charge that joins isn’t', async () => {
  await note(pay({ id: 'c1', amount: 150000, created: S(START + HOUR) }));
  await doIt({ act: 'thanks', id: 'c1', state: 'skipped' });
  await note(pay({ id: 'k1', amount: 500000, method: 'cheque', type: 'manual', created: S(START + HOUR + 30 * MIN) }), START + 2 * DAY);
  await note(pay({ id: 'k2', amount: 5000, created: S(START + HOUR + 40 * MIN) }), START + 2 * DAY);
  assert.deepEqual((await todo()).map((x) => [x.ids, x.why, x.cents]), [['k1 k2', 'check', 505000]], 'the part not said: the check (and the card charge with it)');
  assert.deepEqual([(await row('c1')).ids, (await row('c1')).state], ['c1', 'skipped'], 'what was said stays as it was');
  // On the donor's page the gift shows what's still to do
  const page = await C.personView(env, 'ct_jane', { now: START + 2 * DAY });
  assert.equal(page.gifts.find((g) => (g.ids || [g.id]).includes('k1'))?.thanks?.state, 'todo');
});

test('a charge dated between a thanked gift and a To thank one joins all three: the To thank stays, with the new charge', async () => {
  await note(pay({ id: 'ga', amount: 150000, created: S(START + HOUR) }));
  await note(pay({ id: 'gb', amount: 200000, created: S(START + HOUR + 100 * MIN) }));
  await doIt({ act: 'thanks', id: 'ga', state: 'thanked' });
  await note(pay({ id: 'gm', amount: 5000, method: 'cheque', type: 'manual', created: S(START + HOUR + 50 * MIN) }), START + 4 * HOUR);
  assert.deepEqual((await todo()).map((x) => [x.id, x.ids.split(' ').sort().join(' '), x.why]), [['gb', 'gb gm', 'check']]);
  assert.equal((await row('ga')).ids, 'ga');
});

test('a To thank whose one charge Zeffy no longer lists and whose other was refunded in full: Zeffy is asked, and it closes', async () => {
  await note(pay({ id: 'za', amount: 500000, created: S(START + HOUR) }));
  await note(pay({ id: 'zb', amount: 100000, created: S(START + HOUR + 10 * MIN) }));
  await db.prepare("DELETE FROM donor_payments WHERE id = 'za'").run();
  await note(pay({ id: 'zb', amount: 100000, created: S(START + HOUR + 10 * MIN), refund: 'full', refunds: [{ status: 'succeeded', amount: 100000 }] }), START + 3 * HOUR);
  const asked = [];
  const fetchImpl = async (url) => { asked.push(String(url)); return Response.json({ error: 'not found' }, { status: 404 }); };
  const zenv = { ...env, ZEFFY_API_KEY: 'z' };
  await T.syncThanks(zenv, { now: START + 4 * HOUR, fetchImpl });
  await T.syncThanks(zenv, { now: START + 11 * HOUR, fetchImpl });
  assert.ok(asked.length === 2 && asked.every((u) => u.includes('/payments/za')), 'asked about the charge it no longer lists');
  assert.deepEqual([(await row('za')).state, (await row('za')).gone], ['gone', 'deleted']);
});

test('a thank-you said is never rewritten by later runs; a gift in kind with no value is still To thank; a yearly gift each year', async () => {
  await note(pay({ id: 'tr', amount: 150000, created: S(START + HOUR) }));
  await note(pay({ id: 'tr2', amount: 10000, created: S(START + HOUR + 5 * MIN), refund: 'full', refunds: [{ status: 'succeeded', amount: 10000 }] }));
  await doIt({ act: 'thanks', id: 'tr', state: 'thanked' });
  const before = await row('tr');
  for (let i = 0; i < 3; i++) await T.syncThanks(env, { now: START + (5 + i) * HOUR, ask: false });
  assert.deepEqual(await row('tr'), before);
  await note(pay({ id: 'k0', amount: 0, method: 'in_kind', items: [{ type: 'donation', amount: 0 }], contact: 'ct_k', first: 'Kay', email: 'kay@example.com' }), START + 8 * HOUR);
  assert.equal((await row('k0'))?.why, 'kind');
  await db.prepare("INSERT INTO donor_state (key, value) VALUES ('donors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ filledAt: new Date(START + 9 * HOUR).toISOString() })).run();
  await T.syncThanks(env, { now: START + 9 * HOUR + MIN, ask: false });
  await note(pay({ id: 'y1', amount: 500000, every: 'yearly', sub: 'sub_y', contact: 'ct_y', email: 'y@example.com', created: S(START + 10 * HOUR) }), START + 10 * HOUR);
  await doIt({ act: 'thanks', id: 'y1', state: 'thanked' }, START + 11 * HOUR);
  await note(pay({ id: 'y2', amount: 500000, every: 'yearly', sub: 'sub_y', contact: 'ct_y', email: 'y@example.com', created: S(START + 366 * DAY) }), START + 366 * DAY);
  assert.equal((await row('y2'))?.state, 'todo', 'the next year’s gift is thanked too');
});
