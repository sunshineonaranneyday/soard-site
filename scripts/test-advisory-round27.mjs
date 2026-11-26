/**
 * test-advisory-round27.mjs: Advisory Board QA round 27 (the page's halves), in a real browser
 * ============================================================================
 * Run it (public/admin/advisory-admin.js) and People → Applications (public/admin/advisory-applications.js), each in the
 * admin's own styles, every request answered by the real handlers over an in-memory D1. Made-up people only; Resend,
 * Cloudflare Access and Images are faked, nothing leaves this machine.
 *   2  the panel for an Add that stopped partway with Advisory Board emails off: their sign-in comes with the add, and
 *      only their welcome email waits for the switch
 *   7  the ask card when no member can be emailed: "Put it on the page", no box about emailing, no "Email it" once out
 *   9  Run it's in-place "are you sure" (Reaching the group's "Send the sign-in email to 2"): opening it moves the focus
 *      to "Keep it as it is", Tab stays within its buttons in order, Escape closes it, and closing it puts the focus back
 *      on the button that opened it (or, when that's gone after Yes, on its card), never on the page
 *   4, 5  an email that may not have gone (its answer lost, the email service's key past its day) is said where it
 *      belongs, the ask's card and the member's row, with Send it again, which sends it with a new key
 *  10  a row's sign-in email whose email changed on People mid-press says so, never "the email service didn't take it"
 * At 1280 and 390. Screenshots land in test-results/advisory-round27/. Exits non-zero on any failure or page error.
 *   PORT=5444 node scripts/test-advisory-round27.mjs
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
const OUT = join(ROOT, 'test-results/advisory-round27/');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 5444);
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
  if (url.host === 'api.resend.com') { const list = [JSON.parse(init.body)].flat(); sent.push(...list.map((m) => ({ ...m, key: init.headers?.['Idempotency-Key'] || '' }))); return Response.json({ data: list.map((_, i) => ({ id: `em_${sent.length}_${i}` })) }); }
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
    if (f.how === 'change') { await DB.prepare('UPDATE reveal_board_emails SET email = ? WHERE slug LIKE ?').bind('pia.changed@example.org', 'pia-raceqa%').run(); return run(); }
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

// (Add's Joined write)
const JOINED = (sql) => sql.startsWith("UPDATE advisory_applications SET person_slug = ?, status = 'joined'");

const focusNow = (page) => page.evaluate(() => { const e = document.activeElement; return !e || e === document.body ? 'BODY' : `${e.tagName}:${(e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}${e.classList.contains('ar-card') ? ' (card)' : ''}`; });
const focusButton = (page, label) => page.evaluate((l) => { const x = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === l); if (!x) return false; x.scrollIntoView({ block: 'center' }); x.focus(); return document.activeElement === x; }, label);
const reset = async () => {
  for (const t of ['advisory_outbox', 'advisory_asks', 'advisory_answers', 'advisory_intros', 'advisory_links']) await DB.prepare(`DELETE FROM ${t}`).run().catch(() => {});
  await DB.prepare("DELETE FROM team WHERE \"group\" = 'advisory'").run();
  await DB.prepare('DELETE FROM reveal_board_emails').run();
  await writeState(DB, 'advisory-mail', {});
  sent.length = 0;
};
const { ensureAdvisory } = await import('../functions/api/_advisory.js');
await ensureAdvisory(DB);
const { syncBoardAccess } = await import('../functions/api/_board-access.js');

for (const width of [1280, 390]) {
  const W = width === 390 ? 'p' : 'd';
  console.log(`At ${width}`);

  // ── 7: nobody the ask can be emailed to ──
  await reset();
  await emails(true);
  await onPeople(`hal-kindqa${W}`, `Hal Kindqa${W}`, 'advisory@soardcharity.com');
  await onPeople(`ivy-kindqa${W}`, `Ivy Kindqa${W}`, `ivy.kindqa${W}@soardcharity.com`);
  await onPeople(`mo-kindqa${W}`, `Mo Kindqa${W}`);
  {
    const page = await open('/admin/__run.html', width, '.ar-card');
    const go = await page.evaluate(() => [...document.querySelectorAll('.ar-btn--go')].map((b) => b.textContent.trim()));
    ok(go.includes('Put it on the page') && !go.includes('Put it out and email the Advisory Board'), `${width}, 7: with nobody to email, the button says "Put it on the page" (${go.join(' | ')})`);
    await page.type('input[placeholder^="Do you know a plumber"]', `Do you know a roofer ${W}?`);
    await clickText(page, '.ar-btn--go', /^Put it on the page$/);
    await sleep(500);
    ok(!(await page.$('.ask')), `${width}, 7: no box asks about emailing anyone`);
    await settle(page);
    const t = (await toasts(page)).join(' / ');
    ok(/It’s on the page, but no Advisory Board member has an email the site can send it to/.test(t), `${width}, 7: the toast says what happened (${t})`);
    const after = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()));
    ok(!after.includes('Email it to the Advisory Board'), `${width}, 7: no "Email it" for an ask that nobody can be emailed`);
    await page.screenshot({ path: join(OUT, `7-nobody-${width}.png`) });
    await page.close();
  }

  // ── 9: the in-place "are you sure", by keyboard ──
  await reset();
  await emails(true);
  await onPeople(`tom-sureqa${W}`, `Tom Sureqa${W}`, `tom.sure${W}@example.org`);
  await onPeople(`uma-sureqa${W}`, `Uma Sureqa${W}`, `uma.sure${W}@example.org`);
  await syncBoardAccess(env);
  {
    const page = await open('/admin/__run.html', width, '.ar-card');
    const label = await page.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).find((t) => /^Send the sign-in email to \d+$/.test(t)));
    ok(label === 'Send the sign-in email to 2', `${width}, 9: the group button (${label})`);
    await focusButton(page, label);
    await page.keyboard.press('Enter');
    await sleep(200);
    ok((await focusNow(page)) === 'BUTTON:Keep it as it is', `${width}, 9: opening it moves the focus to its safe choice (${await focusNow(page)})`);
    const described = await page.evaluate(() => { const g = document.querySelector('.ar-sure'); const id = g?.getAttribute('aria-describedby'); return id ? document.getElementById(id)?.textContent : null; });
    ok(/^To Tom, Uma: how to open the page\.$/.test(described || ''), `${width}, 9: its question is read with it (${described})`);
    await page.keyboard.press('Tab'); await sleep(80);
    const t1 = await focusNow(page);
    await page.keyboard.press('Tab'); await sleep(80);
    const t2 = await focusNow(page);
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await sleep(80);
    const t3 = await focusNow(page);
    ok(t1 === 'BUTTON:Yes, send it' && t2 === 'BUTTON:Keep it as it is' && t3 === 'BUTTON:Yes, send it', `${width}, 9: Tab stays within its buttons, in order (${t1} → ${t2} → ${t3})`);
    await page.keyboard.press('Escape'); await sleep(200);
    ok(!(await page.$('.ar-sure')) && (await focusNow(page)) === `BUTTON:${label}`, `${width}, 9: Escape closes it, the focus back on its button (${await focusNow(page)})`);
    await page.keyboard.press('Enter'); await sleep(200);
    await page.keyboard.press('Enter'); await sleep(200);
    ok(!(await page.$('.ar-sure')) && (await focusNow(page)) === `BUTTON:${label}`, `${width}, 9: Keep it as it is, by Enter: closed, the focus back on its button (${await focusNow(page)})`);
    await page.keyboard.press('Enter'); await sleep(200);
    await page.keyboard.press('Tab'); await sleep(80);
    ok((await focusNow(page)) === 'BUTTON:Yes, send it', `${width}, 9: Yes, send it reached by Tab`);
    await page.keyboard.press('Enter');
    await settle(page);
    await sleep(300);
    const f = await focusNow(page);
    const t = (await toasts(page)).join(' / ');
    ok(/Sent to 2 Advisory Board members\./.test(t), `${width}, 9: sent (${t})`);
    ok(f !== 'BODY' && /\(card\)$|Send the sign-in email/.test(f), `${width}, 9: the button gone with nothing left to send, the focus stays in its card, never the page (${f})`);
    await page.screenshot({ path: join(OUT, `9-sure-done-${width}.png`) });
    await page.close();
  }

  // ── 4, 5: an email that may not have gone, on its card and its row, with Send it again ──
  await reset();
  await emails(true);
  await onPeople(`ona-unsureqa${W}`, `Ona Unsureqa${W}`, `ona.unsure${W}@example.org`);
  await syncBoardAccess(env);
  {
    const askId = `ask_unsure${W}qaaa`;
    const day = 2 * 86_400_000;
    const old = new Date(Date.now() - day).toISOString();
    await DB.prepare("INSERT INTO advisory_asks (id, data, sent_at, closed_at, at, by) VALUES (?, ?, ?, NULL, ?, 'x')").bind(askId, JSON.stringify({ title: `Do you know a roofer ${W}?`, body: '', link: '', mailed: { at: old, key: 'm1' } }), old, old).run();
    const to = `ona.unsure${W}@example.org`;
    await DB.prepare("INSERT INTO advisory_outbox (key, kind, ref, email, msg, idem, owed_at, tried_at, lost_at, outcome) VALUES (?, 'ask', ?, ?, ?, ?, ?, ?, ?, 'unsure')")
      .bind(`ask:${askId}:${to}`, askId, to, JSON.stringify({ slug: `ona-unsureqa${W}`, name: `Ona Unsureqa${W}` }), `advisory-ask:${askId}:${to}`, old, old, old).run();
    // (her welcome: tried two days ago, its answer lost)
    await writeState(DB, 'advisory-mail', { waiting: { [`ona-unsureqa${W}`]: { at: old, by: 'x', key: `advisory-welcome:${to}`, tried: old, lost: old } } });
    const page = await open('/admin/__run.html', width, '.ar-card');
    const notes = await page.evaluate(() => [...document.querySelectorAll('.ar-unsure .ar-note, .ar-signin .ar-note')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(notes.some((x) => x.startsWith(`This month’s ask to Ona may not have gone. Send it again?`)), `${width}, 5: the ask's card says its email may not have gone (${notes.join(' | ')})`);
    ok(notes.some((x) => x === `The welcome to Ona may not have gone. Send it again?`), `${width}, 4: her row says her welcome may not have gone`);
    await page.screenshot({ path: join(OUT, `45-unsure-${width}.png`) });
    await clickText(page, '.ar-unsure button', /^Send it again$/);
    await settle(page);
    let t = (await toasts(page)).join(' / ');
    ok(/Sent to Ona\./.test(t), `${width}, 5: Send it again sends the ask (${t})`);
    ok(sent.filter((m) => /^This month’s ask: /.test(m.subject)).map((m) => m.key).every((k) => /:re\d+:0$/.test(k)), `${width}, 5: with a new key`);
    ok(!(await page.$('.ar-unsure')), `${width}, 5: and the line is gone`);
    await page.evaluate(() => window.__toasts.splice(0));
    await page.evaluate((s) => document.querySelector(`.ar-signin[data-slug="${s}"] button`)?.click(), `ona-unsureqa${W}`);
    await settle(page);
    t = (await toasts(page)).join(' / ');
    ok(/Sign-in email sent to Ona Unsureqa/.test(t), `${width}, 4: Send it again on her row sends her welcome (${t})`);
    ok(sent.filter((m) => m.subject === 'Your Advisory Board page is ready').map((m) => m.key).every((k) => /:re\d+:0$/.test(k)), `${width}, 4: with a new key`);
    await page.close();
  }

  // ── 10: their email changed on People mid-press ──
  await reset();
  await emails(true);
  await onPeople(`pia-raceqa${W}`, `Pia Raceqa${W}`, `pia.race${W}@example.org`);
  await syncBoardAccess(env);
  {
    const page = await open('/admin/__run.html', width, '.ar-card');
    faultOnce([(sql) => /^UPDATE board_state SET data = json_set\(json_set\(/.test(sql) && /IS NULL OR \(json_type\(data, \?\) = 'object'/.test(sql), 'change']);
    await page.evaluate((s) => document.querySelector(`.ar-signin[data-slug="${s}"] button`)?.click(), `pia-raceqa${W}`);
    await settle(page);
    faults = [];
    const t = (await toasts(page)).join(' / ');
    ok(/Pia Raceqa.’s email changed on People just now, so nothing was sent\. Check it and press again\./.test(t), `${width}, 10: said what happened (${t})`);
    ok(!/email service/.test(t), `${width}, 10: never the email service, which was never asked`);
    await page.close();
  }

  // ── 2: the panel for an Add that stopped partway, emails off ──
  await reset();
  await emails(false);
  {
    const email = `lena.partoff${W}${width}@example.org`;
    const a = await apply(`Lena Partoff${W}`, email);
    const page = await open(`/admin/__apps.html#advisory-applications/${a.id}`, width, '.ava-drawer .ava-qa');
    await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
    await page.waitForSelector('.ava-dialog', { timeout: 5000 }).catch(() => null);
    await sleep(300);
    const box = await text(page, '.ava-dialog');
    faultOnce([JOINED, 'before']);
    await clickText(page, '.ava-dialog button', /^Add them$/);
    await settle(page);
    faults = [];
    if (await text(page, '.ava-dialog')) { await page.keyboard.press('Escape'); await sleep(400); }
    const p = await panelText(page);
    await page.screenshot({ path: join(OUT, `2-partway-off-${width}.png`) });
    ok(p.includes('That lets them sign in; only their welcome email waits until Advisory Board emails are turned on (they’re off now)'), `${width}, 2: only the welcome waits for the switch (${p})`);
    ok(!/sign-in and welcome wait/.test(p), `${width}, 2: never "their sign-in and welcome wait"`);
    ok(/lets them sign in to the Advisory Board page with/.test(box), `${width}, 2: the box says the same of their sign-in (${box.slice(0, 160)})`);
    await page.close();
  }
}

await browser.close();
server.close();
if (errors.length) { console.log('Page errors:'); for (const e of errors) console.log('  ', e); }
console.log(failures.length || errors.length ? `\n${failures.length} failed, ${errors.length} page errors` : '\nAll passed');
process.exit(failures.length || errors.length ? 1 : 0);
