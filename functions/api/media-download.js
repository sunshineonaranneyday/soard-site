/**
 * /api/media-download (Cloudflare Access, staff) — Admin → Photos & Videos downloads
 * ===========================================================================
 * Every download names its album ("kid:ava", "event:gala-2026"), and only a
 * photo or video in that album is handed out (./_media.js loadAlbum: the same
 * albums the page shows, so never a family's application video or a before
 * photo kept off the kid page).
 *
 * GET  ?album=<key>&image=<id>      one photo, full size, as a JPEG with no location or camera data,
 *                                   named for the album (SOARD-Ava-2026-07.jpg)
 * GET  ?album=<key>&video=<key>     one video as an MP4 (SOARD-Ava-2026-live-reveal.mp4). A Reel clip is cut from the
 *                                   recording as it downloads; any other video needs its MP4 made first
 *                                   (./media-admin.js ?mp4=), else 409 { preparing: true }
 * GET  ?album=<key>&zip=all         every photo in the album, as one ZIP
 * POST album=<key>&ids=<id>\n<id>…  the photos picked, as one ZIP (a form post: the browser downloads the answer)
 * A ZIP holds at most ZIP_MAX photos and a short note: who took them, where they're on the website, and the Reel's
 * caption when there is one.
 */

import { loadAlbum, albumVideo } from './_media.js';
import { zipStream } from './_zip-stream.js';
import {
  fullSrc, photoFileName, videoFileName, zipFileName, pickFiles, ZIP_MAX, STREAM_CODE,
} from '../../public/admin/media-shared.js';
import * as stream from './_stream-live.js';
import { instantClipUrl } from './_broadcast-reel.js';

const SITE = 'https://sunshineonaranneyday.com';
const fail = (error, status = 400, extra = {}) => Response.json({ ok: false, error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });

/** Content-Disposition for a download, with a plain fallback name and the real one (RFC 6266) */
export function attachment(name) {
  const plain = String(name).replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The full-size JPEG of a photo, or throws */
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

/** What goes in the ZIP beside the photos */
export function noteText(album, files) {
  const lines = [`${album.name}${album.year ? ` (${album.year})` : ''}`, ''];
  if (album.photographer) lines.push(`Photos by ${album.photographer}. Please credit them when you post.`);
  if (album.page) lines.push(`On the website: ${SITE}${album.page}`);
  lines.push(`${files.length} photo${files.length === 1 ? '' : 's'}, full size.`);
  if (album.caption) lines.push('', 'The Reel’s caption:', '', album.caption);
  return `${lines.join('\r\n')}\r\n`;
}

async function zipOf(context, album, files) {
  if (!files.length) return fail('No photos to put in a ZIP', 404);
  if (files.length > ZIP_MAX) return fail(`At most ${ZIP_MAX} photos at a time. Pick fewer and download the rest next.`, 413);
  const zip = zipStream();
  const work = (async () => {
    try {
      // The next few photos are on their way while one is written
      const ahead = 3;
      // (a photo that fails is left out and the rest go on; marked handled at once, as it's only looked at in its turn)
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
  return new Response(zip.readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(zipFileName(album, files.length < album.files.length)),
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const q = new URL(request.url).searchParams;
  try {
    const album = await loadAlbum(env, q.get('album'));
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
      return new Response(res.body, { headers });
    }

    if (q.get('zip') === 'all') return zipOf(context, album, pickFiles(album));
    return fail('Say which photo or video (image=, video= or zip=all)');
  } catch (err) {
    console.error('[media-download]', err);
    return fail(err.message || 'Something went wrong', 500);
  }
}

/** The photos picked on the page, as a ZIP (a form post, so the browser saves the answer as a file) */
export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const type = request.headers.get('Content-Type') || '';
    let albumKey = '';
    let ids = [];
    if (/application\/json/i.test(type)) {
      const b = await request.json().catch(() => ({}));
      albumKey = b.album;
      ids = Array.isArray(b.ids) ? b.ids : [];
    } else {
      const f = await request.formData();
      albumKey = f.get('album');
      ids = String(f.get('ids') || '').split(/[\r\n,]+/);
    }
    ids = ids.map((s) => String(s).trim()).filter(Boolean).slice(0, ZIP_MAX + 1);
    const album = await loadAlbum(env, albumKey);
    if (!album) return fail('That album isn’t on the website', 404);
    if (!ids.length) return fail('Pick at least one photo');
    return zipOf(context, album, pickFiles(album, ids));
  } catch (err) {
    console.error('[media-download]', err);
    return fail(err.message || 'Something went wrong', 500);
  }
}
