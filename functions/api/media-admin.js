/**
 * /api/media-admin (Cloudflare Access, staff) — Admin → Photos & Videos
 * ===========================================================================
 * The page (public/admin/media.js) builds its albums from the kids, events and
 * community projects the admin has already loaded; this adds what only the
 * server has:
 *
 * GET                               → { ok, reveals: { upcoming, past, updatedAt }, broadcasts }
 *                                     The reveal schedule (the last good copy, ./_reveals.js) and the live reveals
 *                                     that went out, with their replay and Reel (./_media.js broadcastOf)
 * GET ?videos=<uid>,<uid>…          → { ok, videos: { <uid>: { seconds, bytes, ready } }, complete } how long each
 *                                     video is, from a look through the whole Stream library. complete: every video
 *                                     was read, so one asked for that isn't there was purged (most Stream uploads from
 *                                     before 2024 were; src/utils/reveals.ts) and the page leaves it out. Nothing, and
 *                                     complete false, when Stream can't be read
 * GET ?album=<key>&mp4=<video key>  → { ok, ready, percent } Stream makes the video's MP4 the first time it's asked
 *                                     for (a few minutes for a long one); the page asks again until it's ready, then
 *                                     downloads it from ./media-download.js
 */

import { loadBroadcasts, loadReveals, loadAlbum, albumVideo } from './_media.js';
import { isUid } from '../../public/admin/media-shared.js';
import * as stream from './_stream-live.js';

const fail = (error, status = 400) => Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
const ok = (body) => Response.json({ ok: true, ...body }, { headers: { 'Cache-Control': 'no-store' } });

const PAGE = 1000;   // Stream's most per listing
const PAGES = 10;

/** Length and size of the videos asked for, from a look through the Stream library, newest first: { videos, complete } */
export async function videoFacts(env, uids, fetchImpl = fetch) {
  const want = new Set(uids);
  const videos = {};
  if (!want.size || !stream.streamConfigured(env)) return { videos, complete: false };
  let end = '';
  for (let page = 0; page < PAGES; page++) {
    const qs = new URLSearchParams({ limit: String(PAGE), include_counts: 'false', ...(end ? { end } : {}) });
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream?${qs}`, {
      headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}` },
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(stream.errorMessage({ status: res.status, errors: data.errors }));
    const list = data.result || [];
    for (const v of list) {
      if (!want.has(v.uid)) continue;
      videos[v.uid] = { seconds: v.duration > 0 ? Math.round(v.duration) : null, bytes: Number(v.size) || null, ready: !!v.readyToStream };
    }
    if (list.length < PAGE || Object.keys(videos).length === want.size) return { videos, complete: true };
    const last = list[list.length - 1]?.created;
    if (!last || last === end) break;
    end = last;
  }
  return { videos, complete: false };
}

/** Ask Stream for a video's MP4 (once), and say how far along it is: { ready, percent } */
export async function prepareMp4(env, uid) {
  let r = await stream.getDownloads(env, uid);
  if (!r.ok) throw new Error(stream.errorMessage(r, 'Stream could not say where the MP4 is'));
  let d = r.result?.default;
  // One Stream failed to make is asked for again
  if (!d || d.status === 'error') {
    r = await stream.createDownload(env, uid);
    if (!r.ok) throw new Error(stream.errorMessage(r, 'Stream would not make an MP4 of this video'));
    d = r.result?.default;
  }
  const ready = d?.status === 'ready' && !!d.url;
  return { ready, percent: ready ? 100 : Math.max(0, Math.min(99, Math.round(Number(d?.percentComplete) || 0))) };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const q = new URL(request.url).searchParams;
  try {
    if (q.has('mp4')) {
      const album = await loadAlbum(env, q.get('album'));
      if (!album) return fail('That album isn’t on the website', 404);
      const video = albumVideo(album, { key: q.get('mp4') });
      if (!video) return fail('That video isn’t in this album', 404);
      if (video.kind === 'reel' && video.start != null) return ok({ ready: true, percent: 100 }); // cut as it downloads
      if (!stream.streamConfigured(env)) return fail('Stream isn’t connected (CF_STREAM_TOKEN)', 500);
      return ok(await prepareMp4(env, video.uid));
    }
    if (q.has('videos')) {
      const uids = [...new Set(String(q.get('videos') || '').split(',').map((s) => s.trim().toLowerCase()).filter(isUid))].slice(0, 400);
      try { return ok(await videoFacts(env, uids)); } catch (e) { return ok({ videos: {}, complete: false, error: e.message }); }
    }
    const [reveals, broadcasts] = await Promise.all([loadReveals(env), loadBroadcasts(env.DB)]);
    return ok({ reveals, broadcasts });
  } catch (err) {
    console.error('[media-admin]', err);
    // 500, not 502: Cloudflare replaces 502/504 bodies with its own page
    return fail(err.message || 'Something went wrong', 500);
  }
}
