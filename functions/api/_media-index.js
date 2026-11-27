/**
 * Every photo and video SOARD has, in one index (Admin → Photos & Videos)
 * ===========================================================================
 * Peter, Nov 26 2026: "include all photos and vidoes that we have now?", then
 * of what the social media sign-in sees: "option 1" (everything; before photos
 * only after the address check the website uses; kids not public yet staff
 * only), "can this also show the JT photos too?".
 *
 * One row per photo or video in D1 (media_items), from six places:
 *   site      every image uploaded to the website (Cloudflare Images)
 *   stream    every video in Cloudflare Stream
 *   drive     the archive: every photo and video in the shared Drive
 *             "Sunshine - Photos & Video" (the past makeovers' folders and
 *             everything else in it)
 *   jobtread  the photos and videos on each job (never a customer's: a family
 *             being vetted; never a daily log's or a document's)
 *   youtube   the channel's uploads (links: YouTube doesn't hand out files)
 * Each row says its album (the kid, event or project it belongs to, or a
 * library folder), its stage (Before, During, After) and its gate for the
 * people who sign in for Photos & Videos only:
 *   open      they see it (once its album is public)
 *   check     a Before or unsorted archive or JobTread photo: they see it only
 *             once the address check (./_photo-screen.js, the website's own)
 *             has passed it (./_media-describe.js)
 *   staff     never: a before photo the website keeps off a page or hasn't
 *             looked at, a drawing (plans carry the address), a Before or
 *             unsorted video, a folder about home visits or applications, a
 *             job no page is matched to
 * Never in the index at all: families' application files and videos, advisory
 * applicants' photos, the anniversary book's pages, board papers, rehearsal
 * recordings.
 *
 * Kept by the heartbeat (maybeRunMediaIndex, a turn a minute): the website's
 * images, Stream and YouTube are read whole in one turn every couple of hours;
 * the Drive and JobTread a page or a few jobs a turn, every day or so. A row
 * is written only when something about it changed; one that's gone from its
 * place is removed after the pass that missed it.
 */

import { kidAlbum, eventAlbum, communityAlbum, addedAt, streamUidOf } from '../../public/admin/media-shared.js';
import { cfIdOf } from '../../public/admin/site-config-shared.js';
import { driveToken, PHOTOS_DRIVE, HOLDING, stageFor } from './_past-photos.js';
import { pave } from './_jt-access.js';
import { SOARD_ORG_ID, matchProject } from './_reveals.js';
import { ytGet, channelRef } from './_youtube.js';

const iso = (t = Date.now()) => new Date(t).toISOString();
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

// ─── Schema ─────────────────────────────────────────────────────────

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS media_items (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL, album TEXT, album_name TEXT,
    name TEXT, path TEXT, stage TEXT, taken_at TEXT, added_at TEXT,
    size INTEGER, width INTEGER, height INTEGER, seconds REAL, mime TEXT, ref TEXT, title TEXT,
    alt TEXT, description TEXT, tags TEXT, base TEXT, words TEXT, gate TEXT NOT NULL DEFAULT 'open', why TEXT,
    check_state TEXT, check_why TEXT, described_at TEXT, checked_at TEXT, tries INTEGER NOT NULL DEFAULT 0, extra TEXT,
    prio INTEGER NOT NULL DEFAULT 5, hash TEXT, seen TEXT, updated_at TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS media_items_album ON media_items (album)',
  'CREATE INDEX IF NOT EXISTS media_items_source ON media_items (source, seen)',
  'CREATE INDEX IF NOT EXISTS media_items_todo ON media_items (described_at, prio)',
  'CREATE TABLE IF NOT EXISTS media_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];
const _ready = new WeakSet();
export async function ensureMediaIndex(DB) {
  if (_ready.has(DB)) return;
  await DB.batch(SCHEMA.map((s) => DB.prepare(s)));
  _ready.add(DB);
}
export async function getState(DB, key) {
  const row = await DB.prepare('SELECT value FROM media_state WHERE key = ?').bind(key).first().catch(() => null);
  return row ? parse(row.value) : null;
}
export const setState = (DB, key, value) => DB.prepare('INSERT OR REPLACE INTO media_state (key, value) VALUES (?, ?)').bind(key, JSON.stringify(value)).run();

// ─── Words ──────────────────────────────────────────────────────────

/** Lowercase, accents off, & as "and", apostrophes closed up, everything else a space: what search compares */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // (a possessive is its word: "Ava’s room" is Ava's)
    .replace(/['’‘`]s\b/g, '')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
/** A file name's words worth searching: IMG_4821.HEIC and CompanyCam 2101160340 say nothing */
const NOISE = /^(img|dsc|dscn|dscf|pxl|mvimg|vid|mov|final|photo|photos|image|copy|edited|edit|companycam|screenshot|untitled|jpe?g|png|heic|heif|mp4|mov|raw|dng|cr2|nef|arw|\d+|[a-f0-9]{12,})$/;
export const nameWords = (name) => norm(String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '')).split(' ').filter((w) => w.length > 1 && !NOISE.test(w)).join(' ');

const SOURCE_WORDS = { site: 'website', stream: 'video', drive: 'archive drive', jobtread: 'jobtread', youtube: 'youtube video', inbox: 'sent in team' };
/** The words a row is found by, before any AI description: its album, its stage and where it is */
export function baseWords(item, album = null) {
  const year = (s) => (String(s || '').match(/^(\d{4})/) || [])[1] || '';
  return norm([
    album?.name, album?.year, ...(album?.rooms || []), album?.photographer, album?.kindWord,
    item.title, item.alt, nameWords(item.name), item.path, item.stage, item.stage === 'During' ? 'construction progress' : '',
    year(item.taken_at), SOURCE_WORDS[item.source], item.kind,
  ].filter(Boolean).join(' '));
}

// ─── What's private ─────────────────────────────────────────────────

/** Image library folders that are never the social media's: applications, applicants, the book, board papers */
const PRIVATE_IMAGE = /^(applications|advisory-applications|book|books|board|financials|vendor|vendors|w9|checks|receipts)\//i;
/** Folder names in the Drive that are never theirs: a home visit, an application, a family's papers */
const PRIVATE_FOLDER = /\b(home ?visits?|applications?|applicants?|vetting|private|personal|medical|family docs|documents|paperwork|w-?9|insurance)\b/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|3gp|wmv)$/i;
const PHOTO_EXT = /\.(jpe?g|png|heic|heif|gif|webp|tiff?|bmp|dng|arw|cr2|cr3|nef|orf|raf|rw2)$/i;
export const kindOf = (mime, name) => (/^video\//.test(mime || '') || VIDEO_EXT.test(name || '') ? 'video' : /^image\//.test(mime || '') || PHOTO_EXT.test(name || '') ? 'photo' : null);
/** A drawing or plan set: the family's address is on the title block */
const PLANISH = /(^|[/_-])(plans?|sheet|notitle|floor-?plan|elevation|layout|drawing|board)([/_.-]|$)/i;

/** Stage from a JobTread file's tags (Before, During, After; the old .BeforePics counts as Before) */
export function stageOfTags(tags = []) {
  const names = tags.map((t) => String(t?.name || t || '').toLowerCase());
  if (names.some((n) => /^\.?before|beforepics/.test(n))) return 'Before';
  if (names.some((n) => /^during|progress/.test(n))) return 'During';
  if (names.some((n) => /^after|reveal/.test(n))) return 'After';
  return null;
}

/** The gate for a photo or video by its stage: After and During are open; a Before or unsorted photo waits for the check */
export const gateByStage = (kind, stage) => (stage === 'After' || stage === 'During' ? 'open' : kind === 'photo' ? 'check' : 'staff');

// ─── The records: albums and what each page shows ───────────────────

const LIB_NAMES = {
  'lib:team': 'Team and board', 'lib:logos': 'Partner and press logos', 'lib:brand': 'Brand and website',
  'lib:live': 'Live broadcast graphics', 'lib:videos': 'Other videos', 'lib:youtube': 'YouTube', 'lib:other': 'Other website images',
  'lib:kids': 'Kids without a page', 'lib:events': 'Event images', 'lib:community': 'Community images', 'lib:inbox': 'Sent in by the team',
};
export const libName = (key) => LIB_NAMES[key] || (key.startsWith('lib:gallery-') ? `${key.slice(12).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())} photos`
  : key.startsWith('drive:') ? key.slice(6) : key.startsWith('lib:') ? key.slice(4).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) : key);

/**
 * What every source is matched against, read once a turn: kids, events and projects (drafts too: staff see them),
 * each one's album as the website shows it, the live reveals, the Stream videos the pages name, the past makeovers'
 * Drive folders.
 */
export async function loadContext(DB) {
  const rows = async (sql) => { try { return (await DB.prepare(sql).all()).results || []; } catch { return []; } };
  const [kidRows, eventRows, projectRows, bcRows, pastRows] = await Promise.all([
    rows('SELECT slug, data FROM kids'), rows('SELECT slug, data FROM events'), rows('SELECT slug, data FROM community'),
    rows('SELECT id, kid_slug, kid_name, live_at, ended_at, live_video_uid, replay_uid, fb_permalink, data FROM broadcasts WHERE live_at IS NOT NULL'),
    rows("SELECT key, kind, slug, folder, close_on, close_how, job_id, made_by FROM past_jobs"),
  ]);
  const { broadcastOf } = await import('./_media.js');
  const broadcasts = bcRows.map(broadcastOf).filter((b) => !b.test);
  const albums = new Map();      // key → { name, year, rooms, photographer, public, kindWord }
  const curated = new Map();     // cf id → { album, role, alt }
  const streamRef = new Map();   // uid → album
  const add = (rec, album, isPublic, kindWord) => {
    if (!album) return;
    albums.set(album.key, { key: album.key, kind: album.kind, slug: album.slug, name: album.name, year: album.year, rooms: album.rooms, photographer: album.photographer, public: isPublic, kindWord,
      finished: album.kind !== 'event' && (rec.status || 'completed') === 'completed' });
    for (const f of album.files) if (!curated.has(f.id)) curated.set(f.id, { album: album.key, role: f.role, alt: f.alt });
    for (const v of album.videos) if (v.uid) streamRef.set(v.uid, album.key);
  };
  const kids = kidRows.map((r) => ({ ...parse(r.data), slug: r.slug }));
  for (const k of kids) add(k, kidAlbum({ ...k, publishStatus: 'published' }, { broadcasts }), k.publishStatus !== 'draft', 'reveal makeover');
  for (const r of eventRows) { const e = { ...parse(r.data), slug: r.slug }; add(e, eventAlbum({ ...e, status: e.status === 'cancelled' ? 'past' : e.status }), e.status !== 'cancelled', 'event'); }
  for (const r of projectRows) { const p = { ...parse(r.data), slug: r.slug }; add(p, communityAlbum({ ...p, publishStatus: 'published' }), p.publishStatus !== 'draft', 'community project'); }
  // A live reveal's recording and its Reel clip belong to the kid, even before the page names them
  for (const b of broadcasts) {
    for (const uid of [b.replayUid, b.reel?.clipUid].map(streamUidOf).filter(Boolean)) if (!streamRef.has(uid) && albums.has(`kid:${b.kidSlug}`)) streamRef.set(uid, `kid:${b.kidSlug}`);
  }
  const plans = new Set();
  for (const k of kids) for (const p of k.plans || []) { const id = cfIdOf(p?.url); if (id) plans.add(id); }
  const records = [
    ...kids.map((k) => ({ kind: 'kid', slug: k.slug, name: k.name, year: k.year, status: k.status, jobtreadJobId: k.jobtreadJobId || null })),
    ...projectRows.map((r) => { const p = parse(r.data); return { kind: 'community', slug: r.slug, name: p.name, year: p.year, status: p.status || 'completed', jobtreadJobId: p.jobtreadJobId || null }; }),
  ];
  const past = new Map(pastRows.filter((r) => r.folder).map((r) => [r.folder, r]));
  const pastJobs = new Set(pastRows.filter((r) => r.job_id).map((r) => r.job_id));
  const eventOfGallery = new Map();
  for (const r of eventRows) { const e = parse(r.data); for (const p of e.photos || []) if (/^gallery\//.test(p.id || '')) eventOfGallery.set(p.id, `event:${r.slug}`); }
  return { albums, curated, streamRef, plans, records, kids, past, pastJobs, broadcasts, eventOfGallery };
}

const albumOfKey = (ctx, key) => ctx.albums.get(key) || (key ? { key, name: libName(key), public: !/^jt:/.test(key) } : null);

// ─── The website's images ───────────────────────────────────────────

/** A website image's album and gate, or null for one that's never in the index (private folders, the book) */
export function siteItem(img, ctx) {
  const id = String(img.id || '');
  if (!id || PRIVATE_IMAGE.test(id)) return null;
  const parts = id.split('/');
  const top = parts.length > 1 ? parts[0] : '';
  const shown = ctx.curated.get(id);
  let album = shown?.album || null;
  let gate = 'open';
  let why = null;
  if (!album) {
    if (top === 'kids' && ctx.albums.has(`kid:${parts[1]}`)) album = `kid:${parts[1]}`;
    else if (top === 'events' && ctx.albums.has(`event:${parts[1]}`)) album = `event:${parts[1]}`;
    else if (top === 'community' && ctx.albums.has(`community:${parts[1]}`)) album = `community:${parts[1]}`;
    else if (top === 'gallery') album = ctx.eventOfGallery.get(id) || `lib:gallery-${parts[1] || 'other'}`;
    else if (top === 'team') album = 'lib:team';
    else if (['partners', 'community-partners', 'press', 'medialogos', 'logos'].includes(top)) album = 'lib:logos';
    else if (/^(brand|our-story|badges|site|articles|og|home|about)/.test(top) || /^brand-/.test(id)) album = 'lib:brand';
    else if (top === 'live') album = 'lib:live';
    else if (['kids', 'events', 'community'].includes(top)) album = `lib:${top}`;
    else album = top ? `lib:${top}` : 'lib:other';
    // Not on its page: a before photo the page kept off or hasn't looked at, or a drawing, is staff's only
    const file = parts[parts.length - 1] || '';
    if (/^(ba-)?before-/i.test(file)) { gate = 'staff'; why = 'A before photo the website keeps off its page'; }
    else if (ctx.plans.has(id) || (top === 'kids' && PLANISH.test(file))) { gate = 'staff'; why = 'A drawing: plans carry the family’s address'; }
  }
  const at = addedAt(id);
  return {
    id: `img:${id}`, source: 'site', kind: 'photo', album, name: img.filename || parts[parts.length - 1], path: top || null,
    // (a finished makeover's page photos are its reveal's: After; a kid's still being built, the family's portraits: none)
    stage: shown?.role === 'pair-before' || shown?.role === 'before' ? 'Before' : shown?.role === 'pair-after' || (shown?.role === 'photo' && ctx.albums.get(shown.album)?.finished) ? 'After' : null,
    taken_at: null, added_at: img.uploaded || (at ? iso(at) : null), size: null, width: null, height: null, seconds: null, mime: 'image/jpeg',
    ref: null, title: null, alt: shown?.alt || null, gate, why, prio: shown ? (shown.alt ? 9 : 1) : 4,
  };
}

/** Every image in Cloudflare Images (10,000 a page) */
export async function listSiteImages(env, fetchImpl = fetch) {
  const out = [];
  let token = '';
  for (let i = 0; i < 12; i++) {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/images/v2?per_page=10000${token ? `&continuation_token=${encodeURIComponent(token)}` : ''}`, {
      headers: { Authorization: `Bearer ${env.CF_IMAGES_TOKEN}` }, signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) throw new Error(`Cloudflare Images: ${j.errors?.[0]?.message || res.status}`);
    for (const img of j.result?.images || []) out.push({ id: img.id, uploaded: img.meta?.firstUploaded || img.uploaded || null, filename: img.filename || null });
    token = j.result?.continuation_token || '';
    if (!token) return out;
  }
  throw new Error('Cloudflare Images: more than 120,000 images');
}

// ─── Stream ─────────────────────────────────────────────────────────

/** A Stream video that's never the social media's: a family's application, a rehearsal, one still live or broken */
export function streamPrivate(v, { rehearsalInput = null } = {}) {
  const name = String(v?.meta?.name || '');
  // (a video the team sent in is the inbox's own row, ./_media-inbox.js: never listed again from Stream)
  return !!(v?.meta?.inbox || v?.meta?.application || /\bapplication\b/i.test(name) || v?.requireSignedURLs || /^test\b|rehearsal/i.test(name)
    || (rehearsalInput && v?.liveInput === rehearsalInput) || v?.status?.state === 'live-inprogress' || v?.isInput);
}

/** The kid a video's name says ("Auto-archived FB live: Max's room reveal (2026-11-20)"), when only one kid fits */
function kidByTitle(ctx, title, date = '') {
  const t = ` ${norm(title)} `;
  const year = Number((String(date).match(/^(\d{4})/) || [])[1]) || Number((String(title).match(/\b(20\d\d)\b/) || [])[1]) || null;
  const hits = ctx.kids.filter((k) => {
    const n = norm(k.name);
    return n && t.includes(` ${n} `) && (!year || !k.year || Math.abs(Number(k.year) - year) <= 1);
  });
  return hits.length === 1 ? `kid:${hits[0].slug}` : null;
}

export function streamItem(v, ctx) {
  const uid = streamUidOf(v.uid);
  if (!uid) return null;
  const title = String(v.meta?.name || '').trim() || null;
  const album = ctx.streamRef.get(uid) || kidByTitle(ctx, title, v.created) || 'lib:videos';
  return {
    id: `vid:${uid}`, source: 'stream', kind: 'video', album, name: title, path: null, stage: 'After',
    taken_at: null, added_at: v.created || null, size: Number(v.size) || null, width: Number(v.input?.width) || null, height: Number(v.input?.height) || null,
    seconds: v.duration > 0 ? Math.round(v.duration) : null, mime: 'video/mp4', ref: null, title, alt: null, gate: 'open', why: null, prio: 9,
  };
}

export async function listStreamVideos(env, fetchImpl = fetch) {
  const out = [];
  let end = '';
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: '1000', include_counts: 'false', ...(end ? { end } : {}) });
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream?${qs}`, {
      headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}` }, signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) throw new Error(`Stream: ${j.errors?.[0]?.message || res.status}`);
    const list = j.result || [];
    out.push(...list);
    if (list.length < 1000) return out;
    const last = list[list.length - 1]?.created;
    if (!last || last === end) break;
    end = last;
  }
  return out;
}

// ─── YouTube ────────────────────────────────────────────────────────

const ytSeconds = (d) => { const m = String(d || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; };
export function youtubeItem(v, ctx) {
  const id = v.id;
  if (!/^[\w-]{11}$/.test(String(id || ''))) return null;
  const sn = v.snippet || {};
  const pageOf = ctx.kids.find((k) => String(k.videoUrl || '').includes(id));
  const album = pageOf ? `kid:${pageOf.slug}` : kidByTitle(ctx, sn.title, sn.publishedAt) || 'lib:youtube';
  const isPublic = (v.status?.privacyStatus || 'public') === 'public';
  return {
    id: `yt:${id}`, source: 'youtube', kind: 'video', album, name: sn.title || null, path: null, stage: 'After',
    taken_at: null, added_at: sn.publishedAt || null, size: null, width: null, height: null, seconds: ytSeconds(v.contentDetails?.duration),
    mime: null, ref: `https://www.youtube.com/watch?v=${id}`, title: sn.title || null, alt: String(sn.description || '').slice(0, 400) || null,
    gate: isPublic ? 'open' : 'staff', why: isPublic ? null : `${v.status?.privacyStatus || 'Not public'} on YouTube`, prio: 9,
  };
}

/** The channel's uploads, with their length and whether each is public */
export async function listYouTube(env, channelUrl) {
  const ref = channelRef(channelUrl);
  if (!ref) return [];
  let channelId = ref.id;
  if (!channelId) {
    const r = await ytGet(env, 'channels', { part: 'id', forHandle: ref.handle });
    if (!r.ok) throw new Error(`YouTube: ${r.error}`);
    channelId = r.data.items?.[0]?.id;
  }
  if (!channelId) return [];
  const ids = [];
  let page = '';
  for (let i = 0; i < 40; i++) {
    const r = await ytGet(env, 'playlistItems', { part: 'contentDetails', playlistId: `UU${channelId.slice(2)}`, maxResults: '50', ...(page ? { pageToken: page } : {}) });
    if (!r.ok) throw new Error(`YouTube: ${r.error}`);
    for (const it of r.data.items || []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    page = r.data.nextPageToken || '';
    if (!page) break;
  }
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await ytGet(env, 'videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(',') });
    if (!r.ok) throw new Error(`YouTube: ${r.error}`);
    out.push(...(r.data.items || []));
  }
  return out;
}

// ─── The Drive archive ──────────────────────────────────────────────

const FOLDER = 'application/vnd.google-apps.folder';
const inDrive = `&corpora=drive&driveId=${PHOTOS_DRIVE}&includeItemsFromAllDrives=true&supportsAllDrives=true`;
async function drive(token, path, fetchImpl) {
  const res = await fetchImpl(`https://www.googleapis.com/drive/v3${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}: ${body?.error?.message || ''}`.trim());
  return body;
}
/** Every folder in the shared Drive: id → { name, parent } */
export async function driveFolders(token, fetchImpl = fetch) {
  const out = {};
  let page = '';
  for (let i = 0; i < 50; i++) {
    const q = encodeURIComponent(`mimeType = '${FOLDER}' and trashed = false`);
    const r = await drive(token, `/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,parents)${inDrive}${page ? `&pageToken=${page}` : ''}`, fetchImpl);
    for (const f of r.files || []) out[f.id] = { name: f.name, parent: f.parents?.[0] || null };
    page = r.nextPageToken || '';
    if (!page) break;
  }
  return out;
}
/** A folder's path from the top of the Drive: "_Makeover Photos (to JobTread)/Ava Smith 2024/Reveal" */
export function folderPath(folders, id) {
  const parts = [];
  for (let at = id, n = 0; at && folders[at] && n < 30; at = folders[at].parent, n++) parts.unshift(folders[at].name);
  return parts.join('/');
}
/** One page of the Drive's photos and videos → { files, next } */
export async function driveMediaPage(token, pageToken = '', fetchImpl = fetch) {
  const q = encodeURIComponent(`trashed = false and mimeType != '${FOLDER}' and (mimeType contains 'image/' or mimeType contains 'video/' or mimeType = 'application/octet-stream')`);
  const fields = 'nextPageToken,files(id,name,mimeType,size,parents,createdTime,imageMediaMetadata(time,width,height),videoMediaMetadata(durationMillis,width,height))';
  const r = await drive(token, `/files?q=${q}&pageSize=1000&fields=${encodeURIComponent(fields)}${inDrive}${pageToken ? `&pageToken=${pageToken}` : ''}`, fetchImpl);
  return { files: r.files || [], next: r.nextPageToken || '' };
}
/** Drive's "2014:07:12 15:03:22" camera time as ISO (Eastern), or null */
const exifTime = (t) => { const m = String(t || '').match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/); return m && +m[1] >= 2005 ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-05:00` : null; };

export function driveItem(f, path, ctx) {
  const kind = kindOf(f.mimeType, f.name);
  if (!kind) return null;
  const parts = String(path || '').split('/').filter(Boolean);
  // The past makeovers wait in the holding folder, one folder each (./_past-photos.js): that kid's or project's album
  let album = null;
  let below = path;
  let job = null;
  if (parts[0] === HOLDING && parts[1]) {
    job = ctx.past.get(parts[1]) || null;
    if (job) album = job.kind === 'community' ? `community:${job.slug}` : `kid:${job.slug}`;
    below = parts.slice(2).join('/');
  }
  if (!album) album = parts[0] ? `drive:${parts[0] === HOLDING ? (parts[1] || parts[0]) : parts[0]}` : 'drive:Photos & Video';
  const takenAt = exifTime(f.imageMediaMetadata?.time);
  const stage = stageFor({ path: below, takenAt }, { closeOn: job?.close_on || null, closeHow: job?.close_how || '' }).stage;
  const priv = PRIVATE_FOLDER.test(path || '');
  const gate = priv ? 'staff' : gateByStage(kind, stage);
  return {
    id: `drv:${f.id}`, source: 'drive', kind, album, name: f.name, path: path || null, stage,
    taken_at: takenAt, added_at: f.createdTime || null, size: Number(f.size) || null,
    width: Number(f.imageMediaMetadata?.width || f.videoMediaMetadata?.width) || null, height: Number(f.imageMediaMetadata?.height || f.videoMediaMetadata?.height) || null,
    seconds: f.videoMediaMetadata?.durationMillis ? Math.round(f.videoMediaMetadata.durationMillis / 1000) : null,
    mime: f.mimeType, ref: null, title: null, alt: null, gate,
    why: priv ? 'In a folder about home visits, applications or papers' : gate === 'staff' ? 'A Before or unsorted video' : null,
    prio: gate === 'check' ? 2 : stage === 'After' ? 3 : 5,
  };
}

// ─── JobTread ───────────────────────────────────────────────────────

const SANDBOX_JOB = '22P3HTX9cXn4';
/** Every job (open and closed), named: [{ id, name, closedOn }] */
export async function jtJobs(key, fetchImpl = fetch) {
  const out = [];
  let page = null;
  for (let i = 0; i < 20; i++) {
    const body = await pave(key, { organization: { $: { id: SOARD_ORG_ID }, jobs: { $: { size: 100, ...(page ? { page } : {}) }, nextPage: {}, nodes: { id: {}, name: {}, closedOn: {} } } } }, fetchImpl);
    const conn = body?.organization?.jobs;
    if (!conn) throw new Error('JobTread sent no jobs');
    for (const j of conn.nodes || []) if (j.id !== SANDBOX_JOB && !/^\s*test\b/i.test(j.name || '')) out.push({ id: j.id, name: j.name || '', closedOn: j.closedOn || null });
    page = conn.nextPage || null;
    if (!page) break;
  }
  return out;
}
/** A job's own photos and videos (a daily log's and a document's are shared with others: never) */
export async function jtJobFiles(key, jobId, fetchImpl = fetch) {
  const out = [];
  let page = null;
  for (let i = 0; i < 60; i++) {
    const body = await pave(key, { job: { $: { id: jobId }, f: { _: 'files', $: { size: 50, ...(page ? { page } : {}) }, nextPage: {},
      nodes: { id: {}, name: {}, type: {}, size: {}, createdAt: {}, dailyLog: { id: {} }, document: { id: {} }, url: {}, fileTags: { $: { size: 10 }, nodes: { name: {} } } } } } }, fetchImpl);
    const conn = body?.job?.f;
    if (!conn) throw new Error('JobTread sent no files');
    for (const f of conn.nodes || []) if (!f.dailyLog?.id && !f.document?.id) out.push(f);
    page = conn.nextPage || null;
    if (!page) break;
  }
  return out;
}
/** A JobTread tag that makes a picture staff's only: a receipt (Costs), a drawing (Plans: the address), a family's own (_…) */
const PRIVATE_TAG = /^(costs?|plans?|private)$|^_/i;
export function jtItem(f, job, album, stageGuess = null) {
  const kind = kindOf(f.type, f.name);
  if (!kind || !f.url) return null;
  const tags = (f.fileTags?.nodes || []).map((t) => String(t?.name || ''));
  const stage = stageOfTags(tags) || stageGuess || null;
  const privateTag = tags.find((t) => PRIVATE_TAG.test(t));
  const gate = album.startsWith('jt:') || privateTag ? 'staff' : gateByStage(kind, stage);
  return {
    id: `jt:${f.id}`, source: 'jobtread', kind, album, name: f.name || null, path: job.name || null, stage,
    taken_at: null, added_at: f.createdAt || null, size: Number(f.size) || null, width: null, height: null, seconds: null,
    mime: f.type || null, ref: String(f.url).split('?')[0], title: null, alt: null, gate,
    why: album.startsWith('jt:') ? 'A job no page is matched to'
      : privateTag ? (/^costs?$/i.test(privateTag) ? 'A receipt or cost paper (Costs)' : /^plans?$/i.test(privateTag) ? 'A drawing: plans carry the family’s address' : `Tagged ${privateTag} in JobTread`)
      : gate === 'staff' ? 'A Before or unsorted video' : null,
    prio: gate === 'check' ? 2 : stage === 'After' ? 3 : 5,
  };
}

// ─── Writing ────────────────────────────────────────────────────────

const COLS = ['id', 'source', 'kind', 'album', 'album_name', 'name', 'path', 'stage', 'taken_at', 'added_at', 'size', 'width', 'height', 'seconds', 'mime', 'ref', 'title', 'alt', 'base', 'gate', 'why', 'prio', 'extra'];
/** A short fingerprint of everything a listing says about a row: unchanged rows aren't written again */
export function hashOf(item) {
  const s = COLS.map((c) => item[c] ?? '').join('\u0001');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
/** The row as written: its album's name and the words it's found by */
export function finish(item, ctx) {
  const album = albumOfKey(ctx, item.album);
  const out = { ...item, album_name: album?.name || null };
  out.base = baseWords(item, album);
  return out;
}

/**
 * Write a source's listing: rows that are new or changed (and the words, kept with any AI description), the seen mark
 * on every row when `pass` is given (a listing over several turns). → { wrote, kept }
 */
export async function writeItems(DB, items, { pass = null, now = Date.now() } = {}) {
  if (!items.length) return { wrote: 0, kept: 0 };
  const have = new Map();
  for (let i = 0; i < items.length; i += 90) {
    const ids = items.slice(i, i + 90).map((x) => x.id);
    const r = await DB.prepare(`SELECT id, hash, description, tags FROM media_items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (const row of r.results || []) have.set(row.id, row);
  }
  const stmts = [];
  let wrote = 0;
  const seenIds = [];
  for (const it of items) {
    const hash = hashOf(it);
    const was = have.get(it.id);
    if (was && was.hash === hash) { if (pass) seenIds.push(it.id); continue; }
    wrote++;
    const words = [it.base, norm(was?.description || ''), was?.tags || ''].filter(Boolean).join(' ');
    // An alt text from the page is the description; a photo without one waits for the describer
    const described = it.alt && it.source === 'site' ? iso(now) : null;
    stmts.push(DB.prepare(`INSERT INTO media_items (${COLS.join(', ')}, words, hash, seen, updated_at, described_at) VALUES (${COLS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ${COLS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}, words = excluded.words, hash = excluded.hash, seen = excluded.seen, updated_at = excluded.updated_at,
        described_at = COALESCE(media_items.described_at, excluded.described_at)`)
      .bind(...COLS.map((c) => it[c] ?? null), words, hash, pass, iso(now), described));
  }
  for (let i = 0; i < seenIds.length; i += 90) {
    const ids = seenIds.slice(i, i + 90);
    stmts.push(DB.prepare(`UPDATE media_items SET seen = ? WHERE id IN (${ids.map(() => '?').join(',')})`).bind(pass, ...ids));
  }
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
  return { wrote, kept: items.length - wrote };
}

/** A whole listing read in one turn: what isn't in it any more goes */
async function dropMissing(DB, source, ids) {
  const r = await DB.prepare('SELECT id FROM media_items WHERE source = ?').bind(source).all();
  const keep = new Set(ids);
  const gone = (r.results || []).map((x) => x.id).filter((id) => !keep.has(id));
  for (let i = 0; i < gone.length; i += 90) {
    const ids = gone.slice(i, i + 90);
    await DB.prepare(`DELETE FROM media_items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  }
  return gone.length;
}

// ─── The turns ──────────────────────────────────────────────────────

const HOUR = 3600e3;
export const EVERY = { site: 2 * HOUR, stream: 2 * HOUR, youtube: 12 * HOUR, drive: 24 * HOUR, jobtread: 12 * HOUR };
const TURN_MS = 60e3;
const JOBS_A_TURN = 4;

/** Whose turn it is: the source that's been waiting longest past its time, among those that can be read */
export function nextSource(env, state, now = Date.now()) {
  const can = {
    site: !!(env.CF_ACCOUNT_ID && env.CF_IMAGES_TOKEN),
    stream: !!(env.CF_ACCOUNT_ID && env.CF_STREAM_TOKEN),
    youtube: !!(env.YOUTUBE_API_KEY || env.YOUTUBE_CLIENT_ID),
    drive: !!env.GOOGLE_CALENDAR_KEY,
    jobtread: !!env.JOBTREAD_GRANT_KEY,
  };
  let best = null;
  for (const s of Object.keys(EVERY)) {
    if (!can[s]) continue;
    const st = state?.[s] || {};
    // (a listing part way through goes on at once)
    const due = st.cursor != null ? 0 : (Date.parse(st.doneAt || 0) || 0) + EVERY[s] - now;
    if (due > 0) continue;
    if (!best || due < best.due) best = { source: s, due };
  }
  return best?.source || null;
}

/** One step of one source's listing → a note for Automations */
export async function indexStep(env, source, st, ctx, { fetchImpl = fetch, now = Date.now(), deadline = now + 20000 } = {}) {
  const { DB } = env;
  if (source === 'site') {
    const imgs = await listSiteImages(env, fetchImpl);
    const items = imgs.map((i) => siteItem(i, ctx)).filter(Boolean).map((i) => finish(i, ctx));
    const w = await writeItems(DB, items, { now });
    const gone = await dropMissing(DB, 'site', items.map((i) => i.id));
    return { done: true, note: `${items.length} website images (${w.wrote} new or changed, ${gone} gone)` };
  }
  if (source === 'stream') {
    const config = parse((await DB.prepare("SELECT data FROM site_config WHERE key = 'broadcast-config'").first().catch(() => null))?.data);
    const vids = await listStreamVideos(env, fetchImpl);
    const items = vids.filter((v) => !streamPrivate(v, { rehearsalInput: config.rehearsalInput?.uid })).map((v) => streamItem(v, ctx)).filter(Boolean).map((i) => finish(i, ctx));
    const w = await writeItems(DB, items, { now });
    const gone = await dropMissing(DB, 'stream', items.map((i) => i.id));
    return { done: true, note: `${items.length} Stream videos (${w.wrote} new or changed, ${gone} gone; ${vids.length - items.length} private left out)` };
  }
  if (source === 'youtube') {
    const config = parse((await DB.prepare("SELECT data FROM site_config WHERE key = 'broadcast-config'").first().catch(() => null))?.data);
    const vids = await listYouTube(env, config.youtube?.channelUrl);
    const items = vids.map((v) => youtubeItem(v, ctx)).filter(Boolean).map((i) => finish(i, ctx));
    const w = await writeItems(DB, items, { now });
    const gone = await dropMissing(DB, 'youtube', items.map((i) => i.id));
    return { done: true, note: `${items.length} YouTube videos (${w.wrote} new or changed, ${gone} gone)` };
  }
  if (source === 'drive') {
    // A pass: the folders first (their paths), then the photos and videos a page at a time; at the end, what wasn't seen goes
    const pass = st.pass || `drive-${now}`;
    const token = await driveToken(env, { fetchImpl, now });
    let folders = st.cursor && st.pass ? await getState(DB, 'drive-folders') : null;
    if (!folders) { folders = await driveFolders(token, fetchImpl); await setState(DB, 'drive-folders', folders); }
    let cursor = st.cursor || '';
    let count = st.count || 0;
    do {
      const { files, next } = await driveMediaPage(token, cursor === 'start' ? '' : cursor, fetchImpl);
      const items = files.map((f) => driveItem(f, folderPath(folders, f.parents?.[0]), ctx)).filter(Boolean).map((i) => finish(i, ctx));
      await writeItems(DB, items, { pass, now });
      count += items.length;
      cursor = next;
    } while (cursor && Date.now() < deadline - 8000);
    if (cursor) return { done: false, cursor, pass, count, note: `Drive: ${count} so far` };
    const r = await DB.prepare("DELETE FROM media_items WHERE source = 'drive' AND (seen IS NULL OR seen <> ?)").bind(pass).run();
    return { done: true, note: `${count} Drive photos and videos (${r?.meta?.changes || 0} gone)` };
  }
  if (source === 'jobtread') {
    const pass = st.pass || `jt-${now}`;
    const key = env.JOBTREAD_GRANT_KEY;
    let jobs = st.cursor != null && st.pass ? await getState(DB, 'jt-jobs') : null;
    if (!jobs) {
      // The past makeovers' jobs hold the Drive's photos (copied there): the archive already has them
      jobs = (await jtJobs(key, fetchImpl)).filter((j) => !ctx.pastJobs.has(j.id));
      await setState(DB, 'jt-jobs', jobs);
    }
    let i = Number(st.cursor || 0);
    let count = st.count || 0;
    for (let n = 0; i < jobs.length && n < JOBS_A_TURN && Date.now() < deadline - 6000; n++, i++) {
      const job = jobs[i];
      const rec = matchProject(job.name, ctx.records, job.id);
      const album = rec ? (rec.kind === 'community' ? `community:${rec.slug}` : `kid:${rec.slug}`) : `jt:${job.id}`;
      if (!rec) ctx.albums.set(album, { key: album, name: job.name, public: false, kindWord: 'jobtread job' });
      const stages = new Map(((await DB.prepare('SELECT file_id, stage FROM photo_stages WHERE job_id = ?').bind(job.id).all().catch(() => null))?.results || []).map((r) => [r.file_id, r.stage]));
      const files = await jtJobFiles(key, job.id, fetchImpl);
      const items = files.map((f) => jtItem(f, job, album, ['Before', 'During', 'After'].includes(stages.get(f.id)) ? stages.get(f.id) : null)).filter(Boolean).map((it) => finish(it, ctx));
      await writeItems(DB, items, { pass, now });
      count += items.length;
    }
    if (i < jobs.length) return { done: false, cursor: i, pass, count, note: `JobTread: ${i} of ${jobs.length} jobs` };
    const r = await DB.prepare("DELETE FROM media_items WHERE source = 'jobtread' AND (seen IS NULL OR seen <> ?)").bind(pass).run();
    return { done: true, note: `${count} JobTread photos and videos on ${jobs.length} jobs (${r?.meta?.changes || 0} gone)` };
  }
  return { done: true, note: 'nothing to do' };
}

/**
 * The heartbeat's turn (once a minute at most, whoever asks): one source's step, then the describer and the address
 * check with what time is left (./_media-describe.js). Never throws.
 */
export async function maybeRunMediaIndex(env, { fetchImpl = fetch, now = Date.now(), deadline = now + 25000, describe = null, vocab = null } = {}) {
  const { DB } = env;
  if (!DB) return null;
  try {
    await ensureMediaIndex(DB);
    const next = String(now + TURN_MS);
    const ins = await DB.prepare("INSERT OR IGNORE INTO media_state (key, value) VALUES ('turn', ?)").bind(next).run();
    if (!ins?.meta?.changes) {
      const upd = await DB.prepare("UPDATE media_state SET value = ? WHERE key = 'turn' AND CAST(value AS INTEGER) <= ?").bind(next, now).run();
      if (!upd?.meta?.changes) return null;
    }
    const state = (await getState(DB, 'sources')) || {};
    const source = nextSource(env, state, now);
    let ran = null;
    if (source) {
      const st = state[source] || {};
      try {
        const ctx = await loadContext(DB);
        const r = await indexStep(env, source, st, ctx, { fetchImpl, now, deadline });
        state[source] = r.done
          ? { doneAt: iso(now), note: r.note, error: null, cursor: null, pass: null, count: 0 }
          : { ...st, cursor: r.cursor, pass: r.pass, count: r.count, note: r.note, error: null, stepAt: iso(now) };
        ran = { source, ...r };
      } catch (e) {
        // A failed listing waits its full time before the next try, and says why on Automations
        state[source] = { ...st, doneAt: iso(now), cursor: null, pass: null, error: String(e.message || e).slice(0, 300), failedAt: iso(now) };
        ran = { source, error: e.message };
      }
      await setState(DB, 'sources', state);
    }
    const described = describe && Date.now() < deadline - 4000 ? await describe(env, { fetchImpl, deadline }).catch((e) => ({ error: e.message })) : null;
    // The typo fixer's word list, rebuilt twice a day, a slice a turn (./_media-search.js buildVocab)
    let words = null;
    if (vocab && Date.now() < deadline - 3000) {
      const vb = (await getState(DB, 'vocab-build')) || {};
      if (vb.offset > 0 || !vb.doneAt || now - Date.parse(vb.doneAt) > 12 * HOUR) words = await vocab(DB, { deadline: deadline - 2000 }).catch((e) => ({ error: e.message }));
    }
    if (described || words) await setState(DB, 'lastTurn', { at: iso(now), ran: ran ? { source: ran.source, note: ran.note || null, error: ran.error || null } : null, described, words });
    return { ran, described, words };
  } catch (e) {
    return { error: e.message };
  }
}

/** For Photos & Videos and Automations: how many of each, how far the describing has got, each source's last word */
export async function indexFacts(DB) {
  await ensureMediaIndex(DB);
  const [counts, todo, sources] = await Promise.all([
    DB.prepare('SELECT source, kind, COUNT(*) AS n FROM media_items GROUP BY source, kind').all(),
    DB.prepare("SELECT SUM(CASE WHEN kind = 'photo' AND described_at IS NULL THEN 1 ELSE 0 END) AS undescribed, SUM(CASE WHEN gate = 'check' AND check_state IS NULL THEN 1 ELSE 0 END) AS unchecked, SUM(CASE WHEN gate = 'check' AND check_state = 'held' THEN 1 ELSE 0 END) AS held FROM media_items").first(),
    getState(DB, 'sources'),
  ]);
  const by = {};
  for (const r of counts.results || []) { by[r.source] ||= { photo: 0, video: 0 }; by[r.source][r.kind] = r.n; }
  return { counts: by, undescribed: todo?.undescribed || 0, unchecked: todo?.unchecked || 0, held: todo?.held || 0, sources: sources || {} };
}
