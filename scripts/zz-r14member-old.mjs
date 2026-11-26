/**
 * test-board-round14-member.mjs: the board page as members see it, as QA round 14 found it (Nov 24 2026)
 * ====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round13-member.mjs
 * does (its world, and the members' own presses for what each part carries: Sam's line note, his file on his item, his
 * corrections to draft minutes, his signed paper; Taylor's signature on approved minutes); JobTread, Mercury, Zeffy,
 * Google and Resend faked. Made-up people and money.
 *   Z1  The corrections not read: "Suggest a correction" waits in place with words saying why, never offered from an
 *       empty list; read, his waiting one shows with Take it back; a correction that replaces his waiting one says so
 *   Z2  The notes on the lines not read: the report page never says "No notes on these numbers yet." beside "couldn't load"
 *   Z3  Every route with every part of the page's read failing in turn (each part's own statement, failing every time):
 *       the route opens; its lede never rewrites itself; no empty state appears; anything that changed is said in its
 *       place (data-unread for that part), and the part is one the route declares (public/admin/board/unread.js ROUTE_PARTS)
 *   Z4  The month-end balances not read: Home's and Financials' cash tiles and the Cash in the bank card say the change on
 *       a year couldn't load where it was
 *   Z5  A budget sheet headed "Fiscal Year 2026 Budget", "FY-2026" or "FY-26": the tiles and heading say FY2026, every
 *       spelling typed in search finds it
 *   Z6  No year in the sheet: search says "The revenue budget", as the tile says "Revenue", never a year
 *   Z7  The board's settings not read (quorum 3 in Settings): the meeting's page, Print it all and the secretary's printed
 *       form say the quorum isn't said here, never a majority guessed
 *   Z8  An account at $0, and one at −$0.30: Financials and the meeting's tile list each as $0, search finds each by name
 *   Z9  The other presses offered from a part that may not have loaded: a report's slides reordered without the money's
 *       slides, the secretary's "Take notes here" with the notes waiting unread
 * Screenshots land in test-results/board-round14-member/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round14-member.mjs        (ONLY=Z1,Z3 runs those steps alone; PORT=5371 a port of its own;
 *                                                      PARTS=meetings,docs and WHO=sam narrow Z3)
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, patchMeeting, getMeeting, provideBoardFinance, ensureSchema, putFile, saveDoc } from '../functions/api/_board.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import { writeState } from '../functions/api/_board-roles.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { maybeReadGifts } from '../functions/api/_board-gifts.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting } from '../public/admin/board-shared.js';
import { deflateRawSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round14-member/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (whole days from today in Eastern time, counted from noon: the hour daylight saving moves never changes a date, as it
// did from 11 PM in late November, "October 26" a moment ago becoming "October 27" between a route's two walks)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const Y0 = Number(day(0).slice(0, 4));
const TODAY_MD = new Date(`${day(0)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const MONTH_NOW = new Date(`${day(0).slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const FOUNDER = 'jane@soardcharity.com';
const SAM = 'sam.board@example.org';
const MARIA = 'maria.board@example.com';
const TAYLOR = 'taylor.board@example.net';
const ALEX = 'alex.board@example.com';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', order: 3 },
  'maria-de-la-cruz-whitfield': { name: 'Maria-Fernanda de la Cruz Whitfield', group: 'board', title: 'Board Member', order: 4 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 5 },
};
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['maria-de-la-cruz-whitfield', MARIA]];
const BOARD = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen', 'maria-de-la-cruz-whitfield', 'kim-park'];

// ── Sign-in: an RS256 Access token made here, for whoever the request says it is ──
const certsKey = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', certsKey.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
async function tokenFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: 'https://soard.cloudflareaccess.com', aud: ['aud-tag'], email, iat: now, nbf: now, exp: now + 3600 }));
  return `${h}.${p}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', certsKey.privateKey, new TextEncoder().encode(`${h}.${p}`))))}`;
}
class FakeR2 {
  constructor() { this.map = new Map(); }
  async put(key, bytes, opts) { const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes?.arrayBuffer ? new Uint8Array(await bytes.arrayBuffer()) : new Uint8Array(bytes); this.map.set(key, { bytes: b, type: opts?.httpMetadata?.contentType }); }
  async get(key) { const o = this.map.get(key); return o ? { body: o.bytes, size: o.bytes.length, httpMetadata: { contentType: o.type }, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength) } : null; }
  async head(key) { const o = this.map.get(key); return o ? { size: o.bytes.length, httpMetadata: { contentType: o.type } } : null; }
  async delete(key) { this.map.delete(key); }
}

// ── The database ──
const DB = await createD1();
for (const sql of [
  'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)',
  'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
  'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE partners (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  'CREATE TABLE applications (id TEXT PRIMARY KEY, jt_account_id TEXT, lang TEXT, jt_state TEXT, files TEXT, is_test INTEGER DEFAULT 0, submitted_at TEXT, kind TEXT, deleted_at TEXT)',
]) await DB.exec(sql);
for (const [slug, d] of Object.entries(PEOPLE)) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
for (const [slug, email] of EMAILS) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
await ensureSchema(DB);
await ensureApplicantSchema(DB);
// The tax return's year, as Site → Financials keeps it (Financials' "2025 at a glance")
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('financial-snapshot', JSON.stringify({ year: Y0 - 1, totalRevenue: 1000000, totalExpenses: 900000, programExpenses: 750000, managementExpenses: 90000, fundraisingExpenses: 60000, netAssets: 400000, contributions: 600000, storeRevenue: 300000, programPct: 83, managementPct: 9, fundraisingPct: 8 })).run();
for (const [slug, name] of [[`maya-${Y0}`, 'Maya'], [`leo-${Y0}`, 'Leo']]) await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, Y0, JSON.stringify({ name, year: Y0, childCount: 1, roomCount: 1 })).run();
await DB.prepare(`INSERT INTO applicants (account_id, name, status, year, types, fields, address, city, county, lat, lng, area, area_miles, contact_name, contact_email, contact_phone, contacts, photo_url, created_at, synced_at, job_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind('acctIris01', 'Iris Example', 'Approved', String(Y0 + 1), JSON.stringify(['Therapy Room']), JSON.stringify({ diagnosis: 'An example diagnosis', birthday: '2017-05-01', mobile: 'No', verbal: 'Yes', language: 'English' }), '12 Elm St, Roswell, GA 30075', 'Roswell', 'Fulton', 34.02, -84.36, 'inside', 0, 'Parent Example', 'parent@example.com', '4045550100', '[]', null, `${day(-9)}T14:00:00Z`, new Date().toISOString(), null).run();
// (round 13: a family with a makeover in JobTread, Maya's, and SOARD's facts as Site Config keeps them, made up)
await DB.prepare('INSERT INTO applicants (account_id, name, status, year, types, fields, created_at, synced_at, job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .bind('acctMaya01', 'Maya Example', 'Approved', String(Y0), JSON.stringify(['Bedroom']), JSON.stringify({ diagnosis: 'An example diagnosis', birthday: '2016-03-01', language: 'English' }), `${day(-80)}T14:00:00Z`, new Date().toISOString(), 'j1').run();
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('settings', JSON.stringify({ name: 'Example Charity', legalName: 'Example Charity Incorporated', ein: '12-3456789', phone: '404-555-0100', email: 'hello@example.org', address: { street: '1 Example Way', city: 'Roswell', state: 'GA', zip: '30075' } })).run();
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('media', JSON.stringify({ mission: 'Dream rooms for kids.', bio: { founded: '2008', boilerplate: 'An example charity.' } })).run();
await DB.prepare('INSERT INTO community (slug, name, data) VALUES (?, ?, ?)').bind('example-center', 'Example Center', JSON.stringify({ name: 'Example Center', year: Y0, roomCount: 2 })).run().catch(() => {});

// ── QuickBooks: the year so far, last year, the statements and the budget, as its read keeps them (made up) ──
const cat = (key, name, amount, accounts = [name]) => ({ key, name, amount, accounts });
// (with cents, as QuickBooks' reports have them: the tester's QA_CENTS)
const SOURCES = [
  cat('donations', 'Donations', 700000.45, ['Individual/Corporate Revenue']), cat('store', 'Store sales', 415000.45, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000.45, ['Gala Income']),
  cat('inkind', 'In kind', 220000.3, ['In-Kind Contribution']), cat('grants', 'Grants', 90000.45, ['Grant Revenue']), cat('account:golf classic', 'Golf Classic', 30000.45, ['Golf Classic Income']),
  cat('account:rent', 'Rent', 16000.45, ['Rent Income']), cat('account:interest', 'Interest', 5000.45, ['Interest Income']), cat('account:makeover', 'Makeover', 45.5, ['Makeover Revenue']),
];
const r2 = (n) => Math.round(n * 100) / 100;
const L = (k, label, d, a, p) => ({ k, label, d, a, p });
const SMALL = {
  position: [L('head', 'Assets', 0), L('total', 'Total Bank Accounts', 1, 608532, 655431), L('total', 'TOTAL ASSETS', 0, 870767, 794994)],
  activity: [L('head', 'Income', 0), L('acct', '4210 Store Discounts', 1, -12000, -9000), L('total', 'Total Income', 0, 1884217, 1909703), L('sum', 'Net Income', 0, 189248, 176000)],
  budget: [{ k: 'head', label: 'Income', d: 0 }, { k: 'acct', label: 'Individual/Corporate Revenue', d: 1, a: 700000, b: 500000, y: 600000 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, b: 150000, y: 180000 }],
};
await DB.exec('CREATE TABLE IF NOT EXISTS books_link (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, company TEXT, fiscal_start INTEGER, access_token TEXT, access_expires TEXT, refresh_token TEXT NOT NULL, refresh_expires TEXT, ytd TEXT, read_at TEXT, tried_at TEXT, error TEXT, error_at TEXT, error_detail TEXT, told TEXT, linked_at TEXT, linked_by TEXT)');
await DB.exec('CREATE TABLE IF NOT EXISTS books_daily (id TEXT PRIMARY KEY, data TEXT, day TEXT, read_at TEXT, tried_at TEXT, error TEXT)');
/**
 * QuickBooks' read as it's kept: `sources` the year's categories (and the revenue they add up to); `budget` false: no
 * budget for the year in QuickBooks (QA round 11's QA_NOBUDGET); where the year's money went, by purpose
 */
async function setBooks({ sources = SOURCES, revenue = null, budget = true, dep = false } = {}) {
  const yr = Y0;
  const rev = revenue ?? r2(sources.reduce((t, x) => t + x.amount, 0));
  // (`dep`: $8,000 of depreciation among the expenses that never left the bank, beside the $220,000.30 in kind: the
  // tester's QA_SOURCES=sh-dep.json)
  const ytd = { year: String(yr), from: `${yr}-01-01`, through: day(0), revenue: rev, spent: 1200000.6, net: r2(rev - 1200000.6), basis: 'Accrual', nonCash: dep ? 228000.3 : 220000.3, sources,
    store: { sales: 415000.45, cost: 250000.5, profit: 164999.95, salesAccounts: ['Store Income', 'Store Discounts'], costAccounts: ['Store COGS'] } };
  const lastBooks = { year: String(yr - 1), through: `${yr - 1}${day(0).slice(4)}`, revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, full: { revenue: 2000000, expenses: 1500000, net: 500000, nonCash: 100000 },
    sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)],
    store: { sales: 830000, cost: 380000, profit: 450000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
  const readAt = new Date().toISOString();
  await DB.prepare('INSERT OR REPLACE INTO books_link (id, realm_id, company, refresh_token, ytd, read_at, tried_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('qbo', '9130350000000001', 'Example Charity', 'refresh-test', JSON.stringify(ytd), readAt, readAt).run();
  const thisMonth = Number(day(0).slice(5, 7));
  const monthly = { year: String(yr), lastYear: String(yr - 1),
    months: Array.from({ length: thisMonth }, (_, i) => ({ month: `${yr}-${String(i + 1).padStart(2, '0')}`, revenue: Math.round(rev / thisMonth), spent: Math.round(1200000 / thisMonth), nonCash: Math.round(220000 / thisMonth) })),
    last: Array.from({ length: 12 }, (_, i) => ({ month: `${yr - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000, spent: 125000, nonCash: 8000 })) };
  const statements = { asOf: day(-30), closed: false, priorAsOf: `${yr - 1}${day(-30).slice(4)}`, position: SMALL.position, activity: SMALL.activity };
  const bud = budget ? { name: `Budget_FY${String(yr).slice(2)}_P&L`, from: `${yr}-01-01`, to: `${yr}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 }, rows: SMALL.budget } : null;
  const functions = { list: [{ name: 'Programs', amount: 820000.45 }, { name: 'Management', amount: 110000.45 }, { name: 'Fundraising', amount: 40000.45 }, { name: 'Events', amount: 10000.45 }], total: 980001.8 };
  await DB.prepare('INSERT OR REPLACE INTO books_daily (id, data, day, read_at, tried_at) VALUES (?, ?, ?, ?, ?)').bind('qbo', JSON.stringify({ shape: 3, day: day(0), lastYear: lastBooks, trailing: null, months: [], statements, functions, monthly, budget: bud }), day(0), readAt, readAt).run();
}
await setBooks();
/** No QuickBooks: Mercury's record is the year */
async function noBooks() { await DB.exec('DELETE FROM books_link'); await DB.exec('DELETE FROM books_daily'); }
/**
 * The cash at each month's end as the heartbeat keeps it (made up, QA round 11's QA_CASHHIST): 13 months, changes both
 * ways, this month's row stamped with the time it was read, a full ISO time
 */
async function setHistory(on = true) {
  await DB.exec('DELETE FROM board_cash');
  if (!on) return;
  const totals = [340000, 351000, 339750, 360000, 340000, 352500, 362500, 342500, 355000, 365000, 345000, 370000, 375000];
  const base = new Date(`${day(0).slice(0, 7)}-15T12:00:00Z`);
  for (let i = 0; i < totals.length; i++) {
    const d = new Date(base); d.setUTCMonth(d.getUTCMonth() - (totals.length - 1 - i));
    const ym = d.toISOString().slice(0, 7);
    await DB.prepare('INSERT OR REPLACE INTO board_cash (month, total, accounts, at) VALUES (?, ?, ?, ?)').bind(ym, totals[i], '[]', i === totals.length - 1 ? new Date().toISOString() : `${ym}-28T12:00:00Z`).run();
  }
}
await setHistory(true);

// What makeovers cost, as the heartbeat keeps it from JobTread (made-up families and costs)
{
  const now = new Date().toISOString();
  const done = (key, name, season, rooms, cost) => ({ key, name, slug: null, kind: 'kid', season, rooms, roomCount: rooms.length, type: rooms.length > 1 ? 'mixed' : /Bath/.test(rooms[0]) ? 'bathroom' : /Therapy/.test(rooms[0]) ? 'therapy' : 'bedroom', cost, jobs: 1, closed: `${season}-10-01` });
  await writeState(DB, 'costs', { at: now, value: {
    at: now,
    makeovers: [done('k:ava-ex', 'Ava', Y0, ['Bedroom'], 21500), done('k:ben-ex', 'Ben', Y0, ['Bathroom'], 34250), done('k:cal-ex', 'Cal', Y0 - 1, ['Therapy Room'], 18750), done('k:dee-ex', 'Dee', Y0 - 1, ['Bedroom'], 26400)],
    noBills: [], reveals: [], skipped: 0,
    underway: [{ revealOn: null, season: Y0, key: 'u:jEve', name: 'Eve', jobId: null, kind: 'kid', status: 'Build', rooms: ['Bedroom'], type: 'bedroom', paid: 8200, budget: 23000 }],
    waiting: [{ key: 'k:fay-ex', name: 'Fay', slug: null, kind: 'kid', season: Y0 + 1, rooms: ['Bedroom'], type: 'bedroom', jobId: 'jFay', sponsors: [], since: day(-60) }],
  } });
}

// This year's major gifts from a pretend Zeffy (made-up givers)
const zeffyPay = (id, daysAgo, dollars, o = {}) => ({ id, created: Math.floor((Date.now() - daysAgo * 864e5) / 1000), amount: dollars * 100, currency: 'usd', status: 'succeeded', type: 'online', refund_status: 'none', refunds: [], description: 'Evening of Sunshine', buyer: { first_name: 'Dana', last_name: 'Example', email: 'dana@example.com', is_corporate: false }, buyer_questions: [], items: [], recurring: null, ...o });
await maybeReadGifts({ DB, ZEFFY_API_KEY: 'zk-test' }, { fetchImpl: async () => Response.json({ object: 'list', data: [
  zeffyPay('pay_q0001', 1, 25000, { buyer: { first_name: 'Lee', last_name: 'Sample', is_corporate: true, company_name: 'The Sample Family Foundation' } }),
  zeffyPay('pay_q0002', 2, 5000, { description: 'Help build Maya’s room' }),
  ...Array.from({ length: 3 }, (_, i) => zeffyPay(`pay_q01${i}0`, 10 + i * 9, 1000 + i * 750, { buyer: { first_name: ['Robin', 'Casey', 'Jordan'][i], last_name: 'Example', email: `giver${i}@example.com`, is_corporate: false } })),
], has_more: false, next_cursor: null }) });

// ── The outside world, faked ──
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPw8PAAAAMkAVHY5VgwAAAAAElFTkSuQmCC', 'base64');
// The database the handlers read through: always the same object (so each module's "schema ready" holds), forwarding
// to the database of the moment (X8 puts the base state back before each read), with the k-th statement of a read
// failing once when armed (D1's own words), as the privacy tester's sweep does
let curDB = DB;
const plan = { armed: false, k: -1, seen: 0, failed: [] };
const SCHEMA_SQL = /^\s*(CREATE|PRAGMA|ALTER)/i;
const stmtOf = (st, sql, args = []) => new Proxy(st, { get(t, p) {
  if (p === 'bind') return (...a) => stmtOf(t.bind(...a), sql, a);
  if (['first', 'all', 'run', 'raw'].includes(p)) return async (...a) => {
    if (plan.armed && !SCHEMA_SQL.test(sql)) { const n = plan.seen++; if (n === plan.k) { plan.failed.push(`${p} ${sql.replace(/\s+/g, ' ').slice(0, 90)}`); throw new Error('D1_ERROR: Network connection lost.'); } }
    // (round 13: every time a statement matches `plan.when(sql, args)`, as the tester's dbfail13 n=-1)
    // (round 14: and who's asking, the read's own stack, for a statement two parts make alike: the board's settings)
    if (plan.when && !SCHEMA_SQL.test(sql) && plan.when(sql, args, () => new Error().stack)) { plan.hits = (plan.hits || 0) + 1; throw new Error('D1_ERROR: Network connection lost.'); }
    return t[p](...a);
  };
  const v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
} });
const liveDB = new Proxy({}, { get(_, p) { if (p === 'prepare') return (sql) => stmtOf(curDB.prepare(sql), sql); const v = curDB[p]; return typeof v === 'function' ? v.bind(curDB) : v; } });
const env = { DB: liveDB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', JOBTREAD_GRANT_KEY: 'jt-test', MERCURY_API_TOKEN: 'mercury-test', MERCURY_RELAY_KEY: 'relay-test' };
const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
const JOBS = [JOB('j1', `Maya (${Y0})`, 'Build'), JOB('j2', `Leo (${Y0})`, 'Design'), JOB('j3', `Someone Else (${Y0})`, 'Awaiting Funding')];
let ACCTS = [['Operating', 312500.49], ['Reserve', 62500.49]];
let JT_DOWN = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (/googleapis\.com\//.test(url)) return Response.json({ items: [], members: [], messages: [], files: [], conferenceRecords: [] });
  // Mercury's accounts: $312,500.49 and $62,500.49, $375,000.98 in the bank (ACCTS: others, the tester's QA_ACCTS)
  if (url === 'https://mercury-relay.sunshineonaranneyday.com/api/v1/accounts') return Response.json({ accounts: ACCTS.map(([name, currentBalance], i) => ({ name, kind: i ? 'savings' : 'checking', type: 'mercury', status: 'active', currentBalance })) });
  if (url.startsWith('https://mercury-relay.sunshineonaranneyday.com/')) return Response.json({ transactions: [], accounts: [] });
  if (url === 'https://api.jobtread.com/pave' && JT_DOWN) return new Response('JobTread is down', { status: 503 });
  if (url === 'https://api.jobtread.com/pave') {
    const q = JSON.parse(init.body || '{}').query || {};
    if (q.account) return Response.json({ account: { files: { nodes: [] } } });
    return Response.json({ organization: { jobs: { nodes: JOBS, nextPage: null } } });
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return Response.json({ error: 'test: no outside calls' }, { status: 502 });
  return realFetch(input, init);
};
_resetKeyCacheForTests();
provideBoardFinance(async () => ({
  at: new Date().toISOString(),
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(Y0 - 1, 10 + i, 15)).toISOString().slice(0, 7), income: 80000 + i * 1000, makeovers: 40000, store: 12000, operating: 18000, storeSales: 25000, net: 10000 + i * 1000 })),
  ytd: { year: Y0, through: day(0), income: 900000.4, makeovers: 500000.15, store: 150000.15, operating: 200000.15, net: 50000.05 },
  lastYtd: { year: Y0 - 1, through: day(-365), income: 800000.4, makeovers: 480000.35, store: 140000.35, operating: 200000.35, net: -20000.65 },
  cash: { today: 375000, lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000, belowFloor: false },
  perMakeover: { count: 12, average: 21000 },
}));

// ── The next meeting, its money item first in a long agenda (on a phone, its item runs thousands of pixels) ──
const board = (status = '') => (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board', status });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Welcome' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash' }] },
  { title: 'Programs', items: [{ title: 'Makeovers in progress', live: 'projects' }, { title: 'Coming up', live: 'events' }] },
  { title: 'New business', items: [{ title: 'The spring gala' }] },
];
const NEXT = await getMeeting(DB, (await patchMeeting(DB, (await saveMeeting(DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: AGENDA, agendaFrom: typed }), { by: FOUNDER })).id, (cur) => ({ ...cur, shared: true }))).id);

// ── Round 14's world beside round 13's: a held meeting with draft minutes, approved minutes the secretary signs, SOARD's
// papers, the board's settings (a quorum of 3), the events, the tax returns, a meeting's packet statements ──
Error.stackTraceLimit = 60;
await ensureAsks(DB);
await writeState(DB, 'settings', { quorum: 3, admins: [FOUNDER], invitesFrom: FOUNDER, asks: 'on' });
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('financials', JSON.stringify({ documents: [{ title: `${Y0 - 1} Form 990`, year: Y0 - 1, type: '990', url: 'https://files.example.org/example-990.pdf' }, { title: `${Y0 - 1} Audit`, year: Y0 - 1, type: 'audit', url: 'https://files.example.org/example-audit.pdf' }] })).run();
await DB.prepare('INSERT INTO events (slug, data) VALUES (?, ?)').bind('spring-gala', JSON.stringify({ title: 'The Spring Gala', date: day(40), location: 'Example Hall', url: '/events/spring-gala/' })).run().catch(() => {});
const ROLL = 'The board talked about Roll call. Motion carried 5 to 0.';
const DRAFT = await saveMeeting(DB, cleanMeeting({ date: day(-30), start: '08:00', end: '10:00', location: 'Example Hall', shared: true,
  minutesFrom: { typed: true, name: 'Minutes typed on the board page', at: new Date().toISOString() }, attendance: BOARD.map(board('present')),
  sections: [{ title: 'Call to order', items: [{ title: 'Roll call', notes: ROLL }] }, { title: 'Finance', items: [{ title: 'The audit', notes: 'The audit went well.' }] }] }), { by: FOUNDER });
const DRAFT_ROLL = DRAFT.sections[0].items[0];
const APPROVED = await saveMeeting(DB, cleanMeeting({ date: day(-120), start: '08:00', end: '10:00', location: 'Example Hall', shared: true, minutes: 'approved', approvedOn: day(0),
  minutesFrom: { typed: true, name: 'Minutes typed on the board page', at: new Date().toISOString() }, attendance: BOARD.map((s, i) => board(i < 3 ? 'present' : 'absent')(s)),
  sections: [{ title: 'Reports', items: [{ title: 'Treasurer', notes: 'The treasurer reported.' }] }] }), { by: FOUNDER });
// (a meeting's packet: its statements, files of their own, and its budget sheet's PDF)
{
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  for (const name of ['Statement of Activities.pdf', 'Statement of Financial Position.pdf']) await putFile(env, { ownerType: 'meeting', ownerId: DRAFT.id, file: new File([bytes], name, { type: 'application/pdf' }), kind: 'financials', by: FOUNDER });
  // SOARD's papers: two to read and sign, the bylaws as a PDF whose words search reads, and a budget among them
  for (const [title, kind] of [['Board Member Expectations', 'policy'], ['Conflict of Interest Policy', 'policy']]) await saveDoc(DB, { title, kind, shared: true, sign: true, body: `### ${title}\n\n- Come to three of four meetings\n- Tell the board of any conflict` }, { by: FOUNDER });
  for (const [title, kind, words] of [['Bylaws', 'governing', 'Article One. The fiscal year runs from January.'], [`${Y0} Budget`, 'financial', '']]) {
    const d = await saveDoc(DB, { title, kind, shared: true }, { by: FOUNDER });
    const f = await putFile(env, { ownerType: 'doc', ownerId: d.id, file: new File([bytes], `${title}.pdf`, { type: 'application/pdf' }), kind: 'other', by: FOUNDER });
    const fid = f?.id || f?.file?.id;
    if (words) await DB.prepare('UPDATE board_files SET words = ? WHERE id = ?').bind(words, fid).run().catch(() => {});
  }
}
// Sam's ask for his report on the next meeting's money
await DB.prepare("INSERT INTO board_asks (id, kind, meeting_id, item_id, slug, name, email, title, due, status, asked_at) VALUES ('ask_sam14', 'report', ?, ?, 'sam-ortiz', 'Sam Ortiz', ?, 'Year to date', ?, 'asked', ?)")
  .bind(NEXT.id, NEXT.sections.flatMap((x) => x.items).find((it) => it.live === 'cash').id, SAM, `${day(5)}T12:00:00-05:00`, new Date().toISOString()).run();
// ── The server ──
const ROUTES = { '/api/board-admin': boardAdmin, '/api/board-portal': boardPortal, '/api/board-file': boardFile };
const csp = (() => {
  const lines = readFileSync(join(ROOT, 'public/_headers'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === '/admin/*');
  return lines.slice(at + 1).find((l) => /^\s+Content-Security-Policy:/.test(l)).split('Content-Security-Policy:')[1].trim();
})();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const who = req.headers['x-test-user'] || '';
    if (url.pathname === '/cdn-cgi/access/get-identity') { res.writeHead(who ? 200 : 401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(who ? { email: who, name: '' } : {})); return; }
    if (url.pathname.startsWith('/cdn-cgi/imagedelivery/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers.set(k, v);
      if (who) headers.set('CF-Access-JWT-Assertion', await tokenFor(who));
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), duplex: 'half' });
      const ctx = { request, env, data: {}, waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
      ctx.next = async () => {
        const mod = ROUTES[url.pathname];
        const fn = mod?.[`onRequest${req.method[0]}${req.method.slice(1).toLowerCase()}`] || mod?.onRequest;
        if (fn) return fn(ctx);
        return Response.json({ success: true, ok: true, items: [], pages: 1, files: [], entries: [] });
      };
      const out = await middleware(ctx);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let path = join(ROOT, 'public', decodeURIComponent(url.pathname));
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) { res.writeHead(404); res.end('Not found'); return; }
    const head = { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' };
    if (url.pathname.startsWith('/admin/')) head['Content-Security-Policy'] = csp;
    res.writeHead(200, head);
    res.end(readFileSync(path));
  } catch (err) {
    res.writeHead(500); res.end(String(err?.stack || err));
  }
});
const PORT = Number(process.env.PORT ?? 0);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── The browser: one at a time, killed and started again when a tab stops answering ──
const LAUNCH = { headless: 'shell', protocolTimeout: 60000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] };
let browser = await puppeteer.launch(LAUNCH);
async function relaunch() {
  try { browser.process()?.kill('SIGKILL'); } catch { /* gone */ }
  await sleep(300);
  browser = await puppeteer.launch(LAUNCH);
}
const errs = [];
const within = (ms, p) => Promise.race([p, sleep(ms).then(() => { throw new Error(`no answer in ${ms / 1000} s`); })]);
async function tab(email, width = 1280, height = 900, { reduced = false, portal = null } = {}) {
  const page = await within(15000, browser.newPage());
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  const phone = width < 600;
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await page.setExtraHTTPHeaders({ 'x-test-user': email });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('pageerror', (e) => errs.push(`${email} ${width}: PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|x-test-user|403|404/.test(m.text())) errs.push(`${email} ${width}: ${m.text().slice(0, 300)}`); });
  // (what a Copy button puts on the clipboard, kept on the page to read: a headless browser has no clipboard)
  await page.evaluateOnNewDocument(() => { try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); } catch { /* kept as it is */ } });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/tile\.openstreetmap\.org|imagedelivery\.net/.test(r.url())) return r.respond({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
    // (`portal`: the page's own read answered with that data, as the server answered a read with a statement failing: X8)
    if (portal && r.method() === 'GET' && new URL(r.url()).pathname === '/api/board-portal' && !new URL(r.url()).search) return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(portal) });
    return r.continue();
  });
  return page;
}
async function open(page, hash = '#/', query = '') {
  await within(40000, page.goto(`${SITE}/admin/board/${query}${hash}`, { waitUntil: 'networkidle0' }));
  await page.waitForFunction(() => !document.querySelector('.bp-boot'), { timeout: 30000 }).catch(() => {});
  await sleep(900);
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(1100); };
const close = async (p) => { await within(5000, p.close()).catch(() => relaunch()); };
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
async function step(name, fn) {
  if (ONLY && !name.split(':')[0].split(/,\s*/).some((x) => ONLY.has(x))) return;
  console.log(`\n${name}`);
  try { await fn(); } catch (err) {
    const why = String(err?.message || err).split('\n')[0];
    failures.push(`${name}: a step stopped: ${why}`);
    console.log(`  ✗ a step stopped: ${why}`);
    await relaunch();
  }
}
const shot = async (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});

/** Search for what's typed (put in the box at once, as a paste is), once what it finds has settled: each result */
async function search(p, q) {
  // (its button pressed as a tap does, wherever the page is: on a phone the header with it has slid away down the page)
  if (!(await p.$('dialog.bp-finder[open]'))) { await p.evaluate(() => document.querySelector('button.bp-find')?.click()); await p.waitForSelector('dialog.bp-finder[open] input', { timeout: 5000 }); await sleep(200); }
  await p.$eval('dialog.bp-finder input', (i, v) => { i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }, q);
  let last = '';
  for (let k = 0; k < 20; k++) { await sleep(180); const cur = await p.evaluate(() => document.querySelector('.bp-finder__list')?.innerText || ''); if (cur === last && cur && !/Looking in the files/.test(cur)) break; last = cur; }
  return p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=group]')].flatMap((g) => {
    const gname = (g.querySelector('.bp-finder__group span')?.textContent || '').replace(/,.*$/, '');
    return [...g.querySelectorAll('[role=option]')].map((x) => ({ id: x.id, g: gname, title: (x.querySelector('.bp-finder__title')?.innerText || '').trim(), line: [...x.querySelectorAll('.bp-finder__sub')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()).join(' / ') }));
  }));
}
/** Money's results opened to all of them (its "All") */
async function allMoney(p) {
  const opened = await p.evaluate(() => { const b = [...document.querySelectorAll('.bp-finder [role=group]')].find((g) => /^Money/.test(g.querySelector('.bp-finder__group span')?.textContent || ''))?.querySelector('.bp-finder__all'); b?.click(); return !!b; });
  if (!opened) return null;
  await sleep(350);
  return p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=group]')].flatMap((g) => {
    const gname = (g.querySelector('.bp-finder__group span')?.textContent || '').replace(/,.*$/, '');
    return [...g.querySelectorAll('[role=option]')].map((x) => ({ id: x.id, g: gname, title: (x.querySelector('.bp-finder__title')?.innerText || '').trim(), line: [...x.querySelectorAll('.bp-finder__sub')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()).join(' / ') }));
  }));
}
const closeFinder = async (p) => { if (await p.$('dialog.bp-finder[open]')) { await p.keyboard.press('Escape'); await sleep(250); } };
/**
 * Where a pick landed, as a person sees it: the place marked (.is-found), whether it's the figure's own place (never a
 * card, a section or a meeting's agenda item), wholly in view under the sticky header and above the phone's tab bar,
 * focused, and the words marked in it, each in view
 */
async function landing(p, want) {
  await p.waitForFunction((id) => !document.querySelector('dialog.bp-finder[open]') && document.querySelector('.is-found')?.id === id && (document.activeElement === document.querySelector('.is-found') || document.querySelector('.is-found').contains(document.activeElement)), { timeout: 6000 }, want).catch(() => {});
  // (once the page has stopped moving: a smooth scroll, and the landing aimed again as what's above it is drawn)
  let y = -1;
  for (let k = 0, still = 0; k < 40 && still < 4; k++) { await sleep(100); const now = await p.evaluate(() => Math.round(scrollY)); still = now === y ? still + 1 : 0; y = now; }
  await sleep(150);
  return p.evaluate(() => {
    const el = document.querySelector('.is-found');
    if (!el) return { id: '', hash: location.hash };
    const top = document.querySelector('.bp-top');
    const head = top ? Math.max(0, top.getBoundingClientRect().bottom) : 0;
    const nav = document.querySelector('.bp-nav');
    const foot = nav && getComputedStyle(nav).position === 'fixed' ? Math.min(innerHeight, nav.getBoundingClientRect().top) : innerHeight;
    const vw = document.documentElement.clientWidth;
    const inside = (b) => b.height > 0 && b.top >= head - 1 && b.bottom <= foot + 1 && b.left >= -1 && b.right <= vw + 1;
    const r = el.getBoundingClientRect();
    const hl = window.CSS?.highlights?.get('bp-found');
    const marks = hl ? [...hl].filter((x) => el.contains(x.startContainer)).map((x) => ({ t: x.toString(), seen: inside(x.getBoundingClientRect()) })) : [];
    return {
      hash: location.hash, id: el.id, tag: el.tagName.toLowerCase(),
      card: el.matches('section, article, main, .bp-card, .bp-agitem, li[id^="i-"], .bp-sum'),
      seen: inside(r), box: [Math.round(r.top), Math.round(r.bottom), Math.round(head), Math.round(foot)],
      focused: document.activeElement === el || el.contains(document.activeElement), marks,
    };
  });
}
/** The page's own search entries for its money, as its search has them (./figures.js moneyFigures, on the page's data) */
const entriesOf = (p) => p.evaluate(async () => {
  const [{ moneyFigures }, money] = await Promise.all([import('/admin/board/figures.js'), import('/admin/board/money.js')]);
  const data = window.__bpShare?.();
  if (!data) return [];
  return moneyFigures(data, { cash: money.cashKnown(data), budget: money.budgetKnown(data) }).map((x) => ({ key: x.key, title: x.title, sub: x.sub, href: x.href, focus: x.focus }));
});
/** What to type to find an entry, as a person would: its title and the amount its line says (its own) */
const queryOf = (x) => `${x.title.replace(/,(?!\d{3})/g, ' ')} ${(x.sub.match(/[−-]?\$[\d,]+/) || [''])[0]}`.trim();
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
/** Pick an entry from search and say where it landed (`null` when search didn't offer it) */
async function pickEntry(p, x) {
  let found = await search(p, queryOf(x));
  // (its own line: two statements write "Total Income" alike, each its own row)
  const mine = (y) => y.g === 'Money' && flat(y.title) === flat(x.title) && flat(y.line).startsWith(flat(x.sub));
  let hit = found.find(mine);
  if (!hit) { found = (await allMoney(p)) || found; hit = found.find(mine); }
  if (!hit) { await closeFinder(p); return { offered: found.filter((y) => y.g === 'Money').slice(0, 4).map((y) => `${y.title} | ${y.line.slice(0, 50)}`) }; }
  await p.click(`#${hit.id}`);
  return landing(p, x.focus);
}
const good = (x, l) => l && !l.offered && l.hash === x.href && l.id === x.focus && !l.card && l.seen && l.focused && l.marks.length > 0 && l.marks.every((m) => m.seen);
const said = (x, l) => `${x.title} [${x.focus}] → ${l?.offered ? `not offered by search for “${queryOf(x)}” (${JSON.stringify(l.offered)})` : l?.err ? `stopped: ${l.err.split('\n')[0].slice(0, 120)}` : l ? `${l.hash} #${l.id} ${l.tag}${l.card ? ' (a card)' : ''}, in view ${l.seen} ${JSON.stringify(l.box)}, focused ${l.focused}, marked ${JSON.stringify((l.marks || []).map((m) => `${m.t}${m.seen ? '' : ' (out of view)'}`))}` : 'not offered by search'}`;
/** The text a person reads on the page (or in `sel`), outside tables, every fold open */
const prose = (p, sel = 'main') => p.evaluate((s) => {
  const root = document.querySelector(s) || document.body;
  const out = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const e = n.parentElement;
    if (!e || e.closest('table, svg, [hidden], .sr-only, [aria-hidden="true"]') || !e.getClientRects().length) continue;
    out.push(e.closest('p, li, span, div, figcaption, dd, dt, h1, h2, h3, summary')?.innerText || n.nodeValue);
  }
  return [...new Set(out.map((t) => t.replace(/\s+/g, ' ').trim()))].filter(Boolean);
}, sel);
/**
 * An amount above zero in brackets, the way a statement writes below zero: "($2M)", "($1.66M)", "(a cautious guess:
 * $180,000)", "($40,000 of it estimated)"; never a bracket of words beside an amount ("$3,000 (Ava, 2025)")
 */
const BRACKETED = /\((?!\s*[−-])[^()]*\$\d[^()]*\)/;

/** "$1,656,049" → 1656049, "−$12" → -12, "+$676K" → 676000, "$1.66M" → 1660000 */
const amt = (s) => { const m = String(s).match(/([−-])?\+?\$([\d,]+(?:\.\d+)?)\s?([KMB])?/); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]] || 1) : NaN; };
const cashCacheOff = () => DB.exec("DELETE FROM board_state WHERE key IN ('cash', 'finance')");
/** A real ZIP of { name: text } (an .xlsx's parts) */
function zip(files) {
  const enc = new TextEncoder();
  const locals = []; const central = []; let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const nameB = enc.encode(name); const raw = enc.encode(body); const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** A sheet as an .xlsx: rows of strings and numbers */
const xlsx = (rows) => zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>', 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => (c === '' ? '' : typeof c === 'number' ? `<c r="${String.fromCharCode(65 + ci)}${ri + 1}"><v>${c}</v></c>` : `<c r="${String.fromCharCode(65 + ci)}${ri + 1}" t="inlineStr"><is><t>${c}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>` });
const MONTH_DAY = new Date(`${day(0)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const FIN_ITEM = NEXT.sections.flatMap((x) => x.items).find((it) => it.live === 'cash');
const UNREAD = (part) => ({
  money: 'The money couldn’t load just now', history: 'The month-end balances couldn’t load just now', lineNotes: 'The notes on these lines couldn’t load just now',
  ownFiles: 'Which of these files are yours couldn’t load just now', paperWords: 'The words inside SOARD’s papers couldn’t load just now', corrections: 'The corrections suggested to the minutes couldn’t load just now',
  minutesSigned: 'Who has signed the minutes couldn’t load just now', kids: 'The kids served couldn’t load just now',
})[part];
const PAGE_DOWN = /The board page didn’t open|Something went wrong on the site’s side/;
const failEvery = (when) => { Object.assign(plan, { when, hits: 0 }); };
const failNone = () => { plan.when = null; };
const mainText = (p) => p.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/[ \t]+/g, ' '));
/** Every slide of the next meeting, as the founder presents it (each slide's words, until the deck ends) */
async function slides(query = '') {
  const s = await tab(FOUNDER, 1280, 720);
  await within(40000, s.goto(`${SITE}/admin/board/?present${query}#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
  await sleep(2500);
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const t = await s.evaluate(() => (document.querySelector('.bs-stage') || document.body).innerText.replace(/\s+/g, ' ').trim());
    if (seen.includes(t)) break;
    seen.push(t);
    await s.keyboard.press('ArrowRight');
    await sleep(900);
  }
  await close(s);
  return seen;
}
/** Print it all on the next meeting's page: the sheet as it's laid out (window.print stubbed) */
async function printed(p) {
  await p.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await p.evaluate(() => { [...document.querySelectorAll('button')].find((x) => /Print it all/.test(x.textContent))?.click(); });
  for (let k = 0; k < 40; k++) { await sleep(700); if (await p.evaluate(() => window.__printed)) break; }
  const t = await p.evaluate(() => document.querySelector('.bpp')?.innerText || '');
  await p.evaluate(() => { document.querySelector('.bpp')?.remove(); document.documentElement.classList.remove('bp-printing-all'); });
  return t;
}
// ── What each part carries, made by the members' own presses (as the round 14 tester's seed14 did) ──
const api = async (who, body = null, q = '') => {
  const r = await fetch(`${SITE}/api/board-portal${q}`, body ? { method: 'POST', headers: { 'x-test-user': who, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { headers: { 'x-test-user': who } });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const ITEM = NEXT.sections.flatMap((x) => x.items).find((it) => it.live === 'cash');
const KIM_KEY = DRAFT.attendance.find((x) => x.slug === 'kim-park').key;
const MARK = { type: 'typed', style: 'script', text: 'Sam Ortiz', initials: 'SO' };
{
  const said = [];
  said.push(['line note', (await api(SAM, { action: 'line-note', meetingId: NEXT.id, itemId: ITEM.id, key: 'act|Total Income', line: 'Total Income', text: 'Down 1% on last year: the gala moved to January.' })).status]);
  {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const fd = new FormData();
    fd.append('file', new Blob([await pdf.save()], { type: 'application/pdf' }), 'Treasurer notes.pdf');
    const r = await fetch(`${SITE}/api/board-portal?attach=${NEXT.id}&item=${ITEM.id}`, { method: 'POST', headers: { 'x-test-user': SAM }, body: fd });
    said.push(['his file', r.status]);
  }
  said.push(['his correction on Roll call', (await api(SAM, { action: 'correction', meetingId: DRAFT.id, target: `n:${DRAFT_ROLL.id}`, words: `${ROLL} Sam asked for the vote count to be added.`, was: ROLL })).status]);
  said.push(['his correction on who was there', (await api(SAM, { action: 'correction', meetingId: DRAFT.id, target: `r:${KIM_KEY}`, words: 'excused' })).status]);
  said.push(['Taylor signs the approved minutes', (await api(TAYLOR, { action: 'sign-minutes', meetingId: APPROVED.id, mark: { type: 'typed', style: 'script', text: 'Taylor Nguyen', initials: 'TN' }, consent: true, as: 'taylor-nguyen' })).status]);
  const docs = (await api(SAM)).j.docs;
  const coi = docs.find((x) => x.title === 'Conflict of Interest Policy');
  said.push(['Sam signs a paper', (await api(SAM, { action: 'sign', docId: coi.id, name: 'Sam Ortiz', mark: MARK, consent: true, version: coi.version, year: Y0, fields: {}, as: 'sam-ortiz' })).status]);
  console.log(`seeded: ${said.map(([w, s]) => `${w} ${s}`).join(' · ')}`);
  if (said.some(([, s]) => s !== 200)) failures.push(`the world's presses: ${JSON.stringify(said)}`);
}
const PAPER = (await api(SAM)).j.docs.find((x) => x.title === 'Board Member Expectations');

/**
 * Each part of the page's read, failing every time by its own statement (`who` reads it; `books`: false to run without
 * QuickBooks, as the month-end balances matter only then), and who sees it drawn
 */
const PARTS = {
  money: { when: (sql, a) => /FROM board_state WHERE key/.test(sql) && a[0] === 'cash' },
  projects: { when: (sql, a) => /FROM board_state WHERE key/.test(sql) && a[0] === 'projects' },
  kids: { when: (sql) => /SELECT slug, data FROM kids/.test(sql) },
  gifts: { when: (sql, a) => /FROM board_state WHERE key/.test(sql) && a[0] === 'gifts' },
  sources: { when: (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'financials' },
  events: { when: (sql) => /SELECT slug, data FROM events/.test(sql) },
  history: { when: (sql) => /FROM board_cash WHERE total/.test(sql), books: false },
  meetings: { when: (sql) => /SELECT data FROM board_meetings ORDER BY date DESC/.test(sql) },
  docs: { when: (sql) => /SELECT data FROM board_docs/.test(sql) },
  settings: { when: (sql, a, stack) => /FROM board_state WHERE key/.test(sql) && a[0] === 'settings' && /getSettings/.test(stack()) && /portalData/.test(stack()) && !/portalExtras/.test(stack()) },
  ownFiles: { when: (sql) => /SELECT id FROM board_files WHERE lower\(by\)/.test(sql) },
  paperWords: { when: (sql) => /COALESCE\(NULLIF\(words/.test(sql) },
  mark: { when: (sql) => /FROM board_member_marks WHERE slug/.test(sql) },
  copies: { when: (sql) => /SELECT doc_id, year, version, record_id/.test(sql) },
  corrections: { when: (sql) => /FROM board_minutes_corrections WHERE state != 'withdrawn'/.test(sql) },
  minutesSigned: { when: (sql) => /FROM board_minutes_signed/.test(sql) },
  lineNotes: { when: (sql) => /FROM board_line_notes/.test(sql) },
  myAsks: { when: (sql) => /FROM board_asks WHERE kind IN/.test(sql) },
  facts: { when: (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'settings' },
  notesWaiting: { when: (sql) => /FROM board_minutes_notes/.test(sql), who: 'taylor' },
  presenting: { when: (sql, a, stack) => /FROM board_state WHERE key/.test(sql) && a[0] === 'settings' && /getSettings/.test(stack()) && /portalExtras/.test(stack()) },
  // (the chair's review: the chair's own read of it)
  review: { when: (sql, a, stack) => /FROM board_state WHERE key/.test(sql) && a[0] === 'settings' && /portalExtras/.test(stack()) && !/getSettings/.test(stack()), who: 'alex' },
};
const WALK = () => ({ home: '#/', review: `#/meetings/${NEXT.id}/review`, meetings: '#/meetings', next: `#/meetings/${NEXT.id}`, draft: `#/meetings/${DRAFT.id}`, approved: `#/meetings/${APPROVED.id}`, report: `#/meetings/${NEXT.id}/report/${ITEM.id}`,
  financials: '#/financials', people: '#/people', documents: '#/documents', paper: `#/documents/${PAPER.id}`, families: '#/families' });
/** An empty state's words: said beside a part that failed, it says the part is empty when it isn't known */
const EMPTY = /\bNo [a-z][^.\n]{0,60} yet\b|\bNone (now|yet|right now|scheduled)\b|\bNobody here\b|\bshows? here once\b|\bshow here\.|\bNothing (found|on the calendar|to show)\b|isn’t here|may have been taken off|No file matches|No document or file matches|Not in yet|Not on the calendar yet/;
/** What a route draws, read as a person reads it: its lede, its lines, what says it couldn't load, its route's lost parts */
const drawn = (p) => p.evaluate(() => {
  for (const d of document.querySelectorAll('main details:not([open])')) d.open = true;
  const main = document.querySelector('main');
  // (a clock time is the moment it was read, and a file's kind its badge while its first page draws: neither is a part)
  const lines = (main?.innerText || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim().replace(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/g, 'H:MM')).filter((l) => l && !/^(PDF|Word|Excel|Slides|Photo|File|·)$/.test(l));
  return { route: main?.dataset.route || '', lost: (main?.dataset.lost || '').split(' ').filter(Boolean), lede: document.querySelector('main .bp-lede')?.innerText.replace(/\s+/g, ' ').trim() || '',
    lines, said: [...new Set([...document.querySelectorAll('main [data-unread]')].map((e) => e.dataset.unread))], h1: document.querySelector('main h1')?.innerText || '' };
});
const ROUTE_PARTS = (await import('../public/admin/board/unread.js')).ROUTE_PARTS || {};
/**
 * A lede's clauses ("SOARD’s facts, its papers, and every file from every meeting." → three). With a part failed, a
 * lede may name that part's place in place of what it holds (Financials' "The money", Documents' "SOARD’s papers"), as
 * that place says it couldn't load; nothing else of it changes
 */
const clauses = (l) => l.replace(/\.$/, '').split(/,? and |, /).map((x) => x.trim().toLowerCase()).filter(Boolean);
const LEDE_PLACE = { money: 'the money', docs: 'soard’s papers' };
const ledeHolds = (c, f, part) => {
  if (c === f) return true;
  const cc = clauses(c); const ff = clauses(f);
  const added = ff.filter((x) => !cc.includes(x));
  return !!LEDE_PLACE[part] && added.length === 1 && added[0] === LEDE_PLACE[part];
};

try {
  // ─── Z1: Suggest a correction with the corrections not read ───
  await step('Z1: the corrections not read: Suggest a correction waits in place, saying why; read, his waiting one shows with Take it back; one that replaces his says so, at 1280 and 390', async () => {
    for (const w of [1280, 390]) {
      failEvery(PARTS.corrections.when);
      const p = await tab(SAM, w, 900);
      await open(p, `#/meetings/${DRAFT.id}`);
      await sleep(1200);
      const at = await p.evaluate((id) => {
        const item = document.getElementById(`i-${id}`) || [...document.querySelectorAll('li, section, div')].find((e) => /^1\.1\b/.test(e.innerText) && /Roll call/.test(e.innerText));
        const offers = [...document.querySelectorAll('button.mfix-open')].map((b) => `${b.innerText} [${b.getAttribute('aria-label') || ''}]`);
        const waits = [...document.querySelectorAll('.mfix-lost')].map((e) => e.innerText.trim());
        return { offers, waits, read: document.querySelector('.bp-minutes__said')?.innerText || '' };
      }, DRAFT_ROLL.id);
      ok(!at.offers.some((o) => /Suggest a correction: Roll call/.test(o)) && at.waits.includes('The corrections couldn’t load, so you can’t suggest one just now.'), `${w}: not read: no “Suggest a correction” under Roll call, the words in its place (offers ${JSON.stringify(at.offers)}, waits ${JSON.stringify(at.waits)})`);
      ok(!at.offers.length, `${w}: nothing offered from an empty list anywhere on the meeting (${JSON.stringify(at.offers)})`);
      ok(/The corrections couldn’t load, so you can’t suggest one just now\./.test(at.read) && !/See something wrong\? Suggest a correction/.test(at.read), `${w}: the card beside the minutes says so too: “${at.read}”`);
      await shot(p, `z1-lost-${w}`);
      await close(p);
      failNone();
      // Read: his waiting one with Take it back, and no fresh offer under Roll call
      const q = await tab(SAM, w, 900);
      await open(q, `#/meetings/${DRAFT.id}`);
      await sleep(1200);
      const seen = await q.evaluate(() => ({ offers: [...document.querySelectorAll('button.mfix-open')].map((b) => b.getAttribute('aria-label') || b.innerText), back: [...document.querySelectorAll('.mfix-row button')].filter((b) => /Take it back/.test(b.innerText)).length }));
      ok(!seen.offers.some((o) => /Roll call/.test(o)) && seen.back >= 1, `${w}: read: his waiting one shows with Take it back, nothing new offered under Roll call (${JSON.stringify(seen)})`);
      await close(q);
    }
    // A correction that replaces his own waiting one (who was there: Kim excused, now on video) says so
    const p = await tab(SAM, 1280, 900);
    await open(p, `#/meetings/${DRAFT.id}`);
    await sleep(1200);
    const opened = await p.evaluate(() => { const b = [...document.querySelectorAll('button.mfix-open')].find((x) => /Correct who was there/.test(x.innerText)); b?.scrollIntoView({ block: 'center' }); b?.click(); return !!b; });
    await sleep(600);
    if (opened) {
      await p.evaluate((key) => { const s = document.querySelector('.mfix-box select'); s.value = key; s.dispatchEvent(new Event('change', { bubbles: true })); }, KIM_KEY);
      await p.evaluate(() => [...document.querySelectorAll('.mfix-pick button')].find((b) => b.innerText === 'On video')?.click());
      await sleep(200);
      await p.click('.mfix-box button[type=submit]');
      await sleep(2500);
    }
    const toast = await p.evaluate(() => document.querySelector('.bp-toast')?.innerText || '');
    const rows = (await api(SAM)).j.corrections?.[DRAFT.id]?.filter((c) => c.mine && c.state === 'waiting' && c.kind === 'roll') || [];
    ok(opened && /This replaced your waiting correction on who was there \(Kim Park\)\./.test(toast) && rows.length === 1 && rows[0].words === 'remote', `the answer says it replaced his waiting one: “${toast}” (${JSON.stringify(rows.map((c) => c.words))})`);
    await shot(p, 'z1-replaced');
    await close(p);
  });

  // ─── Z2: the notes on the lines not read: no "none yet" beside "couldn't load" ───
  await step('Z2: the notes on the lines not read: the report page says they couldn’t load and never “No notes on these numbers yet.”, for Sam (he presents it) and Maria, at 1280 and 390', async () => {
    for (const [who, w] of [[SAM, 1280], [SAM, 390], [MARIA, 1280], [MARIA, 390]]) {
      failEvery(PARTS.lineNotes.when);
      const p = await tab(who, w, 900);
      await open(p, `#/meetings/${NEXT.id}/report/${ITEM.id}`);
      await sleep(1500);
      const t = await mainText(p);
      ok(t.includes('The notes on these lines couldn’t load just now') && !/No notes on these numbers yet/.test(t), `${who === SAM ? 'Sam' : 'Maria'} ${w}: “couldn’t load” and no “none yet” (${JSON.stringify(t.split('\n').filter((l) => /notes/i.test(l)).slice(0, 4))})`);
      await shot(p, `z2-${who === SAM ? 'sam' : 'maria'}-${w}`);
      await close(p);
      failNone();
    }
    // (read, Maria sees Sam's note, and no "none yet")
    const p = await tab(MARIA, 1280, 900);
    await open(p, `#/meetings/${NEXT.id}/report/${ITEM.id}`);
    await sleep(1500);
    const t = await mainText(p);
    ok(/the gala moved to January/.test(t) && !/No notes on these numbers yet/.test(t), 'read: Maria sees Sam’s note');
    await close(p);
  });

  // ─── Z3: every route with every part failing in turn ───
  await step('Z3: every route with every part of the page’s read failing in turn: it opens, its lede stands, no empty state, anything gone is said in its place by a part the route declares', async () => {
    const only = process.env.PARTS ? process.env.PARTS.split(',') : Object.keys(PARTS);
    const views = { sam: SAM, taylor: TAYLOR, alex: ALEX };
    const control = {};
    let checks = 0;
    for (const [i, part] of only.entries()) {
      const spec = PARTS[part];
      const whoName = process.env.WHO || spec.who || 'sam';
      const who = views[whoName];
      if (spec.books === false) await noBooks(); else await setBooks();
      await cashCacheOff();
      const key = `${whoName}:${spec.books === false ? 'nobooks' : 'books'}`;
      const walk = async (p) => { const out = {}; for (const [name, hash] of Object.entries(WALK())) { await go(p, hash); await sleep(name === 'financials' || name === 'documents' ? 1400 : 700); out[name] = await drawn(p); } return out; };
      if (!control[key]) {
        failNone();
        const c = await tab(who, 1280, 900);
        await open(c, '#/');
        await sleep(1500);
        control[key] = await walk(c);
        await close(c);
      }
      const C = control[key];
      failEvery(spec.when);
      const p = await tab(who, 1280, 900);
      await open(p, '#/');
      await sleep(1500);
      const flags = await p.evaluate(() => window.__bpShare?.()?.unread || {});
      const F = await walk(p);
      await close(p);
      const hits = plan.hits;
      failNone();
      if (!flags[part]) { ok(false, `${part}: its statement failing (${hits} hits) marks it (${JSON.stringify(flags)})`); continue; }
      const extra = Object.keys(flags).filter((x) => x !== part);
      for (const [name, f] of Object.entries(F)) {
        const c = C[name];
        checks += 1;
        const problems = [];
        if (/didn’t open|Something went wrong/.test(f.h1) && !/didn’t open/.test(c.h1) && !f.said.length) problems.push(`didn’t open without a word: ${f.h1}`);
        const shut = /didn’t open/.test(f.h1) && f.said.includes(part);
        if (!shut && !ledeHolds(c.lede, f.lede, part)) problems.push(`its lede rewrote itself: “${c.lede}” → “${f.lede}”`);
        const empties = f.lines.filter((l) => EMPTY.test(l) && !c.lines.includes(l));
        if (empties.length) problems.push(`an empty state beside the part that failed: ${JSON.stringify(empties)}`);
        const gone = c.lines.filter((l) => !f.lines.includes(l));
        const isNew = f.lines.filter((l) => !c.lines.includes(l) && !/couldn’t load|didn’t open|isn’t said here/.test(l));
        if ((gone.length || isNew.length) && !f.said.some((x) => x === part || extra.includes(x))) problems.push(`it changed and doesn’t say ${part} couldn’t load (gone ${JSON.stringify(gone.slice(0, 3))}, new ${JSON.stringify(isNew.slice(0, 3))})`);
        if ((gone.length || isNew.length || f.said.includes(part)) && !(ROUTE_PARTS[f.route] || []).includes(part)) problems.push(`it draws from ${part}, which ${f.route} doesn’t declare`);
        if (f.lost.includes(part) && (gone.length || isNew.length) && !f.said.includes(part)) problems.push(`its lost parts name ${part}, said nowhere on it`);
        ok(!problems.length, `${part} (${whoName}) ${name}: ${problems.length ? problems.join('; ') : `fine${f.said.length ? `, says ${f.said.join(', ')}` : ''}`}`);
      }
      if (i % 4 === 3) await relaunch();
    }
    console.log(`  (${checks} route checks)`);
    await setBooks();
    await cashCacheOff();
  });

  // ─── Z4: the cash's change on a year ───
  await step('Z4: the month-end balances not read: Home’s and Financials’ cash tiles and the Cash in the bank card say the change on a year couldn’t load, at 1280 and 390', async () => {
    await noBooks();
    await setHistory(true);
    await cashCacheOff();
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      for (const lost of [false, true]) {
        if (lost) failEvery(PARTS.history.when); else failNone();
        const p = await tab(who, w, 900);
        await open(p, '#/');
        await sleep(1500);
        const home = await p.evaluate(() => [...document.querySelectorAll('.bp-fig')].find((x) => /Cash in the bank/i.test(x.innerText))?.innerText.replace(/\s+/g, ' ') || '');
        await go(p, '#/financials');
        await sleep(1800);
        const fin = await p.evaluate(() => ({ tile: document.getElementById('fin-cash')?.innerText.replace(/\s+/g, ' ') || '', card: document.querySelector('#cash .bp-muted')?.innerText.replace(/\s+/g, ' ') || '', marks: [...document.querySelectorAll('main [data-unread="history"]')].length }));
        if (!lost) ok(/from a year ago/.test(home) && /from a year ago/.test(fin.tile) && /from (\w+ \d{4}|a year earlier)/.test(fin.card), `${w} read: the change on a year (${home} | ${fin.tile} | ${fin.card})`);
        else ok(/The change from a year ago couldn’t load just now/.test(home) && /The change from a year ago couldn’t load just now/.test(fin.tile) && /The change from a year ago couldn’t load just now/.test(fin.card) && fin.marks >= 3, `${w} not read: said where it was (${home} | ${fin.tile} | ${fin.card}, ${fin.marks} places)`);
        if (lost) await shot(p, `z4-${w}`);
        await close(p);
      }
    }
    failNone();
    await setBooks();
    await cashCacheOff();
  });

  // ─── Z5, Z6: the budget sheet's year ───
  /** A budget sheet in the next meeting's past neighbour's packet, its budget column headed `head`, `title` above */
  async function budgetSheet(head, title = 'SOARD Budget vs. Actuals', name = 'Budget vs Actual.xlsx') {
    await DB.prepare("DELETE FROM board_files WHERE name LIKE '%.xlsx'").run();
    const bytes = xlsx([[title], ['', head, 'Actual as of September 30, 2026'], ['Revenue Total', 2000000, 1500000], ['Total Expenses', 1500000, 1100000]]);
    await putFile(env, { ownerType: 'meeting', ownerId: DRAFT.id, file: new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), kind: 'financials', by: FOUNDER });
  }
  await step('Z5: a budget sheet headed “Fiscal Year 2026 Budget”, “FY-2026 Budget” or “FY-26 Budget”: the tiles and heading say FY2026, and every spelling typed finds it, at 1280 and 390', async () => {
    await noBooks();
    await cashCacheOff();
    for (const head of [`Fiscal Year ${Y0} Budget`, `FY-${Y0} Budget`, `FY-${String(Y0).slice(2)} Budget`]) {
      await budgetSheet(head);
      for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
        const p = await tab(who, w, 900);
        await open(p, '#/financials');
        await sleep(2500);
        const t = await mainText(p);
        ok(new RegExp(`FY${Y0} revenue`, 'i').test(t) && new RegExp(`FY${Y0} against its budget`).test(t), `${head} ${w}: the tiles and heading say FY${Y0} (${JSON.stringify(t.split('\n').filter((l) => /revenue|against its budget/i.test(l)).slice(0, 3))})`);
        for (const q of [`Fiscal Year ${Y0}`, `FY${Y0}`, `FY-${String(Y0).slice(2)}`, `F.Y. ${Y0}`, `fiscal ${Y0} budget`]) {
          const found = (await search(p, q)).filter((x) => x.g === 'Money');
          ok(found.some((x) => /budget/i.test(`${x.title} ${x.line}`)), `${head} ${w}: “${q}” finds the budget (${JSON.stringify(found.slice(0, 2).map((x) => x.title))})`);
        }
        await closeFinder(p);
        await close(p);
      }
    }
  });
  await step('Z6: no year in the budget sheet: search says “The revenue budget”, as the tile says “Revenue”, never a year, at 1280 and 390', async () => {
    await noBooks();
    await budgetSheet('Budget');
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/financials');
      await sleep(2500);
      const found = (await search(p, 'revenue budget')).filter((x) => x.g === 'Money');
      const bud = found.filter((x) => /budget/i.test(x.title));
      ok(bud.some((x) => x.title === 'The revenue budget') && !bud.some((x) => /\b20\d\d\b/.test(`${x.title} ${x.line}`)), `${w}: ${JSON.stringify(bud.map((x) => `${x.title} | ${x.line}`))}`);
      await closeFinder(p);
      await close(p);
    }
    await DB.prepare("DELETE FROM board_files WHERE name LIKE '%.xlsx'").run();
    await setBooks();
    await cashCacheOff();
  });

  // ─── Z7: the quorum with the board's settings not read ───
  await step('Z7: the board’s settings not read (a quorum of 3): the meeting’s page, Print it all and the secretary’s printed form say the quorum isn’t said here, never a majority guessed', async () => {
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      for (const lost of [false, true]) {
        if (lost) failEvery(PARTS.settings.when); else failNone();
        const p = await tab(who, w, 900);
        await open(p, `#/meetings/${APPROVED.id}`);
        await sleep(1500);
        const t = await mainText(p);
        const pr = await printed(p);
        const lead = (pr.match(/\d of \d board members[^.]*\./) || [''])[0];
        const unsaid = (pr.match(/[^.]*so the quorum isn’t said here\./) || [''])[0];
        if (!lost) ok(/A quorum/.test(t) && lead === '3 of 5 board members, a quorum.', `${w} read: the page and Print say a quorum (${lead})`);
        else ok(/so the quorum isn’t said here/.test(t) && !/quorum \(\d\)|A quorum/.test(t) && lead === '3 of 5 board members.' && !!unsaid && !/short of a quorum|, a quorum/.test(pr), `${w} not read: the page and Print say it isn’t said (“${lead}” “${unsaid.trim()}”)`);
        await close(p);
      }
    }
    // The secretary's printed form: Print the form on the draft minutes' card
    for (const lost of [false, true]) {
      if (lost) failEvery(PARTS.settings.when); else failNone();
      const p = await tab(TAYLOR, 1280, 900);
      await open(p, `#/meetings/${NEXT.id}`);
      await sleep(1500);
      await p.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
      await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Print the form/.test(b.innerText))?.click());
      for (let k = 0; k < 20; k++) { await sleep(400); if (await p.evaluate(() => window.__printed)) break; }
      const form = await p.evaluate(() => document.querySelector('.mt-quorum')?.innerText || '');
      // (the next meeting's form: its five board members, Settings' 3)
      if (!lost) ok(/^Quorum: 3 of 5 board members/.test(form), `the form, read: “${form}”`);
      else ok(/so the quorum isn’t said here/.test(form) && !/Quorum: \d/.test(form), `the form, not read: “${form}”`);
      await close(p);
    }
    failNone();
  });

  // ─── Z8: one list of accounts ───
  await step('Z8: an account at $0, and one at −$0.30: Financials and the meeting’s tile list each as $0, and search finds each by its name, at 1280 and 390', async () => {
    await noBooks();
    for (const [accts, name, who, w] of [[[['Operating', 312500], ['Reserve', 62500], ['Old Savings', 0]], 'Old Savings', SAM, 1280], [[['Operating', 312500], ['Reserve', 62500], ['Savings', 1500], ['Petty Cash', 900], ['PayPal', 700], ['Venmo', -0.3]], 'Venmo', MARIA, 390]]) {
      ACCTS = accts;
      await cashCacheOff();
      const p = await tab(who, w, 900);
      await open(p, '#/financials');
      await sleep(1800);
      const card = await p.evaluate(() => [...document.querySelectorAll('#cash .bp-accounts:not(.bp-accounts--owed) li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
      const found = (await search(p, name)).filter((x) => x.g === 'Money' && x.title === name);
      await closeFinder(p);
      await go(p, `#/meetings/${NEXT.id}`);
      await sleep(2200);
      const tile = await p.evaluate((id) => document.querySelector(`#mt-${id}-bank .bp-fig__sub`)?.textContent || '', NEXT.id);
      ok(card.some((l) => l.startsWith(`${name} $0`)) && new RegExp(`${name} \\$0\\b`).test(tile) && found.length === 1 && /^\$0, a bank account/.test(found[0].line), `${w}: ${name} is $0 on Financials (${JSON.stringify(card)}), on the meeting’s tile (${tile}) and found (${JSON.stringify(found.map((x) => x.line))})`);
      ok(!card.some((l) => l.startsWith(name) && /Overdrawn/.test(l)), `${w}: ${name} isn’t overdrawn`);
      await close(p);
    }
    ACCTS = [['Operating', 312500.49], ['Reserve', 62500.49]];
    await setBooks();
    await cashCacheOff();
  });

  // ─── Z9: the other presses offered from a part that may not have loaded ───
  await step('Z9: today’s money not read: the report page’s slides can’t be reordered, saying why (a new order would leave the money’s slides out); the notes waiting not read: the secretary’s button never says “Take notes here”, at 1280 and 390', async () => {
    for (const w of [1280, 390]) {
      for (const lost of [false, true]) {
        if (lost) failEvery(PARTS.money.when); else failNone();
        await cashCacheOff();
        const p = await tab(SAM, w, 900);
        await open(p, `#/meetings/${NEXT.id}/report/${ITEM.id}`);
        await sleep(1500);
        // (a phone's switch: Write | In the meeting, one at a time)
        await p.evaluate(() => [...document.querySelectorAll('.bp-rp__switch button')].find((x) => /In the meeting/.test(x.innerText))?.click());
        await sleep(1500);
        const s = await p.evaluate(() => ({ count: document.querySelector('.bp-rp__count')?.innerText.replace(/\s+/g, ' ') || '', moves: document.querySelectorAll('.bp-rp__move').length, why: [...document.querySelectorAll('.bp-rp__stack [data-unread]')].map((e) => e.innerText.trim()) }));
        if (!lost) ok(s.moves > 1 && /Drag one to move it/.test(s.count) && !s.why.length, `${w} read: the slides can be reordered (${s.count}, ${s.moves} to move)`);
        else ok(!s.moves && !/Drag one to move it/.test(s.count) && s.why.includes('The money couldn’t load just now, so the order of these slides can’t be changed here.'), `${w} not read: no reordering, said why (${s.count}, ${s.moves} to move, ${JSON.stringify(s.why)})`);
        await close(p);
      }
      for (const lost of [false, true]) {
        if (lost) failEvery(PARTS.notesWaiting.when); else failNone();
        const p = await tab(TAYLOR, w, 900);
        await open(p, `#/meetings/${NEXT.id}`);
        await sleep(1500);
        const b = await p.evaluate(() => [...document.querySelectorAll('button.bp-minutes__open')].map((x) => x.innerText.trim()));
        if (!lost) ok(b.includes('Take notes here'), `${w} read: Taylor’s button: ${JSON.stringify(b)}`);
        else ok(b.length && !b.includes('Take notes here') && b.includes('Open the notes'), `${w} not read: never “Take notes here” (${JSON.stringify(b)})`);
        await close(p);
      }
    }
    failNone();
    await cashCacheOff();
  });

  ok(!errs.length, `no console errors${errs.length ? `: ${errs.slice(0, 4).join(' | ')}` : ''}`);
} catch (err) {
  failures.push(`crashed: ${err.stack || err}`);
  console.error(err);
} finally {
  await within(8000, browser.close()).catch(() => { try { browser.process()?.kill('SIGKILL'); } catch { /* gone */ } });
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('\nAll round 14 member checks passed. Screenshots in test-results/board-round14-member/');
process.exit(0);
