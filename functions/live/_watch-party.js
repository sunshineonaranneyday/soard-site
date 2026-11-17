/**
 * First paint for the live page's watch party
 * ===========================================
 * During a live reveal most viewers arrive at once, from a text, a QR code
 * or Facebook. The page script would lay the page out for the video a
 * moment after load (photo hero → video beside the messages), which shifts
 * everything on screen. functions/live/[[path]].js uses this to lay the
 * page out on the server instead, so the first paint is already right.
 *
 * Mirrors render() in src/components/live/LivePage.astro: keep them in step.
 */
import { runningLate } from '../../src/utils/live-banner.ts';

/** Starting-soon screen fills the frame for the last hour (SLATE_LEAD_MS in LivePage) */
export const SLATE_LEAD_MS = 60 * 60 * 1000;

/** The starting-soon screen the frame plays (slateSrc in LivePage.astro; a phone held sideways asks for its landscape one there) */
export const slateFor = (kidSlug, orientation) => `/live/${kidSlug}/slate/?embed=1&music=0&o=${orientation === 'landscape' ? 'landscape' : 'portrait'}`;

/** The phases a starting-soon screen takes its start time from (ACTIVE in SlateScreen.astro) */
const SLATE_ACTIVE = new Set(['scheduled', 'armed', 'live', 'ending']);

/**
 * What a kid's starting-soon screen (/live/<kid>/slate/) is drawn with from its first paint, as its script would set
 * them once the live state came (SlateScreen.astro): the reveal's time (and the zone it's said in) while that kid's
 * reveal is on, and the photo picked when it was scheduled. Inside the live page the screen fades in drawn, so a
 * screen that had to wait for the live state either waited or showed "In just a few minutes" and then the clock.
 * Null: nothing to add, and the screen goes out as built.
 * @param pub       publicState() of the broadcast
 * @param slug      the screen's kid
 * @param timezone  the broadcast's zone (config.timezone)
 */
export function slateFacts(pub, slug, timezone = '') {
  if (!pub || !slug || pub.kidSlug !== slug) return null;
  const at = pub.scheduledAt && SLATE_ACTIVE.has(pub.phase) ? pub.scheduledAt : '';
  const image = pub.image || '';
  return at || image ? { at, tz: timezone || '', image } : null;
}

/**
 * How the page should look at first paint, or null when it is the plain hero.
 * @param pub   publicState() of the broadcast
 * @param opts  { pageKid: kid slug of the page ('' for /live/), kidPublished: the kid's pages are built, now }
 */
export function watchParty(pub, { pageKid = '', kidPublished = false, now = Date.now() } = {}) {
  if (!pub) return null;
  // A stream with no kid named yet is decided in the browser, which has the schedule
  const forThisKid = !pageKid || pub.kidSlug === pageKid;
  if (!forThisKid) return null;
  const phase = pub.phase;
  const view = phase === 'live' || phase === 'ending' ? 'live' : phase === 'replay' ? 'replay' : phase === 'scheduled' || phase === 'armed' ? 'upcoming' : 'idle';
  const hasPlayer = !!pub.player && (view === 'live' || view === 'replay');
  const startsIn = pub.scheduledAt ? Date.parse(pub.scheduledAt) - now : Infinity;
  const starting = !hasPlayer && view === 'upcoming' && !!(pageKid || pub.kidSlug) && kidPublished && startsIn <= SLATE_LEAD_MS;
  if (!hasPlayer && !starting) return null;
  const mode = starting ? 'starting' : view;
  const orientation = pub.orientation === 'landscape' ? 'landscape' : 'portrait';
  const late = starting && runningLate(pub.scheduledAt, now);
  return {
    mode,
    orientation,
    eyebrow: mode === 'live' ? 'Live now' : mode === 'replay' ? 'Replay' : late ? 'Running late' : 'Starting soon',
    late,
    slate: starting ? slateFor(pageKid || pub.kidSlug, orientation) : '',
  };
}
