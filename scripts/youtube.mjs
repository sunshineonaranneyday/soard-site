#!/usr/bin/env node
/**
 * The SOARD YouTube channel from the command line (Data API, signed in as the channel).
 *
 *   node scripts/youtube.mjs set YOUTUBE_CLIENT_ID          the OAuth client, read from stdin into the Keychain
 *   node scripts/youtube.mjs set YOUTUBE_CLIENT_SECRET
 *   node scripts/youtube.mjs login [--hint you@soardcharity.com]   sign in once, saves the refresh token
 *   node scripts/youtube.mjs whoami                          which channel the sign-in manages
 *   node scripts/youtube.mjs get channels part=snippet mine=true
 *   node scripts/youtube.mjs put videos part=snippet --body video.json    (post, delete the same way; --body - reads stdin)
 *   node scripts/youtube.mjs analytics metrics=views,estimatedMinutesWatched dimensions=video sort=-views maxResults=25
 *   node scripts/youtube.mjs banner banner.png               upload and set the channel banner (2560×1440)
 *   node scripts/youtube.mjs thumbnail <videoId> thumb.jpg   set a video's thumbnail (1280×720, under 2 MB)
 *
 * Keys and the how: scripts/youtube-api.js.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { KEYS, credentials, keychainSet, pkce, authUrl, readCallback, exchangeCode, client } from './youtube-api.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const params = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) flags[a.slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  else if (/^[A-Za-z.]+=/.test(a)) params[a.slice(0, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
  else positional.push(a);
}

const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const readStdin = () => readFileSync(0, 'utf8');
const imageType = (file) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' })[extname(file).toLowerCase()] || 'application/octet-stream';

function need(...names) {
  const c = credentials();
  const missing = names.filter((n) => !c[n]);
  if (missing.length) {
    console.error(`Missing in the Keychain (service "soard-site"): ${missing.join(', ')}.`);
    if (missing.some((m) => m !== 'YOUTUBE_REFRESH_TOKEN')) console.error('Save the OAuth client with: node scripts/youtube.mjs set YOUTUBE_CLIENT_ID (then YOUTUBE_CLIENT_SECRET)');
    if (missing.includes('YOUTUBE_REFRESH_TOKEN')) console.error('Sign in with: node scripts/youtube.mjs login');
    process.exit(1);
  }
  return c;
}

function yt() {
  const c = need(...KEYS);
  return client({ clientId: c.YOUTUBE_CLIENT_ID, clientSecret: c.YOUTUBE_CLIENT_SECRET, refreshToken: c.YOUTUBE_REFRESH_TOKEN });
}

async function whoami(api) {
  const d = await api.call('GET', 'channels', { part: 'snippet,statistics,brandingSettings', mine: true });
  return (d.items || []).map((ch) => ({
    id: ch.id,
    title: ch.snippet.title,
    handle: ch.snippet.customUrl,
    subscribers: Number(ch.statistics.subscriberCount),
    videos: Number(ch.statistics.videoCount),
    views: Number(ch.statistics.viewCount),
  }));
}

async function login() {
  const c = need('YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET');
  const state = randomBytes(16).toString('hex');
  const { verifier, challenge } = pkce();
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}/`;
  const url = authUrl({ clientId: c.YOUTUBE_CLIENT_ID, redirectUri, state, challenge, loginHint: flags.hint });
  console.log(`Sign in as the SOARD channel (pick "Sunshine on a Ranney Day" when Google asks which channel):\n\n${url}\n`);
  if (flags.open !== 'no') execFile('open', [url], () => {});

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const got = readCallback(req.url, state);
      if (!got.code && !got.error) return res.end();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(got.code
        ? '<body style="font:18px system-ui;padding:40px">Signed in. You can close this tab.</body>'
        : `<body style="font:18px system-ui;padding:40px">Sign-in didn't finish: ${got.error}</body>`);
      server.close();
      got.code ? resolve(got.code) : reject(new Error(got.error));
    });
    setTimeout(() => { server.close(); reject(new Error('No sign-in within 10 minutes')); }, 10 * 60 * 1000).unref();
  });

  const tokens = await exchangeCode({ clientId: c.YOUTUBE_CLIENT_ID, clientSecret: c.YOUTUBE_CLIENT_SECRET, code, redirectUri, verifier });
  if (!tokens.refresh_token) throw new Error('Google sent no refresh token. Remove the app at myaccount.google.com/permissions and sign in again.');
  keychainSet('YOUTUBE_REFRESH_TOKEN', tokens.refresh_token);
  console.log('Saved YOUTUBE_REFRESH_TOKEN in the Keychain. Scopes:', tokens.scope);
  print(await whoami(client({ clientId: c.YOUTUBE_CLIENT_ID, clientSecret: c.YOUTUBE_CLIENT_SECRET, refreshToken: tokens.refresh_token })));
}

async function main() {
  switch (cmd) {
    case 'set': {
      const name = positional[0];
      if (!KEYS.includes(name)) throw new Error(`set one of: ${KEYS.join(', ')}`);
      const value = readStdin().trim();
      keychainSet(name, value);
      return print(`Saved ${name} in the Keychain (${value.length} characters).`);
    }
    case 'login':
      return login();
    case 'whoami':
      return print(await whoami(yt()));
    case 'get':
    case 'put':
    case 'post':
    case 'delete': {
      const body = flags.body === '-' ? JSON.parse(readStdin()) : flags.body ? JSON.parse(readFileSync(flags.body, 'utf8')) : undefined;
      return print(await yt().call(cmd.toUpperCase(), positional[0], params, body));
    }
    case 'analytics': {
      const today = new Date().toISOString().slice(0, 10);
      return print(await yt().analytics({ ids: 'channel==MINE', startDate: '2012-01-01', endDate: today, ...params }));
    }
    case 'banner': {
      const api = yt();
      const file = positional[0];
      const up = await api.upload('channelBanners/insert', {}, readFileSync(file), imageType(file));
      const [me] = await api.all('channels', { part: 'brandingSettings', mine: true });
      me.brandingSettings.image = { bannerExternalUrl: up.url };
      delete me.brandingSettings.watch; // retired parts YouTube no longer takes back
      delete me.brandingSettings.hints;
      await api.call('PUT', 'channels', { part: 'brandingSettings' }, { id: me.id, brandingSettings: me.brandingSettings });
      return print({ banner: up.url });
    }
    case 'thumbnail': {
      const [videoId, file] = positional;
      return print(await yt().upload('thumbnails/set', { videoId }, readFileSync(file), imageType(file)));
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
