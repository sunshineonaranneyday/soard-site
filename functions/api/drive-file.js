/**
 * GET /api/drive-file?d=<Drive file>&e=<expiry>&s=<signature>
 * ===========================================================================
 * One photo from Drive, streamed to JobTread, which takes a file only by
 * fetching its address: the past makeovers' photos (./_past-photos.js) are
 * handed to JobTread as this short link, signed with a key worked out from the
 * Google service account's key and good for six hours. The file is read
 * through the site's delegation (read only) and only from Sunshine - Photos &
 * Video's holding folder for JobTread; the bytes pass straight through (a
 * stream, never held in memory). Anything that isn't a valid, unexpired link to
 * such a file is 404, and nothing is cached.
 * Public for GET in the middleware (JobTread can't sign in).
 */

import { checkDriveLink, driveToken, PHOTOS_DRIVE } from './_past-photos.js';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
const busy = (why) => new Response(why, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

export async function onRequestGet(context) {
  const { env, request } = context;
  const fetchImpl = context.fetchImpl || fetch;
  const q = Object.fromEntries(new URL(request.url).searchParams);
  if (!(await checkDriveLink(env, q))) return notFound();
  let token;
  try { token = await driveToken(env, { fetchImpl }); } catch { return busy('Google Drive isn’t answering'); }
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  // Only a file in Photos & Video, never anything else the reader can open
  const meta = await fetchImpl(`${DRIVE}/${encodeURIComponent(q.d)}?supportsAllDrives=true&fields=id,name,mimeType,size,driveId,trashed`, auth);
  if (meta.status === 404) return notFound();
  if (!meta.ok) return busy('Google Drive isn’t answering');
  const f = await meta.json();
  if (f.driveId !== PHOTOS_DRIVE || f.trashed || f.mimeType === 'application/vnd.google-apps.folder') return notFound();
  const res = await fetchImpl(`${DRIVE}/${encodeURIComponent(q.d)}?alt=media&supportsAllDrives=true`, auth);
  if (!res.ok || !res.body) return busy('Google Drive’s file isn’t available');
  const headers = new Headers({
    'Content-Type': f.mimeType && f.mimeType !== 'application/octet-stream' ? f.mimeType : 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name || 'photo')}`,
    'Cache-Control': 'no-store',
  });
  if (f.size) headers.set('Content-Length', String(f.size));
  return new Response(res.body, { status: 200, headers });
}
