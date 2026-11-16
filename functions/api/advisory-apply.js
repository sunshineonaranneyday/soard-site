/**
 * /api/advisory-apply — the public Advisory Board application (page: /advisory-board/apply/)
 * ===========================================================================
 * GET               → { ok, turnstileSiteKey } (null when Turnstile isn't set up)
 * POST multipart    payload: JSON { answers, website, turnstileToken, startedAt, elapsedMs, sendId, photoAt }
 *                   (sendId: the page's id for this application, the same on every send of it: two at once are one;
 *                   elapsedMs: how long since it was started, by the device's own clock)
 *                   headshot: the photo, a JPEG the page drew (required)
 *                   → { ok: true, first } once it's stored
 *                   → 422 { ok: false, problems: { field: message } } when an answer (or the headshot) needs a
 *                     look (checked before Turnstile, so fixing a typo doesn't need a second robot check)
 * POST JSON         (a page opened before the headshot was asked for) → 400, asking them to reload: their
 *                   answers are saved on their device, and the page then asks for the photo
 *
 * Public: listed in the middleware's PUBLIC_ROUTES and rate limited per IP
 * there (5 a minute), and here per day across every isolate. A honeypot field
 * ("website"), a too-fast check, and Turnstile (once TURNSTILE_SECRET_KEY is
 * set) keep bots out; a bot's send is answered like a person's and dropped.
 * The applicant's copy, the staff email and the Slack card go after the
 * answer (./_advisory-applications.js notifyNew).
 */

import { submitApplication, notifyNew, readHeadshot } from './_advisory-applications.js';
import { checkAnswers, greetName, HEADSHOT_MAX_BYTES, PHOTO_ADDED } from './_advisory-form.js';
import { turnstileOn, turnstileSiteKey, verifyTurnstile, clientIp } from './_secure.js';

const MAX_BODY = 64 * 1024; // the answers
const MAX_UPLOAD = HEADSHOT_MAX_BYTES + MAX_BODY; // the answers and the headshot
const RELOAD = 'This page has changed since you opened it: we now ask for a headshot. Please reload the page. Your answers are saved on this device.';
const PER_DAY = 5;
const TOO_FAST_MS = 20 * 1000; // nobody reads and answers five steps in 20 seconds
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function ipHash(ip, pepper = '') {
  const data = new TextEncoder().encode(`soard-advisory:${ip || 'unknown'}`);
  const buf = pepper
    ? await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pepper)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data)
    : await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One of this place's `max` a day, taken in one step (./_rate-limit.js's counter: ten at once can't all slip under
 * it) → true when there was one left. Given back when the application isn't stored after all. Like that counter,
 * D1 not answering lets the person through: the edge's own limit still applies.
 */
async function takeOne(DB, key, max, windowSec, now) {
  try {
    await DB.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)').run();
    const row = await DB.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
      WHERE rate_limits.reset_at <= ?3 OR rate_limits.count < ?4
      RETURNING count`).bind(key, now + windowSec * 1000, now, max).first();
    return !!row;
  } catch (e) {
    console.warn('[advisory-apply] daily limit: D1 unavailable, allowing:', e?.message);
    return true;
  }
}
const giveBack = (DB, key) => DB.prepare('UPDATE rate_limits SET count = count - 1 WHERE key = ? AND count > 0').bind(key).run();

export async function onRequestGet({ env }) {
  return json({ ok: true, turnstileSiteKey: turnstileOn(env) ? turnstileSiteKey(env) : null });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return json({ ok: false, error: 'The application isn’t available right now. Please try again later.' }, 500);
  const multipart = /^multipart\/form-data\b/i.test(request.headers.get('content-type') || '');
  if (Number(request.headers.get('content-length') || 0) > (multipart ? MAX_UPLOAD : MAX_BODY)) return json({ ok: false, error: multipart ? 'That photo is too large to send. Please choose a smaller one.' : 'That’s too much to send at once.' }, 413);
  let body;
  let file = null;
  try {
    if (multipart) {
      const form = await request.formData();
      const payload = form.get('payload');
      if (typeof payload !== 'string') return json({ ok: false, error: 'That didn’t come through. Please try again.' }, 400);
      if (payload.length > MAX_BODY) return json({ ok: false, error: 'That’s too much to send at once.' }, 413);
      body = JSON.parse(payload);
      file = form.get('headshot');
    } else {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ ok: false, error: 'That’s too much to send at once.' }, 413);
      body = JSON.parse(text);
    }
  } catch {
    return json({ ok: false, error: 'That didn’t come through. Please try again.' }, 400);
  }
  const now = Date.now();
  // Not the page's shape (no answers, no start time): it didn't come through, said as that (never "slow down")
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers) || body.startedAt == null) {
    return json({ ok: false, error: 'That didn’t come through. Please reload the page and send it again: your answers are kept.' }, 400);
  }
  // The hidden box filled in (people never see it; bots fill every box): answered like a person, and dropped
  const started = Number(body?.startedAt);
  if (String(body?.website || '').trim()) return json({ ok: true, first: '' });
  // No start time, or sent faster than anyone reads five steps (by the device's own count: a clock against itself;
  // one turned back says nothing): never a "Thank you" for something dropped, since a person whose clock was changed
  // lands here too. Said, and Send again works a moment later
  const elapsed = body?.elapsedMs != null && Number.isFinite(Number(body.elapsedMs)) ? Number(body.elapsedMs) : now - started;
  if (!Number.isFinite(started) || started <= 0 || (elapsed >= 0 && elapsed < TOO_FAST_MS)) {
    return json({ ok: false, code: 'too-fast', error: 'Please take a moment to look over your answers, then press Send again.' }, 400);
  }
  // A page from before the headshot was asked for sends its answers as JSON, with no photo and nowhere to add one:
  // reloaded, it asks. Anything else that isn't the page's form didn't come through
  if (!multipart && !/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json({ ok: false, error: 'That didn’t come through. Please try again.' }, 400);
  if (!multipart) return json({ ok: false, code: 'reload', error: RELOAD }, 400);
  // Answers first: a fixable mistake must not spend the applicant's Turnstile check (each token works once).
  // The headshot's answer is whether a photo we can use came, never what the page said about it
  const shot = await readHeadshot(file);
  const { problems: early } = checkAnswers({ ...(body?.answers || {}), headshot: shot.headshot ? PHOTO_ADDED : '' });
  if (shot.problem) early.headshot = shot.problem;
  if (Object.keys(early).length) return json({ ok: false, problems: early, error: 'A few answers need a look.' }, 422);
  const ip = clientIp(request);
  if (turnstileOn(env) && !(await verifyTurnstile(env, body?.turnstileToken, ip))) {
    return json({ ok: false, code: 'turnstile', error: 'Please confirm you’re not a robot, then send it again.' }, 400);
  }
  const hash = await ipHash(ip, env.APPLY_IP_PEPPER || env.LIVE_IP_PEPPER);
  // Five applications a day from one place: only ones stored count (a send that failed, or the same one again, doesn't,
  // and the same one again is answered as itself, never turned away by the limit)
  const limitKey = `advisory-apply:${hash}`;
  const LIMITED = 'We’ve had several applications from here today. Please write to info@soardcharity.com and we’ll help.';

  let stored;
  try {
    stored = await submitApplication(env, body?.answers || {}, {
      ipHash: hash, now, headshot: shot.headshot, sendId: body?.sendId, photoAt: body?.photoAt, photoSeq: body?.photoSeq,
      reserve: () => takeOne(env.DB, limitKey, PER_DAY, 24 * 3600, now), unreserve: () => giveBack(env.DB, limitKey),
    });
  } catch (e) {
    // Cloudflare refused the picture itself: a photo to choose again
    // (spent: the robot check was used by this send, so the page gets a fresh one before the next)
    if (e?.status === 422 && e.field === 'headshot') return json({ ok: false, problems: { headshot: e.message }, error: 'A few answers need a look.', spent: true }, 422);
    // The headshot couldn't be saved (Cloudflare Images busy): nothing was kept, and Send again works
    if (e?.status === 503) return json({ ok: false, error: e.message }, 503);
    throw e;
  }
  const { app, problems, repeat, limited } = stored;
  if (problems) return json({ ok: false, problems, error: 'A few answers need a look.' }, 422);
  if (limited) return json({ ok: false, error: LIMITED }, 429);
  if (!repeat) {
    const send = notifyNew(env, app, { now });
    if (context.waitUntil) context.waitUntil(send); else await send;
  }
  const first = greetName(app.answers);
  return json({ ok: true, first });
}
