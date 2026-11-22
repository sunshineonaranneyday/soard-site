/**
 * POST /api/twilio-inbound: staff answering "Is the reveal over?" by text
 * ===========================================================================
 * When the phone stops sending during a broadcast, the staff alert numbers get
 * "Is the reveal over? Reply Y if it's over, or N if the signal dropped"
 * (askIfOver in _broadcast.js). Their reply comes here: Twilio's incoming-message
 * webhook for the Messaging Service (connected from /api/broadcast
 * connectTextReplies, never on its own).
 *
 * Signed exactly as /api/twilio-status: X-Twilio-Signature = Base64(HMAC-SHA1(
 * TWILIO_AUTH_TOKEN, the URL as Twilio called it followed by every form field's
 * name and value, sorted by name)). No token set: 503. A signature that doesn't
 * match: 403, and nothing changes.
 *
 * Only a number on the alert list (Reveals → Settings → Alerts) is heard;
 * anyone else gets no reply at all. Twilio's own keywords (STOP, START, HELP
 * and the like) are Twilio's: answered with an empty <Response/>, never acted
 * on. Y / N go to answerByText; anything else gets a one-line help reply (a few
 * at most, so an auto-reply on a staff phone can't start a loop). The answer
 * is TwiML: <Response><Message>…</Message></Response>.
 */

import * as notify from './_broadcast-notify.js';
import { readConfig, answerByText } from './_broadcast.js';
import { twilioSignature } from './twilio-status.js';
import { safeEqual } from './_secure.js';
import { limit } from './_rate-limit.js';

const MAX_BODY = 16 * 1024;
// A help reply at most this many times per number in HELP_WINDOW_S
const HELP_MAX = 3;
const HELP_WINDOW_S = 10 * 60;

// Twilio's opt-out, opt-in and help keywords (its defaults and the newer ones). YES is also an opt-in
// keyword to Twilio, but here it is the answer, so it is read as one (Twilio may add its own note).
const KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE', 'START', 'UNSTOP', 'HELP', 'INFO']);

/** Is this one of Twilio's keywords (which Twilio answers itself)? */
export function isKeyword(body, optOutType = '') {
  const word = String(body || '').trim().replace(/[\s.!?]+$/, '').toUpperCase();
  if (KEYWORDS.has(word)) return true;
  // Twilio says so (Advanced Opt-Out): a STOP or HELP of the account's own words. Its START may be our YES
  const type = String(optOutType || '').toUpperCase();
  return type === 'STOP' || type === 'HELP' || (type === 'START' && !/^Y/.test(word));
}

// Ending a live reveal must be deliberate: only these, whole (after trimming, lowercasing and dropping
// trailing punctuation). Anything else, a phone's reaction ('Liked "…"') included, is asked again.
const YES = new Set(['y', 'yes', 'yep', 'yeah', 'yup', "yes it's over", 'yes its over', "it's over", 'its over', 'over', 'done', '👍']);
const NO = new Set(['n', 'no', 'nope', 'not over', 'not yet', 'dropped', 'signal dropped', 'keep going']);

/** A reply → 'yes' | 'no' | null (not a clear answer: the help reply) */
export function readAnswer(body) {
  const t = String(body || '').normalize('NFC').trim().toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, '') // a thumbs up in any skin tone
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?,;:]+$/u, '');
  if (YES.has(t)) return 'yes';
  if (NO.has(t)) return 'no';
  return null;
}

/** "…1234": how a staff number is named in the log, Slack and the admin (the alert list has numbers, not names) */
export const whoTexted = (num) => `…${String(num || '').slice(-4)}`;

export const HELP_TEXT = 'Reply Y if the reveal is over, or N if the signal dropped.';
// Never one of Twilio's opt-out words (STOP, END, CANCEL, QUIT, UNSUBSCRIBE, STOPALL): a reply in those unsubscribes
export const BUSY_TEXT = "Sorry, that didn't go through. Reply Y or N again.";
/** How long the reply may take (Twilio gives up at 15 s; the rest of the handler takes well under 2) */
export const timing = { replyWithinMs: 10 * 1000 };

/** The reply to an answer, in plain words (one text) */
export function answerReply(answer, { outcome, state, config }, now = Date.now()) {
  const tz = config?.timezone || 'America/New_York';
  switch (outcome) {
    case 'ended': return 'Ended. Viewers see the last moments, then Thank you for watching. The replay follows in a few minutes.';
    case 'test-ended': return 'Test ended. The site is back to how it was before the test.';
    case 'pre-show': return 'Ended. It stopped before the start time, so the countdown is back up for the reveal.';
    case 'held':
    case 'test-held': return "OK, staying live. Viewers see Reconnecting until the phone is back (up to 15 min). Reply Y if it's over.";
    case 'phone-back': return answer === 'yes'
      ? "The phone is sending again, so it's still live. If it goes quiet and the reveal is over, reply Y."
      : "The phone is sending again, so it's still live.";
    case 'not-asked': return "The stream stopped again just now. You'll get a new question about it in a few seconds.";
    case 'old-link': return 'This link was for an earlier reveal or stop, so nothing changed.';
    case 'already-ended': {
      const by = String(state?.endedBy || '');
      const how = by.startsWith('text from ') ? `, by a ${by}` : by.startsWith('link from ') ? `, by the link texted to ${by.slice(10)}` : by ? ', from the admin' : ', after the phone stopped';
      const when = state?.endedAt ? ` at ${notify.clockTime(state.endedAt, tz, now)}` : '';
      const back = state?.rejoinUntil && now < Date.parse(state.rejoinUntil)
        ? ` If the phone streams again by ${notify.clockTime(state.rejoinUntil, tz, now)}, the same reveal picks back up.` : '';
      return `It already ended${when}${how}.${back}`;
    }
    case 'slow': return 'Got it. The site is slow to answer right now, so check the live page in a minute.';
    case 'busy': return BUSY_TEXT;
    default: return "No live reveal is waiting on its phone right now, so there's nothing to do.";
  }
}

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** TwiML: a reply, or none (an empty <Response/>) */
export function twiml(message = null) {
  const body = message ? `<Response><Message>${escXml(notify.smsSafe(message))}</Message></Response>` : '<Response/>';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.TWILIO_AUTH_TOKEN) return new Response('Not set up', { status: 503 });
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return new Response('Bad request', { status: 400 });
  const params = Object.fromEntries(new URLSearchParams(raw));
  const expected = await twilioSignature(env.TWILIO_AUTH_TOKEN, request.url, params);
  if (!safeEqual(expected, request.headers.get('X-Twilio-Signature') || '')) return new Response('Forbidden', { status: 403 });

  // From here on every answer is TwiML, whatever fails (a D1 error never becomes a 500 Twilio retries or logs)
  let staff = false;
  try {
    // STOP, START, HELP and the rest are Twilio's to answer
    if (isKeyword(params.Body, params.OptOutType)) return twiml();
    const config = await readConfig(env.DB);
    const from = notify.normalizePhone(params.From);
    if (!from || !notify.alertPhones(config).includes(from)) return twiml();
    staff = true;

    const answer = readAnswer(params.Body);
    if (!answer) {
      let ok = true;
      try { ok = (await limit(env.DB, `twilio-inbound-help:${from}`, HELP_MAX, HELP_WINDOW_S)).ok; } catch { /* fail open: one more help line */ }
      return twiml(ok ? HELP_TEXT : null);
    }
    const waitUntil = (p) => { if (context.waitUntil) context.waitUntil(p); };
    // After a "Got it" (slow), the real outcome follows by text, to this number only: a lost answer is never hidden
    const onLate = (r) => notify.sendSms(env, { to: [from], body: notify.smsSafe(answerReply(answer, { config, ...r })) });
    const r = await answerByText(env, { answer, who: whoTexted(from), waitUntil, replyWithinMs: timing.replyWithinMs, onLate });
    return twiml(answerReply(answer, { config, ...r }));
  } catch {
    return twiml(staff ? BUSY_TEXT : null);
  }
}
