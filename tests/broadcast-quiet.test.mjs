/**
 * Test mode ("Test the main feed (no emails, no Facebook)") — scenario tests
 * A phone on the main feed while the switch is on shows on the website as the
 * planned reveal would, and nothing else happens; when it stops, the planned
 * reveal is back exactly as it was.
 * Run: node --test tests/broadcast-quiet.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { fakeKitTags } from './lib/fake-kit-tags.mjs';

const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const travel = (ms) => { offset += ms; };
const H = 3600e3, M = 60e3, S = 1000;

// ─── Fake network ───────────────────────────────────────────────────
const sim = { live: false, videoUID: null, videoState: 'live-inprogress', inputState: null };
// Stream's outputs on the main feed: Facebook's persistent key (on) and an old YouTube one someone paused in Settings
const outputs = new Map([['fbout', { uid: 'fbout', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', enabled: true }], ['ytout', { uid: 'ytout', url: 'rtmp://a.rtmp.youtube.com/live2', enabled: false }]]);
let outputsFail = false;
const calls = [];
const kit = { subs: new Map(), posts: [], nextId: 500 };
const kitTags = fakeKitTags();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || input?.href || input);
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  calls.push({ url, method, body: init.body });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('cloudflarestream.com/') && url.endsWith('/lifecycle')) return json({ isInput: true, videoUID: sim.live ? sim.videoUID : null, live: sim.live });
  if (url.includes('cloudflarestream.com/') && url.endsWith('/views')) return json({ liveViewers: 2 });
  if (url.startsWith('https://api.cloudflare.com/client/v4/accounts/acct/stream/live_inputs') && method === 'POST' && !url.includes('/outputs')) {
    return json({ success: true, result: { uid: 'in1', created: new Date().toISOString(), meta: { name: 'SOARD reveals' }, rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey: 'rtmpkey123456789' }, srt: { url: 'srt://live.cloudflare.com:778', streamId: 'sid123456789', passphrase: 'pass123456789' }, recording: { mode: 'automatic' }, enabled: true } });
  }
  const out = url.match(/\/stream\/live_inputs\/in1\/outputs\/([a-z0-9]+)$/);
  if (out && method === 'PUT') {
    if (outputsFail) return json({ success: false, errors: [{ message: 'Stream is down' }] }, 500);
    const o = outputs.get(out[1]);
    if (!o) return json({ success: false, errors: [{ message: 'not found' }] }, 404);
    o.enabled = JSON.parse(init.body).enabled;
    return json({ success: true, result: o });
  }
  if (url.includes('/stream/live_inputs/in1/outputs') && method === 'POST') { const uid = `apiout${outputs.size}`; outputs.set(uid, { uid, enabled: true }); return json({ success: true, result: { uid } }); }
  if (url.includes('/stream/live_inputs/in1/outputs')) return outputsFail ? json({ success: false }, 500) : json({ success: true, result: [...outputs.values()].map((o) => ({ ...o })) });
  if (url.includes('/stream/live_inputs/in1/videos')) return json({ success: true, result: [] });
  if (url.includes('/stream?per_page=1')) return json({ success: true, result: [] });
  // The input's own status: Stream records a disconnect at once (the public lifecycle can lag minutes behind)
  if (url.includes('/stream/live_inputs/in1')) return json({ success: true, result: { uid: 'in1', status: { current: { state: sim.inputState || (sim.live ? 'connected' : 'disconnected') } } } });
  if (/\/stream\/vid\d\/captions\//.test(url)) return json({ success: true, result: {} });
  if (/\/stream\/vid\d$/.test(url)) return json({ success: true, result: { uid: url.split('/').pop(), status: { state: sim.videoState } } });
  if (url.startsWith('https://graph.facebook.com/')) {
    if (method === 'POST' && url.includes('/live_videos')) return json({ id: 'fblive1', secure_stream_url: 'rtmps://live-api-s.facebook.com:443/rtmp/FB-123?s_bl=1' });
    return json({ data: [] });
  }
  if (url.startsWith('https://api.resend.com/')) return json({ data: [] });
  if (url.startsWith('https://api.kit.com/v4/')) {
    const body = init.body && init.body !== '{}' ? JSON.parse(init.body) : null;
    const tagged = await kitTags.answer(url, method, body);
    if (tagged) return tagged;
    const path = url.replace('https://api.kit.com/v4', '').split('?')[0];
    if (path === '/subscribers' && method === 'POST') {
      const sub = kit.subs.get(body.email_address) || { id: kit.nextId++, email_address: body.email_address, state: 'active' };
      kit.subs.set(body.email_address, sub);
      return json({ subscriber: sub }, 201);
    }
    if (path === '/broadcasts' && method === 'POST') { kit.posts.push(body); return json({ broadcast: { id: 9000 + kit.posts.length } }, 201); }
    return json({ broadcasts: [], subscribers: [], pagination: {} });
  }
  if (url.startsWith('https://hook.test/')) return new Response('ok', { status: 200 });
  return new Response('not mocked: ' + url, { status: 599 });
};

const LIVE_HUB = {
  idFromName: () => 'main',
  get: () => ({ async fetch(url) { const path = new URL(url).pathname; return path === '/publish' || path === '/status' ? Response.json({ ok: true, clients: 1 }) : new Response('nf', { status: 404 }); } }),
};

let env, b;
const tick = () => b.runTick(env, { source: 'test', force: true });
const since = (n) => calls.slice(n);
// Anything that would reach a person or a public place outside the website
const outward = (list) => list.filter((c) => c.url.startsWith('https://graph.facebook.com/') && c.method !== 'GET'
  || c.url.startsWith('https://api.resend.com/')
  || c.url.startsWith('https://hook.test/')
  || (c.url.startsWith('https://api.kit.com/v4/broadcasts') && c.method === 'POST')
  || (c.url.startsWith('https://api.kit.com/v4/tags') && c.method === 'POST'));

before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare(`INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)`).bind('remi', JSON.stringify({ name: 'Remi', slug: 'remi', heroImage: 'kids/remi/hero' }), 'Remi', 2026, 'in-progress').run();
  env = { DB, LIVE_HUB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok', RESEND_API_KEY: 're_test', KIT_API_KEY: 'kit_test', CF_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy', SLACK_WEBHOOK_URL: 'https://hook.test/slack', FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'fbtok', ALERT_EMAILS: 'staff@test' };
  b = await import('../functions/api/_broadcast.js');
  await b.ensureSchema(DB);
  const cfg = await b.readConfig(DB);
  cfg.liveInput = { uid: 'in1' };
  cfg.facebook = { mode: 'api', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay' };
  cfg.outputs = { facebook: { uid: 'fbout', enabled: true }, youtube: { uid: 'ytout', enabled: false } };
  cfg.reels = { ...cfg.reels, enabled: true };
  await b.writeConfig(DB, cfg);
  // Someone signed up for every reveal (already in Kit as a reveal sign-up)
  await DB.prepare(`INSERT INTO broadcast_reminders (id, channel, address, kid_slug, token, created_at, confirmed_at) VALUES ('r1', 'email', 'fan@example.com', NULL, 'tok1', ?, ?)`).bind(new Date().toISOString(), new Date().toISOString()).run().catch(() => {});
});

after(() => { Date.now = realNow; globalThis.fetch = realFetch; });

let planned;

test('a reveal is scheduled for Remi in two days', async () => {
  const r = await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * 24 * H).toISOString() }, 'peter@test');
  assert.equal(r.success, true, r.error);
  planned = await b.readState(env.DB);
  assert.equal(planned.phase, 'scheduled');
  assert.equal(r.quiet.on, false, 'test mode starts off');
});

test('turning test mode on pauses Facebook in Stream (only what was on) and lasts 2 hours', async () => {
  const r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, true, r.error);
  assert.equal(r.quiet.on, true);
  assert.ok(Math.abs(Date.parse(r.quiet.until) - (Date.now() + 2 * H)) < 5 * S, 'two hours from now');
  assert.equal(outputs.get('fbout').enabled, false, 'Facebook paused');
  assert.equal(outputs.get('ytout').enabled, false, 'YouTube was already off');
  const q = await b.readQuiet(env.DB);
  assert.deepEqual(q.paused, ['fbout'], 'only the one it paused is remembered');
  assert.equal((await b.readState(env.DB)).broadcastId, planned.broadcastId, 'the planned reveal is untouched');
});

test('phone on the main feed: the website shows the reveal live, and nothing else happens', async () => {
  const n = calls.length; const posts = kit.posts.length;
  sim.live = true; sim.videoUID = 'vid1';
  let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  assert.equal(r.state.phase, 'live');
  assert.equal(r.state.live, true);
  assert.equal(r.state.kidSlug, 'remi', 'the live page is Remi’s, as tomorrow');
  assert.equal(r.state.kidName, 'Remi');
  assert.equal(r.state.player?.kind, 'live', 'the website plays the main feed');
  assert.equal(r.state.url, 'https://sunshineonaranneyday.com/live/remi/');
  assert.equal(r.state.test, undefined, 'the public sees it exactly as a reveal');
  const st = await b.readState(env.DB);
  assert.ok(st.quiet, 'marked as a test');
  assert.notEqual(st.broadcastId, planned.broadcastId, 'a broadcast of its own');
  assert.equal(st.resume.broadcastId, planned.broadcastId, 'carries the planned reveal');
  // Several minutes live: past the Kit list's 3 steady minutes and the checks' intervals
  for (const step of [70 * S, 70 * S, 70 * S, 70 * S]) { travel(step); r = await tick(); assert.equal(r.state.phase, 'live'); }
  assert.deepEqual(outward(since(n)), [], 'no emails, Facebook, Slack or deploys');
  assert.equal(kit.posts.length, posts, 'nothing from Kit');
  const sends = await env.DB.prepare('SELECT * FROM broadcast_sends WHERE broadcast_id = ?').bind(st.broadcastId).all();
  assert.equal(sends.results.length, 0, 'no sends claimed');
  const row = await env.DB.prepare('SELECT id FROM broadcasts WHERE id = ?').bind(st.broadcastId).first();
  assert.equal(row, null, 'History never lists a test');
  assert.equal(outputs.get('fbout').enabled, false, 'Facebook still paused');
  const audit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'live-status' AND action = 'published'`).first();
  assert.equal(audit.n, 0, 'no "Live now" announcement');
});

test('Kit "we\'re live" by hand is refused during a test', async () => {
  const r = await b.adminAction(env, 'sendKitLive', {}, 'peter@test');
  assert.equal(r.success, false);
  assert.match(r.error, /test/);
});

test('turning the switch off mid-test keeps that test quiet until the phone stops', async () => {
  const r = await b.adminAction(env, 'quietTest', { on: false }, 'peter@test');
  assert.equal(r.success, true, r.error);
  assert.equal(r.quiet.on, false);
  assert.equal(outputs.get('fbout').enabled, false, 'Facebook stays paused while the test streams');
  travel(31 * S);
  const t = await tick();
  assert.equal(t.state.phase, 'live');
  assert.ok((await b.readState(env.DB)).quiet, 'still a test');
});

test('phone stops: the planned reveal comes back exactly, Facebook comes back, nothing saved to the kid', async () => {
  const n = calls.length;
  sim.live = false; sim.videoState = 'ready';
  let r = await tick();
  assert.equal(r.state.phase, 'ending', 'the usual 45 s grace');
  travel(50 * S);
  r = await tick();
  assert.ok(r.work.includes('test-ended'), r.work.join(','));
  assert.equal(r.state.phase, 'scheduled');
  const st = await b.readState(env.DB);
  assert.equal(st.broadcastId, planned.broadcastId);
  assert.equal(st.scheduledAt, planned.scheduledAt);
  assert.equal(st.liveAt, null);
  assert.equal(st.quiet, undefined);
  assert.equal(st.resume, undefined);
  assert.equal(outputs.get('fbout').enabled, true, 'Facebook back on');
  assert.equal(outputs.get('ytout').enabled, false, 'the one paused in Settings stays paused');
  assert.deepEqual((await b.readQuiet(env.DB)).paused, []);
  travel(40 * S);
  r = await tick();
  assert.equal(r.state.phase, 'scheduled');
  const kid = JSON.parse((await env.DB.prepare('SELECT data FROM kids WHERE slug = ?').bind('remi').first()).data);
  assert.equal(kid.revealVideoUrl, undefined, 'the test recording is not on Remi’s page');
  assert.deepEqual(outward(since(n)), [], 'no replay email, deploy or Reel');
});

test('End the test by hand puts the reveal back and keeps the switch on 10 more minutes', async () => {
  let r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, true, r.error);
  sim.live = true; sim.videoUID = 'vid2'; sim.videoState = 'live-inprogress';
  travel(5 * S);
  const t = await tick();
  assert.ok(t.work.includes('test-start'), t.work.join(','));
  travel(110 * M); // the switch's own 2 hours are nearly up
  r = await b.adminAction(env, 'endNow', {}, 'peter@test');
  assert.equal(r.success, true, r.error);
  assert.equal(r.state.phase, 'scheduled');
  assert.equal((await b.readState(env.DB)).broadcastId, planned.broadcastId);
  assert.ok(Date.parse(r.quiet.until) >= Date.now() + 9 * M, 'switch kept on');
  // The phone is still connected: it starts another test, never the reveal
  travel(5 * S);
  const again = await tick();
  assert.ok(again.work.includes('test-start'), again.work.join(','));
  sim.live = false;
  await tick(); travel(50 * S); await tick();
  assert.equal((await b.readState(env.DB)).phase, 'scheduled');
});

test('the switch turns itself off: Facebook comes back and the next phone is the real thing', async () => {
  travel(11 * M);
  const r = await tick();
  assert.equal(r.state.phase, 'scheduled');
  assert.equal(outputs.get('fbout').enabled, true, 'Facebook back on by itself');
  const status = b.quietStatus(await b.readQuiet(env.DB), await b.readState(env.DB));
  assert.equal(status.on, false);
});

test('a reveal under 35 minutes away refuses test mode; one a little further clips it to 30 minutes before', async () => {
  const at = Date.parse(planned.scheduledAt);
  travel(at - Date.now() - 34 * M);
  let r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, false);
  assert.match(r.error, /rehearsal feed/);
  travel(-30 * M); // 64 minutes before
  r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, true, r.error);
  assert.equal(Date.parse(r.quiet.until), at - 30 * M, 'off 30 minutes before the reveal');
});

test('a test still streaming at 30 minutes before becomes the reveal: emails, Facebook and all', async () => {
  const posts = kit.posts.length;
  sim.live = true; sim.videoUID = 'vid3';
  travel(5 * S);
  let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  assert.equal(outputs.get('fbout').enabled, false);
  travel(35 * M); // now 29 minutes before
  r = await tick();
  assert.ok(r.work.includes('test-became-reveal'), r.work.join(','));
  const st = await b.readState(env.DB);
  assert.equal(st.broadcastId, planned.broadcastId, 'the planned reveal is live');
  assert.equal(st.quiet, undefined);
  assert.equal(st.phase, 'live');
  assert.equal(outputs.get('fbout').enabled, true, 'Facebook back on for the reveal');
  assert.ok(r.work.includes('fb-live-post'), `Facebook post made: ${r.work.join(',')}`);
  const live = await env.DB.prepare(`SELECT * FROM broadcast_sends WHERE broadcast_id = ? AND kind = 'live'`).bind(st.broadcastId).first();
  assert.ok(live, 'the sign-ups get "we\'re live"');
  assert.ok(kit.posts.length > posts, 'from Kit');
  const row = await env.DB.prepare('SELECT phase FROM broadcasts WHERE id = ?').bind(st.broadcastId).first();
  assert.equal(row.phase, 'live', 'History shows the reveal');
});

test('test mode can\'t be turned on while a reveal is live', async () => {
  const r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, false);
  assert.match(r.error, /live right now/);
});

test('with nothing planned, a test goes back to idle; a Stream failure keeps the switch off', async () => {
  sim.live = false;
  await tick(); travel(50 * S); await tick();
  await b.adminAction(env, 'reset', {}, 'peter@test');
  outputsFail = true;
  let r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, false);
  assert.match(r.error, /stayed off/);
  assert.equal(b.quietStatus(await b.readQuiet(env.DB), await b.readState(env.DB)).on, false);
  outputsFail = false;
  r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, true, r.error);
  sim.live = true; sim.videoUID = 'vid4';
  travel(5 * S);
  const t = await tick();
  assert.ok(t.work.includes('test-start'), t.work.join(','));
  assert.equal(t.state.kidSlug, null);
  sim.live = false;
  await tick(); travel(50 * S);
  const end = await tick();
  assert.equal(end.state.phase, 'idle');
});

test('the phone stopping ends it 45 seconds later even while Stream\'s public status still says live', async () => {
  // Nov 17: the phone stopped at 2:21:42 and Stream's lifecycle said live for over 4 minutes more
  sim.live = true; sim.videoUID = 'vid5'; sim.inputState = 'connected';
  travel(5 * S);
  let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  sim.inputState = 'disconnected'; // the lifecycle (sim.live) still says live
  r = await tick();
  assert.equal(r.state.phase, 'ending', 'the disconnect is seen at once');
  sim.inputState = 'connected'; // a cell hiccup: back within the grace
  r = await tick();
  assert.equal(r.state.phase, 'live', 'reconnects as usual');
  sim.inputState = 'disconnected';
  r = await tick();
  assert.equal(r.state.phase, 'ending');
  travel(50 * S);
  r = await tick();
  assert.ok(r.work.includes('test-ended'), r.work.join(','));
  assert.equal(r.state.phase, 'idle');
  travel(5 * S);
  r = await tick();
  assert.equal(r.state.phase, 'idle', 'a lifecycle that is only catching up starts nothing');
  sim.live = false; sim.inputState = null;
  travel(5 * S);
  r = await tick();
  assert.equal(r.state.phase, 'idle');
});
