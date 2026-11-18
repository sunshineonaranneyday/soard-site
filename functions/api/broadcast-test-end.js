/**
 * /api/broadcast-test-end — a main-feed test's end, for signed-in staff only
 * ==========================================================================
 * Peter (Nov 18 2026): "Test the main feed" should end as the reveal will, with the theater, the thank-you and the
 * replay, but the public page must stay on the countdown. When a test stops, the state underneath is already back to
 * waiting and the public page (and the hub) show the countdown; publicState only carries `testEndUntil`, which tells a
 * live page to ask here. Staff only: not on the middleware's public lists, so a staff Access sign-in is needed, and
 * anyone else gets a 403 and keeps the countdown (live-client.ts).
 * GET → { state: the test's end (_broadcast.testEndPublicState) or null, reminders, messages, timezone }
 */

import { ensureSchema, readConfig, readState, publicReminders, testEndPublicState, runTick } from './_broadcast.js';

const noStore = { 'Cache-Control': 'no-store' };

export async function onRequestGet(context) {
  const { env } = context;
  try {
    // The test's recording becomes its replay through the tick (findTestReplay), as /api/broadcast keeps it moving
    context.waitUntil(runTick(env, { source: 'visitor', minIntervalMs: 20000 }).catch(() => {}));
    await ensureSchema(env.DB);
    const [config, state] = await Promise.all([readConfig(env.DB), readState(env.DB)]);
    return Response.json({
      state: testEndPublicState(state, config),
      reminders: publicReminders(config, env),
      messages: { enabled: config.messages?.enabled !== false },
      timezone: config.timezone,
    }, { headers: noStore });
  } catch (err) {
    return Response.json({ state: null, error: err.message }, { status: 500, headers: noStore });
  }
}
