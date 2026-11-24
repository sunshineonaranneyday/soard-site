/**
 * The Advisory Board's heartbeat, from the board's (./_board.js maybeRunBoard). Each step has its own try: one failing holds up nothing.
 *   every 5 minutes at most, with emails on, advisory@soardcharity.com kept in step with People → Advisory (./_board-group.js);
 *     with emails off, once the site has filled it, only whoever leaves is taken off
 *   a welcome that waited for the sign-in to know someone just added (./_advisory-mail.js sendWaitingWelcomes)
 *   every other Advisory Board email still owed (the ask, an update, a gift's note, the goal's), sent once (sendOwedMail)
 *   headshots Cloudflare didn't let go of, asked again (./_advisory-applications.js retryForgottenImages)
 *   a new application's notices that didn't all go, sent again (./_advisory-applications.js retryNotices)
 *   every 15 minutes, what's been raised, from Zeffy (./_advisory-money.js), and the kid's pledge kept equal to it
 *   invites' replies and drift (./_advisory-meetings.js)
 *   once a week at most, a nudge to whoever runs the group when something's been waiting (./_advisory-mail.js)
 * Never throws.
 */

import { maybeSyncAdvisoryGroup } from './_board-group.js';
import { getSettings, ensureAdvisory } from './_advisory.js';
import { readState } from './_board-roles.js';
import { maybeReadMoney } from './_advisory-money.js';
import { keepPledge } from './_advisory-sponsor.js';
import { maybeNudgeLead, sendWaitingWelcomes, sendOwedMail } from './_advisory-mail.js';
import { maybeSyncAdvisoryMeetings } from './_advisory-meetings.js';

export async function maybeRunAdvisory(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const step = async (name, fn) => { try { return await fn(); } catch (e) { console.error(`[advisory] ${name}`, e?.message || e); return null; } };
  // advisory@ fills once emails are on: until then nobody outside SOARD hears anything through it, and it can be tested quietly.
  // Emails turned off after the site filled it: nobody new goes in, but whoever leaves the Advisory Board is still taken off
  await step('group', async () => {
    await ensureAdvisory(env.DB);
    if ((await getSettings(env.DB)).emails) return maybeSyncAdvisoryGroup(env, { fetchImpl, now });
    return (await readState(env.DB, 'advisory-group')).syncedAt ? maybeSyncAdvisoryGroup(env, { fetchImpl, now, adding: false }) : null;
  });
  // (after the board's heartbeat brought the sign-in list up to date: ./_board.js runs that first)
  await step('welcome', () => sendWaitingWelcomes(env, { now }));
  // Headshots Cloudflare didn't let go of when asked (an application deleted, a send that failed partway): asked again
  await step('pictures', async () => (await import('./_advisory-applications.js')).retryForgottenImages(env, { fetchImpl }));
  // An application's notices that didn't all go (the applicant's copy, the staff email, the Slack card): sent again
  await step('notices', async () => (await import('./_advisory-applications.js')).retryNotices(env, { now }));
  const money = await step('money', () => maybeReadMoney(env, { fetchImpl, now }));
  if (money) await step('pledge', () => keepPledge(env, money.settings, money.raised, { now }));
  // Every Advisory Board email still owed, sent once: the monthly ask and the update emails a press left owed, and the
  // notes of new gifts and of the goal, owed in the money's own write just above (./_advisory-mail.js sendOwedMail)
  await step('owed', () => sendOwedMail(env, { now }));
  await step('meetings', () => maybeSyncAdvisoryMeetings(env, { fetchImpl, now }));
  // A paper the board took back in a way its save doesn't catch (a new staff-only file, a deleted paper)
  await step('papers', async () => { const { boardPapers } = await import('./_advisory-portal.js'); return boardPapers(env.DB, await getSettings(env.DB)); });
  await step('nudge', () => maybeNudgeLead(env, { now }));
}
