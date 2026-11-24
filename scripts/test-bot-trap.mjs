/**
 * test-bot-trap.mjs — the site's bot trap on every public form, in a real browser
 * ===========================================================================
 * functions/api/_bot-trap.js and src/components/global/BotTrap.astro: one hidden box, on every public form, that
 * people never see or reach and bots fill in. On the built site, every page with a form:
 *   - each trap is inside its form, named so nothing autofills it, with each password manager's "leave this alone"
 *     flag, out of sight off the page (never display:none), hidden from screen readers, and never reached by Tab
 *   - nothing else on the page is named the old way ("website", "website2")
 *   - the forms that send: a person's send carries the trap empty, under the key its server reads; with the trap
 *     filled (a bot), the same send carries it filled
 * Every /api/ call is answered here (nothing leaves the machine), and what each form sent is kept for the checks.
 *
 *   npx astro build --outDir <dir> && node scripts/csp-hash.mjs <dir>
 *   DIST=<dir>/ node scripts/test-bot-trap.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
// (round 24: every page served without Cloudflare's analytics beacon, so nothing leaves this machine)
import { servesPage } from '../tests/lib/local-only.mjs';

const DIST = process.env.DIST;
if (!DIST) { console.error('DIST=<built site>/ is needed'); process.exit(2); }
let failed = 0;
const ok = (cond, what) => { console.log(`  ${cond ? '✓' : '✗'} ${what}`); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); res.end('not here'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(servesPage(file, readFileSync(file)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu'] });
const sends = [];
async function open(path, width = 1280) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.host !== new URL(SITE).host) return req.respond({ status: 200, contentType: req.resourceType() === 'script' ? 'text/javascript' : 'text/plain', body: '' });
    if (url.pathname.startsWith('/api/')) {
      if (req.method() === 'POST') sends.push({ path: url.pathname, body: req.postData() || '', type: req.headers()['content-type'] || '' });
      return req.respond({ status: 200, contentType: 'application/json', body: req.method() === 'POST' ? '{"ok":true,"channel":"email"}' : '{}' });
    }
    return req.continue();
  });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle0' }).catch(() => null);
  await sleep(300);
  return page;
}
/** What the trap sent in a form's last send: the JSON key's value, or the posted box's */
const sentTrap = (s, key) => {
  if (/json/.test(s.type)) { try { return JSON.parse(s.body)[key]; } catch { return undefined; } }
  const m = s.body.match(new RegExp(`(?:^|&)${key}=([^&]*)`)) || s.body.match(new RegExp(`name="${key}"\\r\\n\\r\\n([^\\r]*)`));
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : undefined;
};

// Every page with a public form
const PAGES = ['/', '/apply/', '/apply/form/', '/live/', '/trade-partners/', '/profile-update/', '/advisory-board/apply/', '/events/'];
for (const path of PAGES) {
  if (!existsSync(join(DIST, path, 'index.html'))) { console.log(`(${path} isn’t in this build)`); continue; }
  console.log(path);
  const page = await open(path);
  const traps = await page.$$eval('[data-bot-trap]', (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const wrap = el.closest('[aria-hidden="true"]');
    return {
      inForm: !!el.closest('form'), name: el.name, tab: el.tabIndex, auto: el.getAttribute('autocomplete'), value: el.value,
      flags: ['data-1p-ignore', 'data-lpignore', 'data-bwignore', 'data-form-type'].every((a) => el.hasAttribute(a)),
      offPage: r.right <= 0 || r.left < -1000, laidOut: getComputedStyle(el).display !== 'none' && getComputedStyle(el.parentElement).display !== 'none' && !!wrap && getComputedStyle(wrap).display !== 'none',
      hiddenFromReaders: !!wrap,
    };
  }));
  ok(traps.length > 0, `${traps.length} trap${traps.length === 1 ? '' : 's'} on the page`);
  for (const [i, t] of traps.entries()) {
    ok(t.inForm && t.name === 'leave-this-empty' && t.tab === -1 && t.auto === 'off' && t.flags && t.offPage && t.laidOut && t.hiddenFromReaders && t.value === '',
      `trap ${i + 1}: in its form, named for nothing autofill fills, password managers told to leave it, off the page but laid out, hidden from screen readers, out of Tab, empty (${JSON.stringify(t)})`);
  }
  const old = await page.$$eval('input[name="website"], input[name="website2"]', (els) => els.length);
  ok(old === 0, `no box with the old name (${old})`);
  // Tab through the whole page: the keys never land on a trap
  let landed = false;
  for (let k = 0; k < 120; k++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => !!document.activeElement?.matches?.('[data-bot-trap]'))) { landed = true; break; }
  }
  ok(!landed, 'Tab never reaches a trap');
  await page.close();
}

// The forms that send, as a person and as a bot
console.log('Sending');
async function sendCase({ path, form, fill, submit, post, key, label, wait = 2500 }) {
  for (const bot of [false, true]) {
    const page = await open(path);
    const before = sends.length;
    await page.evaluate(async (f) => { await (new Function(`return (${f})`)())(); }, fill).catch(() => null);
    if (bot) await page.$eval(`${form} [data-bot-trap]`, (el) => { el.value = 'http://spam.example'; });
    await page.evaluate(async (f) => { await (new Function(`return (${f})`)())(); }, submit).catch(() => null);
    const until = Date.now() + wait;
    while (Date.now() < until && !sends.slice(before).some((s) => s.path === post)) await sleep(100);
    const s = sends.slice(before).find((x) => x.path === post);
    const got = s ? sentTrap(s, key) : undefined;
    ok(!!s && (bot ? String(got || '').length > 0 : got === ''), `${label}, ${bot ? 'a bot (trap filled)' : 'a person'}: sent to ${post} with ${key} ${bot ? 'filled' : 'empty'} (${s ? JSON.stringify(got) : 'nothing sent'})`);
    await page.close();
  }
}
await sendCase({
  path: '/', form: '#newsletter-form', post: '/api/newsletter', key: 'hp', label: 'the footer newsletter',
  fill: `async () => { const f = document.querySelector('#newsletter-form'); const e = f.querySelector('input[type=email], input[name=email]'); e.value = 'person@example.org'; e.dispatchEvent(new Event('input', { bubbles: true })); }`,
  submit: `async () => { document.querySelector('#newsletter-form').requestSubmit(); }`,
});
await sendCase({
  path: '/apply/', form: '#notify-form', post: '/api/newsletter', key: 'hp', label: 'the Apply page’s Notify me',
  fill: `async () => { const f = document.querySelector('#notify-form'); const e = f.querySelector('input[type=email], input[name=email]'); e.value = 'person@example.org'; e.dispatchEvent(new Event('input', { bubbles: true })); }`,
  submit: `async () => { document.querySelector('#notify-form').requestSubmit(); }`,
});
await sendCase({
  path: '/trade-partners/', form: '#tp-start', post: '/api/trade-partner', key: 'leave-this-empty', label: 'trade partners’ Get started',
  fill: `async () => { const f = document.querySelector('#tp-start'); const set = (n, v) => { const el = f.querySelector('[name=' + n + ']'); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }; set('company', 'Example Roofing'); set('name', 'Pat Example'); set('email', 'pat@example.org'); set('phone', '404 555 0100'); }`,
  submit: `async () => { document.querySelector('#tp-start').requestSubmit(); }`,
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
