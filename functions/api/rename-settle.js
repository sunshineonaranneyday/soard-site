/**
 * /api/rename-settle: a People rename that couldn't finish by itself, settled by a person on People
 * ================================================================================================
 * A rename whose board and Advisory Board page records couldn't follow it as things stood (someone else at its old
 * address now, or the person no longer at its new one) waits for a person (./_rename-finish.js). People's note at the
 * top says what's still where and has a button for each way (public/admin/people-stuck.js).
 *   GET   → { success, stuck: [{ from, to, at, name, here, other, left }] }       (./_rename-finish.js stuckRenames)
 *   POST  { from, at, choice: 'move' | 'leave' } → { success, said } or { success: false, error }   (settleStuck)
 * Staff only, as People's rename is (./rename-content.js): not a board or Advisory Board route, so the middleware
 * refuses their sign-ins in words (./_middleware.js, ./_board-roles.js routesFor). Never a 502: anything that stops it
 * is said in words for staff.
 */
import { stuckRenames, settleStuck } from './_rename-finish.js';

export async function onRequestGet(context) {
  try {
    return Response.json({ success: true, stuck: await stuckRenames(context.env.DB) });
  } catch (e) {
    console.error('[rename-settle]', e?.message || e);
    return Response.json({ success: false, error: 'The site’s database didn’t answer just now, so People couldn’t check for a change of web address that didn’t finish. Reload in a moment.' }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const r = await settleStuck(context.env, body || {}, context.data?.userEmail || 'unknown');
    return Response.json(r.body, { status: r.status });
  } catch (e) {
    // (whatever reaches here stopped before anything was moved or let go)
    console.error('[rename-settle]', e?.message || e);
    return Response.json({ success: false, error: 'Nothing changed: the site’s database didn’t answer just now. Try again in a moment.' }, { status: 500 });
  }
}
