/**
 * The channel's own YouTube sign-in for scripts (scripts/youtube-api.js).
 * Run: node --test tests/youtube-api.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SCOPES, KEYS, credentials, keychainGet, keychainSet, pkce, authUrl, readCallback, exchangeCode, client } from '../scripts/youtube-api.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('the sign-in asks for a refresh token, every scope, and PKCE', () => {
  const { verifier, challenge } = pkce(Buffer.alloc(32, 7));
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  const u = new URL(authUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5000/', state: 's1', challenge, loginHint: 'peter@soardcharity.com' }));
  const p = u.searchParams;
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(p.get('access_type'), 'offline');
  assert.equal(p.get('prompt'), 'consent');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('code_challenge'), challenge);
  assert.equal(p.get('redirect_uri'), 'http://127.0.0.1:5000/');
  assert.equal(p.get('login_hint'), 'peter@soardcharity.com');
  assert.deepEqual(p.get('scope').split(' '), SCOPES);
  assert.ok(SCOPES.includes('https://www.googleapis.com/auth/youtube'));
  assert.ok(SCOPES.includes('https://www.googleapis.com/auth/yt-analytics.readonly'));
});

test('the loopback reply: code, Google error, or a state that is not ours', () => {
  assert.deepEqual(readCallback('/?state=abc&code=4/xyz', 'abc'), { code: '4/xyz' });
  assert.deepEqual(readCallback('/?error=access_denied&state=abc', 'abc'), { error: 'access_denied' });
  assert.match(readCallback('/?state=other&code=4/xyz', 'abc').error, /state did not match/);
  assert.match(readCallback('/?state=abc', 'abc').error, /no code/);
  assert.match(readCallback('/favicon.ico', 'abc').error, /state/);
});

test('credentials: the environment wins, then the Keychain, under soard-site', () => {
  const asked = [];
  const c = credentials({ env: { YOUTUBE_CLIENT_ID: 'from-env' }, get: (k) => (asked.push(k), k === 'YOUTUBE_REFRESH_TOKEN' ? 'rt' : null) });
  assert.deepEqual(c, { YOUTUBE_CLIENT_ID: 'from-env', YOUTUBE_CLIENT_SECRET: null, YOUTUBE_REFRESH_TOKEN: 'rt' });
  assert.deepEqual(asked, ['YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']);

  let args;
  assert.equal(keychainGet('YOUTUBE_CLIENT_ID', { platform: 'darwin', run: (cmd, a) => ((args = [cmd, ...a]), 'value\n') }), 'value');
  assert.deepEqual(args, ['security', 'find-generic-password', '-s', 'soard-site', '-a', 'YOUTUBE_CLIENT_ID', '-w']);
  assert.equal(keychainGet('YOUTUBE_CLIENT_ID', { platform: 'linux', run: () => 'x' }), null);
  assert.equal(keychainGet('YOUTUBE_CLIENT_ID', { platform: 'darwin', run: () => { throw new Error('no item'); } }), null);
});

test('only the three YouTube keys can be written, never empty', () => {
  let args;
  keychainSet('YOUTUBE_REFRESH_TOKEN', '1//tok', { run: (cmd, a) => (args = [cmd, ...a]) });
  assert.deepEqual(args, ['security', 'add-generic-password', '-U', '-s', 'soard-site', '-a', 'YOUTUBE_REFRESH_TOKEN', '-w', '1//tok']);
  assert.throws(() => keychainSet('CLOUDFLARE_API_TOKEN', 'x', { run: () => {} }), /Not a YouTube key/);
  assert.throws(() => keychainSet('YOUTUBE_CLIENT_ID', '', { run: () => {} }), /No value/);
  assert.deepEqual(KEYS, ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']);
});

test('exchanging the code sends the verifier; a Google error reads plainly', async () => {
  let sent;
  const ok = await exchangeCode({ clientId: 'c', clientSecret: 's', code: 'k', redirectUri: 'http://127.0.0.1:1/', verifier: 'v', fetchImpl: async (url, init) => ((sent = { url, body: new URLSearchParams(init.body) }), json(200, { refresh_token: 'rt', access_token: 'at' })) });
  assert.equal(ok.refresh_token, 'rt');
  assert.equal(sent.url, 'https://oauth2.googleapis.com/token');
  assert.equal(sent.body.get('code_verifier'), 'v');
  assert.equal(sent.body.get('grant_type'), 'authorization_code');
  await assert.rejects(exchangeCode({ clientId: 'c', clientSecret: 's', code: 'k', redirectUri: 'r', verifier: 'v', fetchImpl: async () => json(400, { error: 'invalid_grant', error_description: 'Bad Request' }) }), /Google sign-in: Bad Request/);
});

test('the client refreshes once on a 401, sends JSON, and names YouTube\'s reason', async () => {
  const calls = [];
  let tokens = 0;
  let firstTry = true;
  const fetchImpl = async (url, init) => {
    if (url.startsWith('https://oauth2')) return json(200, { access_token: `at${++tokens}` });
    calls.push({ url, method: init.method, auth: init.headers.authorization, type: init.headers['content-type'], body: init.body });
    if (url.includes('/videos') && firstTry) { firstTry = false; return json(401, { error: { message: 'expired' } }); }
    if (url.includes('/playlists')) return json(403, { error: { message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } });
    return json(200, { id: 'v1' });
  };
  const api = client({ clientId: 'c', clientSecret: 's', refreshToken: 'rt', fetchImpl });
  const out = await api.call('PUT', 'videos', { part: 'snippet', skip: null }, { id: 'v1', snippet: { title: 'T' } });
  assert.deepEqual(out, { id: 'v1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].auth, 'Bearer at1');
  assert.equal(calls[1].auth, 'Bearer at2');
  assert.equal(calls[1].url, 'https://www.googleapis.com/youtube/v3/videos?part=snippet');
  assert.equal(calls[1].type, 'application/json');
  assert.deepEqual(JSON.parse(calls[1].body), { id: 'v1', snippet: { title: 'T' } });

  await assert.rejects(api.call('GET', 'playlists', { mine: true }), (e) => e.reason === 'quotaExceeded' && /exceeded your quota/.test(e.message));
});

test('uploads go to the upload endpoint as media; list calls follow every page', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    if (url.startsWith('https://oauth2')) return json(200, { access_token: 'at' });
    urls.push(url);
    if (url.includes('thumbnails')) return json(200, { items: [] });
    const page = new URL(url).searchParams.get('pageToken');
    return json(200, page ? { items: [3] } : { items: [1, 2], nextPageToken: 'p2' });
  };
  const api = client({ clientId: 'c', clientSecret: 's', refreshToken: 'rt', fetchImpl });
  await api.upload('thumbnails/set', { videoId: 'abc' }, Buffer.from('jpg'), 'image/jpeg');
  assert.equal(urls[0], 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=abc&uploadType=media');
  assert.deepEqual(await api.all('playlistItems', { part: 'snippet', playlistId: 'PL1' }), [1, 2, 3]);
  assert.match(urls[1], /maxResults=50/);
  assert.match(urls[2], /pageToken=p2/);
});
