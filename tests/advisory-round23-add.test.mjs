/**
 * Advisory Board QA round 23 (Nov 23 2026), the admin tester's findings about Add to Advisory Board, on the server:
 *   2  Add stopped partway: once a press has written anything (their People record, the application's link, their email,
 *      their welcome's record), whatever stops it is "Adding them stopped partway … Press Add to Advisory Board again in a
 *      moment: it finishes what’s left, and never adds them twice", a read of People that fails included (it had said "We
 *      couldn’t check People just now, so nothing was changed" beside a box showing them on People). Before anything is
 *      written, a read of People failing keeps those words. Every statement of the press failed in turn, someone new and
 *      the same person
 *   3  a couple with letters after a comma ("Jordan Cplabx, MD & Amy Cplabx, PhD", "…, MD & Amy", "…, MD and Amy …",
 *      "…, Jr. & Amy …"): Add asks whether it's Amy Cplabx, who is on People, as it does without the commas; the first
 *      one's reading and the address a new record takes stay round 22's (jordan-cplabx)
 *   4  what the box says about advisory@ rests on the Advisory Board's emails switch for a test application too, so the
 *      box's key has the switch in it (a press after the switch changed is asked to look again)
 * Minor 1 (a renewal's date) is in tests/advisory-round23.test.mjs; minor 4's words in the page, in
 * scripts/test-advisory-round23.mjs.
 * Made-up people only (the repo is public); Resend, Cloudflare Access and Images are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round23-add.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import * as adminApi from '../functions/api/advisory-applications-admin.js';
import { readDown, PEOPLE_DOWN, readState, writeState } from '../functions/api/_board-roles.js';

const BASE = {
  phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
  introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes',
  refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true,
};
let SHOT;
before(async () => {
  const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
  SHOT = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
});

// Resend, Access and Images, faked (Resend keeps an Idempotency-Key, as the real one does)
const resend = { delivered: [], keys: new Map() };
const access = { groups: [], policies: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') {
    const key = init.headers?.['Idempotency-Key'] || '';
    if (key && resend.keys.has(key)) { const had = resend.keys.get(key); return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }); }
    const list = [JSON.parse(init.body)].flat();
    resend.delivered.push(...list);
    const res = { data: list.map((_, i) => ({ id: `em_${resend.delivered.length}_${i}` })) };
    if (key) resend.keys.set(key, { body: init.body, res });
    return Response.json(res);
  }
  if (url.host === 'api.cloudflare.com' && url.pathname.includes('/images/v1')) {
    if (init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } }); }
    return Response.json({ success: true, result: {} });
  }
  if (url.host === 'api.cloudflare.com' && url.pathname.startsWith('/client/v4/accounts/acct/access/')) {
    const method = init.method || 'GET';
    const path = url.pathname.replace('/client/v4/accounts/acct', '');
    const ok = (result) => Response.json({ success: true, result });
    if (path === '/access/groups' && method === 'GET') return ok(access.groups);
    if (path === '/access/groups' && method === 'POST') { const g = { id: 'g1', ...JSON.parse(init.body) }; access.groups.push(g); return ok(g); }
    if (path === '/access/groups/g1' && method === 'GET') return ok(access.groups[0]);
    if (path === '/access/groups/g1' && method === 'PUT') { Object.assign(access.groups[0], JSON.parse(init.body)); return ok(access.groups[0]); }
    if (path === '/access/policies' && method === 'GET') return ok(access.policies);
    if (path === '/access/policies' && method === 'POST') { const p = { id: 'p1', ...JSON.parse(init.body) }; access.policies.push(p); return ok(p); }
    if (path === '/access/apps' && method === 'GET') return ok([{ aud: 'aud-admin', name: 'SOARD admin', policies: access.policies.map((p) => ({ id: p.id })) }]);
  }
  throw new Error(`no route for ${url.href}`);
};
after(() => { globalThis.fetch = realFetch; });

/**
 * The database as the press meets it, its k-th statement not answering (a batch is one, as D1 runs it): with D1's own
 * error, or `as` one (a read of People's readDown, say). k 0: nothing fails, the statements counted
 */
function failingAt(DB, k, as = () => new Error('D1_ERROR: the database didn’t answer')) {
  const state = { n: 0, hit: false, sql: '' };
  const gate = (sql) => { state.n += 1; if (state.n === k) { state.hit = true; state.sql = sql; throw as(); } };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: async (c) => { gate(st._sql); return st.first(c); }, all: async () => { gate(st._sql); return st.all(); }, run: async () => { gate(st._sql); return st.run(); } });
  return { DB: { ...DB, prepare: (sql) => wrap(DB.prepare(sql)), batch: async (s) => { gate(`[batch] ${s[0]?._sql}`); return DB.batch(s); } }, state };
}

/** A database of its own: People's tables, the Advisory Board's emails on, and the people given */
async function world(people = []) {
  // (a site of its own: Resend has none of its keys yet, and its sign-in list is empty)
  resend.keys.clear();
  access.groups.length = 0;
  access.policies.length = 0;
  const DB = await createD1();
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const p of people) {
    await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(p.slug, p.name, 'advisory', JSON.stringify({ slug: p.slug, name: p.name, group: 'advisory', status: 'active', publishStatus: 'published' })).run();
    if (p.email) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(p.slug, p.email).run();
  }
  await writeState(DB, 'advisory', { emails: true });
  return { DB, CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', RESEND_API_KEY: 'r', CF_ACCESS_API_TOKEN: 'access-token', CF_ACCESS_AUD: 'aud-admin' };
}
const applied = async (env, fullName, email) => (await submitApplication(env, { ...BASE, fullName, email, signature: fullName }, { headshot: SHOT })).app;
const ctx = (env, method, body, query = '') => ({
  env,
  request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
  data: { userEmail: 'linzi@soardcharity.com' },
  waitUntil: () => {},
});
const plan = async (env, id) => (await (await adminApi.onRequestGet(ctx(env, 'GET', undefined, `?plan=${id}`))).json()).plan;
/** Add pressed as the box offers it (the plan read first, as the box is opened), the database as `DB` has it */
const press = async (env, id, DB = env.DB) => {
  const p = await plan(env, id);
  const res = await adminApi.onRequestPost(ctx({ ...env, DB }, 'POST', { add: { id, as: p.kind === 'new' ? 'new' : 'same', seen: p.key } }));
  return { status: res.status, ...(await res.json()) };
};
const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };

// ─── 2: Add stopped partway ───────────────────

const PARTWAY = /^Adding them stopped partway: [^.]+\. Press Add to Advisory Board again in a moment: it finishes what’s left, and never adds them twice\.$/;
// (their email alone not saving, for a reason of its own: said as that, beside their being added)
const EMAIL_LEFT = /^\S.* is on the Advisory Board, but their email didn’t save: /;
const NOT_DONE = /nothing was changed|nobody was added|nothing was saved/;

const KINDS = {
  'someone new': { people: [], name: 'Addy Faultnew', email: 'addy.new@example.org', slug: 'addy-faultnew' },
  'the same person (on People → Advisory with this email, no photo)': { people: [{ slug: 'addy-faultsame', name: 'Addy Faultsame', email: 'addy.same@example.org' }], name: 'Addy Faultsame', email: 'addy.same@example.org', slug: 'addy-faultsame' },
};
/** What a press has written that people can see: their People record (made, or their photo), the link, their email, their welcome's record */
async function written(env, kind, appId) {
  const k = KINDS[kind];
  const row = await env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind(k.slug).first();
  const record = k.people.length ? !!JSON.parse(row?.data || '{}').photo : !!row;
  const linked = !!(await env.DB.prepare('SELECT person_slug FROM advisory_applications WHERE id = ?').bind(appId).first())?.person_slug;
  const email = !k.people.length && !!(await env.DB.prepare('SELECT 1 AS y FROM reveal_board_emails WHERE slug = ?').bind(k.slug).first());
  const log = await readState(env.DB, 'advisory-mail');
  const welcome = !!(log.waiting?.[k.slug] || (log.names && k.slug in log.names));
  return record || linked || email || welcome ? { record, linked, email, welcome } : null;
}
for (const kind of Object.keys(KINDS)) {
  test(`2: Add (${kind}) with each statement of the press failing in turn: once anything is written, "stopped partway" (a read of People that fails too), never "nothing was changed"; before that, never "stopped partway"; and pressing again finishes it, once`, async (t) => {
    const k = KINDS[kind];
    const ref = await world(k.people);
    const app0 = await applied(ref, k.name, k.email);
    const count = failingAt(ref.DB, 0);
    const done = await quietly(() => press(ref, app0.id, count.DB));
    assert.equal(done.status, 200, done.error);
    const n = count.state.n;
    assert.ok(n > 40, `${n} statements`);
    let partway = 0;
    let readsAfter = 0;
    for (let i = 1; i <= n; i++) {
      const env = await world(k.people);
      const app = await applied(env, k.name, k.email);
      const p = await plan(env, app.id);
      const f = failingAt(env.DB, i);
      const res = await adminApi.onRequestPost(ctx({ ...env, DB: f.DB }, 'POST', { add: { id: app.id, as: p.kind === 'new' ? 'new' : 'same', seen: p.key } }));
      const r = { status: res.status, ...(await quietly(() => res.json())) };
      if (!f.state.hit) continue;
      const at = `failing at ${i} of ${n} (${f.state.sql.slice(0, 70)})`;
      const w = await written(env, kind, app.id);
      if (r.status !== 200) {
        assert.doesNotMatch(r.error, /D1_ERROR|SQLITE/, at);
        if (w) {
          assert.ok(PARTWAY.test(r.error) || EMAIL_LEFT.test(r.error), `${at}: ${JSON.stringify(w)} written, and the press said: ${r.status} ${r.error}`);
          assert.doesNotMatch(r.error, NOT_DONE, at);
          if (PARTWAY.test(r.error)) { partway += 1; assert.equal(r.status, 503, at); }
          if (/check People/.test(r.error)) readsAfter += 1;
        } else {
          assert.doesNotMatch(r.error, /stopped partway/, `${at}: nothing written, and the press said: ${r.error}`);
        }
        if (r.error === PEOPLE_DOWN) assert.ok(!w && r.status === 503, at);
        // (pressed again, as the words say: it finishes, one People record and Joined)
        const again = await quietly(() => press(env, app.id));
        assert.equal(again.status, 200, `${at}, pressed again: ${again.error}`);
      }
      const slugs = ((await env.DB.prepare('SELECT slug FROM team WHERE slug LIKE ?').bind(`${k.slug}%`).all()).results || []).map((x) => x.slug);
      assert.deepEqual(slugs, [k.slug], `${at}: one People record`);
      assert.equal((await env.DB.prepare('SELECT status FROM advisory_applications WHERE id = ?').bind(app.id).first()).status, 'joined', at);
    }
    t.diagnostic(`${n} statements, each failed in turn: ${partway} said stopped partway (503), ${readsAfter} of them a read of People after a write`);
    assert.ok(partway > 3, `${partway} said stopped partway`);
    // (the reads of People after a write: their email's (setBoardEmail) for someone new, every private email's
    // (queueWelcome) for both)
    assert.ok(readsAfter >= (k.people.length ? 1 : 2), `${readsAfter} reads of People failing after a write said so, partway`);
  });
}

test('2: a read of People that fails before anything is written keeps its own words, 503 and nothing changed; the same failure once the record and the link are written is "stopped partway", 503, and the next press finishes it', async () => {
  const k = KINDS['someone new'];
  const unread = () => readDown(PEOPLE_DOWN, new Error('D1_ERROR: the database didn’t answer'));
  // (the statements a press makes, in order, from a press that goes all the way)
  const ref = await world();
  const app0 = await applied(ref, k.name, k.email);
  const trace = [];
  const plain0 = ref.DB.prepare;
  await press(ref, app0.id, { ...ref.DB, prepare: (sql) => { trace.push(sql); return plain0(sql); } });
  const linkAt = trace.indexOf('UPDATE advisory_applications SET person_slug = ?, updated_at = ? WHERE id = ?');
  assert.ok(linkAt > 0, 'the press links the application');
  /** Which of the press's statements with this SQL is the first after `from` (1 = its first) */
  const nthAfter = (sql, from) => trace.slice(0, trace.indexOf(sql, from) + 1).filter((x) => x === sql).length;
  /** The press, the nth statement with this SQL failing as a read of People does (readDown) */
  const pressFailing = async (sql, nth) => {
    const env = await world();
    const app = await applied(env, k.name, k.email);
    const p = await plan(env, app.id);
    let seen = 0;
    const plain = env.DB.prepare;
    const DB = { ...env.DB, prepare: (x) => {
      const st = plain(x);
      if (x !== sql) return st;
      const mine = ++seen;
      const wrap = (y) => ({ ...y, bind: (...a) => wrap(y.bind(...a)), first: async (c) => { if (mine === nth) throw unread(); return y.first(c); }, all: async () => { if (mine === nth) throw unread(); return y.all(); }, run: async () => { if (mine === nth) throw unread(); return y.run(); } });
      return wrap(st);
    } };
    const res = await quietly(() => adminApi.onRequestPost(ctx({ ...env, DB }, 'POST', { add: { id: app.id, as: p.kind === 'new' ? 'new' : 'same', seen: p.key } })));
    return { env, app, r: { status: res.status, ...(await res.json()) }, hit: seen >= nth };
  };
  // Before anything is written: the press's first read of People (its plan's)
  {
    const { env, app, r, hit } = await pressFailing('SELECT slug, data FROM team', 1);
    assert.ok(hit);
    assert.deepEqual([r.status, r.error], [503, PEOPLE_DOWN], 'before anything is written');
    assert.equal(await written(env, 'someone new', app.id), null, 'nothing written');
  }
  // Once the record and the link are written: their email's read (setBoardEmail) and every private email's (queueWelcome)
  for (const [label, sql] of [['their email’s read, once the record is made and linked', 'SELECT email FROM reveal_board_emails WHERE slug = ?'], ['every private email’s read, before their welcome is written down', 'SELECT slug, email FROM reveal_board_emails']]) {
    const nth = nthAfter(sql, linkAt);
    assert.ok(nth > 0, `${label}: the press makes it`);
    // (setBoardEmail's own, after the press's look at whether they have one: the second after the link)
    const { env, app, r, hit } = await pressFailing(sql, sql.endsWith('slug = ?') ? nth + 1 : nth);
    assert.ok(hit, label);
    assert.deepEqual([r.status, r.error], [503, 'Adding them stopped partway: we couldn’t check People just now. Press Add to Advisory Board again in a moment: it finishes what’s left, and never adds them twice.'], label);
    const w = await written(env, 'someone new', app.id);
    assert.ok(w?.record && w.linked, `${label}: ${JSON.stringify(w)}`);
    // (what the box says next agrees with the words: link them, the same person; and a press finishes it, one welcome)
    assert.deepEqual([(await plan(env, app.id)).kind, (await plan(env, app.id)).why], ['same', 'linked'], label);
    const before = resend.delivered.length;
    const again = await press(env, app.id);
    assert.equal(again.status, 200, `${label}, pressed again: ${again.error}`);
    assert.equal(resend.delivered.slice(before).filter((m) => m.subject === 'Your Advisory Board page is ready').length, 1, `${label}: one welcome`);
    assert.equal((await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(k.slug).first())?.email, k.email, label);
  }
});

// ─── 3: a couple with letters after a comma ───────────────────

test('3: a couple with letters after the first one’s comma is read as a couple: the other one whole if typed whole, else with the first one’s family name; the first one and the address as round 22 has them', async () => {
  const { readName } = await import('../functions/api/_advisory-form.js');
  for (const [typed, partner] of [
    ['Jordan Cplabx, MD & Amy Cplabx, PhD', 'Amy Cplabx'], ['Jordan Cplabx, MD & Amy Cplabx', 'Amy Cplabx'], ['Jordan Cplabx, MD and Amy Cplabx', 'Amy Cplabx'],
    ['Jordan Cplabx, Jr. & Amy Cplabx', 'Amy Cplabx'], ['Jordan Cplabx, MD & Amy', 'Amy Cplabx'], ['Jordan Cplabx, MD and Amy', 'Amy Cplabx'], ['Jordan Cplabx, Jr. & Amy', 'Amy Cplabx'],
    // (a title, more letters, a generation, nothing at all between the comma and the "&"; their own title, letters, another comma)
    ['Jordan Cplabx, Dr. & Amy Cplabx', 'Amy Cplabx'], ['Jordan Cplabx, Dr. & Amy', 'Amy Cplabx'], ['Jordan Cplabx, MD, PhD & Amy Cplabx', 'Amy Cplabx'], ['Jordan Cplabx, M.D. & Amy Cplabx', 'Amy Cplabx'],
    ['Jordan Cplabx, Esq. and Amy Cplabx', 'Amy Cplabx'], ['Jordan Cplabx, III & Amy', 'Amy Cplabx'], ['Jordan Cplabx, & Amy Cplabx', 'Amy Cplabx'], ['Jordan Cplabx, MD & Dr. Amy Cplabx', 'Amy Cplabx'],
    ['Jordan Cplabx, CPA & Amy Cplabx MD', 'Amy Cplabx'], ['Jordan Cplabx, MD & Amy, PhD', 'Amy Cplabx'], ['Jordan Cplabx, MD & Amy Cplabx, Atlanta', 'Amy Cplabx'], ['Jordan Cplabx, MD & Amy Lee', 'Amy Lee'],
    ['J. R. Cplabx, MD & Amy', 'Amy Cplabx'], ['Jordan De La Cruz, MD & Amy', 'Amy De La Cruz'], ['JORDAN CPLABX, MD & AMY CPLABX', 'AMY CPLABX'],
    // (a first name the list doesn't know: the same, never "MD Cplabx")
    ['Zed Cplabx, MD & Amy Cplabx', 'Amy Cplabx'],
    // (as without the commas)
    ['Jordan Cplabx MD & Amy Cplabx PhD', 'Amy Cplabx'],
    // nobody to match: no first name of theirs, words that aren't letters before the "&", a firm, a family
    ['Jordan Cplabx, MD & Mrs. Cplabx', null], ['Jordan Cplabx, Dr. & Mrs.', null], ['Jordan Cplabx, Atlanta & Amy Cplabx', null], ['Jordan Cplabx, Grace Church & Amy Cplabx', null],
    ['Jordan Cplabx, she/her & Amy Cplabx', null], ['Jordan Cplabx, MD & Associates', null], ['Jordan Cplabx, CPA & Co.', null], ['Jordan Cplabx, MD & family', null], ['Jordan Cplabx, MD and the Cplabx family', null],
  ]) {
    const r = readName(typed);
    assert.equal(r.partnerWhole?.join(' ') || null, partner, typed);
    // (the first one, the name kept and the address: the whole name before the comma, as typed, round 22's)
    if (!typed.startsWith('Jordan Cplabx MD')) {
      const head = typed.split(',')[0].split(' ');
      assert.deepEqual(r.words, head, `${typed}: the first one is the whole name before the comma`);
      assert.equal(r.shown, typed, typed);
      assert.equal(r.address, undefined, `${typed}: the address from the whole name before the comma`);
    }
  }
});

test('3: Add asks whether a comma couple is the one of them already on People → Advisory, as it does without the commas, and a new record keeps round 22’s address', async () => {
  let n = 0;
  for (const [typed, ask] of [
    ['Jordan F, MD & Amy F, PhD', 'Amy F'], ['Jordan F, MD & Amy F', 'Amy F'], ['Jordan F, MD and Amy F', 'Amy F'], ['Jordan F, Jr. & Amy F', 'Amy F'],
    ['Jordan F, MD & Amy', 'Amy F'], ['Jordan F, Dr. & Amy F', 'Amy F'],
    // (the control: without the commas, as before)
    ['Jordan F MD & Amy F PhD', 'Amy F'],
    // (the first one on People: asked about them, as before)
    ['Jordan F, MD & Amy F, PhD', 'Jordan F'],
  ]) {
    n += 1;
    const F = `Cpl${'abcdefghij'[n]}x`;
    const sub = (x) => x.replace(/\bF\b/g, F);
    const onPeople = sub(ask);
    const env = await world([{ slug: onPeople.toLowerCase().replace(/ /g, '-'), name: onPeople, email: `cp.${n}@example.org` }]);
    const app = await applied(env, sub(typed), `cq.${n}@example.org`);
    const p = await plan(env, app.id);
    assert.deepEqual([p.kind, p.person?.name], ['choose', onPeople], `${sub(typed)}: asks whether it’s ${onPeople}`);
    // (as someone new: the address from the whole name before the comma, the name as typed)
    assert.equal(p.slug, onPeople.startsWith('Jordan') ? `jordan-${F.toLowerCase()}-2` : `jordan-${F.toLowerCase()}`, sub(typed));
    assert.equal(p.asName, undefined, `${sub(typed)}: kept as typed`);
  }
  // Pressed "the same person": one People record, Amy's; never a second beside her
  const env = await world([{ slug: 'amy-cplzzx', name: 'Amy Cplzzx', email: 'amy.cplzzx@example.org' }]);
  const app = await applied(env, 'Jordan Cplzzx, MD & Amy Cplzzx, PhD', 'cq.z@example.org');
  const r = await press(env, app.id);
  assert.equal(r.status, 200, r.error);
  assert.equal(r.person.slug, 'amy-cplzzx');
  assert.deepEqual(((await env.DB.prepare("SELECT slug FROM team WHERE slug LIKE '%cplzzx%'").all()).results || []).map((x) => x.slug), ['amy-cplzzx']);
  // ...and no one on People: someone new at jordan-cplzzy, the name as typed
  const env2 = await world();
  const app2 = await applied(env2, 'Jordan Cplzzy, MD & Amy Cplzzy, PhD', 'cq.y@example.org');
  const r2 = await press(env2, app2.id);
  assert.deepEqual([r2.status, r2.person?.slug, r2.person?.name], [200, 'jordan-cplzzy', 'Jordan Cplzzy, MD & Amy Cplzzy, PhD']);
});

// ─── 4: the box's key, for what it says about advisory@ ───────────────────

test('4: a test application’s box says what advisory@ is by the emails switch, so its key has the switch in it, with no email to sign in with too', async () => {
  for (const [label, email] of [['with an email', 'test.taylor@example.org'], ['with a group inbox for an email (none to sign in with)', 'board@soardcharity.com']]) {
    const env = await world();
    const app = await applied(env, 'Test Taylor', email);
    const on = await plan(env, app.id);
    await writeState(env.DB, 'advisory', { emails: false });
    const off = await plan(env, app.id);
    assert.equal(on.kind, 'new', label);
    assert.notEqual(on.key, off.key, `${label}: the key changes with the switch`);
    // (a press from the box opened with them on is asked to look again, in words)
    const res = await adminApi.onRequestPost(ctx(env, 'POST', { add: { id: app.id, as: 'new', seen: on.key } }));
    const r = await res.json();
    assert.equal(r.error, 'Advisory Board emails were turned off since the box opened. Look at the box again before pressing: it says what’s emailed now.', label);
  }
  // (an application that isn't a test, with no email to sign in with: nothing in its box rests on the switch, as before)
  const env = await world();
  const app = await applied(env, 'Robin Quill', 'board@soardcharity.com');
  const on = await plan(env, app.id);
  await writeState(env.DB, 'advisory', { emails: false });
  assert.equal(on.key, (await plan(env, app.id)).key);
});
