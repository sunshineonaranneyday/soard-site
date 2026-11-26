/**
 * Board QA round 15 (Nov 26 2026), the privacy tester's findings:
 *   F1  a paper saved with a new file is ONE write: the new file's bytes put first, then the paper's new wording, the
 *       file's row, the wording's link to it and "the board signs again" land together, or nothing changes and it says
 *       so (503 "…nothing was changed"). Signatures stop counting only once a new wording has really landed, and the
 *       auditor's download has every wording members sign. A read after the write that fails answers 200 with what was
 *       saved, the page told to look again
 *   F2  a new day, time or place for a meeting whose invite is out is owed to the invite by the save's own write, its
 *       reads before: never a step after the save that can fail quietly. The heartbeat takes it to Google
 *   F3  deleting a paper while a member signs it: the two can't both land. The delete goes only while nobody has signed
 *       it, the signature only while the paper is there; whichever is second is refused in words
 *   F4  Board admin's Documents saves and deletes, and Delete this meeting, each land in one write with everything that
 *       names what they change (a meeting's files, answers, notes and corrections; a paper's file and wordings), the
 *       invite's cancel owed by that write and sent once after it; their answers say what happened
 * Each press is swept: every statement it makes failing once in turn (after a clean control), and each write landing
 * with its answer lost, the words judged against what the database and the fakes show happened, and what's left
 * checked whole. Made-up people only (the repo is public). Run: node --test tests/board-round15-privacy.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import { holdClockAt } from './lib/clock.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as admin from '../functions/api/board-admin.js';
import * as portal from '../functions/api/board-portal.js';
import * as board from '../functions/api/_board.js';
import * as invites from '../functions/api/_board-invite.js';
import { maybeRunSigning, checkChain } from '../functions/api/_board-sign.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import { stateReady } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import * as shared from '../public/admin/board-shared.js';

const { todayEastern } = shared;
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const KIM = 'kim.board@example.com';
const MIN = 60_000;
const DAY = 86_400_000;
const YEAR = Number(todayEastern().slice(0, 4));
/** The words a press says when nothing of it landed */
const NOTHING = /nothing was (changed|sent|signed)|couldn’t check (your sign-in|People)|couldn’t open the board’s records|so nothing|wasn’t kept/i;
const WRONG = /Something went wrong|Reload the page to see what was saved/i;
const UNSURE = /can’t tell yet/;
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const tokens = new Map();
async function signIn(email) {
  const had = tokens.get(email);
  if (had && had.exp - 600 > Date.now() / 1000 && had.iat <= Date.now() / 1000) return had.jwt;
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  const jwt = `${h}.${p}.${b64u(new Uint8Array(sig))}`;
  tokens.set(email, { jwt, iat: now, exp: now + 3600 });
  return jwt;
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
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['kim-park', KIM]];

// ─── The database not answering one statement, losing an answer, or taking a round trip ───
// Every statement a press makes is counted (one in a batch too, which then fails whole, as D1's does), and the k-th
// fails once: before it runs (`fail`), or after the database took it (`lost`). Board's own table setup is left out.
// `slow`: each call waits that many turns of the event loop first, as a real round trip to D1 does (the tester's
// /__qa/yield), so two presses' reads and writes interleave; a batch still runs whole, with nothing in between
let raw;
let fault = null; // { k, seen, failed, mode, only }
let slow = 0;
const SETUP = /^\s*(CREATE|ALTER|PRAGMA)\b/i;
const WRITES = /^\s*(INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i;
const hit = (sql) => {
  if (!fault || SETUP.test(String(sql || '')) || (fault.only && !fault.only.test(String(sql || '')))) return false;
  const i = fault.seen++;
  if (i !== fault.k) return false;
  fault.failed.push(String(sql));
  return true;
};
const LOST = () => new Error('D1_ERROR: Network connection lost.');
const trip = async () => { for (let i = 0; i < slow; i++) await new Promise((r) => setImmediate(r)); };
const wrap = (st) => new Proxy(st, {
  get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => {
    await trip();
    if (!hit(s._sql)) return s[m](...a);
    if (fault.mode === 'lost') await s[m](...a);
    throw LOST();
  } : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
});
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => {
      await trip();
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
let google; // the board's calendar: { events, calls, deletes }
let resendKeys;
let resendDown = 0;
let googleDeleteDown = 0; // Google refusing this many cancels
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
  slow = 0;
  raw = await createD1();
  files.clear();
  env = {
    DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, RESEND_API_KEY: 're_test', GOOGLE_CALENDAR_KEY: GOOGLE_KEY,
    FILES: { get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length } : null), head: async (k) => (files.has(k) ? { size: files.get(k).length } : null), put: async (k, v) => { files.set(k, new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); }, delete: async (k) => { for (const x of [].concat(k)) files.delete(x); } },
  };
  for (const q of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  ]) await raw.exec(q);
  for (const [slug, d] of PEOPLE) await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
  for (const [slug, email] of EMAILS) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await board.ensureSchema(env.DB);
  await stateReady(env.DB);
  await ensureAsks(env.DB);
  _resetKeyCacheForTests();
  clearTokenCache();
  mail = [];
  google = { events: {}, calls: [], deletes: 0 };
  resendKeys = new Map();
  resendDown = 0;
  googleDeleteDown = 0;
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
    if (url.startsWith('https://gmail.googleapis.com/')) return Response.json({ messages: [] });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      const u = new URL(url);
      if (method !== 'GET') google.calls.push({ method, url, sendUpdates: u.searchParams.get('sendUpdates') });
      if (method === 'GET' && u.pathname.endsWith('/events')) return Response.json({ items: [] });
      const id = decodeURIComponent(u.pathname.split('/').pop());
      if (method === 'POST') {
        const e = { ...body, status: 'confirmed', hangoutLink: 'https://meet.google.com/abc-defg-hij', attendees: (body?.attendees || []).map((a) => ({ ...a, responseStatus: 'needsAction' })) };
        google.events[e.id] = e;
        return Response.json(e);
      }
      const e = google.events[id];
      if (method === 'DELETE' && googleDeleteDown > 0) { googleDeleteDown -= 1; return Response.json({ error: { message: 'Backend Error' } }, { status: 503 }); }
      if (!e) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
      if (method === 'DELETE') { if (e.status === 'cancelled') return Response.json({ error: { message: 'Resource has been deleted' } }, { status: 410 }); e.status = 'cancelled'; google.deletes += 1; return new Response(null, { status: 204 }); }
      if (method === 'PATCH' || method === 'PUT') Object.assign(e, body);
      return Response.json(e);
    }
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; slow = 0; });

/** A route behind the real sign-in middleware, as `who`; what it left running is finished before it answers here */
async function route(handler, path, who, { method = 'GET', body = null, form = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, {
    method,
    headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const own = [];
  const ctx = { request, env, data: {}, waitUntil: (p) => { own.push(p); } };
  ctx.next = async () => (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  const res = await onRequest(ctx);
  const was = fault;
  fault = null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  await Promise.allSettled(own);
  fault = was;
  const text = new TextDecoder().decode(bytes);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text, bytes };
}
const api = (body, who = FOUNDER) => route(admin, '/api/board-admin', who, { method: 'POST', body });
const page = (who, body) => route(portal, '/api/board-portal', who, { method: 'POST', body });
const upload = (handler, path, who, fields) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return route(handler, path, who, { method: 'POST', form });
};
const pdf = (name, words = 'signed') => new File([new TextEncoder().encode(`%PDF-1.4 ${words}\n%%EOF`)], name, { type: 'application/pdf' });
const sql = async (q, ...b) => (await raw.prepare(q).bind(...b).all()).results || [];
const one = async (q, ...b) => (await sql(q, ...b))[0] || null;
const said = (r) => `${r.body?.error || ''} ${r.body?.later || ''}`.trim();
const kinds = (kind, from = 0) => mail.slice(from).filter((m) => m.kind === kind);
const looks = async (n = 3) => { for (let i = 0; i < n; i++) await maybeRunSigning(env); };
const quietly = async (fn) => { const was = fault; fault = null; try { return await fn(); } finally { fault = was; } };

const saveState = () => ({ bytes: raw._db.export(), mail: [...mail], files: new Map(files), keys: new Map(resendKeys), google: structuredClone(google) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  mail = [...s.mail];
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  resendKeys = new Map(s.keys);
  google = structuredClone(s.google);
  resendDown = 0;
  googleDeleteDown = 0;
  slow = 0;
}
async function later(ms, fn) {
  const back = holdClockAt(Date.now() + ms);
  try { return await fn(); } finally { back(); }
}

// ─── The world: papers to sign, a paper read as its file the board has signed, a meeting ahead with its invite out ───

const MARK = (name, initials) => ({ type: 'typed', text: name, style: 0, initials });
const signAs = async (who, name, initials, doc) => {
  await page(who, { action: 'opened', docId: doc.id });
  const r = await page(who, { action: 'sign', docId: doc.id, name, mark: MARK(name, initials), consent: true, version: doc.version, year: YEAR });
  assert.equal(r.status, 200, r.text);
  return r;
};
const docNamed = async (title) => (await board.listDocs(env.DB)).find((d) => d.title === title);
const COI_2027 = 'Conflict of Interest 2027.pdf';
async function world() {
  // A paper read as its file, signed this year by Alex and Kim; a paper with words Alex signed; a budget nobody signs;
  // Bylaws with its file and two wordings; Whistleblower Policy, to sign, nobody has yet
  const coi = await upload(admin, '/api/board-admin', FOUNDER, { saveDoc: JSON.stringify({ doc: { title: 'Conflict of Interest Policy', kind: 'policy', sign: true } }), file: pdf('Conflict of Interest.pdf', 'coi 2026') });
  assert.equal(coi.status, 200, coi.text);
  const expect = await board.saveDoc(env.DB, { title: 'Board Member Expectations', kind: 'policy', sign: true, body: '### Expectations\n\n- Come to three of four meetings' }, { by: FOUNDER });
  await board.saveDoc(env.DB, { title: '2026 Budget', kind: 'budget', body: '### Budget\n\n- Income: 100' }, { by: FOUNDER });
  const bylaws = await upload(admin, '/api/board-admin', FOUNDER, { saveDoc: JSON.stringify({ doc: { title: 'Bylaws', kind: 'bylaws' } }), file: pdf('Bylaws.pdf', 'bylaws') });
  assert.equal(bylaws.status, 200, bylaws.text);
  await board.saveDoc(env.DB, { ...bylaws.body.doc, body: '### Bylaws\n\n- Article 1' }, { by: FOUNDER });
  await board.saveDoc(env.DB, { ...(await docNamed('Bylaws')), body: '### Bylaws\n\n- Article 1\n- Article 2' }, { by: FOUNDER });
  const whistle = await board.saveDoc(env.DB, { title: 'Whistleblower Policy', kind: 'policy', sign: true, body: '### Whistleblower Policy\n\n- Speak up' }, { by: FOUNDER });
  await raw.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(JSON.stringify({ sentAt: new Date().toISOString() }), new Date().toISOString()).run();
  await signAs(ALEX, 'Alex Rivera', 'AR', coi.body.doc);
  await signAs(KIM, 'Kim Park', 'KP', coi.body.doc);
  await signAs(ALEX, 'Alex Rivera', 'AR', expect);
  await looks();
  // A meeting 9 days ahead at Example Hall, its agenda approved and its invite out; one far ahead with no invite. Each
  // with two files, an answer, the secretary's notes, a correction and a signed-minutes row beside it
  const ahead = (await api({ action: 'new-meeting', date: inDays(9) })).body.meeting;
  const placed = await api({ action: 'save-meeting', base: ahead.updatedAt, meeting: { ...ahead, location: 'Example Hall', address: '100 Example Street', start: '08:00', end: '10:00' } });
  assert.equal(placed.status, 200, placed.text);
  assert.equal((await api({ action: 'approve-agenda', id: ahead.id })).status, 200);
  const sent = await api({ action: 'send-invite', id: ahead.id });
  assert.equal(sent.status, 200, sent.text);
  const far = (await api({ action: 'new-meeting', date: inDays(60) })).body.meeting;
  for (const m of [ahead, far]) {
    for (const name of ['Board Packet.pdf', 'Budget notes.pdf']) assert.equal((await upload(admin, '/api/board-admin', FOUNDER, { ownerType: 'meeting', ownerId: m.id, kind: 'other', file: pdf(name, name) })).status, 200);
    await raw.prepare("INSERT INTO board_rsvps (meeting_id, slug, answer, at) VALUES (?, 'sam-ortiz', 'yes', ?)").bind(m.id, new Date().toISOString()).run();
    await raw.prepare("INSERT INTO board_minutes_notes (meeting_id, data, updated_at) VALUES (?, '{}', ?)").bind(m.id, new Date().toISOString()).run();
    await raw.prepare("INSERT INTO board_minutes_corrections (id, meeting_id, target, kind, at, state) VALUES (?, ?, 'general', 'general', ?, 'waiting')").bind(`c_${m.id}`, m.id, new Date().toISOString()).run();
    await raw.prepare("INSERT INTO board_minutes_signed (meeting_id, slug, name, at) VALUES (?, 'taylor-nguyen', 'Taylor Nguyen', ?)").bind(m.id, new Date().toISOString()).run();
  }
  google.calls = [];
  return {
    coi: await docNamed('Conflict of Interest Policy'), expect: await docNamed('Board Member Expectations'), budget: await docNamed('2026 Budget'),
    bylaws: await docNamed('Bylaws'), whistle, ahead: await board.getMeeting(env.DB, ahead.id), far: await board.getMeeting(env.DB, far.id), from: saveState(),
  };
}

// ─── What a press changed, judged against what it said ──────────────

const CACHES = /^(cash|cash-now|numbers|projects|finance|books|gifts|costs|runs|makeover-costs|calendar|access|access-runs|mail|board-mail|asks|asks-once|attendance-runs|group:|board-group|reveals|events|live-|invite-moved-look|invite-notes)/;
const NOISE = /^(rate_limits|board_seen|board_signins|board_activity|board_activity_reports|audit_log|board_saves|board_ask_mail|sqlite_sequence)$/;
async function snapshot() {
  const tables = (await sql("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((t) => t.name).filter((t) => !NOISE.test(t));
  const out = {};
  for (const t of tables) {
    let rows = await sql(`SELECT * FROM ${t}`);
    // (a claim held while a press works, its letting go, and the site's own looks are no press's work)
    if (t === 'board_state') rows = rows.filter((r) => !CACHES.test(r.key) && !/^(board-deleting:|board-invite-sending:|board-send-claim|rate:)/.test(r.key));
    out[t] = JSON.stringify(rows.map((r) => JSON.stringify(r)).sort());
  }
  out.files = JSON.stringify([...files.keys()].sort());
  out.google = JSON.stringify([google.calls.length, google.deletes]);
  return out;
}
const changedIn = (a, b) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);

/** A press swept: the control, then every statement failing once in turn, then each write landing with its answer lost */
async function sweep(from, press, judge, { modes = ['fail', 'lost'], max = 400, prep = null } = {}) {
  const problems = [];
  let runs = 0;
  for (const mode of modes) {
    for (let k = mode === 'fail' ? -1 : 0; k < max; k++) {
      await restore(from);
      const ctx = prep ? await quietly(prep) : {};
      const s0 = await snapshot();
      fault = k < 0 ? null : { k, seen: 0, failed: [], mode, only: mode === 'lost' ? WRITES : null };
      let r;
      try { r = await press(ctx); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
      const failed = fault?.failed?.[0] || '';
      fault = null;
      if (k >= 0 && !failed) break;
      runs += 1;
      const did = changedIn(s0, await snapshot());
      const why = await judge({ r, k, mode, failed, did, ctx });
      if (why) problems.push(`${mode} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90) || 'control'}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 200)}${did.length ? ` (changed ${did.join(',')})` : ''}: ${why}`);
    }
  }
  return { problems, runs };
}
const report = (name, out, at = 1) => {
  console.log(`# ${name}: ${out.runs} runs, ${out.problems.length} wrong`);
  assert.ok(out.runs >= at, `${name}: only ${out.runs} runs`);
  assert.deepEqual(out.problems, [], `${name}: ${out.problems.length} problems in ${out.runs} runs:\n${out.problems.join('\n')}`);
};
/**
 * The words judged against what happened. Done (anything changed): 200, in words that don't say otherwise, never "can't
 * tell". Not done: refused in words that say so (503 "…nothing was changed / signed"). Never "Something went wrong"
 */
function wordsFor(r, did) {
  const words = said(r);
  if (WRONG.test(words) || r.status === 500) return `said ${r.status} “${words}”`;
  if (r.status === 'threw') return `threw ${words}`;
  if (did.length) return r.status === 200 && !NOTHING.test(words) && !UNSURE.test(words) ? '' : `it landed, and it answered ${r.status} “${words}”`;
  if (typeof r.status !== 'number' || r.status < 400) return `nothing landed, and it answered ${r.status} “${words}”`;
  return NOTHING.test(words) ? '' : `nothing landed, and it said ${r.status} “${words}”`;
}

/** `press` with the `nth` statement matching `pick(sql, params)` failing once, or landing with its answer lost → { r, hit } */
async function withOne(pick, press, { nth = 0, mode = 'fail' } = {}) {
  let n = 0;
  let hitIt = false;
  const was = raw;
  const test1 = typeof pick === 'function' ? pick : (q) => pick.test(String(q || ''));
  const chosen = (q, p) => { if (!test1(String(q || ''), p || [])) return false; if (n++ !== nth) return false; hitIt = true; return true; };
  const wrapOne = (st) => new Proxy(st, {
    get: (o, m) => (['run', 'first', 'all'].includes(m) ? async (...a) => { if (!chosen(o._sql, o._params)) return o[m](...a); if (mode === 'lost') await o[m](...a); throw LOST(); }
      : m === 'bind' ? (...a) => wrapOne(o.bind(...a)) : typeof o[m] === 'function' ? o[m].bind(o) : o[m]),
  });
  raw = new Proxy(was, {
    get: (s, m) => (m === 'prepare' ? (q) => wrapOne(s.prepare(q))
      : m === 'batch' ? async (stmts) => { const p = stmts.some((x) => chosen(x._sql, x._params)); if (p && mode !== 'lost') throw LOST(); const r = await s.batch(stmts); if (p) throw LOST(); return r; }
        : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
  });
  try { return { r: await press(), hit: hitIt }; } finally { raw = was; }
}

/** A ZIP read by hand from its central directory: its names, and each one's bytes as words */
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
  return { names: Object.keys(entries), at: (name) => { const e = entries[name]; const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28); return buf.subarray(start, start + e.size).toString('utf8'); } };
}
const record = async (docId) => {
  const r = await route(admin, `/api/board-admin?record=${docId}&year=${YEAR}`, FOUNDER);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  return unzip(r.bytes);
};

// ─── Papers, checked whole ──────────────────────────────────────────

/**
 * What's wrong with the papers as the site has them ('' when nothing): a wording kept with no paper, a wording numbered
 * past its paper's, a paper with no row for the wording it is, a paper read as its file whose wording isn't that file,
 * a file's row whose bytes aren't kept, or a paper's bytes that no row names
 */
async function papersWhole({ bytesToo = true } = {}) {
  const docs = (await sql('SELECT id, data FROM board_docs')).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
  const ids = new Set(docs.map((d) => d.id));
  const versions = await sql('SELECT doc_id, version, body, file_id FROM board_doc_versions');
  const rows = await sql("SELECT id, owner_id, r2_key, at FROM board_files WHERE owner_type = 'doc' ORDER BY at");
  const out = [];
  for (const v of versions) if (!ids.has(v.doc_id)) out.push(`wording ${v.version} of ${v.doc_id} kept with no paper`);
  for (const f of rows) if (!ids.has(f.owner_id)) out.push(`file ${f.id} kept for ${f.owner_id}, a paper that’s gone`);
  for (const d of docs) {
    const mine = versions.filter((v) => v.doc_id === d.id);
    if (mine.some((v) => Number(v.version) > Number(d.version || 0))) out.push(`${d.title}: a wording past its own (${d.version})`);
    const at = mine.find((v) => Number(v.version) === Number(d.version || 0));
    if (!at) { out.push(`${d.title}: no row for its wording ${d.version}`); continue; }
    const newest = rows.filter((f) => f.owner_id === d.id).at(-1);
    if (!d.body && (at.file_id || null) !== (newest?.id || null)) out.push(`${d.title}: wording ${d.version} is file ${at.file_id}, its file is ${newest?.id}`);
  }
  if (bytesToo) {
    for (const f of await sql('SELECT r2_key FROM board_files')) if (!files.has(f.r2_key)) out.push(`bytes missing for ${f.r2_key}`);
    const named = new Set((await sql('SELECT r2_key FROM board_files')).map((x) => x.r2_key));
    for (const k of files.keys()) if (k.startsWith('board/doc/') && !named.has(k)) out.push(`bytes nobody names: ${k}`);
  }
  return out.join('; ');
}
const counting = async (docId) => {
  const d = (await board.listDocs(env.DB)).find((x) => x.id === docId);
  return Object.keys(d?.signed || {}).sort();
};
const saveWithFile = (doc, { askAgain = true, name = COI_2027, words = 'coi 2027' } = {}) => upload(admin, '/api/board-admin', FOUNDER, { saveDoc: JSON.stringify({ doc, askAgain }), file: pdf(name, words) });

// ─── F1: a paper saved with a new file is one write ────────────────

test('F1: Conflict of Interest Policy (read as its file, Alex and Kim signed) saved with a new file and “sign again”, its file’s row or its wording failing once: 503 nothing changed, the paper as it was and both signatures counting, no new bytes kept; its read after failing: 200 with the new wording, the page told to look again', async () => {
  const w = await world();
  const press = () => saveWithFile(w.coi);
  for (const [what, pick, nth] of [
    ['its file’s row', /^INSERT INTO board_files/, 0],
    ['the wording', /^INSERT OR REPLACE INTO board_doc_versions/, 0],
    ['the paper’s own write', /^(UPDATE board_docs|INSERT INTO board_docs|INSERT OR REPLACE INTO board_docs)/, 0],
  ]) {
    await restore(w.from);
    const { r, hit } = await withOne(pick, press, { nth });
    assert.ok(hit, `${what}: came`);
    const now = (await sql('SELECT data FROM board_docs WHERE id = ?', w.coi.id)).map((x) => JSON.parse(x.data))[0];
    assert.equal(r.status, 503, `${what}: ${r.text}`);
    assert.equal(r.body.error, board.NOTHING_SAVED, what);
    assert.deepEqual([now.version, now.signFrom, now.readFrom], [w.coi.version, w.coi.signFrom, w.coi.readFrom], `${what}: the paper as it was`);
    assert.deepEqual(await counting(w.coi.id), ['alex-rivera', 'kim-park'], `${what}: both signatures still count`);
    assert.equal((await docNamed('Conflict of Interest Policy')).file.name, 'Conflict of Interest.pdf', `${what}: its file as it was`);
    assert.equal((await sql('SELECT id FROM board_doc_versions WHERE doc_id = ? AND version > ?', w.coi.id, w.coi.version).catch(() => sql('SELECT version FROM board_doc_versions WHERE doc_id = ? AND version > ?', w.coi.id, w.coi.version))).length, 0, `${what}: no new wording`);
    assert.equal(await papersWhole(), '', what);
  }
  // The read after it failing: saved, answered with the paper as written
  await restore(w.from);
  const { r, hit } = await withOne(/^SELECT data FROM board_docs$/, press, { nth: 1 });
  assert.ok(hit);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.reread, true, 'the page told to look again');
  assert.equal(r.body.doc.version, w.coi.version + 1);
  assert.equal(r.body.doc.file?.name, COI_2027, 'the answer has the new file');
  assert.deepEqual(Object.keys(r.body.doc.signed), [], 'and nobody counts as signed it yet');
  assert.equal(await papersWhole(), '');
  // Sam signs what his page shows: the new file. The auditor's download has the wording he signed, and the one before
  const sam = (await route(portal, '/api/board-portal', SAM)).body?.docs?.find((d) => d.id === w.coi.id) || r.body.doc;
  await signAs(SAM, 'Sam Ortiz', 'SO', { id: w.coi.id, version: sam.version });
  await looks();
  const zip = await record(w.coi.id);
  const wordings = zip.names.filter((n) => n.startsWith('wordings/')).sort();
  assert.deepEqual(wordings, [`wordings/wording ${w.coi.version} - Conflict of Interest.pdf`, `wordings/wording ${w.coi.version + 1} - ${COI_2027}`], `every wording members signed: ${zip.names.join(', ')}`);
  const csvSam = zip.at('signatures.csv').split('\r\n').find((l) => l.includes('Sam Ortiz'));
  const sha = (await one('SELECT sha256 FROM board_files WHERE id = ?', r.body.doc.file.id)).sha256;
  assert.ok(csvSam.includes(sha), 'Sam’s signature is on the new file’s SHA-256');
});

test('F1: a paper saved with a new file, swept (sign again and not; a new paper with its file; its words read from the new file): every statement failing once and each write lost, the words what happened and the papers whole', async () => {
  const w = await world();
  const cases = [
    ['Conflict of Interest, a new file, sign again', () => saveWithFile(w.coi, { askAgain: true })],
    ['Conflict of Interest, a new file, keep their signatures', () => saveWithFile(w.coi, { askAgain: false })],
    ['a new paper with its file', () => upload(admin, '/api/board-admin', FOUNDER, { saveDoc: JSON.stringify({ doc: { title: 'Gift Acceptance Policy', kind: 'policy' } }), file: pdf('Gift Acceptance.pdf', 'gifts') })],
    ['Board Member Expectations, its words read from a new file', () => upload(admin, '/api/board-admin', FOUNDER, { saveDoc: JSON.stringify({ doc: { ...w.expect, body: '### Expectations\n\n- Come to every meeting' }, askAgain: true, base: w.expect.version, wordsFromNew: true, wordsFrom: 'Expectations 2027' }), file: pdf('Expectations 2027.pdf', 'expect') })],
  ];
  const all = [];
  for (const [name, press] of cases) {
    const out = await sweep(w.from, press, async ({ r, did }) => {
      const words = wordsFor(r, did);
      if (words) return words;
      const whole = await papersWhole();
      if (whole) return whole;
      if (r.status === 200 && !r.body?.doc?.id) return 'saved, with no paper in the answer';
      if (r.status === 200 && name.startsWith('Conflict') && r.body.doc.file?.name !== COI_2027) return `its file in the answer is ${r.body.doc.file?.name}`;
      if (r.status !== 200 && name.startsWith('Conflict') && (await counting(w.coi.id)).length !== 2) return 'not saved, and the signatures stopped counting';
      if (r.status === 200 && name.endsWith('new file') && r.body.doc.wordsFile !== r.body.doc.file?.id) return 'its words’ source isn’t the new file';
      return '';
    });
    try { report(`F1 ${name}`, out, 10); } catch (err) { all.push(String(err.message).split('\n').slice(0, 10).join('\n')); }
  }
  assert.deepEqual(all, [], all.join('\n\n'));
});

// ─── F4: Documents' saves, swept ────────────────────────────────────

test('F4: Documents’ saves without a file swept (2026 Budget retitled; a new paper with words; new words over Alex’s signature, sign again and not): each lands whole or not at all, a read after it failing is 200 with the page told to look again, never “can’t tell”', async () => {
  const w = await world();
  const cases = [
    ['2026 Budget retitled', () => api({ action: 'save-doc', doc: { ...w.budget, title: 'Budget 2026', body: undefined }, base: w.budget.version })],
    ['a new paper with words', () => api({ action: 'save-doc', doc: { title: 'Gift Acceptance Policy', kind: 'policy', body: '### Gifts\n\n- We say thank you' } })],
    ['new words, sign again', () => api({ action: 'save-doc', doc: { ...w.expect, body: '### Expectations\n\n- Come to every meeting' }, base: w.expect.version, askAgain: true })],
    ['new words, keep the signature', () => api({ action: 'save-doc', doc: { ...w.expect, body: '### Expectations\n\n- Come to three of four meetings.' }, base: w.expect.version, askAgain: false })],
  ];
  const all = [];
  for (const [name, press] of cases) {
    const out = await sweep(w.from, press, async ({ r, did }) => wordsFor(r, did) || (await papersWhole()) || (r.status === 200 && !r.body?.doc?.id ? 'saved, with no paper in the answer' : ''));
    try { report(`F4 save-doc: ${name}`, out, 10); } catch (err) { all.push(String(err.message).split('\n').slice(0, 10).join('\n')); }
  }
  assert.deepEqual(all, [], all.join('\n\n'));
});

// ─── F4: deleting a paper, swept ────────────────────────────────────

test('F4: deleting Bylaws (its file and two wordings), swept: it goes whole, its file’s row and bytes and every wording with it, or not at all, said so; never a paper left without its file', async () => {
  const w = await world();
  const press = () => api({ action: 'delete-doc', id: w.bylaws.id });
  const out = await sweep(w.from, press, async ({ r, did }) => {
    const words = wordsFor(r, did);
    if (words) return words;
    const there = !!(await one('SELECT 1 AS x FROM board_docs WHERE id = ?', w.bylaws.id));
    const wordings = (await sql('SELECT version FROM board_doc_versions WHERE doc_id = ?', w.bylaws.id)).length;
    const rows = (await sql("SELECT id FROM board_files WHERE owner_type = 'doc' AND owner_id = ?", w.bylaws.id)).length;
    if (there && (wordings !== 3 || rows !== 1)) return `kept, with ${wordings} wordings and ${rows} files`;
    if (!there && (wordings || rows)) return `deleted, and ${wordings} wordings and ${rows} files left`;
    if (there !== (r.status !== 200)) return `there: ${there}, answered ${r.status}`;
    // (bytes whose delete didn't go are the heartbeat's)
    await quietly(() => board.finishBytesOff(env));
    if (!there && [...files.keys()].some((k) => k.startsWith(`board/doc/${w.bylaws.id}/`))) return 'its bytes stayed';
    return papersWhole();
  });
  report('F4 delete-doc', out, 8);
});

// ─── F3: deleting a paper while a member signs it ───────────────────

test('F3: Jane deletes Whistleblower Policy (nobody has signed it) while Sam signs it, every call a round trip, every interleaving made: exactly one lands, and the other is refused in its words', async () => {
  const w = await world();
  await restore(w.from);
  await page(SAM, { action: 'opened', docId: w.whistle.id });
  const start = saveState();
  const tick = () => new Promise((r) => setImmediate(r));
  const seen = { deleted: 0, signed: 0 };
  const problems = [];
  for (const n of [1, 3, 6]) {
    for (const [first, delay] of [...Array.from({ length: 24 }, (_, i) => ['delete', i * 2]), ...Array.from({ length: 24 }, (_, i) => ['sign', i * 2])]) {
      await restore(start);
      const ev0 = (await sql("SELECT seq FROM board_sign_events WHERE kind IN ('signed', 'consented')")).length;
      slow = n;
      const after = async (fn, wait) => { for (let i = 0; i < wait; i++) await tick(); return fn(); };
      const del = () => api({ action: 'delete-doc', id: w.whistle.id });
      const sign = () => page(SAM, { action: 'sign', docId: w.whistle.id, name: 'Sam Ortiz', mark: MARK('Sam Ortiz', 'SO'), consent: true, version: w.whistle.version, year: YEAR });
      const [d, s] = await Promise.all(first === 'delete' ? [del(), after(sign, delay)] : [after(del, delay), sign()]);
      slow = 0;
      const where = `yield ${n}, ${first} first by ${delay}`;
      const there = !!(await one('SELECT 1 AS x FROM board_docs WHERE id = ?', w.whistle.id));
      const sig = !!(await one('SELECT 1 AS x FROM board_signatures WHERE doc_id = ?', w.whistle.id));
      const events = (await sql("SELECT seq FROM board_sign_events WHERE kind IN ('signed', 'consented')")).length - ev0;
      const marks = await one('SELECT consent_at FROM board_member_marks WHERE slug = ?', 'sam-ortiz');
      if (there) {
        seen.signed += 1;
        if (!sig) problems.push(`${where}: the paper stayed and nothing was signed (${d.status} ${said(d)} / ${s.status} ${said(s)})`);
        if (s.status !== 200) problems.push(`${where}: signed, and the signature answered ${s.status} ${said(s)}`);
        if (d.status !== 409 || !/Sam signed this paper a moment ago, so it can’t be deleted\. Take it off the board page instead\.|The board has signed this paper/.test(said(d))) problems.push(`${where}: kept, and the delete answered ${d.status} “${said(d)}”`);
      } else {
        seen.deleted += 1;
        if (sig || events) problems.push(`${where}: deleted, and a signature (${sig}) or ${events} signing events were kept for it`);
        if (marks?.consent_at) problems.push(`${where}: deleted, and his agreement to sign electronically was kept, resting on it`);
        if (d.status !== 200) problems.push(`${where}: deleted, and the delete answered ${d.status} ${said(d)}`);
        if (s.status === 200 || !/That paper was deleted a moment ago, so there’s nothing to sign\.|That paper isn’t on the board page anymore/.test(said(s))) problems.push(`${where}: the signature answered ${s.status} “${said(s)}”`);
      }
      const chain = await checkChain(env.DB);
      if (!chain.ok) problems.push(`${where}: the chain is broken`);
    }
  }
  console.log(`# F3 race: ${seen.deleted} deleted first, ${seen.signed} signed first`);
  assert.deepEqual(problems, [], `${problems.length} wrong:\n${problems.slice(0, 20).join('\n')}`);
  assert.ok(seen.deleted > 0 && seen.signed > 0, `both orders made (${JSON.stringify(seen)})`);
  assert.ok(problems.length === 0);
});

test('F3: Sam’s signature swept (every statement failing once, each write lost; the delete’s sweep is F4’s): a signature lands with its agreement and its events whole, or not at all, only while the paper is there; the chain checks out', async () => {
  const w = await world();
  await restore(w.from);
  await page(SAM, { action: 'opened', docId: w.whistle.id });
  const start = saveState();
  const sign = () => page(SAM, { action: 'sign', docId: w.whistle.id, name: 'Sam Ortiz', mark: MARK('Sam Ortiz', 'SO'), consent: true, version: w.whistle.version, year: YEAR });
  const out = await sweep(start, sign, async ({ r, did }) => {
    const words = wordsFor(r, did);
    if (words) return words;
    const sig = await one('SELECT how FROM board_signatures WHERE doc_id = ? AND slug = ?', w.whistle.id, 'sam-ortiz');
    const ev = (await sql("SELECT kind FROM board_sign_events WHERE doc_id = ? AND kind IN ('signed', 'consented') AND slug = 'sam-ortiz'", w.whistle.id)).map((x) => x.kind).sort();
    if (!!sig !== (r.status === 200)) return `signed: ${!!sig}, answered ${r.status}`;
    if (sig && ev.join() !== 'consented,signed') return `signed, with events ${ev.join()}`;
    if (!sig && ev.length) return `not signed, with events ${ev.join()}`;
    return (await checkChain(env.DB)).ok ? '' : 'the chain is broken';
  });
  report('F3 sign', out, 10);
});

// ─── F2: a meeting's new place, day or time reaches its invite ──────

/** The heartbeat's invite work a few minutes on, twice (as the tester's clock steps did) */
const beats = async (ms = 3 * MIN) => { for (let i = 0; i < 2; i++) await quietly(() => later(ms, () => invites.maybeRefreshInvites(env, { now: Date.now() }))); };
const eventOf = (m) => google.events[m.invite.eventId];
const pendingOf = (id) => one('SELECT data FROM board_state WHERE key = ?', `invite-pending:${id}`);

test('F2: Jane moves the meeting 9 days ahead to “Example Hall, room 2” (and from 8:00 to 9:30), with the note for its invite, or its read before, failing once: refused with nothing changed, or saved with the change owed by the save itself; the heartbeat takes it to Google', async () => {
  const w = await world();
  const saveWith = (fields) => async () => {
    const m = await quietly(() => board.getMeeting(env.DB, w.ahead.id));
    return api({ action: 'save-meeting', base: m.updatedAt, meeting: { ...m, ...fields } });
  };
  const isPending = (q, p) => (p || []).includes(`invite-pending:${w.ahead.id}`);
  for (const [what, fields, check] of [
    ['the place', { location: 'Example Hall, room 2' }, (e) => /room 2/.test(String(e.location || ''))],
    ['the time', { start: '09:30', end: '11:00' }, (e) => String(e.start?.dateTime || '').includes('T09:30')],
  ]) {
    for (const mode of ['fail', 'lost']) {
      for (let nth = 0; nth < 3; nth++) {
        await restore(w.from);
        const { r, hit } = await withOne(isPending, saveWith(fields), { nth, mode });
        if (!hit) break;
        const where = `${what}, the invite’s note ${mode} (${nth})`;
        const m = await board.getMeeting(env.DB, w.ahead.id);
        const saved = what === 'the place' ? m.location === 'Example Hall, room 2' : m.start === '09:30';
        assert.doesNotMatch(said(r), WRONG, where);
        if (saved) {
          assert.equal(r.status, 200, `${where}: saved, answered ${r.status} ${r.text}`);
          assert.ok(await pendingOf(w.ahead.id), `${where}: saved, and owed to its invite`);
          await beats();
          assert.ok(check(eventOf(w.ahead)), `${where}: on Google’s event after the heartbeat (${JSON.stringify(eventOf(w.ahead)).slice(0, 200)})`);
        } else {
          assert.equal(r.status, 503, `${where}: ${r.text}`);
          assert.match(said(r), NOTHING, where);
          assert.equal(await pendingOf(w.ahead.id), null, `${where}: nothing owed for a save that didn’t land`);
        }
      }
    }
    // The control
    await restore(w.from);
    assert.equal((await saveWith(fields)()).status, 200);
    await beats();
    assert.ok(check(eventOf(w.ahead)), `${what}: the control reaches Google`);
  }
});

test('F2: the save of a new place, and of a new day and time, swept (every statement failing once, each write lost): saved means owed to its invite and on Google after the heartbeat, Google emailing the guests once; not saved means nothing changed, said so', async () => {
  const w = await world();
  const all = [];
  for (const [name, fields, onIt] of [
    ['a new place', { location: 'Example Hall, room 2' }, (m, e) => m.location === 'Example Hall, room 2' && /room 2/.test(String(e.location || ''))],
    ['a new day and time', { date: inDays(10), start: '09:30', end: '11:00' }, (m, e) => m.start === '09:30' && String(e.start?.dateTime || '').startsWith(`${inDays(10)}T09:30`)],
  ]) {
    const press = async () => {
      const m = await quietly(() => board.getMeeting(env.DB, w.ahead.id));
      return api({ action: 'save-meeting', base: m.updatedAt, meeting: { ...m, ...fields } });
    };
    const out = await sweep(w.from, press, async ({ r, did }) => {
      const words = wordsFor(r, did);
      if (words) return words;
      const m = await board.getMeeting(env.DB, w.ahead.id);
      const saved = Object.entries(fields).every(([k, v]) => m[k] === v);
      if (!saved) return onIt({ ...m, ...fields }, eventOf(w.ahead)) ? 'not saved, and Google has it' : '';
      if (!(await pendingOf(w.ahead.id))) return 'saved, and nothing owed to its invite';
      const c0 = google.calls.filter((c) => c.sendUpdates === 'all').length;
      await beats();
      if (!onIt(m, eventOf(w.ahead))) return `saved, and after the heartbeat Google still has ${JSON.stringify([eventOf(w.ahead).location, eventOf(w.ahead).start])}`;
      const emailed = google.calls.filter((c) => c.sendUpdates === 'all').length - c0;
      return emailed === 1 ? '' : `Google emailed the guests ${emailed} times`;
    });
    try { report(`F2 save-meeting (${name})`, out, 15); } catch (err) { all.push(String(err.message).split('\n').slice(0, 10).join('\n')); }
  }
  assert.deepEqual(all, [], all.join('\n\n'));
});

// ─── F4: Delete this meeting, swept ─────────────────────────────────

const BESIDE = ['board_rsvps', 'board_minutes_notes', 'board_minutes_corrections', 'board_minutes_signed'];
async function besideOf(id) {
  const out = {};
  for (const t of BESIDE) out[t] = (await sql(`SELECT 1 AS x FROM ${t} WHERE meeting_id = ?`, id)).length;
  out.files = (await sql("SELECT 1 AS x FROM board_files WHERE owner_type = 'meeting' AND owner_id = ?", id)).length;
  return out;
}

test('F4: Delete this meeting, for one far ahead with no invite and for the one 9 days ahead with its invite out, swept: it goes whole (its files’ rows and bytes, answers, notes, corrections and signed minutes), its invite cancelled once, now or by the heartbeat; or nothing changes and Google is never asked, said so', async () => {
  const w = await world();
  const all = [];
  for (const [name, m] of [['far ahead, no invite', w.far], ['9 days ahead, its invite out', w.ahead]]) {
    const press = () => api({ action: 'delete-meeting', id: m.id });
    const out = await sweep(w.from, press, async ({ r, did }) => {
      const words = wordsFor(r, did);
      if (words) return words;
      const there = !!(await board.getMeeting(env.DB, m.id));
      const beside = await besideOf(m.id);
      if (there) {
        if (Object.values(beside).some((n) => n === 0)) return `kept, with ${JSON.stringify(beside)}`;
        if (m.invite && eventOf(m).status !== 'confirmed') return 'kept, and its invite cancelled';
        return r.status === 503 ? '' : `kept, answered ${r.status}`;
      }
      if (Object.values(beside).some((n) => n > 0)) return `deleted, and left behind: ${JSON.stringify(beside)}`;
      if (r.status !== 200) return `deleted, answered ${r.status}`;
      // (its cancel, owed: the heartbeat sends it; bytes whose delete didn't go are the heartbeat's too)
      await quietly(() => board.finishBytesOff(env));
      if ([...files.keys()].some((k) => k.startsWith(`board/meeting/${m.id}/`))) return 'deleted, and its files’ bytes stayed';
      if (m.invite) {
        if (eventOf(m).status !== 'cancelled' && !r.body?.later) return 'its invite still out, and the answer didn’t say it’s still to go';
        await beats(6 * MIN);
        if (eventOf(m).status !== 'cancelled') return 'deleted, and its invite still on the calendar after the heartbeat';
        if (google.deletes !== 1) return `Google cancelled it ${google.deletes} times`;
        if (await one('SELECT key FROM board_state WHERE key = ?', `invite-cancel:${m.id}`)) return 'cancelled, and still owed';
      }
      return '';
    });
    try { report(`F4 delete-meeting: ${name}`, out, 12); } catch (err) { all.push(String(err.message).split('\n').slice(0, 10).join('\n')); }
  }
  assert.deepEqual(all, [], all.join('\n\n'));
});

test('F4: Delete this meeting with Google refusing the cancel just now: deleted whole, said so, and the heartbeat cancels it once; after a day of refusals the staff hear, once', async () => {
  const w = await world();
  await restore(w.from);
  googleDeleteDown = 1;
  const r = await api({ action: 'delete-meeting', id: w.ahead.id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.cancelled, false);
  assert.match(String(r.body.later || ''), /tries again by itself/);
  assert.equal(await board.getMeeting(env.DB, w.ahead.id), null);
  assert.deepEqual(Object.values(await besideOf(w.ahead.id)), [0, 0, 0, 0, 0]);
  assert.equal(eventOf(w.ahead).status, 'confirmed', 'not yet');
  await beats(6 * MIN);
  assert.equal(eventOf(w.ahead).status, 'cancelled');
  assert.equal(google.deletes, 1, 'once');
  // A day of refusals
  await restore(w.from);
  googleDeleteDown = 1000;
  assert.equal((await api({ action: 'delete-meeting', id: w.ahead.id })).status, 200);
  for (const ms of [6 * MIN, 40 * MIN, 3 * 3600_000, 9 * 3600_000, 16 * 3600_000, 25 * 3600_000, 32 * 3600_000]) await quietly(() => later(ms, () => invites.maybeRefreshInvites(env, { now: Date.now() })));
  const owed = JSON.parse((await one('SELECT data FROM board_state WHERE key = ?', `invite-cancel:${w.ahead.id}`)).data);
  assert.equal(owed.told, true, 'the staff told, after a day');
  googleDeleteDown = 0;
  await quietly(() => later(40 * 3600_000, () => invites.maybeRefreshInvites(env, { now: Date.now() })));
  assert.equal(eventOf(w.ahead).status, 'cancelled', 'it goes once Google answers');
  assert.equal(await one('SELECT key FROM board_state WHERE key = ?', `invite-cancel:${w.ahead.id}`), null);
});

test('F4: a press whose one write landed and whose read after it failed is told so by the routes’ default: 200, the page told to look again, never “can’t tell”', async () => {
  const w = await world();
  await restore(w.from);
  // (the read after the save, as a program might have left it to the default)
  const out = await board.watchPress(env, async (e) => {
    try {
      await board.deleteMeeting(e, w.far.id);
      throw LOST();
    } catch (err) { return board.errorAnswer(err, { press: true }); }
  });
  assert.equal(out.status, 200);
  const body = await out.json();
  assert.deepEqual([body.ok, body.reread], [true, true]);
  assert.doesNotMatch(String(body.later || ''), UNSURE);
});
