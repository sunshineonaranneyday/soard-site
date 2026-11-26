/**
 * The site signed in as the YouTube channel
 * =========================================
 * What an API key can't do: make each reveal's own YouTube live, tie it to
 * the stream key and end it (./_youtube-live.js). Reads (is the channel live,
 * a video's counts, ./_youtube.js) use it too when there's no YOUTUBE_API_KEY.
 *
 * The same OAuth client and sign-in as scripts/youtube.mjs (docs/youtube-api.md:
 * Google Cloud project "SOARD Website", app "SOARD YouTube Tools", signed in as
 * the Sunshine on a Ranney Day brand account), kept as Cloudflare Pages secrets:
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 * Nothing here writes a key or token anywhere; a refused call says Google's
 * reason, never the request.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const API = 'https://www.googleapis.com/youtube/v3';
export const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const TIMEOUT_MS = 10_000;

export function oauthConfigured(env) {
  return !!(env?.YOUTUBE_CLIENT_ID && env?.YOUTUBE_CLIENT_SECRET && env?.YOUTUBE_REFRESH_TOKEN);
}

// An access token lasts an hour; one per isolate, renewed two minutes early
let cached = null; // { key, token, until }

export function forgetToken() {
  cached = null;
}

/** A fresh access token for the channel → string; a refused sign-in throws (.reason 'invalid_grant' once it was revoked) */
export async function accessToken(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const key = `${env.YOUTUBE_CLIENT_ID}:${env.YOUTUBE_REFRESH_TOKEN}`;
  if (cached && cached.key === key && now < cached.until) return cached.token;
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, refresh_token: env.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(`YouTube sign-in refused: ${data.error_description || data.error || res.status}`);
    err.status = res.status;
    err.reason = data.error || null;
    throw err;
  }
  cached = { key, token: data.access_token, until: now + (Number(data.expires_in) || 3600) * 1000 - 120_000 };
  return cached.token;
}

const withQuery = (base, params) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params || {})) if (v != null) u.searchParams.set(k, String(v));
  return u.toString();
};

/**
 * One YouTube Data API call as the channel → its JSON ({} for 204).
 *   ytCall(env, 'POST', 'liveBroadcasts', { part: 'id,snippet' }, body)
 *   ytCall(env, 'POST', 'thumbnails/set', { videoId }, null, { upload: { bytes, type: 'image/jpeg' } })
 * A refused call throws with .status and .reason (Google's, e.g. quotaExceeded, liveBroadcastNotFound,
 * redundantTransition). A 401 renews the token once and tries again.
 */
export async function ytCall(env, method, path, params = {}, body, { fetchImpl = fetch, upload = null } = {}) {
  const url = upload ? withQuery(`${UPLOAD_API}/${path}`, { ...params, uploadType: 'media' }) : withQuery(`${API}/${path}`, params);
  const send = async () => {
    const token = await accessToken(env, { fetchImpl });
    const headers = { authorization: `Bearer ${token}` };
    let payload;
    if (upload) { headers['content-type'] = upload.type || 'application/octet-stream'; payload = upload.bytes; }
    else if (body !== undefined && body !== null) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    return fetchImpl(url, { method, headers, body: payload, signal: AbortSignal.timeout(upload ? 30_000 : TIMEOUT_MS) });
  };
  let res = await send();
  if (res.status === 401) { forgetToken(); res = await send(); }
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const reason = data.error?.errors?.[0]?.reason || null;
    const err = new Error(`YouTube ${method} ${path}: ${data.error?.message || res.status}${reason ? ` (${reason})` : ''}`);
    err.status = res.status;
    err.reason = reason;
    throw err;
  }
  return data;
}
