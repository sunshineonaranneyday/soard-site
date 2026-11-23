/**
 * Board QA round 9 (Nov 22 2026): the privacy tester's findings 1 to 7, and the admin tester's 3 to 5.
 *   The rule behind 1, 3, 5 and 6: a read that fails is never taken for "nobody" or "no change". A read that decides who
 *   gets in, who is on a list or what an address becomes is a sure read: what it was about to do isn't done, a person
 *   pressing something is told in words (503), and a background job says so in the status its panel shows.
 *   1  Cloudflare Access's sign-in list is never emptied by one failed read
 *   2  the secretary's "Here" after a rename lands on the member, and the notes row never holds the old address
 *   3  advisory@ is never emptied by one failed read, Advisory Board emails on or off
 *   4  a member is never refused at the moment of their own rename (the Advisory Board lead, their own to-do)
 *   5  a founder whose check of who runs Board failed is told "couldn't check" (503), never that Board isn't theirs;
 *      Email all never goes to a list shrunk by a failed read
 *   6  a meeting, template or practice save whose address read failed is refused in words, never saved at an old address
 *   7  a roll correction suggested before a rename is made after it
 *   admin 3  a save from a page open across a rename follows it, even when a newcomer has the old address
 *   admin 4  who presents and its presenter line are one thing in a merge
 *   admin 5  a rename's rewrite of a meeting names the rename
 * Failures are made the way tests/board-round8-signin.test.mjs makes them: the database's prepare wrapped, so a
 * statement matching `fault.re` fails (after `skip` that pass) `n` times. Made-up people only (the repo is public).
 * Run: node --test tests/board-round9.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import * as advPortal from '../functions/api/advisory-portal.js';
import * as advFile from '../functions/api/advisory-file.js';
import { ensureSchema, getMeeting, saveMeeting, saveSettings, getSettings, createPractice, getPractice, setActionDone, addressesNow } from '../functions/api/_board.js';
import { cleanMeeting, mergeMeeting, todayEastern, followAddresses } from '../public/admin/board-shared.js';

const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
const PEOPLE_DOWN = 'We couldn’t check People just now, so nothing was changed. Please try again in a moment.';
const EMAILS_DOWN = 'We couldn’t read the board’s emails just now, so nothing was sent. Please try again in a moment.';
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
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
  ['ada-example', { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['ada-example', 'ada.adv@example.org']];

// ─── The database not answering one statement ───────────────────────
let fault = null; // { re, n, skip, failed }
/* r9: the read of who has which email, alone or (since round 9's last fix) with People in one statement
   (./functions/api/_board-roles.js peopleWithEmails): either one failing is that read failing */
const EMAILS_READ = /^SELECT slug, email FROM reveal_board_emails$|LEFT JOIN reveal_board_emails/;
const failing = (sql) => !!fault && fault.re.test(sql);
const hit = () => { if (fault.skip > 0) { fault.skip -= 1; return false; } if (fault.n === 0) return false; fault.n -= 1; fault.failed += 1; return true; };
function hooked(DB) {
  const prepare = DB.prepare.bind(DB);
  const no = () => { throw new Error('D1_ERROR: Network connection lost.'); };
  const wrap = (st) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => (hit() ? no() : s[m](...a)) : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
  return new Proxy(DB, { get: (t, k) => (k === 'prepare' ? (sql) => (failing(sql) ? wrap(prepare(sql)) : prepare(sql)) : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
}
const failOnce = (re, { n = 1, skip = 0 } = {}) => { fault = { re, n, skip, failed: 0 }; return fault; };
const answers = () => { fault = null; };

let env;
const realFetch = globalThis.fetch;
let outside; // (fetch handlers a test adds: Cloudflare's API, Google's)
beforeEach(async () => {
  fault = null;
  outside = null;
  const DB = await createD1();
  env = { DB: hooked(DB), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, FILES: { get: async () => null, put: async () => {}, delete: async () => {} } };
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  for (const [slug, d] of PEOPLE) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
  for (const [slug, email] of EMAILS) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await ensureSchema(env.DB);
  _resetKeyCacheForTests();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (outside) { const r = await outside(url, init); if (r) return r; }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

/** A route behind the real sign-in middleware, as `who` */
async function route(handler, path, who, { method = 'GET', body = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = { request, env, data: {}, waitUntil: () => {} };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a file, or words */ }
  return { status: res.status, body: json, text };
}
const api = (body, who = FOUNDER) => route(admin, '/api/board-admin', who, { method: 'POST', body });
const rename = async (from, to) => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, FOUNDER, async () => Response.json({ success: true }));
const addPerson = (slug, d) => env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
const itemOf = (sections, title) => sections.flatMap((s) => s.items).find((it) => it.title === title);
const later = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// ─── 1: Cloudflare Access's sign-in list ───────────────────────────

test('1: one failed read of who signs in changes nothing in Cloudflare, the status says so (never ok, never error null), and the next look puts it right', async () => {
  const { syncBoardAccess, maybeSyncBoardAccess, canSignIn, accessStatus } = await import('../functions/api/_board-access.js');
  Object.assign(env, { CF_ACCESS_API_TOKEN: 'cf-token', CF_ACCOUNT_ID: 'acct' });
  let groupEmails = null;
  const writes = [];
  outside = async (url, init) => {
    const u = new URL(url);
    if (!u.hostname.endsWith('api.cloudflare.com')) return null;
    const ok = (result) => Response.json({ success: true, result });
    const method = init.method || 'GET';
    const group = () => ({ id: 'g1', name: 'SOARD board (kept by the website)', include: (groupEmails || []).map((email) => ({ email: { email } })) });
    if (u.pathname.endsWith('/access/groups') && method === 'GET') return ok(groupEmails ? [group()] : []);
    if (u.pathname.endsWith('/access/groups') && method === 'POST') { groupEmails = JSON.parse(init.body).include.map((r) => r.email.email); writes.push(['POST', groupEmails]); return ok(group()); }
    if (u.pathname.endsWith('/access/groups/g1') && method === 'GET') return ok(group());
    if (u.pathname.endsWith('/access/groups/g1') && method === 'PUT') { groupEmails = JSON.parse(init.body).include.map((r) => r.email.email); writes.push(['PUT', groupEmails]); return ok(group()); }
    if (u.pathname.endsWith('/access/policies')) return ok(method === 'GET' ? [{ id: 'p1', name: 'SOARD board members' }] : { id: 'p1' });
    if (u.pathname.endsWith('/access/apps')) return ok([{ aud: AUD, name: 'SOARD Admin', policies: [{ id: 'p1' }] }]);
    return null;
  };
  const everyone = [ALEX, SAM, TAYLOR, 'ada.adv@example.org'].sort();
  assert.equal((await syncBoardAccess(env)).ok, true);
  assert.deepEqual(groupEmails, everyone);
  writes.length = 0;

  // Board → Members' Check now, with the read of the emails failing once
  failOnce(EMAILS_READ);
  const st = await syncBoardAccess(env);
  assert.equal(fault.failed, 1, 'the read failed');
  answers();
  assert.deepEqual([st.ok, st.error, st.unread], [false, PEOPLE_DOWN, true], 'said in the status, never ok:true / error null');
  assert.deepEqual(writes, [], 'nothing sent to Cloudflare');
  assert.deepEqual(groupEmails, everyone, 'everyone can still sign in');
  const shown = await accessStatus(env);
  assert.deepEqual([shown.ok, shown.error, shown.unread], [false, PEOPLE_DOWN, true], 'Board → Members shows it');
  assert.ok(shown.failingSince, 'with when it began, for the panel (a passing blip is quiet)');

  // The heartbeat's 6-hourly recheck, its read inside the sync failing
  await env.DB.prepare("UPDATE board_state SET data = json_set(data, '$.syncedAt', '2000-01-01T00:00:00.000Z', '$.ok', json('true')) WHERE key = 'access'").run();
  await env.DB.prepare("DELETE FROM board_state WHERE key = 'access-runs'").run();
  failOnce(EMAILS_READ, { n: 2 });
  await maybeSyncBoardAccess(env);
  answers();
  assert.deepEqual(writes, [], 'the heartbeat sent nothing to Cloudflare either');
  assert.deepEqual(groupEmails, everyone);
  const after = await accessStatus(env);
  assert.deepEqual([after.ok, after.error], [false, PEOPLE_DOWN], 'recorded where the panel reads it');
  // A read that fails is "not yet" for a sign-in email, never "they can"
  failOnce(EMAILS_READ);
  assert.equal(await canSignIn(env, ALEX), false);
  answers();
  // The next look (5 minutes on) reads cleanly and puts it right, with nothing to change
  await maybeSyncBoardAccess(env, { now: Date.now() + 6 * 60 * 1000 });
  const fine = await accessStatus(env);
  assert.deepEqual([fine.ok, fine.error, fine.unread, fine.current], [true, null, undefined, true]);
  assert.deepEqual(groupEmails, everyone);
});

// ─── 3: advisory@ ──────────────────────────────────────────────────

test('3: one failed read never takes anyone off advisory@ (emails on or off), and the status says why', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { syncAdvisoryGroup, maybeSyncAdvisoryGroup, advisoryGroupStatus, advisoryGroupWanted, ADVISORY_GROUP_EMAIL } = await import('../functions/api/_board-group.js');
  const { clearTokenCache } = await import('../functions/api/_google-calendar.js');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  env.GOOGLE_CALENDAR_KEY = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', client_id: '1', project_id: 'soard-site', private_key: privateKey });
  clearTokenCache();
  const MEMBERS = `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(ADVISORY_GROUP_EMAIL)}/members`;
  let group = [{ email: 'jane@soardcharity.com', role: 'OWNER', type: 'USER' }];
  const changes = [];
  outside = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (!url.startsWith(MEMBERS)) return null;
    const method = init.method || 'GET';
    if (method === 'GET') return Response.json({ members: group });
    if (method === 'POST') { const b = JSON.parse(init.body); changes.push(['add', b.email]); group.push({ email: b.email, role: 'MEMBER', type: 'USER' }); return Response.json(b); }
    if (method === 'DELETE') { const key = decodeURIComponent(url.split('/members/')[1]); changes.push(['remove', key]); group = group.filter((m) => m.email !== key); return new Response(null, { status: 204 }); }
    return null;
  };
  const filled = await syncAdvisoryGroup(env);
  assert.equal(filled.ok, true, JSON.stringify(filled));
  assert.ok(group.some((m) => m.email === 'ada.adv@example.org'), 'Ada is in it');
  changes.length = 0;

  // The members' emails, and People, are one sure read: a failure throws, never "nobody"
  failOnce(EMAILS_READ);
  /* r10: a failed read of People now throws in the words a person is told (readDown, with the database's error as its cause) */
  await assert.rejects(() => advisoryGroupWanted(env.DB), (e) => e.unread === true && e.status === 503 && /Network connection lost/.test(e.cause?.message || ''));
  answers();

  for (const adding of [true, false]) {
    // Check now (sync-group), emails on: one read failing
    // (the heartbeat reads it, then the sync reads it again: both failing)
    failOnce(EMAILS_READ, { n: adding ? 1 : 2 });
    const st = adding ? await syncAdvisoryGroup(env) : await maybeSyncAdvisoryGroup(env, { adding: false, now: Date.now() + (adding ? 0 : 7 * 3600 * 1000) });
    assert.equal(fault.failed, adding ? 1 : 2, 'the read failed');
    answers();
    assert.deepEqual(changes, [], `nothing taken off (emails ${adding ? 'on' : 'off'})`);
    assert.ok(group.some((m) => m.email === 'ada.adv@example.org'), 'Ada stays in it');
    assert.deepEqual([st.ok, st.error, st.unread], [false, PEOPLE_DOWN, true], 'said in the status');
    const shown = await advisoryGroupStatus(env);
    assert.deepEqual([shown.ok, shown.unread, shown.error], [false, true, PEOPLE_DOWN], 'the panel says why');
    assert.ok(shown.changes.every((c) => !c.removed.length), 'and no "removed" in its history');
  }
});

// ─── 5: founders, and Email all ────────────────────────────────────

test('5: a founder whose check of who runs Board fails is told "couldn’t check" (503) on Board, the board page, the Advisory Board page and their files, never refused', async () => {
  const TEAM_READ = /^SELECT slug, data FROM team$/;
  const cases = [
    ['Board (#board)', () => route(admin, '/api/board-admin', FOUNDER)],
    ['Board’s menu (?me=1)', () => route(admin, '/api/board-admin?me=1', FOUNDER)],
    ['the board page', () => route(portal, '/api/board-portal', FOUNDER)],
    ['the Advisory Board page', () => route(advPortal, '/api/advisory-portal', FOUNDER)],
    ['a board file', () => route(boardFile, '/api/board-file?id=f_abcdefgh', FOUNDER)],
    ['an Advisory Board file', () => route(advFile, '/api/advisory-file?id=f_abcdefgh', FOUNDER)],
  ];
  for (const [what, open] of cases) {
    // Normally: in (a file that isn't there is a 404 all the same)
    const fine = await open();
    assert.ok(fine.status === 200 || (/file/.test(what) && fine.status === 404), `${what} normally: ${fine.status} ${fine.text.slice(0, 120)}`);
    failOnce(TEAM_READ, { n: 50 });
    const r = await open();
    answers();
    assert.equal(r.status, 503, `${what}: ${r.status} ${r.text.slice(0, 160)}`);
    assert.equal(r.body ? r.body.error : r.text, SIGN_IN_DOWN, what);
  }
});

test('5: a member’s Email all never goes to a list a failed read shrank: the board page says it couldn’t read it, and the send is refused in words', async () => {
  const normal = (await route(portal, '/api/board-portal', SAM)).body.emailAll;
  const everyone = [ALEX, FOUNDER, TAYLOR].sort();
  assert.deepEqual(normal.to.sort(), everyone);
  // One read of People or the emails failing, wherever it falls in the page's read: never a shorter list
  let unread = 0;
  for (const re of [/^SELECT slug, data FROM team$/, EMAILS_READ]) {
    for (let skip = 0; skip < 8; skip++) {
      failOnce(re, { skip });
      const page = await route(portal, '/api/board-portal', SAM);
      const failed = fault.failed;
      answers();
      if (!failed || page.status !== 200) continue;
      const e = page.body.emailAll;
      if (e.unread) { unread += 1; assert.deepEqual(e, { to: [], missing: [], unread: EMAILS_DOWN }); } else assert.deepEqual(e.to.sort(), everyone, `${re} skip ${skip}: never a list shrunk by a failed read`);
    }
  }
  assert.ok(unread > 0, 'the list’s own read failing is said as that');
  // Board → Members' Email the board, through Gmail
  env.GOOGLE_CALENDAR_KEY = 'a key';
  failOnce(EMAILS_READ);
  const sent = await api({ action: 'email-all', subject: 'Budget', message: 'The budget is attached.' });
  answers();
  assert.deepEqual([sent.status, sent.body.error], [503, EMAILS_DOWN]);
});

// ─── 6: an address read that fails ─────────────────────────────────

test('6: a meeting, template or practice save whose address read fails is refused in words (503), never saved at the old address', async () => {
  const made = (await api({ action: 'new-meeting', date: inDays(100) })).body.meeting;
  const practice = await createPractice(env, { by: FOUNDER });
  assert.equal((await rename('sam-ortiz', 'sam-ortiz-x')).status, 200);
  const cur = await getMeeting(env.DB, made.id);
  const sections = cur.sections.map((s, i) => (i === 0 ? { ...s, items: [...s.items, { id: 'i_r9sam', title: 'Treasurer’s report', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : s));
  for (const re of [/^SELECT slug FROM team$/, /FROM audit_log WHERE entity_type = 'team' AND instr\(changes/]) {
    failOnce(re);
    const r = await api({ action: 'save-meeting', base: cur.updatedAt, meeting: { ...cur, sections, actions: [{ id: 'a_r9sam', owner: 'sam-ortiz', text: 'Bring the audit letter' }] } });
    answers();
    assert.deepEqual([r.status, r.body.error], [503, PEOPLE_DOWN], `the meeting, failing ${re}`);
    assert.ok(!JSON.stringify(await getMeeting(env.DB, made.id)).includes('"sam-ortiz"'), 'nothing saved at the old address');
  }
  // …and without the fault, the same save follows the rename
  const ok = await api({ action: 'save-meeting', base: cur.updatedAt, meeting: { ...cur, sections } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(itemOf(ok.body.meeting.sections, 'Treasurer’s report').who, ['sam-ortiz-x']);

  // The template
  const s = await getSettings(env.DB);
  const template = s.template.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_r9tpl', title: 'Treasurer’s minute', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec));
  failOnce(/^SELECT slug FROM team$/);
  const t = await api({ action: 'save-settings', base: s.templateAt, settings: { template } });
  answers();
  assert.deepEqual([t.status, t.body.error], [503, PEOPLE_DOWN], 'the template');
  assert.equal(itemOf((await getSettings(env.DB)).template, 'Treasurer’s minute'), undefined, 'nothing saved');

  // A practice meeting
  const p = await getPractice(env.DB, practice.id);
  failOnce(/^SELECT slug FROM team$/);
  const pr = await api({ action: 'save-meeting', base: p.updatedAt, meeting: { ...p, sections: [...p.sections, { id: 's_r9p', title: 'Practice money', items: [{ id: 'i_r9p', title: 'Money', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] }] } });
  answers();
  assert.deepEqual([pr.status, pr.body.error], [503, PEOPLE_DOWN], 'the practice meeting');
  assert.ok(!JSON.stringify(await getPractice(env.DB, practice.id)).includes('"sam-ortiz"'));
});

// ─── 2: the secretary's notes across a rename ──────────────────────

test('2: the secretary’s "Here" and a to-do typed after a rename land on the member: saved at the new address (said back to the page), sent as there, theirs on their page, and the old address free', async () => {
  const { saveNotes, sendNotes } = await import('../functions/api/_board-notes.js');
  const { keptAt } = await import('../functions/api/_member-places.js');
  const made = (await api({ action: 'new-meeting', date: inDays(0) })).body.meeting;
  const m0 = await getMeeting(env.DB, made.id);
  assert.ok(m0.attendance.some((p) => p.key === 'sam-ortiz'), 'Sam is on the roll as the page read it');
  const taylor = { member: { slug: 'taylor-nguyen', name: 'Taylor Nguyen', seat: 'secretary', email: TAYLOR } };
  await env.DB.prepare("UPDATE board_meetings SET data = json_set(data, '$.shared', json('true')) WHERE id = ?").bind(made.id).run();
  assert.equal((await rename('sam-ortiz', 'sam-ortiz-pb')).status, 200);

  // The page saves the boxes keyed as it read them
  const saved = await saveNotes(env, made.id, { changes: { 'r:sam-ortiz': 'present', 'r:alex-rivera': 'present', 'a:a_r9todo': { text: 'Send the 2027 budget draft', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' } }, was: { 'r:sam-ortiz': '', 'r:alex-rivera': '' } }, taylor);
  assert.deepEqual(saved.clashes, []);
  assert.deepEqual(saved.addressesNow, { 'sam-ortiz': 'sam-ortiz-pb' }, 'said back, so the page shows Sam as Here at once');
  const row = JSON.parse((await env.DB.prepare('SELECT data FROM board_minutes_notes WHERE meeting_id = ?').bind(made.id).first()).data);
  assert.deepEqual([row['r:sam-ortiz-pb'], 'r:sam-ortiz' in row, row['a:a_r9todo'].owner], ['present', false, 'sam-ortiz-pb']);
  // Nothing of Board's is kept at the old address: it's free
  assert.deepEqual(await keptAt(env.DB, 'sam-ortiz', { owners: ['board'] }), []);

  const sent = await sendNotes(env, made.id, taylor);
  assert.deepEqual(sent.read.attendance, { here: 3, of: 4 }, 'Sam, Alex and Taylor (who took them)');
  const after = await getMeeting(env.DB, made.id);
  assert.equal(after.attendance.find((p) => p.slug === 'sam-ortiz-pb')?.status, 'present');
  assert.equal(after.actions.find((a) => a.text === 'Send the 2027 budget draft')?.owner, 'sam-ortiz-pb', 'the to-do is Sam’s');
  const samsPage = (await route(portal, '/api/board-portal', SAM)).body;
  assert.ok(JSON.stringify(samsPage).includes('Send the 2027 budget draft'), 'on his page');
});

test('2: a mark that can’t be placed after following renames is named and Send doesn’t go out; a mark already at the new address stands over the older one a rename moves', async () => {
  const { sendNotes } = await import('../functions/api/_board-notes.js');
  const { notesMoved } = await import('../functions/api/_board-rename.js');
  const made = (await api({ action: 'new-meeting', date: inDays(0) })).body.meeting;
  await env.DB.prepare("UPDATE board_meetings SET data = json_set(data, '$.shared', json('true')) WHERE id = ?").bind(made.id).run();
  // A mark for an address nobody on People or the roll has, and no rename to follow
  await env.DB.prepare("INSERT INTO audit_log (user_email, action, entity_type, entity_slug, entity_name, created_at) VALUES ('x', 'deleted', 'team', 'lee-gone', 'Lee Gone', datetime('now'))").run();
  await env.DB.prepare('INSERT INTO board_minutes_notes (meeting_id, data, updated_at) VALUES (?, ?, ?)').bind(made.id, JSON.stringify({ 'r:lee-gone': 'present', 'r:alex-rivera': 'present' }), new Date().toISOString()).run();
  const w = { admin: true, adminEmail: FOUNDER };
  await assert.rejects(() => sendNotes(env, made.id, w), (e) => e.status === 409 && /Lee Gone \(Here\) is marked in your notes but isn’t on this meeting’s list, so the minutes weren’t sent/.test(e.message) && e.extra?.unplaced?.[0] === 'r:lee-gone');
  assert.ok(!(await getMeeting(env.DB, made.id)).attendance.some((p) => p.status), 'nothing went on the meeting');
  // The rename's move: the mark made since at the new address is the newer, and stands
  assert.deepEqual(notesMoved({ 'r:sam-ortiz': 'present', 'r:sam-new': 'remote' }, null, 'sam-ortiz', 'sam-new').data, { 'r:sam-new': 'remote' });
});

// ─── 4: refused at the moment of one's own rename ──────────────────

test('4: the Advisory Board lead and a member’s own to-do are theirs at the moment of their rename, either side of its moves; someone else’s still isn’t', async () => {
  const { whoIs, saveSettings: saveAdvisory } = await import('../functions/api/_advisory.js');
  await saveAdvisory(env.DB, { lead: 'alex-rivera' });
  const made = (await api({ action: 'new-meeting', date: inDays(-3) })).body.meeting;
  const m0 = await getMeeting(env.DB, made.id);
  await api({ action: 'save-meeting', base: m0.updatedAt, meeting: { ...m0, shared: true, actions: [{ id: 'a_r9alex', owner: 'alex-rivera', text: 'Send the venue contract to the board' }, { id: 'a_r9kim', owner: 'kim-park', text: 'Kim’s own' }] } });
  // The rename's batch done (People and the email at the new address, its note written), its moves not yet
  const raw = env.DB;
  await raw.prepare("UPDATE team SET slug = 'alex-r9' WHERE slug = 'alex-rivera'").run();
  await raw.prepare("UPDATE reveal_board_emails SET slug = 'alex-r9' WHERE slug = 'alex-rivera'").run();
  await raw.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind('rename-finish:alex-rivera', JSON.stringify({ from: 'alex-rivera', to: 'alex-r9', at: new Date().toISOString(), by: FOUNDER }), new Date().toISOString()).run();
  const signedInNew = { env, data: { boardMember: { slug: 'alex-r9', name: 'Alex Rivera', committees: [], email: ALEX } } };
  assert.equal((await whoIs(signedInNew))?.kind, 'lead', 'the lead still at the old address: theirs');
  assert.deepEqual(await setActionDone(env.DB, 'a_r9alex', true, { by: ALEX, slug: 'alex-r9' }).then((x) => x.done), true, 'their own to-do, still at the old address');
  await assert.rejects(() => setActionDone(env.DB, 'a_r9kim', true, { by: ALEX, slug: 'alex-r9' }), (e) => e.status === 403, 'someone else’s still isn’t');
  // The moves done (the lead and the to-do at the new address), a sign-in read just before the rename
  const { moveBoardSlug } = await import('../functions/api/_board-rename.js');
  await moveBoardSlug(env.DB, 'alex-rivera', 'alex-r9');
  await saveAdvisory(env.DB, { lead: 'alex-r9' });
  const signedInOld = { env, data: { boardMember: { slug: 'alex-rivera', name: 'Alex Rivera', committees: [], email: ALEX } } };
  assert.equal((await whoIs(signedInOld))?.kind, 'lead', 'the sign-in from before the rename: theirs');
  assert.equal((await setActionDone(env.DB, 'a_r9alex', false, { by: ALEX, slug: 'alex-rivera' })).done, false);
  // A failed read is "couldn't check", never "not for you"
  await raw.prepare("DELETE FROM board_state WHERE key = 'rename-finish:alex-rivera'").run();
  failOnce(/^SELECT slug FROM team$/);
  await assert.rejects(() => whoIs(signedInOld), (e) => e.status === 503 && e.message === SIGN_IN_DOWN);
  answers();
});

// ─── 7: a roll correction across a rename ──────────────────────────

test('7: a roll correction suggested before a rename moves with it, counts as a place, and is made on them after', async () => {
  const { suggestCorrection, decideCorrection } = await import('../functions/api/_board-corrections.js');
  const { keptAt } = await import('../functions/api/_member-places.js');
  const made = (await api({ action: 'new-meeting', date: inDays(-150) })).body.meeting;
  const m0 = await getMeeting(env.DB, made.id);
  await api({ action: 'save-meeting', base: m0.updatedAt, meeting: { ...m0, shared: true, attendance: m0.attendance.map((p) => ({ ...p, status: p.slug === 'alex-rivera' ? 'present' : 'excused' })) } });
  await env.DB.prepare("UPDATE board_meetings SET data = json_set(data, '$.minutesFrom', json(?)) WHERE id = ?").bind(JSON.stringify({ name: 'Minutes.docx', at: new Date().toISOString() }), made.id).run();
  const alex = { member: { slug: 'alex-rivera', name: 'Alex Rivera', email: ALEX } };
  const { correction } = await suggestCorrection(env, { meetingId: made.id, target: 'r:kim-park', words: 'remote' }, alex);
  assert.ok((await keptAt(env.DB, 'kim-park', { owners: ['board'] })).some((k) => k.kind === 'board_minutes_corrections_roll'), 'counted at the old address while it’s there');
  assert.equal((await rename('kim-park', 'kim-park-c17')).status, 200);
  const kept = await env.DB.prepare('SELECT target FROM board_minutes_corrections WHERE id = ?').bind(correction.id).first();
  assert.equal(kept.target, 'r:kim-park-c17', 'moved with Kim');
  assert.deepEqual(await keptAt(env.DB, 'kim-park', { owners: ['board'] }), [], 'nothing left at the old address');
  const d = await decideCorrection(env, { id: correction.id, make: true }, { admin: true, adminEmail: FOUNDER });
  assert.equal(d.state, 'made');
  assert.equal((await getMeeting(env.DB, made.id)).attendance.find((p) => p.slug === 'kim-park-c17')?.status, 'remote');
});

// ─── admin 3, 4, 5: a page open across a rename, a newcomer at the old address ──

test('admin 3: the template and a practice meeting saved from a page open across a rename follow it even when a newcomer has the old address; who presents and its line agree', async () => {
  const s0 = await getSettings(env.DB);
  const withSam = s0.template.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_r9fin', title: 'Financial', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec));
  const opened = await saveSettings(env.DB, { template: withSam }, FOUNDER, { base: s0.templateAt });
  const p0 = await createPractice(env, { by: FOUNDER });
  const practice = await saveMeeting(env.DB, { ...p0, sections: p0.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_r9ytd', title: 'Year to date', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec)) }, { by: FOUNDER, base: p0.updatedAt });
  const other = (await api({ action: 'new-meeting', date: inDays(60) })).body.meeting;
  await later();
  assert.equal((await rename('sam-ortiz', 'sam-ortiz-new')).status, 200);
  await addPerson('sam-ortiz', { name: 'Nora Newcomer', group: 'board', title: 'Board Member' });

  // The page picked Alex beside who it had (its line written from People as read now: the newcomer)
  const pick = (sections, id) => sections.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.id === id ? { ...it, who: ['sam-ortiz', 'alex-rivera'], presenter: 'Nora Newcomer & Alex Rivera' } : it)) }));
  const mine = pick(opened.template, 'i_r9fin');
  let threw = null;
  try { await saveSettings(env.DB, { template: mine }, FOUNDER, { base: opened.templateAt }); } catch (e) { threw = e; }
  assert.equal(threw?.status, 409, 'saved meanwhile by the rename: the page merges');
  assert.deepEqual(threw.extra?.addressesNow, { 'sam-ortiz': 'sam-ortiz-new' }, 'and is told the rename it follows, newcomer or not');
  // The page follows it in what it opened and what it has (board-meeting.js AgendaTemplate), then merges: no question
  const people = [{ slug: 'sam-ortiz', name: 'Nora Newcomer' }, { slug: 'sam-ortiz-new', name: 'Sam Ortiz' }, { slug: 'alex-rivera', name: 'Alex Rivera' }];
  const was = followAddresses({ sections: opened.template }, threw.extra.addressesNow, { people });
  const now = followAddresses({ sections: mine }, threw.extra.addressesNow, { people });
  const theirs = cleanMeeting({ sections: threw.current.template });
  const { merged, clashes } = mergeMeeting(cleanMeeting(was), cleanMeeting(now), theirs);
  assert.deepEqual(clashes, [], 'nothing to ask: the rename and the pick are different changes');
  const saved = await saveSettings(env.DB, { template: merged.sections }, FOUNDER, { base: threw.current.at });
  assert.deepEqual([itemOf(saved.template, 'Financial').who, itemOf(saved.template, 'Financial').presenter], [['sam-ortiz-new', 'alex-rivera'], 'Sam Ortiz & Alex Rivera']);
  const fromIt = (await api({ action: 'new-meeting', date: inDays(90) })).body.meeting;
  assert.deepEqual(itemOf(fromIt.sections, 'Financial').who, ['sam-ortiz-new', 'alex-rivera'], 'a meeting made from it: Sam, never Nora');

  // A practice meeting saved from the copy opened before the rename (the server follows it since its base, newcomer or not)
  let p409 = null;
  try { await saveMeeting(env.DB, { ...practice, sections: pick(practice.sections, 'i_r9ytd') }, { by: FOUNDER, base: practice.updatedAt }); } catch (e) { p409 = e; }
  assert.equal(p409?.status, 409);
  assert.deepEqual(p409.extra?.addressesNow, { 'sam-ortiz': 'sam-ortiz-new' });
  const pw = followAddresses(cleanMeeting(practice), p409.extra.addressesNow, { people });
  const pm = followAddresses(cleanMeeting({ ...practice, sections: pick(practice.sections, 'i_r9ytd') }), p409.extra.addressesNow, { people });
  const pmerge = mergeMeeting(pw, pm, cleanMeeting(p409.current));
  assert.deepEqual(pmerge.clashes, []);
  const psaved = await saveMeeting(env.DB, { ...p409.current, ...pmerge.merged }, { by: FOUNDER, base: p409.current.updatedAt });
  assert.deepEqual([itemOf(psaved.sections, 'Year to date').who, itemOf(psaved.sections, 'Year to date').presenter], [['sam-ortiz-new', 'alex-rivera'], 'Sam Ortiz & Alex Rivera']);
  assert.equal(p409.current.updatedBy, 'People (renaming Sam Ortiz)', 'admin 5: the rename named, as the template names it');

  // A meeting the rename never touched: a newcomer picked there is the newcomer
  const oc = await getMeeting(env.DB, other.id);
  const withNora = { ...oc, sections: oc.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_r9nora', title: 'Welcome', who: ['sam-ortiz'], presenter: 'Nora Newcomer' }] } : sec)) };
  const kept = await saveMeeting(env.DB, withNora, { by: FOUNDER, base: oc.updatedAt });
  assert.deepEqual(itemOf(kept.sections, 'Welcome').who, ['sam-ortiz'], 'Nora presents her own item');
  // …and the rule itself: a rename since the base, from a record that names the new address, is followed whoever has the old one
  assert.deepEqual(await addressesNow(env.DB, ['sam-ortiz'], { since: opened.templateAt, moved: (x) => x === 'sam-ortiz-new' }), { 'sam-ortiz': 'sam-ortiz-new' });
  assert.deepEqual(await addressesNow(env.DB, ['sam-ortiz'], { since: opened.templateAt, moved: () => false }), {});
  assert.deepEqual(await addressesNow(env.DB, ['sam-ortiz']), {}, 'without a base: the newcomer’s');
});

test('admin 4: who presents and its presenter line merge as one thing, whichever way the question goes', () => {
  const item = (who, presenter) => ({ id: 'i_x', title: 'Financial', who, presenter });
  const base = cleanMeeting({ sections: [{ id: 's_a', title: 'Reports', items: [item(['sam-ortiz'], 'Sam Ortiz')] }] });
  const mine = cleanMeeting({ sections: [{ id: 's_a', title: 'Reports', items: [item(['sam-ortiz', 'alex-rivera'], 'Sam Ortiz & Alex Rivera')] }] });
  const theirs = cleanMeeting({ sections: [{ id: 's_a', title: 'Reports', items: [item(['sam-ortiz-new'], 'Sam Ortiz')] }] });
  for (const [prefer, want] of [['theirs', [['sam-ortiz-new'], 'Sam Ortiz']], ['mine', [['sam-ortiz', 'alex-rivera'], 'Sam Ortiz & Alex Rivera']]]) {
    const { merged, clashes } = mergeMeeting(base, mine, theirs, { prefer });
    assert.equal(clashes.length, 1);
    const it = merged.sections[0].items[0];
    assert.deepEqual([it.who, it.presenter], want, `prefer ${prefer}`);
  }
  // Only the line changed one way, only who the other: still one thing, asked once
  const onlyLine = cleanMeeting({ sections: [{ id: 's_a', title: 'Reports', items: [item(['sam-ortiz'], 'Sam O.')] }] });
  const r = mergeMeeting(base, onlyLine, theirs, { prefer: 'theirs' });
  assert.deepEqual([r.merged.sections[0].items[0].who, r.merged.sections[0].items[0].presenter], [['sam-ortiz-new'], 'Sam Ortiz']);
});

test('admin 5: a rename’s rewrite of a board meeting names the rename, as the template’s does', async () => {
  const made = (await api({ action: 'new-meeting', date: inDays(30) })).body.meeting;
  const m0 = await getMeeting(env.DB, made.id);
  const r = await api({ action: 'save-meeting', base: m0.updatedAt, meeting: { ...m0, actions: [{ id: 'a_r9s5', owner: 'sam-ortiz', text: 'Bring the audit letter' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await rename('sam-ortiz', 'sam-ortiz-new')).status, 200);
  assert.equal((await getMeeting(env.DB, made.id)).updatedBy, 'People (renaming Sam Ortiz)');
});
