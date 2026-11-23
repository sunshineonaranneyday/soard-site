/**
 * test-board-round4-invites.mjs: a board meeting's calendar invite, as the founder sees it (QA round 4, Nov 21 2026)
 * ================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, as scripts/test-board-round3.mjs
 * does; Google Calendar and Resend are faked. Made-up people only.
 *   - held on its day (its minutes in) with its invite at that slot: the page says Held, When and where says the invite
 *     stays as it was, a correction typed there sends Google nothing, and Delete doesn't say the invite is cancelled
 *   - held on its day because its end time has passed: Held, and no Send the invite (the page and the site, one rule)
 *   - a meeting moved to yesterday from When and where while its invite is still ahead: the words say the change goes on
 *     the invite, Delete says the invite is cancelled, and it is (Google tells the guests)
 *   - the same kept: the heartbeat takes its invite to that day with one email, and the page then says it's a record
 *   - Send the invite pressed while Board is sending it by itself: said in plain words, nothing sent twice
 * Screenshots land in test-results/board-round4-invites/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round4-invites.mjs        (PORT=4601 for a port of its own; any free one otherwise)
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { saveMeeting, getMeeting, provideBoardFinance, patchMeeting } from '../functions/api/_board.js';
import { readState, writeState } from '../functions/api/_board-roles.js';
import { sendInvite, maybeRefreshInvites, pendingInvites } from '../functions/api/_board-invite.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round4-invites/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const clockNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const FOUNDER = 'jane@soardcharity.com';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', order: 3 },
};
const EMAILS = [['alex-rivera', 'alex.board@example.com'], ['sam-ortiz', 'sam.board@example.org'], ['taylor-nguyen', 'taylor.board@example.net']];
const BOARD = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen'];

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

// ── The outside world, faked: Google Calendar keeps its events, every call is kept ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }),
  DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test',
};
const google = { events: {}, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) {
    const b = JSON.parse(init.body);
    return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' });
  }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.split('/').pop());
    google.calls.push({ method, id: method === 'POST' ? body?.id : id, sendUpdates: u.searchParams.get('sendUpdates'), body });
    if (method === 'GET' && u.pathname.endsWith('/events')) return Response.json({ items: [] });
    if (method === 'POST') {
      const e = { ...body, status: 'confirmed', hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { conferenceId: 'abc-defg-hij' }, attendees: (body.attendees || []).map((a) => ({ ...a, responseStatus: 'needsAction' })) };
      google.events[e.id] = e;
      return Response.json(e);
    }
    const e = google.events[id];
    if (!e) return Response.json({ error: { message: 'Not Found' } }, { status: 404 });
    if (method === 'DELETE') {
      if (e.status === 'cancelled') return Response.json({ error: { message: 'Resource has been deleted' } }, { status: 410 });
      e.status = 'cancelled';
      return new Response(null, { status: 204 });
    }
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

/** Writes to one event at Google from here on: [method, sendUpdates] */
const writesTo = (eventId) => { const n = google.calls.length; return () => google.calls.slice(n).filter((c) => c.method !== 'GET' && c.id === eventId).map((c) => [c.method, c.sendUpdates]); };
/** Every change noted for the heartbeat, as if it had stood its two minutes; then the heartbeat's invite part */
async function heartbeat() {
  const p = await pendingInvites(DB);
  for (const [id, x] of Object.entries(p)) await writeState(DB, `invite-pending:${id}`, { ...x, at: '2000-01-01T00:00:00.000Z' });
  await maybeRefreshInvites(env, { now: Date.now() });
}

// ── The meetings ──
const board = (slug) => ({ slug, name: PEOPLE[slug].name, kind: 'board' });
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };
const AGENDA = [{ title: 'Call to order', items: [{ title: 'Roll call' }] }, { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] }];
const make = (date, more = {}) => saveMeeting(DB, cleanMeeting({ date, start: '08:00', end: '10:00', location: 'Example Hall', attendance: BOARD.map(board), sections: AGENDA, agendaFrom: typed, ...more }), { by: FOUNDER });
// Held today: its invite went while it was on, then its minutes came in (held whatever the time is)
const RECORD = await make(day(0), { start: '00:00', end: '23:59' });
await sendInvite(env, RECORD.id, { by: FOUNDER });
await patchMeeting(DB, RECORD.id, (cur) => ({ ...cur, minutesFrom: { name: 'Minutes.docx', at: new Date().toISOString() } }));
const RECORD_EV = (await getMeeting(DB, RECORD.id)).invite.eventId;
// Ahead, its invite out: moved to yesterday from the page, then deleted
const MOVED = await make(day(30));
await sendInvite(env, MOVED.id, { by: FOUNDER });
const MOVED_EV = (await getMeeting(DB, MOVED.id)).invite.eventId;
// Ahead, its invite out: moved to yesterday from the page and kept
const KEPT = await make(day(35));
await sendInvite(env, KEPT.id, { by: FOUNDER });
const KEPT_EV = (await getMeeting(DB, KEPT.id)).invite.eventId;
// Ahead, no invite yet
const FRESH = await make(day(60));

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
const PORT = Number(process.env.PORT || 0);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── The browser ──
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 400000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const errs = [];
async function open(path, width = 1280) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width, height: 1000 });
  await page.setExtraHTTPHeaders({ 'x-test-user': FOUNDER });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|imagedelivery|fonts\.gstatic|x-test-user/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { if (!t.__seen) { t.__seen = true; window.__toasts.push(t.textContent.replace(/\s+/g, ' ').trim()); } } }).observe(document, { childList: true, subtree: true });
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
const saved = (page) => page.waitForFunction(() => /^Saved/.test(document.querySelector('.bm-saved')?.textContent.trim() || ''), { timeout: 20000 }).then(() => true, () => false);
const tag = (page) => page.evaluate(() => document.querySelector('.bm-when')?.textContent.trim() || '');
const textOf = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', sel);
async function press(page, sel, re) {
  const h = await page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())) || null, sel, re.source);
  if (!(await h.evaluate((x) => !!x))) throw new Error(`no button “${re.source}” in ${sel}`);
  await h.evaluate((x) => x.scrollIntoView({ block: 'center' }));
  await h.click();
}
const has = (page, sel, re) => page.evaluate((s, src) => [...document.querySelectorAll(s)].some((x) => new RegExp(src).test(x.textContent.trim())), sel, re.source);
/** The dialog that's up: { title, text } */
async function dialog(page) {
  await page.waitForSelector('.ask-overlay [data-ask]', { timeout: 8000 });
  return page.evaluate(() => ({ title: document.querySelector('.ask h2')?.textContent || '', text: document.querySelector('.ask__text')?.textContent || '' }));
}
async function answer(page, which) { await page.click(`.ask-overlay [data-ask="${which}"]`); await sleep(400); }
/** ⋯ at the top → Delete this meeting: the question it asks */
async function askDelete(page) {
  await page.click('.bm-top .bd-menu > summary');
  await sleep(300);
  await press(page, '.bd-menu__item', /^Delete this meeting$/);
  return dialog(page);
}
/** The date typed into When and where, as a person picks one */
async function typeDate(page, date) {
  await page.evaluate((d) => {
    const el = document.querySelector('#bd-date');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, d);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, date);
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const LIVE_WORDS = /A new day, time or place goes on the invite a couple of minutes after you stop typing, and Google emails the guests once\./;
const RECORD_WORDS = /This meeting has been held, so its calendar invite stays as it was: a change here doesn’t go on it, and nobody is emailed\./;
const CANCELS = /Its calendar invite is cancelled too, and Google emails everyone on it\./;

try {
  await step('Held on its day, its invite at that slot: a record, and the page says so', async () => {
    const p = await open(`/admin/#board/meeting/${RECORD.id}`);
    ok(await tag(p) === 'Held', `the page calls it Held (“${await tag(p)}”)`);
    await p.click('#bm-where-toggle');
    await sleep(400);
    const head = await textOf(p, '.bm-where__head');
    ok(RECORD_WORDS.test(head), `When and where says the invite stays as it was (“${head.slice(0, 160)}”)`);
    ok(/The calendar invite stays as it was, since the meeting has been held\./.test(await textOf(p, '#bd-invite-note-hint')), 'and so does the hint under Notes for the invite');
    await shot(p, '01-record-when-where');
    const since = writesTo(RECORD_EV);
    await p.evaluate(() => { const el = document.querySelector('#bd-addr'); el.focus(); });
    await p.keyboard.type('200 Other Street, Atlanta, GA 30301');
    ok(await saved(p), 'the corrected address saves');
    await heartbeat();
    ok(since().length === 0, `Google is sent nothing for it (${JSON.stringify(since())})`);
    const d = await askDelete(p);
    ok(!CANCELS.test(d.text), `Delete doesn’t say its invite is cancelled (“${d.text}”)`);
    await answer(p, 'no');
    await p.close();
  });

  await step('Held on its day because its end time has passed: Held, and no Send the invite', async () => {
    const mins = Number(clockNow().slice(0, 2)) * 60 + Number(clockNow().slice(3));
    if (mins < 20) { console.log('  (just after midnight in Atlanta: no end time today has passed yet, so this one waits for another run)'); return; }
    // (made straight into the site: Board's one-meeting-a-day rule is new-meeting's, and RECORD has today)
    const over = await make(day(0), { start: hhmm(Math.max(0, mins - 120)), end: hhmm(mins - 10) });
    const p = await open(`/admin/#board/meeting/${over.id}`);
    ok(await tag(p) === 'Held', `the page calls it Held (“${await tag(p)}”)`);
    ok(!(await has(p, 'button', /^Send the invite$/)), 'and offers no Send the invite');
    await p.close();
    const r = await (await realFetch(`${SITE}/api/board-admin`, { method: 'POST', headers: { 'x-test-user': FOUNDER, 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify({ action: 'send-invite', id: over.id }) })).json();
    ok(r.ok === false && r.error === 'This meeting has already been held, so no calendar invite goes out for it.', `and the site refuses one from a stale tab in words (“${r.error}”)`);
    await DB.prepare('DELETE FROM board_meetings WHERE id = ?').bind(over.id).run();
  });

  await step('Moved to yesterday while its invite is still ahead, then deleted: the invite comes off the calendar', async () => {
    const p = await open(`/admin/#board/meeting/${MOVED.id}`);
    await p.click('#bm-where-toggle');
    await sleep(400);
    await typeDate(p, day(-1));
    ok(await saved(p), 'the new day saves');
    ok(await tag(p) === 'Held', `the page calls it Held (“${await tag(p)}”)`);
    const head = await textOf(p, '.bm-where__head');
    ok(LIVE_WORDS.test(head), `When and where says the change goes on the invite (“${head.slice(0, 160)}”)`);
    await shot(p, '02-moved-when-where');
    const d = await askDelete(p);
    ok(CANCELS.test(d.text), `Delete says its invite is cancelled too (“${d.text}”)`);
    await shot(p, '03-moved-delete');
    const since = writesTo(MOVED_EV);
    await answer(p, 'yes');
    await sleep(1500);
    ok(JSON.stringify(since()) === JSON.stringify([['DELETE', 'all']]), `Google cancels it and tells the guests (${JSON.stringify(since())})`);
    ok(google.events[MOVED_EV].status === 'cancelled', 'nothing is left on the board’s calendars');
    ok(!(await getMeeting(DB, MOVED.id)), 'and the meeting is gone');
    await p.close();
  });

  await step('Moved to yesterday and kept: its invite goes to that day with one email, then the page says it’s a record', async () => {
    const p = await open(`/admin/#board/meeting/${KEPT.id}`);
    await p.click('#bm-where-toggle');
    await sleep(400);
    await typeDate(p, day(-1));
    ok(await saved(p), 'the new day saves');
    const since = writesTo(KEPT_EV);
    await heartbeat();
    ok(JSON.stringify(since()) === JSON.stringify([['PATCH', 'all']]), `the heartbeat moves the invite, with one email from Google (${JSON.stringify(since())})`);
    ok(String(google.events[KEPT_EV].start?.dateTime || '').startsWith(day(-1)), `the invite is on ${day(-1)} now (${google.events[KEPT_EV].start?.dateTime})`);
    await p.close();
    const q = await open(`/admin/#board/meeting/${KEPT.id}`);
    await q.click('#bm-where-toggle');
    await sleep(400);
    const head = await textOf(q, '.bm-where__head');
    ok(RECORD_WORDS.test(head), `When and where now says the invite stays as it was (“${head.slice(0, 160)}”)`);
    const d = await askDelete(q);
    ok(!CANCELS.test(d.text), `and Delete doesn’t say it’s cancelled (“${d.text}”)`);
    await answer(q, 'no');
    await q.close();
  });

  await step('Send the invite pressed while Board is sending it by itself: said in plain words, and it goes once', async () => {
    const p = await open(`/admin/#board/meeting/${FRESH.id}`);
    // The heartbeat sending this meeting's invite right now, as the site marks it
    await DB.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(`board-invite-sending:${FRESH.id}`, JSON.stringify({ by: 'Board', n: 'other' }), new Date().toISOString()).run();
    const before = google.calls.filter((c) => c.method === 'POST' && c.id && !/^boardcheck/.test(c.id)).length;
    const t0 = (await toasts(p)).length;
    await press(p, '.bm-ready button', /^Send the invite$/);
    await dialog(p);
    await answer(p, 'yes');
    await sleep(2000);
    const said = (await toasts(p)).slice(t0);
    ok(said.some((x) => /^This meeting’s invite is going out from Board by itself right now\. Look again in a moment\./.test(x)), `it says so in plain words (${said.join(' | ') || 'nothing'})`);
    ok(!said.some((x) => /HTTP|409|error/i.test(x)), 'never a code');
    await shot(p, '04-busy');
    // Free again: the press goes, once
    await DB.prepare('DELETE FROM board_state WHERE key = ?').bind(`board-invite-sending:${FRESH.id}`).run();
    const t1 = (await toasts(p)).length;
    await press(p, '.bm-ready button', /^Send the invite$/);
    await dialog(p);
    await answer(p, 'yes');
    await sleep(2000);
    const after = (await toasts(p)).slice(t1);
    ok(after.some((x) => /^Invite sent to /.test(x)), `then it goes (${after.join(' | ') || 'nothing'})`);
    const posts = google.calls.filter((c) => c.method === 'POST' && c.id && !/^boardcheck/.test(c.id)).length - before;
    ok(posts === 1, `one event at Google (${posts})`);
    await p.close();
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
