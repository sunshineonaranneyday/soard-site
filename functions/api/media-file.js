/**
 * GET /api/media-file?k=<original>&e=<expiry>&s=<signature> — a sent-in video, for Stream to copy
 * ===========================================================================
 * A video the team sent in is kept as it came in SOARD's private bucket
 * (MEDIA_FILES originals/…); Stream makes its playable copy and MP4 by
 * fetching it from here (./_media-inbox.js keepFile). The link is signed with
 * a key worked out from MEDIA_INBOX_SECRET, names one original, and lasts six
 * hours. Anything else is 404. The bytes pass straight through, never cached.
 * Public for GET in the middleware (Stream can't sign in): the signature is the proof.
 */

import { checkFileLink } from './_media-inbox.js';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestGet(context) {
  const { env, request } = context;
  const q = Object.fromEntries(new URL(request.url).searchParams);
  if (!env.MEDIA_FILES || !(await checkFileLink(env, q))) return notFound();
  const obj = await env.MEDIA_FILES.get(q.k);
  if (!obj) return notFound();
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Content-Length': String(obj.size), 'Cache-Control': 'no-store' } });
}
