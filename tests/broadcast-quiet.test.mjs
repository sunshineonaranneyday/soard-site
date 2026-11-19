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
const sim = { live: false, videoUID: null, videoState: 'live-inprogress', inputState: null, inputSince: null };
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
  if (url.includes('/stream/live_inputs/in1')) return json({ success: true, result: { uid: 'in1', status: { current: { state: sim.inputState || (sim.live ? 'connected' : 'disconnected'), statusEnteredAt: sim.inputSince || undefined } } } });
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

// What the hub was told (every publish's body), so a test can see the open pages hear a change at once
const hubPublishes = [];
const LIVE_HUB = {
  idFromName: () => 'main',
  get: () => ({ async fetch(url, init) { const path = new URL(url).pathname; if (path === '/publish') { try { hubPublishes.push(JSON.parse(init?.body || '{}')); } catch { /* not ours */ } } return path === '/publish' || path === '/status' ? Response.json({ ok: true, clients: 1 }) : new Response('nf', { status: 404 }); } }),
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
  cfg.facebook = { mode: 'api', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay', scheduleAhead: false }; // test mode itself; scheduled lives around a test: broadcast-fb-plan.test.mjs
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
  // (Stream still finishing the recording when the test ends: its replay comes a little later)
  sim.live = false; sim.videoState = 'live-inprogress';
  let r = await tick();
  assert.equal(r.state.phase, 'ending', 'the usual 45 s grace');
  travel(50 * S);
  r = await tick();
  assert.ok(r.work.includes('test-ended'), r.work.join(','));
  // The public page: straight back to the countdown, never "the reveal just ended" (Peter, Nov 18 2026)
  assert.equal(r.state.phase, 'scheduled');
  assert.equal(r.state.testEnded, undefined);
  assert.ok(Date.parse(r.state.testEndUntil) > Date.now(), 'a staff page is told to ask for the test\'s end');
  // Signed-in staff see the test's end as the reveal's will: ended, "That's the reveal!", its replay to come
  let staff = b.testEndPublicState(await b.readState(env.DB), await b.readConfig(env.DB));
  assert.equal(staff.phase, 'replay');
  assert.equal(staff.testEnded, true);
  assert.equal(staff.kidName, 'Remi');
  assert.equal(staff.player, null, 'the replay comes once Stream has the recording ready');
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'scheduled', 'underneath, the planned reveal is back as it was');
  assert.equal(st.broadcastId, planned.broadcastId);
  assert.equal(st.scheduledAt, planned.scheduledAt);
  assert.equal(st.liveAt, null);
  assert.equal(st.quiet, undefined);
  assert.equal(st.resume, undefined);
  assert.equal(outputs.get('fbout').enabled, true, 'Facebook back on');
  assert.equal(outputs.get('ytout').enabled, false, 'the one paused in Settings stays paused');
  assert.deepEqual((await b.readQuiet(env.DB)).paused, []);
  sim.videoState = 'ready';
  travel(40 * S);
  r = await tick();
  assert.equal(r.state.phase, 'scheduled', 'the public page still on the countdown');
  staff = b.testEndPublicState(await b.readState(env.DB), await b.readConfig(env.DB));
  assert.equal(staff.phase, 'replay');
  assert.deepEqual(staff.player, { kind: 'replay', uid: 'vid1', customerCode: staff.player?.customerCode }, 'the test recording, as the replay');
  // Ten minutes after the end, the countdown again
  travel(10 * M);
  r = await tick();
  assert.ok(r.work.includes('test-end-over'), r.work.join(','));
  assert.equal(r.state.phase, 'scheduled');
  assert.equal(r.state.testEndUntil, undefined);
  assert.equal(b.testEndPublicState(await b.readState(env.DB), await b.readConfig(env.DB)), null, 'staff are back on the countdown too');
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
  assert.equal(r.state.phase, 'scheduled', 'the public page: straight back to the countdown');
  assert.equal((b.testEndPublicState(await b.readState(env.DB), await b.readConfig(env.DB))).testEnded, true, 'staff see the end as the reveal will');
  assert.equal((await b.readState(env.DB)).phase, 'scheduled');
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

test('a test still streaming at 30 minutes before becomes the reveal: Facebook and all, and the "we\'re live" emails at its start time', async () => {
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
  // "We're live" waits for the planned start (Nov 19 2026): before it, a phone may still be a framing check
  const liveSend = () => env.DB.prepare(`SELECT * FROM broadcast_sends WHERE broadcast_id = ? AND kind = 'live'`).bind(st.broadcastId).first();
  assert.equal(await liveSend(), null, 'nobody emailed 29 minutes early');
  travel(29 * M + 5 * S); r = await tick();
  assert.ok(await liveSend(), 'the sign-ups get "we\'re live" at the start');
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
  assert.equal((b.testEndPublicState(await b.readState(env.DB), await b.readConfig(env.DB))).testEnded, true);
  assert.equal((await b.readState(env.DB)).phase, 'idle');
  travel(11 * M);
  assert.equal((await tick()).state.phase, 'idle');
});

test('the phone stopping ends it 45 seconds later even while Stream\'s public status still says live', async () => {
  // Nov 17: the phone stopped at 2:21:42 and Stream's lifecycle said live for 18 minutes more
  const stop = () => { sim.inputState = 'disconnected'; sim.inputSince = new Date(Date.now()).toISOString(); };
  const back = () => { sim.inputState = 'connected'; sim.inputSince = new Date(Date.now()).toISOString(); };
  sim.live = true; sim.videoUID = 'vid5'; back();
  travel(5 * S);
  let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  const segment = (await b.readState(env.DB)).segmentAt;
  // A weak-signal blip: disconnected for 8 seconds, then back. The lifecycle (sim.live) never noticed
  stop(); travel(8 * S);
  r = await tick();
  assert.equal(r.state.phase, 'live', 'a few seconds off is not a stop');
  back(); travel(2 * S);
  r = await tick();
  assert.equal(r.state.phase, 'live');
  assert.ok(Date.parse((await b.readState(env.DB)).segmentAt) > Date.parse(segment), 'a gap breaks the unbroken stretch: the Kit list email\'s 3 minutes start again');
  // The phone really stops; the lifecycle keeps saying live
  stop(); const stoppedAt = Date.now();
  travel(5 * S);
  r = await tick();
  assert.equal(r.state.phase, 'live', 'not yet: could still be a blip');
  travel(11 * S);
  r = await tick();
  assert.equal(r.state.phase, 'ending', 'seen once it has lasted 15 seconds');
  assert.equal(Date.parse((await b.readState(env.DB)).disconnectedAt), stoppedAt, 'the grace runs from the real stop');
  travel(30 * S); // 46 s after the stop
  r = await tick();
  assert.ok(r.work.includes('test-ended'), r.work.join(','));
  assert.equal(r.state.phase, 'idle', 'the public page: back to what it was');
  assert.equal((b.testEndPublicState(await b.readState(env.DB), await b.readConfig(env.DB))).phase, 'replay', 'staff see its end');
  assert.equal((await b.readState(env.DB)).phase, 'idle');
  travel(5 * S);
  r = await tick();
  assert.ok(!r.work.includes('test-start'), 'a lifecycle that is only catching up starts nothing');
  assert.equal((await b.readState(env.DB)).phase, 'idle', 'a lifecycle that is only catching up starts nothing');
  sim.live = false; sim.inputState = null; sim.inputSince = null;
  travel(5 * S);
  r = await tick();
  assert.equal((await b.readState(env.DB)).phase, 'idle');
  travel(11 * M);
  r = await tick();
  assert.equal(r.state.phase, 'idle');
  assert.equal(b.testEndPublicState(await b.readState(env.DB), await b.readConfig(env.DB)), null, 'ten minutes on, staff are back to what it was too');
});

test('a test\'s end, for staff: never into the half hour before a planned reveal, and a new test or reveal replaces it', async () => {
  const s = b.defaultState();
  const now = Date.now();
  const test = { ...s, phase: 'live', source: 'stream', quiet: { at: new Date(now - 5 * M).toISOString() }, broadcastId: 'bt1', kidSlug: 'remi', kidName: 'Remi', liveAt: new Date(now - 5 * M).toISOString(), liveVideoUid: 'vidT', recordings: ['vidT'] };
  // A planned reveal 2 hours away: the end shows for 10 minutes
  const far = b.tEndQuiet({ ...test, resume: { ...s, phase: 'scheduled', broadcastId: 'bp', kidSlug: 'remi', scheduledAt: new Date(now + 2 * H).toISOString() } }, null, now);
  assert.equal(far.phase, 'scheduled');
  assert.equal(Date.parse(far.testEnd.until), now + 10 * M);
  const pub = b.publicState(far, { customerCode: 'cc' });
  assert.equal(pub.phase, 'scheduled', 'the public page keeps the countdown');
  assert.equal(pub.testEndUntil, far.testEnd.until, 'and only tells a staff page to ask');
  const shown = b.testEndPublicState(far, { customerCode: 'cc' });
  assert.equal(shown.phase, 'replay');
  assert.equal(shown.testEnded, true);
  assert.equal(shown.id, 'bt1', 'the test\'s own broadcast, so the page knows its video moved on');
  assert.equal(shown.player, null);
  assert.equal(b.testEndPublicState({ ...far, testEnd: { ...far.testEnd, replayUid: 'vidT' } }, { customerCode: 'cc' }).player.uid, 'vidT');
  // A planned reveal 40 minutes away: the end shows only until 30 minutes before it
  const near = b.tEndQuiet({ ...test, resume: { ...s, phase: 'scheduled', broadcastId: 'bp', scheduledAt: new Date(now + 40 * M).toISOString() } }, null, now);
  assert.equal(Date.parse(near.testEnd.until), now + 10 * M);
  const nearer = b.tEndQuiet({ ...test, resume: { ...s, phase: 'scheduled', broadcastId: 'bp', scheduledAt: new Date(now + 35 * M).toISOString() } }, null, now);
  assert.equal(Date.parse(nearer.testEnd.until), now + 5 * M);
  // 30 minutes away (armed): nothing shown, the countdown at once
  const armed = b.tEndQuiet({ ...test, resume: { ...s, phase: 'armed', broadcastId: 'bp', scheduledAt: new Date(now + 30 * M).toISOString() } }, null, now);
  assert.equal(armed.testEnd, null);
  assert.equal(b.publicState(armed, { customerCode: 'cc' }).phase, 'armed');
  assert.equal(b.publicState(armed, { customerCode: 'cc' }).testEndUntil, undefined);
  assert.equal(b.testEndPublicState(armed, { customerCode: 'cc' }), null);
  // A test with no recording shows no end
  assert.equal(b.tEndQuiet({ ...test, liveVideoUid: null, recordings: [] }, null, now).testEnd, null);
  // A new test, or the real reveal, replaces it
  assert.equal(b.tStartQuiet(far, { videoUid: 'vidU' }, { defaults: {} }).testEnd, null);
  assert.equal(b.tStartQuiet(far, { videoUid: 'vidU' }, { defaults: {} }).resume.testEnd, null);
  assert.equal(b.tStartLive(far, { videoUid: 'vidV', source: 'stream' }, { defaults: {} }).testEnd, null);
});

test('a test\'s end reaches signed-in staff only: /api/broadcast-test-end refuses anyone else, staff get the end', async () => {
  const mw = await import('../functions/api/_middleware.js');
  const ep = await import('../functions/api/broadcast-test-end.js');
  const gate = (path) => mw.onRequest({
    request: new Request(`https://sunshineonaranneyday.com${path}`),
    env: { ...env, CF_ACCESS_TEAM_DOMAIN: 'soard.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' },
    next: async () => new Response('reached the handler'),
    data: {},
    waitUntil: () => {},
  });
  const res = await gate('/api/broadcast-test-end');
  assert.equal(res.status, 403, 'without a staff sign-in');
  assert.notEqual(await res.text(), 'reached the handler');
  // The public state endpoint stays open to everyone
  assert.equal(await (await gate('/api/broadcast')).text(), 'reached the handler');
  // A test just ended: staff get its end, and the public answer stays on the countdown
  const now = Date.now();
  const s = b.defaultState();
  const ended = b.tEndQuiet({ ...s, phase: 'live', source: 'stream', quiet: { at: new Date(now - 5 * M).toISOString() }, broadcastId: 'bt9', kidSlug: 'remi', kidName: 'Remi', liveAt: new Date(now - 5 * M).toISOString(), liveVideoUid: 'vidT', recordings: ['vidT'],
    resume: { ...s, phase: 'scheduled', broadcastId: 'bp9', kidSlug: 'remi', kidName: 'Remi', scheduledAt: new Date(now + 3 * H).toISOString() } }, 'peter@test', now);
  await b.writeState(env.DB, ended);
  const ctx = { env, request: new Request('https://sunshineonaranneyday.com/api/broadcast-test-end'), waitUntil: () => {} };
  const staff = await (await ep.onRequestGet(ctx)).json();
  assert.equal(staff.state.phase, 'replay');
  assert.equal(staff.state.testEnded, true);
  assert.equal(staff.state.id, 'bt9');
  assert.equal(staff.state.kidName, 'Remi');
  const pub = (await b.publicPayload(env)).state;
  assert.equal(pub.phase, 'scheduled');
  assert.equal(pub.id, 'bp9');
  assert.equal(pub.testEndUntil, ended.testEnd.until);
  // Its window over: staff get nothing, the public no hint
  travel(11 * M);
  assert.equal((await (await ep.onRequestGet(ctx)).json()).state, null);
  assert.equal((await b.publicPayload(env)).state.testEndUntil, undefined);
});

test('a change noticed by a visitor\'s page (not the hub) reaches every open page at once: the tick publishes it to the hub', async () => {
  // Peter's 2:13 PM test (Nov 18): the site went live 24 s before the pages heard, waiting for the hub's next heartbeat
  sim.live = false; sim.inputState = null; sim.inputSince = null;
  await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  travel(70 * S);
  let r = await b.runTick(env, { source: 'visitor', force: true });
  const before = hubPublishes.length;
  sim.live = true; sim.videoUID = 'vidP'; sim.inputState = 'connected'; sim.inputSince = new Date(Date.now()).toISOString();
  travel(5 * S);
  r = await b.runTick(env, { source: 'visitor', force: true });
  assert.ok(r.changed, `the visitor's tick saw the phone: ${r.work.join(',')}`);
  const sent = hubPublishes.slice(before);
  assert.ok(sent.some((m) => m.state?.live === true), 'the hub was told the page is live, by the visitor\'s tick itself');
  // A tick that changes nothing tells the hub nothing new
  const n = hubPublishes.length;
  travel(3 * S);
  r = await b.runTick(env, { source: 'visitor', force: true });
  if (!r.changed) assert.equal(hubPublishes.length, n, 'nothing changed, nothing published');
  // The hub's own ticks are published by broadcast-hooks.js, not here (no second copy)
  sim.live = false; sim.inputState = 'disconnected'; sim.inputSince = new Date(Date.now()).toISOString();
  travel(5 * S);
  const m = hubPublishes.length;
  r = await b.runTick(env, { source: 'hub:alarm', force: true });
  assert.ok(r.changed, r.work.join(','));
  assert.equal(hubPublishes.length, m, 'the hub\'s own tick is not published again from runTick');
  // tidy: the test ends and the switch goes off
  for (let i = 0; i < 8; i++) { travel(10 * S); await b.runTick(env, { source: 'visitor', force: true }); }
  await b.adminAction(env, 'quietTest', { on: false }, 'peter@test');
});
