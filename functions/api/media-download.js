/**
 * /api/media-download (Cloudflare Access) — Admin → Photos & Videos downloads
 * ===========================================================================
 * Every photo and video in the index (./_media-index.js) that the person may
 * see (./_media-search.js itemFor: the Photos & Videos sign-in only public
 * albums' open rows and Before photos the address check passed), and what a
 * page shows (an album named by its key: ./_media.js loadAlbum).
 *
 * GET  ?item=<id>                   one photo or video, as the file:
 *                                     img:  the website's picture, full size, a JPEG with no location or camera data
 *                                     drv:  the Drive archive's original, straight from Drive (HEIC, RAW and all)
 *                                     jt:   JobTread's original
 *                                     vid:  a Stream video as an MP4, once Stream has made it (409 { preparing } before)
 *                                   named for its album: SOARD-Ava-DSC_0151.JPG
 * GET  ?album=<key>&image=<id>      a page's photo (SOARD-Ava-2026-07.jpg); &video=<key> a page's video; &zip=all the
 *                                   page's photos as one ZIP
 * POST items=<id>\n<id>…            the photos picked anywhere (search, several albums), as one ZIP, a folder per album
 * POST album=<key>&ids=<id>\n<id>…  a page's photos picked, as one ZIP
 * A ZIP holds at most ZIP_MAX photos (videos are downloaded one by one) and a short note: who took them and where they
 * are. Each file is written as it arrives, so a ZIP of the archive's 40 MB originals never sits in memory. Every ZIP
 * and video download is in History (Who changed what) as the person's.
 */

import { loadAlbum, albumVideo } from './_media.js';
import { zipStream } from './_zip-stream.js';
import { fullSrc, photoFileName, videoFileName, zipFileName, pickFiles, namePart, ZIP_MAX, STREAM_CODE } from '../../public/admin/media-shared.js';
import { itemFor } from './_media-search.js';
import { driveToken, PHOTOS_DRIVE } from './_past-photos.js';
import { previewKey } from './_media-inbox.js';
import { logAudit } from './_audit.js';
import * as stream from './_stream-live.js';
import { instantClipUrl } from './_broadcast-reel.js';

const SITE = 'https://sunshineonaranneyday.com';
/** A ZIP is never over this (no ZIP64): stopped there, and the rest left for the next one */
const ZIP_BYTES = 3.5e9;
const fail = (error, status = 400, extra = {}) => Response.json({ ok: false, error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
const staffOf = (context) => !context.data?.mediaOnly;

/** Content-Disposition for a download, with a plain fallback name and the real one (RFC 6266) */
export function attachment(name) {
  const plain = String(name).replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The full-size JPEG of a website photo, or throws */
async function fetchPhoto(id, fetchImpl = fetch) {
  const res = await fetchImpl(fullSrc(id), { headers: { Accept: 'image/jpeg' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Cloudflare Images answered ${res.status} for ${id}`);
  return res;
}

/** The MP4 address of a Stream video once Stream has made it (signed when the video needs it), or null */
export async function mp4Url(env, uid) {
  const r = await stream.getDownloads(env, uid);
  const d = r.ok ? r.result?.default : null;
  if (d?.status !== 'ready' || !d.url) return null;
  const v = await stream.getVideo(env, uid);
  if (!v.result?.requireSignedURLs) return d.url;
  const t = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/${encodeURIComponent(uid)}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_STREAM_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, downloadable: true }),
    signal: AbortSignal.timeout(15000),
  }).then((x) => x.json()).catch(() => ({}));
  if (!t?.result?.token) throw new Error('Stream did not sign the download');
  return d.url.replace(`/${uid}/`, `/${t.result.token}/`);
}

/** What goes in a page's ZIP beside its photos */
export function noteText(album, files) {
  const lines = [`${album.name}${album.year ? ` (${album.year})` : ''}`, ''];
  if (album.photographer) lines.push(`Photos by ${album.photographer}. Please credit them when you post.`);
  if (album.page) lines.push(`On the website: ${SITE}${album.page}`);
  lines.push(`${files.length} photo${files.length === 1 ? '' : 's'}, full size.`);
  if (album.caption) lines.push('', 'The Reel’s caption:', '', album.caption);
  return `${lines.join('\r\n')}\r\n`;
}

// ─── One item of the index ─────────────────────────────────────────

/** "1795442629265-FINAL-31.jpg" → "FINAL-31.jpg"; a website photo is a JPEG whatever it was uploaded as */
const plainName = (row) => {
  if (row.source === 'inbox') return `${String(row.name || 'photo').replace(/\.[a-z0-9]{2,5}$/i, '')}.${row.kind === 'photo' ? 'jpg' : 'mp4'}`;
  const tail = String(row.name || row.id.split('/').pop() || 'photo').replace(/^\d{13}-/, '').replace(/^(ba-)?(before|after)-\d{13}-[a-f0-9]{8,}-/i, '');
  return row.source === 'site' ? tail.replace(/\.[a-z0-9]{2,5}$/i, '').concat('.jpg') : tail;
};
export const itemFileName = (row) => `SOARD-${namePart(row.album_name || 'SOARD')}-${plainName(row).replace(/[\\/:*?"<>|]+/g, '-')}`;

/** The bytes of one photo or video, as a Response (a stream), or throws. HEIC and RAW stay as they are */
export async function openItem(env, row, { fetchImpl = fetch } = {}) {
  const ref = row.id.slice(row.id.indexOf(':') + 1);
  if (row.source === 'site') return fetchPhoto(ref, fetchImpl);
  if (row.source === 'jobtread') {
    const res = await fetchImpl(row.ref, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`JobTread answered ${res.status}`);
    return res;
  }
  if (row.source === 'drive') {
    const token = await driveToken(env, { fetchImpl });
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    // Only a file in Photos & Video, never anything else the reader can open
    const meta = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref)}?supportsAllDrives=true&fields=driveId,trashed,mimeType`, auth);
    const m = meta.ok ? await meta.json() : null;
    if (!m || m.driveId !== PHOTOS_DRIVE || m.trashed) throw new Error('Drive doesn’t have it any more');
    const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref)}?alt=media&supportsAllDrives=true`, auth);
    if (!res.ok || !res.body) throw new Error(`Google Drive answered ${res.status}`);
    return res;
  }
  if (row.source === 'inbox') {
    // Sent in by the team: a photo as its full-size copy (a JPEG, nothing of where it was taken), a video as Stream's MP4
    // (likewise); the original as it came stays in SOARD's bucket
    if (row.kind === 'photo') {
      const pic = await env.MEDIA_FILES.get(previewKey(ref, 'full'));
      if (!pic) throw new Error('Its full-size copy isn’t made yet');
      return new Response(pic.body, { headers: { 'Content-Length': String(pic.size) } });
    }
    const uid = (() => { try { return JSON.parse(row.extra || '{}').uid; } catch { return null; } })();
    if (!uid) throw new Error('Stream hasn’t taken this video yet');
    const url = await mp4Url(env, uid);
    if (!url) throw Object.assign(new Error('Stream is still making the MP4'), { preparing: true });
    return fetchImpl(url, { signal: AbortSignal.timeout(60000) });
  }
  if (row.source === 'stream') {
    const url = await mp4Url(env, ref);
    if (!url) throw Object.assign(new Error('Stream is still making the MP4'), { preparing: true });
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Stream answered ${res.status} for the MP4`);
    return res;
  }
  throw new Error('YouTube doesn’t hand out its videos: open it on YouTube');
}

async function oneItem(context, id) {
  const { env } = context;
  const row = await itemFor(env.DB, id, { staff: staffOf(context) });
  if (!row) return null;
  let res;
  try { res = await openItem(env, row); } catch (e) {
    if (e.preparing) return fail(e.message, 409, { preparing: true });
    return fail(e.message, 500);
  }
  const type = row.source === 'site' || (row.source === 'inbox' && row.kind === 'photo') ? 'image/jpeg' : row.source === 'stream' || row.source === 'inbox' ? 'video/mp4' : (row.mime && row.mime !== 'application/octet-stream' ? row.mime : res.headers.get('content-type') || 'application/octet-stream');
  const name = row.source === 'stream' ? `SOARD-${namePart(row.album_name || 'SOARD')}-${namePart(row.title || 'video').toLowerCase()}.mp4`
    : row.source === 'inbox' ? `SOARD-${namePart(row.album_name || 'SOARD')}-${String(row.name || 'file').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|]+/g, '-')}.${row.kind === 'photo' ? 'jpg' : 'mp4'}`
    : itemFileName(row);
  const headers = { 'Content-Type': type, 'Content-Disposition': attachment(name), 'Cache-Control': 'private, max-age=300' };
  const len = res.headers.get('Content-Length');
  if (len) headers['Content-Length'] = len;
  if (row.kind === 'video') await logAudit(env.DB, { userEmail: context.data?.userEmail || 'unknown', action: 'downloaded', entityType: 'media', entitySlug: row.id, entityName: `Downloaded ${name}`, gitStatus: 'ok' }).catch(() => {});
  return new Response(res.body, { headers });
}

// ─── ZIPs ──────────────────────────────────────────────────────────

/** A page's photos as one ZIP */
async function zipOf(context, album, files) {
  if (!files.length) return fail('No photos to put in a ZIP', 404);
  if (files.length > ZIP_MAX) return fail(`At most ${ZIP_MAX} photos at a time. Pick fewer and download the rest next.`, 413);
  const zip = zipStream();
  const work = (async () => {
    try {
      // The next few photos are on their way while one is written; one that fails is left out and the rest go on
      const ahead = 3;
      const get = (f) => { const p = fetchPhoto(f.id).then((r) => r.arrayBuffer()); p.catch(() => {}); return p; };
      const pending = files.slice(0, ahead).map(get);
      for (let i = 0; i < files.length; i++) {
        if (i + ahead < files.length) pending.push(get(files[i + ahead]));
        let bytes;
        try { bytes = new Uint8Array(await pending[i]); } catch (e) { console.warn('[media-download] skipped', files[i].id, e.message); pending[i] = null; continue; }
        pending[i] = null;
        await zip.add(photoFileName(album, files[i]), bytes, files[i].added ? new Date(files[i].added) : new Date());
      }
      await zip.add('About these photos.txt', noteText(album, files));
      await zip.close();
    } catch (e) {
      console.error('[media-download] zip', e);
      await zip.abort(e);
    }
  })();
  context.waitUntil?.(work);
  await logAudit(context.env.DB, { userEmail: context.data?.userEmail || 'unknown', action: 'downloaded', entityType: 'media', entitySlug: album.key, entityName: `Downloaded a ZIP of ${files.length} photo${files.length === 1 ? '' : 's'} of ${album.name}`, gitStatus: 'ok' }).catch(() => {});
  return new Response(zip.readable, {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(zipFileName(album, files.length < album.files.length)), 'Cache-Control': 'no-store' },
  });
}

/** The note in a ZIP of photos from anywhere: each album's count and credit */
export function mixedNote(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.album_name || 'SOARD';
    const a = by.get(k) || { n: 0, sources: new Set() };
    a.n++;
    a.sources.add({ site: 'the website', drive: 'the Drive archive', jobtread: 'JobTread' }[r.source] || r.source);
    by.set(k, a);
  }
  const lines = [`${rows.length} photo${rows.length === 1 ? '' : 's'} from Sunshine on a Ranney Day, full size.`, ''];
  for (const [k, a] of by) lines.push(`${k}: ${a.n} (from ${[...a.sources].join(', ')})`);
  lines.push('', 'Photos from the Drive archive and JobTread are the originals as they were taken. Credit the photographer when the website names one.');
  return `${lines.join('\r\n')}\r\n`;
}

/** Photos picked anywhere, as one ZIP: a folder per album when there's more than one, each file written as it arrives */
async function zipItems(context, ids) {
  const { env } = context;
  const staff = staffOf(context);
  const rows = [];
  for (const id of [...new Set(ids)].slice(0, ZIP_MAX + 1)) {
    const row = await itemFor(env.DB, id, { staff });
    if (row && row.kind === 'photo') rows.push(row);
  }
  if (!rows.length) return fail('None of those are photos you can download', 404);
  if (rows.length > ZIP_MAX) return fail(`At most ${ZIP_MAX} photos at a time. Pick fewer and download the rest next.`, 413);
  const folders = new Set(rows.map((r) => r.album_name || 'SOARD')).size > 1;
  const zip = zipStream();
  const work = (async () => {
    try {
      const open = (r) => { const p = openItem(env, r); p.catch(() => {}); return p; };
      const pending = rows.slice(0, 2).map(open);
      let written = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i + 2 < rows.length) pending.push(open(rows[i + 2]));
        const r = rows[i];
        let res;
        try { res = await pending[i]; } catch (e) { console.warn('[media-download] skipped', r.id, e.message); continue; }
        pending[i] = null;
        if (written + (Number(r.size) || 0) > ZIP_BYTES) { await res.body?.cancel().catch(() => {}); break; }
        const name = `${folders ? `${namePart(r.album_name || 'SOARD').replace(/-/g, ' ')}/` : ''}${itemFileName(r)}`;
        try { written += await zip.addStream(name, res.body, new Date(r.taken_at || r.added_at || Date.now()), { max: ZIP_BYTES - written }); } catch (e) { console.warn('[media-download] stopped at', r.id, e.message); break; }
      }
      await zip.add('About these photos.txt', mixedNote(rows));
      await zip.close();
    } catch (e) {
      console.error('[media-download] zip', e);
      await zip.abort(e);
    }
  })();
  context.waitUntil?.(work);
  const albums = [...new Set(rows.map((r) => r.album_name).filter(Boolean))];
  await logAudit(env.DB, { userEmail: context.data?.userEmail || 'unknown', action: 'downloaded', entityType: 'media', entitySlug: rows[0].album || 'media', entityName: `Downloaded a ZIP of ${rows.length} photo${rows.length === 1 ? '' : 's'} (${albums.slice(0, 3).join(', ')}${albums.length > 3 ? ` and ${albums.length - 3} more` : ''})`, gitStatus: 'ok' }).catch(() => {});
  const name = albums.length === 1 ? `SOARD-${namePart(albums[0])}-photos.zip` : `SOARD-photos-${new Date().toISOString().slice(0, 10)}.zip`;
  return new Response(zip.readable, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(name), 'Cache-Control': 'no-store' } });
}

// ─── Requests ──────────────────────────────────────────────────────

export async function onRequestGet(context) {
  const { env, request } = context;
  const q = new URL(request.url).searchParams;
  const staff = staffOf(context);
  try {
    if (q.has('item')) {
      const r = await oneItem(context, String(q.get('item')).slice(0, 300));
      if (r) return r;
      // A page's photo the index hasn't read yet: by its album, as before
      if (!q.has('album') || !/^img:/.test(q.get('item'))) return fail('That isn’t one you can download', 404);
      q.set('image', q.get('item').slice(4));
    }
    const album = await loadAlbum(env, q.get('album'), { staff });
    if (!album) return fail('That album isn’t on the website', 404);

    if (q.has('image')) {
      const [file] = pickFiles(album, [q.get('image')]);
      if (!file) return fail('That photo isn’t in this album', 404);
      const res = await fetchPhoto(file.id);
      const headers = { 'Content-Type': 'image/jpeg', 'Content-Disposition': attachment(photoFileName(album, file)), 'Cache-Control': 'private, max-age=300' };
      const len = res.headers.get('Content-Length');
      if (len) headers['Content-Length'] = len;
      return new Response(res.body, { headers });
    }

    if (q.has('video')) {
      const video = albumVideo(album, { key: q.get('video') });
      if (!video) return fail('That video isn’t in this album', 404);
      let url;
      if (video.kind === 'reel' && video.start != null) {
        url = instantClipUrl(STREAM_CODE, video.uid, video.start, video.seconds, `${album.slug}-reveal-reel`);
      } else {
        if (!stream.streamConfigured(env)) return fail('Stream isn’t connected (CF_STREAM_TOKEN)', 500);
        url = await mp4Url(env, video.uid);
        if (!url) return fail('Stream is still making the MP4', 409, { preparing: true });
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) return fail(`Stream answered ${res.status} for the MP4`, 500);
      const headers = { 'Content-Type': 'video/mp4', 'Content-Disposition': attachment(videoFileName(album, video)), 'Cache-Control': 'no-store' };
      const len = res.headers.get('Content-Length');
      if (len) headers['Content-Length'] = len;
      await logAudit(env.DB, { userEmail: context.data?.userEmail || 'unknown', action: 'downloaded', entityType: 'media', entitySlug: album.key, entityName: `Downloaded ${videoFileName(album, video)}`, gitStatus: 'ok' }).catch(() => {});
      return new Response(res.body, { headers });
    }

    if (q.get('zip') === 'all') return zipOf(context, album, pickFiles(album));
    return fail('Say which photo or video (item=, image=, video= or zip=all)');
  } catch (err) {
    console.error('[media-download]', err);
    return fail(err.message || 'Something went wrong', 500);
  }
}

/** The photos picked, as one ZIP (a form post, so the browser saves the answer as a file) */
export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const type = request.headers.get('Content-Type') || '';
    let albumKey = '';
    let ids = [];
    let items = [];
    if (/application\/json/i.test(type)) {
      const b = await request.json().catch(() => ({}));
      albumKey = b.album;
      ids = Array.isArray(b.ids) ? b.ids : [];
      items = Array.isArray(b.items) ? b.items : [];
    } else {
      const f = await request.formData();
      albumKey = f.get('album');
      ids = String(f.get('ids') || '').split(/[\r\n,]+/);
      items = String(f.get('items') || '').split(/[\r\n]+/);
    }
    const clean = (list) => list.map((s) => String(s).trim()).filter(Boolean).slice(0, ZIP_MAX + 1);
    items = clean(items);
    if (items.length) return zipItems(context, items);
    ids = clean(ids);
    const album = await loadAlbum(env, albumKey, { staff: staffOf(context) });
    if (!album) return fail('That album isn’t on the website', 404);
    if (!ids.length) return fail('Pick at least one photo');
    return zipOf(context, album, pickFiles(album, ids));
  } catch (err) {
    console.error('[media-download]', err);
    return fail(err.message || 'Something went wrong', 500);
  }
}

