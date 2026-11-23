/**
 * test-board-round6.mjs: the founders' Board admin (the meeting editor, Home and Members), as QA round 6 found it
 * (Nov 21 2026)
 * ================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round5.mjs
 * does; Google (Calendar and Gmail) and Resend are faked and record what they're given. Made-up people only.
 *   - B1: Undo right after reading minutes in: the site has the meeting as it was (the notes, the motion, the action,
 *     which minutes), the file goes, the last meeting's minutes are draft again, a reload shows it, and a tab opened
 *     before the Undo can't mark them approved
 *   - B2: typing not saved yet is never lost to a file going in (or any change the site already has): a file added a
 *     moment after typing, with no connection, and with saves failing for each keepSaved caller (the packet's Add
 *     files, a file's staff-only switch, Delete the file, an item's Upload a file, the minutes dropped in, the signed
 *     copy); the line never says Saved while it waits, and the site gets the words
 *   - m1: a send pressed a few seconds after People → Board changed names the board as it is, and so does the page after
 *   - m2: the window given the focus reads Board's data again
 *   - M1: Members → Email all names the board as the site has it at the press, and sends only to the list shown
 *   - m3: a "not a board meeting" ahead is approved in Board, becoming a board meeting; Who's coming never says
 *     "No invite yet" for it
 *   - m4: the chair's review is named only when it will happen, with its day
 *   - m5: the secretary line says the board page only when the meeting is on it
 *   - m7: the template says a part with no name isn't added to new meetings
 *   - m8: a founder's own other tab is "you"
 * Screenshots land in test-results/board-round6/. Exits non-zero on any failure.
 *
 *   PORT=4661 node scripts/test-board-round6.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { agendaApproved } from '../tests/lib/agenda-approved.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, getMeeting, provideBoardFinance, patchMeeting, saveDoc } from '../functions/api/_board.js';
import { everyoneSignIns } from '../functions/api/_board-access.js';
import { writeState } from '../functions/api/_board-roles.js';
import { cleanMeeting, shortDate } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round6/');
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
  'lee-example': { name: 'Lee Example', group: 'advisory', title: 'Advisory Board Member', order: 2 },
};
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net'], ['ada-example', 'ada.board@example.com'], ['lee-example', 'lee.board@example.com']];
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
const regroup = async (slug, how, title = 'Board Member') => {
  const row = await DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first();
  const d = { ...JSON.parse(row.data), ...(how === 'alumni' ? { status: 'alumni' } : { group: how, status: 'active', title }) };
  await DB.prepare('UPDATE team SET "group" = ?, data = ? WHERE slug = ?').bind(d.group, JSON.stringify(d), slug).run();
};

// ── The outside world, faked: Google Calendar keeps its events, Gmail and Resend keep what they sent ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }),
  DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test',
};
const google = { events: {}, calls: [] };
const mail = [];
const gmailSent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) {
    const b = JSON.parse(init.body);
    mail.push(...[].concat(b));
    return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
  }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (/^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/.test(url)) {
    gmailSent.push(Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8'));
    return Response.json({ id: `sent-${gmailSent.length}`, threadId: `t-${gmailSent.length}` });
  }
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

// ── Files: minutes as Word writes them (an outline), and a small PDF ──
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
const minutesDocx = (lines) => zip({ 'word/document.xml': `<w:document><w:body>${lines.map(([t, l]) => wp(t, l)).join('')}</w:body></w:document>`, 'word/numbering.xml': `<w:numbering><w:abstractNum w:abstractNumId="0">${lvls}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`, '[Content_Types].xml': '<Types/>' });
const MINUTES = join(OUT, 'Minutes-approve.docx');
writeFileSync(MINUTES, minutesDocx([['CALL TO ORDER', 0], ['Roll Call', 1], ['Approve the last meeting’s minutes', 1], ['The minutes of the last meeting were approved as presented.', 2], ['FINANCE', 0], ['Year to date', 1], ['Revenue is ahead of budget', 2], ['Motion to approve the 2027 budget by Alex, seconded by Sam. Motion passed.', 2], ['OPEN FORUM', 0], ['Questions from the board', 1]]));
const MINUTES2 = join(OUT, 'Minutes-held.docx');
writeFileSync(MINUTES2, minutesDocx([['CALL TO ORDER', 0], ['Roll Call', 1], ['FINANCE', 0], ['Year to date', 1], ['Reserves grew this quarter', 2], ['OPEN FORUM', 0], ['Questions from the board', 1]]));
const pdfFile = async (name) => { const d = await PDFDocument.create(); d.addPage([300, 200]); const p = join(OUT, name); writeFileSync(p, await d.save()); return p; };
const STATEMENT = await pdfFile('Statement.pdf');
const PARKING = await pdfFile('Parking-map.pdf');
const SIGNED = await pdfFile('Signed-minutes.pdf');

// ── The meetings ──
const board = (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], notes: '- Revenue against budget' }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
// B1: Sep's minutes in as a draft, and the meeting held yesterday whose minutes approve them
const SEP = await make(day(-60), { minutes: 'draft' });
await patchMeeting(DB, SEP.id, (cur) => ({ ...cur, shared: true, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() } }));
const HELD = await patchMeeting(DB, (await make(day(-1))).id, (cur) => ({ ...cur, shared: true }));
// B2: ahead (held two days ago, for the minutes and the signed copy, is made after B1: it would be the meeting B1's
// minutes approve)
const AHEAD = await make(day(30));
// m1, m2: ahead, on the board page and approved
const ROSTER = await patchMeeting(DB, (await make(day(15))).id, (cur) => ({ ...cur, shared: true }));
await agendaApproved(DB, ROSTER.id);
// m3: a coffee three days ahead, kept off the board page as "not a board meeting"
const COFFEE = await make(day(3), { title: 'Coffee with the gala chair' });
await patchMeeting(DB, COFFEE.id, (cur) => ({ ...cur, notBoard: true, shared: false }));
// m4, m5: ahead and not shared (the chair reviews it); one on the board page; one today
const FAR = await make(day(20));
// (late in the day, so it's still ahead whenever this suite runs: a meeting over for the day has no Approve line at all,
// which made the own-day check fail after 8 PM Eastern; QA round 7, Nov 21 2026)
const TODAY = await make(day(0), { start: '23:00', end: '23:59' });
// m8: ahead, for two tabs
const TWO = await make(day(25));
// Members: a paper the board signs
await saveDoc(DB, { title: 'Board Member Expectations', body: 'Come to the meetings, read the documents first.', sign: true, shared: true }, { by: FOUNDER });
/** The board page's sign-in made current for the board as it is now (Cloudflare's list in step, as its 5-minute sync leaves it) */
const signInCurrent = async () => {
  const { emails } = await everyoneSignIns(DB);
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(emails.join('\n'))));
  await writeState(DB, 'access', { groupId: 'g1', hash: [...b.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('') });
};

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
// (a port of its own, 4661 to 4663, or any free one with PORT=0)
const PORT = Number(process.env.PORT ?? 4661);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const api = async (body) => (await realFetch(`${SITE}/api/board-admin`, { method: 'POST', headers: { 'x-test-user': FOUNDER, 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify(body) })).json();

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
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|fonts\.gstatic|x-test-user|ERR_INTERNET_DISCONNECTED/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  page.saves = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/board-admin/.test(r.url()) && /"action":"save-meeting"/.test(r.postData() || '')) page.saves += 1; });
  page.on('dialog', async (d) => { await d.accept().catch(() => {}); });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent.replace(/\s+/g, ' ').replace(/Undo⌘Z$|Undo$/, '').trim()); } } }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  return page;
}
/** Answers the page's next `n` POSTs whose body matches `re` with `status` and `body`, never reaching the site */
async function rule(page, re, { n = 1, status, body, type = 'application/json' }) {
  const cdp = await page.createCDPSession();
  const st = { n, hits: 0 };
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/board-admin*', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', async (ev) => {
    const hit = ev.request.method === 'POST' && st.n > 0 && re.test(ev.request.postData || '');
    try {
      if (!hit) { await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }); return; }
      st.n -= 1;
      st.hits += 1;
      await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') });
    } catch { /* the page went */ }
  });
  return { st, off: async () => { st.n = 0; await cdp.send('Fetch.disable').catch(() => {}); await cdp.detach().catch(() => {}); } };
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
const saved = (page, timeout = 15000) => page.waitForFunction(() => /^Saved/.test(document.querySelector('.bm-saved')?.textContent.trim() || ''), { timeout }).then(() => true, () => false);
const saveLine = (page) => page.evaluate(() => document.querySelector('.bm-saved')?.textContent.replace(/\s+/g, ' ').trim() || '');
const notSaved = (page) => page.waitForFunction(() => /^Not saved/.test(document.querySelector('.bm-saved')?.textContent.trim() || ''), { timeout: 15000 }).then(() => true, () => false);
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
/** The question open now ({ title, text }), answered `which` */
async function answer(page, which) {
  await page.waitForSelector('.ask-overlay [data-ask]', { timeout: 8000 });
  const q = await page.evaluate(() => ({ title: document.querySelector('.ask h2')?.textContent || '', text: document.querySelector('.ask__text')?.textContent || '' }));
  await page.click(`.ask-overlay [data-ask="${which}"]`);
  await sleep(300);
  return q;
}
const pathStep = (page, title) => page.evaluate((t) => [...document.querySelectorAll('.bm-path__step')].map((s) => `${s.className.replace('bm-path__step ', '')}: ${s.textContent.replace(/\s+/g, ' ').trim()}`).find((s) => s.includes(`: ${t}`)) || '', title);
const tasks = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} .bm-task`)].map((t) => `${t.querySelector('.bm-task__t')?.textContent.trim()} | ${t.querySelector('.bm-task__s')?.textContent.trim() || ''}`), sel);
const coming = (page) => page.evaluate(() => document.querySelector('.bm-coming')?.innerText.replace(/\s+/g, ' ') || '');
const minutesCard = (page) => page.evaluate(() => [...document.querySelectorAll('.card')].find((c) => /^Minutes template/.test(c.querySelector('h3')?.textContent || ''))?.innerText.replace(/\s+/g, ' ') || '');
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
/** What a read of the minutes changes, as the tester compared it (out-p6*.txt) */
const pick = (m) => ({ minutes: m.minutes, approvedOn: m.approvedOn, minutesFrom: m.minutesFrom?.name || null, agendaFrom: m.agendaFrom ? `${m.agendaFrom.kind}:${m.agendaFrom.name}` : null, files: m.files.map((f) => `${f.name}[${f.kind}]`), attendance: m.attendance.filter((a) => a.status).map((a) => `${a.name}:${a.status}`), motions: m.motions.map((x) => x.text), actions: m.actions.map((x) => x.text), notes: m.sections.flatMap((s) => s.items.filter((i) => i.notes).map((i) => `${i.title}: ${i.notes}`)) });
const item11 = async (id) => (await getMeeting(DB, id)).sections[0].items[0].title;
const ITEM = 'textarea[aria-label="Item 1.1"]';

try {
  // ═══ B1: Undo right after reading minutes in ═══
  await step('B1: Undo after reading the minutes in puts the meeting back on the site; a reload shows it; a tab opened before can’t mark them approved', async () => {
    const before = pick(await getMeeting(DB, HELD.id));
    const A = await open(`/admin/#board/meeting/${HELD.id}`, 1280);
    await (await A.$('.bm-minutes-drop input[type=file]')).uploadFile(MINUTES);
    await A.waitForFunction(() => !document.querySelector('.bm-minutes-drop.is-busy'), { timeout: 60000 });
    await sleep(2500);
    const read = (await toasts(A)).find((t) => /^Read from the minutes/.test(t)) || '';
    ok(!!read, `setup: read in (“${read}”)`);
    const inNow = await getMeeting(DB, HELD.id);
    ok(inNow.minutesFrom?.name === 'Minutes-approve.docx' && inNow.motions.length === 1 && (await getMeeting(DB, SEP.id)).minutes === 'approved', `setup: the site has the minutes, the motion, and Sep’s approved (${inNow.minutesFrom?.name}, ${inNow.motions.length}, ${(await getMeeting(DB, SEP.id)).minutes})`);
    // B: opened now, before the Undo
    const B = await open(`/admin/#board/meeting/${HELD.id}`, 1280);
    ok(await has(B, '.bm-wrap button', /^Mark them approved$/), 'setup: the other tab offers Mark them approved');
    await A.bringToFront();
    await A.evaluate(() => document.querySelector('.bm-minutes-drop__undo')?.click());
    await sleep(3000);
    const said = (await toasts(A)).at(-1) || '';
    // (and that the Sep minutes the read approved are a draft again: Board QA round 8, F6)
    ok(said === `Put back as it was before they were read in, and the ${shortDate(SEP.date)} minutes are a draft again.`, `A says so once the site has it (“${said}”)`);
    const site = await getMeeting(DB, HELD.id);
    ok(JSON.stringify(pick(site)) === JSON.stringify(before), `the site has the meeting as it was (${JSON.stringify(pick(site)).slice(0, 220)})`);
    const sep = await getMeeting(DB, SEP.id);
    ok(sep.minutes === 'draft' && !sep.approvedOn, `Sep’s minutes are draft again (${sep.minutes}, ${sep.approvedOn || 'no day'})`);
    const portal = await (await realFetch(`${SITE}/api/board-portal`, { headers: { 'x-test-user': 'alex.board@example.com' } })).json();
    const pm = (portal.meetings || []).find((x) => x.id === HELD.id);
    ok(pm && !(pm.motions || []).length && !(pm.actions || []).length && !JSON.stringify(pm.sections || []).includes('Revenue is ahead'), `Alex’s board page shows none of the read (${JSON.stringify({ motions: pm?.motions?.length, actions: pm?.actions?.length })})`);
    ok(/^Saved/.test(await saveLine(A)), `A’s line: ${await saveLine(A)}`);
    await shot(A, '01-undo-A');
    await A.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    const drop = await A.evaluate(() => document.querySelector('.bm-minutes-drop strong')?.textContent.trim() || '');
    ok(drop === 'Drop the minutes here', `a reload doesn’t bring them back (“${drop}”)`);
    // B, opened before the Undo: Mark them approved
    await B.bringToFront();
    await press(B, '.bm-wrap button', /^Mark them approved$/);
    await answer(B, 'yes');
    await sleep(4000);
    const bSaid = (await toasts(B)).join(' | ');
    ok((await getMeeting(DB, HELD.id)).minutes === 'draft', `the site refuses B’s approval (${(await getMeeting(DB, HELD.id)).minutes})`);
    ok(/Not marked approved: This meeting’s minutes aren’t in Board yet\. Drop them in first\./.test(bSaid), `and B says why (“${bSaid}”)`);
    ok(!/^Marked approved/.test(bSaid), 'never “Marked approved”');
    await shot(B, '01-undo-B');
    await A.close();
    await B.close();
  });

  // ═══ B2: typing not saved yet, and a file going in ═══
  await step('B2: typed, then a file added before the autosave: the file and the words both reach the site', async () => {
    const A = await open(`/admin/#board/meeting/${AHEAD.id}`, 1280);
    await typeIn(A, ITEM, ' TYPED-QUICK');
    await (await A.$('#bm-packet .bd-pick input[type=file]')).uploadFile(STATEMENT);
    await sleep(4500);
    const m = await getMeeting(DB, AHEAD.id);
    ok(m.files.some((f) => f.name === 'Statement.pdf'), 'the file is on the meeting');
    ok(m.sections[0].items[0].title === 'Roll call TYPED-QUICK', `the site has the words (“${m.sections[0].items[0].title}”)`);
    ok(/^Saved/.test(await saveLine(A)), `the line: ${await saveLine(A)}`);
    await A.close();
  });

  await step('B2: typed with no connection, then Add files: the line never says Saved, and the words save once the connection is back', async () => {
    const A = await open(`/admin/#board/meeting/${AHEAD.id}`, 1280);
    await A.setOfflineMode(true);
    await typeIn(A, ITEM, ' TYPED-OFFLINE');
    ok(await notSaved(A), `setup: not saved (${await saveLine(A)})`);
    await (await A.$('#bm-packet .bd-pick input[type=file]')).uploadFile(PARKING);
    await sleep(2500);
    const line = await saveLine(A);
    ok(!/^Saved/.test(line), `after the file didn’t go, the line still says it isn’t saved (“${line}”)`);
    await shot(A, '02-offline');
    await A.setOfflineMode(false);
    await A.evaluate(() => dispatchEvent(new Event('online')));
    ok(await saved(A), `back online, it saves (${await saveLine(A)})`);
    ok((await item11(AHEAD.id)).endsWith('TYPED-OFFLINE'), `the site has the words (“${await item11(AHEAD.id)}”)`);
    await A.close();
  });

  // Each change the site already has (keepSaved), made while typing can't save (the site failing): the typing stays
  // waiting, the line never says Saved, and it goes once the site answers again
  const FAILING = JSON.stringify({ ok: false, error: 'The site’s database didn’t answer' });
  const HELD2 = await make(day(-2));
  const packetFiles = (p) => p.evaluate(() => document.querySelectorAll('#bm-packet .bf-file:not(.is-up)').length);
  const callers = [
    ['the packet’s Add files', AHEAD, ' K1', async (p) => { const n = await packetFiles(p); await (await p.$('#bm-packet .bd-pick input[type=file]')).uploadFile(STATEMENT); await p.waitForFunction((k) => document.querySelectorAll('#bm-packet .bf-file:not(.is-up)').length > k, { timeout: 8000 }, n); }],
    ['a file’s staff-only switch', AHEAD, ' K2', async (p) => { await p.evaluate(() => document.querySelector('#bm-packet .bf-seen')?.click()); await p.waitForFunction(() => /staff only/i.test((window.__toasts || []).join(' ')), { timeout: 8000 }); }],
    ['Delete the file', AHEAD, ' K3', async (p) => {
      const n = await packetFiles(p);
      await p.evaluate(() => document.querySelector('#bm-packet .bf-file .bd-menu summary')?.click());
      await sleep(400);
      const hit = await p.evaluate(() => { const b = [...document.querySelectorAll('.bd-menu[open] .bd-menu__item')].find((x) => /^Delete the file$/.test(x.textContent.trim())); b?.click(); return !!b; });
      if (!hit) throw new Error('no Delete the file');
      await answer(p, 'yes');
      await p.waitForFunction((k) => document.querySelectorAll('#bm-packet .bf-file:not(.is-up)').length < k, { timeout: 8000 }, n);
      await sleep(1500);
    }],
    ['an item’s Upload a file', AHEAD, ' K4', async (p) => {
      await p.evaluate(() => document.querySelector('summary[aria-label="More for Year to date"]')?.click());
      await sleep(300);
      await press(p, '.bd-menu[open] .bd-menu__item', /^Add a document$/);
      await sleep(400);
      await (await p.$('.agx-docs input[type=file]')).uploadFile(PARKING);
      await sleep(2000);
    }],
    ['the minutes dropped in', HELD2, ' K5', async (p) => {
      await (await p.$('.bm-minutes-drop input[type=file]')).uploadFile(MINUTES2);
      await p.waitForFunction(() => !document.querySelector('.bm-minutes-drop.is-busy'), { timeout: 60000 });
      await sleep(1500);
    }],
    ['the signed copy', HELD2, ' K6', async (p) => {
      await (await p.$('.bm-wrap .bd-pick input[type=file]')).uploadFile(SIGNED);
      await p.waitForFunction(() => /signed copy is kept/i.test((window.__toasts || []).join(' ')), { timeout: 8000 });
    }],
  ];
  for (const [what, M, words, act] of callers) {
    await step(`B2: typed while the site fails to save, then ${what}: the words wait, never “Saved”, and save after`, async () => {
      const A = await open(`/admin/#board/meeting/${M.id}`, 1280);
      const was = await item11(M.id);
      const r = await rule(A, /"action":"save-meeting"/, { n: 100, status: 503, body: FAILING });
      await typeIn(A, ITEM, words);
      ok(await notSaved(A), `setup: the save failed (${await saveLine(A)})`);
      await act(A);
      await sleep(1500);
      const line = await saveLine(A);
      ok(!/^Saved/.test(line), `after ${what}, the line still says it isn’t saved (“${line}”)`);
      await r.off();
      if (await has(A, '.bm-saved button', /^Try again$/)) await press(A, '.bm-saved button', /^Try again$/);
      ok(await saved(A, 20000), `the site answers again: saved (${await saveLine(A)})`);
      const now = await item11(M.id);
      ok(now === `${was}${words}`, `the site has the words (“${now}”)`);
      if (M === HELD2 && what === 'the minutes dropped in') {
        const m = await getMeeting(DB, M.id);
        ok(m.minutesFrom?.name === 'Minutes-held.docx' && JSON.stringify(m.sections).includes('Reserves grew this quarter'), 'and what the minutes put on it is kept with them');
      }
      await A.close();
    });
  }

  // ═══ m1: a send a few seconds after People → Board changed ═══
  await step('m1: Taylor leaves and Ada joins a few seconds after the page opened: the invite’s question, Google, the toast and the page after all name the board as it is', async () => {
    const A = await open(`/admin/#board/meeting/${ROSTER.id}`, 1280);
    ok(/Taylor Nguyen \(Board Secretary\)/.test(await minutesCard(A)), 'setup: the page opens with Taylor the secretary');
    await regroup('taylor-nguyen', 'alumni');
    await regroup('ada-example', 'board');
    await sleep(2000);
    await press(A, '.bm-ready button', /^Send the invite$/);
    const q = await answer(A, 'yes');
    ok(/^Google emails the invite to Alex Rivera, Sam Ortiz and Ada Example, with Google Meet/.test(q.text) && !/Taylor/.test(q.text), `the question names the board as it is (“${q.text.slice(0, 110)}”)`);
    await sleep(3500);
    const given = google.calls.filter((c) => c.method === 'POST').map((c) => (c.body.attendees || []).map((a) => a.email).sort().join(','));
    ok(given.at(-1) === 'ada.board@example.com,alex.board@example.com,sam.board@example.org', `Google is given those three (${given.at(-1) || 'nothing'})`);
    ok((await toasts(A)).includes('Invite sent to Alex Rivera, Sam Ortiz and Ada Example'), `the toast names them (${(await toasts(A)).join(' | ')})`);
    const line = await pathStep(A, 'Invite');
    ok(/^is-done: Invite\s*On Jane’s calendar$/.test(line) && !/Taylor/.test(line), `the status line: nobody missing (“${line}”)`);
    const mailTask = (await tasks(A, '.bm-ready')).find((x) => /^Email the board the link/.test(x)) || '';
    ok(/It goes to 3 board members\./.test(mailTask), `“It goes to 3 board members” (“${mailTask.match(/It goes to [^.]*\./)?.[0]}”)`);
    ok(!/Taylor/.test(await minutesCard(A)), 'the secretary line names nobody who left');
    ok(!/Taylor/.test(await coming(A)) && /Ada Example/.test(await coming(A)), 'Who’s coming agrees');
    // Email the board, Kim given an email between the question and the send: the page follows who it went to
    await A.close();
  });

  // ═══ m2: two windows side by side ═══
  await step('m2: the window given the focus reads Board’s data again: Lee joins, and the page shows it without a save', async () => {
    const A = await open(`/admin/#board/meeting/${ROSTER.id}`, 1280);
    const mailTask = async () => (await tasks(A, '.bm-ready')).find((x) => /^Email the board the link/.test(x)) || '';
    ok(/It goes to 3 board members\./.test(await mailTask()), `setup: 3 with an email (“${(await mailTask()).match(/It goes to [^.]*\./)?.[0]}”)`);
    await regroup('lee-example', 'board');
    await A.evaluate(() => dispatchEvent(new Event('focus')));
    await sleep(2500);
    ok(/It goes to 4 board members\./.test(await mailTask()), `“It goes to 4 board members” (“${(await mailTask()).match(/It goes to [^.]*\./)?.[0]}”)`);
    const line = await pathStep(A, 'Invite');
    ok(/Lee/.test(line) || /Lee Example/.test((await tasks(A, '.bm-ready')).join(' ')), `the status line names Lee as not on the invite yet (“${line}”)`);
    ok(A.saves === 0, `nothing saved (${A.saves})`);
    await A.close();
  });

  // ═══ M1: Members → Email all ═══
  await step('M1: Members → Email all names the board as the site has it at the press, and sends to the list shown', async () => {
    await signInCurrent();
    const A = await open('/admin/#board/members', 1280);
    await regroup('lee-example', 'alumni');
    await sleep(1000);
    await press(A, '.ba-head button', /^Email all$/);
    await A.waitForSelector('.ba-mail__to', { timeout: 8000 });
    const to = await A.evaluate(() => document.querySelector('.ba-mail__to dd')?.textContent.trim() || '');
    ok(to === 'Ada Example, Alex Rivera and Sam Ortiz' && !/Lee|Taylor/.test(to), `To: the board as it is (“${to}”)`);
    const btn = await A.evaluate(() => [...document.querySelectorAll('.btn-primary')].map((b) => b.textContent.trim()).find((t) => /^Send/.test(t)) || '');
    ok(btn === 'Send to all 3', `the button (“${btn}”)`);
    await A.type('#ba-mail-subject', 'Gala volunteers');
    await A.type('#ba-mail-message', 'Can you each bring one friend?');
    // Lee joins again while it's open: Send shows the new list first, and sends nothing until pressed again
    await regroup('lee-example', 'board');
    const g0 = gmailSent.length;
    await press(A, '.btn-primary', /^Send to all 3$/);
    await sleep(2000);
    const lineNow = await A.evaluate(() => document.querySelector('.ba-mail__line')?.textContent.trim() || '');
    ok(/^The board changed since this opened: it goes to Ada Example, Alex Rivera, Lee Example and Sam Ortiz now\. Press Send again/.test(lineNow) && gmailSent.length === g0, `the change is shown, and nothing went (“${lineNow}”)`);
    await press(A, '.btn-primary', /^Send to all 4$/);
    await sleep(3000);
    const out = gmailSent.slice(g0).join('\n');
    ok(gmailSent.length === g0 + 1 && ['ada.board@', 'alex.board@', 'lee.board@', 'sam.board@'].every((e) => out.includes(e)) && !out.includes('taylor.board@'), 'Gmail is given those four');
    ok((await toasts(A)).some((t) => /^Sent to all 4\./.test(t)), `the toast says four (${(await toasts(A)).join(' | ')})`);
    await shot(A, '03-members');
    // Ask the N who haven't signed, as the page shows it (4: Ada, Alex, Lee, Sam); Lee leaves, and Cloudflare's list
    // follows: the question names the 3 the site would email
    await signInCurrent();
    await A.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    ok(await has(A, '.ba-head button', /^Ask the 4 who haven’t signed$/), 'setup: the page asks the 4');
    await regroup('lee-example', 'alumni');
    await signInCurrent();
    const asked = [];
    await A.evaluate(() => [...document.querySelectorAll('.ba-head button')].find((b) => /^Ask the/.test(b.textContent.trim()))?.click());
    await A.waitForSelector('.ask-overlay [data-ask]', { timeout: 8000 });
    asked.push(await A.evaluate(() => document.querySelector('.ask h2')?.textContent || ''));
    await A.click('.ask-overlay [data-ask="no"]');
    ok(asked[0] === 'Email the 3 who haven’t signed?', `the ask names the 3 the site would email (“${asked[0]}”)`);
    await A.close();
  });

  // ═══ m3: approving a "not a board meeting" ahead ═══
  await step('m3: the coffee’s Approve says it makes it a board meeting, the site does so, and Who’s coming never says “No invite yet”', async () => {
    const A = await open(`/admin/#board/meeting/${COFFEE.id}`, 1280);
    const c = await coming(A);
    ok(/It isn’t a board meeting, so no calendar invite goes out for it\./.test(c) && !/No invite yet|hasn’t gone out yet/.test(c), `Who’s coming (“${c.slice(0, 160)}”)`);
    const t = (await tasks(A, '.bm-ready')).find((x) => /^Approve the agenda/.test(x)) || '';
    ok(/It isn’t a board meeting, so the board sees none of it\. Approving its agenda makes it one\./.test(t) && !/chair/i.test(t), `Approve’s line (“${t}”)`);
    await shot(A, '04-coffee-before');
    await press(A, '.bm-ready button', /^Approve the agenda$/);
    const q = await answer(A, 'yes');
    ok(/^It isn’t a board meeting now: approving its agenda makes it one\./.test(q.text), `the question says so (“${q.text.slice(0, 120)}”)`);
    await sleep(3000);
    const said = (await toasts(A)).join(' | ');
    ok(/^Approved, and it’s a board meeting now/.test((await toasts(A)).at(-1) || '') && !/isn’t ahead/.test(said), `the toast (“${said}”)`);
    ok((await getMeeting(DB, COFFEE.id)).notBoard === false, 'the site has it as a board meeting');
    await A.close();
  });

  // ═══ m4, m5: the chair's review and the secretary line ═══
  await step('m4 + m5: the chair’s review is named only when it will happen, with its day; the secretary line says the board page only when it’s on it', async () => {
    await regroup('taylor-nguyen', 'board', 'Board Secretary');
    const s = await api({ action: 'save-settings', settings: { asks: 'on' } });
    ok(s.ok, `setup: the report emails are on (${s.error || 'ok'})`);
    const want = shortDate(new Date(Date.parse(`${FAR.date}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10));
    const approveLine = async (p) => (await tasks(p, '.bm-ready')).find((x) => /^(Approve the agenda|Agenda approved)/.test(x)) || '';
    let A = await open(`/admin/#board/meeting/${FAR.id}`, 1280);
    let t = await approveLine(A);
    ok(t.includes(`The chair gets it to review on ${want}, or approve it here:`), `20 days ahead, not shared: the chair’s day (“${t}”)`);
    let mc = await minutesCard(A);
    ok(mc.includes('Once the meeting is shared, Taylor Nguyen (Board Secretary) has it on the board page too, and can send the typed minutes from there.'), `not on the board page: the secretary has it there once it’s shared (“${mc.slice(0, 220)}”)`);
    await shot(A, '06-far');
    await A.close();
    A = await open(`/admin/#board/meeting/${TODAY.id}`, 1280);
    t = await approveLine(A);
    ok(!!t && !/chair/i.test(t), `on its own day: no chair’s review (“${t}”)`);
    await A.close();
    A = await open(`/admin/#board/meeting/${ROSTER.id}`, 1280);
    mc = await minutesCard(A);
    ok(/(^|\. )Taylor Nguyen \(Board Secretary\) has it on the board page too/.test(mc) && !/Once the meeting is shared/.test(mc), `on the board page: the secretary has it there (“${mc.slice(0, 220)}”)`);
    await A.close();
    await api({ action: 'save-settings', settings: { asks: 'test' } });
  });

  // ═══ m7: a template part with no name ═══
  await step('m7: the template says a part with no name isn’t added to new meetings', async () => {
    const A = await open('/admin/#board/template', 1280);
    await A.evaluate(() => document.querySelector('.agx-addsec')?.click());
    await sleep(900);
    const note = await A.evaluate(() => { const secs = document.querySelectorAll('.agx-sec'); return secs[secs.length - 1].querySelector('.agx-sec__unnamed')?.textContent.trim() || ''; });
    ok(note === 'This part isn’t added to new meetings until it has a name.', `beside the part (“${note}”)`);
    await shot(A, '05-template-unnamed');
    await A.keyboard.type('Gala');
    await sleep(500);
    const after = await A.evaluate(() => { const secs = document.querySelectorAll('.agx-sec'); return !!secs[secs.length - 1].querySelector('.agx-sec__unnamed'); });
    ok(!after, 'named, it goes');
    // (the part taken off again, so the template is as it was)
    await A.evaluate(() => { const secs = document.querySelectorAll('.agx-sec'); secs[secs.length - 1].querySelector('summary')?.click(); });
    await sleep(300);
    if (await has(A, '.bd-menu[open] .bd-menu__item', /^Delete the part$/)) await press(A, '.bd-menu[open] .bd-menu__item', /^Delete the part$/);
    await sleep(2500);
    await A.close();
  });

  // ═══ m8: a founder's own other tab ═══
  await step('m8: the same thing changed in two of Jane’s tabs: the question says “You changed this meeting in another tab”, never her own name', async () => {
    const A = await open(`/admin/#board/meeting/${TWO.id}`, 1280);
    const B = await open(`/admin/#board/meeting/${TWO.id}`, 1280);
    await typeIn(A, ITEM, ' (A)');
    ok(await saved(A), 'A saves');
    await B.bringToFront();
    await typeIn(B, ITEM, ' (B)');
    const q = await answer(B, 'yes');
    ok(q.title === 'You changed this meeting in another tab too' && !/Jane/.test(`${q.title} ${q.text}`), `the question (“${q.title}”: “${q.text}”)`);
    ok(await saved(B), 'B saves');
    await A.close();
    await B.close();
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
