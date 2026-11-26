/**
 * Advisory Board QA round 25: a world for the staff's presses on Run it (/api/advisory-admin, as a made-up founder) and
 * People → Applications (/api/advisory-applications-admin), with Resend faked as the real one is (it keeps each
 * Idempotency-Key a day: the same key again sends nothing, and answers as the first did or 409), and a database whose
 * statements can fail one at a time, before they run (nothing of it lands) or after (it lands, its answer is lost, as D1's
 * "network connection lost" after commit). Made-up people only (the repo is public); nothing leaves this machine.
 */
import { createD1 } from './d1-shim.mjs';
import { writeState } from '../../functions/api/_board-roles.js';

export const STAFF = 'quinn.founderqa@soardcharity.com';
export const MEMBERS = [
  { slug: 'ona-askqa', name: 'Ona Askqa', email: 'ona.askqa@example.org' },
  { slug: 'rex-askqa', name: 'Rex Askqa', email: 'rex.askqa@example.org' },
];

// ─── Resend, faked ───────────────────────────────────────────────────
export const resend = { delivered: [], keys: new Map(), down: false, calls: 0, refuse: new Set() };
export const access = { groups: [], policies: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') {
    resend.calls += 1;
    if (resend.down || [JSON.parse(init.body)].flat().some((m) => [m.to].flat().some((t) => resend.refuse.has(t)))) return Response.json({ message: 'down' }, { status: 500 });
    const key = init.headers?.['Idempotency-Key'] || '';
    if (key && resend.keys.has(key)) { const had = resend.keys.get(key); return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }); }
    const list = [JSON.parse(init.body)].flat();
    resend.delivered.push(...list.map((m) => ({ ...m, key })));
    const res = { data: list.map((_, i) => ({ id: `em_${resend.delivered.length}_${i}` })) };
    if (key) resend.keys.set(key, { body: init.body, res });
    return Response.json(res);
  }
  if (url.host === 'hooks.slack.test') return new Response('ok');
  if (url.host === 'api.cloudflare.com' && url.pathname.startsWith('/client/v4/accounts/acct/access/')) {
    const method = init.method || 'GET';
    const path = url.pathname.replace('/client/v4/accounts/acct', '');
    const ok = (result) => Response.json({ success: true, result });
    if (path === '/access/groups' && method === 'GET') return ok(access.groups);
    if (path === '/access/groups' && method === 'POST') { const g = { id: 'g1', ...JSON.parse(init.body) }; access.groups.push(g); return ok(g); }
    if (path === '/access/groups/g1' && method === 'GET') return ok(access.groups[0]);
    if (path === '/access/groups/g1' && method === 'PUT') { Object.assign(access.groups[0], JSON.parse(init.body)); return ok(access.groups[0]); }
    if (path === '/access/policies' && method === 'GET') return ok(access.policies);
    if (path === '/access/policies' && method === 'POST') { const pl = { id: 'p1', ...JSON.parse(init.body) }; access.policies.push(pl); return ok(pl); }
    if (path === '/access/apps' && method === 'GET') return ok([{ aud: 'aud-admin', name: 'SOARD admin', policies: access.policies.map((x) => ({ id: x.id })) }]);
  }
  throw new Error(`no route for ${url.href}`);
};
export const restoreFetch = () => { globalThis.fetch = realFetch; };
/** Emails delivered to `to` whose subject matches `re` */
export const mails = (to, re) => resend.delivered.filter((m) => [m.to].flat().includes(to) && re.test(m.subject || '')).length;

// ─── The database ─────────────────────────────────────────────────────
const D1_DOWN = () => new Error('D1_ERROR: the database didn’t answer');
/**
 * The database as a press meets it, with `rule(sql, n)` saying for the n-th statement (a batch is one, listed as
 * "[batch] <its first statement>", as D1 runs it) whether it fails: 'before' (nothing of it done) or 'after' (it runs,
 * then its answer is lost). Every statement is traced
 */
export function faulty(DB, rule = () => null) {
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
export const isWrite = (sql) => /^(\[batch\] )?\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql) || /^\[batch\]/.test(sql);
export const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };

let BASE = null;
/** A database of its own (a copy of one made once): People, a founder who runs Board, two members, emails `emails` */
export async function world({ emails = true, members = MEMBERS } = {}) {
  resend.delivered.length = 0;
  resend.keys.clear();
  resend.down = false;
  resend.refuse.clear();
  access.groups.length = 0;
  access.policies.length = 0;
  if (!BASE) {
    const DB = await createD1();
    await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
    await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
    await DB.exec('CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT NOT NULL, updated_at TEXT)');
    await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
    await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind('quinn-founderqa', 'Quinn Founderqa', 'team', JSON.stringify({ slug: 'quinn-founderqa', name: 'Quinn Founderqa', group: 'team', role: 'founder', status: 'active' })).run();
    await writeState(DB, 'settings', { admins: [STAFF] });
    const A = await import('../../functions/api/_advisory.js');
    await A.ensureAdvisory(DB);
    await (await import('../../functions/api/_board.js')).ensureSchema(DB);
    BASE = DB._db.export();
  }
  const DB = await createD1({ bytes: BASE });
  for (const p of members) {
    await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(p.slug, p.name, 'advisory', JSON.stringify({ slug: p.slug, name: p.name, group: 'advisory', status: 'active', publishStatus: 'published' })).run();
    if (p.email) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(p.slug, p.email).run();
  }
  await writeState(DB, 'advisory', { emails, lead: '' });
  return { DB, RESEND_API_KEY: 're_test', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x', CF_ACCOUNT_ID: 'acct', CF_ACCESS_API_TOKEN: 'access-token', CF_ACCESS_AUD: 'aud-admin' };
}

const ctx = (env, path, body) => ({
  env, data: { userEmail: STAFF }, waitUntil: () => {},
  request: new Request(`https://site.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
});
/** A press on Run it, as the page makes it: → { status, ...its answer } */
export async function press(env, body) {
  const admin = await import('../../functions/api/advisory-admin.js');
  const res = await admin.onRequestPost(ctx(env, '/api/advisory-admin', body));
  return { status: res.status, ...(await res.json()) };
}
/** Run it as the page reads it */
export async function runIt(env) {
  const admin = await import('../../functions/api/advisory-admin.js');
  const res = await admin.onRequestGet(ctx(env, '/api/advisory-admin'));
  return { status: res.status, ...(await res.json()) };
}
/** A press on People → Applications */
export async function appsPress(env, body) {
  const admin = await import('../../functions/api/advisory-applications-admin.js');
  const res = await admin.onRequestPost(ctx(env, '/api/advisory-applications-admin', body));
  return { status: res.status, ...(await res.json()) };
}
/** The heartbeat's sends, as if `ahead` ms later: every owed email (the new code), or nothing to do (the old code had none) */
export async function heartbeat(env, ahead = 3 * 60 * 1000) {
  const mail = await import('../../functions/api/_advisory-mail.js');
  if (mail.sendOwedMail) await mail.sendOwedMail(env, { now: Date.now() + ahead });
  await mail.sendWaitingWelcomes(env, { now: Date.now() + ahead });
}
/** A member's introduction or fundraiser request, as their page makes it */
export async function memberMakes(env, member, kind) {
  const A = await import('../../functions/api/_advisory.js');
  return kind === 'intro' ? A.addIntro(env.DB, { slug: member.slug, email: member.email }, { name: 'Pat Introqa', company: 'Testco', email: 'pat.introqa@example.org', how: 'A neighbor', help: ['donor'] })
    : A.requestHost(env.DB, { slug: member.slug, email: member.email }, { title: 'A backyard dinner', when: 'Spring', where: 'Home' });
}
