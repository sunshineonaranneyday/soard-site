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
import { mountPlayer, type LiveSeek, type PlayerHandle, type PlayerStatus } from './live-player';
import { watchMeter } from './live-stats';
import { PHONE, SIDE, typingIn } from './live-media';
import { morphEase, morphPath } from './play-morph';

export type StageMode = 'loading' | 'idle' | 'upcoming' | 'live' | 'replay';
export interface StageView {
  mode: StageMode;
  /** The live or replay video (live and replay modes only) */
  player: LivePlayer | null;
  /** The broadcast's setting; the picture's real shape wins once known */
  orientation: 'portrait' | 'landscape';
  /** Badge on the photo before the watch party ('' hides it) */
  badge: string;
  /** The broadcast's own phase ('live', 'ending', 'replay', ...): the live video's end note needs to know the phone came
   * back on (live again after it wasn't) rather than the broadcast simply not having moved on yet */
  phase?: string;
  /**
   * The reveal over and its replay not here yet (Peter, Nov 18 2026: "why not keep the theater view up for some period
   * of time after"): the watch party's layout all the same, for everyone, those arriving after the end included, with
   * "That's the reveal!" in the frame, and Watch the replay on it once the replay is ready. Replay mode, no player
   */
  ended?: boolean;
  /** The replay is on its way (the note says it will be here in a few minutes); false: it's overdue, nothing is promised */
  replaySoon?: boolean;
}
export interface Stage {
  update(view: StageView): void;
  readonly party: boolean;
  /**
   * The live video is still playing the broadcast: viewers watch about 20 s behind the phone, so when the broadcast stops
   * being live its last seconds (often the reveal itself) are still to come. The page keeps showing it live until false
   */
  readonly playingLive: boolean;
  /** "That's the reveal!" is showing (the live video played its last frame): the page keeps the video's place for it */
  readonly ended: boolean;
  /** The note is showing, or the page moving to this view would bring it up: the page keeps the video's place either way */
  endsWith(mode: StageMode): boolean;
  /**
   * Hold the video in a small player at the top of the screen while something covers the page on a phone:
   * 'give', the give sheet (top right, over the page above the sheet); 'design', the design viewer (its top left corner)
   */
  /** The rail's way into the room's design: its face (a picture's address), or '' for none */
  setDesign(face: string): void;
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
  /** playingLive or ended changed: the page draws itself again */
  onEnd?: () => void;
}

/** Below this the count reads as lonely rather than lively, so it stays hidden. */
const VIEWERS_MIN = 5;
/** Share of the video still on screen below which it docks into the corner */
const DOCK_AT = 0.35;
/** Start this far before the reveal moment, so the countdown is in the shot */
const JUMP_LEAD = 5;
const REPLAY_META_MS = 2 * 60 * 1000;
/**
 * The line under "The replay will be here in a few minutes." (Peter, Nov 18 2026: "can there be a motion or something
 * building the reveal video?!", then "love the yellow line"): it fills from the reveal's end on a curve paced on how long
 * Stream takes to have the replay ready (about 2 to 3 minutes: 2.6 and 2.4 in the Nov 18 tests), quickly at first,
 * slower as it goes, and never past END_LINE_MAX until the replay is really here (then the words and the line go and
 * Watch the replay comes). From the broadcast's endedAt, so a late arrival sees it as far along as everyone else
 */
const END_LINE_MAX = 0.92;
const END_LINE_TAU_S = 75;
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
  // The replay's progress line (its cell), its bar and the play button's shape
  const cell = $('seekcell');
  const replaybar = $('replaybar');
  const morph = root.querySelector<SVGPathElement>('[data-s="morph"]');

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
  // Live: going back through the broadcast so far (the player's: canSeek, behind)
  let liveSeek: LiveSeek = { canSeek: false, behind: 0 };
  // The reveal over: "That's the reveal!" showing, what the page asked for meanwhile (shown when they tap Watch the
  // replay), and whether the broadcast has been off since (so its coming back on means the phone did)
  let endShown = false;
  // The room's design, a button in the rail (live-design.ts gives it the room's first picture as its face): the rail
  // takes the place where the design's strip sat beside the video, so this is its way in (Peter, Nov 9 2026: the design
  // has to be with the video during the reveal)
  let designFace = '';
  let endPending: StageView | null = null;
  let endSawOff = false;
  // The broadcast the video on belongs to: only its own moving on is the reveal's end (a staff test after the reveal,
  // ending back on the reveal's replay, isn't)
  let mountedFor = '';
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
    // The reveal over and "That's the reveal!" up: it stays until they ask for the replay, or the phone comes back on
    // (the broadcast live again after it was off); what the page asks for meanwhile waits
    if (endShown) {
      if (next.phase && next.phase !== 'live') endSawOff = true;
      const backOn = next.mode === 'live' && next.phase === 'live' && endSawOff;
      // (back to the countdown: the broadcast was set up again for later, the note's done)
      const over = next.mode === 'upcoming';
      if (!backOn && !over) { endPending = next; paint(); return; }
      hideEnd();
      unmount();
      mounted = ''; // (a fresh live player for the phone's new feed)
    } else if (endsNow(next)) {
      // The live video was on and the broadcast has moved on to its replay, or to nothing (the page holds it live while
      // it still has frames to play: playingLive): it ends with the note, not a cut to whatever comes next. (Back to the
      // countdown, a camera check before the start, isn't an end: that goes as it always has)
      showEnd(next);
      return;
    }
    view = next;
    const wasParty = party;
    // (the reveal over, its replay not here yet: the watch party's layout, with the note in the frame: showEnd below)
    const after = !!next.ended && next.mode === 'replay' && !next.player;
    party = (!!next.player && (next.mode === 'live' || next.mode === 'replay')) || after;
    root.dataset.mode = next.mode;
    flag('data-party', party);
    root.dataset.orientation = shape();

    // The broadcast is part of the key: the live input is the same for every reveal, and each reveal's watching is its own
    const key = party && next.player ? `${next.player.kind}:${next.player.uid}:${client.state?.id || ''}` : '';
    if (key !== mounted && playerEl) {
      mounted = key;
      mountedFor = client.state?.id || '';
      unmount();
      if (key && next.player) {
        kind = next.player.kind;
        root.dataset.pkind = kind;
        playerEl.hidden = false;
        player = mountPlayer(playerEl, {
          player: next.player, onStatus, onSize, onMuted,
          onLive: (st) => { liveSeek = st; paint(); },
          // (the feed over: the end only once the broadcast itself has moved on to its replay, or to nothing. While it's
          // still live or ending, a phone that dropped may yet come back: the player says Reconnecting meanwhile)
          onFeedEnd: () => { if (kind === 'live' && (view.phase === 'replay' || view.phase === 'idle')) showEnd(null); else tellPage(); },
        });
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
    if (after) { showEnd(next); return; }
    paint();
    updateDock();
  }

  // ── The reveal over ─────────────────────────────────────────────
  // The live video has played its last frame (or the broadcast moved on with nothing left for it to play): "That's the
  // reveal!" over the soft photo, the live video kept under it (hidden) in case the phone comes back on, and the replay
  // offered once there is one. Nothing starts by itself
  // Still playing the broadcast (the page keeps it live while this is so): a live video on, not over, and not out of
  // frames (waiting or reconnecting with the broadcast moved on means nothing is left for it to play)
  // (playing or buffering only: paused by the phone, never started (Low Power Mode), connecting or Stream's own player
  // aren't playing anything to the end, so the page doesn't stay Live for them)
  const isPlayingLive = () => kind === 'live' && !!player && !endShown && !player.feedEnded && !player.closed && (pstatus === 'playing' || pstatus === 'buffering');
  // The page's next view ends the reveal for the video on: it was this broadcast's live video, and the broadcast has
  // moved on to its replay or to nothing (the page asks before drawing itself, so its layout and the give form hold)
  const endsNow = (next: { mode: StageMode }) => kind === 'live' && !!player && !endShown && (next.mode === 'replay' || next.mode === 'idle') && mountedFor === (client.state?.id || '');
  let playingWas = false;
  let endWas = false;
  // (after the moment: the page may be in the middle of drawing itself, which is what told the stage something)
  function tellPage() {
    queueMicrotask(() => {
      const now = isPlayingLive();
      if (now !== playingWas || endShown !== endWas) { playingWas = now; endWas = endShown; opts.onEnd?.(); }
    });
  }
  function showEnd(next: StageView | null) {
    if (endShown) return;
    endShown = true;
    endSawOff = !!next?.phase && next.phase !== 'live' || (view.phase != null && view.phase !== 'live');
    if (next) endPending = next;
    flag('data-ended', true);
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    paint();
    updateDock();
    tellPage();
  }
  function hideEnd() {
    endShown = false;
    endPending = null;
    flag('data-ended', false);
    tellPage();
  }
  $('end-replay')?.addEventListener('click', () => {
    const next = endPending;
    hideEnd();
    // (the live video kept under the note goes now: the replay takes its place, from the beginning)
    unmount();
    mounted = '';
    if (next) update(next);
    // (and it plays, with its sound: the tap was asking for it, never a second tap on the replay's own play)
    if (player && kind === 'replay') { player.setMuted(false); player.play(); }
    root.focus({ preventScroll: true });
  });
  $('from-start')?.addEventListener('click', () => player?.seekToStart());
  $('to-live')?.addEventListener('click', () => player?.toLive());

  function unmount() {
    meter?.stop(); meter = null;
    detach?.(); detach = null;
    player?.destroy();
    player = null;
    kind = '';
    pstatus = '';
    liveSeek = { canSeek: false, behind: 0 };
    sized = '';
    revealAt = null; hasCaptions = false; cues = null;
    clearTimeout(metaTimer);
    clearTimeout(connectingTimer);
    slowConnect = false;
    delete root.dataset.pstatus;
    delete root.dataset.pkind;
    root.style.removeProperty('--ar');
    flag('data-exact', false);
    flag('data-playing', false);
    resetClock();
    if (playerEl) playerEl.innerHTML = '';
    setDock(false);
  }

  // ── Player callbacks ────────────────────────────────────────────
  function onStatus(st: PlayerStatus) {
    pstatus = st;
    root.dataset.pstatus = st;
    repaintPlay?.();
    clearTimeout(connectingTimer);
    slowConnect = false;
    // Only say "loading" when it is actually slow
    // (after a moment: a blank frame with no words reads as broken; the note fades in, LiveStage.astro)
    if (st === 'connecting') connectingTimer = setTimeout(() => { slowConnect = true; paint(); }, 800);
    if (st === 'playing' && kind === 'replay' && !replayBeacon) { replayBeacon = true; client.beacon('click_replay'); }
    if (st === 'iframe') attachMedia();
    // The phone back on while "That's the reveal!" is up with the broadcast still live (it never went off): the live
    // video playing again takes the note away
    if (endShown && kind === 'live' && st === 'playing' && view.mode === 'live' && !endSawOff) hideEnd();
    paint();
    updateDock();
    tellPage();
  }
  function onSize(w: number, h: number) {
    sized = h > w ? 'portrait' : 'landscape';
    root.dataset.orientation = sized;
    root.style.setProperty('--ar', String(Math.min(2.4, Math.max(0.42, w / h))));
    // (the frame is the picture's own shape: the picture fills it exactly, LiveStage.astro)
    flag('data-exact', w / h >= 0.42 && w / h <= 2.4);
    told = sized;
    opts.onShape?.(sized, party);
    paint();
  }
  function onMuted(m: boolean) { muted = m; paint(); }

  /** Replay clock: play state, the progress line, time, captions line */
  // The line, its handle and the time glide with the picture: drawn every frame while it plays (glide), not only when the
  // video says where it is (4 times a second: the handle jumped along). Between the video's own reports (Safari's come
  // about 10 times a second) it is where it must be by now, from the last report and the time since
  let shownAt = 0;
  let clock = { media: -1, wall: 0 };
  let raf = 0;
  let lastSec = -1;
  // A finger (or the mouse) on the line: where it is, whether it has started moving the picture, and whether the video
  // was playing (it pauses while scrubbing, the icon staying as it was, and plays on when the finger lifts)
  let scrub: { id: number; x0: number; y0: number; star: boolean; on: boolean; t: number; wasPlaying: boolean; mouse: boolean } | null = null;
  // One move of the picture at a time, always: asked for again before the last has landed, the newest place waits and
  // goes next. Every move asked for at once, the picture landed 4 of 31 in a second's drag (Nov 18 2026), and iPhone
  // Safari, a move asked for over one still landing, could stop playing altogether (it stuck at the place, or said
  // Reconnecting, measured in the Simulator the same day)
  let seekWant: { t: number; exact: boolean } | null = null;
  let seekWatch: ReturnType<typeof setTimeout> | undefined;
  // The finger lifted while the picture was still moving: it plays on once the exact move is under way, never first from
  // wherever the quick move got to
  let playAfterSeek = false;
  function paintAt(t: number, d: number) {
    if (!cell || !Number.isFinite(d) || d <= 0) return;
    cell.style.setProperty('--f', Math.min(1, Math.max(0, t / d)).toFixed(5));
    const sec = Math.floor(Math.max(0, t));
    if (sec !== lastSec) { lastSec = sec; const now = $('time-now'); if (now) now.textContent = formatTime(t); }
  }
  // How much has loaded past where it's at (the part of what's loaded that it's in)
  function paintLoaded() {
    const v = video();
    if (!v || !cell) return;
    const d = v.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const at = scrub?.on ? scrub.t : v.currentTime;
    let end = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= at + 0.5 && v.buffered.end(i) >= at) end = v.buffered.end(i);
    cell.style.setProperty('--buf', Math.min(1, end / d).toFixed(4));
  }
  function glide(now: number) {
    raf = 0;
    const v = video();
    if (!v || kind !== 'replay' || scrub?.on) return;
    if (v.paused || v.ended || v.seeking || v.readyState < 3) return; // (still: the media events paint its place)
    const ct = v.currentTime;
    if (ct !== clock.media) clock = { media: ct, wall: now };
    // Never more than a third of a second past the last report (it may have stalled), and never back by a hair (a report
    // a touch behind the estimate): a real move back is a seek, and those are drawn as they are
    let t = Math.min(clock.media + ((now - clock.wall) / 1000) * (v.playbackRate || 1), ct + 0.35);
    if (t < shownAt && shownAt - t < 0.3) t = shownAt;
    shownAt = t;
    paintAt(t, v.duration);
    raf = requestAnimationFrame(glide);
  }
  const startGlide = () => { if (!raf) raf = requestAnimationFrame(glide); };
  // The play button's shape: 0 play, 1 pause, and between while it turns (200 ms; at once with reduced motion)
  let iconAt = 0;
  let iconRaf = 0;
  const setIcon = (t: number) => { cancelAnimationFrame(iconRaf); iconRaf = 0; iconAt = t; morph?.setAttribute('d', morphPath(t)); };
  function showPlaying(on: boolean) {
    flag('data-playing', on);
    $('play')?.setAttribute('aria-label', on ? 'Pause' : 'Play');
    const to = on ? 1 : 0;
    if (!morph || (iconAt === to && !iconRaf)) return;
    if (reduced || document.hidden) { setIcon(to); return; }
    cancelAnimationFrame(iconRaf);
    const from = iconAt;
    const t0 = performance.now();
    const ms = 200 * Math.abs(to - from);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      iconAt = from + (to - from) * morphEase(k);
      morph.setAttribute('d', morphPath(iconAt));
      iconRaf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    iconRaf = requestAnimationFrame(step);
  }
  function resetClock() {
    cancelAnimationFrame(raf); raf = 0;
    scrub = null; seekWant = null; clearTimeout(seekWatch); playAfterSeek = false;
    replaybar?.removeAttribute('data-scrub');
    shownAt = 0; lastSec = -1; clock = { media: -1, wall: 0 };
    cell?.style.removeProperty('--f'); cell?.style.removeProperty('--buf');
    setIcon(0);
  }
  /** Move the picture: exactly (a tap, the finger lifted, the keyboard), or quickly while scrubbing; one at a time */
  function seekVideo(t: number, exact: boolean) {
    const v = video();
    if (!v) return;
    if (v.seeking) { seekWant = { t, exact }; watchSeek(v, performance.now()); return; }
    issueSeek(v, t, exact);
  }
  function issueSeek(v: HTMLVideoElement & { fastSeek?: (t: number) => void }, t: number, exact: boolean) {
    seekWant = null;
    clearTimeout(seekWatch);
    // (a quick move already there: asking again is a move all the same. An exact one always goes: Safari reports a quick
    // move's place as the one asked for, though it landed on the nearest whole picture, a second or more either side)
    if (exact || Math.abs(v.currentTime - t) >= 0.02) {
      if (!exact && typeof v.fastSeek === 'function') v.fastSeek(t); else v.currentTime = t;
    }
    if (playAfterSeek) { playAfterSeek = false; player?.play(); }
  }
  // A move waiting on one still landing goes as soon as that has landed (seeked, in attachMedia); this is for a browser
  // that never says so. Still landing (a phone's network can take seconds), it waits on, up to 6 s, then goes anyway
  function watchSeek(v: HTMLVideoElement, since: number) {
    clearTimeout(seekWatch);
    seekWatch = setTimeout(() => {
      if (!seekWant || video() !== v) return;
      if (v.seeking && performance.now() - since < 6000) { watchSeek(v, since); return; }
      issueSeek(v, seekWant.t, seekWant.exact);
    }, 500);
  }
  // (the play button's state, said again: called whenever the player's status changes, so a play waiting on its source
  // that the browser then refuses shows Play with Tap to watch, not Pause)
  let repaintPlay: (() => void) | null = null;
  function attachMedia() {
    detach?.(); detach = null;
    const v = video();
    if (!v) return;
    lastSec = -1;
    const tick = () => {
      const d = v.duration;
      const t = scrub?.on ? scrub.t : v.currentTime;
      if (Number.isFinite(d) && d > 0) {
        if (seek) {
          seek.value = String(Math.round((t / d) * 1000));
          seek.setAttribute('aria-valuetext', `${formatTime(t)} of ${formatTime(d)}`);
        }
        // (playing, the glide draws it; still, here)
        if (!raf && !scrub?.on) { shownAt = t; paintAt(t, d); }
      }
      // The time and the length are two pieces, so the length can step aside when the bar is narrow
      const total = $('time-total');
      if (total) total.textContent = Number.isFinite(d) && d > 0 ? formatTime(d) : '';
      paintLoaded();
      paintCaption(v.currentTime);
      paintJump(v.currentTime);
    };
    // (scrubbing, the video is paused, but the button keeps saying what it will do when the finger lifts)
    const playing = () => {
      // (a play asked for and waiting on the replay's source counts as playing: the button says Pause, and pressing it
      // means don't)
      showPlaying(scrub?.on ? scrub.wasPlaying : (!v.paused && !v.ended) || playAfterSeek || !!player?.playPending);
      if (!v.paused && !v.ended) { startGlide(); return; }
      // (stopped: drawn exactly where, the glide having been up to a moment ahead of the video's last report)
      cancelAnimationFrame(raf); raf = 0;
      if (!scrub?.on && Number.isFinite(v.duration)) { shownAt = v.ended ? v.duration : v.currentTime; paintAt(shownAt, v.duration); }
    };
    const seeked = () => {
      if (seekWant && !v.seeking) issueSeek(v, seekWant.t, seekWant.exact);
      tick();
      if (!v.paused) startGlide();
    };
    const evs: [string, () => void][] = [
      ['timeupdate', tick], ['durationchange', () => { tick(); paintMark(); }], ['seeked', seeked], ['progress', paintLoaded],
      ['play', playing], ['playing', playing], ['pause', playing], ['ended', () => { playing(); tick(); }],
      // (the video reset as its source came, a play asked for waiting on it: shown as playing, playing.playPending)
      ['emptied', playing],
    ];
    for (const [e, fn] of evs) v.addEventListener(e, fn);
    detach = () => { for (const [e, fn] of evs) v.removeEventListener(e, fn); cancelAnimationFrame(raf); raf = 0; repaintPlay = null; };
    repaintPlay = () => showPlaying(scrub?.on ? scrub.wasPlaying : (!v.paused && !v.ended) || playAfterSeek || !!player?.playPending);
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
      const pairs: [HTMLElement | null, HTMLElement | null][] = [[$('sound'), $('mute')], [$('from-start'), $('to-live')]];
      const pair = pairs.find(([a, b]) => focused === a || focused === b);
      const twin = pair ? (pair[0] === focused ? pair[1] : pair[0]) : null;
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
    // (a phone held sideways too, Nov 18 2026: the picture as tall as the screen, its controls in the rail beside it, the
    // messages beside that, where a long bar of controls used to leave most of the screen empty)
    const rail = party && live && shape() === 'portrait' && document.fullscreenElement !== root;
    flag('data-rail', rail);

    // Photo badge, before the watch party only
    setHidden($('badge'), party || !view.badge);
    const bt = $('badge-text'); if (bt) bt.textContent = view.badge;

    // Over the frame only when there is no picture
    // (none once the reveal is over: "That's the reveal!" says it, and a Reconnecting under it would say otherwise)
    const note = !endShown && isVideo && pstatus && (pstatus !== 'connecting' || slowConnect) ? NOTES[kind]?.[pstatus] : null;
    setHidden($('note'), !note);
    if (note) { const t = $('note-title'); const x = $('note-text'); if (t) t.textContent = note[0]; if (x) x.textContent = note[1]; }
    // Tap to watch: the browser refused to start it, or a live video was paused by something other than the viewer (an
    // iPhone's lock screen, a call, AirPods out, Control Center, a media key): playing again goes to the live moment
    setHidden($('tap'), !(isVideo && !endShown && (pstatus === 'blocked' || (kind === 'live' && pstatus === 'paused'))));

    // Bar
    // (none under "That's the reveal!" when there's no video at all: someone arriving after the end has nothing to control)
    setHidden($('bar'), !party || (endShown && !player));
    const replayControls = kind === 'replay' && isVideo;
    setHidden($('livebar'), replayControls);
    setHidden($('replaybar'), !replayControls);
    // (the reveal over, "That's the reveal!" up: nothing says Live any more, though the live video waits under the note)
    const onAir = live && !endShown && (!isVideo || showing || pstatus === 'blocked');
    flag('data-onair', onAir);
    const status = $('status');
    if (status) status.textContent = endShown ? '' : live ? (onAir ? 'Live' : STATUS[pstatus as PlayerStatus] || 'Connecting') : kind === 'replay' ? 'Replay' : '';
    const count = live && onAir && viewers >= VIEWERS_MIN;
    setHidden($('count'), !count);
    const said = `${party && live && !endShown ? (onAir ? 1 : 0) : ''}|${count ? viewers : ''}`;
    if (said !== lastSaid) { lastSaid = said; opts.onAir?.(party && live && !endShown ? onAir : null, count ? viewers : null); }
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
    // Going back: From the start once the broadcast so far can be gone back through (and it's playing at the live
    // moment); Back to live, with how far behind, once they have
    const going = live && isVideo && !endShown;
    const behind = $('behind');
    if (behind) behind.textContent = going && liveSeek.behind > 0 ? `${formatTime(liveSeek.behind)} behind` : '';
    $('to-live')?.setAttribute('aria-label', going && liveSeek.behind > 0 ? `Back to live (you're ${formatTime(liveSeek.behind)} behind)` : 'Back to live');
    const shows = new Map<HTMLElement | null, boolean>([
      [$('sound'), soundCta && !endShown],
      [mute, live && isVideo && showing && !muted && !endShown],
      [$('from-start'), going && liveSeek.canSeek && liveSeek.behind === 0 && pstatus === 'playing'],
      [$('to-live'), going && liveSeek.behind > 0],
      [$('heart'), live && roomy && (onAir || !isVideo) && !endShown],
      ...[...root.querySelectorAll<HTMLElement>('[data-full]')].map((b) => [b, !endShown && isVideo && (kind === 'replay' || (live && roomy))] as [HTMLElement, boolean]),
      [$('design'), rail && !!designFace && !endShown],
    ]);
    railChange(shows);
    // "That's the reveal!": whose, and the replay when there's one (until then, when it will be)
    setHidden($('end'), !endShown);
    if (endShown) {
      const kid = (client.state?.kidName || '').trim();
      const t = $('end-text'); if (t) t.textContent = kid ? `Thank you for watching ${kid}'s reveal.` : 'Thank you for watching.';
      const replayReady = endPending?.player?.kind === 'replay';
      setHidden($('end-replay'), !replayReady);
      // (nothing promised once the replay is overdue)
      const waiting = !(replayReady || endPending?.mode === 'idle' || endPending?.replaySoon === false);
      setHidden($('end-wait'), !waiting);
      paintEndLine(waiting);
    } else paintEndLine(false);
    const cc = $('cc-toggle');
    setHidden(cc, !(kind === 'replay' && hasCaptions && isVideo));
    cc?.setAttribute('aria-pressed', String(ccOn));

    // Replay extras
    flag('data-cc', party && kind === 'replay' && hasCaptions && ccOn && isVideo);
    setHidden($('cc'), !root.hasAttribute('data-cc'));
    paintMark();
    paintJump(v?.currentTime ?? 0);
  }

  // The line while the replay is being made (END_LINE_MAX above): drawn every second, the transition between draws
  // makes it glide (every 10 s and no glide for someone who asked for less motion)
  let endLineTimer: ReturnType<typeof setInterval> | undefined;
  let endLineFrom = 0;
  function paintEndLine(on: boolean) {
    const fill = $('end-fill');
    if (!on || !fill) { clearInterval(endLineTimer); endLineTimer = undefined; endLineFrom = 0; return; }
    if (endLineTimer) return;
    endLineFrom = Date.now();
    const draw = () => {
      const ended = Date.parse(client.state?.endedAt || '');
      const from = Number.isFinite(ended) && ended <= Date.now() ? ended : endLineFrom;
      const t = Math.max(0, (Date.now() - from) / 1000);
      fill.style.transform = `scaleX(${(END_LINE_MAX * (1 - Math.exp(-t / END_LINE_TAU_S))).toFixed(4)})`;
    };
    // (the first drawing lands where it should at once, then it glides on)
    fill.style.transition = 'none'; draw(); void fill.offsetWidth; fill.style.transition = '';
    endLineTimer = setInterval(draw, reduced ? 10_000 : 1000);
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
    // (in turn, like every move: what was waiting is dropped, the reveal is where they asked to go)
    seekWant = null; playAfterSeek = false;
    seekVideo(Math.max(0, revealAt - JUMP_LEAD), true);
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
    // (waiting to play on after a scrub, or for the replay's source after Watch the replay, the button says Pause:
    // pressed, it stays paused)
    if (playAfterSeek) { playAfterSeek = false; showPlaying(false); updateDock(); return; }
    if (player.playPending) { player.cancelPlay(); showPlaying(false); return; }
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
    if (kind === 'live') {
      if (muted) soundOn('video');
      // (paused, by the system or otherwise: on again, at the live moment)
      if (video()?.paused) player?.play();
    } else if (kind === 'replay') togglePlay();
  });
  // ── The progress line, by finger or mouse ───────────────────────
  // Anywhere along the line: a tap goes there; a finger moving along it scrubs, the picture following it, the handle
  // grown under it, the video paused meanwhile and playing on when the finger lifts (if it was playing). Up or down, the
  // page scrolls as ever (touch-action: pan-y; the browser then cancels the press and nothing has moved). The slider
  // under it takes the keyboard and screen readers only: its own touch handling differs from browser to browser.
  // A tap on the reveal's star plays from the reveal, exactly, as Jump to the reveal does (the star is drawn on the
  // line: on a short line a minute or more either side of it is under the finger). A press that moves is a drag, star
  // or not
  const onStar = (e: PointerEvent) => {
    const m = $('mark');
    if (!m || m.hidden) return false;
    const r = m.getBoundingClientRect();
    // (its 3px white ring included)
    return Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) <= r.width / 2 + 3;
  };
  const durationOk = () => { const d = video()?.duration ?? NaN; return Number.isFinite(d) && d > 0; };
  // (the handle's centre runs from 16px in to 16px short of the cell's end)
  const fracAt = (x: number) => { const r = cell!.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left - 16) / Math.max(1, r.width - 32))); };
  // Where the finger is, drawn (the handle, the line, the time), and the picture asked to follow (quickly, one move
  // at a time); on the lift only drawn, the exact move follows
  function aimAt(x: number) {
    const v = video();
    if (!v || !scrub || !durationOk()) return;
    const f = fracAt(x);
    scrub.t = f * v.duration;
    shownAt = scrub.t;
    paintAt(scrub.t, v.duration);
    if (seek) { seek.value = String(Math.round(f * 1000)); seek.setAttribute('aria-valuetext', `${formatTime(scrub.t)} of ${formatTime(v.duration)}`); }
    paintLoaded();
  }
  function scrubTo(x: number) {
    aimAt(x);
    if (scrub) seekVideo(scrub.t, false);
  }
  function beginScrub() {
    const v = video();
    if (!v || !scrub || scrub.on) return;
    scrub.on = true;
    cancelAnimationFrame(raf); raf = 0;
    // (touched again while it waited to play on from the last scrub: it was playing, and plays on after this one)
    if (playAfterSeek) { playAfterSeek = false; scrub.wasPlaying = true; }
    if (!v.paused && !v.ended) { scrub.wasPlaying = true; v.pause(); }
  }
  function endScrub(commit: boolean) {
    const s = scrub;
    scrub = null;
    replaybar?.removeAttribute('data-scrub');
    const v = video();
    if (!s || !v || !s.on) return;
    if (commit) seekVideo(s.t, true);
    if (!s.wasPlaying) { showPlaying(!v.paused && !v.ended); return; }
    // (the exact move waiting on one still landing: playing on waits for it too; the button keeps saying Pause)
    if (seekWant) { playAfterSeek = true; updateDock(); } else player?.play();
  }
  cell?.addEventListener('pointerdown', (e) => {
    // (a press whose release never came, its pointer no longer held: over, where it was)
    if (scrub && scrub.id !== e.pointerId && !cell.hasPointerCapture(scrub.id)) endScrub(true);
    if (kind !== 'replay' || !durationOk() || scrub || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const v = video()!;
    scrub = { id: e.pointerId, x0: e.clientX, y0: e.clientY, star: onStar(e), on: false, t: v.currentTime, wasPlaying: false, mouse: e.pointerType === 'mouse' };
    try { cell.setPointerCapture(e.pointerId); } catch { /* (gone already) */ }
    // Held: the handle grows at once, before anything moves
    replaybar?.setAttribute('data-scrub', '');
    // A mouse goes there at once (no page scroll to tell it from); a finger waits to see which way it goes. The slider
    // takes the keyboard's focus from a click, so the arrows work next
    if (scrub.mouse) { cell.dataset.pointer = ''; seek?.focus({ preventScroll: true }); if (!scrub.star) { beginScrub(); scrubTo(e.clientX); } }
  });
  cell?.addEventListener('pointermove', (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    // (a mouse moving with no button down: its release went elsewhere, another window or a menu)
    if (scrub.mouse && e.buttons === 0) { endScrub(scrub.on); return; }
    if (!scrub.on) {
      // (a scrub once it goes sideways more than up or down: a swipe up that drifts a little is the page's scroll)
      const dx = Math.abs(e.clientX - scrub.x0), dy = Math.abs(e.clientY - scrub.y0);
      if (dx <= (scrub.star ? 6 : 4) || dx <= dy) return;
      scrub.star = false;
      beginScrub();
    }
    scrubTo(e.clientX);
  });
  cell?.addEventListener('pointerup', (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    if (!scrub.on && scrub.star) { endScrub(false); jumpToReveal(); return; }
    if (!scrub.on) {
      // A tap: there, exactly, playing on if it was (nothing paused for it)
      const v = video();
      endScrub(false);
      if (v && durationOk()) {
        const t = fracAt(e.clientX) * v.duration;
        shownAt = t; paintAt(t, v.duration);
        if (seek) seek.value = String(Math.round((t / v.duration) * 1000));
        seekVideo(t, true);
      }
      return;
    }
    aimAt(e.clientX);
    endScrub(true);
  });
  // The browser took the press for a page scroll (nothing moved yet), or the system took it mid-drag (it ends where it is)
  cell?.addEventListener('pointercancel', (e) => { if (scrub && e.pointerId === scrub.id) endScrub(true); });
  cell?.addEventListener('lostpointercapture', (e) => { if (scrub && e.pointerId === scrub.id) endScrub(true); });
  // A mouse press on the line keeps the slider's focus (taken at the press, above): the browser would otherwise move it
  // to the stage once the press is over, and the arrows would scroll the page instead of moving the video
  cell?.addEventListener('mousedown', (e) => e.preventDefault());
  // (its focus ring is for the keyboard: none after a click on the line, until a key is pressed there)
  seek?.addEventListener('keydown', () => { if (cell) delete cell.dataset.pointer; });
  seek?.addEventListener('blur', () => { if (cell) delete cell.dataset.pointer; });
  // The keyboard and screen readers (the slider's own Home, End, Page Up and Down; the arrows are below, 5 seconds)
  seek?.addEventListener('input', () => {
    const v = video();
    if (!v || !durationOk()) return;
    seekVideo((Number(seek.value) / 1000) * v.duration, true);
  });
  // The buttons under the replay give under a press and spring back (LiveStage.astro)
  root.querySelectorAll<HTMLElement>('[data-s="play"], [data-s="replaybar"] .bar__btn').forEach((b) => {
    const off = () => b.removeAttribute('data-press');
    b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button === 0) b.setAttribute('data-press', ''); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, off);
  });
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
      // (from where it's going: a key held down steps on from the last step, not from where the picture has got to)
      const from = seekWant?.t ?? v.currentTime;
      seekVideo(Math.max(0, Math.min(v.duration, from + (back ? -5 : 5))), true);
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
      applyCorner();
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
      : pstatus === 'playing' || pstatus === 'buffering' || (!!scrub?.on && scrub.wasPlaying) || playAfterSeek);
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
  // ── The small player's corner: dragged, it springs to the nearest one (LiveStage.astro data-corner) ──
  const CORNER_KEY = 'soard-live-corner';
  let corner = (() => { try { return sessionStorage.getItem(CORNER_KEY) || ''; } catch { return ''; } })();
  const applyCorner = () => { if (picture) picture.dataset.corner = corner || (phone.matches ? 'tr' : 'br'); };
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  let dragged = false;
  picture?.addEventListener('pointerdown', (e) => {
    if (!docked || pinned || e.button !== 0 || (e.target as Element).closest('[data-s="undock"]')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  });
  picture?.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !picture) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    // (a tap wobbles a little: only a real move is a drag)
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    if (!drag.moved) { drag.moved = true; try { picture.setPointerCapture(e.pointerId); } catch { /* gone */ } picture.classList.add('is-dragging'); }
    picture.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id || !picture) return;
    const was = drag;
    drag = null;
    if (!was.moved) return;
    // (the tap that ends a drag isn't a tap to go back to the video)
    dragged = true;
    setTimeout(() => { dragged = false; }, 0);
    const from = picture.getBoundingClientRect();
    corner = `${from.top + from.height / 2 < innerHeight / 2 ? 't' : 'b'}${from.left + from.width / 2 < innerWidth / 2 ? 'l' : 'r'}`;
    try { sessionStorage.setItem(CORNER_KEY, corner); } catch { /* private mode */ }
    picture.style.transform = '';
    picture.classList.remove('is-dragging');
    applyCorner();
    // From where it was let go, a little spring into its corner
    const to = picture.getBoundingClientRect();
    if (!reduced) picture.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' });
  };
  picture?.addEventListener('pointerup', endDrag);
  picture?.addEventListener('pointercancel', endDrag);

  // Tapping the mini player takes you back to it
  picture?.addEventListener('click', (e) => {
    if (dragged) { e.preventDefault(); e.stopPropagation(); return; }
    if (!docked || (e.target as Element).closest('[data-s="undock"]')) return;
    e.preventDefault();
    e.stopPropagation();
    screen?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }, true);

  return {
    update,
    get party() { return party; },
    get playingLive() { return isPlayingLive(); },
    get ended() { return endShown; },
    endsWith(mode: StageMode) { return endShown || endsNow({ mode }); },
    /** The rail's way into the room's design: its face (a picture's address), or '' for none (no design, or the room
     *  beside the video already shows it) */
    setDesign(face: string) {
      if (face === designFace) return;
      designFace = face;
      const img = $('design-face') as HTMLImageElement | null;
      if (img && face && img.getAttribute('src') !== face) img.src = face;
      paint();
    },
    pin(on: boolean, where: 'give' | 'design' = 'give') {
      pinned = on;
      if (on) root.dataset.pin = where; else delete root.dataset.pin;
      updateDock();
    },
    destroy() {
      paintEndLine(false);
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
