/**
 * test-board-round10-admin.mjs: the founders' Board admin, as Board QA round 10's admin tester found it (Nov 22 2026)
 * ================================================================
 * The real handlers (Board admin, the board page) behind the real sign-in middleware on an in-memory D1 and R2, as
 * scripts/test-board-round5.mjs does; Google Calendar and Resend are faked and record what they're given. Made-up people
 * only. The database can be made to fail one statement (`fault`), as tests/board-round9.test.mjs does.
 *   - F1: approved minutes kept only as Minutes.docx: Every file's Add files "Minutes-revised.pdf" is kept as an ordinary
 *     file and the page says why; a file's ⋯ → Minutes is refused in the same words; the minutes card still says
 *     "Written up in Minutes", and Alex's "The minutes as written" opens Minutes.docx
 *   - F2: Maria leaves the board while a meeting is open, and the press's own read of People fails once: Send the invite
 *     asks nothing and sends nothing, and says so; pressed again, the question names the board as it is
 *   - F3: the agenda template open in two tabs: tab B adds Taylor to Financial, People renames Sam (a newcomer at his old
 *     address), tab A adds Alex: the question names the other tab, never the rename
 * Screenshots land in test-results/board-round10-admin/. Exits non-zero on any failure.
 *
 *   PORT=4985 node scripts/test-board-round10-admin.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { agendaApproved } from '../tests/lib/agenda-approved.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, getMeeting, getSettings, saveSettings, provideBoardFinance, patchMeeting, putFile } from '../functions/api/_board.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round10-admin/');
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
  'maria-example': { name: 'Maria Example', group: 'board', title: 'Board Member', order: 4 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', order: 5 },
};
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net'], ['maria-example', 'maria.board@example.com']];
const BOARD = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen', 'maria-example', 'kim-park'];
const AS_A_FILE = 'The minutes are approved, so this was added as a file, not as the minutes. Mark them as draft first to replace them.';
const NOT_THE_MINUTES = 'The minutes are approved, so this stays a file, not the minutes. Mark them as draft first to replace them.';
const UNCHECKED = 'We couldn’t check People just now, so nothing was sent. Please try again in a moment.';

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
/** Leaving the board, as People's Move to alumni leaves them */
const leaves = async (slug) => {
  const row = await DB0.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first();
  await DB0.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind('alumni', JSON.stringify({ ...JSON.parse(row.data), group: 'alumni', status: 'alumni' }), slug).run();
};

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

// ── Files as the founders have them: a Word file (a ZIP), PDFs ──
function zip(files) {
  const enc = new TextEncoder(); const locals = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name); const raw = enc.encode(text); const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB); offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const WORD = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Q3 Board Meeting Minutes</w:t></w:r></w:p></w:body></w:document>', '[Content_Types].xml': '<Types/>' });
const PDF = (name) => { const p = join(OUT, name); writeFileSync(p, `%PDF-1.7\n% ${name}\n%%EOF\n`); return p; };
const REVISED = PDF('Minutes-revised.pdf');
const PARKING = PDF('Parking-map.pdf');

// ── The meetings ──
const board = (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
// Held 60 days ago, its minutes approved a month ago and kept only as Minutes.docx, never read in (the tester's)
const HELD = await make(day(-60), { shared: true, minutes: 'approved', approvedOn: day(-30) });
const KEPT = await putFile(env, { ownerType: 'meeting', ownerId: HELD.id, file: new File([WORD], 'Minutes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), kind: 'minutes', by: FOUNDER });
// Ahead, on the board page with its agenda approved, its invite not sent yet
const AHEAD = await patchMeeting(DB, (await make(day(15))).id, (cur) => ({ ...cur, shared: true }));
await agendaApproved(DB, AHEAD.id);
// The agenda template: Financial, presented by Sam
const s0 = await getSettings(DB);
await saveSettings(DB, { template: s0.template.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'i_r10fin', title: 'Financial', who: ['sam-ortiz'], presenter: 'Sam Ortiz' }] } : sec)) }, FOUNDER, { base: s0.templateAt });

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
// (a port of its own, 4981 to 4989, or any free one with PORT=0)
const PORT = Number(process.env.PORT ?? 4985);
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
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
/** The question open now (waiting up to `ms`): { title, text } or null */
const question = (page, ms = 6000) => page.waitForSelector('.ask-overlay [data-ask]', { timeout: ms }).then(() => page.evaluate(() => ({ title: document.querySelector('.ask h2')?.textContent || '', text: document.querySelector('.ask__text')?.textContent || '' })), () => null);
const answer = async (page, which) => { await page.click(`.ask-overlay [data-ask="${which}"]`); await sleep(400); };
async function press(page, sel, re) {
  const h = await page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled) || null, sel, re.source);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no button “${re.source}” in ${sel}`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.click();
}
const writtenUp = (page) => page.evaluate(() => document.querySelector('.bm-minutes')?.innerText.match(/(Written up in|Read from)[^.]*\./)?.[0] || '');
const kinds = async (id) => (await getMeeting(DB0, id)).files.map((f) => `${f.name}[${f.kind}]`);

try {
  // ═══ F1 (major): approved minutes kept only as a file, and Every file ═══
  await step('F1: approved minutes kept only as Minutes.docx: a file added as the minutes is kept as a file and said; ⋯ → Minutes is refused; the editor and Alex’s board page still open Minutes', async () => {
    const A = await open(`/admin/#board/meeting/${HELD.id}`);
    await A.waitForSelector('.bm-top');
    ok((await writtenUp(A)) === 'Written up in Minutes.', `setup: the card says “${await writtenUp(A)}”`);
    await (await A.$('#bm-files input[type=file]')).uploadFile(REVISED);
    await A.waitForFunction(() => !document.querySelector('#bm-files .bf-up'), { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    let said = await toasts(A);
    ok(said.includes(`Minutes revised: ${AS_A_FILE}`), `the page says why it's a file (${said.join(' | ')})`);
    ok(!said.includes('Minutes revised added'), 'never only “added”');
    ok(JSON.stringify(await kinds(HELD.id)) === JSON.stringify(['Minutes.docx[minutes]', 'Minutes-revised.pdf[other]']), `the site keeps it as an ordinary file (${(await kinds(HELD.id)).join(', ')})`);
    ok((await writtenUp(A)) === 'Written up in Minutes.', `the card still says “${await writtenUp(A)}”`);
    // A file's ⋯ → Minutes
    await (await A.$('#bm-files input[type=file]')).uploadFile(PARKING);
    await A.waitForFunction(() => !document.querySelector('#bm-files .bf-up'), { timeout: 60000 }).catch(() => {});
    await sleep(2000);
    await A.evaluate(() => { const row = [...document.querySelectorAll('#bm-files li')].find((r) => /Parking map/.test(r.textContent)); row?.querySelector('summary, button[aria-haspopup]')?.click(); });
    await sleep(600);
    const chose = await A.evaluate(() => { const it = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], .bd-menu__item')].filter((x) => x.offsetParent).find((x) => /^Minutes$/.test(x.textContent.trim())); it?.click(); return !!it; });
    ok(chose, 'setup: chose Minutes in its ⋯');
    await sleep(2500);
    said = await toasts(A);
    ok(said.includes(NOT_THE_MINUTES), `refused in the same words (${said.slice(-2).join(' | ')})`);
    ok(!said.some((t) => /is under Minutes/.test(t)), 'never “is under Minutes”');
    ok(JSON.stringify(await kinds(HELD.id)) === JSON.stringify(['Minutes.docx[minutes]', 'Minutes-revised.pdf[other]', 'Parking-map.pdf[other]']), `nothing changed on the site (${(await kinds(HELD.id)).join(', ')})`);
    ok((await writtenUp(A)) === 'Written up in Minutes.', `the card still says “${await writtenUp(A)}”`);
    await shot(A, '01-every-file');
    await A.close();
    // Alex's board page: "The minutes as written" opens Minutes.docx
    const P = await open(`/admin/board/#/meetings/${HELD.id}`, { as: ALEX });
    await sleep(2500);
    const href = await P.evaluate(() => [...document.querySelectorAll('a')].find((x) => /The minutes as written/.test(x.textContent))?.getAttribute('href') || '');
    ok(href.includes(KEPT.id), `Alex’s “The minutes as written” opens Minutes.docx (${href})`);
    await shot(P, '02-alex');
    await P.close();
  });

  // ═══ F2: one failed read of People at a send's press ═══
  await step('F2: Maria leaves the board while the meeting is open, and the press’s read of People fails once: nothing is asked or sent, and the page says so; pressed again, the question names the board as it is', async () => {
    const A = await open(`/admin/#board/meeting/${AHEAD.id}`);
    await A.waitForSelector('.bm-top');
    await leaves('maria-example');
    const posts = () => google.calls.filter((c) => c.method === 'POST').length;
    const before = posts();
    fault = { re: /FROM team/, n: 1, failed: 0 };
    await press(A, '.bm-ready button', /^Send the invite$/);
    const q = await question(A, 5000);
    ok(fault.failed === 1, `setup: the press’s read of People failed (${fault.failed})`);
    fault = null;
    ok(!q, `no question asked (${q ? JSON.stringify(q).slice(0, 160) : 'none'})`);
    if (q) await answer(A, 'no');
    const said = await toasts(A);
    ok(said.includes(UNCHECKED), `the page says why nothing went (${said.join(' | ')})`);
    ok(posts() === before, 'Google was given no invite');
    await shot(A, '03-blip');
    // The read answers again: the question names the board as it is now (Maria gone)
    await press(A, '.bm-ready button', /^Send the invite$/);
    const q2 = await question(A);
    ok(!!q2 && /^Google emails the invite to Alex Rivera, Sam Ortiz and Taylor Nguyen, with Google Meet/.test(q2.text) && !/Maria/.test(q2.text), `the question names the three on the board (${q2?.text.slice(0, 110)})`);
    if (q2) await answer(A, 'no');
    await A.close();
  });

  // ═══ F3: the agenda template in two tabs, across a rename ═══
  await step('F3: the agenda template in two tabs, a rename in between: the question names the other tab (the clashing change), never the rename', async () => {
    const tabs = [];
    for (let i = 0; i < 2; i++) { const p = await open('/admin/#board/template'); await p.waitForSelector('.bd-template .agx-edit'); await sleep(1500); tabs.push(p); }
    const [A, B] = tabs;
    // (tab A in the background: it reads nothing new until its own save meets the others, as a tab not looked at)
    await A.setRequestInterception(true);
    A.on('request', (rq) => (rq.method() === 'GET' && rq.url().includes('/api/board-admin') ? rq.abort() : rq.continue()));
    const pick = async (P, name) => {
      await P.evaluate(() => [...document.querySelectorAll('.bd-pop__btn')].find((x) => /Financial/.test(x.getAttribute('aria-label') || ''))?.click());
      await P.waitForSelector('.bd-picker__opt', { timeout: 10000 });
      await P.evaluate((n) => [...document.querySelectorAll('.bd-picker__opt')].find((o) => o.textContent.includes(n))?.click(), name);
      await P.keyboard.press('Escape');
    };
    const fin = async () => (await getSettings(DB0)).template.flatMap((x) => x.items).find((it) => it.title === 'Financial');
    await pick(B, 'Taylor Nguyen');
    await sleep(4000);
    ok(JSON.stringify((await fin()).who) === JSON.stringify(['sam-ortiz', 'taylor-nguyen']), `setup: tab B saved Taylor (${JSON.stringify((await fin()).who)})`);
    const { rename } = await import('../functions/api/rename-content.js');
    const r = await rename(env, { collection: 'team', from: 'sam-ortiz', to: 'sam-ortiz-new' }, FOUNDER, async () => Response.json({ success: true }));
    await DB0.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind('sam-ortiz', 'Nora Newcomer', 'board', JSON.stringify({ slug: 'sam-ortiz', name: 'Nora Newcomer', group: 'board', title: 'Board Member', status: 'active', order: 9 })).run();
    ok(r.status === 200 && (await getSettings(DB0)).templateBy === 'People (renaming Sam Ortiz)', 'setup: the rename saved the template last');
    await pick(A, 'Alex Rivera');
    const q = await question(A, 15000);
    ok(q?.title === 'You changed the agenda template in another tab too', `the question names the other tab (“${q?.title}”)`);
    ok(q?.text === 'You changed “Financial” here and in the other tab. Keep what’s here, or take the other tab’s? Everything else from both is kept.', `and what it changed (“${q?.text}”)`);
    await shot(A, '04-template-question');
    if (q) await answer(A, 'yes');
    await sleep(5000);
    const f = await fin();
    ok(JSON.stringify(f.who) === JSON.stringify(['sam-ortiz-new', 'alex-rivera']), `Keep what’s here: Sam (followed) and Alex (${JSON.stringify(f.who)})`);
    for (const p of tabs) await p.close();
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
