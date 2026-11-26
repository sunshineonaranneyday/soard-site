/**
 * test-media-admin.mjs — drive Admin → Photos & Videos in a real browser
 * ===========================================================================
 * Serves public/ and answers /api/media-admin and /api/media-download with the
 * REAL handlers over an in-memory D1 (kids, events, community projects, the
 * reveal schedule's last copy, live reveals), with a fake Cloudflare Stream
 * (an MP4 that takes a moment to make). Then, as the person who posts SOARD's
 * social media would:
 *   - the area is in the menu; What's happening lists the reveals and events
 *     coming up and what just happened (a live reveal, its Reel, new photos)
 *   - a reveal's album: the photographer's credit, the Reel's caption, videos,
 *     photos, before and after; a photo opens big and steps with the arrows
 *   - one photo downloads full size under the album's name; two picked
 *     download as one ZIP; the whole album as one ZIP (each file checked)
 *   - a video's MP4: Stream makes it, the button says so, then it downloads
 *   - Back returns to the albums; the Videos and Events tabs
 *   - a phone: nothing wider than the screen; axe on the area
 * Screenshots in test-results/media/. Exits non-zero on failure.
 *
 *   node scripts/test-media-admin.mjs
 *   MEDIA_WALK_WORLD=/tmp/world.json node scripts/test-media-admin.mjs
 *     the same walk on a local copy of real records ({ kids, events, community, broadcasts, reveals, streamAlive? },
 *     never committed), with the real photos from Cloudflare; streamAlive: the Stream ids that still play (else every
 *     one is taken as there); MEDIA_WALK_KID names the album to open
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, extname } from 'node:path';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as mediaAdmin from '../functions/api/media-admin.js';
import * as mediaDownload from '../functions/api/media-download.js';
import { answerAsks } from './lib/ask.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/media/');
const DOWNLOADS = join(OUT, 'downloads');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(DOWNLOADS, { recursive: true });
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const REAL = process.env.MEDIA_WALK_WORLD || '';
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: crashed: ${e.message}`); console.error(`  ✗ crashed: ${e.stack || e.message}`); }
}

// ─── The world ────────────────────────────────────────────────────
const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
const DAY = 864e5;
const NOW = Date.now();
const UID = (c) => c.repeat(32).slice(0, 32);
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const pics = (slug, n, at, prefix = '') => Array.from({ length: n }, (_, i) => ({ url: `${CF}/kids/${slug}/${prefix}${at + i * 1000}-FINAL-${i + 1}.jpg/public`, alt: `Photo ${i + 1} of the new room` }));
function fakeWorld() {
  const y = new Date(NOW).getUTCFullYear();
  const kids = [
    { name: 'Ava', slug: 'ava', year: y, status: 'completed', publishStatus: 'published', roomTypes: ['Accessible Bathroom'], photographer: 'Example Photography',
      heroImage: `${CF}/kids/ava/${NOW - 2 * DAY}-FINAL-1.jpg/public`, photos: pics('ava', 18, NOW - 2 * DAY),
      beforeAfterPhotos: [{ before: `${CF}/kids/ava/ba-before-${NOW - DAY}-a.jpg/public`, after: `${CF}/kids/ava/ba-after-${NOW - DAY}-b.jpg/public`, room: 'Bathroom' }],
      beforePhotos: [1, 2, 3].map((i) => ({ url: `${CF}/kids/ava/before-${NOW - 12 * DAY}-${i}.jpg/public`, looked: 'staff' })).concat([{ url: `${CF}/kids/ava/before-kept-off.jpg/public`, looked: 'site', offPage: true }]),
      streamVideoId: UID('a'), videoUrl: 'https://www.youtube.com/watch?v=AbCdEfGhIjK' },
    { name: 'Ben', slug: 'ben', year: y, status: 'in-progress', publishStatus: 'published', roomTypes: ['Dream Bedroom'], photographer: 'Sample Studio', heroImage: `${CF}/kids/ben/hero/public`, photos: pics('ben', 9, NOW - 30 * DAY) },
    { name: 'Sam & Lee', slug: 'sam-and-lee', year: y, status: 'completed', publishStatus: 'published', roomTypes: ['Dream Bedroom', 'Therapy Room'], heroImage: `${CF}/kids/sam-and-lee/hero/public`, photos: pics('sam-and-lee', 24, NOW - 50 * DAY), streamVideoId: UID('d') },
    { name: 'Dee', slug: 'dee', year: y, status: 'in-progress', publishStatus: 'published', roomTypes: ['Accessible Bathroom'], heroImage: `${CF}/kids/dee/hero/public`, photos: pics('dee', 6, NOW - 90 * DAY) },
    ...Array.from({ length: 14 }, (_, i) => ({ name: `Example ${String.fromCharCode(65 + i)}`, slug: `example-${i}`, year: y - 1 - (i % 4), status: 'completed', publishStatus: 'published', roomTypes: ['Dream Bedroom'], heroImage: `${CF}/kids/example-${i}/hero/public`, photos: pics(`example-${i}`, 8 + i, NOW - (400 + i * 30) * DAY), ...(i % 3 === 0 ? { streamVideoId: UID(String(i % 10)) } : {}) })),
    // An old makeover video Stream purged, also on YouTube: the album offers the YouTube link
    { name: 'Old Timer', slug: 'old-timer', year: y - 6, status: 'completed', publishStatus: 'published', roomTypes: ['Dream Bedroom'], heroImage: `${CF}/kids/old-timer/hero/public`, photos: pics('old-timer', 5, NOW - 2000 * DAY), streamVideoId: UID('f'), videoUrl: 'https://youtu.be/AbCdEfGhIjK' },
    { name: 'Draft Kid', slug: 'draft', year: y, publishStatus: 'draft', heroImage: `${CF}/kids/draft/hero/public`, photos: pics('draft', 3, NOW) },
  ];
  const events = [
    { slug: 'gala', title: `${y} Example Gala`, date: ymd(NOW - 20 * DAY), status: 'past', location: 'Example Hall', time: '6 to 10 p.m.', category: 'fundraiser', image: `${CF}/events/gala/hero/public`,
      photos: Array.from({ length: 12 }, (_, i) => ({ id: `events/gala/${NOW - 15 * DAY + i}-g${i}.jpg`, alt: '' })), photographer: 'Gala Photos Co' },
    { slug: 'golf', title: 'Example Golf Day', date: ymd(NOW + 40 * DAY), status: 'upcoming', location: 'Example Club', time: '8 a.m.', category: 'fundraiser', image: `${CF}/events/golf/hero/public`, photos: [], ticketUrl: 'https://www.zeffy.com/example' },
  ];
  const community = [{ slug: 'school', name: 'Example School', year: `${y - 1} - ${y}`, description: 'A sensory room for the whole school.', heroImage: `${CF}/community/school/hero/public`, photos: pics('school', 10, NOW - 200 * DAY).map((p) => ({ ...p, url: p.url.replace('/kids/', '/community/') })), story: 'x' }];
  const liveAt = new Date(NOW - 5 * DAY);
  liveAt.setUTCHours(21, 0, 31, 0);
  const broadcasts = [{
    id: 'live-1', kid_slug: 'ava', kid_name: 'Ava', live_at: liveAt.toISOString(), ended_at: new Date(+liveAt + 12 * 60e3).toISOString(), live_video_uid: UID('b'), replay_uid: UID('b'),
    fb_permalink: 'https://www.facebook.com/example/videos/1',
    data: JSON.stringify({ reel: { sourceUid: UID('b'), cut: { start: 444, end: 463, coverSeconds: 454 }, caption: 'Ava rolled into her new bathroom for the first time on Friday, and that smile says it all.\n\nThank you to everyone who made it happen.\n\n#SunshineOnARanneyDay #DreamsBuiltHere', permalink: 'https://www.instagram.com/reel/EXAMPLE/', publishedAt: new Date(NOW - 4 * DAY).toISOString(), facebook: { permalink: 'https://www.facebook.com/reel/1/' } } }),
  }];
  const reveals = {
    reveals: [], updatedAt: new Date(NOW - 3600e3).toISOString(),
    upcoming: [
      { slug: 'dee', name: 'Dee', confirmed: true, date: ymd(NOW + 9 * DAY), time: '14:00', rooms: ['Accessible Bathroom'] },
      { slug: 'ben', name: 'Ben', confirmed: false, window: { label: 'mid next month', through: ymd(NOW + 30 * DAY) }, rooms: ['Dream Bedroom'] },
    ],
    past: [{ slug: 'ava', name: 'Ava', date: ymd(+liveAt) }],
  };
  return { kids, events, community, broadcasts, reveals };
}
const W = REAL ? JSON.parse(readFileSync(REAL, 'utf8')) : fakeWorld();
const KID = process.env.MEDIA_WALK_KID || (REAL ? W.broadcasts.find((b) => b.live_at)?.kid_slug : 'ava');

async function seed() {
  const DB = await createD1({ schemaSql: [
    'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
    'CREATE TABLE events (slug TEXT PRIMARY KEY, title TEXT, data TEXT)',
    'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    `CREATE TABLE broadcasts (id TEXT PRIMARY KEY, kid_slug TEXT, kid_name TEXT, title TEXT, message TEXT, image TEXT, scheduled_at TEXT, live_at TEXT, ended_at TEXT, phase TEXT,
      live_video_uid TEXT, replay_uid TEXT, fb_live_video_id TEXT, fb_permalink TEXT, source TEXT, data TEXT, created_at TEXT, updated_at TEXT)`,
  ] });
  for (const k of W.kids) await DB.prepare('INSERT INTO kids VALUES (?, ?, ?)').bind(k.slug, k.name, JSON.stringify(k)).run();
  for (const e of W.events) await DB.prepare('INSERT INTO events VALUES (?, ?, ?)').bind(e.slug, e.title, JSON.stringify(e)).run();
  for (const p of W.community) await DB.prepare('INSERT INTO community VALUES (?, ?, ?)').bind(p.slug, p.name, JSON.stringify(p)).run();
  for (const b of W.broadcasts) {
    await DB.prepare('INSERT INTO broadcasts (id, kid_slug, kid_name, live_at, ended_at, live_video_uid, replay_uid, fb_permalink, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(b.id, b.kid_slug, b.kid_name, b.live_at, b.ended_at, b.live_video_uid || null, b.replay_uid || null, b.fb_permalink || null, b.data || '{}').run();
  }
  await DB.prepare("INSERT INTO site_config VALUES ('reveals', ?, ?)").bind(JSON.stringify(W.reveals), new Date().toISOString()).run();
  return DB;
}
const env = { DB: await seed(), CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok' };

// ─── A picture for any id (the made-up world), and a fake Stream for both ───
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
const picCache = new Map();
async function picture(id, { w = 800, jpeg = false } = {}) {
  const key = `${id}|${w}|${jpeg}`;
  if (picCache.has(key)) return picCache.get(key);
  const tall = hue(id) % 3 === 0;
  const W2 = Math.min(1600, w);
  const H2 = Math.round(tall ? W2 * 1.33 : W2 * 0.72);
  const h1 = hue(id);
  const label = String(id).split('/').slice(-1)[0].replace(/^\d{13}-/, '').slice(0, 24);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},55%,72%)"/><stop offset="1" stop-color="hsl(${(h1 + 50) % 360},50%,48%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${W2 * 0.7}" cy="${H2 * 0.32}" r="${W2 * 0.12}" fill="rgba(255,255,255,0.35)"/><path d="M0 ${H2 * 0.78} L${W2 * 0.35} ${H2 * 0.5} L${W2 * 0.6} ${H2 * 0.7} L${W2} ${H2 * 0.45} L${W2} ${H2} L0 ${H2}Z" fill="rgba(0,0,0,0.18)"/><text x="50%" y="92%" font-family="Helvetica" font-size="${Math.round(W2 / 18)}" fill="rgba(255,255,255,0.9)" text-anchor="middle">${label}</text></svg>`;
  const buf = await sharp(Buffer.from(svg))[jpeg ? 'jpeg' : 'png']({ quality: 80 }).toBuffer();
  picCache.set(key, buf);
  return buf;
}
const mp4Ready = new Map(); // uid → asks until ready
const realFetch = globalThis.fetch;
const streamSeen = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const m = url.match(/^https:\/\/imagedelivery\.net\/[^/]+\/(.+)\/([^/]+)$/);
  if (m && !REAL) return new Response(await picture(m[1], { w: 1600, jpeg: true }), { headers: { 'Content-Type': 'image/jpeg' } });
  if (m) return realFetch(input, init);
  if (/api\.cloudflare\.com\/client\/v4\/accounts\/acct\/stream/.test(url)) {
    streamSeen.push(`${init.method || 'GET'} ${url.replace(/^.*\/stream/, '/stream')}`);
    const dl = url.match(/\/stream\/([a-f0-9]{32})\/downloads$/);
    if (dl) {
      const n = (mp4Ready.get(dl[1]) ?? 2) - ((init.method || 'GET') === 'GET' ? 0 : 0);
      mp4Ready.set(dl[1], n - 1);
      const ready = n <= 0;
      return Response.json({ success: true, result: { default: { status: ready ? 'ready' : 'inprogress', percentComplete: ready ? 100 : 37.5, url: `https://customer-cuav5h47lgfe96ql.cloudflarestream.com/${dl[1]}/downloads/default.mp4` } } });
    }
    const one = url.match(/\/stream\/([a-f0-9]{32})$/);
    if (one) return Response.json({ success: true, result: { uid: one[1], requireSignedURLs: false, readyToStream: true } });
    if (/\/stream\?limit=/.test(url)) {
      // (the made-up world's purged video isn't in the library; a real copy is answered as if every video were)
      const uids = W.streamAlive ? new Set(W.streamAlive)
        : new Set([...W.kids.flatMap((k) => [k.streamVideoId, String(k.revealVideoUrl || '').split('/').pop()]), ...W.broadcasts.map((b) => b.replay_uid)].filter((u) => u && (REAL || u !== UID('f'))));
      return Response.json({ success: true, result: [...uids].map((uid) => ({ uid, duration: 60 + (hue(uid) % 900), size: (hue(uid) + 40) * 2_500_000, readyToStream: true })) });
    }
  }
  if (/cloudflarestream\.com\/.+(\.mp4|clip\.mp4)/.test(url)) return new Response(new Uint8Array(4096).fill(1), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4096' } });
  return realFetch(input, init);
};

// ─── The pages ────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const base of [join(ROOT, 'public'), join(ROOT, 'dist')]) {
    let f = join(base, p);
    try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); const b = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); return res.end(b); } catch { /* next */ }
  }
  res.writeHead(404); res.end('not found');
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const listOf = (dir) => {
  const rows = { 'src/content/kids': W.kids, 'src/content/events': W.events, 'src/content/community': W.community }[dir] || [];
  return rows.map((c) => ({ name: `${c.slug}.json`, path: `${dir}/${c.slug}.json`, sha: c.slug, content: c }));
};
const asked = [];
async function answer(req) {
  const url = new URL(req.url());
  const p = url.pathname;
  const json = (o, status = 200) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(o) });
  if (url.origin !== SITE) {
    if (!REAL && url.hostname === 'imagedelivery.net') {
      const [, , ...rest] = url.pathname.split('/');
      const opts = rest.pop();
      const w = Number((opts.match(/w=(\d+)/) || [])[1]) || 800;
      return req.respond({ status: 200, contentType: 'image/png', body: await picture(rest.join('/'), { w }) });
    }
    if (!REAL && /cloudflarestream\.com\/.+\/thumbnails\//.test(url.href)) return req.respond({ status: 200, contentType: 'image/png', body: await picture(url.pathname.split('/')[1] + url.search, { w: 640 }) });
    if (/cloudflarestream\.com\/.+\/iframe/.test(url.href)) return req.respond({ status: 200, contentType: 'text/html', body: '<body style="margin:0;background:#111;color:#bbb;font:16px sans-serif;display:grid;place-items:center;height:100vh">Stream player</body>' });
    return false;
  }
  if (!p.startsWith('/api/')) return false;
  const handler = { '/api/media-admin': mediaAdmin, '/api/media-download': mediaDownload }[p];
  if (handler) {
    asked.push(`${req.method()} ${p}${url.search}`);
    const method = req.method() === 'POST' ? 'onRequestPost' : 'onRequestGet';
    const headers = req.headers();
    const request = new Request(`https://admin.test${p}${url.search}`, { method: req.method(), body: req.method() === 'POST' ? req.postData() : undefined, headers: { 'content-type': headers['content-type'] || 'application/json' } });
    const res = await handler[method]({ env, request, data: { userEmail: 'staff@soardcharity.com' }, waitUntil: () => {} });
    return req.respond({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  }
  if (p === '/api/list-content') { const items = listOf(url.searchParams.get('dir')); return json({ success: true, items, count: items.length, total: items.length, pages: 1 }); }
  if (p.startsWith('/api/pending-changes')) return json({ success: true, changes: [], publish: { live: null, active: null, failed: null } });
  if (p.startsWith('/api/live-ws')) return req.abort();
  return json({ success: true, ok: true, items: [], list: [], entries: [] });
}

const browser = await puppeteer.launch({ headless: true, args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
async function open(hash = '#media', width = 1440, height = 1000) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: width < 500 ? 2 : 1, isMobile: width < 500, hasTouch: width < 500 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|Content Security Policy|live-ws/.test(m.text())) errors.push(m.text()); });
  await answerAsks(page);
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    if (req.isInterceptResolutionHandled()) return;
    try { if ((await answer(req)) !== false) return; req.continue(); } catch (e) { errors.push(`mock: ${e.message}`); req.continue().catch(() => {}); }
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true });
  await page.goto(`${SITE}/admin/index.html${hash}`, { waitUntil: 'networkidle2' });
  return { page, errors };
}
async function shot(page, name, { full = true } = {}) {
  const vp = page.viewport();
  if (full) {
    const h = Math.min(5200, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector('.main')?.scrollHeight || 0)));
    await page.setViewport({ ...vp, height: Math.max(vp.height, h) });
    await sleep(400);
  }
  await page.screenshot({ path: join(OUT, name) });
  if (full) await page.setViewport(vp);
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText).catch(() => '');
const clickText = (page, sel, re) => page.evaluate((s, src, flags) => {
  const r = new RegExp(src, flags);
  const el = [...document.querySelectorAll(s)].find((x) => x.offsetParent !== null && r.test(x.textContent.trim()));
  if (el) { el.click(); return true; }
  return false;
}, sel, re.source, re.flags);
const downloaded = () => readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload'));
async function waitForFile(name, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (downloaded().includes(name)) return statSync(join(DOWNLOADS, name)).size; await sleep(150); }
  return 0;
}
async function axe(page, where) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await window.axe.run(document.querySelector('.md') || document, { resultTypes: ['violations'] })).violations
    .filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(!r.length, `axe on ${where}: no serious problems${r.length ? ` (${r.join('; ')})` : ''}`);
}

let page;
let errors;
const kidName = W.kids.find((k) => k.slug === KID)?.name || KID;
await section('The area: in the menu, What’s happening, the albums', async () => {
  ({ page, errors } = await open('#media'));
  await page.waitForSelector('.md-grid', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.md-act').length > 0, { timeout: 10000 });
  await sleep(1200);
  ok(/Photos & Videos/.test(await text(page, '.nav-item.active')), 'Photos & Videos is the current place in the menu');
  const ahead = await page.$$eval('.md-now__col:first-child .md-act', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  const recent = await page.$$eval('.md-now__col:last-child .md-act', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  console.log(`    coming up: ${ahead.length}, recently: ${recent.length}`);
  if (!REAL) {
    ok(/Dee’s reveal/.test(ahead[0]) && /at 2:00 PM/.test(ahead[0]), 'the confirmed reveal comes first, with its day and time');
    ok(ahead.some((x) => /Ben’s reveal/.test(x) && /Tentative/.test(x) && /not confirmed yet/.test(x)), 'a tentative reveal says so');
    ok(ahead.some((x) => /Example Golf Day/.test(x) && /Tickets/.test(x)), 'the event coming up, with its tickets link');
    ok(recent.some((x) => /Ava’s reveal went live/.test(x) && /12 minute recording/.test(x)), 'the live reveal, with how long it ran');
    ok(recent.some((x) => /Ava’s Reel is posted/.test(x) && /Copy caption/.test(x)), 'the Reel, with its caption to copy');
    ok(recent.some((x) => /new photos of Ava/.test(x) && /Example Photography/.test(x)), 'the new photos, with who took them');
    const cards = await page.$$eval('.md-card .md-card__name', (els) => els.map((e) => e.textContent));
    ok(!cards.includes('Draft Kid'), 'a draft kid has no album');
    ok(cards[0] === 'Dee', 'the next reveal’s album leads');
    ok(/Reveal/.test(await text(page, '.md-card')), 'its card says when the reveal is');
  }
  await shot(page, '1-home.png');
  await shot(page, '1-home-top.png', { full: false });
  await axe(page, 'the albums');
});

await section('A reveal’s album: credit, caption, videos, photos, before and after', async () => {
  await page.evaluate((k) => [...document.querySelectorAll('.md-card')].find((a) => a.getAttribute('href') === `#media/kid/${k}`)?.click(), KID);
  await page.waitForSelector('.md-album__head', { timeout: 10000 });
  await sleep(1500);
  ok(page.url().endsWith(`#media/kid/${KID}`), 'the address names the album');
  ok((await text(page, '.md-album__head h2')).startsWith(kidName), 'the album’s name');
  const facts = await text(page, '.md-facts');
  ok(/On the website/i.test(facts) && /Copy link/.test(facts), 'its page on the website, to copy');
  if (!REAL) {
    ok(/Example Photography/.test(facts) && /Copy credit/.test(facts), 'the photographer, with Copy credit');
    ok(/Caption from the Reel/.test(await text(page, '.md')), 'the Reel’s caption');
    const vids = await page.$$eval('.md-vcard__label', (els) => els.map((e) => e.textContent));
    ok(vids.join('|') === 'Makeover video|Live reveal|Reel clip', `the videos: ${vids.join(', ')}`);
    ok(await page.$$eval('.md-pair', (e) => e.length) === 1, 'one before and after pair');
    const befores = await page.$$eval('#md-b-h', (e) => e.length);
    ok(befores === 1 && !(await page.content()).includes('before-kept-off'), 'before photos, never one kept off the page');
  }
  await shot(page, '2-album.png');
  await shot(page, '2-album-top.png', { full: false });
  await axe(page, 'an album');
});

await section('A photo opens big and steps with the arrows; Escape closes', async () => {
  await page.click('.md-pgrid .md-tile__open');
  await page.waitForSelector('.md-lb img', { timeout: 5000 });
  await sleep(800);
  const t1 = await text(page, '.md-lb__title');
  await page.keyboard.press('ArrowRight');
  await sleep(500);
  const t2 = await text(page, '.md-lb__title');
  ok(/1 of/.test(t1) && /2 of/.test(t2), `the arrows step through (${t1.replace(/\s+/g, ' ')} → ${t2.replace(/\s+/g, ' ')})`);
  ok(/SOARD-.+-02\.jpg/.test(t2), 'the file name it downloads as');
  await shot(page, '3-viewer.png', { full: false });
  await page.keyboard.press('Escape');
  await sleep(300);
  ok(!(await page.$('.md-lb')), 'Escape closes it');
});

await section('Downloads: one photo, two picked as a ZIP, the whole album as a ZIP', async () => {
  const before = asked.length;
  await page.evaluate(() => document.querySelector('.md-pgrid .md-tile__dl').click());
  const first = (await page.$eval('.md-pgrid .md-tile__dl', (a) => a.getAttribute('href')));
  const want = W.kids.find((k) => k.slug === KID);
  const fname = `SOARD-${kidName.replace(/&/g, 'and').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${want.year}-01.jpg`;
  const size = await waitForFile(fname);
  ok(size > 1000, `one photo downloads full size as ${fname} (${Math.round(size / 1024)} KB)`);
  ok(asked.slice(before).some((a) => a.includes('image=')) && first.includes(`album=kid%3A${KID}`), 'it names its album');

  const checks = await page.$$('.md-pgrid .md-tile__check');
  await checks[0].click();
  await checks[2].click();
  await sleep(300);
  ok(/2 photos picked/.test(await text(page, '.md-pickbar')), 'the bar counts what’s picked');
  await shot(page, '4-picked.png', { full: false });
  await clickText(page, '.md-pickbar button', /Download ZIP/);
  const zipName = `SOARD-${fname.replace(/^SOARD-|-01\.jpg$/g, '')}-selected-photos.zip`;
  const zsize = await waitForFile(zipName, 30000);
  ok(zsize > 1000, `the two picked download as ${zipName}`);
  if (zsize) {
    const list = execFileSync('unzip', ['-Z1', join(DOWNLOADS, zipName)], { encoding: 'utf8' }).trim().split('\n');
    ok(list.length === 3 && list.at(-1) === 'About these photos.txt', `two photos and the note (${list.join(', ')})`);
    ok(/No errors/.test(execFileSync('unzip', ['-t', join(DOWNLOADS, zipName)], { encoding: 'utf8' })), 'every file in it checks out');
  }
  ok(asked.some((a) => a.startsWith('POST /api/media-download')), 'the picked ones went as a form post');

  // (with real photos the whole album is a ZIP of 100+ MB, more than the browser's request interception can hand over
  // in one piece: the walk checks the link, and tests/media.test.mjs and a direct run check the file itself)
  if (REAL) {
    ok(/zip=all/.test(await page.$eval('.md-album__actions a', (a) => a.getAttribute('href'))), 'Download all photos is the whole album as one ZIP');
    return;
  }
  await clickText(page, '.md-album__actions a', /Download all photos/);
  const allName = zipName.replace('-selected-photos', '-photos');
  const asize = await waitForFile(allName, 60000);
  ok(asize > 1000, `the whole album downloads as ${allName} (${Math.round(asize / 1024)} KB)`);
  if (asize) ok(/No errors/.test(execFileSync('unzip', ['-t', join(DOWNLOADS, allName)], { encoding: 'utf8' })), 'every file in the whole album’s ZIP checks out');
  ok(!(await page.url()).includes('/api/'), 'the page stays where it was');
});

await section('A video’s MP4: Stream makes it, the button says so, then it downloads', async () => {
  const live = await page.evaluateHandle(() => [...document.querySelectorAll('.md-vcard')].find((c) => /Live reveal|Makeover video/.test(c.querySelector('.md-vcard__label')?.textContent)));
  const btn = await live.$('button.btn');
  if (!btn) { ok(false, 'a Download MP4 button'); return; }
  await btn.click();
  await page.waitForFunction(() => document.querySelector('.md-making'), { timeout: 5000 }).catch(() => {});
  const making = await page.$eval('.md-making', (e) => e.textContent).catch(() => '');
  ok(/making the MP4/.test(making), `while Stream makes it: “${making.trim().replace(/\s+/g, ' ')}”`);
  await shot(page, '5-video-making.png', { full: false });
  // (the Reel's own button is a link from the start: it's cut as it downloads)
  const readyHere = () => live.evaluate((c) => c.querySelector('a.btn-primary')?.getAttribute('href') || '');
  const end = Date.now() + 25000;
  let href = '';
  while (!href && Date.now() < end) { href = await readyHere(); if (!href) await sleep(300); }
  ok(!!href, 'once it’s ready, Download MP4 is a link');
  if (href) {
    const mp4s = () => downloaded().filter((f) => f.endsWith('.mp4'));
    const until = Date.now() + 8000;
    while (!mp4s().length && Date.now() < until) await sleep(200);
    ok(mp4s().length > 0, `the MP4 downloaded by itself once ready (${mp4s().join(', ')})`);
  }
  ok(streamSeen.some((s) => s.startsWith('GET /stream/') && s.endsWith('/downloads')), 'Stream was asked about the MP4');
});

await section('Back returns to the albums; the Videos and Events tabs', async () => {
  await page.goBack();
  await page.waitForSelector('.md-grid', { timeout: 5000 });
  ok(/#media$/.test(page.url()), 'Back is the albums again');
  await clickText(page, '.md-tabs .hub-tab', /^Videos/);
  await page.waitForSelector('.md-vgrid', { timeout: 5000 });
  await sleep(800);
  ok(/#media\/videos$/.test(page.url()), 'the Videos tab has its own address');
  ok((await page.$$('.md-vcard')).length > 0, `${(await page.$$('.md-vcard')).length} videos`);
  if (!REAL) {
    const names = await page.$$eval('.md-vcard .md-linkbtn', (els) => els.map((e) => e.textContent));
    ok(!names.some((n) => /Old Timer/.test(n)), 'a video Stream purged isn’t offered');
    await page.evaluate(() => { location.hash = '#media/kid/old-timer'; });
    await page.waitForSelector('.md-album__head', { timeout: 10000 });
    await sleep(500);
    ok(/Open on YouTube/.test(await text(page, '.md-vcard')) && !(await page.$('.md-vcard button.btn')), 'its album offers the YouTube link instead, no MP4');
    await page.evaluate(() => { location.hash = '#media/videos'; });
    await page.waitForSelector('.md-vgrid', { timeout: 10000 });
  }
  await shot(page, '6-videos.png');
  await clickText(page, '.md-tabs .hub-tab', /^Events/);
  await sleep(600);
  await shot(page, '7-events.png', { full: false });
  ok(!errors.length, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
});

await section('A phone: nothing wider than the screen', async () => {
  const phone = await open('#media', 390, 844);
  await phone.page.waitForSelector('.md-grid', { timeout: 20000 });
  await sleep(1200);
  // (a strip that scrolls sideways, like the tabs, may run past the edge)
  const wide = await phone.page.evaluate(() => [...document.querySelectorAll('.md *')]
    .filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent !== null)
    .filter((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return false; return true; })
    .map((e) => e.className).slice(0, 4));
  ok(!wide.length, `nothing spills past the edge${wide.length ? ` (${wide.join(', ')})` : ''}`);
  await shot(phone.page, '8-phone-home.png', { full: false });
  await phone.page.goto(`${SITE}/admin/index.html#media/kid/${KID}`, { waitUntil: 'networkidle2' });
  await phone.page.waitForSelector('.md-album__head', { timeout: 10000 });
  await sleep(1200);
  await shot(phone.page, '9-phone-album.png', { full: false });
  ok(!phone.errors.length, `no errors on the phone${phone.errors.length ? `: ${phone.errors.slice(0, 3).join(' | ')}` : ''}`);
});

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nAll good.');
console.log(`Screenshots: ${OUT}`);
process.exit(failures.length ? 1 : 0);
