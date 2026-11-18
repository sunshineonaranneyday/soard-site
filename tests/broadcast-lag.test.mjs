/**
 * Stream's public lifecycle lags behind the phone (Nov 17 2026: it said "live" for 18 minutes after the
 * phone stopped). These scenarios, first written by an independent review of test mode, check that the
 * site never splits a reveal on a signal drop, never starts anything on a lifecycle that is only catching
 * up (even when Stream's API fails), and never leaves Facebook paused during a real reveal.
 * Run: node --test tests/broadcast-lag.test.mjs
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
const sim = { live: false, videoUID: null, videoState: 'live-inprogress', inputState: null, inputSince: null, inputFail: false };
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
    if (path === '/subscribers' && method === 'POST') { const sub = kit.subs.get(body.email_address) || { id: kit.nextId++, email_address: body.email_address, state: 'active' }; kit.subs.set(body.email_address, sub); return json({ subscriber: sub }, 201); }
    if (path === '/broadcasts' && method === 'POST') { kit.posts.push(body); return json({ broadcast: { id: 9000 + kit.posts.length } }, 201); }
    return json({ broadcasts: [], subscribers: [], pagination: {} });
  }
  if (url.startsWith('https://hook.test/')) return new Response('ok', { status: 200 });
  return new Response('not mocked: ' + url, { status: 599 });
};
const LIVE_HUB = { idFromName: () => 'main', get: () => ({ async fetch(url) { const p = new URL(url).pathname; return p === '/publish' || p === '/status' ? Response.json({ ok: true, clients: 1 }) : new Response('nf', { status: 404 }); } }) };
let env, b;
const tick = () => b.runTick(env, { source: 'test', force: true });
const outward = (list) => list.filter((c) => (c.url.startsWith('https://graph.facebook.com/') && c.method !== 'GET') || c.url.startsWith('https://api.resend.com/') || c.url.startsWith('https://hook.test/') || (c.url.startsWith('https://api.kit.com/v4/broadcasts') && c.method === 'POST')).map((c) => `${c.method} ${c.url.split('?')[0]}`);
const sends = async (id) => (await env.DB.prepare('SELECT kind, channel FROM broadcast_sends WHERE broadcast_id = ?').bind(id).all()).results.map((r) => `${r.kind}/${r.channel}`);
const iso = () => new Date(Date.now()).toISOString();

before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare(`INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)`).bind('remi', JSON.stringify({ name: 'Remi', slug: 'remi', heroImage: 'kids/remi/hero' }), 'Remi', 2026, 'in-progress').run();
  env = { DB, LIVE_HUB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok', RESEND_API_KEY: 're_test', KIT_API_KEY: 'kit_test', CF_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy', SLACK_WEBHOOK_URL: 'https://hook.test/slack', FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'fbtok', ALERT_EMAILS: 'staff@test' };
  b = await import('../functions/api/_broadcast.js');
  await b.ensureSchema(DB);
  const cfg = await b.readConfig(DB);
  cfg.liveInput = { uid: 'in1' };
  cfg.facebook = { mode: 'persistent', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay' };
  cfg.outputs = { facebook: { uid: 'fbout', enabled: true } };
  await b.writeConfig(DB, cfg);
  await DB.prepare(`INSERT INTO broadcast_reminders (id, channel, address, kid_slug, token, created_at, confirmed_at) VALUES ('r1', 'email', 'fan@example.com', NULL, 'tok1', ?, ?)`).bind(iso(), iso()).run().catch(() => {});
});
after(() => { Date.now = realNow; globalThis.fetch = realFetch; });


const liveSends = async (id) => (await sends(id)).filter((x) => x.startsWith('live/'));
let A;

test('a real reveal that loses signal for 70 seconds stays one reveal: no second "we\'re live", no split', async () => {
  const r0 = await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * H).toISOString() }, 'peter@test');
  assert.equal(r0.success, true, r0.error);
  A = (await b.readState(env.DB)).broadcastId;
  travel(2 * H);
  sim.live = true; sim.videoUID = 'vid1'; sim.inputState = 'connected'; sim.inputSince = iso();
  let r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  for (let i = 0; i < 4; i++) { travel(60 * S); r = await tick(); }
  const before = await liveSends(A);
  const segment = (await b.readState(env.DB)).segmentAt;
  // The phone drops; the lifecycle keeps saying live (as on Nov 17)
  sim.inputState = 'disconnected'; sim.inputSince = iso();
  for (let i = 0; i < 7; i++) { travel(10 * S); r = await tick(); assert.equal(r.state.phase, 'live', `still live ${(i + 1) * 10}s into the drop`); }
  sim.inputState = 'connected'; sim.inputSince = iso(); sim.videoUID = 'vid2'; // a new recording after the drop
  travel(5 * S); r = await tick();
  for (let i = 0; i < 4; i++) { travel(60 * S); r = await tick(); }
  const st = await b.readState(env.DB);
  assert.equal(st.broadcastId, A, 'the same reveal');
  assert.equal(st.kidSlug, 'remi');
  assert.deepEqual(await liveSends(A), before, 'no second "we\'re live"');
  const rows = (await env.DB.prepare('SELECT id FROM broadcasts').all()).results;
  assert.equal(rows.length, 1, 'one History row');
  assert.ok(Date.parse(st.segmentAt) > Date.parse(segment), 'the drop broke the unbroken stretch the Kit list email waits for (it starts again)');
  assert.equal(st.gapSince, null, 'back on');
});

test('the phone stopping for good ends a real reveal about 2 minutes later, even while the lifecycle says live', async () => {
  sim.inputState = 'disconnected'; sim.inputSince = iso();
  const stoppedAt = Date.now();
  let r;
  travel(110 * S); r = await tick();
  assert.equal(r.state.phase, 'live', 'under 2 minutes: could still be a drop');
  travel(15 * S); r = await tick();
  assert.equal(r.state.phase, 'ending');
  assert.equal(Date.parse((await b.readState(env.DB)).disconnectedAt), stoppedAt, 'the grace runs from the real stop');
  travel(5 * S); r = await tick();
  assert.equal(r.state.phase, 'replay', 'ended');
  assert.equal(r.state.id, A);
});

test('after it ends, a lagging lifecycle with a failed Stream read starts nothing', async () => {
  const n = calls.length;
  sim.inputFail = true;
  for (let i = 0; i < 6; i++) { travel(20 * S); const r = await tick(); assert.equal(r.state.phase, 'replay'); assert.equal(r.state.id, A); }
  sim.inputFail = false;
  for (let i = 0; i < 3; i++) { travel(20 * S); const r = await tick(); assert.equal(r.state.phase, 'replay'); }
  assert.deepEqual(outward(calls.slice(n)).filter((c) => !c.includes('hook.test/slack') && !c.includes('hook.test/deploy')), [], 'no emails or Facebook');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM broadcasts').first()).n, 1, 'no new broadcast');
});

test('a switch turned on before a reveal was scheduled never keeps Facebook paused during the real reveal', async () => {
  sim.live = false; sim.inputState = null; sim.inputSince = null;
  for (let i = 0; i < 3; i++) { travel(10 * S); await tick(); }
  await b.adminAction(env, 'reset', {}, 'peter@test');
  let r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, true, r.error);
  assert.equal(outputs.get('fbout').enabled, false);
  travel(5 * M);
  r = await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 60 * M).toISOString() }, 'jobtread');
  travel(31 * M); r = await tick();
  assert.equal(outputs.get('fbout').enabled, true, 'back on 30 minutes before');
  travel(29 * M);
  sim.live = true; sim.videoUID = 'vid7'; sim.inputState = 'connected'; sim.inputSince = iso();
  r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  for (let i = 0; i < 3; i++) { travel(31 * S); r = await tick(); assert.equal(outputs.get('fbout').enabled, true, 'Facebook on during the reveal'); }
  assert.equal(b.quietStatus(await b.readQuiet(env.DB), await b.readState(env.DB)).on, false);
});

test('a test before the reveal, phone stopped, lifecycle lagging, a failed read: the planned reveal is not used up', async () => {
  sim.inputState = 'disconnected'; sim.inputSince = iso();
  for (let i = 0; i < 4; i++) { travel(40 * S); await tick(); }
  await b.adminAction(env, 'reset', {}, 'peter@test');
  sim.live = false; sim.inputState = null;
  travel(2 * M); await tick();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * H).toISOString() }, 'jobtread');
  const planned = (await b.readState(env.DB)).broadcastId;
  await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  sim.live = true; sim.videoUID = 'vid8'; sim.inputState = 'connected'; sim.inputSince = iso();
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  travel(10 * M); await tick();
  sim.inputState = 'disconnected'; sim.inputSince = iso(); // stops; lifecycle keeps saying live
  for (let i = 0; i < 7; i++) { travel(10 * S); r = await tick(); }
  assert.equal((await b.readState(env.DB)).phase, 'scheduled', 'the test ended');
  await b.adminAction(env, 'quietTest', { on: false }, 'peter@test');
  const n = calls.length;
  sim.inputFail = true; travel(20 * S); r = await tick(); sim.inputFail = false;
  for (let i = 0; i < 7; i++) { travel(10 * S); r = await tick(); }
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'scheduled');
  assert.equal(st.broadcastId, planned);
  assert.equal(st.liveAt, null, 'never went live');
  assert.deepEqual(outward(calls.slice(n)), [], 'nothing went out');
});

test('"End the test" with the phone still streaming into the reveal: the test resumes and becomes the reveal at 30 minutes, Facebook on', async () => {
  sim.live = false; sim.inputState = null; sim.inputSince = null;
  for (let i = 0; i < 3; i++) { travel(10 * S); await tick(); }
  await b.adminAction(env, 'reset', {}, 'peter@test');
  travel(2 * M); await tick();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * H).toISOString() }, 'jobtread');
  const planned = (await b.readState(env.DB)).broadcastId;
  await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  travel(80 * M); // T-40
  sim.live = true; sim.videoUID = 'vid9'; sim.inputState = 'connected'; sim.inputSince = iso();
  let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  travel(8 * M); // T-32
  r = await b.adminAction(env, 'endNow', {}, 'peter@test');
  assert.equal(r.state.phase, 'replay', 'the test\'s end shows on the website until 30 minutes before (tEndQuiet)');
  assert.equal((await b.readState(env.DB)).phase, 'scheduled');
  travel(5 * S); r = await tick();
  assert.ok(r.work.includes('test-start'), `the phone is still on, so the test carries on: ${r.work.join(',')}`);
  travel(2 * M + 5 * S); r = await tick();
  assert.ok(r.work.includes('test-became-reveal'), r.work.join(','));
  travel(31 * S); r = await tick();
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'live');
  assert.equal(st.broadcastId, planned);
  assert.equal(st.quiet, undefined);
  assert.equal(outputs.get('fbout').enabled, true, 'Facebook on for the reveal');
  assert.equal(b.quietStatus(await b.readQuiet(env.DB), st).on, false, 'the switch is done');
});

// ─── Second review: what must never start, end or flap ─────────────────────────────────────────────
const fresh = async () => {
  sim.live = false; sim.inputState = null; sim.inputSince = null; sim.inputFail = false;
  travel(60 * S); await tick();
  await b.adminAction(env, 'quietTest', { on: false }, 'peter@test');
  await b.adminAction(env, 'reset', {}, 'peter@test');
  travel(60 * S); await tick();
};
const phoneOn = (vid) => { sim.live = true; sim.videoUID = vid; sim.inputState = 'connected'; sim.inputSince = iso(); };
const phoneOff = () => { sim.inputState = 'disconnected'; sim.inputSince = iso(); }; // the lifecycle (sim.live) lags behind
const broadcastsNow = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM broadcasts').first()).n;

test('End now on a real reveal while the phone keeps streaming: it stays ended, no second "we\'re live"', async () => {
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'live', 'the reveal from the test before is on air');
  const rows = await broadcastsNow();
  const sendsBefore = await liveSends(st.broadcastId);
  const r = await b.adminAction(env, 'endNow', {}, 'peter@test');
  assert.equal(r.state.phase, 'replay');
  for (let i = 0; i < 4; i++) { travel(10 * S); const t = await tick(); assert.equal(t.state.phase, 'replay', 'the phone still on that recording starts nothing'); }
  assert.equal(await broadcastsNow(), rows, 'no new broadcast');
  assert.deepEqual(await liveSends(st.broadcastId), sendsBefore);
});

test('Reset while the lifecycle still reports the recording that ended: nothing starts, even when Stream\'s API fails', async () => {
  phoneOff();
  travel(40 * S);
  await b.adminAction(env, 'reset', {}, 'peter@test');
  const rows = await broadcastsNow();
  for (let i = 0; i < 3; i++) { travel(10 * S); const t = await tick(); assert.equal(t.state.phase, 'idle'); }
  sim.inputFail = true;
  for (let i = 0; i < 3; i++) { travel(10 * S); const t = await tick(); assert.equal(t.state.phase, 'idle', 'a failed read starts nothing on an ended recording'); }
  sim.inputFail = false;
  assert.equal(await broadcastsNow(), rows);
});

test('a phone on for 20 seconds that leaves before the lifecycle catches up starts nothing', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * H).toISOString() }, 'jobtread');
  const planned = (await b.readState(env.DB)).broadcastId;
  sim.live = false; sim.videoUID = 'vid10'; sim.inputState = 'connected'; sim.inputSince = iso(); // Stream has the phone; the lifecycle doesn't say so yet
  travel(5 * S); let r = await tick();
  assert.equal(r.state.phase, 'scheduled');
  travel(15 * S); phoneOff();
  travel(15 * S); sim.live = true; // the lifecycle catches up after the phone has gone
  r = await tick();
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'scheduled', 'the planned reveal is not used up');
  assert.equal(st.broadcastId, planned);
  assert.equal(st.liveAt, null);
});

test('a health record written over by another page (go/no-go, mic check) changes nothing: the ended recording is kept with the reveal', async () => {
  // The lifecycle reports the recording that ended (vid9) while Stream's API fails; health has been rewritten from scratch
  await b.writeHealth(env.DB, b.defaultHealth());
  const before = await b.readState(env.DB);
  sim.live = true; sim.videoUID = 'vid9'; sim.inputFail = true;
  for (let i = 0; i < 3; i++) { travel(10 * S); const t = await tick(); assert.equal(t.state.phase, 'scheduled'); }
  sim.inputFail = false; sim.live = false;
  assert.equal((await b.readState(env.DB)).broadcastId, before.broadcastId);
});

test('one failed read while a reveal is ending holds it: no flap back to live, it ends when Stream answers', async () => {
  await b.adminAction(env, 'update', { scheduledAt: new Date(Date.now() + 60 * S).toISOString() }, 'peter@test');
  phoneOn('vid11');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  const id = (await b.readState(env.DB)).broadcastId;
  travel(2 * M); await tick(); // past the scheduled start
  phoneOff();
  travel(2 * M + 5 * S); r = await tick();
  assert.equal(r.state.phase, 'ending');
  sim.inputFail = true;
  for (let i = 0; i < 3; i++) { travel(5 * S); r = await tick(); assert.equal(r.state.phase, 'ending', 'held, not called a reconnect'); }
  sim.inputFail = false;
  travel(5 * S); r = await tick();
  assert.equal(r.state.phase, 'replay');
  assert.equal(r.state.id, id);
});

test('a 70-second drop while the lifecycle itself says "not live" stays one reveal', async () => {
  await fresh();
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 10 * M).toISOString() }, 'jobtread');
  phoneOn('vid12');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  const id = (await b.readState(env.DB)).broadcastId;
  for (let i = 0; i < 4; i++) { travel(60 * S); r = await tick(); }
  const sendsBefore = await liveSends(id);
  sim.live = false; phoneOff();
  for (let i = 0; i < 7; i++) { travel(10 * S); r = await tick(); assert.equal(r.state.phase, 'live', `${(i + 1) * 10}s into the drop`); }
  phoneOn('vid13');
  travel(5 * S); r = await tick();
  assert.equal(r.state.phase, 'live');
  assert.equal(r.state.id, id, 'the same reveal');
  for (let i = 0; i < 3; i++) { travel(60 * S); await tick(); }
  assert.deepEqual(await liveSends(id), sendsBefore, 'no second "we\'re live"');
});

test('a switch turned on before the reveal is cleared when the reveal goes live: a phone back after a long outage is never a test', async () => {
  await fresh();
  let r = await b.adminAction(env, 'quietTest', { on: true }, 'peter@test');
  assert.equal(r.success, true, r.error);
  travel(5 * M);
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 60 * M).toISOString() }, 'jobtread');
  travel(61 * M); await tick(); // the phone starts just after the scheduled time
  phoneOn('vid14');
  travel(5 * S); r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  assert.equal((await b.readQuiet(env.DB)).until, null, 'the switch is done');
  phoneOff();
  travel(2 * M + 5 * S); await tick(); travel(5 * S); r = await tick();
  assert.equal(r.state.phase, 'replay');
  phoneOn('vid15');
  travel(5 * S); r = await tick();
  assert.ok(!r.work.includes('test-start'), `not a test: ${r.work.join(',')}`);
  assert.equal(outputs.get('fbout').enabled, true, 'Facebook on');
});

test('a disconnect Stream gives no time for: the lifecycle decides, so a reveal still ends', async () => {
  await fresh();
  phoneOn('vid16');
  travel(5 * S); let r = await tick();
  assert.equal(r.state.phase, 'live');
  sim.inputState = 'disconnected'; sim.inputSince = null; sim.live = false;
  travel(5 * S); r = await tick();
  assert.equal(r.state.phase, 'ending');
  travel(50 * S); r = await tick();
  assert.equal(r.state.phase, 'replay');
});
