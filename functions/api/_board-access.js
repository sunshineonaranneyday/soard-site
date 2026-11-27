/**
 * The board's sign-in: Cloudflare Access's list of board emails, kept by the site
 * ===========================================================================
 * Board members sign in the way staff do (an emailed code), so Access has to
 * know their addresses. The site keeps an Access group, "SOARD board (kept by
 * the website)", holding exactly the active board's private emails from
 * People → Board, and an allow policy, "SOARD board members", that names the
 * group. A board member added, removed or given a new email on People is on
 * (or off) the list within minutes (the heartbeat checks every 5 minutes;
 * see maybeSyncBoardAccess).
 *
 * Getting in is all Access decides: what a board sign-in can reach is the
 * site's call (_board-roles.js), so a board member who signs in reaches the
 * board page and nothing else.
 *
 * Env: CF_ACCESS_API_TOKEN (an API token with Access: Organizations,
 * Identity Providers, and Groups Edit plus Access: Apps and Policies Edit),
 * CF_ACCOUNT_ID, CF_ACCESS_AUD. The site never changes the admin's Access
 * application itself (a bad write there could lock staff out): the policy is
 * added to it once in the dashboard, and the site checks that it is.
 */

import { activeBoard, activeAdvisors, readState, writeState, PEOPLE_DOWN } from './_board-roles.js';
import { isEmail } from './_broadcast-notify.js';
import { peopleEmails } from './_media-people.js';

const API = 'https://api.cloudflare.com/client/v4';
export const GROUP_NAME = 'SOARD board (kept by the website)';
export const POLICY_NAME = 'SOARD board members';
// Access refuses a group with no rule: an address nobody can receive keeps it valid but empty
export const NOBODY = 'no-board-members@invalid.invalid';
const KEY = 'access';
const RECHECK_MS = 6 * 60 * 60 * 1000;
const LOOK_MS = 5 * 60 * 1000;

export const accessConfigured = (env) => Boolean(String(env.CF_ACCESS_API_TOKEN || '').trim() && env.CF_ACCOUNT_ID && env.CF_ACCESS_AUD);

/**
 * The active board's sign-in emails, A to Z, and who has none on file. A sure read: People or the private emails not
 * answering throws, never an empty list (Board QA round 9: one failed read emptied Access's list, the whole board and
 * Advisory Board locked out until the next look)
 */
export async function boardSignIns(DB) {
  const board = await activeBoard(DB);
  // Only addresses that are whole (the mailer's rule): one malformed one would stop Cloudflare taking the list at all
  const emails = [...new Set(board.map((p) => p.email).filter(isEmail))].sort();
  return { emails, missing: board.filter((p) => !p.email).map((p) => ({ slug: p.slug, name: p.name })) };
}

/**
 * Everyone Access lets sign in: the board, the Advisory Board, and the people who sign in for Photos & Videos only
 * (./_media-people.js; a soardcharity.com address among them is staff's sign-in already). The site says what each can
 * reach (_board-roles.js, the middleware), so the one group serves all three. boardSignIns stays the board's own count
 * for Board → Members.
 */
export async function everyoneSignIns(DB) {
  const [{ emails }, advisors, media] = await Promise.all([boardSignIns(DB), activeAdvisors(DB), peopleEmails(DB)]);
  const outside = media.filter((e) => !/@soardcharity\.com$/i.test(e));
  return { emails: [...new Set([...emails, ...advisors.map((a) => a.email).filter(isEmail), ...outside])].sort() };
}

async function hashOf(list) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(list.join('\n'))));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cf(env, path, { method = 'GET', body = null, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${String(env.CF_ACCESS_API_TOKEN).trim()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.success) {
    const why = j?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Cloudflare ${method} ${path.split('?')[0]}: ${why}`), { status: res.status });
  }
  return j.result;
}

const includeOf = (emails) => (emails.length ? emails : [NOBODY]).map((email) => ({ email: { email } }));
const emailsIn = (group) => (group?.include || []).map((r) => r?.email?.email).filter((e) => e && e !== NOBODY).map((e) => e.toLowerCase()).sort();

/**
 * Bring the Access group up to the board's emails, make sure the policy that
 * names it exists, and see whether the admin's application uses that policy.
 * → the saved state: { ok, emails, hash, groupId, policyId, appName, attached, syncedAt, error }
 */
export async function syncBoardAccess(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const prev = await readState(env.DB, KEY);
  if (!accessConfigured(env)) return { ...prev, ok: false, configured: false, hash: await everyoneSignIns(env.DB).then((x) => hashOf(x.emails), () => prev.hash || null) };
  let emails;
  // (who signs in, read for certain: a read that fails changes nothing in Cloudflare, and says so in the status Board →
  // Members shows, as Cloudflare not answering does. The heartbeat asks again at its next look)
  try { ({ emails } = await everyoneSignIns(env.DB)); } catch (err) { return unread(env, prev, err, now); }
  const hash = await hashOf(emails);
  const o = { fetchImpl };
  try {
    let group = null;
    if (prev.groupId) group = await cf(env, `/access/groups/${prev.groupId}`, o).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!group) group = (await cf(env, '/access/groups?per_page=100', o) || []).find((g) => g.name === GROUP_NAME) || null;
    if (!group) group = await cf(env, '/access/groups', { ...o, method: 'POST', body: { name: GROUP_NAME, include: includeOf(emails) } });
    else if (emailsIn(group).join('\n') !== emails.join('\n')) {
      group = await cf(env, `/access/groups/${group.id}`, { ...o, method: 'PUT', body: { name: GROUP_NAME, include: includeOf(emails), exclude: group.exclude || [], require: group.require || [] } });
    }

    let policy = (await cf(env, '/access/policies?per_page=100', o) || []).find((p) => p.name === POLICY_NAME) || null;
    if (!policy) policy = await cf(env, '/access/policies', { ...o, method: 'POST', body: { name: POLICY_NAME, decision: 'allow', include: [{ group: { id: group.id } }] } });

    const app = (await cf(env, '/access/apps?per_page=100', o) || []).find((a) => a.aud === env.CF_ACCESS_AUD) || null;
    const attached = Boolean(app && (app.policies || []).some((p) => p.id === policy.id));
    return await writeState(env.DB, KEY, {
      ok: true, configured: true, emails: emails.length, hash, groupId: group.id, policyId: policy.id,
      appName: app?.name || null, appFound: Boolean(app), attached, syncedAt: new Date(now).toISOString(), error: null,
    });
  } catch (err) {
    // failingSince: when this run of failures began, so a passing outage reads as one (a working sync clears it)
    return await writeState(env.DB, KEY, { ...prev, ok: false, configured: true, unread: false, error: err.message, failedAt: new Date(now).toISOString(), failingSince: prev.failingSince || new Date(now).toISOString() });
  }
}

/** A read of who signs in that didn't answer: nothing sent to Cloudflare, said in the status as a failing sync is (failingSince) */
async function unread(env, prev, err, now) {
  console.error('[board-access] who signs in', err?.message || err);
  const at = new Date(now).toISOString();
  return writeState(env.DB, KEY, { ...prev, ok: false, configured: true, unread: true, error: PEOPLE_DOWN, failedAt: at, failingSince: prev.failingSince || at });
}

/**
 * Can this address sign in now? Cloudflare took the site's last list, that list is everyone who signs in as
 * things stand (so it has them), and the policy naming it is on the admin's sign-in. Before a "your page is
 * ready" email goes, so its link never meets a sign-in that doesn't know them yet.
 */
export async function canSignIn(env, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!isEmail(e)) return false;
  // (a read that fails: not yet, so nothing goes out on it)
  const [state, everyone] = await Promise.all([readState(env.DB, KEY), everyoneSignIns(env.DB).catch(() => null)]);
  if (!everyone) return false;
  return Boolean(state.ok && state.attached && everyone.emails.includes(e) && state.hash === await hashOf(everyone.emails));
}

/** For the admin: whether board members can sign in, and who can't yet */
export async function accessStatus(env) {
  const state = await readState(env.DB, KEY);
  let board;
  let everyone;
  try {
    [board, everyone] = await Promise.all([boardSignIns(env.DB), everyoneSignIns(env.DB)]);
  } catch (err) {
    // (who signs in couldn't be read: said as that, never as "nobody can sign in" or "up to date")
    console.error('[board-access] status', err?.message || err);
    return { ...state, configured: accessConfigured(env), ok: false, unread: true, error: PEOPLE_DOWN, current: false, failingSince: state.failingSince || state.failedAt || new Date().toISOString(), emails: state.emails ?? 0, missing: [] };
  }
  const { emails, missing } = board;
  const hash = await hashOf(everyone.emails);
  return {
    ...state,
    // Whether the key is there now (the saved state says only whether it was at the last sync)
    configured: accessConfigured(env),
    current: state.hash === hash,
    emails: emails.length,
    missing,
  };
}

/** Heartbeat: sync when People → Board changed (checked every 5 minutes) and every 6 hours anyway. Never throws. */
export async function maybeSyncBoardAccess(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    if (!env.DB || !accessConfigured(env)) return null;
    const runs = await readState(env.DB, 'access-runs');
    if (now - (Number(runs.lookedAt) || 0) < LOOK_MS) return null;
    await writeState(env.DB, 'access-runs', { lookedAt: now });
    const state = await readState(env.DB, KEY);
    let emails;
    try { ({ emails } = await everyoneSignIns(env.DB)); } catch (err) { return await unread(env, state, err, now); }
    const stale = !state.syncedAt || now - Date.parse(state.syncedAt) > RECHECK_MS || !state.attached;
    if (state.ok && state.hash === await hashOf(emails) && !stale) return null;
    return await syncBoardAccess(env, { fetchImpl, now });
  } catch (err) {
    console.error('[board-access]', err.message);
    return null;
  }
}
