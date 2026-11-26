/**
 * Admin → Photos & Videos: the albums, What's happening, and the downloads
 * (public/admin/media-shared.js, functions/api/media-admin.js, media-download.js, _zip-stream.js).
 * Names, photographers and ids are made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1 } from './lib/d1-shim.mjs';
import * as M from '../public/admin/media-shared.js';
import { pagePairs, pageBefores } from '../public/admin/reveal-design.js';
import { zipStream, crc32 } from '../functions/api/_zip-stream.js';
import { broadcastOf } from '../functions/api/_media.js';
import { onRequestGet as adminGet } from '../functions/api/media-admin.js';
import { onRequestGet as dlGet, onRequestPost as dlPost, attachment } from '../functions/api/media-download.js';

const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
const UID = (c) => c.repeat(32).slice(0, 32);
const NOW = Date.parse('2026-11-25T17:00:00Z');
const T = (iso) => Date.parse(iso);

const ava = {
  name: 'Ava', slug: 'ava', year: 2026, status: 'completed', publishStatus: 'published', roomTypes: ['Accessible Bathroom'],
  photographer: 'Example Photography',
  heroImage: `${CF}/kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg/public`,
  photos: [
    { url: `${CF}/kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg/public`, alt: 'Ava in her new bathroom' },
    { url: `${CF}/kids/ava/${T('2026-11-23T15:01:00Z')}-FINAL-2.jpg/public`, alt: 'The roll-in shower' },
    { url: 'kids/ava/old-photo.jpg', alt: '' },
    { url: 'https://example.com/not-ours.jpg', alt: '' },
  ],
  storyPhotos: [{ url: `${CF}/kids/ava/story-1/public`, alt: '' }],
  beforeAfterPhotos: [
    { before: `${CF}/kids/ava/ba-before-${T('2026-11-24T12:00:00Z')}-x.jpg/public`, after: `${CF}/kids/ava/ba-after-${T('2026-11-24T12:00:00Z')}-y.jpg/public`, room: 'Bathroom' },
    // its before is kept off the page: the pair never shows
    { before: `${CF}/kids/ava/before-held.jpg/public`, after: `${CF}/kids/ava/ba-after-2.jpg/public`, room: '' },
    // waiting for the after photo
    { before: `${CF}/kids/ava/before-ok-2.jpg/public`, after: '', room: '' },
  ],
  beforePhotos: [
    { url: `${CF}/kids/ava/before-${T('2026-11-13T12:00:00Z')}-a.jpg/public`, looked: 'staff' },
    { url: `${CF}/kids/ava/before-held.jpg/public`, looked: 'site', offPage: true },
    { url: `${CF}/kids/ava/before-waiting.jpg/public` },
  ],
  streamVideoId: UID('a'),
  videoUrl: 'https://www.youtube.com/watch?v=AbCdEfGhIjK',
  revealVideoUrl: `https://watch.cloudflarestream.com/${UID('b')}`,
};
const ben = {
  name: 'Ben', slug: 'ben', year: 2026, status: 'in-progress', publishStatus: 'published', roomTypes: ['Dream Bedroom'],
  heroImage: `${CF}/kids/ben/hero/public`, photos: [{ url: `${CF}/kids/ben/1.jpg/public` }],
  beforePhotos: [{ url: `${CF}/kids/ben/before-1.jpg/public`, looked: 'staff' }],
};
const draft = { name: 'Cal', slug: 'cal', year: 2026, publishStatus: 'draft', heroImage: `${CF}/kids/cal/hero/public`, photos: [] };
const gala = {
  slug: 'gala-2026', title: '2026 Example Gala', date: '2026-11-10', status: 'past', location: 'Example Hall', time: '6 to 10 p.m.',
  image: `${CF}/events/gala-2026/hero/public`, photos: [{ id: 'events/gala-2026/p1', alt: 'Guests' }, { id: 'events/gala-2026/p2', alt: '' }],
  photographer: 'Gala Photos Co', photographerUrl: 'https://example.com', streamVideoId: UID('e'),
};
const golf = { slug: 'golf-2027', title: 'Example Golf Day', date: '2027-01-15', status: 'upcoming', location: 'Example Club', image: `${CF}/events/golf/hero/public`, photos: [] };
const cancelled = { slug: 'nope', title: 'Called off', date: '2026-12-01', status: 'cancelled', image: `${CF}/events/nope/hero/public` };
const school = { slug: 'school', name: 'Example School', year: '2025 - 2026', description: 'A sensory room.', heroImage: `${CF}/community/school/after-01/public`, photos: [{ url: `${CF}/community/school/2.jpg/public` }], story: 'x' };
const hiddenProject = { slug: 'hidden', name: 'Hidden', publishStatus: 'draft', heroImage: `${CF}/community/hidden/a/public` };

const liveRow = {
  id: 'live-1', kid_slug: 'ava', kid_name: 'Ava', live_at: '2026-11-20T21:00:31Z', ended_at: '2026-11-20T21:12:37Z', live_video_uid: UID('b'), replay_uid: UID('b'),
  fb_permalink: 'https://www.facebook.com/example/videos/1',
  data: JSON.stringify({ test: false, reel: { stage: 'done', sourceUid: UID('b'), cut: { start: 444, end: 463, coverSeconds: 454 }, caption: 'Ava rolled in.\n\n#SunshineOnARanneyDay', permalink: 'https://www.instagram.com/reel/EXAMPLE/', publishedAt: '2026-11-21T15:22:40Z', facebook: { permalink: 'https://www.facebook.com/reel/1/' } } }),
};
const rehearsalRow = { id: 'live-0', kid_slug: 'ava', kid_name: 'Ava', live_at: '2026-11-19T21:00:00Z', ended_at: '2026-11-19T21:05:00Z', replay_uid: UID('c'), data: JSON.stringify({ test: true }) };
const reveals = {
  upcoming: [
    { slug: 'ben', name: 'Ben', confirmed: false, window: { label: 'mid December', through: '2026-12-20' }, rooms: ['Dream Bedroom'] },
    { slug: 'dee', name: 'Dee', confirmed: true, date: '2026-12-04', time: '14:00', rooms: ['Accessible Bathroom'] },
  ],
  past: [{ slug: 'ava', name: 'Ava', date: '2026-11-20' }, { slug: 'old', name: 'Old', date: '2026-08-01' }],
};
const broadcasts = [broadcastOf(liveRow), broadcastOf(rehearsalRow)];

// ─── Albums ───────────────────────────────────────────────────────

test('a kid album holds what the kid page shows: drafts, before photos kept off or not looked at, and someone else’s pictures stay out', () => {
  assert.equal(M.kidAlbum(draft), null);
  const a = M.kidAlbum(ava, { broadcasts });
  const ids = a.files.map((f) => f.id);
  assert.ok(ids.includes(`kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg`));
  assert.equal(ids.filter((i) => i.endsWith('FINAL-1.jpg')).length, 1, 'the main photo is also in the gallery: once');
  assert.ok(ids.includes('kids/ava/old-photo.jpg'), 'a bare id counts');
  assert.ok(!ids.some((i) => i.includes('example.com')), 'a picture from another site is never ours to hand out');
  assert.ok(ids.includes('kids/ava/story-1'));
  // Pairs and before photos exactly as the kid page has them
  const pairIds = a.files.filter((f) => f.role.startsWith('pair')).map((f) => f.id);
  assert.deepEqual(pairIds, pagePairs(ava).flatMap((p) => [M.streamUidOf(p.before) || p.before.replace(`${CF}/`, '').replace(/\/public$/, ''), p.after.replace(`${CF}/`, '').replace(/\/public$/, '')]));
  assert.equal(pairIds.length, 2, 'one whole pair: the other’s before is kept off, the third has no after yet');
  assert.ok(!ids.includes('kids/ava/before-held.jpg'), 'kept off the page');
  assert.ok(!ids.includes('kids/ava/before-waiting.jpg'), 'not looked at yet');
  assert.deepEqual(a.files.filter((f) => f.role === 'before').map((f) => f.id), pageBefores(ava).map((p) => p.url.replace(`${CF}/`, '').replace(/\/public$/, '')));
  // Before the reveal, no before photos at all (the page keeps the surprise)
  const b = M.kidAlbum(ben);
  assert.ok(!b.files.some((f) => f.role === 'before'));
  assert.equal(b.files.length, 2);
});

test('pairs read before, after; numbers run within each kind; the newest photo and the album date are known', () => {
  const a = M.kidAlbum(ava, { broadcasts });
  const roles = a.files.map((f) => f.role);
  assert.equal(roles.indexOf('pair-before') + 1, roles.indexOf('pair-after'));
  assert.ok(roles.lastIndexOf('photo') < roles.indexOf('pair-before') && roles.indexOf('before') > roles.indexOf('pair-after'));
  assert.equal(a.files.find((f) => f.role === 'photo' && f.n === 2).id.endsWith('FINAL-2.jpg'), true);
  assert.equal(a.newest, T('2026-11-24T12:00:00Z'));
  assert.equal(a.date, '2026-11-20', 'the day it went live');
  assert.equal(a.caption, 'Ava rolled in.\n\n#SunshineOnARanneyDay');
});

test('a kid’s videos: the makeover video, the live reveal once, its Reel clip; rehearsals and anything not linked stay out', () => {
  const a = M.kidAlbum(ava, { broadcasts });
  assert.deepEqual(a.videos.map((v) => [v.kind, v.uid]), [['room', UID('a')], ['live', UID('b')], ['reel', UID('b')]]);
  assert.deepEqual(a.videos[0].links, [{ label: 'YouTube', url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK' }]);
  assert.deepEqual(a.videos[1].links.map((l) => l.label), ['Facebook live post']);
  const reel = a.videos[2];
  assert.equal(reel.start, 444);
  assert.equal(reel.seconds, 19);
  assert.deepEqual(reel.links.map((l) => l.label), ['Instagram', 'Facebook']);
  assert.ok(!a.videos.some((v) => v.uid === UID('c')), 'a rehearsal’s recording is never offered');
  // A long Reel Stream made a clip of downloads as that clip; one too long for an instant clip, with none, isn't offered
  const long = broadcastOf({ ...liveRow, id: 'live-2', data: JSON.stringify({ reel: { sourceUid: UID('b'), start: 0, end: 300 } }) });
  assert.ok(!M.kidAlbum(ava, { broadcasts: [long] }).videos.some((v) => v.kind === 'reel'));
  const clipped = broadcastOf({ ...liveRow, id: 'live-3', data: JSON.stringify({ reel: { sourceUid: UID('b'), start: 0, end: 300, clipUid: UID('d') } }) });
  const r = M.kidAlbum(ava, { broadcasts: [clipped] }).videos.find((v) => v.kind === 'reel');
  assert.equal(r.uid, UID('d'));
  assert.equal(r.start, null);
  // A YouTube link alone is a link, never a download
  const yt = M.kidAlbum({ ...ben, videoUrl: 'https://youtu.be/AbCdEfGhIjK' });
  assert.deepEqual(yt.videos.map((v) => [v.kind, v.uid || null, v.url]), [['link', null, 'https://youtu.be/AbCdEfGhIjK']]);
  assert.equal(M.kidAlbum({ ...ben, videoUrl: 'javascript:alert(1)' }).videos.length, 0);
});

test('events and community projects: cancelled events and draft projects stay out; albums run newest first', () => {
  const al = M.buildAlbums({ kids: [ava, ben, draft], events: [gala, golf, cancelled], community: [school, hiddenProject], broadcasts, reveals });
  assert.deepEqual(al.kid.map((a) => a.slug), ['ava', 'ben']);
  assert.deepEqual(al.event.map((a) => a.slug), ['golf-2027', 'gala-2026']);
  assert.deepEqual(al.community.map((a) => a.slug), ['school']);
  const g = al.event[1];
  assert.deepEqual(g.files.map((f) => f.id), ['events/gala-2026/hero', 'events/gala-2026/p1', 'events/gala-2026/p2']);
  assert.equal(g.videos[0].uid, UID('e'));
  assert.equal(al.community[0].year, 2026);
  assert.equal(al.community[0].page, '/community/school/');
});

test('file names: plain, numbered, never a path or an accent', () => {
  const a = M.kidAlbum(ava, { broadcasts });
  const name = (role, n = 1) => M.photoFileName(a, a.files.find((f) => f.role === role && f.n === n));
  assert.equal(name('photo'), 'SOARD-Ava-2026-01.jpg');
  assert.equal(name('pair-before'), 'SOARD-Ava-2026-before-and-after-1-before.jpg');
  assert.equal(name('pair-after'), 'SOARD-Ava-2026-before-and-after-1-after.jpg');
  assert.equal(name('before'), 'SOARD-Ava-2026-before-01.jpg');
  assert.equal(M.videoFileName(a, a.videos[2]), 'SOARD-Ava-2026-reel-clip.mp4');
  assert.equal(M.zipFileName(a), 'SOARD-Ava-2026-photos.zip');
  assert.equal(M.albumFilePart({ name: 'Sam & Lee', year: 2026 }), 'Sam-and-Lee-2026');
  assert.equal(M.albumFilePart({ name: 'Zoë / Andrés', year: 2025 }), 'Zoe-Andres-2025');
  assert.equal(M.albumFilePart({ name: '2026 Evening of Sunshine ', year: 2026 }), '2026-Evening-of-Sunshine');
  assert.equal(attachment('SOARD-Zoë.jpg'), 'attachment; filename="SOARD-Zo_.jpg"; filename*=UTF-8\'\'SOARD-Zo%C3%AB.jpg');
});

test('when a photo came in, from its id', () => {
  assert.equal(M.addedAt('kids/ava/1795442629265-FINAL-31.jpg'), 1795442629265);
  assert.equal(M.addedAt('kids/ava/ba-after-1795445017950-cf35-FINAL-4.jpg'), 1795445017950);
  assert.equal(M.addedAt('community/x/1774968285135-IMG-9426.JPG'), 1774968285135);
  assert.equal(M.addedAt('kids/ava/hero'), null);
  assert.equal(M.addedAt('kids/ava/9999999999999-x.jpg'), null);
  assert.equal(M.streamUidOf(`https://customer-x.cloudflarestream.com/${UID('a')}/iframe`), UID('a'));
  assert.equal(M.streamUidOf(UID('f').toUpperCase()), UID('f'));
  assert.equal(M.streamUidOf('https://example.com/abc'), '');
});

// ─── What's happening ─────────────────────────────────────────────

test('What’s happening: reveals and events ahead in date order, then the last 60 days newest first', () => {
  const albums = M.buildAlbums({ kids: [ava, ben], events: [gala, golf, cancelled], community: [school], broadcasts, reveals });
  const { ahead, recent } = M.buildActivity({ albums, reveals, broadcasts, now: NOW });
  assert.deepEqual(ahead.map((x) => [x.kind, x.title, x.when]), [
    ['reveal', 'Dee’s reveal', 'Friday, December 4 at 2:00 PM'],
    ['reveal', 'Ben’s reveal', 'Mid December, not confirmed yet'],
    ['event', 'Example Golf Day', 'Friday, January 15, 2027'],
  ]);
  assert.equal(ahead[0].album, null, 'a kid with no album yet still shows, without a link to one');
  assert.deepEqual(ahead[0].links.map((l) => l.label), ['Kid page', 'Live page']);
  assert.deepEqual(ahead[1].links.map((l) => l.label), ['Kid page'], 'no live page until the day is confirmed');
  assert.deepEqual(recent.map((x) => [x.date, x.kind, x.title]), [
    ['2026-11-24', 'photos', '1 before and after pair of Ava'],
    ['2026-11-23', 'photos', '2 new photos of Ava'],
    ['2026-11-21', 'reel', 'Ava’s Reel is posted'],
    ['2026-11-20', 'live', 'Ava’s reveal went live'],
    ['2026-11-13', 'photos', '1 before photo of Ava'],
    ['2026-11-10', 'event-past', '2026 Example Gala'],
  ]);
  const live = recent.find((x) => x.kind === 'live');
  assert.equal(live.detail, '12 minute recording, ready to download');
  assert.equal(live.video, UID('b'));
  assert.ok(!recent.some((x) => x.key === 'revealed:ava'), 'a reveal that went live is said once');
  assert.ok(!recent.some((x) => x.title.startsWith('Old')), 'older than 60 days');
  assert.equal(recent.find((x) => x.kind === 'reel').caption, 'Ava rolled in.\n\n#SunshineOnARanneyDay');
  assert.equal(recent.find((x) => x.date === '2026-11-23').detail, 'Photos by Example Photography');
});

// ─── The ZIP ──────────────────────────────────────────────────────

async function readAll(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
/** The names in a ZIP's directory, read as UTF-8 (the flag the writer sets; macOS's unzip prints them mangled) */
function zipNames(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = buf.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054B50) end--;
  const names = [];
  for (let n = 0, at = v.getUint32(end + 16, true); n < v.getUint16(end + 10, true); n++) {
    const len = v.getUint16(at + 28, true);
    names.push(new TextDecoder().decode(buf.subarray(at + 46, at + 46 + len)));
    at += 46 + len + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return names;
}
/** unzip -t checks every file against its CRC */
const unzipList = (buf) => {
  const dir = mkdtempSync(join(tmpdir(), 'md-zip-'));
  const f = join(dir, 'x.zip');
  writeFileSync(f, buf);
  return { test: execFileSync('unzip', ['-t', f], { encoding: 'utf8' }), list: zipNames(buf) };
};

test('the ZIP opens and every file checks out; a name used twice is told apart', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const zip = zipStream();
  const out = readAll(zip.readable);
  await zip.add('a.jpg', new Uint8Array([1, 2, 3]));
  await zip.add('a.jpg', new Uint8Array(200_000).fill(7));
  await zip.add('Café notes.txt', 'hello');
  await zip.close();
  const { test: t, list } = unzipList(await out);
  assert.match(t, /No errors detected/);
  assert.deepEqual(list, ['a.jpg', 'a (2).jpg', 'Café notes.txt']);
});

// ─── The server ───────────────────────────────────────────────────

const SCHEMA = [
  'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
  'CREATE TABLE events (slug TEXT PRIMARY KEY, title TEXT, data TEXT)',
  'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
  'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  `CREATE TABLE broadcasts (id TEXT PRIMARY KEY, kid_slug TEXT, kid_name TEXT, title TEXT, message TEXT, image TEXT, scheduled_at TEXT, live_at TEXT, ended_at TEXT, phase TEXT,
    live_video_uid TEXT, replay_uid TEXT, fb_live_video_id TEXT, fb_permalink TEXT, source TEXT, data TEXT, created_at TEXT, updated_at TEXT)`,
];
async function world() {
  const DB = await createD1({ schemaSql: SCHEMA });
  for (const k of [ava, ben, draft]) await DB.prepare('INSERT INTO kids (slug, name, data) VALUES (?, ?, ?)').bind(k.slug, k.name, JSON.stringify(k)).run();
  for (const e of [gala, golf, cancelled]) await DB.prepare('INSERT INTO events (slug, title, data) VALUES (?, ?, ?)').bind(e.slug, e.title, JSON.stringify(e)).run();
  for (const p of [school, hiddenProject]) await DB.prepare('INSERT INTO community (slug, name, data) VALUES (?, ?, ?)').bind(p.slug, p.name, JSON.stringify(p)).run();
  for (const b of [liveRow, rehearsalRow]) {
    await DB.prepare('INSERT INTO broadcasts (id, kid_slug, kid_name, live_at, ended_at, live_video_uid, replay_uid, fb_permalink, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(b.id, b.kid_slug, b.kid_name, b.live_at, b.ended_at, b.live_video_uid || null, b.replay_uid, b.fb_permalink || null, b.data).run();
  }
  // The reveal schedule's last good copy (./_reveals.js), with today's reveals still ahead
  await DB.prepare("INSERT INTO site_config (key, data, updated_at) VALUES ('reveals', ?, ?)").bind(JSON.stringify({
    reveals: [{ slug: 'dee', name: 'Dee', date: '2099-12-04', time: '14:00' }],
    upcoming: [{ slug: 'dee', name: 'Dee', confirmed: true, date: '2099-12-04', time: '14:00', rooms: [] }],
    past: [{ slug: 'ava', name: 'Ava', date: '2026-11-20' }], updatedAt: '2026-11-25T12:00:00Z',
  }), '2026-11-25T12:00:00Z').run();
  return { DB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok' };
}

/** A fake Cloudflare: Images hands back bytes for each id, Stream answers downloads, signing and its list */
function fakeCloudflare({ mp4 = 'ready', signed = false, broken = [] } = {}) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    seen.push({ url, method: init.method || 'GET' });
    const m = url.match(/^https:\/\/imagedelivery\.net\/[^/]+\/(.+)\/([^/]+)$/);
    if (m) {
      if (broken.includes(m[1])) return new Response('nope', { status: 404 });
      return new Response(new TextEncoder().encode(`JPEG:${m[1]}`), { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(5 + m[1].length) } });
    }
    const dl = url.match(/\/stream\/([a-f0-9]{32})\/downloads$/);
    if (dl) {
      const def = mp4 === 'none' && (init.method || 'GET') === 'GET' ? null : { status: mp4 === 'ready' ? 'ready' : 'inprogress', percentComplete: 42.4, url: `https://customer-x.cloudflarestream.com/${dl[1]}/downloads/default.mp4` };
      return Response.json({ success: true, result: def ? { default: def } : {} });
    }
    const tok = url.match(/\/stream\/([a-f0-9]{32})\/token$/);
    if (tok) return Response.json({ success: true, result: { token: 'SIGNED' } });
    const one = url.match(/\/stream\/([a-f0-9]{32})$/);
    if (one) return Response.json({ success: true, result: { uid: one[1], requireSignedURLs: signed, readyToStream: true } });
    if (/\/stream\?limit=1000/.test(url)) return Response.json({ success: true, result: [{ uid: UID('a'), duration: 125.4, size: 52_000_000, readyToStream: true }, { uid: UID('9'), duration: 30 }] });
    if (/cloudflarestream\.com\/.+\.mp4/.test(url)) return new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } });
    return new Response('offline', { status: 503 });
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}
const get = (fn, env, qs) => fn({ env, request: new Request(`https://admin.test/api/x?${qs}`), data: { userEmail: 'staff@soardcharity.com' }, waitUntil: () => {} });

test('GET /api/media-admin: the schedule and the live reveals, rehearsals left out, nothing private', async () => {
  const env = await world();
  const r = await get(adminGet, env, '');
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.reveals.upcoming.map((x) => x.slug), ['dee']);
  assert.deepEqual(j.broadcasts.map((b) => b.id), ['live-1']);
  assert.deepEqual(Object.keys(j.broadcasts[0]).sort(), ['endedAt', 'fbPermalink', 'id', 'kidName', 'kidSlug', 'liveAt', 'reel', 'replayUid', 'test']);
});

test('GET /api/media-admin?videos=: lengths of the videos asked for, and whether the whole library was read', async () => {
  const env = await world();
  const cf = fakeCloudflare();
  try {
    const j = await (await get(adminGet, env, `videos=${UID('a')},nonsense,${UID('7')}`)).json();
    assert.deepEqual(j.videos, { [UID('a')]: { seconds: 125, bytes: 52_000_000, ready: true } });
    assert.equal(j.complete, true, 'a short listing is the whole library: the one not in it was purged');
    assert.equal(cf.seen.length, 1);
  } finally { cf.restore(); }
  // A library bigger than one listing is read page by page, older each time
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    asked.push(u.searchParams.get('end') || '');
    const page = asked.length;
    const list = page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ uid: i === 5 ? UID('a') : `x${i}`, created: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`, duration: 10 }))
      : [{ uid: UID('7'), created: '2020-01-01T00:00:00Z', duration: 20 }];
    return Response.json({ success: true, result: list });
  };
  try {
    const j = await (await get(adminGet, env, `videos=${UID('a')},${UID('7')},${UID('8')}`)).json();
    assert.deepEqual(Object.keys(j.videos).sort(), [UID('7'), UID('a')]);
    assert.equal(j.complete, true);
    assert.equal(asked.length, 2);
    assert.equal(asked[1], '2026-01-01T00:39:00Z', 'the second page starts before the last one read');
  } finally { globalThis.fetch = real; }
  // Stream unreachable: nothing is called purged
  globalThis.fetch = async () => new Response('down', { status: 500 });
  try {
    const j = await (await get(adminGet, env, `videos=${UID('a')}`)).json();
    assert.deepEqual([j.ok, j.complete, j.videos], [true, false, {}]);
  } finally { globalThis.fetch = real; }
});

test('a video Stream no longer has is left out; a makeover video that’s on YouTube becomes that link, as on the kid page', () => {
  const gone = new Set([UID('a'), UID('b')]);
  const a = M.kidAlbum(ava, { broadcasts, gone });
  assert.deepEqual(a.videos.map((v) => [v.kind, v.uid || null, v.url || null]), [['link', null, 'https://www.youtube.com/watch?v=AbCdEfGhIjK']]);
  const albums = M.buildAlbums({ kids: [ava], broadcasts, reveals, gone });
  const live = M.buildActivity({ albums, reveals, broadcasts, now: NOW, gone }).recent.find((x) => x.kind === 'live');
  assert.equal(live.detail, '12 minute recording, no longer in Stream');
  assert.equal(live.video, null);
  // Not knowing isn't the same as gone
  assert.equal(M.kidAlbum(ava, { broadcasts, gone: null }).videos.length, 3);
});

test('GET /api/media-admin?mp4=: Stream is asked to make the MP4 once, and the page hears how far along it is', async () => {
  const env = await world();
  let cf = fakeCloudflare({ mp4: 'none' });
  try {
    const j = await (await get(adminGet, env, `album=kid:ava&mp4=live:${UID('b')}`)).json();
    assert.deepEqual(j, { ok: true, ready: false, percent: 42 });
    assert.ok(cf.seen.some((s) => s.method === 'POST' && s.url.endsWith(`/stream/${UID('b')}/downloads`)));
  } finally { cf.restore(); }
  cf = fakeCloudflare({ mp4: 'ready' });
  try {
    assert.deepEqual(await (await get(adminGet, env, `album=kid:ava&mp4=room:${UID('a')}`)).json(), { ok: true, ready: true, percent: 100 });
    // A video that isn't in the album (a family's application video, a rehearsal) is refused before Stream is asked
    for (const qs of [`album=kid:ava&mp4=live:${UID('c')}`, `album=kid:cal&mp4=room:${UID('a')}`, 'album=../x&mp4=a']) {
      const r = await get(adminGet, env, qs);
      assert.equal(r.status, 404, qs);
    }
    assert.ok(!cf.seen.some((s) => s.url.includes(UID('c'))));
  } finally { cf.restore(); }
});

test('GET /api/media-download?image=: one photo full size, named for the album; only a photo the album shows', async () => {
  const env = await world();
  const cf = fakeCloudflare();
  try {
    const id = `kids/ava/${T('2026-11-23T15:01:00Z')}-FINAL-2.jpg`;
    const r = await get(dlGet, env, `album=kid:ava&image=${encodeURIComponent(id)}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Content-Type'), 'image/jpeg');
    assert.match(r.headers.get('Content-Disposition'), /filename="SOARD-Ava-2026-02\.jpg"/);
    assert.equal(await r.text(), `JPEG:${id}`);
    const asked = cf.seen.at(-1).url;
    assert.match(asked, /\/w=9999,fit=scale-down,quality=95,format=jpeg,metadata=none$/, 'full size, a JPEG, no location data');
    for (const [qs, status] of [
      ['album=kid:ava&image=kids/ava/before-held.jpg', 404],
      ['album=kid:ava&image=kids/ava/before-waiting.jpg', 404],
      ['album=kid:ava&image=advisory-applications/x/y', 404],
      ['album=kid:cal&image=kids/cal/hero', 404],
      ['album=kid:ben&image=kids/ben/before-1.jpg', 404],
      ['album=event:nope&image=events/nope/hero', 404],
      ['album=community:hidden&image=community/hidden/a', 404],
      ['album=kid:ava', 400],
    ]) assert.equal((await get(dlGet, env, qs)).status, status, qs);
    assert.equal(cf.seen.length, 1, 'nothing refused was ever fetched');
  } finally { cf.restore(); }
});

test('a ZIP of the whole album or of the ones picked: every photo, its note, nothing outside the album; a photo that fails is left out', async () => {
  const env = await world();
  const cf = fakeCloudflare({ broken: ['kids/ava/story-1'] });
  try {
    const r = await get(dlGet, env, 'album=kid:ava&zip=all');
    assert.equal(r.headers.get('Content-Type'), 'application/zip');
    assert.match(r.headers.get('Content-Disposition'), /SOARD-Ava-2026-photos\.zip/);
    const { test: t, list } = unzipList(await readAll(r.body));
    assert.match(t, /No errors detected/);
    const album = M.kidAlbum(ava, { broadcasts: [broadcastOf(liveRow)] });
    const expected = album.files.filter((f) => f.id !== 'kids/ava/story-1').map((f) => M.photoFileName(album, f));
    assert.deepEqual(list, [...expected, 'About these photos.txt']);

    const form = new FormData();
    form.set('album', 'kid:ava');
    form.set('ids', [`kids/ava/${T('2026-11-23T15:01:00Z')}-FINAL-2.jpg`, 'kids/ava/before-held.jpg', 'applications/form/x'].join('\n'));
    const p = await dlPost({ env, request: new Request('https://admin.test/api/media-download', { method: 'POST', body: form }), waitUntil: () => {} });
    assert.match(p.headers.get('Content-Disposition'), /SOARD-Ava-2026-selected-photos\.zip/);
    const picked = unzipList(await readAll(p.body));
    assert.deepEqual(picked.list, ['SOARD-Ava-2026-02.jpg', 'About these photos.txt']);
    assert.ok(!cf.seen.some((s) => s.url.includes('before-held') || s.url.includes('applications/')));

    const none = new FormData();
    none.set('album', 'kid:ava');
    none.set('ids', '');
    assert.equal((await dlPost({ env, request: new Request('https://admin.test/api/media-download', { method: 'POST', body: none }) })).status, 400);
  } finally { cf.restore(); }
});

test('the ZIP’s note credits the photographer, says where the photos are and carries the Reel’s caption', async () => {
  const { noteText } = await import('../functions/api/media-download.js');
  const album = M.kidAlbum(ava, { broadcasts: [broadcastOf(liveRow)] });
  const t = noteText(album, album.files.slice(0, 3));
  assert.match(t, /Photos by Example Photography\. Please credit them when you post\./);
  assert.match(t, /https:\/\/sunshineonaranneyday\.com\/kids\/ava\//);
  assert.match(t, /3 photos, full size\./);
  assert.match(t, /#SunshineOnARanneyDay/);
});

test('GET /api/media-download?video=: a Reel is cut as it downloads; any other video once its MP4 is made, signed when it must be', async () => {
  const env = await world();
  let cf = fakeCloudflare({ mp4: 'ready', signed: true });
  try {
    const reel = await get(dlGet, env, 'album=kid:ava&video=reel:live-1');
    assert.equal(reel.status, 200);
    assert.match(reel.headers.get('Content-Disposition'), /SOARD-Ava-2026-reel-clip\.mp4/);
    assert.match(cf.seen.at(-1).url, new RegExp(`/${UID('b')}/clip\\.mp4\\?time=444s&duration=19s`));

    const room = await get(dlGet, env, `album=kid:ava&video=room:${UID('a')}`);
    assert.equal(room.status, 200);
    assert.equal(room.headers.get('Content-Type'), 'video/mp4');
    assert.match(room.headers.get('Content-Disposition'), /SOARD-Ava-2026-makeover-video\.mp4/);
    assert.equal(cf.seen.at(-1).url, 'https://customer-x.cloudflarestream.com/SIGNED/downloads/default.mp4', 'a signed address when the video needs one');
  } finally { cf.restore(); }
  cf = fakeCloudflare({ mp4: 'inprogress' });
  try {
    const r = await get(dlGet, env, `album=kid:ava&video=live:${UID('b')}`);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).preparing, true);
    assert.equal((await get(dlGet, env, `album=kid:ava&video=live:${UID('c')}`)).status, 404, 'a rehearsal');
  } finally { cf.restore(); }
});

test('the server builds albums with the page’s own code: the same files, in the same order', async () => {
  const env = await world();
  const { loadAlbum } = await import('../functions/api/_media.js');
  const server = await loadAlbum(env, 'kid:ava');
  const page = M.buildAlbums({ kids: [ava], broadcasts: [broadcastOf(liveRow)], reveals }).kid[0];
  assert.deepEqual(server.files, page.files);
  assert.deepEqual(server.videos, page.videos);
  assert.equal(await loadAlbum(env, 'kid:cal'), null);
  assert.equal(await loadAlbum(env, "kid:ava' OR 1=1 --"), null);
});
