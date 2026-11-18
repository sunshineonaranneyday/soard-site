/**
 * test-advisory-application.mjs — the Advisory Board application, in a browser
 * ===============================================================================
 * Admin → People → Applications (public/admin/advisory-applications.js), in
 * the real admin shell (the 240px sidebar) at 1440 and 390, on the REAL
 * handler (functions/api/advisory-applications-admin.js) over an in-memory D1:
 *   - the list: status counts that filter, search, the Jotform ones tagged and
 *     the one already on People → Advisory marked Joined
 *   - one application: its headshot, contact links, answers by step, a Yes on
 *     conflicts flagged, status, a note, Add to Advisory Board (hidden from the
 *     public site through the admin's api, the headshot their photo, their
 *     private email saved, Joined), Link (a headshot for someone with no photo),
 *     delete
 *   - who hears about new applications, a link straight to one, the phone,
 *     and an axe scan
 * With DIST=<an astro build folder> (npx astro build --outDir <dir>, then
 * node scripts/csp-hash.mjs <dir>) it also drives /advisory-board/apply/ on the
 * REAL public handler: the overview, the application on its own screen a screen
 * at a time, the headshot (none, too small, not a photo, an iPhone photo under
 * the page's own strict CSP from dist/_headers, kept through a reload, removed,
 * on the review, sent as the file it is), follow-ups, saving on the device, the
 * review and Edit, sending, and the Advisory Board page's Apply buttons.
 *
 *   node scripts/test-advisory-application.mjs
 *   DIST=/tmp/soard-build node scripts/test-advisory-application.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as adminApi from '../functions/api/advisory-applications-admin.js';
import * as publicApi from '../functions/api/advisory-apply.js';
import { submitApplication, listAdvisoryApplications, getAdvisoryApplication, readHeadshot } from '../functions/api/_advisory-applications.js';
import sharp from 'sharp';
import { EMAIL_ALIASES } from '../functions/api/_reveal-invites.js';
import { execFileSync } from 'node:child_process';
import { axeScan, axeText } from './lib/axe.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/advisory-application/');
mkdirSync(OUT, { recursive: true });
const DIST = process.env.DIST ? `${process.env.DIST.replace(/\/$/, '')}/` : null;
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Emails and Slack are captured, never sent; Cloudflare Images is faked (what went up is kept to look at)
const sent = { emails: [], slack: [], images: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') { const b = JSON.parse(init.body); sent.emails.push(...b); return Response.json({ data: b.map((_, i) => ({ id: `e${i}` })) }); }
  if (url.host === 'hooks.slack.test') { sent.slack.push(JSON.parse(init.body)); return new Response('ok'); }
  if (url.host === 'api.cloudflare.com' && /\/images\/v1/.test(url.pathname)) {
    if (init.method === 'POST') {
      const id = init.body.get('id');
      const bytes = new Uint8Array(await init.body.get('file').arrayBuffer());
      sent.images.push({ id, bytes, meta: await sharp(bytes).metadata() });
      return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } });
    }
    return Response.json({ success: true, result: {} });
  }
  return realFetch(input, init);
};
// Photos to pick: a good JPEG, one too small, a file that only says it's a photo, and an iPhone photo (HEIC, made by macOS's sips)
const SHOTS = join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });
const shot = (w, h, name, fmt = 'jpeg') => sharp({ create: { width: w, height: h, channels: 3, background: { r: 196, g: 170, b: 140 } } }).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h * 0.4}" r="${Math.min(w, h) / 5}" fill="#7a5a44"/></svg>`) }])[fmt]().toFile(join(SHOTS, name)).then(() => join(SHOTS, name));
const GOOD_JPG = await shot(900, 1200, 'headshot.jpg');
const SOFT_JPG = await shot(500, 500, 'soft.jpg'); // (taken, with a two-line "may look a little soft" note under it)
const SMALL_JPG = await shot(300, 300, 'tiny.jpg');
const WIDE_JPG = await shot(6000, 900, 'wide.jpg');
const CUT_JPG = join(SHOTS, 'cut.jpg');
writeFileSync(CUT_JPG, readFileSync(GOOD_JPG).subarray(0, 900));
const FAKE_JPG = join(SHOTS, 'notes.jpg');
writeFileSync(FAKE_JPG, 'These are my notes, not a photo.');
const HEIC = join(SHOTS, 'IMG_0413.HEIC');
const heicMade = await shot(1500, 2000, 'iphone.png', 'png').then((png) => { execFileSync('sips', ['-s', 'format', 'heic', png, '--out', HEIC], { stdio: 'ignore' }); return true; }).catch(() => false);
const headshotOf = async (file) => (await readHeadshot(new File([readFileSync(file)], 'headshot.jpg', { type: 'image/jpeg' }))).headshot;

// ── D1: two site applications, two from Jotform (one already an advisor) ──
const DB = await createD1();
const env = { DB, RESEND_API_KEY: 'r', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x', CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't' };
const base = {
  email: 'jordan@example.org', phone: '(770) 555-0142', address: '12 Maple Dr\nMarietta, GA 30062', heardFrom: 'A friend on the board',
  why: 'I have watched what a room can do for a child, and I want to help build more of them.', connection: 'My nephew uses a wheelchair.',
  involved: 'No', strengths: 'Corporate partnerships and event planning.', fundraising: 'An employer match and a golf foursome.', introductions: 'Yes',
  networks: 'Maybe', conflict: 'No', hostEvent: 'Maybe', meetings: 'Yes', ambassador: 'Yes', refName: 'Sam Lee', refRelationship: 'Former manager',
  refEmail: 'sam@example.org', acknowledge: true,
};
const jordan = (await submitApplication(env, { ...base, fullName: 'Jordan Avery', preferredName: 'Jo', company: 'Peachtree Builders', jobTitle: 'Director of Partnerships', link: 'linkedin.com/in/jordan-avery', signature: 'Jordan Avery' }, { now: Date.now() - 3 * 86400000, headshot: await headshotOf(GOOD_JPG) })).app;
const morgan = (await submitApplication(env, { ...base, fullName: 'Morgan Ellis', email: 'morgan@example.org', company: 'Ellis Supply', jobTitle: 'Owner', conflict: 'Yes', conflictMore: 'We sell flooring to SOARD’s builders.', meetings: 'No', signature: 'Morgan Ellis' }, { now: Date.now() - 86400000, headshot: await headshotOf(GOOD_JPG) })).app;
// Morgan applied before the form asked for a headshot
await DB.prepare('UPDATE advisory_applications SET headshot = NULL WHERE id = ?').bind(morgan.id).run();
// Avery is already on People → Advisory with no photo: Link gives them this headshot
const avery = (await submitApplication(env, { ...base, fullName: 'Avery Lin', email: 'avery@example.org', company: 'Lin Studio', signature: 'Avery Lin' }, { now: Date.now() - 2 * 86400000, headshot: await headshotOf(GOOD_JPG) })).app;
for (const sql of (await import('../functions/api/_jotform-backfill.js')).SCHEMA) await DB.exec(sql.replace(/\s+/g, ' ')); // the backfill's own table, as in D1
await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
await DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
const onPeople = (slug, d) => DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, d.order || 0, JSON.stringify({ slug, status: 'active', ...d })).run();
await onPeople('casey-reed', { name: 'Casey Reed', group: 'advisory', publishStatus: 'published', order: 0 });
// Avery Lin is on People → Advisory already, with no photo and no email on file
await onPeople('avery-lin', { name: 'Avery Lin', group: 'advisory', publishStatus: 'draft', bio: 'Kept as it is.', order: 1 });
// The board member who leads the Advisory Board committee (People → Board), with a private email
await onPeople('lee-lead', { name: 'Lee Lead', group: 'board', committees: ['Advisory Board'] });
await DB.exec('CREATE TABLE IF NOT EXISTS reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
await DB.prepare("INSERT INTO reveal_board_emails VALUES ('lee-lead', 'lee@example.org', null)").run();
// (Casey's email on file: what links her old-form application to her)
await DB.prepare("INSERT INTO reveal_board_emails VALUES ('casey-reed', 'casey@example.org', null)").run();
const jf = (first, last) => JSON.stringify({ createdAt: '2026-07-08 14:20:00', answers: {
  3: { type: 'control_fullname', text: 'Full Name', answer: { first, last } },
  5: { type: 'control_email', text: 'Email Address', answer: `${first.toLowerCase()}@example.org` },
  9: { type: 'control_textbox', text: 'Employer / Company', answer: 'Acme Co' },
  12: { type: 'control_textarea', text: 'Why are you interested in serving on the Sunshine on a Ranney Day Advisory Board?', answer: 'To give back.' },
} });
await DB.batch([
  DB.prepare("INSERT INTO jotform_backfill (submission_id, form_id, kind, name, submitted_at, answers, updated_at) VALUES ('6261000000000000001', '261805783731058', 'advisory', 'Casey Reed', '2026-07-08 14:20:00', ?, 'x')").bind(jf('Casey', 'Reed')),
  DB.prepare("INSERT INTO jotform_backfill (submission_id, form_id, kind, name, submitted_at, answers, updated_at) VALUES ('6261000000000000002', '261805783731058', 'advisory', 'Riley Stone', '2026-07-09 09:00:00', ?, 'x')").bind(jf('Riley', 'Stone')),
]);

// ── The admin shell around the module, with the admin's kit faked ──
const adminHtml = readFileSync(join(ROOT, 'public/admin/index.html'), 'utf8');
// The admin's own <style> blocks (a print template inside a script has one too: skip anything after the first <script)
const adminStyles = [...adminHtml.slice(0, adminHtml.indexOf('<script')).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const harness = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Applications harness</title><style>${adminStyles}</style></head>
<body><div class="app"><aside class="sidebar"></aside><div class="main"><div class="hub-tabs"><button class="hub-tab">Advisory</button><button class="hub-tab active">Applications</button></div><div id="root"></div></div></div>
<div id="toasts" class="toast-container" style="position:fixed;bottom:16px;right:16px;z-index:1000;display:grid;gap:6px"></div>
<script type="module">
import { h, render } from './vendor.js';
import { AdvisoryApplications } from './advisory-applications.js';
window.__toasts = []; window.__saved = []; window.__opened = [];
const addToast = (msg, kind) => { window.__toasts.push({ msg, kind }); };
const team = [{ slug: 'casey-reed', name: 'Casey Reed', group: 'advisory', order: 0 }, { slug: 'avery-lin', name: 'Avery Lin', group: 'advisory', order: 1, publishStatus: 'draft' }];
const kit = {
  team,
  api: {
    saveContent: async (path, content, message, sha, opts) => { window.__saved.push({ path, record: JSON.parse(content), message, sha, opts }); return { success: true }; },
    readContent: async (path) => ({ success: true, sha: 'sha-avery', content: JSON.stringify({ name: 'Avery Lin', slug: 'avery-lin', group: 'advisory', bio: 'Kept as it is.', order: 1, publishStatus: 'draft' }) }),
  },
  toPersonRecord: (d) => ({ ...d }),
  onOpenPerson: (slug) => window.__opened.push(slug),
  onTeamChanged: () => {},
};
render(h(AdvisoryApplications, { addToast, kit }), document.getElementById('root'));
</script></body></html>`;
// The Apply page's own CSP, exactly as the build's _headers sends it: the strict one, its inline scripts allowed by hash
// (scripts/csp-hash.mjs enforces it, leaving no Report-Only line; with ENFORCE off, that Report-Only line is the strict
// one). The live site's origin counts as 'self' here (pages name their pictures by it), and nothing is reported anywhere
const applyCsp = (() => {
  if (!DIST || !existsSync(`${DIST}_headers`)) return null;
  const text = readFileSync(`${DIST}_headers`, 'utf8');
  const at = text.indexOf('\n/advisory-board/apply/*\n');
  if (at < 0) return null;
  const lines = text.slice(at + 1).split('\n\n')[0].split('\n');
  const line = lines.find((l) => /^\s*Content-Security-Policy-Report-Only:/.test(l)) || lines.find((l) => /^\s*Content-Security-Policy:/.test(l));
  return line ? line.replace(/^\s*Content-Security-Policy(-Report-Only)?:\s*/, '').replace(/;\s*report-(uri|to)[^;]*/g, '').replace(/'self'/g, "'self' https://sunshineonaranneyday.com") : null;
})();
if (DIST && !(applyCsp && /script-src 'self'[^;]*'sha256-/.test(applyCsp) && /worker-src 'self'[^;]*blob:/.test(applyCsp))) {
  console.error(`The Apply page's CSP wasn't found in ${DIST}_headers: build it with scripts/csp-hash.mjs first`);
  process.exit(1);
}
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/admin/__advisory.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(harness); }
  // The public endpoint, as the page reaches it: the multipart body byte for byte (the headshot is binary)
  if (path === '/api/advisory-apply') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`https://site.test${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', 'CF-Connecting-IP': '198.51.100.77' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const waits = [];
    const ctx = { env, request, data: {}, waitUntil: (p) => waits.push(p) };
    const r = req.method === 'POST' ? await publicApi.onRequestPost(ctx) : await publicApi.onRequestGet(ctx);
    await Promise.all(waits);
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const rootDir = path.startsWith('/admin/') || !DIST ? join(ROOT, 'public') : DIST;
  if (path.endsWith('/')) path += 'index.html';
  const file = join(rootDir, path);
  if (file.startsWith(rootDir) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...(applyCsp && path === '/advisory-board/apply/index.html' ? { 'content-security-policy': applyCsp } : {}) });
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
const revealEmails = [];

let failAdd = false;
let gatewayOnce = false;
let refuseOnce = false;
let limitOnce = false;

async function answer(req, ip) {
  const url = new URL(req.url());
  const run = async (mod) => {
    const request = new Request(`https://site.test${url.pathname}${url.search}`, { method: req.method(), body: req.method() === 'POST' ? req.postData() : undefined, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip } });
    const waits = [];
    const ctx = { env, request, data: { userEmail: 'linzi@soardcharity.com' }, waitUntil: (p) => waits.push(p) };
    const res = req.method() === 'POST' ? await mod.onRequestPost(ctx) : await mod.onRequestGet(ctx);
    await Promise.all(waits);
    return req.respond({ status: res.status, contentType: 'application/json', body: Buffer.from(await res.arrayBuffer()) });
  };
  // (failAdd: the next Add answers as a database that didn't answer would, in words)
  if (url.pathname === '/api/advisory-applications-admin' && failAdd && req.method() === 'POST' && /"add"/.test(req.postData() || '')) {
    failAdd = false;
    return req.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Adding them stopped partway: the site’s database didn’t answer just now. Press Add to Advisory Board again in a moment: it finishes what’s left, and never adds them twice.' }) });
  }
  if (url.pathname === '/api/advisory-applications-admin') return run(adminApi);
  if (url.pathname === '/api/advisory-apply' && req.method() === 'POST') {
    // (what the page sent, for the checks; gatewayOnce: the next send answered as a gateway's error page would)
    if (gatewayOnce) { gatewayOnce = false; return req.respond({ status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' }); }
    if (limitOnce) { limitOnce = false; return req.respond({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Too many attempts. Please wait a minute and try again.' }) }); }
    if (refuseOnce) { refuseOnce = false; return req.respond({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, problems: { headshot: 'We couldn’t use that photo. Please choose a different one.' }, error: 'A few answers need a look.', spent: true }) }); }
  }
  if (url.pathname === '/api/advisory-apply') return false; // the test server answers it (above), byte for byte
  if (url.pathname === '/api/reveal-invites-admin') { revealEmails.push(JSON.parse(req.postData()).boardEmail); return req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
  // The home address's suggestions (the application's endpoint), as Google would answer
  if (url.pathname === '/api/apply' && url.searchParams.has('address')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, source: 'google', results: /^3167/.test(url.searchParams.get('address')) ? [{ id: 'ChIJ_home_one_0001', line1: '3167 Main St', sub: 'Duluth, GA' }] : [] }) });
  if (url.pathname === '/api/apply' && url.searchParams.has('place')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, address: { line1: '3167 Main St', line2: '', city: 'Duluth', state: 'GA', zip: '30096' } }) });
  // (a headshot that won't load: Cloudflare answering 404)
  if (/broken-headshot/.test(url.pathname)) return req.respond({ status: 404, contentType: 'text/plain', body: 'not found' });
  // A headshot on Cloudflare Images: a real photo, so the screenshots show how one looks
  if (/\/cdn-cgi\/imagedelivery\/|^imagedelivery\.net$/.test(url.pathname + url.hostname) && /advisory-applications\//.test(url.pathname)) return req.respond({ status: 200, contentType: 'image/jpeg', body: readFileSync(GOOD_JPG) });
  // Anything from outside: a script (Cloudflare's analytics) answered as an empty one, anything else as a picture
  if (url.hostname !== '127.0.0.1') return req.respond(req.resourceType() === 'script' ? { status: 200, contentType: 'text/javascript', body: '' } : { status: 200, contentType: 'image/png', body: PNG });
  return false;
}

// 'shell': screenshots keep working while the Mac's display sleeps
const browser = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
async function open(width, path, height = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500 });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try { if (await answer(req, `198.51.100.${width % 250}`) === false) req.continue(); } catch (e) { console.error(e); req.respond({ status: 500, body: '{}' }); }
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // The page's CSP refusing anything is an error here
  await page.evaluateOnNewDocument(() => { addEventListener('securitypolicyviolation', (e) => console.error(`CSP refused ${e.violatedDirective}: ${e.blockedURI}`)); });
  // (what the Apply page sends, for the checks: its payload part, as it went)
  await page.evaluateOnNewDocument(() => {
    const was = window.fetch;
    window.fetch = (input, init) => { try { if (init?.body instanceof FormData && init.body.has('payload')) window.__lastPayload = init.body.get('payload'); } catch { /* not a form */ } return was(input, init); };
  });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|live-ws/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' });
  return page;
}
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const visible = (page, sel) => page.$eval(sel, (el) => !!el.offsetParent).catch(() => false);
const clickText = (page, sel, re) => page.evaluate((s, src) => { const el = [...document.querySelectorAll(s)].find((x) => new RegExp(src).test(x.textContent)); if (el) { el.click(); return true; } return false; }, sel, re.source);
const sideways = (page) => page.evaluate(() => {
  const main = document.querySelector('.main');
  const right = main ? main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight) + 1 : innerWidth;
  return document.documentElement.scrollWidth > innerWidth + 1
    || [...document.querySelectorAll('.ava *')].some((el) => el.getBoundingClientRect().width && el.getBoundingClientRect().right > right && !el.closest('.ava-drawer'));
});

console.log('Admin → People → Applications, 1440');
const page = await open(1440, '/admin/__advisory.html');
await page.waitForSelector('.ava-row', { timeout: 15000 });
ok((await page.$$('.ava-row')).length === 5, 'all five applications: three from the site, two from Jotform');
ok(await page.evaluate(() => window.__toasts.some((t) => /2 applications from the old form are here now/.test(t.msg))), 'the earlier applications came in, and it says so once');
const strip = await page.$$eval('.ava-strip button', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
ok(JSON.stringify(strip) === JSON.stringify(['All 5', 'New 4', 'In conversation 0', 'Joined 1', 'Not now 0']), `status counts ${JSON.stringify(strip)}`);
ok(/Casey Reed/.test(await page.$$eval('.ava-row', (els) => els.find((e) => /Joined/.test(e.textContent))?.textContent || '')), 'the Jotform applicant already on People → Advisory is Joined');
ok(await page.$$eval('.ava-tag', (els) => els.filter((e) => e.textContent === 'Earlier form').length) === 2, 'the ones sent before the website form are tagged');
ok(await page.$$eval('.ava-row.is-new', (els) => els.length) === 4, 'new ones stand out');
// Their headshots in the list, their face in the middle; initials for anyone without one
const avatars = await page.$$eval('.ava-row', (els) => Object.fromEntries(els.map((e) => [e.querySelector('.ava-name')?.textContent.replace(/ \(.*\)$/, '').trim(), e.querySelector('.ava-avatar img')?.getAttribute('src') || e.querySelector('.ava-avatar')?.textContent.trim()])));
ok(avatars['Jordan Avery']?.includes(`/${jordan.headshot.url.split('/').slice(-4, -1).join('/')}/w=80,h=80,fit=cover,gravity=face`), `a headshot in the list (${avatars['Jordan Avery']})`);
ok(avatars['Morgan Ellis'] === 'ME' && avatars['Riley Stone'] === 'RS', `initials without one (${avatars['Morgan Ellis']}, ${avatars['Riley Stone']})`);
ok(/Jordan Avery \(Jo\)/.test(await text(page, '.ava-list')), 'a preferred name shows beside the full one');
await clickText(page, '.ava-strip button', /^Joined/); await sleep(150);
ok((await page.$$('.ava-row')).length === 1, 'a status filters the list');
await clickText(page, '.ava-strip button', /^All/);
await page.type('.ava-search input', 'ellis'); await sleep(150);
ok((await page.$$('.ava-row')).length === 1 && /Morgan Ellis/.test(await text(page, '.ava-list')), 'search finds by company');
await page.$eval('.ava-search input', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(150);
ok(!(await sideways(page)), 'nothing past the edge');
await page.screenshot({ path: join(OUT, 'admin-list-1440.png') });

// Morgan: a Yes on conflicts and a No on meetings are flagged
await clickText(page, '.ava-row', /Morgan Ellis/);
await page.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
ok(await page.$$eval('.ava-a.is-flag', (els) => els.map((e) => e.textContent)).then((t) => t.includes('Yes') && t.includes('No')), 'a Yes on conflicts and a No on four meetings stand out');
ok(await page.$eval('.ava-contact a[href^="mailto:"]', (el) => el.getAttribute('href')) === 'mailto:morgan@example.org', 'email is a link');
ok(await page.$eval('.ava-contact a[href^="tel:"]', (el) => el.getAttribute('href')) === 'tel:7705550142', 'and so is the phone');
ok(/None: they applied before the form asked for one\./.test(await text(page, '[aria-label="Headshot"]')), 'an application from before the headshot says so');
await page.keyboard.press('Escape'); await sleep(250);
ok(!(await page.$('.ava-drawer')), 'Escape closes it');

// Jordan: status, a note, Add to Advisory Board
await clickText(page, '.ava-row', /Jordan Avery/);
await page.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
ok(/Peachtree Builders/.test(await text(page, '.ava-dhead')), 'the panel heads with their work');
await sleep(300);
await page.screenshot({ path: join(OUT, 'admin-headshot-1440.png') });
ok((await page.$$eval('.ava-panel h3', (els) => els.map((e) => e.textContent))).join('|').startsWith('Where it stands|Headshot|How to reach them|Your interest|What you’d bring'), 'their headshot and how to reach them first, then the answers by step');
{
  const shotPanel = await page.$eval('[aria-label="Headshot"]', (el) => {
    const full = [...el.querySelectorAll('a')].find((a) => /Open full size/.test(a.textContent));
    const pic = el.querySelector('img')?.closest('a');
    return { src: el.querySelector('img')?.getAttribute('src'), href: full?.href, label: full?.getAttribute('aria-label'), name: full?.textContent.replace(/\s+/g, ' ').trim(), picStop: pic?.tabIndex, picHidden: pic?.getAttribute('aria-hidden'), words: el.textContent.replace(/\s+/g, ' ') };
  });
  ok(/w=256,h=256,fit=cover,gravity=face/.test(shotPanel.src) && shotPanel.href === jordan.headshot.url && shotPanel.label === null && shotPanel.name === 'Open full size (Jordan Avery’s headshot)' && /900 × 1200 pixels/.test(shotPanel.words),
    `the headshot, its size, and full size a click away (${JSON.stringify(shotPanel)})`);
  ok(shotPanel.picStop === -1 && shotPanel.picHidden === 'true', 'the picture and "Open full size" are one stop for the keys, not two to the same place');
}
await clickText(page, '.ava-status button', /In conversation/);
await page.waitForFunction(() => document.querySelector('.ava-status button[aria-pressed="true"]')?.textContent.includes('In conversation'), { timeout: 5000 }).catch(() => null);
ok((await getAdvisoryApplication(DB, jordan.id)).status === 'talking', 'status saved');
ok(/In conversation/.test(await page.$$eval('.ava-row', (els) => els.find((e) => /Jordan/.test(e.textContent))?.textContent || '')), 'and the list behind shows it');
await page.type('#ava-note', 'Called Monday. Coffee next week.');
await clickText(page, '.ava-note-form button', /Add note/);
await page.waitForFunction(() => /Coffee next week/.test(document.querySelector('.ava-notes')?.textContent || ''), { timeout: 5000 }).catch(() => null);
ok((await getAdvisoryApplication(DB, jordan.id)).notes[0]?.by === 'linzi@soardcharity.com', 'a note, with who wrote it');
await page.screenshot({ path: join(OUT, 'admin-drawer-1440.png') });
// Another press adding them right now (another tab): the box says so and waits, then shows what's so once it's done
await DB.prepare('CREATE TABLE IF NOT EXISTS advisory_add_holds (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
await DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind(`app:${jordan.id}`, Date.now()).run();
await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
await page.waitForSelector('.ava-dialog', { timeout: 4000 });
{
  const waiting = await text(page, '.ava-dialog');
  ok(/Someone is adding Jordan Avery right now/.test(waiting) && !/\bAdd them\b/.test(await text(page, '.ava-dialog footer, .ava-dialog .ava-dfoot, .ava-dialog')), `a press already adding them: the box says so, with nothing to press but Close (${waiting})`);
  await DB.prepare('DELETE FROM advisory_add_holds').run();
  const moved = await page.waitForFunction(() => /sign in to the Advisory Board page with/.test(document.querySelector('.ava-dialog')?.textContent || ''), { timeout: 6000 }).then(() => true).catch(() => false);
  ok(moved, `and once it's done, the box shows what Add does now, by itself (${await text(page, '.ava-dialog h2')})`);
  await sleep(300);
  ok(await page.evaluate(() => document.activeElement?.matches('.ava-dialog h2')), `and the keys go to its heading, so a screen reader hears what it says now (${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))})`);
}
{
  const said = await text(page, '.ava-dialog');
  ok(/sign in to the Advisory Board page with jordan@example\.org/.test(said) && /every reveal invite/.test(said) && /advisory@soardcharity\.com once Advisory Board emails are on/.test(said) && /Show on the site/.test(said), 'it says what Add does first: the page, reveal invites, advisory@, and off the public site till shown');
  ok(/with their headshot as their photo/.test(said) && /emails jordan@example\.org how to sign in once Advisory Board emails are turned on \(they’re off now\)/.test(said) && !/add a photo/.test(said), `and their headshot, and that the sign-in email waits for the Advisory Board’s emails (${said})`);
  ok(!/advisor(?!y)/i.test(said), `never "advisor" (${(said.match(/\S*advisor(?!y)\S*/gi) || []).join(', ')})`);
  await page.waitForFunction(() => document.activeElement?.closest?.('.ava-dialog'), { timeout: 2000 }).catch(() => null);
  // (here it came after a wait, so the keys are on its heading, read out; Cancel when it opens straight away, below)
  const on = await page.evaluate(() => document.activeElement?.matches('.ava-dialog h2') ? 'heading' : document.activeElement?.textContent.trim());
  await page.keyboard.press('Enter'); await sleep(600);
  ok(['heading', 'Cancel'].includes(on) && !!(await page.$('.ava-dialog')) && (await getAdvisoryApplication(DB, jordan.id)).status !== 'joined',
    `the keys start on its heading or Cancel, never Add: a stray Enter adds nobody (${on})`);
}
await page.screenshot({ path: join(OUT, 'admin-add-1440.png') });
// A press that fails: said in words, the box stays (asked again of the server), and the keys go back to Cancel
failAdd = true;
await clickText(page, '.ava-dialog button', /^Add them$/);
await page.waitForFunction(() => window.__toasts.some((t) => /stopped partway/.test(t.msg)), { timeout: 5000 }).catch(() => null);
await sleep(400);
ok(!!(await page.$('.ava-dialog')) && await page.evaluate(() => document.activeElement?.textContent.trim()) === 'Cancel' && !(await getAdvisoryApplication(DB, jordan.id)).personSlug,
  `a failed press: told in words, the box stays, the keys on Cancel (${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))})`);
await clickText(page, '.ava-dialog button', /^Add them$/);
await page.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 6000 }).catch(() => null);
// The server did it, through the admin's own save: People, their private email, Joined
const rec = JSON.parse((await DB.prepare('SELECT data FROM team WHERE slug = ?').bind('jordan-avery').first())?.data || '{}');
ok(rec.group === 'advisory' && rec.publishStatus === 'draft' && rec.title === 'Advisory Board Member' && rec.organization === 'Peachtree Builders' && rec.linkedin === 'https://www.linkedin.com/in/jordan-avery' && rec.order === 2,
  `a hidden Advisory Board member, with their company and LinkedIn (${JSON.stringify(rec)})`);
ok(rec.photo === jordan.headshot.url && JSON.stringify(rec.photoSize) === '[900,1200]', `their headshot is their photo, its size with it (${rec.photo} ${JSON.stringify(rec.photoSize)})`);
ok((await page.evaluate(() => window.__saved)).length === 0, 'nothing saved from the browser: the server adds them, in one go');
{
  const said = (await page.evaluate(() => window.__toasts)).map((t) => t.msg).find((m) => /Jordan Avery is on the Advisory Board/.test(m)) || '';
  ok(/with their headshot as their photo\. Advisory Board emails are off, so their sign-in email goes once those are turned on\. They stay off the public site/.test(said), `the message after says what happened (${said})`);
}
ok((await DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind('jordan-avery').first())?.email === 'jordan@example.org', 'their email kept private (their sign-in, and reveal invites)');
await sleep(200);
ok(await page.evaluate(() => !!document.activeElement?.closest('.ava-callout')), `the keys land on what the panel says now (${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))})`);
ok((await getAdvisoryApplication(DB, jordan.id)).status === 'joined', 'and the application is Joined');
ok(await visible(page, '.ava-callout.is-good'), 'the panel says they’re on People → Advisory');
await clickText(page, '.ava-callout button', /Open their page/);
ok((await page.evaluate(() => window.__opened)).includes('jordan-avery'), 'with a way to their page');
// Off Joined: asked first, and told how someone really leaves (Keep it Joined changes nothing)
await clickText(page, '.ava-status button', /In conversation/);
await page.waitForSelector('.ava-dialog', { timeout: 4000 }).catch(() => null);
{
  const asked = await text(page, '.ava-dialog');
  ok(/Mark Jordan Avery’s application In conversation\?/.test(asked) && /stays on the Advisory Board, with their sign-in, reveal invites and advisory@: Move to alumni on their People page is how someone leaves/.test(asked), `moving off Joined asks first, and says how someone leaves (${asked})`);
  await clickText(page, '.ava-dialog button', /^Keep it Joined$/); await sleep(300);
  ok((await getAdvisoryApplication(DB, jordan.id)).status === 'joined', 'Keep it Joined changes nothing');
  // Their sign-in email taken off People: the box never says they have a sign-in
  const kept = await DB.prepare('SELECT slug, email FROM reveal_board_emails WHERE slug = ?').bind('jordan-avery').first();
  await DB.prepare('DELETE FROM reveal_board_emails WHERE slug = ?').bind('jordan-avery').run();
  await page.keyboard.press('Escape'); await sleep(300);
  await clickText(page, '.ava-row', /Jordan Avery/);
  await page.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 }); await sleep(300);
  await clickText(page, '.ava-status button', /In conversation/);
  await page.waitForSelector('.ava-dialog', { timeout: 4000 }).catch(() => null);
  const none = await text(page, '.ava-dialog');
  ok(/stays on the Advisory Board: Move to alumni/.test(none) && !/with their sign-in/.test(none) && /no sign-in email on their People page, so they can’t sign in or get reveal invites/.test(none), `with no sign-in email on People, the box says so, never "their sign-in" (${none})`);
  await clickText(page, '.ava-dialog button', /^Keep it Joined$/); await sleep(300);
  await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(kept.slug, kept.email).run();
  await page.keyboard.press('Escape'); await sleep(300);
  await clickText(page, '.ava-row', /Jordan Avery/);
  await page.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 }); await sleep(300);
  await clickText(page, '.ava-status button', /In conversation/);
  await page.waitForSelector('.ava-dialog', { timeout: 4000 }).catch(() => null);
  await clickText(page, '.ava-dialog button', /^Mark it In conversation$/);
}
await page.waitForFunction(() => document.querySelector('.ava-status button[aria-pressed="true"]')?.textContent.includes('In conversation'), { timeout: 5000 }).catch(() => null);
ok(/On People → Advisory as Jordan Avery.*This application isn’t marked Joined: Add to Advisory Board below finishes adding them/.test(await text(page, '.ava-callout.is-good')) && await visible(page, '.ava-actions .btn-primary'),
  `marked something else, the panel still says they’re on the Advisory Board, and Add stays to finish it (${await text(page, '.ava-callout')})`);
// Joined again: the pill opens Add's box (Joined is only ever set by Add)
await clickText(page, '.ava-status button', /Joined/);
await page.waitForSelector('.ava-dialog', { timeout: 4000 }).catch(() => null);
ok(/Link Jordan Avery/.test(await text(page, '.ava-dialog h2')), `the Joined pill opens Add’s box (${await text(page, '.ava-dialog h2')})`);
await clickText(page, '.ava-dialog button', /^Link them$/);
await page.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 6000 }).catch(() => null);
ok((await getAdvisoryApplication(DB, jordan.id)).status === 'joined', 'and Add marks it Joined again');
await page.keyboard.press('Escape'); await sleep(200);

// Avery: already on People → Advisory with no photo: Link gives them this headshot, nothing else on their page changes
await clickText(page, '.ava-row', /Avery Lin/);
await page.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
await clickText(page, '.ava-drawer button', /^Add to Advisory Board$/);
await page.waitForSelector('.ava-dialog', { timeout: 4000 });
{
  const said = await text(page, '.ava-dialog');
  ok(/Is this the same Avery Lin\?/.test(said) && /no email on file/.test(said) && /avery@example\.org/.test(said), `the same name with no email on file: staff say who it is, both shown (${said})`);
  ok(/The same person links this application to Avery Lin, makes this headshot their photo \(they have none\), saves avery@example\.org as their sign-in email, lets them sign in to the Advisory Board page, puts them on every reveal invite, puts them on advisory@soardcharity\.com once Advisory Board emails are on, and emails avery@example\.org how to sign in once Advisory Board emails are turned on \(they’re off now\)\./.test(said)
    && /A different person adds Avery Lin to People → Advisory as someone new, at Lin Studio, with this headshot as their photo, lets them sign in to the Advisory Board page with avery@example\.org, emails avery@example\.org how to sign in once Advisory Board emails are turned on \(they’re off now\), puts them on every reveal invite, puts them on advisory@soardcharity\.com once Advisory Board emails are on, shows them to the other Advisory Board members on the Advisory Board page, and keeps them off the public site until you turn on Show on the site\./.test(said)
    && /Either way, this application is marked Joined\./.test(said), `and everything each choice does (${said})`);
  await sleep(500); // (its fade in)
  const top = await page.evaluate(() => { const d = document.querySelector('.ava-dialog').getBoundingClientRect(); const at = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2); return { onTop: !!at?.closest('.ava-dialog'), opacity: getComputedStyle(document.querySelector('.ava-dialog')).opacity }; });
  ok(top.onTop && top.opacity === '1', `the box is over the panel, nothing of the panel on top of it (${JSON.stringify(top)})`);
  await page.screenshot({ path: join(OUT, 'admin-choose-1440.png') });
}
await clickText(page, '.ava-dialog button', /^The same person$/);
await page.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 6000 }).catch(() => null);
{
  const a2 = JSON.parse((await DB.prepare('SELECT data FROM team WHERE slug = ?').bind('avery-lin').first()).data);
  ok(a2.photo === avery.headshot.url && a2.bio === 'Kept as it is.' && JSON.stringify(a2.photoSize) === '[900,1200]', `their page with only the photo added (${JSON.stringify(a2)})`);
  ok((await DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind('avery-lin').first())?.email === 'avery@example.org', 'their email saved (they had none)');
  ok((await getAdvisoryApplication(DB, avery.id)).status === 'joined', 'and the application is Joined');
  ok((await DB.prepare("SELECT count(*) AS n FROM team WHERE slug LIKE 'avery-lin%'").first()).n === 1, 'never a second Avery');
}
await page.keyboard.press('Escape'); await sleep(200);

// Who hears about new applications
await clickText(page, '.ava-head button', /Who hears about them/);
await page.waitForSelector('#ava-staff');
ok(/On it now: Lee Lead\./.test(await text(page, '.ava-dialog')), 'the committee shows who’s on it now');
await page.screenshot({ path: join(OUT, 'admin-who-hears-1440.png') });
await page.$eval('#ava-staff', (el) => { el.value = 'peter@example.org\nnope'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await clickText(page, '.ava-dialog button', /^Save$/); await sleep(300);
ok(/nope isn’t an email address/.test(await text(page, '.ava-dialog')), 'a bad address is named');
await page.$eval('#ava-staff', (el) => { el.value = 'peter@example.org\nlinzi@example.org'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await clickText(page, '.ava-dialog button', /^Save$/);
await page.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 5000 }).catch(() => null);
ok(/peter@example\.org, linzi@example\.org and the Advisory Board committee \(Lee Lead\) hear about each one/.test(await text(page, '.ava-head')), `saved, and the header says who hears (${await text(page, '.ava-head p')})`);

// Delete Riley's (a person asked)
await clickText(page, '.ava-row', /Riley Stone/);
await page.waitForSelector('.ava-drawer .ava-foot');
await clickText(page, '.ava-foot button', /Delete application/);
await page.waitForSelector('.ava-dialog');
await clickText(page, '.ava-dialog button', /^Delete application$/);
await page.waitForFunction(() => !document.querySelector('.ava-drawer'), { timeout: 5000 }).catch(() => null);
ok(!(await listAdvisoryApplications(DB)).some((a) => a.name === 'Riley Stone') && (await page.$$('.ava-row')).length === 4, 'deleted from the site, and from the list');
const av = await axeScan(page, '.ava');
ok(!av.length, `axe: the list has no WCAG 2.1 AA problems${av.length ? ` (${axeText(av)})` : ''}`);
await page.close();

console.log('A link straight to one (the staff email’s), on a phone');
const phone = await open(390, `/admin/__advisory.html#advisory-applications/${morgan.id}`, 844);
await phone.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
ok(/Morgan Ellis/.test(await text(phone, '.ava-dhead h2')), 'the link opens that application');
ok(Math.abs((await phone.$eval('.ava-drawer', (el) => el.getBoundingClientRect().width)) - 390) < 2, 'it fills the phone');
const small = await phone.evaluate(() => [...document.querySelectorAll('.ava-drawer button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 38).map((b) => b.textContent.trim().slice(0, 20)));
ok(!small.length, `buttons are big enough to tap${small.length ? ` (${small.join(', ')})` : ''}`);
const dv = await axeScan(phone, '.ava-drawer');
ok(!dv.length, `axe: the panel has no WCAG 2.1 AA problems${dv.length ? ` (${axeText(dv)})` : ''}`);
await phone.screenshot({ path: join(OUT, 'admin-drawer-390.png') });
{
  const joined = await phone.$$eval('.ava-status button', (bs) => { const b = bs.find((x) => /Joined/.test(x.textContent)); return { title: b.title }; });
  await clickText(phone, '.ava-status button', /Joined/);
  await phone.waitForSelector('.ava-dialog', { timeout: 4000 }).catch(() => null);
  const opened = await text(phone, '.ava-dialog h2');
  ok(/Opens Add to Advisory Board/.test(joined.title) && /Add Morgan Ellis to the Advisory Board/.test(opened) && (await getAdvisoryApplication(DB, morgan.id)).status === 'new',
    `Joined before they’re added opens Add’s box, and nothing changes until it’s pressed (${opened})`);
  await clickText(phone, '.ava-dialog button', /^Cancel$/); await sleep(300);
  // A note being written survives Escape
  await phone.type('#ava-note', 'Draft about Morgan');
  await phone.keyboard.press('Escape'); await sleep(250);
  await clickText(phone, '.ava-row', /Morgan Ellis/);
  await phone.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  ok(await phone.$eval('#ava-note', (e) => e.value) === 'Draft about Morgan', 'a note being written is still there after Escape');
  await phone.$eval('#ava-note', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  // Up and down keep the keys on the button
  const nav = await phone.$('.ava-close[data-nav="next"]:not([disabled])') || await phone.$('.ava-close[data-nav="prev"]:not([disabled])');
  const which = await nav.evaluate((b) => b.dataset.nav);
  await nav.click(); await sleep(400);
  ok(await phone.evaluate(() => document.activeElement?.dataset?.nav || '') !== '', `up and down keep the keys on that button (${which})`);
  await phone.keyboard.press('Escape'); await sleep(250);
  // Under a filter, a status change keeps the one open on the list (up and down still work), and Escape lands on the list
  await clickText(phone, '.ava-strip button', /^New/); await sleep(200);
  await clickText(phone, '.ava-row', /Morgan Ellis/);
  await phone.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(phone, '.ava-status button', /In conversation/);
  await phone.waitForFunction(() => document.querySelector('.ava-status button[aria-pressed="true"]')?.textContent.includes('In conversation'), { timeout: 5000 }).catch(() => null);
  ok(!!(await phone.$(`.ava-row[data-id="${morgan.id}"]`)) && !/Nobody matches/.test(await text(phone, '.ava')), 'a status change under a filter keeps the one open on the list');
  await phone.keyboard.press('Escape'); await sleep(300);
  ok(await phone.evaluate(() => !!document.activeElement?.closest?.('.ava-list, .ava-search, .ava-zero')), `and Escape puts the keys on the list (${await phone.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))})`);
  await clickText(phone, '.ava-strip button', /^All/); await sleep(200);
}
{
  // A long link pasted into a note wraps in the panel, never pushing it sideways
  await clickText(phone, '.ava-row', /Morgan Ellis/);
  await phone.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  const link = `https://docs.google.com/document/d/${'1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'.repeat(3)}/edit?usp=sharing`;
  await phone.$eval('#ava-note', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, `Their deck: ${link}`);
  await clickText(phone, '.ava-note-form button', /Add note/);
  await phone.waitForFunction(() => /docs\.google\.com/.test(document.querySelector('.ava-notes')?.textContent || ''), { timeout: 5000 }).catch(() => null);
  const fit = await phone.evaluate(() => { const b = document.querySelector('.ava-dbody'); const btn = document.querySelector('.ava-note-form button'); return { scroll: b.scrollWidth, width: b.clientWidth, button: Math.round(btn.getBoundingClientRect().right) }; });
  ok(fit.scroll <= fit.width + 1 && fit.button <= 390, `a ${link.length}-character link in a note wraps: the panel never goes sideways (${JSON.stringify(fit)})`);
  // The counter counts a note as it's saved: blank lines at its end don't count
  await phone.$eval('#ava-note', (e) => { e.value = `${'x'.repeat(3999)}\n\n`; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const count = { words: await text(phone, '#ava-note-count'), off: await phone.$eval('.ava-note-form button', (b) => b.getAttribute('aria-disabled')) };
  ok(/^3,999 of 4,000 characters$/.test(count.words) && count.off === null, `blank lines at a note’s end aren’t counted, as the server trims them (${JSON.stringify(count)})`);
  await phone.$eval('#ava-note', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await phone.keyboard.press('Escape'); await sleep(300);
  // Left, while it's the filter on: still there after its last one is brought back, so the list says why it's empty
  const team = JSON.parse((await DB.prepare('SELECT data FROM team WHERE slug = ?').bind('jordan-avery').first()).data);
  await DB.prepare('UPDATE team SET data = ? WHERE slug = ?').bind(JSON.stringify({ ...team, status: 'alumni', until: 2026 }), 'jordan-avery').run();
  await DB.prepare("UPDATE advisory_applications SET status = 'joined' WHERE id = ?").bind(jordan.id).run();
  await phone.reload({ waitUntil: 'networkidle0' });
  await phone.waitForSelector('.ava-strip', { timeout: 8000 }); await sleep(300);
  ok(await clickText(phone, '.ava-strip button', /^Left/), 'someone who left: the Left filter shows');
  await sleep(200);
  await clickText(phone, '.ava-row', /Jordan Avery/);
  await phone.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(phone, '.ava-drawer button', /^Add to Advisory Board$/);
  await phone.waitForSelector('.ava-dialog', { timeout: 4000 });
  await clickText(phone, '.ava-dialog button', /^Link them$/);
  await phone.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 8000 }).catch(() => null);
  await phone.keyboard.press('Escape'); await sleep(300);
  const strip = await phone.$$eval('.ava-strip button', (bs) => bs.map((b) => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), on: b.getAttribute('aria-pressed') })));
  const leftNow = strip.find((b) => /^Left/.test(b.t));
  ok(!!leftNow && leftNow.on === 'true' && /\b0$/.test(leftNow.t) && /Nobody matches/.test(await text(phone, '.ava')), `brought back, the Left filter stays (pressed, 0) while it’s on, so the empty list makes sense (${JSON.stringify(strip)})`);
  await clickText(phone, '.ava-strip button', /^All/); await sleep(200);
  ok(!(await phone.$$eval('.ava-strip button', (bs) => bs.some((b) => /^Left/.test(b.textContent.trim())))), 'and off it, with nobody left, it goes');
}
ok(!(await sideways(phone)), 'phone: nothing past the edge');
await phone.screenshot({ path: join(OUT, 'admin-list-390.png') });
await phone.close();
{
  // Someone whose email on People is a SOARD address (it signs in as staff): the box never says it's kept as their
  // sign-in, or that it emails them how to sign in, and says what to do
  await onPeople('sal-staff', { name: 'Sal Staff', group: 'advisory', publishStatus: 'published' });
  await DB.prepare("INSERT INTO reveal_board_emails VALUES ('sal-staff', 'sal@soardcharity.com', null)").run();
  const sal = (await submitApplication(env, { ...base, fullName: 'Sal Staff', email: 'sal@soardcharity.com', signature: 'Sal Staff' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  const st = await open(1280, `/admin/__advisory.html#advisory-applications/${sal.id}`, 900);
  await st.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(st, '.ava-drawer button', /^Add to Advisory Board$/);
  await st.waitForSelector('.ava-dialog', { timeout: 4000 });
  const said = await text(st, '.ava-dialog');
  ok(/Their email on file, sal@soardcharity\.com, is a SOARD address, which signs in as staff, never as an Advisory Board member\. Put their own on their People page/.test(said)
    && !/keeps sal@soardcharity\.com as their sign-in email/.test(said) && !/emails sal@soardcharity\.com how to sign in/.test(said) && !/isn’t saved/.test(said),
    `an email on file that signs in as staff: the box says so, never "keeps it as their sign-in" or "emails it how to sign in" (${said})`);
  await st.waitForFunction(() => document.activeElement?.closest?.('.ava-dialog'), { timeout: 2000 }).catch(() => null);
  ok(await st.evaluate(() => document.activeElement?.textContent.trim()) === 'Cancel', `a box opened straight away starts on Cancel: a stray Enter adds nobody (${await st.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))})`);
  await clickText(st, '.ava-dialog button', /^Cancel$/);
  await st.close();
}
{
  // Another of someone's addresses that signs in as a SOARD one: one sentence, said right
  const [alias, as] = Object.entries(EMAIL_ALIASES)[0];
  const al = (await submitApplication(env, { ...base, fullName: 'Al Alias', email: alias, signature: 'Al Alias' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  const pa = await open(1280, `/admin/__advisory.html#advisory-applications/${al.id}`, 900);
  await pa.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(pa, '.ava-drawer button', /^Add to Advisory Board$/);
  await pa.waitForSelector('.ava-dialog', { timeout: 4000 });
  const said = await text(pa, '.ava-dialog');
  ok(said.includes(`${alias} signs in as ${as}, a SOARD address, which signs in as staff, never as an Advisory Board member, so it isn’t saved.`), `an address that signs in as a SOARD one: one sentence (${said.slice(said.indexOf(alias), said.indexOf(alias) + 150)})`);
  await clickText(pa, '.ava-dialog button', /^Cancel$/);
  await pa.close();
}
{
  // An initial two members share: both named, a button for each, and the one pressed is the one linked
  await onPeople('quinn-ames', { name: 'Quinn Ames', group: 'advisory', publishStatus: 'published' });
  await onPeople('quincy-ames', { name: 'Quincy Ames', group: 'advisory', publishStatus: 'published' });
  await DB.prepare("INSERT INTO reveal_board_emails VALUES ('quinn-ames', 'quinn@example.org', null)").run();
  await DB.prepare("INSERT INTO reveal_board_emails VALUES ('quincy-ames', 'quincy@example.org', null)").run();
  const qa = (await submitApplication(env, { ...base, fullName: 'Q. Ames', email: 'q.ames@example.org', signature: 'Q. Ames' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  const pq = await open(1280, `/admin/__advisory.html#advisory-applications/${qa.id}`, 900);
  await pq.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(pq, '.ava-drawer button', /^Add to Advisory Board$/);
  await pq.waitForSelector('.ava-dialog', { timeout: 4000 });
  const box = await pq.evaluate(() => ({ title: document.querySelector('.ava-dialog h2')?.textContent.trim(),
    picks: [...document.querySelectorAll('.ava-dialog .ava-picks li')].map((li) => ({ button: li.querySelector('button').textContent.trim(), does: li.querySelector('p').textContent.trim(), described: li.querySelector('button').getAttribute('aria-describedby') === li.querySelector('p').id })),
    foot: [...document.querySelectorAll('.ava-dialog .kd-dialog__foot button')].map((b) => b.textContent.trim()) }));
  const quincy = box.picks.find((x) => x.button === 'It’s Quincy Ames');
  ok(box.title === 'Is Q. Ames one of these people?' && box.picks.some((x) => x.button === 'It’s Quinn Ames') && quincy && /^Links this application to Quincy Ames/.test(quincy.does) && box.picks.some((x) => x.button === 'A different person')
    && box.picks.every((x) => x.described) && box.foot.join('|') === 'Cancel', `two members the name could be: each choice in the box, with what it does under it (and read with it), Cancel below (${JSON.stringify(box)})`);
  await clickText(pq, '.ava-dialog .ava-picks button', /^It’s Quincy Ames$/);
  await pq.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 8000 }).catch(() => null);
  ok((await getAdvisoryApplication(DB, qa.id)).personSlug === 'quincy-ames', 'and the one pressed is the one linked');
  // Moving it off Joined: their email on file signs in as staff, so it never says "their sign-in"
  await DB.prepare("UPDATE reveal_board_emails SET email = 'quincy@soardcharity.com' WHERE slug = 'quincy-ames'").run();
  await pq.reload({ waitUntil: 'networkidle0' });
  await pq.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 }); await sleep(300);
  await clickText(pq, '.ava-status button', /In conversation/);
  await pq.waitForSelector('.ava-dialog', { timeout: 4000 }).catch(() => null);
  const leave = await text(pq, '.ava-dialog');
  ok(!/with their sign-in/.test(leave) && /Their email on file is a SOARD address, which signs in as staff, so they can’t sign in to the Advisory Board page until their own is on their People page/.test(leave), `leaving Joined, a staff address on file is no sign-in, said as that (${leave})`);
  await clickText(pq, '.ava-dialog button', /^Keep it Joined$/);
  await pq.close();
}
{
  // Deleted in another tab while the box is open: the press says so, the box closes, and the panel says it's gone
  const del = (await submitApplication(env, { ...base, fullName: 'Dee Leted', email: 'dee@example.org', signature: 'Dee Leted' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  const pd = await open(1280, `/admin/__advisory.html#advisory-applications/${del.id}`, 900);
  await pd.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(pd, '.ava-drawer button', /^Add to Advisory Board$/);
  await pd.waitForSelector('.ava-dialog', { timeout: 4000 });
  await DB.prepare('DELETE FROM advisory_applications WHERE id = ?').bind(del.id).run();
  await clickText(pd, '.ava-dialog button', /^Add them$/);
  await pd.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 8000 }).catch(() => null);
  const after = { dialog: !!(await pd.$('.ava-dialog')), head: await text(pd, '.ava-drawer h2'), callout: await text(pd, '.ava-drawer .ava-callout') };
  ok(!after.dialog && after.head === 'Application not found' && /deleted, maybe in another tab/.test(after.callout), `deleted while the box was open: the box closes and the panel says it's gone (${JSON.stringify(after)})`);
  await pd.close();
}
{
  // Deleted in another tab, then Add to Advisory Board pressed on the panel: the panel says it's gone (as a status does)
  const del = (await submitApplication(env, { ...base, fullName: 'Dot Elsewhere', email: 'dot@example.org', signature: 'Dot Elsewhere' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  const pd = await open(1280, `/admin/__advisory.html#advisory-applications/${del.id}`, 900);
  await pd.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await DB.prepare('DELETE FROM advisory_applications WHERE id = ?').bind(del.id).run();
  await clickText(pd, '.ava-drawer button', /^Add to Advisory Board$/);
  await pd.waitForFunction(() => document.querySelector('.ava-drawer h2')?.textContent.trim() === 'Application not found', { timeout: 6000 }).catch(() => null);
  const after = { dialog: !!(await pd.$('.ava-dialog')), head: await text(pd, '.ava-drawer h2'), callout: await text(pd, '.ava-drawer .ava-callout'), add: !!(await pd.$$eval('.ava-drawer button', (bs) => bs.some((b) => /^Add to Advisory Board$/.test(b.textContent.trim())))) };
  ok(!after.dialog && after.head === 'Application not found' && /deleted, maybe in another tab/.test(after.callout) && !after.add, `deleted elsewhere, then Add pressed: the panel says it's gone, with no Add left (${JSON.stringify(after)})`);
  const keys = await pd.evaluate(() => ({ on: document.activeElement?.matches('.ava-drawer') || false, role: document.querySelector('.ava-drawer .ava-callout')?.getAttribute('role') }));
  ok(keys.on && keys.role === 'alert', `and the keys are on the panel, its words read out, never lost to the page (${JSON.stringify(keys)})`);
  // Closed: its row is off the list, and the count with it
  const allNow = Number((await text(pd, '.ava-strip button.is-all b')) || NaN);
  await pd.keyboard.press('Escape');
  await pd.waitForFunction(() => !document.querySelector('.ava-drawer'), { timeout: 4000 }).catch(() => null);
  const list = { row: await pd.$(`.ava-row[data-id="${del.id}"]`).then((r) => !!r), all: Number((await text(pd, '.ava-strip button.is-all b')) || NaN), rows: (await DB.prepare('SELECT COUNT(*) AS n FROM advisory_applications').first()).n };
  ok(!list.row && list.all === allNow && list.all === list.rows, `and once the panel closes, its row is off the list and the count says so (${JSON.stringify(list)})`);
  await pd.close();
}
{
  // A headshot that won't load: their initials in its circle, never an empty one
  const bh = (await submitApplication(env, { ...base, fullName: 'Bea Broken', email: 'bea.broken@example.org', signature: 'Bea Broken' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  await DB.prepare('UPDATE advisory_applications SET headshot = ? WHERE id = ?').bind(JSON.stringify({ id: 'advisory-applications/broken-headshot/x', url: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/broken-headshot/x/public', width: 900, height: 1200 }), bh.id).run();
  const pb = await open(1280, `/admin/__advisory.html#advisory-applications/${bh.id}`, 900);
  await pb.waitForSelector('.ava-drawer .ava-shot', { timeout: 8000 });
  await sleep(1200);
  const circle = await pb.evaluate(() => { const img = document.querySelector('.ava-shot img'); const span = document.querySelector('.ava-shot span'); return { imgShown: getComputedStyle(img).display !== 'none', initials: span?.textContent, initialsSeen: !!span && span.getBoundingClientRect().width > 0 && getComputedStyle(span).visibility !== 'hidden' }; });
  ok(!circle.imgShown && circle.initials === 'BB' && circle.initialsSeen, `a headshot that won’t load: their initials in its circle (${JSON.stringify(circle)})`);
  // A delete that stopped partway (its headshot gone): said, with no Add to press
  await DB.prepare('UPDATE advisory_applications SET deleting_at = ? WHERE id = ?').bind(new Date().toISOString(), bh.id).run();
  await pb.reload({ waitUntil: 'networkidle0' });
  await pb.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 }); await sleep(300);
  const half = { said: await text(pb, '.ava-drawer .ava-callout'), add: await pb.$$eval('.ava-drawer button', (bs) => bs.some((b) => /^Add to Advisory Board$/.test(b.textContent.trim()))), shot: !!(await pb.$('.ava-shot')) };
  ok(/Deleting this application didn’t finish/.test(half.said) && !half.add && !half.shot, `a delete that stopped partway: the panel says so, with no Add and no headshot (${JSON.stringify(half)})`);
  await pb.close();
}
{
  // Two members with one name: each button and line says which (their organization), never two that read the same
  await onPeople('uma-same', { name: 'Uma Same', group: 'advisory', organization: 'Acme', publishStatus: 'published' });
  await onPeople('uma-same-2', { name: 'Uma Same', group: 'advisory', organization: 'Beta', status: 'alumni', publishStatus: 'published' });
  await DB.prepare("INSERT INTO reveal_board_emails VALUES ('uma-same', 'uma.one@example.org', null)").run();
  await DB.prepare("INSERT INTO reveal_board_emails VALUES ('uma-same-2', 'uma.two@example.org', null)").run();
  const um = (await submitApplication(env, { ...base, fullName: 'Uma Same', email: 'uma.new@example.org', signature: 'Uma Same' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  // (the phone first: the press, at 1280, links them)
  for (const width of [390, 1280]) {
    const pu = await open(width, `/admin/__advisory.html#advisory-applications/${um.id}`, width === 390 ? 844 : 900);
    await pu.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
    await clickText(pu, '.ava-drawer button', /^Add to Advisory Board$/);
    await pu.waitForSelector('.ava-dialog', { timeout: 4000 });
    await sleep(500);
    const box = await pu.evaluate(() => {
      const picks = [...document.querySelectorAll('.ava-dialog .ava-picks button')];
      return { buttons: picks.map((b) => b.textContent.trim()),
        inside: picks.every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }), wide: document.documentElement.scrollWidth > innerWidth + 1,
        // (each label on one line: never a name broken a word to a line)
        tallest: Math.max(...picks.map((b) => Math.round(b.getBoundingClientRect().height))) };
    });
    const its = box.buttons.filter((b) => b.startsWith('It’s'));
    ok(its.length === 2 && new Set(its).size === 2 && its.includes('It’s Uma Same (Acme)') && its.includes('It’s Uma Same (Beta)') && box.inside && !box.wide && box.tallest <= 52,
      `${width}px, two members named Uma Same: each button says which, and they fit (${JSON.stringify(box)})`);
    if (width === 390) await pu.screenshot({ path: join(OUT, 'admin-two-same-name-390.png') });
    if (width === 1280) {
      await clickText(pu, '.ava-dialog .ava-picks button', /^It’s Uma Same \(Beta\)$/);
      await pu.waitForFunction(() => !document.querySelector('.ava-dialog'), { timeout: 8000 }).catch(() => null);
      ok((await getAdvisoryApplication(DB, um.id)).personSlug === 'uma-same-2', 'and the one pressed (Beta, the former member) is the one linked');
    }
    await pu.close();
  }
}
{
  // Four members with one name and long organizations, on a small phone (320 × 568): every choice can be reached, the
  // box scrolling to it, none cut off below the screen
  const orgs = ['Atlanta Community Foundation for Children and Families', 'Georgia Pediatric Healthcare Partners International', 'North Fulton Construction and Restoration Services', 'Southeast Regional Philanthropy Collaborative'];
  for (const [k, org] of orgs.entries()) await onPeople(`tia-twin${k ? `-${k + 1}` : ''}`, { name: 'Tia Twin', group: 'advisory', organization: org, publishStatus: 'published' });
  const tt = (await submitApplication(env, { ...base, fullName: 'Tia Twin', email: 'tia.new@example.org', signature: 'Tia Twin' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  const pt = await open(320, `/admin/__advisory.html#advisory-applications/${tt.id}`, 568);
  await pt.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(pt, '.ava-drawer button', /^Add to Advisory Board$/);
  await pt.waitForSelector('.ava-dialog .ava-picks', { timeout: 4000 });
  await sleep(600);
  const reach = [];
  for (const label of await pt.$$eval('.ava-dialog .ava-picks button', (bs) => bs.map((b) => b.textContent.trim()))) {
    reach.push(await pt.evaluate((l) => {
      const b = [...document.querySelectorAll('.ava-dialog .ava-picks button')].find((x) => x.textContent.trim() === l);
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      const body = document.querySelector('.ava-dialog .kd-dialog__body').getBoundingClientRect();
      const foot = document.querySelector('.ava-dialog .kd-dialog__foot').getBoundingClientRect();
      return { l: l.slice(0, 24), seen: r.top >= body.top - 0.5 && r.bottom <= Math.min(body.bottom, foot.top, innerHeight) + 0.5 && r.right <= innerWidth + 0.5 };
    }, label));
  }
  const room = await pt.evaluate(() => Math.round(document.querySelector('.ava-dialog .kd-dialog__body').getBoundingClientRect().height));
  await pt.screenshot({ path: join(OUT, 'admin-four-same-name-320.png') });
  ok(reach.length === 5 && reach.every((x) => x.seen) && room >= 200, `320 × 568, four members named Tia Twin with long organizations: every choice can be reached in the box, none cut off (${JSON.stringify({ room, reach })})`);
  await pt.close();
}
{
  // Being deleted in another tab: the box says that, never that someone is adding them, and shows the box once it isn't
  const dd = (await submitApplication(env, { ...base, fullName: 'Dot Deleting', email: 'dot.deleting@example.org', signature: 'Dot Deleting' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  await DB.prepare('CREATE TABLE IF NOT EXISTS advisory_add_holds (key TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
  await DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?), (?, ?)').bind(`del:${dd.id}`, Date.now(), `app:${dd.id}`, Date.now()).run();
  const pd = await open(1280, `/admin/__advisory.html#advisory-applications/${dd.id}`, 900);
  await pd.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(pd, '.ava-drawer button', /^Add to Advisory Board$/);
  await pd.waitForSelector('.ava-dialog', { timeout: 4000 });
  const said = await text(pd, '.ava-dialog');
  ok(/^This application is being deleted/.test(said) && /being deleted in another tab, or by someone else/.test(said) && !/Someone is adding/.test(said), `being deleted elsewhere: the box says so, never that someone is adding them (${said})`);
  await DB.prepare('DELETE FROM advisory_add_holds').run(); // (the delete didn't go through)
  const back = await pd.waitForFunction(() => /Add Dot Deleting to the Advisory Board/.test(document.querySelector('.ava-dialog')?.textContent || ''), { timeout: 6000 }).then(() => true).catch(() => false);
  ok(back, `and when it isn't deleted after all, the box shows what Add does (${await text(pd, '.ava-dialog h2')})`);
  await clickText(pd, '.ava-dialog button', /^Cancel$/);
  await pd.close();
}
{
  // Written last name first: the box says the name they're added as, first name first
  const lf = (await submitApplication(env, { ...base, fullName: 'Lastfirst, Lena', email: 'lena.lf@example.org', signature: 'Lastfirst, Lena' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  const pl = await open(1280, `/admin/__advisory.html#advisory-applications/${lf.id}`, 900);
  await pl.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(pl, '.ava-drawer button', /^Add to Advisory Board$/);
  await pl.waitForSelector('.ava-dialog', { timeout: 4000 });
  const said = await text(pl, '.ava-dialog');
  ok(/adds them to People → Advisory as Lena Lastfirst/.test(said), `written last name first: the box says they're added as Lena Lastfirst (${said.slice(0, 160)})`);
  await clickText(pl, '.ava-dialog button', /^Cancel$/);
  await pl.close();
}
{
  // A press from another application adding someone on People this applicant could be: the box names them and waits
  await onPeople('bo-busy', { name: 'Bo Busy', group: 'advisory', publishStatus: 'published' });
  const bb = (await submitApplication(env, { ...base, fullName: 'Bo Busy', email: 'bo.home@example.org', signature: 'Bo Busy' }, { headshot: await headshotOf(GOOD_JPG) })).app;
  await DB.prepare('INSERT INTO advisory_add_holds (key, at) VALUES (?, ?)').bind('slug:bo-busy', Date.now()).run();
  const pb = await open(1280, `/admin/__advisory.html#advisory-applications/${bb.id}`, 900);
  await pb.waitForSelector('.ava-drawer .ava-qa', { timeout: 8000 });
  await clickText(pb, '.ava-drawer button', /^Add to Advisory Board$/);
  await pb.waitForSelector('.ava-dialog', { timeout: 4000 });
  const waiting = await text(pb, '.ava-dialog');
  ok(/Someone is adding Bo Busy right now/.test(waiting) && /Another press is adding Bo Busy, who this could be, to the Advisory Board from another application/.test(waiting), `another application's press adding the person this could be: the box says so and waits (${waiting})`);
  await DB.prepare('DELETE FROM advisory_add_holds').run();
  const moved = await pb.waitForFunction(() => /Is this the same Bo Busy\?/.test(document.querySelector('.ava-dialog')?.textContent || ''), { timeout: 6000 }).then(() => true).catch(() => false);
  ok(moved, `and once it's done, the box asks who this is (${await text(pb, '.ava-dialog h2')})`);
  await clickText(pb, '.ava-dialog button', /^Cancel$/);
  await pb.close();
}

if (DIST) {
  {
    const head = await realFetch(`${SITE}/advisory-board/apply/`);
    ok(head.headers.get('content-security-policy') === applyCsp, 'the Apply page is served with its own strict CSP from the build (inline scripts by hash, workers from blob:)');
  }
  for (const width of [1440, 390]) {
    console.log(`The Apply page, ${width}`);
    const p = await open(width, '/advisory-board/apply/');
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await p.reload({ waitUntil: 'networkidle0' });
    const next = async () => { await p.click('#adv-next'); await sleep(450); };
    /** A step comes a screen at a time: Continue until the one with this question shows (as people do) */
    const reach = async (sel) => {
      for (let i = 0; i < 8; i++) {
        const where = await p.evaluate((x) => { const el = document.querySelector(x); return !el ? 'none' : el.closest('[data-off]') ? 'later' : 'here'; }, sel);
        if (where !== 'later') return;
        const was = `${await text(p, '#adv-title')}|${await text(p, '#adv-part')}`;
        await next();
        if (`${await text(p, '#adv-title')}|${await text(p, '#adv-part')}` === was) throw new Error(`Continue was held up on the way to ${sel}`);
      }
    };
    const onTo = async (title) => { for (let i = 0; i < 8 && (await text(p, '#adv-title')) !== title; i++) await next(); };
    const type = async (id, v) => { await reach(`#adv-${id}`); await p.click(`#adv-${id}`, { clickCount: 3 }); await p.type(`#adv-${id}`, v); };
    const choose = async (name, v) => { await reach(`[data-field="${name}"]`); await p.evaluate((n, val) => document.querySelector(`input[name="${n}"][value="${val}"]`).click(), name, v); };
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'nothing scrolls sideways');
    const hub = await p.$$eval('.adv-hub-row', (els) => els.map((b) => ({ name: b.querySelector('strong').textContent, meta: b.querySelector('.adv-hub-meta').textContent, disabled: b.disabled })));
    ok(hub.map((r) => r.name).join() === 'About you,Your interest,What you’d bring,Commitment,Reference and signature,Review and send', `the overview: the five steps and the review (${hub.map((r) => r.name).join(', ')})`);
    ok(hub.slice(0, 5).every((r) => /^\d+ min$/.test(r.meta)) && !hub[0].disabled && hub.slice(1).every((r) => r.disabled), 'each with its minutes, only the first open before starting');
    const a0 = await axeScan(p, '#application');
    ok(!a0.length, `axe: the overview has no WCAG 2.1 AA problems${a0.length ? ` (${axeText(a0)})` : ''}`);
    await p.click('#adv-go');
    await sleep(400);
    const focus = await p.evaluate(() => ({ on: document.documentElement.classList.contains('adv-focus'), header: !!document.querySelector('#site-header')?.getClientRects().length, segs: document.querySelectorAll('.adv-seg').length, tab: document.title }));
    ok(focus.on && !focus.header && focus.segs === 6, 'Start: the application has the screen to itself, a segment per step');
    ok(/^Step 1 of 6: About you · /.test(focus.tab), `the tab says the step (${focus.tab})`);
    // A name typed, then Save and exit before any Continue: the overview says it's saved and offers to carry on
    await p.type('#adv-fullName', 'Taylor');
    await sleep(700);
    await p.click('#adv-exit');
    await sleep(500);
    ok(/saved on this device/.test(await text(p, '#adv-hub-title')) && /Continue where you left off/.test(await text(p, '#adv-go')), `a name typed, then Save and exit at once: saved, and Continue (${await text(p, '#adv-hub-title')} / ${await text(p, '#adv-go')})`);
    await p.click('#adv-go');
    await sleep(400);
    await p.$eval('#adv-fullName', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
    const a1 = await axeScan(p, '#application');
    ok(!a1.length, `axe: the first step has no WCAG 2.1 AA problems${a1.length ? ` (${axeText(a1)})` : ''}`);
    await next();
    const bad = await p.$$eval('.adv-page[data-step="0"] .adv-field.is-invalid', (els) => els.map((e) => e.dataset.field));
    ok(bad[0] === 'fullName' && bad.every((f) => ['fullName', 'email', 'phone'].includes(f)), `an empty screen marks what’s needed (${bad.join(', ')})`);
    const a2 = await axeScan(p, '#application');
    ok(!a2.length, `axe: with its problems showing too${a2.length ? ` (${axeText(a2)})` : ''}`);
    ok(await p.evaluate(() => document.activeElement?.id) === 'adv-fullName', 'focus on the first');
    await type('fullName', 'Taylor Brooks');
    if (width < 500) {
      // A typo in the address offers the fix: a button big enough for a finger
      await type('email', 'quinn@gmial.com'); await p.keyboard.press('Tab'); await sleep(300);
      const fix = await p.$eval('.adv-mailfix:not([hidden]) button', (b) => Math.round(b.getBoundingClientRect().height)).catch(() => 0);
      ok(fix >= 44, `“Did you mean …?” is at least 44 px tall on a phone (${fix})`);
    }
    await type('email', `taylor${width}@example.org`); await type('phone', '404 555 0199');
    ok(await p.evaluate(() => document.querySelector('[data-field="email"]').parentElement.matches('.adv-pair')), 'email and phone share a row where there is room');
    // The home address: one line, suggestions as it's typed; a pick puts the whole address in it
    await type('address', '3167 Main');
    await p.waitForSelector('#adv-address-suggest:not([hidden]) [role="option"]', { timeout: 4000 }).catch(() => {});
    const sugg = await p.$$eval('#adv-address-suggest [role="option"]', (els) => els.map((e) => e.textContent));
    ok(sugg.length === 1 && await p.$eval('#adv-address', (e) => e.getAttribute('aria-expanded')) === 'true', `the home address suggests as it's typed (${sugg.join(' / ')})`);
    ok(await p.$eval('#adv-address-suggest', (e) => e.hasAttribute('data-google') && getComputedStyle(e, '::after').content.includes('Google Maps')), 'Google’s, with its credit');
    await p.keyboard.press('ArrowDown');
    ok(await p.$eval('#adv-address', (e) => e.getAttribute('aria-activedescendant')) === 'adv-address-suggest-0', 'ArrowDown highlights it');
    await p.keyboard.press('Enter');
    await sleep(300);
    ok(await p.$eval('#adv-address', (e) => e.value) === '3167 Main St, Duluth, GA 30096' && await p.$eval('#adv-address-suggest', (e) => e.hidden), `Enter picks it: the whole address in the line (${await p.$eval('#adv-address', (e) => e.value)})`);
    ok((await text(p, '#adv-title')) === 'About you', 'and stays on the step (Enter picked, it did not move on)');
    await type('company', 'Brooks Law');
    // The headshot: required, checked here as the server checks it, drawn as an upright JPEG, kept on this device
    // (an iPhone's Safari screen: the step splits into more parts, so it's given a moment to before going on)
    if (width < 500) { await p.setViewport({ width: 390, height: 664, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await sleep(600); }
    await reach('#adv-headshot');
    ok(/A clear, recent photo of your face/.test(await text(p, '#adv-headshot-hint')), 'the headshot says what it’s for');
    const state = () => p.$eval('[data-photo="headshot"]', (el) => el.dataset.state);
    const pick = async (file) => { const el = await p.$('#adv-headshot'); await el.uploadFile(file); };
    const settled = (ms = 15000) => p.waitForFunction(() => document.querySelector('[data-photo="headshot"]').dataset.state !== 'busy', { timeout: ms }).catch(() => null);
    if (width < 500) {
      // A photo turned down the first time: its note (under a card laid out without it) brought into sight above Back / Continue
      const before = await p.evaluate(() => ({ err: document.querySelector('#adv-headshot-err').hidden, card: Math.round(document.querySelector('[data-photo="headshot"]').getBoundingClientRect().bottom), bar: Math.round(document.querySelector('.adv-nav').getBoundingClientRect().top) }));
      await pick(SMALL_JPG); await sleep(150); await settled(); await sleep(800);
      await p.screenshot({ path: join(OUT, 'apply-refused-390x664.png') });
      const seen = await p.evaluate(() => { const e = document.querySelector('#adv-headshot-err').getBoundingClientRect(); const el = document.querySelector('#adv-headshot-err'); return { top: Math.round(e.top), bottom: Math.round(e.bottom), h: Math.round(e.height), hidden: el.hidden, shown: el.getClientRects().length, title: document.querySelector('#adv-title')?.textContent, y: scrollY, bar: Math.round(document.querySelector('.adv-nav').getBoundingClientRect().top), text: el.textContent.slice(0, 30) }; });
      ok(before.err && seen.text.startsWith('This photo is too small') && seen.shown > 0 && seen.h > 0 && seen.top >= 0 && seen.bottom <= seen.bar, `on an iPhone’s screen, a refused photo’s note is in sight above Back / Continue (before ${JSON.stringify(before)}, after ${JSON.stringify(seen)})`);
      await p.setViewport({ width: 390, height: 900, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await sleep(250);
    }
    await p.click('#adv-next'); await sleep(450);
    // (on the phone a photo was just turned down: its own reason stays, never "Please add a headshot." over it)
    ok((width < 500 ? /^This photo is too small \(300 × 300 pixels\)/.test(await text(p, '#adv-headshot-err')) : (await text(p, '#adv-headshot-err')) === 'Please add a headshot.') && (await text(p, '#adv-title')) === 'About you',
      `Continue without one asks for it (or keeps the reason the last one was turned down), and stays (${await text(p, '#adv-headshot-err')})`);
    await pick(SMALL_JPG); await sleep(150); await settled();
    ok((await text(p, '#adv-headshot-err')) === 'This photo is too small (300 × 300 pixels). Please choose a larger one, at least 440 pixels on each side.' && await state() === 'empty', `one too small says its size and the least (${await text(p, '#adv-headshot-err')})`);
    await sleep(120);
    ok(/This photo is too small \(300 × 300 pixels\)/.test(await text(p, '#adv-live')), 'and a screen reader hears it');
    if (width > 500) {
      // A wide photo is judged on what it is, not on a shrunken copy (6000 × 900: its short side is 900)
      await pick(WIDE_JPG); await sleep(150); await settled();
      const wide = await p.evaluate(() => ({ state: document.querySelector('[data-photo="headshot"]').dataset.state, status: document.getElementById('adv-headshot-status').textContent }));
      ok(wide.state === 'done' && /^Added\./.test(wide.status), `a wide photo is taken (${JSON.stringify(wide)})`);
      await p.click('[data-photo-remove]'); await sleep(200);
      // A photo cut off partway
      await pick(CUT_JPG); await sleep(150); await settled();
      ok((await text(p, '#adv-headshot-err')) === 'That photo didn’t come through whole. Please choose it again, or another one.', `a photo cut off partway is turned down (${await text(p, '#adv-headshot-err')})`);
      // A photo dropped just off the card: nothing happens (the browser never opens it in place of the application)
      const stray = await p.evaluate(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array([0xFF, 0xD8, 0xFF])], 'x.jpg', { type: 'image/jpeg' }));
        const at = document.querySelector('[data-field="headshot"] .adv-label');
        const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
        at.dispatchEvent(over);
        const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
        at.dispatchEvent(drop);
        return { over: over.defaultPrevented, drop: drop.defaultPrevented, state: document.querySelector('[data-photo="headshot"]').dataset.state };
      });
      ok(stray.over && stray.drop && stray.state === 'empty', `a photo dropped just off the card is caught and ignored (${JSON.stringify(stray)})`);
    }
    await pick(FAKE_JPG); await sleep(150); await settled();
    ok(/That file isn’t a photo we can use/.test(await text(p, '#adv-headshot-err')), 'a file that only says it’s a photo is turned away');
    await p.click('#adv-next'); await sleep(450);
    ok((await text(p, '#adv-title')) === 'About you', 'and Continue still waits for one');
    const useHeic = width > 500 && heicMade;
    await pick(useHeic ? HEIC : GOOD_JPG); await sleep(150); await settled(45000);
    const got = await p.evaluate(() => { const box = document.querySelector('[data-photo="headshot"]'); const img = box.querySelector('.adv-photo-img'); return { state: box.dataset.state, src: img.getAttribute('src') || '', w: img.naturalWidth, status: document.getElementById('adv-headshot-status').textContent.trim(), err: !document.getElementById('adv-headshot-err').hidden, pick: document.querySelector('[data-photo-pick]').textContent, remove: !document.querySelector('[data-photo-remove]').hidden }; });
    ok(got.state === 'done' && got.src.startsWith('blob:') && got.w > 0 && got.status === 'Added.' && !got.err && got.pick === 'Choose a different photo' && got.remove, `${useHeic ? 'an iPhone photo (HEIC), drawn as a JPEG under the page’s own strict CSP' : 'a good photo'}: in the circle, "Added.", the note gone (${JSON.stringify(got)})`);
    await sleep(400); // (its colours ease for .15s)
    const look = await p.evaluate(() => {
      const field = document.querySelector('[data-field="headshot"]');
      const box = field.querySelector('[data-photo]');
      const r = box.getBoundingClientRect();
      const out = [...box.querySelectorAll('*')].filter((el) => el.getClientRects().length).map((el) => ({ el: el.className || el.tagName, r: el.getBoundingClientRect() })).filter((x) => x.r.right > r.right + 0.5 || x.r.left < r.left - 0.5).map((x) => x.el);
      return { invalid: field.classList.contains('is-invalid'), over: box.classList.contains('is-over'), border: getComputedStyle(box).borderTopColor, out };
    });
    ok(!look.invalid && !look.over && look.border !== 'rgb(138, 114, 0)' && !look.out.length, `the card looks done, not flagged, and everything in it fits inside it (${JSON.stringify(look)})`);
    await p.screenshot({ path: join(OUT, `apply-headshot-${width}.png`) });
    if (width > 500) {
      // One turned down while a good one is in: said beside it, and gone once they've left the step and come back
      await pick(SMALL_JPG); await sleep(150); await settled();
      ok(/Your earlier headshot is still here/.test(await text(p, '#adv-headshot-status')) && await state() === 'done', 'one turned down keeps the earlier headshot, and says so');
      await onTo('Your interest');
      await p.click('#adv-back'); await sleep(500);
      await reach('#adv-headshot');
      ok(!/still here|too small/.test(await text(p, '#adv-headshot-status')) && await state() === 'done', `back on the step, that warning is gone and the headshot is there (${await text(p, '#adv-headshot-status')})`);
    }
    if (width < 500) {
      await p.click('[data-photo-remove]'); await sleep(300);
      ok(await state() === 'empty' && (await text(p, '#adv-headshot-status')) === 'Photo removed.' && await p.evaluate(() => document.activeElement?.id) === 'adv-headshot', 'Remove takes it off, says so, and leaves the keys on the picker');
      await pick(GOOD_JPG); await sleep(150); await settled();
      ok(await state() === 'done', 'and another goes in');
    }
    const a1b = await axeScan(p, '#application');
    ok(!a1b.length, `axe: with a headshot in, no WCAG 2.1 AA problems${a1b.length ? ` (${axeText(a1b)})` : ''}`);
    await onTo('Your interest');
    const into = await p.evaluate(() => ({ tag: document.activeElement?.tagName, first: document.activeElement === [...document.querySelectorAll('.adv-page:not([hidden]) [data-field]')].find((f) => f.getClientRects().length && !f.closest('[data-off]'))?.querySelector('input, textarea') }));
    await sleep(150);
    const heard = await p.$eval('#adv-live', (e) => e.textContent);
    if (width < 500) ok(into.tag === 'H2', 'on a touch screen each step starts at its heading (no keyboard sliding up over the questions)');
    else ok(['TEXTAREA', 'INPUT'].includes(into.tag) && into.first && /^Step \d of \d: Your interest$/.test(heard), `on a computer each step starts in its first box, and a screen reader hears the step ("${heard}")`);
    if (width < 500) ok(!/too small|Getting your photo ready|Photo removed/.test(heard), `nothing said about the last step is left for a screen reader beside the next one’s buttons (${heard})`);
    await type('heardFrom', 'LinkedIn'); await type('why', 'To help.'); await type('connection', 'Neighbors.');
    ok(!(await visible(p, '[data-field="involvedHow"]')), 'a follow-up waits');
    await choose('involved', 'Yes'); await sleep(80);
    // On its question's screen when both fit there; else the screen after (no room held for it while it waits)
    const beside = await visible(p, '[data-field="involvedHow"]');
    const partNow = await text(p, '#adv-part');
    if (!beside) { await p.click('#adv-next'); await sleep(700); }
    ok(await visible(p, '[data-field="involvedHow"]') && (beside || /^Part (\d) of \1$/.test(await text(p, '#adv-part'))), `and shows after a Yes: beside it when both fit, else on the next screen (${beside ? 'beside it' : `${partNow}, then ${await text(p, '#adv-part')}`})`);
    await type('involvedHow', 'Golf tournament.');
    await sleep(500);
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    ok(await p.evaluate(() => document.documentElement.classList.contains('adv-focus')) && (await text(p, '#adv-title')) === 'Your interest' && await p.$eval('#adv-why', (el) => el.value) === 'To help.', 'a reload comes back to the same step, answers kept');
    ok(await state() === 'done' && await p.$eval('[data-photo="headshot"] .adv-photo-img', (img) => img.getAttribute('src')?.startsWith('blob:')), 'and the headshot with them (kept on this device)');
    // Two tabs of it: what one saves comes into the other, and neither's save wipes the other's answers
    const p2 = await open(width, '/advisory-board/apply/');
    await p2.click('#adv-go');
    await sleep(500);
    const say = (pg, id, v) => pg.evaluate((i, val) => { const el = document.getElementById(i); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
    await say(p2, 'adv-connection', 'Neighbors, and friends.');
    await sleep(900);
    ok(await p.$eval('#adv-connection', (el) => el.value) === 'Neighbors, and friends.', 'an answer saved in another tab comes into this one');
    await say(p, 'adv-why', 'To help families.');
    await sleep(900);
    const both = await p2.evaluate(() => JSON.parse(localStorage.getItem('soard-advisory-application')).answers);
    ok(both.why === 'To help families.' && both.connection === 'Neighbors, and friends.' && await p2.$eval('#adv-why', (el) => el.value) === 'To help families.', "and this tab's save keeps the other's answer (and shows there)");
    await p2.close();
    await onTo('What you’d bring');
    // A long answer: its count once it's near what the box holds
    await reach('#adv-strengths');
    const max = await p.$eval('#adv-strengths', (el) => { el.value = 'x'.repeat(el.maxLength - 100); el.dispatchEvent(new Event('input', { bubbles: true })); return el.maxLength; });
    const count = await p.$eval('[data-field="strengths"] .adv-count', (e) => (e.hidden ? '' : e.textContent));
    ok(count === `${(max - 100).toLocaleString('en-US')} of ${max.toLocaleString('en-US')} characters`, `a long answer shows its count near what the box holds ("${count}")`);
    await type('strengths', 'Law.'); await type('fundraising', 'A table at the gala.'); await choose('introductions', 'Yes'); await choose('networks', 'No'); await choose('conflict', 'No');
    const part = await text(p, '#adv-part');
    const [at, of] = (part.match(/\d+/g) || []).map(Number);
    ok(!part || at === of, `with No on conflicts, its screen is the step's last part (no part for the follow-up nobody asked for: "${part}")`);
    await onTo('Commitment');
    // A double click on Back counts once; a reload then stays where they went back to
    await p.click('#adv-back', { count: 2 });
    await sleep(700);
    ok((await text(p, '#adv-title')) === 'What you’d bring', 'a double click on Back goes back one screen');
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    ok((await text(p, '#adv-title')) === 'What you’d bring', 'a reload after going back stays there');
    await next();
    ok((await text(p, '#adv-title')) === 'Commitment', 'and Continue goes on');
    await choose('hostEvent', 'Yes'); await choose('meetings', 'Yes'); await choose('ambassador', 'Yes');
    await onTo('Reference and signature');
    await type('refName', 'Pat Kim'); await type('refRelationship', 'Colleague'); await type('refEmail', 'pat@example.org');
    await reach('#adv-acknowledge'); await p.click('#adv-acknowledge'); await type('signature', 'Taylor Brooks');
    ok(/Review my answers/.test(await text(p, '#adv-next')), 'the last step goes to a review');
    await next();
    ok((await text(p, '#adv-title')) === 'Review and send' && /Send my application/.test(await text(p, '#adv-next')), 'the review sends');
    const rows = await p.$$eval('.adv-review-section', (els) => els.map((e) => ({ open: e.hasAttribute('data-open'), sum: e.querySelector('.adv-review-sum').textContent })));
    ok(rows.length === 5 && rows.every((r) => !r.open) && /Taylor Brooks/.test(rows[0].sum), `a row per step with its answers in a line (${rows[0]?.sum})`);
    const rv = await p.$eval('.adv-review-section[data-step="0"] .adv-review-photo img', (img) => ({ src: img.getAttribute('src'), alt: img.alt, w: img.naturalWidth })).catch(() => null);
    ok(rv && rv.src.startsWith('blob:') && rv.alt === 'Your headshot' && rv.w > 0, `the review shows the headshot itself (${JSON.stringify(rv)})`);
    ok(!/added/i.test(rows[0].sum), 'and its line of answers doesn’t say "added"');
    const a4 = await axeScan(p, '#application');
    ok(!a4.length, `axe: the review has no problems${a4.length ? ` (${axeText(a4)})` : ''}`);
    await p.click('.adv-review-section[data-step="1"] .adv-linkbtn[data-edit]');
    await sleep(450);
    ok((await text(p, '#adv-title')) === 'Your interest', 'Edit goes to the step');
    // A whole step from the review is walked through: Continue on its first screens, "Back to review" on its last
    for (let i = 0; i < 4 && !/Back to review/.test(await text(p, '#adv-next')); i++) await next();
    ok((await text(p, '#adv-title')) === 'Your interest' && /Back to review/.test(await text(p, '#adv-next')), 'its last screen says "Back to review"');
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    ok((await text(p, '#adv-title')) === 'Your interest' && /Back to review/.test(await text(p, '#adv-next')), 'a reload keeps "Back to review"');
    await next();
    ok((await text(p, '#adv-title')) === 'Review and send', 'back to review');
    // Every step done, a few screens back to read something, then Save and exit: "Review and send" opens the review
    for (let i = 0; i < 3; i++) { await p.click('#adv-back'); await sleep(450); }
    const readAgain = await text(p, '#adv-title');
    await p.click('#adv-exit');
    await sleep(400);
    ok((await text(p, '#adv-go')) === 'Review and send', `every step done: the overview offers "Review and send" (${await text(p, '#adv-go')})`);
    await p.click('#adv-go');
    await sleep(500);
    ok((await text(p, '#adv-title')) === 'Review and send', `and it opens the review, not the screen they left (${readAgain})`);
    await sleep(500);
    // A test fills it in seconds: say they took their time (the server drops anything faster than a person). On the
    // phone, a clock that was an hour fast when they started and is right now: started "in the future", never dropped
    await p.evaluate((fast) => { const k = 'soard-advisory-application'; const s = JSON.parse(localStorage.getItem(k)); s.startedAt = fast ? Date.now() + 3600000 : Date.now() - 900000; localStorage.setItem(k, JSON.stringify(s)); }, width < 500);
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    if (width > 500) {
      // The server turning the photo down: back to the photo, its reason under it, and it stays once the keys move on
      refuseOnce = true;
      await p.click('#adv-next');
      await p.waitForFunction(() => /couldn’t use that photo/.test(document.querySelector('#adv-headshot-err')?.textContent || ''), { timeout: 8000 }).catch(() => null);
      const said = await text(p, '#adv-headshot-err');
      await sleep(150);
      ok((await text(p, '#adv-live')) === said, `and a screen reader hears that reason, never "a few answers need a look" (${await text(p, '#adv-live')})`);
      await p.keyboard.press('Tab'); await sleep(250); await p.keyboard.press('Tab'); await sleep(250);
      ok(/We couldn’t use that photo/.test(said) && (await text(p, '#adv-headshot-err')) === said, `a photo the server turned down: its reason stays after Tab (${said} → ${await text(p, '#adv-headshot-err')})`);
      await p.goBack({ timeout: 3000 }).catch(() => null); await sleep(700);
      ok((await text(p, '#adv-title')) === 'Review and send', `the browser’s Back from there returns to the review (${await text(p, '#adv-title')})`);
      await p.goForward({ timeout: 3000 }).catch(() => null); await sleep(700);
      await reach('#adv-headshot');
      const pick2 = await p.$('#adv-headshot'); await pick2.uploadFile(useHeic ? HEIC : GOOD_JPG); // (the same photo again)
      await p.waitForFunction(() => document.querySelector('[data-photo="headshot"]').dataset.state === 'done', { timeout: 45000 }).catch(() => null);
      for (let i = 0; i < 6 && (await text(p, '#adv-title')) !== 'Review and send'; i++) { await p.click('#adv-next'); await sleep(500); }
      // A reply that isn't the site's own (a gateway's error page): it may have arrived, said so, and the warning kept
      gatewayOnce = true;
      await p.click('#adv-next');
      await p.waitForFunction(() => !document.querySelector('#adv-send-error').hidden, { timeout: 8000 }).catch(() => null);
      ok(/We couldn’t tell whether that arrived/.test(await text(p, '#adv-send-error')), `a gateway’s error page: “we couldn’t tell whether that arrived”, never “didn’t send” (${await text(p, '#adv-send-error')})`);
      await p.reload({ waitUntil: 'networkidle0' });
      await sleep(400);
      ok(/This may already have been sent/.test(await text(p, '#adv-send-error')), 'and after a reload the review still says it may already have been sent');
      limitOnce = true;
      await p.click('#adv-next');
      await p.waitForFunction(() => /Too many attempts/.test(document.querySelector('#adv-send-error')?.textContent || ''), { timeout: 8000 }).catch(() => null);
      await p.reload({ waitUntil: 'networkidle0' }); await sleep(400);
      ok(/This may already have been sent/.test(await text(p, '#adv-send-error')), `a later send turned away ("too many attempts") never wipes "may already have been sent" (${await text(p, '#adv-send-error')})`);
    }
    await p.click('#adv-next');
    await p.waitForSelector('#adv-done:not([hidden])', { timeout: 8000 }).catch(() => null);
    ok(/Thank you, Taylor\./.test(await text(p, '#adv-done h2')), 'sent: thanks by name');
    ok(await p.$$eval('.adv-seg', (els) => els.every((li) => li.dataset.state === 'done')), 'every step’s segment is full, the review’s too');
    const a5 = await axeScan(p, '#application');
    ok(!a5.length, `axe: the thank-you has no problems${a5.length ? ` (${axeText(a5)})` : ''}`);
    ok(await p.evaluate(() => localStorage.getItem('soard-advisory-application')) === null, 'the device forgets the answers');
    ok((await listAdvisoryApplications(DB)).some((a) => a.email === `taylor${width}@example.org`), `stored, for the admin${width < 500 ? ' (its clock an hour fast when it was started)' : ''}`);
    {
      const sentWith = JSON.parse(await p.evaluate(() => window.__lastPayload || '{}'));
      ok(typeof sentWith.elapsedMs === 'number' && (width < 500 ? sentWith.elapsedMs < 0 : sentWith.elapsedMs > 0) && sentWith.photoSeq >= 1 && sentWith.website === '',
        `the page sends how long it took by its own clock (as it is), the pick’s number, and an empty trap (${JSON.stringify({ elapsedMs: sentWith.elapsedMs, photoSeq: sentWith.photoSeq, website: sentWith.website })})`);
    }
    {
      const stored = (await listAdvisoryApplications(DB)).find((a) => a.email === `taylor${width}@example.org`);
      const up = sent.images.find((i) => stored?.headshot?.url.includes(`/${i.id}/`));
      const [w, h] = useHeic ? [1500, 2000] : [900, 1200];
      ok(stored?.headshot?.width === w && stored.headshot.height === h && up?.meta.format === 'jpeg' && up.meta.width === w && up.meta.height === h, `sent as the JPEG the page drew, its size kept (${JSON.stringify(stored?.headshot)}, ${up?.meta.format} ${up?.meta.width}×${up?.meta.height})`);
      const kept = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('soard-advisory', 1); r.onsuccess = () => { try { const q = r.result.transaction('photos', 'readonly').objectStore('photos').get('headshot'); q.onsuccess = () => res(!!q.result); q.onerror = () => res('error'); } catch { res(false); } }; r.onerror = () => res('error'); }));
      ok(kept === false, `and the device forgets the photo too (${kept})`);
    }
    await p.screenshot({ path: join(OUT, `apply-done-${width}.png`) });
    // Back on the page later: this device says it went (not a fresh "Start the application")
    await p.evaluate(() => sessionStorage.clear());
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    const back = { note: await text(p, '[data-adv-hero-note]'), hub: await text(p, '#adv-hub-title'), go: await text(p, '[data-adv-cta]') };
    ok(/^We received your application on /.test(back.note) && back.hub === 'We received your application' && back.go === 'Start a new application', `a reload after sending says it arrived (${JSON.stringify(back)})`);
    await p.evaluate(() => localStorage.removeItem('soard-advisory-sent'));
    await p.close();
  }
  const copies = sent.emails.filter((e) => e.subject === 'We have your Advisory Board application' && /Taylor/.test(e.html));
  const staff = sent.emails.filter((e) => e.subject === 'New Advisory Board application: Taylor Brooks');
  ok(copies.length === 2 && staff.length === 6 && staff.every((e) => /^(peter|linzi|lee)@example\.org$/.test(e.to[0])) && sent.slack.length === 2,
    `each one: the applicant’s copy, the staff email to the two saved above and the committee’s Lee Lead, and Slack (${copies.length}, ${staff.length}, ${sent.slack.length})`);
  // Start over in one tab, another tab open on the same answers: that tab starts over too (it wrote them back before)
  {
    const a = await open(1280, '/advisory-board/apply/', 720);
    await a.evaluate(() => { localStorage.removeItem('soard-advisory-application'); localStorage.removeItem('soard-advisory-sent'); sessionStorage.clear(); });
    await a.reload({ waitUntil: 'networkidle0' });
    await a.click('#adv-go');
    await sleep(700);
    await a.type('#adv-fullName', 'Morgan Tabs');
    await (await a.$('#adv-headshot')).uploadFile(GOOD_JPG);
    await a.waitForFunction(() => document.querySelector('[data-photo="headshot"]').dataset.state === 'done', { timeout: 15000 }).catch(() => null);
    await sleep(900);
    const b = await open(1280, '/advisory-board/apply/', 720);
    await b.click('#adv-go');
    await sleep(700);
    ok(await b.$eval('#adv-fullName', (e) => e.value) === 'Morgan Tabs', 'a second tab carries on with the first’s answers');
    ok(await b.$eval('[data-photo="headshot"]', (e) => e.dataset.state) === 'done', 'and its headshot');
    await a.click('#adv-exit');
    await sleep(600);
    await a.click('#adv-start-over');
    await sleep(150);
    await a.click('#adv-start-over');
    await sleep(800);
    const there = { lead: await text(b, '#adv-hub-lead'), focus: await b.evaluate(() => document.documentElement.classList.contains('adv-focus')), name: await b.$eval('#adv-fullName', (e) => e.value) };
    await sleep(900);
    const kept = await b.evaluate(() => localStorage.getItem('soard-advisory-application'));
    ok(/Start over was pressed in another tab/.test(there.lead) && !there.focus && !there.name && !kept, `Start over in one tab: the other starts over too, says why, and never saves its answers back (${JSON.stringify(there)}, kept ${kept ? 'yes' : 'no'})`);
    ok(await b.$eval('[data-photo="headshot"]', (e) => e.dataset.state) === 'empty', 'its headshot goes too');
    await a.close();
    await b.close();
  }
  {
    // A browser whose IndexedDB never answers (a Safari fault): the form still moves, and a photo says it can't be kept
    const h = await browser.newPage();
    await h.setViewport({ width: 1280, height: 900 });
    await h.setRequestInterception(true);
    h.on('request', async (req) => { try { if (await answer(req, '198.51.100.77') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    await h.evaluateOnNewDocument(() => { localStorage.clear(); indexedDB.open = () => ({}); });
    await h.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
    await h.click('#adv-go'); await sleep(500);
    for (const [id, v] of [['fullName', 'Hana Hung'], ['email', 'hana@example.org'], ['phone', '404 555 0123']]) { await h.click(`#adv-${id}`); await h.type(`#adv-${id}`, v); }
    const part = await text(h, '#adv-part');
    const pressed = Date.now();
    await h.click('#adv-next');
    const moved = await h.waitForFunction((was) => document.querySelector('#adv-part')?.textContent.trim() !== was, { timeout: 9000 }, part).then(() => true).catch(() => false);
    const took = Date.now() - pressed;
    ok(moved && took < 1500, `IndexedDB that never answers doesn’t hold the form: Continue on name and email moves at once, never waiting on the photo (${part} → ${await text(h, '#adv-part')}, ${took} ms)`);
    await h.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
    for (let i = 0; i < 6 && !(await h.$('#adv-headshot:not([data-off] *)')); i++) { const el = await h.evaluate(() => !document.querySelector('[data-field="headshot"]').closest('[data-off]')); if (el) break; await h.click('#adv-next'); await sleep(500); }
    {
      await h.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
      await sleep(450); // (past the page's double-tap guard, 350 ms after a move)
      await h.evaluate(() => { window.__heard = []; new MutationObserver(() => window.__heard.push(document.getElementById('adv-live').textContent)).observe(document.getElementById('adv-live'), { childList: true, characterData: true, subtree: true }); });
      const t0 = Date.now();
      await h.click('#adv-next');
      await h.waitForFunction(() => /Please add a headshot/.test(document.getElementById('adv-headshot-err')?.textContent || ''), { timeout: 8000 }).catch(() => null);
      const took = Date.now() - t0;
      const heard = await h.evaluate(() => window.__heard.filter(Boolean));
      ok(took < 1500 && !heard.some((x) => /Getting your photo ready|Checking this device/.test(x)), `no photo ever picked here, IndexedDB that never answers: Continue says "Please add a headshot." at once, never "getting your photo ready" (${took} ms, heard ${JSON.stringify(heard)})`);
    }
    const input = await h.$('#adv-headshot');
    const pickAt = Math.round(await h.evaluate(() => performance.now()));
    await input.uploadFile(GOOD_JPG);
    await h.waitForFunction(() => /^Added\./.test(document.getElementById('adv-headshot-status').textContent), { timeout: 15000 }).catch(() => null);
    // Save and exit straight away, while this browser is still failing to keep it: once it gives up (its first
    // unanswered request, keeping the photo just picked: nothing was looked for at the start, no photo ever having
    // been picked here), the overview and the photo's note both say so
    await h.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
    const opened = await h.evaluate(() => performance.now());
    await h.evaluate(() => { const t = document.getElementById('adv-hub-title'); window.__titles = [t.textContent]; new MutationObserver(() => window.__titles.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
    await h.click('#adv-exit');
    const said = await h.waitForFunction(() => /can’t keep your photo/.test(document.getElementById('adv-hub-title').textContent), { timeout: 7000 }).then(() => true).catch(() => false);
    const when = Math.round(await h.evaluate(() => performance.now()));
    ok(said && when - pickAt < 5000, `and the overview says the photo can’t be kept as soon as this browser fails to keep it, 4 seconds after the photo went in (${await text(h, '#adv-hub-title')}, ${when - pickAt} ms after it was picked, Save and exit at ${Math.round(opened - pickAt)} ms)`);
    {
      // (meanwhile, never "saved": it says it's saving, and what it then says is heard, the heading having been read)
      await sleep(200);
      const titles = [...new Set(await h.evaluate(() => window.__titles))];
      const heard = await text(h, '#adv-hub-live');
      ok(titles.includes('Saving your application on this device') && !titles.includes('Your application is saved on this device') && /can’t keep your photo/.test(heard),
        `while it tries, the overview says it’s saving, never that it’s saved, and what it says then is heard (${JSON.stringify({ titles, heard })})`);
    }
    ok(/can’t keep it if the page closes/.test(await text(h, '#adv-headshot-status')), `and the photo’s own note says so too (${await text(h, '#adv-headshot-status')})`);
    await h.close();
  }
  {
    // IndexedDB that never answers, with a photo picked here before (its number kept): straight to the review, the photo
    // is said to be looked for, never "Added" with none there; once this browser gives up, it needs an answer
    const r = await browser.newPage();
    await r.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await r.setRequestInterception(true);
    r.on('request', async (req) => { try { if (await answer(req, '198.51.100.71') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    await r.evaluateOnNewDocument((answers) => {
      indexedDB.open = () => ({});
      localStorage.clear();
      localStorage.setItem('soard-advisory-application', JSON.stringify({ answers, step: 5, screen: 0, field: null, furthest: 5, startedAt: Date.now() - 900000, session: crypto.randomUUID(), savedAt: Date.now() }));
      localStorage.setItem('soard-advisory-photo-seq', '3');
    }, { ...base, fullName: 'Rae View', email: 'rae@example.org', signature: 'Rae View' });
    await r.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'domcontentloaded' });
    await r.waitForFunction(() => document.querySelector('[data-adv]')?.dataset.ready === 'go', { timeout: 10000 }).catch(() => null);
    await r.click('#adv-go');
    await r.waitForFunction(() => document.getElementById('adv-title')?.textContent.trim() === 'Review and send', { timeout: 5000 }).catch(() => null);
    await r.evaluate(() => { const rv = document.getElementById('adv-review'); window.__rv = [rv.textContent]; new MutationObserver(() => window.__rv.push(rv.textContent)).observe(rv, { childList: true, subtree: true, characterData: true }); });
    const first = await r.evaluate(() => { const sec = document.querySelector('.adv-review-section[data-step="0"]'); return { at: Math.round(performance.now()), checking: sec?.dataset.checking, mark: sec?.querySelector('.adv-mark')?.textContent, sum: sec?.querySelector('.adv-review-sum')?.textContent, row: [...(sec?.querySelectorAll('.adv-review-item dd') || [])].map((d) => d.textContent).find((t) => /Checking|Added/.test(t)) }; });
    await r.waitForFunction(() => document.querySelector('.adv-review-section[data-step="0"]')?.dataset.missing === '1', { timeout: 8000 }).catch(() => null);
    const later = await r.evaluate(() => { const sec = document.querySelector('.adv-review-section[data-step="0"]'); return { missing: sec?.dataset.missing, sum: sec?.querySelector('.adv-review-sum')?.textContent }; });
    const everAdded = await r.evaluate(() => window.__rv.some((t) => /\bAdded\b/.test(t)));
    ok(first.at < 3500 && first.checking === '1' && first.mark === '…' && first.sum === 'Checking this device for your photo' && first.row === 'Checking this device for it' && !everAdded && later.missing === '1' && later.sum === 'Needs an answer',
      `a photo still being looked for on the review: said so, never "Added" with none there, then "Needs an answer" once this browser gives up (${JSON.stringify({ first, later, everAdded })})`);
    await r.close();
  }
  {
    // Round eleven, IndexedDB that never answers: a photo in, a file that isn't one turned down, Save and exit while the
    // first is still being kept: "Saving…" always ends, in what's so, heard; and the bar across the top never says the
    // photo's saved when this browser couldn't keep it
    const hungPage = async (ip) => {
      const x = await browser.newPage();
      await x.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await x.setRequestInterception(true);
      x.on('request', async (req) => { try { if (await answer(req, ip) === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
      await x.evaluateOnNewDocument(() => { indexedDB.open = () => ({}); localStorage.clear(); localStorage.setItem('soard-advisory-application', JSON.stringify({ answers: { fullName: 'Hung Hope', email: 'hung.hope@example.org', phone: '404 555 0175' }, step: 0, screen: 0, field: null, furthest: 0, startedAt: Date.now() - 60000, session: crypto.randomUUID(), savedAt: Date.now() })); });
      await x.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
      await x.click('#adv-go'); await sleep(700);
      for (let i = 0; i < 6 && await x.evaluate(() => !!document.querySelector('[data-field="headshot"]').closest('[data-off]')); i++) { await x.click('#adv-next'); await sleep(700); }
      await x.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
      await sleep(400);
      return x;
    };
    {
      const x = await hungPage('198.51.100.76');
      const input = await x.$('#adv-headshot');
      await input.uploadFile(GOOD_JPG);
      await x.waitForFunction(() => /^Added\./.test(document.getElementById('adv-headshot-status').textContent), { timeout: 10000 }).catch(() => null);
      await input.uploadFile(FAKE_JPG); await sleep(300);
      await x.evaluate(() => { const t = document.getElementById('adv-hub-title'); window.__titles = []; new MutationObserver(() => window.__titles.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
      await x.click('#adv-exit');
      const ended = await x.waitForFunction(() => /can’t keep your photo/.test(document.getElementById('adv-hub-title').textContent), { timeout: 9000 }).then(() => true).catch(() => false);
      await sleep(300);
      const out = { ended, titles: [...new Set(await x.evaluate(() => window.__titles))], heard: await text(x, '#adv-hub-live') };
      ok(out.ended && /can’t keep your photo/.test(out.heard), `a photo, then a file turned down, then Save and exit while the first is being kept: "Saving…" ends in what's so, heard (${JSON.stringify(out)})`);
      await x.close();
    }
    {
      const x = await hungPage('198.51.100.77');
      await (await x.$('#adv-headshot')).uploadFile(GOOD_JPG);
      await x.waitForFunction(() => /can’t keep it/.test(document.getElementById('adv-headshot-status').textContent), { timeout: 10000 }).catch(() => null);
      await x.waitForFunction(() => document.getElementById('adv-saved').textContent === 'Saved on this device, except your photo', { timeout: 3000 }).catch(() => null);
      const bar = await text(x, '#adv-saved');
      ok(bar === 'Saved on this device, except your photo', `the bar across the top never says the photo is saved when this browser can't keep it (${bar})`);
      await x.close();
    }
  }
  {
    // Round eleven, IndexedDB that never answers, a photo kept before: a reload straight into the review shows the
    // application's screen from the first moment the page's script runs, never the page and its hero meanwhile
    const r = await browser.newPage();
    await r.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await r.setRequestInterception(true);
    r.on('request', async (req) => { try { if (await answer(req, '198.51.100.78') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    await r.evaluateOnNewDocument((answers) => {
      indexedDB.open = () => ({});
      localStorage.clear();
      localStorage.setItem('soard-advisory-application', JSON.stringify({ answers, step: 5, screen: 0, field: null, furthest: 5, startedAt: Date.now() - 900000, session: crypto.randomUUID(), savedAt: Date.now() }));
      localStorage.setItem('soard-advisory-photo-seq', '1');
      sessionStorage.setItem('soard-advisory-focus', '1');
      window.__hubAfter = 0;
      const tick = () => { const root = document.querySelector('[data-adv]'); const hub = document.getElementById('adv-hub'); if (root?.dataset.ready === 'go' && hub && getComputedStyle(hub).display !== 'none') window.__hubAfter++; if (performance.now() < 2000) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, { ...base, fullName: 'Wake Up', email: 'wake.up@example.org', signature: 'Wake Up' });
    await r.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const seen = await r.evaluate(() => ({ hubAfter: window.__hubAfter, title: document.getElementById('adv-title')?.textContent.trim() }));
    ok(seen.hubAfter === 0 && seen.title === 'Review and send', `a reload straight into the review, this device slow to say: the application's screen at once, never the page and its hero meanwhile (${JSON.stringify(seen)})`);
    await r.close();
  }
  {
    // A reload straight back into the review, a photo kept on this device (a browser that answers): the review comes up
    // saying it's there, never "checking" for an instant
    const r = await browser.newPage();
    await r.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await r.setRequestInterception(true);
    r.on('request', async (req) => { try { if (await answer(req, '198.51.100.73') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    // (watched from the document's first moment: the page's script builds the review before DOMContentLoaded)
    await r.evaluateOnNewDocument(() => { window.__rv = []; new MutationObserver(() => { const rv = document.getElementById('adv-review'); if (rv) window.__rv.push(rv.textContent); }).observe(document, { childList: true, subtree: true, characterData: true }); });
    await r.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
    await r.evaluate(async (answers, b64) => {
      localStorage.clear();
      await new Promise((res) => { const d = indexedDB.deleteDatabase('soard-advisory'); d.onsuccess = d.onerror = d.onblocked = () => res(); });
      localStorage.setItem('soard-advisory-application', JSON.stringify({ answers, step: 5, screen: 0, field: null, furthest: 5, startedAt: Date.now() - 900000, session: crypto.randomUUID(), savedAt: Date.now() }));
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await new Promise((res) => { const o = indexedDB.open('soard-advisory', 1); o.onupgradeneeded = () => o.result.createObjectStore('photos'); o.onsuccess = () => { const tx = o.result.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ blob: new File([bytes], 'h.jpg', { type: 'image/jpeg' }), name: 'h.jpg', width: 900, height: 1200, at: Date.now(), seq: 1 }, 'headshot'); tx.oncomplete = () => { o.result.close(); res(); }; }; });
      localStorage.setItem('soard-advisory-photo-seq', '1');
    }, { ...base, fullName: 'Rae Load', email: 'rae.load@example.org', signature: 'Rae Load' }, readFileSync(GOOD_JPG).toString('base64'));
    await r.reload({ waitUntil: 'networkidle0' }); await sleep(500);
    await r.click('#adv-go');
    await r.waitForFunction(() => document.getElementById('adv-title')?.textContent.trim() === 'Review and send', { timeout: 5000 }).catch(() => null);
    const flashes = [];
    for (let k = 0; k < 3; k++) {
      await r.reload({ waitUntil: 'networkidle0' }); await sleep(800);
      const at = await r.evaluate(() => ({ title: document.getElementById('adv-title')?.textContent.trim(), checking: window.__rv.some((t) => /Checking this device/.test(t)), done: !document.querySelector('.adv-review-section[data-step="0"]')?.dataset.missing }));
      flashes.push(at);
    }
    ok(flashes.every((x) => x.title === 'Review and send' && !x.checking && x.done), `a reload straight back into the review, a photo kept: never "checking" for an instant (${JSON.stringify(flashes)})`);
    await r.close();
  }
  {
    // IndexedDB that never answers: Save and exit while the photo just picked is still being got ready (an iPhone photo
    // on a slow connection): never "saved", and what it says once this browser gives up is heard
    const x = await browser.newPage();
    await x.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await x.setCacheEnabled(false);
    await x.setRequestInterception(true);
    x.on('request', async (req) => { try { if (/\/_astro\/heic-to\./.test(req.url())) await sleep(3000); if (await answer(req, '198.51.100.74') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    await x.evaluateOnNewDocument(() => { indexedDB.open = () => ({}); localStorage.clear(); localStorage.setItem('soard-advisory-application', JSON.stringify({ answers: { fullName: 'Exit Early', email: 'exit.early@example.org', phone: '404 555 0174' }, step: 0, screen: 0, field: null, furthest: 0, startedAt: Date.now() - 60000, session: crypto.randomUUID(), savedAt: Date.now() })); });
    await x.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
    await x.click('#adv-go'); await sleep(700);
    for (let i = 0; i < 6 && await x.evaluate(() => !!document.querySelector('[data-field="headshot"]').closest('[data-off]')); i++) { await x.click('#adv-next'); await sleep(700); }
    await x.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
    await sleep(400);
    await x.evaluate(() => { const t = document.getElementById('adv-hub-title'); window.__titles = []; new MutationObserver(() => window.__titles.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
    await (await x.$('#adv-headshot')).uploadFile(heicMade ? HEIC : GOOD_JPG);
    await sleep(150);
    await x.click('#adv-exit');
    await x.waitForFunction(() => /can’t keep your photo/.test(document.getElementById('adv-hub-title').textContent), { timeout: 20000 }).catch(() => null);
    await sleep(300);
    const titles = [...new Set(await x.evaluate(() => window.__titles))];
    const heard = await text(x, '#adv-hub-live');
    ok(!titles.includes('Your application is saved on this device') && titles.includes('Saving your application on this device') && /can’t keep your photo/.test(heard),
      `Save and exit the moment a photo is picked, IndexedDB never answering: never "saved", and what it says then is heard (${JSON.stringify({ titles, heard })})`);
    await x.close();
  }
  {
    // IndexedDB that never answers, a photo picked here before: a photo picked right after the page opens is what
    // Continue goes by, never a wait of seconds for the one this device can't say it kept
    const q = await browser.newPage();
    await q.setViewport({ width: 1280, height: 800 });
    await q.setRequestInterception(true);
    q.on('request', async (req) => { try { if (await answer(req, '198.51.100.72') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    await q.evaluateOnNewDocument(() => {
      indexedDB.open = () => ({});
      localStorage.clear();
      localStorage.setItem('soard-advisory-application', JSON.stringify({ answers: { fullName: 'Quick Pick', email: 'quick@example.org', phone: '404 555 0172' }, step: 0, screen: 0, field: null, furthest: 0, startedAt: Date.now() - 60000, session: crypto.randomUUID(), savedAt: Date.now() }));
      localStorage.setItem('soard-advisory-photo-seq', '3');
    });
    await q.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'domcontentloaded' });
    await q.waitForFunction(() => document.querySelector('[data-adv]')?.dataset.ready === 'go', { timeout: 10000 }).catch(() => null);
    await q.click('#adv-go');
    for (let i = 0; i < 6 && await q.evaluate(() => !!document.querySelector('[data-field="headshot"]').closest('[data-off]')); i++) {
      await q.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
      await sleep(380); await q.click('#adv-next');
    }
    await q.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
    await (await q.$('#adv-headshot')).uploadFile(GOOD_JPG);
    await q.waitForFunction(() => /^Added\./.test(document.getElementById('adv-headshot-status').textContent), { timeout: 10000 }).catch(() => null);
    await sleep(380);
    await q.evaluate(() => { window.__heard = []; new MutationObserver(() => window.__heard.push(document.getElementById('adv-live').textContent)).observe(document.getElementById('adv-live'), { childList: true, characterData: true, subtree: true }); });
    const pressedAt = Math.round(await q.evaluate(() => performance.now()));
    const was = await text(q, '#adv-title');
    const t0 = Date.now();
    await q.click('#adv-next');
    const moved = await q.waitForFunction((w) => document.getElementById('adv-title').textContent.trim() !== w, { timeout: 8000 }, was).then(() => true).catch(() => false);
    const took = Date.now() - t0;
    const heard = await q.evaluate(() => window.__heard.filter(Boolean));
    ok(pressedAt < 3500 && moved && took < 1500 && !heard.some((x) => /Checking this device|Getting your photo ready/.test(x)),
      `a photo picked right after the page opens: Continue goes by it at once, never waiting on this device’s IndexedDB (pressed ${pressedAt} ms after opening, moved in ${took} ms, heard ${JSON.stringify(heard)})`);
    await q.close();
  }
  {
    // At an iPhone's height (390 × 664 and near it), as a person goes: About you through each of its screens, a photo in
    // (its card grows, a two-line note under it), Continue, then the phone's Back: the step isn't split again, and
    // Back walks every screen of it, the headshot's first, down to Part 1
    for (const height of [664, 688, 704]) {
      const w = await browser.newPage();
      await w.setViewport({ width: 390, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await w.setRequestInterception(true);
      w.on('request', async (req) => { try { if (await answer(req, '198.51.100.88') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
      await w.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('walked')) { localStorage.clear(); sessionStorage.setItem('walked', '1'); } });
      await w.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
      await w.evaluate(() => indexedDB.deleteDatabase('soard-advisory'));
      await w.click('#adv-go'); await sleep(600);
      const part = () => text(w, '#adv-part');
      const on = () => w.evaluate(() => [...document.querySelectorAll('.adv-page:not([hidden]) [data-field]')].filter((f) => !f.closest('[data-off]') && f.getClientRects().length).map((f) => f.dataset.field));
      const fill = { fullName: 'Walk Tester', email: 'walk@example.org', phone: '404 555 0177', address: '3167 Main St, Duluth, GA 30096' };
      const laid = [];
      for (let k = 0; k < 8 && (await text(w, '#adv-title')) === 'About you'; k++) {
        const here = await on();
        laid.push({ part: await part(), with: here });
        for (const id of here) if (fill[id]) { await w.click(`#adv-${id}`, { clickCount: 3 }); await w.type(`#adv-${id}`, fill[id]); await w.keyboard.press('Escape'); }
        if (here.includes('headshot')) { const el = await w.$('#adv-headshot'); await el.uploadFile(SOFT_JPG); await w.waitForFunction(() => /^Added\./.test(document.getElementById('adv-headshot-status').textContent), { timeout: 15000 }).catch(() => null); }
        await w.click('#adv-next'); await sleep(700);
      }
      const total = laid.length;
      const walked = [];
      if ((await text(w, '#adv-title')) !== 'About you') {
        for (let k = 0; k < total + 1; k++) {
          await w.goBack({ timeout: 3000 }).catch(() => null); await sleep(700);
          // (one more Back leaves the application for the overview: not a screen of the step)
          if (!(await w.evaluate(() => document.documentElement.classList.contains('adv-focus'))) || (await text(w, '#adv-title')) !== 'About you') break;
          walked.push({ part: await part(), with: await on() });
        }
      }
      const expect = laid.map((l) => l.part).reverse();
      ok(total > 1 && walked.length === total && walked.every((x, n) => x.part === expect[n]) && walked[0].with.includes('headshot'),
        `at 390 × ${height}: Back walks every screen of About you, the headshot’s first, down to Part 1 (${JSON.stringify({ laid: laid.map((l) => `${l.part} ${l.with.join('+')}`), walked: walked.map((x) => `${x.part} ${x.with.join('+')}`) })})`);
      await w.close();
    }
  }
  if (heicMade) {
    // An iPhone photo on a slow connection (its converter slow to arrive: a slow CPU hardly slows it, the reading runs
    // in a worker): Continue waits, looking busy; Back pressed meanwhile stands, and Continue where it lands is free at
    // once; a photo picked during a wait is the one waited for, never the one it replaced
    const SLOW_MS = 6000;
    const slowPage = async (ip) => {
      const sp = await browser.newPage();
      await sp.setViewport({ width: 1280, height: 800 });
      await sp.setCacheEnabled(false);
      await sp.setRequestInterception(true);
      sp.on('request', async (req) => { try { if (/\/_astro\/heic-to\./.test(req.url())) await sleep(SLOW_MS); if (await answer(req, ip) === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
      await sp.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('sp')) { localStorage.clear(); indexedDB.deleteDatabase('soard-advisory'); sessionStorage.setItem('sp', '1'); } });
      await sp.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
      await sp.click('#adv-go'); await sleep(600);
      const fill = { fullName: 'Slow Phone', email: 'slow@example.org', phone: '404 555 0168' };
      for (let k = 0; k < 8; k++) {
        const here = await sp.evaluate(() => [...document.querySelectorAll('.adv-page:not([hidden]) [data-field]')].filter((f) => !f.closest('[data-off]') && f.getClientRects().length).map((f) => f.dataset.field));
        if (here.includes('headshot')) break;
        for (const id of here) if (fill[id]) { await sp.click(`#adv-${id}`, { clickCount: 3 }); await sp.type(`#adv-${id}`, fill[id]); await sp.keyboard.press('Escape'); }
        await sp.click('#adv-next'); await sleep(700);
      }
      // ("Please add a headshot." ever said under it, for the checks)
      await sp.evaluate(() => { const e = document.getElementById('adv-headshot-err'); window.__pleaseAdd = false; new MutationObserver(() => { if (/Please add a headshot/.test(e.textContent) && !e.hidden) window.__pleaseAdd = true; }).observe(e, { childList: true, characterData: true, subtree: true, attributes: true }); });
      return sp;
    };
    const photoState = (sp) => sp.$eval('[data-photo="headshot"]', (b) => b.dataset.state);
    {
      const sp = await slowPage('198.51.100.97');
      const onPhoto = await text(sp, '#adv-part');
      const heicAt = Date.now();
      await (await sp.$('#adv-headshot')).uploadFile(HEIC);
      await sleep(150);
      await sp.click('#adv-next');
      await sleep(400);
      const busyLook = await sp.$eval('#adv-next', (b) => ({ busy: b.getAttribute('aria-busy'), cursor: getComputedStyle(b).cursor, opacity: getComputedStyle(b).opacity }));
      await sp.click('#adv-back');
      await sleep(900);
      const backAt = await text(sp, '#adv-part');
      ok(busyLook.busy === 'true' && busyLook.cursor === 'progress' && Number(busyLook.opacity) < 1, `Continue looks busy while it waits on a photo being got ready (${JSON.stringify(busyLook)})`);
      // Where Back landed, the photo still being got ready: Continue there is free, and moves at once
      const free = { ...(await sp.$eval('#adv-next', (b) => ({ busy: b.getAttribute('aria-busy'), opacity: getComputedStyle(b).opacity }))), preparing: (await photoState(sp)) === 'busy' };
      const t0 = Date.now();
      await sp.click('#adv-next');
      const forward = await sp.waitForFunction((p) => document.getElementById('adv-part').textContent.trim() === p, { timeout: 3000 }, onPhoto).then(() => Date.now() - t0).catch(() => null);
      ok(backAt !== onPhoto && free.busy === null && Number(free.opacity) === 1 && free.preparing && forward !== null && forward < 1500,
        `Back pressed while Continue waits stands, and Continue where it lands is free at once, the photo still being got ready (${onPhoto} → Back → ${backAt}, then Continue: ${JSON.stringify({ ...free, forward })})`);
      // On the photo's screen again, the iPhone photo still being got ready: a JPEG picked instead is the one Continue
      // waits for (it moves as soon as the JPEG is in), and the iPhone photo finishing later changes nothing
      await sp.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
      await (await sp.$('#adv-headshot')).uploadFile(GOOD_JPG);
      await sleep(150);
      const t1 = Date.now();
      await sp.click('#adv-next');
      const on = await sp.waitForFunction(() => document.getElementById('adv-title').textContent.trim() !== 'About you', { timeout: 8000 }).then(() => Date.now() - t1).catch(() => null);
      const beforeHeic = Date.now() - heicAt < SLOW_MS;
      await sleep(SLOW_MS + 2500);
      const after = { title: await text(sp, '#adv-title'), width: await sp.$eval('[data-photo="headshot"] img', (i) => i.naturalWidth).catch(() => 0), pleaseAdd: await sp.evaluate(() => window.__pleaseAdd) };
      ok(on !== null && on < 3000 && beforeHeic && after.title !== 'About you' && after.width === 900 && !after.pleaseAdd,
        `a JPEG picked while an iPhone photo is still being got ready: Continue goes by the JPEG at once, and the iPhone photo finishing later changes nothing (${JSON.stringify({ on, beforeHeic, ...after })})`);
      await sp.close();
    }
    {
      // The same iPhone photo picked again while Continue waits on the first: it waits for the second, never "Please add
      // a headshot." in between
      const sp = await slowPage('198.51.100.96');
      const input = await sp.$('#adv-headshot');
      await input.uploadFile(HEIC);
      await sleep(150);
      await sp.click('#adv-next');
      await sleep(1000);
      await input.uploadFile(HEIC);
      const on = await sp.waitForFunction(() => document.getElementById('adv-title').textContent.trim() !== 'About you', { timeout: SLOW_MS + 20000 }).then(() => true).catch(() => false);
      await sleep(500);
      const pleaseAdd = await sp.evaluate(() => window.__pleaseAdd);
      ok(on && !pleaseAdd, `the same iPhone photo picked again while Continue waits: it waits for that one and moves on, never "Please add a headshot." meanwhile (${JSON.stringify({ on, pleaseAdd, title: await text(sp, '#adv-title') })})`);
      await sp.close();
    }
    // Answers put in as the page keeps them, every step reached, then into the application (on a slow connection)
    const slowSeeded = async (ip, answers) => {
      const sp = await browser.newPage();
      await sp.setViewport({ width: 1280, height: 800 });
      await sp.setCacheEnabled(false);
      await sp.setRequestInterception(true);
      sp.on('request', async (req) => { try { if (/\/_astro\/heic-to\./.test(req.url())) await sleep(SLOW_MS); if (await answer(req, ip) === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
      await sp.evaluateOnNewDocument((a) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.clear(); indexedDB.deleteDatabase('soard-advisory');
        localStorage.setItem('soard-advisory-application', JSON.stringify({ answers: a, step: 5, screen: 0, field: null, furthest: 5, startedAt: Date.now() - 900000, session: crypto.randomUUID(), savedAt: Date.now() }));
      }, answers);
      await sp.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
      await sp.click('#adv-go'); await sleep(1000);
      for (let i = 0; i < 6 && (await text(sp, '#adv-title')) !== 'Review and send'; i++) { await sp.evaluate(() => document.querySelector('.adv-hub-row[data-goto="5"]')?.click()); await sleep(700); }
      return sp;
    };
    const summaryLink = (sp, re) => sp.evaluate((src) => { const a = [...document.querySelectorAll('.adv-page:not([hidden]) [data-summary] a')].find((x) => new RegExp(src, 'i').test(x.textContent)); a?.click(); return !!a; }, re.source);
    {
      // Sent back with two answers to look at: the summary's link to one while Continue waits on a photo is a move, so
      // Continue there is free, and nothing moves them on (or judges a half-typed answer) once the photo is ready
      const sp = await slowSeeded('198.51.100.95', { ...base, fullName: 'Sum Mary', email: '', signature: 'Sum Mary' });
      await sp.click('#adv-next'); await sleep(1500);
      const toPhoto = await summaryLink(sp, /headshot/); await sleep(900);
      await (await sp.$('#adv-headshot')).uploadFile(HEIC); await sleep(300);
      await sp.click('#adv-next'); await sleep(700);
      const toEmail = await summaryLink(sp, /email/); await sleep(800);
      const busyThen = await sp.$eval('#adv-next', (b) => b.getAttribute('aria-busy'));
      await sp.keyboard.type('sum.mary@exam', { delay: 60 });
      await sleep(SLOW_MS + 2500);
      const after = await sp.evaluate(() => ({ title: document.getElementById('adv-title').textContent.trim(), email: document.querySelector('[name="email"]').value, err: (() => { const e = document.querySelector('[data-field="email"] .adv-error'); return e && !e.hidden ? e.textContent : ''; })(), busy: document.getElementById('adv-next').getAttribute('aria-busy'),
        summary: (() => { const x = document.querySelector('.adv-page:not([hidden]) [data-summary]'); return x && !x.hidden ? x.textContent.replace(/\s+/g, ' ').trim() : ''; })() }));
      // (the note Send left under the empty email stays until it's fixed, as every answer's does: what never comes is a
      // verdict on the half-typed one, which a Continue going ahead would give)
      ok(toPhoto && toEmail && busyThen === null && after.title === 'About you' && after.email === 'sum.mary@exam' && !/look like an email/.test(after.err) && after.busy === null && !/headshot/i.test(after.summary),
        `the summary’s link while Continue waits on a photo: Continue there is free, and once the photo is ready nothing moves them on or judges what they’re typing (${JSON.stringify({ toPhoto, toEmail, busyThen, ...after })})`);
      await sp.close();
    }
    {
      // A photo being got ready, with none before it: the overview never says it's saved, and the review never says
      // "Please add a headshot" meanwhile; once it's ready and kept, both say so (the overview's words heard)
      const sp = await slowSeeded('198.51.100.94', { ...base, fullName: 'Rev Ready', email: 'rev.ready@example.org', signature: 'Rev Ready' });
      const all = await sp.$('#adv-review-all'); if (all) { await all.click(); await sleep(300); }
      await sp.evaluate(() => document.querySelector('#adv-review [data-answer="headshot"]')?.click()); await sleep(900);
      await (await sp.$('#adv-headshot')).uploadFile(HEIC); await sleep(300);
      await sp.click('#adv-exit'); await sleep(600);
      const hub1 = await text(sp, '#adv-hub-title');
      await sp.evaluate(() => document.querySelector('.adv-hub-row[data-goto="5"]')?.click());
      await sp.waitForFunction(() => document.getElementById('adv-title')?.textContent.trim() === 'Review and send', { timeout: 4000 }).catch(() => null);
      await sleep(300);
      const sec = () => sp.evaluate(() => { const x = document.querySelector('.adv-review-section[data-step="0"]'); return { missing: x?.dataset.missing || null, sum: x?.querySelector('.adv-review-sum')?.textContent, row: (() => { const it = [...(x?.querySelectorAll('.adv-review-item') || [])].find((i) => /headshot/i.test(i.querySelector('dt')?.textContent || '')); return !it ? '' : it.querySelector('dd img') ? 'photo' : it.querySelector('dd')?.textContent || ''; })() }; });
      const during = await sec();
      await sp.waitForFunction(() => document.querySelector('[data-photo="headshot"]')?.dataset.state === 'done', { timeout: SLOW_MS + 20000 }).catch(() => null);
      await sleep(1200);
      const later = await sec();
      await sp.click('#adv-exit'); await sleep(800);
      const hub2 = { title: await text(sp, '#adv-hub-title'), heard: await text(sp, '#adv-hub-live') };
      ok(hub1 === 'Saving your application on this device' && during.missing === null && during.sum === 'Getting your photo ready' && during.row === 'Getting it ready' && later.missing === null && later.row === 'photo' && hub2.title === 'Your application is saved on this device',
        `a photo being got ready: the overview says it’s saving, the review that it’s being got ready (never "Please add a headshot"), then both say what’s so (${JSON.stringify({ hub1, during, later, hub2 })})`);
      await sp.close();
    }
    {
      // Round eleven: a photo turned down while they're on the overview (Save and exit while it's being got ready, the
      // reader for iPhone photos never arriving): the overview says it didn't go in, and why, heard
      const sp = await browser.newPage();
      await sp.setViewport({ width: 1280, height: 800 });
      await sp.setCacheEnabled(false);
      await sp.setRequestInterception(true);
      sp.on('request', async (req) => { try { if (/\/_astro\/heic-to\./.test(req.url())) { await sleep(3000); return req.abort('failed'); } if (await answer(req, '198.51.100.90') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
      await sp.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('aw')) { localStorage.clear(); indexedDB.deleteDatabase('soard-advisory'); sessionStorage.setItem('aw', '1'); localStorage.setItem('soard-advisory-application', JSON.stringify({ answers: { fullName: 'Away Note', email: 'away.note@example.org', phone: '404 555 0176' }, step: 0, screen: 0, field: null, furthest: 0, startedAt: Date.now() - 60000, session: crypto.randomUUID(), savedAt: Date.now() })); } });
      await sp.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
      await sp.click('#adv-go'); await sleep(700);
      for (let i = 0; i < 6 && await sp.evaluate(() => !!document.querySelector('[data-field="headshot"]').closest('[data-off]')); i++) { await sp.click('#adv-next'); await sleep(700); }
      await sp.waitForFunction(() => !document.documentElement.classList.contains('adv-vt'), { timeout: 3000 }).catch(() => null);
      await sleep(400);
      await (await sp.$('#adv-headshot')).uploadFile(HEIC); await sleep(200);
      await sp.click('#adv-exit');
      await sp.waitForFunction(() => /didn’t go in/.test(document.getElementById('adv-hub-lead').textContent), { timeout: 15000 }).catch(() => null);
      await sleep(300);
      const hub = { title: await text(sp, '#adv-hub-title'), lead: await text(sp, '#adv-hub-lead'), heard: await text(sp, '#adv-hub-live') };
      ok(/^Your photo didn’t go in: /.test(hub.lead) && /Your photo didn’t go in: /.test(hub.heard), `a photo turned down while they're on the overview: it says the photo didn't go in, and why, read out (${JSON.stringify(hub)})`);
      await sp.close();
    }
    {
      // Round eleven: going into another answer (a click, before a word's typed) while Continue waits is a change of
      // mind: nothing moves them on, the cursor stays where they put it
      const sp = await slowPage('198.51.100.92');
      await (await sp.$('#adv-headshot')).uploadFile(HEIC); await sleep(200);
      await sp.click('#adv-next'); await sleep(500);
      await sp.click('#adv-jobTitle'); await sleep(SLOW_MS + 2500);
      const at = { title: await text(sp, '#adv-title'), focus: await sp.evaluate(() => document.activeElement?.id) };
      ok(at.title === 'About you' && at.focus === 'adv-jobTitle', `clicking into another answer while Continue waits: nothing moves them on, the cursor where they put it (${JSON.stringify(at)})`);
      await sp.close();
    }
    {
      // Round eleven: at the review, with a photo kept, a new one picked (Change) that's turned down while Send waits:
      // Send stops with the words over it, heard, never stopping without a word
      const sp = await browser.newPage();
      await sp.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await sp.setCacheEnabled(false);
      await sp.setRequestInterception(true);
      // (the reader for iPhone photos never arriving: a dropped connection)
      sp.on('request', async (req) => { try { if (/\/_astro\/heic-to\./.test(req.url())) { await sleep(SLOW_MS); return req.abort('failed'); } if (await answer(req, '198.51.100.91') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
      await sp.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
      await sp.evaluate(async (answers, b64) => {
        localStorage.clear();
        await new Promise((res) => { const d = indexedDB.deleteDatabase('soard-advisory'); d.onsuccess = d.onerror = d.onblocked = () => res(); });
        localStorage.setItem('soard-advisory-application', JSON.stringify({ answers, step: 5, screen: 0, field: null, furthest: 5, startedAt: Date.now() - 900000, session: crypto.randomUUID(), savedAt: Date.now() }));
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await new Promise((res) => { const o = indexedDB.open('soard-advisory', 1); o.onupgradeneeded = () => o.result.createObjectStore('photos'); o.onsuccess = () => { const tx = o.result.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ blob: new File([bytes], 'h.jpg', { type: 'image/jpeg' }), name: 'h.jpg', width: 900, height: 1200, at: Date.now(), seq: 1 }, 'headshot'); tx.oncomplete = () => { o.result.close(); res(); }; }; });
        localStorage.setItem('soard-advisory-photo-seq', '1');
      }, { ...base, fullName: 'Sen Stop', email: 'sen.stop@example.org', signature: 'Sen Stop' }, readFileSync(GOOD_JPG).toString('base64'));
      await sp.reload({ waitUntil: 'networkidle0' }); await sleep(400);
      await sp.click('#adv-go');
      await sp.waitForFunction(() => document.getElementById('adv-title')?.textContent.trim() === 'Review and send', { timeout: 6000 }).catch(() => null);
      const all = await sp.$('#adv-review-all'); if (all) { await all.click(); await sleep(300); }
      await sp.evaluate(() => document.querySelector('#adv-review [data-answer="headshot"]')?.click()); await sleep(900);
      await (await sp.$('#adv-headshot')).uploadFile(HEIC); await sleep(300);
      await sp.click('#adv-back'); // (back to the review at once, the photo still being got ready)
      await sp.waitForFunction(() => document.getElementById('adv-title')?.textContent.trim() === 'Review and send', { timeout: 4000 }).catch(() => null);
      await sleep(400);
      await sp.click('#adv-next'); // (Send, waiting on the photo)
      await sp.waitForFunction(() => { const e = document.getElementById('adv-send-error'); return e && !e.hidden && e.textContent; }, { timeout: SLOW_MS + 15000 }).catch(() => null);
      const said = await sp.evaluate(() => { const e = document.getElementById('adv-send-error'); return { shown: !e.hidden && !!e.getClientRects().length, text: e.textContent, role: e.getAttribute('role'), title: document.getElementById('adv-title').textContent.trim() }; });
      const stored = (await DB.prepare('SELECT COUNT(*) AS n FROM advisory_applications WHERE email = ?').bind('sen.stop@example.org').first()).n;
      ok(said.shown && said.role === 'alert' && /Your earlier headshot is still here/.test(said.text) && said.title === 'Review and send' && stored === 0, `a new photo turned down while Send waits: Send stops with its words over it, read out, nothing sent (${JSON.stringify({ ...said, stored })})`);
      await sp.close();
    }
    {
      // A photo in, then a slow iPhone photo, Continue (waiting), then a file that isn't a photo: Continue stops, with
      // the words about that file in sight, never on with the earlier photo as if nothing was said
      const sp = await slowPage('198.51.100.93');
      const input = await sp.$('#adv-headshot');
      await input.uploadFile(GOOD_JPG);
      await sp.waitForFunction(() => /^Added\./.test(document.getElementById('adv-headshot-status').textContent), { timeout: 15000 }).catch(() => null);
      await input.uploadFile(HEIC); await sleep(200);
      await sp.click('#adv-next'); await sleep(500);
      await input.uploadFile(FAKE_JPG);
      await sleep(1500);
      const now = { title: await text(sp, '#adv-title'), status: await text(sp, '#adv-headshot-status'), busy: await sp.$eval('#adv-next', (b) => b.getAttribute('aria-busy')) };
      await sleep(SLOW_MS);
      const later = await text(sp, '#adv-title');
      ok(now.title === 'About you' && /Your earlier headshot is still here/.test(now.status) && now.busy === null && later === 'About you',
        `a file that isn’t a photo picked while Continue waits: Continue stops there, the words about it in sight (${JSON.stringify({ ...now, later })})`);
      // Escape on the photo's own button: a screen back, as from anywhere but a box being typed in
      const was = await text(sp, '#adv-part');
      await sp.focus('#adv-headshot');
      await sp.keyboard.press('Escape'); await sleep(900);
      const nowAt = await text(sp, '#adv-part');
      ok(nowAt !== was, `Escape on the photo’s button goes a screen back (${was} → ${nowAt})`);
      await sp.close();
    }
  }
  for (const [w, hgt] of [[740, 360], [667, 375], [844, 390]]) {
    // A phone held sideways: Continue with no headshot brings "Please add a headshot." into sight above Back / Continue
    // (the card is taller than the room between the bars)
    const m = await browser.newPage();
    await m.setViewport({ width: w, height: hgt, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await m.setRequestInterception(true);
    m.on('request', async (req) => { try { if (await answer(req, '198.51.100.98') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    // (a clean start: answers and any photo an earlier check kept on this browser gone before the page reads them)
    await m.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('ls')) { localStorage.clear(); indexedDB.deleteDatabase('soard-advisory'); sessionStorage.setItem('ls', '1'); } });
    await m.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
    await m.evaluate(() => indexedDB.deleteDatabase('soard-advisory'));
    if (w === 740) {
      // The hero's link back to the Advisory Board page: a finger's room (44px) on a touch screen, and it looks like a link
      const link = await m.$eval('.hero-eyebrow a', (a) => ({ h: Math.round(a.getBoundingClientRect().height), line: getComputedStyle(a).textDecorationLine }));
      ok(link.h >= 44 && /underline/.test(link.line), `the hero’s Advisory Board link is 44px to tap and underlined (${JSON.stringify(link)})`);
      // Follow-ups read on their own, wherever they land (a screen to themselves, the review, the emails)
      const labels = await m.evaluate(() => ['involvedHow', 'networksMore', 'conflictMore'].map((id) => document.querySelector(`[data-field="${id}"] label, [data-field="${id}"] .adv-label`)?.textContent.replace(/\s+/g, ' ').trim()));
      ok(/How have you been involved with SOARD\?/.test(labels[0]) && /people or groups who may want to learn about SOARD/.test(labels[1]) && /explain the possible conflict of interest/.test(labels[2]), `each follow-up says what it’s about on its own (${labels.join(' | ')})`);
    }
    await m.click('#adv-go'); await sleep(600);
    const fill = { fullName: 'Land Tester', email: 'land@example.org', phone: '404 555 0167', address: '3167 Main St, Duluth, GA 30096' };
    for (let k = 0; k < 8; k++) {
      const here = await m.evaluate(() => [...document.querySelectorAll('.adv-page:not([hidden]) [data-field]')].filter((f) => !f.closest('[data-off]') && f.getClientRects().length).map((f) => f.dataset.field));
      if (here.includes('headshot')) break;
      for (const id of here) if (fill[id]) { await m.click(`#adv-${id}`, { clickCount: 3 }); await m.type(`#adv-${id}`, fill[id]); await m.keyboard.press('Escape'); }
      await m.click('#adv-next'); await sleep(700);
    }
    await m.click('#adv-next');
    await m.waitForFunction(() => /Please add a headshot/.test(document.getElementById('adv-headshot-err')?.textContent || ''), { timeout: 5000 }).catch(() => null);
    await sleep(900);
    const at = await m.evaluate(() => { const n = document.getElementById('adv-headshot-err').getBoundingClientRect(); return { top: Math.round(n.top), bottom: Math.round(n.bottom), bar: Math.round(document.querySelector('.adv-nav').getBoundingClientRect().top), head: Math.round(document.querySelector('[data-adv-top]')?.getBoundingClientRect().bottom || 0), text: document.getElementById('adv-headshot-err').textContent, focus: document.activeElement?.id }; });
    ok(/Please add a headshot/.test(at.text) && at.top >= at.head && at.bottom <= at.bar && at.focus === 'adv-headshot', `${w} × ${hgt}, held sideways: "Please add a headshot." in sight between the bars, the cursor on the photo (${JSON.stringify(at)})`);
    await m.close();
  }
  {
    // Reduced motion on a 320 × 568 phone: a refusal while a photo is in, its whole warning above Back / Continue
    const m = await browser.newPage();
    await m.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await m.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await m.setRequestInterception(true);
    m.on('request', async (req) => { try { if (await answer(req, '198.51.100.99') === false) req.continue(); } catch { req.respond({ status: 500, body: '{}' }); } });
    await m.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('rm')) { localStorage.clear(); sessionStorage.setItem('rm', '1'); } });
    await m.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
    await m.evaluate(() => indexedDB.deleteDatabase('soard-advisory'));
    await m.click('#adv-go'); await sleep(600);
    const fill = { fullName: 'Rm Tester', email: 'rm@example.org', phone: '404 555 0166', address: '3167 Main St, Duluth, GA 30096' };
    for (let k = 0; k < 8; k++) {
      const here = await m.evaluate(() => [...document.querySelectorAll('.adv-page:not([hidden]) [data-field]')].filter((f) => !f.closest('[data-off]') && f.getClientRects().length).map((f) => f.dataset.field));
      if (here.includes('headshot')) break;
      for (const id of here) if (fill[id]) { await m.click(`#adv-${id}`, { clickCount: 3 }); await m.type(`#adv-${id}`, fill[id]); await m.keyboard.press('Escape'); }
      await m.click('#adv-next'); await sleep(600);
    }
    const inp = await m.$('#adv-headshot');
    await inp.uploadFile(GOOD_JPG);
    await m.waitForFunction(() => /^Added\./.test(document.getElementById('adv-headshot-status').textContent), { timeout: 15000 }).catch(() => null);
    await inp.uploadFile(SMALL_JPG);
    await m.waitForFunction(() => /still here/.test(document.getElementById('adv-headshot-status').textContent), { timeout: 15000 }).catch(() => null);
    await sleep(700);
    const w = await m.evaluate(() => { const n = document.getElementById('adv-headshot-status').getBoundingClientRect(); return { top: Math.round(n.top), bottom: Math.round(n.bottom), bar: Math.round(document.querySelector('.adv-nav').getBoundingClientRect().top), text: document.getElementById('adv-headshot-status').textContent.slice(-36) }; });
    ok(/still here/.test(w.text) && w.top >= 0 && w.bottom <= w.bar, `reduced motion, 320 × 568: a refusal’s whole warning sits above Back / Continue (${JSON.stringify(w)})`);
    await m.close();
  }
  {
    // A photo kept on this device and no answers typed: the overview says it's started, and Start over takes it off
    const k = await open(1440, '/advisory-board/apply/');
    await k.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await k.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await new Promise((res) => { const r = indexedDB.open('soard-advisory', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => { const tx = r.result.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ blob: new Blob([bytes], { type: 'image/jpeg' }), name: 'me.jpg', width: 900, height: 1200, at: Date.now(), seq: 1 }, 'headshot'); tx.oncomplete = () => { r.result.close(); res(); }; }; });
      // (as the page itself does whenever it keeps a photo: its number on this device, which is how a later visit
      // knows there's one to look for)
      localStorage.setItem('soard-advisory-photo-seq', '1');
    }, readFileSync(GOOD_JPG).toString('base64'));
    await k.reload({ waitUntil: 'networkidle0' }); await sleep(800);
    const hub = { title: await text(k, '#adv-hub-title'), go: await text(k, '#adv-go'), over: await k.$eval('#adv-start-over', (e) => !e.hidden).catch(() => false) };
    ok(hub.title !== 'Six steps, about 20 minutes' && hub.go !== 'Start the application' && hub.over, `a photo kept and nothing typed: the overview says it’s started (${JSON.stringify(hub)})`);
    // In the application with only that photo, then a reload: back in the application, as with any answer
    await k.click('#adv-go'); await sleep(700);
    await k.reload({ waitUntil: 'networkidle0' }); await sleep(1200);
    ok(await k.evaluate(() => document.documentElement.classList.contains('adv-focus')), 'a reload with only a photo picked goes back into the application');
    // Start over: the photo, and a "may already have been sent" from an earlier send, both go
    await k.evaluate(() => localStorage.setItem('soard-advisory-sending', JSON.stringify({ at: Date.now() })));
    await k.click('#adv-exit'); await sleep(600);
    await k.click('#adv-start-over'); await sleep(300); // (pressed twice: the first asks)
    await k.click('#adv-start-over'); await sleep(800);
    const after = await k.evaluate(() => new Promise((res) => { const r = indexedDB.open('soard-advisory', 1); r.onsuccess = () => { try { const q = r.result.transaction('photos', 'readonly').objectStore('photos').get('headshot'); q.onsuccess = () => res({ photo: !!q.result, sending: localStorage.getItem('soard-advisory-sending') }); } catch { res({ photo: false, sending: localStorage.getItem('soard-advisory-sending') }); } }; r.onerror = () => res({ photo: false, sending: localStorage.getItem('soard-advisory-sending') }); }));
    ok(!after.photo && after.sending === null, `Start over takes the photo off this device, and "may already have been sent" with it (${JSON.stringify(after)})`);
    await k.close();
  }
  const ab = await open(1440, '/advisory-board/');
  const links = await ab.$$eval('a', (els) => els.filter((a) => /Apply to Join/.test(a.textContent)).map((a) => [a.getAttribute('href'), a.target, a.hasAttribute('data-astro-reload')]));
  ok(links.length === 3 && links.every(([h, t]) => h === '/advisory-board/apply/' && !t), 'the Advisory Board page’s three Apply buttons go to the new page, same tab');
  // A page of its own, not one the site's router brings (the router would hear Back first and fetch the page again)
  ok(links.every(([, , reload]) => reload), 'each loads the application afresh (data-astro-reload), as the family form’s links do');
  await ab.close();
} else {
  console.log('(DIST not set: the Apply page checks are skipped)');
}

ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll Advisory Board application checks passed');
process.exit(failures.length ? 1 : 0);
