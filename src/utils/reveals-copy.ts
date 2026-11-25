/**
 * Upcoming reveals as of the build: the public list from the reveals copy
 * the site keeps from JobTread (D1 site_config "reveals"), written to
 * src/data/upcoming-reveals.json by the prebuild (scripts/d1-helpers.js
 * writeUpcomingReveals), for pages that show them on first paint. Pages
 * refresh them live from /api/reveals (./reveals-client.ts). Missing file =
 * nothing coming up.
 */
import type { UpcomingReveal } from './reveals-client';

const files = import.meta.glob<{ upcoming?: UpcomingReveal[]; past?: { slug: string; date: string }[] }>('../data/upcoming-reveals.json', { eager: true, import: 'default' });

/** Upcoming reveals as of the last copy, soonest first */
export function upcomingAtBuild(): UpcomingReveal[] {
  const copy = Object.values(files)[0];
  return Array.isArray(copy?.upcoming) ? copy.upcoming : [];
}

/** Confirmed reveals whose day had passed by the last copy (the last few months), newest first: { slug, date } */
export function pastAtBuild(): { slug: string; date: string }[] {
  const copy = Object.values(files)[0];
  return Array.isArray(copy?.past) ? copy.past : [];
}

const dayFiles = import.meta.glob<{ days?: Record<string, string> }>('../data/kid-reveal-days.json', { eager: true, import: 'default' });

/**
 * The day each finished room was revealed, as far as the build knows: { slug: 'YYYY-MM-DD' } (scripts/d1-helpers.js
 * revealDays). For the order of Meet the Kids (./kid-order.ts). Missing file = none known.
 */
export function revealDaysAtBuild(): Record<string, string> {
  const days = Object.values(dayFiles)[0]?.days;
  return days && typeof days === 'object' ? days : {};
}
