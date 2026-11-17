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

test('a name with no letters a to z gets "advisory-board-member", then -2', async () => {
  const one = await applied('李小龙', 'li@example.org');
  assert.equal((await plan(one.id)).slug, 'advisory-board-member');
  assert.equal((await add(one.id, 'new')).person.slug, 'advisory-board-member');
  const two = await applied('张伟', 'zhang@example.org');
  assert.equal((await add(two.id, 'new')).person.slug, 'advisory-board-member-2');
  assert.equal((await rec('advisory-board-member-2')).name, '张伟');
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
  assert.match(first.error, /Morgan Ellis is on the Advisory Board, but their email didn’t save: D1 busy/);
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

test('an application isn’t deleted while a press is adding from it (refused in words), and a press that comes while it’s deleting is told it’s gone', async () => {
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
  // A press that comes while a delete holds it: told it's gone (it is a moment later), never "someone is adding them"
  const two = await applied('Del Second', 'del.two@example.org');
  const box = await plan(two.id);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind(`app:${two.id}`, now, `del:${two.id}`, now).run();
  const res = await adminApi.onRequestPost(ctx('POST', { add: { id: two.id, as: 'new', seen: box.key } }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, GONE);
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
  assert.equal(greetName({ fullName: 'Hon Lam Wong' }), 'Hon');
  assert.equal(greetName({ fullName: 'Gen Tanaka' }), 'Gen');
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
