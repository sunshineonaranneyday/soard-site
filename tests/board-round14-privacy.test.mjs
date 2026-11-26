/**
 * Board QA round 14 (Nov 24 2026), the privacy tester's findings:
 *   F1  a press answers from what it read before its write and from the write itself, never a read after it: Settings
 *       (the quorum, the agenda template), a check-in and a vote in a live meeting, the operating balance. A read that
 *       fails after the write never says "nothing was changed"; the template's own save, its answer lost and pressed
 *       again over the same base, is that save, never "saved the agenda template since you opened it" under their name
 *   F2  every decision of a correction (make it, keep the minutes as they are) lands through the same lost-answer look
 *   F3  a database failure is said in words by every press of the board page and Board (the routes' default, so none
 *       can be left out): 503 "…so nothing was changed / signed / sent" when nothing was, never "Something went wrong";
 *       a write that landed with its answer lost answers as written. Every action each route takes is walked
 *   F4  an owed notice goes only while what it's about still stands: a correction taken back or decided, a decline
 *       whose paper has been signed since, is closed with nothing sent
 *   F5  a press's own claim (a correction being decided, the secretary's notes being sent, Email all's) carries a token
 *       the press made: written with its answer lost, the press finds its token and carries on
 * Each press is swept: every statement it makes failing once in turn (after a clean control), and each write landing
 * with its answer lost, the words judged against what the database and the fakes show happened. Made-up people only
 * (the repo is public). Run: node --test tests/board-round14-privacy.test.mjs
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
import * as board from '../functions/api/_board.js';
import { maybeRunSigning } from '../functions/api/_board-sign.js';
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
const MIN = 60_000;
const DAY = 86_400_000;
const YEAR = Number(todayEastern().slice(0, 4));
/** The words a press says when nothing of it landed: round 12's, a press's own, People's, the sign-in's and the setup's */
const NOTHING = /nothing was (changed|sent|signed)|couldn’t check (your sign-in|People)|couldn’t open the board’s records|couldn’t approve the agenda|Nothing went out|so nothing|wasn’t kept/i;
const WRONG = /Something went wrong|Reload the page to see what was saved/i;
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

// ─── The database not answering one statement, or answering it and losing the answer ───
// Every statement a press makes is counted (one in a batch too, which then fails whole, as D1's does), and the k-th
// fails once: before it runs (`fail`), or after the database took it (`lost`: the connection dropped on its answer).
// `only`: a pattern a statement has to match to be counted (the lost sweep counts writes). Board's own table setup
// (CREATE, ALTER, PRAGMA) is left out, as the tester's sweep has it
let raw;
let fault = null; // { k, seen, failed, mode, only }
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
let mail; // every email Resend took: { to, subject, kind, key, text }
let gmail; // every Gmail send: { raw }
let google; // the board's calendar: { events, calls }
let resendKeys;
let resendDown = 0; // Resend answering 502 this many times
const realFetch = globalThis.fetch;
beforeEach(async () => {
  fault = null;
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
  gmail = [];
  google = { events: {}, calls: 0 };
  resendKeys = new Map();
  resendDown = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.startsWith('https://api.resend.com/')) {
      if (resendDown > 0) { resendDown -= 1; return new Response('Bad gateway', { status: 502 }); }
      const key = init.headers?.['Idempotency-Key'] || '';
      if (key && resendKeys.has(key)) { const had = resendKeys.get(key); return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }); }
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), subject: e.subject, kind: (e.tags || []).find((t) => t.name === 'kind')?.value || '', key, text: e.text || '' });
      const res = Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` };
      if (key) resendKeys.set(key, { body: init.body, res });
      return Response.json(res);
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/')) {
      const path = url.slice('https://gmail.googleapis.com/gmail/v1/users/me/'.length);
      if (path === 'messages/send') {
        gmail.push(JSON.parse(init.body));
        return Response.json({ id: `gm_${gmail.length}`, threadId: `th_${gmail.length}` });
      }
      if (path.startsWith('messages?')) return Response.json({ messages: [] });
      if (path.startsWith('messages/')) return Response.json({ id: path.split(/[/?]/)[1], payload: { headers: [{ name: 'Message-ID', value: `<${path.split(/[/?]/)[1]}@mail.example>` }] } });
      return Response.json({});
    }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      const u = new URL(url);
      if (method !== 'GET') google.calls += 1;
      if (method === 'GET' && u.pathname.endsWith('/events')) return Response.json({ items: [] });
      const id = decodeURIComponent(u.pathname.split('/').pop());
      if (method === 'POST') {
        const e = { ...body, status: 'confirmed', hangoutLink: 'https://meet.google.com/abc-defg-hij', attendees: (body?.attendees || []).map((a) => ({ ...a, responseStatus: 'needsAction' })) };
        google.events[e.id] = e;
        return Response.json(e);
      }
      const e = google.events[id];
      if (!e) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
      if (method === 'DELETE') { delete google.events[id]; return new Response(null, { status: 204 }); }
      if (method === 'PATCH' || method === 'PUT') Object.assign(e, body);
      return Response.json(e);
    }
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; });

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
  const text = await res.text();
  const was = fault;
  fault = null;
  await Promise.allSettled(own);
  fault = was;
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
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
/** The signing look, as the heartbeat runs it, a few times */
const looks = async (n = 3) => { for (let i = 0; i < n; i++) await maybeRunSigning(env); };

const saveState = () => ({ bytes: raw._db.export(), mail: [...mail], gmail: [...gmail], files: new Map(files), keys: new Map(resendKeys), google: structuredClone(google) });
async function restore(s) {
  raw = await createD1({ bytes: s.bytes });
  mail = [...s.mail];
  gmail = [...s.gmail];
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  resendKeys = new Map(s.keys);
  google = structuredClone(s.google);
  resendDown = 0;
}
async function later(ms, fn) {
  const back = holdClockAt(Date.now() + ms);
  try { return await fn(); } finally { back(); }
}

// ─── The world: papers to sign, a meeting ahead under the chair's review, one held today with a vote open and the
// secretary's notes, one held a month ago with draft minutes and a correction waiting, and approved minutes to sign ───

const MARK = { type: 'typed', text: 'Sam Ortiz', style: 0, initials: 'SO' };
const roll = (status = 'present') => EMAILS.map(([slug]) => ({ slug, key: slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board', status }));
async function world() {
  const docs = [];
  for (const title of ['Board Member Expectations', 'Conflict of Interest Policy']) docs.push(await board.saveDoc(env.DB, { title, kind: 'policy', sign: true, body: `### ${title}\n\n- Come to three of four meetings` }, { by: FOUNDER }));
  await raw.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(JSON.stringify({ sentAt: new Date().toISOString() }), new Date().toISOString()).run();
  assert.equal((await api({ action: 'save-settings', settings: { asks: 'on' } })).status, 200);
  const made = (await api({ action: 'new-meeting', date: inDays(5) })).body.meeting;
  const sections = made.sections.map((s, k) => ({ ...s, items: s.items.map((i, j) => (k === 0 && j === 0 ? { ...i, title: 'Welcome and the year so far', who: ['sam-ortiz'], presenter: 'Sam Ortiz' } : i)) }));
  const ahead = (await api({ action: 'save-meeting', base: made.updatedAt, meeting: { ...made, sections } })).body.meeting;
  const item = ahead.sections[0].items[0];
  // (Sam's own file on his item, to take off again)
  const att = await upload(portal, `/api/board-portal?attach=${ahead.id}&item=${item.id}`, SAM, { file: pdf('Budget notes.pdf'), fileId: 'f_qasam0001' });
  assert.equal(att.status, 200, att.text);
  // (a meeting held a month ago, its minutes in and shared, draft: corrections go on it; Sam's to-do on it)
  const held = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-30), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() }, attendance: roll(), actions: [{ id: 'a_r14todo', text: 'Send the budget', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: inDays(3) }], sections: [{ title: 'New business', items: [{ title: 'Budget', notes: 'The budget passed.' }] }] }), { by: 'test' });
  const fd = new FormData();
  // (its minutes as a file on it, for the secretary's own file of the minutes to go over)
  await upload(admin, '/api/board-admin', FOUNDER, { ownerType: 'meeting', ownerId: held.id, kind: 'minutes', file: pdf('Minutes draft.pdf', 'minutes') });
  void fd;
  // (approved minutes, shared, the secretary to sign them)
  const approved = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-10), start: '08:00', end: '10:00', shared: true, minutes: 'approved', approvedOn: todayEastern(), minutesFrom: { typed: true, name: 'Typed', at: new Date().toISOString() }, attendance: roll(), sections: [{ title: 'New business', items: [{ title: 'Budget', notes: 'The budget passed.' }] }] }), { by: 'test' });
  // A meeting held yesterday and still going (live, a vote open: the chair's review is for the one ahead), Kim and Alex
  // checked in, and the secretary's notes typed beside it
  const today = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-1), start: '08:00', end: '10:00', shared: true, attendance: roll(''), motions: [{ id: 'mo_r14', text: 'Approve the budget', by: 'Alex Rivera', second: 'Sam Ortiz', result: '' }], sections: [{ title: 'Opening', items: [{ title: 'Welcome' }] }] }), { by: 'test' });
  await raw.prepare("UPDATE board_meetings SET data = json_set(data, '$.live', json(?)) WHERE id = ?").bind(JSON.stringify({ startedAt: new Date(Date.now() - 10 * MIN).toISOString(), vote: { motionId: 'mo_r14', openedAt: new Date(Date.now() - MIN).toISOString() } }), today.id).run();
  assert.equal((await page(KIM, { action: 'checkin', meetingId: today.id, how: 'present' })).status, 200);
  assert.equal((await page(ALEX, { action: 'checkin', meetingId: today.id, how: 'present' })).status, 200);
  assert.equal((await page(TAYLOR, { action: 'notes-save', meetingId: today.id, changes: { 'r:alex-rivera': 'present' }, was: {}, wasText: {} })).status, 200);
  // Sam's correction waiting on the held meeting's minutes (Kim's mark), its email gone
  const c = await page(SAM, { action: 'correction', meetingId: held.id, target: 'r:kim-park', words: 'absent' });
  assert.equal(c.status, 200, c.text);
  await looks();
  // A meeting held two months ago with no minutes yet: the secretary sends hers as a Word file
  const plain = await board.saveMeeting(env.DB, cleanMeeting({ date: inDays(-60), start: '08:00', end: '10:00', shared: true, attendance: roll(''), sections: [{ title: 'Committee reports', items: [{ title: 'Financial' }] }] }), { by: 'test' });
  return { docs, ahead, item, held, approved, plain, minutes: await minutesWord(plain), today: await board.getMeeting(env.DB, today.id), cid: c.body.correction.id, attId: att.body.file.id, from: saveState() };
}

/** The minutes template for a meeting, as the secretary fills it in: Alex and Sam there, a note under its first item */
async function minutesWord(m) {
  const { minutesDocx, zip } = await import('../public/admin/board-minutes-template.js');
  const { unzip } = await import('../public/admin/board-shared.js');
  let doc = new TextDecoder().decode((await unzip(minutesDocx(m), ['word/document.xml']))['word/document.xml']);
  for (const name of ['Alex Rivera', 'Sam Ortiz']) doc = doc.replace(new RegExp(`(<w:tr>(?:(?!</w:tr>)[\\s\\S])*?<w:jc w:val="center"/></w:pPr>)(</w:p>(?:(?!</w:tr>)[\\s\\S])*?>${name}<)`), '$1<w:r><w:t>x</w:t></w:r>$2');
  doc = doc.replace(/(<w:pStyle w:val="Note"\/>(?:(?!<\/w:p>)[\s\S])*?<\/w:pPr>)(<\/w:p>)/, '$1<w:r><w:t>Reserves grew this quarter.</w:t></w:r>$2');
  const all = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml'];
  const parts = await unzip(minutesDocx(m), all);
  return zip(all.map((n) => [n, n === 'word/document.xml' ? doc : new TextDecoder().decode(parts[n])]));
}
const word = (bytes, name = 'Minutes final.docx') => new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

// ─── What a press changed, judged against what it said ──────────────
// Every table but those a press touches without anything a person did changing (its rate limit, a visit, the audit
// log, the save history), and a claim held while a press works (the notes' `sending`, a correction being made, Email
// all's before it went, a notice's while it goes): what a press changed is what's left of it after it answers

const CACHES = /^(cash|cash-now|numbers|projects|finance|books|gifts|costs|runs|makeover-costs|calendar|access|access-runs|mail|board-mail|asks|asks-once|attendance-runs|group:|board-group|reveals|events|live-)/;
const NOISE = /^(rate_limits|board_seen|board_signins|board_activity|board_activity_reports|audit_log|board_saves|board_ask_mail|sqlite_sequence)$/;
async function snapshot() {
  const tables = (await sql("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((t) => t.name).filter((t) => !NOISE.test(t));
  const out = {};
  for (const t of tables) {
    let rows = await sql(`SELECT * FROM ${t}`);
    if (t === 'board_minutes_notes') rows = rows.map(({ sending, ...r }) => r);
    if (t === 'board_minutes_corrections') rows = rows.map((r) => ({ ...(r.state === 'making' ? { ...r, state: 'waiting', decided_at: null } : r), claim: null }));
    if (t === 'board_state') {
      // (and what the site keeps of what it read elsewhere, and how its looks went: the numbers, the calendar, Access)
      rows = rows.filter((r) => !CACHES.test(r.key))
        .filter((r) => !/^(email-all:|welcome-sending|board-send-claim|rate:)/.test(r.key) || (r.key.startsWith('email-all:') && /"sentAt"/.test(r.data)))
        .map((r) => (r.key.startsWith('notice-due:') ? { ...r, data: JSON.stringify({ ...JSON.parse(r.data), sending: undefined }), updated_at: '' } : r));
    }
    out[t] = JSON.stringify(rows.map((r) => JSON.stringify(r)).sort());
  }
  out.files = JSON.stringify([...files.keys()].sort());
  out.sent = `${mail.length}:${gmail.length}:${google.calls}`;
  return out;
}
const changedIn = (a, b) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);

/**
 * A press swept: the control (k = -1), then every statement failing once in turn, then each write landing with its
 * answer lost. `judge({ r, k, mode, failed, did })` → '' or what's wrong. → { problems, runs }
 */
async function sweep(from, press, judge, { modes = ['fail', 'lost'], max = 400, prep = null } = {}) {
  const problems = [];
  let runs = 0;
  for (const mode of modes) {
    for (let k = mode === 'fail' ? -1 : 0; k < max; k++) {
      await restore(from);
      const ctx = prep ? await prep() : {};
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
      if (why) problems.push(`${mode} k=${k} [${failed.replace(/\s+/g, ' ').slice(0, 90) || 'control'}] → ${r.status} ${JSON.stringify(r.body || {}).slice(0, 220)}${did.length ? ` (changed ${did.join(',')})` : ''}: ${why}`);
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
 * The words judged against what happened. Done (anything changed, an email or an invite went): 200, in words that don't
 * say otherwise. Not done: refused in words that say so (a 4xx of its own, or a 503 "…nothing was changed / sent /
 * signed"), or (`quiet`: a press whose control changes nothing, a look) answered as its control was. Never "Something
 * went wrong … Reload the page"
 */
function wordsFor(r, did, { quiet = false, control = 200 } = {}) {
  const words = said(r);
  if (WRONG.test(words) || r.status === 500) return `said ${r.status} “${words}”`;
  if (r.status === 'threw') return `threw ${words}`;
  if (did.length) return r.status === control && !NOTHING.test(words) ? '' : `it landed, and it answered ${r.status} “${words}”`;
  if (quiet && r.status === control) return '';
  if (typeof r.status !== 'number' || r.status < 400) return `nothing landed, and it answered ${r.status} “${words}”`;
  return NOTHING.test(words) ? '' : `nothing landed, and it said ${r.status} “${words}”`;
}
/** A press's sweep with the generic judge (its control first, to say what it changes) */
async function pressSweep(name, from, press, { prep = null, quiet = null, control = 200, extra = null, min = 3, modes } = {}) {
  await restore(from);
  const ctx = prep ? await prep() : {};
  const s0 = await snapshot();
  const c = await press(ctx);
  assert.equal(c.status, control, `${name}: the control: ${c.status} ${c.text?.slice(0, 300)}`);
  const changes = changedIn(s0, await snapshot());
  const look = quiet ?? !changes.length;
  const out = await sweep(from, press, async (x) => wordsFor(x.r, x.did, { quiet: look, control }) || (extra ? await extra(x) : ''), { prep, modes });
  report(name, out, min);
  return out;
}

// ─── F3: every action each route takes, walked ──────────────────────

/** The actions a route's press handler takes, read from its own source: JSON actions, and its file presses */
function actionsOf(file, from, to = null) {
  const src = readFileSync(new URL(`../functions/api/${file}`, import.meta.url), 'utf8');
  const body = src.slice(src.indexOf(from), to ? src.indexOf(to, src.indexOf(from)) : undefined);
  const out = new Set();
  for (const m of body.matchAll(/body\.action === '([a-z-]+)'/g)) out.add(m[1]);
  for (const m of body.matchAll(/case '([a-z-]+)':/g)) out.add(m[1]);
  for (const m of body.matchAll(/(?:searchParams\.get|q\.has)\('([a-z]+)'\)/g)) if (!['anyway', 'item'].includes(m[1])) out.add(`?${m[1]}`);
  for (const m of body.matchAll(/form\.get\('(signFor|saveDoc)'\)/g)) out.add(`form:${m[1]}`);
  if (/ownerType'\) \|\| ''\) !== 'meeting'/.test(body)) out.add('form:upload');
  return [...out].sort();
}
const PORTAL_ACTIONS = () => actionsOf('board-portal.js', 'export async function onRequestPost', null);
const ADMIN_ACTIONS = () => actionsOf('board-admin.js', 'export async function onRequestPost', null);

/** Every press of the board page, by the action it is: who presses it, and how */
const PORTAL = {
  activity: { press: (w) => page(SAM, { action: 'activity', events: [{ kind: 'view', page: 'home', at: new Date().toISOString(), ms: 4000 }], touch: false, now: Date.now() }), quiet: true },
  rsvp: { press: () => page(SAM, { action: 'rsvp', meetingId: 'm_x', answer: 'yes' }), control: 410, quiet: true },
  'action-done': { press: () => page(SAM, { action: 'action-done', actionId: 'a_r14todo', done: true }) },
  'action-done (a founder’s own)': { press: () => page(FOUNDER, { action: 'action-done', actionId: 'a_r14todo', done: true }) },
  correction: { press: (w) => page(KIM, { action: 'correction', meetingId: w.held.id, target: 'r:sam-ortiz', words: 'remote' }) },
  'correction-withdraw': { press: (w) => page(SAM, { action: 'correction-withdraw', id: w.cid }) },
  'correction-decide': { press: (w) => page(TAYLOR, { action: 'correction-decide', id: w.cid, make: false, reason: 'Kim joined late' }) },
  'correction-decide (make it)': { press: (w) => page(TAYLOR, { action: 'correction-decide', id: w.cid, make: true }) },
  'sign-minutes': { press: (w) => page(TAYLOR, { action: 'sign-minutes', meetingId: w.approved.id, mark: { type: 'typed', text: 'Taylor Nguyen', style: 0, initials: 'TN' }, consent: true }) },
  sign: { press: (w) => page(SAM, { action: 'sign', docId: w.docs[0].id, name: 'Sam Ortiz', mark: MARK, consent: true, version: w.docs[0].version, year: YEAR }) },
  opened: { press: (w) => page(SAM, { action: 'opened', docId: w.docs[1].id }) },
  decline: { press: (w) => page(SAM, { action: 'decline', docId: w.docs[1].id, reason: 'I need to read it with my lawyer first', year: YEAR }) },
  '?signed': { press: (w) => upload(portal, `/api/board-portal?signed=${w.docs[0].id}`, SAM, { file: pdf('Expectations signed.pdf'), version: String(w.docs[0].version) }) },
  checkin: { press: (w) => page(SAM, { action: 'checkin', meetingId: w.today.id, how: 'remote' }) },
  vote: { press: (w) => page(KIM, { action: 'vote', meetingId: w.today.id, motionId: 'mo_r14', vote: 'for' }) },
  report: { press: (w) => page(SAM, { action: 'report', meetingId: w.ahead.id, itemId: w.item.id, text: 'Cash is fine.', base: null }) },
  '?attach': { press: (w) => upload(portal, `/api/board-portal?attach=${w.ahead.id}&item=${w.item.id}`, SAM, { file: pdf('Cash forecast.pdf'), fileId: 'f_qasam0002' }) },
  detach: { press: (w) => page(SAM, { action: 'detach', meetingId: w.ahead.id, itemId: w.item.id, fileId: w.attId }) },
  motion: { press: (w) => page(SAM, { action: 'motion', meetingId: w.ahead.id, itemId: w.item.id, text: 'Move to approve the budget', base: '' }) },
  'line-note': { press: (w) => page(SAM, { action: 'line-note', meetingId: w.ahead.id, itemId: w.item.id, key: 'bud|Total Income', line: 'Total Income', text: 'Up 4% on last year' }) },
  'operating-balance': { press: () => page(FOUNDER, { action: 'operating-balance', amount: 123456 }) },
  'chair-approve': { press: (w) => page(ALEX, { action: 'chair-approve', meetingId: w.ahead.id }) },
  'chair-note': { press: (w) => page(ALEX, { action: 'chair-note', meetingId: w.ahead.id, itemId: w.item.id, text: 'Keep it short.' }) },
  'ask-presenter': { press: (w) => page(ALEX, { action: 'ask-presenter', meetingId: w.ahead.id, itemId: w.item.id, question: 'What changed since June?' }) },
  '?minutes': { press: (w) => upload(portal, `/api/board-portal?minutes=${w.plain.id}`, TAYLOR, { file: word(w.minutes) }) },
  'notes-save': { press: (w) => page(TAYLOR, { action: 'notes-save', meetingId: w.today.id, changes: { 'r:sam-ortiz': 'remote' }, was: {}, wasText: {} }) },
  'notes-send': { press: (w) => page(TAYLOR, { action: 'notes-send', meetingId: w.today.id }) },
  'slide-order': { press: (w) => page(SAM, { action: 'slide-order', meetingId: w.ahead.id, itemId: w.item.id, order: ['report'] }) },
  'report-shorter': { press: (w) => page(SAM, { action: 'report-shorter', meetingId: w.ahead.id, itemId: w.item.id, text: 'Cash is fine. '.repeat(40), title: 'Welcome' }), quiet: true, any: true },
};

test('F3: every action the board page’s route takes has its press here, and every one says the database failing in words, never “Something went wrong”', async () => {
  const have = new Set(Object.keys(PORTAL).map((k) => k.replace(/ \(.*\)$/, '')));
  assert.deepEqual(PORTAL_ACTIONS().filter((a) => !have.has(a.replace(/^\?/, '?'))), [], 'an action with no press in this walk');
  const w = await world();
  const all = [];
  for (const [name, p] of Object.entries(PORTAL)) {
    try {
      await pressSweep(`board page: ${name}`, w.from, () => p.press(w), { quiet: p.quiet ?? null, control: p.control ?? 200, min: 1 });
    } catch (err) { all.push(String(err.message).split('\n').slice(0, 12).join('\n')); }
  }
  assert.deepEqual(all, [], `${all.length} presses wrong:\n${all.join('\n\n')}`);
});

/**
 * Board's world for its presses: the board page's, and states a press needs before it (the agenda approved, an invite
 * out, a signature to take off, minutes read in to undo, a practice meeting, a Word file on a meeting)
 */
async function adminWorld() {
  const w = await world();
  await restore(w.from);
  const put = await upload(admin, '/api/board-admin', FOUNDER, { ownerType: 'meeting', ownerId: w.plain.id, kind: 'other', file: word(w.minutes, 'Minutes typed.docx') });
  assert.equal(put.status, 200, put.text);
  const base = saveState();
  const step = async (what) => { await restore(base); assert.equal((await what()).status, 200, String(what)); return saveState(); };
  const approved = await step(() => api({ action: 'approve-agenda', id: w.ahead.id }));
  await restore(approved);
  assert.equal((await api({ action: 'send-invite', id: w.ahead.id })).status, 200);
  const invited = saveState();
  const signed = await step(() => page(SAM, { action: 'sign', docId: w.docs[0].id, name: 'Sam Ortiz', mark: MARK, consent: true, version: w.docs[0].version, year: YEAR }));
  const read = await step(() => api({ action: 'read-minutes', id: w.plain.id, fileId: put.body.file.id }));
  await restore(base);
  const p = await api({ action: 'practice' });
  assert.equal(p.status, 200, p.text);
  const practice = saveState();
  return { ...w, fileId: put.body.file.id, practiceId: p.body.meeting.id, from: base, approved, invited, signed, read, practice };
}
/** Every press of Board, by the action it is: `from` the state it starts from (the world's own when none) */
const ADMIN = {
  'new-meeting': { press: () => api({ action: 'new-meeting', date: inDays(40) }) },
  'import-meeting': { press: () => api({ action: 'import-meeting', meeting: { date: inDays(-400), start: '08:00', end: '10:00', sections: [{ title: 'Old business', items: [{ title: 'The gala' }] }] } }) },
  'save-meeting': { prep: (w) => board.getMeeting(env.DB, w.ahead.id), press: (w, m) => api({ action: 'save-meeting', base: m.updatedAt, meeting: { ...m, location: 'Example Hall, room 2' } }) },
  'delete-meeting': { press: (w) => api({ action: 'delete-meeting', id: w.plain.id }) },
  'keep-agenda': { press: (w) => api({ action: 'keep-agenda', id: w.ahead.id }) },
  snapshot: { press: (w) => api({ action: 'snapshot', id: w.ahead.id }) },
  'approve-agenda': { press: (w) => api({ action: 'approve-agenda', id: w.ahead.id }) },
  'send-packet': { from: 'approved', prep: (w) => board.getMeeting(env.DB, w.ahead.id), press: (w, m) => later(11 * MIN, () => api({ action: 'send-packet', id: w.ahead.id, seen: m.packetSentAt })) },
  'action-done': { press: () => api({ action: 'action-done', actionId: 'a_r14todo', done: true }) },
  'action-remind-preview': { press: () => api({ action: 'action-remind-preview' }) },
  'save-doc': { press: () => api({ action: 'save-doc', doc: { title: 'Travel Policy', kind: 'policy', body: '### Travel\n\n- Book coach' } }) },
  'delete-doc': { press: (w) => api({ action: 'delete-doc', id: w.docs[1].id }) },
  'doc-versions': { press: (w) => api({ action: 'doc-versions', id: w.docs[0].id }), quiet: true },
  unsign: { from: 'signed', press: (w) => api({ action: 'unsign', docId: w.docs[0].id, slug: 'sam-ortiz', reason: 'Filed under the wrong year' }) },
  'update-file': { press: (w) => api({ action: 'update-file', id: w.attId, kind: 'report', name: 'Budget notes (v2).pdf' }) },
  'delete-file': { press: (w) => api({ action: 'delete-file', id: w.attId }) },
  'save-settings': { press: () => api({ action: 'save-settings', settings: { quorum: 3 } }) },
  'save-settings (the template)': { prep: async () => (await getSettingsNow()), press: (w, s) => api({ action: 'save-settings', settings: { template: s.template.map((x, i) => (i === 0 ? { ...x, title: 'Opening (renamed)' } : x)) }, base: s.templateAt }) },
  'read-file': { press: (w) => api({ action: 'read-file', id: w.fileId }), quiet: true },
  'read-minutes': { press: (w) => api({ action: 'read-minutes', id: w.plain.id, fileId: w.fileId }) },
  'undo-minutes': { from: 'read', press: (w) => api({ action: 'undo-minutes', id: w.plain.id, fileId: w.fileId }) },
  'send-invite': { from: 'approved', press: (w) => api({ action: 'send-invite', id: w.ahead.id }) },
  'approve-minutes': { press: (w) => api({ action: 'approve-minutes', id: w.held.id, on: todayEastern() }) },
  'remind-rsvp': { from: 'invited', press: (w) => api({ action: 'remind-rsvp', id: w.ahead.id }) },
  'send-minutes': { press: (w) => api({ action: 'send-minutes', id: w.held.id }) },
  'ask-to-sign': { press: () => api({ action: 'ask-to-sign' }) },
  'email-all': { press: () => api({ action: 'email-all', subject: 'Budget question', message: 'Please read the budget before Thursday.' }) },
  'send-welcome': { press: () => api({ action: 'send-welcome', slugs: ['kim-park'], again: true }) },
  practice: { press: () => api({ action: 'practice' }) },
  'practice-reset': { from: 'practice', press: (w) => api({ action: 'practice-reset', id: w.practiceId }) },
  'sync-access': { press: () => api({ action: 'sync-access' }), quiet: true },
  'report-shorter': { press: (w) => api({ action: 'report-shorter', id: w.ahead.id, itemId: w.item.id, text: 'Cash is fine. '.repeat(40), title: 'Welcome' }), quiet: true },
  'sync-group': { press: () => api({ action: 'sync-group' }), quiet: true },
  'form:signFor': { press: (w) => upload(admin, '/api/board-admin', FOUNDER, { signFor: w.docs[0].id, slug: 'kim-park', file: pdf('Expectations - Kim Park.pdf') }) },
  'form:saveDoc': { press: () => upload(admin, '/api/board-admin', FOUNDER, { saveDoc: JSON.stringify({ doc: { title: 'Bylaws', kind: 'bylaws' } }), file: pdf('Bylaws.pdf', 'bylaws') }) },
  'form:upload': { press: (w) => upload(admin, '/api/board-admin', FOUNDER, { ownerType: 'meeting', ownerId: w.ahead.id, kind: 'other', file: pdf('Cash forecast.pdf', 'forecast'), fileId: 'f_qajane0001' }) },
};
const getSettingsNow = async () => { const was = fault; fault = null; try { return await board.getSettings(env.DB); } finally { fault = was; } };
/**
 * Board's presses still made of several writes, each a step of its own (Board admin's, beyond round 14's findings: what's
 * left of them is to land whole, one batch, as the rules ask). Until then the routes' default answers their failures
 * honestly: never "Something went wrong", never "nothing was changed" over a change; where the exact answer would need
 * that one write, it says the site can't tell yet (UNSURE_SAVED). Each with why
 */
const NOT_WHOLE_YET = {
  'save-doc': 'a paper’s wording and the paper are two writes (saveDoc)',
  'delete-doc': 'its signatures, wordings, files and the paper are taken off one by one (deleteDoc)',
  'form:saveDoc': 'a paper, its file, its wording’s file and its words are four steps',
  'delete-meeting': 'the invite comes off Google first, then the meeting and what’s kept beside it, one by one',
  'practice-reset': 'the old practice meeting is cleared, then a new one made',
  'undo-minutes': 'a read put back, its file and the last meeting’s approval are steps of their own',
  'sync-group': 'its only writes are the sync’s own status record, kept after Google answers',
  // (its emails went, and its record didn't: a 500 that says so in words, how many went and that nobody gets it again,
  // round 11's decided answer for Ask to sign)
  'ask-to-sign': 'its emails went and their record didn’t: said in words (round 11)',
};
/** The default's honesty, for NOT_WHOLE_YET: never Something went wrong, never "nothing" over a change */
function honest(r, did, name) {
  const words = said(r);
  if (WRONG.test(words)) return `said ${r.status} “${words}”`;
  if (r.status === 500 && !(name === 'ask-to-sign' && /went to/.test(words))) return `said 500 “${words}”`;
  if (did.length && NOTHING.test(words)) return `it landed, and it answered ${r.status} “${words}”`;
  if (did.length && r.status !== 200 && !/can’t tell yet|went to/.test(words)) return `it landed, and it answered ${r.status} “${words}”`;
  if (!did.length && r.status === 200) return 'answered 200 with nothing done';
  if (!did.length && r.status >= 400 && !NOTHING.test(words) && !/can’t tell yet/.test(words)) return `nothing landed, and it said ${r.status} “${words}”`;
  return '';
}

test('F3: every action Board’s route takes has its press here, and every one says the database failing in words, never “Something went wrong”', async () => {
  const have = new Set(Object.keys(ADMIN).map((k) => k.replace(/ \(.*\)$/, '')));
  assert.deepEqual(ADMIN_ACTIONS().filter((a) => !have.has(a)), [], 'an action with no press in this walk');
  const w = await adminWorld();
  const all = [];
  for (const [name, p] of Object.entries(ADMIN)) {
    try {
      const prep = p.prep ? async () => { const was = fault; fault = null; try { return await p.prep(w); } finally { fault = was; } } : null;
      const base = name.replace(/ \(.*\)$/, '');
      if (NOT_WHOLE_YET[base]) {
        await restore(w[p.from || 'from']);
        const out = await sweep(w[p.from || 'from'], (ctx) => p.press(w, ctx), async ({ r, did }) => honest(r, did, base), { prep });
        report(`Board: ${name} (not whole yet: ${NOT_WHOLE_YET[base]})`, out, 1);
      } else {
        await pressSweep(`Board: ${name}`, w[p.from || 'from'], (ctx) => p.press(w, ctx), { prep, quiet: p.quiet ?? null, control: p.control ?? 200, min: 1 });
      }
    } catch (err) { all.push(String(err.message).split('\n').slice(0, 12).join('\n')); }
  }
  assert.deepEqual(all, [], `${all.length} presses wrong:\n${all.join('\n\n')}`);
});

// ─── One statement, picked by its words ─────────────────────────────

/**
 * `press` with the `nth` statement matching `re` failing once (`mode` 'fail'), or landing with its answer lost ('lost').
 * → { r, hit } (hit: whether that statement came)
 */
async function withOne(re, press, { nth = 0, mode = 'fail' } = {}) {
  let n = 0;
  let hitIt = false;
  const was = raw;
  const pick = (q) => { if (!re.test(String(q || ''))) return false; if (n++ !== nth) return false; hitIt = true; return true; };
  const wrapOne = (st, q) => new Proxy(st, {
    get: (o, m) => (['run', 'first', 'all'].includes(m) ? async (...a) => { if (!pick(q)) return o[m](...a); if (mode === 'lost') await o[m](...a); throw LOST(); }
      : m === 'bind' ? (...a) => wrapOne(o.bind(...a), q) : typeof o[m] === 'function' ? o[m].bind(o) : o[m]),
  });
  raw = new Proxy(was, {
    get: (s, m) => (m === 'prepare' ? (q) => wrapOne(s.prepare(q), q)
      : m === 'batch' ? async (stmts) => { const p = stmts.some((x) => pick(x._sql)); if (p && mode !== 'lost') throw LOST(); const r = await s.batch(stmts); if (p) throw LOST(); return r; }
        : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
  });
  try { return { r: await press(), hit: hitIt }; } finally { raw = was; }
}
const settingsNow = async () => JSON.parse((await one("SELECT data FROM board_state WHERE key = 'settings'"))?.data || '{}');
const PEOPLE_READ = /^SELECT slug, data FROM team/;

// ─── F1: a press answers from what it read before its write ─────────

test('F1: Settings, the quorum and the template, with each read of People failing once: refused with nothing saved, or saved and answered as saved, never “nothing was changed” over a save', async () => {
  const w = await world();
  for (const [what, press, kept] of [
    ['the quorum', () => api({ action: 'save-settings', settings: { quorum: 3 } }), (s) => s.quorum === 3],
    ['the operating balance', () => page(FOUNDER, { action: 'operating-balance', amount: 123456 }), (s) => s.operatingBalance === 123456],
  ]) {
    for (let nth = 0; nth < 6; nth++) {
      await restore(w.from);
      const { r, hit } = await withOne(PEOPLE_READ, press, { nth });
      if (!hit) break;
      const saved = kept(await settingsNow());
      if (saved) assert.equal(r.status, 200, `${what}, People’s read ${nth} failing: saved, and answered ${r.status} ${JSON.stringify(r.body)}`);
      else {
        assert.equal(r.status, 503, `${what}, People’s read ${nth}: ${JSON.stringify(r.body)}`);
        assert.match(said(r), NOTHING);
      }
      if (saved && what === 'the operating balance') assert.equal(r.body.operatingBalance, 123456);
    }
  }
});

test('F1: the template’s save, its answer lost, sent again with the base the page still has: her own save, 200, never “saved the agenda template since you opened it”; someone else’s since is still the question', async () => {
  const w = await world();
  await restore(w.from);
  const s0 = await board.getSettings(env.DB);
  const renamed = s0.template.map((x, i) => (i === 0 ? { ...x, title: 'Opening (renamed)' } : x));
  const save = (by = FOUNDER, template = renamed) => api({ action: 'save-settings', settings: { template }, base: s0.templateAt }, by);
  const { r, hit } = await withOne(/^UPDATE board_state SET data = \?, updated_at = \? WHERE key = 'settings'/, () => save(), { mode: 'lost' });
  assert.ok(hit);
  assert.equal(r.status, 200, `its answer lost: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.settings.template[0].title, 'Opening (renamed)');
  assert.equal((await board.getSettings(env.DB)).template[0].title, 'Opening (renamed)');
  // The page's retry: the same words over the same base
  const again = await save();
  assert.equal(again.status, 200, `the same save again: ${JSON.stringify(again.body)}`);
  assert.equal(again.body.settings.template[0].title, 'Opening (renamed)');
  // Other words over that old base (another tab of hers): the question, as before
  const other = await save(FOUNDER, s0.template.map((x, i) => (i === 0 ? { ...x, title: 'Welcome' } : x)));
  assert.equal(other.status, 409, JSON.stringify(other.body));
  assert.ok(other.body.current, 'with theirs to merge');
});

test('F1: Sam’s check-in and Kim’s vote with People, or any read after the write, failing: kept and answered as kept, or refused with nothing kept; their own write’s answer lost answers as written', async () => {
  const w = await world();
  const checkin = () => page(SAM, { action: 'checkin', meetingId: w.today.id, how: 'remote' });
  const vote = () => page(KIM, { action: 'vote', meetingId: w.today.id, motionId: 'mo_r14', vote: 'for' });
  const hisCheckin = async () => (await one('SELECT how FROM board_checkins WHERE meeting_id = ? AND slug = ?', w.today.id, 'sam-ortiz'))?.how || '';
  const herVote = async () => (await one('SELECT vote FROM board_votes WHERE meeting_id = ? AND slug = ?', w.today.id, 'kim-park'))?.vote || '';
  for (const [what, press, kept] of [['his check-in', checkin, async () => (await hisCheckin()) === 'remote'], ['her vote', vote, async () => (await herVote()) === 'for']]) {
    for (const [re, mode] of [[PEOPLE_READ, 'fail'], [/^SELECT data FROM board_meetings WHERE id = \?/, 'fail'], [/^INSERT OR REPLACE INTO board_(checkins|votes)/, 'fail'], [/^INSERT OR REPLACE INTO board_(checkins|votes)/, 'lost']]) {
      for (let nth = 0; nth < 4; nth++) {
        await restore(w.from);
        const { r, hit } = await withOne(re, press, { nth, mode });
        if (!hit) break;
        const done = await kept();
        const where = `${what}, ${re} ${mode} (${nth})`;
        assert.doesNotMatch(said(r), WRONG, where);
        if (done) {
          assert.equal(r.status, 200, `${where}: kept, and answered ${r.status} ${JSON.stringify(r.body)}`);
          if (what === 'his check-in') assert.equal(r.body.me.how, 'remote', `${where}: the answer shows it`);
          else assert.equal(r.body.vote.mine, 'for', `${where}: the answer shows it`);
        } else {
          assert.equal(r.status, 503, `${where}: ${JSON.stringify(r.body)}`);
          assert.match(said(r), NOTHING, where);
        }
      }
    }
  }
});

test('F1: a line note, the operating balance, check-in, vote and Settings swept: every statement failing once and each write landing with its answer lost, the words what happened', async () => {
  const w = await world();
  await pressSweep('Sam’s line note', w.from, () => PORTAL['line-note'].press(w));
  await pressSweep('Sam takes his line note off', w.from, () => page(SAM, { action: 'line-note', meetingId: w.ahead.id, itemId: w.item.id, key: 'bud|Total Income', line: 'Total Income', text: '' }), { prep: async () => { await page(SAM, { action: 'line-note', meetingId: w.ahead.id, itemId: w.item.id, key: 'bud|Total Income', line: 'Total Income', text: 'Up 4%' }); return {}; } });
  await pressSweep('the operating balance', w.from, () => PORTAL['operating-balance'].press(w));
  await pressSweep('check-in', w.from, () => PORTAL.checkin.press(w));
  await pressSweep('vote', w.from, () => PORTAL.vote.press(w));
  await pressSweep('Settings: the quorum', w.from, () => api({ action: 'save-settings', settings: { quorum: 3 } }));
});

// ─── F2: every decision of a correction through the lost-answer look ───

test('F2: Taylor keeps the minutes as they are on Sam’s correction, the decision’s write landing with its answer lost: 200 “declined”, and Sam told once', async () => {
  const w = await world();
  await restore(w.from);
  const m0 = mail.length;
  const decide = () => page(TAYLOR, { action: 'correction-decide', id: w.cid, make: false, reason: 'Kim joined by phone after the vote' });
  const { r, hit } = await withOne(/^UPDATE board_minutes_corrections SET state = \?, decided_by/, decide, { mode: 'lost' });
  assert.ok(hit, 'the decision’s write came');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state, 'declined');
  assert.equal((await one('SELECT state, decided_by FROM board_minutes_corrections WHERE id = ?', w.cid)).state, 'declined');
  const again = await decide();
  assert.equal(again.status, 409, 'pressed again: decided already');
  await looks();
  await later(6 * MIN, () => looks());
  assert.equal(kinds('board-correction-decided', m0).filter((x) => x.to.includes(SAM)).length, 1, 'Sam told once');
});

test('F2: every way a correction is decided, swept (make it, keep them as they are; on minutes read from a file and on typed ones): each statement failing once and each write lost, answered as it was decided or as nothing changed', async () => {
  const w = await world();
  await pressSweep('keep them as they are', w.from, () => PORTAL['correction-decide'].press(w));
  await pressSweep('make it', w.from, () => PORTAL['correction-decide (make it)'].press(w));
  // (one about anything else: made by marking it, one batch)
  await restore(w.from);
  const other = await page(KIM, { action: 'correction', meetingId: w.held.id, target: 'general', words: 'The date of the next meeting is wrong' });
  assert.equal(other.status, 200, other.text);
  await pressSweep('marked as made (about anything else)', saveState(), () => page(TAYLOR, { action: 'correction-decide', id: other.body.correction.id, make: true }));
});

// ─── F3: the presses round 13 didn't reach, in words ────────────────

test('F3: Sam’s own signed copy with a read before its write or its write failing: 503 “…so nothing was signed”, nothing kept; with its answer lost, signed', async () => {
  const w = await world();
  const copy = () => PORTAL['?signed'].press(w);
  for (const re of [/^SELECT data FROM board_docs/, /^SELECT \* FROM board_signatures WHERE doc_id = \? AND slug = \? AND year = \?/, /^INSERT OR REPLACE INTO board_signatures/]) {
    await restore(w.from);
    const { r, hit } = await withOne(re, copy);
    assert.ok(hit, `${re} came`);
    assert.equal(r.status, 503, `${re}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, board.NOTHING_SIGNED);
    assert.equal(await one('SELECT how FROM board_signatures WHERE doc_id = ? AND slug = ?', w.docs[0].id, 'sam-ortiz'), null, 'nothing signed');
    assert.equal((await sql("SELECT id FROM board_files WHERE owner_type = 'signed'")).length, 0, 'no copy kept');
  }
  await restore(w.from);
  const { r } = await withOne(/^INSERT OR REPLACE INTO board_signatures/, copy, { mode: 'lost' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await one('SELECT how FROM board_signatures WHERE doc_id = ? AND slug = ?', w.docs[0].id, 'sam-ortiz')).how, 'copy');
});

test('F3: Take it off with the papers’ read after it failing: 200, taken off, the page told to look again; never “Something went wrong”, never 404 pressed again', async () => {
  const w = await adminWorld();
  await restore(w.signed);
  const off = () => api({ action: 'unsign', docId: w.docs[0].id, slug: 'sam-ortiz', reason: 'Filed under the wrong year' });
  // (each read of the papers failing in turn, the one after taking it off among them)
  let reread = 0;
  for (let nth = 0; nth < 12; nth++) {
    await restore(w.signed);
    const { r, hit } = await withOne(/^SELECT data FROM board_docs$/, off, { nth });
    if (!hit) break;
    const gone = !(await one('SELECT how FROM board_signatures WHERE doc_id = ? AND slug = ?', w.docs[0].id, 'sam-ortiz'));
    assert.doesNotMatch(said(r), WRONG, `read ${nth}`);
    if (gone) {
      assert.equal(r.status, 200, `read ${nth}: taken off, and answered ${r.status} ${JSON.stringify(r.body)}`);
      assert.ok(r.body.doc || r.body.reread, `read ${nth}: the paper, or the page told to look again`);
      if (r.body.reread) reread += 1;
      const again = await off();
      assert.notEqual(again.status, 500, `read ${nth}: pressed again`);
    } else {
      assert.equal(r.status, 503, `read ${nth}: ${JSON.stringify(r.body)}`);
      assert.match(said(r), NOTHING);
    }
  }
  assert.ok(reread >= 1, 'the read after taking it off failing: taken off, the page looks again');
});

test('F3: the secretary’s minutes as a file with the meeting’s read failing, or its file’s row: nothing kept, no file left on the meeting, said so; the read in landing with its answer lost answers as read in', async () => {
  const w = await world();
  const send = () => PORTAL['?minutes'].press(w);
  const onIt = async () => (await sql("SELECT id FROM board_files WHERE owner_type = 'meeting' AND owner_id = ? AND kind = 'minutes'", w.plain.id)).length;
  for (const re of [/^SELECT data FROM board_meetings WHERE id = \?/, /^SELECT \* FROM board_files WHERE owner_type = \? ORDER BY at/]) {
    for (let nth = 0; nth < 6; nth++) {
      await restore(w.from);
      const { r, hit } = await withOne(re, send, { nth });
      if (!hit) break;
      const read = !!(await board.getMeeting(env.DB, w.plain.id))?.minutesFrom?.name;
      const files = await onIt();
      if (read) assert.equal(r.status, 200, `${re} (${nth}): read in, answered ${r.status} ${JSON.stringify(r.body)}`);
      else {
        assert.equal(files, 0, `${re} (${nth}): not read in, and no file left on the meeting`);
        assert.equal(r.status, 503, `${re} (${nth}): ${JSON.stringify(r.body)}`);
        assert.match(said(r), NOTHING);
      }
    }
  }
  await restore(w.from);
  const { r } = await withOne(/^UPDATE board_meetings SET date = \?, data = \?/, send, { mode: 'lost' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await onIt(), 1);
});

test('F3: Taylor’s notes beside the agenda, her minutes as a file and Take it off swept', async () => {
  const w = await adminWorld();
  await pressSweep('notes-save', w.from, () => PORTAL['notes-save'].press(w));
  await pressSweep('?minutes', w.from, () => PORTAL['?minutes'].press(w), { min: 20 });
  await pressSweep('Take it off', w.signed, () => ADMIN.unsign.press(w));
  await pressSweep('a signed copy SOARD adds', w.from, () => ADMIN['form:signFor'].press(w));
});

// ─── F4: a notice goes only while what it's about still stands ──────

test('F4: notices that had to wait (Resend 502), then what they were about undone: a correction taken back, one decided first, a paper signed after its decline: closed with nothing sent; one still standing goes', async () => {
  const w = await world();
  // (a fresh correction from Kim, its email to the secretary and the founders refused by Resend)
  const suggest = async () => { resendDown = 5; const r = await page(KIM, { action: 'correction', meetingId: w.held.id, target: 'r:sam-ortiz', words: 'remote' }); resendDown = 0; assert.equal(r.status, 200, r.text); return r.body.correction.id; };
  const owed = async () => (await sql("SELECT key FROM board_state WHERE key LIKE 'notice-due:%'")).map((x) => x.key);
  const settle = async () => { for (const ms of [6 * MIN, 30 * MIN, DAY]) await later(ms, () => looks()); };

  // Taken back before the next look
  await restore(w.from);
  let m0 = mail.length;
  let cid = await suggest();
  assert.equal((await page(KIM, { action: 'correction-withdraw', id: cid })).status, 200);
  await settle();
  assert.deepEqual(kinds('board-correction', m0).map((x) => x.to), [], 'nothing about a correction taken back');
  assert.deepEqual(await owed(), [], 'its notice closed');

  // Decided first: the secretary and the founders aren't told it was suggested; Kim is told what was decided
  await restore(w.from);
  m0 = mail.length;
  cid = await suggest();
  assert.equal((await page(TAYLOR, { action: 'correction-decide', id: cid, make: false, reason: 'Sam was in the room' })).status, 200);
  await settle();
  assert.deepEqual(kinds('board-correction', m0).map((x) => x.to), [], 'nothing about a correction decided already');
  assert.deepEqual(kinds('board-correction-decided', m0).map((x) => x.to[0]), [KIM], 'Kim told what was decided, once');

  // Still standing: goes once
  await restore(w.from);
  m0 = mail.length;
  cid = await suggest();
  await settle();
  assert.deepEqual(kinds('board-correction', m0).map((x) => x.to[0]).sort(), [FOUNDER, TAYLOR].sort(), 'a correction still waiting: told, once each');

  // A decline, then signed
  await restore(w.from);
  m0 = mail.length;
  resendDown = 5;
  const d = await page(SAM, { action: 'decline', docId: w.docs[0].id, reason: 'I need to read it with my lawyer first', year: YEAR });
  resendDown = 0;
  assert.equal(d.status, 200, d.text);
  assert.equal(d.body.sent, false);
  assert.equal((await page(SAM, { action: 'sign', docId: w.docs[0].id, name: 'Sam Ortiz', mark: MARK, consent: true, version: w.docs[0].version, year: YEAR })).status, 200);
  await settle();
  assert.deepEqual(kinds('board-declined', m0).map((x) => x.to), [], 'nothing about a paper he has signed since');
  assert.deepEqual(await owed(), [], 'closed');
  // …and one he still can't sign goes
  await restore(w.from);
  m0 = mail.length;
  resendDown = 5;
  assert.equal((await page(SAM, { action: 'decline', docId: w.docs[1].id, reason: 'The conflict list is missing a line', year: YEAR })).status, 200);
  resendDown = 0;
  await settle();
  assert.deepEqual(kinds('board-declined', m0).map((x) => x.to[0]), [FOUNDER], 'still declined: told once');
});

test('F4: a signature taken off whose member signed again before the notice went: closed in the signing record as not needed, nothing sent', async () => {
  const w = await adminWorld();
  await restore(w.signed);
  const m0 = mail.length;
  resendDown = 5;
  assert.equal((await api({ action: 'unsign', docId: w.docs[0].id, slug: 'sam-ortiz', reason: 'Filed under the wrong year' })).status, 200);
  resendDown = 0;
  assert.equal((await page(SAM, { action: 'sign', docId: w.docs[0].id, name: 'Sam Ortiz', mark: MARK, consent: true, version: w.docs[0].version, year: YEAR })).status, 200);
  for (const ms of [6 * MIN, DAY]) await later(ms, () => looks());
  assert.deepEqual(kinds('board-void', m0).map((x) => x.to), [], 'nothing asks him to sign what he has signed again');
  const closed = (await sql("SELECT detail FROM board_sign_events WHERE kind = 'void-sent' AND slug = 'sam-ortiz'")).map((x) => JSON.parse(x.detail).skipped);
  assert.deepEqual(closed, ['signed it again']);
});

// ─── F5: a press's own claim, its answer lost ───────────────────────

test('F5: a press’s own claim written with its answer lost carries on: Taylor’s decision, her notes sent, Email all, a send to the board and the invite go at once, never “being made / sent right now”', async () => {
  const w = await adminWorld();
  const cases = [
    ['Taylor decides Sam’s correction', w.from, /^UPDATE board_minutes_corrections SET state = 'making'/, () => page(TAYLOR, { action: 'correction-decide', id: w.cid, make: false, reason: 'Kim joined late' }),
      async () => (await one('SELECT state FROM board_minutes_corrections WHERE id = ?', w.cid)).state === 'declined'],
    ['Taylor sends her notes as the minutes', w.from, /^UPDATE board_minutes_notes SET sending/, () => page(TAYLOR, { action: 'notes-send', meetingId: w.today.id }),
      async () => !!(await one('SELECT sent FROM board_minutes_notes WHERE meeting_id = ?', w.today.id))?.sent],
    ['Jane’s Email all', w.from, /^INSERT INTO board_state \(key, data, updated_at\) VALUES \(\?, \?, \?\) ON CONFLICT\(key\) DO NOTHING/, () => api({ action: 'email-all', subject: 'Budget question', message: 'Please read the budget before Thursday.' }),
      async () => gmail.length > 0],
    ['Jane reminds the board to answer the invite', w.invited, /^INSERT INTO board_state \(key, data, updated_at\) VALUES \(\?, \?, \?\) ON CONFLICT\(key\) DO UPDATE/, () => api({ action: 'remind-rsvp', id: w.ahead.id }),
      async () => kinds('board-reminder').length > 0],
    ['Jane sends the invite', w.approved, /^INSERT INTO board_state \(key, data, updated_at\) VALUES \(\?, \?, \?\) ON CONFLICT\(key\) DO UPDATE/, () => api({ action: 'send-invite', id: w.ahead.id }),
      async () => Object.keys(google.events).length > 0],
  ];
  for (const [what, from, re, press, done] of cases) {
    await restore(from);
    const g0 = gmail.length;
    const { r, hit } = await withOne(re, press, { mode: 'lost' });
    assert.ok(hit, `${what}: its claim came`);
    assert.equal(r.status, 200, `${what}: its claim’s answer lost: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.ok(await done(), `${what}: done`);
    assert.doesNotMatch(said(r), /right now|still be going out|being made|being sent/i, what);
    if (what === 'Jane’s Email all') {
      const again = await press();
      assert.equal(again.status, 200);
      assert.equal(again.body.already, true, 'pressed again: it went, never a second copy');
      assert.equal(gmail.length - g0, 1, 'once');
    }
  }
});

test('F5: the claims swept: each press’s claim, every statement failing once and each write lost, then pressed again at once: never “right now” over a claim nothing holds', async () => {
  const w = await adminWorld();
  for (const [name, from, press] of [
    ['decide', w.from, () => PORTAL['correction-decide'].press(w)],
    ['notes-send', w.from, () => PORTAL['notes-send'].press(w)],
    ['email-all', w.from, () => ADMIN['email-all'].press(w)],
    ['remind-rsvp', w.invited, () => ADMIN['remind-rsvp'].press(w)],
  ]) {
    const out = await sweep(from, press, async ({ r }) => {
      if (r.status === 200) return '';
      const again = await press();
      return /right now|still be going out|being made|being sent/i.test(said(again)) ? `pressed again at once: ${again.status} “${said(again)}”` : '';
    }, { modes: ['lost'] });
    report(`F5 ${name}`, out, 1);
  }
});
