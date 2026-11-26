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
import { activeAdvisors, peopleRows, privateEmails, readState, boardAdmins, signInWhy, moveStateEntry, readDown, PEOPLE_DOWN, PEOPLE_DOWN_SENT } from './_board-roles.js';
import { ensureAdvisory, getSettings, INTRO_STATUSES, HOSTED_STATUSES, LINKS_TABLE, askOut, oweStatement, unoweStatement, setIntroStatus, setHosted, ASK_NOT_OUT, CHANGE_DOWN } from './_advisory.js';
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
/**
 * Why an address isn't a member's own for the Advisory Board's emails, from the one rule their sign-in has (signInWhy):
 * 'none' (no email on file), 'group' (a SOARD group inbox: everyone in the group reads it, so one member's personal
 * answer link there is everyone's), 'staff' (a SOARD address, which signs in as staff), 'bad' (not a whole address), or
 * '' when it's theirs. ownAddress: a member's own address, '' when they have none. Every email to a member goes only to
 * it: the welcome, the monthly ask with its yes/no link, updates, and gift and goal notes (Advisory Board QA round 26:
 * the ask, with Hal's personal link, went to advisory@, which the whole group reads), and staff's words come from it too
 */
export const addressWhy = (email) => (email ? signInWhy(email) : 'none');
export const ownAddress = (a) => (a?.email && !addressWhy(a.email) ? plain(a.email) : '');
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
/**
 * An entry written over what's there in one statement: `base` only where it has nothing (an owed welcome's key, when
 * one of its tries may have reached Resend, and the rest it was written down with are never written over: Advisory
 * Board QA round 27), `force` over it
 */
async function mergeEntry(DB, group, key, base, force = {}) {
  await logRow(DB);
  const path = pathOf(group, key);
  await DB.prepare(`UPDATE board_state SET data = json_set(${withGroup(group)}, ?, json_patch(json_patch(json(?), CASE WHEN json_type(data, ?) = 'object' THEN json_extract(data, ?) ELSE '{}' END), json(?))), updated_at = ? WHERE key = ?`)
    .bind(path, JSON.stringify(base), path, path, JSON.stringify(force), new Date().toISOString(), LOG).run();
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
 * by both (markClaim), never by the moment alone (Advisory Board QA round 19)
 */
// (claimed only while they're at this address with this email and no rename is moving records off it, as it's
// written: a claim read for an address before a rename is never left at it after: Advisory Board QA round 21)
const STILL_HERE = `AND EXISTS (SELECT 1 FROM reveal_board_emails WHERE slug = ? AND lower(trim(email)) = ?) AND NOT ${movingOff('?')}`;
/*
 * The claim and the email being owed are one write (Advisory Board QA round 26: a press claimed a welcome, a read after
 * the claim failed, staff were told nothing was sent, and the claim, never written down as owed, left the row saying
 * "going out now" with nothing ever going). `owed`: the waiting entry written in that same statement ({ at, by, key,
 * greet?, hand?, after? }: its key at Resend kept), so a request that dies anywhere after it leaves the welcome owed,
 * and the heartbeat sends it once with that key (sendWaitingWelcomes). A claim whose write landed with its answer lost is
 * looked at: ours there, it's claimed and carried on; not there, nothing was claimed (503, WELCOME_NOT_SENT); the look
 * failing too, it can't be told (503, WELCOME_UNSURE)
 */
const WELCOME_NOT_SENT = 'The site’s database didn’t answer just now, so nothing was sent. Please try again in a moment.';
const WELCOME_UNSURE = 'The site’s database didn’t answer just now, so we can’t tell yet whether the sign-in email is on its way. If it is, it goes by itself in a few minutes. This page shows where it stands.';
/** A read or write before anything was claimed that failed: said as nothing sent (503), in words */
const notSent = (e) => (e?.status ? e : e?.unread && e.message === PEOPLE_DOWN ? readDown(PEOPLE_DOWN_SENT, e.cause || e) : e?.unread ? e : readDown(WELCOME_NOT_SENT, e));
async function claimWelcome(DB, slug, now, email, { again = false, owed = null, via = '' } = {}) {
  await logRow(DB);
  const path = pathOf('welcomed', slug);
  const stale = new Date(now - SENDING_STALE_MS).toISOString();
  const sending = new Date(now).toISOString();
  const here = [slug, plain(email), slug];
  // (the waiting entry, written with the claim: the group made first, as the claim's is)
  const wait = owed ? ', ?, json(?)' : '';
  const waitBind = owed ? [pathOf('waiting', slug), JSON.stringify(owed)] : [];
  const tried = async (stmt) => {
    try { return Number((await stmt.run())?.meta?.changes) > 0; } catch (e) {
      console.error('[advisory-mail] a welcome’s claim: its answer lost, or it never ran (looked at)', e?.message || e);
      let v;
      try { v = (await readState(DB, LOG)).welcomed?.[slug]; } catch (e2) { throw Object.assign(readDown(WELCOME_UNSURE, e2), { unsure: true }); }
      if (v && typeof v === 'object' && v.sending === sending && plain(v.sendingTo) === plain(email)) return true;
      throw readDown(WELCOME_NOT_SENT, e);
    }
  };
  const groups = owed ? `json_set(${withGroup('welcomed')}, '${pathOf('waiting')}', json(ifnull(json_extract(${withGroup('welcomed')}, '${pathOf('waiting')}'), '{}')))` : withGroup('welcomed');
  const claimed = await tried(DB.prepare(`UPDATE board_state SET data = json_set(${groups}, ?, json(?)${wait}), updated_at = ? WHERE key = ?
    AND (json_extract(data, ?) IS NULL OR (json_type(data, ?) = 'object' AND (
      (json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) < ? AND json_extract(data, ?) IS NULL)
      OR (json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != ?
        AND (json_extract(data, ?) IS NULL OR json_extract(data, ?) < ?))))) ${STILL_HERE}`)
    .bind(path, JSON.stringify({ sending, sendingTo: plain(email), ...(via ? { via } : {}) }), ...waitBind, new Date().toISOString(), LOG, path, path,
      `${path}.sending`, `${path}.sending`, stale, `${path}.at`,
      `${path}.at`, `${path}.to`, `${path}.to`, plain(email),
      `${path}.sending`, `${path}.sending`, stale, ...here));
  if (claimed) return true;
  if (!again) return false;
  // Had it here, long enough ago, and none on its way: claimed with when it went kept
  const before = new Date(now - AGAIN_MS).toISOString();
  const groups2 = owed ? `json_set(data, '${pathOf('waiting')}', json(ifnull(json_extract(data, '${pathOf('waiting')}'), '{}')))` : 'data';
  return tried(DB.prepare(`UPDATE board_state SET data = json_set(${groups2}, ?, json_object(
      'at', CASE json_type(data, ?) WHEN 'text' THEN json_extract(data, ?) ELSE json_extract(data, ?) END,
      'to', CASE json_type(data, ?) WHEN 'text' THEN NULL ELSE json_extract(data, ?) END,
      'sending', ?, 'sendingTo', ?)${wait}), updated_at = ? WHERE key = ? AND json_valid(data) AND (
    (json_type(data, ?) = 'text' AND json_extract(data, ?) < ?)
    OR (json_type(data, ?) = 'object' AND json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) < ?
      AND (json_extract(data, ?) IS NULL OR json_extract(data, ?) = ?)
      AND (json_extract(data, ?) IS NULL OR json_extract(data, ?) < ?))) ${STILL_HERE}`)
    .bind(path, path, path, `${path}.at`, path, `${path}.to`, sending, plain(email), ...waitBind, new Date().toISOString(), LOG,
      path, path, before,
      path, `${path}.at`, `${path}.at`, before,
      `${path}.to`, `${path}.to`, plain(email),
      `${path}.sending`, `${path}.sending`, stale, ...here));
}
/** When their welcome went (a had-it record), else '' */
const sentAt = (v) => (typeof v === 'string' ? v : v?.at || '');
/**
 * What one send came to: the one rule for every Advisory Board email, the welcome and the owed emails alike (Advisory
 * Board QA rounds 26 and 27: the ask and the update emails counted Resend's own no as owed and tried it again for ten
 * hours, saying "goes in a few minutes", while the welcome called it a refusal; and a gateway's 502 was taken as "may
 * have gone" for good)
 *   'went'     Resend's yes, or its 409 for a key it already has (it went before)
 *   'lost'     no answer at all (it timed out, the connection dropped): Resend may have taken it. Asked again only under
 *              the same key, while Resend still keeps it (KEY_DAY_MS); past that it's never sent again by itself
 *   'owed'     Resend's 5xx or 429 (a gateway's in front of it included): it didn't reach Resend. It stays owed, past a
 *              day too, and goes once when it can
 *   'refused'  Resend's own 4xx (not 429), or email not set up: nothing went, said as a refusal, never tried again
 * (setup: the refusal is email not being set up on the site)
 */
const resendStatus = (e) => Number(/^Resend (\d+):/.exec(String(e))?.[1]) || 0;
const unset = (e) => /RESEND_API_KEY not set/.test(String(e));
export function sendOutcome(r) {
  if (r.sent > 0 || r.already > 0) return 'went';
  const errors = (r.errors || []).map(String);
  if (errors.some((e) => !resendStatus(e) && !unset(e))) return 'lost';
  if (errors.some((e) => resendStatus(e) >= 500 || resendStatus(e) === 429)) return 'owed';
  return 'refused';
}
const notSetUp = (r) => (r.errors || []).some(unset);
const KEY_DAY_MS = 23 * 60 * 60 * 1000; // Resend keeps an idempotency key a day: one asked again later could make a second
/** A key of its own for an email sent again once its old key is past its day, or on purpose (Send it again) */
const freshKey = (key, now) => `${String(key).replace(/:re\d+$/, '')}:re${now}`;

/** A welcome's key at Resend: the address it goes to, and, for one sent on purpose again, when the one before it went */
const welcomeKey = (to, was, again) => `advisory-welcome:${to}${again && hadIt(was, to) && sentAt(was) ? `:after:${sentAt(was)}` : ''}`;
/**
 * When a welcome owed under its key may first have reached Resend with no answer known, or '': its answer lost (`lost`,
 * written on its waiting entry), or a claim of it at this address left on its way past its window by a request that
 * ended mid-send (Advisory Board QA round 27: one lost and not asked again within the day Resend keeps a key went twice)
 */
const lostOf = (w, v, email, now) => w?.lost || (v && typeof v === 'object' && v.sending && Date.parse(v.sending) <= now - SENDING_STALE_MS
  && (!v.sendingTo || !email || plain(v.sendingTo) === plain(email)) ? v.sending : '');
/**
 * Where a welcome owed stands for its key: 'unsure' (it may have gone, and Resend no longer keeps its key: never sent
 * again by itself; their row says so, and a press sends it again with a new key), 'stale' (none of its tries reached
 * Resend, and its key is past its day: it goes with a new key), else 'ok'
 */
const welcomeKeyState = (w, v, email, now) => {
  const lost = lostOf(w, v, email, now);
  if (lost) return Date.parse(lost) < now - KEY_DAY_MS ? 'unsure' : 'ok';
  return w?.tried && Date.parse(w.tried) < now - KEY_DAY_MS ? 'stale' : 'ok';
};

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
  // (one already owed keeps its key and what its tries came to)
  await mergeEntry(DB, 'waiting', slug, { at: new Date(now).toISOString(), by }, decided ? { greet } : {});
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
 * { going: true } while one is on its way (a press, Add or the heartbeat), { unsure: true } when one may not have gone
 * and never goes by itself (Advisory Board QA round 27: their row says so, and Send it again sends it with a new key),
 * else {}
 */
export const welcomeOf = (v, email, now = Date.now(), w = null, emailsOn = true) => {
  if (v?.sending && Date.parse(v.sending) > now - SENDING_STALE_MS) return { going: true };
  const had = hadIt(v, email) ? { at: sentAt(v), ...(v?.unconfirmed ? { unconfirmed: true } : {}) } : null;
  // owed: a send that started and didn't finish (written down with its key, or a claim left past its window), which the
  // heartbeat sends in a few minutes (Advisory Board QA round 26): never "going out now", and never "had" when it wasn't
  const started = (w?.key ? !had || (!!w.after && had.at === w.after) : !!v?.sending && !had) && !!ownAddress({ email });
  if (started && welcomeKeyState(w, v, email, now) === 'unsure') return { ...(had || {}), unsure: true };
  const owed = started && (w?.key ? w.hand || emailsOn : emailsOn);
  return { ...(had || {}), ...(owed ? { owed: true } : {}) };
};

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
 * The notice to whoever runs the group for a member's answer to an ask (Advisory Board QA round 26: the same yes pressed
 * twice sent two "can help" emails, keyed by the moment of each press). One row per ask and member
 * ('notice:answer:<ask>:<slug>'), and its key at Resend comes from the ask, the member and the answer (yes or no, with
 * its note), numbered by each change, never the moment of the press: the same answer again changes nothing and sends
 * nothing; a changed answer puts one notice saying where it stands now in place of the last, owed (only the newest goes).
 * A first answer of no owes nothing, and a no in place of a yes not yet sent takes it back. → { key, statements(DB,
 * { now, guard, binds }) } for the answer's own write, each guarded by `guard` so it lands only with the answer
 */
const fnv = (t) => { let h = 0x811c9dc5; for (const c of String(t)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
export function answerNotice({ askId, slug, name, answer, note = '' }) {
  const who = name || 'An Advisory Board member';
  const key = `notice:answer:${askId}:${slug}`;
  const said = `${answer}\n${note}`;
  const wrote = note ? ` They wrote: “${note}”` : '';
  const firstMsg = { ...leadNotice('answer', { name, note, ref: `${askId}:${slug}` }).msg, said };
  const changedMsg = { subject: `${firstOf(who)} changed their answer to this month’s ask`, line: `${who} changed their answer to this month’s ask. Where it stands now: ${answer === 'yes' ? 'they can help' : 'not this time'}.${wrote}`, said };
  const base = `advisory-notice:answer:${askId}:${slug}:${fnv(said)}`;
  const statements = (DB, { now = Date.now(), guard = '1', binds = [] } = {}) => [
    // (a no in place of a yes that hasn't gone: taken back, so they're never told "can help" of a no)
    // (never one a try of which may have reached Resend: lost_at, Advisory Board QA round 27)
    ...(answer === 'yes' ? [] : [DB.prepare(`DELETE FROM advisory_outbox WHERE key = ? AND sent_at IS NULL AND lost_at IS NULL AND ${guard}`).bind(key, ...binds)]),
    DB.prepare(`INSERT INTO advisory_outbox (key, kind, ref, email, msg, idem, owed_at) SELECT ?, 'notice', ?, '', ?, ?, ? WHERE ${guard} AND (? OR EXISTS (SELECT 1 FROM advisory_outbox o WHERE o.key = ?))
      ON CONFLICT(key) DO UPDATE SET msg = json_set(?, '$.n', COALESCE(json_extract(advisory_outbox.msg, '$.n'), 0) + 1),
        idem = ? || ':' || (COALESCE(json_extract(advisory_outbox.msg, '$.n'), 0) + 1), owed_at = excluded.owed_at, tried_at = NULL, sent_at = NULL, tries = 0, outcome = NULL, lost_at = NULL
      WHERE json_extract(advisory_outbox.msg, '$.said') IS NOT json_extract(excluded.msg, '$.said')`)
      .bind(key, `${askId}:${slug}`, JSON.stringify(firstMsg), base, new Date(now).toISOString(), ...binds, answer === 'yes' ? 1 : 0, key, JSON.stringify(changedMsg), base),
  ];
  return { key, statements };
}

/**
 * A notice to whoever runs the group that a member's write owed (leadNotice), sent now if it's still owed: under its key,
 * marked with its send (sendOwed). One that doesn't go now the heartbeat sends, once. Never throws
 */
export async function sendNotice(env, key, { now = Date.now() } = {}) {
  try {
    // (found by its key at Resend too, which a rename never changes: renamed on People just after it was owed, the notice
    // moved with them to a key at their new address (./_advisory.js ADVISORY_PLACES), and still goes now)
    const idem = `advisory-${key}`;
    const rows = ((await twice(() => env.DB.prepare('SELECT * FROM advisory_outbox WHERE (key = ?1 OR idem = ?2 OR substr(idem, 1, length(?2) + 1) = ?2 || \':\') AND sent_at IS NULL AND outcome IS NULL').bind(key, idem).all()))?.results || []).map(rowOf);
    if (!rows.length) return { sent: 0 };
    const r = await sendOwed(env, rows, { now, make: async (x) => ({ item: { ...noticeItem(x), to: x.email || (await leadOf(env, await getSettings(env.DB))).email }, replyTo: '' }) });
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
    // (whoever runs the group told, owed in this same write, naming the person this write is guarded on: Advisory Board
    // QA round 25; keyed by the ask, the member and the answer, so the same answer again sends nothing: round 26)
    const owed = answerNotice({ askId: link.askId, slug: link.slug, name: link.person.name, answer, note: text });
    let r;
    try {
      r = (await DB.batch([stmt, ...owed.statements(DB, { now, guard: "EXISTS (SELECT 1 FROM advisory_answers a WHERE a.ask_id = ? AND a.at = ? AND a.via = 'email' AND a.answer = ? AND a.slug = (SELECT l.slug FROM advisory_links l WHERE l.hash = ?))", binds: [link.askId, at, answer, link.hash] })]))[0];
    } catch (e) {
      // (its answer lost, or it never ran: looked for, by what this write alone wrote. There, it's answered as taken)
      const had = await DB.prepare("SELECT 1 AS x FROM advisory_answers WHERE ask_id = ? AND at = ? AND via = 'email' AND answer = ? AND slug = (SELECT slug FROM advisory_links WHERE hash = ?)")
        .bind(link.askId, at, answer, link.hash).first().catch(() => null);
      if (!had) throw e;
      r = { meta: { changes: 1 } };
    }
    if (Number(r?.meta?.changes) > 0) return { askId: link.askId, slug: link.slug, name: link.person.name, answer, note: text, notice: owed.key };
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
const OWED_BUSY_MS = 2 * 60 * 1000; // a row a press has claimed this minute: the heartbeat leaves it to that press
// (Resend's 5xx or 429: tried again, each time a little later, the n-th try no sooner than n² minutes after it was owed,
// for as long as it takes: an outage of the email service never loses one. Resend's own no is never tried again)
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
 * for this send, sent under its own key, and marked with its send. Each step is tried twice; one that still fails leaves
 * the email owed, for the heartbeat, and never sends anything twice. How long an owed email may wait is one rule, the
 * welcome's too (sendOutcome; Advisory Board QA round 27): a try whose answer was lost may have reached Resend, so it's
 * asked again only under the same key while Resend keeps it (KEY_DAY_MS), and past that it's never sent again by itself
 * ('unsure': staff see it, and Send it again sends it with a new key, sendAgain); one that never reached Resend (its 5xx
 * or 429, or claimed and never tried) stays owed past a day and goes once when it can, with a new key once its old one
 * is past its day; Resend's own no, or email not set up, is a refusal, never tried again. An email Resend took whose mark
 * didn't save stays owed: the heartbeat asks Resend again under the same key, which sends nothing again, then marks it.
 * → { sent, owed, had, skipped: [{ name, why }], refused: [{ name, setup }], unsure: [{ name, key }] }
 */
async function sendOwed(env, rows, { now = Date.now(), make, replyTo = null }) {
  const DB = env.DB;
  const out = { sent: 0, owed: 0, had: 0, skipped: [], refused: [], unsure: [] };
  const at = isoOf(now);
  for (const row of rows) {
    let made;
    try { made = await twice(() => make(row)); } catch (e) { console.error('[advisory-mail] an owed email couldn’t be made (the heartbeat sends it)', row.key, e?.message || e); out.owed += 1; continue; }
    if (made.skip) {
      // (never went: said why, and never tried again)
      await twice(() => DB.prepare('UPDATE advisory_outbox SET outcome = ? WHERE idem = ? AND sent_at IS NULL AND outcome IS NULL').bind(`skipped:${made.skip}`, row.idem).run())
        .catch((e) => console.error('[advisory-mail] a skipped email not noted', row.key, e?.message || e));
      out.skipped.push({ name: made.name || '', why: made.skip });
      continue;
    }
    // The claim, as this try starts: marked as one that may reach Resend (lost_at, kept from an earlier try whose answer
    // was lost), and, when no try of it has reached Resend and its key is past its day, given a new key. Each email is
    // found by its key at Resend (idem), which a rename moving the row to its new address never changes
    let claim;
    try {
      claim = await twice(() => DB.prepare(`UPDATE advisory_outbox SET
          idem = CASE WHEN lost_at IS NULL AND tried_at < ?1 THEN ?2 ELSE idem END,
          tried_at = CASE WHEN lost_at IS NULL AND tried_at < ?1 THEN ?3 ELSE COALESCE(tried_at, ?3) END,
          lost_at = COALESCE(lost_at, ?3)
        WHERE idem = ?4 AND sent_at IS NULL AND outcome IS NULL RETURNING idem, tried_at, lost_at`)
        .bind(isoOf(now - KEY_DAY_MS), freshKey(row.idem, now), at, row.idem).first());
    } catch (e) { console.error('[advisory-mail] an owed email not claimed (the heartbeat sends it)', row.key, e?.message || e); out.owed += 1; continue; }
    // (had it already, or a newer one is owed in its place)
    if (!claim) { out.had += 1; continue; }
    const idem = claim.idem;
    const name = nameOfRow(row, made);
    if (claim.lost_at !== at && Date.parse(claim.lost_at) < now - KEY_DAY_MS) {
      // A try a day ago may have reached Resend, and it no longer keeps that key: asked again it could make a second.
      // Never sent again by itself: staff see it, and can send it again with a new key
      await twice(() => DB.prepare("UPDATE advisory_outbox SET outcome = 'unsure' WHERE idem = ? AND sent_at IS NULL AND outcome IS NULL").bind(idem).run())
        .catch((e) => console.error('[advisory-mail] an email that may have gone not noted (the heartbeat notes it)', row.key, e?.message || e));
      out.unsure.push({ name, full: row.msg?.name || made.name || name, key: row.key });
      continue;
    }
    const r = await sendEmailItems(env, [made.item], { from: FROM, replyTo: made.replyTo ?? replyTo, tags: tag(TAGS[row.kind] || 'advisory-update'), idempotencyKey: idem });
    const how = sendOutcome(r);
    if (how === 'went') {
      out.sent += 1;
      await twice(() => DB.prepare("UPDATE advisory_outbox SET sent_at = ?, outcome = 'sent' WHERE idem = ?").bind(at, idem).run())
        .catch((e) => console.error('[advisory-mail] an email went but wasn’t marked (the heartbeat marks it, sending nothing again)', row.key, e?.message || e));
    } else if (how === 'refused') {
      // Resend's own no, or email not set up: nothing went, and nothing sends it by itself. Said as a refusal
      out.refused.push({ name, full: row.msg?.name || made.name || name, setup: notSetUp(r) });
      await twice(() => DB.prepare("UPDATE advisory_outbox SET outcome = 'refused', lost_at = CASE WHEN lost_at = ? THEN NULL ELSE lost_at END WHERE idem = ? AND sent_at IS NULL AND outcome IS NULL").bind(at, idem).run())
        .catch((e) => console.error('[advisory-mail] a refused email not noted', row.key, e?.message || e));
    } else if (how === 'owed') {
      // (Resend's 5xx or 429: this try never reached it. Its mark of one that may have comes off, an earlier one stays)
      out.owed += 1;
      await twice(() => DB.prepare('UPDATE advisory_outbox SET lost_at = CASE WHEN lost_at = ? THEN NULL ELSE lost_at END, tries = tries + 1 WHERE idem = ? AND sent_at IS NULL').bind(at, idem).run())
        .catch((e) => console.error('[advisory-mail] an owed email’s try not noted', row.key, e?.message || e));
    } else {
      // (no answer: it may have gone. The heartbeat asks again under the same key, which sends it only if it didn't)
      out.owed += 1;
    }
  }
  return out;
}
/** Who an owed email is to, for staff's words: the member as the row names them, else whoever runs the group */
function nameOfRow(row, made = {}) {
  if (row.kind === 'notice') return 'whoever runs the group';
  return firstWord(row.msg?.name || row.msg?.first || made.name || '') || 'the Advisory Board member';
}
/** " The email service refused the email to Rex, so it didn't go. Check their email on People." ('' for none) */
export function refusedWords(list = []) {
  if (!list.length) return '';
  const names = andWords(list.map((x) => x.name));
  if (list.every((x) => x.setup)) return ` The site’s email isn’t set up, so the email to ${names} didn’t go.`;
  return list.length === 1 ? ` The email service refused the email to ${names}, so it didn’t go. Check their email on People.`
    : ` The email service refused the emails to ${names}, so they didn’t go. Check their emails on People.`;
}
const andWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** " The email to Rex may not have gone." (unsure: sendOwed's) */
const unsureWords = (list = []) => (list.length ? ` The email to ${andWords(list.map((x) => x.name))} may not have gone: ${list.length === 1 ? 'it’s' : 'they’re'} on Run it to send again.` : '');

/** Why a member's ask wasn't sent, as the mail log says it */
const SKIP_WORDS = { left: 'not on the Advisory Board by then', moving: 'a change of their web address is waiting to be settled on People', busy: 'their People record kept changing', closed: 'the ask had closed',
  // (no address of their own: ownAddress, Advisory Board QA round 26)
  none: 'no email of their own on file', group: 'their email on file is a SOARD group inbox', staff: 'their email on file is a SOARD staff address', bad: 'their email on file isn’t a whole address', address: 'their email on file isn’t their own',
  // (what happened to it: Advisory Board QA round 27)
  refused: 'the email service refused it', setup: 'the site’s email isn’t set up', unsure: 'it may not have gone' };
/** "Hal has no email of their own on file" (why: addressWhy) */
const whyNotWords = (name, why) => ({ group: `${name}’s email on file is a SOARD group inbox`, staff: `${name}’s email on file is a SOARD staff address`, bad: `${name}’s email on file isn’t a whole address` }[why] || `${name} has no email of their own on file`);

/**
 * One member's monthly ask, made as it goes: their link (written at the address they have now, linkFor) and their
 * greeting. `ask`: the ask's row ({ id, sent_at, closed_at, data }). → { item } | { skip, name }
 */
async function askItem(env, row, { ask, preferred, now }) {
  if (!ask || !ask.sent_at || ask.closed_at) return { skip: 'closed', name: row.msg?.name };
  // (owed before the rule was kept, to an address that isn't theirs: never their personal link to a shared inbox)
  if (addressWhy(row.email)) return { skip: 'address', name: row.msg?.name };
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

/**
 * What a press of the ask says happened, in plain words (`out`: put it out too, else Email it), from what happened to
 * each email: sent, owed (it goes in a few minutes), refused (Resend's own no, or email not set up: Advisory Board QA
 * round 27, said as a refusal with what staff can do, never "in a few minutes"), may not have gone, skipped
 */
export function askWords(r, { out = true } = {}) {
  if (r.off) return out ? 'It’s on the page. Emails are off, so nothing was sent.' : 'Nothing went out: emails are off.';
  if (r.already) return out ? 'It’s on the page. The Advisory Board already had this email.' : 'The Advisory Board already had this email.';
  const skipped = r.skipped?.length ? ` Not sent to ${r.skipped.map((x) => `${x.name || 'someone'} (${SKIP_WORDS[x.why] || 'not sent'})`).join(', ')}.` : '';
  const rest = `${refusedWords(r.refused)}${unsureWords(r.unsure)}${skipped}`;
  const more = !!(r.refused?.length || r.unsure?.length);
  if (!r.sent && !r.owed) {
    if (more) return `${out ? 'It’s on the page, but its email didn’t go.' : 'Nothing went out.'}${rest}`;
    return `${out ? 'It’s on the page, but' : 'Nothing went out:'} no Advisory Board member has an email the site can send it to.${skipped}`;
  }
  if (!r.owed) return `${out ? 'It’s out, and emailed to' : 'Emailed to'} ${many(r.sent)}.${rest}`;
  if (!r.sent) return `${out ? 'The ask is out. Its email goes to' : 'Its email goes to'} ${many(r.owed)} in a few minutes.${rest}`;
  return `${out ? 'The ask is out. ' : ''}It went to ${many(r.sent)}; ${more ? `${r.owed} more` : `the other ${r.owed}`} ${r.owed === 1 ? 'gets' : 'get'} it in a few minutes.${rest}`;
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
    // (only to a member's own address, the welcome's rule: never their personal yes/no link to a SOARD group inbox, which
    // the whole group reads, or a staff address. The card and its confirm say who it skips, and why, from the same rule:
    // Advisory Board QA round 26)
    members = had ? [] : (await activeAdvisors(DB)).filter((a) => ownAddress(a));
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
    const to = ownAddress(a);
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
  const result = { sent: r.sent, owed: r.owed, ...(r.skipped.length ? { skipped: r.skipped } : {}), ...(r.refused.length ? { refused: r.refused } : {}), ...(r.unsure.length ? { unsure: r.unsure } : {}) };
  // (the log staff read: one that doesn't save is never in the way of the answer)
  await noteAsk(DB, { id, title: w.ask.title }, result, now).catch((e) => console.error('[advisory-mail] the ask’s log', e?.message || e));
  return { ask: w.ask, sent: result, said: askWords(result, { out }) };
}
/**
 * The ask's line in the mail log, for staff to read ("What's gone out"): sent counts only what went or goes in a few
 * minutes, never one refused or that may not have gone (Advisory Board QA round 27), which are named
 */
async function noteAsk(DB, ask, r, now) {
  const not = [...(r.skipped || []).map((x) => ({ name: x.name, why: x.why })), ...(r.refused || []).map((x) => ({ name: x.full || x.name, why: x.setup ? 'setup' : 'refused' })), ...(r.unsure || []).map((x) => ({ name: x.full || x.name, why: 'unsure' }))];
  const notSent = not.length ? ` Not sent to ${not.map((x) => `${x.name} (${SKIP_WORDS[x.why] || 'not sent'})`).join(', ')}.` : '';
  const went = r.sent + r.owed;
  await remember(DB, {
    kind: went ? 'ask' : 'ask-failed', id: ask.id, title: ask.title, sent: went, ...(r.owed ? { owed: r.owed } : {}),
    ...(not.length ? { skipped: not } : {}),
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
  // (what's owed for it already: read before the write, as everything the email needs is. One that fails changes
  // nothing, and says so in words)
  let owedNow;
  try { owedNow = rowOf(await DB.prepare('SELECT * FROM advisory_outbox WHERE key = ? AND sent_at IS NULL AND outcome IS NULL').bind(key).first()); } catch (e) { throw readDown(CHANGE_DOWN, e); }
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
    // (only to their own address, the welcome's rule: Advisory Board QA round 26)
    if (!member || !ownAddress(member)) {
      none = true;
      return owedNow ? [unoweStatement(DB, key, { guard, binds })] : [];
    }
    const to = ownAddress(member);
    row = { key, kind: 'update', ref: id, email: to, msg: { ...(kind === 'intro' ? introWords(next) : hostWords(next)), first: firstWord(member.name) }, idem: `advisory-update:${kind}:${id}:${next.status}:${next.updatedAt}` };
    return [oweStatement(DB, row, { now, guard, binds, replace: true })];
  };
  const set = kind === 'intro' ? setIntroStatus : setHosted;
  const w = await set(DB, id, body, { by, now, mail });
  const record = kind === 'intro' ? w.intro : w.hosted;
  const going = row || (!w.changed && owedNow && settings.emails ? owedNow : null);
  if (!going) {
    const sent = none ? { sent: 0, owed: 0, none: true } : null;
    return { record, changed: w.changed, sent, said: none ? `${member ? whyNotWords(firstWord(member.name) || 'They', addressWhy(member.email)) : `${firstWord(member?.name || '') || 'They'} isn’t on the Advisory Board now`}, so no email went.` : '' };
  }
  const first = going.msg?.first || firstWord(member?.name || '') || 'The Advisory Board member';
  const r = await sendOwed(env, [going], { now, replyTo: reply, make: async (x) => (member && ownAddress(member) === x.email ? { item: memberItem(x) } : { skip: 'left', name: first }) });
  const sent = { sent: r.sent, owed: r.owed, first, ...(r.skipped.length ? { skipped: r.skipped } : {}), ...(r.refused.length ? { refused: r.refused.length } : {}), ...(r.unsure.length ? { unsure: r.unsure.length } : {}) };
  // (the log staff read: one that doesn't save is never in the way of the answer)
  if (r.sent) await remember(DB, { kind: 'advisory-update', sent: r.sent }, now).catch((e) => console.error('[advisory-mail] the log', e?.message || e));
  // (Resend's own no, or email not set up: a refusal in words, never "in a few minutes": Advisory Board QA round 27)
  return { record, changed: w.changed, sent, said: r.sent ? `${first} was emailed.` : r.owed ? `${first}’s email goes in a few minutes.`
    : r.refused.length ? refusedWords(r.refused.map((x) => ({ ...x, name: first }))).trim()
      : r.unsure.length ? unsureWords([{ name: first }]).trim()
        : r.skipped.length ? `${first} isn’t on the Advisory Board at that email now, so no email went.` : '' };
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
  // (one a person sent again by hand goes with the switch off too, as their press said: sendAgain)
  const due = rows.filter((r) => settings.emails || !TO_MEMBERS.has(r.kind) || r.msg?.hand);
  if (!due.length) return { sent: 0, owed: rows.length, off: true };
  const { make, lead } = await makerFor(env, due, { settings, now });
  const r = await sendOwed(env, due, { now, replyTo: lead.email, make });
  // (the log staff read: one that doesn't save is never in the way)
  if (r.sent) await remember(DB, { kind: due.every((x) => x.kind === 'ask') ? 'ask-owed' : 'advisory-update', sent: r.sent, what: `${r.sent === 1 ? 'An Advisory Board email that was waiting' : `${r.sent} Advisory Board emails that were waiting`} went out` }, now)
    .catch((e) => console.error('[advisory-mail] the log', e?.message || e));
  return { sent: r.sent, owed: r.owed + rows.length - due.length, ...(r.skipped.length ? { skipped: r.skipped.length } : {}), ...(r.refused.length ? { refused: r.refused.length } : {}), ...(r.unsure.length ? { unsure: r.unsure.length } : {}) };
}
/** How each owed email is made as it goes (`rows`: the ones going now), with what it needs read once */
async function makerFor(env, rows, { settings, now }) {
  const DB = env.DB;
  const onBoard = rows.some((r) => TO_MEMBERS.has(r.kind)) ? await activeAdvisors(DB) : [];
  const askIds = [...new Set(rows.filter((r) => r.kind === 'ask').map((r) => r.ref))];
  const asks = {};
  for (const askId of askIds) asks[askId] = await DB.prepare('SELECT id, sent_at, closed_at, data FROM advisory_asks WHERE id = ?').bind(askId).first();
  const preferred = askIds.length ? await preferredNames(DB) : {};
  const lead = await leadOf(env, settings);
  const make = async (row) => {
    if (row.kind === 'ask') return askItem(env, row, { ask: asks[row.ref], preferred, now });
    if (row.kind === 'notice') return { item: { ...noticeItem(row), to: row.email || lead.email }, replyTo: '' };
    // (to a member as they are now: still on the Advisory Board at that email)
    if (!onBoard.some((a) => ownAddress(a) === row.email)) return { skip: 'left', name: row.msg?.first || '' };
    return { item: memberItem(row) };
  };
  return { make, lead };
}

/**
 * Advisory Board emails that may not have gone (a try's answer was lost, and Resend no longer keeps its key: 'unsure'),
 * for staff to see on Run it with Send it again (Advisory Board QA round 27: nothing owed is ever lost silently).
 * → [{ key, kind, ref, name, at }]
 */
export async function unsureMail(DB) {
  await ensureAdvisory(DB);
  const rows = ((await DB.prepare("SELECT * FROM advisory_outbox WHERE outcome = 'unsure' AND sent_at IS NULL ORDER BY owed_at LIMIT 50").all()).results || []).map(rowOf);
  // (one to a member who has since left the Advisory Board, or whose email changed, is nobody's to send again)
  const on = rows.some((r) => TO_MEMBERS.has(r.kind)) ? new Set((await activeAdvisors(DB)).map((a) => ownAddress(a)).filter(Boolean)) : new Set();
  return rows.filter((r) => !TO_MEMBERS.has(r.kind) || on.has(r.email)).map((r) => ({ key: r.key, kind: r.kind, ref: r.ref, name: nameOfRow(r), at: r.lost_at || r.tried_at || r.owed_at }));
}
/**
 * Send it again: one email that may not have gone, sent now with a new key (its old one may have reached Resend and is
 * past its day, so only a new one goes for sure; a person's press, so it goes with the switch off too). The new key and
 * the email owed again are one write, before it goes; then it goes and is marked, as every owed email (sendOwed). →
 * { sent, owed, refused, skipped, gone } and `said`, in plain words
 */
export async function sendAgain(env, key, { now = Date.now() } = {}) {
  const DB = env.DB;
  await ensureAdvisory(DB);
  const was = rowOf(await DB.prepare("SELECT * FROM advisory_outbox WHERE key = ? AND outcome = 'unsure' AND sent_at IS NULL").bind(String(key || '')).first());
  if (!was) return { gone: true, said: 'That email isn’t waiting to be sent again any more. The page shows where it stands now.' };
  const settings = await getSettings(DB);
  const { make, lead } = await makerFor(env, [was], { settings, now });
  const idem = freshKey(was.idem, now);
  const row = await DB.prepare("UPDATE advisory_outbox SET idem = ?, outcome = NULL, tried_at = NULL, lost_at = NULL, tries = 0, msg = CASE WHEN json_valid(msg) THEN json_set(msg, '$.hand', json('true')) ELSE msg END WHERE key = ? AND idem = ? AND outcome = 'unsure' AND sent_at IS NULL RETURNING *")
    .bind(idem, was.key, was.idem).first();
  if (!row) return { gone: true, said: 'That email isn’t waiting to be sent again any more. The page shows where it stands now.' };
  const r = await sendOwed(env, [rowOf(row)], { now, replyTo: lead.email, make });
  const name = nameOfRow(was);
  const said = r.sent ? `Sent to ${name}.` : r.owed ? `The email to ${name} goes in a few minutes.` : r.refused.length ? refusedWords(r.refused).trim()
    : r.skipped.length ? `It didn’t go (${SKIP_WORDS[r.skipped[0].why] || 'it can’t go now'}).` : 'It’s on its way already.';
  if (r.sent) await remember(DB, { kind: was.kind === 'ask' ? 'ask-owed' : 'advisory-update', sent: r.sent, what: `An Advisory Board email that may not have gone, sent again to ${name}` }, now).catch(() => {});
  return { sent: r.sent, owed: r.owed, refused: r.refused.length, skipped: r.skipped.length, said };
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
    // (only to their own address, the welcome's rule: Advisory Board QA round 26)
    const to = ownAddress(a);
    if (!to) continue;
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
    for (const a of (await activeAdvisors(env.DB)).filter((x) => ownAddress(x))) {
      const to = ownAddress(a);
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
 * on. → { sent } | { waiting, why: 'sign-in' | 'setup' | 'send' | 'owed' | 'check' } | { off, queued } (the switch) | { already }
 *   | { noEmail } | { refused }
 *   why 'sign-in': Cloudflare hasn't taken the list yet (minutes); 'setup': the sign-in isn't set up all the way
 *   (the Access key, or the policy on the admin's sign-in); 'send': it couldn't be claimed just now (the heartbeat sends
 *   it); 'owed': the email service gave no answer that says either way (a 5xx, a dropped connection): it may have gone,
 *   and the heartbeat sends it under its own key, which never sends a second (Advisory Board QA round 26); 'check':
 *   People or their email couldn't be read just now (never taken for "no email": the heartbeat sends it). refused: the
 *   email service's own no, so nothing went and nothing sends it by itself
 */
export async function welcomeOnJoin(env, slug, { by = '', now = Date.now(), fetchImpl = fetch, greet = null } = {}) {
  const settings = await getSettings(env.DB);
  // (greet: as queueWelcome's, '' a decision too: no name)
  const decided = typeof greet === 'string';
  // (one already owed keeps its key and what its tries came to: never written over, Advisory Board QA round 27)
  const wait = () => mergeEntry(env.DB, 'waiting', slug, { at: new Date(now).toISOString(), by }, decided ? { greet } : {});
  // (People and their private emails read so a read that fails says so: never taken for "they have no email". It waits,
  // written down as waiting, and the heartbeat sends it once it can check: 'check')
  let me;
  try { me = (await activeAdvisors(env.DB)).find((a) => a.slug === slug); } catch (e) {
    console.error('[advisory-mail] welcome: People or their emails couldn’t be read', e?.message || e);
    await wait().catch(() => {});
    return { waiting: true, why: 'check' };
  }
  if (hasOrGoing((await readState(env.DB, LOG)).welcomed?.[slug], now, me?.email)) return { already: true }; // (had it, or it's on its way)
  if (!me || !ownAddress(me)) return { noEmail: true }; // (none, or one that signs in as staff or a group: it waits for their own)
  if (!settings.emails) { await wait(); return { off: true, queued: true }; }
  // The sign-in list now, not at the next heartbeat: the email's link works the moment it lands
  if (!(await canSignIn(env, me.email))) await syncBoardAccess(env, { fetchImpl, now }).catch(() => null);
  let why = 'sign-in';
  if (await canSignIn(env, me.email)) {
    const r = await sendWelcome(env, { by, slugs: [slug], now, via: 'add', greet: decided ? { [slug]: greet } : {} });
    // (it went, whatever doesn't save after: it's said as sent. A mark that didn't save keeps it waiting, written with
    // its claim, so the heartbeat writes the mark, asking Resend again under the same key, which sends nothing twice)
    if (r.sent) return { sent: r.sent };
    // (no answer that says: owed, with its key, for the heartbeat. Resend's own no: said as one, nothing owed)
    if (r.owed) return { waiting: true, why: 'owed' };
    if (r.refused) return { refused: true };
    // (two at once: the other one has it, or is sending it)
    if (r.going || r.had) return { already: true };
    // (one that may not have gone, a day ago: never sent again by itself; their row on Run it says so, with Send it again)
    if (r.unsure) return { unsure: true };
    why = 'send'; // it couldn't be claimed just now: the heartbeat sends it
  } else {
    // Not a matter of minutes: the sign-in itself isn't set up all the way (Board → Members says what's left)
    // (no Access key, or a sync that worked found the policy missing; Cloudflare briefly not answering is minutes)
    const a = await accessStatus(env).catch(() => null);
    if (a && (!a.configured || a.attached === false)) why = 'setup';
  }
  await wait();
  return { waiting: true, why };
}

/**
 * The heartbeat: every welcome still owed, sent once. Owed: written down as waiting (Add, before Joined; and every press,
 * in the same write as its claim, with its key: Advisory Board QA round 26), or a claim left on its way past its window
 * by a request that died before anything wrote it down. Each goes once the sign-in knows their address, under the key it
 * was written down with, so one that went already is never sent twice. One a person pressed (hand) goes with the
 * Advisory Board's emails off too, as their press would have; the rest wait for the switch. Someone who left, or had
 * theirs, comes off
 */
export async function sendWaitingWelcomes(env, { now = Date.now() } = {}) {
  const log = await readState(env.DB, LOG);
  const waiting = { ...(log.waiting || {}) };
  for (const [slug, v] of Object.entries(log.welcomed || {})) {
    if (!waiting[slug] && v && typeof v === 'object' && v.sending && !v.at && Date.parse(v.sending) <= now - SENDING_STALE_MS) waiting[slug] = { at: v.sending, by: 'the site' };
  }
  if (!Object.keys(waiting).length) return { sent: 0 };
  const settings = await getSettings(env.DB);
  if (!settings.emails && !Object.values(waiting).some((w) => w?.hand)) return { sent: 0, off: true }; // (switched off meanwhile: they wait; switched on, they go)
  const on = await activeAdvisors(env.DB);
  const ready = { first: [], again: [] };
  let unsure = 0;
  for (const [slug, w] of Object.entries(waiting)) {
    const me = on.find((a) => a.slug === slug);
    const rec = log.welcomed?.[slug];
    // (not on the Advisory Board now, or had it (one sent again: had one newer than the one before it): comes off. On
    // it with no address of their own yet: waits for staff to add one)
    const owed = !!me && (!hadIt(rec, me.email) || (!!w?.after && sentAt(rec) === w.after));
    if (!owed) { if (log.waiting?.[slug]) await removeEntry(env.DB, 'waiting', slug); continue; }
    if (!settings.emails && !w?.hand) continue;
    if (rec?.sending && Date.parse(rec.sending) > now - SENDING_STALE_MS) continue; // (a press is sending it this minute)
    // (one that may have reached Resend a day ago is never sent again by itself: their row says so, with Send it again.
    // Advisory Board QA round 27)
    if (ownAddress(me) && welcomeKeyState(w, rec, me.email, now) === 'unsure') { unsure += 1; continue; }
    if (ownAddress(me) && await canSignIn(env, me.email)) ready[w?.after && hadIt(rec, me.email) ? 'again' : 'first'].push(slug);
  }
  // (each with the name and the key it was written down with)
  let sent = 0;
  for (const [kind, slugs] of Object.entries(ready)) {
    if (!slugs.length) continue;
    const greet = Object.fromEntries(slugs.map((slug) => [slug, waiting[slug]?.greet]).filter(([, g]) => typeof g === 'string'));
    const r = await sendWelcome(env, { by: 'the site', slugs, now, greet, anyway: true, again: kind === 'again', via: 'site', owedAs: Object.fromEntries(slugs.map((slug) => [slug, waiting[slug]])) });
    sent += r.sent || 0;
    unsure += r.unsure || 0;
  }
  return { sent, waiting: Object.keys((await readState(env.DB, LOG)).waiting || {}).length, ...(unsure ? { unsure } : {}) };
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
async function markClaim(DB, a, now, to, value, { unowe = false, lost = '' } = {}) {
  await logRow(DB);
  const sending = new Date(now).toISOString();
  const keyOf = `(SELECT j.key FROM json_each(board_state.data, '$."welcomed"') AS j WHERE json_type(j.value) = 'object' AND json_extract(j.value, '$.sending') = ?1 AND lower(json_extract(j.value, '$.sendingTo')) = ?2 ORDER BY j.key = ?3 DESC LIMIT 1)`;
  let set = value === null ? `json_remove(data, '$."welcomed".' || json_quote(${keyOf}))` : `json_set(data, '$."welcomed".' || json_quote(${keyOf}), json(?4))`;
  // (unowe: it went, or Resend refused it: its waiting entry, written with the claim, comes off in this same write. A
  // mark that doesn't save leaves both, and the heartbeat asks Resend again under the same key, which sends nothing twice)
  if (unowe) set = `json_remove(${set}, '$."waiting".' || json_quote(${keyOf}))`;
  // (lost: its answer was lost, so it may have reached Resend: when, kept on its waiting entry, the earliest of them, so
  // it's asked again only under the same key while Resend keeps it: Advisory Board QA round 27)
  const lostAt = `'$."waiting".' || json_quote(${keyOf}) || '.lost'`;
  if (lost) set = `json_set(${set}, ${lostAt}, ifnull(json_extract(data, ${lostAt}), ?7))`;
  const r = await DB.prepare(`UPDATE board_state SET data = ${set}, updated_at = ?5 WHERE key = ?6 AND json_valid(data) AND ${keyOf} IS NOT NULL`)
    .bind(sending, plain(to), a.slug, JSON.stringify(value ?? null), new Date().toISOString(), LOG, ...(lost ? [lost] : [])).run();
  return Number(r?.meta?.changes) > 0;
}

/**
 * Your page is ready: to those named, once each, who haven't had it. Everything it needs is read first (who they are and
 * their address, their records, who runs the group, how each is greeted): a read that fails changes nothing, and says so
 * (503). Then each is claimed, written down as owed with its key in the same write (claimWelcome), so a press and the
 * heartbeat at once never email anyone twice and a request that dies anywhere after the claim leaves it owed for the
 * heartbeat, never lost. Then it goes under its key and is marked had with its send (markClaim). Resend's yes is the
 * only "it went" (Advisory Board QA round 26): no answer that says either way leaves it owed; Resend's own no puts the
 * claim back and takes the owed entry off.
 * anyway: sent with the switch off (a person's press, or the heartbeat finishing one). again: to one who had it AGAIN_MS
 * ago or more. hand: a person's press (its owed entry goes with the switch off too). owedAs: { slug: waiting entry } the
 * heartbeat is sending. → { sent, failed, owed, refused, going, had, unknown?, unmarked? } (going: one on its way already;
 * had: had it)
 */
export async function sendWelcome(env, { by = '', slugs = null, now = Date.now(), greet = {}, anyway = false, again = false, who = '', hand = false, owedAs = {}, fresh = false, via = '' } = {}) {
  const DB = env.DB;
  let settings; let advisors; let was; let wasWaiting; let lead; let preferred;
  try {
    settings = await getSettings(DB);
    if (!settings.emails && !anyway) return { off: true, sent: 0 };
    // (only to a member's own address: never a SOARD address or a group inbox)
    advisors = (await activeAdvisors(DB)).filter((a) => ownAddress(a) && (!slugs || slugs.includes(a.slug)));
    // (each one's record as it was before this send: one that had it keeps it if this one fails)
    const log = await readState(DB, LOG);
    was = log.welcomed || {};
    wasWaiting = log.waiting || {};
    lead = await leadOf(env, settings);
    preferred = { ...(await preferredNames(DB)), ...greet };
  } catch (e) { throw notSent(e); }
  const at = new Date(now).toISOString();
  const mine = [];
  let failed = 0;
  let unknown = 0;
  let going = 0;
  let had = 0;
  let unsure = 0;
  let changed = 0;
  let stop = null;
  for (const a0 of advisors) {
    const to = plain(a0.email);
    const before = was[a0.slug];
    const sentAgain = again && hadIt(before, to) && !!sentAt(before);
    // (the entry it's owed under, while it's owed at this address: the heartbeat's, else the one written down)
    const kept = owedAs[a0.slug] || (!hadIt(before, to) || (wasWaiting[a0.slug]?.after && sentAt(before) === wasWaiting[a0.slug].after) ? wasWaiting[a0.slug] : null) || null;
    const keptKey = String(kept?.key || '');
    const base = keptKey.startsWith(`advisory-welcome:${to}`) ? keptKey : welcomeKey(to, before, again);
    // How long it may wait under its key (one rule for every Advisory Board email, Advisory Board QA round 27): one that
    // may have reached Resend a day ago is never sent again by itself (`fresh`: a person's Send it again on their row,
    // with a new key); none of whose tries reached Resend, past its key's day, goes with a new key
    const same = !keptKey || keptKey === base;
    const state = same ? welcomeKeyState(kept, before, to, now) : 'ok';
    if (state === 'unsure' && !fresh) { unsure += 1; continue; }
    const renew = state === 'stale' || state === 'unsure';
    const key = renew ? freshKey(base, now) : base;
    const lost = !renew && same ? lostOf(kept, before, to, now) : '';
    const owed = { ...(wasWaiting[a0.slug] || {}), ...(owedAs[a0.slug] || {}), ...(typeof greet[a0.slug] === 'string' ? { greet: greet[a0.slug] } : {}),
      at: owedAs[a0.slug]?.at || wasWaiting[a0.slug]?.at || at, by: owedAs[a0.slug]?.by || wasWaiting[a0.slug]?.by || by, key,
      // (tried: when it first went to Resend under this key; lost: when one of its tries may have reached Resend)
      tried: !renew && same && kept?.tried ? kept.tried : at,
      ...(hand ? { hand: true } : {}), ...(sentAgain ? { after: sentAt(before) } : {}) };
    delete owed.lost;
    if (lost) owed.lost = lost;
    let a = a0;
    let claimed = false;
    try {
      for (let i = 0; i < 5; i++) {
        if (await claimWelcome(DB, a.slug, now, a.email, { again, owed, via })) { claimed = true; break; }
        // (renamed on People since the list was read: claimed at the address they have now; else it wasn't theirs to
        // claim: had it, or on its way)
        const me = await memberNow(DB, { slug: a.slug, email: a.email }, { into: false });
        if (!me || me.moving || me.slug === a.slug) break;
        a = { ...a, ...me.person, slug: me.slug, email: a.email };
      }
    } catch (e) {
      // (nothing claimed for them, or it can't be told: the rest still go)
      console.error('[advisory-mail] a welcome not claimed', a.slug, e?.message || e);
      if (e?.unsure) unknown += 1; else failed += 1;
      stop = stop || notSent(e);
      continue;
    }
    if (claimed) mine.push({ ...a, was: before, key });
    else if (hadIt(before, to) && !(before?.sending && Date.parse(before.sending) > now - SENDING_STALE_MS)) had += 1;
    else if (hasOrGoing(before, now, to)) going += 1;
    // (their record changed between the read and the claim. Their email changed on People: said so, never as the email
    // service's no, which was never asked (Advisory Board QA round 27). A rename or a move: nothing claimed for them)
    else if (await emailChanged(DB, a0.slug, to)) changed += 1;
    else failed += 1;
  }
  // (nothing claimed, and a claim that failed: said in its own words, 503)
  if (!mine.length && stop) throw stop;
  let sent = 0;
  let owedN = 0;
  let refused = 0;
  const unmarked = [];
  for (const a of mine) {
    const to = plain(a.email);
    // Each welcome its own Resend call under its own key (as the board's sends are, ./_board.js sendOnce): the same
    // welcome asked for twice within a day (the press, then the heartbeat after one that didn't say) goes once, and
    // Resend's 409 for one it has already is a welcome that went. One sent on purpose again (Send it again on their row)
    // is a welcome of its own: keyed by the one before it, at this address. Keyed by the address it goes to, never their
    // web address: renamed on People while it was going, it's still the same welcome to the same person (round 18)
    const r = await sendEmailItems(env, [{ to: a.email, ...welcomeMessage(greetingOf(a, preferred), lead.name) }], { from: FROM, replyTo: lead.email, tags: tag('advisory-welcome'), idempotencyKey: a.key });
    const how = sendOutcome(r);
    if (how === 'went') {
      sent += 1;
      // A welcome that went is a welcome that went: its mark not saving never makes it read as one that didn't. It
      // stays claimed and owed, and the heartbeat's send of it, once the claim is ten minutes old, asks Resend under the
      // same key, which sends nothing again and answers as before: then it's marked
      try {
        if (!(await markClaim(DB, a, now, to, { at, to, ...(via ? { via } : {}) }, { unowe: true }))) throw new Error('its claim wasn’t found');
      } catch (e) {
        console.error('[advisory-mail] a welcome went but wasn’t marked (the heartbeat marks it)', a.slug, e?.message || e);
        unmarked.push(a.slug);
      }
    } else {
      // (owed: put back as it was, still written down as waiting with its key, so the heartbeat sends it at its next
      // beat; its answer lost, when, so it's asked again only while Resend keeps its key. Refused: put back, and taken
      // off as owed. One that doesn't save is a claim that lapses in ten minutes, owed all the same, and never stops the
      // rest of these going)
      if (how === 'refused') refused += 1; else owedN += 1;
      await markClaim(DB, a, now, to, sentAt(a.was) ? a.was : null, { unowe: how === 'refused', lost: how === 'lost' ? at : '' })
        .catch((e) => console.error('[advisory-mail] a welcome that didn’t go wasn’t put back (it can go again in ten minutes)', a.slug, e?.message || e));
    }
  }
  // (the log of what went is for staff to read: one that doesn't save never makes the welcomes read as not sent)
  if (mine.length) {
    await remember(DB, { kind: 'welcome', by, sent, failed: failed + refused, ...(owedN ? { owed: owedN } : {}), ...(who ? { who } : {}) }, now)
      .catch((e) => console.error('[advisory-mail] welcome log', e?.message || e));
  }
  return { sent, failed, owed: owedN, refused, going, had, ...(unknown ? { unknown } : {}), ...(unmarked.length ? { unmarked } : {}), ...(unsure ? { unsure } : {}), ...(changed ? { changed } : {}) };
}
/** Whether their email on People is another than `to` now (a read that fails: can't tell, so not said) */
async function emailChanged(DB, slug, to) {
  try {
    const r = await DB.prepare('SELECT lower(trim(email)) AS e FROM reveal_board_emails WHERE slug = ?').bind(slug).first();
    return (r?.e || '') !== plain(to);
  } catch { return false; }
}

/**
 * What a press of "Send the sign-in email to N" did, in plain words, from what happened to each (Advisory Board QA
 * round 26: "they've all had it already" was said of a member whose welcome was claimed and never sent)
 */
export function welcomesSaid(r) {
  if (r.off) return 'Nothing went out: emails are off.';
  const parts = [];
  if (r.sent) parts.push(`Sent to ${many(r.sent)}.`);
  if (r.owed) parts.push(r.sent ? `${r.owed === 1 ? 'One more goes' : `${r.owed} more go`} in a few minutes.` : `It goes to ${many(r.owed)} in a few minutes.`);
  if (r.going) parts.push(`${r.going === 1 ? 'One was' : `${r.going} were`} already on ${r.going === 1 ? 'its' : 'their'} way.`);
  if (r.refused) parts.push(`The email service refused ${r.refused === 1 ? 'one' : r.refused}, so ${r.refused === 1 ? 'it' : 'those'} didn’t go. Check their emails on People, then try again.`);
  if (r.changed) parts.push(`${r.changed === 1 ? 'One person’s email' : `${r.changed} people’s emails`} changed on People just now, so ${r.changed === 1 ? 'it wasn’t' : 'those weren’t'} sent. Check ${r.changed === 1 ? 'it' : 'them'} and press again.`);
  if (r.unsure) parts.push(`${r.unsure === 1 ? 'One' : r.unsure} may not have gone: ${r.unsure === 1 ? 'it’s' : 'they’re'} on ${r.unsure === 1 ? 'their row' : 'their rows'} below to send again.`);
  if (r.failed) parts.push(`${r.failed === 1 ? 'One' : r.failed} didn’t go just now. Try again in a moment.`);
  if (r.unknown) parts.push(`We can’t tell yet about ${r.unknown === 1 ? 'one' : r.unknown}: if it’s on its way, it goes by itself in a few minutes.`);
  if (!parts.length) return r.had ? 'Nothing went out: they’ve all had it already.' : 'Nothing went out: nobody here has an email of their own on file.';
  if (r.had) parts.push(`${r.had === 1 ? 'One' : r.had} had it already.`);
  return `${!r.sent && !r.owed ? 'Nothing went out. ' : ''}${parts.join(' ')}`;
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
 * → { sent: 1, again, at } | { owed: 1 } (no answer that says: it goes by itself, under its key) | { refused: 1 } (Resend's
 *   own no) | { failed: 1 } | { gone } | { noEmail, why: 'none' | 'bad' | 'group' | 'staff' } | { signedIn }
 *   | { going } | { tooSoon, at } | { notReady, why: 'sign-in' (Cloudflare, minutes) | 'setup' (Board → Members says what's left) }
 */
export async function sendWelcomeTo(env, slug, { by = '', now = Date.now(), fetchImpl = fetch } = {}) {
  // (everything it needs read first: one that fails changes nothing, and says so, 503: Advisory Board QA round 26)
  let me; let log; let state;
  try {
    me = (await activeAdvisors(env.DB)).find((a) => a.slug === slug);
    if (!me) return { gone: true };
    const why = addressWhy(me.email);
    if (why) return { noEmail: true, why };
    if (await signedInEver(env.DB, slug)) return { signedIn: true };
    log = await readState(env.DB, LOG);
    state = welcomeOf(log.welcomed?.[slug], me.email, now);
    if (state.going) return { going: true };
    if (state.at && Date.parse(state.at) > now - AGAIN_MS) return { tooSoon: true, at: state.at };
    if (!(await canSignIn(env, me.email))) await syncBoardAccess(env, { fetchImpl, now }).catch(() => null);
    if (!(await canSignIn(env, me.email))) {
      const a = await accessStatus(env).catch(() => null);
      return { notReady: true, why: a && (!a.configured || a.attached === false) ? 'setup' : 'sign-in' };
    }
  } catch (e) { throw notSent(e); }
  const greet = log.waiting?.[slug]?.greet;
  const decided = typeof greet === 'string';
  // (fresh: a person's press, so one that may not have gone, and that the site never sends again by itself, goes now with
  // a new key: Advisory Board QA round 27)
  const r = await sendWelcome(env, { by, slugs: [slug], now, anyway: true, again: true, hand: true, fresh: true, via: 'run-it', who: me.name, greet: decided ? { [slug]: greet } : {} });
  // (it went, whatever doesn't save after it: a mark that didn't save is left owed, for the heartbeat to write)
  if (r.sent) return { sent: 1, again: !!state.at, at: new Date(now).toISOString() };
  // (no answer that says: owed, with its key, and the heartbeat sends it in a few minutes. Resend's own no: said)
  if (r.owed) return { owed: 1 };
  if (r.refused) return { refused: 1 };
  if (r.going) return { going: true };
  // (their email on People changed between the reads and the claim: nothing was sent, said so. Resend was never asked)
  if (r.changed) return { changed: 1 };
  if (r.had) {
    const after = welcomeOf((await readState(env.DB, LOG).catch(() => ({}))).welcomed?.[slug], me.email, now);
    return after.at ? { tooSoon: true, at: after.at } : { going: true };
  }
  return { failed: 1 };
}
