/**
 * /api/broadcast — public state + admin commands
 * ================================================
 * GET  (public)  → { state, reminders, timezone, hub }  see _broadcast.publicPayload
 *                  Every public GET also piggybacks a throttled tick in
 *                  waitUntil, so the state machine keeps moving even if the
 *                  real-time hub is ever down (the same trick live-status
 *                  used for the archive sweep). Never forced: it runs only
 *                  when no tick has started anywhere in the last 20 s.
 * POST (Access)  → { action, ... }  schedule | update | cancel | goLiveManual |
 *                  endNow | clearReplay | extendReplay | setReplay | reset |
 *                  quietTest { on }   test mode: the main feed on the website only (_broadcast.js)
 *                  textRepliesStatus | connectTextReplies   does a staff reply to the alert number
 *                  ("Is the reveal over?" Y/N) reach /api/twilio-inbound? Read, or set on Twilio's
 *                  Messaging Service, only when asked (_broadcast-notify.js)
 * POST is staff only: the API middleware lets only /api/broadcast GETs through without a staff
 * Access sign-in (_middleware.js PUBLIC_GET_ROUTES), as for every admin command here.
 */

import { publicPayload, adminAction, runTick } from './_broadcast.js';
import { textRepliesStatus, connectTextReplies } from './_broadcast-notify.js';
import { logAudit } from './_audit.js';

export async function onRequestGet(context) {
  const { env } = context;
  try {
    context.waitUntil(runTick(env, { source: 'visitor', minIntervalMs: 20000 }).catch(() => {}));
    const payload = await publicPayload(env);
    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ state: null, error: err.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  let body = {};
  try { body = await context.request.json(); } catch { /* empty */ }
  const userEmail = context.data?.userEmail || 'unknown';
  // Text replies: Twilio's setting, not the broadcast's state, so no tick lease
  if (body.action === 'textRepliesStatus' || body.action === 'connectTextReplies') {
    const connect = body.action === 'connectTextReplies';
    const r = connect ? await connectTextReplies(env) : await textRepliesStatus(env);
    if (connect && r.ok) await logAudit(env.DB, { userEmail, action: 'updated', entityType: 'live-status', entitySlug: 'text-replies', entityName: `Text replies sent to ${r.url || 'the site'}`, gitStatus: 'ok' });
    const { ok, status, ...rest } = r;
    return Response.json({ success: ok, ...rest }, { status: ok ? 200 : (status || 502) });
  }
  try {
    const r = await adminAction(env, body.action, body, userEmail);
    return Response.json(r, { status: r.success ? 200 : (r.status || 400) });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
