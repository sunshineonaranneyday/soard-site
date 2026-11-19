/**
 * live-client.ts — one shared connection to the live broadcast state
 * ===================================================================
 * Used by the LIVE pill (every page) and the /live pages. Opens a WebSocket
 * to /api/live-ws (proxied to the real-time hub) so state changes arrive in
 * under a second; falls back to polling /api/broadcast when the socket is
 * unavailable. A single instance lives on window so the pill and the live
 * page never open two sockets.
 *
 * Watch party: a live page calls watch() so the hub counts it as a viewer,
 * then gets 'viewers', 'react' and 'msg' / 'msg-hide' events through on().
 */

import { noteArrival, sender } from './live-stats';

export interface LivePlayer {
  kind: 'live' | 'replay'; uid: string; customerCode: string;
  /** HLS address override; only the dev mock (scripts/dev-live-mock.js) sets it */
  src?: string;
}
export interface LiveState {
  phase: 'idle' | 'scheduled' | 'armed' | 'live' | 'ending' | 'replay';
  live: boolean; upcoming: boolean; replay: boolean;
  id: string | null;
  kidSlug: string | null; kidName: string | null;
  title: string | null; message: string | null; image: string | null;
  scheduledAt: string | null; liveAt: string | null; endedAt: string | null; replayUntil: string | null;
  url: string; liveUrl: string;
  player: LivePlayer | null;
  facebookUrl: string | null; youtubeUrl: string | null; instagramUrl: string | null;
  orientation: 'landscape' | 'portrait';
  source: string | null; updatedAt: string | null;
  /** A main-feed test just ended: until then a signed-in staff page shows its end (staff test end, below) */
  testEndUntil?: string;
  /** This is a test's end, shown to staff only (functions/api/broadcast-test-end.js) */
  testEnded?: boolean;
}
export interface ReminderOptions { enabled: boolean; hours?: number[]; email: boolean; sms: boolean; push: boolean; pushKey: string | null }
type Listener = (state: LiveState | null, meta: { reminders: ReminderOptions | null; timezone: string | null }) => void;
export type ReactionKind = 'heart' | 'sun' | 'clap' | 'wow';
export interface LiveMessage { id: string; name: string; body: string; at: string }
export interface LiveEvents {
  viewers: { n: number };
  react: { c: Partial<Record<ReactionKind, number>> };
  msg: { message: LiveMessage };
  'msg-hide': { id: string };
  connection: { connected: boolean };
  /** The live state couldn't be read (an error, or no connection) and nothing is known yet */
  unreachable: Record<string, never>;
}
type EventListener<K extends keyof LiveEvents> = (data: LiveEvents[K]) => void;

const KEY = '__soardLiveClient';

/**
 * A staff rehearsal of the live page (/live/…?rehearsal, opened from the admin's mic check through /admin/rehearsal):
 * the state comes from /api/broadcast-rehearsal (the private rehearsal feed, functions/api/_broadcast-rehearsal.js),
 * asked for every few seconds since the real-time hub carries only the real reveal; nothing is counted (reveal stats,
 * viewers, hearts), and leaving the page is a full page load, so no other page goes on reading the rehearsal. Decided
 * once, when the page is opened.
 */
export const rehearsal = (() => {
  try { return location.pathname.startsWith('/live/') && new URLSearchParams(location.search).has('rehearsal'); } catch { return false; }
})();
const STATE_URL = rehearsal ? '/api/broadcast-rehearsal' : '/api/broadcast';

/**
 * A main-feed test's end, for signed-in staff (Peter, Nov 18 2026: "Test the main feed" should end with the theater,
 * the thank-you and the replay; the public must never read that the reveal had ended before it started). When a test
 * stops, the public state is back to the countdown and carries `testEndUntil`; while it does, this page asks
 * /api/broadcast-test-end (staff only) and, if it answers, shows the test's end in place of the countdown, asked
 * again every few seconds so its replay comes in when Stream has it. Anyone else gets a 403 once and keeps the
 * countdown. Nothing of a test's end is counted.
 */
const TEST_END_URL = '/api/broadcast-test-end';
const TEST_END_POLL_MS = 5000;
// Only the live pages show it (the LIVE pill elsewhere keeps the countdown); read each time, the router keeps this client
const onLivePage = () => { try { return location.pathname.startsWith('/live'); } catch { return false; } };

function createClient() {
  let state: LiveState | null = null;
  let reminders: ReminderOptions | null = null;
  let timezone: string | null = null;
  const listeners = new Set<Listener>();
  const eventListeners: { [K in keyof LiveEvents]?: Set<EventListener<K>> } = {};
  let watching = false;
  const fire = <K extends keyof LiveEvents>(type: K, data: LiveEvents[K]) => {
    for (const l of (eventListeners[type] || []) as Set<EventListener<K>>) { try { l(data); } catch { /* listener bug */ } }
  };
  const send = (obj: unknown) => { if (!wsOk || !ws) return false; try { ws.send(JSON.stringify(obj)); return true; } catch { return false; } };
  let ws: WebSocket | null = null;
  let wsOk = false;
  let failures = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  // Listeners hear nothing until /api/broadcast has answered: the reminder options and time zone come only with it, and
  // the real-time hub's state (often first) without them read as "no reminders", so /live/ dropped its sign-up button
  // and form for a moment and put them back. A state from the hub before then is kept, and heard with the answer.
  let settled = false;
  // What the page shows: a staff test end in place of the public state while there is one
  const shown = () => staffEnd || state;
  const emit = () => { if (!settled) return; const s = shown(); for (const l of listeners) { try { l(s, { reminders, timezone }); } catch { /* listener bug */ } } };

  // A main-feed test's end, for signed-in staff (TEST_END_URL above)
  let staffEnd: LiveState | null = null;
  let notStaff = false;
  let staffBusy = false;
  let staffHeld = false;
  let staffTimer: ReturnType<typeof setTimeout> | undefined;
  const wantsStaffEnd = () => {
    const until = Date.parse(state?.testEndUntil || '');
    return !rehearsal && !notStaff && onLivePage() && !!state && !state.live && Number.isFinite(until) && until > Date.now();
  };
  async function askStaffEnd() {
    clearTimeout(staffTimer); staffTimer = undefined;
    if (staffBusy) return;
    if (!wantsStaffEnd()) {
      if (staffEnd || staffHeld) { staffEnd = null; staffHeld = false; emit(); }
      return;
    }
    staffBusy = true;
    let next = staffEnd;
    try {
      const res = await fetch(TEST_END_URL, { cache: 'no-store', redirect: 'manual' });
      if (res.status === 401 || res.status === 403 || res.type === 'opaqueredirect') { notStaff = true; next = null; }
      else if (res.ok) { const data = await res.json(); next = data?.state || null; }
    } catch { /* kept as it was; asked again shortly */ }
    staffBusy = false;
    if (!wantsStaffEnd()) next = null;
    const differs = JSON.stringify(next) !== JSON.stringify(staffEnd);
    staffEnd = next;
    if (differs || staffHeld) { staffHeld = false; emit(); }
    if (wantsStaffEnd()) staffTimer = setTimeout(askStaffEnd, TEST_END_POLL_MS);
  }
  // The public state changed: a test that just ended waits for the staff answer, so a staff page goes from the test
  // straight to its end without the countdown in between; anything else is heard at once
  const stateChanged = () => {
    if (wantsStaffEnd()) { if (!staffEnd) { staffHeld = true; void askStaffEnd(); return; } if (!staffTimer) void askStaffEnd(); }
    else if (staffEnd) { staffEnd = null; clearTimeout(staffTimer); staffTimer = undefined; }
    emit();
  };

  let unreachable = false;
  // No answer to wait for any more: whatever state the hub gave is heard (its reminders unknown)
  const failed = () => { settled = true; if (state) { emit(); return; } unreachable = true; fire('unreachable', {}); };
  async function fetchState() {
    try {
      const res = await fetch(STATE_URL, { cache: 'no-store' });
      // A rehearsal for someone not signed in (or signed out since): the admin signs them in and brings them back
      if (rehearsal && (res.status === 401 || res.status === 403) && window.top === window) { location.replace('/admin/rehearsal'); return; }
      if (!res.ok) { failed(); return; }
      const data = await res.json();
      if (data?.state) {
        state = data.state; reminders = data.reminders || null; timezone = data.timezone || null;
        settled = true;
        stateChanged();
      } else {
        // Answered with no state yet (the hub has no snapshot): the hub's own, if it gave one, is heard now
        settled = true;
        if (state) emit();
      }
    } catch { failed(); }
  }

  function pollDelay() {
    const p = state?.phase;
    // A rehearsal has no hub to hear changes from: asked often enough to change about when the reveal's pages would
    if (rehearsal) return p === 'live' || p === 'ending' || p === 'armed' ? 2500 : 5000;
    if (p === 'live' || p === 'ending' || p === 'armed') return 10_000;
    if (p === 'scheduled') return 30_000;
    return 60_000;
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (wsOk) return;
    pollTimer = setTimeout(async () => {
      if (!document.hidden) await fetchState();
      schedulePoll();
    }, pollDelay());
  }

  function connect() {
    if (rehearsal || !('WebSocket' in window)) { schedulePoll(); return; }
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live-ws`);
    } catch { schedulePoll(); return; }
    ws.onopen = () => {
      wsOk = true; failures = 0;
      if (watching) send({ t: 'watch' });
      fire('connection', { connected: true });
      clearTimeout(pollTimer);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { try { ws?.send('ping'); } catch { /* closing */ } }, 25_000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'state') {
          if (m.state) { state = m.state; stateChanged(); }
          else fetchState(); // hub has no snapshot yet
        } else if (m.type === 'viewers' && typeof m.n === 'number') fire('viewers', { n: m.n });
        else if (m.type === 'react' && m.c && typeof m.c === 'object') fire('react', { c: m.c });
        else if (m.type === 'msg' && m.message?.id) fire('msg', { message: m.message });
        else if (m.type === 'msg-hide' && m.id) fire('msg-hide', { id: m.id });
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (wsOk) fire('connection', { connected: false });
      wsOk = false;
      clearInterval(pingTimer);
      failures++;
      // Quick retries at first; if the hub really isn't there, back off to 5 min and rely on polling
      const delay = failures <= 4 ? Math.min(15_000, 1000 * 2 ** failures) : 5 * 60_000;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, delay);
      schedulePoll();
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* already closed */ } };
  }

  // How this tab arrived, for Reveal stats' "where viewers came from" (once per session)
  if (!rehearsal) noteArrival();
  else {
    // Leaving a rehearsal is a full page load (the router would keep this client, still reading the rehearsal)
    document.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      try { if (a && !new URL(a.href, location.href).searchParams.has('rehearsal')) a.setAttribute('data-astro-reload', ''); } catch { /* not a link we follow */ }
    }, true);
  }
  fetchState();
  connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { fetchState(); if (!wsOk && !reconnectTimer) connect(); }
  });

  return {
    subscribe(l: Listener) {
      listeners.add(l);
      if (state && settled && !staffHeld) l(shown(), { reminders, timezone });
      return () => listeners.delete(l);
    },
    /** Count this page as a viewer (live pages only). Re-sent after reconnects. */
    watch() { if (rehearsal) return; watching = true; send({ t: 'watch' }); },
    /** Stop counting this tab as a viewer (it navigated away from the live page). */
    unwatch() { if (!watching) return; watching = false; send({ t: 'unwatch' }); },
    /** Send a reaction to everyone watching. False when there is no real-time connection. */
    react(kind: ReactionKind) { return send({ t: 'react', k: kind }); },
    on<K extends keyof LiveEvents>(type: K, l: EventListener<K>) {
      ((eventListeners[type] ||= new Set() as never) as Set<EventListener<K>>).add(l);
      return () => (eventListeners[type] as Set<EventListener<K>>).delete(l);
    },
    get connected() { return wsOk; },
    /** Its first read failed and nothing is known yet: a page can show what it can without waiting */
    get unreachable() { return unreachable && !state; },
    get state() { return shown(); },
    get reminders() { return reminders; },
    get timezone() { return timezone; },
    refresh: fetchState,
    beacon(type: string, meta?: Record<string, string>, broadcastId?: string | null) {
      if (rehearsal || staffEnd) return;
      try {
        // (a child's own past reveal on their page counts as that reveal's, not the current one's: broadcastId)
        const body = JSON.stringify({ type, broadcastId: broadcastId || state?.id || undefined, meta, ...sender() });
        const blob = new Blob([body], { type: 'application/json' });
        if (!(navigator.sendBeacon && navigator.sendBeacon('/api/broadcast-event', blob))) {
          fetch('/api/broadcast-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        }
      } catch { /* analytics only */ }
    },
    /** Reveal stats: this browser watched `sec` more seconds of the reveal (live) or its replay */
    watched(kind: 'live' | 'replay', sec: number, broadcastId: string | null) {
      if (rehearsal || staffEnd || !broadcastId || !(sec > 0)) return;
      try {
        const body = JSON.stringify({ broadcastId, kind, sec, ...sender() });
        if (!(navigator.sendBeacon && navigator.sendBeacon('/api/live-watch', new Blob([body], { type: 'application/json' })))) {
          fetch('/api/live-watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        }
      } catch { /* counting only */ }
    },
  };
}

export type LiveClient = ReturnType<typeof createClient>;

export function getLiveClient(): LiveClient {
  const w = window as unknown as Record<string, LiveClient>;
  if (!w[KEY]) w[KEY] = createClient();
  return w[KEY];
}

// The time words ("in 8 days", "Wednesday, November 18 at 4:00 PM EST", "Reveal day") live in ./live-when, where the
// server can use them too (functions/live/[[path]].js writes the hero before the page script runs)
export { relativeUntil, revealLabel, formatWhen } from './live-when';
