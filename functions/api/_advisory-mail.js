/**
 * Emails for the Advisory Board
 * ===========================================================================
 * To advisors (people outside SOARD): off until settings.emails is on, the switch
 * on Members. The monthly ask, an update on an introduction or a hosted fundraiser,
 * a note when a gift lands on their page, the welcome. Nothing else starts them:
 * filling in data never sends anything.
 *
 * The welcome ("Your Advisory Board page is ready") goes when staff press Add to
 * Advisory Board on an application (Peter, Nov 16 2026), once the sign-in knows
 * their address: the sign-in list is brought up to date there and then, and if
 * Cloudflare hasn't taken it yet the welcome waits for the heartbeat that sees
 * it has. With the switch off it waits for the switch (welcomeOnJoin,
 * sendWaitingWelcomes). Staff can also send it to one member from their row on
 * Members, switch on or off (Peter, Nov 18 2026: "works with switch off"): the
 * switch holds what the site sends by itself, never what a person sends by hand
 * (sendWelcomeTo).
 *
 * To whoever runs the group: on from the start, because an introduction that nobody
 * sees is worse than none. A notice names what came in and links to Run it, never a
 * contact's email or phone, which stay on the page.
 *
 * Replies go to whoever runs the group (Peter's call, Nov 7 2026), or to info@ while
 * nobody does or they have no address on file. No email ever names a kid
 * or a gift amount beside a reveal; the kid is theirs to hear about at the meeting.
 * The ask's buttons carry a token for one ask and one advisor (D1 keeps only its hash), and GET only shows
 * the question, because mail scanners open links: a person's press is a POST.
 */

import { sendEmails, sendEmailItems, EMAIL_FROM, SITE_ORIGIN, isEmail } from './_broadcast-notify.js';
import * as shell from './_email-shell.js';
import { activeAdvisors, peopleRows, privateEmails, readState, boardAdmins, memberSignIn, signInWhy, moveStateEntry } from './_board-roles.js';
import { ensureAdvisory, getSettings, INTRO_STATUSES, HOSTED_STATUSES, LINKS_TABLE, askOut, oweStatement, unoweStatement, setIntroStatus, setHosted, ASK_NOT_OUT } from './_advisory.js';
import { memberNow, movingOff, movingAt, stillTheirs, personOf, onAdvisoryBoard } from './_member-write.js';
import { stateReady } from './_board-roles.js';
import { syncBoardAccess, canSignIn, accessStatus } from './_board-access.js';
import { greetName } from './_advisory-form.js';

const LOG = 'advisory-mail';
const FROM = EMAIL_FROM.replace(/^[^<]*/, 'SOARD Advisory Board ');
const PAGE = `${SITE_ORIGIN}/admin/advisory/`;
// Run it, by a link that survives the sign-in (a #/ link lands on Home)
const RUN = `${SITE_ORIGIN}/advisory/run`;
const FALLBACK = 'info@soardcharity.com';
const LINK_DAYS = 30;
const NUDGE_EVERY_MS = 7 * 86_400_000;
const longDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
// The name to greet: "Dr. Jordan Smith" is Jordan (a title alone, "Dr. Smith", stays whole)
const firstOf = (name) => greetName({ fullName: name }) || String(name || '').trim();
const tag = (value) => [{ name: 'kind', value }];

async function leadOf(env, settings) {
  const [people, emails] = await Promise.all([peopleRows(env.DB), privateEmails(env.DB)]);
  const p = people.find((x) => x.slug === settings.lead);
  const email = p ? emails[p.slug] : '';
  return { name: p?.name || '', email: isEmail(email) ? email : FALLBACK };
}
const replyTo = async (env, settings) => (await leadOf(env, settings)).email;

async function remember(DB, entry, now = Date.now()) {
  const log = await readState(DB, LOG);
  const what = { ask: `This month’s ask: ${entry.title || ''}`, welcome: entry.who ? `Your page is ready, to ${entry.who}` : 'Your page is ready', goal: 'The goal was reached', 'goal-note': 'You reached the goal', 'advisory-update': 'An update to an Advisory Board member' }[entry.kind] || (String(entry.kind).startsWith('notice-') ? 'A notice to whoever runs the group' : entry.kind);
  // (the list alone is written: what else the record holds is never written back from this read)
  await setTop(DB, 'list', [{ at: new Date(now).toISOString(), what, ...entry }, ...(log.list || [])].slice(0, 40));
}
export const mailLog = async (DB) => (await readState(DB, LOG)).list || [];
/*
 * welcomed: { slug: { at, to } }, when it went and to which address. Had it means sent to the address they have now: a
 * new person later given a deleted person's web address (People's own editor can) gets their own; the same person put
 * back from Recently deleted, with their address again, isn't sent it twice. An older record (the time alone) counts
 * as had, whoever. A welcome on its way is { sending: when }, never had.
 */
const plain = (e) => String(e || '').trim().toLowerCase();
const hadIt = (v, email = '') => typeof v === 'string' || (!!v && typeof v === 'object' && !!v.at && (!v.to || !email || v.to === plain(email)));
/** { slug: true } for everyone who's had theirs at the address they have now */
export const welcomedSlugs = async (DB) => {
  const [log, emails] = await Promise.all([readState(DB, LOG), privateEmails(DB)]);
  return Object.fromEntries(Object.entries(log.welcomed || {}).filter(([slug, v]) => hadIt(v, emails[slug])).map(([slug]) => [slug, true]));
};
/**
 * Every address with a welcome had, on its way or waiting, or the name kept for their emails (./_people-address.js never
 * gives a new person one of these)
 */
export const mailSlugs = async (DB) => { const log = await readState(DB, LOG); return [...Object.keys(log.welcomed || {}), ...Object.keys(log.waiting || {}), ...Object.keys(log.names || {})]; };

/*
 * One entry of the mail record (welcomed, waiting, nudgedAt) changed in place by D1 itself, never the whole record
 * read and written back: two at once (a press and the heartbeat, two staff) never undo each other.
 */
const SENDING_STALE_MS = 10 * 60 * 1000; // a welcome "on its way" longer than this was a request that died: it can go again
export const AGAIN_MS = 10 * 60 * 1000; // a sign-in email sent by hand goes again only this long after the last one (as Board's)
const pathOf = (group, key) => `$.${JSON.stringify(group)}${key == null ? '' : `.${JSON.stringify(String(key))}`}`;
async function logRow(DB) {
  await readState(DB, LOG); // (makes the table)
  await DB.prepare("INSERT OR IGNORE INTO board_state (key, data, updated_at) VALUES (?, '{}', ?)").bind(LOG, new Date().toISOString()).run();
}
// (the group made first, so a key inside it always has somewhere to go)
const withGroup = (group) => `json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '${pathOf(group)}', json(ifnull(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '${pathOf(group)}'), '{}')))`;
async function setEntry(DB, group, key, value) {
  await logRow(DB);
  await DB.prepare(`UPDATE board_state SET data = json_set(${withGroup(group)}, ?, json(?)), updated_at = ? WHERE key = ?`)
    .bind(pathOf(group, key), JSON.stringify(value), new Date().toISOString(), LOG).run();
}
async function removeEntry(DB, group, key) {
  await logRow(DB);
  await DB.prepare('UPDATE board_state SET data = json_remove(data, ?), updated_at = ? WHERE key = ? AND json_valid(data)')
    .bind(pathOf(group, key), new Date().toISOString(), LOG).run();
}
async function setTop(DB, key, value) {
  await logRow(DB);
  await DB.prepare("UPDATE board_state SET data = json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, ?, json(?)), updated_at = ? WHERE key = ?")
    .bind(pathOf(key), JSON.stringify(value), new Date().toISOString(), LOG).run();
}
/**
 * Their welcome, claimed for this send: true only for the one send that gets it (nobody emailed twice). Free to claim:
 * none yet, a first one a dead request left, or one that went to another address (someone else at this web address).
 * again: one they had at this address, sent at least AGAIN_MS ago, too (Send it again on their row). That claim keeps
 * when the last one went ({ at, to, sending }), so a request that dies partway leaves them had, never unsent: nothing
 * sends them it again by itself, and the row still says when it went.
 * Every claim says the address it's for (sendingTo): one send's welcomes all share its moment, so a claim is found again
 * by both (claimNow), never by the moment alone (Advisory Board QA round 19)
 */
// (claimed only while they're at this address with this email and no rename is moving records off it, as it's
// written: a claim read for an address before a rename is never left at it after: Advisory Board QA round 21)
const STILL_HERE = `AND EXISTS (SELECT 1 FROM reveal_board_emails WHERE slug = ? AND lower(trim(email)) = ?) AND NOT ${movingOff('?')}`;
async function claimWelcome(DB, slug, now, email, { again = false } = {}) {
  await logRow(DB);
  const path = pathOf('welcomed', slug);
  const stale = new Date(now - SENDING_STALE_MS).toISOString();
  const sending = new Date(now).toISOString();
  const here = [slug, plain(email), slug];
  const r = await DB.prepare(`UPDATE board_state SET data = json_set(${withGroup('welcomed')}, ?, json(?)), updated_at = ? WHERE key = ?
    AND (json_extract(data, ?) IS NULL OR (json_type(data, ?) = 'object' AND (
      (json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) < ? AND json_extract(data, ?) IS NULL)
      OR (json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != ?
        AND (json_extract(data, ?) IS NULL OR json_extract(data, ?) < ?))))) ${STILL_HERE}`)
    .bind(path, JSON.stringify({ sending, sendingTo: plain(email) }), new Date().toISOString(), LOG, path, path,
      `${path}.sending`, `${path}.sending`, stale, `${path}.at`,
      `${path}.at`, `${path}.to`, `${path}.to`, plain(email),
      `${path}.sending`, `${path}.sending`, stale, ...here).run();
  if (r?.meta?.changes) return true;
  if (!again) return false;
  // Had it here, long enough ago, and none on its way: claimed with when it went kept
  const before = new Date(now - AGAIN_MS).toISOString();
  const r2 = await DB.prepare(`UPDATE board_state SET data = json_set(data, ?, json_object(
      'at', CASE json_type(data, ?) WHEN 'text' THEN json_extract(data, ?) ELSE json_extract(data, ?) END,
      'to', CASE json_type(data, ?) WHEN 'text' THEN NULL ELSE json_extract(data, ?) END,
      'sending', ?, 'sendingTo', ?)), updated_at = ? WHERE key = ? AND json_valid(data) AND (
    (json_type(data, ?) = 'text' AND json_extract(data, ?) < ?)
    OR (json_type(data, ?) = 'object' AND json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) < ?
      AND (json_extract(data, ?) IS NULL OR json_extract(data, ?) = ?)
      AND (json_extract(data, ?) IS NULL OR json_extract(data, ?) < ?))) ${STILL_HERE}`)
    .bind(path, path, path, `${path}.at`, path, `${path}.to`, sending, plain(email), new Date().toISOString(), LOG,
      path, path, before,
      path, `${path}.at`, `${path}.at`, before,
      `${path}.to`, `${path}.to`, plain(email),
      `${path}.sending`, `${path}.sending`, stale, ...here).run();
  return !!r2?.meta?.changes;
}
/** When their welcome went (a had-it record), else '' */
const sentAt = (v) => (typeof v === 'string' ? v : v?.at || '');
/**
 * An email the service may have taken: no answer (it timed out, the connection dropped) or a gateway's 502/503/504 in
 * front of Resend. Counted as sent, unconfirmed, as Board's are: pressing again could send a second copy. Resend's own
 * error status, or email not set up, is a sure no
 */
const unsureOf = (r) => r.failed > 0 && (r.errors || []).some((e) => {
  const t = String(e);
  return /^Resend 50[234]:/.test(t) || (!/^Resend \d+:/.test(t) && !/RESEND_API_KEY not set/.test(t));
});

/**
 * Their welcome, written down as waiting (Add does this before Joined): the heartbeat sends it unless they've had it.
 * greet: how their application's copy greets them (_advisory-form.js greetName: the name they asked to be called, else
 * their first name read with confidence), '' when it greets no name ("Thank you."), null when there's no application to
 * say (added on People by hand). Kept with it, so a deleted application doesn't lose it, and kept for good beside their
 * welcome record (names): the Advisory Board's emails greet them by it whatever happens to their application or their
 * People name afterwards (Advisory Board QA round 19). "No name" is kept as a decision too (round 20: a People name Add
 * had reordered was read for a name the form wasn't sure of). A later Add from a newer application keeps its decision
 */
export async function queueWelcome(DB, slug, { by = '', now = Date.now(), greet = null } = {}) {
  const [log, emails] = await Promise.all([readState(DB, LOG), privateEmails(DB)]);
  const decided = typeof greet === 'string';
  if (decided) await setEntry(DB, 'names', slug, greet);
  if (hadIt(log.welcomed?.[slug], emails[slug])) return;
  await setEntry(DB, 'waiting', slug, { at: new Date(now).toISOString(), by, ...(decided ? { greet } : {}) });
}

/**
 * Their web address on People changed (./rename-content.js): their welcome, had or waiting, and the name kept for their
 * emails go with them. As statements for the rename's own batch, so the record and these move together or not at all
 * (never a welcome left at the old address, for a later application from them to send a second)
 */
export async function renameMemberStatements(DB, from, to) {
  await readState(DB, LOG); // (makes the table: nothing at the old address, nothing moves)
  return ['welcomed', 'waiting', 'names'].map((group) => moveStateEntry(DB, LOG, group, from, to));
}

/**
 * Someone deleted from People: a welcome still waiting for them goes. The one they had stays on record (put back from
 * Recently deleted, they aren't sent it twice; Add never gives their address to anyone new, ./_advisory-add.js)
 */
export async function forgetMember(DB, slug) {
  await removeEntry(DB, 'waiting', slug);
}

/**
 * How each Advisory Board member's application greets them, by People slug: the name they asked to be called ("Jo"),
 * else their first name as they wrote it ("Katie", where People has Katherine), else '' (the form greets no name). The
 * one kept when they were added (queueWelcome: names, beside their welcome record, moved with a rename) first, whatever
 * happened to their application since; else, for someone added before names were kept, their latest application's. A
 * member with neither (added on People by hand) isn't in it
 */
async function preferredNames(DB) {
  const out = {};
  try {
    const { results } = await DB.prepare("SELECT person_slug, answers FROM advisory_applications WHERE person_slug IS NOT NULL ORDER BY created_at").all();
    for (const r of results || []) {
      let a = {};
      try { a = JSON.parse(r.answers || '{}') || {}; } catch { a = {}; }
      // ('' too: the form's own decision that there's no name to greet)
      out[r.person_slug] = greetName(a);
    }
  } catch (e) {
    // (the greeting only: a read that fails greets by their People first name, never holds an email up)
    if (!/no such table/i.test(e?.message || '')) console.error('[advisory-mail] names from applications', e?.message);
  }
  try {
    for (const [slug, g] of Object.entries((await readState(DB, LOG)).names || {})) if (typeof g === 'string') out[slug] = g;
  } catch (e) { console.error('[advisory-mail] names kept', e?.message); }
  return out;
}
/**
 * How an Advisory Board member is greeted in every email to them, the welcome and the monthly ask alike (one function:
 * Peter's rule, confident or none), exactly as their application's copy greets them: the name they asked to be called,
 * else their first name as greetName reads what they typed; when the copy greets no name ("Garcia Lopez, Maria & Jose",
 * "Jordan, Amy and Sam Rowe"), none at all, "Hello," and "Welcome to the Advisory Board", never a guess from the name
 * People has (Advisory Board QA round 20: Add's People name "Amy & Sam Rowe Jordan" was greeted "Hi Amy and Sam,").
 * Someone added on People by hand, with no application, is greeted by the same confident reader on their People name.
 * `decided`: { slug: name or '' } (preferredNames). The staff's own notices name them as People has them (firstOf)
 */
export const greetingOf = (a, decided) => (Object.hasOwn(decided || {}, a.slug) ? decided[a.slug] : greetName({ fullName: a.name }));
/** Had their welcome, or one is on its way right now (a claim left by a request that died doesn't count) */
/** Had it at this address, or it's on its way now (a press or the heartbeat sending it this minute) */
export const hasOrGoing = (v, now, email) => hadIt(v, email) || (!!v?.sending && Date.parse(v.sending) > now - SENDING_STALE_MS);
/** Each address's welcome record as it is ({ slug: { at, to } | { sending } }), for a check against an address it'll have */
export const welcomeRecords = async (DB) => (await readState(DB, LOG)).welcomed || {};
/** The same, with the welcomes written down as waiting for the heartbeat ({ slug: { at, by } }), in one read */
export const welcomeLog = async (DB) => { const log = await readState(DB, LOG); return { welcomed: log.welcomed || {}, waiting: log.waiting || {} }; };
/**
 * One member's sign-in email as their row on Members shows it: { at } when they had it at the address they have now,
 * { going: true } while one is on its way (a press, Add or the heartbeat), else {}
 */
export const welcomeOf = (v, email, now = Date.now()) => (v?.sending && Date.parse(v.sending) > now - SENDING_STALE_MS ? { going: true }
  : hadIt(v, email) ? { at: sentAt(v), ...(v?.unconfirmed ? { unconfirmed: true } : {}) } : {});

const para = (text) => shell.paragraphs(text);

// ─── To whoever runs the group ──────────────────────────────────────

/**
 * What came in, for the person running the group, as an owed email's row (./_advisory.js advisory_outbox): written in the
 * member's own write that makes it owed (an introduction, a request to host, a yes to the ask, a renewal: Advisory Board
 * QA round 25, a notice sent after that write was lost whenever its send failed), keyed by what it's about, to whoever
 * runs the group as they are when it goes (`email` ''). `name`: the member as that write found them. A notice to staff:
 * never the email or phone of anyone introduced, which stay on the page
 */
export function leadNotice(kind, { name, intro, hosted, note, term, ref }) {
  const who = name || 'An Advisory Board member';
  const words = {
    intro: { subject: `${firstOf(who)} made an introduction`, line: `${who} introduced ${intro?.name || 'someone'}${intro?.company ? ` at ${intro.company}` : ''}.` },
    host: { subject: `${firstOf(who)} wants to host a fundraiser`, line: `${who} asked to host: ${hosted?.title || ''}. It needs a yes or a not now.` },
    answer: { subject: `${firstOf(who)} can help with this month’s ask`, line: `${who} said yes to this month’s ask.${note ? ` They wrote: “${note}”` : ''}` },
    renew: { subject: `${firstOf(who)} renewed`, line: `${who} renewed for another year, through ${longDay(term?.ends) || 'next year'}.` },
  }[kind];
  if (!words) return null;
  return { key: `notice:${kind}:${ref}`, kind: 'notice', ref: String(ref), email: '', msg: words, idem: `advisory-notice:${kind}:${ref}` };
}
/**
 * A notice to whoever runs the group that a member's write owed (leadNotice), sent now if it's still owed: under its key,
 * marked with its send (sendOwed). One that doesn't go now the heartbeat sends, once. Never throws
 */
export async function sendNotice(env, key, { now = Date.now() } = {}) {
  try {
    const row = rowOf(await twice(() => env.DB.prepare('SELECT * FROM advisory_outbox WHERE key = ? AND sent_at IS NULL AND outcome IS NULL').bind(key).first()));
    if (!row) return { sent: 0 };
    const r = await sendOwed(env, [row], { now, make: async (x) => ({ item: { ...noticeItem(x), to: x.email || (await leadOf(env, await getSettings(env.DB))).email }, replyTo: '' }) });
    await remember(env.DB, { kind: `notice-${String(key).split(':')[1]}`, to: 'lead', sent: r.sent }, now).catch(() => {});
    return r;
  } catch (e) { console.error('[advisory-mail] notice', e?.message || e); return { sent: 0 }; }
}

/**
 * Once a week at most, when something has been waiting a week, or no ask has gone out in a month. When it's owed is
 * written with its email owed, in one write, then it goes under its own key (Advisory Board QA round 25: sent, then
 * noted, a note that didn't save nudged again at the next heartbeat). Never throws
 */
export async function maybeNudgeLead(env, { now = Date.now() } = {}) {
  try {
    await ensureAdvisory(env.DB);
    const log = await readState(env.DB, LOG);
    if (log.nudgedAt && now - Date.parse(log.nudgedAt) < NUDGE_EVERY_MS) return null;
    const week = new Date(now - NUDGE_EVERY_MS).toISOString();
    const month = new Date(now - 30 * 86_400_000).toISOString();
    const intros = (await env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_intros WHERE status = 'thanks' AND at < ?").bind(week).first())?.n || 0;
    const hosted = (await env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_hosted WHERE status = 'new' AND at < ?").bind(week).first())?.n || 0;
    const members = (await activeAdvisors(env.DB)).length;
    const lastAsk = (await env.DB.prepare('SELECT MAX(sent_at) AS at FROM advisory_asks').first())?.at;
    const noAsk = members > 0 && (await getSettings(env.DB)).emails && (!lastAsk || lastAsk < month);
    if (!intros && !hosted && !noAsk) return null;
    const settings = await getSettings(env.DB);
    const lead = await leadOf(env, settings);
    const lines = [
      intros ? `${intros} ${intros === 1 ? 'introduction is' : 'introductions are'} waiting for an answer.` : '',
      hosted ? `${hosted} ${hosted === 1 ? 'fundraiser request is' : 'fundraiser requests are'} waiting for a yes or a not now.` : '',
      noAsk ? 'It’s been a month since the last ask went out.' : '',
    ].filter(Boolean);
    const at = new Date(now).toISOString();
    const row = { key: `notice:nudge:${at}`, kind: 'notice', ref: at, email: plain(lead.email), msg: { subject: 'The Advisory Board has things waiting', line: lines.join('\n\n') }, idem: `advisory-notice:nudge:${at}` };
    await logRow(env.DB);
    await env.DB.batch([
      env.DB.prepare("UPDATE board_state SET data = json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, ?, json(?)), updated_at = ? WHERE key = ?").bind(pathOf('nudgedAt'), JSON.stringify(at), at, LOG),
      oweStatement(env.DB, row, { now }),
    ]);
    await sendOwed(env, [row], { now, make: async (x) => ({ item: { ...noticeItem(x), to: x.email }, replyTo: '' }) });
    return lines;
  } catch (e) { console.error('[advisory-mail] nudge', e.message); return null; }
}

// ─── To advisors (only with the switch on) ──────────────────────────

const LINKS = LINKS_TABLE; // (./_advisory.js makes it with the rest of the Advisory Board's tables too)
const hashOf = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const tokenOf = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Their link for this ask, written at the address they have as it's written (Advisory Board QA round 21: a link
 * written under an address read before a rename was nobody's, and said "expired" minutes later): found by the email
 * it goes to (it moves with them in a rename's own batch), the insert guarded by their record as read and no rename
 * moving records off it (./_member-write.js), read again if either changed. → { t, slug, person } or { why } when no
 * link was written: 'left' (not on the Advisory Board at that email now), 'moving' (a change of their web address is
 * waiting to be settled on People), 'busy' (it kept changing)
 */
async function linkFor(DB, askId, a, now) {
  await DB.prepare(LINKS).run();
  for (let i = 0; i < 5; i++) {
    // (a link written at the address their records are moving onto is theirs: a press of it waits for the move)
    const me = await memberNow(DB, { slug: a.slug, email: a.email }, { into: false });
    if (!me) return { why: 'left' };
    if (me.moving) return { why: 'moving' };
    const t = tokenOf();
    const r = await DB.prepare(`INSERT INTO advisory_links (hash, ask_id, slug, expires) SELECT ?, ?, t.slug, ? FROM team t WHERE ${stillTheirs('t', { into: false })}`)
      .bind(await hashOf(t), askId, new Date(now + LINK_DAYS * 86_400_000).toISOString(), me.slug, me.data).run();
    if (Number(r?.meta?.changes) > 0) return { t, slug: me.slug, person: me.person };
  }
  return { why: 'busy' };
}

/**
 * What a link in an email stands for as things are this moment, its ask's state included, in one read (Advisory Board
 * QA round 21: every case was "This link has expired"; round 22: opening the button read the ask one way and pressing
 * it another, so a closed ask said two different things). Opening it (GET) and pressing it (POST) both ask this, so
 * they say the same. → { why, askId, slug, data, person, hash, ask }, why being, first to fit:
 *   ''         it takes an answer: an active Advisory Board member is at its address, its ask is out and open, it's in
 *              date, nothing moving. `ask`: { title, body }
 *   'left'     its person has left the Advisory Board (alumni, or not active)
 *   'nobody'   an unknown token, its address has nobody there, or its ask is gone (or never went out)
 *   'closed'   its ask has closed (whatever else: answering it can't help now)
 *   'expired'  older than its 30 days
 *   'moving'   a change of web address is still moving records off its address or onto it (partway, or stuck for a
 *              person)
 * Its person, while a rename is moving records off its address, is the one at the new address
 */
export async function linkState(DB, token, { now = Date.now() } = {}) {
  await ensureAdvisory(DB); // (the links and the asks)
  await stateReady(DB);
  const hash = await hashOf(String(token || ''));
  const row = await DB.prepare(`SELECT l.ask_id AS ask_id, l.slug AS slug, l.expires AS expires, t.data AS data, ${movingAt('l.slug')} AS moving,
      (SELECT t2.data FROM team t2 WHERE t2.slug = (SELECT CASE WHEN json_valid(s.data) THEN json_extract(s.data, '$.to') END FROM board_state s WHERE s.key = 'rename-finish:' || l.slug)) AS to_data,
      (SELECT json_object('data', a.data, 'sent', a.sent_at, 'closed', a.closed_at) FROM advisory_asks a WHERE a.id = l.ask_id) AS ask
    FROM advisory_links l LEFT JOIN team t ON t.slug = l.slug WHERE l.hash = ?`).bind(hash).first();
  if (!row) return { why: 'nobody', hash };
  const person = row.data ? personOf(row.data, row.slug) : row.moving && row.to_data ? personOf(row.to_data) : null;
  const ask = askIn(row.ask);
  const out = { askId: row.ask_id, slug: row.slug, data: row.data, person, hash, ask: ask && { title: ask.title, body: ask.body } };
  if (person && !onAdvisoryBoard(person)) return { ...out, why: 'left' };
  if (!person && !row.moving) return { ...out, why: 'nobody' };
  if (!ask) return { ...out, why: 'nobody' };
  if (ask.closed) return { ...out, why: 'closed' };
  if (row.expires <= new Date(now).toISOString()) return { ...out, why: 'expired' };
  if (row.moving) return { ...out, why: 'moving' };
  return { ...out, why: '' };
}
/** A link's ask as linkState reads it: { title, body, closed }, or null when it's gone, never went out or can't be read */
function askIn(json) {
  try {
    const a = JSON.parse(json || 'null');
    if (!a || !a.sent) return null;
    const d = JSON.parse(a.data || 'null');
    return d && typeof d === 'object' ? { title: String(d.title || ''), body: String(d.body || ''), closed: !!a.closed } : null;
  } catch { return null; }
}
/** What a link in an email stands for: { askId, slug }, or null when it can't take an answer (linkState says why) */
export async function linkFrom(DB, token, { now = Date.now() } = {}) {
  const s = await linkState(DB, token, { now });
  return s.why ? null : { askId: s.askId, slug: s.slug };
}
/** Each reason a link can't take an answer, as advisory-action.js says it (`status`: the page's) */
export const LINK_STATUS = { left: 410, expired: 410, nobody: 410, closed: 410, moving: 503 };
const linkRefused = (why) => Object.assign(new Error({
  left: 'This link was for current Advisory Board members, so it doesn’t take answers anymore.',
  expired: 'This link has expired. You can still answer on the Advisory Board page.',
  nobody: 'This link doesn’t work anymore.',
  closed: 'That ask has closed. Thank you for looking. Your page always has what’s current.',
  moving: 'We couldn’t take your answer just now. Please try again in a few minutes.',
}[why]), { status: LINK_STATUS[why], why });

/**
 * A press of the email's button: the answer written at the address its link has as it's written, in one statement
 * resolved from the link's own row (it moves with them), only while an active Advisory Board member is at it exactly
 * as read, it's in date, the ask is open and no rename is moving records off it (Advisory Board QA round 21: an answer
 * written under an address read before a rename was nobody's, or, during a swap, the other person's). Things changed
 * between the read and the write: read again. A link that can't take an answer, its ask closed included, is refused
 * as linkState says (`why`), the words opening it gives. → { askId, slug, name, answer, note }: whose record it landed
 * on, the person that very write was guarded on (its record exactly as read), never read again afterwards (Advisory
 * Board QA round 22)
 */
export async function answerFromLink(DB, token, { answer, note = '' }, { now = Date.now() } = {}) {
  if (!['yes', 'no'].includes(answer)) throw Object.assign(new Error('Choose an answer'), { status: 400 });
  await ensureAdvisory(DB);
  const text = String(note ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 800);
  const at = new Date(now).toISOString();
  for (let i = 0; i < 5; i++) {
    const link = await linkState(DB, token, { now });
    if (link.why) throw linkRefused(link.why);
    const stmt = DB.prepare(`INSERT OR REPLACE INTO advisory_answers (ask_id, slug, answer, note, at, via)
        SELECT l.ask_id, l.slug, ?, ?, ?, 'email' FROM advisory_links l JOIN team t ON t.slug = l.slug
        WHERE l.hash = ? AND l.expires > ? AND t.data = ? AND NOT ${movingAt('l.slug')}
          AND EXISTS (SELECT 1 FROM advisory_asks a WHERE a.id = l.ask_id AND a.sent_at IS NOT NULL AND a.closed_at IS NULL)`)
      .bind(answer, text, at, link.hash, at, link.data);
    // (a yes: whoever runs the group told, owed in this same write, naming the person this write is guarded on:
    // Advisory Board QA round 25)
    const owed = answer === 'yes' ? leadNotice('answer', { name: link.person.name, note: text, ref: `${link.askId}:${link.hash.slice(0, 16)}:${at}` }) : null;
    let r;
    try {
      r = owed
        ? (await DB.batch([stmt, oweStatement(DB, owed, { now, guard: "EXISTS (SELECT 1 FROM advisory_answers a WHERE a.ask_id = ? AND a.at = ? AND a.via = 'email' AND a.answer = 'yes' AND a.slug = (SELECT l.slug FROM advisory_links l WHERE l.hash = ?))", binds: [link.askId, at, link.hash] })]))[0]
        : await stmt.run();
    } catch (e) {
      // (its answer lost, or it never ran: looked for, by what this write alone wrote. There, it's answered as taken)
      const had = await DB.prepare("SELECT 1 AS x FROM advisory_answers WHERE ask_id = ? AND at = ? AND via = 'email' AND answer = ? AND slug = (SELECT slug FROM advisory_links WHERE hash = ?)")
        .bind(link.askId, at, answer, link.hash).first().catch(() => null);
      if (!had) throw e;
      r = { meta: { changes: 1 } };
    }
    if (Number(r?.meta?.changes) > 0) return { askId: link.askId, slug: link.slug, name: link.person.name, answer, note: text, ...(owed ? { notice: owed.key } : {}) };
  }
  throw linkRefused('moving');
}

export function askEmail(ask, first, { yes, no }) {
  const heading = ask.title;
  const html = shell.emailShell({
    preheader: ask.body || 'This month’s ask from the Advisory Board.', eyebrow: 'This month’s ask', heading,
    bodyHtml: para(`${first ? `Hi ${first},` : 'Hello,'}\n\n${ask.body || 'Can you help with this one?'}${ask.link ? `\n\nMore here: ${ask.link}` : ''}`) + shell.buttonRow([shell.button('I can help', yes, 'primary'), shell.button('Not this time', no, 'outline')]),
    footerHtml: 'Questions? Just reply to this email.',
  });
  return { subject: `This month’s ask: ${ask.title}`, html, text: `${first ? `Hi ${first},` : 'Hello,'}\n\n${ask.title}\n\n${ask.body || ''}${ask.link ? `\n\nMore here: ${ask.link}` : ''}\n\nI can help: ${yes}\nNot this time: ${no}` };
}

// ─── Owed emails: claimed with what makes them owed, sent once ──────────

/*
 * Every Advisory Board email but the welcome goes this way (Advisory Board QA round 25: the monthly ask went, its note
 * after it didn't save, the press said "That didn't go through" and the card offered to email everyone again; an update
 * email was lost when a read after its status's write failed). Who it goes to is written down (./_advisory.js
 * advisory_outbox) in the same write as what makes it owed, before it goes; it goes under its own idempotency key, so a
 * retry can never make a second; it's marked had with its send; a press again sends to nobody who had it; and whatever is
 * still owed the heartbeat sends, once (sendOwedMail). The welcome has its own record of the same shape, kept where it
 * was (welcomed / waiting, claimWelcome, its key: sendWelcome), and the board's emails theirs (./_board.js sendOnce).
 */
const KEY_DAY_MS = 23 * 60 * 60 * 1000; // Resend keeps an idempotency key a day: one asked again later could make a second
const OWED_BUSY_MS = 2 * 60 * 1000; // a row a press has claimed this minute: the heartbeat leaves it to that press
// Resend's own no: tried again, each time a little later (the n-th try no sooner than n² minutes after it was owed), and
// after this many, about ten hours, it stops being tried ('refused'): an outage of the email service never loses one
const OWED_TRIES = 24;
// (to Advisory Board members: only with their emails switched on. To whoever runs the group: always)
const TO_MEMBERS = new Set(['ask', 'update', 'gift', 'goal']);
const TAGS = { ask: 'advisory-ask', update: 'advisory-update', gift: 'advisory-update', goal: 'advisory-update', notice: 'advisory-lead' };
const isoOf = (ms) => new Date(ms).toISOString();
/** Tried again once, at once: a database that didn't answer for a moment never leaves an email owed */
const twice = async (fn) => { try { return await fn(); } catch (e) { console.error('[advisory-mail] trying again', e?.message || e); return fn(); } };
const rowOf = (r) => (r ? { ...r, msg: (() => { try { return JSON.parse(r.msg || 'null'); } catch { return null; } })() } : null);
const many = (n) => (n === 1 ? '1 Advisory Board member' : `${n} Advisory Board members`);
// (staff's words name a member as the row does: their first word, "Changing this emails Ona")
const firstWord = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/**
 * Owed emails sent (`rows`, as their claim wrote them): each made (`make(row)` → { item } or { skip, name }), claimed
 * for this send (when it first went to Resend), sent under its own key, and marked had with its send. Each step is tried
 * twice; one that still fails leaves the email owed, for the heartbeat, and never sends anything twice. An email Resend
 * took whose mark didn't save stays owed: the heartbeat asks Resend again under the same key, which sends nothing again,
 * then marks it. → { sent, owed, had, skipped: [{ name, why }], unsure }
 */
async function sendOwed(env, rows, { now = Date.now(), make, replyTo = null }) {
  const DB = env.DB;
  const out = { sent: 0, owed: 0, had: 0, skipped: [], unsure: 0 };
  for (const row of rows) {
    let made;
    try { made = await twice(() => make(row)); } catch (e) { console.error('[advisory-mail] an owed email couldn’t be made (the heartbeat sends it)', row.key, e?.message || e); out.owed += 1; continue; }
    if (made.skip) {
      // (never went: said why, and never tried again)
      await twice(() => DB.prepare('UPDATE advisory_outbox SET outcome = ? WHERE key = ? AND idem = ? AND sent_at IS NULL AND outcome IS NULL').bind(`skipped:${made.skip}`, row.key, row.idem).run())
        .catch((e) => console.error('[advisory-mail] a skipped email not noted', row.key, e?.message || e));
      out.skipped.push({ name: made.name || '', why: made.skip });
      continue;
    }
    let claim;
    try {
      claim = await twice(() => DB.prepare('UPDATE advisory_outbox SET tried_at = COALESCE(tried_at, ?) WHERE key = ? AND idem = ? AND sent_at IS NULL AND outcome IS NULL RETURNING tried_at').bind(isoOf(now), row.key, row.idem).first());
    } catch (e) { console.error('[advisory-mail] an owed email not claimed (the heartbeat sends it)', row.key, e?.message || e); out.owed += 1; continue; }
    // (had it already, or a newer one is owed in its place)
    if (!claim) { out.had += 1; continue; }
    if (Date.parse(claim.tried_at) < now - KEY_DAY_MS) {
      // Went to Resend a day ago and was never marked: asked again, Resend no longer knows its key, so it could make a
      // second. Counted as gone, unconfirmed
      await twice(() => DB.prepare("UPDATE advisory_outbox SET outcome = 'unsure' WHERE key = ? AND idem = ? AND sent_at IS NULL").bind(row.key, row.idem).run()).catch(() => {});
      out.had += 1;
      continue;
    }
    const r = await sendEmailItems(env, [made.item], { from: FROM, replyTo: made.replyTo ?? replyTo, tags: tag(TAGS[row.kind] || 'advisory-update'), idempotencyKey: row.idem });
    if (r.sent > 0 || r.already > 0) {
      out.sent += 1;
      await twice(() => DB.prepare("UPDATE advisory_outbox SET sent_at = ?, outcome = 'sent' WHERE key = ? AND idem = ?").bind(isoOf(now), row.key, row.idem).run())
        .catch((e) => console.error('[advisory-mail] an email went but wasn’t marked (the heartbeat marks it, sending nothing again)', row.key, e?.message || e));
    } else if (unsureOf(r)) {
      // (no answer: it may have gone. The heartbeat asks again under the same key, which sends it only if it didn't)
      out.owed += 1;
      out.unsure += 1;
    } else {
      // Resend's own no: nothing went. Tried again by the heartbeat, a few times
      out.owed += 1;
      await twice(() => DB.prepare(`UPDATE advisory_outbox SET tried_at = NULL, tries = tries + 1, outcome = CASE WHEN tries + 1 >= ${OWED_TRIES} THEN 'refused' ELSE NULL END WHERE key = ? AND idem = ? AND sent_at IS NULL`).bind(row.key, row.idem).run())
        .catch((e) => console.error('[advisory-mail] a refused email not noted', row.key, e?.message || e));
    }
  }
  return out;
}

/** Why a member's ask wasn't sent, as the mail log says it */
const SKIP_WORDS = { left: 'not on the Advisory Board by then', moving: 'a change of their web address is waiting to be settled on People', busy: 'their People record kept changing', closed: 'the ask had closed' };

/**
 * One member's monthly ask, made as it goes: their link (written at the address they have now, linkFor) and their
 * greeting. `ask`: the ask's row ({ id, sent_at, closed_at, data }). → { item } | { skip, name }
 */
async function askItem(env, row, { ask, preferred, now }) {
  if (!ask || !ask.sent_at || ask.closed_at) return { skip: 'closed', name: row.msg?.name };
  const link = await linkFor(env.DB, ask.id, { slug: row.msg?.slug || '', email: row.email }, now);
  if (!link.t) return { skip: link.why, name: row.msg?.name };
  // (renamed on People as it went: the name kept for their emails moved with them)
  let names = preferred;
  if (row.msg?.slug && link.slug !== row.msg.slug) names = await preferredNames(env.DB).catch(() => preferred);
  const at = (d) => `${SITE_ORIGIN}/api/advisory-action?t=${encodeURIComponent(link.t)}&do=${d}`;
  let d = {};
  try { d = JSON.parse(ask.data || '{}') || {}; } catch { d = {}; }
  return { item: { to: row.email, ...askEmail({ title: String(d.title || ''), body: String(d.body || ''), link: d.link || '' }, greetingOf({ name: row.msg?.name || '', ...link.person, slug: link.slug }, names), { yes: at('yes'), no: at('no') }) } };
}

/** What a press of the ask says happened, in plain words (`out`: put it out too, else Email it) */
export function askWords(r, { out = true } = {}) {
  if (r.off) return out ? 'It’s on the page. Emails are off, so nothing was sent.' : 'Nothing went out: emails are off.';
  if (r.already) return out ? 'It’s on the page. The Advisory Board already had this email.' : 'The Advisory Board already had this email.';
  const skipped = r.skipped?.length ? ` Not sent to ${r.skipped.map((x) => `${x.name || 'someone'} (${SKIP_WORDS[x.why] || 'not sent'})`).join(', ')}.` : '';
  if (!r.sent && !r.owed) return `${out ? 'It’s on the page, but' : 'Nothing went out:'} no Advisory Board member has an email the site can send it to.${skipped}`;
  if (!r.owed) return `${out ? 'It’s out, and emailed to' : 'Emailed to'} ${many(r.sent)}.${skipped}`;
  if (!r.sent) return `${out ? 'The ask is out. Its email goes to' : 'Its email goes to'} ${many(r.owed)} in a few minutes.${skipped}`;
  return `${out ? 'The ask is out. ' : ''}It went to ${many(r.sent)}; the other ${r.owed} ${r.owed === 1 ? 'gets' : 'get'} it in a few minutes.${skipped}`;
}

/**
 * The monthly ask put out (`out`), and with the emails on, emailed to the Advisory Board; or one already out, emailed
 * (Email it: `out` false). What the emails need is read first (who they go to, how each is greeted, who replies are to),
 * then one write puts it out and claims an email for each member (./_advisory.js askOut: its `mailed`, which the card's
 * "Email it" comes from), then each goes under its own key ('advisory-ask:<ask>:<address>') and is marked with its send.
 * The write failing: 503, nothing changed. Landed, whatever fails after it is said as what was done (200), and the
 * heartbeat sends what's still owed, once. → { ask, sent: { off } | { already } | { sent, owed, skipped }, said }
 */
export async function askPress(env, id, { emails, out = true, now = Date.now() } = {}) {
  const DB = env.DB;
  if (!emails) {
    if (!out) return { ask: null, sent: { off: true }, said: askWords({ off: true }, { out }) };
    const { ask } = await askOut(DB, id, { now });
    return { ask, sent: { off: true }, said: askWords({ off: true }, { out }) };
  }
  // Everything the emails need, read before the write: a read that fails changes nothing, and says so
  let settings; let had; let members; let preferred; let reply;
  try {
    settings = await getSettings(DB);
    had = (await mailLog(DB)).some((l) => l.kind === 'ask' && l.id === id && l.sent > 0);
    members = had ? [] : (await activeAdvisors(DB)).filter((a) => isEmail(a.email));
    preferred = had ? {} : await preferredNames(DB);
    reply = had ? null : await replyTo(env, settings);
  } catch (e) {
    console.error('[advisory-mail] the ask: a read before its write', e?.message || e);
    throw Object.assign(new Error(e?.unread ? `We couldn’t check People just now, so ${out ? 'the ask isn’t out and nothing was sent' : 'nothing was sent'}. Please try again in a moment.` : ASK_NOT_OUT(true, out)), { status: 503, unread: !!e?.unread });
  }
  // (an ask emailed before its mark was kept on it: the log said so, and still does)
  if (had) {
    const { ask } = out ? await askOut(DB, id, { now }) : { ask: null };
    return { ask, sent: { already: true }, said: askWords({ already: true }, { out }) };
  }
  const rows = members.map((a) => {
    const to = plain(a.email);
    return { key: `ask:${id}:${to}`, kind: 'ask', ref: id, email: to, msg: { slug: a.slug, name: a.name }, idem: `advisory-ask:${id}:${to}` };
  });
  // (nobody it could go to: nothing claimed, so it isn't marked emailed, and Email it stays offered for when someone can)
  if (!rows.length) {
    const ask = out ? (await askOut(DB, id, { now })).ask : null;
    return { ask, sent: { sent: 0, owed: 0, none: true }, said: askWords({ sent: 0, owed: 0 }, { out }) };
  }
  const w = await askOut(DB, id, { now, out, mail: { owe: (guard, binds) => rows.map((r) => oweStatement(DB, r, { now, guard, binds })) } });
  if (!w.mailing) return { ask: w.ask, sent: { already: true }, said: askWords({ already: true }, { out }) };
  const row = { id, sent_at: w.ask.sentAt, closed_at: w.ask.closedAt || null, data: JSON.stringify({ title: w.ask.title, body: w.ask.body, link: w.ask.link }) };
  const r = await sendOwed(env, rows, { now, replyTo: reply, make: (x) => askItem(env, x, { ask: row, preferred, now }) });
  const result = { sent: r.sent, owed: r.owed, ...(r.skipped.length ? { skipped: r.skipped } : {}) };
  // (the log staff read: one that doesn't save is never in the way of the answer)
  await noteAsk(DB, { id, title: w.ask.title }, result, now).catch((e) => console.error('[advisory-mail] the ask’s log', e?.message || e));
  return { ask: w.ask, sent: result, said: askWords(result, { out }) };
}
/** The ask's line in the mail log, for staff to read */
async function noteAsk(DB, ask, r, now) {
  const notSent = r.skipped?.length ? ` Not sent to ${r.skipped.map((x) => `${x.name} (${SKIP_WORDS[x.why] || 'not sent'})`).join(', ')}.` : '';
  const went = r.sent + r.owed;
  await remember(DB, {
    kind: went ? 'ask' : 'ask-failed', id: ask.id, title: ask.title, sent: went, ...(r.owed ? { owed: r.owed } : {}),
    ...(r.skipped?.length ? { skipped: r.skipped.map((x) => ({ name: x.name, why: x.why })) } : {}),
    ...(went ? (notSent ? { what: `This month’s ask: ${ask.title}.${notSent}` } : {}) : { what: `This month’s ask didn’t send: ${ask.title}.${notSent}` }),
  }, now);
}
/**
 * An ask that's out, emailed to the Advisory Board, as askPress's Email it (kept for what called it before). →
 * { off } | { already } | { sent, owed, skipped? }
 */
export async function sendAsk(env, ask, { now = Date.now() } = {}) {
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { off: true };
  const r = await askPress(env, ask.id, { emails: true, out: false, now });
  return r.sent.already ? { already: true } : { ...r.sent, ...(r.sent.skipped ? { skipped: r.sent.skipped.length } : {}) };
}

/** An introduction's update email, in what it says (as the write that made it owed saves it) */
export function introWords(intro) {
  const label = INTRO_STATUSES.find((s) => s.id === intro.status);
  return { subject: `An update on ${intro.name}`, heading: `${intro.name}: ${label?.label || intro.status}`, line: `An update on your introduction: ${label?.sub || label?.label || ''}.${intro.note ? `\n\n${intro.note}` : ''}` };
}
/** A fundraiser request's update email */
export function hostWords(hosted) {
  const label = HOSTED_STATUSES.find((s) => s.id === hosted.status);
  return { subject: `Your fundraiser: ${hosted.title}`, heading: `${hosted.title}: ${label?.label || hosted.status}`, line: hosted.note || `Your request to host is now marked ${String(label?.label || hosted.status).toLowerCase()}.` };
}
/** A gift on their page */
const giftWords = (n) => ({ subject: 'A gift came through your page', heading: 'A gift came through your page', line: `${n === 1 ? 'Someone' : `${n} people`} gave through your page. Thank you for sharing it.` });
/** The group reached the goal: a thank-you to everyone, with no kid named */
const goalWords = () => ({ subject: 'You reached the goal', heading: 'You reached the goal', line: 'You did it. Together you have raised enough to fund a makeover. There’s more to come at the next meeting.' });
/** An email to one member, from the words its row keeps */
const memberItem = (row) => {
  const { subject, heading, line } = row.msg || {};
  return { to: row.email, subject, text: `${line}\n\n${PAGE}`, html: shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading, bodyHtml: para(line) + shell.button('Open your page', PAGE, 'primary', { big: true }) }) };
};

/**
 * Where an introduction or a fundraiser request stands (`kind` 'intro' | 'hosted'), set by staff, and the member's update
 * email with it (Advisory Board QA round 25: the status saved, a read after it for the email failed, staff were told
 * "nothing was changed", and the email never went). The reads the email needs come first: what's owed for it already,
 * and with the emails on, the member and their email, and who replies are to. Then one write: the status, and the update
 * owed ('update:<kind>:<id>', keyed by the record, the status and that change), in place of one owed for an older change
 * that hasn't gone (only the newest goes: one email saying where it stands now). Then it goes, and is marked. Pressed
 * again with no change, one an earlier change left owed goes (it's owed by the write, never by `changed`).
 * → { record, changed, sent: null | { sent, owed, none?, first }, said }
 */
export async function statusPress(env, kind, id, body, { by = '', settings, now = Date.now() } = {}) {
  const DB = env.DB;
  await ensureAdvisory(DB);
  const key = `update:${kind}:${id}`;
  // (what's owed for it already: read before the write, as everything the email needs is)
  const owedNow = rowOf(await DB.prepare('SELECT * FROM advisory_outbox WHERE key = ? AND sent_at IS NULL AND outcome IS NULL').bind(key).first());
  let row = null;
  let member = null;
  let reply = null;
  let none = false;
  const mail = async ({ next, changed, guard, binds }) => {
    if (!settings.emails) return changed && owedNow ? [unoweStatement(DB, key, { guard, binds })] : [];
    if (!changed && !owedNow) return [];
    const onBoard = await activeAdvisors(DB);
    reply = await replyTo(env, settings);
    if (!changed) {
      // (pressed again with no change: the one an earlier change left owed goes, to them as they are now)
      member = onBoard.find((a) => plain(a.email) === owedNow.email) || null;
      return [];
    }
    member = onBoard.find((a) => a.slug === next.slug) || null;
    if (!member || !isEmail(member.email)) {
      none = true;
      return owedNow ? [unoweStatement(DB, key, { guard, binds })] : [];
    }
    const to = plain(member.email);
    row = { key, kind: 'update', ref: id, email: to, msg: { ...(kind === 'intro' ? introWords(next) : hostWords(next)), first: firstWord(member.name) }, idem: `advisory-update:${kind}:${id}:${next.status}:${next.updatedAt}` };
    return [oweStatement(DB, row, { now, guard, binds, replace: true })];
  };
  const set = kind === 'intro' ? setIntroStatus : setHosted;
  const w = await set(DB, id, body, { by, now, mail });
  const record = kind === 'intro' ? w.intro : w.hosted;
  const going = row || (!w.changed && owedNow && settings.emails ? owedNow : null);
  if (!going) {
    const sent = none ? { sent: 0, owed: 0, none: true } : null;
    return { record, changed: w.changed, sent, said: none ? `${firstWord(member?.name || '') || 'They'} ${member ? 'has no email on file' : 'isn’t on the Advisory Board now'}, so no email went.` : '' };
  }
  const first = going.msg?.first || firstWord(member?.name || '') || 'The Advisory Board member';
  const r = await sendOwed(env, [going], { now, replyTo: reply, make: async (x) => (member && plain(member.email) === x.email ? { item: memberItem(x) } : { skip: 'left', name: first }) });
  const sent = { sent: r.sent, owed: r.owed, first, ...(r.skipped.length ? { skipped: r.skipped } : {}) };
  // (the log staff read: one that doesn't save is never in the way of the answer)
  if (r.sent) await remember(DB, { kind: 'advisory-update', sent: r.sent }, now).catch((e) => console.error('[advisory-mail] the log', e?.message || e));
  return { record, changed: w.changed, sent, said: r.sent ? `${first} was emailed.` : r.owed ? `${first}’s email goes in a few minutes.` : r.skipped.length ? `${first} isn’t on the Advisory Board at that email now, so no email went.` : '' };
}

/**
 * The heartbeat: every Advisory Board email still owed (claimed with what made it owed, and not marked had), sent once.
 * One to members waits while their emails are off; an ask that has closed, or a member no longer on the Advisory Board
 * at that email, comes off with why. A row a press claimed this minute is left to that press. Never throws for one email:
 * each is its own (sendOwed). → { sent, owed, skipped }
 */
export async function sendOwedMail(env, { now = Date.now(), only = null } = {}) {
  const DB = env.DB;
  await ensureAdvisory(DB);
  const rows = ((await DB.prepare('SELECT * FROM advisory_outbox WHERE sent_at IS NULL AND outcome IS NULL AND (tried_at IS NULL OR tried_at < ?) ORDER BY owed_at LIMIT 200').bind(isoOf(only ? now + 1 : now - OWED_BUSY_MS)).all()).results || []).map(rowOf)
    .filter((r) => (only ? only(r) : !r.tries || Date.parse(r.owed_at) < now - r.tries * r.tries * 60_000));
  if (!rows.length) return { sent: 0, owed: 0 };
  const settings = await getSettings(DB);
  const due = rows.filter((r) => settings.emails || !TO_MEMBERS.has(r.kind));
  if (!due.length) return { sent: 0, owed: rows.length, off: true };
  const onBoard = due.some((r) => TO_MEMBERS.has(r.kind)) ? await activeAdvisors(DB) : [];
  const askIds = [...new Set(due.filter((r) => r.kind === 'ask').map((r) => r.ref))];
  const asks = {};
  for (const askId of askIds) asks[askId] = await DB.prepare('SELECT id, sent_at, closed_at, data FROM advisory_asks WHERE id = ?').bind(askId).first();
  const preferred = askIds.length ? await preferredNames(DB) : {};
  const lead = await leadOf(env, settings);
  const make = async (row) => {
    if (row.kind === 'ask') return askItem(env, row, { ask: asks[row.ref], preferred, now });
    if (row.kind === 'notice') return { item: { ...noticeItem(row), to: row.email || lead.email }, replyTo: '' };
    // (to a member as they are now: still on the Advisory Board at that email)
    if (!onBoard.some((a) => plain(a.email) === row.email)) return { skip: 'left', name: row.msg?.first || '' };
    return { item: memberItem(row) };
  };
  const r = await sendOwed(env, due, { now, replyTo: lead.email, make });
  // (the log staff read: one that doesn't save is never in the way)
  if (r.sent) await remember(DB, { kind: due.every((x) => x.kind === 'ask') ? 'ask-owed' : 'advisory-update', sent: r.sent, what: `${r.sent === 1 ? 'An Advisory Board email that was waiting' : `${r.sent} Advisory Board emails that were waiting`} went out` }, now)
    .catch((e) => console.error('[advisory-mail] the log', e?.message || e));
  return { sent: r.sent, owed: r.owed + rows.length - due.length, ...(r.skipped.length ? { skipped: r.skipped.length } : {}) };
}

/**
 * New gifts on members' pages (the money's heartbeat: ./_advisory-money.js), each member's note owed in the same write
 * that keeps the gifts as seen: as statements for it. `fresh`: { slug: { n, ids } }. → statements
 */
export async function giftOwed(env, fresh, { now = Date.now(), settings = null, members = null } = {}) {
  if (!Object.keys(fresh || {}).length || !(settings || await getSettings(env.DB)).emails) return [];
  const onBoard = members || await activeAdvisors(env.DB);
  const out = [];
  for (const [slug, f] of Object.entries(fresh)) {
    const a = onBoard.find((x) => x.slug === slug);
    if (!a || !isEmail(a.email)) continue;
    const to = plain(a.email);
    // (keyed by the gifts themselves: the same gifts seen twice are one note)
    const ids = [...(f.ids || [])].sort().join(',');
    const h = (await hashOf(ids)).slice(0, 24);
    out.push(oweStatement(env.DB, { key: `gift:${to}:${h}`, kind: 'gift', ref: slug, email: to, msg: { ...giftWords(f.n), first: firstOf(a.name) }, idem: `advisory-gift:${to}:${h}` }, { now }));
  }
  return out;
}
/**
 * One gift note to one member now, owed and sent the same way (kept for what called it before: the heartbeat's notes are
 * owed in the money's own write, giftOwed, and go with sendOwedMail). → { sent, owed }
 */
export async function sendGiftNote(env, slug, n, { now = Date.now() } = {}) {
  await ensureAdvisory(env.DB);
  const stmts = await giftOwed(env, { [slug]: { n, ids: [`note:${isoOf(now)}`] } }, { now });
  if (!stmts.length) return { sent: 0 };
  await env.DB.batch(stmts);
  return sendOwedMail(env, { now, only: (r) => r.kind === 'gift' && r.ref === slug });
}

/**
 * The goal reached, once a term: everyone's thank-you (no kid named) and the notice to whoever runs the group and the
 * admins, owed in the same write that marks the term's goal as reached: as statements for it
 */
export async function goalOwed(env, settings, { raised = 0, now = Date.now() } = {}) {
  const term = settings.termStart;
  const out = [];
  if (settings.emails) {
    for (const a of (await activeAdvisors(env.DB)).filter((x) => isEmail(x.email))) {
      const to = plain(a.email);
      out.push(oweStatement(env.DB, { key: `goal:${term}:${to}`, kind: 'goal', ref: term, email: to, msg: { ...goalWords(), first: firstOf(a.name) }, idem: `advisory-goal:${term}:${to}` }, { now }));
    }
  }
  const lead = await leadOf(env, settings);
  const admins = await boardAdmins(env.DB);
  for (const to of [...new Set([lead.email, ...admins].map(plain))].filter(isEmail)) {
    out.push(oweStatement(env.DB, { key: `notice:goal:${term}:${to}`, kind: 'notice', ref: term, email: to, msg: { what: 'goal', kid: !!settings.kid, raised }, idem: `advisory-notice-goal:${term}:${to}` }, { now }));
  }
  return out;
}
/** A notice to whoever runs the group (or the admins), from the words its row keeps */
function noticeItem(row) {
  const m = row.msg || {};
  if (m.what === 'goal') {
    const subject = 'The Advisory Board reached its goal';
    const line = m.kid
      ? 'The group has raised its goal. Next, move their makeover’s job forward in JobTread, because the site never changes a job’s status.'
      : 'The group has raised its goal. Next, pick the kid the group will sponsor on Members, then move that job forward in JobTread.';
    return { subject, text: `${line}\n\n${RUN}`, html: shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading: subject, bodyHtml: para(line) + shell.button('Open Members', RUN, 'primary', { big: true }) }) };
  }
  const { subject, line } = m;
  return { subject, text: `${line}\n\n${RUN}`, html: shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading: subject, bodyHtml: para(line) + shell.button('Open Run it', RUN, 'primary', { big: true }) }) };
}

/** first: the name to greet them by ('' for none: "Hello," and "Welcome to the Advisory Board", never a name guessed) */
export function welcomeMessage(first, leadName = '') {
  const line = `Your Advisory Board page is ready. It has the next meeting, this month’s ask, how to help with the goal, and everyone in the group. Sign in with this email address: you’ll get a code, and there’s no password to remember.${leadName ? `\n\n${firstOf(leadName)} runs the group. If you have a question, just reply to this email.` : ''}`;
  return {
    subject: 'Your Advisory Board page is ready', text: `${first ? `Hi ${first},` : 'Hello,'}\n\n${line}\n\n${PAGE}`,
    html: shell.emailShell({ preheader: 'Your Advisory Board page is ready.', eyebrow: 'Advisory Board', heading: first ? `Welcome, ${first}` : 'Welcome to the Advisory Board', bodyHtml: para(line) + shell.button('Open your page', PAGE, 'primary', { big: true }) }),
  };
}

/**
 * Added to the Advisory Board from their application: their welcome, now if they can sign in already, else as
 * soon as they can (the heartbeat sends it). With the Advisory Board's emails off it waits for them to be turned
 * on. → { sent } | { waiting, why: 'sign-in' | 'setup' | 'send' | 'check' } | { off, queued } (the switch) | { already } | { noEmail }
 *   why 'sign-in': Cloudflare hasn't taken the list yet (minutes); 'setup': the sign-in isn't set up all the way
 *   (the Access key, or the policy on the admin's sign-in); 'send': the email service didn't take it; 'check': People
 *   or their email couldn't be read just now (never taken for "no email": the heartbeat sends it)
 */
export async function welcomeOnJoin(env, slug, { by = '', now = Date.now(), fetchImpl = fetch, greet = null } = {}) {
  const settings = await getSettings(env.DB);
  // (greet: as queueWelcome's, '' a decision too: no name)
  const decided = typeof greet === 'string';
  const wait = () => setEntry(env.DB, 'waiting', slug, { at: new Date(now).toISOString(), by, ...(decided ? { greet } : {}) });
  // (People and their private emails read so a read that fails says so: never taken for "they have no email". It waits,
  // written down as waiting, and the heartbeat sends it once it can check: 'check')
  let me;
  try { me = (await activeAdvisors(env.DB)).find((a) => a.slug === slug); } catch (e) {
    console.error('[advisory-mail] welcome: People or their emails couldn’t be read', e?.message || e);
    await wait().catch(() => {});
    return { waiting: true, why: 'check' };
  }
  if (hasOrGoing((await readState(env.DB, LOG)).welcomed?.[slug], now, me?.email)) return { already: true }; // (had it, or it's on its way)
  if (!me || !memberSignIn(me.email)) return { noEmail: true }; // (none, or one that signs in as staff or a group: it waits for their own)
  if (!settings.emails) { await wait(); return { off: true, queued: true }; }
  // The sign-in list now, not at the next heartbeat: the email's link works the moment it lands
  if (!(await canSignIn(env, me.email))) await syncBoardAccess(env, { fetchImpl, now }).catch(() => null);
  let why = 'sign-in';
  if (await canSignIn(env, me.email)) {
    const r = await sendWelcome(env, { by, slugs: [slug], now, greet: decided ? { [slug]: greet } : {} });
    // (it went, whatever doesn't save after: it's said as sent. A mark that didn't save keeps it waiting, so the
    // heartbeat writes the mark, asking Resend again under the same key, which sends nothing twice)
    if (r.sent) { await (r.unmarked?.includes(slug) ? wait() : removeEntry(env.DB, 'waiting', slug)).catch((e) => console.error('[advisory-mail] welcome went; waiting not updated', e?.message)); return { sent: r.sent }; }
    // (two at once: the other one has it, or is sending it)
    if (hasOrGoing((await readState(env.DB, LOG)).welcomed?.[slug], now, me.email)) return { already: true };
    why = 'send'; // the email service didn't take it: the heartbeat tries again
  } else {
    // Not a matter of minutes: the sign-in itself isn't set up all the way (Board → Members says what's left)
    // (no Access key, or a sync that worked found the policy missing; Cloudflare briefly not answering is minutes)
    const a = await accessStatus(env).catch(() => null);
    if (a && (!a.configured || a.attached === false)) why = 'setup';
  }
  await wait();
  return { waiting: true, why };
}

/** The heartbeat: welcomes that waited for the sign-in to know them, sent once it does. Someone who left, or had theirs, comes off */
export async function sendWaitingWelcomes(env, { now = Date.now() } = {}) {
  const log = await readState(env.DB, LOG);
  const waiting = Object.keys(log.waiting || {});
  if (!waiting.length) return { sent: 0 };
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { sent: 0, off: true }; // switched off meanwhile: they wait (switched on, they go)
  const on = await activeAdvisors(env.DB);
  const ready = [];
  for (const slug of waiting) {
    const me = on.find((a) => a.slug === slug);
    // (not on the Advisory Board now, or had it: comes off. On it with no working email yet: waits for staff to add one)
    if (!me || hadIt(log.welcomed?.[slug], me.email)) await removeEntry(env.DB, 'waiting', slug);
    else if (isEmail(me.email) && await canSignIn(env, me.email)) ready.push(slug);
  }
  // (each with the name it was written down with)
  const greet = Object.fromEntries(ready.map((slug) => [slug, log.waiting?.[slug]?.greet]).filter(([, g]) => typeof g === 'string'));
  const r = ready.length ? await sendWelcome(env, { by: 'the site', slugs: ready, now, greet }) : { sent: 0 };
  const after = await readState(env.DB, LOG);
  for (const slug of ready) if (hadIt(after.welcomed?.[slug], on.find((a) => a.slug === slug)?.email)) await removeEntry(env.DB, 'waiting', slug);
  return { sent: r.sent || 0, waiting: Object.keys((await readState(env.DB, LOG)).waiting || {}).length };
}

/**
 * Where a claimed welcome's record is now: at their address as it was read, or, renamed on People while it went (the
 * rename moves the claim: renameMemberStatements), at the address their claim moved to. Found by the claim's moment AND
 * the email it went to, at their own address too: every welcome in one send shares the moment, so two members whose
 * addresses were swapped meanwhile each find their own, never the other's (Advisory Board QA round 19). → the slug to
 * mark, or null when no claim of theirs is found (or the record can't be read): nothing is marked, and the claim lapses
 * in ten minutes for the heartbeat to ask Resend again under the same key, which sends nothing twice
 */
/**
 * A claimed welcome marked had (`value`) or put back (`value` null: taken off, or `was` written back), wherever its claim
 * is as the mark is written, in one statement: found by the claim's moment and the email it went to (their own address
 * first), so a People rename between finding the claim and marking it never leaves the mark at the address they left,
 * with the claim at the new one sent again (Advisory Board QA round 21). → whether a claim of theirs was found and
 * marked: none, nothing is marked, and the claim lapses in ten minutes for the heartbeat
 */
async function markClaim(DB, a, now, to, value) {
  await logRow(DB);
  const sending = new Date(now).toISOString();
  const keyOf = `(SELECT j.key FROM json_each(board_state.data, '$."welcomed"') AS j WHERE json_type(j.value) = 'object' AND json_extract(j.value, '$.sending') = ?1 AND lower(json_extract(j.value, '$.sendingTo')) = ?2 ORDER BY j.key = ?3 DESC LIMIT 1)`;
  const set = value === null ? `json_remove(data, '$."welcomed".' || json_quote(${keyOf}))` : `json_set(data, '$."welcomed".' || json_quote(${keyOf}), json(?4))`;
  const r = await DB.prepare(`UPDATE board_state SET data = ${set}, updated_at = ?5 WHERE key = ?6 AND json_valid(data) AND ${keyOf} IS NOT NULL`)
    .bind(sending, plain(to), a.slug, JSON.stringify(value ?? null), new Date().toISOString(), LOG).run();
  return Number(r?.meta?.changes) > 0;
}
async function claimNow(DB, a, now, to) {
  try {
    const welcomed = (await readState(DB, LOG)).welcomed || {};
    const sending = new Date(now).toISOString();
    const theirs = (k) => !!welcomed[k] && typeof welcomed[k] === 'object' && welcomed[k].sending === sending && plain(welcomed[k].sendingTo) === to;
    if (theirs(a.slug)) return a.slug;
    return Object.keys(welcomed).find(theirs) || null;
  } catch { return null; }
}

/**
 * Your page is ready: to those named, once each, who haven't had it. Each is claimed before theirs goes (a press
 * and the heartbeat at once never email anyone twice), marked had only once it went, and put back as it was if it
 * didn't, so the next try sends it.
 * anyway: sent with the switch off (only sendWelcomeTo, a person's press). again: to one who had it AGAIN_MS ago or more
 */
export async function sendWelcome(env, { by = '', slugs = null, now = Date.now(), greet = {}, anyway = false, again = false, who = '' } = {}) {
  const settings = await getSettings(env.DB);
  if (!settings.emails && !anyway) return { off: true, sent: 0 };
  // (only to an address that signs them in as an Advisory Board member: never a SOARD address or group inbox)
  const advisors = (await activeAdvisors(env.DB)).filter((a) => memberSignIn(a.email) && (!slugs || slugs.includes(a.slug)));
  // (each one's record as it was before this send: one that had it keeps it if this one fails)
  const was = (await readState(env.DB, LOG)).welcomed || {};
  const mine = [];
  for (const a0 of advisors) {
    let a = a0;
    for (let i = 0; i < 5; i++) {
      if (await claimWelcome(env.DB, a.slug, now, a.email, { again })) { mine.push({ ...a, was: was[a0.slug] }); break; }
      // (renamed on People since the list was read: claimed at the address they have now; else it wasn't theirs to
      // claim: had it, or on its way)
      const me = await memberNow(env.DB, { slug: a.slug, email: a.email }, { into: false });
      if (!me || me.moving || me.slug === a.slug) break;
      a = { ...a, ...me.person, slug: me.slug, email: a.email };
    }
  }
  if (!mine.length) return { sent: 0, failed: 0 };
  const lead = await leadOf(env, settings);
  const preferred = { ...(await preferredNames(env.DB)), ...greet };
  const at = new Date(now).toISOString();
  let sent = 0;
  let failed = 0;
  let unsure = 0;
  const unmarked = [];
  for (const a of mine) {
    const to = plain(a.email);
    // Each welcome its own Resend call under its own key (as the board's sends are, ./_board.js sendOnce): the same
    // welcome asked for twice within a day (the press, then the heartbeat after a mark that didn't save) goes once, and
    // Resend's 409 for one it has already is a welcome that went. One sent on purpose again (Send it again on their row)
    // is a welcome of its own: keyed by the one before it, at this address (its claim keeps when that went)
    // (keyed by the address it goes to, never their web address: renamed on People while it was going, it's still the same
    // welcome to the same person, Advisory Board QA round 18)
    const key = `advisory-welcome:${to}${again && hadIt(a.was, to) && sentAt(a.was) ? `:after:${sentAt(a.was)}` : ''}`;
    const r = await sendEmailItems(env, [{ to: a.email, ...welcomeMessage(greetingOf(a, preferred), lead.name) }], { from: FROM, replyTo: lead.email, tags: tag('advisory-welcome'), idempotencyKey: key });
    const went = r.sent > 0 || r.already > 0;
    // (their record as it is now: a People rename while it went moves the claim to their new address, and the mark goes
    // where the claim is as it's written, never left at the old one with the claim waiting to be sent again: markClaim)
    const slug = await claimNow(env.DB, a, now, to);
    if (went || unsureOf(r)) {
      // (no answer: counted as sent, so nothing sends it a second time)
      sent += 1;
      if (!went) unsure += 1;
      // A welcome that went is a welcome that went: its mark not saving never makes it read as one that didn't. It stays
      // claimed ("on its way"), and the next send of it (the heartbeat's, once the claim is ten minutes old) asks Resend
      // under the same key, which sends nothing again and answers as before: then it's marked
      try {
        if (!(await markClaim(env.DB, a, now, to, { at, to, ...(went ? {} : { unconfirmed: true }) }))) throw new Error('its claim wasn’t found');
      } catch (e) {
        console.error('[advisory-mail] a welcome went but wasn’t marked (the heartbeat marks it)', slug || a.slug, e?.message || e);
        unmarked.push(slug || a.slug);
      }
    } else {
      failed += 1;
      // (put back as it was, so the next try sends it; one that doesn't save, or whose claim isn't found, is a claim that
      // lapses in ten minutes, and never stops the rest of these going)
      if (slug) {
        await markClaim(env.DB, a, now, to, sentAt(a.was) ? a.was : null)
          .catch((e) => console.error('[advisory-mail] a welcome that didn’t go wasn’t put back (it can go again in ten minutes)', slug, e?.message || e));
      }
    }
  }
  // (the log of what went is for staff to read: one that doesn't save never makes the welcomes read as not sent)
  await remember(env.DB, { kind: 'welcome', by, sent, failed, ...(unsure ? { unsure } : {}), ...(who ? { who } : {}) }, now)
    .catch((e) => console.error('[advisory-mail] welcome log', e?.message || e));
  return { sent, failed, ...(unsure ? { unsure } : {}), ...(unmarked.length ? { unmarked } : {}) };
}

/** Whether they've ever signed in to their page (Board's activity keeps each sign-in) */
async function signedInEver(DB, slug) {
  try { return !!(await DB.prepare('SELECT 1 AS x FROM board_signins WHERE slug = ? LIMIT 1').bind(slug).first()); } catch { return false; }
}

/**
 * One member's sign-in email, sent by a person from their row on Members, with the Advisory Board's emails on or off
 * (Peter, Nov 18 2026). As Board's: never to someone who has signed in already, and never twice within AGAIN_MS
 * ("Send it again" after that). It goes only once the sign-in knows their address, so its link works when it lands:
 * the list is brought up to date first if it doesn't yet.
 * → { sent: 1, again, at, unsure? } | { failed: 1 } | { gone } | { noEmail, why: 'none' | 'bad' | 'group' | 'staff' } | { signedIn }
 *   | { going } | { tooSoon, at } | { notReady, why: 'sign-in' (Cloudflare, minutes) | 'setup' (Board → Members says what's left) }
 */
export async function sendWelcomeTo(env, slug, { by = '', now = Date.now(), fetchImpl = fetch } = {}) {
  const me = (await activeAdvisors(env.DB)).find((a) => a.slug === slug);
  if (!me) return { gone: true };
  if (!me.email) return { noEmail: true, why: 'none' };
  const why = signInWhy(me.email);
  if (why) return { noEmail: true, why };
  if (await signedInEver(env.DB, slug)) return { signedIn: true };
  const log = await readState(env.DB, LOG);
  const state = welcomeOf(log.welcomed?.[slug], me.email, now);
  if (state.going) return { going: true };
  if (state.at && Date.parse(state.at) > now - AGAIN_MS) return { tooSoon: true, at: state.at };
  if (!(await canSignIn(env, me.email))) await syncBoardAccess(env, { fetchImpl, now }).catch(() => null);
  if (!(await canSignIn(env, me.email))) {
    const a = await accessStatus(env).catch(() => null);
    return { notReady: true, why: a && (!a.configured || a.attached === false) ? 'setup' : 'sign-in' };
  }
  const greet = log.waiting?.[slug]?.greet;
  const decided = typeof greet === 'string';
  const r = await sendWelcome(env, { by, slugs: [slug], now, anyway: true, again: true, who: me.name, greet: decided ? { [slug]: greet } : {} });
  // (had it now: one waiting for the switch or the sign-in isn't sent again)
  // (it went, whatever doesn't save after it: a mark that didn't save is left waiting for the heartbeat to write)
  if (r.sent) {
    await (r.unmarked?.includes(slug) ? setEntry(env.DB, 'waiting', slug, { at: new Date(now).toISOString(), by, ...(decided ? { greet } : {}) }) : removeEntry(env.DB, 'waiting', slug))
      .catch((e) => console.error('[advisory-mail] welcome went; waiting not updated', e?.message));
    return { sent: 1, again: !!state.at, at: new Date(now).toISOString(), ...(r.unsure ? { unsure: true } : {}) };
  }
  if (r.failed) return { failed: 1 };
  // Not claimed: another send took it meanwhile (another tab, Add, the heartbeat)
  const after = welcomeOf((await readState(env.DB, LOG)).welcomed?.[slug], me.email, now);
  return after.going ? { going: true } : after.at ? { tooSoon: true, at: after.at } : { failed: 1 };
}
