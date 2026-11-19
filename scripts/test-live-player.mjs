/**
 * test-live-player.mjs — the live page's video, played for real in Chrome
 * =======================================================================
 * Start a static preview first:   npx astro build && npx astro preview --port 4322
 * Then:                            node scripts/test-live-player.mjs
 *
 * Serves a fake broadcast: tests/fixtures/live-hls looped into a live HLS
 * playlist at the same Stream addresses production uses, plus mocked
 * /api/broadcast, /api/live-messages and /api/live-replay. Checks, at
 * desktop, laptop and phone sizes (including a phone with Safari's
 * toolbars showing):
 *   - the whole stage (video and its controls) fits on screen, the kid's name
 *     above the video on phones, the messages beside it on desktops
 *   - the Theater layout (Peter, Nov 17 2026): a live upright video has its
 *     controls in a rail beside it, the heart at its foot sending hearts up
 *     the rail (never over the picture); on a computer 1200px and wider the
 *     story, the video and the messages are three columns; on a phone the
 *     newest message sits under the video and the message box is docked at
 *     the bottom of the screen, with the corner player above it
 *   - nothing is ever drawn on a playing picture (every sampled point of
 *     the video hits the video)
 *   - muted: Tap for sound first (in the rail, with the heart and full screen
 *     already there), then sound / heart / full screen; the mini player; no
 *     links sending viewers off to watch somewhere else
 *   - a sideways picture reshapes the frame; camera-not-connected and
 *     dropped-feed notes, and recovery on its own
 *   - back from a pause (the lock screen, a call): at the live moment again,
 *     not left behind everyone else
 *   - autoplay refused (an iPhone in Low Power Mode): Tap to watch, the tap
 *     taken at once even before the picture has come in, then it plays
 *   - replay: own controls, the reveal marked on the seek bar, Jump to the
 *     reveal, captions under the picture, keyboard control; the line and its
 *     handle glide with the picture, play turns into pause, the buttons give
 *     under a press, a finger scrubs anywhere on the line (the picture
 *     following it) and a swipe up from it still scrolls; the picture fills
 *     its frame
 *   - giving without leaving: the Zeffy form opens beside the video (desktop)
 *     or under a small pinned player (phone) while the reveal keeps playing
 *   - leaving the page and coming back with the Back button (client-side
 *     navigation) brings the video back
 *   - the reveal starting with the page open further down brings the page up to
 *     the video (unless someone is typing)
 *   - the build's partners scroll under the video, on screen with it, never on
 *     it; not on a phone held sideways (a child's page: PARTNERS_KID, default
 *     dylan-2026)
 *   - the sound plays on a computer when it comes as its own track, the way
 *     Cloudflare Stream sends it (tests/fixtures/live-hls/split: the portrait
 *     fixture's picture and sound as separate fMP4 renditions)
 * Screenshots land in test-results/live-player/. Exits non-zero on any
 * failure or console error.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4322';
const FIX = new URL('../tests/fixtures/live-hls/', import.meta.url).pathname;
const OUT = new URL('../test-results/live-player/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CODE = 'test';
const SEGMENTS = 4; // per fixture, 2 s each
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The fake broadcast ────────────────────────────────────────────
// window: how many pieces older than the newest the playlist keeps (Stream keeps far more; 3 keeps the tests quick).
// held: the pieces' answers wait here instead of going out (a picture that hasn't come in yet).
// down: the input answers 204 (no camera connected). phone: 'on' adds a piece to the recording every 2 s, 'off'
// freezes it (phoneOn/phoneOff/closeRecording below). pieces: every piece the page asks for, when collecting.
const feed = { shape: 'portrait', down: false, split: false, revealAt: 6, design: { open: false }, window: 8, held: null, phone: 'on', rec: null, pieces: null, dvrFails: 0 };
// Stream's recordings, as the real feed behaved on Nov 18 2026: the input's playlist (/live1/...) is a short sliding
// window of the recording that's on, its pieces addressed /<recording id>/video/...; each recording's DVR playlist
// (/<recording id>/manifest/...) holds every piece from its first and only grows; the phone stopping freezes both;
// Stream closing the recording ends its DVR playlist (and the input answers 204); a phone back after that is a new
// recording.
const recordings = new Map(); // id → { count, closed }
let recordingNo = 0;
function newRecording() {
  const id = `${(++recordingNo).toString(16).padStart(4, '0')}${'ab'.repeat(14)}`; // 32 hex characters, like Stream's
  recordings.set(id, { count: 4, closed: false });
  feed.rec = id;
}
newRecording();
setInterval(() => { if (feed.phone === 'on' && feed.rec && !recordings.get(feed.rec).closed) recordings.get(feed.rec).count++; }, 2000).unref();
const phoneOff = () => { feed.phone = 'off'; };
const phoneOn = () => { if (recordings.get(feed.rec).closed) newRecording(); feed.phone = 'on'; };
const closeRecording = () => { recordings.get(feed.rec).closed = true; feed.phone = 'off'; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
/** The room's design, for the strip beside the video (a kid's page) */
const DESIGN = {
  open: true, after: true, name: 'Axel',
  slides: [1, 2, 3].map((i) => ({ kind: 'before', url: `https://imagedelivery.net/x/before-${i}.jpg/public`, crop: false, alt: 'Axel’s room before', badge: 'Before', kicker: 'Before', caption: 'Axel’s room before' })),
};
/**
 * The fixture looped forever as a live playlist, with a discontinuity at each wrap. With a track ('v' or 'a'), that
 * track of the split fixture: fMP4 pieces after their own init segment, as Stream sends them.
 */
function livePlaylist(track = '', recId = feed.rec, { dvr = false } = {}) {
  const r = recordings.get(recId);
  const top = r.count - 1;
  const first = dvr ? 0 : Math.max(0, top - feed.window);
  let s = `#EXTM3U\n#EXT-X-VERSION:${track ? 7 : 3}\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${first}\n#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(first / SEGMENTS)}\n`;
  if (dvr && r.closed) s += '#EXT-X-PLAYLIST-TYPE:VOD\n';
  if (track) s += `#EXT-X-MAP:URI="${track}-init.mp4"\n`;
  for (let i = first; i <= top; i++) {
    if (i > first && i % SEGMENTS === 0) s += '#EXT-X-DISCONTINUITY\n';
    s += `#EXTINF:2.000000,\n../../${recId}/video/${track ? `${track}${i % SEGMENTS}.m4s` : `seg${i % SEGMENTS}.ts`}?n=${i}&r=${recId.slice(0, 4)}\n`;
  }
  if (dvr && r.closed) s += '#EXT-X-ENDLIST\n';
  return s;
}
/** Stream's own shape: a master playlist whose sound is a separate audio rendition (EXT-X-MEDIA TYPE=AUDIO) */
const SPLIT_MASTER = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n'
  + '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_audio",NAME="original",DEFAULT=YES,AUTOSELECT=YES,URI="a.m3u8"\n'
  + '#EXT-X-STREAM-INF:RESOLUTION=144x256,CODECS="avc1.42e00b,mp4a.40.2",BANDWIDTH=200000,AUDIO="group_audio"\nv.m3u8\n';
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:07.500\nOkay, open your eyes!\n';
const base = {
  id: 'live-9', kidSlug: null, kidName: null, title: 'Live room reveal', message: null, image: null,
  url: `${BASE}/live/`, liveUrl: `${BASE}/live/`, facebookUrl: 'https://www.facebook.com/SunshineOnaRanneyDay', youtubeUrl: null, instagramUrl: null,
  source: 'stream', updatedAt: new Date().toISOString(), scheduledAt: null, liveAt: new Date().toISOString(), endedAt: null, replayUntil: null, orientation: 'portrait',
  live: false, upcoming: false, replay: false,
};
const STATES = {
  live: { ...base, phase: 'live', live: true, player: { kind: 'live', uid: 'live1', customerCode: CODE } },
  replay: { ...base, phase: 'replay', replay: true, kidName: 'Axel', endedAt: new Date().toISOString(), player: { kind: 'replay', uid: 'rep1', customerCode: CODE } },
  facebook: { ...base, phase: 'live', live: true, source: 'manual', player: null },
};
let state = STATES.live;
const MESSAGES = [['Dana', 'We have been following since day one!'], ['Marcus', 'Proud of you, buddy.'], ['Ms. Lee', 'Watching from the classroom with the whole class cheering!'], ['Priya', 'Happy tears over here.']]
  .map(([name, body], i) => ({ id: `m${i}`, name, body, at: new Date().toISOString() }));

async function mock(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*' };
    const json = (obj, status = 200) => req.respond({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) });
    if (url.hostname === `customer-${CODE}.cloudflarestream.com`) {
      if (url.pathname.includes('/thumbnails/')) return req.respond({ status: 404, headers: cors, body: '' });
      if (url.pathname.startsWith('/rep1/')) {
        const name = url.pathname.split('/').pop();
        // (feed.replayDelay: the replay's playlist answers that much later, as on a slow phone, so its loading can be seen)
        if (name.endsWith('.m3u8')) {
          const send = () => req.respond({ status: 200, contentType: 'application/vnd.apple.mpegurl', headers: cors, body: readFileSync(`${FIX}${feed.shape}/video.m3u8`, 'utf8') }).catch(() => {});
          if (feed.replayDelay) { setTimeout(send, feed.replayDelay); return; }
          return send();
        }
        return req.respond({ status: 200, contentType: 'video/mp2t', headers: cors, body: readFileSync(`${FIX}${feed.shape}/${name}`) });
      }
      const name = url.pathname.split('/').pop();
      if (name.endsWith('.m3u8')) {
        // The input (/live1/...): the recording that's on, or 204 with no camera connected or once it has closed.
        // A recording's own (/<id>/...): its DVR playlist
        const input = url.pathname.startsWith('/live1/');
        const recId = input ? feed.rec : url.pathname.split('/')[1];
        if (input && (feed.down || recordings.get(feed.rec).closed)) return req.respond({ status: 204, headers: cors, body: '' });
        if (!recordings.has(recId)) return req.respond({ status: 404, headers: cors, body: '' });
        // (dvrFails: the next DVR playlist reads fail, as a passing error at Stream would)
        if (!input && feed.dvrFails > 0) { feed.dvrFails--; return req.respond({ status: 500, headers: cors, body: '' }); }
        const m3u8 = (body) => req.respond({ status: 200, contentType: 'application/vnd.apple.mpegurl', headers: cors, body });
        if (feed.split) {
          if (name === 'video.m3u8') return m3u8(SPLIT_MASTER);
          return m3u8(livePlaylist(name[0], recId, { dvr: !input }));
        }
        return m3u8(livePlaylist('', recId, { dvr: !input }));
      }
      if (feed.split) return req.respond({ status: 200, contentType: 'video/mp4', headers: cors, body: readFileSync(`${FIX}split/${name}`) });
      if (feed.pieces && url.searchParams.has('n')) feed.pieces.push({ n: Number(url.searchParams.get('n')), r: url.searchParams.get('r') });
      const piece = () => req.respond({ status: 200, contentType: 'video/mp2t', headers: cors, body: readFileSync(`${FIX}${feed.shape}/${url.pathname.split('/').pop()}`) }).catch(() => {});
      if (feed.held) return feed.held.push(piece);
      return piece();
    }
    // (the design's pictures load, a tiny stand-in: the strip leaves out any that don't)
    if ((url.pathname.startsWith('/cdn-cgi/imagedelivery/') || url.hostname === 'imagedelivery.net') && url.pathname.includes('/before-')) return req.respond({ status: 200, contentType: 'image/png', headers: cors, body: PNG });
    // (and the partner logos under the frame)
    if ((url.pathname.startsWith('/cdn-cgi/imagedelivery/') || url.hostname === 'imagedelivery.net') && /\/partners?[/-]|\/partner-/.test(url.pathname)) return req.respond({ status: 200, contentType: 'image/png', headers: cors, body: PNG });
    if (url.pathname.startsWith('/cdn-cgi/imagedelivery/') || url.hostname === 'imagedelivery.net') return req.abort();
    if (url.pathname === '/api/broadcast') return json({ state, reminders: { enabled: true, email: true, sms: false, push: false, pushKey: null }, messages: { enabled: true }, timezone: 'America/New_York', hub: true });
    if (url.pathname === '/api/live-messages' && req.method() === 'GET') return json({ ok: true, open: state.phase === 'live', enabled: true, broadcastId: state.id, messages: MESSAGES });
    if (url.pathname === '/api/live-messages') return json({ ok: true, status: 'shown', message: { id: `p${Date.now()}`, name: 'Bo', body: 'Congratulations!', at: new Date().toISOString() } });
    if (url.pathname === '/api/live-replay' && url.searchParams.has('vtt')) return req.respond({ status: 200, contentType: 'text/vtt', body: feed.vtt || VTT });
    if (url.pathname === '/api/live-replay') return json({ ok: true, uid: 'rep1', revealAt: feed.revealAt, captions: true });
    if (url.pathname === '/api/reveal-design') return json(feed.design);
    if (url.hostname === 'www.zeffy.com') return req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body style="font:16px sans-serif;padding:24px">Zeffy donation form stub</body>' });
    if (url.pathname === '/api/live-ws') return req.abort();
    if (url.pathname === '/api/broadcast-event') return req.respond({ status: 204, body: '' });
    req.continue();
  });
}

// ── Probes ────────────────────────────────────────────────────────
const probe = (page) => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom), r: Math.round(b.right) }; };
  const vis = (el) => !!el && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const s = (k) => document.querySelector(`[data-s="${k}"]`);
  const stage = document.querySelector('[data-stage]');
  const video = document.querySelector('.stage__player video');
  const pic = document.querySelector('.stage__picture');
  // Nothing drawn on the picture: every sampled point inside it must land on the video itself
  let covered = null;
  if (video && pic) {
    const b = pic.getBoundingClientRect();
    for (let i = 1; i < 8 && !covered; i++) for (let j = 1; j < 8 && !covered; j++) {
      const x = b.left + (b.width * i) / 8, y = b.top + (b.height * j) / 8;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit !== video) covered = hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing';
    }
  }
  return {
    party: stage?.hasAttribute('data-party'), mode: stage?.dataset.mode, pstatus: stage?.dataset.pstatus, orient: stage?.dataset.orientation, rail: !!stage?.hasAttribute('data-rail'),
    text: r(document.querySelector('.hero-text')), panel: r(document.querySelector('[data-msgs="panel"]')),
    compose: r(document.querySelector('[data-msgs="compose"]')), composeFixed: getComputedStyle(document.querySelector('[data-msgs="compose"]')).position === 'fixed',
    latest: vis(document.querySelector('[data-msgs="latest"]')) ? r(document.querySelector('[data-msgs="latest"]')) : null,
    vsize: video ? `${video.videoWidth}x${video.videoHeight}` : null, muted: video?.muted, time: video?.currentTime, paused: video?.paused,
    stage: r(stage), picture: r(pic), bar: r(s('bar')), h1: r(document.querySelector('.hero-text h1')),
    status: s('status')?.textContent, soundCta: vis(s('sound')), heart: vis(s('heart')), mute: vis(s('mute')),
    full: [...document.querySelectorAll('[data-full]')].some(vis),
    note: vis(s('note')) ? s('note-title').textContent : null, docked: pic?.classList.contains('is-docked'),
    leaveLinks: [...document.querySelectorAll('.live-page a[href*="facebook.com"], .live-page a[href*="youtube.com"], .live-page a[href*="instagram.com"]')].filter((a) => vis(a) && !a.href.includes('sharer')).length,
    panelBeside: !!document.querySelector('[data-slot="hero"] [data-msgs="panel"]') && vis(document.querySelector('[data-msgs="panel"]')),
    form: r(document.querySelector('[data-msgs="form"]')), covered,
    jump: vis(s('jump')) ? s('jump-label').textContent : null, mark: vis(s('mark')), cc: vis(s('cc')) ? s('cc-text').textContent : null,
    give: vis(document.querySelector('.give__panel')) ? r(document.querySelector('.give__panel')) : null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth, vh: innerHeight,
  };
});
// A fresh address each time: Chrome treats a repeat visit as a reload and restores the old scroll position
let visits = 0;
const open = (page) => page.goto(`${BASE}/live/?visit=${++visits}`, { waitUntil: 'domcontentloaded' });
const waitFor = (page, want, ms = 20000) => page.waitForFunction((w) => w.includes(document.querySelector('[data-stage]')?.dataset.pstatus), { timeout: ms }, want).catch(() => null);

const VIEWPORTS = [
  ['desktop', { width: 1424, height: 830 }],
  ['laptop', { width: 1280, height: 720 }],
  ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['phone-toolbars', { width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|Failed to load resource|cloudflareinsights\.com/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await mock(page);

  for (const [name, vp] of VIEWPORTS) {
    console.log(`\n▶ live, portrait picture — ${name}`);
    state = STATES.live; feed.shape = 'portrait'; feed.down = false;
    await page.setViewport(vp);
    await open(page);
    await waitFor(page, ['playing']);
    await sleep(1200);
    let g = await probe(page);
    const phone = vp.width < 961;
    ok(g.party && g.pstatus === 'playing', `playing in the watch-party layout (${g.pstatus})`);
    ok(g.orient === 'portrait' && g.vsize === '144x256', `portrait picture (${g.vsize})`);
    ok(Math.abs(g.picture.w / g.picture.h - 0.5625) < 0.02, `9:16 frame (${g.picture.w}x${g.picture.h})`);
    ok(!g.covered, `nothing drawn on the picture${g.covered ? ` (hit ${g.covered})` : ''}`);
    ok(g.stage.y >= 0 && g.stage.b <= g.vh, `video and bar all on screen (stage ${g.stage.y}-${g.stage.b} of ${g.vh})`);
    // A live upright picture: the controls are a rail beside it, exactly as tall as it
    ok(g.rail && g.bar.x >= g.picture.r && g.bar.x - g.picture.r <= 16 && Math.abs(g.bar.y - g.picture.y) <= 2 && Math.abs(g.bar.b - g.picture.b) <= 2,
      `the controls are a rail beside the picture, as tall as it (rail ${g.bar.x},${g.bar.y}-${g.bar.b}; picture to ${g.picture.r}, ${g.picture.y}-${g.picture.b})`);
    ok(g.overflowX <= 0, `no sideways scroll (${g.overflowX})`);
    // The hero clips overflow, so scroll width alone can't see a stage that runs off the side
    ok([g.stage, g.bar].every((b) => b.x >= 8 && b.r <= g.vw - 8), `video and bar inside the screen's gutters (stage ${g.stage.x}-${g.stage.r} of ${g.vw})`);
    ok(g.status === 'Live' && g.soundCta && g.heart && !g.mute && g.full, 'muted: Tap for sound first in the rail, with the heart and full screen there too');
    const pill = await page.evaluate(() => { const v = (el) => !!el && el.getBoundingClientRect().height > 0; return { eyebrow: document.querySelector('[data-live="eyebrow"]')?.textContent, onair: v(document.querySelector('[data-live="onair"]')) }; });
    ok(pill.eyebrow === 'Live now' && (vp.width < 961 ? pill.onair : true), `"Live" said by the page, where the rail has no room for it (${JSON.stringify(pill)})`);
    ok(g.leaveLinks === 0, `nothing sends viewers off to watch somewhere else (${g.leaveLinks} links)`);
    if (phone) {
      ok(g.h1.b <= g.picture.y && g.h1.y >= 0, `kid's name above the video (${g.h1.y}-${g.h1.b})`);
      ok(g.picture.w >= 250, `video at least 250px wide (${g.picture.w})`);
      // Touch screens get 44px minimum buttons site-wide: the round controls must stay round at that size
      const odd = await page.evaluate(() => [...document.querySelectorAll('[data-stage]:not([data-rail]) .bar__btn:not(.bar__cc), [data-stage] .bar__play, [data-stage][data-rail] .bar__ico')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.getBoundingClientRect()).filter((b) => Math.abs(b.width - b.height) > 1 || b.height < 44).length);
      ok(odd === 0, `round controls are 44px circles (at least) on a touch screen (${odd} out of shape)`);
      ok(g.composeFixed && g.compose.b <= g.vh + 1 && g.compose.y >= g.vh - 140, `the message box is docked at the bottom of the screen (${g.compose.y}-${g.compose.b} of ${g.vh})`);
      // (a phone shorter than 740px keeps the video its size instead: the messages are just below)
      if (g.vh >= 740) ok(!!g.latest && g.latest.y >= g.stage.b && g.latest.b <= g.compose.y + 1, `the newest message under the video, clear of the box (${g.latest ? `${g.latest.y}-${g.latest.b}` : 'none'})`);
      else ok(!g.latest || g.latest.y >= g.compose.y, `a short phone: no newest-message line squeezed in above the box (${g.latest ? g.latest.y : 'none'})`);
      ok(g.stage.b <= g.compose.y, `the video and the partners above the docked box (${g.stage.b} vs ${g.compose.y})`);
    } else {
      ok(g.panelBeside && g.form.b <= g.vh + 8, `messages beside the video, message box on screen (${g.form.b})`);
      ok(!g.composeFixed, 'the message box stays in its card on a computer');
      if (vp.width >= 1200) ok(g.text.r <= g.stage.x && g.panel.x >= g.stage.r && Math.abs(g.panel.y - g.stage.y) <= 2 && Math.abs(g.panel.b - g.stage.b) <= 2,
        `three columns: the story, the video, the messages, each as tall as the video (text to ${g.text.r}, video ${g.stage.x}-${g.stage.r}, messages ${g.panel.x}, ${g.panel.y}-${g.panel.b} vs ${g.stage.y}-${g.stage.b})`);
      ok(g.picture.w >= (vp.height < 800 ? 290 : 340), `video as big as the screen height allows (${g.picture.w}px wide)`);
    }
    await page.screenshot({ path: `${OUT}live-${name}.png` });

    await page.click('[data-s="sound"]');
    await sleep(400);
    g = await probe(page);
    ok(g.muted === false && !g.soundCta, 'one tap turns the sound on');
    ok(!g.soundCta && g.mute && g.heart && g.full, 'sound on: the bar shows sound, a heart and full screen');


    if (name === 'desktop' || name === 'phone') {
      await page.click('[data-live="cta-donate"]');
      await sleep(700);
      g = await probe(page);
      const apart = (a, b) => a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y;
      ok(!!g.give && g.pstatus === 'playing' && apart(g.give, g.picture), `the donation form opens without covering the video, which keeps playing (${JSON.stringify(g.give)} vs ${JSON.stringify(g.picture)})`);
      if (phone) ok(g.docked && g.picture.y >= 0 && g.picture.b <= g.give.y, 'on a phone the video sits in a small player above the form');
      if (phone) ok(await page.evaluate(() => getComputedStyle(document.querySelector('[data-msgs="compose"]')).visibility === 'hidden'), 'the docked message box steps aside while the form is open');
      await page.screenshot({ path: `${OUT}give-${name}.png` });
      await page.keyboard.press('Escape');
      await sleep(300);
      g = await probe(page);
      ok(!g.give, 'Escape closes the form');
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);
    }

    await page.click('[data-s="heart"]');
    await sleep(500);
    g = await probe(page);
    ok(!g.covered, 'sending love draws nothing over the picture');
    const hearts = await page.evaluate(() => { const pic = document.querySelector('.stage__picture').getBoundingClientRect(); const f = [...document.querySelectorAll('[data-s="rise"] .float')]; return { n: f.length, onPicture: f.filter((h) => { const b = h.getBoundingClientRect(); return b.left < pic.right && b.right > pic.left && b.top < pic.bottom && b.bottom > pic.top; }).length }; });
    ok(hearts.n > 0 && hearts.onPicture === 0, `hearts float up the rail beside the picture (${hearts.n}, ${hearts.onPicture} on it)`);

    await page.evaluate(() => window.scrollTo(0, document.querySelector('.hero').offsetHeight + 400));
    await sleep(900);
    g = await probe(page);
    // (a phone: top right, under the header, so what you scroll to comes into view clear of it; a computer: bottom right)
    const miniTop = g.vw < 600;
    ok(g.docked && (miniTop ? g.picture.y >= 60 && g.picture.b < g.vh / 2 + 40 : g.picture.y > g.vh / 2) && g.picture.b <= g.vh - 8 && g.picture.r <= g.vw - 8 && (!g.composeFixed || g.picture.b <= g.compose.y), `mini player in its corner (${miniTop ? 'top right on a phone' : 'bottom right'}), clear of the docked message box (${JSON.stringify(g.picture)})`);
    ok(!g.covered, 'nothing drawn on the mini player either');
    await page.screenshot({ path: `${OUT}docked-${name}.png` });
    await page.click('[data-s="undock"]');
    await sleep(400);
    g = await probe(page);
    ok(!g.docked && g.muted === true, 'closing the mini player undocks it and mutes');
  }

  console.log('\n▶ a sideways phone');
  await page.setViewport({ width: 1424, height: 830 });
  feed.shape = 'landscape';
  await open(page);
  await waitFor(page, ['playing']); await sleep(1000);
  let g = await probe(page);
  ok(g.orient === 'landscape' && Math.abs(g.picture.w / g.picture.h - 1.7778) < 0.03, `frame takes the picture's shape (${g.picture.w}x${g.picture.h})`);
  ok(!g.covered && g.stage.b <= g.vh, 'still uncovered and on screen');
  await page.screenshot({ path: `${OUT}landscape-desktop.png` });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(800);
  g = await probe(page);
  ok(g.overflowX <= 0 && !g.covered && [g.stage, g.bar].every((b) => b.x >= 8 && b.r <= g.vw - 8), `fits a phone, inside the gutters (${g.picture.w}x${g.picture.h}, stage to ${g.stage.r} of ${g.vw})`);
  await page.screenshot({ path: `${OUT}landscape-phone.png` });

  console.log('\n▶ camera not connected yet');
  await page.setViewport({ width: 1424, height: 830 });
  feed.shape = 'portrait'; feed.down = true;
  await open(page);
  await waitFor(page, ['waiting']); await sleep(500);
  g = await probe(page);
  ok(g.pstatus === 'waiting' && g.note === 'The camera is getting ready' && g.status === 'Waiting for the camera', `note over the empty frame, bar doesn't claim Live (${g.status})`);
  await page.screenshot({ path: `${OUT}waiting.png` });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(600);
  g = await probe(page);
  const barFits = await page.evaluate(() => { const bar = document.querySelector('[data-s="bar"]').getBoundingClientRect(); return [...document.querySelectorAll('[data-s="bar"] *')].filter((el) => el.getBoundingClientRect().width > 0).every((el) => el.getBoundingClientRect().right <= bar.right + 1); });
  ok([g.stage, g.bar].every((b) => b.x >= 8 && b.r <= g.vw - 8) && barFits && !g.heart, 'phone: waiting state fits, the bar shows only what the camera is doing');
  await page.screenshot({ path: `${OUT}waiting-phone.png` });
  await page.setViewport({ width: 1424, height: 830 });

  console.log('\n▶ the feed drops, then comes back');
  feed.down = false;
  await waitFor(page, ['playing']);
  phoneOff();
  // (the usual delay's worth of picture plays out first)
  await waitFor(page, ['reconnecting'], 45000);
  g = await probe(page);
  ok(g.pstatus === 'reconnecting' && g.note === 'Reconnecting' && g.status === 'Reconnecting', 'Reconnecting, on the frame and in the bar');
  phoneOn();
  // (and plays on once the feed has the usual delay's worth again)
  await waitFor(page, ['playing'], 45000);
  g = await probe(page);
  ok(g.pstatus === 'playing' && g.status === 'Live', 'picks back up by itself');

  console.log('\n▶ the live delay, a dropped signal, Stream closing the recording, the phone back: nothing twice, nothing skipped');
  // Nov 18 2026 test broadcasts: the page replayed the last few seconds over and over when the feed stalled, then the
  // whole broadcast from 0:00 once Stream had closed the recording. Now viewers watch 20 s behind the phone, a drop
  // under that never shows, a longer one holds the last frame and goes on from exactly there, and a closed recording
  // is played to its last frame and never from its start
  {
    await open(page);
    await waitFor(page, ['playing']); await sleep(4000);
    // Every frame shown, by the player it came from (a start-over empties the video) and its place; the status 4x a second
    await page.evaluate(() => {
      const v = document.querySelector('.stage__player video');
      const w = window;
      w.__frames = []; w.__gen = 0; w.__st = [];
      v.addEventListener('emptied', () => { w.__gen++; });
      const each = (_now, md) => { w.__frames.push([w.__gen, md.mediaTime]); v.requestVideoFrameCallback(each); };
      v.requestVideoFrameCallback(each);
      setInterval(() => w.__st.push(document.querySelector('[data-stage]')?.dataset.pstatus), 250);
    });
    const behindNewest = () => page.evaluate(() => { const v = document.querySelector('.stage__player video'); return v?.seekable.length ? v.seekable.end(v.seekable.length - 1) - v.currentTime : null; });
    const seenAgain = (from) => page.evaluate((f) => {
      const best = new Map();
      let again = 0;
      window.__frames.forEach(([gen, t], i) => { const top = best.get(gen) ?? -1; if (i >= f && t < top - 0.5) again++; if (t > top) best.set(gen, t); });
      return again;
    }, from);
    const frameCount = () => page.evaluate(() => window.__frames.length);
    let b = await behindNewest();
    ok(b != null && b > 15 && b < 25, `viewers watch about 20 s behind the phone (${b?.toFixed(1)} s)`);

    // A short drop, under the delay: never seen
    const st0 = await page.evaluate(() => window.__st.length);
    phoneOff(); await sleep(8000); phoneOn(); await sleep(14000);
    const sts = await page.evaluate((f) => [...new Set(window.__st.slice(f))], st0);
    ok(sts.length === 1 && sts[0] === 'playing', `an 8 s drop never shows: the picture plays straight through (${sts.join(', ')})`);

    // A long drop: the picture plays out what it has, holds its last frame, then goes on from exactly there
    let from = await frameCount();
    phoneOff();
    await waitFor(page, ['reconnecting'], 45000);
    const heldAt = await page.evaluate(() => document.querySelector('.stage__player video').currentTime);
    await sleep(6000);
    const held = await page.evaluate(() => { const v = document.querySelector('.stage__player video'); return { t: v.currentTime, rs: v.readyState, src: !!v.currentSrc }; });
    g = await probe(page);
    ok(g.pstatus === 'reconnecting' && g.note === 'Reconnecting' && Math.abs(held.t - heldAt) < 0.05 && held.rs >= 2 && held.src, `long drop: Reconnecting over the last frame, held (${heldAt.toFixed(1)} s, then ${held.t.toFixed(1)} s)`);
    // A tap on the picture (sound on) while it holds: still holding (playing on now would leave no cushion)
    await page.evaluate(() => { const pic = document.querySelector('.stage__picture'); const b = pic.getBoundingClientRect(); pic.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })); });
    await sleep(2500);
    const tapped = await page.evaluate(() => { const v = document.querySelector('.stage__player video'); return { t: v.currentTime, paused: v.paused, muted: v.muted }; });
    g = await probe(page);
    ok(g.pstatus === 'reconnecting' && tapped.paused && Math.abs(tapped.t - heldAt) < 0.05, `a tap for sound while it holds: still holding (${g.pstatus}, at ${tapped.t.toFixed(1)} s, sound ${tapped.muted ? 'off' : 'on'})`);
    const framesBefore = await frameCount();
    phoneOn();
    await waitFor(page, ['playing'], 45000); await sleep(3000);
    const after = await page.evaluate((f) => window.__frames.slice(f).map(([, t]) => t), framesBefore);
    b = await behindNewest();
    const again = await seenAgain(from);
    ok(again <= 1 && after.length > 0 && after[0] >= heldAt - 0.5 && after[0] <= heldAt + 2.5, `back: on from exactly where it stopped, nothing shown twice or skipped (${again} frames again; held at ${heldAt.toFixed(1)}, went on at ${after[0]?.toFixed(1)})`);
    ok(b != null && b > 14, `back with the usual delay to spare again (${b?.toFixed(1)} s behind the newest piece)`);

    // Stream closes the recording: the last frame, then nothing (never the recording from its start)
    phoneOff();
    await waitFor(page, ['reconnecting'], 45000);
    const oldRec = feed.rec.slice(0, 4);
    const lastPiece = recordings.get(feed.rec).count - 1;
    feed.pieces = [];
    closeRecording();
    await sleep(14000);
    g = await probe(page);
    const replayedPieces = feed.pieces.filter((p) => p.r === oldRec && p.n < lastPiece - 1).map((p) => p.n);
    ok(g.pstatus === 'reconnecting' && replayedPieces.length === 0, `recording closed: Reconnecting, nothing of it played again (${g.pstatus}; pieces asked for again: ${replayedPieces.slice(0, 6).join(', ') || 'none'})`);

    // Someone arriving now: a closed recording is never played as live
    {
      const late = await browser.newPage();
      late.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await mock(late);
      await late.setViewport({ width: 1424, height: 830 });
      feed.pieces = [];
      await late.goto(`${BASE}/live/?visit=${++visits}`, { waitUntil: 'domcontentloaded' });
      await sleep(7000);
      const ls = await late.evaluate(() => document.querySelector('[data-stage]')?.dataset.pstatus);
      ok(ls === 'waiting' && feed.pieces.length === 0, `arriving after the recording closed: not played as live (${ls}; pieces asked for: ${feed.pieces.length})`);
      await late.close();
    }

    // The phone back: a new recording, from its first piece, with the usual delay's worth in hand
    feed.pieces = [];
    phoneOn();
    const newRec = feed.rec.slice(0, 4);
    await waitFor(page, ['playing'], 45000); await sleep(2000);
    g = await probe(page);
    const asked = feed.pieces.filter((p) => p.r === newRec).map((p) => p.n);
    const oldAsked = feed.pieces.filter((p) => p.r !== newRec).map((p) => p.n);
    ok(newRec !== oldRec && g.pstatus === 'playing' && asked.length > 0 && Math.min(...asked) === 0 && oldAsked.length === 0, `phone back after the close: the new recording from its first piece (pieces ${asked.length ? Math.min(...asked) : '-'} on), nothing of the old one (${oldAsked.join(', ') || 'none'})`);
    feed.pieces = null;

    // Someone there from the very start of a recording: they wait for the usual delay's worth, then sit the full
    // delay behind too (not a few seconds, with no cushion); and a passing error reading the DVR playlist doesn't
    // send the player to the short plain playlist
    closeRecording(); await sleep(1000); phoneOn(); // a new recording, 8 s long
    feed.dvrFails = 2;
    const early = await browser.newPage();
    early.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await mock(early);
    await early.setViewport({ width: 1424, height: 830 });
    await early.goto(`${BASE}/live/?visit=${++visits}`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const before = await early.evaluate(() => document.querySelector('[data-stage]')?.dataset.pstatus);
    await waitFor(early, ['playing'], 45000); await sleep(1500);
    const eb = await early.evaluate(() => { const v = document.querySelector('.stage__player video'); return v?.seekable.length ? v.seekable.end(v.seekable.length - 1) - v.currentTime : null; });
    const es = await early.evaluate(() => document.querySelector('[data-stage]')?.dataset.pstatus);
    ok(before === 'waiting' && es === 'playing' && eb != null && eb > 15, `there from the start: waits for the delay's worth (${before}), then plays the full delay behind (${eb?.toFixed(1)} s), through a passing DVR error`);
    await early.close();
    feed.dvrFails = 0;
  }

  console.log('\n▶ going back (From the start, Back to live) and the reveal\'s end ("That\'s the reveal!")');
  // Peter, Nov 18 2026: someone arriving late can go back to the beginning (Cloudflare's recording of the broadcast so
  // far) and come back to the live moment; the reveal ends with "That's the reveal!" once the live video, 20 s behind the
  // phone, has played its last frame (often the reveal itself is in those last seconds), and the replay only on a tap
  {
    const refresh = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const seen = (k) => page.evaluate((x) => { const e = document.querySelector(`[data-s="${x}"]`); return !!e && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0; }, k);
    const end = () => page.evaluate(() => {
      const t = (k) => document.querySelector(`[data-s="${k}"]`);
      const v = document.querySelector('.stage__player video'); const pic = document.querySelector('.stage__picture').getBoundingClientRect();
      const hit = document.elementFromPoint(pic.left + pic.width / 2, pic.top + pic.height * 0.8);
      return {
        shown: !t('end').hidden, text: t('end-text').textContent, replay: !t('end-replay').hidden, wait: !t('end-wait').hidden, status: !t('note').hidden ? t('note-title').textContent : '',
        pill: !document.querySelector('[data-live="onair"]').hidden, overVideo: hit === v, pkind: document.querySelector('[data-stage]').dataset.pkind, phase: document.querySelector('#live-hero').dataset.phase,
      };
    });
    if (recordings.get(feed.rec).closed) phoneOn();
    state = { ...STATES.live, kidName: 'Axel' }; feed.shape = 'portrait'; feed.down = false; feed.window = 8;
    await page.setViewport({ width: 1424, height: 830 });
    await open(page);
    await waitFor(page, ['playing']);
    let offered = false;
    for (let i = 0; i < 45 && !(offered = await seen('from-start')); i++) await sleep(1000);
    ok(offered && !(await seen('to-live')), 'From the start is offered once the broadcast so far can be gone back through');
    const t0 = await page.evaluate(() => document.querySelector('.stage__player video').currentTime);
    await page.click('[data-s="from-start"]'); await sleep(3500);
    const back = await page.evaluate(() => ({ t: document.querySelector('.stage__player video').currentTime, behind: document.querySelector('[data-s="behind"]').textContent, focus: document.activeElement?.dataset?.s }));
    ok((await seen('to-live')) && !(await seen('from-start')) && back.t < t0 - 8 && /\d:\d\d behind/.test(back.behind) && back.focus === 'to-live', `From the start: back to the beginning (${t0.toFixed(1)} → ${back.t.toFixed(1)} s), Back to live with "${back.behind}", the focus on it (${back.focus})`);
    await page.click('[data-s="to-live"]'); await sleep(4000);
    const live = await page.evaluate(() => document.querySelector('.stage__player video').currentTime);
    ok((await seen('from-start')) && !(await seen('to-live')) && live > back.t + 8, `Back to live: the live moment again (${live.toFixed(1)} s), From the start offered again`);

    // The broadcast becomes a replay (not ready yet) while the video still has its last seconds: it plays on, live
    state = { ...STATES.replay, kidName: 'Axel', player: null }; await refresh(); await sleep(3000);
    let e = await end();
    g = await probe(page);
    ok(!e.shown && e.phase === 'live' && e.pkind === 'live' && g.pstatus === 'playing', `the broadcast moves on: its last seconds still play, live (${e.phase}, ${g.pstatus})`);
    // The phone stopped and Stream closes the recording: once its last frame has played, "That's the reveal!"
    phoneOff(); closeRecording();
    for (let i = 0; i < 60 && !(e = await end()).shown; i++) await sleep(1000);
    ok(e.shown && /^Thank you for watching Axel's reveal\.$/.test(e.text) && e.wait && !e.replay, `the last frame played: "That's the reveal!", "${e.text}", the replay in a few minutes`);
    ok(!e.overVideo && !e.status && !e.pill, `over the photo, not the video; no Reconnecting under it, no Live by the name (${JSON.stringify({ overVideo: e.overVideo, status: e.status, pill: e.pill })})`);
    // The replay ready: offered, never started by itself; a tap starts it
    state = { ...STATES.replay, kidName: 'Axel' }; await refresh(); await sleep(2500);
    e = await end();
    ok(e.shown && e.replay && !e.wait && e.pkind === 'live', `the replay ready: Watch the replay, not started by itself (${e.pkind})`);
    // (a slow replay: the press waits on its source; the button says what's coming, Pause)
    feed.replayDelay = 2500;
    await page.click('[data-s="end-replay"]');
    await sleep(900);
    const waiting = await page.evaluate(() => ({ label: document.querySelector('[data-s="play"]').getAttribute('aria-label'), paused: document.querySelector('.stage__player video')?.paused, rs: document.querySelector('.stage__player video')?.readyState }));
    // (paused: the press's play was called off by the reset as the replay's source came, and waits: the case this is for)
    ok(waiting.label === 'Pause' && waiting.rs === 0 && waiting.paused === true, `while the replay loads after the press, the button says Pause (${JSON.stringify(waiting)})`);
    feed.replayDelay = 0;
    await waitFor(page, ['paused', 'playing'], 20000); await sleep(1000);
    e = await end();
    ok(!e.shown && e.pkind === 'replay', `Watch the replay: the replay, from its beginning (${e.pkind})`);
    // ...and it plays, with its sound, from that one press (Peter, Nov 18 2026: it was left paused at 0:00 until the
    // bar's play was pressed). Twice a second apart: its time moves on
    await waitFor(page, ['playing'], 15000);
    const r1 = await probe(page); await sleep(1000); const r2 = await probe(page);
    ok(r2.pstatus === 'playing' && r2.paused === false && r2.muted === false && r2.time > r1.time + 0.5, `one press on Watch the replay plays it with sound (${r1.pstatus} ${r1.time?.toFixed(1)}s, then ${r2.pstatus} ${r2.time?.toFixed(1)}s, muted ${r2.muted})`);

    // The phone back on after the end (the same reveal reopened): the note goes, live again
    phoneOn(); state = { ...STATES.live, kidName: 'Axel' }; await open(page); await waitFor(page, ['playing']); await sleep(2000);
    state = { ...STATES.replay, kidName: 'Axel', player: null }; await refresh(); await sleep(1500);
    phoneOff(); closeRecording();
    for (let i = 0; i < 60 && !(e = await end()).shown; i++) await sleep(1000);
    phoneOn(); state = { ...STATES.live, kidName: 'Axel' }; await refresh();
    await waitFor(page, ['playing'], 45000); await sleep(1500);
    e = await end();
    ok(!e.shown && e.pkind === 'live', `the phone back on: the note goes, live again (${e.pkind})`);

    // A camera check before the start: live, then back to the countdown, never "That's the reveal!"
    state = { ...STATES.live, kidName: 'Axel' }; await refresh(); await sleep(1000);
    state = { ...base, phase: 'armed', upcoming: true, scheduledAt: new Date(Date.now() + 30 * 60e3).toISOString(), player: null }; await refresh();
    let flashed = false;
    for (let i = 0; i < 8; i++) { await sleep(500); if ((await end()).shown) flashed = true; }
    ok(!flashed, 'a camera check before the start (back to the countdown) never shows "That\'s the reveal!"');

    // A live video paused by the phone (the lock screen, a call, AirPods out): Tap to watch, and a tap plays on, live
    if (recordings.get(feed.rec).closed) phoneOn();
    state = { ...STATES.live, kidName: 'Axel' }; await open(page); await waitFor(page, ['playing']); await sleep(1500);
    await page.click('[data-s="sound"]').catch(() => {}); await sleep(500);
    await page.evaluate(() => document.querySelector('.stage__player video').pause());
    await waitFor(page, ['paused'], 5000); await sleep(400);
    const tapShown = await seen('tap');
    await page.click('[data-s="tap"]');
    await waitFor(page, ['playing'], 15000); await sleep(800);
    const resumed = await page.evaluate(() => ({ paused: document.querySelector('.stage__player video').paused, st: document.querySelector('[data-stage]').dataset.pstatus }));
    ok(tapShown && !resumed.paused && resumed.st === 'playing', `paused by the phone: Tap to watch, and a tap plays on (${tapShown}, ${resumed.st})`);

    // Paused when the broadcast moves on: not held as live (nothing is playing out), the note straight away
    await page.evaluate(() => document.querySelector('.stage__player video').pause());
    await waitFor(page, ['paused'], 5000);
    state = { ...STATES.replay, kidName: 'Axel' }; await refresh(); await sleep(2500);
    e = await end();
    ok(e.shown && e.phase !== 'live', `paused when the broadcast moved on: the note, not a Live page held for nothing (${e.shown}, ${e.phase})`);

    // The give form open as the reveal ends: it stays open (the page keeps its layout for the note)
    if (recordings.get(feed.rec).closed) phoneOn();
    state = { ...STATES.live, kidName: 'Axel' }; await open(page); await waitFor(page, ['playing']); await sleep(1500);
    const gave = await page.evaluate(() => { const b = [...document.querySelectorAll('.hero-ctas a, .hero-ctas button')].find((x) => /fund the next room/i.test(x.textContent || '')); b?.click(); return !!b; });
    await sleep(1200);
    state = { ...STATES.replay, kidName: 'Axel', player: null }; await refresh(); await sleep(1500);
    phoneOff(); closeRecording();
    for (let i = 0; i < 60 && !(e = await end()).shown; i++) await sleep(1000);
    g = await probe(page);
    ok(gave && e.shown && !!g.give, `the give form open as the reveal ends: it stays open beside "That's the reveal!" (${gave}, ${e.shown}, ${!!g.give})`);
    await page.keyboard.press('Escape');

    // A staff test after the reveal (its own broadcast), ending back on the reveal's replay: never "That's the reveal!"
    phoneOn();
    state = { ...STATES.live, id: 'test-2', kidName: 'Axel' }; await open(page); await waitFor(page, ['playing']); await sleep(1500);
    state = { ...STATES.replay, kidName: 'Axel' }; await refresh();
    let again = false;
    for (let i = 0; i < 8; i++) { await sleep(500); if ((await end()).shown) again = true; }
    e = await end();
    ok(!again && e.pkind === 'replay', `a staff test after the reveal ends back on its replay: no "That's the reveal!" again (${again}, ${e.pkind})`);
    state = STATES.live;
    // (the phone's recording here is a new one: what follows expects one long enough for the usual delay and more)
    await sleep(26000);
  }

  console.log('\n▶ back from a pause (the lock screen, a call, another app)');
  // A playlist long enough that a 10 s pause stays inside it: hls.js eases back from about one piece late and jumps
  // only past 10, so on its own it would carry on 10 s behind everyone else
  {
    feed.window = 15;
    await open(page);
    await waitFor(page, ['playing']); await sleep(3000);
    const behind = () => page.evaluate(() => { const v = document.querySelector('.stage__player video'); return v?.seekable.length ? v.seekable.end(v.seekable.length - 1) - v.currentTime : null; });
    const before = await behind();
    await page.evaluate(() => document.querySelector('.stage__player video').pause());
    await sleep(10000);
    await page.evaluate(() => document.querySelector('.stage__player video').play());
    await waitFor(page, ['playing']); await sleep(2000);
    const after = await behind();
    ok(before != null && after != null && after <= before + 2.5, `playing again after a 10 s pause, it's back at the live moment (${before?.toFixed(1)} s from the newest piece before the pause, ${after?.toFixed(1)} s after)`);
    feed.window = 3;
  }

  console.log('\n▶ autoplay refused (an iPhone in Low Power Mode), tapped before the picture has come in');
  {
    const tapPage = await browser.newPage();
    tapPage.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|Failed to load resource|cloudflareinsights\.com/.test(m.text())) errors.push(m.text()); });
    tapPage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await tapPage.evaluateOnNewDocument(() => {
      // Nothing plays until someone taps, the browser's own autoplay included
      let tapped = false;
      addEventListener('click', () => { tapped = true; }, true);
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { return tapped ? play.call(this) : Promise.reject(new DOMException('Low Power Mode', 'NotAllowedError')); };
      Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', { get() { return false; }, set() {} });
    });
    await mock(tapPage);
    await tapPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    feed.held = [];
    await tapPage.goto(`${BASE}/live/?visit=${++visits}`, { waitUntil: 'domcontentloaded' });
    await waitFor(tapPage, ['blocked']);
    const tapShown = () => tapPage.evaluate(() => { const el = document.querySelector('[data-s="tap"]'); return !!el && !el.closest('[hidden]') && el.getBoundingClientRect().width > 0; });
    let t = await probe(tapPage);
    ok(t.pstatus === 'blocked' && await tapShown(), `Tap to watch over the frame (${t.pstatus})`);
    await tapPage.click('[data-s="tap"]');
    await sleep(500);
    t = await probe(tapPage);
    ok(t.pstatus === 'connecting' && !(await tapShown()), `the tap is taken at once: Tap to watch goes and it waits for the picture (${t.pstatus})`);
    for (const send of feed.held.splice(0)) send();
    feed.held = null;
    await waitFor(tapPage, ['playing'], 30000);
    t = await probe(tapPage);
    ok(t.pstatus === 'playing' && !(await tapShown()), `then it plays (${t.pstatus})`);
    await tapPage.close();
  }

  console.log('\n▶ replay');
  state = STATES.replay;
  await open(page);
  await page.waitForFunction(() => !document.querySelector('[data-s="jump"]')?.hidden, { timeout: 15000 }).catch(() => {});
  await sleep(600);
  g = await probe(page);
  ok(g.mode === 'replay' && g.party && !g.heart, 'replay in the watch-party layout, no heart');
  ok(g.mark && g.jump === 'Jump to the reveal', 'the reveal is marked on the seek bar, with a Jump button');
  await page.click('[data-s="jump"]');
  await waitFor(page, ['playing']);
  await sleep(500);
  g = await probe(page);
  ok(g.pstatus === 'playing' && g.time >= 1 && g.time < 4, `Jump plays from just before the reveal (${g.time?.toFixed(1)}s)`);
  ok(!g.covered, `no control bar drawn on the replay${g.covered ? ` (hit ${g.covered})` : ''}`);
  ok(g.muted === false, 'a replay plays with sound');
  await page.click('[data-s="cc-toggle"]');
  await sleep(700);
  g = await probe(page);
  ok(g.cc === 'Okay, open your eyes!', `captions under the picture (${g.cc})`);
  await page.screenshot({ path: `${OUT}replay.png` });
  await page.click('[data-s="play"]');
  await sleep(300);
  ok((await probe(page)).paused === true, 'play button pauses');
  // Keyboard, with focus anywhere in the stage: K plays and pauses, M mutes, C captions
  await page.focus('[data-s="cc-toggle"]');
  await page.keyboard.press('k');
  await sleep(400);
  ok((await probe(page)).paused === false, 'K plays');
  await page.keyboard.press('m');
  await sleep(200);
  ok((await probe(page)).muted === true, 'M mutes');
  await page.keyboard.press('c');
  await sleep(200);
  ok((await probe(page)).cc === null, 'C turns captions off');
  const tabStops = await page.evaluate(() => [...document.querySelectorAll('[data-stage] button, [data-stage] input')].filter((el) => !el.closest('[hidden]') && el.getBoundingClientRect().width > 0 && el.tabIndex >= 0).map((el) => el.getAttribute('aria-label') || el.textContent.trim()));
  // (The reveal's star is a marker on the line, not a stop: Jump to the reveal is the button)
  ok(tabStops.length >= 5 && tabStops.every(Boolean) && tabStops.some((t) => t.startsWith('Jump to the reveal')), `every control is a labelled tab stop (${tabStops.join(', ')})`);

  // A press on play, then on pause, before the replay has loaded: it stays paused once it loads (the review of the
  // one-press fix: a pause pressed while a play was starting was taken for the video being reset, and it played anyway)
  console.log('\n▶ replay: play then pause before it has loaded');
  feed.replayDelay = 2500;
  await page.setViewport({ width: 1280, height: 800 });
  await open(page);
  // (the video has its source first, so the press isn't reset by it arriving: this is the viewer's own pause, the 'pause'
  // counter's case, not the Watch the replay reset's)
  await page.waitForFunction(() => { const v = document.querySelector('.stage__player video'); return !!v && (v.src.startsWith('blob:') || !!v.querySelector('source')); }, { timeout: 15000 }).catch(() => {});
  await page.click('[data-s="play"]'); await sleep(250);
  const beforeLoad = await page.evaluate(() => ({ rs: document.querySelector('.stage__player video').readyState, label: document.querySelector('[data-s="play"]').getAttribute('aria-label') }));
  await page.click('[data-s="play"]');
  await sleep(4500);
  feed.replayDelay = 0;
  const kept = await page.evaluate(() => { const v = document.querySelector('.stage__player video'); return { paused: v.paused, t: v.currentTime, rs: v.readyState, label: document.querySelector('[data-s="play"]').getAttribute('aria-label') }; });
  ok(beforeLoad.rs === 0 && kept.paused && kept.t === 0 && kept.rs >= 1 && kept.label === 'Play', `pressed play then pause while it loaded (${beforeLoad.label}): it loaded and stayed paused (${JSON.stringify(kept)})`);
  // Sound off and on again (M twice) on a paused replay: only the sound changes, it doesn't start (a review, Nov 19 2026)
  await page.focus('[data-s="seek"]');
  await page.keyboard.press('m'); await sleep(200); await page.keyboard.press('m'); await sleep(1200);
  const mm = await page.evaluate(() => { const v = document.querySelector('.stage__player video'); return { paused: v.paused, muted: v.muted }; });
  ok(mm.paused && !mm.muted, `M twice on a paused replay: sound off and on, still paused (${JSON.stringify(mm)})`);

  // The progress line and the play button (Peter, Nov 18 2026: "top tier, best in class ... motion"): the handle and the
  // line glide with the picture (they jumped 4 times a second), the icon turns from play into pause, the buttons give
  // under a press; a finger anywhere on the line scrubs with the picture following it, a tap goes there, a swipe up from
  // it still scrolls the page; the keyboard's Home, End and arrows; the picture fills its frame
  console.log('\n▶ replay: the line glides, the icon turns, a finger scrubs');
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await open(page);
  await page.waitForFunction(() => document.querySelector('.stage__player video')?.duration > 0, { timeout: 15000 }).catch(() => {});
  await sleep(500);
  const touchCdp = await page.createCDPSession();
  const touch = (type, x, y) => touchCdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const vid = () => page.evaluate(() => { const v = document.querySelector('.stage__player video'); return { time: v.currentTime, d: v.duration, paused: v.paused }; });
  const PLAY_D = await page.$eval('[data-s="morph"]', (el) => el.getAttribute('d'));
  // (iPhone Safari showed a sliver of the frame's dark down one side of a picture fitted inside it)
  const fit = await page.evaluate(() => {
    const v = document.querySelector('.stage__player video').getBoundingClientRect(), c = document.querySelector('.stage__clip').getBoundingClientRect();
    return { exact: document.querySelector('[data-stage]').hasAttribute('data-exact'), fit: getComputedStyle(document.querySelector('.stage__player video')).objectFit, past: Math.min(c.left - v.left, v.right - c.right, c.top - v.top, v.bottom - c.bottom) };
  });
  ok(fit.exact && fit.fit === 'cover' && fit.past >= 0.9, `the picture fills its frame and reaches past each edge (${JSON.stringify(fit)})`);
  // The shapes the icon takes from the moment the video says it's playing (or paused), for 400 ms
  const turnOf = () => page.evaluate(() => new Promise((res) => {
    const path = document.querySelector('[data-s="morph"]'); const v = document.querySelector('.stage__player video');
    const seen = []; let t0 = 0;
    const step = () => { seen.push(path.getAttribute('d')); if (performance.now() - t0 < 400) requestAnimationFrame(step); else res({ shapes: new Set(seen).size, end: path.getAttribute('d'), label: document.querySelector('[data-s="play"]').getAttribute('aria-label') }); };
    v.addEventListener(v.paused ? 'play' : 'pause', () => { t0 = performance.now(); seen.push(path.getAttribute('d')); requestAnimationFrame(step); }, { once: true });
    document.querySelector('[data-s="play"]').click();
  }));
  const turn = await turnOf();
  ok(turn.shapes >= 5 && turn.end !== PLAY_D && turn.label === 'Pause', `play turns into pause through ${turn.shapes} shapes, not at once (${turn.label})`);
  await waitFor(page, ['playing']);
  // While it plays, the handle has a new place every frame, and never goes back
  const glideR = await page.evaluate(() => new Promise((res) => {
    const k = document.querySelector('.seek__knob'); const xs = []; const t0 = performance.now();
    const step = () => { xs.push(k.getBoundingClientRect().left); if (performance.now() - t0 < 1500) requestAnimationFrame(step); else res({ frames: xs.length, moves: xs.filter((x, i) => i && x !== xs[i - 1]).length, back: xs.filter((x, i) => i && x < xs[i - 1] - 0.01).length, playing: !document.querySelector('.stage__player video').paused }); };
    requestAnimationFrame(step);
  }));
  ok(glideR.playing && glideR.moves >= glideR.frames * 0.8 && glideR.back === 0, `the handle glides: it moved on ${glideR.moves} of ${glideR.frames} frames, back ${glideR.back} times`);
  const loaded = await page.$eval('.seek', (c) => ({ buf: Number(getComputedStyle(c).getPropertyValue('--buf')), f: Number(getComputedStyle(c).getPropertyValue('--f')) }));
  ok(loaded.buf > loaded.f, `how much has loaded shows past where it's at (${JSON.stringify(loaded)})`);
  // A press on play: it gives, then springs back when the finger lifts (and the tap pauses it)
  const pb = await page.$eval('[data-s="play"]', (b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const scaleOf = () => page.$eval('[data-s="play"]', (b) => { const t = getComputedStyle(b).transform; return { on: b.hasAttribute('data-press'), scale: t === 'none' ? 1 : new DOMMatrix(t).a }; });
  await touch('touchStart', pb.x, pb.y); await sleep(160);
  const pressed = await scaleOf();
  await touch('touchEnd', pb.x, pb.y); await sleep(500);
  const released = await scaleOf();
  ok(pressed.on && pressed.scale < 0.95 && !released.on && Math.abs(released.scale - 1) < 0.01 && (await vid()).paused, `the play button gives under a press and springs back (${pressed.scale.toFixed(2)}, then ${released.scale.toFixed(2)})`);
  // Scrubbing: a finger down on the line, along it from 20% to 70%, and up
  await page.evaluate(() => { const v = document.querySelector('.stage__player video'); v.currentTime = 0.3; v.play(); });
  await waitFor(page, ['playing']); await sleep(300);
  const ln = await page.$eval('.seek__line', (l) => { const r = l.getBoundingClientRect(); return { l: r.left + 8, r: r.right - 8, y: r.top + r.height / 2 }; });
  const at = (f) => ln.l + (ln.r - ln.l) * f;
  await page.evaluate(() => { const v = document.querySelector('.stage__player video'); window.__drag = new Set(); window.__dragT = setInterval(() => window.__drag.add(v.currentTime.toFixed(2)), 40); });
  await touch('touchStart', at(0.2), ln.y); await sleep(300);
  const held = await page.evaluate(() => ({ scrub: document.querySelector('[data-s="replaybar"]').hasAttribute('data-scrub'), knob: document.querySelector('.seek__knob').getBoundingClientRect().width, playing: !document.querySelector('.stage__player video').paused }));
  ok(held.scrub && held.knob >= 22 && held.playing, `a finger on the line: the handle grows at once (${held.knob.toFixed(1)}px), nothing else moves yet`);
  for (let i = 1; i <= 15; i++) { await touch('touchMove', at(0.2 + (0.5 * i) / 15), ln.y); await sleep(40); }
  await sleep(300);
  const mid = await page.evaluate(() => { const v = document.querySelector('.stage__player video'); return { paused: v.paused, time: v.currentTime, d: v.duration, icon: document.querySelector('[data-s="play"]').getAttribute('aria-label'), line: document.querySelector('.seek__line').getBoundingClientRect().height, shown: document.querySelector('[data-s="time-now"]').textContent, followed: window.__drag.size }; });
  ok(mid.paused && mid.icon === 'Pause' && mid.line >= 9, `scrubbing, the video waits, the line thickens (${mid.line}px), and the button still says Pause`);
  ok(Math.abs(mid.time - 0.7 * mid.d) < 0.5 && mid.followed >= 4, `the picture follows the finger (${mid.followed} places on the way, at ${mid.time.toFixed(1)}s for ${(0.7 * mid.d).toFixed(1)}s, "${mid.shown}")`);
  await touch('touchEnd', at(0.7), ln.y); await sleep(700);
  const lifted = { ...(await vid()), scrub: await page.$eval('[data-s="replaybar"]', (b) => b.hasAttribute('data-scrub')) };
  await page.evaluate(() => clearInterval(window.__dragT));
  ok(!lifted.paused && !lifted.scrub && lifted.time >= 0.7 * lifted.d - 0.3 && lifted.time < 0.7 * lifted.d + 1.2, `the finger lifted, it plays on from there (${lifted.time.toFixed(1)}s)`);
  // A tap on the line: there, and it keeps playing
  await page.evaluate(() => { const v = document.querySelector('.stage__player video'); v.currentTime = 0.2; });
  await sleep(300);
  await touch('touchStart', at(0.4), ln.y); await sleep(60); await touch('touchEnd', at(0.4), ln.y); await sleep(350);
  const tapped = await vid();
  ok(!tapped.paused && Math.abs(tapped.time - 0.4 * tapped.d) < 0.6, `a tap on the line goes there and plays on (${tapped.time.toFixed(1)}s for ${(0.4 * tapped.d).toFixed(1)}s)`);
  // A swipe up that starts on the line: the page scrolls, the video doesn't jump (a little sideways drift included)
  const swipeFrom = { ...(await vid()), y: await page.evaluate(() => scrollY) };
  await touch('touchStart', at(0.9), ln.y);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', at(0.9) + i * 0.6, ln.y - i * 14); await sleep(16); }
  await touch('touchEnd', at(0.9) + 6, ln.y - 140); await sleep(600);
  const swiped = { ...(await vid()), y: await page.evaluate(() => scrollY), scrub: await page.$eval('[data-s="replaybar"]', (b) => b.hasAttribute('data-scrub')) };
  ok(swiped.y > swipeFrom.y && !swiped.scrub && swiped.time >= swipeFrom.time - 0.05 && swiped.time - swipeFrom.time < 1.5, `a swipe up from the line scrolls the page (${swiped.y - swipeFrom.y}px) and the video doesn't jump (${swipeFrom.time.toFixed(1)}s, then ${swiped.time.toFixed(1)}s)`);
  await page.evaluate(() => scrollTo(0, 0)); await sleep(300);
  // The keyboard on the line: End, Home, and the arrows 5 seconds
  await page.evaluate(() => document.querySelector('.stage__player video').pause());
  await page.focus('[data-s="seek"]');
  await page.keyboard.press('End'); await sleep(400);
  const kEnd = await vid();
  await page.keyboard.press('Home'); await sleep(400);
  const kHome = await vid();
  await page.keyboard.press('ArrowRight'); await sleep(400);
  const kRight = await vid();
  ok(kEnd.time > kEnd.d - 0.3 && kHome.time < 0.2 && Math.abs(kRight.time - 5) < 0.2, `the keyboard goes along the line: End ${kEnd.time.toFixed(1)}s, Home ${kHome.time.toFixed(1)}s, then → ${kRight.time.toFixed(1)}s`);
  // With reduced motion the icon changes at once (no turning)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await open(page);
  await page.waitForFunction(() => document.querySelector('.stage__player video')?.duration > 0, { timeout: 15000 }).catch(() => {});
  await sleep(400);
  const still = await turnOf();
  ok(still.shapes === 1 && still.end !== PLAY_D, `with reduced motion the icon changes at once (${still.shapes} shape)`);
  await page.emulateMediaFeatures([]);
  await page.evaluate(() => document.querySelector('.stage__player video').pause());
  // Safari reports where the video is only about 10 times a second (Chrome every frame): with the video's clock made that
  // coarse (a quarter second at a time) wherever the page reads it in a frame (the line's glide; never for the video's
  // own loader, which runs on timers and stalls when its clock doesn't move), the handle still has a new place every
  // frame and never steps back
  await open(page);
  await page.waitForFunction(() => document.querySelector('.stage__player video')?.duration > 0, { timeout: 15000 }).catch(() => {});
  await sleep(400);
  await page.evaluate(() => {
    const v = document.querySelector('.stage__player video');
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    const raf = window.requestAnimationFrame.bind(window);
    let inFrame = false;
    window.requestAnimationFrame = (cb) => raf((t) => { inFrame = true; try { cb(t); } finally { inFrame = false; } });
    Object.defineProperty(v, 'currentTime', { configurable: true, get() { const x = d.get.call(this); return inFrame ? Math.floor(x * 4) / 4 : x; }, set(x) { d.set.call(this, x); } });
    document.querySelector('[data-s="play"]').click();
  });
  await waitFor(page, ['playing']); await sleep(300);
  const coarse = await page.evaluate(() => new Promise((res) => {
    const k = document.querySelector('.seek__knob'); const v = document.querySelector('.stage__player video'); const xs = []; const ts = new Set(); const t0 = performance.now();
    const step = () => { xs.push(k.getBoundingClientRect().left); ts.add(v.currentTime); if (performance.now() - t0 < 1500) requestAnimationFrame(step); else res({ frames: xs.length, clock: ts.size, moves: xs.filter((x, i) => i && x !== xs[i - 1]).length, back: xs.filter((x, i) => i && x < xs[i - 1] - 0.01).length }); };
    requestAnimationFrame(step);
  }));
  ok(coarse.clock >= 4 && coarse.clock <= 8 && coarse.moves >= coarse.frames * 0.8 && coarse.back === 0, `with a coarse clock (${coarse.clock} reports in 1.5 s) the handle still glides: moved on ${coarse.moves} of ${coarse.frames} frames, back ${coarse.back} times`);
  await page.evaluate(() => document.querySelector('.stage__player video').pause());
  await sleep(300);
  const stopAt = await page.evaluate(() => { const v = document.querySelector('.stage__player video'); const c = document.querySelector('.seek'); return { f: Number(getComputedStyle(c).getPropertyValue('--f')), want: v.currentTime / v.duration }; });
  ok(Math.abs(stopAt.f - stopAt.want) < 0.002, `paused, the handle is exactly where the video stopped (${stopAt.f.toFixed(4)} for ${stopAt.want.toFixed(4)})`);

  // A mouse click on the line goes there, and the arrow keys then move the video (the slider keeps the focus)
  await page.setViewport({ width: 1280, height: 720 });
  await open(page);
  await page.waitForFunction(() => document.querySelector('.stage__player video')?.duration > 0, { timeout: 15000 }).catch(() => {});
  await sleep(500);
  const lnD = await page.$eval('.seek__line', (l) => { const r = l.getBoundingClientRect(); return { l: r.left + 8, r: r.right - 8, y: r.top + r.height / 2 }; });
  await page.mouse.click(lnD.l + (lnD.r - lnD.l) * 0.25, lnD.y);
  await sleep(500);
  const clicked = { ...(await vid()), focus: await page.evaluate(() => document.activeElement?.getAttribute('data-s')) };
  const ringShown = await page.$eval('.seek__ring', (r) => getComputedStyle(r).display !== 'none');
  await page.keyboard.press('ArrowRight'); await sleep(500);
  const arrowed = await vid();
  ok(Math.abs(clicked.time - 0.25 * clicked.d) < 0.5 && clicked.focus === 'seek' && Math.abs(arrowed.time - clicked.time - 5) < 0.6, `a click on the line goes there (${clicked.time.toFixed(1)}s) and → then moves 5 s (${arrowed.time.toFixed(1)}s; focus on ${clicked.focus})`);
  await page.keyboard.press('Tab'); await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); await sleep(200);
  const ringKeys = await page.evaluate(() => document.activeElement?.getAttribute('data-s') === 'seek' && getComputedStyle(document.querySelector('.seek__ring')).display !== 'none');
  ok(!ringShown && ringKeys, `the focus ring shows round the line for the keyboard, not after a click (click ${ringShown}, keys ${ringKeys})`);

  // Scrubbing while the video sits in the corner player: it stays there, playing on after the finger lifts
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await open(page);
  await page.waitForFunction(() => document.querySelector('.stage__player video')?.duration > 0, { timeout: 15000 }).catch(() => {});
  await sleep(500);
  await page.evaluate(() => { const v = document.querySelector('.stage__player video'); v.currentTime = 0.3; document.querySelector('[data-s="play"]').click(); });
  await waitFor(page, ['playing']);
  // (scrolled until the picture is docked while its bar is still on screen)
  const dockedAt = await page.evaluate(async () => {
    const bar = document.querySelector('[data-s="bar"]');
    for (let y = 0; y < 1200; y += 20) {
      scrollTo(0, y); await new Promise((r) => setTimeout(r, 60));
      const b = bar.getBoundingClientRect();
      if (document.querySelector('.stage__picture.is-docked') && b.top > 0 && b.bottom < innerHeight) return y;
    }
    return null;
  });
  if (dockedAt == null) ok(false, 'the corner player with the bar still on screen (no scroll position gives both here)');
  else {
    const lnK = await page.$eval('.seek__line', (l) => { const r = l.getBoundingClientRect(); return { l: r.left + 8, r: r.right - 8, y: r.top + r.height / 2 }; });
    const atK = (f) => lnK.l + (lnK.r - lnK.l) * f;
    await touch('touchStart', atK(0.2), lnK.y); await sleep(100);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', atK(0.2 + (0.4 * i) / 8), lnK.y); await sleep(40); }
    await sleep(300);
    const dockMid = await page.evaluate(() => !!document.querySelector('.stage__picture.is-docked'));
    await touch('touchEnd', atK(0.6), lnK.y); await sleep(800);
    const dockAfter = await page.evaluate(() => ({ docked: !!document.querySelector('.stage__picture.is-docked'), paused: document.querySelector('.stage__player video').paused }));
    ok(dockMid && dockAfter.docked && !dockAfter.paused, `scrubbing with the video in the corner player, it stays there (during ${dockMid}, after ${dockAfter.docked}) and plays on`);
    await page.evaluate(() => { document.querySelector('.stage__player video').pause(); scrollTo(0, 0); });
  }

  // A portrait replay's bar is as narrow as the video, and on a phone the video is sized by the screen's height (narrower
  // still with captions on, which take a line of their own): every control must still sit inside the bar, the time
  // never runs into a button, and Jump to the reveal stays on one line
  console.log('\n▶ replay controls on a narrow video');
  const barFit = () => page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const seen = (el) => !!el && !el.closest('[hidden]') && r(el).width > 0;
    const bar = r(document.querySelector('[data-s="bar"]'));
    const ctrls = [...document.querySelectorAll('[data-s="replaybar"] > *')].filter(seen);
    const outside = ctrls.filter((el) => r(el).left < bar.left - 0.5 || r(el).right > bar.right + 0.5).map((el) => el.className.split(' ')[0]);
    const seek = r(document.querySelector('.seek'));
    const range = document.querySelector('[data-s="seek"]');
    const rr = r(range); const pad = parseFloat(getComputedStyle(range).paddingBottom) || 0;
    const trackY = rr.top + (rr.height - pad) / 2;
    const mark = document.querySelector('[data-s="mark"]');
    const markOff = seen(mark) ? Math.abs(r(mark).top + r(mark).height / 2 - trackY) : 0;
    // The time's pieces that are actually shown (on its first line) must sit inside the progress line's cell
    const time = document.querySelector('[data-s="time"]');
    const tb = r(time);
    const shown = [...time.children].filter((el) => r(el).width > 0 && r(el).top < tb.bottom - 1);
    const timeOut = shown.some((el) => r(el).left < seek.left - 0.5 || r(el).right > seek.right + 0.5);
    const timeText = shown.map((el) => el.textContent).join(' ');
    const jump = document.querySelector('[data-s="jump"]');
    const label = document.querySelector('[data-s="jump-label"]');
    const jumpOk = !seen(jump) || (r(label).height <= 24 && r(label).top >= r(jump).top && r(label).bottom <= r(jump).bottom && r(label).right <= r(jump).right + 0.5);
    const cc = document.querySelector('[data-s="cc-toggle"]');
    // The star stays on the line, clear of play and captions (its ring included), so it never takes their taps
    const ring = seen(mark) ? { l: r(mark).left - 3, r: r(mark).right + 3 } : null;
    const starIn = !ring || (ring.l >= seek.left - 0.5 && ring.r <= seek.right + 0.5);
    // A tap on the star (and so on a handle under it) is the line's: it seeks, and the handle can be dragged off it
    const mc = seen(mark) ? { x: r(mark).left + r(mark).width / 2, y: r(mark).top + r(mark).height / 2 } : null;
    const starTap = !mc || document.elementFromPoint(mc.x, mc.y) === document.querySelector('.seek');
    const pic = r(document.querySelector('.stage__picture'));
    return { bar: Math.round(bar.width), outside, seek: Math.round(seek.width), markOff: Math.round(markOff * 10) / 10, timeOut, timeText, jumpOk, starIn, starTap, pic: Math.round(pic.width), ccShown: seen(cc), ccOn: cc?.getAttribute('aria-pressed') === 'true' };
  });
  for (const [name, vp] of [['phone-toolbars', { width: 390, height: 664 }], ['small phone', { width: 360, height: 640 }], ['big phone', { width: 430, height: 740 }], ['laptop', { width: 1280, height: 720 }]]) {
    await page.setViewport({ ...vp, ...(vp.width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await open(page);
    await page.waitForFunction(() => !document.querySelector('[data-s="jump"]')?.hidden, { timeout: 15000 }).catch(() => {});
    await sleep(600);
    for (const want of [false, true]) {
      const before = await barFit();
      if (before.ccOn !== want) { await page.click('[data-s="cc-toggle"]'); await sleep(700); }
      const f = await barFit();
      const tag = `${name}, captions ${want ? 'on' : 'off'}: bar ${f.bar}, line ${f.seek}, time "${f.timeText}"`;
      ok(f.ccShown && f.outside.length === 0, `every control inside the bar (${tag}${f.outside.length ? `; outside: ${f.outside.join(', ')}` : ''})`);
      ok(!f.timeOut, `the time stays under the line, clear of the buttons (${tag})`);
      ok(f.seek < 40 || /\d:\d\d/.test(f.timeText), `the time shows whenever there is room for it (${tag})`);
      ok(f.markOff <= 1.5, `the reveal mark sits on the line (${f.markOff}px off; ${tag})`);
      ok(f.starIn, `the reveal mark stays inside the line's ends (${tag})`);
      ok(f.starTap, `a tap on the reveal mark goes to the line (${tag})`);
      // The bar takes the room it needs even when the picture is narrower (the picture keeps its size)
      ok(f.seek >= 100, `a line worth dragging (${tag}; picture ${f.pic})`);
      ok(f.jumpOk, `Jump to the reveal stays on one line inside its button (${tag})`);
      if (name === 'phone-toolbars') await page.screenshot({ path: `${OUT}replay-narrow-cc-${want ? 'on' : 'off'}.png` });
    }
    // Leave captions as a new visitor has them
    if ((await barFit()).ccOn) { await page.click('[data-s="cc-toggle"]'); await sleep(300); }
  }
  // The time played under the line's start, the length under its end: the length arrives in its own place, nothing moves
  const times = await page.evaluate(() => {
    const box = (s) => document.querySelector(`[data-s="${s}"]`)?.getBoundingClientRect();
    const seek = document.querySelector('.seek')?.getBoundingClientRect(), now = box('time-now'), total = box('time-total');
    return { text: document.querySelector('[data-s="time-total"]')?.textContent || '', startGap: now && seek ? Math.round(now.left - seek.left) : null, endGap: total && seek ? Math.round(seek.right - total.right) : null };
  });
  ok(/^\d+:\d\d$/.test(times.text) && times.startGap >= 0 && times.startGap <= 12 && times.endGap >= 0 && times.endGap <= 12, `the time sits under the line's start and the length under its end (${JSON.stringify(times)})`);

  // A phone held sideways: the picture as tall as the screen allows and the controls beside it (under it, they left a
  // picture a few dozen pixels wide); nothing off the screen, nothing sideways
  console.log('\n▶ a phone held sideways');
  for (const [w, h] of [[844, 390], [667, 375]]) {
    await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await open(page);
    await page.waitForFunction(() => !document.querySelector('[data-s="jump"]')?.hidden, { timeout: 15000 }).catch(() => {});
    await sleep(600);
    const sw = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const pic = r('.stage__picture'), bar = r('[data-s="bar"]'), jump = r('[data-s="jump"]');
      return { pic: [Math.round(pic.width), Math.round(pic.height)], picBottom: Math.round(pic.bottom), beside: bar.left >= pic.right, barTop: Math.round(bar.top), lowest: Math.round(Math.max(bar.bottom, jump.bottom, pic.bottom)), vh: innerHeight, sx: document.documentElement.scrollWidth - innerWidth };
    });
    ok(sw.beside && sw.pic[1] >= h * 0.6, `${w}×${h}: the picture is full height (${sw.pic.join('×')}) with the controls beside it`);
    ok(sw.lowest <= sw.vh && sw.sx <= 0, `${w}×${h}: all of it on the screen (lowest ${sw.lowest} of ${sw.vh}), no sideways scroll`);
  }

  // The reveal's star near an end of the line: drawn exactly where the handle is at the reveal, and a tap on it plays
  // from just before the reveal, as Jump does (it was drawn a little in from the end, and a tap there played from there)
  console.log('\n▶ the reveal near the end of a replay');
  feed.revealAt = 7.7;
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await open(page);
  await page.waitForFunction(() => !document.querySelector('[data-s="jump"]')?.hidden && document.querySelector('video')?.duration > 0, { timeout: 15000 }).catch(() => {});
  await sleep(600);
  const star = await page.evaluate(() => {
    const m = document.querySelector('[data-s="mark"]').getBoundingClientRect();
    const range = document.querySelector('[data-s="seek"]');
    const rr = range.getBoundingClientRect(); const pad = parseFloat(getComputedStyle(range).paddingLeft) || 0;
    // The handle (16px) runs along the slider's content box, so its centre at the reveal is here
    const v = document.querySelector('video');
    const at = rr.left + pad + 8 + (rr.width - 2 * pad - 16) * (7.7 / v.duration);
    return { x: m.left + m.width / 2, y: m.top + m.height / 2, off: Math.abs(m.left + m.width / 2 - at) };
  });
  ok(star.off <= 0.75, `the star sits where the handle will be at the reveal (${star.off.toFixed(2)}px off)`);
  await page.touchscreen.tap(star.x, star.y);
  await sleep(700);
  g = await probe(page);
  ok(g.time >= 2.5 && g.time < 4.5, `a tap on the star plays from just before the reveal (${g.time?.toFixed(1)}s)`);
  // On the star's edge, over the slider's 8px end: the slider's own move there comes after the tap and is put back
  await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 0.5; });
  await sleep(300);
  await page.touchscreen.tap(star.x + 11, star.y);
  await sleep(700);
  g = await probe(page);
  ok(g.time >= 2.5 && g.time < 4.5, `a tap on the star's edge, at the line's end, plays from just before the reveal too (${g.time?.toFixed(1)}s)`);
  // After the replay has ended, Jump (and the star) still go to the reveal, not back to 0:00
  await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = v.duration - 0.2; v.play(); });
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.dataset.pstatus === 'ended', { timeout: 8000 }).catch(() => {});
  await page.click('[data-s="jump"]');
  await sleep(700);
  g = await probe(page);
  ok(g.pstatus === 'playing' && g.time >= 2.5 && g.time < 4.5, `after the end, Jump plays from just before the reveal (${g.time?.toFixed(1)}s, ${g.pstatus})`);
  feed.revealAt = 6;

  // A phone held sideways, a wide picture with captions on and the room's design with it: the picture keeps (nearly)
  // its size, whichever way the stage finds room for the captions (it fell to 60%: the design took a column of its own)
  console.log('\n▶ sideways, a wide picture with captions and the design');
  state = { ...STATES.replay, kidSlug: 'axel', orientation: 'landscape' }; feed.shape = 'landscape'; feed.design = DESIGN;
  for (const [w, h] of [[568, 320], [667, 375], [844, 390]]) {
    await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await open(page);
    await page.waitForFunction(() => !document.querySelector('[data-s="jump"]')?.hidden && document.querySelector('.hero')?.hasAttribute('data-design'), { timeout: 15000 }).catch(() => {});
    await sleep(800);
    const look = () => page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e || e.closest('[hidden]') || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width }; };
      const parts = { pic: r('.stage__picture'), cc: r('[data-s="cc"]'), bar: r('[data-s="bar"]'), jump: r('[data-s="jump"]'), strip: r('.hds') };
      const list = Object.entries(parts).filter(([, b]) => b);
      const hit = [];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const [a, A] = list[i]; const [b, B] = list[j]; if (Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0.5 && Math.min(A.b, B.b) - Math.max(A.t, B.t) > 0.5) hit.push(`${a}/${b}`); }
      const lowest = Math.max(...list.map(([, b]) => b.b)) + scrollY;
      return { pic: Math.round(parts.pic.w), hit, lowest: Math.round(lowest), vh: innerHeight, sx: document.documentElement.scrollWidth - innerWidth, cc: !!parts.cc, strip: !!parts.strip };
    });
    const off = await look();
    if (!(await page.evaluate(() => document.querySelector('[data-s="cc-toggle"]').getAttribute('aria-pressed') === 'true'))) { await page.click('[data-s="cc-toggle"]'); await sleep(700); }
    const on = await look();
    ok(on.cc && on.strip && on.pic >= off.pic * (w < 700 ? 0.9 : 0.95), `${w}×${h}: captions on, the picture keeps its size (${on.pic} of ${off.pic} wide)`);
    ok(!on.hit.length && on.lowest <= on.vh && on.sx <= 0, `${w}×${h}: captions, controls and design all on the screen, nothing overlapping (lowest ${on.lowest} of ${on.vh}${on.hit.length ? `; ${on.hit.join(', ')}` : ''})`);
    await page.click('[data-s="cc-toggle"]'); await sleep(300);
  }

  // Full screen held sideways, a wide picture: the controls beside it or under it, whichever leaves it bigger
  console.log('\n▶ full screen, sideways, a wide picture');
  for (const [w, h, cc, beside] of [[844, 390, false, true], [844, 390, true, true], [667, 375, false, false], [667, 375, true, true]]) {
    await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await open(page);
    await page.waitForFunction(() => !document.querySelector('[data-s="jump"]')?.hidden, { timeout: 15000 }).catch(() => {});
    await sleep(600);
    if ((await page.evaluate(() => document.querySelector('[data-s="cc-toggle"]').getAttribute('aria-pressed') === 'true')) !== cc) { await page.click('[data-s="cc-toggle"]'); await sleep(500); }
    await page.click('[data-s="replaybar"] [data-full]');
    await sleep(900);
    const fs = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const pic = r('.stage__picture'), bar = r('[data-s="bar"]'), jump = r('[data-s="jump"]');
      return { full: !!document.fullscreenElement, pic: [Math.round(pic.width), Math.round(pic.height)], beside: bar.left >= pic.right, lowest: Math.round(Math.max(pic.bottom, bar.bottom, jump.bottom)), vh: innerHeight };
    });
    // (stacked under it, the picture was 427×240 at 844×390, and 316×178 with captions)
    const stacked = Math.floor((h - 32 - 118 - (cc ? 59 : 0)) * 16 / 9);
    ok(fs.full && fs.beside === beside && fs.pic[0] >= Math.min(stacked, w - 32) && fs.lowest <= fs.vh, `${w}×${h}${cc ? ', captions' : ''}: the picture ${fs.pic.join('×')}, controls ${fs.beside ? 'beside' : 'under'} it, all on the screen`);
    await page.evaluate(() => document.exitFullscreen());
    await sleep(400);
  }
  feed.design = { open: false };

  // The give form down the right of a phone held sideways, with the notch on the right: the video beside it stays clear
  console.log('\n▶ give, sideways, notch on the right');
  state = { ...STATES.live, orientation: 'landscape' }; feed.shape = 'landscape';
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 47, bottom: 21 } });
  await open(page);
  await waitFor(page, ['playing']); await sleep(800);
  await page.click('[data-live="cta-donate"]');
  await sleep(800);
  g = await probe(page);
  ok(!!g.give && g.docked && g.picture.r + 16 <= g.give.x, `the video stays 16px clear of the form (video to ${g.picture.r}, form from ${g.give?.x})`);
  await page.keyboard.press('Escape');
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: 0 } });

  // Typing a message on a phone whose browser shrinks the page for the keyboard (Android in-app browsers): the page
  // stays upright however short the keyboard leaves it, the corner player steps aside, and when typing ends the page
  // is where it was, with the player back
  console.log('\n▶ typing a message, the keyboard up');
  state = STATES.live; feed.shape = 'portrait';
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await open(page);
  await waitFor(page, ['playing']); await sleep(800);
  await page.click('[data-s="sound"]').catch(() => {});
  // (the box is docked at the foot of the screen: down at the messages, the video is in the corner player)
  await page.$eval('[data-msgs="wall"]', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(900);
  const was = await page.evaluate(() => ({ y: Math.round(scrollY), docked: !!document.querySelector('.is-docked') }));
  const box = await (await page.$('#msg-body')).boundingBox();
  await page.touchscreen.tap(box.x + 20, box.y + 12);
  await page.setViewport({ width: 390, height: 200, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(900);
  const typing = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const pic = r('.stage__picture'), bar = r('[data-s="bar"]'), box = r('[data-msgs="compose"]');
    // Upright: a live upright picture's controls in their rail beside it (else the bar under it), never the sideways layout
    const rail = document.querySelector('[data-stage]').hasAttribute('data-rail');
    return { upright: rail ? bar.left >= pic.right - 0.5 : bar.top >= pic.bottom - 0.5, rail, docked: !!document.querySelector('.is-docked'), sx: document.documentElement.scrollWidth - innerWidth, box: [Math.round(box.top), Math.round(box.bottom)], vh: innerHeight };
  });
  ok(was.docked && typing.upright && typing.sx <= 0, `390×200 with the keyboard up: the page stays upright (${typing.rail ? 'the rail beside the picture' : 'controls under the picture'}), nothing sideways`);
  ok(typing.box[0] >= 0 && typing.box[1] <= typing.vh + 1, `the docked box stays in sight above the keyboard (${typing.box.join('-')} of ${typing.vh})`);
  ok(!typing.docked, 'the corner player steps aside while typing');
  await page.evaluate(() => document.activeElement.blur());
  await sleep(100);
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(900);
  const after = await page.evaluate(() => ({ y: Math.round(scrollY), docked: !!document.querySelector('.is-docked') }));
  ok(Math.abs(after.y - was.y) <= 90 && after.docked, `typing done: the page is where it was (${was.y} → ${after.y}) and the corner player is back`);

  // A tablet held sideways, the keyboard up: still the laptop layout, the message box beside the video and in sight
  await page.setViewport({ width: 1180, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await open(page);
  await waitFor(page, ['playing']); await sleep(800);
  const tbox = await (await page.$('#msg-body')).boundingBox();
  await page.touchscreen.tap(tbox.x + 20, tbox.y + 12);
  await page.setViewport({ width: 1180, height: 430, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(900);
  g = await probe(page);
  const tf = await page.evaluate(() => { const b = document.querySelector('#msg-body').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) }; });
  ok(g.panelBeside && !g.docked && tf.top >= 0 && tf.bottom <= g.vh && tf.w < g.vw * 0.7, `1180×430, a tablet's keyboard up: messages still beside the video, the box in sight (${tf.w} wide at ${tf.top}-${tf.bottom} of ${g.vh})`);
  await page.evaluate(() => document.activeElement.blur());

  // A laptop: the frame follows the window's height even while a text field has focus (no keyboard comes up there)
  await page.setViewport({ width: 1440, height: 900 });
  await open(page);
  await waitFor(page, ['playing']); await sleep(800);
  await page.click('#msg-body');
  const tall = (await probe(page)).picture.h;
  await page.setViewport({ width: 1440, height: 640 });
  await sleep(800);
  g = await probe(page);
  ok(g.picture.h < tall && g.stage.b <= g.vh, `laptop, typing, window made shorter: the video follows it (${tall} → ${g.picture.h} tall, stage to ${g.stage.b} of ${g.vh})`);
  await page.evaluate(() => document.activeElement.blur());

  // Older iPhones (iOS 15, Safari before 16.4) drop a whole rule over a selector they can't read (:fullscreen) and have
  // no container queries: the live page's layouts use neither, so they draw the same there
  console.log('\n▶ older Safari');
  const unreadable = await page.evaluate(() => {
    const out = [];
    const walk = (rules) => { for (const r of rules) { if (r.selectorText && /:fullscreen/.test(r.selectorText)) out.push(r.selectorText.slice(0, 80)); if (r.cssRules && !(r instanceof CSSContainerRule && /\bbar\b/.test(r.conditionText || ''))) { if (r instanceof CSSContainerRule) out.push(`@container ${r.conditionText}`); walk(r.cssRules); } } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* another origin */ } }
    return out.filter((t) => /stage|hds|give|ldv|ldz|hero|live/.test(t));
  });
  ok(unreadable.length === 0, `no layout rule older Safari would drop (${unreadable.slice(0, 3).join(' | ') || 'none'})`);

  // A long caption is shown a page at a time: the line stays two lines tall, so nothing under it moves
  console.log('\n▶ a long caption');
  state = STATES.replay; feed.shape = 'portrait';
  feed.vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:07.900\nOkay everybody, on the count of three, open your eyes and take a look at your brand new room, we have been working on it for weeks and weeks\n';
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await open(page);
  await page.waitForFunction(() => !document.querySelector('[data-s="jump"]')?.hidden, { timeout: 15000 }).catch(() => {});
  await sleep(600);
  if (!(await page.evaluate(() => document.querySelector('[data-s="cc-toggle"]').getAttribute('aria-pressed') === 'true'))) { await page.click('[data-s="cc-toggle"]'); await sleep(700); }
  const capAt = async (t) => {
    await page.evaluate((t) => { const v = document.querySelector('video'); v.pause(); v.currentTime = t; }, t);
    await sleep(500);
    return page.evaluate(() => { const c = document.querySelector('[data-s="cc"]').getBoundingClientRect(); const x = document.querySelector('[data-s="cc-text"]'); const j = document.querySelector('[data-s="jump"]').getBoundingClientRect(); return { h: Math.round(c.height), lines: Math.round(x.getBoundingClientRect().height / parseFloat(getComputedStyle(x).lineHeight)), text: x.textContent, jumpB: Math.round(j.bottom), vh: innerHeight }; });
  };
  const c1 = await capAt(0.5); const c2 = await capAt(7.5);
  ok(c1.lines <= 2 && c2.lines <= 2 && c1.h === c2.h && c1.text !== c2.text && c2.jumpB <= c2.vh, `two lines at a time, the line one height (${c1.h}, ${c2.h}), Jump on the screen (${c2.jumpB} of ${c2.vh}): "${c1.text.slice(0, 30)}…" then "…${c2.text.slice(-30)}"`);
  // Paused on it, the phone turned: the caption is split again for its new width at once, never cut at a third line
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(900);
  const turned = await page.evaluate(() => { const x = document.querySelector('[data-s="cc-text"]'); return { lines: Math.round(x.getBoundingClientRect().height / parseFloat(getComputedStyle(x).lineHeight)), paused: document.querySelector('video').paused }; });
  ok(turned.paused && turned.lines <= 2, `paused, then turned sideways: still at most two lines (${turned.lines})`);
  feed.vtt = null;
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(300);
  await page.click('[data-s="cc-toggle"]'); await sleep(300);

  // Stream sends the sound as its own track. The light build of hls.js can't play one, so on every computer and iPad
  // the reveal played in silence (Nov 17 2026 test broadcast); Safari's own player on iPhone had sound
  console.log('\n▶ sound as its own track, as Cloudflare Stream sends it — desktop');
  state = STATES.live; feed.shape = 'portrait'; feed.split = true;
  await page.setViewport({ width: 1424, height: 830 });
  await open(page);
  await waitFor(page, ['playing']);
  await page.click('[data-s="sound"]');
  await sleep(3000);
  g = await page.evaluate(() => {
    const v = document.querySelector('.stage__player video');
    return { muted: v?.muted, pstatus: document.querySelector('[data-stage]')?.dataset.pstatus, audio: v?.webkitAudioDecodedByteCount ?? -1, picture: v?.webkitVideoDecodedByteCount ?? -1 };
  });
  ok(g.pstatus === 'playing' && g.picture > 0, `the picture plays (${g.pstatus}, ${g.picture} bytes of picture decoded)`);
  ok(g.muted === false && g.audio > 0, `after Tap for sound, the sound plays on a computer (${g.audio} bytes of sound decoded)`);
  feed.split = false;

  // Peter, Nov 17 2026: "it seemed to start the video, then it went away and showed the before and plans". Someone
  // further down the page when the reveal started stayed there, with the reveal only in the corner player. Going live
  // now brings the page up to the video; someone typing is left where they are (the corner player shows it)
  console.log('\n▶ the reveal starting with the page open further down');
  const soon = () => ({ ...base, phase: 'scheduled', upcoming: true, scheduledAt: new Date(Date.now() + 26 * 3600e3).toISOString(), liveAt: null, player: null });
  const goLive = async () => { state = STATES.live; await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await waitFor(page, ['playing']); await sleep(1500); };
  for (const [name, vp] of [['phone', { width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['desktop', { width: 1424, height: 830 }]]) {
    state = soon(); feed.shape = 'portrait';
    await page.setViewport(vp);
    await open(page);
    await sleep(2500);
    await page.evaluate(() => document.querySelector('#past-reveals')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await sleep(400);
    const down = await page.evaluate(() => Math.round(scrollY));
    await goLive();
    g = await probe(page);
    const y = await page.evaluate(() => Math.round(scrollY));
    ok(down > 300 && y === 0 && g.stage.y >= 0 && g.stage.b <= g.vh && !g.docked && g.pstatus === 'playing',
      `${name}: the reveal starting brings the page up to the video (scrolled ${down} → ${y}, stage ${g.stage.y}-${g.stage.b} of ${g.vh}, docked ${g.docked})`);
  }
  state = soon();
  await page.setViewport({ width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await open(page);
  await sleep(2500);
  const field = await page.evaluate(() => {
    const f = [...document.querySelectorAll('input[type="email"], textarea')].find((el) => el.getBoundingClientRect().height > 0 && !el.closest('[hidden]'));
    if (!f) return null;
    f.scrollIntoView({ block: 'center', behavior: 'instant' });
    f.focus();
    return f.id || f.name || f.tagName;
  });
  await sleep(400);
  const typedAt = await page.evaluate(() => Math.round(scrollY));
  await goLive();
  const stayed = await page.evaluate(() => ({ y: Math.round(scrollY), focused: document.activeElement?.matches('input[type="email"], textarea') || false }));
  ok(!!field && typedAt > 300 && stayed.y > 300 && stayed.focused, `someone typing (${field}) is left where they are when it starts (scrolled ${typedAt} → ${stayed.y}, still in the field: ${stayed.focused})`);
  await page.evaluate(() => document.activeElement?.blur());

  // Peter, Nov 17 2026: "the vendors need the same scroll bar" (the starting-soon screen's band, now that screen is
  // gone). A child's own page carries their partners from its build (LivePartners.astro)
  console.log('\n▶ the build’s partners under the video');
  const KID = process.env.PARTNERS_KID || 'dylan-2026';
  for (const [name, vp] of [['phone', { width: 390, height: 664, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['desktop', { width: 1424, height: 830 }], ['sideways', { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    state = { ...STATES.live, kidSlug: KID, kidName: 'Dylan' }; feed.shape = 'portrait';
    await page.setViewport(vp);
    await page.goto(`${BASE}/live/${KID}/?visit=${++visits}`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, ['playing']);
    await sleep(1500);
    const band = await page.evaluate(async () => {
      const el = document.querySelector('[data-live-partners]');
      const row = el?.querySelector('.lpb-row');
      const box = (n) => { const r = n?.getBoundingClientRect(); return r ? { y: Math.round(r.top), b: Math.round(r.bottom), x: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height) } : null; };
      const t1 = row ? getComputedStyle(row).transform : '';
      await new Promise((res) => setTimeout(res, 600));
      return {
        chips: el?.querySelectorAll('.lpb-chip').length || 0, shown: !!el && !el.hidden && el.getBoundingClientRect().height > 0,
        moving: !!row && getComputedStyle(row).transform !== t1, read: el?.querySelectorAll('img[alt]:not([alt=""])').length || 0,
        band: box(el), bar: box(document.querySelector('[data-s="bar"]')), pic: box(document.querySelector('.stage__picture')), stage: box(document.querySelector('[data-stage]')), vh: innerHeight,
      };
    });
    if (!band.chips) { ok(true, `${KID} has no partners in this build: skipped`); break; }
    if (name === 'sideways') { ok(!band.shown, 'a phone held sideways: no partners under the picture, which keeps the screen’s height'); continue; }
    ok(band.shown && band.moving, `${name}: the partners scroll under the video (${band.chips} logos in the row, ${band.read} read out)`);
    ok(band.band.y >= band.bar.b && band.band.y >= band.pic.b && band.band.b <= band.vh, `${name}: under the bar, on screen with the video, never on it (band ${band.band.y}-${band.band.b}, bar to ${band.bar.b}, screen ${band.vh})`);
    ok(band.band.x >= band.stage.x - 1 && band.band.r <= band.stage.r + 1, `${name}: as wide as the video and what's beside it`);
  }
  await page.setViewport({ width: 1424, height: 830 });

  console.log('\n▶ leave the page and come back');
  state = STATES.live; feed.shape = 'portrait';
  await page.setViewport({ width: 1280, height: 800 });
  await open(page);
  await waitFor(page, ['playing']);
  await page.evaluate(() => [...document.querySelectorAll('a[href="/donate/"]')][0]?.click());
  await page.waitForFunction(() => location.pathname === '/donate/', { timeout: 10000 }).catch(() => {});
  ok(await page.evaluate(() => document.querySelectorAll('video').length === 0), 'the video stops when you leave');
  await page.goBack();
  await waitFor(page, ['playing']);
  g = await probe(page);
  ok(g.pstatus === 'playing' && g.party, 'Back brings the live page back, playing');

  console.log('\n▶ Facebook-only broadcast');
  state = STATES.facebook;
  await open(page);
  await sleep(1500);
  g = await probe(page);
  const fb = await page.$eval('[data-live="cta-facebook"]', (a) => !a.hidden);
  ok(!g.party && fb, 'photo hero with Watch on Facebook');
} finally {
  await browser.close();
}

ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
