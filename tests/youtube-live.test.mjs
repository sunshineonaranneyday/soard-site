/**
 * Each reveal's own YouTube live (functions/api/_youtube-live.js), against a pretend YouTube that keeps its
 * broadcasts, streams and thumbnails the way the Data API answers them.
 * Run: node --test tests/youtube-live.test.mjs
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const KEY = 'c02a-k3y5-abcd-efgh-dcyp'; // the site's YouTube stream key (only its mask is ever stored)
const H = 3600e3;
const T0 = Date.parse('2026-11-25T22:00:00Z');
const REVEAL = '2026-12-04T19:00:00.000Z';

// ─── A pretend Google ───────────────────────────────────────────────
function fakeGoogle() {
  const g = {
    calls: [], broadcasts: new Map(), n: 0, streamActive: false, autoStarts: true, fail: null,
    videos: [], thumbnails: [], images: { up: [], gone: [] },
    streams: [
      { id: 'S-other', snippet: { title: 'Default stream key' }, cdn: { ingestionInfo: { streamName: 'zzzz-0000-1111-2222-yyyy' } } },
      { id: 'S-site', snippet: { title: 'SOARD Site' }, cdn: { ingestionInfo: { streamName: KEY } } },
    ],
  };
  const json = (obj, status = 200, type = 'application/json') => new Response(JSON.stringify(obj), { status, headers: { 'content-type': type } });
  const err = (status, reason, message = reason) => json({ error: { code: status, message, errors: [{ reason }] } }, status);
  const item = (b) => ({ id: b.id, snippet: { ...b.snippet, actualStartTime: b.startedAt || undefined, actualEndTime: b.endedAt || undefined }, status: { lifeCycleStatus: b.life, privacyStatus: b.privacy, selfDeclaredMadeForKids: b.mfk }, contentDetails: { ...b.contentDetails, boundStreamId: b.bound || undefined } });
  // YouTube's Auto-start: a broadcast waiting on a stream that turns active goes live by itself
  g.phoneOn = () => { g.streamActive = true; if (g.autoStarts) for (const b of g.broadcasts.values()) if (b.life === 'ready' && b.bound === 'S-site' && b.contentDetails.enableAutoStart) { b.life = 'live'; b.startedAt = new Date().toISOString(); } };
  g.phoneOff = () => { g.streamActive = false; };
  g.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const q = Object.fromEntries(url.searchParams);
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
    g.calls.push({ method, host: url.host, path: url.pathname, q, body });
    if (g.fail && g.fail.match(method, url.pathname)) return err(g.fail.status, g.fail.reason);
    if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'at-1', expires_in: 3600 });
    if (url.host === 'sunshineonaranneyday.com' && url.pathname === '/og/index.json') return json({ '/live/colin/': { url: '/og/live/colin.jpg?v=31be22a553', key: 'k' } });
    if (url.host === 'sunshineonaranneyday.com' && url.pathname === '/og/live/colin.jpg') return new Response(new Uint8Array(1200), { headers: { 'content-type': 'image/jpeg' } });
    if (url.host === 'api.cloudflare.com' && method === 'POST') { g.images.up.push(String(init.body?.get?.('id') || '')); return json({ success: true, result: { id: init.body?.get?.('id') } }); }
    if (url.host === 'api.cloudflare.com' && method === 'DELETE') { g.images.gone.push(url.pathname); return json({ success: true }); }
    if (url.host === 'imagedelivery.net') return new Response(new Uint8Array(1280), { headers: { 'content-type': 'image/jpeg' } });
    assert.equal(init.headers?.authorization, 'Bearer at-1', 'every YouTube call is signed in');
    const p = url.pathname.replace(/^\/(upload\/)?youtube\/v3\//, '');
    if (p === 'liveStreams') {
      const list = q.id ? g.streams.filter((s) => s.id === q.id) : g.streams;
      return json({ items: list.map((s) => ({ ...s, status: { streamStatus: s.id === 'S-site' && g.streamActive ? 'active' : 'inactive' } })) });
    }
    if (p === 'liveBroadcasts' && method === 'POST') {
      const id = `B${++g.n}`;
      g.broadcasts.set(id, { id, snippet: { ...body.snippet }, contentDetails: { ...body.contentDetails }, privacy: body.status.privacyStatus, mfk: body.status.selfDeclaredMadeForKids, life: 'created', bound: null });
      return json(item(g.broadcasts.get(id)));
    }
    if (p === 'liveBroadcasts' && method === 'GET') {
      if (q.id) return json({ items: g.broadcasts.has(q.id) ? [item(g.broadcasts.get(q.id))] : [] });
      if (q.broadcastStatus === 'upcoming') return json({ items: [...g.broadcasts.values()].filter((b) => ['created', 'ready'].includes(b.life)).map(item) });
      return json({ items: [...g.broadcasts.values()].map(item) });
    }
    if (p === 'liveBroadcasts' && method === 'PUT') {
      const b = g.broadcasts.get(body.id);
      if (!b) return err(404, 'liveBroadcastNotFound');
      assert.ok(body.snippet.title && body.snippet.scheduledStartTime, 'an update carries the title and start (YouTube requires both)');
      Object.assign(b.snippet, body.snippet);
      return json(item(b));
    }
    if (p === 'liveBroadcasts' && method === 'DELETE') {
      if (!g.broadcasts.has(q.id)) return err(404, 'liveBroadcastNotFound');
      g.broadcasts.delete(q.id);
      return new Response(null, { status: 204 });
    }
    if (p === 'liveBroadcasts/bind') {
      const b = g.broadcasts.get(q.id);
      Object.assign(b, { bound: q.streamId, life: b.life === 'created' ? 'ready' : b.life });
      if (g.streamActive && g.autoStarts && b.life === 'ready') { b.life = 'live'; b.startedAt = new Date().toISOString(); }
      return json(item(b));
    }
    if (p === 'liveBroadcasts/transition') {
      const b = g.broadcasts.get(q.id);
      if (!b) return err(404, 'liveBroadcastNotFound');
      if (q.broadcastStatus === 'live') {
        if (!g.streamActive) return err(403, 'errorStreamInactive');
        if (b.life === 'live') return err(403, 'redundantTransition');
        Object.assign(b, { life: 'live', startedAt: new Date().toISOString() });
      }
      if (q.broadcastStatus === 'complete') {
        if (b.life === 'complete') return err(403, 'redundantTransition');
        if (b.life !== 'live' && b.life !== 'testing') return err(403, 'invalidTransition');
        Object.assign(b, { life: 'complete', endedAt: new Date().toISOString() });
      }
      return json(item(b));
    }
    if (p === 'videos' && method === 'PUT') {
      g.videos.push({ part: q.part, ...body });
      const b = g.broadcasts.get(body.id);
      if (b && body.status?.privacyStatus) b.privacy = body.status.privacyStatus;
      return json(body);
    }
    if (p === 'thumbnails/set') { g.thumbnails.push({ videoId: q.videoId, type: init.headers['content-type'], bytes: init.body.byteLength }); return json({ items: [{}] }); }
    return new Response(`not mocked: ${method} ${url}`, { status: 599 });
  };
  g.youtubeCalls = () => g.calls.filter((c) => c.host === 'www.googleapis.com');
  return g;
}

let yl, DB;
const config = {
  outputs: { youtube: { uid: 'out-yt', url: 'rtmps://a.rtmps.youtube.com:443/live2', keyMask: 'c02a…dcyp', enabled: true } },
  youtube: { channelUrl: 'https://www.youtube.com/@sunshineonaranneyday/live', auto: true },
  timezone: 'America/New_York',
  defaults: { title: 'Live room reveal' },
};
const envFor = () => ({ DB, YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'csecret', YOUTUBE_REFRESH_TOKEN: 'rtoken', CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 'img' });
const colin = (over = {}) => ({ phase: 'scheduled', broadcastId: 'live-1', kidSlug: 'colin', kidName: 'Colin', title: "Colin's room reveal", scheduledAt: REVEAL, source: null, test: false, ...over });
const reset = async () => { await DB.prepare("DELETE FROM site_config WHERE key = 'youtube-live'").run(); };
const sync = (g, state, now, opts = {}) => yl.syncYouTubeLive(envFor(), opts.config || config, state, opts.work || [], { now, fetchImpl: g.fetch, ...opts });

before(async () => {
  DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare('INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)').bind('colin', JSON.stringify({ name: 'Colin', slug: 'colin', heroSummary: 'Colin lives with STXBP1, a rare neurological disorder affecting his movement and independence.' }), 'Colin', 2026, 'in-progress').run();
  yl = await import('../functions/api/_youtube-live.js');
});

// ─── Words ──────────────────────────────────────────────────────────

test('the title names the kid; staff\'s own title stays; nothing YouTube refuses', () => {
  assert.equal(yl.liveTitle(colin(), config), "Colin's Room Reveal | Sunshine on a Ranney Day");
  assert.equal(yl.liveTitle(colin({ title: 'Colin and the <Braves> surprise' }), config), 'Colin and the Braves surprise | Sunshine on a Ranney Day');
  assert.equal(yl.liveTitle({ title: 'Live room reveal' }, config), 'Live Room Reveal | Sunshine on a Ranney Day');
  assert.ok(yl.liveTitle(colin({ title: 'x'.repeat(140) }), config).length <= 100);
});

test('the description: the story, when, the website with ?src=youtube, donate', () => {
  const d = yl.liveDescription(colin(), { story: 'Colin lives with STXBP1.', upcoming: true });
  assert.match(d, /^Colin lives with STXBP1\./);
  assert.match(d, /Watch the moment Colin sees the new room for the first time, live on Friday, December 4 at 2:00 PM EST\./);
  assert.match(d, /https:\/\/sunshineonaranneyday\.com\/live\/colin\/\?src=youtube/);
  assert.match(d, /https:\/\/sunshineonaranneyday\.com\/donate\//);
  assert.doesNotMatch(d, /[<>]/);
  assert.match(yl.liveDescription({}, {}), /Watch a child see their new room for the first time\.[\s\S]*\/live\/\?src=youtube/);
});

test('what YouTube should have: the planned reveal, a stream on air, never a test, a rehearsal or the banner', () => {
  assert.equal(yl.wanted(colin()).kind, 'upcoming');
  assert.equal(yl.wanted(colin({ phase: 'armed' })).kind, 'upcoming');
  assert.equal(yl.wanted(colin({ phase: 'live', source: 'stream' })).kind, 'live');
  assert.equal(yl.wanted(colin({ phase: 'ending', source: 'stream' })).kind, 'live');
  assert.equal(yl.wanted(colin({ test: true })), null);
  assert.equal(yl.wanted(colin({ phase: 'live', source: 'stream', quiet: true })), null);
  assert.equal(yl.wanted(colin({ phase: 'live', source: 'manual' })), null);
  assert.equal(yl.wanted(colin({ phase: 'replay', source: 'stream' })), null);
  assert.equal(yl.wanted({ phase: 'idle' }), null);
});

test('off without the channel sign-in, the YouTube output or the switch', () => {
  assert.equal(yl.autoOn({}, config), false);
  assert.equal(yl.autoOn(envFor(), { ...config, outputs: {} }), false);
  assert.equal(yl.autoOn(envFor(), { ...config, outputs: { youtube: { ...config.outputs.youtube, enabled: false } } }), false);
  assert.equal(yl.autoOn(envFor(), { ...config, youtube: { auto: false } }), false);
  assert.equal(yl.autoOn(envFor(), config), true);
});

// ─── The whole life of a reveal's live ──────────────────────────────

test('the countdown goes up: a public, not-for-kids live on the site\'s key, with the card as its picture', async () => {
  await reset();
  const g = fakeGoogle();
  const work = [];
  const rec = await sync(g, colin(), T0, { work });
  assert.equal(rec.error, null);
  assert.equal(g.broadcasts.size, 1);
  const b = [...g.broadcasts.values()][0];
  assert.equal(b.snippet.title, "Colin's Room Reveal | Sunshine on a Ranney Day");
  assert.equal(b.snippet.scheduledStartTime, REVEAL);
  assert.match(b.snippet.description, /STXBP1[\s\S]*Friday, December 4 at 2:00 PM EST[\s\S]*\?src=youtube/);
  assert.equal(b.privacy, 'public');
  assert.equal(b.mfk, false);
  assert.equal(b.contentDetails.enableAutoStart, true);
  assert.equal(b.contentDetails.enableAutoStop, false, 'YouTube\'s own stop ends it 12 s into a phone drop: the site ends it');
  assert.equal(b.bound, 'S-site', 'tied to the stream whose key is the one in Settings, not the default');
  assert.equal(b.life, 'ready');
  const cat = g.videos.find((v) => v.id === b.id && v.part === 'snippet');
  assert.equal(cat.snippet.categoryId, '29');
  assert.deepEqual(g.thumbnails, [{ videoId: b.id, type: 'image/jpeg', bytes: 1280 }], 'the card padded to 1280×720 by Cloudflare Images');
  assert.equal(g.images.up.length, 1);
  assert.equal(g.images.gone.length, 1, 'the padded copy is taken off Cloudflare Images again');
  assert.deepEqual(work.filter((w) => w.startsWith('youtube')), ['youtube-live-made', 'youtube-live-bound', 'youtube-thumbnail']);
  // The record keeps ids and words, never the key
  const stored = (await DB.prepare("SELECT data FROM site_config WHERE key = 'youtube-live'").first()).data;
  assert.ok(!stored.includes(KEY) && !stored.includes('k3y5'));
  assert.equal(yl.liveFor(rec, 'live-1').id, b.id);
  assert.equal(yl.preflightItem(rec, colin(), config).status, 'ok');
});

test('nothing changed: no call to YouTube until the next look', async () => {
  const g = fakeGoogle();
  await sync(g, colin(), T0 + 60e3);
  await sync(g, colin(), T0 + 2 * H);
  assert.equal(g.calls.length, 0);
});

test('JobTread moves the reveal: the same live, its time and words changed', async () => {
  const g = fakeGoogle();
  const prev = await yl.readRecord(DB);
  const id = prev.lives[0].id;
  g.broadcasts.set(id, { id, snippet: { title: 'x', scheduledStartTime: REVEAL }, contentDetails: { enableAutoStart: true }, privacy: 'public', mfk: false, life: 'ready', bound: 'S-site' });
  const work = [];
  await sync(g, colin({ scheduledAt: '2026-12-05T15:00:00.000Z' }), T0 + 3 * H, { work });
  assert.equal(g.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/liveBroadcasts')).length, 0, 'no second live');
  const b = g.broadcasts.get(id);
  assert.equal(b.snippet.scheduledStartTime, '2026-12-05T15:00:00.000Z');
  assert.match(b.snippet.description, /Saturday, December 5 at 10:00 AM EST/);
  assert.ok(work.includes('youtube-live-changed'));
});

test('the phone connects: YouTube starts it itself; ended with the reveal, not before', async () => {
  await reset();
  const g = fakeGoogle();
  await sync(g, colin(), T0);
  const [b] = g.broadcasts.values();
  g.phoneOn();
  assert.equal(b.life, 'live');
  const live = colin({ phase: 'live', source: 'stream', liveAt: new Date(T0 + 4 * H).toISOString(), segmentAt: new Date(T0 + 4 * H).toISOString() });
  const work = [];
  await sync(g, live, T0 + 4 * H + 5e3, { work });
  assert.equal(g.broadcasts.size, 1);
  assert.ok(!work.includes('youtube-live-changed'), 'going live changes nothing on YouTube');
  // A drop: the site is still on (ending), YouTube keeps the live
  g.phoneOff();
  await sync(g, { ...live, phase: 'ending' }, T0 + 4 * H + 20 * 60e3);
  assert.equal(b.life, 'live');
  // The site's end (45 s grace, or the crew's Y): the live ends
  const w2 = [];
  await sync(g, { ...live, phase: 'replay' }, T0 + 4 * H + 21 * 60e3, { work: w2 });
  assert.equal(b.life, 'complete');
  assert.ok(w2.includes('youtube-live-ended'));
});

test('YouTube still waiting 45 s into the reveal with video arriving: the site starts it', async () => {
  await reset();
  const g = fakeGoogle();
  g.autoStarts = false;
  await sync(g, colin({ phase: 'armed' }), T0);
  const [b] = g.broadcasts.values();
  g.phoneOn();
  const at = T0 + H;
  const live = colin({ phase: 'live', source: 'stream', liveAt: new Date(at).toISOString(), segmentAt: new Date(at).toISOString() });
  await sync(g, live, at + 5e3);
  assert.equal(b.life, 'ready', 'not before 45 s: Auto-start gets its chance');
  const work = [];
  await sync(g, live, at + 50e3, { work });
  assert.equal(b.life, 'live');
  assert.ok(work.includes('youtube-live-started'));
});

test('a framing check: that live is ended and made private, and a fresh one waits for the reveal', async () => {
  await reset();
  const g = fakeGoogle();
  await sync(g, colin(), T0);
  const [first] = g.broadcasts.values();
  g.phoneOn();
  await sync(g, colin({ phase: 'live', source: 'stream', liveAt: new Date(T0 + H).toISOString() }), T0 + H);
  g.phoneOff();
  // tPreShowOver: back to the countdown
  const work = [];
  const rec = await sync(g, colin({ phase: 'armed' }), T0 + H + 5 * 60e3, { work });
  assert.equal(first.life, 'complete');
  assert.equal(first.privacy, 'private');
  assert.equal(g.broadcasts.size, 2);
  const fresh = yl.liveFor(rec, 'live-1');
  assert.notEqual(fresh.id, first.id);
  assert.equal(g.broadcasts.get(fresh.id).life, 'ready');
  assert.equal(g.broadcasts.get(fresh.id).snippet.title, "Colin's Room Reveal | Sunshine on a Ranney Day", 'not "continued": the framing check was never the reveal');
});

test('picked up again after its live ended: a "continued" live, started on the spot', async () => {
  await reset();
  const g = fakeGoogle();
  g.autoStarts = false;
  await sync(g, colin(), T0);
  const [first] = g.broadcasts.values();
  g.phoneOn();
  const at = T0 + 4 * H;
  const live = colin({ phase: 'live', source: 'stream', liveAt: new Date(at).toISOString(), segmentAt: new Date(at).toISOString() });
  await sync(g, live, at + 50e3);
  assert.equal(first.life, 'live');
  g.phoneOff();
  await sync(g, { ...live, phase: 'replay' }, at + 15 * 60e3);
  assert.equal(first.life, 'complete');
  // tRejoin: the phone back within the window
  g.phoneOn();
  const back = { ...live, segmentAt: new Date(at + 16 * 60e3).toISOString() };
  await sync(g, back, at + 16 * 60e3);
  const second = [...g.broadcasts.values()].find((x) => x.id !== first.id);
  assert.equal(second.snippet.title, "Colin's Room Reveal (continued) | Sunshine on a Ranney Day");
  assert.equal(second.bound, 'S-site');
  await sync(g, back, at + 16 * 60e3 + 50e3);
  assert.equal(second.life, 'live');
});

test('cancelled in JobTread: its live is deleted; replaced by another reveal: the new kid gets one', async () => {
  await reset();
  const g = fakeGoogle();
  await sync(g, colin(), T0);
  const [first] = [...g.broadcasts.keys()];
  const work = [];
  await sync(g, { phase: 'idle', broadcastId: null }, T0 + H, { work });
  assert.equal(g.broadcasts.size, 0);
  assert.ok(work.includes('youtube-live-deleted'));
  await sync(g, colin(), T0 + 2 * H);
  const [second] = [...g.broadcasts.keys()];
  await sync(g, { ...colin(), broadcastId: 'live-2', kidSlug: 'maya', kidName: 'Maya', title: "Maya's room reveal", scheduledAt: '2026-12-01T19:00:00.000Z' }, T0 + 3 * H);
  assert.equal(g.broadcasts.has(second), false);
  assert.equal([...g.broadcasts.values()][0].snippet.title, "Maya's Room Reveal | Sunshine on a Ranney Day");
  assert.notEqual(first, second);
});

test('tests on the main feed and rehearsals never reach YouTube', async () => {
  await reset();
  const g = fakeGoogle();
  await sync(g, colin(), T0);
  const before = g.calls.length;
  await sync(g, colin({ phase: 'live', source: 'stream', quiet: true, broadcastId: 'test-1' }), T0 + H, { force: true });
  assert.equal(g.calls.length, before, 'a test on the main feed touches nothing, the reveal\'s live included');
  assert.equal(g.broadcasts.size, 1);
  await reset();
  const g2 = fakeGoogle();
  await sync(g2, colin({ test: true, title: 'TEST · Colin\'s room reveal' }), T0);
  assert.equal(g2.broadcasts.size, 0);
});

test('the key in Settings isn\'t among the channel\'s: nothing made, the go/no-go says why', async () => {
  await reset();
  const g = fakeGoogle();
  g.streams = g.streams.filter((s) => s.id !== 'S-site');
  const rec = await sync(g, colin(), T0);
  assert.equal(g.broadcasts.size, 0);
  assert.match(rec.error, /stream keys/);
  const it = yl.preflightItem(rec, colin(), config);
  assert.equal(it.status, 'fail');
  assert.match(it.detail, /stream keys/);
});

test('YouTube out of quota: kept as the error, tried again at the next look, then made', async () => {
  await reset();
  const g = fakeGoogle();
  g.fail = { match: (m, p) => m === 'POST' && p.endsWith('/liveBroadcasts'), status: 403, reason: 'quotaExceeded' };
  const rec = await sync(g, colin(), T0);
  assert.match(rec.error, /quotaExceeded/);
  assert.equal(g.broadcasts.size, 0);
  const n = g.calls.length;
  await sync(g, colin(), T0 + 5 * 60e3);
  assert.equal(g.calls.length, n, 'not again for 10 minutes');
  g.fail = null;
  const rec2 = await sync(g, colin(), T0 + 11 * 60e3);
  assert.equal(rec2.error, null);
  assert.equal(g.broadcasts.size, 1);
});

test('a live someone deleted on YouTube is made again; one Studio made on the same key is flagged', async () => {
  await reset();
  const g = fakeGoogle();
  await sync(g, colin(), T0);
  g.broadcasts.clear();
  g.broadcasts.set('STUDIO', { id: 'STUDIO', snippet: { title: 'Sunshine on a Ranney Day Live Stream', scheduledStartTime: REVEAL }, contentDetails: { enableAutoStart: true }, privacy: 'public', mfk: true, life: 'ready', bound: 'S-site' });
  const rec = await sync(g, colin(), T0 + 4 * H);
  assert.equal(g.broadcasts.size, 2);
  assert.deepEqual(rec.conflicts.map((c) => c.id), ['STUDIO']);
  assert.equal(g.broadcasts.get('STUDIO').life, 'ready', 'never touched: it isn\'t the site\'s');
});

test('the channel checks read as the channel when there is no API key', async () => {
  const g = fakeGoogle();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (url.includes('/youtube/v3/videos')) { assert.equal(init?.headers?.authorization, 'Bearer at-1'); return new Response(JSON.stringify({ items: [{ statistics: { viewCount: '12', likeCount: '3', commentCount: '1' } }] })); }
    return g.fetch(input, init);
  };
  try {
    const yt = await import('../functions/api/_youtube.js');
    const env = envFor();
    assert.equal(yt.youtubeConfigured(env), true);
    const r = await yt.videoStats(env, 'abcdefghijk');
    assert.deepEqual(r, { ok: true, views: 12, likes: 3, comments: 1 });
    assert.equal(yt.youtubeConfigured({}), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
