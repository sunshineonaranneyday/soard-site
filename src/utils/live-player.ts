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
 * Live tries LL-HLS first and drops to plain HLS once if LL is refused (the
 * same order as the admin control room). A feed that isn't there yet (an
 * empty playlist or a 404) is retried every few seconds for as long as the
 * page keeps the player mounted, so it picks up the moment the phone
 * reconnects. If neither playback path exists, the Stream iframe takes over.
 *
 * A dropped feed never plays anything twice (Nov 18 2026 test broadcast: when the phone's feed stopped, the page
 * played its last few seconds over and over, then the whole broadcast from its first second). Before any live start
 * the feed's playlist is read (feedAhead): one Stream has closed into a recording (the phone stopped; it would play
 * from 0:00) is waited out, and after a drop the player starts again only once the feed has gone on past the
 * furthest moment this viewer saw (the playlist's PROGRAM-DATE-TIME), so it lands on the live moment, not on what it
 * already showed. hls.js, on a feed that has stopped, "catches up" by moving the picture back a few seconds each
 * time its playlist is read; any move back over what was already shown is taken as the feed stopping instead.
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

export interface PlayerHandle {
  readonly video: HTMLVideoElement | null;
  readonly status: PlayerStatus;
  setMuted(muted: boolean): void;
  play(): void;
  destroy(): void;
}

interface Options {
  player: LivePlayer;
  onStatus?: (status: PlayerStatus) => void;
  /** The picture's real size, once known (and again if the phone turns) */
  onSize?: (width: number, height: number) => void;
  onMuted?: (muted: boolean) => void;
}

/**
 * Behind the live moment, how fast the picture may play to catch up (hls.js, low latency only): after a dip in the
 * phone's signal it drifts back toward the live edge instead of staying late, too gently to notice (the sound keeps
 * its pitch). 1: never.
 */
const CATCH_UP_RATE = 1.1;
/** A stall this long reads as the feed dropping, not a hiccup */
const STALL_MS = 4000;
/** The browser's own HLS (iPhone) can sit silently on an empty playlist; give it this long to show a frame */
const NATIVE_START_MS = 12_000;
/** An iPhone on hls.js (Managed Media Source) with the feed's playlist there but no picture after this long goes back to Safari's own player */
const MANAGED_START_MS = 20_000;
/** An iPhone on hls.js that has played goes back to Safari's own player after this many of hls.js's own fatal errors this close together */
const MANAGED_LATER_ERRORS = 3;
const MANAGED_LATER_WINDOW_MS = 2 * 60_000;
/** Low latency: more than this many target durations behind, however it got there, jumps to the live moment */
const LIVE_MAX_BEHIND_COUNT = 10;
/** Picture stuck this long while "playing": start over */
const FROZEN_MS = 12_000;
const RETRY_MS = 4000;
const RETRY_SLOW_MS = 10_000;
/** Live, a move of the picture back by more than this over what this player has already shown: the feed has stopped */
const BACK_OVER_SHOWN_S = 0.5;
/** Reading the feed's playlist before a start: past this, start anyway and let the player find out */
const FEED_CHECK_MS = 5000;
/** A feed whose newest date is this far before what was shown has started over on another clock */
const CLOCK_RESET_MS = 30_000;

/**
 * The newest moment a media playlist reaches, from its EXT-X-PROGRAM-DATE-TIME: the last date plus every whole
 * piece after it, plus the parts of the piece still coming in (low latency lists a piece's parts before the piece).
 * Null without dates.
 */
export function playlistNewest(text: string): number | null {
  let at: number | null = null;
  let parts = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const t = Date.parse(line.slice(25));
      at = Number.isFinite(t) ? t : null;
      parts = 0;
    } else if (at != null && line.startsWith('#EXTINF:')) {
      at += (parseFloat(line.slice(8)) || 0) * 1000;
      parts = 0;
    } else if (at != null && line.startsWith('#EXT-X-PART:')) {
      const d = /DURATION=([\d.]+)/.exec(line);
      if (d) parts += parseFloat(d[1]) * 1000;
    }
  }
  return at == null ? null : at + parts;
}

/**
 * How far behind its newest moment a player starts on this playlist, in ms: what hls.js aims for (PART-HOLD-BACK
 * on a low-latency playlist, else HOLD-BACK, else three target durations).
 */
export function playlistHoldBack(text: string, lowLatency: boolean): number {
  const num = (re: RegExp) => { const m = re.exec(text); return m ? parseFloat(m[1]) : NaN; };
  const part = num(/PART-HOLD-BACK=([\d.]+)/);
  if (lowLatency && Number.isFinite(part)) return part * 1000;
  const hold = num(/[,:]HOLD-BACK=([\d.]+)/);
  if (Number.isFinite(hold)) return hold * 1000;
  const target = num(/#EXT-X-TARGETDURATION:([\d.]+)/);
  return (Number.isFinite(target) ? target : 2) * 3000;
}

type HlsClass = typeof import('hls.js').default;
let hlsModule: Promise<HlsClass> | null = null;
// The full build, never hls.js/light: Stream sends the sound as its own audio rendition (EXT-X-MEDIA TYPE=AUDIO),
// which only the full build plays. The light build played the picture in silence wherever hls.js runs (every
// computer, iPad); only iPhone, on Safari's own player, had sound (Nov 17 2026 test broadcast)
const loadHls = () => (hlsModule ||= import('hls.js').then((m) => m.default));

export function streamUrls(p: LivePlayer) {
  const host = `https://customer-${p.customerCode}.cloudflarestream.com/${p.uid}`;
  const hls = p.src || `${host}/manifest/video.m3u8`;
  return {
    hls,
    llhls: p.kind === 'live' && !p.src ? `${hls}?protocol=llhls` : null,
    poster: p.kind === 'replay' && !p.src ? `${host}/thumbnails/thumbnail.jpg` : '',
    iframe: `${host}/iframe?${p.kind === 'live' ? 'autoplay=true&muted=true' : 'preload=metadata'}`,
  };
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
  let useLl = !!urls.llhls;
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
  // Live: the furthest moment shown, as the playlist dates it (so it holds across starting over), and the furthest
  // this player has played on its own timeline (since its last start)
  let shownAt: number | null = null;
  let furthest = 0;
  // Live: the feed's newest moment at the last look, and how many looks in a row it moved on (feedAhead)
  let lastNewest: number | null = null;
  let feedMoves = 0;

  const set = (s: PlayerStatus) => {
    if (s === status || dead) return;
    status = s;
    opts.onStatus?.(s);
  };

  function tryPlay() {
    const pr = video.play();
    pr?.catch((err: DOMException) => { if (err?.name === 'NotAllowedError' && !dead) set('blocked'); });
  }

  function stopEngine() {
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

  function viaNative() {
    // (hls.js turns AirPlay off for Managed Media Source; Safari's own player has it)
    video.disableRemotePlayback = false;
    video.src = urls.hls;
    if (!live) return;
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

  function viaHls(Hls: HlsClass) {
    const src = useLl && urls.llhls ? urls.llhls : urls.hls;
    const h = new Hls({
      enableWorker: false, // the site CSP allows workers from 'self' only
      lowLatencyMode: live,
      maxLiveSyncPlaybackRate: live ? CATCH_UP_RATE : 1,
      backBufferLength: 30,
      capLevelToPlayerSize: true,
      manifestLoadingMaxRetry: 1,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 4,
    });
    // Set on the running player, not passed in: hls.js refuses this limit in its options unless its own distance from
    // the live moment is passed too (it throws, and nothing plays), and that would replace the shorter distance the
    // low-latency playlist asks for (PART-HOLD-BACK). hls.js reads it from here on every check.
    if (live) h.config.liveMaxLatencyDurationCount = LIVE_MAX_BEHIND_COUNT;
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
    // Stream closed the feed into a recording while this page was on it (the phone stopped): played on, it starts over
    // from its first second. Wait for the feed instead (or for the page to move on to the replay)
    h.on(Hls.Events.LEVEL_LOADED, (_e, d) => {
      if (live && hls === h && !d.details.live) restart();
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
      const code = d.response?.code;
      // LL-HLS refused outright (not just "nothing live yet"): plain HLS from here on
      if (useLl && code && code !== 404 && code !== 204) { useLl = false; restart(0); return; }
      restart();
    });
    h.loadSource(src);
    h.attachMedia(video);
  }

  /**
   * Live, before a start: is there something to play? Not while the feed isn't there (Stream answers 204 or 404:
   * the camera isn't connected), not a feed Stream has closed into a recording (EXT-X-ENDLIST: it would play from its
   * first second), and after a drop not until the feed has gone on far enough past the furthest moment shown that
   * the player's start (its hold-back from the newest moment) lands after it. Anything else (an error, no dates, no
   * answer in FEED_CHECK_MS) lets the player try, as before.
   */
  async function feedAhead(src: string, lowLatency: boolean): Promise<boolean> {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), FEED_CHECK_MS);
    try {
      const read = async (u: string) => {
        // (never from the browser's cache: Stream lets a closed recording's playlist be kept 10 minutes)
        const r = await fetch(u, { signal: stop.signal, cache: 'no-store' });
        return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : '' };
      };
      let res = await read(src);
      if (res.ok && res.text.includes('#EXT-X-STREAM-INF')) {
        // A master playlist: its first picture size answers for the feed
        const lines = res.text.split('\n').map((l) => l.trim());
        const at = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
        const uri = lines.slice(at + 1).find((l) => l && !l.startsWith('#'));
        if (!uri) return true;
        res = await read(new URL(uri, src).href);
      }
      if (res.status === 204 || res.status === 404) return false;
      if (!res.ok) return true;
      if (!res.text.includes('#EXTM3U')) return res.text.trim() !== '';
      if (res.text.includes('#EXT-X-ENDLIST')) return false;
      if (shownAt == null) return true;
      const newest = playlistNewest(res.text);
      if (newest == null) return true;
      // Dates far before what was shown: the feed started over on another clock, so the dates say nothing: go
      if (newest < shownAt - CLOCK_RESET_MS) { shownAt = null; return true; }
      if (newest - playlistHoldBack(res.text, lowLatency) > shownAt) { feedMoves = 0; return true; }
      // A feed that keeps moving on but never past what was shown (a clock slightly behind): trust it over the dates
      feedMoves = lastNewest != null && newest > lastNewest ? feedMoves + 1 : 0;
      lastNewest = newest;
      if (feedMoves >= 3) { feedMoves = 0; shownAt = null; return true; }
      return false;
    } catch {
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  async function start() {
    pending = false;
    lastMove = Date.now();
    if (dead) return;
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
    const src = onNative || !(useLl && urls.llhls) ? urls.hls : urls.llhls;
    const ahead = live ? feedAhead(src, src === urls.llhls) : null;
    const loading = onNative ? null : loadHls().catch(() => null);
    if (ahead && !(await ahead)) {
      // Nothing to play yet: keep saying so and look again (a camera not connected yet, a feed that has stopped)
      if (dead) return;
      set(everPlayed ? 'reconnecting' : 'waiting');
      pending = true;
      retryTimer = setTimeout(start, RETRY_MS);
      return;
    }
    if (dead) return;
    set(everPlayed ? 'reconnecting' : 'connecting');
    if (onNative) { viaNative(); return; }
    const Hls: HlsClass | null = await loading;
    if (dead) return;
    if (Hls?.isSupported()) viaHls(Hls);
    else if (native) viaNative();
    else useIframe();
  }

  // ── Media events ──
  const size = () => { if (video.videoWidth && video.videoHeight) opts.onSize?.(video.videoWidth, video.videoHeight); };
  video.addEventListener('loadedmetadata', size);
  // A replay that has loaded is ready and waiting for its first tap
  video.addEventListener('loadedmetadata', () => { if (!live && status === 'connecting') set('paused'); });
  video.addEventListener('resize', size);
  video.addEventListener('volumechange', () => opts.onMuted?.(video.muted));
  video.addEventListener('playing', () => {
    clearTimeout(stallTimer);
    everPlayed = true;
    failures = 0;
    lastMove = Date.now();
    set('playing');
  });
  video.addEventListener('waiting', () => {
    if (status !== 'playing') return;
    set('buffering');
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { if (status === 'buffering') set('reconnecting'); }, STALL_MS);
  });
  video.addEventListener('pause', () => {
    if (restarting || video.ended || dead) return;
    if (status === 'playing' || status === 'buffering') set('paused');
  });
  // Playing again, or a tap getting past a refused autoplay: "Tap to watch" goes, and the start watches count from here
  video.addEventListener('play', () => {
    if (status === 'paused' || status === 'ended' || status === 'blocked') set(everPlayed ? 'buffering' : 'connecting');
    if (live && everPlayed) toLiveMoment();
  });
  // Live, playing again after a pause (the lock screen, a call, another app, leaving full screen): straight back to the
  // live moment. hls.js eases back only from about one segment late and jumps only past LIVE_MAX_BEHIND_COUNT, so a
  // pause in between would leave this viewer 10 to 20 s behind everyone else for the rest of the reveal.
  function toLiveMoment() {
    const h = hls;
    if (!h) return;
    const sync = h.liveSyncPosition;
    const target = h.targetLatency;
    const step = h.latestLevelDetails?.targetduration;
    if (sync == null || target == null || !step) return;
    if (h.latency > target + step) video.currentTime = sync;
  }
  video.addEventListener('ended', () => {
    // A live playlist that ends is the camera dropping; the replay ending is just the end
    if (live) restart(); else set('ended');
  });
  video.addEventListener('error', () => {
    if (restarting || dead || hls) return; // hls.js reports its own errors
    if (video.getAttribute('src')) restart();
  });

  // Live: how far this viewer has seen
  const shownMoment = (): number | null => {
    if (hls) return hls.playingDate?.getTime() ?? null;
    const start = (video as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate?.()?.getTime();
    return start != null && Number.isFinite(start) ? start + video.currentTime * 1000 : null;
  };
  video.addEventListener('timeupdate', () => {
    if (!live || video.paused || video.seeking || !video.currentTime) return;
    if (video.currentTime > furthest) furthest = video.currentTime;
    const at = shownMoment();
    if (at != null && (shownAt == null || at > shownAt)) shownAt = at;
  });
  // Live: the picture moved back over what this player has already shown. hls.js does that on a feed that has
  // stopped (the picture past its playlist's end, it moves back to its hold-back, plays to the end, and again), so the
  // same seconds played over and over: start over instead, which waits until the feed has something new
  // Only then: stalled (hls.js moves back only with the picture short of data) at the newest piece. Anything else
  // moving back is the viewer (Safari's full-screen scrubber) and is left alone
  video.addEventListener('seeking', () => {
    if (!live || dead || pending || restarting || !everPlayed) return;
    if (video.currentTime >= furthest - BACK_OVER_SHOWN_S) return;
    const stalled = status === 'buffering' || status === 'reconnecting' || video.readyState < 4;
    const edge = hls?.latestLevelDetails?.edge;
    const atNewest = edge == null || furthest >= edge - 2;
    if (stalled && atNewest) restart(0);
  });

  // Live watchdog: a picture that stops moving without an error gets a fresh start
  const watchdog = live ? setInterval(() => {
    if (dead || pending || video.paused || !everPlayed) return;
    if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastMove = Date.now(); return; }
    if (Date.now() - lastMove > FROZEN_MS) restart(0);
  }, 2000) : undefined;

  opts.onStatus?.(status);
  start();

  return {
    get video() { return status === 'iframe' ? null : video; },
    get status() { return status; },
    setMuted(muted: boolean) {
      video.muted = muted;
      if (!muted && video.volume === 0) video.volume = 1;
      if (video.paused && !video.ended && (live || !muted)) tryPlay();
    },
    play() {
      // Played again after the end: from the start, unless a place has been picked since (Jump to the reveal sets one
      // just before playing, and this used to send it back to 0:00)
      if (status === 'ended' && video.currentTime >= video.duration - 0.5) video.currentTime = 0;
      tryPlay();
    },
    destroy() {
      dead = true;
      clearInterval(watchdog);
      stopEngine();
      container.innerHTML = '';
    },
  };
}
