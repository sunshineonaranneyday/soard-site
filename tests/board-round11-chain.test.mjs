/**
 * Board QA round 11 (Nov 23 2026): the privacy tester's findings on the signing chain, the notices it owes, the links
 * and the words a founder is told (F3, F4, F6, F7, F9, F10, F11, and F1's answer to a board email change).
 *   F1  a board email change answers with what it did: what the answer says is read before the save
 *   F4  the email change and its 'email-changed' event land together or not at all (503 in words, nothing changed)
 *   F11 what a founder is told is our words, never the database's
 *   F3  the old address's notice follows its member through a rename (the chain's, and People's still finishing), and
 *       "not on the board" is written only for someone who left it
 *   F7  a waiting notice is for the person as People has them when it goes: someone who left gets nothing, closed
 *       with a true record; someone renamed is still told
 *   F6  the auditor's export: a read that fails is a 503 in words, never a ZIP missing anything
 *   F9  a good RSVP link with any read failing: "We couldn't check this link just now", never "older email"
 *   F10 Process's Drive look with People not read: every Doc keeps what it said; noted, and looked at again
 * The rule for both fixers is kept by sweeps: each press or look is run from the same saved database with every
 * statement it makes failing once in turn (after a clean control), and what it said is held against what the database
 * and the fakes show happened. Made-up people only (the repo is public).
 * Run: node --test tests/board-round11-chain.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import * as board from '../functions/api/_board.js';
import * as admin from '../functions/api/board-admin.js';
import * as rsvp from '../functions/api/board-rsvp.js';
import * as invitesAdmin from '../functions/api/reveal-invites-admin.js';
import * as reveal from '../functions/api/_reveal-invites.js';
import * as processDocs from '../functions/api/_process-docs.js';
import { maybeRunSigning } from '../functions/api/_board-sign.js';
import { clearTokenCache } from '../functions/api/_google-calendar.js';
import { cleanMeeting, todayEastern } from '../public/admin/board-shared.js';

const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const ROSA = 'rosa.board@example.com';
const ROSA_NEW = 'rosa.new@example.com';
const YEAR = Number(todayEastern().slice(0, 4));
// (the words, as decided: ./functions/api/_board-roles.js, _reveal-invites.js, _board-sign.js)
const PEOPLE_DOWN = 'We couldn’t check People just now, so nothing was changed. Please try again in a moment.';
const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
const SAVE_DOWN = 'We couldn’t save that just now, so nothing was changed. Please try again in a moment.';
const CHECK_DOWN = 'The site couldn’t check that email just now. Please try again in a moment.';
const RECORD_DOWN = 'We couldn’t read the whole signing record just now, so nothing was downloaded. Please try again in a moment.';
const RAW = /D1_ERROR|SQLITE|network connection|qa:/i;
const inDays = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', seat: 'chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
  ['rosa-de-la-vega', { name: 'Rosa de la Vega', group: 'board', title: 'Board Member' }],
  ['ada-example', { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['rosa-de-la-vega', ROSA], ['ada-example', 'ada.adv@example.org']];

// ─── The database, one statement of it not answering ────────────────
// Every statement a press makes is counted (first, all, run, and a batch as one); the one numbered `failAt` fails once
let ops = 0;
let failAt = -1;
let failed = [];
function counted(DB) {
  const tick = (what) => {
    const k = ops++;
    if (k !== failAt) return;
    failed.push(what);
    throw new Error('D1_ERROR: qa: the database didn’t answer (network connection lost)');
  };
  const wrap = (st) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => { tick(`${m} ${s._sql}`); return s[m](...a); } : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
  return new Proxy(DB, { get: (t, k) => (k === 'prepare' ? (sql) => wrap(t.prepare(sql)) : k === 'batch' ? async (stmts) => { tick(`batch ${stmts.map((x) => String(x._sql).slice(0, 50)).join(' ; ')}`); return t.batch(stmts); } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
}

let raw;
let env;
let files;
let mail; // every email Resend took: { to, subject, key }
let refuse; // how many sends Resend turns away next
let seen; // (Resend keeps each idempotency key: the same one again is "already"; put back with the database in a sweep)
const realFetch = globalThis.fetch;
/** The database as it is now, to start each press of a sweep from */
const snap = () => raw._db.export();
async function restore(bytes) {
  raw = await createD1({ bytes });
  seen = new Set();
  mail = [];
  env.DB = counted(raw);
  ops = 0;
  failAt = -1;
  failed = [];
}
const one = async (sql, ...args) => raw.prepare(sql).bind(...args).first();
const all = async (sql, ...args) => (await raw.prepare(sql).bind(...args).all()).results || [];
const events = async (kind) => (await all('SELECT seq, slug, detail FROM board_sign_events WHERE kind = ? ORDER BY seq', kind)).map((e) => ({ ...e, detail: JSON.parse(e.detail || 'null') }));

beforeEach(async () => {
  raw = await createD1();
  files = new Map();
  env = {
    DB: counted(raw), RESEND_API_KEY: 're_test',
    FILES: {
      get: async (k) => (files.has(k) ? { body: new Blob([files.get(k)]).stream(), size: files.get(k).length } : null),
      head: async (k) => (files.has(k) ? { size: files.get(k).length } : null),
      put: async (k, v) => { files.set(k, new Uint8Array(typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer())); },
      delete: async (k) => { files.delete(k); },
    },
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
  await raw.exec('CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
  clearTokenCache();
  mail = [];
  refuse = 0;
  seen = new Set();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.startsWith('https://api.resend.com/')) {
      const key = init.headers?.['Idempotency-Key'] || '';
      if (key && seen.has(key)) return new Response('{}', { status: 409 });
      if (refuse > 0) { refuse -= 1; return Response.json({ message: 'Bad gateway' }, { status: 502 }); }
      if (key) seen.add(key);
      const body = JSON.parse(init.body);
      for (const e of [].concat(body)) mail.push({ to: [].concat(e.to).map((x) => String(x).toLowerCase()), subject: e.subject, key });
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
    }
    return new Response('{}', { status: 503 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; failAt = -1; });

/**
 * A route's handler called as Cloudflare would, signed in as `who` (the sign-in itself is round 8's and 10's; here it's
 * what the press does). What it left running is finished after it answers, the database answering again by then.
 * → { status, body (JSON), bytes, broken (a download that broke off partway) }
 */
async function press(handler, path, { who = FOUNDER, method = 'GET', body = null } = {}) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const later = [];
  const ctx = { request, env, data: { userEmail: who }, waitUntil: (p) => { later.push(p); } };
  const res = await (method === 'GET' ? handler.onRequestGet(ctx) : handler.onRequestPost(ctx));
  let bytes = null;
  let broken = false;
  try { bytes = new Uint8Array(await res.arrayBuffer()); } catch { broken = true; }
  failAt = -1;
  await Promise.allSettled(later);
  const text = bytes ? new TextDecoder().decode(bytes) : '';
  let json = null;
  try { json = JSON.parse(text); } catch { /* a file, or a page */ }
  return { status: res.status, body: json, bytes, text, broken, type: res.headers.get('Content-Type') || '' };
}

/**
 * The same step from the same saved database: a clean control (k = -1), then with statement k failing once, k = 0, 1, …
 * until there's nothing left to fail. `check(result, { k, failed })` holds what it said against what happened; every
 * k is tried, and each one whose check fails is listed (`problems`, its first line), so one run shows them all.
 * → { tried, problems }
 */
async function sweep(base, step, check, { max = 400 } = {}) {
  let tried = 0;
  const problems = [];
  for (let k = -1; k < max; k++) {
    await restore(base);
    failAt = k;
    const r = await step();
    failAt = -1;
    if (k >= 0 && !failed.length) return { tried, problems };
    try { await check(r, { k, failed: [...failed] }); } catch (err) {
      if (k < 0) throw err;
      problems.push(String(err?.message || err).split('\n')[0]);
    }
    if (k >= 0) tried += 1;
  }
  throw new Error('the sweep never ran out of statements');
}

/** A meeting the server keeps, shared with the board, with its fields as given */
const kept = async (fields) => board.saveMeeting(env.DB, cleanMeeting({ shared: true, sections: [{ title: 'New business', items: [{ title: 'Budget' }] }], ...fields }), { by: 'test' });
const rename = async (from, to) => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, FOUNDER, async () => Response.json({ success: true }));
const leave = async (slug) => {
  const d = JSON.parse((await one('SELECT data FROM team WHERE slug = ?', slug)).data);
  await raw.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind('alumni', JSON.stringify({ ...d, group: 'alumni' }), slug).run();
};
const told = (address) => mail.filter((m) => m.to.includes(address) && /no longer signs in with this email/.test(m.subject));
/** A notice a press owes, written down as due as ./_board-notices.js oweNotice writes it (its send waited for People) */
const owe = (id, notice) => raw.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`notice-due:${id}`, JSON.stringify({ ...notice, id, queuedAt: new Date().toISOString(), tries: 0 }), new Date().toISOString()).run();
/** The looks after a failed one: a notice that met a failure rests (5 minutes on the live site), so this stands for that wait */
async function cleanLooks(n = 3) {
  for (let i = 0; i < n; i++) {
    await raw.prepare("UPDATE board_state SET data = json_remove(data, '$.triedAt') WHERE key LIKE 'notice-due:%'").run();
    await maybeRunSigning(env);
  }
}

// ─── F1, F4, F11: a board email changed ─────────────────────────────

const changeRosa = () => press(invitesAdmin, '/api/reveal-invites-admin', { method: 'POST', body: { boardEmail: { slug: 'rosa-de-la-vega', email: ROSA_NEW } } });
const rosaNow = async () => ({ email: (await one("SELECT email FROM reveal_board_emails WHERE slug = 'rosa-de-la-vega'"))?.email, events: (await events('email-changed')).length });

test('F1, F4, F11: a board email change, every statement failing once in turn: saved with its event and said so, or nothing saved and said in our words', async (t) => {
  const tally = { saved: 0, refused: 0 };
  let tried = 0;
  const problems = [];
  // (as it usually is, and with the new address left behind by someone no longer on People: it goes in the same write)
  const start = snap();
  for (const orphan of [false, true]) {
    await restore(start);
    if (orphan) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('someone-gone', ROSA_NEW).run();
    const base = snap();
    const swept = await sweep(base, changeRosa, async (r, { k, failed: f }) => {
    const now = await rosaNow();
    const at = `k=${k} [${f.join(' | ') || 'control'}] → ${r.status} ${r.body?.error || ''}`;
    assert.ok(!RAW.test(r.body?.error || ''), `${at}: the database's own words, never said (F11)`);
    if (r.status === 200) {
      // Saved: the address and its event together (F4), and the answer is the board with it
      assert.deepEqual(now, { email: ROSA_NEW, events: 1 }, `${at}: answered as saved, so saved with its event in the chain`);
      assert.equal(r.body.board.find((m) => m.slug === 'rosa-de-la-vega')?.email, ROSA_NEW, `${at}: the answer shows the new email`);
      tally.saved += 1;
    } else {
      // Refused: nothing at all (F1: never "nothing was changed" with the email changed)
      assert.deepEqual(now, { email: ROSA, events: 0 }, `${at}: refused, so nothing changed`);
      assert.equal(r.status, 503, at);
      assert.ok([PEOPLE_DOWN, SAVE_DOWN, CHECK_DOWN].includes(r.body?.error), `${at}: in our words`);
      tally.refused += 1;
    }
    if (orphan) assert.equal(!!(await one("SELECT slug FROM reveal_board_emails WHERE slug = 'someone-gone'")), r.status !== 200, `${at}: the address left behind goes with the save, and only with it`);
    });
    tried += swept.tried;
    problems.push(...swept.problems);
  }
  t.diagnostic(`swept ${tried} statements: ${JSON.stringify(tally)}`);
  assert.deepEqual(problems, [], 'every statement failing once: what was said is what happened');
  assert.ok(tried >= 8 && tally.saved >= 2 && tally.refused >= 5, `swept (${tried}: ${JSON.stringify(tally)})`);
});

test('F4, F11: the tester’s three, one at a time: the chain’s last-hash read, its insert, and the clean-up of the address failing once', async () => {
  // (the clean-up: an address left behind with the new one, by someone no longer on People, goes in the same write)
  await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('someone-gone', ROSA_NEW).run();
  const base = snap();
  for (const [what, re] of [['the chain’s last-hash read', /^first SELECT hash FROM board_sign_events/], ['the chain’s insert', /^batch .*INSERT INTO board_sign_events/], ['the clean-up', /^batch .*DELETE FROM reveal_board_emails WHERE lower/]]) { /* r12: the change's event goes first in its batch now, only while the address is the one read (two founders at once), so the clean-up is no longer the batch's first statement */
    await restore(base);
    // (find the statement's number on a clean run, then fail it)
    const names = [];
    let k = -1;
    for (let i = 0; i < 200 && k < 0; i++) {
      await restore(base);
      failAt = i;
      await changeRosa();
      if (failed.some((x) => re.test(x))) k = i;
      names.push(...failed);
    }
    assert.ok(k >= 0, `${what}: found (${names.slice(0, 30).join(' | ')})`);
    await restore(base);
    failAt = k;
    const r = await changeRosa();
    assert.deepEqual([r.status, r.body?.error], [503, SAVE_DOWN], `${what}: 503 in words`);
    assert.deepEqual(await rosaNow(), { email: ROSA, events: 0 }, `${what}: nothing saved, so no change goes untold`);
    // Pressed again: saved, and the old address told on the next look
    const again = await changeRosa();
    assert.equal(again.status, 200);
    await maybeRunSigning(env);
    assert.equal(told(ROSA).length, 1, `${what}: the old address told once`);
  }
});

// ─── F3: the old address told, through a rename ─────────────────────

async function changedThenRenamed({ before = null } = {}) {
  assert.equal((await changeRosa()).status, 200);
  if (before) await before();
  const ren = await rename('rosa-de-la-vega', 'rosa-vega');
  assert.equal(ren.status, 200, JSON.stringify(ren.body));
}
const noticeOf = async () => { const seq = (await events('email-changed'))[0]?.seq; return (await events('notice-sent')).filter((e) => e.detail.for === seq); };

test('F3: renamed straight after the change, the old address is told once, as who she is now; never "not on the board"', async () => {
  await changedThenRenamed();
  await cleanLooks(4);
  assert.equal(told(ROSA).length, 1, 'told once at the old address');
  assert.ok(!mail.some((m) => m.to.includes(ROSA_NEW)), 'never at the new one');
  assert.deepEqual((await noticeOf()).map((e) => [e.slug, e.detail.to, e.detail.skipped]), [['rosa-vega', ROSA, undefined]], 'the record names who she is now');
});

test('F3: the first look with Resend not answering (502), then the rename: told once on a later look', async () => {
  await changedThenRenamed({ before: async () => { refuse = 1; await maybeRunSigning(env); assert.equal(told(ROSA).length, 0); } });
  await cleanLooks(4);
  assert.equal(told(ROSA).length, 1);
  assert.deepEqual((await noticeOf()).map((e) => [e.slug, e.detail.to]), [['rosa-vega', ROSA]]);
});

test('F3: a rename People made that is still finishing (its chain event not written yet) is followed too', async () => {
  assert.equal((await changeRosa()).status, 200);
  // (the rename's own batch goes; moving her board records then stops at the chain, so its note stays for the heartbeat)
  let k = -1;
  const base = snap();
  for (let i = 0; i < 400 && k < 0; i++) {
    await restore(base);
    failAt = i;
    const ren = await rename('rosa-de-la-vega', 'rosa-vega').catch(() => null);
    failAt = -1;
    if (failed.some((x) => /INSERT INTO board_sign_events/.test(x)) && ren?.status === 200) k = i;
  }
  assert.ok(k >= 0, 'the rename stopped at the chain');
  assert.ok(await one("SELECT key FROM board_state WHERE key = 'rename-finish:rosa-de-la-vega'"), 'its note is there');
  assert.equal((await events('renamed')).length, 0, 'the chain has no rename yet');
  await cleanLooks(3);
  assert.equal(told(ROSA).length, 1, 'told once');
  assert.deepEqual((await noticeOf()).map((e) => [e.slug, e.detail.to]), [['rosa-vega', ROSA]]);
});

test('F3: one who truly left the board is recorded so (the true entry), and nobody is emailed', async () => {
  assert.equal((await changeRosa()).status, 200);
  await leave('rosa-de-la-vega');
  await cleanLooks(2);
  assert.equal(told(ROSA).length, 0);
  assert.deepEqual((await noticeOf()).map((e) => [e.slug, e.detail.skipped]), [['rosa-de-la-vega', 'not on the board']]);
});

// ─── F7: a waiting notice, for whoever they are when it goes ────────

async function waitingNotices() {
  const m = await kept({ date: inDays(-30), title: 'Q3 Board Meeting', minutes: 'draft' });
  const d = await board.saveDoc(env.DB, { title: 'Conflict of Interest Policy', kind: 'policy', sign: true, shared: true, body: 'Each member tells the board of any conflict.' }, { by: FOUNDER });
  /* r14: a notice goes only while what it's about still stands (./_board-notices.js noLonger), so the corrections these two
     tell of are on record, decided as their notices say (round 11 owed notices for corrections that weren't there) */
  for (const [cid, slug, name, email, state] of [['c_sam', 'sam-ortiz', 'Sam Ortiz', SAM, 'made'], ['c_taylor', 'taylor-nguyen', 'Taylor Nguyen', TAYLOR, 'declined']]) {
    await env.DB.prepare('INSERT INTO board_minutes_corrections (id, meeting_id, target, kind, was, words, by_slug, by_name, by_email, at, state, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(cid, m.id, 'general', 'other', '', 'Kim joined by phone', slug, name, email, new Date().toISOString(), state, 'Jane Doe', new Date().toISOString()).run();
  }
  await owe('correction-decided:c_sam', { kind: 'correction-decided', meetingId: m.id, cid: 'c_sam', made: true, byName: 'Jane Doe', toEmail: SAM, toSlug: 'sam-ortiz' });
  await owe(`void:${d.id}:sam-ortiz:${YEAR}:x`, { kind: 'void', docId: d.id, slug: 'sam-ortiz', year: YEAR, at: '2026-01-05T15:00:00.000Z', reason: 'Signed the wrong paper', by: FOUNDER, to: SAM });
  await owe('correction-decided:c_taylor', { kind: 'correction-decided', meetingId: m.id, cid: 'c_taylor', made: false, byName: 'Jane Doe', toEmail: TAYLOR, toSlug: 'taylor-nguyen' });
  return { m, d };
}

test('F7: Sam left the board while his notices waited: nothing goes to him, each is closed with a true record; Taylor, renamed meanwhile, is told', async () => {
  const { d } = await waitingNotices();
  await leave('sam-ortiz');
  assert.equal((await rename('taylor-nguyen', 'taylor-ng')).status, 200);
  await cleanLooks(2);
  assert.deepEqual(mail.filter((x) => x.to.includes(SAM)).map((x) => x.subject), [], 'nothing to someone who left');
  const toTaylor = mail.filter((x) => x.to.includes(TAYLOR));
  assert.equal(toTaylor.length, 1, 'Taylor, renamed meanwhile, told once, at the address the press kept');
  assert.match(toTaylor[0].subject, /correction/i);
  assert.deepEqual((await all("SELECT key FROM board_state WHERE key LIKE 'notice-due:%'")).map((r) => r.key), [], 'every notice closed');
  assert.deepEqual((await all("SELECT slug, doc_id, detail FROM board_sign_events WHERE kind = 'void-sent'")).map((e) => [e.slug, e.doc_id, JSON.parse(e.detail).skipped, JSON.parse(e.detail).to]), [['sam-ortiz', d.id, 'not on the board', undefined]], 'the signature’s, closed in the signing record as what it was');
});

// ─── The signing look, every statement failing once in turn ─────────

test('F3, F7: the signing look with every statement failing once in turn, then clean looks: the old address told once, nothing to someone who left, the chain only true', async (t) => {
  await waitingNotices();
  await leave('sam-ortiz');
  await changedThenRenamed();
  const base = snap();
  const seq = (await events('email-changed'))[0].seq;
  const { tried, problems } = await sweep(base, () => maybeRunSigning(env), async (_, { k, failed: f }) => {
    const at = `k=${k} [${f.join(' | ') || 'control'}]`;
    await cleanLooks(3);
    assert.equal(told(ROSA).length, 1, `${at}: Rosa’s old address told once`);
    assert.deepEqual(mail.filter((x) => x.to.includes(SAM)), [], `${at}: nothing to Sam, who left`);
    assert.equal(mail.filter((x) => x.to.includes(TAYLOR)).length, 1, `${at}: Taylor told once`);
    const notice = (await events('notice-sent')).filter((e) => e.detail.for === seq);
    assert.deepEqual(notice.map((e) => [e.slug, e.detail.to, e.detail.skipped]), [['rosa-vega', ROSA, undefined]], `${at}: one true entry`);
    assert.deepEqual((await events('void-sent')).map((e) => [e.slug, e.detail.skipped]), [['sam-ortiz', 'not on the board']], `${at}: Sam’s closed as what it was`);
    assert.deepEqual((await all("SELECT key FROM board_state WHERE key LIKE 'notice-due:%'")).length, 0, `${at}: nothing left owed`);
  });
  t.diagnostic(`swept ${tried} statements`);
  assert.deepEqual(problems, [], 'every statement failing once: what was said is what happened');
  assert.ok(tried >= 20, `swept ${tried} statements`);
});

// ─── F6: the auditor's export ───────────────────────────────────────

/** A ZIP read by hand from its central directory → { names, csv } (null when it isn't a whole ZIP) */
function unzip(bytes) {
  const buf = Buffer.from(bytes || []);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) return null;
  const entries = {};
  for (let n = buf.readUInt16LE(end + 10), k = 0, p = buf.readUInt32LE(end + 16); k < n; k++) {
    const len = buf.readUInt16LE(p + 28);
    entries[buf.subarray(p + 46, p + 46 + len).toString('utf8')] = { size: buf.readUInt32LE(p + 20), offset: buf.readUInt32LE(p + 42) };
    p += 46 + len + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  const at = (name) => { const e = entries[name]; const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28); return buf.subarray(start, start + e.size).toString('utf8'); };
  return { names: Object.keys(entries).sort(), csv: entries['signatures.csv'] ? at('signatures.csv') : '' };
}

async function signingRecord() {
  const typed = (name) => ({ type: 'typed', style: 'caveat', text: name, initials: name.split(' ').map((x) => x[0]).join('') });
  const d = await board.saveDoc(env.DB, { title: 'Gift Acceptance Policy', kind: 'policy', sign: true, shared: true, body: 'SOARD accepts gifts of cash and stock.' }, { by: FOUNDER });
  await board.signDoc(env.DB, d.id, { slug: 'alex-rivera', name: 'Alex Rivera', email: ALEX }, '', { version: 1, mark: typed('Alex Rivera'), consent: true });
  const cur = (await board.listDocs(env.DB)).find((x) => x.id === d.id);
  await board.saveDoc(env.DB, { ...cur, body: 'SOARD accepts gifts of cash, stock and real estate.' }, { by: FOUNDER, askAgain: true, base: 1 });
  await board.signDoc(env.DB, d.id, { slug: 'alex-rivera', name: 'Alex Rivera', email: ALEX }, '', { version: 2, mark: typed('Alex Rivera'), consent: true });
  // A copy Sam signed on paper, added by SOARD: a file the record holds
  await board.signWithCopy(env, d.id, new File([new TextEncoder().encode('%PDF-1.4 signed by Sam')], 'Gift Policy - Sam Ortiz.pdf', { type: 'application/pdf' }), { slug: 'sam-ortiz', by: FOUNDER });
  return d;
}

test('F6: the auditor’s export with every statement failing once in turn: the whole record, or a 503 in words; never a ZIP missing anything', async (t) => {
  const d = await signingRecord();
  const base = snap();
  let control = null;
  const tally = { whole: 0, refused: 0 };
  const { tried, problems } = await sweep(base, () => press(admin, `/api/board-admin?record=${d.id}&year=${YEAR}`), async (r, { k, failed: f }) => {
    const at = `k=${k} [${f.join(' | ') || 'control'}] → ${r.status} ${r.body?.error || ''}${r.broken ? ' (broke off)' : ''}`;
    if (k < 0) {
      control = unzip(r.bytes);
      assert.ok(control, 'the control is a ZIP');
      assert.ok(/Alex Rivera,Signed/.test(control.csv) && /Alex Rivera,Earlier signature \(an earlier wording\)/.test(control.csv), 'its signatures, the earlier one too');
      assert.ok(control.names.some((x) => /^copies-on-paper\/Sam Ortiz - /.test(x)), `Sam’s copy (${control.names.join(' | ')})`);
      return;
    }
    assert.ok(!r.broken, `${at}: a download never breaks off for a read: they're all made before it starts`);
    if (r.status === 200) {
      assert.deepEqual(unzip(r.bytes), control, `${at}: answered with a ZIP, so the whole record`);
      tally.whole += 1;
    } else {
      assert.equal(r.status, 503, at);
      assert.ok([RECORD_DOWN, PEOPLE_DOWN, SIGN_IN_DOWN].includes(r.body?.error), `${at}: in words`);
      tally.refused += 1;
    }
  });
  t.diagnostic(`swept ${tried} statements: ${JSON.stringify(tally)}`);
  assert.deepEqual(problems, [], 'every statement failing once: what was said is what happened');
  assert.ok(tried >= 10 && tally.refused >= 8, `swept (${tried}: ${JSON.stringify(tally)})`);
});

test('F6: the tester’s one: the earlier signatures’ read failing once is a 503 in words, then the whole record', async () => {
  const d = await signingRecord();
  const base = snap();
  let k = -1;
  for (let i = 0; i < 200 && k < 0; i++) {
    await restore(base);
    failAt = i;
    await press(admin, `/api/board-admin?record=${d.id}&year=${YEAR}`);
    if (failed.some((x) => /^all SELECT \* FROM board_signatures_earlier/.test(x))) k = i;
  }
  assert.ok(k >= 0);
  await restore(base);
  failAt = k;
  const r = await press(admin, `/api/board-admin?record=${d.id}&year=${YEAR}`);
  assert.deepEqual([r.status, r.body?.error], [503, RECORD_DOWN]);
  const again = unzip((await press(admin, `/api/board-admin?record=${d.id}&year=${YEAR}`)).bytes);
  assert.ok(/Alex Rivera,Earlier signature/.test(again.csv));
});

// ─── F9: an old email's RSVP link ───────────────────────────────────

test('F9: a good RSVP link with every statement failing once in turn: its page, or "We couldn’t check this link just now"; never "older email", nothing recorded', async (t) => {
  const m = await kept({ date: inDays(9), start: '08:00', end: '10:00', location: 'Example Hall' });
  const tok = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  await raw.prepare('INSERT OR REPLACE INTO board_rsvp_links (hash, meeting_id, slug, expires) VALUES (?, ?, ?, ?)').bind(createHash('sha256').update(tok).digest('hex'), m.id, 'sam-ortiz', inDays(10)).run();
  const base = snap();
  const meeting0 = (await one('SELECT data FROM board_meetings WHERE id = ?', m.id)).data;
  const tally = { page: 0, unchecked: 0 };
  const { tried, problems } = await sweep(base, () => press(rsvp, `/api/board-rsvp?t=${tok}`), async (r, { k, failed: f }) => {
    const at = `k=${k} [${f.join(' | ') || 'control'}] → ${r.status}`;
    assert.ok(!/older email/.test(r.text), `${at}: never "This link is from an older email" for a good link`);
    assert.equal((await one('SELECT data FROM board_meetings WHERE id = ?', m.id)).data, meeting0, `${at}: nothing recorded`);
    if (r.status === 200) { assert.match(r.text, /Sam, will you be at the/, at); tally.page += 1; } else {
      assert.equal(r.status, 503, at);
      assert.match(r.text, /We couldn’t check this link just now/, at);
      tally.unchecked += 1;
    }
  });
  t.diagnostic(`swept ${tried} statements: ${JSON.stringify(tally)}`);
  assert.deepEqual(problems, [], 'every statement failing once: what was said is what happened');
  assert.ok(tried >= 4 && tally.unchecked >= 4, `swept (${tried}: ${JSON.stringify(tally)})`);
  // A link truly from an older email still says so
  await restore(base);
  const old = await press(rsvp, '/api/board-rsvp?t=ffffffffffffffffffffffffffffffff');
  assert.deepEqual([old.status, /older email/.test(old.text)], [404, true]);
});

// ─── F10: Process's Drive look, with People not read ────────────────

const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const drive = async (url) => {
  const u = String(url);
  if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g', expires_in: 3600 });
  if (u.startsWith('https://www.googleapis.com/drive/v3/files?')) return Response.json({ files: [{ id: 'doc1', name: '2026 Sunshine Makeover Process', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-11-01T00:00:00Z', webViewLink: 'https://docs.google.com/document/d/doc1/edit' }] });
  if (u.includes('/export?')) return new Response('<ol><li>Call the family</li><li>Design the room</li></ol>');
  if (u.startsWith('https://www.googleapis.com/drive/v3/files/')) return Response.json({ id: 'doc1', name: '2026 Sunshine Makeover Process', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-11-01T00:00:00Z' });
  return Response.json({});
};
const facts = async () => {
  const f = await processDocs.processFacts(raw);
  return Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'peopleSince').map(([k, v]) => [k, v?.error ? `ERROR: ${v.error}` : `${v?.steps} steps`]));
};
const look = (now) => { clearTokenCache(); return processDocs.maybeRefreshProcess(env, { fetchImpl: drive, now }); };

test('F10: Process’s hourly Drive look with every statement failing once in turn: each Doc keeps what it said (never "Nobody to read Drive as"), and the next look reads them', async (t) => {
  env.GOOGLE_CALENDAR_KEY = JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1', private_key: PEM });
  const base = snap();
  const t0 = Date.now();
  let control = null;
  const { tried, problems } = await sweep(base, () => look(t0), async (_, { k, failed: f }) => {
    const at = `k=${k} [${f.join(' | ') || 'control'}]`;
    const now = await facts();
    if (k < 0) { control = now; assert.ok(Object.values(control).some((x) => / steps$/.test(x) && x !== '0 steps'), JSON.stringify(control)); return; }
    assert.ok(!Object.values(now).some((x) => /Nobody to read Drive as/.test(x)), `${at}: there is someone to read Drive as (${JSON.stringify(now)})`);
    // What it wrote is the control's or nothing: never a Doc said wrong
    for (const [t, v] of Object.entries(now)) assert.ok(v === control[t] || v === '0 steps', `${at}: ${t} ${v}`);
    // The next heartbeat a minute on (for a People read that failed), or the next hour (anything else): as the control
    await look(t0 + 60_000);
    if (JSON.stringify(await facts()) !== JSON.stringify(control)) await look(t0 + 61 * 60_000);
    assert.deepEqual(await facts(), control, `${at}: read on a later look`);
  });
  t.diagnostic(`swept ${tried} statements`);
  assert.deepEqual(problems, [], 'every statement failing once: what was said is what happened');
  assert.ok(tried >= 6, `swept ${tried}`);
});

test('F10: the tester’s one: People’s read failing once on the hourly look leaves every Doc as it was, noted quietly, and the next heartbeat reads them', async () => {
  env.GOOGLE_CALENDAR_KEY = JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1', private_key: PEM });
  const t0 = Date.now();
  await look(t0);
  const before = await facts();
  // An hour on, with People's read failing once
  const base = snap();
  let k = -1;
  for (let i = 0; i < 100 && k < 0; i++) {
    await restore(base);
    failAt = i;
    await look(t0 + 61 * 60_000);
    if (failed.some((x) => /FROM team/.test(x))) k = i;
  }
  assert.ok(k >= 0);
  await restore(base);
  failAt = k;
  await look(t0 + 61 * 60_000);
  failAt = -1;
  assert.deepEqual(await facts(), before, 'every Doc keeps what it said');
  const f = await processDocs.processFacts(raw);
  assert.ok(f.peopleSince, 'noted, for Site → Automations after half an hour');
  await look(t0 + 62 * 60_000);
  assert.deepEqual(await facts(), before, 'read again on the next heartbeat');
  assert.equal((await processDocs.processFacts(raw)).peopleSince, null, 'and the note goes');
});
