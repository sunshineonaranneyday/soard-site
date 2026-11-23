/**
 * Advisory Board QA round 19 (Nov 21 2026): who has a People web address, and welcomes during renames, on the server.
 *   M1  an address a rename just left, its records still moving: never given to someone new (Add, People's own create)
 *   M1  a rename that couldn't finish as it stood (stuck): the staff are told once, and nothing gives out its addresses
 *       or renames or deletes its people until a person looks
 *   M2  a rename never takes the address a stopped Add wrote down for someone else
 *   m3  the list of renames still to finish, unread, is never "none": the rename or delete waits, said so
 *   m4  two members whose addresses are swapped during one welcome send each get their own "had it" mark
 *   m5  the name they asked to be called stays theirs for the monthly ask after their application is deleted, and
 *       follows a rename
 * Made-up people only; Resend (it keeps an Idempotency-Key, as the real one does), Cloudflare Access and Images are faked,
 * nothing leaves this machine.
 * Run: node --test tests/advisory-round19.test.mjs
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
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
  const { ensureSchema } = await import('../functions/api/_board.js');
  const { ensureAdvisory } = await import('../functions/api/_advisory.js');
  await ensureSchema(env.DB);
  await ensureAdvisory(env.DB);
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
const add = async (id, as) => {
  const key = (await plan(id))?.key;
  const res = await adminApi.onRequestPost(ctx('POST', { add: { id, as, seen: key } }));
  return { status: res.status, ...(await res.json()) };
};
const emailOf = async (slug) => (await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(slug).first())?.email || null;
const onPeople = async (prefix) => ((await env.DB.prepare('SELECT slug FROM team WHERE slug LIKE ? ORDER BY slug').bind(`${prefix}%`).all()).results || []).map((r) => r.slug);
const emailsOn = async () => { const { writeState } = await import('../functions/api/_board-roles.js'); await writeState(env.DB, 'advisory', { emails: true }); };
const mailLog = async () => (await import('../functions/api/_board-roles.js')).readState(env.DB, 'advisory-mail');
const ren = async (from, to) => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, 'linzi@soardcharity.com', async () => Response.json({ success: true }));
const req = (url, body) => ({ env, request: new Request(`https://site.test${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
/** People's own create (the editor's Save on someone new, as Paste a list saves: no sha) */
const createOnPeople = async (slug, name) => {
  const { onRequestPost } = await import('../functions/api/save-content.js');
  const r = await onRequestPost(req('/api/save-content', { path: `src/content/team/${slug}.json`, content: JSON.stringify({ slug, name, title: 'Advisory Board member', group: 'advisory', status: 'active', publishStatus: 'draft' }), message: `Add person: ${name}` }));
  return { status: r.status, ...(await r.json()) };
};
const del = async (slug) => {
  const { onRequestPost } = await import('../functions/api/delete-content.js');
  const r = await onRequestPost(req('/api/delete-content', { path: `src/content/team/${slug}.json`, message: `Remove ${slug}` }));
  return { status: r.status, ...(await r.json()) };
};
// (their Advisory Board page records: an answer to the monthly ask, a signature on the commitment, a gift credited)
async function pageRecords(slug, tag) {
  await env.DB.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind(`ask-${tag}`, slug, 'yes', tag, '2026-11-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_signatures (doc_id, slug, year, name, version, at) VALUES (?, ?, ?, ?, ?, ?)').bind(`commitment-${tag}`, slug, 2026, tag, 1, '2026-11-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_credits (payment_id, slug, note, at, by) VALUES (?, ?, ?, ?, ?)').bind(`pay-${tag}`, slug, 'gift via their page', '2026-11-02T00:00:00.000Z', 'qa').run();
}
const recordsOf = async (tag) => ({
  answer: (await env.DB.prepare('SELECT slug FROM advisory_answers WHERE ask_id = ?').bind(`ask-${tag}`).first())?.slug || null,
  signature: (await env.DB.prepare('SELECT slug FROM advisory_signatures WHERE doc_id = ?').bind(`commitment-${tag}`).first())?.slug || null,
  gift: (await env.DB.prepare('SELECT slug FROM advisory_credits WHERE payment_id = ?').bind(`pay-${tag}`).first())?.slug || null,
});
// (the Advisory Board page's move not answering once, as the tester's "UPDATE OR IGNORE advisory_answers" fault did)
const pageMoveFails = () => env.DB.exec("CREATE TRIGGER qa_a BEFORE UPDATE ON advisory_answers BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END;");
const pageMoveOk = () => env.DB.exec('DROP TRIGGER IF EXISTS qa_a;');
const notesNow = async () => ((await env.DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'rename-finish:%'").all()).results || []).map((r) => ({ key: r.key, ...JSON.parse(r.data) }));

/** The database not answering one statement whose SQL `match` says (alone or in a batch, as D1 fails a batch whole) → undo */
function fault(match) {
  const real = env.DB.prepare;
  const realBatch = env.DB.batch;
  let left = 1;
  const hit = (sql) => { if (left <= 0 || !match.test(sql)) return false; left--; return true; };
  const boom = () => { throw new Error('D1_ERROR: qa fault'); };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), run: async () => { if (hit(st._sql)) boom(); return st.run(); }, first: async (c) => { if (hit(st._sql)) boom(); return st.first(c); }, all: async () => { if (hit(st._sql)) boom(); return st.all(); } });
  env.DB.prepare = (sql) => wrap(real(sql));
  env.DB.batch = async (stmts) => { for (const s of stmts) if (hit(s._sql)) boom(); return realBatch(stmts); };
  return () => { env.DB.prepare = real; env.DB.batch = realBatch; };
}

// ─── M1 ─────────────────────────────────────────────────────────────

test('M1: an address a rename just left, its Advisory Board page records still moving off it, is never given to someone new: Add gives them their own, People’s own create is refused in words, and the records reach the renamed member', async () => {
  const { maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  const first = await applied('Jordan Ames', 'jordan.ames@example.org');
  assert.equal((await add(first.id, 'new')).person.slug, 'jordan-ames');
  await pageRecords('jordan-ames', 'first-jordan');
  // They married: People has her new name, then her address follows, its page move not answering once
  await env.DB.prepare("UPDATE team SET data = json_set(data, '$.name', 'Jordan Smith'), name = 'Jordan Smith' WHERE slug = 'jordan-ames'").run();
  await pageMoveFails();
  const r = await ren('jordan-ames', 'jordan-smith');
  await pageMoveOk();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.note || '', /still moving to the new address/);
  assert.equal((await recordsOf('first-jordan')).answer, 'jordan-ames', 'not moved yet');
  // A different Jordan Ames applies: someone new, never at jordan-ames
  const second = await applied('Jordan Ames', 'other.jordan@example.org', { phone: '(404) 555-0199' });
  const p = await plan(second.id);
  assert.equal(p.kind, 'new');
  assert.notEqual(p.slug, 'jordan-ames', 'the plan never gives out the address the rename just left');
  const made = await add(second.id, 'new');
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.equal(made.person.slug, 'jordan-ames-2');
  // People's own create at that address: refused, in words
  const c = await createOnPeople('jordan-ames', 'Jordan Ames');
  assert.deepEqual([c.status, c.error], [409, '“jordan-ames” was an Advisory Board member’s address, and their records on the Advisory Board page are kept under it. Give this person another address.']);
  assert.deepEqual(await onPeople('jordan-'), ['jordan-ames-2', 'jordan-smith'], 'nobody at jordan-ames');
  // The heartbeat finishes the move: the first Jordan's answer, signature and gift are hers, at her new address
  assert.deepEqual(await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000 }), ['jordan-ames']);
  assert.deepEqual(await recordsOf('first-jordan'), { answer: 'jordan-smith', signature: 'jordan-smith', gift: 'jordan-smith' });
  assert.deepEqual(await notesNow(), []);
});

test('M1: a rename that can’t be finished as it stands is said to the staff once (what’s left where, and that a person must look); until then neither address is given out and nobody at them is renamed or deleted', async () => {
  const { maybeFinishRenames, finishNote } = await import('../functions/api/_rename-finish.js');
  // Gil renamed with his page records left behind; someone else then at his old address (as before this fix let happen)
  const gil = await applied('Gil Guard', 'gil.guard@example.org');
  assert.equal((await add(gil.id, 'new')).person.slug, 'gil-guard');
  await pageRecords('gil-guard', 'gil');
  await pageMoveFails();
  assert.equal((await ren('gil-guard', 'gil-new')).status, 200);
  await pageMoveOk();
  await person('gil-guard', { name: 'Gil Other', group: 'advisory' }, 'gil.other@example.org');
  // A second, left by a rename to an address nobody has now: its old address must not be given to a new "Uma Left"
  await pageRecords('uma-left', 'uma');
  await finishNote(env.DB, 'uma-left', 'uma-nowhere', { at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }).run();
  const told = [];
  const tell = async (card) => { told.push(card); };
  assert.deepEqual(await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell }), []);
  assert.equal(told.length, 2, `the staff are told about each (${told.map((t) => t.title).join(' | ')})`);
  const g = told.find((t) => /“gil-guard” to “gil-new”/.test(t.title));
  assert.equal(g.title, 'A change of web address on People didn’t finish: “gil-guard” to “gil-new”');
  assert.equal(g.detail, 'Gil Guard’s web address was changed from “gil-guard” to “gil-new”, and these are still under “gil-guard”: 1 answer to a monthly ask, 1 signature on an Advisory Board paper, 1 gift credited to their Advisory Board page. The site didn’t move them by itself because Gil Other is at “gil-guard” on People now, so they might be theirs.');
  // (where a person settles it, People's note at the top: fix-stuck-rename, Nov 21 2026)
  assert.equal(g.fix, 'Settle it in the admin on People: the note at the top lets you move them to “gil-new” or leave them at “gil-guard”. Until then the site won’t give “gil-guard” or “gil-new” to anyone, or change the address of anyone at them.');
  assert.equal(g.level, 'warn');
  const u = told.find((t) => /“uma-left”/.test(t.title));
  assert.match(u.detail, /because nobody is at “uma-nowhere” on People now/);
  assert.equal(u.fix, 'Settle it in the admin on People: the note at the top lets you leave them at “uma-left”. Until then the site won’t give “uma-left” or “uma-nowhere” to anyone, or change the address of anyone at them.', 'only the way it can be settled: nobody is at the new address to move them to');
  // Once: the next heartbeats say nothing more
  await maybeFinishRenames(env.DB, { now: Date.now() + 3 * 60 * 1000, tell });
  await maybeFinishRenames(env.DB, { now: Date.now() + 60 * 60 * 1000, tell });
  assert.equal(told.length, 2, 'told once');
  // Nothing gives out either address, and nobody at them is renamed or deleted, until a person has looked
  const uma = await applied('Uma Left', 'uma.left@example.org');
  assert.notEqual((await plan(uma.id)).slug, 'uma-left', 'Add never gives out its old address');
  const c = await createOnPeople('uma-nowhere', 'Uma Nowhere');
  assert.equal(c.status, 409);
  assert.equal(c.error, '“uma-nowhere” was in a change of web address that couldn’t finish by itself (“uma-left” to “uma-nowhere”), and a person needs to settle it first, in the note at the top of People. Give this person another address.');
  const stuckWords = 'An earlier change of web address (“gil-guard” to “gil-new”) couldn’t finish by itself, and a person needs to settle it first, in the note at the top of People. The address wasn’t changed.';
  assert.deepEqual([(await ren('gil-new', 'gil-guard-2')).body.error], [stuckWords], 'the renamed member waits');
  assert.deepEqual([(await ren('gil-guard', 'gil-other')).body.error], [stuckWords], 'and whoever is at the old address too (never told their records are “still moving”)');
  const d = await del('gil-guard');
  assert.deepEqual([d.status, d.error], [409, 'Nothing was deleted: an earlier change of web address (“gil-guard” to “gil-new”) couldn’t finish by itself, and a person needs to settle it first, in the note at the top of People.']);
  assert.deepEqual(await recordsOf('gil'), { answer: 'gil-guard', signature: 'gil-guard', gift: 'gil-guard' }, 'nothing moved under anyone');
});

// ─── M2 ─────────────────────────────────────────────────────────────

test('M2: a rename never takes the address a stopped Add wrote down for someone else; pressing Add again makes the new person there, and the member with the name keeps their own record and no one else’s email', async () => {
  await person('rowan-ashby-2', { name: 'Rowan Ashby', group: 'advisory', organization: 'Ashby Builders' });
  const app = await applied('Rowan Ashby', 'rowan.applicant@example.org');
  const p1 = await plan(app.id);
  assert.deepEqual([p1.kind, p1.person?.slug, p1.slug], ['choose', 'rowan-ashby-2', 'rowan-ashby']);
  // "A different person", the save not answering: nobody added, its address written down
  const undo = fault(/^INSERT INTO team /);
  const x1 = await add(app.id, 'new');
  undo();
  assert.deepEqual([x1.status, x1.error], [503, 'The site’s database didn’t answer just now, so nobody was added. Press Add to Advisory Board again in a moment.']);
  assert.equal((await env.DB.prepare('SELECT slug FROM advisory_add_intents WHERE app_id = ?').bind(app.id).first())?.slug, 'rowan-ashby');
  // Staff tidy "-2" off the member's address: refused, in words
  const rn = await ren('rowan-ashby-2', 'rowan-ashby');
  assert.deepEqual([rn.status, rn.body.error], [409, 'Someone new is being added to the Advisory Board at “rowan-ashby” (their Add stopped partway, and pressing Add to Advisory Board on their application again finishes it). Pick another address.']);
  // ...and People's own create there too
  const c = await createOnPeople('rowan-ashby', 'Rowan Ashby');
  assert.equal(c.status, 409);
  assert.match(c.error, /^Someone new is being added to the Advisory Board at “rowan-ashby”/);
  // The box still asks, and "A different person" makes the new Rowan at the address written down
  const p2 = await plan(app.id);
  assert.deepEqual([p2.kind, p2.person?.slug], ['choose', 'rowan-ashby-2']);
  const x2 = await add(app.id, 'new');
  assert.equal(x2.status, 200, JSON.stringify(x2));
  assert.deepEqual([x2.person.slug, x2.person.made], ['rowan-ashby', true]);
  assert.equal(await emailOf('rowan-ashby-2'), null, 'the member keeps no one else’s email');
  assert.equal(await emailOf('rowan-ashby'), 'rowan.applicant@example.org');
});

// ─── m3 ─────────────────────────────────────────────────────────────

test('m3: a read of the renames still to finish that fails is never "none": a rename or delete waits, said so, and goes once it can read them', async () => {
  const noor = await applied('Noor Read', 'noor.read@example.org');
  assert.equal((await add(noor.id, 'new')).person.slug, 'noor-read');
  await pageRecords('noor-read', 'noor');
  await pageMoveFails();
  assert.equal((await ren('noor-read', 'noor-read-b')).status, 200);
  await pageMoveOk();
  assert.equal((await notesNow()).length, 1, 'a note left');
  const NOTES = /FROM board_state WHERE key >= 'rename-finish:'/;
  let undo = fault(NOTES);
  const r = await ren('noor-read-b', 'noor-read-c');
  undo();
  assert.deepEqual([r.status, r.body.error], [503, 'The site couldn’t check for an earlier change of web address still finishing, so the address wasn’t changed. Try again in a moment.']);
  assert.deepEqual(await onPeople('noor-'), ['noor-read-b'], 'nothing changed');
  undo = fault(NOTES);
  const d = await del('noor-read-b');
  undo();
  // (a delete that didn't answer is a 500, never a 502 Cloudflare would cover with its own page: delete-content.js)
  assert.deepEqual([d.status, d.error], [500, 'Nothing was deleted: the site couldn’t check for an earlier change of web address still finishing. Try again in a moment.']);
  assert.deepEqual(await onPeople('noor-'), ['noor-read-b'], 'nobody deleted');
  // Read again, the database answering: the earlier move is finished first, and everything ends at the last address
  const again = await ren('noor-read-b', 'noor-read-c');
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(await recordsOf('noor'), { answer: 'noor-read-c', signature: 'noor-read-c', gift: 'noor-read-c' });
  assert.deepEqual(await notesNow(), []);
});

// ─── m4 ─────────────────────────────────────────────────────────────

test('m4: two members whose addresses are swapped during one welcome send each get their own "had it" mark, and a later send gives neither a second', async () => {
  const { sendWaitingWelcomes } = await import('../functions/api/_advisory-mail.js');
  const P = await applied('Wes Alpha', 'wes.alpha@example.org');
  const Q = await applied('Quin Beta', 'quin.beta@example.org');
  assert.equal((await add(P.id, 'new')).person.slug, 'wes-alpha'); // (emails off: both wait)
  assert.equal((await add(Q.id, 'new')).person.slug, 'quin-beta');
  await emailsOn();
  await (await import('../functions/api/_board-access.js')).syncBoardAccess(env);
  // Resend slow to answer the send's first welcome; the swap lands meanwhile: P A→T, Q X→A, P T→X
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
  assert.ok(asked, 'the send is on its way');
  for (const [from, to] of [['wes-alpha', 'wes-alpha-tmp'], ['quin-beta', 'wes-alpha'], ['wes-alpha-tmp', 'quin-beta']]) {
    const r = await ren(from, to);
    assert.equal(r.status, 200, `${from} → ${to}: ${JSON.stringify(r.body)}`);
  }
  release();
  await going;
  globalThis.fetch = inner;
  const log = await mailLog();
  assert.equal(await emailOf('quin-beta'), 'wes.alpha@example.org', 'Wes is at quin-beta now');
  assert.equal(log.welcomed['quin-beta']?.to, 'wes.alpha@example.org', `Wes’s mark at Wes’s address (${JSON.stringify(log.welcomed)})`);
  assert.equal(log.welcomed['wes-alpha']?.to, 'quin.beta@example.org', 'Quin’s at Quin’s');
  assert.ok(log.welcomed['quin-beta']?.at && log.welcomed['wes-alpha']?.at, 'both had it');
  // Later sends, and a claim's ten minutes over: nobody gets a second
  await sendWaitingWelcomes(env, { now: Date.now() + 11 * 60 * 1000 });
  await sendWaitingWelcomes(env, { now: Date.now() + 22 * 60 * 1000 });
  const to = (e) => resend.delivered.filter((m) => m.subject === 'Your Advisory Board page is ready' && [m.to].flat()[0] === e).length;
  assert.deepEqual([to('wes.alpha@example.org'), to('quin.beta@example.org')], [1, 1]);
  // A later application from Wes (his work address, the same name): Add finds him by name, says he's had it, and
  // linking it sends nothing again
  const again = await applied('Wes Alpha', 'wes.work@example.org');
  const p = await plan(again.id);
  assert.deepEqual([p.kind, p.person?.slug, p.person?.welcomed], ['choose', 'quin-beta', true]);
  const linked = await adminApi.onRequestPost(ctx('POST', { add: { id: again.id, as: 'same', to: 'quin-beta', seen: p.key } }));
  assert.equal(linked.status, 200, await linked.clone().text());
  assert.equal(to('wes.alpha@example.org'), 1, 'still one');
});

// ─── m5 ─────────────────────────────────────────────────────────────

test('m5: the name they asked to be called stays theirs for the monthly ask once they’re added, after their application is deleted, and through a rename', async () => {
  const { sendAsk } = await import('../functions/api/_advisory-mail.js');
  const { saveAsk, putAskOut } = await import('../functions/api/_advisory.js');
  // (r20: a name they go by with brackets or a slash in it is set aside and their full name's first name used: Robert, Joanna)
  const people = [['Katherine Smith', 'Katie', 'katie.smith@example.org', 'Katie'], ['Robert Jones', 'Bob (he/him)', 'bob.jones@example.org', 'Robert'],
    ['Garcia Lopez, Maria', 'Maria', 'maria.gl@example.org', 'Maria'], ['Joanna Ames', 'Jo she/her', 'jo.ames@example.org', 'Joanna']];
  const slugs = [];
  for (const [fullName, preferredName, email] of people) {
    const app = await applied(fullName, email, { preferredName });
    const r = await add(app.id, 'new');
    assert.equal(r.status, 200, JSON.stringify(r));
    slugs.push(r.person.slug);
    // (the application deleted, as Delete application on its panel does)
    const res = await adminApi.onRequestPost(ctx('POST', { remove: { id: app.id } }));
    assert.equal(res.status, 200, await res.clone().text());
  }
  await emailsOn();
  const greetings = async (title) => {
    const n = resend.delivered.length;
    await sendAsk(env, await putAskOut(env.DB, (await saveAsk(env.DB, { title })).id), {});
    return Object.fromEntries(resend.delivered.slice(n).map((m) => [[m.to].flat()[0], m.text.split('\n')[0]]));
  };
  const after = await greetings('Know a plumber?');
  for (const [, , email, want] of people) assert.equal(after[email], `Hi ${want},`, email);
  // Renamed on People: the name goes with them
  assert.equal((await ren(slugs[0], 'katie-smith')).status, 200);
  assert.equal((await greetings('Know a painter?'))['katie.smith@example.org'], 'Hi Katie,');
  assert.equal((await mailLog()).names['katie-smith'], 'Katie', 'kept beside their welcome record, at their new address');
  assert.equal((await mailLog()).names[slugs[0]], undefined, 'nothing left at the old one');
});
