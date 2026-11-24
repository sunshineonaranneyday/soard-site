/**
 * test-advisory-round25.mjs: Advisory Board QA round 25 (the page's halves), in a real browser
 * ============================================================================
 * Run it (public/admin/advisory-admin.js) and People → Applications (public/admin/advisory-applications.js), each in the
 * admin's own styles, every request answered by the real handlers (functions/api/advisory-admin.js,
 * advisory-applications-admin.js) over an in-memory D1. Made-up people only; Resend, Cloudflare Access and Images are faked.
 *   3  after any press that fails, the page reads again, quietly, so what's on the screen is what's true: an introduction's
 *      status whose write landed and whose answer was lost (and couldn't be looked for either) shows as pressed; the
 *      ask put out the same way shows as out; a new wish's form keeps its words and its id, so pressing again adds it once
 *   5  after the lost-answer Joined of an application whose email can't be used (a SOARD address), the toast never says
 *      both "it wasn't saved … goes once it's there" and "goes by itself in a few minutes"
 *   6  the panel's line for an application linked but not marked Joined (a press that stopped partway) promises "their
 *      sign-in and welcome" only when Add leaves them with an email that signs them in; for a SOARD address it says they
 *      get them once their own email is on their People page; the line under the button says the same facts
 *   1  the ask's card: put out and emailed with the mail log's write failing after the emails went, the toast says it
 *      went, and no "Email it to the Advisory Board" is offered beside it
 *   the member's own page (/admin/advisory/, the coordinator's follow-up): "I know someone" whose write landed with its
 *      answer lost (and not looked for): the page reads again and shows it, and pressed again it's there once, with
 *      one notice to whoever runs the group
 * At 1280 and 390. Screenshots land in test-results/advisory-round25/. Exits non-zero on any failure or page error.
 *   PORT=5251 node scripts/test-advisory-round25.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as appsApi from '../functions/api/advisory-applications-admin.js';
import * as runApi from '../functions/api/advisory-admin.js';
import * as portalApi from '../functions/api/advisory-portal.js';
import { submitApplication, readHeadshot } from '../functions/api/_advisory-applications.js';
import { writeState } from '../functions/api/_board-roles.js';
import { servesPage } from '../tests/lib/local-only.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/advisory-round25/');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 5251);
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STAFF = 'quinn.founderqa@soardcharity.com';

// ── Resend, Access and Images, faked ──
const access = { groups: [], policies: [] };
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') { const list = [JSON.parse(init.body)].flat(); sent.push(...list); return Response.json({ data: list.map((_, i) => ({ id: `em_${sent.length}_${i}` })) }); }
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
await DB.exec('CREATE TABLE IF NOT EXISTS kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT NOT NULL, updated_at TEXT)');
await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind('quinn-founderqa', 'Quinn Founderqa', 'team', JSON.stringify({ slug: 'quinn-founderqa', name: 'Quinn Founderqa', group: 'team', role: 'founder', status: 'active' })).run();
await writeState(DB, 'settings', { admins: [STAFF] });
const emails = (on) => writeState(DB, 'advisory', { emails: on, lead: '' });
const onPeople = async (slug, name, email = '') => {
  await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(slug, name, 'advisory', JSON.stringify({ slug, name, group: 'advisory', status: 'active', publishStatus: 'published' })).run();
  if (email) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
};
const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
const SHOT = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
const base = { phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
  introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true };
const apply = async (fullName, email) => (await submitApplication(env, { ...base, fullName, email, signature: fullName }, { headshot: SHOT })).app;

// The database the handlers are given: the real one, or one with statements failing once each, before they run
// ('before') or after (they run, then D1's error comes back: the database took it and didn't say so)
let faults = [];
const faultOnce = (...list) => { faults = list.map(([test, how]) => ({ test, how, hit: false })); };
const hits = () => faults.filter((f) => f.hit).length;
const dbNow = () => {
  if (!faults.length) return DB;
  const gate = async (sql, run) => {
    const f = faults.find((x) => !x.hit && x.test(sql));
    if (!f) return run();
    f.hit = true;
    if (f.how === 'before') throw new Error('D1_ERROR: qa fault');
    await run();
    throw new Error('D1_ERROR: qa fault');
  };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: (c) => gate(st._sql, () => st.first(c)), all: () => gate(st._sql, () => st.all()), run: () => gate(st._sql, () => st.run()) });
  return { ...DB, prepare: (sql) => wrap(DB.prepare(sql)), batch: (s) => gate(`[batch] ${s[0]?._sql}`, () => DB.batch(s)) };
};

// ── The admin shell around each module ──
const adminHtml = readFileSync(join(ROOT, 'public/admin/index.html'), 'utf8');
const adminStyles = [...adminHtml.slice(0, adminHtml.indexOf('<script')).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const shell = (script) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Advisory Board harness</title><style>${adminStyles}</style></head>
<body><div class="app"><aside class="sidebar"></aside><div class="main"><div id="root"></div></div></div>
<script type="module">
import { h, render } from './vendor.js';
window.__toasts = [];
const addToast = (msg, kind) => { window.__toasts.push({ msg, kind }); };
${script}
</script></body></html>`;
const appsHtml = shell(`import { AdvisoryApplications } from './advisory-applications.js';
const kit = { team: [], api: { saveContent: async () => ({ success: true }), readContent: async () => ({ success: false }) }, toPersonRecord: (d) => ({ ...d }), onOpenPerson: () => {}, onTeamChanged: () => {} };
render(h(AdvisoryApplications, { addToast, kit }), document.getElementById('root'));`);
const runHtml = shell(`import { AdvisoryArea } from './advisory-admin.js';
render(h(AdvisoryArea, { tab: 'members', addToast }), document.getElementById('root'));`);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  if (path === '/admin/__apps.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(appsHtml); }
  if (path === '/admin/__run.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(runHtml); }
  const file = join(ROOT, 'public', path);
  if (file.startsWith(join(ROOT, 'public')) && existsSync(file) && statSync(file).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); return res.end(servesPage(file, readFileSync(file))); }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
const ROUTES = { '/api/advisory-applications-admin': appsApi, '/api/advisory-admin': runApi, '/api/advisory-portal': portalApi };
// (the member's own page is signed in as them, as the middleware finds a member by their sign-in email)
let MEMBER = null;
async function answer(req) {
  const url = new URL(req.url());
  const api = ROUTES[url.pathname];
  if (api) {
    const request = new Request(`https://site.test${url.pathname}${url.search}`, { method: req.method(), body: req.method() === 'POST' ? req.postData() : undefined, headers: { 'content-type': 'application/json' } });
    const waits = [];
    const ctx = { env: { ...env, DB: dbNow() }, request, data: url.pathname === '/api/advisory-portal' ? { advisor: MEMBER } : { userEmail: STAFF }, waitUntil: (p) => waits.push(p) };
    const q = console.error; console.error = () => {};
    let r;
    try { r = req.method() === 'POST' ? await api.onRequestPost(ctx) : await api.onRequestGet(ctx); } finally { console.error = q; }
    await Promise.all(waits).catch(() => {});
    return req.respond({ status: r.status, contentType: 'application/json', body: Buffer.from(await r.arrayBuffer()) });
  }
  if (url.hostname !== '127.0.0.1') return req.respond(req.resourceType() === 'script' ? { status: 200, contentType: 'text/javascript', body: '' } : { status: 200, contentType: 'image/png', body: PNG });
  if (url.pathname.startsWith('/api/')) return req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  return false;
}

const browser = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const clickText = (page, sel, re) => page.evaluate((s, src) => { const el = [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())); if (el) { el.click(); return true; } return false; }, sel, re.source);
const toasts = (page) => page.evaluate(() => window.__toasts.map((t) => `[${t.kind}] ${t.msg}`));
const panelText = (page) => text(page, '.ava-panel[aria-label="Where it stands"]');
async function open(path, width, ready) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await page.setRequestInterception(true);
  page.on('request', async (req) => { try { if (await answer(req) === false) req.continue(); } catch (e) { console.error(e); req.respond({ status: 500, body: '{}' }); } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(ready, { timeout: 10000 });
  await sleep(300);
  return page;
}
const settle = async (page) => { await page.waitForNetworkIdle({ idleTime: 400, timeout: 15000 }).catch(() => {}); await sleep(300); };
/** The careful "this emails everyone" question, answered yes (./ask.js) */
const agree = async (page) => { await sleep(400); await page.evaluate(() => document.querySelector('.ask [data-ask=yes]')?.click()); };

// (alone, or the first of the batch that owes its update email with it)
const INTRO_UPDATE = (sql) => sql.replace(/^\[batch\] /, '').startsWith('UPDATE advisory_intros SET status = ?');
// (the look for a write whose answer was lost: the same read as the one before the write, so only once that write has failed)
const INTRO_READ = (sql) => faults[0]?.hit && sql === 'SELECT * FROM advisory_intros WHERE id = ?';
const ASK_BATCH = (sql) => sql.startsWith('[batch] UPDATE advisory_asks SET closed_at') || sql.replace(/^\[batch\] /, '').startsWith('UPDATE advisory_asks SET sent_at');
const ASK_READ = (sql) => faults[0]?.hit && sql === 'SELECT * FROM advisory_asks WHERE id = ?';
const LOG_WRITE = (sql) => sql === "UPDATE board_state SET data = json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, ?, json(?)), updated_at = ? WHERE key = ?";
const WISH_INSERT = (sql) => sql.startsWith('INSERT INTO advisory_wishlist');
const JOINED = (sql) => sql.startsWith("UPDATE advisory_applications SET person_slug = ?, status = 'joined'");
const INTRO_INSERT = (sql) => sql.replace(/^\[batch\] /, '').startsWith('INSERT INTO advisory_intros (id, slug, status, data, at, updated_at)');
const INTRO_BY_ID = (sql) => faults[0]?.hit && sql === 'SELECT * FROM advisory_intros WHERE id = ?';

for (const width of [1280, 390]) {
  const W = width === 390 ? 'p' : 'd';
  console.log(`At ${width}`);
  await emails(true);

  // ── 3: Run it reads again after a press that fails: the row shows what's true ──
  {
    const slug = `nell-uiqa${W}`;
    await onPeople(slug, `Nell Uiqa${W}`, `nell.${W}@example.org`);
    const { addIntro } = await import('../functions/api/_advisory.js');
    const intro = await addIntro(DB, { slug, email: `nell.${W}@example.org` }, { name: `Pat Introqa${W}`, company: 'Testco' });
    const page = await open('/admin/__run.html', width, '.ar-card');
    // (found by its words, open or in a closed fold: an introduction answered moves into "All introductions")
    const row = () => page.evaluate((t) => { const r = [...document.querySelectorAll('.ar-row')].find((x) => x.textContent.includes(t)); return r ? [...r.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent.trim()) : null; }, `Pat Introqa${W}`);
    faultOnce([INTRO_UPDATE, 'after'], [INTRO_READ, 'before']);
    await page.evaluate((t) => { const r = [...document.querySelectorAll('.ar-row')].find((x) => x.textContent.includes(t)); [...r.querySelectorAll('.ar-seg button')].find((b) => b.textContent.trim() === 'Talking').click(); }, `Pat Introqa${W}`);
    await settle(page);
    const hit = hits();
    faults = [];
    const db = (await DB.prepare('SELECT status FROM advisory_intros WHERE id = ?').bind(intro.id).first()).status;
    await page.screenshot({ path: join(OUT, `intro-unsure-${width}.png`) });
    ok(hit === 2 && db === 'talking', `${width}: the status landed, its answer lost, and the look for it failed too (${hit} faults hit, ${db})`);
    ok(JSON.stringify(await row()) === JSON.stringify(['Talking']), `${width}: after the failed press the row shows what's true: Talking pressed (${JSON.stringify(await row())})`);
    const t = await toasts(page);
    ok(t.length === 1 && !/nothing was changed|didn’t go through/.test(t[0]), `${width}: its words never say less than happened (${t.join(' / ')})`);
    // (pressed again as the words say: it's set, once, and Nell is emailed once)
    await page.evaluate(() => window.__toasts.splice(0));
    await page.evaluate((x) => { const r = [...document.querySelectorAll('.ar-row')].find((y) => y.textContent.includes(x)); [...r.querySelectorAll('.ar-seg button')].find((b) => b.textContent.trim() === 'Talking').click(); }, `Pat Introqa${W}`);
    await settle(page);
    const n = sent.filter((m) => [m.to].flat().includes(`nell.${W}@example.org`) && /^An update on /.test(m.subject || '')).length;
    ok(n === 1, `${width}: pressed again, Nell has the update once (${n}; ${(await toasts(page)).join(' / ')})`);
    await page.close();
  }

  // ── 6: a row's "Changing this emails …" only where it can: a member with no email on file is said to get none ──
  {
    const { addIntro } = await import('../functions/api/_advisory.js');
    await onPeople(`nan-noemailqa${W}`, `Nan Noemailqa${W}`);
    await addIntro(DB, `nan-noemailqa${W}`, { name: `Lou Introqa${W}`, company: 'Testco' });
    const page = await open('/admin/__run.html', width, '.ar-card');
    const line = (t) => page.evaluate((x) => { const r = [...document.querySelectorAll('.ar-row')].find((y) => y.textContent.includes(x)); return r ? [...r.querySelectorAll('.ar-small')].map((p) => p.textContent.trim()).join(' ') : null; }, t);
    ok((await line(`Lou Introqa${W}`)) === 'Nan has no email of their own on file, so changing this emails nobody.', `${width}: no email on file: never "Changing this emails Nan" (${await line(`Lou Introqa${W}`)})`); /* r26: the words from the one rule every member email takes (no email of their own: none, a group inbox or a staff address) */
    ok((await line(`Pat Introqa${W}`)) === 'Changing this emails Nell.', `${width}: with one: "Changing this emails Nell." (${await line(`Pat Introqa${W}`)})`);
    await page.close();
  }

  // ── 1 and 3: the ask, put out and emailed; the mail log's write failing after the emails went ──
  {
    const people = ['Ona', 'Rex'].map((f) => ({ slug: `${f.toLowerCase()}-askqa${W}`, name: `${f} Askqa${W}`, email: `${f.toLowerCase()}.ask.${W}@example.org` }));
    for (const p of people) await onPeople(p.slug, p.name, p.email);
    const page = await open('/admin/__run.html', width, '.ar-card');
    const TITLE = `Do you know a roofer ${W}${width}?`;
    await page.type('input[placeholder="Do you know a plumber who’d work with us?"]', TITLE);
    faultOnce([LOG_WRITE, 'before']);
    await page.evaluate(() => window.__toasts.splice(0));
    await clickText(page, 'button', /^Put it out and email the Advisory Board$/);
    await agree(page);
    await settle(page);
    faults = [];
    const each = people.map((p) => sent.filter((m) => [m.to].flat().includes(p.email) && (m.subject || '').includes(TITLE)).length);
    const t = await toasts(page);
    await page.screenshot({ path: join(OUT, `ask-log-fails-${width}.png`) });
    ok(JSON.stringify(each) === '[1,1]', `${width}: each member had it once (${each})`);
    ok(t.some((x) => /^\[success\] It’s out, and emailed to \d+ Advisory Board members\.$/.test(x)) && !t.some((x) => /didn’t go through/.test(x)), `${width}: said as emailed (${t.join(' / ')})`);
    const offer = await page.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Email it to the Advisory Board'));
    ok(!offer, `${width}: no "Email it to the Advisory Board" beside an ask that went`);
    // (the ask's own write landing with its answer lost, and not looked for: the page reads again and shows it out)
    const TITLE2 = `Do you know a painter ${W}${width}?`;
    await page.type('input[placeholder="Do you know a plumber who’d work with us?"]', TITLE2);
    faultOnce([ASK_BATCH, 'after'], [ASK_READ, 'before']);
    await page.evaluate(() => window.__toasts.splice(0));
    await clickText(page, 'button', /^Put it out and email the Advisory Board$/);
    await agree(page);
    await settle(page);
    faults = [];
    const card = await page.evaluate(() => [...document.querySelectorAll('.ar-card')].find((c) => c.innerText.includes('This month’s ask'))?.innerText.replace(/\s+/g, ' ') || '');
    ok(card.includes(TITLE2) && /Out since/.test(card), `${width}: answer lost and not looked for: the card shows the ask out, as it is (${card.slice(0, 160)})`);
    ok(!(await page.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Email it to the Advisory Board'))), `${width}: and no "Email it" beside it (its emails are owed)`);
    await page.close();
  }

  // ── 4 and 3: a new wish whose write lands with its answer lost: pressed again, once ──
  {
    const page = await open('/admin/__run.html', width, '.ar-card');
    const WISH = `A licensed electrician ${W}${width}`;
    await page.type('input[placeholder="A licensed electrician in Cherokee County"]', WISH);
    faultOnce([WISH_INSERT, 'after'], [(sql) => faults[0]?.hit && sql === 'SELECT * FROM advisory_wishlist WHERE id = ?', 'before']);
    await clickText(page, 'button', /^Add to the list$/);
    await settle(page);
    faults = [];
    const typed = await page.$eval('input[placeholder="A licensed electrician in Cherokee County"]', (el) => el.value).catch(() => '');
    ok(typed === WISH, `${width}: after the failed press the form still has its words (${typed})`);
    await clickText(page, 'button', /^Add to the list$/);
    await settle(page);
    const n = (await DB.prepare("SELECT count(*) AS n FROM advisory_wishlist WHERE json_extract(data, '$.title') = ?").bind(WISH).first()).n;
    ok(n === 1, `${width}: pressed again, it's there once (${n})`);
    await page.close();
  }

  // ── The member's page: "I know someone", its answer lost: the page reads again and shows it; pressed again, once ──
  {
    MEMBER = { slug: `mia-memberqa${W}`, name: `Mia Memberqa${W}`, email: `mia.${W}@example.org` };
    await onPeople(MEMBER.slug, MEMBER.name, MEMBER.email);
    const page = await open('/admin/advisory/#/introductions', width, '#in-name');
    const WHO = `Lou Lostanswer${W}${width}`;
    await page.type('#in-name', WHO);
    await page.type('#in-co', 'Testco');
    faultOnce([INTRO_INSERT, 'after'], [INTRO_BY_ID, 'before']);
    await clickText(page, 'button', /^Send the introduction$/);
    await settle(page);
    const hit = hits();
    faults = [];
    const mine = () => page.evaluate(() => document.querySelector('.ad-intros')?.textContent || '');
    const n = async () => (await DB.prepare("SELECT count(*) AS n FROM advisory_intros WHERE instr(data, ?) > 0").bind(WHO).first()).n;
    await page.screenshot({ path: join(OUT, `member-intro-lost-${width}.png`) });
    ok(hit === 2 && (await n()) === 1, `${width}: its write landed, its answer lost and not looked for (${hit} faults, ${await n()} made)`);
    ok((await mine()).includes(WHO), `${width}: after the failed press the page shows it under Your introductions (${(await mine()).slice(0, 120)})`);
    const typed = await page.$eval('#in-name', (el) => el.value).catch(() => '');
    ok(typed === WHO, `${width}: the form still has their words (${typed})`);
    await clickText(page, 'button', /^Send the introduction$/);
    await settle(page);
    ok((await n()) === 1, `${width}: pressed again, it's there once (${await n()})`);
    const notices = sent.filter((m) => / made an introduction$/.test(m.subject || '') && (m.text || '').includes(WHO)).length;
    ok(notices === 1, `${width}: whoever runs the group told once (${notices})`);
    await page.close();
    MEMBER = null;
  }

  // ── 6: the panel's partway line, a SOARD address and a working one ──
  for (const [label, email, promise] of [['a SOARD address', `wren.partqa.${W}${width}@soardcharity.com`, false], ['a working email', `ivy.partqa.${W}${width}@example.org`, true]]) {
    const name = promise ? `Ivy Partqa${W}` : `Wren Partqa${W}`;
    const a = await apply(name, email);
    const page = await open(`/admin/__apps.html#advisory-applications/${a.id}`, width, '.ava-drawer .ava-qa');
    await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
    await page.waitForSelector('.ava-dialog', { timeout: 5000 }).catch(() => null);
    await sleep(300);
    faultOnce([JOINED, 'before']);
    await clickText(page, '.ava-dialog button', /^Add them$/);
    await settle(page);
    faults = [];
    if (await text(page, '.ava-dialog')) { await page.keyboard.press('Escape'); await sleep(400); }
    const p = await panelText(page);
    await page.screenshot({ path: join(OUT, `partway-panel-${promise ? 'working' : 'soard'}-${width}.png`) });
    if (promise) ok(p.includes('Add to Advisory Board below finishes adding them (their sign-in and welcome) and marks it Joined'), `${width}, ${label}: the panel promises their sign-in and welcome (${p})`);
    else {
      ok(!/their sign-in and welcome\)/.test(p), `${width}, ${label}: never "(their sign-in and welcome)" (${p})`);
      ok(p.includes('This application’s email is a SOARD address, which signs in as staff, so they get their sign-in and welcome once their own email is on their People page'), `${width}, ${label}: says when they get them (${p})`);
    }
    await page.close();
  }

  // ── 5: the lost-answer Joined for a SOARD address: never "wasn't saved" beside "goes by itself in a few minutes" ──
  for (const sw of [true, false]) {
    await emails(sw);
    const name = `Wren Lostqa${W}${sw ? 'n' : 'f'}`;
    const a = await apply(name, `wren.lostqa.${W}${width}${sw ? 'n' : 'f'}@soardcharity.com`);
    const page = await open(`/admin/__apps.html#advisory-applications/${a.id}`, width, '.ava-drawer .ava-qa');
    await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
    await page.waitForSelector('.ava-dialog', { timeout: 5000 }).catch(() => null);
    await sleep(300);
    await page.evaluate(() => window.__toasts.splice(0));
    faultOnce([JOINED, 'after']);
    await clickText(page, '.ava-dialog button', /^Add them$/);
    await settle(page);
    faults = [];
    const t = (await toasts(page)).join(' / ');
    await page.screenshot({ path: join(OUT, `joined-lost-soard-${sw ? 'on' : 'off'}-${width}.png`) });
    ok(/so it wasn’t saved\. Add their own on their People page: their sign-in email goes once it’s there/.test(t), `${width}, emails ${sw ? 'on' : 'off'}: said it wasn't saved, and when it goes (${t})`);
    ok(!/goes by itself in a few minutes|goes once those are turned on/.test(t), `${width}, emails ${sw ? 'on' : 'off'}: never also "goes by itself" (${t})`);
    ok(sw || /once it’s there and Advisory Board emails are turned on/.test(t), `${width}, emails ${sw ? 'on' : 'off'}: with the emails off, it says it waits for them too`);
    await page.close();
  }
  await emails(true);
}

await browser.close();
server.close();
if (errors.length) { console.log('Page errors:'); for (const e of errors) console.log('  ', e); }
console.log(failures.length || errors.length ? `\n${failures.length} failed, ${errors.length} page errors` : '\nAll passed');
process.exit(failures.length || errors.length ? 1 : 0);
