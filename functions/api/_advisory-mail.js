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
import { ensureAdvisory, getSettings, INTRO_STATUSES, HOSTED_STATUSES, LINKS_TABLE } from './_advisory.js';
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
/**
 * One member's sign-in email as their row on Members shows it: { at } when they had it at the address they have now,
 * { going: true } while one is on its way (a press, Add or the heartbeat), else {}
 */
export const welcomeOf = (v, email, now = Date.now()) => (v?.sending && Date.parse(v.sending) > now - SENDING_STALE_MS ? { going: true }
  : hadIt(v, email) ? { at: sentAt(v), ...(v?.unconfirmed ? { unconfirmed: true } : {}) } : {});

const para = (text) => shell.paragraphs(text);

// ─── To whoever runs the group ──────────────────────────────────────

/** What came in, for the person running the group. Never throws */
export async function noticeLead(env, { kind, who, intro, hosted, note, term }) {
  try {
    const settings = await getSettings(env.DB);
    const lead = await leadOf(env, settings);
    const name = who?.name || 'An Advisory Board member';
    const words = {
      intro: { subject: `${firstOf(name)} made an introduction`, line: `${name} introduced ${intro?.name || 'someone'}${intro?.company ? ` at ${intro.company}` : ''}.` },
      host: { subject: `${firstOf(name)} wants to host a fundraiser`, line: `${name} asked to host: ${hosted?.title || ''}. It needs a yes or a not now.` },
      answer: { subject: `${firstOf(name)} can help with this month’s ask`, line: `${name} said yes to this month’s ask.${note ? ` They wrote: “${note}”` : ''}` },
      renew: { subject: `${firstOf(name)} renewed`, line: `${name} renewed for another year, through ${longDay(term?.ends) || 'next year'}.` },
    }[kind];
    if (!words) return;
    const html = shell.emailShell({
      preheader: words.line, eyebrow: 'Advisory Board', heading: words.subject, bodyHtml: para(words.line) + shell.button('Open Run it', RUN, 'primary', { big: true }),
    });
    const r = await sendEmails(env, { to: [lead.email], from: FROM, subject: words.subject, html, text: `${words.line}\n\n${RUN}`, tags: tag('advisory-lead') });
    await remember(env.DB, { kind: `notice-${kind}`, to: 'lead', sent: r.sent, error: r.errors?.[0] || null });
  } catch (e) { console.error('[advisory-mail] notice', e.message); }
}

/** The group reached its goal: what to do next, for whoever runs it and the admins */
export async function noticeGoal(env, settings, { raised }) {
  const lead = await leadOf(env, settings);
  const admins = await boardAdmins(env.DB);
  const to = [...new Set([lead.email, ...admins])];
  const subject = 'The Advisory Board reached its goal';
  const line = settings.kid
    ? 'The group has raised its goal. Next, move their makeover’s job forward in JobTread, because the site never changes a job’s status.'
    : 'The group has raised its goal. Next, pick the kid the group will sponsor on Members, then move that job forward in JobTread.';
  const html = shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading: subject, bodyHtml: para(line) + shell.button('Open Members', RUN, 'primary', { big: true }) });
  await sendEmails(env, { to, from: FROM, subject, html, text: `${line}\n\n${RUN}`, tags: tag('advisory-lead') });
  await remember(env.DB, { kind: 'goal', to: 'lead and admins', raised });
}

/** Once a week at most, when something has been waiting a week, or no ask has gone out in a month. Never throws */
export async function maybeNudgeLead(env, { now = Date.now() } = {}) {
  try {
    await ensureAdvisory(env.DB);
    const log = await readState(env.DB, LOG);
    if (log.nudgedAt && now - Date.parse(log.nudgedAt) < NUDGE_EVERY_MS) return null;
    const week = new Date(now - NUDGE_EVERY_MS).toISOString();
    const month = new Date(now - 30 * 86_400_000).toISOString();
    const intros = (await env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_intros WHERE status = 'thanks' AND at < ?").bind(week).first())?.n || 0;
    const hosted = (await env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_hosted WHERE status = 'new' AND at < ?").bind(week).first())?.n || 0;
    const advisors = (await activeAdvisors(env.DB)).length;
    const lastAsk = (await env.DB.prepare('SELECT MAX(sent_at) AS at FROM advisory_asks').first())?.at;
    const noAsk = advisors > 0 && (await getSettings(env.DB)).emails && (!lastAsk || lastAsk < month);
    if (!intros && !hosted && !noAsk) return null;
    const settings = await getSettings(env.DB);
    const lead = await leadOf(env, settings);
    const lines = [
      intros ? `${intros} ${intros === 1 ? 'introduction is' : 'introductions are'} waiting for an answer.` : '',
      hosted ? `${hosted} ${hosted === 1 ? 'fundraiser request is' : 'fundraiser requests are'} waiting for a yes or a not now.` : '',
      noAsk ? 'It’s been a month since the last ask went out.' : '',
    ].filter(Boolean);
    const subject = 'The Advisory Board has things waiting';
    const html = shell.emailShell({ preheader: lines[0], eyebrow: 'Advisory Board', heading: subject, bodyHtml: para(lines.join('\n\n')) + shell.button('Open Run it', RUN, 'primary', { big: true }) });
    await sendEmails(env, { to: [lead.email], from: FROM, subject, html, text: `${lines.join('\n')}\n\n${RUN}`, tags: tag('advisory-lead') });
    await setTop(env.DB, 'nudgedAt', new Date(now).toISOString());
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
  for (let i = 0; i < 5; i++) {
    const link = await linkState(DB, token, { now });
    if (link.why) throw linkRefused(link.why);
    const r = await DB.prepare(`INSERT OR REPLACE INTO advisory_answers (ask_id, slug, answer, note, at, via)
        SELECT l.ask_id, l.slug, ?, ?, ?, 'email' FROM advisory_links l JOIN team t ON t.slug = l.slug
        WHERE l.hash = ? AND l.expires > ? AND t.data = ? AND NOT ${movingAt('l.slug')}
          AND EXISTS (SELECT 1 FROM advisory_asks a WHERE a.id = l.ask_id AND a.sent_at IS NOT NULL AND a.closed_at IS NULL)`)
      .bind(answer, text, new Date(now).toISOString(), link.hash, new Date(now).toISOString(), link.data).run();
    if (Number(r?.meta?.changes) > 0) return { askId: link.askId, slug: link.slug, name: link.person.name, answer, note: text };
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

export async function sendAsk(env, ask, { now = Date.now() } = {}) {
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { off: true };
  const log = await mailLog(env.DB);
  if (log.some((l) => l.kind === 'ask' && l.id === ask.id && l.sent > 0)) return { already: true };
  const advisors = (await activeAdvisors(env.DB)).filter((a) => isEmail(a.email));
  let preferred = await preferredNames(env.DB);
  const items = [];
  // (anyone no link could be written for, said in the log: never a link at an address nobody has by then)
  const skipped = [];
  for (const a of advisors) {
    const link = await linkFor(env.DB, ask.id, a, now);
    if (!link.t) { skipped.push({ name: a.name, why: link.why }); continue; }
    // (renamed on People as it went: the name kept for their emails moved with them)
    if (link.slug !== a.slug) preferred = await preferredNames(env.DB);
    const at = (d) => `${SITE_ORIGIN}/api/advisory-action?t=${encodeURIComponent(link.t)}&do=${d}`;
    items.push({ to: a.email, ...askEmail(ask, greetingOf({ ...a, ...link.person, slug: link.slug }, preferred), { yes: at('yes'), no: at('no') }) });
  }
  const r = items.length ? await sendEmailItems(env, items, { from: FROM, replyTo: await replyTo(env, settings), tags: tag('advisory-ask') }) : { sent: 0, failed: 0 };
  const why = { left: 'not on the Advisory Board by then', moving: 'a change of their web address is waiting to be settled on People', busy: 'their People record kept changing' };
  const notSent = skipped.length ? ` Not sent to ${skipped.map((x) => `${x.name} (${why[x.why] || 'not sent'})`).join(', ')}.` : '';
  await remember(env.DB, {
    kind: r.sent ? 'ask' : 'ask-failed', id: ask.id, title: ask.title, sent: r.sent, failed: r.failed,
    ...(skipped.length ? { skipped: skipped.map((x) => ({ name: x.name, why: x.why })) } : {}),
    ...(r.sent ? (notSent ? { what: `This month’s ask: ${ask.title}.${notSent}` } : {}) : { what: `This month’s ask didn’t send: ${ask.title}.${notSent}` }),
  }, now);
  return { sent: r.sent, failed: r.failed, ...(skipped.length ? { skipped: skipped.length } : {}) };
}

async function toOne(env, slug, { subject, heading, line, kind }) {
  const settings = await getSettings(env.DB);
  if (!settings.emails) return { off: true };
  const a = (await activeAdvisors(env.DB)).find((x) => x.slug === slug);
  if (!a || !isEmail(a.email)) return { sent: 0 };
  const html = shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading, bodyHtml: para(line) + shell.button('Open your page', PAGE, 'primary', { big: true }) });
  const r = await sendEmails(env, { to: [a.email], from: FROM, subject, html, text: `${line}\n\n${PAGE}`, replyTo: await replyTo(env, settings), tags: tag(kind) });
  await remember(env.DB, { kind, sent: r.sent });
  return { sent: r.sent };
}
export function sendIntroUpdate(env, intro) {
  const label = INTRO_STATUSES.find((s) => s.id === intro.status);
  return toOne(env, intro.slug, { kind: 'advisory-update', subject: `An update on ${intro.name}`, heading: `${intro.name}: ${label?.label || intro.status}`, line: `An update on your introduction: ${label?.sub || label?.label || ''}.${intro.note ? `\n\n${intro.note}` : ''}` });
}
export function sendHostUpdate(env, hosted) {
  const label = HOSTED_STATUSES.find((s) => s.id === hosted.status);
  return toOne(env, hosted.slug, { kind: 'advisory-update', subject: `Your fundraiser: ${hosted.title}`, heading: `${hosted.title}: ${label?.label || hosted.status}`, line: hosted.note || `Your request to host is now marked ${String(label?.label || hosted.status).toLowerCase()}.` });
}
export const sendGiftNote = (env, slug, n) => toOne(env, slug, { kind: 'advisory-update', subject: 'A gift came through your page', heading: 'A gift came through your page', line: `${n === 1 ? 'Someone' : `${n} people`} gave through your page. Thank you for sharing it.` });

/** The group reached the goal: a thank-you to everyone, with no kid named */
export async function sendGoalNote(env, settings) {
  if (!settings.emails) return { off: true };
  const advisors = (await activeAdvisors(env.DB)).filter((a) => isEmail(a.email));
  const line = 'You did it. Together you have raised enough to fund a makeover. There’s more to come at the next meeting.';
  const html = shell.emailShell({ preheader: line, eyebrow: 'Advisory Board', heading: 'You reached the goal', bodyHtml: para(line) + shell.button('Open your page', PAGE, 'primary', { big: true }) });
  const r = await sendEmails(env, { to: advisors.map((a) => a.email), from: FROM, subject: 'You reached the goal', html, text: `${line}\n\n${PAGE}`, replyTo: await replyTo(env, settings), tags: tag('advisory-update') });
  await remember(env.DB, { kind: 'goal-note', sent: r.sent });
  return r;
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
