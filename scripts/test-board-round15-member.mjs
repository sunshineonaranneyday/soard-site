/**
 * test-board-round15-member.mjs: the board page as members see it, as QA round 15 found it (Nov 26 2026)
 * ====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round14-member.mjs
 * does (its world, and the members' own presses), with the reveals, What makeovers cost and the board meetings ahead on
 * the next meeting's agenda; JobTread, Mercury, Zeffy, Google and Resend faked. Made-up people and money. Each step fails
 * ONE read at a time (the tester's dbfail13 nth=: a statement, and who reads it, its stack), at 1280 and 390, against
 * the same page read in full: exactly that part says it couldn't load, in its place, and everything that loaded is shown.
 *   R1  The reveals not read, then JobTread's projects in the page's read: Makeovers says the makeovers couldn't load,
 *       no card says "Reveal date to come", every card is there
 *   R2  The page's own read of the meetings: Home's For you says the to-dos and reports couldn't load, gives no count,
 *       and still lists the papers to sign
 *   R3  Today's numbers' list of the meetings only: Meetings, Documents and Financials are drawn whole with nothing said;
 *       the next meeting's "Board meetings ahead" item says the meetings on the calendar couldn't load, nothing else
 *   R4  Today's numbers' read of the board's settings only (the operating balance): Home and the money are whole; What
 *       makeovers cost says it couldn't load on Financials and on the meeting's item, and only there
 *   R5  The year at a glance only: Financials says so in its place; the Form 990s and the audit are all there
 * Screenshots land in test-results/board-round15-member/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round15-member.mjs        (ONLY=R1,R3 runs those steps alone; PORT=5461 a port of its own)
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
const OUT = join(ROOT, 'test-results/board-round15-member/');
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
// (round 15: the reveals as the site keeps them, Maya's day set and Leo's part of the month, made up)
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: [{ slug: `maya-${Y0}`, name: 'Maya', confirmed: true, date: day(9), time: '10:00', kidUrl: `/kids/maya-${Y0}/` }, { slug: `leo-${Y0}`, name: 'Leo', confirmed: false, window: { label: 'mid December', through: day(60) }, kidUrl: `/kids/leo-${Y0}/` }], updatedAt: new Date().toISOString() })).run();
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
  // (round 15: the Qualification Committee's item and the board's calendar, each live)
  { title: 'Committees', items: [{ title: 'What makeovers cost', live: 'costs' }, { title: 'Board meetings ahead', live: 'meetings' }] },
  { title: 'New business', items: [{ title: 'The spring gala' }] },
];
const NEXT = await getMeeting(DB, (await patchMeeting(DB, (await saveMeeting(DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: AGENDA, agendaFrom: typed }), { by: FOUNDER })).id, (cur) => ({ ...cur, shared: true }))).id);

// ── Round 14's world beside round 13's: a held meeting with draft minutes, approved minutes the secretary signs, SOARD's
// papers, the board's settings (a quorum of 3), the events, the tax returns, a meeting's packet statements ──
Error.stackTraceLimit = 60;
await ensureAsks(DB);
// (round 15: and the operating balance SOARD keeps, which What makeovers cost rests on)
await writeState(DB, 'settings', { quorum: 3, admins: [FOUNDER], invitesFrom: FOUNDER, asks: 'on', operatingBalance: 150000 });
// (a meeting after the next, shared: the board meetings item's list of the meetings ahead)
await patchMeeting(DB, (await saveMeeting(DB, cleanMeeting({ date: day(100), start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: [{ title: 'Agenda', items: [{ title: 'Roll call' }] }], agendaFrom: typed }), { by: FOUNDER })).id, (cur) => ({ ...cur, shared: true }));
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


// ─── Round 15: one read failing at a time, against the page read in full ───
const failOnly = (when) => { Object.assign(plan, { when, hits: 0 }); };
/** Who read a statement: today's numbers (liveNumbers), or the page's own read */
const inLive = (stack) => /\bliveNumbers\b/.test(stack());
const READS = {
  reveals: (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'reveals',
  projects: (sql, a, stack) => /FROM board_state WHERE key/.test(sql) && a[0] === 'projects' && inLive(stack),
  pageMeetings: (sql, a, stack) => /SELECT data FROM board_meetings ORDER BY date DESC/.test(sql) && !inLive(stack),
  liveMeetings: (sql, a, stack) => /SELECT data FROM board_meetings ORDER BY date DESC/.test(sql) && inLive(stack),
  operating: (sql, a, stack) => /FROM board_state WHERE key/.test(sql) && a[0] === 'settings' && inLive(stack),
  glance: (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'financial-snapshot',
};
const WORDS = (await import('../public/admin/board/unread.js')).UNREAD_WORDS;
const PLACE = (await import('../public/admin/board/unread.js')).UNREAD_PLACE;
/** What a route draws, as a person reads it: its lines (fold open, clock times masked), what says it couldn't load, the lines of `parts` (selectors) */
const look = (p, parts = {}) => p.evaluate((parts) => {
  for (const d of document.querySelectorAll('main details:not([open])')) d.open = true;
  const linesOf = (el) => (el?.innerText || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim().replace(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/g, 'H:MM')).filter((l) => l && !/^(PDF|Word|Excel|Slides|Photo|File|·)$/.test(l));
  const main = document.querySelector('main');
  return {
    lines: linesOf(main), said: [...document.querySelectorAll('main [data-unread]')].map((e) => [e.dataset.unread, e.innerText.replace(/\s+/g, ' ').trim()]),
    lost: (main?.dataset.lost || '').split(' ').filter(Boolean), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    parts: Object.fromEntries(Object.entries(parts).map(([k, sel]) => [k, linesOf(document.querySelector(sel))])),
  };
}, parts);
const say = (x) => JSON.stringify(x).slice(0, 400);
/**
 * One route as `who` at `w`, read in full and with one read failing: what changed is only `part`'s, said in its place.
 * `gone`: may a line of the full page be missing (by default, none may); `place`: the selector its words must be in;
 * `words`: what its place says; `also`: further checks on the two looks
 */
async function compare(name, { who, w, hash, read, part, words, place = 'main', parts = {}, gone = () => false, gained = () => false, also = null }) {
  failNone();
  const c = await tab(who, w, 900);
  await open(c, hash);
  await sleep(1300);
  const C = await look(c, parts);
  await close(c);
  failOnly(read);
  const p = await tab(who, w, 900);
  await open(p, hash);
  await sleep(1300);
  const F = await look(p, parts);
  const placed = await p.evaluate((sel, part) => [...document.querySelectorAll(`${sel} [data-unread="${part}"], ${sel}[data-unread="${part}"]`)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()), place, part);
  await shot(p, `${name}-${w}`);
  await close(p);
  const hits = plan.hits;
  failNone();
  const lostLines = C.lines.filter((l) => !F.lines.includes(l));
  const newLines = F.lines.filter((l) => !C.lines.includes(l));
  const problems = [];
  if (!hits) problems.push('the read never failed');
  if (part) {
    if (!placed.some((t) => t === words)) problems.push(`its place (${place}) doesn’t say “${words}”: ${say(placed)}`);
  } else if (F.said.length !== C.said.length) problems.push(`something says it couldn’t load: ${say(F.said)}`);
  const others = F.said.filter(([x]) => x !== part && !C.said.some(([y]) => y === x));
  if (others.length) problems.push(`another part says it couldn’t load: ${say(others)}`);
  const badGone = lostLines.filter((l) => !gone(l, C));
  if (badGone.length) problems.push(`what loaded is gone: ${say(badGone.slice(0, 6))}`);
  const badNew = newLines.filter((l) => l !== words && !gained(l, C));
  if (badNew.length) problems.push(`drawn as new: ${say(badNew.slice(0, 6))}`);
  if (F.sideways > 0) problems.push(`${F.sideways}px sideways`);
  if (also) problems.push(...also(C, F));
  ok(!problems.length, `${name} ${who === SAM ? 'Sam' : who === MARIA ? 'Maria' : who === ALEX ? 'Alex' : who} ${w} ${hash}: ${problems.length ? problems.join('; ') : `fine (${hits} reads failed; gone ${lostLines.length}, new ${newLines.length}${part ? `, says “${words.slice(0, 50)}…”` : ''})`}`);
  return { C, F, lostLines, newLines };
}
const WIDTHS = [[SAM, 1280], [MARIA, 390]];
const inPart = (k) => (l, C) => (C.parts[k] || []).includes(l);

try {
  // ─── R1: Makeovers with the reveals, or JobTread's projects, not read ───
  await step('R1: Makeovers with the reveals not read, then JobTread’s projects in the page’s read: it says so in its place, no card says “Reveal date to come”, every card is there', async () => {
    for (const [read, label] of [['reveals', 'the reveals'], ['projects', 'JobTread’s projects']]) {
      for (const [who, w] of WIDTHS) {
        await compare(`r1-${read}`, { who, w, hash: '#/families', read: READS[read], part: 'projects', words: WORDS.projects, place: '.bf',
          // (what goes: the reveals on the cards; with the projects, the kid pages' names and photos the cards had)
          gone: (l) => /^Reveal /.test(l) || (read === 'projects' && /^(Maya|Leo|M|L|Someone Else|SE)$/.test(l)),
          gained: (l) => read === 'projects' && /^(Maya Example|ME|Leo Example)$/.test(l),
          also: (C, F) => [
            ...(C.lines.some((l) => /^Reveal (Dec|Nov|Jan|mid December)/.test(l)) ? [] : [`read in full, the cards had their reveals (${say(C.lines.filter((l) => /Reveal/.test(l)))})`]),
            ...(F.lines.some((l) => /Reveal date to come/.test(l)) ? [`a card says “Reveal date to come” from ${label} not read: ${say(F.lines.filter((l) => /Reveal/.test(l)))}`] : []),
          ] });
      }
    }
  });

  // ─── R2: Home's For you with the page's meetings not read ───
  await step('R2: the page’s own read of the meetings not read: For you says the to-dos and reports couldn’t load, with no count, and the papers to sign are listed', async () => {
    for (const [who, w] of [[ALEX, 1280], [SAM, 390], [SAM, 1280]]) {
      failNone();
      const c = await tab(who, w, 900);
      await open(c, '#/');
      await sleep(1300);
      const C = await c.evaluate(() => ({ count: document.querySelector('#todo-h .bp-count')?.innerText || '', items: [...document.querySelectorAll('.bp-forme .bp-todo__title')].map((e) => e.innerText.trim()), said: [...document.querySelectorAll('.bp-forme [data-unread]')].map((e) => e.innerText.trim()) }));
      await close(c);
      failOnly(READS.pageMeetings);
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1300);
      const F = await p.evaluate(() => ({ count: document.querySelector('#todo-h .bp-count')?.innerText || '', items: [...document.querySelectorAll('.bp-forme .bp-todo__title')].map((e) => e.innerText.trim()), said: [...document.querySelectorAll('.bp-forme [data-unread]')].map((e) => [e.dataset.unread, e.innerText.trim()]), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      await p.evaluate(() => document.querySelector('.bp-forme')?.scrollIntoView({ block: 'start' }));
      await shot(p, `r2-${who.split('@')[0]}-${w}`);
      await close(p);
      const hits = plan.hits;
      failNone();
      const papers = C.items.filter((t) => /^Read and sign/.test(t));
      const fromMeetings = C.items.filter((t) => !/^Read and sign/.test(t));
      const problems = [];
      if (!hits) problems.push('the read never failed');
      if (!C.count || (who === SAM && !fromMeetings.some((t) => /^Write your report/.test(t)))) problems.push(`read in full, For you counts its to-dos and reports (${C.count}: ${say(C.items)})`);
      if (F.count) problems.push(`a count of what’s left: ${F.count}`);
      if (!F.said.some(([x, t]) => x === 'meetings' && t === PLACE['meetings:todo'])) problems.push(`it doesn’t say “${PLACE['meetings:todo']}”: ${say(F.said)}`);
      if (!papers.every((t) => F.items.includes(t))) problems.push(`the papers to sign, which loaded, are gone: ${say(papers)} → ${say(F.items)}`);
      if (F.items.some((t) => !C.items.includes(t))) problems.push(`new to-dos: ${say(F.items)}`);
      if (F.sideways > 0) problems.push(`${F.sideways}px sideways`);
      ok(!problems.length, `R2 ${who.split('@')[0]} ${w}: ${problems.length ? problems.join('; ') : `fine (read in full “For you ${C.count}”, ${C.items.length} listed; not read: no count, ${F.items.length} listed, says ${say(F.said.map(([x]) => x))})`}`);
    }
  });

  // ─── R3: today's numbers' list of the meetings only ───
  await step('R3: today’s numbers’ list of the meetings not read: Meetings, Documents and Financials are whole with nothing said; the next meeting’s board meetings item says so, and only it', async () => {
    const item = NEXT.sections.flatMap((x) => x.items).find((it) => it.live === 'meetings');
    for (const [who, w] of WIDTHS) {
      for (const hash of ['#/meetings', '#/documents', '#/financials']) await compare('r3', { who, w, hash, read: READS.liveMeetings, part: '', words: '' });
      await compare('r3-next', { who, w, hash: `#/meetings/${NEXT.id}`, read: READS.liveMeetings, part: 'meetingDates', words: WORDS.meetingDates, place: `#i-${item.id}`, parts: { item: `#i-${item.id}` }, gone: inPart('item') });
    }
  });

  // ─── R4: the operating balance only ───
  await step('R4: today’s numbers’ read of the board’s settings not read: Home and the money are whole; What makeovers cost says so on Financials and on the meeting’s item, and only there', async () => {
    const costs = NEXT.sections.flatMap((x) => x.items).find((it) => it.live === 'costs');
    for (const [who, w] of WIDTHS) {
      await compare('r4-home', { who, w, hash: '#/', read: READS.operating, part: '', words: '' });
      await compare('r4-fin', { who, w, hash: '#/financials', read: READS.operating, part: 'costs', words: WORDS.costs, place: '#costs', parts: { costs: '#costs' }, gone: inPart('costs'),
        also: (C, F) => ['Cash in the bank', 'The statements'].filter((x) => !F.lines.some((l) => l.toLowerCase().startsWith(x.toLowerCase()))).map((x) => `“${x}” is gone`) });
      await compare('r4-next', { who, w, hash: `#/meetings/${NEXT.id}`, read: READS.operating, part: 'costs', words: WORDS.costs, place: `#i-${costs.id}`, parts: { item: `#i-${costs.id}` }, gone: inPart('item') });
      await compare('r4-report', { who, w, hash: `#/meetings/${NEXT.id}/report/${ITEM.id}`, read: READS.operating, part: '', words: '' });
    }
  });

  // ─── R5: the year at a glance only ───
  await step('R5: the year at a glance not read: Financials says so in its place, and every tax return and audit is there', async () => {
    for (const [who, w] of WIDTHS) {
      await compare('r5', { who, w, hash: '#/financials', read: READS.glance, part: 'glance', words: WORDS.glance, place: '#glance', parts: { glance: '#glance' }, gone: inPart('glance'), gained: (l) => l === 'At a glance',
        also: (C, F) => [...(C.lines.includes('Tax returns and audits') && F.lines.includes('Tax returns and audits') ? [] : ['the tax returns and audits card is gone']), ...(F.lines.some((l) => /The tax returns and audits couldn’t load/.test(l)) ? ['it says the tax returns couldn’t load'] : [])] });
    }
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
console.log('\nAll round 15 member checks passed. Screenshots in test-results/board-round15-member/');
process.exit(0);
