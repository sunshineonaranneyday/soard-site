/**
 * test-board-round7-member.mjs: the board page as members see it, as QA round 7 found it (Nov 21 2026)
 * =====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round6-member.mjs
 * does; JobTread (its jobs), Mercury (its balances), Google and Resend are faked, QuickBooks' year, statements and budget
 * kept in D1 as its read leaves them, the photos and the map's tiles a square of gray. Made-up people only.
 *   M1  Every money statement slide (budget against actual, financial position, activities, and the rest of QuickBooks'
 *       slides) fits a phone's screen: at 320, 360, 375, 390, 414, 768 and 1024, as the presenter stepping onto it and
 *       as a member following the meeting live there, every column on the screen, nothing cut, no sideways scroll
 *   m1  A reveal tag's wording always shows whole: the longest that truly fits its card (its room measured as the CSS
 *       limits it, to the fraction of a pixel), never one cut with "…": a sweep of cards a tenth of a pixel apart, and
 *       the makeovers slide itself at five sizes
 *   m2  The Makeovers map: the families with no home in JobTread named by stage beside the key, so the key and the line
 *       over the map add up stage by stage; no pin dot beside them in the list
 *   m3  A makeover with no application is in the season it belongs to (its kid page's year), and the words say only what's
 *       known ("no application in Board"), never "from before the applications"
 *   m4  The chair's review link, the review not on: said so for a meeting ahead that isn't the next one too
 *   m5  Search finds the headline money figures by amount, however they're typed: the year's revenue, expenses and net,
 *       the cash in the bank and each of its accounts, the store's sales, cost of goods and profit; the line says it,
 *       marked
 *   m6  On a phone the map's key comes before the map in the keyboard's order, and a switch reached going up the page
 *       comes into view clear of the header
 *   m7  The cash's accounts, rounded, add up to the cash beside them
 * Screenshots land in test-results/board-round7-member/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round7-member.mjs            (ONLY=M1,m1 runs those steps alone; PORT=4731 a port of its own)
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { agendaApproved } from '../tests/lib/agenda-approved.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, patchMeeting, getMeeting, provideBoardFinance, ensureSchema } from '../functions/api/_board.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round7-member/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const Y0 = Number(day(0).slice(0, 4));
// (the families applying for next year; the makeovers being built are this year's)
const YEAR = Y0 + 1;

const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const MARIA = 'maria.board@example.com';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', order: 3 },
  'maria-de-la-cruz-whitfield': { name: 'Maria-Fernanda de la Cruz Whitfield', group: 'board', title: 'Board Member', order: 4 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 5 },
};
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', 'taylor.board@example.net'], ['maria-de-la-cruz-whitfield', MARIA]];
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

// ── QuickBooks: the year so far, last year, the statements and the budget, as its read keeps them (the tester's) ──
{
  const yr = Y0;
  const cat = (key, name, amount, accounts) => ({ key, name, amount, accounts });
  const ytdBooks = { year: String(yr), from: `${yr}-01-01`, through: day(0), revenue: 1876045, spent: 1200000, net: 676045, basis: 'Accrual', nonCash: 220000, sources: [
    cat('donations', 'Donations', 700000, ['Individual/Corporate Revenue']), cat('store', 'Store sales', 415000, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000, ['Gala Income']),
    cat('inkind', 'In kind', 220000, ['In-Kind Contribution']), cat('grants', 'Grants', 90000, ['Grant Revenue']), cat('account:golf classic', 'Golf Classic', 30000, ['Golf Classic Income']),
    cat('account:rent', 'Rent', 16000, ['Rent Income']), cat('account:interest', 'Interest', 5000, ['Interest Income']), cat('account:makeover', 'Makeover', 45, ['Makeover Revenue']),
  ], store: { sales: 415000, cost: 250000, profit: 165000, salesAccounts: ['Store Income', 'Store Discounts'], costAccounts: ['Store COGS'] } };
  const lastBooks = { year: String(yr - 1), through: `${yr - 1}${day(0).slice(4)}`, revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, full: { revenue: 2000000, expenses: 1500000, net: 500000, nonCash: 100000 },
    sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)],
    store: { sales: 830000, cost: 380000, profit: 450000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
  await DB.exec('CREATE TABLE IF NOT EXISTS books_link (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, company TEXT, fiscal_start INTEGER, access_token TEXT, access_expires TEXT, refresh_token TEXT NOT NULL, refresh_expires TEXT, ytd TEXT, read_at TEXT, tried_at TEXT, error TEXT, error_at TEXT, error_detail TEXT, told TEXT, linked_at TEXT, linked_by TEXT)');
  await DB.exec('CREATE TABLE IF NOT EXISTS books_daily (id TEXT PRIMARY KEY, data TEXT, day TEXT, read_at TEXT, tried_at TEXT, error TEXT)');
  const readAt = new Date().toISOString();
  await DB.prepare('INSERT OR REPLACE INTO books_link (id, realm_id, company, refresh_token, ytd, read_at, tried_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('qbo', '9130350000000001', 'Example Charity', 'refresh-test', JSON.stringify(ytdBooks), readAt, readAt).run();
  const thisMonth = Number(day(0).slice(5, 7));
  const monthly = { year: String(yr), lastYear: String(yr - 1),
    months: Array.from({ length: thisMonth }, (_, i) => ({ month: `${yr}-${String(i + 1).padStart(2, '0')}`, revenue: Math.round(1876045 / thisMonth), spent: Math.round(1200000 / thisMonth), nonCash: Math.round(220000 / thisMonth) })),
    last: Array.from({ length: 12 }, (_, i) => ({ month: `${yr - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000, spent: 125000, nonCash: 8000 })) };
  const statements = { asOf: day(-30), closed: false, priorAsOf: `${yr - 1}${day(-30).slice(4)}`,
    position: [{ k: 'head', label: 'Assets', d: 0 }, { k: 'total', label: 'Total Bank Accounts', d: 1, a: 608532, p: 655431 }, { k: 'total', label: 'TOTAL ASSETS', d: 0, a: 870767, p: 794994 }],
    activity: [{ k: 'head', label: 'Income', d: 0 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, p: 1909703 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, p: 176000 }] };
  const budget = { name: `Budget_FY${String(yr).slice(2)}_P&L`, from: `${yr}-01-01`, to: `${yr}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 },
    rows: [{ k: 'head', label: 'Income', d: 0 }, { k: 'acct', label: 'Individual/Corporate Revenue', d: 1, a: 700000, b: 500000, y: 600000 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, b: 150000, y: 180000 }] };
  await DB.prepare('INSERT OR REPLACE INTO books_daily (id, data, day, read_at, tried_at) VALUES (?, ?, ?, ?, ?)').bind('qbo', JSON.stringify({ shape: 3, day: day(0), lastYear: lastBooks, trailing: null, months: [], statements, functions: null, monthly, budget }), day(0), readAt, readAt).run();
}

// ── The makeovers and the families ──
const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
let JOBS = [];
let REVEALS = [];
const FIRST = ['Ava', 'Montgomery', 'Benjamin', 'Evangeline', 'Christopher', 'Dahlia', 'Wilhelmina', 'Eli', 'Bartholomew', 'Francesca', 'Gabriel', 'Penelope', 'Hannah', 'Isaac'];
const FLOW = ['Awaiting Funding', 'Design', 'Design', 'Finalization', 'Approval', 'Mobilization', 'Build', 'Build'];
const monthAhead = (k) => { const d = new Date(`${day(0)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k, 15); return d.toISOString().slice(0, 7); };
const monthName = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
const REVEAL_OF = [['set', 5, '18:00'], ['window', 'mid', 1], ['set', 12, '10:30'], null, ['set', 20, '15:45'], ['window', 'late', 2], ['set', 9, '10:00'], ['window', 'early', 3]];
/** The makeovers slide's families: [[first name, JobTread status, reveal]], each with a photo on their page */
async function setPipe(list) {
  await DB.exec('DELETE FROM kids');
  JOBS = list.map(([name, status], i) => JOB(`jq${i}`, `${name} (${Y0})`, status));
  REVEALS = [];
  for (const [name, , reveal] of list) {
    const slug = `${name.toLowerCase()}-${Y0}`;
    await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, Y0, JSON.stringify({ name, year: Y0, childCount: 1, roomCount: 1, heroImage: `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/${slug}/1/public` })).run();
    if (reveal?.[0] === 'set') REVEALS.push({ slug, name, confirmed: true, date: day(reveal[1]), time: reveal[2], kidUrl: `/kids/${slug}/` });
    if (reveal?.[0] === 'window') { const month = monthAhead(reveal[2]); REVEALS.push({ slug, name, confirmed: false, window: { part: reveal[1], month, label: `${reveal[1]} ${monthName(month)}`, through: day(120) }, kidUrl: `/kids/${slug}/` }); }
  }
  await DB.prepare('INSERT OR REPLACE INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: REVEALS, updatedAt: new Date().toISOString() })).run();
  await DB.exec('CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
  await DB.prepare("DELETE FROM board_state WHERE key = 'projects'").run();
}
const many = (n) => Array.from({ length: n }, (_, i) => [FIRST[i % FIRST.length], FLOW[i % FLOW.length], REVEAL_OF[i % REVEAL_OF.length]]);

// The families who applied (made-up): two applying with a home, one approved; two with no home in JobTread yet (m2:
// one in review, one approved); Maya's family, her makeover being built. And JobTread's makeovers with no application:
// Leo, being built, his kid page this year's (m3), one awaiting funding and one not named yet
const F = (name, status, season, lat, lng, more = {}) => ({ name, status, season, lat, lng, area: 'inside', miles: 0, city: 'Roswell', county: 'Fulton', types: ['Therapy Room'], fields: { diagnosis: 'An example diagnosis', birthday: '2017-05-01', mobile: 'No', verbal: 'Yes', language: 'English' }, ...more });
const FAMILIES = {
  acctIris01: F('Iris Example', 'Approved', YEAR, 34.02, -84.36),
  acctJay001: F('Jay Example', 'In Review', YEAR, 33.93, -84.51, { city: 'Marietta', county: 'Cobb' }),
  acctMia001: F('Mia Example', 'Applied', YEAR, 34.07, -84.17, { city: 'Johns Creek' }),
  acctNoah01: F('Noah Example', 'Approved', YEAR, null, null, { city: 'Decatur' }),
  acctRuth01: F('Ruth Example', 'In Review', YEAR, null, null, { city: '' }),
  acctMaya01: F('Maya Example', 'Approved', Y0, 34.05, -84.3, { jobId: 'jm1', city: 'Alpharetta' }),
};
for (const [id, f] of Object.entries(FAMILIES)) {
  await DB.prepare(`INSERT INTO applicants (account_id, name, status, year, types, fields, address, city, county, lat, lng, area, area_miles, contact_name, contact_email, contact_phone, contacts, photo_url, created_at, synced_at, job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, f.name, f.status, String(f.season), JSON.stringify(f.types), JSON.stringify(f.fields), '12 Elm St, Roswell, GA 30075', f.city, f.county, f.lat, f.lng, f.area, f.miles, 'Parent Example', 'parent@example.com', '4045550100', '[]', null, `${day(-9)}T14:00:00Z`, new Date().toISOString(), f.jobId || null).run();
}
const MAP_JOBS = [JOB('jm1', `Maya (${Y0})`, 'Build'), JOB('jm2', `Leo (${Y0})`, 'Design'), JOB('jm3', `Someone Else (${Y0})`, 'Awaiting Funding'), JOB('jm4', `Not Published Yet (${Y0})`, 'Design')];
async function mapKids() {
  await DB.exec('DELETE FROM kids');
  for (const [slug, name] of [[`maya-${Y0}`, 'Maya'], [`leo-${Y0}`, 'Leo']]) await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, Y0, JSON.stringify({ name, year: Y0, childCount: 1, roomCount: 1 })).run();
  await DB.exec('CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
  await DB.prepare("DELETE FROM board_state WHERE key = 'projects'").run();
  JOBS = [];
}
await mapKids();

// ── The outside world, faked ──
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPw8PAAAAMkAVHY5VgwAAAAAElFTkSuQmCC', 'base64');
const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', JOBTREAD_GRANT_KEY: 'jt-test', MERCURY_API_TOKEN: 'mercury-test', MERCURY_RELAY_KEY: 'relay-test' };
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
    return Response.json({ organization: { jobs: { nodes: JOBS.length ? JOBS : MAP_JOBS, nextPage: null } } });
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

// ── The meetings: today's, on the board page (presented, and followed live); and one ahead after it, being drafted ──
const board = (status = '') => (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board', status });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash' }] },
  { title: 'Programs', items: [{ title: 'Makeovers in progress', live: 'projects' }, { title: 'Upcoming reveals', live: 'reveals' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
const NEXT = await getMeeting(DB, (await patchMeeting(DB, (await make(day(0))).id, (cur) => ({ ...cur, shared: true }))).id);
await agendaApproved(DB, NEXT.id, 'Alex Rivera');
const LATER = await make(day(100), { agendaFrom: { kind: 'template' } });
const itemOf = (m, live) => m.sections.flatMap((s) => s.items.map((it) => ({ ...it, sectionId: s.id }))).find((it) => it.live === live || it.title === live);
const FIN = itemOf(NEXT, 'cash');
const MAKEOVERS = itemOf(NEXT, 'projects');

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
const LAUNCH = { headless: 'shell', protocolTimeout: 30000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] };
let browser = await puppeteer.launch(LAUNCH);
async function relaunch() {
  try { browser.process()?.kill('SIGKILL'); } catch { /* gone */ }
  await sleep(300);
  browser = await puppeteer.launch(LAUNCH);
}
const errs = [];
const within = (ms, p) => Promise.race([p, sleep(ms).then(() => { throw new Error(`no answer in ${ms / 1000} s`); })]);
/** A tab as `email` at `width`×`height`, its photos and the map's tiles a gray square */
async function tab(email, width = 1280, height = 900) {
  const page = await within(15000, browser.newPage());
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  const phone = width < 600;
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await page.setExtraHTTPHeaders({ 'x-test-user': email });
  page.on('pageerror', (e) => errs.push(`${email} ${width}: PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|x-test-user|403/.test(m.text())) errs.push(`${email} ${width}: ${m.text().slice(0, 300)}`); });
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
const text = (page, sel = 'main') => page.evaluate((s) => (document.querySelector(s)?.innerText || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(), sel);
const shot = async (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
const dims = (size) => size.split('x').map(Number);
const setLive = (fileId) => patchMeeting(DB, NEXT.id, (cur) => ({ ...cur, live: fileId === null ? null : { startedAt: new Date(Date.now() - 600000).toISOString(), endedAt: '', itemId: FIN.id, sectionId: FIN.sectionId, fileId, page: 0, part: 0, screen: '', vote: null, sectionAt: new Date().toISOString(), floor: '' } }));

/** A money statement slide on the screen, as it lies: where it ends, its cells past the screen's edge, anything cut */
const slideNow = (page) => page.evaluate(() => {
  const vis = (e) => e && e.getClientRects().length > 0;
  const slide = [...document.querySelectorAll('.by-slide')].find(vis);
  if (!slide) return null;
  const vw = document.documentElement.clientWidth;
  const stage = document.querySelector('.bs-stage');
  const r = (e) => e.getBoundingClientRect();
  const name = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const table = slide.querySelector('table');
  return {
    title: name(slide.querySelector('.by-slide__title') || slide),
    vw, right: Math.round(r(slide).right * 10) / 10, stage: [stage?.scrollWidth, stage?.clientWidth], doc: document.documentElement.scrollWidth,
    cols: table ? [...table.querySelectorAll('thead th')].filter(vis).length : 0,
    past: [...slide.querySelectorAll('th, td, .bs-eyebrow, .by-slide__title, svg')].filter(vis).filter((e) => r(e).right > vw + 0.5 || r(e).left < -0.5).map(name).slice(0, 6),
    cut: [...slide.querySelectorAll('th, td, .bs-eyebrow, .by-slide__title')].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1).map(name).slice(0, 6),
    font: table ? parseFloat(getComputedStyle(table).fontSize) : 0,
  };
});
const slideOk = (s) => !!s && s.right <= s.vw + 0.5 && s.stage[0] <= s.stage[1] && s.doc <= s.vw && !s.past.length && !s.cut.length;
const slideSaid = (s) => (s ? `${s.title}: right ${s.right} of ${s.vw}, stage ${s.stage.join('/')}, ${s.cols} columns, font ${s.font}px${s.past.length ? `, past the edge: ${s.past.join(', ')}` : ''}${s.cut.length ? `, cut: ${s.cut.join(', ')}` : ''}` : 'no slide');

/**
 * Every reveal tag under `sel` measured exactly (a Range's width against its content box, to the fraction of a pixel):
 * cut (its words wider than its room) and short (the wording before it, longer, would have fit) → { n, cut, short }.
 * (Within a twentieth of a pixel is the browser's own rounding of a box, a 64th of a pixel at a time: neither)
 */
const tagsNow = (page, sel = '.bs-pipe') => page.evaluate((sel) => {
  const out = { n: 0, cut: [], short: [] };
  const widths = (t) => {
    const cs = getComputedStyle(t);
    const g = document.createRange();
    g.selectNodeContents(t);
    return [g.getBoundingClientRect().width, t.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)];
  };
  for (const t of document.querySelectorAll(`${sel} .bs-pipe__photo > .bs-pipe__when[data-forms]`)) {
    if (!t.getClientRects().length) continue;
    out.n += 1;
    const forms = t.dataset.forms.split('\n');
    const said = t.textContent;
    const [words, room] = widths(t);
    if (words > room + 0.05) out.cut.push(`“${said}” ${words.toFixed(2)} in ${room.toFixed(2)}`);
    const k = forms.indexOf(said);
    if (k > 0) {
      t.textContent = forms[k - 1];
      const [w2, r2] = widths(t);
      if (w2 < r2 - 0.05) out.short.push(`“${said}” where “${forms[k - 1]}” fits (${w2.toFixed(2)} in ${r2.toFixed(2)})`);
      t.textContent = said;
    }
  }
  return out;
}, sel);

try {
  // ─── m2 and m3: the map's key and line agree for every family; each makeover in its season ───
  await step('m2: the Makeovers map: the families with no home in JobTread named by stage, so the key and the line add up', async () => {
    const count = (re, s) => Number((s.match(re) || [])[1] || 0);
    for (const w of [1280, 390]) {
      const p = await tab(MARIA, w, 900);
      await open(p, '#/families/map');
      await p.waitForSelector('.fm-stage .apl-legend', { timeout: 10000 });
      await sleep(800);
      const r = await p.evaluate(() => {
        const scope = document.querySelector('main');
        const sum = (scope.querySelector('.bf-sum')?.innerText || '').replace(/\s+/g, ' ');
        const key = Object.fromEntries([...scope.querySelectorAll('.fm-stage .apl-legend button')].map((b) => [b.textContent.replace(b.querySelector('b')?.textContent || '', '').trim().toLowerCase(), Number(b.querySelector('b')?.textContent || 0)]));
        const said = (scope.querySelector('.fm-stage')?.innerText || '').replace(/\s+/g, ' ');
        const rows = [...scope.querySelectorAll('.fm-row')].map((b) => [b.querySelector('strong')?.textContent || '', !!b.querySelector('.fm-row__pin')]);
        return { sum, key, said, rows };
      });
      // "2 families have no home in JobTread yet (1 in review, 1 approved)" and "3 more makeovers aren't on the map (...)"
      const parts = (re) => Object.fromEntries(((r.said.match(re) || [])[1] || '').split(/,\s*/).filter(Boolean).map((x) => { const m = x.match(/^(\d+) (.+)$/); return [m[2], Number(m[1])]; }));
      const noHome = parts(/no home in JobTread yet \(([^)]*)\)/);
      const away = parts(/on the map \(([^)]*)\)/);
      const all = (k) => (r.key[k] || 0) + (noHome[k] || 0) + (away[k] || 0);
      const lines = [
        ['applying', count(/(\d+) famil(?:y|ies) applying/, r.sum), all('applied') + all('in review')],
        ['approved', count(/(\d+) approved/, r.sum), all('approved')],
        ['awaiting funding', count(/(\d+) awaiting funding/, r.sum), all('awaiting funding')],
        ['building', count(/(\d+) makeovers? being built/, r.sum), all('building')],
      ];
      const off = lines.filter(([, n, k]) => n !== k);
      ok(Object.keys(noHome).length > 0 && !off.length, `${w}: the line (${r.sum}) = the key + the no-home families + the makeovers with no pin, stage by stage (${JSON.stringify(r.key)} + ${JSON.stringify(noHome)} + ${JSON.stringify(away)})${off.length ? `: ${off.map(([k, n, s]) => `${k} ${n} ≠ ${s}`).join(', ')}` : ''}`);
      const noPin = r.rows.filter(([n]) => /^(Noah|Ruth) Example$/.test(n));
      ok(noPin.length === 2 && noPin.every(([, dot]) => !dot) && r.rows.filter(([n]) => !/^(Noah|Ruth) /.test(n)).every(([, dot]) => dot), `${w}: no pin dot beside a family with no pin in the list (${JSON.stringify(r.rows)})`);
      await shot(p, `m2-map-${w}`);
      await close(p);
    }
  });
  await step('m3: a makeover with no application in its season (its kid page’s year), and only what’s known said of it', async () => {
    const p = await tab(MARIA, 1280, 900);
    await open(p, '#/families');
    await p.waitForSelector('.lc-seasons button', { timeout: 10000 });
    await p.evaluate((y) => [...document.querySelectorAll('.lc-seasons button')].find((b) => b.textContent.trim() === y)?.click(), String(Y0));
    await sleep(900);
    const t = await text(p);
    const sum = (await text(p, '.bf-sum')) || '';
    // Maya (her application, this season), Leo (his kid page says this year) and the one not named yet (the year in its
    // JobTread name) are all being built this season, and the one awaiting funding is in it too (its name's year): the
    // season says what Home says
    ok(/3 makeovers being built/.test(sum) && /1 awaiting funding/.test(sum), `${Y0}: Leo’s makeover counted in its season, and the two with only a JobTread name by its year (${sum})`);
    ok(/Leo/.test(t), `${Y0}: Leo is in it (${t.slice(0, 200)})`);
    await p.evaluate(() => [...document.querySelectorAll('.lc-seasons button')].find((b) => b.textContent.trim() === 'Now')?.click());
    await open(p, '#/families/list');
    await p.waitForSelector('.bf-list', { timeout: 10000 }).catch(() => {});
    await sleep(700);
    const rows = await p.evaluate(() => [...document.querySelectorAll('.bf-list .bf-row__who span')].map((x) => x.textContent));
    ok(rows.length > 0 && !rows.some((x) => /before the applications/i.test(x)) && rows.some((x) => /^No application in Board$/.test(x)), `Now, the list: a makeover with no application says just that, never “from before the applications”, which nothing here knows (${JSON.stringify(rows)})`);
    await shot(p, 'm3-season-1280');
    await close(p);
    const m = await tab(MARIA, 1280, 900);
    await open(m, '#/families/map');
    await m.waitForSelector('.fm-stage .apl-legend', { timeout: 10000 });
    await sleep(700);
    const note = await text(m, '.fm-key__note');
    ok(/no application in Board for them, so no address/.test(note) && !/before the applications/.test(note), `the map says what’s true of them (${note})`);
    await close(m);
  });

  // ─── m6 ───
  await step('m6: on a phone the map’s key before the map in the keyboard’s order, and a switch reached going up clear of the header', async () => {
    // (windows short enough that the page goes on well past the key)
    for (const [w, h] of [[390, 600], [640, 450]]) {
      const p = await tab(MARIA, w, h);
      await open(p, '#/families/map');
      await p.waitForSelector('.fm-stage .apl-legend button', { timeout: 10000 });
      await p.waitForSelector('.leaflet-marker-icon', { timeout: 10000 }).catch(() => {});
      await sleep(800);
      // From the season switch, Tab: the key's switches, then the map
      await p.evaluate(() => { [...document.querySelectorAll('.lc-seasons button')].at(-1)?.focus(); });
      const stops = [];
      for (let i = 0; i < 9; i++) {
        await p.keyboard.press('Tab');
        await sleep(120);
        stops.push(await p.evaluate(() => { const a = document.activeElement; return a?.closest('.apl-legend') ? 'key' : a?.closest('.fm-map') ? 'map' : a?.closest('.fm-side') ? 'list' : 'other'; }));
      }
      const firstKey = stops.indexOf('key');
      const firstMap = stops.indexOf('map');
      ok(firstKey === 0 && (firstMap < 0 || firstKey < firstMap) && !stops.slice(firstMap < 0 ? stops.length : firstMap).includes('key'), `${w}: the key’s switches, then the map (${stops.join(' → ')})`);
      // Going back up the page: the header comes back, and a key switch half under it (in the window, so the browser
      // needn't scroll to it) is focused; it comes clear of the header, by Shift+Tab from the map and focused itself
      const where = () => p.evaluate(() => {
        const a = document.activeElement;
        if (!a?.closest('.apl-legend')) return null;
        const r = a.getBoundingClientRect();
        const head = document.querySelector('.bp-top').getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(8, r.height / 2));
        return { name: a.textContent.replace(/\s+/g, ' ').trim(), top: Math.round(r.top), head: Math.round(head.bottom), covered: !!at && !a.contains(at) };
      });
      // (down the page past it, then back up until `which` switch's top is 12px down the window, under the header)
      const underHead = async (which) => {
        await p.evaluate((which) => {
          const b = [...document.querySelectorAll('.fm-stage .apl-legend button')].at(which);
          window.scrollTo(0, window.scrollY + b.getBoundingClientRect().top + 300);
        }, which);
        await sleep(500);
        await p.evaluate((which) => {
          const b = [...document.querySelectorAll('.fm-stage .apl-legend button')].at(which);
          window.scrollTo(0, window.scrollY + b.getBoundingClientRect().top - 12);
        }, which);
        await sleep(700);
        return p.evaluate((which) => {
          const b = [...document.querySelectorAll('.fm-stage .apl-legend button')].at(which);
          return [Math.round(b.getBoundingClientRect().top), Math.round(document.querySelector('.bp-top').getBoundingClientRect().bottom)];
        }, which);
      };
      await p.evaluate(() => document.querySelector('.fm-map')?.focus({ preventScroll: true }));
      const [t1, h1] = await underHead(-1);
      let seen = null;
      for (let i = 0; i < 4 && !seen; i++) {
        await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
        await sleep(800);
        seen = await where();
      }
      ok(t1 < h1 && !!seen && seen.top >= seen.head && !seen.covered, `${w}: Shift+Tab up from the map, “${seen?.name}” (under the header at ${t1}, its foot ${h1}) lands clear of it (its top ${seen?.top}, the header’s foot ${seen?.head}${seen?.covered ? ', under it' : ''})`);
      const [t2, h2] = await underHead(0);
      await p.evaluate(() => document.querySelector('.fm-stage .apl-legend button')?.focus());
      await sleep(800);
      const first = await where();
      ok(t2 < h2 && !!first && first.top >= first.head && !first.covered, `${w}: focused half under the header (at ${t2}, its foot ${h2}), “${first?.name}” comes clear of it (its top ${first?.top}, the header’s foot ${first?.head}${first?.covered ? ', under it' : ''})`);
      if (w === 390) await shot(p, 'm6-key-going-up-390');
      await close(p);
    }
  });

  // ─── m5 ───
  await step('m5: search finds the headline money figures by amount, however they’re typed, the line saying it, marked', async () => {
    const search = async (p, q) => {
      if (!(await p.$('dialog.bp-finder[open]'))) { await p.click('button.bp-find'); await p.waitForSelector('dialog.bp-finder[open] input', { timeout: 5000 }); }
      await p.$eval('dialog.bp-finder input', (i) => { i.focus(); i.select(); });
      await p.keyboard.press('Backspace');
      await p.keyboard.type(q, { delay: 20 });
      await p.waitForFunction(() => document.querySelector('.bp-finder [role=option]') || /Nothing found/.test(document.querySelector('.bp-finder__none')?.textContent || ''), { timeout: 10000 }).catch(() => {});
      await sleep(900);
      return p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=option]')].map((x) => ({ title: x.querySelector('.bp-finder__title')?.innerText || '', line: [...x.querySelectorAll('.bp-finder__sub')].map((s) => s.innerText).join(' | '), marks: [...x.querySelectorAll('.bp-finder__sub mark')].map((m) => m.textContent) })));
    };
    const WANT = [
      [['$980,000', '980000', '980,000.00'], new RegExp(`^${Y0} expenses$`), '$980,000', '980,000'],
      [['1,656,045', '$1,656,045', '1656045'], new RegExp(`^${Y0} revenue$`), '$1,656,045', '1,656,045'],
      [['$676,045', '676045'], new RegExp(`^${Y0} net$`), '$676,045', '676,045'],
      [['312,500', '$312,500.00'], /^Operating$/, '$312,500', '312,500'],
      [['62500'], /^Reserve$/, '$62,500', '62,500'],
      [['$375,000', '375000'], /^Cash in the bank$/, '$375,000', '375,000'],
      /* r10: each of the store's lines is a result of its own (round 10, finding 1), its line saying only its amount */
      [['$415,000'], /^The store’s sales$/, '$415,000, ', '415,000'],
      [['250000', '$250,000'], /^The store’s cost of goods$/, '$250,000, ', '250,000'],
      [['165,000'], /^The store’s profit before staff and rent$/, '$165,000, ', '165,000'],
    ];
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(2500);
      for (const [qs, title, line, mark] of WANT) {
        for (const q of who === SAM ? qs : qs.slice(0, 1)) {
          const found = await search(p, q);
          const hit = found.find((x) => title.test(x.title.trim()));
          ok(!!hit && hit.line.includes(line) && hit.marks.includes(mark), `${w}: “${q}” finds ${title.source.replace(/[\^$]/g, '')}, its line saying it, marked (${hit ? `${hit.line.slice(0, 110)} · marked ${JSON.stringify(hit.marks)}` : `not found: ${JSON.stringify(found.slice(0, 4).map((x) => x.title))}`})`);
          if (q === '$980,000') await shot(p, `m5-search-${w}`);
        }
      }
      await close(p);
    }
  });

  // ─── QA round 8 (members): a figure found in the form its tile shows it, "net income", each line of QuickBooks'
  // statements, landing on its row; the revenue's shares adding up to 100% ───
  await step('r8: search finds a figure as its tile shows it ("$1.66M", "+$676K") and in words, "net income", and every statement line, landing on its row', async () => {
    const search = async (p, q) => {
      if (!(await p.$('dialog.bp-finder[open]'))) { await p.click('button.bp-find'); await p.waitForSelector('dialog.bp-finder[open] input', { timeout: 5000 }); }
      await p.$eval('dialog.bp-finder input', (i) => { i.focus(); i.select(); });
      await p.keyboard.press('Backspace');
      await p.keyboard.type(q, { delay: 20 });
      await p.waitForFunction(() => document.querySelector('.bp-finder [role=option]') || /Nothing found/.test(document.querySelector('.bp-finder__none')?.textContent || ''), { timeout: 10000 }).catch(() => {});
      await sleep(900);
      return p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=option]')].map((x) => ({ title: x.querySelector('.bp-finder__title')?.innerText || '', line: [...x.querySelectorAll('.bp-finder__sub')].map((s) => s.innerText).join(' | '), marks: [...x.querySelectorAll('.bp-finder__sub mark')].map((m) => m.textContent) })));
    };
    // [what's typed, the title found, words its line has, a mark it has]
    const WANT = [
      [['$1.66M', '1.66m', '1.66 million'], new RegExp(`^${Y0} revenue$`), '$1,656,045 ($1.66M)', /^1\.66M?$/],
      [['+$676K', '676k', '676 thousand'], new RegExp(`^${Y0} net$`), '$676,045 (+$676K)', /^676K?$/],
      [['net income'], new RegExp(`^${Y0} net$`), '$676,045', null],
      /* r9: a statement line says its short form beside its amount when it rounds, as other money results do (round 9, finding 4) */
      [['net income', '$189,248', '189248'], /^Net Income$/, '$189,248 ($189K), on the statement of activities', null],
      [['$870,767', 'total assets'], /^TOTAL ASSETS$/, '$870,767 ($871K), on the statement of financial position', null],
      // (a round amount's line has it once: "$700,000", never "$700,000 ($700K)")
      [['$700K', '700 thousand'], /^Donations$/, '$700,000, 42% of', /^700(,000)?$/],
    ];
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(2500);
      for (const [qs, title, line, mark] of WANT) {
        for (const q of who === SAM ? qs : qs.slice(0, 1)) {
          const found = await search(p, q);
          const hit = found.find((x) => title.test(x.title.trim()));
          ok(!!hit && hit.line.includes(line) && (!mark || hit.marks.some((m) => mark.test(m))), `${w}: “${q}” finds ${title.source.replace(/[\^$]/g, '')}, its line saying it${mark ? ', marked' : ''} (${hit ? `${hit.line.slice(0, 110)} · marked ${JSON.stringify(hit.marks)}` : `not found: ${JSON.stringify(found.slice(0, 4).map((x) => x.title))}`})`);
          if (q === '$1.66M') await shot(p, `r8-search-${w}`);
        }
      }
      // A statement line lands on its row: the statement it's on shown, the row focused
      for (const [q, title, id, view] of [['$870,767', /^TOTAL ASSETS$/, 'st-pos-r2', 'Financial position'], ['$189,248', /^Net Income$/, 'st-act-r2', 'Activities']]) {
        await search(p, q);
        const at = await p.evaluate((src) => [...document.querySelectorAll('.bp-finder [role=option]')].findIndex((x) => new RegExp(src).test((x.querySelector('.bp-finder__title')?.innerText || '').trim())), title.source);
        if (at >= 0) await p.evaluate((i) => document.querySelectorAll('.bp-finder [role=option]')[i].click(), at);
        await p.waitForFunction((x) => document.activeElement?.id === x, { timeout: 6000 }, id).catch(() => {});
        // (the page scrolls there smoothly: given the moment it takes)
        await p.waitForFunction(() => { const r = document.activeElement?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; }, { timeout: 4000 }).catch(() => {});
        const got = await p.evaluate(() => ({ hash: location.hash, id: document.activeElement?.id || '', row: document.activeElement?.querySelector('th')?.textContent || '', view: document.querySelector('.bp-stmts [aria-pressed="true"]')?.textContent?.trim() || '', inView: (() => { const r = document.activeElement?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; })() }));
        ok(at >= 0 && got.hash === '#/financials' && got.id === id && got.view.startsWith(view) && got.inView, `${w}: picking “${q}” lands on its row, on ${view}, in view (${JSON.stringify(got)})`);
        if (q === '$870,767') await shot(p, `r8-land-${w}`);
        await open(p, '#/');
        await sleep(1200);
      }
      await close(p);
    }
  });
  await step('r8: the revenue’s shares add up to 100%, rounded together (Grants 5.43% is 6%), on Home and Financials', async () => {
    for (const [who, w] of [[SAM, 1280], [MARIA, 390]]) {
      const p = await tab(who, w, 900);
      for (const [hash, sel, shareSel] of [['#/', '.bp-mix__key li', ':scope > span:last-child'], ['#/financials', '.bp-mixtable tbody tr', 'td.num small']]) {
        await open(p, hash);
        await p.waitForSelector(sel, { timeout: 10000 }).catch(() => {});
        await sleep(600);
        const rows = await p.evaluate((s, ss) => [...document.querySelectorAll(s)].map((li) => ({ name: (li.querySelector('.bp-mixtable__name') || li).textContent.replace(/\$[\d.,]+[KMB]?.*$/, '').trim(), share: (li.querySelector(ss) || {}).textContent || '' })), sel, shareSel);
        const pcts = rows.map((r) => Number((r.share.match(/(\d+)%/) || [])[1]));
        const sum = pcts.reduce((t, n) => t + n, 0);
        ok(rows.length === 5 && sum === 100 && rows.some((r) => /^Grants/.test(r.name) && r.share === '6%'), `${w} ${hash}: the shares add up to 100% (${rows.map((r) => `${r.name} ${r.share}`).join(', ')} = ${sum}%)`);
        if (hash === '#/') await shot(p, `r8-shares-${w}`);
      }
      await close(p);
    }
  });

  // ─── m7 ───
  await step('m7: the cash’s accounts, rounded, add up to the cash beside them', async () => {
    const p = await tab(FOUNDER, 1280, 720);
    await within(20000, p.goto(`${SITE}/admin/board/?present&at=${encodeURIComponent(FIN.id)}#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
    await p.waitForFunction(() => [...document.querySelectorAll('.bs-figs li')].some((li) => /Cash in the bank/.test(li.textContent)), { timeout: 15000 }).catch(() => {});
    await sleep(800);
    const t = await p.evaluate(() => { const li = [...document.querySelectorAll('.bs-figs li')].find((x) => /Cash in the bank/.test(x.textContent)); return li ? { value: li.querySelector('.bs-figs__value')?.textContent || '', sub: li.querySelector('.bs-figs__sub')?.textContent || '' } : null; });
    const total = Number(String(t?.value || '').replace(/[^\d]/g, ''));
    const parts = [...String(t?.sub || '').matchAll(/\$(\d+(?:\.\d+)?)K/g)].map((m) => Number(m[1]) * 1000);
    ok(parts.length === 2 && parts.reduce((a, b) => a + b, 0) === Math.round(total / 1000) * 1000, `the screen’s cash: ${t?.value} = ${t?.sub} (${parts.join(' + ')} = ${parts.reduce((a, b) => a + b, 0)})`);
    await close(p);
  });

  // ─── M1 ───
  await step('M1: every money statement slide fits a phone: every column on the screen, nothing cut, no sideways scroll', async () => {
    const SIZES = ['320x568', '360x740', '375x667', '390x844', '414x896', '768x1024', '1024x768'];
    // (titles as slideNow reads them, their first 24 letters)
    const STATEMENTS = /^(Statement of activities|Budget against actual|Statement of financial)/;
    const TITLE = { 'books:budget': /^Budget against actual/, 'books:pos': /^Statement of financial/, 'books:act': /^Statement of activities/, 'books:year': new RegExp(`^${Y0} against`), 'books:store': /^The store/ };
    // The presenter, stepping on from the money item through QuickBooks' slides
    await setLive(null);
    for (const size of SIZES) {
      const [w, h] = dims(size);
      const p = await tab(FOUNDER, w, h);
      await within(20000, p.goto(`${SITE}/admin/board/?present&at=${encodeURIComponent(FIN.id)}#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
      await sleep(1500);
      const seen = [];
      for (let i = 0; i < 9; i++) {
        await p.keyboard.press('ArrowRight');
        await sleep(900);
        const s = await slideNow(p);
        if (!s) { if (seen.length) break; continue; }
        if (seen.some((x) => x.title === s.title)) continue;
        seen.push(s);
        ok(slideOk(s) && (!STATEMENTS.test(s.title) || (s.cols === 4 && s.font >= 10)), `presenting, ${size}: ${slideSaid(s)}`);
        if (/Budget against actual/.test(s.title) && [320, 390].includes(w)) await shot(p, `M1-present-budget-${size}`);
      }
      ok(seen.filter((x) => STATEMENTS.test(x.title)).length === 3, `presenting, ${size}: the three statements shown (${seen.map((x) => x.title).join(' · ')})`);
      await close(p);
    }
    // A member following the meeting live while each of QuickBooks' slides is up
    for (const size of SIZES) {
      const [w, h] = dims(size);
      const p = await tab(MARIA, w, h);
      for (const fileId of ['books:budget', 'books:pos', 'books:act', 'books:year', 'books:store']) {
        await setLive(fileId);
        // (a page of its own each time: the same address again would only be its hash)
        await within(10000, p.goto('about:blank'));
        await within(20000, p.goto(`${SITE}/admin/board/#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
        await p.waitForFunction((src) => [...document.querySelectorAll('.by-slide__title')].some((e) => e.getClientRects().length && new RegExp(src).test(e.textContent.trim())), { timeout: 15000 }, TITLE[fileId].source).catch(() => {});
        await sleep(1200);
        const s = await slideNow(p);
        ok(slideOk(s) && TITLE[fileId].test(s.title) && (!/budget|pos|act/.test(fileId.slice(6)) || (s.cols === 4 && s.font >= 10)), `following live, ${size}, ${fileId}: ${slideSaid(s)}`);
        if (fileId === 'books:budget' && [320, 390].includes(w)) await shot(p, `M1-follow-budget-${size}`);
        // (and it can't be pushed sideways)
        const moved = await p.evaluate(() => { const st = document.querySelector('.bs-stage'); st.scrollLeft = 200; window.scrollTo(200, window.scrollY); const r = [st.scrollLeft, window.scrollX]; st.scrollLeft = 0; window.scrollTo(0, 0); return r; });
        if (moved[0] || moved[1]) ok(false, `following live, ${size}, ${fileId}: it scrolls sideways (${moved.join(', ')})`);
      }
      await close(p);
    }
    await setLive(null);
  });

  // ─── m4 ───
  await step('m4: the chair’s review link, the review not on: said so for a meeting ahead after the next one too', async () => {
    for (const w of [390, 1280]) {
      const p = await tab(ALEX, w, 900);
      await open(p, `#/meetings/${LATER.id}/review`);
      const h1 = await text(p, 'main h1');
      const t = await text(p);
      ok(h1 === 'This agenda isn’t open for review' && /The chair’s review isn’t turned on yet, so Jane approves agendas for now\./.test(t), `${w}: the meeting after next says the review isn’t on (${h1} · ${t.slice(0, 160)})`);
      ok(!/isn’t on the board page|may be an old one/.test(t), `${w}: never “isn’t on the board page” for it`);
      if (w === 390) await shot(p, 'm4-later-390');
      // (the next one, on the board page, is still said to be approved)
      await open(p, `#/meetings/${NEXT.id}/review`);
      ok(/This agenda is already approved/.test(await text(p, 'main h1')), `${w}: the next meeting’s link still says it’s approved`);
      await close(p);
    }
  });

  // ─── m1 ───
  await step('m1: a reveal tag’s wording always whole, the longest that truly fits its card', async () => {
    // A sweep: one card every tenth of a pixel from 140 to 260 wide, fitted as the slide fits its own (kanban.js fitPipe)
    for (const size of ['1920x1080', '1280x720']) {
      const [w, h] = dims(size);
      const p = await tab(FOUNDER, w, h);
      await within(20000, p.goto(`${SITE}/admin/board/?present#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
      await p.waitForSelector('.bs', { timeout: 15000 });
      await sleep(800);
      await p.evaluate(async () => {
        const { fitPipe } = await import('/admin/board/kanban.js');
        const root = document.createElement('div');
        root.className = 'bs-pipe';
        root.id = 'r7-sweep';
        root.style.cssText = 'position:absolute;left:0;top:0;display:flex;flex-wrap:wrap;gap:4px;width:100%;';
        const forms = ['Reveal Dec 11 · 3:45 PM', 'Dec 11 · 3:45 PM', 'Dec 11'];
        for (let x = 1400; x <= 2600; x += 1) {
          const photo = document.createElement('span');
          photo.className = 'bs-pipe__photo';
          photo.style.cssText = `width:${x / 10}px;height:120px;flex:none;`;
          const tag = document.createElement('span');
          tag.className = 'bs-pipe__when is-set';
          tag.dataset.forms = forms.join('\n');
          tag.textContent = forms[0];
          photo.append(tag);
          root.append(photo);
        }
        document.querySelector('.bs').append(root);
        fitPipe(root);
      });
      const r = await tagsNow(p, '#r7-sweep');
      ok(r.n === 1201 && !r.cut.length, `${size}: ${r.n} cards a tenth of a pixel apart, no tag cut (${r.cut.length} cut${r.cut.length ? `: ${r.cut.slice(0, 3).join('; ')}` : ''})`);
      ok(r.n === 1201 && !r.short.length, `${size}: each the longest wording that fits (${r.short.length} shorter than they had to be${r.short.length ? `: ${r.short.slice(0, 3).join('; ')}` : ''})`);
      await close(p);
    }
    // The slide itself: fourteen families with photos
    await setPipe(many(14));
    for (const size of ['1920x1080', '1440x900', '1280x720', '960x540', '390x844']) {
      const [w, h] = dims(size);
      const p = await tab(FOUNDER, w, h);
      await within(20000, p.goto(`${SITE}/admin/board/?present&at=${encodeURIComponent(MAKEOVERS.id)}#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' }));
      await p.waitForFunction(() => [...document.querySelectorAll('.bs-pipe .bs-pipe__card')].some((e) => e.getClientRects().length), { timeout: 20000 }).catch(() => {});
      await sleep(1800);
      const r = await tagsNow(p);
      ok(r.n >= 3 && !r.cut.length && !r.short.length, `the slide, ${size}: ${r.n} tags, none cut, each the longest that fits${r.cut.length ? ` (cut: ${r.cut.slice(0, 3).join('; ')})` : ''}${r.short.length ? ` (short: ${r.short.slice(0, 3).join('; ')})` : ''}`);
      if (size === '1920x1080') await shot(p, 'm1-tags-1920x1080');
      await close(p);
    }
    await mapKids();
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
console.log('\nAll round 7 member checks passed. Screenshots in test-results/board-round7-member/');
process.exit(0);
