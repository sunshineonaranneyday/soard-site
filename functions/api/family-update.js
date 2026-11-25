/**
 * The public side of a family's update link (/family-update/#t=<token>).
 *
 * GET  /api/family-update?token=…  → { ok, family: { child, greeting, contacts, address, relationships, answered, expiresAt } }
 *                                     read fresh from JobTread; or 404 (unknown) / 410 (expired or replaced)
 * POST /api/family-update          JSON { token, contacts: [{ id?, name, title, email, phone, remove? }],
 *                                         address: { same: true } | { line1, line2, city, state, zip }, note }
 *                                     → { ok, kind: 'confirmed' | 'updated', added, changed, removeAsked, moved }
 *                                     a bad box → 400 { error, field }
 *
 * Public: in the middleware's PUBLIC_ROUTES, POSTs rate limited per IP. The
 * token is the only key (./_families.js). Changes go straight to the family's
 * contacts in JobTread; someone they ask us to take off waits for staff.
 */
import { trapFilled } from './_bot-trap.js';
import { findFamilyLink, markOpened, readFamily, publicView, applyUpdate, ensureFamilySchema, LIMITS } from './_families.js';

const GONE = {
  unknown: 'This link isn’t right. Check that you copied all of it, or ask SOARD for a new one.',
  expired: 'This link has expired. Reply to our email and we’ll send you a new one.',
  closed: 'There’s a newer link for your family. Use the one in our latest email, or ask SOARD for a new one.',
};
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const gone = (problem) => json({ ok: false, error: GONE[problem] || GONE.unknown }, problem === 'unknown' ? 404 : 410);

export async function onRequestGet(context) {
  const { env, request } = context;
  try {
    if (!env.DB || !env.JOBTREAD_GRANT_KEY) return json({ ok: false, error: 'This page isn’t working right now. Please try again later.' }, 503);
    const token = new URL(request.url).searchParams.get('token');
    const { link, problem } = await findFamilyLink(env.DB, token);
    if (problem) return gone(problem);
    const fresh = await readFamily(env, link.account_id);
    if (!fresh || fresh.archived) return gone('closed');
    const mirror = await env.DB.prepare('SELECT kids, mailing FROM families WHERE account_id = ?').bind(link.account_id).first();
    context.waitUntil?.(markOpened(env.DB, link.id).catch(() => {}));
    return json({ ok: true, family: publicView(fresh, mirror, link) });
  } catch (err) {
    console.error('[family-update]', err);
    return json({ ok: false, error: 'We couldn’t load your information. Please try again in a minute.' }, 500);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Send the form again.' }, 400); }
    if (trapFilled(body)) return json({ ok: true, kind: 'confirmed' }); // a bot filled the hidden box (./_bot-trap.js)
    if (!env.DB || !env.JOBTREAD_GRANT_KEY) return json({ ok: false, error: 'This page isn’t working right now. Please try again later.' }, 503);
    await ensureFamilySchema(env.DB);
    const { link, problem } = await findFamilyLink(env.DB, body?.token);
    if (problem) return gone(problem);
    if (link.submissions >= LIMITS.submissions) return json({ ok: false, error: 'This link has been used many times. Reply to our email and we’ll help.' }, 429);
    const out = await applyUpdate(env, link.account_id, body, { by: 'family', linkId: link.id });
    return json({
      ok: true, kind: out.kind, added: out.adds.length, changed: out.edits.length, removeAsked: out.removes.length,
      moved: !!out.address, trouble: out.problems.length > 0,
    });
  } catch (err) {
    if (err.status === 400) return json({ ok: false, error: err.message, field: err.field || null }, 400);
    if (err.status === 404) return gone('closed');
    if (err.status === 503) return json({ ok: false, error: err.message }, 503);
    console.error('[family-update]', err);
    return json({ ok: false, error: 'Something went wrong on our side. Please try again in a minute.' }, 500);
  }
}
