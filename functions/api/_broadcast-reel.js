/**
 * Instagram Reel from every reveal, fully automatic
 * ==================================================
 * Instagram has no API for going live, but it does let a Page's linked
 * professional account publish Reels. So after each reveal:
 *
 *   replay ready ──▶ a start and end chosen in the admin? ──yes─────┐
 *                        │ no                                         │
 *                        ▼                                            │
 *        find the reveal moment (captions → keyword scoring,          │
 *        Workers AI as a second opinion, admin minute narrows it)     │
 *                        ▼                                            │
 *        length 'short' (default, Peter Nov 21 2026): the lead-in     │
 *        ("are you ready… here we go") through the first reactions,   │
 *        20 to 45 s. Length 'whole': the recording if it fits, else   │
 *        [moment − lead, … up to 15 min]                              │
 *                        ▼                                            │
 *        Stream clips that window into a new video (the full          │
 *        recording is untouched)                                      │
 *                        ▼                                            ▼
 *        Stream makes an MP4 ──▶ Instagram container (REELS, caption) ──▶
 *        poll until FINISHED ──▶ media_publish ──▶ permalink in the admin
 *
 * Why short: Instagram shows Reels of 3 minutes or less to people who don't
 * follow the account; longer ones reach mostly existing followers.
 *
 * The pipeline lives on state.reel and advances one step per tick (the hub
 * ticks every minute during replay), so nothing here runs long. Every step
 * is idempotent: a crashed tick just repeats the check next time.
 *
 * Needs: CF_ACCOUNT_ID, CF_STREAM_TOKEN, FB_PAGE_ID, and FB_PAGE_TOKEN
 * carrying instagram_basic + instagram_content_publish (see
 * docs/facebook-app-review.md → "Instagram Reels").
 */

import * as stream from './_stream-live.js';
import { viaGateway } from './_ai.js';

const FB_GRAPH = 'https://graph.facebook.com/v25.0';
export const REEL_MAX_SECONDS = 895;        // Instagram's API ceiling is 15:00; keep a margin
const STEP_INTERVAL_MS = 20 * 1000;
const CAPTION_WAIT_MS = 25 * 60 * 1000;     // Stream's AI captions usually land within minutes
const PIPELINE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const SHORT_MIN_SECONDS = 20;
export const SHORT_MAX_SECONDS = 45;
const SHORT_DEFAULT_SECONDS = 30;   // a moment with no reactions found after it
const REEL_MIN_SECONDS = 3;         // Instagram refuses shorter Reels
// Stream won't cut a live recording with POST /stream/clip (400, code 10005: "to clip recordings of live
// streams, please refer to our live instant clipping documentation"), and every reveal replay is one. Its
// instant clip is an MP4 made on request, up to 60 s: /<video>/clip.mp4?time=444s&duration=19s
export const INSTANT_CLIP_MAX_SECONDS = 60;

/** Stream's instant-clip MP4 of a live recording (public, made on request; Instagram fetches it) */
export function instantClipUrl(customerCode, uid, start, seconds, name = 'reveal-reel') {
  const file = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reveal-reel'}.mp4`;
  return `${stream.playbackHost(customerCode)}/${encodeURIComponent(uid)}/clip.mp4?time=${Math.floor(start)}s&duration=${Math.ceil(seconds)}s&filename=${file}`;
}

export function defaultReelConfig() {
  return {
    enabled: true,
    length: 'short',           // 'short': the reveal moment, 20-45 s · 'whole': up to 15 min (leadSeconds applies)
    leadSeconds: 240,          // 'whole' only: keep this much lead-up before the reveal moment
    maxSeconds: REEL_MAX_SECONDS,
    caption: "{kid}'s room reveal, the moment it all came together. Watch the full reveal on our website, link in bio. #SunshineOnARanneyDay #DreamsBuiltHere",
    shareToFeed: true,
    facebook: true,            // also post the same cut on the Facebook Page as a Reel (Peter, Nov 21 2026)
  };
}

// ─── Reveal-moment detection ────────────────────────────────────────

export function parseVtt(vtt) {
  const cues = [];
  const toSec = (t) => {
    const p = t.trim().split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const blocks = String(vtt || '').replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    const start = toSec(a), end = toSec(z.trim().split(/\s+/)[0]);
    if (Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text });
  }
  return cues;
}

// Phrases that cluster around the moment a child sees the room
const SIGNALS = [
  [/open (your|ur) eyes|open them|take (it|them) off|take off the blindfold|you can look|go ahead and look/i, 8],
  [/welcome (home|to your)|your new (room|bedroom|bathroom|space|playroom)|this is (all )?yours|this is your room/i, 7],
  [/\b(three|3)[,.\s]+(two|2)[,.\s]+(one|1)\b|\b(one|1)[,.\s]+(two|2)[,.\s]+(three|3)\b/i, 6],
  [/are you ready|ready to see|big reveal|here it is|surprise/i, 5],
  [/oh my (god|gosh)|oh wow|i can'?t believe|no way|it'?s (so )?(beautiful|amazing|perfect)|do you like it|do you love it/i, 4],
  [/\bwow\b|\byay\b|\bwoo+\b|look at (this|that|it)|\[(applause|cheering|laughter|crying)\]/i, 2],
];

export function scoreCues(cues) {
  return cues.map(c => ({ ...c, score: SIGNALS.reduce((n, [re, w]) => n + (re.test(c.text) ? w : 0), 0) }));
}

/**
 * Densest 45 s window of reveal language. Returns { seconds, score, confidence }
 * where seconds is the first strong cue inside the peak window (the instant
 * the eyes open, not the average of the reactions after).
 */
export function detectByKeywords(cues, windowSec = 45) {
  const scored = scoreCues(cues).filter(c => c.score > 0);
  if (!scored.length) return null;
  let best = null;
  for (let i = 0; i < scored.length; i++) {
    let sum = 0;
    const inWin = [];
    for (let j = i; j < scored.length && scored[j].start < scored[i].start + windowSec; j++) { sum += scored[j].score; inWin.push(scored[j]); }
    if (!best || sum > best.score) best = { score: sum, cues: inWin };
  }
  const anchor = best.cues.find(c => c.score >= 5) || best.cues[0];
  const confidence = Math.min(1, best.score / 20);
  return { seconds: Math.round(anchor.start), score: best.score, confidence };
}

function mmss(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Ask Workers AI for the moment. Returns { seconds, confidence } or null. Never throws. */
export async function detectByAi(env, cues, duration) {
  if (!env.AI || !cues.length) return null;
  try {
    let transcript = cues.map(c => `[${mmss(c.start)}] ${c.text}`).join('\n');
    if (transcript.length > 24000) {
      // keep every cue with a signal plus an even sample of the rest
      const scored = scoreCues(cues);
      const keep = scored.filter((c, i) => c.score > 0 || i % Math.ceil(cues.length / 300) === 0);
      transcript = keep.map(c => `[${mmss(c.start)}] ${c.text}`).join('\n').slice(0, 24000);
    }
    const out = await env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: 'You find the reveal moment in transcripts of live home-makeover reveals: the instant a child first sees their finished room (eyes opened, blindfold off, door opened). Reply with JSON only: {"revealSeconds": <number>, "confidence": <0 to 1>}.' },
        { role: 'user', content: `Video length ${mmss(duration)}. Transcript with [minutes:seconds] timestamps:\n${transcript}` },
      ],
      max_tokens: 60,
      temperature: 0,
    }, viaGateway('broadcast-reel'));
    const text = typeof out === 'string' ? out : (out?.response ?? JSON.stringify(out));
    const m = String(text).match(/\{[^}]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    const seconds = Number(j.revealSeconds);
    const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > duration) return null;
    return { seconds: Math.round(seconds), confidence };
  } catch {
    return null;
  }
}

/** Combine the two opinions. Keyword timing is precise; AI is a sanity check. */
export function chooseMoment(kw, ai) {
  if (kw && ai && Math.abs(kw.seconds - ai.seconds) <= 120) return { seconds: kw.seconds, method: 'captions+ai', confidence: Math.max(kw.confidence, ai.confidence) };
  if (kw && kw.confidence >= 0.5) return { seconds: kw.seconds, method: 'captions', confidence: kw.confidence };
  if (ai && ai.confidence >= 0.6) return { seconds: ai.seconds, method: 'ai', confidence: ai.confidence };
  if (kw) return { seconds: kw.seconds, method: 'captions', confidence: kw.confidence };
  if (ai) return { seconds: ai.seconds, method: 'ai', confidence: ai.confidence };
  return null;
}

/** Window of at most maxLen seconds with `lead` seconds before the moment, clamped to the video. */
export function clipWindow(duration, momentSec, { leadSeconds = 240, maxSeconds = REEL_MAX_SECONDS } = {}) {
  if (duration <= maxSeconds) return { start: 0, end: duration };
  if (momentSec == null) return { start: Math.max(0, duration - maxSeconds), end: duration }; // fallback: the ending
  let start = Math.max(0, momentSec - leadSeconds);
  let end = start + maxSeconds;
  if (end > duration) { end = duration; start = Math.max(0, end - maxSeconds); }
  return { start: Math.floor(start), end: Math.floor(end) };
}

// What's said just before the child sees the room, and the reactions after. Phrases like
// "your new room" are left out of both: they come before the door opens ("are you ready to
// see your new bathroom?") as often as after
const LEAD_IN = /open (your|ur) eyes|open them|take (it|them) off|take off the blindfold|you can look|go ahead and look|are you ready|ready to see|here we go|big reveal|\b(three|3)[,.\s]+(two|2)[,.\s]+(one|1)\b/i;
const REACTION = /oh my (god|gosh)|oh wow|i can'?t believe|no way|it'?s (so )?(beautiful|amazing|perfect|gorgeous)|do you like it|do you love it|\bwow\b|\byay\b|\bwoo+\b|look at (this|that|it)|\[(applause|cheering|laughter|crying)\]/i;

/**
 * The short Reel around a reveal moment: from the run of lead-in lines just before the first
 * reaction ("Alright Max, are you ready to see it?" "Here we go!") through the reactions that
 * follow one another, 20 to 45 seconds. Returns { start, end, coverSeconds } in whole seconds,
 * or null without a moment. The cover is a few seconds into the first reaction (the child's face).
 */
export function shortWindow(cues, momentSec, duration, { minSeconds = SHORT_MIN_SECONDS, maxSeconds = SHORT_MAX_SECONDS } = {}) {
  if (momentSec == null || !Number.isFinite(momentSec)) return null;
  const near = (cues || []).filter(c => c.start >= momentSec - 60 && c.start <= momentSec + 90).sort((a, b) => a.start - b.start);
  const reaction = near.find(c => c.start >= momentSec - 5 && REACTION.test(c.text));
  let start, end, coverSeconds;
  if (reaction) {
    // Step back over lead-in lines that follow on from one another, at most 15 s before the reaction
    const i = near.indexOf(reaction);
    let first = null;
    for (let j = i - 1; j >= 0; j--) {
      const c = near[j], next = first || reaction;
      if (!LEAD_IN.test(c.text) || REACTION.test(c.text) || next.start - c.start > 8 || reaction.start - c.start > 15) break;
      first = c;
    }
    start = (first ? first.start : reaction.start - 6) - 1;
    // Forward over reactions and other reveal language, while each follows within 8 s
    let last = reaction;
    for (const c of near.slice(i + 1)) {
      if (c.start - last.end > 8) break;
      if (REACTION.test(c.text) || scoreCues([c])[0].score > 0) last = c;
    }
    // ...and stop as the next line that isn't one begins ("all right, I'm going to hand this to…")
    const next = near.find(c => c.start > last.start);
    end = Math.min(last.end + 1.5, next ? next.start + 1 : Infinity);
    coverSeconds = reaction.start + 3;
  } else {
    start = momentSec - 2;
    end = start + SHORT_DEFAULT_SECONDS;
    coverSeconds = momentSec + 3;
  }
  start = Math.max(0, Math.floor(start));
  end = Math.ceil(end);
  // Too short: reach back into the lead-up (the closed door) before running into whatever is said next
  if (end - start < minSeconds) start = Math.max(0, end - minSeconds);
  if (end - start < minSeconds) end = start + minSeconds;
  if (end - start > maxSeconds) end = start + maxSeconds;
  const lastSecond = Math.floor(duration || end);
  if (end > lastSecond) { end = lastSecond; start = Math.max(0, Math.min(start, end - minSeconds)); }
  coverSeconds = Math.min(Math.max(coverSeconds, start), end - 1);
  return { start, end, coverSeconds: Math.round(coverSeconds) };
}

/** "7:24", "1:02:05", 444 or "444" → seconds; anything else → null */
export function parseClock(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m || Number(m[3]) >= 60) return null;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * A start and end chosen in the admin, checked against the recording's length.
 * → { start, end, coverSeconds } in whole seconds, or { error }.
 */
export function fitCut(cut, duration, { live = true } = {}) {
  const start = Math.max(0, Math.floor(Number(cut?.start)));
  const end = Math.min(Math.floor(duration), Math.ceil(Number(cut?.end)));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'The start and end must be times in the recording' };
  if (start >= Math.floor(duration)) return { error: `The start is past the end of the recording (${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')})` };
  if (end - start < REEL_MIN_SECONDS) return { error: 'Instagram needs at least 3 seconds' };
  if (live && end - start > INSTANT_CLIP_MAX_SECONDS) return { error: 'Stream can cut at most 60 seconds from a live recording' };
  if (end - start > REEL_MAX_SECONDS) return { error: 'Instagram takes at most 14:55 from the site' };
  const cover = Number(cut?.coverSeconds);
  const coverSeconds = Number.isFinite(cover) && cover >= start && cover < end ? Math.round(cover) : null;
  return { start, end, coverSeconds };
}

export function renderCaption(template, state) {
  const kid = state.kidName || 'Today';
  const t = String(template || defaultReelConfig().caption);
  const text = state.kidName ? t : t.replace(/\{kid\}'s room reveal/g, 'Room reveal day');
  return text
    .replace(/\{kid\}/g, kid)
    .replace(/\{title\}/g, state.title || 'Room reveal')
    .replace(/\{link\}/g, 'sunshineonaranneyday.com')
    .slice(0, 2200);
}

// ─── Instagram Graph ────────────────────────────────────────────────

async function graph(env, method, path, params = {}) {
  const url = new URL(`${FB_GRAPH}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: env.FB_PAGE_TOKEN });
  const init = { method, signal: AbortSignal.timeout(20000) };
  if (method === 'GET') url.search = body.toString();
  else { init.body = body; init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) return { ok: false, error: data.error?.message || `Graph API returned ${res.status}`, code: data.error?.code || null };
  return { ok: true, data };
}

/** The professional Instagram account linked to the Page: { id, username } or an error. */
export async function instagramAccount(env) {
  if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) return { ok: false, error: 'FB_PAGE_ID / FB_PAGE_TOKEN not set' };
  const r = await graph(env, 'GET', env.FB_PAGE_ID, { fields: 'instagram_business_account{id,username}' });
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  const ig = r.data.instagram_business_account;
  if (!ig?.id) return { ok: false, error: 'No professional Instagram account is linked to the Facebook Page. Instagram app → Settings → Account type → switch to Business, then link it to the Page.' };
  return { ok: true, id: ig.id, username: ig.username || null };
}

export async function createReelContainer(env, igUserId, { videoUrl, caption, thumbOffsetMs, shareToFeed = true }) {
  const params = { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: shareToFeed ? 'true' : 'false' };
  if (Number.isFinite(thumbOffsetMs) && thumbOffsetMs > 0) params.thumb_offset = String(Math.round(thumbOffsetMs));
  return graph(env, 'POST', `${igUserId}/media`, params);
}

export function containerStatus(env, containerId) {
  return graph(env, 'GET', containerId, { fields: 'status_code,status' });
}

export function publishContainer(env, igUserId, containerId) {
  return graph(env, 'POST', `${igUserId}/media_publish`, { creation_id: containerId });
}

export async function mediaPermalink(env, mediaId) {
  const r = await graph(env, 'GET', mediaId, { fields: 'permalink' });
  return r.ok ? r.data.permalink || null : null;
}

function isPermissionError(r) {
  return r && (r.code === 10 || r.code === 200 || r.code === 190 || /permission|not authorized|scope/i.test(r.error || ''));
}

// ─── The pipeline (one step per call) ───────────────────────────────

const nowIso = () => new Date(Date.now()).toISOString();

export function reelEnabled(config) {
  return config?.reels?.enabled !== false;
}

/**
 * Create the pipeline record when the replay becomes ready, or on Retry. `cut` is a start and
 * end chosen in the admin ({ start, end, coverSeconds?, caption? }, seconds of the recording);
 * it skips finding the moment. Its caption, when given, replaces the Settings caption for this Reel.
 */
export function startReel(state, sourceUid, overrideSeconds, cut = null) {
  const chosen = cut && Number.isFinite(Number(cut.start)) && Number.isFinite(Number(cut.end))
    ? { start: Number(cut.start), end: Number(cut.end), coverSeconds: Number.isFinite(Number(cut.coverSeconds)) && cut.coverSeconds !== null ? Number(cut.coverSeconds) : null }
    : null;
  const caption = typeof cut?.caption === 'string' && cut.caption.trim() ? cut.caption.trim().slice(0, 2200) : null;
  return {
    stage: 'pending', sourceUid, startedAt: nowIso(), updatedAt: nowIso(), checkedAt: null,
    duration: null, method: null, momentSeconds: null, confidence: null, overrideSeconds: overrideSeconds ?? null,
    cut: chosen, caption, coverSeconds: null,
    start: null, end: null, clipUid: null, mp4Url: null, igUserId: null, containerId: null, mediaId: null, permalink: null,
    error: null, attempts: 0,
  };
}

const fallbackNote = (duration, cfg) => (duration <= cfg.maxSeconds ? 'used the whole recording' : 'used the ending');

/**
 * Advance state.reel one step. Returns { state, events } where events is a
 * list of short strings for the tick's work log. Never throws.
 */
export async function advanceReel(env, config, state, { force = false } = {}) {
  const r = state.reel;
  if (!r) return { state, events: [] };
  const cfg = { ...defaultReelConfig(), ...(config.reels || {}) };
  const igOpen = !REEL_DONE.includes(r.stage);
  if (!igOpen && !facebookOpen(env, cfg, r)) return { state, events: [] };
  if (!force && r.checkedAt && Date.now() - Date.parse(r.checkedAt) < STEP_INTERVAL_MS) return { state, events: [] };
  const reel = { ...r, checkedAt: nowIso(), attempts: (r.attempts || 0) + (igOpen ? 1 : 0) };
  const events = [];
  const set = (patch) => Object.assign(reel, patch, { updatedAt: nowIso() });
  const fail = (error, stage = 'failed') => { set({ stage, error }); events.push(`reel:${stage}`); };

  if (igOpen) try {
    if (Date.now() - Date.parse(reel.startedAt) > PIPELINE_TIMEOUT_MS) { fail('Timed out after 4 hours'); return { state: { ...state, reel }, events }; }

    switch (reel.stage) {
      case 'pending': {
        const v = await stream.getVideo(env, reel.sourceUid);
        if (!v.ok) { set({ error: stream.errorMessage(v) }); break; }
        const duration = Number(v.result?.duration) || 0;
        if (v.result?.status?.state !== 'ready' || !duration) break;
        set({ duration, live: !!v.result?.liveInput });
        if (reel.cut) {
          const w = fitCut(reel.cut, duration, { live: !!v.result?.liveInput });
          if (w.error) { fail(w.error); break; }
          set({ stage: 'window', start: w.start, end: w.end, coverSeconds: w.coverSeconds, method: 'chosen', confidence: null, clipUid: null });
          events.push(`reel:chosen@${w.start}-${w.end}`);
          break;
        }
        if (cfg.length === 'whole') {
          if (duration <= cfg.maxSeconds) { set({ stage: 'download', start: 0, end: duration, method: 'fits', clipUid: null }); events.push('reel:fits'); break; }
          if (reel.overrideSeconds != null) { set({ stage: 'window', momentSeconds: reel.overrideSeconds, method: 'override', confidence: 1 }); break; }
        }
        // Short Reels always read the captions, even with a minute from the admin: it narrows the search
        set({ stage: 'captions' });
        break;
      }
      case 'captions': {
        const waited = Date.now() - Date.parse(reel.startedAt);
        const list = await stream.listCaptions(env, reel.sourceUid);
        const tracks = Array.isArray(list.result) ? list.result : [];
        const en = tracks.find(t => (t.language || '').startsWith('en'));
        if (!en) {
          if (waited > 5 * 60 * 1000 && !reel.captionRequested) { await stream.requestCaptions(env, reel.sourceUid); set({ captionRequested: true }); }
          if (waited > CAPTION_WAIT_MS) {
            // A minute from the admin still makes a short Reel without captions
            if (reel.overrideSeconds != null && cfg.length !== 'whole') { const sw = shortWindow([], reel.overrideSeconds, reel.duration); set({ stage: 'window', momentSeconds: reel.overrideSeconds, method: 'override', confidence: 1, start: sw.start, end: sw.end, coverSeconds: sw.coverSeconds, error: 'No captions arrived; cut at your minute' }); break; }
            set({ stage: 'window', method: 'fallback', momentSeconds: null, error: `No captions arrived; ${fallbackNote(reel.duration, cfg)}` }); events.push('reel:fallback');
          }
          break;
        }
        if (en.status && en.status !== 'ready') {
          if (en.status === 'error' || waited > CAPTION_WAIT_MS) { set({ stage: 'window', method: 'fallback', momentSeconds: null, error: `Captions failed; ${fallbackNote(reel.duration, cfg)}` }); events.push('reel:fallback'); }
          break;
        }
        const vtt = await stream.getCaptionsVtt(env, reel.sourceUid, en.language || 'en');
        const cues = parseVtt(vtt);
        let kw = null, ai = null, pick = null;
        if (reel.overrideSeconds != null) {
          // The admin's minute: the reveal language near it pins the second, else the minute itself
          const o = reel.overrideSeconds;
          const near = detectByKeywords(cues.filter(c => c.start >= o - 30 && c.start <= o + 120));
          pick = { seconds: near ? near.seconds : o, method: 'override', confidence: 1 };
        } else {
          kw = detectByKeywords(cues);
          ai = await detectByAi(env, cues, reel.duration);
          pick = chooseMoment(kw, ai);
        }
        if (pick) {
          const sw = cfg.length === 'whole' ? null : shortWindow(cues, pick.seconds, reel.duration);
          set({ stage: 'window', momentSeconds: pick.seconds, method: pick.method, confidence: Math.round(pick.confidence * 100) / 100, kw: kw ? kw.seconds : null, ai: ai ? ai.seconds : null,
            ...(sw ? { start: sw.start, end: sw.end, coverSeconds: sw.coverSeconds } : {}) });
          events.push(`reel:moment@${pick.seconds}`);
        }
        else { set({ stage: 'window', method: 'fallback', momentSeconds: null, error: `No reveal language found; ${fallbackNote(reel.duration, cfg)}` }); events.push('reel:fallback'); }
        break;
      }
      case 'window': {
        // A short cut or a chosen one arrives with its start and end; the long Reel works them out here
        const w = reel.start != null && reel.end != null ? { start: reel.start, end: reel.end } : clipWindow(reel.duration, reel.momentSeconds, cfg);
        if (w.start <= 0 && w.end >= Math.floor(reel.duration)) { set({ stage: 'download', start: 0, end: reel.duration, clipUid: null, error: reel.method === 'fallback' ? reel.error : null }); events.push('reel:whole'); break; }
        const live = reel.live !== false; // a reveal replay is a live recording; older records didn't say
        if (live && w.end - w.start <= INSTANT_CLIP_MAX_SECONDS) {
          // Nothing to wait for: Instagram fetches the instant clip straight from Stream
          const url = instantClipUrl(config.customerCode, reel.sourceUid, w.start, w.end - w.start, `${state.kidName || 'live'} reveal reel`);
          set({ stage: 'instagram', start: w.start, end: w.end, clipUid: null, mp4Url: url, error: null });
          events.push('reel:instant-clip');
          break;
        }
        const c = await stream.createClip(env, { uid: reel.sourceUid, startTimeSeconds: w.start, endTimeSeconds: w.end, name: `${state.kidName ? `${state.kidName}'s` : 'Live'} reveal (Instagram cut)` });
        if (!c.ok || !c.result?.uid) {
          if (live && c.status === 400) { fail(`Stream can only cut 60 seconds or less from a live recording, and this cut is ${Math.round((w.end - w.start) / 60)} minutes. Choose a cut of 60 seconds or less, or set Length to the reveal moment.`); break; }
          set({ error: stream.errorMessage(c, 'Clip failed') }); if (reel.attempts > 6) fail(reel.error); break;
        }
        set({ stage: 'clipping', start: w.start, end: w.end, clipUid: c.result.uid, error: null });
        events.push('reel:clip');
        break;
      }
      case 'clipping': {
        const v = await stream.getVideo(env, reel.clipUid);
        const st = v.result?.status?.state;
        if (st === 'error') { fail(`Stream could not make the clip: ${v.result?.status?.errorReasonText || 'unknown'}`); break; }
        if (st === 'ready') set({ stage: 'download' });
        break;
      }
      case 'download': {
        const uid = reel.clipUid || reel.sourceUid;
        let d = await stream.getDownloads(env, uid);
        let def = d.result?.default;
        if (!def) { d = await stream.createDownload(env, uid); def = d.result?.default; }
        if (!def) { set({ error: stream.errorMessage(d, 'MP4 not available') }); if (reel.attempts > 10) fail(reel.error); break; }
        if (def.status === 'error') { fail('Stream could not make the MP4'); break; }
        if (def.status === 'ready' && def.url) { set({ stage: 'instagram', mp4Url: def.url, error: null }); events.push('reel:mp4'); }
        break;
      }
      case 'instagram': {
        const ig = await instagramAccount(env);
        if (!ig.ok) { isPermissionError(ig) || /No professional Instagram/.test(ig.error) ? fail(ig.error, 'blocked') : set({ error: ig.error }); break; }
        const thumb = reel.coverSeconds != null && reel.start != null ? (reel.coverSeconds - reel.start) * 1000
          : reel.momentSeconds != null && reel.start != null ? (reel.momentSeconds - reel.start + 3) * 1000 : undefined;
        const c = await createReelContainer(env, ig.id, { videoUrl: reel.mp4Url, caption: reel.caption || renderCaption(cfg.caption, state), thumbOffsetMs: thumb, shareToFeed: cfg.shareToFeed });
        if (!c.ok) { isPermissionError(c) ? fail(`Instagram refused: ${c.error}. The page token needs instagram_basic and instagram_content_publish.`, 'blocked') : set({ error: c.error }); if (reel.attempts > 12 && reel.stage !== 'blocked') fail(c.error); break; }
        set({ stage: 'processing', igUserId: ig.id, igUsername: ig.username, containerId: c.data.id, error: null });
        events.push('reel:container');
        break;
      }
      case 'processing': {
        const s = await containerStatus(env, reel.containerId);
        if (!s.ok) { set({ error: s.error }); break; }
        const code = s.data.status_code;
        if (code === 'ERROR' || code === 'EXPIRED') { fail(`Instagram could not process the video: ${s.data.status || code}`); break; }
        if (code !== 'FINISHED') break;
        const p = await publishContainer(env, reel.igUserId, reel.containerId);
        if (!p.ok) { set({ error: p.error }); if (reel.attempts > 20) fail(p.error); break; }
        const permalink = await mediaPermalink(env, p.data.id);
        set({ stage: 'done', mediaId: p.data.id, permalink, publishedAt: nowIso(), error: null });
        events.push('reel:published');
        break;
      }
      default:
        break;
    }
  } catch (e) {
    set({ error: e.message || String(e) });
  }
  // The same cut on the Facebook Page, once its MP4 is known (in step with Instagram, or after it)
  if (facebookOpen(env, cfg, reel)) await advanceFacebookReel(env, cfg, state, reel, events);
  return { state: { ...state, reel }, events };
}

// ─── Facebook Reel: the same cut on the Page ───────────────────────
//
// Facebook's Reels Publishing API (developers.facebook.com/docs/video-api/guides/reels-publishing):
//   POST /{page}/video_reels upload_phase=start → video_id
//   POST rupload.facebook.com/video-upload/{v}/{video_id}, headers Authorization: OAuth <page token>, file_url: <mp4>
//   POST /{page}/video_reels upload_phase=finish, video_state=PUBLISHED, description
//   GET /{video_id}?fields=status,permalink_url until publishing_phase says published
// Needs pages_manage_posts, pages_read_engagement, pages_show_list (the token has them). 3 to 90 s, 9:16.
// The website link goes in the Page's first comment, never the post (Peter, Nov 20 2026).

const REEL_DONE = ['done', 'failed', 'skipped', 'blocked'];
const FB_RUPLOAD = 'https://rupload.facebook.com/video-upload/v25.0';

/** Is a Facebook Reel wanted and not finished? (an admin "Post on Facebook" wins over the setting) */
function facebookOpen(env, cfg, reel) {
  if (!reel?.mp4Url || reel.stage === 'skipped' || !env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) return false;
  if (cfg.facebook === false && !reel.facebookAsked) return false;
  return !REEL_DONE.includes(reel.facebook?.stage);
}

/** The Instagram caption for Facebook: a "link in bio" sentence means nothing there (the link is in the first comment) */
export function facebookDescription(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.split(/(?<=[.!?])\s+/).filter(x => !/link in (our |the )?bio/i.test(x)).join(' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2200);
}

async function fbUploadFromUrl(env, videoId, fileUrl) {
  const res = await fetch(`${FB_RUPLOAD}/${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${env.FB_PAGE_TOKEN}`, file_url: fileUrl },
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || data.success === false) return { ok: false, error: data.error?.message || data.debug_info?.message || `Facebook upload returned ${res.status}`, code: data.error?.code || null };
  return { ok: true };
}

async function advanceFacebookReel(env, cfg, state, reel, events) {
  const f = { stage: 'start', startedAt: nowIso(), attempts: 0, ...(reel.facebook || {}) };
  f.attempts += 1;
  f.checkedAt = nowIso();
  const setF = (patch) => Object.assign(f, patch, { updatedAt: nowIso() });
  const failF = (error, stage = 'failed') => { setF({ stage, error }); events.push(`fb-reel:${stage}`); };
  try {
    if (Date.now() - Date.parse(f.startedAt) > PIPELINE_TIMEOUT_MS) failF('Timed out after 4 hours');
    else switch (f.stage) {
      case 'start': {
        const s = await graph(env, 'POST', `${env.FB_PAGE_ID}/video_reels`, { upload_phase: 'start' });
        if (!s.ok || !s.data?.video_id) {
          if (isPermissionError(s)) { failF(`Facebook refused: ${s.error}. The page token needs pages_manage_posts.`, 'blocked'); break; }
          setF({ error: s.error || 'Facebook gave no video id' }); if (f.attempts > 6) failF(f.error); break;
        }
        setF({ stage: 'upload', videoId: String(s.data.video_id), error: null });
        events.push('fb-reel:start');
        break;
      }
      case 'upload': {
        const u = await fbUploadFromUrl(env, f.videoId, reel.mp4Url);
        if (!u.ok) { setF({ error: u.error }); if (f.attempts > 8) failF(u.error); break; }
        setF({ stage: 'publish', error: null });
        events.push('fb-reel:uploaded');
        break;
      }
      case 'publish': {
        const description = facebookDescription(reel.caption || renderCaption(cfg.caption, state));
        const p = await graph(env, 'POST', `${env.FB_PAGE_ID}/video_reels`, { video_id: f.videoId, upload_phase: 'finish', video_state: 'PUBLISHED', description });
        if (!p.ok) {
          if (isPermissionError(p)) { failF(`Facebook refused: ${p.error}`, 'blocked'); break; }
          setF({ error: p.error }); if (f.attempts > 12) failF(p.error); break;
        }
        setF({ stage: 'processing', error: null });
        events.push('fb-reel:finish');
        break;
      }
      case 'processing': {
        const s = await graph(env, 'GET', f.videoId, { fields: 'status,permalink_url' });
        if (!s.ok) { setF({ error: s.error }); break; }
        const st = s.data.status || {};
        const vs = st.video_status;
        const failed = ['error', 'upload_failed', 'expired'].includes(vs) || st.processing_phase?.status === 'error' || st.publishing_phase?.status === 'error' || st.publishing_phase?.publish_status === 'error';
        if (failed) { failF(`Facebook could not process the video: ${st.processing_phase?.error?.message || st.uploading_phase?.error?.message || vs || 'unknown'}`); break; }
        const published = st.publishing_phase?.publish_status === 'published' || (vs === 'ready' && ['complete', 'completed'].includes(st.publishing_phase?.status));
        if (!published) break;
        const link = s.data.permalink_url || '';
        const permalink = link ? (link.startsWith('http') ? link : `https://www.facebook.com${link}`) : `https://www.facebook.com/reel/${f.videoId}`;
        setF({ stage: 'done', permalink, publishedAt: nowIso(), error: null });
        events.push('fb-reel:published');
        // The website link as the Page's first comment; the Reel stands either way
        if (state.kidSlug && !f.commentId) {
          const message = `Watch ${state.kidName || 'the'}${state.kidName ? "'s" : ''} whole live reveal on our website: https://sunshineonaranneyday.com/live/${state.kidSlug}/?src=facebook`;
          const c = await graph(env, 'POST', `${f.videoId}/comments`, { message });
          setF(c.ok ? { commentId: c.data?.id || null, commentError: null } : { commentError: c.error || 'unknown' });
          events.push(c.ok ? 'fb-reel:comment' : 'fb-reel:comment-failed');
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    setF({ error: e.message || String(e) });
  }
  reel.facebook = f;
}
