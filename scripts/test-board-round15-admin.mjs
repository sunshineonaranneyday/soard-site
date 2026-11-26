/**
 * test-board-round15-admin.mjs: the founders' Board admin and the board page, as Board QA round 15's admin tester found
 * them (Nov 26 2026), each on the page itself. The real handlers behind the real sign-in middleware on an in-memory D1
 * and R2, as scripts/test-board-round14-admin.mjs does; Google and Resend faked. Answers are lost as a gateway loses them,
 * through the browser's own network (CDP Fetch): after the site did its work, or before it reached it. Made-up people only.
 *   K2  Print it all prints the minutes the board page shows: minutes approved, signed and their signed copy kept, then
 *       taken back to draft and a word fixed: the page links "The minutes as written" and "An earlier signed copy", and
 *       Print prints the Word file as the minutes, the signed copy only as an earlier one, never "The minutes, signed";
 *       minutes still approved as signed print the signed copy as "The minutes, signed" (the control). At 1280 and 390
 *   K3  Minutes kept only as a Staff only file, approved: Board's card says they're staff only (never "The board can read
 *       them now"), Email the board is off, Home tags them "Minutes staff only", and the board page says they're
 *       approved and not shared yet, with nothing to read. At 1280 and 390
 *   K4  A press whose answer is lost while Board's looks fail too (Mark them approved, Mark as draft, Take it off, Share
 *       with the board): Board's own try again has the site's answer, so the press says its own words ("Marked
 *       approved", "Taken off the board page", "On the board page" with its Undo), never "Saved" then "can't tell yet".
 *       At 1280 and 390
 * Screenshots land in test-results/board-round15-admin/. Exits non-zero on any failure.
 *
 *   PORT=5471 node scripts/test-board-round15-admin.mjs        (ONLY=K2,K4 runs those steps alone)
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { agendaApproved } from '../tests/lib/agenda-approved.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, getMeeting, provideBoardFinance, putFile, approveMinutes } from '../functions/api/_board.js';
import { saveNotes, sendNotes } from '../functions/api/_board-notes.js';
import { signMinutes } from '../functions/api/_board-minutes-sign.js';
import { cleanMeeting, fileTitle } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round15-admin/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const TAYLOR = 'taylor.board@example.net';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary', order: 3 },
  'maria-example': { name: 'Maria Example', group: 'board', title: 'Board Member', order: 4 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 5 },
};
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', TAYLOR], ['maria-example', 'maria.board@example.com']];
const BOARD = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen', 'maria-example', 'kim-park'];
const UNSURE = 'The site didn’t answer, so we can’t tell yet whether that was saved. Reload the page in a moment to see.';
const STAFF_ONLY = 'Minutes revised is staff only, so the board can’t read these minutes. To share them, switch it to Board sees it in Every file.';
const WIDTHS = [1280, 390];

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

// ── The database, which can be made to fail a statement (`fault`: its SQL matching `re`, `n` times) ──
const DB0 = await createD1();
let fault = null;
const DB = new Proxy(DB0, {
  get: (t, k) => {
    if (k !== 'prepare') return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
    return (sql) => {
      const st = t.prepare(sql);
      if (!fault || !fault.re.test(sql)) return st;
      const wrap = (s) => new Proxy(s, { get: (x, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => { if (fault && fault.n > 0) { fault.n -= 1; fault.failed += 1; throw new Error('D1_ERROR: Network connection lost.'); } return x[m](...a); } : m === 'bind' ? (...a) => wrap(x.bind(...a)) : typeof x[m] === 'function' ? x[m].bind(x) : x[m]) });
      return wrap(st);
    };
  },
});
for (const sql of [
  'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)',
  'CREATE TABLE community (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
]) await DB0.exec(sql);
for (const [slug, d] of Object.entries(PEOPLE)) await DB0.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
for (const [slug, email] of EMAILS) await DB0.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
await DB0.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: [] })).run();

// ── The outside world, faked: Google Calendar keeps its events, Resend keeps what it sent ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }),
  DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test',
  AI: { run: async () => { throw new Error('test: Workers AI down'); }, toMarkdown: async (f) => ({ name: f.name, format: 'markdown', data: '' }) },
};
const google = { events: {}, calls: [] };
const mail = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); mail.push(...[].concat(b)); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.split('/').pop());
    google.calls.push({ method, id: method === 'POST' ? body?.id : id, body });
    if (method === 'GET' && u.pathname.endsWith('/events')) return Response.json({ items: [] });
    if (method === 'POST') {
      const e = { ...body, status: 'confirmed', hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { conferenceId: 'abc-defg-hij' }, attendees: (body.attendees || []).map((a) => ({ ...a, responseStatus: 'needsAction' })) };
      google.events[e.id] = e;
      return Response.json(e);
    }
    const e = google.events[id];
    if (!e) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
    if (method === 'PATCH') Object.assign(e, body);
    return Response.json(e);
  }
  if (/^https:\/\/(admin|gmail|meet|www)\.googleapis\.com\//.test(url)) return Response.json({ items: [], members: [], messages: [], files: [], conferenceRecords: [] });
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
const board = (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }] },
  { title: 'Finance', items: [{ id: 'i_r15ytd', title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }, { id: 'i_r15bud', title: 'The 2027 budget' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
const TAYLOR_W = { member: { slug: 'taylor-nguyen', name: 'Taylor Nguyen', email: TAYLOR, seat: 'secretary' }, admin: false };
const TAYLOR_M = { slug: 'taylor-nguyen', name: 'Taylor Nguyen', email: TAYLOR, seat: 'secretary', title: 'Board Secretary' };
/** Held `ago` days back: Taylor's typed notes sent, the Word file the send kept saying "forty thousand" */
async function heldSent(ago = 1) {
  const m = await make(day(-ago), { shared: true });
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'n:i_r15bud': 'Budget passed at forty thousand.' } }, TAYLOR_W);
  await sendNotes(env, m.id, TAYLOR_W);
  return getMeeting(DB, m.id);
}
/** A real one-page PDF, so the board page and Print draw it */
async function pdfOf(words) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText(words, { x: 72, y: 700, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return new Uint8Array(await doc.save());
}
/** Approved, signed by Taylor on the board page, and the signed copy kept (After the meeting → The signed copy → Upload it) */
async function signedKept(ago) {
  const m = await heldSent(ago);
  await approveMinutes(env, m.id, { on: day(0), by: FOUNDER, press: true });
  await signMinutes(env, m.id, TAYLOR_M, { mark: { type: 'typed', text: 'Taylor Nguyen', style: 'script' }, consent: true });
  const copy = await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: new File([await pdfOf('Signed minutes: Budget passed at forty thousand.')], 'Signed minutes, Q4 2026 Board Meeting.pdf', { type: 'application/pdf' }), kind: 'signed', by: FOUNDER });
  const now = await getMeeting(DB, m.id);
  return { id: m.id, word: now.files.find((f) => f.kind === 'minutes'), copy };
}
// K2: taken back to draft and a word fixed (the tester's), and the control, still approved as signed
const K2 = {};
for (const w of WIDTHS) {
  const s = await signedKept(1);
  const cur = await getMeeting(DB, s.id);
  const back = await saveMeeting(DB, { ...cur, minutes: 'draft', approvedOn: '' }, { by: FOUNDER, edit: true, env });
  await saveMeeting(DB, { ...back, sections: back.sections.map((x) => ({ ...x, items: x.items.map((it) => (it.id === 'i_r15bud' ? { ...it, notes: 'Budget passed at fifty thousand.' } : it)) })) }, { by: FOUNDER, edit: true, env });
  K2[w] = { draft: { ...s, word: (await getMeeting(DB, s.id)).files.find((f) => f.kind === 'minutes') }, kept: await signedKept(2) };
}
// K3: held in June, its only minutes file kept Staff only, then approved
const K3 = await make(day(-150), { shared: true });
await putFile(env, { ownerType: 'meeting', ownerId: K3.id, file: new File([await pdfOf('Minutes revised')], 'Minutes revised.pdf', { type: 'application/pdf' }), kind: 'minutes', staffOnly: true, by: FOUNDER });
await approveMinutes(env, K3.id, { on: day(0), by: FOUNDER, press: true });
// K4: per width, a held meeting with typed minutes (approve, then draft), one ahead on the board page (take it off), one
// held and off the board page (share)
const K4 = {};
for (const w of WIDTHS) {
  const held = await heldSent(3);
  const ahead = await make(day(9), { shared: true });
  await agendaApproved(DB, ahead.id);
  const off = await make(day(-60), { shared: false });
  K4[w] = { held, ahead, off };
}

// ── The server ──
const ROUTES = { '/api/board-admin': boardAdmin, '/api/board-portal': boardPortal, '/api/board-file': boardFile };
const csp = (() => {
  const lines = readFileSync(join(ROOT, 'public/_headers'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === '/admin/*');
  return lines.slice(at + 1).find((l) => /^\s+Content-Security-Policy:/.test(l)).split('Content-Security-Policy:')[1].trim();
})();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
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
const PORT = Number(process.env.PORT ?? 5471);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── The browser (one at a time) ──
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 400000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const errs = [];
async function open(path, { width = 1280, height = 900, as = FOUNDER } = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width, height });
  await page.setExtraHTTPHeaders({ 'x-test-user': as });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|fonts\.gstatic|x-test-user|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  page.on('dialog', async (d) => { await d.accept().catch(() => {}); });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    const seen = new WeakSet();
    new MutationObserver(() => {
      for (const t of document.querySelectorAll('.toast, .bp-toast.is-on')) { const s = t.textContent.replace(/\s+/g, ' ').trim(); if (!seen.has(t) || t.__said !== s) { seen.add(t); t.__said = s; if (s) window.__toasts.push(s); } }
    }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  return page;
}
async function step(name, fn) {
  if (ONLY.length && !ONLY.some((x) => name.startsWith(`${x}:`))) return;
  console.log(`\n${name}`);
  try { await fn(); } catch (err) {
    const why = String(err?.message || err).split('\n')[0];
    failures.push(`${name}: a step stopped: ${why}`);
    console.log(`  ✗ a step stopped: ${why}`);
  }
}
const toasts = (page) => page.evaluate(() => window.__toasts || []);
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const question = (page, ms = 6000) => page.waitForSelector('.ask-overlay [data-ask]', { timeout: ms }).then(() => true, () => false);
const answer = async (page, which) => { await page.click(`.ask-overlay [data-ask="${which}"]`); await sleep(400); };
async function press(page, sel, re) {
  const h = await page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled && x.offsetParent) || null, sel, re.source);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no button “${re.source}” in ${sel}`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.click();
}
const savedLine = (page) => page.evaluate(() => document.querySelector('.bm-saved')?.textContent.trim() || '');
const site = (id) => getMeeting(DB0, id);
const openStep = (page, re) => page.evaluate((src) => [...document.querySelectorAll('.bm-path__btn')].find((e) => new RegExp(src).test(e.textContent.trim()))?.click(), re.source);
/**
 * The page's next `saves` save-meeting answers lost (`how`: 'after', the site did its work and the page got a 502;
 * 'before', it never reached the site), and every one of Board's quick looks failing too (a 502) while armed
 */
async function cut(page, how, { saves = 1 } = {}) {
  const cdp = await page.createCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/board-admin*', requestStage: 'Request' }] });
  const st = { armed: true, saves, log: [] };
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const bad = (id) => cdp.send('Fetch.fulfillRequest', { requestId: id, responseCode: 502, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<html>502 Bad gateway</html>').toString('base64') });
  cdp.on('Fetch.requestPaused', async (ev) => {
    try {
      const body = ev.request.postData || '';
      if (st.armed && ev.request.method === 'POST' && /"action":"save-meeting"/.test(body) && st.saves > 0) {
        st.saves -= 1;
        if (how === 'before') { st.log.push(`${at()} save: never reached the site`); await bad(ev.requestId); return; }
        const r = await realFetch(ev.request.url, { method: 'POST', headers: ev.request.headers, body });
        st.log.push(`${at()} save: the site said ${r.status}, the page got a 502`);
        await bad(ev.requestId);
        return;
      }
      if (st.armed && ev.request.method === 'GET' && /board-admin\?quick/.test(ev.request.url)) { st.log.push(`${at()} look: 502`); await bad(ev.requestId); return; }
      if (ev.request.method === 'POST' && /"action":"save-meeting"/.test(body)) st.log.push(`${at()} save: passed`);
      await cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
    } catch (e) { st.log.push(`ERR ${e.message}`); }
  });
  return st;
}
/** Whether the page said "Saved" and then that it couldn't tell */
const savedThenUnsure = (said) => { const i = said.indexOf('Saved'); return i >= 0 && said.slice(i).some((t) => t.includes(UNSURE)); };

try {
  // ═══ K2: Print prints the minutes the board page shows ═══
  for (const width of WIDTHS) {
    for (const which of ['draft', 'kept']) {
      await step(`K2: ${which === 'draft' ? 'minutes taken back to draft and a word fixed' : 'minutes approved as signed (the control)'}, at ${width}: the board page’s links and Print it all agree on the minutes`, async () => {
        const k = K2[width][which];
        const A = await open(`/admin/board/#/meetings/${k.id}`, { width, as: ALEX });
        await sleep(1500);
        const links = await A.evaluate(() => [...document.querySelectorAll('.bp-aghero__links a')].map((a) => `${a.textContent.trim()} → ${a.getAttribute('href') || ''}`));
        const line = await A.evaluate(() => document.querySelector('.mfix-signed')?.textContent.trim() || '');
        const want = which === 'draft' ? 'An earlier signed copy' : 'The signed copy';
        ok(links.length === 2 && /^The minutes as written/.test(links[0]) && links[1].startsWith(want), `the page links “The minutes as written” and “${want}” (${JSON.stringify(links)})`);
        if (which === 'draft') ok(/The minutes changed after that/.test(line), `the signed line: “${line}”`);
        await shot(A, `k2-${which}-page-${width}`);
        await A.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; setTimeout(() => dispatchEvent(new Event('afterprint')), 1500); }; });
        await press(A, 'button', /^Print it all$/);
        for (let i = 0; i < 80; i++) { await sleep(500); if (await A.evaluate(() => window.__printed)) break; }
        const caps = await A.evaluate(() => [...document.querySelectorAll('.bpp .bpp-cap')].map((x) => x.textContent.trim()));
        ok(caps.length > 0, `it printed (${caps.length} documents)`);
        const minutesCaps = caps.filter((c) => /^The minutes|signed copy/.test(c));
        if (which === 'draft') {
          ok(minutesCaps[0]?.startsWith(`The minutes as written · ${fileTitle(k.word.name)}`), `the minutes printed are the Word file the page links (“${minutesCaps[0] || ''}”)`);
          ok(minutesCaps[1]?.startsWith('An earlier signed copy · Signed minutes'), `the signed copy only as an earlier one (“${minutesCaps[1] || ''}”)`);
          ok(!caps.some((c) => /^The minutes, signed/.test(c)), `never “The minutes, signed” (${JSON.stringify(caps)})`);
        } else {
          ok(minutesCaps[0]?.startsWith('The minutes, signed · Signed minutes') && minutesCaps.length === 1, `approved as signed: the signed copy, as ever (${JSON.stringify(minutesCaps)})`);
        }
        await A.close();
      });
    }
  }

  // ═══ K3: a staff-only file is never the board's minutes, approved or not ═══
  for (const width of WIDTHS) {
    await step(`K3: approved minutes kept only as a Staff only file, at ${width}: Board says staff only, Email the board is off, Home says “Minutes staff only”, the board page says approved and not shared yet`, async () => {
      const A = await open(`/admin/#board/meeting/${K3.id}`, { width });
      await A.waitForSelector('.bm-top');
      await openStep(A, /^Minutes/);
      await sleep(800);
      const card = await A.evaluate(() => document.querySelector('.bm-wrap')?.innerText.replace(/\s+/g, ' ') || '');
      ok(card.includes('The minutes are staff only') && card.includes(STAFF_ONLY), `the card says they’re staff only and what to do (${card.slice(0, 300)})`);
      ok(!/The minutes are in|The board can read them now/.test(card), 'never “The minutes are in” nor “The board can read them now”');
      ok(/Mark as draft/.test(card), 'still approved (Mark as draft)');
      const email = await A.evaluate(() => [...document.querySelectorAll('.bm-wrap button')].find((x) => /^Email the board/.test(x.textContent.trim()))?.disabled);
      ok(email === true, 'Email the board is off');
      await A.evaluate(() => document.querySelector('.bm-wrap')?.scrollIntoView({ block: 'start' }));
      await sleep(400);
      await shot(A, `k3-card-${width}`);
      await A.evaluate(() => { location.hash = '#board'; });
      await sleep(3500);
      const home = await A.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      ok(/Minutes staff only/.test(home), 'Home tags it “Minutes staff only”');
      await A.close();
      const B = await open(`/admin/board/#/meetings/${K3.id}`, { width, as: ALEX });
      await sleep(1500);
      const main = await B.evaluate(() => document.querySelector('main')?.innerText.replace(/\s+/g, ' ') || '');
      ok(/Minutes approved/.test(main) && main.includes('The minutes are approved. They aren’t shared on the board page yet.'), `the board page: approved, not shared yet (${main.slice(0, 260)})`);
      ok(!/The minutes as written|Read the minutes/.test(main), 'nothing offered to read');
      await shot(B, `k3-board-${width}`);
      await B.close();
    });
  }

  // ═══ K4: a lost press answers from the copy the page has ═══
  const PRESSES = [
    ['Mark them approved', 'after', (w) => K4[w].held.id, /^Minutes/, /^Mark them approved$/, /^Marked approved, /, (m) => m.minutes === 'approved'],
    ['Mark as draft', 'before', (w) => K4[w].held.id, /^Minutes/, /^Mark as draft$/, /^Back to draft minutes/, (m) => m.minutes !== 'approved'],
    ['Take it off', 'after', (w) => K4[w].ahead.id, null, /^Take it off$/, /^Taken off the board page/, (m) => m.shared === false],
    ['Share with the board', 'before', (w) => K4[w].off.id, /^Minutes/, /^Share with the board$/, /^On the board page/, (m) => m.shared === true],
  ];
  for (const width of WIDTHS) {
    for (const [name, how, idOf, stepRe, btnRe, wordsRe, has] of PRESSES) {
      await step(`K4: ${name}, its answer lost (${how === 'after' ? 'landed' : 'never reached the site'}) and every look failing, at ${width}: the press says its own words from Board’s own try again; never “Saved” then “can’t tell”`, async () => {
        const id = idOf(width);
        const A = await open(`/admin/#board/meeting/${id}`, { width });
        await A.waitForSelector('.bm-top');
        if (stepRe) { await openStep(A, stepRe); await sleep(800); }
        const c = await cut(A, how);
        // (pressed as a person's click reaches it: in view first; at 390 the button may sit under the page's own bar)
        const pressed = await A.evaluate((src) => { const x = [...document.querySelectorAll('main button')].filter((e) => e.offsetParent && !e.disabled).find((e) => new RegExp(src).test(e.textContent.trim())); x?.scrollIntoView({ block: 'center' }); x?.click(); return !!x; }, btnRe.source);
        ok(pressed, `pressed ${name}`);
        if (await question(A, 3000)) { await A.evaluate(() => document.querySelector('.ask-overlay [data-ask="yes"]')?.click()); await sleep(400); }
        await sleep(9000);
        c.armed = false;
        const said = await toasts(A);
        const now = await site(id);
        ok(has(now), `the site has it (${JSON.stringify({ minutes: now.minutes, shared: now.shared })}; ${c.log.join(' | ')})`);
        ok(c.log.some((x) => /^[\d.]+s save: (the site said|never reached)/.test(x)) && c.log.some((x) => / look: 502/.test(x)), `its answer was lost and Board’s look failed (${c.log.join(' | ')})`);
        ok(!said.some((t) => t.includes(UNSURE)), `never “can’t tell yet” (${JSON.stringify(said)})`);
        ok(!savedThenUnsure(said), 'never “Saved” then “can’t tell”');
        ok(said.some((t) => wordsRe.test(t)), `it says its own words (${JSON.stringify(said)})`);
        if (name === 'Share with the board') ok(said.some((t) => wordsRe.test(t) && /Undo/.test(t)), 'with its Undo');
        ok(/^Saved/.test(await savedLine(A)), `the save line: “${await savedLine(A)}”`);
        await shot(A, `k4-${name.toLowerCase().replace(/\s+/g, '-')}-${width}`);
        await A.close();
      });
    }
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
  globalThis.fetch = realFetch;
}
const bad = errs.filter((e) => !/Content Security Policy/.test(e));
ok(!bad.length, `no page errors (${bad.slice(0, 3).join(' | ')})`);
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join('\n- ')}` : '\nAll passed.');
process.exit(failures.length ? 1 : 0);
