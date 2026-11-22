/**
 * /api/broadcast-test-end — a test on the main feed that just ended, as the reveal's end will look
 * =================================================================================================
 * Staff only: not on the middleware's public lists, so only a signed-in staff Access session gets an answer
 * (anyone else gets 403 and the page carries on with the public answer, the planned reveal's countdown).
 * GET → { state }: /api/broadcast's state shape for the test's end (phase 'replay', its broadcast id, the kid,
 * testEnded: true, and its own recording as the replay player once Stream has it ready), or { state: null } when no
 * test has just ended. The live page asks when a test it was showing goes back to the countdown (Peter, Nov 18
 * 2026: he wants to see the theater, "That's the reveal!" and the replay after his test, never the public).
 */
import { readState, readConfig, testEndView } from './_broadcast.js';

const noStore = { 'Cache-Control': 'no-store' };

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const [state, config] = await Promise.all([readState(env.DB), readConfig(env.DB)]);
    return Response.json({ state: testEndView(state, config) }, { headers: noStore });
  } catch (err) {
    return Response.json({ state: null, error: err.message }, { status: 500, headers: noStore });
  }
}
