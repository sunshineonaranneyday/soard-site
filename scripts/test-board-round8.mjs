/**
 * test-board-round8.mjs: a rename on People while Board is open, as Board QA round 8 found it (Nov 21 2026)
 * ================================================================
 * The real handlers (Board admin, the board page, People's rename) behind the real sign-in middleware on an in-memory
 * D1 and R2, as scripts/test-board-round7.mjs does; Google and Resend are faked. Made-up people only.
 *   - T1: the founder's agenda template page, open while People renames the member who presents Financial, saves an
 *     edit: what's saved keeps the new address (the page merged with the rename, nothing asked) and the edit, the
 *     meeting on the template and a meeting made from it name the new address, and a presenter picked on that page
 *     afterwards goes in beside the new address, never the old one
 *   - T2: a board member opening the board page at the moment People renames them sees their board page, never "This
 *     page is for SOARD's board" (the rename lands between the sign-in's reads, every time)
 * Screenshots land in test-results/board-round8/. Exits non-zero on any failure.
 *
 *   PORT=4791 node scripts/test-board-round8.mjs
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
import * as renameContent from '../functions/api/rename-content.js';
import { getMeeting, getSettings, provideBoardFinance } from '../functions/api/_board.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round8/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', order: 3 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 4 },
};
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net']];

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

const DB0 = await createD1();
/**
 * T2's race, every time (`racing`): People's rename of Alex (the record and its private email in one write, as
 * ./functions/api/rename-content.js makes it) lands straight after each read of the private emails, before anything else
 * reads. The read is made when it's called (the shim's is), so nothing can come between it and the rename
 */
let racing = false;
let alexAt = 'alex-rivera';
let renames = 0;
const renameNow = () => {
  const to = `alex-rivera-r${++renames}`;
  const db = DB0._db;
  db.run('BEGIN');
  db.run("UPDATE team SET slug = ?, data = json_set(data, '$.slug', ?) WHERE slug = ?", [to, to, alexAt]);
  db.run('UPDATE reveal_board_emails SET slug = ? WHERE slug = ?', [to, alexAt]);
  db.run('COMMIT');
  alexAt = to;
};
const wrapStmt = (st, sql) => ({
  _sql: st._sql, _params: st._params, bind: (...p) => wrapStmt(st.bind(...p), sql),
  run: () => st.run(),
  all: () => { const r = st.all(); if (racing && /reveal_board_emails/.test(sql)) renameNow(); return r; },
  first: (c) => { const r = st.first(c); if (racing && /reveal_board_emails/.test(sql)) renameNow(); return r; },
});
const DB = { prepare: (sql) => wrapStmt(DB0.prepare(sql), sql), batch: (s) => DB0.batch(s), exec: (sql) => DB0.exec(sql), _db: DB0._db };
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

const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test' };
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

// ── The server ──
const ROUTES = { '/api/board-admin': boardAdmin, '/api/board-portal': boardPortal, '/api/board-file': boardFile, '/api/rename-content': renameContent };
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
        if (url.pathname === '/api/list-content' && /team/.test(url.searchParams.get('dir') || '')) {
          const rows = (await DB.prepare('SELECT slug, data FROM team').all()).results || [];
          return Response.json({ success: true, items: rows.map((r) => ({ name: `${r.slug}.json`, content: { ...JSON.parse(r.data), slug: r.slug } })), pages: 1 });
        }
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
// (a port of its own, 4791 to 4799, or any free one with PORT=0)
const PORT = Number(process.env.PORT ?? 4791);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const api = async (body, path = '/api/board-admin') => {
  const r = await realFetch(`${SITE}${path}`, { method: 'POST', headers: { 'x-test-user': FOUNDER, 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};

// ── The browser ──
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 400000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const errs = [];
async function open(path, { width = 1440, as = FOUNDER, wait = true } = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width, height: 1000 });
  await page.setExtraHTTPHeaders({ 'x-test-user': as });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|fonts\.gstatic|x-test-user|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  page.templateSaves = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/board-admin/.test(r.url()) && /"action":"save-settings"/.test(r.postData() || '')) page.templateSaves.push(r.postData()); });
  page.on('dialog', async (d) => { await d.accept().catch(() => {}); });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent.replace(/\s+/g, ' ').trim()); } } }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${SITE}${path}`, { waitUntil: wait ? 'networkidle0' : 'domcontentloaded' });
  if (wait) await sleep(1500);
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
const saved = (page, sel = '.bd-template .bm-saved', timeout = 15000) => page.waitForFunction((s) => /^Saved/.test(document.querySelector(s)?.textContent.trim() || ''), { timeout }, sel).then(() => true, () => false);
const saveLine = (page, sel = '.bd-template .bm-saved') => page.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', sel);
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const itemOf = (sections, title) => sections.flatMap((s) => s.items).find((it) => it.title === title);
/** The page's row for an item: its name box, and who it shows presenting */
const rowOf = (page, title) => page.evaluate((t) => {
  const li = [...document.querySelectorAll('.agx-item')].find((x) => x.querySelector('.agx-item__title')?.value === t);
  return li ? { who: li.querySelector('.bd-who')?.textContent.replace(/\s+/g, ' ').trim() || '' } : null;
}, title);
/** Who presents on an item, pressed as a person presses it (the mouse), and someone picked from its list by name */
async function pickWho(page, title, name) {
  const btn = await page.evaluateHandle((t) => [...document.querySelectorAll('.agx-item')].find((li) => li.querySelector('.agx-item__title')?.value === t)?.querySelector('.bd-who .bd-pop__btn') || null, title);
  await btn.evaluate((b) => b.scrollIntoView({ block: 'center' }));
  await btn.click();
  await page.waitForSelector('.bd-pop__panel .bd-picker__find', { timeout: 4000 });
  await sleep(500); // (a person's pace: the list is there, then they type)
  await page.keyboard.type(name);
  await page.waitForFunction((n) => [...document.querySelectorAll('.bd-picker__opt')].some((o) => o.textContent.toLowerCase().includes(n)), { timeout: 4000 }, name);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Escape');
}

try {
  // ═══ T1: the agenda template's editor open across a rename ═══
  await step('T1: the template page open while People renames the member who presents Financial: its next save keeps the new address and its own edit, and nothing names the old one', async () => {
    // Sam presents Financial on the template; a meeting ahead nobody wrote an agenda for is on it
    const ahead = (await api({ action: 'new-meeting', date: day(40) })).meeting;
    const s0 = await getSettings(DB);
    const withSam = s0.template.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.title === 'Financial' ? { ...it, who: ['sam-ortiz'], presenter: 'Sam Ortiz' } : it)) }));
    const put = await api({ action: 'save-settings', settings: { template: withSam }, base: s0.templateAt });
    ok(put.status === 200 && itemOf((await getMeeting(DB, ahead.id)).sections, 'Financial').who.join() === 'sam-ortiz', 'Sam presents Financial on the template and on the meeting ahead');

    // The founder's template page, loaded now
    const A = await open('/admin/#board/template');
    await A.waitForSelector('.bd-template .agx-item__title');
    ok(/Sam Ortiz/.test((await rowOf(A, 'Financial'))?.who || ''), `the page shows Sam presenting Financial (“${(await rowOf(A, 'Financial'))?.who}”)`);
    // People renames Sam (someone else, on People)
    const ren = await api({ collection: 'team', from: 'sam-ortiz', to: 'sam-ortiz-new' }, '/api/rename-content');
    ok(ren.status === 200, `People renames Sam (${ren.status} ${ren.error || ''})`);
    ok(itemOf((await getSettings(DB)).template, 'Financial').who.join() === 'sam-ortiz-new', 'the template moved with Sam');

    // The open page's edit: a new name on "Store update", saved by itself
    const before = A.templateSaves.length;
    await A.evaluate(() => {
      const el = [...document.querySelectorAll('.agx-item__title')].find((x) => x.value === 'Store update');
      el.scrollIntoView({ block: 'center' }); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
    });
    await A.keyboard.type(' and holiday sales');
    ok(await saved(A), `the page says Saved (${await saveLine(A)})`);
    await sleep(800);
    const asked = await A.evaluate(() => document.querySelector('.ask-overlay [data-ask]') ? document.querySelector('.ask')?.textContent.replace(/\s+/g, ' ').trim() : '');
    ok(!asked, `nothing asked: no item was changed both ways (${asked || 'no question'})`);
    const sends = A.templateSaves.slice(before);
    ok(sends.length >= 2, `its first save met the rename (the 409) and went again merged (${sends.length} sends)`);
    const t = (await getSettings(DB)).template;
    ok(itemOf(t, 'Financial')?.who?.join() === 'sam-ortiz-new', `the site’s template keeps the new address for Financial (${JSON.stringify(itemOf(t, 'Financial')?.who)})`);
    ok(!!itemOf(t, 'Store update and holiday sales'), 'and has the page’s own edit');
    ok(/Sam Ortiz/.test((await rowOf(A, 'Financial'))?.who || ''), `the page still shows Sam presenting Financial (“${(await rowOf(A, 'Financial'))?.who}”)`);
    ok(!(await toasts(A)).some((x) => /Not saved|didn’t/.test(x)), `and never said Not saved (${(await toasts(A)).join(' | ') || 'no toasts'})`);
    await shot(A, '01-template-after-rename');

    // The meeting on the template, and one made from it now: the new address, and the edit
    const followed = await getMeeting(DB, ahead.id);
    ok(itemOf(followed.sections, 'Financial')?.who?.join() === 'sam-ortiz-new' && !!itemOf(followed.sections, 'Store update and holiday sales'), `the meeting on the template names the new address and has the edit (${JSON.stringify(itemOf(followed.sections, 'Financial')?.who)})`);
    const fresh = (await api({ action: 'new-meeting', date: day(130) })).meeting;
    ok(itemOf(fresh.sections, 'Financial')?.who?.join() === 'sam-ortiz-new', `a new meeting from the template names the new address (${JSON.stringify(itemOf(fresh.sections, 'Financial')?.who)})`);

    // A presenter picked on this page afterwards (its list of people read before the rename) goes in beside the new address
    await pickWho(A, 'Financial', 'kim');
    ok(await saved(A), `Kim added beside Sam saves (${await saveLine(A)})`);
    await sleep(800);
    const fin = itemOf((await getSettings(DB)).template, 'Financial');
    ok(fin?.who?.includes('kim-park') && fin.who.includes('sam-ortiz-new') && !fin.who.includes('sam-ortiz'), `Financial is Sam at the new address and Kim, never the old address (${JSON.stringify(fin?.who)})`);
    const quoted = JSON.stringify('sam-ortiz');
    const left = (await DB.prepare('SELECT COUNT(*) AS n FROM board_meetings WHERE instr(data, ?) > 0').bind(quoted).first()).n;
    ok(left === 0 && !JSON.stringify((await getSettings(DB)).template).includes(quoted), `nothing on Board names “sam-ortiz” any more (${left} meetings)`);
    await A.close();
  });

  await step('T1: the template page open while People renames Kim, and its first edit is picking Kim to present: Kim at the new address, never the old one', async () => {
    const A = await open('/admin/#board/template');
    await A.waitForSelector('.bd-template .agx-item__title');
    const ren = await api({ collection: 'team', from: 'kim-park', to: 'kim-park-new' }, '/api/rename-content');
    ok(ren.status === 200, `People renames Kim (${ren.status} ${ren.error || ''})`);
    await pickWho(A, 'Governance', 'kim');
    ok(await saved(A), `the pick saves (${await saveLine(A)})`);
    await sleep(800);
    const gov = itemOf((await getSettings(DB)).template, 'Governance');
    ok(gov?.who?.join() === 'kim-park-new', `Governance is presented by Kim at the new address (${JSON.stringify(gov?.who)})`);
    const quoted = JSON.stringify('kim-park');
    const left = (await DB.prepare('SELECT COUNT(*) AS n FROM board_meetings WHERE instr(data, ?) > 0').bind(quoted).first()).n;
    ok(left === 0 && !JSON.stringify((await getSettings(DB)).template).includes(quoted), `nothing on Board names “kim-park” (${left} meetings)`);
    await shot(A, '02-template-pick-after-rename');
    await A.close();
  });

  // ═══ The coordinator's answer 3: a save never brings back an address its person has left ═══
  /** The page's quick reads of Board's data made to fail, so its list of people stays as it was read (the first moment) */
  const stale = async (page) => {
    await page.setRequestInterception(true);
    page.on('request', (r) => { if (r.isInterceptResolutionHandled()) return; if (/\/api\/board-admin\?quick/.test(r.url())) r.abort(); else r.continue(); });
  };
  await step('Answer 3: the page’s list of people never read again since Taylor was renamed: Taylor picked at the old address is saved at the new one, and the page takes it (Saved, once)', async () => {
    const A = await open('/admin/#board/template');
    await A.waitForSelector('.bd-template .agx-item__title');
    await stale(A);
    const ren = await api({ collection: 'team', from: 'taylor-nguyen', to: 'taylor-nguyen-new' }, '/api/rename-content');
    ok(ren.status === 200, `People renames Taylor (${ren.status})`);
    const before = A.templateSaves.length;
    await pickWho(A, 'Mission Advancement', 'taylor');
    ok(await saved(A), `the pick saves (${await saveLine(A)})`);
    await sleep(2500);
    ok(A.templateSaves.slice(before).some((x) => x.includes('"taylor-nguyen"')), 'setup: the page sent Taylor at the old address (its list never read again)');
    const it = itemOf((await getSettings(DB)).template, 'Mission Advancement');
    ok(it?.who?.join() === 'taylor-nguyen-new', `the site has Taylor at the new address (${JSON.stringify(it?.who)})`);
    ok(A.templateSaves.length - before <= 2 && /^Saved/.test(await saveLine(A)), `and the page took it: no saving over and over (${A.templateSaves.length - before} sends, “${await saveLine(A)}”)`);
    ok(!(await toasts(A)).some((x) => /Not saved|didn’t keep/.test(x)), `nothing said as not kept (${(await toasts(A)).join(' | ') || 'no toasts'})`);
    await A.close();
  });

  /* r9: the rename and the page's pick are different changes: the save's 409 names the rename (addressesNow), the page
     follows it in what it opened and what it has, and merges without a question (Board QA round 9 admin, item 3) */
  await step('Answer 3: Kim renamed while the page adds Taylor beside her: the page follows the rename, asks nothing, and the site saves Kim at her new address beside Taylor', async () => {
    const s0 = await getSettings(DB);
    const withKim = s0.template.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.title === 'Events and Marketing' ? { ...it, who: ['kim-park-new'], presenter: 'Kim Park' } : it)) }));
    ok((await api({ action: 'save-settings', settings: { template: withKim }, base: s0.templateAt })).status === 200, 'setup: Kim presents Events and Marketing');
    const A = await open('/admin/#board/template');
    await A.waitForSelector('.bd-template .agx-item__title');
    await stale(A);
    const ren = await api({ collection: 'team', from: 'kim-park-new', to: 'kim-park-3' }, '/api/rename-content');
    ok(ren.status === 200, `People renames Kim again (${ren.status})`);
    const before = A.templateSaves.length;
    await pickWho(A, 'Events and Marketing', 'taylor');
    const q = await A.waitForSelector('.ask-overlay [data-ask]', { timeout: 6000 }).then(() => A.evaluate(() => document.querySelector('.ask')?.textContent.replace(/\s+/g, ' ').trim() || ''), () => '');
    ok(!q, `no question about a rename (${q.slice(0, 160) || 'none'})`);
    ok(await saved(A), `it saves (${await saveLine(A)})`);
    await sleep(2500);
    ok(A.templateSaves.slice(before).some((x) => x.includes('"kim-park-new"')), 'setup: the page’s first save named Kim at the address she left');
    ok(!A.templateSaves.at(-1).includes('"kim-park-new"'), 'and its last one never does');
    const it = itemOf((await getSettings(DB)).template, 'Events and Marketing');
    ok(it?.who?.join() === 'kim-park-3,taylor-nguyen-new', `the site has Kim at her new address beside Taylor (${JSON.stringify(it?.who)})`);
    ok(/^Saved/.test(await saveLine(A)), `the page settles (“${await saveLine(A)}”)`);
    await shot(A, '04-merge-kept-mine');
    await A.close();
  });

  // ═══ T2: the board page opened at the moment its member is renamed ═══
  await step('T2: Alex opens the board page at the moment People renames them: their board page, every time, at 390 and 1280', async () => {
    for (const width of [390, 1280]) {
      for (let i = 0; i < 3; i++) {
        const was = renames;
        racing = true;
        const P = await open('/admin/board/', { width, as: ALEX });
        racing = false;
        await P.waitForFunction(() => document.querySelector('.bp-fail') || document.querySelector('.bp-main'), { timeout: 20000 }).catch(() => {});
        const seen = await P.evaluate(() => ({ fail: document.querySelector('.bp-fail')?.innerText.replace(/\s+/g, ' ').trim() || '', foot: document.querySelector('.bp-foot')?.innerText.replace(/\s+/g, ' ').trim() || '' }));
        ok(renames > was, `${width} wide, load ${i + 1}: Alex renamed ${renames - was} times as the page signed in (now “${alexAt}”)`);
        ok(!seen.fail && /Signed in as alex\.board@example\.com/.test(seen.foot), `${width} wide, load ${i + 1}: Alex’s board page (${seen.fail ? `refused: “${seen.fail.slice(0, 120)}”` : seen.foot.slice(0, 80)})`);
        if (i === 0) await shot(P, `03-board-page-during-rename-${width}`);
        await P.close();
      }
    }
    // (and through the sign-in alone, a few dozen times, each with a rename between its reads)
    let refused = 0;
    const was = renames;
    for (let i = 0; i < 40; i++) {
      racing = true;
      const r = await realFetch(`${SITE}/api/board-portal`, { headers: { 'x-test-user': ALEX, Origin: SITE } });
      racing = false;
      if (r.status !== 200 || (await r.json()).me?.name !== 'Alex Rivera') refused += 1;
    }
    ok(refused === 0 && renames - was >= 40, `40 more loads of the board page, each with a rename between the sign-in’s reads (${renames - was} renames): all answer as Alex (${refused} refused)`);
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
