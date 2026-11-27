/**
 * POST /api/media-inbox — the email Worker's word that a photo email came in
 * ===========================================================================
 * photos@sunshineonaranneyday.com is handed by Cloudflare Email Routing to
 * SOARD's own email Worker (workers/media-inbox), which keeps the message
 * exactly as it came in SOARD's private bucket (MEDIA_FILES raw/email/…) and
 * then calls here with its key, signed: X-Media-Time and X-Media-Signature,
 * HMAC-SHA256 of "<time>.<key>" with MEDIA_INBOX_SECRET (a secret on both,
 * set in Cloudflare), within five minutes. The message is taken in at once
 * (./_media-inbox.js receiveEmail) and its sender answered (when replies are
 * on). One the site doesn't hear about is picked up by the heartbeat.
 * Public in the middleware (the Worker can't sign in): the signature is the proof.
 */

import { checkWorkerSignature, receiveEmail, sendReply } from './_media-inbox.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.MEDIA_INBOX_SECRET || !env.MEDIA_FILES) return Response.json({ ok: false, error: 'Not set up' }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || '');
  const ok = /^raw\/email\/[A-Za-z0-9._-]{8,120}\.eml$/.test(key)
    && await checkWorkerSignature(env, { key, ts: request.headers.get('X-Media-Time'), sig: request.headers.get('X-Media-Signature') });
  if (!ok) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  try {
    const row = await receiveEmail(env, key);
    context.waitUntil?.(sendReply(env, row).catch(() => {}));
    return Response.json({ ok: true, id: row.id, state: row.state, files: row.files, album: row.album });
  } catch (e) {
    // (kept, so the heartbeat tries again: a 500 the Worker logs)
    return Response.json({ ok: false, error: String(e.message || e).slice(0, 300) }, { status: e.status || 500 });
  }
}
