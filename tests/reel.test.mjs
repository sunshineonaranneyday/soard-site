/**
 * Instagram Reel pipeline — moment detection, cut window, end-to-end publish.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as reels from '../functions/api/_broadcast-reel.js';

const ts = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000`; };
function vtt(lines) {
  return 'WEBVTT\n\n' + lines.map(([sec, text], i) => `${i + 1}\n${ts(sec)} --> ${ts(sec + 4)} align:start\n${text}`).join('\n\n') + '\n';
}

// A 25-minute reveal: chatter, a false "wow" early, the countdown and reveal at 12:30, reactions after
const REVEAL = vtt([
  [30, 'hi everyone welcome to the live stream'],
  [95, 'wow look at this tile work'],
  [240, 'thank you to our partners for donating the cabinets'],
  [480, 'she is almost here'],
  [735, 'are you ready'],
  [742, 'three two one'],
  [750, 'open your eyes'],
  [754, 'oh my gosh'],
  [758, 'this is your new room'],
  [762, 'wow'],
  [770, 'do you like it'],
  [1100, 'let us take a look at the closet'],
  [1440, 'thank you all for watching'],
]);

test('parseVtt reads cues with hours and settings', () => {
  const cues = reels.parseVtt(REVEAL);
  assert.equal(cues.length, 13);
  assert.equal(cues[6].start, 750);
  assert.equal(cues[6].end, 754);
  assert.equal(cues[6].text, 'open your eyes');
});

test('keyword detector lands on the reveal, not the early wow', () => {
  const kw = reels.detectByKeywords(reels.parseVtt(REVEAL));
  assert.ok(kw);
  assert.ok(kw.seconds >= 735 && kw.seconds <= 750, `got ${kw.seconds}`);
  assert.ok(kw.confidence >= 0.5, `confidence ${kw.confidence}`);
});

test('no reveal language → null', () => {
  assert.equal(reels.detectByKeywords(reels.parseVtt(vtt([[10, 'hello'], [60, 'thanks for coming']]))), null);
});

test('chooseMoment prefers precise keywords when AI agrees, AI when keywords are weak', () => {
  assert.equal(reels.chooseMoment({ seconds: 742, confidence: 0.9 }, { seconds: 760, confidence: 0.7 }).method, 'captions+ai');
  assert.equal(reels.chooseMoment({ seconds: 95, confidence: 0.1 }, { seconds: 750, confidence: 0.8 }).seconds, 750);
  assert.equal(reels.chooseMoment(null, null), null);
});

test('clipWindow: lead-up, clamping, fits, fallback', () => {
  assert.deepEqual(reels.clipWindow(600, 300), { start: 0, end: 600 });
  assert.deepEqual(reels.clipWindow(1500, 742, { leadSeconds: 240 }), { start: 502, end: 1397 });
  assert.deepEqual(reels.clipWindow(1500, 100, { leadSeconds: 240 }), { start: 0, end: 895 });
  assert.deepEqual(reels.clipWindow(1800, 1750, { leadSeconds: 240 }), { start: 905, end: 1800 });
  assert.deepEqual(reels.clipWindow(1800, null), { start: 905, end: 1800 });
  for (const [d, m] of [[1500, 742], [1800, 1750], [1800, 10]]) { const w = reels.clipWindow(d, m); assert.ok(w.end - w.start <= 895); }
});

test('renderCaption fills the kid and falls back without one', () => {
  assert.match(reels.renderCaption(null, { kidName: 'Remi' }), /^Remi's room reveal/);
  assert.match(reels.renderCaption(null, { kidName: null }), /^Room reveal day/);
});

test('whole length: 25-min recording → captions → cut → MP4 → Instagram Reel', async () => {
  const calls = [];
  let downloadsRequested = false, downloadPolls = 0, containerPolls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${url.split('?')[0]}`);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    const cf = 'https://api.cloudflare.com/client/v4/accounts/acct';
    if (url === `${cf}/stream/src1` && method === 'GET') return json({ success: true, result: { uid: 'src1', duration: 1500, status: { state: 'ready' } } });
    if (url === `${cf}/stream/src1/captions`) return json({ success: true, result: [{ language: 'en', label: 'English', generated: true, status: 'ready' }] });
    if (url === `${cf}/stream/src1/captions/en/vtt`) return new Response(REVEAL, { status: 200 });
    if (url === `${cf}/stream/clip` && method === 'POST') { const b = JSON.parse(init.body); assert.equal(b.clippedFromVideoUID, 'src1'); assert.ok(b.endTimeSeconds - b.startTimeSeconds <= 895); return json({ success: true, result: { uid: 'clip1' } }); }
    if (url === `${cf}/stream/clip1` && method === 'GET') return json({ success: true, result: { uid: 'clip1', status: { state: 'ready' } } });
    if (url === `${cf}/stream/clip1/downloads` && method === 'GET') { downloadPolls++; return json({ success: true, result: downloadsRequested ? { default: { status: downloadPolls > 2 ? 'ready' : 'inprogress', url: 'https://customer-x.cloudflarestream.com/clip1/downloads/default.mp4' } } : {} }); }
    if (url === `${cf}/stream/clip1/downloads` && method === 'POST') { downloadsRequested = true; return json({ success: true, result: { default: { status: 'inprogress', url: 'https://customer-x.cloudflarestream.com/clip1/downloads/default.mp4' } } }); }
    if (url.startsWith('https://graph.facebook.com/v25.0/page1?')) return json({ instagram_business_account: { id: 'ig1', username: 'sunshineonaranneyday' } });
    if (url === 'https://graph.facebook.com/v25.0/ig1/media' && method === 'POST') {
      const b = new URLSearchParams(init.body);
      assert.equal(b.get('media_type'), 'REELS');
      assert.match(b.get('video_url'), /clip1\/downloads\/default\.mp4$/);
      assert.match(b.get('caption'), /^Remi's room reveal/);
      assert.ok(Number(b.get('thumb_offset')) > 0);
      return json({ id: 'cont1' });
    }
    if (url.startsWith('https://graph.facebook.com/v25.0/cont1?')) { containerPolls++; return json({ status_code: containerPolls > 1 ? 'FINISHED' : 'IN_PROGRESS' }); }
    if (url === 'https://graph.facebook.com/v25.0/ig1/media_publish' && method === 'POST') return json({ id: 'media1' });
    if (url.startsWith('https://graph.facebook.com/v25.0/media1?')) return json({ permalink: 'https://www.instagram.com/reel/ABC/' });
    return new Response('not mocked ' + url, { status: 599 });
  };
  const env = { CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 't', FB_PAGE_ID: 'page1', FB_PAGE_TOKEN: 'pt', AI: { run: async () => ({ response: '{"revealSeconds": 752, "confidence": 0.8}' }) } };
  const config = { reels: { ...reels.defaultReelConfig(), length: 'whole' } };
  let state = { kidName: 'Remi', title: "Remi's room reveal", reel: reels.startReel({}, 'src1', null) };
  const stages = [];
  try {
    for (let i = 0; i < 20 && !['done', 'failed', 'blocked'].includes(state.reel.stage); i++) {
      state = (await reels.advanceReel(env, config, state, { force: true })).state;
      stages.push(state.reel.stage);
    }
  } finally { globalThis.fetch = realFetch; }
  assert.equal(state.reel.stage, 'done', `${stages.join(' → ')} | ${state.reel.error}`);
  assert.equal(state.reel.method, 'captions+ai');
  assert.ok(state.reel.momentSeconds >= 735 && state.reel.momentSeconds <= 752);
  assert.equal(state.reel.start, state.reel.momentSeconds - 240);
  assert.ok(state.reel.end - state.reel.start <= 895);
  assert.equal(state.reel.permalink, 'https://www.instagram.com/reel/ABC/');
  assert.ok(stages.includes('clipping') && stages.includes('processing'));
});

test('whole length: a recording under 15 min posts whole, no clip', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/stream/s2')) return json({ success: true, result: { duration: 600, status: { state: 'ready' } } });
    if (url.endsWith('/stream/s2/downloads')) return json({ success: true, result: { default: { status: 'ready', url: 'https://x/s2.mp4' } } });
    return new Response('{}', { status: 599 });
  };
  try {
    let state = { kidName: 'Ana', reel: reels.startReel({}, 's2', null) };
    const whole = { reels: { length: 'whole' } };
    state = (await reels.advanceReel({ CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 't' }, whole, state, { force: true })).state;
    assert.equal(state.reel.stage, 'download');
    assert.equal(state.reel.method, 'fits');
    state = (await reels.advanceReel({ CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 't' }, whole, state, { force: true })).state;
    assert.equal(state.reel.stage, 'instagram');
    assert.ok(!seen.some(u => u.includes('/stream/clip')));
  } finally { globalThis.fetch = realFetch; }
});

test('pipeline: missing Instagram permission → blocked with a clear message', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: '(#10) Application does not have permission for this action', code: 10 } }), { status: 400 });
  try {
    let state = { reel: { ...reels.startReel({}, 's3', null), stage: 'instagram', mp4Url: 'https://x/a.mp4' } };
    state = (await reels.advanceReel({ FB_PAGE_ID: 'p', FB_PAGE_TOKEN: 't' }, {}, state, { force: true })).state;
    assert.equal(state.reel.stage, 'blocked');
    assert.match(state.reel.error, /permission/i);
  } finally { globalThis.fetch = realFetch; }
});

test('whole length: override minute skips caption detection', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/stream/s4')) return new Response(JSON.stringify({ success: true, result: { duration: 1800, status: { state: 'ready' } } }), { status: 200 });
    return new Response('{}', { status: 599 });
  };
  try {
    let state = { reel: reels.startReel({}, 's4', 20 * 60) };
    state = (await reels.advanceReel({ CF_ACCOUNT_ID: 'a', CF_STREAM_TOKEN: 't' }, { reels: { length: 'whole' } }, state, { force: true })).state;
    assert.equal(state.reel.stage, 'window');
    assert.equal(state.reel.method, 'override');
    assert.equal(state.reel.momentSeconds, 1200);
  } finally { globalThis.fetch = realFetch; }
});

// ─── Short Reels (Peter, Nov 21 2026: "Short cut, 20 to 45 s") ─────────

// Max's reveal, Nov 20 2026: Stream's own captions around the door opening (times in seconds)
const MAX = [
  [418, 'is laughing in the hallway. Sounds'], [419, 'like they\'re still getting set up. We\'re'], [425, 'ready when'], [426, 'They are, Christian.'],
  [419 + 16, 'Are you ready to see your new bathroom?'], [441, 'Are you sure? Okay.'], [445, 'Alright Max, are you ready to see it?'],
  [448, 'Here we go!'], [450, 'Oh my god!'], [453, 'Wow!'], [455, 'Wow!'], [457, "Oh, it's beautiful!"], [459, 'Oh, look at that!'],
  [462, "all right I'm gonna hand this to Christian so that I can show you guys"], [466, 'around a second got it okay so'],
  [471, 'the shower obviously is way bigger than it'], [473, 'was before because we were able to take from that closet so now you guys have'],
  [482, "oh man we'll just tuck that away for a second"], [488, 'this is a live reveal everybody'],
].sort((a, b) => a[0] - b[0]);
const maxCues = () => reels.parseVtt(vtt(MAX));

test('short cut on Max\'s reveal: "Alright Max, are you ready" through "look at that", stopping before the hand-off', () => {
  const cues = maxCues();
  const kw = reels.detectByKeywords(cues);
  assert.equal(kw.seconds, 435, 'the moment lands on "are you ready to see your new bathroom?"');
  const w = reels.shortWindow(cues, kw.seconds, 716.82);
  // 7:23 to 7:43: the 7:24 to 7:43 cut Peter approved, reaching back one second to the 20 s he chose as the shortest; cover 7:33
  assert.deepEqual(w, { start: 443, end: 463, coverSeconds: 453 });
});

test('short cut on a countdown reveal keeps the countdown and the reactions, 20 to 45 s', () => {
  const cues = reels.parseVtt(REVEAL);
  const w = reels.shortWindow(cues, reels.detectByKeywords(cues).seconds, 1500);
  assert.equal(w.start, 741);          // "three two one" at 742
  assert.ok(w.end >= 774 && w.end <= 776, `end ${w.end}`); // "do you like it" at 770
  assert.ok(w.end - w.start >= reels.SHORT_MIN_SECONDS && w.end - w.start <= reels.SHORT_MAX_SECONDS);
  assert.equal(w.coverSeconds, 757);   // 3 s into "oh my gosh"
});

test('short cut: limits, no reactions, recording edges', () => {
  // only a lead-in line: 2 s before it, 30 s long
  assert.deepEqual(reels.shortWindow(reels.parseVtt(vtt([[100, 'are you ready']])), 100, 900), { start: 98, end: 128, coverSeconds: 103 });
  // a long run of reactions is held to 45 s
  const many = reels.parseVtt(vtt(Array.from({ length: 30 }, (_, i) => [200 + i * 4, i ? 'wow' : 'open your eyes'])));
  const w = reels.shortWindow(many, 200, 900);
  assert.equal(w.end - w.start, 45);
  // a moment near the end of the recording keeps 20 s inside it
  const tail = reels.shortWindow(reels.parseVtt(vtt([[595, 'oh my gosh']])), 595, 600);
  assert.equal(tail.end, 600);
  assert.ok(tail.end - tail.start >= 20);
  assert.equal(reels.shortWindow([], null, 600), null);
});

test('parseClock and fitCut', () => {
  assert.equal(reels.parseClock('7:24'), 444);
  assert.equal(reels.parseClock('1:02:05'), 3725);
  assert.equal(reels.parseClock(444), 444);
  assert.equal(reels.parseClock('444'), 444);
  for (const bad of ['7:60', 'seven', '', null, undefined, -3, '7:']) assert.equal(reels.parseClock(bad), null, String(bad));
  assert.deepEqual(reels.fitCut({ start: 444, end: 463, coverSeconds: 454 }, 716.82), { start: 444, end: 463, coverSeconds: 454 });
  assert.deepEqual(reels.fitCut({ start: 700, end: 760 }, 716.82), { start: 700, end: 716, coverSeconds: null });
  assert.match(reels.fitCut({ start: 720, end: 740 }, 716.82).error, /past the end/);
  assert.match(reels.fitCut({ start: 100, end: 101 }, 716.82).error, /3 seconds/);
  assert.equal(reels.fitCut({ start: 444, end: 463, coverSeconds: 500 }, 716.82).coverSeconds, null);
  assert.match(reels.fitCut({ start: 100, end: 200 }, 716.82).error, /60 seconds/, 'a live recording: at most 60 s');
  assert.deepEqual(reels.fitCut({ start: 100, end: 200 }, 716.82, { live: false }), { start: 100, end: 200, coverSeconds: null });
});

test('instantClipUrl: whole seconds and a tidy file name', () => {
  assert.equal(reels.instantClipUrl(undefined, 'abc', 443.6, 19.2, "Max reveal reel"), 'https://customer-cuav5h47lgfe96ql.cloudflarestream.com/abc/clip.mp4?time=443s&duration=20s&filename=max-reveal-reel.mp4');
  assert.match(reels.instantClipUrl('zzz', 'abc', 0, 30, "Zoë & Ana's"), /^https:\/\/customer-zzz\.cloudflarestream\.com\/abc\/clip\.mp4\?time=0s&duration=30s&filename=zo-ana-s\.mp4$/);
});

/** A Stream + Instagram stand-in for one recording; returns what the pipeline asked for */
function mockPipeline({ uid, duration, captions = null, live = true }) {
  const seen = { clip: null, container: null, calls: [] };
  let downloadsRequested = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method || 'GET').toUpperCase();
    seen.calls.push(`${method} ${url.split('?')[0]}`);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    const cf = 'https://api.cloudflare.com/client/v4/accounts/acct';
    if (url === `${cf}/stream/${uid}` && method === 'GET') return json({ success: true, result: { uid, duration, status: { state: 'ready' }, ...(live ? { liveInput: 'in1' } : {}) } });
    if (url === `${cf}/stream/${uid}/captions`) return json({ success: true, result: captions ? [{ language: 'en', status: 'ready' }] : [] });
    if (url === `${cf}/stream/${uid}/captions/en/vtt`) return new Response(captions, { status: 200 });
    if (url === `${cf}/stream/clip` && method === 'POST') { seen.clip = JSON.parse(init.body); return json({ success: true, result: { uid: 'cut1' } }); }
    if (url === `${cf}/stream/cut1` && method === 'GET') return json({ success: true, result: { uid: 'cut1', status: { state: 'ready' } } });
    const dl = url.match(/\/stream\/([\w-]+)\/downloads$/);
    if (dl && method === 'GET') return json({ success: true, result: downloadsRequested ? { default: { status: 'ready', url: `https://x/${dl[1]}.mp4` } } : {} });
    if (dl && method === 'POST') { downloadsRequested = true; return json({ success: true, result: { default: { status: 'inprogress' } } }); }
    if (url.startsWith('https://graph.facebook.com/v25.0/page1?')) return json({ instagram_business_account: { id: 'ig1', username: 'sunshineonaranneyday' } });
    if (url === 'https://graph.facebook.com/v25.0/ig1/media' && method === 'POST') { seen.container = Object.fromEntries(new URLSearchParams(init.body)); return json({ id: 'cont1' }); }
    if (url.startsWith('https://graph.facebook.com/v25.0/cont1?')) return json({ status_code: 'FINISHED' });
    if (url === 'https://graph.facebook.com/v25.0/ig1/media_publish' && method === 'POST') return json({ id: 'media1' });
    if (url.startsWith('https://graph.facebook.com/v25.0/media1?')) return json({ permalink: 'https://www.instagram.com/reel/MAX/' });
    return new Response('not mocked ' + url, { status: 599 });
  };
  return { seen, restore: () => { globalThis.fetch = realFetch; } };
}
const ENV = { CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 't', FB_PAGE_ID: 'page1', FB_PAGE_TOKEN: 'pt' };
async function run(config, state) {
  const stages = [];
  for (let i = 0; i < 20 && !['done', 'failed', 'blocked'].includes(state.reel.stage); i++) {
    state = (await reels.advanceReel(ENV, config, state, { force: true })).state;
    stages.push(state.reel.stage);
  }
  return { state, stages };
}

test('short length (the default): Max\'s 12-minute recording becomes a 20-second Reel with the cover on his face', async () => {
  const m = mockPipeline({ uid: 'max1', duration: 716.82, captions: vtt(MAX) });
  try {
    const { state, stages } = await run({ reels: reels.defaultReelConfig() }, { kidName: 'Max', reel: reels.startReel({}, 'max1', null) });
    assert.equal(state.reel.stage, 'done', `${stages.join(' → ')} | ${state.reel.error}`);
    // A live recording: Stream's instant clip goes straight to Instagram, no /stream/clip (which refuses live recordings)
    assert.equal(m.seen.clip, null);
    assert.equal(m.seen.container.video_url, 'https://customer-cuav5h47lgfe96ql.cloudflarestream.com/max1/clip.mp4?time=443s&duration=20s&filename=max-reveal-reel.mp4');
    assert.deepEqual([state.reel.start, state.reel.end], [443, 463]);
    assert.equal(m.seen.container.thumb_offset, '10000');
    assert.match(m.seen.container.caption, /^Max's room reveal/);
    assert.equal(state.reel.permalink, 'https://www.instagram.com/reel/MAX/');
  } finally { m.restore(); }
});

test('a start and end chosen in the admin skip the captions and post that cut, with its own cover and caption', async () => {
  const m = mockPipeline({ uid: 'max2', duration: 716.82 });
  try {
    const reel = reels.startReel({}, 'max2', null, { start: reels.parseClock('7:24'), end: reels.parseClock('7:43'), coverSeconds: reels.parseClock('7:34'), caption: '  Max rolled into his new bathroom.  ' });
    const { state, stages } = await run({ reels: reels.defaultReelConfig() }, { kidName: 'Max', reel });
    assert.equal(state.reel.stage, 'done', `${stages.join(' → ')} | ${state.reel.error}`);
    assert.equal(state.reel.method, 'chosen');
    assert.ok(!m.seen.calls.some(c => c.includes('/captions')), 'no caption reading');
    assert.equal(m.seen.clip, null);
    assert.match(m.seen.container.video_url, /\/max2\/clip\.mp4\?time=444s&duration=19s&/);
    assert.equal(m.seen.container.thumb_offset, '10000');
    assert.equal(m.seen.container.caption, 'Max rolled into his new bathroom.');
    assert.equal(m.seen.container.media_type, 'REELS');
  } finally { m.restore(); }
});

test('a chosen cut outside the recording fails with a plain reason and posts nothing', async () => {
  const m = mockPipeline({ uid: 'max3', duration: 716.82 });
  try {
    const { state } = await run({}, { reel: reels.startReel({}, 'max3', null, { start: 800, end: 830 }) });
    assert.equal(state.reel.stage, 'failed');
    assert.match(state.reel.error, /past the end/);
    assert.equal(m.seen.container, null);
  } finally { m.restore(); }
});

test('short length with the admin\'s minute: the reveal language near it sets the cut', async () => {
  const m = mockPipeline({ uid: 'max4', duration: 716.82, captions: vtt(MAX) });
  try {
    const { state } = await run({}, { kidName: 'Max', reel: reels.startReel({}, 'max4', 7 * 60) });
    assert.equal(state.reel.method, 'override');
    assert.match(m.seen.container.video_url, /\/max4\/clip\.mp4\?time=443s&duration=20s&/);
  } finally { m.restore(); }
});

test('short length, no reveal language: a recording under 15 min posts whole and says why', async () => {
  const m = mockPipeline({ uid: 'quiet', duration: 600, captions: vtt([[10, 'hello'], [60, 'thanks for coming']]) });
  try {
    let state = { reel: reels.startReel({}, 'quiet', null) };
    for (let i = 0; i < 5 && state.reel.stage !== 'download'; i++) state = (await reels.advanceReel(ENV, {}, state, { force: true })).state;
    assert.equal(state.reel.stage, 'download');
    assert.equal(state.reel.method, 'fallback');
    assert.match(state.reel.error || '', /No reveal language found; used the whole recording/);
    assert.deepEqual([state.reel.start, state.reel.end], [0, 600]);
    ({ state } = await run({}, state));
    assert.equal(state.reel.stage, 'done');
    assert.equal(m.seen.clip, null, 'no clip for the whole recording');
  } finally { m.restore(); }
});

test('an uploaded (not live) recording is cut with /stream/clip, as before', async () => {
  const m = mockPipeline({ uid: 'up1', duration: 716.82, captions: vtt(MAX), live: false });
  try {
    const { state, stages } = await run({}, { kidName: 'Max', reel: reels.startReel({}, 'up1', null) });
    assert.equal(state.reel.stage, 'done', `${stages.join(' → ')} | ${state.reel.error}`);
    assert.deepEqual([m.seen.clip.startTimeSeconds, m.seen.clip.endTimeSeconds], [443, 463]);
    assert.equal(m.seen.container.video_url, 'https://x/cut1.mp4');
  } finally { m.restore(); }
});

test('a long cut of a live recording fails in plain words instead of retrying a request Stream always refuses', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/stream/long1')) return new Response(JSON.stringify({ success: true, result: { duration: 1800, liveInput: 'in1', status: { state: 'ready' } } }), { status: 200 });
    if (url.endsWith('/stream/clip')) return new Response(JSON.stringify({ success: false, errors: [{ code: 10005, message: 'Bad Request: The request was invalid. Additional details might be available in messages.' }], messages: [{ code: 10005, message: 'to clip recordings of live streams, please refer to our live instant clipping documentation' }] }), { status: 400 });
    return new Response('{}', { status: 599 });
  };
  try {
    let state = { reel: reels.startReel({}, 'long1', 20 * 60) };
    for (let i = 0; i < 4 && !['failed', 'done'].includes(state.reel.stage); i++) state = (await reels.advanceReel(ENV, { reels: { length: 'whole' } }, state, { force: true })).state;
    assert.equal(state.reel.stage, 'failed');
    assert.match(state.reel.error, /60 seconds or less from a live recording/);
  } finally { globalThis.fetch = realFetch; }
});
