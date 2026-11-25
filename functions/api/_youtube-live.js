/**
 * Each reveal's own YouTube live
 * ==============================
 * Stream sends the phone to YouTube's stream key (Settings → YouTube), but
 * YouTube only goes live into a broadcast that is waiting on that key. Studio's
 * Go live → Stream makes one by hand, called "Sunshine on a Ranney Day Live
 * Stream", public or not as Studio last had it, and marked made for kids like
 * most of the channel (Peter's test, Nov 25 2026). So the site makes it (Peter,
 * Nov 25 2026: "Site sets up every reveal on YouTube"):
 *
 *   - when JobTread's reveal is on the countdown: a scheduled live with the
 *     kid's name, the time, the kid's story with the website and donate links,
 *     the kid's "Live reveal" card as its thumbnail (padded to 16:9), public,
 *     not made for kids, Nonprofits & Activism, tied to the site's key, with
 *     Auto-start. It shows on the channel as Upcoming, with "Notify me".
 *   - a new time or title in JobTread or the admin: the same live, changed. A
 *     cancelled or replaced reveal: its live is deleted (never one that ran).
 *   - the phone connects: YouTube starts it by itself; if it hasn't 45 s into
 *     the reveal with the video arriving, the site starts it.
 *   - the reveal ends (the site's own end: 45 s grace, the crew's Y): the site
 *     ends the live. Auto-stop stays off, because YouTube's own stops 12 s
 *     after the video does (measured in the test), so a phone drop ended it.
 *   - a framing check (the phone on and off before the start): that live is
 *     ended and made private, and a fresh one waits for the reveal.
 *   - a reveal picked up again after its end, or a stream nobody planned: a
 *     live made on the spot and started.
 * Tests on the main feed (Stream's outputs are paused) and rehearsals (TEST
 * jobs) never touch YouTube.
 *
 * Runs on the broadcast tick (_broadcast.js), throttled by the record in
 * site_config "youtube-live" (the lives the site made, never a key). Needs the
 * channel's sign-in (./_youtube-auth.js) and the YouTube output in Stream.
 * Quota: making one costs about 200 of the project's 10,000 a day, a look 3.
 */

import { oauthConfigured, ytCall } from './_youtube-auth.js';
import { uploadImage, deleteImage, CF_HASH } from './_cf-images.js';
import { whenParts } from './_broadcast-notify.js';

export const RECORD_KEY = 'youtube-live';
const SITE = 'https://sunshineonaranneyday.com';
const CATEGORY = '29'; // Nonprofits & Activism
const CARD_BG = '%23fffcf5'; // the live card's own cream, so the padding to 16:9 doesn't show
const START_AFTER_MS = 45_000; // live on the site this long, YouTube still waiting: the site starts it
const KEEP_DAYS = 30;

const ACTIVE = new Set(['created', 'ready', 'testStarting', 'testing', 'liveStarting', 'live']);
const ON_AIR = new Set(['testStarting', 'testing', 'liveStarting', 'live']);
const nowIso = (t = Date.now()) => new Date(t).toISOString();

/** The site makes reveals' YouTube lives: signed in as the channel, a YouTube output in Stream, and not switched off */
export function autoOn(env, config) {
  const o = config?.outputs?.youtube;
  return oauthConfigured(env) && !!o?.uid && o.enabled !== false && config?.youtube?.auto !== false;
}

export function defaultRecord() {
  return { streamId: null, streamMask: null, lives: [], quick: null, nextAt: null, error: null, errorAt: null, conflicts: [], checkedAt: null };
}

export async function readRecord(DB) {
  const row = await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(RECORD_KEY).first().catch(() => null);
  if (!row) return defaultRecord();
  try { return { ...defaultRecord(), ...JSON.parse(row.data) }; } catch { return defaultRecord(); }
}

async function writeRecord(DB, rec) {
  await DB.prepare('INSERT OR REPLACE INTO site_config (key, data, updated_at) VALUES (?, ?, ?)').bind(RECORD_KEY, JSON.stringify(rec), nowIso()).run();
}

/** The next tick looks at YouTube whatever changed (the admin's "Check YouTube now") */
export async function lookNow(DB) {
  const rec = await readRecord(DB);
  await writeRecord(DB, { ...rec, quick: null, nextAt: null });
}

/** The live this broadcast has on YouTube now (made, waiting or on air), or null */
export function liveFor(rec, broadcastId) {
  return [...(rec?.lives || [])].reverse().find((l) => l.for === broadcastId && ACTIVE.has(l.status)) || null;
}

// ─── Words ──────────────────────────────────────────────────────────

// YouTube refuses < and > in titles and descriptions
const clean = (s) => String(s || '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ').trim();
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The live's title: "Colin's Room Reveal | Sunshine on a Ranney Day", or staff's own title from the admin */
export function liveTitle(state, config) {
  const name = state.kidName || null;
  const own = clean(state.title);
  let base;
  if (name && (!own || own.toLowerCase() === `${name}'s room reveal`.toLowerCase())) base = `${name}'s Room Reveal`;
  else if (!own || own === config?.defaults?.title || own.toLowerCase() === 'live room reveal') base = 'Live Room Reveal';
  else base = own;
  return clip(/sunshine on a ranney day/i.test(base) ? base : `${base} | Sunshine on a Ranney Day`, 100);
}

/** The live's description: the kid's story, when, the website (where viewers count and can write to the family) and donate */
export function liveDescription(state, { story = '', timezone = 'America/New_York', upcoming = false } = {}) {
  const name = state.kidName || null;
  const link = state.kidSlug ? `${SITE}/live/${state.kidSlug}/?src=youtube` : `${SITE}/live/?src=youtube`;
  const moment = name ? `Watch the moment ${name} sees the new room for the first time` : 'Watch a child see their new room for the first time';
  let when = '';
  if (upcoming && state.scheduledAt) {
    const { day, time } = whenParts(state.scheduledAt, timezone);
    when = `, live on ${day} at ${time}`;
  }
  return clip([
    clean(story),
    `${moment}${when}.`,
    `Watch on our website too, and leave a message for the family: ${link}`,
    `Help fund the next room: ${SITE}/donate/`,
    'Sunshine on a Ranney Day builds dream bedrooms, accessible bathrooms and therapy rooms for children with special needs in the Atlanta area, at no cost to their families.',
  ].filter(Boolean).join('\n\n'), 4900);
}

/**
 * What YouTube should have for this state → null (nothing: no reveal, a test, a rehearsal, the emergency banner)
 * or { kind: 'upcoming' | 'live', broadcastId, kidSlug, scheduledAt }
 */
export function wanted(state) {
  if (!state || state.quiet || state.test || state.source === 'manual' || !state.broadcastId) return null;
  if (['scheduled', 'armed'].includes(state.phase) && state.scheduledAt) return { kind: 'upcoming', broadcastId: state.broadcastId, kidSlug: state.kidSlug || null, scheduledAt: state.scheduledAt };
  if (['live', 'ending'].includes(state.phase) && state.source === 'stream') return { kind: 'live', broadcastId: state.broadcastId, kidSlug: state.kidSlug || null, scheduledAt: null };
  return null;
}

/** Everything a tick can see without asking anyone: a change in it means work now, not at the next look */
function quickSig(state, config) {
  const w = wanted(state);
  return JSON.stringify([w?.kind || null, w?.broadcastId || null, state?.kidSlug || null, state?.kidName || null, state?.title || null, w?.scheduledAt || null, config?.outputs?.youtube?.keyMask || null, config?.outputs?.youtube?.uid || null]);
}

/** When to look again with nothing changed */
function nextLook(want, cur, { now, error }) {
  if (error) return now + (want?.kind === 'live' ? 60e3 : 10 * 60e3);
  if (!want) return null;
  if (want.kind === 'live') return now + (cur && ON_AIR.has(cur.status) ? 10 * 60e3 : 20e3);
  const until = Date.parse(want.scheduledAt) - now;
  if (until <= 2 * 3600e3) return now + 5 * 60e3;
  if (until <= 24 * 3600e3) return now + 30 * 60e3;
  return now + 3 * 3600e3;
}

// ─── The card as a 16:9 thumbnail ───────────────────────────────────

let cards = null; // { at, list }
async function cardFor(env, slug, fetchImpl) {
  if (!slug) return null;
  try {
    if (!cards || Date.now() - cards.at > 10 * 60e3) {
      const res = env.ASSETS ? await env.ASSETS.fetch(new Request(`${SITE}/og/index.json`)) : await fetchImpl(`${SITE}/og/index.json`);
      if (!res.ok) return null;
      cards = { at: Date.now(), list: await res.json() };
    }
    const c = cards.list[`/live/${slug}/`];
    const url = typeof c === 'string' ? c : c?.url;
    return url ? { url, version: (url.match(/[?&]v=([\w-]+)/) || [])[1] || 'x' } : null;
  } catch {
    return null;
  }
}

/** The card (1200×630) on its own cream to 1280×720 through Cloudflare Images, or as it is if that can't be done */
async function thumbnailBytes(env, slug, card, fetchImpl) {
  const src = await fetchImpl(`${SITE}${card.url}`);
  if (!src.ok) throw new Error(`the live card answered ${src.status}`);
  const bytes = await src.arrayBuffer();
  if (!env.CF_IMAGES_TOKEN || !env.CF_ACCOUNT_ID) return { bytes, type: 'image/jpeg' };
  const id = `youtube/live-${slug}-${card.version}`;
  try {
    const up = await uploadImage(env, { bytes, type: 'image/jpeg', filename: `${slug}.jpg`, id }, fetchImpl);
    if (!up.success && up.status !== 409) return { bytes, type: 'image/jpeg' };
    const padded = await fetchImpl(`https://imagedelivery.net/${CF_HASH}/${id}/w=1280,h=720,fit=pad,background=${CARD_BG}`, { headers: { accept: 'image/jpeg' } });
    if (!padded.ok || !/jpeg/.test(padded.headers.get('content-type') || '')) return { bytes, type: 'image/jpeg' };
    return { bytes: await padded.arrayBuffer(), type: 'image/jpeg' };
  } finally {
    await deleteImage(env, id, fetchImpl).catch(() => {});
  }
}

// ─── YouTube ────────────────────────────────────────────────────────

/** The YouTube stream whose key is the one in Settings → YouTube (matched by its mask, "c02a…dcyp") → { id, title } or null */
async function findStream(api, mask) {
  const m = String(mask || '').match(/^(.{4})…(.{4})$/);
  if (!m) return null;
  const d = await api('GET', 'liveStreams', { part: 'id,snippet,cdn', mine: true, maxResults: 50 });
  const s = (d.items || []).find((x) => { const k = String(x.cdn?.ingestionInfo?.streamName || ''); return k.length > 8 && k.startsWith(m[1]) && k.endsWith(m[2]); });
  return s ? { id: s.id, title: s.snippet?.title || null } : null;
}

const broadcastBody = ({ title, description, scheduledStartTime }) => ({
  snippet: { title, description, scheduledStartTime },
  // Public, and not made for kids: made-for-kids lives notify no subscribers and have no chat
  status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
  contentDetails: { enableAutoStart: true, enableAutoStop: false, enableDvr: true, enableEmbed: true, recordFromStart: true, latencyPreference: 'low', monitorStream: { enableMonitorStream: false } },
});

async function endLive(api, live, work) {
  try {
    await api('POST', 'liveBroadcasts/transition', { broadcastStatus: 'complete', id: live.id, part: 'status' });
  } catch (e) {
    // Already over, or gone: either way it's not on air
    if (!['redundantTransition', 'liveBroadcastNotFound', 'invalidTransition'].includes(e.reason) && e.status !== 404) throw e;
  }
  Object.assign(live, { status: 'complete', aired: true, endedAt: nowIso() });
  work.push('youtube-live-ended');
}

/** "Colin's Room Reveal (continued) | Sunshine on a Ranney Day": a reveal picked up again after its live ended */
const continued = (title) => clip(title.replace(/ \| Sunshine on a Ranney Day$/, '') + ' (continued) | Sunshine on a Ranney Day', 100);

async function hideLive(api, live, work) {
  try {
    await api('PUT', 'videos', { part: 'status' }, { id: live.id, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } });
    work.push('youtube-live-hidden');
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  live.hidden = true;
}

async function dropLive(api, live, work) {
  try {
    await api('DELETE', 'liveBroadcasts', { id: live.id });
  } catch (e) {
    if (e.status !== 404 && e.reason !== 'liveBroadcastNotFound') throw e;
  }
  Object.assign(live, { status: 'deleted', endedAt: nowIso() });
  work.push('youtube-live-deleted');
}

/**
 * Bring YouTube in line with the broadcast. Called every tick; does nothing (one D1 read) unless the reveal
 * changed or its next look is due. Never throws: a failure is kept in the record (Settings → YouTube, the go/no-go)
 * and tried again at the next look.
 */
export async function syncYouTubeLive(env, config, state, work = [], { now = Date.now(), force = false, fetchImpl = fetch } = {}) {
  if (!autoOn(env, config) || state?.quiet) return null;
  const { DB } = env;
  const rec = await readRecord(DB);
  const quick = quickSig(state, config);
  const want = wanted(state);
  const open = rec.lives.filter((l) => ACTIVE.has(l.status));
  if (!force && quick === rec.quick && (!rec.nextAt || now < Date.parse(rec.nextAt))) return rec;
  if (!force && !want && !open.length) {
    if (rec.quick !== quick || rec.nextAt) { rec.quick = quick; rec.nextAt = null; await writeRecord(DB, rec); }
    return rec;
  }

  const api = (method, path, params, body, opts = {}) => ytCall(env, method, path, params, body, { fetchImpl, ...opts });
  const mask = config.outputs.youtube.keyMask || null;
  let cur = null;
  try {
    // 1. Which YouTube stream the site's key feeds (found again if the key in Settings changes)
    if (!rec.streamId || rec.streamMask !== mask) {
      const s = await findStream(api, mask);
      if (!s) throw new Error('None of the channel\'s stream keys is the one in Settings → YouTube (made again in Studio?). Paste the key again.');
      Object.assign(rec, { streamId: s.id, streamMask: mask });
    }

    // 2. Lives for nothing now: a cancelled or replaced reveal's never ran (deleted), an ended reveal's is ended
    for (const l of open) {
      if (want && l.for === want.broadcastId) continue;
      if (ON_AIR.has(l.status)) await endLive(api, l, work);
      else await dropLive(api, l, work);
    }

    // 3. This reveal's
    if (want) {
      const story = await kidStory(DB, state.kidSlug);
      const title = liveTitle(state, config);
      // (the same words before and once on air: going live changes nothing on YouTube)
      const description = liveDescription(state, { story, timezone: config.timezone, upcoming: !!state.scheduledAt });
      const at = want.scheduledAt ? new Date(Math.max(Date.parse(want.scheduledAt), now + 60e3)).toISOString() : nowIso(now + 30e3);
      const words = JSON.stringify([title, description, state.scheduledAt || null]);

      cur = liveFor(rec, want.broadcastId);
      if (cur) {
        const d = await api('GET', 'liveBroadcasts', { part: 'id,snippet,status,contentDetails', id: cur.id });
        const b = d.items?.[0];
        if (!b) Object.assign(cur, { status: 'deleted', endedAt: nowIso(now), note: 'deleted on YouTube' });
        else Object.assign(cur, { status: b.status?.lifeCycleStatus || cur.status, bound: b.contentDetails?.boundStreamId || null, aired: !!(cur.aired || b.snippet?.actualStartTime) });
        if (cur.status === 'complete' && !cur.endedAt) cur.endedAt = b?.snippet?.actualEndTime || nowIso(now);
        // A framing check: YouTube went live with it, and the site is back to waiting for the reveal
        if (want.kind === 'upcoming' && ON_AIR.has(cur.status)) await endLive(api, cur, work);
        if (want.kind === 'upcoming' && cur.status === 'complete' && cur.aired && !cur.hidden) { await hideLive(api, cur, work); cur.framingCheck = true; }
        if (!ACTIVE.has(cur.status)) cur = null;
      }

      if (!cur) {
        // On the spot (a stream nobody planned, a reveal picked up after its live ended) or ahead of the reveal
        const again = rec.lives.some((l) => l.for === want.broadcastId && l.aired && !l.framingCheck);
        const t = again ? continued(title) : title;
        const b = await api('POST', 'liveBroadcasts', { part: 'id,snippet,status,contentDetails' }, broadcastBody({ title: t, description, scheduledStartTime: at }));
        cur = { id: b.id, for: want.broadcastId, kid: state.kidSlug || null, kind: want.kind, status: b.status?.lifeCycleStatus || 'created', title: t, scheduledAt: want.scheduledAt, words, made: nowIso(now), bound: null, card: null };
        rec.lives.push(cur);
        work.push('youtube-live-made');
        // Its video's category and language (a broadcast can't carry them)
        await api('PUT', 'videos', { part: 'snippet' }, { id: b.id, snippet: { title: t, description, categoryId: CATEGORY, defaultLanguage: 'en', defaultAudioLanguage: 'en' } })
          .catch((e) => work.push(`youtube-category-failed: ${e.reason || e.status}`));
      } else if (cur.words !== words) {
        // A new time, title or story. Once on air only the words change (the start is history)
        const t = /\(continued\)/.test(cur.title || '') ? continued(title) : title;
        const kept = ON_AIR.has(cur.status) ? (await api('GET', 'liveBroadcasts', { part: 'snippet', id: cur.id })).items?.[0]?.snippet?.scheduledStartTime : null;
        const snippet = { title: t, description, scheduledStartTime: kept || at };
        await api('PUT', 'liveBroadcasts', { part: 'snippet' }, { id: cur.id, snippet });
        Object.assign(cur, { title: snippet.title, scheduledAt: want.scheduledAt || cur.scheduledAt, words });
        work.push('youtube-live-changed');
      }

      if (cur.bound !== rec.streamId && !ON_AIR.has(cur.status)) {
        const d = await api('POST', 'liveBroadcasts/bind', { id: cur.id, part: 'id,contentDetails', streamId: rec.streamId });
        cur.bound = d.contentDetails?.boundStreamId || rec.streamId;
        if (cur.status === 'created') cur.status = 'ready';
        work.push('youtube-live-bound');
      }

      const card = await cardFor(env, state.kidSlug, fetchImpl);
      if (card && cur.card !== card.url) {
        try {
          const img = await thumbnailBytes(env, state.kidSlug, card, fetchImpl);
          await api('POST', 'thumbnails/set', { videoId: cur.id }, null, { upload: img });
          cur.card = card.url;
          work.push('youtube-thumbnail');
        } catch (e) {
          work.push(`youtube-thumbnail-failed: ${e.reason || e.message}`);
        }
      }

      // On the site this long with the video arriving, and YouTube still waiting: start it
      if (want.kind === 'live' && cur.status === 'ready' && now - Date.parse(state.segmentAt || state.liveAt || nowIso(now)) >= START_AFTER_MS) {
        const s = await api('GET', 'liveStreams', { part: 'id,status', id: rec.streamId });
        if (s.items?.[0]?.status?.streamStatus === 'active') {
          try {
            await api('POST', 'liveBroadcasts/transition', { broadcastStatus: 'live', id: cur.id, part: 'status' });
            cur.status = 'liveStarting';
            work.push('youtube-live-started');
          } catch (e) {
            if (e.reason !== 'redundantTransition') throw e;
          }
        }
      }

      // Another live waiting on the same key (Studio's Go live → Stream makes one): both could start with the reveal
      if (want.kind === 'upcoming') {
        const ours = new Set(rec.lives.map((l) => l.id));
        const d = await api('GET', 'liveBroadcasts', { part: 'id,snippet,contentDetails', broadcastStatus: 'upcoming', maxResults: 50 });
        rec.conflicts = (d.items || []).filter((x) => !ours.has(x.id) && x.contentDetails?.boundStreamId === rec.streamId)
          .map((x) => ({ id: x.id, title: x.snippet?.title || null, scheduledAt: x.snippet?.scheduledStartTime || null }));
      }
    }
    Object.assign(rec, { quick, error: null, errorAt: null });
  } catch (e) {
    Object.assign(rec, { quick, error: e.message, errorAt: nowIso(now) });
    work.push(`youtube-error: ${e.reason || e.status || 'failed'}`);
  }
  // Lives long over drop off the record
  rec.lives = rec.lives.filter((l) => ACTIVE.has(l.status) || now - Date.parse(l.endedAt || l.made || 0) < KEEP_DAYS * 86400e3);
  rec.checkedAt = nowIso(now);
  const n = nextLook(want, cur, { now, error: rec.error });
  rec.nextAt = n ? nowIso(n) : null;
  await writeRecord(DB, rec);
  return rec;
}

async function kidStory(DB, slug) {
  if (!slug) return '';
  const row = await DB.prepare('SELECT data FROM kids WHERE slug = ?').bind(slug).first().catch(() => null);
  try { const d = JSON.parse(row?.data || '{}'); return String(d.heroSummary || d.shortDescription || '').replace(/\s+/g, ' ').trim(); } catch { return ''; }
}

/** The go/no-go's word on YouTube for a planned reveal → { status, label, detail, fix, url } */
export function preflightItem(rec, state, config) {
  if (state.test || !['scheduled', 'armed'].includes(state.phase)) return { status: 'ok', label: 'The site makes each reveal\'s YouTube live' };
  const l = liveFor(rec, state.broadcastId);
  if (!l) {
    return { status: 'fail', label: 'The reveal has no YouTube live yet', detail: rec.error || 'The site makes it within a few minutes of the countdown going up.', fix: 'Settings → YouTube says what went wrong.' };
  }
  if (!l.bound || l.bound !== rec.streamId) return { status: 'warn', label: 'The reveal\'s YouTube live isn\'t tied to the stream key yet', detail: rec.error || null, fix: 'The site ties it on its next look; Settings → YouTube says what went wrong.' };
  const { day, time } = whenParts(l.scheduledAt || state.scheduledAt, config?.timezone);
  return { status: 'ok', label: `YouTube live is ready: ${l.title}`, detail: `${day} at ${time}, public, starts when the phone does`, url: `https://www.youtube.com/watch?v=${l.id}` };
}
