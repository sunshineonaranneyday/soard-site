/**
 * Advisory Board QA round 26: round 25's world (./advisory-r25-world.mjs: Run it and People → Applications as a made-up
 * founder, Resend faked as the real one is, keeping each Idempotency-Key, a database whose statements fail one at a
 * time), plus what this round needs: Resend answering a status (a gateway's 502, its own 422) or taking an email and the
 * answer being lost; a member's own page (/api/advisory-portal) as a made-up member; the heartbeat now and later; and
 * members with every kind of address. Made-up people only (the repo is public); nothing leaves this machine.
 */
import { MEMBERS, resend } from './advisory-r25-world.mjs';
import { syncBoardAccess } from '../../functions/api/_board-access.js';

export * from './advisory-r25-world.mjs';

// ─── Resend's answers ─────────────────────────────────────────────────
/** status: the next `times` calls answer it (nothing taken); lose: the next `lose` calls are taken, then the answer lost */
export const ctl = { status: 0, times: 0, lose: 0 };
const r25fetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com' && ctl.times > 0) { ctl.times -= 1; return Response.json({ message: `qa ${ctl.status}` }, { status: ctl.status }); }
  if (url.host === 'api.resend.com' && ctl.lose > 0) { ctl.lose -= 1; await r25fetch(input, init); throw new TypeError('the connection dropped after Resend took it'); }
  return r25fetch(input, init);
};
export const resendClear = () => { ctl.status = 0; ctl.times = 0; ctl.lose = 0; resend.down = false; };

export const WELCOME = /^Your Advisory Board page is ready$/;
export const NOTICE = /can help with this month’s ask|changed their answer to this month’s ask/;
export const LEAD = 'info@soardcharity.com';
/** Members of every kind of address: their own, a SOARD group inbox, a SOARD staff address, none */
export const KINDS = [
  ...MEMBERS,
  { slug: 'hal-kindqa', name: 'Hal Kindqa', email: 'advisory@soardcharity.com' },
  { slug: 'ivy-kindqa', name: 'Ivy Kindqa', email: 'ivy.kindqa@soardcharity.com' },
  { slug: 'mo-kindqa', name: 'Mo Kindqa' },
];

/** The sign-in knows everyone's address now (Cloudflare Access, faked) */
export const signInKnows = (env) => syncBoardAccess(env);

/** A press on a member's own page, signed in as them (the waits a press leaves, awaited) */
export async function memberPress(env, m, body) {
  const portal = await import('../../functions/api/advisory-portal.js');
  const { advisorFor } = await import('../../functions/api/_board-roles.js');
  const waits = [];
  const ctx = { env, data: { userEmail: m.email, advisor: await advisorFor(env.DB, m.email).catch(() => null) }, waitUntil: (p) => waits.push(p),
    request: new Request('https://site.test/api/advisory-portal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) };
  const res = await portal.onRequestPost(ctx);
  await Promise.allSettled(waits);
  return { status: res.status, ...(await res.json()) };
}

/** The heartbeat now, eleven minutes on and two days on: every owed email and welcome */
export async function heartbeats(env) {
  const mail = await import('../../functions/api/_advisory-mail.js');
  for (const ahead of [0, 11 * 60 * 1000, 2 * 86_400_000]) {
    await mail.sendOwedMail(env, { now: Date.now() + ahead }).catch(() => {});
    await mail.sendWaitingWelcomes(env, { now: Date.now() + ahead }).catch(() => {});
  }
}
/** The mail record's welcomes and waiting, as they are */
export async function welcomeState(DB) {
  const { readState } = await import('../../functions/api/_board-roles.js');
  const log = await readState(DB, 'advisory-mail');
  return { welcomed: log.welcomed || {}, waiting: log.waiting || {} };
}
