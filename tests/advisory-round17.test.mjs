/**
 * Advisory Board round 17: the applications admin's Add to Advisory Board, and People's delete and rename, on the
 * server. Made-up people only; Resend (it keeps an Idempotency-Key, as the real one does), Cloudflare Access and Images
 * are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round17.test.mjs
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
let resend;
let access;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', RESEND_API_KEY: 'r', CF_ACCESS_API_TOKEN: 'access-token', CF_ACCESS_AUD: 'aud-admin' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  // Resend as it behaves: an Idempotency-Key it has seen answers with its first answer and sends nothing (the same key
  // with other words: 409)
  resend = { delivered: [], keys: new Map() };
  access = { groups: [], policies: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'api.resend.com') {
      const key = init.headers?.['Idempotency-Key'] || '';
      if (key && resend.keys.has(key)) {
        const had = resend.keys.get(key);
        return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request', message: 'Same key, other words' }, { status: 409 });
      }
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
    // Cloudflare Access: the group the site keeps, its policy, the admin's app using it
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
const add = async (id, as, seen) => {
  const key = seen !== undefined ? seen : (await plan(id))?.key;
  const res = await adminApi.onRequestPost(ctx('POST', { add: { id, as, seen: key } }));
  return { status: res.status, ...(await res.json()) };
};
const rec = async (slug) => JSON.parse((await env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first())?.data || 'null');
const emailOf = async (slug) => (await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(slug).first())?.email || null;
const among = (p) => [p.person?.slug, ...(p.others || []).map((o) => o.slug)].filter(Boolean);
const emailsOn = async () => { const { writeState } = await import('../functions/api/_board-roles.js'); await writeState(env.DB, 'advisory', { emails: true }); };
const mailLog = async () => (await import('../functions/api/_board-roles.js')).readState(env.DB, 'advisory-mail');
const welcomesTo = (email) => resend.delivered.filter((m) => m.subject === 'Your Advisory Board page is ready' && [m.to].flat()[0] === email);
const req = (url, body) => ({ env, request: new Request(`https://site.test${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });

/**
 * The database not answering one statement (the first whose SQL `match` says, after `skip` such), alone or in a batch
 * (D1 fails a batch whole). `after`: only once a statement matching it has run. → undo
 */
function fault(match, { skip = 0, after = null } = {}) {
  const test = typeof match === 'function' ? match : (sql) => match.test(sql);
  const real = env.DB.prepare;
  const realBatch = env.DB.batch;
  let armed = !after;
  let left = 1;
  let skipped = 0;
  const hit = (sql) => {
    if (!armed) { if (after.test(sql)) armed = true; return false; }
    if (left <= 0 || !test(sql)) return false;
    if (skipped < skip) { skipped++; return false; }
    left--;
    return true;
  };
  const boom = () => { throw new Error('D1_ERROR: qa fault'); };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), run: async () => { if (hit(st._sql)) boom(); return st.run(); }, first: async (c) => { if (hit(st._sql)) boom(); return st.first(c); }, all: async () => { if (hit(st._sql)) boom(); return st.all(); } });
  env.DB.prepare = (sql) => wrap(real(sql));
  env.DB.batch = async (stmts) => { for (const s of stmts) if (hit(s._sql)) boom(); return realBatch(stmts); };
  return () => { env.DB.prepare = real; env.DB.batch = realBatch; };
}
/** A statement that waits at `re` until opened (a delete under way, held partway) */
function gate(re) {
  const real = env.DB.prepare;
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
    return { ...st, bind: (...p) => { const b = st.bind(...p); return { ...b, run: wait(b, 'run'), first: wait(b, 'first'), all: wait(b, 'all') }; } };
  };
  return { reached, open: () => { env.DB.prepare = real; open(); } };
}

// ─── M1 ─────────────────────────────────────────────────────────────

test('M1: letters after a couple’s name (MD, PhD, CPA, M.Eng, Jr.) are never part of the second person’s family name: "Jordan & Amy Rowe MD" asks about Amy Rowe, as "Jordan & Amy Rowe" does', async () => {
  const { readName } = await import('../functions/api/_advisory-form.js');
  for (const [n, whole] of [
    ['Jordan & Amy Rowe', 'Amy Rowe'], ['Jordan & Amy Rowe MD', 'Amy Rowe'], ['Jordan & Amy Rowe PhD', 'Amy Rowe'], ['Jordan & Amy Rowe M.Eng', 'Amy Rowe'],
    ['Jordan & Amy Rowe CPA', 'Amy Rowe'], ['Jordan & Amy Rowe Jr.', 'Amy Rowe'], ['Jordan and Amy Rowe MBA', 'Amy Rowe'], ['Jordan & Dr. Amy Rowe MD', 'Amy Rowe'],
    ['Dr. Jordan & Dr. Amy Rowe MD', 'Amy Rowe'], ['Rowe, Jordan & Amy MD', 'Amy Rowe'], ['Rowe, Jordan & Amy M.Eng', 'Amy Rowe'],
    ['Jordan Rowe & Amy Lee CPA', 'Amy Lee'], ['Jordan Rowe & Amy Lee M.Eng', 'Amy Lee'], ['Jordan & Amy Garcia Lopez MD', 'Amy Garcia Lopez'],
  ]) {
    const r = readName(n);
    assert.equal(r.partnerWhole?.join(' '), whole, n);
    // (the name shown and kept stays as typed: written last name first, first name first, as before)
    assert.equal(r.shown, n.startsWith('Rowe, ') ? `Jordan & Amy Rowe ${n.split(' ').pop()}` : n, n);
  }
  await person('amy-rowe', { name: 'Amy Rowe', group: 'advisory' }, 'amy.rowe@example.org');
  await person('amy-lee', { name: 'Amy Lee', group: 'advisory' }, 'amy.lee@example.org');
  let k = 0;
  for (const [n, slug] of [['Jordan & Amy Rowe', 'amy-rowe'], ['Jordan & Amy Rowe MD', 'amy-rowe'], ['Jordan & Amy Rowe PhD', 'amy-rowe'], ['Jordan & Amy Rowe M.Eng', 'amy-rowe'],
    ['Jordan Rowe & Amy Lee CPA', 'amy-lee'], ['Dr. Jordan & Dr. Amy Rowe MD', 'amy-rowe'], ['Rowe, Jordan & Amy MD', 'amy-rowe'], ['JORDAN & AMY ROWE MD', 'amy-rowe']]) {
    const p = await plan((await applied(n, `couple.${++k}@example.org`)).id);
    assert.equal(p.kind, 'choose', `${n}: ${p.kind}`);
    assert.ok(among(p).includes(slug), `${n} asks about ${slug}: ${among(p)}`);
  }
  // ...and a press as the box offers it never makes a second record beside Amy
  const app = await applied('Jordan & Amy Rowe MD', 'rowe.couple@example.org');
  const p = await plan(app.id);
  assert.deepEqual([p.kind, p.person?.slug], ['choose', 'amy-rowe']);
});

test('M1: no two families’ names match because they end in the same letters ("Rowez, Jordan & Amy MD" is never asked about the Roweab couple, nor "… M.Eng" about every "… M.Eng")', async () => {
  await person('jordan-roweab', { name: 'Jordan & Amy Roweab MD', group: 'advisory' }, 'roweab@example.org');
  await person('jordan-rowead', { name: 'Jordan & Amy Rowead M.Eng', group: 'advisory' }, 'rowead@example.org');
  await person('jordan-roweac', { name: 'Jordan & Amy Roweac PhD', group: 'advisory' }, 'roweac@example.org');
  for (const [fam, typed] of [['Rowez', 'Rowez, Jordan & Amy MD'], ['Rowey', 'Jordan & Amy Rowey M.Eng'], ['Rowex', 'Jordan & Amy Rowex PhD'], ['Rowew', 'Jordan & Amy Roweww MD']]) {
    const slug = `amy-${fam.toLowerCase()}`;
    await person(slug, { name: `Amy ${fam}`, group: 'advisory' }, `${slug}@example.org`);
    const p = await plan((await applied(typed, `${fam.toLowerCase()}.couple@example.org`)).id);
    const asked = among(p);
    assert.ok(!asked.some((s) => ['jordan-roweab', 'jordan-rowead', 'jordan-roweac'].includes(s)), `${typed}: asked about another family (${asked})`);
    if (fam !== 'Rowew') assert.ok(asked.includes(slug), `${typed}: asks about Amy ${fam} (${asked})`);
  }
});

// ─── M2 ─────────────────────────────────────────────────────────────

test('M2: a People delete whose History copy can’t be kept deletes nothing, and says so; once it can, it’s deleted with its copy in Recently deleted', async () => {
  const { onRequestPost: deletePost } = await import('../functions/api/delete-content.js');
  const { onRequestPost: renamePost } = await import('../functions/api/rename-content.js');
  const { ensureHistory, listDeleted } = await import('../functions/api/_content-history.js');
  const del = async (slug) => { const r = await deletePost(req('/api/delete-content', { path: `src/content/team/${slug}.json`, message: `Remove ${slug}` })); return { status: r.status, ...(await r.json()) }; };
  const NOTHING = 'Nothing was deleted: the site’s database didn’t answer just now. Try again in a moment.';
  await person('hist-less', { name: 'Hist Less', group: 'advisory' }, 'hist.less@example.org');
  await person('hist-other', { name: 'Hist Other', group: 'advisory' });
  // The copy's own write not answering
  await ensureHistory(env.DB);
  await env.DB.exec("CREATE TRIGGER qa_no_copy BEFORE INSERT ON content_versions BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END");
  const a = await del('hist-less');
  await env.DB.exec('DROP TRIGGER qa_no_copy');
  assert.deepEqual([a.status, a.error], [500, NOTHING]);
  assert.ok(await rec('hist-less'), 'still on People');
  assert.equal(await emailOf('hist-less'), 'hist.less@example.org', 'with their email');
  // ...and History's table not answering when it's made, or its index
  for (const re of [/^CREATE TABLE IF NOT EXISTS content_versions/, /^CREATE INDEX IF NOT EXISTS content_versions_item/]) {
    const undo = fault((sql) => re.test(sql.trim()));
    const b = await del('hist-less');
    undo();
    assert.deepEqual([b.status, b.error], [500, NOTHING], String(re));
    assert.ok(await rec('hist-less'), `still on People (${re})`);
  }
  // (its address still theirs: a rename onto it is refused)
  const onto = await renamePost(req('/api/rename-content', { collection: 'team', from: 'hist-other', to: 'hist-less' }));
  assert.equal(onto.status, 409);
  // The delete itself failing keeps no copy either (one write: both or neither)
  await env.DB.exec("CREATE TRIGGER qa_no_delete BEFORE DELETE ON team BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END");
  const c = await del('hist-less');
  await env.DB.exec('DROP TRIGGER qa_no_delete');
  assert.deepEqual([c.status, c.error], [500, NOTHING]);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM content_versions WHERE slug = 'hist-less'").first()).n, 0, 'no copy of a delete that didn’t happen');
  // Pressed again with nothing failing: deleted, its copy in Recently deleted, and its address kept for it
  const d = await del('hist-less');
  assert.deepEqual([d.status, d.success], [200, true]);
  assert.equal(await rec('hist-less'), null);
  assert.deepEqual((await listDeleted(env.DB, 'team')).map((x) => x.slug), ['hist-less']);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM content_versions WHERE slug = 'hist-less' AND action = 'delete'").first()).n, 1, 'one copy, never two');
  const after = await renamePost(req('/api/rename-content', { collection: 'team', from: 'hist-other', to: 'hist-less' }));
  assert.deepEqual([after.status, (await after.json()).error], [409, '“hist-less” was someone’s address on People, and History keeps their versions under it. Pick another.']);
});

// ─── m1 ─────────────────────────────────────────────────────────────

test('m1: a welcome that went but couldn’t be marked as sent is said as sent, and the heartbeat marks it without sending a second', async () => {
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  await emailsOn();
  const app = await applied('Wes Mark', 'wes.mark@example.org');
  const key = (await plan(app.id)).key;
  // (the write that marks it had, after it went: setEntry('welcomed', …), never the claim, which has conditions)
  const undo = fault((sql) => /^UPDATE board_state SET data = (json_remove\()?json_set\(data, '\$\."welcomed"\.' \|\| json_quote\(/.test(sql)); /* r21: the mark is now one statement that finds its claim as it's written (a rename between finding and marking left it at the old address), so the fault is put on that statement */ /* r26: that statement also takes the owed entry off (json_remove around it) */
  const r = await add(app.id, 'new', key);
  undo();
  assert.equal(r.success, true, r.error);
  assert.deepEqual(r.welcome, { sent: 1 }, 'the press says it was sent');
  assert.equal(welcomesTo('wes.mark@example.org').length, 1);
  await sendWaitingWelcomes(env);
  assert.equal(welcomesTo('wes.mark@example.org').length, 1, 'a heartbeat a moment later sends nothing');
  // Ten minutes on: the "on its way" mark as old as a request that died
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  await env.DB.prepare(`UPDATE board_state SET data = json_set(data, '$.welcomed."wes-mark".sending', ?) WHERE key = 'advisory-mail'`).bind(old).run();
  await sendWaitingWelcomes(env);
  await sendWaitingWelcomes(env);
  assert.equal(welcomesTo('wes.mark@example.org').length, 1, 'one welcome in all');
  const log = await mailLog();
  assert.equal(log.welcomed['wes-mark']?.to, 'wes.mark@example.org', 'marked had, at their address');
  assert.ok(log.welcomed['wes-mark']?.at && !log.welcomed['wes-mark']?.sending);
  assert.equal(log.waiting?.['wes-mark'], undefined, 'and no longer waiting');
});

test('m1: every welcome send carries its own Resend key: the same welcome asked for twice goes once, and Resend’s 409 for it counts as sent', async () => {
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  const { writeState } = await import('../functions/api/_board-roles.js');
  await emailsOn();
  await person('kim-key', { name: 'Kim Key', group: 'advisory' }, 'kim.key@example.org');
  assert.equal((await sendWelcome(env, { slugs: ['kim-key'] })).sent, 1);
  // Its mark lost (as if it never saved), asked for again with the same words, then with other words (a greeting
  // written down since): Resend has it, so neither is a second email, and both are a welcome that went
  for (const greet of [{}, { 'kim-key': 'Kimberly' }]) {
    const log = await mailLog();
    await writeState(env.DB, 'advisory-mail', { ...log, welcomed: {} });
    const r = await sendWelcome(env, { slugs: ['kim-key'], greet });
    assert.equal(r.sent, 1, JSON.stringify(greet));
    assert.equal((await mailLog()).welcomed['kim-key']?.to, 'kim.key@example.org', 'marked had');
  }
  assert.equal(welcomesTo('kim.key@example.org').length, 1, 'one email in all');
});

// ─── m2 ─────────────────────────────────────────────────────────────

test('m2: a rename moves the application links, the welcome record and the private email in the same write as the record: one failing changes nothing, and says so', async () => {
  const { onRequestPost: renamePost } = await import('../functions/api/rename-content.js');
  const { readState, writeState } = await import('../functions/api/_board-roles.js');
  const ren = async (from, to) => { const r = await renamePost(req('/api/rename-content', { collection: 'team', from, to })); return { status: r.status, ...(await r.json()) }; };
  const NOT = 'The address wasn’t changed: the site’s database didn’t answer just now. Try again in a moment.';
  const app = await applied('Lin Move', 'lin.move@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  // (her welcome had, Board's sign-in record for her too, a waiting one for someone else at her address never)
  const log = await readState(env.DB, 'advisory-mail');
  await writeState(env.DB, 'advisory-mail', { ...log, welcomed: { 'lin-move': { at: '2026-11-01T00:00:00.000Z', to: 'lin.move@example.org' } } });
  await writeState(env.DB, 'welcome', { members: { 'lin-move': '2026-11-02T00:00:00.000Z' }, addresses: { 'lin-move': 'lin.move@example.org' }, unconfirmed: ['lin-move', 'some-one'] });
  const where = async (slug) => ({ rec: !!(await rec(slug)), email: await emailOf(slug), app: (await getAdvisoryApplication(env.DB, app.id)).personSlug,
    welcomed: Object.keys((await readState(env.DB, 'advisory-mail')).welcomed || {}), waiting: Object.keys((await readState(env.DB, 'advisory-mail')).waiting || {}) });
  const before = await where('lin-move');
  // The application link's move not answering, then the welcome record's: nothing moved
  for (const [trigger, what] of [
    ["CREATE TRIGGER qa_t BEFORE UPDATE OF person_slug ON advisory_applications BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END", 'the application link'],
    ["CREATE TRIGGER qa_t BEFORE UPDATE ON board_state WHEN NEW.key = 'advisory-mail' BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END", 'the welcome record'],
  ]) {
    await env.DB.exec(trigger);
    const r = await ren('lin-move', 'lin-moved');
    await env.DB.exec('DROP TRIGGER qa_t');
    assert.deepEqual([r.status, r.error], [500, NOT], what);
    assert.deepEqual(await where('lin-move'), before, `${what}: everything where it was`);
    assert.equal(await rec('lin-moved'), null, what);
  }
  // Nothing failing: all of it moves
  const ok = await ren('lin-move', 'lin-moved');
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const now = await where('lin-moved');
  assert.deepEqual([now.rec, now.email, now.app, now.welcomed], [true, 'lin.move@example.org', 'lin-moved', ['lin-moved']]);
  assert.deepEqual(await readState(env.DB, 'welcome'), { members: { 'lin-moved': '2026-11-02T00:00:00.000Z' }, addresses: { 'lin-moved': 'lin.move@example.org' }, unconfirmed: ['lin-moved', 'some-one'] }, 'Board’s sign-in record follows too');
  // ...so a later application from her is the same person, already welcomed: no second welcome
  await emailsOn();
  const again = await applied('Lin Move', 'lin.move@example.org', { why: 'A year later.' });
  const p = await plan(again.id);
  assert.deepEqual([p.kind, p.person?.slug, p.person?.welcomed], ['same', 'lin-moved', true]);
  const pressed = await add(again.id, 'same', p.key);
  assert.equal(pressed.success, true, pressed.error);
  assert.equal(welcomesTo('lin.move@example.org').length, 0, 'never sent a second welcome');
});

test('m2: a welcome waiting (not had yet) moves with the rename too, and a press of Add partway follows it', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const app = await applied('Pip Wait', 'pip.wait@example.org');
  assert.equal((await add(app.id, 'new')).success, true); // (emails off: it waits)
  await env.DB.prepare('INSERT OR REPLACE INTO advisory_add_intents (app_id, slug, at) VALUES (?, ?, ?)').bind('other-app', 'pip-wait', Date.now()).run();
  const r = await rename(env, { collection: 'team', from: 'pip-wait', to: 'pip-waits' }, 'linzi@soardcharity.com', async () => Response.json({ success: true }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const log = await mailLog();
  assert.ok(log.waiting['pip-waits'] && !log.waiting['pip-wait'], 'waiting at the new address');
  assert.equal((await env.DB.prepare("SELECT slug FROM advisory_add_intents WHERE app_id = 'other-app'").first()).slug, 'pip-waits');
});

// ─── m3 ─────────────────────────────────────────────────────────────

test('m3: during a People delete, the Add box and the press say they’re being deleted, never "being changed"; the address case says it’s being freed by a delete', async () => {
  const { deleteItem } = await import('../functions/api/delete-content.js');
  await person('eve-edit', { name: 'Eve Edit', group: 'advisory' }, 'eve.work@example.org');
  const app = await applied('Eve Edit', 'eve.home@example.org');
  const box = await plan(app.id);
  assert.deepEqual([box.kind, box.person?.slug], ['choose', 'eve-edit']);
  // Eve's delete on People, held partway (it has her, its first read of her record waiting)
  const g = gate(/^SELECT data FROM team WHERE slug = \?$/);
  const deleting = deleteItem(env, { path: 'src/content/team/eve-edit.json', message: 'Remove Eve Edit' }, 'linzi@soardcharity.com');
  await g.reached;
  const waiting = await plan(app.id);
  assert.deepEqual([waiting.busy, waiting.busyName, waiting.busyEditing, waiting.busyGone], [true, 'Eve Edit', 'person', true]);
  const pressed = await add(app.id, 'same', box.key);
  assert.deepEqual([pressed.status, pressed.error], [409, 'Eve Edit is being deleted on People right now, so nobody was added. Look again once that’s done.']);
  g.open();
  await deleting;
  assert.equal(await rec('eve-edit'), null);
  // The address a new person would get, being freed by a delete (held there right now)
  const fresh = await applied('Fay Free', 'fay.free@example.org');
  const p = await plan(fresh.id);
  assert.deepEqual([p.kind, p.slug], ['new', 'fay-free']);
  const at = Date.now();
  for (const k of ['slug:fay-free', 'edit:fay-free', 'gone:fay-free']) await env.DB.prepare('INSERT OR REPLACE INTO advisory_add_holds (key, at) VALUES (?, ?)').bind(k, at).run();
  const q = await plan(fresh.id);
  assert.deepEqual([q.busy, q.busyEditing, q.busyGone], [true, 'address', true]);
  const r = await add(fresh.id, 'new', p.key);
  assert.deepEqual([r.status, r.error], [409, 'The web address they’d be given is being freed by a delete on People right now, so nobody was added. Look again once that’s done.']);
  // ...and a rename there (no gone: hold) is still said as a change
  await env.DB.prepare("DELETE FROM advisory_add_holds WHERE key = 'gone:fay-free'").run();
  const c = await plan(fresh.id);
  assert.deepEqual([c.busyEditing, c.busyGone], ['address', undefined]);
});

// ─── m4 ─────────────────────────────────────────────────────────────

test('m4: the welcome step’s read of People or private emails failing is never "add a working email": it says the site couldn’t check, and the heartbeat sends it', async () => {
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  const { syncBoardAccess } = await import('../functions/api/_board-access.js');
  await emailsOn();
  let k = 0;
  for (const read of ['SELECT t.slug AS slug, t.data AS data, e.email AS email FROM team AS t LEFT JOIN reveal_board_emails AS e ON e.slug = t.slug']) { /* r21: People and their private emails are read in one statement now (two reads could fall either side of a rename), so that one read is the one made to fail */
    const email = `read.${++k}@example.org`;
    const app = await applied(`Rae Read${'abc'[k]}`, email);
    const key = (await plan(app.id)).key;
    // (the read inside the welcome: the first after the application is Joined)
    const undo = fault((sql) => sql.trim() === read, { after: /^UPDATE advisory_applications SET person_slug = \?, status = 'joined'/ });
    const r = await add(app.id, 'new', key);
    undo();
    assert.equal(r.success, true, r.error);
    assert.deepEqual(r.welcome, { waiting: true, why: 'check' }, read);
    assert.equal(await emailOf(r.person.slug), email, 'their email is on file');
    assert.equal(welcomesTo(email).length, 0);
    // (the heartbeat: the sign-in list brought up to date, then the welcomes waiting for it)
    await syncBoardAccess(env);
    await sendWaitingWelcomes(env);
    assert.equal(welcomesTo(email).length, 1, `${read}: the heartbeat sends it`);
  }
});

// ─── m5 ─────────────────────────────────────────────────────────────

test('m5: someone with their name elsewhere on People is named beside whoever holds the web address the name would get', async () => {
  // A new person: Pat (Team) at the address, Jordan Ames on the board at another
  await person('jordan-ames', { name: 'Pat Smith', group: 'team' }, 'pat@example.org');
  await person('jordan-ames-2', { name: 'Jordan Ames', group: 'board' }, 'ja.board@example.org');
  const p = await plan((await applied('Jordan Ames', 'ja.new@example.org')).id);
  assert.equal(p.kind, 'new');
  assert.deepEqual([p.namesake?.name, p.namesake?.where, !!p.namesake?.addressOnly], ['Pat Smith', 'People → Team', true]);
  assert.deepEqual([p.namesakeToo?.name, p.namesakeToo?.where, p.namesakeToo?.slug, !!p.namesakeToo?.addressOnly], ['Jordan Ames', 'People → Board', 'jordan-ames-2', false]);
  // The box asking about someone on People → Advisory found only by the address: the namesake on the board named too
  await person('dana-roe', { name: 'Lee Other', group: 'advisory' }, 'lee@example.org');
  await person('dana-roe-2', { name: 'Dana Roe', group: 'board' }, 'dana.board@example.org');
  const q = await plan((await applied('Dana Roe', 'dana.new@example.org')).id);
  assert.deepEqual([q.kind, q.byAddress, q.person?.slug], ['choose', true, 'dana-roe']);
  assert.deepEqual([q.namesakeToo?.name, q.namesakeToo?.where], ['Dana Roe', 'People → Board']);
  // (with nobody at the address, the namesake alone, as before)
  await person('rio-vale-2', { name: 'Rio Vale', group: 'board' }, 'rio@example.org');
  const r = await plan((await applied('Rio Vale', 'rio.new@example.org')).id);
  assert.deepEqual([r.kind, r.namesake?.slug, r.namesakeToo], ['new', 'rio-vale-2', undefined]);
});

// ─── m6 ─────────────────────────────────────────────────────────────

test('m6: the welcome greets them as their application’s copy does, and with no first name to use, by none at all', async () => {
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  let k = 0;
  for (const [typed, hi, heading, copy] of [
    ['Garcia Lopez, Maria & Jose', 'Hello,', 'Welcome to the Advisory Board', 'Thank you.'],
    ['DE LA CRUZ, MARIA', 'Hello,', 'Welcome to the Advisory Board', 'Thank you.'],
    ['de la cruz, ana & luis', 'Hello,', 'Welcome to the Advisory Board', 'Thank you.'],
    // (r20: two people, "&", are greeted by no name; and People keeps this one's words in the order typed, rule 8)
    ['Quill, Jordan & Mrs. De La Cruz', 'Hello,', 'Welcome to the Advisory Board', 'Thank you.'],
    // (r20: a comma means no name in the copy, and the welcome greets exactly as the copy does, never from the name People
    // keeps: one greeting, greetName of what they sent)
    ['Ames, Jordan', 'Hello,', 'Welcome to the Advisory Board', 'Thank you.'],
  ]) {
    const email = `greet.${++k}@example.org`;
    const app = await applied(typed, email);
    assert.equal(applicantEmail(app).text.split('\n')[0], copy, typed);
    const r = await add(app.id, 'new'); // (emails off: it waits, with the name its application gave)
    assert.equal(r.success, true, r.error);
    await emailsOn();
    const greet = (await mailLog()).waiting[r.person.slug]?.greet;
    assert.equal((await sendWelcome(env, { slugs: [r.person.slug], greet: greet ? { [r.person.slug]: greet } : {} })).sent, 1, typed);
    const mail = welcomesTo(email)[0];
    assert.equal(mail.text.split('\n')[0], hi, typed);
    assert.match(mail.html, new RegExp(`>${heading.replace(/[.]/g, '\\.')}<`), typed);
    assert.ok(!mail.html.includes(`Welcome, ${typed}`) && !mail.text.includes(`Hi ${typed},`), `never the name as typed: ${typed}`);
    const { writeState } = await import('../functions/api/_board-roles.js');
    await writeState(env.DB, 'advisory', { emails: false });
  }
});

// ─── m7 ─────────────────────────────────────────────────────────────

test('m7: a press that wrote only its own note when the database stopped answering says nobody was added, and pressing again adds them once', async () => {
  const app = await applied('Nia Note', 'nia.note@example.org');
  const key = (await plan(app.id)).key;
  const undo = fault((sql) => /^INSERT INTO team /.test(sql.trim()));
  const r = await add(app.id, 'new', key);
  undo();
  assert.deepEqual([r.status, r.error], [503, 'The site’s database didn’t answer just now, so nobody was added. Press Add to Advisory Board again in a moment.']);
  assert.equal(await rec('nia-note'), null, 'no People record');
  assert.equal((await getAdvisoryApplication(env.DB, app.id)).personSlug, null, 'no link');
  assert.equal(await emailOf('nia-note'), null, 'no email kept');
  // Pressed again (the box asked again, as the panel does): one record, linked, at the address the note kept
  const again = await add(app.id, 'new');
  assert.equal(again.success, true, again.error);
  assert.equal(again.person.slug, 'nia-note');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM team WHERE slug LIKE 'nia-note%'").first()).n, 1);
  // ...and once their record is there, a press that stops after it still says it stopped partway
  const app2 = await applied('Ola Later', 'ola.later@example.org');
  const k2 = (await plan(app2.id)).key;
  const undo2 = fault((sql) => /^UPDATE advisory_applications SET person_slug = \?, updated_at = \?/.test(sql.trim()));
  const r2 = await add(app2.id, 'new', k2);
  undo2();
  assert.equal(r2.status, 503);
  assert.match(r2.error, /^Adding them stopped partway/);
});

// ─── The public form's names (round 17, public) ─────────────────────

test('P1: a title, one family name, then letters (dotted or not, MBA and MEng too) greets them by the title and the name, and Add’s web address is the one the title and name alone would get', async () => {
  const { readName, greetName } = await import('../functions/api/_advisory-form.js');
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  let k = 0;
  // (r20: a title and a family name is no given name, so every one of these now has no name: "Thank you.". Add's web
  // address and the name kept are as before)
  for (const [typed, greet] of [
    ['Mrs. Quill M.Eng', ''], ['Mr. & Mrs. Quill B.Arch', ''], ['Dr. Quill B.Pharm', ''], ['Mrs. Quill MEng', ''],
    ['Mrs. Quill MBA', ''], ['Mrs. Quill M.B.A.', ''], ['MRS. QUILL MBA', ''],
    // (as before)
    ['Mrs. Quill M.Ed', ''], ['Mrs. Quill PhD', ''], ['Mr. & Mrs. Quill, B.Arch', ''], ['Mrs. Quill', ''],
  ]) {
    assert.equal(greetName({ fullName: typed }), greet, typed);
    const app = await applied(typed, `quill.${++k}@example.org`);
    assert.equal(applicantEmail(app).text.split('\n')[0], greet ? `Thank you, ${greet}.` : 'Thank you.', typed);
    const p = await plan(app.id);
    assert.deepEqual([p.kind, p.slug, p.asName], ['new', 'quill', undefined], `${typed}: at quill, the name kept as typed`);
    assert.equal(readName(typed).shown, typed);
  }
  // A name written with its letters stays a name when nothing says it's letters: "Jack MA" is Jack Ma, "McKenzie" a name
  assert.deepEqual([readName('Jack MA').words, readName('Jordan McKenzie').words, readName('Jordan DeShawn').words, readName('Jordan March').words],
    [['Jack', 'MA'], ['Jordan', 'McKenzie'], ['Jordan', 'DeShawn'], ['Jordan', 'March']]);
  assert.deepEqual([greetName({ fullName: 'Jordan Ames M.Eng' }), greetName({ fullName: 'Jordan Ames, MEng' })], ['Jordan', 'Jordan']);
});

test('P2: a preferred name with more after a dash, comma or slash is greeted by the name before it, and no dash, bracket or slash is ever in a greeting', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  const greet = (preferredName) => greetName({ fullName: 'Joanna Ames', preferredName });
  // (r20: a name they go by with a dash, comma, slash or bracket around it, or one not on the given-names list ("T-Bone"),
  // is set aside and their full name read: "Joanna". Still never a dash, bracket or slash in a greeting)
  for (const [pref, g] of [
    ['Jo — she/her', 'Joanna'], ['Jo - she/her', 'Joanna'], ['Jo – Joanna', 'Joanna'], ['Jo, she/her', 'Joanna'], ['Jo / Joanna', 'Joanna'], ['(Jo) Joanna', 'Joanna'],
    ['Jo—Joanna', 'Joanna'], ['Joanna - Jo', 'Joanna'], ['Jo, PhD', 'Joanna'], ['((Jo))', 'Joanna'], ['Jo)', 'Joanna'], ['(Jo', 'Joanna'], [') Jo', 'Joanna'],
    // (as before: one in brackets after it, around it, a hyphen inside a name)
    ['Jo (she/her)', 'Joanna'], ['Jo (Joanna)', 'Joanna'], ['(Jo)', 'Joanna'], ['Jo-Ann', 'Jo-Ann'], ['Mary-Kate', 'Mary-Kate'], ['T-Bone', 'Joanna'], ['— Jo —', 'Joanna'],
    // (none given: their first name)
    ['N/A', 'Joanna'], ['(N/A)', 'Joanna'], ['- none -', 'Joanna'], ['she/her', 'Joanna'], ['they/them', 'Joanna'],
  ]) {
    const got = greet(pref);
    assert.equal(got, g, pref);
    assert.ok(!/[()[\]{}<>/–—]|\s-|-\s/.test(got), `${pref}: no dash, bracket or slash (${got})`);
  }
  const app = await applied('Joanna Ames', 'jo.dash@example.org', { preferredName: 'Jo — she/her' });
  assert.equal(applicantEmail(app).text.split('\n')[0], 'Thank you, Joanna.'); // (r20: set aside, their full name's)
});

test('P3: after the comma, Mr., Mrs., Ms. or Miss and one word are a title and a family name ("Quill, Jordan & Mrs. Lee" is Jordan Quill and Mrs. Lee); Dr. and one word stays their first name', async () => {
  const { greetName, readName } = await import('../functions/api/_advisory-form.js');
  const { applicantEmail } = await import('../functions/api/_advisory-applications.js');
  let k = 0;
  for (const t of ['Mrs.', 'Ms.', 'Mr.', 'Miss']) {
    for (const end of ['', ', PhD']) {
      const typed = `Quill, Jordan & ${t} Lee${end}`;
      // (r20: two people, "&", are greeted by no name; and rule 8: the second one has a family name of their own, so People
      // keeps the words in the order typed, and Add's web address follows that order, its title and letters set apart)
      assert.equal(greetName({ fullName: typed }), '', typed);
      assert.equal(readName(typed).shown, typed, typed);
      const app = await applied(typed, `lee.${++k}@example.org`);
      assert.equal(applicantEmail(app).text.split('\n')[0], 'Thank you.', typed);
      const p = await plan(app.id);
      assert.deepEqual([p.slug, p.asName ?? null], ['quill-jordan-lee', null], typed);
    }
  }
  // ...as without the comma (r20: two people, no name)
  assert.equal(greetName({ fullName: 'Jordan Quill & Mrs. Lee' }), '');
  assert.equal(greetName({ fullName: 'Quill, Jordan & Dr. Amy' }), '');
  assert.equal(greetName({ fullName: 'Quill, Jordan & Mrs. De La Cruz' }), '');
});

test('P4: a preferred name all in capitals, three letters or more, is greeted in ordinary letters; two letters, or capitals inside a name, stay as typed', async () => {
  const { greetName } = await import('../functions/api/_advisory-form.js');
  // (r20: initials with full stops aren't letters, so "J.J." is set aside and their full name read)
  for (const [pref, g] of [['JOANNA', 'Joanna'], ['MARY-KATE', 'Mary-Kate'], ['TJ', 'TJ'], ['AJ', 'AJ'], ['McKenzie', 'McKenzie'], ['DeShawn', 'DeShawn'], ['joanna', 'Joanna'], ['J.J.', 'Joanna']]) {
    assert.equal(greetName({ fullName: 'Joanna Ames', preferredName: pref }), g, pref);
  }
  assert.equal(greetName({ fullName: 'JOANNA AMES' }), 'Joanna', 'as a full name in capitals is');
  assert.equal(greetName({ fullName: 'JOANNA AMES', preferredName: 'JOANNA' }), 'Joanna');
});

test('after the fixer (Nov 21 2026): written last name first with a title on each first name, the titles go with the first names, as "Dr." does', async () => {
  const { readName, greetName } = await import('../functions/api/_advisory-form.js');
  // (r20: two people are greeted by no name; People's name for the couples who share Quill is as before, and for the one
  // whose second has a family name of their own it keeps the order typed, rule 8)
  for (const [name, shown, greet] of [
    ['Quill, Mr. Jordan & Mrs. Amy', 'Mr. Jordan & Mrs. Amy Quill', ''],
    ['Quill, Ms. Jordan & Mr. Amy', 'Ms. Jordan & Mr. Amy Quill', ''],
    ['Quill, Dr. Jordan & Dr. Amy', 'Dr. Jordan & Dr. Amy Quill', ''],
    // (no title on the first one: Mrs. goes before a family name, P3)
    ['Quill, Jordan & Mrs. Lee', 'Quill, Jordan & Mrs. Lee', ''],
  ]) {
    assert.equal(readName(name).shown, shown, name);
    assert.equal(greetName({ fullName: name, name }), greet, name);
  }
});

test('after the fixer (Nov 21 2026): a rename whose board records don’t all follow at once says so, and they’re finished by the heartbeat, never left at the old address', async () => {
  const { rename } = await import('../functions/api/rename-content.js');
  const { maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  const { ensureSchema } = await import('../functions/api/_board.js');
  await ensureSchema(env.DB);
  const app = await applied('Rae Follow', 'rae.follow@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  // (a visit to the board page kept under her address: a board record the rename's one write can't take)
  await env.DB.prepare('INSERT OR REPLACE INTO board_seen (slug, at) VALUES (?, ?)').bind('rae-follow', '2026-11-01T00:00:00.000Z').run();
  await env.DB.exec("CREATE TRIGGER qa_seen BEFORE UPDATE ON board_seen BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END");
  const r = await rename(env, { collection: 'team', from: 'rae-follow', to: 'rae-follows' }, 'linzi@soardcharity.com', async () => Response.json({ success: true }));
  await env.DB.exec('DROP TRIGGER qa_seen');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.note || '', /still moving to the new address\. That finishes by itself/);
  const seenAt = async (slug) => (await env.DB.prepare('SELECT slug FROM board_seen WHERE slug = ?').bind(slug).first())?.slug || null;
  assert.equal(await seenAt('rae-follow'), 'rae-follow', 'not moved yet');
  assert.ok(await env.DB.prepare("SELECT key FROM board_state WHERE key = 'rename-finish:rae-follow'").first(), 'and written down to finish');
  // Not within the minute (the rename itself may still be at it), then the heartbeat finishes it
  assert.deepEqual(await maybeFinishRenames(env.DB, { now: Date.now() }), []);
  assert.deepEqual(await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000 }), ['rae-follow']);
  assert.equal(await seenAt('rae-follows'), 'rae-follows', 'moved');
  assert.equal(await seenAt('rae-follow'), null);
  assert.equal(await env.DB.prepare("SELECT key FROM board_state WHERE key = 'rename-finish:rae-follow'").first(), null, 'nothing left to finish');
  // Nothing failing: no note, nothing written down
  const r2 = await rename(env, { collection: 'team', from: 'rae-follows', to: 'rae-follow-2' }, 'linzi@soardcharity.com', async () => Response.json({ success: true }));
  assert.equal(r2.status, 200);
  assert.doesNotMatch(r2.body.note || '', /still moving/);
  assert.equal(await env.DB.prepare("SELECT key FROM board_state WHERE key LIKE 'rename-finish:%'").first(), null);
});

// ─── Advisory Board QA round 18 (Nov 21 2026): a rename still finishing is finished before anything else touches either address ───

const r18 = {
  async setup() {
    const { ensureSchema } = await import('../functions/api/_board.js');
    const { ensureAdvisory } = await import('../functions/api/_advisory.js');
    await ensureSchema(env.DB);
    await ensureAdvisory(env.DB);
  },
  // (their visits to the board page, and an answer to the monthly ask: records the rename's one write can't take)
  async records(slug, tag) {
    await env.DB.prepare('INSERT OR REPLACE INTO board_seen (slug, at) VALUES (?, ?)').bind(slug, '2026-11-01T00:00:00.000Z').run();
    await env.DB.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind(`ask-${tag}`, slug, 'yes', tag, '2026-11-01T00:00:00.000Z').run();
  },
  async where(tag) {
    return (await env.DB.prepare('SELECT slug FROM advisory_answers WHERE note = ?').bind(tag).first())?.slug || null;
  },
  seen: async (slug) => !!(await env.DB.prepare('SELECT 1 FROM board_seen WHERE slug = ?').bind(slug).first()),
  // (the board and page moves failing, as the database not answering partway would)
  fail: () => env.DB.exec("CREATE TRIGGER qa_s BEFORE UPDATE ON board_seen BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END; CREATE TRIGGER qa_a BEFORE UPDATE ON advisory_answers BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END;"),
  ok: () => env.DB.exec('DROP TRIGGER IF EXISTS qa_s; DROP TRIGGER IF EXISTS qa_a;'),
  async ren(from, to) {
    const { rename } = await import('../functions/api/rename-content.js');
    return rename(env, { collection: 'team', from, to }, 'linzi@soardcharity.com', async () => Response.json({ success: true }));
  },
};

test('round 18: renamed again within the minute: everything ends at the last address', async () => {
  await r18.setup();
  const app = await applied('Cal Chain', 'cal.chain@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  await r18.records('cal-chain', 'cal');
  await r18.fail();
  const one = await r18.ren('cal-chain', 'cal-b');
  await r18.ok();
  assert.equal(one.status, 200);
  assert.match(one.body.note || '', /still moving/);
  const two = await r18.ren('cal-b', 'cal-c');
  assert.equal(two.status, 200, JSON.stringify(two.body));
  assert.equal(await r18.where('cal'), 'cal-c', 'the answer at the last address');
  assert.ok(await r18.seen('cal-c') && !(await r18.seen('cal-b')) && !(await r18.seen('cal-chain')), 'and the visits');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM board_state WHERE key LIKE 'rename-finish:%'").first()).n, 0, 'nothing left to finish');
});

test('round 18: a rename undone within the minute: everything back at the first address', async () => {
  await r18.setup();
  const app = await applied('Uma Undo', 'uma.undo@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  await r18.records('uma-undo', 'uma');
  await r18.fail();
  assert.equal((await r18.ren('uma-undo', 'uma-b')).status, 200);
  await r18.ok();
  const back = await r18.ren('uma-b', 'uma-undo');
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(await r18.where('uma'), 'uma-undo');
  assert.ok(await r18.seen('uma-undo') && !(await r18.seen('uma-b')));
});

test('round 18: two members’ addresses swapped, one move still finishing: each keeps their own records', async () => {
  await r18.setup();
  const pia = await applied('Pia Swap', 'pia.swap@example.org');
  assert.equal((await add(pia.id, 'new')).success, true);
  const quin = await applied('Quin Swap', 'quin.swap@example.org');
  assert.equal((await add(quin.id, 'new')).success, true);
  await r18.records('pia-swap', 'pia');
  await r18.records('quin-swap', 'quin');
  await r18.fail();
  assert.equal((await r18.ren('pia-swap', 'pia-swap-old')).status, 200);
  await r18.ok();
  const q = await r18.ren('quin-swap', 'pia-swap');
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(await r18.where('pia'), 'pia-swap-old', 'Pia’s answer is Pia’s');
  assert.equal(await r18.where('quin'), 'pia-swap', 'Quin’s answer moved with Quin');
});

test('round 18: the heartbeat never finishes a rename under someone else: a person no longer at its new address, or someone at its old one, is left alone', async () => {
  await r18.setup();
  const { finishNote, maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  const { readState } = await import('../functions/api/_board-roles.js');
  await readState(env.DB, 'x');
  const app = await applied('Gil Guard', 'gil.guard@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  await r18.records('gil-old', 'gil');
  // (a note for gil-old → somewhere nobody is)
  await finishNote(env.DB, 'gil-old', 'gil-nowhere', { at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }).run();
  assert.deepEqual(await maybeFinishRenames(env.DB), []);
  assert.equal(await r18.where('gil'), 'gil-old', 'nothing moved');
  assert.match((await env.DB.prepare("SELECT data FROM board_state WHERE key = 'rename-finish:gil-old'").first()).data, /not at the new address/);
});

test('round 18: renamed on People while their welcome is going out: one welcome, marked at the new address', async () => {
  await r18.setup();
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  const app = await applied('Ren Welcome', 'ren.welcome@example.org');
  assert.equal((await add(app.id, 'new')).success, true); // (emails off: it waits)
  await emailsOn();
  // (the sign-in list knows them, as its sync makes it: the heartbeat's welcome waits for that)
  await (await import('../functions/api/_board-access.js')).syncBoardAccess(env);
  // Resend slow to answer the heartbeat's welcome; the rename lands meanwhile
  const inner = globalThis.fetch;
  let release;
  const gate = new Promise((r) => { release = r; });
  let asked = false;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.host === 'api.resend.com' && !asked) { asked = true; await gate; }
    return inner(input, init);
  };
  const going = sendWaitingWelcomes(env);
  for (let i = 0; i < 200 && !asked; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(asked, 'the welcome is on its way');
  const r = await r18.ren('ren-welcome', 'ren-welcome-2');
  release();
  await going;
  globalThis.fetch = inner;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let log = await mailLog();
  assert.ok(log.welcomed['ren-welcome-2']?.at && !log.welcomed['ren-welcome-2']?.sending, `marked had at the new address (${JSON.stringify(log.welcomed)})`);
  assert.equal(log.welcomed['ren-welcome'], undefined, 'nothing left at the old one');
  // The heartbeat after it, and once a claim would be ten minutes old: nothing goes again
  await sendWaitingWelcomes(env, { now: Date.now() + 11 * 60 * 1000 });
  await sendWaitingWelcomes(env, { now: Date.now() + 22 * 60 * 1000 });
  assert.equal(welcomesTo('ren.welcome@example.org').length, 1, 'one welcome in all');
  log = await mailLog();
  assert.equal(log.waiting?.['ren-welcome-2'], undefined, 'and no longer waiting');
});

// ─── Board QA round 6 (Nov 21 2026): the signing chain follows every rename, and says who made it ───

test('round 6: renamed, undone, renamed the same way again: each rename has its own "renamed" event, and one finished by the heartbeat says who made it', async () => {
  await r18.setup();
  const { appendEvents } = await import('../functions/api/_board-sign.js');
  const { maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  const app = await applied('Tay Sign', 'tay.sign@example.org');
  assert.equal((await add(app.id, 'new')).success, true);
  // (something of theirs on the signing chain, as a paper opened to sign is)
  await appendEvents(env.DB, async () => ({ events: [{ kind: 'opened', slug: 'tay-sign', by: 'tay.sign@example.org', detail: { doc: 'd1' } }] }));
  const renamed = async () => ((await env.DB.prepare("SELECT slug, by, detail FROM board_sign_events WHERE kind = 'renamed' ORDER BY seq").all()).results || []);
  assert.equal((await r18.ren('tay-sign', 'tay-quinn')).status, 200);
  assert.equal((await r18.ren('tay-quinn', 'tay-sign')).status, 200, 'undone');
  await appendEvents(env.DB, async () => ({ events: [{ kind: 'opened', slug: 'tay-sign', by: 'tay.sign@example.org', detail: { doc: 'd2' } }] }));
  assert.equal((await r18.ren('tay-sign', 'tay-quinn')).status, 200, 'renamed the same way again');
  assert.equal((await renamed()).length, 3, 'three renames, three events');
  // One left to the heartbeat (its board records not following at once) still says who renamed them
  await r18.fail();
  assert.equal((await r18.ren('tay-quinn', 'tay-q')).status, 200);
  await r18.ok();
  await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000 });
  const last = (await renamed()).at(-1);
  assert.equal(last.slug, 'tay-q');
  assert.equal(last.by, 'linzi@soardcharity.com', 'who renamed them, though the heartbeat finished it');
});
