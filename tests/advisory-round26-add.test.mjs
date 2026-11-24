/**
 * Advisory Board QA round 26, finding 6: Add to Advisory Board's welcome. Only Resend's yes says it went: a 5xx or a
 * dropped connection leaves it owed (written down as waiting, its key kept), the heartbeat sends it once with that key,
 * and the words say "Their sign-in email goes in a few minutes."; Resend's own 4xx is said as a refusal. And Add's press
 * swept: each statement failing once in turn (before it runs, and for each write after it ran with its answer lost),
 * the words matching what the database and the fake email service show, nobody emailed twice, nothing owed lost after
 * the heartbeat. Made-up people only (the repo is public); Resend, Access and Images are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round26-add.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import * as adminApi from '../functions/api/advisory-applications-admin.js';
import { readState, writeState } from '../functions/api/_board-roles.js';

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

// Resend (keeping each Idempotency-Key, as the real one does; `status` the next `times` calls answer it; `lose` the next
// calls are taken, then the answer lost), Access and Images, faked
const resend = { delivered: [], keys: new Map(), status: 0, times: 0, lose: 0 };
const access = { groups: [], policies: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') {
    if (resend.times > 0) { resend.times -= 1; return Response.json({ message: `qa ${resend.status}` }, { status: resend.status }); }
    const key = init.headers?.['Idempotency-Key'] || '';
    if (key && resend.keys.has(key)) { const had = resend.keys.get(key); return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }); }
    const list = [JSON.parse(init.body)].flat();
    resend.delivered.push(...list);
    const res = { data: list.map((_, i) => ({ id: `em_${resend.delivered.length}_${i}` })) };
    if (key) resend.keys.set(key, { body: init.body, res });
    if (resend.lose > 0) { resend.lose -= 1; throw new TypeError('the connection dropped after Resend took it'); }
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
const isWrite = (sql) => /^(\[batch\] )?\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql) || /^\[batch\]/.test(sql);
const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };

async function world({ emails = true } = {}) {
  resend.delivered.length = 0;
  resend.keys.clear();
  resend.times = 0;
  resend.lose = 0;
  access.groups.length = 0;
  access.policies.length = 0;
  const DB = await createD1();
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
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
const add = async (env, id, DB = env.DB) => {
  const p = await plan(env, id);
  return post({ ...env, DB }, { add: { id, as: p.kind === 'new' ? 'new' : 'same', seen: p.key } });
};
const welcomes = (to) => resend.delivered.filter((m) => m.subject === 'Your Advisory Board page is ready' && [m.to].flat().includes(to)).length;
/** The heartbeat now, 11 minutes on and 2 days on, in its own order: the board's sign-in list first, then the welcomes */
async function heartbeats(env) {
  const mail = await import('../functions/api/_advisory-mail.js');
  const { syncBoardAccess } = await import('../functions/api/_board-access.js');
  for (const ahead of [0, 11 * 60 * 1000, 2 * 86_400_000]) {
    await quietly(() => syncBoardAccess(env).catch(() => {}));
    await quietly(() => mail.sendWaitingWelcomes(env, { now: Date.now() + ahead }).catch(() => {}));
  }
}
const EMAIL = 'jody.addqa@example.org';

test('6: Add with a gateway\'s 502 for the welcome: "goes in a few minutes", never "emailed", and the heartbeat sends it once under the same key', async () => {
  const env = await world();
  const app = await applied(env, 'Jody Addqa', EMAIL);
  resend.status = 502; resend.times = 1;
  const r = await quietly(() => add(env, app.id));
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.welcome, { waiting: true, why: 'owed' }, 'owed, never "sent"');
  assert.equal(welcomes(EMAIL), 0);
  const log = await readState(env.DB, 'advisory-mail');
  assert.equal(log.waiting?.[r.person.slug]?.key, `advisory-welcome:${EMAIL}`, 'written down as waiting, its key kept');
  assert.equal(log.welcomed?.[r.person.slug]?.at, undefined, 'never counted as had');
  await heartbeats(env);
  assert.equal(welcomes(EMAIL), 1, 'the heartbeat sent it, once');
});

test('6: Add with the welcome taken by Resend and its answer lost: owed, and the heartbeat\'s retry under the same key sends nothing twice', async () => {
  const env = await world();
  const app = await applied(env, 'Kit Addqa', 'kit.addqa@example.org');
  resend.lose = 1;
  const r = await quietly(() => add(env, app.id));
  assert.deepEqual(r.welcome, { waiting: true, why: 'owed' });
  await heartbeats(env);
  assert.equal(welcomes('kit.addqa@example.org'), 1, 'once');
  assert.ok((await readState(env.DB, 'advisory-mail')).welcomed?.[r.person.slug]?.at, 'marked had once Resend said so');
});

test('6: Add with Resend\'s own 422 for the welcome: said as a refusal, nothing owed', async () => {
  const env = await world();
  const app = await applied(env, 'Lou Addqa', 'lou.addqa@example.org');
  resend.status = 422; resend.times = 1;
  const r = await quietly(() => add(env, app.id));
  assert.deepEqual(r.welcome, { refused: true });
  assert.equal((await readState(env.DB, 'advisory-mail')).waiting?.[r.person.slug], undefined, 'not owed');
  await heartbeats(env);
  assert.equal(welcomes('lou.addqa@example.org'), 0, 'nothing sends it by itself');
});

test('sweep: Add to Advisory Board\'s welcome, every statement failing in turn (before, and each write after with its answer lost)', async () => {
  const setup = async () => { const env = await world(); const app = await applied(env, 'Mel Sweepqa', 'mel.sweepqa@example.org'); return { env, app }; };
  const c = await setup();
  const f0 = faulty(c.env.DB);
  const r0 = await quietly(() => add(c.env, c.app.id, f0.DB));
  assert.equal(r0.status, 200, r0.error);
  assert.deepEqual(r0.welcome, { sent: 1 }, 'the control press');
  const trace = f0.state.trace;
  const points = [];
  for (let k = 1; k <= trace.length; k++) { points.push({ k, how: 'before' }); if (isWrite(trace[k - 1])) points.push({ k, how: 'after' }); }
  // (and the email service: a gateway's 502, its own 500, and taking it with the answer lost)
  points.push({ k: 0, how: 'resend502' }, { k: 0, how: 'resend500' }, { k: 0, how: 'resendlose' });
  const bad = [];
  let hit = 0;
  for (const p of points) {
    const w = await setup();
    const f = faulty(w.env.DB, (sql, n) => (n === p.k ? p.how : null));
    if (p.how === 'resend502' || p.how === 'resend500') { resend.status = Number(p.how.slice(6)); resend.times = 1; }
    if (p.how === 'resendlose') resend.lose = 1;
    const r1 = await quietly(() => add(w.env, w.app.id, f.DB));
    if (!p.k) f.state.hit.push(p.how);
    if (!f.state.hit.length) continue;
    hit += 1;
    const where = `#${p.k} ${p.how} "${f.state.hit[0].slice(0, 80)}"`;
    try {
      const n1 = welcomes('mel.sweepqa@example.org');
      if (r1.status === 200 && r1.welcome?.sent) assert.equal(n1, 1, 'said emailed: it went');
      if (r1.status === 200 && !r1.welcome?.sent) assert.ok(n1 <= 1);
      if (r1.status !== 200) assert.equal(n1, 0, `said "${r1.error}", but it went`);
      // pressed again (as a press that stops partway says), then the heartbeat now, 11 minutes on, 2 days on
      let r2 = null;
      if (r1.status !== 200) r2 = await quietly(() => add(w.env, w.app.id));
      // (a press's hold whose answer was lost holds the next press off for its two minutes: "Someone is adding them right
      // now". Pressed again once that's passed, as time passing would)
      if (r2?.status === 409 && /Someone is adding/.test(r2.error || '')) {
        await w.env.DB.prepare('UPDATE advisory_add_holds SET at = ?').bind(Date.now() - 3 * 60 * 1000).run();
        r2 = await quietly(() => add(w.env, w.app.id));
      }
      p.said = `${r1.status} ${r1.error || JSON.stringify(r1.welcome)}${r2 ? ` | again ${r2.status} ${r2.error || JSON.stringify(r2.welcome)}` : ''}`;
      await heartbeats(w.env);
      assert.equal(welcomes('mel.sweepqa@example.org'), 1, 'once in the end, never twice, never lost');
      const log = await readState(w.env.DB, 'advisory-mail');
      assert.deepEqual(Object.keys(log.waiting || {}), [], 'nothing left owed');
    } catch (e) { bad.push(`${where}: ${e.message.split('\n')[0]} (${p.said || `${r1.status} ${r1.error || JSON.stringify(r1.welcome)}`})`); }
  }
  console.log(`[sweep] Add's welcome: ${hit} points hit (${points.length} run), ${bad.length} BAD${bad.length ? `:\n  ${bad.join('\n  ')}` : ''}`);
  assert.deepEqual(bad, [], `${bad.length} of ${hit} points`);
});
