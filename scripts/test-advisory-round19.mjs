/**
 * test-advisory-round19.mjs: Advisory Board round 19, in a real browser
 * ============================================================================
 * Admin → People → Applications → Add to Advisory Board, the module in the admin's own styles, every request answered
 * by the real admin handler (functions/api/advisory-applications-admin.js) over an in-memory D1, with People's rename
 * (functions/api/rename-content.js) and the heartbeat's finisher run on the same D1. Made-up people only; Resend,
 * Cloudflare Access and Images are faked. Checks the boxes staff press and what they leave on People:
 *   M1  a different Jordan Ames applies while the first one's rename is still moving her Advisory Board page records:
 *       the plain "Add" box adds him at an address of his own, and her records reach her new address
 *   M2  "A different person" stopped partway, its address written down: renaming the member with the name into it is
 *       refused in words, the box still asks "Is this the same", and "A different person" adds the new person there
 * Screenshots land in test-results/advisory-round19/. Exits non-zero on any failure or page error.
 *   node scripts/test-advisory-round19.mjs        (PORT=4701 by default)
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
const OUT = join(ROOT, 'test-results/advisory-round19/');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 4701);
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Resend, Access and Images, faked ──
const delivered = [];
const keys = new Map();
const access = { groups: [], policies: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') {
    const key = init.headers?.['Idempotency-Key'] || '';
    if (key && keys.has(key)) { const had = keys.get(key); return had.body === init.body ? Response.json(had.res) : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 }); }
    const list = [JSON.parse(init.body)].flat();
    delivered.push(...list);
    const res = { data: list.map((_, i) => ({ id: `em_${delivered.length}_${i}` })) };
    if (key) keys.set(key, { body: init.body, res });
    return Response.json(res);
  }
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

// ── D1, with one statement made to not answer when a check says so (alone or in a batch, as D1 fails a batch whole) ──
const RAW = await createD1();
let faultNow = null; // { test(sql), after?: RegExp, armed }
const hit = (sql) => {
  const f = faultNow;
  if (!f) return false;
  if (!f.armed) { if (f.after.test(sql)) f.armed = true; return false; }
  if (!f.test(sql)) return false;
  faultNow = null;
  return true;
};
const boom = () => { throw new Error('D1_ERROR: qa fault'); };
const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), run: async () => { if (hit(st._sql)) boom(); return st.run(); }, first: async (c) => { if (hit(st._sql)) boom(); return st.first(c); }, all: async () => { if (hit(st._sql)) boom(); return st.all(); } });
const DB = { ...RAW, prepare: (sql) => wrap(RAW.prepare(sql)), batch: async (stmts) => { for (const s of stmts) if (hit(s._sql)) boom(); return RAW.batch(stmts); } };
const failOnce = (test, after = null) => { faultNow = { test, after, armed: !after }; };
const env = { DB, RESEND_API_KEY: 'r', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x', CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', CF_ACCESS_API_TOKEN: 'a', CF_ACCESS_AUD: 'aud-admin' };
await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
const onPeople = async (slug, d, email) => {
  await RAW.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, 0, JSON.stringify({ slug, status: 'active', publishStatus: 'published', ...d })).run();
  if (email) await RAW.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
};
const holdAll = async (slug) => { for (const k of [`slug:${slug}`, `edit:${slug}`, `gone:${slug}`]) await RAW.prepare('INSERT OR REPLACE INTO advisory_add_holds (key, at) VALUES (?, ?)').bind(k, Date.now()).run(); };
const letGoAll = () => RAW.prepare('DELETE FROM advisory_add_holds').run();
const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
const SHOT = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
const base = { phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
  introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true };
const apply = async (fullName, email) => (await submitApplication(env, { ...base, fullName, email, signature: fullName }, { headshot: SHOT })).app;

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
async function open(width, path, height = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await page.setRequestInterception(true);
  page.on('request', async (req) => { try { if (await answer(req) === false) req.continue(); } catch (e) { console.error(e); req.respond({ status: 500, body: '{}' }); } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  return page;
}
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const clickText = (page, sel, re) => page.evaluate((s, src) => { const el = [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())); if (el) { el.click(); return true; } return false; }, sel, re.source);
/** An application's panel, and its Add box open → the page */
async function box(app, width = 1280, height = 900) {
  const page = await open(width, `/admin/__advisory.html#advisory-applications/${app.id}`, height);
  await page.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
  await page.waitForSelector('.ava-dialog', { timeout: 5000 });
  await sleep(300);
  return page;
}
const said = async (page) => ({ title: await text(page, '.ava-dialog h2'), body: await text(page, '.ava-dialog') });
/** Press a button in the box; → the toast it left */
async function press(page, re) {
  const n = await page.evaluate(() => window.__toasts.length);
  ok(await clickText(page, '.ava-dialog button', re), `the box has ${re}`);
  await page.waitForFunction((k) => window.__toasts.length > k, { timeout: 8000 }, n).catch(() => null);
  await sleep(400);
  return page.evaluate(() => window.__toasts.at(-1)?.msg || '');
}

const { rename } = await import('../functions/api/rename-content.js');
const { maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
await (await import('../functions/api/_advisory.js')).ensureAdvisory(RAW);
const ren = (from, to) => rename(env, { collection: 'team', from, to }, 'linzi@soardcharity.com', async () => Response.json({ success: true }));
const slugsLike = async (p) => ((await RAW.prepare('SELECT slug FROM team WHERE slug LIKE ? ORDER BY slug').bind(`${p}%`).all()).results || []).map((r) => r.slug);
const emailAt = async (slug) => (await RAW.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(slug).first())?.email || null;
const addVia = async (app, as) => {
  const g = async (q) => (await (await adminApi.onRequestGet({ env, request: new Request(`https://site.test/api/advisory-applications-admin${q}`), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} })).json());
  const p = (await g(`?plan=${app.id}`)).plan;
  const r = await adminApi.onRequestPost({ env, request: new Request('https://site.test/api/advisory-applications-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ add: { id: app.id, as, seen: p.key } }) }), data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: () => {} });
  return r.json();
};

// ── M1 ──
console.log('M1: a new Jordan Ames while the first one’s rename is still moving her records');
{
  const first = await apply('Jordan Ames', 'jordan.ames@example.org');
  ok((await addVia(first, 'new')).person?.slug === 'jordan-ames', 'the first Jordan Ames is at jordan-ames');
  await RAW.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind('ask-j', 'jordan-ames', 'yes', 'I can host', '2026-11-01T00:00:00.000Z').run();
  await RAW.prepare('INSERT INTO advisory_signatures (doc_id, slug, year, name, version, at) VALUES (?, ?, ?, ?, ?, ?)').bind('commitment', 'jordan-ames', 2026, 'Jordan Ames', 1, '2026-11-01T00:00:00.000Z').run();
  await RAW.prepare('INSERT INTO advisory_credits (payment_id, slug, note, at, by) VALUES (?, ?, ?, ?, ?)').bind('pay-j', 'jordan-ames', 'gift via their page', '2026-11-02T00:00:00.000Z', 'qa').run();
  await RAW.prepare("UPDATE team SET data = json_set(data, '$.name', 'Jordan Smith'), name = 'Jordan Smith' WHERE slug = 'jordan-ames'").run();
  // (the move of her answers, whichever way it's written: round 20 made it a plain UPDATE, a clash folded in before it)
  failOnce((sql) => /^UPDATE (?:OR IGNORE )?advisory_answers SET slug/.test(sql));
  const r = await ren('jordan-ames', 'jordan-smith');
  ok(r.status === 200 && /still moving to the new address/.test(r.body.note || ''), `her rename: its page records still moving (${r.status} ${r.body.note || r.body.error})`);
  const second = await apply('Jordan Ames', 'other.jordan@example.org');
  // (the box on a phone first, nothing pressed: once one new Jordan is added, the next is asked whether it's him)
  for (const width of [390, 1280]) {
    const p = await box(second, width, width === 390 ? 844 : 900);
    const s = await said(p);
    const buttons = await p.$$eval('.ava-dialog button', (els) => els.map((e) => e.textContent.trim()));
    ok(s.title === 'Add Jordan Ames to the Advisory Board' && buttons.includes('Add them'), `${width}px: a plain Add box (${JSON.stringify({ title: s.title, buttons })})`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: the box fits`);
    await p.screenshot({ path: join(OUT, `m1-add-box-${width}.png`) });
    if (width === 1280) {
      const toast = await press(p, /^Add them$/);
      ok(/^Jordan Ames is on the Advisory Board/.test(toast), `added (${JSON.stringify(toast)})`);
    }
    await p.close();
  }
  const on = await slugsLike('jordan-');
  ok(JSON.stringify(on) === JSON.stringify(['jordan-ames-2', 'jordan-smith']), `the new Jordan at an address of his own, nobody at jordan-ames (${JSON.stringify(on)})`);
  const done = await maybeFinishRenames(DB, { now: Date.now() + 2 * 60 * 1000 });
  const where = await Promise.all([['advisory_answers', 'ask_id', 'ask-j'], ['advisory_signatures', 'doc_id', 'commitment'], ['advisory_credits', 'payment_id', 'pay-j']]
    .map(async ([t, k, v]) => (await RAW.prepare(`SELECT slug FROM ${t} WHERE ${k} = ?`).bind(v).first())?.slug));
  ok(done.includes('jordan-ames') && where.every((x) => x === 'jordan-smith'), `the heartbeat moves her answer, signature and gift to jordan-smith (${JSON.stringify(where)})`);
}

// ── M2 ──
console.log('M2: a stopped "A different person", then the member renamed into its address');
{
  await onPeople('rowan-ashby-2', { name: 'Rowan Ashby', group: 'advisory', organization: 'Ashby Builders' });
  const app = await apply('Rowan Ashby', 'rowan.applicant@example.org');
  const p = await box(app);
  ok((await said(p)).title === 'Is this the same Rowan Ashby?', 'the box asks');
  failOnce((sql) => /^INSERT INTO team /.test(sql.trim()));
  const toast = await press(p, /^A different person$/);
  ok(toast === 'The site’s database didn’t answer just now, so nobody was added. Press Add to Advisory Board again in a moment.', `the save not answering: nobody added (${JSON.stringify(toast)})`);
  await p.close();
  const r = await ren('rowan-ashby-2', 'rowan-ashby');
  ok(r.status === 409 && r.body.error === 'Someone new is being added to the Advisory Board at “rowan-ashby” (their Add stopped partway, and pressing Add to Advisory Board on their application again finishes it). Pick another address.',
    `renaming the member into the written-down address is refused in words (${r.status} ${r.body.error || 'ok'})`);
  const p2 = await box(app);
  const s2 = await said(p2);
  ok(s2.title === 'Is this the same Rowan Ashby?', `the box still asks, never "Link Rowan Ashby" (${JSON.stringify(s2.title)})`);
  await p2.screenshot({ path: join(OUT, 'm2-still-asks.png') });
  const t2 = await press(p2, /^A different person$/);
  ok(/^Rowan Ashby is on the Advisory Board/.test(t2), `"A different person" adds them (${JSON.stringify(t2)})`);
  await p2.close();
  ok(JSON.stringify(await slugsLike('rowan-')) === JSON.stringify(['rowan-ashby', 'rowan-ashby-2']), 'the new Rowan at rowan-ashby, the member still at rowan-ashby-2');
  ok(await emailAt('rowan-ashby') === 'rowan.applicant@example.org' && await emailAt('rowan-ashby-2') === null, 'the applicant’s email on the new record only, never the member’s');
}

ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll round 19 checks passed');
process.exit(failures.length ? 1 : 0);
