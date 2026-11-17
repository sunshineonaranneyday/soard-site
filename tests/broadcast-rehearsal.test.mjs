/**
 * The staff rehearsal of the live page (functions/api/_broadcast-rehearsal.js)
 * Run: node --test tests/broadcast-rehearsal.test.mjs
 *
 * The rehearsal feed drives a private copy of the live page through the reveal's phases with the reveal's own
 * transitions, and nothing of it reaches the real reveal: its state, its hub, its messages, Facebook, Kit, email.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const travel = (ms) => { offset += ms; };
const S = 1000, M = 60e3, H = 3600e3;

// ─── Fake network: Stream's lifecycle of each input, Stream's API for the recording; anything else is noted ──
const feeds = { rehearsalIn: { live: false, videoUID: null }, liveIn: { live: false, videoUID: null } };
const videos = new Map(); // uid → { state, created }
const outside = [];
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const lc = url.match(/cloudflarestream\.com\/(\w+)\/lifecycle$/);
  if (lc) { const f = feeds[lc[1]] || { live: false, videoUID: null }; return json({ isInput: true, live: f.live, videoUID: f.live ? f.videoUID : null }); }
  const vid = url.match(/\/accounts\/acct\/stream\/(\w+)$/);
  if (vid) { const v = videos.get(vid[1]); return v ? json({ success: true, result: { uid: vid[1], status: { state: v.state }, created: v.created } }) : json({ success: false, errors: [{ message: 'not found' }] }, 404); }
  outside.push(url);
  return new Response('not expected: ' + url, { status: 599 });
};

const hub = { calls: [] };
const LIVE_HUB = { idFromName: () => 'main', get: () => ({ async fetch(u, init = {}) { hub.calls.push({ path: new URL(u).pathname, body: init.body }); return Response.json({ ok: true }); } }) };
// The message screening models: both say yes (the guard by name, the judge otherwise)
const AI = { async run(model) { return { response: /guard/i.test(model) ? { safe: true } : { ok: true } }; } };

let env, r, b, msgs, wp;
before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare('INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)').bind('dylan-2026', JSON.stringify({ name: 'Dylan', slug: 'dylan-2026', heroImage: 'kids/dylan/hero' }), 'Dylan', 2026, 'in-progress').run();
  await DB.prepare('INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)').bind('max', JSON.stringify({ name: 'Max', slug: 'max', heroImage: 'kids/max/hero' }), 'Max', 2026, 'in-progress').run();
  env = { DB, LIVE_HUB, AI, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok' };
  b = await import('../functions/api/_broadcast.js');
  r = await import('../functions/api/_broadcast-rehearsal.js');
  msgs = await import('../functions/api/_live-messages.js');
  wp = await import('../functions/live/_watch-party.js');
  await b.ensureSchema(DB);
  // The real reveal: Dylan tomorrow, on the real input; the rehearsal feed set up beside it
  const config = { ...b.defaultConfig(), customerCode: 'cust', liveInput: { uid: 'liveIn' }, rehearsalInput: { uid: 'rehearsalIn' } };
  await b.writeConfig(DB, config);
  const real = b.tSchedule(b.defaultState(), { kidSlug: 'dylan-2026', kidName: 'Dylan', scheduledAt: new Date(Date.now() + 26 * H).toISOString(), image: 'https://imagedelivery.net/h/kids/dylan/picked/public' }, config);
  await b.writeState(DB, real);
});

const realState = async () => { const s = await b.readState(env.DB); delete s.rev; return s; };
const tick = () => r.rehearsalTick(env, { force: true });

test('no rehearsal: the answer is an empty page, and nothing moves', async () => {
  const p = await r.rehearsalPayload(env);
  assert.equal(p.rehearsal, null);
  assert.equal(p.state.phase, 'idle');
  assert.equal(p.hub, false);
});

test('a rehearsal needs the rehearsal feed and a kid', async () => {
  const cfg = await b.readConfig(env.DB);
  await b.writeConfig(env.DB, { ...cfg, rehearsalInput: null });
  assert.equal((await r.startRehearsal(env, { kidSlug: 'dylan-2026', minutes: 10 })).ok, false);
  await b.writeConfig(env.DB, cfg);
  assert.equal((await r.startRehearsal(env, { kidSlug: 'nobody', minutes: 10 })).ok, false);
});

let realBefore;
test('starting: the reveal as viewers will see it, its words and picked photo when it is the same kid', async () => {
  realBefore = await realState();
  const s = await r.startRehearsal(env, { kidSlug: 'dylan-2026', minutes: 10, by: 'peter@soardcharity.com' });
  assert.equal(s.ok, true);
  const p = await r.rehearsalPayload(env, { tick: false });
  assert.equal(p.state.phase, 'armed', 'ten minutes out is inside the half hour, as the reveal would be');
  assert.equal(p.state.kidSlug, 'dylan-2026');
  assert.equal(p.state.title, "Dylan's room reveal");
  assert.equal(p.state.image, 'https://imagedelivery.net/h/kids/dylan/picked/public', 'the real reveal\'s picked photo');
  assert.ok(Math.abs(Date.parse(p.state.scheduledAt) - (Date.now() + 10 * M)) < 5 * S);
  assert.equal(p.state.player, null);
  assert.equal(p.rehearsal.startedBy, 'peter@soardcharity.com');
  assert.match(p.state.id, /^rehearsal-/);
  // Another kid takes the kid's own photo; an unknown "starts in" falls back to ten minutes; an hour out is scheduled
  const max = await r.startRehearsal(env, { kidSlug: 'max', minutes: 60 });
  assert.equal(max.state.image, 'kids/max/hero');
  assert.equal(max.state.phase, 'scheduled');
  assert.equal((await r.startRehearsal(env, { kidSlug: 'max', minutes: 7 })).state.phase, 'armed');
  await r.startRehearsal(env, { kidSlug: 'dylan-2026', minutes: 10 });
});

test('the rehearsal feed arriving takes the page live, playing the rehearsal feed', async () => {
  feeds.rehearsalIn = { live: true, videoUID: 'take1' };
  const t = await tick();
  assert.equal(t.changed, true);
  const p = await r.rehearsalPayload(env, { tick: false });
  assert.equal(p.state.phase, 'live');
  assert.equal(p.state.kidSlug, 'dylan-2026', 'the rehearsal keeps its kid, as a scheduled reveal does');
  assert.deepEqual(p.state.player, { kind: 'live', uid: 'rehearsalIn', customerCode: 'cust' });
  assert.ok(p.state.liveAt);
});

test('the real input going live does nothing to a rehearsal, and the rehearsal does nothing to the reveal', async () => {
  feeds.liveIn = { live: true, videoUID: 'real1' };
  await tick();
  assert.equal((await r.rehearsalPayload(env, { tick: false })).state.player.uid, 'rehearsalIn');
  feeds.liveIn = { live: false, videoUID: null };
  assert.deepEqual(await realState(), realBefore);
});

test('a dropped feed: "Reconnecting" for the grace, back live if it returns, the end after 45 seconds', async () => {
  feeds.rehearsalIn = { live: false, videoUID: null };
  await tick();
  assert.equal((await r.readRehearsal(env.DB)).phase, 'ending');
  feeds.rehearsalIn = { live: true, videoUID: 'take1' };
  await tick();
  assert.equal((await r.readRehearsal(env.DB)).phase, 'live');
  feeds.rehearsalIn = { live: false, videoUID: null };
  await tick();
  travel(20 * S);
  await tick();
  assert.equal((await r.readRehearsal(env.DB)).phase, 'ending', 'still inside the grace');
  travel(30 * S);
  await tick();
  const s = await r.readRehearsal(env.DB);
  assert.equal(s.phase, 'replay');
  assert.ok(s.endedAt && s.replayUntil);
  const p = await r.rehearsalPayload(env, { tick: false });
  assert.equal(p.state.player, null, 'no replay until Stream has the recording');
});

test('the replay: the recording once Stream says it is ready, as the reveal finds its own', async () => {
  videos.set('take1', { state: 'inprogress', created: new Date(Date.now() - 2 * M).toISOString() });
  await tick();
  assert.equal((await r.readRehearsal(env.DB)).replayUid, null);
  videos.set('take1', { state: 'ready', created: new Date(Date.now() - 2 * M).toISOString() });
  await tick();
  const p = await r.rehearsalPayload(env, { tick: false });
  assert.deepEqual(p.state.player, { kind: 'replay', uid: 'take1', customerCode: 'cust' });
});

test('streaming again after the end is a second take: live again, a recording of its own', async () => {
  feeds.rehearsalIn = { live: true, videoUID: 'take2' };
  await tick();
  const s = await r.readRehearsal(env.DB);
  assert.equal(s.phase, 'live');
  assert.equal(s.liveVideoUid, 'take2');
  assert.equal(s.replayUid, null);
  assert.equal(s.endedAt, null);
  assert.equal(s.kidSlug, 'dylan-2026');
});

test('messages: the rehearsal\'s own, never the reveal\'s, never relayed, no stats row', async () => {
  const rehearsal = await r.rehearsalFor(env.DB);
  hub.calls.length = 0;
  const posted = await msgs.postMessage(env, { name: 'Annie', body: 'Testing the messages box', visitorId: 'v'.repeat(20), ip: '', rehearsal });
  assert.equal(posted.status, 'shown');
  assert.equal(hub.calls.filter((c) => c.path === '/relay').length, 0, 'the hub carries the real reveal to everyone: never told');
  const mine = await msgs.listShown(env, { rehearsal });
  assert.equal(mine.messages.length, 1);
  assert.equal(mine.broadcastId, rehearsal.state.broadcastId);
  assert.equal(mine.open, true);
  const realList = await msgs.listShown(env);
  assert.equal(realList.messages.length, 0, 'the reveal\'s messages are untouched');
  const events = await env.DB.prepare('SELECT COUNT(*) AS n FROM broadcast_events WHERE broadcast_id = ?').bind(rehearsal.state.broadcastId).first('n');
  assert.equal(Number(events), 0);
});

test('two staff pages asking at once: a save never lands over a copy another page saved since', async () => {
  // A page reads the rehearsal; before it saves, another page saves a newer copy
  const newer = { ...(await r.readRehearsal(env.DB)), note: 'saved by another page' };
  let reads = 0;
  const DB = {
    prepare(sql) {
      const st = env.DB.prepare(sql);
      if (!/SELECT data FROM site_config WHERE key = \?/.test(sql)) return st;
      return { bind: (...a) => { const bound = st.bind(...a); return { ...bound, first: async (...f) => {
        const row = await bound.first(...f);
        if (a[0] === r.REHEARSAL_KEY && ++reads === 1) await env.DB.prepare('UPDATE site_config SET data = ? WHERE key = ?').bind(JSON.stringify(newer), r.REHEARSAL_KEY).run();
        return row;
      } }; } };
    },
    batch: (x) => env.DB.batch(x),
  };
  feeds.rehearsalIn = { live: false, videoUID: null }; // the feed drops: this page would save 'ending'
  const t = await r.rehearsalTick({ ...env, DB }, { force: true });
  assert.equal(t.changed, false, 'its save found a newer copy and stood back');
  const stored = await r.readRehearsal(env.DB);
  assert.equal(stored.note, 'saved by another page');
  assert.equal(stored.phase, 'live', 'the other page\'s copy stands; the next ask moves it on');
  await tick();
  assert.equal((await r.readRehearsal(env.DB)).phase, 'ending');
});

test('ending it clears it; a rehearsal left on is taken down after 12 hours', async () => {
  await r.endRehearsal(env);
  assert.equal(await r.readRehearsal(env.DB), null);
  await r.startRehearsal(env, { kidSlug: 'max', minutes: 5 });
  travel(13 * H);
  const t = await tick();
  assert.equal(t.state, null);
  assert.equal(await r.readRehearsal(env.DB), null);
});

test('nothing went anywhere but Stream, and the reveal never changed or was announced', async () => {
  assert.deepEqual(outside, []);
  assert.equal(hub.calls.filter((c) => c.path === '/publish').length, 0);
  const s = await realState();
  assert.equal(s.kidSlug, realBefore.kidSlug);
  assert.equal(s.phase, realBefore.phase);
  assert.equal(s.broadcastId, realBefore.broadcastId);
});

test("the starting-soon screen's address carries the rehearsal, as the page script builds it", () => {
  assert.equal(wp.slateFor('dylan-2026', 'portrait'), '/live/dylan-2026/slate/?embed=1&music=0&o=portrait');
  assert.equal(wp.slateFor('dylan-2026', 'portrait', true), '/live/dylan-2026/slate/?embed=1&music=0&o=portrait&rehearsal');
  const pub = { phase: 'armed', kidSlug: 'dylan-2026', scheduledAt: new Date(Date.now() + 5 * M).toISOString(), orientation: 'portrait', player: null };
  assert.equal(wp.watchParty(pub, { pageKid: 'dylan-2026', kidPublished: true, rehearsal: true }).slate, '/live/dylan-2026/slate/?embed=1&music=0&o=portrait&rehearsal');
  assert.equal(wp.watchParty(pub, { pageKid: 'dylan-2026', kidPublished: true }).slate, '/live/dylan-2026/slate/?embed=1&music=0&o=portrait');
});

test('only signed-in staff: the rehearsal endpoint and a rehearsal\'s messages refuse anyone else', async () => {
  const mw = await import('../functions/api/_middleware.js');
  const ep = await import('../functions/api/live-messages.js');
  const gate = (path, init = {}) => mw.onRequest({
    request: new Request(`https://sunshineonaranneyday.com${path}`, init),
    env: { ...env, CF_ACCESS_TEAM_DOMAIN: 'soard.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' },
    next: async () => new Response('reached the handler'),
    data: {},
    waitUntil: () => {},
  });
  for (const path of ['/api/broadcast-rehearsal', '/api/broadcast-rehearsal?options']) {
    const res = await gate(path);
    assert.equal(res.status, 403, `${path} without a sign-in`);
    assert.notEqual(await res.text(), 'reached the handler');
  }
  const post = await gate('/api/broadcast-rehearsal', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://sunshineonaranneyday.com' }, body: '{"action":"start","kidSlug":"max"}' });
  assert.equal(post.status, 403);
  // The messages endpoint is public; its rehearsal branch checks the sign-in itself
  await r.startRehearsal(env, { kidSlug: 'max', minutes: 5 });
  const list = await ep.onRequestGet({ env, request: new Request('https://sunshineonaranneyday.com/api/live-messages?rehearsal') });
  assert.equal(list.status, 403);
  const sent = await ep.onRequestPost({ env, request: new Request('https://sunshineonaranneyday.com/api/live-messages?rehearsal', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://sunshineonaranneyday.com' }, body: JSON.stringify({ name: 'Ana', body: 'Hello there' }) }) });
  assert.equal(sent.status, 403);
  // and the reveal's own messages still answer as always
  assert.equal((await ep.onRequestGet({ env, request: new Request('https://sunshineonaranneyday.com/api/live-messages') })).status, 200);
  await r.endRehearsal(env);
});

test('a link shared from a rehearsal is the public page\'s, never the rehearsal\'s', async () => {
  const { shareable } = await import('../src/utils/live-stats.ts');
  assert.equal(shareable('https://sunshineonaranneyday.com/live/dylan-2026/?rehearsal'), 'https://sunshineonaranneyday.com/live/dylan-2026/');
  assert.equal(shareable('https://sunshineonaranneyday.com/live/dylan-2026/?rehearsal&src=qr&utm_source=fb'), 'https://sunshineonaranneyday.com/live/dylan-2026/');
  assert.equal(shareable('https://sunshineonaranneyday.com/live/dylan-2026/?x=1'), 'https://sunshineonaranneyday.com/live/dylan-2026/?x=1');
});
