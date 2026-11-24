/**
 * Advisory Board QA round 24 (Nov 23 2026), the admin tester's findings about Add to Advisory Board, on the server:
 *   1  a read that fails is a read failure everywhere it's thrown: setBoardEmail's "is this email someone else's?" check
 *      not answering, after Add has made their People record and linked the application, is "Adding them stopped
 *      partway … Press Add to Advisory Board again", 503 (it had been "is on the Advisory Board, but their email didn't
 *      save: The site couldn't check that email just now", 409). A refusal on the email's own merits keeps its words; the
 *      write itself not going is partway too, whatever the database's message looks like. And the Advisory Board's member
 *      writes: the check of whether the site keeps People's emails (ownRow) failing is a read failure, never kept as "no"
 *   2  a step's result comes from its own write, never a read after it: marking the application Joined answers with the
 *      row that write saved (RETURNING), so a press whose writes all landed answers done, never partway; and every
 *      statement of the press failing in turn, whenever the box afterwards has nothing left to press the press answered
 *      done. A status, a note and the Advisory Board's own "I know someone" and "host a fundraiser" the same
 *   4  family-first couples with a second comma ("Ffcabx, Jordan, MD & Amy", "…, Jr. & Amy", "…, & Amy"): the other one
 *      read as Amy Ffcabx, so Add asks whether it's the Amy on People; the address ffcabx-jordan; "Johnson & Johnson"
 *      and the like never a partner; the greeting the same as round 23's "Ffcabx, Jordan & Amy" (none: "Thank you.")
 * 3 (the Add box's words) and the page's half of 2 are in the page: scripts/test-advisory-round24.mjs. 5 (the word
 * "advisor") is tests/advisory-round24-words.test.mjs.
 * Made-up people only (the repo is public); Resend, Cloudflare Access and Images are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round24-add.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { readHeadshot, submitApplication, applicantEmail } from '../functions/api/_advisory-applications.js';
import * as adminApi from '../functions/api/advisory-applications-admin.js';
import { readState, writeState } from '../functions/api/_board-roles.js';
import { setBoardEmail } from '../functions/api/_reveal-invites.js';
import { readName, greetName } from '../functions/api/_advisory-form.js';
import { slugOf } from '../public/admin/team-shared.js';

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

const D1_DOWN = () => new Error('D1_ERROR: the database didn’t answer');
/**
 * The database as the press meets it, with `rule(sql, n)` saying for the n-th statement (a batch is one, as D1 runs it)
 * whether it fails: 'before' (D1's error, nothing done) or 'after' (it runs, then the error comes back, as a connection
 * lost after the database took it). Every statement is traced
 */
function faulty(DB, rule = () => null) {
  const state = { n: 0, hit: [], trace: [] };
  const gate = async (sql, run) => {
    state.n += 1;
    state.trace.push(sql);
    const how = rule(sql, state.n);
    if (how === 'before') { state.hit.push(sql); throw D1_DOWN(); }
    const out = await run();
    if (how === 'after') { state.hit.push(sql); throw D1_DOWN(); }
    return out;
  };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: (c) => gate(st._sql, () => st.first(c)), all: () => gate(st._sql, () => st.all()), run: () => gate(st._sql, () => st.run()) });
  return { DB: { ...DB, prepare: (sql) => wrap(DB.prepare(sql)), batch: (s) => gate(`[batch] ${s[0]?._sql}`, () => DB.batch(s)) }, state };
}
/** The k-th statement with exactly this SQL (1 = its first) fails, `how` */
const nth = (sql, k, how = 'before') => { let seen = 0; return (x) => (x === sql && ++seen === k ? how : null); };

/** A database of its own: People's tables, the Advisory Board's emails on, and the people given */
async function world(people = [], { emails = true } = {}) {
  resend.keys.clear();
  access.groups.length = 0;
  access.policies.length = 0;
  const DB = await createD1();
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const p of people) {
    await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(p.slug, p.name, p.group || 'advisory', JSON.stringify({ slug: p.slug, name: p.name, group: p.group || 'advisory', status: 'active', publishStatus: 'published' })).run();
    if (p.email) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(p.slug, p.email).run();
  }
  await writeState(DB, 'advisory', { emails });
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
const post = async (env, body) => { const res = await adminApi.onRequestPost(ctx(env, 'POST', body)); return { status: res.status, ...(await res.json()) }; };
/** Add pressed as the box offers it (the plan read first, as the box is opened), the database as `DB` has it */
const press = async (env, id, DB = env.DB, as = null) => {
  const p = await plan(env, id);
  return post({ ...env, DB }, { add: { id, as: as || (p.kind === 'new' ? 'new' : 'same'), seen: p.key } });
};
const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };
const welcomes = (to) => resend.delivered.filter((m) => m.subject === 'Your Advisory Board page is ready' && [m.to].flat().includes(to)).length;

const PARTWAY = (why) => `Adding them stopped partway: ${why}. Press Add to Advisory Board again in a moment: it finishes what’s left, and never adds them twice.`;
const CHECK = 'SELECT r.slug, t.data FROM reveal_board_emails r JOIN team t ON t.slug = r.slug WHERE lower(r.email) = ? AND r.slug != ? LIMIT 1';
const ORPHAN = 'SELECT slug FROM reveal_board_emails WHERE lower(email) = ? AND slug != ? AND slug NOT IN (SELECT slug FROM team) LIMIT 1';
const CHECK_DOWN = 'The site couldn’t check that email just now. Please try again in a moment.';

// ─── 1: a read that fails is a read failure ───────────────────

test('1: setBoardEmail: the check of whose an address is not answering throws a read failure (503, `unread`), its own part and the one for a row nobody has alike; a refusal on the address itself is a refusal (`refused`, 400)', async () => {
  const env = await world([{ slug: 'olive-owner', name: 'Olive Owner', email: 'olive@example.org' }, { slug: 'rae-reader', name: 'Rae Reader' }]);
  for (const sql of [CHECK, ORPHAN]) {
    const f = faulty(env.DB, nth(sql, 1));
    const e = await quietly(() => setBoardEmail(f.DB, 'rae-reader', 'rae@example.org').then(() => null, (x) => x));
    assert.ok(e, `${sql.slice(0, 40)}: it stopped`);
    assert.deepEqual([e.status, e.unread, e.message, !!e.refused], [503, true, CHECK_DOWN, false], `${sql.slice(0, 40)}: a read failure`);
    assert.equal((await env.DB.prepare("SELECT email FROM reveal_board_emails WHERE slug = 'rae-reader'").first()), null, 'nothing saved');
  }
  for (const [email, words] of [['olive@example.org', 'That email is already Olive Owner’s. Each person signs in to the board page with their own.'], ['rae@example', 'That email doesn’t look right.']]) {
    const e = await setBoardEmail(env.DB, 'rae-reader', email).then(() => null, (x) => x);
    assert.deepEqual([e?.status, e?.refused, e?.message, !!e?.unread], [400, true, words, false], email);
  }
});

for (const [kind, people] of [['someone new', []], ['the same person (on People → Advisory with no email, the box asking)', [{ slug: 'edna-checkfsame', name: 'Edna Checkfsame' }]]]) {
  test(`1: Add (${kind}): the email's check not answering once their People record and the link are written is "stopped partway", 503, and the next press finishes it, once; never "their email didn't save"`, async () => {
    for (const sql of [CHECK, ORPHAN]) {
      const name = people[0]?.name || 'Edna Checkfnew';
      const slug = people[0]?.slug || 'edna-checkfnew';
      const email = `edna.${people.length ? 's' : 'n'}.${sql === CHECK ? 'c' : 'o'}@example.org`;
      const env = await world(people);
      const app = await applied(env, name, email);
      const p = await plan(env, app.id);
      assert.equal(p.kind, people.length ? 'choose' : 'new');
      const f = faulty(env.DB, nth(sql, 1));
      const r = await quietly(() => post({ ...env, DB: f.DB }, { add: { id: app.id, as: people.length ? 'same' : 'new', seen: p.key } }));
      assert.equal(f.state.hit.length, 1, 'the check failed');
      assert.deepEqual([r.status, r.error, r.partway], [503, PARTWAY('we couldn’t check People just now'), true], sql.slice(0, 40));
      assert.equal((await env.DB.prepare('SELECT person_slug FROM advisory_applications WHERE id = ?').bind(app.id).first()).person_slug, slug, 'linked');
      // (what the box offers next is the press the words name: Link them)
      assert.deepEqual([(await plan(env, app.id)).kind, (await plan(env, app.id)).why], ['same', 'linked']);
      const again = await press(env, app.id);
      assert.equal(again.status, 200, again.error);
      assert.equal((await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(slug).first())?.email, email);
      assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'edna-%'").first()).n, 1, 'one People record');
      assert.equal(welcomes(email), 1, 'one welcome');
    }
  });
}

test('1: Add: a refusal on the email itself keeps its own words beside their being added; the email\'s write not going, whatever the database says, is "stopped partway"', async () => {
  // (someone else's by the moment it's saved: a row the check finds)
  {
    const env = await world([{ slug: 'olive-owner', name: 'Olive Owner', email: 'olive.o@example.org' }]);
    const app = await applied(env, 'Rex Refused', 'rex.r@example.org');
    const p = await plan(env, app.id);
    const DB = { ...env.DB, prepare: (sql) => (sql === CHECK ? env.DB.prepare("SELECT r.slug, t.data FROM reveal_board_emails r JOIN team t ON t.slug = r.slug WHERE r.slug = 'olive-owner' AND ? != ? LIMIT 1") : env.DB.prepare(sql)) };
    const r = await quietly(() => post({ ...env, DB }, { add: { id: app.id, as: 'new', seen: p.key } }));
    assert.deepEqual([r.status, r.error], [409, 'Rex Refused is on the Advisory Board, but their email didn’t save: That email is already Olive Owner’s. Each person signs in to the board page with their own.']);
  }
  // (the write refused by the database, in words that don't look like D1's: never those words, and never "didn't save")
  for (const message of ['D1 busy', 'Network connection lost.', 'internal error; reference = 7c1d']) {
    const env = await world();
    const app = await applied(env, 'Wes Writefail', 'wes.w@example.org');
    const p = await plan(env, app.id);
    let once = true;
    const DB = { ...env.DB, prepare: (sql) => (once && /INTO reveal_board_emails/.test(sql) ? { bind: () => ({ run: async () => { once = false; throw new Error(message); } }) } : env.DB.prepare(sql)) };
    const r = await quietly(() => post({ ...env, DB }, { add: { id: app.id, as: 'new', seen: p.key } }));
    assert.deepEqual([r.status, r.error], [503, PARTWAY('the site’s database didn’t answer just now')], message);
    assert.equal((await press(env, app.id)).status, 200, `${message}: the next press finishes it`);
  }
});

test('1: People → Board and People → Advisory\'s own email save (/api/reveal-invites-admin): the check not answering is said as that, 503, nothing saved', async () => {
  const invitesAdmin = await import('../functions/api/reveal-invites-admin.js');
  const env = await world([{ slug: 'bo-board', name: 'Bo Board', group: 'board' }, { slug: 'ada-adv', name: 'Ada Adv' }]);
  for (const [slug, sql] of [['bo-board', CHECK], ['bo-board', ORPHAN], ['ada-adv', CHECK], ['ada-adv', ORPHAN]]) {
    const f = faulty(env.DB, nth(sql, 1));
    const res = await quietly(() => invitesAdmin.onRequestPost({ env: { ...env, DB: f.DB }, request: new Request('https://site.test/api/reveal-invites-admin', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'linzi@soardcharity.com' }, body: JSON.stringify({ boardEmail: { slug, email: `${slug}@example.org` } }) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} }));
    const j = await res.json();
    assert.equal(f.state.hit.length, 1, `${slug} ${sql.slice(0, 30)}: hit`);
    assert.deepEqual([res.status, j.error], [503, CHECK_DOWN], `${slug} ${sql.slice(0, 30)}`);
    assert.equal(await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(slug).first(), null, 'nothing saved');
  }
});

test('1: the Advisory Board\'s member writes: the check of whether the site keeps People\'s emails failing is a read failure, and asked again next time, never kept as "no table of emails"', async () => {
  const { ownRow } = await import('../functions/api/_member-write.js');
  const real = await createD1();
  await real.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  let failing = true;
  const DB = { ...real, prepare: (sql) => (failing && /sqlite_master/.test(sql) ? { bind: () => DB.prepare(sql), first: async () => { throw D1_DOWN(); } } : real.prepare(sql)) };
  const e = await ownRow(DB, { slug: 'ada-adv', email: 'ada@example.org' }).then(() => null, (x) => x);
  assert.deepEqual([e?.status, e?.unread], [503, true], 'a read failure');
  failing = false;
  const [fromWhere] = await ownRow(DB, { slug: 'ada-adv', email: 'ada@example.org' });
  assert.match(fromWhere, /reveal_board_emails/, 'asked again: by their sign-in email');
});

// ─── 2: a step's result from its own write ───────────────────

const JOINED = "UPDATE advisory_applications SET person_slug = ?, status = 'joined', status_at = ?, status_by = ?, updated_at = ? WHERE id = ?";
test('2: marking the application Joined answers with what that write saved: nothing read after it can make a press whose writes landed say "stopped partway"; it answers done, the welcome waiting said as waiting', async () => {
  const env = await world();
  const app = await applied(env, 'Jody Joinedpart', 'jody.jp@example.org');
  const p = await plan(env, app.id);
  // (every read of the application after it's marked Joined, failing: the press's own, linkAdvisor's read back as was)
  const f = faulty(env.DB, (() => { let joined = false; return (sql) => { if (sql.startsWith(JOINED)) joined = true; return joined && sql === 'SELECT * FROM advisory_applications WHERE id = ?' ? 'before' : null; }; })());
  const r = await quietly(() => post({ ...env, DB: f.DB }, { add: { id: app.id, as: 'new', seen: p.key } }));
  assert.equal(r.status, 200, r.error);
  assert.equal(r.application.status, 'joined');
  assert.equal(r.person.slug, 'jody-joinedpart');
  assert.ok(r.welcome?.sent || r.welcome?.waiting, JSON.stringify(r.welcome));
  // (the welcome not going just now: done all the same, the welcome said as waiting, and it's written down as waiting)
  const env2 = await world();
  const app2 = await applied(env2, 'Jody Waitsend', 'jody.ws@example.org');
  const p2 = await plan(env2, app2.id);
  const f2 = faulty(env2.DB, (() => { let joined = false; return (sql) => { if (sql.startsWith(JOINED)) joined = true; return joined && /^SELECT data FROM board_state WHERE key = \?$/.test(sql) ? 'before' : null; }; })());
  const r2 = await quietly(() => post({ ...env2, DB: f2.DB }, { add: { id: app2.id, as: 'new', seen: p2.key } }));
  assert.equal(r2.status, 200, r2.error);
  assert.deepEqual(r2.welcome, { waiting: true, why: 'send' });
  assert.ok((await readState(env2.DB, 'advisory-mail')).waiting?.['jody-waitsend'], 'written down as waiting');
  const after = await plan(env2, app2.id);
  assert.deepEqual([after.kind, after.welcomeWaiting], ['joined', true], 'the box: nothing left to press, the welcome waiting');
});

for (const [kind, people] of [['someone new', []], ['the same person', [{ slug: 'addy-sweepsame', name: 'Addy Sweepsame', email: 'addy.sweepsame@example.org' }]]]) {
  test(`2: Add (${kind}), each statement of the press failing in turn, before it runs and after: "stopped partway" only beside a box that offers the press it names; whenever the box has nothing left to press, the press answered done`, async (t) => {
    const name = people[0]?.name || 'Addy Sweepnew';
    const email = people[0]?.email || 'addy.sweepnew@example.org';
    const ref = await world(people);
    const app0 = await applied(ref, name, email);
    const count = faulty(ref.DB);
    const done = await quietly(() => press(ref, app0.id, count.DB));
    assert.equal(done.status, 200, done.error);
    const n = count.state.n;
    let partway = 0;
    let doneAfterJoined = 0;
    let joinedUnsure = 0;
    for (const how of ['before', 'after']) {
      for (let i = 1; i <= n; i++) {
        const env = await world(people);
        const app = await applied(env, name, email);
        const p = await plan(env, app.id);
        const f = faulty(env.DB, (_, k) => (k === i ? how : null));
        const r = await quietly(() => post({ ...env, DB: f.DB }, { add: { id: app.id, as: p.kind === 'new' ? 'new' : 'same', seen: p.key } }));
        if (!f.state.hit.length) continue;
        const at = `${how} statement ${i} of ${n} (${f.state.hit[0].slice(0, 70)})`;
        const next = await plan(env, app.id);
        if (r.status === 200) { if (next.kind === 'joined') doneAfterJoined += 1; continue; }
        assert.doesNotMatch(r.error, /D1_ERROR|SQLITE/, at);
        // (the one write the press can't know landed: marking it Joined, the database taking it and not saying so. The
        // press says what it knows, marked partway, and the box, finding nothing left to press, says it's done: the
        // page's half of the rule, scripts/test-advisory-round24.mjs)
        const unsure = how === 'after' && f.state.hit[0].startsWith(JOINED);
        if (/stopped partway/.test(r.error)) {
          partway += 1;
          assert.deepEqual([r.status, r.partway], [503, true], at);
          // (the words name a press: the box has one)
          if (!unsure) assert.ok(['new', 'same', 'choose'].includes(next.kind), `${at}: said "stopped partway", and the box has ${next.kind}`);
        }
        if (unsure) { assert.deepEqual([next.kind, r.partway], ['joined', true], at); joinedUnsure += 1; continue; }
        assert.notEqual(next.kind, 'joined', `${at}: the box has nothing left to press, and the press said: ${r.status} ${r.error}`);
        // (a hold the database took and didn't say so keeps presses off for its 2 minutes, as it should: they're over)
        if (how === 'after') await env.DB.prepare('DELETE FROM advisory_add_holds').run();
        const again = await quietly(() => press(env, app.id));
        assert.equal(again.status, 200, `${at}, pressed again: ${again.error}`);
      }
    }
    t.diagnostic(`${n} statements, each failed before and after it ran: ${partway} said stopped partway (each beside a press, but ${joinedUnsure} where Joined was taken unsaid), ${doneAfterJoined} landed Joined and said done`);
    assert.ok(partway > 3 && doneAfterJoined > 0 && joinedUnsure === 1, `${partway} partway, ${doneAfterJoined} done, ${joinedUnsure} Joined unsaid`);
  });
}

test('2: a status and a note answer with what their own write saved: the application read again after it not answering never says they didn\'t', async () => {
  const env = await world();
  const app = await applied(env, 'Sol Statusread', 'sol.s@example.org');
  // (the route reads the application first; the second read, after the write, was the read back)
  for (const [body, check] of [[{ status: { id: app.id, status: 'talking', from: 'new' } }, (a) => a.status === 'talking'], [{ note: { id: app.id, text: 'Called them.' } }, (a) => a.notes.at(-1)?.text === 'Called them.']]) {
    const f = faulty(env.DB, nth('SELECT * FROM advisory_applications WHERE id = ?', 2));
    const r = await quietly(() => post({ ...env, DB: f.DB }, body));
    assert.equal(r.status, 200, `${Object.keys(body)[0]}: ${r.error}`);
    assert.ok(check(r.application), Object.keys(body)[0]);
  }
  // (deleted in the moment since: said as gone, as before)
  const gone = await applied(env, 'Gil Gonesoon', 'gil.g@example.org');
  await env.DB.prepare('DELETE FROM advisory_applications WHERE id = ?').bind(gone.id).run();
  const { setAdvisoryStatus } = await import('../functions/api/_advisory-applications.js');
  await assert.rejects(() => setAdvisoryStatus(env.DB, gone.id, 'talking'), (e) => e.status === 404);
});

test('2: the Advisory Board\'s "I know someone" and "host a fundraiser" answer with the row their write saved: a read after it not answering never says "That didn\'t go through" of one that did', async () => {
  const { addIntro, requestHost, ensureAdvisory } = await import('../functions/api/_advisory.js');
  const env = await world([{ slug: 'ivy-intro', name: 'Ivy Intro', email: 'ivy.i@example.org' }]);
  await ensureAdvisory(env.DB);
  const who = { slug: 'ivy-intro', email: 'ivy.i@example.org' };
  for (const [table, write] of [['advisory_intros', (DB) => addIntro(DB, who, { name: 'Pat Plumber', company: 'Pat Plumbing' })], ['advisory_hosted', (DB) => requestHost(DB, who, { title: 'A dinner' })]]) {
    const f = faulty(env.DB, (sql) => (sql === `SELECT * FROM ${table} WHERE id = ?` ? 'before' : null));
    const out = await quietly(() => write(f.DB).then((x) => x, (e) => ({ failed: e.message })));
    assert.ok(!out.failed, `${table}: ${out.failed}`);
    assert.deepEqual([out.slug, out.landedOn?.slug], ['ivy-intro', 'ivy-intro'], table);
    assert.equal((await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 1, `${table}: one`);
  }
});

// ─── 2: the box's welcome words for a press that finished ───────────────────

test('2: once Joined, the box\'s plan says whether their sign-in email is waiting for the heartbeat (for what the page says of a press that finished)', async () => {
  const env = await world([], { emails: false });
  const app = await applied(env, 'Wynn Waiting', 'wynn.w@example.org');
  const r = await press(env, app.id);
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.welcome, { off: true, queued: true });
  const p = await plan(env, app.id);
  assert.deepEqual([p.kind, p.welcomeWaiting, p.person.welcomed], ['joined', true, false]);
});

// ─── 4: family-first couples with a second comma ───────────────────

const addressOf = (n) => { const r = readName(n); return slugOf((r.address || r.words).join(' ')); };
test('4: "Family, Given" and the other one of a couple past the first one\'s letters after a second comma: read as theirs (whole if typed whole, else with the first one\'s family name); the address never theirs or the letters; never a partner past words that aren\'t letters', () => {
  for (const [typed, partner, address] of [
    ['Ffcabx, Jordan, MD & Amy', 'Amy Ffcabx', 'ffcabx-jordan'], ['Ffcabx, Jordan, Jr. & Amy', 'Amy Ffcabx', 'ffcabx-jordan'], ['Ffcabx, Jordan, & Amy', 'Amy Ffcabx', 'ffcabx-jordan'],
    ['Ffcabx, Jordan, MD & Amy Ffcabx', 'Amy Ffcabx', 'ffcabx-jordan'], ['Ffcabx, Jordan, MD, & Amy', 'Amy Ffcabx', 'ffcabx-jordan'], ['Ffcabx, Jordan, MD and Amy', 'Amy Ffcabx', 'ffcabx-jordan'],
    ['Ffcabx, Jordan, M.D. & Amy', 'Amy Ffcabx', 'ffcabx-jordan'], ['Ffcabx, Jordan, MD & Amy Lee', 'Amy Lee', 'ffcabx-jordan'], ['Ffcabx, Jordan, MD & Amy, Atlanta', 'Amy Ffcabx', 'ffcabx-jordan'],
    ['Ffcabx, Dr. Jordan, MD & Amy', 'Amy Ffcabx', 'ffcabx-jordan'],
    // (a family name in parts: the same)
    ['De La Cruz, Maria, MD & Jose', 'Jose De La Cruz', 'de-la-cruz-maria'],
    // (the controls: round 23's, as before)
    ['Ffcabx, Jordan & Amy', 'Amy Ffcabx', 'jordan-ffcabx'], ['Jordan Ffcabx, MD & Amy', 'Amy Ffcabx', 'jordan-ffcabx'],
    // nobody: a firm, a company, a place or anything that isn't letters before the "&", no first name of theirs
    ['Ffcabx, Jordan, Johnson & Johnson', null, 'ffcabx-jordan'], ['Ffcabx, Jordan, Barnes & Noble', null, 'ffcabx-jordan'], ['Ffcabx, Jordan, Ernst & Young', null, 'ffcabx-jordan'],
    ['Ffcabx, Jordan, Atlanta & Amy', null, 'ffcabx-jordan'], ['Ffcabx, Jordan, she/her & Amy', null, 'ffcabx-jordan'], ['Ffcabx, Jordan, MD & Associates', null, 'ffcabx-jordan'],
    ['Ffcabx, Jordan, MD & family', null, 'ffcabx-jordan'], ['Ffcabx, Jordan, MD & Mrs. Ffcabx', null, 'ffcabx-jordan'], ['Ames, Jordan, Amy and Sam', null, 'ames-jordan-amy-and-sam'],
  ]) {
    const r = readName(typed);
    assert.equal(r.partnerWhole?.join(' ') || null, partner, typed);
    assert.equal(addressOf(typed), address, `${typed}: the address`);
  }
  // (the first one, as before: Jordan Ffcabx, kept as typed)
  for (const typed of ['Ffcabx, Jordan, MD & Amy', 'Ffcabx, Jordan, Jr. & Amy', 'Ffcabx, Jordan, & Amy']) {
    assert.deepEqual([readName(typed).words.join(' '), readName(typed).shown], ['Jordan Ffcabx', typed], typed);
  }
});

test('4: the public application greets these as round 23 greets "Ffcabx, Jordan & Amy": no name, "Thank you." (the thank-you, the applicant\'s copy)', () => {
  const want = greetName({ fullName: 'Ffcabx, Jordan & Amy' });
  assert.equal(want, '');
  for (const fullName of ['Ffcabx, Jordan, MD & Amy', 'Ffcabx, Jordan, Jr. & Amy', 'Ffcabx, Jordan, & Amy']) {
    assert.equal(greetName({ fullName }), want, fullName);
    assert.equal(applicantEmail({ answers: { fullName }, headshot: null }).text.split('\n')[0], 'Thank you.', fullName);
  }
});

test('4: Add asks whether a family-first couple with a second comma is the Amy already on People → Advisory, and pressed "the same person" adds to her: never a second record beside her; someone new is at ffcabx-jordan', async () => {
  let k = 0;
  for (const typed of ['F, Jordan, MD & Amy', 'F, Jordan, Jr. & Amy', 'F, Jordan, & Amy']) {
    k += 1;
    const F = `Ffc${'abcdefg'[k]}bx`;
    const sub = (x) => x.replace(/\bF\b/g, F);
    const amy = { slug: `amy-${F.toLowerCase()}`, name: `Amy ${F}`, email: `ffa.${k}@example.org` };
    const env = await world([amy]);
    const app = await applied(env, sub(typed), `ffq.${k}@example.org`);
    const p = await plan(env, app.id);
    assert.deepEqual([p.kind, p.person?.name, p.slug], ['choose', amy.name, `${F.toLowerCase()}-jordan`], sub(typed));
    const r = await press(env, app.id, env.DB, 'same');
    assert.deepEqual([r.status, r.person?.slug], [200, amy.slug], `${sub(typed)}: ${r.error || ''}`);
    assert.deepEqual(((await env.DB.prepare('SELECT slug FROM team WHERE slug LIKE ?').bind(`%${F.toLowerCase()}%`).all()).results || []).map((x) => x.slug), [amy.slug], sub(typed));
  }
  // (nobody on People: someone new at the address, the name as typed)
  const env = await world();
  const app = await applied(env, 'Ffczbx, Jordan, & Amy', 'ffq.z@example.org');
  const r = await press(env, app.id);
  assert.deepEqual([r.status, r.person?.slug, r.person?.name], [200, 'ffczbx-jordan', 'Ffczbx, Jordan, & Amy']);
});
