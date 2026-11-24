/**
 * test-advisory-round24.mjs: Advisory Board QA round 24 (findings 2 and 3, the page's half), in a real browser
 * ============================================================================
 * Admin → People → Applications, the module in the admin's own styles, every request answered by the real admin
 * handler (functions/api/advisory-applications-admin.js) over an in-memory D1. Made-up people only; Resend, Cloudflare
 * Access and Images are faked.
 *   2  the partway words name a press (Add to Advisory Board again), so they're only given beside a box and a panel that
 *      offer it: a press stopped where the box asks again (the email's check not answering) says them, and the box
 *      offers Link them and the panel Add to Advisory Board; a press whose Joined the database took without saying so
 *      leaves nothing to press, so it's said as done, as a press that went all the way says it (the sign-in email
 *      going by itself in a few minutes), the box closed, never the partway words
 *   3  every line of the Add box from the same facts: a test application's warning promises reveal invites only with an
 *      email they'll sign in with, and advisory@ only with that and Advisory Board emails on; with a SOARD address or
 *      a group inbox, "neither … until a working email is on their People page"; the same for the same person's box
 *      and the choice; and the panel's line for an application with no email never says they can't sign in before the
 *      box has asked People; and Board → Advisory → Members' "Send the sign-in email to …" counts and names only those
 *      whose email on file signs them in (never a SOARD address, which the send skips)
 * At 1280 and 390 (Members at 1280). Screenshots land in test-results/advisory-round24/. Exits non-zero on any failure or page error.
 *   node scripts/test-advisory-round24.mjs        (PORT=5151 by default)
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as adminApi from '../functions/api/advisory-applications-admin.js';
import { submitApplication, readHeadshot } from '../functions/api/_advisory-applications.js';
import { writeState, readState } from '../functions/api/_board-roles.js';
// (round 24: every page served without Cloudflare's analytics beacon, so nothing leaves this machine)
import { servesPage } from '../tests/lib/local-only.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/advisory-round24/');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 5151);
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const emails = (on) => writeState(DB, 'advisory', { emails: on });
const onPeople = async (slug, name, email = '') => {
  await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(slug, name, 'advisory', JSON.stringify({ slug, name, group: 'advisory', status: 'active', publishStatus: 'published' })).run();
  if (email) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
};
const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
const SHOT = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
const base = { phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
  introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true };
const apply = async (fullName, email) => (await submitApplication(env, { ...base, fullName, email, signature: fullName }, { headshot: SHOT })).app;

// The database the handler is given for the next requests: the real one, or one with a statement failing once, before it
// runs ('before') or after (it runs, then D1's error comes back: the database took it and didn't say so)
let fault = null;
const faultOnce = (test, how) => { fault = { test, how, hit: false }; };
const dbNow = () => {
  if (!fault) return DB;
  const gate = async (sql, run) => {
    if (fault && !fault.hit && fault.test(sql)) {
      fault.hit = true;
      if (fault.how === 'before') throw new Error('D1_ERROR: qa fault');
      await run();
      throw new Error('D1_ERROR: qa fault');
    }
    return run();
  };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: (c) => gate(st._sql, () => st.first(c)), all: () => gate(st._sql, () => st.all()), run: () => gate(st._sql, () => st.run()) });
  return { ...DB, prepare: (sql) => wrap(DB.prepare(sql)), batch: (s) => DB.batch(s) };
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
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
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
    const ctx = { env: { ...env, DB: dbNow() }, request, data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: (p) => waits.push(p) };
    const q = console.error; console.error = () => {};
    let r;
    try { r = req.method() === 'POST' ? await adminApi.onRequestPost(ctx) : await adminApi.onRequestGet(ctx); } finally { console.error = q; }
    await Promise.all(waits).catch(() => {});
    return req.respond({ status: r.status, contentType: 'application/json', body: Buffer.from(await r.arrayBuffer()) });
  }
  if (url.hostname !== '127.0.0.1') return req.respond(req.resourceType() === 'script' ? { status: 200, contentType: 'text/javascript', body: '' } : { status: 200, contentType: 'image/png', body: PNG });
  return false;
}

const browser = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const clickText = (page, sel, re) => page.evaluate((s, src) => { const el = [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent.trim())); if (el) { el.click(); return true; } return false; }, sel, re.source);
const toasts = (page) => page.evaluate(() => window.__toasts.map((t) => `[${t.kind}] ${t.msg}`));
const boxButtons = (page) => page.evaluate(() => [...document.querySelectorAll('.ava-dialog button')].map((b) => b.textContent.trim()).filter(Boolean));
const panelAdd = (page) => page.evaluate(() => [...document.querySelectorAll('.ava-drawer button')].some((b) => /^Add to Advisory Board$/.test(b.textContent.trim())));
const panelText = (page) => text(page, '.ava-panel[aria-label="Where it stands"]');
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
/** The Add box opened → its words */
async function addBox(page) {
  await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
  await page.waitForSelector('.ava-dialog', { timeout: 5000 }).catch(() => null);
  await sleep(300);
  return text(page, '.ava-dialog');
}
/** The box's main press, then the box, the toasts and the panel as they are after it */
async function pressBox(page, re) {
  await page.evaluate(() => { window.__toasts.length = 0; });
  ok(await clickText(page, '.ava-dialog button', re), `the box has ${re.source}`);
  await page.waitForFunction(() => !document.querySelector('.ava-dialog [aria-disabled="true"]'), { timeout: 15000 }).catch(() => {});
  await sleep(900);
  return { toasts: await toasts(page), box: await text(page, '.ava-dialog'), buttons: await boxButtons(page), panel: await panelText(page), add: await panelAdd(page) };
}
const statusOf = async (id) => (await DB.prepare('SELECT status, person_slug FROM advisory_applications WHERE id = ?').bind(id).first());

const PARTWAY = /Adding them stopped partway/;
const JOINED = (sql) => sql.startsWith("UPDATE advisory_applications SET person_slug = ?, status = 'joined'");
const CHECK = (sql) => sql === 'SELECT r.slug, t.data FROM reveal_board_emails r JOIN team t ON t.slug = r.slug WHERE lower(r.email) = ? AND r.slug != ? LIMIT 1';

for (const width of [1280, 390]) {
  const W = width === 390 ? 'p' : 'd';
  console.log(`At ${width}`);
  await emails(true);

  // ── 2: stopped where the box asks again: the partway words, beside the press they name ──
  {
    const a = await apply(`Edna Checkfault${W}`, `edna.cf.${width}@example.org`);
    const page = await panel(a, width);
    ok(/Add them/.test((await boxButtons(page).then(async (b) => (b.length ? b : (await addBox(page), boxButtons(page))))).join(' ')), `${width}: the box offers Add them`);
    faultOnce(CHECK, 'before');
    const r = await pressBox(page, /^Add them$/);
    fault = null;
    await page.screenshot({ path: join(OUT, `partway-check-${width}.png`) });
    ok(r.toasts.length === 1 && /^\[error\] Adding them stopped partway: we couldn’t check People just now\. Press Add to Advisory Board again in a moment/.test(r.toasts[0]), `${width}: the email's check not answering: the partway words (${r.toasts.join(' / ')})`);
    ok(r.buttons.includes('Link them'), `${width}: the box offers the press the words name: Link them (${r.buttons.join(', ')})`);
    // (the panel under the box: its Add to Advisory Board)
    await page.keyboard.press('Escape');
    await sleep(400);
    ok(await panelAdd(page), `${width}: the panel offers Add to Advisory Board (${await panelText(page)})`);
    await addBox(page);
    const r2 = await pressBox(page, /^Link them$/);
    ok(r2.toasts.length === 1 && /^\[success\]/.test(r2.toasts[0]) && !PARTWAY.test(r2.toasts[0]), `${width}: the press the words named finishes it (${r2.toasts.join(' / ')})`);
    ok((await statusOf(a.id)).status === 'joined', `${width}: Joined`);
    await page.close();
  }

  // ── 2: the database took Joined without saying so: nothing left to press, so never the partway words ──
  for (const sw of [true, false]) {
    await emails(sw);
    const a = await apply(`Jody Unsurejoin${W}${sw ? 'n' : 'f'}`, `jody.uj.${width}.${sw ? 'on' : 'off'}@example.org`);
    const page = await panel(a, width);
    await addBox(page);
    faultOnce(JOINED, 'after');
    const r = await pressBox(page, /^Add them$/);
    const hit = fault?.hit;
    fault = null;
    await page.screenshot({ path: join(OUT, `joined-unsaid-emails-${sw ? 'on' : 'off'}-${width}.png`) });
    ok(hit, `${width}, emails ${sw ? 'on' : 'off'}: Joined was written, and the press didn't hear back`);
    ok((await statusOf(a.id)).status === 'joined', `${width}, emails ${sw ? 'on' : 'off'}: it's Joined`);
    ok(!r.toasts.some((t) => PARTWAY.test(t)), `${width}, emails ${sw ? 'on' : 'off'}: never "stopped partway" with nothing left to press (${r.toasts.join(' / ')})`);
    const done = `[success] Jody Unsurejoin${W}${sw ? 'n' : 'f'} is on the Advisory Board, and this application is linked to them on People → Advisory. ${sw ? 'Their sign-in email goes by itself in a few minutes.' : 'Advisory Board emails are off, so their sign-in email goes once those are turned on.'}`;
    ok(r.toasts.length === 1 && r.toasts[0] === done, `${width}, emails ${sw ? 'on' : 'off'}: said as done, as a press that went all the way (${r.toasts.join(' / ')})`);
    ok(!r.box, `${width}, emails ${sw ? 'on' : 'off'}: the box closed (${r.box.slice(0, 80)})`);
    ok(/On People → Advisory as Jody Unsurejoin/.test(r.panel) && !r.add, `${width}, emails ${sw ? 'on' : 'off'}: the panel shows them on the Advisory Board, nothing to press (${r.panel})`);
    ok((await readState(DB, 'advisory-mail')).waiting?.[`jody-unsurejoin${W}${sw ? 'n' : 'f'}`.toLowerCase()], `${width}, emails ${sw ? 'on' : 'off'}: their sign-in email is waiting for the heartbeat, as said`);
    await page.close();
  }

  // ── 3: a test application's warning, from the box's own facts ──
  for (const sw of [true, false]) {
    await emails(sw);
    const off = sw ? '' : ' (and advisory@ only once Advisory Board emails are on)';
    const NEITHER = `who gets neither reveal invites nor the emails to advisory@soardcharity.com until a working email is on their People page${off}.`;
    const tag = `${width}${sw ? 'n' : 'f'}`;
    const cases = [
      // [label, name, email, People first, the warning's words]
      ['a SOARD address', `Test Tina${tag}`, `tina.${tag}@soardcharity.com`, null, NEITHER],
      ['a group inbox', `Test Gus${tag}`, 'advisory@soardcharity.com', null, NEITHER],
      ['a working email (control)', `Test Tess${tag}`, `tess.${tag}@example.org`, null, `who gets reveal invites and the emails to advisory@soardcharity.com${sw ? '' : ' once Advisory Board emails are on'}.`],
      // (the same person, their SOARD address on file: none to sign in with, said)
      ['the same person, a SOARD address on file', `Test Sal${tag}`, `sal.${tag}@soardcharity.com`, [`test-sal${tag}`, `Test Sal${tag}`, `sal.${tag}@soardcharity.com`], NEITHER],
      // (the choice: the one on People has a working email, someone new would have none)
      ['the choice, one way with a sign-in and one without', `Test Cora${tag}`, `cora.${tag}@soardcharity.com`, [`test-cora${tag}`, `Test Cora${tag}`, `cora.${tag}@example.org`],
        `who gets reveal invites and the emails to advisory@soardcharity.com only with a working email on their People page${off}.`],
    ];
    for (const [label, name, email, person, words] of cases) {
      if (person) await onPeople(...person);
      const a = await apply(name, email);
      const page = await panel(a, width);
      const said = await addBox(page);
      await page.screenshot({ path: join(OUT, `test-box-${label.replace(/[^a-z]+/gi, '-')}-emails-${sw ? 'on' : 'off'}-${width}.png`) });
      const warning = `Adding it makes a real Advisory Board member ${words}`;
      ok(said.includes(warning), `${width}, emails ${sw ? 'on' : 'off'}, ${label}: "${words}" (${said.slice(0, 320)})`);
      if (words === NEITHER) {
        ok(!/who gets reveal invites and the emails/.test(said), `${width}, emails ${sw ? 'on' : 'off'}, ${label}: never promised reveal invites or advisory@`);
        ok(/needs a working email on their People page|isn’t saved|can’t sign them in|signs in as staff/.test(said), `${width}, emails ${sw ? 'on' : 'off'}, ${label}: the box's other lines say the same`);
      }
      await page.close();
    }
  }
  await emails(true);

  // ── 3: the panel's line for an application with no email ──
  {
    const a = await apply(`Nell Noemail${W}`, `nell.${width}@example.org`);
    await DB.prepare("UPDATE advisory_applications SET email = '' WHERE id = ?").bind(a.id).run();
    const page = await panel(a, width);
    const said = await panelText(page);
    ok(said.includes('This application has no email. The next box says whether they can sign in, before anything changes.'), `${width}: no email, not linked: never "they can't sign in" before the box asks People (${said})`);
    await page.close();
  }
}

// ── 3: Board → Advisory → Members: "Send the sign-in email to …" counts and names only those it can go to ──
{
  console.log('Board → Advisory → Members');
  const { onRequestGet: adminGet, onRequestPost: adminPost } = await import('../functions/api/advisory-admin.js');
  const { onRequestGet: portalGet } = await import('../functions/api/advisory-portal.js');
  // (Run it lists the kids the group could pick: the site's table of them, empty here)
  await DB.exec('CREATE TABLE IF NOT EXISTS kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind('jane-founder', 'Jane Founder', 'team', JSON.stringify({ slug: 'jane-founder', name: 'Jane Founder', group: 'team', role: 'founder', status: 'active' })).run();
  await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('jane-founder', 'jane.founder@soardcharity.com').run();
  await writeState(DB, 'settings', { admins: ['jane.founder@soardcharity.com'] });
  // (everyone on People → Advisory so far has been sent theirs or has none: two more who haven't, one a SOARD address)
  const { welcomedSlugs } = await import('../functions/api/_advisory-mail.js');
  const had = new Set(Object.keys(await welcomedSlugs(DB)));
  await onPeople('ada-unsent', 'Ada Unsent', 'ada.unsent@example.org');
  await onPeople('sal-soard', 'Sal Soardmail', 'sal.soard@soardcharity.com');
  await emails(true);
  const routes = { '/api/advisory-admin': [adminGet, adminPost], '/api/advisory-portal': [portalGet, null] };
  const posts = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const url = new URL(req.url());
      const r = routes[url.pathname];
      if (r) {
        if (req.method() === 'POST') posts.push(JSON.parse(req.postData() || '{}'));
        const request = new Request(`https://site.test${url.pathname}${url.search}`, { method: req.method(), body: req.method() === 'POST' ? req.postData() : undefined, headers: { 'content-type': 'application/json' } });
        const q = console.error; console.error = () => {};
        let res;
        try { res = await (req.method() === 'POST' ? r[1] : r[0])({ env, request, data: { userEmail: 'jane.founder@soardcharity.com' }, waitUntil: () => {} }); } finally { console.error = q; }
        return req.respond({ status: res.status, contentType: 'application/json', body: Buffer.from(await res.arrayBuffer()) });
      }
      if (url.hostname !== '127.0.0.1') return req.respond(req.resourceType() === 'script' ? { status: 200, contentType: 'text/javascript', body: '' } : { status: 200, contentType: 'image/png', body: PNG });
      if (url.pathname.startsWith('/api/')) return req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      req.continue();
    } catch (e) { console.error(e); req.respond({ status: 500, body: '{}' }); }
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${SITE}/admin/advisory/#/run`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ar-card', { timeout: 8000 }).catch(() => {});
  await sleep(500);
  // (who it can go to: on People → Advisory, not had it, with an email on file that signs them in)
  const { signInWhy } = await import('../functions/api/_board-roles.js');
  const onFile = (await DB.prepare("SELECT t.slug AS slug, e.email AS email FROM team t JOIN reveal_board_emails e ON e.slug = t.slug WHERE t.\"group\" = 'advisory'").all()).results;
  const want = onFile.filter((r) => !had.has(r.slug) && !signInWhy(r.email)).length;
  ok(onFile.some((r) => !had.has(r.slug) && signInWhy(r.email)), 'someone not sent it has a SOARD address on file');
  const label = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => /^Send the sign-in email to \d+$/.test(t)) || '');
  await page.screenshot({ path: join(OUT, 'members-send-to-1280.png') });
  ok(label === `Send the sign-in email to ${want}`, `the button counts only those it can go to: ${want}, never the SOARD address (${label || 'no button'})`);
  await clickText(page, 'button', /^Send the sign-in email to \d+$/);
  await sleep(400);
  const note = await page.evaluate(() => document.body.innerText.match(/To [^\n]*: how to open the page\./)?.[0] || '');
  ok(/Ada/.test(note) && !/Sal/.test(note), `the note names who it goes to, never the SOARD address (${note})`);
  await clickText(page, 'button', /^Yes, send it$/);
  await sleep(900);
  const sentTo = posts.find((x) => x.action === 'send-welcome')?.slugs || [];
  ok(sentTo.includes('ada-unsent') && !sentTo.includes('sal-soard'), `the press asks for those it can go to (${sentTo.join(', ')})`);
  await page.close();
}

ok(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await browser.close();
server.close();
globalThis.fetch = realFetch;
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
