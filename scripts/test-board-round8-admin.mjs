/**
 * test-board-round8-admin.mjs: the founders' Board admin, as Board QA round 8's admin tester found it (Nov 21 2026)
 * ================================================================
 * The real handlers (Board admin, the board page) behind the real sign-in middleware on an in-memory D1 and R2, as
 * scripts/test-board-round7.mjs does; Resend and Workers AI are faked and record what they're given. Made-up people only.
 *   - F1: Replace the minutes: the card and Alex's board page show only the new file (its notes, and no decision the
 *     replaced file had), and the toast counts only it
 *   - F2: a reminder sent from tab B: tab A's press, 11 minutes on, says who was asked and when, carefully (the focus on
 *     Cancel), and its card says so too, after a reload as well; the first ask is plain
 *   - F3: at 390, 768 and 1280, a menu whose button leaves a window made shorter closes, the focus back on its button;
 *     Who presents with its search box focused (a phone's keyboard) stays open, inside the window
 *   - F4: approved minutes the heartbeat finished reading later: nothing added, one quiet line for the founders
 *   - F5 and F6: the read's toast names the last meeting's minutes it marked approved; Undo's names them a draft again,
 *     and names an action item added since that it keeps
 * Screenshots land in test-results/board-round8-admin/. Exits non-zero on any failure.
 *
 *   PORT=4793 node scripts/test-board-round8-admin.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, getMeeting, provideBoardFinance, patchMeeting } from '../functions/api/_board.js';
import { maybeFinishMinutes } from '../functions/api/_board-minutes.js';
import { cleanMeeting, shortDate } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round8-admin/');
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
for (const [slug, d] of Object.entries(PEOPLE)) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
for (const [slug, email] of EMAILS) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('reveals', JSON.stringify({ reveals: [], upcoming: [] })).run();

const env = { DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test' };
// Workers AI: down (the tester's /__qa/aifail) or answering with what the model reads from the minutes
const ai = { down: true };
const MODEL = { attendance: [], motions: [{ text: 'Approve the 2027 budget', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }], actions: [{ text: 'Send the venue contract', owner: 'Alex Rivera', due: '' }], approvedPrev: false };
env.AI = { run: async () => { if (ai.down) throw new Error('test: Workers AI down'); return { response: MODEL }; }, toMarkdown: async (f) => ({ name: f.name, format: 'markdown', data: '' }) };
const mail = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); mail.push(...[].concat(b)); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
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

// ── Minutes as Word writes them (an outline): the tester's A, B, E, F and G ──
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
const wp = (text, ilvl) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lvls = ['decimal', 'decimal', 'lowerLetter', 'lowerRoman'].map((f, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${f}"/></w:lvl>`).join('');
const docx = (name, lines) => { const p = join(OUT, name); writeFileSync(p, zip({ 'word/document.xml': `<w:document><w:body>${lines.map(([t, l]) => wp(t, l)).join('')}</w:body></w:document>`, 'word/numbering.xml': `<w:numbering><w:abstractNum w:abstractNumId="0">${lvls}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`, '[Content_Types].xml': '<Types/>' })); return p; };
const MIN_A = docx('Minutes-A.docx', [['CALL TO ORDER', 0], ['Roll Call', 1], ['Quorum present', 2], ['FINANCE', 0], ['Year to date', 1], ['ALPHA revenue is ahead of budget', 2], ['The 2027 budget', 1], ['ALPHA budget discussed', 2], ['OPEN FORUM', 0], ['Questions from the board', 1], ['ALPHA no questions', 2]]);
const MIN_E = docx('Minutes-E.docx', [['CALL TO ORDER', 0], ['Roll Call', 1], ['ECHO quorum present, corrected', 2], ['FINANCE', 0], ['Year to date', 1], ['ECHO revenue is ahead of budget, corrected', 2], ['OPEN FORUM', 0], ['Questions from the board', 1]]);
const MIN_F = docx('Minutes-F.docx', [['CALL TO ORDER', 0], ['Roll Call', 1], ['FOXTROT quorum present', 2], ['FINANCE', 0], ['Year to date', 1], ['Sam Ortiz moved to adopt the FOXTROT reserve policy, and Alex Rivera seconded. The motion carried.', 2], ['OPEN FORUM', 0], ['Questions from the board', 1], ['FOXTROT none', 2]]);
const MIN_G = docx('Minutes-G.docx', [['CALL TO ORDER', 0], ['Roll Call', 1], ['GOLF quorum present', 2], ['FINANCE', 0], ['Year to date', 1], ['GOLF the reserve policy was discussed and held to the next meeting; no motion was made.', 2], ['OPEN FORUM', 0], ['Questions from the board', 1], ['GOLF none', 2]]);
const MIN_B = docx('Minutes-B.docx', [['CALL TO ORDER', 0], ['Roll Call', 1], ['Quorum present', 2], ['Approve the last meeting’s minutes', 1], ['The minutes of the last meeting were approved as presented.', 2], ['FINANCE', 0], ['Year to date', 1], ['BRAVO cash is steady', 2], ['OPEN FORUM', 0], ['Questions from the board', 1], ['BRAVO one question on reveals', 2]]);

// ── The meetings ──
const board = (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], notes: '- Revenue against budget' }, { title: 'The 2027 budget', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
  { title: 'Programs', items: [{ title: 'Makeovers in progress' }, { title: 'The spring volunteer day' }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', address: '100 Example Street, Atlanta, GA 30301', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, shared: true, ...more }), { by: FOUNDER });
// The last meeting before each held one, its minutes a draft (the one Minutes-B approves)
const PREV = await make(day(-150), { title: 'Q2 Board Meeting', minutes: 'draft' });
const REPLACE = await make(day(-1));
const REPLACE2 = await make(day(-2));
const APPROVES = await make(day(-6));
const LATE = await make(day(-4));
// Ahead, on the board page, its invite out: Alex, Sam and Taylor haven't answered it
const AHEAD = await make(day(9));
await patchMeeting(DB, AHEAD.id, (cur) => ({ ...cur, invite: { eventId: 'ev_r8ahead', organizer: FOUNDER, sentAt: new Date().toISOString(), replies: { 'alex-rivera': 'invited', 'sam-ortiz': 'invited', 'taylor-nguyen': 'invited' } } }));
// Ahead, for its pop-ups
const POP = await make(day(20), { shared: false });

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
// (a port of its own, 4791 to 4799, or any free one with PORT=0)
const PORT = Number(process.env.PORT ?? 4793);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const api = async (body, who = FOUNDER) => (await realFetch(`${SITE}/api/board-admin`, { method: 'POST', headers: { 'x-test-user': who, 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify(body) })).json();
const portalOf = async (id) => ((await (await realFetch(`${SITE}/api/board-portal`, { headers: { 'x-test-user': ALEX, Origin: SITE } })).json()).meetings || []).find((x) => x.id === id);

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
/** The question open now: { title, text, yes, focus: 'yes' | 'no' | '' } */
const question = (page) => page.waitForSelector('.ask-overlay [data-ask]', { timeout: 8000 }).then(() => page.evaluate(() => ({ title: document.querySelector('.ask h2')?.textContent || '', text: document.querySelector('.ask__text')?.textContent || '', yes: document.querySelector('[data-ask="yes"]')?.textContent || '', focus: document.activeElement?.dataset?.ask || '' })), () => null);
const answer = async (page, which) => { await page.click(`.ask-overlay [data-ask="${which}"]`); await sleep(400); };
async function press(page, sel, re) {
  const h = await page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim()) && !x.disabled) || null, sel, re.source);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no button “${re.source}” in ${sel}`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.click();
}
/** Minutes dropped on the meeting's page, and the read's toast */
async function drop(page, file) {
  const t0 = (await toasts(page)).length;
  await (await page.$('.bm-minutes-drop input[type=file]')).uploadFile(file);
  await sleep(800);
  await page.waitForFunction(() => !document.querySelector('.bm-minutes-drop.is-busy'), { timeout: 60000 });
  await sleep(2000);
  return (await toasts(page)).slice(t0).find((t) => /^Read from the minutes/.test(t)) || (await toasts(page)).slice(t0).join(' | ');
}
const card = (page) => page.evaluate(() => document.querySelector('.bm-minutes')?.innerText.replace(/\s+/g, ' ') || '');
const noted = (m) => m.sections.flatMap((s) => s.items).filter((it) => it.notes).map((it) => `${it.title}: ${it.notes}`);

try {
  // ═══ F1: Replace the minutes ═══
  await step('F1: Replace the minutes: the card, the toast and Alex’s board page show only the new file', async () => {
    ai.down = true;
    const A = await open(`/admin/#board/meeting/${REPLACE.id}`);
    const first = await drop(A, MIN_A);
    ok(/^Read from the minutes: notes under 4 items/.test(first), `setup: Minutes A read in (“${first}”)`);
    const read = await drop(A, MIN_E);
    ok(/^Read from the minutes: notes under 2 items/.test(read), `the toast counts only Minutes E (“${read}”)`);
    const c = await card(A);
    ok(/Read from Minutes E/.test(c) && /ECHO/.test(c) && !/ALPHA/.test(c), `the card shows only Minutes E (“${c.slice(0, 260)}”)`);
    const site = await getMeeting(DB, REPLACE.id);
    ok(noted(site).length === 2 && !noted(site).some((x) => /ALPHA/.test(x)), `the site has only its notes (${JSON.stringify(noted(site))})`);
    const alex = await portalOf(REPLACE.id);
    const alexNotes = (alex?.sections || []).flatMap((s) => s.items).filter((it) => it.notes).map((it) => it.notes);
    ok(alexNotes.length === 2 && !alexNotes.some((x) => /ALPHA/.test(x)), `Alex’s board page has notes under 2 items, none of Minutes A’s (${JSON.stringify(alexNotes)})`);
    await shot(A, '01-replaced-card');
    await A.close();
    const P = await open(`/admin/board/#/meetings/${REPLACE.id}`, { as: ALEX });
    await sleep(1500);
    const page = await P.evaluate(() => document.querySelector('.bp-main')?.innerText || '');
    ok(/ECHO revenue/.test(page) && !/ALPHA/.test(page), `Alex’s page reads Minutes E only (${/ALPHA/.test(page) ? 'ALPHA still there' : 'no ALPHA'})`);
    await shot(P, '02-replaced-alex');
    await P.close();
  });

  await step('F1: Replace takes the replaced file’s decision off: “held to the next meeting” never shows “Adopt the FOXTROT reserve policy … passed”', async () => {
    ai.down = true;
    const A = await open(`/admin/#board/meeting/${REPLACE2.id}`);
    await drop(A, MIN_F);
    ok(/FOXTROT reserve policy/.test(await card(A)), 'setup: Minutes F’s decision is on the card');
    const read = await drop(A, MIN_G);
    const c = await card(A);
    ok(/Read from Minutes G/.test(c) && !/Adopt the FOXTROT reserve policy/.test(c) && !/Decisions/.test(c), `the card has no decision from Minutes F (“${c.slice(0, 300)}”) after “${read}”`);
    const alex = await portalOf(REPLACE2.id);
    ok((alex?.motions || []).length === 0, `nor Alex’s page (${JSON.stringify((alex?.motions || []).map((x) => x.text))})`);
    await shot(A, '03-replaced-decision');
    await A.close();
  });

  // ═══ F6 and F5: what the read and Undo say ═══
  await step('F6: the read names the last meeting’s minutes it marked approved; Undo names them a draft again', async () => {
    ai.down = true;
    const A = await open(`/admin/#board/meeting/${APPROVES.id}`);
    const read = await drop(A, MIN_B);
    const d = shortDate(PREV.date);
    ok((await getMeeting(DB, PREV.id)).minutes === 'approved', 'setup: the read approved the Q2 minutes');
    ok(read.includes(`, and marked the ${d} minutes approved, as these say`), `the toast says so (“${read}”)`);
    const t0 = (await toasts(A)).length;
    await A.evaluate(() => document.querySelector('.bm-minutes-drop__undo')?.click());
    await sleep(3000);
    const said = (await toasts(A)).slice(t0).join(' | ');
    ok(said === `Put back as it was before they were read in, and the ${d} minutes are a draft again.`, `Undo says so (“${said}”)`);
    ok((await getMeeting(DB, PREV.id)).minutes === 'draft', 'and they are');
    await shot(A, '04-undo-prev-draft');
    await A.close();
  });

  await step('F5: Undo names an action item another founder added since, which it keeps; never “as it was” alone', async () => {
    ai.down = true;
    const A = await open(`/admin/#board/meeting/${APPROVES.id}`);
    await drop(A, MIN_A);
    // Holly, in her own tab, adds an action item for Taylor
    const cur = await getMeeting(DB, APPROVES.id);
    const s = await api({ action: 'save-meeting', meeting: { ...cur, actions: [...cur.actions, { id: 'a_bookvenue', text: 'Book the spring venue', owner: 'taylor-nguyen', ownerName: 'Taylor Nguyen' }] }, base: cur.updatedAt });
    ok(s.ok, `setup: the action item is added (${s.error || 'ok'})`);
    const t0 = (await toasts(A)).length;
    await A.evaluate(() => document.querySelector('.bm-minutes-drop__undo')?.click());
    await sleep(3000);
    const said = (await toasts(A)).slice(t0).join(' | ');
    ok(said === 'Put back as it was before they were read in, except: The action item “Book the spring venue”, added since, is kept.', `Undo names it (“${said}”)`);
    ok((await getMeeting(DB, APPROVES.id)).actions.map((x) => x.text).join() === 'Book the spring venue', 'and it is kept');
    await A.close();
  });

  // ═══ F4: approved minutes and the heartbeat ═══
  await step('F4: approved before the heartbeat finished reading them: nothing added, one quiet line for the founders, nothing on Alex’s page', async () => {
    ai.down = true;
    const A = await open(`/admin/#board/meeting/${LATE.id}`);
    await drop(A, MIN_A);
    await A.close();
    const cur = await getMeeting(DB, LATE.id);
    ok((await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: cur.date }, base: cur.updatedAt })).ok, 'setup: marked approved in another tab');
    ai.down = false;
    // (the heartbeat finishes one meeting's minutes a run, the newest first: run until it has come to these)
    let ran = [];
    for (let i = 0; i < 6 && !ran.includes(LATE.id); i++) ran.push(await maybeFinishMinutes(env, { now: Date.now() + i * 3 * 60_000 }));
    ai.down = true;
    const site = await getMeeting(DB, LATE.id);
    ok(ran.includes(LATE.id), `setup: the heartbeat read them again (${ran.join(', ')})`);
    ok(site.motions.length === 0 && site.actions.length === 0, `nothing added (${JSON.stringify([site.motions.map((x) => x.text), site.actions.map((x) => x.text)])})`);
    const B = await open(`/admin/#board/meeting/${LATE.id}`);
    const line = await B.evaluate(() => document.querySelector('.bm-minutes__late')?.textContent.trim() || '');
    ok(line === 'Read after they were approved, so not added: the decision “Approve the 2027 budget” and the action item “Send the venue contract”. Add them by hand if they belong.', `the founders’ view says so (“${line}”)`);
    await shot(B, '05-late-line');
    await B.close();
    const alex = await portalOf(LATE.id);
    ok(alex && !JSON.stringify(alex).includes('Send the venue contract'), 'Alex’s page has none of it');
  });

  // ═══ F2: the reminder's record, in a second tab ═══
  await step('F2: B asks the 3; 11 minutes on, A’s press says who was asked and when, on Cancel; A’s card says so, after a reload too', async () => {
    const A = await open(`/admin/#board/meeting/${AHEAD.id}`);
    const B = await open(`/admin/#board/meeting/${AHEAD.id}`);
    const m0 = mail.length;
    await press(B, '.bm-coming button', /^Ask the 3 who haven’t answered$/);
    const q1 = await question(B);
    ok(q1 && !/were asked/.test(q1.text) && q1.focus !== 'no', `B’s first ask is plain (“${q1?.title} ${q1?.text}”, focus ${q1?.focus || 'none'})`);
    await answer(B, 'yes');
    await sleep(2500);
    ok(mail.length - m0 === 3, `B asked 3 (${mail.length - m0} emails)`);
    const bLine = await B.evaluate(() => document.querySelector('.bm-coming__wait')?.textContent.trim() || '');
    ok(/^Asked Alex, Sam and Taylor just now\.$/.test(bLine), `B’s card says so (“${bLine}”)`);
    // Eleven minutes on (the tester's /__qa/age): the send's own record, older
    const back = new Date(Date.now() - 11 * 60_000).toISOString();
    const row = await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(`board-send:remind:${AHEAD.id}`).first();
    const rec = JSON.parse(row.data);
    for (const k of Object.keys(rec.had)) rec.had[k] = back;
    await DB.prepare('UPDATE board_state SET data = ? WHERE key = ?').bind(JSON.stringify(rec), `board-send:remind:${AHEAD.id}`).run();
    // A, never reloaded, never focused: its press
    await A.bringToFront();
    const m1 = mail.length;
    await press(A, '.bm-coming button', /^(Ask the 3 who haven’t answered|Ask again)$/);
    const q2 = await question(A);
    ok(q2 && q2.title === 'Ask them again?' && q2.text.startsWith('Alex Rivera, Sam Ortiz and Taylor Nguyen were asked 11 min ago.') && q2.focus === 'no' && q2.yes === 'Ask them again', `A’s question says who was asked and when, careful (“${q2?.title} ${q2?.text}”, yes “${q2?.yes}”, focus ${q2?.focus || 'none'})`);
    await shot(A, '06-ask-again-question');
    await answer(A, 'no');
    await sleep(800);
    ok(mail.length === m1, 'Cancel sends nothing');
    const aLine = await A.evaluate(() => document.querySelector('.bm-coming__wait')?.textContent.trim() || '');
    ok(aLine === 'Asked Alex, Sam and Taylor 11 min ago.', `A’s card has it now, from the site (“${aLine}”)`);
    await A.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    const rLine = await A.evaluate(() => document.querySelector('.bm-coming__wait')?.textContent.trim() || '');
    const btn = await A.evaluate(() => [...document.querySelectorAll('.bm-coming button')].map((b) => b.textContent.trim()).join(' | '));
    ok(rLine === 'Asked Alex, Sam and Taylor 11 min ago.' && /Ask again/.test(btn), `after a reload too (“${rLine}”, ${btn})`);
    await A.close(); await B.close();
  });

  // ═══ The coordinator's answer 4: a reminder whose answer is lost says what the site's record has ═══
  await step('Answer 4: Ask again, its answer lost on the way back: “No answer came back from the site, but it went: … were asked just now.”; the next press says so, carefully', async () => {
    const A = await open(`/admin/#board/meeting/${AHEAD.id}`);
    // (the site's answer replaced on its way back, as a dropped connection leaves it: the reminder itself went)
    const cdp = await A.createCDPSession();
    let hits = 0;
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/board-admin*', requestStage: 'Response' }] });
    cdp.on('Fetch.requestPaused', async (ev) => {
      try {
        if (!hits && /"action":"remind-rsvp"/.test(ev.request.postData || '') && !/"test":true/.test(ev.request.postData || '')) {
          hits += 1;
          await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 502, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<html><body>502 Bad gateway</body></html>').toString('base64') });
        } else await cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
      } catch { /* the page went */ }
    });
    const m0 = mail.length;
    const t0 = (await toasts(A)).length;
    await press(A, '.bm-coming button', /^Ask again$/);
    await question(A);
    await answer(A, 'yes');
    await sleep(3500);
    const said = (await toasts(A)).slice(t0).join(' | ');
    ok(hits === 1 && mail.length - m0 === 3, `setup: the reminder went (${mail.length - m0}), its answer lost (${hits})`);
    ok(said === 'No answer came back from the site, but it went: Alex Rivera, Sam Ortiz and Taylor Nguyen were asked just now.', `it says what really happened (“${said}”)`);
    await press(A, '.bm-coming button', /^Ask again$/);
    const q = await question(A);
    ok(q && q.text.startsWith('Alex Rivera, Sam Ortiz and Taylor Nguyen were asked just now.') && !/no answer came back/i.test(q.text) && q.focus === 'no', `the next press says who was asked just now, on Cancel (“${q?.text}”, focus ${q?.focus})`);
    await answer(A, 'no');
    await cdp.send('Fetch.disable').catch(() => {});
    await A.close();
  });

  // ═══ F3: a pop-up whose button leaves a window made shorter ═══
  for (const W of [390, 768, 1280]) {
    await step(`F3: ${W} wide, a window made shorter: the item menu closes with its button out of view, the focus back on it; Who presents being typed in stays, inside the window`, async () => {
      const H = 900;
      const P = await open(`/admin/#board/meeting/${POP.id}`, { width: W, height: H });
      await P.waitForSelector('.agx-item');
      // The last item's ⋯, put near the bottom of the window, opened
      const put = async (sel) => P.evaluate((s, h) => {
        const el = [...document.querySelectorAll(s)].at(-1);
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        window.scrollBy(0, r.top + r.height / 2 - h * 0.85);
        return Math.round(el.getBoundingClientRect().top);
      }, sel, H);
      const at = await put('.agx-item details > summary');
      await (await P.$$('.agx-item details > summary')).at(-1).click();
      await sleep(400);
      ok(await P.evaluate(() => !!document.querySelector('.agx-item details[open]')), `${W}: setup: the menu is open (its button at ${at})`);
      await P.setViewport({ width: W, height: Math.round(H * 0.6) });
      await sleep(700);
      const after = await P.evaluate(() => ({ open: !!document.querySelector('.agx-item details[open]'), focus: document.activeElement?.tagName || '', inItem: !!document.activeElement?.closest?.('.agx-item') }));
      ok(!after.open, `${W}: shorter, its button out of view, the menu is closed (open: ${after.open})`);
      ok(after.focus === 'SUMMARY' && after.inItem, `${W}: the focus back on its button (${after.focus})`);
      await shot(P, `07-menu-closed-${W}`);
      // Who presents, its search box focused (a phone's keyboard): stays open, inside the window
      await P.setViewport({ width: W, height: H });
      await sleep(500);
      await put('.agx-item .bd-who .bd-pop__btn');
      await (await P.$$('.agx-item .bd-who .bd-pop__btn')).at(-1).click();
      await P.waitForSelector('.bd-pop__panel .bd-picker__find', { timeout: 4000 });
      await sleep(300);
      ok(await P.evaluate(() => document.activeElement?.classList.contains('bd-picker__find')), `${W}: setup: typing in Who presents`);
      await P.setViewport({ width: W, height: Math.round(H * 0.6) });
      await sleep(700);
      const pop = await P.evaluate(() => { const p = document.querySelector('.bd-pop__panel'); const r = p?.getBoundingClientRect(); return p ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, visible: getComputedStyle(p).visibility !== 'hidden' } : null; });
      ok(pop && pop.visible && pop.top >= 0 && pop.bottom <= pop.h, `${W}: it stays open, inside the window (${JSON.stringify(pop)})`);
      await shot(P, `08-who-typing-${W}`);
      await P.close();
    });
  }

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
