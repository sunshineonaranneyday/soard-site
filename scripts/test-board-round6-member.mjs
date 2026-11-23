/**
 * test-board-round6-member.mjs: the board page as members see it, as QA round 6 found it (Nov 21 2026)
 * =====================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round5-member.mjs
 * does; JobTread (its jobs), Google, Resend and Workers AI's file reader are faked, the photos and the map's tiles a
 * square of gray. Made-up people only.
 *   b1  The presenting screen never freezes on the makeovers slide (the blocker: a phone or tablet froze there once six
 *       or more families were in progress): 6, 14 and 30 families, with photos and with initials, at 390×844, 414×896,
 *       768×1024, 800×600, 1024×768, 1280×720 and 1920×1080, opened on the slide and stepped onto it with →, and a
 *       member's phone following the meeting live there: the slide drawn, answering within 2 s, and no layout of it
 *       taking more than 50 ms. The reveals slide after it the same
 *   m1  The chair's review link while the review isn't on for the chair: it says so, whatever the date or the agenda's
 *       state (30 days off, 14, a draft at 9), never a day it opens or "once SOARD has written it"
 *   m2  Notes that come down to one long sentence: as many whole lines as the slide has room for, then "The rest is on
 *       the board page.", never a fixed 3 (Questions from the board, and the money's slide)
 *   m3  Every family's name inside its own card at every size ("Montgomery", "Evangeline"), on a phone too
 *   m4  Every reveal tag says as much as its card has room for, on one row of cards or two, and is never cut short
 *   m5  The Makeovers map: its line and its key count the same families, the makeovers with no pin said beside the key
 *   m6  Search for an amount however it's written ("375,000", "$375,000.00"...): the file found, its line shown with the
 *       amount marked, and the PDF opened at it, marked
 * Screenshots land in test-results/board-round6-member/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round6-member.mjs            (ONLY=b1,m3 runs those steps alone; PORT=4682 a port of its own)
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { agendaApproved } from '../tests/lib/agenda-approved.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, patchMeeting, getMeeting, provideBoardFinance, ensureSchema, putFile } from '../functions/api/_board.js';
import { readBoardWords } from '../functions/api/_board-file-words.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting, shortDate, clock } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round6-member/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const YEAR = Number(day(0).slice(0, 4)) + 1;

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

// ── The makeovers in progress: as many families as a step asks for, with photos or initials ──
const JOB = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
let JOBS = [];
const FIRST = ['Ava', 'Montgomery', 'Benjamin', 'Evangeline', 'Christopher', 'Dahlia', 'Wilhelmina', 'Eli', 'Bartholomew', 'Francesca', 'Gabriel', 'Penelope', 'Hannah', 'Isaac', 'Jasmine', 'Kai', 'Liam', 'Maximiliana', 'Mia', 'Noah', 'Theodore', 'Anastasia', 'Oliver', 'Sophia', 'Jackson', 'Harper', 'Mateo', 'Luna', 'Zoe', 'Leo'];
const FLOW = ['Awaiting Funding', 'Design', 'Design', 'Finalization', 'Approval', 'Mobilization', 'Build', 'Build'];
const monthAhead = (k) => { const d = new Date(`${day(0)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k, 15); return d.toISOString().slice(0, 7); };
const monthName = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
let REVEALS = [];
/**
 * The families for a step: `list` [[first name, JobTread status, reveal]] where a reveal is ['set', in days, 'HH:MM'],
 * ['window', 'early'|'mid'|'late', months ahead] or null; `photos`, each kid's page has a photo
 */
async function setPipe(list, { photos = true } = {}) {
  await DB.exec('DELETE FROM kids');
  JOBS = list.map(([name, status], i) => JOB(`jq${i}`, `${name} (${YEAR - 1})`, status));
  REVEALS = [];
  for (const [name, , reveal] of list) {
    const slug = `${name.toLowerCase()}-${YEAR - 1}`;
    await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, YEAR - 1, JSON.stringify({ name, year: YEAR - 1, childCount: 1, roomCount: 1, ...(photos ? { heroImage: `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/${slug}/1/public` } : {}) })).run();
    if (reveal?.[0] === 'set') REVEALS.push({ slug, name, confirmed: true, date: day(reveal[1]), time: reveal[2], kidUrl: `/kids/${slug}/` });
    if (reveal?.[0] === 'window') { const month = monthAhead(reveal[2]); REVEALS.push({ slug, name, confirmed: false, window: { part: reveal[1], month, label: `${reveal[1]} ${monthName(month)}`, through: day(120) }, kidUrl: `/kids/${slug}/` }); }
  }
  await DB.prepare('INSERT OR REPLACE INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: REVEALS, updatedAt: new Date().toISOString() })).run();
  // (JobTread's 15-minute copy: read again)
  await DB.exec("CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)");
  await DB.prepare("DELETE FROM board_state WHERE key = 'projects'").run();
}
const REVEAL_OF = [['set', 5, '18:00'], ['window', 'mid', 1], ['set', 12, '10:30'], null, ['set', 20, '15:45'], ['window', 'late', 2], ['set', 9, '10:00'], ['window', 'early', 3]];
const many = (n) => Array.from({ length: n }, (_, i) => [FIRST[i % FIRST.length] + (i >= FIRST.length ? String.fromCharCode(65 + Math.floor(i / FIRST.length)) : ''), FLOW[i % FLOW.length], REVEAL_OF[i % REVEAL_OF.length]]);
// The tester's long names, one to a stage ("Montgomery" ran past its card at every size)
const WIDE = [['Christopher', 'Awaiting Funding', null], ['Wilhelmina', 'Design', ['window', 'late', 0]], ['Bartholomew', 'Finalization', ['set', 15, '12:45']], ['Penelope', 'Approval', ['window', 'mid', 1]], ['Montgomery', 'Mobilization', ['set', 25, '18:30']], ['Evangeline', 'Build', ['set', 6, '10:00']]];

// The families who applied (made-up), for the Makeovers map: two applying, one approved (Maya's family, her makeover
// in JobTread), and JobTread's makeovers with no application (Leo being built, one awaiting funding, one not named yet)
const F = (name, status, season, lat, lng, more = {}) => ({ name, status, season, lat, lng, area: 'inside', miles: 0, city: 'Roswell', county: 'Fulton', types: ['Therapy Room'], fields: { diagnosis: 'An example diagnosis', birthday: '2017-05-01', mobile: 'No', verbal: 'Yes', language: 'English' }, ...more });
const FAMILIES = {
  acctIris01: F('Iris Example', 'Approved', YEAR, 34.02, -84.36),
  acctJay001: F('Jay Example', 'In Review', YEAR, 33.93, -84.51, { city: 'Marietta', county: 'Cobb' }),
  acctMia001: F('Mia Example', 'Applied', YEAR, 34.07, -84.17, { city: 'Johns Creek' }),
  acctMaya01: F('Maya Example', 'Approved', YEAR - 1, 34.05, -84.3, { jobId: 'jm1', city: 'Alpharetta' }),
};
for (const [id, f] of Object.entries(FAMILIES)) {
  await DB.prepare(`INSERT INTO applicants (account_id, name, status, year, types, fields, address, city, county, lat, lng, area, area_miles, contact_name, contact_email, contact_phone, contacts, photo_url, created_at, synced_at, job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, f.name, f.status, String(f.season), JSON.stringify(f.types), JSON.stringify(f.fields), '12 Elm St, Roswell, GA 30075', f.city, f.county, f.lat, f.lng, f.area, f.miles, 'Parent Example', 'parent@example.com', '4045550100', '[]', null, `${day(-9)}T14:00:00Z`, new Date().toISOString(), f.jobId || null).run();
}
const MAP_JOBS = [JOB('jm1', `Maya (${YEAR - 1})`, 'Build'), JOB('jm2', `Leo (${YEAR - 1})`, 'Design'), JOB('jm3', `Someone Else (${YEAR - 1})`, 'Awaiting Funding'), JOB('jm4', `Not Published Yet (${YEAR - 1})`, 'Design')];

// ── The outside world, faked ──
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPw8PAAAAMkAVHY5VgwAAAAAElFTkSuQmCC', 'base64');
const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', JOBTREAD_GRANT_KEY: 'jt-test' };
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
    // (the slide's families while a step has set them, else the map's)
    return Response.json({ organization: { jobs: { nodes: JOBS.length ? JOBS : MAP_JOBS, nextPage: null } } });
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
// One very long sentence (the tester's): too tall for any slide, so only some of its lines can show
const SENTENCE = ['Revenue is running ahead of the budget by about eleven percent, mostly because the gala sold out early and two sponsors doubled their gifts this year',
  'cash over the next thirteen weeks dips to its lowest point in the second week of January, when the spring makeover deposits go out to the builders',
  'store sales are down on last year after the website move, and the team expects them to come back once the holiday collection goes live next week',
  'in kind gifts are not counted in the revenue shown here, they are about two hundred and twenty thousand dollars so far this year, mostly cabinets',
  'the reserve account stays above the floor the board set in March in every week of the forecast, even in the cautious case with late pledges',
  'we will bring the draft 2027 budget to the next meeting, with the store line held flat until the spring review as the finance committee asked',
  'two makeovers are waiting on funding, each needs about twenty one thousand dollars and the team has a foundation ask out for both of them now',
  'the audit for 2025 starts in February, and the auditors have asked for the board minutes of every meeting this year before they begin field work'].join(', and ') + '.';
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash', notes: SENTENCE }] },
  { title: 'Programs', items: [{ title: 'Makeovers in progress', live: 'projects' }, { title: 'Upcoming reveals', live: 'reveals' }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board', notes: SENTENCE }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board()), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
// The chair's review (m1): the next meeting, not on the board page yet, its date and agenda changed step by step
const REV = await make(day(30));
// Held 100 days ago, on the board page, with the statement the search finds by its amount (m6)
const OLD = await patchMeeting(DB, (await make(day(-100), { attendance: BOARD.map(board('present')) })).id, (cur) => ({ ...cur, shared: true, minutes: 'approved', approvedOn: day(-70) }));
async function pdf(title, lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText(title, { x: 72, y: 700, size: 20, font: bold });
  lines.forEach(([label, amount], i) => { const y = 640 - i * 24; page.drawText(label, { x: 72, y, size: 12, font: /^Total/.test(label) ? bold : font }); if (amount) page.drawText(amount, { x: 430, y, size: 12, font }); });
  return Buffer.from(await doc.save());
}
const statement = await pdf('Statement of Financial Position', [['Bank Accounts', ''], ['  Example Operating', '$250,000.50'], ['  Example Reserve', '$124,999.50'], ['Total for Bank Accounts', '$375,000.00']]);
await putFile(env, { ownerType: 'meeting', ownerId: OLD.id, file: new File([statement], 'Statement of Financial Position.pdf', { type: 'application/pdf' }), kind: 'financials', by: FOUNDER });
env.AI = { toMarkdown: async (doc) => ({ name: doc.name, format: 'markdown', data: '# s.pdf\n## Contents\n### Page 1\nStatement of Financial Position\nBank Accounts\nExample Operating $250,000.50\nExample Reserve $124,999.50\nTotal for Bank Accounts $375,000.00' }) };
while (await readBoardWords(env, { limit: 20, budgetMs: 60000 })) { /* each file once */ }
delete env.AI;
let NEXT = null; // the meeting presented (b1, m2, m3, m4): made once m1 is done with REV
const itemOf = (m, live) => m.sections.flatMap((s) => s.items).find((it) => it.live === live || it.title === live);

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
// (a promise given `ms` to settle: a tab that's stopped answering never holds the run up)
const within = (ms, p) => Promise.race([p, sleep(ms).then(() => { throw new Error(`no answer in ${ms / 1000} s`); })]);
// (m2: a file whose answer comes this late, then not at all: { re, ms })
let LATE = null;
/** A tab as `email` at `width`×`height`, its photos and the map's tiles a gray square */
async function tab(email, width = 1280, height = 900) {
  const page = await within(15000, browser.newPage());
  page.setDefaultTimeout(20000);
  const phone = width < 600;
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await page.setExtraHTTPHeaders({ 'x-test-user': email });
  page.on('pageerror', (e) => errs.push(`${email} ${width}: PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|x-test-user|403/.test(m.text())) errs.push(`${email} ${width}: ${m.text().slice(0, 300)}`); });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/tile\.openstreetmap\.org|imagedelivery\.net/.test(r.url())) return r.respond({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
    if (LATE && LATE.re.test(r.url())) { const late = LATE; return void sleep(late.ms).then(() => r.respond({ status: 404, contentType: 'text/plain', body: 'Not found' })).catch(() => {}); }
    return r.continue();
  });
  return page;
}
async function open(page, hash = '#/', query = '') {
  await page.goto(`${SITE}/admin/board/${query}${hash}`, { waitUntil: 'networkidle0' });
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
const SIZES = ['390x844', '414x896', '768x1024', '800x600', '1024x768', '1280x720', '1920x1080'];
const dims = (size) => size.split('x').map(Number);
/** Presenting the next meeting, opened on the stop `at` (an item's id) */
const presentAt = (page, at) => page.goto(`${SITE}/admin/board/?present&at=${encodeURIComponent(at)}#/meetings/${NEXT.id}/screen`, { waitUntil: 'domcontentloaded' });
/**
 * The slide `sel` on the screen: drawn, and the tab answering every look within 2 s from then on (three more looks over
 * the next two seconds: the names fitted, the fonts in, the meeting asked for again) → { drawn, why, ms, layout }
 */
async function answers(page, sel) {
  const t0 = Date.now();
  let drawn = false;
  while (Date.now() - t0 < 25000) {
    drawn = await within(2000, page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0), sel)).catch((e) => e);
    if (drawn instanceof Error) return { drawn: false, why: `${drawn.message} while it was coming up` };
    if (drawn) break;
    await sleep(150);
  }
  if (!drawn) return { drawn: false, why: 'never drawn in 25 s' };
  const ms = Date.now() - t0;
  for (let i = 0; i < 3; i++) {
    await sleep(600);
    const a = await within(2000, page.evaluate(() => 1)).catch((e) => e);
    if (a instanceof Error) return { drawn: true, why: `${a.message} once it was drawn`, ms };
  }
  // The slide laid out again whole, as a window's resize would (its width a pixel less, then back), and one name
  // asked whether it fits (the way the hang was found): each layout timed
  const layout = await within(4000, page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0);
    const root = el.closest('.bs-pipe, .bs-when') || el;
    const times = [];
    for (const w of ['calc(100% - 1px)', '']) { const t = performance.now(); root.style.width = w; void root.offsetHeight; times.push(performance.now() - t); }
    const name = root.querySelector('.bs-pipe__name, .bs-when__name');
    if (name) { const t = performance.now(); name.toggleAttribute('data-whole'); void name.scrollHeight; times.push(performance.now() - t); name.toggleAttribute('data-whole'); }
    return Math.round(Math.max(...times) * 10) / 10;
  }, sel)).catch((e) => e);
  if (layout instanceof Error) return { drawn: true, why: `${layout.message} laying it out`, ms };
  return { drawn: true, why: '', ms, layout };
}

try {
  // ─── m1 (first: the review's meeting is the next one while it runs) ───
  await step('m1: the chair’s review not on: the link says so, whatever the date or the agenda’s state', async () => {
    const cases = [
      ['30 days off, written', day(30), typed],
      ['14 days off, written', day(14), typed],
      ['9 days off, a draft', day(9), { kind: 'template' }],
      ['30 days off, a draft', day(30), { kind: 'template' }],
    ];
    for (const [what, date, agendaFrom] of cases) {
      await patchMeeting(DB, REV.id, (cur) => ({ ...cur, date, agendaFrom }));
      for (const w of [390, 1280]) {
        const p = await tab(ALEX, w, 900);
        await open(p, `#/meetings/${REV.id}/review`);
        const h1 = await text(p, 'main h1');
        const t = await text(p);
        ok(h1 === 'This agenda isn’t open for review' && /The chair’s review isn’t turned on yet, so Jane approves agendas for now\./.test(t), `${what}, ${w}: says the review isn’t on (${h1} · ${t.slice(0, 160)})`);
        ok(!/opens [A-Z][a-z]+day|once SOARD has written it|once its agenda is written/.test(t), `${what}, ${w}: never a day it opens or “once it’s written”`);
        if (w === 390 && what.startsWith('9')) await shot(p, 'm1-draft-off-390');
        if (w === 1280 && what.startsWith('30 days off, written')) await shot(p, 'm1-early-off-1280');
        await close(p);
      }
    }
    // Board's admins review whether it's on or not: they're still told the day it opens
    await patchMeeting(DB, REV.id, (cur) => ({ ...cur, date: day(30), agendaFrom: typed }));
    const jane = await tab(FOUNDER, 1280, 900);
    await open(jane, `#/meetings/${REV.id}/review`);
    ok(/This agenda isn’t open for review yet/.test(await text(jane, 'main h1')) && /The chair’s review opens [A-Z][a-z]+day/.test(await text(jane)), `Board’s admins: the day it opens (${(await text(jane)).slice(0, 140)})`);
    await close(jane);
  });
  // (the review's meeting well out of the way, and the one presented the next)
  await patchMeeting(DB, REV.id, (cur) => ({ ...cur, date: day(200) }));
  NEXT = await getMeeting(DB, (await patchMeeting(DB, (await make(day(9))).id, (cur) => ({ ...cur, shared: true }))).id);
  await agendaApproved(DB, NEXT.id, 'Alex Rivera');
  const MAKEOVERS = itemOf(NEXT, 'projects').id;
  const REVEALS_ITEM = itemOf(NEXT, 'reveals').id;
  const FIN = itemOf(NEXT, 'cash').id;
  const QUESTIONS = itemOf(NEXT, 'Questions from the board').id;

  // ─── b1 ───
  await step('b1: the presenting screen never freezes on the makeovers slide, at any size, with any number of families', async () => {
    for (const n of [6, 14, 30]) {
      for (const photos of [true, false]) {
        await setPipe(many(n), { photos });
        for (const size of SIZES) {
          const [w, h] = dims(size);
          const what = `${n} families, ${photos ? 'photos' : 'initials'}, ${size}`;
          let p;
          try {
            p = await tab(FOUNDER, w, h);
            await within(15000, presentAt(p, MAKEOVERS));
            const a = await answers(p, '.bs-pipe .bs-pipe__card');
            ok(a.drawn && !a.why, `${what}: opened on it, drawn and answering${a.why ? ` (${a.why})` : ` (${a.ms} ms)`}`);
            if (a.layout != null) ok(a.layout <= 50, `${what}: its layout ${a.layout} ms`);
            if (!a.why && n === 14 && photos && (w === 390 || w === 1280)) await shot(p, `b1-pipe-${n}-${size}`);
            if (a.why) { await relaunch(); continue; }
            // Stepped onto with →, from the slide before it, and on to the reveals after it
            if (w === 390 || w === 800 || w === 1280) {
              await within(15000, presentAt(p, FIN));
              const before = await answers(p, '.bs-item');
              if (before.why) { ok(false, `${what}: the slide before it: ${before.why}`); await relaunch(); continue; }
              {
                for (let i = 0; i < 12; i++) {
                  const there = await within(2000, p.evaluate(() => [...document.querySelectorAll('.bs-pipe')].some((e) => e.getClientRects().length > 0))).catch(() => null);
                  if (there !== false) break;
                  await within(2000, p.keyboard.press('ArrowRight')).catch(() => null);
                  await sleep(250);
                }
                const b = await answers(p, '.bs-pipe .bs-pipe__card');
                ok(b.drawn && !b.why, `${what}: stepped onto it with →, answering${b.why ? ` (${b.why})` : ''}`);
                if (b.why) { await relaunch(); continue; }
              }
              await within(15000, presentAt(p, REVEALS_ITEM));
              const r = await answers(p, '.bs-when .bs-when__kids li');
              ok(r.drawn && !r.why && (r.layout ?? 0) <= 50, `${what}: the reveals slide after it, answering${r.why ? ` (${r.why})` : ` (layout ${r.layout} ms)`}`);
              if (r.why) { await relaunch(); continue; }
            }
            await close(p);
          } catch (err) {
            ok(false, `${what}: ${String(err.message || err).split('\n')[0]}`);
            await relaunch();
          }
        }
      }
    }
    // A member's phone following the meeting live, the chair on the makeovers slide
    await patchMeeting(DB, NEXT.id, (cur) => ({ ...cur, live: { ...cur.live, startedAt: new Date().toISOString(), itemId: MAKEOVERS, fileId: '', page: 0 } }));
    for (const [n, photos] of [[14, true], [30, false]]) {
      await setPipe(many(n), { photos });
      try {
        const p = await tab(MARIA, 390, 844);
        await within(15000, p.goto(`${SITE}/admin/board/#/meetings/${NEXT.id}/screen`, { waitUntil: 'domcontentloaded' }));
        const a = await answers(p, '.bs-pipe .bs-pipe__card');
        ok(a.drawn && !a.why && (a.layout ?? 0) <= 50, `a member following live on a phone, ${n} families: drawn and answering${a.why ? ` (${a.why})` : ` (layout ${a.layout} ms)`}`);
        if (a.why) await relaunch(); else { await shot(p, `b1-following-${n}-390`); await close(p); }
      } catch (err) {
        ok(false, `a member following live, ${n} families: ${String(err.message || err).split('\n')[0]}`);
        await relaunch();
      }
    }
    await patchMeeting(DB, NEXT.id, (cur) => ({ ...cur, live: { ...cur.live, startedAt: '', itemId: '' } }));
  });

  // ─── m2 ───
  await step('m2: one long sentence of notes: as many whole lines as fit, then the rest is on the board page', async () => {
    await setPipe(many(6), { photos: true });
    // The money's answer in late: a balance sheet that takes 2 s to say it isn't there. Meanwhile the slide shows the
    // cash being asked for ("…"), then "No figures yet", twice its height; the notes fitted around the first have to fit
    // again (the full check after Board QA round 8 failed this now and then, by which came first: here it's always the
    // late one)
    // (an .xlsx by its first bytes; what's in it never read, its answer held back and then not found)
    let SHEET = null;
    for (const [at, what, late] of [[QUESTIONS, 'Questions from the board'], [FIN, 'the money'], [FIN, 'the money, its answer in late', true]]) {
      if (late) {
        SHEET = await putFile(env, { ownerType: 'meeting', ownerId: OLD.id, file: new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0])], 'Statement of Financial Position.xlsx'), kind: 'financials', by: FOUNDER });
        LATE = { re: new RegExp(`/api/board-file\\?id=${SHEET.id}`), ms: 2000 };
      }
      for (const size of ['1280x720', '1920x1080', '2560x1440']) {
        const [w, h] = dims(size);
        const p = await tab(FOUNDER, w, h);
        await presentAt(p, at);
        await p.waitForSelector('.bs-points', { timeout: 15000 });
        if (late) ok(await p.evaluate(() => [...document.querySelectorAll('.bs-figs__value')].some((e) => e.getClientRects().length && e.textContent === '…')), `${what}, ${size}: the cash still being asked for (…) when the notes are first fitted`);
        await sleep(late ? 4500 : 2500);
        if (late) ok(await p.evaluate(() => [...document.querySelectorAll('.bs-empty__title')].some((e) => e.getClientRects().length && e.textContent === 'No figures yet')), `${what}, ${size}: then “No figures yet” in its place`);
        const r = await p.evaluate(() => {
          const vis = (e) => e && e.getClientRects().length > 0;
          const slide = [...document.querySelectorAll('.bs-item')].find(vis);
          const el = slide.querySelector('.bs-points');
          const more = el.querySelector('.bs-points__more');
          const cl = el.querySelector('.is-clamped');
          const facts = slide.classList.contains('bs-item--facts') ? slide.querySelector(':scope > .bs-item__facts') : null;
          const over = () => slide.scrollHeight > slide.clientHeight + 1 || el.scrollHeight > el.clientHeight + 1 || (!!facts && facts.scrollHeight > facts.clientHeight + 1);
          if (!cl) return { clamped: false, more: vis(more) ? more.textContent : '' };
          const shown = Number(cl.style.getPropertyValue('--clamp') || 3);
          // The most lines that would fit, tried one by one
          let most = 0;
          for (let k = 1; k <= 40; k++) { cl.style.setProperty('--clamp', String(k)); if (!over()) most = k; else break; }
          cl.style.setProperty('--clamp', String(shown));
          return { clamped: true, shown, most, fits: !over(), more: vis(more) ? more.textContent : '' };
        });
        ok(r.clamped && r.shown === r.most && r.fits, `${what}, ${size}: ${r.shown} lines shown, ${r.most} fit`);
        ok(r.more === 'The rest is on the board page.', `${what}, ${size}: then “${r.more}”`);
        if (size === '1920x1080') { ok(r.shown > 3, `${what}, ${size}: more than 3 lines where there’s room (${r.shown})`); await shot(p, `m2-${what.replace(/[\s,]+/g, '-')}-${size}`); }
        await close(p);
      }
      if (late) { LATE = null; await DB.prepare('DELETE FROM board_files WHERE id = ?').bind(SHEET.id).run(); }
    }
  });

  // ─── m3 and m4 ───
  /** Each card on the makeovers slide: its name inside it, and its tag the longest of its wordings that fits */
  const cards = (page, forms) => page.evaluate((forms) => {
    const nb = (s) => String(s || '').replace(/ /g, ' ').trim();
    const out = [];
    for (const card of document.querySelectorAll('.bs-pipe__card:not(.is-quiet)')) {
      if (!card.getClientRects().length) continue;
      const name = card.querySelector('.bs-pipe__name');
      const box = (name.closest('.bs-pipe__namebox') || card).getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const g = document.createRange();
      g.selectNodeContents(name);
      const rs = [...g.getClientRects()].filter((x) => x.width > 0);
      const left = Math.min(...rs.map((x) => x.left));
      const right = Math.max(...rs.map((x) => x.right));
      const x = { name: nb(name.textContent), past: Math.round(Math.max(right - Math.min(box.right, c.right), Math.max(box.left, c.left) - left) * 10) / 10, cutWide: name.scrollWidth > name.clientWidth + 1 };
      const when = card.querySelector('.bs-pipe__photo > .bs-pipe__when');
      const mine = forms[x.name];
      if (when && mine) {
        const photo = when.parentElement;
        const room = photo.clientWidth - 2 * when.offsetLeft;
        const widths = mine.map((f) => { const k = when.cloneNode(false); k.textContent = f; Object.assign(k.style, { visibility: 'hidden', maxWidth: 'none' }); photo.append(k); const wd = k.getBoundingClientRect().width; k.remove(); return wd; });
        const best = mine[widths.findIndex((wd) => wd <= room + 0.5)] ?? mine.at(-1);
        Object.assign(x, { tag: nb(when.textContent), best: nb(best), cut: when.scrollWidth > when.clientWidth + 1, room: Math.round(room) });
      }
      out.push(x);
    }
    return { rows: document.querySelector('.bs-pipe')?.dataset.rows, cards: out };
  }, forms);
  /** Every wording a family's tag can take, longest first, as the slide says them */
  const formsNow = () => Object.fromEntries(REVEALS.map((r) => {
    if (r.confirmed) { const date = shortDate(r.date).replace(/, \d{4}$/, ''); const time = r.time ? ` · ${clock(r.time).replace(':00', '')}` : ''; return [r.name, [`Reveal ${date}${time}`, `${date}${time}`, date]]; }
    const label = r.window.label;
    const part = `${r.window.part.charAt(0).toUpperCase()}${r.window.part.slice(1)} ${new Date(`${r.window.month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
    return [r.name, [`Reveal ${label}`, `${label.charAt(0).toUpperCase()}${label.slice(1)}`, part]];
  }).concat(JOBS.filter((j) => !REVEALS.some((r) => j.name.startsWith(`${r.name} (`)) && !/Awaiting/.test(j.customFieldValues.nodes[0].value)).map((j) => [j.name.replace(/ \(\d+\)$/, ''), ['Reveal date to come', 'Date to come']])));
  const pipeAt = async (size) => {
    const [w, h] = dims(size);
    const p = await tab(FOUNDER, w, h);
    await within(15000, presentAt(p, MAKEOVERS));
    const a = await answers(p, '.bs-pipe .bs-pipe__card');
    if (a.why) throw new Error(`the slide at ${size}: ${a.why}`);
    await sleep(500);
    return p;
  };
  await step('m3: every family’s name inside its own card, at every size', async () => {
    for (const [set, label] of [[WIDE, 'the long names'], [many(14), '14 families']]) {
      await setPipe(set, { photos: true });
      for (const size of label === '14 families' ? ['960x540', '1440x900', '390x844'] : ['960x540', '1024x768', '1280x720', '1366x768', '1440x900', '1920x1080', '2560x1440', '390x844', '768x1024']) {
        const p = await pipeAt(size);
        const r = await cards(p, {});
        const past = r.cards.filter((x) => x.past > 0.5 || x.cutWide);
        ok(r.cards.length >= 4 && !past.length, `${label}, ${size}: ${r.cards.length} names, each inside its card${past.length ? ` (${past.map((x) => `${x.name} ${x.past}px past`).join(', ')})` : ''}`);
        if (label === 'the long names' && ['1440x900', '390x844'].includes(size)) await shot(p, `m3-wide-${size}`);
        await close(p);
      }
    }
  });
  await step('m4: every reveal tag says as much as its card has room for, on one row or two', async () => {
    for (const [set, label, sizes] of [[many(14), '14 families', ['1440x900', '1280x720', '1920x1080', '2560x1440', '960x540', '390x844', '768x1024']], [WIDE, 'the long names', ['1440x900', '960x540']], [many(30), '30 families', ['1920x1080', '1280x720']]]) {
      await setPipe(set, { photos: true });
      const forms = formsNow();
      for (const size of sizes) {
        const p = await pipeAt(size);
        const r = await cards(p, forms);
        const tagged = r.cards.filter((x) => x.tag != null);
        const short = tagged.filter((x) => x.tag !== x.best);
        const cut = tagged.filter((x) => x.cut);
        ok(tagged.length >= 3 && !short.length, `${label}, ${size} (${r.rows} row${r.rows === '1' ? '' : 's'}): every tag the most that fits${short.length ? ` (${short.map((x) => `${x.name} “${x.tag}” where “${x.best}” fits in ${x.room}px`).join('; ')})` : ` (${tagged.slice(0, 3).map((x) => `“${x.tag}”`).join(', ')}…)`}`);
        ok(!cut.length, `${label}, ${size}: no tag cut short${cut.length ? ` (${cut.map((x) => x.tag).join(', ')})` : ''}`);
        if (size === '1440x900' && label === '14 families') await shot(p, 'm4-tags-14-1440x900');
        await close(p);
      }
    }
  });

  // ─── m5 ───
  await step('m5: the Makeovers map: its line and its key count the same families, the ones with no pin said beside it', async () => {
    JOBS = [];
    await DB.prepare("DELETE FROM board_state WHERE key = 'projects'").run();
    const count = (re, s) => Number((s.match(re) || [])[1] || 0);
    for (const [where, w] of [['the Makeovers page', 320], ['the Makeovers page', 390], ['the Makeovers page', 1280], ['Home’s card', 390], ['Home’s card', 1280]]) {
      const p = await tab(MARIA, w, 900);
      if (where === 'Home’s card') {
        await open(p, '#/');
        await p.waitForSelector('#makeovers .lc-views', { timeout: 10000 });
        await p.evaluate(() => [...document.querySelectorAll('#makeovers .lc-views button')].find((b) => b.textContent.trim() === 'Map')?.click());
      } else await open(p, '#/families/map');
      await p.waitForSelector('.fm-stage .apl-legend', { timeout: 10000 });
      await sleep(700);
      const r = await p.evaluate((home) => {
        const scope = home ? document.querySelector('#makeovers') : document.querySelector('main');
        const sum = (scope.querySelector(home ? '.lc-sum' : '.bf-sum')?.innerText || '').replace(/\s+/g, ' ');
        const key = Object.fromEntries([...scope.querySelectorAll('.fm-stage .apl-legend button')].map((b) => [b.textContent.replace(b.querySelector('b')?.textContent || '', '').trim().toLowerCase(), Number(b.querySelector('b')?.textContent || 0)]));
        // (what's said beside the key: in the map's own stage, by the key)
        const said = (scope.querySelector('.fm-stage')?.innerText || '').replace(/\s+/g, ' ');
        return { sum, key, said };
      }, where === 'Home’s card');
      const note = r.said.match(/(\d+) more makeovers? (?:isn’t|aren’t) on the map \(([^)]*)\)/);
      const away = Object.fromEntries((note?.[2] || '').split(/,\s*/).filter(Boolean).map((x) => { const m = x.match(/^(\d+) (.+)$/); return [m[2], Number(m[1])]; }));
      const lines = [
        ['approved', count(/(\d+) approved/, r.sum)],
        ['awaiting funding', count(/(\d+) awaiting funding/, r.sum)],
        ['building', count(/(\d+) makeovers? being built/, r.sum)],
      ];
      const off = lines.filter(([k, n]) => (r.key[k] || 0) + (away[k] || 0) !== n);
      ok(!off.length, `${where}, ${w}: the line (${r.sum}) = the key + those said beside it (${JSON.stringify(r.key)} + ${note ? note[0] : 'nothing said'})${off.length ? `: ${off.map(([k, n]) => `${k} ${n} ≠ ${r.key[k] || 0} + ${away[k] || 0}`).join(', ')}` : ''}`);
      ok(!!note && /no application in Board for them, so no address/.test(r.said), `${where}, ${w}: the makeovers with no pin said in plain words (${note ? r.said.slice(r.said.indexOf(note[0]), r.said.indexOf(note[0]) + 160) : 'none'})`);
      ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${where}, ${w}: no sideways scroll`);
      if (w !== 390 || where !== 'Home’s card') await p.$eval('.fm-stage', (e) => e.scrollIntoView({ block: 'start' })).catch(() => {});
      await shot(p, `m5-${where === 'Home’s card' ? 'home' : 'page'}-${w}`);
      await close(p);
    }
  });

  // ─── m6 ───
  await step('m6: search for an amount however it’s written: its line shown and marked, and the PDF opened at it', async () => {
    const search = async (p, q) => {
      if (!(await p.$('dialog.bp-finder[open]'))) { await p.click('button.bp-find'); await p.waitForSelector('dialog.bp-finder[open] input', { timeout: 5000 }); }
      await p.$eval('dialog.bp-finder input', (i) => { i.focus(); i.select(); });
      await p.keyboard.press('Backspace');
      await p.keyboard.type(q, { delay: 20 });
      await p.waitForFunction(() => document.querySelector('.bp-finder [role=option]') || /Nothing found/.test(document.querySelector('.bp-finder__none')?.textContent || ''), { timeout: 10000 }).catch(() => {});
      await sleep(900);
      return p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=option]')].map((x) => ({ title: x.querySelector('.bp-finder__title')?.innerText || '', line: [...x.querySelectorAll('.bp-finder__sub')].map((s) => s.innerText).join(' | '), marks: [...x.querySelectorAll('.bp-finder__sub mark')].map((m) => m.textContent) })));
    };
    for (const [who, w] of [[MARIA, 390], [SAM, 1280]]) {
      const p = await tab(who, w, 900);
      await open(p, '#/');
      await sleep(2500);
      for (const [q, mark] of [['375,000', /^375,000\.00$/], ['$375,000', /^375,000\.00$/], ['375000', /^375,000\.00$/], ['375,000.00', /^375,000\.00$/], ['$375,000.00', /^375,000\.00$/], ['250,000.50', /^250,000\.50$/], ['Total for Bank', /^total$/i]]) {
        const found = await search(p, q);
        const hit = found.find((x) => /Statement of financial position/i.test(x.title));
        ok(!!hit, `${w}: “${q}” finds the statement (${JSON.stringify(found.slice(0, 3).map((x) => x.title))})`);
        ok(!!hit && hit.marks.some((m) => mark.test(m)) && /Total for Bank Accounts \$375,000\.00|Example Operating \$250,000\.50/.test(hit.line), `${w}: “${q}”: its line shown, the amount marked (${hit ? `${hit.line.slice(0, 120)} · marked ${JSON.stringify(hit.marks)}` : 'not found'})`);
        if (q === '375,000' && w === 390) await shot(p, 'm6-search-390');
      }
      // …and it opens the PDF at the amount, its find box on it and the amount marked on the page
      await search(p, '375,000');
      await p.evaluate(() => [...document.querySelectorAll('.bp-finder [role=option]')].find((x) => /Statement of financial position/i.test(x.querySelector('.bp-finder__title')?.innerText || ''))?.click());
      const opened = await p.waitForFunction(() => /375,000\.00/.test(document.querySelector('.fv-find-input')?.value || '') && /^1 of 1$/.test(document.querySelector('.fv-find-count')?.textContent || ''), { timeout: 15000 }).then(() => true, () => false);
      const said = await p.evaluate(() => ({ find: document.querySelector('.fv-find-input')?.value || '', count: document.querySelector('.fv-find-count')?.textContent || '', marked: document.querySelectorAll('.fv-pdf .textLayer .highlight').length }));
      ok(opened && said.marked >= 1, `${w}: the PDF opens at it, found and marked (${JSON.stringify(said)})`);
      if (w === 1280) await shot(p, 'm6-viewer-1280');
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
console.log('\nAll round 6 member checks passed. Screenshots in test-results/board-round6-member/');
process.exit(0);
