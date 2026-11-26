/**
 * Advisory Board QA round 27: round 26's world (./advisory-r26-world.mjs: Run it and People → Applications as a made-up
 * founder, Resend faked as the real one is, keeping each Idempotency-Key, a database whose statements fail one at a
 * time, a member's own page), plus what this round needs: Resend answering its own no (a 4xx) for one address every
 * time it's asked, and counting how often it was asked for each address; Resend forgetting its keys (as it does after a
 * day); a member renamed on People (the real rename and its finisher); the heartbeat at any offset; and the outbox as
 * it is. Made-up people only (the repo is public); nothing leaves this machine.
 */
import { resend } from './advisory-r25-world.mjs';

export * from './advisory-r26-world.mjs';

// ─── Resend's own no for one address, every time ─────────────────────
/**
 * refuse: address → the status Resend answers for it, every time it's asked; once: address → what the next call for it
 * meets, once (a status, or 'lose': Resend takes it and the answer is lost); asked: address → how often it was asked
 */
export const refuse = new Map();
export const once = new Map();
export const asked = new Map();
const r26fetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api.resend.com') {
    const to = [JSON.parse(init.body)].flat().flatMap((m) => [m.to].flat()).map((t) => String(t).toLowerCase());
    for (const t of to) asked.set(t, (asked.get(t) || 0) + 1);
    const hit = to.find((t) => refuse.has(t));
    if (hit) return Response.json({ message: `qa: refuses ${hit}` }, { status: refuse.get(hit) });
    const one = to.find((t) => once.has(t));
    if (one) {
      const how = once.get(one);
      once.delete(one);
      if (how === 'lose') { await r26fetch(input, init); throw new TypeError('the connection dropped after Resend took it'); }
      return Response.json({ message: `qa ${how}` }, { status: how });
    }
  }
  return r26fetch(input, init);
};
export const refuseClear = () => { refuse.clear(); once.clear(); asked.clear(); };
/** Resend forgets every key, as it does a day after it was first used */
export const forget = () => resend.keys.clear();
/** The keys the emails to `to` went with (matching `re`) */
export const keysTo = (to, re) => resend.delivered.filter((m) => [m.to].flat().includes(to) && re.test(m.subject || '')).map((m) => m.key);

// ─── The heartbeat, People's rename, the outbox ──────────────────────
/** The heartbeat's sends (every owed email, then every welcome waiting), as if `ahead` ms later */
export async function beat(env, ahead = 0) {
  const mail = await import('../../functions/api/_advisory-mail.js');
  const owed = await mail.sendOwedMail(env, { now: Date.now() + ahead }).catch((e) => ({ error: e.message }));
  const welcomes = await mail.sendWaitingWelcomes(env, { now: Date.now() + ahead }).catch((e) => ({ error: e.message }));
  return { owed, welcomes };
}
export const MIN = 60 * 1000;
export const DAY = 86_400_000;
/** The heartbeat 3 minutes, 11 minutes, 2 days and 3 days on (after `from`), Resend forgetting its keys after a day */
export async function beats(env, { keysFor = true, from = 0 } = {}) {
  await beat(env, from + 3 * MIN);
  await beat(env, from + 11 * MIN);
  if (keysFor) forget();
  await beat(env, from + 2 * DAY);
  await beat(env, from + 3 * DAY);
}
/** A member renamed on People, as People's editor does it (the real rename, its records' finisher with it) */
export async function renameTo(env, from, to) {
  const { rename } = await import('../../functions/api/rename-content.js');
  const r = await rename(env, { collection: 'team', from, to }, 'quinn.founderqa@soardcharity.com', async () => Response.json({ success: true }));
  if (r.status !== 200) throw new Error(`rename ${from} → ${to}: ${r.status} ${r.body.error}`);
  return r.body;
}
/** The outbox's rows, as they are */
export const outboxRows = async (DB) => (await DB.prepare('SELECT * FROM advisory_outbox ORDER BY owed_at').all()).results || [];
/** The Advisory Board's emails switch, set */
export async function emailsSet(env, on) {
  const { saveSettings } = await import('../../functions/api/_advisory.js');
  await saveSettings(env.DB, { emails: on });
}
