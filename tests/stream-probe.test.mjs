/**
 * Live feed monitor: AAC level reader, HLS probe, destination verdicts,
 * Slack issues, end-of-reveal report, go/no-go.
 * Run: node --test tests/
 *
 * Fixtures (tests/fixtures/aac/) are one-second AAC-LC 48 kHz clips made
 * with FFmpeg 6.0. Expected values are FFmpeg's own decode: astats RMS per
 * channel and ebur128 integrated loudness.
 *   init.mp4 + silence.m4s     stereo digital silence        -inf
 *   init.mp4 + pink-32.m4s     pink noise, L = R             -32.6 dBFS, -30.5 LUFS
 *   init.mp4 + speech-40.m4s   speech, L = R                 -40.2 dBFS, -37.2 LUFS
 *   speech-40.ts               same speech, MPEG-TS/ADTS     -40.2 dBFS
 *   init.mp4 + left-only.m4s   tone on the left only         L -35.2, R -inf, -35.8 LUFS
 *   init.mp4 + wide.m4s        independent noise L/R         L -24.3, R -44.9, -25.2 LUFS
 *   init.mp4 + loud.m4s        full-scale white noise        -6.9 dBFS, -0.9 LUFS
 *   mono-init.mp4 + mono.m4s   mono speech (SCE)             -27.1 dBFS, -27.1 LUFS
 *   intensity-init.mp4 + intensity.m4s   R = L/2 coded as intensity stereo   L -27.1, R -32.1
 * Speech reads up to ~2 dB low on one-second clips (the decoder skips TNS);
 * on Stream's 8-second probe window it is within about 1 dB.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSegment, analyzeSegments, configFromInit } from '../functions/api/_aac-level.js';
import { parseMaster, parseMedia, probeFeed, audioVerdict, deadSide } from '../functions/api/_stream-probe.js';
import { destinations, watch, finish, noteRehearsal, RULES, PAUSE, ENCODER, pictureStill, isPaused, report as monitorReport } from '../functions/api/_broadcast-monitor.js';
import * as preflight from '../functions/api/_broadcast-preflight.js';

const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/aac/${name}`, import.meta.url)));
const INIT = fx('init.mp4');
const near = (actual, expected, tol, msg) => assert.ok(actual != null && Math.abs(actual - expected) <= tol, `${msg}: ${actual} not within ${tol} of ${expected}`);

// ─── AAC level reader ───────────────────────────────────────────────

test('reads the AAC config and audio track from an fMP4 init segment', () => {
  assert.deepEqual(configFromInit(INIT), { aot: 2, sfIndex: 3, sampleRate: 48000, channels: 2, trackId: 1 });
  assert.equal(configFromInit(fx('mono-init.mp4')).channels, 1);
});

test('digital silence reads as silent', () => {
  const r = analyzeSegment({ init: INIT, segment: fx('silence.m4s') });
  assert.equal(r.supported, true);
  assert.ok(r.frames > 40);
  assert.equal(r.failed, 0);
  assert.equal(r.levelDb, null);
  assert.equal(r.lufs, null);
  assert.equal(r.silentPct, 100);
});

test('levels and loudness match the reference decode', () => {
  const pink = analyzeSegment({ init: INIT, segment: fx('pink-32.m4s') });
  near(pink.leftDb, -32.6, 0.5, 'pink left');
  near(pink.rightDb, -32.6, 0.5, 'pink right');
  near(pink.lufs, -30.5, 0.5, 'pink LUFS');
  assert.equal(pink.failed, 0);
  const loud = analyzeSegment({ init: INIT, segment: fx('loud.m4s') });
  near(loud.levelDb, -6.9, 0.5, 'full-scale noise level');
  near(loud.lufs, -0.9, 0.5, 'full-scale noise LUFS');
  const speech = analyzeSegment({ init: INIT, segment: fx('speech-40.m4s') });
  near(speech.levelDb, -40.2, 3, 'speech (fMP4)');
  near(speech.lufs, -37.2, 3, 'speech LUFS');
  const ts = analyzeSegment({ segment: fx('speech-40.ts') });
  near(ts.levelDb, -40.2, 3, 'speech (MPEG-TS)');
  assert.equal(ts.failed, 0);
});

test('stereo is undone into true left and right (mid/side, intensity, one side dead)', () => {
  const left = analyzeSegment({ init: INIT, segment: fx('left-only.m4s') });
  assert.equal(left.channels, 2);
  near(left.leftDb, -35.2, 0.5, 'left-only: left');
  assert.equal(left.rightDb, null, 'left-only: right is digital silence');
  near(left.lufs, -35.8, 0.5, 'left-only LUFS');
  const wide = analyzeSegment({ init: INIT, segment: fx('wide.m4s') });
  near(wide.leftDb, -24.3, 0.5, 'wide: left');
  near(wide.rightDb, -44.9, 0.5, 'wide: right');
  near(wide.lufs, -25.2, 0.5, 'wide LUFS');
  const is = analyzeSegment({ init: fx('intensity-init.mp4'), segment: fx('intensity.m4s') });
  near(is.leftDb, -27.1, 0.5, 'intensity: left');
  near(is.rightDb, -32.1, 0.5, 'intensity: right');
});

test('mono (single channel element) reads as one channel', () => {
  const r = analyzeSegment({ init: fx('mono-init.mp4'), segment: fx('mono.m4s') });
  assert.equal(r.channels, 1);
  assert.equal(r.rightDb, null);
  near(r.levelDb, -27.1, 3, 'mono speech');
  near(r.lufs, -27.1, 3, 'mono LUFS');
});

test('without an init segment fMP4 audio is reported unsupported, not guessed', () => {
  assert.equal(analyzeSegment({ segment: fx('pink-32.m4s') }).supported, false);
});

test('several segments are measured as one window', () => {
  const a = analyzeSegment({ init: INIT, segment: fx('pink-32.m4s') });
  const s = analyzeSegment({ init: INIT, segment: fx('silence.m4s') });
  const m = analyzeSegments({ init: INIT, segments: [fx('pink-32.m4s'), fx('silence.m4s')] });
  near(m.levelDb, a.levelDb - 3, 0.5, 'half noise, half silence is ~3 dB down');
  assert.equal(m.frames, a.frames + s.frames);
  assert.ok(m.silentPct > 40 && m.silentPct < 60);
  near(m.lufs, a.lufs, 1.5, 'gating drops the silent half (blocks straddling the edge pull it ~1 dB)');
});

// ─── Manifests ──────────────────────────────────────────────────────

const HOST = 'https://customer-test.cloudflarestream.com';
const masterWithAudio = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_audio",NAME="original",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:RESOLUTION=1080x1920,CODECS="avc1.4d4028,mp4a.40.2",BANDWIDTH=4005042,AVERAGE-BANDWIDTH=2507481,FRAME-RATE=30.000,AUDIO="group_audio"
v1080.m3u8
#EXT-X-STREAM-INF:RESOLUTION=720x1280,CODECS="avc1.4d401f,mp4a.40.2",BANDWIDTH=2036226,FRAME-RATE=30.000,AUDIO="group_audio"
v720.m3u8
`;
const masterNoAudio = `#EXTM3U
#EXT-X-STREAM-INF:RESOLUTION=1920x1080,CODECS="avc1.4d4028",BANDWIDTH=3000000,FRAME-RATE=30
v1080.m3u8
`;
// `edgeAt` (ms): the newest piece's own date-time, so the probe can tell how old it is (edgeAgeSec)
const livePlaylist = (seq, seg = 'a', edgeAt = null) => `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:${seq}
#EXT-X-MAP:URI="init.mp4"
#EXT-X-PROGRAM-DATE-TIME:2026-10-14T18:00:00.000Z
#EXTINF:4.000,
${seg}1.m4s
${edgeAt != null ? `#EXT-X-PROGRAM-DATE-TIME:${new Date(edgeAt).toISOString()}\n` : ''}#EXTINF:4.000,
${seg}2.m4s
`;

test('parses a Stream master manifest (renditions, separate audio group)', () => {
  const m = parseMaster(masterWithAudio, `${HOST}/x/manifest/video.m3u8`);
  assert.equal(m.variants.length, 2);
  assert.equal(m.variants[0].height, 1920);
  assert.equal(m.variants[0].fps, 30);
  assert.equal(m.variants[0].uri, `${HOST}/x/manifest/v1080.m3u8`);
  assert.equal(m.audio[0].uri, `${HOST}/x/manifest/audio.m3u8`);
});

test('parses a live media playlist (sequence, init map, date-times)', () => {
  const p = parseMedia(livePlaylist(41), `${HOST}/x/manifest/v1080.m3u8`);
  assert.equal(p.mediaSequence, 41);
  assert.equal(p.lastSequence, 42);
  assert.equal(p.endList, false);
  assert.equal(p.map, `${HOST}/x/manifest/init.mp4`);
  assert.equal(p.segments[0].pdt, Date.parse('2026-10-14T18:00:00.000Z'));
});

// ─── Fake network ───────────────────────────────────────────────────

const feeds = {};       // uid → { master, audioSeg, seq, viewers }
const slack = [];       // payloads posted to the Slack webhook
const sms = [];         // { to, body } texts sent through Twilio
let slackStatus = 200;
const graph = { live: false, scheduled: false };
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'hooks.slack.test') { slack.push(JSON.parse(init.body)); return new Response(slackStatus === 200 ? 'ok' : 'error', { status: slackStatus }); }
    if (url.hostname === 'api.twilio.com') { sms.push({ to: init.body.get('To'), body: init.body.get('Body'), service: init.body.get('MessagingServiceSid') }); return json({ sid: 'SM1' }, 201); }
    if (url.hostname === 'graph.facebook.test' || url.hostname === 'graph.facebook.com') {
      if (url.pathname.endsWith('/videos')) return json({ data: graph.live ? [{ id: 'v1', live_status: 'LIVE', permalink_url: '/soard/videos/1/', title: 'Reveal' }] : graph.scheduled ? [{ id: 'v0', live_status: 'SCHEDULED_UNPUBLISHED', title: 'Sam\'s reveal' }] : [] });
      return json({ id: 'page', name: 'SOARD', link: 'https://facebook.com/soard' });
    }
    if (url.hostname === 'api.cloudflare.com') {
      if (url.pathname.endsWith('/outputs')) return json({ success: true, result: [{ uid: 'o-fb', enabled: true }] });
      if (url.pathname.includes('/live_inputs/')) return json({ success: true, result: { uid: 'reveal', enabled: true, status: 'connected' } });
      return json({ success: true, result: [] });
    }
    if (url.hostname !== 'customer-test.cloudflarestream.com') return new Response('not mocked', { status: 599 });
    const [, uid, kind, file] = url.pathname.split('/');
    const f = feeds[uid];
    if (!f) return new Response('404 not found', { status: 404 });
    if (kind === 'views') return json({ liveViewers: f.viewers ?? 3 });
    if (kind === 'lifecycle') return json({ isInput: true, live: true, videoUID: 'v' });
    if (file === 'video.m3u8') return new Response(f.master);
    if (file === 'audio.m3u8') return new Response(livePlaylist(f.seq, 'a'));
    if (file === 'v1080.m3u8') return new Response(livePlaylist(f.seq, 'v', f.edge ? f.edge() : null));
    if (file === 'init.mp4') return new Response(INIT);
    if (/^a\d\.m4s$/.test(file)) return new Response(fx(f.audioSeg));
    // Video pieces' sizes, for the pause rule (only when a test sets them: a feed without them reads as before)
    if (/^v\d\.m4s$/.test(file) && f.videoBytes) return new Response(init.method === 'HEAD' ? null : new Uint8Array(8), { headers: { 'content-length': String(f.videoBytes) } });
    return new Response('no', { status: 404 });
  };
});
after(() => { globalThis.fetch = realFetch; });

// ─── Probe ──────────────────────────────────────────────────────────

test('probe: a live feed with sound is ok, with level, loudness and picture size', async () => {
  feeds.talk = { master: masterWithAudio, audioSeg: 'pink-32.m4s', seq: 10 };
  const r = await probeFeed('test', 'talk');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.live, true);
  assert.equal(r.video.height, 1920);
  assert.deepEqual(r.video.ladder, ['1080p', '720p']);
  assert.equal(r.video.lastSequence, 11);
  assert.equal(r.video.avgSegmentSec, 4);
  near(r.audio.levelDb, -32.6, 0.5, 'probe level');
  near(r.audio.lufs, -30.5, 0.5, 'probe LUFS');
  assert.equal(r.audio.verdict, 'ok');
  feeds.soft = { master: masterWithAudio, audioSeg: 'speech-40.m4s', seq: 10 };
  const soft = await probeFeed('test', 'soft');
  near(soft.audio.lufs, -37.2, 3, 'soft speech LUFS');
  assert.equal(soft.audio.verdict, 'quiet', 'speech around -37 LUFS is hard to hear');
});

test('probe verdicts: silent mic, missing track, one side, too loud', async () => {
  feeds.mute = { master: masterWithAudio, audioSeg: 'silence.m4s', seq: 3 };
  assert.equal((await probeFeed('test', 'mute')).audio.verdict, 'silent');
  feeds.noaudio = { master: masterNoAudio, seq: 3 };
  const none = await probeFeed('test', 'noaudio');
  assert.equal(none.ok, true);
  assert.equal(none.audio.present, false);
  assert.equal(none.audio.verdict, 'none');
  feeds.left = { master: masterWithAudio, audioSeg: 'left-only.m4s', seq: 3 };
  const left = await probeFeed('test', 'left');
  assert.equal(left.audio.verdict, 'onesided');
  assert.equal(left.audio.deadSide, 'right');
  feeds.loud = { master: masterWithAudio, audioSeg: 'loud.m4s', seq: 3 };
  assert.equal((await probeFeed('test', 'loud')).audio.verdict, 'loud');
});

test('probe: an idle input reports no video without throwing', async () => {
  const r = await probeFeed('test', 'nobody');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.error, /No video/);
});

test('audio verdict thresholds', () => {
  const base = { present: true, supported: true, frames: 90, silentPct: 0, channels: 2, leftDb: -24, rightDb: -24 };
  assert.equal(audioVerdict({ ...base, levelDb: -24, lufs: -18, lufsMax: -14 }), 'ok');
  assert.equal(audioVerdict({ ...base, levelDb: -40, lufs: -36, lufsMax: -30 }), 'quiet');
  assert.equal(audioVerdict({ ...base, levelDb: -8, lufs: -7, lufsMax: -4 }), 'loud');
  assert.equal(audioVerdict({ ...base, levelDb: -20, lufs: -16, lufsMax: -5 }), 'loud', 'one 400 ms burst over -6 LUFS');
  assert.equal(audioVerdict({ ...base, levelDb: -40, lufs: -36, silentPct: 95 }), 'silent');
  assert.equal(audioVerdict({ ...base, leftDb: -20, rightDb: null, levelDb: -23, lufs: -20, lufsMax: -18 }), 'onesided');
  assert.equal(deadSide({ channels: 2, leftDb: -60, rightDb: -20 }), 'left');
  assert.equal(deadSide({ channels: 1, leftDb: -20, rightDb: null }), null, 'mono is not one-sided');
  assert.equal(deadSide({ channels: 2, leftDb: -70, rightDb: -90 }), null, 'both near silence is silence, not one-sided');
  assert.equal(audioVerdict({ present: false }), 'none');
  assert.equal(audioVerdict({ present: true, supported: false, frames: 0 }), 'unknown');
});

// ─── Destination verdicts ───────────────────────────────────────────

const baseConfig = {
  customerCode: 'test',
  liveInput: { uid: 'talk' },
  outputs: { facebook: { uid: 'o-fb', enabled: true }, youtube: { uid: 'o-yt', enabled: true } },
  facebook: { mode: 'persistent', pageUrl: 'https://www.facebook.com/x' },
  youtube: { channelUrl: 'https://www.youtube.com/@x/live' },
  instagram: { profileUrl: 'https://www.instagram.com/x' },
  timezone: 'America/New_York',
};
const okProbe = { ok: true, video: { width: 1080, height: 1920 }, audio: { present: true, verdict: 'ok', lufs: -17 } };
const listed = [{ uid: 'o-fb', enabled: true }, { uid: 'o-yt', enabled: true }];

test('destinations: the Website card says so while the phone is reconnecting', () => {
  const d = destinations({ config: baseConfig, state: { kidSlug: 'sam', phase: 'ending', fb: {} }, phoneLive: false, liveForMs: 0, probe: null, viewers: null, outputs: listed, facebook: null, youtube: null });
  assert.equal(d.site.status, 'wait');
  assert.equal(d.site.title, 'Waiting for the phone to come back');
  const idle = destinations({ config: baseConfig, state: { phase: 'scheduled', fb: {} }, phoneLive: false, liveForMs: 0, probe: null, viewers: null, outputs: listed, facebook: null, youtube: null });
  assert.equal(idle.site.title, 'Waiting for the phone');
});

test('destinations: everything live and confirmed', () => {
  const d = destinations({ config: baseConfig, state: { kidSlug: 'sam', fb: {} }, phoneLive: true, liveForMs: 5 * 60e3, probe: okProbe, viewers: 12, outputs: listed, facebook: { configured: true, ok: true, live: true, permalink: 'https://facebook.com/v/1' }, youtube: { configured: true, ok: true, live: { viewers: 4, url: 'https://youtube.com/watch?v=1' } } });
  assert.equal(d.site.status, 'ok');
  assert.equal(d.site.detail, '1080p · -17 LUFS', 'the admin status card carries the one "watching" number');
  assert.equal(d.site.viewers, 12, 'Stream\'s player count stays for the peak in the health report');
  assert.equal(d.facebook.status, 'ok');
  assert.equal(d.facebook.url, 'https://facebook.com/v/1');
  assert.equal(d.youtube.status, 'ok');
  assert.equal(d.instagram.status, 'off');
});

test('destinations: Facebook and YouTube not live after their grace periods say what to do', () => {
  const d = destinations({ config: baseConfig, state: { fb: {} }, phoneLive: true, liveForMs: 4 * 60e3, probe: okProbe, outputs: listed, facebook: { configured: true, ok: true, live: false }, youtube: { configured: true, ok: true, live: null, upcoming: { videoId: 'u' }, channelId: 'UCabc' } });
  assert.equal(d.facebook.status, 'warn');
  assert.match(d.facebook.fix, /Go Live/);
  assert.equal(d.facebook.action.url, 'https://www.facebook.com/live/producer');
  assert.equal(d.youtube.status, 'warn');
  assert.match(d.youtube.fix, /Auto-start/);
  assert.match(d.youtube.action.url, /UCabc/);
});

test('destinations: first minute is "starting", not a problem', () => {
  const d = destinations({ config: baseConfig, state: { fb: {} }, phoneLive: true, liveForMs: 30e3, probe: okProbe, outputs: listed, facebook: { configured: true, ok: true, live: false }, youtube: { configured: true, ok: true, live: null } });
  assert.equal(d.facebook.status, 'wait');
  assert.equal(d.youtube.status, 'wait');
});

test('destinations: silent audio, missing outputs, Facebook with no audio bitrate', () => {
  const d = destinations({ config: { ...baseConfig, facebook: { mode: 'api' } }, state: { fb: { outputUid: 'dyn' } }, phoneLive: true, liveForMs: 5 * 60e3, probe: { ...okProbe, audio: { present: true, verdict: 'silent' } }, outputs: [], facebook: { configured: true, ok: true, live: true, health: { width: 1080, height: 1920, fps: 30, videoBitrate: 3400000, audioBitrate: 0 } }, youtube: { configured: false } });
  assert.equal(d.site.status, 'warn');
  assert.match(d.site.title, /silent/);
  assert.equal(d.facebook.status, 'warn');
  assert.match(d.facebook.title, /no audio/);
  assert.match(d.facebook.detail, /1080p · 30 fps · 3.4 Mbps · audio 0 kbps/);
  assert.equal(d.youtube.status, 'warn'); // not listed in Stream's outputs
  assert.match(d.youtube.title, /missing/);
});

test('destinations: idle phone, paused output', () => {
  const d = destinations({ config: { ...baseConfig, outputs: { ...baseConfig.outputs, youtube: { uid: 'o-yt', enabled: false } } }, state: { fb: {} }, phoneLive: false, liveForMs: null, probe: null, outputs: [{ uid: 'o-fb' }, { uid: 'o-yt', enabled: false }] });
  assert.equal(d.site.status, 'idle');
  assert.equal(d.facebook.status, 'idle');
  assert.equal(d.youtube.status, 'off');
  assert.match(d.youtube.title, /Paused/);
});

// ─── Unattended watch → Slack ───────────────────────────────────────

/** A clock, a reveal, and a step function that advances time and runs one watch. */
function scenario(uid, { audioSeg = 'pink-32.m4s', fb = false, outputs = {} } = {}) {
  const realNow = Date.now;
  let t = Date.parse('2026-10-14T18:00:00Z');
  Date.now = () => t;
  feeds[uid] = { master: masterWithAudio, audioSeg, seq: 100, viewers: 5 };
  const env = { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x', ...(fb ? { FB_PAGE_ID: 'page', FB_PAGE_TOKEN: 'tok' } : {}) };
  const config = { ...baseConfig, liveInput: { uid }, outputs };
  const state = { broadcastId: `b-${uid}`, title: 'Sam\'s room reveal', phase: 'live', source: 'stream', liveAt: new Date(t).toISOString(), segmentAt: new Date(t).toISOString(), fb: {} };
  const health = {};
  const events = [];
  const record = async (_db, id, type, meta) => { events.push({ id, type, meta }); };
  const step = async (ms, { advance = true } = {}) => { t += ms; if (advance) feeds[uid].seq += Math.round(ms / 4000); const work = []; await watch(env, config, state, health, work, record); return work; };
  const restore = () => { Date.now = realNow; };
  return { env, config, state, health, events, step, restore, feed: feeds[uid], at: () => t };
}
const texts = () => slack.map((p) => p.text);

test('watch: silence opens an issue in Slack with the fix, reminds, then posts when sound is back', async () => {
  const s = scenario('w-silent', { audioSeg: 'silence.m4s' });
  slack.length = 0;
  try {
    await s.step(1000);                                   // first sighting
    assert.equal(slack.length, 0);
    assert.deepEqual(await s.step(5000), [], 'throttled inside 15 s');
    await s.step(15e3); await s.step(15e3);               // 31 s of silence → posted
    assert.equal(slack.length, 1);
    const post = slack[0];
    assert.match(post.text, /Reveal audio is silent/);
    assert.ok(post.blocks.some((b) => /^\*What to do\*\n/.test(b.text?.text || '')), 'Slack post has the fix');
    assert.equal(post.blocks[0].type, 'header');
    assert.match(post.blocks[0].text.text, /^🚨 /, 'a live problem that is failing now');
    assert.ok(JSON.stringify(post.blocks).includes('/admin/#broadcast/control-room'), 'links to the control room');
    assert.match(JSON.stringify(post.blocks), /Sam's room reveal · live/);
    const issue = s.health.monitor.issues.silent;
    assert.equal(issue.level, 'error');
    assert.equal(issue.slack.ok, true);
    assert.equal(s.events.filter((e) => e.type === 'issue').length, 1);

    for (let i = 0; i < 12; i++) await s.step(15e3);       // 3 more minutes → one reminder
    assert.equal(slack.length, 2);
    assert.match(slack[1].text, /Still: Reveal audio is silent/);
    s.feed.audioSeg = 'pink-32.m4s';
    await s.step(15e3);
    assert.equal(slack.length, 3);
    assert.match(slack[2].text, /Reveal audio is back/);
    assert.equal(s.health.monitor.issues.silent, undefined);
    assert.equal(s.health.monitor.log.map((l) => l.kind).join(','), 'open,reminder,resolved');
  } finally { s.restore(); }
});

// Staff texts: Twilio set up, two numbers on the alert list
const staffTexts = (sc, phones = ['+14045550123', '+16785550199']) => {
  Object.assign(sc.env, { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_MESSAGING_SERVICE_SID: 'MG1' });
  sc.config.alerts = { phones };
  sms.length = 0;
};
const plainText = (body) => /^\S+ [\x20-\x7E\n]+$/u.test(body) && body.length <= 306; // a picture, then plain characters

test('watch: a problem texts the staff when it opens and when it clears, never the Slack reminders', async () => {
  const s = scenario('w-text', { audioSeg: 'silence.m4s' });
  staffTexts(s);
  slack.length = 0;
  try {
    await s.step(1000); await s.step(15e3); await s.step(16e3);
    assert.deepEqual(sms.map((x) => x.to), ['+14045550123', '+16785550199'], 'each number once');
    assert.equal(sms[0].service, 'MG1', 'through the messaging service');
    assert.match(sms[0].body, /^🚨 SOARD ALERT: Reveal audio is silent\nFix: Check the mic/, 'a serious problem reads 🚨 SOARD ALERT on the lock screen');
    assert.match(sms[0].body, /\nhttps:\/\/sunshineonaranneyday\.com\/control-room\/$/, 'texts link to the previewable door, not the sign-in');
    for (let i = 0; i < 12; i++) await s.step(15e3);
    assert.ok(slack.some((p) => /Still: Reveal audio is silent/.test(p.text)), 'Slack reminds');
    assert.equal(sms.length, 2, 'the reminder is not texted');
    s.feed.audioSeg = 'pink-32.m4s';
    await s.step(15e3);
    assert.equal(sms.length, 4);
    assert.match(sms[2].body, /^✅ SOARD FIXED: Reveal audio is back\nIt lasted \d+:\d\d\./, 'and the fix as ✅ fixed');
    assert.ok(sms.every((x) => plainText(x.body)), 'plain characters, two segments at most');
  } finally { s.restore(); }
});

test('watch: a mic cutting in and out texts once and once fixed; if it sticks, one "Still:" text', async () => {
  const s = scenario('w-flap', { audioSeg: 'silence.m4s' });
  staffTexts(s, ['+14045550123']);
  slack.length = 0;
  const heads = () => sms.map((x) => x.body.split('\n')[0]);
  try {
    await s.step(1000); await s.step(15e3); await s.step(16e3);                 // silent 31 s
    s.feed.audioSeg = 'pink-32.m4s'; await s.step(15e3);                        // back
    assert.deepEqual(heads(), ['🚨 SOARD ALERT: Reveal audio is silent', '✅ SOARD FIXED: Reveal audio is back']);
    for (let round = 0; round < 3; round++) {                                    // drops long enough to alert, and comes back, three more times
      s.feed.audioSeg = 'silence.m4s'; for (let i = 0; i < 4; i++) await s.step(15e3);
      s.feed.audioSeg = 'pink-32.m4s'; await s.step(15e3);
    }
    const opened = s.health.monitor.log.filter((l) => l.kind === 'open' && l.key === 'silent').length;
    assert.equal(opened, 4, 'each drop opened an alert');
    assert.equal(sms.length, 2, `the phones aren't buzzed for every drop (${heads().join(' | ')})`);
    assert.ok(slack.filter((p) => /Reveal audio is silent/.test(p.text)).length >= 4, 'Slack hears every one');
    s.feed.audioSeg = 'silence.m4s';                                             // now it sticks
    for (let i = 0; i < 16; i++) await s.step(15e3);
    assert.deepEqual(heads().slice(2), ['🚨 SOARD ALERT: Still: Reveal audio is silent'], 'one text once it sticks around');
    s.feed.audioSeg = 'pink-32.m4s'; await s.step(15e3);
    assert.equal(heads().at(-1), '✅ SOARD FIXED: Reveal audio is back', 'and the fix, since they heard about it');
  } finally { s.restore(); }
});

test('watch: "All green" once, a minute in, in Slack and by text', async () => {
  const s = scenario('w-green');
  staffTexts(s, ['+14045550123']);
  slack.length = 0;
  try {
    await s.step(1000); await s.step(15e3); await s.step(15e3); await s.step(15e3);
    assert.equal(slack.length, 0, 'not before a minute');
    await s.step(15e3);
    assert.equal(slack.length, 1);
    assert.match(slack[0].text, /All green: Sam's room reveal/);
    assert.deepEqual(sms.map((x) => x.body), ["🟢 SOARD: All green: Sam's room reveal\nSound and picture are good, and it's live on the site.\nhttps://sunshineonaranneyday.com/control-room/"]);
    for (let i = 0; i < 8; i++) await s.step(15e3);
    assert.equal(slack.length, 1, 'once per reveal');
    assert.equal(sms.length, 1);
  } finally { s.restore(); }
});

test('watch: no "All green" while sound is wrong; it comes a minute after the fix', async () => {
  const s = scenario('w-green-late', { audioSeg: 'silence.m4s' });
  staffTexts(s, ['+14045550123']);
  slack.length = 0;
  try {
    for (let i = 0; i < 6; i++) await s.step(i ? 15e3 : 1000);
    assert.ok(!slack.some((p) => /All green/.test(p.text)));
    s.feed.audioSeg = 'pink-32.m4s';
    await s.step(15e3);
    assert.match(sms.at(-1).body, /^✅ SOARD FIXED: Reveal audio is back/);
    await s.step(15e3); await s.step(15e3);
    assert.ok(!sms.some((x) => /All green/.test(x.body)), 'not straight after the fix');
    await s.step(15e3); await s.step(15e3);
    assert.match(sms.at(-1).body, /^🟢 SOARD: All green/);
  } finally { s.restore(); }
});

test('watch: one-sided and too-loud sound are their own issues', async () => {
  const s = scenario('w-side', { audioSeg: 'left-only.m4s' });
  slack.length = 0;
  try {
    await s.step(1000); await s.step(15e3); await s.step(16e3);
    assert.equal(slack.length, 1);
    assert.match(slack[0].text, /only on the left side/);
    s.feed.audioSeg = 'loud.m4s';
    await s.step(15e3);                                    // one-sided clears, loud starts its 20 s
    assert.match(texts().join('\n'), /Sound is on both sides again/);
    await s.step(15e3); await s.step(15e3);
    assert.ok(texts().some((x) => /very loud/.test(x)), texts().join(' | '));
  } finally { s.restore(); }
});

test('watch: a failed Slack post is retried, then sent as plain text, and the failure is kept', async () => {
  const s = scenario('w-fail', { audioSeg: 'silence.m4s' });
  slack.length = 0;
  slackStatus = 500;
  try {
    await s.step(1000); await s.step(15e3); await s.step(16e3);
    assert.equal(slack.length, 4, 'blocks twice, then plain text twice');
    assert.ok(slack[0].blocks && !slack[3].blocks);
    const issue = s.health.monitor.issues.silent;
    assert.equal(issue.slack.ok, false);
    assert.ok(issue.slack.error);
  } finally { slackStatus = 200; s.restore(); }
});

test('watch: frozen picture and a weak signal', async () => {
  const s = scenario('w-frozen');
  slack.length = 0;
  try {
    await s.step(1000); await s.step(15e3); await s.step(15e3); await s.step(15e3);
    assert.equal(s.health.monitor.signal.status, 'strong');
    await s.step(15e3, { advance: false }); await s.step(15e3, { advance: false }); await s.step(15e3, { advance: false });
    assert.ok(texts().some((x) => /Reveal video is frozen/.test(x)), texts().join(' | '));
    assert.equal(s.health.monitor.signal.status, 'weak');
    await s.step(15e3, { advance: false }); await s.step(15e3, { advance: false });
    assert.ok(texts().some((x) => /signal is weak/.test(x)), texts().join(' | '));
    await s.step(15e3);
    assert.ok(texts().some((x) => /moving again/.test(x)));
  } finally { s.restore(); }
});

test('watch: the phone dropping and coming back', async () => {
  const s = scenario('w-drop');
  slack.length = 0;
  try {
    await s.step(1000);
    s.state.phase = 'ending'; s.state.disconnectedAt = new Date(s.at()).toISOString();
    await s.step(15e3); await s.step(15e3);
    assert.ok(texts().some((x) => /lost its connection/.test(x)), texts().join(' | '));
    s.state.phase = 'live'; s.state.disconnectedAt = null; s.state.segmentAt = new Date(s.at()).toISOString();
    await s.step(15e3);
    assert.ok(texts().some((x) => /The phone is back/.test(x)));
    assert.equal(s.health.monitor.reconnects.length, 1);
  } finally { s.restore(); }
});

test('watch: Facebook not live after 2 minutes, then live; report has the timing', async () => {
  const s = scenario('w-fb', { fb: true, outputs: { facebook: { uid: 'o-fb', enabled: true } } });
  slack.length = 0;
  graph.live = false;
  try {
    for (let i = 0; i < 10; i++) await s.step(15e3);      // 2.5 min, never live on Facebook
    assert.ok(texts().some((x) => /Facebook isn't showing the reveal/.test(x)), texts().join(' | '));
    assert.ok(JSON.stringify(slack.find((p) => /Facebook/.test(p.text)).blocks).includes('facebook.com/live/producer'), 'links Live Producer');
    graph.live = true;
    await s.step(25e3);                                    // past the 20 s Facebook cache
    assert.ok(texts().some((x) => /Facebook is live now/.test(x)));
    assert.equal(s.health.monitor.firsts.facebook, 175);

    s.state.phase = 'replay'; s.state.endedAt = new Date(s.at() + 60e3).toISOString();
    const { report, summary } = await finish(s.env, s.config, s.state, s.health, async (_db, id, type, meta) => s.events.push({ type, meta }));
    assert.equal(report.fb, 175);
    assert.equal(report.peak, 5);
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0].k, 'facebook');
    assert.ok(JSON.stringify(report).length < 2000, 'fits an event row');
    assert.match(summary, /Sound good \d+% of the time/);
    assert.match(summary, /Facebook live after 2:55/);
    assert.match(summary, /Peak 5 watching/);
    assert.ok(s.events.some((e) => e.type === 'health_report'));
  } finally { graph.live = false; s.restore(); }
});

// ─── Rehearsal + go/no-go ───────────────────────────────────────────

test('a rehearsal probe is remembered as the latest mic check', () => {
  const health = {};
  assert.equal(noteRehearsal(health, { ok: true, at: '2026-10-14T17:00:00Z', audio: { verdict: 'ok', lufs: -18.2 }, video: { width: 1080, height: 1920 } }), true);
  assert.equal(health.rehearsal.goodAt, '2026-10-14T17:00:00Z');
  noteRehearsal(health, { ok: true, at: '2026-10-14T17:05:00Z', audio: { verdict: 'silent', lufs: null } });
  assert.equal(health.rehearsal.verdict, 'silent');
  assert.equal(health.rehearsal.goodAt, '2026-10-14T17:00:00Z', 'a later bad check keeps the last good one');
});

test('go/no-go: missing pieces fail or warn with the fix', async () => {
  const r = await preflight.run({}, { ...baseConfig, outputs: {} }, { phase: 'scheduled', scheduledAt: '2026-10-14T22:00:00Z' }, {});
  const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
  assert.equal(r.ready, false);
  assert.equal(by.stream.status, 'fail');
  assert.equal(by.slack.status, 'fail');
  assert.match(by.slack.fix, /SLACK_BOT_TOKEN/);
  // The app is connected but nobody picked a channel: alerts would go nowhere
  const noPick = await preflight.run({ SLACK_BOT_TOKEN: 'xoxb-test' }, { ...baseConfig, outputs: {} }, { phase: 'scheduled', scheduledAt: '2026-10-14T22:00:00Z' }, {});
  const slackItem = noPick.items.find((i) => i.key === 'slack');
  assert.equal(slackItem.status, 'fail');
  assert.match(slackItem.label, /No Slack channel is picked/);
  assert.equal(by.micCheck.status, 'warn');
  assert.equal(by.facebookOutput.status, 'fail');
  assert.equal(by.youtube.status, 'off');
  assert.equal(by.kid.status, 'warn');
  const post = preflight.slackText(r, { title: 'Sam\'s room reveal', scheduledAt: '2026-10-14T22:00:00Z' }, baseConfig);
  assert.match(post.title, /^No-go: Sam's room reveal at 6:00 PM/);
  assert.equal(post.level, 'error');
  assert.match(post.detail, /❌ Slack alerts aren't set up/);
});

test('go/no-go: posts an hour before, and again at 10 minutes only if something was open', async () => {
  const realNow = Date.now;
  let t = Date.parse('2026-10-14T21:05:00Z');
  Date.now = () => t;
  slack.length = 0;
  graph.scheduled = true;
  try {
    const env = { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x', CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok', FB_PAGE_ID: 'page', FB_PAGE_TOKEN: 'tok' };
    const config = { ...baseConfig, liveInput: { uid: 'reveal' }, rehearsalInput: { uid: 'reh' }, outputs: { facebook: { uid: 'o-fb', enabled: true } } };
    const state = { broadcastId: 'b-pre', phase: 'scheduled', title: 'Sam\'s room reveal', kidSlug: 'sam', kidName: 'Sam', scheduledAt: '2026-10-14T22:00:00Z' };
    const health = { rehearsal: { goodAt: '2026-10-14T19:00:00Z', lastAt: '2026-10-14T19:00:00Z', verdict: 'ok', goodLufs: -18 } };
    const hubStatus = async () => ({ ok: true });
    const work = [];
    await preflight.auto(env, config, state, health, work, { hubStatus });   // 55 min out
    assert.equal(slack.length, 1);
    assert.match(slack[0].text, /^🚦 Go: Sam's room reveal at 6:00 PM/);
    assert.equal(health.preflight.last.ready, true);
    await preflight.auto(env, config, state, health, work, { hubStatus });
    assert.equal(slack.length, 1, 'once per stage');
    t = Date.parse('2026-10-14T21:52:00Z');
    await preflight.auto(env, config, state, health, work, { hubStatus });
    assert.equal(slack.length, 1, 'all clear at the hour: no 10-minute post');

    // Same reveal with a problem at the hour mark gets a second post
    slack.length = 0;
    t = Date.parse('2026-10-14T21:05:00Z');
    const h2 = { };
    await preflight.auto(env, config, { ...state, broadcastId: 'b-pre2' }, h2, work, { hubStatus });
    assert.match(slack[0].text, /Go, with notes/);
    assert.match(slack[0].text, /No mic check/);
    t = Date.parse('2026-10-14T21:52:00Z');
    await preflight.auto(env, config, { ...state, broadcastId: 'b-pre2' }, h2, work, { hubStatus });
    assert.equal(slack.length, 2);
  } finally { graph.scheduled = false; Date.now = realNow; }
});

test('rules: Slack waits long enough not to cry wolf', () => {
  assert.ok(RULES.silentAfter >= 30e3 && RULES.quietAfter >= 120e3 && RULES.remindFirst >= 180e3);
});

// ─── Larix paused on the thank-you card (the crew's end of a reveal) ─

// Bytes in one 4 s piece of the 1080x1920 top rendition at a given bytes per pixel-second. Measured Nov 19 2026 on
// Stream: a moving picture about 0.21, Dylan's reveal never below 0.148, the still thank-you card 0.010.
const piece = (bpps) => Math.round(bpps * 1080 * 1920 * 4);
const MOVING = piece(0.21), CAMERA_LOW = piece(0.148), CARD = piece(0.010);

test('pause rule: the still card is a pause, a camera never is, sound is never a pause', () => {
  assert.equal(pictureStill(0.010), true, 'the card');
  assert.equal(pictureStill(0.148), false, 'Dylan\'s quietest camera moment');
  assert.equal(pictureStill(0.039), true, 'under the line with no moving level yet');
  assert.equal(pictureStill(0.010, 0.21), true, 'the card is about 5% of the moving level');
  assert.equal(pictureStill(0.03, 0.1), false, 'under the line but not under a quarter of a dim reveal\'s own level');
  assert.equal(pictureStill(null), false, 'no sizes: never a pause');
  assert.equal(isPaused({ verdict: 'silent', rate: 0.010 }), true);
  assert.equal(isPaused({ verdict: 'none', rate: 0.010 }), true, 'a pause that drops the sound track');
  assert.equal(isPaused({ verdict: 'ok', rate: 0.010 }), false, 'a still picture with sound is not a pause');
  assert.equal(isPaused({ verdict: 'silent', rate: 0.21 }), false, 'a muted Larix: moving picture, silence');
  assert.equal(isPaused({ verdict: 'silent', rate: null }), false);
  assert.ok(PAUSE.stillBpps > 0.010 * 3 && PAUSE.stillBpps < 0.148 / 3, 'the line leaves 3x either side of what was measured');
});

test('probe: how much picture the newest pieces carry', async () => {
  feeds.pic = { master: masterWithAudio, audioSeg: 'pink-32.m4s', seq: 10, videoBytes: MOVING };
  const r = await probeFeed('test', 'pic');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.video.bytesPerSec, Math.round(MOVING / 4));
  near(r.video.bytesPerPixelSec, 0.21, 0.001, 'bytes per pixel-second');
  feeds.pic.videoBytes = null;
  const none = await probeFeed('test', 'pic');
  assert.equal(none.ok, true);
  assert.equal(none.video.bytesPerPixelSec, undefined, 'sizes that can\'t be read leave it out');
});

test('watch: paused on the thank-you card raises no sound alarm; a muted Larix still does after 30 s', async () => {
  const s = scenario('w-pause');
  s.feed.videoBytes = MOVING;
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 4; i++) await s.step(15e3);            // a minute of the reveal
    s.feed.audioSeg = 'silence.m4s'; s.feed.videoBytes = CARD;  // Pause
    for (let i = 0; i < 6; i++) await s.step(15e3);            // 90 s on the card
    assert.ok(!texts().some((x) => /silent|sound track/i.test(x)), texts().join(' | '));
    const m = s.health.monitor;
    assert.ok(m.pausedSince, 'the pause is on the monitor');
    assert.equal(m.pauses, 1);
    assert.ok(m.stats.paused >= 5, JSON.stringify(m.stats));
    assert.ok(m.log.some((l) => l.kind === 'paused'));
    assert.equal(Object.keys(m.pending).length, 0, 'nothing building up');

    s.feed.videoBytes = CAMERA_LOW;                            // Resume with the mic muted: a moving picture, silence
    await s.step(15e3); await s.step(15e3);
    assert.ok(!texts().some((x) => /Reveal audio is silent/.test(x)), 'the 30 s wait starts over after the pause');
    await s.step(15e3);
    assert.ok(texts().some((x) => /Reveal audio is silent/.test(x)), texts().join(' | '));
    assert.equal(m.pausedSince, null);
    assert.equal(m.pausedMs, 90e3);
  } finally { s.restore(); }
});

test('watch: a pause before the reveal has a moving level, and one with no sound track, are pauses', async () => {
  const s = scenario('w-pause-cold', { audioSeg: 'silence.m4s' });
  s.feed.videoBytes = CARD;
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 4; i++) await s.step(15e3);
    assert.ok(s.health.monitor.pausedSince);
    s.feed.master = masterNoAudio;                              // the pause dropping the sound track altogether
    for (let i = 0; i < 4; i++) await s.step(15e3);
    assert.equal(slack.length, 0, texts().join(' | '));
    s.feed.videoBytes = MOVING;                                // video with no sound track: a real problem again
    await s.step(15e3);
    assert.ok(texts().some((x) => /no sound track/.test(x)), texts().join(' | '));
  } finally { s.restore(); }
});

test('end report: the pause is counted apart from the sound and named', async () => {
  const s = scenario('w-pause-end');
  s.feed.videoBytes = MOVING;
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 4; i++) await s.step(15e3);
    s.feed.audioSeg = 'silence.m4s'; s.feed.videoBytes = CARD;
    for (let i = 0; i < 4; i++) await s.step(15e3);            // paused at the first of these, 45 s on
    s.state.phase = 'ending';                                  // Stop
    await s.step(15e3);
    assert.equal(s.health.monitor.pausedSince, null, 'the stop ends the pause');
    assert.equal(s.health.monitor.pausedMs, 60e3);
    s.state.phase = 'replay'; s.state.endedAt = new Date(s.at() + 20e3).toISOString();
    const { report, summary } = await finish(s.env, s.config, s.state, s.health, async (_db, id, type, meta) => s.events.push({ type, meta }));
    assert.deepEqual(report.paused, { n: 1, s: 60 });
    assert.equal(report.okPct, 100, 'the card\'s silence doesn\'t count against the sound');
    assert.match(summary, /Paused on the thank-you card for 1:00/);
    assert.ok(!report.issues.length, JSON.stringify(report.issues));
  } finally { s.restore(); }
});

test('control room: the report says when Larix is paused', async () => {
  const s = scenario('w-pause-room', { audioSeg: 'silence.m4s' });
  s.feed.videoBytes = CARD;
  try {
    await s.step(1000); await s.step(15e3);
    const r = await monitorReport(s.env, s.config, s.state, s.health);
    assert.equal(r.paused, true);
    assert.ok(r.pausedSince);
    s.feed.videoBytes = MOVING;
    assert.equal((await monitorReport(s.env, s.config, s.state, s.health)).paused, false, 'a muted Larix is not a pause');
  } finally { s.restore(); }
});

// ─── Stream's encoder errors (ENCODER) ──────────────────────────────

/** What /api/stream-webhook notes in health.encoderError (noteEncoderError), at `atMs` */
const encoderError = (s, atMs, { count = 1, firstAtMs = atMs, code = 'ERR_GOP_OUT_OF_RANGE' } = {}) => {
  s.health.encoderError = { firstAt: new Date(firstAtMs).toISOString(), lastAt: new Date(atMs).toISOString(), count, code, videoCodec: 'h264', audioCodec: 'aac' };
};
/** The newest piece's end `ageSec` old at every look (the fake's pieces are 4 s long) */
const edgeAge = (s, ageSec) => { s.feed.edge = () => s.at() - ageSec * 1000 - 4000; };
const notes = () => slack.filter((p) => /^📝 Stream flagged/.test(p.text)); // the quiet notes
const streamTexts = () => sms.filter((x) => /Stream (error|flagged)/.test(x.body));
const ended = async (s) => {
  s.state.phase = 'replay'; s.state.endedAt = new Date(s.at() + 5e3).toISOString();
  return finish(s.env, s.config, s.state, s.health, async (_db, id, type, meta) => s.events.push({ type, meta }));
};

test('watch: a Stream error with the video fine is one quiet Slack note, never a text or an email (Max, Nov 20)', async () => {
  const s = scenario('w-enc-ok');
  staffTexts(s);
  edgeAge(s, 4.8); // Max's worst stretch was 4.8 s, and 6.5 s happened with nothing wrong
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 8; i++) await s.step(15e3);   // two minutes in
    encoderError(s, s.at());
    await s.step(15e3);
    assert.equal(notes().length, 0, `nothing decided before ${ENCODER.settleMs / 1000} s`);
    await s.step(16e3);
    assert.equal(notes().length, 1, slack.map((p) => p.text).join(' | '));
    assert.match(notes()[0].text, /Stream flagged the phone's video \(the keyframe interval is out of range\)/);
    assert.match(JSON.stringify(notes()[0]), /recovered by itself, so nobody was texted/);
    assert.doesNotMatch(JSON.stringify(notes()[0]), /<!here>|<!channel>/, 'no @here');
    assert.equal(streamTexts().length, 0, 'nobody texted');
    assert.equal(s.health.monitor.issues.encoder, undefined);
    assert.match(s.health.monitor.log.filter((l) => l.kind === 'encoder').at(-1).title, /recovered by itself/);
    for (let i = 0; i < 4; i++) await s.step(15e3);
    assert.equal(notes().length, 1, 'once');

    const { summary } = await ended(s);
    assert.match(summary, /Stream flagged the phone's video once \(the keyframe interval is out of range\), first at \d{1,2}:\d\d\s[AP]M; the picture recovered by itself\./);
    assert.ok(!slack.some((p) => /Before the next reveal/.test(p.text)), 'once is no follow-up');
  } finally { s.restore(); }
});

test('watch: a Stream error with the video stuck is a real problem: texted with its fix, then "moving again"', async () => {
  const s = scenario('w-enc-stale');
  staffTexts(s);
  edgeAge(s, 2);
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 4; i++) await s.step(15e3);
    encoderError(s, s.at());
    edgeAge(s, 12);                                    // the newest piece goes stale and stays
    await s.step(15e3, { advance: false });
    assert.equal(streamTexts().length, 0, 'not yet');
    await s.step(16e3, { advance: false });
    const sent = streamTexts();
    assert.deepEqual(sent.map((x) => x.to), ['+14045550123', '+16785550199']);
    assert.match(sent[0].body, /^🚨 SOARD ALERT: Stream error: The keyframe interval is out of range\nFix: In Larix, set the keyframe interval to 2 seconds\./);
    assert.ok(s.health.monitor.issues.encoder, 'an open issue');
    assert.match(slack.find((p) => /Stream error/.test(p.text)).text, /Stream error/);
    assert.equal(notes().length, 0, 'no quiet note for a real problem');

    edgeAge(s, 2);                                     // the video moves again
    await s.step(15e3);
    assert.equal(s.health.monitor.issues.encoder, undefined);
    assert.ok(sms.some((x) => /^✅ SOARD FIXED: Reveal video is moving again/.test(x.body)), sms.map((x) => x.body.split('\n')[0]).join(' | '));
    const { summary } = await ended(s);
    assert.match(summary, /Stream flagged the phone's video once \(the keyframe interval is out of range\), first at [^;]+\./);
    assert.doesNotMatch(summary, /recovered by itself/);
  } finally { s.restore(); }
});

test('watch: a Stream error that can\'t load the feed at all (a codec Stream refuses) texts its own fix', async () => {
  const s = scenario('w-enc-codec');
  staffTexts(s);
  edgeAge(s, 2);
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 4; i++) await s.step(15e3);
    encoderError(s, s.at(), { code: 'ERR_UNSUPPORTED_VIDEO_CODEC' });
    s.feed.master = '';                                // the player can't load it
    await s.step(15e3); await s.step(16e3);
    assert.match(streamTexts()[0]?.body || '', /Stream error: Stream can't use the video codec the phone sent\nFix: In Larix, set the video codec to H\.264\./);
  } finally { s.restore(); }
});

test('watch: Stream saying it again with the picture fine stays off the phones; one email after the reveal', async () => {
  const s = scenario('w-enc-again');
  staffTexts(s);
  edgeAge(s, 3);
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 4; i++) await s.step(15e3);
    const first = s.at();
    encoderError(s, first);
    await s.step(15e3); await s.step(16e3);
    assert.equal(notes().length, 1);
    for (let i = 0; i < 12; i++) await s.step(15e3);  // three minutes later Stream says it again: the same run
    encoderError(s, s.at(), { count: 2, firstAtMs: first });
    await s.step(15e3); await s.step(16e3);
    assert.equal(notes().length, 2);
    assert.match(notes()[1].text, /flagged the phone's video again/);
    assert.match(JSON.stringify(notes()[1]), /2 times since .*The picture is fine, so nobody was texted\. One email goes out after the reveal/);
    assert.equal(streamTexts().length, 0, 'nobody texted mid-reveal');
    assert.ok(!slack.some((p) => /Before the next reveal/.test(p.text)), 'not while live');

    const { summary } = await ended(s);
    assert.match(summary, /Stream flagged the phone's video 2 times/);
    const after = slack.filter((p) => /Before the next reveal/.test(p.text));
    assert.equal(after.length, 1, 'one follow-up once it ends');
    assert.match(JSON.stringify(after[0]), /In Larix, set the keyframe interval to 2 seconds/);
    assert.equal(streamTexts().length, 0, 'and that one is no text either');
  } finally { s.restore(); }
});

test('watch: a Stream error just before the phone goes away is left to the drop\'s own alert; an old one is ignored', async () => {
  const s = scenario('w-enc-away');
  staffTexts(s);
  edgeAge(s, 2);
  slack.length = 0;
  try {
    await s.step(1000);
    for (let i = 0; i < 4; i++) await s.step(15e3);
    encoderError(s, s.at());
    s.state.gapSince = new Date(s.at() + 5e3).toISOString();   // Pause, then Stop
    await s.step(15e3); await s.step(16e3);
    assert.match(s.health.monitor.log.filter((l) => l.kind === 'encoder').at(-1).title, /the phone went away/);
    delete s.state.gapSince;
    await s.step(15e3); await s.step(16e3);
    assert.equal(notes().length, 0);
    assert.equal(streamTexts().length, 0);
    assert.equal(s.health.monitor.issues.encoder, undefined);

    // A run from before this reveal went live (yesterday's test, say) is not this reveal's
    const old = scenario('w-enc-old');
    try {
      encoderError(old, old.at() - 30 * 60e3);
      await old.step(1000);
      for (let i = 0; i < 4; i++) await old.step(15e3);
      assert.equal(notes().length, 0);
      assert.equal(old.health.monitor.encoder.flags, 0);
    } finally { old.restore(); }
  } finally { s.restore(); }
});
