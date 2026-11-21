/**
 * POST /api/stream-webhook — Cloudflare Notifications → Stream Live events
 * =========================================================================
 * Cloudflare sends { data: { input_id, event_type, ... } } when the live
 * input connects, disconnects or errors. The payload is a WAKE-UP CALL only:
 * it never changes state by itself. The tick it starts asks Stream's own
 * lifecycle endpoint what is true and reconciles from that.
 *
 * Signed: the webhook destination has a secret, which Cloudflare sends in the
 * cf-webhook-auth header, and the same value is set here as
 * STREAM_WEBHOOK_SECRET. A wrong or missing header is refused (401). A signed
 * call for our live input forces an immediate tick (at most one every 5 s).
 * An error on the live input is only noted (health.encoderError): the feed
 * watch texts it only if the video hasn't recovered 30 s later, and else
 * leaves a quiet Slack note (ENCODER in _broadcast-monitor.js; Peter, Nov 21
 * 2026: "only real problems"). An account error (storage full, no Stream
 * plan) and any error on the rehearsal input alert at once, once per input
 * per 15 minutes.
 *
 * Unsigned (STREAM_WEBHOOK_SECRET not set yet): anyone could have sent it,
 * so it only starts an ordinary, throttled tick. No alerts, nothing forced.
 *
 * Nothing from the payload reaches staff, the hub or the response: the alert
 * is built from our own text (live or rehearsal by our own input ids, the
 * error code and codecs only from fixed lists), the hub gets one of Stream's
 * three event names, and the reply is always { ok: true }.
 *
 * Set up once: Cloudflare dashboard → Notifications → Destinations →
 * Webhooks → Create, URL = this endpoint, Secret = a long random value. Add
 * the same value in Cloudflare Pages as STREAM_WEBHOOK_SECRET. Then
 * Notifications → Add → Stream → "Stream Live Notifications", attach the
 * webhook. Or use the Alerting API (see docs/live-broadcast.md).
 */

import { runTick, readConfig, readState, publishToHub, noteWebhook, noteEncoderError, ensureSchema, SITE_ORIGIN } from './_broadcast.js';
import * as notify from './_broadcast-notify.js';
import { ENCODER, ENCODER_ERRORS, ACCOUNT_ERRORS, encoderWords, ADMIN_URL } from './_broadcast-monitor.js';
import { safeEqual } from './_secure.js';
import { limit } from './_rate-limit.js';

const EVENTS = new Set(['live_input.connected', 'live_input.disconnected', 'live_input.errored']);
const CODECS = new Set(['h264', 'avc', 'hevc', 'h265', 'av1', 'vp8', 'vp9', 'aac', 'opus', 'mp3', 'ac3', 'eac3']);
const ERROR_ALERT_EVERY_SEC = 15 * 60;
const FORCED_TICK_EVERY_SEC = 5;
// Unsigned calls do nothing an anonymous visitor couldn't, but still cost D1 writes: cap them site-wide
const UNSIGNED_PER_MINUTE = 30;
const MAX_BODY_BYTES = 16 * 1024;

const ok = () => Response.json({ ok: true });

export async function onRequestGet() {
  return Response.json({ ok: true, endpoint: 'stream-webhook', method: 'POST' });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const secret = String(env.STREAM_WEBHOOK_SECRET || '').trim();
  const signed = !!secret && safeEqual((request.headers.get('cf-webhook-auth') || '').trim(), secret);
  if (secret && !signed) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body = {};
  try {
    // Stream's payloads are a few hundred bytes; a big body is never read, let alone parsed
    if (Number(request.headers.get('content-length') || 0) <= MAX_BODY_BYTES) {
      const text = await request.text();
      if (text.length <= MAX_BODY_BYTES) body = JSON.parse(text);
    }
  } catch { /* Cloudflare's "Save and Test" may send a plain body */ }
  const data = body?.data && typeof body.data === 'object' ? body.data : {};
  const named = typeof data.event_type === 'string' ? data.event_type
    : typeof body?.text === 'string' ? body.text.match(/Event type: (\S+)/)?.[1] : null;
  // Only Stream's three event names are kept; anything else (Cloudflare's test included) is a 'test'
  const event = EVENTS.has(named) ? named : 'test';

  try {
    await ensureSchema(env.DB);
    if (!signed && !(await limit(env.DB, 'stream-webhook:unsigned', UNSIGNED_PER_MINUTE, 60)).ok) return ok();
    const config = await readConfig(env.DB);
    const inputId = typeof data.input_id === 'string' ? data.input_id : null;
    const which = !inputId ? null
      : inputId === config.liveInput?.uid ? 'live'
      : inputId === config.rehearsalInput?.uid ? 'rehearsal' : null;
    await noteWebhook(env.DB, { event, inputId: which ? inputId : null, signed });

    if (!signed) {
      // Unsigned: an ordinary throttled check, like a visitor's, after the reply
      context.waitUntil((async () => {
        const r = await runTick(env, { source: 'webhook' });
        if (r.changed && !r.cached && !r.busy) await publishToHub(env, await readState(env.DB), config, 'webhook');
      })().catch((err) => console.error('[stream-webhook]', err.message)));
      return ok();
    }

    if (event === 'live_input.errored' && which) {
      const facts = errorFacts(data.live_input_errored);
      if (which === 'live' && !ACCOUNT_ERRORS.has(facts.code)) {
        // The phone's error on the live input: only noted. The feed watch texts it only if the video
        // hasn't recovered (ENCODER in _broadcast-monitor.js)
        await noteEncoderError(env.DB, { ...facts, windowMs: ENCODER.windowMs });
        // No watch runs with no reveal on air (nothing scheduled, or a quiet test): a quiet Slack note instead
        const state = await readState(env.DB);
        if ((state.quiet || state.phase === 'idle') && (await limit(env.DB, 'stream-webhook:errored:note', 1, ERROR_ALERT_EVERY_SEC)).ok) {
          context.waitUntil(offAirNote(env, facts.code).catch((err) => console.error('[stream-webhook]', err.message)));
        }
      } else if ((await limit(env.DB, `stream-webhook:errored:${which}`, 1, ERROR_ALERT_EVERY_SEC)).ok) {
        // Once per input per 15 minutes, however often Stream repeats it
        context.waitUntil(notify.alertAdmins(env, config, errorAlert(which, data.live_input_errored)));
      }
    }

    if (which === 'live') {
      // Reconcile right now (forced at most every 5 s), then push to every open page. After the
      // reply: a forced tick may first wait a few seconds for a running one, and Cloudflare
      // shouldn't wait on that (or cut it off by giving up on the call)
      context.waitUntil((async () => {
        const force = (await limit(env.DB, 'stream-webhook:force', 1, FORCED_TICK_EVERY_SEC)).ok;
        await runTick(env, { source: `webhook:${event}`, force });
        await publishToHub(env, await readState(env.DB), config, 'webhook', event === 'test' ? undefined : { type: event });
      })().catch((err) => console.error('[stream-webhook]', err.message)));
    }
    return ok();
  } catch (err) {
    // Always 200 so Cloudflare doesn't disable the destination over our bug
    console.error('[stream-webhook]', err.message);
    return ok();
  }
}

/** An error's code and codecs, each only from a fixed list (null / 'unknown' otherwise) */
export function errorFacts(errored) {
  const raw = errored && typeof errored === 'object' ? errored : {};
  const code = typeof raw.error?.code === 'string' && Object.hasOwn(ENCODER_ERRORS, raw.error.code) ? raw.error.code : null;
  const codec = (v) => (typeof v === 'string' && CODECS.has(v.trim().toLowerCase()) ? v.trim().toLowerCase() : 'unknown');
  return { code, videoCodec: codec(raw.video_codec), audioCodec: codec(raw.audio_codec) };
}

/** The live input's error with no reveal on air: Slack only, no @here, no email, no text */
function offAirNote(env, code) {
  const [what, fix] = encoderWords(code);
  const title = `Stream flagged the phone's video: ${what.replace(/\.$/, '')}`;
  return notify.slackPost(env, notify.adminCard({ level: 'info', icon: '📝', title, detail: 'No reveal was on air (a test?), so nobody was texted. If it comes back, fix the phone before the next reveal.', fix, url: ADMIN_URL }));
}

/** The staff alert for an input error, from our own words only */
export function errorAlert(which, errored) {
  const { code, videoCodec, audioCodec } = errorFacts(errored);
  const [what, theFix] = encoderWords(code);
  return {
    level: 'error',
    urgent: which === 'live',
    // Staff phones get the plain-words version: what's wrong, the fix (never the error code)
    text: which === 'live' ? notify.alertText({ title: `Stream error: ${what.replace(/\.$/, '')}`, fix: theFix, url: `${notify.SITE_ORIGIN}/admin/#broadcast/control-room`, tone: 'alert' }) : false,
    title: `Stream input error${which === 'live' ? '' : ' (rehearsal)'}: ${code || 'unknown'}`,
    detail: what,
    facts: [['Video codec', videoCodec], ['Audio codec', audioCodec]],
    fix: theFix,
    url: `${SITE_ORIGIN}/admin/`,
  };
}
