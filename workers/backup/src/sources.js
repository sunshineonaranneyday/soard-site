/**
 * What the backup copies besides the databases, all read with the read-only key (CF_BACKUP_TOKEN) through
 * Cloudflare's API:
 *   - Cloudflare Images: each photo's original file, under its id
 *   - Stream: each video's MP4 (Stream's "default" download; a private video's through a short signed link made
 *     with a signing key the site hands over, which can open videos and do nothing else)
 *   - R2: every file in the site's buckets (soard-files, soard-vendor-docs)
 * In the backup homes every photo, video and R2 file is named by a code made from where it came from and its
 * version, never by its id, key or name: an image id can be kids/<a kid's name>/…, and a name can say whose it is.
 * Each run's encrypted list maps every code back.
 *
 * Nothing waits for ever: an answer that doesn't start within 2 minutes, or bytes that stop for 2 minutes, end the
 * attempt (the file is tried again later, and a file that keeps failing never holds up the rest).
 *
 * Cloudflare allows each person 1,200 API calls every 5 minutes across all their keys, and the site itself uses
 * the same allowance, so these calls are paced (PACE_MS apart) and wait when Cloudflare asks them to.
 */

const API = 'https://api.cloudflare.com/client/v4';
export const PACE_MS = 1000;
export const WAIT_MS = 120_000;

/** A fetch whose answer must start within `ms` (its body may then take as long as it keeps coming) */
export async function fetchStarted(fetchImpl, url, init = {}, ms = WAIT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new SourceError(`no answer in ${ms / 1000} s`, 504)), ms);
  try { return await fetchImpl(url, { ...init, signal: ac.signal }); } finally { clearTimeout(timer); }
}

/** A stream that fails if no bytes come for `ms` (a source that stalls part way) */
export function stallGuard(body, ms = WAIT_MS) {
  if (!body) return body;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(c) {
      let timer;
      const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(new SourceError(`the bytes stopped coming for ${ms / 1000} s`, 504)), ms); });
      try {
        const { value, done } = await Promise.race([reader.read(), stalled]);
        if (done) c.close(); else c.enqueue(value);
      } catch (e) {
        reader.cancel(e).catch(() => {});
        c.error(e);
      } finally { clearTimeout(timer); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export class SourceError extends Error {
  constructor(message, status) { super(message); this.name = 'SourceError'; this.status = status; }
}

/** Cloudflare's API with the read-only key, one call at a time and never faster than PACE_MS */
export function cfApi(env, { fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), pace = PACE_MS, retryMs = 2000 } = {}) {
  let last = 0;
  const call = async (path, { raw = false, query, method = 'GET', body: payload = undefined, headers: extraHeaders = {} } = {}) => {
    if (!env.CF_BACKUP_TOKEN) throw new SourceError('the read-only backup key (CF_BACKUP_TOKEN) isn’t set', 0);
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''))}` : '';
    for (let attempt = 0; ; attempt++) {
      const gap = last + pace - Date.now();
      if (gap > 0) await wait(gap);
      last = Date.now();
      let res;
      try {
        res = await fetchStarted(fetchImpl, `${API}/accounts/${env.CF_ACCOUNT_ID}${path}${qs}`, { method, headers: { Authorization: `Bearer ${env.CF_BACKUP_TOKEN}`, ...extraHeaders, ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
      } catch (e) {
        if (attempt < 4) { await wait(retryMs * (attempt + 1)); continue; }
        throw e;
      }
      if (res.status === 429 && attempt < 6) { await wait(Math.min(300, Number(res.headers.get('retry-after')) || 30) * 1000); continue; }
      if (res.status >= 500 && attempt < 4) { await wait(retryMs * (attempt + 1)); continue; }
      if (raw) {
        if (!res.ok) throw new SourceError(`Cloudflare ${res.status} for ${path.split('/').slice(0, 3).join('/')}`, res.status);
        return res;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success === false) throw new SourceError(`Cloudflare ${res.status}: ${body?.errors?.[0]?.message || res.statusText}`.slice(0, 300), res.status);
      return body;
    }
  };
  return call;
}

const ext = (name, fallback) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(name || ''); return m ? m[1].toLowerCase() : fallback; };
const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Every photo in Cloudflare Images: { source, key, version, name } (Images keeps each under 10 MB) */
export async function listImages(api) {
  const out = [];
  let token = null;
  do {
    const body = await api('/images/v2', { query: { per_page: 10000, continuation_token: token } });
    for (const im of body.result?.images || []) out.push({ source: 'images', key: im.id, version: im.uploaded || '1', name: im.filename || im.id });
    token = body.result?.continuation_token || null;
  } while (token);
  return out;
}

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/tiff': 'tif', 'image/bmp': 'bmp' };
/** Where an item's copy goes in the homes (before .age): its code, never its id or name; photos keep the extension of what they really are */
export function pathFor(item, { code, type = null }) {
  if (!/^[0-9a-f]{32}$/.test(code || '')) throw new SourceError('a copy needs its code', 0);
  if (item.source === 'images') {
    const kind = TYPES[String(type || '').split(';')[0].trim().toLowerCase()] || ext(item.name, 'bin');
    return `Files/Photos/${code}.${kind}`;
  }
  if (item.source === 'videos') return `Files/Videos/${code}.mp4`;
  return `Files/${item.source.slice(3)}/${code}`;
}

/** Every video in Stream; `download` is its MP4 address when Stream has one ready */
export async function listVideos(api) {
  const out = [];
  let start = null;
  for (;;) {
    const body = await api('/stream', { query: { limit: 1000, asc: 'true', start } });
    const page = body.result || [];
    for (const v of page) {
      const name = clean(v.meta?.name) || v.uid;
      out.push({ source: 'videos', key: v.uid, version: v.uploaded || v.created || '1', name, size: v.size || null, private: !!v.requireSignedURLs, ready: !!v.readyToStream && v.status?.state === 'ready' });
    }
    if (page.length < 1000) break;
    start = page[page.length - 1].created;
  }
  return out;
}

/** A video's MP4 address, or null while Stream hasn't made one (the site asks Stream to make them) */
export async function videoDownload(api, uid) {
  const body = await api(`/stream/${encodeURIComponent(uid)}/downloads`);
  const d = body.result?.default;
  return d?.status === 'ready' && d.url ? d.url : null;
}

/** Every file in an R2 bucket */
export async function listBucket(api, bucket) {
  const out = [];
  let cursor = null;
  for (;;) {
    const body = await api(`/r2/buckets/${encodeURIComponent(bucket)}/objects`, { query: { per_page: 1000, cursor } });
    for (const o of body.result || []) {
      out.push({ source: `r2:${bucket}`, key: o.key, version: o.etag, size: o.size, name: o.key, md5: /^[0-9a-f]{32}$/.test(o.etag || '') ? o.etag : null });
    }
    cursor = body.result_info?.cursor;
    if (!body.result_info?.is_truncated || !cursor) return out;
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** A one-hour link that opens a private video's MP4, signed with Stream's signing key ({ id, jwk }) */
export async function signedDownload(url, uid, streamKey, now = Date.now()) {
  const jwk = typeof streamKey.jwk === 'string' ? JSON.parse(atob(streamKey.jwk)) : streamKey.jwk;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const unsigned = `${b64urlJson({ alg: 'RS256', kid: streamKey.id })}.${b64urlJson({ sub: uid, kid: streamKey.id, exp: Math.floor(now / 1000) + 3600, downloadable: true })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return url.replace(`/${uid}/`, `/${unsigned}.${b64url(sig)}/`);
}

/** The bytes of one item, as a stream: { body, size, type } (size null when not known ahead) */
export async function openItem(api, item, { streamKey = null, fetchImpl = fetch } = {}) {
  if (item.source === 'images') {
    const res = await api(`/images/v1/${encodeURIComponent(item.key)}/blob`, { raw: true });
    return { body: stallGuard(res.body), size: Number(res.headers.get('content-length')) || null, type: res.headers.get('content-type') };
  }
  if (item.source === 'videos') {
    const url = await videoDownload(api, item.key);
    if (!url) throw new SourceError('Stream has no MP4 of it yet', 425);
    if (item.private && !streamKey) throw new SourceError('a private video needs the Stream signing key the site hands over', 425);
    const res = await fetchStarted(fetchImpl, item.private ? await signedDownload(url, item.key, streamKey) : url);
    if (item.private && (res.status === 401 || res.status === 403)) {
      // The MP4 is there, so a refusal is of the signing key (revoked, or never Stream's): the site is asked for a new one
      const e = new SourceError('Stream refused the signing key for a private video', 425);
      e.keyRefused = streamKey.id;
      throw e;
    }
    if (!res.ok) throw new SourceError(`Stream ${res.status} for the MP4`, res.status);
    return { body: stallGuard(res.body), size: Number(res.headers.get('content-length')) || null, type: 'video/mp4' };
  }
  if (item.source.startsWith('r2:')) {
    const bucket = item.source.slice(3);
    const res = await api(`/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(item.key)}`, { raw: true });
    return { body: stallGuard(res.body), size: item.size ?? null, md5: item.md5 ?? null, type: res.headers.get('content-type') };
  }
  throw new SourceError(`unknown source ${item.source}`);
}
