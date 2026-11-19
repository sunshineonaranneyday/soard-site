/**
 * GET /api/reveal-design?kid=<slug> — a kid's design for their reveal
 * ====================================================================
 * The live page asks here
 * for the before photos, drawings and design boards on the kid's profile
 * (public/admin/reveal-design.js has the rules). Public, and it says nothing
 * until the design opens, once the reveal is confirmed:
 *   { open: false }                  not yet (no confirmed reveal)
 *   { open: true, after, name, slides: [...] }  from then on, through the reveal and its replay
 *                                    (after: it has started; the slides say "before", not "today")
 * The profile is read as saved, so a change in Admin → Kids shows on the next
 * ask (the screen asks every few minutes) without waiting for a publish, as
 * the rest of /live/ does. A hidden (draft) or unknown kid is a 404.
 */
import { readState } from './_broadcast.js';
import { ownCurrent, pastReveal } from '../live/_past-reveal.js';
import { nearEnv } from './_read-copy.js';
import { cachedReveals } from './_reveals.js';
import { revealSlides, designWindow } from '../../public/admin/reveal-design.js';

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const json = (body, status = 200, maxAge = 30) => Response.json(body, {
  status,
  headers: { 'Cache-Control': `public, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff' },
});

/** The kid's reveal from the schedule JobTread keeps: coming up (confirmed), or kept from the last few months */
export function revealOf(schedule, slug) {
  const ahead = (schedule?.upcoming || []).find((r) => r.slug === slug && r.confirmed !== false);
  if (ahead) return { startsAt: ahead.startsAt, confirmed: true };
  const past = (schedule?.past || []).find((r) => r.slug === slug && r.startsAt);
  return past ? { startsAt: past.startsAt, confirmed: true } : null;
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const slug = String(url.searchParams.get('kid') || '').trim().toLowerCase();
  if (!SLUG.test(slug)) return json({ error: 'Which kid?' }, 400, 300);
  if (!env.DB) return json({ error: 'Not available' }, 503, 0);

  // All three at once, from the database's nearest copy (_read-copy.js): every watcher's page asks this
  const near = nearEnv(env);
  const [row, broadcast, schedule] = await Promise.all([
    near.DB.prepare('SELECT data FROM kids WHERE slug = ?').bind(slug).first().catch(() => null),
    readState(near.DB).catch(() => null),
    cachedReveals(near).catch(() => null),
  ]);
  let kid = null;
  try { kid = row?.data ? JSON.parse(row.data) : null; } catch { /* unreadable reads as unknown */ }
  if (!kid || kid.publishStatus === 'draft') return json({ error: 'No such reveal' }, 404, 60);
  kid.slug ||= slug;

  const now = Date.now();
  // The child's own past reveal counts as their broadcast once it isn't the current one: their page shows that reveal
  // for good (functions/live/_past-reveal.js), its room and plans with it, long after the schedule has let it go
  const current = broadcast && ownCurrent({ kidSlug: broadcast.kidSlug, phase: broadcast.phase }, slug) ? broadcast : null;
  const theirs = current || (await pastReveal(near.DB, slug, null).catch(() => null))?.state || broadcast;
  const { open, after } = designWindow({ kid, reveal: revealOf(schedule, slug), broadcast: theirs, now });
  // Not confirmed yet: kept for a minute at most, so the confirm shows on the next ask
  if (!open) return json({ open: false }, 200, 60);
  // after: the reveal has started, so the room is "before", not "today"
  return json({ open: true, after, name: kid.name || '', slides: revealSlides(kid, { after }) });
}
