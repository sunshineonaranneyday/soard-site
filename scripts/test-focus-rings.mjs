/**
 * test-focus-rings.mjs — rings follow the Tab key, in a real browser
 * ===================================================================
 * Peter, Nov 26 2026: "there seems to be left over hover rings on a bunch of stuff ... i hate it!"
 * (src/utils/focus-rings.ts). With a mouse at 1440px:
 *   - a clicked button or link shows no ring after an arrow, Page Down, Shift or Escape, nor a link after Space,
 *     and keeps the focus (Tab carries on from it)
 *   - Space still presses a clicked button (the kid page's Continue reading opens), and leaves no ring on it
 *   - a gala photo opened with the mouse, stepped with an arrow and closed with Escape: the focus is back on the
 *     photo it showed, with no ring; the same for the header's menus and Add to calendar
 *   - an arrow key that moves the focus into a header menu opened with the mouse keeps its ring there
 *   - dragging a before/after slider (a kid page, How It Works) leaves no ring round the photos; a kid page's sort
 *     and year buttons none after a choice
 *   - a text field keeps its ring when a key is pressed
 * With the keyboard: Tab shows the ring, and a gala photo opened with Enter and closed with Escape gets its ring
 * back; a before/after slider reached with the keyboard rings the photos. No console errors. Screenshots land in
 * test-results/focus-rings/. Exits non-zero on any failure.
 *
 *   SITE=http://localhost:4321 node scripts/test-focus-rings.mjs
 * Without SITE it starts `astro dev` on a spare port and stops it after. While dev syncs the site's content
 * ("[dev-sync] Change detected"), it reloads the page mid-run ("Execution context was destroyed"): run it again, or
 * test a build instead (npx astro build --outDir <dir>, then serve <dir> statically).
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/focus-rings/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

let SITE = process.env.SITE?.replace(/\/$/, '');
let dev = null;
if (!SITE) {
  const port = 4300 + Math.floor(Math.random() * 600);
  dev = spawn('npx', ['astro', 'dev', '--port', String(port), '--ignore-lock'], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  SITE = `http://localhost:${port}`;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('astro dev did not start within 2 minutes')), 120000);
    const seen = (b) => { if (/Local\s+http/.test(String(b))) { clearTimeout(t); resolve(); } };
    dev.stdout.on('data', seen);
    dev.stderr.on('data', seen);
    dev.on('exit', (code) => { clearTimeout(t); reject(new Error(`astro dev exited (${code})`)); });
  });
}
const stopDev = () => { if (dev) try { process.kill(-dev.pid); } catch {} };

const browser = await puppeteer.launch({ headless: 'new', args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });

async function open(path) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' && !/\[vite\]|astro-dev-toolbar|Failed to load resource|WebSocket connection to .*\/api\/|cloudflareinsights/.test(m.text())) errors.push(`${path}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${path}: ${e}`));
  await page.goto(SITE + path, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.evaluate(() => document.querySelector('astro-dev-toolbar')?.remove());
  // Links leave the page in a real visit; here a click on one stays put so its focus can be checked
  await page.evaluate(() => document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (a && !a.getAttribute('href').startsWith('#') && !a.closest('[data-keep-click]')) e.preventDefault();
  }, true));
  await sleep(600);
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

/** What has the focus, and whether it shows a ring */
const focus = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { el: !el || el === document.body ? 'body' : `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, ring: !!el && el.matches(':focus-visible'), id: el?.dataset.ringTest || '' };
});
/** Click the first visible element matching sel with the mouse; tag it so the focus can be traced back */
async function clickOn(page, sel, tag = 'x') {
  const box = await page.evaluate((sel, tag) => {
    // (the first one a click would reach: on screen once scrolled to, not under the sticky header)
    const el = [...document.querySelectorAll(sel)].find((e) => {
      const r0 = e.getBoundingClientRect();
      if (r0.width <= 4 || r0.height <= 4 || getComputedStyle(e).visibility === 'hidden') return false;
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit && (hit === e || e.contains(hit));
    });
    if (!el) return null;
    el.dataset.ringTest = tag;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel, tag);
  if (!box) throw new Error(`nothing to click for ${sel}`);
  // Press it where it is once it has stopped moving (a story closing or a picture arriving can move it after the
  // scroll), and again if the press didn't reach it: a missed click would be the test's, not the page's
  for (let tries = 0; tries < 4; tries++) {
    let at = null;
    for (let i = 0; i < 10; i++) {
      await sleep(150);
      const now = await page.$eval(`[data-ring-test="${tag}"]`, (el) => {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
        return { x, y, hit: !!hit && (hit === el || el.contains(hit)) };
      });
      if (at && now.hit && Math.abs(now.x - at.x) < 1 && Math.abs(now.y - at.y) < 1) break;
      at = now;
    }
    await page.$eval(`[data-ring-test="${tag}"]`, (el) => { el.dataset.pressed = ''; el.addEventListener('pointerdown', () => { el.dataset.pressed = '1'; }, { once: true }); });
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    await sleep(450);
    if (await page.$eval(`[data-ring-test="${tag}"]`, (el) => el.dataset.pressed === '1')) return at;
  }
  throw new Error(`the mouse never reached ${sel}`);
}

async function keysAfterClick() {
  console.log('\nKeys after a click (/kids/dex/)');
  const page = await open('/kids/dex/');
  // Space on a clicked link scrolls the page: no ring
  await clickOn(page, 'main a[href="/kids/"]', 'link');
  await page.keyboard.press(' ');
  await sleep(300);
  let f = await focus(page);
  ok(f.id === 'link' && !f.ring, `a clicked link shows no ring after Space (${f.el}, ring ${f.ring})`);
  for (const key of ['ArrowDown', 'PageDown', 'Shift', 'Escape']) {
    await clickOn(page, '#story-expand', 'story');
    if ((await page.$eval('#story-expand', (b) => b.getAttribute('aria-expanded'))) === 'true') await clickOn(page, '#story-expand', 'story');
    await page.keyboard.press(key);
    await sleep(200);
    f = await focus(page);
    ok(f.id === 'story' && !f.ring, `a clicked button keeps the focus with no ring after ${key} (${f.el}, ring ${f.ring})`);
  }
  // Space on a clicked button presses it, as always
  await clickOn(page, '#story-expand', 'story');
  const before = await page.$eval('#story-expand', (b) => b.getAttribute('aria-expanded'));
  await page.keyboard.press(' ');
  await sleep(600);
  const after = await page.$eval('#story-expand', (b) => b.getAttribute('aria-expanded'));
  ok(before !== after, `Space still presses a clicked button (Continue reading ${before} → ${after})`);
  f = await focus(page);
  ok(f.id === 'story' && !f.ring, `and leaves no ring on it (${f.el}, ring ${f.ring})`);
  // Tab from there: the ring comes back at once
  await page.keyboard.press('Tab');
  await sleep(200);
  f = await focus(page);
  ok(f.ring, `Tab after a click shows the ring at once (${f.el})`);
  // A text field keeps its ring when a key is pressed
  await clickOn(page, '.newsletter-input', 'mail');
  await page.keyboard.press('ArrowLeft');
  await sleep(200);
  f = await focus(page);
  ok(f.id === 'mail' && f.ring, `a text field keeps its ring (${f.el}, ring ${f.ring})`);
  await page.close();
}

async function closedWithEscape() {
  console.log('\nOpened with the mouse, closed with Escape (/events/gala/, /events/)');
  let page = await open('/events/gala/');
  await clickOn(page, '.rp-tile', 'tile');
  const opened = await page.waitForSelector('dialog[open]', { timeout: 3000 }).then(() => true, () => false);
  await sleep(400);
  ok(opened, 'a gala photo opens its viewer');
  await page.keyboard.press('ArrowRight');
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(700);
  // (back to the photo the viewer was showing: one on from the one clicked)
  let f = await focus(page);
  ok(f.el === 'a.rp-tile' && !f.ring, `Escape hands the focus back to the photo, with no ring (${f.el}, ring ${f.ring})`);
  await shot(page, 'gala-photo-after-escape');

  // The header's menu: opened with the mouse, an arrow moves into it (ring there), Escape back to the button (none)
  await page.evaluate(() => scrollTo(0, 0));
  await clickOn(page, 'header .nav-link[aria-haspopup], header button.nav-link', 'nav');
  await page.keyboard.press('ArrowDown');
  await sleep(300);
  f = await focus(page);
  ok(f.id !== 'nav' && f.el !== 'body' && f.ring, `an arrow into a header menu opened with the mouse keeps its ring (${f.el}, ring ${f.ring})`);
  await page.keyboard.press('Escape');
  await sleep(500);
  f = await focus(page);
  ok(f.id === 'nav' && !f.ring, `Escape closes the menu: the focus is back on its button, no ring (${f.el}, ring ${f.ring})`);
  await shot(page, 'header-after-escape');
  await page.close();

  page = await open('/events/');
  await clickOn(page, '.upn-add', 'cal');
  await page.keyboard.press('Escape');
  await sleep(500);
  f = await focus(page);
  ok(f.id === 'cal' && !f.ring, `Add to calendar closed with Escape: focus on it, no ring (${f.el}, ring ${f.ring})`);
  await page.close();
}

async function keyboardStillRings() {
  console.log('\nWith the keyboard (/events/gala/)');
  const page = await open('/events/gala/');
  await page.keyboard.press('Tab');
  await sleep(200);
  let f = await focus(page);
  ok(f.ring, `Tab shows the ring (${f.el})`);
  // To a gala photo with the keyboard, Enter, Escape: its ring comes back with the focus
  await page.evaluate(() => { const t = document.querySelector('.rp-tile'); t.dataset.ringTest = 'tile'; t.scrollIntoView({ block: 'center' }); t.focus(); });
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  await page.keyboard.press('Tab');
  await sleep(200);
  f = await focus(page);
  ok(f.id === 'tile' && f.ring, `Tab to a gala photo rings it (${f.el}, ring ${f.ring})`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open]', { timeout: 3000 });
  await sleep(500);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 3000 });
  await sleep(400);
  f = await focus(page);
  ok(f.id === 'tile' && f.ring, `opened with Enter, closed with Escape: the photo has its ring back (${f.el}, ring ${f.ring})`);
  await shot(page, 'gala-photo-keyboard');
  await page.close();
}

async function sliders() {
  for (const [path, box, range] of [['/kids/dex/', '.ba-slider__container', '.ba-slider__range'], ['/how-it-works/', '.ba__container', '.ba__range']]) {
    console.log(`\nBefore/after slider (${path})`);
    const page = await open(path);
    const b = await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, box);
    await sleep(2200);
    await page.mouse.move(b.x + b.w * 0.5, b.y + b.h / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + b.w * (0.5 - i * 0.03), b.y + b.h / 2); await sleep(16); }
    await page.mouse.up();
    await sleep(900);
    const ringAfterDrag = await page.$eval(box, (el) => getComputedStyle(el).outlineStyle !== 'none');
    ok(!ringAfterDrag, 'a drag with the mouse leaves no ring round the photos');
    await shot(page, `slider-drag-${path.replace(/\W+/g, '')}`);
    await page.keyboard.press('ArrowLeft');
    await sleep(200);
    ok(!(await page.$eval(box, (el) => getComputedStyle(el).outlineStyle !== 'none')), 'nor after an arrow key moves the line');
    // With the keyboard (Tab once, then the slider takes the focus as a Tab to it would): the photos get the ring
    await page.keyboard.press('Tab');
    await page.$eval(range, (el) => el.focus({ preventScroll: true }));
    await sleep(200);
    const onRange = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), range);
    const ringKeys = await page.$eval(box, (el) => getComputedStyle(el).outlineStyle !== 'none');
    ok(onRange && ringKeys, `with the keyboard the slider rings the photos (on the slider: ${onRange})`);
    await page.close();
  }
}

async function kidsSort() {
  console.log('\nSort and year on /kids/');
  const page = await open('/kids/');
  for (const [btn, label] of [['#sort-order-btn', 'sort'], ['#year-btn', 'year']]) {
    await clickOn(page, btn, label);
    const opt = await page.evaluate((btn) => { const m = document.getElementById(document.querySelector(btn).getAttribute('aria-controls')) || document.querySelector(btn).parentElement.querySelector('[role="listbox"]'); const o = m && [...m.querySelectorAll('[role="option"]')].find((e) => e.getBoundingClientRect().width && e.getAttribute('aria-selected') !== 'true'); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, btn);
    if (opt) { await page.mouse.click(opt.x, opt.y); await sleep(700); }
    const s = await page.$eval(btn, (el) => ({ shadow: getComputedStyle(el).boxShadow, focused: document.activeElement === el, ring: el.matches(':focus-visible') }));
    ok(!s.ring && !/0px 0px 0px 3px/.test(s.shadow), `${label}: no ring after a choice with the mouse (focused ${s.focused}, ${s.shadow.slice(0, 40)})`);
  }
  await page.close();
}

try {
  await keysAfterClick();
  await closedWithEscape();
  await keyboardStillRings();
  await sliders();
  await kidsSort();
  ok(errors.length === 0, `no console errors${errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : ''}`);
} catch (e) {
  failures.push(`crashed: ${e.stack || e}`);
  console.error(e);
} finally {
  await browser.close();
  stopDev();
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : 'All checks passed'}. Screenshots: ${OUT}`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
