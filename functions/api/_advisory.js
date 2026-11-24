/**
 * The Advisory Board's page and the tools that run it
 * ===========================================================================
 * Peter, Nov 5 2026: a page for the advisors like the board's, sharing Board in
 * the admin through a switch. Advisors have a job (help fund one makeover, open
 * doors, show up, four meetings a year), so the page is built around doing it.
 * Mary Atchley runs the group. She signs in as a board member, so her tools sit
 * on this page (Run it) as well as in the admin (the same module, the same API).
 *
 * Who sees what (functions/api/advisory-portal.js, advisory-admin.js):
 *   advisor     People → Advisory, active and published, by their private email
 *   committee   a board member on the Advisory Board committee: reads the page
 *   lead        whoever settings.lead names (Mary): reads it and runs it
 *   admin       the Board area's admins (Peter, Holly): reads it and runs it
 *
 * What an advisor gets is an allow-list built here. portalData (the board's) is
 * never called: advisors hold no fiduciary, budget or voting authority, so bank
 * balances, budgets, named gifts, costs, board minutes and papers, family
 * applications and hidden kids aren't in what's sent to them at all.
 *
 * Every table is the advisors' own, the way board_practice is its own: nothing
 * that reads the board's tables can reach these, or the other way round.
 * Contacts in an introduction live here in D1, never in site content (the repo
 * is public). No advisor's private email is ever sent to another advisor;
 * advisory@soardcharity.com reaches the group (./_board-group.js keeps it).
 */

import { peopleRows, privateEmails, readState, writeState, normEmail, activeAdvisors, isBoardAdmin, ADVISORY_COMMITTEE, readDown, SIGN_IN_DOWN, PEOPLE_DOWN } from './_board-roles.js';
import { sameMember } from './_member-places.js';
import { isEmail } from './_broadcast-notify.js';
import { todayEastern } from './_reveals.js';
import { photoUrl } from '../../public/admin/team-shared.js';
import { rowsPlace, moveJsonRows, tallyJsonRows } from './_member-places.js';
import { writeAsMember, stillTheirs, movingOff, personOf, GONE_STAFF, MOVING_STAFF } from './_member-write.js';
import { stateReady } from './_board-roles.js';

export const GROUP_ADDRESS = 'advisory@soardcharity.com';
const STATE = 'advisory';

export const INTRO_STATUSES = [
  { id: 'thanks', label: 'Thanks', sub: 'We have it and we’ll take a look' },
  { id: 'talking', label: 'Talking', sub: 'We’re in touch with them' },
  { id: 'yes', label: 'Said yes', sub: 'They’re helping SOARD' },
  { id: 'not-now', label: 'Not now', sub: 'Not the right time' },
];
export const INTRO_HELP = [
  { id: 'donor', label: 'Could give' },
  { id: 'sponsor', label: 'Could sponsor' },
  { id: 'vendor', label: 'Trade or vendor' },
  { id: 'volunteer', label: 'Could volunteer' },
];
export const HOSTED_STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'approved', label: 'Approved' },
  { id: 'not-now', label: 'Not now' },
  { id: 'done', label: 'Held' },
];
/** The papers and the words the Fundraise page shows, each edited in the admin */
/** The shelves on their Documents page. Staff add to any of them */
export const SHELVES = [
  { id: 'about', label: 'About SOARD', sub: 'Who we are and what we do' },
  { id: 'marketing', label: 'Marketing', sub: 'What to share, and how' },
  { id: 'donors', label: 'For donors and sponsors', sub: 'What a company or a matching program asks for' },
  { id: 'group', label: 'For the group', sub: 'How the Advisory Board works' },
];
export const DOC_KINDS = [
  { id: 'agreement', label: 'Advisory Board agreement', sign: true },
  { id: 'overview', label: 'Overview' },
  { id: 'pitch', label: '30-second pitch' },
  { id: 'post', label: 'Post to share' },
  { id: 'sponsor', label: 'Sponsor one-pager' },
  { id: 'matching', label: 'Employer matching steps' },
  { id: 'hosting', label: 'How to host a fundraiser' },
  { id: 'library', label: 'Document' },
];

/** The monthly ask email's links: one per ask and member, only its hash kept (./_advisory-mail.js) */
export const LINKS_TABLE = 'CREATE TABLE IF NOT EXISTS advisory_links (hash TEXT PRIMARY KEY, ask_id TEXT NOT NULL, slug TEXT NOT NULL, expires TEXT NOT NULL)';
/** The Advisory Board's meetings, each kept as JSON (./_advisory-meetings.js) */
export const MEETINGS_TABLE = 'CREATE TABLE IF NOT EXISTS advisory_meetings (id TEXT PRIMARY KEY, date TEXT, data TEXT NOT NULL, updated_at TEXT, updated_by TEXT)';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS advisory_asks (id TEXT PRIMARY KEY, data TEXT NOT NULL, sent_at TEXT, closed_at TEXT, at TEXT NOT NULL, by TEXT)',
  'CREATE TABLE IF NOT EXISTS advisory_answers (ask_id TEXT NOT NULL, slug TEXT NOT NULL, answer TEXT NOT NULL, note TEXT, at TEXT NOT NULL, via TEXT, PRIMARY KEY (ask_id, slug))',
  'CREATE TABLE IF NOT EXISTS advisory_wishlist (id TEXT PRIMARY KEY, data TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL, by TEXT)',
  // Whose introduction it is is `slug`; the person introduced is in data, private to staff, the lead and that advisor
  'CREATE TABLE IF NOT EXISTS advisory_intros (id TEXT PRIMARY KEY, slug TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)',
  'CREATE INDEX IF NOT EXISTS idx_advisory_intros_slug ON advisory_intros(slug)',
  'CREATE TABLE IF NOT EXISTS advisory_hosted (id TEXT PRIMARY KEY, slug TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)',
  // One row per advisor: when their year runs and when they last renewed. left_on when they stepped off
  'CREATE TABLE IF NOT EXISTS advisory_terms (slug TEXT PRIMARY KEY, started_on TEXT, ends_on TEXT, renewed_on TEXT, left_on TEXT)',
  'CREATE TABLE IF NOT EXISTS advisory_docs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT, updated_by TEXT)',
  'CREATE TABLE IF NOT EXISTS advisory_signatures (doc_id TEXT NOT NULL, slug TEXT NOT NULL, year INTEGER NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, at TEXT NOT NULL, PRIMARY KEY (doc_id, slug, year))',
  // A gift from another Zeffy campaign credited to an advisor: only which payment and who; the amount is read live, so a refund falls out
  'CREATE TABLE IF NOT EXISTS advisory_credits (payment_id TEXT PRIMARY KEY, slug TEXT, note TEXT, at TEXT NOT NULL, by TEXT)',
  // The monthly ask email's buttons (./_advisory-mail.js linkFor) and the meetings (./_advisory-meetings.js): made here
  // with the rest, so a rename's move never meets a table not made yet (Advisory Board QA round 20)
  LINKS_TABLE,
  MEETINGS_TABLE,
];
const ready = new WeakSet();
export async function ensureAdvisory(DB) {
  if (ready.has(DB)) return;
  for (const sql of SCHEMA) await DB.prepare(sql).run();
  ready.add(DB);
}

const nowIso = (now = Date.now()) => new Date(now).toISOString();
const parse = (s, d = {}) => { try { return JSON.parse(s || '') ?? d; } catch { return d; } };
const clean = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max = 4000) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
/** A web address someone typed: "zeffy.com/x" gets its https://; anything that isn't one is refused, never quietly dropped */
export function webLink(v) {
  const t = clean(v, 400);
  if (!t) return '';
  const u = /^https?:\/\//i.test(t) ? t.replace(/^http:/i, 'https:') : `https://${t}`;
  if (!/^https:\/\/[^\s/]+\.[^\s/]+\S*$/i.test(u)) throw Object.assign(new Error('That doesn’t look like a web address. Paste the whole link.'), { status: 400 });
  return u;
}
const plusYear = (date) => `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
export const newId = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(9))].map((b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('')}`;
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-z]+_[a-z2-7]{6,24}$/;
export const isId = (s) => ID.test(String(s || ''));

// ─── Settings ───────────────────────────────────────────────────────

const DEFAULTS = {
  // Peter, Nov 5 2026: "mary runs the advisory"
  lead: 'mary-atchley',
  goal: 25000,
  // The first seven joined Oct 22 2026; everyone's year runs together, so one term date serves the group
  termStart: '2026-10-22',
  termEnd: '2027-10-22',
  // The emails to advisors are off until someone turns them on (they're people outside SOARD)
  emails: false,
  // Zeffy: the peer-to-peer campaign's id, and each advisor's page as { campaign id: slug }
  campaignId: '',
  campaignUrl: '',
  pages: {},
  // The kid the group is sponsoring, once one is picked (./_advisory-sponsor.js)
  kid: '',
  // Money rolled over from an earlier term: [{ term, amount }]
  carried: [],
};
export async function getSettings(DB) {
  const saved = await readState(DB, STATE);
  return { ...DEFAULTS, ...saved, pages: saved.pages || {}, carried: Array.isArray(saved.carried) ? saved.carried : [] };
}
/** Who runs the group: an active board member */
const runsGroup = (p) => p?.group === 'board' && p?.status === 'active';
export const PICK_LEAD = 'Pick an active board member';
export const LEAD_MOVED = 'This board member’s web address on People changed just now, so nothing was saved. Reload and pick them again.';
/**
 * Each role a save of the settings can name someone in (saveSettings `as`): who may fill it, and its own true words
 * when the address named isn't theirs as the save is written (Advisory Board QA round 22: who runs the group, a board
 * member, was refused as "isn't on the Advisory Board", or told "Pick an active board member" while she was one, in the
 * moment her address changed on People)
 *   lead  who runs the group: an active board member at that address. Their address changed just now (nobody is at it
 *         and the person who had it is an active board member at a new one, ./_board.js addressesNow, or a rename is
 *         still moving records off it): LEAD_MOVED; nobody else's, or someone who isn't an active board member now:
 *         PICK_LEAD
 *   page  a Zeffy page's person (./_advisory-money.js matchPage): anyone on People at that address
 */
const ROLES = {
  lead: {
    fits: runsGroup,
    async refused(DB, slug, at) {
      if (at?.moving) return err(LEAD_MOVED, 409);
      if (at) return err(PICK_LEAD, 400);
      const { addressesNow } = await import('./_board.js');
      const to = (await addressesNow(DB, [slug]))[slug];
      return to && runsGroup((await atAddress(DB, to))?.person) ? err(LEAD_MOVED, 409) : err(PICK_LEAD, 400);
    },
  },
  page: {
    fits: () => true,
    refused: async (DB, slug, at) => (at?.moving ? Object.assign(err(MOVING_STAFF, 503), { moving: true }) : err(GONE_STAFF, 409)),
  },
};
/**
 * Whoever is at this address on People this moment, in one read (an address a staff save names is whoever has it now:
 * never found through an email read first, which during a swap of two addresses is the other person by the time its
 * record is read) → { slug, data, person, moving } or null (`moving`: a rename is moving records off it)
 */
async function atAddress(DB, slug) {
  await stateReady(DB);
  // (a read of People that fails says so, 503, never "pick an active board member": Board QA round 10's rule)
  const r = slug ? await DB.prepare(`SELECT t.slug AS slug, t.data AS data, ${movingOff('t.slug')} AS moving FROM team t WHERE t.slug = ?`).bind(slug).first()
    .catch((e) => { if (/no such table/i.test(e?.message || '')) return null; throw readDown(PEOPLE_DOWN, e); }) : null;
  const person = r ? personOf(r.data, r.slug) : null;
  return person ? { slug: r.slug, data: r.data, person, moving: !!r.moving } : null;
}
/** The person an address names in a role, as things are this moment: { slug, data, person }; else the role's words, thrown */
async function namedNow(DB, slug, as) {
  const role = ROLES[as] || ROLES.page;
  const at = await atAddress(DB, typeof slug === 'string' ? slug : '');
  if (at && !at.moving && role.fits(at.person)) return at;
  throw await role.refused(DB, typeof slug === 'string' ? slug : '', at);
}
/** Who runs the group as staff name them (./advisory-admin.js save-settings): the address of an active board member there now, else ROLES.lead's words */
export async function leadNamed(DB, slug) {
  return (await namedNow(DB, slug, 'lead')).slug;
}
/**
 * The settings saved, written only over the settings as read (Advisory Board QA round 21: a save read before a rename's
 * move of the settings wrote the old address back over it): changed meanwhile, read again and the patch made again
 * over the newest. `patch` may be a function of the settings as they are. `naming`: an address the patch puts in, in
 * the role `as` (ROLES: who runs the group, a page's person), written only over that person's People record exactly as
 * read for the role, with no rename moving records off it; else the role's words
 */
export async function saveSettings(DB, patch0, { naming = '', as = 'page' } = {}) {
  await readState(DB, STATE); // (the table)
  for (let i = 0; i < 5; i++) {
    const row = await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(STATE).first();
    let saved = {};
    try { saved = row ? JSON.parse(row.data) || {} : {}; } catch { saved = {}; }
    const cur = { ...DEFAULTS, ...saved, pages: saved.pages || {}, carried: Array.isArray(saved.carried) ? saved.carried : [] };
    const next = settingsFrom(cur, typeof patch0 === 'function' ? patch0(cur) : patch0);
    const at = nowIso();
    const me = naming ? await namedNow(DB, naming, as) : null;
    const guard = me ? ` AND EXISTS (SELECT 1 FROM team t WHERE ${stillTheirs('t', { into: false })})` : '';
    const g = me ? [me.slug, me.data] : [];
    const r = row
      ? await DB.prepare(`UPDATE board_state SET data = ?, updated_at = ? WHERE key = ? AND data = ?${guard}`).bind(JSON.stringify(next), at, STATE, row.data, ...g).run()
      : await DB.prepare(`INSERT OR IGNORE INTO board_state (key, data, updated_at) SELECT ?, ?, ? WHERE 1${guard}`).bind(STATE, JSON.stringify(next), at, ...g).run();
    if (Number(r?.meta?.changes) > 0) return next;
  }
  throw err('The settings kept changing. Try again in a moment.', 409);
}
function settingsFrom(cur, patch) {
  const next = { ...cur };
  if ('lead' in patch) next.lead = clean(patch.lead, 120);
  if ('goal' in patch) {
    const n = Number(patch.goal);
    if (patch.goal === '' || patch.goal == null || !Number.isFinite(n) || n <= 0 || n > 10_000_000) throw err('Type the goal in dollars');
    next.goal = Math.round(n);
  }
  for (const k of ['termStart', 'termEnd']) if (k in patch) {
    if (!isDate(patch[k])) throw err('Pick a date');
    next[k] = patch[k];
  }
  if (next.termEnd <= next.termStart) throw err('The term has to end after it starts');
  if ('emails' in patch) next.emails = patch.emails === true;
  if ('campaignId' in patch) next.campaignId = clean(patch.campaignId, 80);
  if ('campaignUrl' in patch) next.campaignUrl = webLink(patch.campaignUrl);
  if ('pages' in patch && patch.pages && typeof patch.pages === 'object') next.pages = patch.pages;
  if ('kid' in patch) next.kid = clean(patch.kid, 120);
  if ('carried' in patch && Array.isArray(patch.carried)) next.carried = patch.carried;
  if ('seeded' in patch) next.seeded = patch.seeded === true;
  if ('library' in patch) next.library = patch.library === true;
  // Which of the board's papers advisors can open, chosen one by one: nothing here means none
  if ('boardDocs' in patch) next.boardDocs = Array.isArray(patch.boardDocs) ? [...new Set(patch.boardDocs.map(String).filter((x) => /^d_[a-z0-9]{4,24}$/.test(x)))] : [];
  return next;
}

// ─── Who's looking ──────────────────────────────────────────────────

/**
 * The person looking, from what the middleware found: { kind, slug, name, email, runs, answers } or null.
 * runs: may use the tools that run the group. answers: an advisor themself (only they answer, sign and introduce).
 */
export async function whoIs(context) {
  const { env, data } = context;
  await ensureAdvisory(env.DB);
  const settings = await getSettings(env.DB);
  if (data?.advisor) return { kind: 'advisor', ...data.advisor, runs: false, answers: true };
  if (data?.boardMember) {
    const m = data.boardMember;
    // (theirs at the moment of their own rename too: the lead still at the old address, or the sign-in. A read that fails
    // is "couldn't check", never "not for you": Board QA round 9)
    const lead = await sameMember(env.DB, settings.lead, m.slug).catch((e) => { throw readDown(SIGN_IN_DOWN, e); });
    if (lead) return { kind: 'lead', ...m, runs: true, answers: false };
    if ((m.committees || []).includes(ADVISORY_COMMITTEE)) return { kind: 'committee', ...m, runs: false, answers: false };
    return null;
  }
  // (a founder whose check of who runs Board failed: isBoardAdmin throws its 503, said with Try again, never refused)
  if (await isBoardAdmin(env.DB, data?.userEmail)) return { kind: 'admin', slug: '', name: '', email: data.userEmail, runs: true, answers: false };
  return null;
}

/** The advisors as advisors see each other: a photo, a company, a public bio. Never a private email */
export async function advisorCards(DB) {
  const people = await peopleRows(DB);
  return people.filter((p) => p.group === 'advisory' && p.status === 'active')
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((p) => ({
      slug: p.slug, name: p.name, photo: p.photo ? photoUrl(p, 240) : '', organization: p.organization || '',
      bio: clean(p.bio, 600), linkedin: /^https:\/\/\S+$/.test(p.linkedin || '') ? p.linkedin : '',
    }));
}

/** The person running the group, as the page shows them */
export async function leadCard(DB, settings) {
  const people = await peopleRows(DB);
  const p = people.find((x) => x.slug === settings.lead);
  return p ? { slug: p.slug, name: p.name, photo: p.photo ? photoUrl(p, 240) : '' } : null;
}

// ─── The monthly ask ────────────────────────────────────────────────

const askOf = (r) => ({ id: r.id, ...parse(r.data), sentAt: r.sent_at || '', closedAt: r.closed_at || '', at: r.at, by: r.by || '' });
/**
 * The row a staff change wrote, from that statement itself (RETURNING *), never read again afterwards: a read after a
 * change that had landed, not answering, said "That didn't go through", and pressing again saved a second ask, wish or
 * paper (Advisory Board QA round 24, as Add's Joined and the members' own writes: rowWritten). No row: it was deleted
 * in the moment since (another tab), said in `gone`'s words
 */
const staffWritten = async (stmt, gone) => {
  const row = await stmt.first();
  if (!row) throw err(gone, 404);
  return row;
};

export async function listAsks(DB) {
  await ensureAdvisory(DB);
  const rows = (await DB.prepare('SELECT * FROM advisory_asks ORDER BY at DESC').all()).results || [];
  return rows.map(askOf);
}
/** Written, not yet out: `out` puts it on the page (and in the monthly email when that's on) */
export async function saveAsk(DB, raw, { by = '', now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  const title = clean(raw.title, 140);
  if (!title) throw err('What’s the ask?');
  const data = { title, body: cleanText(raw.body, 1500), link: webLink(raw.link) };
  const id = isId(raw.id) ? raw.id : newId('ask');
  const had = await DB.prepare('SELECT id FROM advisory_asks WHERE id = ?').bind(id).first();
  return askOf(await staffWritten(had
    ? DB.prepare('UPDATE advisory_asks SET data = ? WHERE id = ? RETURNING *').bind(JSON.stringify(data), id)
    : DB.prepare('INSERT INTO advisory_asks (id, data, at, by) VALUES (?, ?, ?, ?) RETURNING *').bind(id, JSON.stringify(data), nowIso(now), by), 'That ask is gone'));
}
/** Only one ask is out at a time: the page has one thing on it, and the last one closes when the next goes out */
export async function putAskOut(DB, id, { now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  const row = await DB.prepare('SELECT id, sent_at FROM advisory_asks WHERE id = ?').bind(id).first();
  if (!row) throw err('That ask is gone', 404);
  await DB.prepare('UPDATE advisory_asks SET closed_at = ? WHERE sent_at IS NOT NULL AND closed_at IS NULL AND id != ?').bind(nowIso(now), id).run();
  return askOf(await staffWritten(DB.prepare('UPDATE advisory_asks SET sent_at = COALESCE(sent_at, ?), closed_at = NULL WHERE id = ? RETURNING *').bind(nowIso(now), id), 'That ask is gone'));
}
export async function closeAsk(DB, id, { now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  await DB.prepare('UPDATE advisory_asks SET closed_at = ? WHERE id = ?').bind(nowIso(now), id).run();
}
export async function deleteAsk(DB, id) {
  await ensureAdvisory(DB);
  // One that went out has answers: a stale tab can't wipe them. Close it instead
  const row = await DB.prepare('SELECT sent_at FROM advisory_asks WHERE id = ?').bind(id).first();
  if (row?.sent_at) throw err('That ask has gone out, so it stays on the record. Close it instead.', 409);
  await DB.prepare('DELETE FROM advisory_answers WHERE ask_id = ?').bind(id).run();
  await DB.prepare('DELETE FROM advisory_asks WHERE id = ?').bind(id).run();
}
export async function currentAsk(DB) {
  await ensureAdvisory(DB);
  const row = await DB.prepare('SELECT * FROM advisory_asks WHERE sent_at IS NOT NULL AND closed_at IS NULL ORDER BY sent_at DESC').first();
  return row ? askOf(row) : null;
}
/** An ask that takes answers (out, not closed), else its words */
export async function askOpen(DB, askId) {
  const ask = await DB.prepare('SELECT id, sent_at, closed_at FROM advisory_asks WHERE id = ?').bind(askId).first();
  if (!ask) throw err('That ask is gone', 404);
  if (!ask.sent_at) throw err('That ask isn’t out yet', 409);
  if (ask.closed_at) throw err('That ask has closed', 409);
}
// (the ask still out and open as the answer is written)
const OPEN_ASK = 'EXISTS (SELECT 1 FROM advisory_asks a WHERE a.id = ? AND a.sent_at IS NOT NULL AND a.closed_at IS NULL)';
/**
 * Their answer to an ask, at the address they have as it's written (./_member-write.js: `who` is the member as their
 * sign-in found them, { slug, email }, or an address). → { answer, note, slug, name }: whose record it landed on
 */
export async function answerAsk(DB, askId, who, { answer, note = '', via = 'page' }, { now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  if (!['yes', 'no'].includes(answer)) throw err('Choose an answer');
  const text = cleanText(note, 800);
  const { me } = await writeAsMember(DB, who, async (me) => {
    await askOpen(DB, askId);
    return DB.prepare(`INSERT OR REPLACE INTO advisory_answers (ask_id, slug, answer, note, at, via) SELECT ?, t.slug, ?, ?, ?, ? FROM team t WHERE ${stillTheirs('t')} AND ${OPEN_ASK}`)
      .bind(askId, answer, text, nowIso(now), via, me.slug, me.data, askId).run();
  });
  return { answer, note: text, slug: me.slug, name: me.person.name };
}
export async function answersTo(DB, askId) {
  await ensureAdvisory(DB);
  return (await DB.prepare('SELECT slug, answer, note, at, via FROM advisory_answers WHERE ask_id = ?').bind(askId).all()).results || [];
}

// ─── Who we're looking for ──────────────────────────────────────────

export async function listWishes(DB) {
  await ensureAdvisory(DB);
  const rows = (await DB.prepare('SELECT * FROM advisory_wishlist ORDER BY sort, at').all()).results || [];
  return rows.map((r) => ({ id: r.id, ...parse(r.data), sort: r.sort }));
}
export async function saveWish(DB, raw, { by = '', now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  const title = clean(raw.title, 140);
  if (!title) throw err('Who are we looking for?');
  const data = { title, detail: clean(raw.detail, 400) };
  const id = isId(raw.id) ? raw.id : newId('w');
  const had = await DB.prepare('SELECT id FROM advisory_wishlist WHERE id = ?').bind(id).first();
  const last = had ? null : await DB.prepare('SELECT MAX(sort) AS n FROM advisory_wishlist').first();
  const r = await staffWritten(had
    ? DB.prepare('UPDATE advisory_wishlist SET data = ? WHERE id = ? RETURNING *').bind(JSON.stringify(data), id)
    : DB.prepare('INSERT INTO advisory_wishlist (id, data, sort, at, by) VALUES (?, ?, ?, ?, ?) RETURNING *').bind(id, JSON.stringify(data), (Number(last?.n) || 0) + 1, nowIso(now), by), 'That one is gone');
  return { id: r.id, ...parse(r.data), sort: r.sort };
}
export async function deleteWish(DB, id) {
  await ensureAdvisory(DB);
  await DB.prepare('DELETE FROM advisory_wishlist WHERE id = ?').bind(id).run();
}

// ─── Introductions ──────────────────────────────────────────────────

const introOf = (r) => ({ id: r.id, slug: r.slug, status: r.status, ...parse(r.data), at: r.at, updatedAt: r.updated_at, updatedBy: r.updated_by || '' });

/**
 * Whose record a member's write landed on, as that very write found them (writeAsMember's own `me`): the notice to
 * whoever runs the group names them from this, never from a read by the record's address afterwards, which during a swap
 * of two people's addresses is the other person (Advisory Board QA round 22)
 */
const landedOn = (me) => ({ slug: me.slug, name: me.person.name });
/**
 * A member's write by a guarded statement (stillTheirs) and the row it wrote, from that statement itself (RETURNING):
 * → writeAsMember's result, { meta, saved }, saved null when the guard let nothing through. What the write answers with
 * is this row, never one read again afterwards: a read after it that didn't answer said "That didn't go through" of an
 * introduction or a request that had, and pressing again made a second, with a second notice (Advisory Board QA round
 * 24, as round 23 had a term's: termWritten)
 */
const rowWritten = async (stmt) => {
  const saved = await stmt.first();
  return { meta: { changes: saved ? 1 : 0 }, saved };
};

/** "I know someone", at the address they have as it's written (./_member-write.js). `landedOn`: whose it is */
export async function addIntro(DB, who, raw, { now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  const name = clean(raw.name, 120);
  if (!name) throw err('Who are you introducing?');
  const email = normEmail(raw.email);
  if (email && !isEmail(email)) throw err('That email doesn’t look right');
  const help = (Array.isArray(raw.help) ? raw.help : []).filter((h) => INTRO_HELP.some((x) => x.id === h));
  const data = {
    name, company: clean(raw.company, 120), email, phone: clean(raw.phone, 40), how: cleanText(raw.how, 800), help,
    wish: isId(raw.wish) ? raw.wish : '',
  };
  const id = newId('in');
  const { me, result } = await writeAsMember(DB, who, (me) => rowWritten(DB.prepare(`INSERT INTO advisory_intros (id, slug, status, data, at, updated_at) SELECT ?, t.slug, ?, ?, ?, ? FROM team t WHERE ${stillTheirs('t')} RETURNING *`)
    .bind(id, 'thanks', JSON.stringify(data), nowIso(now), nowIso(now), me.slug, me.data)));
  return { ...introOf(result.saved), landedOn: landedOn(me) };
}
/** Only their own: what an advisor sees of the introductions */
export async function introsBy(DB, slug) {
  await ensureAdvisory(DB);
  return ((await DB.prepare('SELECT * FROM advisory_intros WHERE slug = ? ORDER BY at DESC').bind(slug).all()).results || []).map(introOf);
}
export async function listIntros(DB) {
  await ensureAdvisory(DB);
  return ((await DB.prepare('SELECT * FROM advisory_intros ORDER BY at DESC').all()).results || []).map(introOf);
}
export async function setIntroStatus(DB, id, { status, note }, { by = '', now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  if (!INTRO_STATUSES.some((s) => s.id === status)) throw err('Choose where it stands');
  const row = await DB.prepare('SELECT * FROM advisory_intros WHERE id = ?').bind(id).first();
  if (!row) throw err('That introduction is gone', 404);
  const data = { ...parse(row.data), ...(note !== undefined ? { note: cleanText(note, 800) } : {}) };
  const saved = await staffWritten(DB.prepare('UPDATE advisory_intros SET status = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *').bind(status, JSON.stringify(data), nowIso(now), by, id), 'That introduction is gone');
  return { intro: introOf(saved), changed: row.status !== status };
}

// ─── Hosting a fundraiser ───────────────────────────────────────────

const hostedOf = (r) => ({ id: r.id, slug: r.slug, status: r.status, ...parse(r.data), at: r.at, updatedAt: r.updated_at, updatedBy: r.updated_by || '' });

/** A request to host a fundraiser, at the address they have as it's written (./_member-write.js). `landedOn`: whose it is */
export async function requestHost(DB, who, raw, { now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  const title = clean(raw.title, 140);
  if (!title) throw err('What’s the idea?');
  const data = { title, when: clean(raw.when, 120), where: clean(raw.where, 200), expected: clean(raw.expected, 120), notes: cleanText(raw.notes, 1500) };
  const id = newId('h');
  const { me, result } = await writeAsMember(DB, who, (me) => rowWritten(DB.prepare(`INSERT INTO advisory_hosted (id, slug, status, data, at, updated_at) SELECT ?, t.slug, ?, ?, ?, ? FROM team t WHERE ${stillTheirs('t')} RETURNING *`)
    .bind(id, 'new', JSON.stringify(data), nowIso(now), nowIso(now), me.slug, me.data)));
  return { ...hostedOf(result.saved), landedOn: landedOn(me) };
}
export async function listHosted(DB) {
  await ensureAdvisory(DB);
  return ((await DB.prepare('SELECT * FROM advisory_hosted ORDER BY at DESC').all()).results || []).map(hostedOf);
}
export async function setHosted(DB, id, { status, note, date, giveUrl }, { by = '', now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  if (!HOSTED_STATUSES.some((s) => s.id === status)) throw err('Choose where it stands');
  const row = await DB.prepare('SELECT * FROM advisory_hosted WHERE id = ?').bind(id).first();
  if (!row) throw err('That request is gone', 404);
  if (date && !isDate(date)) throw err('Pick a date');
  const data = {
    ...parse(row.data), ...(note !== undefined ? { note: cleanText(note, 800) } : {}), ...(date !== undefined ? { date } : {}),
    // Its own Zeffy page, so the money it raises counts toward the goal
    ...(giveUrl !== undefined ? { giveUrl: webLink(giveUrl) } : {}),
  };
  const saved = await staffWritten(DB.prepare('UPDATE advisory_hosted SET status = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *').bind(status, JSON.stringify(data), nowIso(now), by, id), 'That request is gone');
  return { hosted: hostedOf(saved), changed: row.status !== status };
}

/** An approved fundraiser's Zeffy page, by itself (Admin → Site Config → Zeffy): its status, date and note stay */
export async function setHostedLink(DB, id, giveUrl, { by = '', now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  const row = await DB.prepare('SELECT * FROM advisory_hosted WHERE id = ?').bind(id).first();
  if (!row) throw err('That request is gone', 404);
  if (row.status !== 'approved') throw err('Only an approved fundraiser has a Zeffy page here', 409);
  const data = { ...parse(row.data), giveUrl: webLink(giveUrl) };
  return hostedOf(await staffWritten(DB.prepare('UPDATE advisory_hosted SET data = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *').bind(JSON.stringify(data), nowIso(now), by, id), 'That request is gone'));
}

// ─── Terms ──────────────────────────────────────────────────────────

/** A term as its row has it (advisory_terms), else the group's dates. { started, ends, renewedOn, left } */
const termFrom = (r, settings) => ({ started: r?.started_on || settings.termStart, ends: r?.ends_on || settings.termEnd, renewedOn: r?.renewed_on || '', left: r?.left_on || '' });
/** Each advisor's term: their row, else the group's dates. { started, ends, renewedOn, left } */
export async function termOf(DB, slug, settings) {
  await ensureAdvisory(DB);
  return termFrom(await DB.prepare('SELECT * FROM advisory_terms WHERE slug = ?').bind(slug).first(), settings);
}
export async function allTerms(DB, settings) {
  await ensureAdvisory(DB);
  const rows = (await DB.prepare('SELECT * FROM advisory_terms').all()).results || [];
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
  return (slug) => termFrom(by[slug], settings);
}
/**
 * A member's term written by a guarded statement (stillTheirs), and the row it wrote, from that statement itself
 * (RETURNING): → writeAsMember's result, { meta, saved }, saved null when the guard let nothing through. What a term
 * write answers with, and what the notice to whoever runs the group says, is this row, never one read again by the
 * address afterwards: during a swap of two members' addresses that read is the other member's term, and after a rename
 * nobody's, the group's dates (Advisory Board QA round 23)
 */
const TERM_SAVED = ' RETURNING started_on, ends_on, renewed_on, left_on';
const termWritten = (stmt) => rowWritten(stmt);
/** How many days before a term ends the page offers Renew */
export const RENEW_DAYS = 60;
export const canRenew = (term, today) => {
  if (!isDate(term.ends) || term.left) return false;
  const days = Math.round((Date.parse(`${term.ends}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return days <= RENEW_DAYS;
};
/**
 * Another year, at the address they have as it's written (./_member-write.js: their term read there, each try). → their
 * term as that write saved it (termWritten), and `landedOn`: whose it is, as the write found them
 */
export async function renew(DB, who, settings, { now = Date.now() } = {}) {
  const today = todayEastern(now);
  const { me, result } = await writeAsMember(DB, who, async (me) => {
    // (their term read with their record, in one statement: renamed since, it's read again at their new address, never
    // taken for no term at all and refused)
    const row = await DB.prepare('SELECT tm.started_on AS started_on, tm.ends_on AS ends_on, tm.renewed_on AS renewed_on, tm.left_on AS left_on, (SELECT 1 FROM team t WHERE t.slug = ? AND t.data = ?) AS here FROM (SELECT 1) LEFT JOIN advisory_terms tm ON tm.slug = ?')
      .bind(me.slug, me.data, me.slug).first();
    if (!row?.here) return { meta: { changes: 0 } };
    const term = { started: row.started_on || settings.termStart, ends: row.ends_on || settings.termEnd, renewedOn: row.renewed_on || '', left: row.left_on || '' };
    if (!canRenew(term, today)) throw err('Renewing opens closer to the end of your term', 409);
    const ends = plusYear(term.ends > today ? term.ends : today);
    return termWritten(DB.prepare(`INSERT INTO advisory_terms (slug, started_on, ends_on, renewed_on) SELECT t.slug, ?, ?, ? FROM team t WHERE ${stillTheirs('t')} ON CONFLICT(slug) DO UPDATE SET ends_on = excluded.ends_on, renewed_on = excluded.renewed_on, left_on = NULL${TERM_SAVED}`)
      .bind(term.started, ends, today, me.slug, me.data));
  });
  return { ...termFrom(result.saved, settings), landedOn: landedOn(me) };
}
/**
 * Staff set a member's term (Members). Written only while the address is an Advisory Board member's and no rename is
 * moving records off it (./_member-write.js): never a term left at an address nobody has. → their term as that write
 * saved it (termWritten)
 */
export async function setTerm(DB, slug, { ends, left }, settings) {
  await ensureAdvisory(DB);
  if (ends !== undefined && !isDate(ends)) throw err('Pick a date');
  // (someone who left keeps their term row: a staff change to it still lands, at their address now)
  const { result } = await writeAsMember(DB, slug, async (me) => {
    const term = await termOf(DB, me.slug, settings);
    return termWritten(DB.prepare(`INSERT INTO advisory_terms (slug, started_on, ends_on, renewed_on, left_on) SELECT t.slug, ?, ?, ?, ? FROM team t WHERE ${stillTheirs('t')} ON CONFLICT(slug) DO UPDATE SET ends_on = excluded.ends_on, left_on = excluded.left_on${TERM_SAVED}`)
      .bind(term.started, ends ?? term.ends, term.renewedOn || null, left === undefined ? term.left || null : left || null, me.slug, me.data));
  }, { fits: (p) => p.group === 'advisory', gone: GONE_STAFF, moving: MOVING_STAFF });
  return termFrom(result.saved, settings);
}

// ─── Papers and words ───────────────────────────────────────────────

const docOf = (r) => ({ id: r.id, ...parse(r.data), updatedAt: r.updated_at || '', updatedBy: r.updated_by || '' });

/** Said when the papers, or their files, couldn't be read: never a paper shown with no files that has some */
export const DOCS_DOWN = 'The Advisory Board’s papers couldn’t load just now. Please try again in a moment.';
export async function listDocs(DB) {
  await ensureAdvisory(DB);
  // (a read that fails is said as that, a 503 in words, as every read the page rests on is: Board QA round 11. Never a
  // paper with "no files" because its files couldn't be read (Advisory Board QA round 24). A table not made yet is none)
  const unread = (e) => { if (/no such table/i.test(e?.message || '')) return { results: [] }; console.error('[advisory] papers', e?.message || e); throw readDown(DOCS_DOWN, e); };
  const rows = (await DB.prepare('SELECT * FROM advisory_docs').all().catch(unread)).results || [];
  const docs = rows.map(docOf);
  if (!docs.length) return docs;
  // Files live with the board's (private R2, ./_board.js putFile), under their own owner type
  const files = (await DB.prepare("SELECT id, owner_id, name, type, size, at FROM board_files WHERE owner_type = 'advisory-doc'").all().catch(unread)).results || [];
  return docs.sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((d) => ({ ...d, files: files.filter((f) => f.owner_id === d.id).map(({ owner_id, ...f }) => f) }));
}
export async function saveDoc(DB, raw, { by = '', now = Date.now(), base = null } = {}) {
  await ensureAdvisory(DB);
  if (!DOC_KINDS.some((k) => k.id === raw.kind)) throw err('Which kind of paper is it?');
  const title = clean(raw.title, 160);
  if (!title) throw err('Give it a title');
  const id = isId(raw.id) ? raw.id : newId('ad');
  const row = await DB.prepare('SELECT * FROM advisory_docs WHERE id = ?').bind(id).first();
  const cur = row ? parse(row.data) : {};
  // Someone deleted it while this was open: saving doesn't bring it back, or the file that went with it
  if (!row && base) throw err('Someone deleted this paper since you opened it', 410);
  // Two people on one paper: the second is told, and their words stay on their screen
  if (row && base && row.updated_at !== base) throw Object.assign(err(`${row.updated_by || 'Someone'} saved this paper since you opened it`, 409), { current: docOf(row) });
  const body = cleanText(raw.body, 20000);
  const version = (cur.version || 0) + (row && cur.body !== body ? 1 : row ? 0 : 1);
  // (an editor that doesn't send these keeps them)
  const url = 'url' in raw ? webLink(raw.url) : cur.url || '';
  const sort = 'sort' in raw ? Number(raw.sort) || 0 : cur.sort || 0;
  const library = raw.kind === 'library';
  const shelf = !library ? '' : SHELVES.some((s) => s.id === raw.shelf) ? raw.shelf : cur.shelf || '';
  if (library && !shelf) throw err('Which shelf does it go on?');
  const note = !library ? '' : 'note' in raw ? clean(raw.note, 200) : cur.note || '';
  const data = { kind: raw.kind, title, body, url, shared: raw.shared !== false, version, sort, ...(library ? { shelf, note } : {}) };
  // (its files, which a save doesn't change, read before the save: a read that fails saves nothing and says so)
  const files = row ? (await DB.prepare("SELECT id, name, type, size, at FROM board_files WHERE owner_type = 'advisory-doc' AND owner_id = ?").bind(id).all()
    .catch((e) => { if (/no such table/i.test(e?.message || '')) return { results: [] }; throw e; })).results || [] : [];
  const saved = await staffWritten(DB.prepare('INSERT OR REPLACE INTO advisory_docs (id, data, updated_at, updated_by) VALUES (?, ?, ?, ?) RETURNING *').bind(id, JSON.stringify(data), nowIso(now), by), 'That paper is gone');
  return { ...docOf(saved), files };
}
/** A first-day paper. Only into an empty place: never over one someone has since edited */
export async function addDocOnce(DB, id, raw, { by = '', now = Date.now() } = {}) {
  await ensureAdvisory(DB);
  const data = { kind: raw.kind, title: raw.title, body: raw.body || '', url: raw.url || '', shared: true, version: 1, sort: raw.sort || 0, shelf: raw.shelf, note: raw.note || '' };
  await DB.prepare('INSERT OR IGNORE INTO advisory_docs (id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)').bind(id, JSON.stringify(data), nowIso(now), by).run();
}
export async function deleteDoc(DB, id) {
  await ensureAdvisory(DB);
  await DB.prepare('DELETE FROM advisory_signatures WHERE doc_id = ?').bind(id).run();
  await DB.prepare('DELETE FROM advisory_docs WHERE id = ?').bind(id).run();
}
/** A file's owner, for ./advisory-file.js: a shared paper of the advisors', and nothing else */
export async function isSharedDoc(DB, id) {
  await ensureAdvisory(DB);
  const row = await DB.prepare('SELECT data FROM advisory_docs WHERE id = ?').bind(id).first();
  return !!row && parse(row.data).shared !== false;
}
/** Their signature, with their own name typed, at the address they have as it's written (./_member-write.js) */
export async function signDoc(DB, docId, who, name, { now = Date.now(), version = null } = {}) {
  await ensureAdvisory(DB);
  const row = await DB.prepare('SELECT * FROM advisory_docs WHERE id = ?').bind(docId).first();
  const doc = row && docOf(row);
  if (!doc || doc.shared === false) throw err('That paper is gone', 404);
  if (!DOC_KINDS.find((k) => k.id === doc.kind)?.sign) throw err('That paper isn’t one to sign');
  // They sign the words they read: a paper changed while it was open goes back to them first
  if (Number(version) !== Number(doc.version || 1)) throw Object.assign(err('These words have changed. Read the new version, then sign.', 409), { changed: true });
  const typed = clean(name, 120);
  const same = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’-]/g, '').replace(/\s+/g, ' ').trim();
  const year = Number(todayEastern(now).slice(0, 4));
  // (their name as People has it as they sign: renamed meanwhile, the name they have now)
  await writeAsMember(DB, who, (me) => {
    if (!typed || same(typed) !== same(me.person.name)) throw err(`Type your name as ${me.person.name} to sign`);
    return DB.prepare(`INSERT OR REPLACE INTO advisory_signatures (doc_id, slug, year, name, version, at) SELECT ?, t.slug, ?, ?, ?, ? FROM team t WHERE ${stillTheirs('t')}`)
      .bind(docId, year, typed, doc.version || 1, nowIso(now), me.slug, me.data).run();
  });
  return { year, name: typed, at: nowIso(now) };
}
/** { doc id: { slug: { year, name, at, version } } }, each advisor's latest */
export async function signatures(DB) {
  await ensureAdvisory(DB);
  const rows = (await DB.prepare('SELECT * FROM advisory_signatures ORDER BY year').all()).results || [];
  const out = {};
  for (const r of rows) (out[r.doc_id] ||= {})[r.slug] = { year: r.year, name: r.name, at: r.at, version: r.version };
  return out;
}

// ─── A name change or a removal ─────────────────────────────────────

/** The tables with a member's address in a row (Board's, People's and the Advisory Board's lists: ADVISORY_PLACES) */
export const SLUG_TABLES = ['advisory_answers', 'advisory_intros', 'advisory_hosted', 'advisory_terms', 'advisory_signatures', 'advisory_credits', 'advisory_links'];
const MEETING_WORDS = ['Advisory Board meeting they’re on', 'Advisory Board meetings they’re on'];
const PAGES_WORDS = ['Zeffy fundraising page matched to them', 'Zeffy fundraising pages matched to them'];
const LEAD_WORDS = ['setting that names them as who runs the Advisory Board', 'settings that name them as who runs the Advisory Board'];
/**
 * Everywhere the Advisory Board keeps a member's address, as one list (./_member-places.js; Advisory Board QA round 20:
 * the ask email's links and the meetings were moved, a failure silently skipped, but never counted or held, so the next
 * person given the address answered the first one's ask and had their RSVP). ./_people-address.js holds an address while
 * any has it, ./_rename-finish.js says what's left in each, and moveSlug moves each. Looked for and not kept by address:
 * the mail log's list (a name, never an address: its welcome records are ./_advisory-mail.js mailSlugs, the address rule's
 * 'welcome'), the asks themselves (who sent one is staff), the Zeffy totals (read again from the credits and pages at
 * each heartbeat), the papers and the wish list (nobody's)
 *   rows: same is the rest of the table's unique key (an answer to the same ask, a signature on the same paper and year:
 *   the newer kept); a term keeps the earlier started_on, everything else from the newer row
 */
export const ADVISORY_PLACES = [
  rowsPlace({ owner: 'advisory', table: 'advisory_answers', same: ['ask_id'], newer: 'at', words: ['answer to a monthly ask', 'answers to monthly asks'] }),
  rowsPlace({ owner: 'advisory', table: 'advisory_intros', words: ['introduction', 'introductions'] }),
  rowsPlace({ owner: 'advisory', table: 'advisory_hosted', words: ['fundraiser they asked to host', 'fundraisers they asked to host'] }),
  rowsPlace({ owner: 'advisory', table: 'advisory_terms', same: [], earliest: 'started_on', words: ['term on the Advisory Board', 'terms on the Advisory Board'] }),
  rowsPlace({ owner: 'advisory', table: 'advisory_signatures', same: ['doc_id', 'year'], newer: 'at', words: ['signature on an Advisory Board paper', 'signatures on Advisory Board papers'] }),
  rowsPlace({ owner: 'advisory', table: 'advisory_credits', words: ['gift credited to their Advisory Board page', 'gifts credited to their Advisory Board page'] }),
  rowsPlace({ owner: 'advisory', table: 'advisory_links', words: ['link to answer a monthly ask by email', 'links to answer monthly asks by email'] }),
  {
    // Who's on a meeting's list, who answered, who leads an item: wherever its record names them, read as data
    kind: 'advisory_meetings', owner: 'advisory',
    tally: async (DB, slug) => [{ kind: 'advisory_meetings', n: await tallyJsonRows(DB, 'advisory_meetings', slug), words: MEETING_WORDS }],
    async move(DB, from, to, ctx) {
      const r = await moveJsonRows(DB, { table: 'advisory_meetings', words: MEETING_WORDS }, from, to, ctx);
      return [{ kind: 'advisory_meetings', words: MEETING_WORDS, ...r }];
    },
  },
  {
    // The settings: the Zeffy pages matched to them, and who runs the group (one who isn't on People is nobody's to give)
    kind: 'advisory_settings', kinds: ['advisory_pages', 'advisory_lead'], owner: 'advisory',
    async tally(DB, slug) {
      const s = await getSettings(DB);
      return [{ kind: 'advisory_pages', n: Object.values(s.pages || {}).filter((v) => v === slug).length, words: PAGES_WORDS },
        { kind: 'advisory_lead', n: s.lead === slug ? 1 : 0, words: LEAD_WORDS }];
    },
    move: (DB, from, to) => moveSettings(DB, from, to),
  },
];

/**
 * The settings' addresses moved, written only over the settings as read (a save made meanwhile is never undone, as
 * Board's template is: ./_board-rename.js). → [{ kind, words, moved, folded }]
 */
async function moveSettings(DB, from, to) {
  await readState(DB, STATE); // (the table)
  for (let i = 0; i < 5; i++) {
    const row = await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(STATE).first();
    let saved = {};
    try { saved = row ? JSON.parse(row.data) || {} : {}; } catch { throw new Error('the Advisory Board settings can’t be read'); }
    const pages = saved.pages && typeof saved.pages === 'object' ? saved.pages : {};
    const n = Object.values(pages).filter((v) => v === from).length;
    const lead = ({ ...DEFAULTS, ...saved }).lead === from;
    if (!n && !lead) return [];
    const next = JSON.stringify({ ...saved, pages: Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, v === from ? to : v])), ...(lead ? { lead: to } : {}) });
    const at = new Date().toISOString();
    const r = row
      ? await DB.prepare('UPDATE board_state SET data = ?, updated_at = ? WHERE key = ? AND data = ?').bind(next, at, STATE, row.data).run()
      : await DB.prepare('INSERT OR IGNORE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(STATE, next, at).run();
    if (r?.meta?.changes) return [{ kind: 'advisory_pages', words: PAGES_WORDS, moved: n, folded: 0 }, { kind: 'advisory_lead', words: LEAD_WORDS, moved: lead ? 1 : 0, folded: 0 }].filter((e) => e.moved);
  }
  throw new Error('the Advisory Board settings kept changing');
}

/**
 * Their records follow a renamed member (./_rename-finish.js finishRename), every place in ADVISORY_PLACES. Nothing is
 * caught: a table not made yet is made first (ensureAdvisory), and any other failure stops the move, so the rename's
 * finish note stays and the heartbeat finishes it (Advisory Board QA round 20: a failed move of the ask's links or the
 * meetings had been skipped silently, the note cleared). A record they have at both addresses is folded in (the newer
 * kept, the older in the audit log). by: who renamed them. → what moved, by kind ([{ kind, owner, words, moved, folded }])
 */
export async function moveSlug(DB, from, to, { by = '' } = {}) {
  await ensureAdvisory(DB);
  const report = [];
  for (const p of ADVISORY_PLACES) {
    for (const e of await p.move(DB, from, to, { by })) if (e.moved || e.folded) report.push({ ...e, owner: 'advisory' });
  }
  return report;
}

/** Everyone's sign-in for Access (./_board-access.js): every active advisor, shown on the site or not */
export const advisorSignIns = async (DB) => [...new Set((await activeAdvisors(DB)).map((a) => a.email).filter(isEmail))];

/** Advisors with no email on file: they can't sign in yet */
export async function missingEmails(DB) {
  const [people, emails] = await Promise.all([peopleRows(DB), privateEmails(DB)]);
  return people.filter((p) => p.group === 'advisory' && p.status === 'active' && !isEmail(emails[p.slug] || '')).map((p) => ({ slug: p.slug, name: p.name }));
}
