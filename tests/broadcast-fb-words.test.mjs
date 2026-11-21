/**
 * The Facebook live post's words (Peter, Nov 20 2026: "Yes, before 4 PM", then "on facebook post, the link must be
 * in the comments, not the post, otherwise FB will deprioritize it"). Made only when the phone goes live, never
 * ahead of it, the post carries the kid's story as the live page's lead has it and "Live now", with no link; the
 * Page's first comment on it is the link to watch on our website and leave the family a message
 * (/live/<kid>/?src=facebook, so History counts Facebook), once per post. If Facebook won't take the comment the
 * post stands and staff are told, with the words to paste.
 * Run: node --test tests/broadcast-fb-words.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const travel = (ms) => { offset += ms; };
const M = 60e3, S = 1000;
const sim = { live: false, videoUID: null, inputState: null, inputSince: null, videoState: 'live-inprogress' };
// How the fake Facebook answers a comment: 'ok', 'permission' (#200, as when the token lacks pages_manage_engagement), or a count of failures first
const fbc = { mode: 'ok', failFirst: 0 };
const outputs = new Map([['fbout', { uid: 'fbout', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', enabled: true }]]);
const calls = [];
const texts = []; // what Twilio was asked to send: { to, body }
const STAFF_PHONE = '+14045550123';
let fbSeq = 0;
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
  if (out && method === 'DELETE') { outputs.delete(out[1]); return json({ success: true, result: null }); }
  if (url.includes('/stream/live_inputs/in1/outputs') && method === 'POST') { const uid = `apiout${outputs.size}`; outputs.set(uid, { uid, enabled: true }); return json({ success: true, result: { uid } }); }
  if (url.includes('/stream/live_inputs/in1/outputs')) return json({ success: true, result: [...outputs.values()].map((o) => ({ ...o })) });
  if (url.includes('/stream/live_inputs/in1/videos')) return json({ success: true, result: [] });
  if (url.includes('/stream?per_page=1')) return json({ success: true, result: [] });
  if (url.includes('/stream/live_inputs/in1')) return json({ success: true, result: { uid: 'in1', status: { current: { state: sim.inputState || (sim.live ? 'connected' : 'disconnected'), statusEnteredAt: sim.inputSince || undefined } } } });
  if (/\/stream\/vid\d+\/captions\//.test(url)) return json({ success: true, result: {} });
  const vid = url.match(/\/stream\/(vid\d+)$/);
  if (vid) return json({ success: true, result: { uid: vid[1], created: new Date(Date.now()).toISOString(), duration: 60, status: { state: sim.videoState } } });
  if (url.startsWith('https://graph.facebook.com/')) {
    if (method === 'POST' && url.includes('/live_videos')) return json({ id: `fblive${++fbSeq}`, secure_stream_url: 'rtmps://live-api-s.facebook.com:443/rtmp/FB-123?s_bl=1' });
    // A live video: its video is fbvid<n>, as Facebook gives (video{id})
    const lv = url.match(/\/fblive(\d+)(\?|$)/);
    if (lv && method === 'GET') return json({ id: `fblive${lv[1]}`, status: 'LIVE', video: { id: `fbvid${lv[1]}`, permalink_url: `/SunshineOnaRanneyDay/videos/${lv[1]}/` }, permalink_url: `/SunshineOnaRanneyDay/videos/${lv[1]}/` });
    if (method === 'POST' && /\/fb(vid|live)\d+\/comments$/.test(url.split('?')[0])) {
      if (fbc.mode === 'permission') return json({ error: { message: '(#200) Permissions error', code: 200 } }, 403);
      if (fbc.failFirst > 0) { fbc.failFirst--; return json({ error: { message: 'An unexpected error has occurred. Please retry your request later.', code: 2 } }, 500); }
      return json({ id: `comment${calls.length}` });
    }
    return json({ data: [] });
  }
  if (url.startsWith('https://api.twilio.com/')) { texts.push({ to: init.body.get('To'), body: init.body.get('Body') }); return json({ sid: `SM${texts.length}` }, 201); }
  if (url.startsWith('https://api.resend.com/')) return json({ data: [] });
  if (url.startsWith('https://api.kit.com/v4/')) return json({ broadcasts: [], subscribers: [], tags: [], pagination: {} }, method === 'POST' ? 201 : 200);
  if (url.startsWith('https://hook.test/')) return new Response('ok', { status: 200 });
  return new Response('not mocked: ' + url, { status: 599 });
};
const LIVE_HUB = { idFromName: () => 'main', get: () => ({ async fetch(url) { const p = new URL(url).pathname; return p === '/publish' || p === '/status' ? Response.json({ ok: true, clients: 1 }) : new Response('nf', { status: 404 }); } }) };
let env, b, config;
const tick = () => b.runTick(env, { source: 'test', force: true });
const iso = () => new Date(Date.now()).toISOString();
const isGraph = (c) => c.url.startsWith('https://graph.facebook.com/');
const fbPosts = (from = 0) => calls.slice(from).filter((c) => isGraph(c) && c.url.includes('/live_videos') && c.method === 'POST');
const fbComments = (from = 0) => calls.slice(from).filter((c) => isGraph(c) && c.method === 'POST' && /\/comments$/.test(c.url.split('?')[0]));
const fbEnds = (from = 0) => calls.slice(from).filter((c) => isGraph(c) && c.method === 'POST' && /end_live_video/.test(String(c.body)));
const fbWrites = (from = 0) => calls.slice(from).filter((c) => isGraph(c) && c.method !== 'GET');
const slack = (from, re) => calls.slice(from).filter((c) => c.url === 'https://hook.test/slack' && re.test(String(c.body || '')));
const params = (c) => new URLSearchParams(String(c.body));

const REMI_STORY = 'Remi has a rare condition that makes stairs impossible.  Now   SOARD is building a bedroom on the ground floor.';
before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  const kid = (slug, name, data) => DB.prepare(`INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)`).bind(slug, JSON.stringify({ name, slug, ...data }), name, 2026, 'in-progress').run();
  await kid('remi', 'Remi', { heroImage: 'kids/remi/hero', heroSummary: REMI_STORY, shortDescription: 'Not this one: the lead uses heroSummary first.' });
  await kid('ava', 'Ava', { shortDescription: 'Ava needs a sensory room to rest and play.' });
  await kid('noor', 'Noor', {});
  env = { DB, LIVE_HUB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok', RESEND_API_KEY: 're_test', KIT_API_KEY: 'kit_test', CF_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy', SLACK_WEBHOOK_URL: 'https://hook.test/slack', FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'fbtok', ALERT_EMAILS: 'staff@test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'twtok', TWILIO_FROM: '+14045550100' };
  b = await import('../functions/api/_broadcast.js');
  await b.ensureSchema(DB);
  const cfg = await b.readConfig(DB);
  cfg.liveInput = { uid: 'in1' };
  cfg.facebook = { mode: 'api', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay' };
  cfg.outputs = { facebook: { uid: 'fbout', enabled: true } };
  cfg.kitLive = { enabled: false };
  await b.writeConfig(DB, cfg);
  config = await b.readConfig(DB);
});
after(() => { Date.now = realNow; globalThis.fetch = realFetch; });

// A staff number on the alert list for the length of fn (texts go only to those); none otherwise
const withStaffPhone = async (fn) => {
  const set = async (phones) => { const c = await b.readConfig(env.DB); c.alerts = { ...(c.alerts || {}), phones }; await b.writeConfig(env.DB, c); };
  await set([STAFF_PHONE]);
  try { return await fn(); } finally { await set([]); }
};
// The comment-failure texts: the alert, then the words alone
const fbCommentTexts = (from) => texts.slice(from).filter((t) => /Facebook link comment didn't post|^Watch on our website too/.test(t.body));
const remiLink = () => `${b.liveUrlFor({ kidSlug: 'remi' })}?src=facebook`;
const REMI_COMMENT = () => `Watch on our website too, and leave a message for the family: ${remiLink()}`;
const fresh = async () => {
  sim.live = false; sim.inputState = 'disconnected'; sim.inputSince = iso(); sim.videoState = 'ready';
  travel(20 * M); await tick();
  await b.adminAction(env, 'reset', {}, 'peter@test');
  travel(60 * S); await tick();
  await env.DB.prepare(`UPDATE kids SET data = json_remove(data, '$.revealVideoUrl') WHERE slug = 'remi'`).run();
  sim.videoState = 'live-inprogress';
};
// A scheduled reveal for Remi; the phone connects at its start. Returns the call index from when it was scheduled
const goLiveRemi = async (vid, ticksAfter = 3) => {
  const from = calls.length;
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * M).toISOString() }, 'jobtread');
  for (let i = 0; i < 3; i++) { travel(20 * S); await tick(); }
  const before = calls.length;
  sim.live = true; sim.videoUID = vid; sim.inputState = 'connected'; sim.inputSince = iso();
  travel(65 * S); const r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  for (let i = 0; i < ticksAfter; i++) { travel(30 * S); await tick(); }
  return { from, before };
};

test("the post's words: the kid's story as the live page's lead has it and Live now, with no link; the link is the comment", async () => {
  const w = await b.fbLiveWords(env.DB, { kidSlug: 'remi', kidName: 'Remi', title: "Remi's room reveal", message: "Watch Remi's room reveal live" }, config);
  assert.equal(w.title, "Remi's room reveal", 'the title is unchanged');
  assert.equal(w.description, [
    'Remi has a rare condition that makes stairs impossible. Now SOARD is building a bedroom on the ground floor.',
    'Live now: watch the moment Remi sees the new room for the first time.',
  ].join('\n\n'));
  assert.doesNotMatch(w.description, /https?:|www\.|\.com/, 'no link in the post');
  assert.equal(w.comment, REMI_COMMENT());
  assert.match(remiLink(), /^https:\/\/[^/]+\/live\/remi\/\?src=facebook$/);
  assert.doesNotMatch(w.description + w.comment, /—/, 'no em dashes');
});

test('no heroSummary: the short description, as the live page does; neither: the Live now line alone', async () => {
  const ava = await b.fbLiveWords(env.DB, { kidSlug: 'ava', kidName: 'Ava', title: "Ava's room reveal", message: "Watch Ava's room reveal live" }, config);
  assert.equal(ava.description, 'Ava needs a sensory room to rest and play.\n\nLive now: watch the moment Ava sees the new room for the first time.');
  const noor = await b.fbLiveWords(env.DB, { kidSlug: 'noor', kidName: 'Noor', title: "Noor's room reveal", message: "Watch Noor's room reveal live" }, config);
  assert.equal(noor.description, 'Live now: watch the moment Noor sees the new room for the first time.');
  assert.match(noor.comment, /\/live\/noor\/\?src=facebook$/);
  const gone = await b.fbLiveWords(env.DB, { kidSlug: 'nobody', kidName: 'Sam', title: "Sam's room reveal", message: '' }, config);
  assert.equal(gone.description, 'Live now: watch the moment Sam sees the new room for the first time.', 'a kid with no row still gets the line');
});

test("staff's own message takes the Live now line's place; a broadcast with no kid keeps staff's words and gets no comment", async () => {
  const own = await b.fbLiveWords(env.DB, { kidSlug: 'remi', kidName: 'Remi', title: 'Remi sees the new room!', message: 'Join us for Remi and the whole crew.' }, config);
  assert.equal(own.title, 'Remi sees the new room!');
  assert.ok(own.description.endsWith('\n\nJoin us for Remi and the whole crew.'), own.description);
  assert.doesNotMatch(own.description, /Live now: watch/);
  const defaults = await b.fbLiveWords(env.DB, { kidSlug: 'remi', kidName: 'Remi', title: "Remi's room reveal", message: config.defaults.message }, config);
  assert.match(defaults.description, /Live now: watch the moment Remi sees/, "the site's default message counts as no message");
  const none = await b.fbLiveWords(env.DB, { kidSlug: null, title: 'Live room reveal', message: "It's reveal day! We're live right now." }, config);
  assert.deepEqual(none, { title: 'Live room reveal', description: "It's reveal day! We're live right now.", comment: null });
});

test('a scheduled reveal: nothing on Facebook before the phone goes live, then one post with no link and one Page comment carrying it', async () => {
  const { from, before } = await goLiveRemi('vid1', 6);
  assert.deepEqual(fbWrites(from).filter((c) => calls.indexOf(c) < before), [], 'nothing written to Facebook ahead of go-live');
  const posts = fbPosts(from);
  assert.equal(posts.length, 1, 'one Facebook post');
  const p = params(posts[0]);
  assert.equal(p.get('status'), 'LIVE_NOW');
  assert.equal(p.get('title'), "Remi's room reveal");
  assert.equal(p.get('description'), 'Remi has a rare condition that makes stairs impossible. Now SOARD is building a bedroom on the ground floor.\n\nLive now: watch the moment Remi sees the new room for the first time.');
  assert.doesNotMatch(p.get('description'), /https?:|src=facebook/, 'no link in the post');
  const comments = fbComments(from);
  assert.equal(comments.length, 1, 'exactly one comment, however many ticks follow');
  assert.match(comments[0].url.split('?')[0], /\/fbvid\d+\/comments$/, "on the live video's video");
  assert.equal(params(comments[0]).get('message'), REMI_COMMENT());
  assert.ok(calls.indexOf(comments[0]) > calls.indexOf(posts[0]), 'after the post is made');
  const st = await b.readState(env.DB);
  assert.equal(st.fb?.liveVideoId, `fblive${fbSeq}`, 'the post is the one the reveal follows');
});

test('Facebook refuses the comment (no permission): the post stands, no retries, staff are told once with the words to paste', async () => {
  await fresh();
  fbc.mode = 'permission';
  const t0 = texts.length;
  const { from } = await withStaffPhone(() => goLiveRemi('vid2', 6));
  // Texted too (Peter, Nov 21 2026, "1b"): the alert, then the comment alone so a long-press copies exactly it
  const sms = fbCommentTexts(t0);
  assert.equal(sms.length, 2, 'two texts, once, however many ticks follow');
  assert.ok(sms.every((t) => t.to === STAFF_PHONE), 'to the staff number on the alert list');
  assert.match(sms[0].body, /^🚨 SOARD ALERT: Facebook link comment didn't post\n/);
  assert.match(sms[0].body, /Copy the next text\. Comment it on the live video as the SOARD Page, not your own profile\./);
  assert.match(sms[0].body, /\nhttps:\/\/www\.facebook\.com\/\S+$/, 'ends with the link to the post (or the Page)');
  assert.ok(sms[0].body.length <= 306, 'two segments at most');
  assert.equal(sms[1].body, REMI_COMMENT(), 'the second text is the comment alone, exactly the words Facebook refused');
  assert.ok(texts.indexOf(sms[0]) < texts.indexOf(sms[1]), 'the alert first, the words second');
  assert.equal(fbPosts(from).length, 1, 'the post is made');
  assert.equal(fbComments(from).length, 1, 'tried once: a missing permission is not retried');
  assert.equal(fbEnds(from).length, 0, 'the post is never taken down');
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'live', 'the reveal carries on');
  const alerts = slack(from, /website link comment/);
  assert.equal(alerts.length, 1, 'staff told once');
  assert.ok(String(alerts[0].body).includes('src=facebook'), 'with the words to paste');
  assert.ok(String(alerts[0].body).includes('pages_manage_engagement'), 'and what Facebook needs');
  fbc.mode = 'ok';
});

test('a passing Facebook error: tried again on the next tick, one comment in the end, nobody alerted', async () => {
  await fresh();
  fbc.failFirst = 1;
  const t0 = texts.length;
  const { from } = await withStaffPhone(() => goLiveRemi('vid3', 6));
  const comments = fbComments(from);
  assert.equal(comments.length, 2, 'one failed try, then the one that worked');
  assert.equal(fbc.failFirst, 0);
  assert.equal(slack(from, /website link comment/).length, 0, 'no alert');
  assert.equal(fbCommentTexts(t0).length, 0, 'and no texts');
});

test('Facebook keeps failing: three tries, then staff are told once; the post stands', async () => {
  await fresh();
  fbc.failFirst = 99;
  const t0 = texts.length;
  const { from } = await withStaffPhone(() => goLiveRemi('vid4', 8));
  assert.equal(fbComments(from).length, 3, 'three tries at most');
  assert.equal(slack(from, /website link comment/).length, 1, 'one alert');
  const sms = fbCommentTexts(t0);
  assert.equal(sms.length, 2, 'texted once: the alert and the words');
  assert.equal(sms[1].body, REMI_COMMENT());
  assert.equal(fbEnds(from).length, 0, 'the post stands');
  fbc.failFirst = 0;
});
