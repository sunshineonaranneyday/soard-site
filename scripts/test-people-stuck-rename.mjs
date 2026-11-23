/**
 * test-people-stuck-rename.mjs: People's note for a change of web address that couldn't finish, in a real browser
 * ============================================================================================================
 * The real admin (public/admin/index.html) on People, every request for the team and the note answered by the real
 * handlers (functions/api/list-content.js, functions/api/rename-settle.js) over an in-memory D1, the stuck renames made
 * the real way: People's rename (functions/api/rename-content.js) with its board move not answering, then the
 * heartbeat's finisher (functions/api/_rename-finish.js) finding them stuck. The admin's other requests get empty
 * answers. Made-up people only; nothing leaves this machine. At 1280 and 390, checks:
 *   - the note at the top of People (above the tabs), in the admin's own notice: who, why it stopped, what's still at
 *     the old address by kind, and only the buttons that can be pressed (no Move when nobody is at the new address)
 *   - each button asks first in the admin's own dialog (never the browser's), saying plainly what happens; Cancel
 *     changes nothing
 *   - the result: a toast saying what was done, the note gone, the records where they should be in D1
 *   - the phone: nothing past the screen's edge, 44px buttons
 *   - the keyboard (Advisory Board QA round 20, rule 8): settled with Enter, Tab and Enter, the focus goes to the next
 *     note's first button, or with none left to People's heading, never the page body; a polite status line says what
 *     was done in the note's own words
 * Screenshots land in test-results/people-stuck-rename/. Exits non-zero on any failure or page error.
 *   node scripts/test-people-stuck-rename.mjs        (PORT=4741 by default)
 */
import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as listContent from '../functions/api/list-content.js';

const ROOT = new URL('..', import.meta.url).pathname;
// (looked for, not assumed: run on code without the route, People's requests to it are a 404, as Cloudflare's would be)
const settleRoute = await import('../functions/api/rename-settle.js').catch(() => null);
const OUT = join(ROOT, 'test-results/people-stuck-rename/');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 4741);
const BY = 'linzi@soardcharity.com';
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = console.error;

// ── A fresh world for each width: Gil's rename, his board records left at "gil-guard" and Gil Other there now; Uma's,
// nobody at "uma-nowhere" (deleted since) ──
let env;
let RAW;
async function world() {
  RAW = await createD1();
  env = { DB: RAW };
  await RAW.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await RAW.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await RAW.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  const { ensureSchema, saveMeeting } = await import('../functions/api/_board.js');
  await ensureSchema(RAW);
  await (await import('../functions/api/_advisory.js')).ensureAdvisory(RAW);
  await (await import('../functions/api/_board-activity.js')).ensureActivitySchema(RAW);
  const person = async (slug, d, email) => {
    await RAW.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, d.order || 0, JSON.stringify({ slug, status: 'active', publishStatus: 'published', ...d })).run();
    if (email) await RAW.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  };
  await person('nia-brooks', { name: 'Nia Brooks', group: 'board', title: 'Board Chair', order: 0 }, 'nia.brooks@example.org');
  await person('gil-guard', { name: 'Gil Guard', group: 'board', title: 'Board Member', order: 1 }, 'gil.guard@example.org');
  const { newMeeting } = await import('../public/admin/board-shared.js');
  const m = newMeeting({ date: '2026-12-01' });
  const sections = m.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'it-gil', title: 'Gil Guard’s report', who: ['gil-guard'] }] } : sec));
  const mid = (await saveMeeting(RAW, { ...m, attendance: [{ slug: 'gil-guard', key: 'gil-guard', name: 'Gil Guard', kind: 'board', status: 'remote' }], sections, actions: [{ id: 'a-gil', owner: 'gil-guard', text: 'Gil Guard’s to-do' }] }, { by: 'jane@soardcharity.com' })).id;
  await RAW.prepare('INSERT INTO board_signins (slug, iat, at, device) VALUES (?, ?, ?, ?)').bind('gil-guard', 1763700000, '2026-11-20T15:00:00.000Z', 'phone').run();
  await RAW.prepare('INSERT INTO board_signins (slug, iat, at, device) VALUES (?, ?, ?, ?)').bind('gil-guard', 1763700600, '2026-11-20T15:10:00.000Z', 'computer').run();
  await RAW.prepare('INSERT INTO board_signatures (doc_id, slug, year, name, at) VALUES (?, ?, ?, ?, ?)').bind('conflict-policy', 'gil-guard', 2026, 'Gil Guard', '2026-11-20T15:01:00.000Z').run();
  await (await import('../functions/api/_board-sign.js')).appendEvents(RAW, async () => ({ events: [{ kind: 'signed', slug: 'gil-guard', docId: 'conflict-policy', year: 2026, version: 1, by: 'gil-guard', detail: { name: 'Gil Guard' } }] }));
  // His rename, its board move not answering (the sign-ins, signatures and meetings: the database stopped partway)
  await RAW.exec("CREATE TRIGGER qa_a BEFORE UPDATE ON board_signins BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END;");
  await RAW.exec("CREATE TRIGGER qa_b BEFORE UPDATE ON board_signatures BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END;");
  await RAW.exec("CREATE TRIGGER qa_c BEFORE UPDATE ON board_meetings BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END;");
  console.error = () => {};
  const { rename } = await import('../functions/api/rename-content.js');
  const r = await rename(env, { collection: 'team', from: 'gil-guard', to: 'gil-new' }, 'pat@soardcharity.com', async () => Response.json({ success: true }));
  console.error = quiet;
  await RAW.exec('DROP TRIGGER qa_a; DROP TRIGGER qa_b; DROP TRIGGER qa_c;');
  ok(r.status === 200 && /still moving/.test(r.body.note || ''), `setup: Gil renamed, his board records still to move (${r.status} ${r.body.note || r.body.error})`);
  // Someone else at his old address since (as before Advisory Board round 19 kept it)
  await person('gil-guard', { name: 'Gil Other', group: 'advisory', title: 'Advisory Board member' }, 'gil.other@example.org');
  // Uma's: renamed, then deleted (History keeps her last version), her Advisory Board page records left behind
  const { ensureHistory } = await import('../functions/api/_content-history.js');
  await ensureHistory(RAW);
  await RAW.prepare("INSERT INTO content_versions (collection, slug, data, action, user_email, created_at) VALUES ('team', 'uma-nowhere', ?, 'delete', ?, ?)")
    .bind(JSON.stringify({ slug: 'uma-nowhere', name: 'Uma Left', group: 'advisory' }), BY, '2026-11-20T12:00:00.000Z').run();
  await RAW.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind('ask-uma', 'uma-left', 'yes', 'uma', '2026-11-01T00:00:00.000Z').run();
  await RAW.prepare('INSERT INTO advisory_intros (id, slug, status, data, at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind('intro-uma', 'uma-left', 'thanks', JSON.stringify({ name: 'A neighbor' }), '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z').run();
  const { finishNote, maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  await finishNote(RAW, 'uma-left', 'uma-nowhere', { at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), by: 'pat@soardcharity.com' }).run();
  // The heartbeat: neither finished by itself, the staff told once each
  const told = [];
  console.error = () => {};
  await maybeFinishRenames(RAW, { now: Date.now() + 2 * 60 * 1000, tell: async (card) => { told.push(card); } });
  console.error = quiet;
  const stuck = (await notes()).map((n) => `${n.from}:${n.stuck}`).sort();
  ok(JSON.stringify(stuck) === JSON.stringify(['gil-guard:someone at the old address', 'uma-left:not at the new address']) && told.length === 2,
    `setup: both stuck, the staff told about each (${JSON.stringify(stuck)}, ${told.length} told)`);
  ok(told.every((t) => /^Settle it in the admin on People: the note at the top lets you /.test(t.fix)), 'setup: Needs attention names where to settle it');
  return { mid };
}
const notes = async () => ((await RAW.prepare("SELECT key, data FROM board_state WHERE key LIKE 'rename-finish:%'").all()).results || []).map((r) => ({ key: r.key, ...JSON.parse(r.data) }));
const slugIn = async (table, where, ...binds) => (await RAW.prepare(`SELECT slug FROM ${table} WHERE ${where}`).bind(...binds).all()).results.map((r) => r.slug);
const inMeeting = async (id) => {
  const m = await (await import('../functions/api/_board.js')).getMeeting(RAW, id);
  return [m.actions.find((a) => /’s to-do$/.test(a.text))?.owner, m.sections.flatMap((x) => x.items).find((it) => /’s report$/.test(it.title))?.who?.[0], m.attendance.find((a) => a.kind === 'board')?.slug];
};
const renamed = async () => Number((await RAW.prepare("SELECT COUNT(*) AS n FROM board_sign_events WHERE kind = 'renamed' AND slug = 'gil-new'").first()).n);
const auditNames = async () => ((await RAW.prepare("SELECT user_email, entity_name FROM audit_log WHERE entity_name LIKE '%records%' ORDER BY id").all()).results || []).map((a) => `${a.user_email}: ${a.entity_name}`);

// ── The admin, served as Cloudflare serves it ──
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, 'public', path.endsWith('/') ? `${path}index.html` : path);
  if (file.startsWith(join(ROOT, 'public')) && existsSync(file) && statSync(file).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); return res.end(readFileSync(file)); }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

const calls = [];
async function answer(req) {
  const url = new URL(req.url());
  if (url.origin !== SITE) return req.respond(req.resourceType() === 'script' ? { status: 200, contentType: 'text/javascript', body: '' } : { status: 200, contentType: 'image/png', body: PNG });
  if (!url.pathname.startsWith('/api/')) return false;
  const json = (o, status = 200) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(o) });
  calls.push(`${req.method()} ${url.pathname}`);
  const real = async (mod) => {
    const request = new Request(`https://sunshineonaranneyday.com${url.pathname}${url.search}`, { method: req.method(), headers: { 'content-type': 'application/json' }, body: req.method() === 'POST' ? req.postData() : undefined });
    const r = await mod[req.method() === 'POST' ? 'onRequestPost' : 'onRequestGet']({ env, request, data: { userEmail: BY }, waitUntil: () => {} });
    return req.respond({ status: r.status, contentType: 'application/json', body: Buffer.from(await r.arrayBuffer()) });
  };
  if (url.pathname === '/api/rename-settle') return settleRoute ? real(settleRoute) : req.respond({ status: 404, contentType: 'text/plain', body: 'Not found' });
  if (url.pathname === '/api/list-content') {
    if (url.searchParams.get('dir') === 'src/content/team') return real(listContent);
    return json({ success: true, items: [], count: 0, total: 0, page: 0, pages: 1 });
  }
  if (url.pathname === '/api/reveal-invites-admin') {
    const group = url.searchParams.get('advisory') === '1' ? 'advisory' : 'board';
    const rows = (await RAW.prepare('SELECT t.slug, t.name, e.email FROM team t LEFT JOIN reveal_board_emails e ON e.slug = t.slug WHERE t."group" = ?').bind(group).all()).results || [];
    return json({ ok: true, [group]: rows.map((r) => ({ slug: r.slug, name: r.name, email: r.email || null })) });
  }
  if (url.pathname === '/api/profile-requests-admin') return json({ success: true, requests: [] });
  if (url.pathname.startsWith('/api/pending-changes')) return json({ success: true, changes: [], publish: { live: null, active: null, failed: null, typicalSeconds: 480 } });
  if (url.pathname.startsWith('/api/audit-log')) return json({ success: true, entries: [], total: 0 });
  if (url.pathname.startsWith('/api/deployments')) return json({ success: true, deploys: [], source: 'cloudflare' });
  if (url.pathname.startsWith('/api/live-ws')) return req.abort();
  return json({ success: true, ok: true });
}

const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 60000, args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
let nativeDialogs = 0;
async function open(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  await page.setRequestInterception(true);
  page.on('request', async (req) => { try { if (await answer(req) === false) req.continue(); } catch (e) { quiet(e); req.respond({ status: 500, body: '{}' }).catch(() => {}); } });
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${width}: ${m.text().slice(0, 300)}`); });
  page.on('dialog', (d) => { nativeDialogs++; d.dismiss(); });
  await page.goto(`${SITE}/admin/index.html#people`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hub-tabs', { timeout: 20000 });
  await page.waitForSelector('.ppl-stuck', { timeout: 10000 }).catch(() => {});
  await sleep(400);
  return page;
}
const words = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const noteOf = (page, from) => page.evaluate((f) => {
  const el = document.querySelector(`.ppl-stuck[data-from="${f}"]`);
  if (!el) return null;
  return { text: el.querySelector('.notice__body').innerText.replace(/\s+/g, ' ').trim(), left: [...el.querySelectorAll('.ppl-stuck__left li')].map((li) => li.textContent.trim()),
    buttons: [...el.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), h: b.getBoundingClientRect().height, right: b.getBoundingClientRect().right })),
    warn: el.classList.contains('notice') && el.classList.contains('notice--warn') };
}, from);
async function shot(page, name, { grow = true } = {}) {
  const vp = page.viewport();
  // (a question: as it shows on the screen, once its sheet has slid in)
  if (!grow) { await sleep(500); return page.screenshot({ path: join(OUT, `${name}.png`) }); }
  const h = await page.evaluate(() => Math.min(Math.max(document.documentElement.scrollHeight, document.querySelector('.main')?.scrollHeight || 0), 4000));
  if (h > vp.height) await page.setViewport({ ...vp, height: h });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  if (page.viewport().height !== vp.height) await page.setViewport(vp);
}
/** Press a note's button → what the admin's own dialog asks ({ title, text, yes, no }), or null */
async function press(page, from, which) {
  const there = await page.evaluate((s) => { const b = document.querySelector(s); b?.click(); return !!b; }, `.ppl-stuck[data-from="${from}"] [data-settle="${which}"]`);
  if (!there) return null;
  await page.waitForSelector('.ask-overlay .ask', { timeout: 5000 }).catch(() => null);
  return page.evaluate(() => {
    const d = document.querySelector('.ask-overlay .ask');
    return d ? { title: d.querySelector('h2')?.textContent.trim(), text: d.querySelector('.ask__text')?.textContent.trim(), yes: d.querySelector('[data-ask="yes"]')?.textContent.trim(), no: d.querySelector('[data-ask="no"]')?.textContent.trim(), focus: document.activeElement?.dataset?.ask || null } : null;
  });
}
/** Settle a note with the keyboard only: its button focused, Enter, Tab to the dialog's action, Enter */
async function byKeys(page, from, which) {
  await page.evaluate((s) => document.querySelector(s)?.focus(), `.ppl-stuck[data-from="${from}"] [data-settle="${which}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ask-overlay .ask', { timeout: 5000 }).catch(() => null);
  await sleep(300);
  await page.keyboard.press('Tab');
  const on = await page.evaluate(() => document.activeElement?.dataset?.ask || null);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.ask-overlay'), { timeout: 5000 }).catch(() => {});
  return on;
}
/** Where the keyboard's focus is, once the page has settled down after a note went */
async function focusNow(page) {
  await sleep(1200);
  return page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName || null, settle: a?.dataset?.settle || null, from: a?.closest?.('.ppl-stuck')?.dataset?.from || null, tabindex: a?.getAttribute?.('tabindex') ?? null,
      text: (a?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), status: document.querySelector('.ppl-stucks [role="status"].sr-only')?.textContent || '' };
  });
}
async function answerAsk(page, yes) {
  await page.evaluate((s) => document.querySelector(s)?.click(), `.ask-overlay [data-ask="${yes ? 'yes' : 'no'}"]`);
  await page.waitForFunction(() => !document.querySelector('.ask-overlay'), { timeout: 5000 }).catch(() => {});
}
async function settledToast(page, from) {
  await page.waitForFunction((f) => !document.querySelector(`.ppl-stuck[data-from="${f}"]`), { timeout: 10000 }, from).catch(() => {});
  await page.waitForSelector('.toast', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  return (await words(page, '.toast')).join(' | ');
}
const GIL_LEFT = ['1 board meeting they’re on', '1 to-do from a board meeting', '2 sign-ins to the board page', '1 signature on a board paper'];
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    console.log(`\n${width}px`);
    const { mid } = await world();
    const page = await open(width, height);
    // The note at the top of People, above the tabs
    const order = await page.evaluate(() => {
      const first = document.querySelector('.ppl-stucks');
      const tabs = document.querySelector('.hub-tabs');
      return first && tabs ? !!(first.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    });
    ok(order === true, 'the note is at the top of People, above its tabs');
    const gil = await noteOf(page, 'gil-guard');
    ok(gil?.warn, 'in the admin’s own notice (warn, never red)');
    ok(gil?.text.startsWith('Gil Guard’s web address was changed from “gil-guard” to “gil-new”, but some of their records are still at “gil-guard”. It stopped because someone else, Gil Other, is at “gil-guard” now, so the site can’t tell whose they are. Still at “gil-guard”:'),
      `Gil’s note says what happened and why (${gil?.text})`);
    ok(JSON.stringify(gil?.left) === JSON.stringify(GIL_LEFT), `and what’s still there by kind (${JSON.stringify(gil?.left)})`);
    ok(JSON.stringify(gil?.buttons.map((b) => b.text)) === JSON.stringify(['Move them to “gil-new”', 'Leave them at “gil-guard”']), `both buttons, saying what they do (${JSON.stringify(gil?.buttons.map((b) => b.text))})`);
    const uma = await noteOf(page, 'uma-left');
    ok(uma?.text.startsWith('Uma Left’s web address was changed from “uma-left” to “uma-nowhere”, but some of their records are still at “uma-left”. It stopped because Uma Left isn’t at “uma-nowhere” any more.'), `Uma’s note (${uma?.text})`);
    ok(JSON.stringify(uma?.left) === JSON.stringify(['1 answer to a monthly ask', '1 introduction']), `what’s still at hers (${JSON.stringify(uma?.left)})`);
    ok(JSON.stringify(uma?.buttons.map((b) => b.text)) === JSON.stringify(['Leave them at “uma-left”']), 'only Leave: nobody is at her new address to move them to');
    ok(await fits(page), 'nothing past the edge of the screen');
    if (width < 500) {
      const all = [...(gil?.buttons || []), ...(uma?.buttons || [])];
      ok(all.length === 3 && all.every((b) => b.h >= 44 && b.right <= width), `44px buttons inside the screen (${all.map((b) => Math.round(b.h)).join(', ')})`);
    }
    await shot(page, `${width}-1-notes`);

    // Move them to "gil-new": asked first, plainly, Gil Other's things named, the counts again
    const before = await renamed();
    const ask = await press(page, 'gil-guard', 'move');
    ok(ask?.title === 'Move them to “gil-new”?', `Move asks in the admin’s own dialog (${ask?.title})`);
    ok(ask?.text === `Gil Other is at “gil-guard” now, so anything of theirs there moves to Gil Guard at “gil-new” too. Still at “gil-guard”: ${GIL_LEFT.join(', ')}.`, `and says anything of Gil Other’s there moves too, with the counts (${ask?.text})`);
    ok(ask?.yes === 'Move them to “gil-new”' && ask?.no === 'Cancel' && ask?.focus === 'no', `its buttons, the focus on Cancel (${JSON.stringify(ask)})`);
    await shot(page, `${width}-2-move-asks`, { grow: false });
    if (width < 500) {
      // On the phone: Cancel changes nothing, then Leave them
      const posts = calls.filter((c) => c === 'POST /api/rename-settle').length;
      await answerAsk(page, false);
      await sleep(300);
      ok(!!(await noteOf(page, 'gil-guard')) && (await notes()).length === 2 && calls.filter((c) => c === 'POST /api/rename-settle').length === posts, 'Cancel: nothing sent, the note stays');
      const leaveAsk = await press(page, 'gil-guard', 'leave');
      ok(leaveAsk?.title === 'Leave them at “gil-guard”?' && leaveAsk?.text === `They stay at “gil-guard”, with Gil Other, who is at that address now. Nothing moves to Gil Guard at “gil-new”. Still at “gil-guard”: ${GIL_LEFT.join(', ')}.`,
        `Leave asks, saying they stay with Gil Other (${leaveAsk?.text})`);
      ok(await fits(page), 'the question fits the phone');
      await shot(page, `${width}-3-leave-asks`, { grow: false });
      // (closed, then settled with the keyboard alone)
      await answerAsk(page, false);
      await sleep(300);
      ok(await byKeys(page, 'gil-guard', 'leave') === 'yes', 'Tab from Cancel reaches the dialog’s Leave');
      const toast = await settledToast(page, 'gil-guard');
      const f = await focusNow(page);
      ok(f.from === 'uma-left' && f.settle === 'leave', `the focus goes to the next note’s first button, never the page (${JSON.stringify(f)})`);
      ok(f.status === 'Gil Guard’s records were left at “gil-guard”, with Gil Other, who is at that address now.', `a polite status line says what was done (${f.status})`);
      ok(/Gil Guard’s records were left at “gil-guard”, with Gil Other, who is at that address now\./.test(toast), `the result, said (${toast})`);
      ok(!(await noteOf(page, 'gil-guard')), 'Gil’s note gone');
      ok(JSON.stringify(await inMeeting(mid)) === JSON.stringify(['gil-guard', 'gil-guard', 'gil-guard']) && (await slugIn('board_signins', '1 = 1')).every((s) => s === 'gil-guard')
        && (await slugIn('board_signatures', '1 = 1')).every((s) => s === 'gil-guard') && (await renamed()) === before, 'nothing moved: the records stay at “gil-guard”, no “renamed” event');
    } else {
      // (closed, then settled with the keyboard alone)
      await answerAsk(page, false);
      await sleep(300);
      ok(await byKeys(page, 'gil-guard', 'move') === 'yes', 'Tab from Cancel reaches the dialog’s Move');
      const toast = await settledToast(page, 'gil-guard');
      ok(toast.includes(`Gil Guard’s records still at “gil-guard” moved to “gil-new”: ${GIL_LEFT.join(', ')}.`), `the result, said (${toast})`);
      const f = await focusNow(page);
      ok(f.from === 'uma-left' && f.settle === 'leave', `the focus goes to the next note’s first button, never the page (${JSON.stringify(f)})`);
      ok(f.status === `Gil Guard’s records still at “gil-guard” moved to “gil-new”: ${GIL_LEFT.join(', ')}.`, `a polite status line says what was done (${f.status})`);
      ok(!(await noteOf(page, 'gil-guard')), 'Gil’s note gone');
      ok(JSON.stringify(await inMeeting(mid)) === JSON.stringify(['gil-new', 'gil-new', 'gil-new']), 'the meeting: his to-do, his item, the attendance at “gil-new”');
      ok(JSON.stringify(await slugIn('board_signins', '1 = 1')) === JSON.stringify(['gil-new', 'gil-new']) && JSON.stringify(await slugIn('board_signatures', '1 = 1')) === JSON.stringify(['gil-new']), 'his sign-ins and signature at “gil-new”');
      ok((await renamed()) - before === 1, 'the signing chain says “renamed” once');
    }
    await shot(page, `${width}-4-gil-settled`);

    // Leave them at "uma-left": with nobody
    const umaAsk = await press(page, 'uma-left', 'leave');
    ok(umaAsk?.text === 'They stay at “uma-left”, with nobody: nobody is at that address on People now. Still at “uma-left”: 1 answer to a monthly ask, 1 introduction.', `Uma’s Leave asks, saying they stay with nobody (${umaAsk?.text})`);
    await answerAsk(page, false);
    await sleep(300);
    await byKeys(page, 'uma-left', 'leave');
    const toast = await settledToast(page, 'uma-left');
    const f = await focusNow(page);
    ok(f.tag === 'H2' && f.tabindex === '-1' && !!f.text, `none left: the focus goes to People’s heading, never the page body (${JSON.stringify(f)})`);
    ok(f.status === 'Uma Left’s records were left at “uma-left”, with nobody: nobody is at that address on People.', `the status line says it (${f.status})`);
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? a.tagName : null; });
    ok(!!next, `Tab from there goes on through People (${next})`);
    ok(/Uma Left’s records were left at “uma-left”, with nobody: nobody is at that address on People\./.test(toast), `the result (${toast})`);
    ok(!(await page.$('.ppl-stuck')), 'no note left on People');
    ok(JSON.stringify(await slugIn('advisory_answers', 'ask_id = ?', 'ask-uma')) === JSON.stringify(['uma-left']) && JSON.stringify(await slugIn('advisory_intros', 'id = ?', 'intro-uma')) === JSON.stringify(['uma-left']), 'her records stay at “uma-left”');
    ok((await notes()).length === 0, 'nothing left to settle');
    const audit = await auditNames();
    ok(audit.length === 2 && audit.every((a) => a.startsWith(`${BY}: `)), `the audit log says who chose which (${JSON.stringify(audit)})`);
    // Read again (a reload): still none
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.hub-tabs', { timeout: 20000 });
    await sleep(500);
    ok(!(await page.$('.ppl-stuck')), 'after a reload, still none');
    await shot(page, `${width}-5-all-settled`);
    await page.close();
  }
  ok(nativeDialogs === 0, 'never the browser’s own dialog');
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll People stuck-rename checks passed');
process.exit(failures.length ? 1 : 0);
