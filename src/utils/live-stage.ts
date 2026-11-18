/**
 * live-stage.ts — behaviour for LiveStage.astro (the live page's frame)
 * =====================================================================
 * The page tells the stage what should be on it (update()); the stage owns
 * everything after that: mounting the video, its controls (live and upright: a rail beside the picture with sound,
 * full screen and a heart whose hearts float up beside it; otherwise one bar under it: LIVE, viewers, sound, a heart,
 * full screen, or replay controls with the reveal marked), captions under the picture,
 * the corner mini player and keyboard shortcuts.
 *
 * Nothing is ever drawn on a playing picture, and the controls are kept to
 * what a first-time viewer understands at a glance.
 */
import type { LiveClient, LivePlayer } from './live-client';
import { mountPlayer, type PlayerHandle, type PlayerStatus } from './live-player';
import { watchMeter } from './live-stats';
import { PHONE, SIDE, typingIn } from './live-media';

export type StageMode = 'loading' | 'idle' | 'upcoming' | 'live' | 'replay';
export interface StageView {
  mode: StageMode;
  /** The live or replay video (live and replay modes only) */
  player: LivePlayer | null;
  /** The broadcast's setting; the picture's real shape wins once known */
  orientation: 'portrait' | 'landscape';
  /** Badge on the photo before the watch party ('' hides it) */
  badge: string;
}
export interface Stage {
  update(view: StageView): void;
  readonly party: boolean;
  /**
   * Hold the video in a small player at the top of the screen while something covers the page on a phone:
   * 'give', the give sheet (top right, over the page above the sheet); 'design', the design viewer (its top left corner)
   */
  pin(on: boolean, where?: 'give' | 'design'): void;
  /** Stop everything: the page is being swapped out by a client-side navigation */
  destroy(): void;
}
interface Options {
  client: LiveClient;
  /** The page lays itself out around the stage's shape */
  onShape?: (orientation: 'portrait' | 'landscape', party: boolean) => void;
  /**
   * On air, and how many are watching (null below VIEWERS_MIN): what the bar says, for the page to say instead when
   * the controls are in the rail (it has no room for them). null for onAir: not live
   */
  onAir?: (onAir: boolean | null, watching: number | null) => void;
}

/** Below this the count reads as lonely rather than lively, so it stays hidden. */
const VIEWERS_MIN = 5;
/** Share of the video still on screen below which it docks into the corner */
const DOCK_AT = 0.35;
/** Start this far before the reveal moment, so the countdown is in the shot */
const JUMP_LEAD = 5;
const REPLAY_META_MS = 2 * 60 * 1000;
const REPLAY_META_FOR_MS = 45 * 60 * 1000;
const CC_KEY = 'soard-live-cc';

const NOTES: Record<string, Partial<Record<PlayerStatus, [string, string]>>> = {
  live: {
    connecting: ['Loading the video', ''],
    waiting: ['The camera is getting ready', 'Stay right here. The reveal starts playing by itself.'],
    reconnecting: ['Reconnecting', 'The signal dropped for a moment. Stay right here, it comes back by itself.'],
  },
  replay: {
    waiting: ['Getting the replay ready', 'It will start here in a moment.'],
    reconnecting: ['Reconnecting', ''],
  },
};
const STATUS: Partial<Record<PlayerStatus, string>> = {
  connecting: 'Connecting', waiting: 'Waiting for the camera', reconnecting: 'Reconnecting',
};

export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

interface Cue { start: number; end: number; text: string }
export function parseVtt(vtt: string): Cue[] {
  const toSec = (t: string) => { const p = t.trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const cues: Cue[] = [];
  for (const block of String(vtt || '').replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    const start = toSec(a), end = toSec(z.trim().split(/\s+/)[0]);
    if (text && Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text });
  }
  return cues;
}

export function createStage(root: HTMLElement, opts: Options): Stage {
  const $ = <T extends HTMLElement = HTMLElement>(k: string) => root.querySelector(`[data-s="${k}"]`) as T | null;
  const { client } = opts;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sideways = matchMedia(SIDE);
  const picture = $('picture');
  const screen = root.querySelector<HTMLElement>('.stage__screen');
  const playerEl = $('player');
  const seek = $<HTMLInputElement>('seek');

  let view: StageView = { mode: 'loading', player: null, orientation: 'portrait', badge: '' };
  let party = false;
  let mounted = '';
  let player: PlayerHandle | null = null;
  let kind = '';
  let pstatus: PlayerStatus | '' = '';
  let muted = true;
  let sized: 'portrait' | 'landscape' | '' = '';
  let viewers = 0;
  let watching = false;
  let slowConnect = false;
  let connectingTimer: ReturnType<typeof setTimeout> | undefined;
  let soundBeacon = false;
  let replayBeacon = false;
  // Replay extras
  let revealAt: number | null = null;
  let hasCaptions = false;
  let cues: Cue[] | null = null;
  let ccOn = (() => { try { return localStorage.getItem(CC_KEY) === '1'; } catch { return false; } })();
  let metaTimer: ReturnType<typeof setTimeout> | undefined;
  let metaSince = 0;
  let detach: (() => void) | null = null;
  let lastSaid = '';
  let meter: { stop: () => void } | null = null;

  const setHidden = (el: Element | null, hidden: boolean) => { if (el) (el as HTMLElement).hidden = hidden; };
  const flag = (name: string, on: boolean) => { if (on) root.setAttribute(name, ''); else root.removeAttribute(name); };
  const video = () => (player?.video ?? null);
  const shape = () => sized || view.orientation;
  // The shape the page was last told: it hears again whenever the shape changes, not only when the party starts (the
  // picture's real shape can differ from the broadcast's setting, and the page lays out around it)
  let told = '';

  // ── What goes in the frame ──────────────────────────────────────
  function update(next: StageView) {
    view = next;
    const wasParty = party;
    party = !!next.player && (next.mode === 'live' || next.mode === 'replay');
    root.dataset.mode = next.mode;
    flag('data-party', party);
    root.dataset.orientation = shape();

    // The broadcast is part of the key: the live input is the same for every reveal, and each reveal's watching is its own
    const key = party && next.player ? `${next.player.kind}:${next.player.uid}:${client.state?.id || ''}` : '';
    if (key !== mounted && playerEl) {
      mounted = key;
      unmount();
      if (key && next.player) {
        kind = next.player.kind;
        root.dataset.pkind = kind;
        playerEl.hidden = false;
        player = mountPlayer(playerEl, { player: next.player, onStatus, onSize, onMuted });
        // Live starts muted, a replay doesn't; after that, volume events keep this current
        muted = player.video?.muted ?? true;
        attachMedia();
        if (kind === 'replay') { metaSince = Date.now(); loadReplayMeta(); }
        // Reveal stats: seconds actually watched, for the broadcast this player belongs to
        const bid = client.state?.id || null;
        const watchKind = kind === 'live' ? 'live' : 'replay';
        meter = watchMeter({
          kind: watchKind,
          video: () => video(),
          // Stream's own iframe (no <video> to look at): showing counts only live, where it plays by itself
          iframe: () => watchKind === 'live' && pstatus === 'iframe',
          report: (k, sec) => client.watched(k, sec, bid),
        });
      } else {
        playerEl.hidden = true;
      }
    }
    if (party && next.mode === 'live' && !watching) { watching = true; client.watch(); }
    if (party !== wasParty || !wasParty || shape() !== told) { told = shape(); opts.onShape?.(told as 'portrait' | 'landscape', party); }
    paint();
    updateDock();
  }

  function unmount() {
    meter?.stop(); meter = null;
    detach?.(); detach = null;
    player?.destroy();
    player = null;
    kind = '';
    pstatus = '';
    sized = '';
    revealAt = null; hasCaptions = false; cues = null;
    clearTimeout(metaTimer);
    clearTimeout(connectingTimer);
    slowConnect = false;
    delete root.dataset.pstatus;
    delete root.dataset.pkind;
    root.style.removeProperty('--ar');
    flag('data-playing', false);
    if (playerEl) playerEl.innerHTML = '';
    setDock(false);
  }

  // ── Player callbacks ────────────────────────────────────────────
  function onStatus(st: PlayerStatus) {
    pstatus = st;
    root.dataset.pstatus = st;
    clearTimeout(connectingTimer);
    slowConnect = false;
    // Only say "loading" when it is actually slow
    // (after a moment: a blank frame with no words reads as broken; the note fades in, LiveStage.astro)
    if (st === 'connecting') connectingTimer = setTimeout(() => { slowConnect = true; paint(); }, 800);
    if (st === 'playing' && kind === 'replay' && !replayBeacon) { replayBeacon = true; client.beacon('click_replay'); }
    if (st === 'iframe') attachMedia();
    paint();
    updateDock();
  }
  function onSize(w: number, h: number) {
    sized = h > w ? 'portrait' : 'landscape';
    root.dataset.orientation = sized;
    root.style.setProperty('--ar', String(Math.min(2.4, Math.max(0.42, w / h))));
    told = sized;
    opts.onShape?.(sized, party);
    paint();
  }
  function onMuted(m: boolean) { muted = m; paint(); }

  /** Replay clock: play state, seek bar, time, captions line */
  function attachMedia() {
    detach?.(); detach = null;
    const v = video();
    if (!v) return;
    const tick = () => {
      const d = v.duration;
      const t = v.currentTime;
      if (seek && Number.isFinite(d) && d > 0) {
        if (document.activeElement !== seek || !seeking) seek.value = String(Math.round((t / d) * 1000));
        // How far it's played (0 to 1), on the line's cell (the line you see is drawn there, under the slider)
        seek.parentElement?.style.setProperty('--f', String(Math.min(1, Math.max(0, t / d))));
        seek.setAttribute('aria-valuetext', `${formatTime(t)} of ${formatTime(d)}`);
      }
      // The time and the length are two pieces, so the length can step aside when the bar is narrow
      const now = $('time-now'); const total = $('time-total');
      if (now) now.textContent = formatTime(t);
      if (total) total.textContent = Number.isFinite(d) && d > 0 ? formatTime(d) : '';
      paintCaption(t);
      paintJump(t);
    };
    const playing = () => { flag('data-playing', !v.paused && !v.ended); const b = $('play'); if (b) b.setAttribute('aria-label', v.paused || v.ended ? 'Play' : 'Pause'); };
    const evs: [string, () => void][] = [['timeupdate', tick], ['durationchange', () => { tick(); paintMark(); }], ['seeked', tick], ['play', playing], ['pause', playing], ['ended', playing]];
    for (const [e, fn] of evs) v.addEventListener(e, fn);
    detach = () => { for (const [e, fn] of evs) v.removeEventListener(e, fn); };
    tick(); playing();
  }

  // ── Painting ────────────────────────────────────────────────────
  // The controls come and go as the picture starts and the sound goes on (Tap for sound, then Sound; the heart once
  // it's on air). In the rail, the ones that stay glide to their new places instead of jumping there, and one that
  // comes grows in (LiveStage.astro). Measured only when one of them is about to come or go
  function railChange(shows: Map<HTMLElement | null, boolean>) {
    const railEnd = root.querySelector<HTMLElement>('[data-s="livebar"] .bar__end');
    const changing = [...shows].some(([el, show]) => el && el.hidden === show);
    const glide = changing && !reduced && !!railEnd && root.hasAttribute('data-rail');
    const items = glide && railEnd ? ([...railEnd.children] as HTMLElement[]).filter((el) => !el.hidden && shows.get(el) !== false) : [];
    const tops = items.map((el) => el.getBoundingClientRect().top);
    // A control that goes while it has the keyboard's focus hands it on: Tap for sound to Sound and back, else the first
    // control still there (the focus would otherwise drop to the page, and a screen reader lose its place)
    const focused = document.activeElement as HTMLElement | null;
    for (const [el, show] of shows) setHidden(el, !show);
    if (focused && focused.hidden && shows.has(focused)) {
      const twin = focused === $('sound') ? $('mute') : focused === $('mute') ? $('sound') : null;
      const next = twin && !twin.hidden ? twin : [...shows.keys()].find((el) => el && !el.hidden && root.contains(el));
      next?.focus({ preventScroll: true });
    }
    items.forEach((el, i) => {
      const dy = tops[i] - el.getBoundingClientRect().top;
      if (Math.abs(dy) <= 0.5) return;
      // (gliding, it's drawn over where the one that came now is: it takes no taps until it's there, so a quick tap on
      // Tap for sound as it appears is never a tap on Full screen passing over it)
      el.style.pointerEvents = 'none';
      const glide = el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      const done = () => { el.style.pointerEvents = ''; };
      glide.onfinish = done; glide.oncancel = done;
    });
  }
  function paint() {
    const v = video();
    const isVideo = !!player && pstatus !== 'iframe';
    const showing = pstatus === 'playing' || pstatus === 'buffering' || pstatus === 'paused';
    const live = view.mode === 'live';
    flag('data-muted', muted);
    // The rail: a live upright picture's controls in a column beside it (LiveStage), where there's room for the
    // heart and full screen even before the sound is on
    const rail = party && live && shape() === 'portrait' && document.fullscreenElement !== root && !sideways.matches;
    flag('data-rail', rail);

    // Photo badge, before the watch party only
    setHidden($('badge'), party || !view.badge);
    const bt = $('badge-text'); if (bt) bt.textContent = view.badge;

    // Over the frame only when there is no picture
    const note = isVideo && pstatus && (pstatus !== 'connecting' || slowConnect) ? NOTES[kind]?.[pstatus] : null;
    setHidden($('note'), !note);
    if (note) { const t = $('note-title'); const x = $('note-text'); if (t) t.textContent = note[0]; if (x) x.textContent = note[1]; }
    setHidden($('tap'), !(isVideo && pstatus === 'blocked'));

    // Bar
    setHidden($('bar'), !party);
    const replayControls = kind === 'replay' && isVideo;
    setHidden($('livebar'), replayControls);
    setHidden($('replaybar'), !replayControls);
    const onAir = live && (!isVideo || showing || pstatus === 'blocked');
    flag('data-onair', onAir);
    const status = $('status');
    if (status) status.textContent = live ? (onAir ? 'Live' : STATUS[pstatus as PlayerStatus] || 'Connecting') : kind === 'replay' ? 'Replay' : '';
    const count = live && onAir && viewers >= VIEWERS_MIN;
    setHidden($('count'), !count);
    const said = `${party && live ? (onAir ? 1 : 0) : ''}|${count ? viewers : ''}`;
    if (said !== lastSaid) { lastSaid = said; opts.onAir?.(party && live ? onAir : null, count ? viewers : null); }
    // The number and its word apart, so the word can step aside first on a narrow bar
    const cn = $('count-num'); const cw = $('count-word');
    if (count) { if (cn) cn.textContent = viewers.toLocaleString(); if (cw) cw.textContent = 'watching'; }
    // Muted: one clear "Tap for sound". After that: sound, a heart, full screen. In the rail, and in full screen (where
    // there's no other way back out on a computer or an Android phone but Esc or Back), all three from the start
    const soundCta = live && isVideo && showing && muted;
    const roomy = rail || document.fullscreenElement === root || !soundCta;
    const mute = $('mute');
    // (a switch named by its word, "Sound", so a voice saying what's on screen reaches it; pressed: the sound is on)
    mute?.setAttribute('aria-pressed', String(!muted));
    const shows = new Map<HTMLElement | null, boolean>([
      [$('sound'), soundCta],
      [mute, live && isVideo && showing && !muted],
      [$('heart'), live && roomy && (onAir || !isVideo)],
      ...[...root.querySelectorAll<HTMLElement>('[data-full]')].map((b) => [b, isVideo && (kind === 'replay' || (live && roomy))] as [HTMLElement, boolean]),
    ]);
    railChange(shows);
    const cc = $('cc-toggle');
    setHidden(cc, !(kind === 'replay' && hasCaptions && isVideo));
    cc?.setAttribute('aria-pressed', String(ccOn));

    // Replay extras
    flag('data-cc', party && kind === 'replay' && hasCaptions && ccOn && isVideo);
    setHidden($('cc'), !root.hasAttribute('data-cc'));
    paintMark();
    paintJump(v?.currentTime ?? 0);
  }

  function paintMark() {
    const v = video();
    const d = v?.duration ?? NaN;
    const ok = kind === 'replay' && revealAt != null && Number.isFinite(d) && d > 0 && revealAt < d;
    const mark = $('mark');
    setHidden(mark, !ok);
    // The line (its gap) and the star both read where it is, so it's set on the line's cell
    const cell = mark?.parentElement;
    if (cell) {
      cell.toggleAttribute('data-mark', ok);
      const at = ok ? Math.min(1, Math.max(0, revealAt! / d)) : 0;
      if (ok) cell.style.setProperty('--at', String(at));
      // The line runs 8px in from each end of the cell, the star (16px each side of its centre with its gap) sits where
      // the handle will be: a piece of line under 8px either side of it is a speck, so it's left out
      const w = cell.clientWidth;
      const star = 16 + (w - 32) * at;
      const edge = !ok || !w ? '' : star - 16 - 8 < 8 ? 'start' : w - 8 - (star + 16) < 8 ? 'end' : '';
      if (edge) cell.dataset.markEdge = edge; else delete cell.dataset.markEdge;
    }
  }
  function paintJump(t: number) {
    const show = party && kind === 'replay' && revealAt != null && !!player && pstatus !== 'iframe';
    flag('data-jump', show);
    setHidden($('jump'), !show);
    if (!show) return;
    const label = $('jump-label'); const at = $('jump-at');
    // After the moment has played, the button offers it again
    const text = t > revealAt! + 30 ? 'Watch the reveal again' : 'Jump to the reveal';
    if (label) label.textContent = text;
    if (at) at.textContent = formatTime(revealAt!);
    $('jump')?.setAttribute('aria-label', `${text}, at ${formatTime(revealAt!)}`);
  }
  // The captions line is two lines tall, always. A cue too long for that is shown a page at a time, each for its
  // share of the cue's time (by its share of the words), so the line never grows: a long cue used to take four lines,
  // push Jump off the screen and move the controls whenever the length changed
  const pageCache = new Map<string, string[]>();
  function pagesOf(text: string, el: HTMLElement): string[] {
    const key = `${$('cc')?.clientWidth ?? 0}|${text}`;
    const hit = pageCache.get(key);
    if (hit) return hit;
    const two = (parseFloat(getComputedStyle(el).lineHeight) || 21) * 2 + 1;
    const fits = (words: string[]) => { el.textContent = words.join(' '); return el.getBoundingClientRect().height <= two; };
    const words = text.split(/\s+/).filter(Boolean);
    const pages: string[] = [];
    if (fits(words)) pages.push(words.join(' '));
    else {
      let page: string[] = [];
      for (const w of words) {
        if (page.length && !fits([...page, w])) { pages.push(page.join(' ')); page = []; }
        page.push(w);
      }
      if (page.length) pages.push(page.join(' '));
    }
    if (pageCache.size > 300) pageCache.clear();
    pageCache.set(key, pages);
    return pages;
  }
  function paintCaption(t: number) {
    if (!root.hasAttribute('data-cc') || !cues) return;
    const cue = cues.find((c) => t >= c.start && t <= c.end + 0.25);
    const el = $('cc-text');
    if (!el) return;
    let text = cue?.text || '';
    if (cue && text) {
      const pages = pagesOf(text, el);
      text = pages[pages.length - 1];
      if (pages.length > 1) {
        const total = pages.reduce((n, p) => n + p.length, 0);
        const at = ((Math.min(t, cue.end) - cue.start) / Math.max(0.001, cue.end - cue.start)) * total;
        let upTo = 0;
        for (const p of pages) { upTo += p.length; if (at < upTo) { text = p; break; } }
      }
    }
    if (el.textContent !== text) el.textContent = text;
  }

  // ── Replay: the reveal moment and captions ──────────────────────
  async function loadReplayMeta() {
    clearTimeout(metaTimer);
    if (kind !== 'replay') return;
    try {
      const res = await fetch('/api/live-replay', { cache: 'no-store' });
      const data = res.ok ? await res.json() : null;
      if (data?.ok && data.uid === view.player?.uid) {
        revealAt = typeof data.revealAt === 'number' ? data.revealAt : null;
        hasCaptions = !!data.captions;
        if (hasCaptions && ccOn) loadCues();
        paint();
      }
    } catch { /* offline: the replay still plays */ }
    // The moment and captions can land a while after the replay is up
    if ((revealAt == null || !hasCaptions) && Date.now() - metaSince < REPLAY_META_FOR_MS) metaTimer = setTimeout(loadReplayMeta, REPLAY_META_MS);
  }
  async function loadCues() {
    if (cues) return;
    try {
      const res = await fetch('/api/live-replay?vtt=en');
      cues = res.ok ? parseVtt(await res.text()) : [];
    } catch { cues = []; }
    paintCaption(video()?.currentTime ?? 0);
  }
  function jumpToReveal() {
    const v = video();
    if (!v || revealAt == null) return;
    v.currentTime = Math.max(0, revealAt - JUMP_LEAD);
    player?.setMuted(false);
    player?.play();
    client.beacon('click_replay', { how: 'jump' });
  }

  // ── Controls ────────────────────────────────────────────────────
  function soundOn(how: string) {
    if (!player) return;
    player.setMuted(false);
    if (!soundBeacon) { soundBeacon = true; client.beacon('click_watch', { how }); }
  }
  function toggleSound() { if (!player) return; if (muted) soundOn('button'); else player.setMuted(true); }
  function togglePlay() {
    const v = video();
    if (!v || !player) return;
    if (v.paused || v.ended) { player.setMuted(false); player.play(); } else v.pause();
  }
  function toggleCaptions() {
    ccOn = !ccOn;
    try { localStorage.setItem(CC_KEY, ccOn ? '1' : '0'); } catch { /* private mode */ }
    if (ccOn) loadCues();
    paint();
    paintCaption(video()?.currentTime ?? 0);
  }
  async function toggleFullscreen() {
    const v = video() as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    // iPhone: only the video itself can go full screen, and it can refuse (InvalidStateError, a picture not ready yet):
    // then nothing happens, instead of an error nobody catches
    const videoOnly = () => { try { v?.webkitEnterFullscreen?.(); } catch { /* refused */ } };
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.requestFullscreen) await root.requestFullscreen();
      else videoOnly();
    } catch { videoOnly(); }
  }

  $('sound')?.addEventListener('click', () => soundOn('sound'));
  $('tap')?.addEventListener('click', () => { if (!player) return; soundOn('tap'); player.play(); });
  $('mute')?.addEventListener('click', toggleSound);
  $('cc-toggle')?.addEventListener('click', toggleCaptions);
  root.querySelectorAll('[data-full]').forEach((b) => b.addEventListener('click', toggleFullscreen));
  $('play')?.addEventListener('click', togglePlay);
  $('jump')?.addEventListener('click', jumpToReveal);
  // Tapping the picture: sound on for a muted live video, play / pause for a replay
  playerEl?.addEventListener('click', () => {
    if (docked) return;
    if (kind === 'live' && muted) soundOn('video');
    else if (kind === 'replay') togglePlay();
  });
  let seeking = false;
  // A tap on the reveal's star plays from the reveal, exactly, as Jump to the reveal does: the star is drawn on the
  // line and the line takes the tap, which on its own would land wherever on the star the finger did (on a short line,
  // a minute or more either side). A press that moves is a drag, star or not. It jumps when the finger lifts; the
  // slider's own move to where the finger was, which for a tap in its 8px end comes after the lift, is put back
  // (starTapped: until the next press or key, the only things that move the slider)
  let press: { x: number; y: number; star: boolean } | null = null;
  let starTapped = false;
  const onStar = (e: PointerEvent) => {
    const m = $('mark');
    if (!m || m.hidden) return false;
    const r = m.getBoundingClientRect();
    // (its 3px white ring included)
    return Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) <= r.width / 2 + 3;
  };
  seek?.addEventListener('pointerdown', (e) => { starTapped = false; press = { x: e.clientX, y: e.clientY, star: onStar(e) }; });
  seek?.addEventListener('pointermove', (e) => { if (press?.star && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.star = false; });
  seek?.addEventListener('pointercancel', () => { press = null; });
  seek?.addEventListener('pointerup', () => {
    const star = press?.star;
    press = null;
    if (star) { starTapped = true; seeking = false; jumpToReveal(); }
  });
  seek?.addEventListener('keydown', () => { press = null; starTapped = false; });
  seek?.addEventListener('input', () => {
    const v = video();
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    // (a tap on the star goes to the reveal, never first to where it touched: the handle stays where the video is)
    if (press?.star || starTapped) { seek.value = String(Math.round((v.currentTime / v.duration) * 1000)); return; }
    seeking = true;
    v.currentTime = (Number(seek.value) / 1000) * v.duration;
  });
  seek?.addEventListener('change', () => { seeking = false; });
  // Keyboard, while focus is anywhere in the stage
  root.addEventListener('keydown', (e) => {
    if (!party || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    // Typing stays typing; the progress line is no text box, so the keys work there too. The design strip beside the
    // picture has keys of its own (its pictures open the viewer), so the video's don't reach into it
    if (t.matches('textarea, input:not([data-s="seek"])') || t.closest('.stage__beside')) return;
    const k = e.key.toLowerCase();
    if (k === 'm' && player) { e.preventDefault(); toggleSound(); }
    else if (k === 'f') { e.preventDefault(); toggleFullscreen(); }
    else if (k === 'c' && hasCaptions) { e.preventDefault(); toggleCaptions(); }
    else if ((k === 'k' || (k === ' ' && (t === root || t === seek))) && kind === 'replay') { e.preventDefault(); togglePlay(); }
    // On the line, the arrows go 5 seconds (the slider's own step is a thousandth of the video: under a second here)
    else if (t === seek && kind === 'replay' && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      const v = video();
      if (!v || !Number.isFinite(v.duration)) return;
      e.preventDefault();
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
      v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + (back ? -5 : 5)));
    }
  });

  // ── Love: one heart. In the rail, hearts float up beside the picture: a burst for yours, one for each someone else
  // sends (a few at most at once). In a bar, yours pops and others' make it beat. Never over the picture, no numbers ──
  const heart = $('heart');
  const rise = $('rise');
  const bump = (cls: string, ms: number, evenStill = false) => {
    if (!heart || (reduced && !evenStill)) return;
    heart.classList.remove(cls); void heart.offsetWidth; heart.classList.add(cls);
    setTimeout(() => heart.classList.remove(cls), ms);
  };
  const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
  const floats = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { floats.delete(t); fn(); }, ms); floats.add(t); };
  // One heart up the column beside the picture: all the brand's yellow, each its own size, strength and lane (left,
  // middle, right), so a burst fans out and reads as many hearts, not one lump. As high as the column goes, however
  // short (a small phone's is a few dozen pixels), and quick, so they don't pile up
  function floatHeart(big: boolean, lane = Math.floor(Math.random() * 3)) {
    // (not while the page is out of sight: a hidden tab's animations never run, so they'd all rise at once on return)
    if (!rise || reduced || document.hidden || !root.hasAttribute('data-rail') || rise.childElementCount > 16) return;
    const h = document.createElement('span');
    h.className = 'float';
    const sway = () => `${Math.round((Math.random() - 0.5) * 16)}px`;
    const sz = big ? 20 + Math.random() * 8 : 14 + Math.random() * 6;
    const v: Record<string, string> = {
      '--sz': `${sz.toFixed(1)}px`, '--dx': `${((lane % 3) - 1) * 12 + (Math.random() - 0.5) * 4}px`, '--up': `${Math.max(24, rise.clientHeight - 12)}px`,
      '--s1': sway(), '--s2': sway(), '--s3': sway(),
      '--r1': `${Math.round((Math.random() - 0.5) * 24)}deg`, '--r2': `${Math.round((Math.random() - 0.5) * 24)}deg`,
      '--d': `${(1.5 + Math.random() * 0.6).toFixed(2)}s`, '--o': (0.85 + Math.random() * 0.15).toFixed(2),
    };
    for (const [k, val] of Object.entries(v)) h.style.setProperty(k, val);
    h.innerHTML = HEART_SVG;
    h.addEventListener('animationend', () => h.remove(), { once: true });
    rise.append(h);
  }
  // Your own taps come back in the hub's next batch or two (every 400 ms): they're taken off those, so you see everyone
  // else's. Only recent ones: the hub lets only so many through from one page, and the rest never come back to take off
  let mine = 0;
  let mineAt = 0;
  // (said once in a while, not for every tap of a run of them)
  let saidAt = 0;
  heart?.addEventListener('click', () => {
    bump('is-pop', 380);
    // With reduced motion there are no hearts going up: the button goes dark for a moment instead, nothing moving
    if (reduced) bump('is-sent', 600, true);
    const said = $('said');
    if (said && Date.now() - saidAt > 4000) { saidAt = Date.now(); said.textContent = ''; requestAnimationFrame(() => { said.textContent = 'Love sent to the family'; }); }
    if (root.hasAttribute('data-rail')) for (let i = 0; i < 4; i++) later(() => floatHeart(true, i + 1), i * 110);
    if (client.react('heart')) { mine++; mineAt = Date.now(); }
  });
  const offs: (() => void)[] = [];
  offs.push(client.on('react', ({ c }) => {
    if (view.mode !== 'live') return;
    const total = Object.values(c).reduce((n, v) => n + (Number(v) || 0), 0);
    if (Date.now() - mineAt > 1500) mine = 0;
    const theirs = total - Math.min(mine, total);
    mine = Math.max(0, mine - total);
    if (theirs <= 0) return;
    if (root.hasAttribute('data-rail')) for (let i = 0; i < Math.min(theirs, 4); i++) later(() => floatHeart(false), i * 160);
    else bump('is-beat', 600);
  }));
  offs.push(client.on('viewers', ({ n }) => { viewers = n; paint(); }));

  // ── Mini player ─────────────────────────────────────────────────
  let docked = false;
  let dockOff = false;
  let inView = true;
  let pinned = false;
  function setDock(on: boolean) {
    if (!picture || on === docked) return;
    docked = on;
    if (on) {
      // Sit above the auction bar when one is showing (the box to write a message on a phone is the page's own to know
      // from the first paint: LiveStage.astro, --live-dock)
      const bar = document.querySelector<HTMLElement>('.auction-bar');
      const off = bar && bar.offsetHeight && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0;
      picture.style.setProperty('--dock-bottom', `${off}px`);
      const label = $('dock-label'); if (label) label.textContent = view.mode === 'replay' ? 'Replay' : 'Live';
    }
    picture.classList.toggle('is-docked', on);
    setHidden($('dockbar'), !on);
  }
  function setPinned(on: boolean) {
    picture?.classList.toggle('is-pinned', on);
    // A pinned player stays until the sheet closes, so it has no close button
    setHidden($('undock'), on);
  }
  function updateDock() {
    const going = !!player && (kind === 'live'
      ? pstatus === 'iframe' || pstatus === 'playing' || pstatus === 'buffering' || pstatus === 'reconnecting'
      : pstatus === 'playing' || pstatus === 'buffering');
    const pin = pinned && party;
    setDock(pin || (party && going && !inView && !dockOff && !typing && !document.fullscreenElement));
    setPinned(pin && docked);
  }
  // While someone types on a phone the small player steps aside: its keyboard leaves no room on the screen for both,
  // and it sat over the message being typed (or, on a page the keyboard left very short, its × went off the top). The
  // reveal keeps playing, and the player comes back when typing ends
  const phone = matchMedia(PHONE);
  let typing = false;
  const onTyping = () => {
    const now = phone.matches && typingIn(document.activeElement) && !root.contains(document.activeElement);
    if (now !== typing) { typing = now; updateDock(); }
  };
  // (on its way out, focus is on nothing for a moment: wait to see where it lands)
  const onTypingOut = () => requestAnimationFrame(onTyping);
  document.addEventListener('focusin', onTyping);
  document.addEventListener('focusout', onTypingOut);
  phone.addEventListener('change', onTyping);
  let io: IntersectionObserver | null = null;
  if (screen && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(([e]) => {
      // Only once you've scrolled past the video, never while it is still below the fold
      inView = e.intersectionRatio >= DOCK_AT || e.boundingClientRect.top > 0;
      if (e.intersectionRatio >= DOCK_AT) dockOff = false;
      updateDock();
    }, { threshold: [0, DOCK_AT, 1] });
    io.observe(screen);
  }
  // (data-fullscreen: what LiveStage's full-screen layout keys on, in place of :fullscreen, which older Safari can't read)
  const onFullscreen = () => {
    const full = document.fullscreenElement === root;
    flag('data-fullscreen', full);
    root.querySelectorAll<HTMLElement>('[data-full]').forEach((b) => { b.setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen'); b.title = full ? 'Exit full screen (F)' : 'Full screen (F)'; });
    paint(); updateDock(); refit();
  };
  const onSideways = () => paint();
  sideways.addEventListener('change', onSideways);
  document.addEventListener('fullscreenchange', onFullscreen);

  // The captions line and the progress line, when their width changes (a turn, full screen, the layout chosen below,
  // captions switched on): a caption is split into its two-line pages again, and the line's ends measured again, at
  // once, paused or not (a paused caption was cut at its third line until it played again)
  const roomWatch = 'ResizeObserver' in window ? new ResizeObserver(() => { paintCaption(video()?.currentTime ?? 0); paintMark(); }) : null;
  for (const el of [$('cc'), seek?.parentElement]) if (el) roomWatch?.observe(el);

  // ── Which way round, on a phone held sideways ──
  // LiveStage has more than one way to lay the stage out there (data-fit): in full screen, the controls beside the
  // picture or under it; on the page, with captions on beside a wide picture that has the design with it, the
  // captions above the controls (with the design under them), under the picture, or the design in a column of its
  // own. Which leaves the picture biggest turns on the screen's exact width and height, so the stage tries each and
  // keeps the one with the biggest picture that fits on the screen. It runs before the screen is next drawn, so no
  // other way ever shows
  const besideEl = root.querySelector<HTMLElement>('.stage__beside');
  // (the height the page's frame goes by: the screen's, held while someone types; LivePage)
  const roomProbe = document.createElement('div');
  roomProbe.setAttribute('aria-hidden', 'true');
  roomProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:var(--live-vh, 100svh);visibility:hidden;pointer-events:none';
  document.body.append(roomProbe);
  const setFit = (w: string) => { if (w) root.dataset.fit = w; else delete root.dataset.fit; };
  function fitWays(): string[] {
    if (!party || !sideways.matches || !screen) return [];
    // ('' is the stage's usual way: in full screen, the controls under the picture)
    if (document.fullscreenElement === root) return ['side', ''];
    if (root.dataset.orientation === 'landscape' && root.hasAttribute('data-cc') && (besideEl?.offsetHeight ?? 0) > 0) return ['', 'under', 'col'];
    return [];
  }
  function fit() {
    const ways = fitWays();
    if (ways.length < 2) { setFit(''); return; }
    const full = document.fullscreenElement === root;
    const room = full ? innerHeight : roomProbe.getBoundingClientRect().height;
    let best = ''; let bestW = -1; let bestOver = Infinity;
    for (const w of ways) {
      setFit(w);
      const pic = screen!.getBoundingClientRect().width;
      const r = root.getBoundingClientRect();
      // How far it runs past the bottom of the screen (on the page: with the page at its top, where the frame is sized)
      const over = Math.max(0, (full ? r.bottom : r.bottom + scrollY) - room);
      const better = over <= 1 ? bestOver > 1 || pic > bestW + 0.5 : bestOver > 1 && over < bestOver - 0.5;
      if (better) { best = w; bestW = pic; bestOver = over; }
    }
    setFit(best);
  }
  let fitQueued = false;
  // (in the next frame's first step, before it's drawn: after anything else that resizes the frame, like LivePage's
  // hold while typing, has had its turn)
  function refit() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => { fitQueued = false; fit(); });
  }
  addEventListener('resize', refit);
  // What changes the choice: captions, Jump, the picture's shape, the mode, and the design being shown (on the page)
  const fitWatch = new MutationObserver(refit);
  fitWatch.observe(root, { attributes: true, attributeFilter: ['data-party', 'data-mode', 'data-orientation', 'data-cc', 'data-jump', 'style'] });
  const host = root.closest('.hero');
  if (host) fitWatch.observe(host, { attributes: true, attributeFilter: ['data-party', 'data-design', 'data-orientation'] });
  $('undock')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dockOff = true;
    // Closing the mini player stops the sound too, the way every mini player works
    if (kind === 'live') player?.setMuted(true); else video()?.pause();
    updateDock();
  });
  // Tapping the mini player takes you back to it
  picture?.addEventListener('click', (e) => {
    if (!docked || (e.target as Element).closest('[data-s="undock"]')) return;
    e.preventDefault();
    e.stopPropagation();
    screen?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }, true);

  return {
    update,
    get party() { return party; },
    pin(on: boolean, where: 'give' | 'design' = 'give') {
      pinned = on;
      if (on) root.dataset.pin = where; else delete root.dataset.pin;
      updateDock();
    },
    destroy() {
      unmount();
      mounted = '';
      if (watching) { watching = false; client.unwatch(); }
      io?.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreen);
      sideways.removeEventListener('change', onSideways);
      document.removeEventListener('focusin', onTyping);
      document.removeEventListener('focusout', onTypingOut);
      phone.removeEventListener('change', onTyping);
      removeEventListener('resize', refit);
      fitWatch.disconnect();
      roomWatch?.disconnect();
      roomProbe.remove();
      for (const off of offs) off();
      for (const t of floats) clearTimeout(t);
      floats.clear();
      rise?.replaceChildren();
    },
  };
}
