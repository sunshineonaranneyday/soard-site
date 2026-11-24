/**
 * Board QA round 13 (Nov 24 2026), the privacy tester's findings, and Board admin's finding 5:
 *   F1  a signature lands whole: the signature, its 'signed' event, the member's agreement to sign electronically and its
 *       'consented' event are one write (a paper's, and the secretary's on approved minutes); a second press never skips
 *       an agreement the record doesn't have; the auditor's download shows the agreement only when the chain does
 *   F2  a correction and the email it owes the secretary and the founders are one write; pressed again, the email is
 *       owed if it never was, and they get it once
 *   F3  a decline and the email it owes who runs Board are one write; the member is told whether it went or is owed,
 *       and the signing look sends one owed, once
 *   F4  (and Board admin's 5) the board page's presses and the meeting page's own save: the database failing anywhere
 *       is said in the press's words (503, "…so nothing was changed / signed / sent"), never "Something went wrong …
 *       Reload the page"; once it landed (its answer lost included), it answers with what it did
 *   F5  Email all: the site's own record failing before anything went is "so nothing was sent", never "the connection
 *       dropped"
 *   F6  "no longer signs in with this email" never goes to an address that signs anyone in: the Advisory Board, staff
 *   F7  the chair's own approval in another tab is "You approved it already, maybe in another tab.", as Board says it
 * Each press is swept: every statement it makes failing once in turn (after a clean control), and each one landing with
 * its answer lost, the words judged against what the database and the fakes show. Made-up people only (the repo is
 * public). Run: node --test tests/board-round13-privacy.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { holdClockAt } from './lib/clock.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as invitesAdmin from '../functions/api/reveal-invites-admin.js';
import * as board from '../functions/api/_board.js';
import { maybeRunSigning, appendEvents, checkChain, sha256Hex, CONSENT_TEXT } from '../functions/api/_board-sign.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import * as shared from '../public/admin/board-shared.js';

const { cleanMeeting, todayEastern } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const KIM = 'kim.board@example.com';
const ADA = 'ada.adv@example.com';
const MIN = 60_000;
const DAY = 86_400_000;
const YEAR = Number(todayEastern().slice(0, 4));
/** The words a press says when nothing of it landed: round 12's, a press's own, People's and the setup's */
const NOTHING = /nothing was (changed|sent|signed)|couldn’t check (your sign-in|People)|couldn’t open the board’s records|couldn’t approve the agenda/i;
const WRONG = /Something went wrong|Reload the page to see what was saved/i;
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
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const GOOGLE_KEY = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', private_key: PEM, token_uri: 'https://oauth2.googleapis.com/token' });
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', seat: 'chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
  ['ada-example', { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['kim-park', KIM], ['ada-example', ADA]];

// ─── The database not answering one statement, or answering it and losing the answer ───
// Every statement a press makes is counted (one in a batch too, which then fails whole, as D1's does), and the k-th
// fails once: before it runs (`fail`), or after the database took it (`lost`: the connection dropped on its answer).
// Board's own table setup (CREATE, ALTER, PRAGMA) is left out, as the tester's sweep has it
let raw;
let fault = null; // { k, seen, failed, mode }
const SETUP = /^\s*(CREATE|ALTER|PRAGMA)\b/i;
const hit = (sql) => {
  if (!fault || SETUP.test(String(sql || ''))) return false;
  const i = fault.seen++;
  if (i !== fault.k) return false;
  fault.failed.push(String(sql));
  return true;
};
const LOST = () => new Error('D1_ERROR: Network connection lost.');
const wrap = (st) => new Proxy(st, {
  get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => {
    if (!hit(s._sql)) return s[m](...a);
    if (fault.mode === 'lost') await s[m](...a);
    throw LOST();
  } : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
});
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => {
      let lost = false;
      for (const s of stmts) if (hit(s._sql)) { if (fault.mode !== 'lost') throw LOST(); lost = true; }
      const r = await raw.batch(stmts);
      if (lost) throw LOST();
      return r;
    }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});

let env;
const files = new Map();
let mail; // every email Resend took: { to, subject, kind, key }
let gmail; // every Gmail send: { raw }
let resendKeys;
let resendDown = 0; // Resend answering 502 this many times
let gmailDown = false;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
  raw = await createD1();
  files.clear();
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', GOOGLE_CALENDAR_KEY: GOOGLE_KEY,
    FILES: { get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length } : null), head: async (k) => (files.has(k) ? { size: files.get(k).length } : null), put: async (k, v) => { files.set(k, new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); }, delete: async (k) => { files.delete(k); } },
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
  await stateReady(env.DB);
  await ensureAsks(env.DB);
  _resetKeyCacheForTests();
  clearTokenCache();
  mail = [];
  gmail = [];
  resendKeys = new Map();
  resendDown = 0;
  gmailDown = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      if (resendDown > 0) { resendDown -= 1; return new Response('Bad gateway', { status: 502 }); }
      const key = init.headers?.['Idempotency-Key'] || '';
      if (key && resendKeys.has(key)) { const had = resendKeys.get(key); return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }); }
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), subject: e.subject, kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '', key });
      const res = Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` };
      if (key) resendKeys.set(key, { body: init.body, res });
      return Response.json(res);
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/')) {
      const path = url.slice('https://gmail.googleapis.com/gmail/v1/users/me/'.length);
      if (path === 'messages/send') {
        if (gmailDown) throw new TypeError('fetch failed');
        gmail.push(JSON.parse(init.body));
        return Response.json({ id: `gm_${gmail.length}`, threadId: `th_${gmail.length}` });
      }
      if (path.startsWith('messages?')) return Response.json({ messages: [] });
      if (path.startsWith('messages/')) return Response.json({ id: path.split(/[/?]/)[1], payload: { headers: [{ name: 'Message-ID', value: `<${path.split(/[/?]/)[1]}@mail.example>` }] } });
      return Response.json({});
    }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) return Response.json({ items: [] });
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

/** A route behind the real sign-in middleware, as `who`; what it left running is finished before it answers here */
async function route(handler, path, who, { method = 'GET', body = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method, headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const own = [];
  const ctx = { request, env, data: {}, waitUntil: (p) => { own.push(p); } };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
  const text = await res.text();
  await Promise.allSettled(own);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const api = (body) => route(admin, '/api/board-admin', FOUNDER, { method: 'POST', body });
const page = (who, body) => route(portal, '/api/board-portal', who, { method: 'POST', body });
const sql = async (q, ...b) => (await raw.prepare(q).bind(...b).all()).results || [];
const one = async (q, ...b) => (await sql(q, ...b))[0] || null;
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''}`.trim();
const kinds = (kind, from = 0) => mail.slice(from).filter((m) => m.kind === kind);
/** The signing look, as the heartbeat runs it, a few times */
const looks = async (n = 3) => { for (let i = 0; i < n; i++) await maybeRunSigning(env); };

const saveState = () => ({ bytes: raw._db.export(), mail: [...mail], gmail: [...gmail], files: new Map(files), keys: new Map(resendKeys) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  mail = [...s.mail];
  gmail = [...s.gmail];
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  resendKeys = new Map(s.keys);
  resendDown = 0;
  gmailDown = false;
}
async function later(ms, fn) {
  const back = holdClockAt(Date.now() + ms);
  try { return await fn(); } finally { back(); }
}

// ─── The world: papers to sign, a meeting ahead under the chair's review, a held one with draft minutes ───

const MARK = { type: 'typed', text: 'Sam Ortiz', style: 0, initials: 'SO' };
async function world() {
  const docs = [];
  for (const title of ['Board Member Expectations', 'Conflict of Interest Policy']) docs.push(await board.saveDoc(env.DB, { title, kind: 'policy', sign: true, body: `### ${title}\n\n- Come to three of four meetings` }, { by: FOUNDER }));
  // (the board told how to sign in, and the chair's review on: a meeting 5 days ahead with its agenda written)
  await raw.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(JSON.stringify({ sentAt: new Date().toISOString() }), new Date().toISOString()).run();
  assert.equal((await api({ action: 'save-settings', settings: { asks: 'on' } })).status, 200);
  const made = (await api({ action: 'new-meeting', date: inDays(5) })).body.meeting;
  const sections = made.sections.map((s, k) => ({ ...s, items: s.items.map((i, j) => (k === 0 && j === 0 ? { ...i, title: 'Welcome and the year so far', who: ['sam-ortiz'], presenter: 'Sam Ortiz' } : i)) }));
  const ahead = (await api({ action: 'save-meeting', base: made.updatedAt, meeting: { ...made, sections } })).body.meeting;
  const item = ahead.sections[0].items[0];
  // (a meeting held a month ago, its minutes in and shared, draft: corrections go on it)
  const held = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-30), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() }, attendance: EMAILS.filter(([s]) => s !== 'ada-example').map(([slug]) => ({ slug, key: slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board', status: 'present' })), sections: [{ title: 'New business', items: [{ title: 'Budget', notes: 'The budget passed.' }] }] }), { by: 'test' });
  // (and approved minutes, shared, the secretary to sign them)
  const approved = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-10), start: '08:00', end: '10:00', shared: true, minutes: 'approved', approvedOn: todayEastern(), minutesFrom: { typed: true, name: 'Typed', at: new Date().toISOString() }, attendance: EMAILS.filter(([s]) => s !== 'ada-example').map(([slug]) => ({ slug, key: slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board', status: 'present' })), sections: [{ title: 'New business', items: [{ title: 'Budget', notes: 'The budget passed.' }] }] }), { by: 'test' });
  return { docs, ahead, item, held, approved, from: saveState() };
}

/**
 * A press swept: the control (k = -1), then every statement failing once in turn, then each landing with its answer
 * lost. `judge({ r, k, mode, failed })` → '' or what's wrong. Returns { problems, runs }
 */
async function sweep(from, press, judge, { modes = ['fail', 'lost'], max = 400 } = {}) {
  const problems = [];
  let runs = 0;
  for (const mode of modes) {
    for (let k = mode === 'fail' ? -1 : 0; k < max; k++) {
      await restore(from);
      fault = k < 0 ? null : { k, seen: 0, failed: [], mode };
      let r;
      try { r = await press(); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
      const failed = fault?.failed?.[0] || '';
      fault = null;
      if (k >= 0 && !failed) break;
      runs += 1;
      const why = await judge({ r, k, mode, failed });
      if (why) problems.push(`${mode} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90) || 'control'}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 200)}: ${why}`);
    }
  }
  return { problems, runs };
}
const report = (out, at = 10) => {
  console.log(`# swept: ${out.runs} runs, ${out.problems.length} wrong`);
  assert.ok(out.runs >= at, `only ${out.runs} runs`);
  assert.deepEqual(out.problems, [], `${out.problems.length} problems in ${out.runs} runs:\n${out.problems.join('\n')}`);
};
/** The words judged against what happened: done → 200 in words that don't say otherwise; not done → refused in words */
function wordsFor(r, done) {
  if (WRONG.test(said(r))) return `said “${said(r)}”`;
  if (done) return r.status === 200 && !NOTHING.test(said(r)) ? '' : `it landed, and it answered ${r.status} “${said(r)}”`;
  if (typeof r.status !== 'number' || r.status < 400) return `nothing landed, and it answered ${r.status}`;
  return NOTHING.test(said(r)) ? '' : `nothing landed, and it said “${said(r)}”`;
}

// ─── F1: a signature lands whole ────────────────────────────────────

const signature = async (docId, slug = 'sam-ortiz') => {
  const sig = await one('SELECT how, at, consent_hash FROM board_signatures WHERE doc_id = ? AND slug = ?', docId, slug);
  const marks = await one('SELECT consent_at FROM board_member_marks WHERE slug = ?', slug);
  const ev = await sql("SELECT kind FROM board_sign_events WHERE slug = ? AND kind IN ('signed', 'consented') ORDER BY seq", slug);
  return { sig: !!sig, agreed: !!marks?.consent_at, signed: ev.filter((e) => e.kind === 'signed').length, consented: ev.filter((e) => e.kind === 'consented').length };
};

test('F1: Sam signs with his agreement’s write, or its event, failing once: nothing is signed and he’s told so; Sign again lands it whole', async () => {
  const w = await world();
  const d = w.docs[0];
  const sign = () => page(SAM, { action: 'sign', docId: d.id, name: 'Sam Ortiz', mark: MARK, consent: true, version: d.version, year: YEAR });
  // The tester's cases exactly: by the statement's own words, its first (marks) and its second (the consented event)
  for (const [what, re, nth] of [['his agreement’s write (INSERT INTO board_member_marks)', /^INSERT INTO board_member_marks/, 0], ['the agreement’s event (the second INSERT INTO board_sign_events)', /^INSERT INTO board_sign_events/, 1]]) {
    await restore(w.from);
    let n = 0;
    const picked = (q) => re.test(String(q)) && n++ === nth;
    // a fault on the picked statement alone
    const hookOne = async () => {
      const save = raw;
      const p = new Proxy(save, {
        get: (s, m) => (m === 'batch' ? async (stmts) => { if (stmts.some((x) => picked(x._sql))) throw LOST(); return s.batch(stmts); }
          : m === 'prepare' ? (q) => { const st = s.prepare(q); return new Proxy(st, { get: (o, mm) => (['run', 'first', 'all'].includes(mm) ? async (...a) => { if (picked(q)) throw LOST(); return o[mm](...a); } : mm === 'bind' ? (...a) => { const b = o.bind(...a); return new Proxy(b, { get: (bo, bm) => (['run', 'first', 'all'].includes(bm) ? async (...aa) => { if (picked(q)) throw LOST(); return bo[bm](...aa); } : typeof bo[bm] === 'function' ? bo[bm].bind(bo) : bo[bm]) }); } : typeof o[mm] === 'function' ? o[mm].bind(o) : o[mm]) }); }
            : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
      });
      raw = p;
      try { return await sign(); } finally { raw = save; }
    };
    const r = await hookOne();
    assert.ok(n > nth, `${what}: the statement came (${n})`);
    assert.equal(r.status, 503, `${what}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'We couldn’t save your signature just now, so nothing was signed. Please try again in a moment.');
    assert.deepEqual(await signature(d.id), { sig: false, agreed: false, signed: 0, consented: 0 }, `${what}: nothing kept`);
    const again = await sign();
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(await signature(d.id), { sig: true, agreed: true, signed: 1, consented: 1 }, `${what}: Sign again lands it whole`);
    assert.ok((await checkChain(env.DB)).ok, 'the chain checks out');
    // (his next paper: his agreement is on record, so he isn't asked again)
    const next = await page(SAM, { action: 'sign', docId: w.docs[1].id, name: 'Sam Ortiz', mark: MARK, consent: false, version: w.docs[1].version, year: YEAR });
    assert.equal(next.status, 200, JSON.stringify(next.body));
  }
});

test('F1: signing swept, every statement failing once and each landing with its answer lost: a signature is never kept without his agreement and its event, and the words say which', async () => {
  const w = await world();
  const d = w.docs[0];
  const out = await sweep(w.from, () => page(SAM, { action: 'sign', docId: d.id, name: 'Sam Ortiz', mark: MARK, consent: true, version: d.version, year: YEAR }), async ({ r }) => {
    const s = await signature(d.id);
    const whole = s.sig && s.agreed && s.signed === 1 && s.consented === 1;
    const none = !s.sig && !s.agreed && !s.signed && !s.consented;
    if (!whole && !none) return `half: ${JSON.stringify(s)}`;
    if (!(await checkChain(env.DB)).ok) return 'the chain is broken';
    const words = wordsFor(r, whole);
    if (words) return words;
    // pressed again: whole, once
    const again = await page(SAM, { action: 'sign', docId: d.id, name: 'Sam Ortiz', mark: MARK, consent: true, version: d.version, year: YEAR });
    const s2 = await signature(d.id);
    if (again.status !== 200 || !(s2.sig && s2.agreed && s2.signed === 1 && s2.consented === 1)) return `pressed again: ${again.status} ${JSON.stringify(s2)}`;
    return '';
  });
  report(out, 20);
});

test('F1: a signature already kept without his agreement (as round 12 could leave one): Sign again writes the agreement and its event, never skips it; the auditor’s download shows it only then', async () => {
  const w = await world();
  const d = w.docs[0];
  // (the signature and its 'signed' event alone, as the old code left them when the agreement's write failed)
  const consentHash = await sha256Hex(CONSENT_TEXT);
  const at = new Date().toISOString();
  await appendEvents(env.DB, async () => ({
    stmts: [env.DB.prepare('INSERT INTO board_signatures (doc_id, slug, year, version, name, at, how, consent_hash, process_v, record_tries, signer_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)').bind(d.id, 'sam-ortiz', YEAR, d.version, 'Sam Ortiz', at, 'typed', consentHash, SAM)],
    events: [{ kind: 'signed', docId: d.id, slug: 'sam-ortiz', year: YEAR, version: d.version, at, by: SAM, detail: { how: 'typed', name: 'Sam Ortiz', consentHash } }],
  }));
  assert.deepEqual(await signature(d.id), { sig: true, agreed: false, signed: 1, consented: 0 });
  // The auditor's download: no agreement in the chain, so none in signatures.csv
  const before = await exported(d.id);
  assert.ok(before.csv.includes('Sam Ortiz'), before.csv);
  assert.ok(!before.csvRow('Sam Ortiz').includes(consentHash), `no agreement said without its event: ${before.csvRow('Sam Ortiz')}`);
  assert.ok(!before.events.some((e) => e.kind === 'consented'));
  // Without ticking it: asked to agree (the record doesn't show it)
  const unticked = await page(SAM, { action: 'sign', docId: d.id, name: 'Sam Ortiz', mark: MARK, consent: false, version: d.version, year: YEAR });
  assert.equal(unticked.status, 409, JSON.stringify(unticked.body));
  assert.equal(unticked.body.consent, true);
  // Ticked: the same signature stands, and the agreement goes on record with it
  const again = await page(SAM, { action: 'sign', docId: d.id, name: 'Sam Ortiz', mark: MARK, consent: true, version: d.version, year: YEAR });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.at, at, 'the first signature is the signature');
  assert.deepEqual(await signature(d.id), { sig: true, agreed: true, signed: 1, consented: 1 });
  assert.ok((await checkChain(env.DB)).ok);
  const after = await exported(d.id);
  assert.ok(after.csvRow('Sam Ortiz').includes(consentHash), after.csvRow('Sam Ortiz'));
  assert.ok(after.events.some((e) => e.kind === 'consented' && e.slug === 'sam-ortiz'));
  // (and on his next paper's download too: his agreement, given on the first, is in its events)
  assert.equal((await page(SAM, { action: 'sign', docId: w.docs[1].id, name: 'Sam Ortiz', mark: MARK, consent: false, version: w.docs[1].version, year: YEAR })).status, 200);
  const second = await exported(w.docs[1].id);
  assert.ok(second.csvRow('Sam Ortiz').includes(consentHash) && second.events.some((e) => e.kind === 'consented' && e.slug === 'sam-ortiz'), second.csvRow('Sam Ortiz'));
});

test('F1: a signed copy SOARD adds over Sam’s own signature, swept: the copy’s file, the signature and the notice it owes him land in one write, or none of it and no bytes left', async () => {
  const w = await world();
  const d = w.docs[0];
  await restore(w.from);
  assert.equal((await page(SAM, { action: 'sign', docId: d.id, name: 'Sam Ortiz', mark: MARK, consent: true, version: d.version, year: YEAR })).status, 200);
  const from = saveState();
  const pdf = () => new File([new TextEncoder().encode('%PDF-1.4 signed by Sam on paper')], 'Expectations - Sam Ortiz.pdf', { type: 'application/pdf' });
  const out = await sweep(from, async () => {
    try { return { status: 200, body: await board.signWithCopy(env, d.id, pdf(), { slug: 'sam-ortiz', by: FOUNDER, replace: true, tell: true }) }; } catch (err) { return { status: err.status || 500, body: { error: err.message } }; }
  }, async ({ r }) => {
    const sig = await one('SELECT how, file_id FROM board_signatures WHERE doc_id = ? AND slug = ?', d.id, 'sam-ortiz');
    const rows = await sql("SELECT id, r2_key FROM board_files WHERE owner_type = 'signed'");
    const owed = (await sql("SELECT key FROM board_state WHERE key LIKE 'notice-due:void:%'")).length;
    const bytes = [...files.keys()].filter((k) => k.startsWith('board/signed/')).length;
    const landed = sig?.how === 'staff';
    if (landed && !(rows.length === 1 && rows[0].id === sig.file_id && owed === 1 && bytes === 1)) return `half: ${JSON.stringify({ sig, rows: rows.length, owed, bytes })}`;
    if (!landed && (sig?.how !== 'typed' || rows.length || owed || bytes)) return `half: ${JSON.stringify({ sig, rows: rows.length, owed, bytes })}`;
    if (landed && (r.status !== 200 || r.body?.owed == null)) return `landed, and it answered ${r.status} ${JSON.stringify(r.body)}`;
    if (!landed && r.status === 200) return 'answered 200 with nothing written';
    return '';
  });
  report(out, 15);
});

/** A ZIP read by hand from its central directory */
function unzip(bytes) {
  const buf = Buffer.from(bytes || []);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'a whole ZIP');
  const entries = {};
  for (let n = buf.readUInt16LE(end + 10), k = 0, p = buf.readUInt32LE(end + 16); k < n; k++) {
    const len = buf.readUInt16LE(p + 28);
    entries[buf.subarray(p + 46, p + 46 + len).toString('utf8')] = { size: buf.readUInt32LE(p + 20), offset: buf.readUInt32LE(p + 42) };
    p += 46 + len + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return (name) => { const e = entries[name]; const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28); return buf.subarray(start, start + e.size).toString('utf8'); };
}
async function exported(docId) {
  const request = new Request(`https://sunshineonaranneyday.com/api/board-admin?record=${docId}&year=${YEAR}`, { headers: { 'CF-Access-JWT-Assertion': await signIn(FOUNDER) } });
  const own = [];
  const ctx = { request, env, data: {}, waitUntil: (p) => own.push(p) };
  ctx.next = () => admin.onRequestGet(ctx);
  const res = await onRequest(ctx);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await Promise.allSettled(own);
  assert.equal(res.status, 200);
  const at = unzip(bytes);
  const csv = at('signatures.csv');
  return { csv, csvRow: (name) => csv.split('\r\n').find((l) => l.includes(name)) || '', events: JSON.parse(at('events.json')).events };
}

test('F1: the secretary signs approved minutes, swept: the signature, its event (and its hash on it) and her agreement land together, or nothing and said so', async () => {
  const w = await world();
  const mark = { type: 'typed', text: 'Taylor Nguyen', style: 0, initials: 'TN' };
  const out = await sweep(w.from, () => page(TAYLOR, { action: 'sign-minutes', meetingId: w.approved.id, mark, consent: true }), async ({ r }) => {
    const row = await one('SELECT event_hash FROM board_minutes_signed WHERE meeting_id = ?', w.approved.id);
    const s = await signature(`minutes_${w.approved.id}`, 'taylor-nguyen');
    const ev = await one("SELECT hash FROM board_sign_events WHERE slug = 'taylor-nguyen' AND kind = 'signed'");
    const whole = !!row && s.agreed && s.signed === 1 && s.consented === 1 && !!ev && row.event_hash === ev.hash;
    const none = !row && !s.agreed && !s.signed && !s.consented;
    if (!whole && !none) return `half: ${JSON.stringify({ row, ...s, ev })}`;
    return wordsFor(r, whole);
  });
  report(out, 15);
});

// ─── F2: a correction and the email it owes, one write ──────────────

const corrections = () => sql('SELECT id, state, words FROM board_minutes_corrections');
const correctionOwed = async () => (await sql("SELECT key FROM board_state WHERE key LIKE 'notice-due:correction:%'")).length;
const suggest = (w, words = 'absent') => page(SAM, { action: 'correction', meetingId: w.held.id, target: 'r:kim-park', words });
const perCorrection = (m0) => { const got = kinds('board-correction', m0); return Object.fromEntries([TAYLOR, FOUNDER, SAM].map((e) => [e, got.filter((x) => x.to.includes(e)).length])); };

test('F2: Sam suggests a correction with the email it owes failing to be written down: nothing kept and said so; pressed again, Taylor and Jane are emailed once', async () => {
  const w = await world();
  const m0 = mail.length;
  // (the tester's case: the notice's own write, INSERT INTO board_state … ON CONFLICT(key) DO NOTHING, failing once)
  let k = -1;
  for (let i = 0; i < 400 && k < 0; i++) {
    await restore(w.from);
    fault = { k: i, seen: 0, failed: [], mode: 'fail' };
    await suggest(w);
    const f = fault.failed[0] || '';
    fault = null;
    if (!f) break;
    if (/^INSERT INTO board_state \(key, data, updated_at\) VALUES \(\?, \?, \?\) ON CONFLICT\(key\) DO NOTHING/.test(f) || /notice-due/.test(f)) k = i;
  }
  await restore(w.from);
  if (k < 0) {
    // (the notice is in the correction's own batch now: the batch failing is that write failing)
    for (let i = 0; i < 400 && k < 0; i++) {
      await restore(w.from);
      fault = { k: i, seen: 0, failed: [], mode: 'fail' };
      await suggest(w);
      const f = fault.failed[0] || '';
      fault = null;
      if (!f) break;
      if (/^INSERT INTO board_minutes_corrections/.test(f)) k = i;
    }
  }
  assert.ok(k >= 0, 'the correction’s write found');
  await restore(w.from);
  fault = { k, seen: 0, failed: [], mode: 'fail' };
  const r = await suggest(w);
  fault = null;
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error, 'We couldn’t save that just now, so nothing was changed. Please try again in a moment.');
  assert.deepEqual(await corrections(), [], 'nothing kept');
  assert.equal(await correctionOwed(), 0);
  const again = await suggest(w);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  await looks();
  for (const ms of [60 * MIN, DAY]) await later(ms, () => looks());
  assert.deepEqual(perCorrection(m0), { [TAYLOR]: 1, [FOUNDER]: 1, [SAM]: 0 }, 'the secretary and the founders, once each');
});

test('F2: the correction swept, every statement failing once and each landing with its answer lost: never a correction without the email it owes, and they get it once', async () => {
  const w = await world();
  const out = await sweep(w.from, () => suggest(w), async ({ r }) => {
    const c = await corrections();
    const owed = (await correctionOwed()) > 0 || kinds('board-correction').length > 0;
    if (c.length > 1) return `two corrections: ${JSON.stringify(c)}`;
    if (c.length && !owed) return 'kept with no email owed';
    if (!c.length && owed) return 'an email owed for no correction';
    const words = wordsFor(r, c.length === 1);
    if (words) return words;
    // pressed again (as told, or a second tab), the signing look, a day on
    await suggest(w, c.length ? 'remote' : 'absent');
    await looks();
    await later(DAY, () => looks());
    const each = perCorrection(0);
    if (each[TAYLOR] !== 1 || each[FOUNDER] !== 1 || each[SAM] !== 0) return `emailed ${JSON.stringify(each)}`;
    return '';
  });
  report(out, 20);
});

test('F2: a correction from before its email was written with it (none owed, none sent): reworded, it’s owed now and goes once; one told already isn’t told again', async () => {
  const w = await world();
  // (as round 12 left one whose notice's write failed: kept, nothing owed)
  await raw.prepare('INSERT INTO board_minutes_corrections (id, meeting_id, target, kind, was, words, by_slug, by_name, by_email, at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('c_legacy01', w.held.id, 'r:kim-park', 'roll', 'present', 'absent', 'sam-ortiz', 'Sam Ortiz', SAM, new Date().toISOString(), 'waiting').run();
  const m0 = mail.length;
  const r = await suggest(w, 'remote');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.correction.id, 'c_legacy01', 'his own waiting one, reworded');
  await looks();
  assert.deepEqual(perCorrection(m0), { [TAYLOR]: 1, [FOUNDER]: 1, [SAM]: 0 });
  // Reworded again, two days on (past Resend's day of keys): told already, so nobody is emailed again
  const r2 = await later(2 * DAY, () => suggest(w, 'excused'));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  await later(2 * DAY, () => looks());
  assert.deepEqual(perCorrection(m0), { [TAYLOR]: 1, [FOUNDER]: 1, [SAM]: 0 }, 'once');
});

// ─── F3: a decline and the email it owes, one write ─────────────────

const declineOf = (w) => () => page(SAM, { action: 'decline', docId: w.docs[0].id, reason: 'I need to read it with my lawyer', year: YEAR });
const declined = async () => (await sql("SELECT seq FROM board_sign_events WHERE kind = 'declined' AND slug = 'sam-ortiz'")).length;
const declineOwed = async () => (await sql("SELECT key FROM board_state WHERE key LIKE 'notice-due:declined:%'")).length;

test('F3: Sam declines with a read of the admins failing, or Resend not answering: he’s told it goes in a few minutes, never “Sent”; the signing look sends it once', async () => {
  const w = await world();
  const press = declineOf(w);
  // The control: it goes with the press
  await restore(w.from);
  const ok = await press();
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.told, true);
  assert.equal(ok.body.sent, true, 'gone with the press');
  assert.deepEqual(kinds('board-declined').map((x) => x.to[0]), [FOUNDER]);
  // Resend answering 502: kept, owed, said so; the next look (after its wait) sends it once
  await restore(w.from);
  resendDown = 1;
  const r = await press();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, false, 'not said as sent');
  assert.equal(kinds('board-declined').length, 0);
  assert.equal(await declineOwed(), 1, 'owed');
  await later(6 * MIN, () => looks());
  await later(DAY, () => looks());
  assert.deepEqual(kinds('board-declined').map((x) => x.to[0]), [FOUNDER], 'once, by the look');
  // The page's words for each (public/admin/board/portal.js)
  const src = readFileSync(new URL('../public/admin/board/portal.js', import.meta.url), 'utf8');
  assert.match(src, /j\.sent === false \? 'SOARD gets it in a few minutes\. They’ll answer you by email\.'/);
});

test('F3: the decline swept, every statement failing once and each landing with its answer lost: kept only with its email owed or gone, told which, and who runs Board has it once', async () => {
  const w = await world();
  const press = declineOf(w);
  const out = await sweep(w.from, press, async ({ r }) => {
    const kept = await declined();
    const owed = await declineOwed();
    const went = kinds('board-declined').length;
    if (kept > 1) return `declined ${kept} times`;
    if (kept && !owed && !went) return 'kept, its email neither owed nor gone';
    if (!kept && (owed || went)) return 'an email for no decline';
    const words = wordsFor(r, kept === 1);
    if (words) return words;
    if (kept && r.body?.sent !== (went > 0)) return `said sent=${r.body?.sent}, and ${went} went`;
    await later(6 * MIN, () => looks());
    await later(DAY, () => looks());
    const n = kinds('board-declined').length;
    if (kept && n !== 1) return `Jane emailed ${n} times`;
    return '';
  });
  report(out, 20);
});

// ─── F4: the board page's presses, and the meeting page's own save ───

/** What a press changed, as one string to compare */
const snapshot = async () => JSON.stringify({
  meetings: (await sql('SELECT id, updated_at FROM board_meetings ORDER BY id')).map((x) => `${x.id}@${x.updated_at}`),
  notes: await sql('SELECT * FROM board_chair_notes ORDER BY item_id'),
  questions: (await sql('SELECT id, to_names FROM board_ask_questions ORDER BY id')),
  asks: (await sql("SELECT kind, status, in_at FROM board_asks WHERE kind IN ('chair', 'question') ORDER BY kind")),
  actions: await sql('SELECT action_id, done FROM board_action_state ORDER BY action_id'),
  corrections: await sql('SELECT id, state FROM board_minutes_corrections ORDER BY id'),
});
/**
 * A press swept for F4: whatever it changed, against its clean control's change; its words against that. `extra(r)`:
 * '' or what else is wrong (an email that went, say)
 */
async function pressSweep(from, press, { extra = null, min = 10, went = () => false } = {}) {
  await restore(from);
  const s0 = await snapshot();
  const c = await press();
  assert.equal(c.status, 200, `the control: ${JSON.stringify(c.body)}`);
  const changedTo = await snapshot();
  assert.notEqual(changedTo, s0, 'the control changed something');
  const out = await sweep(from, press, async ({ r }) => {
    const s = await snapshot();
    // (done: anything changed, or (`went`) an email someone has)
    const did = s !== s0 || went();
    const words = wordsFor(r, did);
    if (words) return words;
    return extra ? extra(r, did) : '';
  });
  report(out, min);
}

test('F4: Sam’s report, motion and slide order, swept: the database failing is said as nothing changed (503), never “Something went wrong … Reload the page”', async () => {
  const w = await world();
  await pressSweep(w.from, () => page(SAM, { action: 'report', meetingId: w.ahead.id, itemId: w.item.id, text: 'Cash is fine.', base: null }));
  await pressSweep(w.from, () => page(SAM, { action: 'motion', meetingId: w.ahead.id, itemId: w.item.id, text: 'Move to approve the budget', base: '' }));
  await pressSweep(w.from, () => page(SAM, { action: 'slide-order', meetingId: w.ahead.id, itemId: w.item.id, order: ['report'] }));
});

test('F4: Alex’s note on an item and his Approve the agenda on his review, swept: said in words, nothing changed or what was done', async () => {
  const w = await world();
  await pressSweep(w.from, () => page(ALEX, { action: 'chair-note', meetingId: w.ahead.id, itemId: w.item.id, text: 'Keep it short.' }));
  await pressSweep(w.from, () => page(ALEX, { action: 'chair-approve', meetingId: w.ahead.id }), { min: 20 });
});

test('F4: Alex’s question to who presents, swept: refused in words with nothing sent, or said as sent to whom (never “nothing was sent” over an email Sam has)', async () => {
  const w = await world();
  await pressSweep(w.from, () => page(ALEX, { action: 'ask-presenter', meetingId: w.ahead.id, itemId: w.item.id, question: 'What changed since June?' }), {
    went: () => gmail.length > w.from.gmail.length,
    extra: (r) => {
      const n = gmail.length - w.from.gmail.length;
      if (n > 1) return `${n} emails`;
      if (n && (r.status !== 200 || NOTHING.test(said(r)))) return `the email went, and it answered ${r.status} “${said(r)}”`;
      if (!n && r.status === 200) return 'answered 200 with nothing sent';
      return '';
    },
  });
});

test('F4: a correction taken back and a to-do ticked, swept', async () => {
  const w = await world();
  await restore(w.from);
  assert.equal((await suggest(w)).status, 200);
  await looks();
  const withOne = saveState();
  const cid = (await corrections())[0].id;
  await pressSweep(withOne, () => page(SAM, { action: 'correction-withdraw', id: cid }), { min: 3 });
  // A to-do of Sam's on the held meeting
  await restore(w.from);
  const held = await board.getMeeting(env.DB, w.held.id);
  await board.saveMeeting(env.DB, { ...held, actions: [{ id: 'a_r13todo', text: 'Send the budget', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(3) }] }, { by: 'test' });
  await pressSweep(saveState(), () => page(SAM, { action: 'action-done', actionId: 'a_r13todo', done: true }), { min: 5 });
});

test('Board admin 5: the meeting page’s own save, swept: the database failing is 503 “nothing was changed”, and the page says “Not saved: we couldn’t save that just now. Board keeps trying.”', async () => {
  const w = await world();
  await restore(w.from);
  const m = await board.getMeeting(env.DB, w.ahead.id);
  const sections = m.sections.map((s, k) => ({ ...s, items: s.items.map((i, j) => (k === 0 && j === 1 ? { ...i, title: 'Roll call and welcome' } : i)) }));
  await pressSweep(w.from, () => api({ action: 'save-meeting', base: m.updatedAt, meeting: { ...m, sections } }), { min: 15 });
  // The page's words for a save the site failing refused (public/admin/board-meeting.js): never "Reload the page"
  const src = readFileSync(new URL('../public/admin/board-meeting.js', import.meta.url), 'utf8');
  assert.match(src, /const said = lost && !j\.offline && !j\.unknown \? 'we couldn’t save that just now' : notSavedWhy\(j\);/);
  assert.match(src, /`Not saved: \$\{said\}\. Board keeps trying/);
});

// ─── F5: Email all, the site's own record failing before anything went ───

test('F5: Email all with its claim, its read or the writer’s other notes failing once: 503 “so nothing was sent”, Gmail sent nothing, and Send again goes once', async () => {
  const w = await world();
  const body = { action: 'email-all', subject: 'Budget question', message: 'Please read the budget before Thursday.' };
  for (const re of [/^INSERT INTO board_state \(key, data, updated_at\) VALUES \(\?, \?, \?\) ON CONFLICT\(key\) DO NOTHING/, /^SELECT data, updated_at FROM board_state WHERE key = \?/, /^SELECT key, data FROM board_state WHERE key LIKE \?/]) {
    // (the first statement of these words in the press)
    let k = -1;
    for (let i = 0; i < 200 && k < 0; i++) {
      await restore(w.from);
      fault = { k: i, seen: 0, failed: [], mode: 'fail' };
      await api(body);
      const f = fault.failed[0] || '';
      fault = null;
      if (!f) break;
      if (re.test(f)) k = i;
    }
    assert.ok(k >= 0, `${re}: found`);
    await restore(w.from);
    fault = { k, seen: 0, failed: [], mode: 'fail' };
    const r = await api(body);
    fault = null;
    assert.equal(r.status, 503, `${re}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'We couldn’t get your note ready just now, so nothing was sent. Please try again in a moment.');
    assert.ok(!r.body.unknown, 'never “the connection dropped”');
    assert.equal(gmail.length, w.from.gmail.length, 'nothing went');
    const again = await api(body);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(gmail.length, w.from.gmail.length + 1, 'once');
  }
  // Gmail's own answer that can't be told stays "may have gone"
  await restore(w.from);
  gmailDown = true;
  const r = await api(body);
  assert.equal(r.status, 503);
  assert.match(r.body.error, /may have gone/);
});

test('F5: Email all swept: every statement failing once and each landing with its answer lost, never “the connection dropped”, and nothing sent is said so', async () => {
  const w = await world();
  const body = { action: 'email-all', subject: 'Budget question', message: 'Please read the budget before Thursday.' };
  const out = await sweep(w.from, () => api(body), async ({ r }) => {
    const n = gmail.length - w.from.gmail.length;
    if (r.body?.unknown) return 'said as a dropped connection';
    if (WRONG.test(said(r))) return `said “${said(r)}”`;
    if (n > 1) return `${n} sent`;
    if (n && r.status !== 200) return `sent, and it answered ${r.status}`;
    if (!n && (r.status === 200 || !(NOTHING.test(said(r)) || /Nothing went out/.test(said(r))))) return `nothing sent, and it answered ${r.status} “${said(r)}”`;
    return '';
  });
  report(out, 10);
});

// ─── F6: "no longer signs in" only to an address that signs nobody in ───

test('F6: Kim’s board email changed and the old one given to an Advisory Board member, or to staff: the old address is never told it no longer signs in', async () => {
  const w = await world();
  for (const [who, slug, email] of [['an Advisory Board member', 'ada-example', KIM], ['nobody, then staff', null, KIM]]) {
    await restore(w.from);
    await looks(2);
    const m0 = mail.length;
    const set = (s, e) => route(invitesAdmin, '/api/reveal-invites-admin', FOUNDER, { method: 'POST', body: { boardEmail: { slug: s, email: e } } });
    if (slug) {
      assert.equal((await set('kim-park', 'kim.new@example.com')).status, 200);
      assert.equal((await set(slug, email)).status, 200, `${who} given ${email}`);
    } else {
      // (an old address on staff's own domain signs a staff member in)
      assert.equal((await set('kim-park', 'kim.park@soardcharity.com')).status, 200);
      assert.equal((await set('kim-park', 'kim.new@example.com')).status, 200);
    }
    await looks(4);
    const told = kinds('board-email-changed', m0).map((x) => x.to[0]);
    const notices = (await sql("SELECT detail FROM board_sign_events WHERE kind = 'notice-sent'")).map((x) => JSON.parse(x.detail));
    if (slug) {
      assert.deepEqual(told, [], `${who}: ${KIM} signs Ada in, never told it doesn’t`);
      assert.ok(notices.some((d) => d.skipped === 'signs in with it now'), JSON.stringify(notices));
    } else {
      assert.ok(!told.includes('kim.park@soardcharity.com'), `staff’s address never told: ${told}`);
      assert.ok(told.includes(KIM), `the address that signs nobody in now is told: ${told}`);
    }
  }
});

// ─── F7: the chair's own approval in another tab ────────────────────

test('F7: the chair’s review says his own approval in another tab as his: “You approved it already, maybe in another tab.”, from the one function Board uses', async () => {
  const w = await world();
  await restore(w.from);
  assert.equal((await page(ALEX, { action: 'chair-approve', meetingId: w.ahead.id })).status, 200);
  const again = await page(ALEX, { action: 'chair-approve', meetingId: w.ahead.id });
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
  assert.equal(again.body.mine, true);
  assert.equal(shared.approvedAlready({ by: again.body.approvedBy, at: again.body.approvedAt, mine: !!again.body.mine }), 'You approved it already, maybe in another tab.');
  // One function for these words, on both pages: Board's (board-ui.js) is the shared one, and the review uses it with `mine`
  const ui = await import('../public/admin/board-ui.js');
  assert.equal(ui.approvedAlready, shared.approvedAlready);
  const chair = readFileSync(new URL('../public/admin/board/chair.js', import.meta.url), 'utf8');
  assert.match(chair, /approvedAlready\(\{ by: j\.approvedBy, at: j\.approvedAt, mine: !!j\.mine \}\)/);
  assert.doesNotMatch(chair, /already approved it\./);
});
