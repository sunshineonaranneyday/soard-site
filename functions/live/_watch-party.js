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

/**
 * How the page should look at first paint, or null when it is the plain hero.
 * @param pub   publicState() of the broadcast
 * @param opts  { pageKid: kid slug of the page ('' for /live/) }
 */
export function watchParty(pub, { pageKid = '' } = {}) {
  if (!pub) return null;
  // A stream with no kid named yet is decided in the browser, which has the schedule
  const forThisKid = !pageKid || pub.kidSlug === pageKid;
  if (!forThisKid) return null;
  const phase = pub.phase;
  const view = phase === 'live' || phase === 'ending' ? 'live' : phase === 'replay' ? 'replay' : '';
  if (!view || !pub.player) return null;
  return {
    mode: view,
    orientation: pub.orientation === 'landscape' ? 'landscape' : 'portrait',
    eyebrow: view === 'live' ? 'Live now' : 'Replay',
  };
}
