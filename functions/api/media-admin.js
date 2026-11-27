/**
 * /api/media-admin (Cloudflare Access) — Admin → Photos & Videos
 * ===========================================================================
 * Staff, and the people who sign in for Photos & Videos only (./_media-people.js:
 * the middleware lets them reach this, ./media-download.js and ./media-thumb.js,
 * nothing else, and marks them context.data.mediaOnly). What they see is
 * narrower (./_media-search.js VISIBLE_SQL): public albums only, and the
 * archive's and JobTread's Before photos once the address check passed them.
 *
 * GET ?me=1                         → { ok, me: { email, role: 'staff' | 'media', name } } (where the admin sends them)
 * GET                               → the home: { me, activity, albums, totals, facts?, people?, access? }
 *                                     albums: every kid, event and project (staff: drafts too) and every library
 *                                     folder, with counts from every source and a cover; activity: What's happening
 * GET ?album=<key>                  → one album: what its page shows (files, videos, caption, credit) and everything else
 *                                     the index has for it, by source: { album, sections: { site, drive, jobtread, videos } }
 * GET ?search=<words>&kind&stage&source&year&album&sort&offset → ./_media-search.js search()
 * GET ?album=<key>&mp4=<video key>  → { ok, ready, percent } Stream makes a video's MP4 on the first ask
 * GET ?item=<vid:uid>&mp4=1         → the same for a Stream video found by search
 * GET ?videos=<uid>,…               → { ok, videos, complete } lengths from Stream (older pages; the index has them now)
 * POST { act: 'add-person', email, name } / { act: 'remove-person', email }   staff only: who signs in for Photos &
 *                                     Videos only; Cloudflare Access is told at once (./_board-access.js)
 * GET ?inbox=1                      → staff only: Send photos: { address, number, text, replies, wording, senders, messages }
 * POST { act: 'add-sender', name, email, phone } / { act: 'remove-sender', id }   who can email or text photos in
 *      { act: 'let-through', id } / { act: 'delete-message', id }               a message from someone not on the list
 *      { act: 'move', ids, album }                                             sent-in files to another album
 *      { act: 'setup-text-number' }                                            SOARD Photos' own number (Twilio; costs a month)
 *      { act: 'replies', on }                                                  answer each sender (once Peter has approved the words)
 */

import { loadBroadcasts, loadReveals, loadAlbum, loadAllAlbums, albumVideo } from './_media.js';
import { buildActivity, isUid, RECENT_DAYS } from '../../public/admin/media-shared.js';
import { search, albumItems, albumCounts, itemFor, itemOut, VISIBLE_SQL } from './_media-search.js';
import { indexFacts, ensureMediaIndex, libName } from './_media-index.js';
import { listPeople, addPerson, removePerson, sawPerson, MEDIA_PAGE } from './_media-people.js';
import { syncBoardAccess, accessStatus } from './_board-access.js';
import { logAudit } from './_audit.js';
import { ADDRESS, INBOX_ALBUM, readSettings, writeSettings, listSenders, addSender, removeSender, listMessages, letThrough, moveItems, deleteMessage, setupTextNumber, textNumberStatus, replyText } from './_media-inbox.js';
import * as stream from './_stream-live.js';

const fail = (error, status = 400) => Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
const ok = (body) => Response.json({ ok: true, ...body }, { headers: { 'Cache-Control': 'no-store' } });
const roleOf = (context) => (context.data?.mediaOnly ? 'media' : 'staff');

const PAGE = 1000;
/** Length and size of the videos asked for, from a look through the whole Stream library, newest first */
export async function videoFacts(env, uids, fetchImpl = fetch) {
  const want = new Set(uids);
  const videos = {};
  if (!want.size || !stream.streamConfigured(env)) return { videos, complete: false };
  let end = '';
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: String(PAGE), include_counts: 'false', ...(end ? { end } : {}) });
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream?${qs}`, {
      headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}` }, signal: AbortSignal.timeout(12000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(stream.errorMessage({ status: res.status, errors: data.errors }));
    const list = data.result || [];
    for (const v of list) if (want.has(v.uid)) videos[v.uid] = { seconds: v.duration > 0 ? Math.round(v.duration) : null, bytes: Number(v.size) || null, ready: !!v.readyToStream };
    if (list.length < PAGE || Object.keys(videos).length === want.size) return { videos, complete: true };
    const last = list[list.length - 1]?.created;
    if (!last || last === end) break;
    end = last;
  }
  return { videos, complete: false };
}

/** Ask Stream for a video's MP4 (once), and say how far along it is: { ready, percent } */
export async function prepareMp4(env, uid) {
  let r = await stream.getDownloads(env, uid);
  if (!r.ok) throw new Error(stream.errorMessage(r, 'Stream could not say where the MP4 is'));
  let d = r.result?.default;
  if (!d || d.status === 'error') {
    r = await stream.createDownload(env, uid);
    if (!r.ok) throw new Error(stream.errorMessage(r, 'Stream would not make an MP4 of this video'));
    d = r.result?.default;
  }
  const ready = d?.status === 'ready' && !!d.url;
  return { ready, percent: ready ? 100 : Math.max(0, Math.min(99, Math.round(Number(d?.percentComplete) || 0))) };
}

// ─── The home ──────────────────────────────────────────────────────

/** A card for an album: its name, year, cover, counts from every source, newest addition */
function card(a, counts, kind) {
  const c = counts[a.key] || { photo: 0, video: 0, sources: {}, bySource: {}, newest: null };
  const sitePhotos = c.bySource?.site?.photo || 0;
  const photos = Math.max(a.files.length, sitePhotos) + (c.photo - sitePhotos);
  const pageVideos = a.videos.filter((v) => v.uid).length;
  const streamVideos = c.bySource?.stream?.video || 0;
  const videos = Math.max(pageVideos, streamVideos) + (c.video - streamVideos);
  const newest = [a.newest ? new Date(a.newest).toISOString() : null, c.newest].filter(Boolean).sort().pop() || null;
  return {
    key: a.key, kind, slug: a.slug, name: a.name, year: a.year, rooms: a.rooms || [], status: a.status, date: a.date || '',
    public: a.public !== false, photographer: a.photographer || '', page: a.page || null,
    cover: a.cover ? `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${a.cover}/w=560,h=420,fit=cover,gravity=auto,q=72` : c.cover || null,
    photos, videos, sources: { ...c.sources, ...(a.files.length && !c.sources.site ? { site: a.files.length } : {}) }, newest,
    live: a.videos.some((v) => v.kind === 'live'),
  };
}

/** Each album's counts from the index, by source and kind, with a cover for the library folders */
async function countsWithCovers(DB, staff) {
  const counts = await albumCounts(DB, { staff });
  // (a per-source count by kind, for the cards' arithmetic)
  const r = await DB.prepare(`SELECT album, source, kind, COUNT(*) AS n FROM media_items ${staff ? '' : `WHERE ${VISIBLE_SQL}`} GROUP BY album, source, kind`).all();
  for (const x of r.results || []) {
    const a = counts[x.album];
    if (!a) continue;
    a.bySource ||= {};
    (a.bySource[x.source] ||= {})[x.kind] = x.n;
  }
  const cov = await DB.prepare(`SELECT album, id, source, ref, MAX(COALESCE(taken_at, added_at)) AS at FROM media_items WHERE kind = 'photo' ${staff ? '' : `AND ${VISIBLE_SQL}`} GROUP BY album`).all();
  for (const x of cov.results || []) if (counts[x.album]) counts[x.album].cover = itemOut({ ...x, kind: 'photo' }).thumb.replace('w=480,h=480', 'w=560,h=420');
  return counts;
}

async function home(env, context) {
  const staff = roleOf(context) === 'staff';
  await ensureMediaIndex(env.DB);
  const [reveals, broadcasts] = await Promise.all([loadReveals(env), loadBroadcasts(env.DB)]);
  const [albums, counts] = await Promise.all([loadAllAlbums(env, { staff, broadcasts, reveals }), countsWithCovers(env.DB, staff)]);
  const publicOnly = (list) => list.filter((a) => a.public !== false);
  const activity = buildActivity({ albums: { kid: publicOnly(albums.kid), event: publicOnly(albums.event), community: publicOnly(albums.community) }, reveals, broadcasts, gone: albums.gone });
  activity.recent = [...activity.recent, ...(await jobTreadBatches(env.DB, staff)), ...(await sentInBatches(env.DB, staff))].sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const cards = [
    ...albums.kid.map((a) => card(a, counts, 'kid')),
    ...albums.event.map((a) => card(a, counts, 'event')),
    ...albums.community.map((a) => card(a, counts, 'community')),
  ];
  const known = new Set(cards.map((c) => c.key));
  // The library: the website's other folders, the archive's folders, YouTube, Stream's other videos (and for staff, the
  // jobs no page is matched to)
  for (const [key, c] of Object.entries(counts)) {
    if (known.has(key) || !key) continue;
    cards.push({ key, kind: 'library', slug: key, name: c.name || libName(key), year: null, rooms: [], status: null, date: '', public: !key.startsWith('jt:'), photographer: '',
      page: null, cover: c.cover || null, photos: c.photo, videos: c.video, sources: c.sources, newest: c.newest, live: false, group: key.startsWith('drive:') ? 'archive' : key.startsWith('jt:') ? 'jobtread' : 'library' });
  }
  const totals = cards.reduce((t, c) => ({ photos: t.photos + c.photos, videos: t.videos + c.videos }), { photos: 0, videos: 0 });
  const me = { email: context.data?.userEmail || null, role: staff ? 'staff' : 'media', name: context.data?.mediaOnly?.name || null };
  if (!staff) {
    await sawPerson(env.DB, me.email).catch(() => {});
    return ok({ me, activity, albums: cards, totals });
  }
  const [facts, people, access] = await Promise.all([indexFacts(env.DB), listPeople(env.DB), accessStatus(env).catch(() => null)]);
  // (Send photos in shows once its bucket and the Images binding are there: email and text intake, ./_media-inbox.js)
  const inbox = { ready: !!(env.MEDIA_FILES && env.IMAGES) };
  return ok({ me, activity, albums: cards, totals, facts, people, inbox, access: access ? { ok: !!access.ok, attached: !!access.attached, configured: !!access.configured, error: access.error || null } : null, page: MEDIA_PAGE });
}

/** New JobTread photos in the last weeks, one line per job per day: progress and reveal photos as the crew takes them */
async function jobTreadBatches(DB, staff) {
  const since = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();
  const r = await DB.prepare(`SELECT album, album_name, stage, substr(added_at, 1, 10) AS day, COUNT(*) AS n, MIN(id) AS id, MIN(ref) AS ref FROM media_items
    WHERE source = 'jobtread' AND kind = 'photo' AND added_at >= ? ${staff ? '' : `AND ${VISIBLE_SQL}`} GROUP BY album, stage, day ORDER BY day DESC LIMIT 30`).bind(since).all().catch(() => ({ results: [] }));
  const word = { Before: 'before photo', During: 'progress photo', After: 'reveal photo' };
  return (r.results || []).filter((x) => !x.album.startsWith('jt:')).map((x) => ({
    key: `jt:${x.album}:${x.stage}:${x.day}`, kind: 'photos', date: x.day,
    when: new Date(`${x.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    title: `${x.n} new ${word[x.stage] || 'JobTread photo'}${x.n === 1 ? '' : 's'} of ${x.album_name}`, detail: 'In JobTread',
    album: x.album, links: [], thumbs: x.ref ? [`${x.ref}?size=256`] : [], count: x.n, external: true,
  }));
}

/** What the team sent in lately, one line per message: "Jane sent 6 photos of Colin" */
async function sentInBatches(DB, staff) {
  const since = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();
  const r = await DB.prepare(`SELECT json_extract(extra, '$.message') AS msg, json_extract(extra, '$.from') AS who, album, album_name, substr(MIN(added_at), 1, 10) AS day,
      SUM(CASE WHEN kind = 'photo' THEN 1 ELSE 0 END) AS photos, SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END) AS videos, MIN(id) AS id, MIN(json_extract(extra, '$.channel')) AS channel
    FROM media_items WHERE source = 'inbox' AND added_at >= ? ${staff ? '' : `AND ${VISIBLE_SQL}`} GROUP BY msg ORDER BY day DESC LIMIT 20`).bind(since).all().catch(() => ({ results: [] }));
  return (r.results || []).map((x) => {
    const what = [x.photos && `${x.photos} photo${x.photos === 1 ? '' : 's'}`, x.videos && `${x.videos} video${x.videos === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
    return {
      key: `sent:${x.msg}`, kind: 'photos', date: x.day,
      when: new Date(`${x.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
      title: `${x.who || 'The team'} ${x.channel === 'text' ? 'texted' : 'emailed'} ${what}${x.album && x.album !== INBOX_ALBUM ? ` of ${x.album_name}` : ''}`,
      detail: x.album === INBOX_ALBUM ? 'In Sent in by the team' : '', album: x.album, links: [], thumbs: [`/api/media-thumb?id=${encodeURIComponent(x.id)}&s=600`], count: (x.photos || 0) + (x.videos || 0),
    };
  });
}

// ─── One album ─────────────────────────────────────────────────────

async function oneAlbum(env, context, key) {
  const staff = roleOf(context) === 'staff';
  const record = /^(kid|event|community):/.test(key);
  const album = record ? await loadAlbum(env, key, { staff }) : null;
  if (record && !album) return fail('That album isn’t on the website', 404);
  if (!record && !staff && key.startsWith('jt:')) return fail('That album isn’t yours to see', 404);
  const items = await albumItems(env.DB, key, { staff });
  const shown = new Set([...(album?.files || []).map((f) => `img:${f.id}`), ...(album?.videos || []).filter((v) => v.uid).map((v) => `vid:${v.uid}`)]);
  const facts = Object.fromEntries(items.filter((i) => i.source === 'stream').map((i) => [i.uid, { seconds: i.seconds, bytes: i.size }]));
  const sections = { site: [], inbox: [], drive: [], jobtread: [], videos: [] };
  for (const it of items) {
    if (shown.has(it.id)) continue;
    if (it.kind === 'video') sections.videos.push(it);
    else if (sections[it.source]) sections[it.source].push(it);
  }
  // Before, During, After, then unsorted, newest first within each
  const order = { Before: 0, During: 1, After: 2 };
  for (const s of ['drive', 'jobtread', 'inbox']) sections[s].sort((a, b) => (order[a.stage] ?? 3) - (order[b.stage] ?? 3) || String(b.takenAt || b.addedAt || '').localeCompare(String(a.takenAt || a.addedAt || '')));
  const name = album?.name || items[0]?.albumName || libName(key);
  return ok({ album: album ? { ...album, files: album.files.map((f) => ({ ...f, item: `img:${f.id}` })) } : { key, kind: 'library', name, files: [], videos: [], public: !key.startsWith('jt:') }, sections, facts });
}

// ─── Requests ──────────────────────────────────────────────────────

export async function onRequestGet(context) {
  const { env, request } = context;
  const q = new URL(request.url).searchParams;
  const staff = roleOf(context) === 'staff';
  try {
    if (q.has('me')) return ok({ me: { email: context.data?.userEmail || null, role: staff ? 'staff' : 'media', name: context.data?.mediaOnly?.name || null } });
    if (q.has('mp4')) {
      let uid = null;
      if (q.get('item')) {
        const row = await itemFor(env.DB, q.get('item'), { staff });
        if (!row || row.kind !== 'video' || !['stream', 'inbox'].includes(row.source)) return fail('That video isn’t one you can download', 404);
        uid = row.source === 'stream' ? row.id.slice(4) : (() => { try { return JSON.parse(row.extra || '{}').uid; } catch { return null; } })();
        if (!uid) return fail('Stream hasn’t taken this video yet', 409);
      } else {
        const album = await loadAlbum(env, q.get('album'), { staff });
        if (!album) return fail('That album isn’t on the website', 404);
        const video = albumVideo(album, { key: q.get('mp4') });
        if (!video) return fail('That video isn’t in this album', 404);
        if (video.kind === 'reel' && video.start != null) return ok({ ready: true, percent: 100 }); // cut as it downloads
        uid = video.uid;
      }
      if (!stream.streamConfigured(env)) return fail('Stream isn’t connected (CF_STREAM_TOKEN)', 500);
      return ok(await prepareMp4(env, uid));
    }
    if (q.has('videos')) {
      const uids = [...new Set(String(q.get('videos') || '').split(',').map((s) => s.trim().toLowerCase()).filter(isUid))].slice(0, 400);
      try { return ok(await videoFacts(env, uids)); } catch (e) { return ok({ videos: {}, complete: false, error: e.message }); }
    }
    if (q.has('search')) {
      const filters = Object.fromEntries(['kind', 'stage', 'source', 'year', 'album'].map((k) => [k, q.get(k) || null]).filter(([, v]) => v));
      const offset = Math.max(0, Math.min(5000, Number(q.get('offset')) || 0));
      const sort = ['best', 'newest', 'oldest'].includes(q.get('sort')) ? q.get('sort') : 'best';
      return ok(await search(env.DB, String(q.get('search') || '').slice(0, 200), { filters, sort, offset, limit: 60, staff }));
    }
    if (q.has('inbox')) {
      if (!staff) return fail('Only staff see what’s sent in', 403);
      const [settings, senders, messages, text] = await Promise.all([readSettings(env.DB), listSenders(env.DB), listMessages(env.DB), textNumberStatus(env).catch(() => ({ set: false }))]);
      return ok({
        address: ADDRESS, emailReady: !!(env.MEDIA_FILES && env.MEDIA_INBOX_SECRET && env.IMAGES), number: settings.number || null, text,
        replies: !!settings.replies, wording: { filed: replyText({ files: 3, album: 'kid:colin' }, { albumName: 'Colin' }), unfiled: replyText({ files: 3, album: INBOX_ALBUM }), empty: replyText({ files: 0 }) },
        senders, messages,
      });
    }
    if (q.has('album')) return oneAlbum(env, context, String(q.get('album')).slice(0, 200));
    return home(env, context);
  } catch (err) {
    console.error('[media-admin]', err);
    // 500, not 502: Cloudflare replaces 502/504 bodies with its own page
    return fail(err.message || 'Something went wrong', 500);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (roleOf(context) !== 'staff') return fail('Only staff choose who signs in', 403);
  const by = context.data?.userEmail || 'unknown';
  try {
    const b = await request.json().catch(() => ({}));
    if (b.act === 'add-person') {
      const email = await addPerson(env.DB, { email: b.email, name: b.name, by });
      if (/@soardcharity\.com$/i.test(email) && (await import('./_board-roles.js')).isStaffEmail(by) && email === String(by).toLowerCase()) {
        await removePerson(env.DB, email);
        return fail('That’s your own sign-in: limiting it would lock you out of the rest of the admin', 400);
      }
      const access = await syncBoardAccess(env).catch((e) => ({ ok: false, error: e.message }));
      await logAudit(env.DB, { userEmail: by, action: 'updated', entityType: 'media-people', entitySlug: email, entityName: `${b.name || email} can sign in for Photos & Videos`, gitStatus: 'ok' }).catch(() => {});
      return ok({ people: await listPeople(env.DB), access: { ok: !!access?.ok, configured: access?.configured !== false, error: access?.error || null } });
    }
    if (b.act === 'remove-person') {
      const gone = await removePerson(env.DB, b.email);
      const access = await syncBoardAccess(env).catch((e) => ({ ok: false, error: e.message }));
      if (gone) await logAudit(env.DB, { userEmail: by, action: 'deleted', entityType: 'media-people', entitySlug: String(b.email || '').toLowerCase(), entityName: `${b.email} can no longer sign in for Photos & Videos`, gitStatus: 'ok' }).catch(() => {});
      return ok({ people: await listPeople(env.DB), access: { ok: !!access?.ok, configured: access?.configured !== false, error: access?.error || null } });
    }
    const audit = (entityName, slug = 'media-inbox', action = 'updated') => logAudit(env.DB, { userEmail: by, action, entityType: 'media-inbox', entitySlug: slug, entityName, gitStatus: 'ok' }).catch(() => {});
    if (b.act === 'add-sender') {
      await addSender(env.DB, { name: b.name, email: b.email, phone: b.phone, by });
      await audit(`${b.name} can send photos in`);
      return ok({ senders: await listSenders(env.DB) });
    }
    if (b.act === 'remove-sender') {
      await removeSender(env.DB, b.id);
      await audit('Someone taken off Who can send', String(b.id), 'deleted');
      return ok({ senders: await listSenders(env.DB) });
    }
    if (b.act === 'let-through') {
      const album = await letThrough(env, String(b.id));
      await audit(`A message let through, filed under ${album}`, String(b.id));
      return ok({ album, messages: await listMessages(env.DB) });
    }
    if (b.act === 'delete-message') {
      const n = await deleteMessage(env, String(b.id));
      await audit(`A message and its ${n} file${n === 1 ? '' : 's'} deleted`, String(b.id), 'deleted');
      return ok({ messages: await listMessages(env.DB) });
    }
    if (b.act === 'move') {
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String);
      const n = await moveItems(env.DB, ids, String(b.album || ''));
      await audit(`${n} sent-in file${n === 1 ? '' : 's'} moved to ${b.album}`);
      return ok({ moved: n });
    }
    if (b.act === 'setup-text-number') {
      const settings = await setupTextNumber(env, { by });
      await audit(`SOARD Photos’ text number set up: ${settings.number}`);
      return ok({ number: settings.number, text: await textNumberStatus(env).catch(() => ({ set: true })) });
    }
    if (b.act === 'replies') {
      const settings = await writeSettings(env.DB, { replies: !!b.on, repliesBy: by, repliesAt: new Date().toISOString() });
      await audit(`Replies to senders turned ${settings.replies ? 'on' : 'off'}`);
      return ok({ replies: settings.replies });
    }
    return fail('Say what to do');
  } catch (err) {
    return fail(err.message || 'Something went wrong', err.status || 500);
  }
}
