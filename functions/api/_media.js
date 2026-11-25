/**
 * Admin → Photos & Videos, the server's half (./media-admin.js, ./media-download.js)
 * ===========================================================================
 * The albums are built by the same code the page uses
 * (public/admin/media-shared.js), from the same records, so a download can
 * only name a photo or video the page showed: a published kid, event or
 * community project, its photos as its public page shows them, its videos,
 * and its live reveals. Anything else (a family's application video, an
 * advisory applicant's photo, a before photo kept off the page) isn't in any
 * album and is refused.
 */

import { kidAlbum, eventAlbum, communityAlbum, parseAlbumKey } from '../../public/admin/media-shared.js';
import { cachedReveals } from './_reveals.js';

const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

/** A broadcast row as the albums read it: the live reveal, its replay and its Reel (no keys, no viewers, no emails) */
export function broadcastOf(row) {
  const d = parse(row?.data);
  const r = d.reel || null;
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    id: String(row.id),
    kidSlug: row.kid_slug || null,
    kidName: row.kid_name || null,
    liveAt: row.live_at || null,
    endedAt: row.ended_at || null,
    replayUid: row.replay_uid || row.live_video_uid || null,
    fbPermalink: row.fb_permalink || null,
    test: d.test === true,
    reel: r ? {
      sourceUid: r.sourceUid || null,
      clipUid: r.clipUid || null,
      start: num(r.cut?.start ?? r.start),
      end: num(r.cut?.end ?? r.end),
      coverSeconds: num(r.cut?.coverSeconds ?? r.coverSeconds),
      caption: typeof r.caption === 'string' ? r.caption : '',
      permalink: r.permalink || null,
      fbPermalink: r.facebook?.permalink || null,
      publishedAt: r.publishedAt || null,
    } : null,
  };
}

/** Live reveals that went out (a kid's, when slug is given), newest first */
export async function loadBroadcasts(DB, { slug = null, limit = 300 } = {}) {
  try {
    const sql = `SELECT id, kid_slug, kid_name, live_at, ended_at, live_video_uid, replay_uid, fb_permalink, data FROM broadcasts
      WHERE live_at IS NOT NULL${slug ? ' AND kid_slug = ?' : ''} ORDER BY live_at DESC LIMIT ${Math.max(1, Math.min(1000, limit))}`;
    const stmt = slug ? DB.prepare(sql).bind(slug) : DB.prepare(sql);
    return ((await stmt.all()).results || []).map(broadcastOf).filter((b) => !b.test);
  } catch {
    return []; // no broadcasts table yet (a new database): no live reveals
  }
}

/** The reveal schedule as the albums and "What's happening" read it: the last good copy, never JobTread itself */
export async function loadReveals(env, now = Date.now()) {
  try {
    const r = await cachedReveals(env, now);
    const keep = (x) => ({ slug: x.slug, name: x.name, confirmed: x.confirmed !== false, date: x.date || null, time: x.time || null, window: x.window || null, rooms: x.rooms || [] });
    return { upcoming: (r.upcoming || []).map(keep), past: (r.past || []).map(keep), updatedAt: r.updatedAt || null };
  } catch {
    return { upcoming: [], past: [], updatedAt: null };
  }
}

const TABLE = { kid: 'kids', event: 'events', community: 'community' };

/** One album, from its key ("kid:ava"), or null (no such record, a draft, a cancelled event) */
export async function loadAlbum(env, key) {
  const k = parseAlbumKey(key);
  if (!k || !env.DB) return null;
  const row = await env.DB.prepare(`SELECT slug, data FROM ${TABLE[k.kind]} WHERE slug = ?`).bind(k.slug).first().catch(() => null);
  if (!row) return null;
  const rec = { ...parse(row.data), slug: row.slug };
  if (k.kind === 'event') return eventAlbum(rec);
  if (k.kind === 'community') return communityAlbum(rec);
  const [broadcasts, reveals] = await Promise.all([loadBroadcasts(env.DB, { slug: k.slug, limit: 20 }), loadReveals(env)]);
  const reveal = [...reveals.past, ...reveals.upcoming].find((r) => r.slug === k.slug && r.date) || null;
  return kidAlbum(rec, { broadcasts, reveal });
}

/** The video of an album a download names: by its key ("live:<uid>", "reel:<broadcast id>"), or by its Stream id */
export function albumVideo(album, { key = '', uid = '' } = {}) {
  const list = (album?.videos || []).filter((v) => v.uid);
  return (key && list.find((v) => v.key === key)) || (uid && list.find((v) => v.uid === uid && v.kind !== 'reel')) || null;
}
