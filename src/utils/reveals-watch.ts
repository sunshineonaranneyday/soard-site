/**
 * The watch card on /reveals/: the next child's reveal, with a play button, linking to their live page (Peter, Nov 20
 * 2026, of /reveals/: "theres no obvioius play button?!?!"). The same dark card as the child's own live page ("Watch it
 * live, right here"), naming the child, as /reveals/ isn't where it plays. The server draws it from the schedule
 * (functions/_reveals-hero.js) with no broadcast to go by; the page script (src/pages/reveals.astro) draws it again with
 * the broadcast, so "Live now" shows while it's on. Plain functions, nothing of the browser's.
 */
import { formatWhen, relativeUntil, daysUntil } from './live-when';
import { revealDay, possessive, type UpcomingReveal } from './reveals-client';

export interface RevealsWatch { kicker: string; when: string; sub: string; today: boolean; live: boolean }
/** What of the broadcast the card goes by (LiveState's fields) */
export interface WatchStatus { live?: boolean; upcoming?: boolean; replay?: boolean; kidSlug?: string | null; player?: unknown }

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The card's words for the next reveal n; s: the broadcast, when known (null on the server) */
export function revealsWatch(n: UpcomingReveal, s: WatchStatus | null = null, tz?: string, now = Date.now()): RevealsWatch {
  const whose = possessive(n.name);
  const mine = !!s && s.kidSlug === n.slug;
  if (mine && s.live) return { kicker: `${whose} reveal is live`, when: 'Watch it now', sub: '', today: true, live: true };
  if (mine && s.replay) return { kicker: `${whose} reveal`, when: s.player ? 'Watch the replay' : 'See how it went', sub: '', today: true, live: false };
  const kicker = `Watch ${whose} reveal live`;
  if (!n.confirmed) return { kicker, when: cap(n.window.label), sub: 'Day and time to come', today: false, live: false };
  if (!n.time) return { kicker, when: revealDay(n, 'long', tz), sub: 'Time to come', today: false, live: false };
  const today = daysUntil(n.startsAt, tz, now) === 0;
  const when = cap(formatWhen(n.startsAt, tz, now));
  if (Date.parse(n.startsAt) > now) return { kicker, when, sub: today ? relativeUntil(n.startsAt, now, tz) : '', today, live: false };
  // Its time has come and it isn't on: the crew is getting ready (the broadcast is set for this child), else just when
  return { kicker, when: mine && s.upcoming ? 'Any moment now' : when, sub: '', today, live: false };
}
