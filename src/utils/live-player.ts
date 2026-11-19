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
 *   - Viewers watch LIVE_DELAY_S behind the phone. A phone whose signal drops and is back within that never shows a
 *     freeze, only a small skip, and the end of a reveal plays out in full before the page moves on.
 *   - The whole broadcast so far can be watched from its start (Stream's DVR playlist, `dvrEnabled=true`), so a
 *     late arrival can go back to the beginning and come back to the live moment (seekToStart, toLive).
 *   - Nothing ever plays twice. On Nov 18 the page replayed its last few seconds over and over when the feed
 *     stalled (hls.js moving the picture back to "catch up" with a low-latency playlist whose end the picture had
 *     passed; every start-over also began several seconds back), then, once Stream had closed the feed into a
 *     recording, played the whole broadcast from 0:00. Now the player remembers where it is in which recording
 *     (`seen`): a start-over goes on from exactly there, a recording Stream has closed is played only up to its
 *     last frame and never from its start again, and a move back over what was shown, while the picture is stalled
 *     at the newest piece, is taken for the feed stopping (start over from where the viewer was, once there is
 *     more).
 * What Stream does (measured on the real feed, Nov 18 2026): the live input's own playlist names the recording in
 * its piece addresses (/<video id>/video/...); a recording's DVR playlist starts at its first piece and only grows,
 * so a place in it (seconds from its start) is the same for every player; DVR doesn't work with low latency (HTTP
 * 500), and the plain live playlist keeps only about 18 s, so the delay needs DVR; the phone stopping freezes the
 * playlist, the recording closes `recording.timeoutSeconds` later (its DVR playlist gains an end; the input's
 * playlist answers 204 again), and a phone back after that starts a new recording.
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
  setMuted(muted: boolean): void;
  play(): void;
  /** A play asked for, called off by the video being reset as its source came, waiting to go once it can play */
  readonly playPending: boolean;
  /** Don't play when it can after all (pause pressed while it waits) */
  cancelPlay(): void;
  /** Live: to the first second of this broadcast's recording, playing on from there (no catching up, no jump to live) */
  seekToStart(): void;
  /** Live: back to the live moment (the usual delay) */
  toLive(): void;
  destroy(): void;
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
}

/** Live: how far behind the phone viewers watch (Peter, Nov 18 2026: "about 20 seconds") */
export const LIVE_DELAY_S = 20;
/** Live: further behind than this, and not by choice, the picture jumps to the usual delay */
const LIVE_MAX_BEHIND_S = LIVE_DELAY_S + 30;
/** Live: within this many seconds of the usual delay counts as at the live moment (the delay's own drift never shows) */
const AT_LIVE_SLACK_S = 6;
/** Live: going back is offered once the broadcast reaches this far before the live moment */
const SEEK_MIN_S = 30;
/** Live: at most this much faster to catch up after a dip, too gently to notice (the sound keeps its pitch) */
const REBUILD_RATE = 0.97;
const REBUILD_BELOW_S = LIVE_DELAY_S - 5;
const REBUILD_TO_S = LIVE_DELAY_S - 1;
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
  let rebuilding = false; // live: playing a touch slower to rebuild the cushion (rebuild)
  let edgeAt = 0; // the newest second the running player's playlist reached
  let holding = false; // live: holding the last frame until the feed has the usual delay's worth again
  let holdTimer: ReturnType<typeof setInterval> | undefined;
  let holdLooks = 0;

  const set = (s: PlayerStatus) => {
    if (s === status || dead) return;
    status = s;
    opts.onStatus?.(s);
  };

  // A play the browser called off because the video's source came (or changed) after it was asked for: asked again as
  // soon as the new source can play. Watch the replay mounts the replay and plays it in the same tap, before hls.js has
  // attached its source; attaching resets the element, which pauses it and refuses the ask (AbortError), and it sat at
  // 0:00 until the bar's play was pressed (Chrome and the other Media Source browsers; Peter's test, Nov 18 2026). The
  // tap's own play() still goes at once: that is what lets the second one play with sound.
  // Only a reset counts: a pause pressed while it was starting refuses the play the same way (AbortError, nothing
  // loaded), but always fires 'pause' first, and a reset never does; so a play refused with no pause since it was asked
  // for was called off by a reset (a viewer's play then pause before it had loaded used to start it anyway, the review)
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

  /** A seek of our own: the guard below leaves it alone */
  function seekTo(t: number) {
    selfSeek = true;
    clearTimeout(selfSeekTimer);
    selfSeekTimer = setTimeout(() => { selfSeek = false; }, 1500); // (if the browser fires no seeked)
    video.currentTime = t;
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
    restarting = true;
    if (hls) { try { hls.destroy(); } catch { /* already gone */ } hls = null; }
    if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
    restarting = false;
  }

  function restart(delay = failures > 15 ? RETRY_SLOW_MS : RETRY_MS) {
    if (dead) return;
    failures++;
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
  async function lookAtFeed(): Promise<FeedLook> {
    if (!urls.input) return { go: { src: urls.hls, video: null, startAt: -1 }, closed: false };
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), FEED_CHECK_MS);
    const read = async (u: string) => {
      // (never from the browser's cache: Stream lets a closed recording's playlists be kept 10 minutes)
      const r = await fetch(u, { signal: stop.signal, cache: 'no-store' });
      return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : '' };
    };
    // A playlist, through its master's first variant (every variant has the same pieces)
    const media = async (u: string) => {
      const res = await read(u);
      if (!res.ok || !res.text.includes('#EXT-X-STREAM-INF')) return res;
      const lines = res.text.split('\n').map((l) => l.trim());
      const at = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
      const uri = lines.slice(at + 1).find((l) => l && !l.startsWith('#'));
      return uri ? read(new URL(uri, u).href) : { status: 0, ok: false, text: '' };
    };
    /** A recording's DVR playlist: how far it reaches, whether it has closed (null: unreadable) */
    const reach = async (rec: string) => {
      const res = await media(urls.dvr(rec));
      return res.ok && res.text.includes('#EXTM3U') ? playlistSpan(res.text) : null;
    };
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
      // A recording (the first, or a newer one) starts once it has the usual delay's worth: a viewer there from the
      // very start sits the full delay behind too. A newer one plays from its first second if it's short (nothing
      // was filmed between)
      if (span.total < need) return { go: null, closed: false };
      if (seen) return play(rec, span.total <= NEW_RECORDING_FROM_START_S ? 0 : -1);
      return play(rec, -1);
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
    // Where to start: where the viewer was, or the usual delay behind the newest moment (Safari picks less)
    nativePlace = () => {
      nativePlace = null;
      const s = video.seekable;
      if (startAt >= 0) seekTo(startAt);
      else if (s.length) seekTo(Math.max(s.start(0), s.end(s.length - 1) - LIVE_DELAY_S));
    };
    video.addEventListener('loadedmetadata', () => nativePlace?.(), { once: true });
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

  function viaHls(Hls: HlsClass, src: string, startAt: number) {
    const h = new Hls({
      enableWorker: false, // the site CSP allows workers from 'self' only
      // The plain DVR playlist (no low latency) with our own delay; hls.js never changes the speed (it would play a
      // stopped feed's last seconds faster, eating the cushion): the cushion is ours too (rebuild, below)
      lowLatencyMode: false,
      ...(live ? { liveSyncDuration: LIVE_DELAY_S, liveMaxLatencyDuration: LIVE_MAX_BEHIND_S, startPosition: startAt } : {}),
      maxLiveSyncPlaybackRate: 1,
      backBufferLength: 30,
      capLevelToPlayerSize: true,
      manifestLoadingMaxRetry: 1,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 4,
    });
    hls = h;
    if (live && chosen) relax(h, true);
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
    h.on(Hls.Events.LEVEL_UPDATED, (_e, d) => {
      if (!live || hls !== h) return;
      edgeAt = d.details.edge;
      report(true);
    });
    h.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal || hls !== h) return;
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
      if (look.go.video !== playingVideo) edgeAt = 0;
      playingVideo = look.go.video;
      if (feedEnded) feedEnded = false; // a newer recording: the feed is on again
    }
    set(everPlayed ? 'reconnecting' : 'connecting');
    if (onNative) { viaNative(src, startAt); return; }
    const Hls: HlsClass | null = await loading;
    if (stale()) return;
    if (Hls?.isSupported()) viaHls(Hls, src, startAt);
    else if (native) viaNative(src, startAt);
    else useIframe();
  }

  // ── Live: the going-back controls ──
  /** Seconds of picture in hand past the one on screen */
  const ahead = () => {
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.1 && b.end(i) > video.currentTime) return b.end(i) - video.currentTime;
    return 0;
  };
  /** Gone back on purpose: no jump to the live moment (hls.js reads its config on every check) */
  function relax(h: InstanceType<HlsClass>, on: boolean) {
    h.config.liveMaxLatencyDuration = on ? 1e9 : LIVE_MAX_BEHIND_S;
  }
  function setChosen(on: boolean) {
    if (chosen === on) return;
    chosen = on;
    if (hls) relax(hls, on);
    rebuild();
  }
  /**
   * The cushion: each short drop the delay hides uses some of it up (nothing was filmed while the phone was away),
   * and once it's gone the next blip would hold. At the live moment with less than REBUILD_BELOW_S of it, the picture
   * plays REBUILD_RATE as fast (too little to notice; the sound keeps its pitch) until it's back to REBUILD_TO_S
   */
  function rebuild() {
    let want = 1;
    if (live && !chosen && !holding && everPlayed) {
      const edge = newestSecond();
      const cushion = edge == null ? null : edge - video.currentTime;
      if (cushion != null) want = cushion < REBUILD_BELOW_S || (rebuilding && cushion < REBUILD_TO_S) ? REBUILD_RATE : 1;
    }
    rebuilding = want !== 1;
    if (video.playbackRate !== want) video.playbackRate = want;
  }
  /** The first second there is to go back to, and the live moment, on this player's timeline */
  function span(): { first: number; live: number } | null {
    if (hls) {
      const d = hls.latestLevelDetails;
      const sync = hls.liveSyncPosition;
      return d && sync != null ? { first: d.fragmentStart, live: sync } : null;
    }
    const s = video.seekable;
    if (!s.length) return null;
    return { first: s.start(0), live: Math.max(s.start(0), s.end(s.length - 1) - LIVE_DELAY_S) };
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
  video.addEventListener('volumechange', () => opts.onMuted?.(video.muted));
  video.addEventListener('playing', () => {
    clearTimeout(stallTimer);
    everPlayed = true;
    failures = 0;
    lastMove = Date.now();
    closed = false;
    set('playing');
    // Playing again by any road (a tap for sound included): no longer holding
    if (holding) unhold();
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
    if (restarting || video.ended || dead || holding) return;
    if (status === 'playing' || status === 'buffering') set('paused');
  });
  // Playing again, or a tap getting past a refused autoplay: "Tap to watch" goes, and the start watches count from here
  video.addEventListener('play', () => {
    if (status === 'paused' || status === 'ended' || status === 'blocked') set(everPlayed ? 'buffering' : 'connecting');
    if (live && everPlayed && !chosen) toLiveMoment();
  });
  // Live, playing again after a pause (the lock screen, a call, another app, leaving full screen): straight back to the
  // live moment, unless the viewer had gone back on purpose (then on from where they paused, as Stream's own DVR does)
  function toLiveMoment() {
    const h = hls;
    if (!h) return;
    const sync = h.liveSyncPosition;
    const target = h.targetLatency;
    const step = h.latestLevelDetails?.targetduration;
    if (sync == null || target == null || !step) return;
    if (h.latency > target + step) seekTo(sync);
  }
  video.addEventListener('ended', () => {
    if (!live) { set('ended'); return; }
    // Live: the recording closed and its last frame has been shown. Look for a newer one (the phone back); if
    // there's none, the feed has ended for this viewer (lookAtFeed says so, and start() tells the page)
    if (seen) seen = { ...seen, pos: Math.max(seen.pos, video.currentTime) };
    restart(0);
  });
  video.addEventListener('error', () => {
    if (restarting || dead || hls) return; // hls.js reports its own errors
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
  // Live: the picture moved back over what this player has shown. While stalled at the newest piece that's hls.js
  // "catching up" with a feed that has stopped (Nov 18 2026: the same seconds over and over): start over, which goes
  // on from where the viewer was once there's more. Anywhere else it's the viewer (Safari's full-screen scrubber):
  // they've gone back on purpose
  video.addEventListener('seeking', () => {
    if (!live || dead || pending || restarting || !everPlayed || selfSeek) return;
    if (video.currentTime >= furthest - BACK_OVER_SHOWN_S) return;
    const stalled = status === 'buffering' || status === 'reconnecting';
    const atNewest = !hls || !edgeAt || furthest >= edgeAt - 1.5;
    if (stalled && atNewest) { if (seen) seen = { ...seen, pos: Math.max(seen.pos, furthest) }; restart(0); return; }
    setChosen(true);
    furthest = video.currentTime;
  });

  // ── Live: holding the last frame while the feed is stopped ──
  // The usual delay is a broadcast delay: viewers see each moment LIVE_DELAY_S after it's filmed. When the feed stops
  // and the picture runs out, it holds on its last frame (Reconnecting) and plays on from exactly there once the
  // feed has LIVE_DELAY_S of new picture again, so the next drop is hidden too (playing on at once would leave no
  // cushion). A recording that closes with nothing more is the end of it for this viewer.
  /** The newest second the feed reaches, on this player's timeline */
  function newestSecond(): number | null {
    if (hls) return hls.latestLevelDetails?.edge ?? null;
    return video.seekable.length ? video.seekable.end(video.seekable.length - 1) : null;
  }
  function hold() {
    if (holding || dead) return;
    holding = true;
    holdLooks = 0;
    clearTimeout(stallTimer);
    set('reconnecting');
    video.pause(); // (the pause listener leaves the status alone while holding)
    clearInterval(holdTimer);
    holdTimer = setInterval(checkHold, 1000);
    report(true);
  }
  function unhold() {
    holding = false;
    clearInterval(holdTimer);
  }
  /** The recording's last frame has been shown: as 'ended' (look for a newer recording, else the feed has ended) */
  function endHere() {
    unhold();
    if (seen) seen = { ...seen, pos: Math.max(seen.pos, video.currentTime) };
    restart(0);
  }
  async function checkHold() {
    if (!holding || dead || pending) return;
    const edge = newestSecond();
    if (edge != null && edge - video.currentTime >= LIVE_DELAY_S - 2) { unhold(); tryPlay(); return; }
    const details = hls?.latestLevelDetails;
    if (details && !details.live && (edge == null || edge - video.currentTime < 1)) { endHere(); return; }
    // Every few seconds, read the feed too: a newer recording (the phone back after Stream closed the last one),
    // the end, or a player that has stopped reading its playlist while the feed went on
    if (++holdLooks % 4 || looking) return;
    looking = true;
    const look = await lookAtFeed().finally(() => { looking = false; });
    if (!holding || dead || pending) return;
    if (look.go) { unhold(); restart(0); } else if (look.closed) endHere();
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
    if (look.go) restart(0);
    else lastMove = Date.now() - FROZEN_MS + RETRY_MS; // look again in a few seconds
  }, 2000) : undefined;

  opts.onStatus?.(status);
  start();

  return {
    get video() { return status === 'iframe' ? null : video; },
    get status() { return status; },
    get canSeek() { return canSeek; },
    get behind() { return behind; },
    get feedEnded() { return feedEnded; },
    get closed() { return closed; },
    setMuted(muted: boolean) {
      video.muted = muted;
      if (!muted && video.volume === 0) video.volume = 1;
      // (never while holding the last frame: that would play on with no cushion)
      if (video.paused && !video.ended && (live || !muted) && !holding) tryPlay();
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
      const sp = span();
      if (sp) seekTo(sp.live);
      if (video.paused) tryPlay();
      report(true);
    },
    destroy() {
      dead = true;
      clearInterval(watchdog);
      clearInterval(holdTimer);
      clearTimeout(selfSeekTimer);
      stopEngine();
      container.innerHTML = '';
    },
  };
}
