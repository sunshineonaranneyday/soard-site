/**
 * test-advisory-round19-names.mjs: Advisory Board round 19, greeting people by name only when the reader is confident
 * ============================================================================================================
 * /advisory-board/apply/ from an astro build (DIST), under its own strict CSP from dist/_headers, every send answered by
 * the REAL public handler (functions/api/advisory-apply.js) over an in-memory D1. For names from each of the round's nine
 * findings, the application is sent through the page and the thank-you's heading and the applicant's copy are read:
 *   G1 a preferred "Call me Jo" is Jo, "Prefer not to say" their first name   G2 "State Rep. Jordan Ames" is Jordan,
 *   "Pastor & First Lady Ames" Pastor and First Lady Ames   G3 "T.J Ames" is T.J   G4 "Ames , Jordan" is Jordan
 *   G5 "Jordan Rowe and wife" is Jordan   G6 "Rowe Family": no name   G7 "Dr. Quill FACC": no name, "Rev. Quill ThM" Rev. Quill
 *   G8 "Jor[zero width]dan Ames" is Jordan, "Gal\u00B7la Puig" Gal\u00B7la   G9 "Ma. Teresa Cruz" is Ma. Teresa, "Wm. Ames": no name
 * And the lead's decisions (Nov 21 2026): "Dr. Marie CURIE", "Dr. JORDAN AMES", "Ma Teresa Cruz": no name; "Jo\u2013Ann Ames" is Jo-Ann;
 * a preferred "only "new" fits" is no name of theirs. Made-up people only; Resend, Slack and Cloudflare Images are faked. Screenshots land in test-results/advisory-round19/.
 * Exits non-zero on any failure or page error.
 *   DIST=<an astro build folder> node scripts/test-advisory-round19-names.mjs      (PORT=4723 by default)
 * (build it first: npx astro build --outDir <dir>, then node scripts/csp-hash.mjs <dir>)
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as publicApi from '../functions/api/advisory-apply.js';
// (round 24: every page served without Cloudflare's analytics beacon, so nothing leaves this machine)
import { servesPage } from '../tests/lib/local-only.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/advisory-round19/');
mkdirSync(OUT, { recursive: true });
const DIST = process.env.DIST ? `${process.env.DIST.replace(/\/$/, '')}/` : null;
if (!DIST || !existsSync(`${DIST}advisory-board/apply/index.html`)) {
  console.error('Set DIST to an astro build folder (npx astro build --outDir <dir>, then node scripts/csp-hash.mjs <dir>)');
  process.exit(1);
}
const PORT = Number(process.env.PORT || 4723);
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Resend, Slack and Images, faked (what was sent kept to read) ──
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') { const list = [JSON.parse(init.body)].flat(); sent.push(...list); return Response.json({ data: list.map((_, i) => ({ id: `e${sent.length}_${i}` })) }); }
  if (url.host === 'hooks.slack.test') return new Response('ok');
  if (url.host === 'api.cloudflare.com' && /\/images\/v1/.test(url.pathname)) {
    if (init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } }); }
    return Response.json({ success: true, result: {} });
  }
  return realFetch(input, init);
};
const env = { DB: await createD1(), RESEND_API_KEY: 'r', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x', CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't' };

// The Apply page's own CSP, as the build's _headers sends it (as test-advisory-application.mjs reads it)
const applyCsp = (() => {
  const text = readFileSync(`${DIST}_headers`, 'utf8');
  const at = text.indexOf('\n/advisory-board/apply/*\n');
  if (at < 0) return null;
  const lines = text.slice(at + 1).split('\n\n')[0].split('\n');
  const line = lines.find((l) => /^\s*Content-Security-Policy-Report-Only:/.test(l)) || lines.find((l) => /^\s*Content-Security-Policy:/.test(l));
  return line ? line.replace(/^\s*Content-Security-Policy(-Report-Only)?:\s*/, '').replace(/;\s*report-(uri|to)[^;]*/g, '').replace(/'self'/g, "'self' https://sunshineonaranneyday.com") : null;
})();
if (!(applyCsp && /script-src 'self'[^;]*'sha256-/.test(applyCsp))) { console.error(`The Apply page's CSP wasn't found in ${DIST}_headers: run scripts/csp-hash.mjs on it first`); process.exit(1); }

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
let sends = 0;
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/advisory-apply') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    // (each send from its own address, as each applicant is: the form's rate limit is per address)
    const ip = `198.51.100.${10 + (req.method === 'POST' ? ++sends : 0)}`;
    const request = new Request(`https://site.test${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', 'CF-Connecting-IP': ip }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const waits = [];
    const r = req.method === 'POST' ? await publicApi.onRequestPost({ env, request, data: {}, waitUntil: (p) => waits.push(p) }) : await publicApi.onRequestGet({ env, request, data: {}, waitUntil: () => {} });
    await Promise.all(waits);
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = join(DIST, path);
  if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...(path === '/advisory-board/apply/index.html' ? { 'content-security-policy': applyCsp } : {}) });
    return res.end(servesPage(file, readFileSync(file)));
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
const JPG = (await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 196, g: 170, b: 140 } } }).jpeg().toBuffer()).toString('base64');

const ANSWERS = (k) => ({
  email: `r19.names.${k}@example.org`, phone: '404 555 0199', heardFrom: 'A friend at church', why: 'To help kids.', connection: 'Neighbors with a SOARD family.', involved: 'No',
  strengths: 'Law and nonprofit governance.', fundraising: 'A table at the gala.', introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'Yes', meetings: 'Yes',
  ambassador: 'Yes', refName: 'Pat Kim', refRelationship: 'Colleague', refEmail: 'pat@example.org', acknowledge: true,
});
// [full name, preferred name, the greeting]
// (round 20, Nov 21 2026: the greeting greets only on positive evidence; each row it changes says why)
const CASES = [
  ['G1', 'Joanna Ames', 'Call me Jo', 'Joanna'] /* r20: words around the name they go by: set aside, their full name's */, ['G1', 'Joanna Ames', 'Prefer not to say', 'Joanna'],
  ['G2', 'State Rep. Jordan Ames', '', ''] /* r20: a title of more than one word: no name */,
  ['G2', 'Pastor & First Lady Ames', '', ''] /* r20: two people: no name */, ['G3', 'T.J Ames', '', ''] /* r20: initials: no name */, ['G4', 'Ames , Jordan', '', ''] /* r20: a comma: no name */,
  ['G5', 'Jordan Rowe and wife', '', ''] /* r20: "and": no name */, ['G6', 'Rowe Family', '', ''], ['G7', 'Dr. Quill FACC', '', ''], ['G7', 'Rev. Quill ThM', '', ''] /* r20: a title and a family name: no name */,
  ['G8', 'Jor\u200Bdan Ames', '', 'Jordan'], ['G8', 'Gal\u00B7la Puig', '', 'Gal\u00B7la'], ['G9', 'Ma. Teresa Cruz', '', ''] /* r20: a short form with a full stop: no name */, ['G9', 'Wm. Ames', '', ''],
  // (the lead's decisions on the open points, Nov 21 2026)
  ['P1', 'Dr. Marie CURIE', '', 'Marie'] /* r20: a title on the short list, then a whole name: its first name */, ['P2', 'Dr. JORDAN AMES', '', 'Jordan'] /* r20: the same */,
  ['P3', 'Ma Teresa Cruz', '', ''], ['P8', 'Jo\u2013Ann Ames', '', 'Jo-Ann'], ['P8', 'Joanna Ames', 'only "new" fits', 'Joanna'],
];

// 'shell': screenshots keep working while the Mac's display sleeps
const browser = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
try {
  for (const [k, [id, fullName, preferredName, want]] of CASES.entries()) {
    console.log(`${id}: ${JSON.stringify(fullName)}${preferredName ? ` (preferred ${JSON.stringify(preferredName)})` : ''}`);
    // (each applicant in their own browser profile: nothing saved on the device from the one before)
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.hostname !== '127.0.0.1') return req.respond(req.resourceType() === 'script' ? { status: 200, contentType: 'text/javascript', body: '' } : { status: 200, contentType: 'image/png', body: PNG });
      return req.continue();
    });
    page.on('pageerror', (e) => errors.push(`${id}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|live-ws/.test(m.text())) errors.push(`${id}: ${m.text()}`); });
    await page.evaluateOnNewDocument(() => { addEventListener('securitypolicyviolation', (e) => console.error(`CSP refused ${e.violatedDirective}: ${e.blockedURI}`)); });
    await page.goto(`${SITE}/advisory-board/apply/`, { waitUntil: 'networkidle0' });
    // Every answer as the page saves them (started 15 minutes ago, at the review), and the headshot as it keeps one
    const answers = { ...ANSWERS(k), fullName, preferredName, signature: fullName };
    await page.evaluate(async (answers, b64) => {
      localStorage.setItem('soard-advisory-application', JSON.stringify({ answers, step: 5, screen: 0, field: null, furthest: 5, startedAt: Date.now() - 15 * 60 * 1000, session: crypto.randomUUID(), savedAt: Date.now() }));
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new File([bytes], 'headshot.jpg', { type: 'image/jpeg' });
      await new Promise((res) => {
        const open = indexedDB.open('soard-advisory', 1);
        open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('photos')) open.result.createObjectStore('photos'); };
        open.onsuccess = () => { const db = open.result; const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ blob, name: 'headshot.jpg', width: 900, height: 1200, sourceWidth: 900, sourceHeight: 1200, at: Date.now() - 60000, seq: 1 }, 'headshot'); tx.oncomplete = () => { db.close(); localStorage.setItem('soard-advisory-photo-seq', '1'); res(); }; tx.onerror = () => res(); };
        open.onerror = () => res();
      });
    }, answers, JPG);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-adv]')?.dataset.ready === 'go', { timeout: 30000 }).catch(() => null);
    await page.click('#adv-go');
    await page.waitForFunction(() => document.getElementById('adv-title')?.textContent.trim() === 'Review and send', { timeout: 20000 }).catch(() => null);
    ok(await page.$eval('#adv-title', (e) => e.textContent.trim()).catch(() => '') === 'Review and send', `${id}: at the review`);
    await page.click('#adv-next');
    await page.waitForFunction(() => !document.getElementById('adv-done').hidden || !document.getElementById('adv-send-error').hidden, { timeout: 60000 }).catch(() => null);
    await sleep(400);
    const heading = await page.$eval('#adv-done h2', (e) => (e.offsetParent ? e.textContent.replace(/\s+/g, ' ').trim() : null)).catch(() => null);
    const shown = want ? `Thank you, ${want.replace(/\.+$/, '')}.` : 'Thank you.';
    ok(heading === shown, `${id}: the thank-you says ${JSON.stringify(shown)} (${JSON.stringify(heading)})`);
    await page.screenshot({ path: join(OUT, `thanks-${k + 1}-${id}.png`) });
    // The applicant's copy, as it went: its first line greets them the same way
    const copy = sent.find((e) => e.subject === 'We have your Advisory Board application' && [e.to].flat()[0] === answers.email);
    ok(String(copy?.text || '').split('\n')[0] === (want ? `Thank you, ${want}${want.endsWith('.') ? '' : '.'}` : 'Thank you.'), `${id}: their copy starts ${JSON.stringify(String(copy?.text || '').split('\n')[0])}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
  globalThis.fetch = realFetch;
}
ok(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
