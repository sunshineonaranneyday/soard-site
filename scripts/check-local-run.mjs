/**
 * A local run makes no request off this machine (Advisory Board QA round 24, Nov 23 2026: the built page's Cloudflare
 * analytics beacon reached cloudflareinsights.com from 127.0.0.1). Starts a QA server on a built site, opens its pages in a
 * headless browser, and lists every request the page makes (each one the browser starts, answered or not) and every
 * dns-prefetch or preconnect link left in the page. Passes only when all of them are 127.0.0.1, data: or blob:.
 *   node scripts/check-local-run.mjs <qa-server.mjs> <worktree> <dist> <port> [path ...]
 * Exit 0 when nothing leaves; 1 with the list otherwise.
 */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const [SERVER, WT, DIST, PORT, ...paths] = process.argv.slice(2);
if (!SERVER || !WT || !DIST || !PORT) { console.error('node scripts/check-local-run.mjs <qa-server.mjs> <worktree> <dist> <port> [path ...]'); process.exit(2); }
const PATHS = paths.length ? paths : ['/advisory-board/apply/'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [SERVER, WT, DIST, PORT], { stdio: ['ignore', 'pipe', 'pipe'] });
const up = new Promise((res, rej) => {
  server.stdout.on('data', (d) => { if (/on http/.test(String(d))) res(); });
  server.on('exit', (c) => rej(new Error(`the server stopped (${c})`)));
  setTimeout(() => rej(new Error('the server didn\'t start in 30 s')), 30000);
});
const outside = [];
let browser = null;
try {
  await up;
  browser = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  for (const path of PATHS) {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    // (every request the browser starts, whatever answers it)
    cdp.on('Network.requestWillBeSent', (e) => { const u = e.request.url; if (!/^(?:data:|blob:|http:\/\/127\.0\.0\.1:)/.test(u)) outside.push(`${path}: ${u}`); });
    await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'networkidle0', timeout: 60000 });
    // (the beacon is added after load, and sends a while later)
    await sleep(4000);
    const hints = await page.$$eval('link[rel~="dns-prefetch"], link[rel~="preconnect"]', (ls) => ls.map((l) => l.href));
    for (const h of hints) if (!/^http:\/\/127\.0\.0\.1:/.test(h)) outside.push(`${path}: a ${'dns-prefetch or preconnect'} link to ${h}`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
const seen = [...new Set(outside)];
console.log(seen.length ? `off this machine (${seen.length}):\n${seen.join('\n')}` : `${PATHS.join(', ')}: every request on 127.0.0.1`);
process.exit(seen.length ? 1 : 0);
