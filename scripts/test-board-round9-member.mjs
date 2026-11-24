/**
 * test-board-round9-member.mjs: the board page as members see it, as QA round 9 found it (Nov 22 2026)
 * =====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round7-member.mjs
 * does; JobTread, Mercury, Zeffy, Google and Resend faked, QuickBooks' year, statements and budget kept in D1 as its read
 * leaves them (the tester's figures). Made-up people only.
 *   R1  Every line of QuickBooks' statements picked from search lands on its row, drawn, marked and focused, its
 *       statement shown and "Every account" open for a folded line: all 57, by click at 1280, by Enter at 390, by the
 *       keyboard at 768, from Home
 *   R2  Every money figure drawn on Home, Financials, the next meeting's money and its slide, searched as it's written:
 *       found, its line marking it, and picking it lands where it's drawn, marked there; the tester's lists (round 9's
 *       s9a, s9b, s9c, s9d, s9e), short forms, near misses and signs among them
 *   R3  A revenue category below zero: the parts are the money that came in, adding to 100%, the bar within its end, and
 *       what's below zero said by its name under the mix, on Home, Financials and Print it all
 *   R7  A change that rounds to 0% says Even: Financials' table, its tooltip, Print it all
 *   R8  A family link that leads to no family: a heading and plain words, and the tab says so, at 390 and 1280; and a
 *       link cut off in the middle of a %-code (QA round 10) is a dead link the same way, never a blank page
 *   R10 to R13, QA round 10 (Nov 22 2026): the R2 walk widened to every amount drawn, the month-by-month tables and the
 *       folds included, with QuickBooks and without it (Mercury's record, the month-end balances); each of the store's
 *       lines lands on its own place, marked alone (R11); a small category in Everything else, so the parts add up
 *       (R12); a change says which way, and two results are never worded the same (R13); the typed forms of findings
 *       4 and 5 in R2's lists
 * Screenshots land in test-results/board-round9-member/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round9-member.mjs            (ONLY=R1,R2 runs those steps alone; PORT=4891 a port of its own;
 *                                                          WIDTHS=1280 R1 at that width alone)
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
import { saveMeeting, patchMeeting, getMeeting, provideBoardFinance, ensureSchema } from '../functions/api/_board.js';
import { writeState, stateReady } from '../functions/api/_board-roles.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { maybeReadGifts } from '../functions/api/_board-gifts.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting, money } from '../public/admin/board-shared.js';
import { compact } from '../public/admin/board/money.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round9-member/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const Y0 = Number(day(0).slice(0, 4));

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
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  'CREATE TABLE applications (id TEXT PRIMARY KEY, jt_account_id TEXT, lang TEXT, jt_state TEXT, files TEXT, is_test INTEGER DEFAULT 0, submitted_at TEXT, kind TEXT, deleted_at TEXT)',
]) await DB.exec(sql);
for (const [slug, d] of Object.entries(PEOPLE)) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
for (const [slug, email] of EMAILS) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
await ensureSchema(DB);
await ensureApplicantSchema(DB);
// The tax return's year, as Site → Financials keeps it (Financials' "2025 at a glance")
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('financial-snapshot', JSON.stringify({ year: Y0 - 1, totalRevenue: 1000000, totalExpenses: 900000, programExpenses: 750000, netAssets: 400000, contributions: 600000, storeRevenue: 300000, programPct: 83, managementPct: 9, fundraisingPct: 8 })).run();
for (const [slug, name] of [[`maya-${Y0}`, 'Maya'], [`leo-${Y0}`, 'Leo']]) await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, Y0, JSON.stringify({ name, year: Y0, childCount: 1, roomCount: 1 })).run();
// A family who applied (made-up), for its page and the links that lead to none
await DB.prepare(`INSERT INTO applicants (account_id, name, status, year, types, fields, address, city, county, lat, lng, area, area_miles, contact_name, contact_email, contact_phone, contacts, photo_url, created_at, synced_at, job_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind('acctIris01', 'Iris Example', 'Approved', String(Y0 + 1), JSON.stringify(['Therapy Room']), JSON.stringify({ diagnosis: 'An example diagnosis', birthday: '2017-05-01', mobile: 'No', verbal: 'Yes', language: 'English' }), '12 Elm St, Roswell, GA 30075', 'Roswell', 'Fulton', 34.02, -84.36, 'inside', 0, 'Parent Example', 'parent@example.com', '4045550100', '[]', null, `${day(-9)}T14:00:00Z`, new Date().toISOString(), null).run();

// ── QuickBooks: the year so far, last year, the statements and the budget, as its read keeps them (the tester's) ──
const cat = (key, name, amount, accounts = [name]) => ({ key, name, amount, accounts });
const SOURCES = [
  cat('donations', 'Donations', 700000, ['Individual/Corporate Revenue']), cat('store', 'Store sales', 415000, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000, ['Gala Income']),
  cat('inkind', 'In kind', 220000, ['In-Kind Contribution']), cat('grants', 'Grants', 90000, ['Grant Revenue']), cat('account:golf classic', 'Golf Classic', 30000, ['Golf Classic Income']),
  cat('account:rent', 'Rent', 16000, ['Rent Income']), cat('account:interest', 'Interest', 5000, ['Interest Income']), cat('account:makeover', 'Makeover', 45, ['Makeover Revenue']),
];
const L = (k, label, d, a, p) => ({ k, label, d, a, p });
const SMALL = {
  position: [L('head', 'Assets', 0), L('total', 'Total Bank Accounts', 1, 608532, 655431), L('total', 'TOTAL ASSETS', 0, 870767, 794994)],
  activity: [L('head', 'Income', 0), L('total', 'Total Income', 0, 1884217, 1909703), L('sum', 'Net Income', 0, 189248, 176000)],
  budget: [{ k: 'head', label: 'Income', d: 0 }, { k: 'acct', label: 'Individual/Corporate Revenue', d: 1, a: 700000, b: 500000, y: 600000 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, b: 150000, y: 180000 }],
};
// (as many lines as a real QuickBooks has, long names, below zero: the tester's QA_BOOKS=big)
const BIG = {
  position: [L('head', 'Assets', 0), L('head', 'Current Assets', 1), L('head', 'Bank Accounts', 2),
    L('acct', '1010 Mercury Checking (Operating) - 4321', 3, 312500, 401000), L('acct', '1020 Mercury Savings (Reserve) - 8765', 3, 62500, 60000), L('acct', '1030 Chase Makeover Account - 1199', 3, 233532, 194431),
    L('total', 'Total Bank Accounts', 2, 608532, 655431), L('head', 'Accounts Receivable', 2), L('acct', '1200 Pledges and Grants Receivable', 3, 125000, 40000), L('total', 'Total Accounts Receivable', 2, 125000, 40000),
    L('head', 'Other Current Assets', 2), L('acct', '1400 Store Inventory (Sunshine Shop)', 3, 87235, 69563), L('acct', '1450 Prepaid Expenses and Deposits', 3, 12000, 0), L('total', 'Total Other Current Assets', 2, 99235, 69563),
    L('total', 'Total Current Assets', 1, 832767, 764994), L('head', 'Fixed Assets', 1), L('acct', '1600 Vehicles and Trailers', 2, 58000, 58000), L('acct', '1690 Accumulated Depreciation', 2, -20000, -28000), L('total', 'Total Fixed Assets', 1, 38000, 30000),
    L('total', 'TOTAL ASSETS', 0, 870767, 794994), L('head', 'Liabilities and Equity', 0), L('head', 'Liabilities', 1), L('acct', '2000 Accounts Payable (A/P)', 2, 41250, 18800), L('acct', '2100 Ramp Card', 2, 18432, 22015), L('acct', '2200 Payroll Liabilities', 2, 9811, 7400),
    L('total', 'Total Liabilities', 1, 69493, 48215), L('head', 'Equity', 1), L('acct', '3000 Net Assets Without Donor Restrictions', 2, 612026, 570779), L('acct', 'Net Income', 2, 189248, 176000), L('total', 'Total Equity', 1, 801274, 746779),
    L('total', 'TOTAL LIABILITIES AND EQUITY', 0, 870767, 794994)],
  activity: [L('head', 'Income', 0), L('acct', '4000 Individual/Corporate Revenue', 1, 700000, 400000), L('acct', '4100 Gala Income (Evening of Sunshine)', 1, 400000, 200000), L('acct', '4200 Store Income', 1, 415000, 830000), L('acct', '4210 Store Discounts', 1, -12000, -9000),
    L('acct', '4300 In-Kind Contribution', 1, 220000, 70000), L('acct', '4400 Grant Revenue', 1, 90000, 260000), L('acct', '4500 Golf Classic Income', 1, 30000, 0), L('acct', '4900 Interest Income', 1, 5000, 4200),
    L('total', 'Total Income', 0, 1884217, 1909703), L('head', 'Cost of Goods Sold', 0), L('acct', '5000 Store COGS', 1, 250000, 380000), L('total', 'Total Cost of Goods Sold', 0, 250000, 380000), L('sum', 'Gross Profit', 0, 1634217, 1529703),
    L('head', 'Expenses', 0), L('acct', '6000 Makeover Materials and Subcontractors', 1, 780000, 640000), L('acct', '6100 Salaries and Wages', 1, 410000, 380000), L('acct', '6200 Rent and Occupancy', 1, 96000, 96000), L('acct', '6300 Event Expenses', 1, 120000, 98000),
    L('acct', '6400 Depreciation Expense', 1, 8000, 8000), L('acct', '6900 Bank and Merchant Fees', 1, 30969, 23703), L('total', 'Total Expenses', 0, 1444969, 1245703), L('sum', 'Net Operating Income', 0, 189248, 284000), L('sum', 'Net Income', 0, 189248, 176000)],
  budget: [L('head', 'Income', 0), ...[['4000 Individual/Corporate Revenue', 700000, 500000, 600000], ['4100 Gala Income (Evening of Sunshine)', 400000, 450000, 450000], ['4200 Store Income', 415000, 600000, 720000], ['4300 In-Kind Contribution', 220000, 166667, 200000], ['4400 Grant Revenue', 90000, 250000, 300000], ['4500 Golf Classic Income', 30000, 60000, 60000]].map(([label, a, b, y]) => ({ k: 'acct', label, d: 1, a, b, y })),
    { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }, { k: 'head', label: 'Expenses', d: 0 }, ...[['6000 Makeover Materials and Subcontractors', 780000, 833333, 1000000], ['6100 Salaries and Wages', 410000, 375000, 450000], ['6200 Rent and Occupancy', 96000, 100000, 120000], ['6300 Event Expenses', 120000, 83333, 100000]].map(([label, a, b, y]) => ({ k: 'acct', label, d: 1, a, b, y })),
    { k: 'total', label: 'Total Expenses', d: 0, a: 1444969, b: 1391667, y: 1670000 }, { k: 'sum', label: 'Net Operating Income', d: 0, a: 189248, b: 275000, y: 330000 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, b: 150000, y: 180000 }],
};
await DB.exec('CREATE TABLE IF NOT EXISTS books_link (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, company TEXT, fiscal_start INTEGER, access_token TEXT, access_expires TEXT, refresh_token TEXT NOT NULL, refresh_expires TEXT, ytd TEXT, read_at TEXT, tried_at TEXT, error TEXT, error_at TEXT, error_detail TEXT, told TEXT, linked_at TEXT, linked_by TEXT)');
await DB.exec('CREATE TABLE IF NOT EXISTS books_daily (id TEXT PRIMARY KEY, data TEXT, day TEXT, read_at TEXT, tried_at TEXT, error TEXT)');
/**
 * QuickBooks' read as it's kept: `big` the statements as long as a real one; `sources` (and the revenue they add up to,
 * below-zero ones in it) the year's categories in place of the tester's own (QA_SOURCES)
 */
/* r12: `full`, the walk with everything the page can draw (Board QA round 12, decided 4): real money's cents, QuickBooks'
   bank accounts many (one large, four small: "the smaller accounts together") and two cards owed on, and where the
   money went by purpose */
async function setBooks({ big = false, sources = SOURCES, revenue = null, full = false } = {}) {
  const yr = Y0;
  const src = full ? sources.map((x) => ({ ...x, amount: Math.round((x.amount + (x.key === 'inkind' ? 0.3 : x.key === 'account:makeover' ? 0.5 : 0.45)) * 100) / 100 })) : sources;
  const rev = revenue ?? Math.round(src.reduce((t, x) => t + x.amount, 0) * 100) / 100;
  const spent = full ? 1200000.6 : 1200000;
  const ytd = { year: String(yr), from: `${yr}-01-01`, through: day(0), revenue: rev, spent, net: Math.round((rev - spent) * 100) / 100, basis: 'Accrual', nonCash: full ? 220000.3 : 220000, sources: src,
    store: full ? { sales: 415000.45, cost: 250000.5, profit: 164999.95, salesAccounts: ['Store Income', 'Store Discounts'], costAccounts: ['Store COGS'] } : { sales: 415000, cost: 250000, profit: 165000, salesAccounts: ['Store Income', 'Store Discounts'], costAccounts: ['Store COGS'] },
    ...(full ? { cash: { total: 373501.45, at: new Date().toISOString(), accounts: [{ name: 'Operating', balance: 370000.45 }, { name: 'Savings', balance: 1500.25 }, { name: 'Petty Cash', balance: 900.25 }, { name: 'PayPal', balance: 700.25 }, { name: 'Square', balance: 400.25 }], owed: [{ name: 'Ramp Card', balance: 18432.1, limit: 50000 }, { name: 'Amex Business', balance: 2210.55 }] } } : {}) };
  const lastBooks = { year: String(yr - 1), through: `${yr - 1}${day(0).slice(4)}`, revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, full: { revenue: 2000000, expenses: 1500000, net: 500000, nonCash: 100000 },
    sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)],
    store: { sales: 830000, cost: 380000, profit: 450000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
  const readAt = new Date().toISOString();
  await DB.prepare('INSERT OR REPLACE INTO books_link (id, realm_id, company, refresh_token, ytd, read_at, tried_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('qbo', '9130350000000001', 'Example Charity', 'refresh-test', JSON.stringify(ytd), readAt, readAt).run();
  const thisMonth = Number(day(0).slice(5, 7));
  const monthly = { year: String(yr), lastYear: String(yr - 1),
    months: Array.from({ length: thisMonth }, (_, i) => ({ month: `${yr}-${String(i + 1).padStart(2, '0')}`, revenue: Math.round(rev / thisMonth), spent: Math.round(1200000 / thisMonth), nonCash: Math.round(220000 / thisMonth) })),
    last: Array.from({ length: 12 }, (_, i) => ({ month: `${yr - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000, spent: 125000, nonCash: 8000 })) };
  const lines = big ? BIG : SMALL;
  const statements = { asOf: day(-30), closed: false, priorAsOf: `${yr - 1}${day(-30).slice(4)}`, position: lines.position, activity: lines.activity };
  const budget = { name: `Budget_FY${String(yr).slice(2)}_P&L`, from: `${yr}-01-01`, to: `${yr}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 }, rows: lines.budget };
  const functions = full ? { list: [{ name: 'Program Services', amount: 760000.45 }, { name: 'Management and General', amount: 130000.45 }, { name: 'Fundraising', amount: 70000.45 }, { name: 'Store Operations', amount: 15000.45 }, { name: 'Unassigned', amount: 4999.2 }], total: 980001 } : null;
  await DB.prepare('INSERT OR REPLACE INTO books_daily (id, data, day, read_at, tried_at) VALUES (?, ?, ?, ?, ?)').bind('qbo', JSON.stringify({ shape: 3, day: day(0), lastYear: lastBooks, trailing: null, months: [], statements, functions, monthly, budget }), day(0), readAt, readAt).run();
  // (What makeovers cost, as the heartbeat keeps it from JobTread: completed makeovers, two dream bedrooms among them,
  // one underway, a family waiting; made up)
  await stateReady(DB);
  await DB.exec("DELETE FROM board_state WHERE key = 'costs'");
  if (full) {
    const now = new Date().toISOString();
    const done = (key, name, season, rooms, cost) => ({ key, name, slug: null, kind: 'kid', season, rooms, roomCount: rooms.length, type: /Bath/.test(rooms[0]) ? 'bathroom' : /Therapy/.test(rooms[0]) ? 'therapy' : 'bedroom', cost, jobs: 1, closed: `${season}-10-01` });
    await writeState(DB, 'costs', { at: now, value: { at: now, makeovers: [done('k:ava-ex', 'Ava', Y0, ['Bedroom'], 21500), done('k:ben-ex', 'Ben', Y0, ['Bathroom'], 34250), done('k:cal-ex', 'Cal', Y0 - 1, ['Therapy Room'], 18750), done('k:dee-ex', 'Dee', Y0 - 1, ['Bedroom'], 26400), done('k:eli-ex', 'Eli', Y0, ['Bathroom'], 41000), done('k:fin-ex', 'Fin', Y0 - 1, ['Bathroom'], 30100)],
      noBills: [], reveals: [], skipped: 0, underway: [{ revealOn: null, season: Y0, key: 'u:jEve', name: 'Eve', jobId: null, kind: 'kid', status: 'Build', rooms: ['Bedroom'], type: 'bedroom', paid: 8200, budget: 23000 }],
      waiting: [{ key: 'k:fay-ex', name: 'Fay', slug: null, kind: 'kid', season: Y0 + 1, rooms: ['Bedroom'], type: 'bedroom', jobId: 'jFay', sponsors: [], since: day(-60) }] } });
  }
}
await setBooks();
/** No QuickBooks: Mercury's record is the year (QA round 10's walk without it) */
async function noBooks() { await DB.exec('DELETE FROM books_link'); await DB.exec('DELETE FROM books_daily'); }
/**
 * The cash at each month's end the heartbeat keeps (made up), so Financials draws Cash over time and its month-end
 * balances, each month's change beside it; `on` false takes them away again
 */
async function setHistory(on = true) {
  await DB.exec('DELETE FROM board_cash');
  if (!on) return;
  for (let i = 0; i < 14; i++) {
    const at = new Date(Date.UTC(Y0, Number(day(0).slice(5, 7)) - 1 - i, 15));
    await DB.prepare('INSERT INTO board_cash (month, total, accounts, at) VALUES (?, ?, ?, ?)').bind(at.toISOString().slice(0, 7), 301234 + ((i * 37) % 9) * 11000 + i * 250, '[]', at.toISOString()).run();
  }
}

// This year's major gifts from a pretend Zeffy (made-up givers)
const zeffyPay = (id, daysAgo, dollars, o = {}) => ({ id, created: Math.floor((Date.now() - daysAgo * 864e5) / 1000), amount: dollars * 100, currency: 'usd', status: 'succeeded', type: 'online', refund_status: 'none', refunds: [], description: 'Evening of Sunshine', buyer: { first_name: 'Dana', last_name: 'Example', email: 'dana@example.com', is_corporate: false }, buyer_questions: [], items: [], recurring: null, ...o });
await maybeReadGifts({ DB, ZEFFY_API_KEY: 'zk-test' }, { fetchImpl: async () => Response.json({ object: 'list', data: [
  zeffyPay('pay_q0001', 1, 25000, { buyer: { first_name: 'Lee', last_name: 'Sample', is_corporate: true, company_name: 'The Sample Family Foundation' } }),
  zeffyPay('pay_q0002', 2, 5000, { description: 'Help build Maya’s room' }),
  ...Array.from({ length: 6 }, (_, i) => zeffyPay(`pay_q01${i}0`, 10 + i * 9, 1000 + i * 750, { buyer: { first_name: ['Robin', 'Casey', 'Jordan', 'Morgan', 'Avery', 'Quinn'][i], last_name: 'Example', email: `giver${i}@example.com`, is_corporate: false } })),
], has_more: false, next_cursor: null }) });

// ── The outside world, faked ──
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPw8PAAAAMkAVHY5VgwAAAAAElFTkSuQmCC', 'base64');
const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', JOBTREAD_GRANT_KEY: 'jt-test', MERCURY_API_TOKEN: 'mercury-test', MERCURY_RELAY_KEY: 'relay-test' };
const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
const JOBS = [JOB('j1', `Maya (${Y0})`, 'Build'), JOB('j2', `Leo (${Y0})`, 'Design'), JOB('j3', `Someone Else (${Y0})`, 'Awaiting Funding'), JOB('j4', `Not Published Yet (${Y0})`, 'Design')];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (/googleapis\.com\//.test(url)) return Response.json({ items: [], members: [], messages: [], files: [], conferenceRecords: [] });
  // Mercury's two accounts: $312,500 and $62,500, $375,000 in the bank
  if (url === 'https://mercury-relay.sunshineonaranneyday.com/api/v1/accounts') return Response.json({ accounts: [{ name: 'Operating', kind: 'checking', type: 'mercury', status: 'active', currentBalance: 312500 }, { nickname: 'Reserve', kind: 'savings', type: 'mercury', status: 'active', currentBalance: 62500 }] });
  if (url.startsWith('https://mercury-relay.sunshineonaranneyday.com/')) return Response.json({ transactions: [], accounts: [] });
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
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(Y0 - 1, 10 + i, 15)).toISOString().slice(0, 7), income: 80000, makeovers: 40000, store: 12000, operating: 18000, storeSales: 25000, net: 10000 })),
  ytd: { year: Y0, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 },
  lastYtd: { year: Y0 - 1, through: day(-365), income: 800000, makeovers: 480000, store: 140000, operating: 200000, net: -20000 },
  cash: { today: 375000, lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000, belowFloor: false },
  perMakeover: { count: 12, average: 21000 },
}));

// ── The meetings: the next one, its money item (the slide), on the board page ──
const board = (status = '') => (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board', status });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash' }] },
];
const NEXT = await getMeeting(DB, (await patchMeeting(DB, (await saveMeeting(DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: AGENDA, agendaFrom: typed }), { by: FOUNDER })).id, (cur) => ({ ...cur, shared: true }))).id);
const FIN = NEXT.sections.flatMap((s) => s.items.map((it) => ({ ...it, sectionId: s.id }))).find((it) => it.live === 'cash');

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
async function tab(email, width = 1280, height = 900) {
  const page = await within(15000, browser.newPage());
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  const phone = width < 600;
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await page.setExtraHTTPHeaders({ 'x-test-user': email });
  page.on('pageerror', (e) => errs.push(`${email} ${width}: PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|x-test-user|403|404/.test(m.text())) errs.push(`${email} ${width}: ${m.text().slice(0, 300)}`); });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/tile\.openstreetmap\.org|imagedelivery\.net/.test(r.url())) return r.respond({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
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
  if (ONLY && !ONLY.has(name.split(':')[0])) return;
  console.log(`\n${name}`);
  try { await fn(); } catch (err) {
    const why = String(err?.message || err).split('\n')[0];
    failures.push(`${name}: a step stopped: ${why}`);
    console.log(`  ✗ a step stopped: ${why}`);
    await relaunch();
  }
}
const shot = async (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});

/** Search as a person types it, once what it finds has settled: each result, its group, its title, its line, its marks */
async function search(p, q) {
  if (!(await p.$('dialog.bp-finder[open]'))) { await p.click('button.bp-find'); await p.waitForSelector('dialog.bp-finder[open] input', { timeout: 5000 }); await sleep(250); }
  await p.$eval('dialog.bp-finder input', (i) => { i.focus(); i.select(); });
  await p.keyboard.press('Backspace');
  await p.keyboard.type(q, { delay: 8 });
  let last = '';
  for (let k = 0; k < 16; k++) { await sleep(300); const cur = await p.evaluate(() => document.querySelector('.bp-finder__list')?.innerText || ''); if (cur === last && !/Looking in the files/.test(cur)) break; last = cur; }
  return p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=group]')].flatMap((g) => {
    const gname = (g.querySelector('.bp-finder__group span')?.textContent || '').replace(/,.*$/, '');
    // (its marks in its line, and in its title when that says the amount: a gift's)
    return [...g.querySelectorAll('[role=option]')].map((x) => ({ id: x.id, g: gname, title: (x.querySelector('.bp-finder__title')?.innerText || '').trim(), line: [...x.querySelectorAll('.bp-finder__sub')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()).join(' / '), marks: [...x.querySelectorAll('.bp-finder__sub mark, .bp-finder__title mark')].map((m) => m.textContent) }));
  }));
}
/** Where a pick from the search landed: the page, the place marked, in view and focused, and the words marked there */
async function landing(p) {
  await p.waitForFunction(() => !document.querySelector('dialog.bp-finder[open]') && !!document.querySelector('.is-found') && (document.activeElement === document.querySelector('.is-found') || document.querySelector('.is-found').contains(document.activeElement)), { timeout: 6000 }).catch(() => {});
  await p.waitForFunction(() => { const r = document.querySelector('.is-found')?.getBoundingClientRect(); return !!r && r.bottom > 0 && r.top < innerHeight; }, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  return p.evaluate(() => {
    const el = document.querySelector('.is-found');
    const r = el?.getBoundingClientRect();
    const hl = window.CSS?.highlights?.get('bp-found');
    return { hash: location.hash, id: el?.id || '', inView: !!r && r.bottom > 0 && r.top < innerHeight && r.height > 0, focused: !!el && (document.activeElement === el || el.contains(document.activeElement)), marked: hl ? [...hl].map((x) => x.toString()) : [], text: (el?.innerText || '').replace(/\s+/g, ' ').slice(0, 140) };
  });
}
/** An amount as a number: "$1.88M" 1880000, "−$12,000" -12000, "(12,000)" -12000 */
const valueOf = (s) => { const m = String(s).match(/([−(-])?\+?\$?([\d,]+(?:\.\d+)?)\s?([KMB])?/); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]] || 1) : NaN; };
const plainAmt = (s) => String(s).replace(/^[+−(-]+|\)$/g, '').replace(/[\s$]/g, '').toUpperCase();

try {
  // ─── R1: every statement line lands ───
  await step('R1: every line of QuickBooks’ statements picked from search lands on its row, “Every account” open for a folded one: by click at 1280, by Enter at 390, by the keyboard at 768', async () => {
    await setBooks({ big: true });
    const d = await (await fetch(`${SITE}/api/board-portal`, { headers: { 'x-test-user': SAM } })).json();
    const st = d.numbers.books.statements;
    const bud = d.numbers.books.budget?.rows?.length && d.numbers.books.budget.asOf === st.asOf ? d.numbers.books.budget : null;
    const NAME = { act: 'on the statement of activities', bud: 'on the budget against actual', pos: 'on the statement of financial position' };
    const TAB = { act: 'Activities', bud: 'Budget', pos: 'Financial position' };
    const lines = [];
    for (const [which, rows] of [['act', st.activity], ['bud', bud?.rows], ['pos', st.position]]) (rows || []).forEach((r, i) => { if (r.k !== 'head' && typeof r.a === 'number' && r.label) lines.push({ which, i, r }); });
    ok(lines.length === 57, `57 lines on the three statements (${lines.length})`);
    const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US')}`;
    // (WIDTHS=1280 one of them alone)
    for (const [who, w, by, how] of [[SAM, 1280, 'label', 'click'], [MARIA, 390, 'amount', 'enter'], [TAYLOR, 768, 'label', 'keys']].filter(([, w0]) => !process.env.WIDTHS || process.env.WIDTHS.split(',').includes(String(w0)))) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1500);
      const bad = [];
      let folded = 0;
      for (const { which, i, r } of lines) {
        await go(p, '#/');
        const q = by === 'label' ? r.label : money(r.a);
        let found = await search(p, q);
        const mine = (x) => x.title === r.label && x.line.includes(NAME[which]) && x.line.includes(money(r.a));
        // (an amount many figures have, "$400,000": the rest of Money opened with its "All", as a person does)
        if (!found.some(mine) && await p.evaluate(() => { const b = [...document.querySelectorAll('.bp-finder [role=group]')].find((g) => /^Money/.test(g.querySelector('.bp-finder__group span')?.textContent || ''))?.querySelector('.bp-finder__all'); b?.click(); return !!b; })) {
          await sleep(500);
          found = await p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=option]')].map((x) => ({ id: x.id, title: (x.querySelector('.bp-finder__title')?.innerText || '').trim(), line: [...x.querySelectorAll('.bp-finder__sub')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()).join(' / ') })));
        }
        const at = found.findIndex(mine);
        if (at < 0) { bad.push(`${which} r${i} “${r.label}”: not found for “${q}”`); await p.keyboard.press('Escape'); await sleep(300); continue; }
        if (how === 'click') await p.click(`#${found[at].id}`);
        else {
          // (to it with ↓ from the first, then Enter, as a person on a keyboard does)
          const now = await p.evaluate(() => Number((document.querySelector('.bp-finder [aria-selected="true"]')?.id || 'bp-r-0').slice(5)));
          const want = Number(found[at].id.slice(5));
          for (let k = now; k < want; k++) await p.keyboard.press('ArrowDown');
          await p.keyboard.press('Enter');
        }
        const l = await landing(p);
        const id = `st-${which}-r${i}`;
        const there = await p.evaluate((rowId, tabName) => {
          const el = document.getElementById(rowId);
          const btn = el?.closest('.bp-stmt')?.querySelector('.bp-more-btn');
          return { exists: !!el, row: el?.querySelector('th')?.textContent || '', tab: [...document.querySelectorAll('.bp-stmts [aria-pressed="true"]')].map((x) => x.textContent.trim()).some((x) => x.startsWith(tabName)), all: btn ? btn.getAttribute('aria-expanded') : 'none' };
        }, id, TAB[which]);
        if (there.all === 'true') folded += 1;
        if (!(l.hash === '#/financials' && l.id === id && l.inView && l.focused && there.exists && there.row === r.label && there.tab)) bad.push(`${which} r${i} “${r.label}”: ${JSON.stringify({ ...l, ...there, marked: undefined, text: undefined })}`);
      }
      ok(!bad.length, `${w}, ${how}: all ${lines.length} lines land on their row, drawn, marked and focused (${folded} with “Every account” opened)${bad.length ? `; ${bad.length} didn’t: ${bad.slice(0, 4).join(' | ')}` : ''}`);
      await shot(p, `r1-${how}-${w}`);
      await close(p);
    }
    await setBooks();
  });

  // ─── R2: every figure drawn is found as it's written, and lands on it ───
  // (the figures as drawn: not a chart's axis, a hover's readout, or "$1,000 or more"; the month-by-month tables under
  // the charts included since QA round 10, which found none of their 42 amounts in search)
  const figuresDrawn = (page, scope = 'main') => page.evaluate((sel) => {
    const RE = /[−-]?\+?\(?\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s?[KMB])?\)?/g;
    const out = [];
    const skip = (e) => !e || !e.getClientRects().length || !!e.closest('[hidden], .sr-only, dialog, .by-axis, .bc-axis, [aria-hidden="true"], .bp-finder, svg');
    const root = document.querySelector(sel) || document.body;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (skip(n.parentElement)) continue;
      for (const m of n.nodeValue.matchAll(RE)) {
        const after = n.nodeValue.slice(m.index + m[0].length, m.index + m[0].length + 9);
        if (/^ or more/.test(after) || /^\$0$/.test(m[0])) continue;
        out.push({ said: m[0].replace(/^\(|\)$/g, '').trim(), where: n.parentElement.closest('[id]')?.id || '', line: (n.parentElement.closest('li, tr, p, figcaption, .bp-fig, .bc-answer__money, div')?.innerText || '').replace(/\s+/g, ' ').slice(0, 90) });
      }
    }
    return out;
  }, scope);
  await step('R2: every money figure drawn on Home, Financials, the next meeting’s money and its slide is found as it’s written, its line marking it, and lands on it, marked: with QuickBooks and without it, every fold and table opened', async () => {
   // (QA round 10: with QuickBooks, and without it, Mercury's record of the year then; the month-end balances in both.
   // WALKS=books or WALKS=mercury walks one alone)
   await setHistory(true);
   for (const mode of ['books', 'mercury', 'full' /* r12: and with everything the page can draw, cents and all */].filter((x) => !process.env.WALKS || process.env.WALKS.split(',').includes(x))) {
    if (mode === 'books' || mode === 'full') await setBooks({ full: mode === 'full' }); else await noBooks();
    console.log(`  (${mode === 'books' ? 'with QuickBooks' : mode === 'full' ? 'with QuickBooks, cents, many accounts, the cards owed, where it went and what makeovers cost' : 'without QuickBooks: Mercury’s record'})`);
    // What's drawn, walked: Home; Financials with every fold and table opened ("Line by line", the store's, what
    // makeovers cost, "The numbers, month by month", "Month by month", "Month-end balances"); the meeting's money item,
    // its folds opened too; and the money slide, as the presenter shows it
    const drawn = [];
    const p0 = await tab(SAM, 1280, 900);
    await open(p0, '#/');
    await sleep(1500);
    drawn.push(...(await figuresDrawn(p0)).map((x) => ({ ...x, page: 'Home' })));
    await go(p0, '#/financials');
    await sleep(2500);
    await p0.evaluate(() => document.querySelectorAll('main details').forEach((x) => { x.open = true; }));
    await sleep(800);
    drawn.push(...(await figuresDrawn(p0)).map((x) => ({ ...x, page: 'Financials' })));
    await go(p0, `#/meetings/${NEXT.id}`);
    await sleep(2500);
    await p0.evaluate((sel) => document.querySelectorAll(`${sel} details`).forEach((x) => { x.open = true; }), `#i-${FIN.id}`);
    await sleep(600);
    drawn.push(...(await figuresDrawn(p0, `#i-${FIN.id}`)).map((x) => ({ ...x, page: 'the meeting' })));
    await close(p0);
    const ps = await tab(FOUNDER, 1280, 720);
    await within(30000, ps.goto(`${SITE}/admin/board/?present&at=${encodeURIComponent(FIN.id)}#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
    await ps.waitForFunction(() => [...document.querySelectorAll('.bs-figs li')].some((li) => /Cash in the bank/.test(li.textContent)), { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    drawn.push(...(await figuresDrawn(ps, '.bs-money')).map((x) => ({ ...x, page: 'the slide' })));
    await shot(ps, `r2-slide-${mode}`);
    await close(ps);
    const forms = [...new Map(drawn.map((x) => [plainAmt(x.said) + (/^[−(-]/.test(x.said) ? '-' : ''), x])).values()];
    // (the month-by-month tables, the month-end balances and Mercury's months are in it: QA round 10)
    const tables = drawn.filter((x) => /^(fy|y[a-z0-9_]+)-m\d+-|^cm-|^io-m-/.test(x.where)).length;
    ok(mode !== 'mercury' /* r12: the full walk as the books' */ ? drawn.length >= 150 && forms.length >= 100 && tables >= 60 : drawn.length >= 60 && forms.length >= 45 && tables >= 40, `${mode}, walked: ${tables} in the tables of ${drawn.length} figures drawn (Home ${drawn.filter((x) => x.page === 'Home').length}, Financials ${drawn.filter((x) => x.page === 'Financials').length}, the meeting ${drawn.filter((x) => x.page === 'the meeting').length}, the slide ${drawn.filter((x) => x.page === 'the slide').length}), ${forms.length} written ways`);
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1500);
      const missed = [];
      const unmarked = [];
      const astray = [];
      for (const f of who === SAM ? forms : forms.filter((_, i) => i % 3 === 0)) {
        const v = valueOf(f.said);
        // Its results: each Money one whose line (or title) marks it as written or by its exact amount
        const markOf = (x) => x.marks.some((m) => plainAmt(m) === plainAmt(f.said) || Math.abs(Math.abs(valueOf(m)) - Math.abs(v)) < 0.5);
        let found = await search(p, f.said);
        const cands = found.filter((x) => x.g === 'Money' && markOf(x));
        if (!cands.length) { missed.push(`“${f.said}” (${f.page}: ${f.line.slice(0, 60)}) → ${JSON.stringify(found.slice(0, 3).map((x) => `${x.g}: ${x.title}`))}`); await p.keyboard.press('Escape'); await sleep(250); continue; }
        // …and one of them lands on it: in view, focused, the figure marked there in a form it's written in (as typed,
        // or the result's own amount exactly or in short)
        let good = null;
        let last = null;
        for (const [k, c] of cands.slice(0, 3).entries()) {
          if (k) { found = await search(p, f.said); }
          const x = found.find((y) => y.title === c.title && y.line === c.line);
          if (!x) continue;
          await p.click(`#${x.id}`);
          const l = await landing(p);
          const own = valueOf((x.line.match(/[−-]?\$[\d,]+/) || x.title.match(/[−-]?\$[\d,]+/) || [''])[0]);
          const forms2 = new Set([plainAmt(f.said), plainAmt(money(Math.abs(own))), plainAmt(compact(Math.abs(own)))]);
          const there = l.marked.some((m) => forms2.has(plainAmt(m)) || Math.abs(Math.abs(valueOf(m)) - Math.abs(v)) < 0.5 || Math.abs(Math.abs(valueOf(m)) - Math.abs(own)) < 0.5);
          last = { x, l, there };
          await go(p, '#/');
          if (/^#\/(financials|meetings\/)/.test(l.hash) && l.id && l.inView && l.focused && there) { good = last; break; }
        }
        if (!good) {
          if (!last || !/^#\/(financials|meetings\/)/.test(last.l.hash) || !last.l.id || !last.l.inView || !last.l.focused) astray.push(`“${f.said}” → ${last?.x.title}: ${JSON.stringify({ hash: last?.l.hash, id: last?.l.id, inView: last?.l.inView, focused: last?.l.focused })}`);
          else unmarked.push(`“${f.said}” → ${last.x.title} at #${last.l.id}: marked ${JSON.stringify(last.l.marked)} in “${last.l.text.slice(0, 70)}”`);
        }
      }
      const n = who === SAM ? forms.length : forms.filter((_, i) => i % 3 === 0).length;
      ok(!missed.length, `${mode}, ${w}: each of ${n} figures as written is found, its line marking it${missed.length ? `; ${missed.length} not: ${missed.slice(0, 5).join(' | ')}` : ''}`);
      ok(!astray.length, `${mode}, ${w}: picking each lands where it's drawn, in view${astray.length ? `; ${astray.length} didn’t: ${astray.slice(0, 4).join(' | ')}` : ''}`);
      ok(!unmarked.length, `${mode}, ${w}: marked where it lands${unmarked.length ? `; ${unmarked.length} not: ${unmarked.slice(0, 4).join(' | ')}` : ''}`);
      await close(p);
    }
   }
   await setBooks();
   await setHistory(false);
  });

  // The tester's lists (QA round 9's s9a, s9b, s9c, s9d, s9e): [typed, words the right result has ('-': nothing in Money)]
  const LISTS = {
    small: [['375000', 'Cash in the bank'], ['$375K', 'Cash in the bank'], ['375 thousand', 'Cash in the bank'], ['312500', 'Operating'], ['$312.5K', 'Operating'], ['313k', 'Operating'], ['62.5k', 'Reserve'], ['$63K', 'Reserve'],
      ['1656045', `${Y0} revenue`], ['$1.66M', `${Y0} revenue`], ['1.66 million', `${Y0} revenue`], ['$980K', `${Y0} expenses`], ['0.98 million', `${Y0} expenses`], ['$0.98M', `${Y0} expenses`], ['+$676K', `${Y0} net`], ['676 thousand', `${Y0} net`],
      ['$1.88M', 'revenue, in kind included'], ['1.88 million', 'revenue, in kind included'], ['1876045', 'revenue, in kind included'], ['$1.8M', 'budget'], ['1,800,000', 'budget'], ['$1.3M', 'budget'], ['$220K', 'In kind'], ['$51K', 'Everything else'],
      ['$700K', 'Donations'], ['$415K', 'store'], ['$250K', 'cost of goods'], ['$165K', 'store'], ['$285K', 'store'], ['$830,000', 'store'], ['$47,250', 'gifts'], ['$1,750', 'Casey'], ['$1.75K', 'Casey'], ['$276K', 'net'],
      ['$1,884,217', 'Total Income'], ['1.88M', 'Total Income'], ['$1,909,703', 'Total Income'], ['189248', 'Net Income'], ['$189K', 'Net Income'], ['176000', 'Net Income'], ['$608,532', 'Bank'], ['$870,767', 'TOTAL ASSETS'],
      ['$125,000', 'short'], ['$500,000', 'run SOARD'], ['$1,000,000', `${Y0 - 1}`], ['$750,000', 'programs'], ['$1.5M', `${Y0 - 1}`], ['$2M', `${Y0 - 1}`], ['$1.03M', `${Y0 - 1}`], ['$1.4M', `${Y0 - 1}`],
      ['$210,000', 'Lowest'], ['$210K', 'Lowest'], ['$260K', '13 weeks'], ['lowest ahead', 'Lowest'],
      ['$1.66 M', `${Y0} revenue`], ['1.66mil', `${Y0} revenue`], ['1.66 mil', `${Y0} revenue`], ['$676 K', `${Y0} net`], ['676,045.00', `${Y0} net`], ['$0.4M', 'Gala'],
      // (near misses, and a sign typed with nothing below zero: nothing)
      ['1,656,046', '-'], ['1656045.5', '-'], ['$1.65M', '-'], ['375,000.50', '-'], ['$1.656M', '-'], ['1,656K', '-'], ['1.7 million', '-'], ['$870.8K', '-'], ['-12000', '-'], ['-676k', '-'],
      // (QA round 10's: an amount typed the common ways, "MM" millions, "dollars" a small word; a near one still nothing)
      ['676 K', `${Y0} net`], ['676 k', `${Y0} net`], ['$.98M', `${Y0} expenses`], ['.98M', `${Y0} expenses`], ['$.375M', 'Cash in the bank'], ['$1.66MM', `${Y0} revenue`], ['1.66 million dollars', `${Y0} revenue`], ['676 thousand dollars', `${Y0} net`],
      ['$1.65MM', '-'], ['.96M', '-'], ['677 K', '-'], ['1.7 million dollars', '-'], ['- 676k', '-']],
    // (s9d: Maria's at 390)
    again: [['$1.8M', 'budget'], ['$1.3M', 'budget'], ['$1.88M', 'revenue, in kind included'], ['1876045', 'revenue, in kind included'], ['$47,250', 'gifts'], ['$125,000', 'short'], ['$210,000', 'Lowest'], ['$750,000', 'programs'],
      ['$312.5K', 'Operating'], ['62.5k', 'Reserve'], ['$1.75K', 'Casey'], ['1.88M', 'Total Income'], ['$189K', 'Net Income'], ['$1,909,703', 'Total Income'], ['176000', 'Net Income']],
    big: [['-12,000', 'Store Discounts'], ['−$12,000', 'Store Discounts'], ['(12,000)', 'Store Discounts'], ['-$20K', 'Accumulated Depreciation'], ['$1.63M', 'Gross Profit'], ['1.63 million', 'Gross Profit'], ['$1,529,703', 'Gross Profit'], ['234k', 'Chase'], ['$1.44M', 'Total Expenses'], ['$233.5K', '-'], ['12,000', 'Store Discounts'], ['12,000', 'Prepaid'],
      // (QA round 10's: a sign or bracket apart from the amount, "negative", "MM": below zero only, never the prepaid)
      ['- $12,000', 'Store Discounts'], ['$-12,000', 'Store Discounts'], ['− 12,000', 'Store Discounts'], ['- 12,000', 'Store Discounts'], ['( 12,000 )', 'Store Discounts'], ['negative 12,000', 'Store Discounts'], ['- $20K', 'Accumulated Depreciation'], ['$1.63MM', 'Gross Profit']],
  };
  await step('R2: the tester’s lists: each typed form finds its figure, marked, the line saying the amount that matched; near misses find nothing; a sign finds only what’s below zero', async () => {
    for (const [books, list, who, w] of [['small', LISTS.small, SAM, 1280], ['small', LISTS.again, MARIA, 390], ['big', LISTS.big, SAM, 1280]]) {
      await setBooks({ big: books === 'big' });
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1500);
      const bad = [];
      for (const [q, want] of list) {
        const found = await search(p, q);
        const money = found.filter((x) => x.g === 'Money');
        if (want === '-') { if (money.length) bad.push(`“${q}” should find nothing: ${JSON.stringify(money.map((x) => `${x.title}: ${x.line.slice(0, 50)}`))}`); continue; }
        const re = new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const hit = money.find((x) => re.test(`${x.title} ${x.line}`));
        if (!hit || !hit.marks.length) bad.push(`“${q}” → ${hit ? `${hit.title}, nothing marked` : `no ${want}: ${JSON.stringify(found.slice(0, 3).map((x) => x.title))}`}`);
        if (/[−(-]|negative/.test(q) && /12,000/.test(q) && money.some((x) => /Prepaid/.test(x.title))) bad.push(`“${q}” found the prepaid $12,000 too`);
      }
      ok(!bad.length, `${w}, ${books} books: ${list.length} typed${bad.length ? `; ${bad.length} wrong: ${bad.slice(0, 5).join(' | ')}` : ''}`);
      await close(p);
    }
    await setBooks();
  });

  // ─── R3 and R7: a category below zero, and a change that rounds to nothing ───
  const mixNow = async (p) => {
    await go(p, '#/');
    await p.waitForSelector('.bp-sum__mix .bp-mix__key li', { timeout: 10000 }).catch(() => {});
    await sleep(500);
    const home = await p.evaluate(() => ({
      shares: [...document.querySelectorAll('.bp-sum__mix .bp-mix__key li')].map((li) => li.querySelector('span:last-child')?.textContent || ''),
      less: (document.querySelector('.bp-sum__mix .bp-mix__less')?.textContent || '').replace(/\u00a0/g, ' '),
      bar: (() => { const b = document.querySelector('.bp-sum__mix .bp-mix__bar'); if (!b) return null; const r = b.getBoundingClientRect(); return { right: Math.round(r.right), segs: Math.round(Math.max(...[...b.querySelectorAll('.bp-mix__seg')].map((s) => s.getBoundingClientRect().right))) }; })(),
      tile: [...document.querySelectorAll('.bp-fig')].map((x) => x.innerText.replace(/\s+/g, ' ')).find((t) => /REVENUE/i.test(t)) || '',
    }));
    await go(p, '#/financials');
    await p.waitForSelector('.bp-mixtable tbody tr', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    const fin = await p.evaluate(() => ({
      rows: [...document.querySelectorAll('.bp-mixtable tbody tr')].map((tr) => ({ name: tr.querySelector('.bp-mixtable__name')?.textContent.trim() || '', amount: (tr.querySelector('td.num')?.firstChild?.textContent || '').trim() /* r11: a real space now parts the amount from its share, so a screen reader hears them apart */, share: tr.querySelector('td.num small')?.textContent || '', change: tr.querySelector('.bp-cmp__chg')?.innerText.trim() || '' })),
      less: (document.querySelector('#mix-less')?.textContent || '').replace(/\u00a0/g, ' '),
    }));
    // (each part's readout on hover)
    fin.tips = [];
    for (const seg of await p.$$('.bp-mixcard .bp-mix__seg')) { await seg.hover(); await sleep(120); fin.tips.push(await p.evaluate(() => document.querySelector('.bp-mixcard .bp-mix__tip')?.innerText.replace(/\s+/g, ' ') || '')); }
    await p.mouse.move(2, 2);
    // Print it all, from the next meeting (the print itself stubbed: its page read)
    await go(p, `#/meetings/${NEXT.id}`);
    await sleep(1500);
    await p.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Print it all/.test(x.textContent))?.click());
    await p.waitForFunction(() => !!document.querySelector('.bpp-mix') || window.__printed, { timeout: 30000 }).catch(() => {});
    await sleep(800);
    const print = await p.evaluate(() => ({ rows: [...document.querySelectorAll('.bpp-mix tbody tr')].map((tr) => [...tr.children].map((c) => c.innerText.trim())), less: (document.querySelector('.bpp-mix__less')?.textContent || '').replace(/\u00a0/g, ' ') }));
    await p.evaluate(() => document.querySelectorAll('.bpp, .bp-print, [class^="bpp-"]').forEach((x) => { if (x.parentElement === document.body) x.remove(); }));
    return { home, fin, print };
  };
  const sumPct = (l) => l.reduce((t, s) => t + (Number((String(s).match(/(\d+)%/) || [])[1]) || 0), 0);
  await step('R3: a category below zero: the parts are what came in, adding to 100%, the bar within its end, and it said by its name under the mix, on Home, Financials and Print it all', async () => {
    for (const [name, sources, revenue, lessHome, lessFull] of [
      ['sh-neg (Refunds −$20,000)', [cat('donations', 'Donations', 600000), cat('store', 'Store sales', 420000), cat('account:refunds', 'Refunds', -20000)], 1000000, 'Less $20K in Refunds.', 'Less $20,000 in Refunds.'],
      ['sh-neg2 (Refunds −$35,000)', [cat('donations', 'Donations', 500000), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 200000), cat('account:refunds', 'Refunds', -35000)], 965000, 'Less $35K in Refunds.', 'Less $35,000 in Refunds.'],
      ['sh-neg as an older read kept it (the refunds dropped)', [cat('donations', 'Donations', 600000), cat('store', 'Store sales', 420000)], 1000000, 'Less $20K in income accounts below zero.', 'Less $20,000 in income accounts below zero.'],
    ]) {
      await setBooks({ sources, revenue });
      for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
        const p = await tab(who, w, 900);
        await open(p, '#/');
        await sleep(1200);
        const m = await mixNow(p);
        const parts = m.fin.rows.reduce((t, r) => t + valueOf(r.amount), 0);
        ok(sumPct(m.home.shares) === 100 && m.home.less === lessHome && m.home.bar && m.home.bar.segs <= m.home.bar.right + 1, `${name}, ${w}, Home: ${m.home.shares.join(' + ')} = ${sumPct(m.home.shares)}%, “${m.home.less}”, the bar ends at ${m.home.bar?.segs} of ${m.home.bar?.right}`);
        ok(sumPct(m.fin.rows.map((r) => r.share)) === 100 && m.fin.less === lessFull && parts - valueOf(lessFull.replace(/^Less /, '')) === revenue, `${name}, ${w}, Financials: ${m.fin.rows.map((r) => `${r.name} ${r.amount} ${r.share}`).join(', ')}, “${m.fin.less}”: the parts less it, ${parts - valueOf(lessFull.replace(/^Less /, ''))}, the revenue (${revenue}); its tile “${m.home.tile.slice(0, 40)}”`);
        ok(sumPct(m.print.rows.map((r) => r[2])) === 100 && m.print.less === lessFull, `${name}, ${w}, Print it all: ${m.print.rows.map((r) => `${r[0]} ${r[2]}`).join(', ')}, “${m.print.less}”`);
        if (w === 390) await shot(p, `r3-${name.slice(0, 7)}-${w}`);
        await close(p);
      }
    }
    await setBooks();
  });
  await step('R7: a change that rounds to 0% says Even: Financials’ table, its tooltip, Print it all (Gala $200,000 beside $200,000; Donations $401,234 beside $400,000)', async () => {
    for (const [name, sources, who, part] of [
      ['sh-neg2', [cat('donations', 'Donations', 500000), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 200000), cat('account:refunds', 'Refunds', -35000)], MARIA, 'Gala'],
      ['sh-many', [cat('donations', 'Donations', 401234), cat('store', 'Store sales', 251111), cat('gala', 'Gala', 149876), cat('grants', 'Grants', 61555), cat('account:golf classic', 'Golf Classic', 40407), cat('account:rent', 'Rent', 30333), cat('account:interest', 'Interest', 19250), cat('account:sponsorships', 'Sponsorships', 11111), cat('account:misc', 'Misc', 9123), cat('account:auction', 'Auction', 6000), cat('account:raffle', 'Raffle', 4321), cat('account:makeover', 'Makeover', 45)], SAM, 'Donations'],
    ]) {
      await setBooks({ sources });
      const w = who === MARIA ? 390 : 1280;
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1200);
      const m = await mixNow(p);
      const row = m.fin.rows.find((r) => r.name.startsWith(part));
      const tip = m.fin.tips.find((t) => t.startsWith(part)) || '';
      const pr = m.print.rows.find((r) => r[0].startsWith(part));
      const zero = /[▲▼] 0%/;
      ok(row?.change === 'Even' && /Even/.test(tip) && pr?.at(-1) === 'Even' && !m.fin.rows.some((r) => zero.test(r.change)) && !m.fin.tips.some((t) => zero.test(t)) && !m.print.rows.some((r) => zero.test(r.join(' '))), `${name}, ${w}: ${part} says Even in the table (“${row?.change}”), its tooltip (“${tip}”) and Print (“${pr?.at(-1)}”), never ▲ 0%`);
      await shot(p, `r7-${name}-${w}`);
      await close(p);
    }
    await setBooks();
  });

  // ─── R8: a family link that leads to no family ───
  await step('R8: a family link that leads to no family has a heading and plain words, and the tab says so, at 390 and 1280', async () => {
    for (const [who, w] of [[MARIA, 390], [SAM, 1280]]) {
      const p = await tab(who, w, 800);
      for (const [hash, gone] of [['#/families/nope', true], ['#/families/j_j1', true], ['#/families/acctOld999', true], ['#/families/acctIris01', false]]) {
        await open(p, hash);
        await p.waitForFunction(() => !/Opening/.test(document.querySelector('.bf')?.innerText || 'Opening'), { timeout: 10000 }).catch(() => {});
        await sleep(400);
        const s = await p.evaluate(() => ({ title: document.title, h1: document.querySelector('main h1')?.innerText || '', words: document.querySelector('main .bp-empty .bp-muted')?.innerText || '', link: !!document.querySelector('main .bp-empty a[href="#/families"]') }));
        if (gone) ok(s.h1 === 'That family isn’t on the board page' && /cut short or out of date/.test(s.words) && s.link && s.title === 'Family not found · SOARD Board', `${w} ${hash}: “${s.h1}”, “${s.words}”, tab “${s.title}”`);
        else ok(s.h1 === 'Iris Example' && s.title === 'Iris Example · SOARD Board', `${w} ${hash}: a family that's there still opens (“${s.h1}”, tab “${s.title}”)`);
        if (hash === '#/families/j_j1') await shot(p, `r8-cut-${w}`);
      }
      // A link cut off in the middle of a %-code (QA round 10: "URI malformed", a blank cream page, the tab "SOARD Board"):
      // a dead link, the heading, the plain words and the tab every other dead link of its kind has
      const dead = {
        meetings: ['That meeting isn’t on the board page', /may not be shared yet/, 'Meetings · SOARD Board'],
        families: ['That family isn’t on the board page', /cut short or out of date/, 'Family not found · SOARD Board'],
        documents: ['That document isn’t here', /taken off the board page/, 'Documents · SOARD Board'],
      };
      for (const hash of ['#/meetings/m_p6pvq352%2', '#/meetings/%', '#/families/%', '#/documents/%E2%80', '#/meetings/m_p6pvq3']) {
        const before = errs.length;
        await open(p, hash);
        await p.waitForFunction(() => !/Opening/.test(document.querySelector('main')?.innerText || 'Opening'), { timeout: 10000 }).catch(() => {});
        await sleep(400);
        const s2 = await p.evaluate(() => ({ title: document.title, h1: document.querySelector('main h1')?.innerText || '', words: document.querySelector('main .bp-empty .bp-muted')?.innerText || '' }));
        const [h1, words, title] = dead[hash.split('/')[1]];
        const thrown = errs.slice(before).filter((e) => /URI malformed|PAGEERROR/.test(e));
        ok(s2.h1 === h1 && words.test(s2.words) && s2.title === title && !thrown.length, `${w} ${hash}: “${s2.h1}”, “${s2.words.slice(0, 60)}”, tab “${s2.title}”${thrown.length ? `; ${thrown[0]}` : ''}`);
        if (hash === '#/meetings/%') await shot(p, `r8-percent-${w}`);
      }
      await close(p);
    }
  });

  await step('R9: a fold a search opened stays open when its card is drawn anew the next moment (the full check after round 9: the store’s “Line by line” came back shut over the line a search had landed on, neither in view nor focused)', async () => {
    const p = await tab(SAM, 1280, 900);
    await open(p, '#/financials');
    const r = await p.evaluate(async () => {
      const parts = await import('/admin/board/parts.js');
      const { h, render } = await import('/admin/vendor.js');
      const box = document.createElement('div');
      document.body.append(box);
      const card = () => h(parts.More, { k: 'r9-redrawn', summary: 'Line by line' }, h('p', { id: 'r9-line' }, 'A line a search found'));
      const out = {};
      for (const [what, k] of [['once', 'r9-redrawn'], ['a year in a kept list', 'years']]) {
        render(null, box);
        render(k === 'years' ? h('details', { 'data-kept': 'years', 'data-kept-item': '2019' }, h('summary', null, '2019'), h('p', { id: 'r9-line' }, 'A meeting')) : card(), box);
        const line = box.querySelector('#r9-line');
        // What a search does on landing in a shut fold (before round 9's last fix: the fold set open, nothing kept)
        (parts.openFoldsAround || ((el) => { for (let q = el.parentElement; q; q = q.parentElement) if (q.tagName === 'DETAILS' && !q.open) q.open = true; }))(line);
        // …and the card drawn anew in the same moment, before the fold's own toggle has said anything
        render(null, box);
        if (k === 'years') { const ui = (history.state && history.state.ui) || {}; out[what] = Array.isArray(ui.years) && ui.years.includes('2019'); continue; }
        render(card(), box);
        await new Promise((res) => setTimeout(res, 300));
        out[what] = !!box.querySelector('details')?.open;
      }
      box.remove();
      return out;
    });
    ok(r.once === true, `a “Line by line” fold opened for a search and drawn anew at once: open (${JSON.stringify(r)})`);
    ok(r['a year in a kept list'] === true, `a year’s fold opened for a search: its year kept, so the Meetings page drawn anew opens it (${JSON.stringify(r)})`);
    await close(p);
  });

  await step('R10: on a slow machine, a search lands after the page’s change has finished drawing: in view and focused every time (the full check after round 9: under load the store’s line found by “$380,000” was marked but neither in view nor focused, about 1 time in 6)', async () => {
    const p = await tab(SAM, 1280, 900);
    await p.emulateCPUThrottling(6);
    await open(p, '#/');
    const bad = [];
    const TRIES = 20;
    for (let k = 0; k < TRIES; k++) {
      const found = await search(p, '$380,000');
      const x = found.find((y) => /^The store’s cost of goods, \d{4}’s same days$/.test(y.title)) /* r10: last year's cost of goods is a figure of its own */;
      if (!x) { bad.push(`try ${k + 1}: no result (${found.map((y) => y.title).join(' | ')})`); break; }
      await p.click(`#${x.id}`);
      const l = await landing(p);
      if (!(l.hash === '#/financials' && l.id === 'stl-cost-ly' /* r10: its own cell, never the sales row */ && l.inView && l.focused)) bad.push(`try ${k + 1}: ${JSON.stringify({ hash: l.hash, id: l.id, inView: l.inView, focused: l.focused })}`);
      await go(p, '#/');
    }
    ok(!bad.length, `the CPU 6 times slower: ${TRIES - bad.length} of ${TRIES} landed in view and focused${bad.length ? `; not: ${bad.slice(0, 4).join(' | ')}` : ''}`);
    await p.emulateCPUThrottling(1);
    await close(p);
  });

  // ─── R11 to R13: QA round 10 ───
  /** Pick the result titled so (a click at 1280, ↓ to it and Enter at 390), and where it landed */
  const pickTitled = async (p, q, title, how) => {
    const found = await search(p, q);
    const x = found.find((y) => y.g === 'Money' && (title instanceof RegExp ? title.test(y.title) : y.title === title));
    if (!x) { await p.keyboard.press('Escape'); await sleep(250); return { x: null, found }; }
    if (how === 'click') await p.click(`#${x.id}`);
    else {
      const now = await p.evaluate(() => Number((document.querySelector('.bp-finder [aria-selected="true"]')?.id || 'bp-r-0').slice(5)));
      for (let k = now; k < Number(x.id.slice(5)); k++) await p.keyboard.press('ArrowDown');
      await p.keyboard.press('Enter');
    }
    const l = await landing(p);
    const fold = await p.evaluate((id) => { const d = document.getElementById(id)?.closest('details'); return d ? d.open : null; }, l.id);
    return { x, l, fold, found };
  };
  await step('R11: each of the store’s lines, this year’s and last year’s, is its own result: it lands on that figure (its tile, or its own cell in “Line by line” with the fold opened), in view and focused, and marks it alone', async () => {
    const LY = Y0 - 1;
    // [typed, the result, where it lands, what's marked there, in a fold]
    const LINES = [
      ['$415K', 'The store’s sales', 'store-sales', ['415K'], false], ['$250,000', 'The store’s cost of goods', 'store-cost', ['250K'], false], ['165000', 'The store’s profit before staff and rent', 'store-profit', ['165K'], false],
      ['$830,000', `The store’s sales, ${LY}’s same days`, 'stl-sales-ly', ['830,000'], true], ['$380,000', `The store’s cost of goods, ${LY}’s same days`, 'stl-cost-ly', ['380,000'], true], ['$450K', `The store’s profit before staff and rent, ${LY}’s same days`, 'stl-profit-ly', ['450,000'], true],
      ['$285K', `The store’s profit before staff and rent, against ${LY}`, 'store-profit', ['285K'], false],
    ];
    for (const [who, w, how] of [[SAM, 1280, 'click'], [MARIA, 390, 'enter']]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1200);
      for (const [q, title, id, marked, folded] of LINES) {
        const r = await pickTitled(p, q, title, how);
        if (!r.x) { ok(false, `${w} “${q}”: no “${title}” (${r.found.map((y) => y.title).join(' | ')})`); continue; }
        ok(r.l.hash === '#/financials' && r.l.id === id && r.l.inView && r.l.focused && JSON.stringify(r.l.marked) === JSON.stringify(marked) && (!folded || r.fold === true), `${w}, ${how}, “${q}” → ${title}: #${r.l.id}, in view ${r.l.inView}, focused ${r.l.focused}${folded ? `, its fold open ${r.fold}` : ''}, marked ${JSON.stringify(r.l.marked)} (“${r.l.text.slice(0, 60)}”)`);
        if (q === '$380,000') await shot(p, `r11-cost-ly-${w}`);
        await go(p, '#/');
      }
      await close(p);
    }
  });

  await step('R12: a small category is never dropped: Everything else is drawn whenever anything is in it, “under 1%”, the parts adding up to the revenue on Home, Financials and Print it all, and search lands on it (sh-r10c: Interest $4,000 of $1,000,000)', async () => {
    await setBooks({ sources: [cat('donations', 'Donations', 500000), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 196000), cat('account:interest', 'Interest', 4000, ['Interest Income'])], revenue: 1000000 });
    for (const [who, w, how] of [[SAM, 1280, 'click'], [MARIA, 390, 'enter']]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1200);
      const m = await mixNow(p);
      const parts = m.fin.rows.reduce((t, r) => t + valueOf(r.amount), 0);
      ok(JSON.stringify(m.home.shares) === JSON.stringify(['50%', '30%', '20%', 'under 1%']), `${w}, Home: ${m.home.shares.join(', ')}`);
      ok(JSON.stringify(m.fin.rows.map((r) => [r.name, r.amount, r.share])) === JSON.stringify([['Donations', '$500,000', '50%'], ['Store sales', '$300,000', '30%'], ['Gala', '$196,000', '20%'], ['Everything else', '$4,000', 'under 1%']]) && parts === 1000000, `${w}, Financials: ${m.fin.rows.map((r) => `${r.name} ${r.amount} ${r.share}`).join(', ')}, adding to ${parts}`);
      ok(m.print.rows.length === 4 && /^Everything else/.test(m.print.rows[3][0]) && /\$4,000/.test(m.print.rows[3].join(' ')), `${w}, Print it all: ${m.print.rows.map((r) => r.slice(0, 3).join(' ')).join(', ')}`);
      const r = await pickTitled(p, 'Interest', 'Interest', how);
      ok(r.x && r.l.hash === '#/financials' && r.l.id === 'mix-rest' && r.l.inView && r.l.focused && r.l.marked.includes('Interest'), `${w}, “Interest” → ${r.x?.title}: #${r.l?.id}, in view ${r.l?.inView}, focused ${r.l?.focused}, marked ${JSON.stringify(r.l?.marked)}`);
      if (w === 390) await shot(p, 'r12-rest-390');
      await close(p);
    }
    await setBooks();
  });

  await step('R13: a change result says which way and what it’s of, the way the page says it, and two results are never worded the same', async () => {
    const LY = Y0 - 1;
    const p = await tab(SAM, 1280, 900);
    await open(p, '#/');
    await sleep(1200);
    for (const [q, title, line] of [
      /* r11: the short form after a comma, never in brackets, which on this page say below zero (Board QA round 11) */
      ['$376K', `${Y0} revenue so far on the year’s chart, against ${LY}’s same days`, `Up $376,045, or $376K, on ${LY}’s same days, in kind included`],
      ['376045', `${Y0} revenue so far on the year’s chart, against ${LY}’s same days`, `Up $376,045, or $376K, on ${LY}’s same days, in kind included`],
      ['$226K', `${Y0} revenue, against ${LY}’s same days`, `Up $226,045, or $226K, on ${LY}’s same days, in kind left out`],
      ['$50K', `${Y0} expenses, against ${LY}’s same days`, `Down $50,000 on ${LY}’s same days, in kind left out` /* r12: what's left out named as the page names it, in kind alone here */],
      ['$276K', `${Y0} net, against ${LY}’s same days`, `Up $276,045, or $276K, on ${LY}’s same days, in kind left out` /* r11: the short form after a comma, never in brackets; r12: in kind alone here */],
    ]) {
      const found = (await search(p, q)).filter((x) => x.g === 'Money');
      const hit = found.find((x) => x.title === title);
      const said = found.map((x) => `${x.title} | ${x.line}`);
      ok(hit?.line === line && new Set(said).size === said.length && new Set(found.map((x) => x.title)).size === found.length, `“${q}”: ${JSON.stringify(said)}`);
    }
    await close(p);
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
console.log('\nAll round 9 member checks passed. Screenshots in test-results/board-round9-member/');
process.exit(0);
