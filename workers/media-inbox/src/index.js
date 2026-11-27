/**
 * soard-media-inbox: photos@sunshineonaranneyday.com
 * ===========================================================================
 * Peter, Nov 26 2026: "i want my team to either email or text", "no
 * patches,no shortcuts". The team emails photos and videos here; they land in
 * Admin → Photos & Videos (the website's functions/api/_media-inbox.js does
 * the rest: who sent it, the files, where they go, the reply).
 *
 * This Worker only receives, and loses nothing:
 *   1. The message, exactly as it came, into SOARD's private bucket
 *      (raw/email/<time>-<id>.eml), with who the envelope says it's from and
 *      to. Cloudflare's mail servers have already checked the sender (SPF,
 *      DKIM, DMARC) and written what they found into the message itself; the
 *      website reads that, never what the sender claims.
 *   2. Then it tells the website (POST /api/media-inbox, signed: HMAC-SHA256
 *      of "<time>.<key>" with MEDIA_INBOX_SECRET) and waits while the website
 *      takes it in. If the website doesn't answer, the message is still in the
 *      bucket and the website's minute heartbeat picks it up.
 * A message too big for email (over 25 MB) never reaches here: Cloudflare
 * returns it to the sender. Phones send big videos as links instead (Mail
 * Drop), which the website fetches.
 */

const enc = new TextEncoder();

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The message's key in the bucket: when it came and a random part, so two at once never meet */
export const keyFor = (now = Date.now()) => `raw/email/${new Date(now).toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.eml`;

export async function keep(env, message, now = Date.now()) {
  const key = keyFor(now);
  const raw = await new Response(message.raw).arrayBuffer();
  await env.MEDIA_FILES.put(key, raw, {
    httpMetadata: { contentType: 'message/rfc822' },
    customMetadata: { from: String(message.from || ''), to: String(message.to || ''), received: new Date(now).toISOString(), size: String(raw.byteLength) },
  });
  return key;
}

export async function tell(env, key, fetchImpl = fetch, now = Date.now()) {
  if (!env.MEDIA_INBOX_SECRET) return { ok: false, why: 'MEDIA_INBOX_SECRET isn’t set: the heartbeat will pick it up' };
  const ts = String(now);
  const res = await fetchImpl(`${env.SITE || 'https://sunshineonaranneyday.com'}/api/media-inbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Media-Time': ts, 'X-Media-Signature': await hmacHex(env.MEDIA_INBOX_SECRET, `${ts}.${key}`) },
    body: JSON.stringify({ key }),
  });
  return { ok: res.ok, status: res.status };
}

export default {
  async email(message, env) {
    const key = await keep(env, message);
    try {
      const r = await tell(env, key);
      if (!r.ok) console.warn('[media-inbox] the website didn’t take', key, r.status || r.why);
    } catch (e) {
      console.warn('[media-inbox] the website didn’t answer for', key, e.message);
    }
  },
};
