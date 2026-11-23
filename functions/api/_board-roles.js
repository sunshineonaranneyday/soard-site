/**
 * Who a sign-in is, for the admin and the board page
 * ===========================================================================
 * Cloudflare Access lets in two kinds of people with the same emailed code:
 *   staff          a soardcharity.com address. Every admin API answers them
 *                  (functions/api/_middleware.js), except the Board area.
 *   board members  an active board member on People → Board whose private
 *                  email (reveal_board_emails) is the address they signed in
 *                  with. Only the board page's routes (BOARD_ROUTES) answer
 *                  them; everything else is refused before it runs.
 * The Board area (meetings, documents, settings) is for its admins only:
 * Settings → Who can open it, until saved the founders on People → Team
 * (first@soardcharity.com, the way staff sign in).
 */

import { normalizePerson } from '../../public/admin/team-shared.js';

export const STAFF_DOMAIN = 'soardcharity.com';
/** The board page, and the routes a board member's sign-in may call */
export const BOARD_PAGE = '/admin/board/';
export const BOARD_ROUTES = Object.freeze(['/api/board-portal', '/api/board-file']);
// The Advisory Board's page, and its routes: an advisor reaches these and nothing else. A board member reaches them
// when they run the group or sit on its committee (./_advisory.js whoIs says which)
export const ADVISORY_PAGE = '/admin/advisory/';
export const ADVISORY_ROUTES = Object.freeze(['/api/advisory-portal', '/api/advisory-file', '/api/advisory-admin']);
export const ADVISORY_COMMITTEE = 'Advisory Board';
// SOARD's group inboxes: everyone in the group reads what's sent there, so a sign-in code to one opens nothing
export const GROUP_INBOXES = Object.freeze(['board@soardcharity.com', 'advisory@soardcharity.com']);
export const isGroupInbox = (email) => GROUP_INBOXES.includes(normEmail(email).replace(/\+[^@]*@/, '@'));
// Logins with staff roles that aren't people: the Qualification Committee, the DATAx integration and the website's own
// logins. Never a reveal or Demo Day guest, never a donor's owner
export const NOT_STAFF = new Set(['selection@soardcharity.com', 'hello@contractorcto.com', 'automation@soardcharity.com', 'peter+automation@soardcharity.com']);

export const normEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
/** A SOARD staff sign-in (a soardcharity.com address) */
export const isStaffEmail = (email) => normEmail(email).endsWith(`@${STAFF_DOMAIN}`) && isEmail(normEmail(email));
/**
 * Why an address can't sign someone in as themselves (an Advisory Board member, a board member): 'group' (a SOARD
 * group inbox: everyone in it reads the code), 'staff' (a soardcharity.com address signs in as staff), 'bad' (not an
 * email), or '' (it can)
 */
export const signInWhy = (email) => (!isEmail(normEmail(email)) ? 'bad' : isGroupInbox(email) ? 'group' : isStaffEmail(email) ? 'staff' : '');
export const memberSignIn = (email) => signInWhy(email) === '';

// What a person is told when a read that decides who gets in, who is on a list or what an address becomes didn't answer
// (Board QA round 9, Nov 22 2026): never "not yours", "nobody" or "no change", and whatever it was about to do isn't done.
// The sign-in's words are round 8's (./_middleware.js)
export const SIGN_IN_DOWN = 'We couldn’t check your sign-in just now. Please try again in a moment.';
export const PEOPLE_DOWN = 'We couldn’t check People just now, so nothing was changed. Please try again in a moment.';
export const PEOPLE_DOWN_SENT = 'We couldn’t check People just now, so nothing was sent. Please try again in a moment.';
export const EMAILS_DOWN = 'We couldn’t read the board’s emails just now, so nothing was sent. Please try again in a moment.';
/** A read that didn't answer, as an error a route says in these words (503) */
export const readDown = (message, cause = null) => Object.assign(new Error(message), { status: 503, unread: true, cause });
/** A read of People that didn't answer, said for a send ("so nothing was sent"); any other error as it was */
export const asSend = (e) => (e?.unread && e.message === PEOPLE_DOWN ? readDown(PEOPLE_DOWN_SENT, e.cause || e) : e);
/** How long a background job's failed reads of People are a passing note before staff are warned (as Cloudflare's and Google's are) */
export const UNREAD_WARN_MS = 30 * 60 * 1000;
/**
 * A background look whose read of People didn't answer, as its status: not ok, in words, and since when (failingSince,
 * kept from the first failure in a row). Everything else it had stays as it was, so nothing it found before is lost, and
 * it stays due: the next look reads People again
 */
export const unreadStatus = (prev = {}, now = Date.now()) => {
  const at = new Date(now).toISOString();
  return { ...prev, ok: false, unread: true, error: PEOPLE_DOWN, failedAt: at, failingSince: prev.failingSince || at };
};

/*
 * Every read here of People and their emails (who is on the board, the Advisory Board and the staff, and at which
 * address) is sure unless its caller says otherwise (Board QA round 10, Nov 22 2026: the reads that still took a failure
 * for "nobody" wiped every invite's answers, sent an invite to nobody, let a signature count on words never seen and lost
 * a security notice for good). A read that fails throws readDown(PEOPLE_DOWN): a 503 in words for a person, `unread` for
 * a background job to record and try again. A table not made yet is nobody (a new database). A caller that wants
 * "nobody" on a failure passes `{ sure: false }` with its reason beside it, and tests/board-round10.test.mjs keeps the
 * list of those, so a new read can't be added without choosing
 */
const readFailed = (sure) => (e) => {
  if (/no such table/i.test(e?.message || '')) return null;
  if (!sure) return null;
  console.error('[board-roles] reading People', e?.message || e);
  throw e?.unread ? e : readDown(PEOPLE_DOWN, e);
};

/** People records, normalized: [{ slug, ...person }] */
export async function peopleRows(DB, { sure = true } = {}) {
  let rows = [];
  try { rows = (await DB.prepare('SELECT slug, data FROM team').all()).results || []; } catch (e) { readFailed(sure)(e); return []; }
  const out = [];
  for (const r of rows) {
    try { out.push({ slug: r.slug, ...normalizePerson(JSON.parse(r.data || '{}')) }); } catch { /* a broken record is skipped */ }
  }
  return out;
}

/** Private emails by People slug (reveal_board_emails; never in site content) */
export async function privateEmails(DB, { sure = true } = {}) {
  try {
    const rows = (await DB.prepare('SELECT slug, email FROM reveal_board_emails').all()).results || [];
    return Object.fromEntries(rows.map((r) => [r.slug, normEmail(r.email)]));
  } catch (e) { readFailed(sure)(e); return {}; }
}

/** What a sign-in that isn't staff may reach: an advisor only the advisors' routes; a board member the board's, and the advisors' (./_advisory.js whoIs then says what they get) */
export const routesFor = ({ member = null, advisor = null } = {}) => (member ? [...BOARD_ROUTES, ...ADVISORY_ROUTES] : advisor ? [...ADVISORY_ROUTES] : []);

/**
 * Everyone on People, each with their private email when there is one, read in one statement: a People rename moves a
 * record and its email together (./rename-content.js), so two reads could fall either side of one and find a member
 * with no email, then left out of the monthly ask (Advisory Board QA round 21) or taken off board@ or advisory@ by the
 * next sync, and with the Advisory Board's emails off never put back (Board QA round 9). A database with no table of
 * emails yet reads People alone. → [{ slug, ...person, email }] (`sure`: a read that fails throws)
 */
export async function peopleWithEmails(DB, { sure = true } = {}) {
  let rows = null;
  try {
    rows = (await DB.prepare('SELECT t.slug AS slug, t.data AS data, e.email AS email FROM team AS t LEFT JOIN reveal_board_emails AS e ON e.slug = t.slug').all()).results || [];
  } catch (e) {
    if (!/no such table/i.test(e?.message || '')) { readFailed(sure)(e); return []; }
  }
  if (!rows) {
    const [people, emails] = await Promise.all([peopleRows(DB, { sure }), privateEmails(DB, { sure })]);
    return people.map((p) => ({ ...p, email: emails[p.slug] || null }));
  }
  const out = [];
  for (const r of rows) {
    try { out.push({ slug: r.slug, ...normalizePerson(JSON.parse(r.data || '{}')), email: r.email ? normEmail(r.email) : null }); } catch { /* a broken record is skipped */ }
  }
  return out;
}

/** The active board, each with their private email when there is one: [{ slug, name, title, seat, organization, email }] (`sure` as activeAdvisors) */
export async function activeBoard(DB, { sure = true } = {}) {
  return (await peopleWithEmails(DB, { sure })).filter((p) => p.group === 'board' && p.status === 'active');
}

/**
 * The People records whose private email is this address, each read with its email in one statement: a rename on People
 * moves the record and its email together (./rename-content.js), so a read of the email and then of People could fall
 * between the two and find the email at an address nobody has any more, and the member was refused as "not on the
 * list" (Board QA round 8, Nov 21 2026: 4 of 72 loads of the board page during renames). → [{ slug, ...person }]. A read
 * that fails throws, so the sign-in check can say it couldn't check instead of "not on the list" (./_middleware.js; Board
 * QA round 8, Nov 22 2026); with `sure: false`, null (taken for nobody)
 */
async function peopleAtEmail(DB, e, { sure = true } = {}) {
  let rows = [];
  try {
    rows = (await DB.prepare('SELECT t.slug AS slug, t.data AS data FROM reveal_board_emails AS r JOIN team AS t ON t.slug = r.slug WHERE lower(trim(r.email)) = ?').bind(e).all()).results || [];
  } catch (err) { return readFailed(sure)(err); }
  const out = [];
  for (const r of rows) {
    try { out.push({ slug: r.slug, ...normalizePerson(JSON.parse(r.data || '{}')) }); } catch { /* a broken record is skipped */ }
  }
  return out;
}

/** The active board member who signs in with this email, or null (`sure`: a read that fails throws, never "nobody") */
export async function boardMemberFor(DB, email, { sure = true } = {}) {
  const e = normEmail(email);
  if (!isEmail(e) || !DB) return null;
  // (two board members on one address: neither, never a guess at which)
  const on = (await peopleAtEmail(DB, e, { sure }) || []).filter((x) => x.group === 'board' && x.status === 'active');
  const p = on.length === 1 ? on[0] : null;
  return p ? { slug: p.slug, name: p.name, title: p.title || '', seat: p.seat || '', committees: Array.isArray(p.committees) ? p.committees : [], email: e } : null;
}

/**
 * The Advisory Board, with their email: everyone active on People → Advisory, shown on the site or not.
 * Show on the site is only about the public pages: someone added with "Add to Advisory Board" (hidden
 * until staff show them) signs in, joins advisory@ and gets what the group gets straight away.
 * sure: a read of People or the private emails that fails throws (the welcome tells "couldn't check" from "no email")
 */
export async function activeAdvisors(DB, { sure = true } = {}) {
  // (each record with its email in one statement: Advisory Board QA round 21, ./peopleWithEmails)
  return (await peopleWithEmails(DB, { sure })).filter((p) => p.group === 'advisory' && p.status === 'active');
}

/** The advisor who signs in with this email, or null (read with their email in one statement, as a board member is; `sure` as boardMemberFor) */
export async function advisorFor(DB, email, { sure = true } = {}) {
  const e = normEmail(email);
  if (!isEmail(e) || !DB) return null;
  const on = (await peopleAtEmail(DB, e, { sure }) || []).filter((p) => p.group === 'advisory' && p.status === 'active');
  const p = on.length === 1 ? on[0] : null;
  return p ? { slug: p.slug, name: p.name, email: e } : null;
}

/** first@soardcharity.com for each founder on People → Team (how staff sign in) */
export function founderEmails(people) {
  return people.filter((p) => p.group !== 'board' && p.group !== 'advisory' && p.role === 'founder' && p.status === 'active')
    .map((p) => String(p.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z]+/)?.[0])
    .filter(Boolean).map((first) => `${first}@${STAFF_DOMAIN}`);
}

// The board's runtime rows (settings, the sign-in list's sync, caches): their
// own table, never site_config (the content API and the build read that)
const STATE_SCHEMA = 'CREATE TABLE IF NOT EXISTS board_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)';
const _stateReady = new WeakSet();
export async function readState(DB, key) {
  if (!DB) return {};
  if (!_stateReady.has(DB)) { await DB.prepare(STATE_SCHEMA).run(); _stateReady.add(DB); }
  const row = await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(key).first();
  try { return row ? JSON.parse(row.data) || {} : {}; } catch { return {}; }
}
/** board_state made (once per database), for a statement that reads it inside another write (./_member-write.js) */
export async function stateReady(DB) {
  if (!DB || _stateReady.has(DB)) return;
  await DB.prepare(STATE_SCHEMA).run();
  _stateReady.add(DB);
}
export async function writeState(DB, key, value) {
  if (!_stateReady.has(DB)) { await DB.prepare(STATE_SCHEMA).run(); _stateReady.add(DB); }
  await DB.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)')
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
  return value;
}
export const readSettings = (DB) => readState(DB, 'settings');

/**
 * One entry of a board_state record moved to another key in its group ({ group: { from: v } } becomes { group: { to: v } }),
 * as a statement D1 runs by itself, for a batch (a web address changed on People, ./rename-content.js): nothing when
 * there's none at `from`, and one at `to` is replaced. The table must be there (readState makes it)
 */
export function moveStateEntry(DB, key, group, from, to) {
  const g = `$.${JSON.stringify(group)}`;
  const f = `${g}.${JSON.stringify(String(from))}`;
  const t = `${g}.${JSON.stringify(String(to))}`;
  // (the value as JSON whatever it is: an object, a list, a time written as words, a number)
  const value = "CASE json_type(data, ?1) WHEN 'object' THEN json(json_extract(data, ?1)) WHEN 'array' THEN json(json_extract(data, ?1)) WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') WHEN 'null' THEN json('null') ELSE json_extract(data, ?1) END";
  return DB.prepare(`UPDATE board_state SET data = json_remove(json_set(data, ?2, ${value}), ?1), updated_at = ?3 WHERE key = ?4 AND json_valid(data) AND json_type(data, ?1) IS NOT NULL`)
    .bind(f, t, new Date().toISOString(), key);
}

/**
 * Settings → Who can open the Board area (emails); the founders until it's saved. Who runs Board decides who gets in and
 * who is on Board's lists (board@, the invites), so the founders are a sure read: one of People that fails throws, never
 * "no founders" (Board QA round 9: a founder told Board wasn't theirs, a member's Email all shrunk to one address).
 * `sure: false` only where a missing founder changes nothing anyone relies on
 */
export async function boardAdmins(DB, settings = null, { sure = true } = {}) {
  const saved = (settings || await readSettings(DB))?.admins;
  if (Array.isArray(saved) && saved.some((e) => isStaffEmail(e))) return [...new Set(saved.map(normEmail).filter(isStaffEmail))];
  return founderEmails(await peopleRows(DB, { sure }));
}

/** One of the Board area's admins (always a staff sign-in). A read that fails throws readDown(SIGN_IN_DOWN), a 503, never "not one of them" */
export async function isBoardAdmin(DB, email, settings = null) {
  if (!isStaffEmail(email) || !DB) return false;
  try {
    return (await boardAdmins(DB, settings)).includes(normEmail(email));
  } catch (e) {
    console.error('[board-roles] who runs Board', e?.message || e);
    throw readDown(SIGN_IN_DOWN, e);
  }
}
