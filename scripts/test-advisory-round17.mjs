/**
 * test-advisory-round17.mjs: Advisory Board round 17, in a real browser
 * ============================================================================
 * Admin → People → Applications → Add to Advisory Board, the module in the admin's own styles, every request answered
 * by the real admin handler (functions/api/advisory-applications-admin.js) over an in-memory D1. Made-up people only;
 * Resend (keeping an Idempotency-Key, as the real one does), Cloudflare Access and Images are faked. Checks what staff
 * read in the box and the toast after a press:
 *   M1  a couple with letters after the name ("Jordan & Amy Rowe MD") is asked about Amy Rowe, never "Add them"
 *   m1  a welcome that went but couldn't be marked: "They've been emailed how to sign in."
 *   m3  a People delete under way: "<name> is being deleted on People", in the box and the press; the address case
 *   m4  the welcome's read of People failing: the site couldn't check, never "Add a working email"
 *   m5  someone with the name elsewhere on People named beside whoever holds the web address the name would get
 *   m7  a press that wrote only its own note: "nobody was added", and the next press adds them
 * Screenshots land in test-results/advisory-round17/. Exits non-zero on any failure or page error.
 *   node scripts/test-advisory-round17.mjs        (PORT=4501 by default)
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
const OUT = join(ROOT, 'test-results/advisory-round17/');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 4501);
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

// ── M1 ──
console.log('M1: a couple with letters after the name, the second already on People');
await onPeople('amy-rowe', { name: 'Amy Rowe', group: 'advisory' }, 'amy.rowe@example.org');
for (const typed of ['Jordan & Amy Rowe MD', 'Rowe, Jordan & Amy M.Eng']) {
  const p = await box(await apply(typed, `couple.${typed.length}@example.org`));
  const s = await said(p);
  // (who's on People, as the box compares them: Amy Rowe, then this application)
  const shown = await p.$$eval('.ava-dialog .ava-compare strong', (els) => els.map((e) => e.textContent.trim()));
  const buttons = await p.$$eval('.ava-dialog button', (els) => els.map((e) => e.textContent.trim()));
  ok(s.title === `Is this the same ${typed}?` && shown[0] === 'Amy Rowe' && buttons.includes('The same person') && !buttons.includes('Add them'),
    `"${typed}" is asked about Amy Rowe, never "Add them" (${JSON.stringify({ title: s.title, shown, buttons })})`);
  if (typed.endsWith('MD')) await p.screenshot({ path: join(OUT, 'm1-couple-letters.png') });
  await p.close();
}

// ── m3 ──
console.log('m3: a People delete under way');
await onPeople('eve-edit', { name: 'Eve Edit', group: 'advisory' }, 'eve.work@example.org');
const eve = await apply('Eve Edit', 'eve.home@example.org');
await holdAll('eve-edit');
{
  const p = await box(eve);
  const s = { title: await text(p, '.ava-dialog h2'), status: await text(p, '.ava-dialog [role="status"]') };
  ok(s.title === 'Eve Edit is being deleted on People' && s.status === 'Eve Edit is being deleted on People right now. Look again once that’s done.', `the box, opened during Eve's delete (${JSON.stringify(s)})`);
  await p.screenshot({ path: join(OUT, 'm3-being-deleted-box.png') });
  await p.close();
}
await letGoAll();
await onPeople('gus-gone', { name: 'Gus Gone', group: 'advisory' }, 'gus.work@example.org');
const gus = await apply('Gus Gone', 'gus.home@example.org');
{
  const p = await box(gus);
  ok((await said(p)).title === 'Is this the same Gus Gone?', 'Gus’s box, before his delete');
  await holdAll('gus-gone'); // (his delete starts on People, the box still open)
  const toast = await press(p, /^The same person$/);
  ok(toast === 'Gus Gone is being deleted on People right now, so nobody was added. Look again once that’s done.', `the press, during his delete (${JSON.stringify(toast)})`);
  await sleep(500);
  ok((await text(p, '.ava-dialog h2')) === 'Gus Gone is being deleted on People', 'and the box, asked again, waits saying so');
  await p.close();
}
await letGoAll();
const fay = await apply('Fay Free', 'fay.free@example.org');
await holdAll('fay-free');
{
  const p = await box(fay);
  const s = { title: await text(p, '.ava-dialog h2'), status: await text(p, '.ava-dialog [role="status"]') };
  ok(s.title === 'The web address they’d get is being freed' && s.status === 'The web address this box would give them is being freed by a delete on People right now. Look again once that’s done.', `the address a new person would get, freed by a delete (${JSON.stringify(s)})`);
  await p.close();
}
await letGoAll();

// ── m5 ──
console.log('m5: a namesake elsewhere on People beside whoever holds the web address');
await onPeople('jordan-ames', { name: 'Pat Smith', group: 'team' }, 'pat@example.org');
await onPeople('jordan-ames-2', { name: 'Jordan Ames', group: 'board' }, 'ja.board@example.org');
for (const width of [1280, 390]) {
  const p = await box(await apply('Jordan Ames', `ja.new.${width}@example.org`), width, width === 390 ? 844 : 900);
  const notes = await p.$$eval('.ava-dialog .ava-note', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(notes.includes('Pat Smith on People → Team has the web address this name would get (jordan-ames), so Jordan Ames is added as a new person at jordan-ames-3.')
    && notes.includes('There’s already a Jordan Ames on People → Board. Jordan Ames is added as a new person.'), `${width}px: both named (${JSON.stringify(notes)})`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: the box fits`);
  if (width === 390) await p.screenshot({ path: join(OUT, 'm5-both-named-390.png') });
  await p.close();
}
await onPeople('dana-roe', { name: 'Lee Other', group: 'advisory' }, 'lee@example.org');
await onPeople('dana-roe-2', { name: 'Dana Roe', group: 'board' }, 'dana.board@example.org');
{
  const p = await box(await apply('Dana Roe', 'dana.new@example.org'));
  const s = await said(p);
  ok(s.title === 'Is Dana Roe the same person as Lee Other?' && /There’s already a Dana Roe on People → Board\./.test(s.body), `the box asking about the one at the address names the board's Dana Roe too (${JSON.stringify(s.title)})`);
  await p.close();
}

// ── m1, m4: emails on ──
await writeState(RAW, 'advisory', { emails: true });
console.log('m1: a welcome that went, its mark not saved');
{
  const wes = await apply('Wes Mark', 'wes.mark@example.org');
  const p = await box(wes);
  failOnce((sql) => /^UPDATE board_state SET data = json_set\(json_set\(/.test(sql) && sql.includes('"welcomed"') && !sql.includes('IS NULL OR'));
  const toast = await press(p, /^Add them$/);
  ok(/They’ve been emailed how to sign in\./.test(toast) && !/didn’t go/.test(toast), `the toast says it was sent (${JSON.stringify(toast)})`);
  ok(delivered.filter((m) => [m.to].flat()[0] === 'wes.mark@example.org').length === 1, 'one welcome went');
  await p.close();
}
console.log('m4: the welcome’s read of People failing');
{
  const rae = await apply('Rae Read', 'rae.read@example.org');
  const p = await box(rae);
  failOnce((sql) => sql.trim() === 'SELECT t.slug AS slug, t.data AS data, e.email AS email FROM team AS t LEFT JOIN reveal_board_emails AS e ON e.slug = t.slug', /^UPDATE advisory_applications SET person_slug = \?, status = 'joined'/); /* r21: People and their private emails are read in one statement now (two reads could fall either side of a rename), so that read is the one made to fail */
  const toast = await press(p, /^Add them$/);
  ok(/The site couldn’t check their email just now, so their sign-in email goes by itself in a few minutes\./.test(toast) && !/Add a working email/.test(toast), `the toast says the site couldn't check (${JSON.stringify(toast)})`);
  await p.close();
}
await writeState(RAW, 'advisory', { emails: false });

// ── m7 ──
console.log('m7: a press that wrote only its own note');
{
  const nia = await apply('Nia Note', 'nia.note@example.org');
  const p = await box(nia);
  failOnce((sql) => /^INSERT INTO team /.test(sql.trim()));
  const toast = await press(p, /^Add them$/);
  ok(toast === 'The site’s database didn’t answer just now, so nobody was added. Press Add to Advisory Board again in a moment.', `nobody was added, said so (${JSON.stringify(toast)})`);
  ok(!(await RAW.prepare("SELECT slug FROM team WHERE slug = 'nia-note'").first()), 'and nobody is on People');
  const again = await press(p, /^Add them$/);
  ok(/^Nia Note is on the Advisory Board/.test(again), `pressed again, they're added (${JSON.stringify(again)})`);
  ok((await RAW.prepare("SELECT COUNT(*) AS n FROM team WHERE slug LIKE 'nia-note%'").first()).n === 1, 'once');
  await p.close();
}

ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll round 17 checks passed');
process.exit(failures.length ? 1 : 0);
