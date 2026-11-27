/**
 * Photos & Videos, everything: the index of every photo and video (website, Stream, the Drive archive, JobTread,
 * YouTube), the search, the describer and address check, the endpoints, the downloads, and the sign-in that opens
 * Photos & Videos only. Made-up people, places and ids only.
 * Run: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createD1 } from './lib/d1-shim.mjs';
import * as IX from '../functions/api/_media-index.js';
import { search, parseQuery, stem, nearest, buildVocab, itemFor } from '../functions/api/_media-search.js';
import { describeSome } from '../functions/api/_media-describe.js';
import { QUESTIONS } from '../functions/api/_photo-screen.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/media-admin.js';
import { onRequestGet as dlGet, onRequestPost as dlPost, itemFileName } from '../functions/api/media-download.js';
import { onRequestGet as thumbGet } from '../functions/api/media-thumb.js';
import { onRequest, isAuthenticated, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import { everyoneSignIns } from '../functions/api/_board-access.js';
import { addPerson, forgetPeople } from '../functions/api/_media-people.js';
import { HOLDING, PHOTOS_DRIVE } from '../functions/api/_past-photos.js';

const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
const UID = (c) => c.repeat(32).slice(0, 32);
const T = (s) => Date.parse(s);
const { privateKey: SA_PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'site@example.iam.gserviceaccount.com', client_id: '1', private_key: SA_PEM, token_uri: 'https://oauth2.googleapis.com/token', project_id: 'p' });

const ava = {
  name: 'Ava', slug: 'ava', year: 2026, status: 'completed', publishStatus: 'published', roomTypes: ['Accessible Bathroom'], photographer: 'Example Photography',
  heroImage: `${CF}/kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg/public`,
  photos: [{ url: `${CF}/kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg/public`, alt: 'A girl in a pink wheelchair laughing in her new bathroom' }, { url: `${CF}/kids/ava/${T('2026-11-23T15:01:00Z')}-FINAL-2.jpg/public`, alt: 'The roll-in shower with white tile' }],
  plans: [{ url: `${CF}/kids/ava/plan-1-sheet.jpg/public`, type: 'as-built' }],
  streamVideoId: UID('a'), revealVideoUrl: `https://watch.cloudflarestream.com/${UID('b')}`, videoUrl: 'https://www.youtube.com/watch?v=AvaRevealYT',
};
const ben = { name: 'Ben', slug: 'ben', year: 2026, status: 'in-progress', publishStatus: 'published', roomTypes: ['Dream Bedroom'], heroImage: `${CF}/kids/ben/hero/public`, photos: [] };
const cal = { name: 'Cal', slug: 'cal', year: 2026, publishStatus: 'draft', heroImage: `${CF}/kids/cal/hero/public`, photos: [] };
const gala = { slug: 'gala-2026', title: '2026 Example Gala', date: '2026-08-22', status: 'past', location: 'Example Hall', image: `${CF}/events/gala-2026/hero/public`, photos: [{ id: 'gallery/gala/1790263941367-dsc.jpg', alt: '' }] };
const school = { slug: 'school', name: 'Example School', year: '2025', description: 'A sensory room.', heroImage: `${CF}/community/school/hero/public`, photos: [] };

async function world() {
  const DB = await createD1({ schemaSql: [
    'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
    'CREATE TABLE events (slug TEXT PRIMARY KEY, title TEXT, data TEXT)',
    'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
    `CREATE TABLE broadcasts (id TEXT PRIMARY KEY, kid_slug TEXT, kid_name TEXT, title TEXT, message TEXT, image TEXT, scheduled_at TEXT, live_at TEXT, ended_at TEXT, phase TEXT,
      live_video_uid TEXT, replay_uid TEXT, fb_live_video_id TEXT, fb_permalink TEXT, source TEXT, data TEXT, created_at TEXT, updated_at TEXT)`,
    `CREATE TABLE past_jobs (key TEXT PRIMARY KEY, kind TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, year INTEGER NOT NULL, folder TEXT, close_on TEXT, close_how TEXT, job_id TEXT, made_by TEXT, state TEXT NOT NULL DEFAULT 'listed', updated_at TEXT NOT NULL DEFAULT '')`,
    'CREATE TABLE photo_stages (file_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, name TEXT, kind TEXT, taken TEXT, camera INTEGER, stage TEXT, why TEXT, reads INTEGER NOT NULL DEFAULT 0, decided_at TEXT, written_at TEXT)',
  ] });
  for (const k of [ava, ben, cal]) await DB.prepare('INSERT INTO kids VALUES (?, ?, ?)').bind(k.slug, k.name, JSON.stringify(k)).run();
  await DB.prepare('INSERT INTO events VALUES (?, ?, ?)').bind(gala.slug, gala.title, JSON.stringify(gala)).run();
  await DB.prepare('INSERT INTO community VALUES (?, ?, ?)').bind(school.slug, school.name, JSON.stringify(school)).run();
  await DB.prepare('INSERT INTO broadcasts (id, kid_slug, kid_name, live_at, ended_at, replay_uid, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('live-1', 'ava', 'Ava', '2026-11-20T21:00:00Z', '2026-11-20T21:12:00Z', UID('b'), JSON.stringify({ reel: { sourceUid: UID('b'), cut: { start: 40, end: 60 }, caption: 'Ava rolled in.' } })).run();
  await DB.prepare("INSERT INTO past_jobs (key, kind, slug, name, year, folder, close_on, close_how, job_id, made_by, state) VALUES ('ava', 'kid', 'ava', 'Ava', 2026, 'Ava Sample 2026', '2026-11-20', 'reveal date', 'JPAST1', 'site', 'made')").run();
  await DB.prepare("INSERT INTO site_config VALUES ('broadcast-config', ?, '')").bind(JSON.stringify({ youtube: { channelUrl: 'https://www.youtube.com/@examplechannel/live' }, rehearsalInput: { uid: 'rehearsal-input' } })).run();
  await DB.prepare("INSERT INTO site_config VALUES ('reveals', ?, '')").bind(JSON.stringify({ reveals: [], upcoming: [{ slug: 'ben', name: 'Ben', confirmed: false, window: { label: 'mid December', through: '2099-12-20' }, rooms: ['Dream Bedroom'] }], past: [], updatedAt: '2026-11-25T12:00:00Z' })).run();
  return { DB, CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 'img', CF_STREAM_TOKEN: 'st', YOUTUBE_API_KEY: 'yt', GOOGLE_CALENDAR_KEY: SERVICE_ACCOUNT, JOBTREAD_GRANT_KEY: 'jt' };
}

// ─── A fake Cloudflare, Google, YouTube and JobTread ───────────────
const IMAGES = [
  `kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg`, `kids/ava/${T('2026-11-23T15:01:00Z')}-FINAL-2.jpg`, 'kids/ava/old-gallery-pick.jpg',
  'kids/ava/before-1794554440614-0acf03ea24364ec98a4e5c9cad95e18a-companycam-1.jpg', 'kids/ava/plan-1-sheet.jpg', 'kids/cal/hero', 'kids/ben/hero',
  'applications/form/f1-abc', 'advisory-applications/a1/xyz', 'book/v1/p001', 'team/jane-doe/1775668349955', 'partners/acme/logo', 'gallery/gala/1790263941367-dsc.jpg',
  'events/gala-2026/hero', 'community/school/hero', 'brand-logo-admin',
].map((id) => ({ id, uploaded: '2026-11-01T00:00:00Z' }));
const STREAM = [
  { uid: UID('a'), meta: { name: 'Ava makeover' }, duration: 125, size: 5e7, created: '2026-11-21T00:00:00Z', readyToStream: true },
  { uid: UID('b'), meta: { name: 'Ava live' }, duration: 720, created: '2026-11-20T21:00:00Z', readyToStream: true },
  { uid: UID('c'), meta: { name: 'Auto-archived FB live: Ava’s room reveal (2026-11-20)' }, duration: 700, created: '2026-11-21T10:00:00Z' },
  { uid: UID('d'), meta: { name: 'Gala highlight reel' }, duration: 60, created: '2026-08-30T00:00:00Z' },
  { uid: UID('e'), meta: { name: 'Sample Family application', application: 'app_1' }, requireSignedURLs: true, created: '2026-10-01T00:00:00Z' },
  { uid: UID('f'), meta: { name: 'test run' }, liveInput: 'rehearsal-input', created: '2026-11-19T00:00:00Z' },
];
const DRIVE_FOLDERS = {
  fHold: { name: HOLDING, parent: PHOTOS_DRIVE }, fAva: { name: 'Ava Sample 2026', parent: 'fHold' }, fAvaBefore: { name: 'Home Visit', parent: 'fAva' }, fAvaReveal: { name: 'Reveal', parent: 'fAva' },
  fGala: { name: 'Gala 2025', parent: PHOTOS_DRIVE }, fApps: { name: 'Applications 2027', parent: PHOTOS_DRIVE },
};
const DRIVE_FILES = [
  { id: 'driveAvaBefore01', name: 'IMG_0001.HEIC', mimeType: 'application/octet-stream', parents: ['fAvaBefore'], size: '3000000', imageMediaMetadata: { time: '2026:09:01 10:00:00' } },
  { id: 'driveAvaBefore02', name: 'IMG_0002.JPG', mimeType: 'image/jpeg', parents: ['fAvaBefore'], size: '2000000' },
  { id: 'driveAvaReveal01', name: 'DSC_0151.JPG', mimeType: 'image/jpeg', parents: ['fAvaReveal'], size: '5000000', imageMediaMetadata: { time: '2026:11:20 15:00:00' } },
  { id: 'driveAvaRevealV1', name: 'reveal-walkthrough.MOV', mimeType: 'video/quicktime', parents: ['fAvaReveal'], size: '90000000', videoMediaMetadata: { durationMillis: 61000 } },
  { id: 'driveAvaHomeVid1', name: 'walkaround.mp4', mimeType: 'video/mp4', parents: ['fAvaBefore'], size: '40000000' },
  { id: 'driveGalaPhoto01', name: 'gala dancers.jpg', mimeType: 'image/jpeg', parents: ['fGala'], size: '1000000', imageMediaMetadata: { time: '2025:08:23 20:00:00' } },
  { id: 'driveAppsPhoto01', name: 'family kitchen.jpg', mimeType: 'image/jpeg', parents: ['fApps'], size: '1000000' },
  { id: 'driveReadmeDoc01', name: 'notes.txt', mimeType: 'application/octet-stream', parents: ['fGala'] },
];
const JOBS = [{ id: 'JOPEN1', name: 'Ben Example (2026)', closedOn: null }, { id: 'JPAST1', name: 'Ava Sample (2026)', closedOn: '2026-11-25' }, { id: 'JODD01', name: 'Unmatched Family (2026)', closedOn: null }, { id: '22P3HTX9cXn4', name: 'Office sandbox', closedOn: null }];
const JOB_FILES = {
  JOPEN1: [
    { id: 'jtBenProg01', name: 'CompanyCam 2101160340', type: 'image/jpeg', size: 300000, createdAt: new Date(Date.now() - 2 * 864e5).toISOString(), url: 'https://cdn.jobtread.com/benprog1', fileTags: { nodes: [{ name: 'During' }] } },
    { id: 'jtBenBefo01', name: 'CompanyCam 2101160341', type: 'image/jpeg', size: 300000, createdAt: '2026-10-01T00:00:00Z', url: 'https://cdn.jobtread.com/benbefore1', fileTags: { nodes: [{ name: 'Before' }] } },
    { id: 'jtBenLog001', name: 'log.jpg', type: 'image/jpeg', url: 'https://cdn.jobtread.com/log', dailyLog: { id: 'dl1' }, fileTags: { nodes: [] } },
    { id: 'jtBenPdf001', name: 'estimate.pdf', type: 'application/pdf', url: 'https://cdn.jobtread.com/pdf', fileTags: { nodes: [] } },
    // As SOARD's JobTread has them (Nov 26 2026): receipts, drawings and family papers as pictures, with their tags
    { id: 'jtBenCost01', name: 'receipt.jpg', type: 'image/jpeg', url: 'https://cdn.jobtread.com/cost', fileTags: { nodes: [{ name: 'Costs' }] } },
    { id: 'jtBenPlan01', name: 'plan.png', type: 'image/png', url: 'https://cdn.jobtread.com/plan', fileTags: { nodes: [{ name: 'Plans' }] } },
    { id: 'jtBenFam001', name: 'scan.jpg', type: 'image/jpeg', url: 'https://cdn.jobtread.com/fam', fileTags: { nodes: [{ name: '_MakeoverFamily' }, { name: 'After' }] } },
  ],
  JODD01: [{ id: 'jtOddPhot01', name: 'photo.jpg', type: 'image/jpeg', url: 'https://cdn.jobtread.com/odd', fileTags: { nodes: [{ name: 'After' }] }, createdAt: '2026-11-01T00:00:00Z' }],
};
const YT = [
  { id: 'AvaRevealYT', snippet: { title: 'Ava’s Accessible Bathroom Reveal', publishedAt: '2026-11-22T00:00:00Z', description: 'Ava sees her new bathroom' }, contentDetails: { duration: 'PT3M10S' }, status: { privacyStatus: 'public' } },
  { id: 'PrivateYT01', snippet: { title: 'Internal test', publishedAt: '2026-01-01T00:00:00Z' }, contentDetails: { duration: 'PT10S' }, status: { privacyStatus: 'private' } },
];

const realFetch = globalThis.fetch;
function fakeWorld({ images = IMAGES, driveFiles = DRIVE_FILES } = {}) {
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('/images/v2')) return Response.json({ success: true, result: { images, continuation_token: null } });
    if (/\/accounts\/acct\/stream\?/.test(url)) return Response.json({ success: true, result: STREAM });
    if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) return Response.json({ items: [{ id: 'UCabcdefghijklmnopqrstuv' }] });
    if (url.startsWith('https://www.googleapis.com/youtube/v3/playlistItems')) return Response.json({ items: YT.map((v) => ({ contentDetails: { videoId: v.id } })) });
    if (url.startsWith('https://www.googleapis.com/youtube/v3/videos')) return Response.json({ items: YT });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
      if (/mimeType = 'application\/vnd.google-apps.folder'/.test(q)) return Response.json({ files: Object.entries(DRIVE_FOLDERS).map(([id, f]) => ({ id, name: f.name, parents: [f.parent] })) });
      return Response.json({ files: driveFiles });
    }
    const one = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?(.*)$/);
    if (one) {
      if (/alt=media/.test(one[2])) return new Response(new TextEncoder().encode(`DRIVE:${one[1]}`), { headers: { 'Content-Type': 'image/heic' } });
      return Response.json({ driveId: PHOTOS_DRIVE, trashed: false, mimeType: 'image/jpeg', thumbnailLink: `https://lh3.googleusercontent.com/thumb/${one[1]}=s220` });
    }
    if (url.startsWith('https://lh3.googleusercontent.com/')) return new Response(new TextEncoder().encode(`THUMB:${url}`), { headers: { 'Content-Type': 'image/jpeg' } });
    if (url === 'https://api.jobtread.com/pave') {
      const q = JSON.parse(init.body).query;
      if (q.organization) return Response.json({ organization: { jobs: { nodes: JOBS, nextPage: null } } });
      if (q.job) return Response.json({ job: { f: { nodes: JOB_FILES[q.job.$.id] || [], nextPage: null } } });
    }
    if (url.startsWith('https://cdn.jobtread.com/')) return new Response(new TextEncoder().encode(`JT:${url}`), { headers: { 'Content-Type': 'image/jpeg' } });
    const img = url.match(/^https:\/\/imagedelivery\.net\/[^/]+\/(.+)\/([^/]+)$/);
    if (img) return new Response(new TextEncoder().encode(`JPEG:${img[1]}`), { headers: { 'Content-Type': 'image/jpeg' } });
    return new Response(`offline: ${url}`, { status: 503 });
  };
  return { seen, restore: () => { globalThis.fetch = realFetch; } };
}

/** Every source read to its end, turn after turn */
async function indexAll(env) {
  const state = {};
  const ctx = await IX.loadContext(env.DB);
  await IX.ensureMediaIndex(env.DB);
  for (const s of ['site', 'stream', 'youtube', 'drive', 'jobtread']) {
    let st = {};
    for (let i = 0; i < 20; i++) {
      const r = await IX.indexStep(env, s, st, ctx, { deadline: Date.now() + 60000 });
      if (r.done) { state[s] = { doneAt: new Date().toISOString(), note: r.note }; break; }
      st = { cursor: r.cursor, pass: r.pass, count: r.count };
    }
  }
  await IX.setState(env.DB, 'sources', state);
  return state;
}
const rows = async (DB, where = '1 = 1') => (await DB.prepare(`SELECT * FROM media_items WHERE ${where} ORDER BY id`).all()).results;

// ─── The index ─────────────────────────────────────────────────────

test('the index holds every source, each row in its album, never anything private', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    const state = await indexAll(env);
    for (const s of ['site', 'stream', 'youtube', 'drive', 'jobtread']) assert.ok(state[s]?.doneAt, `${s} read`);
    const all = await rows(env.DB);
    const by = Object.fromEntries(all.map((r) => [r.id, r]));
    // Website: a page's photos in its album with their alt text; the rest by folder; private folders never
    assert.equal(by[`img:kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg`].album, 'kid:ava');
    assert.match(by[`img:kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg`].words, /pink wheelchair laughing/);
    assert.equal(by['img:kids/ava/old-gallery-pick.jpg'].gate, 'open');
    assert.equal(by['img:kids/ava/before-1794554440614-0acf03ea24364ec98a4e5c9cad95e18a-companycam-1.jpg'].gate, 'staff');
    assert.equal(by['img:kids/ava/plan-1-sheet.jpg'].gate, 'staff');
    assert.equal(by['img:team/jane-doe/1775668349955'].album, 'lib:team');
    assert.equal(by['img:partners/acme/logo'].album, 'lib:logos');
    assert.equal(by['img:gallery/gala/1790263941367-dsc.jpg'].album, 'event:gala-2026');
    assert.equal(by['img:kids/cal/hero'].album, 'kid:cal');
    for (const id of ['img:applications/form/f1-abc', 'img:advisory-applications/a1/xyz', 'img:book/v1/p001']) assert.equal(by[id], undefined, id);
    // Stream: a page's videos, the archived live by its name, others in the library; applications and rehearsals never
    assert.equal(by[`vid:${UID('a')}`].album, 'kid:ava');
    assert.equal(by[`vid:${UID('c')}`].album, 'kid:ava');
    assert.equal(by[`vid:${UID('d')}`].album, 'lib:videos');
    assert.equal(by[`vid:${UID('e')}`], undefined, 'a family’s application video');
    assert.equal(by[`vid:${UID('f')}`], undefined, 'a rehearsal');
    // YouTube: the page's own video in its album; a private one staff's only
    assert.equal(by['yt:AvaRevealYT'].album, 'kid:ava');
    assert.equal(by['yt:PrivateYT01'].gate, 'staff');
    // Drive: the past makeover's folder is the kid's album, Before photos wait for the check, a home-visit video and a
    // folder about applications are staff's only, a text file isn't media
    assert.equal(by['drv:driveAvaReveal01'].album, 'kid:ava');
    assert.equal(by['drv:driveAvaReveal01'].stage, 'After');
    assert.equal(by['drv:driveAvaBefore01'].stage, 'Before');
    assert.equal(by['drv:driveAvaBefore01'].gate, 'staff', 'a home visit folder');
    assert.equal(by['drv:driveAvaHomeVid1'].gate, 'staff');
    assert.equal(by['drv:driveAvaRevealV1'].kind, 'video');
    assert.equal(by['drv:driveAvaRevealV1'].seconds, 61);
    assert.equal(by['drv:driveGalaPhoto01'].album, 'drive:Gala 2025');
    assert.equal(by['drv:driveAppsPhoto01'].gate, 'staff');
    assert.equal(by['drv:driveReadmeDoc01'], undefined);
    // JobTread: the open job's photos by their tag; a daily log's and documents never; the past job (the Drive's copies)
    // and the sandbox never read; a job no page matches is staff's only
    assert.equal(by['jt:jtBenProg01'].album, 'kid:ben');
    assert.equal(by['jt:jtBenProg01'].stage, 'During');
    assert.equal(by['jt:jtBenProg01'].gate, 'open');
    assert.equal(by['jt:jtBenBefo01'].gate, 'check');
    assert.equal(by['jt:jtBenLog001'], undefined);
    assert.equal(by['jt:jtBenPdf001'], undefined);
    assert.equal(by['jt:jtOddPhot01'].gate, 'staff');
    for (const [id, why] of [['jt:jtBenCost01', /receipt/], ['jt:jtBenPlan01', /address/], ['jt:jtBenFam001', /_MakeoverFamily/]]) {
      assert.equal(by[id].gate, 'staff', id);
      assert.match(by[id].why, why);
    }
    assert.ok(!cf.seen.some((u) => u.includes('JPAST1') || u.includes('22P3HTX9cXn4')));
  } finally { cf.restore(); }
});

test('reading again writes only what changed, and takes out what’s gone', async () => {
  const env = await world();
  let cf = fakeWorld();
  try { await indexAll(env); } finally { cf.restore(); }
  const before = Object.fromEntries((await rows(env.DB)).map((r) => [r.id, r.updated_at]));
  await new Promise((r) => setTimeout(r, 5));
  cf = fakeWorld({ images: IMAGES.filter((i) => i.id !== 'partners/acme/logo'), driveFiles: DRIVE_FILES.filter((f) => f.id !== 'driveGalaPhoto01') });
  try { await indexAll(env); } finally { cf.restore(); }
  const after = Object.fromEntries((await rows(env.DB)).map((r) => [r.id, r.updated_at]));
  assert.equal(after['img:partners/acme/logo'], undefined);
  assert.equal(after['drv:driveGalaPhoto01'], undefined);
  assert.equal(after['img:team/jane-doe/1775668349955'], before['img:team/jane-doe/1775668349955'], 'unchanged rows aren’t written again');
});

test('the heartbeat’s turn: once a minute, the source waiting longest, a failure said and waited out', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    const now = Date.now();
    const r1 = await IX.maybeRunMediaIndex(env, { now, deadline: Date.now() + 30000 });
    assert.ok(r1.ran?.source);
    assert.equal(await IX.maybeRunMediaIndex(env, { now: now + 1000 }), null, 'a second ask inside the minute does nothing');
    const r2 = await IX.maybeRunMediaIndex(env, { now: now + 61000, deadline: Date.now() + 30000 });
    assert.notEqual(r2.ran.source, r1.ran.source);
    const facts = await IX.indexFacts(env.DB);
    assert.ok(Object.keys(facts.sources).length >= 2);
    assert.equal(IX.nextSource({}, {}), null, 'nothing to read without keys');
  } finally { cf.restore(); }
});

// ─── Search ────────────────────────────────────────────────────────

test('reading a query: filters, stems and everyday kin', () => {
  const p = parseQuery('Ava’s after videos 2026 from the drive smiling');
  assert.deepEqual([p.kind, p.stage, p.source, p.year], ['video', 'After', 'drive', '2026']);
  assert.deepEqual(p.groups.map((g) => g.word), ['ava', 'smiling']);
  assert.ok(p.groups[1].forms.includes('happy') && p.groups[1].forms.includes('smil'));
  assert.equal(stem('showers'), 'shower');
  assert.equal(stem('families'), 'famili');
  assert.equal(nearest('wheelchiar', { wheelchair: 10, wheels: 3 }), 'wheelchair');
  assert.equal(nearest('cat', { car: 1 }), null, 'short words aren’t guessed');
});

test('search: the album’s name counts most, words in the picture find it, filters narrow it, a typo is fixed', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    await indexAll(env);
    const r = await search(env.DB, 'ava', { staff: true });
    assert.ok(r.total >= 8);
    assert.ok(r.items.slice(0, 5).every((i) => i.album === 'kid:ava'));
    const w = await search(env.DB, 'laughing wheelchair', { staff: true });
    assert.equal(w.items[0].id, `img:kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg`);
    const vids = await search(env.DB, 'ava videos', { staff: true });
    assert.ok(vids.items.length && vids.items.every((i) => i.kind === 'video'));
    assert.deepEqual(vids.facets.kind.map((f) => f.value).sort(), ['photo', 'video'], 'the kind chips count both, with the other filters on');
    const drive = await search(env.DB, 'ava', { staff: true, filters: { source: 'drive' } });
    assert.ok(drive.items.every((i) => i.source === 'drive'));
    const progress = await search(env.DB, 'ben during', { staff: true });
    assert.deepEqual(progress.items.map((i) => i.id), ['jt:jtBenProg01']);
    await buildVocab(env.DB, { deadline: Date.now() + 5000 });
    const typo = await search(env.DB, 'wheelchiar', { staff: true });
    assert.deepEqual(typo.query.corrected, [['wheelchiar', 'wheelchair']]);
    assert.ok(typo.total >= 1);
    const year = await search(env.DB, '2025', { staff: true });
    assert.ok(year.items.some((i) => i.id === 'drv:driveGalaPhoto01'));
  } finally { cf.restore(); }
});

test('the Photos & Videos sign-in finds only what it may see', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    await indexAll(env);
    const ids = async (q, f = {}) => (await search(env.DB, q, { staff: false, filters: f, limit: 500 })).items.map((i) => i.id);
    const all = await ids('');
    for (const id of ['img:kids/cal/hero', 'img:kids/ava/plan-1-sheet.jpg', 'jt:jtBenBefo01', 'jt:jtOddPhot01', 'yt:PrivateYT01', 'drv:driveAvaBefore01', 'drv:driveAppsPhoto01', 'drv:driveAvaHomeVid1']) {
      assert.ok(!all.includes(id), `${id} hidden`);
    }
    for (const id of ['img:kids/ava/old-gallery-pick.jpg', 'jt:jtBenProg01', 'drv:driveAvaReveal01', 'yt:AvaRevealYT']) assert.ok(all.includes(id), `${id} shown`);
    assert.equal(await itemFor(env.DB, 'jt:jtBenBefo01', { staff: false }), null);
    assert.ok(await itemFor(env.DB, 'jt:jtBenBefo01', { staff: true }));
    // The address check passes it: it opens
    await env.DB.prepare("UPDATE media_items SET check_state = 'ok' WHERE id = 'jt:jtBenBefo01'").run();
    assert.ok((await ids('ben')).includes('jt:jtBenBefo01'));
    // A kid published later: their album opens with them
    await env.DB.prepare("UPDATE kids SET data = json_set(data, '$.publishStatus', 'published') WHERE slug = 'cal'").run();
    assert.ok((await ids('')).includes('img:kids/cal/hero'));
    // Staff see why a photo is held
    const held = (await search(env.DB, 'ava plan', { staff: true })).items.find((i) => i.id === 'img:kids/ava/plan-1-sheet.jpg');
    assert.equal(held.held, true);
    assert.match(held.why, /address/);
  } finally { cf.restore(); }
});

// ─── Describing and the address check ──────────────────────────────

test('photos are described for search and Before photos checked; a held one stays staff’s, a cap stops the turn', async () => {
  const env = await world();
  let cf = fakeWorld();
  try { await indexAll(env); } finally { cf.restore(); }
  const asked = [];
  env.AI = {
    run: async (model, input) => {
      const text = JSON.stringify(input.messages[1].content[0]);
      asked.push(text.includes('Describe') ? 'describe' : 'screen');
      if (text.includes('Describe')) return { response: { description: 'A boy painting a blue wall with a roller', tags: ['painting', 'blue', 'roller'] } };
      // The address check: the Before photo shows a house number
      return { response: Object.fromEntries(QUESTIONS.map((q) => [q.key, q.key === 'outside'])) };
    },
  };
  cf = fakeWorld();
  try {
    const out = await describeSome(env, { deadline: Date.now() + 60000 });
    assert.ok(out.described >= 3, JSON.stringify(out));
    const benBefore = (await rows(env.DB, "id = 'jt:jtBenBefo01'"))[0];
    assert.equal(benBefore.check_state, 'held');
    assert.ok(benBefore.check_why);
    assert.equal(await itemFor(env.DB, 'jt:jtBenBefo01', { staff: false }), null);
    const found = await search(env.DB, 'roller painting', { staff: true });
    assert.ok(found.total >= 1);
    assert.ok(asked.includes('screen'));
    // A page photo with alt text is never sent to the model
    assert.ok((await rows(env.DB, `id = 'img:kids/ava/${T('2026-11-23T15:00:00Z')}-FINAL-1.jpg'`))[0].described_at);
  } finally { cf.restore(); }
  env.AI = { run: async () => { throw new Error('2003: spending cap reached'); } };
  await env.DB.prepare("UPDATE media_items SET described_at = NULL, tries = 0 WHERE source = 'drive'").run();
  cf = fakeWorld();
  try {
    const out = await describeSome(env, { deadline: Date.now() + 60000 });
    assert.match(out.stopped, /cap/);
  } finally { cf.restore(); }
});

// ─── The endpoints ─────────────────────────────────────────────────

const ctxOf = (env, qs, { media = null, email = 'pat@soardcharity.com', method = 'GET', body = null } = {}) => ({
  env, waitUntil: () => {},
  data: { userEmail: media ? media.email : email, ...(media ? { mediaOnly: media } : {}) },
  request: new Request(`https://admin.test/api/x?${qs}`, { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { 'Content-Type': 'application/json' } : {} }),
});
const SOCIAL = { email: 'sam.social@example.com', name: 'Sam Social' };

test('the home: staff see drafts, the index’s state and who signs in; the Photos & Videos sign-in sees public albums only', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    await indexAll(env);
    await addPerson(env.DB, { email: SOCIAL.email, name: SOCIAL.name, by: 'pat@soardcharity.com' });
    const staff = await (await adminGet(ctxOf(env, ''))).json();
    assert.equal(staff.me.role, 'staff');
    assert.ok(staff.albums.some((a) => a.key === 'kid:cal' && a.public === false));
    assert.ok(staff.albums.some((a) => a.key.startsWith('jt:')));
    assert.ok(staff.facts && staff.people.some((p) => p.email === SOCIAL.email));
    const avaCard = staff.albums.find((a) => a.key === 'kid:ava');
    assert.ok(avaCard.sources.drive >= 3 && avaCard.photos >= 6, JSON.stringify(avaCard));
    assert.ok(staff.albums.some((a) => a.key === 'drive:Gala 2025' && a.kind === 'library'));
    const media = await (await adminGet(ctxOf(env, '', { media: SOCIAL }))).json();
    assert.equal(media.me.role, 'media');
    assert.ok(!media.albums.some((a) => a.key === 'kid:cal' || a.key.startsWith('jt:')));
    assert.equal(media.people, undefined);
    assert.equal(media.facts, undefined);
    assert.ok(media.activity.recent.some((x) => /progress photo/.test(x.title)), 'JobTread’s new progress photos are in What’s happening');
    assert.equal((await (await adminGet(ctxOf(env, 'me=1', { media: SOCIAL }))).json()).me.role, 'media');
  } finally { cf.restore(); }
});

test('an album: what the page shows, then the archive, JobTread and the rest, each where it belongs', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    await indexAll(env);
    const a = await (await adminGet(ctxOf(env, 'album=kid:ava'))).json();
    assert.ok(a.album.files.every((f) => f.item.startsWith('img:')));
    assert.deepEqual(a.sections.drive.map((i) => i.stage), ['Before', 'Before', 'After'], 'Before, During, After');
    assert.ok(a.sections.site.some((i) => i.id === 'img:kids/ava/old-gallery-pick.jpg'));
    assert.ok(!a.sections.site.some((i) => a.album.files.some((f) => `img:${f.id}` === i.id)), 'nothing twice');
    assert.ok(a.sections.videos.some((i) => i.id === 'drv:driveAvaRevealV1') && a.sections.videos.some((i) => i.id === `vid:${UID('c')}`));
    const m = await (await adminGet(ctxOf(env, 'album=kid:ava', { media: SOCIAL }))).json();
    assert.ok(!m.sections.drive.some((i) => i.stage === 'Before'));
    assert.ok(!m.sections.site.some((i) => /plan|before-/.test(i.id)));
    assert.equal((await adminGet(ctxOf(env, 'album=kid:cal', { media: SOCIAL }))).status, 404);
    assert.equal((await adminGet(ctxOf(env, 'album=jt:JODD01', { media: SOCIAL }))).status, 404);
    const lib = await (await adminGet(ctxOf(env, `album=${encodeURIComponent('drive:Gala 2025')}`))).json();
    assert.deepEqual(lib.sections.drive.map((i) => i.id), ['drv:driveGalaPhoto01']);
  } finally { cf.restore(); }
});

test('who signs in: staff add and remove people (never themselves); the Photos & Videos sign-in can’t', async () => {
  const env = await world();
  const add = await (await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'add-person', email: 'Sam.Social@Example.com', name: 'Sam Social' } }))).json();
  assert.equal(add.ok, true);
  assert.deepEqual(add.people.map((p) => p.email), ['sam.social@example.com']);
  assert.equal((await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'add-person', email: 'pat@soardcharity.com', name: 'Me' } }))).status, 400);
  assert.equal((await adminPost(ctxOf(env, '', { media: SOCIAL, method: 'POST', body: { act: 'add-person', email: 'friend@example.com' } }))).status, 403);
  assert.equal((await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'add-person', email: 'not an email' } }))).status, 400);
  const rm = await (await adminPost(ctxOf(env, '', { method: 'POST', body: { act: 'remove-person', email: 'sam.social@example.com' } }))).json();
  assert.deepEqual(rm.people, []);
  const log = (await env.DB.prepare("SELECT entity_name FROM audit_log WHERE entity_type = 'media-people'").all()).results.map((r) => r.entity_name);
  assert.equal(log.length, 2);
});

// ─── Downloads ─────────────────────────────────────────────────────

test('downloads: any item from its own place under its album’s name; never one the person may not see', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    await indexAll(env);
    const get = async (qs, o) => dlGet(ctxOf(env, qs, o));
    const drv = await get('item=drv:driveAvaReveal01');
    assert.equal(drv.status, 200);
    assert.match(drv.headers.get('Content-Disposition'), /SOARD-Ava-DSC_0151\.JPG/);
    assert.equal(await drv.text(), 'DRIVE:driveAvaReveal01');
    const jt = await get('item=jt:jtBenProg01', { media: SOCIAL });
    assert.equal(await jt.text(), 'JT:https://cdn.jobtread.com/benprog1');
    const site = await get(`item=${encodeURIComponent('img:kids/ava/old-gallery-pick.jpg')}`, { media: SOCIAL });
    assert.match(site.headers.get('Content-Disposition'), /SOARD-Ava-old-gallery-pick\.jpg/);
    assert.match(cf.seen.at(-1), /format=jpeg,metadata=none$/);
    for (const id of ['jt:jtBenBefo01', 'drv:driveAvaBefore01', 'img:kids/ava/plan-1-sheet.jpg', 'jt:jtOddPhot01', 'img:kids/cal/hero']) {
      assert.equal((await get(`item=${encodeURIComponent(id)}`, { media: SOCIAL })).status, 404, id);
    }
    assert.equal((await get('item=yt:AvaRevealYT')).status, 500, 'YouTube says to open it there');
    assert.equal(itemFileName({ id: 'img:kids/ava/1795442629265-FINAL-31.HEIC', source: 'site', name: '1795442629265-FINAL-31.HEIC', album_name: 'Remi & Lee' }), 'SOARD-Remi-and-Lee-FINAL-31.jpg');
  } finally { cf.restore(); }
});

test('a ZIP of photos picked across albums and sources: a folder each, written as it arrives, the note, nothing it may not have', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    await indexAll(env);
    const form = new FormData();
    form.set('items', ['drv:driveAvaReveal01', 'jt:jtBenProg01', 'img:kids/ava/old-gallery-pick.jpg', 'jt:jtBenBefo01', `vid:${UID('a')}`, 'img:applications/form/f1-abc'].join('\n'));
    const res = await dlPost({ env, waitUntil: () => {}, data: { userEmail: SOCIAL.email, mediaOnly: SOCIAL }, request: new Request('https://admin.test/api/media-download', { method: 'POST', body: form }) });
    assert.equal(res.headers.get('Content-Type'), 'application/zip');
    const buf = Buffer.from(await res.arrayBuffer());
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let end = buf.length - 22;
    while (v.getUint32(end, true) !== 0x06054B50) end--;
    const names = [];
    for (let n = 0, at = v.getUint32(end + 16, true); n < v.getUint16(end + 10, true); n++) {
      const len = v.getUint16(at + 28, true);
      names.push(buf.subarray(at + 46, at + 46 + len).toString('utf8'));
      at += 46 + len + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    }
    assert.deepEqual(names, ['Ava/SOARD-Ava-DSC_0151.JPG', 'Ben/SOARD-Ben-CompanyCam 2101160340', 'Ava/SOARD-Ava-old-gallery-pick.jpg', 'About these photos.txt']);
    const log = (await env.DB.prepare("SELECT user_email, entity_name FROM audit_log WHERE entity_type = 'media'").all()).results;
    assert.equal(log[0].user_email, SOCIAL.email);
    assert.match(log[0].entity_name, /ZIP of 3 photos/);
  } finally { cf.restore(); }
});

test('a Drive photo’s picture: only for someone who may see it, from Drive’s own thumbnail at the size asked', async () => {
  const env = await world();
  const cf = fakeWorld();
  try {
    await indexAll(env);
    const ok = await thumbGet(ctxOf(env, 'id=drv:driveAvaReveal01&s=480', { media: SOCIAL }));
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /=s480$/);
    assert.equal((await thumbGet(ctxOf(env, 'id=drv:driveAvaBefore01&s=480', { media: SOCIAL }))).status, 404);
    assert.equal((await thumbGet(ctxOf(env, 'id=drv:driveAvaBefore01&s=480'))).status, 200, 'staff');
    assert.equal((await thumbGet(ctxOf(env, 'id=img:x&s=480'))).status, 404);
  } finally { cf.restore(); }
});

// ─── Signing in ────────────────────────────────────────────────────

const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function jwtFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

test('the sign-in for Photos & Videos only: its routes and no others, whatever the address; Access is told who', async () => {
  const env = await world();
  Object.assign(env, { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await addPerson(env.DB, { email: SOCIAL.email, name: SOCIAL.name });
  await addPerson(env.DB, { email: 'intern@soardcharity.com', name: 'Intern' });
  forgetPeople();
  _resetKeyCacheForTests();
  globalThis.fetch = async (input) => (String(input) === `${ISS}/cdn-cgi/access/certs` ? Response.json({ keys: [jwk] }) : new Response('offline', { status: 503 }));
  try {
    const call = async (email, path) => {
      const request = new Request(`https://sunshineonaranneyday.com${path}`, { headers: { 'CF-Access-JWT-Assertion': await jwtFor(email) } });
      const ctx = { request, env, data: {}, waitUntil: () => {} };
      ctx.next = async () => Response.json({ reached: path, media: ctx.data.mediaOnly?.email || null });
      const res = await onRequest(ctx);
      return { status: res.status, body: await res.json() };
    };
    const outside = await call(SOCIAL.email, '/api/media-admin');
    assert.deepEqual(outside, { status: 200, body: { reached: '/api/media-admin', media: SOCIAL.email } });
    for (const path of ['/api/list-content', '/api/save-content', '/api/donors-admin', '/api/board-portal']) {
      const r = await call(SOCIAL.email, path);
      assert.equal(r.status, 403, path);
      assert.equal(r.body.media, '/admin/media/');
    }
    // A soardcharity.com address on the list is held to the same
    assert.equal((await call('intern@soardcharity.com', '/api/media-download')).status, 200);
    assert.equal((await call('intern@soardcharity.com', '/api/list-content')).status, 403);
    // Staff not on it are untouched
    assert.equal((await call('pat@soardcharity.com', '/api/list-content')).status, 200);
    // Someone on no list reaches nothing
    assert.equal((await call('stranger@example.com', '/api/media-admin')).status, 403);
    // The admin-only branches of public pages never count them as staff
    const req = async (email) => new Request('https://sunshineonaranneyday.com/live/', { headers: { 'CF-Access-JWT-Assertion': await jwtFor(email) } });
    assert.equal(await isAuthenticated(await req('intern@soardcharity.com'), env), false);
    assert.equal(await isAuthenticated(await req('pat@soardcharity.com'), env), true);
    // Access's list: the outside address, never a staff one (staff sign in already)
    const { emails } = await everyoneSignIns(env.DB);
    assert.deepEqual(emails, [SOCIAL.email]);
  } finally { globalThis.fetch = realFetch; forgetPeople(); }
});
