/**
 * A reveal whose phone goes quiet is over only if no phone comes back within 15 minutes (REJOIN_MS).
 * A phone back in time picks the same reveal up again: same broadcast, kid and page, nobody told twice.
 * Meanwhile nothing that can't be undone happens: Facebook's post stays open, no "Ended", nothing on
 * the kid's page, no replay email. The replay is the longest recording, not the last piece.
 * Run: node --test tests/broadcast-rejoin.test.mjs
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
const sim = { live: false, videoUID: null, videoState: 'live-inprogress', inputState: null, inputSince: null, inputFail: false, durations: {} };
const outputs = new Map([['fbout', { uid: 'fbout', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', enabled: true }]]);
const calls = [];
const kit = { subs: new Map(), posts: [], nextId: 500 };
const kitTags = fakeKitTags();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || input?.href || input);
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ url, method, body: init.body });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('cloudflarestream.com/') && url.endsWith('/lifecycle')) return json({ isInput: true, videoUID: sim.live ? sim.videoUID : null, live: sim.live });
  if (url.includes('cloudflarestream.com/') && url.endsWith('/views')) return json({ liveViewers: 2 });
  const out = url.match(/\/stream\/live_inputs\/in1\/outputs\/([a-z0-9]+)$/);
  if (out && method === 'PUT') { const o = outputs.get(out[1]); o.enabled = JSON.parse(init.body).enabled; return json({ success: true, result: o }); }
  if (url.includes('/stream/live_inputs/in1/outputs') && method === 'POST') { const uid = `apiout${outputs.size}`; outputs.set(uid, { uid, enabled: true }); return json({ success: true, result: { uid } }); }
  if (url.includes('/stream/live_inputs/in1/outputs')) return json({ success: true, result: [...outputs.values()].map((o) => ({ ...o })) });
  if (url.includes('/stream/live_inputs/in1/videos')) return json({ success: true, result: [] });
  if (url.includes('/stream?per_page=1')) return json({ success: true, result: [] });
  if (url.includes('/stream/live_inputs/in1')) {
    if (sim.inputFail) return json({ success: false, errors: [{ message: 'rate limited' }] }, 429);
    return json({ success: true, result: { uid: 'in1', status: { current: { state: sim.inputState || (sim.live ? 'connected' : 'disconnected'), statusEnteredAt: sim.inputSince || undefined } } } });
  }
  if (/\/stream\/vid\d+\/captions\//.test(url)) return json({ success: true, result: {} });
  const vid = url.match(/\/stream\/(vid\d+)$/);
  if (vid) return json({ success: true, result: { uid: vid[1], created: new Date(Date.now()).toISOString(), duration: sim.durations[vid[1]] ?? 60, status: { state: sim.videoState } } });
  if (url.startsWith('https://graph.facebook.com/')) {
    // Each live post its own id, as Facebook gives
    if (method === 'POST' && url.includes('/live_videos')) return json({ id: `fblive${++fbSeq}`, secure_stream_url: 'rtmps://live-api-s.facebook.com:443/rtmp/FB-123?s_bl=1' });
    return json({ data: [] });
  }
  if (url.startsWith('https://api.resend.com/')) return json({ data: [] });
  if (url.startsWith('https://api.kit.com/v4/')) {
    const body = init.body && init.body !== '{}' ? JSON.parse(init.body) : null;
    const tagged = await kitTags.answer(url, method, body);
    if (tagged) return tagged;
    const path = url.replace('https://api.kit.com/v4', '').split('?')[0];
    if (path === '/subscribers' && method === 'POST') { const sub = kit.subs.get(body.email_address) || { id: kit.nextId++, email_address: body.email_address, state: 'active' }; kit.subs.set(body.email_address, sub); return json({ subscriber: sub }, 201); }
    if (path === '/broadcasts' && method === 'POST') { kit.posts.push(body); return json({ broadcast: { id: 9000 + kit.posts.length } }, 201); }
    return json({ broadcasts: [], subscribers: [], pagination: {} });
  }
  if (url.startsWith('https://hook.test/')) return new Response('ok', { status: 200 });
  return new Response('not mocked: ' + url, { status: 599 });
};
const LIVE_HUB = { idFromName: () => 'main', get: () => ({ async fetch(url) { const p = new URL(url).pathname; return p === '/publish' || p === '/status' ? Response.json({ ok: true, clients: 1 }) : new Response('nf', { status: 404 }); } }) };
let env, b, rs;
const tick = () => b.runTick(env, { source: 'test', force: true });
const outward = (list) => list.filter((c) => (c.url.startsWith('https://graph.facebook.com/') && c.method !== 'GET') || c.url.startsWith('https://api.resend.com/') || c.url.startsWith('https://hook.test/') || (c.url.startsWith('https://api.kit.com/v4/broadcasts') && c.method === 'POST')).map((c) => `${c.method} ${c.url.split('?')[0]}`);
const sends = async (id) => (await env.DB.prepare('SELECT kind, channel FROM broadcast_sends WHERE broadcast_id = ?').bind(id).all()).results.map((r) => `${r.kind}/${r.channel}`);
const iso = () => new Date(Date.now()).toISOString();

before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare(`INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)`).bind('remi', JSON.stringify({ name: 'Remi', slug: 'remi', heroImage: 'kids/remi/hero' }), 'Remi', 2026, 'in-progress').run();
  env = { DB, LIVE_HUB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok', RESEND_API_KEY: 're_test', KIT_API_KEY: 'kit_test', CF_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy', SLACK_WEBHOOK_URL: 'https://hook.test/slack', FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'fbtok', ALERT_EMAILS: 'staff@test' };
  b = await import('../functions/api/_broadcast.js');
  rs = await import('../functions/api/_reveal-stats.js');
  await b.ensureSchema(DB);
  const cfg = await b.readConfig(DB);
  cfg.liveInput = { uid: 'in1' };
  cfg.facebook = { mode: 'api', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay' };
  cfg.outputs = { facebook: { uid: 'fbout', enabled: true } };
  await b.writeConfig(DB, cfg);
  await DB.prepare(`INSERT INTO broadcast_reminders (id, channel, address, kid_slug, token, created_at, confirmed_at) VALUES ('r1', 'email', 'fan@example.com', NULL, 'tok1', ?, ?)`).bind(iso(), iso()).run().catch(() => {});
});
after(() => { Date.now = realNow; globalThis.fetch = realFetch; });



const phoneOn = (vid) => { sim.live = true; sim.videoUID = vid; sim.inputState = 'connected'; sim.inputSince = iso(); };
const phoneOff = () => { sim.inputState = 'disconnected'; sim.inputSince = iso(); }; // the lifecycle lags behind, as on Nov 17
const isFbPostCall = (u) => String(u).includes('graph.facebook.com') && /\/fblive\d+(\?|$)/.test(String(u));
let fbSeq = 0;
const ended = () => calls.filter((c) => isFbPostCall(c.url) && c.method === 'POST').length;
const fbPosts = () => calls.filter((c) => c.url.includes('graph.facebook.com') && c.url.includes('/live_videos') && c.method === 'POST').length;
const slack = (re) => calls.filter((c) => c.url === 'https://hook.test/slack' && re.test(c.body || '')).length;
const kidVideo = async () => JSON.parse((await env.DB.prepare('SELECT data FROM kids WHERE slug = ?').bind('remi').first()).data).revealVideoUrl;
const replaySends = async (id) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM broadcast_sends WHERE broadcast_id = ? AND kind = 'replay'`).bind(id).first()).n;
const fresh = async () => {
  sim.live = false; sim.inputState = null; sim.inputSince = null; sim.inputFail = false; sim.videoState = 'live-inprogress';
  travel(20 * M); await tick();
  await b.adminAction(env, 'reset', {}, 'peter@test');
  travel(60 * S); await tick();
  await env.DB.prepare(`UPDATE kids SET data = json_remove(data, '$.revealVideoUrl') WHERE slug = 'remi'`).run();
};
// The reveal is scheduled 2 minutes out and runs past it, so a stop afterwards is the reveal ending (before it: a framing check)
const goLiveRemi = async (vid) => {
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * M).toISOString() }, 'jobtread');
  phoneOn(vid);
  travel(5 * S); const r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  return (await b.readState(env.DB)).broadcastId;
};

test('the phone stops for good: ended on the site and on Facebook in 2 minutes; "Ended", the kid page and the replay email wait 15 minutes, then happen once', async () => {
  await fresh();
  const id = await goLiveRemi('vid1');
  assert.equal(fbPosts(), 1, 'one Facebook post');
  const n = calls.length;
  phoneOff();
  travel(2 * M + 5 * S); await tick(); travel(5 * S); let r = await tick();
  assert.equal(r.state.phase, 'replay', 'ended on the site');
  sim.videoState = 'ready'; sim.live = false;
  for (let i = 0; i < 6; i++) { travel(60 * S); r = await tick(); }
  assert.equal(r.state.player?.kind, 'replay', 'the replay plays on the live page meanwhile');
  assert.equal(ended(), 1, 'Facebook\'s post closed with the site (Facebook only keeps a dropped stream\'s post 2–3 minutes)');
  assert.equal(slack(/Ended/), 0, 'no "Ended" yet');
  assert.equal(await kidVideo(), undefined, 'nothing on the kid page yet');
  assert.equal(await replaySends(id), 0, 'no replay email yet');
  travel(10 * M); r = await tick();
  assert.ok(r.work.includes('closed'), r.work.join(','));
  for (let i = 0; i < 2; i++) { travel(31 * S); await tick(); }
  assert.equal(ended(), 1, 'Facebook\'s post closed once');
  assert.equal(slack(/Ended/), 1, '"Ended" once');
  assert.equal(await kidVideo(), 'https://watch.cloudflarestream.com/vid1');
  assert.equal(await replaySends(id), 1, 'one replay email');
  assert.ok(calls.slice(n).every((c) => !(c.url.includes('/live_videos') && c.method === 'POST')), 'no second Facebook post');
});

test('a 5-minute outage: the phone comes back and the same reveal goes on; nobody hears "we\'re live" twice; the replay is the longest piece', async () => {
  await fresh();
  const id = await goLiveRemi('vid2');
  const liveBefore = (await sends(id)).filter((x) => x.startsWith('live/'));
  const nowAlerts = slack(/Live now/);
  sim.durations = { vid2: 1500, vid3: 240 };
  const firstPost = (await b.readState(env.DB)).fb;
  assert.ok(firstPost?.liveVideoId, 'on its first Facebook post');
  phoneOff();
  for (let i = 0; i < 5; i++) { travel(60 * S); await tick(); }
  let st = await b.readState(env.DB);
  assert.equal(st.phase, 'replay', 'ended on the site after 2 minutes');
  phoneOn('vid3');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('rejoined'), r.work.join(','));
  st = await b.readState(env.DB);
  assert.equal(st.phase, 'live');
  assert.equal(st.broadcastId, id, 'the same reveal');
  assert.equal(st.kidSlug, 'remi');
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  assert.deepEqual((await sends(id)).filter((x) => x.startsWith('live/')), liveBefore, 'no second "we\'re live"');
  assert.equal(slack(/Live now/), nowAlerts, 'no second "Live now"');
  assert.equal(fbPosts(), 3, 'a new Facebook post for the rest of the reveal (one from each test so far, and this one)');
  const st2 = await b.readState(env.DB);
  assert.ok(st2.fb?.liveVideoId, 'the reveal is on its new Facebook post');
  assert.notEqual(st2.fb.liveVideoId, firstPost.liveVideoId);
  // History adds the two posts' numbers together: the first is kept with the reveal, in its row too
  assert.deepEqual(st2.fbEarlier, [{ liveVideoId: firstPost.liveVideoId, permalink: firstPost.permalink || null }]);
  const histRow = await env.DB.prepare('SELECT fb_live_video_id, data FROM broadcasts WHERE id = ?').bind(id).first();
  assert.equal(histRow.fb_live_video_id, st2.fb.liveVideoId, 'the row\'s own post is the last');
  assert.deepEqual(JSON.parse(histRow.data).fbEarlier, st2.fbEarlier);
  assert.deepEqual(rs.fbPostsOf(histRow).map((p) => p.liveVideoId), [firstPost.liveVideoId, st2.fb.liveVideoId], 'both posts, in order');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM broadcasts WHERE id = ?').bind(id).first()).n, 1);
  // Now the phone stops for good
  phoneOff();
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  sim.videoState = 'ready'; sim.live = false;
  travel(16 * M); r = await tick();
  for (let i = 0; i < 3; i++) { travel(31 * S); r = await tick(); }
  st = await b.readState(env.DB);
  assert.equal(st.replayUid, 'vid2', 'the 25-minute piece, not the 4-minute tail');
  assert.equal(await kidVideo(), 'https://watch.cloudflarestream.com/vid2');
  assert.equal(await replaySends(id), 1);
  assert.equal(slack(/Ended/), 2, 'one "Ended" for this reveal (one for the test before)');
});

test('a phone back after the 15 minutes is a new broadcast, and the old reveal was wrapped up first', async () => {
  await fresh();
  const id = await goLiveRemi('vid4');
  const endedBefore = ended();
  phoneOff();
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  sim.live = false;
  travel(16 * M); let r = await tick();
  assert.ok(r.work.includes('closed'), r.work.join(','));
  assert.equal(ended(), endedBefore + 1, 'Facebook\'s post closed');
  phoneOn('vid5');
  travel(5 * S); r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  assert.notEqual((await b.readState(env.DB)).broadcastId, id);
});

test('Clear replay during the 15 minutes wraps the reveal up at once', async () => {
  await fresh();
  const id = await goLiveRemi('vid6');
  const endedBefore = ended(); const announced = slack(/Ended/);
  phoneOff();
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  const r = await b.adminAction(env, 'clearReplay', {}, 'peter@test');
  assert.equal(r.success, true, r.error);
  await tick();
  assert.equal(ended(), endedBefore + 1, 'Facebook\'s post closed');
  assert.equal(slack(/Ended/), announced + 1, '"Ended" sent');
  assert.equal((await b.readState(env.DB)).phase, 'idle');
  assert.ok(id);
});

test('the lifecycle still reporting the ended recording during the 15 minutes is not a phone coming back', async () => {
  await fresh();
  await goLiveRemi('vid7');
  phoneOff();
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  // sim.live stays true with vid7 (the lag); the input says disconnected; then the API fails
  for (let i = 0; i < 3; i++) { travel(20 * S); const r = await tick(); assert.equal(r.state.phase, 'replay'); }
  sim.inputFail = true;
  for (let i = 0; i < 3; i++) { travel(20 * S); const r = await tick(); assert.equal(r.state.phase, 'replay'); }
  sim.inputFail = false;
});

test('End now wraps up at once: no 15-minute wait', async () => {
  await fresh();
  await goLiveRemi('vid8');
  const endedBefore = ended(); const announced = slack(/Ended/);
  const r = await b.adminAction(env, 'endNow', {}, 'peter@test');
  assert.equal(r.success, true, r.error);
  assert.equal(ended(), endedBefore + 1);
  const st = await b.readState(env.DB);
  assert.equal(st.rejoinUntil, null);
  sim.live = false; sim.inputState = 'disconnected'; sim.inputSince = iso();
  travel(10 * S); await tick();
  assert.equal(slack(/Ended/), announced, 'End now announces nothing more');
});

// ─── Third review ──────────────────────────────────────────────────────────────────────────────────
const kitListPosts = () => kit.posts.filter((p) => p.send_at && !/reveal sign-ups · /.test(p.description || '')).length;

test('a 2-minute framing check before showtime never emails the Kit list: the phone stopping is a gap, not 3 minutes live', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 20 * M).toISOString() }, 'jobtread');
  const before = kitListPosts();
  phoneOn('vid20');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  travel(120 * S); await tick(); // 2 minutes of framing check
  phoneOff();
  for (let i = 0; i < 13; i++) { travel(10 * S); r = await tick(); }
  assert.equal(kitListPosts(), before, 'no "we\'re live" to the whole list');
  assert.equal(r.state.phase, 'armed', 'a framing check: the reveal waits for its phone again');
});

test('a test phone stopped seconds before 30 minutes out does not become the reveal', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * H).toISOString() }, 'jobtread');
  const planned = (await b.readState(env.DB)).broadcastId;
  await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  travel(85 * M); // T-35
  phoneOn('vid21');
  let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  travel(4 * M + 45 * S); // T-30:15
  phoneOff();
  travel(10 * S); r = await tick(); // T-30:05, 10 s into the stop
  assert.ok(!r.work.includes('test-became-reveal'), `a stopped phone is not the reveal: ${r.work.join(',')}`);
  for (let i = 0; i < 6; i++) { travel(10 * S); r = await tick(); }
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'armed', 'the reveal waits for its phone');
  assert.equal(st.broadcastId, planned);
  assert.equal(st.liveAt, null);
});

test('a new phone after a test, while the lifecycle still names the test\'s recording, goes live; the test recording is never the replay', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * H).toISOString() }, 'jobtread');
  await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  phoneOn('vid22');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  phoneOff();
  for (let i = 0; i < 7; i++) { travel(10 * S); r = await tick(); }
  assert.equal((await b.readState(env.DB)).phase, 'scheduled', 'the test ended');
  assert.equal(r.state.phase, 'replay', 'its end shows on the website as the reveal\'s will');
  await b.adminAction(env, 'quietTest', { on: false }, 'peter@test');
  travel(30 * S);
  // The real phone connects; the lifecycle still names vid22 (lag)
  sim.inputState = 'connected'; sim.inputSince = iso(); sim.live = true; sim.videoUID = 'vid22';
  travel(5 * S); r = await tick();
  assert.ok(r.work.includes('auto-start'), `a new connection goes live: ${r.work.join(',')}`);
  let st = await b.readState(env.DB);
  assert.ok(!(st.recordings || []).includes('vid22'), 'the test recording is not this reveal\'s');
  sim.videoUID = 'vid23'; // the lifecycle catches up
  travel(5 * S); await tick();
  st = await b.readState(env.DB);
  assert.deepEqual(st.recordings, ['vid23']);
  assert.equal(st.liveVideoUid, 'vid23');
});

test('the emergency banner never marks the phone\'s recording as ended', async () => {
  await fresh();
  let r = await b.adminAction(env, 'goLiveManual', { message: 'Live on Facebook', url: 'https://www.facebook.com/SunshineOnaRanneyDay', durationHours: 1 }, 'peter@test');
  assert.equal(r.success, true, r.error);
  phoneOn('vid24');
  travel(5 * S); await tick();
  r = await b.adminAction(env, 'endNow', {}, 'peter@test');
  assert.equal(r.state.phase, 'idle');
  travel(5 * S); const t = await tick();
  assert.ok(t.work.includes('auto-start'), `the phone streaming goes live from Stream: ${t.work.join(',')}`);
});

test('a failed read while the lifecycle says "not live" during a drop holds: no split', async () => {
  await fresh();
  const id = await goLiveRemi('vid25');
  sim.live = false; phoneOff();
  travel(40 * S); sim.inputFail = true; let r = await tick(); sim.inputFail = false;
  assert.equal(r.state.phase, 'live', 'held');
  for (let i = 0; i < 4; i++) { travel(10 * S); r = await tick(); assert.equal(r.state.phase, 'live', 'still a drop under 2 minutes'); }
  phoneOn('vid26');
  travel(5 * S); r = await tick();
  assert.equal(r.state.phase, 'live');
  assert.equal((await b.readState(env.DB)).broadcastId, id, 'one reveal');
});

test('a phone status the site doesn\'t know leaves it to the lifecycle', async () => {
  await fresh();
  const id = await goLiveRemi('vid27');
  sim.inputState = 'reconnecting'; sim.inputSince = iso();
  travel(10 * S); let r = await tick();
  assert.equal(r.state.phase, 'live', 'the lifecycle still says live');
  sim.live = false;
  travel(10 * S); r = await tick();
  assert.equal(r.state.phase, 'ending');
  assert.ok(id);
});

// ─── Fourth review ─────────────────────────────────────────────────────────────────────────────────
test('a framing check before showtime is not the reveal: back to waiting, nothing final, the reveal starts as itself with its own Facebook post', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 30 * M).toISOString() }, 'jobtread');
  const id = (await b.readState(env.DB)).broadcastId;
  travel(2 * M); // T-28
  const posts = fbPosts(); const endedBefore = ended(); const live0 = (await sends(id)).filter((x) => x.startsWith('live/')).length;
  phoneOn('vid30');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  assert.equal(fbPosts(), posts + 1, 'the framing check opened a Facebook post');
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); } // 4 minutes
  phoneOff(); sim.live = false;
  for (let i = 0; i < 4; i++) { travel(60 * S); r = await tick(); }
  let st = await b.readState(env.DB);
  assert.equal(st.phase, 'armed', 'waiting for its phone again');
  assert.equal(st.broadcastId, id);
  assert.equal(st.liveAt, null);
  assert.equal(ended(), endedBefore + 1, 'the framing check\'s Facebook post closed');
  sim.videoState = 'ready';
  for (let i = 0; i < 18; i++) { travel(60 * S); r = await tick(); } // phone off ~20 minutes
  assert.equal(await kidVideo(), undefined, 'the framing clip is not on the kid page');
  assert.equal(await replaySends(id), 0, 'no replay email');
  // The real start, 5 minutes before showtime
  sim.videoState = 'live-inprogress';
  phoneOn('vid31');
  travel(5 * S); r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  st = await b.readState(env.DB);
  assert.equal(st.broadcastId, id, 'the same reveal');
  assert.equal(st.kidSlug, 'remi');
  assert.equal(fbPosts(), posts + 2, 'a fresh Facebook post for the real start');
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  const liveSendsNow = (await sends(id)).filter((x) => x.startsWith('live/'));
  assert.equal(new Set(liveSendsNow).size, liveSendsNow.length, 'each "we\'re live" once');
  assert.deepEqual(st.recordings, ['vid31'], 'the framing clip is not one of the reveal\'s recordings');
});

test('the replay is the piece with the most of the reveal after its start, not the waiting before it', async () => {
  await fresh();
  // Pieces: vid40 = 20 min before the start + 10 after; vid41 = the next 15 min; vid42 = the last 20 min
  const t0 = Date.now() + 20 * M;
  const at = (min) => new Date(t0 + min * M).toISOString();
  const vids = { vid40: { created: at(-20), duration: 30 * 60 }, vid41: { created: at(10.5), duration: 15 * 60 }, vid42: { created: at(26), duration: 20 * 60 } };
  const s = { scheduledAt: new Date(t0).toISOString() };
  const score = Object.fromEntries(Object.entries(vids).map(([k, v]) => [k, b.replayScore(v, s)]));
  assert.ok(score.vid42 > score.vid41 && score.vid41 > score.vid40, JSON.stringify(score));
  assert.equal(Math.round(b.replayScore(vids.vid40, s)), 600, 'only the 10 minutes after the start count');
  assert.equal(b.replayScore({ duration: 120 }, {}), 120, 'unscheduled: the longest');
});

// ─── Fifth review ──────────────────────────────────────────────────────────────────────────────────
test('Stream\'s own record, exactly as production returned it on Nov 17: "disconnected" and "connected" are read from status.current.state', async () => {
  // GET /stream/live_inputs/{uid} at 19:23:46Z, 2 minutes after the phone stopped, and at 19:47:32Z, just after it started
  const stopped = { ok: true, result: { status: { current: { ingestProtocol: 'srt', reason: 'client_disconnect', state: 'disconnected', statusEnteredAt: '2026-11-17T19:21:42.849Z', statusLastSeen: '2026-11-17T19:21:42.849Z' }, history: [{ ingestProtocol: 'srt', reason: 'connected', state: 'connected', statusEnteredAt: '2026-11-17T19:14:17.692Z' }] } } };
  const started = { ok: true, result: { status: { current: { ingestProtocol: 'srt', reason: 'connected', state: 'connected', statusEnteredAt: '2026-11-17T19:47:02.735Z', statusLastSeen: '2026-11-17T19:47:02.735Z' } } } };
  const realFetch2 = globalThis.fetch;
  const answer = (body) => { globalThis.fetch = async (u, init) => (String(u).includes('/stream/live_inputs/in1') && !String(u).includes('/outputs') ? new Response(JSON.stringify({ success: true, ...body })) : realFetch2(u, init)); };
  const onAir = { phase: 'live', source: 'stream', liveAt: '2026-11-17T19:14:50.022Z', segmentAt: '2026-11-17T19:14:50.022Z' };
  try {
    answer(stopped);
    let r = await b.sensePhone(env, 'in1', { live: true, videoUID: 'v1' }, onAir, {}, Date.parse('2026-11-17T19:23:46.652Z'));
    assert.equal(r.phone, 'off', 'gone: over 2 minutes since it stopped');
    assert.equal(r.stoppedAt, Date.parse('2026-11-17T19:21:42.849Z'));
    r = await b.sensePhone(env, 'in1', { live: true, videoUID: 'v1' }, onAir, {}, Date.parse('2026-11-17T19:22:20.000Z'));
    assert.equal(r.phone, 'on', 'a drop under 2 minutes');
    assert.equal(r.gapSince, Date.parse('2026-11-17T19:21:42.849Z'));
    answer(started);
    r = await b.sensePhone(env, 'in1', { live: true, videoUID: 'v2' }, { phase: 'scheduled' }, {}, Date.parse('2026-11-17T19:47:36.154Z'));
    assert.equal(r.phone, 'on', 'connected: goes live');
  } finally { globalThis.fetch = realFetch2; }
});

test('the office hears "The phone lost its connection" during a drop the site is riding out', async () => {
  await fresh();
  await goLiveRemi('vid50');
  const before = slack(/lost its connection/);
  phoneOff();
  for (let i = 0; i < 6; i++) { travel(10 * S); await tick(); }
  assert.ok(slack(/lost its connection/) > before, 'alerted');
  assert.equal((await b.readState(env.DB)).phase, 'live', 'still live: under 2 minutes');
  phoneOn('vid51'); travel(5 * S); await tick();
});

test('a reveal run early that ends before its scheduled time is the reveal, not a framing check', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 60 * M).toISOString() }, 'jobtread');
  const id = (await b.readState(env.DB)).broadcastId;
  phoneOn('vid52');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  for (let i = 0; i < 30; i++) { travel(60 * S); await tick(); } // 30 minutes, all before the scheduled hour
  phoneOff(); sim.live = false;
  travel(2 * M + 5 * S); await tick(); travel(5 * S); r = await tick();
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'replay', 'ended as a reveal');
  assert.equal(st.broadcastId, id);
  assert.ok(st.rejoinUntil, 'open to the phone coming back like any reveal');
});

test('a framing check whose Facebook post won\'t close still leaves the reveal its own Facebook post', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 25 * M).toISOString() }, 'jobtread');
  const posts = fbPosts();
  phoneOn('vid53');
  travel(5 * S); await tick();
  for (let i = 0; i < 3; i++) { travel(60 * S); await tick(); }
  // Facebook refuses to close anything from here on
  const realFetch3 = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => (isFbPostCall(u) && (init.method || 'GET') === 'POST' ? new Response(JSON.stringify({ error: { message: 'temporarily unavailable', code: 2 } }), { status: 500 }) : realFetch3(u, init));
  try {
    phoneOff(); sim.live = false;
    for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
    assert.equal((await b.readState(env.DB)).phase, 'armed');
    phoneOn('vid54');
    travel(5 * S); const r = await tick();
    assert.ok(r.work.includes('auto-start'), r.work.join(','));
    assert.equal(fbPosts(), posts + 2, 'the reveal opened its own Facebook post');
    const st = await b.readState(env.DB);
    assert.equal(st.preShowFb, null);
    assert.ok(st.fb?.liveVideoId, 'and it is the reveal\'s');
  } finally { globalThis.fetch = realFetch3; }
});

// ─── Sixth review ──────────────────────────────────────────────────────────────────────────────────
const fbCreateFails = (n) => {
  let left = n;
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (left > 0 && String(u).includes('graph.facebook.com') && String(u).includes('/live_videos') && (init.method || 'GET') === 'POST') { left--; calls.push({ url: String(u), method: 'POST', body: init.body }); return new Response(JSON.stringify({ error: { message: 'temporarily unavailable', code: 2 } }), { status: 500 }); }
    return prev(u, init);
  };
  return () => { globalThis.fetch = prev; };
};

test('picked up again after a long drop, the reveal is on a new Facebook post, and that one closes at the end', async () => {
  await fresh();
  await goLiveRemi('vid60');
  const posts = fbPosts(); const closes = ended();
  phoneOff(); sim.live = false;
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  assert.equal(ended(), closes + 1, 'the first post closed when the site ended the reveal');
  phoneOn('vid61');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('rejoined'), r.work.join(','));
  assert.equal(fbPosts(), posts + 1, 'a new post for the rest');
  phoneOff(); sim.live = false;
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  assert.equal(ended(), closes + 2, 'and it closes at the end');
  travel(16 * M); r = await tick();
  assert.ok(r.work.includes('closed'), r.work.join(','));
  assert.equal(ended(), closes + 2, 'nothing closed twice');
});

test('a framing check whose Facebook post failed to open still leaves the reveal its own post', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 25 * M).toISOString() }, 'jobtread');
  const restore = fbCreateFails(1);
  try {
    phoneOn('vid62');
    travel(5 * S); await tick();
    for (let i = 0; i < 3; i++) { travel(60 * S); await tick(); }
    phoneOff(); sim.live = false;
    for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
    assert.equal((await b.readState(env.DB)).phase, 'armed');
    const posts = fbPosts();
    phoneOn('vid63');
    travel(5 * S); await tick();
    assert.equal(fbPosts(), posts + 1, 'the real start opened a post');
    assert.ok((await b.readState(env.DB)).fb?.liveVideoId);
  } finally { restore(); }
});

test('staff hear about a second early-start Kit hold after a framing check', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 55 * M).toISOString() }, 'jobtread');
  const held = () => slack(/Kit email held/);
  const before = held();
  phoneOn('vid64'); travel(5 * S); await tick();
  for (let i = 0; i < 5; i++) { travel(60 * S); await tick(); } // T-50
  phoneOff(); sim.live = false;
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  assert.equal(held(), before + 1, 'the framing check\'s hold');
  travel(6 * M); // T-40
  phoneOn('vid65'); travel(5 * S); await tick();
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  assert.equal(held(), before + 2, 'the real start\'s hold is told too');
});

test('a 15-minute phone test hours before the reveal, without test mode, is never the reveal', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 3 * H).toISOString() }, 'jobtread');
  const id = (await b.readState(env.DB)).broadcastId;
  phoneOn('vid66'); travel(5 * S); await tick();
  for (let i = 0; i < 15; i++) { travel(60 * S); await tick(); }
  phoneOff(); sim.live = false;
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'scheduled', 'back to waiting');
  assert.equal(st.broadcastId, id);
  sim.videoState = 'ready';
  for (let i = 0; i < 20; i++) { travel(60 * S); await tick(); }
  assert.equal(await kidVideo(), undefined, 'the test is not on the kid page');
  assert.equal(await replaySends(id), 0, 'no replay email');
  sim.videoState = 'live-inprogress';
});

test('a recording Stream no longer has doesn\'t hold the replay for 30 minutes', async () => {
  await fresh();
  const id = await goLiveRemi('vid67');
  await env.DB.prepare(`UPDATE site_config SET data = json_set(data, '$.recordings', json('["vid67","vid99x"]')) WHERE key = 'broadcast'`).run();
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, init) => (/\/stream\/vid99x$/.test(String(u)) ? new Response(JSON.stringify({ success: false, errors: [{ message: 'not found' }] }), { status: 404 }) : prev(u, init));
  try {
    phoneOff(); sim.live = false;
    travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
    sim.videoState = 'ready';
    travel(60 * S); const r = await tick();
    assert.equal(r.state.player?.kind, 'replay', 'the replay plays within a minute');
    assert.equal((await b.readState(env.DB)).replayUid, 'vid67');
  } finally { globalThis.fetch = prev; sim.videoState = 'live-inprogress'; }
  assert.ok(id);
});

test('a framing check\'s feed issues and viewer counts don\'t carry into the reveal', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 25 * M).toISOString() }, 'jobtread');
  const id = (await b.readState(env.DB)).broadcastId;
  phoneOn('vid70'); travel(5 * S); await tick();
  for (let i = 0; i < 3; i++) { travel(60 * S); await tick(); }
  await (await import('../functions/api/_reveal-stats.js')).ensureStatsSchema(env.DB);
  await env.DB.prepare(`INSERT OR REPLACE INTO broadcast_stats (broadcast_id, series, sampled_at, updated_at) VALUES (?, '[[0,5,0,0,0]]', ?, ?)`).bind(id, iso(), iso()).run();
  assert.ok(await env.DB.prepare('SELECT 1 FROM broadcast_stats WHERE broadcast_id = ?').bind(id).first(), 'the framing check had viewer counts');
  phoneOff(); sim.live = false;
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  assert.equal((await b.readState(env.DB)).phase, 'armed');
  const row = await env.DB.prepare('SELECT * FROM broadcast_stats WHERE broadcast_id = ?').bind(id).first();
  assert.equal(row, null, 'the framing check\'s viewer counts are gone');
  const h = await b.readHealth(env.DB);
  assert.ok(!h.monitor || h.monitor.broadcastId !== id || !Object.keys(h.monitor.issues || {}).length, 'no framing-check issues left open');
});

// ─── Seventh review ────────────────────────────────────────────────────────────────────────────────
test('a Facebook post opened by a tick whose save was lost is read back, so it is closed at the end', async () => {
  await fresh();
  await goLiveRemi('vid80');
  const st = await b.readState(env.DB);
  assert.ok(st.fb?.liveVideoId);
  // As if the tick that opened it lost its save: the state forgets the post, the claim still has it
  await b.writeState(env.DB, { ...st, fb: { liveVideoId: null, permalink: null, outputUid: null, checkedAt: null, needsReview: false } });
  travel(5 * S); const r = await tick();
  assert.ok(r.work.includes('fb-read-back'), r.work.join(','));
  assert.equal((await b.readState(env.DB)).fb.liveVideoId, st.fb.liveVideoId);
  const closes = ended();
  phoneOff(); sim.live = false;
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  assert.equal(ended(), closes + 1, 'the post is closed at the end');
});

test('a framing check over 10 minutes, then a long pause before the start: the real start is the same reveal', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 45 * M).toISOString() }, 'jobtread');
  const id = (await b.readState(env.DB)).broadcastId;
  travel(16 * M); // T-29
  phoneOn('vid81'); travel(5 * S); await tick();
  for (let i = 0; i < 11; i++) { travel(60 * S); await tick(); } // 11 minutes: longer than a framing check
  phoneOff(); sim.live = false;
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  let st = await b.readState(env.DB);
  assert.equal(st.phase, 'replay');
  assert.ok(Date.parse(st.rejoinUntil) >= Date.parse(st.scheduledAt) + 15 * M - 1000, 'open until 15 minutes after the start');
  for (let i = 0; i < 16; i++) { travel(60 * S); await tick(); } // a long pause: past the usual 15 minutes, T+0.x
  const liveNow = slack(/Live now/);
  phoneOn('vid82'); travel(5 * S); const r = await tick();
  assert.ok(r.work.includes('rejoined'), r.work.join(','));
  st = await b.readState(env.DB);
  assert.equal(st.broadcastId, id, 'the same reveal');
  assert.equal(st.kidSlug, 'remi');
  assert.equal(slack(/Live now/), liveNow, 'no second "Live now"');
  assert.equal(await kidVideo(), undefined, 'the framing clip never went on the kid page');
});

// ─── Eighth review ─────────────────────────────────────────────────────────────────────────────────
test('a Facebook post left claimed by a framing check is never the reveal\'s: the reveal opens its own', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 25 * M).toISOString() }, 'jobtread');
  const id = (await b.readState(env.DB)).broadcastId;
  phoneOn('vid90'); travel(5 * S); await tick();
  for (let i = 0; i < 3; i++) { travel(60 * S); await tick(); }
  const framingPost = (await b.readState(env.DB)).fb.liveVideoId;
  phoneOff(); sim.live = false;
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  // As if the release never finished: the framing check's claim is back
  await env.DB.prepare(`INSERT OR REPLACE INTO broadcast_claims (broadcast_id, key, result, created_at) VALUES (?, 'fb-live-post', ?, ?)`)
    .bind(id, JSON.stringify({ liveVideoId: framingPost, outputUid: 'apiout-old' }), new Date(Date.now() - 4 * M).toISOString()).run();
  const posts = fbPosts();
  phoneOn('vid91'); travel(5 * S); await tick();
  assert.equal(fbPosts(), posts + 1, 'a new post');
  assert.notEqual((await b.readState(env.DB)).fb.liveVideoId, null);
  travel(5 * S); const r = await tick();
  assert.ok(!r.work.includes('fb-read-back'), 'the old one is never read back');
});

test('a database error while releasing Facebook at a pick-up is tried again, not skipped', async () => {
  await fresh();
  await goLiveRemi('vid92');
  phoneOff(); sim.live = false;
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  const realDB = env.DB; let armed = true;
  env.DB = { ...realDB, prepare: (sql) => { if (armed && /INSERT OR IGNORE INTO broadcast_claims/.test(sql)) { const st = realDB.prepare(sql); return { ...st, bind: (...a) => (String(a[1]).startsWith('fb-release:') ? (armed = false, { run: async () => { throw new Error('D1_ERROR: network connection lost'); } }) : st.bind(...a)) }; } return realDB.prepare(sql); } };
  try {
    const posts = fbPosts();
    phoneOn('vid93'); travel(5 * S); let r = await tick();
    assert.ok(r.work.includes('rejoined'), r.work.join(','));
    assert.ok(r.work.includes('fb-release-retry'), r.work.join(','));
    travel(5 * S); r = await tick();
    assert.equal(fbPosts(), posts + 1, 'the new post opened on the retry');
  } finally { env.DB = realDB; }
});

// ─── Ninth review ──────────────────────────────────────────────────────────────────────────────────
test('the emergency banner started minutes after a reveal ended wraps that reveal up first', async () => {
  await fresh();
  const id = await goLiveRemi('vid95');
  const announced = slack(/Ended/);
  phoneOff(); sim.live = false;
  travel(2 * M + 5 * S); await tick(); travel(5 * S); await tick();
  sim.videoState = 'ready';
  travel(60 * S); await tick(); // the replay is ready, the window still open
  const r = await b.adminAction(env, 'goLiveManual', { message: 'Live on Facebook', url: 'https://www.facebook.com/SunshineOnaRanneyDay', durationHours: 1 }, 'peter@test');
  assert.equal(r.success, true, r.error);
  assert.equal(slack(/Ended/), announced + 1, '"Ended" for the reveal');
  assert.equal(await kidVideo(), 'https://watch.cloudflarestream.com/vid95', 'its recording on the kid page');
  assert.equal(await replaySends(id), 1, 'its replay email');
  sim.videoState = 'live-inprogress';
  await b.adminAction(env, 'endNow', {}, 'peter@test');
});
