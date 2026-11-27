/**
 * POST /api/media-text — a photo or video texted to SOARD Photos' number
 * ===========================================================================
 * The number's own Messaging Service (./_media-inbox.js setupTextNumber) sends
 * every text here. Signed by Twilio exactly as /api/twilio-inbound is
 * (X-Twilio-Signature over this URL and the form, with the Auth Token). Twilio
 * hears an empty <Response/> at once (it waits 15 seconds at most); the photos
 * are fetched, kept and filed after (./_media-inbox.js receiveText), the files
 * taken off Twilio, and the sender answered by text when replies are on.
 * Twilio's own words (STOP, HELP and the like) are Twilio's: nothing is done.
 * Public in the middleware (Twilio can't sign in): the signature is the proof.
 */

import { twilioSignature } from './twilio-status.js';
import { safeEqual } from './_secure.js';
import { isKeyword } from './twilio-inbound.js';
import { receiveText, sendReply } from './_media-inbox.js';

const MAX_BODY = 32 * 1024;
const twiml = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', { headers: { 'Content-Type': 'text/xml' } });

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.TWILIO_AUTH_TOKEN || !env.MEDIA_FILES) return new Response('Not set up', { status: 503 });
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return new Response('Bad request', { status: 400 });
  const form = Object.fromEntries(new URLSearchParams(raw));
  const expected = await twilioSignature(env.TWILIO_AUTH_TOKEN, request.url, form);
  if (!safeEqual(expected, request.headers.get('X-Twilio-Signature') || '')) return new Response('Forbidden', { status: 403 });
  if (!/^MM|^SM/.test(String(form.MessageSid || '')) || (isKeyword(form.Body, form.OptOutType) && !Number(form.NumMedia))) return twiml();
  const work = receiveText(env, form).then((row) => sendReply(env, row)).catch((e) => console.error('[media-text]', e.message));
  if (context.waitUntil) context.waitUntil(work); else await work;
  return twiml();
}
