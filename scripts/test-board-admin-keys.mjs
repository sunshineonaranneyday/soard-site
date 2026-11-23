/**
 * test-board-admin-keys.mjs: Board admin as a keyboard, a bad connection and a busy quarter find it
 * ================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-minutes.mjs
 * does; Google (Calendar, Meet, the board@ group), Resend and the minutes reader's AI are faked. Made-up people only.
 *   - the focus never lands on, or one key from, a send: "Send me the reminder", a real reminder, "Send me the email",
 *     a failed send; and never on the page after Delete the part, Mark done, the minutes' Undo, New meeting's Add,
 *     Delete this meeting; "Private note" from ⋯ goes into the note; ⋯ type-ahead takes "m " without an error
 *   - leaving: a change made a moment before saves and nothing asks; while Board can't save, "Leave without saving?"
 *     asks, and leaving then saves nothing, after the connection comes back too
 *   - a send whose answer is lost says so in words (never "HTTP 502"), looks at what the site has (the board emailed),
 *     and the next press of one that can't be known says so first, on Cancel
 *   - "Approve the agenda?" says what happens before it's pressed: nothing yet while the board hasn't had the email on
 *     how to sign in; the board page and the email once they have
 *   - minutes the board approved don't come up for approval on the next agenda, and a written agenda says them approved
 *   - a guest typed in as "Dana Smith, CPA" is one presenter; minutes whose roll names nobody never read as everyone away
 *   - a save that doesn't go never shows a code or two full stops; two meetings in one quarter are told apart to delete
 * Round 2 (Nov 19 2026):
 *   - Board's home names the next step its meeting page names (one rule, ./board-meeting.js pathOf): after the invite, the
 *     approval, never "put the meeting on the board page" the page has no Share for yet; its Agenda chip as the page's
 *   - the agenda template keeps a change on the way out as a meeting does: a reload or closing the tab asks and saves it,
 *     one made offline keeps trying once the page is left (never "Try again beside Not saved" on a page with no such
 *     button), and while it can't save, "Leave without saving?" asks and nothing goes after
 *   - an evening's approval, email and file say the day it was in Atlanta, never tomorrow's (UTC's)
 *   - home's "Send me the email" leaves the focus on the action items' heading, never the page or a send
 *   - a held meeting's line says what happened ("None sent from Board"), never a chore that no longer applies; "1 report"
 *   - a notes box shows all its words, as wide as its item, on a phone and a tablet (and where field-sizing isn't)
 *   - a save refused because the meeting was deleted elsewhere says so, stops saving, and offers the way back
 * Screenshots land in test-results/board-admin-keys/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-admin-keys.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, getMeeting, listMeetings, provideBoardFinance, maybeTemplateAgendas, patchMeeting, putFile } from '../functions/api/_board.js';
import { writeState } from '../functions/api/_board-roles.js';
import { cleanMeeting, meetingName, nextMeeting, shortDate, reportsOn } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-admin-keys/');
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

// ── The outside world, faked ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const calendar = { [FOUNDER]: [] };
const env = {
  GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }),
  DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test',
  // The minutes reader's AI: nobody's attendance (the roll in the file names nobody), a decision and an action item
  AI: { run: async () => ({ response: { attendance: [], motions: [{ text: 'Approve the 2027 budget', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }], actions: [{ text: 'Send the venue contract', owner: 'Alex Rivera', due: '' }], approvedPrev: false } }), toMarkdown: async (files) => files.map((f) => ({ name: f.name, format: 'markdown', data: '' })) },
};
const mail = [];
let boardGroup = [{ email: FOUNDER, role: 'OWNER', type: 'USER' }];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  const method = init.method || input?.method || 'GET';
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) {
    const b = JSON.parse(init.body);
    const list = Array.isArray(b) ? b : [b];
    mail.push(...list.map((m) => ({ ...m, at: new Date().toISOString() })));
    return Response.json(Array.isArray(b) ? { data: list.map((_, i) => ({ id: `em_${mail.length}_${i}` })) } : { id: `em_${mail.length}` });
  }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  const groupCall = url.match(/^https:\/\/admin\.googleapis\.com\/admin\/directory\/v1\/groups\/board%40soardcharity\.com\/members(?:\/([^?]+))?/);
  if (groupCall) {
    if (method === 'GET') return Response.json({ members: boardGroup });
    if (method === 'POST') { const b = JSON.parse(init.body); boardGroup.push({ email: b.email, role: b.role, type: 'USER' }); return Response.json(b); }
    if (method === 'DELETE') { boardGroup = boardGroup.filter((x) => x.email !== decodeURIComponent(groupCall[1])); return new Response(null, { status: 204 }); }
  }
  if (url.startsWith('https://gmail.googleapis.com/')) return Response.json({ messages: [], resultSizeEstimate: 0, id: 'sent-1', threadId: 't-1' });
  if (url.startsWith('https://www.googleapis.com/drive/v3/')) return Response.json({ files: [] });
  if (url.startsWith('https://meet.googleapis.com/v2/conferenceRecords')) return Response.json({ conferenceRecords: [], participants: [] });
  const meet = url.match(/^https:\/\/meet\.googleapis\.com\/v2\/spaces\/([^?]+)/);
  if (meet) return Response.json({ name: `spaces/${meet[1]}`, config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } } } });
  const gcal = url.match(/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/?]+)\/events(?:\/([^?]+))?(?:\?.*)?$/);
  if (gcal) {
    const list = (calendar[decodeURIComponent(gcal[1])] ||= []);
    const id = gcal[2] && decodeURIComponent(gcal[2]);
    const body = init.body ? JSON.parse(init.body) : null;
    const withMeet = (e) => (body?.conferenceData?.createRequest && !e.hangoutLink ? { ...e, hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { conferenceId: 'abc-defg-hij' } } : e);
    if (!id && method === 'GET') return Response.json({ items: list });
    if (!id && method === 'POST') { const e = withMeet({ status: 'confirmed', iCalUID: `${body.id}@google.com`, organizer: { email: decodeURIComponent(gcal[1]), self: true }, ...body }); list.push(e); return Response.json(e); }
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
    if (method === 'GET') return Response.json(list[i]);
    if (method === 'PATCH') { list[i] = withMeet({ ...list[i], ...body }); return Response.json(list[i]); }
    if (method === 'DELETE') { list[i] = { ...list[i], status: 'cancelled' }; return new Response(null, { status: 204 }); }
  }
  if (url.startsWith('https://www.googleapis.com/calendar/')) return Response.json({ items: [] });
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

/** A Word file of minutes: its Roll Call names nobody (as the reader's AI says too) */
function minutesDocx() {
  const enc = new TextEncoder();
  const wp = (text, ilvl) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const lvls = ['decimal', 'decimal', 'lowerLetter'].map((f, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${f}"/></w:lvl>`).join('');
  const body = [wp('CALL TO ORDER', 0), wp('Roll Call', 1), wp('COMMITTEE REPORTS', 0), wp('Financial (Sam)', 1), wp('Reserves grew this quarter', 2), wp('OPEN FORUM', 0), wp('Questions from the board', 1)].join('');
  const files = { 'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>`, 'word/numbering.xml': `<w:numbering><w:abstractNum w:abstractNumId="0">${lvls}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`, '[Content_Types].xml': '<Types/>' };
  const locals = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name); const raw = enc.encode(text); const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ── The meetings: one held twenty days ago (its minutes not in yet), the next in nine days on the board page, one drafted ──
const board = (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
// One paragraph, no line breaks, with a word too long to break: a notes box sized by its line breaks shows two lines of it
const LONG_NOTE = 'The gala sold out. Sponsors asked for the Supercalifragilisticexpialidocious-Reimbursement-Reconciliation-Worksheet before the end of the month, and two asked whether next year’s date is set. The golf classic is still short four foursomes, and the spring volunteer day needs a lead.';
const HELD = await saveMeeting(DB, cleanMeeting({ date: day(-20), start: '08:00', end: '10:00', location: 'Example Hall', shared: true, attendance: BOARD.map(board),
  sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }, { title: 'Committee reports', items: [{ title: 'Financial', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] }, { title: 'Open forum', items: [{ title: 'Questions from the board' }] }],
  actions: [{ text: 'Send the venue contract to the board', owner: 'alex-rivera', ownerName: 'Alex Rivera', due: day(5) }, { text: 'Share the store plan', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: day(12) }],
  agendaFrom: typed }), { by: FOUNDER });
const NEXT = await saveMeeting(DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', location: 'Example Hall', shared: true, attendance: BOARD.map(board),
  sections: [
    { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] },
    { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }, { title: 'The 2027 budget', presenter: 'Sam Ortiz', who: ['sam-ortiz'], notes: LONG_NOTE }] },
    { title: 'Programs', items: [{ title: 'Makeovers in progress' }] },
    { title: 'Open forum', items: [{ title: 'Questions from the board' }] },
  ],
  agendaFrom: typed }), { by: FOUNDER });
const DRAFT = await saveMeeting(DB, cleanMeeting({ date: day(100), start: '08:00', end: '10:00', location: 'Example Hall', shared: false, attendance: BOARD.map(board),
  sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }, { title: 'Year in review', items: [{ title: 'Every makeover this year', presenter: 'Jane Doe' }] }],
  agendaFrom: typed }), { by: FOUNDER });

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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const api = async (body = null) => (await realFetch(`${SITE}/api/board-admin`, body ? { method: 'POST', headers: { 'x-test-user': FOUNDER, 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify(body) } : { headers: { 'x-test-user': FOUNDER } })).json();
// The next meeting's invite goes out, so four board members haven't answered it (Who's coming offers to ask them), and
// its agenda is approved (before the board has had the email on how to sign in, so no email goes with it)
ok((await api({ action: 'send-invite', id: NEXT.id })).ok, 'setup: the next meeting’s invite went out');
const approvedNext = await api({ action: 'approve-agenda', id: NEXT.id });
ok(approvedNext.ok && approvedNext.agenda === 'waiting' && !mail.length, `setup: the next meeting’s agenda approved, nothing sent yet (${approvedNext.agenda})`);

// ── The browser ──
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 400000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const errs = [];
let cur = null; // the page the run is on
async function open(path, width = 1440) {
  const page = await browser.newPage();
  cur = page;
  page.setDefaultTimeout(30000);
  await page.setViewport({ width, height: 1000 });
  await page.setExtraHTTPHeaders({ 'x-test-user': FOUNDER });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|fonts\.gstatic|x-test-user/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  // Every toast said, kept (they go after a few seconds)
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent.replace(/\s+/g, ' ').trim()); } } }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  return page;
}
/** Answers on the way: a rule fulfils a matching /api/board-admin request ('request': it never reaches the site) or replaces its answer ('response': the site did it, the answer is lost) */
async function wire(page) {
  const cdp = await page.createCDPSession();
  const rules = [];
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/board-admin*', requestStage: 'Request' }, { urlPattern: '*/api/board-admin*', requestStage: 'Response' }] });
  cdp.on('Fetch.requestPaused', async (ev) => {
    const atResponse = ev.responseStatusCode !== undefined || ev.responseErrorReason !== undefined;
    const body = ev.request.postData || '';
    const rule = rules.find((r) => r.stage === (atResponse ? 'response' : 'request') && r.re.test(body) && r.left > 0);
    try {
      if (rule) {
        rule.left -= 1;
        rule.hits = (rule.hits || 0) + 1;
        // (a gateway's page, or the site's own JSON answer when the rule makes one)
        const json = rule.json ? JSON.stringify(await rule.json()) : null;
        await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: rule.status, responseHeaders: [{ name: 'Content-Type', value: json ? 'application/json' : 'text/html' }], body: Buffer.from(json || `<html><body>${rule.status} Bad gateway</body></html>`).toString('base64') });
      } else await cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
    } catch { /* the page went */ }
  });
  return { add: (stage, re, status = 502, left = 1, json = null) => { const r = { stage, re, status, left, json }; rules.push(r); return r; }, clear: () => { rules.length = 0; } };
}
/** A part of the run: one that stops (a button not there) fails there, says why, and the rest go on */
async function step(fn) {
  try { await fn(); } catch (err) {
    const why = String(err?.message || err).split('\n')[0];
    failures.push(`a step stopped: ${why}`);
    console.log(`  ✗ a step stopped: ${why}`);
    await cur?.keyboard.press('Escape').catch(() => {});
  }
}
/** A button by its words, pressed (a step stops when it isn't there) */
async function press(page, sel, re) {
  const h = await buttonIn(page, sel, re);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no button “${re.source}” in ${sel}`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.click();
}
const toasts = (page) => page.evaluate(() => window.__toasts || []);
const toastsSince = async (page, n) => (await toasts(page)).slice(n);
const focusOf = (page) => page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName?.toLowerCase() || '', cls: typeof a?.className === 'string' ? a.className : '', text: (a?.getAttribute?.('aria-label') || a?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), body: !a || a === document.body, button: a?.tagName === 'BUTTON' || a?.tagName === 'SUMMARY' }; });
const buttonIn = (page, sel, re) => page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())) || null, sel, re.source);
async function focusButton(page, sel, re) {
  const h = await buttonIn(page, sel, re);
  if (!(await h.evaluate((x) => !!x))) return false;
  await h.evaluate((x) => { x.scrollIntoView({ block: 'center' }); x.focus(); });
  return true;
}
const dialog = (page) => page.waitForSelector('.ask-overlay [data-ask]', { timeout: 8000 }).then(() => page.evaluate(() => ({ title: document.querySelector('.ask h2')?.textContent || '', text: document.querySelector('.ask__text')?.textContent || '', yes: document.querySelector('[data-ask="yes"]')?.textContent || '', focus: document.activeElement?.dataset?.ask || '' })), () => null);
const answer = async (page, which) => { await page.click(`.ask-overlay [data-ask="${which}"]`); await sleep(300); };
const saved = (page) => page.waitForFunction(() => /^Saved/.test(document.querySelector('.bm-saved')?.textContent.trim() || ''), { timeout: 20000 }).then(() => true, () => false);
const serverItems = async (id) => (await getMeeting(DB, id)).sections.flatMap((s) => s.items.map((it) => it.title));
const toBoard = () => mail.filter((m) => [].concat(m.to).some((t) => /board@example/.test(t)));
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

try {
  // ═══ The next meeting, by keyboard ═══
  console.log('\nThe next meeting, by keyboard');
  // (a second tab on the same meeting, opened before anything's sent: it still says "Email the board")
  const tab2 = await open(`/admin/#board/meeting/${NEXT.id}`);
  let p = await open(`/admin/#board/meeting/${NEXT.id}`);
  const net = await wire(p);

  // ⋯ type-ahead: "m" then a space starts nothing together, and never throws
  await step(async () => {
    const e0 = errs.length;
    await p.evaluate(() => { const s = [...document.querySelectorAll('.bd-menu > summary')].find((x) => x.getAttribute('aria-label') === 'More for Roll call'); s.scrollIntoView({ block: 'center' }); s.focus(); });
    await p.keyboard.press('ArrowDown'); await sleep(300);
    await p.keyboard.type('m '); await sleep(300);
    const errsNow = errs.slice(e0);
    await p.keyboard.press('Escape'); await sleep(200);
    ok(!errsNow.some((e) => /focus is not a function/.test(e)), `⋯ type-ahead: "m" then a space throws nothing (${errsNow.join(' | ') || 'no errors'})`);
  });

  // ⋯ → Private note, by keyboard: the focus goes into the note, so typing writes there and never opens the menu again
  await step(async () => {
    await p.evaluate(() => { const s = [...document.querySelectorAll('.bd-menu > summary')].find((x) => x.getAttribute('aria-label') === 'More for Year to date'); s.scrollIntoView({ block: 'center' }); s.focus(); });
    await p.keyboard.press('ArrowDown'); await sleep(300);
    await p.keyboard.type('p'); await sleep(150);
    const on = (await focusOf(p)).text;
    await p.keyboard.press('Enter'); await sleep(500);
    const f = await focusOf(p);
    ok(/Private note/.test(on) && f.tag === 'textarea' && /is-private/.test(f.cls), `⋯ → Private note by keyboard puts the focus in the note (on “${f.text || f.tag}”, ${f.cls})`);
    await p.keyboard.type('Ask Holly about the venue');
    ok(await saved(p), 'the note saves as it’s typed');
    ok(await p.evaluate(() => !document.querySelector('.bd-menu[open]')), 'and typing never opened ⋯ again');
  });

  // ⋯ → Delete the part, by keyboard: the focus onto the part that's there now, never left on the page
  await step(async () => {
    await p.evaluate(() => { const s = [...document.querySelectorAll('.bd-menu > summary')].find((x) => x.getAttribute('aria-label') === 'More for the part Open forum'); s.scrollIntoView({ block: 'center' }); s.focus(); });
    await p.keyboard.press('ArrowUp'); await sleep(300); // onto its last action, Delete the part
    const on = (await focusOf(p)).text;
    await p.keyboard.press('Enter'); await sleep(900);
    const f = await focusOf(p);
    ok(/Delete the part/.test(on) && /agx-sec__title/.test(f.cls), `Delete the part: the focus goes to the part before it (on ${f.body ? 'the page' : `“${f.text}” ${f.cls}`})`);
    ok(await saved(p), 'the part’s gone, saved');
  });

  // A guest typed in with a comma in their name is one presenter
  await step(async () => {
    const btn = await p.evaluateHandle(() => [...document.querySelectorAll('.agx-item')].find((x) => /Roll call/.test(x.querySelector('.agx-item__title').value)).querySelector('.bd-pop__btn'));
    await btn.evaluate((x) => x.scrollIntoView({ block: 'center' }));
    await btn.click(); await sleep(400);
    await p.keyboard.type('Dana Smith, CPA'); await sleep(300);
    const offered = await p.evaluate(() => document.querySelector('.bd-picker__opt--guest')?.textContent.replace(/\s+/g, ' ').trim() || '');
    await p.keyboard.press('Enter'); await sleep(300);
    await p.keyboard.press('Escape'); await sleep(400);
    const shows = await p.evaluate(() => { const b = [...document.querySelectorAll('.agx-item')].find((x) => /Roll call/.test(x.querySelector('.agx-item__title').value)).querySelector('.bd-pop__btn'); return { names: b.querySelector('.bd-who__names')?.textContent || '', faces: b.querySelectorAll('.bd-face').length }; });
    ok(/Add “Dana Smith, CPA”/.test(offered) && shows.names === 'Dana Smith, CPA' && shows.faces === 1, `a guest “Dana Smith, CPA” is one presenter: the item shows “${shows.names}” with ${shows.faces} face(s)`);
    ok(await saved(p), 'and it saves');
    const it = (await getMeeting(DB, NEXT.id)).sections[0].items[0];
    ok(JSON.stringify(it.guests) === '["Dana Smith, CPA"]' && it.presenter === 'Dana Smith, CPA', `kept whole on the server (${JSON.stringify(it.guests)}, “${it.presenter}”)`);
    await shot(p, '01-guest-presenter');
  });

  // Getting ready → Send me the email (a test to yourself): the focus on its task's name, never the page or a send
  await step(async () => {
    await focusButton(p, '.bm-ready button', /^Send me the email$/);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => ![...document.querySelectorAll('.bm-ready button')].some((x) => /Sending…/.test(x.textContent)), { timeout: 15000 }).catch(() => {});
    await sleep(400);
    const f = await focusOf(p);
    ok(!f.body && !f.button && /bm-task__t/.test(f.cls), `Send me the email: the focus on its task’s name (on ${f.body ? 'the page' : `“${f.text}”`})`);
  });

  // Who's coming → Send me the reminder, by keyboard: the next two Enters send nothing to the board
  await step(async () => {
    const m0 = mail.length;
    ok(await focusButton(p, '.bm-coming button', /^Send me the reminder$/), 'Who’s coming offers Send me the reminder');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => ![...document.querySelectorAll('.bm-coming button')].some((x) => /Sending…/.test(x.textContent)), { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const f = await focusOf(p);
    ok(!f.button && !/^Ask/.test(f.text), `after Send me the reminder the focus is on no button (on ${f.body ? 'the page' : `“${f.text}”`})`);
    await p.keyboard.press('Enter'); await sleep(700);
    const d = await dialog(p);
    if (d) await p.keyboard.press('Enter');
    await sleep(2500);
    const sent = mail.slice(m0);
    ok(sent.length === 1 && !sent.some((x) => /board@example/.test([].concat(x.to).join())), `Send me the reminder and two more Enters: the one test to me, nothing to the board (${sent.map((x) => x.to).join(', ')})`);
    if (await p.evaluate(() => !!document.querySelector('.ask-overlay'))) await p.keyboard.press('Escape');
  });

  // Ask the 4: sent, and the focus on what it did ("Asked … just now"), never on Ask again
  await step(async () => {
    const m0 = mail.length;
    await press(p, '.bm-coming button', /^Ask (the 4|again)/);
    const d = await dialog(p);
    await answer(p, 'yes');
    await p.waitForFunction(() => /Asked/.test(document.querySelector('.bm-coming__wait')?.textContent || ''), { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const f = await focusOf(p);
    ok(d && mail.slice(m0).length === 4 && !f.button && /Asked/.test(f.text), `Ask the 4: four asked, the focus on “${f.text || (f.body ? 'the page' : f.tag)}”, not on Ask again`);
  });

  // Ask again, its answer lost on the way back: plain words, where to look, and the next press says so first, on Cancel
  await step(async () => {
    const t0 = (await toasts(p)).length;
    // (ten minutes on from the last ask: the server sends a reminder once in ten minutes, _board.js sendOnce, so its
    // record of the last one goes, as the time passing would let it)
    await DB.prepare("DELETE FROM board_state WHERE key LIKE 'board-send:%'").run();
    const m0 = mail.length;
    const rule = net.add('response', /"action":"remind-rsvp"(?![^}]*"test":true)/, 502);
    await press(p, '.bm-coming button', /^Ask again$/);
    await dialog(p); await answer(p, 'yes');
    await sleep(3500);
    const said = (await toastsSince(p, t0)).join(' | ');
    ok(rule.hits === 1 && mail.slice(m0).length === 4, 'setup: the reminder went, and its answer was lost');
    // (the site's record of who was asked says what really happened, as Email the board's does: coordinator, Board QA
    // round 8. It went, so it's said as gone, never "may have gone")
    ok(!/HTTP/.test(said) && /^No answer came back from the site, but it went: .+ were asked just now\.$/.test(said), `a lost reminder says what the site has: it went (“${said}”)`);
    const f = await focusOf(p);
    ok(!f.button, `and the focus is on no button (on ${f.body ? 'the page' : `“${f.text}”`})`);
    await press(p, '.bm-coming button', /^Ask again$/);
    const d = await dialog(p);
    ok(d && /were asked just now/.test(d.text) && !/no answer came back/i.test(d.text) && d.focus === 'no', `the next press says who was asked just now, on Cancel (“${d?.text.slice(0, 110)}…”, focus ${d?.focus})`);
    await shot(p, '02-ask-again-after-lost');
    await answer(p, 'no');
  });

  // Email the board, its answer lost: the site's record says it went, in words
  await step(async () => {
    const t0 = (await toasts(p)).length;
    const m0 = mail.length;
    const rule = net.add('response', /"action":"send-packet"(?![^}]*"test":true)/, 502);
    await press(p, '.bm-ready button', /^Email the board$/);
    await dialog(p); await answer(p, 'yes');
    await sleep(4000);
    const said = (await toastsSince(p, t0)).join(' | ');
    ok(rule.hits === 1 && mail.slice(m0).length >= 4, 'setup: the board was emailed, and the answer was lost');
    ok(!/HTTP/.test(said) && /No answer came back/.test(said) && /it went/.test(said), `a lost answer whose email went says it went: “${said}”`);
    ok(await p.evaluate(() => /board members emailed the link/.test(document.querySelector('.bm-ready')?.textContent || '')), 'and Getting ready shows the board emailed');
    await shot(p, '03-email-lost-answer');
  });

  // The second tab presses Email the board after it went: the site's no (the server's send-once, functions/api/_board.js
  // sendOnce: 409 { already, meeting }) is said as news, and the meeting it carries goes on that tab: "Email again"
  await step(async () => {
    const net2 = await wire(tab2);
    const said = 'This email went to the board a moment ago (Jane sent it), so it didn’t go again. It can go again 10 minutes after the last one.';
    const rule = net2.add('request', /"action":"send-packet"(?![^}]*"test":true)/, 409, 1, async () => ({ ok: false, error: said, already: true, meeting: await getMeeting(DB, NEXT.id) }));
    const t0 = (await toasts(tab2)).length;
    const m0 = mail.length;
    await tab2.bringToFront();
    await press(tab2, '.bm-ready button', /^Email the board$/);
    await dialog(tab2); await answer(tab2, 'yes');
    await sleep(2500);
    const told = (await toastsSince(tab2, t0)).join(' | ');
    const task = await tab2.evaluate(() => document.querySelector('.bm-ready')?.textContent.replace(/\s+/g, ' ') || '');
    ok(rule.hits === 1 && mail.length === m0 && told.includes('didn’t go again') && /board members emailed the link/.test(task) && /Email again/.test(task), `a second tab pressing Email the board after it went: “${told}”, and that tab now shows it emailed, with Email again`);
    await shot(tab2, '03b-second-tab-already');
    await tab2.close();
    await p.bringToFront();
  });

  // Leaving a moment after typing: it saves on the way out, and nothing asks to leave without it
  await step(async () => {
    const h = await p.evaluateHandle(() => [...document.querySelectorAll('.agx-item__title')].find((x) => x.value === 'Makeovers in progress'));
    await h.evaluate((x) => { x.scrollIntoView({ block: 'center' }); x.focus(); x.select(); });
    await p.keyboard.type('Makeovers and reveals');
    await p.evaluate(() => document.querySelector('.bd-back').click());
    await sleep(600);
    const d = await p.evaluate(() => document.querySelector('.ask h2')?.textContent || '');
    if (d) await answer(p, 'yes');
    await sleep(2500);
    const items = await serverItems(NEXT.id);
    ok(!d && items.includes('Makeovers and reveals'), `typed and left at once: nothing asked${d ? ` (asked “${d}”)` : ''}, and the change is saved (${items.includes('Makeovers and reveals') ? 'on the server' : 'not on the server'})`);
    ok(await p.evaluate(() => location.hash === '#board'), 'and the page is the list of meetings');
  });
  await p.close();

  // ═══ The meeting being drafted: approving, the invite, saving ═══
  console.log('\nThe meeting being drafted');
  p = await open(`/admin/#board/meeting/${DRAFT.id}`);
  const net2 = await wire(p);

  // Approve the agenda, before the board has had the email on how to sign in: the question says nothing goes yet
  await step(async () => {
    await press(p, '.bm-ready button', /^Approve the agenda$/);
    const d = await dialog(p);
    await shot(p, '04-approve-not-told');
    await answer(p, 'no');
    ok(d && !/get the link by email\./.test(d.text.split('Once')[0]) && /Nothing goes to the board yet/.test(d.text) && /how to sign in/.test(d.text) && d.yes === 'Approve it', `before the sign-in email, “Approve the agenda?” says nothing goes yet: “${d?.text}” [${d?.yes}]`);
    // Once the board has had it: the board page and the email, as before
    await writeState(DB, 'welcome', { sentAt: new Date().toISOString(), members: {} });
    await p.reload({ waitUntil: 'networkidle0' }); await sleep(1500);
    await press(p, '.bm-ready button', /^Approve the agenda$/);
    const d2 = await dialog(p);
    await answer(p, 'no');
    ok(d2 && /It goes on the board page, and 4 board members get the link by email/.test(d2.text) && d2.yes === 'Approve and send', `once they have: “${d2?.text}” [${d2?.yes}]`);
  });

  // Send the invite, refused on the way (it never reached the site): words, Google Calendar to look at, the focus on its task
  await step(async () => {
    const t0 = (await toasts(p)).length;
    const rule = net2.add('request', /"action":"send-invite"/, 500);
    await press(p, '.bm-ready button', /^Send the invite$/);
    await dialog(p); await answer(p, 'yes');
    await sleep(3000);
    const said = (await toastsSince(p, t0)).join(' | ');
    ok(rule.hits === 1 && !/HTTP/.test(said) && /No answer came back/.test(said) && /Google Calendar/.test(said), `a lost invite says so in words: “${said}”`);
    const f = await focusOf(p);
    ok(!f.body && !f.button && /bm-task__t/.test(f.cls), `after a send that failed, the focus is on its task’s name (on ${f.body ? 'the page' : `“${f.text}”`})`);
    await press(p, '.bm-ready button', /^Send the invite$/);
    const d = await dialog(p);
    ok(d && /no answer came back/i.test(d.text) && d.focus === 'no', `pressed again, it says the last may have gone, on Cancel (“${d?.text.slice(0, 120)}…”)`);
    await answer(p, 'no');
  });

  // A save the site doesn't answer, then no connection: plain words, never a code or two full stops
  await step(async () => {
    const t0 = (await toasts(p)).length;
    const rule = net2.add('request', /"action":"save-meeting"/, 500, 1);
    const h = await p.evaluateHandle(() => [...document.querySelectorAll('.agx-item__title')].find((x) => x.value === 'Every makeover this year'));
    await h.evaluate((x) => { x.scrollIntoView({ block: 'center' }); x.focus(); x.select(); });
    await p.keyboard.type('Every makeover, 2026');
    await p.waitForFunction(() => /Not saved/.test(document.querySelector('.bm-saved')?.textContent || ''), { timeout: 10000 }).catch(() => {});
    await sleep(300);
    const said500 = (await toastsSince(p, t0)).join(' | ');
    ok(await saved(p), 'and Board keeps trying: it saves once the site answers');
    const t1 = (await toasts(p)).length;
    await p.setOfflineMode(true);
    await h.evaluate((x) => { x.focus(); x.select(); });
    await p.keyboard.type('Every makeover, offline');
    await p.waitForFunction(() => /Not saved/.test(document.querySelector('.bm-saved')?.textContent || ''), { timeout: 10000 }).catch(() => {});
    await sleep(300);
    const saidOff = (await toastsSince(p, t1)).join(' | ');
    ok(rule.hits === 1 && /Not saved/.test(said500) && /Not saved/.test(saidOff) && ![said500, saidOff].some((t) => /HTTP|\.\./.test(t)), `a save that didn’t go says why in words: “${said500}” and “${saidOff}”`);
    await shot(p, '05-not-saved-offline');

    // Leaving now asks, and "Leave without saving" saves nothing, even once the connection's back
    await p.evaluate(() => document.querySelector('.bd-back').click());
    const d = await dialog(p);
    ok(d && /Leave without saving/.test(d.title), `leaving while Board can't save asks first (“${d?.title}”)`);
    if (d) await answer(p, 'yes');
    await p.setOfflineMode(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    // (Board's own tries come 3, 10 and 30 seconds apart: long enough for the last of them)
    for (let i = 0; i < 40 && !(await serverItems(DRAFT.id)).includes('Every makeover, offline'); i++) await sleep(1000);
    const items = await serverItems(DRAFT.id);
    ok(!items.includes('Every makeover, offline') && items.includes('Every makeover, 2026'), `“Leave without saving” saved nothing, after the connection came back too (on the server: ${items.filter((t) => /Every makeover/.test(t)).join(', ')})`);
  });
  await p.close();

  // ═══ The held meeting: minutes whose roll names nobody, Undo, and approving them ═══
  console.log('\nThe held meeting');
  p = await open(`/admin/#board/meeting/${HELD.id}`);
  await step(async () => {
    const file = join(OUT, 'minutes-no-roll.docx');
    writeFileSync(file, minutesDocx());
    await (await p.$('.bm-minutes-drop input[type="file"]')).uploadFile(file);
    await p.waitForFunction(() => /Read from the minutes/.test(document.querySelector('.bm-minutes-drop')?.textContent || ''), { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const drop = await p.evaluate(() => document.querySelector('.bm-minutes-drop')?.textContent.replace(/\s+/g, ' ') || '');
    const doc = await p.evaluate(() => document.querySelector('.bm-minutes')?.textContent.replace(/\s+/g, ' ') || '');
    const said = (await toasts(p)).join(' | ');
    await shot(p, '06-minutes-no-roll');
    ok(!/\b0 of \d+ board members there/.test(drop + said) && !/Not there/.test(doc) && /don’t say who was there/.test(drop) && /don’t say who was there/.test(doc), `minutes whose roll names nobody: “${drop.trim().slice(0, 140)}”; never “0 of 6” or everyone not there`);
    // Undo: put back, the focus on choosing the minutes again
    await focusButton(p, '.bm-minutes-drop button', /^Undo$/);
    await p.keyboard.press('Enter');
    await sleep(800);
    const f = await focusOf(p);
    ok(!f.body && f.tag === 'input', `the minutes’ Undo: the focus on choosing them again (on ${f.body ? 'the page' : f.tag})`);
    // Read in again, then marked approved
    await (await p.$('.bm-minutes-drop input[type="file"]')).uploadFile(file);
    await p.waitForFunction(() => /Read from the minutes/.test(document.querySelector('.bm-minutes-drop')?.textContent || ''), { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    await press(p, '.bm-wrap button', /^Mark them approved$/);
    await dialog(p); await answer(p, 'yes');
    ok(await saved(p), 'its minutes marked approved, saved');
  });
  await p.close();

  // ═══ The meetings list: a new meeting after approved minutes, Mark done, two in one quarter ═══
  console.log('\nThe list of meetings');
  p = await open('/admin/#board');
  await step(async () => {
    // Mark done by keyboard: the focus onto the next action item
    const open = await p.evaluate(() => [...document.querySelectorAll('.bd-row')].filter((r) => [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Mark done')).map((r) => r.querySelector('.bd-row__title').textContent.trim()));
    await focusButton(p, '.bd-row button', /^Mark done$/);
    await p.keyboard.press('Enter');
    await sleep(1500);
    const f = await focusOf(p);
    ok(open.length > 1 && !f.body && !f.button && f.text === open[1], `Mark done: the focus onto the next action item, “${open[1]}” (on ${f.body ? 'the page' : `“${f.text}”`})`);

    // New meeting → Add, by keyboard: the new meeting opens with the focus on its name
    await press(p, 'button', /^New meeting$/);
    await sleep(300);
    // (between the held meeting and the next: the held one is the meeting before it, its minutes approved)
    const date = day(3);
    await p.evaluate((d) => { const i = document.querySelector('input[type="date"][aria-label="Meeting date"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, d); i.dispatchEvent(new Event('input', { bubbles: true })); }, date);
    await focusButton(p, 'button', /^Add$/);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /#board\/meeting\//.test(location.hash) && document.querySelector('.bm-title h2'), { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    const f2 = await focusOf(p);
    ok(!f2.body && f2.tag === 'h2', `New meeting → Add: the focus on the new meeting’s name (on ${f2.body ? 'the page' : `“${f2.text}”`})`);
    const chips = await p.evaluate(() => [...document.querySelectorAll('.agx-live.is-minutes')].map((x) => x.textContent.trim()));
    const parts = await p.evaluate(() => [...document.querySelectorAll('.agx-sec__title')].map((x) => x.value));
    await shot(p, '07-new-after-approved');
    ok(!chips.length && !parts.includes('Approve meeting minutes'), `minutes approved already: the new agenda puts nothing up for approval (chips: ${JSON.stringify(chips)}; parts: ${parts.join(', ')})`);
    // ...and the template's follow (every ten minutes, or a template saved) doesn't put it back
    const fresh = (await listMeetings(DB)).find((x) => x.date === date);
    await maybeTemplateAgendas(env, { force: true });
    const after = await getMeeting(DB, fresh.id);
    ok(!after.sections.some((s) => s.items.some((it) => it.live === 'minutes')), 'and the template’s follow leaves it off');

    // The next meeting's own agenda (written, not the template) says those minutes are approved, not up for approval
    await p.evaluate((id) => { location.hash = `#board/meeting/${id}`; }, NEXT.id);
    await sleep(2500);
    const chip = await p.evaluate(() => document.querySelector('.agx-live.is-minutes')?.textContent.trim() || '');
    ok(/^Approved /.test(chip), `the next meeting’s “Approve the last meeting’s minutes” says “${chip}”`);

    // Two meetings in one quarter: deleting one names its day; the list then has the focus
    const twin = (await api({ action: 'new-meeting', date: day(12) })).meeting;
    ok(meetingName(twin) === meetingName(NEXT), `setup: two in one quarter, ${meetingName(twin)} (${twin.date}) and ${meetingName(NEXT)} (${NEXT.date})`);
    await p.goto(`${SITE}/admin/#board/meeting/${twin.id}`, { waitUntil: 'networkidle0' });
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(2500);
    await p.evaluate(() => document.querySelector('.bm-top .bd-menu > summary').focus());
    await p.keyboard.press('ArrowUp'); await sleep(300);
    await p.keyboard.press('Enter');
    const d = await dialog(p);
    ok(d && / on [A-Z][a-z]+day, [A-Z][a-z]+ \d+, \d{4}\?$/.test(d.title), `the delete question names its day: “${d?.title}”`);
    await shot(p, '08-delete-names-day');
    if (d) await answer(p, 'yes');
    await sleep(1500);
    const f3 = await focusOf(p);
    ok(!f3.body && f3.tag === 'h2', `Delete this meeting: the list opens with the focus on its heading (on ${f3.body ? 'the page' : `“${f3.text}”`})`);
  });
  await p.close();

  // ═══ Round 2 (Nov 19 2026) ═══
  console.log('\nRound 2: home, the template, dates, held lines, notes, a deleted meeting');
  const pathOn = (page) => page.evaluate(() => [...document.querySelectorAll('.bm-path__step')].map((li) => ({ t: li.querySelector('.bm-path__t')?.textContent.trim() || '', s: li.querySelector('.bm-path__s')?.textContent.trim() || '', state: (li.className.match(/is-(\w+)/) || [])[1] || '' })));

  // Home → Open action items → Send me the email: the focus on the list's heading, never the page or a send
  p = await open('/admin/#board');
  await step(async () => {
    const t0 = (await toasts(p)).length;
    ok(await focusButton(p, '.bh-remind button', /^Send me the email$/), 'home offers Send me the email under Open action items');
    await p.keyboard.press('Enter');
    await p.waitForFunction((n) => (window.__toasts || []).length > n, { timeout: 15000 }, t0).catch(() => {});
    await sleep(500);
    const f = await focusOf(p);
    const said = (await toastsSince(p, t0)).join(' | ');
    ok(/Sent to/.test(said) && !f.body && !f.button && /^Open action items/.test(f.text), `home’s Send me the email (“${said}”): the focus on the action items’ heading (on ${f.body ? 'the page' : `“${f.text}”`})`);
    await p.keyboard.press('Tab'); await sleep(200);
    const t = await focusOf(p);
    ok(!/^Send/.test(t.text), `and Tab from there is never a send (on “${t.text}”)`);
  });
  await p.close();

  // A held meeting's line says what happened: no invite went from Board, no email before it, the agenda it followed
  await step(async () => {
    p = await open(`/admin/#board/meeting/${HELD.id}`);
    const line = await pathOn(p);
    await shot(p, '09-held-line');
    const said = line.map((x) => `${x.t}: ${x.s} (${x.state})`).join(' · ');
    const at = (t) => line.find((x) => x.t === t) || {};
    ok(!line.some((x) => x.state === 'todo' || x.state === 'next') && !/ of \d+ reports? in|Not sent|Not yet/.test(said), `a held meeting with its minutes approved has nothing left to do on its line: ${said}`);
    ok(at('Invite').state === 'skip' && at('Invite').s === 'None sent from Board' && at('Board emailed').state === 'skip' && at('Agenda').state === 'done', `the invite and the email it never had are said as that, the agenda as done (${at('Invite').s}; ${at('Board emailed').s}; ${at('Agenda').s})`);
    await p.close();
    // One report asked for is one report
    p = await open(`/admin/#board/meeting/${DRAFT.id}`);
    const agenda = (await pathOn(p)).find((x) => x.t === 'Agenda')?.s || '';
    ok(/ 0 of 1 report in$/.test(agenda), `one report asked for reads “${agenda}”`);
    await p.close();
  });

  // An evening's approval, email and file: the day it was in Atlanta (10 PM there is tomorrow in UTC)
  await step(async () => {
    const D = day(-2);
    const late = new Date(`${D}T22:00:00-05:00`).toISOString();
    const want = shortDate(D);
    const wrong = shortDate(late.slice(0, 10));
    await DB.prepare("UPDATE board_asks SET in_at = ? WHERE kind = 'chair' AND meeting_id = ?").bind(late, NEXT.id).run();
    await patchMeeting(DB, NEXT.id, (x) => ({ ...x, packetSentAt: late }));
    await putFile(env, { ownerType: 'meeting', ownerId: NEXT.id, file: new File([PNG], 'Packet cover.png', { type: 'image/png' }), kind: 'packet', by: FOUNDER });
    await DB.prepare('UPDATE board_files SET at = ? WHERE owner_id = ?').bind(late, NEXT.id).run();
    p = await open(`/admin/#board/meeting/${NEXT.id}`);
    const line = await pathOn(p);
    const approved = line.find((x) => x.t === 'Approved')?.s || '';
    const emailed = line.find((x) => x.t === 'Board emailed')?.s || '';
    const added = await p.evaluate(() => [...document.querySelectorAll('.bd-row__meta')].map((x) => x.textContent).find((t) => /added/.test(t)) || '');
    await shot(p, '10-evening-dates');
    ok(wrong !== want && approved.endsWith(want) && emailed.endsWith(want) && added.includes(`added ${want}`) && ![approved, emailed, added].some((t) => t.includes(wrong)), `approved, emailed and a file added at 10 PM on ${want} in Atlanta say ${want}, never ${wrong} (“${approved}”, “${emailed}”, “${added}”)`);
    await p.close();
  });

  // A notes box shows all its words, as wide as its item: on a phone, a tablet, and where the browser can't size it itself
  await step(async () => {
    const notes = (page) => page.evaluate(() => [...document.querySelectorAll('.agx-item > textarea.bd-notes')].map((t) => {
      const li = t.closest('.agx-item');
      const pad = parseFloat(getComputedStyle(li).paddingLeft) + parseFloat(getComputedStyle(li).paddingRight);
      const r = t.getBoundingClientRect();
      return { room: Math.round(li.clientWidth - pad - parseFloat(getComputedStyle(t).marginLeft)), w: Math.round(r.width), h: t.clientHeight, need: t.scrollHeight, long: t.value.length > 200 };
    }));
    const look = async (width, name, { noFieldSizing = false } = {}) => {
      const page = await browser.newPage();
      cur = page;
      page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
      await page.setExtraHTTPHeaders({ 'x-test-user': FOUNDER });
      // (as Safari and Firefox are: no CSS field-sizing, so the notes box is measured by hand)
      if (noFieldSizing) await page.evaluateOnNewDocument(() => { const was = CSS.supports.bind(CSS); CSS.supports = (...a) => (/field-sizing/.test(a.join(' ')) ? false : was(...a)); document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.bd-notes { field-sizing: fixed !important; }'; document.head.append(st); }); });
      await page.goto(`${SITE}/admin/#board/meeting/${NEXT.id}`, { waitUntil: 'networkidle0' });
      await sleep(1500);
      await page.evaluate(() => [...document.querySelectorAll('.agx-item > textarea.bd-notes')].find((t) => t.value.length > 200)?.scrollIntoView({ block: 'center' }));
      await sleep(300);
      const list = await notes(page);
      const h = await page.evaluateHandle(() => [...document.querySelectorAll('.agx-item > textarea.bd-notes')].find((t) => t.value.length > 200)?.closest('.agx-item'));
      if (await h.evaluate((x) => !!x)) await h.screenshot({ path: join(OUT, `${name}.png`) });
      return { page, list };
    };
    for (const [width, name, o] of [[390, '11-notes-390'], [768, '11-notes-768'], [390, '11-notes-390-measured', { noFieldSizing: true }]]) {
      const { page, list } = await look(width, name, o);
      const long = list.find((x) => x.long);
      ok(long && list.every((x) => x.w >= x.room - 2 && x.need <= x.h + 1), `at ${width}${o ? ' without field-sizing' : ''}, each notes box is as wide as its item and shows all its words (${list.map((x) => `${x.w} of ${x.room} wide, ${x.h} of ${x.need} tall`).join('; ')})`);
      if (o?.noFieldSizing) {
        // ...and again once the window is narrower (the words wrap onto more lines)
        await page.setViewport({ width: 768, height: 900 }); await sleep(400);
        await page.setViewport({ width: 360, height: 900, isMobile: true, hasTouch: true }); await sleep(600);
        const after = await notes(page);
        ok(after.every((x) => x.w >= x.room - 2 && x.need <= x.h + 1), `without field-sizing, turned from 768 to 360 it fits again (${after.map((x) => `${x.w} of ${x.room} wide, ${x.h} of ${x.need} tall`).join('; ')})`);
        // ...and as it's typed into
        const t = await page.evaluateHandle(() => [...document.querySelectorAll('.agx-item > textarea.bd-notes')].find((x) => x.value.length > 200));
        await t.evaluate((x) => { x.focus(); x.setSelectionRange(x.value.length, x.value.length); });
        await page.keyboard.type(' The venue wants a deposit by Friday, and the caterer needs final numbers two weeks out.');
        await sleep(300);
        const typed = await notes(page);
        ok(typed.every((x) => x.need <= x.h + 1), `and as it’s typed into (${typed.map((x) => `${x.h} of ${x.need} tall`).join('; ')})`);
      }
      await page.close();
    }
  });

  // A save refused because the meeting was deleted in another tab: said plainly, never "Board keeps trying", no more
  // saves, and the way back to every meeting (the site answers 404 or 410, functions/api/board-admin.js save-meeting)
  await step(async () => {
    const doomed = (await api({ action: 'new-meeting', date: day(50) })).meeting;
    p = await open(`/admin/#board/meeting/${doomed.id}`);
    const net3 = await wire(p);
    ok((await api({ action: 'delete-meeting', id: doomed.id })).ok, 'setup: the meeting deleted in another tab');
    const rule = net3.add('request', /"action":"save-meeting"/, 404, 99, async () => ({ ok: false, error: 'This meeting was deleted, so the change wasn’t saved.' }));
    const t0 = (await toasts(p)).length;
    const h = await p.$('.agx-item__title');
    await h.evaluate((x) => { x.scrollIntoView({ block: 'center' }); x.focus(); x.select(); });
    await p.keyboard.type('Typed after it was deleted');
    await p.waitForFunction(() => /deleted/.test(document.querySelector('.bm-saved')?.textContent || ''), { timeout: 10000 }).catch(() => {});
    await sleep(5000);
    const bar = await p.evaluate(() => document.querySelector('.bm-saved')?.textContent.replace(/\s+/g, ' ').trim() || '');
    const notice = await p.evaluate(() => document.querySelector('.bm-gone')?.textContent.replace(/\s+/g, ' ').trim() || '');
    const said = (await toastsSince(p, t0)).join(' | ');
    await shot(p, '12-deleted-elsewhere');
    ok(/deleted/.test(bar) && /This meeting was deleted/.test(notice) && /deleted/.test(said) && !/keeps trying|Try again/.test(said + bar), `a save of a meeting deleted elsewhere says so: “${bar}”, “${notice.slice(0, 90)}…”, toast “${said}”`);
    ok(rule.hits === 1, `and Board stops saving it (${rule.hits} save${rule.hits === 1 ? '' : 's'} in 5 seconds)`);
    // (another change: still nothing goes)
    await h.evaluate((x) => { x.focus(); });
    await p.keyboard.type(' again');
    await sleep(2500);
    ok(rule.hits === 1, `another change after it sends nothing (${rule.hits})`);
    await press(p, '.bm-gone button', /^Back to all meetings$/);
    await sleep(1500);
    const d = await p.evaluate(() => document.querySelector('.ask h2')?.textContent || '');
    const listed = await p.evaluate((id) => !!document.querySelector(`.bh-row a[href*="${id}"]`), doomed.id);
    ok(!d && (await p.evaluate(() => location.hash)) === '#board' && !listed, `Back to all meetings: no question${d ? ` (asked “${d}”)` : ''}, on the list, the meeting not on it`);
    await p.close();
  });

  // Home and the meeting page name the same next step (pathOf, one rule), the agenda's reports included
  await step(async () => {
    const next = nextMeeting(await listMeetings(DB));
    const read = async () => {
      const home = await open('/admin/#board');
      const h = await home.evaluate(() => ({ chips: [...document.querySelectorAll('.bh-prep li')].map((li) => ({ t: li.textContent.trim(), done: li.classList.contains('is-done'), next: li.classList.contains('is-next') })), line: document.querySelector('.bh-nextline')?.textContent.replace(/\s+/g, ' ').trim() || '' }));
      await home.close();
      const mp = await open(`/admin/#board/meeting/${next.id}`);
      const line = await pathOn(mp);
      const task = await mp.evaluate(() => document.querySelector('.bm-ready .bm-task.is-next .bm-task__t')?.textContent.trim() || '');
      return { h, line, task, mp };
    };
    const same = (r) => {
      const hn = r.h.chips.find((x) => x.next)?.t || '(none)';
      const pn = r.line.find((x) => x.state === 'next')?.t || '(none)';
      const odd = r.h.chips.filter((c) => { const s = r.line.find((x) => x.t === c.t); return !s || (s.state === 'done') !== c.done; }).map((c) => c.t);
      return { hn, pn, odd };
    };
    // The invite sent, the agenda not approved and the meeting not on the board page
    if (!next.invite) ok((await api({ action: 'send-invite', id: next.id })).ok, 'setup: the next meeting’s invite went out');
    await DB.prepare("DELETE FROM board_asks WHERE kind = 'chair' AND meeting_id = ?").bind(next.id).run();
    // (and one of its items presented by a board member, so its agenda waits on a report, as the page says)
    let given = false;
    await patchMeeting(DB, next.id, (x) => ({ ...x, shared: false, packetSentAt: '', sections: x.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => (!given && !it.presenter && reportsOn({ ...it, presenter: 'Sam Ortiz', who: ['sam-ortiz'] }) && (given = true) ? { ...it, presenter: 'Sam Ortiz', who: ['sam-ortiz'] } : it)) })) }));
    let r = await read();
    let c = same(r);
    await shot(r.mp, '13-next-after-invite-meeting');
    await r.mp.close();
    ok(c.hn === 'Approved' && c.pn === 'Approved' && /approve the agenda/.test(r.h.line) && /^Approve the agenda/.test(r.task) && !c.odd.length, `after the invite: home says “${r.h.line}” (${c.hn}), the meeting’s line ${c.pn} and Getting ready “${r.task}”; every chip as the line has it${c.odd.length ? ` (not: ${c.odd.join(', ')})` : ''}`);
    const agendaChip = r.h.chips.find((x) => x.t === 'Agenda');
    const agendaStep = r.line.find((x) => x.t === 'Agenda');
    ok(agendaChip && agendaStep && /0 of 1 report in/.test(agendaStep.s) && !agendaChip.done && agendaStep.state !== 'done', `home’s Agenda chip ${agendaChip?.done ? 'ticked' : 'not ticked'}, as the meeting’s “${agendaStep?.s}”`);
    // Approved (the board has had the sign-in email): on the board page and emailed by itself; what's left is the reports
    ok((await api({ action: 'approve-agenda', id: next.id })).ok, 'setup: its agenda approved');
    r = await read();
    c = same(r);
    await r.mp.close();
    // (everything before the day done: the line's next is the meeting itself, and home says Ready)
    const homeWants = c.pn === 'The meeting' ? '(none)' : c.pn;
    ok(c.hn === homeWants && !c.odd.length && (c.pn === 'Agenda' ? /the reports, \d+ of \d+ in/.test(r.h.line) : /^Ready/.test(r.h.line)), `once approved and sent: home “${r.h.line}” (${c.hn}) and the meeting’s line (${c.pn}) agree`);
    const hp = await open('/admin/#board');
    await shot(hp, '13-next-home-approved');
    await hp.close();
  });

  // The agenda template keeps a change on the way out, as a meeting does
  await step(async () => {
    const first = async () => (await api()).settings.template?.[0]?.items?.[0]?.title || '';
    const was = await first();
    const typeFirst = async (page, text) => { const t = await page.$('.bd-template .agx-item__title'); await t.evaluate((x) => { x.scrollIntoView({ block: 'center' }); x.focus(); x.select(); }); await page.keyboard.type(text); };
    // Reloaded a moment after typing: the browser asks, and the change is kept
    p = await open('/admin/#board/template');
    const asked = [];
    p.on('dialog', async (d) => { asked.push(d.type()); await d.accept().catch(() => {}); });
    await typeFirst(p, `${was} R`);
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    ok(asked.includes('beforeunload') && (await first()) === `${was} R`, `the template reloaded a moment after typing: the browser asked (${asked.join(', ') || 'nothing'}), and the change is kept (“${await first()}”)`);
    // Closing the tab a moment after typing: asked, and kept
    asked.length = 0;
    await typeFirst(p, `${was} C`);
    await p.close({ runBeforeUnload: true });
    for (let i = 0; i < 20 && (await first()) !== `${was} C`; i++) await sleep(250);
    ok(asked.includes('beforeunload') && (await first()) === `${was} C`, `closing the tab a moment after typing: asked (${asked.join(', ') || 'nothing'}), and kept (“${await first()}”)`);
    // Left at once with no connection: nothing asks (as a meeting), it keeps trying, and it's saved once the connection's back
    p = await open('/admin/#board/template');
    const t0 = (await toasts(p)).length;
    await p.setOfflineMode(true);
    await typeFirst(p, `${was} O`);
    await p.evaluate(() => document.querySelector('.bd-back').click());
    await sleep(2500);
    const d1 = await p.evaluate(() => document.querySelector('.ask h2')?.textContent || '');
    const said = (await toastsSince(p, t0)).join(' | ');
    await shot(p, '14-template-left-offline');
    ok(!d1 && (await p.evaluate(() => location.hash)) === '#board' && /Board keeps trying/.test(said) && !/beside/.test(said), `the template left at once offline: no question${d1 ? ` (asked “${d1}”)` : ''}, and “${said}”`);
    // Opened again before it went: the change is there, and what's typed now is what's kept (the one left behind stops)
    await press(p, '.bd-actions button', /^Agenda template$/);
    await sleep(1200);
    const back = await p.evaluate(() => document.querySelector('.bd-template .agx-item__title')?.value || '');
    await typeFirst(p, `${was} O2`);
    await sleep(500);
    await p.setOfflineMode(false);
    for (let i = 0; i < 40 && (await first()) !== `${was} O2`; i++) await sleep(500);
    const landed = await first();
    await sleep(12000);
    ok(back === `${was} O` && landed === `${was} O2` && (await first()) === `${was} O2`, `opened again offline it has the change (“${back}”); once back online what was typed after is saved (“${landed}”), and still is 12 seconds on (“${await first()}”)`);
    await p.close();
    // Can't save, then left: "Leave without saving?", and nothing goes after
    p = await open('/admin/#board/template');
    await p.setOfflineMode(true);
    await typeFirst(p, `${was} X`);
    await p.waitForFunction(() => /Not saved/.test(document.querySelector('.bd-template .bm-saved')?.textContent || ''), { timeout: 10000 }).catch(() => {});
    await shot(p, '14-template-not-saved');
    await p.evaluate(() => document.querySelector('.bd-back').click());
    const d2 = await dialog(p);
    if (d2) await answer(p, 'yes');
    await p.setOfflineMode(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(12000);
    ok(d2 && /Leave without saving/.test(d2.title) && /agenda template/.test(d2.text) && (await first()) === `${was} O2`, `while it can’t save, leaving asks (“${d2?.title}”: “${d2?.text}”), and nothing went after (“${await first()}”)`);
    // ...nor when the template is opened again: it opens as the site has it
    await press(p, '.bd-actions button', /^Agenda template$/);
    await sleep(1200);
    const reopened = await p.evaluate(() => document.querySelector('.bd-template .agx-item__title')?.value || '');
    ok(reopened === `${was} O2`, `and opened again it’s as the site has it (“${reopened}”)`);
    await p.close();
    // (the template as it was, for whatever runs after)
    const t = (await api()).settings.template;
    t[0].items[0].title = was;
    await api({ action: 'save-settings', settings: { template: t } });
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
