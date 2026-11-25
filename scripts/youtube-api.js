/**
 * YouTube Data API with the channel's own sign-in (OAuth), for running from a Mac.
 * ==============================================================================
 * The site's YOUTUBE_API_KEY (functions/api/_youtube.js) only reads public data.
 * This writes: the channel's description, keywords, trailer and banner, every
 * video's title, description, tags and thumbnail, playlists and sections, and
 * reads YouTube Analytics.
 *
 * Credentials never sit in a file. They live in the login Keychain under the
 * service "soard-site" (as the D1 keys do, scripts/d1-helpers.js):
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET   the OAuth client (Google Cloud →
 *       Google Auth Platform → Clients → Desktop app, project "SOARD YouTube")
 *   YOUTUBE_REFRESH_TOKEN                     written by `node scripts/youtube.mjs login`
 *
 * Pure helpers here, the command line in scripts/youtube.mjs.
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

export const KEYCHAIN_SERVICE = 'soard-site';
export const KEYS = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const API = 'https://www.googleapis.com/youtube/v3';
export const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
export const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2';

// youtube: manage the channel, videos, playlists, banner, thumbnails.
// youtube.force-ssl: captions and comments. yt-analytics.readonly: what's watched.
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

/** One value from the macOS Keychain, or null */
export function keychainGet(name, { run = execFileSync, platform = process.platform } = {}) {
  if (platform !== 'darwin') return null;
  try {
    const out = run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

/** Save (or replace) one value in the macOS Keychain */
export function keychainSet(name, value, { run = execFileSync } = {}) {
  if (!KEYS.includes(name)) throw new Error(`Not a YouTube key: ${name}`);
  if (!value) throw new Error(`No value for ${name}`);
  run('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', name, '-w', value], { stdio: 'ignore' });
}

/** The three values: environment first (for a one-off run), then the Keychain */
export function credentials({ env = process.env, get = keychainGet } = {}) {
  const out = {};
  for (const k of KEYS) out[k] = env[k] || get(k) || null;
  return out;
}

/** PKCE pair for the sign-in */
export function pkce(bytes = randomBytes(32)) {
  const verifier = Buffer.from(bytes).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** The Google sign-in URL. prompt=consent so Google always returns a refresh token. */
export function authUrl({ clientId, redirectUri, state, challenge, scopes = SCOPES, loginHint }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

/** What came back to the loopback address: { code } or { error } */
export function readCallback(url, expectedState) {
  const u = new URL(url, 'http://127.0.0.1');
  const p = u.searchParams;
  if (p.get('error')) return { error: p.get('error') };
  if (p.get('state') !== expectedState) return { error: 'state did not match (an old or someone else\'s sign-in)' };
  const code = p.get('code');
  return code ? { code } : { error: 'no code in the reply' };
}

async function tokenCall(body, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Google sign-in: ${data.error_description || data.error || res.status}`);
  return data;
}

/** Code from the sign-in → { access_token, refresh_token, scope, expires_in } */
export function exchangeCode({ clientId, clientSecret, code, redirectUri, verifier, fetchImpl = fetch }) {
  return tokenCall({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier, grant_type: 'authorization_code' }, fetchImpl);
}

/** Refresh token → a fresh access token (an hour) */
export function refreshAccess({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  return tokenCall({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchImpl);
}

/**
 * A client for the Data API. call('GET', 'channels', { part, mine }) → data.
 * A 401 refreshes the token once and retries.
 */
export function client({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  let token = null;
  const fresh = async () => (token = (await refreshAccess({ clientId, clientSecret, refreshToken, fetchImpl })).access_token);

  async function request(method, url, { body, headers = {} } = {}, retried = false) {
    if (!token) await fresh();
    const res = await fetchImpl(url, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body });
    if (res.status === 401 && !retried) {
      await fresh();
      return request(method, url, { body, headers }, true);
    }
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const reason = data.error?.errors?.[0]?.reason;
      const err = new Error(`YouTube ${method} ${new URL(url).pathname}: ${data.error?.message || res.status}${reason ? ` (${reason})` : ''}`);
      err.status = res.status;
      err.reason = reason;
      throw err;
    }
    return data;
  }

  const withQuery = (base, params) => {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params || {})) if (v != null) u.searchParams.set(k, String(v));
    return u.toString();
  };

  return {
    /** Data API: call('PUT', 'videos', { part: 'snippet' }, { id, snippet }) */
    call(method, path, params, json) {
      return request(method, withQuery(`${API}/${path}`, params), json === undefined ? {} : { body: JSON.stringify(json), headers: { 'content-type': 'application/json' } });
    },
    /** Media upload (banner, thumbnail): upload('thumbnails/set', { videoId }, bytes, 'image/jpeg') */
    upload(path, params, bytes, type) {
      return request('POST', withQuery(`${UPLOAD_API}/${path}`, { ...params, uploadType: 'media' }), { body: bytes, headers: { 'content-type': type } });
    },
    /** YouTube Analytics: analytics({ ids: 'channel==MINE', metrics, dimensions, startDate, endDate }) */
    analytics(params) {
      return request('GET', withQuery(`${ANALYTICS_API}/reports`, params));
    },
    /** Every item of a list call, page by page */
    async all(path, params) {
      const items = [];
      let pageToken;
      do {
        const data = await this.call('GET', path, { maxResults: 50, ...params, pageToken });
        items.push(...(data.items || []));
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },
  };
}
