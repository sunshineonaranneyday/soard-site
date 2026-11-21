/**
 * Reveal stats, Nov 21 2026 (Peter: "yes, fix 1 to 4", after a check of Dylan's and Max's History):
 *  1. a visit counts once its page sees a person (email security software opens the links and never does)
 *  2. the live video's numbers stop at the last moment the picture moved once the phone has stopped
 *  3. Facebook's notes say only what Facebook gave
 *  4. "there for the reveal" is the step each viewer saw it in (the moment plus their own delay), not the minute
 * Run: node --test tests/reveal-stats-human.test.mjs
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createD1 } from './lib/d1-shim.mjs';

const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const travel = (ms) => { offset += ms; };
const S = 1000, M = 60e3;

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
// What the scanners on Max's reveal said they were
const SCANNER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const SITE = 'https://sunshineonaranneyday.com';

let DB, env, b, rs, liveWatch, event, admin;
const ctx = (request) => ({ env, request, data: {}, waitUntil: () => {} });
const post = (url, body, ua = IPHONE) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify(body) });
const beacon = (body, ua) => event.onRequestPost(ctx(post(`${SITE}/api/broadcast-event`, body, ua)));
const watch = (body, ua) => liveWatch.onRequestPost(ctx(post(`${SITE}/api/live-watch`, body, ua)));
const viewer = (id, vid) => DB.prepare('SELECT * FROM broadcast_viewers WHERE broadcast_id = ? AND vid = ?').bind(id, vid).first();
const rowsOf = async (id) => (await DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).all()).results.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') }));
const text = (n) => (n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(text).join(' ')
  : typeof n.type === 'function' ? text(n.type(n.props)) : text(n.props?.children));

async function setState(patch) {
  const s = { ...b.defaultState(), ...(await b.readState(DB)), ...patch };
  await b.writeState(DB, s);
  return s;
}

before(async () => {
  DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  env = { DB };
  b = await import('../functions/api/_broadcast.js');
  rs = await import('../functions/api/_reveal-stats.js');
  liveWatch = await import('../functions/api/live-watch.js');
  event = await import('../functions/api/broadcast-event.js');
  admin = await import('../public/admin/reveal-stats.js');
  await b.ensureSchema(DB);
  await rs.ensureStatsSchema(DB);
});

// ─── 1. A person ────────────────────────────────────────────────────

test('a database from before: the two columns are added, and the rows already there still count', async () => {
  const old = await createD1({ schemaSql: [`CREATE TABLE broadcast_viewers (
    broadcast_id TEXT NOT NULL, vid TEXT NOT NULL, who TEXT, src TEXT, first_at TEXT, last_at TEXT,
    before_live INTEGER NOT NULL DEFAULT 0, live_sec INTEGER NOT NULL DEFAULT 0, live_first_at INTEGER, live_seen_at INTEGER,
    replay_sec INTEGER NOT NULL DEFAULT 0, replay_first_at INTEGER, replay_seen_at INTEGER, live_min TEXT NOT NULL DEFAULT ',',
    PRIMARY KEY (broadcast_id, vid))`, `CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)`,
  `INSERT INTO broadcast_viewers (broadcast_id, vid, src) VALUES ('live-1', 'oldviewer1', 'email')`] });
  rs.resetStatsSchemaFlag();
  await rs.ensureStatsSchema(old);
  const r = await old.prepare(`SELECT human, live_ten FROM broadcast_viewers WHERE vid = 'oldviewer1'`).first();
  assert.equal(r.human, 1, 'a visit from before the sign was asked for counts as it did');
  assert.equal(r.live_ten, '');
  // Run again (another isolate): nothing breaks on columns already there
  rs.resetStatsSchemaFlag();
  await rs.ensureStatsSchema(old);
  rs.resetStatsSchemaFlag();
  await rs.ensureStatsSchema(DB);
});

test('a visit with no sign of a person is kept apart; a tap later counts it, once, with where it came from', async () => {
  const s = await setState({ phase: 'scheduled', broadcastId: 'live-500', kidSlug: 'max', kidName: 'Max', scheduledAt: new Date(Date.now() + 30 * M).toISOString() });
  // Security software opens the email's link: the page loads and reports its view, and nothing else happens
  await beacon({ type: 'view_live_page', broadcastId: s.broadcastId, vid: 'scanner001', src: 'email', meta: { kid: 'max' } }, SCANNER);
  let r = await viewer(s.broadcastId, 'scanner001');
  assert.equal(r.human, 0);
  assert.equal(r.src, 'email');
  assert.equal(r.before_live, 1);
  // A person: the view itself carries the sign (they'd scrolled before it went)
  await beacon({ type: 'view_live_page', broadcastId: s.broadcastId, vid: 'personAA1', src: 'email', h: 1, meta: { kid: 'max' } });
  assert.equal((await viewer(s.broadcastId, 'personAA1')).human, 1);
  // A person whose first sign comes after the view: the page's 'human' beacon
  await beacon({ type: 'view_live_page', broadcastId: s.broadcastId, vid: 'personBB1', meta: { kid: 'max' } });
  assert.equal((await viewer(s.broadcastId, 'personBB1')).human, 0);
  await beacon({ type: 'human', broadcastId: s.broadcastId, vid: 'personBB1', h: 1, meta: { kid: 'max' } });
  r = await viewer(s.broadcastId, 'personBB1');
  assert.equal(r.human, 1);
  assert.equal(r.before_live, 1, 'still the visit from before the reveal');
  // Seen stays seen: a later view without the sign (a reload) doesn't undo it
  await beacon({ type: 'view_live_page', broadcastId: s.broadcastId, vid: 'personBB1', meta: { kid: 'max' } });
  assert.equal((await viewer(s.broadcastId, 'personBB1')).human, 1);
  // 'human' is never logged as an event (only the views are)
  const ev = await DB.prepare(`SELECT type, COUNT(*) AS n FROM broadcast_events WHERE broadcast_id = ? GROUP BY type`).bind(s.broadcastId).all();
  assert.deepEqual(Object.fromEntries(ev.results.map((x) => [x.type, x.n])), { view_live_page: 4 });
  // Another child's page shows that child, not this reveal: its sign isn't this reveal's person either
  await beacon({ type: 'human', broadcastId: s.broadcastId, vid: 'otherkid01', h: 1, meta: { kid: 'dylan-2026' } });
  assert.equal(await viewer(s.broadcastId, 'otherkid01'), null);
  // Staff stay staff
  await beacon({ type: 'human', broadcastId: s.broadcastId, vid: 'staffer099', who: 'staff', h: 1, meta: { kid: 'max' } });
  assert.equal((await viewer(s.broadcastId, 'staffer099')).who, 'staff');
});

test('watching live: the seconds are kept for everyone, and the report carrying the sign counts the whole visit', async () => {
  const liveAt = new Date(Date.now()).toISOString();
  const s = await setState({ phase: 'live', liveAt, source: 'stream' });
  travel(30 * S);
  // Stream's own player showing on a page nobody touched (it counts as showing): seconds, but no person
  await watch({ broadcastId: s.broadcastId, vid: 'scanner001', kind: 'live', sec: 12 }, SCANNER);
  let r = await viewer(s.broadcastId, 'scanner001');
  assert.equal(r.live_sec, 12);
  assert.equal(r.human, 0);
  assert.equal(await rs.watchingNow(DB, s.broadcastId), 0, 'not watching at once either');
  // A person whose first 10 s of the picture moving are its sign
  await watch({ broadcastId: s.broadcastId, vid: 'personCC1', kind: 'live', sec: 10, h: 1 });
  assert.equal((await viewer(s.broadcastId, 'personCC1')).human, 1);
  assert.equal(await rs.watchingNow(DB, s.broadcastId), 1);
  // One whose sign comes late: its earlier seconds were kept and now count
  await watch({ broadcastId: s.broadcastId, vid: 'personDD1', kind: 'live', sec: 10 });
  travel(20 * S);
  await watch({ broadcastId: s.broadcastId, vid: 'personDD1', kind: 'live', sec: 20, h: 1 });
  r = await viewer(s.broadcastId, 'personDD1');
  assert.equal(r.human, 1);
  assert.equal(r.live_sec, 30);
  // A report without the sign after it (a reload) doesn't undo it
  travel(20 * S);
  await watch({ broadcastId: s.broadcastId, vid: 'personDD1', kind: 'live', sec: 20 });
  assert.equal((await viewer(s.broadcastId, 'personDD1')).human, 1);
});

test('History counts people only: before, live, sources and the live video leave the security software out, and say so', async () => {
  const s = await b.readState(DB);
  await DB.prepare(`INSERT INTO broadcasts (id, kid_slug, kid_name, title, live_at, phase, source, data, created_at) VALUES (?, 'max', 'Max', 'Max''s room reveal', ?, 'live', 'stream', '{}', ?)`)
    .bind(s.broadcastId, s.liveAt, new Date(Date.now() - 60 * M).toISOString()).run();
  // The scanner's player started and failed; a person's played
  await watch({ broadcastId: s.broadcastId, vid: 'scanner001', kind: 'live', sec: 0, player: { m: 'scanmount', e: 'hls', d: 'computer', w: 12000, er: 1 } }, SCANNER);
  await watch({ broadcastId: s.broadcastId, vid: 'personCC1', kind: 'live', sec: 0, h: 1, player: { m: 'ccmount01', e: 'mms', d: 'iphone', f: 900, s: 20 } });
  const st = (await rs.historyStats(DB, await rowsOf(s.broadcastId))).byId[s.broadcastId];
  assert.equal(st.people, 4, 'A, B, C and D: the visits with a person seen (staff, the other child\'s page and the scanner aren\'t)');
  assert.equal(st.unseen, 1, 'the scanner');
  assert.equal(st.before, 2, 'A and B came before; the scanner did too but isn\'t counted');
  assert.equal(st.live, 2, 'C and D watched live; the scanner\'s 12 s aren\'t a person');
  assert.deepEqual(st.sources, { email: 1, direct: 3 }, 'A from the email; the scanner\'s email visit isn\'t in it');
  assert.equal(st.video.viewers, 1, 'the scanner\'s failed player isn\'t a viewer\'s');
  assert.equal(st.video.errored, 0);
  const shown = text(admin.RevealDetail({ r: { ...(await rowsOf(s.broadcastId))[0], stats: st, events: {} }, since: '2026-01-01T00:00:00.000Z', fmtDate: (d) => d })).replace(/\s+/g, ' ');
  assert.match(shown, /Not counted: 1 staff visit and 1 visit with no sign of a person \(security software opening an email's links, mostly\) ?\./);
  const people = admin.COLUMNS.find((c) => c.key === 'people').means;
  assert.match(people, /once the page sees a person/);
});

// ─── 4. There for the reveal ────────────────────────────────────────

test('the 10-second steps a live report covered are kept, whatever order the reports come in', async () => {
  const liveAt = new Date(Date.now()).toISOString();
  const s = await setState({ phase: 'live', broadcastId: 'live-600', liveAt, source: 'stream' });
  travel(75 * S);
  await watch({ broadcastId: s.broadcastId, vid: 'stepper01', kind: 'live', sec: 20, h: 1 }); // 0:55 to 1:15
  assert.equal((await viewer(s.broadcastId, 'stepper01')).live_ten, '00000111');
  travel(60 * S);
  await watch({ broadcastId: s.broadcastId, vid: 'stepper01', kind: 'live', sec: 20, h: 1 }); // 1:55 to 2:15
  assert.equal((await viewer(s.broadcastId, 'stepper01')).live_ten, '00000111000111');
  assert.equal((await viewer(s.broadcastId, 'stepper01')).live_min, ',0,1,2,');
  // A short report inside what's there already changes nothing it shouldn't
  await watch({ broadcastId: s.broadcastId, vid: 'stepper01', kind: 'live', sec: 1, h: 1 }); // 2:14 to 2:15
  assert.equal((await viewer(s.broadcastId, 'stepper01')).live_ten, '00000111000111');
  // A new browser's first report starts its own string
  await watch({ broadcastId: s.broadcastId, vid: 'stepper02', kind: 'live', sec: 10, h: 1 }); // 2:05 to 2:15
  assert.equal((await viewer(s.broadcastId, 'stepper02')).live_ten, '00000000000011');
  // The replay marks nothing
  await setState({ phase: 'replay', endedAt: new Date(Date.now()).toISOString() });
  travel(5 * M);
  await watch({ broadcastId: s.broadcastId, vid: 'stepper02', kind: 'replay', sec: 60, h: 1 });
  assert.equal((await viewer(s.broadcastId, 'stepper02')).live_ten, '00000000000011');
});

test('wasThere: the step the viewer saw it in; rows from before the steps by the minute and their first and last report', () => {
  const liveAtMs = Date.parse('2026-11-20T21:00:31.926Z');
  const at = (sec) => liveAtMs + sec * 1000;
  // Max's reveal as stored: the child sees the room 423 s after going live; viewers saw it about 20 s later (443 s)
  const moment = { momentSec: 423, behindSec: 20, liveAtMs };
  // Left at 7:06 after going live, 37 s before they'd have seen it, but watching in minute 7: not there (it said so before)
  const leftEarly = { live_min: ',5,6,7,', live_ten: '', live_first_at: at(324), live_seen_at: at(426) };
  assert.equal(rs.wasThere(leftEarly, moment), false);
  // Joined at 7:01 and watched on to 8:31: there
  assert.equal(rs.wasThere({ live_min: ',6,7,8,', live_ten: '', live_first_at: at(431), live_seen_at: at(511) }, moment), true);
  // Watching the whole time: there
  assert.equal(rs.wasThere({ live_min: ',0,1,2,3,4,5,6,7,8,9,10,11,12,', live_ten: '', live_first_at: at(30), live_seen_at: at(736) }, moment), true);
  // Joined 7:30 after going live, after they'd have seen it, though in its minute: not there
  assert.equal(rs.wasThere({ live_min: ',7,8,', live_ten: '', live_first_at: at(460), live_seen_at: at(500) }, moment), false);
  // The steps say it on their own: the step of 443 s is the 45th
  const ten = (from, to) => '0'.repeat(from) + '1'.repeat(to - from + 1);
  assert.equal(rs.wasThere({ live_min: ',7,', live_ten: ten(44, 46) }, moment), true);
  assert.equal(rs.wasThere({ live_min: ',7,', live_ten: ten(42, 43) }, moment), false, 'stopped at 7:20, before 7:23');
  assert.equal(rs.wasThere({ live_min: ',7,', live_ten: ten(45, 47) }, moment), false, 'started at 7:30');
  // Their own delay: one 30 s behind saw it at 7:33
  assert.equal(rs.wasThere({ live_ten: ten(45, 47) }, { ...moment, behindSec: 30 }), true);
  assert.equal(rs.wasThere({ live_ten: '111' }, { momentSec: Number.NaN, behindSec: 20, liveAtMs }), false);
});

test('History: "there for the reveal" uses each viewer\'s own delay, else the reveal\'s typical one, else the player\'s 20 s', async () => {
  const liveAtMs = Date.now() - 20 * M;
  const id = 'live-700';
  await DB.prepare(`INSERT INTO broadcasts (id, kid_slug, kid_name, title, live_at, ended_at, phase, replay_uid, source, data, created_at) VALUES (?, 'ava', 'Ava', 'Ava''s room reveal', ?, ?, 'replay', 'rec7', 'stream', ?, ?)`)
    .bind(id, new Date(liveAtMs).toISOString(), new Date(liveAtMs + 12 * M).toISOString(), JSON.stringify({ revealAtSeconds: 300 }), new Date(liveAtMs - 60 * M).toISOString()).run();
  const ten = (from, to) => '0'.repeat(from) + '1'.repeat(to - from + 1);
  const add = (vid, live_ten, behind) => DB.batch([
    DB.prepare(`INSERT INTO broadcast_viewers (broadcast_id, vid, live_sec, live_min, live_ten, human) VALUES (?, ?, 60, ',5,', ?, 1)`).bind(id, vid, live_ten),
    ...(behind == null ? [] : [DB.prepare(`INSERT INTO broadcast_player (broadcast_id, vid, mount, engine, device, first_ms, start_behind, reports, first_at, last_at) VALUES (?, ?, 'mount0001', 'mms', 'iphone', 800, ?, 1, 0, 0)`).bind(id, vid, behind)]),
  ]);
  await add('avaview01', ten(32, 32), 24); // own delay 24 s: saw it at 5:24, watched 5:20 to 5:29
  await add('avaview02', ten(30, 31), 20); // 20 s: saw it at 5:20, but stopped at 5:19
  await add('avaview03', ten(32, 32), 30); // 30 s: saw it at 5:30, stopped at 5:29
  await add('avaview04', ten(32, 32), null); // no numbers: the reveal's typical delay (24 s, the middle of 20, 24, 30): there
  await add('avaview05', ten(32, 32), 400); // a delay no live viewer has (watching from the start): the typical one, there
  // A visit with no person seen isn't counted however it watched
  await DB.prepare(`INSERT INTO broadcast_viewers (broadcast_id, vid, live_sec, live_min, live_ten, human) VALUES (?, 'avascan01', 60, ',5,', ?, 0)`).bind(id, ten(0, 40)).run();
  const st = (await rs.historyStats(DB, await rowsOf(id))).byId[id];
  assert.equal(st.live, 5);
  assert.equal(st.atReveal, 3, 'avaview01, 04 and 05');
  // With no viewer's numbers at all, the player's 20 s: the step of 5:20
  await DB.prepare('DELETE FROM broadcast_player WHERE broadcast_id = ?').bind(id).run();
  const st2 = (await rs.historyStats(DB, await rowsOf(id))).byId[id];
  assert.equal(st2.atReveal, 4, 'everyone watching 5:20 to 5:29: avaview01, 03, 04 and 05 (02 stopped at 5:19)');
});

// ─── 3. Facebook ────────────────────────────────────────────────────

test('Facebook: a reveal it gave nothing for says so, and never that reactions and comments came', () => {
  const r = { id: 'live-800', kid_slug: 'max', live_at: new Date(Date.now() - 20 * 3600e3).toISOString(), ended_at: new Date(Date.now() - 19 * 3600e3).toISOString(), phase: 'replay', replay_uid: 'x', source: 'stream', fb_live_video_id: '1598828265622520', fb_permalink: 'https://www.facebook.com/1/videos/2' };
  const denied = { liveVideoId: '1598828265622520', error: '(#200) read_insights permission missing', errorKind: 'denied', missing: 'read_insights', checkedAt: new Date().toISOString() };
  const series = [[38, 11, 0, null], [319, 27, 0, null], [713, 22, 0, null]];
  const s = { counted: true, people: 141, live: 34, atOnce: rsSummary(series), series: [], sources: {}, facebook: denied, youtube: null };
  const shown = text(admin.RevealDetail({ r: { ...r, stats: s, events: {} }, since: '2026-01-01T00:00:00.000Z', fmtDate: (d) => d, facebookOn: true })).replace(/\s+/g, ' ');
  assert.match(shown, /Facebook didn't share any numbers for this reveal/);
  assert.doesNotMatch(shown, /Reactions and comments still come through/);
  assert.match(shown, /Site 27, 5:19 after going live\. Facebook said 0 at every check, so it isn't in this\./);
  // Reactions and comments that did come: then it says they do
  const some = { ...denied, reactions: 41, comments: 9 };
  const shown2 = text(admin.RevealDetail({ r: { ...r, stats: { ...s, facebook: some }, events: {} }, since: '2026-01-01T00:00:00.000Z', fmtDate: (d) => d, facebookOn: true })).replace(/\s+/g, ' ');
  assert.match(shown2, /"read insights" permission\. Reactions and comments still come through\./);
  // A reveal that wasn't on Facebook says nothing about it under Most at once
  assert.equal(admin.peakNote(rsSummary(series)), 'Site 27, 5:19 after going live.');
  assert.match(admin.COLUMNS.find((c) => c.key === 'atOnce').means, /Facebook and YouTube added in when they gave a count/);
});
const rsSummary = (series) => rs.summarizeSeries(series);

// ─── 2. The live video once the phone stops ─────────────────────────

test('watch meter: once the phone stops, the player\'s numbers are those of the last moment the picture moved', async () => {
  const src = transformSync(readFileSync('src/utils/live-stats.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code;
  const listeners = {};
  globalThis.document = { visibilityState: 'visible', addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener: () => {} };
  globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener: () => {} };
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const realSetInterval = globalThis.setInterval;
  const make = (stopped) => {
    let t = 0;
    const video = { paused: false, ended: false, readyState: 4, currentTime: 0 };
    const health = { engine: 'mms', firstMs: 800, startBehind: 20, holds: 0, heldMs: 0, refused: 0, restarts: 0, fallbacks: 0, errors: 0 };
    const reports = [];
    const ticks = [];
    globalThis.setInterval = (fn) => { ticks.push(fn); return 1; };
    const meter = mod.watchMeter({ kind: 'live', video: () => video, player: () => ({ ...health }), phoneStopped: () => stopped.v, report: (k, sec, final, pl) => reports.push([sec, final, pl]), now: () => t });
    globalThis.setInterval = realSetInterval;
    const step = (n, hold = false) => { for (let i = 0; i < n; i++) { t += 1000; if (hold) { health.heldMs += 1000; } else if (!video.paused) video.currentTime += 1; ticks[0](); } };
    return { video, health, reports, meter, step };
  };

  // The end: the phone stops, the viewer plays the delay's last 20 s, the picture runs out and holds for an hour
  const stopped = { v: false };
  const a = make(stopped);
  a.step(60);
  stopped.v = true;
  a.step(20);
  a.health.holds = 1; // the picture ran out at the end (Reconnecting)
  a.step(3600, true);
  a.health.restarts = 1; // Stream closed the recording and the player picked up its last seconds
  a.meter.stop();
  const sentA = a.reports.map((x) => x[2]).filter(Boolean);
  assert.ok(sentA.length >= 3);
  assert.ok(sentA.every((p) => p.h === 0 && p.hm === 0 && p.x === 0), 'no freeze and no start-over from the end');
  assert.ok(a.reports.length < 12, 'a page left open on the end goes quiet (nothing changed to send)');

  // Frozen before the phone stopped (a real freeze): what it had when the phone stopped is kept, nothing after
  const stopped2 = { v: false };
  const c = make(stopped2);
  c.step(30);
  c.health.holds = 1;
  c.step(15, true); // 15 s of Reconnecting
  stopped2.v = true;
  c.step(600, true);
  c.meter.stop();
  const lastC = c.reports.map((x) => x[2]).filter(Boolean).pop();
  assert.equal(lastC.h, 1);
  assert.equal(lastC.hm, 16000, 'up to the moment the page heard the phone had stopped, not the 10 minutes after');

  // The phone drops and comes back (ending, then live again): the Reconnecting it caused counts once it's back
  const stopped3 = { v: false };
  const d = make(stopped3);
  d.step(30);
  stopped3.v = true; // dropped
  d.step(20);
  d.health.holds = 1;
  d.step(25, true);
  stopped3.v = false; // back: on air again
  d.step(1, true);
  d.step(30);
  d.meter.stop();
  const lastD = d.reports.map((x) => x[2]).filter(Boolean).pop();
  assert.equal(lastD.h, 1);
  assert.equal(lastD.hm, 26000, 'the drop\'s Reconnecting, seen by the viewer, counts');
  delete globalThis.document; delete globalThis.window;
});

test('a person: a tap, the wheel, a key or the mouse moving, or 10 s of the page\'s own picture; never Stream\'s iframe or a script\'s event', async () => {
  const src = transformSync(readFileSync('src/utils/live-stats.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code;
  const load = async () => {
    const listeners = {};
    globalThis.document = { visibilityState: 'visible', activeElement: null, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener: () => {} };
    globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((x) => x !== f); } };
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    const mod = await import(`data:text/javascript;base64,${Buffer.from(src + `\n//${Math.random()}`).toString('base64')}`);
    const fire = (t, e = {}) => { for (const f of [...(listeners[t] || [])]) f({ isTrusted: true, ...e }); };
    return { mod, fire, listeners };
  };
  // A script's event isn't a person
  let { mod, fire } = await load();
  fire('pointerdown', { isTrusted: false });
  assert.equal(mod.humanSign(), false);
  assert.equal(mod.sender().h, undefined);
  let heard = 0;
  mod.onHuman(() => heard++);
  fire('touchstart');
  assert.equal(mod.humanSign(), true);
  assert.equal(heard, 1);
  assert.equal(mod.sender().h, 1, 'every beacon after carries it');
  fire('keydown');
  assert.equal(heard, 1, 'heard once');
  mod.onHuman(() => heard++);
  assert.equal(heard, 2, 'one waiting after it hears it at once');
  for (const t of ['wheel', 'keydown', 'pointerdown']) { ({ mod, fire } = await load()); fire(t); assert.equal(mod.humanSign(), true, t); }
  // The mouse: moving it, not one step
  ({ mod, fire } = await load());
  fire('pointermove', { pointerType: 'mouse', movementX: 6, movementY: 2 });
  assert.equal(mod.humanSign(), false);
  for (let i = 0; i < 5; i++) fire('pointermove', { pointerType: 'mouse', movementX: 5, movementY: 3 });
  assert.equal(mod.humanSign(), true);
  // A click into Stream's own player: the page sees only its focus go there
  ({ mod, fire } = await load());
  globalThis.document.activeElement = { tagName: 'DIV' };
  fire('blur');
  assert.equal(mod.humanSign(), false);
  globalThis.document.activeElement = { tagName: 'IFRAME' };
  fire('blur');
  assert.equal(mod.humanSign(), true);
  // The page's own picture: 10 s of it moving
  ({ mod } = await load());
  const realSetInterval = globalThis.setInterval;
  const ticks = [];
  let t = 0;
  globalThis.setInterval = (fn) => { ticks.push(fn); return 1; };
  const video = { paused: false, ended: false, readyState: 4, currentTime: 0 };
  const reports = [];
  mod.watchMeter({ kind: 'live', video: () => video, report: (k, sec) => reports.push([sec, mod.sender().h]), now: () => t });
  let iframeOn = true;
  const ticks2 = [];
  globalThis.setInterval = (fn) => { ticks2.push(fn); return 2; };
  mod.watchMeter({ kind: 'live', video: () => null, iframe: () => iframeOn, report: () => {}, now: () => t });
  globalThis.setInterval = realSetInterval;
  video.paused = true;
  for (let i = 0; i < 9; i++) { t += 1000; ticks[0](); ticks2[0](); }
  assert.equal(mod.humanSign(), false, 'Stream\'s iframe showing for 9 s isn\'t a person');
  for (let i = 0; i < 30; i++) { t += 1000; ticks[0](); ticks2[0](); }
  assert.equal(mod.humanSign(), false, 'nor for 39 s');
  video.paused = false;
  for (let i = 0; i < 9; i++) { t += 1000; video.currentTime += 1; ticks[0](); }
  assert.equal(mod.humanSign(), false);
  t += 1000; video.currentTime += 1; ticks[0]();
  assert.equal(mod.humanSign(), true, '10 s of the page\'s own picture moving');
  assert.deepEqual(reports[0], [10, 1], 'the report of those 10 s carries it');
  iframeOn = false;
  delete globalThis.document; delete globalThis.window; delete globalThis.localStorage;
});

test('Facebook: reactions and comments are asked for apart, so one refused never loses the other', async () => {
  const fb = await import('../functions/api/_broadcast-fb.js');
  const realFetch = globalThis.fetch;
  const asked = [];
  // Facebook as it answered on Nov 21 2026: views and average watch only, the comments count when asked alone, and a
  // request naming reactions refused
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.pathname + url.search);
    const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (/\/video_insights$/.test(url.pathname)) return j({ data: [{ name: 'total_video_views', values: [{ value: 3 }] }, { name: 'total_video_avg_time_watched', values: [{ value: 15_000 }] }] });
    const fields = url.searchParams.get('fields') || '';
    if (/reactions/.test(fields)) return j({ error: { message: '(#100) Tried accessing nonexisting field (reactions)', code: 100 } }, 400);
    if (/comments/.test(fields)) return j({ id: '1696905131784130', comments: { summary: { total_count: 1 } } });
    return j({ error: { message: 'not mocked' } }, 400);
  };
  try {
    const r = await fb.fbVideoTotals({ FB_PAGE_ID: 'page', FB_PAGE_TOKEN: 'tok' }, { videoId: '1696905131784130' });
    assert.equal(r.ok, true);
    assert.deepEqual({ views: r.totals.views, avgSec: r.totals.avgSec, comments: r.totals.comments, reactions: r.totals.reactions, unique: r.totals.unique },
      { views: 3, avgSec: 15, comments: 1, reactions: undefined, unique: null }, 'what Facebook gave, and nothing it didn\'t');
    assert.equal(asked.filter((a) => /fields=/.test(a)).length, 2, 'reactions and comments, each on its own');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── The independent review's findings (Nov 21 2026) ────────────────

test('review: Facebook\'s live count words: said 0, said 0 when it answered, or never read; and "only its count while live"', () => {
  const r = { id: 'live-801', kid_slug: 'max', live_at: new Date(Date.now() - 20 * 3600e3).toISOString(), ended_at: new Date(Date.now() - 19 * 3600e3).toISOString(), phase: 'replay', replay_uid: 'x', source: 'stream', fb_live_video_id: '1', fb_permalink: 'https://www.facebook.com/1/videos/2' };
  const on = { onFacebook: true };
  assert.match(admin.peakNote(rs.summarizeSeries([[38, 11, 0, null], [319, 27, 0, null]]), on), /Facebook said 0 at every check, so it isn't in this\.$/);
  assert.match(admin.peakNote(rs.summarizeSeries([[38, 11, 0, null], [319, 27, null, null]]), on), /Facebook said 0 whenever it answered, so it isn't in this\.$/);
  assert.match(admin.peakNote(rs.summarizeSeries([[38, 11, null, null], [319, 27, null, null]]), on), /Facebook's live count couldn't be read, so it isn't in this\.$/);
  assert.doesNotMatch(admin.peakNote(rs.summarizeSeries([[38, 11, 4, null], [319, 27, 9, null]]), on), /Facebook said|couldn't be read/);
  // Facebook's live count came through, its totals didn't: never "didn't share any numbers" beside a Facebook number
  const series = [[38, 11, 4, null], [319, 27, 9, null]];
  const s = { counted: true, people: 141, live: 34, atOnce: rs.summarizeSeries(series), series: [], sources: {}, youtube: null,
    facebook: { liveVideoId: '1', error: '(#200) read_insights permission missing', errorKind: 'denied', missing: 'read_insights', checkedAt: new Date().toISOString() } };
  const shown = text(admin.RevealDetail({ r: { ...r, stats: s, events: {} }, since: '2026-01-01T00:00:00.000Z', fmtDate: (d) => d, facebookOn: true })).replace(/\s+/g, ' ');
  assert.match(shown, /Most at once 9/);
  assert.match(shown, /Facebook didn't share its totals for this reveal, only its count while live\./);
  assert.doesNotMatch(shown, /didn't share any numbers/);
});

test('review: the meter on a page opened after the phone stopped, and a long gap at the stop', async () => {
  const src = transformSync(readFileSync('src/utils/live-stats.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code;
  globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src + `\n//${Math.random()}`).toString('base64')}`);
  const realSetInterval = globalThis.setInterval;
  const make = (stopped) => {
    let t = 0;
    const video = { paused: true, ended: false, readyState: 0, currentTime: 0 };
    const health = { engine: 'mms', firstMs: null, startBehind: null, holds: 0, heldMs: 0, refused: 0, restarts: 0, fallbacks: 0, errors: 0 };
    const reports = [];
    const ticks = [];
    globalThis.setInterval = (fn) => { ticks.push(fn); return 1; };
    const meter = mod.watchMeter({ kind: 'live', video: () => video, player: () => ({ ...health }), phoneStopped: () => stopped.v, report: (k, sec, final, pl) => reports.push([sec, final, pl]), now: () => t });
    globalThis.setInterval = realSetInterval;
    const tick = (ms = 1000, move = !video.paused) => { t += ms; if (move) video.currentTime += ms / 1000; ticks[0](); };
    return { video, health, reports, meter, tick };
  };
  // Opened while the broadcast is ending (the delay's last seconds still to play): its first picture and delay are sent,
  // then the end's hold isn't
  const a = make({ v: true });
  a.tick(); a.tick();
  a.video.paused = false; a.health.firstMs = 2100; a.health.startBehind = 19.6;
  for (let i = 0; i < 18; i++) a.tick();
  a.video.paused = true; a.health.holds = 1;
  for (let i = 0; i < 60; i++) { a.health.heldMs += 1000; a.tick(); }
  a.meter.stop();
  const sentA = a.reports.map((x) => x[2]).filter(Boolean);
  assert.ok(sentA.some((p) => p.f === 2100 && p.s === 19.6), `its first picture and delay went (${JSON.stringify(sentA.at(-1))})`);
  assert.ok(sentA.every((p) => p.h === 0 && p.hm === 0), 'and not the end\'s hold');
  // Asleep across the stop: on waking the player starts over and its clock jumps; what's kept is from before the gap
  const stopped = { v: false };
  const b = make(stopped);
  b.video.paused = false; b.health.firstMs = 900; b.health.startBehind = 20;
  for (let i = 0; i < 30; i++) b.tick();
  stopped.v = true;
  b.health.restarts = 1; b.health.holds = 1; b.health.heldMs = 5000;
  b.tick(600_000, true); // ten minutes asleep, then the picture's clock jumps
  for (let i = 0; i < 30; i++) b.tick(1000, false);
  b.meter.stop();
  const lastB = b.reports.map((x) => x[2]).filter(Boolean).pop();
  assert.equal(lastB.x, 0, 'the start-over on waking isn\'t counted');
  assert.equal(lastB.h, 0);
  delete globalThis.document; delete globalThis.window;
});

test('review: a column can\'t be added for another reason: thrown, so the next request tries again', async () => {
  let fail = true;
  const real = await createD1({ schemaSql: [`CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)`] });
  const flaky = { ...real, batch: (s) => real.batch(s), prepare: (sql) => {
    if (fail && /^ALTER TABLE broadcast_viewers ADD COLUMN human/.test(sql)) return { run: async () => { throw new Error('D1_ERROR: Network connection lost.'); }, bind: () => ({ run: async () => { throw new Error('D1_ERROR: Network connection lost.'); } }) };
    return real.prepare(sql);
  } };
  rs.resetStatsSchemaFlag();
  await assert.rejects(() => rs.ensureStatsSchema(flaky), /Network connection lost/);
  fail = false;
  await rs.ensureStatsSchema(flaky); // tried again, and this time it's there (live_ten was already added: fine)
  const cols = (await real.prepare('PRAGMA table_info(broadcast_viewers)').all()).results.map((c) => c.name);
  assert.ok(cols.includes('human') && cols.includes('live_ten'));
  rs.resetStatsSchemaFlag();
  await rs.ensureStatsSchema(DB);
});

test('review 2: a page opened after the phone stopped that never gets a picture never counts hours of Reconnecting; Facebook\'s words name only what came', async () => {
  const src = transformSync(readFileSync('src/utils/live-stats.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code;
  globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src + `\n//${Math.random()}`).toString('base64')}`);
  const realSetInterval = globalThis.setInterval;
  let t = 0;
  const ticks = [];
  const video = { paused: true, ended: false, readyState: 0, currentTime: 0 };
  const health = { engine: 'mms', firstMs: null, waitedMs: 0, startBehind: null, holds: 0, heldMs: 0, refused: 0, restarts: 0, fallbacks: 0, errors: 0 };
  const reports = [];
  globalThis.setInterval = (fn) => { ticks.push(fn); return 1; };
  const meter = mod.watchMeter({ kind: 'live', video: () => video, player: () => ({ ...health }), phoneStopped: () => true, report: (k, sec, final, pl) => reports.push(pl), now: () => t });
  globalThis.setInterval = realSetInterval;
  for (let i = 0; i < 3 * 3600; i++) { t += 1000; health.waitedMs += 1000; if (i === 5) { health.holds = 1; health.restarts = 2; health.errors = 3; } if (i > 5) health.heldMs += 1000; ticks[0](); }
  meter.stop();
  const last = reports.filter(Boolean).pop();
  assert.deepEqual([last.h, last.hm, last.x, last.er], [0, 0, 0, 0], 'three hours on Reconnecting with no phone: none of it');
  assert.equal(last.w, 60000, 'its wait still says it had something to play and no picture');
  delete globalThis.document; delete globalThis.window;

  // Comments came, reactions didn't (asked for apart): the words say comments
  const r = { id: 'live-802', kid_slug: 'max', live_at: new Date(Date.now() - 20 * 3600e3).toISOString(), ended_at: new Date(Date.now() - 19 * 3600e3).toISOString(), phase: 'replay', replay_uid: 'x', source: 'stream', fb_live_video_id: '1' };
  const say = (facebook) => text(admin.RevealDetail({ r: { ...r, stats: { counted: true, people: 1, live: 1, atOnce: null, series: [], sources: {}, youtube: null, facebook }, events: {} }, since: '2026-01-01T00:00:00.000Z', fmtDate: (d) => d, facebookOn: true })).replace(/\s+/g, ' ');
  const now = new Date().toISOString();
  assert.match(say({ comments: 1, missing: 'read_insights', error: '(#200) read_insights permission missing', errorKind: 'denied', checkedAt: now }), /"read insights" permission\. Comments still come through\./);
  assert.match(say({ comments: 1, error: 'An unexpected error has occurred.', errorKind: 'partial', checkedAt: now, readAt: now }), /Facebook sent comments .*but not its view totals/);
  assert.match(say({ reactions: 5, comments: 1, error: 'An unexpected error has occurred.', errorKind: 'partial', checkedAt: now, readAt: now }), /Facebook sent reactions and comments .*but not its view totals/);
});
