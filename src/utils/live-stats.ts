/**
 * live-stats.ts — what the live page tells Reveal stats (Admin → Broadcast → History)
 * ===================================================================================
 *  viewerId()   a random id this browser keeps (localStorage), so a person
 *               counts once per reveal however often they reload. Nothing
 *               personal; with storage blocked it lasts for the page only.
 *  who()        'staff' once this browser has opened the admin (it sets
 *               soard-staff), 'test' for an automated browser, else ''.
 *  arrival()    where this visit came from: the link's ?src= (or utm_source)
 *               and the referring site's host, kept for the tab's session so
 *               the page someone landed on decides, not the last click. A new
 *               arrival from another site (a full page load) takes over.
 *  humanSign()  whether this page has seen a person there: a tap, scroll, key
 *               or mouse movement, or 10 s of its own picture moving (the watch
 *               meter says so). Email security software opens every link in an
 *               email in a real browser, so a visit counts in History only
 *               once this is so; every beacon carries it (h: 1), and the live
 *               client tells the server the moment it first happens.
 *  shareable()  a link without ?src= or utm_*, for the page's Share button, so
 *               a friend's visit isn't credited to the sharer's email or QR.
 *               (The address bar keeps them: changing it confuses Astro's
 *               router, which then reloads the page on an in-page # link.)
 *  watchMeter() counts seconds the video actually plays with the tab showing
 *               and reports them: after the first 10 s, then every 20 s live
 *               (60 s on the replay), and what's left when it stops. Live, it
 *               sends the player's numbers too, and keeps them as they were the
 *               last moment the picture moved once the phone has stopped (a
 *               page left open on the end isn't a viewer frozen).
 */

const VID_KEY = 'soard-viewer';
export const STAFF_KEY = 'soard-staff';
const ARRIVAL_KEY = 'soard-arrival';

let memoryVid = '';
const randomId = () => {
  try { return crypto.randomUUID().replace(/-/g, ''); } catch { /* old browser */ }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

export function viewerId(): string {
  try {
    const have = localStorage.getItem(VID_KEY);
    if (have && /^[A-Za-z0-9]{8,40}$/.test(have)) return have;
    const id = randomId();
    localStorage.setItem(VID_KEY, id);
    return id;
  } catch {
    return (memoryVid ||= randomId());
  }
}

export function who(): '' | 'staff' | 'test' {
  try { if (navigator.webdriver) return 'test'; } catch { /* no navigator */ }
  try { if (localStorage.getItem(STAFF_KEY) === '1') return 'staff'; } catch { /* storage off */ }
  return '';
}

interface Arrival { src: string; ref: string }

function readHere(): Arrival {
  let src = '';
  let ref = '';
  try {
    const q = new URLSearchParams(location.search);
    src = (q.get('src') || q.get('utm_source') || '').slice(0, 24);
  } catch { /* no location */ }
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    if (r && r.host !== location.host) ref = r.hostname.slice(0, 100);
    else if (r) ref = location.hostname; // from this site (a banner, the menu)
  } catch { /* odd referrer */ }
  return { src, ref };
}

/** A page load that came from somewhere: its own ?src=, or a link on another site */
const fromOutside = (a: Arrival) => !!a.src || (!!a.ref && a.ref !== location.hostname);

/**
 * Where this visit came from: this page load's own source when it has one
 * (a link with ?src=, or another site), else how the tab's session began.
 */
export function arrival(): Arrival {
  const here = readHere();
  if (fromOutside(here)) return here;
  try {
    const kept = sessionStorage.getItem(ARRIVAL_KEY);
    if (kept) { const a = JSON.parse(kept); if (a && typeof a === 'object') return { src: String(a.src || ''), ref: String(a.ref || '') }; }
  } catch { /* storage off */ }
  return here;
}

/**
 * Remember how this tab arrived (the live client calls it once per page load).
 * The first page of the session is kept, unless a later page load came from
 * outside: someone who opened the site directly and later came back through a
 * Facebook post arrived from Facebook that time.
 */
export function noteArrival(): void {
  try {
    const here = readHere();
    const kept = sessionStorage.getItem(ARRIVAL_KEY);
    if (kept && !fromOutside(here)) return;
    // From this site with nothing kept: the session began before this script ran (an older tab); say nothing
    if (!kept && here.ref && here.ref === location.hostname && !here.src) return;
    sessionStorage.setItem(ARRIVAL_KEY, JSON.stringify(here));
  } catch { /* storage off */ }
}

/** The same address without ?src= or utm_* (what the Share button hands on) */
export function shareable(href: string): string {
  try {
    const url = new URL(href);
    // (and a staff rehearsal's mark, live-client.ts rehearsal: a shared rehearsal link would send people to sign in)
    for (const k of [...url.searchParams.keys()]) if (k === 'src' || k === 'rehearsal' || k.startsWith('utm_')) url.searchParams.delete(k);
    return url.toString();
  } catch { return href; }
}

// ─── A person there ─────────────────────────────────────────────────
// Email security software (Microsoft's, Proofpoint's, a school's) opens every link in an email in a real browser the
// moment it arrives, runs the page's scripts and leaves; on Max's reveal (Nov 20 2026) 78 of the 80 visits in the
// minute after the "We're live" email were that. None touched the page or played anything. So a visit counts once
// the page sees a person: a tap, a scroll (wheel), a key, the mouse moving, a click into Stream's own player (the
// page sees only its focus go there), or the watch meter's 10 s of the page's own picture moving.

/** Seconds of the page's own picture moving (not Stream's iframe, which shows itself) that count as a person watching */
export const HUMAN_PLAY_SEC = 10;
/** The mouse moved this far in all (CSS px): someone moving it, not one step a script made */
const HUMAN_MOUSE_PX = 40;

let humanSeen = false;
const humanWaiting = new Set<() => void>();

/** Whether this page has seen a person there */
export function humanSign(): boolean { return humanSeen; }

/** Call `fn` once a person is seen (at once, when one has been) */
export function onHuman(fn: () => void): void {
  if (humanSeen) { try { fn(); } catch { /* listener bug */ } return; }
  humanWaiting.add(fn);
}

/** A person is there (the first time: everyone waiting hears it) */
export function markHuman(): void {
  if (humanSeen) return;
  humanSeen = true;
  stopListening();
  for (const fn of humanWaiting) { try { fn(); } catch { /* listener bug */ } }
  humanWaiting.clear();
}

let mouseMoved = 0;
const onInput = (e: Event) => { if (e.isTrusted) markHuman(); };
const onMouse = (e: Event) => {
  const m = e as PointerEvent;
  if (!m.isTrusted || m.pointerType !== 'mouse') return;
  mouseMoved += Math.abs(m.movementX || 0) + Math.abs(m.movementY || 0);
  if (mouseMoved >= HUMAN_MOUSE_PX) markHuman();
};
// A click into Stream's own player (a cross-origin iframe): the page sees only the window lose focus to it (some
// browsers move the focus only after the blur, so it's looked at again a moment later)
const focusInFrame = () => { try { if (document.activeElement?.tagName === 'IFRAME') markHuman(); } catch { /* no document */ } };
const onBlur = () => { focusInFrame(); setTimeout(focusInFrame, 0); };
const INPUTS = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const;
let listening = false;
function stopListening() {
  if (!listening) return;
  listening = false;
  try {
    for (const t of INPUTS) window.removeEventListener(t, onInput, true);
    window.removeEventListener('pointermove', onMouse, true);
    window.removeEventListener('blur', onBlur);
  } catch { /* no window */ }
}
(function listen() {
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    for (const t of INPUTS) window.addEventListener(t, onInput, { capture: true, passive: true });
    window.addEventListener('pointermove', onMouse, { capture: true, passive: true });
    window.addEventListener('blur', onBlur);
    listening = true;
  } catch { /* no window */ }
})();

/** What every beacon carries about its sender */
export function sender(): { vid: string; who?: string; src?: string; ref?: string; h?: 1 } {
  const a = arrival();
  const w = who();
  return { vid: viewerId(), ...(w ? { who: w } : {}), ...(a.src ? { src: a.src } : {}), ...(a.ref ? { ref: a.ref } : {}), ...(humanSeen ? { h: 1 as const } : {}) };
}

export const FIRST_REPORT_SEC = 10;
export const LIVE_EVERY_SEC = 20;
export const REPLAY_EVERY_SEC = 60;
/** Live: the player's numbers go once by now even with nothing watched (a viewer who never got a picture counts too) */
export const PLAYER_FIRST_SEC = 20;

/** What the live player says it has done (live-player.ts PlayerHealth) */
export interface PlayerNumbers {
  engine: string | null; firstMs: number | null; waitedMs: number | null; startBehind: number | null;
  holds: number; heldMs: number; refused: number; restarts: number; fallbacks: number; errors: number;
}
/** The kind of device, in four words (nothing that names a person or a model) */
export function deviceKind(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent, touch = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0): 'iphone' | 'ipad' | 'android' | 'computer' {
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'ipad';
  if (/Android/.test(ua)) return 'android';
  return 'computer';
}
/** The player's numbers as a report carries them (functions/api/_reveal-stats.js cleanPlayer reads them) */
export function playerReport(h: PlayerNumbers | null, mount: string): Record<string, unknown> | null {
  if (!h) return null;
  return {
    m: mount, e: h.engine, d: deviceKind(),
    ...(h.firstMs != null ? { f: Math.round(h.firstMs) } : {}),
    ...(h.waitedMs != null ? { w: Math.min(Math.round(h.waitedMs), 60_000) } : {}),
    ...(h.startBehind != null ? { s: h.startBehind } : {}),
    h: h.holds, hm: Math.round(h.heldMs), r: h.refused, x: h.restarts, b: h.fallbacks, er: h.errors,
  };
}

export interface WatchMeterOptions {
  kind: 'live' | 'replay';
  /** The playing <video>, or null while there isn't one */
  video: () => HTMLVideoElement | null;
  /** True while Stream's own iframe plays instead (no <video> to look at): showing counts as watching */
  iframe?: () => boolean;
  /** Send `sec` seconds of watching (0: only the player's numbers); `final` when the page is going away (use a beacon) */
  report: (kind: 'live' | 'replay', sec: number, final: boolean, player: Record<string, unknown> | null) => void;
  /** Live: the player's numbers so far, sent with every report (live-player.ts health) */
  player?: () => PlayerNumbers | null;
  /**
   * Live: the phone has stopped for this broadcast (it's ending, over, or the site has moved on). From then the
   * player's numbers are sent as they were the last moment the picture moved: the picture running out at the end, a
   * page left open on Reconnecting for hours, and the start-over when Stream closes the recording aren't a viewer's
   * video freezing. Viewers are about 20 s behind, so the end's last seconds still count while they play; a picture
   * already frozen when the phone stopped keeps what it had then. The phone coming back on lets them count again.
   */
  phoneStopped?: () => boolean;
  /** For tests: the clock and the timer */
  now?: () => number;
  every?: number;
}

/**
 * Counts seconds of real watching and reports them. Watching means the video
 * is playing (not paused, ended or stuck loading) and the tab is showing.
 * A gap longer than 5 s between ticks (a sleeping laptop, a frozen
 * background tab) isn't counted. Returns stop(), which reports what's left.
 */
export function watchMeter(opts: WatchMeterOptions): { stop: () => void; flush: () => void } {
  const now = opts.now || (() => performance.now());
  let last = now();
  // Where the picture's clock was at the last tick (from the start, so the first second counts too)
  let lastTime = (() => { try { const v = opts.video(); return v ? v.currentTime : -1; } catch { return -1; } })();
  let acc = 0;
  let sent = false;
  let stopped = false;
  // The player's numbers: this start of the player's own id, and what was sent last (sent again only when they change)
  const mount = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  const started = now();
  let lastPlayer = '';
  let lastSentAt = started;
  const current = (): Record<string, unknown> | null => { try { return playerReport(opts.player?.() ?? null, mount); } catch { return null; } };
  // Once the phone has stopped (phoneStopped): the numbers kept, those of the last tick the picture moved, and the
  // ones sent (frozen) when it no longer does. sawLive: this meter ran while the phone was on (a page opened after the
  // phone stopped has nothing from before to keep); liveSnap: the numbers at its last tick then
  let stopSeen = false;
  let sawLive = false;
  let liveSnap: Record<string, unknown> | null = null;
  let movingSnap: Record<string, unknown> | null = null;
  let frozen: Record<string, unknown> | null = null;
  // A page opened after the phone stopped: Reconnecting, start-overs and errors stay as they were when it opened (with no
  // phone seen, they're the phone being gone) while its first picture, delay and wait still come in
  let pinned: Record<string, unknown> | null = null;
  const pin = (n: Record<string, unknown> | null) => (n && pinned ? { ...n, h: pinned.h, hm: pinned.hm, x: pinned.x, er: pinned.er } : n);
  const snapshot = (): Record<string, unknown> | null => frozen ?? pin(current());
  // The page's own picture moving, in seconds (a person watching, once HUMAN_PLAY_SEC)
  let ownPlayed = 0;
  const send = (sec: number, final: boolean) => {
    lastSentAt = now();
    const pl = snapshot();
    if (pl) lastPlayer = JSON.stringify(pl);
    opts.report(opts.kind, sec, final, pl);
  };
  // Only the player's numbers (nothing watched to report): the first time by PLAYER_FIRST_SEC, then when they've changed
  const sendPlayer = (final: boolean) => {
    const pl = snapshot();
    if (!pl) return;
    const key = JSON.stringify(pl);
    if (key === lastPlayer) return;
    lastPlayer = key;
    opts.report(opts.kind, 0, final, pl);
  };
  let still = 0; // seconds the picture hasn't moved
  const due = () => (sent ? (opts.kind === 'live' ? LIVE_EVERY_SEC : REPLAY_EVERY_SEC) : FIRST_REPORT_SEC);
  const showing = () => { try { return document.visibilityState === 'visible'; } catch { return true; } };
  // Watching is the picture moving: playing, not ended, the tab showing, and how far its clock advanced since the last
  // tick (a stall or a stutter counts only the picture that played, in hls.js and in Safari's own player alike)
  const playing = () => {
    if (opts.iframe?.()) return showing() ? Infinity : 0;
    const v = opts.video();
    if (!v) { lastTime = -1; return 0; }
    const t = v.currentTime;
    const moved = lastTime >= 0 ? t - lastTime : 0;
    lastTime = t;
    return !v.paused && !v.ended && showing() ? Math.max(0, moved) : 0;
  };
  const tick = () => {
    if (stopped) return;
    const t = now();
    const dt = (t - last) / 1000;
    last = t;
    const played = playing(); // every tick, so the picture's clock is always tracked (a long gap included)
    if (dt > 0 && dt <= 5 && played > 0) acc += Math.min(dt, played); // the picture's own time, never more than passed
    // (the page's own picture, not Stream's iframe, which counts as showing whether anyone is there or not)
    if (dt > 0 && dt <= 5 && played > 0 && played !== Infinity) { ownPlayed += Math.min(dt, played); if (ownPlayed >= HUMAN_PLAY_SEC) markHuman(); }
    still = played > 0 ? 0 : still + Math.max(0, dt);
    if (opts.phoneStopped) {
      let stopped = false;
      try { stopped = opts.phoneStopped(); } catch { /* as if not */ }
      // (a tick after a long gap, a device asleep, says nothing about the picture moving: what it shows may be the
      // player's own doing on waking)
      const fresh = dt > 0 && dt <= 5;
      const moved = fresh && played > 0;
      if (!stopped) { sawLive = true; stopSeen = false; frozen = null; movingSnap = null; pinned = null; if (fresh || !liveSnap) liveSnap = current(); }
      else if (!frozen) {
        if (!sawLive && !stopSeen) pinned = current();
        // Still playing (the delay's last seconds): kept each tick while it moves, and sent as they were once it doesn't.
        // Frozen already when the phone stopped: what it had then (before a long gap, as it was before it). Opened after
        // the phone stopped: as they are until its picture has moved and stopped
        if (moved) movingSnap = pin(current());
        else if (movingSnap) frozen = movingSnap;
        else if (!stopSeen && sawLive) frozen = fresh ? current() : (liveSnap ?? current());
        stopSeen = true;
      }
    }
    // A report marks the minutes just before it arrives: when the picture stops (paused, frozen) for 3 s, the
    // seconds watched go now, so "there for the reveal" counts the minutes they were really watched in
    const stalled = still >= 3 && acc >= 1;
    // Whole seconds go; the fraction stays for the next report, so rounding never adds up to time that didn't play
    if ((acc >= due() || stalled) && Math.round(acc) >= 1) { const n = Math.round(acc); send(n, false); acc -= n; sent = true; return; }
    // Live with nothing watched to report: the player's numbers by PLAYER_FIRST_SEC (no picture yet, or a long hold), and
    // after that, changed ones every LIVE_EVERY_SEC
    if (opts.player && (t - started) / 1000 >= (lastPlayer ? LIVE_EVERY_SEC : PLAYER_FIRST_SEC) && (t - lastSentAt) / 1000 >= LIVE_EVERY_SEC) { lastSentAt = t; sendPlayer(false); }
  };
  // What's left goes when the tab hides or the page goes away (a hidden tab isn't watching anyway)
  const flush = () => {
    tick();
    if (Math.round(acc) >= 1) { send(Math.round(acc), true); acc = 0; sent = true; } else sendPlayer(true);
  };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  const timer = setInterval(tick, opts.every ?? 1000);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  return {
    flush,
    stop() {
      if (stopped) return;
      flush();
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    },
  };
}
