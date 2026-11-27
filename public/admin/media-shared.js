/**
 * Photos & Videos: what the admin's gallery shows and what may be downloaded
 * ===========================================================================
 * Peter, Nov 25 2026: "i need to create a photo/video gallery for my social
 * media person to download any photo or video asset that we have ... and
 * include a list of recent activities or something related to our reveals
 * and events".
 *
 * Shared by the page (./media.js) and the server (functions/api/media-admin.js,
 * media-download.js), so the server only ever hands out a file the page
 * showed. No DOM, no network.
 *
 * The rule: an album holds what the public website shows, and nothing else.
 *   - Kids: published kid pages only (drafts are left out, as on the site).
 *     The main photo, the gallery and the story photos; the before and after
 *     pairs and before photos exactly as the kid page shows them
 *     (pagePairs / pageBefores in ./reveal-design.js), so a before photo kept
 *     off the page (a house number, a street sign) or not looked at yet, and
 *     every before photo ahead of the reveal, never appears here.
 *   - Events and community projects: the published ones, their photos and video.
 *   - Videos: the makeover video and live reveal recording on a kid page, a
 *     live reveal's replay and its Reel clip, an event's or project's video.
 *     One Stream no longer has (`gone`: most uploads from before 2024 were
 *     purged) is left out, and a makeover video that's also on YouTube is
 *     offered as that link, as the kid page does (src/utils/reveals.ts).
 *     A family's application video is in the same Stream account and is never
 *     in an album, so it can never be downloaded from here.
 * The image library itself (Cloudflare Images) is never listed: it also holds
 * advisory applicants' photos and before photos kept off the pages.
 */

import { cfIdOf } from './site-config-shared.js';
import { pagePairs, pageBefores } from './reveal-design.js';

export const CF_HASH = 'ROYFuPmfN2vPS6mt5sCkZQ';
export const STREAM_CODE = 'cuav5h47lgfe96ql';
export const TZ = 'America/New_York';
/** How far back "Recently" looks */
export const RECENT_DAYS = 60;
/** A photo added this recently is marked New */
export const NEW_DAYS = 14;
/** At most this many photos in one ZIP (the server reads each one in turn) */
export const ZIP_MAX = 250;
/** Stream's instant clip of a recording (clip.mp4?time=&duration=) is at most this long (functions/api/_broadcast-reel.js) */
export const INSTANT_CLIP_MAX = 60;

const DAY = 86_400_000;

// ─── Small pieces ─────────────────────────────────────────────────

/** A picture's address at a size: thumbnails in the page (Cloudflare picks the format) */
export const imgSrc = (id, opts = 'w=480,h=480,fit=cover,gravity=auto,q=72') => `https://imagedelivery.net/${CF_HASH}/${id}/${opts}`;
/** The full-size JPEG a download fetches: as large as the original, no location or camera data */
export const fullSrc = (id) => imgSrc(id, 'w=9999,fit=scale-down,quality=95,format=jpeg,metadata=none');
export const streamThumb = (uid, { width = 640, height = 360, time = null } = {}) =>
  `https://customer-${STREAM_CODE}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?width=${width}&height=${height}&fit=crop${time != null ? `&time=${Math.max(0, Math.floor(time))}s` : ''}`;
export const streamEmbed = (uid, { start = null } = {}) =>
  `https://customer-${STREAM_CODE}.cloudflarestream.com/${uid}/iframe${start != null ? `?startTime=${Math.max(0, Math.floor(start))}s` : ''}`;

/** A Stream video's id from any of its addresses (watch., customer-…, videodelivery.net, iframe), or a bare id */
export function streamUidOf(v) {
  const s = String(v || '').trim();
  if (/^[a-f0-9]{32}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/(?:cloudflarestream\.com|videodelivery\.net)\/([a-f0-9]{32})(?:[/?#]|$)/i);
  return m ? m[1].toLowerCase() : '';
}
export const isUid = (s) => /^[a-f0-9]{32}$/.test(String(s || ''));

/** A web link worth showing (http or https only) */
const webLink = (u) => (/^https?:\/\/[^\s]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
const isYouTube = (u) => /(?:youtube\.com|youtu\.be)\//i.test(String(u || ''));

/**
 * When a photo came in, from its id: the admin names each upload "<folder>/<milliseconds>-<file>"
 * (kids/ava/1795442629265-FINAL-31.jpg, kids/ava/ba-after-1795445017950-…, community/x/1774968285135-IMG.JPG).
 * null for older ids that don't carry it.
 */
export function addedAt(id) {
  const m = String(id || '').match(/(?:^|[/-])(1[5-9]\d{11})(?=[-_.]|$)/);
  if (!m) return null;
  const t = Number(m[1]);
  return t > Date.UTC(2017, 0, 1) && t < Date.UTC(2040, 0, 1) ? t : null;
}

/** Eastern calendar day of an instant: "2026-11-23" */
export function easternDay(ms) {
  if (!Number.isFinite(ms)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const dayMs = (date) => Date.parse(`${date}T12:00:00Z`);

/** "Ava", "Sam & Lee" → "Sam-and-Lee", accents and punctuation out: a safe file name piece */
export function namePart(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'SOARD';
}
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** What the album is called in file names: "Ava-2026", "2026-Evening-of-Sunshine" (a year already in the name isn't added twice) */
export function albumFilePart(album) {
  const base = namePart(album?.name);
  const y = album?.year ? String(album.year) : '';
  return y && !base.includes(y) ? `${base}-${y}` : base;
}

/** A downloaded photo's name: SOARD-Ava-2026-07.jpg, SOARD-Ava-2026-before-and-after-1-before.jpg */
export function photoFileName(album, file) {
  const stem = `SOARD-${albumFilePart(album)}`;
  if (file.role === 'pair-before' || file.role === 'pair-after') return `${stem}-before-and-after-${file.n}-${file.role === 'pair-before' ? 'before' : 'after'}.jpg`;
  if (file.role === 'before') return `${stem}-before-${pad(file.n)}.jpg`;
  return `${stem}-${pad(file.n)}.jpg`;
}
export const videoFileName = (album, video) => `SOARD-${albumFilePart(album)}-${namePart(video.label).toLowerCase()}.mp4`;
export const zipFileName = (album, some = false) => `SOARD-${albumFilePart(album)}-${some ? 'selected-photos' : 'photos'}.zip`;

// ─── Albums ───────────────────────────────────────────────────────

/** The live reveals that went out for a kid (rehearsals left out), newest first */
function liveOf(broadcasts, slug) {
  return (broadcasts || [])
    .filter((b) => b && b.kidSlug === slug && b.liveAt && !b.test)
    .sort((a, b) => String(b.liveAt).localeCompare(String(a.liveAt)));
}

/** Every photo once, in order, numbered within its kind */
function filesFrom(groups) {
  const seen = new Set();
  const files = [];
  const count = {};
  for (const [role, list] of groups) {
    for (const p of list) {
      const id = cfIdOf(p?.url ?? p?.id ?? p);
      if (!id || /^(https?:|blob:|data:)/.test(id)) continue;
      // A pair keeps both halves even when one is in the gallery too; elsewhere a repeat is dropped
      const pairRole = role === 'pair-before' || role === 'pair-after';
      if (!pairRole && seen.has(id)) {
        // (the main photo is in the gallery too, usually with the alt text the main one lacks)
        const first = files.find((f) => f.id === id);
        if (first && !first.alt && p?.alt) first.alt = String(p.alt).trim();
        continue;
      }
      seen.add(id);
      count[role] = (count[role] || 0) + 1;
      files.push({ id, alt: String(p?.alt || '').trim(), role, n: pairRole ? p.n : count[role], room: p?.room || '', added: addedAt(id) });
    }
  }
  return files;
}

/** A Stream video that's still there (`gone`: ids Stream no longer has) */
const alive = (uid, gone) => (uid && !gone?.has?.(uid) ? uid : '');

/** A kid's page, as an album (null for a draft, which the website doesn't show) */
export function kidAlbum(kid, { broadcasts = [], reveal = null, gone = null } = {}) {
  if (!kid?.slug || kid.publishStatus === 'draft') return null;
  const name = String(kid.name || kid.slug).trim();
  const pairs = pagePairs(kid);
  const pairFiles = [];
  pairs.forEach((p, i) => {
    pairFiles.push({ url: p.before, alt: p.beforeAlt || `${name}’s room before`, room: p.room, n: i + 1, half: 'before' });
    pairFiles.push({ url: p.after, alt: p.afterAlt || `${name}’s room after`, room: p.room, n: i + 1, half: 'after' });
  });
  const files = filesFrom([
    ['photo', [{ url: kid.heroImage, alt: kid.altTexts?.hero || '' }, ...(kid.photos || []), ...(kid.storyPhotos || []), ...(kid.accentImage ? [{ url: kid.accentImage }] : [])]],
    ['pair-before', pairFiles.filter((p) => p.half === 'before')],
    ['pair-after', pairFiles.filter((p) => p.half === 'after')],
    ['before', pageBefores(kid)],
  ]);
  // Pairs read before, after, before, after
  const order = (f) => (f.role === 'photo' ? 0 : f.role === 'before' ? 2 : 1);
  files.sort((a, b) => order(a) - order(b) || (order(a) === 1 ? a.n - b.n || (a.role === 'pair-before' ? -1 : 1) : 0));

  const videos = [];
  const seen = new Set();
  const addVideo = (v) => { if (v.uid && seen.has(v.uid) && v.kind !== 'reel') return; if (v.uid && v.kind !== 'reel') seen.add(v.uid); videos.push(v); };
  const roomUid = alive(streamUidOf(kid.streamVideoId), gone);
  const youtube = isYouTube(kid.videoUrl) ? webLink(kid.videoUrl) : '';
  if (roomUid) addVideo({ key: `room:${roomUid}`, kind: 'room', label: 'Makeover video', uid: roomUid, links: youtube ? [{ label: 'YouTube', url: youtube }] : [] });
  const lives = liveOf(broadcasts, kid.slug);
  for (const b of lives) {
    const uid = alive(streamUidOf(b.replayUid), gone);
    if (uid) {
      addVideo({
        key: `live:${uid}`, kind: 'live', label: 'Live reveal', uid, date: easternDay(Date.parse(b.liveAt)),
        links: [b.fbPermalink && { label: 'Facebook live post', url: webLink(b.fbPermalink) }].filter((l) => l?.url),
      });
    }
    // The Reel: a clip Stream made of it (a long one), or the moment in the recording, cut as it downloads (Stream's
    // instant clip, up to INSTANT_CLIP_MAX seconds)
    const r = b.reel;
    const rUid = alive(streamUidOf(r?.sourceUid) || uid, gone);
    const clipUid = alive(streamUidOf(r?.clipUid), gone);
    const seconds = Number.isFinite(r?.start) && Number.isFinite(r?.end) && r.end > r.start ? Math.ceil(r.end - r.start) : 0;
    if (r && (clipUid || (rUid && seconds && seconds <= INSTANT_CLIP_MAX))) {
      videos.push({
        key: `reel:${b.id}`, kind: 'reel', label: 'Reel clip', uid: clipUid || rUid, broadcast: b.id, start: clipUid ? null : r.start, seconds: seconds || null,
        caption: r.caption || '', date: r.publishedAt ? easternDay(Date.parse(r.publishedAt)) : '',
        links: [r.permalink && { label: 'Instagram', url: webLink(r.permalink) }, r.fbPermalink && { label: 'Facebook', url: webLink(r.fbPermalink) }].filter((l) => l?.url),
      });
    }
  }
  const liveUid = alive(streamUidOf(kid.revealVideoUrl), gone);
  if (liveUid) addVideo({ key: `live:${liveUid}`, kind: 'live', label: 'Live reveal', uid: liveUid, links: [] });
  if (!roomUid && webLink(kid.videoUrl)) videos.push({ key: 'link:video', kind: 'link', label: youtube ? 'Makeover video on YouTube' : 'Makeover video', url: webLink(kid.videoUrl), links: [] });

  const lastLive = lives[0];
  const revealDate = reveal?.date || (lastLive ? easternDay(Date.parse(lastLive.liveAt)) : '');
  const caption = videos.find((v) => v.kind === 'reel' && v.caption)?.caption || '';
  return {
    key: `kid:${kid.slug}`, kind: 'kid', slug: kid.slug, name, year: Number(kid.year) || null,
    status: kid.status || 'completed',
    rooms: Array.isArray(kid.roomTypes) ? kid.roomTypes.filter(Boolean) : [],
    photographer: String(kid.photographer || '').trim(),
    photographerUrl: '',
    page: `/kids/${kid.slug}/`,
    date: revealDate || '',
    blurb: String(kid.shortDescription || kid.heroSummary || '').trim(),
    caption,
    files, videos,
    cover: files[0]?.id || '',
    newest: files.reduce((m, f) => (f.added && f.added > m ? f.added : m), 0) || null,
    sort: kid.sortOrder ?? null,
  };
}

/** An event, as an album (a cancelled one is left out) */
export function eventAlbum(ev, { gone = null } = {}) {
  if (!ev?.slug || ev.status === 'cancelled') return null;
  const files = filesFrom([['photo', [{ url: ev.image }, ...(ev.photos || []).map((p) => ({ id: p.id || p.url, alt: p.alt })), ...(ev.dressCodeImage ? [{ url: ev.dressCodeImage, alt: 'Dress code' }] : [])]]]);
  const uid = alive(streamUidOf(ev.streamVideoId), gone);
  const link = webLink(ev.videoUrl);
  const videos = [];
  if (uid) videos.push({ key: `event:${uid}`, kind: 'event', label: 'Event video', uid, links: isYouTube(link) ? [{ label: 'YouTube', url: link }] : [] });
  else if (link) videos.push({ key: 'link:video', kind: 'link', label: 'Event video', url: link, links: [] });
  const name = String(ev.title || ev.slug).trim();
  return {
    key: `event:${ev.slug}`, kind: 'event', slug: ev.slug, name, year: Number(String(ev.date || '').slice(0, 4)) || null,
    status: ev.status || 'upcoming', rooms: [], category: ev.category || 'other',
    photographer: String(ev.photographer || '').trim(), photographerUrl: webLink(ev.photographerUrl),
    page: '/events/', date: /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || '')) ? ev.date : '',
    endDate: ev.endDate || '', time: ev.time || '', location: ev.location || '',
    ticketUrl: webLink(ev.ticketUrl),
    blurb: String(ev.shortDescription || '').trim(), caption: '',
    files, videos, cover: files[0]?.id || '',
    newest: files.reduce((m, f) => (f.added && f.added > m ? f.added : m), 0) || null,
    sort: ev.order ?? null,
  };
}

/** A community project, as an album (a draft is left out, as on the site) */
export function communityAlbum(p, { gone = null } = {}) {
  if (!p?.slug || p.publishStatus === 'draft') return null;
  const files = filesFrom([['photo', [{ url: p.heroImage }, ...(p.imageId ? [{ id: p.imageId, alt: p.imageAlt }] : []), ...(p.photos || [])]]]);
  const uid = alive(streamUidOf(p.streamVideoId), gone);
  const link = webLink(p.videoUrl);
  const videos = [];
  if (uid) videos.push({ key: `project:${uid}`, kind: 'project', label: 'Project video', uid, links: isYouTube(link) ? [{ label: 'YouTube', url: link }] : [] });
  else if (link) videos.push({ key: 'link:video', kind: 'link', label: 'Project video', url: link, links: [] });
  const year = Number(String(p.year || '').match(/\d{4}/g)?.pop()) || null;
  return {
    key: `community:${p.slug}`, kind: 'community', slug: p.slug, name: String(p.name || p.slug).trim(), year,
    status: p.status || 'completed', rooms: [], photographer: '', photographerUrl: '',
    page: p.story ? `/community/${p.slug}/` : '/community/', date: '',
    blurb: String(p.description || '').trim().slice(0, 400), caption: '',
    files, videos, cover: files[0]?.id || '',
    newest: files.reduce((m, f) => (f.added && f.added > m ? f.added : m), 0) || null,
    sort: p.order ?? null,
  };
}

/** Newest first: a known date, then the year, then the newest photo */
function byNewest(a, b) {
  return String(b.date || '').localeCompare(String(a.date || ''))
    || (b.year || 0) - (a.year || 0)
    || (b.newest || 0) - (a.newest || 0)
    || String(a.name).localeCompare(String(b.name));
}

/**
 * Every album, by kind. reveals: the reveal schedule (/api/media-admin), for each kid's reveal date. gone: the Stream
 * ids Stream no longer has.
 * → { kid: [...], event: [...], community: [...] }, each newest first; an album with nothing in it is left out
 */
export function buildAlbums({ kids = [], events = [], community = [], broadcasts = [], reveals = null, gone = null } = {}) {
  const revealOf = new Map();
  for (const r of [...(reveals?.past || []), ...(reveals?.upcoming || [])]) if (r?.slug && r.date) revealOf.set(r.slug, r);
  const has = (a) => a && (a.files.length || a.videos.length);
  return {
    kid: kids.map((k) => kidAlbum(k, { broadcasts, reveal: revealOf.get(k?.slug), gone })).filter(has).sort(byNewest),
    event: events.map((e) => eventAlbum(e, { gone })).filter(has).sort(byNewest),
    community: community.map((p) => communityAlbum(p, { gone })).filter(has).sort(byNewest),
  };
}

/** "kid:ava" → { kind: 'kid', slug: 'ava' } (null when it isn't one) */
export function parseAlbumKey(key) {
  const m = String(key || '').match(/^(kid|event|community):([A-Za-z0-9][A-Za-z0-9_-]{0,120})$/);
  return m ? { kind: m[1], slug: m[2] } : null;
}

/**
 * The photos of an album a download may name, in the album's order: all of them (a pair keeps its own copy of a
 * photo that's in the gallery too, named as the pair), or the ids asked for, each once (ids not in it are dropped)
 */
export function pickFiles(album, ids = null) {
  if (!album) return [];
  if (!ids) return album.files.slice();
  const want = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  const seen = new Set();
  return album.files.filter((f) => want.has(f.id) && !seen.has(f.id) && seen.add(f.id));
}

// ─── What's happening ─────────────────────────────────────────────

const dateText = (date, { weekday = true, year = false } = {}) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  ...(weekday ? { weekday: 'long' } : {}), month: 'long', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
});
export const clockText = (time) => {
  const [hh, mm] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(hh)) return '';
  return `${hh % 12 || 12}:${String(mm || 0).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};
const possessive = (name) => (/s$/i.test(name || '') ? `${name}’` : `${name}’s`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The list at the top of the page: what's coming up and what just happened, for reveals and events.
 *   ahead:  reveals on the schedule (a confirmed day and time, or "mid December" until it's confirmed) and events ahead
 *   recent: the last RECENT_DAYS days, newest first: reveals that went live (with the replay and the Reel), reveals
 *           that happened, events that happened, and new photos as they came in (one line per album per day)
 * Each item: { key, kind, date (YYYY-MM-DD or ''), when (words), title, detail, album (key or null), links, thumbs, caption }
 */
export function buildActivity({ albums, reveals = null, broadcasts = [], now = Date.now(), recentDays = RECENT_DAYS, gone = null } = {}) {
  const today = easternDay(now);
  const since = easternDay(now - recentDays * DAY);
  const all = [...(albums?.kid || []), ...(albums?.event || []), ...(albums?.community || [])];
  const byKey = new Map(all.map((a) => [a.key, a]));
  const kidAlbumOf = (slug) => byKey.get(`kid:${slug}`) || null;
  const ahead = [];
  const recent = [];

  // Reveals coming up
  for (const r of reveals?.upcoming || []) {
    if (!r?.slug) continue;
    const a = kidAlbumOf(r.slug);
    const name = r.name || a?.name || r.slug;
    const confirmed = r.confirmed !== false && !!r.date;
    ahead.push({
      key: `reveal:${r.slug}`, kind: 'reveal', confirmed,
      date: confirmed ? r.date : String(r.window?.through || ''),
      when: confirmed ? `${dateText(r.date)}${r.time ? ` at ${clockText(r.time)}` : ''}` : `${r.window?.label ? r.window.label[0].toUpperCase() + r.window.label.slice(1) : 'Date to come'}, not confirmed yet`,
      title: `${possessive(name)} reveal`,
      detail: (r.rooms?.length ? r.rooms : a?.rooms || []).join(' and '),
      album: a?.key || null,
      links: [{ label: 'Kid page', url: `/kids/${r.slug}/` }, ...(confirmed ? [{ label: 'Live page', url: `/live/${r.slug}/` }] : [])],
      thumbs: a?.cover ? [a.cover] : [],
    });
  }
  // Events ahead
  for (const a of albums?.event || []) {
    if (!a.date || (a.endDate || a.date) < today) continue;
    ahead.push({
      key: `event:${a.slug}`, kind: 'event', confirmed: true, date: a.date,
      when: `${dateText(a.date, { year: a.date.slice(0, 4) !== today.slice(0, 4) })}${a.time ? `, ${a.time}` : ''}`,
      title: a.name, detail: a.location, album: a.key,
      links: [{ label: 'Events page', url: '/events/' }, ...(a.ticketUrl ? [{ label: 'Tickets', url: a.ticketUrl }] : [])],
      thumbs: a.cover ? [a.cover] : [],
    });
  }
  ahead.sort((x, y) => String(x.date || '9999').localeCompare(String(y.date || '9999')) || (y.confirmed ? 1 : 0) - (x.confirmed ? 1 : 0));

  // Reveals that went live, and their Reels
  const liveKids = new Set();
  for (const b of broadcasts || []) {
    if (!b?.kidSlug || !b.liveAt || b.test) continue;
    const date = easternDay(Date.parse(b.liveAt));
    if (!date || date < since || date > today) continue;
    liveKids.add(`${b.kidSlug}|${date}`);
    const a = kidAlbumOf(b.kidSlug);
    const name = b.kidName || a?.name || b.kidSlug;
    const minutes = b.endedAt ? Math.max(1, Math.round((Date.parse(b.endedAt) - Date.parse(b.liveAt)) / 60000)) : null;
    const uid = alive(streamUidOf(b.replayUid), gone);
    const had = !!streamUidOf(b.replayUid);
    recent.push({
      key: `live:${b.id}`, kind: 'live', date, when: dateText(date),
      title: `${possessive(name)} reveal went live`,
      detail: [minutes ? `${minutes} minute recording` : 'Recording', uid ? 'ready to download' : had ? 'no longer in Stream' : 'on its way'].join(', '),
      album: a?.key || null,
      links: [b.fbPermalink && { label: 'Facebook live post', url: webLink(b.fbPermalink) }, { label: 'Replay page', url: `/live/${b.kidSlug}/` }].filter((l) => l?.url),
      thumbs: uid ? [] : a?.cover ? [a.cover] : [], video: uid || null,
    });
    const r = b.reel;
    if (r?.publishedAt && (r.permalink || r.fbPermalink)) {
      const rd = easternDay(Date.parse(r.publishedAt));
      if (rd && rd >= since) {
        const secs = Math.ceil((r.end || 0) - (r.start || 0));
        recent.push({
          key: `reel:${b.id}`, kind: 'reel', date: rd, when: dateText(rd),
          title: `${possessive(name)} Reel is posted`,
          detail: secs > 0 ? `${secs} second clip of the reveal` : 'A clip of the reveal',
          album: a?.key || null,
          links: [r.permalink && { label: 'Instagram', url: webLink(r.permalink) }, r.fbPermalink && { label: 'Facebook', url: webLink(r.fbPermalink) }].filter((l) => l?.url),
          thumbs: [], video: alive(streamUidOf(r.sourceUid), gone) || uid || null, at: r.coverSeconds ?? r.start ?? null,
          caption: r.caption || '',
        });
      }
    }
  }
  // Reveals that happened without a live broadcast on record
  for (const r of reveals?.past || []) {
    if (!r?.slug || !r.date || r.date < since || r.date > today || liveKids.has(`${r.slug}|${r.date}`)) continue;
    const a = kidAlbumOf(r.slug);
    recent.push({
      key: `revealed:${r.slug}`, kind: 'revealed', date: r.date, when: dateText(r.date),
      title: `${possessive(r.name || a?.name || r.slug)} reveal`, detail: (a?.rooms || []).join(' and '),
      album: a?.key || null, links: [{ label: 'Kid page', url: `/kids/${r.slug}/` }], thumbs: a?.cover ? [a.cover] : [],
    });
  }
  // Events that happened
  for (const a of albums?.event || []) {
    const end = a.endDate || a.date;
    if (!a.date || end >= today || end < since) continue;
    recent.push({
      key: `event-past:${a.slug}`, kind: 'event-past', date: end, when: dateText(a.date),
      title: a.name, detail: a.files.length > 1 ? plural(a.files.length, 'photo') : 'Photos to come', album: a.key,
      links: [{ label: 'Events page', url: '/events/' }], thumbs: a.files.slice(0, 3).map((f) => f.id),
    });
  }
  // New photos, one line per album per day
  for (const a of all) {
    const byDay = new Map();
    for (const f of a.files) {
      if (!f.added) continue;
      const d = easternDay(f.added);
      if (d < since || d > today) continue;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(f);
    }
    for (const [d, list] of byDay) {
      const pairs = list.filter((f) => f.role === 'pair-after').length;
      const befores = list.filter((f) => f.role === 'before').length;
      const of = a.kind === 'kid' ? ` of ${a.name}` : ` from ${a.name}`;
      recent.push({
        key: `photos:${a.key}:${d}`, kind: 'photos', date: d, when: dateText(d),
        title: pairs && pairs * 2 === list.length ? `${plural(pairs, 'before and after pair')}${of}`
          : befores === list.length ? `${plural(befores, 'before photo')}${of}`
          : `${plural(list.length, 'new photo')}${of}`,
        detail: a.photographer ? `Photos by ${a.photographer}` : '',
        album: a.key, links: [], thumbs: list.slice(0, 4).map((f) => f.id), count: list.length,
      });
    }
  }
  const rank = { live: 0, reel: 1, revealed: 2, 'event-past': 3, photos: 4 };
  recent.sort((x, y) => String(y.date).localeCompare(String(x.date)) || rank[x.kind] - rank[y.kind]);
  return { today, ahead, recent };
}
