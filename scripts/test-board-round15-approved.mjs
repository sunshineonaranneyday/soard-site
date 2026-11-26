/**
 * test-board-round15-approved.mjs: approved minutes in Board's agenda editor, as Board QA round 15's admin tester found
 * them (Nov 26 2026: the words under an item made "fifty" with a plain save, "Saved", while their approved Word file
 * said "forty")
 * ================================================================
 * The real handlers (Board admin, the board page) behind the real sign-in middleware on an in-memory D1 and R2, as
 * scripts/test-board-round10-admin.mjs does; Resend is faked. Made-up people only. At 1280 and 820:
 *   - approved typed minutes: everything their Word file prints shows as it is, never a box to type in (decided Nov 26):
 *     the words under each item and the vote it asks for, each part's and item's name, its time and who presents it;
 *     nothing adds, moves, copies or takes out a part or item (no grips, no Add, nothing in a ⋯); a report and Board only
 *     still change; When and where shows the day, time, place and name as they are; one line
 *     says "These minutes are approved, so they can’t change here. Mark them as draft first to change them." with Mark as
 *     draft, which opens them again (the box comes back, a change saves)
 *   - the other tab: the editor open on draft minutes, approved elsewhere meanwhile, then a change typed here: its save
 *     is refused in those words, the page shows them read-only as the site has them, and what was typed stays beside
 *     them to copy; Mark as draft opens them again with it still there
 *   - the next read: the editor open with nothing typed, approved elsewhere: the tab's next read shows them read-only
 *   - nothing past the edge, no console errors
 * Screenshots land in test-results/board-round15-approved/. Exits non-zero on any failure.
 *
 *   PORT=5492 node scripts/test-board-round15-approved.mjs
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
import { saveMeeting, getMeeting, approveMinutes, saveSettings, provideBoardFinance } from '../functions/api/_board.js';
import { saveNotes, sendNotes } from '../functions/api/_board-notes.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round15-approved/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const FOUNDER = 'jane@soardcharity.com';
const TAYLOR = 'taylor.board@example.net';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', order: 3 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 4 },
};
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', TAYLOR], ['kim-park', 'kim.board@example.com']];
const BOARD = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen', 'kim-park'];
const TAYLOR_W = { member: { slug: 'taylor-nguyen', name: 'Taylor Nguyen', email: TAYLOR, seat: 'secretary' }, admin: false };
const STAY = 'These minutes are approved, so they can’t change here. Mark them as draft first to change them.';
const V1 = 'Budget passed at forty thousand.';
const V2 = 'Budget passed at fifty thousand.';
const ASKS = 'Move to approve the 2027 budget as presented.';

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
  'CREATE TABLE community (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
]) await DB.exec(sql);
for (const [slug, d] of Object.entries(PEOPLE)) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
for (const [slug, email] of EMAILS) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: [] })).run();
const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', AI: { run: async () => { throw new Error('test: Workers AI down'); } } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
  if (/^https:\/\/(admin|gmail|meet|www|oauth2)\.googleapis\.com\//.test(url)) return Response.json({ items: [], members: [], messages: [], files: [], conferenceRecords: [] });
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
await saveSettings(DB, { quorum: 3 }, FOUNDER);

// ── The meetings: held yesterday, Taylor's typed minutes sent ("forty thousand" under the budget, its vote passed) ──
const budgetOf = (m) => m.sections.flatMap((s) => s.items).find((it) => it.title === 'The 2027 budget');
async function heldTyped({ approved }) {
  const m = await saveMeeting(DB, cleanMeeting({
    date: day(-1), start: '08:00', end: '10:00', shared: true, location: 'Example Hall', address: '1 Example Way, Atlanta',
    attendance: BOARD.map((slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' })), agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
    sections: [
      { title: 'Call to order', items: [{ title: 'Roll call' }] },
      { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }, { title: 'The 2027 budget', motion: ASKS }] },
    ],
  }), { by: FOUNDER });
  const b = budgetOf(m);
  await saveNotes(env, m.id, { changes: { 'r:alex-rivera': 'present', 'r:sam-ortiz': 'present', 'r:taylor-nguyen': 'present', 'r:kim-park': 'present', [`n:${b.id}`]: V1, [`m:${b.id}`]: { by: 'Sam Ortiz', second: 'Alex Rivera', result: 'passed' } } }, TAYLOR_W);
  await sendNotes(env, m.id, TAYLOR_W);
  if (approved) await approveMinutes(env, m.id, { on: day(0), by: FOUNDER, press: true });
  const now = await getMeeting(DB, m.id);
  return { id: now.id, budget: b.id, approvedFile: now.approvedFile };
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
// (a port of its own, 5491 to 5499)
const PORT = Number(process.env.PORT ?? 5492);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── The browser ──
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
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent.replace(/\s+/g, ' ').replace(/Undo⌘Z$|Undo$/, '').trim()); } } }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.agx', { timeout: 30000 });
  await sleep(1500);
  return page;
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
const shot = async (page, name, full = true) => {
  const vp = page.viewport();
  if (full) { const h = await page.evaluate(() => Math.min(6000, document.scrollingElement.scrollHeight)); await page.setViewport({ ...vp, height: Math.max(vp.height, h) }); await sleep(250); }
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  if (full) await page.setViewport(vp);
};
/** Every box to type in that holds `text` */
const boxesWith = (page, text) => page.evaluate((t) => [...document.querySelectorAll('textarea, input, [contenteditable="true"]')].filter((x) => (x.value || x.textContent || '').includes(t) && !x.readOnly && !x.disabled).map((x) => x.getAttribute('aria-label') || x.id || x.className), text);
/** The item's ⋯, opened: the labels it offers */
async function menuOf(page, itemId) {
  await page.evaluate((id) => { const s = document.querySelector(`[data-item="${id}"] .bd-menu > summary`); s?.scrollIntoView({ block: 'center' }); s?.click(); }, itemId);
  await sleep(400);
  const labels = await page.evaluate(() => [...document.querySelectorAll('.bd-menu[open] .bd-menu__label, [popover]:popover-open .bd-menu__label')].map((x) => x.textContent.trim()));
  await page.keyboard.press('Escape');
  await sleep(250);
  return labels;
}
/** Nothing past the window's edge, and the line inside its card */
const edges = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const out = [];
  if (document.scrollingElement.scrollWidth > W + 1) out.push(`the page scrolls sideways (${document.scrollingElement.scrollWidth} > ${W})`);
  for (const el of document.querySelectorAll('.bm-stay, .bm-stay *, .agx-said, .agx-motion')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const card = el.closest('.card')?.getBoundingClientRect();
    if (r.right > W + 1 || (card && r.right > card.right + 1)) out.push(`${el.className || el.tagName} past its edge (${Math.round(r.right)})`);
  }
  return [...new Set(out)].slice(0, 6);
});
async function retype(page, from, to) {
  const h = await page.evaluateHandle((t) => [...document.querySelectorAll('textarea')].find((x) => x.value.includes(t)) || null, from);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no box holding “${from}”`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.focus();
  await page.evaluate((x, t) => { const i = x.value.indexOf(t); x.setSelectionRange(i, i + t.length); }, h, from);
  await page.keyboard.type(to);
}
const savedLine = (page) => page.evaluate(() => document.querySelector('.bm-saved')?.textContent.trim() || '');
const waitSaved = (page) => page.waitForFunction(() => /^Saved/.test(document.querySelector('.bm-saved')?.textContent.trim() || ''), { timeout: 20000 }).then(() => true, () => false);

try {
  for (const W of [1280, 820]) {
    await step(`${W}: approved typed minutes show read-only, with the line and Mark as draft; Mark as draft opens them again`, async () => {
      const ap = await heldTyped({ approved: true });
      const before = await getMeeting(DB, ap.id);
      const A = await open(`/admin/#board/meeting/${ap.id}`, { width: W });
      ok((await boxesWith(A, 'thousand')).length === 0, `no box to type in holds the approved words (${(await boxesWith(A, 'thousand')).join(', ')})`);
      const said = await A.evaluate((id) => document.querySelector(`[data-item="${id}"] .agx-said`)?.innerText.trim() || '', ap.budget);
      ok(said === V1, `the item shows the words as they are (“${said}”)`);
      const vote = await A.evaluate((id) => ({ box: !!document.querySelector(`[data-item="${id}"] textarea.agx-motion__box`), said: document.querySelector(`[data-item="${id}"] .agx-motion__said`)?.textContent.trim() || '' }), ap.budget);
      ok(!vote.box && vote.said === ASKS, `the vote it asks for shows as it is, no box (${JSON.stringify(vote)})`);
      const line = await A.evaluate(() => { const l = document.querySelector('.agx .bm-stay__line'); return l ? { text: l.querySelector('span')?.textContent.trim(), button: l.querySelector('button')?.textContent.trim() } : null; });
      ok(line?.text === STAY && line?.button === 'Mark as draft', `the line above the agenda: ${JSON.stringify(line)}`);
      const menu = await menuOf(A, ap.budget);
      ok(menu.includes('Write the report') && menu.includes('Board only') && !menu.some((x) => /^(Delete the item|Remove the background|Remove the motion|Duplicate|Ask the board to vote|Add who presents|Show live numbers…|Move up|Move down)$/.test(x)), `nothing in its ⋯ adds, moves, copies or takes out what prints; a report and Board only still there (${menu.join(', ')})`);
      const fixedView = await A.evaluate(() => ({
        boxes: document.querySelectorAll('.agx textarea.agx-item__title, .agx textarea.agx-sec__title, .agx .ag-mins input').length,
        items: [...document.querySelectorAll('.agx .agx-item__title.is-fixed')].map((x) => x.textContent.trim()),
        parts: [...document.querySelectorAll('.agx .agx-sec__title.is-fixed')].map((x) => x.textContent.trim()),
        who: [...document.querySelectorAll('.agx .agx-who-fixed')].map((x) => x.textContent.trim()),
        pickers: document.querySelectorAll('.agx .bd-who').length,
        grips: document.querySelectorAll('.agx .agx-grip').length,
        adds: [...document.querySelectorAll('.agx .ag-add')].map((x) => x.textContent.trim()),
        partMenus: document.querySelectorAll('.agx .agx-sec__head .bd-menu').length,
      }));
      ok(fixedView.boxes === 0 && fixedView.pickers === 0, `no box for a name, a part's time or who presents (${fixedView.boxes} boxes, ${fixedView.pickers} pickers)`);
      ok(JSON.stringify(fixedView.items) === JSON.stringify(['Roll call', 'Year to date', 'The 2027 budget']) && JSON.stringify(fixedView.parts) === JSON.stringify(['Call to order', 'Finance']) && JSON.stringify(fixedView.who) === JSON.stringify(['Sam Ortiz']), `the names and who presents show as they are (${JSON.stringify(fixedView)})`);
      ok(fixedView.grips === 0 && fixedView.adds.length === 0 && fixedView.partMenus === 0, `nothing adds, moves or takes out a part or item (${fixedView.grips} grips, ${fixedView.adds.join(', ') || 'no Add'}, ${fixedView.partMenus} part menus)`);
      await sleep(1500);
      ok((await getMeeting(DB, ap.id)).updatedAt === before.updatedAt, 'the page saved nothing by itself');
      // (what the file never prints still changes: Board only, saved and said)
      await A.evaluate((id) => { const s = document.querySelector(`[data-item="${id}"] .bd-menu > summary`); s?.click(); }, ap.budget);
      await sleep(300);
      const pressed = await A.evaluate(() => { const b = [...document.querySelectorAll('.bd-menu[open] .bd-menu__label, [popover]:popover-open .bd-menu__label')].find((x) => x.textContent.trim() === 'Board only')?.closest('button'); b?.click(); return !!b; });
      ok(pressed, 'setup: Board only pressed in its ⋯');
      // (saved by itself a moment later: the site's copy changes, and the line says Saved)
      const t0 = Date.now();
      while (Date.now() - t0 < 15000 && (await getMeeting(DB, ap.id)).updatedAt === before.updatedAt) await sleep(250);
      ok(await waitSaved(A), `Board only saves (${await savedLine(A)})`);
      const only = await getMeeting(DB, ap.id);
      ok(only.sections.flatMap((s) => s.items).find((it) => it.id === ap.budget)?.confidential === true && only.minutes === 'approved', 'the site has it Board only, the minutes still approved');
      // When and where
      await A.evaluate(() => document.getElementById('bm-where-toggle')?.click());
      await A.waitForSelector('#bm-where', { timeout: 5000 });
      const where = await A.evaluate(() => ({
        inputs: [...document.querySelectorAll('#bm-where input')].map((x) => x.id),
        fixed: [...document.querySelectorAll('#bm-where .bm-fixed')].map((x) => x.textContent.trim()),
        line: document.querySelector('#bm-where .bm-stay__line span')?.textContent.trim() || '',
        note: !!document.querySelector('#bd-invite-note'),
      }));
      ok(!where.inputs.some((x) => ['bd-date', 'bd-start', 'bd-end', 'bd-loc', 'bd-addr', 'bd-title'].includes(x)), `When and where has no box for the day, time, place or name (${where.inputs.join(', ')})`);
      ok(where.fixed.includes('Example Hall') && where.fixed.includes('8:00 AM') && where.fixed.some((x) => /Board Meeting/.test(x)), `…and shows them as they are (${where.fixed.join(' | ')})`);
      ok(where.line === STAY && where.note, `…with the line, and the invite’s notes still to type (${where.line})`);
      const e1 = await edges(A);
      ok(!e1.length, `nothing past the edge (${e1.join('; ')})`);
      await shot(A, `${W}-1-approved-where`, false);
      await A.evaluate(() => document.getElementById('bm-where-toggle')?.click());
      await sleep(400);
      await A.evaluate(() => document.querySelector('.agx .bm-stay')?.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await shot(A, `${W}-2-approved-agenda`, false);
      await sleep(2500);
      const still = await getMeeting(DB, ap.id);
      ok(still.updatedAt === only.updatedAt, 'nothing saved by itself after that');
      // Mark as draft, from the line
      await A.evaluate(() => [...document.querySelectorAll('.agx .bm-stay__line button')].find((b) => /Mark as draft/.test(b.textContent))?.click());
      await A.waitForFunction(() => (window.__toasts || []).some((t) => /Back to draft minutes/.test(t)), { timeout: 15000 }).catch(() => {});
      ok((await toasts(A)).some((t) => /Back to draft minutes/.test(t)), `said once the site has it (${(await toasts(A)).join(' | ')})`);
      ok((await getMeeting(DB, ap.id)).minutes === 'draft', 'the site has them as draft');
      ok(!(await A.$('.agx .bm-stay__line')), 'the line is gone');
      ok((await boxesWith(A, 'forty thousand')).length === 1, 'the words are in a box to type in again');
      const unlocked = await A.evaluate(() => ({ names: document.querySelectorAll('.agx textarea.agx-item__title').length, grips: document.querySelectorAll('.agx .agx-grip').length, adds: document.querySelectorAll('.agx .ag-add').length }));
      ok(unlocked.names === 3 && unlocked.grips > 0 && unlocked.adds > 0, `names, moving and adding are back (${JSON.stringify(unlocked)})`);
      await retype(A, 'forty', 'fifty');
      ok(await waitSaved(A), `saved (${await savedLine(A)})`);
      const after = await getMeeting(DB, ap.id);
      const words = after.sections.flatMap((s) => s.items).find((it) => it.id === ap.budget)?.notes;
      ok(words === V2 && after.minutes === 'draft', `the change is on the site, as draft minutes (“${words}”, ${after.minutes})`);
      await shot(A, `${W}-3-drafted`, false);
      await A.close();
    });

    await step(`${W}: the other tab: draft minutes open here, approved elsewhere meanwhile, then a change typed here: refused in the decided words, shown read-only as the site has them, what was typed kept to copy`, async () => {
      const dr = await heldTyped({ approved: false });
      const A = await open(`/admin/#board/meeting/${dr.id}`, { width: W });
      ok((await boxesWith(A, 'forty thousand')).length === 1, 'setup: draft minutes, the words in a box to type in');
      await approveMinutes(env, dr.id, { on: day(0), by: FOUNDER, press: true });
      const approved = await getMeeting(DB, dr.id);
      await retype(A, 'forty', 'fifty');
      await retype(A, 'Year to date', 'Year to date, through October');
      await A.waitForFunction((s) => (window.__toasts || []).some((t) => t.includes(s)), { timeout: 20000 }, STAY).catch(() => {});
      const said = await toasts(A);
      ok(said.includes(`Not saved: ${STAY}`), `its save is refused in the decided words (${said.join(' | ')})`);
      await sleep(1500);
      const site = await getMeeting(DB, dr.id);
      const words = site.sections.flatMap((s) => s.items).find((it) => it.id === dr.budget)?.notes;
      const ytd = site.sections.flatMap((x) => x.items).find((it) => it.title.startsWith('Year to date'))?.title;
      ok(site.minutes === 'approved' && words === V1 && ytd === 'Year to date' && site.updatedAt === approved.updatedAt && site.approvedFile === approved.approvedFile, `nothing changed on the site (${site.minutes}, “${words}”, “${ytd}”)`);
      ok((await boxesWith(A, 'thousand')).length === 0, 'read-only now: no box to type in holds them');
      const view = await A.evaluate((id) => document.querySelector(`[data-item="${id}"] .agx-said`)?.innerText.trim() || '', dr.budget);
      ok(view === V1, `it shows them as the site has them (“${view}”)`);
      const kept = await A.evaluate(() => [...document.querySelectorAll('.bm-stay__piece')].map((x) => ({ label: x.querySelector('.form-label')?.textContent.trim(), text: x.querySelector('.bm-stay__text')?.textContent.trim(), copy: x.querySelector('button')?.textContent.trim() })));
      const want = [{ label: 'The item named Year to date', text: 'Year to date, through October', copy: 'Copy' }, { label: 'Under The 2027 budget', text: V2, copy: 'Copy' }];
      ok(JSON.stringify(kept) === JSON.stringify(want), `what was typed stays beside them, to copy (${JSON.stringify(kept)})`);
      const named = await A.evaluate(() => [...document.querySelectorAll('.agx .agx-item__title.is-fixed')].map((x) => x.textContent.trim()));
      ok(JSON.stringify(named) === JSON.stringify(['Roll call', 'Year to date', 'The 2027 budget']), `the names as the site has them (${named.join(', ')})`);
      ok(/^Saved/.test(await savedLine(A)), `nothing left waiting to save (${await savedLine(A)})`);
      const e2 = await edges(A);
      ok(!e2.length, `nothing past the edge (${e2.join('; ')})`);
      await A.evaluate(() => document.querySelector('.agx .bm-stay')?.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await shot(A, `${W}-4-other-tab`, false);
      // Mark as draft: open again, what was typed still there to paste
      await A.evaluate(() => [...document.querySelectorAll('.agx .bm-stay__line button')].find((b) => /Mark as draft/.test(b.textContent))?.click());
      await A.waitForFunction(() => (window.__toasts || []).some((t) => /Back to draft minutes/.test(t)), { timeout: 15000 }).catch(() => {});
      ok((await getMeeting(DB, dr.id)).minutes === 'draft', 'Mark as draft: the site has them as draft');
      ok((await boxesWith(A, 'forty thousand')).length === 1, 'the box is back');
      ok((await A.$$('.bm-stay__piece')).length === 2, 'what was typed is still there to paste');
      await A.evaluate(() => document.querySelector('.bm-stay__done')?.click());
      await sleep(300);
      ok(!(await A.$('.bm-stay')), 'Done with these puts it away');
      await A.close();
    });

    await step(`${W}: the next read: nothing typed here, approved elsewhere: the tab’s next read shows them read-only`, async () => {
      const dr = await heldTyped({ approved: false });
      const A = await open(`/admin/#board/meeting/${dr.id}`, { width: W });
      ok((await boxesWith(A, 'forty thousand')).length === 1, 'setup: draft minutes, the words in a box to type in');
      await approveMinutes(env, dr.id, { on: day(0), by: FOUNDER, press: true });
      // (the window given the focus: Board's data read again)
      await A.evaluate(() => window.dispatchEvent(new Event('focus')));
      await A.waitForSelector('.agx .bm-stay__line', { timeout: 15000 }).catch(() => {});
      ok(!!(await A.$('.agx .bm-stay__line')), 'the line shows');
      ok((await boxesWith(A, 'thousand')).length === 0, 'no box to type in holds them');
      ok((await toasts(A)).every((t) => !/Not saved/.test(t)), `nothing said as not saved (${(await toasts(A)).join(' | ')})`);
      await A.close();
    });
  }
  ok(!errs.length, `no console errors (${errs.slice(0, 4).join(' | ')})`);
} finally {
  await browser.close();
  server.close();
  globalThis.fetch = realFetch;
}
console.log(failures.length ? `\n${failures.length} failed:\n${failures.map((f) => `  - ${f}`).join('\n')}` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
