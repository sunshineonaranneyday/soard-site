/**
 * Board QA round 10, the emails a press owes (Nov 22 2026): a member told their signature was taken off, the secretary
 * and the founders told a correction to the minutes was suggested, and whoever suggested one told what was decided.
 * Each used to go once, after the press, with no record of its own, so a read of People that failed (or a send Resend
 * didn't take) lost it for good. Decided: it's written down as due (./functions/api/_board-notices.js), the press stands
 * and its words say the email follows, and the signing look sends anything due on its next clean look, once.
 * Failures are made as tests/board-round9.test.mjs makes them; each is swept over every read of People in turn.
 * Made-up people only (the repo is public).
 * Run: node --test tests/board-round10-notices.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as board from '../functions/api/_board.js';
import { maybeRunSigning } from '../functions/api/_board-sign.js';
import { cleanMeeting, todayEastern } from '../public/admin/board-shared.js';

const ROOT = new URL('../', import.meta.url).pathname;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function signIn(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', seat: 'chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR]];

// ─── The database not answering one statement ───────────────────────
let fault = null;
const PEOPLE_READS = [['the read with emails', /LEFT JOIN reveal_board_emails/], ['People alone', /^SELECT slug, data FROM team$/], ['the emails alone', /^SELECT slug, email FROM reveal_board_emails$/]];
const hit = () => { if (fault.skip > 0) { fault.skip -= 1; return false; } if (fault.n === 0) return false; fault.n -= 1; fault.failed += 1; return true; };
function hooked(DB) {
  const prepare = DB.prepare.bind(DB);
  const no = () => { throw new Error('D1_ERROR: Network connection lost.'); };
  const wrap = (st) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => (hit() ? no() : s[m](...a)) : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
  return new Proxy(DB, { get: (t, k) => (k === 'prepare' ? (sql) => (fault && fault.re.test(sql) ? wrap(prepare(sql)) : prepare(sql)) : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
}
const failOnce = (re, { n = 1, skip = 0 } = {}) => { fault = { re, n, skip, failed: 0 }; };
const answers = () => { const n = fault?.failed || 0; fault = null; return n; };

let env;
let raw;
let mail; // every email Resend took: { to, subject, kind, key }
let refuse; // how many sends Resend turns away next (a bad minute at the email service)
let later; // what each press left running after its answer (waitUntil)
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
  raw = await createD1();
  const files = new Map();
  env = {
    DB: hooked(raw), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test',
    FILES: { get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream() } : null), put: async (k, v) => { files.set(k, new Uint8Array(v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); }, delete: async (k) => { files.delete(k); } },
  };
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  ]) await raw.exec(sql);
  for (const [slug, d] of PEOPLE) await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
  for (const [slug, email] of EMAILS) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await board.ensureSchema(env.DB);
  _resetKeyCacheForTests();
  mail = [];
  refuse = 0;
  later = [];
  const seen = new Set(); // (Resend keeps each idempotency key: the same one again is "already")
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      const key = init.headers?.['Idempotency-Key'] || '';
      if (key && seen.has(key)) return new Response('{}', { status: 409 });
      if (refuse > 0) { refuse -= 1; return Response.json({ message: 'Internal server error' }, { status: 500 }); }
      if (key) seen.add(key);
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), subject: e.subject, kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '' });
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
    }
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

/** A route behind the real sign-in middleware, as `who`; what it left running is finished before it answers here */
async function route(handler, path, who, { method = 'GET', body = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = { request, env, data: {}, waitUntil: (p) => { later.push(p); } };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
  const text = await res.text();
  await Promise.allSettled(later.splice(0));
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}
const api = (body) => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body });
const onPortal = (who, body) => route(portal, '/api/board-portal', who, { method: 'POST', body });
const to = (address, kind) => mail.filter((m) => m.to.includes(address) && m.kind === kind).length;
/** The signing look, on the heartbeat, `n` times; a notice resting after a send that didn't go is due again first */
async function looks(n = 3) {
  for (let i = 0; i < n; i++) {
    await raw.prepare("UPDATE board_state SET data = json_set(data, '$.triedAt', '2000-01-01T00:00:00.000Z') WHERE key LIKE 'notice-due:%' AND json_valid(data)").run().catch(() => {});
    await maybeRunSigning(env);
  }
}

// ─── The rule, kept ────────────────────────────────────────────────

test('these three emails are sent only from the list of notices due, never straight from a press', () => {
  const jsFiles = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : []; });
  const where = {};
  for (const file of jsFiles(join(ROOT, 'functions'))) {
    const src = readFileSync(file, 'utf8');
    for (const kind of ['board-void', 'board-correction', 'board-correction-decided']) {
      if (src.includes(`value: '${kind}'`)) (where[kind] ||= []).push(relative(ROOT, file));
    }
  }
  assert.deepEqual(where, { 'board-void': ['functions/api/_board-notices.js'], 'board-correction': ['functions/api/_board-notices.js'], 'board-correction-decided': ['functions/api/_board-notices.js'] });
});

// ─── A signature taken off ─────────────────────────────────────────

test('a signature taken off with People not read: it’s off, the words say the email follows, and the next clean look sends it once', async () => {
  const d = (await api({ action: 'save-doc', doc: { title: 'Gift Acceptance Policy', kind: 'policy', sign: true, shared: true, body: 'SOARD accepts gifts of cash and stock.' } })).body.doc;
  const year = Number(todayEastern().slice(0, 4));
  let waited = 0;
  let round = 0;
  for (const [what, re] of PEOPLE_READS) {
    for (let skip = 0; skip < 4; skip++) {
      round += 1;
      const signed = await onPortal(ALEX, { action: 'sign', docId: d.id, name: 'Alex Rivera', version: 1, year, mark: { type: 'typed', style: 'caveat', text: 'Alex Rivera', initials: 'AR' }, consent: true });
      assert.equal(signed.status, 200, JSON.stringify(signed.body));
      const before = to(ALEX, 'board-void');
      failOnce(re, { skip });
      const r = await api({ action: 'unsign', docId: d.id, slug: 'alex-rivera', reason: `Signed by mistake ${round}` });
      const failed = answers();
      if (r.status !== 200) {
        // (the founder's own check failed first: nothing was done, said in words)
        assert.equal(r.status, 503, `${what} after ${skip}: ${JSON.stringify(r.body)}`);
        await api({ action: 'unsign', docId: d.id, slug: 'alex-rivera', reason: `Signed by mistake ${round}` });
        await looks();
        assert.equal(to(ALEX, 'board-void') - before, 1, `${what} after ${skip}: told once`);
        continue;
      }
      assert.equal(r.body.doc.signed['alex-rivera'], undefined, `${what} after ${skip}: the signature is off`);
      if (to(ALEX, 'board-void') === before) {
        assert.ok(failed, `${what} after ${skip}: nothing failed, yet Alex wasn’t told`);
        assert.equal(r.body.later, 'The email to Alex goes as soon as the site can check People.', `${what} after ${skip}: the words say it follows`);
        waited += 1;
      } else assert.equal(r.body.later, undefined, 'told now: nothing said about later');
      await looks();
      assert.equal(to(ALEX, 'board-void') - before, 1, `${what} after ${skip}: told once, never twice`);
    }
  }
  assert.ok(waited >= 2, 'the reads it goes by did fail');
  const sent = ((await raw.prepare("SELECT detail FROM board_sign_events WHERE kind = 'void-sent'").all()).results || []).length;
  assert.equal(sent, round, 'each in the chain once');
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM board_state WHERE key LIKE 'notice-due:%'").first()).n, 0, 'nothing left due');
});

test('a signature taken off while Resend has a bad minute: kept as due and sent on the next look, once, even with two looks at once', async () => {
  const d = (await api({ action: 'save-doc', doc: { title: 'Conflict of Interest Policy', kind: 'policy', sign: true, shared: true, body: 'Each member tells the board of any conflict.' } })).body.doc;
  const year = Number(todayEastern().slice(0, 4));
  await onPortal(ALEX, { action: 'sign', docId: d.id, name: 'Alex Rivera', version: 1, year, mark: { type: 'typed', style: 'caveat', text: 'Alex Rivera', initials: 'AR' }, consent: true });
  refuse = 1;
  const r = await api({ action: 'unsign', docId: d.id, slug: 'alex-rivera', reason: 'Signed the wrong paper' });
  assert.equal(r.status, 200);
  assert.equal(r.body.doc.signed['alex-rivera'], undefined, 'the signature is off');
  assert.equal(to(ALEX, 'board-void'), 0, 'the send didn’t go');
  await raw.prepare("UPDATE board_state SET data = json_set(data, '$.triedAt', '2000-01-01T00:00:00.000Z') WHERE key LIKE 'notice-due:%'").run().catch(() => {});
  await Promise.all([maybeRunSigning(env), maybeRunSigning(env)]);
  await looks();
  assert.equal(to(ALEX, 'board-void'), 1, 'told once');
});

// ─── A correction to the minutes ───────────────────────────────────

/** A meeting held today, on the board page, with its minutes in */
const held = () => board.saveMeeting(env.DB, cleanMeeting({
  date: todayEastern(), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() },
  attendance: PEOPLE.slice(1).map(([slug, d]) => ({ slug, name: d.name, kind: 'board', status: 'present' })),
  sections: [{ title: 'New business', items: [{ title: 'Budget', notes: 'The budget passed.' }] }],
}), { by: 'test' });

test('a correction suggested with People not read: it stands, the words say the email follows, and the secretary and the founders are told once', async () => {
  const m = await held();
  let waited = 0;
  let n = 0;
  for (const [what, re] of PEOPLE_READS) {
    for (let skip = 0; skip < 4; skip++) {
      n += 1;
      const before = { taylor: to(TAYLOR, 'board-correction'), jane: to(FOUNDER, 'board-correction') };
      failOnce(re, { skip });
      const r = await onPortal(SAM, { action: 'correction', meetingId: m.id, target: 'general', words: `Sam was on video, not in the room (${n})` });
      const failed = answers();
      if (r.status !== 200) { assert.equal(r.status, 503, `${what} after ${skip}: ${JSON.stringify(r.body)}`); continue; }
      assert.ok(r.body.correction?.id, `${what} after ${skip}: the correction stands`);
      const now = { taylor: to(TAYLOR, 'board-correction') - before.taylor, jane: to(FOUNDER, 'board-correction') - before.jane };
      if (!now.taylor || !now.jane) {
        assert.ok(failed, `${what} after ${skip}: nothing failed, yet they weren’t told`);
        assert.equal(r.body.later, 'The email to the secretary and the founders goes as soon as the site can check People.');
        waited += 1;
      }
      await looks();
      assert.equal(to(TAYLOR, 'board-correction') - before.taylor, 1, `${what} after ${skip}: Taylor, the secretary, told once`);
      assert.equal(to(FOUNDER, 'board-correction') - before.jane, 1, `${what} after ${skip}: the founder told once`);
      assert.equal(to(SAM, 'board-correction'), 0, 'never back to who suggested it');
    }
  }
  assert.ok(waited >= 2, 'the reads it goes by did fail');
});

test('a correction decided with People not read: the decision stands, the words say the email follows, and whoever suggested it is told once', async () => {
  const m = await held();
  let waited = 0;
  let n = 0;
  for (const [what, re] of PEOPLE_READS) {
    for (let skip = 0; skip < 4; skip++) {
      n += 1;
      const c = (await onPortal(SAM, { action: 'correction', meetingId: m.id, target: 'general', words: `The motion was seconded by Taylor (${n})` })).body.correction;
      await looks(1);
      const before = to(SAM, 'board-correction-decided');
      failOnce(re, { skip });
      const r = await onPortal(TAYLOR, { action: 'correction-decide', id: c.id, make: false, reason: 'The minutes have it right' });
      const failed = answers();
      if (r.status !== 200) { assert.equal(r.status, 503, `${what} after ${skip}: ${JSON.stringify(r.body)}`); continue; }
      const state = (await raw.prepare('SELECT state FROM board_minutes_corrections WHERE id = ?').bind(c.id).first()).state;
      assert.equal(state, 'declined', `${what} after ${skip}: the decision stands`);
      if (to(SAM, 'board-correction-decided') === before) {
        assert.ok(failed, `${what} after ${skip}: nothing failed, yet Sam wasn’t told`);
        assert.equal(r.body.later, 'The email to Sam goes as soon as the site can check People.');
        waited += 1;
      }
      await looks();
      assert.equal(to(SAM, 'board-correction-decided') - before, 1, `${what} after ${skip}: Sam told once, never twice`);
    }
  }
  assert.ok(waited >= 1, 'the reads it goes by did fail');
});
