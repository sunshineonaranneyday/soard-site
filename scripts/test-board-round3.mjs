/**
 * test-board-round3.mjs: Board admin as two founders, a stale tab and a phone find it (QA round 3, Nov 20 2026)
 * ================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-admin-keys.mjs
 * does; Google and Resend are faked. Made-up people only.
 *   - typing while a save is on its way, when that save comes back saved-meanwhile (409): nothing typed is lost, and both
 *     tabs' changes are on the site
 *   - the agenda template from two tabs: both changes kept (a merge), and each tab shows the other's
 *   - Share on the meeting's day before its agenda is approved isn't offered; a stale tab's Share the site refuses, or a
 *     stale tab's Mark them approved for minutes taken out, is said in words, put back as the site has it, and every edit
 *     after it saves; Take it off while saves can't go never says it was taken off
 *   - a meeting kept off the board page, shared from here, stays shared and a board meeting after the next edit
 *   - Who's coming and the quorum follow People → Board for a meeting ahead
 *   - Notes for the invite shows every word at 320, 390 and 1280 wide, and where field-sizing isn't (measured)
 *   - Home's to-do preview says why no reminder can go when the open ones are people's with no email
 * Screenshots land in test-results/board-round3/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round3.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { agendaApproved } from '../tests/lib/agenda-approved.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, getMeeting, provideBoardFinance, patchMeeting, getSettings } from '../functions/api/_board.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round3/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const FOUNDER = 'jane@soardcharity.com';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', order: 3 },
  'maria-lopez': { name: 'Maria Lopez', group: 'board', title: 'Board Member', order: 4 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 5 },
  'chris-okafor': { name: 'Chris Okafor', group: 'board', title: 'Board Member', order: 6 },
  'ada-example': { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member', order: 1 },
};
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net'], ['maria-lopez', 'maria.board@example.com']];
const BOARD = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen', 'maria-lopez', 'kim-park', 'chris-okafor'];

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

const DB = await createD1();
for (const sql of [
  'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)',
  'CREATE TABLE community (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
]) await DB.exec(sql);
for (const [slug, d] of Object.entries(PEOPLE)) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
for (const [slug, email] of EMAILS) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: [] })).run();
/** People → Board changed, as an admin's save on People leaves it */
const regroup = async (slug, group) => { const d = { ...PEOPLE[slug], group }; await DB.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind(group, JSON.stringify(d), slug).run(); };

// ── The outside world, faked ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }),
  DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test',
};
const mail = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) {
    const b = JSON.parse(init.body);
    const list = Array.isArray(b) ? b : [b];
    mail.push(...list.map((m) => ({ ...m, at: new Date().toISOString() })));
    return Response.json(Array.isArray(b) ? { data: list.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
  }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
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
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }, { title: 'The 2027 budget', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
// Held, on the board page: the only open to-dos are Kim's and Chris's (neither has an email on file)
const HELD = await make(day(-20), { shared: true, sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }],
  actions: [{ text: 'Book the spring venue', owner: 'kim-park', ownerName: 'Kim Park', due: day(5) }, { text: 'Call the caterer', owner: 'chris-okafor', ownerName: 'Chris Okafor', due: day(6) }] });
// Held, its minutes in (as a tab opened before they were taken out has them)
const STALE = await make(day(-30), { shared: true, sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }] });
await patchMeeting(DB, STALE.id, (cur) => ({ ...cur, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() } }));
// Held, kept off the board page as not a board meeting
const OFFPAGE = await make(day(-5), { shared: false, sections: [{ title: 'Coffee', items: [{ title: 'Catching up' }] }] });
await patchMeeting(DB, OFFPAGE.id, (cur) => ({ ...cur, notBoard: true }));
// Today, ending late (so it's still on), its agenda not approved
const TODAY = await make(day(0), { end: '23:59', shared: false });
// Next, on the board page, its agenda approved
const NEXT = await make(day(9), { shared: true });
await agendaApproved(DB, NEXT.id);

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
        if (url.pathname === '/api/list-content' && /team/.test(url.searchParams.get('dir') || '')) return Response.json({ success: true, items: Object.entries(PEOPLE).map(([slug, d]) => ({ name: `${slug}.json`, content: { ...d, slug } })), pages: 1 });
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
// (a port of its own, 4541 to 4543, or any free one)
const PORT = Number(process.env.PORT || 4541);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── The browser ──
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 400000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const errs = [];
async function open(path, width = 1440, { approvals = null, noFieldSizing = false } = {}) {
  const page = await browser.newPage();
  // (as Safari and Firefox are: no CSS field-sizing, so a box sized to its words is measured by hand)
  if (noFieldSizing) await page.evaluateOnNewDocument(() => { const was = CSS.supports.bind(CSS); CSS.supports = (...a) => (/field-sizing/.test(a.join(' ')) ? false : was(...a)); document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.bd-fit, .bd-notes { field-sizing: fixed !important; }'; document.head.append(st); }); });
  page.setDefaultTimeout(30000);
  await page.setViewport({ width, height: 1000 });
  await page.setExtraHTTPHeaders({ 'x-test-user': FOUNDER });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|fonts\.gstatic|x-test-user/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent.replace(/\s+/g, ' ').trim()); } } }).observe(document, { childList: true, subtree: true });
  });
  // A tab whose page has an approval the site doesn't (it was opened while it had one): the GET's answer, changed
  if (approvals) {
    const cdp = await page.createCDPSession();
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/board-admin', requestStage: 'Response' }] });
    cdp.on('Fetch.requestPaused', async (ev) => {
      try {
        if (ev.request.method !== 'GET') { await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }); return; }
        const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', { requestId: ev.requestId });
        const j = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
        if (j.approvals) Object.assign(j.approvals, approvals);
        await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: ev.responseStatusCode, responseHeaders: ev.responseHeaders, body: Buffer.from(JSON.stringify(j)).toString('base64') });
      } catch { /* the page went */ }
    });
  }
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  return page;
}
/** Holds the next `n` saves matching `re` for `ms` on their way to the site */
async function hold(page, re, ms, n = 1) {
  const cdp = await page.createCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/board-admin*', requestStage: 'Request' }] });
  const st = { n, held: 0 };
  cdp.on('Fetch.requestPaused', async (ev) => {
    const hit = ev.request.method === 'POST' && st.n > 0 && re.test(ev.request.postData || '');
    try {
      if (hit) { st.n -= 1; st.held += 1; await sleep(ms); }
      await cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
    } catch { /* the page went */ }
  });
  return st;
}
async function step(name, fn) {
  console.log(`\n${name}`);
  try { await fn(); } catch (err) {
    const why = String(err?.message || err).split('\n')[0];
    failures.push(`${name}: a step stopped: ${why}`);
    console.log(`  ✗ a step stopped: ${why}`);
  }
}
const toasts = (page) => page.evaluate(() => window.__toasts || []);
const saved = (page, sel = '.bm-saved') => page.waitForFunction((s) => /^Saved/.test(document.querySelector(s)?.textContent.trim() || ''), { timeout: 20000 }, sel).then(() => true, () => false);
const saveLine = (page) => page.evaluate(() => document.querySelector('.bm-saved')?.textContent.replace(/\s+/g, ' ').trim() || '');
/** Types at the end of a box */
async function typeIn(page, sel, words, delay = 0) {
  await page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, sel);
  await page.keyboard.type(words, { delay });
}
const valueOf = (page, sel) => page.evaluate((s) => document.querySelector(s)?.value ?? null, sel);
async function press(page, sel, re) {
  const h = await page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())) || null, sel, re.source);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no button “${re.source}” in ${sel}`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.click();
}
const has = (page, sel, re) => page.evaluate((s, src) => [...document.querySelectorAll(s)].some((x) => new RegExp(src).test(x.textContent.trim())), sel, re.source);
async function answer(page, which) {
  await page.waitForSelector('.ask-overlay [data-ask]', { timeout: 8000 });
  const title = await page.evaluate(() => document.querySelector('.ask h2')?.textContent || '');
  await page.click(`.ask-overlay [data-ask="${which}"]`);
  await sleep(300);
  return title;
}
const pathStep = (page, title) => page.evaluate((t) => [...document.querySelectorAll('.bm-path__step')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()).find((s) => s.startsWith(t)) || '', title);
const itemOf = async (id, label) => {
  const m = await getMeeting(DB, id);
  const [si, ii] = label.split('.').map((x) => Number(x) - 1);
  return m.sections[si]?.items[ii]?.title;
};
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

try {
  // ═══ MAJOR 1: typing while a save that comes back 409 is on its way ═══
  await step('Typing while a save is on its way, when someone saved meanwhile (409)', async () => {
    const A = await open(`/admin/#board/meeting/${NEXT.id}`);
    const B = await open(`/admin/#board/meeting/${NEXT.id}`);
    await typeIn(B, 'textarea[aria-label="Item 1.1"]', ' B');
    ok(await saved(B), 'tab B’s change to 1.1 saves');
    const held = await hold(A, /save-meeting/, 1500);
    await typeIn(A, 'textarea[aria-label="Item 2.2"]', ' A1');
    for (let i = 0; i < 200 && !held.held; i++) await sleep(20);
    await typeIn(A, 'textarea[aria-label="Item 2.2"]', ' A2', 30);
    await sleep(4000);
    ok(await saved(A), `tab A says Saved once it is (${await saveLine(A)})`);
    await sleep(1500);
    const field = await valueOf(A, 'textarea[aria-label="Item 2.2"]');
    ok(field === 'The 2027 budget A1 A2', `what A typed while its save was on its way is still there (“${field}”)`);
    ok(await itemOf(NEXT.id, '2.2') === 'The 2027 budget A1 A2', `and the site has all of it (“${await itemOf(NEXT.id, '2.2')}”)`);
    ok(await itemOf(NEXT.id, '1.1') === 'Roll call B' && (await valueOf(A, 'textarea[aria-label="Item 1.1"]')) === 'Roll call B', `B’s change is kept, and A shows it (“${await valueOf(A, 'textarea[aria-label="Item 1.1"]')}”)`);
    await A.close(); await B.close();
  });

  // ═══ MAJOR 2: the agenda template from two tabs ═══
  await step('The agenda template from two tabs', async () => {
    const A = await open('/admin/#board/template');
    const B = await open('/admin/#board/template');
    const sel = '.bd-template .bm-saved';
    await typeIn(A, 'textarea[aria-label="Item 1.1"]', ' (A)');
    ok(await saved(A, sel), 'tab A’s change to 1.1 saves');
    ok((await getSettings(DB)).template[0].items[0].title === 'Roll call (A)', 'the site has it');
    await typeIn(B, 'textarea[aria-label="Section 1"]', ' (B)');
    await sleep(2500);
    ok(await saved(B, sel), 'tab B’s rename of part 1 saves');
    const t = (await getSettings(DB)).template;
    ok(t[0].title === 'Call to order (B)' && t[0].items[0].title === 'Roll call (A)', `both changes are on the site (“${t[0].title}” with “${t[0].items[0].title}”)`);
    const bShows = await valueOf(B, 'textarea[aria-label="Item 1.1"]');
    ok(bShows === 'Roll call (A)', `tab B shows A’s change too (“${bShows}”)`);
    ok(!(await toasts(B)).some((x) => /Not saved/.test(x)), `and B never said Not saved (${(await toasts(B)).join(' | ') || 'no toasts'})`);
    await A.close(); await B.close();
  });

  // ═══ MAJOR 3: a save the site refuses for good ═══
  await step('On the meeting’s day before its agenda is approved, Share isn’t offered', async () => {
    for (const width of [320, 390, 1280]) {
      const p = await open(`/admin/#board/meeting/${TODAY.id}`, width);
      const offered = await has(p, '.bm-wrap button', /^Share with the board$/);
      const says = await p.evaluate(() => document.querySelector('.bm-wrap')?.innerText.replace(/\s+/g, ' ') || '');
      ok(!offered && /Once its agenda is approved, in Getting ready\./.test(says), `${width} wide: After the meeting offers no Share, and says when it can (“${(says.match(/Once its agenda[^.]*\./) || ['nothing'])[0]}”)`);
      const wide = await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      ok(wide <= 0, `${width} wide: nothing scrolls sideways (${wide}px)`);
      await p.evaluate(() => document.querySelector('.bm-wrap')?.scrollIntoView({ block: 'start' }));
      await shot(p, `03-today-wrap-${width}`);
      await p.close();
    }
  });

  await step('A stale tab’s Share the site refuses: said in words, put back, and every edit after it saves', async () => {
    // (the page thinks the agenda is approved: the tab was opened while it had an approval the site no longer has)
    const p = await open(`/admin/#board/meeting/${TODAY.id}`, 1440, { approvals: { [TODAY.id]: { by: 'Alex Rivera', at: new Date().toISOString() } } });
    const t0 = (await toasts(p)).length;
    await press(p, '.bm-wrap button', /^Share with the board$/);
    await sleep(2500);
    const said = (await toasts(p)).slice(t0);
    ok(said.some((x) => /^Not on the board page: The agenda goes to the board once it’s approved\./.test(x)), `the refusal is said in words (${said.join(' | ') || 'nothing'})`);
    ok(!said.some((x) => /^On the board page/.test(x)), 'and it never says it went on the board page');
    ok(/Only you can see it/.test(await pathStep(p, 'Board page')), `the status line says what the site has (“${await pathStep(p, 'Board page')}”)`);
    ok((await getMeeting(DB, TODAY.id)).shared === false, 'the site never shared it');
    await typeIn(p, 'textarea[aria-label="Item 1.1"]', ' after');
    ok(await saved(p), `an edit after it saves (${await saveLine(p)})`);
    ok(await itemOf(TODAY.id, '1.1') === 'Roll call after', `the site has it (“${await itemOf(TODAY.id, '1.1')}”)`);
    ok(!(await toasts(p)).slice(t0).some((x) => /Board keeps trying/.test(x)), 'and nothing kept trying the refused change');
    await shot(p, '04-share-refused');
    await p.close();
  });

  await step('A stale tab’s Mark them approved, for minutes taken out meanwhile', async () => {
    const p = await open(`/admin/#board/meeting/${STALE.id}`);
    ok(await has(p, '.bm-wrap button', /^Mark them approved$/), 'the tab has the minutes in, and offers Mark them approved');
    // (in another tab, the minutes are taken out: Undo)
    await patchMeeting(DB, STALE.id, (cur) => ({ ...cur, minutesFrom: null }), { by: FOUNDER });
    const t0 = (await toasts(p)).length;
    await press(p, '.bm-wrap button', /^Mark them approved$/);
    await answer(p, 'yes');
    await sleep(2500);
    const said = (await toasts(p)).slice(t0);
    ok(said.some((x) => /^Not marked approved: This meeting’s minutes aren’t in Board yet\. Drop them in first\./.test(x)), `the refusal is said in words (${said.join(' | ') || 'nothing'})`);
    ok(!said.some((x) => /^Marked approved/.test(x)), 'and it never says they were approved');
    const head = await p.evaluate(() => document.querySelector('.bm-wrap .bd-card-head p')?.textContent || '');
    ok(!/Done: the minutes are approved/.test(head), `After the meeting says what the site has (“${head}”)`);
    await typeIn(p, 'textarea[aria-label="Item 1.1"]', ' later');
    ok(await saved(p), `an edit after it saves (${await saveLine(p)})`);
    const m = await getMeeting(DB, STALE.id);
    ok(m.sections[0].items[0].title === 'Roll call later' && m.minutes === 'draft', `the site has the edit, and the minutes still draft (“${m.sections[0].items[0].title}”, ${m.minutes})`);
    await p.close();
  });

  await step('Take it off while saves can’t go never says it was taken off', async () => {
    const p = await open(`/admin/#board/meeting/${NEXT.id}`);
    await p.setOfflineMode(true);
    const t0 = (await toasts(p)).length;
    await press(p, '.bm-ready button', /^Take it off$/);
    await answer(p, 'yes');
    await sleep(2000);
    const said = (await toasts(p)).slice(t0);
    ok(said.some((x) => /^Still on the board page: no connection\. The board can still see it\. Take it off again once you’re back online\./.test(x)), `it says it’s still on the board page, and why (${said.join(' | ') || 'nothing'})`);
    ok(!said.some((x) => /^Taken off the board page/.test(x)), 'and never that it was taken off');
    ok(/The board can see it/.test(await pathStep(p, 'Board page')) && (await has(p, '.bm-ready button', /^Take it off$/)), `the page still shows it on the board page (“${await pathStep(p, 'Board page')}”)`);
    ok((await getMeeting(DB, NEXT.id)).shared === true, 'as the site has it');
    await p.setOfflineMode(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(1500);
    ok(/^Saved/.test(await saveLine(p)) && (await getMeeting(DB, NEXT.id)).shared === true, `back online, nothing went after it (${await saveLine(p)})`);
    await p.close();
  });

  // ═══ MAJOR 4: a meeting kept off the board page, shared from here ═══
  await step('A meeting kept off the board page, shared from here, stays shared after the next edit', async () => {
    const p = await open(`/admin/#board/meeting/${OFFPAGE.id}`);
    await press(p, '.bm-wrap button', /^Share with the board$/);
    await sleep(2000);
    let m = await getMeeting(DB, OFFPAGE.id);
    ok(m.shared === true && m.notBoard === false, `shared, and a board meeting now (shared ${m.shared}, notBoard ${m.notBoard})`);
    await typeIn(p, 'textarea[aria-label="Item 1.1"]', ' again');
    ok(await saved(p), 'the next edit saves');
    m = await getMeeting(DB, OFFPAGE.id);
    ok(m.shared === true && m.notBoard === false && m.sections[0].items[0].title === 'Catching up again', `and it’s still shared and a board meeting (shared ${m.shared}, notBoard ${m.notBoard})`);
    await p.close();
  });

  // ═══ MINOR 3: Notes for the invite shows every word ═══
  await step('Notes for the invite shows every word', async () => {
    const NOTE = 'Park in the deck on Elm Street, level 2, and take the elevator to the 4th floor. The front gate code is 4821; ring the bell if the lobby is locked. Coffee and breakfast from 7:30, with something for anyone who eats gluten free.';
    const hidden = (p) => p.evaluate(() => { const el = document.querySelector('#bd-invite-note'); return { hidden: el.scrollHeight - el.clientHeight, h: el.clientHeight }; });
    for (const [width, noFieldSizing] of [[320, false], [390, false], [1280, false], [768, true]]) {
      const p = await open(`/admin/#board/meeting/${NEXT.id}`, width, { noFieldSizing });
      const how = noFieldSizing ? ' without field-sizing' : '';
      await press(p, '.bm-facts button', /^Change when and where$/);
      await sleep(500);
      await p.evaluate((v) => { const el = document.querySelector('#bd-invite-note'); el.focus(); el.value = ''; }, NOTE);
      await typeIn(p, '#bd-invite-note', NOTE);
      await sleep(400);
      const box = await hidden(p);
      ok(box.hidden <= 1, `${width} wide${how}: all of a ${NOTE.length}-character note shows (${box.hidden}px out of sight in a ${box.h}px box)`);
      const wide = await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      ok(wide <= 0, `${width} wide${how}: nothing scrolls sideways (${wide}px)`);
      await p.evaluate(() => document.querySelector('#bd-invite-note').scrollIntoView({ block: 'center' }));
      await shot(p, `05-invite-note-${width}${noFieldSizing ? '-measured' : ''}`);
      ok(await saved(p), `${width} wide${how}: it saves`);
      if (noFieldSizing) {
        // Turned narrower, its words wrap onto more lines: measured again
        await p.setViewport({ width: 360, height: 1000 });
        await sleep(600);
        const after = await hidden(p);
        ok(after.hidden <= 1 && after.h > box.h, `without field-sizing, turned from 768 to 360 it grows to fit (${after.h}px, was ${box.h}px; ${after.hidden}px out of sight)`);
        // ...and opened again with the note in it, it's as tall as its words from the start
        await p.reload({ waitUntil: 'networkidle0' });
        await sleep(1200);
        await press(p, '.bm-facts button', /^Change when and where$/);
        await sleep(500);
        const opened = await hidden(p);
        ok(opened.hidden <= 1, `without field-sizing, opened again at 360 it shows all of it (${opened.hidden}px out of sight in a ${opened.h}px box)`);
      }
      await p.close();
    }
    ok((await getMeeting(DB, NEXT.id)).inviteNote === NOTE, 'the site has the note');
  });

  // ═══ MINOR 4: the to-do preview, when the open ones can't be emailed ═══
  await step('Home’s to-do preview says why no reminder can go', async () => {
    const p = await open('/admin/#board');
    const t0 = (await toasts(p)).length;
    await press(p, '.bh-remind button', /^Send me the email$/);
    await sleep(2000);
    const said = (await toasts(p)).slice(t0);
    ok(said.some((x) => /^No reminder can go: the open to-dos are for Kim Park and Chris Okafor, who have no email on file\./.test(x)), `it says whose they are and why (${said.join(' | ') || 'nothing'})`);
    ok(!said.some((x) => /Nobody has an open to-do/.test(x)), 'never that nobody has one, under a list of them');
    await p.close();
  });

  // ═══ MAJOR 5: Who's coming follows People → Board ═══
  await step('Who’s coming and the quorum follow People → Board for a meeting ahead', async () => {
    await regroup('taylor-nguyen', 'alumni');
    await regroup('maria-lopez', 'alumni');
    await regroup('ada-example', 'board');
    const p = await open(`/admin/#board/meeting/${NEXT.id}`, 1280);
    const coming = await p.evaluate(() => document.querySelector('.bm-coming')?.innerText.replace(/\s+/g, ' ') || '');
    ok(/Ada Example/.test(coming) && !/Taylor Nguyen|Maria Lopez/.test(coming), `Who’s coming lists the board as it is now (“${coming.slice(0, 160)}…”)`);
    ok(/3 of 5 make a quorum/.test(coming), `and the quorum is a majority of it (“${(coming.match(/\d+ of \d+ make a quorum/) || ['none'])[0]}”)`);
    await p.evaluate(() => document.querySelector('.bm-coming')?.scrollIntoView({ block: 'center' }));
    await shot(p, '06-coming');
    await p.close();
    ok((await getMeeting(DB, HELD.id)).attendance.some((x) => x.slug === 'taylor-nguyen'), 'a held meeting keeps who was on the board then');
  });

  ok(!errs.length, `no page errors (${errs.slice(0, 3).join(' | ') || 'none'})`);
} catch (err) {
  failures.push(`crashed: ${err.stack || err}`);
  console.error(err);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join('\n- ')}` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
