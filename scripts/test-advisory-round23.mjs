/**
 * test-advisory-round23.mjs: Advisory Board QA round 23 (minor 4), in a real browser
 * ============================================================================
 * Admin → People → Applications, the module in the admin's own styles, every request answered by the real admin
 * handler (functions/api/advisory-applications-admin.js) over an in-memory D1. Made-up people only; Resend, Cloudflare
 * Access and Images are faked. What the boxes say about advisory@soardcharity.com follows the Advisory Board's emails
 * switch, as the Add box's own words do (the group fills in by itself only once emails are on):
 *   - "Keep it Joined" (moving a Joined application off Joined): with emails off, never "with their sign-in, reveal
 *     invites and advisory@"; with them on, as before
 *   - a test application's warning in the Add box: "the emails to advisory@… once Advisory Board emails are on" with them
 *     off
 * At 1280 and 390. Screenshots land in test-results/advisory-round23/. Exits non-zero on any failure or page error.
 *   node scripts/test-advisory-round23.mjs        (PORT=5051 by default)
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as adminApi from '../functions/api/advisory-applications-admin.js';
import { submitApplication, readHeadshot } from '../functions/api/_advisory-applications.js';
import { writeState } from '../functions/api/_board-roles.js';
// (round 24: every page served without Cloudflare's analytics beacon, so nothing leaves this machine)
import { servesPage } from '../tests/lib/local-only.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/advisory-round23/');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 5051);
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Resend, Access and Images, faked ──
const access = { groups: [], policies: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') { const list = [JSON.parse(init.body)].flat(); return Response.json({ data: list.map((_, i) => ({ id: `em_${i}` })) }); }
  if (url.host === 'api.cloudflare.com' && url.pathname.includes('/images/v1')) {
    if (init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } }); }
    return Response.json({ success: true, result: {} });
  }
  if (url.host === 'api.cloudflare.com' && url.pathname.startsWith('/client/v4/accounts/acct/access/')) {
    const method = init.method || 'GET';
    const path = url.pathname.replace('/client/v4/accounts/acct', '');
    const okr = (result) => Response.json({ success: true, result });
    if (path === '/access/groups' && method === 'GET') return okr(access.groups);
    if (path === '/access/groups' && method === 'POST') { const g = { id: 'g1', ...JSON.parse(init.body) }; access.groups.push(g); return okr(g); }
    if (path === '/access/groups/g1' && method === 'GET') return okr(access.groups[0]);
    if (path === '/access/groups/g1' && method === 'PUT') { Object.assign(access.groups[0], JSON.parse(init.body)); return okr(access.groups[0]); }
    if (path === '/access/policies' && method === 'GET') return okr(access.policies);
    if (path === '/access/policies' && method === 'POST') { const p = { id: 'p1', ...JSON.parse(init.body) }; access.policies.push(p); return okr(p); }
    if (path === '/access/apps' && method === 'GET') return okr([{ aud: 'aud-admin', name: 'SOARD admin', policies: access.policies.map((p) => ({ id: p.id })) }]);
  }
  if (url.hostname === 'hooks.slack.test') return new Response('ok');
  return realFetch(input, init);
};

const DB = await createD1();
const env = { DB, RESEND_API_KEY: 'r', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x', CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', CF_ACCESS_API_TOKEN: 'a', CF_ACCESS_AUD: 'aud-admin' };
await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
const emails = (on) => writeState(DB, 'advisory', { emails: on });
const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
const SHOT = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
const base = { phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
  introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true };
const apply = async (fullName, email) => (await submitApplication(env, { ...base, fullName, email, signature: fullName }, { headshot: SHOT })).app;
const addVia = async (app) => {
  const g = async (q) => (await (await adminApi.onRequestGet({ env, request: new Request(`https://site.test/api/advisory-applications-admin${q}`), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} })).json());
  const p = (await g(`?plan=${app.id}`)).plan;
  const r = await adminApi.onRequestPost({ env, request: new Request('https://site.test/api/advisory-applications-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ add: { id: app.id, as: 'new', seen: p.key } }) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
  return r.json();
};

// ── The admin shell around the module ──
const adminHtml = readFileSync(join(ROOT, 'public/admin/index.html'), 'utf8');
const adminStyles = [...adminHtml.slice(0, adminHtml.indexOf('<script')).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const harness = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Applications harness</title><style>${adminStyles}</style></head>
<body><div class="app"><aside class="sidebar"></aside><div class="main"><div id="root"></div></div></div>
<script type="module">
import { h, render } from './vendor.js';
import { AdvisoryApplications } from './advisory-applications.js';
window.__toasts = [];
const addToast = (msg, kind) => { window.__toasts.push({ msg, kind }); };
const kit = { team: [], api: { saveContent: async () => ({ success: true }), readContent: async () => ({ success: false }) }, toPersonRecord: (d) => ({ ...d }), onOpenPerson: () => {}, onTeamChanged: () => {} };
render(h(AdvisoryApplications, { addToast, kit }), document.getElementById('root'));
</script></body></html>`;
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/admin/__advisory.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(harness); }
  const file = join(ROOT, 'public', path);
  if (file.startsWith(join(ROOT, 'public')) && existsSync(file) && statSync(file).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); return res.end(servesPage(file, readFileSync(file))); }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

async function answer(req) {
  const url = new URL(req.url());
  if (url.pathname === '/api/advisory-applications-admin') {
    const request = new Request(`https://site.test${url.pathname}${url.search}`, { method: req.method(), body: req.method() === 'POST' ? req.postData() : undefined, headers: { 'content-type': 'application/json' } });
    const waits = [];
    const ctx = { env, request, data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: (p) => waits.push(p) };
    const r = req.method() === 'POST' ? await adminApi.onRequestPost(ctx) : await adminApi.onRequestGet(ctx);
    await Promise.all(waits);
    return req.respond({ status: r.status, contentType: 'application/json', body: Buffer.from(await r.arrayBuffer()) });
  }
  if (url.hostname !== '127.0.0.1') return req.respond(req.resourceType() === 'script' ? { status: 200, contentType: 'text/javascript', body: '' } : { status: 200, contentType: 'image/png', body: PNG });
  return false;
}

const browser = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const clickText = (page, sel, re) => page.evaluate((s, src) => { const el = [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())); if (el) { el.click(); return true; } return false; }, sel, re.source);
/** An application's panel → the page */
async function panel(app, width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await page.setRequestInterception(true);
  page.on('request', async (req) => { try { if (await answer(req) === false) req.continue(); } catch (e) { console.error(e); req.respond({ status: 500, body: '{}' }); } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${SITE}/admin/__advisory.html#advisory-applications/${app.id}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await sleep(300);
  return page;
}
/** "Keep it Joined": Not now pressed on a Joined application → what the box says */
async function leaving(app, width, shot) {
  const page = await panel(app, width);
  ok(await clickText(page, '.ava-status button', /^Not now$/), `${width}: the panel has Not now`);
  await page.waitForSelector('.ava-dialog', { timeout: 5000 }).catch(() => null);
  await sleep(300);
  const said = await text(page, '.ava-dialog');
  await page.screenshot({ path: join(OUT, `${shot}-${width}.png`) });
  ok(/^Keep it Joined$/.test(await page.$eval('.ava-dialog [data-autofocus]', (el) => el.textContent.trim()).catch(() => '')), `${width}: Keep it Joined is the box's first button`);
  await page.close();
  return said;
}

for (const width of [1280, 390]) {
  console.log(`At ${width}`);
  // Emails off: what's true now, never advisory@ as theirs
  await emails(false);
  const lane = await apply(`Lane Leave${width === 390 ? 'p' : 'd'}`, `lane.${width}@example.org`);
  ok((await addVia(lane)).person?.made, `${lane.name} added with emails off`);
  const off = await leaving(lane, width, 'keep-joined-emails-off');
  ok(off.includes(`${lane.name} stays on the Advisory Board, with their sign-in and reveal invites, and on advisory@soardcharity.com once Advisory Board emails are on: Move to alumni on their People page is how someone leaves.`), `${width}, emails off: the box says advisory@ comes once emails are on (${off})`);
  ok(!/reveal invites and advisory@/.test(off), `${width}, emails off: never "reveal invites and advisory@" as theirs now`);
  // Emails on: as before, all three theirs
  await emails(true);
  const mia = await apply(`Mia Stayo${width === 390 ? 'p' : 'd'}`, `mia.${width}@example.org`);
  ok((await addVia(mia)).person?.made, `${mia.name} added with emails on`);
  const on = await leaving(mia, width, 'keep-joined-emails-on');
  ok(on.includes(`${mia.name} stays on the Advisory Board, with their sign-in, reveal invites and advisory@soardcharity.com: Move to alumni on their People page is how someone leaves.`), `${width}, emails on: their sign-in, reveal invites and advisory@ (${on})`);
  ok(!/once Advisory Board emails are on/.test(on), `${width}, emails on: nothing waits on the switch`);

  // A test application's warning in the Add box, both ways
  for (const sw of [false, true]) {
    await emails(sw);
    const t = await apply(`Test Taylor${width}${sw ? 'n' : 'f'}`, `test.${width}.${sw ? 'on' : 'off'}@example.org`);
    const page = await panel(t, width);
    await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
    await page.waitForSelector('.ava-dialog', { timeout: 5000 }).catch(() => null);
    await sleep(300);
    const said = await text(page, '.ava-dialog');
    await page.screenshot({ path: join(OUT, `test-warning-emails-${sw ? 'on' : 'off'}-${width}.png`) });
    ok(said.includes(`Adding it makes a real Advisory Board member who gets reveal invites and the emails to advisory@soardcharity.com${sw ? '.' : ' once Advisory Board emails are on.'}`), `${width}, emails ${sw ? 'on' : 'off'}: the test warning says advisory@ ${sw ? 'now' : 'once emails are on'} (${said.slice(0, 260)})`);
    ok(said.includes(`puts them on advisory@soardcharity.com${sw ? ',' : ' once Advisory Board emails are on,'}`), `${width}, emails ${sw ? 'on' : 'off'}: the Add box’s own line, as before`);
    await page.close();
  }
}

ok(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await browser.close();
server.close();
globalThis.fetch = realFetch;
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
