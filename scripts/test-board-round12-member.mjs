/**
 * test-board-round12-member.mjs: the board page as members see it, as QA round 12 found it (Nov 23 2026)
 * ====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round11-member.mjs
 * does; JobTread, Mercury, Zeffy, Google and Resend faked. Real money has cents, so every figure here does (the tester's
 * QA_CENTS: Mercury's $312,500.49 and $62,500.49, QuickBooks' categories .45, expenses $1,200,000.60). Made-up people.
 *   X1  With cents, wherever a total and its parts are drawn together they add up as written: the cash card, The year
 *       so far (revenue less expenses is the net), where the money came from, where it went, the store, Mercury's year,
 *       the meeting's cash tile; at 1280 and 390
 *   X2  What's left out of expenses is "in kind and depreciation" when depreciation is among it, "in kind" when it's the
 *       in kind alone: Home's and Financials' tile, the budget card, the meeting's tile and the slide
 *   X3  One account and four small ones: the cash card lists them (the smaller ones together), and search's "the
 *       smaller accounts together" lands on that line, in view, focused and marked, at 1280 and 390
 *   X4  A room's median in What makeovers cost ("$23,950") is found and lands on its row
 *   X5  Without QuickBooks, Mercury's year on the meeting's tile and the slide runs "through" today's day
 *   X6  A packet's budget sheet headed "FY2026 Budget", without QuickBooks: the tiles and the heading carry FY2026
 *   X7  "$46" is said once: "Makeover | $46 of 2026's revenue so far, in Everything else"
 *   X8  A read that fails is said so: every statement of the page's read failing once in turn (as Sam and as Alex),
 *       each part it marks says it couldn't load just now on Home and Financials, and none is drawn as a zero, an empty
 *       list, "none" or (the givers' names not read) "Anonymous"
 * Screenshots land in test-results/board-round12-member/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round12-member.mjs        (ONLY=X1,X3 runs those steps alone; PORT=5181 a port of its own)
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
import { saveMeeting, patchMeeting, getMeeting, provideBoardFinance, ensureSchema, putFile } from '../functions/api/_board.js';
import { writeState } from '../functions/api/_board-roles.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { maybeReadGifts } from '../functions/api/_board-gifts.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting } from '../public/admin/board-shared.js';
import { deflateRawSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round12-member/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
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
const stmtOf = (st, sql) => new Proxy(st, { get(t, p) {
  if (p === 'bind') return (...a) => stmtOf(t.bind(...a), sql);
  if (['first', 'all', 'run', 'raw'].includes(p)) return async (...a) => {
    if (plan.armed && !SCHEMA_SQL.test(sql)) { const n = plan.seen++; if (n === plan.k) { plan.failed.push(`${p} ${sql.replace(/\s+/g, ' ').slice(0, 90)}`); throw new Error('D1_ERROR: Network connection lost.'); } }
    return t[p](...a);
  };
  const v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
} });
const liveDB = new Proxy({}, { get(_, p) { if (p === 'prepare') return (sql) => stmtOf(curDB.prepare(sql), sql); const v = curDB[p]; return typeof v === 'function' ? v.bind(curDB) : v; } });
const env = { DB: liveDB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', JOBTREAD_GRANT_KEY: 'jt-test', MERCURY_API_TOKEN: 'mercury-test', MERCURY_RELAY_KEY: 'relay-test' };
const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
const JOBS = [JOB('j1', `Maya (${Y0})`, 'Build'), JOB('j2', `Leo (${Y0})`, 'Design'), JOB('j3', `Someone Else (${Y0})`, 'Awaiting Funding')];
let ACCTS = [['Operating', 312500.49], ['Reserve', 62500.49]];
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

try {
  // ─── X1: with cents, every total and its parts add up as written ───
  await step('X1: with cents, the cash card, The year so far, where the money came from, where it went, the store, the meeting’s cash tile and Mercury’s year add up as written, at 1280 and 390', async () => {
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      await setBooks();
      await cashCacheOff();
      const p = await tab(who, w, 900);
      await open(p, '#/financials');
      await sleep(2000);
      await p.evaluate(() => document.querySelectorAll('main details').forEach((d) => { d.open = true; }));
      await sleep(600);
      const read = await p.evaluate(() => {
        const t = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';
        const all = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
        return {
          total: t('#cash .bp-cash__total'), lines: all('#cash .bp-accounts:not(.bp-accounts--owed) .bp-accounts__n'),
          rev: t('#yf-rev .bp-yfigs__value'), exp: t('#yf-exp .bp-yfigs__value'), net: t('#yf-net .bp-yfigs__value'),
          ly: ['rev', 'exp', 'net'].map((k) => t(`#yl-${k} .bp-cmp__ly`)),
          own: t('#year-own'),
          mix: all('.bp-mixtable tbody tr td.num:first-of-type').map((x) => x.replace(/\s.*$/, '')),
          went: t('.bp-meters--went .bp-meter__head strong'), wentParts: all('.bp-meters--went .bp-legend li strong'),
          store: ['sales', 'cost', 'profit'].map((k) => t(`#stl-${k} > td.num`)), storeLy: ['sales', 'cost', 'profit'].map((k) => t(`#stl-${k}-ly`)),
        };
      });
      const sum = (l) => l.reduce((a, x) => a + amt(x), 0);
      ok(read.lines.length === 2 && sum(read.lines) === amt(read.total), `${w}: Cash in the bank ${read.total} is its lines, ${read.lines.join(' + ')}`);
      ok(amt(read.rev) - amt(read.exp) === amt(read.net), `${w}: The year so far: ${read.rev} less ${read.exp} is ${read.net}`);
      ok(amt(read.ly[0]) - amt(read.ly[1]) === amt(read.ly[2]), `${w}: last year’s same days: ${read.ly.join(', ')}`);
      const own = read.own.match(/revenue (\$[\d,]+), expenses (\$[\d,]+), net (\$[\d,]+)/);
      ok(own && amt(own[1]) - amt(own[2]) === amt(own[3]), `${w}: QuickBooks’ own three add up: ${read.own}`);
      ok(read.mix.length >= 5 && sum(read.mix) === amt(read.rev), `${w}: where the money came from: ${read.mix.join(' + ')} is ${read.rev}`);
      ok(read.wentParts.length >= 4 && sum(read.wentParts) === amt(read.went), `${w}: where it went: ${read.wentParts.join(' + ')} is ${read.went}`);
      ok(amt(read.store[0]) - amt(read.store[1]) === amt(read.store[2]) && amt(read.storeLy[0]) - amt(read.storeLy[1]) === amt(read.storeLy[2]), `${w}: the store: ${read.store.join(', ')}; last year ${read.storeLy.join(', ')}`);
      await shot(p, `x1-fin-${w}`);
      // The meeting's cash tile: its accounts in short are its total in short
      await go(p, `#/meetings/${NEXT.id}`);
      await sleep(2200);
      const tile = await p.evaluate((id) => ({ v: document.querySelector(`#mt-${id}-bank .bp-agfig__value`)?.textContent || '', sub: document.querySelector(`#mt-${id}-bank .bp-fig__sub`)?.textContent || '' }), NEXT.id);
      const parts = [...tile.sub.matchAll(/\$[\d.]+K/g)].map((m) => amt(m[0]));
      ok(parts.length === 2 && parts[0] + parts[1] === Math.round(amt(tile.v) / 1000) * 1000, `${w}: the meeting’s cash tile: ${tile.v}, ${tile.sub}`);
      await close(p);
    }
    // Without QuickBooks: Mercury's year, money out its three parts, the net in less out
    await noBooks();
    await cashCacheOff();
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/financials');
      await sleep(1800);
      const io = await p.evaluate(() => Object.fromEntries(['in', 'out', 'makeovers', 'store', 'operating', 'net'].map((k) => [k, [...document.querySelectorAll(`#io-${k} td.num`)].map((x) => x.textContent.trim())])));
      for (const c of [0, 1]) {
        const v = (k) => amt(io[k][c]);
        ok(v('makeovers') + v('store') + v('operating') === v('out') && v('in') - v('out') === v('net'), `${w}: Money in and out, ${c ? 'last year' : 'this year'}: ${JSON.stringify(Object.fromEntries(Object.entries(io).map(([k, x]) => [k, x[c]])))}`);
      }
      await close(p);
    }
    await setBooks();
    await cashCacheOff();
  });

  // ─── X2: what's left out of expenses, named one way ───
  await step('X2: what’s left out of expenses: “in kind and depreciation” with $8,000 of depreciation among it, “in kind” with the in kind alone, on Home, Financials, the budget card, the meeting and the slide', async () => {
    for (const [dep, name, amount] of [[true, 'in kind and depreciation', '$228K'], [false, 'in kind', '$220K']]) {
      await setBooks({ dep });
      for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
        const p = await tab(who, w, 900);
        const said = [];
        await open(p, '#/');
        await sleep(1500);
        said.push(['Home’s tile', await p.evaluate(() => [...document.querySelectorAll('.bp-figs li')].find((li) => /expenses/i.test(li.querySelector('.bp-fig__label')?.textContent || ''))?.textContent.replace(/\s+/g, ' ') || '')]);
        await go(p, '#/financials');
        await sleep(2000);
        said.push(['Financials’ tile', await p.evaluate(() => document.querySelector('#fin-exp')?.textContent.replace(/\s+/g, ' ') || '')]);
        said.push(['the budget card', await p.evaluate(() => document.querySelector('#bud-exp')?.textContent.replace(/\s+/g, ' ') || '')]);
        await go(p, `#/meetings/${NEXT.id}`);
        await sleep(2200);
        said.push(['the meeting’s tile', await p.evaluate((id) => document.querySelector(`#mt-${id}-exp`)?.textContent.replace(/\s+/g, ' ') || '', NEXT.id)]);
        await close(p);
        for (const [where, text] of said) {
          const words = text.match(/not counting \$[\d.]+K ([a-z ]+?)(?:$| ·|\.|,|\d)/i)?.[1]?.trim();
          ok(words === name && text.includes(amount), `${dep ? 'depreciation' : 'in kind alone'}, ${w}: ${where} says “not counting ${amount} ${name}” (${text.slice(-90)})`);
        }
      }
      // The slide, as the presenter shows it
      const ps = await tab(FOUNDER, 1280, 720);
      await within(30000, ps.goto(`${SITE}/admin/board/?present&at=${encodeURIComponent(FIN_ITEM.id)}#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
      await ps.waitForFunction(() => [...document.querySelectorAll('.bs-figs li')].some((li) => /expenses/i.test(li.textContent)), { timeout: 15000 }).catch(() => {});
      await sleep(1000);
      const slide = await ps.evaluate(() => [...document.querySelectorAll('.bs-figs li')].find((li) => /expenses/i.test(li.textContent))?.textContent.replace(/\s+/g, ' ') || '');
      ok(new RegExp(`not counting ${amount.replace('$', '\\$')} ${name}($| ·)`, 'i').test(slide.trim()), `${dep ? 'depreciation' : 'in kind alone'}: the slide says “not counting ${amount} ${name}” (${slide.slice(-90)})`);
      await close(ps);
    }
    await setBooks();
  });

  // ─── X3: the smaller accounts ───
  await step('X3: one account and four small ones: the cash card lists them, the smaller ones together, and search’s line for them lands on it, in view, focused and marked, at 1280 and 390', async () => {
    ACCTS = [['Operating', 370000], ['Savings', 1500], ['Petty Cash', 900], ['PayPal', 700], ['Square', 400]];
    await noBooks();
    await cashCacheOff();
    for (const [who, w, h] of [[SAM, 1280, 720], [MARIA, 390, 844]]) {
      const p = await tab(who, w, h);
      await open(p, '#/financials');
      await sleep(1800);
      const card = await p.evaluate(() => ({ total: document.querySelector('#cash .bp-cash__total')?.textContent || '', lines: [...document.querySelectorAll('#cash .bp-accounts:not(.bp-accounts--owed) li')].map((li) => ({ id: li.id, text: li.textContent.replace(/\s+/g, ' ').trim() })) }));
      ok(card.lines.length === 2 && card.lines[0].id === 'cash-a0' && card.lines[1].id === 'cash-a-rest' && /Savings, Petty Cash, PayPal and Square/.test(card.lines[1].text) && /\$3,500/.test(card.lines[1].text), `${w}: the card lists Operating and the smaller ones together: ${JSON.stringify(card)}`);
      ok(card.lines.reduce((t, l) => t + amt(l.text.match(/\$[\d,]+/)?.[0]), 0) === amt(card.total), `${w}: the lines are the total, ${card.total}`);
      await go(p, '#/');
      const found = await search(p, '$3,500');
      const hit = found.find((x) => x.g === 'Money' && /Savings, Petty Cash, PayPal and Square/.test(x.title));
      ok(!!hit && /the smaller accounts together/.test(hit.line), `${w}: search has the smaller accounts together (${JSON.stringify(found.slice(0, 3))})`);
      if (hit) {
        await p.click(`#${hit.id}`);
        const l = await landing(p, 'cash-a-rest');
        ok(l.hash === '#/financials' && l.id === 'cash-a-rest' && l.seen && l.focused && l.marks.length > 0 && l.marks.every((m) => m.seen), `${w}: it lands on their line, in view, focused and marked (${JSON.stringify(l)})`);
        await shot(p, `x3-small-${w}`);
      }
      await close(p);
    }
    ACCTS = [['Operating', 312500.49], ['Reserve', 62500.49]];
    await setBooks();
    await cashCacheOff();
  });

  // ─── X4: a room's median in What makeovers cost ───
  await step('X4: a dream bedroom’s median in What makeovers cost, “$23,950”, is found and lands on its row, at 1280 and 390', async () => {
    for (const [who, w, h] of [[SAM, 1280, 720], [MARIA, 390, 844]]) {
      const p = await tab(who, w, h);
      await open(p, '#/');
      await sleep(1200);
      for (const q of ['$23,950', '23950', 'bedroom median']) {
        const found = await search(p, q);
        const hit = found.find((x) => x.g === 'Money' && /^Dream bedroom, 2 makeovers$/.test(x.title));
        ok(!!hit, `${w}: “${q}” finds the dream bedrooms’ row (${JSON.stringify(found.slice(0, 3).map((x) => `${x.title} | ${x.line}`))})`);
        if (!hit) { await closeFinder(p); continue; }
        await p.click(`#${hit.id}`);
        const l = await landing(p, 'bc-r-bedroom');
        ok(l.id === 'bc-r-bedroom' && l.seen && l.focused && l.marks.some((m) => /23,950/.test(m.t)), `${w}: “${q}” lands on the row, in view, focused, “$23,950” marked (${JSON.stringify({ id: l.id, seen: l.seen, focused: l.focused, marks: l.marks })})`);
        if (q === '$23,950') await shot(p, `x4-room-${w}`);
        await go(p, '#/');
      }
      await close(p);
    }
  });

  // ─── X5: this month is so far ───
  await step('X5: without QuickBooks, Mercury’s year on the meeting’s tile and the slide runs through today’s day', async () => {
    await noBooks();
    await cashCacheOff();
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, `#/meetings/${NEXT.id}`);
      await sleep(2200);
      const sub = await p.evaluate((id) => document.querySelector(`#mt-${id}-ytd .bp-fig__sub`)?.textContent.replace(/\s+/g, ' ').trim() || '', NEXT.id);
      ok(sub.endsWith(`through ${MONTH_DAY}`), `${w}: the meeting’s tile: “${sub}”`);
      await go(p, '#/financials');
      await sleep(1500);
      const fin = await p.evaluate(() => document.querySelector('#io-h')?.closest('section')?.querySelector('.bp-sechead__sub, p')?.textContent.trim() || '');
      ok(fin.includes(`Through ${MONTH_DAY}`), `${w}: Financials says the same: “${fin}”`);
      await close(p);
    }
    const ps = await tab(FOUNDER, 1280, 720);
    await within(30000, ps.goto(`${SITE}/admin/board/?present&at=${encodeURIComponent(FIN_ITEM.id)}#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
    await ps.waitForFunction(() => [...document.querySelectorAll('.bs-figs li')].some((li) => /so far/i.test(li.textContent)), { timeout: 15000 }).catch(() => {});
    await sleep(900);
    const slide = await ps.evaluate(() => [...document.querySelectorAll('.bs-figs li')].find((li) => /so far/i.test(li.textContent))?.textContent.replace(/\s+/g, ' ') || '');
    ok(slide.includes(`through ${MONTH_DAY}`), `the slide: “${slide}”`);
    await shot(ps, 'x5-slide');
    await close(ps);
    await setBooks();
    await cashCacheOff();
  });

  // ─── X6: a budget sheet's year ───
  await step('X6: a packet’s budget sheet headed “FY2026 Budget”, without QuickBooks: the tiles and the heading carry FY2026; a sheet with no year, whole words and no year guessed', async () => {
    await noBooks();
    for (const [head, name, labels, heading] of [[`FY${Y0} Budget`, 'Budget vs Actual.xlsx', [`FY${Y0} revenue`, `FY${Y0} expenses`], `FY${Y0} against its budget`], ['Budget', 'Budget vs Actual.xlsx', ['Revenue', 'Expenses'], 'The budget, against what’s come in']]) {
      const m = await saveMeeting(DB, cleanMeeting({ date: day(-40), start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: [{ title: 'Finance', items: [{ title: 'The budget' }] }], agendaFrom: typed }), { by: FOUNDER });
      await patchMeeting(DB, m.id, (cur) => ({ ...cur, shared: true }));
      const bytes = xlsx([['SOARD Budget vs. Actuals'], ['', head, `Actual as of ${new Date(`${day(-41)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`], ['Revenue Total', 2000000, 1500000], ['Program Total', 1000000, 700000], ['Total Expenses', 1500000, 1100000]]);
      await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), kind: 'financials', by: FOUNDER });
      for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
        const p = await tab(who, w, 900);
        await open(p, '#/');
        await sleep(2000);
        const home = await p.evaluate(() => [...document.querySelectorAll('.bp-figs .bp-fig__label')].map((e) => e.textContent.trim()));
        ok(labels.every((l) => home.includes(l)), `“${head}”, ${w}: Home’s tiles ${JSON.stringify(home)}`);
        await go(p, '#/financials');
        await sleep(2000);
        const fin = await p.evaluate(() => ({ tiles: [...document.querySelectorAll('.bp-finsum .bp-fig__label')].map((e) => e.textContent.trim()), heading: document.querySelector('#bud-h')?.textContent.trim() || '' }));
        ok(labels.every((l) => fin.tiles.includes(l)) && fin.heading === heading, `“${head}”, ${w}: Financials’ tiles ${JSON.stringify(fin.tiles)} and heading “${fin.heading}”`);
        if (w === 390) await shot(p, `x6-${head.replace(/\W+/g, '')}-${w}`);
        await close(p);
      }
      await DB.prepare('DELETE FROM board_meetings WHERE id = ?').bind(m.id).run();
    }
    await setBooks();
  });

  // ─── X7: one amount said once ───
  await step('X7: “$46” is said once: the Makeover account’s line, never “$46, or $46”; a long one keeps its short form', async () => {
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1200);
      const found = await search(p, '$46');
      const mk = found.find((x) => x.title === 'Makeover');
      ok(mk?.line === `$46 of ${Y0}’s revenue so far, in Everything else`, `${w}: “${mk?.line}”`);
      const all = [...found, ...(await search(p, '1,656,049'))];
      ok(!all.some((x) => /(\$[\d,.]+[KMB]?), or \1(?![\d,.KMB])/.test(x.line)), `${w}: no line says an amount twice (${all.map((x) => x.line).filter((l) => /, or /.test(l)).slice(0, 3).join(' | ')})`);
      ok(all.some((x) => /\$1,656,049, or \$1\.66M/.test(x.line)), `${w}: “$1,656,049, or $1.66M” stays`);
      await close(p);
    }
  });

  // ─── X8: a read that fails is said so ───
  await step('X8: every statement of the page’s read failing once in turn, as Sam and as Alex: each part it marks says it couldn’t load just now on Home, Financials and the meeting, and none is drawn as a zero, an empty list or “none”', async () => {
    await setBooks();
    await setHistory(true);
    const read = async (who) => { const r = await realFetch(`${SITE}/api/board-portal`, { headers: { 'x-test-user': who }, cache: 'no-store' }); let j = null; try { j = await r.json(); } catch { /* not JSON */ } return { status: r.status, j }; };
    // What each part is in the page's data, to tell a part drawn other than the clean read has it
    const PARTS = {
      money: (j) => JSON.stringify([j.numbers?.cash?.total, (j.numbers?.cash?.accounts || []).map((a) => a.balance), j.numbers?.books?.revenue, j.numbers?.books?.expenses, j.numbers?.finance?.ytd, j.numbers?.costs?.makeovers?.length, j.numbers?.costs?.waiting?.length, j.numbers?.operating, (j.cashHistory || []).length]),
      projects: (j) => JSON.stringify([j.numbers?.projects?.building?.map((b) => b.name), j.numbers?.projects?.waiting?.length, j.numbers?.reveals?.length]),
      kids: (j) => JSON.stringify(j.numbers?.impact ? [j.numbers.impact.kids, j.numbers.impact.rooms, j.numbers.impact.byYear?.length] : null),
      gifts: (j) => JSON.stringify(j.gifts ? [j.gifts.count, j.gifts.total] : null),
      givers: (j) => JSON.stringify((j.gifts?.list || []).map((g) => g.name || g.company || 'anonymous')),
      sources: (j) => JSON.stringify([j.filings?.length, !!j.snapshot]),
      events: (j) => JSON.stringify((j.numbers?.events || []).length),
    };
    // (the base state once every table the read makes as it goes is there: each read starts from a copy of it, the same
    // database object, so each module's schema stays made)
    curDB = DB;
    await read(SAM);
    await read(ALEX);
    const base = DB._db.export();
    const fresh = async () => { curDB = await createD1({ bytes: base }); };
    const WORDS = { money: 'The money couldn’t load just now', projects: 'The makeovers couldn’t load just now', kids: 'The kids served couldn’t load just now', gifts: 'The major gifts couldn’t load just now', givers: 'The givers’ names couldn’t load just now', sources: 'The tax returns and audits couldn’t load just now', events: 'The events couldn’t load just now' };
    for (const who of [SAM, ALEX]) {
      await fresh();
      const clean = await read(who);
      const want = Object.fromEntries(Object.entries(PARTS).map(([k, f]) => [k, f(clean.j)]));
      ok(clean.status === 200 && !Object.keys(clean.j.unread || {}).length, `${who}: the clean read marks nothing (${JSON.stringify(clean.j?.unread)})`);
      const asFact = [];
      const unsaid = [];
      const zeros = [];
      let rendered = 0;
      let giversDrawn = 0;
      let k = 0;
      for (; k < 400; k++) {
        await fresh();
        Object.assign(plan, { armed: true, k, seen: 0, failed: [] });
        const r = await read(who);
        plan.armed = false;
        if (!plan.failed.length) break;
        if (r.status !== 200 || !r.j) continue;
        const marked = Object.keys(r.j.unread || {});
        const differ = Object.keys(PARTS).filter((part) => PARTS[part](r.j) !== want[part]);
        for (const part of differ) {
          // (the givers' names kept hidden when Keep anonymous can't be read are marked `givers`: Board QA round 12)
          if (marked.includes(part) || (part === 'givers' && marked.includes('gifts'))) continue;
          asFact.push(`k=${k} ${part} [${plan.failed[0]}]: ${PARTS[part](r.j).slice(0, 80)} (clean ${want[part].slice(0, 60)})`);
        }
        if (!marked.length) continue;
        // The page as it draws that read: each part marked says so, nothing of it drawn as a zero or none
        rendered += 1;
        const p = await tab(who, rendered % 2 ? 1280 : 390, 900, { portal: r.j });
        for (const hash of ['#/', '#/financials', `#/meetings/${NEXT.id}`]) {
          await open(p, hash);
          await sleep(hash === '#/' ? 1500 : 1800);
          const text = await p.evaluate(() => document.querySelector('main')?.innerText.replace(/\s+/g, ' ') || '');
          const where = { '#/': ['money', 'projects', 'kids', 'gifts', 'givers'], '#/financials': ['money', 'gifts', 'givers', 'sources'] }[hash] || ['money', 'projects', 'events'];
          for (const part of marked.filter((x) => where.includes(x))) if (!text.includes(WORDS[part])) unsaid.push(`k=${k} ${hash} ${part}`);
          const zero = [[/\b0 kids served|0\s*kids served/, 'kids'], [/None right now/, 'projects'], [/No gifts of \$1,000 or more yet/, 'gifts'], [/\bAnonymous\b/, 'givers'], [/Nothing on the calendar yet|No events on the calendar/, 'events'], [/No reveals on the calendar yet/, 'projects']].filter(([re, part]) => marked.includes(part) && re.test(text));
          for (const [, part] of zero) zeros.push(`k=${k} ${hash} ${part}`);
          if (marked.includes('money') && hash === '#/' && /Cash in the bank/.test(text)) zeros.push(`k=${k} ${hash} money: a cash figure drawn`);
        }
        if (marked.includes('givers')) giversDrawn += 1;
        if (rendered <= 3 || (marked.includes('givers') && giversDrawn === 1)) await shot(p, `x8-${who.split('.')[0]}-k${k}`);
        await close(p);
      }
      ok(k > 40, `${who}: ${k} statements failed in turn, ${rendered} reads drawn with a part marked`);
      ok(!asFact.length, `${who}: no failed read drawn as a fact${asFact.length ? `; ${asFact.length}: ${asFact.slice(0, 5).join(' | ')}` : ''}`);
      ok(!unsaid.length, `${who}: each part marked says it couldn’t load just now where it’s drawn${unsaid.length ? `; ${unsaid.length} didn’t: ${unsaid.slice(0, 6).join(' | ')}` : ''}`);
      ok(!zeros.length, `${who}: none of a marked part drawn as zero or none${zeros.length ? `; ${zeros.slice(0, 6).join(' | ')}` : ''}`);
      // (the givers' names not read: each such read drawn says so, its gifts by amount and day, never "Anonymous")
      ok(giversDrawn > 0, `${who}: ${giversDrawn} reads with the givers’ names not read drawn, each saying so and none “Anonymous”`);
    }
    curDB = DB;
    await setHistory(true);
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
console.log('\nAll round 12 member checks passed. Screenshots in test-results/board-round12-member/');
process.exit(0);
