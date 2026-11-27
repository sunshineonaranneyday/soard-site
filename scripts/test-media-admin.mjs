/**
 * test-media-admin.mjs — drive Admin → Photos & Videos in a real browser
 * ===========================================================================
 * Builds the index the real way (functions/api/_media-index.js) from a made-up
 * world in every source: the website's images, Stream, the Drive archive,
 * JobTread and YouTube, then describes the photos with a stand-in model
 * (_media-describe.js). Serves public/ and answers /api/media-admin,
 * /api/media-download and /api/media-thumb with the REAL handlers, as staff in
 * the admin and as the social media person on /admin/media/. Then:
 *   - staff: the home (What's happening, albums, the index's state), the search
 *     (suggestions as you type, results with counts, a filter, a typo fixed,
 *     what's in the picture), an album with its website, archive and JobTread
 *     photos, photos picked from two albums as one ZIP (checked), a photo big,
 *     who can sign in (someone added)
 *   - the social media person: their own page, nothing staff only (a draft, a
 *     Before photo the check hasn't passed, a job no page matches), the admin
 *     sending them to their page
 *   - a phone; axe on each
 * Screenshots in test-results/media/. Exits non-zero on failure.
 *   node scripts/test-media-admin.mjs
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, extname } from 'node:path';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import * as mediaAdmin from '../functions/api/media-admin.js';
import * as mediaDownload from '../functions/api/media-download.js';
import * as mediaThumb from '../functions/api/media-thumb.js';
import * as IX from '../functions/api/_media-index.js';
import { describeSome } from '../functions/api/_media-describe.js';
import { QUESTIONS } from '../functions/api/_photo-screen.js';
import { buildVocab } from '../functions/api/_media-search.js';
import { mediaPersonFor, forgetPeople } from '../functions/api/_media-people.js';
import { HOLDING, PHOTOS_DRIVE } from '../functions/api/_past-photos.js';
import { answerAsks } from './lib/ask.mjs';
import { createR2 } from '../tests/lib/r2-shim.mjs';
import { tiff, jpeg } from '../tests/lib/exif-fixtures.mjs';
import * as INBOX from '../functions/api/_media-inbox.js';
import { cfIdOf } from '../public/admin/site-config-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/media/');
const DOWNLOADS = join(OUT, 'downloads');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(DOWNLOADS, { recursive: true });
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures.push(`${name}: crashed: ${e.message}`); console.error(`  ✗ crashed: ${e.stack || e.message}`); }
}

// ─── The world ────────────────────────────────────────────────────
const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
const DAY = 864e5;
const NOW = Date.now();
const UID = (c) => c.repeat(32).slice(0, 32);
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const Y = new Date(NOW).getUTCFullYear();
const ALTS = ['A girl laughing in a pink wheelchair in her new bathroom', 'A roll-in shower with white tile and a bench', 'Mom hugging her daughter in the new room', 'A unicorn mural over a white bed', 'The crew and family cutting a yellow ribbon', 'A sensory swing hanging in a therapy room'];
const pics = (slug, n, at, folder = 'kids') => Array.from({ length: n }, (_, i) => ({ url: `${CF}/${folder}/${slug}/${at + i * 1000}-FINAL-${i + 1}.jpg/public`, alt: ALTS[i % ALTS.length] }));
const ava = { name: 'Ava', slug: 'ava', year: Y, status: 'completed', publishStatus: 'published', roomTypes: ['Accessible Bathroom'], photographer: 'Example Photography',
  heroImage: `${CF}/kids/ava/${NOW - 2 * DAY}-FINAL-1.jpg/public`, photos: pics('ava', 12, NOW - 2 * DAY), streamVideoId: UID('a'), videoUrl: 'https://www.youtube.com/watch?v=AvaRevealYT' };
const ben = { name: 'Ben', slug: 'ben', year: Y, status: 'in-progress', publishStatus: 'published', roomTypes: ['Dream Bedroom'], photographer: 'Sample Studio', heroImage: `${CF}/kids/ben/hero/public`, photos: pics('ben', 6, NOW - 30 * DAY) };
const cal = { name: 'Cal', slug: 'cal', year: Y, status: 'in-progress', publishStatus: 'draft', heroImage: `${CF}/kids/cal/hero/public`, photos: pics('cal', 3, NOW - 3 * DAY) };
const older = Array.from({ length: 10 }, (_, i) => ({ name: `Example ${String.fromCharCode(65 + i)}`, slug: `example-${i}`, year: Y - 1 - (i % 4), status: 'completed', publishStatus: 'published', roomTypes: [i % 2 ? 'Dream Bedroom' : 'Therapy Room'], heroImage: `${CF}/kids/example-${i}/hero/public`, photos: pics(`example-${i}`, 6 + i, NOW - (400 + i * 30) * DAY) }));
let KIDS = [ava, ben, cal, ...older];
let EVENTS = [
  { slug: 'gala', title: `${Y} Example Gala`, date: ymd(NOW - 20 * DAY), status: 'past', location: 'Example Hall', time: '6 to 10 p.m.', category: 'fundraiser', image: `${CF}/events/gala/hero/public`, photos: Array.from({ length: 8 }, (_, i) => ({ id: `gallery/gala/${NOW - 15 * DAY + i}-g${i}.jpg`, alt: 'Guests dancing at the gala' })) },
  { slug: 'golf', title: 'Example Golf Day', date: ymd(NOW + 40 * DAY), status: 'upcoming', location: 'Example Club', time: '8 a.m.', category: 'fundraiser', image: `${CF}/events/golf/hero/public`, photos: [], ticketUrl: 'https://www.zeffy.com/example' },
];
let COMMUNITY = [{ slug: 'school', name: 'Example School', year: `${Y - 1}`, description: 'A sensory room for the whole school.', heroImage: `${CF}/community/school/hero/public`, photos: pics('school', 6, NOW - 200 * DAY, 'community'), story: 'x' }];
const liveAt = new Date(NOW - 5 * DAY); liveAt.setUTCHours(21, 0, 31, 0);
let REVEALS = { reveals: [], updatedAt: new Date(NOW - 3600e3).toISOString(),
  upcoming: [{ slug: 'ben', name: 'Ben', confirmed: true, date: ymd(NOW + 9 * DAY), time: '14:00', rooms: ['Dream Bedroom'] }], past: [{ slug: 'ava', name: 'Ava', date: ymd(+liveAt) }] };

// What the sources hold
let IMAGES = [...KIDS.flatMap((k) => [k.heroImage, ...k.photos.map((p) => p.url)]), ...EVENTS.flatMap((e) => [e.image, ...e.photos.map((p) => `${CF}/${p.id}/public`)]), ...COMMUNITY.flatMap((p) => [p.heroImage, ...p.photos.map((x) => x.url)]),
  `${CF}/kids/ava/old-gallery-pick.jpg/public`, `${CF}/kids/ava/before-1794554440614-0acf03ea24364ec98a4e5c9cad95e18a-companycam-1.jpg/public`, `${CF}/team/jane-doe/1/public`, `${CF}/team/pat-lee/1/public`, `${CF}/partners/acme/logo/public`, `${CF}/applications/form/f1/public`]
  .map((u) => u.replace(`${CF}/`, '').replace(/\/public$/, '')).filter((v, i, a) => a.indexOf(v) === i).map((id) => ({ id, uploaded: new Date(NOW - 10 * DAY).toISOString() }));
let STREAM = [
  { uid: UID('a'), meta: { name: 'Ava makeover' }, duration: 185, size: 2e8, created: new Date(NOW - 4 * DAY).toISOString(), readyToStream: true },
  { uid: UID('b'), meta: { name: 'Ava live reveal' }, duration: 720, size: 9e8, created: liveAt.toISOString(), readyToStream: true },
  { uid: UID('d'), meta: { name: 'Gala highlight reel' }, duration: 62, created: new Date(NOW - 18 * DAY).toISOString() },
  { uid: UID('e'), meta: { name: 'Family application', application: 'app_1' }, requireSignedURLs: true, created: new Date(NOW - 50 * DAY).toISOString() },
];
const FOLDERS = { fHold: { name: HOLDING, parent: PHOTOS_DRIVE }, fAva: { name: 'Ava Sample', parent: 'fHold' }, fAvaB: { name: 'Before', parent: 'fAva' }, fAvaD: { name: 'Demo Day', parent: 'fAva' }, fAvaR: { name: 'Reveal', parent: 'fAva' },
  fEx: { name: 'Example A Smith', parent: 'fHold' }, fExR: { name: 'Professional photos', parent: 'fEx' }, fGala: { name: 'Gala 2025', parent: PHOTOS_DRIVE } };
const df = (id, parent, i, { stageTime = null, video = false } = {}) => ({ id: `${id}${String(i).padStart(4, '0')}`, name: video ? `clip-${i}.MOV` : `IMG_${4000 + i}.${i % 3 ? 'JPG' : 'HEIC'}`, mimeType: video ? 'video/quicktime' : i % 3 ? 'image/jpeg' : 'application/octet-stream',
  parents: [parent], size: String(video ? 8e7 : 3e6 + i * 1e5), createdTime: new Date(NOW - 300 * DAY).toISOString(), ...(stageTime ? { imageMediaMetadata: { time: stageTime } } : {}), ...(video ? { videoMediaMetadata: { durationMillis: 45000 } } : {}) });
let DRIVE = [
  ...Array.from({ length: 10 }, (_, i) => df('dAvaBefore', 'fAvaB', i)), ...Array.from({ length: 14 }, (_, i) => df('dAvaDemo00', 'fAvaD', i)), ...Array.from({ length: 30 }, (_, i) => df('dAvaReveal', 'fAvaR', i)), df('dAvaVideo0', 'fAvaR', 1, { video: true }),
  ...Array.from({ length: 24 }, (_, i) => df('dExReveal0', 'fExR', i)), ...Array.from({ length: 12 }, (_, i) => df('dGala00000', 'fGala', i)),
];
let JOBS = [{ id: 'JBEN01', name: `Ben Example (${Y})`, closedOn: null }, { id: 'JCAL01', name: `Cal Sample (${Y})`, closedOn: null }, { id: 'JODD01', name: `Unmatched Family (${Y})`, closedOn: null }];
const jf = (id, stage, i, daysAgo) => ({ id: `${id}${String(i).padStart(3, '0')}`, name: `CompanyCam ${2101160340 + i}`, type: 'image/jpeg', size: 400000, createdAt: new Date(NOW - daysAgo * DAY).toISOString(), url: `https://cdn.jobtread.com/${id}${i}`, fileTags: { nodes: stage ? [{ name: stage }] : [] } });
let JOB_FILES = {
  JBEN01: [...Array.from({ length: 8 }, (_, i) => jf('jtBenBefore', 'Before', i, 40)), ...Array.from({ length: 16 }, (_, i) => jf('jtBenProgres', 'During', i, 2))],
  JCAL01: Array.from({ length: 4 }, (_, i) => jf('jtCalDuring', 'During', i, 3)),
  JODD01: Array.from({ length: 3 }, (_, i) => jf('jtOddAfter0', 'After', i, 10)),
};
let YT = [
  { id: 'AvaRevealYT', snippet: { title: 'Ava’s Accessible Bathroom Reveal', publishedAt: new Date(NOW - 3 * DAY).toISOString() }, contentDetails: { duration: 'PT3M10S' }, status: { privacyStatus: 'public' } },
  { id: 'OldReveal01', snippet: { title: `Example A’s Therapy Room Reveal ${Y - 1}`, publishedAt: new Date(NOW - 400 * DAY).toISOString() }, contentDetails: { duration: 'PT4M2S' }, status: { privacyStatus: 'public' } },
];

// ─── Or a local copy of the real records (MEDIA_WALK_REAL=<json>, never committed) ─────
// { kids, events, community, broadcasts, reveals, pastJobs, pastPhotos, jt: { jobs, files }, streamAlive }: the
// website's real photos, the real JobTread files through the real lister (their real pictures from JobTread's CDN),
// the archive's rows from past_photos (Drive's pictures need Google's sign-in: stand-ins here)
const REAL = process.env.MEDIA_WALK_REAL || '';
const RW = REAL ? JSON.parse(readFileSync(REAL, 'utf8')) : null;
if (RW) {
  KIDS = RW.kids; EVENTS = RW.events; COMMUNITY = RW.community; REVEALS = RW.reveals;
  IMAGES = [...new Set([...KIDS.flatMap((k) => [k.heroImage, k.accentImage, ...(k.photos || []).map((p) => p.url), ...(k.storyPhotos || []).map((p) => p.url), ...(k.beforeAfterPhotos || []).flatMap((p) => [p.before, p.after]), ...(k.beforePhotos || []).map((p) => p.url)]),
    ...EVENTS.flatMap((e) => [e.image, ...(e.photos || []).map((p) => p.id)]), ...COMMUNITY.flatMap((p) => [p.heroImage, ...(p.photos || []).map((x) => x.url)])].map((u) => cfIdOf(u)).filter((id) => id && !/^https?:/.test(id)))].map((id) => ({ id, uploaded: null }));
  STREAM = (RW.streamAlive || []).map((uid) => { const k = KIDS.find((x) => String(x.streamVideoId || '').toLowerCase() === uid || String(x.revealVideoUrl || '').includes(uid)); return { uid, meta: { name: k ? `${k.name} ${String(k.revealVideoUrl || '').includes(uid) ? 'live reveal' : 'makeover video'}` : 'Video' }, duration: 200, created: new Date(NOW - 30 * DAY).toISOString(), readyToStream: true }; });
  YT = KIDS.map((k) => [k, (String(k.videoUrl || '').match(/(?:youtu\.be\/|[?&]v=)([\w-]{11})/) || [])[1]]).filter(([k, id]) => id && k.publishStatus !== 'draft').map(([k, id]) => ({ id, snippet: { title: `${k.name}’s makeover video`, publishedAt: `${k.year || 2020}-06-01T00:00:00Z` }, contentDetails: { duration: 'PT3M' }, status: { privacyStatus: 'public' } }));
  DRIVE = []; JOBS = RW.jt.jobs; JOB_FILES = RW.jt.files;
}

// ─── Pictures for any id, and fakes for every service ──────────────
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
const picCache = new Map();
async function picture(id, w = 640, jpeg = false) {
  const key = `${id}|${w}|${jpeg}`;
  if (picCache.has(key)) return picCache.get(key);
  const W2 = Math.min(1600, Math.max(64, w));
  const H2 = Math.round(hue(id) % 3 === 0 ? W2 * 1.3 : W2 * 0.72);
  const h1 = hue(id);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},55%,72%)"/><stop offset="1" stop-color="hsl(${(h1 + 50) % 360},50%,46%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${W2 * 0.7}" cy="${H2 * 0.32}" r="${W2 * 0.12}" fill="rgba(255,255,255,0.35)"/><path d="M0 ${H2 * 0.78} L${W2 * 0.35} ${H2 * 0.5} L${W2 * 0.6} ${H2 * 0.7} L${W2} ${H2 * 0.45} L${W2} ${H2} L0 ${H2}Z" fill="rgba(0,0,0,0.18)"/></svg>`;
  const buf = await sharp(Buffer.from(svg))[jpeg ? 'jpeg' : 'png']({ quality: 78 }).toBuffer();
  picCache.set(key, buf);
  return buf;
}
const { privateKey: SA_PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', client_id: '1', private_key: SA_PEM, token_uri: 'https://oauth2.googleapis.com/token', project_id: 'p' });
const mp4Asks = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
  if (url.endsWith('/stream/copy')) return Response.json({ success: true, result: { uid: UID('9') } });
  if (url.startsWith('https://api.twilio.com/') && /\/Media\/ME[a-f0-9]{32}$/.test(url)) return new Response(new Uint8Array(jpeg(tiff({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' }))), { headers: { 'Content-Type': 'image/jpeg' } });
  if (url.startsWith('https://api.twilio.com/') && (init.method === 'DELETE')) return new Response(null, { status: 204 });
  if (url.startsWith('https://cvws.icloud-content.com/')) return new Response(new Uint8Array(500000).fill(3), { headers: { 'Content-Type': 'video/quicktime', 'Content-Length': '500000' } });
  if (url.includes('/images/v2')) return Response.json({ success: true, result: { images: IMAGES, continuation_token: null } });
  const dl = url.match(/\/stream\/([a-f0-9]{32})\/downloads$/);
  if (dl) { const n = (mp4Asks.get(dl[1]) ?? 2); mp4Asks.set(dl[1], n - 1); return Response.json({ success: true, result: { default: { status: n <= 0 ? 'ready' : 'inprogress', percentComplete: n <= 0 ? 100 : 40, url: `https://customer-x.cloudflarestream.com/${dl[1]}/downloads/default.mp4` } } }); }
  if (/\/stream\/[a-f0-9]{32}$/.test(url)) return Response.json({ success: true, result: { requireSignedURLs: false } });
  if (/\/accounts\/acct\/stream\?/.test(url)) return Response.json({ success: true, result: STREAM });
  if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) return Response.json({ items: [{ id: 'UCabcdefghijklmnopqrstuv' }] });
  if (url.startsWith('https://www.googleapis.com/youtube/v3/playlistItems')) return Response.json({ items: YT.map((v) => ({ contentDetails: { videoId: v.id } })) });
  if (url.startsWith('https://www.googleapis.com/youtube/v3/videos')) return Response.json({ items: YT });
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
    const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
    if (/mimeType = 'application\/vnd.google-apps.folder'/.test(q)) return Response.json({ files: Object.entries(FOLDERS).map(([id, f]) => ({ id, name: f.name, parents: [f.parent] })) });
    return Response.json({ files: DRIVE });
  }
  const one = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?(.*)$/);
  if (one) {
    if (/alt=media/.test(one[2])) return new Response(await picture(one[1], 1600, true), { headers: { 'Content-Type': 'image/jpeg' } });
    return Response.json({ driveId: PHOTOS_DRIVE, trashed: false, thumbnailLink: `https://lh3.googleusercontent.com/thumb/${one[1]}=s220` });
  }
  const lh = url.match(/^https:\/\/lh3\.googleusercontent\.com\/thumb\/([^=]+)=s(\d+)/);
  if (lh) return new Response(await picture(lh[1], Number(lh[2]), true), { headers: { 'Content-Type': 'image/jpeg' } });
  if (url === 'https://api.jobtread.com/pave') {
    const q = JSON.parse(init.body).query;
    if (q.organization) return Response.json({ organization: { jobs: { nodes: JOBS, nextPage: null } } });
    if (q.job) return Response.json({ job: { f: { nodes: JOB_FILES[q.job.$.id] || [], nextPage: null } } });
  }
  if (RW && /^https:\/\/(cdn\.jobtread\.com|imagedelivery\.net)\//.test(url)) return realFetch(input, init);
  const jt = url.match(/^https:\/\/cdn\.jobtread\.com\/([^?]+)/);
  if (jt) return new Response(await picture(jt[1], 1200, true), { headers: { 'Content-Type': 'image/jpeg' } });
  const img = url.match(/^https:\/\/imagedelivery\.net\/[^/]+\/(.+)\/([^/]+)$/);
  if (img) return new Response(await picture(img[1], 1600, true), { headers: { 'Content-Type': 'image/jpeg' } });
  if (/cloudflarestream\.com\/.+\.mp4/.test(url)) return new Response(new Uint8Array(4096).fill(1), { headers: { 'Content-Type': 'video/mp4' } });
  return realFetch(input, init);
};

// ─── The database, indexed ────────────────────────────────────────
const DB = await createD1({ schemaSql: [
  'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, data TEXT)', 'CREATE TABLE events (slug TEXT PRIMARY KEY, title TEXT, data TEXT)', 'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
  'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  `CREATE TABLE broadcasts (id TEXT PRIMARY KEY, kid_slug TEXT, kid_name TEXT, title TEXT, message TEXT, image TEXT, scheduled_at TEXT, live_at TEXT, ended_at TEXT, phase TEXT, live_video_uid TEXT, replay_uid TEXT, fb_live_video_id TEXT, fb_permalink TEXT, source TEXT, data TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE past_jobs (key TEXT PRIMARY KEY, kind TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, year INTEGER NOT NULL, folder TEXT, close_on TEXT, close_how TEXT, job_id TEXT, made_by TEXT, state TEXT NOT NULL DEFAULT 'listed', updated_at TEXT NOT NULL DEFAULT '')`,
  'CREATE TABLE photo_stages (file_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, name TEXT, kind TEXT, taken TEXT, camera INTEGER, stage TEXT, why TEXT, reads INTEGER NOT NULL DEFAULT 0, decided_at TEXT, written_at TEXT)',
  'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)', 'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
] });
for (const k of KIDS) await DB.prepare('INSERT INTO kids VALUES (?, ?, ?)').bind(k.slug, k.name, JSON.stringify(k)).run();
for (const e of EVENTS) await DB.prepare('INSERT INTO events VALUES (?, ?, ?)').bind(e.slug, e.title, JSON.stringify(e)).run();
for (const p of COMMUNITY) await DB.prepare('INSERT INTO community VALUES (?, ?, ?)').bind(p.slug, p.name, JSON.stringify(p)).run();
if (RW) {
  for (const b of RW.broadcasts) await DB.prepare('INSERT INTO broadcasts (id, kid_slug, kid_name, live_at, ended_at, replay_uid, fb_permalink, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(b.id, b.kid_slug, b.kid_name, b.live_at, b.ended_at, b.replay_uid, b.fb_permalink, b.data).run();
  for (const j of RW.pastJobs) await DB.prepare("INSERT INTO past_jobs (key, kind, slug, name, year, folder, close_on, close_how, job_id, made_by, state) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'site', 'made')").bind(j.key, j.kind, j.slug, j.slug, j.folder, j.close_on, j.close_how, j.job_id).run();
} else await DB.prepare('INSERT INTO broadcasts (id, kid_slug, kid_name, live_at, ended_at, replay_uid, fb_permalink, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('live-1', 'ava', 'Ava', liveAt.toISOString(), new Date(+liveAt + 12 * 60e3).toISOString(), UID('b'), 'https://www.facebook.com/example/videos/1',
  JSON.stringify({ reel: { sourceUid: UID('b'), cut: { start: 444, end: 463 }, caption: 'Ava rolled into her new bathroom for the first time on Friday, and that smile says it all.\n\n#SunshineOnARanneyDay', permalink: 'https://www.instagram.com/reel/EXAMPLE/', publishedAt: new Date(NOW - 4 * DAY).toISOString() } })).run();
if (!RW) for (const [key, folder, close] of [['ava', 'Ava Sample', ymd(+liveAt)], ['example-0', 'Example A Smith', `${Y - 1}-05-01`]]) await DB.prepare("INSERT INTO past_jobs (key, kind, slug, name, year, folder, close_on, close_how, job_id, made_by, state) VALUES (?, 'kid', ?, ?, ?, ?, ?, 'reveal date', ?, 'site', 'made')").bind(key, key, key, Y, folder, close, `JPAST${key}`).run();
await DB.prepare("INSERT INTO site_config VALUES ('broadcast-config', ?, '')").bind(JSON.stringify({ youtube: { channelUrl: 'https://www.youtube.com/@examplechannel/live' } })).run();
await DB.prepare("INSERT INTO site_config VALUES ('reveals', ?, '')").bind(JSON.stringify(REVEALS)).run();
// Cloudflare's Images binding, standing in: a real JPEG of the size asked (the walk's originals are made-up bytes)
let made = 0;
const IMAGES_BINDING = { input(stream) { let opts = {}; return { transform(o) { opts = o; return this; }, async output() { await new Response(stream).arrayBuffer(); const pic = await picture(`sent-${++made}`, Math.min(1600, opts.width || 600), true); return { response: () => new Response(pic, { headers: { 'Content-Type': 'image/jpeg' } }) }; } }; } };
const env = { DB, CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 'img', CF_STREAM_TOKEN: 'st', YOUTUBE_API_KEY: 'yt', GOOGLE_CALENDAR_KEY: SERVICE_ACCOUNT, JOBTREAD_GRANT_KEY: 'jt',
  MEDIA_FILES: createR2(), IMAGES: IMAGES_BINDING, MEDIA_INBOX_SECRET: 'walk-secret', TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'tw' };
globalThis.FixedLengthStream ||= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };
{
  const ctx = await IX.loadContext(DB);
  await IX.ensureMediaIndex(DB);
  const state = {};
  if (RW) {
    const pj = new Map(RW.pastJobs.map((j) => [j.key, j]));
    const items = RW.pastPhotos.map((r) => IX.driveItem({ id: r.drive_id, name: r.name, mimeType: 'image/jpeg', size: r.size, createdTime: r.taken_at, imageMediaMetadata: r.taken_at ? { time: r.taken_at.slice(0, 16).replace(/-/g, ':').replace('T', ' ') } : null },
      `${HOLDING}/${pj.get(r.key)?.folder || 'x'}${r.path ? `/${r.path}` : ''}`, ctx)).filter(Boolean).map((i) => IX.finish(i, ctx));
    for (let i = 0; i < items.length; i += 2000) await IX.writeItems(DB, items.slice(i, i + 2000), { pass: 'real' });
    state.drive = { doneAt: new Date().toISOString(), note: `${items.length} archive rows from past_photos` };
  }
  for (const s of ['site', 'stream', 'youtube', 'drive', 'jobtread']) {
    if (RW && s === 'drive') continue;
    let st = {};
    for (let i = 0; i < 20; i++) {
      const r = await IX.indexStep(env, s, st, ctx, { deadline: Date.now() + 60000 });
      if (r.done) { state[s] = { doneAt: new Date().toISOString(), note: r.note }; break; }
      st = { cursor: r.cursor, pass: r.pass, count: r.count };
    }
  }
  await IX.setState(DB, 'sources', state);
  // A stand-in model: a description by the photo's place, and the address check passing every other Before photo
  const WORDS = { dAvaDemo: 'A crew member tearing out old bathroom tile', dAvaReveal: 'A girl smiling in her new bathroom with a roll-in shower', dExReveal: 'A boy on a sensory swing in a bright therapy room', dGala: 'Guests dancing under string lights at the gala', jtBenProgres: 'Framing and drywall going up in a bedroom', jtBenBefore: 'An empty bedroom with old carpet', dAvaBefore: 'A small bathroom with a tub before the makeover' };
  let n = 0;
  env.AI = { run: async (model, input) => {
    const text = JSON.stringify(input.messages[1].content[0]);
    if (text.includes('Describe this photo.')) { const id = currentId; const k = Object.keys(WORDS).find((w) => id.includes(w)); return { response: { description: WORDS[k] || 'A photo of a room', tags: ['room'] } }; }
    n++;
    return { response: Object.fromEntries(QUESTIONS.map((q) => [q.key, q.key === 'outside' && n % 2 === 0])) };
  } };
  // (which photo the stand-in is looking at: the describer asks for one picture at a time per photo)
  let currentId = '';
  const realDescribe = env.AI.run;
  const describing = async () => {
    const rows = (await DB.prepare("SELECT id FROM media_items WHERE kind = 'photo' AND (described_at IS NULL OR (gate = 'check' AND check_state IS NULL))").all()).results;
    const { describeOne } = await import('../functions/api/_media-describe.js');
    for (const r of rows) { currentId = r.id; const row = await DB.prepare('SELECT * FROM media_items WHERE id = ?').bind(r.id).first(); await describeOne(env, row).catch(() => {}); }
  };
  if (!RW) await describing();
  env.AI.run = realDescribe;
  await buildVocab(DB, { deadline: Date.now() + 10000 });
  const facts = await IX.indexFacts(DB);
  console.log(`Index: ${JSON.stringify(facts.counts)}; ${facts.undescribed} undescribed, ${facts.unchecked} unchecked, ${facts.held} held`);
}

// ─── Photos sent in: an email and a text from staff, and one from someone not on the list ───
if (!RW) {
  const filing = { kids: KIDS.map((k) => ({ slug: k.slug, name: k.name, year: k.year })), events: EVENTS.map((e) => ({ slug: e.slug, title: e.title, date: e.date })), projects: [], homes: [], reveals: [] };
  const pic = () => new Uint8Array(jpeg(tiff({ lat: 1, lng: 1, taken: '2026:11:24 10:00:00' })));
  await INBOX.receive(env, { channel: 'email', dedupe: 'email:<walk-1@soardcharity.com>', from: 'jane@soardcharity.com', fromName: 'Jane Doe', auth: { dmarc: true, dkim: ['soardcharity.com'] },
    subject: 'Ben progress', text: 'Drywall is up!', files: [1, 2, 3].map((i) => ({ name: `IMG_10${i}.jpeg`, type: 'image/jpeg', bytes: pic() })),
    links: [{ kind: 'maildrop', url: 'https://cvws.icloud-content.com/B/abc/IMG_0042.MOV', name: 'IMG_0042.MOV', size: 500000 }] }, { filing });
  const tw = `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Messages/MM${'b'.repeat(32)}/Media/ME`;
  await INBOX.addSender(DB, { name: 'Pat Volunteer', phone: '(770) 555-0123' });
  await INBOX.receive(env, { channel: 'text', dedupe: 'text:MMwalk1', from: '+17705550123', text: 'gala', twilio: [1, 2].map((i) => ({ url: `${tw}${String(i).repeat(32)}`, type: 'image/jpeg' })) }, { filing });
  await INBOX.receive(env, { channel: 'email', dedupe: 'email:<walk-2@gmail.com>', from: 'stranger@gmail.com', fromName: 'Stranger', auth: { dmarc: true, dkim: ['gmail.com'] },
    subject: 'Ben photos', text: 'hi', files: [{ name: 'IMG_9.jpeg', type: 'image/jpeg', bytes: pic() }] }, { filing });
  // The address check passes the sent-in photos (as it would within minutes)
  await DB.prepare("UPDATE media_items SET check_state = 'ok', described_at = COALESCE(described_at, ?) WHERE source = 'inbox' AND gate = 'check'").bind(new Date().toISOString()).run();
}

// ─── The server ───────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const base of [join(ROOT, 'public'), join(ROOT, 'dist')]) {
    let f = join(base, p);
    try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); const b = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); return res.end(b); } catch { /* next */ }
  }
  res.writeHead(404); res.end('not found');
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
const STAFF = 'pat@soardcharity.com';
const SOCIAL = 'sam.social@example.com';
const asked = [];
function answerer(email) {
  return async (req) => {
    const url = new URL(req.url());
    if (url.origin !== SITE) {
      if (RW && (['imagedelivery.net', 'cdn.jobtread.com', 'i.ytimg.com'].includes(url.hostname) || (/cloudflarestream\.com/.test(url.hostname) && /thumbnails/.test(url.pathname)))) return false;
      if (url.hostname === 'imagedelivery.net') { const parts = url.pathname.split('/'); const w = Number((parts.at(-1).match(/w=(\d+)/) || [])[1]) || 640; return req.respond({ status: 200, contentType: 'image/png', body: await picture(parts.slice(2, -1).join('/'), w) }); }
      if (url.hostname === 'cdn.jobtread.com') return req.respond({ status: 200, contentType: 'image/png', body: await picture(url.pathname, Number(url.searchParams.get('size')) || 512) });
      if (/cloudflarestream\.com/.test(url.hostname) && /thumbnails/.test(url.pathname)) return req.respond({ status: 200, contentType: 'image/png', body: await picture(url.pathname.split('/')[1], 640) });
      if (url.hostname === 'i.ytimg.com') return req.respond({ status: 200, contentType: 'image/png', body: await picture(url.pathname, 480) });
      if (/cloudflarestream\.com/.test(url.hostname)) return req.respond({ status: 200, contentType: 'text/html', body: '<body style="margin:0;background:#111;color:#bbb;font:16px sans-serif;display:grid;place-items:center;height:100vh">Stream player</body>' });
      return false;
    }
    const p = url.pathname;
    if (p === '/cdn-cgi/access/get-identity') return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ email, name: email === STAFF ? 'Pat Lee' : 'Sam Social' }) });
    if (p.startsWith('/cdn-cgi/imagedelivery/')) return req.respond({ status: 200, contentType: 'image/png', body: await picture('logo', 128) });
    if (!p.startsWith('/api/')) return false;
    const handler = { '/api/media-admin': mediaAdmin, '/api/media-download': mediaDownload, '/api/media-thumb': mediaThumb }[p];
    forgetPeople();
    const media = await mediaPersonFor(DB, email);
    if (handler) {
      asked.push(`${email} ${req.method()} ${p}${url.search}`);
      const method = req.method() === 'POST' ? 'onRequestPost' : 'onRequestGet';
      const request = new Request(`https://admin.test${p}${url.search}`, { method: req.method(), body: req.method() === 'POST' ? req.postData() : undefined, headers: { 'content-type': req.headers()['content-type'] || 'application/json' } });
      const r = await handler[method]({ env, request, data: { userEmail: email, ...(media ? { mediaOnly: media } : {}) }, waitUntil: () => {} });
      return req.respond({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
    }
    // Every other admin API: what the middleware says to someone who signs in for Photos & Videos only
    if (media || email !== STAFF) return req.respond({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'This sign-in opens Photos & Videos only.', media: '/admin/media/' }) });
    if (p.startsWith('/api/pending-changes')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, changes: [], publish: {} }) });
    if (p.startsWith('/api/live-ws')) return req.abort();
    return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ok: true, items: [], list: [], entries: [] }) });
  };
}

const browser = await puppeteer.launch({ headless: true, args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
async function open(path, { email = STAFF, width = 1440, height = 1000 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: width < 500 ? 2 : 1, isMobile: width < 500, hasTouch: width < 500 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|Content Security Policy|live-ws|403/.test(m.text())) errors.push(m.text()); });
  await answerAsks(page);
  await page.setRequestInterception(true);
  const answer = answerer(email);
  page.on('request', async (req) => {
    if (req.isInterceptResolutionHandled()) return;
    try { if ((await answer(req)) !== false) return; req.continue(); } catch (e) { errors.push(`mock: ${e.message}`); req.continue().catch(() => {}); }
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true });
  await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle2' });
  return { page, errors };
}
async function shot(page, name, { full = true } = {}) {
  const vp = page.viewport();
  if (full) { const h = Math.min(5200, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector('.main')?.scrollHeight || 0))); await page.setViewport({ ...vp, height: Math.max(vp.height, h) }); await sleep(500); }
  await page.screenshot({ path: join(OUT, name) });
  if (full) await page.setViewport(vp);
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText).catch(() => '');
const clickText = (page, sel, re) => page.evaluate((s, src, flags) => { const r = new RegExp(src, flags); const el = [...document.querySelectorAll(s)].find((x) => x.offsetParent !== null && r.test(x.textContent.trim())); if (el) { el.click(); return true; } return false; }, sel, re.source, re.flags);
const downloaded = () => readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload'));
async function waitForFile(test, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { const f = downloaded().find(test); if (f) return f; await sleep(150); } return null; }
async function axe(page, where) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await window.axe.run(document.querySelector('.md') || document, { resultTypes: ['violations'] })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  ok(!r.length, `axe on ${where}: no serious problems${r.length ? ` (${r.join('; ')})` : ''}`);
}
async function typeSearch(page, words) {
  await page.click('.md-search__box input', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('.md-search__box input', words, { delay: 30 });
}
async function waitResults(page) {
  await page.waitForFunction(() => /result|Nothing/.test(document.querySelector('.md-count-line')?.textContent || '') && !/Searching/.test(document.querySelector('.md-count-line')?.textContent || ''), { timeout: 10000 });
  await sleep(500);
}

if (RW) {
  // The real copy: screenshots of what the team will see, and the few checks that hold for any world
  const shots = [];
  await section('Real records: staff', async () => {
    const { page: pg, errors: errs } = await open('/admin/index.html#media');
    await pg.waitForSelector('.md-grid', { timeout: 30000 });
    await sleep(2500);
    await shot(pg, 'real-1-home.png', { full: false });
    for (const [q, name] of [['max', 'real-2-search-max.png'], ['colin during', 'real-3-colin-progress.png'], ['wheelchair smiling', 'real-4-wheelchair.png']]) {
      await typeSearch(pg, q);
      await pg.keyboard.press('Enter');
      await waitResults(pg);
      await sleep(2500);
      console.log(`    “${q}”: ${(await text(pg, '.md-count-line')).replace(/\s+/g, ' ')}`);
      await shot(pg, name, { full: false });
    }
    for (const [slug, name] of [['max', 'real-5-max.png'], ['dex', 'real-6-dex.png']]) {
      await pg.evaluate((s) => { location.hash = `#media/kid/${s}`; }, slug);
      await pg.waitForSelector('.md-album__head', { timeout: 15000 });
      await sleep(3000);
      const heads = await pg.$$eval('.md-sec__head h3', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      console.log(`    ${slug}: ${heads.join(' | ')}`);
      await shot(pg, name);
    }
    ok(!errs.length, `no errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  });
  await section('Real records: the social media person', async () => {
    await (await import('../functions/api/_media-people.js')).addPerson(DB, { email: SOCIAL, name: 'Sam Social' });
    const { page: pg } = await open('/admin/media/', { email: SOCIAL });
    await pg.waitForSelector('.md-grid', { timeout: 30000 });
    await sleep(2500);
    await shot(pg, 'real-7-social-home.png', { full: false });
    await pg.evaluate(() => { location.hash = '#media/kid/max'; });
    await pg.waitForSelector('.md-album__head', { timeout: 15000 });
    await sleep(3000);
    ok(!/Staff only/.test(await text(pg, '.md')), 'nothing staff only reaches them');
    await shot(pg, 'real-8-social-max.png');
  });
  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nAll good.');
  console.log(`Screenshots: ${OUT}`);
  process.exit(failures.length ? 1 : 0);
}

let page;
let errors;
await section('Staff: the home, with every source and the index’s state', async () => {
  ({ page, errors } = await open('/admin/index.html#media'));
  await page.waitForSelector('.md-grid', { timeout: 20000 });
  await sleep(1200);
  const head = await text(page, '.md-head');
  ok(/\d+ photos and \d+ videos from the website, the Drive archive, JobTread/.test(head), `the totals (${head.split('\n')[1] || ''})`);
  ok(/described for search/.test(await text(page, '.md-status')), 'the index’s state: how much is described, what waits for the check');
  ok(/Who can sign in/.test(await text(page, '.md-head__actions')), 'Who can sign in, for staff');
  const recent = await text(page, '.md-now__col:last-child');
  ok(/progress photos of Ben/.test(recent), 'JobTread’s new progress photos are in What’s happening');
  ok(/Not public yet/.test(await text(page, '.md-grid')), 'a draft’s album, marked, for staff');
  await shot(page, '1-staff-home.png', { full: false });
  await axe(page, 'the home');
});

await section('Search: suggestions as you type, results with counts, a filter, a typo fixed, what’s in the picture', async () => {
  await page.click('body');
  await page.keyboard.press('/');
  ok(await page.evaluate(() => document.activeElement?.closest('.md-search') !== null), '“/” jumps to the search box');
  await page.type('.md-search__box input', 'av', { delay: 40 });
  await page.waitForSelector('.md-sugg', { timeout: 5000 });
  ok(/Ava/.test(await text(page, '.md-sugg')), 'Ava is suggested from two letters');
  await shot(page, '2-suggestions.png', { full: false });
  await typeSearch(page, 'ava');
  await page.keyboard.press('Enter');
  await waitResults(page);
  const line = await text(page, '.md-count-line');
  ok(/\d+ results for “ava”/.test(line), line);
  const facets = await text(page, '.md-facets');
  ok(/Before/.test(facets) && /During/.test(facets) && /After/.test(facets) && /Drive archive/.test(facets) && /Website/.test(facets), 'counts by stage and by source');
  await shot(page, '3-results.png', { full: false });
  await clickText(page, '.md-facets .md-chipbtn', /^Before/);
  await waitResults(page);
  ok(/stage=Before/.test(page.url()), 'the filter is in the address');
  const tags = await page.$$eval('.md-pgrid .md-tile__tags', (els) => els.map((e) => e.textContent));
  ok(tags.length && tags.every((t) => /Before/.test(t)), 'only Before photos');
  await typeSearch(page, 'girl smiling bathroom');
  await sleep(900);
  await waitResults(page);
  const first = await page.$eval('.md-pgrid .md-tile__open', (b) => b.getAttribute('title')).catch(() => '');
  ok(!/stage=/.test(page.url()), 'a new search starts without the last one’s chips');
  ok(/smil|laugh/i.test(first), `what’s in the picture finds it: “${first.split('\n')[0]}”`);
  await typeSearch(page, 'sensry swing');
  await page.keyboard.press('Enter');
  await waitResults(page);
  ok(/showing results for/.test(await text(page, '.md-count-line')), `a typo is fixed (${(await text(page, '.md-count-line')).replace(/\s+/g, ' ')})`);
  await shot(page, '4-typo.png', { full: false });
  await axe(page, 'the results');
});

await section('An album: what the page shows, then the archive and JobTread by stage', async () => {
  await page.evaluate(() => { location.hash = '#media/kid/ava'; });
  await page.waitForSelector('.md-album__head', { timeout: 10000 });
  await sleep(1200);
  const heads = await page.$$eval('.md-sec__head h3', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(heads.some((h) => /^Videos/.test(h)) && heads.some((h) => /^On the website/.test(h)) && heads.some((h) => /^Photo archive/.test(h)), `its sections: ${heads.join(' | ')}`);
  ok(/Before\s*\d+/.test(await text(page, '#md-d-h + p, .md-sec:has(#md-d-h) .md-chips')) || /Before/.test(await page.evaluate(() => document.querySelector('#md-d-h')?.closest('.md-sec')?.innerText || '')), 'the archive narrows by stage');
  await shot(page, '5-album.png');
  await page.click('.md-pgrid .md-tile__open');
  await page.waitForSelector('.md-lb img', { timeout: 5000 });
  await sleep(600);
  await page.keyboard.press('ArrowRight');
  await sleep(400);
  ok(/2 of/.test(await text(page, '.md-lb__title')), 'the viewer steps with the arrows');
  await shot(page, '6-viewer.png', { full: false });
  await page.keyboard.press('Escape');
  await sleep(300);
  await axe(page, 'an album');
});

await section('Photos picked from two albums and two sources download as one ZIP, a folder each', async () => {
  // Ava: two from the archive
  const archive = await page.evaluateHandle(() => document.querySelector('#md-d-h').closest('.md-sec'));
  const checks = await archive.$$('.md-tile__check');
  await checks[0].click();
  await checks[1].click();
  // Ben: two from JobTread
  await page.evaluate(() => { location.hash = '#media/kid/ben'; });
  await page.waitForFunction(() => document.querySelector('#md-j-h'), { timeout: 10000 });
  await sleep(800);
  const jt = await page.evaluateHandle(() => document.querySelector('#md-j-h').closest('.md-sec'));
  const jtChecks = await jt.$$('.md-tile__check');
  await jtChecks[0].click();
  await jtChecks[1].click();
  await sleep(300);
  const bar = await text(page, '.md-pickbar');
  ok(/4 photos picked/.test(bar) && /from 2 albums/.test(bar), `the bar: ${bar.replace(/\s+/g, ' ')}`);
  await shot(page, '7-picked.png', { full: false });
  await clickText(page, '.md-pickbar button', /Download ZIP/);
  const zip = await waitForFile((f) => f.endsWith('.zip'), 30000);
  ok(!!zip, `the ZIP arrived (${zip})`);
  if (zip) {
    const list = execFileSync('unzip', ['-Z1', join(DOWNLOADS, zip)], { encoding: 'utf8' }).trim().split('\n');
    ok(list.some((n) => n.startsWith('Ava/')) && list.some((n) => n.startsWith('Ben/')) && list.includes('About these photos.txt') && list.length === 5, `a folder each and the note (${list.join(', ')})`);
    ok(/No errors/.test(execFileSync('unzip', ['-t', join(DOWNLOADS, zip)], { encoding: 'utf8' })), 'every file checks out');
  }
  ok(!errors.length, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
});

await section('Who can sign in: staff add the social media person', async () => {
  await page.evaluate(() => { location.hash = '#media'; });
  await page.waitForSelector('.md-head__actions', { timeout: 10000 });
  await clickText(page, '.md-head__actions button', /Who can sign in/);
  await page.waitForSelector('.md-modal', { timeout: 5000 });
  await page.type('.md-form input:not([type=email])', 'Sam Social');
  await page.type('.md-form input[type=email]', SOCIAL);
  await clickText(page, '.md-form button', /^Add$/);
  await page.waitForFunction(() => /Sam Social/.test(document.querySelector('.md-people')?.textContent || ''), { timeout: 5000 });
  ok(true, 'Sam Social is on the list');
  await shot(page, '8-people.png', { full: false });
  await page.keyboard.press('Escape');
});

await section('Photos sent in by email and text: the panel, the album, a held one let through, a file moved', async () => {
  await page.evaluate(() => { location.hash = '#media'; });
  await page.waitForSelector('.md-head__actions', { timeout: 10000 });
  ok(/Jane Doe emailed 3 photos and 1 video of Ben/.test(await text(page, '.md-now')), 'What’s happening: who emailed what, for whom');
  ok(/Pat Volunteer texted 2 photos of .*Gala/.test(await text(page, '.md-now')), 'and who texted');
  await clickText(page, '.md-head__actions button', /Send photos in/);
  await page.waitForFunction(() => /photos@sunshineonaranneyday\.com/.test(document.querySelector('.md-modal')?.textContent || ''), { timeout: 8000 });
  const panel = await text(page, '.md-modal');
  ok(/Set up the text number/.test(panel), 'the text number is set up by staff, once');
  ok(/1 waiting for a look/.test(panel) && /Not on the team or on Who can send/.test(panel), 'the stranger’s email waits for a look');
  ok(/Got 3 files for Colin\. They’re in Photos & Videos\./.test(panel) && /Off: nobody is answered yet/.test(panel), 'the reply’s words shown, and off');
  await shot(page, '9-send-photos-in.png', { full: false });
  await clickText(page, '.md-msgs button', /Let through/);
  await page.waitForFunction(() => !/waiting for a look/.test(document.querySelector('.md-modal')?.textContent || ''), { timeout: 8000 });
  ok(true, 'let through: filed');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#media/kid/ben'; });
  await page.waitForFunction(() => document.querySelector('#md-i-h'), { timeout: 10000 });
  await sleep(800);
  const sec = await page.evaluate(() => document.querySelector('#md-i-h').closest('.md-sec').innerText);
  ok(/Sent in by the team\s*4/.test(sec) && /Jane Doe/.test(sec) && /Stranger/.test(sec), `Ben’s album: the photos Jane and the stranger sent (${sec.split('\n')[0]})`);
  ok(/IMG_0042/.test(await page.evaluate(() => document.querySelector('#md-v-h')?.closest('.md-sec')?.innerText || '')), 'and Jane’s Mail Drop video, in Videos');
  ok(/During/.test(sec), '“progress” sorted them as During');
  await shot(page, '10-sent-in-album.png', { full: false });
  // (the photos picked for the ZIP earlier are still picked: cleared first)
  await clickText(page, '.md-pickbar button', /^Clear$/);
  await sleep(200);
  const tiles = await page.evaluateHandle(() => document.querySelector('#md-i-h').closest('.md-sec'));
  await (await tiles.$('.md-tile__check')).click();
  await sleep(200);
  await clickText(page, '.md-pickbar button', /Move to album/);
  await page.waitForSelector('.md-pickalbums', { timeout: 5000 });
  await page.type('.md-modal input', 'ava');
  await sleep(300);
  await clickText(page, '.md-pickalbums button', /^Ava/);
  await page.waitForFunction(() => !document.querySelector('.md-pickalbums'), { timeout: 8000 });
  await sleep(800);
  ok(/Sent in by the team\s*3/.test(await page.evaluate(() => document.querySelector('#md-i-h')?.closest('.md-sec')?.innerText || '')), 'moved to Ava’s album');
  ok(!errors.length, `no errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
});

let social;
await section('The social media person: their own page, nothing staff only', async () => {
  social = await open('/admin/media/', { email: SOCIAL });
  await social.page.waitForSelector('.md-grid', { timeout: 20000 });
  await sleep(1200);
  ok(/SOARD Photos & Videos/.test(await text(social.page, '.md-topbar')), 'their own page, with Sign out');
  ok(!(await social.page.$('.md-head__actions')) && !(await social.page.$('.md-status')), 'no staff panels');
  ok(!/Not public yet/.test(await text(social.page, '.md-grid')) && !/Cal/.test(await text(social.page, '.md-grid')), 'no draft album');
  await shot(social.page, '9-social-home.png', { full: false });
  await social.page.evaluate(() => { location.hash = '#media/kid/ava'; });
  await social.page.waitForSelector('.md-album__head', { timeout: 10000 });
  await sleep(1000);
  const archive = await social.page.evaluate(() => document.querySelector('#md-d-h')?.closest('.md-sec')?.innerText || '');
  ok(!/Staff only/.test(await text(social.page, '.md')), 'nothing marked staff only reaches them');
  const beforeCount = Number((archive.match(/Before\s*(\d+)/) || [])[1] || 0);
  ok(beforeCount < 10, `only the Before photos the check passed (${beforeCount} of 10)`);
  ok(/In Ava/.test(await text(social.page, '.md-search')) && !(await social.page.$eval('.md-search__box input', (i) => i.value)), 'the album opens with an empty box, scoped to it');
  await social.page.evaluate(() => { location.hash = '#media'; });
  await social.page.waitForSelector('.md-grid', { timeout: 10000 });
  await typeSearch(social.page, 'unmatched family');
  await social.page.keyboard.press('Enter');
  await waitResults(social.page);
  ok(!/album=/.test(social.page.url()) && /Nothing/.test(await text(social.page, '.md-count-line')), 'a job no page matches: nothing, searching everything');
  await typeSearch(social.page, 'cal');
  await social.page.keyboard.press('Enter');
  await waitResults(social.page);
  ok(!(await social.page.$$eval('.md-tile__tags', (t) => t.map((x) => x.textContent))).some((t) => /Cal/.test(t)) && !/Cal/.test(await text(social.page, '.md-grid--small').catch(() => '')), 'a draft kid’s photos: none');
  ok(!(await social.page.$('.spinner')) || await social.page.$$eval('.spinner', (s) => s.every((x) => !x.offsetParent)), 'no stray spinner on their page');
  await shot(social.page, '10-social-album.png', { full: false });
  await axe(social.page, 'their page');
  const admin = await open('/admin/index.html', { email: SOCIAL });
  await admin.page.waitForFunction(() => location.pathname.startsWith('/admin/media'), { timeout: 10000 }).catch(() => {});
  ok(admin.page.url().includes('/admin/media/'), `the admin sends them to their page (${admin.page.url().replace(SITE, '')})`);
  ok(!social.errors.length, `no errors on their page${social.errors.length ? `: ${social.errors.slice(0, 3).join(' | ')}` : ''}`);
});

await section('A phone', async () => {
  const phone = await open('/admin/media/', { email: SOCIAL, width: 390, height: 844 });
  await phone.page.waitForSelector('.md-grid', { timeout: 20000 });
  await sleep(1000);
  const wide = await phone.page.evaluate(() => [...document.querySelectorAll('.md *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent !== null)
    .filter((e) => { for (let p = e.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return false; return true; }).map((e) => e.className).slice(0, 4));
  ok(!wide.length, `nothing spills past the edge${wide.length ? ` (${wide.join(', ')})` : ''}`);
  await shot(phone.page, '11-phone.png', { full: false });
  await typeSearch(phone.page, 'ava after');
  await phone.page.keyboard.press('Enter');
  await waitResults(phone.page);
  await shot(phone.page, '12-phone-search.png', { full: false });
});

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nAll good.');
console.log(`Screenshots: ${OUT}`);
process.exit(failures.length ? 1 : 0);
