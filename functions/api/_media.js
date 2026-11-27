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

/**
 * The Stream videos a page names that Stream no longer has (most uploads from before 2024 were purged): the ones the
 * index's last read of Stream didn't find (./_media-index.js). null until Stream has been read once (nothing is
 * called gone on no evidence)
 */
export async function goneVideos(DB) {
  try {
    const st = await DB.prepare("SELECT value FROM media_state WHERE key = 'sources'").first();
    if (!parse(st?.value).stream?.doneAt) return null;
    const rows = (await DB.prepare("SELECT id FROM media_items WHERE source = 'stream'").all()).results || [];
    const have = new Set(rows.map((r) => r.id.slice(4)));
    return { has: (uid) => !have.has(uid) };
  } catch {
    return null;
  }
}

const isPublic = (kind, rec) => (kind === 'event' ? rec.status !== 'cancelled' : rec.publishStatus !== 'draft');
/** A record as an album, a draft or cancelled one too (staff see those, marked public: false) */
function albumOf(kind, rec, { broadcasts = [], reveal = null, gone = null } = {}) {
  const open = { ...rec, publishStatus: 'published', status: kind === 'event' && rec.status === 'cancelled' ? 'past' : rec.status };
  const a = kind === 'event' ? eventAlbum(open, { gone }) : kind === 'community' ? communityAlbum(open, { gone }) : kidAlbum(open, { broadcasts, reveal, gone });
  return a ? { ...a, public: isPublic(kind, rec), status: rec.status || a.status } : null;
}

/**
 * One album, from its key ("kid:ava"), or null (no such record; for anyone but staff, a draft or a cancelled event).
 * staff: drafts too, marked public: false
 */
export async function loadAlbum(env, key, { staff = false } = {}) {
  const k = parseAlbumKey(key);
  if (!k || !env.DB) return null;
  const row = await env.DB.prepare(`SELECT slug, data FROM ${TABLE[k.kind]} WHERE slug = ?`).bind(k.slug).first().catch(() => null);
  if (!row) return null;
  const rec = { ...parse(row.data), slug: row.slug };
  if (!staff && !isPublic(k.kind, rec)) return null;
  const gone = await goneVideos(env.DB);
  if (k.kind !== 'kid') return albumOf(k.kind, rec, { gone });
  const [broadcasts, reveals] = await Promise.all([loadBroadcasts(env.DB, { slug: k.slug, limit: 20 }), loadReveals(env)]);
  const reveal = [...reveals.past, ...reveals.upcoming].find((r) => r.slug === k.slug && r.date) || null;
  return albumOf('kid', rec, { broadcasts, reveal, gone });
}

/** Every record's album at once (the home page): { kid, event, community }, staff's with drafts (public: false) */
export async function loadAllAlbums(env, { staff = false, broadcasts = [], reveals = null } = {}) {
  const rows = async (t) => { try { return (await env.DB.prepare(`SELECT slug, data FROM ${t}`).all()).results || []; } catch { return []; } };
  const [kids, events, community, gone] = await Promise.all([rows('kids'), rows('events'), rows('community'), goneVideos(env.DB)]);
  const revealOf = new Map();
  for (const r of [...(reveals?.past || []), ...(reveals?.upcoming || [])]) if (r?.slug && r.date) revealOf.set(r.slug, r);
  const build = (kind, list) => list.map((r) => ({ ...parse(r.data), slug: r.slug }))
    .filter((rec) => staff || isPublic(kind, rec))
    .map((rec) => albumOf(kind, rec, { broadcasts, reveal: revealOf.get(rec.slug), gone }))
    .filter(Boolean);
  return { kid: build('kid', kids), event: build('event', events), community: build('community', community), gone };
}

/** The video of an album a download names: by its key ("live:<uid>", "reel:<broadcast id>"), or by its Stream id */
export function albumVideo(album, { key = '', uid = '' } = {}) {
  const list = (album?.videos || []).filter((v) => v.uid);
  return (key && list.find((v) => v.key === key)) || (uid && list.find((v) => v.uid === uid && v.kind !== 'reel')) || null;
}
