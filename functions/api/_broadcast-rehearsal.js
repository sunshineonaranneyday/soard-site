/**
 * A rehearsal of the live page, for staff only
 * ============================================
 * Peter, Nov 17 2026: "i need a way to do real live testing right!?" The rehearsal feed (Larix's SOARD Rehearsal
 * profile, config.rehearsalInput) only ever showed in the admin's mic check; going live listens to the real input,
 * which also goes out on Facebook and YouTube. A rehearsal is the real live page driven by the rehearsal feed and seen
 * only by signed-in staff: /live/<kid>/?rehearsal (the admin opens it through /admin/rehearsal, which signs them in).
 *
 * One record (site_config 'broadcast-rehearsal'), shaped like the broadcast itself, moved by the same transitions as
 * the reveal (tStartLive, tDisconnected, tReconnected, tEnd, with the same 30-minute arming and 45-second grace) from
 * Stream's public lifecycle of the rehearsal input, and the recording found the same way checkReplayReady finds it.
 * Nothing else: no Facebook, Kit, emails, texts, push, Slack, stats rows, hub (the hub carries the real reveal to
 * every open page). Pages ask for it every few seconds instead (live-client.ts), and its messages are its own
 * (_live-messages.js, under the rehearsal's id, never relayed).
 */

import {
  ARM_WINDOW_MS, ENDING_GRACE_MS, defaultState, ensureSchema, kidByName, publicReminders, publicState, readConfig,
  readState, sanitizeImage, tDisconnected, tEnd, tReconnected, tStartLive,
} from './_broadcast.js';
import * as stream from './_stream-live.js';

export const REHEARSAL_KEY = 'broadcast-rehearsal';
/** Stream asked at most this often (every staff page asks every few seconds) */
const LIFECYCLE_EVERY_MS = 2500;
/** The recording asked after at most this often once the rehearsal has ended */
const REPLAY_CHECK_EVERY_MS = 10_000;
/** A rehearsal left running is taken down after this long */
const REHEARSAL_MAX_MS = 12 * 3600e3;
/** "Starts in" choices, in minutes: 0 is straight to "Starting soon" with the time already here */
export const START_IN_MINUTES = [0, 2, 5, 10, 15, 30, 60, 90];

const nowIso = () => new Date(Date.now()).toISOString();
let lastLifecycleAt = 0;
let lastReplayCheckAt = 0;

/** The settings the page reads, with the rehearsal feed as the one that plays (publicState's player) */
export function rehearsalConfig(config) {
  return { ...config, liveInput: config?.rehearsalInput || null };
}

export async function readRehearsal(DB) {
  const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(REHEARSAL_KEY).first();
  if (!row) return null;
  try {
    const s = JSON.parse(row.data);
    return s && typeof s === 'object' && s.rehearsal ? { ...defaultState(), ...s } : null;
  } catch { return null; }
}

/** Saved only over the copy it was worked out from, so two staff pages asking at once never undo each other */
async function saveOver(DB, before, after) {
  const now = nowIso();
  if (!before) {
    await DB.prepare('INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)').bind(REHEARSAL_KEY, JSON.stringify(after), now).run();
    return true;
  }
  const r = await DB.prepare('UPDATE site_config SET data = ?, updated_at = ? WHERE key = ? AND data = ?')
    .bind(JSON.stringify(after), now, REHEARSAL_KEY, JSON.stringify(before)).run();
  return (r?.meta?.changes ?? 1) > 0;
}

/**
 * Start (or restart) a rehearsal of a kid's reveal, `minutes` from now. The reveal's words and photo are the real
 * broadcast's when it's the same kid (what viewers will see), else the kid's own, as scheduling picks them.
 */
export async function startRehearsal(env, { kidSlug, minutes, by }) {
  const { DB } = env;
  await ensureSchema(DB);
  const [config, real, kid] = await Promise.all([readConfig(DB), readState(DB), kidByName(DB, kidSlug)]);
  if (!config.rehearsalInput?.uid) return { ok: false, error: 'Set up the rehearsal feed first (Settings → Phones).' };
  if (!kid) return { ok: false, error: 'Pick a kid for the rehearsal.' };
  const mins = START_IN_MINUTES.includes(Number(minutes)) ? Number(minutes) : 10;
  const same = real?.kidSlug === kid.slug;
  const scheduledAt = new Date(Date.now() + mins * 60e3).toISOString();
  const s = {
    ...defaultState(),
    rehearsal: true,
    broadcastId: `rehearsal-${Date.now()}`,
    kidSlug: kid.slug, kidName: kid.name,
    title: same && real.title && !real.test ? real.title : `${kid.name}'s room reveal`,
    message: same && real.message ? real.message : `Watch ${kid.name}'s room reveal live`,
    image: (same && real.image) || sanitizeImage(kid.image) || null,
    scheduledAt,
    phase: Date.parse(scheduledAt) - Date.now() <= ARM_WINDOW_MS ? 'armed' : 'scheduled',
    kidVia: 'scheduled',
    createdAt: nowIso(), updatedAt: nowIso(), updatedBy: by || null,
    startedAt: nowIso(), startedBy: by || null,
  };
  if (s.phase === 'armed') s.armedAt = nowIso();
  await DB.prepare('INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)').bind(REHEARSAL_KEY, JSON.stringify(s), nowIso()).run();
  return { ok: true, state: s };
}

export async function endRehearsal(env) {
  await env.DB.prepare('DELETE FROM site_config WHERE key = ?').bind(REHEARSAL_KEY).run();
  return { ok: true };
}

/** Live again after it ended: a second take of the same reveal, with a recording of its own */
function takeAgain(s, videoUid) {
  return {
    ...s, phase: 'live', source: 'stream', liveAt: nowIso(), segmentAt: nowIso(), endedAt: null, disconnectedAt: null,
    liveVideoUid: videoUid || null, replayUid: null, replayReadyAt: null, replayUntil: null, replayStartedAt: null,
  };
}

/** The recording, once Stream has it ready (checkReplayReady in _broadcast.js, on the rehearsal input) */
async function recording(env, config, s) {
  let uid = s.liveVideoUid;
  let created = null;
  if (uid) {
    const v = await stream.getVideo(env, uid);
    if (!(v.ok && v.result?.status?.state === 'ready')) return null;
    created = v.result?.created || null;
  } else if (config.rehearsalInput?.uid) {
    const vids = await stream.listInputVideos(env, config.rehearsalInput.uid);
    const after = s.liveAt ? Date.parse(s.liveAt) - 10 * 60e3 : 0;
    const v = (vids.result || []).find((x) => x.status?.state === 'ready' && Date.parse(x.created) >= after);
    if (!v) return null;
    uid = v.uid; created = v.created || null;
  }
  if (!uid) return null;
  return { replayUid: uid, replayReadyAt: nowIso(), replayStartedAt: Number.isFinite(Date.parse(created || '')) ? new Date(Date.parse(created)).toISOString() : null };
}

/**
 * Move the rehearsal along, as runTick moves the reveal: the feed arriving, dropping, coming back or ending, the hour
 * before arming, and the recording. Returns { state, config, changed }; state null when no rehearsal is on.
 */
export async function rehearsalTick(env, { force = false } = {}) {
  const { DB } = env;
  const [read, config] = await Promise.all([readRehearsal(DB), readConfig(DB)]);
  if (!read) return { state: null, config, changed: false };
  const now = Date.now();
  if (now - Date.parse(read.startedAt || read.createdAt || 0) > REHEARSAL_MAX_MS) {
    await endRehearsal(env);
    return { state: null, config, changed: true };
  }
  let s = read;
  const inputUid = config.rehearsalInput?.uid;
  if (inputUid && (force || now - lastLifecycleAt >= LIFECYCLE_EVERY_MS)) {
    lastLifecycleAt = now;
    const lc = await stream.lifecycle(config.customerCode, inputUid);
    if (lc) {
      if (lc.live) {
        if (s.phase === 'live') { if (lc.videoUID && s.liveVideoUid !== lc.videoUID) s = { ...s, liveVideoUid: lc.videoUID }; }
        else if (s.phase === 'ending') s = tReconnected(s);
        else if (s.phase === 'replay') s = takeAgain(s, lc.videoUID);
        else s = tStartLive(s, { videoUid: lc.videoUID, source: 'stream', by: 'rehearsal' }, rehearsalConfig(config));
      } else if (s.source === 'stream') {
        if (s.phase === 'live') s = tDisconnected(s);
        else if (s.phase === 'ending' && now - Date.parse(s.disconnectedAt || 0) >= ENDING_GRACE_MS) s = tEnd(s, config);
      }
    }
  }
  if (s.phase === 'scheduled' && Date.parse(s.scheduledAt) - now <= ARM_WINDOW_MS) s = { ...s, phase: 'armed', armedAt: nowIso() };
  if (s.phase === 'replay' && !s.replayUid && stream.streamConfigured(env) && (force || now - lastReplayCheckAt >= REPLAY_CHECK_EVERY_MS)) {
    lastReplayCheckAt = now;
    const rec = await recording(env, config, s).catch(() => null);
    if (rec) s = { ...s, ...rec };
  }
  if (s === read) return { state: read, config, changed: false };
  s = { ...s, updatedAt: nowIso() };
  const saved = await saveOver(DB, read, s);
  // Another page saved first: what it saved stands
  return saved ? { state: s, config, changed: true } : { state: await readRehearsal(DB), config, changed: false };
}

/** What /api/broadcast-rehearsal answers, shaped like /api/broadcast's answer so the page reads it the same way */
export async function rehearsalPayload(env, { tick = true } = {}) {
  const { DB } = env;
  await ensureSchema(DB);
  const r = tick ? await rehearsalTick(env) : null;
  const config = r?.config || await readConfig(DB);
  const state = r ? r.state : await readRehearsal(DB);
  const base = {
    reminders: publicReminders(config, env),
    messages: { enabled: config.messages?.enabled !== false },
    timezone: config.timezone,
    hub: false,
  };
  if (!state) return { ...base, state: publicState(defaultState(), config), rehearsal: null };
  return {
    ...base,
    state: publicState(state, rehearsalConfig(config), { includeTest: true }),
    rehearsal: { kidSlug: state.kidSlug, kidName: state.kidName, startedAt: state.startedAt || null, startedBy: state.startedBy || null },
  };
}

/** A staff rehearsal for the live page's own server (functions/live): its record and settings, or null */
export async function rehearsalFor(DB) {
  const [state, config] = await Promise.all([readRehearsal(DB), readConfig(DB)]);
  return state ? { state, config: rehearsalConfig(config) } : null;
}
