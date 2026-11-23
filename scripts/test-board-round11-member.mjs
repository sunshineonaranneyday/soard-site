/**
 * test-board-round11-member.mjs: the board page as members see it, as QA round 11 found it (Nov 23 2026)
 * ====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round9-member.mjs
 * does; JobTread, Mercury, Zeffy, Google and Resend faked, QuickBooks' year, statements and budget kept in D1 as its read
 * leaves them, what makeovers cost as the heartbeat keeps it, and the cash at each month's end as the heartbeat writes
 * it (this month's stamped with the time it was read). Made-up people only.
 *   W1  Every figure search can land on, every Money entry the page's search has (with QuickBooks, and without it:
 *       Mercury's record), picked: it lands on that figure's own place, never a card or the meeting's whole agenda item,
 *       in view under the sticky header and above the phone's tab bar, focused and marked. Every entry at 1280x720 and
 *       390x844; the meeting's money and a figure of each kind of place at 320, 375, 768, 1024 and 1440, and with motion
 *   W2  One revenue, counted one way: with QuickBooks and no budget, the tiles, The year so far, the mix and search have
 *       the same revenue, in kind left out and said once; revenue less expenses is the net; one "2026 revenue" in search
 *   W3  The short form rounds to the unit it shows: Donations $999,700 is "$1M" on Home and in search, never "$1000K"
 *   W4  One figure, one result: Mercury's year figures (money in, out, the net) found once each
 *   W5  Every fold on the page is kept on Back, Forward and a reload ("The numbers, month by month" too), and every
 *       <details> drawn is one of those
 *   W6  The newest cash bar names its day: "Nov 23 (so far this month)", its label and its tip
 *   W7  This month is never a month-end: Month-end balances and search say "so far this month"
 *   W8  Brackets around an amount mean below zero: no sentence on Financials (every fold open), the meeting's money,
 *       Print it all or a search's lines puts a positive amount in brackets
 *   W9  Screen readers hear amounts and shares apart: the revenue table's cells at 390, 375 and 1280, and no amount run
 *       into the next words anywhere on Home, Financials or the meeting at 390 and 1280
 * Screenshots land in test-results/board-round11-member/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round11-member.mjs        (ONLY=W1,W5 runs those steps alone; PORT=5081 a port of its own;
 *                                                      WALKS=books or WALKS=mercury one of W1's walks alone)
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
import { writeState } from '../functions/api/_board-roles.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { maybeReadGifts } from '../functions/api/_board-gifts.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round11-member/');
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
const SOURCES = [
  cat('donations', 'Donations', 700000, ['Individual/Corporate Revenue']), cat('store', 'Store sales', 415000, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000, ['Gala Income']),
  cat('inkind', 'In kind', 220000, ['In-Kind Contribution']), cat('grants', 'Grants', 90000, ['Grant Revenue']), cat('account:golf classic', 'Golf Classic', 30000, ['Golf Classic Income']),
  cat('account:rent', 'Rent', 16000, ['Rent Income']), cat('account:interest', 'Interest', 5000, ['Interest Income']), cat('account:makeover', 'Makeover', 45, ['Makeover Revenue']),
];
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
async function setBooks({ sources = SOURCES, revenue = null, budget = true } = {}) {
  const yr = Y0;
  const rev = revenue ?? sources.reduce((t, x) => t + x.amount, 0);
  const ytd = { year: String(yr), from: `${yr}-01-01`, through: day(0), revenue: rev, spent: 1200000, net: rev - 1200000, basis: 'Accrual', nonCash: 220000, sources,
    store: { sales: 415000, cost: 250000, profit: 165000, salesAccounts: ['Store Income', 'Store Discounts'], costAccounts: ['Store COGS'] } };
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
  const functions = { list: [{ name: 'Programs', amount: 820000 }, { name: 'Management', amount: 110000 }, { name: 'Fundraising', amount: 40000 }, { name: 'Events', amount: 10000 }], total: 980000 };
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
const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', JOBTREAD_GRANT_KEY: 'jt-test', MERCURY_API_TOKEN: 'mercury-test', MERCURY_RELAY_KEY: 'relay-test' };
const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
const JOBS = [JOB('j1', `Maya (${Y0})`, 'Build'), JOB('j2', `Leo (${Y0})`, 'Design'), JOB('j3', `Someone Else (${Y0})`, 'Awaiting Funding')];
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
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(Y0 - 1, 10 + i, 15)).toISOString().slice(0, 7), income: 80000 + i * 1000, makeovers: 40000, store: 12000, operating: 18000, storeSales: 25000, net: 10000 + i * 1000 })),
  ytd: { year: Y0, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 },
  lastYtd: { year: Y0 - 1, through: day(-365), income: 800000, makeovers: 480000, store: 140000, operating: 200000, net: -20000 },
  cash: { today: 375000, lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000, belowFloor: false },
  perMakeover: { count: 12, average: 21000 },
}));

// ── The next meeting, its money item first in a long agenda (on a phone, its item runs thousands of pixels) ──
const board = (status = '') => (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board', status });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Welcome' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash' }] },
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
async function tab(email, width = 1280, height = 900, { reduced = false } = {}) {
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

try {
  // ─── W1: every figure search can land on, on its own place ───
  await step('W1: every Money entry search has lands on that figure’s own place (never a card or the meeting’s whole agenda item), wholly in view under the header, focused and marked: with QuickBooks and without, every entry at 1280x720 and 390x844, the meeting’s money and each kind of place at 320 to 1440, and with motion', async () => {
    for (const mode of ['books', 'mercury'].filter((x) => !process.env.WALKS || process.env.WALKS.split(',').includes(x))) {
      if (mode === 'books') await setBooks(); else await noBooks();
      console.log(`  (${mode === 'books' ? 'with QuickBooks' : 'without QuickBooks: Mercury’s record'})`);
      let all = null;
      // (SIZES=390x844,1280x720 those alone)
      for (const [who, w, h, every, reduced] of [[SAM, 1280, 720, true, true], [MARIA, 390, 844, true, true], [MARIA, 320, 568, false, true], [TAYLOR, 375, 667, false, true], [TAYLOR, 768, 1024, false, true], [SAM, 1024, 768, false, true], [ALEX, 1440, 900, false, true], [MARIA, 390, 844, false, false], [SAM, 1280, 720, false, false]].filter(([, w0, h0]) => !process.env.SIZES || process.env.SIZES.split(',').includes(`${w0}x${h0}`))) {
        const p = await tab(who, w, h, { reduced });
        await open(p, '#/');
        await sleep(1500);
        const list = await entriesOf(p);
        all = all || list;
        // (every entry; else the meeting's money, and one of each kind of place: a tile, a row, a cell, a line, a card's part)
        const kind = (x) => `${x.href} ${x.focus.replace(/[-_]?[a-z]*\d[\w-]*$/i, '').replace(/^(mt|st|cm|io|gift|fy|bc)-.*$/, '$1')}`;
        const seen = new Set();
        const pick = every ? list : list.filter((x) => { if (x.href.startsWith('#/meetings/')) return true; const k = kind(x); if (seen.has(k)) return false; seen.add(k); return true; });
        // (PICK=<words> the entries whose title has them, alone: a look at one)
        if (process.env.PICK) pick.splice(0, pick.length, ...list.filter((x) => new RegExp(process.env.PICK, 'i').test(x.title)));
        const bad = [];
        for (const [i, x] of pick.entries()) {
          // (from Home now and then, so a pick also lands from another page)
          if (i % 7 === 3) await go(p, '#/');
          const l = await pickEntry(p, x).catch((e) => ({ id: '', hash: '', err: e.message }));
          if (!good(x, l)) { bad.push(said(x, l)); if (bad.length <= 2) await shot(p, `w1-${mode}-${w}x${h}-${bad.length}`); }
        }
        ok(!bad.length, `${mode}, ${w}x${h}${reduced ? '' : ', with motion'}: ${pick.length - bad.length} of ${pick.length} entries land on their own place, in view under the header, focused and marked${bad.length ? `; ${bad.length} didn’t: ${bad.slice(0, 5).join(' | ')}` : ''}`);
        await close(p);
      }
      // (the figures the meeting's money alone draws, the forecast's with QuickBooks, each on its own tile; without it,
      // Mercury's record is Financials' own, one result each: W4)
      const mtg = (all || []).filter((x) => x.href.startsWith('#/meetings/'));
      ok((mode === 'books' ? mtg.length >= 2 : true) && mtg.every((x) => /^mt-/.test(x.focus)), `${mode}: the meeting’s own figures land on their own tiles (${mtg.map((x) => `${x.title} → #${x.focus}`).join('; ') || 'none of its own'})`);
      ok((all || []).length >= (mode === 'books' ? 100 : 60), `${mode}: ${(all || []).length} entries walked`);
    }
    await setBooks();
  });

  // ─── W2: one revenue, counted one way ───
  await step('W2: with QuickBooks and no budget, the tiles, The year so far, the mix and search have one revenue, in kind left out and said once; revenue less expenses is the net', async () => {
    await setBooks({ budget: false });
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/financials');
      await sleep(2500);
      const s = await p.evaluate(() => {
        const tile = (k) => (document.getElementById(`fin-${k}`)?.innerText || '').replace(/\s+/g, ' ');
        const val = (k) => (document.querySelector(`#fin-${k} .bp-fig__value`)?.textContent || '').trim();
        const yf = (k) => (document.querySelector(`#yf-${k} .bp-yfigs__value`)?.textContent || '').trim();
        return { tiles: { rev: tile('rev'), exp: tile('exp'), net: tile('net') }, vals: { rev: val('rev'), exp: val('exp'), net: val('net') }, year: { rev: yf('rev'), exp: yf('exp'), net: yf('net') },
          left: (document.getElementById('yf-left')?.textContent || '').replace(/\s+/g, ' '), mix: [...document.querySelectorAll('.bp-mixtable tbody tr')].map((tr) => tr.querySelector('.bp-mixtable__name')?.textContent.trim() || ''),
          mixAmounts: [...document.querySelectorAll('.bp-mixtable tbody tr td.num:first-of-type')].map((td) => td.firstChild?.textContent || ''), mixHead: (document.querySelector('#mixcard .bp-sub')?.textContent || '').replace(/\s+/g, ' ') };
      });
      const n = (t) => (/^[−-]/.test(t) ? -1 : 1) * Number(String(t).replace(/[^\d.]/g, ''));
      const { compact } = await import('../public/admin/board/money.js');
      const rev = n(s.year.rev); const exp = n(s.year.exp); const net = n(s.year.net);
      ok(rev - exp === net, `${w}: The year so far adds up: ${s.year.rev} − ${s.year.exp} = ${s.year.net}`);
      ok(s.vals.rev === compact(rev) && s.vals.exp === compact(exp) && s.vals.net === `+${compact(net)}`, `${w}: the tiles are those three (${JSON.stringify(s.vals)} beside ${JSON.stringify(s.year)})`);
      ok(/Not counting \$220K in kind/.test(s.tiles.rev) && /Not counting \$220K in kind/.test(s.tiles.exp), `${w}: each tile says the in kind it leaves out, as with a budget (${s.tiles.rev} | ${s.tiles.exp})`);
      ok(!s.mix.includes('In kind') && /not counting \$220K in kind/.test(s.mixHead) && Math.abs(s.mixAmounts.reduce((t, a) => t + n(a), 0) - rev) < 1, `${w}: the mix is of that revenue, in kind said and not a part (${s.mix.join(', ')}; ${s.mixHead})`);
      const rv = (await search(p, `${Y0} revenue`)).filter((x) => x.g === 'Money' && x.title === `${Y0} revenue`);
      const ik = (await search(p, 'in kind')).filter((x) => x.g === 'Money' && x.title === 'In kind');
      await closeFinder(p);
      ok(rv.length === 1 && rv[0].line.startsWith('$1,656,045'), `${w}: search has one “${Y0} revenue”, the same figure (${JSON.stringify(rv.map((x) => x.line))})`);
      ok(ik.length === 1 && /not counted in the revenue/.test(ik[0].line), `${w}: and one “In kind”, said one way (${JSON.stringify(ik.map((x) => x.line))})`);
      await shot(p, `w2-nobudget-${w}`);
      await close(p);
    }
    await setBooks();
  });

  // ─── W3: the short form rounds to the unit it shows ───
  await step('W3: $999,700 is “$1M” on Home and in search, never “$1000K”', async () => {
    await setBooks({ sources: [cat('donations', 'Donations', 999700, ['Individual/Corporate Revenue']), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 196000), cat('account:interest', 'Interest', 3, ['Interest Income'])] });
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await p.waitForSelector('.bp-sum__mix .bp-mix__key li', { timeout: 10000 }).catch(() => {});
      await sleep(600);
      const key = await p.evaluate(() => [...document.querySelectorAll('.bp-sum__mix .bp-mix__key li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
      const page = await p.evaluate(() => document.body.innerText);
      ok(key.some((t) => /^Donations \$1M/.test(t)) && !/\$1000[KM]/.test(page), `${w}, Home: ${JSON.stringify(key)}`);
      const exact = (await search(p, '$999,700')).filter((x) => x.g === 'Money');
      const short = (await search(p, '$1M')).filter((x) => x.g === 'Money' && x.title === 'Donations');
      const old = (await search(p, '$1000K')).filter((x) => x.g === 'Money');
      await closeFinder(p);
      ok(exact.some((x) => x.title === 'Donations' && x.line.startsWith('$999,700, or $1M')) && short.length === 1 && !old.some((x) => /1000K/.test(x.line)), `${w}, search: “$999,700” ${JSON.stringify(exact.map((x) => `${x.title}: ${x.line.slice(0, 40)}`))}, “$1M” finds Donations, “$1000K” is never written (${JSON.stringify(old.map((x) => `${x.title}: ${x.line.slice(0, 40)}`))})`);
      await close(p);
    }
    await setBooks();
  });

  // ─── W4: one figure, one result ───
  await step('W4: without QuickBooks, each of Mercury’s year figures is one result: money in, money out and the net', async () => {
    await noBooks();
    const p = await tab(SAM, 1280, 900);
    await open(p, '#/');
    await sleep(1500);
    for (const [q, title] of [['$900,000', `Money in, ${Y0} so far`], ['$850,000', `Money out, ${Y0} so far`], ['$50,000', `Net, ${Y0} so far`], ['+$50,000', `Net, ${Y0} so far`]]) {
      const money = (await search(p, q)).filter((x) => x.g === 'Money');
      const same = money.filter((x) => x.title === title);
      const twice = money.filter((x, i) => money.findIndex((y) => y.title === x.title && y.line.match(/[−-]?\$[\d,]+/)?.[0] === x.line.match(/[−-]?\$[\d,]+/)?.[0]) !== i);
      // (and Mercury's record of it once, whatever its title: the meeting's tile and Financials' row are one figure)
      const merc = money.filter((x) => /Mercury’s record/.test(x.line) && x.line.replace(/^[+−-]/, '').startsWith(q.replace(/^[+−-]/, '')));
      ok(same.length === 1 && !twice.length && merc.length === 1, `“${q}”: ${JSON.stringify(money.map((x) => `${x.title} | ${x.line.slice(0, 50)}`))}`);
    }
    await closeFinder(p);
    await close(p);
    await setBooks();
  });

  // ─── W5: every fold is kept ───
  await step('W5: every fold on the page is kept on Back, Forward and a reload, “The numbers, month by month” too, and every <details> drawn is one of those', async () => {
    const p = await tab(SAM, 1280, 900);
    const unkept = [];
    for (const hash of ['#/', '#/financials', `#/meetings/${NEXT.id}`, '#/families', '#/families/acctIris01', '#/documents', '#/people']) {
      await open(p, hash);
      await sleep(1500);
      unkept.push(...(await p.evaluate((h) => [...document.querySelectorAll('details')].filter((d) => !d.dataset.kept).map((d) => `${h}: ${(d.querySelector('summary')?.textContent || '').trim().slice(0, 40)}`), hash)));
    }
    ok(!unkept.length, `every fold drawn is kept (data-kept)${unkept.length ? `; not: ${unkept.join(' | ')}` : ''}`);
    for (const [who, w, q, want] of [[SAM, 1280, '$1,364,400', 'by the end of August'], [MARIA, 390, '$341,100', 'by the end of February']]) {
      const t = await tab(who, w, 900);
      await open(t, '#/');
      await sleep(1200);
      await t.evaluate(() => window.scrollTo(0, 600));
      const found = await search(t, q);
      const hit = found.find((x) => x.g === 'Money' && `${x.title} ${x.line}`.includes(want));
      if (!hit) { ok(false, `${w}: “${q}” offers ${want} (${JSON.stringify(found.map((x) => x.title))})`); await close(t); continue; }
      await t.click(`#${hit.id}`);
      await sleep(2500);
      const fold = () => t.evaluate(() => { const d = [...document.querySelectorAll('details.by-table')][0]; return d ? d.open : null; });
      const landed = await fold();
      await t.goBack(); await sleep(2000);
      await t.goForward(); await sleep(2500);
      const forward = await fold();
      await t.reload({ waitUntil: 'networkidle0' }); await sleep(3000);
      const reloaded = await fold();
      await t.goBack(); await sleep(2000);
      await t.goForward(); await sleep(2500);
      const again = await fold();
      ok(landed && forward && reloaded && again, `${w}: “${q}” opened “The numbers, month by month” (${landed}); after Back and Forward ${forward}, a reload ${reloaded}, Back and Forward again ${again}`);
      await shot(t, `w5-forward-${w}`);
      await close(t);
    }
    await close(p);
  });

  // ─── W6 and W7: this month, so far ───
  await step('W6, W7: the newest cash bar names its day, “so far this month”, in its label and its tip; Month-end balances and search call this month so far, never a month’s end', async () => {
    await noBooks();
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/financials');
      await sleep(2500);
      const bars = await p.$$('#cashtime .bp-years__bars li');
      const label = await bars.at(-1)?.evaluate((e) => e.querySelector('[aria-label]')?.getAttribute('aria-label'));
      await bars.at(-1)?.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await sleep(400);
      await bars.at(-1)?.hover();
      await sleep(500);
      const tip = await p.evaluate(() => (document.querySelector('#cashtime .bp-ytip')?.innerText || '').replace(/\s+/g, ' '));
      ok(label === `${TODAY_MD} (so far this month): $375,000` && tip.startsWith(`${TODAY_MD} (so far this month)`), `${w}: the newest bar “${label}”, its tip “${tip}”`);
      await p.evaluate(() => { document.querySelectorAll('#cashtime details').forEach((d) => { d.open = true; }); });
      await sleep(400);
      const rows = await p.evaluate(() => [...document.querySelectorAll('#cashtime tbody tr')].map((tr) => tr.querySelector('th')?.innerText.replace(/\s+/g, ' ').trim()));
      ok(rows[0] === `${MONTH_NOW}, so far this month` && rows.slice(1).every((r) => !/so far/.test(r)), `${w}: Month-end balances: ${JSON.stringify(rows.slice(0, 3))}`);
      const found = (await search(p, '$375,000')).filter((x) => x.g === 'Money' && /^Cash/.test(x.title) && x.title.includes(MONTH_NOW));
      const end = (await search(p, 'cash at the end')).filter((x) => x.g === 'Money' && x.title.includes(MONTH_NOW));
      await closeFinder(p);
      ok(found.length === 1 && found[0].title === `Cash so far this month, ${MONTH_NOW}` && !/month’s end/.test(found[0].line) && !end.length, `${w}: search: ${JSON.stringify(found.map((x) => `${x.title} | ${x.line}`))}; “cash at the end” never this month (${end.length})`);
      await shot(p, `w6-cash-${w}`);
      await close(p);
    }
    await setBooks();
  });

  // ─── W8: brackets mean below zero ───
  await step('W8: no sentence on Financials (every fold open), the meeting’s money, Print it all or a search’s lines puts a positive amount in brackets', async () => {
    for (const mode of ['books', 'mercury']) {
      if (mode === 'books') await setBooks(); else await noBooks();
      const p = await tab(SAM, 1280, 900);
      await open(p, '#/financials');
      await sleep(2500);
      await p.evaluate(() => { document.querySelectorAll('main details').forEach((d) => { d.open = true; }); document.querySelectorAll('main button[aria-expanded="false"]').forEach((b) => { if (/Every account|Show all/.test(b.textContent)) b.click(); }); });
      await sleep(800);
      const bad = (await prose(p)).filter((t) => BRACKETED.test(t)).map((t) => `Financials: ${t.slice(0, 120)}`);
      await go(p, `#/meetings/${NEXT.id}`);
      await sleep(2000);
      await p.evaluate(() => { document.querySelectorAll('main details').forEach((d) => { d.open = true; }); });
      await sleep(500);
      bad.push(...(await prose(p)).filter((t) => BRACKETED.test(t)).map((t) => `the meeting: ${t.slice(0, 120)}`));
      // Print it all, from the next meeting (the print itself stubbed: its page read)
      await p.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
      await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Print it all/.test(x.textContent))?.click());
      await p.waitForFunction(() => !!document.querySelector('[class^="bpp"]') || window.__printed, { timeout: 30000 }).catch(() => {});
      await sleep(1200);
      bad.push(...(await p.evaluate(() => [...document.querySelectorAll('[class^="bpp"] p, [class^="bpp"] li, [class^="bpp"] span')].filter((e) => !e.closest('table')).map((e) => e.innerText.replace(/\s+/g, ' ').trim()))).filter((t) => BRACKETED.test(t)).map((t) => `Print it all: ${t.slice(0, 120)}`));
      await p.evaluate(() => document.querySelectorAll('.bpp, .bp-print, [class^="bpp-"]').forEach((x) => { if (x.parentElement === document.body) x.remove(); }));
      // Search's lines: a short form beside its amount
      for (const q of ['revenue', '$1.66M', 'net', 'store', 'cash', '$2M', 'lowest', 'Total Income', 'money in']) {
        for (const x of (await search(p, q)).filter((y) => y.g === 'Money')) if (BRACKETED.test(x.line)) bad.push(`search “${q}”: ${x.title} | ${x.line.slice(0, 100)}`);
      }
      await closeFinder(p);
      ok(!bad.length, `${mode}: no amount above zero in brackets${bad.length ? `; ${bad.length}: ${[...new Set(bad)].slice(0, 6).join(' | ')}` : ''}`);
      await close(p);
    }
    await setBooks();
  });

  // ─── W9: amounts heard apart ───
  await step('W9: a screen reader hears the revenue table’s amount and share apart at 390, 375 and 1280, and no amount runs into the next words on Home, Financials or the meeting at 390 and 1280', async () => {
    for (const [who, w] of [[MARIA, 390], [SAM, 375], [SAM, 1280]]) {
      const p = await tab(who, w, 844);
      await open(p, '#/financials');
      await sleep(2500);
      const cdp = await p.createCDPSession();
      await cdp.send('Accessibility.enable');
      const names = [];
      for (const sel of ['#mix-donations td.num', '#mix-store td.num', '#mix-rest td.num']) {
        const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
        if (!nodeId) { names.push(`${sel}: none`); continue; }
        const ax = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        names.push(String(ax.nodes[0]?.name?.value || ''));
      }
      ok(names.every((n) => /^\$[\d,]+\s+(\d+%|under 1%)$/.test(n)), `${w}: the cells are heard ${JSON.stringify(names)}`);
      await cdp.detach().catch(() => {});
      await close(p);
    }
    // (an amount as the page writes it, taken whole, then what touches it: "$700,00042%", "$1.66MNot", "42%Store")
    const RUN = /(?=(\$\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?))\1(?=[\dA-Za-z$])|\d%(?=[\dA-Za-z$])/;
    for (const [who, w] of [[MARIA, 390], [SAM, 1280]]) {
      const p = await tab(who, w, 900);
      const bad = [];
      for (const hash of ['#/', '#/financials', `#/meetings/${NEXT.id}`]) {
        await open(p, hash);
        await sleep(2000);
        await p.evaluate(() => { document.querySelectorAll('main details').forEach((d) => { d.open = true; }); });
        await sleep(500);
        bad.push(...(await p.evaluate((re) => {
          const run = new RegExp(re);
          return [...document.querySelectorAll('main :is(td, th, li, dd, p, figcaption, .bp-fig, .bp-agfig)')].filter((e) => e.getClientRects().length && !e.closest('[aria-hidden="true"], svg')).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => run.test(t));
        }, RUN.source)).map((t) => `${hash}: ${t.slice(0, 90)}`));
      }
      ok(!bad.length, `${w}: no amount runs into the next words${bad.length ? `; ${[...new Set(bad)].slice(0, 5).join(' | ')}` : ''}`);
      await close(p);
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
console.log('\nAll round 11 member checks passed. Screenshots in test-results/board-round11-member/');
process.exit(0);
