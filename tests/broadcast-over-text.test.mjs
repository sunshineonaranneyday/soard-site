/**
 * "Is the reveal over?" by text (Peter, Nov 18 2026). The site can't tell a dropped signal from the crew stopping the
 * phone because the reveal is done, so when the phone stops it texts the staff alert numbers, and their Y ends it now
 * (as the automatic end would, still open 15 minutes to the phone) while N keeps it on air, Reconnecting, for up to
 * 15 minutes. Replies come in through Twilio's signed incoming-message webhook (/api/twilio-inbound).
 * Run: node --test tests/broadcast-over-text.test.mjs
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
const PHONE1 = '+14045550123', PHONE2 = '+16785550199', STRANGER = '+12125550142';
const INBOUND = 'https://sunshineonaranneyday.com/api/twilio-inbound';

// ─── Fake network: Stream (main feed in1, rehearsal feed rin1), Facebook, Kit, Slack, Twilio ──
const sim = { live: false, videoUID: null, videoState: 'live-inprogress', inputState: null, inputSince: null, durations: {} };
const rehearsalFeed = { live: false, videoUID: null };
const outputs = new Map([['fbout', { uid: 'fbout', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', enabled: true }]]);
const calls = [];
const texts = [];  // { to, body }
const service = { inbound_request_url: 'https://old.example.com/sms', inbound_method: 'GET', use_inbound_webhook_on_number: true };
const kit = { subs: new Map(), posts: [], nextId: 500 };
const kitTags = fakeKitTags();
let fbSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || input?.href || input);
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ url, method, body: init.body, headers: init.headers });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://api.twilio.com/')) { texts.push({ to: init.body.get('To'), body: init.body.get('Body') }); return json({ sid: `SM${texts.length}` }, 201); }
  if (url.startsWith('https://messaging.twilio.com/v1/Services/MG1')) {
    if (method === 'POST') {
      const f = init.body;
      Object.assign(service, { inbound_request_url: f.get('InboundRequestUrl'), inbound_method: f.get('InboundMethod'), use_inbound_webhook_on_number: f.get('UseInboundWebhookOnNumber') === 'true' });
    }
    return json({ sid: 'MG1', friendly_name: 'SOARD alerts', ...service });
  }
  const lc = url.match(/cloudflarestream\.com\/(\w+)\/lifecycle$/);
  if (lc) {
    const f = lc[1] === 'rin1' ? rehearsalFeed : sim;
    return json({ isInput: true, videoUID: f.live ? f.videoUID : null, live: f.live });
  }
  if (url.includes('cloudflarestream.com/') && url.endsWith('/views')) return json({ liveViewers: 2 });
  const out = url.match(/\/stream\/live_inputs\/in1\/outputs\/([a-z0-9]+)$/);
  if (out && method === 'PUT') { const o = outputs.get(out[1]); if (o) o.enabled = JSON.parse(init.body).enabled; return json({ success: true, result: o }); }
  if (url.includes('/stream/live_inputs/in1/outputs') && method === 'POST') { const uid = `apiout${outputs.size}`; outputs.set(uid, { uid, enabled: true }); return json({ success: true, result: { uid } }); }
  if (url.includes('/stream/live_inputs/in1/outputs')) return json({ success: true, result: [...outputs.values()].map((o) => ({ ...o })) });
  if (url.includes('/stream/live_inputs/') && url.includes('/videos')) return json({ success: true, result: [] });
  if (url.includes('/stream?per_page=1')) return json({ success: true, result: [] });
  if (url.includes('/stream/live_inputs/in1')) {
    return json({ success: true, result: { uid: 'in1', status: { current: { state: sim.inputState || (sim.live ? 'connected' : 'disconnected'), statusEnteredAt: sim.inputSince || undefined } } } });
  }
  if (/\/stream\/vid\w+\/captions\//.test(url)) return json({ success: true, result: {} });
  const vid = url.match(/\/stream\/(vid\w+)$/);
  if (vid) return json({ success: true, result: { uid: vid[1], created: new Date(Date.now()).toISOString(), duration: sim.durations[vid[1]] ?? 60, status: { state: sim.videoState } } });
  if (url.startsWith('https://graph.facebook.com/')) {
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
const published = []; // what open pages were sent (the hub's state frames)
const LIVE_HUB = { idFromName: () => 'main', get: () => ({ async fetch(url, init) { const p = new URL(url).pathname; if (p === '/publish') published.push(JSON.parse(init.body)); return p === '/publish' || p === '/status' ? Response.json({ ok: true, clients: 1 }) : new Response('nf', { status: 404 }); } }) };

let env, b, notify, inbound, sig, rehearsal, overLink, overPage, overAnswer;
/** The "Or tap:" link's token in a question */
const linkIn = (body) => (/\/over\/([^\s]+)$/.exec(body) || [])[1] || null;
const tick = () => b.runTick(env, { source: 'test', force: true });
const iso = () => new Date(Date.now()).toISOString();
const questions = (from = 0) => texts.slice(from).filter((t) => t.body.includes('Is the reveal over?'));
const isFbEnd = (c) => c.url.startsWith('https://graph.facebook.com/') && /\/fblive\d+(\?|$)/.test(c.url) && c.method === 'POST';
const fbEnds = () => calls.filter(isFbEnd).length;
const slack = (re) => calls.filter((c) => c.url === 'https://hook.test/slack' && re.test(c.body || '')).length;
const kidVideo = async () => JSON.parse((await env.DB.prepare('SELECT data FROM kids WHERE slug = ?').bind('remi').first()).data).revealVideoUrl;
const replaySends = async (id) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM broadcast_sends WHERE broadcast_id = ? AND kind = 'replay'`).bind(id).first()).n;
const events = async (id, type) => (await env.DB.prepare('SELECT meta FROM broadcast_events WHERE broadcast_id IS ? AND type = ? ORDER BY id').bind(id, type).all()).results.map((r) => JSON.parse(r.meta || 'null'));
const sig_ = (s) => JSON.stringify({ ...s, rev: undefined, updatedAt: undefined });
/** env.DB, but statements `fails(sql)` picks throw as a D1 outage would */
const failingDB = (fails) => new Proxy(env.DB, { get(t, p) {
  if (p === 'prepare') return (sql) => { if (fails(sql)) throw new Error('D1_ERROR: database unavailable'); return t.prepare(sql); };
  const v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
} });

before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await DB.prepare(`INSERT INTO kids (slug, data, name, year, status) VALUES (?, ?, ?, ?, ?)`).bind('remi', JSON.stringify({ name: 'Remi', slug: 'remi', heroImage: 'kids/remi/hero' }), 'Remi', 2026, 'in-progress').run();
  env = {
    DB, LIVE_HUB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok', RESEND_API_KEY: 're_test', KIT_API_KEY: 'kit_test', CF_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy',
    SLACK_WEBHOOK_URL: 'https://hook.test/slack', FB_PAGE_ID: '123', FB_PAGE_TOKEN: 'fbtok', ALERT_EMAILS: 'staff@test',
    TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'twtok', TWILIO_MESSAGING_SERVICE_SID: 'MG1',
  };
  b = await import('../functions/api/_broadcast.js');
  notify = await import('../functions/api/_broadcast-notify.js');
  inbound = await import('../functions/api/twilio-inbound.js');
  sig = (await import('../functions/api/twilio-status.js')).twilioSignature;
  rehearsal = await import('../functions/api/_broadcast-rehearsal.js');
  overLink = await import('../functions/api/_over-link.js');
  overPage = await import('../functions/over/[token].js');
  overAnswer = await import('../functions/api/over-answer.js');
  await b.ensureSchema(DB);
  const cfg = await b.readConfig(DB);
  cfg.liveInput = { uid: 'in1' };
  cfg.rehearsalInput = { uid: 'rin1' };
  cfg.facebook = { mode: 'api', pageUrl: 'https://www.facebook.com/SunshineOnaRanneyDay' };
  cfg.outputs = { facebook: { uid: 'fbout', enabled: true } };
  cfg.alerts = { emails: [], phones: [PHONE1, PHONE2] };
  await b.writeConfig(DB, cfg);
  await DB.prepare(`INSERT INTO broadcast_reminders (id, channel, address, kid_slug, token, created_at, confirmed_at) VALUES ('r1', 'email', 'fan@example.com', NULL, 'tok1', ?, ?)`).bind(iso(), iso()).run().catch(() => {});
  // Replies reach the site (as connectTextReplies leaves it; the Twilio calls themselves are tested at the end)
  await setRepliesOn(true);
});
const setRepliesOn = (on) => env.DB.prepare(`INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES ('text-replies', ?, ?)`).bind(JSON.stringify({ connected: on, url: on ? INBOUND : null }), iso()).run();
after(() => { Date.now = realNow; globalThis.fetch = realFetch; });

/** A text to the alert number, as Twilio posts it (signed unless told otherwise) */
let smsSeq = 0;
async function reply(body, { from = PHONE1, sign = true, signature = null, extra = {}, withEnv = null, beforeWait = null } = {}) {
  const params = { ToCountry: 'US', SmsMessageSid: `SM${++smsSeq}`, MessageSid: `SM${smsSeq}`, AccountSid: 'AC1', MessagingServiceSid: 'MG1', From: from, To: '+18885550100', Body: body, NumMedia: '0', ...extra };
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const s = signature ?? (sign ? await sig('twtok', INBOUND, params) : null);
  if (s) headers['X-Twilio-Signature'] = s;
  const pending = [];
  const t0 = realNow();
  const res = await inbound.onRequestPost({ env: withEnv || env, waitUntil: (p) => pending.push(p), request: new Request(INBOUND, { method: 'POST', headers, body: new URLSearchParams(params).toString() }) });
  const ms = realNow() - t0; // how long Twilio waited for the reply
  if (beforeWait) await beforeWait();
  for (let i = 0; i < pending.length; i++) await pending[i];
  const text = await res.text();
  const m = text.match(/<Message>([^]*)<\/Message>/);
  return { ms, status: res.status, type: res.headers.get('content-type') || '', text, message: m ? m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null };
}

const phoneOn = (vid) => { sim.live = true; sim.videoUID = vid; sim.inputState = 'connected'; sim.inputSince = iso(); };
const phoneOff = () => { sim.inputState = 'disconnected'; sim.inputSince = iso(); }; // the lifecycle lags behind, as on Nov 17
const fresh = async () => {
  sim.live = false; sim.inputState = null; sim.inputSince = null; sim.videoState = 'live-inprogress';
  travel(20 * M); await tick();
  await b.adminAction(env, 'reset', {}, 'peter@test');
  travel(60 * S); await tick();
  await env.DB.prepare(`UPDATE kids SET data = json_remove(data, '$.revealVideoUrl') WHERE slug = 'remi'`).run();
};
// Scheduled 2 minutes out and running past it, so a stop afterwards is the reveal ending (before it: a framing check)
const goLiveRemi = async (vid) => {
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * M).toISOString() }, 'jobtread');
  phoneOn(vid);
  travel(5 * S); const r = await tick();
  assert.ok(r.work.includes('auto-start'), r.work.join(','));
  for (let i = 0; i < 4; i++) { travel(60 * S); await tick(); }
  return (await b.readState(env.DB)).broadcastId;
};
// The phone stops and stays away long enough to be asked (10 s, the feed monitor's wait): not at 4 s, asked at 12 s
const dropAndAsk = async () => {
  phoneOff();
  travel(4 * S); const early = await tick();
  assert.ok(!early.work.includes('asked-if-over'), `not yet at 4 s: ${early.work.join(',')}`);
  travel(8 * S); const r = await tick();
  assert.ok(r.work.includes('asked-if-over'), r.work.join(','));
  return r;
};
const ENDED = 'Ended. Viewers see the last moments, then Thank you for watching. The replay follows in a few minutes.';
const HELD = "OK, staying live. Viewers see Reconnecting until the phone is back (up to 15 min). Reply Y if it's over.";

// ─── Reading a reply ────────────────────────────────────────────────

test('only clear answers count (ending a live reveal must be deliberate); anything else, reactions included, is asked again', () => {
  for (const y of ['Y', 'y', 'y.', 'Yes', 'YES!', ' yes ', 'yep', 'Yeah', 'yup', "Yes it's over", 'yes it’s over', "It's over.", 'its over', 'over', 'Over!', 'done', 'Done.', '👍', '👍🏽']) assert.equal(inbound.readAnswer(y), 'yes', y);
  for (const n of ['N', 'n', 'No', 'NO.', 'nope', 'not over', 'Not over!', 'not yet', 'dropped', 'Signal dropped', 'keep going']) assert.equal(inbound.readAnswer(n), 'no', n);
  // What the review found read as Y or N before: none is a clear answer
  for (const x of ['not quite over', 'not really over', 'far from over', 'almost over', 'nearly over', 'Never over', 'Not even close to over', 'Is it over?', 'No idea',
    'ok', 'what?', '', 'Nah', 'No, it\'s over', 'yes it dropped', 'end it', 'Not over yet', 'yes please',
    'Liked “SOARD: The stream from Remi\'s reveal stopped at 4:21 PM. Is the reveal over? Reply Y if it\'s over, or N if the signal dropped (viewers see Reconnecting).”',
    'Disliked “Is the reveal over?”', 'Reacted 👍 to “Is the reveal over?”', 'Loved “Is the reveal over?”']) assert.equal(inbound.readAnswer(x), null, x);
});

test('Twilio\'s own words (STOP, START, HELP and the like) are Twilio\'s; YES is still an answer', () => {
  for (const k of ['STOP', 'stop', 'Stop.', 'END', 'quit', 'CANCEL', 'UNSUBSCRIBE', 'STOPALL', 'START', 'unstop', 'HELP', 'info']) assert.equal(inbound.isKeyword(k), true, k);
  for (const w of ['Y', 'yes', 'N', 'over', 'end it']) assert.equal(inbound.isKeyword(w), false, w);
  assert.equal(inbound.isKeyword('YES', 'START'), false, 'Twilio counts YES as opt-in, but here it answers the question');
  assert.equal(inbound.isKeyword('arret', 'STOP'), true, 'a STOP word Twilio was set up with');
});

test('the question names the kid and the time, in one plain text; a test\'s opens "Test: "', () => {
  const at = '2026-11-18T21:21:00Z';
  const now = Date.parse('2026-11-18T21:22:00Z');
  assert.equal(notify.clockTime(at, 'America/New_York', now), '4:21 PM');
  assert.equal(notify.clockTime(at, 'America/New_York', Date.parse('2026-11-19T15:00:00Z')), 'Wed, Nov 18 at 4:21 PM', 'another day says which');
  const q = notify.overQuestionText({ kidName: 'Dylan', at, tz: 'America/New_York' });
  assert.equal(q, `SOARD: The stream from Dylan's reveal stopped at ${notify.clockTime(at, 'America/New_York')}. Is the reveal over? Reply Y if it's over, or N if the signal dropped (viewers see Reconnecting).`);
  assert.ok(q.length <= 160 && /^[\x20-\x7E]+$/.test(q), 'one plain text segment');
  assert.match(notify.overQuestionText({ kidName: null, at, tz: 'America/New_York', test: true }), /^Test: The reveal's stream stopped at \d{1,2}:\d\d [AP]M\. Is the reveal over\? /);
  assert.match(notify.overQuestionText({ kidName: 'José Ramírez', at }), /^SOARD: The stream from Jose's reveal stopped/, 'the first name, in plain letters');
  // A long name with a long time would make two texts: the name gives way, never a second segment
  const long = notify.overQuestionText({ kidName: 'Maximilliano', at: '2026-11-18T17:59:00Z', tz: 'America/New_York' });
  assert.ok(long.length <= 160, long.length);
  assert.match(long, /^SOARD: The reveal's stream stopped at 12:59 PM\./);
  const fits = notify.overQuestionText({ kidName: 'Christopher', at: '2026-11-18T14:05:00Z', tz: 'America/New_York' });
  assert.match(fits, /^SOARD: The stream from Christopher's reveal stopped at 9:05 AM\./, 'named when it fits');
  assert.equal(fits.length, 160);
  assert.match(notify.overQuestionText({ kidName: 'Dylan', at: '2026-11-17T21:21:00Z', tz: 'America/New_York' }), / stopped at 4:21 PM\. /, 'the time alone, never the day');
});

test('no text ever asks for one of Twilio\'s opt-out words (a staffer answering "End" would be unsubscribed from every alert)', () => {
  const OPT_OUT = /\b(stop|stopall|end|cancel|quit|unsubscribe)\b/i;
  const cfg = { timezone: 'America/New_York' };
  const at = new Date(Date.now()).toISOString();
  const state = { endedAt: at, rejoinUntil: new Date(Date.now() + 15 * M).toISOString(), endedBy: 'text from …0123' };
  const outcomes = ['ended', 'test-ended', 'pre-show', 'held', 'test-held', 'phone-back', 'not-asked', 'already-ended', 'slow', 'busy', 'nothing'];
  const all = [
    notify.overQuestionText({ kidName: 'Dylan', at }), notify.overQuestionText({ at, test: true }), inbound.HELP_TEXT, inbound.BUSY_TEXT,
    ...outcomes.flatMap((outcome) => ['yes', 'no'].map((a) => inbound.answerReply(a, { outcome, state, config: cfg }))),
    inbound.answerReply('yes', { outcome: 'already-ended', state: { ...state, endedBy: null }, config: cfg }),
    inbound.answerReply('yes', { outcome: 'already-ended', state: { ...state, endedBy: 'peter@soardcharity.com' }, config: cfg }),
  ];
  for (const text of all) assert.doesNotMatch(text, OPT_OUT, text);
  assert.doesNotMatch(notify.overQuestionText({ kidName: 'Dylan', at }), /end it/i, 'the old "Reply Y to end it now" is gone');
});

test('tAnswer: only a stream on air with its phone away changes; Y ends it as the automatic end would, N holds it on air', () => {
  const cfg = b.defaultConfig();
  const t = Date.now();
  const at = (ms) => new Date(t + ms).toISOString();
  const onAir = { ...b.defaultState(), broadcastId: 'live-1', phase: 'live', source: 'stream', liveAt: at(-30 * M), segmentAt: at(-30 * M), scheduledAt: at(-25 * M), liveVideoUid: 'v1' };
  const gap = { ...onAir, gapSince: at(-20 * S) };
  assert.equal(b.tAnswer({ ...onAir, phase: 'replay' }, 'yes', cfg).outcome, 'already-ended');
  assert.equal(b.tAnswer(b.defaultState(), 'yes', cfg).outcome, 'nothing');
  assert.equal(b.tAnswer({ ...gap, source: 'manual' }, 'yes', cfg).outcome, 'nothing', 'the banner');
  assert.equal(b.tAnswer(onAir, 'yes', cfg).outcome, 'phone-back');
  const ended = b.tAnswer(gap, 'yes', cfg, { by: 'text from …0123', now: t, asked: true });
  assert.deepEqual([ended.outcome, ended.save, ended.state.phase, ended.state.endedBy, ended.state.gapSince, ended.state.endedVideoUid], ['ended', true, 'replay', 'text from …0123', null, 'v1']);
  assert.ok(b.rejoinOpen(ended.state, t), 'open to the phone coming back');
  const held = b.tAnswer(gap, 'no', cfg, { now: t, asked: true });
  assert.deepEqual([held.outcome, held.state.phase, held.state.gapSince, held.state.holdUntil], ['held', 'live', gap.gapSince, at(15 * M)]);
  assert.equal(b.holding(held.state, t + 14 * M), true);
  assert.equal(b.holding(held.state, t + 15 * M), false);
  // Straight to 'ending' (no gap seen): N puts it back on air, its stop kept as the drop's start
  const ending = { ...onAir, phase: 'ending', disconnectedAt: at(-30 * S) };
  const back = b.tAnswer(ending, 'no', cfg, { now: t, asked: true });
  assert.deepEqual([back.state.phase, back.state.gapSince, back.state.disconnectedAt], ['live', ending.disconnectedAt, null]);
  assert.equal(b.tAnswer(ending, 'yes', cfg, { asked: true }).state.phase, 'replay');
  // Before the scheduled start, after a few minutes on air: a framing check goes back to waiting
  const framing = { ...gap, scheduledAt: at(2 * H), liveAt: at(-3 * M), segmentAt: at(-3 * M) };
  const pre = b.tAnswer(framing, 'yes', cfg, { asked: true });
  assert.deepEqual([pre.outcome, pre.state.phase], ['pre-show', 'scheduled']);
  assert.equal(b.tAnswer(framing, 'yes', cfg).outcome, 'nothing', 'a framing check is never asked about');
  // Not asked about this stop (a newer one than the question): nothing changes, a question follows
  for (const a of ['yes', 'no']) {
    const n = b.tAnswer(gap, a, cfg, { now: t });
    assert.deepEqual([n.outcome, n.state, n.save], ['not-asked', gap, undefined]);
  }
  // A test puts back what it interrupted
  const planned = { ...b.defaultState(), broadcastId: 'live-plan', phase: 'scheduled', scheduledAt: at(48 * H) };
  const quiet = { ...gap, broadcastId: 'live-test', quiet: { at: at(-M) }, resume: planned };
  const q = b.tAnswer(quiet, 'yes', cfg, { asked: true });
  assert.deepEqual([q.outcome, q.state.broadcastId, q.state.phase], ['test-ended', 'live-plan', 'scheduled']);
  assert.equal(b.tAnswer(quiet, 'no', cfg, { asked: true }).outcome, 'test-held');
});

// ─── The question ───────────────────────────────────────────────────

test('the phone stops: every alert number is asked once, with the kid and the time; the drop turning into the end asks nothing again', async () => {
  await fresh();
  const id = await goLiveRemi('vid1');
  const n = texts.length;
  phoneOff();
  const stoppedAt = sim.inputSince;
  travel(5 * S); const early = await tick();
  assert.ok(!early.work.includes('asked-if-over'), 'not at 5 s: Larix may still reconnect');
  assert.equal(questions(n).length, 0);
  travel(5 * S); const r = await tick();
  assert.ok(r.work.includes('asked-if-over'), `asked at 10 s: ${r.work.join(',')}`);
  assert.equal(r.state.phase, 'live', 'still on air during the drop');
  const q = questions(n);
  assert.deepEqual(q.map((t) => t.to).sort(), [PHONE1, PHONE2].sort(), 'each staff number once');
  const plain = `SOARD: The stream from Remi's reveal stopped at ${notify.clockTime(stoppedAt, 'America/New_York')}. Is the reveal over? Reply Y if it's over, or N if the signal dropped (viewers see Reconnecting).`;
  for (const x of q) {
    assert.ok(x.body.startsWith(`${plain} Or tap: https://sunshineonaranneyday.com/over/`), x.body);
    assert.ok(x.body.length <= 306, `two segments at most: ${x.body.length}`);
    assert.equal((await overLink.readOverLink(env, linkIn(x.body))).phone, x.to, 'each number its own link');
  }
  for (let i = 0; i < 6; i++) { travel(20 * S); await tick(); }
  travel(15 * S); const end = await tick();
  assert.equal(end.state.phase, 'replay', 'no answer: it ends after 2 minutes, as before');
  assert.equal(questions(n).length, 2, 'asked once, not again when it turned into the end');
  assert.equal((await events(id, 'over_asked')).length, 1, 'the question is in the broadcast\'s events');
});

const lostTexts = (from = 0) => texts.slice(from).filter((t) => /lost its connection/.test(t.body));
const backTexts = (from = 0) => texts.slice(from).filter((t) => /The phone is back/.test(t.body));

test('a short blip (Larix back within a few seconds) texts nobody', async () => {
  await fresh();
  await goLiveRemi('vid1c');
  const n = texts.length;
  phoneOff();
  travel(4 * S); let r = await tick();
  assert.ok(r.state.live && (await b.readState(env.DB)).gapSince, 'a drop the site rides out');
  phoneOn('vid1c');
  travel(4 * S); r = await tick();
  assert.equal((await b.readState(env.DB)).gapSince, null, 'back');
  for (let i = 0; i < 4; i++) { travel(15 * S); r = await tick(); }
  assert.equal(questions(n).length, 0, 'no question');
  assert.equal(lostTexts(n).length, 0, 'no "lost its connection" text either');
});

test('one text per drop: while staff are asked, "The phone lost its connection" goes to Slack and email only, says so, and "back" is not texted', async () => {
  await fresh();
  await goLiveRemi('vid1d');
  const n = texts.length;
  const lost0 = slack(/lost its connection/);
  const asked0 = slack(/Staff got a text asking if the reveal is over \(Y ends it, N keeps it on air\)/);
  const back0 = slack(/The phone is back/);
  await dropAndAsk();
  for (let i = 0; i < 3; i++) { travel(15 * S); await tick(); }
  assert.ok(slack(/lost its connection/) > lost0, 'Slack hears the drop');
  assert.ok(slack(/Staff got a text asking if the reveal is over \(Y ends it, N keeps it on air\)/) > asked0, 'and that staff were asked');
  assert.equal(lostTexts(n).length, 0, 'not texted');
  assert.equal(texts.length - n, 2, 'the only text to each number is the question');
  phoneOn('vid1d');
  for (let i = 0; i < 3; i++) { travel(10 * S); await tick(); }
  assert.ok(slack(/The phone is back/) > back0, 'Slack hears it is back');
  assert.equal(backTexts(n).length, 0, 'its fix is not texted, as the drop was not');
});

test('replies not connected: no question, and the drop is texted as before (without the question line)', async () => {
  await fresh();
  await setRepliesOn(false);
  try {
    await goLiveRemi('vid1e');
    const n = texts.length;
    const asked0 = slack(/Staff got a text asking/);
    phoneOff();
    for (const step of [4, 8, 15, 15, 15]) { travel(step * S); await tick(); }
    assert.equal(questions(n).length, 0);
    assert.deepEqual(lostTexts(n).map((t) => t.to).sort(), [PHONE1, PHONE2].sort(), '"The phone lost its connection" texted');
    assert.equal(slack(/Staff got a text asking/), asked0);
  } finally {
    await setRepliesOn(true);
  }
});

test('nothing is asked until replies reach the site (Twilio connected), nor without the Auth Token that checks them', async () => {
  await fresh();
  await setRepliesOn(false);
  await goLiveRemi('vid1b');
  const n = texts.length;
  phoneOff();
  travel(12 * S); let r = await tick();
  assert.ok(!r.work.includes('asked-if-over'), r.work.join(','));
  await setRepliesOn(true);
  const noToken = { ...env, TWILIO_AUTH_TOKEN: '', TWILIO_API_KEY_SID: 'SK1', TWILIO_API_KEY_SECRET: 'shh' };
  travel(4 * S); r = await b.runTick(noToken, { source: 'test', force: true });
  assert.ok(!r.work.includes('asked-if-over'), r.work.join(','));
  assert.equal(questions(n).length, 0);
  travel(4 * S); r = await tick();
  assert.ok(r.work.includes('asked-if-over'), 'connected again, and still the same stop: asked now');
  assert.equal(questions(n).length, 2);
});

test('a phone back and gone again is asked again', async () => {
  await fresh();
  await goLiveRemi('vid2');
  const n = texts.length;
  await dropAndAsk();
  assert.equal(questions(n).length, 2);
  phoneOn('vid2');
  travel(4 * S); let r = await tick();
  assert.equal((await b.readState(env.DB)).gapSince, null, 'back');
  for (let i = 0; i < 3; i++) { travel(20 * S); r = await tick(); }
  assert.equal(questions(n).length, 2, 'nothing asked while it streams');
  await dropAndAsk();
  assert.equal(questions(n).length, 4, 'a new stop, a new question');
});

test('no question for the emergency banner, a framing check, or the staff rehearsal feed', async () => {
  // The banner (streaming from the Facebook app): no phone on our feed to ask about
  await fresh();
  let n = texts.length;
  const m = await b.adminAction(env, 'goLiveManual', { url: 'https://www.facebook.com/SunshineOnaRanneyDay/live' }, 'peter@test');
  assert.equal(m.success, true, m.error);
  phoneOff();
  for (let i = 0; i < 4; i++) { travel(30 * S); await tick(); }
  assert.equal(questions(n).length, 0, 'banner');
  await b.adminAction(env, 'endNow', {}, 'peter@test');

  // A framing check two hours before the reveal
  await fresh();
  n = texts.length;
  await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * H).toISOString() }, 'jobtread');
  phoneOn('vidf');
  travel(5 * S); await tick();
  travel(60 * S); await tick();
  phoneOff();
  let r;
  for (let i = 0; i < 12; i++) { travel(15 * S); r = await tick(); if (r.work.includes('pre-show-ended')) break; }
  assert.ok(['scheduled', 'armed'].includes(r.state.phase), `back to waiting: ${r.state.phase}`);
  assert.equal(questions(n).length, 0, 'framing check');

  // The rehearsal feed drives its own record, never the reveal's tick
  await fresh();
  n = texts.length;
  assert.equal((await rehearsal.startRehearsal(env, { kidSlug: 'remi', minutes: 0, by: 'peter@test' })).ok, true);
  Object.assign(rehearsalFeed, { live: true, videoUID: 'vidr' });
  travel(5 * S); await rehearsal.rehearsalTick(env, { force: true }); await tick();
  rehearsalFeed.live = false;
  for (let i = 0; i < 6; i++) { travel(15 * S); await rehearsal.rehearsalTick(env, { force: true }); await tick(); }
  assert.equal((await rehearsal.readRehearsal(env.DB)).phase, 'replay', 'the rehearsal ended');
  assert.equal(questions(n).length, 0, 'rehearsal feed');
  await rehearsal.endRehearsal(env);
});

// ─── Who is heard ───────────────────────────────────────────────────

test('a reply must be signed by Twilio: missing or wrong is refused (403) and changes nothing', async () => {
  await fresh();
  await goLiveRemi('vid3');
  phoneOff();
  travel(4 * S); await tick();
  const before = await b.readState(env.DB);
  assert.ok(before.gapSince);
  const t0 = texts.length;
  assert.equal((await reply('Y', { sign: false })).status, 403, 'unsigned');
  assert.equal((await reply('Y', { signature: 'bm9wZQ==' })).status, 403, 'wrongly signed');
  const forged = await sig('not-the-token', INBOUND, { Body: 'Y', From: PHONE1 });
  assert.equal((await reply('Y', { signature: forged })).status, 403, 'signed with another key');
  assert.equal(sig_(await b.readState(env.DB)), sig_(before), 'nothing changed');
  assert.equal(texts.length, t0);
  const noToken = await inbound.onRequestPost({ env: { ...env, TWILIO_AUTH_TOKEN: '' }, request: new Request(INBOUND, { method: 'POST', body: 'Body=Y' }) });
  assert.equal(noToken.status, 503, 'not set up: refused');
});

test('a number not on the alert list is not heard; STOP, END, HELP and START are left to Twilio', async () => {
  const before = await b.readState(env.DB);
  assert.equal(before.phase, 'live');
  const stranger = await reply('Y', { from: STRANGER });
  assert.equal(stranger.status, 200);
  assert.match(stranger.type, /^text\/xml/);
  assert.match(stranger.text, /<Response\/>$/, 'no reply at all');
  for (const k of ['STOP', 'END', 'HELP', 'START']) {
    const r = await reply(k);
    assert.equal(r.status, 200);
    assert.equal(r.message, null, `${k}: Twilio answers it`);
  }
  assert.equal((await reply('Stop', { extra: { OptOutType: 'STOP' } })).message, null);
  assert.equal(sig_(await b.readState(env.DB)), sig_(before), 'nothing changed');
  // Anything else gets a short help reply, a few times at most (an auto-reply on a staff phone can't start a loop)
  const help = [];
  for (let i = 0; i < 5; i++) help.push((await reply('ok thanks', { from: PHONE2 })).message);
  assert.deepEqual(help, [inbound.HELP_TEXT, inbound.HELP_TEXT, inbound.HELP_TEXT, null, null]);
  assert.equal(sig_(await b.readState(env.DB)), sig_(before), 'still nothing changed');
});

// ─── Y ──────────────────────────────────────────────────────────────

test('Y during a drop ends it at once, the way the automatic end would: open 15 minutes to the phone; Facebook closed, "Ended", the kid page and the replay email each once', async () => {
  await fresh();
  const id = await goLiveRemi('vid4');
  const fb0 = fbEnds();
  const ended0 = slack(/Ended: /);
  await dropAndAsk();
  travel(10 * S);
  const t0 = texts.length;
  const r = await reply('Y');
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/xml/);
  assert.match(r.text, /^<\?xml version="1\.0" encoding="UTF-8"\?><Response><Message>/);
  assert.equal(r.message, ENDED);
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'replay', 'ended at once, not after 2 minutes');
  assert.equal(st.broadcastId, id);
  assert.equal(b.rejoinOpen(st), true, 'a phone back in 15 minutes still picks it up');
  assert.equal(st.endedBy, 'text from …0123');
  assert.equal(fbEnds(), fb0 + 1, 'Facebook\'s post closed with it');
  assert.equal(slack(/Reveal ended by a text from …0123/), 1, 'staff told in Slack');
  assert.equal(questions(t0).length + texts.slice(t0).filter((t) => /ended by a text/i.test(t.body)).length, 0, 'never by text');
  const answers = await events(id, 'over_answer');
  assert.deepEqual(answers.map((a) => [a.answer, a.outcome, a.from]), [['yes', 'ended', '…0123']]);
  // Nothing final for 15 minutes, then once
  sim.videoState = 'ready'; sim.live = false;
  for (let i = 0; i < 5; i++) { travel(60 * S); await tick(); }
  assert.equal(slack(/Ended: /), ended0, 'no "Ended" yet');
  assert.equal(await replaySends(id), 0);
  travel(11 * M); const c = await tick();
  assert.ok(c.work.includes('closed'), c.work.join(','));
  for (let i = 0; i < 4; i++) { travel(31 * S); await tick(); }
  assert.equal(fbEnds(), fb0 + 1, 'Facebook closed once');
  assert.equal(slack(/Ended: /), ended0 + 1, '"Ended" once');
  assert.equal(await kidVideo(), 'https://watch.cloudflarestream.com/vid4');
  assert.equal(await replaySends(id), 1, 'one replay email');
});

test('a Y sent by mistake: the phone back within 15 minutes picks the same reveal up again', async () => {
  await fresh();
  const id = await goLiveRemi('vid5');
  await dropAndAsk();
  assert.equal((await reply('yes')).message, ENDED);
  travel(3 * M); await tick();
  phoneOn('vid6');
  travel(5 * S); const r = await tick();
  assert.ok(r.work.includes('rejoined'), r.work.join(','));
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'live');
  assert.equal(st.broadcastId, id, 'the same reveal');
  assert.equal(st.endedBy, null);
});

test('Y with the phone sending again ends nothing, even before a tick has seen it back', async () => {
  await fresh();
  await goLiveRemi('vid7');
  phoneOff();
  travel(4 * S); await tick();
  assert.ok((await b.readState(env.DB)).gapSince);
  phoneOn('vid7'); // no tick yet: the reply's own tick looks first
  travel(3 * S);
  const r = await reply('Y');
  assert.equal(r.message, "The phone is sending again, so it's still live. If it goes quiet and the reveal is over, reply Y.");
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'live');
  assert.equal(st.gapSince, null);
});

test('two staff answer Y at once: it ends once, and the second hears it already ended', async () => {
  await fresh();
  const id = await goLiveRemi('vid8');
  const fb0 = fbEnds();
  const s0 = slack(/Reveal ended by a text/);
  await dropAndAsk();
  const [a, c] = await Promise.all([reply('Y'), reply('Y', { from: PHONE2 })]);
  const msgs = [a.message, c.message];
  assert.equal(msgs.filter((m) => m === ENDED).length, 1, msgs.join(' | '));
  assert.ok(msgs.some((m) => /^It already ended at \d{1,2}:\d\d [AP]M, by a text from \.\.\.\d{4}\. If the phone streams again by \d{1,2}:\d\d [AP]M, the same reveal picks back up\.$/.test(m)), msgs.join(' | '));
  assert.equal(fbEnds(), fb0 + 1, 'Facebook closed once');
  assert.equal(slack(/Reveal ended by a text/), s0 + 1, 'one note');
  assert.equal((await b.readState(env.DB)).broadcastId, id);
});

test('a slow site: the reply says "Got it" in time for Twilio, and the answer still lands, logged and noted once', async () => {
  await fresh();
  const id = await goLiveRemi('vid8b');
  await dropAndAsk();
  const s0 = slack(/Reveal ended by a text/);
  // Another tick holds the lease: the reply's own tick waits for it (5 s), longer than the reply may
  const t = Date.now();
  await env.DB.prepare(`INSERT OR REPLACE INTO broadcast_locks (name, holder, expires_at, started_at) VALUES ('tick', 'someone-else', ?, ?)`).bind(t + 60 * S, t).run();
  const pending = [];
  let lateOutcome = null;
  const r = await b.answerByText(env, { answer: 'yes', who: '…0123', waitUntil: (p) => pending.push(p), replyWithinMs: 50, onLate: async (x) => { lateOutcome = x.outcome; } });
  assert.equal(r.outcome, 'slow');
  assert.equal(inbound.answerReply('yes', r), 'Got it. The site is slow to answer right now, so check the live page in a minute.');
  for (let i = 0; i < pending.length; i++) await pending[i];
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'replay', 'the answer landed after the reply');
  assert.equal(st.broadcastId, id);
  assert.deepEqual((await events(id, 'over_answer')).map((a) => a.outcome), ['ended']);
  assert.equal(slack(/Reveal ended by a text/), s0 + 1);
  assert.equal(lateOutcome, 'ended', 'after the "Got it", the number hears how it came out');
  await env.DB.prepare(`UPDATE broadcast_locks SET expires_at = 0 WHERE holder = 'someone-else'`).run();
});

test('an answer counts only for the stop it was asked about: a newer stop not yet asked is left alone until its own question', async () => {
  await fresh();
  await goLiveRemi('vid15');
  const n = texts.length;
  await dropAndAsk();                                 // the first stop, asked
  phoneOn('vid15');
  travel(4 * S); await tick();                        // back
  travel(20 * S); await tick();
  phoneOff();
  travel(4 * S); await tick();                        // stopped again: not asked yet
  const AGAIN = "The stream stopped again just now. You'll get a new question about it in a few seconds.";
  for (const a of ['Y', 'N']) {
    const r = await reply(a);                         // meant for the first stop
    assert.equal(r.message, AGAIN, a);
    const st = await b.readState(env.DB);
    assert.deepEqual([st.phase, !!st.gapSince, st.holdUntil], ['live', true, null], 'nothing changed');
  }
  travel(8 * S); const t = await tick();
  assert.ok(t.work.includes('asked-if-over'), t.work.join(','));
  assert.equal(questions(n).length, 4, 'the new stop has its own question');
  assert.equal((await reply('Y')).message, ENDED, 'and its answer counts');
});

test('a database error still answers Twilio with TwiML, never a 500', async () => {
  await fresh();
  await goLiveRemi('vid16');
  await dropAndAsk();
  // Nothing can be read: the sender can't be checked, so no reply, but a valid one
  const down = await reply('Y', { withEnv: { ...env, DB: failingDB(() => true) } });
  assert.equal(down.status, 200);
  assert.match(down.type, /^text\/xml/);
  assert.match(down.text, /<Response\/>$/);
  // The help reply's counter can't be kept: still a help reply
  const noLimits = await reply('hmm', { withEnv: { ...env, DB: failingDB((sql) => /rate_limits/.test(sql)) } });
  assert.deepEqual([noLimits.status, noLimits.message], [200, inbound.HELP_TEXT]);
  // The answer can't be saved: told to answer again, and nothing changed
  const before = sig_(await b.readState(env.DB));
  const noSave = await reply('Y', { withEnv: { ...env, DB: failingDB((sql) => sql.includes("json_set(?1, '$.rev', ?2 + 1")) } });
  assert.deepEqual([noSave.status, noSave.message], [200, inbound.BUSY_TEXT]);
  assert.equal(sig_(await b.readState(env.DB)), before);
});

test('a slow site that then fails: "Got it" well inside Twilio\'s 15 s, then that number alone is texted to answer again', async () => {
  await fresh();
  await goLiveRemi('vid18');
  await dropAndAsk();
  const before = sig_(await b.readState(env.DB));
  const n = texts.length;
  const t = Date.now();
  // Another tick holds the lease (the reply's tick waits for it), and saving fails on every try
  await env.DB.prepare(`INSERT OR REPLACE INTO broadcast_locks (name, holder, expires_at, started_at) VALUES ('tick', 'someone-else', ?, ?)`).bind(t + 60 * S, t).run();
  const was = inbound.timing.replyWithinMs;
  assert.ok(was <= 10 * S, 'the reply goes within 10 s by default');
  inbound.timing.replyWithinMs = 300;
  try {
    const r = await reply('Y', {
      withEnv: { ...env, DB: failingDB((sql) => sql.includes("json_set(?1, '$.rev', ?2 + 1")) },
      beforeWait: () => env.DB.prepare(`UPDATE broadcast_locks SET expires_at = 0 WHERE holder = 'someone-else'`).run(),
    });
    assert.equal(r.message, 'Got it. The site is slow to answer right now, so check the live page in a minute.');
    assert.ok(r.ms < 2000, `answered in ${r.ms} ms`);
  } finally {
    inbound.timing.replyWithinMs = was;
  }
  assert.deepEqual(texts.slice(n), [{ to: PHONE1, body: inbound.BUSY_TEXT }], 'the "Got it" never hides the lost answer');
  assert.equal(sig_(await b.readState(env.DB)), before, 'nothing changed');
});

test('after a Y the page is sent the replay at once: not live, no player until Stream has the recording ready (as an automatic end)', async () => {
  await fresh();
  await goLiveRemi('vid17');
  await dropAndAsk();
  const p0 = published.length;
  assert.equal((await reply('Y')).message, ENDED);
  const frame = published.slice(p0).at(-1).state;
  assert.deepEqual([frame.phase, frame.live, frame.replay, frame.player], ['replay', false, true, null]);
  assert.ok(frame.endedAt);
  // The next 45 s: the recording is still being finished by Stream
  for (let i = 0; i < 6; i++) {
    travel(8 * S); const r = await tick();
    assert.deepEqual([r.state.phase, r.state.live, r.state.player], ['replay', false, null], `${(i + 1) * 8} s after`);
  }
  sim.videoState = 'ready'; sim.live = false;
  travel(30 * S); const r = await tick();
  assert.deepEqual(r.state.player, { kind: 'replay', uid: 'vid17', customerCode: r.state.player.customerCode });
});

// ─── N ──────────────────────────────────────────────────────────────

test('N keeps it on air past 2 minutes, Reconnecting; the phone back clears the hold; a later stop is asked again', async () => {
  await fresh();
  const id = await goLiveRemi('vid9');
  const n = texts.length;
  await dropAndAsk();
  travel(12 * S);
  const r = await reply('N');
  assert.equal(r.message, HELD);
  let st = await b.readState(env.DB);
  assert.ok(Math.abs(Date.parse(st.holdUntil) - (Date.now() + 15 * M)) < 5 * S, 'held 15 minutes from the answer');
  assert.equal(slack(/Reveal kept on air by a text from …0123/), 1);
  for (let i = 0; i < 10; i++) {
    travel(30 * S); const t = await tick();
    assert.equal(t.state.phase, 'live', `still on air ${(i + 1) * 30 + 24} s after the stop`);
  }
  st = await b.readState(env.DB);
  assert.ok(st.gapSince, 'viewers see Reconnecting');
  assert.equal(questions(n).length, 2, 'not asked again while held');
  assert.equal(lostTexts(n).length, 0, 'the drop alert and its reminders stay off the phones while held');
  phoneOn('vid10');
  travel(4 * S); await tick();
  st = await b.readState(env.DB);
  assert.equal(st.phase, 'live');
  assert.equal(st.holdUntil, null, 'the phone back clears it');
  assert.equal(st.gapSince, null);
  assert.equal(st.broadcastId, id, 'the same reveal throughout');
  travel(60 * S); await tick();
  await dropAndAsk();
  assert.equal(questions(n).length, 4, 'a new stop, a new question');
  // No hold this time: the 2-minute rule ends it as before
  for (let i = 0; i < 8; i++) { travel(20 * S); await tick(); }
  assert.equal((await b.readState(env.DB)).phase, 'replay');
});

test('a hold that runs out with no phone ends it as the automatic end does, still open 15 minutes to the phone', async () => {
  await fresh();
  await goLiveRemi('vid11');
  await dropAndAsk();
  assert.equal((await reply('no')).message, HELD);
  for (let i = 0; i < 14; i++) { travel(60 * S); const t = await tick(); assert.equal(t.state.phase, 'live', `minute ${i + 1}`); }
  travel(70 * S); await tick();
  travel(10 * S); const r = await tick();
  assert.equal(r.state.phase, 'replay', 'ended once the 15 minutes were up');
  const st = await b.readState(env.DB);
  assert.equal(b.rejoinOpen(st), true);
  assert.equal(st.endedBy, null, 'it ended on its own');
  assert.equal(st.holdUntil, null);
  const late = await reply('Y');
  assert.match(late.message, /^It already ended at \d{1,2}:\d\d [AP]M, after the phone stopped\. If the phone streams again by /);
});

test('Y after N ends it', async () => {
  await fresh();
  await goLiveRemi('vid12');
  await dropAndAsk();
  assert.equal((await reply('Nope')).message, HELD);
  for (let i = 0; i < 6; i++) { travel(30 * S); await tick(); }
  assert.equal((await b.readState(env.DB)).phase, 'live');
  assert.equal((await reply('its over')).message, ENDED);
  const st = await b.readState(env.DB);
  assert.equal(st.phase, 'replay');
  assert.equal(b.rejoinOpen(st), true);
});

test('N while the phone is sending holds nothing; a reply with no reveal on air has nothing to end', async () => {
  await fresh();
  await goLiveRemi('vid13');
  assert.equal((await reply('N')).message, "The phone is sending again, so it's still live.");
  assert.equal((await b.readState(env.DB)).holdUntil, null);
  await fresh();
  for (const a of ['Y', 'N']) {
    const r = await reply(a);
    assert.equal(r.message, "No live reveal is waiting on its phone right now, so there's nothing to do.");
  }
  assert.equal((await b.readState(env.DB)).phase, 'idle');
});

// ─── Test mode ──────────────────────────────────────────────────────

test('test mode: the question opens "Test: ", once; N holds past 15 s; Y ends the test and the planned reveal is back as it was', async () => {
  await fresh();
  const plan = await b.adminAction(env, 'schedule', { kidSlug: 'remi', scheduledAt: new Date(Date.now() + 2 * 24 * H).toISOString() }, 'jobtread');
  assert.equal(plan.success, true, plan.error);
  const planned = await b.readState(env.DB);
  assert.equal((await b.adminAction(env, 'quietTest', { on: true }, 'peter@test')).success, true);
  phoneOn('vidq1');
  travel(5 * S); let r = await tick();
  assert.ok(r.work.includes('test-start'), r.work.join(','));
  const testId = (await b.readState(env.DB)).broadcastId;
  for (let i = 0; i < 2; i++) { travel(20 * S); await tick(); }
  const n = texts.length;
  const slack0 = calls.filter((c) => c.url === 'https://hook.test/slack').length;
  phoneOff();
  travel(3 * S); r = await tick();
  assert.ok(!r.work.includes('asked-if-over'), 'not at 3 s');
  travel(8 * S); r = await tick();
  assert.ok(r.work.includes('asked-if-over'), `asked at 11 s, before the 15 s a test waits: ${r.work.join(',')}`);
  assert.equal(r.state.phase, 'live');
  const q = questions(n);
  assert.equal(q.length, 2);
  assert.match(q[0].body, /^Test: The stream from Remi's reveal stopped at .+\. Is the reveal over\? Reply Y/);
  assert.equal((await reply('N')).message, HELD);
  for (let i = 0; i < 5; i++) { travel(20 * S); r = await tick(); assert.equal(r.state.phase, 'live', `${(i + 1) * 20 + 11} s after the stop`); }
  assert.equal(questions(n).length, 2, 'asked once');
  const yes = await reply('Y');
  assert.equal(yes.message, 'Test ended. The site is back to how it was before the test.');
  const st = await b.readState(env.DB);
  assert.equal(st.broadcastId, planned.broadcastId, 'the planned reveal is back');
  assert.equal(st.phase, 'scheduled');
  assert.equal(st.quiet, undefined);
  assert.deepEqual((await events(testId, 'over_answer')).map((a) => a.outcome), ['test-held', 'test-ended'], 'answers kept with the test');
  assert.equal(calls.filter((c) => c.url === 'https://hook.test/slack').length, slack0, 'a test tells nobody in Slack');
  await b.adminAction(env, 'quietTest', { on: false }, 'peter@test');
});

test('test mode with no answer still ends on its own after 15 s and the grace, asked once', async () => {
  await fresh();
  assert.equal((await b.adminAction(env, 'quietTest', { on: true }, 'peter@test')).success, true);
  phoneOn('vidq2');
  travel(5 * S); await tick();
  const n = texts.length;
  phoneOff();
  let r;
  for (let i = 0; i < 8; i++) { travel(8 * S); r = await tick(); }
  assert.equal((await b.readState(env.DB)).phase, 'idle', 'the test ended');
  assert.equal(r.state.phase, 'replay', 'its end shows on the website as the reveal\'s will');
  const q = questions(n);
  assert.equal(q.length, 2);
  assert.match(q[0].body, /^Test: The reveal's stream stopped at /);
  await b.adminAction(env, 'quietTest', { on: false }, 'peter@test');
});

// ─── "Or tap:" link (a page with two buttons) ─────────────────────

const SITE = 'https://sunshineonaranneyday.com';
/** GET the link's page, as a phone (or a link previewer) would */
const openLink = async (token) => {
  const res = await overPage.onRequestGet({ env, params: { token }, request: new Request(`${SITE}/over/${token}`) });
  return { status: res.status, headers: res.headers, html: await res.text() };
};
/** A tap on a button: the page's form post (or JSON), from the site itself unless told otherwise */
const tap = async (token, answer, { json = false, origin = SITE, withEnv = null } = {}) => {
  const pending = [];
  const headers = { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}) };
  const body = json ? JSON.stringify({ token, answer }) : new URLSearchParams({ token, answer }).toString();
  const res = await overAnswer.onRequestPost({ env: withEnv || env, waitUntil: (p) => pending.push(p), request: new Request(`${SITE}/api/over-answer`, { method: 'POST', headers, body }) });
  for (let i = 0; i < pending.length; i++) await pending[i];
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type') || '', text, json: json ? JSON.parse(text) : null };
};
/** The link a question sent to `to` carries (the last one) */
const linkFor = (to = PHONE1) => linkIn(texts.filter((t) => t.to === to && /Is the reveal over\?/.test(t.body)).at(-1).body);
const noteOf = (html) => (/<p class="note">([^<]*)<\/p>/.exec(html) || [])[1]?.replace(/&#39;|&#x27;/g, "'") || null;

test('link tokens: signed with a key derived from TWILIO_AUTH_TOKEN; naming the broadcast, the stop, the number and 30 minutes; a changed, expired or foreign one is refused', async () => {
  const key = 'over-ask:2026-11-18T21:20:00.123Z';
  const url = await overLink.overLinkFor(env, { broadcastId: 'live-1763500000000', key, phone: '(404) 555-0123' });
  assert.ok(url.startsWith('https://sunshineonaranneyday.com/over/') && url.length < 100, url);
  const token = url.split('/over/')[1];
  assert.match(token, /^[0-9a-z.]+\.[A-Za-z0-9_-]{16}$/, 'URL-safe');
  const ok = await overLink.readOverLink(env, token);
  assert.deepEqual([ok.ok, ok.broadcastId, ok.key, ok.phone], [true, 'live-1763500000000', key, PHONE1]);
  assert.ok(Math.abs(ok.expiresAt - (Date.now() + 30 * M)) < 2 * S);
  const parts = token.split('.');
  const flip = (i, v) => parts.map((p, j) => (j === i ? v : p)).join('.');
  assert.deepEqual(await overLink.readOverLink(env, flip(2, (parseInt(parts[2], 36) + 1).toString(36))), { ok: false, why: 'bad' }, 'another number');
  assert.deepEqual(await overLink.readOverLink(env, flip(1, (parseInt(parts[1], 36) + 1).toString(36))), { ok: false, why: 'bad' }, 'another stop');
  assert.deepEqual(await overLink.readOverLink(env, flip(3, (parseInt(parts[3], 36) + 3600).toString(36))), { ok: false, why: 'bad' }, 'a longer life');
  assert.deepEqual(await overLink.readOverLink(env, flip(4, `${parts[4][0] === 'A' ? 'B' : 'A'}${parts[4].slice(1)}`)), { ok: false, why: 'bad' }, 'another signature');
  assert.deepEqual(await overLink.readOverLink({ ...env, TWILIO_AUTH_TOKEN: 'another-token' }, token), { ok: false, why: 'bad' }, 'another key');
  assert.deepEqual(await overLink.readOverLink(env, token, Date.now() + 31 * M), { ok: false, why: 'expired' });
  for (const junk of ['', 'x', 'a.b.c.d', `${token}.x`, '../../etc']) assert.equal((await overLink.readOverLink(env, junk)).ok, false, junk);
  assert.equal(await overLink.overLinkFor({ ...env, TWILIO_AUTH_TOKEN: '' }, { broadcastId: 'live-1', key, phone: PHONE1 }), null, 'no secret, no link');
});

test('opening the link changes nothing (phones preview links): it shows the question and the two buttons, private and script-free', async () => {
  await fresh();
  const id = await goLiveRemi('vid20');
  await dropAndAsk();
  const token = linkFor(PHONE1);
  const before = sig_(await b.readState(env.DB));
  const ev = (await env.DB.prepare('SELECT COUNT(*) AS n FROM broadcast_events').first()).n;
  const t0 = texts.length;
  for (let i = 0; i < 3; i++) {
    const r = await openLink(token);
    assert.equal(r.status, 200);
    assert.match(r.html, /The stream from Remi(&#39;|')s reveal stopped at \d{1,2}:\d\d [AP]M\./);
    assert.match(r.html, /<h1>Is the reveal over\?<\/h1>/);
    assert.match(r.html, /Yes, it(&#39;|')s over<\/button>/);
    assert.match(r.html, /No, the signal dropped<\/button>/);
    assert.match(r.html, /<form method="post" action="\/api\/over-answer">/);
    assert.doesNotMatch(r.html, /<script/i);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    // (never no-referrer: the buttons' POST would then carry Origin: null, which the origin guard refuses)
    assert.equal(r.headers.get('Referrer-Policy'), 'same-origin');
    assert.match(r.html, /<meta name="referrer" content="same-origin">/);
    const csp = r.headers.get('Content-Security-Policy');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /form-action 'self'/);
    assert.doesNotMatch(csp, /script-src/);
  }
  assert.equal(sig_(await b.readState(env.DB)), before, 'nothing changed');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM broadcast_events').first()).n, ev, 'nothing logged');
  assert.equal(texts.length, t0, 'nobody texted');
  assert.equal((await b.readState(env.DB)).broadcastId, id);
});

test('"Yes, it\'s over" ends it through the same path as a Y text', async () => {
  await fresh();
  const id = await goLiveRemi('vid21');
  await dropAndAsk();
  const fb0 = fbEnds();
  const r = await tap(linkFor(PHONE2), 'yes');
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/html/);
  assert.equal(noteOf(r.text), 'Done: ended. Viewers see the last moments, then Thank you for watching. The replay follows in a few minutes.');
  const st = await b.readState(env.DB);
  assert.deepEqual([st.phase, b.rejoinOpen(st), st.endedBy, st.broadcastId], ['replay', true, 'link from …0199', id]);
  assert.equal(fbEnds(), fb0 + 1, 'Facebook closed, as for a text');
  assert.equal(slack(/Reveal ended by the link texted to …0199/), 1);
  assert.deepEqual((await events(id, 'over_answer')).map((a) => [a.answer, a.outcome, a.from, a.via]), [['yes', 'ended', '…0199', 'link']]);
  const again = await tap(linkFor(PHONE2), 'yes');
  assert.match(noteOf(again.text), /^It already ended at \d{1,2}:\d\d [AP]M, by the link texted to …0199\./, 'a second tap changes nothing');
  assert.match((await openLink(linkFor(PHONE1))).html, /<h1>Nothing to answer here<\/h1>/, 'the page no longer offers the buttons');
});

test('"No, the signal dropped" holds it on air (JSON too), and a later "Yes" from the page ends it', async () => {
  await fresh();
  await goLiveRemi('vid22');
  await dropAndAsk();
  const token = linkFor(PHONE1);
  const r = await tap(token, 'no', { json: true });
  assert.deepEqual([r.status, r.json.ok, r.json.outcome, r.json.message], [200, true, 'held', 'Done: staying live. Viewers see Reconnecting until the phone is back (up to 15 min).']);
  for (let i = 0; i < 6; i++) { travel(30 * S); await tick(); }
  assert.equal((await b.readState(env.DB)).phase, 'live', 'held past 2 minutes');
  const form = await tap(token, 'no');
  assert.match(form.text, /Yes, it(&#39;|')s over<\/button>/, 'the page offers Yes after a No');
  const yes = await tap(token, 'yes');
  assert.match(noteOf(yes.text), /^Done: ended\./);
  assert.equal((await b.readState(env.DB)).phase, 'replay');
});

test('a link counts only for its own stop, and under the same rules as a text: phone back, an earlier stop, a stop not asked yet', async () => {
  await fresh();
  await goLiveRemi('vid23');
  await dropAndAsk();
  const first = linkFor(PHONE1);
  phoneOn('vid23');
  travel(3 * S);
  const back = await tap(first, 'yes');
  assert.equal(noteOf(back.text), "The phone is sending again, so it's still live. If it goes quiet and the reveal is over, reply Y.");
  travel(30 * S); await tick();
  phoneOff();
  travel(4 * S); await tick();                                     // a new stop, not asked yet
  const early = await tap(first, 'yes');
  assert.equal(noteOf(early.text), 'This link was for an earlier reveal or stop, so nothing changed.');
  travel(8 * S); await tick();                                     // now asked, with new links
  assert.notEqual(linkFor(PHONE1), first);
  const old = await tap(first, 'yes', { json: true });
  assert.deepEqual([old.json.outcome, (await b.readState(env.DB)).phase], ['old-link', 'live'], 'the old link changes nothing');
  assert.match((await openLink(first)).html, /<h1>Nothing to answer here<\/h1>/);
  assert.match(noteOf((await tap(linkFor(PHONE1), 'yes')).text), /^Done: ended\./, 'the new stop\'s link counts');
});

test('a changed, expired or foreign link, a number taken off the alert list, or a post from another site changes nothing and says why', async () => {
  await fresh();
  await goLiveRemi('vid24');
  await dropAndAsk();
  const token = linkFor(PHONE1);
  const before = sig_(await b.readState(env.DB));
  const parts = token.split('.');
  const tampered = [...parts.slice(0, 2), (parseInt(parts[2], 36) + 1).toString(36), ...parts.slice(3)].join('.');
  const bad = await tap(tampered, 'yes');
  assert.deepEqual([bad.status, noteOf(bad.text)], [400, "This link isn't right, so nothing changed. Reply Y or N to the text instead."]);
  assert.equal((await openLink(tampered)).status, 400);
  const foreign = await overLink.overLinkFor({ ...env, TWILIO_AUTH_TOKEN: 'someone-elses' }, { broadcastId: (await b.readState(env.DB)).broadcastId, key: `over-ask:${(await b.readState(env.DB)).segmentAt}`, phone: PHONE1 });
  assert.equal((await tap(foreign.split('/over/')[1], 'yes')).status, 400);
  assert.equal((await tap(token, 'maybe')).status, 400, 'only yes or no');
  const cross = await tap(token, 'yes', { origin: 'https://evil.example' });
  assert.deepEqual([cross.status, noteOf(cross.text)], [403, 'That came from another site, so nothing changed.']);
  const cfg = await b.readConfig(env.DB);
  await b.writeConfig(env.DB, { ...cfg, alerts: { ...cfg.alerts, phones: [PHONE2] } });
  try {
    const gone = await tap(token, 'yes');
    assert.deepEqual([gone.status, noteOf(gone.text)], [403, 'This number is no longer on the alert list, so nothing changed.']);
  } finally {
    await b.writeConfig(env.DB, cfg);
  }
  travel(31 * M);
  const expired = await tap(token, 'yes');
  assert.equal(expired.status, 410);
  assert.match(noteOf(expired.text), /^This link has expired \(they work for 30 minutes\), so nothing changed\./);
  assert.equal((await openLink(token)).status, 410);
  const after = JSON.parse(sig_(await b.readState(env.DB)));
  assert.equal(after.endedBy ?? null, null, 'nothing a link did');
  assert.equal(JSON.parse(before).broadcastId, after.broadcastId);
});

// ─── Connecting Twilio (only when staff ask) ────────────────────────

test('text replies: the Messaging Service setting is read, and set to the site only when asked', async () => {
  const twilioCalls = () => calls.filter((c) => c.url.startsWith('https://messaging.twilio.com/'));
  assert.equal(twilioCalls().length, 0, 'never touched on its own');
  const st = await notify.textRepliesStatus(env);
  assert.equal(st.ok, true);
  assert.deepEqual([st.connected, st.url, st.method, st.useInboundWebhookOnNumber, st.want], [false, 'https://old.example.com/sms', 'GET', true, INBOUND]);
  assert.equal(await notify.textRepliesOn(env.DB), false, 'not the site: the question waits');
  const [get] = twilioCalls();
  assert.equal(get.url, 'https://messaging.twilio.com/v1/Services/MG1');
  assert.equal(get.method, 'GET');
  assert.equal(get.headers.Authorization, 'Basic ' + btoa('AC1:twtok'));
  const set = await notify.connectTextReplies(env);
  assert.equal(set.ok, true);
  assert.equal(set.connected, true);
  const post = twilioCalls().at(-1);
  assert.equal(post.method, 'POST');
  assert.deepEqual(Object.fromEntries(post.body), { InboundRequestUrl: INBOUND, InboundMethod: 'POST', UseInboundWebhookOnNumber: 'false' });
  assert.equal(await notify.textRepliesOn(env.DB), true, 'connected: the question can go');
  assert.equal((await notify.textRepliesStatus(env)).connected, true);
  const none = await notify.textRepliesStatus({ ...env, TWILIO_MESSAGING_SERVICE_SID: '' });
  assert.equal(none.ok, false);
  assert.match(none.error, /TWILIO_MESSAGING_SERVICE_SID/);
  const n = twilioCalls().length;
  assert.equal((await notify.connectTextReplies({ ...env, TWILIO_AUTH_TOKEN: '' })).ok, false);
  assert.equal(twilioCalls().length, n, 'nothing sent without the token');
});

test('the admin\'s textRepliesStatus and connectTextReplies on /api/broadcast; staff only (not a public POST)', async () => {
  const { onRequestPost } = await import('../functions/api/broadcast.js');
  const post = (action) => onRequestPost({ env, data: { userEmail: 'peter@soardcharity.com' }, request: new Request('https://sunshineonaranneyday.com/api/broadcast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }) });
  const before = calls.filter((c) => c.url.startsWith('https://messaging.twilio.com/') && c.method === 'POST').length;
  const s = await (await post('textRepliesStatus')).json();
  assert.equal(s.success, true);
  assert.equal(s.connected, true);
  assert.equal(calls.filter((c) => c.url.startsWith('https://messaging.twilio.com/') && c.method === 'POST').length, before, 'reading sets nothing');
  const c = await (await post('connectTextReplies')).json();
  assert.equal(c.success, true);
  assert.equal(c.url, INBOUND);
  const fs = await import('node:fs');
  const mw = fs.readFileSync(new URL('../functions/api/_middleware.js', import.meta.url), 'utf8');
  assert.match(mw, /PUBLIC_ROUTES\.push\('\/api\/twilio-inbound'\)/, 'Twilio can reach the reply route');
  assert.match(mw, /const PUBLIC_GET_ROUTES = \[[^\]]*'\/api\/broadcast'/, '/api/broadcast is public for reads only');
  assert.doesNotMatch(mw, /PUBLIC_ROUTES\.push\([^)]*'\/api\/broadcast'/, 'its POST needs a staff sign-in');
});
