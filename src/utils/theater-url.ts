/**
 * Where a reveal card goes when its kid has a Theater: their live page, which shows their reveal for good
 * (functions/live/_past-reveal.js). Only for one kid's video: a group video has no one Theater to open.
 * `theaterKids` is the build's list (src/data/theater-kids.json, written by scripts/d1-helpers.js writeTheaterKids).
 */
export function theaterUrlFor(slugs: string[], theaterKids: ReadonlySet<string>): string | null {
  return slugs.length === 1 && theaterKids.has(slugs[0]) ? `/live/${encodeURIComponent(slugs[0])}/` : null;
}
