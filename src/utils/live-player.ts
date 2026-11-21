/**
 * live-player.ts — the video inside the live page's frame
 * ========================================================
 * Plays the Cloudflare Stream feed in a plain <video> (hls.js wherever the
 * browser has Media Source, and for the live reveal on iPhones with Managed
 * Media Source; the browser's own HLS for older iPhones and an iPhone's replay)
 * instead of the Stream iframe, so the page can do what an iframe can't:
 *
 *   - start muted (browsers allow nothing else) and offer sound with one tap
 *   - size the frame to the real picture: the crew shoots portrait, but a
 *     phone turned sideways still fits instead of letterboxing
 *   - tell viewers the truth when the camera drops or hasn't connected yet,
 *     instead of a black box under a LIVE badge
 *
 * Nothing is drawn on the picture: the page's own controls sit beside and
 * under it (live-stage.ts), so even a replay has no native control bar.
 *
 * LIVE (Peter, Nov 18 2026, after that morning's test broadcasts):
 *   - Viewers watch LIVE_DELAY_S behind the phone (Stream's newest piece), every viewer the same: a phone signal that
 *     slows without dropping never shows, and the end of a reveal plays out in full before the page moves on.
 *   - The whole broadcast so far can be watched from its start (Stream's DVR playlist, `dvrEnabled=true`), so a
 *     late arrival can go back to the beginning and come back to the live moment (seekToStart, toLive).
 *   - Nothing ever plays twice, and nothing is skipped. On Nov 18 the page replayed its last few seconds over and over
 *     when the feed stalled (hls.js moving the picture back to "catch up"), then played the whole broadcast again from
 *     0:00 once Stream had closed the recording; during Dylan's reveal that evening a viewer on a phone saw it go back
 *     about 20 s, three times. So the live picture has one owner, this player (placePicture): hls.js and Safari load
 *     and play it, but a move hls.js makes by itself is refused unless it's a small step forward over a gap, and a move
 *     back over what was shown that Safari makes by itself is undone. Only the viewer goes back (From the start, the
 *     phone's own full-screen controls or lock screen), and every start-over goes on from exactly where they were
 *     (`seen`: the recording, and the furthest second of it shown). A recording Stream has closed is played only up to
 *     its last frame, never from its start again.
 * What Stream does (measured on the real feed, Nov 18 and 19 2026): the live input's own playlist names the recording
 * in its piece addresses (/<video id>/video/...); a recording's DVR playlist starts at its first piece and only grows,
 * so a place in it (seconds from its start) is the same for every player; DVR doesn't work with low latency (HTTP
 * 500), and the plain live playlist keeps only about 18 s, so the delay needs DVR. When the phone's connection drops,
 * Stream closes the recording within seconds, even with recording.timeoutSeconds at 120 (its DVR playlist gains an
 * end; the input's playlist answers 204), and the phone back starts a new recording about 13 s later; a clean stop
 * with a quick reconnect can stay one recording (Stream bridges the gap with the last frame). After a clean stop
 * Stream keeps the recording open for recording.timeoutSeconds, and meanwhile its DVR playlist stays two pieces (about
 * 4 s) short of the end: they come, with the end, when it closes, 17 s after the stop at 0 (the "SOARD reveals" input
 * since Nov 21 2026) and 2 min 2 s after it at 120 (measured Nov 20 2026). The player holds there and plays them then;
 * the page waits for them (live-stage.ts isPlayingLive).
 * A feed that isn't there yet (204/404) is looked at again every few seconds for as long as the page keeps the
 * player mounted. If neither playback path exists, the Stream iframe takes over.
 */
import type { LivePlayer } from './live-client';

export type PlayerStatus =
  | 'connecting'   // loading, nothing on screen yet
  | 'waiting'      // the feed isn't there yet (camera not connected)
  | 'playing'
  | 'buffering'    // a short stall
  | 'reconnecting' // was playing, then the feed dropped or stalled
  | 'blocked'      // the browser refused to autoplay (iPhone Low Power Mode): needs a tap
  | 'paused'       // also: a replay loaded and waiting for its first tap
  | 'ended'        // replay finished
  | 'iframe';      // Stream iframe fallback, which handles everything itself

/** Live: what the page's going-back controls need */
export interface LiveSeek {
  /** The broadcast so far can be gone back through (at least SEEK_MIN_S of it before the live moment) */
  canSeek: boolean;
  /** Whole seconds this viewer is behind the usual delay; 0 at the live moment */
  behind: number;
}

export interface PlayerHandle {
  readonly video: HTMLVideoElement | null;
  readonly status: PlayerStatus;
  /** Live: see LiveSeek */
  readonly canSeek: boolean;
  readonly behind: number;
  /** Live: the recording this viewer was on has closed (the phone stopped), they've seen its last frame, and no newer one is on */
  readonly feedEnded: boolean;
  /** Live: the feed is a recording Stream has already closed that this viewer never watched (nothing to play live) */
  readonly closed: boolean;
  /**
   * Live: holding the last frame for more of the feed, or starting over to fetch it (Reconnecting); false once it plays
   * again or the last frame of a closed recording has played (then it only looks for a newer recording)
   */
  readonly waitingForMore: boolean;
  setMuted(muted: boolean): void;
  play(): void;
  /** A play asked for, called off by the video being reset as its source came, waiting to go once it can play */
  readonly playPending: boolean;
  /** Don't play when it can after all (pause pressed while it waits) */
  cancelPlay(): void;
  /** Live: what this player has been through (tests, and the reveal's health numbers) */
  readonly health: PlayerHealth;
  /** Live: to the first second of this broadcast's recording, playing on from there (no catching up, no jump to live) */
  seekToStart(): void;
  /** Live: back to the live moment (the usual delay) */
  toLive(): void;
  destroy(): void;
}

/** Live: what a viewer's player has been through */
export interface PlayerHealth {
  /** Seconds behind the recording's newest piece at the first picture (null: no picture yet) */
  startBehind: number | null;
  /** Times the last frame was held (Reconnecting), and how long in all */
  holds: number;
  heldMs: number;
  /** Moves of the live picture that hls.js or Safari made by themselves, refused or undone */
  refused: number;
  /** Start-overs, other than going on to a newer recording when one closes (that's the feed, not the player) */
  restarts: number;
  /** What plays it: hls.js on Media Source ('hls'), hls.js on an iPhone's Managed Media Source ('mms'), Safari's own player ('native'), Stream's own iframe */
  engine: 'hls' | 'mms' | 'native' | 'iframe' | null;
  /**
   * Milliseconds from the moment there was something to play (the camera live and the usual delay's worth there) to
   * the first picture (null: none yet). "Waiting for the camera" and the start's own wait for the delay aren't in it
   */
  firstMs: number | null;
  /** Milliseconds there has been something to play without a picture yet (null: nothing to play yet; once the picture came, firstMs) */
  waitedMs: number | null;
  /** Times an iPhone went over from hls.js to Safari's own player */
  fallbacks: number;
  /** The engine's own fatal errors */
  errors: number;
}

interface Options {
  player: LivePlayer;
  onStatus?: (status: PlayerStatus) => void;
  /** The picture's real size, once known (and again if the phone turns) */
  onSize?: (width: number, height: number) => void;
  onMuted?: (muted: boolean) => void;
  /** Live: canSeek changed, behind crossed 0, or (while behind) once a second */
  onLive?: (s: LiveSeek) => void;
  /** Live: once, when feedEnded becomes true */
  onFeedEnd?: () => void;
  /** Live: waitingForMore changed */
  onWaitingForMore?: (waiting: boolean) => void;
}

/** Live: how far behind the phone viewers watch (Peter, Nov 18 2026: "about 20 seconds") */
export const LIVE_DELAY_S = 20;
/** Live: further behind than this, and not by choice, the picture jumps to the usual delay (the player's own rule: hls.js never moves the live picture) */
const LIVE_MAX_BEHIND_S = LIVE_DELAY_S + 30;
/** Live: within this many seconds of the usual delay counts as at the live moment (the delay's own drift never shows) */
const AT_LIVE_SLACK_S = 6;
/** Live: going back is offered once the broadcast reaches this far before the live moment */
const SEEK_MIN_S = 30;
/** Live: at most this much faster to catch up after a dip, too gently to notice (the sound keeps its pitch) */
const REBUILD_RATE = 0.97;
const REBUILD_BELOW_S = LIVE_DELAY_S - 5;
const REBUILD_TO_S = LIVE_DELAY_S - 1;
/**
 * Live: later than the usual delay by more than a few seconds (the viewer's own signal, a phone busy for a moment), the
 * picture plays this much faster until it's back, just as gently (the sound keeps its pitch). Measured on the real feed,
 * Nov 19 2026: without it viewers drifted to 25 to 32 s behind and stayed there
 */
const CATCH_UP_RATE = 1.03;
const CATCH_UP_ABOVE_S = LIVE_DELAY_S + 3;
const CATCH_UP_TO_S = LIVE_DELAY_S + 1;
/** Live: the only move hls.js may make by itself once the picture is up: forward, over a gap in what's loaded, by at most this */
const ENGINE_STEP_MAX_S = 3;
/** Live, Safari's own player: how often it reads the recording's playlist for its newest second (Safari's own seekable end trails that by three pieces or more) */
const NATIVE_EDGE_MS = 4000;
/** Looks at the feed in a row Stream doesn't answer as it should before the plain live playlist is played instead */
const LOOK_FAILS_MAX = 3;
/** A stall this long reads as the feed dropping, not a hiccup */
const STALL_MS = 4000;
/** The browser's own HLS (iPhone) can sit silently on an empty playlist; give it this long to show a frame */
const NATIVE_START_MS = 12_000;
/** An iPhone on hls.js (Managed Media Source) with the feed's playlist there but no picture after this long goes back to Safari's own player */
const MANAGED_START_MS = 20_000;
/** An iPhone on hls.js that has played goes back to Safari's own player after this many of hls.js's own fatal errors this close together */
const MANAGED_LATER_ERRORS = 3;
const MANAGED_LATER_WINDOW_MS = 2 * 60_000;
/** Picture stuck this long while "playing": look at the feed (start over only if it has gone on without the picture) */
const FROZEN_MS = 12_000;
const RETRY_MS = 4000;
const RETRY_SLOW_MS = 10_000;
/** Live: a move of the picture back by more than this over what this player has shown, at a stall: the feed stopped */
const BACK_OVER_SHOWN_S = 0.5;
/** After a stop, the recording has to reach this far past where the viewer was before the player starts again */
const RESUME_NEW_S = 1;
/** A recording newer than the one the viewer was on, and no longer than this: watched from its first second (nothing was filmed between) */
const NEW_RECORDING_FROM_START_S = LIVE_DELAY_S + 30;
/**
 * Live: a viewer's first start waits until the recording reaches this far (the usual delay and a little more), then
 * starts exactly LIVE_DELAY_S behind its newest moment. Peter's test, Nov 18 2026: viewers there before the video
 * started were started by the player's own guess at the live moment, only 5 to 15 s behind, and stayed there; now
 * "Waiting for the camera" stays up those few seconds longer instead (the crew films before the reveal moment, so
 * nobody misses anything)
 */
const FIRST_START_S = LIVE_DELAY_S + 2;
/** Reading Stream's playlists before a start: past this, start anyway and let the player find out */
const FEED_CHECK_MS = 5000;

/** A Stream recording's id, from the piece addresses in its playlist (`/<32 hex>/video/...`), or null */
export function recordingIn(text: string): string | null {
  return /\/([0-9a-f]{32})\/(?:video|audio)\//.exec(text)?.[1] ?? null;
}

/** A media playlist's length in seconds (its whole pieces) and whether it has ended (a closed recording) */
export function playlistSpan(text: string): { total: number; ended: boolean } {
  let total = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) total += parseFloat(line.slice(8)) || 0;
  }
  return { total, ended: /#EXT-X-ENDLIST/.test(text) };
}

type HlsClass = typeof import('hls.js').default;
let hlsModule: Promise<HlsClass> | null = null;
// The full build, never hls.js/light: Stream sends the sound as its own audio rendition (EXT-X-MEDIA TYPE=AUDIO),
// which only the full build plays (the light build played the picture in silence, Nov 17 2026). The full build
// also does the DVR playlist's EXT-X-DEFINE variables.
const loadHls = () => (hlsModule ||= import('hls.js').then((m) => m.default));

export function streamUrls(p: LivePlayer) {
  const base = `https://customer-${p.customerCode}.cloudflarestream.com`;
  const host = `${base}/${p.uid}`;
  const hls = p.src || `${host}/manifest/video.m3u8`;
  return {
    hls,
    /** Live: the input's own playlist (which recording is on, and whether one is) */
    input: p.kind === 'live' && !p.src ? `${host}/manifest/video.m3u8` : null,
    /** Live: a recording's whole-broadcast (DVR) playlist */
    dvr: (video: string) => `${base}/${video}/manifest/video.m3u8?dvrEnabled=true`,
    poster: p.kind === 'replay' && !p.src ? `${host}/thumbnails/thumbnail.jpg` : '',
    iframe: `${host}/iframe?${p.kind === 'live' ? 'autoplay=true&muted=true' : 'preload=metadata'}`,
  };
}

/** What a look at the live feed found */
interface FeedLook {
  /** Something to play: the address, and where to start (seconds into the recording; -1: the usual delay) */
  go: { src: string; video: string | null; startAt: number } | null;
  /** The recording on is closed (and, for this viewer, played to its end or never watched) */
  closed: boolean;
}

export function mountPlayer(container: HTMLElement, opts: Options): PlayerHandle {
  const p = opts.player;
  const live = p.kind === 'live';
  const urls = streamUrls(p);
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', ''); // iOS before 10
  video.playsInline = true;
  // Live starts muted so it can start on its own; a replay waits for a tap and plays with sound.
  // iPhone checks the muted *attribute* before it allows autoplay, so set both.
  if (live) { video.setAttribute('muted', ''); video.defaultMuted = true; }
  video.muted = live;
  video.autoplay = live;
  video.preload = live ? 'auto' : 'metadata';
  video.controls = false;
  if (urls.poster) video.poster = urls.poster;
  video.setAttribute('aria-label', live ? 'Live reveal video' : 'Reveal replay');
  container.appendChild(video);

  let status: PlayerStatus = 'connecting';
  let everPlayed = false;
  let dead = false;
  let restarting = false;
  let pending = false; // a retry is scheduled
  let failures = 0;
  // An iPhone (Managed Media Source, no classic one) plays the live reveal through hls.js (start(), below). If hls.js
  // can't play there, this page goes back to Safari's own player, which every iPhone used until Nov 17 2026 (later
  // behind the moment, but playing):
  //   - the feed's playlist is there and no picture has come in MANAGED_START_MS (hls.js can sit on a source that
  //     refuses it without ever giving up), waiting on as long as the page asks for a tap (Low Power Mode)
  //   - a fatal error of hls.js's own before the playlist is read, or two before the picture ever played
  //   - MANAGED_LATER_ERRORS of them within MANAGED_LATER_WINDOW_MS once it has played
  // Its own: decoding, packaging, anything but the network. The network is the phone's signal or "nothing live yet",
  // the same on either player, so it counts for nothing (it would send iPhones the slow way for the rest of a reveal).
  const managedOnly = !('MediaSource' in window) && 'ManagedMediaSource' in window;
  let hlsTrouble = 0;
  let laterTrouble: number[] = [];
  let nativeOnly = false;
  let managedTimer: ReturnType<typeof setTimeout> | undefined;
  // (straight to it, keeping "connecting" or "reconnecting" on screen: nothing is wrong with the camera)
  const toSafari = () => {
    if (dead) return;
    if (!nativeOnly) health.fallbacks++;
    nativeOnly = true;
    stopEngine();
    pending = true;
    retryTimer = setTimeout(start, 0);
  };
  let hls: InstanceType<HlsClass> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let nativeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTime = -1;
  let lastMove = Date.now();
  // Live: where this viewer is. `seen` = the recording and the furthest second of it shown (at the live moment), or
  // the second on screen (gone back by choice), so a start-over goes on from exactly there; `playing` = the recording
  // the running player has.
  let seen: { video: string | null; pos: number } | null = null;
  let playingVideo: string | null = null;
  let furthest = 0; // furthest second this player has shown (its own timeline)
  let chosen = false; // the viewer went back on purpose
  let selfSeek = false; // a seek of our own is under way
  let selfSeekTimer: ReturnType<typeof setTimeout> | undefined;
  let feedEnded = false;
  let closed = false;
  let looking = false; // the watchdog is reading the feed
  let canSeek = false;
  let behind = 0;
  let lastReport = 0;
  let nativePlace: (() => void) | null = null; // Safari's own player: put the picture in place once it has loaded
  let startToken = 0; // the start under way (start)
  let lookFails = 0; // looks at the feed in a row that Stream didn't answer as it should (lookAtFeed)
  let rebuilding: '' | 'slower' | 'faster' = ''; // live: playing a touch slower to rebuild the cushion, or faster to catch up (rebuild)
  let holding = false; // live: holding the last frame until the feed has the usual delay's worth again
  let forMore = false; // live: held for more of the feed, through any start-over to fetch it (waitingForMore)
  const setForMore = (on: boolean) => { if (forMore !== on) { forMore = on; opts.onWaitingForMore?.(on); } };
  let holdTimer: ReturnType<typeof setInterval> | undefined;
  let holdLooks = 0;
  let heldSince = 0;
  let returnTo: number | null = null; // live, Safari's own player: the second to go back to once it can (a move back undone)
  let fresh = true; // live: a start's first placing of the picture is the engine's to make (hls.js puts it on its start piece)
  let ownPause = false; // live: the pause under way is one of ours (a hold)
  let viewerPaused = false; // live: the last pause was the viewer's or the phone's, not ours
  let nativeEdge: number | null = null; // live, Safari's own player: the newest second of its recording, read every NATIVE_EDGE_MS
  let nativeEdgeTimer: ReturnType<typeof setInterval> | undefined;
  const mountedAt = Date.now();
  let playableAt: number | null = null; // live: when there was first something to play
  // Waits before the first picture that aren't the player's: Tap to watch (Low Power Mode refusing to start it) and the
  // tab out of sight (the browser holds the video): left out of the time to the first picture
  let notMine = 0;
  let notMineSince: number | null = null;
  const othersWait = () => status === 'blocked' || document.visibilityState === 'hidden';
  const noteWait = () => {
    if (health.firstMs != null) return;
    const now = Date.now();
    if (othersWait()) { if (notMineSince == null) notMineSince = now; }
    else if (notMineSince != null) { notMine += now - notMineSince; notMineSince = null; }
  };
  const waitedSoFar = () => (playableAt == null ? null : Math.max(0, Date.now() - playableAt - notMine - (notMineSince != null ? Date.now() - notMineSince : 0)));
  document.addEventListener('visibilitychange', noteWait);
  const health: PlayerHealth = { startBehind: null, holds: 0, heldMs: 0, refused: 0, restarts: 0, engine: null, firstMs: null, waitedMs: null, fallbacks: 0, errors: 0 };

  const set = (s: PlayerStatus) => {
    if (s === status || dead) return;
    status = s;
    noteWait();
    opts.onStatus?.(s);
  };

  // A play the browser called off because the video's source came (or changed) after it was asked for: asked again as
  // soon as the new source can play. Watch the replay mounts the replay and plays it in the same tap, before hls.js has
  // attached its source; attaching resets the element, which pauses it and refuses the ask (AbortError), and it sat at
  // 0:00 until the bar's play was pressed (Chrome and the other Media Source browsers; Peter's test, Nov 18 2026). The
  // tap's own play() still goes at once: that is what lets the second one play with sound.
  // Only a reset counts: a pause pressed while it was starting refuses the play the same way (AbortError, nothing
  // loaded), but always fires 'pause' first, and a reset never does; so a play refused with no pause since it was asked
  // for was called off by a reset (a viewer's play then pause before it had loaded used to start it anyway, the review).
  // (a pause() followed in the same task by a source change loses its 'pause' event, so it would be taken for a reset:
  // never pause and reset in one go; nothing does today, Chrome and WebKit both measured, Nov 19 2026)
  let playAborted = false;
  let pauses = 0;
  function tryPlay() {
    playAborted = false;
    const asked = pauses;
    const pr = video.play();
    pr?.catch((err: DOMException) => {
      if (dead) return;
      if (err?.name === 'NotAllowedError') set('blocked');
      else if (err?.name === 'AbortError' && video.paused && video.readyState === 0 && pauses === asked) playAborted = true;
    });
  }

  // ── Live: the picture has one owner ──
  // hls.js and Safari load and play the live picture; only this player moves it (a start-over, the live moment, the
  // viewer's own going back). hls.js moves it by setting currentTime, so on the live video that goes through
  // engineMove: the first placing after each start, and a small step forward over a gap in what's loaded, go through;
  // any other move is refused. A move back means it has run out where the viewer is (Nov 18 2026: hls.js moving the
  // picture back to "catch up" replayed the same seconds over and over; that evening a phone viewer saw about 20 s
  // again, three times): the last frame is held until the feed has more, then it plays on from that very frame. Safari's
  // own player moves the picture without currentTime; the 'seeking' listener below undoes those moves.
  const timeProp = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
  const pictureAt = () => timeProp.get!.call(video) as number;
  const placePicture = (t: number) => { timeProp.set!.call(video, t); };
  if (live) {
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      enumerable: true,
      get: pictureAt,
      set: (t: number) => engineMove(+t),
    });
  }
  function engineMove(t: number) {
    const now = pictureAt();
    // (over a gap: from little or nothing in hand to loaded picture further on, a piece that never came)
    const overGap = t > now && ahead() < 0.5 && loadedAt(t);
    // (the plain-playlist fallback has no recording to place by: forward, any size, as its window slides)
    if (fresh || (t >= now - 0.05 && (!playingVideo || t - now <= ENGINE_STEP_MAX_S || overGap))) { placePicture(t); return; }
    health.refused++;
    // (back because it has run out where the viewer is: hold that frame. With picture still in hand it plays on, and
    // the stall, if one comes, holds it there)
    if (t < now && everPlayed && !holding && !chosen && ahead() < 0.5) hold();
  }

  let lastPlaced = 0; // live: where the player last put the picture itself
  /** A move of our own: the guard below leaves it alone */
  function seekTo(t: number) {
    lastPlaced = t;
    selfSeek = true;
    clearTimeout(selfSeekTimer);
    selfSeekTimer = setTimeout(() => { selfSeek = false; }, 1500); // (if the browser fires no seeked)
    placePicture(t);
  }

  function stopEngine() {
    startToken++;
    nativePlace = null;
    holding = false;
    clearInterval(holdTimer);
    clearTimeout(retryTimer);
    clearTimeout(stallTimer);
    clearTimeout(nativeTimer);
    clearTimeout(managedTimer);
    clearInterval(nativeEdgeTimer);
    nativeEdge = null;
    ownPause = false;
    returnTo = null;
    restarting = true;
    if (hls) { try { hls.destroy(); } catch { /* already gone */ } hls = null; }
    if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
    restarting = false;
  }

  function restart(delay = failures > 15 ? RETRY_SLOW_MS : RETRY_MS, counted = true) {
    if (dead) return;
    failures++;
    if (everPlayed && counted) health.restarts++;
    stopEngine();
    set(everPlayed ? 'reconnecting' : 'waiting');
    pending = true;
    retryTimer = setTimeout(start, delay);
  }

  function useIframe() {
    stopEngine();
    container.innerHTML = '';
    const f = document.createElement('iframe');
    f.src = urls.iframe;
    f.title = live ? 'Live reveal video' : 'Reveal replay';
    f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    f.setAttribute('allowfullscreen', 'true');
    container.appendChild(f);
    set('iframe');
  }

  /** Live: the recording ended for this viewer (seen to its last frame, nothing newer on) */
  function endFeed() {
    if (feedEnded || !live) return;
    feedEnded = true;
    opts.onFeedEnd?.();
  }

  /**
   * Live: is there something to play, from where? The input's playlist says whether a recording is on and which
   * (Stream answers 204 with none: no camera yet, or the last one has closed); a recording's DVR playlist says how
   * far it reaches and whether it has closed.
   *   - the recording this viewer was on, still on: on from exactly where they were, once there's enough past it
   *     (the usual delay's worth at the live moment, so the next drop is hidden too; a moment's worth for a viewer
   *     who went back)
   *   - the recording this viewer was on, closed: whatever of it they haven't seen yet, then the feed has ended for
   *     them, unless a newer recording is on (the phone back after Stream closed the last one): that one from its
   *     first second if it's short (nothing was filmed between), else the live moment, once it has the usual
   *     delay's worth
   *   - first look: the live moment; a recording already closed is never played live (the replay follows)
   * Anything unexpected (an error, no answer in FEED_CHECK_MS) lets the player try, as before.
   */
  // Stream's playlists, read by the player itself (never from the browser's cache: Stream lets a closed recording's
  // playlists be kept 10 minutes)
  async function readFeed(u: string, signal: AbortSignal) {
    const r = await fetch(u, { signal, cache: 'no-store' });
    return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : '' };
  }
  /** A playlist, through its master's first variant (every variant has the same pieces) */
  async function readMedia(u: string, signal: AbortSignal) {
    const res = await readFeed(u, signal);
    if (!res.ok || !res.text.includes('#EXT-X-STREAM-INF')) return res;
    const lines = res.text.split('\n').map((l) => l.trim());
    const at = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
    const uri = lines.slice(at + 1).find((l) => l && !l.startsWith('#'));
    return uri ? readFeed(new URL(uri, u).href, signal) : { status: 0, ok: false, text: '' };
  }
  /** A recording's DVR playlist: how far it reaches, whether it has closed (null: unreadable) */
  async function reachOf(rec: string, signal: AbortSignal) {
    const res = await readMedia(urls.dvr(rec), signal);
    return res.ok && res.text.includes('#EXTM3U') ? playlistSpan(res.text) : null;
  }

  async function lookAtFeed(): Promise<FeedLook> {
    if (!urls.input) return { go: { src: urls.hls, video: null, startAt: -1 }, closed: false };
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), FEED_CHECK_MS);
    const media = (u: string) => readMedia(u, stop.signal);
    const reach = (rec: string) => reachOf(rec, stop.signal);
    const play = (rec: string | null, startAt: number): FeedLook => {
      lookFails = 0;
      return { go: { src: rec ? urls.dvr(rec) : urls.hls, video: rec, startAt }, closed: false };
    };
    // Stream not answering as it should (an error, no answer in FEED_CHECK_MS, no DVR playlist): look again in a few
    // seconds, and only after LOOK_FAILS_MAX looks in a row play the plain live playlist (no going back, and a start-
    // over can't know where the viewer was) rather than nothing
    const unsure = (): FeedLook => (++lookFails >= LOOK_FAILS_MAX ? play(null, -1) : { go: null, closed: false });
    const need = chosen ? RESUME_NEW_S : LIVE_DELAY_S - 2;
    try {
      // Which recording is on (null: none)
      const input = await media(urls.input);
      let rec: string | null = null;
      if (input.ok && input.text.trim()) {
        rec = recordingIn(input.text);
        if (!rec) return unsure();
      } else if (input.status !== 204 && input.status !== 404 && !(input.ok && !input.text.trim())) {
        return unsure();
      }
      // The recording this viewer was on, if it isn't the one on now: it has closed
      let mineEnded = false;
      if (seen?.video && seen.video !== rec) {
        const mine = await reach(seen.video);
        if (mine && mine.total > seen.pos + RESUME_NEW_S) return play(seen.video, seen.pos); // its last moments, not yet seen
        mineEnded = !!mine?.ended;
      }
      lookFails = 0;
      if (!rec) return { go: null, closed: mineEnded };
      const span = await reach(rec);
      if (!span) return unsure();
      if (seen && seen.video === rec) {
        if (span.total >= seen.pos + need) return play(rec, seen.pos);
        if (span.ended && span.total > seen.pos + RESUME_NEW_S) return play(rec, seen.pos);
        return { go: null, closed: span.ended };
      }
      if (span.ended) return { go: null, closed: true }; // a closed recording is never played as live
      // A recording (the first, or a newer one) starts once it has the usual delay's worth and a little more, from
      // exactly the usual delay behind its newest moment (never the player's own guess, which on a young recording
      // landed only a few seconds behind): a viewer there from the very start sits the full delay behind too. A newer
      // one plays from its first second if it's short (nothing was filmed between)
      if (seen) {
        if (span.total < need) return { go: null, closed: false };
        return play(rec, span.total <= NEW_RECORDING_FROM_START_S ? 0 : Math.max(0, span.total - LIVE_DELAY_S));
      }
      if (span.total < FIRST_START_S) return { go: null, closed: false };
      return play(rec, Math.max(0, span.total - LIVE_DELAY_S));
    } catch {
      return unsure();
    } finally {
      clearTimeout(timer);
    }
  }

  function viaNative(src: string, startAt: number) {
    // (hls.js turns AirPlay off for Managed Media Source; Safari's own player has it)
    video.disableRemotePlayback = false;
    video.src = src;
    if (!live) return;
    // Where to start: where the viewer was, or the usual delay behind the newest moment (Safari picks less). Safari may
    // have no end for it yet when the playlist first loads (it reported Infinity, and the picture was put there): then
    // it waits for one, as the picture loads
    nativePlace = () => {
      if (video.readyState < 1) return; // (a place set before Safari has the picture's details can be dropped)
      if (startAt >= 0) { nativePlace = null; seekTo(startAt); return; }
      // (the plain playlist, no recording to place by: only before the picture is up, never back over what was shown)
      if (!fresh) { nativePlace = null; return; }
      const end = newestSecond();
      if (end == null) return;
      nativePlace = null;
      const s = video.seekable;
      seekTo(Math.max(s.length ? s.start(0) : 0, end - LIVE_DELAY_S));
    };
    video.addEventListener('loadedmetadata', () => nativePlace?.(), { once: true });
    video.addEventListener('progress', function place() { if (nativePlace) nativePlace(); else video.removeEventListener('progress', place); });
    // Safari's own player then puts a live picture at its own live point once it has the first pieces, over ours: on
    // iPhone Simulator Safari (Nov 19 2026) a new recording placed at 0 started at 10.7 to 14.9 s, its first seconds
    // skipped, with the player before this too. Until the picture is up, put it back where it belongs (a few times at most)
    if (startAt >= 0) {
      const token = startToken;
      const kinds = ['timeupdate', 'durationchange', 'loadeddata', 'canplay'];
      let tries = 0;
      const off = () => { for (const k of kinds) video.removeEventListener(k, keep); };
      function keep() {
        if (dead || token !== startToken || !fresh || tries >= 4) { off(); return; }
        if (nativePlace || video.readyState < 1) return; // (not placed by us yet)
        // (where the player last put it: the start, or the viewer's own move since, Back to live or the lock screen)
        if (Math.abs(pictureAt() - lastPlaced) > 0.5) { tries++; seekTo(lastPlaced); }
      }
      for (const k of kinds) video.addEventListener(k, keep);
    }
    if (playingVideo) watchNativeEdge(playingVideo);
    tryPlay();
    // Safari may neither error nor play while the camera is off; start over until a frame shows. A refused autoplay
    // (Low Power Mode) isn't the camera: wait on the tap, then start counting again
    const watchNative = () => {
      nativeTimer = setTimeout(() => {
        if (dead || video.readyState >= 2) return;
        if (status === 'blocked') watchNative(); else restart();
      }, NATIVE_START_MS);
    };
    watchNative();
  }

  /**
   * Live, Safari's own player: the newest second of the recording, from its own playlist every NATIVE_EDGE_MS. Safari's
   * seekable end trails it by three pieces or more, so measured from there the cushion looked 8 s short: the picture
   * held too soon and played slower all the way through (measured, Nov 19 2026)
   */
  function watchNativeEdge(rec: string) {
    clearInterval(nativeEdgeTimer);
    nativeEdge = null;
    const token = startToken;
    const readEdge = async () => {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), FEED_CHECK_MS);
      try {
        const sp = await reachOf(rec, stop.signal);
        if (sp && token === startToken && !dead) { nativeEdge = sp.total; nativePlace?.(); report(); }
      } catch { /* the next read */ } finally { clearTimeout(timer); }
    };
    readEdge();
    nativeEdgeTimer = setInterval(readEdge, NATIVE_EDGE_MS);
  }

  function viaHls(Hls: HlsClass, src: string, startAt: number) {
    const h = new Hls({
      enableWorker: false, // the site CSP allows workers from 'self' only
      // The plain DVR playlist (no low latency) with our own delay; hls.js never changes the speed (it would play a
      // stopped feed's last seconds faster, eating the cushion) nor jumps to its own idea of the live moment: the delay
      // is the player's (rebuild, below), and so is every move of the live picture (engineMove)
      lowLatencyMode: false,
      ...(live ? { liveSyncDuration: LIVE_DELAY_S, liveMaxLatencyDuration: 1e9, startPosition: startAt } : {}),
      maxLiveSyncPlaybackRate: 1,
      backBufferLength: 30,
      capLevelToPlayerSize: true,
      manifestLoadingMaxRetry: 1,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 4,
    });
    hls = h;
    let parsed = false;
    const watchStart = () => {
      clearTimeout(managedTimer);
      managedTimer = setTimeout(() => {
        if (dead || hls !== h || everPlayed || video.readyState >= 2) return;
        if (status === 'blocked') watchStart(); // waiting on a tap, not on the player
        else toSafari();
      }, MANAGED_START_MS);
    };
    h.on(Hls.Events.MANIFEST_PARSED, () => {
      parsed = true;
      if (live) tryPlay();
      if (managedOnly && !everPlayed) watchStart();
    });
    // Live: how far the recording reaches, and whether it has closed (then it plays out to its last frame: 'ended')
    h.on(Hls.Events.LEVEL_UPDATED, () => {
      if (!live || hls !== h) return;
      report(true);
    });
    h.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal || hls !== h) return;
      health.errors++;
      if (managedOnly && d.type !== Hls.ErrorTypes.NETWORK_ERROR) {
        if (!everPlayed && (!parsed || ++hlsTrouble >= 2)) { toSafari(); return; }
        if (everPlayed) {
          const now = Date.now();
          laterTrouble = [...laterTrouble.filter((t) => now - t < MANAGED_LATER_WINDOW_MS), now];
          if (laterTrouble.length >= MANAGED_LATER_ERRORS) { toSafari(); return; }
        }
      }
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { h.recoverMediaError(); return; }
      // Live, a playlist that can't be read any more with picture still in hand (Stream's answers change as a
      // recording closes): play out what's there; the stall or the end takes it from there
      if (live && everPlayed && ahead() > 1) { h.stopLoad(); return; }
      restart();
    });
    h.loadSource(src);
    h.attachMedia(video);
  }

  async function start() {
    pending = false;
    lastMove = Date.now();
    if (dead) return;
    // One start at a time: a start-over (stopEngine) while this one waits on the feed or hls.js makes this one stand down
    const token = ++startToken;
    const stale = () => dead || token !== startToken;
    furthest = 0;
    fresh = true;
    liveAfterPlace = false;
    const native = !!video.canPlayType('application/vnd.apple.mpegurl');
    // An iPhone has no classic Media Source, only Managed Media Source (iOS 17.1 on). Its own HLS played the live reveal
    // about 11 s later than iPads and computers (16 s behind the moment to their 4 to 5) and fell further behind with
    // every dip in the phone's signal; hls.js on Managed Media Source keeps level with them (within 1 to 2 s) and
    // catches up after a dip (measured on real broadcasts in iPhone Safari, Nov 17 2026). So the live reveal goes
    // through hls.js there; Safari then offers no picture-in-picture or AirPlay for it (full screen works). Older
    // iPhones, and an iPhone's replay (no moment to keep up with, and both of those kept), stay on Safari's own player.
    const mse = 'MediaSource' in window || (live && managedOnly && !nativeOnly);
    const onNative = native && !mse;
    // The feed is read while hls.js loads, so a start that goes ahead waits on neither
    const loading = onNative ? null : loadHls().catch(() => null);
    let src = urls.hls;
    let startAt = -1;
    if (live) {
      const look = await lookAtFeed();
      if (stale()) return;
      closed = look.closed && !everPlayed;
      if (look.closed && everPlayed) endFeed();
      if (!look.go) {
        // Nothing to play yet: keep saying so and look again (a camera not connected yet, a feed that has stopped)
        set(everPlayed ? 'reconnecting' : 'waiting');
        pending = true;
        retryTimer = setTimeout(start, RETRY_MS);
        return;
      }
      src = look.go.src;
      startAt = look.go.startAt;
      if (playableAt == null) playableAt = Date.now();
      playingVideo = look.go.video;
      if (feedEnded) feedEnded = false; // a newer recording: the feed is on again
    }
    set(everPlayed ? 'reconnecting' : 'connecting');
    if (onNative) { health.engine = 'native'; viaNative(src, startAt); return; }
    const Hls: HlsClass | null = await loading;
    if (stale()) return;
    if (Hls?.isSupported()) { health.engine = 'MediaSource' in window ? 'hls' : 'mms'; viaHls(Hls, src, startAt); }
    else if (native) { health.engine = 'native'; viaNative(src, startAt); }
    else { health.engine = 'iframe'; useIframe(); if (health.firstMs == null) health.firstMs = waitedSoFar() ?? 0; }
  }

  // ── Live: the going-back controls ──
  /** Picture loaded at this second */
  const loadedAt = (t: number) => {
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) - 0.2 <= t && t < b.end(i)) return true;
    return false;
  };
  /** Seconds of picture in hand past the one on screen */
  const ahead = () => {
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.1 && b.end(i) > video.currentTime) return b.end(i) - video.currentTime;
    return 0;
  };
  /** Gone back on purpose (no catching up, no jump to the live moment), or back at the live moment */
  function setChosen(on: boolean) {
    if (chosen === on) return;
    chosen = on;
    rebuild();
  }
  /**
   * The delay, kept by the player alone (hls.js never moves the live picture nor changes its speed):
   *   - the cushion: each short stop of the feed uses some of it up (nothing was filmed meanwhile), and once it's gone
   *     the next would hold. With less than REBUILD_BELOW_S of it the picture plays REBUILD_RATE as fast (too little to
   *     notice; the sound keeps its pitch) until it's back to REBUILD_TO_S
   *   - later than the delay by more than a few seconds (the viewer's own signal), CATCH_UP_RATE until it's back
   *   - further behind than LIVE_MAX_BEHIND_S, straight to the live moment
   * Never for a viewer who went back on purpose, nor while the last frame is held
   */
  function rebuild() {
    let want = 1;
    if (live && !chosen && !holding && everPlayed && !fresh) {
      const edge = newestSecond();
      const cushion = edge == null ? null : edge - video.currentTime;
      if (cushion != null && cushion > LIVE_MAX_BEHIND_S) { seekTo(edge! - LIVE_DELAY_S); return; }
      if (cushion != null) {
        if (cushion < REBUILD_BELOW_S || (rebuilding === 'slower' && cushion < REBUILD_TO_S)) want = REBUILD_RATE;
        else if (cushion > CATCH_UP_ABOVE_S || (rebuilding === 'faster' && cushion > CATCH_UP_TO_S)) want = CATCH_UP_RATE;
      }
    }
    rebuilding = want < 1 ? 'slower' : want > 1 ? 'faster' : '';
    if (video.playbackRate !== want) video.playbackRate = want;
  }
  /** The first second there is to go back to, and the live moment (the usual delay behind the newest second) */
  function span(): { first: number; live: number } | null {
    const edge = newestSecond();
    if (edge == null) return null;
    const s = video.seekable;
    const first = hls ? hls.latestLevelDetails?.fragmentStart ?? 0 : s.length ? s.start(0) : 0;
    return { first, live: Math.max(first, edge - LIVE_DELAY_S) };
  }
  /** Work out canSeek and behind, and tell the page when they change (force: re-check now) */
  function report(force = false) {
    if (!live || dead) return;
    const now = Date.now();
    if (!force && now - lastReport < 1000) return;
    lastReport = now;
    const sp = span();
    const nextCan = !!sp && sp.live - sp.first >= SEEK_MIN_S;
    let nextBehind = 0;
    if (sp && everPlayed && !holding) {
      const gap = sp.live - video.currentTime;
      nextBehind = gap > AT_LIVE_SLACK_S ? Math.round(gap) : 0;
    }
    const changed = nextCan !== canSeek || (nextBehind > 0) !== (behind > 0) || (nextBehind > 0 && nextBehind !== behind);
    canSeek = nextCan;
    behind = nextBehind;
    if (changed) opts.onLive?.({ canSeek, behind });
  }

  // ── Media events ──
  const size = () => { if (video.videoWidth && video.videoHeight) opts.onSize?.(video.videoWidth, video.videoHeight); };
  video.addEventListener('loadedmetadata', size);
  // A replay that has loaded is ready and waiting for its first tap (or, asked for before its source came, plays now)
  video.addEventListener('loadedmetadata', () => {
    if (!live && status === 'connecting') set('paused');
    if (playAborted && video.paused && !dead) tryPlay();
  });
  video.addEventListener('resize', size);
  // Live: the video reset (hls.js recovering from a media error detaches and re-attaches it, then puts the picture back
  // where it was; our own start-overs reset it too): that placing is the engine's, as at a start, and unless the viewer
  // had paused it plays on by itself once it can (not left to the autoplay attribute, which Low Power Mode refuses)
  let playAfterReset = false;
  let liveAfterPlace = false; // live: a viewer's play came while the engine was putting the picture back: to the live moment once it has
  video.addEventListener('emptied', () => {
    if (!live || dead) return;
    fresh = true;
    playAfterReset = everPlayed && !viewerPaused && status !== 'blocked';
    if (viewerPaused) liveAfterPlace = true; // (their play, once the engine has put the picture back, goes to the live moment)
  });
  video.addEventListener('canplay', () => {
    if (!playAfterReset) return;
    playAfterReset = false;
    if (live && video.paused && !holding && !dead) tryPlay();
  });
  video.addEventListener('volumechange', () => opts.onMuted?.(video.muted));
  video.addEventListener('playing', () => {
    if (live && video.paused) return; // (one from before a pause of ours: nothing is playing)
    // (played from outside the page, the lock screen or the phone's own controls, while the picture waits to go back to
    // a second Safari can't reach yet: there first, or held on)
    if (holding && returnTo != null) {
      const s = video.seekable;
      if (s.length && s.end(s.length - 1) >= returnTo - 0.05) { seekTo(returnTo); returnTo = null; } else { ownPause = true; video.pause(); return; }
    }
    clearTimeout(stallTimer);
    if (health.firstMs == null) { if (playableAt == null) playableAt = mountedAt; health.firstMs = waitedSoFar(); }
    if (live && fresh) {
      fresh = false;
      if (liveAfterPlace) { liveAfterPlace = false; if (!chosen) toLiveMoment(); }
      const edge = newestSecond();
      if (health.startBehind == null && edge != null) health.startBehind = Math.round((edge - video.currentTime) * 10) / 10;
    }
    everPlayed = true;
    failures = 0;
    lastMove = Date.now();
    closed = false;
    if (!holding || !video.paused) setForMore(false); // (not for an old 'playing' arriving while the hold is on)
    set('playing');
    // Playing again by any road (a tap for sound included): no longer holding (an old 'playing' from before the hold aside)
    if (holding && !video.paused) unhold();
  });
  video.addEventListener('waiting', () => {
    if (status !== 'playing') return;
    set('buffering');
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { if (status === 'buffering') set('reconnecting'); }, STALL_MS);
    // Live, at the live moment, out of picture at the newest piece there is: the phone's feed has stopped
    if (live && !chosen) {
      const edge = newestSecond();
      if (edge != null && edge - video.currentTime < 1.5) hold();
    }
  });
  video.addEventListener('pause', () => {
    // (paused on purpose: a play the browser called off earlier isn't asked again, nor one it refuses after this)
    pauses++;
    playAborted = false;
    // (live: a pause that isn't one of ours is the viewer's or the phone's; playing again then goes to the live moment)
    // (not the pause that comes with the end of a recording: that's the browser's, and 'ended' takes it from there)
    if (live && !ownPause && !restarting && !dead && everPlayed && !video.ended) { viewerPaused = true; playAfterReset = false; }
    ownPause = false;
    if (restarting || video.ended || dead || holding) return;
    if (status === 'playing' || status === 'buffering') set('paused');
  });
  // Playing again, or a tap getting past a refused autoplay: "Tap to watch" goes, and the start watches count from here
  video.addEventListener('play', () => {
    if (status === 'paused' || status === 'ended' || status === 'blocked') set(everPlayed ? 'buffering' : 'connecting');
    if (live && viewerPaused && !chosen) { if (fresh) liveAfterPlace = true; else toLiveMoment(); }
    viewerPaused = false;
  });
  // Live, playing again after the viewer's or the phone's pause (the lock screen, a call, another app, leaving full
  // screen): forward to the live moment, unless they had gone back on purpose (then on from where they paused, as
  // Stream's own DVR does). Never after a hold of the player's own: that plays on from the very frame it held (it
  // used to jump about 6 s ahead there, measured Nov 19 2026)
  function toLiveMoment() {
    const sp = span();
    if (sp && sp.live - video.currentTime > AT_LIVE_SLACK_S) seekTo(sp.live);
  }
  video.addEventListener('ended', () => {
    if (!live) { set('ended'); return; }
    setForMore(false);
    // Live: the recording closed and its last frame has been shown. Look for a newer one (the phone back); if
    // there's none, the feed has ended for this viewer (lookAtFeed says so, and start() tells the page)
    if (seen) seen = { ...seen, pos: Math.max(seen.pos, video.currentTime) };
    restart(0, false);
  });
  video.addEventListener('error', () => {
    if (restarting || dead || hls) return; // hls.js reports its own errors
    health.errors++;
    if (video.getAttribute('src')) restart();
  });
  // Live: where the viewer is
  video.addEventListener('timeupdate', () => {
    if (!live || video.paused || video.seeking || !video.currentTime || restarting) return;
    const t = video.currentTime;
    furthest = chosen ? t : Math.max(furthest, t);
    if (playingVideo || !urls.input) seen = { video: playingVideo, pos: chosen ? t : Math.max(seen?.video === playingVideo ? seen.pos : 0, t) };
    if (Date.now() - lastMove < 100 || t !== lastTime) { report(); rebuild(); }
  });
  video.addEventListener('seeked', () => { selfSeek = false; clearTimeout(selfSeekTimer); report(true); });
  // Live: a move back over what was shown that nobody here asked for (hls.js's own go through engineMove, above). With
  // the phone's own controls on the picture (an iPhone's full screen, picture in picture: the page puts none there),
  // it's the viewer going back on purpose. Otherwise it's Safari's own player moving the picture by itself: undone,
  // the picture back where it was, and the last frame held there if there's nothing more yet. (Before Nov 19 2026 a
  // move back while the picture was playing was taken for the viewer's, and the seconds played again)
  video.addEventListener('seeking', () => {
    if (!live || dead || pending || restarting || !everPlayed || selfSeek || fresh || !playingVideo) return;
    const t = pictureAt();
    if (browserControls()) {
      const sp = span();
      if (sp && t >= sp.live - AT_LIVE_SLACK_S) setChosen(false);
      else if (t < furthest - BACK_OVER_SHOWN_S || chosen) { setChosen(true); furthest = t; }
      report(true);
      return;
    }
    if (t >= furthest - BACK_OVER_SHOWN_S) return;
    health.refused++;
    const back = furthest;
    if (seen && seen.video === playingVideo) seen = { ...seen, pos: Math.max(seen.pos, back) };
    const s = video.seekable;
    const reach = s.length ? s.end(s.length - 1) : back;
    // (past Safari's own seekable end it can't go back there yet: held where it is, and back there once it can, in
    // checkHold; a viewer who went back on purpose isn't held, so for them it goes as far as Safari allows)
    if (back <= reach + 0.05 || chosen) {
      seekTo(Math.min(back, reach));
      if (!chosen && !holding) { const edge = newestSecond(); if (edge == null || edge - back < 1.5) hold(); }
      return;
    }
    returnTo = back;
    if (!holding) hold();
  });
  /** The browser's own controls are on the picture: an iPhone's full screen, or picture in picture */
  function browserControls(): boolean {
    const v = video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitPresentationMode?: string };
    return !!v.webkitDisplayingFullscreen || v.webkitPresentationMode === 'picture-in-picture'
      || document.pictureInPictureElement === video || document.fullscreenElement === video;
  }

  // ── Live: holding the last frame while the feed is stopped ──
  // The usual delay is a broadcast delay: viewers see each moment LIVE_DELAY_S after it's filmed. When the feed stops
  // and the picture runs out, it holds on its last frame (Reconnecting) and plays on from exactly there once the
  // feed has LIVE_DELAY_S of new picture again, so the next drop is hidden too (playing on at once would leave no
  // cushion). A recording that closes with nothing more is the end of it for this viewer.
  /** The newest second the feed reaches, on this player's timeline */
  function newestSecond(): number | null {
    if (hls) return hls.latestLevelDetails?.edge ?? null;
    if (nativeEdge != null) return nativeEdge;
    const s = video.seekable;
    const end = s.length ? s.end(s.length - 1) : NaN;
    return Number.isFinite(end) ? end : null;
  }
  function hold() {
    if (holding || dead) return;
    // (the last second of a recording Stream has closed: its end, nothing more to hold for; as 'ended', just after
    // whatever called this, hls.js among them)
    const d = hls?.latestLevelDetails;
    const end = newestSecond();
    if (d && !d.live && (end == null || end - video.currentTime < 1)) { setTimeout(() => { if (!dead && !pending && !holding) endHere(); }, 0); return; }
    holding = true;
    setForMore(true);
    holdLooks = 0;
    health.holds++;
    heldSince = Date.now();
    furthest = Math.max(furthest, pictureAt());
    if (seen && seen.video === playingVideo) seen = { ...seen, pos: Math.max(seen.pos, pictureAt()) };
    clearTimeout(stallTimer);
    set('reconnecting');
    ownPause = !video.paused; // (a 'pause' comes only if it was playing)
    video.pause(); // (the pause listener leaves the status alone while holding)
    clearInterval(holdTimer);
    holdTimer = setInterval(checkHold, 1000);
    report(true);
  }
  function unhold() {
    if (holding) health.heldMs += Date.now() - heldSince;
    holding = false;
    returnTo = null;
    clearInterval(holdTimer);
  }
  /** The recording's last frame has been shown: as 'ended' (look for a newer recording, else the feed has ended) */
  function endHere() {
    unhold();
    setForMore(false);
    if (seen) seen = { ...seen, pos: Math.max(seen.pos, video.currentTime) };
    restart(0, false);
  }
  async function checkHold() {
    if (!holding || dead || pending) return;
    if (returnTo != null) {
      const s = video.seekable;
      if (s.length && s.end(s.length - 1) >= returnTo - 0.05) { seekTo(returnTo); returnTo = null; }
    }
    const edge = newestSecond();
    if (!fresh && returnTo == null && edge != null && edge - video.currentTime >= LIVE_DELAY_S - 2) { unhold(); tryPlay(); return; }
    const details = hls?.latestLevelDetails;
    if (details && !details.live && (edge == null || edge - video.currentTime < 1)) { endHere(); return; }
    // (closed with more past the held frame: the last seconds, which Stream's playlist leaves out until it closes the
    // recording (Max's reveal, Nov 20 2026), played out now, with no cushion to wait for; this used to wait for the
    // next look at the feed and start over)
    if (details && !details.live && !fresh && returnTo == null) { unhold(); tryPlay(); return; }
    // Every few seconds, read the feed too: a newer recording (the phone back after Stream closed the last one),
    // the end, or a player that has stopped reading its playlist while the feed went on
    if (++holdLooks % 4 || looking) return;
    looking = true;
    const look = await lookAtFeed().finally(() => { looking = false; });
    if (!holding || dead || pending) return;
    if (look.go) { unhold(); restart(0, look.go.video === playingVideo); } else if (look.closed) endHere();
  }

  // Live watchdog: a picture that stops moving. A feed that has stopped too leaves it where it is (Reconnecting, and
  // hls.js goes on reading the playlist, so it plays on by itself when the phone is back); a feed that has gone on
  // without it (the player stuck, or a newer recording) gets a start-over from where the viewer was
  const watchdog = live ? setInterval(async () => {
    if (dead || pending || video.paused || !everPlayed || looking) return;
    if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastMove = Date.now(); return; }
    if (Date.now() - lastMove <= FROZEN_MS) return;
    looking = true;
    const look = await lookAtFeed().finally(() => { looking = false; });
    if (dead || pending) return;
    if (look.closed) endFeed();
    if (look.go) restart(0, look.go.video === playingVideo);
    else lastMove = Date.now() - FROZEN_MS + RETRY_MS; // look again in a few seconds
  }, 2000) : undefined;

  // The phone's lock screen and Control Center (and a headset's or keyboard's media keys) move the picture through
  // these: on the live video they're the viewer's own going back or forward, through the player like From the start,
  // never a move it would undo
  const session = live && 'mediaSession' in navigator ? navigator.mediaSession : null;
  const sessionActions: MediaSessionAction[] = ['seekbackward', 'seekforward', 'seekto'];
  function viewerMove(t: number) {
    const sp = span();
    if (!sp || !Number.isFinite(t)) return;
    if (t > pictureAt() && t >= sp.live - AT_LIVE_SLACK_S) { handle.toLive(); return; }
    unhold();
    const to = Math.max(sp.first + 0.1, t);
    setChosen(to < sp.live - AT_LIVE_SLACK_S);
    seekTo(to);
    furthest = to;
    if (seen && seen.video === playingVideo) seen = { ...seen, pos: to };
    if (video.paused) tryPlay();
    report(true);
  }
  if (session) {
    const handlers: Record<string, MediaSessionActionHandler> = {
      seekbackward: (d) => viewerMove(pictureAt() - (d.seekOffset || 10)),
      seekforward: (d) => viewerMove(pictureAt() + (d.seekOffset || 10)),
      seekto: (d) => { if (d.seekTime != null) viewerMove(d.seekTime); },
    };
    for (const a of sessionActions) { try { session.setActionHandler(a, handlers[a]); } catch { /* not offered here */ } }
  }

  opts.onStatus?.(status);
  start();

  const handle: PlayerHandle = {
    get video() { return status === 'iframe' ? null : video; },
    get status() { return status; },
    get canSeek() { return canSeek; },
    get behind() { return behind; },
    get feedEnded() { return feedEnded; },
    get closed() { return closed; },
    get waitingForMore() { return forMore && !feedEnded && !dead; },
    setMuted(muted: boolean) {
      video.muted = muted;
      if (!muted && video.volume === 0) video.volume = 1;
      // (never while holding the last frame: that would play on with no cushion). Live plays on with its sound turned on
      // or off; a replay is only ever started by a play (pressing M twice on a paused replay used to start it, a review)
      if (video.paused && !video.ended && live && !holding) tryPlay();
    },
    play() {
      // Played again after the end: from the start, unless a place has been picked since (Jump to the reveal sets one
      // just before playing, and this used to send it back to 0:00)
      if (status === 'ended' && video.currentTime >= video.duration - 0.5) video.currentTime = 0;
      if (holding) return; // live, holding the last frame: it plays on by itself
      tryPlay();
    },
    get playPending() { return playAborted && video.paused && !dead; },
    cancelPlay() { playAborted = false; },
    get health() {
      return {
        ...health,
        heldMs: health.heldMs + (holding ? Date.now() - heldSince : 0),
        waitedMs: health.firstMs ?? waitedSoFar(),
      };
    },
    seekToStart() {
      if (!live) return;
      const sp = span();
      if (!sp) return;
      unhold();
      setChosen(true);
      seekTo(sp.first + 0.1);
      furthest = sp.first + 0.1;
      if (video.paused) tryPlay();
      report(true);
    },
    toLive() {
      if (!live) return;
      setChosen(false);
      // (holding the last frame: that is the live moment, and it plays on by itself)
      if (holding) { report(true); return; }
      // (forward only: a viewer short of the full delay is already at the live moment, never sent back over what they saw)
      const sp = span();
      if (sp && sp.live > pictureAt() + 0.5) seekTo(sp.live);
      if (video.paused) tryPlay();
      report(true);
    },
    destroy() {
      dead = true;
      clearInterval(watchdog);
      clearInterval(holdTimer);
      clearTimeout(selfSeekTimer);
      stopEngine();
      document.removeEventListener('visibilitychange', noteWait);
      if (session) for (const a of sessionActions) { try { session.setActionHandler(a, null); } catch { /* not offered here */ } }
      container.innerHTML = '';
    },
  };
  return handle;
}
