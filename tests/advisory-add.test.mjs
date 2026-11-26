/**
 * Add to Advisory Board on the server (functions/api/_advisory-add.js), through the admin endpoint as staff press it:
 * who they are on People (by email, then by name), what's saved (through the admin's own save), what's never
 * replaced (an existing member's sign-in email and photo), what can't be added, and a press after a failure.
 * Run: node --test tests/
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { readHeadshot, submitApplication, getAdvisoryApplication } from '../functions/api/_advisory-applications.js';
import * as adminApi from '../functions/api/advisory-applications-admin.js';

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

let env;
let emailsSent;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', RESEND_API_KEY: 'r' };
  // The People table as D1 has it (the admin's save writes its columns), and the private emails
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  emailsSent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.includes('/images/v1') && init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } }); }
    if (url.host === 'api.resend.com') { const b = JSON.parse(init.body); emailsSent.push(...b); return Response.json({ data: b.map((_, i) => ({ id: `e${i}` })) }); }
    throw new Error(`no route for ${url.href}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const person = (slug, d, email) => Promise.all([
  env.DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, d.order || 0, JSON.stringify({ slug, status: 'active', publishStatus: 'published', ...d })).run(),
  email ? env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run() : null,
]);
const applied = async (fullName, email, extra = {}) => (await submitApplication(env, { ...BASE, fullName, email, signature: fullName, ...extra }, { headshot: SHOT })).app;
const ctx = (method, body, query = '') => ({
  env,
  request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
  data: { userEmail: 'linzi@soardcharity.com' },
  waitUntil: () => {},
});
const plan = async (id) => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${id}`))).json()).plan;
// As the admin presses it: the box's plan read first, and that box's key sent with the press (seen given: a box opened earlier)
const add = async (id, as, seen) => {
  const key = seen !== undefined ? seen : (await plan(id))?.key;
  return (await adminApi.onRequestPost(ctx('POST', { add: { id, as, seen: key } }))).json();
};
const rec = async (slug) => JSON.parse((await env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first())?.data || 'null');
const emailOf = async (slug) => (await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(slug).first())?.email || null;

test('someone new: a hidden record at an address from their name (accents as plain letters), the headshot their photo, their email, Joined', async () => {
  const app = await applied('José Núñez', 'Jose@Example.org', { company: 'Núñez & Co', link: 'linkedin.com/in/jose' });
  const p = await plan(app.id);
  assert.equal(p.kind, 'new');
  assert.equal(p.slug, 'jose-nunez');
  const r = await add(app.id, 'new');
  assert.equal(r.success, true, r.error);
  assert.deepEqual({ ...r.person }, { slug: 'jose-nunez', name: 'José Núñez', made: true, photoAdded: true, restored: false, email: 'jose@example.org', emailKept: false, emailUnusable: '' });
  const saved = await rec('jose-nunez');
  assert.equal(saved.group, 'advisory');
  assert.equal(saved.publishStatus, 'draft', 'hidden from the public site');
  assert.equal(saved.title, 'Advisory Board Member');
  assert.equal(saved.organization, 'Núñez & Co');
  assert.equal(saved.linkedin, 'https://www.linkedin.com/in/jose');
  assert.equal(saved.photo, app.headshot.url);
  assert.deepEqual(saved.photoSize, [900, 1200]);
  assert.equal(await emailOf('jose-nunez'), 'jose@example.org', 'their sign-in, kept privately');
  assert.equal(r.application.status, 'joined');
  assert.equal(r.application.personSlug, 'jose-nunez');
  assert.deepEqual(r.welcome, { off: true, queued: true }, 'emails off: it waits for them');
  const history = (await env.DB.prepare("SELECT action, entity_slug FROM audit_log WHERE entity_type = 'team'").all()).results;
  assert.ok(history.some((h) => h.action === 'created' && h.entity_slug === 'jose-nunez'), 'History has it, as the admin’s own save does');
  // Pressed again: nothing made twice
  const again = await add(app.id, 'new');
  assert.equal(again.success, true);
  assert.equal(again.person.made, false);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE \"group\" = 'advisory'").first()).n, 1);
});

test('a name with no letters a to z gets an address of its own, "advisory-board-member-…" from its application, never one another such name is after', async () => {
  const one = await applied('李小龙', 'li@example.org');
  const own = `advisory-board-member-${one.id.slice(-6)}`;
  assert.equal((await plan(one.id)).slug, own);
  assert.equal((await add(one.id, 'new')).person.slug, own);
  const two = await applied('张伟', 'zhang@example.org');
  const theirs = (await add(two.id, 'new')).person.slug;
  assert.equal(theirs, `advisory-board-member-${two.id.slice(-6)}`);
  assert.notEqual(theirs, own);
  assert.equal((await rec(theirs)).name, '张伟');
});

test('their email is already a member’s on People → Advisory: that’s them, linked, and nothing of theirs is replaced', async () => {
  await person('jordan-lee', { name: 'Jordan Lee', group: 'advisory', photo: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/team/jordan-lee/1/public', bio: 'Kept.' }, 'jordan@leeco.com');
  const app = await applied('Jordan A. Lee', 'JORDAN@leeco.com');
  const p = await plan(app.id);
  assert.equal(p.kind, 'same');
  assert.equal(p.why, 'email');
  assert.equal(p.person.slug, 'jordan-lee');
  const r = await add(app.id, 'same');
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.made, false);
  assert.equal(r.person.photoAdded, false, 'their photo stays');
  assert.equal(r.person.emailKept, true);
  const saved = await rec('jordan-lee');
  assert.equal(saved.photo, 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/team/jordan-lee/1/public');
  assert.equal(saved.bio, 'Kept.');
  assert.equal(r.application.personSlug, 'jordan-lee');
  assert.equal(r.application.status, 'joined');
});

test('the same name, another email: staff say which; "the same person" never takes over their sign-in, "a different one" is someone new', async () => {
  await person('jordan-lee', { name: 'Jordan Lee', group: 'advisory', bio: 'The member.' }, 'jordan@leeco.com');
  const stranger = await applied('Jordan Lee', 'jordan.lee.1990@example.org');
  const p = await plan(stranger.id);
  assert.equal(p.kind, 'choose');
  assert.equal(p.person.email, 'jordan@leeco.com');
  assert.equal(p.slug, 'jordan-lee-2', 'a different person’s address is ready');
  // A different person: someone new, their own address and sign-in
  const r = await add(stranger.id, 'new');
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.slug, 'jordan-lee-2');
  assert.equal(await emailOf('jordan-lee-2'), 'jordan.lee.1990@example.org');
  assert.equal(await emailOf('jordan-lee'), 'jordan@leeco.com', 'the member still signs in as themselves');
  // The same person (a second application of theirs from a new address): their sign-in is kept, never replaced
  const second = await applied('Jordan Lee', 'jl.personal@example.org', { why: 'Applying again from home.' });
  const p2 = await plan(second.id);
  assert.equal(p2.kind, 'choose');
  const s = await add(second.id, 'same');
  assert.equal(s.success, true, s.error);
  assert.equal(s.person.slug, 'jordan-lee');
  assert.equal(s.person.emailKept, true);
  assert.equal(s.person.email, 'jordan@leeco.com');
  assert.equal(await emailOf('jordan-lee'), 'jordan@leeco.com');
  assert.equal((await rec('jordan-lee')).bio, 'The member.');
});

test('their email is someone’s on People → Board: nobody is added, and it says why', async () => {
  await person('bob-board', { name: 'Bob Board', group: 'board' }, 'bob@example.org');
  const app = await applied('Bob Board', 'bob@example.org');
  const p = await plan(app.id);
  assert.equal(p.kind, 'blocked');
  assert.equal(p.person.where, 'People → Board');
  for (const as of ['new', 'same']) {
    const r = await add(app.id, as);
    assert.equal(r.success, false);
    assert.match(r.error, /bob@example\.org is Bob Board’s email on People → Board\. Each person signs in with their own, and nobody was added\./);
  }
  assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM team').first()).n, 1);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'new');
});

test('someone elsewhere on People with the same name (another email): a new person, at their own address', async () => {
  await person('casey-reed', { name: 'Casey Reed', group: 'board' }, 'casey.board@example.org');
  const app = await applied('Casey Reed', 'casey@example.org');
  const p = await plan(app.id);
  assert.equal(p.kind, 'new');
  assert.equal(p.slug, 'casey-reed-2');
  assert.equal(p.namesake.where, 'People → Board');
  assert.equal((await add(app.id, 'same')).success, false, 'only "new" fits');
  assert.equal((await add(app.id, 'new')).person.slug, 'casey-reed-2');
  assert.equal((await rec('casey-reed')).group, 'board', 'the board member is untouched');
});

test('a former member (alumni) who applies again: active on the Advisory Board again, their headshot their photo if they had none', async () => {
  await person('riley-former', { name: 'Riley Former', group: 'advisory', status: 'alumni', until: 2025 }, 'riley@example.org');
  const app = await applied('Riley Former', 'riley@example.org');
  const p = await plan(app.id);
  assert.equal(p.kind, 'same');
  assert.equal(p.person.status, 'alumni');
  const r = await add(app.id, 'same');
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.restored, true);
  assert.equal(r.person.photoAdded, true);
  const saved = await rec('riley-former');
  assert.equal(saved.status, 'active');
  assert.equal(saved.until, undefined, 'an active member has no "until"');
  assert.equal(saved.photo, app.headshot.url);
});

test('a former board member’s address is never someone else’s', async () => {
  await env.DB.exec('CREATE TABLE board_signatures (slug TEXT, doc TEXT)');
  await env.DB.prepare("INSERT INTO board_signatures VALUES ('pat-kim', 'coi')").run();
  const app = await applied('Pat Kim', 'pat@example.org');
  assert.equal((await plan(app.id)).slug, 'pat-kim-2');
  assert.equal((await add(app.id, 'new')).person.slug, 'pat-kim-2');
});

test('a press after one that stopped partway picks up where it stopped', async () => {
  const app = await applied('Morgan Ellis', 'morgan@example.org');
  // Their email doesn't save the first time (D1 refuses for a moment)
  const real = env.DB.prepare.bind(env.DB);
  let refuse = true;
  env.DB.prepare = (sql) => (refuse && /INTO reveal_board_emails/.test(sql) ? { bind: () => ({ run: async () => { refuse = false; throw new Error('D1 busy'); } }) } : real(sql));
  const first = await add(app.id, 'new');
  env.DB.prepare = real;
  assert.equal(first.success, false);
  /* r24: the write not going is the press stopping partway (503, our words), never "their email didn't save: D1 busy",
     the database's own words taken for a refusal because they didn't look like D1's (Advisory Board QA round 24, decided 1) */
  assert.equal(first.error, 'Adding them stopped partway: the site’s database didn’t answer just now. Press Add to Advisory Board again in a moment: it finishes what’s left, and never adds them twice.');
  assert.equal((await rec('morgan-ellis')).group, 'advisory', 'their record was made');
  const p = await plan(app.id);
  assert.equal(p.kind, 'same', 'the application points at them now');
  assert.equal(p.person.slug, 'morgan-ellis');
  const again = await add(app.id, 'same');
  assert.equal(again.success, true, again.error);
  assert.equal(await emailOf('morgan-ellis'), 'morgan@example.org');
  assert.equal(again.application.status, 'joined');
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'morgan-ellis%'").first()).n, 1, 'never a second record');
});

test('who matches changed since the box opened: said, nothing done', async () => {
  const app = await applied('Avery Lin', 'avery@example.org');
  assert.equal((await plan(app.id)).kind, 'new');
  await person('avery-lin', { name: 'Avery Lin', group: 'advisory' }, 'avery@example.org'); // someone added them meanwhile
  const r = await add(app.id, 'new');
  assert.equal(r.success, false);
  assert.match(r.error, /changed since the box opened/);
  assert.equal((await plan(app.id)).kind, 'same');
});

test('linking by hand: only to someone active on People → Advisory, never a board member, a former member, someone In memoriam, or nobody', async () => {
  await person('bob-board', { name: 'Bob Board', group: 'board' });
  await person('ann-alum', { name: 'Ann Alum', group: 'advisory', status: 'alumni' });
  await person('mo-mem', { name: 'Mo Mem', group: 'advisory', status: 'memorial' });
  await person('old-mem', { name: 'In memoriam, Old Mem', group: 'advisory', status: undefined });
  await person('ada-advisor', { name: 'Ada Advisor', group: 'advisory' }, 'ada@example.org');
  const app = await applied('Ada Advisor', 'ada@example.org');
  for (const slug of ['bob-board', 'nobody-here', 'ann-alum', 'mo-mem', 'old-mem']) {
    const r = await (await adminApi.onRequestPost(ctx('POST', { person: { id: app.id, slug } }))).json();
    assert.equal(r.success, false, slug);
    assert.match(r.error, /That isn’t who this application matches on People/);
  }
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'new');
  const ok = await (await adminApi.onRequestPost(ctx('POST', { person: { id: app.id, slug: 'ada-advisor' } }))).json();
  assert.equal(ok.application.status, 'joined');
});

test('careless requests: a body that isn’t an object, an unknown "as", a note that isn’t words', async () => {
  const app = await applied('Dana Doe', 'dana@example.org');
  for (const body of [null, [], 'add']) assert.equal((await adminApi.onRequestPost(ctx('POST', body))).status, 400, JSON.stringify(body));
  assert.equal((await add(app.id, 'maybe')).success, false);
  const note = await (await adminApi.onRequestPost(ctx('POST', { note: { id: app.id, text: { a: 1 } } }))).json();
  assert.equal(note.success, false);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).notes.length, 0, 'no "[object Object]" note');
});

// ─── Round two ──────────────────────────────────────────────────────

test('two presses at once (two tabs, two staff): one person, never two', async () => {
  const app = await applied('Dot Double', 'dot@example.org');
  const [a, b] = await Promise.all([add(app.id, 'new'), add(app.id, 'new')]);
  const ok = [a, b].filter((r) => r.success);
  assert.ok(ok.length >= 1);
  for (const r of [a, b].filter((x) => !x.success)) assert.match(r.error, /Someone is adding them right now/);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'dot-double%'").first()).n, 1);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).personSlug, 'dot-double');
  // Two applications from one email added at once: one person; the other then links to them
  const r1 = await applied('Ray Repeat', 'ray@example.org');
  const r2 = await applied('Ray Repeat', 'ray@example.org', { why: 'Applying again.' });
  await Promise.all([add(r1.id, 'new'), add(r2.id, 'new')]);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'ray-repeat%'").first()).n, 1);
  for (const r of [r1, r2]) {
    const p = await plan(r.id);
    if (p.kind !== 'joined') { assert.equal(p.kind, 'same'); assert.equal((await add(r.id, 'same')).success, true); }
  }
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'ray-repeat%'").first()).n, 1);
});

test('a press after one that stopped partway finishes it, whichever way it was asked', async () => {
  const app = await applied('Pia Partial', 'pia@example.org');
  const real = env.DB.prepare.bind(env.DB);
  let refuse = true;
  env.DB.prepare = (sql) => (refuse && /INTO reveal_board_emails/.test(sql) ? { bind: () => ({ run: async () => { refuse = false; throw new Error('D1 busy'); } }) } : real(sql));
  assert.equal((await add(app.id, 'new')).success, false);
  env.DB.prepare = real;
  const again = await add(app.id, 'new'); // the box still says "Add them"
  assert.equal(again.success, true, again.error);
  assert.equal(again.person.slug, 'pia-partial');
  assert.equal(await emailOf('pia-partial'), 'pia@example.org');
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'pia-partial%'").first()).n, 1);
});

test('the same name under another address on People → Advisory is found ("Dana Kim" at dana-k), before a namesake elsewhere', async () => {
  await person('dana-k', { name: 'Dana Kim', group: 'advisory' }, 'dana@kimco.com');
  const app = await applied('Dana  Kim', 'dana.kim@example.org');
  const p = await plan(app.id);
  assert.equal(p.kind, 'choose');
  assert.equal(p.person.slug, 'dana-k');
  await person('sam-rivera', { name: 'Sam Rivera', group: 'board', status: 'alumni' });
  await person('jlee-advisory', { name: 'Sam Rivera', group: 'advisory' });
  const sam = await applied('Sam Rivera', 'sam.r@example.org');
  const ps = await plan(sam.id);
  assert.equal(ps.kind, 'choose', 'the Advisory Board one, not the board alumnus');
  assert.equal(ps.person.slug, 'jlee-advisory');
  assert.equal(ps.slug, 'sam-rivera-2', 'a different person gets a free address');
});

test('the box knows when they’ve had their sign-in email already', async () => {
  await person('lu-link', { name: 'Lu Link', group: 'advisory' }, 'lu@link.com');
  const { writeState } = await import('../functions/api/_board-roles.js');
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'lu-link': '2026-11-01T00:00:00.000Z' } });
  const app = await applied('Lu Link', 'lu@link.com');
  const p = await plan(app.id);
  assert.equal(p.person.welcomed, true);
});

test('an email left behind by someone deleted from People is nobody’s: it never blocks an Add', async () => {
  await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('someone-removed', 'olive@example.org').run();
  const app = await applied('Olive Orphan', 'olive@example.org');
  assert.equal((await plan(app.id)).kind, 'new');
  const r = await add(app.id, 'new');
  assert.equal(r.success, true, r.error);
  assert.equal(await emailOf('olive-orphan'), 'olive@example.org');
  assert.equal(await emailOf('someone-removed'), null, 'the leftover row is gone');
});

test('letters with no accent to take off become plain ones in an address', async () => {
  const { slugOf } = await import('../public/admin/team-shared.js');
  assert.deepEqual(['Søren Kierkegaard', 'Łukasz Wójcik', 'Đorđe Đukić', 'Hans Groß', 'Æsa Ólafsdóttir', 'Zoë Brontë'].map(slugOf),
    ['soren-kierkegaard', 'lukasz-wojcik', 'dorde-dukic', 'hans-gross', 'aesa-olafsdottir', 'zoe-bronte']);
  const app = await applied('Søren Kierkegaard', 'soren@example.org');
  assert.equal((await add(app.id, 'new')).person.slug, 'soren-kierkegaard');
});

test('the panel’s answer about who it’s linked to is People now, read by the server (never the admin’s older copy)', async () => {
  const app = await applied('Gil Gone', 'gil@example.org');
  const r = await add(app.id, 'new');
  assert.deepEqual(r.application.person, { slug: 'gil-gone', name: 'Gil Gone', group: 'advisory', status: 'active', publishStatus: 'draft', hasEmail: true }, 'right after Add: them');
  const get = async () => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${app.id}`))).json()).application;
  assert.equal((await get()).person.slug, 'gil-gone');
  const row = await env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind('gil-gone').first();
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...JSON.parse(row.data), status: 'alumni' }), 'gil-gone').run();
  assert.equal((await get()).person.status, 'alumni', 'moved to alumni: still them, and says so');
  await env.DB.prepare('DELETE FROM team WHERE slug = ?').bind('gil-gone').run();
  assert.equal((await get()).person, null, 'deleted from People: null');
  // D1 failing that read: no answer either way (never "gone" when it isn't)
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (sql === 'SELECT data FROM team WHERE slug = ?' ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  const unsure = await get();
  env.DB.prepare = real;
  assert.equal('person' in unsure, false);
  // Not linked at all: nothing
  const other = await applied('Nia New', 'nia@example.org');
  assert.equal('person' in (await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${other.id}`))).json()).application, false);
});

// ─── Round three ────────────────────────────────────────────────────

test('someone who left (alumni) comes back from their own Joined application: Add plans a restore, and they come back hidden', async () => {
  const app = await applied('Ava Back', 'ava@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...(await rec('ava-back')), status: 'alumni', until: 2026, publishStatus: 'published' }), 'ava-back').run();
  const p = await plan(app.id);
  assert.equal(p.kind, 'same', 'never "already on the Advisory Board" for someone who left');
  assert.equal(p.why, 'linked');
  assert.equal(p.person.status, 'alumni');
  const r = await add(app.id, 'same');
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.restored, true);
  const back = await rec('ava-back');
  assert.equal(back.status, 'active');
  assert.equal(back.publishStatus, 'draft', 'off the public site until staff show them, as anyone added is');
  assert.equal(back.until, undefined);
  assert.equal((await plan(app.id)).kind, 'joined');
});

test('someone In memoriam is never added to: by their application, their email, or their name', async () => {
  await person('mo-mem', { name: 'Mo Mem', group: 'advisory', status: 'memorial' }, 'mo@example.org');
  const byEmail = await applied('Maurice Mem', 'mo@example.org');
  const p = await plan(byEmail.id);
  assert.deepEqual([p.kind, p.why], ['blocked', 'memorial']);
  const r = await add(byEmail.id, 'same');
  assert.equal(r.success, false);
  assert.match(r.error, /In memoriam/);
  assert.equal((await rec('mo-mem')).status, 'memorial');
  // The same name, another email: a new person (the one In memoriam is a namesake, never "the same person")
  const byName = await applied('Mo Mem', 'mo.new@example.org');
  const pn = await plan(byName.id);
  assert.equal(pn.kind, 'new');
  assert.equal(pn.slug, 'mo-mem-2');
});

test('a deleted person’s address is never given to someone new (History keeps it), and the old application isn’t theirs', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { welcomedSlugs } = await import('../functions/api/_advisory-mail.js');
  const { deleteItem } = await import('../functions/api/delete-content.js');
  const first = await applied('Jordan Lee', 'jordan@example.org');
  assert.equal((await add(first.id, 'new')).person.slug, 'jordan-lee');
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'jordan-lee': '2026-11-01T00:00:00.000Z' } });
  await deleteItem(env, { path: 'src/content/team/jordan-lee.json', message: 'gone' }, 'linzi@soardcharity.com', (p) => p?.catch?.(() => {}));
  assert.equal(await rec('jordan-lee'), null);
  assert.ok((await welcomedSlugs(env.DB))['jordan-lee'], 'the welcome they had stays on record (put back, they aren’t sent it twice)');
  // The first Jordan's application: unlinked (a note says who it was), so the address is truly free
  const firstNow = (await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${first.id}`))).json()).application;
  assert.equal(firstNow.personSlug, null);
  assert.match(firstNow.notes.at(-1).text, /Their People record \(Jordan Lee\) was deleted/);
  const second = await applied('Jordan Lee', 'jl.new@example.org');
  const p = await plan(second.id);
  assert.equal(p.kind, 'new');
  assert.equal(p.slug, 'jordan-lee-2', 'History still holds jordan-lee for the first Jordan');
  const r = await add(second.id, 'new');
  assert.equal(r.person.slug, 'jordan-lee-2');
  assert.notDeepEqual(r.welcome, { already: true }, 'the new Jordan’s welcome isn’t the first one’s');
  const firstAfter = (await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${first.id}`))).json()).application;
  assert.equal(firstAfter.personSlug, null, 'the first application is never shown as the new Jordan');
  assert.equal(firstAfter.person, undefined);
});

test('a press that stopped right after the People record saved: the next press finishes it, one record, and staff read words, not D1’s', async () => {
  const app = await applied('Morgan Ellis', 'morgan@example.org');
  const real = env.DB.prepare.bind(env.DB);
  let refuse = true;
  env.DB.prepare = (sql) => (refuse && /UPDATE advisory_applications SET person_slug/.test(sql)
    ? { bind: () => ({ run: async () => { refuse = false; throw new Error('D1_ERROR: Network connection lost.'); } }) } : real(sql));
  const failed = await add(app.id, 'new');
  env.DB.prepare = real;
  assert.equal(failed.success, false);
  assert.doesNotMatch(failed.error, /D1_ERROR|Network connection/);
  assert.match(failed.error, /stopped partway.*Press Add to Advisory Board again/);
  assert.ok(await rec('morgan-ellis'), 'the record had saved');
  const p = await plan(app.id);
  assert.deepEqual([p.kind, p.why, p.person.slug], ['same', 'linked', 'morgan-ellis'], 'never "is this the same Morgan Ellis?" about the record this press made');
  for (const as of ['new', 'same']) {
    const r = await add(app.id, as);
    if (r.success) { assert.equal(r.person.slug, 'morgan-ellis'); break; }
  }
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'morgan-ellis%'").first()).n, 1);
  assert.equal(await emailOf('morgan-ellis'), 'morgan@example.org');
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'joined');
});

test('a very long name gets a shorter address, cut at a word, and is added', async () => {
  const name = 'Maria Guadalupe Fernanda Alejandra de los Santos Villanueva-Hernandez y Castillo Montenegro';
  const app = await applied(name, 'maria@example.org');
  const r = await add(app.id, 'new');
  assert.equal(r.success, true, r.error);
  assert.ok(r.person.slug.length <= 60, r.person.slug);
  assert.equal(r.person.slug, 'maria-guadalupe-fernanda-alejandra-de-los-santos-villanueva');
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).personSlug, r.person.slug);
});

test('an email the sign-in can’t use (an old application’s): they’re added, the email isn’t saved, and both the box and the answer say so', async () => {
  const app = await applied('Pat Paren', 'pat@example.org');
  await env.DB.prepare('UPDATE advisory_applications SET email = ? WHERE id = ?').bind('pat(work)@example.com', app.id).run();
  const p = await plan(app.id);
  assert.equal(p.kind, 'new');
  assert.equal(p.emailUsable, false);
  const r = await add(app.id, 'new');
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.emailUnusable, 'pat(work)@example.com');
  assert.equal(await emailOf('pat-paren'), null);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'joined');
  // The form itself never takes such an address now (the mailer's rule, which the sign-in uses)
  const { checkAnswers } = await import('../functions/api/_advisory-form.js');
  for (const e of ['jordan(work)@example.com', 'jo:lee@example.com', 'jo@ex:ample.com']) assert.ok(checkAnswers({ email: e }, { step: 'you' }).problems.email, e);
  assert.equal(checkAnswers({ email: "o'brien@example.com" }, { step: 'you' }).problems.email, undefined);
});

test('Joined is set by Add, never by the pill alone', async () => {
  const app = await applied('Robin Pill', 'robin@example.org');
  const status = async (s) => (await adminApi.onRequestPost(ctx('POST', { status: { id: app.id, status: s } }))).json();
  const refused = await status('joined');
  assert.equal(refused.success, false);
  assert.match(refused.error, /Joined is set by Add to Advisory Board/);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'new');
  assert.equal((await add(app.id, 'new')).success, true);
  assert.equal((await status('talking')).success, true, 'other statuses are staff’s to set');
  assert.equal((await status('joined')).success, false, 'back to Joined only through Add, too');
  const again = await add(app.id, 'same');
  assert.equal(again.success, true, again.error);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'joined', 'Add finishes it and marks it Joined');
});

// ─── Round four ─────────────────────────────────────────────────────

test('a web address changed on People: the application stays linked, and their welcome (had or waiting) goes with them, once', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const { writeState, readState } = await import('../functions/api/_board-roles.js');
  const { welcomedSlugs } = await import('../functions/api/_advisory-mail.js');
  const a = await applied('Jordan Lee', 'jordan@example.org');
  assert.equal((await add(a.id, 'new')).person.slug, 'jordan-lee');
  const b = await applied('Kim Wait', 'kim@example.org');
  assert.equal((await add(b.id, 'new')).person.slug, 'kim-wait'); // (emails off: Kim's welcome waits)
  const had = await readState(env.DB, 'advisory-mail');
  await writeState(env.DB, 'advisory-mail', { ...had, welcomed: { 'jordan-lee': '2026-11-01T00:00:00.000Z' } });
  assert.ok(had.waiting?.['kim-wait']);
  for (const [from, to] of [['jordan-lee', 'jordan-lee-smith'], ['kim-wait', 'kim-waits']]) {
    const r = await rename(env, { collection: 'team', from, to }, 'linzi@soardcharity.com', async () => Response.json({ success: true }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.equal((await getAdvisoryApplication(env.DB, a.id)).personSlug, 'jordan-lee-smith');
  assert.equal((await getAdvisoryApplication(env.DB, b.id)).personSlug, 'kim-waits');
  assert.ok((await welcomedSlugs(env.DB))['jordan-lee-smith'], 'had theirs: never sent again');
  const log = await readState(env.DB, 'advisory-mail');
  assert.ok(log.waiting['kim-waits'] && !log.waiting['kim-wait'], 'waiting: still waiting, at their new address');
  assert.equal((await plan(a.id)).kind, 'joined');
});

test('a box opened before a namesake was added is never pressed into a second person: asked again', async () => {
  const work = await applied('Jordan Lee', 'jordan@work.example');
  const home = await applied('Jordan Lee', 'jordan@home.example', { why: 'From home.' });
  const box = await plan(work.id);
  assert.equal(box.kind, 'new');
  const seen = box.key;
  assert.equal((await add(home.id, 'new')).success, true, 'the other tab adds the home application');
  const stale = await add(work.id, 'new', seen);
  assert.equal(stale.success, false);
  assert.match(stale.error, /changed since the box opened/);
  assert.equal((await plan(work.id)).kind, 'choose', 'the box now asks the same-or-different question');
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'jordan-lee%'").first()).n, 1);
  assert.equal((await add(work.id, 'new', null)).success, false, 'a press that says nothing of the box is refused too');
});

test('a failure at the last steps never loses the welcome: it waits, and the heartbeat sends it once', async () => {
  const { writeState, readState } = await import('../functions/api/_board-roles.js');
  await writeState(env.DB, 'advisory', { emails: true });
  const app = await applied('Lia Last', 'lia@example.org');
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/DELETE FROM advisory_add_intents WHERE app_id/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  const r = await add(app.id, 'new');
  env.DB.prepare = real;
  assert.equal(r.success, true, 'a leftover note of the address is harmless: the press finishes');
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'joined');
  // (no sign-in here: the welcome waits, written down before Joined)
  assert.ok((await readState(env.DB, 'advisory-mail')).waiting?.['lia-last'], 'their welcome is waiting');
  // The welcome itself failing (its D1 write): still waiting, never lost, and the words say it goes again
  const app2 = await applied('Max Mail', 'max@example.org');
  env.DB.prepare = (sql) => (/json_set/.test(sql) && /welcomed/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  const mail = await import('../functions/api/_advisory-mail.js');
  const r2 = await add(app2.id, 'new');
  env.DB.prepare = real;
  assert.equal(r2.success, true);
  assert.ok((await readState(env.DB, 'advisory-mail')).waiting?.['max-mail']);
  assert.equal(typeof mail.sendWaitingWelcomes, 'function');
});

test('staff never read D1’s own words: a People save that fails, and an email save that fails, are said plainly', async () => {
  const app = await applied('Pat Plain', 'pat@example.org');
  const real = env.DB.prepare.bind(env.DB);
  let fail = /INSERT INTO team/;
  env.DB.prepare = (sql) => (fail && fail.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: Network connection lost.'); }, first: async () => { throw new Error('D1_ERROR: Network connection lost.'); } }) } : real(sql));
  const r = await add(app.id, 'new');
  assert.equal(r.success, false);
  assert.doesNotMatch(r.error, /D1_ERROR|Network connection/);
  fail = /INSERT OR REPLACE INTO reveal_board_emails/;
  const r2 = await add(app.id, 'new');
  env.DB.prepare = real;
  assert.equal(r2.success, false);
  assert.doesNotMatch(r2.error, /D1_ERROR|Network connection/);
  assert.match(r2.error, /stopped partway/);
  const r3 = await add(app.id, 'new');
  assert.equal(r3.success, true, r3.error);
  assert.equal(await emailOf('pat-plain'), 'pat@example.org');
});

test('a SOARD group inbox is never anyone’s sign-in email: added without it, and said', async () => {
  const app = await applied('Prank Person', 'advisory@soardcharity.com');
  const p = await plan(app.id);
  assert.deepEqual([p.kind, p.emailUsable, p.emailWhy], ['new', false, 'group']);
  const r = await add(app.id, 'new');
  assert.equal(r.success, true);
  assert.deepEqual([r.person.emailUnusable, r.person.emailWhy], ['advisory@soardcharity.com', 'group']);
  assert.equal(await emailOf('prank-person'), null);
  assert.equal(emailsSent.length, 0, 'no sign-in email to a group inbox');
});

test('an older In memoriam record (its name starts "In memoriam,", no status) is never made active', async () => {
  await person('old-mem', { name: 'In memoriam, Ola Mem', group: 'advisory', status: undefined }, 'ola@example.org');
  const app = await applied('Ola Mem', 'ola@example.org');
  const p = await plan(app.id);
  assert.deepEqual([p.kind, p.why, p.person.name], ['blocked', 'memorial', 'Ola Mem']);
  assert.equal((await add(app.id, 'same')).success, false);
  assert.equal((await rec('old-mem')).status, undefined);
});

test('names that might be one person are asked about (a title, a middle initial, Katie and Katherine), never taken as them', async () => {
  await person('jordan-lee', { name: 'Jordan Lee', group: 'advisory' }, 'jl@example.org');
  await person('katie-harrison', { name: 'Katie Harrison', group: 'advisory' }, 'kh@example.org');
  await person('kevin-harrison', { name: 'Kevin Harrison', group: 'board' }, 'kev@example.org');
  for (const [name, who] of [['Dr. Jordan Lee', 'jordan-lee'], ['Jordan A. Lee', 'jordan-lee'], ['Katherine Harrison', 'katie-harrison']]) {
    const app = await applied(name, `${slugify(name)}@example.org`);
    const p = await plan(app.id);
    assert.deepEqual([p.kind, p.person?.slug], ['choose', who], name);
  }
  const lee = await applied('Lee Jordan', 'leej@example.org');
  assert.equal((await plan(lee.id)).kind, 'new', 'the other way round is someone else');
  const kara = await applied('Kara Harrison', 'kara@example.org');
  assert.equal((await plan(kara.id)).kind, 'new', 'Kara isn’t Katie: someone new');
});
const slugify = (s) => s.toLowerCase().replace(/[^a-z]+/g, '');

test('the list: a Joined application whose person left, or was deleted, says Left and isn’t counted Joined', async () => {
  const a = await applied('Una Left', 'una@example.org');
  await add(a.id, 'new');
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...(await rec('una-left')), status: 'alumni' }), 'una-left').run();
  const b = await applied('Vic Stays', 'vic@example.org');
  await add(b.id, 'new');
  const list = (await (await adminApi.onRequestGet(ctx('GET'))).json()).applications;
  const by = Object.fromEntries(list.map((x) => [x.name, x]));
  assert.equal(by['Una Left'].left, true);
  assert.equal(by['Vic Stays'].left, undefined);
});

// ─── Round five ─────────────────────────────────────────────────────

test('two different people with one name, pressed at the same moment: one gets the address, the other is asked again, never merged', async () => {
  const a = await applied('Jordan Lee', 'jordan.a@example.org');
  const b = await applied('Jordan Lee', 'jordan.b@example.org', { why: 'Another Jordan.' });
  const [pa, pb] = [await plan(a.id), await plan(b.id)];
  assert.deepEqual([pa.kind, pa.slug, pb.kind, pb.slug], ['new', 'jordan-lee', 'new', 'jordan-lee']);
  const [ra, rb] = await Promise.all([add(a.id, 'new', pa.key), add(b.id, 'new', pb.key)]);
  const won = [ra, rb].filter((r) => r.success);
  assert.equal(won.length, 1);
  const loser = ra.success ? b : a;
  const p2 = await plan(loser.id);
  assert.equal(p2.kind, 'choose', 'the other is asked "Is this the same?"');
  const r2 = await add(loser.id, 'new');
  assert.equal(r2.success, true, r2.error);
  assert.equal(r2.person.slug, 'jordan-lee-2');
  assert.deepEqual([await emailOf('jordan-lee'), await emailOf('jordan-lee-2')].sort(), ['jordan.a@example.org', 'jordan.b@example.org']);
});

test('a read of People or private emails that fails stops the box and the press (never "nobody’s on People")', async () => {
  await person('sam-board', { name: 'Sam Board', group: 'board' }, 'sam@board.org');
  const app = await applied('Sam Boardman', 'sam@board.org');
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (sql === 'SELECT slug, email FROM reveal_board_emails' ? { bind: () => ({}), all: async () => { throw new Error('D1_ERROR: busy'); } } : real(sql));
  const res = await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${app.id}`));
  const j = await res.json();
  env.DB.prepare = real;
  assert.equal(j.success, false);
  assert.match(j.error, /didn’t answer just now/);
  assert.doesNotMatch(j.error, /D1_ERROR/);
  assert.equal((await plan(app.id)).kind, 'blocked', 'read again: the board member’s email, nobody added');
  assert.equal(await rec('sam-boardman'), null);
});

test('a box opened before the person was moved to alumni (or anything it says changed) is refused, and asked again', async () => {
  await person('ann-active', { name: 'Ann Active', group: 'advisory' }, 'ann@example.org');
  const app = await applied('Ann Active', 'ann@example.org');
  const box = await plan(app.id);
  assert.deepEqual([box.kind, box.person.status], ['same', 'active']);
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...(await rec('ann-active')), status: 'alumni' }), 'ann-active').run();
  const r = await add(app.id, 'same', box.key);
  assert.equal(r.success, false);
  assert.match(r.error, /changed since the box opened/);
  assert.equal((await rec('ann-active')).status, 'alumni', 'nobody brought back without the box saying so');
  const now = await plan(app.id);
  assert.equal(now.person.status, 'alumni');
  assert.notEqual(now.key, box.key);
});

test('a SOARD address signs in as staff, and another of someone’s addresses is theirs: neither is taken as a new member’s', async () => {
  const staff = await applied('Ina Info', 'info@soardcharity.com');
  const p = await plan(staff.id);
  assert.deepEqual([p.kind, p.emailUsable, p.emailWhy], ['new', false, 'staff']);
  const r = await add(staff.id, 'new');
  assert.equal(r.success, true);
  assert.equal(await emailOf('ina-info'), null);
  await person('peter-ranney', { name: 'Peter Ranney', group: 'board' }, 'peter@soardcharity.com');
  const alias = await applied('Pete R', 'peter@ranneyblair.com');
  const pa = await plan(alias.id);
  assert.deepEqual([pa.kind, pa.person?.slug], ['blocked', 'peter-ranney'], 'his other address is his: blocked, never half added');
});

test('added with no working email: their welcome waits for one, whatever the switch was, and goes once staff add it', async () => {
  const { writeState, readState } = await import('../functions/api/_board-roles.js');
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  await writeState(env.DB, 'advisory', { emails: true });
  const app = await applied('Noel Nomail', 'noel@example.org');
  await env.DB.prepare('UPDATE advisory_applications SET email = ? WHERE id = ?').bind('noel(home)@example.org', app.id).run();
  assert.equal((await add(app.id, 'new')).success, true);
  assert.ok((await readState(env.DB, 'advisory-mail')).waiting?.['noel-nomail'], 'waiting');
  await sendWaitingWelcomes(env);
  assert.ok((await readState(env.DB, 'advisory-mail')).waiting?.['noel-nomail'], 'still waiting after a heartbeat with the switch on (no email yet)');
});

test('staff read words, never D1’s, when a status, a note or the list can’t be saved or read', async () => {
  const app = await applied('Wes Words', 'wes@example.org');
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/advisory_applications/.test(sql) ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: Network connection lost.'); }, run: async () => { throw new Error('D1_ERROR: Network connection lost.'); }, all: async () => { throw new Error('D1_ERROR: Network connection lost.'); } }), all: async () => { throw new Error('D1_ERROR: Network connection lost.'); }, first: async () => { throw new Error('D1_ERROR: Network connection lost.'); }, run: async () => { throw new Error('D1_ERROR: Network connection lost.'); } } : real(sql));
  const said = [];
  for (const body of [{ status: { id: app.id, status: 'talking' } }, { note: { id: app.id, text: 'Hi' } }, { add: { id: app.id, as: 'new', seen: 'x' } }]) {
    said.push((await (await adminApi.onRequestPost(ctx('POST', body))).json()).error);
  }
  said.push((await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${app.id}`))).json()).error);
  env.DB.prepare = real;
  for (const s of said) { assert.doesNotMatch(String(s), /D1_ERROR|HTTP 500/); assert.ok(s, 'said in words'); }
});

// ─── Round six ──────────────────────────────────────────────────────

test('the box says the emails switch as it is now: turned on or off since the page loaded, the old box is refused', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const app = await applied('Ana Gomez', 'ana@example.org');
  const off = await plan(app.id);
  assert.equal(off.emailsOn, false);
  await writeState(env.DB, 'advisory', { emails: true });
  const on = await plan(app.id);
  assert.equal(on.emailsOn, true);
  assert.notEqual(on.key, off.key);
  const stale = await add(app.id, 'new', off.key);
  assert.equal(stale.success, false, 'a box that said "once emails are on" is never pressed into an email now');
  assert.equal(stale.error, 'Advisory Board emails were turned on since the box opened. Look at the box again before pressing: it says what’s emailed now.');
});

test('a newer headshot sent since the box opened makes the box out of date: asked again, never a different photo than it showed', async () => {
  const app = await applied('Nia Photo', 'nia@example.org');
  const box = await plan(app.id);
  await env.DB.prepare('UPDATE advisory_applications SET headshot = ? WHERE id = ?').bind(JSON.stringify({ id: 'advisory-applications/x/y', url: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/advisory-applications/x/y/public', width: 700, height: 700 }), app.id).run();
  const r = await add(app.id, 'new', box.key);
  assert.equal(r.success, false);
  assert.equal(r.error, 'They sent a newer headshot since the box opened. Look at the box again before pressing: it shows the one that’s used.');
});

test('had their welcome means at the address they have now: someone new at a deleted person’s web address gets their own; the same person put back doesn’t get it twice', async () => {
  const { writeState, readState } = await import('../functions/api/_board-roles.js');
  const { sendWelcome, welcomedSlugs } = await import('../functions/api/_advisory-mail.js');
  await writeState(env.DB, 'advisory', { emails: true });
  await person('ana-gomez', { name: 'Ana Gomez', group: 'advisory' }, 'ana@x.org');
  assert.equal((await sendWelcome(env, { slugs: ['ana-gomez'] })).sent, 1);
  assert.deepEqual((await readState(env.DB, 'advisory-mail')).welcomed['ana-gomez'].to, 'ana@x.org');
  // Put back with her own address: had it
  assert.equal((await sendWelcome(env, { slugs: ['ana-gomez'] })).sent, 0);
  // Someone else given her web address by hand, with their own email: theirs goes
  await env.DB.prepare('UPDATE reveal_board_emails SET email = ? WHERE slug = ?').bind('ana2@y.org', 'ana-gomez').run();
  assert.equal((await welcomedSlugs(env.DB))['ana-gomez'], undefined, 'not "had it" for the new address');
  assert.equal((await sendWelcome(env, { slugs: ['ana-gomez'] })).sent, 1);
  assert.deepEqual(emailsSent.map((e) => e.to[0]), ['ana@x.org', 'ana2@y.org']);
  // An older record (the time alone) still counts as had
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'ana-gomez': '2026-11-01T00:00:00.000Z' } });
  assert.equal((await sendWelcome(env, { slugs: ['ana-gomez'] })).sent, 0);
});

test('the welcome greets them as their application does ("Kate", "Katie"), even after that application is deleted while it waits', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  const app = await applied('Katherine Smith', 'kate@example.org', { preferredName: 'Kate' });
  assert.equal((await add(app.id, 'new')).success, true); // (emails off: it waits, with her name)
  await env.DB.prepare('DELETE FROM advisory_applications WHERE id = ?').bind(app.id).run();
  await writeState(env.DB, 'advisory', { emails: true });
  // (the sign-in list as Access would have it: this test has no Access, so the welcome's own send is used)
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  const { readState } = await import('../functions/api/_board-roles.js');
  const waiting = (await readState(env.DB, 'advisory-mail')).waiting['katherine-smith'];
  assert.equal(waiting.greet, 'Kate');
  assert.equal((await sendWelcome(env, { slugs: ['katherine-smith'], greet: { 'katherine-smith': waiting.greet } })).sent, 1);
  assert.match(emailsSent.at(-1).text, /^Hi Kate,/);
  assert.equal(typeof sendWaitingWelcomes, 'function');
  // Linked as the same person by a near name: their own first name
  await person('katherine-jones', { name: 'Katherine Jones', group: 'advisory' }, 'kj@example.org');
  const katie = await applied('Katie Jones', 'katie.j@example.org');
  assert.equal((await plan(katie.id)).kind, 'choose');
  const r = await add(katie.id, 'same');
  assert.equal(r.success, true, r.error);
  // (no sign-in here, so it waits: with the name her application gave)
  assert.equal((await readState(env.DB, 'advisory-mail')).waiting['katherine-jones'].greet, 'Katie');
});

test('a status changed from a panel opened before another tab changed it: refused, and the application as it is now comes back', async () => {
  const app = await applied('Gus Hale', 'gus@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  const r = await (await adminApi.onRequestPost(ctx('POST', { status: { id: app.id, status: 'talking', from: 'new' } }))).json();
  assert.equal(r.success, false);
  assert.match(r.error, /changed since the panel opened/);
  assert.equal(r.application.status, 'joined');
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'joined');
});

test('a hold that fails partway lets go of what it took (presses aren’t blocked for minutes)', async () => {
  const app = await applied('Holly Hold', 'holly@example.org');
  const real = env.DB.prepare.bind(env.DB);
  let n = 0;
  env.DB.prepare = (sql) => (/INSERT OR IGNORE INTO advisory_add_holds/.test(sql) && ++n === 2 ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  const r = await add(app.id, 'new');
  env.DB.prepare = real;
  assert.equal(r.success, false);
  assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM advisory_add_holds').first()).n, 0, 'nothing left held');
  assert.equal((await add(app.id, 'new')).success, true, 'the next press works at once');
});

test('the admin’s own save: a database that doesn’t answer the read is said in words, never "renamed or deleted"', async () => {
  const { onRequestPost: saveContent } = await import('../functions/api/save-content.js');
  await person('rita-read', { name: 'Rita Read', group: 'advisory' });
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (sql === 'SELECT data FROM team WHERE slug = ?' ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: Network connection lost.'); } }) } : real(sql));
  const res = await saveContent({ env, request: new Request('https://admin.internal/api/save-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'src/content/team/rita-read.json', content: JSON.stringify({ name: 'Rita Read', group: 'advisory' }), message: 'x', sha: 'abc' }) }), data: { userEmail: 'x@soardcharity.com' }, waitUntil: () => {} });
  env.DB.prepare = real;
  const j = await res.json();
  assert.equal(res.status, 503);
  assert.match(j.error, /database didn’t answer just now, so nothing was saved/);
});

test('a note longer than notes take is refused in words (never cut mid-word)', async () => {
  const app = await applied('Nate Note', 'nate@example.org');
  const r = await (await adminApi.onRequestPost(ctx('POST', { note: { id: app.id, text: 'Call '.repeat(900) } }))).json();
  assert.equal(r.success, false);
  assert.match(r.error, /Notes take up to 4,000/);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).notes.length, 0);
});

test('an application marked Not now in another tab after the box opened: the press is refused and says so, and nothing is added (a note added meanwhile changes nothing)', async () => {
  const app = await applied('Nora Quinn', 'nora@example.org');
  const box = await plan(app.id);
  const st = await (await adminApi.onRequestPost(ctx('POST', { status: { id: app.id, status: 'not-now', from: 'new' } }))).json();
  assert.equal(st.success, true, st.error);
  const r = await add(app.id, 'new', box.key);
  assert.equal(r.success, false, 'a box opened before it was marked Not now is never pressed into adding them');
  assert.match(r.error, /^This application was marked Not now by .+ since the box opened\. Look at the box again before pressing\.$/);
  assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM team').first()).n, 0);
  assert.equal(emailsSent.length, 0);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'not-now');
  // A box opened now (it knows): that press goes. A note added after it opened doesn't make it out of date
  const now = await plan(app.id);
  assert.equal((await adminApi.onRequestPost(ctx('POST', { note: { id: app.id, text: 'Called them back.' } }))).status, 200);
  const ok = await add(app.id, 'new', now.key);
  assert.equal(ok.success, true, ok.error);
});

test('the box’s welcome line is about the address they’ll sign in with: welcomed at an old one, that email cleared, applying with a new one, the box says it emails the new one', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  await writeState(env.DB, 'advisory', { emails: true });
  await person('iris-lane', { name: 'Iris Lane', group: 'advisory' }, 'iris.old@example.org');
  assert.equal((await sendWelcome(env, { slugs: ['iris-lane'] })).sent, 1);
  await env.DB.prepare('DELETE FROM reveal_board_emails WHERE slug = ?').bind('iris-lane').run();
  const fresh = await applied('Iris Lane', 'iris.new@example.org');
  const p = await plan(fresh.id);
  assert.equal(p.kind, 'choose');
  assert.equal(p.person.email, '');
  assert.equal(p.person.welcomed, false, 'iris.new@ hasn’t had it, so the box says it emails her (as the press then does)');
  // Her old address again: had it there, so the box never says it emails her
  const same = await applied('Iris Lane', 'iris.old@example.org', { why: 'Again.' });
  assert.equal((await plan(same.id)).person.welcomed, true);
});

test('while another press is adding them, the box says so and waits (never what’s true halfway); a welcome on its way counts as theirs', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const app = await applied('Taylor Bay', 'taylor@example.org');
  assert.equal((await plan(app.id)).busy, false);
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind('email:taylor@example.org', Date.now()).run();
  assert.equal((await plan(app.id)).busy, true, 'their email held by another press');
  await env.DB.prepare('UPDATE advisory_add_holds SET at = ?').bind(Date.now() - 3 * 60 * 1000).run();
  assert.equal((await plan(app.id)).busy, false, 'a hold from a press that died long ago never makes it wait');
  await env.DB.prepare('DELETE FROM advisory_add_holds').run();
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind(`app:${app.id}`, Date.now()).run();
  assert.equal((await plan(app.id)).busy, true, 'the application held');
  await env.DB.prepare('DELETE FROM advisory_add_holds').run();
  // Their welcome being sent this minute (by the other press): the box never says it emails them again
  await person('taylor-bay', { name: 'Taylor Bay', group: 'advisory' }, 'taylor@example.org');
  await writeState(env.DB, 'advisory-mail', { welcomed: { 'taylor-bay': { sending: new Date().toISOString() } } });
  const p = await plan(app.id);
  assert.equal(p.kind, 'same');
  assert.equal(p.person.welcomed, true);
});

test('a first initial, and a name in any alphabet, is asked about, never added as someone new without a word', async () => {
  await person('jordan-ames', { name: 'Jordan Ames', group: 'advisory' }, 'jordan@ames.org');
  for (const [n, e] of [['J. Ames', 'j1@x.org'], ['J Ames', 'j2@x.org']]) {
    const p = await plan((await applied(n, e)).id);
    assert.equal(p.kind, 'choose', n);
    assert.equal(p.person.slug, 'jordan-ames', n);
  }
  assert.equal((await plan((await applied('K. Ames', 'k1@x.org')).id)).kind, 'new', 'another initial isn’t them');
  assert.equal((await plan((await applied('Jordan A. Ames', 'j3@x.org')).id)).kind, 'choose', 'a middle initial still doesn’t count');
  await person('advisory-board-member', { name: '王小明', group: 'advisory' }, 'wang@x.org');
  await person('advisory-board-member-2', { name: 'Владимир Петров', group: 'advisory' }, 'vlad@x.org');
  await person('advisory-board-member-3', { name: '김민준', group: 'advisory' }, 'kim@x.org');
  for (const [n, slug] of [['王小明', 'advisory-board-member'], ['Владимир Петров', 'advisory-board-member-2'], ['김민준', 'advisory-board-member-3']]) {
    const p = await plan((await applied(n, `${slug}.new@x.org`)).id);
    assert.equal(p.kind, 'choose', n);
    assert.equal(p.person.slug, slug, n);
  }
  // Different names in the same alphabet are different people
  assert.equal((await plan((await applied('李小龙', 'li@x.org')).id)).kind, 'new');
  assert.equal((await plan((await applied('Иван Петров', 'ivan@x.org')).id)).kind, 'new');
});

test('the panel knows whether the person it’s linked to has a sign-in email, so the leaving box says only what’s so', async () => {
  const app = await applied('Gail Moss', 'gail@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  const linked = async () => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${app.id}`))).json()).application.person;
  assert.equal((await linked()).hasEmail, true);
  await env.DB.prepare('DELETE FROM reveal_board_emails WHERE slug = ?').bind('gail-moss').run();
  assert.equal((await linked()).hasEmail, false);
});

test('an email on file that can’t sign them in as themselves (a SOARD address): the box says so, Add never emails it how to sign in, and the welcome goes once their own is on People', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  await writeState(env.DB, 'advisory', { emails: true });
  await person('sal-staff', { name: 'Sal Staff', group: 'advisory' }, 'sal@soardcharity.com');
  const app = await applied('Sal Staff', 'sal@soardcharity.com');
  const p = await plan(app.id);
  assert.equal(p.kind, 'same');
  assert.equal(p.person.email, 'sal@soardcharity.com');
  assert.equal(p.person.emailOk, false);
  assert.equal(p.person.emailWhy, 'staff');
  const r = await add(app.id, 'same');
  assert.equal(r.success, true, r.error);
  assert.deepEqual(r.person.emailOnFile, { email: 'sal@soardcharity.com', why: 'staff' });
  assert.equal(r.person.emailUnusable, '', 'never "it wasn’t saved, add their own" for the address already theirs');
  assert.equal(r.welcome.noEmail, true);
  assert.equal(emailsSent.filter((e) => /page is ready/.test(e.subject)).length, 0, 'no "Your Advisory Board page is ready" to a staff sign-in');
  assert.equal((await sendWelcome(env, { slugs: ['sal-staff'] })).sent, 0, 'nor later');
  // Their own email put on People: their welcome goes, once
  await env.DB.prepare('UPDATE reveal_board_emails SET email = ? WHERE slug = ?').bind('sal@gmail.example', 'sal-staff').run();
  assert.equal((await sendWelcome(env, { slugs: ['sal-staff'] })).sent, 1);
  assert.deepEqual(emailsSent.filter((e) => /page is ready/.test(e.subject)).map((e) => e.to[0]), ['sal@gmail.example']);
});

test('an application from a group inbox, linked to the same person with their own email on file: theirs is kept, and nothing says to add one', async () => {
  await person('gil-group', { name: 'Gil Group', group: 'advisory' }, 'gil@own.example');
  const app = await applied('Gil Group', 'advisory@soardcharity.com');
  const p = await plan(app.id);
  assert.equal(p.kind, 'choose');
  assert.equal(p.emailUsable, false);
  assert.equal(p.person.emailOk, undefined, 'their own on file signs them in');
  const r = await add(app.id, 'same');
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.emailKept, true);
  assert.equal(r.person.email, 'gil@own.example');
  assert.equal(r.person.emailUnusable, '');
  assert.equal(r.person.emailOnFile, undefined);
});

test('a box opened before the application was deleted (another tab): the press says so, in the words used everywhere', async () => {
  const app = await applied('Del Gone', 'del@example.org');
  const box = await plan(app.id);
  await env.DB.prepare('DELETE FROM advisory_applications WHERE id = ?').bind(app.id).run();
  const r = await (await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: box.key } }))).json();
  assert.equal(r.success, false);
  assert.equal(r.error, 'This application isn’t here any more: it was deleted, maybe in another tab.');
});

test('letters after a name (CPA, PhD, M.D., Esq.) are never taken as the last name: asked about when it’s them, never when it isn’t', async () => {
  await person('dana-price', { name: 'Dana Price', group: 'advisory' }, 'dana.work@x.org');
  for (const [n, e] of [['Dana Price, CPA', 'd1@x.org'], ['Dana Price PhD', 'd2@x.org'], ['Dana Price, M.D.', 'd3@x.org'], ['Dana Price Esq.', 'd4@x.org']]) {
    const p = await plan((await applied(n, e)).id);
    assert.equal(p.kind, 'choose', n);
    assert.equal(p.person.slug, 'dana-price', n);
  }
  await person('jordan-smith', { name: 'Jordan Smith, CPA', group: 'advisory' }, 'js@x.org');
  assert.equal((await plan((await applied('Jordan Jones, CPA', 'jj@x.org')).id)).kind, 'new', 'two different last names with the same letters after');
  await person('pat-lee', { name: 'Pat Lee PhD', group: 'advisory' }, 'pl@x.org');
  assert.equal((await plan((await applied('Patricia Moore PhD', 'pm@x.org')).id)).kind, 'new');
  // Family names that look like letters after a name stay names: Minh Do is never Minh Ra
  await person('minh-ra', { name: 'Minh Ra', group: 'advisory' }, 'mr@x.org');
  assert.equal((await plan((await applied('Minh Do', 'md@x.org')).id)).kind, 'new');
  // A first initial before the name they go by, and a name written with or without a space
  await person('scott-fitzgerald', { name: 'Scott Fitzgerald', group: 'advisory' }, 'sf@x.org');
  assert.equal((await plan((await applied('F. Scott Fitzgerald', 'fsf@x.org')).id)).person?.slug, 'scott-fitzgerald');
  await person('yamada', { name: '山田太郎', group: 'advisory' }, 'yt@x.org');
  assert.equal((await plan((await applied('山田 太郎', 'yt2@x.org')).id)).person?.slug, 'yamada');
});

test('an initial two members share: the box names both, and staff can say it’s either (linked to that one), or someone new', async () => {
  await person('jordan-ames', { name: 'Jordan Ames', group: 'advisory' }, 'jordan@x.org');
  await person('jamie-ames', { name: 'Jamie Ames', group: 'advisory' }, 'jamie@x.org');
  const app = await applied('J. Ames', 'j.ames@x.org');
  const p = await plan(app.id);
  assert.equal(p.kind, 'choose');
  assert.deepEqual([p.person.slug, ...(p.others || []).map((o) => o.slug)].sort(), ['jamie-ames', 'jordan-ames']);
  const other = [p.person, ...p.others].find((x) => x.slug === 'jamie-ames');
  const r = await (await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'same', to: other.slug, seen: p.key } }))).json();
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.slug, 'jamie-ames');
  assert.equal(r.application.personSlug, 'jamie-ames');
  assert.equal(await emailOf('jamie-ames'), 'jamie@x.org', 'their own email kept');
  // Someone not named in the box is never linked by asking for them
  const again = await applied('J. Ames', 'j.ames2@x.org');
  const q = await plan(again.id);
  const no = await (await adminApi.onRequestPost(ctx('POST', { add: { id: again.id, as: 'same', to: 'dana-price', seen: q.key } }))).json();
  assert.equal(no.success, false);
  assert.match(no.error, /changed since the box opened/);
});

test('the leaving box’s flags: an email on file that signs in as staff is no sign-in, said as that', async () => {
  const app = await applied('Hal Staff', 'hal@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  await env.DB.prepare('UPDATE reveal_board_emails SET email = ? WHERE slug = ?').bind('hal@soardcharity.com', 'hal-staff').run();
  const person = (await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${app.id}`))).json()).application.person;
  assert.equal(person.hasEmail, false);
  assert.equal(person.emailWhy, 'staff');
});

// ─── Round nine ─────────────────────────────────────────────────────

const GONE = 'This application isn’t here any more: it was deleted, maybe in another tab.';
// A press held at the first statement matching `re` until opened: what a slow database does while someone else acts
const gate = (re) => {
  const real = env.DB.prepare.bind(env.DB);
  let open;
  const opened = new Promise((r) => { open = r; });
  let hit;
  const reached = new Promise((r) => { hit = r; });
  let armed = true;
  env.DB.prepare = (sql) => {
    const st = real(sql);
    if (!armed || !re.test(sql)) return st;
    armed = false;
    const wait = (b, m) => async (...a) => { hit(); await opened; return b[m](...a); };
    return { bind: (...p) => { const b = st.bind(...p); return { run: wait(b, 'run'), first: wait(b, 'first'), all: wait(b, 'all') }; } };
  };
  return { reached, open: () => { env.DB.prepare = real; open(); } };
};
const welcomesTo = () => emailsSent.filter((e) => /page is ready/.test(e.subject)).map((e) => [e.to].flat().join(','));

test('an application isn’t deleted while a press is adding from it (refused in words), and a press that comes while it’s deleting is told so', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  await writeState(env.DB, 'advisory', { emails: true });
  const f = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => (init.method === 'DELETE' ? Response.json({ success: true, result: {} }) : f(input, init));
  const app = await applied('Del Midway', 'del.mid@example.org');
  const g = gate(/UPDATE advisory_applications SET person_slug/);
  const pressing = add(app.id, 'new');
  await g.reached;
  const del = await (await adminApi.onRequestPost(ctx('POST', { remove: { id: app.id } }))).json();
  assert.equal(del.success, false);
  assert.equal(del.error, 'Someone is adding Del Midway to the Advisory Board right now, so the application wasn’t deleted. Look again in a moment.');
  g.open();
  const r = await pressing;
  assert.equal(r.success, true, r.error);
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).status, 'joined', 'added, and its application still here saying so');
  // A press that comes while a delete holds it: told it's being deleted (never "gone" before it is: a delete can fail),
  // never "someone is adding them"
  const two = await applied('Del Second', 'del.two@example.org');
  const box = await plan(two.id);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind(`app:${two.id}`, now, `del:${two.id}`, now).run();
  const res = await adminApi.onRequestPost(ctx('POST', { add: { id: two.id, as: 'new', seen: box.key } }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'This application is being deleted right now, in another tab or by someone else, so nobody was added. Look again in a moment.');
  // and its box, opened meanwhile, says that too, never "someone is adding"
  const meanwhile = await plan(two.id);
  assert.deepEqual([meanwhile.busy, meanwhile.busyDeleting], [true, true]);
  // a second delete meanwhile: told it's being deleted, never that someone's adding them
  const again = await (await adminApi.onRequestPost(ctx('POST', { remove: { id: two.id } }))).json();
  assert.equal(again.error, 'This application is being deleted right now, in another tab or by someone else. Look again in a moment.');
  await env.DB.prepare('DELETE FROM advisory_add_holds').run();
  // Deleted with nothing adding: it goes, and so does the address a press that stopped partway wrote down for it
  await env.DB.prepare('INSERT OR REPLACE INTO advisory_add_intents (app_id, slug, at) VALUES (?, ?, ?)').bind(two.id, 'del-second', now).run();
  assert.equal((await (await adminApi.onRequestPost(ctx('POST', { remove: { id: two.id } }))).json()).success, true);
  assert.equal(await getAdvisoryApplication(env.DB, two.id), null);
  assert.equal(await env.DB.prepare('SELECT slug FROM advisory_add_intents WHERE app_id = ?').bind(two.id).first(), null);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_add_holds').first()).n, 0, 'nothing left held');
});

test('two applications for one person on People, pressed at once: one press adds them (one email saved, one welcome), the other waits its turn, then keeps what’s there', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  await writeState(env.DB, 'advisory', { emails: true });
  await person('jo-ames', { name: 'Jo Ames', group: 'advisory', photo: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/team/jo/public' });
  const work = await applied('Jo Ames', 'jo.work@example.org');
  const home = await applied('Jo Ames', 'jo.home@example.org', { why: 'Again.' });
  const [pw, ph] = [await plan(work.id), await plan(home.id)];
  assert.deepEqual([pw.kind, ph.kind, pw.person.slug, ph.person.slug], ['choose', 'choose', 'jo-ames', 'jo-ames']);
  const g = gate(/INSERT OR REPLACE INTO reveal_board_emails/);
  const first = add(work.id, 'same', pw.key);
  await g.reached;
  // The other application's box, opened now: it waits, and says who's being added, from another application
  const waiting = await plan(home.id);
  assert.deepEqual([waiting.busy, waiting.busyOther, waiting.busyName], [true, true, 'Jo Ames']);
  const second = await add(home.id, 'same', ph.key);
  assert.equal(second.success, false);
  assert.equal(second.error, 'Someone is adding Jo Ames right now, from another application. Give it a moment, then look at the box again.');
  // (while it holds them, this application's own box isn't "another application")
  assert.equal((await plan(work.id)).busyOther, false);
  g.open();
  const r = await first;
  assert.equal(r.success, true, r.error);
  assert.equal(await emailOf('jo-ames'), 'jo.work@example.org');
  // The second box opened before: out of date (their email is on file now). Asked again, it keeps that one
  const stale = await add(home.id, 'same', ph.key);
  assert.equal(stale.success, false);
  assert.match(stale.error, /changed since the box opened/);
  const again = await plan(home.id);
  assert.equal(again.person.email, 'jo.work@example.org');
  const r2 = await add(home.id, 'same', again.key);
  assert.equal(r2.success, true, r2.error);
  assert.equal(r2.person.email, 'jo.work@example.org');
  assert.equal(await emailOf('jo-ames'), 'jo.work@example.org', 'kept, never replaced by the second application’s');
  assert.ok(welcomesTo().every((to) => to === 'jo.work@example.org') && welcomesTo().length <= 1, `one welcome at most, to the email they sign in with (${welcomesTo()})`);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM team').first()).n, 1, 'one person');
});

test('a press is never refused for what its box doesn’t say: a newer headshot for someone keeping their own photo, the switch for someone already welcomed', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  await writeState(env.DB, 'advisory', { emails: true });
  const own = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/team/kim/public';
  await person('kim-kept', { name: 'Kim Kept', group: 'advisory', photo: own }, 'kim@example.org');
  assert.equal((await sendWelcome(env, { slugs: ['kim-kept'] })).sent, 1);
  const app = await applied('Kim Kept', 'kim@example.org');
  const box = await plan(app.id);
  assert.deepEqual([box.kind, box.person.hasPhoto, box.person.welcomed], ['same', true, true]);
  const newer = JSON.stringify({ id: 'advisory-applications/x/y', url: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/advisory-applications/x/y/public', width: 700, height: 700 });
  await env.DB.prepare('UPDATE advisory_applications SET headshot = ? WHERE id = ?').bind(newer, app.id).run();
  await writeState(env.DB, 'advisory', { emails: false });
  assert.equal((await plan(app.id)).key, box.key, 'the box would say the same words');
  const r = await add(app.id, 'same', box.key);
  assert.equal(r.success, true, r.error);
  assert.equal((await rec('kim-kept')).photo, own, 'their own photo kept');
  // The same person with no photo: the box says the headshot becomes it, so a newer one makes it out of date
  await person('nan-nophoto', { name: 'Nan Nophoto', group: 'advisory' }, 'nan@example.org');
  const a2 = await applied('Nan Nophoto', 'nan@example.org');
  const b2 = await plan(a2.id);
  await env.DB.prepare('UPDATE advisory_applications SET headshot = ? WHERE id = ?').bind(newer, a2.id).run();
  assert.equal((await add(a2.id, 'same', b2.key)).error, 'They sent a newer headshot since the box opened. Look at the box again before pressing: it shows the one that’s used.');
  // And one whose welcome is still to go: the box says when it goes, so the switch makes it out of date
  const b3 = await plan(a2.id);
  assert.equal(b3.person.welcomed, false);
  await writeState(env.DB, 'advisory', { emails: true });
  assert.equal((await add(a2.id, 'same', b3.key)).error, 'Advisory Board emails were turned on since the box opened. Look at the box again before pressing: it says what’s emailed now.');
});

test('added in another tab since the box opened: the press says so, and nothing more is done', async () => {
  const app = await applied('Two Tabs', 'two.tabs@example.org');
  const [a, b] = [await plan(app.id), await plan(app.id)];
  assert.equal((await add(app.id, 'new', a.key)).success, true);
  const r = await add(app.id, 'new', b.key);
  assert.equal(r.success, false);
  assert.equal(r.error, 'Two Tabs was added to the Advisory Board by linzi@soardcharity.com since the box opened, so nothing more was done.');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM team WHERE name = 'Two Tabs'").first()).n, 1);
});

test('names, round nine: family names that are also letters (Mba, Ma, Do) stay names unless written as letters; more letters after a name; Hon and Gen are names without their dot; last name first', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)];
  await person('chioma-mba', { name: 'Chioma Mba', group: 'advisory' }, 'cm@x.org');
  await person('leonard-mba', { name: 'Leonard Mba', group: 'advisory' }, 'lm@x.org');
  for (const [n, e, slug] of [['Chi Mba', 'c1@x.org', 'chioma-mba'], ['C. Mba', 'c2@x.org', 'chioma-mba'], ['Leon Mba', 'c3@x.org', 'leonard-mba'], ['CHIOMA MBA', 'c4@x.org', 'chioma-mba']]) {
    const p = await plan((await applied(n, e)).id);
    assert.equal(p.kind, 'choose', n);
    assert.ok(among(p).includes(slug), `${n}: ${among(p)}`);
  }
  await person('dana-price', { name: 'Dana Price', group: 'advisory' }, 'dana.work@x.org');
  const letters = ['Dana Price, PE', 'Dana Price, MA', 'Dana Price, MS', 'Dana Price, CCIM', 'Dana Price, CPA, CGMA', 'Dana Price MBA', 'Dana Price M.B.A.', 'Dana Price, Ph.D.'];
  for (const [k, n] of letters.entries()) {
    const p = await plan((await applied(n, `dp${k}@x.org`)).id);
    assert.deepEqual([p.kind, p.person?.slug], ['choose', 'dana-price'], n);
  }
  // A last name that's also letters: hers, never dropped
  assert.equal((await plan((await applied('Dana Ma', 'dm@x.org')).id)).kind, 'new');
  await person('jack-ma', { name: 'Jack Ma', group: 'advisory' }, 'jm@x.org');
  for (const [n, e] of [['Jack Ma', 'jm1@x.org'], ['Jack MA', 'jm2@x.org'], ['JACK MA', 'jm3@x.org']]) assert.deepEqual(among(await plan((await applied(n, e)).id)), ['jack-ma'], n);
  // Hon and Gen: first names too, titles only with their dot
  await person('hon-lam', { name: 'Hon Lam', group: 'advisory' }, 'hl@x.org');
  const gen = await plan((await applied('Gen Lam', 'gl@x.org')).id);
  assert.deepEqual([gen.kind, gen.namesake], ['new', undefined], 'Gen Lam is never asked about Hon Lam');
  assert.deepEqual(among(await plan((await applied('Hon. Hon Lam', 'hl2@x.org')).id)), ['hon-lam']);
  // (r20: "Hon" and "Gen" without their stop are names too, as before, but not on the given-names list: no name)
  assert.equal(greetName({ fullName: 'Hon Lam Wong' }), '');
  assert.equal(greetName({ fullName: 'Gen Tanaka' }), '');
  assert.equal(greetName({ fullName: 'Hon. Jordan Smith' }), 'Jordan');
  // Last name first, with a comma
  await person('jordan-ames', { name: 'Jordan Ames', group: 'advisory' }, 'ja@x.org');
  assert.deepEqual(among(await plan((await applied('Ames, Jordan', 'aj@x.org')).id)), ['jordan-ames']);
  assert.deepEqual(among(await plan((await applied('Ames, Jordan, PhD', 'aj2@x.org')).id)), ['jordan-ames']);
  // Minh Do, still never Minh Ra
  await person('minh-ra', { name: 'Minh Ra', group: 'advisory' }, 'mr@x.org');
  assert.equal((await plan((await applied('Minh Do', 'mdo@x.org')).id)).kind, 'new');
  // Letters no accent comes off, written without them: Strauß is Strauss, Søren is Soren, Łukasz is Lukasz
  await person('anna-strauss', { name: 'Anna Strauß', group: 'advisory' }, 'as@x.org');
  await person('soren-lund', { name: 'Søren Lund', group: 'advisory' }, 'sl@x.org');
  await person('lukasz-nowak', { name: 'Łukasz Nowak', group: 'advisory' }, 'ln@x.org');
  for (const [n, e, slug] of [['Anna Strauss', 'as2@x.org', 'anna-strauss'], ['Soren Lund', 'sl2@x.org', 'soren-lund'], ['Lukasz Nowak', 'ln2@x.org', 'lukasz-nowak']]) {
    assert.deepEqual(among(await plan((await applied(n, e)).id)), [slug], n);
  }
});

// ─── Round ten ──────────────────────────────────────────────────────

test('written last name first ("Ames, Jordan"): added as Jordan Ames at jordan-ames; their copy and their welcome greet them alike, by no name (r20: a comma)', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  const { greetName } = await import('../functions/api/_advisory-form.js');
  await writeState(env.DB, 'advisory', { emails: true });
  const app = await applied('Ames, Jordan', 'ames.jordan@example.org');
  const box = await plan(app.id);
  assert.deepEqual([box.kind, box.asName, box.slug], ['new', 'Jordan Ames', 'jordan-ames']);
  const r = await add(app.id, 'new', box.key);
  assert.equal(r.success, true, r.error);
  assert.equal((await rec('jordan-ames')).name, 'Jordan Ames');
  await sendWelcome(env, { slugs: ['jordan-ames'] });
  const welcome = emailsSent.find((e) => /page is ready/.test(e.subject));
  // (r20: the welcome greets as the copy does: a comma, so "Hello,", never "Hi Jordan," read from People's "Jordan Ames")
  assert.match(String(welcome?.text || ''), /^Hello,/);
  for (const [n, g] of [['De La Cruz, Maria', ''], ['AMES, JORDAN', ''] /* r20: a comma: no name */, ['Price, Dana, MBA', ''] /* r20: a comma: no name */, ['Dr. Ames, Jordan', ''] /* r20: a comma: no name */, ['The Honorable Jordan Ames', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['Mrs. Lee', ''] /* r20: a title and a family name is no given name: no name */]) {
    assert.equal(greetName({ fullName: n }), g, n);
  }
});

test('one person’s second application while the first is being added (their record not made yet): its box waits, its press is refused, then it asks whether it’s them', async () => {
  const a1 = await applied('Jo Window', 'jo.work@example.org');
  const a2 = await applied('Jo Window', 'jo.home@example.org', { why: 'Again.' });
  const [p1, p2] = [await plan(a1.id), await plan(a2.id)];
  assert.deepEqual([p1.kind, p2.kind], ['new', 'new']);
  // (held where the first press reads the record it's making: its address written down, the record not there yet)
  const g = gate(/^SELECT data FROM team WHERE slug = \?$/);
  const first = add(a1.id, 'new', p1.key);
  await g.reached;
  const waiting = await plan(a2.id);
  assert.deepEqual([waiting.busy, waiting.busyOther], [true, true], 'the other application’s box waits');
  const second = await add(a2.id, 'new', p2.key);
  assert.equal(second.success, false);
  assert.equal(second.error, 'Someone is adding a person with this name right now. Give it a moment, then look at the box again.');
  g.open();
  assert.equal((await first).success, true);
  const after = await plan(a2.id);
  assert.deepEqual([after.kind, after.person?.slug], ['choose', 'jo-window'], 'then it asks whether it’s them');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM team').first()).n, 1, 'one person');
});

test('names with no letters a to z: one being added never makes another’s box wait, nor its press out of date', async () => {
  const wang = await applied('王小明', 'wang@example.org');
  const vlad = await applied('Владимир Петров', 'vlad@example.org');
  const vbox = await plan(vlad.id);
  const g = gate(/^SELECT data FROM team WHERE slug = \?$/);
  const adding = add(wang.id, 'new');
  await g.reached;
  assert.equal((await plan(vlad.id)).busy, false, 'someone else being added: nothing to wait for');
  g.open();
  const w = await adding;
  assert.equal(w.success, true, w.error);
  const r = await add(vlad.id, 'new', vbox.key);
  assert.equal(r.success, true, r.error);
  assert.notEqual(r.person.slug, w.person.slug);
});

test('a delete that fails leaves the application as it was, its press said "being deleted" meanwhile (never "gone"), and nothing held after', async () => {
  const app = await applied('Dee Fails', 'dee.fails@example.org');
  const box = await plan(app.id);
  const f = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => (init.method === 'DELETE' ? new Response('no', { status: 500 }) : f(input, init));
  const del = await (await adminApi.onRequestPost(ctx('POST', { remove: { id: app.id } }))).json();
  assert.equal(del.success, false);
  assert.ok(await getAdvisoryApplication(env.DB, app.id), 'still here');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_add_holds').first()).n, 0, 'nothing left held');
  assert.equal((await plan(app.id)).busy, false);
  globalThis.fetch = f;
  assert.equal((await add(app.id, 'new', box.key)).success, true);
});

test('a press is never refused for what the box doesn’t show: a photo put on People when there’s no headshot to give, a namesake elsewhere moved to alumni', async () => {
  await person('nell-nophoto', { name: 'Nell Nophoto', group: 'advisory' }, 'nell@example.org');
  const a = await applied('Nell Nophoto', 'nell@example.org');
  await env.DB.prepare('UPDATE advisory_applications SET headshot = NULL WHERE id = ?').bind(a.id).run();
  const box = await plan(a.id);
  assert.equal(box.kind, 'same');
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...(await rec('nell-nophoto')), photo: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/team/nell/public' }), 'nell-nophoto').run();
  const r = await add(a.id, 'same', box.key);
  assert.equal(r.success, true, r.error);
  await person('kai-namesake', { name: 'Kai Namesake', group: 'board' }, 'kai.board@example.org');
  const k = await applied('Kai Namesake', 'kai.new@example.org');
  const kbox = await plan(k.id);
  assert.deepEqual([kbox.kind, kbox.namesake?.slug], ['new', 'kai-namesake']);
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...(await rec('kai-namesake')), status: 'alumni' }), 'kai-namesake').run();
  const r2 = await add(k.id, 'new', kbox.key);
  assert.equal(r2.success, true, r2.error);
  // (but moved In memoriam, which the box would say: out of date)
  await person('mo-namesake', { name: 'Mo Namesake', group: 'team' }, 'mo.team@example.org');
  const m = await applied('Mo Namesake', 'mo.new@example.org');
  const mbox = await plan(m.id);
  await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...(await rec('mo-namesake')), name: 'In memoriam: Mo Namesake', status: 'memorial' }), 'mo-namesake').run();
  assert.equal((await add(m.id, 'new', mbox.key)).success, false);
});

test('names, round ten: last name first with a family name of two words, more letters after a name, a family name in capitals, "The Honorable", and every plain letter', async () => {
  const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)];
  for (const [slug, name, applying] of [['martin-van-buren', 'Martin Van Buren', 'Van Buren, Martin'], ['maria-de-la-cruz', 'Maria De La Cruz', 'De La Cruz, Maria'], ['maria-garcia-lopez', 'Maria Garcia Lopez', 'Garcia Lopez, Maria'],
    ['anh-van-do', 'Anh Van Do', 'Anh Van DO'], ['amadou-hampate-ba', 'Amadou Hampâté Ba', 'Amadou Hampâté BA'], ['jordan-ames', 'Jordan Ames', 'The Honorable Jordan Ames'], ['gorg-hili', 'Ġorġ Ħili', 'Gorg Hili'],
    ['anna-muller', 'Anna Müller', 'Anna Mueller'], ['jorg-schroder', 'Jörg Schröder', 'Joerg Schroeder']]) {
    await person(slug, { name, group: 'advisory' }, `${slug}@x.org`);
    assert.deepEqual(among(await plan((await applied(applying, `a.${slug}@x.org`)).id)), [slug], applying);
  }
  await person('dana-price', { name: 'Dana Price', group: 'advisory' }, 'dana.work@x.org');
  const letters = ['M.Ed.', 'MEd', 'SHRM-CP', 'SHRM-SCP', 'LEED AP', 'ChFC', 'CLU', 'MSc', 'EA', 'CFE', 'SIOR', 'MHA'];
  for (const [k, l] of letters.entries()) {
    assert.deepEqual(among(await plan((await applied(`Dana Price ${l}`, `dl${k}@x.org`)).id)), ['dana-price'], l);
  }
});

// ─── Round eleven ───────────────────────────────────────────────────

test('letters after a comma it doesn’t know (ASID, RD, PharmD, REALTOR®) are letters, never a first name: greeted by their own, and asked about the same person', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  await person('jane-doe', { name: 'Jane Doe', group: 'advisory' }, 'jane.work@x.org');
  for (const [k, n] of ['Jane Doe, ASID', 'Jane Doe, RD', 'Jane Doe, LPN', 'Jane Doe, NCIDQ', 'Jane Doe, RD, MS', 'Jane Doe, PharmD', 'Jane Doe, REALTOR®', 'Jane Doe, DPT'].entries()) {
    // (r20: after a comma only letters the file knows are greeted past; "REALTOR®" isn't: no name. Still asked about the same person)
    assert.equal(greetName({ fullName: n }), /REALTOR/.test(n) ? '' : 'Jane', n);
    const p = await plan((await applied(n, `jd${k}@x.org`)).id);
    assert.deepEqual([p.kind, p.person?.slug, p.asName], ['choose', 'jane-doe', undefined], n);
  }
});

test('greetings, round eleven: capitals with titles or letters, hyphens and apostrophes; Jr. kept after the family name; initials after a comma; "Mr. and Mrs."', async () => {
  const { greetName, readName } = await import('../functions/api/_advisory-form.js');
  // ("Dr. JORDAN AMES": no name since round 19, Nov 21 2026, its confident-or-none rule superseding this round's "Jordan": a
  // title, one word, then an unknown word in capitals may be a family name or letters, "DR. QUILL FACC", nothing says which)
  for (const [n, g] of [['Dr. JORDAN AMES', 'Jordan'] /* r20: a title on the short list, then a whole name: its first name */, ['JORDAN AMES, PhD', 'Jordan'], ['JORDAN AMES Jr.', 'Jordan'], ['MARY-KATE OLSEN', 'Mary-Kate'], ['D’ANDRE SMITH', 'D\'Andre'] /* r20: every dash, apostrophe and middle dot is read as its plain form */,
    ['Ames, J.R.', ''] /* r20: a comma: no name */, ['Mr. and Mrs. Jordan Ames', ''] /* r20: two people, or someone not named ("and"): no name */, ['Ames, DeShawn', ''] /* r20: a comma: no name */, ['Jordan Ames, M.D.', 'Jordan']]) {
    assert.equal(greetName({ fullName: n }), g, n);
  }
  assert.equal(readName('Ames, Jordan Jr.').shown, 'Jordan Ames Jr.');
  assert.equal(readName('Ames Jr., Jordan').shown, 'Jordan Ames Jr.');
  await person('jordan-ames', { name: 'Jordan Ames', group: 'advisory' }, 'ja@x.org');
  assert.deepEqual((await plan((await applied('Mr. and Mrs. Jordan Ames', 'mm@x.org')).id)).person?.slug, 'jordan-ames');
});

test('a name with no letters a to z but a title or letters in them (Dr., PhD, Jr.) gets an address of its own, never "dr", and is never asked about someone else for it', async () => {
  const vlad = await applied('Dr. Владимир Петров', 'vlad@x.org');
  const r = await add(vlad.id, 'new');
  assert.equal(r.success, true, r.error);
  assert.match(r.person.slug, /^advisory-board-member-/);
  const wang = await plan((await applied('Dr. 王小明', 'wang@x.org')).id);
  assert.equal(wang.kind, 'new', 'never "Is this the same Dr. 王小明?" about Dr. Владимир Петров');
  assert.notEqual(wang.slug, r.person.slug);
  // (and a name with letters a to z: its address from the name, never its title or letters)
  assert.equal((await plan((await applied('Dr. Jordan Smith, CPA', 'js@x.org')).id)).slug, 'jordan-smith');
});

test('a delete marked before anything goes: the mark not saving deletes nothing; stopping after the headshot leaves it marked, never used as whole, and Delete again finishes it', async () => {
  const deleted = [];
  const f = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => { if (init.method === 'DELETE') { deleted.push(String(input)); return Response.json({ success: true, result: {} }); } return f(input, init); };
  const real = env.DB.prepare.bind(env.DB);
  const remove = async (id) => (await adminApi.onRequestPost(ctx('POST', { remove: { id } }))).json();
  // The mark doesn't save (D1 busy): nothing deleted, nothing marked
  const a = await applied('Una Marked', 'una@example.org');
  env.DB.prepare = (sql) => (/SET deleting_at = \?/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  assert.equal((await remove(a.id)).success, false);
  env.DB.prepare = real;
  assert.equal(deleted.length, 0, 'its headshot never touched');
  const still = await getAdvisoryApplication(env.DB, a.id);
  assert.ok(still.headshot && !still.deleting);
  // The headshot goes, then the row doesn't: left marked, its headshot never shown or made anyone's photo
  env.DB.prepare = (sql) => (/^DELETE FROM advisory_applications WHERE id = \?$/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  const r = await remove(a.id);
  env.DB.prepare = real;
  assert.equal(r.success, false);
  assert.equal(r.error, 'Deleting this application didn’t finish: it’s still here. Press Delete application again to finish it.');
  assert.equal(deleted.length, 1);
  const half = await getAdvisoryApplication(env.DB, a.id);
  assert.deepEqual([half.deleting, half.headshot], [true, null]);
  const tried = await add(a.id, 'new');
  assert.equal(tried.success, false);
  assert.equal(tried.error, 'Deleting this application didn’t finish, so nobody can be added from it. Press Delete application to finish deleting it.');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM team').first()).n, 0, 'nobody added with a photo that’s gone');
  // Delete again: finished
  assert.equal((await remove(a.id)).success, true);
  assert.equal(await getAdvisoryApplication(env.DB, a.id), null);
});

test('the box’s key, round eleven: a status the box doesn’t mention never makes a press out of date (Not now does); a namesake’s web address neither; an organization the box tells people apart by does', async () => {
  const app = await applied('Sam Status', 'sam.status@example.org');
  const box = await plan(app.id);
  await adminApi.onRequestPost(ctx('POST', { status: { id: app.id, status: 'talking' } }));
  assert.equal((await plan(app.id)).key, box.key, 'In conversation: the box says the same');
  const notNow = await plan(app.id);
  await adminApi.onRequestPost(ctx('POST', { status: { id: app.id, status: 'not-now' } }));
  const refused = await add(app.id, 'new', notNow.key);
  assert.match(refused.error, /^This application was marked Not now by linzi@soardcharity\.com since the box opened/);
  // A namesake elsewhere given another web address: the box says the same, so the press goes
  await person('kai-board', { name: 'Kai Board', group: 'board' }, 'kai.b@example.org');
  const k = await applied('Kai Board', 'kai.new@example.org');
  const kbox = await plan(k.id);
  const row = await env.DB.prepare('SELECT * FROM team WHERE slug = ?').bind('kai-board').first();
  await env.DB.prepare('DELETE FROM team WHERE slug = ?').bind('kai-board').run();
  await person('kai-board-member', { ...JSON.parse(row.data), slug: 'kai-board-member' });
  assert.equal((await add(k.id, 'new', kbox.key)).success, true);
  // Two with one name told apart by organization, swapped meanwhile: out of date, never linked to the other
  await person('lee-twin-a', { name: 'Lee Twin', group: 'advisory', organization: 'Acme' }, 'lee.a@example.org');
  await person('lee-twin-b', { name: 'Lee Twin', group: 'advisory', organization: 'Beta' }, 'lee.b@example.org');
  const l = await applied('Lee Twin', 'lee.new@example.org');
  const lbox = await plan(l.id);
  for (const [slug, org] of [['lee-twin-a', 'Beta'], ['lee-twin-b', 'Acme']]) await env.DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...(await rec(slug)), organization: org }), slug).run();
  const swapped = await (await adminApi.onRequestPost(ctx('POST', { add: { id: l.id, as: 'same', to: 'lee-twin-a', seen: lbox.key } }))).json();
  assert.equal(swapped.success, false);
  assert.match(swapped.error, /changed since the box opened/);
});

test('two notes saved at the same moment are both kept', async () => {
  const app = await applied('Nora Notes', 'nora@example.org');
  const g = gate(/^UPDATE advisory_applications SET notes/);
  const first = adminApi.onRequestPost(ctx('POST', { note: { id: app.id, text: 'First.' } }));
  await g.reached;
  const second = await (await adminApi.onRequestPost(ctx('POST', { note: { id: app.id, text: 'Second.' } }))).json();
  assert.equal(second.success, true);
  g.open();
  assert.equal((await (await first).json()).success, true);
  assert.deepEqual((await getAdvisoryApplication(env.DB, app.id)).notes.map((n) => n.text).sort(), ['First.', 'Second.']);
});

test('a People record a press is adding to (or making) can’t have its web address changed meanwhile', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  await person('rita-rename', { name: 'Rita Rename', group: 'advisory' }, 'rita@example.org');
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS advisory_add_holds (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind('slug:rita-rename', Date.now()).run();
  const r = await rename(env, { collection: 'team', from: 'rita-rename', to: 'rita-r' }, 'linzi@soardcharity.com');
  assert.deepEqual([r.status, r.body.error], [409, 'Someone is adding this person to the Advisory Board right now. Change the address in a moment.']);
  assert.ok(await rec('rita-rename'), 'still at its address');
});

// ─── Round twelve ───────────────────────────────────────────────────

test('what someone does, their company or a place, or letters the site didn’t know, after a comma is never their first name: greeted by their own, asked about the same person, and a different person is named as written', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  await person('jordan-quill', { name: 'Jordan Quill', group: 'advisory' }, 'jq.work@x.org');
  const after = ['Realtor', 'Owner', 'President', 'Broker', 'Designer', 'Interior Designer', 'Retired', 'Senior', 'Junior', 'Esquire', 'Pastor', 'Coach', 'McKinsey', 'Atlanta', 'Realtor®', 'Acme Inc.', 'Inc.', 'DrPH', 'BSc'];
  for (const [k, w] of after.entries()) {
    const n = `Jordan Quill, ${w}`;
    // (a name after the comma that could be a first name, "McKinsey", "Atlanta", can't say which is theirs: greeted
    // without one, never a guess; matching still finds Jordan Quill)
    // (r20: after a comma, only letters the file knows are greeted past; a job, a company or a place: no name)
    assert.equal(greetName({ fullName: n }), ['Retired', 'Senior', 'Junior', 'Esquire', 'DrPH', 'BSc'].includes(w) ? 'Jordan' : '', n);
    const p = await plan((await applied(n, `jq${k}@x.org`)).id);
    assert.deepEqual([p.kind, p.person?.slug], ['choose', 'jordan-quill'], n);
  }
  // A different person: under the name as written, at an address from their name (never "realtor-jordan-quill")
  const other = await applied('Jordan Quill, Realtor', 'jq.other@x.org');
  const r = await add(other.id, 'new');
  assert.equal(r.success, true, r.error);
  assert.equal(r.person.slug, 'jordan-quill-2');
  assert.equal((await rec('jordan-quill-2')).name, 'Jordan Quill, Realtor');
  // Written last name first with letters after the first name: the letters are set apart, after the whole name
  const amy = await add((await applied('Quill, Amy MD', 'amy.q@x.org')).id, 'new');
  assert.equal(amy.success, true, amy.error);
  // (r20: a comma: no name)
  assert.deepEqual([amy.person.slug, (await rec('amy-quill')).name, greetName({ fullName: 'Quill, Amy MD' })], ['amy-quill', 'Amy Quill MD', '']);
  // An initial never ends the greeting with a full stop of its own ("Thank you, J.." was said); r20: an initial is never
  // greeted at all
  assert.equal(greetName({ fullName: 'J. Ames' }), '');
});

test('two capitals after a comma that aren’t letters it knows are a first name ("Quill, TJ"); "Lee, MD" is still letters', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  await person('tj-quill', { name: 'TJ Quill', group: 'advisory' }, 'tj.work@x.org');
  for (const [k, n] of ['Quill, TJ', 'Quill, AJ', 'Quill, MJ'].entries()) {
    assert.equal(greetName({ fullName: n }), '', n); // (r20: a comma: no name; matching is as before)
    if (k === 0) assert.deepEqual(await plan((await applied(n, 'tj.home@x.org')).id).then((p) => [p.kind, p.person?.slug]), ['choose', 'tj-quill']);
  }
  assert.equal(greetName({ fullName: 'Lee, MD' }), ''); // (r20: one word before the comma: no name)
  assert.equal(greetName({ fullName: 'Jane Doe, RD' }), 'Jane');
});

test('initials with dots before a name ("J.R. Smithers") are a first initial: asked about Jordan Smithers, as "J. Smithers" is', async () => {
  for (const [slug, name, applying] of [['jordan-smithers', 'Jordan Smithers', 'J.R. Smithers'], ['sara-lindqvist', 'Sara Lindqvist', 'S.R. Lindqvist'], ['tom-jarrow', 'Tom Jarrow', 'T.J. Jarrow']]) {
    await person(slug, { name, group: 'advisory' }, `${slug}@x.org`);
    const p = await plan((await applied(applying, `a.${slug}@x.org`)).id);
    assert.deepEqual([p.kind, p.person?.slug], ['choose', slug], applying);
  }
});

test('a delete that stops before anything goes, whatever stopped it (People or its history couldn’t be checked), leaves it exactly as it was: unmarked, its headshot shown, Add offered', async () => {
  const deleted = [];
  const f = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => { if (init.method === 'DELETE') { deleted.push(String(input)); return Response.json({ success: true, result: {} }); } return f(input, init); };
  const real = env.DB.prepare.bind(env.DB);
  const remove = async (id) => adminApi.onRequestPost(ctx('POST', { remove: { id } }));
  const failing = (re) => { env.DB.prepare = (sql) => (re.test(sql) ? { bind: () => ({ all: async () => { throw new Error('D1_ERROR: busy'); }, first: async () => { throw new Error('D1_ERROR: busy'); }, run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql)); };
  await env.DB.exec("CREATE TABLE content_versions (id INTEGER PRIMARY KEY, collection TEXT, slug TEXT, data TEXT)");
  for (const [re, words] of [[/SELECT data FROM team WHERE instr/, 'The site couldn’t check People just now, so nothing was deleted. Please try again in a moment.'],
    [/FROM content_versions WHERE collection = 'team' AND instr/, 'The site couldn’t check People’s history just now, so nothing was deleted. Please try again in a moment.']]) {
    const a = await applied('Pia People', `pia.${deleted.length}.${re.source.length}@example.org`);
    failing(re);
    const res = await remove(a.id);
    env.DB.prepare = real;
    assert.deepEqual([res.status, (await res.json()).error], [503, words]);
    assert.equal(deleted.length, 0, 'its headshot never touched');
    const still = await getAdvisoryApplication(env.DB, a.id);
    assert.ok(still.headshot && !still.deleting, 'unmarked, its headshot shown');
    assert.equal((await plan(a.id)).kind, 'new', 'Add offered');
  }
});

test('an Add pressed, or a panel opened, while another tab’s delete is under way waits for it ("being deleted"), never says the delete stopped', async () => {
  const f = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => (init.method === 'DELETE' ? Response.json({ success: true, result: {} }) : f(input, init));
  const a = await applied('Wes Waiting', 'wes@example.org');
  const g = gate(/^DELETE FROM advisory_applications WHERE id = \?$/);
  const removing = adminApi.onRequestPost(ctx('POST', { remove: { id: a.id } }));
  await g.reached;
  const box = await plan(a.id);
  assert.deepEqual([box?.busy, box?.busyDeleting], [true, true], 'the box waits on the delete');
  const panel = await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${a.id}`))).json();
  assert.deepEqual([panel.application.deleting, panel.application.deletingNow], [true, true], 'the panel says it’s being deleted, not that it stopped');
  g.open();
  assert.equal((await (await removing).json()).success, true);
  assert.equal((await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${a.id}`))).status, 404, 'then gone');
  // One that stopped partway (no delete under way): said as stopped
  const b = await applied('Sid Stopped', 'sid@example.org');
  await env.DB.prepare('UPDATE advisory_applications SET deleting_at = ? WHERE id = ?').bind(new Date().toISOString(), b.id).run();
  const stopped = await (await adminApi.onRequestGet(ctx('GET', undefined, `?id=${b.id}`))).json();
  assert.deepEqual([stopped.application.deleting, stopped.application.deletingNow], [true, undefined]);
  assert.match((await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${b.id}`))).json()).error, /^Deleting this application didn’t finish/);
});

test('a note, or a status, saved as the application is deleted in another tab is said as deleted (404), never a success with nothing to show', async () => {
  for (const body of [(id) => ({ note: { id, text: 'Hello.' } }), (id) => ({ status: { id, status: 'talking' } })]) {
    const a = await applied('Ned Note', `ned.${Math.random()}@example.org`);
    const g = gate(/^UPDATE advisory_applications SET (notes|status)/);
    const saving = adminApi.onRequestPost(ctx('POST', body(a.id)));
    await g.reached;
    await env.DB.prepare('DELETE FROM advisory_applications WHERE id = ?').bind(a.id).run();
    g.open();
    const res = await saving;
    assert.deepEqual([res.status, (await res.json()).error], [404, GONE]);
  }
});

test('a web address changed on People while a press adds them: one waits for the other, never the rename writing back the record it read before the Add', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  await person('rex-old', { name: 'Rex Old', group: 'advisory', status: 'alumni', until: '2024' }, 'rex@example.org');
  const app = await applied('Rex Old', 'rex@example.org');
  const box = await plan(app.id);
  const g = gate(/^SELECT data FROM team WHERE slug = \?$/);
  const renaming = rename(env, { collection: 'team', from: 'rex-old', to: 'rex-new' }, 'linzi@soardcharity.com');
  await g.reached;
  const r = await add(app.id, 'same', box.key);
  assert.equal(r.success, false);
  assert.equal(r.error, 'Rex Old’s People record is being changed right now (its web address), so nobody was added. Give it a moment, then look at the box again.');
  g.open();
  assert.equal((await renaming).status, 200);
  // then added at the address it has now: active, linked, never put back as it was before
  const done = await add(app.id, 'same');
  assert.equal(done.success, true, done.error);
  assert.equal(done.person.slug, 'rex-new');
  assert.equal((await rec('rex-new')).status, 'active');
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).personSlug, 'rex-new');
  // and a rename while another rename holds it: refused in words
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind('slug:rex-new', Date.now(), 'edit:rex-new', Date.now()).run();
  const twice = await rename(env, { collection: 'team', from: 'rex-new', to: 'rex-newer' }, 'linzi@soardcharity.com');
  assert.deepEqual([twice.status, twice.body.error], [409, 'Someone is changing this person on People right now (their web address, or a delete). Try again in a moment.']);
});

test('someone deleted from People while a press adds them: refused in words until the press is done, never an application Joined to nobody', async () => {
  const { deleteItem } = await import('../functions/api/delete-content.js');
  await person('dot-deleted', { name: 'Dot Deleted', group: 'advisory' }, 'dot@example.org');
  const app = await applied('Dot Deleted', 'dot@example.org');
  const g = gate(/^UPDATE advisory_applications SET person_slug/);
  const pressing = add(app.id, 'same');
  await g.reached;
  await assert.rejects(deleteItem(env, { path: 'src/content/team/dot-deleted.json', message: 'x' }, 'linzi@soardcharity.com'),
    (e) => e.status === 409 && e.message === 'Someone is adding this person to the Advisory Board right now, so they weren’t deleted. Try again in a moment.');
  g.open();
  assert.equal((await pressing).success, true);
  assert.ok(await rec('dot-deleted'), 'still on People, the application linked to someone who’s there');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_add_holds').first()).n, 0, 'nothing left held');
});

test('titles a person goes by (Pastor, Rabbi, Coach, Det., Rep.), a first initial before the name they use, a title typed against the name, and degrees written with dots, are never what they’re called', async () => {
  const { greetName, readName } = await import('../functions/api/_advisory-form.js');
  for (const [n, g] of [['Pastor John Smith', 'John'], ['Father John Smith', 'John'], ['Rabbi Dana Levy', 'Dana'], ['Deacon Pat Ames', 'Pat'], ['Coach Jordan Ames', 'Jordan'], ['Senator Jordan Ames', 'Jordan'],
    ['Chef Jordan Ames', ''] /* r20: "Chef" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Det. Jordan Ames', 'Jordan'], ['Rep. Jordan Ames', 'Jordan'], ['Bishop Jones', ''] /* r20: a title and a family name is no given name: no name */, ['F. Scott Fitzgerald', ''] /* r20: initials or a word with a full stop: no name */, ['J. Jordan Ames', ''] /* r20: initials or a word with a full stop: no name */,
    ['Dr.Jordan Ames', ''] /* r20: initials or a word with a full stop: no name */, ['Jane Doe, Pharm.D.', 'Jane'], ['Pat Lee, D.Min.', 'Pat'], ['Jane Doe, M.Arch.', 'Jane'], ['Doe, Pharm.D.', ''] /* r20: a comma: no name */, ['Brooks, TJ', ''] /* r20: a comma: no name */, ['Lee, BJ', ''] /* r20: a comma: no name */,
    // (names that are also titles without their dot stay names)
    ['Amartya Sen', 'Amartya'], ['Sen Lee', ''] /* r20: "Sen" isn't on the given-names list: no name */, ['Hon Lam', ''] /* r20: "Hon" isn't on the given-names list: no name */, ['Ames, J.R.', ''] /* r20: a comma: no name */]) {
    assert.equal(greetName({ fullName: n }), g, n);
  }
  assert.deepEqual(readName('Dr.Jordan Ames').words, ['Jordan', 'Ames']);
  assert.deepEqual(readName('Jane Doe Pharm.D.').words, ['Jane', 'Doe']);
});

test('the applicant’s copy in plain text never ends their name with a second full stop ("Thank you, J.R..")', async () => {
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  for (const [n, first] of [['Ames, J.R.', 'Thank you.'] /* r20: a comma: no name */, ['Jordan Ames', 'Thank you, Jordan.']]) {
    const app = await applied(n, `copy.${first.length}@x.org`);
    assert.equal(applicantEmail(app).text.split('\n')[0], first, n);
  }
});


// ─── Round thirteen ─────────────────────────────────────────────────

test('names, round thirteen: van, de, la only start a family name written first; a title after the comma is set apart; a title that is also a name needs a whole name after it; family names that are also letters; JR; a couple', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  // Written first name first, then a company or place: asked about the same person, never flipped into a second record
  // (a company or place after the comma that could be a first name: greeted without one, never a guess; matched as them)
  for (const [slug, name, applying, greet] of [['maria-de-la-cruz', 'Maria de la Cruz', 'Maria de la Cruz, Wells Fargo', ''], ['mai-le-tran', 'Mai Le Tran', 'Mai Le Tran, Delta', ''],
    ['martin-van-buren', 'Martin Van Buren', 'Martin Van Buren, Kinderhook', ''], ['jordan-quill', 'Jordan Quill', 'Quill, Pastor Jordan', ''] /* r20: a comma: no name */, ['dana-price', 'Dana Price', 'Price, Coach Dana', ''] /* r20: a comma: no name */,
    ['jordan-smithers', 'Jordan Smithers', 'JR Smithers', ''] /* r20: "JR" reads as letters (Jr.) as often as a name: not on the list */]) {
    await person(slug, { name, group: 'advisory' }, `${slug}@x.org`);
    assert.equal(greetName({ fullName: applying }), greet, applying);
    const p = await plan((await applied(applying, `a.${slug}@x.org`)).id);
    assert.deepEqual([p.kind, p.person?.slug], ['choose', slug], applying);
  }
  // Names that look like a title or letters: their whole name, their own address
  // (r20: "Deacon" and "Bishop" are titles before a family name, never on the given-names list: no name)
  for (const [n, slug, greet] of [['Deacon Phillippe', 'deacon-phillippe', ''], ['Bishop Briggs', 'bishop-briggs', ''], ['Ken Iida', 'ken-iida', ''] /* r25: Ken is a family name some people write first and Iida no family name of a people who write it last: no evidence of the order, no name (finding 1's rule) */, ['Annalisa Cima', 'annalisa-cima', 'Annalisa'], ['Olive Senior', 'olive-senior', 'Olive']]) {
    assert.equal(greetName({ fullName: n }), greet, n);
    assert.equal((await plan((await applied(n, `${slug}@y.org`)).id)).slug, slug, n);
  }
  // ...and the same words as titles or letters, where they are
  for (const [n, greet] of [['Bishop John Briggs', 'John'], ['Jordan Quill, Senior', 'Jordan'], ['Pastor John Smith', 'John']]) assert.equal(greetName({ fullName: n }), greet, n);
  // A couple: both greeted, the first one's address, the name as written with its "&"
  assert.equal(greetName({ fullName: 'Quill, Jordan & Amy' }), ''); // (r20: two people: no name)
  const couple = await plan((await applied('Rowe, Jordan & Amy', 'rowe@x.org')).id);
  assert.deepEqual([couple.slug, couple.asName ?? couple.name], ['jordan-rowe', couple.asName ?? couple.name]);
  assert.equal((await add(couple.application.id, 'new')).success, true);
  assert.equal((await rec('jordan-rowe')).name, 'Jordan & Amy Rowe');
});

test('a delete stopped by the database twice (People can’t be checked, nor the mark taken off): never marked with nothing gone; and a delete whose picture didn’t go and whose mark won’t come off says it stopped', async () => {
  const f = globalThis.fetch;
  let refuse = false;
  globalThis.fetch = async (input, init = {}) => (init.method === 'DELETE' ? (refuse ? Response.json({ success: false }, { status: 500 }) : Response.json({ success: true, result: {} })) : f(input, init));
  const real = env.DB.prepare.bind(env.DB);
  const throwing = { bind: () => ({ all: async () => { throw new Error('D1_ERROR: busy'); }, first: async () => { throw new Error('D1_ERROR: busy'); }, run: async () => { throw new Error('D1_ERROR: busy'); } }) };
  const a = await applied('Out Age', 'out.age@example.org');
  env.DB.prepare = (sql) => (/SELECT data FROM team WHERE instr|SET deleting_at = NULL/.test(sql) ? throwing : real(sql));
  const r = await (await adminApi.onRequestPost(ctx('POST', { remove: { id: a.id } }))).json();
  env.DB.prepare = real;
  assert.equal(r.error, 'The site couldn’t check People just now, so nothing was deleted. Please try again in a moment.');
  const still = await getAdvisoryApplication(env.DB, a.id);
  assert.ok(still.headshot && !still.deleting, 'never marked: nothing was deleted');
  // The picture refuses to go and the mark won't come off: said as stopped (true: it's marked), never "still here as it was"
  refuse = true;
  env.DB.prepare = (sql) => (/SET deleting_at = NULL/.test(sql) ? throwing : real(sql));
  const r2 = await (await adminApi.onRequestPost(ctx('POST', { remove: { id: a.id } }))).json();
  env.DB.prepare = real;
  assert.equal(r2.error, 'Deleting this application didn’t finish: it’s still here. Press Delete application again to finish it.');
  assert.equal((await getAdvisoryApplication(env.DB, a.id)).deleting, true);
  refuse = false;
  assert.equal((await (await adminApi.onRequestPost(ctx('POST', { remove: { id: a.id } }))).json()).success, true, 'Delete again finishes it');
});

test('a delete that happened is said as done, and written to History, even when tidying up after it doesn’t answer', async () => {
  const f = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => (init.method === 'DELETE' ? Response.json({ success: true, result: {} }) : f(input, init));
  const a = await applied('Tidy Up', 'tidy.up@example.org');
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/DELETE FROM advisory_add_intents WHERE app_id/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  const res = await adminApi.onRequestPost(ctx('POST', { remove: { id: a.id } }));
  env.DB.prepare = real;
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
  assert.equal(await getAdvisoryApplication(env.DB, a.id), null);
  assert.ok(await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'deleted' AND entity_name LIKE ?").bind('%Tidy Up%').first(), 'in the audit log, as any delete is');
});

test('a People record being changed to the web address a new applicant would get: said as that, never "someone is adding"; a rename to an address an Add is making says someone new is being added there', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  await person('dee-dunn-team', { name: 'Dee Dunn', group: 'team' }, 'dee.team@example.org');
  const app = await applied('Dee Dunn', 'dee.new@example.org');
  const box = await plan(app.id);
  assert.equal(box.slug, 'dee-dunn');
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS advisory_add_holds (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind('slug:dee-dunn', Date.now(), 'edit:dee-dunn', Date.now()).run();
  const during = await plan(app.id);
  assert.deepEqual([during.busy, during.busyEditing], [true, 'address'], 'the box says the address they’d get is being given to another People record');
  const pressed = await add(app.id, 'new', box.key);
  assert.equal(pressed.error, 'Someone is changing a People record to the web address they’d be given, right now, so nobody was added. Give it a moment, then look at the box again.');
  await env.DB.prepare('DELETE FROM advisory_add_holds').run();
  // An Add making someone new at "dee-dunn": a rename of someone else to it is told someone new is being added there
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind('slug:dee-dunn', Date.now()).run();
  const r = await rename(env, { collection: 'team', from: 'dee-dunn-team', to: 'dee-dunn' }, 'linzi@soardcharity.com');
  assert.deepEqual([r.status, r.body.error], [409, 'Someone is adding a new person to the Advisory Board at “dee-dunn” right now. Pick another address, or try again in a moment.']);
});

test('greetings, round thirteen: two or more initials are the name they go by; more titles set apart (Doctor, Professor, Captain, Sr., Msgr., Atty., Dra., Lic., Canon); a title against the name, twice or before a small letter; a preferred name that is a filler; a name typed in small letters', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  for (const [n, g] of [['J. K. Rowling', ''] /* r20: initials or a word with a full stop: no name */, ['C. S. Lewis', ''] /* r20: initials or a word with a full stop: no name */, ['A. J. Smith', ''] /* r20: initials or a word with a full stop: no name */, ['T J Brooks', ''] /* r20: "T" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['C. J. Brooks, MD', ''] /* r20: initials or a word with a full stop: no name */, ['F. Scott Fitzgerald', ''] /* r20: initials or a word with a full stop: no name */,
    ['Doctor Jordan Ames', 'Jordan'], ['Professor Jordan Ames', 'Jordan'], ['Captain Jordan Ames', 'Jordan'], ['Sr. Mary Ames', ''] /* r20: initials or a word with a full stop: no name */, ['Msgr. John Ames', 'John'], ['Atty. Jordan Ames', 'Jordan'],
    ['Dra. Maria Lopez', 'Maria'], ['Lic. Juan Perez', 'Juan'], ['Rev. Canon Jordan Ames', ''] /* r20: "Canon" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Rev.Dr.Jordan Ames', ''] /* r20: initials or a word with a full stop: no name */, ['Dr.jordan Ames', ''] /* r20: initials or a word with a full stop: no name */, ['jordan ames', 'Jordan'],
    // (a place or company after the comma that could be a first name: greeted without one, never a guess)
    ['de la cruz, maria', ''], ['Jordan Van Dyke, Atlanta', ''], ['Maria De La Cruz, Keller Williams', ''], ['Minh Van Tran, Emory Healthcare', ''], ['Anh Le Nguyen, Decatur', ''],
    // (names that are also titles or words stay names)
    ['Major Taylor', ''] /* r20: a title and a family name is no given name: no name */, ['Dean Martin', ''] /* r20: "Dean" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Gen Tanaka', ''] /* r20: "Gen" (a title only with its stop) isn't on the given-names list: no name */]) {
    assert.equal(greetName({ fullName: n }), g, n);
  }
  for (const pref of ['N/A', 'None', 'Same', '-', '.', 'n/a', 'Same as above']) assert.equal(greetName({ fullName: 'Jordan Ames', preferredName: pref }), 'Jordan', pref);
  assert.equal(greetName({ fullName: 'Jordan Ames', preferredName: 'Jo' }), 'Jo');
  // ...and the applicant's copy says the initials once, with one full stop
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  assert.equal(applicantEmail(await applied('J. K. Rowling', 'jk@x.org')).text.split('\n')[0], 'Thank you.'); // (r20: initials: no name)
});


// ─── Round fourteen ─────────────────────────────────────────────────

test('names, round fourteen: a first name that starts like a family name (Van, Del, La, Le) with a company after the comma stays first name first; a title word that’s a name, with letters after; a family name in parts in capitals', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  // (greeted without a first name, never a guess: "Dream Corps" could be one as far as the site can tell)
  for (const [slug, name, applying, greet] of [['van-jones', 'Van Jones', 'Van Jones, Dream Corps', ''], ['del-taylor', 'Del Taylor', 'Del Taylor, Home Depot', ''],
    ['la-donna-brown', 'La Donna Brown', 'La Donna Brown, Keller Williams', ''], ['le-thi-hoa', 'Le Thi Hoa', 'Le Thi Hoa, Delta Air Lines', ''], ['van-morrison', 'Van Morrison', 'Van Morrison, Wells Fargo', ''],
    ['deacon-phillippe', 'Deacon Phillippe', 'Deacon Phillippe Jr.', ''] /* r20: a title before a family name: no name */, ['bishop-briggs', 'Bishop Briggs', 'Bishop Briggs PhD', ''] /* r20: a title before a family name: no name */, ['maria-de-la-cruz', 'Maria De La Cruz', 'DE LA CRUZ, MARIA', '']]) {
    await person(slug, { name, group: 'advisory' }, `${slug}@x.org`);
    assert.equal(greetName({ fullName: applying }), greet, applying);
    const p = await plan((await applied(applying, `a.${slug}@x.org`)).id);
    assert.deepEqual([p.kind, p.person?.slug], ['choose', slug], applying);
  }
  // ...and one first name after a family name in parts is greeted without one too (from round fifteen: "Del Taylor,
  // Compass" is the same shape), matched both ways
  for (const [n, g] of [['Van Buren, Martin', ''], ['De La Cruz, Maria', ''], ['St. James, Jordan', ''], ['Bishop John Briggs PhD', 'John']]) assert.equal(greetName({ fullName: n }), g, n);
});

test('the waiting box and People’s refusals say which record is held: someone this could be, or another record taking the address they’d get; a rename to an address someone has says that first', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  await person('jo-ames', { name: 'Jo Ames', group: 'advisory' }, 'jo@x.org');
  await person('zed-other', { name: 'Zed Other', group: 'team' }, 'zed@x.org');
  const app = await applied('Jo Ames', 'jo.new@x.org');
  const box = await plan(app.id);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS advisory_add_holds (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  // Someone they could be, being changed: by name
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind('slug:jo-ames', Date.now(), 'edit:jo-ames', Date.now()).run();
  assert.deepEqual(await plan(app.id).then((p) => [p.busyEditing, p.busyName]), ['person', 'Jo Ames']);
  await env.DB.prepare('DELETE FROM advisory_add_holds').run();
  // Another record taking the address "A different person" would get: never "Jo Ames's record"
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind(`slug:${box.slug}`, Date.now(), `edit:${box.slug}`, Date.now()).run();
  assert.deepEqual(await plan(app.id).then((p) => [p.busyEditing, p.busyName]), ['address', '']);
  await env.DB.prepare('DELETE FROM advisory_add_holds').run();
  // A rename to an address someone already has: said as that, whatever holds it
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind('slug:jo-ames', Date.now()).run();
  const taken = await rename(env, { collection: 'team', from: 'zed-other', to: 'jo-ames' }, 'linzi@soardcharity.com');
  assert.deepEqual([taken.status, taken.body.error], [409, 'Someone already has the address “jo-ames”. Pick another.']);
  await env.DB.prepare('DELETE FROM advisory_add_holds').run();
  // Two renames to one new address at once: the second is told the address is being given to another record
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind('slug:new-spot', Date.now(), 'edit:new-spot', Date.now()).run();
  const second = await rename(env, { collection: 'team', from: 'zed-other', to: 'new-spot' }, 'linzi@soardcharity.com');
  assert.deepEqual([second.status, second.body.error], [409, 'Someone is giving “new-spot” to another People record right now. Pick another address, or try again in a moment.']);
});

test('a hold the database didn’t let go of at the first try is let go (never 2 minutes of "someone is adding them" after an Add that finished)', async () => {
  const app = await applied('Rae Rook', 'rae.rook@example.org');
  const real = env.DB.prepare.bind(env.DB);
  let fails = 2;
  env.DB.prepare = (sql) => (/^DELETE FROM advisory_add_holds WHERE key = \?$/.test(sql) && fails-- > 0 ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) } : real(sql));
  const r = await add(app.id, 'new');
  env.DB.prepare = real;
  assert.equal(r.success, true, r.error);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_add_holds').first()).n, 0, 'every hold let go');
  assert.equal((await plan(app.id)).busy, false);
});

test('a delete that stops, of an application that never had a headshot, never says its headshot isn’t shown', async () => {
  // (one sent before the form asked for a headshot: none on file)
  const a = await applied('No Shot', 'no.shot@example.org');
  await env.DB.prepare('UPDATE advisory_applications SET headshot = NULL WHERE id = ?').bind(a.id).run();
  const real = env.DB.prepare.bind(env.DB);
  const throwing = { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) };
  env.DB.prepare = (sql) => (/^DELETE FROM advisory_applications WHERE id = \?$|SET deleting_at = NULL/.test(sql) ? throwing : real(sql));
  const r = await (await adminApi.onRequestPost(ctx('POST', { remove: { id: a.id } }))).json();
  env.DB.prepare = real;
  assert.equal(r.error, 'Deleting this application didn’t finish: it’s still here. Press Delete application again to finish it.');
  const half = await getAdvisoryApplication(env.DB, a.id);
  assert.deepEqual([half.deleting, half.hadHeadshot], [true, false]);
});


test('greetings, round fourteen: initials after a family name in parts; a couple with a title or initials on the second, or two family names; a title alone after the comma; couples’ titles; initials in small letters or typed against the name; a preferred name in small letters or a filler; nothing guessed', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  for (const [n, g] of [['Van Dyke, Jordan T.', ''], ['Van Dyke, J. Robert', ''], ['Du Bois, W. E. B.', ''], ['De La Cruz, M. J.', ''], ['Van Dyke, TJ', ''], ['Ames, Jordan T.', ''] /* r20: a comma: no name */, ['Bois, W. E. B.', ''] /* r20: a comma: no name */,
    ['Jordan & Dr. Amy Quill', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan & Mrs. Amy Quill', ''] /* r20: two people ("&" or "+"): no name */, ['Quill, Jordan & Dr. Amy', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan & T. J. Quill', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan Quill & Amy Lee', ''] /* r20: two people ("&" or "+"): no name */,
    ['Ames, Dr.', ''] /* r20: a comma: no name */, ['Quill, Mrs.', ''] /* r20: a comma: no name */, ['Dr. and Mrs. Quill', ''] /* r20: two people, or someone not named ("and"): no name */, ['Mr. & Mrs. Ames', ''] /* r20: two people ("&" or "+"): no name */, ['Drs. Jordan and Amy Quill', ''] /* r20: two people, or someone not named ("and"): no name */,
    ['t.j. brooks', ''] /* r20: initials or a word with a full stop: no name */, ['t j brooks', ''] /* r20: "t" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['j.k. rowling', ''] /* r20: initials or a word with a full stop: no name */, ['e. e. cummings', ''] /* r20: initials or a word with a full stop: no name */, ['J.K.Rowling', ''] /* r20: initials or a word with a full stop: no name */, ['F.Scott Fitzgerald', ''] /* r20: initials or a word with a full stop: no name */, ['J.Ames', ''] /* r20: initials or a word with a full stop: no name */,
    // (a degree written with its dots is never split as initials)
    ['Dana Price M.Ed.', 'Dana'], ['Pat Lee, D.Min.', 'Pat'],
    // (two family names, or a company, after a name of two words: no first name guessed)
    ['Garcia Lopez, Maria', '']]) {
    assert.equal(greetName({ fullName: n }), g, n);
  }
  for (const [pref, g] of [['jordan', 'Jordan'], ['jo-anne', 'Jo-Anne'], ['None.', 'Jordan'], ['NONE.', 'Jordan'], ['Same.', 'Jordan'], ['Same as above.', 'Jordan'], ['Same as full name', 'Jordan'], ['Not applicable', 'Jordan'], ['No preference', 'Jordan'], ['Nil', 'Jordan'] /* r20: "Nil" isn't on the given-names list (a word as often as a name): set aside, their full name's "Jordan" */]) {
    assert.equal(greetName({ fullName: 'Jordan Ames', preferredName: pref }), g, pref);
  }
  // ...and the thank-you's copy, with no name guessed, thanks them for applying
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  const copy = applicantEmail(await applied('Garcia Lopez, Maria', 'gl@x.org'));
  assert.equal(copy.text.split('\n')[0], 'Thank you.');
  assert.match(copy.html, /Thank you for applying/);
});

test('names, round fifteen: more than one word before the comma is never read as a family name and first names, or as a name and a company: greeted with no first name, kept as written, and asked about whoever it could be either way', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)];
  const made = new Set();
  for (const [slug, name, applying] of [
    ['maria-garcia-lopez', 'Maria Garcia Lopez', 'Garcia Lopez, Maria de los Angeles'], ['maria-garcia-lopez', 'Maria Garcia Lopez', 'Garcia Lopez, Maria (Mia)'],
    ['maria-garcia-lopez', 'Maria Garcia Lopez', 'Garcia Lopez, maria'], ['ana-garcia-lopez', 'Ana Garcia Lopez', 'Garcia Lopez, Ana Maria Sofia Isabel'],
    ['martin-van-buren', 'Martin Van Buren', 'Van Buren, Martin (Marty)'], ['martin-van-buren', 'Martin Van Buren', 'Van Buren, Martin "Marty"'], ['martin-van-buren', 'Martin Van Buren', 'Van Buren, Martin Jr.'],
    ['maria-de-la-cruz', 'Maria De La Cruz', 'De La Cruz, Maria de los Angeles'], ['maria-de-la-cruz', 'Maria De La Cruz', 'De La Cruz, Maria PhD'],
    // (a name and a one-word company: never "Compass Del Taylor")
    ['del-taylor', 'Del Taylor', 'Del Taylor, Compass'], ['van-jones', 'Van Jones', 'Van Jones, Google'], ['la-donna-brown', 'La Donna Brown', 'La Donna Brown, Compass']]) {
    if (!made.has(slug)) { made.add(slug); await person(slug, { name, group: 'advisory' }, `${slug}@x.org`); }
    assert.equal(greetName({ fullName: applying }), '', applying);
    const p = await plan((await applied(applying, `a${made.size}.${applying.length}@x.org`)).id);
    assert.equal(p.kind, 'choose', applying);
    assert.ok(among(p).includes(slug), `${applying}: ${among(p)}`);
  }
  // ...and someone new by such a name is added as they wrote it, at the address of the words before the comma, never
  // with a company for a first name
  const app = await applied('Del Rey, Compass', 'del.rey@x.org');
  const box = await plan(app.id);
  assert.deepEqual([box.kind, box.asName || app.name, box.slug], ['new', 'Del Rey, Compass', 'del-rey']);
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  assert.doesNotMatch(applicantEmail(app).text, /Compass,|Thank you, Del/);
});

test('names, round fifteen: degree letters that are names too (MD, MBA, MA) after a name typed all in capitals or all in small letters: matched with and without them, never a new record beside the member', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)];
  await person('bishop-briggs', { name: 'Bishop Briggs', group: 'advisory' }, 'bb@x.org');
  await person('deacon-phillippe', { name: 'Deacon Phillippe', group: 'advisory' }, 'dp@x.org');
  await person('jordan-ames', { name: 'Jordan Ames', group: 'advisory' }, 'ja@x.org');
  let k = 0;
  // (r20: "Bishop" and "Deacon" are titles before a family name, never on the given-names list: no name)
  for (const [applying, slug, g] of [['BISHOP BRIGGS MD', 'bishop-briggs', ''], ['bishop briggs md', 'bishop-briggs', ''], ['DEACON PHILLIPPE MBA', 'deacon-phillippe', ''],
    ['JORDAN AMES MD', 'jordan-ames', 'Jordan'], ['jordan ames md', 'jordan-ames', 'Jordan'], ['JORDAN AMES MBA', 'jordan-ames', 'Jordan']]) {
    assert.equal(greetName({ fullName: applying }), g, applying);
    const p = await plan((await applied(applying, `d${++k}@x.org`)).id);
    assert.equal(p.kind, 'choose', applying);
    assert.ok(among(p).includes(slug), `${applying}: ${among(p)}`);
  }
  // ...and two such names that end alike are never taken for each other: "JORDAN AMESB MD" is asked about Jordan Amesb
  await person('jordan-amesb', { name: 'Jordan Amesb', group: 'advisory' }, 'jb@x.org');
  await person('jordan-amesa-md', { name: 'JORDAN AMESA MD', group: 'advisory' }, 'jam@x.org');
  const p = await plan((await applied('JORDAN AMESB MD', 'jbm@x.org')).id);
  assert.ok(among(p).includes('jordan-amesb'), String(among(p)));
  assert.ok(!among(p).includes('jordan-amesa-md'), String(among(p)));
});

test('names, round fifteen: a couple whose second person is already on People is asked about them', async () => {
  const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)];
  await person('amy-rowe', { name: 'Amy Rowe', group: 'advisory' }, 'ar@x.org');
  await person('amy-lee', { name: 'Amy Lee', group: 'advisory' }, 'al@x.org');
  for (const [applying, slug] of [['Jordan & Amy Rowe', 'amy-rowe'], ['Jordan Quill & Amy Lee', 'amy-lee'], ['Rowe, Jordan & Amy', 'amy-rowe']]) {
    const p = await plan((await applied(applying, `c.${slug}.${applying.length}@x.org`)).id);
    assert.equal(p.kind, 'choose', applying);
    assert.ok(among(p).includes(slug), `${applying}: ${among(p)}`);
  }
});

test('a rename to the address of someone being deleted from People is told so, and once they’re gone, History keeps their versions under it: never another person’s versions filed under theirs', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const { deleteItem } = await import('../functions/api/delete-content.js');
  await person('rae-rook', { name: 'Rae Rook', group: 'advisory' }, 'rae@x.org');
  await person('sam-sole', { name: 'Sam Sole', group: 'team' }, 'sam@x.org');
  // (slowed after their row is gone, as the tester did)
  const g = gate(/^\s*INSERT INTO audit_log/);
  const deleting = deleteItem(env, { path: 'src/content/team/rae-rook.json', message: 'Remove Rae Rook' }, 'linzi@soardcharity.com');
  await g.reached;
  const during = await rename(env, { collection: 'team', from: 'sam-sole', to: 'rae-rook' }, 'linzi@soardcharity.com');
  assert.deepEqual([during.status, during.body.error], [409, '“rae-rook” is being deleted on People right now. Pick another address.']);
  g.open();
  await deleting;
  const after = await rename(env, { collection: 'team', from: 'sam-sole', to: 'rae-rook' }, 'linzi@soardcharity.com');
  assert.deepEqual([after.status, after.body.error], [409, '“rae-rook” was someone’s address on People, and History keeps their versions under it. Pick another.']);
  assert.ok(await rec('sam-sole'), 'Sam keeps the address they had');
  // ...and a delete while a rename holds them is said as a change on People, as before
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind('edit:sam-sole', Date.now()).run();
  await assert.rejects(deleteItem(env, { path: 'src/content/team/sam-sole.json', message: 'x' }, 'linzi@soardcharity.com'),
    (e) => e.status === 409 && e.message === 'Someone is changing this person on People right now (their web address, or a delete). Try again in a moment.');
});

test('the database not answering when a press, a rename or a People delete takes its hold: said in words, never "D1_ERROR", and never "stopped partway" when nothing started', async () => {
  const { rename, onRequestPost: renamePost } = await import('../functions/api/rename-content.js');
  const { deleteItem, onRequestPost: deletePost } = await import('../functions/api/delete-content.js');
  await person('hal-held', { name: 'Hal Held', group: 'team' }, 'hal@x.org');
  const app = await applied('Ivy Hold', 'ivy@x.org');
  const key = (await plan(app.id)).key;
  const real = env.DB.prepare.bind(env.DB);
  const fault = (re) => { let n = 1; env.DB.prepare = (sql) => (re.test(sql) && n-- > 0 ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR: qa fault'); }, first: async () => { throw new Error('D1_ERROR: qa fault'); }, all: async () => { throw new Error('D1_ERROR: qa fault'); } }) } : real(sql)); };
  fault(/INSERT OR IGNORE INTO advisory_add_holds/);
  const r = await add(app.id, 'new', key);
  env.DB.prepare = real;
  assert.equal(r.error, 'The site’s database didn’t answer just now, so nobody was added. Press Add to Advisory Board again in a moment.');
  assert.equal(await rec('ivy-hold'), null, 'nobody added');
  assert.equal((await add(app.id, 'new')).success, true, 'the next press adds them');
  fault(/INSERT OR IGNORE INTO advisory_add_holds/);
  const rn = await rename(env, { collection: 'team', from: 'hal-held', to: 'hal-new' }, 'linzi@soardcharity.com');
  env.DB.prepare = real;
  assert.deepEqual([rn.status, rn.body.error], [503, 'The site’s database didn’t answer just now, so the address wasn’t changed. Try again in a moment.']);
  assert.ok(await rec('hal-held'));
  fault(/INSERT OR IGNORE INTO advisory_add_holds/);
  await assert.rejects(deleteItem(env, { path: 'src/content/team/hal-held.json', message: 'x' }, 'linzi@soardcharity.com'),
    (e) => e.status === 503 && e.message === 'The site’s database didn’t answer just now, so nobody was deleted. Try again in a moment.');
  env.DB.prepare = real;
  assert.ok(await rec('hal-held'));
  // ...and any other step that stops the endpoints before anything changed: words, never D1's own
  const req = (url, body) => ({ env, request: new Request(`https://site.test${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
  // (the delete runs in one batch with the copy History keeps of it: failed as D1 fails a batch, whole)
  await env.DB.exec("CREATE TRIGGER qa_no_delete BEFORE DELETE ON team BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END");
  const d = await deletePost(req('/api/delete-content', { path: 'src/content/team/hal-held.json', message: 'x' }));
  await env.DB.exec('DROP TRIGGER qa_no_delete');
  assert.deepEqual([d.status, (await d.json()).error], [500, 'Nothing was deleted: the site’s database didn’t answer just now. Try again in a moment.']);
  assert.ok(await rec('hal-held'));
  fault(/^SELECT slug FROM team WHERE slug = \?$/);
  const n = await renamePost(req('/api/rename-content', { collection: 'team', from: 'hal-held', to: 'hal-new' }));
  env.DB.prepare = real;
  assert.deepEqual([n.status, (await n.json()).error], [500, 'The address wasn’t changed: the site’s database didn’t answer just now. Try again in a moment.']);
  // (History that can't be looked at stops the rename too: never taken as nobody's)
  fault(/FROM content_versions WHERE collection = 'team'/);
  const h = await renamePost(req('/api/rename-content', { collection: 'team', from: 'hal-held', to: 'hal-new' }));
  env.DB.prepare = real;
  assert.equal(h.status, 500);
  assert.ok(await rec('hal-held'));
  assert.equal(await rec('hal-new'), null);
});

test('a delete that stops, of an application whose headshot became their People photo, says only that it didn’t finish', async () => {
  const a = await applied('Pia Photo', 'pia@x.org');
  assert.equal((await add(a.id, 'new')).success, true);
  const real = env.DB.prepare.bind(env.DB);
  const throwing = { bind: () => ({ run: async () => { throw new Error('D1_ERROR: busy'); } }) };
  env.DB.prepare = (sql) => (/^DELETE FROM advisory_applications WHERE id = \?$|SET deleting_at = NULL/.test(sql) ? throwing : real(sql));
  const r = await (await adminApi.onRequestPost(ctx('POST', { remove: { id: a.id } }))).json();
  env.DB.prepare = real;
  assert.equal(r.error, 'Deleting this application didn’t finish: it’s still here. Press Delete application again to finish it.');
  assert.ok((await rec('pia-photo'))?.photo, 'still their photo on People');
});

test('someone on People matched only by the web address a new record would take is said as that, never as a name like theirs', async () => {
  await person('pat-newman', { name: 'Zed Other', group: 'advisory' }, 'zo@x.org');
  const p = await plan((await applied('Pat Newman', 'pn@x.org')).id);
  assert.deepEqual([p.kind, p.person?.slug, p.byAddress], ['choose', 'pat-newman', true]);
  await person('jo-ames', { name: 'Jo Ames', group: 'advisory' }, 'jo@x.org');
  const q = await plan((await applied('Jo Ames', 'jo2@x.org')).id);
  assert.deepEqual([q.kind, q.person?.slug, q.byAddress], ['choose', 'jo-ames', undefined]);
});

test('greetings, round fifteen: a family name in parts with no first name is greeted by the title and the whole name, never "Thank you, De"; couples with a title and a family name on the second; initials typed against a name before a comma or O’; degrees with a dot inside; fillers in brackets; nothing guessed', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  for (const [n, g] of [
    ['Mr. and Mrs. St. James', ''] /* r20: two people, or someone not named ("and"): no name */, ['St. James, Rev.', ''] /* r20: initials or a word with a full stop: no name */, ['Mr. and Mrs. De La Cruz', ''] /* r20: two people, or someone not named ("and"): no name */, ['Mrs. De La Cruz', ''] /* r20: "De" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */,
    ['Van Dyke, Dr.', ''] /* r20: a comma: no name */, ['Van Dyke, Mrs.', ''] /* r20: a comma: no name */, ['Mrs. Van Dyke', ''] /* r20: "Van" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['MR. AND MRS. QUILL', ''] /* r20: two people, or someone not named ("and"): no name */, ['mr. and mrs. quill', ''] /* r20: two people, or someone not named ("and"): no name */,
    // (no title: a family name in parts alone, or a first name that may run on, is greeted without a name)
    ['De La Cruz', ''], ['St. James', ''], ['De La Cruz, M.', ''], ['Van Dyke, J.', ''], ['Van Dyke, Jordan T. Jr.', ''], ['J. Van Dyke', ''], ['La Donna Brown', ''], ['Le Thi Hoa', ''],
    ['J. De La Cruz', ''] /* r20: initials or a word with a full stop: no name */, ['Van Morrison', ''] /* r20: "Van" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Del Taylor', ''] /* r20: "Del" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Maria De La Cruz', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */,
    // (couples)
    ['T. J. & Amy Quill', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan & Dr. Quill', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan & Mrs. Quill', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan Quill & Mrs. Lee', ''] /* r20: two people ("&" or "+"): no name */,
    ['Quill, Jordan & Dr. Amy', ''] /* r20: two people ("&" or "+"): no name */, ['Quill, Jordan & Lee, Amy', ''], ['Jordan & Amy Quill', ''] /* r20: two people ("&" or "+"): no name */,
    // (initials typed against the name)
    ['J.K.Rowling, PhD', ''] /* r20: a comma: no name */, ['J.K.Rowling, Jr.', ''] /* r20: a comma: no name */, ['T.J.Brooks, CPA', ''] /* r20: a comma: no name */, ["T.J.O'Brien", ''] /* r20: initials or a word with a full stop: no name */, ["A.J.D'Souza", ''] /* r20: initials or a word with a full stop: no name */,
    // (degrees with a dot inside, and no full stop at the end)
    ['Jordan Ames, M.Ed', 'Jordan'], ['Jordan Ames, M.Div', 'Jordan'], ['Jordan Ames, M.Sc', 'Jordan'], ['Jordan Ames M.Ed', 'Jordan'], ['Jordan Ames, M.Arch', 'Jordan'], ['Jordan March', 'Jordan']]) {
    assert.equal(greetName({ fullName: n }), g, n);
  }
  for (const [pref, g] of [['N.A.', 'Jordan'], ['N.A', 'Jordan'], ['n.a', 'Jordan'], ['n.a.', 'Jordan'], ['(none)', 'Jordan'], ['[none]', 'Jordan'], ['-none-', 'Jordan'], ['-', 'Jordan'],
    ['j.j.', 'Jordan'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Jordan" */, ['d.j.', 'Jordan'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Jordan" */, ['Jo,', 'Jordan'] /* r20: a comma in the name they go by: set aside, their full name's "Jordan" */, ['(Jo)', 'Jordan'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Jordan" */, ['"Jo"', 'Jordan'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Jordan" */, ['Nil', 'Jordan'] /* r20: "Nil" isn't on the given-names list (a word as often as a name): set aside, their full name's "Jordan" */]) {
    assert.equal(greetName({ fullName: 'Jordan Ames', preferredName: pref }), g, pref);
  }
  // ...and a degree with a dot inside is never made part of a new record's address
  const app = await applied('Jordan Ames M.Ed', 'jam.ed@x.org');
  assert.equal((await plan(app.id)).slug, 'jordan-ames');
  // ...and the thank-you's copy reads as one sentence: the title and name, one full stop
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  // (r20: two people and titles: no name; a comma in the name they go by: set aside, their full name's first name)
  assert.equal(applicantEmail(await applied('Mr. and Mrs. St. James', 'stj@x.org')).text.split('\n')[0], 'Thank you.');
  assert.equal(applicantEmail(await applied('Jordan Ames', 'jo.pref@x.org', { preferredName: 'Jo,' })).text.split('\n')[0], 'Thank you, Jordan.');
});

// ─── Round 16 ───────────────────────────────────────────────────────

test('round 16: a People delete whose first read doesn’t answer stops: nothing deleted, never gone with nothing kept in History and its address free', async () => {
  const { onRequestPost: deletePost } = await import('../functions/api/delete-content.js');
  await person('del-read', { name: 'Del Read', group: 'advisory' }, 'dr@x.org');
  const real = env.DB.prepare.bind(env.DB);
  let n = 1;
  env.DB.prepare = (sql) => (/^SELECT data FROM team WHERE slug = \?$/.test(sql) && n-- > 0 ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: qa fault'); } }) } : real(sql));
  const d = await deletePost({ env, request: new Request('https://site.test/api/delete-content', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'src/content/team/del-read.json', message: 'x' }) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
  env.DB.prepare = real;
  assert.deepEqual([d.status, (await d.json()).error], [500, 'Nothing was deleted: the site’s database didn’t answer just now. Try again in a moment.']);
  assert.ok(await rec('del-read'), 'still on People');
  assert.equal(await emailOf('del-read'), 'dr@x.org');
});

test('round 16: a rename, or a second delete, of someone being deleted on People is told they’re being deleted', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const { deleteItem } = await import('../functions/api/delete-content.js');
  await person('dee-gone', { name: 'Dee Gone', group: 'advisory' }, 'dg@x.org');
  const g = gate(/^\s*INSERT INTO audit_log/);
  const deleting = deleteItem(env, { path: 'src/content/team/dee-gone.json', message: 'Remove Dee Gone' }, 'linzi@soardcharity.com');
  await g.reached;
  const r = await rename(env, { collection: 'team', from: 'dee-gone', to: 'dee-new' }, 'linzi@soardcharity.com');
  assert.deepEqual([r.status, r.body.error], [409, 'This person is being deleted on People right now, so their address wasn’t changed.']);
  await assert.rejects(deleteItem(env, { path: 'src/content/team/dee-gone.json', message: 'x' }, 'linzi@soardcharity.com'),
    (e) => e.status === 409 && e.message === 'This person is being deleted on People right now, in another tab or by someone else.');
  g.open();
  await deleting;
  assert.equal(await rec('dee-gone'), null);
});

test('round 16: a press that hasn’t written anything when the database stops answering (its hold on the People record, a read) says nobody was added', async () => {
  await person('hal-hold', { name: 'Hal Hold', group: 'advisory' }, 'hh@x.org');
  const app = await applied('Hal Hold', 'hal.new@x.org');
  const key = (await plan(app.id)).key;
  const real = env.DB.prepare.bind(env.DB);
  const throwing = { bind: () => ({ run: async () => { throw new Error('D1_ERROR: qa fault'); }, first: async () => { throw new Error('D1_ERROR: qa fault'); }, all: async () => { throw new Error('D1_ERROR: qa fault'); } }) };
  const NOBODY = 'The site’s database didn’t answer just now, so nobody was added. Press Add to Advisory Board again in a moment.';
  // (the third hold is the People record's: the application's and its email's come first)
  let n = 0;
  env.DB.prepare = (sql) => (/INSERT OR IGNORE INTO advisory_add_holds/.test(sql) && ++n === 3 ? throwing : real(sql));
  const r = await add(app.id, 'same', key);
  env.DB.prepare = real;
  assert.equal(r.error, NOBODY);
  // ...and a read inside the press, before it writes
  let m = 1;
  env.DB.prepare = (sql) => (/^SELECT data FROM team WHERE slug = \?$/.test(sql) && m-- > 0 ? throwing : real(sql));
  const r2 = await add(app.id, 'same', key);
  env.DB.prepare = real;
  assert.equal(r2.error, NOBODY);
  assert.ok(!(await getAdvisoryApplication(env.DB, app.id)).personSlug, 'nothing linked');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_add_holds').first()).n, 0, 'nothing left held');
  assert.equal((await add(app.id, 'same')).success, true, 'the next press adds them');
});

test('round 16: names. A couple after a family name of more than one word; degrees with a dot inside that aren’t on any list; a couple’s second title written last name first; letters after a first name typed all in capitals', async () => {
  const { readName, greetName } = await import('../functions/api/_advisory-form.js');
  const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)];
  let k = 0;
  const box = async (n) => plan((await applied(n, `r16.${++k}@x.org`)).id);
  // A couple after the comma: the other one asked about, by their name with the family name
  await person('jose-garcia-lopez', { name: 'Jose Garcia Lopez', group: 'advisory' }, 'jgl@x.org');
  await person('jane-van-buren', { name: 'Jane Van Buren', group: 'advisory' }, 'jvb@x.org');
  for (const [n, slug] of [['Garcia Lopez, Maria & Jose', 'jose-garcia-lopez'], ['Garcia Lopez, Maria and Jose', 'jose-garcia-lopez'], ['Van Buren, Martin & Jane', 'jane-van-buren']]) {
    const p = await box(n);
    assert.equal(p.kind, 'choose', n);
    assert.ok(among(p).includes(slug), `${n}: ${among(p)}`);
  }
  // Degrees written with a dot inside: letters, never split as initials, the name kept as typed
  await person('jordan-ames', { name: 'Jordan Ames', group: 'advisory' }, 'ja@x.org');
  for (const d of ['M.Eng', 'B.Eng', 'B.Arch', 'M.Tech', 'B.Tech', 'B.Com', 'M.Com', 'M.Fin', 'B.Pharm', 'M.Pharm', 'B.Des', 'M.Sci']) {
    for (const n of [`Jordan Ames ${d}`, `Jordan Ames, ${d}`]) {
      assert.equal(readName(n).shown, n, n);
      // (r20: letters after the name, with a comma or not, greeted past only when the file knows them: M.Eng, B.Arch, B.Pharm)
      assert.equal(greetName({ fullName: n }), !['M.Eng', 'B.Eng', 'B.Arch', 'B.Pharm', 'M.Pharm'].includes(d) ? '' : 'Jordan', n);
      const p = await box(n);
      assert.deepEqual([p.kind, p.person?.slug], ['choose', 'jordan-ames'], n);
    }
  }
  // ...and two people with the same letters are never taken for each other
  await person('dana-amesae', { name: 'Dana Amesae M.Eng', group: 'advisory' }, 'da@x.org');
  assert.equal((await box('Dana Smith M.Eng')).kind, 'new');
  // (initials typed against a name only where it starts: "J.Ames", "F.Scott Fitzgerald"; a family name in parts typed
  // together stays a name)
  // (r20: initials: no name)
  assert.deepEqual([greetName({ fullName: 'J.Ames' }), greetName({ fullName: 'F.Scott Fitzgerald' }), readName('Mary Jo St.James').words.join(' ')], ['', '', 'Mary Jo St.James']);
  // A couple's second title, written last name first, kept in the name a new record takes
  assert.equal(readName('Rowe, Jordan & Dr. Amy').shown, 'Jordan & Dr. Amy Rowe');
  assert.equal(readName('Rowe, Dr. Jordan & Dr. Amy').shown, 'Dr. Jordan & Dr. Amy Rowe');
  assert.equal(greetName({ fullName: 'Rowe, Jordan & Dr. Amy' }), ''); // (r20: two people: no name)
  assert.equal((await box('Roe, Jordan & Dr. Amy')).asName, 'Jordan & Dr. Amy Roe');
  // Letters after a first name typed all in capitals or small letters: at the end, never in the middle
  for (const [n, shown] of [['AMES, JORDAN MD', 'JORDAN AMES MD'], ['ames, jordan md', 'jordan ames md'], ['AMES, JORDAN MBA', 'JORDAN AMES MBA']]) {
    assert.equal(readName(n).shown, shown, n);
    assert.deepEqual([(await box(n)).kind, (await box(n)).person?.slug], ['choose', 'jordan-ames'], n);
  }
  const quill = await box('QUILL, DANA MD');
  assert.deepEqual([quill.kind, quill.asName, quill.slug], ['new', 'DANA QUILL MD', 'dana-quill']);
});

test('round 16: someone found only by the web address a new record would take is said as that in every box: among several, and as the record a new one is added beside', async () => {
  await person('jordan-ames', { name: 'Pat Smith', group: 'advisory' }, 'ps@x.org');
  await person('jordan-ames-2', { name: 'Jordan Ames', group: 'advisory' }, 'ja2@x.org');
  const p = await plan((await applied('Jordan Ames', 'ja.new@x.org')).id);
  const all = [p.person, ...(p.others || [])];
  assert.equal(p.kind, 'choose');
  assert.deepEqual(all.map((x) => [x.slug, !!x.addressOnly]).sort(), [['jordan-ames', true], ['jordan-ames-2', false]]);
  // A new person beside someone elsewhere on People who has the address their name would get: never "already a Pat Smith"
  await person('dana-roe', { name: 'Lee Other', group: 'board' }, 'lo@x.org');
  const q = await plan((await applied('Dana Roe', 'dana.roe@x.org')).id);
  assert.deepEqual([q.kind, q.namesake?.slug, q.namesake?.addressOnly, q.slug], ['new', 'dana-roe', true, 'dana-roe-2']);
});

test('round 16: a rename moves the private email in the same write as the record: one failing changes nothing, and one left at the new address by nobody is never given to them', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  await person('em-move', { name: 'Em Move', group: 'advisory' }, 'em@x.org');
  await env.DB.prepare("INSERT INTO reveal_board_emails (slug, email) VALUES ('em-new', 'stranger@x.org')").run();
  const r = await rename(env, { collection: 'team', from: 'em-move', to: 'em-new' }, 'linzi@soardcharity.com');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([await emailOf('em-new'), await emailOf('em-move')], ['em@x.org', null]);
  await env.DB.exec("CREATE TRIGGER qa_no_email_move BEFORE UPDATE ON reveal_board_emails BEGIN SELECT RAISE(ABORT, 'qa fault'); END");
  await assert.rejects(rename(env, { collection: 'team', from: 'em-new', to: 'em-newer' }, 'linzi@soardcharity.com'));
  await env.DB.exec('DROP TRIGGER qa_no_email_move');
  assert.ok(await rec('em-new'), 'the record where it was');
  assert.equal(await rec('em-newer'), null);
  assert.equal(await emailOf('em-new'), 'em@x.org', 'its email with it');
});

test('round 16, greetings: couples whose second has a title and a family name in parts or letters after it; a title alone for the second, last name first; initials after "&"; degrees with dots inside; preferred names with another in brackets or long dashes', async () => {
  const { readName, greetName } = await import('../functions/api/_advisory-form.js');
  for (const [n, g, shown, words] of [
    ['Jordan & Mrs. St. James', '' /* r20: two people */, 'Jordan & Mrs. St. James', 'Jordan St. James'],
    ['Jordan & Mrs. De La Cruz', '' /* r20: two people */, 'Jordan & Mrs. De La Cruz', 'Jordan De La Cruz'],
    ['Jordan Quill & Mrs. Van Dyke', '' /* r20: two people */, 'Jordan Quill & Mrs. Van Dyke', 'Jordan Quill'],
    ['Jordan & Dr. Van Dyke', '' /* r20: two people */, 'Jordan & Dr. Van Dyke', 'Jordan Van Dyke'],
    ['Quill, Jordan & Mrs. De La Cruz', '' /* r20: two people */, 'Quill, Jordan & Mrs. De La Cruz' /* r20, rule 8: the second has a family name of their own, so the order typed */, 'Jordan Quill'],
    ['Jordan & Mrs. Quill MD', '' /* r20: two people */, 'Jordan & Mrs. Quill MD', 'Jordan Quill'],
    ['Jordan & Mrs. Quill Jr.', '' /* r20: two people */, 'Jordan & Mrs. Quill Jr.', 'Jordan Quill'],
    ['Quill, Jordan & Mrs.', '' /* r20: two people */, 'Jordan & Mrs. Quill', 'Jordan Quill'],
    ['Quill, Jordan & Dr. Amy', '' /* r20: two people */, 'Jordan & Dr. Amy Quill', 'Jordan Quill'],
    ['Jordan & T. J.', '' /* r20: two people */, 'Jordan & T. J.', 'Jordan'],
    ['Jordan Quill & T. J.', '' /* r20: two people */, 'Jordan Quill & T. J.', 'Jordan Quill'],
    ['Quill, Jordan & T J', '' /* r20: two people */, 'Jordan & T J Quill', 'Jordan Quill'],
    ['Jordan Ames M.Sc.Ed', '' /* r20: letters the file doesn't know */, 'Jordan Ames M.Sc.Ed', 'Jordan Ames'],
    ['Jordan Ames M.Ed.S', '' /* r20: letters the file doesn't know */, 'Jordan Ames M.Ed.S', 'Jordan Ames'],
    ['Jordan Ames Dr.PH', 'Jordan', 'Jordan Ames Dr.PH', 'Jordan Ames'],
    ['Jordan Ames D.Ed', '' /* r20: letters the file doesn't know */, 'Jordan Ames D.Ed', 'Jordan Ames'],
    ['Ames, Jordan M.Eng', '' /* r20: a comma */, 'Jordan Ames M.Eng', 'Jordan Ames'],
    // (titles typed against a name still set apart where a name starts: at the start, after a comma, after "&")
    ['Dr.Jordan Ames', '' /* r20: a title typed against the name is no word of letters */, 'Dr. Jordan Ames', 'Jordan Ames'], ['Quill, Dr.Jordan', '' /* r20: a comma */, 'Dr. Jordan Quill', 'Jordan Quill'],
    ['Jordan & Dr.Amy Quill', '' /* r20: two people */, 'Jordan & Dr. Amy Quill', 'Jordan Quill']]) {
    const r = readName(n);
    assert.deepEqual([greetName({ fullName: n }), r.shown, r.words.join(' ')], [g, shown, words], n);
  }
  for (const [pref, g] of [['Jo (Joanna)', 'Jordan'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Jordan" */, ['Bob (Robert)', 'Jordan'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Jordan" */, ['J.J. (Jordan)', 'Jordan'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Jordan" */, ['—none—', 'Jordan'], ['–none–', 'Jordan'], ['— none —', 'Jordan'], ['(Jo)', 'Jordan'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Jordan" */, ['[none]', 'Jordan'], ['-none-', 'Jordan'], ['Jo,', 'Jordan'] /* r20: a comma in the name they go by: set aside, their full name's "Jordan" */]) {
    assert.equal(greetName({ fullName: 'Jordan Ames', preferredName: pref }), g, pref);
  }
  // ...and through the real copy: one sentence, the right name
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  // (r20: two people: no name; brackets in the name they go by: set aside, their full name's first name)
  assert.equal(applicantEmail(await applied('Jordan & Mrs. St. James', 'stj2@x.org')).text.split('\n')[0], 'Thank you.');
  assert.equal(applicantEmail(await applied('Jordan Ames', 'jo.br@x.org', { preferredName: 'Jo (Joanna)' })).text.split('\n')[0], 'Thank you, Jordan.');
  // (a couple's other one with a family name of their own is matched by it on People too: nothing to match a title and
  // a family name alone with)
  await person('amy-de-la-cruz', { name: 'Amy De La Cruz', group: 'advisory' }, 'adlc@x.org');
  await person('jordan-st-james', { name: 'Jordan St. James', group: 'advisory' }, 'jsj@x.org');
  const p = await plan((await applied('Jordan & Mrs. St. James', 'stj3@x.org')).id);
  assert.deepEqual([p.kind, p.person?.slug], ['choose', 'jordan-st-james']);
});
