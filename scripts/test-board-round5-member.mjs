/**
 * test-board-round5-member.mjs: the board page as members see it, as QA round 5 found it (Nov 21 2026)
 * =====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-family-map.mjs
 * does; JobTread (its jobs and a family's files), Google and Resend are faked, the map's tiles a gray square, and no
 * browser makes the signed minutes' copy (as on a server without Browser Rendering). Made-up people only.
 *   m3  Present the next meeting, the makeovers slide (Approval and Mobilization empty, Build with Maya): every stage's
 *       name inside its own column and clear of the next, at 960×540 to 2560×1440
 *   m4  The secretary signs approved minutes from For you on her phone: the Sign the minutes box goes at once, who
 *       signed is said with the copy being made on its own, the focus goes there; For you and the meeting stop asking,
 *       after the page's two reloads and Home too
 *   m5  The chair's review link says the true reason: already approved (who, when, and the meeting; one further off on
 *       the board page approved too), held, not on the board page; and to a member who isn't the chair, that it's the
 *       chair's. Board's admins still have the review itself (more than two weeks off, not written yet and not on yet:
 *       tests/board-round5-member.test.mjs)
 *   m6  A family's score: what each number means on the page, a keyboard's Enter and a phone's tap away, never only a
 *       hover; no "Hover a score" line
 *   m7  Search finds a family who applied by name ("Iris", "Jay Example", "Omar Example", and Maya by her family's
 *       name), to their page, at 390 and 1280; and finds none when the families route refuses
 *   m8  The Makeovers map with a family open: their name an h2 under the page's h1, headings in order (axe), and still
 *       an h3 in Home's Makeovers card
 *   m9  The phone map (320, 390): the key says Approved as the line and the track over it do, never "Building 1"
 * Screenshots land in test-results/board-round5-member/. Exits non-zero on any failure.
 *
 *   PORT=4621 node scripts/test-board-round5-member.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, extname } from 'node:path';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { agendaApproved } from '../tests/lib/agenda-approved.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, patchMeeting, provideBoardFinance, ensureSchema } from '../functions/api/_board.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { saveScorecard } from '../functions/api/_applicant-scores.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting } from '../public/admin/board-shared.js';
import { criteriaOf, rubricOfSeason } from '../public/admin/scoring-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round5-member/');
mkdirSync(OUT, { recursive: true });
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
// The season the families applied for, and last season's (Maya's, being built)
const YEAR = Number(day(0).slice(0, 4)) + 1;

const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const MARIA = 'maria.board@example.com';
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
// Two kid pages (Maya being built, Leo in design) and their reveals
for (const [slug, name] of [['maya-2026', 'Maya'], ['leo-2026', 'Leo']]) await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, YEAR - 1, JSON.stringify({ name, year: YEAR - 1 })).run();
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: [
  { slug: 'maya-2026', name: 'Maya', confirmed: true, date: day(9), time: '10:00', kidUrl: '/kids/maya-2026/' },
  { slug: 'leo-2026', name: 'Leo', confirmed: false, window: { part: 'mid', month: `${Number(day(0).slice(0, 4))}-12`, label: 'mid December', through: day(60) }, kidUrl: '/kids/leo-2026/' },
] })).run();
// The families who applied (made-up), this season's four and last season's Maya (her makeover in JobTread), and scorecards
const F = (name, status, season, lat, lng, more = {}) => ({ name, status, season, lat, lng, area: 'inside', miles: 0, city: 'Roswell', county: 'Fulton', types: ['Therapy Room'], fields: { diagnosis: 'An example diagnosis', birthday: '2017-05-01', mobile: 'No', verbal: 'Yes', language: 'English' }, ...more });
const FAMILIES = {
  acctIris01: F('Iris Example', 'Approved', YEAR, 34.02, -84.36, { types: ['Therapy Room', 'Bathroom'] }),
  acctJay001: F('Jay Example-Montgomery-Whitfield de la Cruz', 'In Review', YEAR, 33.93, -84.51, { city: 'Marietta', county: 'Cobb', types: ['Bathroom', 'Bedroom', 'Therapy Room', 'Ramp'] }),
  acctMia001: F('Mia Example', 'Applied', YEAR, 34.07, -84.17, { city: 'Johns Creek', types: ['Bedroom'] }),
  acctOmar01: F('Omar Example', 'Denied', YEAR, 33.45, -82.03, { area: 'outside', miles: 96.7, city: 'Augusta', county: 'Richmond', types: ['Ramp'], fields: { denialReason: 'Outside the service area (an example)' } }),
  acctMaya01: F('Maya Example', 'Approved', YEAR - 1, 34.05, -84.3, { jobId: 'j1', city: 'Alpharetta', types: ['Bedroom'] }),
};
for (const [id, f] of Object.entries(FAMILIES)) {
  await DB.prepare(`INSERT INTO applicants (account_id, name, status, year, types, fields, address, city, county, lat, lng, area, area_miles, contact_name, contact_email, contact_phone, contacts, photo_url, created_at, synced_at, job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, f.name, f.status, String(f.season), JSON.stringify(f.types), JSON.stringify(f.fields), '12 Elm St, Roswell, GA 30075', f.city, f.county, f.lat, f.lng, f.area, f.miles, 'Parent Example', 'parent@example.com', '4045550100', '[]', null, `${day(-9)}T14:00:00Z`, new Date().toISOString(), f.jobId || null).run();
}
const CRIT = criteriaOf(rubricOfSeason(String(YEAR)));
const card = (n) => Object.fromEntries(CRIT.filter((c) => !c.after).map((c, i) => [c.key, typeof n === 'function' ? n(i) : n]));
await saveScorecard(DB, 'acctIris01', { evaluator: 'lin.smith@soardcharity.com', name: 'Lin Smith', scores: card(3) });
await saveScorecard(DB, 'acctIris01', { evaluator: 'pat@soardcharity.com', name: 'Pat Lee', scores: card((i) => (i % 2 ? 2 : 5)) });

// ── The outside world, faked ──
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const GRAY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPw8PAAAAMkAVHY5VgwAAAAAElFTkSuQmCC', 'base64');
const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', JOBTREAD_GRANT_KEY: 'jt-test' };
const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
// Awaiting funding one, Design two (Leo, and one not named yet), Approval and Mobilization none, Build Maya
const JOBS = [JOB('j1', `Maya (${YEAR - 1})`, 'Build'), JOB('j2', `Leo (${YEAR - 1})`, 'Design'), JOB('j3', `Someone Else (${YEAR - 1})`, 'Awaiting Funding'), JOB('j4', `Not Published Yet (${YEAR - 1})`, 'Design')];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (/googleapis\.com\//.test(url)) return Response.json({ items: [], members: [], messages: [], files: [], conferenceRecords: [] });
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
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 15)).toISOString().slice(0, 7), income: 80000, makeovers: 40000, store: 12000, operating: 18000, storeSales: 25000, net: 10000 })),
  ytd: { year: 2026, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 },
  lastYtd: { year: 2025, through: day(-365), income: 800000, makeovers: 480000, store: 140000, operating: 200000, net: -20000 },
  cash: { today: 375000, lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000, belowFloor: false },
  perMakeover: { count: 12, average: 21000 },
}));

// ── The meetings ──
const board = (status = '') => (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board', status });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
  { title: 'Programs', items: [{ title: 'Makeovers in progress', live: 'projects' }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
const share = (m) => patchMeeting(DB, m.id, (cur) => ({ ...cur, shared: true }));
// Next: in 9 days, its agenda approved (Alex), on the board page
const NEXT = await share(await make(day(9)));
await agendaApproved(DB, NEXT.id, 'Alex Rivera');
// One further off, on the board page
const FAR = await share(await make(day(40)));
// Held 40 days ago, its minutes approved today (the secretary is asked to sign them); one held long ago
const SIGN = await share(await make(day(-40), { attendance: BOARD.map(board('present')), title: 'Q3 Example Board Meeting', sections: [{ title: 'Call to order', items: [{ title: 'Roll call', notes: 'Everyone there' }] }] }));
await patchMeeting(DB, SIGN.id, (cur) => ({ ...cur, minutes: 'approved', approvedOn: day(0), minutesFrom: { typed: true, name: '', at: new Date().toISOString() } }));
const OLD = await share(await make(day(-100), { attendance: BOARD.map(board('present')) }));
await patchMeeting(DB, OLD.id, (cur) => ({ ...cur, minutes: 'approved', approvedOn: day(-70) }));

// ── The server ──
const ROUTES = { '/api/board-admin': boardAdmin, '/api/board-portal': boardPortal, '/api/board-file': boardFile };
const csp = (() => {
  const lines = readFileSync(join(ROOT, 'public/_headers'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === '/admin/*');
  return lines.slice(at + 1).find((l) => /^\s+Content-Security-Policy:/.test(l)).split('Content-Security-Policy:')[1].trim();
})();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
// (a port of its own, 4621 to 4623, or any free one with PORT=0)
const PORT = Number(process.env.PORT ?? 4621);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── The browser ──
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 400000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const errs = [];
/** A tab as `email`, at `width`; the map's tiles a gray square; `refuse`: a route the page asks that answers 403 */
async function tab(email, width = 1280, height = 900, { refuse = null } = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const phone = width < 600;
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await page.setExtraHTTPHeaders({ 'x-test-user': email });
  page.on('pageerror', (e) => errs.push(`${email} ${width}: PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|x-test-user|403/.test(m.text())) errs.push(`${email} ${width}: ${m.text().slice(0, 300)}`); });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/tile\.openstreetmap\.org/.test(r.url())) return r.respond({ status: 200, contentType: 'image/png', body: GRAY, headers: { 'Access-Control-Allow-Origin': '*' } });
    if (refuse && refuse.test(r.url())) return r.respond({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Not for you' }) });
    return r.continue();
  });
  return page;
}
async function open(page, hash = '#/', query = '') {
  await page.goto(`${SITE}/admin/board/${query}${hash}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('.bp-boot'), { timeout: 30000 }).catch(() => {});
  await sleep(900);
}
async function go(page, hash) { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(1300); }
// (ONLY=m3,m7 runs those steps alone)
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
async function step(name, fn) {
  if (ONLY && !ONLY.has(name.split(':')[0])) return;
  console.log(`\n${name}`);
  try { await fn(); } catch (err) {
    const why = String(err?.message || err).split('\n')[0];
    failures.push(`${name}: a step stopped: ${why}`);
    console.log(`  ✗ a step stopped: ${why}`);
  }
}
const text = (page, sel = 'main') => page.evaluate((s) => (document.querySelector(s)?.innerText || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(), sel);
const shot = async (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const waitText = (page, re, ms = 8000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText.replace(/ /g, ' ')), { timeout: ms }, re.source).then(() => true, () => false);

try {
  // ─── m3 ───
  await step('m3: the makeovers slide: every stage’s name inside its own column, none touching the next', async () => {
    for (const size of ['960x540', '1024x768', '1280x720', '1366x768', '1440x900', '1920x1080', '2560x1440']) {
      const [w, h] = size.split('x').map(Number);
      const p = await tab(FOUNDER, w, h);
      await p.goto(`${SITE}/admin/board/?present#/meetings/${NEXT.id}/screen`, { waitUntil: 'networkidle0' });
      await sleep(1500);
      for (let i = 0; i < 25; i++) {
        if (await p.evaluate(() => (document.querySelector('.bs-pipe__track')?.getBoundingClientRect().width || 0) > 0)) break;
        await p.keyboard.press('ArrowRight');
        await sleep(600);
      }
      await sleep(900);
      const labels = await p.evaluate(() => {
        const lis = [...document.querySelectorAll('.bs-pipe__track > li')];
        const box = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
        return lis.map((li, i) => {
          const lab = li.querySelector('.bs-pipe__stage, .bs-pipe__end');
          const next = lis[i + 1]?.querySelector('.bs-pipe__stage, .bs-pipe__end');
          const t = box(lab);
          return { label: lab.textContent, left: t.left, right: t.right, liLeft: li.getBoundingClientRect().left, liRight: li.getBoundingClientRect().right, gap: next ? box(next).left - t.right : null };
        });
      });
      const stages = labels.map((x) => x.label).join(' ');
      ok(/Approval/.test(stages) && /Mobilization/.test(stages) && /Build/.test(stages), `${size}: the track has the stages (${stages})`);
      const outside = labels.filter((x) => x.right > x.liRight + 0.5 || x.left < x.liLeft - 0.5);
      ok(!outside.length, `${size}: every name inside its own column${outside.length ? ` (${outside.map((x) => `${x.label} ${Math.round(x.right - x.liRight)}px past`).join(', ')})` : ''}`);
      const touching = labels.filter((x) => x.gap !== null && x.gap < 8);
      ok(!touching.length, `${size}: no two names within 8px${touching.length ? ` (${touching.map((x) => `${x.label} ${Math.round(x.gap)}px from the next`).join(', ')})` : ''}`);
      // (the room the names take never cuts a card's reveal tag short: it says it short instead)
      const tags = await p.evaluate(() => [...document.querySelectorAll('.bs-pipe__when')].map((e) => ({ t: e.textContent, cut: e.scrollWidth > e.clientWidth + 1 })));
      ok(tags.length >= 2 && !tags.some((x) => x.cut), `${size}: no reveal tag cut short (${tags.map((x) => `${x.t}${x.cut ? ' CUT' : ''}`).join(', ')})`);
      if (size === '1440x900') await shot(p, 'm3-pipe-1440x900');
      await p.close();
    }
  });

  // ─── m4 ───
  await step('m4: the secretary signs approved minutes on her phone: asked no more, the focus on who signed', async () => {
    const p = await tab(TAYLOR, 390, 800);
    await open(p, '#/');
    const todo = `a.bp-todo[href="#/meetings/${SIGN.id}"]`;
    ok(!!(await p.$(todo)), 'For you asks her to sign');
    await p.click(todo);
    await p.waitForSelector(`#sign-minutes-${SIGN.id}`, { timeout: 8000 });
    await p.click(`#sign-minutes-${SIGN.id} .bp-minutes__open`);
    await p.waitForSelector('dialog.bp-adopt[open] #bp-adopt-name', { timeout: 5000 });
    await p.$eval('#bp-adopt-name', (i) => { i.value = ''; });
    await p.type('#bp-adopt-name', 'Taylor Nguyen');
    await p.click('.bp-adopt button[type="submit"]');
    await p.waitForFunction(() => !document.querySelector('dialog.bp-adopt[open]'), { timeout: 5000 });
    await p.click(`#sign-minutes-${SIGN.id} .bp-sign__agree input`);
    await p.click(`#sign-minutes-${SIGN.id} .bp-minutes__open`);
    ok(await waitText(p, /Signed\. Thank you\./, 8000), 'signed');
    await sleep(1200);
    const now = await p.evaluate((id) => ({ box: !!document.getElementById(`sign-minutes-${id}`), said: document.querySelector('.mfix-signed')?.innerText.replace(/ /g, ' ') || '', focus: document.activeElement?.className || document.activeElement?.tagName, inside: !!document.activeElement?.closest('.mfix-signed') || document.activeElement?.classList.contains('mfix-signed') }), SIGN.id);
    ok(!now.box, 'the Sign the minutes box goes at once');
    ok(/^Signed by Taylor Nguyen, [A-Z][a-z]{2} \d+\. The signed copy is being made\.$/.test(now.said), `who signed, and the copy being made said on its own (${now.said})`);
    ok(now.inside, `the focus goes to the words that say it’s signed (${now.focus})`);
    await shot(p, 'm4-signed-390');
    // (the page's reloads at 6 and 16 seconds: still no copy here, still not asked)
    await sleep(17000);
    ok(!(await p.$(`#sign-minutes-${SIGN.id}`)), 'after the page’s two reloads, still not asked');
    await go(p, '#/');
    await sleep(800);
    const forYou = await p.evaluate(() => [...document.querySelectorAll('.bp-todo')].map((a) => a.innerText.replace(/\s+/g, ' ')));
    ok(!forYou.some((t) => /Sign the minutes/.test(t)), `For you asks no more (${JSON.stringify(forYou)})`);
    await p.close();
    const q = await tab(TAYLOR, 1280, 900);
    await open(q, `#/meetings/${SIGN.id}`);
    ok(!(await q.$(`#sign-minutes-${SIGN.id}`)), 'a fresh visit to the meeting: not asked');
    ok(/Signed by Taylor Nguyen/.test(await text(q)), 'and who signed is there');
    await go(q, '#/');
    ok(!/Sign the minutes/.test(await text(q)), 'nor on Home');
    await q.close();
  });

  // ─── m5 ───
  await step('m5: the chair’s review link says the true reason, case by case', async () => {
    for (const w of [390, 1280]) {
      const p = await tab(ALEX, w, 900);
      await open(p, `#/meetings/${NEXT.id}/review`);
      const t = await text(p);
      const h1 = await text(p, 'main h1');
      ok(h1 === 'This agenda is already approved', `${w}: approved, said so (${h1})`);
      ok(/Alex Rivera approved it on [A-Z][a-z]{2} \d+/.test(t), `${w}: who approved it and when (${t.slice(0, 200)})`);
      ok(await p.$(`main a[href="#/meetings/${NEXT.id}"]`) !== null, `${w}: and a link to the meeting`);
      ok(!/two weeks before a meeting, once its agenda is written/.test(t), `${w}: never the old reason`);
      ok((await sideways(p)) <= 0, `${w}: no sideways scroll`);
      await shot(p, `m5-approved-${w}`);
      if (w === 390) {
        // (a meeting further off already on the board page: nothing ahead goes there before its agenda is approved)
        await go(p, `#/meetings/${FAR.id}/review`);
        const far = await text(p);
        ok(/This agenda is already approved/.test(far) && /It’s on the board page, so there’s nothing left to review\./.test(far), `further off, on the board page: approved, said so (${far.slice(0, 200)})`);
        await go(p, `#/meetings/${OLD.id}/review`);
        ok(/This meeting has been held/.test(await text(p)), `held: said so (${(await text(p)).slice(0, 120)})`);
        await go(p, '#/meetings/m_nope1234/review');
        ok(/This meeting isn’t on the board page/.test(await text(p)), `not on the board page: said so (${(await text(p)).slice(0, 120)})`);
      }
      await p.close();
    }
    const sam = await tab(SAM, 390, 800);
    await open(sam, `#/meetings/${NEXT.id}/review`);
    const st = await text(sam);
    ok(/This is the chair’s review/.test(st) && /Only the board’s chair reviews an agenda/.test(st), `not the chair: said so (${st.slice(0, 160)})`);
    await shot(sam, 'm5-not-chair-390');
    await sam.close();
    const jane = await tab(FOUNDER, 1280, 900);
    await open(jane, `#/meetings/${NEXT.id}/review`);
    await jane.waitForSelector('.cr-head', { timeout: 8000 }).catch(() => {});
    const jh = await text(jane, 'main h1');
    ok(!!(await jane.$('.cr-head .cr-head__act')) && !/already approved/.test(jh), `Board’s admins still have the review itself (${jh})`);
    // (on the board page and approved: shown as over, who approved it, with no Approve to press. QA round 7, Nov 21 2026)
    const act = await text(jane, '.cr-head .cr-head__act');
    ok(/^Approved by Alex/.test(act) && !(await jane.$('.cr-head .cr-approve')), `shown as approved, nothing to approve (${act})`);
    await jane.close();
  });

  // ─── m6 ───
  await step('m6: a family’s score: what each number means, reached by a keyboard and a phone, never only a hover', async () => {
    const p = await tab(MARIA, 390, 800);
    await open(p, '#/families/acctIris01');
    await p.waitForSelector('.bf-cards', { timeout: 10000 });
    const t = await text(p);
    ok(!/Hover a score/.test(t), 'no “Hover a score” line');
    const n = await p.$$eval('.bf-mean > summary', (s) => s.length);
    ok(n === CRIT.length, `a meaning for every criterion (${n} of ${CRIT.length})`);
    // The keyboard: Tab from the table reaches the first, and Enter opens it
    await p.$eval('#bf-score-h', (h) => { h.tabIndex = -1; h.focus(); });
    let reached = '';
    for (let i = 0; i < 40 && !reached; i++) {
      await p.keyboard.press('Tab');
      reached = await p.evaluate(() => (document.activeElement?.matches('.bf-mean > summary') ? document.activeElement.textContent : ''));
    }
    ok(reached === CRIT[0].label, `Tab reaches the first criterion’s meanings (${reached || 'never'})`);
    await p.keyboard.press('Enter');
    await sleep(300);
    const first = await p.$eval('.bf-mean:nth-of-type(1)', (d) => ({ open: d.open, said: d.innerText.replace(/\s+/g, ' '), tall: d.querySelector('ol').getBoundingClientRect().height }));
    ok(first.open && first.tall > 40, 'Enter opens it on the page');
    ok(CRIT[0].levels.every((l, i) => first.said.includes(`${i + 1} ${l}`)), `its five, 1 first, in the rubric’s words (${first.said.slice(0, 160)})`);
    // A phone's tap
    await p.$eval('.bf-mean:nth-of-type(2) > summary', (s) => s.scrollIntoView({ block: 'center' }));
    await p.tap('.bf-mean:nth-of-type(2) > summary');
    await sleep(300);
    const second = await p.$eval('.bf-mean:nth-of-type(2)', (d) => ({ open: d.open, said: d.innerText.replace(/\s+/g, ' ') }));
    ok(second.open && CRIT[1].levels.every((l) => second.said.includes(l)), `a tap opens the next (${CRIT[1].label})`);
    ok((await sideways(p)) <= 0, 'no sideways scroll at 390');
    await p.$eval('.bf-means', (e) => e.scrollIntoView({ block: 'start' }));
    await shot(p, 'm6-meanings-390');
    await p.close();
  });

  // ─── m7 ───
  await step('m7: search finds a family who applied by name, to their page; nobody the route refuses', async () => {
    const search = async (p, q) => {
      if (!(await p.$('dialog.bp-finder[open]'))) { await p.click('button.bp-find'); await p.waitForSelector('dialog.bp-finder[open] input', { timeout: 5000 }); }
      await p.$eval('dialog.bp-finder input', (i) => { i.focus(); i.select(); });
      await p.keyboard.press('Backspace');
      await p.keyboard.type(q, { delay: 20 });
      await p.waitForFunction(() => document.querySelector('.bp-finder [role=option]') || /Nothing found/.test(document.querySelector('.bp-finder__none')?.textContent || ''), { timeout: 10000 }).catch(() => {});
      await sleep(700);
      return p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=option]')].map((x) => ({ title: x.querySelector('.bp-finder__title')?.innerText || '', group: x.closest('[role=group]')?.querySelector('.bp-finder__group')?.innerText || '' })));
    };
    for (const [who, w] of [[MARIA, 390], [SAM, 1280]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(1500);
      for (const [q, name] of [['Iris', 'Iris Example'], ['Jay Example', 'Jay Example-Montgomery-Whitfield de la Cruz'], ['Omar Example', 'Omar Example'], ['Maya', 'Maya Example']]) {
        const found = await search(p, q);
        const hit = found.find((x) => x.title === name);
        ok(hit && /^makeovers/i.test(hit.group), `${w}: “${q}” finds ${name} under Makeovers (${JSON.stringify(found.slice(0, 4))})`);
        if (q === 'Iris' && w === 390) await shot(p, 'm7-iris-390');
      }
      // …and it opens their page
      await search(p, 'Iris');
      await p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=option]')].find((x) => x.querySelector('.bp-finder__title')?.innerText === 'Iris Example')?.click());
      await p.waitForFunction(() => location.hash === '#/families/acctIris01', { timeout: 5000 }).catch(() => {});
      await sleep(1500);
      ok((await p.evaluate(() => location.hash)) === '#/families/acctIris01' && (await text(p, 'main h1')) === 'Iris Example', `${w}: and opens their page`);
      await p.close();
    }
    const shut = await tab(MARIA, 1280, 900, { refuse: /\/api\/board-portal\?families/ });
    await open(shut, '#/');
    await sleep(1500);
    const found = await search(shut, 'Iris');
    ok(!found.some((x) => x.title === 'Iris Example'), `the families route refused: nobody found (${JSON.stringify(found)})`);
    await shut.close();
  });

  // ─── m8 ───
  const headings = (p) => p.evaluate(() => [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')].filter((h) => h.getClientRects().length).map((h) => ({ n: Number(h.tagName[1]), t: h.innerText.replace(/\s+/g, ' ').slice(0, 40) })));
  const headingOrder = async (p) => { await p.evaluate(AXE); return p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['heading-order'] }, resultTypes: ['violations'] })).violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`)); };
  await step('m8: the Makeovers map with a family open: their name an h2 under the h1, headings in order', async () => {
    for (const [w, id, name] of [[1280, 'acctIris01', 'Iris Example'], [390, 'acctJay001', 'Jay Example-Montgomery-Whitfield de la Cruz']]) {
      const p = await tab(MARIA, w, 900);
      await open(p, `#/families/map/${id}`);
      await p.waitForSelector('.fm-card__name', { timeout: 10000 });
      await sleep(800);
      const hs = await headings(p);
      const skips = hs.filter((h, i) => i && h.n > hs[i - 1].n + 1);
      ok(hs[0]?.n === 1 && hs[1]?.n === 2 && hs[1]?.t === name.slice(0, 40), `${w}: the h1, then their name as an h2 (${JSON.stringify(hs.slice(0, 3))})`);
      ok(!skips.length, `${w}: no heading skips a level (${JSON.stringify(skips)})`);
      const axe = await headingOrder(p);
      ok(!axe.length, `${w}: axe heading-order${axe.length ? `: ${axe.join('; ')}` : ''}`);
      await p.close();
    }
    // Home's Makeovers card (an h2): an open family's name stays an h3 under it
    const h = await tab(MARIA, 1280, 900);
    await open(h, '#/');
    await h.waitForSelector('#makeovers .lc-views', { timeout: 10000 });
    await h.evaluate(() => [...document.querySelectorAll('#makeovers .lc-views button, #makeovers .lc-views a')].find((b) => b.textContent.trim() === 'Map')?.click());
    await h.waitForSelector('#makeovers .fm-row', { timeout: 10000 });
    await h.click('#makeovers .fm-row');
    await h.waitForSelector('#makeovers .fm-card__name', { timeout: 5000 });
    ok((await h.$eval('#makeovers .fm-card__name', (e) => e.tagName)) === 'H3', 'Home’s card: their name an h3 under the card’s h2');
    const axe = await headingOrder(h);
    ok(!axe.length, `Home: axe heading-order${axe.length ? `: ${axe.join('; ')}` : ''}`);
    await h.close();
  });

  // ─── m9 ───
  await step('m9: the phone map: its key says Approved as the line and the track over it do', async () => {
    for (const w of [320, 390, 1280]) {
      const p = await tab(MARIA, w, 900);
      await open(p, '#/families/map/acctIris01');
      await p.waitForSelector('.apl-legend', { timeout: 10000 });
      await sleep(600);
      const sum = await text(p, '.bf-sum');
      const legend = await text(p, '.apl-legend');
      ok(/1 approved/.test(sum), `${w}: the line says 1 approved (${sum})`);
      ok(/Approved\s*1/.test(legend) && !/Building/.test(legend), `${w}: the key says Approved 1, never Building (${legend})`);
      if (w < 600) {
        const track = await text(p, '.lc-phase.is-building');
        ok(/^0\s*BUILDING/i.test(track) && /1 approved/.test(track), `${w}: the track: 0 Building, 1 approved (${track})`);
        await p.$eval('.lc-track', (e) => e.scrollIntoView({ block: 'start' }));
        await shot(p, `m9-map-${w}`);
      }
      await p.close();
    }
  });

  ok(!errs.length, `no console errors${errs.length ? `: ${errs.slice(0, 4).join(' | ')}` : ''}`);
} catch (err) {
  failures.push(`crashed: ${err.stack || err}`);
  console.error(err);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('\nAll round 5 member checks passed. Screenshots in test-results/board-round5-member/');
process.exit(0);
