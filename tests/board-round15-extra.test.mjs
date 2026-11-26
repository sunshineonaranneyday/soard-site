/**
 * Board QA round 15, the three things its board page fixer found outside its own area (Nov 26 2026). An answer or a
 * record never says more than what was read:
 *   1  The secretary signing approved minutes the board can't read (their only file kept Staff only): the site refuses
 *      it by the one rule the board page asks by (board-shared.js minutesCantSign, which minutesToSign and
 *      functions/api/_board-minutes-sign.js signMinutes both call), 409 in words; nothing signed, no event on the chain,
 *      no agreement recorded. Swept: every statement failing once in turn, each write landing with its answer lost
 *   2  The SOARD connection's soard_numbers (functions/api/_mcp/money.js): a figure from a read that failed is said to be
 *      one that couldn't be read just now, by name (couldntRead), never SOARD's default $500,000 operating balance nor
 *      none; one that's simply not set is said so in words. Swept the same way
 *   3  Board's snapshot of today's numbers for a meeting (functions/api/_board.js takeSnapshot): any part it keeps not
 *      read just now refuses it (503) in words naming what, and nothing is written; a part with no connection set up is
 *      none, locked as none. And the two reads that took a failure for none: the banks' record (cashNow) and JobTread's
 *      costs with no copy kept (_makeover-costs.js makeoverCostsNow)
 * Made-up people only (the repo is public). Run: node --test tests/board-round15-extra.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { createD1 } from './lib/d1-shim.mjs';
import * as board from '../functions/api/_board.js';
import { signMinutes } from '../functions/api/_board-minutes-sign.js';
import { writeState, stateReady } from '../functions/api/_board-roles.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { callTool } from '../functions/api/_mcp-tools.js';
import * as shared from '../public/admin/board-shared.js';

Error.stackTraceLimit = 80;
const { cleanMeeting, todayEastern } = shared;
const ROOT = new URL('..', import.meta.url).pathname;
const src = (f) => readFileSync(`${ROOT}${f}`, 'utf8');
const day = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const Y0 = Number(day(0).slice(0, 4));
const FOUNDER = 'jane@soardcharity.com';
const SECRETARY = { slug: 'kim-park', name: 'Kim Park', email: 'kim@example.com', seat: 'secretary', title: 'Board Secretary' };
const MARK = { type: 'typed', style: 'dancing', text: 'Kim Park', initials: 'KP' };
const WRONG = /Something went wrong|Reload the page to see what was saved/i;

// ─── The database not answering a statement, or answering it and losing the answer ───
// `fault.test(sql, args, stack)` picks statements (each failing, every time), or `fault.k` the k-th one of a press (once):
// before it runs (`fail`), or after the database took it (`lost`). Board's own table setup is left out, as every sweep has it
let raw;
let fault = null;
const SETUP = /^\s*(CREATE|ALTER|PRAGMA)\b/i;
function hit(sql, args) {
  if (!fault || SETUP.test(String(sql || ''))) return false;
  const stack = new Error().stack;
  if (fault.test) { if (!fault.test(String(sql), args, stack)) return false; } else if (fault.seen++ !== fault.k) return false;
  fault.failed.push({ sql: String(sql), args, stack });
  return true;
}
const LOST = () => new Error('D1_ERROR: Network connection lost.');
const wrap = (st, args = []) => new Proxy(st, {
  get: (s, m) => (['all', 'first', 'run', 'raw'].includes(m) ? async (...a) => {
    if (!hit(s._sql, args)) return s[m](...a);
    if (fault.mode === 'lost') await s[m](...a);
    throw LOST();
  } : m === 'bind' ? (...a) => wrap(s.bind(...a), a) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
});
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => {
      let lost = false;
      for (const s of stmts) if (hit(s._sql, s._params || [])) { if (fault.mode !== 'lost') throw LOST(); lost = true; }
      const r = await raw.batch(stmts);
      if (lost) throw LOST();
      return r;
    }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});
/** Who read a statement: today's numbers (liveNumbers), or someone else */
const inLive = (stack) => /\bliveNumbers\b/.test(stack);
const sql = async (q, ...b) => (await raw.prepare(q).bind(...b).all()).results || [];
const count = async (q, ...b) => Number((await sql(q, ...b))[0]?.n || 0);
/**
 * A press swept: the control (k = -1), then every statement failing once in turn, then each landing with its answer lost.
 * `judge({ r, k, mode, failed })` → '' or what's wrong. → { problems, runs }
 */
async function sweep(bytes, press, judge, { modes = ['fail', 'lost'], max = 400 } = {}) {
  const problems = [];
  let runs = 0;
  for (const mode of modes) {
    for (let k = mode === 'fail' ? -1 : 0; k < max; k++) {
      raw = await createD1({ bytes });
      fault = k < 0 ? null : { k, seen: 0, failed: [], mode };
      let r;
      try { r = await press(); } catch (err) { r = { threw: err }; }
      const failed = fault?.failed?.[0] || null;
      fault = null;
      if (k >= 0 && !failed) break;
      runs += 1;
      const why = await judge({ r, k, mode, failed });
      if (why) problems.push(`${mode} k=${k} [${failed ? `${failed.sql.replace(/\s+/g, ' ').slice(0, 80)} ${JSON.stringify(failed.args).slice(0, 30)}` : 'control'}]: ${why}`);
    }
  }
  return { problems, runs };
}
const report = (out, least) => {
  console.log(`# swept: ${out.runs} runs, ${out.problems.length} wrong`);
  assert.ok(out.runs >= least, `only ${out.runs} runs`);
  assert.deepEqual(out.problems, [], `${out.problems.length} problems in ${out.runs} runs:\n${out.problems.join('\n')}`);
};

let env;
const objects = new Map();
const bucket = {
  put: async (k, v) => { objects.set(k, new Uint8Array(v)); },
  get: async (k) => (objects.has(k) ? { body: new Blob([objects.get(k)]).stream() } : null),
  delete: async (k) => { objects.delete(k); },
};
const realFetch = globalThis.fetch;
beforeEach(() => {
  fault = null;
  objects.clear();
  // (nothing outside answers: JobTread, the banks and QuickBooks are what the database keeps of them)
  globalThis.fetch = async () => new Response('{}', { status: 503 });
});
afterEach(() => { globalThis.fetch = realFetch; fault = null; env = null; });

// ─── 1: the secretary never signs minutes the board can't read ──────

const SIGN_ID = 'm_xsign0001';
const APPROVED_ON = todayEastern() >= shared.MINUTES_SIGN_FROM ? todayEastern() : shared.MINUTES_SIGN_FROM;
/** A shared meeting with its minutes approved: `file` 'staff' (their only file kept Staff only), 'shared', 'typed', 'none' */
async function signWorld({ file = 'staff', id = SIGN_ID, minutes = 'approved', approvedOn = APPROVED_ON } = {}) {
  await board.saveMeeting(env.DB, {
    id, date: day(-20), start: '08:00', end: '10:00', shared: true, location: 'The office',
    attendance: [{ slug: 'kim-park', name: 'Kim Park', kind: 'board', status: 'present' }],
    sections: [{ id: 's_a', title: 'New business', items: [{ id: 'i_a', title: 'Budget', notes: 'The budget passed.' }] }],
    ...(file === 'typed' ? { minutesFrom: { typed: true, name: 'Minutes typed on the board page', at: new Date().toISOString() } } : {}),
  }, { by: FOUNDER });
  if (file === 'staff' || file === 'shared' || file === 'typed') {
    const d = await PDFDocument.create(); d.addPage([612, 792]);
    await board.putFile(env, { ownerType: 'meeting', ownerId: id, file: new File([await d.save()], 'Minutes.pdf', { type: 'application/pdf' }), kind: 'minutes', staffOnly: file !== 'shared', by: FOUNDER });
  }
  if (minutes === 'approved') await board.patchMeeting(env.DB, id, (m) => ({ ...m, minutes: 'approved', approvedOn }), { by: FOUNDER });
  return board.getMeeting(env.DB, id);
}
async function signEnv() {
  raw = await createD1();
  env = { DB: hookedDB(), FILES: bucket };
  await board.ensureSchema(env.DB);
  await raw.prepare('CREATE TABLE IF NOT EXISTS team (slug TEXT PRIMARY KEY, data TEXT)').run();
  await raw.prepare('INSERT OR REPLACE INTO team (slug, data) VALUES (?, ?)').bind('kim-park', JSON.stringify({ name: 'Kim Park', group: 'board', status: 'active', seat: 'secretary' })).run();
}
const sign = (id = SIGN_ID) => signMinutes(env, id, SECRETARY, { mark: MARK, consent: true, evidence: { ip: '203.0.113.9', device: 'Mac · Safari' } })
  .then((s) => ({ status: 200, s }), (e) => ({ status: e.status || 'threw', message: e.message, extra: e.extra }));
/** Nothing of a signature: no signature, no event on the chain, no adopted mark nor agreement to sign electronically */
const nothingSigned = async () => ({
  signatures: await count('SELECT count(*) AS n FROM board_minutes_signed'),
  events: await count('SELECT count(*) AS n FROM board_sign_events'),
  marks: await count('SELECT count(*) AS n FROM board_member_marks'),
});
const NONE = { signatures: 0, events: 0, marks: 0 };

test('r15 extra 1: approved minutes whose only file is Staff only can’t be signed: refused in words, nothing signed, no event, no agreement; once a founder shares the file, they’re signed', async () => {
  await signEnv();
  const m = await signWorld();
  assert.ok(m.approvedFile, 'approved as their staff-only file');
  assert.equal(m.files.find((f) => f.id === m.approvedFile)?.staffOnly, true);
  assert.equal(shared.minutesToSign(m), false, 'the board page doesn’t ask');
  assert.equal(shared.minutesToSign(shared.forBoard(m)), false, 'nor on the board’s copy');
  const r = await sign();
  assert.equal(r.status, 409, JSON.stringify(r));
  assert.equal(r.message, 'These minutes’ file is staff only, so the board can’t read them yet. Once a founder shares it, you can sign.');
  assert.equal(r.message, shared.CANT_SIGN.staff);
  assert.deepEqual(await nothingSigned(), NONE, 'nothing signed, nothing on the chain, no agreement recorded');
  // A founder shares it (Board sees it): the same press signs
  await board.updateFile(env.DB, m.approvedFile, { staffOnly: false });
  assert.equal(shared.minutesToSign(await board.getMeeting(env.DB, SIGN_ID)), true);
  const ok = await sign();
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.s.name, 'Kim Park');
  assert.deepEqual(Object.fromEntries(Object.entries(await nothingSigned()).map(([k, v]) => [k, v > 0])), { signatures: true, events: true, marks: true });
});

test('r15 extra 1: the site signs exactly the minutes the board page asks for, by one function they both call', async () => {
  // Both go by minutesCantSign: the page's asking (minutesToSign) and the site's signing (signMinutes)
  const s = src('public/admin/board-shared.js');
  const ask = s.indexOf('export const minutesToSign');
  assert.match(s.slice(ask, s.indexOf('\n\n', ask)), /=> !minutesCantSign\(m\)/);
  const server = src('functions/api/_board-minutes-sign.js');
  assert.match(server, /const cant = minutesCantSign\(m\);\n\s*if \(cant\) throw no\(CANT_SIGN\[cant\], 409/);
  assert.doesNotMatch(server, /m\.minutes !== 'approved'|MINUTES_SIGN_FROM/, 'no rule of its own beside it');
  for (const w of Object.values(shared.CANT_SIGN)) { assert.ok(!/[–—]/.test(w), w); assert.ok(!/advisor/i.test(w), w); }
  // And it holds: every kind of minutes, the founders' copy and the board's, asked ⇔ signed
  const cases = [
    ['their only file Staff only', { file: 'staff' }, 'staff'],
    ['their file shared', { file: 'shared' }, ''],
    ['typed on the board page (the board reads their words), a staff-only file beside them', { file: 'typed' }, ''],
    ['approved with none in Board yet', { file: 'none' }, ''],
    ['draft, their file shared', { file: 'shared', minutes: 'draft' }, 'draft'],
    ['approved before signing began here', { file: 'shared', approvedOn: '2025-06-11' }, 'before'],
  ];
  for (const [what, opts, why] of cases) {
    await signEnv();
    const m = await signWorld(opts);
    assert.equal(shared.minutesCantSign(m), why, what);
    assert.equal(shared.minutesToSign(m), !why, `${what}: the page asks`);
    assert.equal(shared.minutesToSign(shared.forBoard(m)), !why, `${what}: the board’s copy alike`);
    const r = await sign();
    if (why) {
      assert.equal(r.status, 409, `${what}: ${JSON.stringify(r)}`);
      assert.equal(r.message, shared.CANT_SIGN[why], what);
      assert.deepEqual(await nothingSigned(), NONE, what);
    } else assert.equal(r.status, 200, `${what}: ${JSON.stringify(r)}`);
  }
});

test('r15 extra 1: signing staff-only approved minutes swept, every statement failing once in turn and each write landing with its answer lost: never signed, and the words are true', async () => {
  await signEnv();
  await signWorld();
  const bytes = raw._db.export();
  const out = await sweep(bytes, sign, async ({ r }) => {
    const now = await nothingSigned();
    if (JSON.stringify(now) !== JSON.stringify(NONE)) return `signed: ${JSON.stringify(now)}, answered ${r.status} “${r.message || ''}”`;
    if (WRONG.test(r.message || '')) return `said “${r.message}”`;
    if (r.status === 409 && r.message === shared.CANT_SIGN.staff) return '';
    if (r.status === 503 && r.message === board.NOTHING_SIGNED) return '';
    return `answered ${r.status} “${r.message || ''}”`;
  });
  report(out, 3);
});

// ─── 2 and 3: today's numbers, for the SOARD connection and a meeting's packet ───

/**
 * A site with every part of today's numbers there, from what the database keeps: the banks (Chase through Plaid), the
 * year's books (QuickBooks), JobTread's projects and what makeovers cost (the heartbeat's copies), the reveals' copy, a
 * kid served, an event and two meetings ahead; Board's settings name the founder and keep $150,000 to run SOARD.
 * `bare`: none of them set up, and no operating balance set
 */
async function numbersWorld({ bare = false } = {}) {
  raw = await createD1({ schemaFiles: [`${ROOT}scripts/schema.sql`] });
  env = { DB: hookedDB(), FILES: bucket };
  await board.ensureSchema(env.DB);
  await ensureApplicantSchema(env.DB);
  await stateReady(env.DB);
  const at = new Date().toISOString();
  await writeState(env.DB, 'settings', { quorum: 3, admins: [FOUNDER], invitesFrom: FOUNDER, ...(bare ? {} : { operatingBalance: 150000 }) });
  const next = await board.saveMeeting(env.DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', shared: true, sections: [{ title: 'Finance', items: [{ title: 'What makeovers cost', live: 'costs' }] }] }), { by: FOUNDER });
  await board.saveMeeting(env.DB, cleanMeeting({ date: day(100), start: '08:00', end: '10:00', shared: true, sections: [{ title: 'Agenda', items: [{ title: 'Roll call' }] }] }), { by: FOUNDER });
  if (!bare) {
    await raw.prepare('INSERT INTO kids (slug, name, year, status, data) VALUES (?, ?, ?, ?, ?)').bind(`ava-${Y0 - 1}`, 'Ava', Y0 - 1, 'completed', JSON.stringify({ name: 'Ava', year: Y0 - 1, status: 'completed', childCount: 1, roomCount: 1 })).run();
    await raw.prepare('INSERT INTO events (slug, title, date, data) VALUES (?, ?, ?, ?)').bind('spring-gala', 'The Spring Gala', day(40), JSON.stringify({ title: 'The Spring Gala', date: day(40), location: 'Example Hall' })).run();
    await raw.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: [{ slug: `maya-${Y0}`, name: 'Maya', confirmed: true, date: day(12), time: '10:00', kidUrl: `/kids/maya-${Y0}/` }], updatedAt: at })).run();
    await raw.exec('CREATE TABLE IF NOT EXISTS bank_links (item_id TEXT PRIMARY KEY, institution_id TEXT, institution TEXT, access_token TEXT NOT NULL, accounts TEXT, read_at TEXT, tried_at TEXT, error TEXT, error_at TEXT, told TEXT, linked_at TEXT, linked_by TEXT)');
    await raw.prepare('INSERT INTO bank_links (item_id, institution, access_token, accounts, read_at, linked_at) VALUES (?, ?, ?, ?, ?, ?)').bind('item-example', 'Chase', 'access-example', JSON.stringify([{ name: 'Total Checking', type: 'depository', subtype: 'checking', current: 375000, mask: '0001' }]), at, at).run();
    await raw.exec('CREATE TABLE IF NOT EXISTS books_link (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, company TEXT, fiscal_start INTEGER, access_token TEXT, access_expires TEXT, refresh_token TEXT NOT NULL, refresh_expires TEXT, ytd TEXT, read_at TEXT, tried_at TEXT, error TEXT, error_at TEXT, error_detail TEXT, told TEXT, linked_at TEXT, linked_by TEXT)');
    await raw.prepare('INSERT INTO books_link (id, realm_id, company, refresh_token, ytd, read_at) VALUES (?, ?, ?, ?, ?, ?)').bind('qbo', 'realm-example', 'Example Charity', 'refresh-example', JSON.stringify({ year: Y0, from: `${Y0}-01-01`, through: day(-1), revenue: 1200000, spent: 900000, net: 300000, basis: 'Accrual' }), at).run();
    const done = (key, name, season, cost) => ({ key, name, slug: null, kind: 'kid', season, rooms: ['Bedroom'], roomCount: 1, type: 'bedroom', cost, jobs: 1, closed: `${season}-10-01` });
    await writeState(env.DB, 'costs', { at, value: { at, makeovers: [done('k:ava', 'Ava', Y0, 21500), done('k:ben', 'Ben', Y0 - 1, 26400)], noBills: [], reveals: [], skipped: 0,
      underway: [{ revealOn: null, season: Y0, key: 'u:eve', name: 'Eve', jobId: null, kind: 'kid', status: 'Build', rooms: ['Bedroom'], type: 'bedroom', paid: 8200, budget: 23000 }], waiting: [] } });
    await writeState(env.DB, 'projects', { at, value: { byStatus: { Build: 1 }, building: [{ jobId: 'j1', name: 'Maya', slug: `maya-${Y0}`, status: 'Build' }], waiting: [], open: { j1: 'Build' } } });
  }
  // (one read first, as a running site has had: the tables each part makes on its first read are there; and no copy of
  // the cash kept within the hour, so the banks are read)
  await callTool(env, 'soard_numbers', {}, FOUNDER);
  await raw.prepare("DELETE FROM board_state WHERE key = 'cash'").run();
  return { next, bytes: raw._db.export() };
}
/** Each of today's numbers' reads, failing alone: [the read (NAMES), (sql, args, stack) → true, the tool's fields it gives] */
const READS = [
  ['kids', (q) => /^SELECT slug, data FROM kids/.test(q), ['impact']],
  ['events', (q) => /FROM events/.test(q), ['events', 'recentEvents']],
  ['meetings', (q, a, st) => /FROM board_meetings ORDER BY date DESC/.test(q) && inLive(st), ['boardMeetings']],
  ['costs', (q, a) => /FROM board_state WHERE key/.test(q) && a[0] === 'costs', ['makeoverCosts']],
  ['projects', (q, a) => /FROM board_state WHERE key/.test(q) && a[0] === 'projects', ['projects']],
  ['reveals', (q, a) => /FROM site_config WHERE key/.test(q) && a[0] === 'reveals', ['reveals', 'recentReveals']],
  ['cash', (q) => /FROM bank_links/.test(q), ['cash']],
  ['books', (q) => /FROM books_link/.test(q), ['books']],
  ['operating', (q, a, st) => /FROM board_state WHERE key/.test(q) && a[0] === 'settings' && inLive(st), ['operatingBalance']],
];
const FIELDS = { ...Object.fromEntries(READS.map(([read, , fields]) => [read, fields])), finance: ['finance'] };
/** Each read by what it is, as an answer names one it couldn't read (functions/api/_board.js NUMBERS_READS) */
const NAMES = {
  cash: 'the bank balances', finance: 'Mercury’s record of money in and out', books: 'the year’s books from QuickBooks', projects: 'the makeovers in JobTread',
  reveals: 'the reveals', events: 'the events', meetings: 'the board’s meetings', kids: 'the kids served', costs: 'the makeover costs', operating: 'the operating balance kept to run SOARD',
};
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const couldnt = (read) => `${upper(NAMES[read])} couldn’t be read just now. Ask again in a moment.`;
/** soard_numbers, as the founder asks it through the SOARD connection */
const numbers = async (who = FOUNDER) => {
  const r = await callTool(env, 'soard_numbers', {}, who);
  assert.ok(!r.isError, r.content?.[0]?.text);
  return r.structuredContent;
};
/** What a read gave, without when it was read (the cash's `at` is the moment it's read) */
const stable = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v, (k, x) => (k === 'at' ? undefined : x))));
const without = (o, ...keys) => stable(Object.fromEntries(Object.entries(o).filter(([k]) => !['asOf', 'note', ...keys].includes(k))));

test('r15 extra 2: soard_numbers with Board’s settings not read gives no operating balance, never SOARD’s default: it says it couldn’t be read, by name', async () => {
  const w = await numbersWorld();
  raw = await createD1({ bytes: w.bytes });
  const control = await numbers();
  assert.deepEqual(control.operatingBalance, { balance: 150000 }, 'read: the one Board keeps');
  assert.equal(control.couldntRead, undefined);
  assert.ok(control.makeoverCosts?.lastTwoSeasons, 'what makeovers cost, read');
  assert.ok(control.cash?.total === 375000 && control.books?.revenue === 1200000, JSON.stringify([control.cash, control.books]));
  // Only today's numbers' read of the settings (who runs Board is read apart, and answers)
  raw = await createD1({ bytes: w.bytes });
  fault = { test: (q, a, st) => /FROM board_state WHERE key/.test(q) && a[0] === 'settings' && inLive(st), failed: [] };
  const out = await numbers();
  const failed = fault.failed.length;
  fault = null;
  assert.equal(failed, 1, 'the settings’ read was made, and failed');
  assert.equal(out.operatingBalance, 'The operating balance kept to run SOARD couldn’t be read just now. Ask again in a moment.');
  assert.deepEqual(out.couldntRead, ['The operating balance kept to run SOARD']);
  assert.doesNotMatch(JSON.stringify(out), /500000|500,000/, 'never the default');
  assert.match(out.note, /never give a figure for it/);
  // The rest as read: what makeovers cost (JobTread's figures, read), the money, the makeovers
  assert.deepEqual(without(out, 'operatingBalance', 'couldntRead'), without(control, 'operatingBalance'));
});

test('r15 extra 2: soard_numbers, each read failing alone: its figures say they couldn’t be read, by name; the rest as read', async () => {
  const w = await numbersWorld();
  raw = await createD1({ bytes: w.bytes });
  const control = await numbers();
  for (const [read, when, fields] of READS) {
    raw = await createD1({ bytes: w.bytes });
    fault = { test: when, failed: [] };
    const out = await numbers();
    const failed = fault.failed.length;
    fault = null;
    assert.ok(failed >= 1, `${read}: its read was made, and failed`);
    for (const f of fields) assert.equal(out[f], couldnt(read), `${read}: ${f} ${JSON.stringify(out[f])?.slice(0, 120)}`);
    assert.deepEqual(out.couldntRead, [upper(NAMES[read])], read);
    assert.deepEqual(without(out, ...fields, 'couldntRead'), without(control, ...fields), `${read}: the rest as read`);
  }
});

test('r15 extra 2: soard_numbers says what simply isn’t set as that, in words, never as a read that failed', async () => {
  const w = await numbersWorld({ bare: true });
  raw = await createD1({ bytes: w.bytes });
  const out = await numbers();
  assert.equal(out.couldntRead, undefined, 'nothing failed');
  assert.equal(out.operatingBalance, 'Not set in Board’s settings, so the board page goes by SOARD’s default, $500,000, until a Board admin sets one.');
  assert.equal(out.cash, 'No bank balance here: no bank is connected to the site, or the banks connected hold nothing yet.');
  assert.equal(out.books, 'None here: QuickBooks isn’t connected to the site, or hasn’t been read yet.');
  assert.equal(out.makeoverCosts, 'None here: JobTread isn’t connected to the board page, so what makeovers cost isn’t known.');
  assert.equal(out.projects, 'None here: JobTread isn’t connected to the board page, so the makeovers under way aren’t known.');
  assert.deepEqual([out.reveals, out.events], [[], []]);
  for (const v of Object.values(out)) if (typeof v === 'string') { assert.ok(!/[–—]/.test(v), v); assert.ok(!/couldn’t be read/.test(v), v); }
});

test('r15 extra 2: who runs Board not checked just now: soard_numbers says the money wasn’t given and why, never that they aren’t one', async () => {
  const w = await numbersWorld();
  raw = await createD1({ bytes: w.bytes });
  fault = { test: (q, a, st) => /FROM board_state WHERE key/.test(q) && a[0] === 'settings' && !inLive(st), failed: [] };
  const out = await numbers();
  fault = null;
  assert.equal(out.money, 'Whether you’re one of the Board area’s admins couldn’t be checked just now, so the bank balance and the year’s books aren’t given here. Ask again in a moment.');
  for (const f of ['cash', 'books', 'finance', 'operatingBalance']) assert.equal(out[f], undefined, f);
  // (someone who isn't one: as before)
  raw = await createD1({ bytes: w.bytes });
  assert.equal((await numbers('lee@soardcharity.com')).money, 'The bank balance and the year’s books show only to the Board area’s admins, as on the board page.');
});

test('r15 extra 2: soard_numbers swept, every statement failing once in turn and each landing with its answer lost: no figure from a read that failed, each said by name', async () => {
  const w = await numbersWorld();
  raw = await createD1({ bytes: w.bytes });
  const control = await numbers();
  const out = await sweep(w.bytes, () => callTool(env, 'soard_numbers', {}, FOUNDER), async ({ r, failed }) => {
    if (r.threw || r.isError) return `refused: ${r.threw?.message || r.content?.[0]?.text}`;
    const o = r.structuredContent;
    const said = new Set(o.couldntRead || []);
    const wrong = [];
    for (const [read, fields] of Object.entries(FIELDS)) {
      const named = said.has(upper(NAMES[read]));
      for (const f of fields) {
        if (o.money && ['cash', 'books', 'finance', 'operatingBalance'].includes(f)) continue;
        if (named ? o[f] !== couldnt(read) : JSON.stringify(stable(o[f])) !== JSON.stringify(stable(control[f]))) wrong.push(`${f}: ${JSON.stringify(o[f])?.slice(0, 80)}`);
      }
    }
    // (a decided read that failed is always named; who runs Board not checked says so)
    for (const [read, when] of READS) if (failed && when(failed.sql, failed.args, failed.stack) && !said.has(upper(NAMES[read]))) wrong.push(`${read} failed and wasn’t named`);
    if (o.money && !/couldn’t be checked just now/.test(o.money)) wrong.push(`money: ${o.money}`);
    if (/500000|500,000/.test(JSON.stringify(o))) wrong.push('the default operating balance');
    return wrong.join('; ');
  });
  report(out, 20);
});

const snapshotOf = async (id) => JSON.parse((await sql('SELECT data FROM board_meetings WHERE id = ?', id))[0].data).snapshot || null;
const lock = (id) => board.takeSnapshot(env, id, { by: FOUNDER }).then((m) => ({ status: 200, m }), (e) => ({ status: e.status || 'threw', message: e.message, unread: !!e.unread }));
const same = (s) => s && JSON.stringify(stable(s));

test('r15 extra 3: a meeting’s numbers are locked only once every part was read: each read failing alone refuses it in words naming what, and nothing is written', async () => {
  const w = await numbersWorld();
  raw = await createD1({ bytes: w.bytes });
  const control = await lock(w.next.id);
  assert.equal(control.status, 200, JSON.stringify(control));
  const locked = await snapshotOf(w.next.id);
  assert.equal(locked.operating.balance, 150000);
  assert.ok(locked.cash && locked.books && locked.costs && locked.projects && locked.impact && locked.reveals.length && locked.events.length && locked.meetings.length);
  for (const [read, when] of READS) {
    raw = await createD1({ bytes: w.bytes });
    fault = { test: when, failed: [] };
    const r = await lock(w.next.id);
    const failed = fault.failed.length;
    fault = null;
    assert.ok(failed >= 1, `${read}: its read was made, and failed`);
    assert.equal(r.status, 503, `${read}: ${JSON.stringify(r)}`);
    assert.equal(r.unread, true);
    assert.equal(r.message, `We couldn’t read ${NAMES[read]} just now, so nothing was changed. Please try again in a moment.`);
    assert.equal(await snapshotOf(w.next.id), null, `${read}: nothing written`);
  }
  // The brief's own words, for what makeovers cost
  raw = await createD1({ bytes: w.bytes });
  fault = { test: READS.find(([r]) => r === 'costs')[1], failed: [] };
  assert.equal((await lock(w.next.id)).message, 'We couldn’t read the makeover costs just now, so nothing was changed. Please try again in a moment.');
  fault = null;
  // Two at once: both named
  raw = await createD1({ bytes: w.bytes });
  fault = { test: (q, a, st) => READS.find(([r]) => r === 'operating')[1](q, a, st) || READS.find(([r]) => r === 'events')[1](q, a, st), failed: [] };
  assert.equal((await lock(w.next.id)).message, 'We couldn’t read the events and the operating balance kept to run SOARD just now, so nothing was changed. Please try again in a moment.');
  fault = null;
  assert.deepEqual(board.NUMBERS_READS, NAMES, 'one name for each read, the press’s and the connection’s');
  for (const w2 of Object.values(NAMES)) { assert.ok(!/[–—]/.test(w2), w2); assert.ok(!/advisor/i.test(w2), w2); }
});

test('r15 extra 3: a part with no connection set up isn’t a failure: the numbers lock with it as none', async () => {
  const w = await numbersWorld({ bare: true });
  raw = await createD1({ bytes: w.bytes });
  const n = await board.liveNumbers(env, { reads: true });
  assert.deepEqual([n.unread, n.notRead], [{}, {}], 'nothing marked');
  assert.deepEqual([n.cash, n.books, n.costs, n.projects, n.finance], [null, null, null, null, null]);
  assert.deepEqual(n.operating, { balance: 500000, set: false });
  const r = await lock(w.next.id);
  assert.equal(r.status, 200, JSON.stringify(r));
  const s = await snapshotOf(w.next.id);
  assert.deepEqual([s.cash, s.books, s.costs, s.projects], [null, null, null, null]);
  assert.deepEqual(s.operating, { balance: 500000, set: false });
});

test('r15 extra 3: JobTread not answering with no copy kept is a read that failed, never JobTread not set up (its projects were already so; what makeovers cost too now)', async () => {
  const w = await numbersWorld({ bare: true });
  raw = await createD1({ bytes: w.bytes });
  env.JOBTREAD_GRANT_KEY = 'jt-example';
  const n = await board.liveNumbers(env, { reads: true });
  assert.equal(n.unread.costs, true, `what makeovers cost: ${JSON.stringify(n.unread)}`);
  assert.deepEqual(n.notRead, { projects: true, costs: true });
  const r = await lock(w.next.id);
  assert.equal(r.status, 503, JSON.stringify(r));
  assert.equal(r.message, 'We couldn’t read the makeovers in JobTread and the makeover costs just now, so nothing was changed. Please try again in a moment.');
  assert.equal(await snapshotOf(w.next.id), null);
  const out = await numbers();
  assert.deepEqual([out.makeoverCosts, out.projects], [couldnt('costs'), couldnt('projects')]);
});

test('r15 extra 3: the banks’ record not read is a read that failed, never no bank connected (Mercury’s alone, or none, said as SOARD’s cash)', async () => {
  const w = await numbersWorld();
  raw = await createD1({ bytes: w.bytes });
  fault = { test: (q) => /FROM bank_links/.test(q), failed: [] };
  const n = await board.liveNumbers(env, { reads: true });
  fault = null;
  assert.equal(n.unread.money, true, JSON.stringify(n.unread));
  assert.deepEqual(n.notRead, { cash: true });
  assert.equal(n.cash, null);
  // (and no copy kept of a total that wasn't read: the next read reads the banks again)
  assert.equal((await sql("SELECT data FROM board_state WHERE key = 'cash'")).length, 0);
  assert.equal((await board.liveNumbers(env)).cash?.total, 375000);
});

test('r15 extra 3: locking the numbers swept, every statement failing once in turn and each landing with its answer lost: refused with nothing written, or locked with only what was read', async () => {
  const w = await numbersWorld();
  raw = await createD1({ bytes: w.bytes });
  assert.equal((await lock(w.next.id)).status, 200);
  const control = await snapshotOf(w.next.id);
  // (a statement failing before the numbers, the meeting's own read: the database's error, which the route says in words,
  // round 14's sweep of the press; here, what's locked)
  const out = await sweep(w.bytes, () => lock(w.next.id), async ({ r }) => {
    const s = await snapshotOf(w.next.id);
    if (WRONG.test(r.message || '')) return `said “${r.message}”`;
    if (s) return same(s) === same(control) ? '' : `locked what wasn’t read: ${JSON.stringify(s).slice(0, 200)}`;
    if (r.status === 200) return 'answered locked, nothing written';
    if (r.unread && !/^We couldn’t read .+ just now, so nothing was changed\. Please try again in a moment\.$/.test(r.message)) return `refused: “${r.message}”`;
    return '';
  });
  report(out, 20);
});
