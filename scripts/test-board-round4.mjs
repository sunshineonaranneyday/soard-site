/**
 * test-board-round4.mjs: Board admin's meeting editor and agenda template, as QA round 4 found them (Nov 21 2026)
 * ================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round3.mjs
 * does; Google and Resend are faked. Made-up people only.
 *   - A-B1: a tab opened before another tab's Take it off, then typed in: it merges, saves what was typed, shows the
 *     meeting off the board page, in a handful of requests and toasts (never a loop); the same after the site itself
 *     takes it off; a refusal put back as it went, or a save the site answered no to, is never sent again by itself
 *     (only Try again or a new change sends it)
 *   - A-M1: the agenda template says Saved only for what the site keeps: a second live list on an item and an item in a
 *     part not named yet are kept, after a reload too; an answer missing part of what went says Not saved, not Saved
 *   - A-m1: a "not a board meeting" on its day, agenda not approved: no Share, and the words a board meeting gets
 *   - A-m5: approved minutes off the board page say they're approved and who can see them, never "draft" or "on the board
 *     page"
 *   - A-m6: a tab open while People → Board changes: one save, Who's coming as the site has it, Saved, and a reload asks
 *     nothing
 * Screenshots land in test-results/board-round4/. Exits non-zero on any failure.
 *
 *   PORT=4611 node scripts/test-board-round4.mjs
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
const OUT = join(ROOT, 'test-results/board-round4/');
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
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 4 },
  'ada-example': { name: 'Ada Example', group: 'advisory', title: 'Advisory Board Member', order: 1 },
};
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net']];
const BOARD = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen', 'kim-park'];

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
/** People → Board changed, as an admin's save on People leaves it (leaving is People's "Move to alumni": the status) */
const regroup = async (slug, how) => {
  const row = await DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first();
  const d = { ...JSON.parse(row.data), ...(how === 'alumni' ? { status: 'alumni' } : { group: how, status: 'active' }) };
  await DB.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind(d.group, JSON.stringify(d), slug).run();
};

// ── The outside world, faked ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }),
  DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test',
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
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
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Welcome' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
/** On the board page with its agenda not approved, as the QA seed's next meeting is (server code put it there) */
const sharedAhead = async (days) => { const m = await make(day(days)); return patchMeeting(DB, m.id, (cur) => ({ ...cur, shared: true })); };
const NEXT = await sharedAhead(9);
const UNSHARE = await sharedAhead(12);
const OLDNO = await sharedAhead(25);
const FAIL = await make(day(20));
// Today, ending late (still on), "not a board meeting" (the calendar's older rules), its agenda not approved
const OFFTODAY = await make(day(0), { end: '23:59', title: 'Coffee with the chair' });
await patchMeeting(DB, OFFTODAY.id, (cur) => ({ ...cur, notBoard: true, shared: false }));
// Held, its minutes in and approved, off the board page
const APPROVED = await make(day(-40), { minutes: 'approved', approvedOn: day(-10) });
await patchMeeting(DB, APPROVED.id, (cur) => ({ ...cur, shared: false, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() } }));
// Ahead, for People → Board changing while it's open
const ROSTER = await make(day(15), { shared: true });
await agendaApproved(DB, ROSTER.id);

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
// (a port of its own, 4611 to 4613, or any free one with PORT=0)
const PORT = Number(process.env.PORT ?? 4611);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── The browser ──
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 400000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const errs = [];
/** A tab as the founder; each page counts the saves it sends (`page.saves`), its toasts are in window.__toasts */
async function open(path, width = 1440) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width, height: 1000 });
  await page.setExtraHTTPHeaders({ 'x-test-user': FOUNDER });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|fonts\.gstatic|x-test-user/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  page.saves = { meeting: 0, settings: 0 };
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !/\/api\/board-admin/.test(r.url())) return;
    const body = r.postData() || '';
    if (/"action":"save-meeting"/.test(body)) page.saves.meeting += 1;
    if (/"action":"save-settings"/.test(body)) page.saves.settings += 1;
  });
  page.dialogs = [];
  page.on('dialog', async (d) => { page.dialogs.push(d.type()); await d.accept().catch(() => {}); });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent.replace(/\s+/g, ' ').trim()); } } }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  return page;
}
/**
 * Answers the page's next `n` POSTs whose body matches `re` with `answer(body)` (→ { status, json }), never reaching the
 * site; or, with `alter`, lets them reach the site and changes the site's JSON answer on its way back
 */
async function rule(page, re, { n = 1, answer = null, alter = null } = {}) {
  const cdp = await page.createCDPSession();
  const st = { n, hits: 0 };
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/board-admin*', requestStage: answer ? 'Request' : 'Response' }] });
  cdp.on('Fetch.requestPaused', async (ev) => {
    const body = ev.request.postData || '';
    const hit = ev.request.method === 'POST' && st.n > 0 && re.test(body);
    try {
      if (!hit) { await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }); return; }
      st.n -= 1;
      st.hits += 1;
      if (answer) {
        const a = await answer(body);
        await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: a.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(a.json)).toString('base64') });
        return;
      }
      const got = await cdp.send('Fetch.getResponseBody', { requestId: ev.requestId });
      const j = JSON.parse(got.base64Encoded ? Buffer.from(got.body, 'base64').toString('utf8') : got.body);
      await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: ev.responseStatusCode, responseHeaders: ev.responseHeaders, body: Buffer.from(JSON.stringify(alter(j))).toString('base64') });
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
const saved = (page, sel = '.bm-saved') => page.waitForFunction((s) => /^Saved/.test(document.querySelector(s)?.textContent.trim() || ''), { timeout: 15000 }, sel).then(() => true, () => false);
const saveLine = (page) => page.evaluate(() => document.querySelector('.bm-saved')?.textContent.replace(/\s+/g, ' ').trim() || '');
async function typeIn(page, sel, words) {
  await page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, sel);
  await page.keyboard.type(words);
}
async function press(page, sel, re) {
  const h = await page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())) || null, sel, re.source);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no button “${re.source}” in ${sel}`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.click();
}
const has = (page, sel, re) => page.evaluate((s, src) => [...document.querySelectorAll(s)].some((x) => new RegExp(src).test(x.textContent.trim())), sel, re.source);
async function answer(page, which) {
  await page.waitForSelector('.ask-overlay [data-ask]', { timeout: 8000 });
  await page.click(`.ask-overlay [data-ask="${which}"]`);
  await sleep(300);
}
const pathStep = (page, title) => page.evaluate((t) => [...document.querySelectorAll('.bm-path__step')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()).find((s) => s.startsWith(t)) || '', title);
const itemOf = async (id, label) => { const m = await getMeeting(DB, id); const [si, ii] = label.split('.').map((x) => Number(x) - 1); return m.sections[si]?.items[ii]?.title; };
const tasks = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} .bm-task`)].map((t) => `${t.querySelector('.bm-task__t')?.textContent.trim()} | ${t.querySelector('.bm-task__s')?.textContent.trim() || ''}`), sel);
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const NOT_APPROVED = 'The agenda goes to the board once it’s approved';

try {
  // ═══ A-B1 (blocker): a stale tab after another tab's Take it off ═══
  await step('A-B1: a tab opened before another tab’s Take it off merges, saves what’s typed, and never loops', async () => {
    const A = await open(`/admin/#board/meeting/${NEXT.id}`);
    const B = await open(`/admin/#board/meeting/${NEXT.id}`);
    await press(B, '.bm-ready button', /^Take it off$/);
    await answer(B, 'yes');
    await sleep(2000);
    ok((await getMeeting(DB, NEXT.id)).shared === false, 'tab B took it off the board page');
    await typeIn(A, 'textarea[aria-label="Item 1.1"]', ' (A)');
    await sleep(8000);
    const m = await getMeeting(DB, NEXT.id);
    const said = await toasts(A);
    ok(m.sections[0].items[0].title === 'Roll call (A)' && m.shared === false, `the site has A’s words and keeps it off the board page (“${m.sections[0].items[0].title}”, shared ${m.shared})`);
    ok(A.saves.meeting <= 3, `a handful of saves at most (${A.saves.meeting})`);
    ok(said.length <= 2 && !said.some((x) => /Not on the board page|Not saved/.test(x)), `no refusal and no flood of toasts (${said.length}: ${said.slice(0, 3).join(' | ') || 'none'})`);
    ok(/^Saved/.test(await saveLine(A)), `A says Saved (${await saveLine(A)})`);
    ok(/Only you can see it/.test(await pathStep(A, 'Board page')), `A’s status line says only you can see it (“${await pathStep(A, 'Board page')}”)`);
    await shot(A, '01-stale-takeoff-A');
    await A.close(); await B.close();
  });

  await step('A-B1: the same after the site itself takes it off the board page', async () => {
    const A = await open(`/admin/#board/meeting/${UNSHARE.id}`);
    await patchMeeting(DB, UNSHARE.id, (cur) => ({ ...cur, shared: false }));
    await typeIn(A, 'textarea[aria-label="Item 1.2"]', ' (A)');
    await sleep(8000);
    const m = await getMeeting(DB, UNSHARE.id);
    ok(m.sections[0].items[1].title === 'Welcome (A)' && m.shared === false, `saved, off the board page (“${m.sections[0].items[1].title}”, shared ${m.shared})`);
    ok(A.saves.meeting <= 3 && (await toasts(A)).length <= 2, `a handful of saves and toasts (${A.saves.meeting} saves, ${(await toasts(A)).length} toasts)`);
    ok(/^Saved/.test(await saveLine(A)) && /Only you can see it/.test(await pathStep(A, 'Board page')), `Saved, and only you can see it (${await saveLine(A)}; “${await pathStep(A, 'Board page')}”)`);
    await A.close();
  });

  await step('A-B1: a refusal put back as it went is never sent again by itself', async () => {
    // (the site refusing a share the tab never made, putting it back as the tab had it: what the stale tab got before)
    const A = await open(`/admin/#board/meeting/${OLDNO.id}`);
    const r = await rule(A, /"action":"save-meeting"/, { n: 99, answer: () => ({ status: 409, json: { ok: false, error: NOT_APPROVED, refused: ['shared'] } }) });
    await typeIn(A, 'textarea[aria-label="Item 1.1"]', ' (A)');
    await sleep(6000);
    const said = await toasts(A);
    ok(r.hits <= 2, `sent at most twice, never in a loop (${r.hits} in 6 s)`);
    ok(said.length <= 2, `said once or twice, never a flood (${said.length}: ${said.slice(0, 2).join(' | ')})`);
    ok(/^Not saved/.test(await saveLine(A)) && (await has(A, '.bm-saved button', /^Try again$/)), `the line says Not saved, with Try again (${await saveLine(A)})`);
    const before = r.hits;
    await press(A, '.bm-saved button', /^Try again$/);
    await sleep(1500);
    ok(r.hits === before + 1, `Try again sends it once (${r.hits - before})`);
    await A.close();
  });

  await step('A-B1: a save the site answered no to goes again only with a new change or Try again', async () => {
    const A = await open(`/admin/#board/meeting/${FAIL.id}`);
    const r = await rule(A, /"action":"save-meeting"/, { n: 2, answer: () => ({ status: 422, json: { ok: false, error: 'The site couldn’t take that just now' } }) });
    await typeIn(A, 'textarea[aria-label="Item 1.1"]', ' one');
    await sleep(6000);
    ok(r.hits === 1, `sent once, never again by itself (${r.hits} in 6 s)`);
    const said = (await toasts(A)).join(' | ');
    ok(/Not saved: The site couldn’t take that just now\. It goes again once you change something or press Try again\./.test(said) && !/keeps trying/.test(said), `said in words, never “keeps trying” (${said})`);
    await press(A, '.bm-saved button', /^Try again$/);
    await sleep(1500);
    ok(r.hits === 2, `Try again sends it (${r.hits})`);
    await typeIn(A, 'textarea[aria-label="Item 1.1"]', ' two');
    ok(await saved(A), `a new change sends it all, and it saves (${await saveLine(A)})`);
    ok(await itemOf(FAIL.id, '1.1') === 'Roll call one two', `the site has all of it (“${await itemOf(FAIL.id, '1.1')}”)`);
    await A.close();
  });

  await step('A-B1: a save the site itself failed on (a 5xx in its own words) goes again by itself, a while later, and saves', async () => {
    const A = await open(`/admin/#board/meeting/${FAIL.id}`);
    const r = await rule(A, /"action":"save-meeting"/, { n: 1, answer: () => ({ status: 500, json: { ok: false, error: 'The site’s database didn’t answer just now. Try again in a moment.' } }) });
    await typeIn(A, 'textarea[aria-label="Item 1.1"]', ' three');
    ok(await saved(A), `it saves by itself once the site answers (${await saveLine(A)}; ${r.hits} sent)`);
    const said = (await toasts(A)).join(' | ');
    ok(/Board keeps trying/.test(said), `said as Board keeps trying (${said})`);
    ok(await itemOf(FAIL.id, '1.1') === 'Roll call one two three', `the site has all of it (“${await itemOf(FAIL.id, '1.1')}”)`);
    await A.close();
  });

  // ═══ A-M1: the agenda template keeps what it says it saved ═══
  await step('A-M1: the agenda template keeps a second live list and an item in a part not named yet, after a reload too', async () => {
    const A = await open('/admin/#board/template');
    const sel = '.bd-template .bm-saved';
    const fin = async () => (await getSettings(DB)).template.flatMap((s) => s.items).find((i) => i.title === 'Financial');
    const showsOn = (page, title) => page.evaluate((t) => [...document.querySelectorAll('.agx-item')].find((x) => x.querySelector('.agx-item__title')?.value === t)?.querySelector('.bd-showpick .bd-pop__btn')?.textContent.replace(/\s+/g, ' ').trim() || '', title);
    // (a) Financial shows The money: add Upcoming reveals from its Shows picker
    await A.evaluate(() => { const li = [...document.querySelectorAll('.agx-item')].find((x) => x.querySelector('.agx-item__title')?.value === 'Financial'); const b = li?.querySelector('.bd-showpick .bd-pop__btn'); b?.scrollIntoView({ block: 'center' }); b?.click(); });
    await sleep(500);
    const picked = await A.evaluate(() => { const o = [...document.querySelectorAll('.bd-showpick .bd-picker__opt')].find((x) => /reveals/i.test(x.textContent) && x.getAttribute('aria-selected') === 'false'); o?.click(); return !!o; });
    await sleep(300);
    await A.evaluate(() => [...document.querySelectorAll('.bd-showpick .btn')].find((x) => x.textContent.trim() === 'Done')?.click());
    ok(picked && await saved(A, sel), `it says Saved (${await A.$eval(sel, (e) => e.textContent.trim())})`);
    const f = await fin();
    ok(f.live === 'cash' && JSON.stringify(f.also) === '["reveals"]', `the site keeps both (${JSON.stringify(f)})`);
    // (b) + Add a part, then only the item's name
    await A.evaluate(() => document.querySelector('.agx-addsec')?.click());
    await sleep(800);
    await A.evaluate(() => { const secs = document.querySelectorAll('.agx-sec'); const el = secs[secs.length - 1].querySelector('.agx-item__title'); el.scrollIntoView({ block: 'center' }); el.focus(); });
    await A.keyboard.type('Vote on the 2027 calendar');
    await sleep(1500);
    ok(await saved(A, sel), `it says Saved (${await A.$eval(sel, (e) => e.textContent.trim())})`);
    const t = (await getSettings(DB)).template;
    ok(t.some((s) => !s.title && s.items.some((i) => i.title === 'Vote on the 2027 calendar')), `the site keeps the part not named yet, with its item (parts: ${t.map((s) => s.title || '(not named)').join(', ')})`);
    await shot(A, '02-template-before-reload');
    await A.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    ok(/The money/.test(await showsOn(A, 'Financial')) && /reveals/i.test(await showsOn(A, 'Financial')), `after a reload, Financial shows both (“${await showsOn(A, 'Financial')}”)`);
    ok(await A.evaluate(() => [...document.querySelectorAll('.agx-item__title')].some((x) => x.value === 'Vote on the 2027 calendar')), 'after a reload, the new item is there');
    ok(!A.dialogs.length, `the reload asked nothing (${A.dialogs.join(', ') || 'nothing'})`);
    await A.close();
  });

  await step('A-M1: an answer missing part of what went says Not saved, never Saved, and isn’t sent again by itself', async () => {
    const A = await open('/admin/#board/template');
    const sel = '.bd-template .bm-saved';
    // (the site's answer, its live lists after the first taken out on the way back: as if it hadn't kept them)
    const r = await rule(A, /"action":"save-settings"/, { n: 1, alter: (j) => ({ ...j, settings: { ...j.settings, template: j.settings.template.map((s) => ({ ...s, items: s.items.map(({ also, ...it }) => it) })) } }) });
    await A.evaluate(() => { const li = [...document.querySelectorAll('.agx-item')].find((x) => x.querySelector('.agx-item__title')?.value === 'Events'); const b = li?.querySelector('.bd-showpick .bd-pop__btn'); b?.scrollIntoView({ block: 'center' }); b?.click(); });
    await sleep(500);
    await A.evaluate(() => [...document.querySelectorAll('.bd-showpick .bd-picker__opt')].find((x) => /meetings/i.test(x.textContent) && x.getAttribute('aria-selected') === 'false')?.click());
    await sleep(300);
    await A.evaluate(() => [...document.querySelectorAll('.bd-showpick .btn')].find((x) => x.textContent.trim() === 'Done')?.click());
    await sleep(6000);
    const line = await A.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
    const said = (await toasts(A)).join(' | ');
    ok(r.hits === 1 && /^Not saved/.test(line) && /Try again/.test(line), `the line says Not saved, with Try again (“${line}”)`);
    ok(/Not saved: the site didn’t keep all of this change\./.test(said), `and says so (${said || 'nothing'})`);
    ok(A.saves.settings === 1, `sent once, never again by itself (${A.saves.settings})`);
    await press(A, sel.replace(' .bm-saved', ' .bm-saved button'), /^Try again$/);
    ok(await saved(A, sel) && A.saves.settings === 2, `Try again sends it, and the site's whole answer says Saved (${A.saves.settings} sent)`);
    await A.close();
  });

  // ═══ A-m1: "not a board meeting" on its day ═══
  await step('A-m1: a “not a board meeting” on its day, its agenda not approved, offers no Share, with the words a board meeting gets', async () => {
    for (const width of [1440, 390]) {
      const p = await open(`/admin/#board/meeting/${OFFTODAY.id}`, width);
      const offered = await has(p, '.bm-wrap button', /^Share with the board$/);
      const says = await p.evaluate(() => document.querySelector('.bm-wrap')?.innerText.replace(/\s+/g, ' ') || '');
      ok(!offered && /Once its agenda is approved, in Getting ready\./.test(says), `${width} wide: no Share, and it says when it can go (“${(says.match(/Once its agenda[^.]*\./) || ['nothing'])[0]}”)`);
      ok(await has(p, '.bm-ready button', /^Approve the agenda$/), `${width} wide: Getting ready offers Approve the agenda`);
      const wide = await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      ok(wide <= 0, `${width} wide: nothing scrolls sideways (${wide}px)`);
      await p.evaluate(() => document.querySelector('.bm-wrap')?.scrollIntoView({ block: 'start' }));
      await shot(p, `03-notboard-today-${width}`);
      ok(!(await toasts(p)).length, `${width} wide: nothing refused (${(await toasts(p)).join(' | ') || 'no toasts'})`);
      await p.close();
    }
    ok((await getMeeting(DB, OFFTODAY.id)).shared === false, 'the site still has it off the board page');
  });

  // ═══ A-m5: approved minutes off the board page ═══
  await step('A-m5: approved minutes off the board page say they’re approved and who can see them', async () => {
    for (const width of [1440, 390]) {
      const p = await open(`/admin/#board/meeting/${APPROVED.id}`, width);
      const t = await tasks(p, '.bm-wrap');
      const share = t.find((x) => /^Share them with the board/.test(x)) || '';
      const appr = t.find((x) => /^Approved/.test(x)) || '';
      ok(/They’re approved, and only you( and \w+)* can see them until they’re shared\./.test(share) && !/draft/i.test(share), `${width} wide: Share says they’re approved, and who can see them (“${share}”)`);
      ok(/Once they’re shared, the board sees them as approved\./.test(appr) && !/on the board page/.test(appr), `${width} wide: Approved never says it’s on the board page (“${appr}”)`);
      ok(/Only you can see it/.test(await pathStep(p, 'Board page')), `${width} wide: as the status line says (“${await pathStep(p, 'Board page')}”)`);
      const head = await p.evaluate(() => [...document.querySelectorAll('.bd-card-head')].find((h) => /After the meeting/.test(h.textContent))?.querySelector('p')?.textContent.trim() || '');
      ok(head === 'The minutes are approved. Share them with the board next.', `${width} wide: After the meeting says what’s next, never “Done” (“${head}”)`);
      await p.evaluate(() => document.querySelector('.bm-wrap')?.scrollIntoView({ block: 'start' }));
      await shot(p, `04-approved-unshared-${width}`);
      await p.close();
    }
  });

  // ═══ A-m6: People → Board changes while a meeting ahead is open ═══
  await step('A-m6: a tab open while People → Board changes: one save, Who’s coming as the site has it, Saved, and a reload asks nothing', async () => {
    const A = await open(`/admin/#board/meeting/${ROSTER.id}`, 1280);
    await regroup('taylor-nguyen', 'alumni');
    await regroup('ada-example', 'board');
    await typeIn(A, 'textarea[aria-label="Item 1.1"]', ' x');
    await sleep(6000);
    ok(A.saves.meeting === 1, `one save (${A.saves.meeting})`);
    ok(/^Saved/.test(await saveLine(A)), `it says Saved (${await saveLine(A)})`);
    const coming = await A.evaluate(() => document.querySelector('.bm-coming dl')?.innerText.replace(/\s+/g, ' ') || '');
    ok(/Ada Example/.test(coming) && !/Taylor Nguyen/.test(coming), `Who’s coming has Ada, not Taylor (“${coming}”)`);
    await shot(A, '05-roster-coming');
    await A.reload({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
    ok(!A.dialogs.length, `reloading asks nothing (${A.dialogs.join(', ') || 'nothing'})`);
    ok(await itemOf(ROSTER.id, '1.1') === 'Roll call x', 'the site has the edit');
    await A.close();
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
