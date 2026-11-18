/**
 * "Or tap:" links in the "Is the reveal over?" text (askIfOver in _broadcast.js)
 * ===========================================================================
 * A text can't have buttons (Peter, Nov 18 2026: "can the text have response
 * buttons?"), so each staff number's question ends with its own link to a page
 * with two (functions/over/[token].js, answered at /api/over-answer).
 *
 * The token names the broadcast, the stop it asks about (the question's
 * stretch on air, the over-ask claim), the staff number it went to, and when
 * it stops working (OVER_LINK_MS), signed with HMAC-SHA256 under a key derived
 * from TWILIO_AUTH_TOKEN (never the token itself). That secret is set whenever
 * the question can be texted at all, so nothing new needs setting by hand.
 * Short, so the text stays two segments:
 *   <broadcast ms>.<stretch ms>.<number>.<expiry s>.<signature>   (base 36, then 16 base64url characters)
 */

import { normalizePhone } from './_broadcast-notify.js';
import { safeEqual } from './_secure.js';

export const OVER_LINK_MS = 30 * 60 * 1000;
export const OVER_LINK_BASE = 'https://sunshineonaranneyday.com/over/';
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const B36 = /^[0-9a-z]{1,13}$/;

async function linkKey(env) {
  if (!env?.TWILIO_AUTH_TOKEN) return null;
  const base = await crypto.subtle.importKey('raw', enc.encode(String(env.TWILIO_AUTH_TOKEN)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', base, enc.encode('soard over-answer link v1'));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(key, body) {
  return b64u((await crypto.subtle.sign('HMAC', key, enc.encode(`v1.${body}`))).slice(0, 12));
}

/** The stretch's over-ask key from its start (as overAskKey makes it) */
export const stretchKey = (ms) => `over-ask:${new Date(ms).toISOString()}`;

/**
 * A link for one staff number about one stop → URL, or null when one can't be made (no secret, an id or stretch
 * that isn't a time). `key` is the stop's over-ask claim key ("over-ask:<ISO>").
 */
export async function overLinkFor(env, { broadcastId, key, phone, now = Date.now() }) {
  const id = /^live-(\d{1,15})$/.exec(String(broadcastId || ''))?.[1];
  const seg = Date.parse(String(key || '').replace(/^over-ask:/, ''));
  const num = normalizePhone(phone);
  const k = await linkKey(env);
  if (!id || !Number.isFinite(seg) || stretchKey(seg) !== key || !num || !k) return null;
  const body = [Number(id).toString(36), seg.toString(36), Number(num.slice(2)).toString(36), Math.floor((now + OVER_LINK_MS) / 1000).toString(36)].join('.');
  return `${OVER_LINK_BASE}${body}.${await sign(k, body)}`;
}

/**
 * A token from a link → { ok: true, broadcastId, key, phone, expiresAt } or { ok: false, why: 'bad' | 'expired' }.
 * The signature is checked before anything in it is believed.
 */
export async function readOverLink(env, token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 5 || !parts.slice(0, 4).every((p) => B36.test(p)) || !/^[A-Za-z0-9_-]{16}$/.test(parts[4])) return { ok: false, why: 'bad' };
  const k = await linkKey(env);
  if (!k) return { ok: false, why: 'bad' };
  const body = parts.slice(0, 4).join('.');
  if (!safeEqual(await sign(k, body), parts[4])) return { ok: false, why: 'bad' };
  const [id, seg, num, exp] = parts.slice(0, 4).map((p) => parseInt(p, 36));
  const phone = normalizePhone(String(num).padStart(10, '0'));
  if (!phone) return { ok: false, why: 'bad' };
  if (now >= exp * 1000) return { ok: false, why: 'expired' };
  return { ok: true, broadcastId: `live-${id}`, key: stretchKey(seg), phone, expiresAt: exp * 1000 };
}
