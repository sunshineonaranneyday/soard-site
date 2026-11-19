/**
 * /api/live-messages — messages for the family on the live reveal page
 * =====================================================================
 * GET  (public) → { ok, open, enabled, broadcastId, messages: [{ id, name, body, at }] }
 *                 shown messages for the current reveal, oldest first
 * POST (public, from our own pages only) { name, body, website (honeypot) }
 *               → 200 { ok, status: 'shown', message }
 *                 202 { ok, status: 'held' }        a person approves it first
 *                 403 { ok: false, error }          posted from another site
 *                 422 { ok: false, error }          screening said no
 *                 429 / 409 { ok: false, error }    rate limit, duplicate, or messages closed
 * Who posted is a random id this endpoint sets as an HttpOnly cookie on the
 * first post (a clientId the browser sends is ignored), plus the address.
 * Screening, limits and the hub relay live in _live-messages.js.
 * GET ?b=<broadcast id> → that reveal's shown messages (a child's own page shows their past reveal for good,
 *                 functions/live/_past-reveal.js); open only when it's the current reveal's
 * ?rehearsal (GET and POST): a staff rehearsal's own messages (_broadcast-rehearsal.js), for signed-in staff only:
 * 403 for anyone else, 409 when no rehearsal is on.
 */

import { listShown, postMessage } from './_live-messages.js';
import { crossSiteChange } from './_origin-guard.js';
import { clientIp } from './_secure.js';
import { b64u, SITE_ORIGIN } from './_broadcast-notify.js';
import { isAuthenticated } from './_middleware.js';
import { rehearsalFor } from './_broadcast-rehearsal.js';
import { BROADCAST_ID_RE } from '../live/_past-reveal.js';

const noStore = { 'Cache-Control': 'no-store' };
const VISITOR_COOKIE = 'soard_live_visitor';
const VISITOR_MAX_AGE = 180 * 24 * 3600;

/** The visitor id this endpoint set earlier, or null */
export function visitorFrom(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)soard_live_visitor=([A-Za-z0-9_-]{16,64})(?:;|$)/);
  return m ? m[1] : null;
}

export function visitorCookie(id) {
  return `${VISITOR_COOKIE}=${id}; Path=/api/live-messages; Max-Age=${VISITOR_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * ?rehearsal: a staff rehearsal's messages (_broadcast-rehearsal.js), for signed-in staff only. Undefined when the
 * request isn't one; a Response when it is but can't be (not signed in, or no rehearsal on).
 */
async function rehearsalOf(context) {
  const url = context.request?.url;
  if (!url || !new URL(url).searchParams.has('rehearsal')) return undefined;
  if (!(await isAuthenticated(context.request, context.env))) return Response.json({ ok: false, error: 'Sign in to the admin to see the rehearsal.' }, { status: 403, headers: noStore });
  const r = await rehearsalFor(context.env.DB);
  return r || Response.json({ ok: false, error: 'No rehearsal is on.' }, { status: 409, headers: noStore });
}

export async function onRequestGet(context) {
  try {
    const rehearsal = await rehearsalOf(context);
    if (rehearsal instanceof Response) return rehearsal;
    const b = context.request?.url ? new URL(context.request.url).searchParams.get('b') : null;
    const broadcastId = !rehearsal && b && BROADCAST_ID_RE.test(b) ? b : null;
    const r = await listShown(context.env, { rehearsal: rehearsal || null, broadcastId });
    return Response.json(r, { headers: noStore });
  } catch (err) {
    return Response.json({ ok: false, messages: [], error: err.message }, { status: 500, headers: noStore });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  // Notes come from the reveal page itself, never a form or script on another site
  if (crossSiteChange(request, [SITE_ORIGIN])) {
    return Response.json({ ok: false, error: 'Please post from the reveal page on our site.' }, { status: 403, headers: noStore });
  }
  const rehearsal = await rehearsalOf(context);
  if (rehearsal instanceof Response) return rehearsal;
  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  if (!body || typeof body !== 'object') body = {};
  const known = visitorFrom(request);
  const visitorId = known || b64u.encode(crypto.getRandomValues(new Uint8Array(18)));
  const headers = { ...noStore, ...(known ? {} : { 'Set-Cookie': visitorCookie(visitorId) }) };
  try {
    const r = await postMessage(env, {
      name: body.name,
      body: body.body,
      visitorId,
      newVisitor: !known,
      hp: body.website,
      ip: request.headers.get('CF-Connecting-IP') ? clientIp(request) : '',
      rehearsal: rehearsal || null,
    });
    const { httpStatus, ...out } = r;
    return Response.json(out, { status: httpStatus || 200, headers });
  } catch (err) {
    return Response.json({ ok: false, error: 'Something went wrong. Please try again.', detail: err.message }, { status: 500, headers });
  }
}
