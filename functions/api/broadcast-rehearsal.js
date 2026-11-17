/**
 * /api/broadcast-rehearsal — the staff rehearsal of the live page (_broadcast-rehearsal.js)
 * ======================================================================================
 * Staff only: not on the middleware's public lists, so a signed-in staff Access session is needed for every call.
 * GET  → /api/broadcast's answer shaped from the rehearsal ({ state, reminders, messages, timezone, rehearsal }), and
 *        each ask moves the rehearsal along (the live page asks every few seconds). ?options adds the kids to pick.
 * POST { action: 'start', kidSlug, minutes } | { action: 'end' }
 */

import { rehearsalPayload, startRehearsal, endRehearsal, START_IN_MINUTES } from './_broadcast-rehearsal.js';
import { cachedReveals } from './_reveals.js';
import { readState } from './_broadcast.js';

const noStore = { 'Cache-Control': 'no-store' };

/** The kids a rehearsal can be for: the reveal on the site now, then the ones coming up */
async function kidOptions(env) {
  const [real, schedule] = await Promise.all([readState(env.DB).catch(() => null), cachedReveals(env).catch(() => null)]);
  const out = [];
  const add = (slug, name, note) => { if (slug && !out.some((k) => k.slug === slug)) out.push({ slug, name: name || slug, note }); };
  if (real?.kidSlug && !real.test && ['scheduled', 'armed', 'live', 'ending', 'replay'].includes(real.phase)) add(real.kidSlug, real.kidName, 'on the site now');
  for (const r of schedule?.upcoming || []) add(r.slug, r.name, r.confirmed ? r.date : 'date not set');
  return out;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  try {
    const payload = await rehearsalPayload(env);
    if (new URL(request.url).searchParams.has('options')) {
      payload.options = { kids: await kidOptions(env), minutes: START_IN_MINUTES };
    }
    return Response.json(payload, { headers: noStore });
  } catch (err) {
    return Response.json({ state: null, error: err.message }, { status: 500, headers: noStore });
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  let body = {};
  try { body = await context.request.json(); } catch { /* empty */ }
  const by = context.data?.userEmail || 'unknown';
  try {
    if (body.action === 'start') {
      const r = await startRehearsal(env, { kidSlug: String(body.kidSlug || ''), minutes: body.minutes, by });
      if (!r.ok) return Response.json({ success: false, error: r.error }, { status: 400, headers: noStore });
      return Response.json({ success: true, ...(await rehearsalPayload(env, { tick: false })) }, { headers: noStore });
    }
    if (body.action === 'end') {
      await endRehearsal(env);
      return Response.json({ success: true }, { headers: noStore });
    }
    return Response.json({ success: false, error: 'Unknown action' }, { status: 400, headers: noStore });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500, headers: noStore });
  }
}
