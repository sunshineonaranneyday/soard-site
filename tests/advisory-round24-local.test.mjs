/**
 * Advisory Board QA round 24 (Nov 23 2026), the tester's harness note: the built page's Cloudflare analytics beacon reached
 * cloudflareinsights.com from 127.0.0.1 on every local run. The test servers strip it from every page they serve
 * (tests/lib/local-only.mjs). scripts/check-local-run.mjs loads a QA server's pages in a browser and lists every request
 * off this machine (none, after this round). Made-up content only.
 * Run: node --test tests/advisory-round24-local.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
// (the lines the site's layout writes, as built: src/layouts/BaseLayout.astro)
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="dns-prefetch" href="https://static.cloudflareinsights.com">
<link rel="preload" href="/fonts/outfit-latin-variable.woff2" as="font" type="font/woff2" crossorigin>
<script>addEventListener('load',function(){setTimeout(function(){if(document.querySelector('script[src*="cloudflareinsights.com/beacon"]'))return;var s=document.createElement('script');s.defer=true;s.src='https://static.cloudflareinsights.com/beacon.min.js';s.setAttribute('data-cf-beacon','{"token": "x"}');document.head.appendChild(s)},0)},{once:true})</script>
<script type="module" src="/_astro/page.js"></script><script>window.kept = 1</script>
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "x"}'></script>
</head><body><p>Apply</p></body></html>`;

const helper = async () => (existsSync(`${ROOT}tests/lib/local-only.mjs`) ? import('./lib/local-only.mjs') : {});

test('7: a page goes out without the beacon (its dns-prefetch link, the script that adds it, the beacon\'s own tag), the rest as it was', async () => {
  const { withoutBeacon, servesPage } = await helper();
  assert.equal(typeof withoutBeacon, 'function', 'tests/lib/local-only.mjs (round 24)');
  const out = withoutBeacon(PAGE);
  assert.ok(!/cloudflareinsights/i.test(out), out);
  for (const kept of ['<link rel="preload" href="/fonts/outfit-latin-variable.woff2"', '<script type="module" src="/_astro/page.js"></script>', '<script>window.kept = 1</script>', '<p>Apply</p>']) assert.ok(out.includes(kept), kept);
  assert.equal(withoutBeacon('<p>no beacon here</p>'), '<p>no beacon here</p>');
  assert.equal(servesPage('/x/index.html', Buffer.from(PAGE)).toString().includes('cloudflareinsights'), false);
  const js = Buffer.from("const u = 'https://static.cloudflareinsights.com';");
  assert.equal(servesPage('/x/app.js', js), js, 'anything that isn\'t a page goes as it is');
  // (at once on a page of 2 MB: one look at each character)
  const big = PAGE.replace('<p>Apply</p>', `<p>${'<b>x</b>'.repeat(250000)}</p>`);
  const t = performance.now();
  withoutBeacon(big);
  assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)} ms`);
});

test('7: every Advisory Board suite\'s server, and the bot trap\'s (which serve the built pages), sends its pages through it', () => {
  const suites = readdirSync(`${ROOT}scripts`).filter((f) => /^test-advisory-.*\.mjs$/.test(f) || f === 'test-bot-trap.mjs');
  assert.ok(suites.length >= 10, suites.join(' '));
  // (imported with the file's own imports, before any template: one inside a page the file writes is never imported)
  const missing = suites.filter((f) => {
    const s = readFileSync(`${ROOT}scripts/${f}`, 'utf8');
    const head = s.slice(0, s.indexOf('`') < 0 ? s.length : s.indexOf('`'));
    return /createServer/.test(s) && (!/servesPage\(/.test(s) || !/^import \{ servesPage \} from '\.\.\/tests\/lib\/local-only\.mjs';$/m.test(head));
  });
  assert.deepEqual(missing, [], 'a suite server that serves pages with the beacon');
});
