/**
 * test-board-round7.mjs: the founders' Board admin (the meeting editor, the minutes, its pop-ups), as QA round 7 found
 * it (Nov 21 2026)
 * ================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round6.mjs
 * does; Google (Calendar and Gmail), Resend and Workers AI are faked and record what they're given. Made-up people only.
 *   - M1: Undo after the heartbeat finished reading the minutes takes their decision and action item off too (on the
 *     site, the page and the board page), and says exactly what it put back
 *   - M2: a founder's other tab shows what was done elsewhere once Board reads again (the invite sent, the board
 *     emailed, the minutes approved), typing not saved yet included; every send's question is built from the site's
 *     copy at the press (an approval done elsewhere is said, never asked again); Undo's no carries the meeting, and the
 *     page takes it
 *   - m4: a pop-up stays with its button whatever moves the button; one whose button leaves the window closes, or
 *     (with nothing to close it) hides until its button is back, never over another item
 *   - m5: minutes with only who was there never say "notes under 1 item" for the agenda's own background notes
 *   - m3: the chair's review page of a meeting already on the board page, its agenda never approved, is kept and shown
 *     as over (said plainly, nothing to approve), to the chair and a founder, at 390 and 1280; a stale Approve sends
 *     nothing (the review email itself: tests/board-asks.test.mjs, "round 7 m3")
 * Screenshots land in test-results/board-round7/. Exits non-zero on any failure.
 *
 *   PORT=4711 node scripts/test-board-round7.mjs
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
import { saveMeeting, getMeeting, provideBoardFinance, patchMeeting, saveDoc } from '../functions/api/_board.js';
import { everyoneSignIns } from '../functions/api/_board-access.js';
import { writeState } from '../functions/api/_board-roles.js';
import { cleanMeeting, shortDate } from '../public/admin/board-shared.js';
import { maybeFinishMinutes } from '../functions/api/_board-minutes.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round7/');
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
// Workers AI: down (the tester's /__qa/aifail) or answering with what the model reads from the minutes
const ai = { down: false };
const MODEL = { attendance: [], motions: [{ text: 'Approve the 2027 budget', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }], actions: [{ text: 'Send the venue contract', owner: 'Alex Rivera', due: '' }], approvedPrev: false };
env.AI = { run: async () => { if (ai.down) throw new Error('test: Workers AI down'); return { response: MODEL }; }, toMarkdown: async (f) => ({ name: f.name, format: 'markdown', data: '' }) };
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
// The tester's Minutes-A (notes under four items, nothing the rules read as a decision) and Minutes-D (who was there only)
const MINUTES_A = join(OUT, 'Minutes-A.docx');
writeFileSync(MINUTES_A, minutesDocx([['CALL TO ORDER', 0], ['Roll Call', 1], ['Quorum present', 2], ['FINANCE', 0], ['Year to date', 1], ['ALPHA revenue is ahead of budget', 2], ['The 2027 budget', 1], ['ALPHA budget discussed', 2], ['OPEN FORUM', 0], ['Questions from the board', 1], ['ALPHA no questions', 2]]));
const plainDocx = (paras) => zip({ 'word/document.xml': `<w:document><w:body>${paras.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` });
const MINUTES_D = join(OUT, 'Minutes-D.docx');
writeFileSync(MINUTES_D, plainDocx(['Q4 2026 Board Meeting Minutes', 'Present: Alex Rivera, Sam Ortiz, Taylor Nguyen', 'Absent: Kim Park', 'The meeting was called to order at 8:02 AM and adjourned at 9:55 AM.']));

// ── The meetings ──
const board = (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
// The tester's Nov 30: its 2.1 has background notes written on the agenda
const AGENDA = [
  { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
  { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash', notes: '- Revenue against budget\n- Cash over the next 13 weeks' }, { title: 'The 2027 budget', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] },
  { title: 'Programs', items: [{ title: 'Makeovers in progress' }, { title: 'The spring volunteer day' }] },
  { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', address: '100 Example Street, Atlanta, GA 30301', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
const shared = async (date, { approved = false, ...more } = {}) => {
  const m = await patchMeeting(DB, (await make(date, more)).id, (cur) => ({ ...cur, shared: true }));
  if (approved) await agendaApproved(DB, m.id);
  return m;
};
// M1: held yesterday; m5: held three days ago; M2's minutes: held two days ago
const HB = await shared(day(-1));
const MIN = await shared(day(-2));
const M5 = await shared(day(-3));
// M2: ahead and on the board page (the invite in two tabs, and one pressed stale; the email, approved)
const INV = await shared(day(9));
const INV2 = await shared(day(10));
const MAIL = await shared(day(11), { approved: true });
const MAIL2 = await shared(day(12), { approved: true });
const TYPE = await shared(day(13), { approved: true });
const APP = await shared(day(14));
// m4: ahead, not shared, for its pop-ups
const POP = await make(day(20));

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
// (a port of its own, 4711 to 4713, or any free one with PORT=0)
const PORT = Number(process.env.PORT ?? 4711);
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
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
/** The tab out of view and back, then the window given the focus (as a switch to another tab and back does) */
async function hideShow(page) {
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(500);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new Event('focus')); });
  await sleep(2500);
}
/**
 * Every board send's record made `min` minutes older, as if that long had passed since it went (the tester's /__qa/age),
 * and the meeting's own record of when the board was emailed (`id`) with it
 */
async function age(min, id) {
  const back = (t) => (t ? new Date(Date.parse(t) - min * 60000).toISOString() : t);
  if (id) await patchMeeting(DB, id, (cur) => ({ ...cur, packetSentAt: back(cur.packetSentAt) }));
  for (const r of (await DB.prepare("SELECT key, data, updated_at FROM board_state WHERE key LIKE 'board-send:%'").all()).results || []) {
    const d = JSON.parse(r.data || '{}');
    if (d.had) for (const k of Object.keys(d.had)) d.had[k] = back(d.had[k]);
    if (d.at) d.at = back(d.at);
    await DB.prepare('UPDATE board_state SET data = ?, updated_at = ? WHERE key = ?').bind(JSON.stringify(d), back(r.updated_at), r.key).run();
  }
}
const minutesDoc = (page) => page.evaluate(() => document.querySelector('.bm-minutes')?.innerText.replace(/\s+/g, ' ') || '');
/** What a read of the minutes changes, as the tester compared it (out-p1-hb.txt) */
const pick = (m) => ({ minutes: m.minutes, minutesFrom: m.minutesFrom?.name || null, files: m.files.map((f) => `${f.name}[${f.kind}]`), attendance: m.attendance.filter((a) => a.status).map((a) => `${a.name}:${a.status}`), motions: m.motions.map((x) => x.text), actions: m.actions.map((x) => x.text), notes: m.sections.flatMap((s) => s.items.filter((i) => i.notes).map((i) => `${i.title}: ${i.notes}`)) });
const ITEM = 'textarea[aria-label="Item 1.1"]';
/** Drops a minutes file on the page and waits for the read */
async function drop(page, file) {
  await (await page.$('.bm-minutes-drop input[type=file]')).uploadFile(file);
  await sleep(800);
  await page.waitForFunction(() => !document.querySelector('.bm-minutes-drop.is-busy'), { timeout: 60000 });
  await sleep(2000);
  return (await toasts(page)).find((t) => /^Read from the minutes/.test(t)) || '';
}
const portalOf = async (id) => ((await (await realFetch(`${SITE}/api/board-portal`, { headers: { 'x-test-user': 'alex.board@example.com' } })).json()).meetings || []).find((x) => x.id === id);

try {
  // ═══ M1: Undo after the heartbeat finished reading the minutes ═══
  await step('M1: Undo after the heartbeat finished reading the minutes takes their decision and action item off the site, the page and the board page, and says so', async () => {
    const before = pick(await getMeeting(DB, HB.id));
    const A = await open(`/admin/#board/meeting/${HB.id}`, 1280);
    ai.down = true;
    const read = await drop(A, MINUTES_A);
    ai.down = false;
    ok(/^Read from the minutes: notes under 4 items/.test(read) && !/decision|action item/.test(read), `setup: read by the rules alone, no decision yet (“${read}”)`);
    ok((await maybeFinishMinutes(env)) === HB.id, 'setup: the heartbeat reads them again with the model');
    const fin = await getMeeting(DB, HB.id);
    ok(fin.motions.length === 1 && fin.actions.length === 1, `setup: their decision and action item are on the site (${fin.motions.map((x) => x.text)} / ${fin.actions.map((x) => x.text)})`);
    await A.evaluate(() => document.querySelector('.bm-minutes-drop__undo')?.click());
    await sleep(3500);
    const said = (await toasts(A)).at(-1) || '';
    ok(said === 'Put back as it was before they were read in. The decision and the action item Board read from them afterwards are off too.', `the words say exactly what it put back (“${said}”)`);
    const site = await getMeeting(DB, HB.id);
    ok(JSON.stringify(pick(site)) === JSON.stringify(before), `the site has the meeting as it was (${JSON.stringify({ motions: site.motions.map((x) => x.text), actions: site.actions.map((x) => x.text), minutesFrom: site.minutesFrom?.name || null })})`);
    const doc = await minutesDoc(A);
    ok(!/Approve the 2027 budget|Send the venue contract/.test(doc), `the page shows neither (“${doc.slice(0, 160)}”)`);
    const pm = await portalOf(HB.id);
    ok(pm && !(pm.motions || []).length && !(pm.actions || []).length, `Alex’s board page shows neither (${JSON.stringify({ motions: pm?.motions?.length, actions: pm?.actions?.length })})`);
    await shot(A, '01-m1-undo');
    await A.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    ok(!/Approve the 2027 budget|Send the venue contract/.test(await minutesDoc(A)), 'a reload brings neither back');
    await A.close();
  });

  // ═══ M2: what another tab did shows, and every send's question is the site's ═══
  await step('M2: B sends the invite; A, back in view, shows it out and offers no Send the invite', async () => {
    const A = await open(`/admin/#board/meeting/${INV.id}`, 1280);
    const B = await open(`/admin/#board/meeting/${INV.id}`, 1280);
    ok(/^is-next: Invite\s*Not sent$/.test(await pathStep(A, 'Invite')), `setup: A says Not sent (“${await pathStep(A, 'Invite')}”)`);
    await B.bringToFront();
    await press(B, '.bm-ready button', /^Send the invite$/);
    await answer(B, 'yes');
    await sleep(3500);
    ok(!!(await getMeeting(DB, INV.id)).invite?.eventId, 'setup: B sent it');
    await A.bringToFront();
    await hideShow(A);
    const line = await pathStep(A, 'Invite');
    ok(/^is-done: Invite\s*On Jane’s calendar$/.test(line), `A’s status line shows it out (“${line}”)`);
    ok(!(await has(A, '.bm-ready button', /^Send the invite$/)), 'A offers no Send the invite');
    ok(A.saves === 0, `A saved nothing to show it (${A.saves})`);
    await shot(A, '02-m2-invite-A');
    await A.close();
    await B.close();
  });

  await step('M2: the invite sent elsewhere while A sat open: A’s press says it’s out, asks nothing, and nothing goes again', async () => {
    const A = await open(`/admin/#board/meeting/${INV2.id}`, 1280);
    const r = await api({ action: 'send-invite', id: INV2.id });
    ok(r.ok, `setup: sent from elsewhere (${r.error || 'ok'})`);
    const posts = google.calls.filter((c) => c.method === 'POST').length;
    await press(A, '.bm-ready button', /^Send the invite$/);
    await sleep(2500);
    const q = await A.evaluate(() => document.querySelector('.ask h2')?.textContent || '');
    if (q) await answer(A, 'no');
    ok(!q, `no question (“${q}”)`);
    const said = (await toasts(A)).at(-1) || '';
    ok(/^The invite went out just now, and everyone on the board is on it, so nothing went again\.$/.test(said), `A says it’s out (“${said}”)`);
    ok(google.calls.filter((c) => c.method === 'POST').length === posts, 'Google is asked for nothing more');
    ok(/^is-done: Invite\s*On Jane’s calendar$/.test(await pathStep(A, 'Invite')), `and A shows it (“${await pathStep(A, 'Invite')}”)`);
    await A.close();
  });

  await step('M2: B emails the board; A, back in view, shows it; 11 minutes on, A’s press asks to email them again, never the first-time question', async () => {
    const A = await open(`/admin/#board/meeting/${MAIL.id}`, 1280);
    const B = await open(`/admin/#board/meeting/${MAIL.id}`, 1280);
    await B.bringToFront();
    await press(B, '.bm-ready button', /^Email the board$/);
    await answer(B, 'yes');
    await sleep(3500);
    const sent = mail.length;
    ok(!!(await getMeeting(DB, MAIL.id)).packetSentAt && sent === 3, `setup: B emailed 3 (${sent})`);
    await A.bringToFront();
    await hideShow(A);
    const line = await pathStep(A, 'Board emailed');
    ok(/^is-done: Board emailed\s*3 members/.test(line), `A’s status line shows it (“${line}”)`);
    ok(await has(A, '.bm-ready button', /^Email again$/), 'A offers Email again, not Email the board');
    await age(11, MAIL.id);
    await press(A, '.bm-ready button', /^Email again$/);
    const q = await answer(A, 'no');
    ok(/ the link again\?$/.test(q.title), `the question asks again (“${q.title}”)`);
    ok(/^3 board members were emailed the link 11 min ago\. /.test(q.text), `and says when they were (“${q.text.slice(0, 80)}”)`);
    ok(mail.length === sent, `nobody emailed a second time (${mail.length - sent})`);
    await shot(A, '03-m2-email-A');
    await A.close();
    await B.close();
  });

  await step('M2: the board emailed elsewhere while A sat open: A’s Email the board asks to email them again, with when', async () => {
    const A = await open(`/admin/#board/meeting/${MAIL2.id}`, 1280);
    const r = await api({ action: 'send-packet', id: MAIL2.id });
    ok(r.ok, `setup: emailed from elsewhere (${r.error || r.sent})`);
    const sent = mail.length;
    await press(A, '.bm-ready button', /^Email the board$/);
    const q = await answer(A, 'no');
    ok(/ the link again\?$/.test(q.title), `the question is built from the site’s copy (“${q.title}”)`);
    ok(/^3 board members were emailed the link just now\. /.test(q.text), `(“${q.text.slice(0, 80)}”)`);
    ok(mail.length === sent, 'nothing went');
    await A.close();
  });

  await step('M2: the agenda approved elsewhere while A sat open: A’s Approve the agenda says so, asks nothing and sends nothing', async () => {
    const A = await open(`/admin/#board/meeting/${APP.id}`, 1280);
    const r = await api({ action: 'approve-agenda', id: APP.id });
    ok(r.ok, `setup: approved from elsewhere, Jane’s other tab (${r.error || r.approvedBy})`);
    const sent = mail.length;
    await press(A, '.bm-ready button', /^Approve the agenda$/);
    await sleep(2500);
    const q = await A.evaluate(() => document.querySelector('.ask h2')?.textContent || '');
    if (q) await answer(A, 'no');
    ok(!q, `no question (“${q}”)`);
    const said = (await toasts(A)).at(-1) || '';
    ok(said === 'You approved it already just now, maybe in another tab', `A says so, as hers (“${said}”)`);
    ok(/^is-done: Approved/.test(await pathStep(A, 'Approved')), `and shows it (“${await pathStep(A, 'Approved')}”)`);
    ok(mail.length === sent, 'nothing more went');
    await A.close();
  });

  await step('M2: minutes read in A; B marks them approved; A, back in view, shows them approved; its Undo is refused and A still shows them approved', async () => {
    const A = await open(`/admin/#board/meeting/${MIN.id}`, 1280);
    const read = await drop(A, MINUTES_A);
    ok(/^Read from the minutes/.test(read), `setup: read in (“${read}”)`);
    const B = await open(`/admin/#board/meeting/${MIN.id}`, 1280);
    await press(B, '.bm-wrap button', /^Mark them approved$/);
    await answer(B, 'yes');
    await sleep(3500);
    ok((await getMeeting(DB, MIN.id)).minutes === 'approved', 'setup: B marked them approved');
    await A.bringToFront();
    await hideShow(A);
    ok(/^The minutes Approved/.test(await minutesDoc(A)), `A shows them approved (“${(await minutesDoc(A)).slice(0, 60)}”)`);
    ok(await has(A, '.bm-wrap button', /^Mark as draft$/), 'A offers Mark as draft, not Mark them approved');
    await A.evaluate(() => document.querySelector('.bm-minutes-drop__undo')?.click());
    await sleep(3000);
    const said = (await toasts(A)).at(-1) || '';
    ok(/^These minutes were marked approved after they were read in, so Undo leaves them as they are\./.test(said), `Undo is refused, in words (“${said}”)`);
    ok(/^The minutes Approved/.test(await minutesDoc(A)), 'A still shows them approved');
    ok((await getMeeting(DB, MIN.id)).minutes === 'approved', 'and so does the site');
    await shot(A, '04-m2-approve-A');
    await A.close();
    await B.close();
  });

  await step('M2: approved elsewhere while A sat open: Undo’s no carries the meeting, and A shows them approved', async () => {
    // (MIN's minutes back to draft, read in again in A, then approved by a save from elsewhere)
    const c0 = await getMeeting(DB, MIN.id);
    await api({ action: 'save-meeting', meeting: { ...c0, minutes: 'draft', approvedOn: '' }, base: c0.updatedAt });
    const A = await open(`/admin/#board/meeting/${MIN.id}`, 1280);
    await drop(A, MINUTES_A);
    const cur = await getMeeting(DB, MIN.id);
    const r = await api({ action: 'save-meeting', meeting: { ...cur, minutes: 'approved', approvedOn: cur.date }, base: cur.updatedAt });
    ok(r.ok, `setup: approved elsewhere (${r.error || 'ok'})`);
    ok(!/^The minutes Approved/.test(await minutesDoc(A)), 'setup: A doesn’t know yet');
    await A.evaluate(() => document.querySelector('.bm-minutes-drop__undo')?.click());
    await sleep(3000);
    ok(/^These minutes were marked approved after they were read in/.test((await toasts(A)).at(-1) || ''), `refused (“${(await toasts(A)).at(-1)}”)`);
    ok(/^The minutes Approved/.test(await minutesDoc(A)), `A takes the meeting the no carries: approved (“${(await minutesDoc(A)).slice(0, 60)}”)`);
    await A.close();
  });

  await step('M2: typing not saved yet when the site’s newer copy comes in: it comes in under the typing; nothing typed is lost and nothing done elsewhere is hidden', async () => {
    const A = await open(`/admin/#board/meeting/${TYPE.id}`, 1280);
    const r = await api({ action: 'send-invite', id: TYPE.id });
    ok(r.ok, `setup: the invite sent elsewhere (${r.error || 'ok'})`);
    // (its saves held off for now: what shows is Board's read of the site, never a save's merge)
    const held = await rule(A, /"action":"save-meeting"/, { n: 99, status: 503, body: '{"ok":false,"error":"test: held"}' });
    await typeIn(A, ITEM, ' TYPED-A');
    await A.evaluate(() => dispatchEvent(new Event('focus')));
    const shown = await A.waitForFunction(() => [...document.querySelectorAll('.bm-path__step')].some((s) => /^Invite\s*On Jane’s calendar$/.test(s.textContent.replace(/\s+/g, ' ').trim())), { timeout: 6000 }).then(() => true, () => false);
    ok(shown, `the invite shows from Board’s read, with no save gone (${shown ? 'shown' : 'not shown'}; ${held.st.hits} saves held)`);
    ok((await A.$eval(ITEM, (t) => t.value)) === 'Roll call TYPED-A', `the typing stays (“${await A.$eval(ITEM, (t) => t.value)}”)`);
    ok(!/^Saved/.test(await saveLine(A)), `and isn’t said saved while it isn’t (“${await saveLine(A)}”)`);
    await held.off();
    ok(await saved(A, 20000), `then it saves (${await saveLine(A)})`);
    const site = await getMeeting(DB, TYPE.id);
    ok(site.sections[0].items[0].title === 'Roll call TYPED-A' && !!site.invite?.eventId, `the site has both (“${site.sections[0].items[0].title}”, invite ${site.invite ? 'on' : 'gone'})`);
    await A.close();
  });

  // ═══ m4: pop-ups stay with their buttons ═══
  const popAt = (page, kind) => page.evaluate((k) => {
    const btn = k === 'menu' ? [...document.querySelectorAll('.agx-item .bd-menu > summary')].at(-1) : [...document.querySelectorAll('.agx-item .bd-who .bd-pop__btn')].at(-1);
    const panel = [...document.querySelectorAll('.bd-pop__panel, details.bd-menu[open] .bd-menu__list')].find((x) => x.getBoundingClientRect().height);
    const q = btn.getBoundingClientRect();
    if (!panel) return { closed: true, btn: [Math.round(q.top), Math.round(q.bottom)], inner: innerHeight };
    const p = panel.getBoundingClientRect();
    return { btn: [Math.round(q.top), Math.round(q.bottom)], panel: [Math.round(p.top), Math.round(p.bottom)], gap: Math.min(Math.abs(Math.round(p.top - q.bottom)), Math.abs(Math.round(q.top - p.bottom))), inner: innerHeight };
  }, kind);
  const openPop = (page, kind, lift = 200) => page.evaluate((k, up) => {
    // (the scroll stays where the test puts it: no scroll anchoring to hide the move, so the button moves as it did for the tester)
    document.documentElement.style.overflowAnchor = 'none';
    const btn = k === 'menu' ? [...document.querySelectorAll('.agx-item .bd-menu > summary')].at(-1) : [...document.querySelectorAll('.agx-item .bd-who .bd-pop__btn')].at(-1);
    btn.scrollIntoView({ block: 'end' });
    scrollBy(0, up);
    btn.click();
  }, kind, lift);
  const grow = (page, px) => page.evaluate((h) => {
    let d = document.querySelector('.r7-grow');
    if (!d) { d = document.createElement('div'); d.className = 'r7-grow'; document.querySelector('.agx')?.before(d); }
    d.style.height = `${h}px`;
  }, px);
  for (const [W, kind] of [[820, 'menu'], [1100, 'menu'], [820, 'who'], [1100, 'who']]) {
    await step(`m4: ${W} wide, the last item’s ${kind === 'menu' ? '⋯' : 'Who presents'}: content filling in above moves its button, and the pop-up moves with it`, async () => {
      const A = await open(`/admin/#board/meeting/${POP.id}`, W);
      await A.setViewport({ width: W, height: 820 });
      await sleep(800);
      await openPop(A, kind);
      await sleep(500);
      const a = await popAt(A, kind);
      ok(!a.closed && a.gap <= 12, `setup: open beside its button (${JSON.stringify(a)})`);
      await grow(A, 35);
      await sleep(600);
      const b = await popAt(A, kind);
      ok(b.btn[0] - a.btn[0] >= 30, `setup: its button moved down (${a.btn[0]} → ${b.btn[0]})`);
      ok(!b.closed && b.gap <= 12, `the pop-up is still with its button (${JSON.stringify(b)})`);
      if (b.gap > 12) await shot(A, `05-m4-${W}-${kind}`);
      await A.close();
    });
  }
  await step('m4: 768 wide, the last item’s ⋯: its button pushed out of the window, the menu closes, never sitting over other items', async () => {
    const A = await open(`/admin/#board/meeting/${POP.id}`, 768);
    await A.setViewport({ width: 768, height: 820 });
    await sleep(800);
    await openPop(A, 'menu', 20);
    await sleep(500);
    const a = await popAt(A, 'menu');
    ok(!a.closed, `setup: open (${JSON.stringify(a)})`);
    await grow(A, 120);
    await sleep(800);
    const b = await popAt(A, 'menu');
    ok(b.btn[0] + (b.btn[1] - b.btn[0]) / 2 > b.inner, `setup: its button is below the window (${JSON.stringify(b.btn)})`);
    ok(!!b.closed, `the menu closed (${JSON.stringify(b)})`);
    if (!b.closed) await shot(A, '05-m4-768-menu');
    await A.close();
  });
  await step('m4: a pop-up with nothing to close it (float() with no onHide) follows a button that moves, hides while it’s out of the window, and is back with it', async () => {
    const P = await browser.newPage();
    await P.setViewport({ width: 900, height: 700 });
    await P.goto(`${SITE}/r7-blank-page`);
    await P.evaluate(async () => {
      document.body.innerHTML = '<div id="top" style="height:300px"></div><button id="b" style="margin-left:40px;height:30px">Open</button><ul id="l" style="list-style:none;margin:0;padding:8px;background:#eee;width:200px"><li>One</li><li>Two</li></ul><div style="height:3000px"></div>';
      const { float } = await import('/admin/float.js');
      window.__stop = float(document.getElementById('l'), { anchor: document.getElementById('b'), align: 'start' });
    });
    const at = () => P.evaluate(() => { const b = document.getElementById('b').getBoundingClientRect(); const l = document.getElementById('l'); return { gap: Math.round(l.getBoundingClientRect().top - b.bottom), shown: getComputedStyle(l).visibility !== 'hidden' }; });
    const a = await at();
    ok(a.gap === 4 && a.shown, `setup: under its button (${JSON.stringify(a)})`);
    await P.evaluate(() => { document.getElementById('top').style.height = '340px'; });
    await sleep(300);
    const b = await at();
    ok(b.gap === 4 && b.shown, `content above grew: it follows (${JSON.stringify(b)})`);
    await P.evaluate(() => { document.getElementById('top').style.height = '1200px'; });
    await sleep(300);
    const c = await at();
    ok(!c.shown, `its button out of the window: hidden, never left over the page (${JSON.stringify(c)})`);
    await P.evaluate(() => { document.getElementById('top').style.height = '300px'; });
    await sleep(300);
    const d = await at();
    ok(d.gap === 4 && d.shown, `its button back: so is it (${JSON.stringify(d)})`);
    await P.evaluate(() => window.__stop());
    await P.close();
  });

  // ═══ m5: "notes under N items" counts what the minutes filled ═══
  await step('m5: minutes with only who was there, on a meeting whose 2.1 has background notes, never say “notes under 1 item”', async () => {
    const A = await open(`/admin/#board/meeting/${M5.id}`, 1280);
    ai.down = true;
    const read = await drop(A, MINUTES_D);
    ai.down = false;
    ok(/^Read from the minutes: 3 of 4 board members there/.test(read), `setup: who was there is read (“${read}”)`);
    ok(!/notes under/.test(read), `no notes said (“${read}”)`);
    const line = await A.evaluate(() => document.querySelector('.bm-minutes-drop')?.innerText.replace(/\s+/g, ' ') || '');
    ok(!/notes under/.test(line), `nor on the drop (“${line.slice(0, 120)}”)`);
    await A.close();
  });

  // ═══ m3: the chair's review of a meeting already on the board page: kept, shown as over ═══
  await step('m3: the review page of a meeting on the board page, its agenda never approved: shown as over with nothing to approve, to the chair and a founder, at 390 and 1280', async () => {
    const st = await api({ action: 'save-settings', settings: { asks: 'on' } });
    ok(st.ok, `setup: the review emails on (${st.error || 'on'})`);
    const m = await getMeeting(DB, INV.id);
    ok(m.shared && !(await DB.prepare("SELECT 1 AS x FROM board_asks WHERE kind = 'chair' AND meeting_id = ?").bind(INV.id).first().catch(() => null)), 'setup: the next meeting is on the board page, its agenda not approved');
    for (const [who, email] of [['chair', 'alex.board@example.com'], ['founder', FOUNDER]]) {
      for (const W of [390, 1280]) {
        const P = await browser.newPage();
        const phone = W < 600;
        await P.setViewport({ width: W, height: phone ? 800 : 900, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
        await P.setExtraHTTPHeaders({ 'x-test-user': email });
        P.on('pageerror', (e) => errs.push(`${who} ${W} PAGEERROR ${e.message}`));
        await P.goto(`${SITE}/admin/board/#/meetings/${INV.id}/review`, { waitUntil: 'networkidle0' });
        await P.waitForFunction(() => !document.querySelector('.bp-boot'), { timeout: 30000 }).catch(() => {});
        await sleep(1200);
        const act = await P.evaluate(() => document.querySelector('.cr-head .cr-head__act')?.innerText.replace(/\s+/g, ' ').trim() || '');
        ok(act === 'It’s on the board page already, so there’s nothing left to review.', `${who} ${W}: said plainly (“${act}”)`);
        ok(!(await P.$('.cr-approve')), `${who} ${W}: no Approve to press`);
        ok(!!(await P.$('.cr-parts .cr-item')), `${who} ${W}: the agenda is there, item by item`);
        const tools = await P.evaluate(() => [...document.querySelectorAll('.cr-item__tools button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
        ok(tools.some((t) => /Add a note/.test(t)), `${who} ${W}: what an approved agenda offers is still there (${[...new Set(tools)].join(', ')})`);
        ok((await P.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${who} ${W}: no sideways scroll`);
        await P.screenshot({ path: join(OUT, `06-m3-review-${who}-${W}.png`) });
        await P.close();
      }
    }
    // An Approve pressed on a page from before (or sent by hand): said in words, nothing shared or emailed, nothing approved
    const [sent, gm] = [mail.length, gmailSent.length];
    const r = await (await realFetch(`${SITE}/api/board-portal`, { method: 'POST', headers: { 'x-test-user': 'alex.board@example.com', 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify({ action: 'chair-approve', meetingId: INV.id }) })).json();
    ok(!r.ok && r.over === true && r.error === 'It’s on the board page already, so there’s nothing left to review.', `the chair’s Approve is answered in words (${JSON.stringify(r).slice(0, 160)})`);
    ok(mail.length === sent && gmailSent.length === gm, `nothing emailed (${mail.length - sent} + ${gmailSent.length - gm})`);
    ok(!(await DB.prepare("SELECT 1 AS x FROM board_asks WHERE kind = 'chair' AND meeting_id = ? AND status = 'approved'").bind(INV.id).first()), 'nothing kept as approved');
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
