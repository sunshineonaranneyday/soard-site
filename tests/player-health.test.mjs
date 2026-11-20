/**
 * What each viewer's live video did, sent with the watch reports and shown in Broadcast → History (Peter, Nov 19 2026:
 * "Yes, build it", after a phone viewer of Dylan's reveal saw it go back about 20 s three times and the site had no
 * record of any viewer's video). The live player keeps its own numbers (live-player.ts health); the page's watch meter
 * sends them (live-stats.ts); /api/live-watch keeps the largest of each per viewer and start of the player
 * (_reveal-stats.js recordPlayer); History sums them per reveal (summarizePlayers, VideoHealth).
 * Run: node --test tests/player-health.test.mjs
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createD1 } from './lib/d1-shim.mjs';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const SITE = 'https://sunshineonaranneyday.com';

let DB, env, b, rs, liveWatch, admin, live;
const ctx = (request) => ({ env, request, data: {}, waitUntil: () => {} });
const post = (body, ua = IPHONE, host = SITE) => liveWatch.onRequestPost(ctx(new Request(`${host}/api/live-watch`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify(body),
})));
const rowsOf = (vid) => DB.prepare('SELECT * FROM broadcast_player WHERE broadcast_id = ? AND vid = ? ORDER BY mount').bind(live, vid).all().then((r) => r.results);
const P = (o = {}) => ({ m: 'mount0001', e: 'mms', d: 'iphone', f: 5200, s: 20.1, h: 0, hm: 0, r: 0, x: 0, b: 0, er: 0, ...o });

before(async () => {
  DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  env = { DB };
  b = await import('../functions/api/_broadcast.js');
  rs = await import('../functions/api/_reveal-stats.js');
  liveWatch = await import('../functions/api/live-watch.js');
  admin = await import('../public/admin/reveal-stats.js');
  await b.ensureSchema(DB);
  await rs.ensureStatsSchema(DB);
  const s = { ...b.defaultState(), ...(await b.readState(DB)), phase: 'live', live: true, broadcastId: 'live-900', liveAt: new Date(Date.now() - 5 * 60e3).toISOString(), source: 'stream' };
  await b.writeState(DB, s);
  live = s.broadcastId;
});

test('cleanPlayer: only known words, whole numbers, never negative, capped; nothing without its own start id', () => {
  assert.equal(rs.cleanPlayer(null), null);
  assert.equal(rs.cleanPlayer({ e: 'mms' }), null, 'no start id');
  assert.equal(rs.cleanPlayer({ m: 'BAD id!' }), null);
  const c = rs.cleanPlayer({ m: 'abc12345', e: 'flash', d: 'toaster', f: -3, s: 9999, h: -1, hm: 1e12, r: 2.6, x: 'x', b: 50, er: 3 });
  assert.deepEqual(c, { mount: 'abc12345', engine: null, device: null, firstMs: null, waitedMs: null, startBehind: null, holds: 0, heldMs: 4 * 3600e3, refused: 3, restarts: 0, fallbacks: 10, errors: 3 });
  assert.equal(rs.cleanPlayer(P({ w: -5 })).waitedMs, 0);
  assert.equal(rs.cleanPlayer(P({ w: 1e12 })).waitedMs, 4 * 3600e3);
  assert.equal(rs.cleanPlayer(P({ s: 20.14 })).startBehind, 20.1, 'the start delay to a tenth');
});

test('live-watch: the numbers come with the seconds, alone (no picture yet), and keep the largest of each', async () => {
  // Nothing watched yet: still counted (the viewer who never gets a picture is the one to know about)
  await post({ broadcastId: live, vid: 'viewerAAA1', kind: 'live', sec: 0, player: P({ f: undefined, s: undefined }) });
  let [r] = await rowsOf('viewerAAA1');
  assert.equal(r.engine, 'mms');
  assert.equal(r.device, 'iphone');
  assert.equal(r.first_ms, null);
  const seen = await DB.prepare('SELECT * FROM broadcast_viewers WHERE broadcast_id = ? AND vid = ?').bind(live, 'viewerAAA1').first();
  assert.ok(!seen || !seen.live_sec, 'no seconds were claimed');
  // Then the picture, seconds watched, a freeze
  await post({ broadcastId: live, vid: 'viewerAAA1', kind: 'live', sec: 10, player: P({ h: 1, hm: 6000 }) });
  [r] = await rowsOf('viewerAAA1');
  assert.equal(r.first_ms, 5200);
  assert.equal(r.start_behind, 20.1);
  assert.equal(r.holds, 1);
  assert.equal(r.held_ms, 6000);
  assert.equal((await DB.prepare('SELECT live_sec FROM broadcast_viewers WHERE broadcast_id = ? AND vid = ?').bind(live, 'viewerAAA1').first()).live_sec, 10);
  // A late report with smaller numbers changes nothing; the first picture stays the first one
  await post({ broadcastId: live, vid: 'viewerAAA1', kind: 'live', sec: 0, player: P({ f: 9000, h: 0, hm: 0 }) });
  [r] = await rowsOf('viewerAAA1');
  assert.equal(r.holds, 1);
  assert.equal(r.held_ms, 6000);
  assert.equal(r.first_ms, 5200);
  assert.equal(r.reports, 3);
  // The page opened again: its own start of the player, its own row
  await post({ broadcastId: live, vid: 'viewerAAA1', kind: 'live', sec: 0, player: P({ m: 'mount0002', f: 3000, r: 2 }) });
  assert.equal((await rowsOf('viewerAAA1')).length, 2);
});

test('live-watch: replays, bots, tests and rehearsals are not counted as live video', async () => {
  await post({ broadcastId: live, vid: 'viewerRPL1', kind: 'replay', sec: 0, player: P() });
  assert.equal((await rowsOf('viewerRPL1')).length, 0, 'the replay player sends no numbers');
  await post({ broadcastId: live, vid: 'viewerBOT1', kind: 'live', sec: 0, player: P() }, BOT);
  assert.equal((await rowsOf('viewerBOT1')).length, 0);
  await post({ broadcastId: live, vid: 'viewerTST1', kind: 'live', sec: 0, player: P() }, IPHONE, 'https://soard-site.pages.dev');
  assert.equal((await rowsOf('viewerTST1'))[0].who, 'test', 'not the real site: kept apart');
  await post({ broadcastId: 'live-123456', vid: 'viewerUNK1', kind: 'live', sec: 0, player: P() });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM broadcast_player WHERE broadcast_id = ?').bind('live-123456').first()).n, 0, 'a broadcast we never had');
  await post({ broadcastId: live, vid: 'viewerJNK1', kind: 'live', sec: 0, player: { e: 'mms' } });
  assert.equal((await rowsOf('viewerJNK1')).length, 0, 'numbers without a start id are nothing');
});

test('limits: at most 10 starts of the player per browser; numbers only near the reveal; seconds whatever happens to the numbers', async () => {
  for (let i = 0; i < 14; i++) await post({ broadcastId: live, vid: 'viewerMNY1', kind: 'live', sec: 0, player: P({ m: `mny${String(i).padStart(5, '0')}`, h: 1, hm: 3600e3 }) });
  assert.equal((await rowsOf('viewerMNY1')).length, rs.PLAYER_MOUNTS_MAX, 'a page opened over and over adds nothing past 10');
  await post({ broadcastId: live, vid: 'viewerMNY1', kind: 'live', sec: 0, player: P({ m: 'mny00003', r: 5 }) });
  assert.equal((await rowsOf('viewerMNY1')).find((r) => r.mount === 'mny00003').refused, 5, 'a start already kept still updates');
  // An ended reveal: a page left open reports within a day; two days later, nothing
  const old = (ms) => new Date(Date.now() - ms).toISOString();
  await DB.prepare(`INSERT INTO broadcasts (id, title, live_at, ended_at, phase, source, data, created_at) VALUES
    ('live-801', 'Earlier reveal', ?, ?, 'replay', 'stream', '{}', ?), ('live-802', 'Old reveal', ?, ?, 'replay', 'stream', '{}', ?)`)
    .bind(old(2 * 3600e3), old(3600e3), old(3 * 3600e3), old(50 * 3600e3), old(49 * 3600e3), old(51 * 3600e3)).run();
  await post({ broadcastId: 'live-801', vid: 'viewerLTE1', kind: 'live', sec: 0, player: P() });
  await post({ broadcastId: 'live-802', vid: 'viewerLTE1', kind: 'live', sec: 0, player: P() });
  const kept = (await DB.prepare("SELECT broadcast_id FROM broadcast_player WHERE vid = 'viewerLTE1'").all()).results.map((r) => r.broadcast_id);
  assert.deepEqual(kept, ['live-801'], 'within a day of the end, yes; two days after, no');
  // The site's current reveal, ended two days ago (it stays current until the next is set up): no more numbers
  const was = await b.readState(DB);
  const pastCache = () => new Promise((r) => setTimeout(r, 3100)); // (live-watch keeps the state 3 s)
  await b.writeState(DB, { ...was, endedAt: old(48 * 3600e3) });
  await pastCache();
  await post({ broadcastId: live, vid: 'viewerOLD1', kind: 'live', sec: 0, player: P() });
  assert.equal((await rowsOf('viewerOLD1')).length, 0, 'ended two days ago, though still current');
  await b.writeState(DB, was);
  await pastCache();
  // The numbers' table broken: the seconds on the same report are still counted
  await DB.prepare('ALTER TABLE broadcast_player RENAME TO broadcast_player_away').run();
  await post({ broadcastId: live, vid: 'viewerSEC1', kind: 'live', sec: 12, player: P({ m: 'sec00001' }) });
  assert.equal((await DB.prepare('SELECT live_sec FROM broadcast_viewers WHERE broadcast_id = ? AND vid = ?').bind(live, 'viewerSEC1').first())?.live_sec, 12);
  await DB.prepare('ALTER TABLE broadcast_player_away RENAME TO broadcast_player').run();
  // and History still loads without it, the other numbers intact
  await DB.prepare('ALTER TABLE broadcast_player RENAME TO broadcast_player_away').run();
  const rowsLive = [{ id: live, live_at: new Date().toISOString(), created_at: new Date().toISOString(), data: {} }];
  const st = (await rs.historyStats(DB, rowsLive)).byId[live];
  assert.equal(st.video, null);
  assert.ok(st.live >= 1, 'the rest of History is there');
  await DB.prepare('ALTER TABLE broadcast_player_away RENAME TO broadcast_player').run();
  await DB.prepare("DELETE FROM broadcast_player WHERE vid IN ('viewerMNY1', 'viewerSEC1')").run();
  await DB.prepare("DELETE FROM broadcast_viewers WHERE vid IN ('viewerMNY1', 'viewerSEC1')").run();
});

test('History: a reveal\'s live video, over the public\'s browsers', async () => {
  const send = (vid, p, sec = 0) => post({ broadcastId: live, vid, kind: 'live', sec, player: P(p) });
  await send('viewerBBB1', { e: 'hls', d: 'computer', f: 4000, s: 21, h: 2, hm: 30000, r: 1 }, 20);
  await send('viewerCCC1', { e: 'native', d: 'iphone', f: 18000, s: 24, b: 1, x: 1 }, 20);
  await send('viewerDDD1', { e: 'mms', d: 'iphone', f: undefined, s: undefined, w: 8000 }); // ready to play 8 s, never a picture
  await send('viewerEEE1', { e: 'hls', d: 'android', f: undefined, s: undefined, w: 2000 }); // left 2 s after it was ready
  await send('viewerSTF1', { e: 'hls', d: 'computer', h: 9, hm: 99000 }); // staff, marked on a start
  await DB.prepare("UPDATE broadcast_player SET who = 'staff' WHERE vid = 'viewerSTF1'").run();
  // staff marked only on its viewer row (the admin opened in that browser): the whole browser is left out
  await send('viewerSTF2', { e: 'hls', d: 'computer', h: 4, hm: 50000 });
  await DB.prepare(`INSERT INTO broadcast_viewers (broadcast_id, vid, who, live_min) VALUES (?, 'viewerSTF2', 'staff', ',')
    ON CONFLICT(broadcast_id, vid) DO UPDATE SET who = 'staff'`).bind(live).run();
  await DB.prepare(`INSERT INTO broadcasts (id, kid_slug, kid_name, title, live_at, phase, source, data, created_at) VALUES (?, 'max', 'Max', 'Max''s room reveal', ?, 'live', 'stream', '{}', ?)`)
    .bind(live, new Date(Date.now() - 5 * 60e3).toISOString(), new Date().toISOString()).run();
  const rows = (await DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(live).all()).results.map((r) => ({ ...r, data: {} }));
  const v = (await rs.historyStats(DB, rows)).byId[live].video;
  // AAA1 (two starts: first picture 3.0 s, a freeze of 6 s, 2 moves stopped), BBB1, CCC1, DDD1, EEE1; staff and tests out
  assert.equal(v.viewers, 5);
  assert.equal(v.pictured, 3);
  assert.equal(v.never, 1, 'DDD1 had it ready 8 s and never got a picture; EEE1 left 2 s after it was ready');
  assert.equal(v.firstSec, 4, 'the middle of 3.0, 4.0 and 18.0 s');
  assert.equal(v.slowStart, 1, 'over 15 s to the first picture');
  assert.equal(v.startBehind, 21, 'the middle of 20.1, 21 and 24');
  assert.equal(v.froze, 2);
  assert.equal(v.frozeSec, 36, 'AAA1 6 s + BBB1 30 s');
  assert.equal(v.refused, 2, 'AAA1 and BBB1');
  assert.equal(v.restarted, 1);
  assert.equal(v.fellBack, 1);
  assert.equal(v.errored, 0);
  assert.deepEqual(v.devices, { iphone: 3, computer: 1, android: 1 });
  assert.deepEqual(v.engines, { mms: 2, hls: 2, native: 1 });
  // What History shows
  const text = (n) => (n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(text).join(' ')
    : typeof n.type === 'function' ? text(n.type(n.props)) : text(n.props?.children));
  const shown = text(admin.VideoHealth({ r: rows[0], v })).replace(/\s+/g, ' ');
  assert.match(shown, /Got a picture 3 of 5/);
  assert.match(shown, /Time to it 4 s/);
  assert.match(shown, /Never got one 1/);
  assert.match(shown, /Behind the phone 21 s/);
  assert.match(shown, /Froze 2 .*Frozen in all 0:36/);
  assert.match(shown, /Stopped going back 2/);
  assert.match(shown, /1 person had it ready to play and never got a picture/);
  assert.match(shown, /Time to it counts from when there was something to play/);
  assert.match(shown, /2 people saw Reconnecting/);
  assert.match(shown, /On iPhone 3 · Android 1 · Computer 1\. Played by the site's player 4, Safari's own player 1\./);
  // A reveal from before the numbers began
  const old = text(admin.VideoHealth({ r: { live_at: '2026-11-18T21:00:21.000Z', phase: 'replay' }, v: null }));
  assert.match(old, /began keeping what each viewer's video did on Nov 19 2026/);
});

test('watch meter: the player\'s numbers ride along, go alone by 20 s with nothing watched, and on leaving when changed', async () => {
  const src = transformSync(readFileSync('src/utils/live-stats.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code;
  const listeners = {};
  globalThis.document = { visibilityState: 'visible', addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener: () => {} };
  globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener: () => {} };
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  assert.equal(mod.deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', 5), 'iphone');
  assert.equal(mod.deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5), 'ipad', 'an iPad says Macintosh, with touch');
  assert.equal(mod.deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0), 'computer');
  assert.equal(mod.deviceKind('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'), 'android');
  let t = 0;
  const video = { paused: true, ended: false, readyState: 0, currentTime: 0 };
  const health = { engine: 'mms', firstMs: null, startBehind: null, holds: 0, heldMs: 0, refused: 0, restarts: 0, fallbacks: 0, errors: 0 };
  const reports = [];
  const ticks = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn) => { ticks.push(fn); return 1; };
  const meter = mod.watchMeter({ kind: 'live', video: () => video, player: () => ({ ...health }), report: (k, sec, final, pl) => reports.push([sec, final, pl]), now: () => t });
  globalThis.setInterval = realSetInterval;
  const step = (n) => { for (let i = 0; i < n; i++) { t += 1000; if (!video.paused) video.currentTime += 1; ticks[0](); } };
  step(19);
  assert.equal(reports.length, 0);
  step(1);
  assert.equal(reports.length, 1, 'no picture after 20 s: the numbers go anyway');
  assert.equal(reports[0][0], 0);
  assert.equal(reports[0][2].e, 'mms');
  assert.ok(/^[a-z0-9]{8}$/.test(reports[0][2].m), 'its own start id');
  assert.equal(reports[0][2].f, undefined, 'no first picture yet');
  step(30);
  assert.equal(reports.length, 1, 'unchanged numbers aren\'t sent again');
  // The picture comes: the seconds carry the numbers
  video.paused = false; health.firstMs = 52_000; health.startBehind = 20.1;
  step(10);
  assert.equal(reports.length, 2);
  assert.equal(reports[1][0], 10);
  assert.equal(reports[1][2].f, 52000);
  assert.equal(reports[1][2].s, 20.1);
  assert.equal(reports[1][2].m, reports[0][2].m, 'the same start of the player');
  // A freeze (no seconds): the changed numbers go every 20 s
  video.paused = true; health.holds = 1; health.heldMs = 4000;
  step(25);
  const last = reports[reports.length - 1];
  assert.equal(last[0], 0);
  assert.equal(last[2].h, 1);
  // Leaving: changed numbers go with the final beacon
  health.refused = 1;
  meter.stop();
  const fin = reports[reports.length - 1];
  assert.equal(fin[1], true);
  assert.equal(fin[2].r, 1);
  delete globalThis.document; delete globalThis.window;
});
