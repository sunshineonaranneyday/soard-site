/**
 * GET /api/media-thumb?id=drv:<Drive file>&s=480 (Cloudflare Access) — a Drive archive photo's picture,
 * or ?id=inb:<file> a photo the team sent in (its copy made as it came in, from SOARD's own bucket)
 * ===========================================================================
 * The archive's photos live in Drive (Sunshine - Photos & Video), which only
 * shows its pictures to someone signed in to it: this asks Drive for the
 * file's own thumbnail, at the size asked (64 to 1600 px), through the site's
 * read-only delegation (./_past-photos.js driveToken), and hands it on.
 *
 * Only a photo or video the person may see (./_media-search.js itemFor: for
 * the Photos & Videos sign-in, a public album's, and a Before photo once the
 * address check passed it). That's asked first, every time; the picture itself
 * is kept at the edge for a day after, so a page of 60 asks Drive once.
 */

import { itemFor } from './_media-search.js';
import { driveToken, PHOTOS_DRIVE } from './_past-photos.js';
import { previewKey } from './_media-inbox.js';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestGet(context) {
  const { env, request } = context;
  const fetchImpl = context.fetchImpl || fetch;
  const q = new URL(request.url).searchParams;
  const id = String(q.get('id') || '');
  const size = Math.max(64, Math.min(1600, Math.round(Number(q.get('s')) || 480)));
  if (!/^(drv:[A-Za-z0-9_-]{10,200}|inb:[a-z0-9]{8,24})$/.test(id)) return notFound();
  const row = await itemFor(env.DB, id, { staff: !context.data?.mediaOnly }).catch(() => null);
  if (!row) return notFound();
  // A photo the team sent in: its own copies in SOARD's bucket, made as it came in (./_media-inbox.js)
  if (id.startsWith('inb:')) {
    const pic = await env.MEDIA_FILES?.get(previewKey(id.slice(4), size <= 600 ? '600' : '2000'));
    if (!pic) return notFound();
    return new Response(pic.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  }
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://media-thumb.soard.internal/${encodeURIComponent(id)}/${size}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return new Response(hit.body, { headers: { 'Content-Type': hit.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  let token;
  try { token = await driveToken(env, { fetchImpl }); } catch { return new Response('Google Drive isn’t answering', { status: 503, headers: { 'Retry-After': '30' } }); }
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const meta = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id.slice(4))}?supportsAllDrives=true&fields=thumbnailLink,driveId,trashed`, auth);
  const m = meta.ok ? await meta.json().catch(() => null) : null;
  if (!m || m.driveId !== PHOTOS_DRIVE || m.trashed || !m.thumbnailLink) return notFound();
  const pic = await fetchImpl(m.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${size}`), auth);
  if (!pic.ok) return notFound();
  const bytes = await pic.arrayBuffer();
  const type = (pic.headers.get('Content-Type') || 'image/jpeg').split(';')[0];
  if (cache) context.waitUntil?.(cache.put(key, new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } })).catch(() => {}));
  return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } });
}
