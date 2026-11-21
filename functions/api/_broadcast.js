/**
 * Live broadcast state machine
 * ============================
 * The single source of truth for "what is the site showing about the live
 * reveal right now". State lives in D1 (site_config key "broadcast"),
 * settings in "broadcast-config", diagnostics in "broadcast-health".
 * Everything that changes state funnels through runTick() or adminAction()
 * so side effects fire exactly once.
 *
 * Concurrency: ticks arrive from the hub, webhooks, visitors and the admin,
 * on any number of isolates. Three guards keep them honest. A D1 lease lets
 * one tick (or admin command) run at a time; it lasts 15 s and a long tick
 * keeps extending it. Every state write bumps state.rev, and a tick saves
 * only over the copy it read (a phase change is saved before its side
 * effects run). Each one-time side effect takes a claim in D1
 * (broadcast_claims, broadcast_sends), so even two ticks that slip past the
 * lease can't post to Facebook or alert staff twice, and the go-live and
 * ended effects are retried on later ticks until claimed, so a tick cut off
 * after saving the phase change loses none of them.
 *
 * Phases
 *   idle       nothing planned
 *   scheduled  a reveal has a date; countdown + reminders are armed
 *   armed      within 30 min of the date; the hub polls fast
 *   live       Stream reports the input is receiving video
 *   ending     input dropped; 45 s grace so a cell hiccup doesn't end it
 *   replay     broadcast over; "Watch the replay" for replayHours, then idle
 *
 * Inputs: Stream's public lifecycle endpoint (authoritative), Cloudflare
 * Notification webhooks (a wake-up call that forces a lifecycle check), the
 * hub's timer ticks, and admin commands. A manual "banner only" override
 * (source: 'manual') still exists for the day Stream itself is down.
 *
 * Side effects: reminder sends (email / push, idempotent per
 * broadcast+kind+channel), Facebook API-mode live posts, replay detection +
 * captions + kid-page attach + rebuild, Kit drafts + the automatic Kit
 * "we're live" send, Slack/email alerts, the live feed watch (silent or
 * missing audio, frozen video, Facebook/YouTube not live: _broadcast-monitor.js),
 * analytics rows, audit log, and "Is the reveal over?" texted to the staff
 * numbers when the phone stops (askIfOver; their Y or N comes back through
 * functions/api/twilio-inbound.js to answerByText).
 */

import { logAudit } from './_audit.js';
import * as stream from './_stream-live.js';
import * as notify from './_broadcast-notify.js';
import * as fb from './_broadcast-fb.js';
import { attachToKid, matchKids } from './_fb-archive.js';
import { kitConfigured, kitCreateBroadcast, kitFindBroadcast } from './_kit.js';
import { wholeListFilter, signupsFilter, oneRevealFilter, signupTagIds } from './_reveal-signups.js';
import * as reels from './_broadcast-reel.js';
import * as monitor from './_broadcast-monitor.js';
import * as preflight from './_broadcast-preflight.js';
import * as revealStats from './_reveal-stats.js';
import { testGuests } from './_reveal-invites.js';
import { cfImg, HERO_TRANSFORM } from './_reveal-invite-email.js';
import { overLinkFor } from './_over-link.js';

export const STATE_KEY = 'broadcast';
export const CONFIG_KEY = 'broadcast-config';
export const HEALTH_KEY = 'broadcast-health';
export const SITE_ORIGIN = 'https://sunshineonaranneyday.com';
export const PHASES = ['idle', 'scheduled', 'armed', 'live', 'ending', 'replay'];

export const ARM_WINDOW_MS = 30 * 60 * 1000;
export const ENDING_GRACE_MS = 45 * 1000;
const SCHEDULED_EXPIRE_MS = 4 * 60 * 60 * 1000;
const MAX_LIVE_HOURS = 8;
const DEFAULT_REPLAY_HOURS = 72;
const TICK_MIN_INTERVAL_MS = 2500;
const LIFECYCLE_MIN_INTERVAL_MS = 4000;
const FB_PERMALINK_INTERVAL_MS = 60 * 1000;
const REPLAY_CHECK_INTERVAL_MS = 30 * 1000;
// A test's end shows to signed-in staff as the reveal's will (Peter, Nov 18 2026: he wants to see the real end in a
// test; the public stays on the countdown): "That's the reveal!", then the test's own recording as the replay, this long
const TEST_END_SHOW_MS = 10 * 60 * 1000;
const DAILY_HEALTH_MS = 24 * 60 * 60 * 1000;
const REVEAL_MORNING_HEALTH_MS = 6 * 60 * 60 * 1000;
const DEPLOY_COOLDOWN_MS = 10 * 60 * 1000;
// The automatic Kit send only fires when the stream starts this close to the
// scheduled time, so a phone test earlier in the day can't email the whole list.
const KIT_LIVE_EARLY_MS = 30 * 60 * 1000;
// Kit wants a future send_at; a minute out keeps it effectively immediate.
const KIT_SEND_DELAY_MS = 60 * 1000;
// The stream must stay up this long in one unbroken stretch before the list is emailed, so an accidental tap emails
// nobody. A planned reveal: one minute, and never before its planned start (liveNewsFrom), so a framing check before
// the start emails nobody (Peter, Nov 19 2026: Dylan's 10-minute reveal emailed the list at 4:04 after the old three
// minutes, and most people arrived as it ended). With no plan there is no start to wait for: three minutes, as before.
const KIT_LIVE_STEADY_MS = 60 * 1000;
const KIT_LIVE_STEADY_UNPLANNED_MS = 3 * 60 * 1000;
// Past this far into a broadcast a "come watch" email is too late to send by itself.
const KIT_LIVE_LATE_MS = 30 * 60 * 1000;
// How often to look for clues about which kid an unscheduled reveal is for.
const KID_CLUE_INTERVAL_MS = 60 * 1000;
// Going live and ending set things off (the Facebook post, the staff alert, the "we're live"
// reminders, the health report). Each is retried on every tick for this long until it has
// happened, so a tick cut off right after saving the phase change loses none of them. Past
// that, a broadcast is left alone (it ended long ago, or predates the claims).
const EFFECTS_RETRY_MS = 10 * 60 * 1000;
const HOOK_ENV_VARS = ['CF_PAGES_DEPLOY_HOOK', 'CF_DEPLOY_HOOK', 'DEPLOY_HOOK_URL'];
// Test mode ("Test the main feed quietly"): how long one turn of the switch lasts, and how
// often a tick looks at Stream's outputs while it is on (or puts them back after)
const QUIET_HOURS = 2;
const QUIET_OUTPUTS_CHECK_MS = 30 * 1000;
// Staff hear this long before the switch turns itself off, and again when it has (Peter, Nov 18 2026: his ran out at
// 11:20 with no word, and the phone he connected at 11:48 went out as Dylan's real reveal)
const QUIET_WARN_MS = 10 * 60 * 1000;
// A switch that ran out longer ago than this is old news (a deploy never brings up yesterday's)
const QUIET_ENDED_NEWS_MS = 15 * 60 * 1000;
// broadcast_claims holds the warnings' once-only keys under this name (they belong to the switch, not a broadcast)
const QUIET_CLAIMS = 'test-mode';
// While a broadcast is on air, the phone counts as gone once Stream has had it disconnected this long
// (sensePhone). A test ends quickly; a reveal waits 2 minutes, so a phone on weak signal that drops and
// reconnects stays one reveal (one "we're live", and the 3-minute wait before the Kit list email doesn't
// start over on every blip). The 45 s grace counts from the real stop, so a reveal ends 2 minutes after it.
const INPUT_DROP_TEST_MS = 15 * 1000;
const INPUT_DROP_REVEAL_MS = 2 * 60 * 1000;
// While on air, a failed read of the input changes nothing for this long after the last good one; past
// that (Stream's API down), the lifecycle decides, as it always did, so a reveal can still end
const INPUT_HOLD_MS = 2 * 60 * 1000;
// A reveal whose phone went quiet is over only if no phone comes back this long after the site ended it.
// Until then a reconnecting phone picks the same reveal up again (tRejoin), and what can't be undone waits:
// Facebook's post closing, the "Ended" announcement, the recording on the kid's page, the replay email
const REJOIN_MS = 15 * 60 * 1000;
// Recordings a reveal keeps track of (each reconnect after Stream's recording timeout starts a new one)
const MAX_RECORDINGS = 20;

// Per-isolate throttles (cheap; D1 stamps back them up)
let _lastTickAt = 0;
let _lastTickResult = null;
// A busy no-op is remembered only for slow callers (visitors), never the hub's heartbeat
let _lastBusyAt = 0;
let _lastBusyResult = null;
let _lastLifecycleAt = 0;
let _schemaReady = false;

const nowIso = () => new Date(Date.now()).toISOString(); // Date.now() so tests can travel in time

// ─── Schema ─────────────────────────────────────────────────────────

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    kid_slug TEXT, kid_name TEXT, title TEXT, message TEXT, image TEXT,
    scheduled_at TEXT, live_at TEXT, ended_at TEXT, phase TEXT,
    live_video_uid TEXT, replay_uid TEXT, fb_live_video_id TEXT, fb_permalink TEXT,
    source TEXT, data TEXT, created_at TEXT, updated_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at)`,
  `CREATE TABLE IF NOT EXISTS broadcast_reminders (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    address TEXT NOT NULL,
    subscription TEXT,
    kid_slug TEXT,
    token TEXT NOT NULL,
    source TEXT,
    created_at TEXT, unsubscribed_at TEXT, last_sent_at TEXT,
    fails INTEGER DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_addr ON broadcast_reminders(channel, address)`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_token ON broadcast_reminders(token)`,
  `CREATE TABLE IF NOT EXISTS broadcast_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id TEXT NOT NULL, kind TEXT NOT NULL, channel TEXT NOT NULL,
    recipients INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0,
    error TEXT, created_at TEXT,
    UNIQUE(broadcast_id, kind, channel)
  )`,
  `CREATE TABLE IF NOT EXISTS broadcast_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id TEXT, type TEXT NOT NULL, meta TEXT, created_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bevents ON broadcast_events(broadcast_id, type)`,
  // One-time side effects of a broadcast (claimOnce): the Facebook live post, staff alerts, the replay's Kit draft
  `CREATE TABLE IF NOT EXISTS broadcast_claims (
    broadcast_id TEXT NOT NULL, key TEXT NOT NULL, result TEXT, created_at TEXT,
    PRIMARY KEY (broadcast_id, key)
  )`,
  // The tick lease (acquireTickLease): who holds it, until when, and when the last tick started
  `CREATE TABLE IF NOT EXISTS broadcast_locks (
    name TEXT PRIMARY KEY, holder TEXT, expires_at INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL DEFAULT 0
  )`,
];

export async function ensureSchema(DB) {
  if (_schemaReady) return;
  await DB.batch(SCHEMA.map(sql => DB.prepare(sql)));
  _schemaReady = true;
}

// ─── Config / state / health records ────────────────────────────────

export function defaultConfig() {
  return {
    version: 1,
    customerCode: stream.DEFAULT_CUSTOMER_CODE,
    liveInput: null,       // full Stream live input record (includes ingest secrets; admin-only)
    rehearsalInput: null,
    outputs: {},           // { facebook: { uid, url, keyMask, enabled, createdAt }, youtube: {...} }
    facebook: { mode: 'persistent', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay' },
    youtube: { channelUrl: 'https://www.youtube.com/@sunshineonaranneyday/live' },
    instagram: { profileUrl: 'https://www.instagram.com/sunshineonaranneyday' },
    orientation: 'portrait',   // what the crew shoots; the site player matches (the team shoots vertical)
    reels: reels.defaultReelConfig(), // automatic Instagram Reel of every replay
    reminders: { enabled: true, hoursBefore: [24, 1], push: true },
    replayHours: DEFAULT_REPLAY_HOURS,
    timezone: 'America/New_York',
    alerts: { emails: [] },
    defaults: { title: 'Live room reveal', message: "It's reveal day! We're live right now." },
    // Email the Kit list when a scheduled reveal goes live. Each reveal can opt out (state.kitLiveEmail).
    kitLive: { enabled: true },
    messages: { enabled: true }, // viewers' notes for the family on the live page (functions/api/_live-messages.js)
    vapid: null,           // { publicKey, privateJwk, createdAt }
    setupAt: null, setupBy: null, updatedAt: null,
  };
}

export function defaultState() {
  return {
    version: 2,
    phase: 'idle',
    broadcastId: null,
    kidSlug: null, kidName: null,
    jobId: null,           // the JobTread job this reveal was scheduled from (_broadcast-schedule.js)
    test: false,           // a rehearsal from a JobTread "TEST …" job: invisible to the public, reminders to the test address only
    title: null, message: null, image: null,
    scheduledAt: null, armedAt: null, liveAt: null, endedAt: null, disconnectedAt: null,
    liveVideoUid: null, replayUid: null, replayReadyAt: null, replayUntil: null,
    endedVideoUid: null,   // the last recording that ended: a lifecycle still reporting it live starts nothing (sensePhone)
    endedVideoAt: null,    // when it ended: a phone connected after that is a new one
    gapSince: null,        // on air, the phone has been disconnected since (a drop shorter than INPUT_DROP_*_MS)
    holdUntil: null,       // the crew texted N ("the signal dropped"): on air, Reconnecting, until the phone is back or this passes
    recordings: [],        // every Stream recording of this broadcast, in order (the replay is the longest)
    rejoinUntil: null,     // a reveal ended by its phone stopping: a phone back before this picks it up again (REJOIN_MS)
    overSaid: false,       // the crew answered Y to "Is the reveal over?": what reaches people goes at once (rejoin still open)
    endedBy: null,         // who ended it (an admin's email, "text from …1234"); null when it ended on its own
    closedAt: null,        // when that window closed and the reveal was over for good (the final effects run from then)
    replayPieces: null,    // { count, minutes } when the reveal was recorded in more than one piece
    testEnd: null,         // a test that just ended, shown to signed-in staff as the reveal's end would be (tEndQuiet)
    preShowFb: null,       // the Facebook live post a framing check opened, to release and close (preShowEffects)
    preShowNote: null,     // a framing check just ended: staff are told once (preShowEffects)
    fbReopen: false,       // picked up again (tRejoin): open a new Facebook post (preShowEffects)
    fbReleaseKey: null,    // which framing check or pick-up the Facebook release belongs to (done once each)
    fbSessionAt: null,     // when this stretch on air began: its Facebook post and closing claims date from then
    fbEarlier: [],         // the reveal's Facebook live posts from before a pick-up ({ liveVideoId, permalink }): History adds their numbers to the last one's
    replayOut: null,       // false once a reveal ends, true when its replay has gone out (kid's page, replay email, Kit draft, Reel); null: a state from before
    replayStartedAt: null, // when the replay's recording began (after a long reconnect, later than liveAt): reveal stats line its moment up with the live minutes
    revealAtSeconds: null, // admin override for where the reveal happens in the recording
    reel: null,            // Instagram Reel pipeline (functions/api/_broadcast-reel.js)
    fb: { liveVideoId: null, permalink: null, outputUid: null, checkedAt: null, needsReview: false },
    kit: { scheduledDraftId: null, replayDraftId: null, live: null }, // live: { id, audience, sendAt, by, error }
    kitLiveEmail: null,    // per-reveal override of config.kitLive.enabled; null = follow the setting
    segmentAt: null,       // start of the current unbroken stretch of video (resets on reconnect)
    kidVia: null,          // how the kid was known: 'scheduled' | 'admin' | 'facebook-live' | 'facebook-post'
    kidCheckAt: null, kidAlertAt: null,
    source: null,          // 'stream' | 'manual'
    manual: null,          // { url, until } for banner-only overrides
    note: null,
    clicks: 0,
    createdAt: null, updatedAt: null, updatedBy: null,
  };
}

export function defaultHealth() {
  return {
    lastDailyAt: null,
    stream: { ok: null, error: null, at: null },
    facebook: { ok: null, name: null, error: null, at: null },
    hub: { ok: null, clients: 0, at: null },
    webhook: { lastReceivedAt: null, lastEvent: null, count: 0 },
    lifecycle: { at: null, live: null, videoUID: null, inputUid: null },
    replayCheckAt: null,
    lastAutoDeployAt: null,
    flags: {},             // dedupe for alerts: { streamToken: 'bad', ... }
    lastTick: null,
  };
}

async function readJson(DB, key, fallback) {
  const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(key).first();
  if (!row) return fallback();
  try { return { ...fallback(), ...JSON.parse(row.data) }; } catch { return fallback(); }
}

async function writeJson(DB, key, value) {
  await DB.prepare('INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)')
    .bind(key, JSON.stringify(value), nowIso()).run();
}

export const readConfig = (DB) => readJson(DB, CONFIG_KEY, defaultConfig);
export const writeConfig = (DB, c) => writeJson(DB, CONFIG_KEY, { ...c, updatedAt: nowIso() });
export const readState = (DB) => readJson(DB, STATE_KEY, defaultState);
export const readHealth = (DB) => readJson(DB, HEALTH_KEY, defaultHealth);

// ─── Test mode ──────────────────────────────────────────────────────

/**
 * Test mode: one switch in Admin → Broadcast. While it is on, a phone on the
 * main feed shows on the website exactly as a reveal would (the live page, the
 * banner, the kid's page) and nothing else happens: nobody is emailed (sign-ups
 * or Kit), Facebook and YouTube get nothing (Stream's outputs are paused while
 * it is on), no Instagram Reel, no staff "Live now", no History row, and the
 * recording is never put on a kid's page.
 *
 * A test is its own broadcast (state.quiet, a fresh broadcastId, so none of the
 * planned reveal's claims are touched) and carries the state it interrupted
 * (state.resume). When the phone stops, that comes back as it was: a scheduled
 * reveal is scheduled again. The switch turns itself off QUIET_HOURS after it
 * was turned on, and always ARM_WINDOW_MS before a scheduled reveal; a test
 * still streaming at that point becomes the reveal itself.
 *
 * Kept apart from the config (key broadcast-quiet), so a tick writing it never
 * races an admin saving Settings.
 */
export const QUIET_KEY = 'broadcast-quiet';
export function defaultQuiet() {
  return { until: null, by: null, at: null, paused: [], checkedAt: null };
}
export const readQuiet = (DB) => readJson(DB, QUIET_KEY, defaultQuiet);
const writeQuiet = (DB, q) => writeJson(DB, QUIET_KEY, q);

/** When the reveal that `state` plans (or that a running test interrupted) starts, in ms; null when none */
function plannedAt(state) {
  const s = state?.quiet ? state.resume : state;
  if (!s || s.test || !['scheduled', 'armed'].includes(s.phase)) return null;
  const at = Date.parse(s.scheduledAt || '');
  return Number.isFinite(at) ? at : null;
}

/** When the switch really goes off: its own timer, or the planned reveal's arm window if that comes first. ms or null */
export function quietUntil(q, state) {
  const own = Date.parse(q?.until || '');
  if (!Number.isFinite(own)) return null;
  const at = plannedAt(state);
  return at != null ? Math.min(own, at - ARM_WINDOW_MS) : own;
}

/** Is the switch on (a phone going live now starts a test)? */
export function quietOn(q, state, now = Date.now()) {
  // A reveal on air is never a test, and Facebook stays on for it whatever the switch's timer says
  if (state && !state.quiet && ['live', 'ending'].includes(state.phase)) return false;
  const until = quietUntil(q, state);
  return until != null && now < until;
}

/** A running test has reached its reveal's arm window: the phone streaming now is the reveal */
function quietReachedReveal(state, now = Date.now()) {
  const at = plannedAt(state);
  return !!state?.quiet && at != null && now >= at - ARM_WINDOW_MS;
}

/** For the admin: the switch, when it goes off, and how many Stream outputs it is holding paused */
export function quietStatus(q, state, now = Date.now()) {
  const on = quietOn(q, state, now);
  const until = quietUntil(q, state);
  return { on, until: on ? new Date(until).toISOString() : null, by: q?.by || null, paused: Array.isArray(q?.paused) ? q.paused.length : 0 };
}

// A field of the stored row, NULL when the row isn't JSON (the readers then fall back to defaults)
const stored = (col, path) => `(CASE WHEN json_valid(${col}) THEN json_extract(${col}, '${path}') END)`;

// The state JSON (?1) as written: rev set in SQL, and the banner click count
// never rolled back for the same broadcast (countBannerClick bumps it in place)
const stateData = (col, revSql) => `json_set(?1, '$.rev', ${revSql}, '$.clicks',
  CASE WHEN ${stored(col, '$.broadcastId')} IS json_extract(?1, '$.broadcastId')
    THEN MAX(COALESCE(${stored(col, '$.clicks')}, 0), COALESCE(json_extract(?1, '$.clicks'), 0))
    ELSE COALESCE(json_extract(?1, '$.clicks'), 0) END)`;

/**
 * Save the state. Every write bumps state.rev in SQL, so a tick that read an
 * older copy can tell it lost the race (writeStateIf). Admin commands use this
 * one: they hold the tick lease, and what staff asked for wins.
 */
export async function writeState(DB, s) {
  await DB.prepare(`INSERT INTO site_config (key, data, updated_at) VALUES (?2, json_set(?1, '$.rev', 1), ?3)
    ON CONFLICT(key) DO UPDATE SET data = ${stateData('site_config.data', `COALESCE(${stored('site_config.data', '$.rev')}, 0) + 1`)}, updated_at = ?3`)
    .bind(JSON.stringify(s), STATE_KEY, nowIso()).run();
}

/** Save `s` only if the stored state is still at `rev`. → true when saved (the stored rev is then rev + 1) */
export async function writeStateIf(DB, s, rev) {
  const r = await DB.prepare(`UPDATE site_config SET data = ${stateData('data', '?2 + 1')}, updated_at = ?3
    WHERE key = ?4 AND COALESCE(${stored('data', '$.rev')}, 0) = ?2`)
    .bind(JSON.stringify(s), rev, nowIso(), STATE_KEY).run();
  if ((r?.meta?.changes || 0) > 0) return true;
  if (rev) return false;
  // Nothing stored yet: the first write wins
  const ins = await DB.prepare(`INSERT OR IGNORE INTO site_config (key, data, updated_at) VALUES (?, json_set(?, '$.rev', 1), ?)`)
    .bind(STATE_KEY, JSON.stringify(s), nowIso()).run();
  return (ins?.meta?.changes || 0) > 0;
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Three-way merge for a tick that lost the race to save. `base` is the copy
 * it read, `ours` what it wants to save, `theirs` what is stored now. Each key
 * the tick changed goes over theirs, unless they changed it too (theirs
 * wins). A different broadcast or phase on their side (cancel, end, reset, a
 * new schedule) wins outright. → { state, dropped }
 */
export function mergeState(base, ours, theirs) {
  if ((theirs.broadcastId ?? null) !== (base.broadcastId ?? null) || (theirs.phase || 'idle') !== (base.phase || 'idle')) {
    return { state: theirs, dropped: true };
  }
  const out = { ...theirs };
  for (const k of new Set([...Object.keys(base), ...Object.keys(ours)])) {
    if (k === 'rev' || k === 'updatedAt' || sameJson(ours[k], base[k]) || !sameJson(theirs[k], base[k])) continue;
    if (ours[k] === undefined) delete out[k];
    else out[k] = ours[k];
  }
  return { state: out, dropped: false };
}

/**
 * Save a tick's state over the copy it read (`base`, at `rev`), merging over
 * anything written since (mergeState). → { state, dropped }: `state` is what
 * is stored now, `dropped` when the tick's changes gave way entirely.
 */
async function commitState(DB, base, ours, rev) {
  let next = ours;
  let at = rev;
  for (let i = 0; i < 3; i++) {
    if (await writeStateIf(DB, next, at)) return { state: { ...next, rev: at + 1 }, dropped: false };
    const theirs = await readState(DB);
    const m = mergeState(base, ours, theirs);
    if (m.dropped) return { state: theirs, dropped: true };
    next = m.state;
    at = Number(theirs.rev) || 0;
  }
  return { state: await readState(DB), dropped: true };
}

/**
 * Count a click on the LIVE banner for `broadcastId`, in place (json_set), so
 * a public click never rewrites the state record. Only while that broadcast
 * is the current one and not idle.
 */
export async function countBannerClick(DB, broadcastId) {
  await DB.prepare(`UPDATE site_config SET data = json_set(data, '$.clicks', COALESCE(json_extract(data, '$.clicks'), 0) + 1)
    WHERE key = ? AND ${stored('data', '$.broadcastId')} = ? AND ${stored('data', '$.phase')} != 'idle'`)
    .bind(STATE_KEY, broadcastId).run();
}

// Health entries that belong to /api/stream-webhook, each written by one statement of its own (noteWebhook,
// noteEncoderError)
const WEBHOOK_OWNED = ['$.webhook', '$.encoderError'];

/**
 * Save the health record. Its `webhook` and `encoderError` entries belong to
 * /api/stream-webhook, so the stored ones are kept whatever this copy says: a
 * tick that read health before a webhook arrived can't wipe them.
 */
export async function writeHealth(DB, h) {
  const keep = WEBHOOK_OWNED.reduce((sql, path) => `CASE WHEN json_type(${stored('site_config.data', path)}) = 'object'
      THEN json_set(${sql}, '${path}', json(json_extract(site_config.data, '${path}'))) ELSE ${sql} END`, '?2');
  await DB.prepare(`INSERT INTO site_config (key, data, updated_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET data = ${keep}, updated_at = ?3`)
    .bind(HEALTH_KEY, JSON.stringify(h), nowIso()).run();
}

/**
 * Note a Stream encoder error on the live input (live_input.errored) in
 * health.encoderError, in one statement like noteWebhook. Nobody hears of it
 * here: the feed watch decides (_broadcast-monitor.js encoderWatch). Errors
 * less than `windowMs` apart are one run (firstAt kept, count up); a longer
 * quiet starts a new run. `code` and the codecs come from fixed lists only.
 */
export async function noteEncoderError(DB, { code = null, videoCodec = 'unknown', audioCodec = 'unknown', windowMs = 10 * 60e3 } = {}) {
  const prev = (field) => stored('site_config.data', `$.encoderError.${field}`);
  const sameRun = `(${prev('lastAt')} >= ?3)`;
  const entry = (first, count) => `json_object('firstAt', ${first}, 'lastAt', ?2, 'count', ${count}, 'code', ?4, 'videoCodec', ?5, 'audioCodec', ?6)`;
  await DB.prepare(`INSERT INTO site_config (key, data, updated_at) VALUES (?1, json_object('encoderError', ${entry('?2', '1')}), ?2)
    ON CONFLICT(key) DO UPDATE SET data = json_set(CASE WHEN json_valid(site_config.data) THEN site_config.data ELSE '{}' END, '$.encoderError',
      ${entry(`CASE WHEN ${sameRun} THEN ${prev('firstAt')} ELSE ?2 END`, `CASE WHEN ${sameRun} THEN COALESCE(${prev('count')}, 0) + 1 ELSE 1 END`)}), updated_at = ?2`)
    .bind(HEALTH_KEY, nowIso(), new Date(Date.now() - windowMs).toISOString(), code, videoCodec, audioCodec).run();
}

/**
 * Record a Cloudflare notification in health.webhook with one statement, so
 * it never races a tick's health write. `event` is one of Stream's three
 * event names or 'test'; `inputId` only when it is one of our inputs.
 */
export async function noteWebhook(DB, { event, inputId = null, signed = false }) {
  const count = `COALESCE(${stored('site_config.data', '$.webhook.count')}, 0) + 1`;
  const entry = (n) => `json_object('lastReceivedAt', ?2, 'lastEvent', ?3, 'lastInputId', ?4, 'signed', json(?5), 'count', ${n})`;
  await DB.prepare(`INSERT INTO site_config (key, data, updated_at) VALUES (?1, json_object('webhook', ${entry('1')}), ?2)
    ON CONFLICT(key) DO UPDATE SET data = json_set(CASE WHEN json_valid(site_config.data) THEN site_config.data ELSE '{}' END, '$.webhook', ${entry(count)}), updated_at = ?2`)
    .bind(HEALTH_KEY, nowIso(), event, inputId, signed ? 'true' : 'false').run();
}

// ─── Derived views ──────────────────────────────────────────────────

export function liveUrlFor(state) {
  return state?.kidSlug ? `${SITE_ORIGIN}/live/${state.kidSlug}/` : `${SITE_ORIGIN}/live/`;
}

/** The live page with where the link was sent (?src=email, push…), so History can say where viewers came from */
export function liveLinkFor(state, src) {
  return src ? `${liveUrlFor(state)}?src=${encodeURIComponent(src)}` : liveUrlFor(state);
}

/**
 * The broadcast as anyone outside the admin may know it. A rehearsal (a
 * JobTread "TEST …" job, state.test) runs the real pipeline but stays
 * invisible: to the public site, the live page, the hub and the reminder
 * signup it looks like nothing is scheduled.
 */
export function visibleState(state) {
  return state?.test ? { ...defaultState(), updatedAt: state.updatedAt || null } : state;
}

/** What the public site and the hub see. No secrets. A rehearsal is hidden unless `includeTest` (admin only). */
export function publicState(state, config, { includeTest = false } = {}) {
  if (!includeTest) state = visibleState(state);
  const phase = state.phase || 'idle';
  const live = phase === 'live' || phase === 'ending';
  const upcoming = phase === 'scheduled' || phase === 'armed';
  const replay = phase === 'replay';
  const liveUrl = liveUrlFor(state);
  const code = config?.customerCode || stream.DEFAULT_CUSTOMER_CODE;
  let player = null;
  if (live && state.source === 'stream' && config?.liveInput?.uid) player = { kind: 'live', uid: config.liveInput.uid, customerCode: code };
  else if (replay && state.replayUid) player = { kind: 'replay', uid: state.replayUid, customerCode: code };
  return {
    phase, live, upcoming, replay,
    id: state.broadcastId,
    kidSlug: state.kidSlug, kidName: state.kidName,
    title: state.title, message: state.message, image: state.image,
    scheduledAt: state.scheduledAt, liveAt: state.liveAt, endedAt: state.endedAt, replayUntil: state.replayUntil,
    url: state.manual?.url || liveUrl,
    liveUrl,
    player,
    facebookUrl: state.fb?.permalink || config?.facebook?.pageUrl || null,
    youtubeUrl: config?.youtube?.channelUrl || null,
    instagramUrl: config?.instagram?.profileUrl || null,
    orientation: config?.orientation === 'portrait' ? 'portrait' : 'landscape',
    source: state.source,
    ...(state.test ? { test: true } : {}),
    // A test just ended (tEndQuiet): the public page stays on the countdown; this only tells a signed-in staff page
    // to ask /api/broadcast-test-end for the test's end (testEndPublicState). It says nothing on the page itself
    ...(testEndShowing(state) ? { testEndUntil: state.testEnd.until } : {}),
    updatedAt: state.updatedAt,
  };
}

/**
 * A test that just ended, as the reveal's end will look (Peter, Nov 18 2026: "Test the main feed" should end with the
 * theater, the thank-you and the replay, but the public must never read that Dylan's reveal had ended before it
 * started): ended, then its own recording as the replay once Stream has it (findTestReplay). Staff only: read by
 * /api/broadcast-test-end, never by the public page or the hub. Null when no test end is showing.
 */
export function testEndPublicState(state, config) {
  if (!testEndShowing(state)) return null;
  const te = state.testEnd;
  const code = config?.customerCode || stream.DEFAULT_CUSTOMER_CODE;
  const shown = { ...state, phase: 'replay', broadcastId: te.broadcastId, kidSlug: te.kidSlug ?? state.kidSlug, kidName: te.kidName ?? state.kidName,
    title: te.title ?? state.title, liveAt: te.liveAt, endedAt: te.at, replayUntil: te.until, replayUid: null, source: 'stream', testEnd: null };
  const p = publicState(shown, config, { includeTest: true });
  return { ...p, player: te.replayUid ? { kind: 'replay', uid: te.replayUid, customerCode: code } : null, testEnded: true };
}

/** The shape the original LiveIndicator + admin Go Live read. */
export function legacyState(state, config, opts) {
  if (!opts?.includeTest) state = visibleState(state);
  const p = publicState(state, config, opts);
  let endsAt = null;
  if (p.live) endsAt = state.manual?.until || (state.liveAt ? new Date(Date.parse(state.liveAt) + MAX_LIVE_HOURS * 3600e3).toISOString() : null);
  else if (p.upcoming) endsAt = state.scheduledAt ? new Date(Date.parse(state.scheduledAt) + 6 * 3600e3).toISOString() : null;
  else if (p.replay) endsAt = state.replayUntil;
  return {
    live: p.live, upcoming: p.upcoming, replay: p.replay, phase: p.phase,
    message: p.message || '', url: p.url, liveUrl: p.liveUrl,
    startsAt: p.scheduledAt, endsAt, id: p.id, clicks: state.clicks || 0, image: p.image || null,
    kidName: p.kidName, kidSlug: p.kidSlug, player: p.player, facebookUrl: p.facebookUrl,
    auto: true,
  };
}

// ─── Hub (Durable Object) ───────────────────────────────────────────

function hubStub(env) {
  if (!env.LIVE_HUB) return null;
  try { return env.LIVE_HUB.get(env.LIVE_HUB.idFromName('main')); } catch { return null; }
}

export async function publishToHub(env, state, config, reason, event) {
  const stub = hubStub(env);
  if (!stub) return { ok: false, skipped: true, error: 'LIVE_HUB binding missing' };
  try {
    // The hub hands `reason` to every open page, so only its kind goes ('admin', 'webhook', 'tick'), never details
    const res = await stub.fetch('https://hub/publish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: publicState(state, config), reason: String(reason || 'publish').split(':')[0], event }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// The hub's nonces are crypto.randomUUID(); anything else is refused before it can wake the object
const HUB_NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyHubNonce(env, nonce) {
  if (typeof nonce !== 'string' || !HUB_NONCE.test(nonce)) return false;
  const stub = hubStub(env);
  if (!stub) return false;
  try {
    const res = await stub.fetch('https://hub/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce }) });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}

export async function hubStatus(env) {
  const stub = hubStub(env);
  if (!stub) return { ok: false, bound: false, error: 'LIVE_HUB binding missing (add durable_objects binding in wrangler.toml and redeploy)' };
  try {
    const res = await stub.fetch('https://hub/status');
    return { bound: true, ...(await res.json()) };
  } catch (e) {
    return { ok: false, bound: true, error: e.message };
  }
}

export async function hubTick(env) {
  const stub = hubStub(env);
  if (!stub) return { ok: false, error: 'LIVE_HUB binding missing' };
  try {
    const res = await stub.fetch('https://hub/tick', { method: 'POST' });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Rows / events ──────────────────────────────────────────────────

async function upsertBroadcastRow(DB, s) {
  // A test on the main feed is not a reveal: History never lists it
  if (!s.broadcastId || s.quiet) return;
  await DB.prepare(`INSERT INTO broadcasts (id, kid_slug, kid_name, title, message, image, scheduled_at, live_at, ended_at, phase,
      live_video_uid, replay_uid, fb_live_video_id, fb_permalink, source, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kid_slug=excluded.kid_slug, kid_name=excluded.kid_name, title=excluded.title, message=excluded.message,
      image=excluded.image, scheduled_at=excluded.scheduled_at, live_at=excluded.live_at, ended_at=excluded.ended_at, phase=excluded.phase,
      live_video_uid=excluded.live_video_uid, replay_uid=excluded.replay_uid, fb_live_video_id=excluded.fb_live_video_id,
      fb_permalink=excluded.fb_permalink, source=excluded.source, data=excluded.data, updated_at=excluded.updated_at`)
    .bind(s.broadcastId, s.kidSlug, s.kidName, s.title, s.message, s.image, s.scheduledAt, s.liveAt, s.endedAt, s.phase,
      s.liveVideoUid, s.replayUid, s.fb?.liveVideoId || null, s.fb?.permalink || null, s.source,
      JSON.stringify({ clicks: s.clicks || 0, note: s.note, kit: s.kit, kitLiveEmail: s.kitLiveEmail ?? null, replayUntil: s.replayUntil, reel: s.reel || null, jobId: s.jobId || null, test: !!s.test, revealAtSeconds: s.revealAtSeconds ?? null, replayStartedAt: s.replayStartedAt || null,
        // Facebook posts from before a pick-up (the last one is fb_live_video_id / fb_permalink): History adds them up
        ...(Array.isArray(s.fbEarlier) && s.fbEarlier.length ? { fbEarlier: s.fbEarlier } : {}) }), s.createdAt || nowIso(), nowIso()).run();
}

/**
 * Mark a planned broadcast's row as finished ('cancelled', 'missed') before the
 * state is cleared. tClear drops the broadcastId, so the persist step can't
 * update the row afterwards, and History would keep calling it "Coming up".
 */
async function closeBroadcastRow(DB, s, phase, { endedNow = true } = {}) {
  if (!s.broadcastId || s.quiet) return;
  // One that had gone live gets its end time too (when it really ended now), so History doesn't call it live and
  // reveal stats read its totals. An emergency banner that ran out on its timer ended some time before: no end time
  await DB.prepare(`UPDATE broadcasts SET phase = ?, updated_at = ?, ended_at = CASE WHEN live_at IS NOT NULL AND ? THEN COALESCE(ended_at, ?) ELSE ended_at END WHERE id = ?`)
    .bind(phase, nowIso(), endedNow ? 1 : 0, nowIso(), s.broadcastId).run();
}

export async function recordEvent(DB, broadcastId, type, meta) {
  try {
    await DB.prepare('INSERT INTO broadcast_events (broadcast_id, type, meta, created_at) VALUES (?, ?, ?, ?)')
      .bind(broadcastId || null, type, meta ? JSON.stringify(meta).slice(0, 2000) : null, nowIso()).run();
  } catch { /* analytics only */ }
}

async function triggerDeploy(env, health, reason) {
  const hook = HOOK_ENV_VARS.map(k => env[k]).find(Boolean);
  if (!hook) return false;
  const last = health.lastAutoDeployAt ? Date.parse(health.lastAutoDeployAt) : 0;
  if (Date.now() - last < DEPLOY_COOLDOWN_MS) return false;
  try {
    const res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    health.lastAutoDeployAt = nowIso();
    await logAudit(env.DB, { userEmail: 'live-broadcast', action: 'deployed', entityType: 'site', entityName: reason, gitStatus: 'ok', path: '/api/broadcast-hooks' });
    return true;
  } catch {
    return false;
  }
}

// ─── One tick at a time ─────────────────────────────────────────────

// About two heartbeats: a holder that died mid-tick (a D1 error, a cancelled request)
// blocks the next tick at most this long. A long tick keeps extending it (extendTickLease).
const TICK_LEASE_MS = 15 * 1000;
const LEASE_EXTEND_AFTER_MS = 5 * 1000;
const ADMIN_LEASE_WAIT_MS = 8 * 1000;
const FORCED_LEASE_WAIT_MS = 5 * 1000;
const UNLEASED = 'unleased';

/**
 * Take the tick lease (one row in D1, shared by every isolate). A throttled
 * caller (`minIntervalMs`) also needs the last tick to have started at least
 * that long ago, so visitors and unsigned webhooks can't stack ticks however
 * many isolates they land on. → holder id, or null when someone else has it.
 * If D1 can't answer, the tick runs anyway ('unleased'): the rev check on the
 * state write and the side-effect claims still hold.
 */
async function acquireTickLease(DB, { minIntervalMs = null } = {}) {
  const holder = crypto.randomUUID();
  const now = Date.now();
  const startedBefore = minIntervalMs == null ? now + 60 * 1000 : now - minIntervalMs;
  try {
    const row = await DB.prepare(`INSERT INTO broadcast_locks (name, holder, expires_at, started_at) VALUES ('tick', ?1, ?2, ?3)
      ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at, started_at = excluded.started_at
      WHERE broadcast_locks.expires_at <= ?3 AND broadcast_locks.started_at <= ?4
      RETURNING holder`).bind(holder, now + TICK_LEASE_MS, now, startedBefore).first();
    return row?.holder === holder ? holder : null;
  } catch {
    return UNLEASED;
  }
}

/** Wait up to `waitMs` for the lease (admin commands, forced ticks). Gives up and runs unleased rather than fail. */
async function waitForTickLease(DB, waitMs) {
  const until = Date.now() + waitMs;
  for (;;) {
    const holder = await acquireTickLease(DB);
    if (holder) return holder;
    if (Date.now() >= until) return UNLEASED;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Push the lease out again during a long tick. → false when another tick holds it now */
async function extendTickLease(DB, holder) {
  if (!holder || holder === UNLEASED) return true;
  try {
    const r = await DB.prepare(`UPDATE broadcast_locks SET expires_at = ? WHERE name = 'tick' AND holder = ?`)
      .bind(Date.now() + TICK_LEASE_MS, holder).run();
    return (r?.meta?.changes || 0) > 0;
  } catch {
    return true;
  }
}

async function releaseTickLease(DB, holder) {
  if (!holder || holder === UNLEASED) return;
  await DB.prepare(`UPDATE broadcast_locks SET expires_at = 0 WHERE name = 'tick' AND holder = ?`).bind(holder).run().catch(() => {});
}

// ─── One-time side effects ──────────────────────────────────────────

/**
 * Claim a one-time side effect of a broadcast: the Facebook live post, the
 * staff "Live now" and "Ended" alerts, the replay's Kit draft and rebuild.
 * Only the first caller per (broadcast, key) gets true, in every isolate.
 * settleClaim keeps what the side effect made (the Facebook video id, the Kit
 * draft id) so a later tick can read it back with claimResult.
 */
async function claimOnce(DB, broadcastId, key) {
  if (!broadcastId) return true;
  try {
    const r = await DB.prepare('INSERT OR IGNORE INTO broadcast_claims (broadcast_id, key, created_at) VALUES (?, ?, ?)')
      .bind(broadcastId, key, nowIso()).run();
    return (r?.meta?.changes || 0) > 0;
  } catch {
    return false;
  }
}

async function settleClaim(DB, broadcastId, key, result) {
  if (!broadcastId) return;
  await DB.prepare('UPDATE broadcast_claims SET result = ? WHERE broadcast_id = ? AND key = ?')
    .bind(JSON.stringify(result), broadcastId, key).run().catch(() => {});
}

/** Every claim a broadcast has taken, in one read */
async function claimedKeys(DB, broadcastId) {
  if (!broadcastId) return new Set();
  const res = await DB.prepare('SELECT key FROM broadcast_claims WHERE broadcast_id = ?').bind(broadcastId).all().catch(() => null);
  return new Set((res?.results || []).map((r) => r.key));
}

async function claimResult(DB, broadcastId, key) {
  if (!broadcastId) return null;
  const row = await DB.prepare('SELECT result FROM broadcast_claims WHERE broadcast_id = ? AND key = ?').bind(broadcastId, key).first().catch(() => null);
  try { return row?.result ? JSON.parse(row.result) : null; } catch { return null; }
}

/** claimOnce that tells "taken already" (false) from "D1 didn't answer" (null), for a step that must not be skipped */
async function claimTry(DB, broadcastId, key) {
  try {
    const r = await DB.prepare('INSERT OR IGNORE INTO broadcast_claims (broadcast_id, key, created_at) VALUES (?, ?, ?)')
      .bind(broadcastId, key, nowIso()).run();
    return (r?.meta?.changes || 0) > 0;
  } catch {
    return null;
  }
}

/**
 * claimOnce for a claim that belongs to one stretch on air (a Facebook post and its closing): one taken
 * before `since` (an earlier stretch whose release didn't finish) is not this stretch's, so it gives way
 */
async function claimFresh(DB, broadcastId, key, since) {
  if (await claimOnce(DB, broadcastId, key)) return true;
  if (!since) return false;
  const old = await DB.prepare('DELETE FROM broadcast_claims WHERE broadcast_id = ? AND key = ? AND created_at < ?').bind(broadcastId, key, since).run().catch(() => null);
  return (old?.meta?.changes || 0) > 0 && claimOnce(DB, broadcastId, key);
}

/** A claim's result, only if it was taken in this stretch on air (from `since`) */
async function freshResult(DB, broadcastId, key, since) {
  const row = await DB.prepare('SELECT result, created_at FROM broadcast_claims WHERE broadcast_id = ? AND key = ?').bind(broadcastId, key).first().catch(() => null);
  if (!row?.result || (since && String(row.created_at || '') < since)) return null;
  try { return JSON.parse(row.result); } catch { return null; }
}

// ─── Transitions (pure; return a new state) ─────────────────────────

function newBroadcastId() {
  return `live-${Date.now()}`;
}

/** The recording a state leaves behind when it moves on, and when: the one on air (a stream, not the emergency banner), else the last one that ended */
function endedFields(state) {
  const onAir = (state?.phase === 'live' || state?.phase === 'ending') && state.source === 'stream';
  if (onAir && state.liveVideoUid) return { endedVideoUid: state.liveVideoUid, endedVideoAt: nowIso() };
  return { endedVideoUid: state?.endedVideoUid || null, endedVideoAt: state?.endedVideoAt || null };
}

export function tSchedule(state, { kidSlug, kidName, jobId, test, scheduledAt, title, message, image, kitLiveEmail, by }, config) {
  const s = { ...defaultState(), broadcastId: newBroadcastId(), createdAt: nowIso(), ...endedFields(state) };
  s.kidSlug = kidSlug || null;
  s.kidName = kidName || null;
  s.jobId = jobId || null;
  s.test = !!test;
  s.scheduledAt = scheduledAt;
  s.title = title || `${s.test ? 'TEST · ' : ''}${kidName ? `${kidName}'s room reveal` : config.defaults.title}`;
  s.message = message || (kidName ? `Watch ${kidName}'s room reveal live` : config.defaults.message);
  s.image = image || null;
  s.kitLiveEmail = typeof kitLiveEmail === 'boolean' ? kitLiveEmail : null;
  s.kidVia = kidSlug ? 'scheduled' : null;
  s.phase = Date.parse(scheduledAt) - Date.now() <= ARM_WINDOW_MS ? 'armed' : 'scheduled';
  if (s.phase === 'armed') s.armedAt = nowIso();
  s.updatedBy = by || null;
  return s;
}

export function tStartLive(state, { videoUid, source = 'stream', by }, config) {
  let s = { ...state, testEnd: null };
  // A real stream never inherits a rehearsal: it starts its own, public broadcast
  const reusable = !state.test && (['scheduled', 'armed', 'ending'].includes(state.phase) || (state.phase === 'live'));
  if (!reusable) {
    // idle or replay: a fresh, unplanned broadcast
    s = { ...defaultState(), broadcastId: newBroadcastId(), createdAt: nowIso(), ...endedFields(state) };
    s.title = config.defaults.title;
    s.message = config.defaults.message;
  }
  if (s.phase !== 'live') s.segmentAt = nowIso();
  // A new stretch on air (not a reconnect within one): its own Facebook post and closing (claimFresh)
  if (!['live', 'ending'].includes(state.phase) || !reusable) s.fbSessionAt = nowIso();
  s.phase = 'live';
  s.source = source;
  s.liveAt = s.liveAt || nowIso();
  s.disconnectedAt = null;
  if (videoUid) s.liveVideoUid = videoUid;
  s.recordings = withRecording(s.recordings, videoUid);
  s.updatedBy = by || null;
  return s;
}

/** The recordings list with `uid` added (once, in order, capped) */
function withRecording(list, uid) {
  const have = Array.isArray(list) ? list : [];
  if (!uid || have.includes(uid)) return have;
  return [...have, uid].slice(-MAX_RECORDINGS);
}

/** A reveal's earlier Facebook live posts with `fb` (the one its phone was on) added: once each, in order, capped */
function withFbPost(list, fb) {
  const have = Array.isArray(list) ? list : [];
  const p = { liveVideoId: fb?.liveVideoId || null, permalink: fb?.permalink || null };
  if (!p.liveVideoId && !p.permalink) return have;
  if (have.some((x) => (p.liveVideoId && x?.liveVideoId === p.liveVideoId) || (p.permalink && x?.permalink === p.permalink))) return have;
  return [...have, p].slice(-MAX_RECORDINGS);
}

/** Is a reveal that ended by its phone stopping still waiting to see whether a phone comes back? */
/** What reaches people after a reveal waits for the rejoin window, unless the crew said it's over (overSaid) */
export function waitsForPhone(state, now = Date.now()) {
  return rejoinOpen(state, now) && !state.overSaid;
}

export function rejoinOpen(state, now = Date.now()) {
  return state?.phase === 'replay' && !!state.rejoinUntil && now < Date.parse(state.rejoinUntil);
}

/**
 * A phone back within REJOIN_MS of a reveal ending: the same reveal goes on (same broadcast, kid, page,
 * claims, so nobody hears "we're live" or "Live now" twice). The replay shown meanwhile steps aside.
 */
export function tRejoin(state, { videoUid } = {}) {
  return {
    ...state, phase: 'live', segmentAt: nowIso(), disconnectedAt: null, endedAt: null, endedBy: null,
    replayUntil: null, replayUid: null, replayReadyAt: null, replayStartedAt: null,
    rejoinUntil: null, closedAt: null, replayOut: false, gapSince: null, holdUntil: null, overSaid: false,
    // A Reel not yet posted was cut from the first part: it starts again from the whole reveal when it ends
    reel: state.reel?.stage === 'done' ? state.reel : null,
    // Its Facebook post was closed when the site ended it: a new one opens for the rest (preShowEffects, once).
    // The closed one stays the reveal's: History adds its numbers to the new one's (refreshPlatforms)
    fbEarlier: withFbPost(state.fbEarlier, state.fb),
    fb: { ...defaultState().fb }, fbReopen: true, fbReleaseKey: `rejoin:${nowIso()}`, fbSessionAt: nowIso(),
    liveVideoUid: videoUid || state.liveVideoUid, recordings: withRecording(state.recordings, videoUid),
  };
}

export function tDisconnected(state) {
  return { ...state, phase: 'ending', disconnectedAt: nowIso(), holdUntil: null };
}

export function tReconnected(state) {
  return { ...state, phase: 'live', disconnectedAt: null, segmentAt: nowIso(), holdUntil: null };
}

/** Is the crew's "N, the signal dropped" (tHold) still keeping the reveal on air? */
export function holding(state, now = Date.now()) {
  return !!state?.holdUntil && now < Date.parse(state.holdUntil);
}

/**
 * The crew texted N: the phone isn't done, the signal dropped. The broadcast stays on air until `until` (viewers see
 * Reconnecting): the drop rule (INPUT_DROP_*_MS) waits, a phone back clears it, and past it the end comes as it always
 * does. One already ending is put back on air, its stop kept as the gap's start.
 */
export function tHold(state, until) {
  if (state.phase === 'ending') return { ...state, phase: 'live', holdUntil: until, gapSince: state.disconnectedAt || nowIso(), disconnectedAt: null };
  return { ...state, holdUntil: until };
}

export function tEnd(state, config, { by, rejoin = false } = {}) {
  const hours = Number(config?.replayHours) || DEFAULT_REPLAY_HOURS;
  const s = { ...state, phase: 'replay', endedAt: state.endedAt || nowIso(), disconnectedAt: null, gapSince: null, holdUntil: null, endedBy: by || null, ...endedFields(state), updatedBy: by || null };
  // Ended by its phone stopping: open to a phone coming back. Ended any other way (End now, 8 hours): over now
  // Stopped before its start time: open at least until 15 minutes after the start, so the real start is the same reveal
  const at = Date.parse(state.scheduledAt || '');
  s.rejoinUntil = rejoin ? new Date(Math.max(Date.now() + REJOIN_MS, Number.isFinite(at) ? at + REJOIN_MS : 0)).toISOString() : null;
  s.closedAt = rejoin ? null : nowIso();
  s.overSaid = false;
  s.replayOut = false;
  s.replayUntil = new Date(Date.now() + hours * 3600e3).toISOString();
  s.manual = null;
  return s;
}

export function tClear(state, note, by) {
  return { ...defaultState(), ...endedFields(state), note: note || null, updatedBy: by || null };
}

/**
 * A phone on the main feed while test mode is on: a test, shown on the website
 * as the planned reveal would be (same kid, title and picture), under its own
 * broadcastId, carrying the state it interrupted so the end can put that back.
 */
export function tStartQuiet(state, { videoUid, by } = {}, config) {
  const { rev, quiet, resume, ...before } = state;
  const planned = !before.test && ['scheduled', 'armed'].includes(before.phase);
  const look = planned ? before : { ...defaultState(), title: config.defaults.title, message: config.defaults.message };
  const blank = defaultState();
  const at = nowIso();
  return {
    ...look,
    broadcastId: newBroadcastId(), createdAt: at,
    phase: 'live', source: 'stream', test: false,
    liveAt: at, segmentAt: at, endedAt: null, disconnectedAt: null,
    liveVideoUid: videoUid || null, replayUid: null, replayReadyAt: null, replayUntil: null, replayStartedAt: null,
    reel: null, fb: blank.fb, fbEarlier: [], kit: blank.kit, kidCheckAt: null, kidAlertAt: null, manual: null, clicks: 0, note: null,
    endedVideoUid: before.endedVideoUid || null, endedVideoAt: before.endedVideoAt || null, gapSince: null, holdUntil: null, endedBy: null,
    quiet: { at },
    resume: before.phase === 'idle' || !before.phase ? null : { ...before, testEnd: null },
    testEnd: null,
    updatedBy: by || null,
  };
}

/**
 * A scheduled reveal's phone stopped before the scheduled start (a framing check, a phone test without
 * test mode): that wasn't the reveal. It goes back to waiting for its phone, nothing final happens, and
 * that recording is never its replay. What was already said stays said (claims): no second "we're live"
 * or "Live now" when it really starts. A Kit list email held for going live early can still go then, and
 * an API-mode Facebook post opened by the framing check is closed (preShowEffects) so the reveal gets its own.
 */
export function tPreShowOver(state) {
  const at = Date.parse(state.scheduledAt);
  const kit = state.kit?.live?.held ? { ...state.kit, live: null } : state.kit;
  const minutes = Math.max(1, Math.round((Date.parse(state.disconnectedAt || nowIso()) - Date.parse(state.liveAt || nowIso())) / 60000));
  return {
    ...state, ...endedFields(state),
    phase: Date.now() >= at - ARM_WINDOW_MS ? 'armed' : 'scheduled',
    liveAt: null, segmentAt: null, disconnectedAt: null, gapSince: null, holdUntil: null, liveVideoUid: null, recordings: [],
    kit, kidCheckAt: null, kidAlertAt: null,
    // Its Facebook post is released at once (preShowEffects closes it): the reveal opens its own when it starts,
    // and History counts only the reveal's posts
    fb: { ...defaultState().fb }, fbEarlier: [],
    // Always: even a Facebook post that failed to open took the claim the reveal needs for its own
    preShowFb: { liveVideoId: state.fb?.liveVideoId || null, outputUid: state.fb?.outputUid || null },
    fbReleaseKey: `pre-show:${nowIso()}`,
    preShowNote: { at: nowIso(), minutes, kitSent: !!(state.kit?.live?.sendAt && !state.kit.live.error) },
  };
}

/**
 * A framing check (tPreShowOver): a phone that stopped before a scheduled reveal's start time after less
 * than PRE_SHOW_MAX_MS on air. Longer is the reveal itself, run early (or JobTread's time was late): it
 * ends as a reveal does.
 */
const PRE_SHOW_MAX_MS = 10 * 60 * 1000;
const PRE_SHOW_ALWAYS_MS = 60 * 60 * 1000;
function preShow(state) {
  const at = Date.parse(state.scheduledAt || '');
  const stopped = Date.parse(state.disconnectedAt || '');
  const began = Date.parse(state.liveAt || '');
  if (state.quiet || state.test || !Number.isFinite(at) || !Number.isFinite(stopped) || stopped >= at) return false;
  // Over an hour before the start it is never the reveal (a phone test, the day before, without test mode)
  if (at - stopped >= PRE_SHOW_ALWAYS_MS) return true;
  return Number.isFinite(began) && stopped - began < PRE_SHOW_MAX_MS;
}

/** The test is over: whatever it interrupted comes back as it was (nothing → idle) */
export function tEndQuiet(state, by, now = Date.now()) {
  const back = state.resume ? { ...state.resume } : { ...defaultState(), note: 'test-ended' };
  const out = { ...back, ...endedFields(state), updatedBy: by || back.updatedBy || null, testEnd: null };
  // Signed-in staff see the test's end as the reveal's would (testEndPublicState, /api/broadcast-test-end): "That's
  // the reveal!", then its own recording as the replay once Stream has it (findTestReplay), for TEST_END_SHOW_MS, never
  // into the half hour before a planned reveal. The public page stays on the countdown (publicState only carries
  // testEndUntil). Shown only: nothing is sent, posted or attached, as for any test
  const recordings = withRecording(state.recordings, state.liveVideoUid);
  if (state.source === 'stream' && state.liveAt && recordings.length) {
    const at = Date.parse(back.scheduledAt || '');
    const until = Math.min(now + TEST_END_SHOW_MS, Number.isFinite(at) ? at - ARM_WINDOW_MS : Infinity);
    if (until - now >= 60e3) {
      out.testEnd = {
        at: new Date(now).toISOString(), until: new Date(until).toISOString(), broadcastId: state.broadcastId,
        kidSlug: state.kidSlug || null, kidName: state.kidName || null, title: state.title || null, liveAt: state.liveAt,
        recordings, replayUid: null, checkedAt: null,
      };
    }
  }
  return out;
}

/** Is a test's end being shown to staff (tEndQuiet)? Only while the state is back to waiting */
export function testEndShowing(state, now = Date.now()) {
  const te = state?.testEnd;
  return !!te && ['idle', 'scheduled', 'armed'].includes(state.phase || 'idle') && now < Date.parse(te.until);
}

/** A test's end: its recording as the replay, once Stream has it ready (the longest ready piece) */
async function findTestReplay(env, state, work) {
  const te = state.testEnd;
  if (!testEndShowing(state) || te.replayUid || !stream.streamConfigured(env)) return state;
  if (te.checkedAt && Date.now() - Date.parse(te.checkedAt) < REPLAY_CHECK_INTERVAL_MS) return state;
  const vids = await Promise.all((te.recordings || []).map((uid) => stream.getVideo(env, uid).catch(() => null)));
  const ready = vids.filter((v) => v?.ok && v.result?.status?.state === 'ready').map((v) => v.result);
  const pick = ready.reduce((a, b) => (!a || (Number(b.duration) || 0) > (Number(a.duration) || 0) ? b : a), null);
  if (pick?.uid) work.push('test-replay-ready');
  return { ...state, testEnd: { ...te, checkedAt: nowIso(), replayUid: pick?.uid || null } };
}

/**
 * A staff text answering "Is the reveal over?" (answerByText), on the state as the tick just sensed it.
 * Only a stream on air whose phone is away (a gap, or ending), and only once that stop was asked about
 * (`asked`: its over-ask claim exists; an answer to an earlier stop never ends a newer one), is changed:
 *  'yes' ends it now, the way the automatic end would after its wait: a test puts back what it interrupted, a
 *        framing check goes back to waiting, a reveal goes to its replay, open REJOIN_MS to its phone coming back,
 *        and what reaches people (replay email, the kid's page, "Ended") doesn't wait for that window (overSaid)
 *  'no'  keeps it on air, Reconnecting, for REJOIN_MS from now (tHold)
 * → { state, outcome, save } (save: changed, to be saved at once like a phase change)
 */
export function tAnswer(state, answer, config, { by = null, now = Date.now(), asked = false } = {}) {
  if (state.phase === 'replay') return { state, outcome: 'already-ended' };
  if (!['live', 'ending'].includes(state.phase) || state.source !== 'stream') return { state, outcome: 'nothing' };
  if (state.phase === 'live' && !state.gapSince) return { state, outcome: 'phone-back' };
  const s = { ...state, disconnectedAt: state.disconnectedAt || state.gapSince };
  // Not asked about this stop (yet): a framing check never is; a new stop is, in a few seconds
  if (!asked) return { state, outcome: preShow(s) ? 'nothing' : 'not-asked' };
  if (answer === 'no') return { state: tHold(state, new Date(now + REJOIN_MS).toISOString()), outcome: state.quiet ? 'test-held' : 'held', save: true };
  if (state.quiet) return { state: tEndQuiet(s, by), outcome: 'test-ended', save: true };
  if (preShow(s)) return { state: tPreShowOver(s), outcome: 'pre-show', save: true };
  // Over, said the crew: its replay, the kid's page, the replay email and "Ended" go as soon as the recording is ready,
  // not 15 minutes on (Peter, Nov 19 2026). The phone can still pick it up again (rejoin), in case the Y was a slip.
  // Not for a stop before the planned start: that was setup footage, and the real start is the same reveal (tEnd keeps
  // it open until 15 minutes after the start), so nothing goes out from it
  const stop = Date.parse(s.disconnectedAt || '');
  const afterStart = !state.scheduledAt || !Number.isFinite(stop) || stop >= Date.parse(state.scheduledAt);
  return { state: { ...tEnd(s, config, { by, rejoin: true }), overSaid: afterStart }, outcome: 'ended', save: true };
}

// ─── Reminders ──────────────────────────────────────────────────────

/**
 * A rehearsal's reminder: whatever a real reveal would send under the current
 * Settings (reminders on, which hours before), each kind once, by email, to the
 * test address (the reveal invites' test guests), marked TEST. Nobody who
 * signed up gets anything, and no texts or browser alerts go out.
 */
async function sendTestReminder(env, state, kind, config, work, summary) {
  const { DB } = env;
  if (!notify.emailConfigured(env) || !(await claimSend(DB, state.broadcastId, kind, 'email'))) return summary;
  const to = await testGuests(DB).catch(() => []);
  const tpl = notify.reminderEmail({ ...reminderArgs(state, kind, config), unsubscribeUrl: `${SITE_ORIGIN}/admin/#broadcast` });
  const res = to.length
    ? await notify.sendEmailItems(env, to.map((addr) => ({ to: addr, subject: `TEST · ${tpl.subject}`, html: tpl.html, text: tpl.text })), { tags: [{ name: 'category', value: `reveal-${kind}-test` }] })
    : { sent: 0, failed: 0, errors: [] };
  await finishSend(DB, state.broadcastId, kind, 'email', { recipients: to.length, sent: res.sent, failed: res.failed, error: res.errors.slice(0, 3).join('; ') || null });
  summary.email = { recipients: to.length, sent: res.sent, failed: res.failed, test: true };
  work.push(`test-email:${kind}:${res.sent}/${to.length}`);
  return summary;
}

// A reminder goes out in batches, a few seconds' worth per tick, so a long
// list never holds up the tick that flips the site to live. Each recipient is
// claimed in broadcast_reminder_deliveries before anything is sent (so two
// ticks never send to the same person), and broadcast_reminder_runs remembers
// which sends still have people waiting, so the next tick carries on.
const REMINDER_BATCH = { email: 100, push: 50 };
const REMINDER_TICK_BUDGET_MS = 3000;
// When this isolate last sent batches for `${broadcastId}:${kind}`: a send started this tick
// isn't carried on again in the same tick, so one tick spends at most one budget per kind
const _reminderSentAt = new Map();

const REMINDER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS broadcast_reminder_deliveries (
    broadcast_id TEXT NOT NULL, kind TEXT NOT NULL, channel TEXT NOT NULL, reminder_id TEXT NOT NULL,
    batch TEXT NOT NULL, at TEXT,
    PRIMARY KEY (broadcast_id, kind, channel, reminder_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_batch ON broadcast_reminder_deliveries(batch)`,
  `CREATE TABLE IF NOT EXISTS broadcast_reminder_runs (
    broadcast_id TEXT NOT NULL, kind TEXT NOT NULL, channel TEXT NOT NULL,
    started_at TEXT, finished_at TEXT,
    PRIMARY KEY (broadcast_id, kind, channel)
  )`,
];
const _reminderTables = new WeakSet();
async function ensureReminderTables(DB) {
  if (_reminderTables.has(DB)) return;
  await DB.batch(REMINDER_SCHEMA.map(sql => DB.prepare(sql)));
  _reminderTables.add(DB);
}

/** Each kind is news only while the reveal is in the matching phase; a batch left over after that is dropped */
function reminderStillNews(kind, state) {
  if (kind === 'live') return state.phase === 'live' || state.phase === 'ending';
  if (kind === 'replay') return state.phase === 'replay';
  return state.phase === 'scheduled' || state.phase === 'armed';
}

/** A fresh send for (broadcast, kind, channel): forget earlier deliveries (a moved date re-sends) and open the run */
async function openRun(DB, broadcastId, kind, channel) {
  await DB.prepare('DELETE FROM broadcast_reminder_deliveries WHERE broadcast_id = ? AND kind = ? AND channel = ?').bind(broadcastId, kind, channel).run();
  // Who-got-what is only needed while a send is going out; a month on, it goes
  const monthAgo = new Date(Date.now() - 30 * 86400e3).toISOString();
  await DB.prepare('DELETE FROM broadcast_reminder_deliveries WHERE at < ?').bind(monthAgo).run();
  await DB.prepare('DELETE FROM broadcast_reminder_runs WHERE started_at < ?').bind(monthAgo).run();
  await DB.prepare(`INSERT INTO broadcast_reminder_runs (broadcast_id, kind, channel, started_at, finished_at) VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(broadcast_id, kind, channel) DO UPDATE SET started_at = excluded.started_at, finished_at = NULL`).bind(broadcastId, kind, channel, nowIso()).run();
}

async function runOpen(DB, broadcastId, kind, channel) {
  const row = await DB.prepare('SELECT finished_at FROM broadcast_reminder_runs WHERE broadcast_id = ? AND kind = ? AND channel = ?').bind(broadcastId, kind, channel).first();
  return !!row && !row.finished_at;
}

async function closeRun(DB, broadcastId, kind, channel) {
  await DB.prepare('UPDATE broadcast_reminder_runs SET finished_at = ? WHERE broadcast_id = ? AND kind = ? AND channel = ? AND finished_at IS NULL').bind(nowIso(), broadcastId, kind, channel).run();
}

/** Kinds with people still waiting for this broadcast */
async function openReminderKinds(DB, broadcastId) {
  await ensureReminderTables(DB);
  const res = await DB.prepare('SELECT DISTINCT kind FROM broadcast_reminder_runs WHERE broadcast_id = ? AND finished_at IS NULL').bind(broadcastId).all();
  return (res?.results || []).map(r => r.kind);
}

/**
 * Claim the next `size` recipients nobody has claimed for this send → their
 * rows. One INSERT … SELECT, so two ticks running at once split the list.
 */
async function claimRecipients(DB, state, kind, channel, size) {
  const batch = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  await DB.prepare(`INSERT OR IGNORE INTO broadcast_reminder_deliveries (broadcast_id, kind, channel, reminder_id, batch, at)
    SELECT ?, ?, ?, r.id, ?, ? FROM broadcast_reminders r
    WHERE r.channel = ? AND r.unsubscribed_at IS NULL AND (r.kid_slug IS NULL OR r.kid_slug = ?) AND r.fails < 5
      AND NOT EXISTS (SELECT 1 FROM broadcast_reminder_deliveries d WHERE d.broadcast_id = ? AND d.kind = ? AND d.channel = ? AND d.reminder_id = r.id)
    ORDER BY r.id LIMIT ?`)
    .bind(state.broadcastId, kind, channel, batch, nowIso(), channel, state.kidSlug || '', state.broadcastId, kind, channel, size).run();
  const res = await DB.prepare(`SELECT r.id, r.address, r.subscription, r.last_sent_at, r.token FROM broadcast_reminder_deliveries d
    JOIN broadcast_reminders r ON r.id = d.reminder_id WHERE d.batch = ?`).bind(batch).all();
  return { batch, rows: res?.results || [] };
}

/** Add one batch's numbers to the send's row (the admin's reminder stats) */
async function addSendStats(DB, broadcastId, kind, channel, { recipients, sent, failed, error }) {
  try {
    await DB.prepare('UPDATE broadcast_sends SET recipients = COALESCE(recipients, 0) + ?, sent = COALESCE(sent, 0) + ?, failed = COALESCE(failed, 0) + ?, error = COALESCE(?, error) WHERE broadcast_id = ? AND kind = ? AND channel = ?')
      .bind(recipients, sent, failed, error || null, broadcastId, kind, channel).run();
  } catch { /* stats only */ }
}

/** Claim a (broadcast, kind, channel) send so concurrent ticks never double-send. */
async function claimSend(DB, broadcastId, kind, channel) {
  try {
    const r = await DB.prepare('INSERT OR IGNORE INTO broadcast_sends (broadcast_id, kind, channel, created_at) VALUES (?, ?, ?, ?)')
      .bind(broadcastId, kind, channel, nowIso()).run();
    return (r?.meta?.changes || 0) > 0;
  } catch {
    return false;
  }
}

async function finishSend(DB, broadcastId, kind, channel, { recipients, sent, failed, error }) {
  try {
    await DB.prepare('UPDATE broadcast_sends SET recipients = ?, sent = ?, failed = ?, error = ? WHERE broadcast_id = ? AND kind = ? AND channel = ?')
      .bind(recipients, sent, failed, error || null, broadcastId, kind, channel).run();
  } catch { /* stats only */ }
}

/**
 * Who a reveal email from Kit goes to, of the people who signed up → a Kit
 * subscriber filter; undefined: this kind isn't for any of them; null: Kit
 * couldn't say, so try again. The date and a new date reach every sign-up but
 * the one-reveal-only ones through the whole-list invite, so those go only to
 * them; the rest go to every sign-up for this kid, the moment they're due (the
 * whole list's "we're live" and replay leave the sign-ups out).
 */
/** The tag ids a sign-ups filter goes to (any of them, or all of them) */
const leftOutOf = (filter) => [...new Set((filter || []).flatMap((g) => [...(g?.any || []), ...(g?.all || [])].flatMap((e) => (e?.ids || []).map(Number))))];

/** What the sign-ups' copy went to, so the whole list's copy leaves exactly them out (signupsCovered) */
async function settleSignupsTags(DB, broadcastId, kind, tags) {
  const key = `kit-signups-tags:${kind}`;
  await claimOnce(DB, broadcastId, key);
  await settleClaim(DB, broadcastId, key, { tags });
}

async function signupsAim(env, state, kind) {
  if (kind === 'scheduled' || kind === 'moved') return oneRevealFilter(env, state.kidSlug);
  return signupsFilter(env, state.kidSlug);
}

// While a sign-ups' Kit email is on its way its row says so; one still saying so after this long died on the way
const KIT_SENDING = 'sending';
const KIT_SENDING_STALE_MS = 3 * 60e3;

/**
 * The sign-ups' Kit email for a kind → 'new' (claimed now), 'again' (taken back
 * after a failed or dead try), or null (sent already, nobody to send to, or on
 * its way from another tick).
 */
async function claimKitSignups(DB, broadcastId, kind) {
  const now = Date.now();
  const made = await DB.prepare(`INSERT OR IGNORE INTO broadcast_sends (broadcast_id, kind, channel, created_at, error) VALUES (?, ?, 'kit-signups', ?, ?)`)
    .bind(broadcastId, kind, nowIso(), KIT_SENDING).run().catch(() => null);
  if ((made?.meta?.changes || 0) > 0) return 'new';
  const r = await DB.prepare(`UPDATE broadcast_sends SET error = ?, created_at = ? WHERE broadcast_id = ? AND kind = ? AND channel = 'kit-signups'
      AND error IS NOT NULL AND (error != ? OR created_at < ?)`)
    .bind(KIT_SENDING, new Date(now).toISOString(), broadcastId, kind, KIT_SENDING, new Date(now - KIT_SENDING_STALE_MS).toISOString()).run();
  return (r?.meta?.changes || 0) > 0 ? 'again' : null;
}

/** How a sign-ups' Kit email is told from any other in Kit, so a try whose answer was lost is never made twice */
const signupsMark = (state, kind) => `${kind} · reveal sign-ups · ${state.broadcastId}`;

/**
 * Which tags the whole list's own copy of a kind leaves out, because those
 * people get theirs from sendReminders: the tags their copy went to, or will
 * go to once Kit takes it. None when the sign-ups get no copy of this kind
 * (reminders off, Kit not connected, a "we're live" with no stream), so
 * nobody is left without one. null: Kit couldn't say.
 */
async function signupsCovered(env, config, state, kind) {
  if (!config.reminders?.enabled || !kitConfigured(env) || state.test) return [];
  if (kind === 'live' && state.source !== 'stream') return [];
  const sent = await claimResult(env.DB, state.broadcastId, `kit-signups-tags:${kind}`);
  if (Array.isArray(sent?.tags)) return sent.tags;
  return signupTagIds(env, state.kidSlug);
}

/**
 * Send one reminder kind across all channels. Idempotent per broadcast: the
 * first call claims the send (broadcast_sends) and opens its run, every call
 * sends batches for up to `budgetMs`, and the next tick (dueReminderKinds)
 * carries on until everyone has it. Returns this call's summary; never throws.
 */
export async function sendReminders(env, config, state, kind, work, { budgetMs = REMINDER_TICK_BUDGET_MS } = {}) {
  const { DB } = env;
  const summary = { kind, email: null, push: null };
  // A test on the main feed (test mode) emails nobody
  if (!config.reminders?.enabled || !state.broadcastId || state.quiet) return summary;
  // A rehearsal follows the same switches as a real reveal, but only the test address hears it
  if (state.test) return sendTestReminder(env, state, kind, config, work, summary);
  let open;
  try {
    await ensureReminderTables(DB);
    open = new Set(((await DB.prepare('SELECT channel FROM broadcast_reminder_runs WHERE broadcast_id = ? AND kind = ? AND finished_at IS NULL').bind(state.broadcastId, kind).all())?.results || []).map(r => r.channel));
  } catch (e) {
    work.push(`reminders:${kind}:error`);
    return summary;
  }
  const common = reminderArgs(state, kind, config);
  const news = reminderStillNews(kind, state);
  const deadline = Date.now() + budgetMs;

  // One channel: claim the send the first time, then batches until everyone has it or time is up
  const channel = async (name, enabled, sendBatch) => {
    try {
      if (!enabled || !news) { if (open.has(name)) await closeRun(DB, state.broadcastId, kind, name); return; }
      if (await claimSend(DB, state.broadcastId, kind, name)) await openRun(DB, state.broadcastId, kind, name);
      else if (!open.has(name)) return;
      const size = REMINDER_BATCH[name];
      const total = { recipients: 0, sent: 0, failed: 0 };
      for (;;) {
        const { batch, rows } = await claimRecipients(DB, state, kind, name, size);
        if (rows.length) {
          const r = await sendBatch(rows, batch);
          total.recipients += rows.length; total.sent += r.sent; total.failed += r.failed;
          await addSendStats(DB, state.broadcastId, kind, name, { recipients: rows.length, sent: r.sent, failed: r.failed, error: r.error });
        }
        if (rows.length < size) { await closeRun(DB, state.broadcastId, kind, name); break; }
        if (Date.now() >= deadline) { work.push(`${name}:${kind}:continues`); break; }
      }
      summary[name] = total;
      if (total.recipients) work.push(`${name}:${kind}:${total.sent}/${total.recipients}`);
    } catch (e) {
      // The run stays open, so the next tick tries again with whoever is still waiting
      work.push(`${name}:${kind}:error`);
    }
  };

  // Email: one Kit email to the people who signed up, never one each from Resend (./_reveal-signups.js), so
  // nobody also on the newsletter gets two. Claimed once per broadcast and kind ('kit-signups'); a Kit
  // that doesn't take it releases the claim, so the next tick tries again, and staff hear once.
  const kitSignups = async () => {
    let claimed = false;
    try {
      if (!kitConfigured(env) || !news) return;
      const claim = await claimKitSignups(DB, state.broadcastId, kind);
      if (!claim) return;
      claimed = true;
      const aim = await signupsAim(env, state, kind);
      // Nobody this kind is for: done, with nothing sent
      if (aim === undefined) { await finishSend(DB, state.broadcastId, kind, 'kit-signups', { recipients: 0, sent: 0, failed: 0, error: null }); return; }
      if (!aim) throw new Error('Kit couldn’t say who signed up');
      const tags = leftOutOf(aim);
      // Taken back after a try whose answer may have been lost: if Kit has it, it's sent, never made twice
      if (claim === 'again') {
        const had = await kitFindBroadcast(env, signupsMark(state, kind));
        if (!had.ok) throw new Error(`Kit couldn’t say whether it already has it (${had.error})`);
        if (had.broadcast) {
          await settleSignupsTags(DB, state.broadcastId, kind, tags);
          await finishSend(DB, state.broadcastId, kind, 'kit-signups', { recipients: 0, sent: 1, failed: 0, error: null });
          work.push(`kit-signups:${kind}:found`);
          return;
        }
      }
      const tpl = notify.reminderEmail({ ...common, unsubscribeUrl: '{{ unsubscribe_url }}', list: true, asked: true });
      const r = await kitCreateBroadcast(env, { subject: tpl.subject, previewText: tpl.preheader, description: `[auto] ${state.kidName || 'Reveal'} ${signupsMark(state, kind)}`, html: tpl.html, sendAt: new Date(Date.now() + KIT_SEND_DELAY_MS).toISOString(), filter: aim });
      if (!r.ok) throw new Error(r.error || `Kit HTTP ${r.status}`);
      await settleSignupsTags(DB, state.broadcastId, kind, tags);
      await finishSend(DB, state.broadcastId, kind, 'kit-signups', { recipients: 0, sent: 1, failed: 0, error: null });
      summary.kit = { id: r.broadcast?.id || null };
      work.push(`kit-signups:${kind}`);
    } catch (e) {
      // Kept with its error, so the next tick takes it back (dueReminderKinds) while it's still news
      if (claimed) await finishSend(DB, state.broadcastId, kind, 'kit-signups', { recipients: 0, sent: 0, failed: 1, error: String(e.message || e).slice(0, 300) });
      work.push(`kit-signups:${kind}:error`);
      if (await claimOnce(DB, state.broadcastId, `kit-signups-alert:${kind}`).catch(() => false)) {
        await notify.alertAdmins(env, config, { level: 'warn', title: `Reveal email to sign-ups not sent yet (${kind})`, detail: `${e.message}. The site keeps trying every minute while it's still news.`, url: `${SITE_ORIGIN}/admin/` }).catch(() => {});
      }
    }
  };

  await Promise.all([
    kitSignups(),
    // Push: a dead subscription (404/410, or not a browser push service) is dropped
    channel('push', !!(config.reminders?.push && config.vapid?.privateJwk), async (rows) => {
      const subs = rows.map(r => { try { return { id: r.id, subscription: JSON.parse(r.subscription) }; } catch { return null; } }).filter(Boolean);
      const r = await notify.sendPushBatch(subs, notify.reminderPush({ ...common, liveUrl: liveLinkFor(state, 'push'), replayUrl: liveLinkFor(state, 'push') }), config.vapid, { ttl: kind === 'live' ? 2 * 3600 : 24 * 3600, urgency: kind === 'live' ? 'high' : 'normal', topic: `reveal-${kind}` });
      for (const id of r.gone) await DB.prepare('UPDATE broadcast_reminders SET unsubscribed_at = ? WHERE id = ?').bind(nowIso(), id).run();
      return { sent: r.sent, failed: r.failed + (rows.length - subs.length), error: null };
    }),
  ]);
  if (_reminderSentAt.size > 50) _reminderSentAt.clear();
  _reminderSentAt.set(`${state.broadcastId}:${kind}`, Date.now());
  return summary;
}

/** Is a reminder kind still worth sending late? The same windows that make it due, so a retry is never out of date */
function stillOnTime(kind, state, now = Date.now()) {
  if (!reminderStillNews(kind, state)) return false;
  const lead = state.scheduledAt ? Date.parse(state.scheduledAt) - now : null;
  if (kind === 'scheduled' || kind === 'moved') return lead !== null && lead > 26 * 3600e3;
  if (kind === 'day') return lead !== null && lead > 2 * 3600e3;
  if (kind === 'hour') return lead !== null && lead > 5 * 60e3;
  if (kind === 'live') return !!state.liveAt && now - liveNewsFrom(state) <= 30 * 60e3;
  return true;
}

async function dueReminderKinds(DB, state, config, { kit = true } = {}) {
  if (!state.broadcastId || state.quiet) return [];
  // Sends with people still waiting carry on every tick (sendReminders drops them once they're old news)
  const carrying = (await openReminderKinds(DB, state.broadcastId).catch(() => []))
    .filter(k => Date.now() - (_reminderSentAt.get(`${state.broadcastId}:${k}`) || 0) >= REMINDER_TICK_BUDGET_MS);
  const kinds = [];
  const now = Date.now();
  const at = state.scheduledAt ? Date.parse(state.scheduledAt) : null;
  const hours = Array.isArray(config.reminders?.hoursBefore) ? config.reminders.hoursBefore : [24, 1];
  if ((state.phase === 'scheduled' || state.phase === 'armed') && at) {
    const lead = at - now;
    if (hours.includes(24) && lead <= 24 * 3600e3 && lead > 2 * 3600e3) kinds.push('day');
    if (hours.includes(1) && lead <= 3600e3 && lead > 5 * 60e3) kinds.push('hour');
  }
  // "We're live": due from the tick that saves the go-live until it has started (see EFFECTS_RETRY_MS). Not for a phone
  // that went live more than 30 minutes before the planned start: held like the list's email (kitAutoLive), as it may be
  // a phone test (Nov 18 2026: one at 11:48 emailed Dylan's sign-ups "we're live" four hours early)
  // Before the planned start it waits for the start (liveNewsFrom): a framing check emails nobody
  if ((state.phase === 'live' || state.phase === 'ending') && state.source === 'stream' && state.liveAt && now >= liveNewsFrom(state) && now - liveNewsFrom(state) <= EFFECTS_RETRY_MS && !wentLiveEarly(state)) kinds.push('live');
  const res = await DB.prepare('SELECT kind, channel, error, created_at FROM broadcast_sends WHERE broadcast_id = ?').bind(state.broadcastId).all();
  const rows = res?.results || [];
  // The sign-ups' Kit email that failed (or died on its way) is tried again while it would still be on time: a
  // "tomorrow" never lands after "one hour to go", nor a save-the-date in the last day
  const stale = (r) => r.error !== KIT_SENDING || Date.parse(r.created_at) < now - KIT_SENDING_STALE_MS;
  const retry = rows.filter(r => r.channel === 'kit-signups' && r.error && stale(r) && stillOnTime(r.kind, state, now)).map(r => r.kind);
  if (!kinds.length && !carrying.length && !retry.length) return [];
  // A kind is done once each way it goes has been claimed: the sign-ups' Kit email (when Kit is connected) and browser
  // alerts (when they're on). Kit's own "we're live" to the whole list (channel 'kit') isn't one of them. A send from
  // before the sign-ups moved to Kit (channel 'email') counts as done.
  const has = (kind, channel) => rows.some(r => r.kind === kind && r.channel === channel);
  const pushOn = !!(config.reminders?.push && config.vapid?.privateJwk);
  // A rehearsal goes by email to the test address only (sendTestReminder, channel 'email'), Kit or no Kit
  const done = (k) => has(k, 'email') || (!state.test && (!kit || has(k, 'kit-signups')) && (!pushOn || has(k, 'push')));
  // A run carries on only while its send is still claimed: a moved date un-claims day and hour, which then wait for their new window
  return [...new Set([...kinds.filter(k => !done(k)), ...carrying.filter(k => rows.some(r => r.kind === k)), ...retry])];
}

// ─── Kit drafts ─────────────────────────────────────────────────────
// Only the replay's. Before the reveal, the whole list's email is the whole-list
// invite, drafted with the reveal invite when JobTread confirms the reveal and
// following JobTread from then on (./_reveal-invite-kit.js, kind 'watch'), so the
// countdown no longer drafts a "Save the date" or a "New date" of its own
// (Peter, Nov 10 2026: two emails once a reveal is confirmed, the same but for the address).

async function draftKit(env, state, kind) {
  if (!kitConfigured(env) || state.test) return null; // a rehearsal leaves Kit alone
  try {
    const tpl = notify.reminderEmail({ ...reminderArgs(state, kind, await readConfig(env.DB)), unsubscribeUrl: '{{ unsubscribe_url }}', list: true });
    // The whole list, but not the reveal sign-ups whose own replay Kit sends (sendReminders)
    const config = await readConfig(env.DB);
    const covered = await signupsCovered(env, config, state, kind);
    const filter = covered ? await wholeListFilter(env, { leaveOut: covered }) : null;
    if (!filter) return null;
    const r = await kitCreateBroadcast(env, { subject: tpl.subject, previewText: tpl.preheader, description: `[auto] ${state.kidName || 'Reveal'} ${kind}`, html: tpl.html, filter });
    return r.ok ? (r.broadcast?.id || true) : null;
  } catch {
    return null;
  }
}

export function kitLiveWanted(state, config) {
  return typeof state.kitLiveEmail === 'boolean' ? state.kitLiveEmail : config.kitLive?.enabled !== false;
}

/**
 * What every reveal email is filled in from: the real send, a rehearsal, the
 * admin's test and Kit's copies all come through here, so a test shows exactly
 * what the real thing will. A kid's photo arrives as a Cloudflare id or a full
 * address, and comes out cropped to the face either way.
 */
export function reminderArgs(state, kind, config = {}) {
  // Every reveal email (reminders, Kit) links with ?src=email; push swaps in its own
  const url = liveLinkFor(state, 'email');
  return {
    kind, kidName: state.kidName, kidSlug: state.kidSlug || null, scheduledAt: state.scheduledAt,
    tz: config.timezone || 'America/New_York',
    liveUrl: url, replayUrl: url,
    image: state.image ? cfImg(state.image, HERO_TRANSFORM) : null,
    hours: Array.isArray(config.reminders?.hoursBefore) ? config.reminders.hoursBefore : [24, 1],
    signUpOpen: !!config.reminders?.enabled,
  };
}

/**
 * Email the Kit list "we're live". Once per broadcast (claimed in
 * broadcast_sends as kind 'live', channel 'kit'); a failed send releases the
 * claim so the admin's "Email the list now" button can retry. Never throws.
 */
export async function sendKitLive(env, config, state, work, { by = 'live-broadcast' } = {}) {
  if (!kitConfigured(env) || !state.broadcastId || state.quiet) return state;
  if (!await claimSend(env.DB, state.broadcastId, 'live', 'kit')) return state;
  // Always the whole list, less who asked for less: the one audience Kit can take with the sign-ups left out
  // (Kit takes one rule per email, so "a group, but not the sign-ups" can't be sent; no screen ever picked one)
  const audience = { type: 'all', id: null, name: 'All subscribers' };
  const s = { ...state, kit: { ...(state.kit || {}) } };
  try {
    const tpl = notify.reminderEmail({ ...reminderArgs(s, 'live', config), unsubscribeUrl: '{{ unsubscribe_url }}', list: true });
    const sendAt = new Date(Date.now() + KIT_SEND_DELAY_MS).toISOString();
    // Everyone, but not the reveal sign-ups whose own copy went (or is on its way) when it started
    const covered = await signupsCovered(env, config, s, 'live');
    if (!covered) throw new Error('Kit couldn’t say who signed up for reveal emails');
    const filter = await wholeListFilter(env, { leaveOut: covered });
    if (!filter) throw new Error('Kit couldn’t say who to leave out');
    const r = await kitCreateBroadcast(env, { subject: tpl.subject, previewText: tpl.preheader, description: `[auto] ${s.kidName || 'Reveal'} live`, html: tpl.html, sendAt, audience, filter });
    if (r.ok) {
      s.kit.live = { id: r.broadcast?.id || null, audience: audience.name || audience.type, sendAt, by, error: null };
      await finishSend(env.DB, s.broadcastId, 'live', 'kit', { recipients: 0, sent: 1, failed: 0, error: null });
      work.push('kit-live');
      await logAudit(env.DB, { userEmail: by, action: 'published', entityType: 'newsletter', entitySlug: String(r.broadcast?.id || s.broadcastId), entityName: `Kit "we're live" email: ${s.title || 'reveal'} → ${audience.name || 'All subscribers'}`, gitStatus: 'ok' });
    } else {
      throw new Error(r.error || `Kit HTTP ${r.status}`);
    }
  } catch (err) {
    s.kit.live = { id: null, audience: audience.name || audience.type, sendAt: null, by, error: err.message };
    await env.DB.prepare(`DELETE FROM broadcast_sends WHERE broadcast_id = ? AND kind = 'live' AND channel = 'kit'`).bind(s.broadcastId).run().catch(() => {});
    work.push('kit-live-failed');
    await notify.alertAdmins(env, config, { level: 'warn', title: "Kit \"we're live\" email did not send", detail: `${err.message}. Use "Email the list now" in Admin → Broadcast to retry.`, url: `${SITE_ORIGIN}/admin/` });
  }
  return s;
}

// ─── Replay handling ────────────────────────────────────────────────

/** Move the Instagram Reel pipeline one step and tell the humans about outcomes. */
async function tickReel(env, config, state, work, opts) {
  if (!state.reel || !stream.streamConfigured(env)) return state;
  const before = state.reel.stage;
  const fbBefore = state.reel.facebook?.stage || null;
  const r = await reels.advanceReel(env, config, state, opts);
  work.push(...r.events);
  const reel = r.state.reel;
  const f = reel?.facebook;
  if (f && f.stage !== fbBefore) {
    if (f.stage === 'done') {
      await recordEvent(env.DB, state.broadcastId, 'fb_reel_published', { permalink: f.permalink, start: reel.start, end: reel.end, comment: !!f.commentId });
      await logAudit(env.DB, { userEmail: 'live-broadcast', action: 'published', entityType: 'facebook-reel', entitySlug: f.videoId, entityName: `Facebook Reel: ${state.title || state.broadcastId}`, changes: [{ field: 'window', from: null, to: `${reel.start}-${reel.end}s` }], gitStatus: 'ok' });
      await notify.alertAdmins(env, config, { level: 'info', kind: 'news', icon: '🎬', title: `Facebook Reel posted: ${state.title || 'reveal'}`, detail: `The same cut as the Instagram Reel, on the Page.${f.commentError ? ` The website link comment didn't post (${f.commentError}).` : f.commentId ? ' The website link is its first comment.' : ''}`, url: f.permalink || undefined });
    } else if (f.stage === 'failed' || f.stage === 'blocked') {
      await notify.alertAdmins(env, config, { level: 'warn', title: `Facebook Reel ${f.stage === 'blocked' ? 'needs setup' : 'failed'}: ${state.title || 'reveal'}`, detail: f.error || 'unknown error', url: `${SITE_ORIGIN}/admin/` });
    }
  }
  if (reel && reel.stage !== before) {
    if (reel.stage === 'done') {
      await recordEvent(env.DB, state.broadcastId, 'reel_published', { permalink: reel.permalink, method: reel.method, start: reel.start, end: reel.end });
      await logAudit(env.DB, { userEmail: 'live-broadcast', action: 'published', entityType: 'instagram-reel', entitySlug: reel.mediaId, entityName: `Instagram Reel: ${state.title || state.broadcastId}`, changes: [{ field: 'window', from: null, to: `${reel.start}-${reel.end}s (${reel.method})` }], gitStatus: 'ok' });
      await notify.alertAdmins(env, config, { level: 'info', kind: 'news', icon: '📱', title: `Instagram Reel posted: ${state.title || 'reveal'}`, detail: `Cut ${Math.floor(reel.start / 60)}:${String(Math.floor(reel.start % 60)).padStart(2, '0')} to ${Math.floor(reel.end / 60)}:${String(Math.floor(reel.end % 60)).padStart(2, '0')} of the recording (${reel.method === 'chosen' ? 'the start and end chosen in the admin' : `picked by ${reel.method}`}).`, url: reel.permalink || undefined });
    } else if (reel.stage === 'failed' || reel.stage === 'blocked') {
      await notify.alertAdmins(env, config, { level: 'warn', title: `Instagram Reel ${reel.stage === 'blocked' ? 'needs setup' : 'failed'}: ${state.title || 'reveal'}`, detail: reel.error || 'unknown error', url: `${SITE_ORIGIN}/admin/` });
    }
  }
  return r.state;
}

/**
 * The replay. First the recording: the longest one this broadcast made (a reconnect after Stream's
 * recording timeout starts a new one, and the last piece can be a short tail), once Stream has
 * finished them all (or 30 minutes after the end, whatever is ready by then). That goes on the live
 * page straight away. What reaches people (the kid's page and a deploy, the replay email, the Kit
 * draft, the Reel) waits until the reveal is over for good: not while a phone may still pick it up
 * again (rejoinOpen).
 */
async function checkReplayReady(env, config, state, health, work) {
  if (state.phase !== 'replay' || state.source !== 'stream' || state.quiet) return state;
  // A replay already showing from before replayOut existed went out back then (its claims say so too)
  if (state.replayOut == null && state.replayUid) return state;
  if (!state.replayUid) state = await findReplay(env, config, state, health, work);
  if (!state.replayUid || waitsForPhone(state) || state.replayOut === true) return state;
  return replayOutward(env, config, state, health, work);
}

const REPLAY_WAIT_ALL_MS = 30 * 60 * 1000;

/**
 * Which piece is the replay: the one with the most footage from the scheduled start on (a phone started
 * early films the wait; the reveal itself is after the start). Unscheduled, or no times: the longest.
 */
export function replayScore(video, state) {
  const duration = Math.max(0, Number(video?.duration) || 0);
  const start = Date.parse(video?.created || '');
  const at = Date.parse(state?.scheduledAt || '');
  if (!Number.isFinite(start) || !Number.isFinite(at)) return duration;
  const end = start + duration * 1000;
  return Math.max(0, end - Math.max(start, at)) / 1000 + duration / 1e6; // ties: the longer piece
}

async function findReplay(env, config, state, health, work) {
  const last = health.replayCheckAt ? Date.parse(health.replayCheckAt) : 0;
  if (Date.now() - last < REPLAY_CHECK_INTERVAL_MS) return state;
  health.replayCheckAt = nowIso();
  if (!stream.streamConfigured(env)) return state;

  const uids = withRecording(state.recordings, state.liveVideoUid);
  let pick = null;
  if (uids.length) {
    const vids = await Promise.all(uids.map((uid) => stream.getVideo(env, uid).catch(() => null)));
    const ready = vids.filter((v) => v?.ok && v.result?.status?.state === 'ready').map((v) => v.result);
    // A piece that failed, or that Stream no longer has (404), isn't waited for
    const failed = vids.filter((v) => (v?.ok && v.result?.status?.state === 'error') || (v && !v.ok && v.status === 404)).length;
    const waiting = uids.length - ready.length - failed;
    const waitedEnough = Date.now() - Date.parse(state.endedAt || 0) >= REPLAY_WAIT_ALL_MS;
    if (!ready.length || (waiting && !waitedEnough)) return state;
    pick = ready.reduce((a, b) => (replayScore(b, state) > replayScore(a, state) ? b : a));
  } else if (config.liveInput?.uid) {
    const vids = await stream.listInputVideos(env, config.liveInput.uid);
    const liveAt = state.liveAt ? Date.parse(state.liveAt) - 10 * 60e3 : 0;
    pick = (vids.result || []).find(x => x.status?.state === 'ready' && Date.parse(x.created) >= liveAt) || null;
  }
  if (!pick?.uid) return state;
  const uid = pick.uid;
  const created = pick.created || null;
  // When this recording began, so the reveal stats line its moment up with the live minutes
  const s = { ...state, replayUid: uid, replayReadyAt: nowIso(), replayStartedAt: Number.isFinite(Date.parse(created || '')) ? new Date(Date.parse(created)).toISOString() : null };
  s.replayPieces = uids.length > 1 ? { count: uids.length, minutes: Math.round((Number(pick.duration) || 0) / 60) } : null;
  work.push('replay-ready');
  await stream.updateVideo(env, uid, { meta: { name: `${s.kidName ? `${s.kidName}'s` : 'Live'} reveal (${(s.liveAt || nowIso()).slice(0, 10)})` } }).catch(() => {});
  await stream.requestCaptions(env, uid);
  return s;
}

async function replayOutward(env, config, state, health, work) {
  const s = { ...state, replayOut: true };
  const uid = s.replayUid;
  // Recorded in pieces (the phone reconnected): say which one went out, and where to change it
  if (s.replayPieces?.count > 1 && await claimOnce(env.DB, s.broadcastId, 'replay-pieces')) {
    await notify.alertAdmins(env, config, { level: 'info', kind: 'news', icon: '🎞️', title: `Replay chosen: ${s.title || 'the reveal'}`,
      detail: `The phone reconnected, so Stream recorded this reveal in ${s.replayPieces.count} pieces. The replay and the kid's page use the ${s.replayPieces.minutes}-minute piece with the most of the reveal after its start time. To show another piece, use Set replay under Reveals → History; the kid's page link is under Kids.`,
      url: `${SITE_ORIGIN}/admin/#broadcast` });
  }
  if (s.kidSlug) {
    try {
      const attached = await attachToKid(env, s.kidSlug, uid, s.title, 'live-broadcast');
      if (attached) {
        work.push(`attached:${s.kidSlug}`);
        if (await claimOnce(env.DB, s.broadcastId, 'replay-deploy') && await triggerDeploy(env, health, `Reveal replay attached to ${s.kidName || s.kidSlug}`)) work.push('deploy');
      }
    } catch { /* retry never; admin can attach */ }
  }
  await sendReminders(env, config, s, 'replay', work);
  // One Kit replay draft per broadcast; a tick that lost the race reads the winner's draft id
  let draft = null;
  if (await claimOnce(env.DB, s.broadcastId, 'kit-replay-draft')) {
    draft = await draftKit(env, s, 'replay');
    if (draft) await settleClaim(env.DB, s.broadcastId, 'kit-replay-draft', { id: draft });
  } else {
    draft = (await claimResult(env.DB, s.broadcastId, 'kit-replay-draft'))?.id || null;
  }
  if (draft) s.kit = { ...(s.kit || {}), replayDraftId: draft };
  if (reels.reelEnabled(config) && !s.reel) { s.reel = reels.startReel(s, uid, s.revealAtSeconds); work.push('reel:start'); }
  if (await claimOnce(env.DB, s.broadcastId, 'replay-ready')) {
    await recordEvent(env.DB, s.broadcastId, 'replay_ready', { uid });
    await logAudit(env.DB, { userEmail: 'live-broadcast', action: 'created', entityType: 'stream-video', entitySlug: uid, entityName: `Reveal recording ready: ${s.title || s.broadcastId}`, gitStatus: 'ok' });
  }
  return s;
}

/**
 * Automatic Kit send, checked every tick while live. It goes out once the
 * stream has stayed up KIT_LIVE_STEADY_MS in one stretch AND the kid is
 * known (scheduled, picked in the admin, or read from Facebook). Held, with
 * an alert, when a scheduled reveal starts more than 30 minutes early, or
 * when no kid turns up in the first 30 minutes. "Email the list now" in the
 * admin covers every held case.
 */
/**
 * When "we're live" may go out (the sign-ups' and the list's): the go-live, or for a planned reveal its planned start
 * if the phone came on before it. A framing check before the start emails nobody; a phone still on at the start is the
 * reveal, and everyone hears then. → ms
 */
export function liveNewsFrom(state) {
  const live = Date.parse(state?.liveAt || '');
  const at = Date.parse(state?.scheduledAt || '');
  return Number.isFinite(at) && at > live ? at : live;
}

/** Went live more than KIT_LIVE_EARLY_MS before its planned start: maybe a phone test, so no "we're live" goes by itself */
export function wentLiveEarly(state) {
  return !!state?.scheduledAt && !!state.liveAt && Date.parse(state.liveAt) < Date.parse(state.scheduledAt) - KIT_LIVE_EARLY_MS;
}

async function kitAutoLive(env, config, state, work) {
  // Nothing during a gap (the phone dropped and may be gone): the unbroken stretch starts again when it is back
  if (state.phase !== 'live' || state.quiet || state.gapSince || !kitConfigured(env) || state.kit?.live || !kitLiveWanted(state, config)) return state;
  if (state.source === 'manual' && !state.scheduledAt) return state; // emergency banner: humans decide
  const now = Date.now();
  const hold = async (error, title, detail) => {
    work.push('kit-live-held');
    // Once per time on air (a framing check and the real start each get their own note)
    if (await claimOnce(env.DB, state.broadcastId, `kit-live-held:${state.liveAt || ''}`)) await notify.alertAdmins(env, config, { level: 'warn', title, detail, url: `${SITE_ORIGIN}/admin/` });
    return { ...state, kit: { ...(state.kit || {}), live: { id: null, held: true, error } } };
  };
  if (wentLiveEarly(state)) {
    return hold('Went live more than 30 minutes early; not sent automatically', 'Went live early: "we\'re live" emails held', `${state.title || 'The reveal'} went live more than 30 minutes before its scheduled time, so the "we're live" emails (to the Kit list and to the people who signed up for this reveal) were not sent automatically: it could be a phone test. If this is the real reveal, press "Email the list now" in Admin → Broadcast.`);
  }
  if (now - Date.parse(state.segmentAt || state.liveAt) < (state.scheduledAt ? KIT_LIVE_STEADY_MS : KIT_LIVE_STEADY_UNPLANNED_MS)) return state;
  // Before the planned start the phone may be a framing check: the list hears at the start, if it's still on
  if (now < liveNewsFrom(state)) return state;

  let s = state;
  if (!s.kidSlug) s = await identifyKid(env, s, work);
  if (!s.kidSlug) {
    if (now - Date.parse(s.liveAt) > KIT_LIVE_LATE_MS) {
      state = s;
      return hold('No kid identified in the first 30 minutes', "Kit email not sent: which kid is this?", 'The stream has been live 30 minutes and nothing said which kid it is, so the "we\'re live" email was not sent. Pick the kid and press "Email the list now" in Admin → Broadcast if it is still worth sending.');
    }
    if (!s.kidAlertAt) {
      s = { ...s, kidAlertAt: nowIso() };
      if (await claimOnce(env.DB, s.broadcastId, 'kid-alert')) await notify.alertAdmins(env, config, { level: 'warn', title: 'Live now: which kid is this?', detail: 'The Kit "we\'re live" email is waiting for the kid. Nothing on Facebook named one yet. Pick the kid in Admin → Broadcast → Now and the email goes out right away, or put the kid\'s name in the first line of the Facebook post.', url: `${SITE_ORIGIN}/admin/`, text: true });
    }
    return s;
  }
  if (now - Date.parse(s.liveAt) > KIT_LIVE_LATE_MS && s.kidVia !== 'admin') {
    state = s;
    return hold('Kid identified more than 30 minutes in; not sent automatically', 'Kit email not sent: too late', `${s.kidName || 'The kid'} was identified more than 30 minutes into the stream, so the "we're live" email was not sent by itself. Press "Email the list now" in Admin → Broadcast if it is still worth sending.`);
  }
  return sendKitLive(env, config, s, work);
}

/** Kids a reveal could be for: no reveal video yet, this year or last. */
async function openKids(DB) {
  const res = await DB.prepare('SELECT slug, name, year, status, data FROM kids').all();
  const year = new Date(Date.now()).getUTCFullYear();
  return (res?.results || []).map((r) => {
    let d = {}; try { d = JSON.parse(r.data || '{}'); } catch {}
    return { slug: r.slug, name: r.name || d.name, year: Number(r.year) || null, image: d.heroImage || d.photos?.[0]?.url || null, reveal: d.revealVideoUrl || null };
  }).filter((k) => k.name && !k.reveal && k.year && k.year >= year - 1);
}

/**
 * Work out which kid an unscheduled reveal is for from what's public on
 * Facebook: the live post first, then the Page's posts from the last day,
 * newest first. A clue only counts when it names exactly one open kid.
 * Throttled to once a minute. The other session's waiting screen, the
 * admin, or a schedule setting state.kidSlug short-circuits all of this.
 */
async function identifyKid(env, state, work) {
  if (!fb.fbConfigured(env)) return state;
  if (state.kidCheckAt && Date.now() - Date.parse(state.kidCheckAt) < KID_CLUE_INTERVAL_MS) return state;
  const s = { ...state, kidCheckAt: nowIso() };
  const [clues, kids] = await Promise.all([fb.fbRevealClues(env), openKids(env.DB)]);
  const ordered = [...clues.filter((c) => c.source === 'facebook-live'), ...clues.filter((c) => c.source !== 'facebook-live').sort((a, b) => Date.parse(b.at) - Date.parse(a.at))];
  for (const c of ordered) {
    for (const text of [c.lead, c.text]) {
      const m = matchKids(kids, text);
      if (m.length > 1) break; // ambiguous clue: try the next one
      if (m.length === 1) return applyKid(s, m[0], c.source, work);
    }
  }
  return s;
}

function applyKid(state, kid, via, work) {
  const generic = !state.kidSlug;
  const s = { ...state, kidSlug: kid.slug, kidName: kid.name, kidVia: via };
  if (!s.image && kid.image) s.image = kid.image;
  if (generic) { s.title = `${kid.name}'s room reveal`; s.message = `Watch ${kid.name}'s room reveal live`; }
  if (work) work.push(`kid:${kid.slug}:${via}`);
  return s;
}

// ─── Facebook side effects ──────────────────────────────────────────

/**
 * The words on the Facebook live post, made when the phone goes live (never ahead of it): the kid's story, as
 * the live page's lead has it (heroSummary, else shortDescription), then "Live now". No link in the post: the
 * link to watch on our website and leave the family a message is the Page's first comment on it (`comment`,
 * fbFirstComment), because Facebook shows posts with a link to fewer people (Peter, Nov 20 2026). Staff's own
 * message, when they wrote one, takes the place of the "Live now" line; a broadcast with no kid keeps staff's own
 * words and gets no comment, as before. The title is unchanged.
 */
export async function fbLiveWords(DB, state, config) {
  const title = state.title || config?.defaults?.title || 'Live now';
  if (!state.kidSlug) return { title, description: state.message || '', comment: null };
  const name = state.kidName || null;
  let story = '';
  const row = await DB.prepare('SELECT data FROM kids WHERE slug = ?').bind(state.kidSlug).first().catch(() => null);
  try { const d = JSON.parse(row?.data || '{}'); story = String(d.heroSummary || d.shortDescription || '').replace(/\s+/g, ' ').trim(); } catch { story = ''; }
  const own = state.message && state.message !== `Watch ${name}'s room reveal live` && state.message !== config?.defaults?.message ? state.message : null;
  const line = own || `Live now: watch the moment ${name || 'a child'} sees the new room for the first time.`;
  const comment = `Watch on our website too, and leave a message for the family: ${liveLinkFor(state, 'facebook')}`;
  return { title, description: [story, line].filter(Boolean).join('\n\n'), comment };
}

/**
 * The website link as the Page's first comment on its live post, once per post. Tried on the tick that made the
 * post and the ticks after (Facebook may not take a comment the second the post exists), FB_COMMENT_TRIES times
 * at most, each try its own claim so racing ticks never comment twice. If Facebook won't take it (a missing
 * permission at once, anything else after the last try), staff are told once, with the words to paste by hand:
 * Slack and email as before, and a text to the staff numbers followed by a text of the comment alone, ready to copy
 * (Peter, Nov 21 2026: "1b", text the crew the paste-ready comment, not just email).
 * The post stands either way. goLiveEffects runs it while the go-live is recent, as it does the post.
 */
const FB_COMMENT_TRIES = 3;
async function fbFirstComment(env, config, state, work) {
  const id = state.fb?.liveVideoId;
  const bid = state.broadcastId;
  if (config.facebook?.mode !== 'api' || !id || !bid || state.quiet || !fb.fbConfigured(env)) return state;
  const done = await claimedKeys(env.DB, bid);
  if (done.has(`fb-comment-done:${id}`) || done.has(`fb-comment-alert:${id}`)) return state;
  let n = 1;
  while (done.has(`fb-comment:${id}:${n}`)) n++;
  if (n > FB_COMMENT_TRIES) return state;
  if (!(await claimOnce(env.DB, bid, `fb-comment:${id}:${n}`))) return state; // another tick has this try
  const words = await fbLiveWords(env.DB, state, config).catch(() => null);
  if (!words?.comment) { await claimOnce(env.DB, bid, `fb-comment-done:${id}`); return state; }
  const r = await fb.commentOnFbLive(env, id, words.comment);
  if (r.ok) {
    await claimOnce(env.DB, bid, `fb-comment-done:${id}`);
    await settleClaim(env.DB, bid, `fb-comment-done:${id}`, { commentId: r.id, on: r.on });
    work.push('fb-comment');
    return state;
  }
  await settleClaim(env.DB, bid, `fb-comment:${id}:${n}`, { error: r.error || 'unknown', code: r.code || null });
  work.push('fb-comment-failed');
  if ((r.permission || n >= FB_COMMENT_TRIES) && await claimOnce(env.DB, bid, `fb-comment-alert:${id}`)) {
    // The post's own link once Facebook has given it, else the Page, where the live video is at the top
    const [alertLine, paste] = notify.fbCommentTexts({ comment: words.comment, postUrl: state.fb?.permalink || config.facebook?.pageUrl || null });
    await notify.alertAdmins(env, config, {
      level: 'warn', title: 'Facebook: the website link comment didn\'t post',
      detail: `The live post is up; only the Page's first comment failed (${r.error || 'unknown error'}${r.permission ? ': the Facebook token needs the pages_manage_engagement permission' : ''}). Post this as a comment from the Page on the live video:\n\n${words.comment}`,
      url: `${SITE_ORIGIN}/admin/#broadcast/control-room`,
      text: alertLine,
    }).catch(() => {});
    // After the alert, so it lands second: the words alone
    await notify.textStaff(env, config, { title: 'Facebook comment to paste', body: paste }).catch(() => {});
  }
  return state;
}

async function fbOnLive(env, config, state, work) {
  const s = { ...state, fb: { ...(state.fb || {}) } };
  if (!fb.fbConfigured(env) || state.quiet) return s;
  if (config.facebook?.mode === 'api' && !s.fb.liveVideoId && !s.fb.needsReview && config.liveInput?.uid) {
    // One Facebook live post per stretch on air, however many ticks race here; the claim keeps its ids. One
    // from an earlier stretch (fbSessionAt) is never this one's: it gives way, and is never read back
    if (!(await claimFresh(env.DB, s.broadcastId, 'fb-live-post', s.fbSessionAt))) {
      const made = await freshResult(env.DB, s.broadcastId, 'fb-live-post', s.fbSessionAt);
      if (made?.liveVideoId) { s.fb.liveVideoId = made.liveVideoId; s.fb.outputUid = made.outputUid || null; }
      return s;
    }
    const words = await fbLiveWords(env.DB, s, config).catch(() => ({ title: s.title, description: s.message }));
    const created = await fb.createFbLiveVideo(env, words);
    if (created.ok) {
      s.fb.liveVideoId = created.id;
      await settleClaim(env.DB, s.broadcastId, 'fb-live-post', { liveVideoId: created.id, outputUid: null });
      const split = fb.splitIngestUrl(created.ingestUrl);
      if (split && stream.streamConfigured(env)) {
        const out = await stream.createOutput(env, config.liveInput.uid, { url: split.url, streamKey: split.streamKey, enabled: true });
        if (out.ok) {
          s.fb.outputUid = out.result?.uid || null; work.push('fb-api-output');
          await settleClaim(env.DB, s.broadcastId, 'fb-live-post', { liveVideoId: created.id, outputUid: s.fb.outputUid });
        }
      }
      work.push('fb-live-post');
    } else {
      s.fb.lastError = created.error;
      if (created.needsReview) s.fb.needsReview = true;
      work.push('fb-live-post-failed');
    }
  }
  return s;
}

async function fbRefreshPermalink(env, state, work) {
  const s = { ...state, fb: { ...(state.fb || {}) } };
  if (!fb.fbConfigured(env) || s.fb.permalink) return s;
  const last = s.fb.checkedAt ? Date.parse(s.fb.checkedAt) : 0;
  if (Date.now() - last < FB_PERMALINK_INTERVAL_MS) return s;
  s.fb.checkedAt = nowIso();
  let permalink = null;
  if (s.fb.liveVideoId) permalink = await fb.fbLiveVideoPermalink(env, s.fb.liveVideoId);
  if (!permalink) { const cur = await fb.fbCurrentLive(env); if (cur) { permalink = cur.permalink; s.fb.liveVideoId = s.fb.liveVideoId || cur.id; } }
  if (permalink) { s.fb.permalink = permalink; work.push('fb-permalink'); }
  return s;
}

async function fbOnEnd(env, config, state, work) {
  const s = { ...state, fb: { ...(state.fb || {}) } };
  if (config.facebook?.mode === 'api' && s.fb.liveVideoId && !s.fb.ended) {
    const r = await fb.endFbLiveVideo(env, s.fb.liveVideoId);
    s.fb.ended = r.ok;
    if (r.ok) work.push('fb-ended');
    if (s.fb.outputUid && config.liveInput?.uid && stream.streamConfigured(env)) {
      await stream.deleteOutput(env, config.liveInput.uid, s.fb.outputUid).catch(() => {});
      s.fb.outputUid = null;
    }
  }
  return s;
}

// ─── Health ─────────────────────────────────────────────────────────

async function runHealth(env, config, state, health, work, { force = false } = {}) {
  const now = Date.now();
  const last = health.lastDailyAt ? Date.parse(health.lastDailyAt) : 0;
  const soon = state.scheduledAt && Date.parse(state.scheduledAt) - now < 24 * 3600e3 && Date.parse(state.scheduledAt) > now;
  const due = force || now - last > DAILY_HEALTH_MS || (soon && now - last > REVEAL_MORNING_HEALTH_MS);
  if (!due) return;
  health.lastDailyAt = nowIso();
  work.push('health');
  const problems = [];

  if (stream.streamConfigured(env)) {
    const t = await stream.checkToken(env);
    health.stream = { ok: t.ok, error: t.error || null, at: nowIso() };
    if (!t.ok) problems.push(`Cloudflare Stream token failed: ${t.error}`);
    if (t.ok && config.liveInput?.uid) {
      const li = await stream.getLiveInput(env, config.liveInput.uid);
      if (!li.ok) problems.push(`Live input ${config.liveInput.uid} not found: ${stream.errorMessage(li)}`);
    }
  } else {
    health.stream = { ok: false, error: 'CF_STREAM_TOKEN / CF_ACCOUNT_ID not set', at: nowIso() };
    problems.push('Cloudflare Stream is not configured');
  }
  if (!config.liveInput?.uid) problems.push('No live input yet: open Admin → Broadcast → Settings → Phones');

  const f = await fb.checkFbToken(env);
  health.facebook = { ok: f.ok, name: f.name || null, error: f.error || null, at: nowIso(), configured: f.configured !== false };
  if (f.configured !== false && !f.ok) problems.push(`Facebook token failed: ${f.error}`);

  const h = await hubStatus(env);
  health.hub = { ok: !!h.ok, clients: h.clients || 0, at: nowIso(), error: h.error || null, lastTick: h.lastTick || null };
  if (!h.ok) problems.push(`Real-time hub unreachable: ${h.error || 'unknown'}`);
  const wh = await preflight.webhookProblem(env.DB, health).catch(() => null);
  if (wh) problems.push(`${wh}. Check that the Cloudflare webhook's secret matches STREAM_WEBHOOK_SECRET in Cloudflare Pages`);

  const key = problems.length ? problems.join(' | ') : '';
  const prev = health.flags?.problems || '';
  if (key && key !== prev) {
    await notify.alertAdmins(env, config, { level: 'error', title: soon ? 'Reveal-day check found problems' : 'Live broadcast health check failed', detail: problems.map((p) => `• ${p}`).join('\n'), url: `${SITE_ORIGIN}/admin/`, issue: 'broadcast-health', text: soon });
    work.push('alert:health');
  } else if (!key && prev) {
    await notify.alertAdmins(env, config, { level: 'info', title: 'Live broadcast health recovered', detail: 'All checks pass again.', url: `${SITE_ORIGIN}/admin/`, resolves: 'broadcast-health', text: !!health.flags?.texted });
  }
  health.flags = { ...(health.flags || {}), problems: key, texted: !key ? false : key !== prev ? !!soon : !!health.flags?.texted };
}

// ─── Go-live and ended effects ──────────────────────────────────────

const recent = (iso) => !!iso && Date.now() - Date.parse(iso) <= EFFECTS_RETRY_MS;

/**
 * What a stream going live sets off, each until its claim exists: the
 * broadcast's row, the Facebook live post (API mode) and the staff "Live now"
 * announcement (event, audit, alert). The "we're live" reminders follow the
 * same rule through dueReminderKinds. Runs on the tick that saves the change
 * and on every tick after for EFFECTS_RETRY_MS, so a tick cut off right after
 * saving the phase (a D1 error, a cancelled request) loses none of them.
 * A banner-only go-live is the admin's own command and sets off nothing here.
 */
async function goLiveEffects(env, config, state, work, by) {
  const { DB } = env;
  // A test on the main feed sets off none of it (test mode)
  if (!['live', 'ending'].includes(state.phase) || state.source !== 'stream' || !state.broadcastId || state.quiet || !recent(state.liveAt)) return state;
  const done = await claimedKeys(DB, state.broadcastId);
  if (!done.has('live-row')) { await upsertBroadcastRow(DB, state); await claimOnce(DB, state.broadcastId, 'live-row'); }
  // Also when the post was claimed but this state lacks its id (the tick that made it lost its save): fbOnLive reads it back.
  // Not while a Facebook release is still pending (preShowEffects opens the post once it is done)
  if (!state.fbReopen && !state.preShowFb && (!done.has('fb-live-post') || (config.facebook?.mode === 'api' && !state.fb?.liveVideoId))) state = await fbOnLive(env, config, state, work);
  // The website link as the post's first comment (never in the post itself)
  if (!state.fbReopen && !state.preShowFb && state.fb?.liveVideoId) state = await fbFirstComment(env, config, state, work);
  if (!done.has('live-announce') && await claimOnce(DB, state.broadcastId, 'live-announce')) {
    await recordEvent(DB, state.broadcastId, 'live_start', { source: state.source, videoUid: state.liveVideoUid });
    await logAudit(DB, { userEmail: by || 'live-broadcast', action: 'published', entityType: 'live-status', entitySlug: state.broadcastId, entityName: state.title || 'Live broadcast', gitStatus: 'ok' });
    await notify.alertAdmins(env, config, {
      level: 'info', kind: 'news', icon: '📡', title: `Live now: ${state.title || 'the reveal'}`,
      detail: 'The site, Facebook and YouTube are all showing it.',
      facts: [['Started from', 'The phone']],
      url: liveUrlFor(state), links: [{ label: 'Open the control room', url: `${SITE_ORIGIN}/admin/#broadcast/control-room` }],
      // The text promises only what's known this second; "All green" follows once the feed monitor has checked
      text: notify.liveNowText({ title: state.title, url: liveUrlFor(state) }),
    });
    work.push('announced-live');
  }
  return state;
}

/**
 * After a framing check (tPreShowOver): release its Facebook live post so the reveal opens its own (the
 * claim goes; the post is closed when Facebook answers, best effort, and its Stream output removed), and
 * tell staff the reveal is waiting for its phone again. Runs before the go-live effects, in whatever phase
 * the next tick finds (the phone may already be back). Each part once.
 */
async function preShowEffects(env, config, state, work, health = null) {
  if (!state.preShowFb && !state.preShowNote && !state.fbReopen) return state;
  const { DB } = env;
  let s = state;
  if (s.preShowFb || s.fbReopen) {
    // Once per framing check or pick-up (fbReleaseKey), however many ticks get here: close the old post, and
    // free the broadcast to open a new one and to close that one when it ends
    const won = await claimTry(DB, s.broadcastId, `fb-release:${s.fbReleaseKey || ''}`);
    if (won === null) { work.push('fb-release-retry'); return s; } // D1 didn't answer: the next tick tries again
    if (won) {
      // The claims go first, before any slow call, so no other tick can adopt the old post meanwhile. On air
      // (picked up again) only the earlier stretch's: a post this stretch already opened is kept
      if (['live', 'ending'].includes(s.phase) && s.fbSessionAt) {
        await DB.prepare("DELETE FROM broadcast_claims WHERE broadcast_id = ? AND key IN ('fb-live-post', 'fb-ended') AND created_at < ?").bind(s.broadcastId, s.fbSessionAt).run();
      } else {
        await DB.prepare("DELETE FROM broadcast_claims WHERE broadcast_id = ? AND key IN ('fb-live-post', 'fb-ended')").bind(s.broadcastId).run();
      }
      if (s.preShowFb) {
        if (config.facebook?.mode === 'api' && fb.fbConfigured(env) && s.preShowFb.liveVideoId) {
          const r = await fb.endFbLiveVideo(env, s.preShowFb.liveVideoId).catch(() => ({ ok: false }));
          work.push(r.ok ? 'pre-show-fb-ended' : 'pre-show-fb-end-failed');
        }
        if (s.preShowFb.outputUid && config.liveInput?.uid && stream.streamConfigured(env)) {
          await stream.deleteOutput(env, config.liveInput.uid, s.preShowFb.outputUid).catch(() => {});
        }
      }
    }
    const reopen = !!s.fbReopen && ['live', 'ending'].includes(s.phase);
    s = { ...s, preShowFb: null, fbReopen: false, fbReleaseKey: null };
    // A reveal picked up again: its new post opens now (the go-live effects are long past for it). The
    // fb-live-post claim makes it one post: a tick that lost the race reads the other's post back
    if (reopen) s = await fbOnLive(env, config, s, work);
  }
  if (s.preShowNote) {
    const n = s.preShowNote;
    if (await claimOnce(DB, s.broadcastId, `pre-show:${n.at}`)) {
      await recordEvent(DB, s.broadcastId, 'pre_show', { minutes: n.minutes });
      // The feed watch and the viewer counts start again with the reveal: a framing check's issues and peak aren't its
      if (health?.monitor?.broadcastId === s.broadcastId) health.monitor = null;
      await DB.prepare('DELETE FROM broadcast_stats WHERE broadcast_id = ?').bind(s.broadcastId).run().catch(() => {});
      await notify.alertAdmins(env, config, { level: 'info', kind: 'news', icon: '🎬', title: `Back to waiting: ${s.title || 'the reveal'}`,
        detail: `The phone stopped after ${n.minutes} minute${n.minutes === 1 ? '' : 's'}, before the ${notify.formatWhen(s.scheduledAt, config.timezone)} start, so that was a framing check, not the reveal. The countdown is back up and the reveal starts when a phone streams again.${n.kitSent ? ' The Kit list was already emailed "we\'re live" during it; it won\'t be emailed again.' : ''}`,
        url: `${SITE_ORIGIN}/admin/#broadcast` });
    }
    s = { ...s, preShowNote: null };
  }
  return s;
}

/**
 * What a stream ending sets off, by the same rule: the row, ending the
 * Facebook live video (API mode), and the "Ended" announcement with the feed
 * monitor's health report. "End now" in the admin claims the last two itself.
 */
async function endedEffects(env, config, state, health, work, by) {
  const { DB } = env;
  if (state.phase !== 'replay' || state.source !== 'stream' || !state.broadcastId) return state;
  const fresh = recent(state.endedAt) || recent(state.closedAt);
  if (!fresh) return state;
  const done = await claimedKeys(DB, state.broadcastId);
  if (!done.has('ended-row')) { await upsertBroadcastRow(DB, state); await claimOnce(DB, state.broadcastId, 'ended-row'); }
  // Facebook's post closes when the site ends the reveal: Facebook keeps a dropped stream's post open only
  // 2–3 minutes, and a phone back later (tRejoin) opens a new one
  if ((!done.has('fb-ended') || (state.fb?.liveVideoId && !state.fb?.ended)) && await claimFresh(DB, state.broadcastId, 'fb-ended', state.fbSessionAt)) state = await fbOnEnd(env, config, state, work);
  // The "Ended" announcement and its health report wait while a phone may still pick the reveal up again (not once the
  // crew has said it's over)
  if (waitsForPhone(state) || !recent(state.closedAt || state.endedAt)) return state;
  if (!done.has('ended-announce') && await claimOnce(DB, state.broadcastId, 'ended-announce')) {
    const mins = state.liveAt ? Math.round((Date.parse(state.endedAt || nowIso()) - Date.parse(state.liveAt)) / 60000) : null;
    await recordEvent(DB, state.broadcastId, 'live_end', { minutes: mins });
    await logAudit(DB, { userEmail: by || 'live-broadcast', action: 'updated', entityType: 'live-status', entitySlug: state.broadcastId, entityName: `Ended: ${state.title || 'Live broadcast'}`, changes: [{ field: 'minutes', from: null, to: mins }], gitStatus: 'ok' });
    // The feed monitor's health report (sound, issues, Facebook/YouTube timing) rides along
    const ended = await monitor.finish(env, config, state, health, recordEvent).catch(() => ({ summary: '' }));
    await notify.alertAdmins(env, config, { level: 'info', kind: 'news', icon: '🎬', title: `Ended: ${state.title || 'the reveal'}`, detail: [mins != null ? `Ran ${mins} minutes.` : null, ended.summary || null, mins != null ? 'Replay will attach to the kid\'s page when Stream finishes processing.' : 'Replay will attach when ready.'].filter(Boolean).join('\n'), url: `${SITE_ORIGIN}/admin/` });
    work.push('announced-end');
  }
  return state;
}

/**
 * "Is the reveal over?" The site can't tell a dropped signal from the crew stopping the phone because the reveal
 * is done (Peter, Nov 18 2026), so once the phone has been away OVER_ASK_AFTER_MS, a tick texts every staff alert
 * number, once per stretch on air (claimed on the stretch's start, so the gap turning into 'ending' asks nothing
 * twice, and a phone back and gone again is asked again). Also in test mode ("Test: "), so it can be tried with a
 * real phone. Never for the emergency banner, a framing check, or the rehearsal feed (which has its own record,
 * never this tick). Their Y or N comes back through functions/api/twilio-inbound.js (answerByText).
 */
// A blip Larix rides out in a few seconds asks nobody: the same wait as the feed monitor's "The phone lost its connection"
const OVER_ASK_AFTER_MS = monitor.RULES.disconnectedAfter;
const stopOf = (state) => (state.phase === 'ending' ? state.disconnectedAt : state.phase === 'live' ? state.gapSince : null);
/** The question's claim: one per stretch on air (the stop that ends it), so an answer can tell it is about this stop */
const overAskKey = (state) => `over-ask:${state.segmentAt || state.liveAt || stopOf(state)}`;
async function claimExists(DB, broadcastId, key) {
  if (!broadcastId) return false;
  const row = await DB.prepare('SELECT 1 AS x FROM broadcast_claims WHERE broadcast_id = ? AND key = ?').bind(broadcastId, key).first().catch(() => null);
  return !!row;
}

/** Does this stop get "Is the reveal over?" Then the feed monitor doesn't also text "The phone lost its connection" */
async function overQuestionFor(env, config, state) {
  const stoppedAt = stopOf(state);
  if (!stoppedAt || state.source !== 'stream' || !state.broadcastId || preShow({ ...state, disconnectedAt: stoppedAt })) return false;
  // Only while a reply can reach the site (twilio-inbound.js; set from /api/broadcast connectTextReplies)
  return notify.overQuestionOn(env, config);
}

async function askIfOver(env, config, state, work) {
  const stoppedAt = stopOf(state);
  // Already answered N (it is being held), or a stop long past (a deploy mid-hold): nothing to ask
  if (!stoppedAt || !recent(stoppedAt) || holding(state)) return state;
  if (Date.now() - Date.parse(stoppedAt) < OVER_ASK_AFTER_MS) return state;
  if (!(await overQuestionFor(env, config, state))) return state;
  if (!(await claimOnce(env.DB, state.broadcastId, overAskKey(state)))) return state;
  // Each number its own text: its "Or tap:" link names it (functions/over/[token].js); no link, the plain question
  const key = overAskKey(state);
  const sends = await Promise.all(notify.alertPhones(config).map(async (to) => {
    const link = await overLinkFor(env, { broadcastId: state.broadcastId, key, phone: to }).catch(() => null);
    const body = notify.overQuestionText({ kidName: state.kidName, at: stoppedAt, tz: config.timezone, test: !!(state.quiet || state.test), link });
    return notify.sendSms(env, { to: [to], body }).catch((e) => ({ sent: 0, failed: 1, errors: [e.message], optedOut: [], accepted: [] }));
  }));
  const r = { sent: 0, failed: 0, errors: [], optedOut: [], accepted: [] };
  for (const x of sends) { r.sent += x.sent; r.failed += x.failed; r.errors.push(...x.errors); r.optedOut.push(...x.optedOut); r.accepted.push(...x.accepted); }
  await notify.recordAlertTexts(env.DB, { title: 'Is the reveal over?', result: r }).catch(() => {});
  await recordEvent(env.DB, state.broadcastId, 'over_asked', { stoppedAt, sent: r.sent, failed: r.failed });
  work.push('asked-if-over');
  return state;
}

/**
 * How long until "Is the reveal over?" is due for the stop on now (ms), while it is still to come. The hub's heartbeat
 * (every 8 s on air) then runs one more tick at that moment (broadcast-hooks.js), so the text goes 10 s after the phone
 * stops rather than at the next heartbeat, up to 8 s later (Peter, Nov 18 2026: "yes send text sooner"; viewers watch
 * about 20 s behind, so a quick Y brings "That's the reveal!" about when their video ends). null: no stop, already due,
 * held, or asked
 */
export async function overAskDueIn(env, now = Date.now()) {
  const state = await readState(env.DB);
  const stoppedAt = stopOf(state);
  if (!stoppedAt || !recent(stoppedAt) || holding(state) || state.source !== 'stream' || !state.broadcastId) return null;
  const due = Date.parse(stoppedAt) + OVER_ASK_AFTER_MS - now;
  if (!(due > 0) || due > OVER_ASK_AFTER_MS) return null;
  if (await claimExists(env.DB, state.broadcastId, overAskKey(state))) return null;
  return due;
}

/**
 * Test mode is about to turn itself off, or just has: staff hear it (Slack and a text), once per switch-on. Turned
 * off by hand says nothing (they know); a reveal going on air clears the switch (no "off" note then either).
 * → the record as saved (warnedFor / endedFor: the end time each note was about)
 */
export async function warnQuietEnding(env, config, q, state, work, now = Date.now()) {
  const until = quietUntil(q, state);
  if (until == null) return q;
  const key = new Date(until).toISOString();
  const when = notify.formatWhen(key, config.timezone);
  const testing = !!state.quiet && ['live', 'ending'].includes(state.phase);
  // Ended by the planned reveal's own window (30 minutes before it), not the 2-hour timer: a phone streaming then IS
  // the reveal (quietReachedReveal), and turning the switch on again can't move that
  const own = Date.parse(q?.until || '');
  const byReveal = plannedAt(state) != null && Number.isFinite(own) && until < own - 1000;
  const planned = state.quiet ? state.resume : state;
  const reveal = planned?.kidName ? `${planned.kidName}'s reveal` : 'the reveal';
  const warn = now < until;
  if (warn ? until - now > QUIET_WARN_MS : now - until > QUIET_ENDED_NEWS_MS) return q;
  // Once per end time, whichever tick or isolate gets there first (a claim, not a rewrite of the switch's record)
  if (!(await claimOnce(env.DB, QUIET_CLAIMS, `${warn ? 'quiet-warn' : 'quiet-ended'}:${key}`))) return q;
  const mins = Math.max(1, Math.round((until - now) / 60000));
  const title = warn ? `Test mode ends in ${mins} minute${mins === 1 ? '' : 's'}` : 'Test mode is off';
  const detail = byReveal
    ? `${warn ? 'Test mode ends' : 'Test mode ended'} at ${when}, 30 minutes before ${reveal}. ${warn ? 'From then' : 'Now'} a phone on the main feed is the reveal itself: the website, Facebook and the "we're live" emails.${testing ? ` The phone streaming now ${warn ? 'becomes' : 'is'} the reveal${warn ? ' then: stop it before then if it is only a test' : ': stop it if it was only a test'}.` : ''} Check sound on the rehearsal feed instead.`
    : `${warn ? 'Test mode turns itself off' : 'Test mode turned itself off'} at ${when}. ${warn ? 'After that' : 'Now'}, a phone that connects on the main feed goes out for real: the website, Facebook and the "we're live" emails.${testing ? ' The test streaming now stays a test until the phone stops.' : ''} ${warn ? 'To keep testing, turn Test mode on again' : 'To test again, turn Test mode on first'} in Admin → Broadcast → Now.`;
  await notify.alertAdmins(env, config, { level: 'warn', title, detail, url: `${SITE_ORIGIN}/admin/#broadcast`, text: true });
  work.push(warn ? 'test-ending-warned' : 'test-ended-warned');
  return q;
}

/**
 * Test mode keeps Facebook and YouTube out of it by pausing every Stream output
 * on the main feed that is on, while the switch is on or a test is still
 * streaming, and putting back exactly those once neither is true. An output
 * someone paused in Settings is left as it is. Looked at every
 * QUIET_OUTPUTS_CHECK_MS (`force` for the admin's switch). → the record as saved
 */
export async function syncQuietOutputs(env, config, q, state, work, { force = false } = {}) {
  const inputUid = config.liveInput?.uid;
  if (!inputUid || !stream.streamConfigured(env)) return q;
  const testLive = !!state.quiet && ['live', 'ending'].includes(state.phase);
  const want = testLive || quietOn(q, state);
  const paused = Array.isArray(q.paused) ? q.paused : [];
  if (!want && !paused.length) return q;
  if (!force && q.checkedAt && Date.now() - Date.parse(q.checkedAt) < QUIET_OUTPUTS_CHECK_MS) return q;
  const next = { ...q, paused: [...paused], checkedAt: nowIso() };
  if (want) {
    const list = await stream.listOutputs(env, inputUid).catch(() => null);
    if (!list?.ok) work.push('test-outputs-unread');
    for (const o of (list?.ok ? list.result || [] : [])) {
      if (!o?.uid || o.enabled === false) continue;
      const r = await stream.updateOutput(env, inputUid, o.uid, { enabled: false }).catch(() => null);
      if (r?.ok) { if (!next.paused.includes(o.uid)) next.paused.push(o.uid); work.push('test-output-paused'); }
      else work.push('test-output-pause-failed');
    }
  } else {
    const left = [];
    for (const uid of paused) {
      const r = await stream.updateOutput(env, inputUid, uid, { enabled: true }).catch(() => null);
      // One removed in Settings meanwhile has nothing left to put back
      if (r?.ok || r?.status === 404) work.push('test-output-resumed');
      else left.push(uid);
    }
    next.paused = left;
    // Still paused with a reveal under an hour away: someone has to know (once per reveal)
    const at = plannedAt(state);
    if (left.length && at != null && at - Date.now() < 60 * 60e3 && await claimOnce(env.DB, state.broadcastId, 'test-outputs-stuck')) {
      await notify.alertAdmins(env, config, { level: 'error', title: 'Facebook is still paused after a test', detail: `Test mode paused Stream's Facebook/YouTube outputs and they could not be turned back on. Turn them on in Admin → Broadcast → Settings before ${state.kidName ? `${state.kidName}'s reveal` : 'the reveal'}.`, url: `${SITE_ORIGIN}/admin/#broadcast`, urgent: true });
    }
  }
  await writeQuiet(env.DB, next);
  return next;
}

/**
 * Is a phone sending to the main feed? Stream answers two ways, and they can disagree:
 *  - the public lifecycle says live once the video can play, and can keep saying so long after the phone
 *    has stopped (it waits for the recording to close: 18 minutes on Nov 17), still naming that recording;
 *  - the input's own status (API) says 'connected' or 'disconnected' the moment it happens, and since when.
 * Off air: a phone goes live when the lifecycle says so and the input doesn't say it's gone. A lifecycle
 * still naming a recording that ended (state.endedVideoUid) is only catching up; a phone that connected
 * after that end is a new one, and the phone still on that same connection carries on only as a test
 * (test mode) or as the same reveal coming back (rejoinOpen).
 * On air: the input decides. A disconnect shorter than INPUT_DROP_*_MS is a gap (weak signal): still on
 * air, one reveal, but nothing new is set off during it (the Kit list email's unbroken 3 minutes start
 * again after it; a test doesn't become the reveal). Longer, the phone is gone, from when it stopped.
 * When the API doesn't answer, nothing changes on a guess: on air the phase holds; off air the lifecycle
 * alone may start a new recording, never one that ended. A status the site doesn't know (none, another
 * state, a disconnect with no time) leaves it to the lifecycle, as before.
 * → { phone: 'on' | 'off' | 'hold', gapSince, stoppedAt (ms), sameRecording, input }
 */
export async function sensePhone(env, inputUid, lc, state, quiet, now = Date.now(), { lastInputOkAt = null } = {}) {
  const onAir = (state.phase === 'live' || state.phase === 'ending') && state.source === 'stream';
  const ended = !!lc.videoUID && lc.videoUID === state.endedVideoUid;
  // On air, a lifecycle naming the recording that ended is never this broadcast's (a new phone's recording follows)
  const out = (phone, extra = {}) => ({ phone, gapSince: null, stoppedAt: null, sameRecording: ended && !onAir, input: null, inputOk: false, ...extra });
  if (!onAir && !lc.live) return out('off');
  if (!stream.streamConfigured(env)) return out(lc.live && !(ended && !onAir) ? 'on' : 'off');
  const inp = await stream.getLiveInput(env, inputUid).catch(() => null);
  if (!inp?.ok) {
    if (!onAir) return out(ended ? 'off' : 'on');
    const lastOk = Date.parse(lastInputOkAt || '');
    if (Number.isFinite(lastOk) && now - lastOk < INPUT_HOLD_MS) return out('hold');
    return out(lc.live ? 'on' : 'off');
  }
  const cur = inp.result?.status?.current || null;
  const input = cur?.state || null;
  const since = Date.parse(cur?.statusEnteredAt || '');
  const known = Number.isFinite(since) && since <= now;
  const ok = (phone, extra = {}) => out(phone, { inputOk: true, ...extra });
  if (input === 'disconnected' && known) {
    if (!onAir) return ok('off', { input });
    const wait = state.quiet ? INPUT_DROP_TEST_MS : INPUT_DROP_REVEAL_MS;
    if (now - since >= wait) return ok('off', { input, stoppedAt: since });
    return ok('on', { input, gapSince: since });
  }
  if (input === 'connected') {
    if (!onAir && !lc.live) return ok('off', { input }); // connected, but the video can't play yet: the lifecycle says when
    if (!onAir && ended) {
      // A phone that connected after the end is a new one; the same connection carries on only as a test or the same reveal
      const endedAt = Date.parse(state.endedVideoAt || '');
      if (known && Number.isFinite(endedAt) && since > endedAt) return ok('on', { input, sameRecording: false });
      if (!quietOn(quiet, state, now) && !rejoinOpen(state, now)) return ok('off', { input });
    }
    return ok('on', { input, connectedSince: known ? since : null });
  }
  if (!onAir && ended) return ok('off', { input });
  return ok(lc.live ? 'on' : 'off', { input });
}

// ─── The tick ───────────────────────────────────────────────────────

/**
 * Reconcile with Stream, apply timers, fire side effects, persist, and
 * return the public state. Safe to call from anywhere. One tick runs at a
 * time across every isolate (the D1 lease); unless `force`, a tick also waits
 * `minIntervalMs` after the last one started, here and everywhere else. A
 * caller that finds a tick already running gets the current state with
 * `busy: true`. Public routes never pass `force`.
 */
export async function runTick(env, { source = 'tick', force = false, by = null, minIntervalMs = TICK_MIN_INTERVAL_MS, answer = null } = {}) {
  const { DB } = env;
  await ensureSchema(DB);
  const interval = Math.max(minIntervalMs, TICK_MIN_INTERVAL_MS);
  if (!force && _lastTickResult && Date.now() - _lastTickAt < interval) return { ..._lastTickResult, cached: true };
  if (!force && interval > TICK_MIN_INTERVAL_MS && _lastBusyResult && Date.now() - _lastBusyAt < interval) return { ..._lastBusyResult, cached: true };

  // A forced tick (webhook, the admin's Refresh) waits a moment for a running one rather than skip
  const lease = force ? await waitForTickLease(DB, FORCED_LEASE_WAIT_MS) : await acquireTickLease(DB, { minIntervalMs: interval });
  if (!lease) {
    const [config, state] = await Promise.all([readConfig(DB), readState(DB)]);
    const result = { state: publicState(state, config), reason: source, work: [], changed: false, busy: true };
    // Not the tick cache: a visitor that found the lease busy must not hold up the hub's next heartbeat
    _lastBusyAt = Date.now();
    _lastBusyResult = result;
    return result;
  }
  // A long tick keeps the lease (at most one extend per LEASE_EXTEND_AFTER_MS); false once another tick has it
  let extendedAt = Date.now();
  const keepLease = async () => {
    if (Date.now() - extendedAt < LEASE_EXTEND_AFTER_MS) return true;
    extendedAt = Date.now();
    return extendTickLease(DB, lease);
  };
  let result;
  try {
    result = await tick(env, { source, force, by, keepLease, answer });
    _lastTickAt = Date.now();
    _lastTickResult = result;
  } finally {
    await releaseTickLease(DB, lease);
  }
  // Whoever noticed the change (a visitor's page, the admin, a webhook, a text), every open page hears it at once,
  // not at the hub's next heartbeat (up to a minute away from a reveal: Peter's 2:13 PM test on Nov 18 went live on the
  // site 24 s before the pages heard). The hub's own ticks are published by broadcast-hooks.js
  if (result?.changed && !String(source).startsWith('hub')) {
    await publishToHub(env, await readState(DB), await readConfig(DB), 'tick').catch(() => {});
  }
  return result;
}

// The state as far as "did anything change" goes (rev and updatedAt are bookkeeping)
const stateSig = (s) => JSON.stringify({ ...s, rev: undefined, updatedAt: undefined });

async function tick(env, { source, force, by, keepLease = async () => true, answer = null }) {
  const { DB } = env;
  const now = Date.now();
  const [config, health] = await Promise.all([readConfig(DB), readHealth(DB)]);
  let quiet = await readQuiet(DB);
  const healthBefore = JSON.stringify(health);
  const read = await readState(DB);
  let rev = Number(read.rev) || 0;
  let base = read;          // the stored copy, as far as this tick knows
  let state = read;
  const prevPhase = state.phase;
  const work = [];
  let missed = null;        // a scheduled reveal that never streamed, announced once the clear is saved

  // 1. Is a phone sending to the main feed? Stream is the authority (sensePhone)
  const inputUid = config.liveInput?.uid;
  if (inputUid && (force || now - _lastLifecycleAt >= LIFECYCLE_MIN_INTERVAL_MS)) {
    const lc = await stream.lifecycle(config.customerCode, inputUid);
    _lastLifecycleAt = Date.now();
    if (lc) {
      const sensed = await sensePhone(env, inputUid, lc, state, quiet, now, { lastInputOkAt: health.lifecycle?.inputOkAt });
      health.lifecycle = { at: nowIso(), live: sensed.phone === 'on', lifecycleLive: lc.live, videoUID: lc.videoUID, inputUid, phone: sensed.phone, ...(sensed.input ? { input: sensed.input } : {}),
        inputOkAt: sensed.inputOk ? nowIso() : (health.lifecycle?.inputOkAt || null) };
      // The recording the lifecycle names, unless it is one that ended and this phone is a new connection (it names the new one soon)
      const vid = lc.videoUID && !(lc.videoUID === state.endedVideoUid && !sensed.sameRecording) ? lc.videoUID : null;
      const gap = !!sensed.gapSince;
      if (sensed.phone === 'on') {
        const startOff = (s2) => (sensed.sameRecording && vid ? { ...s2, endedVideoUid: null, endedVideoAt: null } : s2);
        if (rejoinOpen(state, now) && state.source === 'stream' && !state.quiet) {
          // The phone is back within REJOIN_MS: the same reveal goes on
          const wentOut = state.replayOut === true ? { kidSlug: state.kidSlug, kidName: state.kidName, endedAt: state.endedAt } : null;
          state = startOff(tRejoin(state, { videoUid: vid })); work.push('rejoined');
          // ...after the crew's Y already sent its replay out (overSaid): the kid's page has the first part. Staff fix it
          if (wentOut && await claimOnce(DB, state.broadcastId, `rejoin-after-out:${wentOut.endedAt || ''}`)) {
            work.push('rejoined-after-replay');
            await notify.alertAdmins(env, config, { level: 'warn', title: `${wentOut.kidName || 'The'}${wentOut.kidName ? "'s" : ''} reveal picked up again after it was called over`, detail: `The phone is streaming again after the crew answered Y. The replay email, "Ended" and ${wentOut.kidName ? `${wentOut.kidName}'s` : "the kid's"} page already went out with the first part. When it ends, put the full recording on the kid's page: Admin → Kids → ${wentOut.kidName || 'the kid'} → Video → Live reveal replay.`, url: `${SITE_ORIGIN}/admin/`, text: true }).catch(() => {});
          }
        } else if (quietReachedReveal(state, now) && !gap) {
          // A test still streaming when its reveal is 30 minutes off: that phone is the reveal now
          state = tStartLive(tEndQuiet(state), { videoUid: vid, source: 'stream' }, config); work.push('test-became-reveal');
          state = { ...state, endedVideoUid: null, endedVideoAt: null };
        } else if (state.phase === 'live') {
          if (vid && state.liveVideoUid !== vid) state = { ...state, liveVideoUid: vid, recordings: withRecording(state.recordings, vid) };
        } else if (state.phase === 'ending') {
          state = tReconnected(state); work.push('reconnected');
        } else if (state.source !== 'manual') {
          if (quietOn(quiet, state, now)) { state = startOff(tStartQuiet(state, { videoUid: vid }, config)); work.push('test-start'); }
          else { state = startOff(tStartLive(state, { videoUid: vid, source: 'stream' }, config)); work.push('auto-start'); }
        }
        // A gap (a short drop) breaks the unbroken stretch the Kit list email waits for; it starts again when the phone is back
        if (state.phase === 'live' && state.source === 'stream') {
          if (gap) { if (!state.gapSince) state = { ...state, gapSince: new Date(sensed.gapSince).toISOString() }; }
          else if (state.gapSince) state = { ...state, gapSince: null, holdUntil: null, segmentAt: new Date(sensed.connectedSince && sensed.connectedSince > Date.parse(state.gapSince) ? sensed.connectedSince : now).toISOString() };
          // The phone is back: a hold (the crew's N) is over
          else if (state.holdUntil) state = { ...state, holdUntil: null };
        }
        // A reveal on air ends the switch: once it is over, a phone reconnecting is never taken for a test
        if (['live', 'ending'].includes(state.phase) && !state.quiet && quiet.until) {
          quiet = { ...quiet, until: null };
          await writeQuiet(DB, quiet);
        }
      } else if (sensed.phone === 'off' && state.source === 'stream') {
        if (state.phase === 'live' && holding(state, now)) {
          // The crew texted N (the signal dropped): still on air, Reconnecting, until the phone is back or the hold runs out
          if (!state.gapSince) state = { ...state, gapSince: new Date(sensed.stoppedAt || now).toISOString() };
        } else if (state.phase === 'live') {
          state = { ...tDisconnected(state), gapSince: null }; work.push('disconnected');
          // Known from the input's status: the grace runs from the real stop, so the end isn't later for the wait
          if (sensed.stoppedAt && sensed.stoppedAt >= Date.parse(state.segmentAt || state.liveAt || 0)) state = { ...state, disconnectedAt: new Date(sensed.stoppedAt).toISOString() };
        } else if (state.phase === 'ending' && now - Date.parse(state.disconnectedAt || 0) >= ENDING_GRACE_MS) {
          // A test puts back what it interrupted; a reveal goes to its replay (open REJOIN_MS to its phone coming back)
          if (state.quiet) { state = tEndQuiet(state); work.push('test-ended'); }
          else if (preShow(state)) { state = tPreShowOver(state); work.push('pre-show-ended'); }
          else { state = tEnd(state, config, { rejoin: true }); work.push('ended'); }
        }
      }
      // 'hold': Stream's API didn't answer while a broadcast is on air: nothing changes on a guess
    }
  }

  // 1b. A staff text answering "Is the reveal over?" (answerByText), on the state just sensed: a phone back since
  //     the question is never ended by a late Y
  //     (a link's answer, `about`, counts only for its own broadcast and stop)
  let told = null;
  if (answer) {
    const key = stopOf(state) ? overAskKey(state) : null;
    const about = answer.about || null;
    if (about && about.broadcastId !== state.broadcastId) told = { state, outcome: 'old-link', broadcastId: state.broadcastId };
    else {
      const asked = key ? (!about || about.key === key) && await claimExists(DB, state.broadcastId, key) : false;
      told = { ...tAnswer(state, answer.answer, config, { by: answer.by, now, asked }), broadcastId: state.broadcastId };
      // A link about an earlier stop of this reveal: that one is over, the new one has (or gets) its own link
      if (about && told.outcome === 'not-asked' && about.key !== key) told.outcome = 'old-link';
    }
    state = told.state;
  }

  // 2. Timers
  if (state.phase === 'scheduled' && state.scheduledAt && Date.parse(state.scheduledAt) - now <= ARM_WINDOW_MS) {
    state = { ...state, phase: 'armed', armedAt: nowIso() }; work.push('armed');
  }
  if ((state.phase === 'scheduled' || state.phase === 'armed') && state.scheduledAt && now - Date.parse(state.scheduledAt) > SCHEDULED_EXPIRE_MS) {
    missed = state;
    state = tClear(state, 'missed'); work.push('missed');
  }
  if (state.phase === 'live' && state.source === 'manual' && state.manual?.until && now >= Date.parse(state.manual.until)) {
    // The banner's reveal is over: its row says so (History, and Facebook's totals for it)
    await closeBroadcastRow(DB, state, 'ended', { endedNow: false });
    state = tClear(state, 'manual-expired'); work.push('manual-expired');
  }
  if (state.phase === 'live' && state.source === 'stream' && state.liveAt && now - Date.parse(state.liveAt) > MAX_LIVE_HOURS * 3600e3) {
    state = state.quiet ? tEndQuiet(state) : tEnd(state, config); work.push('max-hours');
  }
  if (state.phase === 'replay' && state.rejoinUntil && now >= Date.parse(state.rejoinUntil)) {
    // No phone came back: the reveal is over for good, and its final effects run (endedEffects, the replay's)
    state = { ...state, rejoinUntil: null, closedAt: nowIso() }; work.push('closed');
  }
  if (state.testEnd && !testEndShowing(state, now)) {
    // A test's end has been shown long enough (or a broadcast has started): the website is back to what it was
    state = { ...state, testEnd: null }; work.push('test-end-over');
  }
  if (state.phase === 'replay' && state.replayUntil && now >= Date.parse(state.replayUntil)) {
    state = tClear(state, 'replay-expired'); work.push('replay-expired');
  }

  // 3. A phase change is saved before any of its side effects, and only over
  //    the copy this tick read. A tick that lost the race stops here; the next
  //    one starts from whatever won. The side effects (step 4) are claimed, so
  //    each happens once, on this tick or, if this one is cut off, a later one.
  // (A test starting, ending or turning into the reveal changes the broadcast too, sometimes not the phase;
  // a staff text's answer is saved here too, before the reply says it happened)
  if (state.phase !== prevPhase || (state.broadcastId ?? null) !== (read.broadcastId ?? null) || told?.save) {
    state = { ...state, updatedAt: nowIso() };
    if (!(await writeStateIf(DB, state, rev))) {
      work.push('conflict');
      return { state: publicState(await readState(DB), config), reason: 'conflict', work, changed: false, conflict: true };
    }
    rev += 1;
    state = { ...state, rev };
    base = state;
    await upsertBroadcastRow(DB, state);
    if (missed) {
      if (await claimOnce(DB, missed.broadcastId, 'missed')) {
        await notify.alertAdmins(env, config, { level: 'warn', icon: '⏰', title: 'Scheduled reveal never went live', detail: `${missed.title || 'Reveal'} was scheduled for ${notify.formatWhen(missed.scheduledAt, config.timezone)} and no stream arrived. The countdown has been cleared.`, url: `${SITE_ORIGIN}/admin/`, text: true });
        await recordEvent(DB, missed.broadcastId, 'missed');
      }
      await closeBroadcastRow(DB, missed, 'missed');
    }
    if (state.phase === 'ending') await recordEvent(DB, state.broadcastId, 'disconnected');
  }
  // The answer is saved: the text's reply can go now, while the rest of the tick carries on
  if (told) answer.decided?.({ outcome: told.outcome, state, config, broadcastId: told.broadcastId });

  // 4. What going live or ending sets off, until each part has happened (also on later ticks), then
  //    ongoing work. Each step first keeps the lease; if another tick has taken it, this one stops
  //    and saves what it has (over the copy it read, as always)
  const live = () => state.phase === 'live' || state.phase === 'ending';
  const steps = [
    // The phone stopped: "Is the reveal over?" to the staff numbers, first, so it goes the moment it is seen
    async () => { state = await askIfOver(env, config, state, work).catch((e) => { work.push(`ask-error: ${e.message}`); return state; }); },
    // Test mode: Facebook and YouTube paused while it is on or a test streams, put back after
    // (at once when a test has just started, ended or become the reveal)
    async () => { quiet = await syncQuietOutputs(env, config, quiet, state, work, { force: !!read.quiet !== !!state.quiet }).catch((e) => { work.push(`test-outputs-error: ${e.message}`); return quiet; }); },
    // Test mode about to turn itself off, or just did: staff hear it
    async () => { quiet = await warnQuietEnding(env, config, quiet, state, work).catch((e) => { work.push(`test-warn-error: ${e.message}`); return quiet; }); },
    // A framing check's Facebook post is released before a go-live opens the reveal's own
    async () => { state = await preShowEffects(env, config, state, work, health); },
    // A Facebook post opened by a tick whose save didn't land (it lost the lease, or was cut off): read it back from
    // its claim, so the site knows which post to close at the end
    async () => {
      if (live() && !state.quiet && config.facebook?.mode === 'api' && !state.fb?.liveVideoId && !state.fbReopen) {
        const made = await freshResult(env.DB, state.broadcastId, 'fb-live-post', state.fbSessionAt);
        if (made?.liveVideoId) { state = { ...state, fb: { ...(state.fb || {}), liveVideoId: made.liveVideoId, outputUid: made.outputUid || null } }; work.push('fb-read-back'); }
      }
    },
    async () => { state = await goLiveEffects(env, config, state, work, by); },
    async () => { state = await endedEffects(env, config, state, health, work, by); },
    async () => { if (live() && !state.quiet) state = await fbRefreshPermalink(env, state, work); },
    // Feed watch, go/no-go and mic checks only report; nothing they do may stop the state machine (a test pings nobody)
    // While the phone is away and staff are asked "Is the reveal over?", the drop's own alert isn't texted too
    async () => {
      if (!live() || state.source !== 'stream' || state.quiet) return;
      const overQuestion = stopOf(state) ? await overQuestionFor(env, config, state).catch(() => false) : false;
      await monitor.watch(env, config, state, health, work, recordEvent, { overQuestion }).catch((e) => work.push(`monitor-error: ${e.message}`));
    },
    // Every 30 s: how many watch at once on the site, Facebook and YouTube, and the hearts so far (History's reveal stats)
    async () => { if (live() && state.source === 'stream' && !state.quiet) await revealStats.sampleLive(env, state, health, { hubStatus: () => hubStatus(env) }).catch((e) => work.push(`stats-error: ${e.message}`)); },
    async () => { if (state.phase === 'scheduled' || state.phase === 'armed') await preflight.auto(env, config, state, health, work, { hubStatus }).catch((e) => work.push(`preflight-error: ${e.message}`)); },
    async () => { if (!live() && await monitor.watchRehearsal(env, config, health).catch(() => false)) work.push('mic-check'); },
    async () => { state = await kitAutoLive(env, config, state, work); },
    async () => { for (const kind of await dueReminderKinds(DB, state, config, { kit: kitConfigured(env) })) await sendReminders(env, config, state, kind, work); },
    async () => { state = await checkReplayReady(env, config, state, health, work); },
    // A test's end on the website: its recording as the replay once Stream has it
    async () => { state = await findTestReplay(env, state, work).catch((e) => { work.push(`test-replay-error: ${e.message}`); return state; }); },
    async () => { state = await tickReel(env, config, state, work); },
    async () => { await runHealth(env, config, state, health, work); },
  ];
  for (const step of steps) {
    if (!(await keepLease())) { work.push('lease-lost'); break; }
    await step();
  }

  // 5. Persist, over the copy this tick knows; anything an admin saved meanwhile is merged, theirs winning
  if (stateSig(state) !== stateSig(base)) {
    const saved = await commitState(DB, base, { ...state, updatedAt: nowIso() }, rev);
    if (saved.dropped) work.push('conflict');
    else await upsertBroadcastRow(DB, saved.state);
    state = saved.state;
  }
  health.lastTick = { at: nowIso(), source, work };
  // Only touch D1 when something meaningful changed (lastTick alone isn't worth a write every few seconds)
  const healthAfter = JSON.stringify({ ...health, lastTick: null });
  if (healthAfter !== JSON.stringify({ ...JSON.parse(healthBefore), lastTick: null }) || work.length) await writeHealth(DB, health);

  return { state: publicState(state, config), reason: work.length ? work.join(',') : source, work, changed: stateSig(state) !== stateSig(read) };
}

/**
 * An admin moving on (clearing the replay, resetting, a new reveal scheduled, picking the replay by hand)
 * from a reveal that could still pick up again: it is over now, and its final effects run first
 * (Facebook's post closed, the "Ended" announcement), as they would have when the window closed.
 */
async function closeNow(env, config, state, by) {
  if (!rejoinOpen(state)) return state;
  const health = await readHealth(env.DB);
  let s = await endedEffects(env, config, { ...state, rejoinUntil: null, closedAt: nowIso() }, health, [], by);
  // Its replay goes out too, if the recording is ready (the kid's page, the replay email): the state may move on next
  if (s.replayUid && s.replayOut === false) s = await replayOutward(env, config, s, health, []);
  return s;
}

// ─── "Is the reveal over?" answered by text ─────────────────────────

/** What staff hear in Slack and email (never by text) when a text changed the broadcast; a test stays quiet */
function answerNote(outcome, state, who, tz, via = 'text') {
  const until = state.holdUntil ? notify.clockTime(state.holdUntil, tz) : null;
  const how = via === 'link' ? `the link texted to ${who}` : `a text from ${who}`;
  if (outcome === 'ended') return { icon: '🎬', title: `Reveal ended by ${how}`, detail: `${who} answered Y to "Is the reveal over?", so the site ended it at once. A phone streaming again in the next 15 minutes still picks the same reveal back up.` };
  if (outcome === 'pre-show') return { icon: '🎬', title: `Framing check ended by ${how}`, detail: 'It stopped before the start time, so the countdown is back up for the reveal.' };
  if (outcome === 'held') return { icon: '📶', title: `Reveal kept on air by ${how}`, detail: `${who} answered N: the signal dropped. Viewers see Reconnecting until the phone is back${until ? `, up to ${until}` : ''}. A Y ends it sooner.` };
  return null;
}

// Twilio waits 15 s for the reply: it goes within TEXT_REPLY_WITHIN_MS whatever the site is doing (the rest
// carries on after it), and no new try starts past TEXT_TRY_UNTIL_MS, so the work after the reply stays well
// inside the 30 s a Worker keeps going for it
const TEXT_REPLY_WITHIN_MS = 10 * 1000;
const TEXT_TRIES = 3;
const TEXT_TRY_UNTIL_MS = 20 * 1000;

/**
 * A staff text answering "Is the reveal over?" (functions/api/twilio-inbound.js; `answer` 'yes' or 'no', `who`
 * "…1234"). A forced tick senses the phone, takes the answer (tAnswer) and saves it the way it saves a phase change:
 * before any side effect, only over the copy it read. That tick then runs what an automatic end runs (Facebook's post
 * closed, the row, a test's outputs back on, the "Ended" note once the 15 minutes are up), carried on in `waitUntil`
 * while the reply goes. A tick that lost the race to save (or failed) tries again, up to TEXT_TRIES.
 * → { outcome, state, config }: 'slow' when nothing was settled within `replyWithinMs` (then `onLate` hears how it
 * came out, even 'busy', so a "Got it" never hides a lost answer), 'busy' when every try failed.
 */
export async function answerByText(env, { answer, who, via = 'text', about = null, waitUntil = () => {}, replyWithinMs = TEXT_REPLY_WITHIN_MS, onLate = null }) {
  const { DB } = env;
  const started = Date.now();
  // A reply to the text, or a tap on its link (functions/over/[token].js: `about` is the broadcast and stop it names)
  const by = `${via === 'link' ? 'link' : 'text'} from ${who}`;
  const work = (async () => {
    await ensureSchema(DB);
    for (let i = 0; i < TEXT_TRIES; i++) {
      if (i && Date.now() - started > TEXT_TRY_UNTIL_MS) break;
      let decide;
      const decided = new Promise((r) => { decide = r; });
      const ticking = runTick(env, { source: 'text', force: true, by, answer: { answer, by, about, decided: decide } })
        .then(async (r) => {
          if (r?.changed) await publishToHub(env, await readState(DB), await readConfig(DB), 'tick:text');
          return r;
        })
        .catch(() => null);
      waitUntil(ticking);
      // Settled once the answer is saved; a tick that ended without taking it lost the race (or failed): again
      const taken = await Promise.race([decided, ticking.then(() => null)]);
      if (taken) return taken;
    }
    return null;
  })().catch(() => null);
  // Whichever comes first, the answer or the reply's deadline, decides what the reply says (one flag, set once)
  let late = false;
  const first = new Promise((resolve) => {
    const timer = setTimeout(() => { late = true; resolve('slow'); }, replyWithinMs);
    work.then((t) => { if (!late) { clearTimeout(timer); resolve(t); } });
  });
  // Then: the log, the open pages, the staff note; and after a "Got it", how it really came out
  waitUntil(work.then(async (t) => {
    if (t) await answered(env, t, { answer, who, by, via }).catch(() => {});
    if (late && onLate) await onLate(t ? { outcome: t.outcome, state: t.state, config: t.config } : { outcome: 'busy' });
  }).catch(() => {}));
  const t = await first;
  if (t === 'slow') return { outcome: 'slow' };
  _lastTickResult = null;
  _lastBusyResult = null;
  return t ? { outcome: t.outcome, state: t.state, config: t.config } : { outcome: 'busy' };
}

/** After an answer is saved: its event (with the broadcast that was asked: a test's own, not the reveal it hands back to), the hub, the audit log, the note */
async function answered(env, { outcome, state, config, broadcastId: id }, { answer, who, by, via = 'text' }) {
  const { DB } = env;
  await recordEvent(DB, id, 'over_answer', { answer, outcome, from: who, ...(via === 'link' ? { via } : {}) });
  if (['ended', 'test-ended', 'pre-show', 'held', 'test-held'].includes(outcome)) {
    await publishToHub(env, state, config, 'tick:text');
    await logAudit(DB, { userEmail: by, action: 'updated', entityType: 'live-status', entitySlug: id || 'broadcast', entityName: outcome.endsWith('held') ? 'Kept on air by a text (N)' : 'Ended by a text (Y)', gitStatus: 'ok' });
  }
  const note = answerNote(outcome, state, who, config.timezone, via);
  if (note) await notify.alertAdmins(env, config, { level: 'info', kind: 'news', ...note, url: `${SITE_ORIGIN}/admin/#broadcast` });
}

/**
 * What a tap-to-answer link (functions/over/[token].js) would do right now, read only: a GET never changes anything,
 * since phones and chat apps open links by themselves to preview them. `about` is the link's broadcast and stop.
 * → { outcome (as tAnswer would give a Y, or 'old-link'), state, config, question (the stop's line, when it can act) }
 */
export async function overLinkView(env, about) {
  await ensureSchema(env.DB);
  const [config, state] = await Promise.all([readConfig(env.DB), readState(env.DB)]);
  if (about.broadcastId !== state.broadcastId) return { outcome: 'old-link', state, config, question: null };
  const key = stopOf(state) ? overAskKey(state) : null;
  const asked = key ? about.key === key && await claimExists(env.DB, state.broadcastId, key) : false;
  let { outcome } = tAnswer(state, 'yes', config, { asked });
  if (outcome === 'not-asked' && about.key !== key) outcome = 'old-link';
  const open = ['ended', 'test-ended', 'pre-show'].includes(outcome);
  return { outcome, state, config, question: open ? notify.overStopLine({ kidName: state.kidName, at: stopOf(state), tz: config.timezone }) : null, test: !!(state.quiet || state.test) };
}

// ─── Admin commands ─────────────────────────────────────────────────

function isoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function sanitizeImage(val) {
  if (val === undefined || val === null || val === '') return null;
  const img = String(val).trim();
  if (img.length > 300) return undefined;
  if (/^https:\/\/imagedelivery\.net\/[\w\-./%]+$/.test(img)) return img;
  if (/^[\w][\w\-./%]*$/.test(img)) return img;
  return undefined;
}

const JOB_ID = /^[A-Za-z0-9]{6,32}$/;

/** 'YYYY-MM-DD' of an instant in the broadcast's time zone */
function dayIn(iso, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export async function kidByName(DB, slug) {
  if (!slug) return null;
  const row = await DB.prepare('SELECT slug, name, data FROM kids WHERE slug = ?').bind(slug).first();
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data); } catch {}
  return { slug: row.slug, name: row.name || data.name || slug, image: data.heroImage || data.photos?.[0]?.url || null };
}

/**
 * Admin state commands. Returns { success, state, error }. Publishes to the
 * hub on success so open pages update immediately. A command holds the tick
 * lease (waiting a few seconds for a running tick), so a tick never saves a
 * stale copy over what staff just asked for.
 */
export async function adminAction(env, action, body = {}, userEmail = 'unknown') {
  await ensureSchema(env.DB);
  const lease = await waitForTickLease(env.DB, ADMIN_LEASE_WAIT_MS);
  try {
    return await runAdminAction(env, action, body, userEmail);
  } finally {
    await releaseTickLease(env.DB, lease);
  }
}

async function runAdminAction(env, action, body, userEmail) {
  const { DB } = env;
  const config = await readConfig(DB);
  let state = await readState(DB);
  const fail = (error, status = 400) => ({ success: false, error, status });

  switch (action) {
    case 'schedule': {
      const scheduledAt = isoOrNull(body.scheduledAt);
      if (!scheduledAt) return fail('scheduledAt is not a valid date');
      if (['live', 'ending'].includes(state.phase)) return fail('A broadcast is live right now; end it before scheduling another');
      state = await closeNow(env, config, state, userEmail);
      const kid = await kidByName(DB, body.kidSlug);
      const image = sanitizeImage(body.image ?? kid?.image ?? null);
      if (image === undefined) return fail('image must be a Cloudflare image id or imagedelivery.net URL');
      // Scheduling over a planned reveal replaces it; close the old row so History doesn't show both
      if (['scheduled', 'armed'].includes(state.phase)) await closeBroadcastRow(DB, state, 'cancelled');
      const jobId = JOB_ID.test(String(body.jobId || '')) ? String(body.jobId) : null;
      state = tSchedule(state, { kidSlug: kid?.slug || null, kidName: kid?.name || null, jobId, test: body.test === true, scheduledAt, title: body.title, message: body.message, image, kitLiveEmail: body.kitLiveEmail, by: userEmail }, config);
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      const work = [];
      // A save-the-date only makes sense with some lead time; inside 26 h the day-before reminder covers it
      if (Date.parse(scheduledAt) - Date.now() > 26 * 3600e3) await sendReminders(env, config, state, 'scheduled', work);
      await recordEvent(DB, state.broadcastId, 'scheduled', { scheduledAt, kidSlug: state.kidSlug });
      await logAudit(DB, { userEmail, action: 'created', entityType: 'live-status', entitySlug: state.broadcastId, entityName: state.title, changes: [{ field: 'scheduledAt', from: null, to: scheduledAt }], gitStatus: 'ok' });
      break;
    }
    case 'update': {
      if (state.phase === 'idle') return fail('Nothing is scheduled or live');
      const s = { ...state };
      if (body.title !== undefined) s.title = String(body.title).trim().slice(0, 140) || s.title;
      if (body.message !== undefined) s.message = String(body.message).trim().slice(0, 200) || s.message;
      if (body.image !== undefined) { const img = sanitizeImage(body.image); if (img === undefined) return fail('bad image'); s.image = img; }
      if (JOB_ID.test(String(body.jobId || ''))) s.jobId = String(body.jobId);
      let movedFrom = null;
      if (body.scheduledAt !== undefined && ['scheduled', 'armed'].includes(s.phase)) {
        const at = isoOrNull(body.scheduledAt); if (!at) return fail('scheduledAt is not a valid date');
        // A new day re-arms the reminders; a new time on the same day keeps what already went out
        if (s.scheduledAt && dayIn(s.scheduledAt, config.timezone) !== dayIn(at, config.timezone)) movedFrom = s.scheduledAt;
        s.scheduledAt = at; s.phase = Date.parse(at) - Date.now() <= ARM_WINDOW_MS ? 'armed' : 'scheduled';
        if (s.phase === 'armed' && !s.armedAt) s.armedAt = nowIso();
      }
      if (body.kidSlug !== undefined && ['scheduled', 'armed'].includes(s.phase)) {
        const kid = await kidByName(DB, body.kidSlug); s.kidSlug = kid?.slug || null; s.kidName = kid?.name || null;
        if (!body.image && kid?.image) s.image = kid.image;
        s.kidVia = kid ? 'admin' : null;
      } else if (body.kidSlug && ['live', 'ending'].includes(s.phase)) {
        // Unscheduled reveal: naming the kid releases the waiting Kit email
        const kid = await kidByName(DB, body.kidSlug);
        if (!kid) return fail('No such kid');
        Object.assign(s, applyKid(s, kid, 'admin', null));
      }
      if (typeof body.kitLiveEmail === 'boolean') s.kitLiveEmail = body.kitLiveEmail;
      if (body.revealAtMinute !== undefined) { const m = body.revealAtMinute === '' || body.revealAtMinute === null ? null : Number(body.revealAtMinute); if (m !== null && !(m >= 0 && m < 600)) return fail('revealAtMinute must be a number of minutes'); s.revealAtSeconds = m === null ? null : Math.round(m * 60); }
      if (body.url !== undefined && s.source === 'manual') s.manual = { ...(s.manual || {}), url: String(body.url) };
      s.updatedBy = userEmail;
      state = s;
      if (s.kidVia === 'admin' && s.phase === 'live') state = await kitAutoLive(env, config, state, []);
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      if (movedFrom) {
        // Moved to another day: the day-before and hour-before reminders go out again for the new date,
        // and people who could have seen the old date hear about the new one (Kit's whole-list invite follows JobTread by itself)
        await DB.prepare("DELETE FROM broadcast_sends WHERE broadcast_id = ? AND (kind IN ('moved', 'day', 'hour') OR (kind = 'scheduled' AND channel = 'kit-signups' AND error IS NOT NULL))").bind(state.broadcastId).run();
        await recordEvent(DB, state.broadcastId, 'moved', { from: movedFrom, to: state.scheduledAt });
        if (Date.parse(state.scheduledAt) - Date.now() > 26 * 3600e3) await sendReminders(env, config, state, 'moved', []);
      }
      await logAudit(DB, { userEmail, action: 'updated', entityType: 'live-status', entitySlug: state.broadcastId, entityName: state.title, ...(movedFrom ? { changes: [{ field: 'scheduledAt', from: movedFrom, to: state.scheduledAt }] } : {}), gitStatus: 'ok' });
      break;
    }
    case 'cancel': {
      if (!['scheduled', 'armed'].includes(state.phase)) return fail('Nothing scheduled to cancel');
      await recordEvent(DB, state.broadcastId, 'cancelled');
      await logAudit(DB, { userEmail, action: 'deleted', entityType: 'live-status', entitySlug: state.broadcastId, entityName: `Cancelled: ${state.title}`, gitStatus: 'ok' });
      await closeBroadcastRow(DB, state, 'cancelled');
      state = tClear(state, 'cancelled', userEmail);
      await writeState(DB, state);
      break;
    }
    case 'goLiveManual': {
      // Banner-only fallback: no Stream input involved (e.g. streaming from the Facebook app in a pinch)
      if (['live', 'ending'].includes(state.phase) && state.source === 'stream') return fail('A Stream broadcast is live');
      const hours = Math.min(12, Math.max(0.5, Number(body.durationHours) || 6));
      const url = body.url ? String(body.url) : (config.facebook?.pageUrl || SITE_ORIGIN);
      if (!/^https:\/\//.test(url)) return fail('url must be https');
      const image = sanitizeImage(body.image); if (image === undefined) return fail('bad image');
      const kid = await kidByName(DB, body.kidSlug);
      // A reveal that ended minutes ago is wrapped up first (Ended, its replay), as every other move-on does
      state = await closeNow(env, config, state, userEmail);
      state = tStartLive(state, { source: 'manual', by: userEmail }, config);
      state.kidSlug = kid?.slug || state.kidSlug; state.kidName = kid?.name || state.kidName;
      if (body.message) state.message = String(body.message).slice(0, 200);
      if (body.title) state.title = String(body.title).slice(0, 140);
      if (image) state.image = image;
      state.manual = { url, until: new Date(Date.now() + hours * 3600e3).toISOString() };
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      await recordEvent(DB, state.broadcastId, 'live_start', { source: 'manual' });
      state = await kitAutoLive(env, config, state, []);
      await logAudit(DB, { userEmail, action: 'published', entityType: 'live-status', entitySlug: state.broadcastId, entityName: `Manual banner: ${state.message}`, gitStatus: 'ok' });
      break;
    }
    case 'sendKitLive': {
      // By hand: an unplanned go-live, an early start the automatic send held back, or a retry
      if (!['live', 'ending'].includes(state.phase)) return fail('Only while live');
      if (state.quiet) return fail('This is a test on the main feed: nobody is emailed');
      if (!kitConfigured(env)) return fail('Kit is not connected (KIT_API_KEY)');
      const work = [];
      // The sign-ups' own "we're live" first (held with the list's on an early start; once only, like every reminder)
      if (state.source === 'stream') await sendReminders(env, config, state, 'live', work).catch((e) => work.push(`live-reminder-error: ${e.message}`));
      state = await sendKitLive(env, config, state, work, { by: userEmail });
      if (!work.includes('kit-live')) return fail(state.kit?.live?.error || 'Already emailed for this broadcast');
      await writeState(DB, state);
      break;
    }
    case 'endNow': {
      if (!['live', 'ending'].includes(state.phase)) return fail('Nothing is live');
      const work = [];
      if (state.quiet) {
        // Ending a test by hand puts back what it interrupted. The switch stays on 10 more minutes, so a
        // phone still connected starts another test, never the reveal (inside the reveal's own window it is the reveal)
        const q = await readQuiet(DB);
        const keep = Date.now() + 10 * 60e3;
        if (!(Date.parse(q.until || '') > keep)) {
          await writeQuiet(DB, { ...q, until: new Date(keep).toISOString() });
          // (staff just ended it: no "Test mode ends in 10 minutes" for this tail; "Test mode is off" still comes)
          const tail = quietUntil({ ...q, until: new Date(keep).toISOString() }, state);
          if (tail != null) await claimOnce(DB, QUIET_CLAIMS, `quiet-warn:${new Date(tail).toISOString()}`);
        }
        await recordEvent(DB, state.broadcastId, 'test_end', { by: userEmail });
        state = tEndQuiet(state, userEmail);
        await logAudit(DB, { userEmail, action: 'updated', entityType: 'live-status', entitySlug: 'test-mode', entityName: 'Test on the main feed ended by admin', gitStatus: 'ok' });
        break;
      }
      if (state.source === 'manual') { await closeBroadcastRow(DB, state, 'ended'); state = tClear(state, 'ended-manually', userEmail); }
      else {
        // This command ends Facebook's video and records the end itself, so the tick's ended effects skip both
        await claimOnce(DB, state.broadcastId, 'fb-ended');
        await claimOnce(DB, state.broadcastId, 'ended-announce');
        state = tEnd(state, config, { by: userEmail }); state = await fbOnEnd(env, config, state, work);
      }
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      await recordEvent(DB, state.broadcastId, 'live_end', { by: userEmail });
      await logAudit(DB, { userEmail, action: 'updated', entityType: 'live-status', entitySlug: state.broadcastId, entityName: 'Ended by admin', gitStatus: 'ok' });
      break;
    }
    case 'clearReplay': {
      if (state.phase !== 'replay') return fail('No replay showing');
      state = await closeNow(env, config, state, userEmail);
      state = tClear(state, 'replay-cleared', userEmail);
      await writeState(DB, state);
      break;
    }
    case 'extendReplay': {
      if (state.phase !== 'replay') return fail('No replay showing');
      const hours = Math.min(24 * 30, Math.max(1, Number(body.hours) || 72));
      state = { ...state, replayUntil: new Date(Date.now() + hours * 3600e3).toISOString(), updatedBy: userEmail };
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      break;
    }
    case 'setReplay': {
      const uid = String(body.uid || '').trim();
      if (!/^[a-f0-9]{32}$/i.test(uid)) return fail('uid must be a Stream video id');
      if (state.phase !== 'replay') return fail('Only while a replay is showing');
      state = await closeNow(env, config, state, userEmail);
      // When that recording began, so the reveal stats line its moment up with the live minutes
      const picked = stream.streamConfigured(env) ? await Promise.race([stream.getVideo(env, uid).catch(() => null), new Promise((r) => setTimeout(() => r(null), 5000))]) : null;
      const began = Date.parse(picked?.result?.created || '');
      state = { ...state, replayUid: uid, replayReadyAt: nowIso(), replayStartedAt: Number.isFinite(began) ? new Date(began).toISOString() : null, updatedBy: userEmail };
      if (reels.reelEnabled(config) && (!state.reel || state.reel.stage !== 'done')) state.reel = reels.startReel(state, uid, state.revealAtSeconds);
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      break;
    }
    case 'reelRetry': {
      const uid = state.replayUid;
      if (!uid) return fail('No replay recording yet');
      const m = body.revealAtMinute === undefined || body.revealAtMinute === '' || body.revealAtMinute === null ? null : Number(body.revealAtMinute);
      if (m !== null && !(m >= 0 && m < 600)) return fail('revealAtMinute must be a number of minutes');
      const seconds = m === null ? state.revealAtSeconds : Math.round(m * 60);
      // A start and end chosen in the admin ("7:24" or seconds), with an optional cover time and caption for this Reel
      const hasCut = ['start', 'end'].some(k => body[k] !== undefined && body[k] !== null && body[k] !== '');
      let cut = null;
      if (hasCut) {
        const start = reels.parseClock(body.start), end = reels.parseClock(body.end);
        const cover = body.cover === undefined || body.cover === null || body.cover === '' ? null : reels.parseClock(body.cover);
        if (start === null || end === null) return fail('Give the start and the end as minutes:seconds, like 7:24');
        if (end - start < 3) return fail('The end must be at least 3 seconds after the start');
        if (end - start > reels.INSTANT_CLIP_MAX_SECONDS) return fail('A cut can be at most 60 seconds: that is the most Stream cuts from a live recording');
        if (cover !== null && (cover < start || cover >= end)) return fail('The cover time must be between the start and the end');
        cut = { start, end, coverSeconds: cover };
      }
      if (body.caption !== undefined && body.caption !== null && typeof body.caption !== 'string') return fail('caption must be text');
      const caption = typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim().slice(0, 2200) : null;
      state = { ...state, revealAtSeconds: seconds ?? null, reel: reels.startReel(state, uid, seconds ?? null, cut || caption ? { ...(cut || {}), caption } : null), updatedBy: userEmail };
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      await logAudit(DB, { userEmail, action: 'updated', entityType: 'instagram-reel', entitySlug: state.broadcastId,
        entityName: cut ? `Reel cut ${clock(cut.start)} to ${clock(cut.end)}` : m !== null ? `Reel re-cut at minute ${m}` : 'Reel retried',
        changes: caption ? [{ field: 'caption', from: null, to: caption.slice(0, 200) }] : undefined, gitStatus: 'ok' });
      break;
    }
    case 'reelFacebook': {
      // The Reel's cut on the Facebook Page too (again after a failure, or with the setting off)
      if (!state.reel?.mp4Url) return fail('The Reel has no video yet: post it on Instagram first');
      if (state.reel.facebook?.stage === 'done') return fail('This Reel is already on Facebook');
      state = { ...state, reel: { ...state.reel, facebook: null, facebookAsked: true, checkedAt: null, updatedAt: nowIso() }, updatedBy: userEmail };
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      await logAudit(DB, { userEmail, action: 'updated', entityType: 'facebook-reel', entitySlug: state.broadcastId, entityName: 'Facebook Reel asked for', gitStatus: 'ok' });
      break;
    }
    case 'reelSkip': {
      if (!state.reel) return fail('No Reel in progress');
      state = { ...state, reel: { ...state.reel, stage: 'skipped', updatedAt: nowIso() }, updatedBy: userEmail };
      await writeState(DB, state); await upsertBroadcastRow(DB, state);
      break;
    }
    case 'quietTest': {
      // Test mode: a phone on the main feed shows on the website and nothing else happens (see tStartQuiet)
      const on = body.on === true;
      let q = await readQuiet(DB);
      const work = [];
      if (on) {
        if (['live', 'ending'].includes(state.phase) && !state.quiet) return fail('A reveal is live right now. Test mode can wait until it ends.');
        if (rejoinOpen(state)) {
          // A reveal that just ended could still pick up again on the next phone: testing means it is over
          state = { ...(await closeNow(env, config, state, userEmail)), updatedAt: nowIso() };
          await writeState(DB, state);
        }
        const at = plannedAt(state);
        const end = Math.min(Date.now() + QUIET_HOURS * 3600e3, at != null ? at - ARM_WINDOW_MS : Infinity);
        if (end - Date.now() < 5 * 60e3) return fail(`${state.kidName ? `${state.kidName}'s reveal` : 'The reveal'} is less than 35 minutes away, so a phone on the main feed now is the reveal. Test on the rehearsal feed instead.`);
        q = { ...q, until: new Date(end).toISOString(), by: userEmail, at: nowIso() };
        await writeQuiet(DB, q);
        q = await syncQuietOutputs(env, config, q, state, work, { force: true });
        if (work.includes('test-output-pause-failed') || work.includes('test-outputs-unread')) {
          // Facebook would get the test: the switch doesn't stay on
          q = { ...q, until: null };
          await writeQuiet(DB, q);
          await syncQuietOutputs(env, config, q, state, [], { force: true });
          return fail('Stream did not pause the Facebook output, so test mode stayed off. Try again in a minute.');
        }
      } else {
        q = { ...q, until: null, by: userEmail, at: nowIso() };
        await writeQuiet(DB, q);
        // Facebook and YouTube come back now, or when a test still streaming stops
        q = await syncQuietOutputs(env, config, q, state, work, { force: true });
      }
      await logAudit(DB, { userEmail, action: 'updated', entityType: 'live-status', entitySlug: 'test-mode', entityName: on ? `Test mode on until ${notify.formatWhen(q.until, config.timezone)}` : 'Test mode off', gitStatus: 'ok' });
      // The switch changes no broadcast: nothing is saved over the state (a tick may have moved it while Stream answered)
      return { success: true, state: publicState(state, config, { includeTest: true }), legacy: legacyState(state, config, { includeTest: true }), quiet: quietStatus(q, state) };
    }
    case 'reset': {
      state = await closeNow(env, config, state, userEmail);
      // A reset mid-reveal still ends that reveal's row (cancelled if it never went live)
      if (state.broadcastId) await closeBroadcastRow(DB, state, state.liveAt ? 'ended' : 'cancelled');
      state = tClear(state, 'reset', userEmail);
      await writeState(DB, state);
      await logAudit(DB, { userEmail, action: 'deleted', entityType: 'live-status', entitySlug: 'broadcast', entityName: 'Broadcast state reset', gitStatus: 'ok' });
      break;
    }
    default:
      return fail(`Unknown action "${action}"`);
  }

  state.updatedAt = nowIso();
  await writeState(DB, state);
  _lastTickResult = null; // next tick must recompute
  _lastBusyResult = null;
  await publishToHub(env, state, config, `admin:${action}`);
  return { success: true, state: publicState(state, config, { includeTest: true }), legacy: legacyState(state, config, { includeTest: true }), quiet: quietStatus(await readQuiet(DB), state) };
}

// ─── Public read ────────────────────────────────────────────────────

/** Public state plus the bits the live page needs (push key, channel availability). */
/** The reminder options as the live page has them (/api/broadcast's `reminders`; the server's first paint of /live/ too) */
export function publicReminders(config, env) {
  return {
    enabled: !!config.reminders?.enabled,
    hours: Array.isArray(config.reminders?.hoursBefore) ? config.reminders.hoursBefore : [24, 1],
    email: notify.emailConfigured(env),
    push: !!config.reminders?.push && !!config.vapid?.publicKey,
    pushKey: config.reminders?.push ? (config.vapid?.publicKey || null) : null,
  };
}

export async function publicPayload(env) {
  const { DB } = env;
  await ensureSchema(DB);
  const [config, state] = await Promise.all([readConfig(DB), readState(DB)]);
  return {
    state: publicState(state, config),
    reminders: publicReminders(config, env),
    messages: { enabled: config.messages?.enabled !== false },
    timezone: config.timezone,
    hub: !!env.LIVE_HUB,
  };
}
