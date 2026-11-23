/**
 * Board QA round 8 (Nov 22 2026), from its fixer: a sign-in whose database read failed was told "This sign-in isn't on
 * SOARD's team or board list", and the board page then told a board member it wasn't for them. A read that fails says so
 * ("We couldn't check your sign-in just now…", 503), and the board and Advisory Board pages show it with Try again; only a
 * read that answered "nobody" refuses as not on the list.
 * Made-up people only (the repo is public). Run: node --test tests/board-round8-signin.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

let env;
let failing = false;
beforeEach(async () => {
  const DB = await createD1();
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  const person = (slug, name, group, email) => Promise.all([
    DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, name, group, 0, JSON.stringify({ slug, name, group, status: 'active', publishStatus: 'published' })).run(),
    DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run(),
  ]);
  await person('alex-rivera', 'Alex Rivera', 'board', 'alex.board@example.com');
  await person('ava-advice', 'Ava Advice', 'advisory', 'ava.adv@example.org');
  failing = false;
  // (the database not answering: every read of who has an email fails while `failing` is on)
  const prepare = DB.prepare.bind(DB);
  env = { DB: new Proxy(DB, { get: (t, k) => (k === 'prepare' ? (sql) => {
    const st = prepare(sql);
    if (!failing || !/reveal_board_emails/.test(sql)) return st;
    const no = async () => { throw new Error('D1_ERROR: Network connection lost.'); };
    return new Proxy(st, { get: (s, m) => (m === 'all' || m === 'first' || m === 'run' ? no : m === 'bind' ? (...a) => { s.bind(...a); return new Proxy(s, { get: (s2, m2) => (['all', 'first', 'run'].includes(m2) ? no : typeof s2[m2] === 'function' ? s2[m2].bind(s2) : s2[m2]) }); } : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
  } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }) };
});

async function sessions() {
  const { onRequest, _resetKeyCacheForTests } = await import('../functions/api/_middleware.js');
  const TEAM = 'soard';
  const AUD = 'aud-tag';
  const ISS = `https://${TEAM}.cloudflareaccess.com`;
  const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const signIn = async (email) => {
    const now = Math.floor(Date.now() / 1000);
    const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => (String(input) === `${ISS}/cdn-cgi/access/certs` ? Response.json({ keys: [jwk] }) : realFetch(input, init));
  Object.assign(env, { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
  _resetKeyCacheForTests();
  return async (email, path) => {
    const request = new Request(`https://sunshineonaranneyday.com${path}`, { headers: { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' } });
    const ctx = { request, env, data: {}, waitUntil: () => {} };
    ctx.next = async () => Response.json({ ok: true, member: ctx.data.boardMember?.slug || null, advisor: ctx.data.advisor?.slug || null });
    const res = await onRequest(ctx);
    return { status: res.status, ...(await res.json()) };
  };
}

const COULD_NOT = 'We couldn’t check your sign-in just now. Please try again in a moment.';

test('a board member and an Advisory Board member get in as themselves; someone on neither list is refused as not on it', async () => {
  const visit = await sessions();
  assert.deepEqual(await visit('alex.board@example.com', '/api/board-portal'), { status: 200, ok: true, member: 'alex-rivera', advisor: null });
  assert.deepEqual(await visit('ava.adv@example.org', '/api/advisory-portal'), { status: 200, ok: true, member: null, advisor: 'ava-advice' });
  const stranger = await visit('someone@example.com', '/api/board-portal');
  assert.deepEqual([stranger.status, stranger.error], [403, 'This sign-in isn’t on SOARD’s team or board list.']);
});

test('the database not answering: never "not on the list", but "couldn’t check just now" (503), for members and anyone else alike', async () => {
  const visit = await sessions();
  failing = true;
  for (const [email, path] of [['alex.board@example.com', '/api/board-portal'], ['ava.adv@example.org', '/api/advisory-portal'], ['someone@example.com', '/api/board-portal']]) {
    const r = await visit(email, path);
    assert.deepEqual([r.status, r.error], [503, COULD_NOT], `${email}: ${JSON.stringify(r)}`);
  }
  // And once it answers again, each is themselves
  failing = false;
  assert.equal((await visit('alex.board@example.com', '/api/board-portal')).member, 'alex-rivera');
});

/* r10: a failed read is sure by default now (Board QA round 10): it throws in words, and only a caller that says
   `sure: false` reads it as nobody */
test('a failed read of who signs in throws by default; only `sure: false` reads it as nobody', async () => {
  const { boardMemberFor, advisorFor } = await import('../functions/api/_board-roles.js');
  failing = true;
  const down = (e) => e.unread === true && e.status === 503 && /Network connection lost/.test(e.cause?.message || '');
  await assert.rejects(() => boardMemberFor(env.DB, 'alex.board@example.com'), down);
  await assert.rejects(() => advisorFor(env.DB, 'ava.adv@example.org'), down);
  assert.equal(await boardMemberFor(env.DB, 'alex.board@example.com', { sure: false }), null);
  assert.equal(await advisorFor(env.DB, 'ava.adv@example.org', { sure: false }), null);
});
