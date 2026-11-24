/**
 * test-reveal-press.mjs — drive the press release in the admin in a real browser
 * ===============================================================================
 * Opens the admin (public/ served directly, every /api call stubbed with data
 * shaped like production; the press release itself drawn by the real code in
 * functions/api/_reveal-press.js) and checks:
 *   Reveals → Invites → Press release: the press list takes a pasted To line
 *   (names with commas kept), takes an address off, saves what's shown, keeps
 *   the standing words, pauses and turns back on, and previews a reveal's
 *   advisory in a sheet that Escape closes, with Draft posting for that reveal.
 *   Reveals → Now: each reveal's Press release step says where it stands (in
 *   the drafts with a link into Gmail, sent, or a Draft button that posts for
 *   that reveal alone).
 * At 390, 768, 1025, 1280 and 1440 wide in the admin's own shell: nothing
 * scrolls sideways. Screenshots land in test-results/reveal-press/. Exits
 * non-zero on any failure or console error. Made-up people only (the repo is public).
 *
 *   node scripts/test-reveal-press.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { DEFAULT_TEMPLATE, TEMPLATE_LIMITS } from '../functions/api/_reveal-invites.js';
import { pressRelease, cleanSettings, PRESS_DEFAULTS, PRESS_LIMITS, LIST_MAX, gmailLink } from '../functions/api/_reveal-press.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/reveal-press/');
mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const D = 86400e3;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const day = (n) => iso(n * D).slice(0, 10);

const SENDER = 'linzi@soardcharity.com';
const LIST = Array.from({ length: 18 }, (_, i) => ({ email: `desk${i + 1}@example-news${i % 5}.com`, name: i % 3 ? '' : `Reporter ${i + 1}` }));
let settings;
const KID = {
  name: 'Max', slug: 'max', age: 14, roomTypes: ['Accessible Bathroom'], heroImage: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/max/hero.jpg/public',
  heroSummary: 'Max has a rare genetic condition and now relies on his parents for all daily care. He needs a safe, accessible bathroom.',
  photos: [{ url: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/max/a.jpg/public' }],
};

function invitesData() {
  const preview = (name, status) => ({ title: `${name}'s Reveal Day`, status, start: { date: day(10) }, end: { date: day(11) }, location: '100 Example Way, Atlanta, GA 30301, USA', description: `This is the date for ${name}'s reveal.`, guests: [] });
  const row = (o) => ({ kidUrl: `/kids/${o.slug}/`, jobUrl: `https://app.jobtread.com/jobs/${o.jobId}`, scheduleUrl: `https://app.jobtread.com/jobs/${o.jobId}/schedule`, constructionStarted: true, status: 'Build', details: '', invite: null, kitInvite: null, kitWatch: null, pageReady: true, broadcast: null, reminderSignups: 4, checkComment: null, ...o });
  return {
    ok: true,
    config: { enabled: true, organizer: 'ccunningham@soardcharity.com', template: DEFAULT_TEMPLATE, lastSweep: { at: iso(-3600e3), checked: 20, changed: 0 } },
    checks: { enabled: false }, organizerName: 'Clareece Cunningham', defaults: DEFAULT_TEMPLATE, limits: TEMPLATE_LIMITS, setup: { jobtread: true, google: true },
    press: { enabled: settings.enabled, from: SENDER, name: 'Linzi Example', count: settings.list.length },
    upcoming: [
      row({ jobId: 'jobLiz0001', name: 'Lizzie', slug: 'lizzie', date: day(5), time: null, confirmed: true, preview: preview('Lizzie', 'confirmed') }),
      row({ jobId: 'jobMax0001', name: 'Max', slug: 'max', date: day(10), time: '16:00', confirmed: true, preview: preview('Max', 'confirmed'),
        press: { state: 'draft', at: iso(-D), count: settings.list.length, sender: SENDER, link: gmailLink(SENDER, { messageId: '18c0ffee' }) } }),
      row({ jobId: 'jobPet0001', name: 'Peter', slug: 'peter', date: day(16), time: '10:00', confirmed: true, preview: preview('Peter', 'confirmed'),
        press: { state: 'sent', at: iso(-3 * D), sentAt: iso(-2 * D), count: 17, sender: SENDER, link: gmailLink(SENDER, { messageId: '18c0ffef', sent: true }) } }),
      row({ jobId: 'jobCol0001', name: 'Colin', slug: 'colin', date: day(25), time: null, confirmed: false, preview: preview('Colin', 'tentative') }),
    ],
    board: [], advisory: [],
    live: { phase: 'idle', jobId: null, scheduledAt: null, waiting: {}, checkedAt: iso(-120e3), reminders: { enabled: true, hoursBefore: [24, 1] }, kit: { configured: true, enabled: true, audience: 'All subscribers' } },
  };
}
const adminData = () => ({
  success: true, state: { phase: 'idle', broadcastId: null, kit: {}, fb: {} }, public: { phase: 'idle', live: false, upcoming: false, replay: false },
  config: { kitLive: { enabled: true, audience: { name: 'All subscribers' } }, messages: { enabled: true }, liveInput: { uid: 'in1', enabled: true }, facebook: { mode: 'api' }, youtube: {}, instagram: {}, reminders: { enabled: true, hoursBefore: [24, 1] }, orientation: 'portrait', reels: { enabled: true }, defaults: { title: 'Live room reveal', message: "It's reveal day!" }, alerts: { emails: [] }, replayHours: 72, timezone: 'America/New_York', outputs: {} },
  setup: { streamConfigured: true, inputReady: true, hubBound: true, kitConfigured: true, emailConfigured: true, fbConfigured: true, deployHook: true, pushReady: true, alertEmails: [], webhookUrl: '' },
  health: { lastTick: { at: iso(-30e3), source: 'hub:alarm', work: [] }, stream: { ok: true }, facebook: { ok: true }, webhook: {}, lifecycle: {} },
  hub: { ok: true, clients: 1, lastTick: { at: iso(-30e3) } }, live: { lifecycle: { live: false } },
  outputs: [], recordings: [], sends: [], history: [], healthReports: {}, fbRecent: null, reminders: { counts: { email: 0 }, recent: [] }, larix: {}, playback: {},
  schedule: { checkedAt: iso(-120e3), error: null, next: null, waiting: [] },
});

function serve() {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, 'public', p));
    if (!file.startsWith(join(ROOT, 'public')) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function open(browser, base, viewport, hash) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const posts = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource') && !m.text().includes('/api/live-ws')) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    const json = (obj, status = 200) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (url.host === 'imagedelivery.net') return req.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#c9c4b8"/></svg>' });
    if (url.origin !== base) return req.abort();
    let body = null;
    if (req.method() === 'POST' && url.pathname.startsWith('/api/')) { try { body = JSON.parse(req.postData() || '{}'); } catch { /* none */ } posts.push({ path: url.pathname, body }); }
    if (url.pathname === '/api/reveal-press-admin') {
      if (req.method() === 'POST') {
        if (body?.draft) return json({ ok: true, press: 'drafted', told: true, name: 'Lizzie', jobId: body.draft });
        settings = cleanSettings(body.settings, settings);
        return json({ ok: true, settings });
      }
      if (url.searchParams.has('preview')) {
        const m = pressRelease({ kid: KID, date: day(10), time: '16:00', address: '100 Example Way, Atlanta, GA 30301', details: 'Park on the street.', story: KID.heroSummary, sponsors: ['Example Foundation'], settings, contact: { name: 'Linzi Example', title: settings.contactTitle, email: SENDER, phone: '(555) 010-0000' }, signature: '<div>Linzi Example<br>Director of Operations</div>' });
        return json({ ok: true, jobId: url.searchParams.get('preview'), name: 'Max', confirmed: true, time: '16:00', subject: m.subject, html: m.html, from: { email: SENDER, name: 'Linzi Example' }, bcc: settings.list, storyBy: 'ai', signature: true });
      }
      return json({ ok: true, settings, defaults: PRESS_DEFAULTS, limits: { ...PRESS_LIMITS, list: LIST_MAX }, sender: { email: SENDER, account: SENDER, name: 'Linzi Example' }, choices: [{ email: SENDER, name: 'Linzi Example', aliases: [] }, { email: 'peter@soardcharity.com', name: 'Peter Example', aliases: [] }], orgPhone: '(555) 010-0000', google: true });
    }
    if (url.pathname === '/api/broadcast-admin') return json(req.method() === 'GET' ? adminData() : { success: true, action: 'none', schedule: adminData().schedule });
    if (url.pathname === '/api/broadcast') return json({ success: true, state: adminData().public });
    if (url.pathname === '/api/reveal-invites-admin' && req.method() === 'POST') return json({ ok: true, kit: 'drafted', id: '777', told: true });
    if (url.pathname === '/api/reveal-invites-admin') return json(invitesData());
    if (url.pathname === '/api/live-ws') return req.abort();
    if (url.pathname.startsWith('/api/list-content')) return json({ success: true, items: [], total: 0, hasMore: false });
    if (url.pathname.startsWith('/api/pending-changes')) return json({ success: true, changes: [], since: null });
    if (url.pathname.startsWith('/api/audit-log')) return json({ success: true, entries: [], total: 0 });
    if (url.pathname.startsWith('/api/deployments')) return json({ success: true, deploys: [], source: 'cloudflare' });
    if (url.pathname.startsWith('/api/')) return json({ success: true, ok: true });
    return req.continue();
  });
  await page.goto(`${base}/admin/${hash}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.bc-tabs', { timeout: 15000 });
  return { page, errors, posts };
}

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const card = '.rp';
const clickIn = (page, scope, label) => page.evaluate((scope, label) => { const b = [...document.querySelectorAll(`${scope} button`)].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === label); if (b) b.click(); return !!b; }, scope, label);
const sideways = (page) => page.evaluate(() => {
  const main = document.querySelector('.main');
  const edge = main ? main.getBoundingClientRect().right + 1 : innerWidth;
  const over = [...document.querySelectorAll('.rp *, .rt-item *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > edge && !e.closest('.rp-list')).map((e) => e.className || e.tagName).slice(0, 3);
  return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, over };
});
const rowOf = (name) => `[...document.querySelectorAll('.rt-item')].find((li) => li.querySelector('.rt-toggle strong')?.textContent === ${JSON.stringify(name)})`;
const pressOf = (page, name) => page.evaluate(`(() => { const li = ${rowOf(name)}; const s = li && [...li.querySelectorAll('.rt-step')].find((x) => x.querySelector('.rt-label').textContent.startsWith('Press release')); return s ? { label: s.querySelector('.rt-label').textContent, state: [...s.classList].find((c) => c.startsWith('rt-step--')).slice(9), text: s.querySelector('.rt-text').textContent, link: s.querySelector('.rt-text a')?.href || null, button: s.querySelector('button')?.textContent.trim() || null } : null; })()`);

const server = await serve();
const base = `http://localhost:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  settings = cleanSettings({ list: LIST });
  console.log('Reveals → Invites → Press release, laptop');
  const { page, errors, posts } = await open(browser, base, { width: 1280, height: 900 }, '#broadcast/invites');
  await page.waitForSelector(`${card} .rp-list`, { timeout: 15000 });
  const head = await text(page, `${card} .ri-status`);
  ok(head.includes('Press releases are on') && head.includes('Linzi Example’s Gmail (linzi@soardcharity.com)') && head.includes('the site never sends it'), 'it says it’s on, whose Gmail, and that the site never sends it');
  ok((await page.$$(`${card} .rp-chip`)).length === 18, 'the press list shows every address (18)');
  ok((await text(page, `${card} .rp-head span`)) === '18 people, in Bcc', 'and how many, in Bcc');
  await (await page.$(card)).screenshot({ path: `${OUT}invites-card.png` });

  await page.type('#rp-paste', 'Ross, Kaitlyn <kross@example.com>, <desk1@example-news0.com>, "Lee Park" <lee@example.net>');
  await pause(100);
  ok((await text(page, `${card} .rp-section .rp-note`)) === '2 people to add; 1 already on the list.', 'a pasted To line says how many are new');
  ok(await clickIn(page, card, 'Add 2'), 'Add 2');
  await pause(100);
  ok((await page.$$(`${card} .rp-chip`)).length === 20, 'two more on the list');
  ok(await page.$eval('#rp-paste', (e) => e.value === ''), 'the box empties');
  ok((await text(page, `${card} .ri-savebar`)).includes('Not saved yet'), 'it says it isn’t saved yet');
  await page.click(`${card} .rp-chip button[aria-label="Take desk2@example-news1.com off the press list"]`);
  await page.evaluate(() => { document.querySelector('.rp-words').open = true; });
  await page.$eval('#rp-arrival', (e) => { e.value = ''; });
  await page.type('#rp-arrival', 'Please arrive 20 minutes early.');
  ok(await clickIn(page, card, 'Save'), 'Save');
  await pause(300);
  const saved = posts.filter((x) => x.path === '/api/reveal-press-admin' && x.body?.settings).at(-1)?.body.settings;
  ok(saved?.list?.length === 19 && saved.list.some((p) => p.email === 'kross@example.com' && p.name === 'Ross, Kaitlyn') && !saved.list.some((p) => p.email === 'desk2@example-news1.com'), 'it saves the list as shown: the comma name kept, the one taken off gone');
  ok(saved?.arrival === 'Please arrive 20 minutes early.' && saved.from === SENDER, 'and the standing words and who it’s from');
  ok((await text(page, 'body')).includes('Saved. Drafts nobody has changed in Gmail take it on their next look'), 'it says what saving does');
  ok(!(await text(page, `${card} .ri-savebar`)).includes('Not saved yet'), 'nothing left unsaved');
  await (await page.$(card)).screenshot({ path: `${OUT}invites-words.png` });

  console.log('Preview');
  ok(await clickIn(page, card, 'Preview Lizzie’s press release'), 'Preview, for the next kid’s reveal');
  await page.waitForSelector('.rp-sheet .mm-frame', { timeout: 10000 });
  await pause(1500);
  const env = await page.$$eval('.rp-sheet .mm-env dd', (d) => d.map((x) => x.textContent.trim()));
  ok(env[0] === 'Linzi Example <linzi@soardcharity.com>' && env[2].startsWith('Reporter 1 <desk1@example-news0.com>') && env[3] === 'Press Release: Sunshine on a Ranney Day Unveiling for Max’s Accessible Bathroom', `who it’s from, the Bcc list and the subject (${env.join(' | ')})`);
  const inFrame = await page.$eval('.rp-sheet .mm-frame', (f) => f.contentDocument.body.innerText);
  ok(['PRESS RELEASE', 'FOR IMMEDIATE RELEASE', 'WHAT:', 'WHEN:', 'WHERE:', 'WHY:', 'MEDIA AVAILABILITY:', 'ABOUT SUNSHINE ON A RANNEY DAY:', 'Media Contact:'].every((s) => inFrame.includes(s)), 'the press release, every section');
  ok(inFrame.includes('Please arrive 20 minutes early.'), 'with the words just saved');
  ok(inFrame.includes('Linzi’s Gmail signature goes here, as Gmail shows it.') && !inFrame.includes('Director of Operations\n'), 'a line stands where her signature goes (its pictures can’t load in the admin)');
  ok(await page.evaluate(() => document.activeElement?.closest('.rp-sheet') !== null), 'focus moves into the sheet');
  await page.screenshot({ path: `${OUT}preview.png` });
  ok(await clickIn(page, '.rp-sheet', 'Draft it in Linzi’s Gmail now'), 'Draft it in Linzi’s Gmail now');
  await pause(300);
  ok(posts.some((x) => x.path === '/api/reveal-press-admin' && x.body?.draft === 'jobLiz0001'), 'drafts for that reveal alone');
  ok(!(await page.$('.rp-sheet')), 'and the sheet closes');
  ok(await clickIn(page, card, 'Preview Lizzie’s press release'), 'open it again');
  await page.waitForSelector('.rp-sheet', { timeout: 5000 });
  await pause(300);
  await page.keyboard.press('Escape');
  await pause(200);
  ok(!(await page.$('.rp-sheet')), 'Escape closes it');

  ok(await clickIn(page, card, 'Pause'), 'Pause');
  await pause(300);
  ok(posts.some((x) => x.body?.settings?.enabled === false) && (await text(page, `${card} h3`)) === 'Press releases are paused', 'paused, and it says so');
  ok(await clickIn(page, card, 'Turn on'), 'Turn on');
  await pause(300);
  ok((await text(page, `${card} h3`)) === 'Press releases are on', 'on again');
  ok(!errors.length, `no console errors (${errors.join(' | ')})`);
  await page.close();

  console.log('Reveals → Now: the step on each reveal');
  const now = await open(browser, base, { width: 1280, height: 900 }, '#broadcast');
  await now.page.waitForSelector('.rt-list', { timeout: 15000 });
  // One reveal open at a time: open each to read its step
  const openRow = async (name) => { if (!(await now.page.evaluate(`${rowOf(name)}.classList.contains('is-open')`))) await now.page.evaluate(`${rowOf(name)}.querySelector('.rt-toggle').click()`); await pause(150); };
  const liz = await pressOf(now.page, 'Lizzie');
  ok(liz?.label === 'Press release in Linzi’s Gmail' && liz.state === 'wait' && liz.button === 'Draft press release', `no draft yet, with a Draft button (${liz?.text})`);
  ok(liz?.text.includes('once JobTread confirms the reveal with a time'), 'a reveal with no time yet says it waits for one');
  await openRow('Peter');
  const pete = await pressOf(now.page, 'Peter');
  ok(pete?.state === 'done' && pete.text.includes('Sent from Gmail') && pete.text.includes('to 17 people'), 'a sent one is done, with how many it went to');
  await openRow('Max');
  const max = await pressOf(now.page, 'Max');
  ok(max?.state === 'wait' && max.text.includes(`In Linzi’s drafts, to the ${settings.list.length} people on the press list`) && max.link?.includes('authuser=linzi%40soardcharity.com#drafts?compose=18c0ffee'), `a draft links into Linzi’s Gmail (${max?.state}: ${max?.text} ${max?.link})`);
  await now.page.evaluate(`[...${rowOf('Max')}.querySelectorAll('.rt-step')].find((s) => s.querySelector('.rt-label').textContent.startsWith('Press release')).scrollIntoView({ block: 'center' })`);
  await now.page.screenshot({ path: `${OUT}now-step.png` });
  await openRow('Lizzie');
  await now.page.evaluate(`[...${rowOf('Lizzie')}.querySelectorAll('.rt-step')].find((s) => s.querySelector('.rt-label').textContent.startsWith('Press release')).querySelector('button').click()`);
  await pause(400);
  ok(now.posts.some((x) => x.path === '/api/reveal-press-admin' && x.body?.draft === 'jobLiz0001') && !now.posts.some((x) => x.path === '/api/reveal-invites-admin' && x.body?.kind === 'press'), 'Draft posts for Lizzie to the press release, not Kit');
  ok((await text(now.page, 'body')).includes('Lizzie’s press release is in the sender’s Gmail drafts, and they were emailed'), 'and says what happened');
  ok(!now.errors.length, `no console errors (${now.errors.join(' | ')})`);
  await now.page.close();

  console.log('Widths, in the admin’s own shell');
  for (const width of [390, 768, 1025, 1280, 1440]) {
    const w = await open(browser, base, { width, height: 900, ...(width <= 430 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }, '#broadcast/invites');
    await w.page.waitForSelector(`${card} .rp-list`, { timeout: 15000 });
    await w.page.evaluate(() => { document.querySelector('.rp-words').open = true; });
    const s = await sideways(w.page);
    ok(s.scroll <= 0 && !s.over.length, `${width}px: nothing sideways (${s.scroll}px${s.over.length ? `, ${s.over.join(', ')}` : ''})`);
    if (width === 390) {
      const tap = await w.page.$eval(`${card} .rp-chip button`, (b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height));
      ok(tap >= 36, `the × on a phone is big enough to tap (${tap}px)`);
      await (await w.page.$(card)).screenshot({ path: `${OUT}phone-card.png` });
      await clickIn(w.page, card, 'Preview Lizzie’s press release');
      await w.page.waitForSelector('.rp-sheet .mm-frame', { timeout: 10000 });
      await pause(1200);
      const ss = await w.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(ss <= 0, `the preview fits a phone (${ss}px)`);
      await w.page.screenshot({ path: `${OUT}phone-preview.png` });
    }
    ok(!w.errors.length, `${width}px: no console errors (${w.errors.join(' | ')})`);
    await w.page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
