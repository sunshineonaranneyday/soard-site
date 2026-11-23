/**
 * test-board-round3-server.mjs — Board QA round 3 (Nov 20 2026), the server fixes as the board page shows them, in a real browser
 * ====================================================================================================
 * Serves public/ (with the admin's real CSP from public/_headers) and answers /api/board-* with the real handlers
 * behind the real sign-in middleware, on an in-memory D1 (sql.js) and R2; Google, Resend, Mercury and JobTread are
 * faked, so nothing leaves this machine. Made-up people only (the repo is public). Checks:
 *   - M3: a meeting kept off the board page (a coffee) never reaches Sam's board page by way of the next meeting Board
 *     adds: not its to-do, not its name; his own to-do from the last board meeting is on his Home
 *   - M4: a meeting ahead kept off the board page, shared before its agenda is approved, is refused, and Alex's board
 *     page never shows its agenda; a "not a board meeting" shared from the editor stays on the board page after the
 *     tab's next save
 *   - m3: a report saved on the board page as the meeting is deleted says it's gone, in words, never a program's error
 *   - no console errors
 * Screenshots land in test-results/board-round3/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-round3-server.mjs
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
import { provideBoardFinance, saveMeeting, patchMeeting, getMeeting } from '../functions/api/_board.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-round3/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const YEAR = Number(day(0).slice(0, 4));

const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', organization: 'Ortiz & Co', order: 2 },
};

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
  async get(key) { const o = this.map.get(key); return o ? { body: o.bytes, size: o.bytes.length, httpMetadata: { contentType: o.type } } : null; }
  async head(key) { const o = this.map.get(key); return o ? { size: o.bytes.length } : null; }
  async delete(key) { this.map.delete(key); }
}

// D1, with a look before each statement (`hook`): what lands between a read and its write
const raw = await createD1();
let hook = async () => {};
const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: async (c) => { await hook(st._sql); return st.first(c); }, all: async () => { await hook(st._sql); return st.all(); }, run: async () => { await hook(st._sql); return st.run(); } });
const DB = { ...raw, prepare: (sql) => wrap(raw.prepare(sql)) };
for (const sql of [
  'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)',
  'CREATE TABLE community (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
]) await raw.exec(sql);
for (const [slug, d] of Object.entries(PEOPLE)) await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
for (const [slug, email] of [['alex-rivera', ALEX], ['sam-ortiz', SAM]]) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();

// ── The outside world, faked ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = { GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }), DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', MERCURY_API_TOKEN: 'mercury-test', MERCURY_RELAY_KEY: 'relay-test', JOBTREAD_GRANT_KEY: 'jt-test' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body || '[]'); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
  if (url.startsWith('https://mercury-relay.sunshineonaranneyday.com/')) return Response.json({ transactions: [], accounts: [] });
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (/googleapis\.com/.test(url)) return Response.json({ items: [], messages: [], members: [], files: [], conferenceRecords: [] });
  if (url === 'https://api.jobtread.com/pave') return Response.json({ organization: { jobs: { nodes: [], nextPage: null } } });
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return Response.json({ error: 'test: no outside calls' }, { status: 502 });
  return realFetch(input, init);
};
_resetKeyCacheForTests();
provideBoardFinance(async () => ({
  at: new Date().toISOString(),
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 15)).toISOString().slice(0, 7), income: 80000, makeovers: 40000, store: 12000, operating: 18000, storeSales: 25000, net: 10000 })),
  ytd: { year: YEAR, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 },
  lastYtd: { year: YEAR - 1, through: day(-365), income: 800000, makeovers: 480000, store: 140000, operating: 200000, net: -20000 },
  cash: { today: 375000, lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000, belowFloor: false },
  perMakeover: { count: 12, average: 21000 },
}));

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
        return fn ? fn(ctx) : Response.json({ success: true, ok: true, items: [], pages: 1, files: [], entries: [] });
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
    console.error('server', err);
    res.writeHead(500); res.end(String(err?.stack || err));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const api = async (who, body) => { const r = await fetch(`${SITE}/api/board-admin`, { method: 'POST', headers: { 'x-test-user': who, Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const approved = async (id) => {
  await ensureAsks(DB);
  const at = new Date().toISOString();
  await raw.prepare("INSERT INTO board_asks (id, kind, meeting_id, item_id, slug, name, email, title, status, asked_at, in_at, msg_ids, files, updated_at) VALUES (?, 'chair', ?, '', 'admin', 'Alex Rivera', '', '', 'approved', ?, ?, '[]', '[]', ?)").bind(`ask_${id}`, id, at, at, at).run();
};
const typed = { kind: 'typed', name: '', at: new Date().toISOString() };

// ── The meetings ──
// The last board meeting, held, its minutes in and not shared yet: Sam's to-do from it
await saveMeeting(DB, cleanMeeting({ date: day(-10), start: '08:00', end: '10:00', location: 'Example Hall', agendaFrom: typed, sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }],
  actions: [{ id: 'a_samown01', text: 'Call the bank about the line of credit', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }] }), { by: FOUNDER });
// A coffee the calendar brought in (kept off the board page), since then, with a to-do for Sam
const coffee = await saveMeeting(DB, cleanMeeting({ date: day(-5), start: '09:00', end: '10:00', title: 'Coffee with a donor', notBoard: true, agendaFrom: typed,
  sections: [{ title: 'Coffee', items: [{ title: 'Their gift' }] }], actions: [{ id: 'a_offpage1', text: 'OFFPAGE confidential donor list', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }] }), { by: FOUNDER });
// A meeting ahead not approved yet, and kept off the board page
const kept = await saveMeeting(DB, cleanMeeting({ date: day(12), start: '18:00', end: '19:00', title: 'Special Meeting', agendaFrom: typed,
  sections: [{ title: 'Money', items: [{ title: 'NOTAPPROVED budget item', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] }] }), { by: FOUNDER });
await patchMeeting(DB, kept.id, (cur) => ({ ...cur, notBoard: true }));
// A held "not a board meeting" to share from the editor
const held = await saveMeeting(DB, cleanMeeting({ date: day(-3), start: '08:00', end: '09:00', title: 'Retreat', agendaFrom: typed, sections: [{ title: 'Planning', items: [{ title: 'HELDRETREAT the next five years' }] }] }), { by: FOUNDER });
await patchMeeting(DB, held.id, (cur) => ({ ...cur, notBoard: true }));
// Ahead, approved and shared: Sam presents its budget
const ahead = await saveMeeting(DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', location: 'Example Hall', agendaFrom: typed,
  sections: [{ title: 'Finance', items: [{ id: 'i_samrep3', title: 'Budget', presenter: 'Sam Ortiz', who: ['sam-ortiz'] }] }] }), { by: FOUNDER });
await approved(ahead.id);
await patchMeeting(DB, ahead.id, (cur) => ({ ...cur, shared: true }));

const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 240000, args: ['--no-sandbox', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const consoleErrors = [];
async function tab(email, width = 1440, height = 1000) {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
  await page.setExtraHTTPHeaders({ 'x-test-user': email });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Content Security Policy|imagedelivery/.test(m.text())) consoleErrors.push(`${email} ${width}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${email} ${width}: ${String(e?.message || e).slice(0, 300)}`));
  return page;
}
async function open(page, hash) {
  await page.goto(`${SITE}/admin/board/${hash}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('.bp-boot') && document.querySelector('main')?.innerText.length > 50, { timeout: 30000 }).catch(() => {});
  await sleep(900);
}
const textOf = (page) => page.$eval('main', (e) => e.innerText.replace(/ /g, ' ')).catch(() => '');

try {
  // ─── M3: the next meeting Board adds carries nothing of the coffee ───
  const next = (await api(FOUNDER, { action: 'new-meeting', date: day(20) })).body.meeting;
  ok(next && !next.actions.some((a) => a.id === 'a_offpage1') && next.actions.some((a) => a.id === 'a_samown01'), 'M3: the new meeting carries Sam’s own to-do and not the coffee’s');
  await approved(next.id);
  const share = await api(FOUNDER, { action: 'save-meeting', meeting: { ...next, shared: true }, base: next.updatedAt });
  ok(share.status === 200, `M3: approved, it’s shared (${share.status})`);
  for (const w of [1440, 390]) {
    const p = await tab(SAM, w, 900);
    await open(p, '#/');
    const home = await textOf(p);
    ok(/Call the bank about the line of credit/.test(home), `M3 ${w}px: Sam’s Home has his own to-do from the last board meeting`);
    ok(!/OFFPAGE|confidential donor list|Coffee with a donor/.test(home), `M3 ${w}px: Sam’s Home has nothing of the coffee`);
    await open(p, `#/meetings/${next.id}`);
    ok(!/OFFPAGE|Coffee with a donor/.test(await textOf(p)), `M3 ${w}px: nor does the new meeting’s page`);
    await p.screenshot({ path: join(OUT, `m3-sam-${w}.png`) });
    await p.close();
  }

  // ─── M4: shared past its approval as "not a board meeting": refused, and the board never sees its agenda ───
  const k = await getMeeting(DB, kept.id);
  const refused = await api(FOUNDER, { action: 'save-meeting', meeting: { ...k, shared: true }, base: k.updatedAt });
  ok(refused.status === 409 && /once it’s approved/.test(refused.body.error || ''), `M4: sharing it before the approval is refused (${refused.status} ${refused.body.error || ''})`);
  const plain = await saveMeeting(DB, cleanMeeting({ date: day(30), start: '08:00', end: '10:00', agendaFrom: typed, sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }] }), { by: FOUNDER });
  const tagged = await api(FOUNDER, { action: 'save-meeting', meeting: { ...plain, notBoard: true }, base: plain.updatedAt });
  ok(tagged.status === 200 && tagged.body.meeting?.notBoard === false, 'M4: an editor’s copy never tags a meeting "not a board meeting"');
  // A held one shared from the editor, then the same tab's next save, its copy still saying "not a board meeting"
  const h = await getMeeting(DB, held.id);
  const shared = await api(FOUNDER, { action: 'save-meeting', meeting: { ...h, shared: true }, base: h.updatedAt });
  const stale = await api(FOUNDER, { action: 'save-meeting', meeting: { ...h, shared: true, notBoard: true, inviteNote: 'Typed after sharing' }, base: shared.body.meeting?.updatedAt });
  ok(shared.status === 200 && stale.status === 200 && (await getMeeting(DB, held.id)).notBoard === false, `M4: shared, the tab’s next save keeps it on the board page (${shared.status}, ${stale.status})`);
  for (const w of [1440, 390]) {
    const p = await tab(ALEX, w, 900);
    await open(p, '#/meetings');
    const list = await textOf(p);
    ok(!/Special Meeting|NOTAPPROVED/.test(list), `M4 ${w}px: Alex’s Meetings never has the meeting not approved`);
    ok(/Retreat/.test(list), `M4 ${w}px: the held meeting shared from the editor is on it`);
    await open(p, `#/meetings/${kept.id}`);
    ok(!/NOTAPPROVED/.test(await textOf(p)), `M4 ${w}px: nor does its own page show its agenda`);
    await open(p, `#/meetings/${held.id}`);
    ok(/HELDRETREAT/.test(await textOf(p)), `M4 ${w}px: the held one’s agenda is on its page`);
    await p.screenshot({ path: join(OUT, `m4-alex-${w}.png`) });
    await p.close();
  }

  // ─── m3: a report saved as the meeting is deleted: said in words ───
  {
    const p = await tab(SAM, 1440, 900);
    await open(p, `#/meetings/${ahead.id}/report/i_samrep3`);
    await p.waitForSelector('.rp-edit', { timeout: 20000 });
    // The other admin deletes the meeting just as Sam's words are written
    let once = false;
    hook = async (sql) => {
      if (once || !/^UPDATE board_meetings SET date = \?, data = \?/.test(sql)) return;
      once = true;
      await raw.prepare('DELETE FROM board_meetings WHERE id = ?').bind(ahead.id).run();
    };
    await p.click('.rp-edit');
    await p.keyboard.type('Revenue is ahead of the budget this quarter.');
    const shown = await p.waitForFunction(() => /can’t be saved now|Not saved/.test(document.querySelector('main')?.innerText || ''), { timeout: 20000 }).then(() => true, () => false);
    const words = await textOf(p);
    hook = async () => {};
    ok(shown && /That meeting isn’t on the board page/.test(words), `m3: the page says the meeting isn’t there (${(words.match(/[^\n]*(can’t be saved|Not saved)[^\n]*/) || [''])[0].slice(0, 160)})`);
    ok(!/Cannot read|properties of null|TypeError|UNIQUE|D1_ERROR/.test(words), 'm3: never a program’s error');
    await p.screenshot({ path: join(OUT, 'm3-report-gone.png') });
    await p.close();
  }
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.slice(0, 4).join(' | ')}` : ''}`);
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join('\n- ')}` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
