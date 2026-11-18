/**
 * A reveal with more than one Facebook live post (Peter, Nov 17 2026: "yes add them together").
 * When the phone comes back after Facebook's few minutes, the reveal goes on but Facebook needs a new
 * live post (tRejoin). History reads every one of the reveal's posts and adds their numbers together:
 * views, people, live viewers, reactions and comments summed, average watch weighed by views. Each post
 * keeps its own last good numbers, so a failed or deleted one never drops out of the total; one video
 * reached two ways counts once; a framing check's post is never the reveal's.
 * Run: node --test tests/reveal-stats-fb-posts.test.mjs
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const WT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const H = 3600e3, M = 60e3;
const iso = (ms) => new Date(ms).toISOString();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// A small Facebook: live posts (liveVideoId → video id) and each video's own numbers
let live = {}, videos = {}, asked = [];
const fbVideo = (id, { views, unique, avgSec, liveUnique, reactions, comments, mode = 'ok' }) => { videos[id] = { views, unique, avgSec, liveUnique, reactions, comments, mode }; };
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.host !== 'graph.facebook.com') return new Response('not mocked', { status: 599 });
  const path = url.pathname.replace(/^\/v[\d.]+\//, '');
  asked.push(path);
  const gone = () => json({ error: { message: `Unsupported get request. Object with ID '${path}' does not exist, cannot be loaded due to missing permissions`, code: 100 } }, 400);
  if (path in live && live[path] === undefined) return json({ error: { message: 'Service temporarily unavailable', code: 2 } }, 503);
  if (live[path] !== undefined) return live[path] ? json({ id: path, video: { id: live[path] } }) : gone();
  const ins = path.match(/^(\d+)\/video_insights$/);
  const v = videos[ins ? ins[1] : path];
  if (!v || v.mode === 'gone') return gone();
  if (v.mode === 'fail') return json({ error: { message: 'An unexpected error has occurred. Please retry your request later.', code: 2 } }, 500);
  if (ins) {
    if (v.mode === 'denied') return json({ error: { message: '(#10) Requires read_insights permission', code: 10 } }, 400);
    const m = (name, value) => ({ name, period: 'lifetime', values: [{ value }] });
    return json({ data: [m('total_video_views', v.views), m('total_video_views_unique', v.unique), m('total_video_avg_time_watched', v.avgSec * 1000), m('total_video_views_live', v.liveUnique)] });
  }
  return json({ id: path, reactions: { summary: { total_count: v.reactions } }, comments: { summary: { total_count: v.comments } } });
};

let DB, env, b, rs;
before(async () => {
  const { createD1 } = await import(`${WT}/tests/lib/d1-shim.mjs`);
  DB = await createD1({ schemaFiles: [`${WT}/scripts/schema.sql`] });
  env = { DB, FB_PAGE_ID: 'page', FB_PAGE_TOKEN: 'fbtok' };
  b = await import(`${WT}/functions/api/_broadcast.js`);
  rs = await import(`${WT}/functions/api/_reveal-stats.js`);
  await b.ensureSchema(DB);
  await rs.ensureStatsSchema(DB);
});
beforeEach(() => { live = {}; videos = {}; asked = []; });

let n = 0;
async function reveal({ fbEarlier = [], last = {}, facebook = null } = {}) {
  const id = `live-fbp${++n}`;
  const at = Date.now() - 2 * H;
  await DB.prepare(`INSERT INTO broadcasts (id, kid_slug, kid_name, title, live_at, ended_at, phase, source, fb_live_video_id, fb_permalink, data, created_at, updated_at)
    VALUES (?, 'remi', 'Remi', 'Remi', ?, ?, 'ended', 'stream', ?, ?, ?, ?, ?)`)
    .bind(id, iso(at), iso(at + H), last.liveVideoId || null, last.permalink || null, JSON.stringify(fbEarlier.length ? { fbEarlier } : {}), iso(at), iso(at + H)).run();
  if (facebook) await DB.prepare('INSERT INTO broadcast_stats (broadcast_id, facebook, updated_at) VALUES (?, ?, ?)').bind(id, JSON.stringify(facebook), iso(at)).run();
  return id;
}
const row = (id) => DB.prepare(`SELECT b.id, b.live_at, b.ended_at, b.fb_live_video_id, b.fb_permalink, b.data, s.facebook, s.youtube, s.next_check_at
  FROM broadcasts b LEFT JOIN broadcast_stats s ON s.broadcast_id = b.id WHERE b.id = ?`).bind(id).first();
const stats = async (id) => JSON.parse((await DB.prepare('SELECT facebook FROM broadcast_stats WHERE broadcast_id = ?').bind(id).first()).facebook);
const refresh = async (id, at = Date.now()) => rs.refreshPlatforms(env, await row(id), at);

test('two live posts (the phone came back after Facebook\'s window): every number is the two added together, average watch weighed by views', async () => {
  live = { fbA: '111111', fbB: '222222' };
  fbVideo('111111', { views: 300, unique: 200, avgSec: 40, liveUnique: 90, reactions: 25, comments: 6 });
  fbVideo('222222', { views: 900, unique: 650, avgSec: 80, liveUnique: 310, reactions: 140, comments: 31 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: 'fbA', permalink: null }], last: { liveVideoId: 'fbB' } });
  await refresh(id);
  const f = await stats(id);
  assert.equal(f.views, 1200);
  assert.equal(f.unique, 850);
  assert.equal(f.liveUnique, 400);
  assert.equal(f.reactions, 165);
  assert.equal(f.comments, 37);
  assert.equal(f.avgSec, 70, '(40×300 + 80×900) / 1200, not 40 + 80');
  assert.equal(f.errorKind, null);
  assert.equal(f.error, null);
  assert.ok(f.readAt && f.viewsReadAt);
  assert.equal(f.liveVideoId, 'fbB', 'the reveal\'s last post stays its own');
  assert.deepEqual(f.posts.map((p) => [p.liveVideoId, p.videoId, p.views]), [['fbA', '111111', 300], ['fbB', '222222', 900]], 'each post kept');
  // History's comparison column reads the total
  assert.equal(f.unique, 850);
});

test('a later read that fails for one post keeps its last numbers in the total and says Facebook couldn\'t be read', async () => {
  live = { fbC: '333333', fbD: '444444' };
  fbVideo('333333', { views: 100, unique: 80, avgSec: 30, liveUnique: 40, reactions: 10, comments: 2 });
  fbVideo('444444', { views: 500, unique: 300, avgSec: 60, liveUnique: 150, reactions: 70, comments: 12 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: 'fbC' }], last: { liveVideoId: 'fbD' } });
  const first = Date.now();
  await refresh(id, first);
  videos['333333'].mode = 'fail';
  videos['444444'].views = 650; videos['444444'].reactions = 75;
  await refresh(id, first + 15 * M);
  const f = await stats(id);
  assert.equal(f.views, 750, 'the failed post\'s last 100 plus the other\'s new 650');
  assert.equal(f.reactions, 85);
  assert.equal(f.errorKind, 'failed');
  assert.match(f.error, /unexpected error/);
  assert.equal(f.readAt, iso(first), 'the numbers shown are as old as the oldest post\'s');
  assert.equal(f.checkedAt, iso(first + 15 * M));
  assert.ok(!asked.slice(-6).some((p) => p === 'fbC'), 'its video is known: not looked up again');
});

test('a post deleted on Facebook keeps its last numbers in the total; only when every post is gone is the reveal "gone"', async () => {
  live = { fbE: '555555', fbF: '666666' };
  fbVideo('555555', { views: 40, unique: 30, avgSec: 20, liveUnique: 25, reactions: 3, comments: 1 });
  fbVideo('666666', { views: 800, unique: 500, avgSec: 90, liveUnique: 260, reactions: 120, comments: 22 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: 'fbE' }], last: { liveVideoId: 'fbF' } });
  const first = Date.now();
  await refresh(id, first);
  videos['555555'].mode = 'gone'; // staff deleted the short first post
  await refresh(id, first + 2 * H);
  let f = await stats(id);
  assert.equal(f.views, 840);
  assert.equal(f.errorKind, null, 'the post still on Facebook read fine');
  assert.equal(f.readAt, iso(first + 2 * H), 'the post still on Facebook speaks for when');
  assert.deepEqual(f.posts.map((p) => p.errorKind), ['gone', null]);
  videos['666666'].mode = 'gone';
  await refresh(id, first + 4 * H);
  f = await stats(id);
  assert.equal(f.errorKind, 'gone');
  assert.equal(f.views, 840, 'still the last numbers');
  assert.equal(f.readAt, iso(first), 'from the oldest read of them');
});

test('read once during the 15-minute wait (one post), then the phone came back: those first numbers stay in the total even if that post can\'t be read again', async () => {
  live = { fbG: '777777', fbH: '888888' };
  fbVideo('777777', { views: 210, unique: 150, avgSec: 50, liveUnique: 120, reactions: 18, comments: 4 });
  fbVideo('888888', { views: 600, unique: 410, avgSec: 70, liveUnique: 230, reactions: 95, comments: 17 });
  const id = await reveal({ last: { liveVideoId: 'fbG' } });
  const first = Date.now();
  await refresh(id, first);
  let f = await stats(id);
  assert.equal(f.views, 210);
  assert.equal(f.posts, undefined, 'one post: read as before');
  // The phone came back: the row now has the first post as earlier and the new one as its own; the "at once" line
  // saw the new post meanwhile
  await DB.prepare('UPDATE broadcasts SET fb_live_video_id = ?, data = ? WHERE id = ?').bind('fbH', JSON.stringify({ fbEarlier: [{ liveVideoId: 'fbG', permalink: null }] }), id).run();
  await DB.prepare(`UPDATE broadcast_stats SET facebook = json_set(facebook, '$.liveVideoId', 'fbH') WHERE broadcast_id = ?`).bind(id).run();
  live.fbG = null; videos['777777'].mode = 'fail';
  await refresh(id, first + H);
  f = await stats(id);
  assert.equal(f.views, 810, 'the first post\'s 210 (from before) plus 600');
  assert.equal(f.reactions, 113);
  assert.deepEqual(f.posts.map((p) => p.videoId), ['777777', '888888']);
});

test('one video reached two ways (an earlier link and a later live post) counts once', async () => {
  live = { fbI: '999111' };
  fbVideo('999111', { views: 400, unique: 300, avgSec: 60, liveUnique: 200, reactions: 50, comments: 9 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: null, permalink: 'https://www.facebook.com/SunshineOnaRanneyDay/videos/999111/' }], last: { liveVideoId: 'fbI' } });
  await refresh(id);
  const f = await stats(id);
  assert.equal(f.views, 400);
  assert.equal(f.posts.length, 1);
});

test('links only (Facebook shown by the persistent stream key): each post read by its link and added together', async () => {
  fbVideo('123456', { views: 120, unique: 100, avgSec: 30, liveUnique: 60, reactions: 9, comments: 2 });
  fbVideo('654321', { views: 380, unique: 260, avgSec: 50, liveUnique: 140, reactions: 41, comments: 8 });
  const id = await reveal({ fbEarlier: [{ permalink: 'https://www.facebook.com/SunshineOnaRanneyDay/videos/123456/' }], last: { permalink: 'https://www.facebook.com/SunshineOnaRanneyDay/videos/654321/' } });
  await refresh(id);
  const f = await stats(id);
  assert.equal(f.views, 500);
  assert.equal(f.avgSec, Math.round((30 * 120 + 50 * 380) / 500));
  assert.ok(!asked.some((p) => /^fb/.test(p)), 'no live post to look up');
});

test('a missing permission on one post is flagged as for one post (reactions and comments still added)', async () => {
  live = { fbJ: '121212', fbK: '343434' };
  fbVideo('121212', { views: 50, unique: 40, avgSec: 20, liveUnique: 30, reactions: 5, comments: 1, mode: 'denied' });
  fbVideo('343434', { views: 450, unique: 330, avgSec: 70, liveUnique: 180, reactions: 60, comments: 11 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: 'fbJ' }], last: { liveVideoId: 'fbK' } });
  // Read after the reads earlier tests made hours ahead: Automations goes by Facebook's latest answer
  const at = Date.now() + 6 * H;
  await refresh(id, at);
  const f = await stats(id);
  assert.equal(f.reactions, 65);
  assert.equal(f.comments, 12);
  assert.equal(f.views, 450, 'only the views Facebook gave');
  assert.equal(f.errorKind, 'partial', 'as one post with the permission missing: reactions came, views didn\'t');
  assert.equal(f.missing, 'read_insights');
  assert.equal(f.viewsReadAt, iso(at), 'the views shown (the other post\'s) are dated');
  assert.equal((await rs.revealStatsFacts(DB)).fbMissing, true);
});

test('picked up but the new post never opened: the reveal\'s one post is still read (it is only in the earlier list)', async () => {
  live = { fbQ: '232323' };
  fbVideo('232323', { views: 320, unique: 210, avgSec: 45, liveUnique: 160, reactions: 30, comments: 7 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: 'fbQ', permalink: null }], last: {} });
  await refresh(id);
  const f = await stats(id);
  assert.equal(f.views, 320);
  assert.equal(f.videoId, '232323');
  assert.equal(f.liveVideoId, 'fbQ');
  assert.equal(f.posts, undefined, 'one post');
});

test('a post that never reads leaves the others\' numbers dated, and says Facebook couldn\'t be read', async () => {
  live = { fbR: null, fbS: '454545' };
  fbVideo('454545', { views: 300, unique: 220, avgSec: 50, liveUnique: 120, reactions: 33, comments: 5 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: 'fbR' }], last: { liveVideoId: 'fbS' } });
  live.fbR = undefined; // Facebook errors on it outright
  const at = Date.now();
  await refresh(id, at);
  const f = await stats(id);
  assert.equal(f.views, 300);
  assert.equal(f.errorKind, 'failed');
  assert.equal(f.readAt, iso(at), 'the numbers shown are from this read');
  assert.equal(f.viewsReadAt, iso(at));
});

test('one post: exactly as before (no list of posts)', async () => {
  live = { fbL: '565656' };
  fbVideo('565656', { views: 700, unique: 500, avgSec: 66, liveUnique: 250, reactions: 88, comments: 14 });
  const id = await reveal({ last: { liveVideoId: 'fbL' } });
  await refresh(id);
  const f = await stats(id);
  assert.equal(f.views, 700);
  assert.equal(f.avgSec, 66);
  assert.equal(f.videoId, '565656');
  assert.equal(f.posts, undefined);
});

test('the heartbeat\'s refresh reads the reveal\'s earlier posts from its History row', async () => {
  await DB.prepare(`UPDATE broadcast_stats SET next_check_at = '9999-12-31T00:00:00.000Z'`).run();
  live = { fbM: '787878', fbN: '898989' };
  fbVideo('787878', { views: 10, unique: 9, avgSec: 10, liveUnique: 9, reactions: 1, comments: 0 });
  fbVideo('898989', { views: 90, unique: 70, avgSec: 30, liveUnique: 50, reactions: 12, comments: 3 });
  const id = await reveal({ fbEarlier: [{ liveVideoId: 'fbM' }], last: { liveVideoId: 'fbN' } });
  const out = await rs.maybeRefreshRevealStats(env, { force: true });
  assert.ok(out.refreshed.includes(id), JSON.stringify(out));
  assert.equal((await stats(id)).views, 100);
});

test('the reveal keeps its earlier posts: added at a pick-up, once each; a framing check or a test never adds one', () => {
  const live1 = { ...b.defaultState(), phase: 'replay', broadcastId: 'live-1', fb: { liveVideoId: 'p1', permalink: 'https://fb/1', outputUid: 'o1', checkedAt: null, needsReview: false } };
  const r1 = b.tRejoin(live1, { videoUid: 'v2' });
  assert.deepEqual(r1.fbEarlier, [{ liveVideoId: 'p1', permalink: 'https://fb/1' }]);
  assert.equal(r1.fb.liveVideoId, null, 'a new post opens for the rest');
  const r2 = b.tRejoin({ ...r1, phase: 'replay', fb: { ...r1.fb, liveVideoId: 'p2' } }, { videoUid: 'v3' });
  assert.deepEqual(r2.fbEarlier.map((p) => p.liveVideoId), ['p1', 'p2'], 'in order');
  assert.deepEqual(b.tRejoin({ ...r2, phase: 'replay', fb: { ...r2.fb, liveVideoId: 'p2' } }).fbEarlier.map((p) => p.liveVideoId), ['p1', 'p2'], 'once each');
  assert.deepEqual(b.tRejoin({ ...r2, phase: 'replay', fb: b.defaultState().fb }).fbEarlier.length, 2, 'a post that never opened adds nothing');
  // Ending keeps them; a framing check (not the reveal) and a new reveal start empty
  assert.equal(b.tEnd({ ...r2, phase: 'live' }, {}, { rejoin: true }).fbEarlier.length, 2);
  const sched = { ...b.defaultState(), phase: 'live', broadcastId: 'live-2', scheduledAt: iso(Date.now() + 30 * M), liveAt: iso(Date.now() - 3 * M), disconnectedAt: iso(Date.now()), fb: { ...b.defaultState().fb, liveVideoId: 'framing' }, fbEarlier: [{ liveVideoId: 'x', permalink: null }] };
  assert.deepEqual(b.tPreShowOver(sched).fbEarlier, []);
  assert.deepEqual(b.tStartQuiet({ ...b.defaultState(), phase: 'scheduled', scheduledAt: iso(Date.now() + H), fbEarlier: [{ liveVideoId: 'x' }] }, {}, b.defaultConfig()).fbEarlier, []);
  assert.deepEqual(b.tStartLive({ ...r2, phase: 'replay' }, { videoUid: 'v9' }, b.defaultConfig()).fbEarlier, [], 'a fresh broadcast');
  assert.deepEqual(b.tSchedule(r2, { kidSlug: 'k', scheduledAt: iso(Date.now() + 5 * H) }, b.defaultConfig()).fbEarlier, []);
});
