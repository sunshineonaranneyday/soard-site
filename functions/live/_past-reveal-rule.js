/**
 * Which broadcasts are a child's past reveal: the one rule
 * =======================================================
 * A child's live page shows their own last reveal in the Theater for good (functions/live/_past-reveal.js), and the
 * reveal cards (/reveals/, the past reveals on /live/) open that Theater for every child who has one (scripts/prebuild.js
 * writes their slugs at build time). Both decide by this file, so a card never opens a Theater that isn't there, nor
 * misses one that is. No imports: the build runs it under Node, the live page under Workers.
 *
 * A past reveal is a real reveal from our own stream with a recording: ended, with its replay, never a test (its row's
 * data says so), never an emergency Facebook-only broadcast (no video here to show).
 */

/** The broadcasts row's columns the live page reads for a past reveal */
export const PAST_REVEAL_COLUMNS = 'id, kid_slug, kid_name, title, message, image, scheduled_at, live_at, ended_at, replay_uid, source, data';

/** The rows that can be one (the rest of the rule, isPastReveal, is checked on each row: its data is JSON) */
export const PAST_REVEAL_CANDIDATES = 'replay_uid IS NOT NULL AND ended_at IS NOT NULL';

/** The query for every child with a past reveal (the build): `query(PAST_REVEALS_SQL)`, then pastRevealKids(rows) */
export const PAST_REVEALS_SQL = `SELECT ${PAST_REVEAL_COLUMNS} FROM broadcasts WHERE kid_slug IS NOT NULL AND ${PAST_REVEAL_CANDIDATES} ORDER BY ended_at DESC`;

const rowData = (row) => {
  try { return JSON.parse(row?.data || '{}') || {}; } catch { return {}; }
};

/** A broadcasts row is a child's past reveal (a row's unreadable extras don't make it a test) */
export function isPastReveal(row) {
  return !!row?.id && !!row.replay_uid && !!row.ended_at && row.source === 'stream' && !rowData(row).test;
}

/** The children with a past reveal, from broadcasts rows (any order): their slugs, sorted, each once */
export function pastRevealKids(rows) {
  return [...new Set((rows || []).filter((r) => isPastReveal(r) && r.kid_slug).map((r) => r.kid_slug))].sort();
}
