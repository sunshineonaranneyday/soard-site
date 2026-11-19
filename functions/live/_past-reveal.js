/**
 * A child's own reveal on their live page, for good
 * =================================================
 * Peter, Nov 18 2026: "can it be there forever as dylans? if we are sending people there i want them to see the reveal
 * through that right???" Every email, text, post and QR code for a child links to /live/<kid>/. While that child's
 * broadcast is current (planned, live, or its replay window) the page shows it as it always has; once it isn't (the
 * replay window over, or the next child's reveal taking the live page), the page shows the child's own last reveal
 * instead of the plain page between reveals: the Theater with its replay waiting for a tap, its messages, its design
 * and its sponsors. functions/live/[[path]].js draws it so from the first paint and hands it to the page script
 * (#live-hero data-past), which keeps it (LivePage decide). The replay's reveal moment and captions and the messages
 * are read by its broadcast id (/api/live-replay?b=, /api/live-messages?b=); the messages are read-only then.
 *
 * Only a real reveal from our own stream with a recording counts: never a test (its row says so), never an emergency
 * Facebook-only broadcast (no video here to show).
 */
import { publicState } from '../api/_broadcast.js';

/** A broadcast id as the site makes them (as broadcast-event.js and live-watch.js check it; what ?b= may name) */
export const BROADCAST_ID_RE = /^live-\d{1,16}$/;

/** The current broadcast is this child's own and on (anything but idle): it, not their past reveal, is what their page shows */
export function ownCurrent(pub, pageKid) {
  return !!pub && !!pageKid && pub.kidSlug === pageKid && (pub.phase || 'idle') !== 'idle';
}

const rowData = (row) => {
  try { return JSON.parse(row?.data || '{}') || {}; } catch { return {}; }
};

/** The row a child's page falls back to: their latest ended reveal from our own stream with a recording, not a test */
export function pickPastRow(rows) {
  for (const row of rows || []) {
    if (!row?.id || !row.replay_uid || !row.ended_at || row.source !== 'stream') continue;
    if (rowData(row).test) continue;
    return row;
  }
  return null;
}

/** The broadcast state a past reveal's row stands for: its replay, ended, no window (it's for good) */
export function pastStateOf(row) {
  const d = rowData(row);
  return {
    phase: 'replay', broadcastId: row.id, kidSlug: row.kid_slug, kidName: row.kid_name,
    title: row.title, message: row.message, image: row.image,
    scheduledAt: row.scheduled_at, liveAt: row.live_at, endedAt: row.ended_at, replayUntil: null,
    replayUid: row.replay_uid, source: 'stream', test: false, manual: null, fb: null,
    reel: d.reel || null, revealAtSeconds: d.revealAtSeconds ?? null,
    updatedAt: row.ended_at,
  };
}

/** A broadcast row by id when it's a real reveal with a recording (what ?b= may name), else null */
export async function revealRow(DB, id) {
  if (!DB || typeof id !== 'string' || !BROADCAST_ID_RE.test(id)) return null;
  const row = await DB.prepare('SELECT id, kid_slug, kid_name, title, message, image, scheduled_at, live_at, ended_at, replay_uid, source, data FROM broadcasts WHERE id = ?').bind(id).first();
  return pickPastRow(row ? [row] : []);
}

/**
 * The child's own last reveal, for their page: { state, pub } (pub as publicState gives it, the page script's LiveState),
 * or null when they have none to show
 */
export async function pastReveal(DB, pageKid, config) {
  if (!DB || !pageKid) return null;
  const r = await DB.prepare(`SELECT id, kid_slug, kid_name, title, message, image, scheduled_at, live_at, ended_at, replay_uid, source, data
      FROM broadcasts WHERE kid_slug = ? AND replay_uid IS NOT NULL AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 10`)
    .bind(pageKid).all();
  const row = pickPastRow(r?.results);
  if (!row) return null;
  const state = pastStateOf(row);
  return { state, pub: { ...publicState(state, config), past: true } };
}
