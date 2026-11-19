/**
 * The Page's scheduled live for a confirmed reveal (Peter, Nov 19 2026: "Yes, set it up"): made once the reveal is
 * within 7 days, with real words and a link to the website, so followers can tap "Get reminder"; moved and taken down
 * with the reveal; the go-live sends the video to it (live at its start, a framing check before then unseen and kept);
 * anything wrong with it falls back to a post of its own, as before.
 * Run: node --test tests/broadcast-fb-plan.test.mjs
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
const sim = { live: false, videoUID: null, videoState: 'live-inprogress', inputState: null, inputSince: null, durations: {} };
const outputs = new Map();
const calls = [];
const kit = { subs: new Map(), posts: [], nextId: 500 };
const kitTags = fakeKitTags();
// Facebook: each live video with its status, planned start and ingest
const fbv = new Map();
const fbSim = { refuseScheduled: false, refuseLiveNow: false };
let fbSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || input?.href || input);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
  calls.push({ url, method, body, raw: typeof init.body === 'string' ? init.body : '' });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('cloudflarestream.com/') && url.endsWith('/lifecycle')) return json({ isInput: true, videoUID: sim.live ? sim.videoUID : null, live: sim.live });
  if (url.includes('cloudflarestream.com/') && url.endsWith('/views')) return json({ liveViewers: 2 });
  const out = url.match(/\/stream\/live_inputs\/in1\/outputs\/([a-z0-9]+)$/);
  if (out && method === 'DELETE') { outputs.delete(out[1]); return json({ success: true }); }
  if (out && method === 'PUT') { const o = outputs.get(out[1]); if (o) o.enabled = JSON.parse(init.body).enabled; return json({ success: true, result: o }); }
  if (url.includes('/stream/live_inputs/in1/outputs') && method === 'POST') { const b0 = JSON.parse(init.body); const uid = `apiout${outputs.size + 1}`; outputs.set(uid, { uid, url: b0.url, streamKey: b0.streamKey, enabled: true }); return json({ success: true, result: { uid } }); }
  if (url.includes('/stream/live_inputs/in1/outputs')) return json({ success: true, result: [...outputs.values()].map((o) => ({ ...o })) });
  if (url.includes('/stream/live_inputs/in1/videos')) return json({ success: true, result: [] });
  if (url.includes('/stream?per_page=1')) return json({ success: true, result: [] });
  if (url.includes('/stream/live_inputs/in1')) return json({ success: true, result: { uid: 'in1', status: { current: { state: sim.inputState || (sim.live ? 'connected' : 'disconnected'), statusEnteredAt: sim.inputSince || undefined } } } });
  if (/\/stream\/vid\w+\/captions\//.test(url)) return json({ success: true, result: {} });
  const vid = url.match(/\/stream\/(vid\w+)$/);
  if (vid) return json({ success: true, result: { uid: vid[1], created: new Date(Date.now()).toISOString(), duration: sim.durations[vid[1]] ?? 60, status: { state: sim.videoState } } });
  if (url.startsWith('https://graph.facebook.com/')) {
    const path = new URL(url).pathname.replace('/v25.0/', '');
    if (path === '123/live_videos' && method === 'POST') {
      if (body.status === 'SCHEDULED_UNPUBLISHED') {
        if (fbSim.refuseScheduled) return json({ error: { message: 'Scheduled lives are not available for this Page', code: 100 } }, 400);
        const id = `fbsched${++fbSeq}`;
        fbv.set(id, { id, status: 'SCHEDULED_UNPUBLISHED', planned: Number(body.planned_start_time), title: body.title, description: body.description, ingest: `rtmps://live-api-s.facebook.com:443/rtmp/SCHED-${id}` });
        return json({ id });
      }
      const id = `fblive${++fbSeq}`;
      fbv.set(id, { id, status: 'LIVE', title: body.title, description: body.description, ingest: `rtmps://live-api-s.facebook.com:443/rtmp/NOW-${id}` });
      return json({ id, secure_stream_url: fbv.get(id).ingest });
    }
    const one = fbv.get(path);
    if (one && method === 'GET') return one.deleted ? json({ error: { message: 'gone', code: 100 } }, 400) : json({ id: one.id, status: one.status, secure_stream_url: one.ingest });
    if (one && method === 'DELETE') { one.deleted = true; return json({ success: true }); }
    if (one && method === 'POST') {
      if (body.planned_start_time) one.planned = Number(body.planned_start_time);
      if (body.status === 'LIVE_NOW') { if (fbSim.refuseLiveNow) return json({ error: { message: 'No video is reaching this live yet', code: 100 } }, 400); one.status = 'LIVE'; }
      if (body.status === 'SCHEDULED_CANCELED') one.status = 'SCHEDULED_CANCELED';
      if (body.end_live_video) one.status = 'VOD';
      return json({ success: true });
    }
    return json({ data: [] });
  }
  if (url.startsWith('https://api.resend.com/')) return json({ data: [] });
  if (url.startsWith('https://api.kit.com/v4/')) {
    const kb = init.body && init.body !== '{}' ? JSON.parse(init.body) : null;
    const tagged = await kitTags.answer(url, method, kb);
    if (tagged) return tagged;
    const p = url.replace('https://api.kit.com/v4', '').split('?')[0];
    if (p === '/subscribers' && method === 'POST') { const sub = kit.subs.get(kb.email_address) || { id: kit.nextId++, email_address: kb.email_address, state: 'active' }; kit.subs.set(kb.email_address, sub); return json({ subscriber: sub }, 201); }
    if (p === '/broadcasts' && method === 'POST') { kit.posts.push(kb); return json({ broadcast: { id: 9000 + kit.posts.length } }, 201); }
    return json({ broadcasts: [], subscribers: [], pagination: {} });
  }
  if (url.startsWith('https://hook.test/')) return new Response('ok', { status: 200 });
  return new Response('not mocked: ' + url, { status: 599 });
};
const LIVE_HUB = { idFromName: () => 'main', get: () => ({ async fetch(url) { const p = new URL(url).pathname; return p === '/publish' || p === '/status' ? Response.json({ ok: true, clients: 1 }) : new Response('nf', { status: 404 }); } }) };

let env, b, preflight;
const tick = () => b.runTick(env, { source: 'test', force: true });
const iso = () => new Date(Date.now()).toISOString();
const phoneOn = (v) => { sim.live = true; sim.videoUID = v; sim.inputState = 'connected'; sim.inputSince = iso(); };
const phoneOff = () => { sim.live = false; sim.inputState = 'disconnected'; sim.inputSince = iso(); };
const fbCalls = (fn) => calls.filter((c) => c.url.startsWith('https://graph.facebook.com/') && fn(c));
const nowPosts = () => fbCalls((c) => c.method === 'POST' && c.url.includes('/live_videos') && c.body.status === 'LIVE_NOW').length;
const plan = () => b.readFbPlan(env.DB);
const slack = (re) => calls.filter((c) => c.url === 'https://hook.test/slack' && re.test(c.raw)).length;
const schedule = (ms) => b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + ms).toISOString() }, 'jobtread');
const fresh = async () => {
  sim.live = false; sim.inputState = null; sim.inputSince = null; sim.videoState = 'live-inprogress'; fbSim.refuseScheduled = false; fbSim.refuseLiveNow = false;
  travel(20 * M); await tick();
  await b.adminAction(env, 'reset', {}, 'peter@test');
  travel(60 * S); await tick();
};

before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare(`INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)`).bind('remi', JSON.stringify({ name: 'Remi', slug: 'remi', heroImage: 'kids/remi/hero', summary: 'Remi loves trains and music. SOARD is building Remi a sensory room.' }), 'Remi', 2026, 'in-progress').run();
  env = { DB, LIVE_HUB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok', RESEND_API_KEY: 're_test', KIT_API_KEY: 'kit_test', CF_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy', SLACK_WEBHOOK_URL: 'https://hook.test/slack', FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'fbtok', ALERT_EMAILS: 'staff@test' };
  b = await import('../functions/api/_broadcast.js');
  preflight = await import('../functions/api/_broadcast-preflight.js');
  await b.ensureSchema(DB);
  const cfg = await b.readConfig(DB);
  cfg.liveInput = { uid: 'in1' };
  cfg.facebook = { mode: 'api', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay' };
  await b.writeConfig(DB, cfg);
});
after(() => { Date.now = realNow; globalThis.fetch = realFetch; });

test('a confirmed reveal within 7 days gets a scheduled live on the Page: real words, the link, its start; once', async () => {
  await fresh();
  const r = await schedule(2 * 24 * H);
  assert.equal(r.success, true, r.error);
  const st = await b.readState(env.DB);
  const t = await tick();
  assert.ok(t.work.includes('fb-plan-made'), t.work.join(','));
  const p = await plan();
  assert.equal(p.broadcastId, st.broadcastId);
  assert.equal(p.at, st.scheduledAt);
  const v = fbv.get(p.id);
  assert.equal(v.status, 'SCHEDULED_UNPUBLISHED');
  assert.equal(v.planned, Math.floor(Date.parse(st.scheduledAt) / 1000), 'Facebook\'s start is the reveal\'s');
  assert.equal(v.title, 'Remi\'s room reveal, live');
  assert.match(v.description, /^Remi loves trains and music\./, 'the kid\'s own words first');
  assert.match(v.description, /Live on \w+day, \w+ \d+ at \d+:\d\d [AP]M E[SD]T: watch Remi see the new room for the first time\./);
  assert.match(v.description, /https:\/\/sunshineonaranneyday\.com\/live\/remi\/\?src=facebook/, 'the link to our page');
  const made = fbCalls((c) => c.method === 'POST' && c.body.status === 'SCHEDULED_UNPUBLISHED').length;
  await tick(); await tick();
  assert.equal(fbCalls((c) => c.method === 'POST' && c.body.status === 'SCHEDULED_UNPUBLISHED').length, made, 'once');
  const pf = await preflight.run(env, await b.readConfig(env.DB), await b.readState(env.DB), {}, {});
  assert.equal(pf.items.find((i) => i.key === 'facebookPlan')?.status, 'ok', 'the go/no-go says it\'s up');
});

test('moved in JobTread: Facebook\'s start moves with it; cancelled: taken down', async () => {
  const p0 = await plan();
  const later = new Date(Date.now() + 3 * 24 * H).toISOString();
  const r = await b.adminAction(env, 'update', { scheduledAt: later }, 'jobtread'); // as JobTread moves one (_broadcast-schedule.js)
  assert.equal(r.success, true, r.error);
  const t = await tick();
  assert.ok(t.work.includes('fb-plan-moved'), t.work.join(','));
  assert.equal(fbv.get(p0.id).planned, Math.floor(Date.parse(later) / 1000));
  assert.equal((await plan()).at, later);
  await b.adminAction(env, 'reset', {}, 'peter@test');
  const t2 = await tick();
  assert.ok(t2.work.includes('fb-plan-cancelled'), t2.work.join(','));
  assert.equal(fbv.get(p0.id).deleted, true, 'gone from the Page');
  assert.deepEqual(await plan(), {});
});

test('the same child confirmed again under a new broadcast: the post stays (nobody\'s reminder lost) and moves', async () => {
  await fresh();
  await schedule(2 * 24 * H);
  await tick();
  const p0 = await plan();
  const r = await schedule(2 * 24 * H + 2 * H); // taken down and confirmed again: a new broadcast for Remi
  assert.equal(r.success, true, r.error);
  const st = await b.readState(env.DB);
  assert.notEqual(st.broadcastId, p0.broadcastId);
  const t = await tick();
  assert.ok(t.work.includes('fb-plan-kept-for-kid') && t.work.includes('fb-plan-moved'), t.work.join(','));
  assert.equal(fbv.get(p0.id).deleted, undefined, 'not taken down');
  assert.equal(fbv.get(p0.id).planned, Math.floor(Date.parse(st.scheduledAt) / 1000));
  assert.equal((await plan()).broadcastId, st.broadcastId);
});

test('more than 7 days out: not yet; within 7 days: made', async () => {
  await fresh();
  await schedule(8 * 24 * H);
  const t = await tick();
  assert.ok(!t.work.includes('fb-plan-made'));
  travel(26 * H);
  const t2 = await tick();
  assert.ok(t2.work.includes('fb-plan-made'), t2.work.join(','));
});

test('the go-live at the start uses it: no post of its own, the video to its ingest, live now; ended with the reveal', async () => {
  await fresh();
  await schedule(30 * M);
  await tick();
  const p = await plan();
  assert.ok(p.id, 'made half an hour ahead');
  travel(30 * M);
  const before = nowPosts();
  phoneOn('vid1');
  travel(5 * S); const r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  assert.ok(r.work.includes('fb-plan-used'), r.work.join(','));
  assert.equal(nowPosts(), before, 'no post of its own');
  const st = await b.readState(env.DB);
  assert.equal(st.fb.liveVideoId, p.id);
  assert.equal(fbv.get(p.id).status, 'LIVE', 'live now');
  assert.ok([...outputs.values()].some((o) => o.streamKey === `SCHED-${p.id}`), 'Stream sends the video to it');
  // The end (the phone stops and stays off)
  for (let i = 0; i < 3; i++) { travel(60 * S); await tick(); }
  phoneOff();
  for (let i = 0; i < 6; i++) { travel(40 * S); await tick(); }
  assert.equal(fbv.get(p.id).status, 'VOD', 'Facebook\'s live ended with it');
});

test('a phone on before the start feeds it unseen; a framing check\'s stop keeps it; the real start takes it live', async () => {
  await fresh();
  await schedule(40 * M);
  await tick();
  const p = await plan();
  travel(15 * M); // T-25
  const before = nowPosts();
  phoneOn('vid2');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('fb-plan-used'), r.work.join(','));
  assert.equal(fbv.get(p.id).status, 'SCHEDULED_UNPUBLISHED', 'not live on Facebook before its start');
  for (let i = 0; i < 3; i++) { travel(60 * S); await tick(); }
  phoneOff(); // a framing check
  for (let i = 0; i < 6; i++) { travel(40 * S); r = await tick(); }
  const st = await b.readState(env.DB);
  assert.ok(['scheduled', 'armed'].includes(st.phase), `back to waiting (${st.phase})`);
  assert.equal(fbv.get(p.id).status, 'SCHEDULED_UNPUBLISHED', 'kept for the real start');
  assert.equal(fbv.get(p.id).deleted, undefined);
  assert.equal((await plan()).usedAt, null);
  // The real start, a minute early: fed again, live at the start
  travel(Date.parse(st.scheduledAt) - Date.now() - 60 * S);
  phoneOn('vid3');
  travel(5 * S); r = await tick();
  assert.ok(r.work.includes('fb-plan-used'), r.work.join(','));
  assert.equal(fbv.get(p.id).status, 'SCHEDULED_UNPUBLISHED');
  for (let i = 0; i < 3; i++) { travel(30 * S); r = await tick(); }
  assert.equal(fbv.get(p.id).status, 'LIVE', 'live at its start');
  assert.equal(nowPosts(), before, 'never a post of its own');
});

test('one Facebook has let go (expired): the go-live opens a post of its own, as before', async () => {
  await fresh();
  await schedule(20 * M);
  await tick();
  const p = await plan();
  fbv.get(p.id).status = 'SCHEDULED_EXPIRED';
  travel(20 * M);
  const before = nowPosts();
  phoneOn('vid4');
  travel(5 * S); const r = await tick();
  assert.ok(r.work.some((w) => w.startsWith('fb-plan-unusable')), r.work.join(','));
  assert.equal(nowPosts(), before + 1, 'its own post');
  assert.match((await b.readState(env.DB)).fb.liveVideoId, /^fblive/);
});

test('Facebook refuses it: staff told once, tried again after an hour, the go-live still opens a post', async () => {
  await fresh();
  fbSim.refuseScheduled = true;
  await schedule(3 * H);
  const t = await tick();
  assert.ok(t.work.includes('fb-plan-failed'), t.work.join(','));
  assert.match((await plan()).error, /not available/);
  assert.equal(slack(/didn.t take the scheduled live/), 1);
  await tick();
  assert.equal(slack(/didn.t take the scheduled live/), 1, 'once');
  fbSim.refuseScheduled = false;
  travel(61 * M);
  const t2 = await tick();
  assert.ok(t2.work.includes('fb-plan-made'), t2.work.join(','));
});

test('a test on the main feed: nothing made or touched during it; made once it is over', async () => {
  await fresh();
  await schedule(2 * 24 * H);
  const q = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(q.success, true, q.error);
  phoneOn('vid5');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  assert.ok(!r.work.includes('fb-plan-made'));
  assert.equal((await plan()).id, undefined, 'nothing made during the test');
  const made = () => fbCalls((c) => c.method === 'POST' && c.body.status === 'SCHEDULED_UNPUBLISHED').length;
  const before = made();
  for (let i = 0; i < 3; i++) { travel(10 * S); r = await tick(); assert.equal(made(), before, 'nothing while the test streams'); }
  phoneOff();
  let ended = false;
  for (let i = 0; i < 6; i++) {
    travel(30 * S); r = await tick();
    const st = await b.readState(env.DB);
    if (!st.quiet) ended = true;
    if (!ended) assert.equal(made(), before, 'nothing until the test is over');
  }
  assert.ok(ended, 'the test ended');
  assert.ok((await plan()).id, 'made once it is over');
  assert.equal(made(), before + 1);
});

// ─── From the independent review (Nov 19 2026) ──────────────────────────

test('a tick that loses the plan\'s mark from the state (two ticks at once) still takes it live: decided from its record', async () => {
  await fresh();
  await schedule(30 * M);
  await tick();
  const p = await plan();
  travel(25 * M); // T-5
  phoneOn('vid6');
  travel(5 * S); await tick();
  // As if a racing tick's save won without the plan's fields
  const st = await b.readState(env.DB);
  await b.writeState(env.DB, { ...st, fb: { ...st.fb, planned: false, fedAt: null, liveNowAt: null, liveNowTriedAt: null } });
  travel(Date.parse(st.scheduledAt) - Date.now());
  for (let i = 0; i < 2; i++) { travel(10 * S); await tick(); }
  assert.equal(fbv.get(p.id).status, 'LIVE', 'live at its start all the same');
});

test('Facebook won\'t take it live: a minute and a half on, the reveal gets a post of its own; staff told; never two', async () => {
  await fresh();
  await schedule(20 * M);
  await tick();
  const p = await plan();
  travel(20 * M);
  fbSim.refuseLiveNow = true;
  const before = nowPosts();
  phoneOn('vid7');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('fb-plan-live-now-failed'), r.work.join(','));
  for (let i = 0; i < 12; i++) { travel(10 * S); r = await tick(); }
  assert.equal(nowPosts(), before + 1, 'one post of its own');
  const st = await b.readState(env.DB);
  assert.match(st.fb.liveVideoId, /^fblive/);
  assert.ok(fbv.get(p.id).deleted || fbv.get(p.id).status === 'SCHEDULED_CANCELED', 'the scheduled one taken down');
  assert.ok(![...outputs.values()].some((o) => o.streamKey === `SCHED-${p.id}`), 'no video still going to it');
  assert.equal(slack(/didn.t start the scheduled live/), 1);
  for (let i = 0; i < 6; i++) { travel(10 * S); await tick(); }
  assert.equal(nowPosts(), before + 1, 'never a second');
});

test('a drop around the start: not taken live while the phone is away; live once it is back', async () => {
  await fresh();
  await schedule(20 * M);
  await tick();
  const p = await plan();
  travel(17 * M); // T-3
  phoneOn('vid8');
  travel(5 * S); await tick();
  travel(70 * S); await tick();
  phoneOff(); // T-1:40, a drop
  for (let i = 0; i < 9; i++) { travel(10 * S); await tick(); } // to about T-0:10
  assert.equal(fbv.get(p.id).status, 'SCHEDULED_UNPUBLISHED', 'nothing live with no video');
  phoneOn('vid8');
  for (let i = 0; i < 4; i++) { travel(10 * S); await tick(); }
  assert.equal(fbv.get(p.id).status, 'LIVE');
});

test('a real reveal run early (10 minutes on air before the start): live on Facebook then, not at the start', async () => {
  await fresh();
  await schedule(40 * M);
  await tick();
  const p = await plan();
  travel(15 * M); // T-25
  phoneOn('vid9');
  travel(5 * S); await tick();
  for (let i = 0; i < 9; i++) { travel(60 * S); await tick(); }
  assert.equal(fbv.get(p.id).status, 'SCHEDULED_UNPUBLISHED', '9 minutes in: still a framing check');
  for (let i = 0; i < 2; i++) { travel(60 * S); await tick(); }
  assert.equal(fbv.get(p.id).status, 'LIVE', 'about 10 minutes in, it is the reveal: live on Facebook');
});

// ─── From the second review ──────────────────────────────────────────────

test('Facebook takes it live on its own while our asks are refused: kept, never taken down, no second post', async () => {
  await fresh();
  await schedule(20 * M);
  await tick();
  const p = await plan();
  travel(20 * M);
  fbSim.refuseLiveNow = true;
  const before = nowPosts();
  phoneOn('vid10');
  travel(5 * S); let r = await tick();
  fbv.get(p.id).status = 'LIVE'; // Facebook started it at its time
  for (let i = 0; i < 14; i++) { travel(10 * S); r = await tick(); }
  assert.equal(nowPosts(), before, 'no post of its own');
  assert.equal(fbv.get(p.id).deleted, undefined, 'the public live never taken down');
  assert.ok((await plan()).liveNowAt, 'noted as live');
  assert.equal(slack(/didn.t start the scheduled live/), 1, 'no new alert (only the earlier test\'s)');
});

test('a long phone test hours before the start never takes the scheduled live live', async () => {
  await fresh();
  await schedule(3 * H);
  await tick();
  const p = await plan();
  travel(60 * M); // T-2h
  phoneOn('vid11');
  travel(5 * S); await tick();
  for (let i = 0; i < 12; i++) { travel(60 * S); await tick(); }
  assert.equal(fbv.get(p.id).status, 'SCHEDULED_UNPUBLISHED', 'still scheduled after 12 minutes, two hours early');
});

test('a drop across the start: once the phone is back it is tried, not given up at once', async () => {
  await fresh();
  await schedule(20 * M);
  await tick();
  const p = await plan();
  travel(18 * M); // T-2
  const before = nowPosts();
  phoneOn('vid12');
  travel(5 * S); await tick();
  travel(30 * S); await tick();
  phoneOff(); // T-1:25, away for 100 s
  for (let i = 0; i < 10; i++) { travel(10 * S); await tick(); }
  phoneOn('vid12'); // back at about T+0:15
  for (let i = 0; i < 3; i++) { travel(10 * S); await tick(); }
  assert.equal(fbv.get(p.id).status, 'LIVE');
  assert.equal(nowPosts(), before, 'no post of its own');
});
