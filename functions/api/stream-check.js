/**
 * GET /api/stream-check?uid=<32-hex Stream uid>
 * =============================================
 * Will a kid page play this Stream video? The same check the build makes in
 * src/utils/reveals.ts (fetch the HLS manifest): 200 = playable, 4xx = gone
 * (purged, still processing, or the subscription lapsed), anything else =
 * unknown. The admin's Preview uses it to pick the video the page will show;
 * browsers can't make the check themselves because Stream's manifest CORS
 * only allows videodelivery.net.
 *
 * Returns { success, uid, state: 'playable' | 'gone' | 'unknown', aspect },
 * aspect the video's width / height when it plays (null otherwise): the
 * kid page plays an upright video in a frame of its own shape.
 * Authenticated via Cloudflare Access (middleware default, not public).
 */

import { playbackHost } from './_stream-live.js';

const UID_RE = /^[a-f0-9]{32}$/i;

/** Master playlists list RESOLUTION=WxH per rendition; any one gives the frame shape (parseAspect in src/utils/reveals.ts) */
export function manifestAspect(manifest) {
  const m = String(manifest || '').match(/RESOLUTION=(\d+)x(\d+)/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? Math.round((w / h) * 1000) / 1000 : null;
}

/** { state, aspect }: will it play, and its width / height when it does */
export async function streamCheck(uid, fetchImpl = fetch) {
  if (!UID_RE.test(uid || '')) return { state: 'gone', aspect: null };
  try {
    const res = await fetchImpl(`${playbackHost()}/${uid.toLowerCase()}/manifest/video.m3u8`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 200) return { state: 'playable', aspect: manifestAspect(await res.text().catch(() => '')) };
    await res.body?.cancel().catch(() => {});
    return { state: res.status >= 400 && res.status < 500 ? 'gone' : 'unknown', aspect: null };
  } catch {
    return { state: 'unknown', aspect: null };
  }
}

export async function checkStreamUid(uid, fetchImpl = fetch) {
  return (await streamCheck(uid, fetchImpl)).state;
}

export async function onRequestGet(context) {
  const uid = new URL(context.request.url).searchParams.get('uid') || '';
  const { state, aspect } = await streamCheck(uid);
  return Response.json({ success: true, uid, state, aspect }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
