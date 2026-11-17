/**
 * /admin/rehearsal — the way into a staff rehearsal of the live page (functions/api/_broadcast-rehearsal.js)
 * =========================================================================================================
 * Under /admin, so Cloudflare Access signs the person in first (a phone that has never opened the admin gets the
 * emailed code), then on to the rehearsal's live page: /live/<kid>/?rehearsal. The admin's "Open the live page"
 * link and its code for phones point here, and so does the live page itself when a rehearsal is asked for by
 * someone not signed in.
 */

import { isAuthenticated } from '../api/_middleware.js';
import { readRehearsal } from '../api/_broadcast-rehearsal.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const page = (path) => new Response(null, { status: 302, headers: { Location: `${url.origin}${path}`, 'Cache-Control': 'no-store' } });
  // Access has already asked for the sign-in; this only lets staff (not a board member's sign-in) through
  if (!(await isAuthenticated(request, env))) return page('/admin/');
  const state = env.DB ? await readRehearsal(env.DB).catch(() => null) : null;
  return page(state?.kidSlug ? `/live/${encodeURIComponent(state.kidSlug)}/?rehearsal` : '/admin/#broadcast');
}
