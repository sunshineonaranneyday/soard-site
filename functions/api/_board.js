/**
 * The board: its meetings, documents and files, and what the board page shows
 * ===========================================================================
 * Everything here is private: its own D1 tables and files under board/ in R2
 * (BOARD_FILES when bound, else FILES; the public /files/ route and the files
 * subdomain serve only financials/, advisory/ and live/). Nothing reaches
 * site_config, the build or the public GitHub repo. The rules for a meeting
 * record are in public/admin/board-shared.js.
 *
 * Tables:
 *   board_meetings      id, date, data (the meeting without its files)
 *   board_files         one row per stored file: its R2 key and what owns it
 *                       (a meeting or a document), staff_only
 *   board_action_state  done or not, by action id (an action carried onto a
 *                       later agenda keeps its id, so done is done everywhere)
 *   board_rsvps         a member's answer for a meeting
 *   board_docs          the document library (bylaws, policies, budgets...)
 *   board_signatures    a member's signature on a paper every member signs, per
 *                       year: typed on the board page, their signed copy (a
 *                       board file owned 'signed', staff-only), or their copy
 *                       in Drive (brought in until Nov 3 2026), and the wording signed
 *   board_signatures_earlier  a member's signature on an earlier wording, kept
 *                       (its copy too) once they sign the next one
 *   board_doc_versions  each wording of a paper written in Board, kept: what
 *                       each signature was on
 *   board_seen         a member's visits to the board page: when this one (the latest) began, their last look in it,
 *                       and when the one before began
 *   board_sign_asks    a member asked by email to sign this year's papers: when last, by whom, how many times
 *   board_cash          the bank balance, one row per month (the heartbeat)
 *   board_state         settings and caches (./_board-roles.js)
 *
 * Who sees what (./_board-roles.js): the Board area's admins see and change
 * everything; a board member sees shared meetings without Peter and Holly's
 * own notes or staff-only files, ticks off their own action items, answers
 * whether they'll come, and signs documents.
 */

import { getSettings as getAdvisorySettings, saveSettings as saveAdvisorySettings } from './_advisory.js';
import {
  cleanMeeting, forBoard, meetingName, openActions, nextMeeting, todayEastern, isDate, uid, parseAgendaText, fileTitle, plural, minutesFileOf, minutesToRead,
  longDate, timeRange, shortDate, DOC_KINDS, FILE_KINDS, RSVP, DEFAULT_TEMPLATE, newMeeting, LIMITS, repliesOf, inviteOut,
  agendaIsDraft, draftAgenda, templateAgenda, previousMeeting, draftName, callName, readAgain, AGENDA_READER, isLive, cleanLive, majority, guessItem, orgName, signsAs,
  isFilled, LIVE_TITLES, agendaItems, presentersOf, reportsOn, namesText, sectionPlan, clock, docTitle, videoOf, packetDocs, partName, minutesIn,
  addressesIn, followAddresses, approvedFileAfter,
} from '../../public/admin/board-shared.js';
import { welcomeHad, REPORT_LOOKS, SLIDE_PIECE, VISIT_GAP_MS, waitsForApproval, shareWaits, cleanTemplate, meetingHeld } from '../../public/admin/board-shared.js';
import { comparePeople, photoUrl } from '../../public/admin/team-shared.js';
import { reachedCount } from '../../public/admin/community-shared.js';
import { peopleRows, privateEmails, activeBoard, boardAdmins, readState, writeState, readSettings, normEmail, readDown, asSend, PEOPLE_DOWN, stateReady } from './_board-roles.js';
import { namesIn, sameMember } from './_member-places.js';
import { ownRow } from './_member-write.js';
import { cachedReveals, fetchJobs, loadKids, loadProjects, matchProject, isProject, isRehearsalJob, parseJobName, FIELD_JOB_STATUS, BUILDING_STATUSES } from './_reveals.js';
import { sendEmailItems, emailConfigured, EMAIL_FROM } from './_broadcast-notify.js';
import { isEmail } from './_broadcast-notify.js';
import { emailShell, button, esc, facts, link, panel, INK, MUTED, SANS, SERIF } from './_email-shell.js';
import { sniffType } from './upload-file.js';
import { maybeSyncBoardAccess } from './_board-access.js';
import { maybeSyncBoardCalendar, calendarStatus } from './_board-calendar.js';
import { maybeReadBoardMail, mailStatus } from './_board-mail.js';
import { mercury } from './_mercury.js';
import { bankBalances, plaidConfigured, bankFacts } from './_plaid.js';
import { booksNow, booksFacts } from './_quickbooks.js';
import { giftsNow } from './_board-gifts.js';
import { makeoverCostsNow, PAGE_MAX_AGE_MS } from './_makeover-costs.js';
import { OPERATING_BALANCE } from '../../public/admin/makeover-costs-shared.js';
import { limit } from './_rate-limit.js';
import { SIG_EVIDENCE, putSignature, addColumns, appendEvents, sha256Hex, cleanMark, CONSENT_TEXT, PROCESS_V, declinedOf, dueOn, dueWords } from './_board-sign.js';
import { paperFields, sameWords } from '../../public/admin/board-md.js';

export const SITE = 'https://sunshineonaranneyday.com';
export const boardFiles = (env) => env?.BOARD_FILES || env?.FILES || null;
export const MAX_FILE = 50 * 1024 * 1024;
// The Advisory Board's owner types for board_files, and the table each file's owner is in
const ADVISORY_OWNERS = { 'advisory-meeting': 'advisory_meetings', 'advisory-doc': 'advisory_docs' };

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS board_meetings (id TEXT PRIMARY KEY, date TEXT, data TEXT NOT NULL, updated_at TEXT, updated_by TEXT)',
  `CREATE TABLE IF NOT EXISTS board_files (id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, r2_key TEXT NOT NULL,
    name TEXT, type TEXT, size INTEGER, kind TEXT, staff_only INTEGER DEFAULT 0, at TEXT, by TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_board_files_owner ON board_files(owner_type, owner_id)',
  'CREATE TABLE IF NOT EXISTS board_action_state (action_id TEXT PRIMARY KEY, done INTEGER NOT NULL, done_on TEXT, by TEXT)',
  'CREATE TABLE IF NOT EXISTS board_rsvps (meeting_id TEXT NOT NULL, slug TEXT NOT NULL, answer TEXT NOT NULL, at TEXT, PRIMARY KEY (meeting_id, slug))',
  // An old one-tap answer link's token (its hash) from a board email before Nov 2 2026: ./_board-rsvp.js
  'CREATE TABLE IF NOT EXISTS board_rsvp_links (hash TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, slug TEXT NOT NULL, expires TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS board_docs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE IF NOT EXISTS board_signatures (doc_id TEXT NOT NULL, slug TEXT NOT NULL, year INTEGER NOT NULL, name TEXT, at TEXT, PRIMARY KEY (doc_id, slug, year))',
  // A signature on an earlier version, kept (with its copy) when its member signs the next one
  'CREATE TABLE IF NOT EXISTS board_sign_asks (slug TEXT NOT NULL, year INTEGER NOT NULL, at TEXT NOT NULL, by TEXT, n INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (slug, year))',
  'CREATE TABLE IF NOT EXISTS board_signatures_earlier (doc_id TEXT NOT NULL, slug TEXT NOT NULL, year INTEGER NOT NULL, version INTEGER NOT NULL, name TEXT, at TEXT, how TEXT, file_id TEXT, drive_id TEXT, drive_name TEXT, added_by TEXT, PRIMARY KEY (doc_id, slug, year, version))',
  'CREATE TABLE IF NOT EXISTS board_doc_versions (doc_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT, at TEXT, by TEXT, PRIMARY KEY (doc_id, version))',
  'CREATE TABLE IF NOT EXISTS board_seen (slug TEXT PRIMARY KEY, at TEXT)',
  // Every step of signing, in one chain (./_board-sign.js): append-only, never pruned, each over the one before it
  'CREATE TABLE IF NOT EXISTS board_sign_events (seq INTEGER PRIMARY KEY, prev TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, doc_id TEXT, slug TEXT NOT NULL, year INTEGER, version INTEGER, kind TEXT NOT NULL, at TEXT NOT NULL, by TEXT, ip TEXT, device TEXT, detail TEXT)',
  'CREATE INDEX IF NOT EXISTS idx_board_sign_events_who ON board_sign_events(slug, year)',
  // A member's adopted signature and initials, and when they agreed to sign electronically
  'CREATE TABLE IF NOT EXISTS board_member_marks (slug TEXT PRIMARY KEY, mark TEXT, initials TEXT, consent_at TEXT, consent_ip TEXT, consent_hash TEXT, updated_at TEXT)',
  'CREATE TABLE IF NOT EXISTS board_cash (month TEXT PRIMARY KEY, total REAL, accounts TEXT, at TEXT)',
  // The admins' practice meetings (simulated members): a table of their own, so nothing that reads board_meetings
  // (the board page, the calendar, invites, emails, Drive, mail, Meet attendance, drafts) can ever reach one
  'CREATE TABLE IF NOT EXISTS board_practice (id TEXT PRIMARY KEY, date TEXT, data TEXT NOT NULL, updated_at TEXT, updated_by TEXT)',
  // A meeting as it's held: who checked in from the board page, and how each one voted on an open motion
  "CREATE TABLE IF NOT EXISTS board_checkins (meeting_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT, how TEXT NOT NULL, at TEXT, PRIMARY KEY (meeting_id, slug))",
  "CREATE TABLE IF NOT EXISTS board_votes (meeting_id TEXT NOT NULL, motion_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT, vote TEXT NOT NULL, at TEXT, PRIMARY KEY (meeting_id, motion_id, slug))",
  // The secretary's notes typed beside the agenda, not on the meeting until they're sent (./_board-notes.js)
  'CREATE TABLE IF NOT EXISTS board_minutes_notes (meeting_id TEXT PRIMARY KEY, data TEXT NOT NULL, sent TEXT, updated_at TEXT, updated_by TEXT, sending TEXT, took TEXT)',
  // Corrections the board suggests to minutes it hasn't approved (./_board-corrections.js)
  `CREATE TABLE IF NOT EXISTS board_minutes_corrections (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, was TEXT, words TEXT,
    by_slug TEXT, by_name TEXT, by_email TEXT, at TEXT, state TEXT NOT NULL, decided_by TEXT, decided_at TEXT, reason TEXT)`,
  'CREATE INDEX IF NOT EXISTS board_minutes_corrections_meeting ON board_minutes_corrections (meeting_id, state)',
  // The secretary's signature on approved minutes, and the signed copy made from it (./_board-minutes-sign.js)
  `CREATE TABLE IF NOT EXISTS board_minutes_signed (meeting_id TEXT PRIMARY KEY, slug TEXT, name TEXT, title TEXT, at TEXT, how TEXT, mark TEXT, hash TEXT, signer_email TEXT, ip TEXT,
    device TEXT, signin_at TEXT, consent_hash TEXT, event_hash TEXT, file_id TEXT, record_tries INTEGER, record_claim_at TEXT)`,
  // Which reminders each action item has had (./_board-actions.js)
  'CREATE TABLE IF NOT EXISTS board_action_reminders (action_id TEXT NOT NULL, stage TEXT NOT NULL, at TEXT, PRIMARY KEY (action_id, stage))',
  // Each write of a meeting or a practice meeting, its last few (keepSave): what a person edits as it was left, and who
  'CREATE TABLE IF NOT EXISTS board_saves (record TEXT NOT NULL, at TEXT NOT NULL, was TEXT, by TEXT, data TEXT, PRIMARY KEY (record, at))',
];
const _ready = new WeakSet();
export async function ensureSchema(DB) {
  if (_ready.has(DB)) return;
  for (const s of SCHEMA) await DB.prepare(s).run();
  // How a signature came (SIGNED_BY), its copy, who added it, which wording (cleanDoc version), and its evidence
  // (./_board-sign.js SIG_EVIDENCE), the same in both signature tables
  const sig = { how: 'TEXT', file_id: 'TEXT', drive_id: 'TEXT', drive_name: 'TEXT', added_by: 'TEXT', version: 'INTEGER', ...SIG_EVIDENCE };
  await addColumns(DB, 'board_signatures', sig);
  await addColumns(DB, 'board_signatures_earlier', sig);
  // What a wording was (words read from a file, a new file), and its SHA-256
  await addColumns(DB, 'board_doc_versions', { note: 'TEXT', hash: 'TEXT', file_id: 'TEXT' });
  // A paper's PDF's words (for finding it by them; and every meeting file's, read by the reader words_v names,
  // a scan's page to go on from and its pages so far, who's reading it, when it was last read, the reader that gave up on it: ./_board-file-words.js); whose a signed copy or record is (`slug`: access never rests on
  // the signature row); its SHA-256; when it stopped counting (never deleted); an iPhone photo's original
  await addColumns(DB, 'board_files', { words: 'TEXT', words_v: 'INTEGER', words_next: 'INTEGER', words_try: 'INTEGER', words_at: 'TEXT', words_fail: 'INTEGER', words_part: 'TEXT', slug: 'TEXT', sha256: 'TEXT', superseded_at: 'TEXT', original_id: 'TEXT' });
  // How many of a member's asks this year Remind by email sent itself (at most MAX_REMINDERS)
  await addColumns(DB, 'board_sign_asks', { reminders: 'INTEGER' });
  // The start of a member's visit before this one (portalData's lastSeen), kept beside this visit's start (`at`), and
  // their last look in this one (`last`: a visit lasts until VISIT_GAP_MS goes by without one, ./keepVisit)
  await addColumns(DB, 'board_seen', { prev: 'TEXT', last: 'TEXT' });
  // (copies from before `slug`: whose each is, from the signature it was added for)
  await DB.prepare("UPDATE board_files SET slug = COALESCE((SELECT slug FROM board_signatures WHERE file_id = board_files.id), (SELECT slug FROM board_signatures_earlier WHERE file_id = board_files.id)) WHERE owner_type = 'signed' AND slug IS NULL").run().catch(() => {});
  _ready.add(DB);
}

const nowIso = () => new Date().toISOString();
const parse = (s, fallback = {}) => { try { return JSON.parse(s || '') ?? fallback; } catch { return fallback; } };
export const ID = /^[a-z0-9_]{3,40}$/i;

// ─── Settings ───────────────────────────────────────────────────────

export const DEFAULT_SETTINGS = Object.freeze({ quorum: 0, defaults: { start: '08:00', end: '10:00', location: '', address: '', video: '' }, template: DEFAULT_TEMPLATE });

/**
 * The agenda template with an id on every part and item, the same in every tab that opens it, so two tabs' changes to it
 * merge item by item (public/admin/board-meeting.js AgendaTemplate). One saved before the template kept them, and the
 * default, are numbered by place. A meeting made from it gets ids of its own (board-shared.js templateAgenda)
 */
const templateIds = (t) => t.map((s, si) => ({ ...s, id: ID.test(String(s?.id || '')) ? String(s.id) : `s_tpl${si}`,
  items: (s?.items || []).map((it, ii) => ({ ...it, id: ID.test(String(it?.id || '')) ? String(it.id) : `i_tpl${si}_${ii}` })) }));
const templateOf = (s) => templateIds(Array.isArray(s.template) && s.template.length ? s.template : DEFAULT_TEMPLATE);

/** Settings with every default filled in, and who can open the Board area */
export async function getSettings(DB) {
  const s = await readSettings(DB);
  return {
    quorum: Number(s.quorum) > 0 ? Math.round(s.quorum) : 0,
    defaults: { ...DEFAULT_SETTINGS.defaults, ...(s.defaults || {}) },
    template: templateOf(s),
    // When the template was last saved, and by whom: an editor's save of it goes over only the one it opened (saveSettings)
    templateAt: String(s.templateAt || ''),
    templateBy: String(s.templateBy || ''),
    admins: await boardAdmins(DB, s),
    adminsSaved: Array.isArray(s.admins) && s.admins.length > 0,
    invitesFrom: await (await import('./_board-invite.js')).organizerFor(DB),
    // Emails asking presenters for their reports (./_board-asks.js): 'test' (to the asker alone) until switched 'on'; or 'off'
    asks: ['on', 'off'].includes(s.asks) ? s.asks : 'test',
    // Remind by email (Board → Members): those who haven't signed this year's papers asked again by themselves, every
    // 3 days or weekly; off until an admin turns it on (./_board-sign.js maybeRemindSigners)
    remind: ['3', '7'].includes(String(s.remind)) ? String(s.remind) : 'off',
    // Action item reminders by email: off until an admin turns it on (./_board-actions.js)
    actionRemind: s.actionRemind === 'on' ? 'on' : 'off',
    // What SOARD keeps for running itself; what's over it can go to makeovers (Peter, Nov 4 2026: $500K, "its arbitrary")
    operatingBalance: Number(s.operatingBalance) > 0 ? Math.round(Number(s.operatingBalance)) : OPERATING_BALANCE,
  };
}

const SETTINGS_KEPT_CHANGING = 'The settings kept changing while they were saved. Nothing was lost: try again.';
/**
 * Save Settings (admins, quorum, meeting defaults, the agenda template). Keeps at least the person saving as an admin.
 * Written only over the settings it was made from, as a meeting is (writeOver): two saves at once (a quorum here, the
 * template in another tab) never drop either one, each is made again from what's there now. The template keeps when it
 * was saved and by whom: a save of it from an editor (`base`, the templateAt it opened) that someone saved since is
 * refused, 409 with theirs (`current`: { template, at, by }) to merge, as a meeting's is
 */
export async function saveSettings(DB, patch, by, { base = null } = {}) {
  // (who presents, at the address their person has now: addressesNow, renames since the template the page opened too)
  const template = Array.isArray(patch.template);
  const stored = template && base ? { sections: templateOf(await readSettings(DB)) } : null;
  const moved = template ? await addressesNow(DB, addressesIn({ sections: patch.template }), { since: base || '', moved: (slug) => !!stored && namesIn(stored, slug) }) : {};
  const mine = Object.keys(moved).length ? { ...patch, template: followAddresses({ sections: patch.template }, moved, { people: await namesNow(DB) }).sections } : patch;
  // (saved meanwhile: the page merges with theirs, and follows the same renames in what it has first)
  await withMoves(writeSettings(DB, (s) => settingsAfter(s, mine, by, base)), moved, DB, base || '', (cur) => ({ sections: cur.template }));
  const out = await getSettings(DB);
  return Object.keys(moved).length ? { ...out, addressesNow: moved } : out;
}
/** Who presents as People has them now, for a presenter line written again with who presents (followAddresses). A read that fails throws: the save is refused in words, never a presenter line written from nobody (round 10) */
const namesNow = (DB) => roster(DB).then((r) => [...r.board, ...r.staff]);
/**
 * A save's 409 (saved meanwhile) carrying the renames the page has to follow (`addressesNow`): those this save followed,
 * and those that moved the record since the copy it opened (`base`), so the page's merge follows them in that copy too
 */
const withMoves = (going, moved, DB, base, of = (cur) => cur) => going.catch(async (e) => {
  if (e?.status === 409 && e.current) {
    const all = { ...(await renamedInto(DB, of(e.current), base).catch(() => ({}))), ...moved };
    if (Object.keys(all).length) e.extra = { ...(e.extra || {}), addressesNow: all };
  }
  throw e;
});

/**
 * Where each address a save names is now, when nobody on People has it but its person was renamed to one somebody has
 * ({ old: new }): a save never brings back an address its person has left, whatever page sent it (one whose list of
 * people was read before the rename, a merge that kept a page's own change). Every rename made on People is in the audit
 * log (rename-content.js writes one for each, and nothing is ever taken out of it); the signing chain's 'renamed' events
 * (only for people with signing records) are read too, and so is a rename still finishing (its note, rename-finish:<from>,
 * written in the rename's own batch: Board QA round 9, a save landing between the rename and its audit entry kept the
 * old address). The latest rename from an address wins, followed while its new address is gone as well. One nobody has
 * and nobody was renamed from stays as it is. Coordinator, Board QA round 8
 * `since`: the save's base (when what it edits was last saved, as the page read it). An address in a save means the
 * person who had it when the page read what it's editing, so a rename made since then is followed even when someone new
 * has the old address now (Board QA round 9: a newcomer given a renamed member's old address became the template's
 * presenter), as long as the rename moved that very record (`moved(to)`: it names the new address now): a record the
 * rename never touched had no address of theirs to bring back, so a newcomer picked there is the newcomer.
 * Every read here decides what an address becomes: one that fails throws readDown(PEOPLE_DOWN), a 503 (round 9)
 */
export async function addressesNow(DB, slugs, { since = '', moved = null } = {}) {
  const want = [...new Set((slugs || []).filter((x) => typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x)))];
  if (!want.length) return {};
  // (a table not made yet keeps nothing; any other failure is said, never taken for "no rename")
  const sure = (e) => { if (/no such table/i.test(e?.message || '')) return null; console.error('[board] addresses now', e?.message || e); throw readDown(PEOPLE_DOWN, e); };
  const rows = async (st) => (await st.all().catch(sure))?.results || [];
  const people = new Set((await rows(DB.prepare('SELECT slug FROM team'))).map((r) => r.slug));
  const gone = want.filter((x) => !people.has(x));
  const base = typeof since === 'string' && /^\d{4}-\d\d-\d\dT/.test(since) ? since : '';
  if (!gone.length && !base) return {};
  const moves = await renameMoves(DB);
  // (in the order they happened: the audit log's by its own order, a second being all its clock tells)
  const after = (a, b) => (a.id && b.id ? a.id > b.id : a.at > b.at);
  const latest = new Map();
  for (const x of moves.sort((a, b) => (after(a, b) ? 1 : after(b, a) ? -1 : 0))) latest.set(x.from, x);
  // (an address someone else had after its person left it, renamed into it or added at it and gone since, is never
  // followed to the one who left it: it may be the other person's)
  const since2 = async (slug, x) => moves.some((y) => y.to === slug && after(y, x))
    || !!(await (x.id
      ? DB.prepare("SELECT 1 AS y FROM audit_log WHERE entity_type = 'team' AND entity_slug = ? AND id > ? LIMIT 1").bind(slug, x.id)
      : DB.prepare("SELECT 1 AS y FROM audit_log WHERE entity_type = 'team' AND entity_slug = ? AND replace(created_at, ' ', 'T') > ? LIMIT 1").bind(slug, x.at)).first().catch(sure));
  const out = {};
  for (const old of want) {
    let at = old;
    let ok = true;
    let last = null;
    for (let i = 0; i < 10 && ok && latest.has(at); i++) {
      const x = latest.get(at);
      // (each step after the one before: a rename and its undo never go round in a circle)
      if (last && !after(x, last)) break;
      // Renamed since the page read it, from a record the rename moved: theirs, whoever has the old address now
      const fresh = !!base && x.at > base && (!moved || moved(x.to) || moved(finalOf(latest, x)));
      if (people.has(at) && !fresh) break;
      if (!fresh && await since2(at, x)) ok = false;
      else { at = x.to; last = x; }
    }
    if (ok && at !== old && people.has(at)) out[old] = at;
  }
  return out;
}
/**
 * Every rename People has made, as the audit log, the signing chain and a rename still finishing (its note) say:
 * [{ from, to, at, id? }]. A read that fails throws readDown(PEOPLE_DOWN); a table not made yet has none
 */
async function renameMoves(DB) {
  const sure = (e) => { if (/no such table/i.test(e?.message || '')) return null; console.error('[board] renames', e?.message || e); throw readDown(PEOPLE_DOWN, e); };
  const rows = async (st) => (await st.all().catch(sure))?.results || [];
  const moves = [];
  for (const r of await rows(DB.prepare("SELECT id, changes, created_at FROM audit_log WHERE entity_type = 'team' AND instr(changes, ?) > 0 ORDER BY id").bind('"field":"slug"'))) {
    let list = [];
    try { list = JSON.parse(r.changes || '[]'); } catch { /* not ours */ }
    // (its moment: the rename's own, kept with it since round 9; else the audit log's, to the second, read as its start)
    for (const c of Array.isArray(list) ? list : []) if (c?.field === 'slug' && c.from && c.to) moves.push({ from: String(c.from), to: String(c.to), at: typeof c.at === 'string' && c.at ? c.at : `${String(r.created_at || '').replace(' ', 'T')}.000Z`, id: Number(r.id) });
  }
  for (const r of await rows(DB.prepare("SELECT slug, detail FROM board_sign_events WHERE kind = 'renamed' ORDER BY seq"))) {
    try { const d = JSON.parse(r.detail || '{}'); if (d?.from) moves.push({ from: String(d.from), to: String(r.slug), at: String(d.at || '') }); } catch { /* not ours */ }
  }
  for (const r of await rows(DB.prepare("SELECT data FROM board_state WHERE key >= 'rename-finish:' AND key < 'rename-finish;'"))) {
    try { const d = JSON.parse(r.data || '{}'); if (d?.from && d?.to && !d.stuck) moves.push({ from: String(d.from), to: String(d.to), at: String(d.at || '') }); } catch { /* not ours */ }
  }
  return moves;
}
/**
 * The renames made since `since` that moved this record (it names their new address now): { old: new }. A save that met
 * a 409 is told them, so the page follows them in the copy it opened as well as in what it has now, and its merge never
 * asks about a rename or brings back an address (Board QA round 9: a page that had followed Sam by his name was asked
 * "You both changed Financial" because the copy it opened still had his old address)
 */
async function renamedInto(DB, record, since) {
  if (!record || typeof since !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(since)) return {};
  const out = {};
  for (const x of (await renameMoves(DB)).filter((y) => y.at > since)) if (namesIn(record, x.to) && !namesIn(record, x.from)) out[x.from] = x.to;
  return out;
}
/** Where a rename's chain ends (its last step's new address), for whether the record names it */
function finalOf(latest, x) {
  let at = x.to;
  let last = x;
  for (let i = 0; i < 10 && latest.has(at); i++) { const y = latest.get(at); if (!(y.id && last.id ? y.id > last.id : y.at > last.at)) break; at = y.to; last = y; }
  return at;
}
/**
 * The settings row written only over the copy it was made from: `make(s)` → the settings to write, made again from
 * what's there now each time someone saved meanwhile, or null when there's nothing to write. → whether it wrote
 */
async function writeSettings(DB, make) {
  // (the table, made the first time)
  await readSettings(DB);
  for (let i = 0; i < 5; i++) {
    const row = await DB.prepare("SELECT data FROM board_state WHERE key = 'settings'").first();
    const next = make(parse(row?.data, {}));
    if (next === null) return false;
    const json = JSON.stringify(next);
    const r = row
      ? await DB.prepare("UPDATE board_state SET data = ?, updated_at = ? WHERE key = 'settings' AND data = ?").bind(json, nowIso(), row.data).run()
      : await DB.prepare("INSERT OR IGNORE INTO board_state (key, data, updated_at) VALUES ('settings', ?, ?)").bind(json, nowIso()).run();
    if ((r?.meta?.changes ?? r?.changes ?? 0) > 0) return true;
    // Saved meanwhile: made again from what's there now
  }
  throw Object.assign(new Error(SETTINGS_KEPT_CHANGING), { status: 409 });
}
/**
 * A change to the agenda template that no editor made (a rename on People moving who presents, ./_board-rename.js) is
 * a save of it like any other: written over the settings as they are (a founder's save meanwhile stays, Who runs Board
 * included), its time moved on and `by` saying who made it. So an editor open on the template from before meets the 409
 * and merges item by item (public/admin/board-meeting.js AgendaTemplate), keeping this change wherever the page didn't
 * change that item, never writing the template it opened back over it (Board QA round 8, Nov 21 2026: the founder's open
 * template page put a renamed member's old address back, and the meetings on the template followed it).
 * `change(template)` → the template changed (null: nothing to change). → whether it wrote
 */
export async function changeTemplate(DB, change, by) {
  return writeSettings(DB, (s) => {
    if (!Array.isArray(s.template)) return null;
    const template = change(s.template);
    if (!template || JSON.stringify(template) === JSON.stringify(s.template)) return null;
    return templateSaved({ ...s, template }, s, by);
  });
}
/**
 * The template's save, kept with it: when and by whom (templateAt, templateBy), and the last SAVES_KEPT saves of it
 * (templateSaves: each as it was left, by whom, over which), for a 409's question to name everyone whose save changed what
 * clashes, never only the last to save (keepSave says why). Board QA round 10
 */
function templateSaved(next, s, by) {
  const at = stampAfter(s.templateAt);
  const saves = [...(Array.isArray(s.templateSaves) ? s.templateSaves : []), { at, was: String(s.templateAt || ''), by: by || '', data: templateIds(next.template) }];
  return { ...next, templateAt: at, templateBy: by || '', templateSaves: saves.slice(-SAVES_KEPT) };
}
/** The settings `s` with a save's changes on them (saveSettings) */
function settingsAfter(s, patch, by, base) {
  const next = { ...s };
  if (Array.isArray(patch.admins)) {
    const list = [...new Set(patch.admins.map(normEmail).filter((e) => /^[^\s@]+@soardcharity\.com$/.test(e)))];
    if (!list.includes(normEmail(by))) list.unshift(normEmail(by));
    next.admins = list.slice(0, 10);
  }
  if (patch.invitesFrom !== undefined) next.invitesFrom = normEmail(patch.invitesFrom);
  if (patch.asks !== undefined) next.asks = ['on', 'off', 'test'].includes(patch.asks) ? patch.asks : 'test';
  if (patch.remind !== undefined) next.remind = ['3', '7'].includes(String(patch.remind)) ? String(patch.remind) : 'off';
  if (patch.actionRemind !== undefined) next.actionRemind = patch.actionRemind === 'on' ? 'on' : 'off';
  if (patch.quorum !== undefined) next.quorum = Math.max(0, Math.min(50, Math.round(Number(patch.quorum) || 0)));
  if (patch.operatingBalance !== undefined) {
    const v = Math.round(Number(String(patch.operatingBalance).replace(/[$,\s]/g, '')));
    if (!Number.isFinite(v) || v < 0 || v > 100_000_000) throw Object.assign(new Error('The operating balance is dollars, from $0 to $100,000,000'), { status: 400 });
    next.operatingBalance = v;
  }
  if (patch.defaults) {
    const clean = cleanMeeting({ ...patch.defaults, date: '2026-01-01' });
    next.defaults = { start: clean.start, end: clean.end, location: clean.location, address: clean.address, video: clean.video };
  }
  if (Array.isArray(patch.template)) {
    if (base !== null && String(s.templateAt || '') !== base) {
      throw Object.assign(new Error(`${s.templateBy || 'Someone'} saved the agenda template since you opened it`), { status: 409, current: { template: templateOf(s), at: String(s.templateAt || ''), by: String(s.templateBy || '') }, extra: savesChain(s.templateSaves, base, String(s.templateAt || '')) });
    }
    // Everything its editor sets, as typed, a part or item not named yet too (work in progress: a meeting made from it
    // leaves those out, board-shared.js namedTemplate). Each part and item keeps its id, so the next tab's change to it
    // is known as a change to it
    return templateSaved({ ...next, template: cleanTemplate(patch.template) }, s, by);
  }
  return next;
}

// ─── People, as the board page shows them ───────────────────────────

/**
 * The board, staff and Advisory Board for the board page and the admin's pickers. A read that fails throws (./_board-roles.js:
 * never an empty board, nor members with no email); `sure: false` reads it as nobody
 */
export async function roster(DB, { withEmails = false, sure = true } = {}) {
  const [people, emails] = await Promise.all([peopleRows(DB, { sure }), withEmails ? privateEmails(DB, { sure }) : {}]);
  const card = (p) => ({
    slug: p.slug, name: p.name, title: p.title || '', seat: p.seat || '', organization: p.organization || '',
    committees: Array.isArray(p.committees) ? p.committees : [], photo: p.photo ? photoUrl(p, 160) : '', since: p.since || null,
    ...(withEmails ? { email: emails[p.slug] || null } : {}),
  });
  const active = people.filter((p) => p.status === 'active' && !p.draft).sort(comparePeople);
  return {
    board: active.filter((p) => p.group === 'board').map(card),
    staff: active.filter((p) => p.group !== 'board' && p.group !== 'advisory' && p.role !== 'honorary').map(card),
    advisory: active.filter((p) => p.group === 'advisory').map(card),
  };
}

// ─── Meetings ───────────────────────────────────────────────────────

export async function filesOf(DB, type, ids = null) {
  const rows = (await DB.prepare('SELECT * FROM board_files WHERE owner_type = ? ORDER BY at').bind(type).all()).results || [];
  const by = {};
  for (const r of rows) {
    if (ids && !ids.includes(r.owner_id)) continue;
    (by[r.owner_id] ||= []).push({ id: r.id, name: r.name, type: r.type, size: r.size || 0, kind: r.kind || 'other', staffOnly: !!r.staff_only, at: r.at });
  }
  return by;
}

/**
 * A meeting still ahead: not held (./board-shared.js meetingHeld, the one rule: its day gone by, the chair ended it, or
 * on its day its minutes in or its end time passed), not under way, a board meeting and not a practice. Its list of
 * who's on the board follows People → Board (withState, maybeKeepRolls), as its invite does (./_board-invite.js
 * maybeFollowBoard). One held this morning keeps the board it was held with, whatever People says by the afternoon
 * (Board QA round 5, Nov 21 2026)
 */
const stillAhead = (m, now = Date.now()) => isDate(m.date) && !meetingHeld(m, now) && !m.notBoard && !m.practice && !m.live?.startedAt;

/**
 * Meetings with what lives beside them: their files and each action's done state. Who's coming is the calendar
 * invite's (repliesOf): answers once given on the board page or by email (board_rsvps) never show again.
 * A meeting still ahead lists the board as People → Board has it now (./_board-invite.js followRoll): someone who joined
 * is on it and someone who left is off it, for Who's coming, the quorum, the roll call and the minutes template alike, as
 * the invite and the emails already go by, not as it was when the meeting was made. A meeting held keeps its record as
 * it was. (People reading empty is taken for a bad read, as the invites take it: the list is left as it is)
 */
async function withState(DB, meetings) {
  if (!meetings.length) return [];
  const now = Date.now();
  const [files, done, board, reminded] = await Promise.all([
    filesOf(DB, 'meeting'),
    DB.prepare('SELECT * FROM board_action_state').all().then((r) => Object.fromEntries((r.results || []).map((x) => [x.action_id, x]))),
    // not sure: a meeting's roll follows People only when People is read; one that fails leaves every roll as it was
    // stored (read-only here, and nothing is taken off: rollOf keeps m.attendance), or every meeting read would fail with it
    meetings.some((m) => stillAhead(m, now)) ? activeBoard(DB, { sure: false }) : [],
    remindedOf(DB, meetings.map((m) => m.id)),
  ]);
  const { followRoll } = board.length ? await import('./_board-invite.js') : {};
  const rollOf = (m) => (board.length && stillAhead(m, now) ? followRoll(m.attendance, board) || m.attendance : m.attendance);
  return meetings.map((m) => {
    const c = cleanMeeting({
      ...m,
      files: files[m.id] || [],
      actions: m.actions.map((a) => (done[a.id] ? { ...a, done: !!done[a.id].done, doneOn: done[a.id].done_on || '' } : { ...a, done: false, doneOn: '' })),
      attendance: rollOf(m).map((p) => ({ ...p, rsvp: '' })),
    });
    return reminded[m.id] ? { ...c, reminded: reminded[m.id] } : c;
  });
}

/**
 * Who each meeting's reminder to answer the invite went to, and when (Who's coming → Ask the ones who haven't answered),
 * as the send itself keeps it (sendOnce's record, board-send:remind:<id>): { meetingId: { slug: when } }. That record is
 * the one record of it, read by every tab at the press and after a reload, as Email the board's and the minutes email's
 * are; never kept on the meeting (stored leaves it off) nor shown on the board page (forBoard). Board QA round 8, Nov 21
 * 2026: "Asked … just now" lived only in the tab that sent it, so a second tab asked the first-time question 11 minutes
 * on and the whole board was asked twice
 */
async function remindedOf(DB, ids) {
  const want = new Set(ids);
  const prefix = 'board-send:remind:';
  const rows = ((await DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'board-send:remind:%'").all().catch(() => null))?.results || [])
    .map((r) => [r.key.slice(prefix.length), parse(r.data)]).filter(([id, d]) => want.has(id) && d?.had && Object.keys(d.had).length);
  if (!rows.length) return {};
  // (by email, as it went: each to the board member at that address now)
  const slugAt = new Map(Object.entries(await privateEmails(DB)).map(([slug, e]) => [normEmail(e), slug]));
  const out = {};
  for (const [id, d] of rows) {
    const who = Object.fromEntries(Object.entries(d.had).map(([e, at]) => [slugAt.get(normEmail(e)), String(at || '')]).filter(([slug, at]) => slug && Number.isFinite(Date.parse(at))));
    if (Object.keys(who).length) out[id] = who;
  }
  return out;
}

/** Every meeting, newest first, with its files, done states and answers. Practice meetings only when asked ({ practice: true }) */
export async function listMeetings(DB, { practice = false } = {}) {
  await ensureSchema(DB);
  const rows = (await DB.prepare('SELECT data FROM board_meetings ORDER BY date DESC').all()).results || [];
  const more = practice ? (await DB.prepare('SELECT data FROM board_practice ORDER BY date DESC').all()).results || [] : [];
  return withState(DB, [...rows, ...more].map((r) => cleanMeeting(parse(r.data))));
}

export async function getMeeting(DB, id) {
  await ensureSchema(DB);
  const row = await DB.prepare('SELECT data FROM board_meetings WHERE id = ?').bind(id).first();
  return row ? (await withState(DB, [cleanMeeting(parse(row.data))]))[0] : null;
}

/** The agenda as a person writes it (sections, items, who presents, notes, board-only marks, its documents), to tell when someone changed it */
const agendaSkeleton = (m) => JSON.stringify((m.sections || []).map((s) => [s.title, s.minutes || 0, s.items.map((it) => [it.title, it.presenter, it.who, it.notes, it.staffNote, it.confidential, it.docs])]));

const stored = (m) => {
  // Files, done states and answers live in their own tables, and who was reminded in the reminder's own record (remindedOf)
  // (addressesNow: a save's answer only)
  const { files, reminded, addressesNow: _, ...rest } = m;
  return JSON.stringify({ ...rest, actions: rest.actions.map(({ done, doneOn, ...a }) => a), attendance: rest.attendance.map(({ rsvp, ...p }) => p) });
};
/**
 * A meeting written only over the copy it was made from: `was` is the updatedAt read (null: a new meeting, written only
 * if there's none with its id). Anything written in between (an editor's save, a send's record, the calendar's answers)
 * is never written over: nothing is written, and it says so. Each write is kept in the meeting's save history (keepSave:
 * `prev`, the meeting it went over, so a write that changed nothing a person edits keeps nothing to compare; named as
 * the meeting names who saved it last). → whether it was written
 */
async function writeOver(DB, m, was, { prev = null } = {}) {
  // Practice meetings live in their own table (see SCHEMA): getMeeting, and every action built on it, never finds one
  const table = m.practice ? 'board_practice' : 'board_meetings';
  const r = was === null
    ? await DB.prepare(`INSERT OR IGNORE INTO ${table} (id, date, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`).bind(m.id, m.date || '', stored(m), m.updatedAt, m.updatedBy || '').run()
    : await DB.prepare(`UPDATE ${table} SET date = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND COALESCE(updated_at, '') = ?`).bind(m.date || '', stored(m), m.updatedAt, m.updatedBy || '', m.id, was || '').run();
  const wrote = (r?.meta?.changes ?? r?.changes ?? 0) > 0;
  if (wrote) await keepSave(DB, `${table}:${m.id}`, { at: m.updatedAt, was: was || '', by: m.updatedBy, data: editedOf(m), prev: prev && editedOf(prev) });
  return wrote;
}

/**
 * Each write of a meeting, a practice meeting and the agenda template, kept (the last SAVES_KEPT of each, a month at
 * most): what a person edits as it was left (`data`, none when the write didn't change it), who made it and over which
 * write (`was`). So a page whose save meets one made meanwhile is told everyone whose save changed what clashes, save by
 * save (public/admin/board-meeting.js clashWho), never only whoever saved last. Board QA round 10, Nov 22 2026: the
 * agenda template's question named a rename on People that had only moved an address, for a change the founder made in
 * another tab, and Keep mine dropped it. Never in the way of the write itself: one that can't be kept leaves the question
 * naming everyone who saved since
 */
const SAVES_KEPT = 30;
const EDITED = ['date', 'start', 'end', 'title', 'location', 'address', 'inviteNote', 'video', 'shared', 'noSince', 'minutes', 'approvedOn', 'attendance', 'sections', 'motions', 'actions'];
/** What a person edits on a meeting, as one string to keep and compare (as mergeMeeting goes by: never an answer or a tick) */
const editedOf = (m) => {
  const c = cleanMeeting(m);
  return JSON.stringify(Object.fromEntries(EDITED.map((k) => [k, k === 'attendance' ? c.attendance.map(({ rsvp, ...p }) => p) : k === 'actions' ? c.actions.map(({ done, doneOn, ...a }) => a) : c[k]])));
};
async function keepSave(DB, record, { at, was, by, data, prev }) {
  try {
    await DB.batch([
      DB.prepare('INSERT OR REPLACE INTO board_saves (record, at, was, by, data) VALUES (?, ?, ?, ?, ?)').bind(record, at, was || '', by || '', prev === data ? null : data),
      DB.prepare('DELETE FROM board_saves WHERE record = ? AND at < (SELECT at FROM board_saves WHERE record = ? ORDER BY at DESC LIMIT 1 OFFSET ?)').bind(record, record, SAVES_KEPT - 1),
      DB.prepare('DELETE FROM board_saves WHERE at < ?').bind(new Date(Date.now() - 31 * 86400000).toISOString()),
    ]);
  } catch (err) { console.error('[board] save history', err?.message || err); }
}
/**
 * The saves since a page's copy (`base`) up to the one it meets (`at`), as a 409 tells the page: `saves`, each in turn
 * ({ at, by, data: what it left, null when unchanged }), when every one is known; null when one isn't (kept before the
 * history began, or since cleared), and then `savers`, everyone who saved since, for the page to name them all
 */
export function savesChain(rows, base, at) {
  const list = (rows || []).filter((r) => String(r.at || '') > String(base || '') && String(r.at || '') <= String(at || '')).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const savers = [...new Set(list.map((r) => String(r.by || '')))];
  let link = String(base || '');
  for (const r of list) { if (String(r.was || '') !== link) return { saves: null, savers }; link = String(r.at); }
  return { saves: list.length && link === String(at || '') ? list.map((r) => ({ at: String(r.at), by: String(r.by || ''), data: r.data == null ? null : typeof r.data === 'string' ? parse(r.data, null) : r.data })) : null, savers };
}
/** A meeting's saves since `base` (savesChain), for its 409 (more than a page should be sent: everyone who saved, by name) */
async function savesSince(DB, record, base, at) {
  const rows = (await DB.prepare('SELECT at, was, by, data FROM board_saves WHERE record = ? AND at > ?').bind(record, String(base || '')).all().catch(() => null))?.results || [];
  if (rows.reduce((n, r) => n + String(r.data || '').length, 0) > 2_000_000) return { saves: null, savers: [...new Set(rows.filter((r) => String(r.at) <= String(at || '')).map((r) => String(r.by || '')))] };
  return savesChain(rows, base, at);
}
/**
 * A meeting's next updatedAt: now, or a millisecond after the last one when that's now or later (two writes in the same
 * millisecond, a clock behind), so every write has a time of its own and an editor holding the last one always hears
 * of the next
 */
const stampAfter = (prev) => {
  const was = Date.parse(prev || '');
  return new Date(Number.isFinite(was) && was >= Date.now() ? was + 1 : Date.now()).toISOString();
};
const KEPT_CHANGING = 'The meeting kept changing while it was saved. Nothing was lost: try again.';
/** What an editor is told when the meeting it has open was deleted (in another tab, by the other admin) */
export const MEETING_DELETED = 'This meeting was deleted, maybe in another tab. Nothing here was saved, and it stays deleted.';

/** A practice meeting by id (null for a board meeting: those are getMeeting's) */
export async function getPractice(DB, id) {
  await ensureSchema(DB);
  const row = await DB.prepare('SELECT data FROM board_practice WHERE id = ?').bind(id).first();
  if (!row) return null;
  const raw = parse(row.data);
  const [m] = await withState(DB, [cleanMeeting({ ...raw, practice: true })]);
  // The documents it borrows from board meetings (createPractice), as they are now: one deleted or made staff-only
  // since drops out. null: made before practice meetings borrowed any (createPractice makes a new one)
  const borrowed = Array.isArray(raw.borrowed) ? raw.borrowed.filter((x) => ID.test(String(x))) : null;
  const all = borrowed?.length ? Object.values(await filesOf(DB, 'meeting')).flat() : [];
  const files = (borrowed || []).map((x) => all.find((f) => f.id === x)).filter((f) => f && !f.staffOnly);
  return { ...m, files: [...m.files, ...files], borrowed, docsFrom: isDate(raw.docsFrom) ? raw.docsFrom : '' };
}
/** Today's practice meeting, if one's been started */
export async function todayPractice(DB, now = Date.now()) {
  await ensureSchema(DB);
  const row = await DB.prepare('SELECT id FROM board_practice WHERE date = ? ORDER BY updated_at DESC LIMIT 1').bind(todayEastern(now)).first();
  return row ? getPractice(DB, row.id) : null;
}

/**
 * Server-set fields (the invite, its Meet link, the replies to it) onto the
 * meeting as it's stored now, so a save made while Google was answering is
 * kept: written only if no one saved in between, else read again and redone.
 * A newer updatedAt, so a copy open in an editor merges (`by`: the person, when one made the change). → the meeting
 */
export async function patchMeeting(DB, id, fn, { by = '' } = {}) {
  for (let i = 0; i < 5; i++) {
    const cur = await getMeeting(DB, id);
    if (!cur) return null;
    const out = fn(cur);
    // (which file approved minutes are: the server's, never the function's copy. Board QA round 10)
    const next = { ...out, id, practice: false, approvedFile: approvedFileAfter(cur, out), updatedAt: stampAfter(cur.updatedAt), updatedBy: by || cur.updatedBy || '' };
    if (await writeOver(DB, next, cur.updatedAt || '', { prev: cur })) return getMeeting(DB, id);
  }
  throw new Error(KEPT_CHANGING);
}

/**
 * Fields only the server sets (a send's record, the invite, the approval's share), written onto the meeting as it is
 * now in one statement: nothing in between to be overtaken, so a record of something that went (the board's emails,
 * Google's invite) is never lost to edits saved meanwhile, however many come at once (patchMeeting reads, then writes,
 * and gives up after five tries of being overtaken). Its time after the last one (stampAfter, in SQL), so a copy open
 * in an editor merges. Only for fields whose value doesn't come from the meeting: anything worked out from it is
 * patchMeeting's. → the meeting, or null when it's gone (deleted meanwhile: nothing written)
 */
export async function setOnMeeting(DB, id, fields, { by = '' } = {}) {
  await ensureSchema(DB);
  const keys = Object.keys(fields).filter((k) => /^[a-zA-Z]+$/.test(k));
  const stamp = "COALESCE(CASE WHEN COALESCE(updated_at, '') < ? THEN ? ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') END, ?)";
  const now = nowIso();
  const sets = [...keys.map((k) => [`$.${k}`, JSON.stringify(fields[k] ?? null)]), ...(by ? [['$.updatedBy', JSON.stringify(by)]] : [])];
  // (kept in the meeting's save history as any write is, keepSave: over which write, at the same time, by whom; what a
  // person edits, after it, when one of these is. Never in the way of the write. Board QA round 10)
  const record = `board_meetings:${id}`;
  await DB.prepare(`INSERT OR REPLACE INTO board_saves (record, at, was, by, data) SELECT ?, ${stamp}, COALESCE(updated_at, ''), COALESCE(NULLIF(?, ''), updated_by, ''), NULL FROM board_meetings WHERE id = ?`)
    .bind(record, now, now, now, by, id).run().catch((err) => console.error('[board] save history', err?.message || err));
  const r = await DB.prepare(`UPDATE board_meetings SET data = json_set(data, ${sets.map(() => '?, json(?)').join(', ')}, '$.updatedAt', ${stamp}),
    updated_at = ${stamp}${by ? ', updated_by = ?' : ''} WHERE id = ?`)
    .bind(...sets.flat(), now, now, now, now, now, now, ...(by ? [by] : []), id).run();
  if (!((r?.meta?.changes ?? r?.changes ?? 0) > 0)) return null;
  const after = await getMeeting(DB, id);
  if (after && keys.some((k) => EDITED.includes(k))) await DB.prepare('UPDATE board_saves SET data = ? WHERE record = ? AND at = ?').bind(editedOf(after), record, after.updatedAt).run().catch(() => {});
  return after;
}

/**
 * Whether a meeting is kept off the board page as "not a board meeting" (notBoard) once a save is written. It's the
 * server's: the calendar's older rules set it, and Board has nothing that sets it. A save only ever clears it, when a
 * person shares the meeting (the tag says "Share it to put it back"); an editor's copy never puts it back, so a tab
 * that last read it before it was shared can't take a shared meeting off the board page again. A new meeting is as made
 */
export const notBoardAfter = (current, m) => (current ? !!current.notBoard && !(m.shared && !current.shared) : !!m.notBoard);

/**
 * Save a meeting from the admin. `base` is the updatedAt the editor loaded:
 * a meeting saved by someone else since then is refused (409, with theirs).
 * The packet's numbers and its sent record are the server's to set.
 * Written only over the copy it was made from (writeOver): anything saved in between (a send's record, a presenter's
 * report, the calendar) is never written over. With a base, the editor is told (409, with theirs, to merge); without
 * one (a new meeting, the server's own), it's made again from what's there now. A person's save (`edit`: Board's
 * save-meeting, with a base or without one: a request made by hand, a page from before bases) goes by the same rules
 * either way: a meeting that's gone is never a new one (404, `gone`: MEETING_DELETED), and minutes are marked approved
 * only when there are some (minutesNotReady)
 */
export async function saveMeeting(DB, raw, opts = {}) {
  // Its presenters, roll and to-dos at the addresses their people have now (addressesNow), and said (`addressesNow`) so
  // the page that sent it takes the same. With a base, a rename made since the copy the page opened is followed even
  // when someone new has the old address, where the rename moved this meeting (Board QA round 9: a practice meeting's
  // presenter became the newcomer)
  const base = typeof opts.base === 'string' ? opts.base : '';
  const id = cleanMeeting(raw).id;
  const stored = base && id ? (await getPractice(DB, id)) || (await getMeeting(DB, id)) : null;
  const moved = await addressesNow(DB, addressesIn(raw), { since: base, moved: (slug) => !!stored && namesIn(stored, slug) });
  if (!Object.keys(moved).length) return withMoves(saveMeetingAs(DB, raw, opts), moved, DB, base);
  const out = await withMoves(saveMeetingAs(DB, followAddresses(raw, moved, { people: await namesNow(DB) }), opts), moved, DB, base);
  return out ? { ...out, addressesNow: moved } : out;
}
async function saveMeetingAs(DB, raw, { by, base = null, edit = false } = {}) {
  const person = edit || base !== null;
  await ensureSchema(DB);
  // Practice is the server's to set: a meeting is one only if it was made as one (createPractice)
  const practice = await getPractice(DB, cleanMeeting(raw).id);
  if (practice) return savePractice(DB, practice, raw, { by, base });
  // A practice meeting started over (or cleared after a week) while an editor still had it open: never a new board meeting
  if (raw?.practice === true && !(await getMeeting(DB, cleanMeeting(raw).id))) throw Object.assign(new Error('That practice meeting is gone. Open Practice again for a new one.'), { status: 404, extra: { gone: true } });
  if (!cleanMeeting(raw).date) throw Object.assign(new Error('A meeting needs a date'), { status: 400 });
  let had = false;
  for (let i = 0; i < 5; i++) {
    // (made again each time: what's written goes from the editor's copy and what's there now, never an earlier try's)
    const m = { ...cleanMeeting(raw), practice: false };
    const current = await getMeeting(DB, m.id);
    // (one there a moment ago and gone now was deleted meanwhile: never made again, with a base or without; a person's
    // save is never a new meeting: new ones come from new-meeting and import-meeting)
    if (!current && (person || had)) throw Object.assign(new Error(MEETING_DELETED), { status: 404, extra: { gone: true } });
    had ||= !!current;
    // Saved by someone else since the copy it was made from: the editor is told, with theirs to merge, before anything
    // here is judged. What a save changes is judged against that copy, never the copy as a whole: a field the tab never
    // touched, that the site has changed since (taken off the board page in another tab, say), is theirs to merge, never
    // a refusal (QA round 4, Nov 21 2026: a stale tab's unchanged "shared" was refused, and it saved in a loop)
    if (current && base !== null && current.updatedAt && current.updatedAt !== base) {
      // (with every save since, for the question to name whoever changed what clashes: savesChain. Board QA round 10)
      throw Object.assign(new Error(`${current.updatedBy || 'Someone'} saved this meeting since you opened it`), { status: 409, current, extra: await savesSince(DB, `board_meetings:${m.id}`, base, current.updatedAt) });
    }
    const at = stampAfter(current?.updatedAt);
    // Marked approved from an editor (Mark them approved): only minutes there are, of a meeting held, as approve-minutes
    // goes by (minutesNotReady), never a tab left open on a meeting ahead. Refused by name (`refused`), with the meeting
    // as it is now (`meeting`), so the editor puts only that back, as the site has it, and the rest of the save goes
    // (judged by the minutes the site has, never a tab's copy of them: a tab opened before an Undo took them off can't
    // mark them approved. QA round 6, Nov 21 2026)
    if (current && person && m.minutes === 'approved' && current.minutes !== 'approved') {
      const why = minutesNotReady({ ...current, ...m, minutesFrom: current.minutesFrom, files: current.files });
      if (why) throw Object.assign(new Error(why), { status: 409, extra: { refused: ['minutes', 'approvedOn'], meeting: current } });
    }
    // Put on the board page by this save: only once its agenda is approved, for a meeting still to be held (holdShare)
    if (current && person) await holdShare(DB, current, m);
    const next = {
      ...m,
      notBoard: notBoardAfter(current, m),
      snapshot: current?.snapshot || null,
      packetSentAt: current?.packetSentAt || '',
      packetSentTo: current?.packetSentTo || 0,
      minutesSentAt: current?.minutesSentAt || '',
      invite: current?.invite || null,
      inviteGone: current?.inviteGone || '',
      // A meeting's day, time and place are typed in Board; a link to a calendar event older code made stays as it was
      calendar: current?.calendar || null,
      // Who joined by Meet is the server's (./_board-attendance.js). Where the agenda came from is named by
      // server code that fills it (board mail, the drafts); a person changing the agenda or its notes makes it theirs
      fromMeet: 'fromMeet' in raw ? m.fromMeet : current?.fromMeet || null,
      // Which minutes filled the meeting in is the minutes reader's (./_board-minutes.js), never a person's save: a tab's
      // copy from before an Undo can't put back the minutes Undo took off
      minutesFrom: !person && 'minutesFrom' in raw ? m.minutesFrom : current?.minutesFrom || null,
      agendaFrom: 'agendaFrom' in raw ? m.agendaFrom : !current ? null : agendaSkeleton(m) !== agendaSkeleton(current) ? { kind: 'typed', name: '', at } : current.agendaFrom,
      approvedOn: m.minutes === 'approved' ? (m.approvedOn || current?.approvedOn || todayEastern()) : '',
      // Which file approved minutes are is the server's, never a save's: the one the board was shown as they're approved,
      // and that one after (approvedFileAfter). Board QA round 10
      approvedFile: approvedFileAfter(current, m),
      createdAt: current?.createdAt || at,
      updatedAt: at,
      updatedBy: by || '',
    };
    await stampReports(DB, next, current, { by, at });
    if (await writeOver(DB, next, current ? current.updatedAt || '' : null, { prev: current })) return getMeeting(DB, m.id);
    // Written meanwhile (or made, or deleted): read again. An editor's (a base) is told, with theirs to merge
  }
  throw Object.assign(new Error(KEPT_CHANGING), { status: 409 });
}

/**
 * Who wrote each report when, set here, never by the editor: a report changed in this save is the admin's (by
 * name), one that didn't change keeps who wrote it (a presenter on the board page, ./saveReport)
 */
async function stampReports(DB, next, current, { by, at }) {
  const items = (current?.sections || []).flatMap((s) => s.items);
  const was = new Map(items.map((it) => [it.id, it]));
  // A copy of an item (its ⋯ Duplicate) is a new id with the same report: whoever wrote it still did
  const wrote = new Map(items.filter((it) => it.report).map((it) => [it.report, it]));
  let name = null;
  for (const it of next.sections.flatMap((s) => s.items)) {
    const before = was.get(it.id) || wrote.get(it.report);
    if ((it.report || '') === (before?.report || '')) {
      it.reportBy = before?.reportBy || (it.report ? it.reportBy : '');
      it.reportAt = before?.reportAt || (it.report ? it.reportAt : '');
      continue;
    }
    // The same words made points (How it shows, in Board): still its writer's, changed now (so a page open on it hears)
    if (it.report && before?.reportBy && sameWords(it.report, before.report)) {
      it.reportBy = before.reportBy;
      it.reportAt = at;
      continue;
    }
    if (it.report && name === null) name = (await adminVoter(DB, by)).name;
    it.reportBy = it.report ? name : '';
    it.reportAt = it.report ? at : '';
  }
}

/**
 * A practice meeting changed by the server (a rename on People moving who's on it, ./_board-rename.js), as patchMeeting
 * changes a board meeting: onto it as it's stored now, with a newer updatedAt, so a copy open in an editor meets the 409
 * and merges, never writing what it opened back over the change (Board QA round 8). → the meeting, or null when it's gone
 */
export async function patchPractice(DB, id, fn, { by = '' } = {}) {
  for (let i = 0; i < 5; i++) {
    const cur = await getPractice(DB, id);
    if (!cur) return null;
    const next = { ...fn(cur), id, date: cur.date, practice: true, borrowed: cur.borrowed, docsFrom: cur.docsFrom, updatedAt: stampAfter(cur.updatedAt), updatedBy: by || cur.updatedBy || '' };
    if (await writeOver(DB, next, cur.updatedAt || '', { prev: cur })) return getPractice(DB, id);
  }
  throw new Error(KEPT_CHANGING);
}

/**
 * A practice meeting saved from the chair's screen: what a person edits, never shared, never an invite or a packet.
 * Written only over the copy it was made from, as a board meeting is (saveMeeting)
 */
async function savePractice(DB, current, raw, { by, base = null } = {}) {
  const m = cleanMeeting(raw);
  for (let i = 0; i < 5; i++) {
    if (!current) throw Object.assign(new Error('That practice meeting is gone. Open Practice again for a new one.'), { status: 404, extra: { gone: true } });
    if (base !== null && current.updatedAt && current.updatedAt !== base) {
      throw Object.assign(new Error(`${current.updatedBy || 'Someone'} saved this meeting since you opened it`), { status: 409, current, extra: await savesSince(DB, `board_practice:${current.id}`, base, current.updatedAt) });
    }
    const next = {
      ...m, id: current.id, date: current.date, practice: true, shared: false, notBoard: false, calendar: null, invite: null, snapshot: null,
      packetSentAt: '', packetSentTo: 0, minutesSentAt: '', fromMeet: null, agendaFrom: current.agendaFrom,
      borrowed: current.borrowed || [], docsFrom: current.docsFrom,
      createdAt: current.createdAt, updatedAt: stampAfter(current.updatedAt), updatedBy: by || '',
    };
    if (await writeOver(DB, next, current.updatedAt || '', { prev: current })) return getPractice(DB, current.id);
    current = await getPractice(DB, current.id);
  }
  throw Object.assign(new Error(KEPT_CHANGING), { status: 409 });
}

/**
 * A new meeting from the agenda template, saved (not shared yet). Its time and place are the last meeting's (the one
 * before its day, else the next one), so the usual ones need no setting: a meeting moved somewhere new carries on there
 */
export async function createMeeting(env, { date, by, usual = false }) {
  await ensureSchema(env.DB);
  if (!isDate(date)) throw Object.assign(new Error('Pick the meeting’s date'), { status: 400 });
  const [settings, meetings, people] = await Promise.all([getSettings(env.DB), listMeetings(env.DB), roster(env.DB)]);
  const founders = people.staff.filter((p) => /founder/i.test(p.title));
  const real = meetings.filter((x) => !x.practice && !x.notBoard && isDate(x.date));
  const nearest = [...real.filter((x) => x.date <= date).sort((a, b) => b.date.localeCompare(a.date)), ...real.filter((x) => x.date > date).sort((a, b) => a.date.localeCompare(b.date))];
  const timed = nearest.find((x) => x.start && x.end);
  // A real place only: an older meeting's "place" that's a call (Teams, Zoom, a link) or TBD isn't one (Meet is the call)
  const placed = nearest.find((x) => x.location && !/\b(teams|zoom|webex|google meet|tbd|to be determined)\b|https?:\/\//i.test(`${x.location} ${x.address || ''}`));
  // `usual`: Board's usual time and no place yet (the year's meetings, ./_board-schedule.js), never one meeting's own
  const defaults = usual ? settings.defaults : { ...settings.defaults, ...(timed ? { start: timed.start, end: timed.end } : {}), ...(placed ? { location: placed.location, address: placed.address || '' } : {}) };
  const m = newMeeting({
    date, template: settings.template, meetings, defaults,
    board: people.board.map((p) => ({ slug: p.slug, name: p.name, org: p.organization })),
    staff: founders.map((p) => ({ slug: p.slug, name: p.name })),
  });
  return saveMeeting(env.DB, { ...m, video: settings.defaults.video }, { by });
}

/** A meeting brought in from an old agenda (see parseAgendaText), saved as approved minutes unless it's ahead */
export async function importMeeting(env, parsed, { by }) {
  const m = cleanMeeting({ agendaFrom: { kind: 'typed', name: '', at: nowIso() }, ...parsed, id: uid('m_'), minutes: parsed.date && parsed.date < todayEastern() ? 'approved' : 'draft', shared: false });
  return saveMeeting(env.DB, m, { by });
}

/**
 * A meeting and everything kept beside it, gone. The meeting itself goes first, in one statement that says what it had
 * as it went (so a delete knows of an invite recorded a moment before: ./_board-invite.js deleteWithInvite), then what's
 * kept beside it → the meeting as it was when it went, or null when there was none
 */
export async function deleteMeeting(env, id) {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare('DELETE FROM board_meetings WHERE id = ? RETURNING data').bind(id).first();
  const files = (await env.DB.prepare("SELECT id FROM board_files WHERE owner_type = 'meeting' AND owner_id = ?").bind(id).all()).results || [];
  for (const f of files) await deleteFile(env, f.id);
  await env.DB.prepare('DELETE FROM board_rsvps WHERE meeting_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM board_minutes_notes WHERE meeting_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM board_minutes_corrections WHERE meeting_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM board_minutes_signed WHERE meeting_id = ?').bind(id).run();
  return row ? cleanMeeting(parse(row.data)) : null;
}

/**
 * Done or not, by action id: an admin for any action, a member for their own. A member reaches only the action items
 * the board page shows (a shared meeting's): one on a meeting they can't see isn't there for them (404), never "someone else's"
 */
export async function setActionDone(DB, actionId, done, { by, slug = null } = {}) {
  await ensureSchema(DB);
  if (!ID.test(String(actionId || ''))) throw Object.assign(new Error('Which action item?'), { status: 400 });
  const meetings = await listMeetings(DB, { practice: !slug });
  const action = (slug ? meetings.filter((m) => boardCopy(m)) : meetings).flatMap((m) => m.actions).find((a) => a.id === actionId);
  if (!action) throw Object.assign(new Error('That action item is gone'), { status: 404 });
  // (theirs at the moment of their own rename too: the to-do still at the old address, or the sign-in: sameMember)
  if (slug && !(await sameMember(DB, action.owner, slug))) throw Object.assign(new Error('Only the person it’s assigned to can tick it off'), { status: 403 });
  await DB.prepare('INSERT OR REPLACE INTO board_action_state (action_id, done, done_on, by) VALUES (?, ?, ?, ?)')
    .bind(actionId, done ? 1 : 0, done ? todayEastern() : null, by || '').run();
  return { id: actionId, done: !!done, doneOn: done ? todayEastern() : '' };
}

/**
 * An agenda item someone may write a report for, or put a document with: a board member who presents it (picked, or
 * named in its presenter line) on a meeting the board can see, until its minutes are approved; one of Board's admins,
 * any time. A meeting ahead not shared yet opens to who presents in it, on the items they present, in the window the
 * board page shows it to them (_board-asks.js presentingWindow): anything else of it a member asks for answers as
 * not there (404), never as someone else's. → { m, it }, else throws (404, 403, 409)
 */
export async function presenterGate(env, id, itemId, { member = null, admin = false } = {}) {
  if (!ID.test(String(id || '')) || !ID.test(String(itemId || ''))) throw err('Which item?', 400);
  const m = await getMeeting(env.DB, id);
  const hidden = () => err('That meeting isn’t on the board page', 404);
  if (!m) throw hidden();
  const it = m.sections.flatMap((s) => s.items).find((x) => x.id === itemId);
  if (admin) {
    if (!it) throw err('That item isn’t on the agenda any more', 404);
    return { m, it };
  }
  if (!member) throw hidden();
  const people = await roster(env.DB);
  // (theirs at the moment of their own rename too: the item still naming the old address, or the sign-in)
  const presents = !!it && (presentersOf(it, [...people.board, ...people.staff]).some((p) => p.slug === member.slug)
    || await someMember(env.DB, it.who, member.slug));
  const seen = boardCopy(m);
  if (!seen) {
    const { presentingWindow } = await import('./_board-asks.js');
    if (!presents || !presentingWindow(m, todayEastern(), (await getSettings(env.DB)).template)) throw hidden();
  }
  // (an item the board page doesn't show, a row left empty, isn't there either)
  if (!it || (seen && !seen.sections.some((s) => s.items.some((x) => x.id === itemId)))) throw err('That item isn’t on the agenda any more', 404);
  if (!presents) throw err('Only the person presenting this item can write its report or add documents to it', 403);
  if (m.minutes === 'approved') throw err('This meeting’s minutes are approved, so its reports stay as they were', 409);
  return { m, it };
}

/** Whether any of these addresses (an item's who) is the member's own, a rename at that moment included (sameMember) */
async function someMember(DB, list, slug) {
  for (const x of Array.isArray(list) ? list : []) if (await sameMember(DB, x, slug)) return true;
  return false;
}

/** A meeting written to by a presenter or Board (patchMeeting), deleted meanwhile: not there, as presenterGate says it */
const stillThere = (saved) => {
  if (!saved) throw err('That meeting isn’t on the board page', 404);
  return saved;
};

/**
 * The items a board member presents in a meeting ahead not shared yet, inside the window the board page shows it to them
 * (_board-asks.js presentingWindow, the same as for their report and its documents), each as the board will see it
 * (forBoard: never a staff-only document or staff note). [] for any other meeting or person
 */
export async function presentedBy(DB, m, member) {
  if (!m || !member?.slug || m.shared) return [];
  const { presentingWindow } = await import('./_board-asks.js');
  if (!presentingWindow(m, todayEastern(), (await getSettings(DB)).template)) return [];
  const people = await roster(DB);
  const everyone = [...people.board, ...people.staff];
  return forBoard({ ...m, shared: true }).sections.flatMap((s) => s.items).filter((it) => presentersOf(it, everyone).some((p) => p.slug === member.slug));
}

/** A file's kind by its name, as Board files a new one (financial statements, else other) */
const kindOfName = (name) => (/financ|balance|income|p&l|profit|loss|budget|statement/i.test(name) ? 'financials' : 'other');

/**
 * A document with an item, put there by who presents it on the board page (or an admin): stored as Board stores any,
 * then placed on the item, after its others. → { file, docs }
 */
export async function attachToItem(env, id, itemId, file, { member = null, admin = false, adminEmail = '' } = {}) {
  await ensureSchema(env.DB);
  const { it } = await presenterGate(env, id, itemId, { member, admin });
  if ((it.docs || []).length >= 20) throw err('That item has 20 documents already', 409);
  const stored = await putFile(env, { ownerType: 'meeting', ownerId: id, file, kind: kindOfName(file?.name || ''), by: member?.email || adminEmail });
  try {
    const saved = await patchMeeting(env.DB, id, (cur) => {
      if (!cur.sections.some((s) => s.items.some((x) => x.id === itemId))) throw err('That item isn’t on the agenda any more', 404);
      return { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, docs: [...(x.docs || []), stored.id] } : x)) })) };
    }, { by: member?.name || adminEmail });
    return { file: stored, docs: stillThere(saved).sections.flatMap((s) => s.items).find((x) => x.id === itemId)?.docs || [] };
  } catch (e) {
    await deleteFile(env, stored.id); // never a file nothing shows
    throw e;
  }
}

/**
 * A document taken off an item on the board page: its presenter, only one they put there themselves (and it's gone
 * for good once nothing else has it); an admin, any (it stays with the meeting, as in Board). → { docs }
 */
export async function detachFromItem(env, id, itemId, fileId, { member = null, admin = false, adminEmail = '' } = {}) {
  await ensureSchema(env.DB);
  const { m, it } = await presenterGate(env, id, itemId, { member, admin });
  // (a member: only one the board page shows with it, never a staff-only file)
  const there = (it.docs || []).filter((d) => !member || m.files.some((f) => f.id === d && !f.staffOnly));
  if (!there.includes(fileId)) throw err('That document isn’t with this item', 404);
  const row = await env.DB.prepare('SELECT by FROM board_files WHERE id = ?').bind(fileId).first();
  if (member && (!row || String(row.by || '').toLowerCase() !== String(member.email || '').toLowerCase())) throw err('Only Board’s admins can take off a document someone else put there', 403);
  const saved = stillThere(await patchMeeting(env.DB, id, (cur) => ({ ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, docs: (x.docs || []).filter((d) => d !== fileId) } : x)) })) }), { by: member?.name || adminEmail }));
  if (member && !saved.sections.some((s) => s.items.some((x) => (x.docs || []).includes(fileId)))) await deleteFile(env, fileId);
  return { docs: saved.sections.flatMap((s) => s.items).find((x) => x.id === itemId)?.docs || [] };
}

/**
 * The order of an item's slides on the screen (board-shared.js orderUnits), set on the board page by who presents it
 * (presenterGate, as their report), or by one of Board's admins: never a clash, nothing else about the item changes
 * → { itemId, slideOrder }
 */
export async function saveSlideOrder(env, id, itemId, order, { member = null, admin = false, adminEmail = '' } = {}) {
  await ensureSchema(env.DB);
  if (!Array.isArray(order)) throw err('What order should its slides go in?', 400);
  await presenterGate(env, id, itemId, { member, admin });
  const slideOrder = [...new Set(order.map(String).filter((x) => SLIDE_PIECE.test(x)))].slice(0, 40);
  const saved = await patchMeeting(env.DB, id, (cur) => {
    if (!cur.sections.some((s) => s.items.some((x) => x.id === itemId))) throw err('That item isn’t on the agenda any more', 404);
    return { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, slideOrder } : x)) })) };
  }, { by: member?.name || adminEmail });
  return { itemId, slideOrder: stillThere(saved).sections.flatMap((s) => s.items).find((x) => x.id === itemId)?.slideOrder || [] };
}

/**
 * A report on an agenda item, written on the board page: by a board member who presents the item (picked, or named
 * in its presenter line) on a meeting the board can see, until its minutes are approved; or by one of Board's
 * admins, any time. `base` is the reportAt the writer started from: a report someone else saved since is refused
 * (409, with theirs as `current`), never written over. `look`: how the screen draws it (board-shared.js REPORT_LOOKS,
 * '' as it fits), chosen beside it; left as it was when not sent, and never a clash: it changes no words
 * → { itemId, report, reportBy, reportAt, reportLook }
 */
export async function saveReport(env, id, itemId, text, { member = null, admin = false, adminEmail = '', base = null, look = undefined } = {}) {
  await ensureSchema(env.DB);
  if (typeof text !== 'string') throw err('What does the report say?', 400);
  const { m, it } = await presenterGate(env, id, itemId, { member, admin });
  const itemOf = (x) => x.sections.flatMap((s) => s.items).find((y) => y.id === itemId);
  const report = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, LIMITS.report);
  const theirs = (x) => ({ itemId, report: x.report, reportBy: x.reportBy, reportAt: x.reportAt, reportLook: x.reportLook || '' });
  const reportLook = look === undefined ? undefined : REPORT_LOOKS.includes(look) ? look : '';
  const lookNow = reportLook !== undefined && reportLook !== (it.reportLook || '');
  if (report === it.report && !lookNow) return theirs(it);
  const by = member ? member.name : (await adminVoter(env.DB, adminEmail)).name;
  const at = nowIso();
  const saved = await patchMeeting(env.DB, id, (cur) => {
    const now = itemOf(cur);
    if (!now) throw err('That item isn’t on the agenda any more', 404);
    // (only how it shows: its words, who wrote them and when stay as they are)
    const words = now.report !== report;
    if (words && base !== null && String(base) !== (now.reportAt || '')) {
      throw Object.assign(err(`${now.reportBy || 'Someone'} changed this report since you opened it`, 409), { current: theirs(now) });
    }
    const patch = { ...(words ? { report, reportBy: report ? by : '', reportAt: report ? at : '' } : {}), ...(reportLook !== undefined ? { reportLook } : {}) };
    return { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, ...patch } : x)) })) };
  }, { by: member?.name || adminEmail });
  return theirs(itemOf(stillThere(saved)));
}

/**
 * What an item's presenter asks the board to vote on (item.motion), written ahead on the board page: the presenter or
 * Board's admins, until the meeting's minutes are approved (presenterGate). Empty takes it off. → { itemId, motion }
 */
export async function saveMotion(env, id, itemId, text, { member = null, admin = false, adminEmail = '', base = null } = {}) {
  await ensureSchema(env.DB);
  if (typeof text !== 'string') throw err('What should the board vote on?', 400);
  let it;
  try {
    ({ it } = await presenterGate(env, id, itemId, { member, admin }));
  } catch (e) {
    if (e.status === 403 && member) throw err('Only the person presenting this item can ask the board to vote on it', 403);
    throw e;
  }
  const motion = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.motion);
  if (motion === (it.motion || '')) return { itemId, motion };
  // `base`: the motion as the page last saw it. Someone else's since (a co-presenter, Board) is never written over
  const saved = await patchMeeting(env.DB, id, (cur) => {
    const now = cur.sections.flatMap((s) => s.items).find((x) => x.id === itemId);
    if (!now) throw err('That item isn’t on the agenda any more', 404);
    if (base !== null && String(base) !== (now.motion || '') && (now.motion || '') !== motion) {
      throw Object.assign(err('Someone changed this motion since you opened it', 409), { current: { itemId, motion: now.motion || '' } });
    }
    return { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, motion } : x)) })) };
  }, { by: member?.name || adminEmail });
  return { itemId, motion: stillThere(saved).sections.flatMap((s) => s.items).find((x) => x.id === itemId)?.motion || '' };
}

/** The board already has it on their calendars: Board's invite went out */
export const boardHasIt = (m) => !!m?.invite?.sentAt;
/**
 * A meeting a board member can see something of: a shared one, or one ahead
 * that's on their calendars already but isn't shared yet (its day, time and
 * place only: see portalData's nextPending). Never one Board keeps off the board page (notBoard: a coffee the calendar
 * brought in, another organization's board), shared or not
 */
export const onBoardPage = (m, today = todayEastern()) => !!m && !m.notBoard && (m.shared || (!m.calendar?.gone && isDate(m.date) && m.date >= today && boardHasIt(m)));
/**
 * A board meeting the board can see: on the board page (above), and a board meeting, never one Board keeps off it
 * (a coffee the calendar brought in, another organization's) nor a practice. Every list of meetings the board is
 * shown (the next ones, the year's, the minutes email's next meeting) is these only
 */
export const boardSees = (m, today = todayEastern()) => !!m && !m.notBoard && !m.practice && onBoardPage(m, today);
/**
 * A meeting as the board page has it (its agenda, documents, notes and minutes, as forBoard leaves them): a shared
 * meeting the board sees (boardSees), else null. Every list, page, file and action a member reaches goes by this one
 * rule, so a meeting is on the board page everywhere or nowhere
 */
export const boardCopy = (m) => (m?.shared && boardSees(m) ? forBoard(m) : null);
/** A meeting's calendar file for the board page, or null when it isn't theirs to see (one not shared yet carries no agenda) */
export async function boardIcs(DB, id) {
  const m = ID.test(String(id || '')) ? await getMeeting(DB, id) : null;
  if (!m?.date || !onBoardPage(m)) return null;
  return meetingIcs(m.shared ? m : { ...m, sections: [] });
}

// ─── Documents ──────────────────────────────────────────────────────

export function cleanDoc(raw = {}) {
  const one = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return {
    id: ID.test(String(raw.id || '')) ? raw.id : uid('d_'),
    // SOARD's name as it's written, whatever a Drive file or a hurried title said
    title: orgName(one(raw.title, 200)),
    kind: DOC_KINDS.some((k) => k.id === raw.kind) ? raw.kind : 'other',
    note: String(raw.note ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000),
    sign: raw.sign === true,
    shared: raw.shared !== false,
    year: Number(raw.year) >= 2000 && Number(raw.year) <= 2100 ? Math.round(raw.year) : null,
    // Its words, when it's written in Board (Markdown, ../../public/admin/board-report.js): what the board page shows
    body: String(raw.body ?? '').replace(/\r\n?/g, '\n').trim().slice(0, LIMITS.paper),
    // Which wording it is (each saved change of its words is the next, kept in board_doc_versions), and when and by
    // whom it was written; a signature on a wording before `signFrom` (the board asked to sign again) doesn't count
    version: Math.max(0, Math.round(Number(raw.version) || 0)),
    signFrom: Math.max(0, Math.round(Number(raw.signFrom) || 0)),
    // The first version a page must have read to sign: a change the admin said doesn't need signing again (a typo)
    // leaves it, so a page showing the version just before can still sign
    readFrom: Math.max(0, Math.round(Number(raw.readFrom) || 0)),
    wordsAt: one(raw.wordsAt, 40),
    wordsBy: one(raw.wordsBy, 200),
    // The file its words were read from (a board file's id): a newer file than that is one to bring the words in from
    wordsFile: one(raw.wordsFile, 40),
    // When the board signs it by each year ('MM-DD', so it rolls forward): on the board page and in the asks, and
    // a date gone by is said as one
    due: validDue(raw.due),
    createdAt: one(raw.createdAt, 40),
    updatedAt: one(raw.updatedAt, 40),
  };
}

/** 'MM-DD' a real day of the year ('02-29' too: it's Feb 28 in other years), else '' */
function validDue(v) {
  const m = String(v || '').trim().match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  const mo = Number(m[1]); const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(2024, mo, 0)).getUTCDate() ? `${m[1]}-${m[2]}` : '';
}

/**
 * How a signature came: typed on the board page; the member's own signed copy, added there; a copy a Board admin
 * was handed for them (`staff`); their copy in SOARD's Drive (`drive`: Board read those until Nov 3 2026, when papers moved into Board)
 */
export const SIGNED_BY = ['typed', 'drawn', 'copy', 'staff', 'drive'];
// Signed on the board page (typed or drawn), not a copy
const onPage = (how) => how === 'typed' || how === 'drawn';
const thisYear = () => Number(todayEastern().slice(0, 4));
/** The papers the board is asked to sign: shared, required, and with words or a file the board can open */
const signablePapers = (docs) => docs.filter((d) => d.shared && d.sign && (d.body || (d.file && !d.file.staffOnly)));
/** The year a board member signs for: today's, and in a preview the meeting's, since that's when the real one goes */
const signYear = (m, test) => (test && isDate(m.date) ? m.date : todayEastern()).slice(0, 4);
/** After a paper's name: " (by March 1)", or " (was due March 1)" once it has passed */
const dueNote = (due) => (due ? ` (${due < todayEastern() ? 'was due' : 'by'} ${dueWords(due)})` : '');
/**
 * A signature row as Board shows it: { name, at, how, copy (the file, when one was added), drive ({ id, name } in
 * Drive), mark (how they signed it: typed in a style, or drawn), fields (each initial and answer, with its point) }
 */
const signatureOf = (s, copies = {}) => ({
  name: s.name || '', at: s.at || '', how: SIGNED_BY.includes(s.how) ? s.how : 'typed', version: Number(s.version) || 0,
  copy: s.file_id ? copies[s.file_id] || null : null,
  drive: s.drive_id ? { id: s.drive_id, name: s.drive_name || '' } : null,
  ...(s.mark ? { mark: parse(s.mark, null) } : {}),
  ...(s.fields ? { fields: parse(s.fields, []) } : {}),
  // (its signed copy, the paper as signed with its record, once it's made)
  ...(s.record_id ? { record: { id: s.record_id, hash: s.record_hash || '' } } : {}),
});

/**
 * Every document with its file and this year's signatures:
 * { ...doc, file, signed: { slug: { name, at, how, version, copy, drive } }, earlier: [slugs], before: { slug: … },
 *   prior: { slug: { year, at, how, version } } }
 * (`sign`: every board member signs it each year; `earlier`: who signed a wording before the one the board was asked
 * to sign again, their signature in `before`; `prior`: each member's signature in the last year before this one they
 * signed it, so a new year's "to sign" says they signed it then)
 */
export async function listDocs(DB, year = thisYear()) {
  await ensureSchema(DB);
  const [rows, files, sigs, copies, prior, keptRows, declined] = await Promise.all([
    DB.prepare('SELECT data FROM board_docs').all().then((r) => r.results || []),
    filesOf(DB, 'doc'),
    DB.prepare('SELECT * FROM board_signatures WHERE year = ?').bind(year).all().then((r) => r.results || []),
    filesOf(DB, 'signed').then((by) => Object.fromEntries(Object.values(by).flat().map((f) => [f.id, f]))),
    // (SQLite gives the other columns from the row with the latest year)
    DB.prepare('SELECT doc_id, slug, MAX(year) AS year, at, how, version FROM board_signatures WHERE year < ? GROUP BY doc_id, slug').bind(year).all().then((r) => r.results || []),
    // Every signed copy kept (replaced or taken off copies too, and an iPhone photo's original), for the admins
    DB.prepare("SELECT id, owner_id, slug, name, type, size, at, superseded_at, original_id FROM board_files WHERE owner_type = 'signed' ORDER BY at").all().then((r) => r.results || []),
    // Who told SOARD they can't sign it as written this year, and why (until they sign)
    declinedOf(DB, year),
  ]);
  return rows.map((r) => cleanDoc(parse(r.data))).map((d) => {
    const theirs = sigs.filter((s) => s.doc_id === d.id);
    const counts = (s) => (Number(s.version) || 0) >= d.signFrom;
    return {
      ...d,
      file: (files[d.id] || []).at(-1) || null,
      signed: Object.fromEntries(theirs.filter(counts).map((s) => [s.slug, signatureOf(s, copies)])),
      earlier: theirs.filter((s) => !counts(s)).map((s) => s.slug),
      before: Object.fromEntries(theirs.filter((s) => !counts(s)).map((s) => [s.slug, signatureOf(s, copies)])),
      prior: Object.fromEntries(prior.filter((s) => s.doc_id === d.id).map((s) => [s.slug, { year: Number(s.year), at: s.at || '', how: SIGNED_BY.includes(s.how) ? s.how : 'typed', version: Number(s.version) || 0 }])),
      declined: Object.fromEntries(Object.entries(declined[d.id] || {}).filter(([slug, x]) => !theirs.some((s) => s.slug === slug && counts(s)) && (Number(x.version) || 0) >= d.signFrom).map(([slug, { version, ...x }]) => [slug, x])),
      // (each member's copies kept for this paper: earlier ones, replaced or taken off, and a photo's original; Board only)
      kept: keptRows.filter((f) => f.owner_id === d.id && f.slug).reduce((by, f) => {
        const originalOf = keptRows.find((x) => x.original_id === f.id);
        if (f.superseded_at || originalOf) (by[f.slug] ||= []).push({ id: f.id, name: f.name, type: f.type, size: f.size, at: f.at, supersededAt: f.superseded_at || null, ...(originalOf ? { originalOf: originalOf.id } : {}) });
        return by;
      }, {}),
    };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

/** Did which points a paper asks initials or an answer on change (their kind or their words)? */
const fieldsMoved = (a, b) => JSON.stringify(paperFields(a || '').map((f) => [f.kind, f.text])) !== JSON.stringify(paperFields(b || '').map((f) => [f.kind, f.text]));

/**
 * A document saved (`by`: who). Its words are the next wording when they changed, kept on record. A save without
 * words keeps them. Decided here, from what's saved now (never from the page the admin opened a while ago):
 *   - `base`: the wording the admin's editor started from; someone else's newer one is a 409 with { conflict }
 *     (who, when, its number) and nothing is saved, until the admin chooses (base: that number, to save theirs over)
 *   - new words, or a new file (`newFile`: its name, uploaded right after), on a paper some of the board signed this
 *     year: a 409 with { ask: { names, since } } until the admin says whether they sign again (`askAgain` true or
 *     false; true: signatures on earlier wordings stop counting, a new file a wording of its own). `fromFile`: the
 *     words are its own file's, as read (the paper is the same, so nobody signs again); `wordsFrom`: the file's name,
 *     for the record
 *   - a paper everyone signs keeps its words or its file: one with neither can't be required
 */
export async function saveDoc(DB, raw, { by = '', askAgain = null, base = null, fromFile = false, wordsFrom = '', newFile = '' } = {}) {
  await ensureSchema(DB);
  const d = cleanDoc(raw);
  if (!d.title) throw Object.assign(new Error('A document needs a title'), { status: 400 });
  const row = await DB.prepare('SELECT data FROM board_docs WHERE id = ?').bind(d.id).first();
  // An editor open on a paper deleted meanwhile (another tab, someone else): not made again from what it had
  if (!row && base != null) throw Object.assign(new Error('This paper was deleted (in another tab, or by someone else), so nothing was saved'), { status: 410, extra: { deleted: true } });
  const was = row ? cleanDoc(parse(row.data)) : null;
  const body = raw.body === undefined ? was?.body || '' : d.body;
  const changed = body !== (was?.body || '');
  if (raw.wordsFile === undefined) d.wordsFile = was?.wordsFile || '';
  // On the board page or not is its switch's: a save that doesn't say keeps it as it is (an editor opened before the
  // switch was flipped never flips it back)
  if (raw.shared === undefined && was) d.shared = was.shared;
  if (was && changed && base != null && Number(base) !== was.version) {
    throw Object.assign(new Error('These words changed while you had them open'), { status: 409, extra: { conflict: { version: was.version, by: was.wordsBy, at: was.wordsAt, body: was.body } } });
  }
  if (was && d.sign && !body) {
    const file = await DB.prepare("SELECT id FROM board_files WHERE owner_type = 'doc' AND owner_id = ? LIMIT 1").bind(d.id).first();
    if (!file) throw Object.assign(new Error('A paper every member signs needs its words or its file: write them, add the file, or untick Required'), { status: 400 });
  }
  // A new file changes what the board reads only when it reads the paper as its file (written here, it reads the words)
  const newRead = !!newFile && !body;
  // Required after this save, and what the board reads changes now (new words, a new file) or changed while it wasn't
  // required (made required again): whoever's signature would count on it is asked about
  const reRequired = !!was && !was.sign && d.sign;
  const changesNow = changed || newRead;
  if (was && d.sign && (changesNow || reRequired) && askAgain == null && !(fromFile && !newFile && !was.body)) {
    const current = (await listDocs(DB)).find((x) => x.id === d.id);
    const board = await activeBoard(DB);
    const names = board.filter((p) => current?.signed[p.slug] && (changesNow || current.signed[p.slug].version < was.version)).map((p) => p.name);
    // since: what they signed (the earlier words, or the file); now: what the board will read; newFile: a new file;
    // paused: its words changed while it wasn't required
    if (names.length) throw Object.assign(new Error('Do they sign the new version?'), { status: 409, extra: { ask: { names, since: was.body ? 'words' : 'file', now: body ? 'words' : 'file', newFile: newFile ? String(newFile) : '', paused: reRequired && !changesNow, fields: fieldsMoved(was.body, body) } } });
  }
  // The wording's number, and who wrote it when, are the server's
  const next = { ...d, body, version: was?.version || 0, signFrom: was?.signFrom || 0, readFrom: was?.readFrom || 0, wordsAt: was?.wordsAt || '', wordsBy: was?.wordsBy || '', createdAt: row ? parse(row.data).createdAt : nowIso(), updatedAt: nowIso() };
  // A new version: new words, or a new file for a paper read as its file (whether or not the board signs it again:
  // a page still showing the old file can't sign the new one unread)
  // (required again, the board asked to sign again: from the version it is)
  if (reRequired && !changesNow && askAgain === true) { next.signFrom = next.version; next.readFrom = next.version; }
  if (changed || (was && newRead)) {
    next.version += 1;
    if (changed) { next.wordsAt = nowIso(); next.wordsBy = String(by || '').slice(0, 200); }
    // (its note: where its words came from, or the file it was; and that the board signed again from it)
    const note = [changed ? (wordsFrom ? `From ${String(wordsFrom).slice(0, 200)}` : '') : `A new file: ${String(newFile).slice(0, 200)}`, askAgain === true ? 'The board signs again from here' : ''].filter(Boolean).join(' · ');
    // (with its SHA-256: what a signature on this wording signed, exactly)
    await DB.prepare('INSERT OR REPLACE INTO board_doc_versions (doc_id, version, body, at, by, note, hash) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(d.id, next.version, body, nowIso(), String(by || '').slice(0, 200), note, body ? await sha256Hex(body) : null).run();
    if (askAgain === true) next.signFrom = next.version;
    // A page still on an earlier version re-reads before signing, unless the admin said the change doesn't need it
    // (and always when what they initial or answer moved: a page from before can't sign without them)
    if (askAgain !== false || fieldsMoved(was?.body, body)) next.readFrom = next.version;
  }
  await DB.prepare('INSERT OR REPLACE INTO board_docs (id, data, updated_at) VALUES (?, ?, ?)').bind(d.id, JSON.stringify(next), next.updatedAt).run();
  if (next.sign || next.shared === false || body) await closeToAdvisors(DB, d.id);
  return (await listDocs(DB)).find((x) => x.id === d.id);
}

/**
 * A paper advisors could open that the board now signs, hides, writes here or marks staff-only is off for them from that
 * moment, not just until it changes back: someone turns it on again in Advisory if it should be. Never holds up a board save
 */
async function closeToAdvisors(DB, id) {
  try {
    const s = await getAdvisorySettings(DB);
    if ((s.boardDocs || []).includes(id)) await saveAdvisorySettings(DB, { boardDocs: s.boardDocs.filter((x) => x !== id) });
  } catch (e) { console.error('[board] advisors’ papers', e?.message || e); }
}

/** Board files not read yet, a few at a time: their words kept for finding them (./_board-file-words.js) */
export async function fillDocWords(env, { limit = 3 } = {}) {
  return (await import('./_board-file-words.js')).readBoardWords(env, { limit });
}

/**
 * A paper's wordings written in Board, newest first: [{ version, body, at, by, note, signed }] (`note`: where its
 * words came from, or the new file it was; `signed`: how many signed it this year)
 */
export async function docVersions(DB, id, year = thisYear()) {
  await ensureSchema(DB);
  const counts = Object.fromEntries((((await DB.prepare('SELECT version, count(*) AS n FROM (SELECT version FROM board_signatures WHERE doc_id = ?1 AND year = ?2 UNION ALL SELECT version FROM board_signatures_earlier WHERE doc_id = ?1 AND year = ?2) GROUP BY version').bind(id, year).all()).results) || []).map((r) => [Number(r.version) || 0, Number(r.n)]));
  return ((await DB.prepare('SELECT version, body, at, by, note FROM board_doc_versions WHERE doc_id = ? ORDER BY version DESC LIMIT 50').bind(id).all()).results || [])
    .map((r) => ({ version: Number(r.version), body: r.body || '', at: r.at || '', by: r.by || '', note: r.note || '', signed: counts[Number(r.version)] || 0 }));
}

/** Why a file can't be deleted ('' when it can): a signed copy or record, or a paper's file a signature rests on */
export async function fileLocked(DB, id) {
  await ensureSchema(DB);
  const row = await DB.prepare('SELECT owner_type, owner_id FROM board_files WHERE id = ?').bind(id).first();
  if (!row) return '';
  if (row.owner_type === 'signed' || row.owner_type === 'record' || await DB.prepare('SELECT 1 AS y FROM board_minutes_signed WHERE file_id = ?').bind(id).first()) return 'A signed copy is SOARD’s record of a signature, so it’s kept';
  if (row.owner_type === 'doc' && (await everSigned(DB, row.owner_id))) return 'The board signed this paper, so its file is kept with their signatures. Add a new file instead; this one stays on record.';
  return '';
}
/** Has anyone ever signed this paper (any year, any wording, a signature since replaced or taken off)? Opening it or being asked isn't signing */
async function everSigned(DB, id) {
  const r = await DB.prepare("SELECT (SELECT COUNT(*) FROM board_signatures WHERE doc_id = ?1) + (SELECT COUNT(*) FROM board_signatures_earlier WHERE doc_id = ?1) + (SELECT COUNT(*) FROM board_sign_events WHERE doc_id = ?1 AND kind IN ('signed', 'superseded', 'taken-off')) AS n").bind(id).first();
  return Number(r?.n) > 0;
}

export async function deleteDoc(env, id) {
  await ensureSchema(env.DB);
  if (await everSigned(env.DB, id)) throw Object.assign(new Error('The board has signed this paper, so it’s kept as SOARD’s record. Take it off the board page instead (the switch on its row), or untick Required.'), { status: 409, extra: { signed: true } });
  // Its file, and the signed copies kept beside it
  const files = (await env.DB.prepare("SELECT id FROM board_files WHERE owner_type IN ('doc', 'signed') AND owner_id = ?").bind(id).all()).results || [];
  for (const f of files) await deleteFile(env, f.id);
  await env.DB.prepare('DELETE FROM board_signatures WHERE doc_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM board_signatures_earlier WHERE doc_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM board_doc_versions WHERE doc_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM board_docs WHERE id = ?').bind(id).run();
}

// Why a paper can't be signed now: taken off the board page, gone, or no longer asking (the page reloads it)
const noSignature = (doc) => Object.assign(new Error(!doc || !doc.shared ? 'That paper isn’t on the board page anymore' : 'That paper doesn’t ask for a signature anymore'), { status: 404, extra: { gone: true } });
/** The words they read aren't the paper's words anymore: they read the new ones first */
const notWhatTheyRead = (doc, version) => {
  if (version == null || version === '' || Number(version) >= doc.readFrom) return null;
  return Object.assign(new Error('It changed while you had it open. Read it again, then sign.'), { status: 409, extra: { changed: true } });
};
/** The version a signature is on: the one they read (a small change since doesn't need it read again), else the paper's */
const signedOn = (doc, version) => (version == null || version === '' ? doc.version : Math.min(doc.version, Math.max(Number(version), doc.readFrom)));
/**
 * The SHA-256 of what a member reads to sign a paper now: its words, else its file's bytes (read once and kept on
 * the file's row). `store`: { DB, bucket } (no bucket: only a hash already kept)
 */
export async function contentHash({ DB, bucket = null }, doc) {
  if (doc?.body) return sha256Hex(doc.body);
  if (!doc?.file?.id) return '';
  const row = await DB.prepare('SELECT sha256, r2_key FROM board_files WHERE id = ?').bind(doc.file.id).first();
  if (row?.sha256 || !bucket || !row?.r2_key) return row?.sha256 || '';
  const obj = await bucket.get(row.r2_key);
  if (!obj) return '';
  const hash = await sha256Hex(new Uint8Array(await new Response(obj.body).arrayBuffer()));
  await DB.prepare('UPDATE board_files SET sha256 = ? WHERE id = ?').bind(hash, doc.file.id).run();
  return hash;
}
const storeOf = (env) => ({ DB: env.DB, bucket: boardFiles(env) });
/**
 * The SHA-256 of the wording a signature is on (`version`: the one their page showed, an earlier one when a small
 * change since was kept): its words as saved then, or the file that version was; the paper's now when it's that one
 */
export async function versionHash(store, doc, version) {
  if (Number(version) !== Number(doc.version)) {
    const row = await store.DB.prepare('SELECT hash, body, file_id FROM board_doc_versions WHERE doc_id = ? AND version = ?').bind(doc.id, Number(version) || 0).first();
    if (row?.body) return row.hash || sha256Hex(row.body);
    // (a paper read as its file: that wording's file, never a later one)
    const fileId = row?.file_id || await fileOfVersion(store.DB, doc.id, version);
    if (fileId) return contentHash(store, { ...doc, body: '', file: { id: fileId } });
  }
  return contentHash(store, doc);
}

/**
 * The file a wording of a paper read as its file was: its row's, else (from before rows kept it: a paper's first
 * file) the newest file the paper had before its next wording was made; null when it can't be told
 */
export async function fileOfVersion(DB, docId, version) {
  const row = await DB.prepare('SELECT file_id FROM board_doc_versions WHERE doc_id = ? AND version = ?').bind(docId, Number(version) || 0).first();
  if (row?.file_id) return row.file_id;
  const next = await DB.prepare('SELECT MIN(at) AS at FROM board_doc_versions WHERE doc_id = ? AND version > ?').bind(docId, Number(version) || 0).first();
  const f = next?.at
    ? await DB.prepare("SELECT id FROM board_files WHERE owner_type = 'doc' AND owner_id = ? AND at < ? ORDER BY at DESC LIMIT 1").bind(docId, next.at).first()
    : await DB.prepare("SELECT id FROM board_files WHERE owner_type = 'doc' AND owner_id = ? ORDER BY at DESC LIMIT 1").bind(docId).first();
  return f?.id || null;
}

/**
 * A signature written with its events in one batch (./_board-sign.js appendEvents): the row it replaces goes to
 * board_signatures_earlier when it no longer counts (the board signed again), else into the chain whole
 * ('superseded'), its copy marked superseded, never deleted. `keep`: one already there stays (a Drive copy never
 * takes the place of one they gave). `same(was)`: a signature already there that this one repeats (a second tap of
 * Sign) is returned instead. `evidence`: { ip, device, signinAt, signerEmail } → { written, row } | { written: false, was, same }
 */
async function writeSignature(DB, sig, { keep = false, same = null } = {}) {
  const { docId, slug, year } = sig;
  const e = sig.evidence || {};
  return appendEvents(DB, async () => {
    const was = await DB.prepare('SELECT * FROM board_signatures WHERE doc_id = ? AND slug = ? AND year = ?').bind(docId, slug, year).first();
    if (was && keep) return { result: { written: false, was } };
    const repeat = was && same ? same(was) : null;
    if (repeat) return { result: { written: false, was, same: repeat } };
    const at = sig.at || nowIso();
    const row = {
      doc_id: docId, slug, year, version: sig.version || 0, name: sig.name, at, how: sig.how, file_id: sig.fileId || null,
      drive_id: sig.driveId || null, drive_name: sig.driveName || null, added_by: sig.by || '',
      // (the signer's own: a copy SOARD added or Drive's has none; the admin adding it is in its event)
      ...(sig.how === 'staff' || sig.how === 'drive' ? { ip: null, device: null, signin_at: null, signer_email: null } : { ip: e.ip || null, device: e.device || null, signin_at: e.signinAt || null, signer_email: e.signerEmail || null }),
      hash: sig.hash || null, fields: sig.fields ? JSON.stringify(sig.fields) : null, mark: sig.mark ? JSON.stringify(sig.mark) : null,
      consent_hash: sig.consentHash || null, process_v: sig.processV ?? null, record_id: null, record_hash: null, record_claim_at: null, record_tries: 0,
    };
    const stmts = [];
    const events = [];
    if (was) {
      const wasV = Number(was.version) || 0;
      if (wasV < (sig.signFrom || 0)) {
        // (its wording before the board signed again: kept as it was, its copy too)
        const there = await DB.prepare('SELECT * FROM board_signatures_earlier WHERE doc_id = ? AND slug = ? AND year = ? AND version = ?').bind(docId, slug, year, wasV).first();
        if (there) events.push({ kind: 'superseded', docId, slug, year, version: wasV, at, by: row.added_by, detail: { row: there } });
        stmts.push(putSignature(DB, 'board_signatures_earlier', { ...was, version: wasV }));
      } else {
        events.push({ kind: 'superseded', docId, slug, year, version: wasV, at, by: row.added_by, detail: { row: was } });
        if (was.file_id && was.file_id !== row.file_id) stmts.push(DB.prepare('UPDATE board_files SET superseded_at = ?1 WHERE (id = ?2 OR id = (SELECT original_id FROM board_files WHERE id = ?2)) AND superseded_at IS NULL').bind(at, was.file_id));
        // (its signed copy too: kept, as an earlier signature's)
        if (was.record_id) stmts.push(DB.prepare('UPDATE board_files SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL').bind(at, was.record_id));
      }
    }
    stmts.push(putSignature(DB, 'board_signatures', row));
    events.push({
      kind: 'signed', docId, slug, year, version: row.version, at, by: row.added_by, ip: e.ip, device: e.device,
      detail: { how: row.how, name: row.name, hash: row.hash, file: row.file_id, drive: row.drive_id, signerEmail: row.signer_email, signinAt: row.signin_at, ...(sig.detail || {}) },
    });
    return { stmts, events, result: { written: true, row } };
  });
}

/**
 * A member's signature for this year on the board page. Today's page sends their adopted `mark` ({ type: 'typed' |
 * 'drawn', style, text: their name as typed (signsAs: their own), path, initials }), each of the paper's `fields`
 * ({ [n]: value }: every initial and answer it marks, required), `consent` (agreeing once to sign electronically,
 * the first time) and the `year` on the page. A page from before marks (`name` only) still signs a paper that asks
 * for nothing else. A signed copy already in (theirs, or one in Drive) stays: it's the better record.
 * → { docId, year, name, at, how, version, mark, fields, copy, drive }
 */
export async function signDoc(DB, docId, member, name, { version = null, evidence = {}, bucket = null, mark: rawMark = null, fields: given = null, consent = false, year: pageYear = null } = {}) {
  await ensureSchema(DB);
  const year = thisYear();
  // (a page left open over New Year's: it signs for the year it says, so it reloads)
  if (pageYear != null && Number(pageYear) !== year) throw Object.assign(new Error(`It’s ${year} now. Reload the page to sign for ${year}.`), { status: 409, extra: { newYear: true } });
  const doc = (await listDocs(DB)).find((d) => d.id === docId);
  if (!doc?.shared || !doc.sign) throw noSignature(doc);
  // `version`: the wording on their page when they signed; a newer one is signed only once they've read it
  const stale = notWhatTheyRead(doc, version);
  if (stale) throw stale;
  const had = doc.signed[member.slug];
  if (had && !onPage(had.how)) return { docId, year, ...had };
  const asks = doc.body ? paperFields(doc.body) : [];
  // A page from before marks: only for a paper that asks for nothing but the signature
  if (!rawMark && asks.length) throw Object.assign(new Error('This paper asks for your initials now. Reload the page to sign it.'), { status: 409, extra: { reload: true } });
  const mark = rawMark ? cleanMark(rawMark) : null;
  if (typeof mark === 'string') throw Object.assign(new Error(mark), { status: 400 });
  const said = mark ? mark.text : name;
  if (String(said || '').trim().length < 3) throw Object.assign(new Error('Type your full name to sign'), { status: 400 });
  const typed = signsAs(said, member.name);
  if (!typed) throw Object.assign(new Error(`Sign with your own name, as the board has it: ${member.name}`), { status: 400 });
  // Every point it marks, filled in: initials as adopted, an answer in words
  const fields = asks.map((f) => ({ ...f, value: String((given || {})[f.n] ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) }));
  const blank = fields.filter((f) => !f.value || (f.kind === 'initials' && (!mark?.initials || f.value.toUpperCase() !== mark.initials)));
  if (blank.length) throw Object.assign(new Error(`${blank[0].kind === 'initials' ? 'Initial' : 'Answer'} point ${blank[0].n} first${blank.length > 1 ? ` (${blank.length} left)` : ''}`), { status: 400, extra: { missing: blank.map((f) => f.n) } });
  // Agreeing to sign electronically, once, kept with when and where from
  const marks = mark ? await DB.prepare('SELECT * FROM board_member_marks WHERE slug = ?').bind(member.slug).first() : null;
  // (the words they agreed to, the first time: kept, so a later wording of the consent never stands in for theirs)
  const consentHash = mark ? marks?.consent_hash || await sha256Hex(CONSENT_TEXT) : null;
  if (mark && !marks?.consent_at && !consent) throw Object.assign(new Error('Tick that you agree to sign electronically, then sign'), { status: 409, extra: { consent: true } });
  const at = nowIso();
  const on = signedOn(doc, version);
  const hash = await versionHash({ DB, bucket }, doc, on);
  const how = mark?.type === 'drawn' ? 'drawn' : 'typed';
  const markKept = mark ? { type: mark.type, style: mark.style, text: typed, initials: mark.initials, ...(mark.path ? { path: mark.path } : {}) } : null;
  const r = await writeSignature(DB, {
    docId, slug: member.slug, year, name: typed, how, by: member.email || '', at, version: on, signFrom: doc.signFrom, evidence, hash,
    fields: fields.length ? fields : null, mark: markKept, consentHash, processV: mark ? PROCESS_V : null,
    detail: mark ? { mark: { type: mark.type, style: mark.style }, fields: fields.map((f) => ({ n: f.n, kind: f.kind, value: f.value })), consentHash } : undefined,
  }, { same: (was) => (onPage(was.how) && (Number(was.version) || 0) === on ? was : null) });
  // (Sign pressed twice, or from two devices: the first one is the signature)
  if (r?.same) return { docId, year, name: r.same.name, at: r.same.at, how: r.same.how, version: on, copy: null, drive: null };
  if (mark) await keepMark(DB, member, { mark, typed, at, first: !marks?.consent_at, evidence, consentHash, docId, year, version: on });
  return { docId, year, name: typed, at, how, version: on, mark: markKept, fields, copy: null, drive: null };
}

/**
 * Their adopted signature and initials, for next time, and agreeing to sign electronically the first time (`first`).
 * Shared by papers and the minutes (./_board-minutes-sign.js).
 */
export async function keepMark(DB, member, { mark, typed, at, first, evidence = {}, consentHash, docId, year, version }) {
  await DB.prepare('INSERT INTO board_member_marks (slug, mark, initials, consent_at, consent_ip, consent_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET mark = excluded.mark, initials = excluded.initials, consent_at = COALESCE(board_member_marks.consent_at, excluded.consent_at), consent_ip = COALESCE(board_member_marks.consent_ip, excluded.consent_ip), consent_hash = COALESCE(board_member_marks.consent_hash, excluded.consent_hash), updated_at = excluded.updated_at')
    .bind(member.slug, JSON.stringify({ type: mark.type, style: mark.style, text: typed, ...(mark.path ? { path: mark.path } : {}) }), mark.initials, first ? at : null, first ? evidence.ip || '' : null, first ? consentHash : null, at).run();
  if (first) await appendEvents(DB, async () => ({ events: [{ kind: 'consented', docId, slug: member.slug, year, version, at, by: member.email || '', ip: evidence.ip, device: evidence.device, detail: { consentHash, text: CONSENT_TEXT } }] }));
}

/**
 * A signed copy as this year's signature: a board member's own, added on the board page (`member`), or one a Board
 * admin was handed for a member (`slug`, `by`). Kept staff-only beside the paper (the member opens their own);
 * it replaces a copy added for them before. A PDF or a photo of the signed page. `version`: the wording on the
 * member's page (as signDoc). → { docId, year, name, at, how, copy, drive }
 */
export async function signWithCopy(env, docId, file, { member = null, slug = '', by = '', version = null, replace = false, evidence = {}, original = null } = {}) {
  await ensureSchema(env.DB);
  const doc = (await listDocs(env.DB)).find((d) => d.id === docId);
  if (!doc?.sign || (member && !doc.shared)) throw noSignature(doc);
  if (member) { const stale = notWhatTheyRead(doc, version); if (stale) throw stale; }
  const who = member || (await activeBoard(env.DB)).find((p) => p.slug === slug);
  if (!who) throw Object.assign(new Error('Whose is it? They aren’t on People → Board'), { status: 404 });
  const theirs = !member && doc.signed[who.slug];
  if (theirs && (onPage(theirs.how) || theirs.how === 'copy') && !replace) {
    throw Object.assign(new Error(`${who.name} has signed it already (${onPage(theirs.how) ? 'on the board page' : 'their own copy'})`), { status: 409, extra: { exists: { how: theirs.how, at: theirs.at, name: who.name } } });
  }
  if (file && typeof file.arrayBuffer === 'function') {
    const type = fileTypeOf(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!type && /\.(pdf|jpe?g|png|gif|webp|hei[cf])$/i.test(file.name || '')) throw Object.assign(new Error(`${file.name} isn’t what its name says (another kind of file renamed): save the signed page again as a PDF or a photo`), { status: 415 });
    if (!type || !(type === 'application/pdf' || type.startsWith('image/'))) throw Object.assign(new Error('A signed copy is a PDF, or a photo of the signed page'), { status: 415 });
  }
  const year = thisYear();
  if (!file || typeof file.arrayBuffer !== 'function') throw Object.assign(new Error('Choose the signed copy: a PDF, or a photo of the signed page'), { status: 400 });
  // (an iPhone photo: the HEIC as it was taken is the record, the JPEG beside it what a browser shows)
  const kept = original && typeof original.arrayBuffer === 'function' ? await putFile(env, { ownerType: 'signed', ownerId: docId, file: original, staffOnly: true, by: by || who.email || '', slug: who.slug }) : null;
  const copy = await putFile(env, { ownerType: 'signed', ownerId: docId, file, staffOnly: true, by: by || who.email || '', slug: who.slug, originalId: kept?.id || null });
  const at = nowIso();
  const on = member ? signedOn(doc, version) : doc.version;
  const hash = await versionHash(storeOf(env), doc, on);
  // (the copy it replaces is marked superseded inside writeSignature: kept, never deleted)
  const replaced = theirs && (onPage(theirs.how) || theirs.how === 'copy') ? theirs : null;
  await writeSignature(env.DB, { docId, slug: who.slug, year, name: who.name, how: member ? 'copy' : 'staff', fileId: copy.id, by: by || who.email || '', at, version: on, signFrom: doc.signFrom, evidence, hash, detail: { copySha256: copy.sha256, original: kept ? { id: kept.id, sha256: kept.sha256 } : null } });
  return { docId, year, name: who.name, at, how: member ? 'copy' : 'staff', version: on, copy, drive: null, ...(replaced ? { replaced: { how: replaced.how, at: replaced.at, slug: who.slug, email: who.email || '' } } : {}) };
}

/**
 * A member's copy in Drive as their signature for its year, as Board recorded those until Nov 3 2026 (papers are
 * kept in Board now). One they already gave that year, typed or added, stays theirs (`replace`)
 */
export async function signFromDrive(DB, { docId, slug, year, name, driveId, driveName, at, by = 'Google Drive', version = 0 }, { replace = false } = {}) {
  await ensureSchema(DB);
  await writeSignature(DB, { docId, slug, year, name, how: 'drive', driveId, driveName, by, at: at || nowIso(), version, detail: { driveName } }, { keep: !replace });
}

const DB_doc = async (DB, id) => { const r = await DB.prepare('SELECT data FROM board_docs WHERE id = ?').bind(id).first(); return r ? cleanDoc(parse(r.data)) : null; };
/**
 * A signature taken off (a copy added for the wrong member, say): the row goes into the chain whole ('taken-off'),
 * its copy marked superseded (kept), the signature before it on an earlier wording back in its place. `by`, `evidence`: the admin taking it off → { row, earlier } | false
 */
export async function unsignDoc(env, docId, slug, year = thisYear(), { by = '', evidence = {}, reason = '' } = {}) {
  await ensureSchema(env.DB);
  const DB = env.DB;
  const done = await appendEvents(DB, async () => {
    const row = await DB.prepare('SELECT * FROM board_signatures WHERE doc_id = ? AND slug = ? AND year = ?').bind(docId, slug, year).first();
    if (!row) return { result: false };
    const doc = await DB_doc(DB, docId);
    const counted = (Number(row.version) || 0) >= (doc?.signFrom || 0);
    const earlier = counted ? await DB.prepare('SELECT * FROM board_signatures_earlier WHERE doc_id = ? AND slug = ? AND year = ? ORDER BY version DESC LIMIT 1').bind(docId, slug, year).first() : null;
    const at = nowIso();
    const stmts = [DB.prepare('DELETE FROM board_signatures WHERE doc_id = ? AND slug = ? AND year = ?').bind(docId, slug, year)];
    if (row.file_id) stmts.push(DB.prepare('UPDATE board_files SET superseded_at = ?1 WHERE (id = ?2 OR id = (SELECT original_id FROM board_files WHERE id = ?2)) AND superseded_at IS NULL').bind(at, row.file_id));
    if (row.record_id) stmts.push(DB.prepare('UPDATE board_files SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL').bind(at, row.record_id));
    if (earlier) {
      stmts.push(putSignature(DB, 'board_signatures', earlier));
      stmts.push(DB.prepare('DELETE FROM board_signatures_earlier WHERE doc_id = ? AND slug = ? AND year = ? AND version = ?').bind(docId, slug, year, earlier.version));
    }
    const events = [{ kind: 'taken-off', docId, slug, year, version: Number(row.version) || 0, at, by, ip: evidence.ip, device: evidence.device, detail: { row, reason: String(reason || '').slice(0, 500), restored: earlier ? Number(earlier.version) || 0 : null } }];
    return { stmts, events, result: { row, earlier } };
  });
  return done || false;
}

// ─── Files ──────────────────────────────────────────────────────────

// Office files are ZIPs (docx, xlsx, pptx) or the older OLE kind (doc, xls); they always download
const OFFICE = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword', xls: 'application/vnd.ms-excel' };
export function fileTypeOf(bytes, name) {
  const found = sniffType(bytes);
  if (found) return found;
  const ext = String(name || '').toLowerCase().split('.').pop();
  const b = new Uint8Array(bytes.slice ? bytes.slice(0, 8) : bytes);
  if (['docx', 'xlsx', 'pptx'].includes(ext) && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return OFFICE[ext];
  if (['doc', 'xls'].includes(ext) && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return OFFICE[ext];
  return null;
}
const safeName = (n) => String(n || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^[.-]+/, '').slice(-100) || 'file';
const KNOWN_EXT = /\.(pdf|jpe?g|png|gif|webp|heic|heif|docx|xlsx|pptx|doc|xls)$/i;
/** Why a file can't be a board file ('' when it can): too big, or not what its name says, in plain words */
export async function boardFileProblem(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return 'No file came with that';
  if (file.size > MAX_FILE) return 'That file is over 50 MB';
  if (fileTypeOf(new Uint8Array(await file.arrayBuffer()), file.name)) return '';
  return KNOWN_EXT.test(file.name || '') ? `${file.name} isn’t what its name says (a .docx named .doc, or a picture named .pdf): open it and save it again as what it is` : 'Board files can be PDFs, pictures, or Word, Excel and PowerPoint files';
}
// A signed copy saved under the name it really is (a photo named .pdf is a .jpg)
const EXT_OF = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic' };

/**
 * Store an uploaded file for a meeting, a document, or a member's signed copy of a document (`signed`, always
 * staff-only: signWithCopy) → its row as the admin shows it
 */
/** New bytes under a file already kept: the same file, wherever it's linked, its words to be read again */
export async function rewriteFile(env, id, bytes) {
  const bucket = boardFiles(env);
  const row = await env.DB.prepare('SELECT r2_key, type FROM board_files WHERE id = ?').bind(id).first();
  if (!bucket || !row) return false;
  await bucket.put(row.r2_key, bytes, { httpMetadata: { contentType: row.type } });
  await env.DB.prepare('UPDATE board_files SET size = ?, sha256 = ?, words = NULL, words_v = NULL, words_next = NULL, words_try = NULL, words_at = NULL, words_fail = NULL, words_part = NULL WHERE id = ?').bind(bytes.byteLength, await sha256Hex(new Uint8Array(bytes)), id).run();
  return true;
}

export async function putFile(env, { ownerType, ownerId, file, kind = 'other', staffOnly = false, by = '', slug = null, originalId = null }) {
  await ensureSchema(env.DB);
  const bucket = boardFiles(env);
  if (!bucket) throw Object.assign(new Error('File storage isn’t set up (FILES)'), { status: 503 });
  // (the Advisory Board's papers and meetings keep their files here too, under their own owner types: ./advisory-file.js serves those)
  if (!['meeting', 'doc', 'signed', 'record', ...Object.keys(ADVISORY_OWNERS)].includes(ownerType) || !ID.test(String(ownerId || ''))) throw Object.assign(new Error('What is this file for?'), { status: 400 });
  // A signed copy or a signing record: staff-only, and always whose it is
  if (ownerType === 'signed' || ownerType === 'record') {
    staffOnly = true;
    if (!slug) throw Object.assign(new Error('Whose is it?'), { status: 400 });
  }
  const owner = ownerType === 'meeting'
    ? await env.DB.prepare('SELECT id FROM board_meetings WHERE id = ?').bind(ownerId).first()
    : await env.DB.prepare(`SELECT id FROM ${ADVISORY_OWNERS[ownerType] || 'board_docs'} WHERE id = ?`).bind(ownerId).first();
  if (!owner) throw Object.assign(new Error(`Save the ${ownerType === 'meeting' || ownerType === 'advisory-meeting' ? 'meeting' : 'document'} first`), { status: 404 });
  if (!file || typeof file.arrayBuffer !== 'function') throw Object.assign(new Error('No file came with that'), { status: 400 });
  if (file.size > MAX_FILE) throw Object.assign(new Error('That file is over 50 MB'), { status: 413 });
  const bytes = await file.arrayBuffer();
  const type = fileTypeOf(new Uint8Array(bytes), file.name);
  if (!type) throw Object.assign(new Error(await boardFileProblem(file)), { status: 415 });
  const id = uid('f_');
  let name = String(file.name || 'file').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 200) || 'file';
  const ext = EXT_OF[type];
  // (a signed copy: a photo of the page named .pdf is kept as the .jpg it is)
  if (ownerType === 'signed' && ext && !name.toLowerCase().endsWith(ext) && !(ext === '.jpg' && /\.jpeg$/i.test(name))) name = `${name.replace(/\.[a-z0-9]{2,5}$/i, '')}${ext}`;
  const key = `board/${ownerType}/${ownerId}/${id}-${safeName(name)}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  const fileKind = (ownerType === 'meeting' || ownerType === 'advisory-meeting' ? FILE_KINDS.map((k) => k.id) : ['other']).includes(kind) ? kind : 'other';
  const sha256 = await sha256Hex(new Uint8Array(bytes));
  await env.DB.prepare('INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by, slug, sha256, original_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, ownerType, ownerId, key, name, type, bytes.byteLength, fileKind, staffOnly ? 1 : 0, nowIso(), by, slug, sha256, originalId).run();
  return { id, name, type, size: bytes.byteLength, kind: fileKind, staffOnly: !!staffOnly, at: nowIso(), sha256 };
}

export async function updateFile(DB, id, { kind, staffOnly, name } = {}) {
  await ensureSchema(DB);
  const row = await DB.prepare('SELECT * FROM board_files WHERE id = ?').bind(id).first();
  if (!row) throw Object.assign(new Error('That file is gone'), { status: 404 });
  const next = {
    kind: kind !== undefined && FILE_KINDS.some((k) => k.id === kind) ? kind : row.kind,
    staff: staffOnly !== undefined ? (staffOnly ? 1 : 0) : row.staff_only,
    name: name !== undefined && String(name).trim() ? String(name).replace(/[\u0000-\u001F]/g, '').trim().slice(0, 200) : row.name,
  };
  await DB.prepare('UPDATE board_files SET kind = ?, staff_only = ?, name = ? WHERE id = ?').bind(next.kind, next.staff, next.name, id).run();
  if (next.staff && row.owner_type === 'doc') await closeToAdvisors(DB, row.owner_id);
  return { id, kind: next.kind, staffOnly: !!next.staff, name: next.name };
}

export async function deleteFile(env, id) {
  const row = await env.DB.prepare('SELECT r2_key FROM board_files WHERE id = ?').bind(id).first();
  if (!row) return false;
  await boardFiles(env)?.delete(row.r2_key).catch(() => {});
  await env.DB.prepare('DELETE FROM board_files WHERE id = ?').bind(id).run();
  return true;
}

/**
 * A stored file read with the agenda rules (minutes uploaded after the
 * meeting, an old agenda): Word read here, a PDF through Workers AI.
 * → { sections, attendance, date, start, end, location, unmatched } or null when it can't be read
 */
export async function readFileAsAgenda(env, id) {
  const row = await env.DB.prepare('SELECT * FROM board_files WHERE id = ?').bind(id).first();
  if (!row) throw Object.assign(new Error('That file is gone'), { status: 404 });
  const obj = await boardFiles(env)?.get(row.r2_key);
  if (!obj) throw Object.assign(new Error('That file is gone'), { status: 404 });
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const { fileText } = await import('./_board-mail.js');
  const text = await fileText(env, { name: row.name, bytes });
  if (!text) return null;
  const people = await roster(env.DB);
  const parsed = parseAgendaText(text, [
    ...people.board.map((p) => ({ slug: p.slug, name: p.name, org: p.organization, kind: 'board' })),
    ...people.staff.map((p) => ({ slug: p.slug, name: p.name, org: 'SOARD', kind: 'staff' })),
  ]);
  return parsed.sections.some((s) => s.items.length) ? parsed : null;
}

/**
 * The file's row if this person may open it: admins any; a member only a meeting's on the board page (boardCopy) or a
 * shared document's, never staff-only, and their own signed copy (`member`). On a meeting ahead not shared yet, who
 * presents in it opens their own items' documents, in the window they write their reports in (presentedBy), as their
 * report and its documents are theirs to write and add to there; nothing else of it
 */
export async function fileFor(DB, id, { admin = false, member = null } = {}) {
  await ensureSchema(DB);
  if (!ID.test(String(id || ''))) return null;
  const row = await DB.prepare('SELECT * FROM board_files WHERE id = ?').bind(id).first();
  if (!row) return null;
  if (admin) return row;
  if (row.owner_type === 'signed' || row.owner_type === 'record') {
    if (!member?.slug) return null;
    if (row.superseded_at) return null;
    // (their own at the moment of their own rename too: sameMember)
    if (row.slug) return await sameMember(DB, row.slug, member.slug) ? row : null;
    // (a copy from before files said whose: the signature it was added for, this year's or an earlier wording's)
    const sig = await DB.prepare('SELECT slug FROM board_signatures WHERE file_id = ?1 UNION SELECT slug FROM board_signatures_earlier WHERE file_id = ?1').bind(id).first();
    return sig && await sameMember(DB, sig.slug, member.slug) ? row : null;
  }
  if (row.staff_only) return null;
  if (row.owner_type === 'meeting') {
    const m = await getMeeting(DB, row.owner_id);
    if (boardCopy(m)?.files.some((f) => f.id === row.id)) return row;
    return (await presentedBy(DB, m, member)).some((it) => it.docs.includes(row.id)) ? row : null;
  }
  const doc = await DB.prepare('SELECT data FROM board_docs WHERE id = ?').bind(row.owner_id).first();
  return doc && cleanDoc(parse(doc.data)).shared ? row : null;
}

// ─── The numbers (the packet's, and the board page's) ───────────────

/**
 * The money in the bank right now: Mercury's checking and savings (live), and each bank connected through Plaid
 * in Settings → Bank balances (Chase's checking and CD, as Plaid last read them) →
 * { total, mercuryTotal (null without Mercury), accounts: [{ bank, name, kind, balance }], owed: [credit cards: { bank, name, balance, limit }],
 *   banksAt, stale: [banks not read in a day and a half], at } or null with neither
 */
export async function cashNow(env, { fetchImpl = fetch } = {}) {
  const mercuryOn = !!String(env.MERCURY_API_TOKEN || '').trim();
  const [m, banks] = await Promise.all([
    mercuryOn ? mercury(env, '/accounts', { fetchImpl }).then((r) => r?.accounts || []) : null,
    bankBalances(env.DB).catch((err) => { console.error('[board] banks', err.message); return null; }),
  ]);
  if (!m && !banks) return null;
  // Mercury's own accounts only: a bank linked in Mercury for transfers isn't SOARD's Mercury money (Plaid counts it)
  const merc = (m || [])
    .filter((a) => !['deleted', 'archived', 'closed'].includes(String(a.status || '').toLowerCase()) && !/external/i.test(`${a.kind} ${a.type}`) && typeof a.currentBalance === 'number')
    .map((a) => ({ bank: 'Mercury', name: a.nickname || a.name || 'Account', kind: a.kind || '', balance: Math.round(a.currentBalance * 100) / 100 }));
  const sum = (l) => Math.round(l.reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const accounts = [...(banks?.accounts || []).map(({ at, ...a }) => a), ...merc];
  return { total: sum(accounts), mercuryTotal: m ? sum(merc) : null, accounts, owed: (banks?.owed || []).map(({ at, ...a }) => a), banksAt: banks?.at || null, stale: banks?.stale || [], at: nowIso() };
}

/** The balance at the end of each month the heartbeat saw (last 24), newest first */
export async function cashHistory(DB) {
  await ensureSchema(DB);
  return ((await DB.prepare('SELECT month, total, at FROM board_cash WHERE total > 0 ORDER BY month DESC LIMIT 24').all()).results || []).map((r) => ({ month: r.month, total: r.total, at: r.at }));
}

/** JobTread's Status for a family approved and waiting on the money to start */
export const AWAITING_FUNDING = 'Awaiting Funding';

/**
 * Open makeovers by JobTread status, the building ones with their kid or
 * community project → { byStatus, building: [{ jobId, name, slug, status, year, url?, kind? }], waiting: [same, Awaiting
 * Funding], open: { [jobId]: status } } (15-minute copy). A project carries kind 'community', and its url only
 * once its page is public. `open` is every open job's status ('' for none): the board's families find where their
 * makeover is by it (./_board-families.js stageOf).
 */
export async function projectsNow(env, { fetchImpl = fetch, now = Date.now(), fresh = false } = {}) {
  const cached = await readState(env.DB, 'projects');
  // (a copy from before `open` was kept is read again)
  if (!fresh && cached.at && now - Date.parse(cached.at) < 15 * 60 * 1000 && cached.value?.open) return cached.value;
  if (!env.JOBTREAD_GRANT_KEY) return cached.value || null;
  try {
    const [jobs, kids, projects] = await Promise.all([fetchJobs(env.JOBTREAD_GRANT_KEY, fetchImpl), loadKids(env.DB).catch(() => []), loadProjects(env.DB, { drafts: true }).catch(() => [])]);
    const byStatus = {};
    const building = [];
    // Families approved and waiting on the money to start: the board's first column
    const waiting = [];
    const open = {};
    for (const job of jobs) {
      if (isRehearsalJob(job)) continue;
      const status = String((job.customFieldValues?.nodes || []).find((v) => v.customField?.id === FIELD_JOB_STATUS)?.value || '').trim();
      if (job.id) open[job.id] = status;
      if (!status) continue;
      byStatus[status] = (byStatus[status] || 0) + 1;
      const list = BUILDING_STATUSES.has(status) ? building : status === AWAITING_FUNDING ? waiting : null;
      if (!list) continue;
      const hit = matchProject(job.name, [...kids, ...projects], job.id);
      // The year in the job's name ("… (2026)"), for its season on the board page before it has a page or a reveal
      // (./_board-families.js makeoverSeason); only the year, never the name itself. QA round 7, Nov 21 2026
      const year = parseJobName(job.name).year || null;
      if (isProject(hit)) {
        // An organization, by its name and photo on Community even before it's published (the board is SOARD's
        // own; a child's name and photo wait for their page). Linked once its page is public
        list.push({ jobId: job.id || null, name: hit.name || null, slug: hit.page ? hit.slug : null, status, year, kind: 'community', url: hit.page || null, ...photoField(hit.heroImage) });
        continue;
      }
      const kid = hit;
      // By name only with a published kid page: a job's own name in JobTread is internal ("Not Published Yet"). Its photo likewise
      list.push({ jobId: job.id || null, name: kid?.name || null, slug: kid?.slug || null, status, year, ...photoField(kid?.name && kid.heroImage) });
    }
    const value = { byStatus, building, waiting, open };
    await writeState(env.DB, 'projects', { at: new Date(now).toISOString(), value });
    return value;
  } catch (err) {
    console.error('[board] projects', err.message);
    return cached.value || null;
  }
}

/**
 * Kids served and rooms built, the way the site counts them (src/utils/stats.ts): finished makeovers only (one in
 * build or awaiting funding isn't served or built yet). The community projects' own figures aren't added up: they're
 * yearly rates, families and clients, not one count of children (Nov 21 2026)
 */
async function impact(DB) {
  const read = async (table) => { try { return ((await DB.prepare(`SELECT slug, data FROM ${table}`).all()).results || []).map((r) => ({ slug: r.slug, ...parse(r.data) })).filter((d) => d.publishStatus !== 'draft'); } catch { return []; } };
  const [all, community] = await Promise.all([read('kids'), read('community')]);
  const kids = all.filter((k) => (k.status || 'completed') === 'completed');
  return {
    kids: kids.reduce((s, k) => s + (Number(k.childCount) || 1), 0),
    rooms: kids.reduce((s, k) => s + (Number(k.roomCount) || 1), 0),
    communityProjects: community.length,
    years: Number(todayEastern().slice(0, 4)) - 2012,
    // Each year's kids served, rooms built and makeovers (a published profile is one), counted as the admin's
    // Dashboard does; every year from the first through this one, so a quiet year shows as one
    byYear: byYear(kids),
  };
}
function byYear(kids) {
  const by = new Map();
  for (const k of kids) {
    const y = Number(k.year);
    if (!(y > 2000 && y < 2100)) continue;
    const r = by.get(y) || { year: y, kids: 0, rooms: 0, makeovers: 0, profiles: [] };
    const n = Number(k.childCount) || 1;
    const rooms = Number(k.roomCount) || 1;
    r.kids += n;
    r.rooms += rooms;
    r.makeovers += 1;
    // Each makeover by its published page: the kid's name, page and photo (for Explore by year)
    r.profiles.push({ name: String(k.name || ''), slug: String(k.slug || ''), kids: n, rooms, ...photoField(k.heroImage || k.photos?.[0]?.url) });
    by.set(y, r);
  }
  if (!by.size) return [];
  const first = Math.min(...by.keys());
  const last = Math.max(Number(todayEastern().slice(0, 4)), ...by.keys());
  return Array.from({ length: last - first + 1 }, (_, i) => by.get(first + i) || { year: first + i, kids: 0, rooms: 0, makeovers: 0, profiles: [] });
}

/** Events from today on (and the last 120 days), soonest first */
async function eventsList(DB, today = todayEastern()) {
  let rows = [];
  try { rows = ((await DB.prepare('SELECT slug, data FROM events').all()).results || []).map((r) => ({ slug: r.slug, ...parse(r.data) })); } catch { return { upcoming: [], recent: [] }; }
  const keep = rows.filter((e) => isDate(e.date) && e.publishStatus !== 'draft')
    .map((e) => ({ slug: e.slug, title: String(e.title || '').trim(), date: e.date, endDate: isDate(e.endDate) ? e.endDate : e.date, time: e.time || '', location: e.location || '', url: `/events/${e.slug}/` }));
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - 120 * 86_400_000).toISOString().slice(0, 10);
  return {
    upcoming: keep.filter((e) => e.endDate >= today).sort((a, b) => a.date.localeCompare(b.date)),
    recent: keep.filter((e) => e.endDate < today && e.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

const revealRow = (r, photos = {}) => ({ slug: r.slug, name: r.name, confirmed: r.confirmed !== false, date: r.date || '', time: r.time || '', window: r.window || null, kidUrl: r.kidUrl || `/kids/${r.slug}/`, ...photoField(r.name && (photos[r.slug] || r.image)) });
/** A published page's photo, from Cloudflare Images only (the board page's pictures come from nowhere else) */
const photoOf = (url) => (/^(https:\/\/imagedelivery\.net\/|\/cdn-cgi\/imagedelivery\/)[\w/=,.-]+$/.test(String(url || '')) ? String(url) : null);
/** { photo } when there's one to show, else nothing */
const photoField = (url) => (photoOf(url) ? { photo: photoOf(url) } : {});

// ─── Finance summaries from Job Costs ───────────────────────────────
// The money in and out (12 months by makeovers, store and operating, the year
// so far against last year, the cash forecast, the month's close) comes from
// the finance module, which registers itself here when it ships:
//   provideBoardFinance(boardFinance)   in functions/api/_finance.js
// so the board never imports Job Costs code, and shows the section once it's there.
let financeSource = null;
export function provideBoardFinance(fn) { financeSource = typeof fn === 'function' ? fn : null; }

/** The finance summary (totals only, whole dollars), a 15-minute copy; null until the finance module is live or has history */
export async function boardFinanceNow(env, { now = Date.now(), fresh = false } = {}) {
  if (!financeSource || !env.DB) return null;
  const c = await readState(env.DB, 'finance');
  if (!fresh && c.at && now - Date.parse(c.at) < 15 * 60 * 1000) return c.value || null;
  try {
    const value = (await financeSource(env, { now })) || null;
    await writeState(env.DB, 'finance', { at: new Date(now).toISOString(), value });
    return value;
  } catch (err) {
    console.error('[board] finance', err.message);
    return c.value || null;
  }
}

/** Everything an agenda's live items show, as of now */
export async function liveNumbers(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const today = todayEastern(now);
  const [cash, projects, reveals, events, meetings, kids, finance, pages, books, costs, settings] = await Promise.all([
    cachedCash(env, { fetchImpl, now }),
    projectsNow(env, { fetchImpl, now }),
    cachedReveals(env, now).catch(() => ({ upcoming: [], past: [] })),
    eventsList(env.DB, today),
    listMeetings(env.DB),
    impact(env.DB),
    boardFinanceNow(env, { now }),
    loadKids(env.DB).catch(() => []),
    // The year's revenue and expenses so far, as QuickBooks last answered (Settings → QuickBooks)
    booksNow(env.DB, { now }).catch(() => null),
    // What finished makeovers cost, and the families waiting on the money (./_makeover-costs.js)
    // (the heartbeat's copy: a page never waits on JobTread for it)
    makeoverCostsNow(env, { fetchImpl, now, maxAge: PAGE_MAX_AGE_MS }).catch((err) => { console.error('[board] costs', err.message); return null; }),
    readSettings(env.DB).catch(() => ({})),
  ]);
  // Each reveal's kid by their published page's photo (a draft page's kid has none)
  const photos = Object.fromEntries(pages.map((k) => [k.slug, photoOf(k.heroImage)]).filter(([, p]) => p));
  // The cash shows once a bank holds money: Chase through Plaid, Mercury once SOARD's money moves there (Oct 2026
  // on). Mercury's own record (the finance summary) speaks for SOARD only once Mercury itself holds money
  const funded = !!cash && cash.total > 0;
  const inMercury = cash ? cash.mercuryTotal ?? cash.total : null;
  return {
    at: new Date(now).toISOString(),
    cash: funded ? cash : null,
    mercury: cash && inMercury !== null ? { empty: !(inMercury > 0), at: cash.at } : null,
    finance,
    books,
    projects,
    reveals: (reveals.upcoming || []).map((r) => revealRow(r, photos)),
    pastReveals: (reveals.past || []).map((r) => revealRow({ ...r, confirmed: true }, photos)),
    events: events.upcoming,
    recentEvents: events.recent,
    // The board meetings ahead the board can see (boardSees: shared, or on their calendars already), never one Board
    // keeps off the board page
    meetings: meetings.filter((m) => isDate(m.date) && m.date >= today && boardSees(m, today)).sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ id: m.id, name: meetingName(m), date: m.date, start: m.start, shared: m.shared })),
    // The year's board meetings, held and ahead (the screen's "2026 board meetings"), the same ones
    thisYear: meetings.filter((m) => isDate(m.date) && m.date.slice(0, 4) === today.slice(0, 4) && boardSees(m, today)).sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ id: m.id, name: meetingName(m), date: m.date, start: m.start, shared: m.shared })),
    impact: kids,
    costs,
    operating: { balance: Number(settings?.operatingBalance) > 0 ? Math.round(Number(settings.operatingBalance)) : OPERATING_BALANCE },
  };
}

/** Read the cash now and keep it as the board page's copy (System → Settings calls this when a bank is connected, read or disconnected) */
export async function saveCashNow(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const value = await cashNow(env, { fetchImpl });
  await writeState(env.DB, 'cash', { at: new Date(now).toISOString(), value });
  return value;
}

async function cachedCash(env, { fetchImpl, now }) {
  const c = await readState(env.DB, 'cash');
  if (c.at && now - Date.parse(c.at) < 60 * 60 * 1000) return c.value || null;
  try {
    return await saveCashNow(env, { fetchImpl, now });
  } catch (err) {
    console.error('[board] cash', err.message);
    return c.value || null;
  }
}

/**
 * A packet's locked numbers as the board sees them: its lists of meetings (the next ones, the year's) hold only board
 * meetings the board can see (boardSees, whenever they are), so a snapshot locked before that rule never shows one kept
 * off the board page. `meetings`: every meeting, when they're at hand
 */
export function snapshotFor(snapshot, meetings) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot || null;
  const ok = new Set(meetings.filter((x) => boardSees(x, '')).map((x) => x.id));
  const keep = (list) => (Array.isArray(list) ? list.filter((x) => ok.has(x?.id)) : list);
  return { ...snapshot, meetings: keep(snapshot.meetings), thisYear: keep(snapshot.thisYear) };
}
/** The same, reading only the meetings it names (the live screen asks every few seconds) */
async function boardSnapshot(DB, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const ids = [...new Set([...(snapshot.meetings || []), ...(snapshot.thisYear || [])].map((x) => String(x?.id || '')).filter((x) => ID.test(x)))];
  const rows = ids.length ? (await DB.prepare(`SELECT data FROM board_meetings WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results || [] : [];
  return snapshotFor(snapshot, rows.map((r) => cleanMeeting(parse(r.data))));
}

/**
 * Lock today's numbers into a meeting's packet. Reading them takes a while (the banks, JobTread, QuickBooks), so the
 * snapshot is put onto the meeting as it is then (patchMeeting): what was saved meanwhile stays
 */
export async function takeSnapshot(env, id, { by, fetchImpl = fetch, now = Date.now() } = {}) {
  const m = await getMeeting(env.DB, id);
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  const n = await liveNumbers(env, { fetchImpl, now });
  const snapshot = { at: n.at, by: by || '', cash: n.cash, mercury: n.mercury, finance: n.finance, books: n.books, projects: n.projects, reveals: n.reveals, pastReveals: n.pastReveals, events: n.events, recentEvents: n.recentEvents, meetings: n.meetings.filter((x) => x.id !== id), thisYear: n.thisYear || [], impact: n.impact, costs: n.costs, operating: n.operating };
  // (the server's own field, from the numbers, never from the meeting: one write, never lost to an edit saved meanwhile)
  const saved = await setOnMeeting(env.DB, id, { snapshot }, { by });
  if (!saved) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  return saved;
}

// ─── The packet email ───────────────────────────────────────────────

/**
 * Who gets the packet (and the minutes notice, the reminder to answer the invite, the sign-in email): the active board
 * with an email on file. A read that fails throws, said as nothing sent (never a send to fewer, nor "no email on file")
 */
export async function packetList(DB) {
  const board = await activeBoard(DB).catch((e) => { throw asSend(e); });
  return board.filter((p) => p.email).map((p) => ({ slug: p.slug, name: p.name, email: p.email }));
}

const FOOTER = 'You’re getting this as a member of the Sunshine on a Ranney Day Board of Directors.';
const fromBoard = () => EMAIL_FROM.replace(/^[^<]*/, 'SOARD Board ');
// From a person, through the board's address: "Sam Ortiz via SOARD Board", quoted (a name may have a period or a
// comma), a phone's curly apostrophe kept as a plain one; no one, the board's own
const viaBoard = (who) => (who ? EMAIL_FROM.replace(/^[^<]*/, `"${who.replace(/[‘’]/g, "'").replace(/["\\<>\r\n]/g, '').trim()} via SOARD Board" `) : fromBoard());
// A meeting's link in an email or an invite: /board/<id> (public/_redirects) keeps its place through Cloudflare's sign-in,
// where a #/ link lands a signed-out board member on Home. Places inside it: /board/<id>/report/<item> and /board/<id>/review
const meetingUrl = (m) => `${SITE}/board/${m.id}`;
const whenOf = (m) => [longDate(m.date), timeRange(m.start, m.end)].filter(Boolean).join(', ');
const placeOf = (m) => [m.location, m.address].filter(Boolean).join(', ');
// A title or an initial isn't a first name: "Dr. Lee Park" → Lee, "J. Michael Ortiz" → Michael, "Ortiz, Sam" → Sam
const firstName = (name) => String(name || '').replace(/^([^,]+),\s*(?!\s|(?:jr|sr|ii|iii|iv|md|phd|esq|cpa)\b)(.+)$/i, '$2').trim().split(/\s+/).find((w) => w && !/^(dr|mr|mrs|ms|mx|rev|hon|prof|sir|judge)\.?$/i.test(w) && !/^\p{L}\.?$/u.test(w)) || '';
// A call link as people read it: meet.google.com/abc-defg-hij
const bareLink = (url) => String(url).replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
const SIGN_IN = 'Sign in with this email address. You’ll get a one-time code by email.';
const small = (html) => `<p class="muted" style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#5A5B61;">${html}</p>`;
const ruled = (html) => `<div class="rule" style="margin:24px 0 0;padding:20px 0 0;border-top:1px solid #E5E4E0;">${html}</div>`;

/**
 * When, where and the video call as an email's fact rows (`more`: [label, html] rows after them; `noPlace`: what the
 * Where row says when the meeting has no place, left out when there's nothing to say)
 */
function meetingFacts(m, more = [], { noPlace = '' } = {}) {
  const video = videoOf(m);
  return facts([
    // ("10:00 AM" stays together on a phone)
    ['When', esc(whenOf(m)).replace(/ (AM|PM)\b/g, '&nbsp;$1')],
    ['Where', esc(placeOf(m)) || noPlace],
    ['Video', video ? `${esc(callName(video))}: <a class="lnk" href="${esc(video)}" style="color:#2B6CB0;">${esc(bareLink(video))}</a>` : ''],
    ['Notes', m.inviteNote ? esc(m.inviteNote).replace(/\n/g, '<br>') : ''],
    ...more,
  ]);
}
const factsText = (m) => [whenOf(m) && `When: ${whenOf(m)}`, placeOf(m) && `Where: ${placeOf(m)}`, videoOf(m) && `Video (${callName(videoOf(m))}): ${videoOf(m)}`, m.inviteNote && `Notes: ${m.inviteNote}`].filter(Boolean).join('\n');

/**
 * "Will you be there?": answered on the calendar invite and nowhere else (Peter, Nov 2 2026). `from`: the name of
 * whoever the invite comes from, so they know which one to look for
 */
const answerAsk = (from = '') => `Answer the calendar invite${from ? ` from ${from}` : ''}: yes, no or maybe. That’s where SOARD sees who’s coming.`;
/** Who a staff address is on People → Team (first@soardcharity.com), else null */
export const staffFor = (people, email) => {
  const e = String(email || '').toLowerCase();
  return (e && people.staff.find((p) => e.startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`))) || null;
};
/** Who a meeting's invite comes from: whoever Board's invite went out from, else Settings' */
const inviteOwner = (m, settings) => m.invite?.organizer || settings?.invitesFrom || '';
/** …by name */
function inviteFrom(m, people, settings) {
  return staffFor(people, inviteOwner(m, settings))?.name || '';
}

/**
 * The agenda as an email shows it, part by part the way the board page runs it: when each part starts, its items and who
 * presents each. Never a motion or a vote: those are the board page's. A board-only item is counted, never named. → [{ title, at, open, hidden }]
 */
export function agendaParts(m, people = []) {
  const plan = sectionPlan(m);
  return (m.sections || []).flatMap((s) => {
    const items = s.items.filter(isFilled);
    const open = items.filter((it) => !it.confidential).map((it) => {
      // Those picked by name and the guests typed in beside them (presentersOf, as the board page names them), else
      // the line as it was typed: "Dana Smith, CPA" and "A&M Partners" are one presenter
      const named = presentersOf(it, people);
      const picked = named.some((p) => p.slug && (it.who || []).includes(p.slug));
      return { title: it.title || LIVE_TITLES[it.live] || '', by: picked ? namesText(named.map((p) => p.name)) : String(it.presenter || '').trim() || namesText(it.guests || []) };
    }).filter((it) => it.title || it.by);
    const hidden = items.filter((it) => it.confidential).length;
    const title = partName(s, m);
    return title || open.length || hidden ? [{ title, at: clock(plan.get(s.id)?.start), open, hidden }] : [];
  });
}
const muted = (text) => `<span class="muted" style="color:${MUTED};">${text}</span>`;
function partHtml(p) {
  // (each on its own paragraph with a little air: on a phone a wrapped line must not read as the next item)
  const row = (html) => `<p style="margin:4px 0 0;">${html}</p>`;
  const items = p.open.map((it) => row(muted(esc([it.title, it.by].filter(Boolean).join(' · ')))));
  return [p.title ? `<strong>${esc(p.title)}</strong>` : '', ...items, p.hidden ? row(muted(plural(p.hidden, 'board-only item'))) : ''].filter(Boolean).join('');
}
const partText = (p) => [[p.at, p.title].filter(Boolean).join('  '),
  ...p.open.map((it) => `- ${[it.title, it.by && `(${it.by})`].filter(Boolean).join(' ')}`),
  p.hidden ? `- ${plural(p.hidden, 'board-only item')}` : ''].filter(Boolean).join('\n');
const headed = (title) => `<h2 class="ink" style="margin:28px 0 10px;font-family:${SERIF};font-size:17px;line-height:1.3;font-weight:700;color:${INK};">${esc(title)}</h2>`;
// (one row of what's asked of them: a hairline between rows)
const askRow = (html, i) => `<div class="rule" style="${i ? 'margin:14px 0 0;padding:14px 0 0;border-top:1px solid #E5E4E0;' : ''}">${html}</div>`;
// (a meeting with no times has no left column to line up: its parts stacked)
const stacked = (html) => `<div class="ink" style="margin:0 0 12px;font-size:14px;line-height:20px;">${html}</div>`;
const rowTitle = (html) => `<p class="ink" style="margin:0 0 4px;font-weight:700;">${html}</p>`;

/** The items someone presents at a meeting, each with the page to write its report on: [{ title, url, written, private }] */
export function reportsFor(m, slug, people = []) {
  if (!slug) return [];
  return m.sections.flatMap((s) => s.items.filter((it) => reportsOn(it) && presentersOf(it, people).some((p) => p.slug === slug))
    // (a board-only item's name never leaves here: its presenter reads it on the board page)
    .map((it) => ({ title: it.confidential ? '' : it.title || LIVE_TITLES[it.live] || partName(s, m) || 'an agenda item', url: `${meetingUrl(m)}/report/${it.id}`, written: !!it.report, private: !!it.confidential })));
}

/**
 * The agenda email, for one board member: everything stays on the board page (nothing is attached; the board reads
 * it there, the meeting presents it from there, and Print it all is there for paper), and what the email says is
 * what they'd want before opening it. Say only what's true of this meeting: no "documents" when it has none. In order:
 * when, where and the call; the one button; what this person still owes before the meeting, soonest first (the calendar
 * invite when they haven't answered it, `ask`, naming whose it is, `from`; their reports, `reports`; the last minutes
 * up for a vote, `minutes`; this year's papers they haven't signed, `toSign`, each a title or { title, id, written },
 * one written in Board opening on its own page); then the agenda itself and the documents by name. A board-only item
 * or document is counted, never named. `files`: the documents' names. `people`: who to name as presenters. `test`: a
 * [Preview], which also says what the real email would quietly leave out.
 */
export function packetEmail(m, { test = false, files = [], private: hidden = 0, name: who = '', from = '', ask = true, reports = [], toSign = [], minutes = null, people = [] } = {}) {
  const name = meetingName(m);
  const first = firstName(who);
  const titles = files.map((n) => docTitle(n));
  const count = titles.length + hidden;
  const docs = count === 1 ? 'the document' : `the ${count} documents`;
  // (a meeting someone called "Q1 Board Meeting - Agenda" isn't that twice)
  const saysAgenda = /\bagenda\b/i.test(name);
  const heading = saysAgenda ? name : `${name} agenda`;
  const lead = `${first ? `${first}, please` : 'Please'} read the agenda${count ? ` and ${docs}` : ''} before the meeting. ${count ? 'They’re' : 'It’s'} on the board page, and you can print it all from there.`;
  const docsHtml = [...titles.map((t) => esc(t)), hidden ? `${plural(hidden, 'board-only document')}` : ''].filter(Boolean).join('<br>');
  // What they present: the report to write on the board page (or theirs, already in). A board-only item is never named
  const todo = reports.filter((r) => !r.written);
  // Each item by name, bold, joined in words (a title with "and" in it stays one title)
  const joined = (list) => (list.length > 2 ? `${list.slice(0, -1).join(', ')}, and ${list.at(-1)}` : list.join(' and '));
  const secret = reports.filter((r) => r.private).length;
  const secretName = secret === 1 ? 'a board-only item' : `${secret} board-only items`;
  const named = (mark) => [...new Set(reports.filter((r) => !r.private).map((r) => r.title))].map(mark).concat(secret ? [mark(secretName)] : []);
  // (two that read the same are told apart by number: the link is all that says which)
  const nth = (r, list) => (list.length > 1 ? list.indexOf(r) + 1 : 0);
  const reportOn = (r) => {
    const n = nth(r, reports.filter((x) => x.private === r.private && x.title === r.title));
    return r.private ? (n ? `board-only item ${n}` : 'the board-only item') : `${r.title}${n ? ` (${n})` : ''}`;
  };
  const several = todo.length > 1;
  const presentHow = todo.length
    ? `Write your report${several ? 's' : ''} on the board page. The board reads ${several ? 'them' : 'it'} there before the meeting, and ${several ? 'they’re' : 'it’s'} on the screen when you present.`
    : `Your report${reports.length > 1 ? 's are' : ' is'} in. You can change ${reports.length > 1 ? 'them' : 'it'} on the board page until the meeting.`;
  const reportLink = (r) => (r.written ? `Your report on ${reportOn(r)}` : reports.length > 1 ? `Write your report on ${reportOn(r)}` : 'Write your report');
  const presentHtml = !reports.length ? '' : `<p class="ink" style="margin:0 0 4px;">You present ${joined(named((t) => `<strong>${esc(t)}</strong>`))}</p>`
    + `<p class="ink" style="margin:0;">${esc(presentHow)}</p>`
    // (links, never buttons: a button can't wrap, and a long item's name would push a phone's email wide)
    + reports.map((r) => `<p style="margin:8px 0 0;">${link(reportLink(r), r.url)}</p>`).join('');
  // The papers every board member signs each year, while they haven't (a preview shows them for the meeting's year)
  const year = signYear(m, test);
  const papers = toSign.map((t) => (typeof t === 'string' ? { title: t } : t));
  // One paper opens on its own page, its words (or its file) and the signing at their end; more, on Documents
  // (/board/<id>: a #/ link loses its place through Cloudflare's sign-in, public/_redirects)
  const documentsUrl = `${SITE}/board/${papers.length === 1 && papers[0].id ? papers[0].id : 'documents'}`;
  const these = papers.length > 1 ? 'these' : 'this';
  const signWhy = papers.length && papers.every((t) => t.changed) ? `${these === 'this' ? 'This' : 'These'} changed since you signed.` : `Every board member signs ${these} once a year.`;
  const signHow = `${signWhy} Read ${papers.length > 1 ? 'them' : 'it'} on the board page and sign there, or add the copy you signed on paper.`;
  const signHtml = !toSign.length ? '' : rowTitle(`Still to sign for ${year}`)
    + `<p class="ink" style="margin:0;">${papers.map((t) => esc(`${t.title}${dueNote(t.due)}`)).join('<br>')}</p>` + small(esc(signHow))
    + `<p style="margin:8px 0 0;">${link(toSign.length > 1 ? 'Read and sign them' : 'Read and sign it', documentsUrl)}</p>`;
  const signText = !toSign.length ? '' : `Still to sign for ${year}: ${papers.map((t) => `${t.title}${dueNote(t.due)}`).join(', ')}. ${signHow}\n${documentsUrl}`;
  // The last meeting's minutes, up for a vote at this one: read first, on the board page. Replies go to Board's admins
  const minutesName = minutes ? `The minutes of the ${meetingName(minutes).replace(/^the\s+/i, '')}` : '';
  const minutesHow = 'The board votes on them at this meeting. Anything wrong? Suggest a correction on the page.';
  const minutesHtml = !minutes ? '' : rowTitle('Read before the vote')
    + `<p class="ink" style="margin:0;">${esc(minutesName)}</p>` + small(esc(minutesHow))
    + `<p style="margin:8px 0 0;">${link('Read the minutes', meetingUrl(minutes))}</p>`;
  const minutesText = !minutes ? '' : `Read before the vote: ${minutesName}. ${minutesHow}\n${meetingUrl(minutes)}`;
  const presentText = !reports.length ? '' : `You present ${joined(named((t) => (t === secretName ? t : `“${t}”`)))}. ${presentHow}\n${reports.map((r) => `${reportLink(r)}: ${r.url}`).join('\n')}`;
  const answerHtml = !ask ? '' : rowTitle('Will you be there?') + `<p class="ink" style="margin:0;">${esc(answerAsk(from))}</p>`;
  const asks = [answerHtml, presentHtml, minutesHtml, signHtml].filter(Boolean);
  // (a report already in is theirs to know, not something they still owe)
  const owed = (ask ? 1 : 0) + todo.length + (minutes ? 1 : 0) + toSign.length;
  const parts = agendaParts(m, people);
  const asksText = [ask ? `Will you be there? ${answerAsk(from)}` : '', presentText, minutesText, signText].filter(Boolean);
  const agendaHtml = parts.some((p) => p.at)
    ? facts([...parts.map((p) => [p.at, partHtml(p)]), ['Documents', docsHtml]])
    : [...parts.map((p) => stacked(partHtml(p))), docsHtml ? stacked(parts.length ? `<strong>Documents</strong><br>${docsHtml}` : docsHtml) : ''].join('');
  return {
    subject: `${test ? '[Preview] ' : ''}${saysAgenda ? '' : 'Agenda: '}${[name, shortDate(m.date).replace(/, \d{4}$/, '')].filter(Boolean).join(', ')}`,
    html: emailShell({
      eyebrow: 'SOARD Board',
      // (what the subject doesn't say comes first: an inbox shows this beside it)
      preheader: [owed ? `${plural(owed, 'thing')} for you before the meeting.` : `Read the agenda${count ? ` and ${docs}` : ''} before the meeting.`, whenOf(m) && `${whenOf(m)}.`].filter(Boolean).join(' '),
      heading,
      intro: esc(lead),
      bodyHtml: meetingFacts(m, [], { noPlace: test ? '<em>No place on this meeting yet. The real email leaves this row out.</em>' : '' })
        + `<div style="margin:18px 0 0;">${button('Open the agenda', meetingUrl(m), 'primary', { big: true })}</div>`
        + small(SIGN_IN)
        + (asks.length ? headed('Before the meeting') + panel(asks.map(askRow).join('')) : '')
        + (parts.length ? headed('On the agenda') + small('The board page always has the latest.') : count ? headed('Documents') : '')
        + (agendaHtml ? `<div style="margin:8px 0 0;">${agendaHtml}</div>` : ''),
      footerHtml: FOOTER,
    }),
    text: [`${heading}.`, lead, factsText(m),
      `Open the agenda: ${meetingUrl(m)}\n${SIGN_IN}`,
      asksText.length ? ['BEFORE THE MEETING', ...asksText].join('\n\n') : '',
      parts.length ? ['ON THE AGENDA', ...parts.map(partText)].join('\n\n') : '',
      count ? `Documents: ${[...titles, hidden ? plural(hidden, 'board-only document') : ''].filter(Boolean).join(', ')}` : ''].filter(Boolean).join('\n\n'),
  };
}

export { packetDocs };

/** Each email on its own: each member's has their own answer links */
const sendEach = (env, items, { tags, replyTo }) => sendEmailItems(env, items, { from: fromBoard(), tags, replyTo });

/** Who approved each agenda and when, by meeting: on the chair's review, by a reply to it, or a Board admin (./_board-asks.js chairApprove) */
export async function agendaApprovals(DB) {
  try {
    const rows = (await DB.prepare("SELECT meeting_id, name, in_at FROM board_asks WHERE kind = 'chair' AND status = 'approved'").all()).results || [];
    return Object.fromEntries(rows.map((r) => [r.meeting_id, { by: r.name || '', at: r.in_at || '' }]));
  } catch (err) {
    if (/no such table/i.test(err.message)) return {};
    throw err;
  }
}
/** Why a meeting ahead isn't on the board page yet: what the site says for every hold (holdUntilApproved, holdShare) */
const NOT_APPROVED = 'The agenda goes to the board once it’s approved';
/**
 * Nothing of a meeting still to be held reaches the board before its agenda is approved (Peter, Nov 5 2026: "no agenda
 * should go to the group until the agena is approved, and then the agenda can be sent out to the board"): not the board
 * page, not the email. The approval sends it by itself (sendApprovedAgenda). A meeting that's been held isn't held
 * back: it goes on the board page with its minutes. A practice meeting is the admins' alone. Throws a 409.
 */
export async function holdUntilApproved(DB, m) {
  // (board-shared.js waitsForApproval, the rule Board offers its sends by, so it never offers one this refuses; a save that
  // shares is holdShare's)
  if (!waitsForApproval(m)) return;
  if (!(await agendaApprovals(DB))[m.id]) throw Object.assign(new Error(NOT_APPROVED), { status: 409 });
}
/**
 * The same for a person's save that would put a meeting on the board page (saveMeeting), judged by what the save
 * changes: `current` is the copy the editor's base names (a stale copy was told to merge before this), so a save that
 * turns shared on is one this tab made, and a copy that only still says shared, as the site had it when the tab opened,
 * never comes here as a change (it was merged first). One on the board page already stays, whatever its day and
 * whatever it was before (one kept off the board page as "not a board meeting" that's shared stays shared:
 * notBoardAfter). One coming onto it waits for its agenda's approval while it's still to be held (shareWaits: sharing
 * one that isn't a board meeting makes it one, so it waits too; the editor offers Share by the same rule), by its day as
 * stored and as saved: a day changed in the same save never takes it past the approval. Refused by name (`refused`),
 * with the meeting as it is now (`meeting`), so the editor puts only that back, as the site has it, and saves the rest
 * (public/admin/board-meeting.js). A practice meeting never comes here (savePractice)
 */
async function holdShare(DB, current, m) {
  if (!m.shared || current.shared) return;
  if (![current, m].some((x) => shareWaits({ ...x, practice: false }))) return;
  if ((await agendaApprovals(DB))[m.id]) return;
  throw Object.assign(new Error(NOT_APPROVED), { status: 409, extra: { refused: ['shared'], meeting: current } });
}

// ─── A board email, once ────────────────────────────────────────────

/** A send that never finished lets the next one go after this */
const SEND_HOLD_MS = 2 * 60 * 1000;
/** Whoever had the email this recently isn't sent it again (a double press, a second tab, another admin) */
const SEND_AGAIN_MS = 10 * 60 * 1000;
/** Resend keeps an idempotency key a day: a send it never answered is asked for again with the same keys until then */
const SEND_REPLAY_MS = 23 * 60 * 60 * 1000;
const SEND_TO = { packet: 'the board', minutes: 'the board', remind: 'everyone who hasn’t answered' };
/** No answer from Resend (a timeout, a dropped connection, a gateway's 502, 503 or 504): it may have gone */
const noAnswer = (e) => !/^Resend \d+:/.test(String(e)) || /^Resend 50[234]:/.test(String(e));
const agoWords = (ms) => { const n = Math.floor(ms / 60000); return n < 1 ? 'a moment ago' : n === 1 ? 'a minute ago' : `${n} minutes ago`; };
/** A meeting Board keeps off the board page (notBoard), shared or not: an email to the board about it would open nothing */
const OFF_PAGE = 'This meeting is kept off the board page (it isn’t a board meeting), so an email about it would open nothing for the board.';
/** What an admin is told when Resend didn't answer a send to the board */
export const UNSURE_SEND = 'Resend didn’t answer, so these emails may have gone. Press it again: Resend sends each one only if it hasn’t already.';

/** The admin who sent it, by first name ('' for none, or the agenda's approval: `by` 'Board') */
async function senderFirst(DB, by) {
  if (!by || by === 'Board') return '';
  return firstName(staffFor(await roster(DB), by)?.name || '') || String(by).split('@')[0];
}

/**
 * A board email (the packet, the minutes notice, the reminder: `kind`) to `people` ([{ email, name, slug }]), each
 * their own (`itemFor(person)` → { to, subject, html, text }), sent once whatever presses it:
 *   - one send at a time per meeting and kind: another (a double press, a second tab, the other admin, the agenda's
 *     approval) is told it's going out (409), and a send that never finished lets the next go after two minutes
 *   - kept before Resend is asked (board_state `board-send:<kind>:<meeting>`): who had it when, so whoever had it in
 *     the last ten minutes isn't sent it again (all of them: 409, saying when it went), and a send cut off midway
 *     counts as gone
 *   - each send has its own number, and its Resend calls carry it as their idempotency key; a send Resend never
 *     answered is asked for again with the same number (to the same people), so Resend sends each only if it didn't
 * → { sent, failed, errors, unsure, reached: how many of `people` have had it, skipped: [names had it just now] }
 */
async function sendOnce(env, { kind, m, by = '', people, itemFor, tags, replyTo, now = Date.now() }) {
  const DB = env.DB;
  const key = `board-send:${kind}:${m.id}`;
  const hold = `${key}:sending`;
  await readState(DB, key); // (makes the table)
  const at = new Date(now).toISOString();
  const claimed = await DB.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE board_state.updated_at < ?')
    .bind(hold, JSON.stringify({ by }), at, new Date(now - SEND_HOLD_MS).toISOString()).run();
  // (whoever pressed it, by name: "you" when it's the one pressing now, in another tab. QA round 6, Nov 21 2026: Jane
  // was told "(Jane sent it)" as if someone else had)
  const mine = (e) => !!by && !!e && e !== 'Board' && normEmail(e) === normEmail(by);
  if (!claimed?.meta?.changes) {
    const other = (await readState(DB, hold)).by;
    const name = await senderFirst(DB, other);
    if (mine(other)) throw Object.assign(new Error(`You’re sending this email to ${SEND_TO[kind]} right now, maybe in another tab. It goes once, so there’s nothing to press.`), { status: 409, extra: { sending: true } });
    const who = other === 'Board' ? ': the agenda’s approval is sending it' : name ? ` (${name} is sending it)` : '';
    throw Object.assign(new Error(`This email is going out to ${SEND_TO[kind]} right now${who}. It goes once, so there’s nothing to press.`), { status: 409, extra: { sending: true } });
  }
  try {
    const was = await readState(DB, key);
    const had = Object.fromEntries(Object.entries(was.had || {}).filter(([, t]) => now - Date.parse(t) < 2 * 86_400_000));
    const byEmail = new Map(people.filter((p) => isEmail(p.email)).map((p) => [normEmail(p.email), p]));
    // A send Resend never answered, asked for again: the same people under the same number
    const again = was.unsure && Number(was.n) > 0 && now - Date.parse(was.at) < SEND_REPLAY_MS ? (was.to || []).map((e) => byEmail.get(e)).filter(Boolean) : [];
    const replay = again.length > 0;
    let recipients = again;
    let skipped = [];
    if (!replay) {
      const recent = [...byEmail.values()].filter((p) => had[normEmail(p.email)] && now - Date.parse(had[normEmail(p.email)]) < SEND_AGAIN_MS);
      recipients = [...byEmail.values()].filter((p) => !recent.includes(p));
      skipped = recent.map((p) => p.name);
      if (!recipients.length && recent.length) {
        const last = Math.max(...recent.map((p) => Date.parse(had[normEmail(p.email)])));
        const name = await senderFirst(DB, was.by);
        if (mine(was.by)) throw Object.assign(new Error(`You sent this email to ${SEND_TO[kind]} ${agoWords(now - last)}, maybe in another tab, so it didn’t go again. It can go again 10 minutes after the last one.`), { status: 409, extra: { already: true } });
        const who = was.by === 'Board' ? ' when its agenda was approved' : name ? ` (${name} sent it)` : '';
        throw Object.assign(new Error(`This email went to ${SEND_TO[kind]} ${agoWords(now - last)}${who}, so it didn’t go again. It can go again 10 minutes after the last one.`), { status: 409, extra: { already: true } });
      }
    }
    if (!recipients.length) return { sent: 0, failed: 0, errors: [], reached: 0, skipped };
    const n = replay ? Number(was.n) : (Number(was.n) || 0) + 1;
    const emails = recipients.map((p) => normEmail(p.email));
    // Kept before it goes: a send cut off midway (the page closed, the Worker stopped, no answer) counts as gone
    const record = { n, at, by, to: emails, unsure: true, had: { ...had, ...Object.fromEntries(emails.map((e) => [e, replay ? had[e] || at : at])) } };
    await writeState(DB, key, record);
    try {
      const r = await sendEmailItems(env, recipients.map(itemFor), { from: fromBoard(), tags, replyTo, idempotencyKey: `board-${kind}:${m.id}:${n}` });
      const unsure = r.failed > 0 && r.errors.some(noAnswer);
      const refused = new Set((r.refused || []).map(normEmail));
      // Resend's own no: nobody in that call has it. (Asked again under the same key, Resend would have answered with the
      // first try's success had that gone: its no means the first try didn't either.) They're as they were before it
      const after = { ...record.had };
      for (const e of refused) { if (!replay && had[e]) after[e] = had[e]; else delete after[e]; }
      await writeState(DB, key, { ...record, had: after, unsure: unsure || undefined });
      return { sent: r.sent + (r.already || 0), failed: r.failed, errors: r.errors, unsure: unsure || undefined, reached: [...byEmail.keys()].filter((e) => after[e]).length, skipped };
    } catch (err) {
      // (anything that stops it from here on may come after the emails went: never taken for nothing sent)
      throw mayHaveGone(err);
    }
  } finally {
    // (a hold that won't come off stops the next send for two minutes at most, never this one's answer)
    await DB.prepare('DELETE FROM board_state WHERE key = ?').bind(hold).run().catch((err) => console.error('[board] send hold', err.message));
  }
}
/** An error after a board email may have gone (`went`): whatever would send it again leaves it to the send's own record */
const mayHaveGone = (err) => Object.assign(err instanceof Error ? err : new Error(String(err)), { went: true });

/**
 * Email the board the link to the agenda and documents, what the documents are, and (to who hasn't answered it) the
 * calendar invite to answer (test: only `to`), once (sendOnce). What it keeps on the meeting is its own two fields,
 * written onto the meeting as it is now (patchMeeting): a report or an edit saved while it was going out stays
 */
export async function sendPacket(env, id, { by, to = null, replyTo = [] } = {}) {
  const m = await getMeeting(env.DB, id);
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  if (!emailConfigured(env)) throw Object.assign(new Error('Email isn’t set up (RESEND_API_KEY)'), { status: 503 });
  const test = Array.isArray(to);
  if (!test) await holdUntilApproved(env.DB, m);
  if (!test && m.notBoard) throw Object.assign(new Error(OFF_PAGE), { status: 409 });
  if (!test && !m.shared) throw Object.assign(new Error('Share the meeting with the board first, so the button has something to open'), { status: 409 });
  const people = test ? to.map((email) => ({ email, name: '' })) : await packetList(env.DB);
  if (!people.length) throw Object.assign(new Error('No board member has an email on file (People → Board)'), { status: 409 });
  const docs = packetDocs(m);
  // An email saying "read the agenda" with no agenda helps no one (Send me the email still shows how it would look).
  // The same test Board's Approve goes by, so an agenda that can be approved can always be sent
  if (!test && !agendaItems(m).length && !agendaParts(m).length && !docs.names.length && !docs.hidden) throw Object.assign(new Error('The agenda is empty: add to it before emailing the board'), { status: 409 });
  // Only someone on the invite who hasn't answered it is asked to
  const open = test ? [] : (await notAnswered(env, m)).map((p) => p.slug);
  const from = inviteFrom(m, await roster(env.DB), await getSettings(env.DB));
  // Each presenter's own copy asks for their report (a preview shows none: it's for no one in particular); the agenda names them
  const everyone = await roster(env.DB).then((r) => [...r.board, ...r.staff]);
  // …and each member's, the papers they haven't signed this year (a preview shows them all)
  const signable = signablePapers(await listDocs(env.DB));
  const year = signYear(m, test);
  const toSign = (p) => signable.filter((d) => !(p.slug && (d.signed[p.slug] || d.declined?.[p.slug])))
    .map((d) => ({ title: d.title, id: d.id, written: !!d.body, due: dueOn(d, year), changed: !!(p.slug && d.earlier?.includes(p.slug)) }));
  const minutes = minutesToRead(m, await listMeetings(env.DB));
  const itemFor = (p) => ({ to: p.email, ...packetEmail(m, { test, files: docs.names, private: docs.hidden, name: p.name, from, ask: test || open.includes(p.slug), reports: reportsFor(m, p.slug, everyone), toSign: toSign(p), minutes, people: everyone }) });
  const tags = [{ name: 'kind', value: test ? 'board-packet-preview' : 'board-packet' }];
  if (test) {
    const r = await sendEach(env, people.map(itemFor), { tags, replyTo });
    return { sent: r.sent, failed: r.failed, errors: r.errors, to, documents: docs.names.length + docs.hidden };
  }
  const r = await sendOnce(env, { kind: 'packet', m, by, people, itemFor, tags, replyTo });
  // Its record, on the meeting as it is now in one write (setOnMeeting): never lost to edits saved while it went
  if (r.sent) await setOnMeeting(env.DB, id, { packetSentAt: nowIso(), packetSentTo: r.reached }).catch((err) => { throw mayHaveGone(err); });
  return { sent: r.sent, failed: r.failed, errors: r.errors, unsure: r.unsure, ...(r.skipped.length ? { skipped: r.skipped } : {}), documents: docs.names.length + docs.hidden };
}

/**
 * The agenda approved (the chair's review on the board page, where Peter and Holly can approve it too) is what emails
 * the board (Peter, Nov 2 2026: "that's what should trigger the email"): the meeting goes on the board page and the
 * board gets the email, once. It waits for the email on how to sign in, so nobody gets an agenda before they know how
 * to open it; the heartbeat sends it then (maybeSendApprovedAgendas).
 * → { sent, failed, … } | { waiting: 'sign-in' } | null (nothing to send: sent already, not ahead, a practice)
 */
/**
 * The board knows how to sign in: the whole board's send told them (sentAt), or each board member with an address it can
 * go to has had the email or has signed in already (one who signed in without it needs no email to open an agenda).
 * Once told, someone added later doesn't hold up the board's agendas: Board access names them, with their send.
 */
export async function boardTold(DB) {
  await readState(DB, 'welcome'); // (makes the table)
  // The record and the claim in one read: not while a send is going out (its record is written before Resend answers,
  // and goes back if Resend says no), and never a record a send has just put back
  const rows = (await DB.prepare("SELECT key, data, updated_at FROM board_state WHERE key IN ('welcome', 'welcome-sending')").all()).results || [];
  const claim = rows.find((r) => r.key === 'welcome-sending');
  let claimed = {};
  try { claimed = JSON.parse(claim?.data || '{}') || {}; } catch { /* none */ }
  if (claim && !claimed.told && Date.now() - Date.parse(claim.updated_at) < 2 * 60 * 1000) return false;
  let w = {};
  try { w = JSON.parse(rows.find((r) => r.key === 'welcome')?.data || '{}') || {}; } catch { /* none */ }
  if (w.sentAt) return true;
  const [board, seen] = await Promise.all([activeBoard(DB), DB.prepare('SELECT slug FROM board_seen').all().then((r) => new Set((r.results || []).map((x) => x.slug)))]);
  const usable = board.filter((p) => isEmail(p.email));
  return usable.length > 0 && usable.every((p) => seen.has(p.slug) || welcomeHad(w, p, board.map((x) => x.slug)));
}

export async function sendApprovedAgenda(env, id, { now = Date.now() } = {}) {
  const m = await getMeeting(env.DB, id);
  if (!m || m.practice || m.notBoard || m.packetSentAt || !isDate(m.date) || m.date < todayEastern(now) || !emailConfigured(env)) return null;
  if (!(await boardTold(env.DB))) return { waiting: 'sign-in' };
  // Once, even when the approval and the heartbeat reach it together
  const key = `agenda-email:${m.id}`;
  const at = new Date(now).toISOString();
  const claim = await env.DB.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(key, JSON.stringify({ at }), at).run();
  if (!claim?.meta?.changes) return null;
  try {
    if (!m.shared) await setOnMeeting(env.DB, m.id, { shared: true }, { by: 'Board' });
    const r = await sendPacket(env, m.id, { by: 'Board', replyTo: await boardAdmins(env.DB) });
    // (none went: Resend said no to every one, or didn't answer, when asking again sends each only if it hasn't gone)
    if (!r.sent) throw Object.assign(new Error(r.errors?.[0] || 'No email went'), { status: 502, result: r });
    return r;
  } catch (err) {
    // Not sent: the heartbeat tries again (it finds the agenda emailed, when an admin's send of it is what was going out).
    // Never when it may have gone (an error after its emails: `went`) or the board had it a moment ago (an admin's send):
    // the claim stays, so the agenda never goes twice
    if (!err.went && !err.extra?.already) await env.DB.prepare('DELETE FROM board_state WHERE key = ?').bind(key).run();
    // An admin's Email the board going out this moment, or gone a moment ago: the board has it, or is getting it
    if (err.status === 409 && (err.extra?.sending || err.extra?.already)) return { sent: 0, going: true };
    throw err;
  }
}

/** Each agenda approved before the board had the sign-in email (or that didn't go): sent once it can be. Never throws */
export async function maybeSendApprovedAgendas(env, { now = Date.now() } = {}) {
  try {
    if (!(await boardTold(env.DB))) return;
    const since = new Date(now - 60 * 86400000).toISOString();
    const rows = (await env.DB.prepare("SELECT meeting_id FROM board_asks WHERE kind = 'chair' AND status = 'approved' AND in_at >= ?").bind(since).all()).results || [];
    for (const { meeting_id: id } of rows) await sendApprovedAgenda(env, id, { now }).catch((err) => console.error('[board] approved agenda', id, err.message));
  } catch (err) {
    if (!/no such table/i.test(err.message)) console.error('[board] approved agendas', err.message);
  }
}

/**
 * Why a meeting's minutes can't be approved, or the board told they're up, yet ('' when they can): the meeting has to
 * have been held (its day come, or the chair started it), with its minutes in Board. The same as Board's After the
 * meeting goes by (public/admin/board-meeting.js), for a tab left open or a request made by hand
 */
export function minutesNotReady(m, today = todayEastern()) {
  if (!m) return 'That meeting is gone';
  if (!isDate(m.date) || (m.date > today && !m.live?.startedAt)) return 'This meeting hasn’t happened yet, so it has no minutes to approve or send.';
  if (!minutesIn(m)) return 'This meeting’s minutes aren’t in Board yet. Drop them in first.';
  return '';
}

/**
 * The board approved a meeting's minutes (at a later meeting, on its date): only those two, on the meeting as it is.
 * `press`: a person asked (Board's approve-minutes), so only minutes there are, of a meeting held (minutesNotReady)
 */
export async function approveMinutes(env, id, { on, by, press = false }) {
  const m = await patchMeeting(env.DB, String(id || ''), (cur) => {
    const why = press ? minutesNotReady(cur) : '';
    if (why) throw Object.assign(new Error(why), { status: 409 });
    return { ...cur, minutes: 'approved', approvedOn: isDate(on) ? on : todayEastern() };
  }, { by });
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  return m;
}

/** Board members on the meeting's calendar invite who haven't answered it (yes, no or maybe) */
export async function notAnswered(env, m) {
  const replies = repliesOf(m);
  return (await packetList(env.DB)).filter((p) => replies[p.slug] === 'invited');
}
/** Board members the meeting's calendar invite doesn't have (by the email on People → Board): they can't answer it */
export async function notOnInvite(env, m) {
  const replies = repliesOf(m);
  return (await packetList(env.DB)).filter((p) => !replies[p.slug]);
}

/** The reminder, for one board member: answer the calendar invite (`from`: whose), then when and where */
export function reminderEmail(m, { test = false, name: who = '', from = '' } = {}) {
  const name = meetingName(m);
  const first = firstName(who);
  const heading = `${first ? `${first}, will` : 'Will'} you be at the ${name}?`;
  const ask = answerAsk(from);
  // What the invite is called in their email (Board names it, on the organizer's own event too)
  const called = inviteTitle(m);
  return {
    subject: `${test ? '[Preview] ' : ''}Will you be at the ${name}? ${shortDate(m.date)}`,
    html: emailShell({
      eyebrow: 'SOARD Board',
      preheader: `${whenOf(m)}. ${ask}`,
      heading,
      intro: esc(ask),
      bodyHtml: meetingFacts(m)
        + small(`Can’t find the invite? Search your email for “${esc(called)}”, or reply to this email and we’ll send it again.`)
        + `<div style="margin:10px 0 0;">${small(`The agenda is on ${link('the board page', meetingUrl(m))}. ${SIGN_IN}`)}</div>`,
      footerHtml: FOOTER,
    }),
    text: [heading, ask, factsText(m), `Can't find the invite? Search your email for "${called}", or reply to this email and we'll send it again.`, `The agenda is on the board page: ${meetingUrl(m)}`].join('\n\n'),
  };
}

/**
 * Ask the board members on the invite who haven't answered it, each by name (test: only `to`), once (sendOnce). Who
 * isn't on the invite can't answer it: they come back by name (`notOnInvite`), for the invite to add them
 */
export async function remindRsvp(env, id, { to = null, replyTo = [], by = '' } = {}) {
  const m = await getMeeting(env.DB, id);
  if (m?.notBoard) throw Object.assign(new Error(OFF_PAGE), { status: 409 });
  if (!m?.shared) throw Object.assign(new Error('Share the meeting with the board first, so the button has something to open'), { status: 409 });
  const test = Array.isArray(to);
  if (!test && !inviteOut(m)) throw Object.assign(new Error('The calendar invite hasn’t gone out yet: Send the invite first, then they can answer it'), { status: 409 });
  const [team, settings] = await Promise.all([roster(env.DB), getSettings(env.DB)]);
  const missing = test ? [] : (await notOnInvite(env, m)).map((p) => p.name);
  const people = test ? to.map((email) => ({ email, name: '' })) : await notAnswered(env, m);
  // Who can add someone: Send the invite, unless the event is someone's Board can't change
  const owner = inviteOwner(m, settings);
  const adds = owner && !settings.admins.includes(owner) ? `ask ${staffFor(team, owner)?.name.split(/\s+/)[0] || owner.split('@')[0]} to add ${missing.length === 1 ? 'them' : 'them all'}` : `Send the invite adds ${missing.length === 1 ? 'them' : 'them all'}`;
  if (!people.length) throw Object.assign(new Error(missing.length ? `Everyone on the invite has answered. ${missing.join(', ')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} on it: ${adds}.` : 'Everyone has answered the invite'), { status: 409 });
  const from = inviteFrom(m, team, settings);
  const itemFor = (p) => ({ to: p.email, ...reminderEmail(m, { test, name: p.name, from }) });
  const tags = [{ name: 'kind', value: test ? 'board-reminder-preview' : 'board-reminder' }];
  const r = test ? await sendEach(env, people.map(itemFor), { tags, replyTo }) : await sendOnce(env, { kind: 'remind', m, by, people, itemFor, tags, replyTo });
  // (the meeting as the site has it now, with who was asked when: remindedOf, for the page's card)
  return { sent: r.sent, failed: r.failed, errors: r.errors, unsure: r.unsure, ...(r.skipped?.length ? { skipped: r.skipped } : {}), to: test ? to : undefined, notOnInvite: missing, ...(test ? {} : { meeting: await getMeeting(env.DB, id) }) };
}

/** The minutes notice: which meeting, and (a draft) when the board votes on them */
export function minutesEmail(m, { test = false, next = null } = {}) {
  const name = meetingName(m);
  const approved = m.minutes === 'approved';
  const intro = approved
    ? `The board approved them${m.approvedOn ? ` on ${longDate(m.approvedOn)}` : ''}.`
    : 'The board votes on them at the next meeting. Anything wrong? Suggest a correction on the page.';
  return {
    subject: `${test ? '[Preview] ' : ''}${approved ? 'Minutes' : 'Draft minutes'}: ${name}, ${shortDate(m.date)}`,
    html: emailShell({
      eyebrow: 'SOARD Board',
      preheader: intro,
      heading: `The ${approved ? '' : 'draft '}minutes of the ${name} are up`,
      intro: esc(intro),
      bodyHtml: facts([['Meeting', esc(longDate(m.date))], ['Next meeting', next ? esc(whenOf(next)) : '']])
        + `<div style="margin:18px 0 0;">${button('Read the minutes', meetingUrl(m))}</div>`
        + small(`${SIGN_IN} The minutes stay on the board page; they are never emailed.`),
      footerHtml: FOOTER,
    }),
    text: [`The ${approved ? '' : 'draft '}minutes of the ${name} (${longDate(m.date)}) are up.`, intro, `Read them: ${meetingUrl(m)}\n${SIGN_IN}`].join('\n\n'),
  };
}

/**
 * Tell the board the minutes are on the board page (test: only `to`), once (sendOnce); its sent time is written onto the
 * meeting as it is now (patchMeeting), never over what was saved while it went
 */
export async function sendMinutesNotice(env, id, { to = null, replyTo = [], by = '' } = {}) {
  const m = await getMeeting(env.DB, id);
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  // (never "the minutes are up" before there are any, from a tab left open or a request made by hand)
  const why = minutesNotReady(m);
  if (why) throw Object.assign(new Error(why), { status: 409 });
  if (m.notBoard) throw Object.assign(new Error(OFF_PAGE), { status: 409 });
  if (!m.shared) throw Object.assign(new Error('Share the minutes with the board first'), { status: 409 });
  const test = Array.isArray(to);
  const people = test ? to.map((email) => ({ email, name: '' })) : await packetList(env.DB);
  if (!people.length) throw Object.assign(new Error('No board member has an email on file (People → Board)'), { status: 409 });
  // The next meeting the board can see (never one kept off the board page)
  const next = (await listMeetings(env.DB)).filter((x) => x.date > m.date && boardSees(x)).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const mail = minutesEmail(m, { test, next });
  const itemFor = (p) => ({ to: p.email, ...mail });
  const tags = [{ name: 'kind', value: test ? 'board-minutes-preview' : 'board-minutes' }];
  if (test) {
    const r = await sendEach(env, people.map(itemFor), { tags, replyTo });
    return { sent: r.sent, failed: r.failed, errors: r.errors, to };
  }
  const r = await sendOnce(env, { kind: 'minutes', m, by, people, itemFor, tags, replyTo });
  if (r.sent) await setOnMeeting(env.DB, id, { minutesSentAt: nowIso() }).catch((err) => { throw mayHaveGone(err); });
  return { sent: r.sent, failed: r.failed, errors: r.errors, unsure: r.unsure, ...(r.skipped.length ? { skipped: r.skipped } : {}) };
}

// Plain text: Google copies an invite's notes into its .ics as they are, and
// Apple Calendar and Outlook would show HTML as tags
/** Where Board's part of an invite's notes starts (the organizer's own notes stay above it) */
export const NOTES_START = 'The agenda and documents:';
/** What Board's part started with before, still found and replaced (Oct 2026) */
export const OLD_NOTES_STARTS = ['The agenda and the packet are on the board page:'];
/**
 * What a meeting's calendar invite says: the way to its page (the agenda and every document are there, to read,
 * present or print) and the notes typed for it in Board (parking and the like). Nothing else, so the agenda changing
 * never touches the invite. The notes stay after NOTES_START, in Board's part, so a change replaces them on the
 * organizer's own event instead of adding them twice (withNotes in ./_board-invite.js). Its words changed: raise
 * NOTES_VERSION there, and the invites already out get them
 */
export function inviteNotes(m) {
  return [
    `${NOTES_START} ${inviteUrl(m)}`,
    'Sign in with the email this invite went to. A code comes by email.',
    ...(m.inviteNote ? ['', m.inviteNote] : []),
  ].join('\n');
}
/**
 * A meeting's short link, for its calendar invite: /board/<id> opens the meeting (public/_redirects, then the board
 * page), even through a first sign-in, where a #/meetings/<id> link would land on Home
 */
export const inviteUrl = meetingUrl;
/**
 * What a meeting's calendar invite is called: which meeting it is, "SOARD Q4 2026 Board Meeting" (Peter, Nov 2 2026:
 * "make that better and more descriptive", then without "(in person or Google Meet)")
 */
export function inviteTitle(m) {
  return /soard/i.test(meetingName(m)) ? meetingName(m) : `SOARD ${meetingName(m)}`;
}

/** A meeting as a calendar file, for a board member who isn't on its invite */
export function meetingIcs(m) {
  const stamp = (d, t) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(`${d}T${t}:00Z`)).find((x) => x.type === 'timeZoneName')?.value || 'GMT-5';
    const [, sign, hh] = p.match(/GMT([+-])(\d{1,2})/) || [null, '-', '5'];
    return new Date(Date.parse(`${d}T${t}:00Z`) - (sign === '-' ? -1 : 1) * Number(hh) * 3_600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  const start = m.start || '08:00';
  const end = m.end || `${String(Math.min(23, Number(start.slice(0, 2)) + 2)).padStart(2, '0')}${start.slice(2)}`;
  const esc2 = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sunshine on a Ranney Day//Board//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:board-${m.id}@sunshineonaranneyday.com`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART:${stamp(m.date, start)}`, `DTEND:${stamp(m.date, end)}`,
    `SUMMARY:${esc2(inviteTitle(m))}`, ...(m.location || m.address ? [`LOCATION:${esc2([m.location, m.address].filter(Boolean).join(', '))}`] : []),
    `DESCRIPTION:${esc2(`${inviteNotes(m)}${m.video ? `\n\nVideo (${callName(m.video)}): ${m.video}` : ''}`)}`, `URL:${meetingUrl(m)}`,
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

// The board page's sign-in word for word as Cloudflare Access shows it (soard.cloudflareaccess.com; its heading is
// the Access app's name), and who sends its code. Checked against the live page and Cloudflare's docs, Nov 2026
const ACCESS = { heading: 'Log in to SOARD Admin', send: 'Send login code', signIn: 'Sign in', again: 'Request new code', from: 'noreply@notify.cloudflare.com' };
// The sign-in page's own joke, on purpose (Peter's): the email says it too
const FIGURE_IT_OUT = '1-800-FIGUREITOUT';

/** "Sam", "Sam or Jordan", "Sam, Jordan or Lee" */
const orNames = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0] || '');

/** A numbered step, its number in a yellow circle (table cells, so Outlook keeps them) */
const step = (n, html) => `<tr><td valign="top" width="38" style="width:38px;padding:0 0 14px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>`
  + `<td class="num" width="26" height="26" align="center" valign="middle" bgcolor="#FFDA24" style="width:26px;height:26px;border-radius:999px;background:#FFDA24;color:#2D2E33;font-family:${SANS};font-size:13px;font-weight:700;line-height:26px;text-align:center;">${n}</td></tr></table></td>`
  + `<td class="ink" valign="top" style="padding:2px 0 14px 4px;font-family:${SANS};font-size:15px;line-height:1.5;color:#2D2E33;">${html}</td></tr>`;
const kicker = (text) => `<p class="muted" style="margin:0 0 6px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5A5B61;">${esc(text)}</p>`;
const para = (html, { muted = false, top = 2 } = {}) => `<p class="${muted ? 'muted' : 'ink'}" style="margin:${top}px 0 0;font-family:${SANS};font-size:${muted ? 14 : 15}px;line-height:1.5;color:${muted ? '#5A5B61' : '#2D2E33'};">${html}</p>`;

/**
 * The email that brings a board member to their page: who invited them, what's waiting there (the next meeting,
 * papers to sign), and the first sign-in step by step in the screens' own words, with what to do when no code comes.
 * `inviter`: { name, title, photo } from People → Team; `next`: the next meeting on the board page; `toSign`: the
 * titles of this year's papers they haven't signed; `helpers`: the first names a reply reaches
 */
export function welcomeEmail({ name = '', email = '', test = false, inviter = null, next = null, toSign = [], helpers = [] } = {}) {
  const url = `${SITE}/board`;
  const bare = 'sunshineonaranneyday.com/board';
  const first = firstName(name);
  const who = String(inviter?.name || '').replace(/\s+/g, ' ').trim();
  // A long address wraps on a phone instead of pushing the page sideways
  const address = email ? `<strong style="word-break:break-all;">${esc(email)}</strong>` : 'the address this email came to';
  const help = helpers.length ? `${orNames(helpers)} will help` : 'we’ll help';
  const heading = first ? `${first}, your board page is ready` : 'Your board page is ready';
  const intro = `It has ${next ? `the next meeting${next.shared ? ' and its agenda' : ''}, ` : ''}past minutes, the financials, upcoming reveals and SOARD’s papers, all in one place.`;
  const signHow = `Read ${toSign.length > 1 ? 'them' : 'it'} on the board page and sign there, or add the copy you signed on paper.`;
  const keep = 'No password to remember. You stay signed in for a week in the browser you used, then it’s a new code.';
  const save = `Bookmark ${bare}, or add it to your phone’s home screen.`;
  const year = todayEastern().slice(0, 4);
  const byline = !who ? '' : '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;"><tr>'
    + (inviter.photo ? `<td valign="middle" style="width:44px;padding:0 12px 0 0;"><img src="${esc(inviter.photo)}" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:999px;"></td>` : '')
    + `<td class="ink" valign="middle" style="font-family:${SANS};font-size:15px;line-height:1.4;color:#2D2E33;"><strong>${esc(who)}</strong> invited you`
    + `${inviter.title ? `<br><span class="muted" style="font-size:13px;color:#5A5B61;">${esc(inviter.title)}</span>` : ''}</td></tr></table>`;
  const waiting = (next ? panel(kicker('Next meeting') + para(`<strong>${esc(meetingName(next))}</strong>`, { top: 0 }) + para(esc(whenOf(next)))
    + (placeOf(next) ? para(esc(placeOf(next)), { muted: true }) : '') + (next.shared ? para('Its agenda is on the board page.', { muted: true, top: 8 }) : ''), { accent: true }) : '')
    + (toSign.length ? panel(kicker(`To sign for ${year}`) + para(toSign.map((t) => esc(t)).join('<br>'), { top: 0 }) + para(esc(signHow), { muted: true, top: 8 }), { accent: true }) : '');
  const steps = '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">'
    + step(1, `Open ${link(bare, url)}. A Cloudflare page that says <strong>${ACCESS.heading}</strong> opens. That’s the right one: Cloudflare keeps the board’s papers private.`)
    + step(2, `Type ${address} and choose <strong>${ACCESS.send}</strong>.`)
    + step(3, `A six-digit code comes by email from Cloudflare (${ACCESS.from}), usually within a minute. Type or paste it in and choose <strong>${ACCESS.signIn}</strong>. Leave the page open while you get it; the code works for 10 minutes.`)
    + '</table>';
  const noCode = `Look in spam, Junk or Promotions, and check that you typed ${address}. Another address gets no code, even though the page says one was sent. If the page says the code was already used, choose <strong>${ACCESS.again}</strong>. If the page closed, open the link again and ask for a new code.`;
  const stuck = `Still stuck? Reply to this email and ${help}, or call the SOARD admin team at ${FIGURE_IT_OUT}.`;
  const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  return {
    subject: `${test ? '[Preview] ' : ''}${who ? `${who} invited you to SOARD’s board page` : 'Your SOARD board page is ready'}`,
    // From the person who sent it, through the board's address: "Sam Ortiz via SOARD Board", quoted (a name may
    // have a period or a comma), a phone's curly apostrophe kept as a plain one
    from: viaBoard(who),
    html: emailShell({
      eyebrow: 'SOARD Board',
      preheader: `${next ? `Next meeting ${shortDate(next.date)}. ` : ''}Sign in with ${email || 'this email address'}. No password, just a code by email.`,
      heading,
      intro: esc(intro),
      bodyHtml: byline
        + `<div style="margin:0 0 18px;">${button('Open the board page', url)}</div>`
        + waiting
        + `<p class="ink" style="margin:${waiting ? 22 : 4}px 0 12px;font-family:${SERIF};font-size:18px;line-height:1.3;font-weight:700;color:#2D2E33;">The first time you sign in</p>`
        + steps
        + small(esc(`${keep} ${save}`))
        + ruled(`<p class="ink" style="margin:0 0 6px;font-weight:700;">No code?</p><p class="ink" style="margin:0 0 10px;">${noCode}</p>${small(esc(stuck).replace(FIGURE_IT_OUT, `<span style="white-space:nowrap;">${FIGURE_IT_OUT}</span>`))}`),
      footerHtml: FOOTER,
    }),
    text: [
      heading,
      `${intro}${who ? ` ${who}${inviter.title ? ` (${inviter.title})` : ''} invited you.` : ''}`,
      `Open the board page: ${url}`,
      next ? [`Next meeting: ${meetingName(next)}`, whenOf(next), placeOf(next), next.shared ? 'Its agenda is on the board page.' : ''].filter(Boolean).join('\n') : '',
      toSign.length ? `To sign for ${year}:\n${toSign.map((t) => `- ${t}`).join('\n')}\n${signHow}` : '',
      ['The first time you sign in',
        `1. Open ${bare}. A Cloudflare page that says "${ACCESS.heading}" opens. That’s the right one: Cloudflare keeps the board’s papers private.`,
        `2. Type ${email || 'the address this email came to'} and choose ${ACCESS.send}.`,
        `3. A six-digit code comes by email from Cloudflare (${ACCESS.from}), usually within a minute. Type or paste it in and choose ${ACCESS.signIn}. Leave the page open while you get it; the code works for 10 minutes.`].join('\n'),
      `${keep} ${save}`,
      `No code? ${strip(noCode)}`,
      stuck,
    ].filter(Boolean).join('\n\n'),
  };
}

/**
 * After a sign-in email send, its marks settled at the members it went to, wherever their record is now: a People rename
 * while it went moves their marks (./rename-content.js, in its own batch), so each is found by this send's own moment AND
 * the address it went to (members[k] = at, addresses[k] = their email), their own web address first, never by the web
 * address the send started with (Board QA round 7: unconfirmed stayed on the old address for good, and the row's send
 * went again). went: Resend took it, so it's no longer unconfirmed; else a sure no, so their marks go back as they were
 * before this send. Written only over the record as read, read again on a clash
 */
async function settleWelcomeMarks(DB, { at, recipients, was, went }) {
  await readState(DB, 'welcome');
  for (let i = 0; i < 5; i++) {
    const row = await DB.prepare("SELECT data FROM board_state WHERE key = 'welcome'").first();
    const cur = parse(row?.data, {}) || {};
    const members = { ...(cur.members || {}) };
    const addresses = { ...(cur.addresses || {}) };
    let unconfirmed = [...(cur.unconfirmed || [])];
    const used = new Set();
    for (const p of recipients) {
      const ours = Object.keys(members).filter((k) => !used.has(k) && members[k] === at && addresses[k] === p.email);
      const k = ours.includes(p.slug) ? p.slug : ours[0];
      if (!k) continue; // (nothing of this send's under any address now: a send since, or they're gone)
      used.add(k);
      if (went) { unconfirmed = unconfirmed.filter((x) => x !== k); continue; }
      if (was.members?.[p.slug] !== undefined) members[k] = was.members[p.slug]; else delete members[k];
      if (was.addresses?.[p.slug] !== undefined) addresses[k] = was.addresses[p.slug]; else delete addresses[k];
      if (!(was.unconfirmed || []).includes(p.slug)) unconfirmed = unconfirmed.filter((x) => x !== k);
    }
    // (put back as it was: an empty list where there was none before this send is none again)
    const kept = (obj, had) => (Object.keys(obj).length || had !== undefined ? obj : undefined);
    const next = { ...cur, members: kept(members, went ? cur.members : was.members), addresses: kept(addresses, went ? cur.addresses : was.addresses), unconfirmed: unconfirmed.length ? unconfirmed : undefined,
      // (a sure no: the board's told-or-not as it was before this send, too)
      ...(went ? {} : { sentAt: was.sentAt, sent: was.sent, lastClick: was.lastClick, lastTo: was.lastTo }) };
    const json = JSON.stringify(next);
    const r = row
      ? await DB.prepare("UPDATE board_state SET data = ?, updated_at = ? WHERE key = 'welcome' AND data = ?").bind(json, nowIso(), row.data).run()
      : await DB.prepare("INSERT OR IGNORE INTO board_state (key, data, updated_at) VALUES ('welcome', ?, ?)").bind(json, nowIso()).run();
    if ((r?.meta?.changes ?? 0) > 0) return;
  }
  console.error('[board] a sign-in email send’s marks weren’t settled: the record kept changing');
}

/** Email each active board member (on their own) how to sign in, from the admin sending it (`by`); test: only `to` */
export async function sendWelcome(env, opts = {}) {
  if (Array.isArray(opts.to)) return sendWelcomeNow(env, opts);
  // One send at a time: a second (another tab, the table during the panel's, a re-posted request) is turned away, and
  // the next finds who already has it. The claim lapses after two minutes if a send never finishes.
  await readState(env.DB, 'welcome');
  const now = nowIso();
  const got = await env.DB.prepare("INSERT INTO board_state (key, data, updated_at) VALUES ('welcome-sending', '{}', ?) ON CONFLICT(key) DO UPDATE SET data = '{}', updated_at = excluded.updated_at WHERE board_state.updated_at < ?")
    .bind(now, new Date(Date.parse(now) - 2 * 60 * 1000).toISOString()).run();
  if (!got?.meta?.changes) throw Object.assign(new Error('Another sign-in email was going out at the same moment, so this one wasn’t sent. Board access shows who has it now.'), { status: 409 });
  try {
    if (opts.check) await opts.check();
    return await sendWelcomeNow(env, opts);
  } finally {
    await env.DB.prepare("DELETE FROM board_state WHERE key = 'welcome-sending'").run();
  }
}

async function sendWelcomeNow(env, { to = null, slugs = null, due = false, again = false, replyTo = [], by = '', click = '' } = {}) {
  if (!emailConfigured(env)) throw Object.assign(new Error('Email isn’t set up (RESEND_API_KEY)'), { status: 503 });
  const test = Array.isArray(to);
  const [list, people, settings, meetings, docs] = await Promise.all([packetList(env.DB), roster(env.DB), getSettings(env.DB), listMeetings(env.DB), listDocs(env.DB)]);
  const was = test ? {} : await readState(env.DB, 'welcome');
  // Nobody gets a second copy by accident:
  //   - the whole board's send, and a pick that's due (`due`: those who haven't had it), skip anyone who has it at the
  //     address on file
  //   - someone picked again, or everyone again (`again`), skips whoever had it in the last ten minutes (a double click,
  //     two admins at once)
  // A new address makes it due again. An address the mailer would drop (kim@gmail.c) isn't sent to, nor counted.
  const hasIt = (p) => !!welcomeHad(was, p, people.board.map((x) => x.slug));
  const justNow = (p) => Date.now() - Date.parse((was.members || {})[p.slug]) < 10 * 60 * 1000;
  const asked = test ? [] : list.filter((p) => !slugs || slugs.includes(p.slug));
  // One who has signed in already knows how: never sent it (whatever a page left open still shows)
  const seen = test ? new Set() : new Set(((await env.DB.prepare('SELECT slug FROM board_seen').all()).results || []).map((x) => x.slug));
  const signedIn = asked.filter((p) => isEmail(p.email) && seen.has(p.slug)).map((p) => p.name);
  const usable = asked.filter((p) => isEmail(p.email) && !seen.has(p.slug));
  const unusable = asked.filter((p) => !isEmail(p.email)).map((p) => p.name);
  // A preview greets the admin by name, as a member's copy greets them
  const recipients = test ? to.map((email) => ({ email, name: staffFor(people, email)?.name || '', slug: '' })) : usable.filter((p) => !hasIt(p) || (((slugs && !due) || again) && !justNow(p)));
  if (!test && !recipients.length) {
    if (!asked.length) throw Object.assign(new Error(slugs ? 'They aren’t on People → Board with an email now' : 'No board member has an email on file (People → Board)'), { status: 409 });
    if (!usable.length && !signedIn.length) throw Object.assign(new Error(`The email on People → Board for ${unusable.join(', ')} isn’t a whole address`), { status: 409 });
    return { sent: 0, failed: 0, errors: [], already: usable.length, ...(unusable.length ? { unusable } : {}), ...(signedIn.length ? { signedIn } : {}) };
  }
  // Who this send goes to, kept on its claim: only their rows say it's going out
  // and whether the board was told before it (an agenda approved meanwhile needn't wait for this one)
  const onBoard = people.board.map((x) => x.slug);
  const toldBefore = !!was.sentAt || (list.some((p) => isEmail(p.email)) && list.filter((p) => isEmail(p.email)).every((p) => seen.has(p.slug) || welcomeHad(was, p, onBoard)));
  if (!test) await env.DB.prepare("UPDATE board_state SET data = ? WHERE key = 'welcome-sending'").bind(JSON.stringify({ to: recipients.map((p) => p.slug), told: toldBefore })).run();
  // Who it's from: the admin sending it, else the one the invites come from
  const sender = staffFor(people, by) || staffFor(people, settings.invitesFrom);
  const inviter = sender ? { name: sender.name, title: sender.title, photo: sender.photo } : null;
  const today = todayEastern();
  // The next meeting: not one taken off the calendar, nor today's once it's over
  const nowHm = easternHm(Date.now());
  const next = nextMeeting(meetings.filter((m) => onBoardPage(m, today) && !m.calendar?.gone && !(m.date === today && (m.end || m.start) && (m.end || m.start) <= nowHm)), today);
  const helpers = [...new Set(replyTo.map((e) => firstName(staffFor(people, e)?.name)).filter(Boolean))];
  const signable = signablePapers(docs);
  const items = recipients.filter((p, i) => recipients.findIndex((x) => x.email === p.email) === i).map((p) => ({ to: p.email, ...welcomeEmail({ name: p.name, email: p.email, test, inviter, next, helpers, toSign: signable.filter((d) => !(p.slug && d.signed[p.slug])).map((d) => d.title) }) }));
  // (this send's own moment: its marks are found again by it and the address each went to, settleWelcomeMarks)
  let marked = '';
  if (!test) {
    // Recorded before it goes: a send cut off midway (the page closed, the Worker stopped) counts as sent, so it never
    // doubles. Each member's own time (their row on Board → Members) and the address it went to (a corrected one is due
    // again); the board counts as told (sentAt) by the whole board's send, or once a pick has reached everyone
    const at = nowIso();
    marked = at;
    const members = { ...(was.members || {}), ...Object.fromEntries(recipients.map((p) => [p.slug, at])) };
    const addresses = { ...(was.addresses || {}), ...Object.fromEntries(recipients.map((p) => [p.slug, p.email])) };
    // (one who has signed in already knows how)
    const everyone = list.filter((p) => isEmail(p.email) && !seen.has(p.slug)).every((p) => welcomeHad({ members, addresses }, p, people.board.map((x) => x.slug)));
    // Unconfirmed until Resend says it took them (a send cut off midway stays unconfirmed, and Board access says so)
    const unconfirmed = [...new Set([...(was.unconfirmed || []), ...recipients.map((p) => p.slug)])];
    // (and the click it's for: the page tells its own send, posted again by the browser, from another one)
    const lastClick = /^[\w-]{6,40}$/.test(String(click)) ? String(click) : undefined;
    const lastTo = lastClick ? recipients.map((p) => p.slug) : undefined; // (who that click's send went to)
    await writeState(env.DB, 'welcome', slugs && !(everyone && !was.sentAt) ? { ...was, members, addresses, unconfirmed, lastClick, lastTo } : { ...was, sentAt: at, sent: recipients.length, members, addresses, unconfirmed, lastClick, lastTo });
  }
  // One batch: every member's email goes, or none does, so sending again never gives anyone a second copy
  const r = await sendEmailItems(env, items, { from: items[0].from, tags: [{ name: 'kind', value: test ? 'board-welcome-preview' : 'board-welcome' }], replyTo });
  // Resend not answering (a timeout, a dropped connection) may still have sent it: it stays counted as sent
  // (a gateway's 502, 503 or 504 in front of Resend is no answer too). Resend's own error status is a sure no: nobody got
  // it, so the record goes back as it was
  const unsure = !test && r.failed > 0 && r.errors.some((e) => !/^Resend \d+:/.test(String(e)) || /^Resend 50[234]:/.test(String(e)));
  // Resend confirmed it: these are no longer unconfirmed; a sure no: their marks go back as they were. Either way at the
  // members it went to, wherever their record is now (a People rename while it went moved their marks)
  if (!test && !unsure) await settleWelcomeMarks(env.DB, { at: marked, recipients, was, went: !!r.sent });
  return { sent: r.sent, ...(!test && r.sent && recipients.length !== items.length ? { reached: recipients.length } : {}), failed: r.failed, errors: r.errors, unsure: unsure || undefined, ...(unusable.length ? { unusable } : {}), ...(signedIn.length ? { signedIn } : {}), to: test ? to : undefined };
}

// ─── Asking a member to sign ────────────────────────────────────────

/**
 * The email asking a board member to sign this year's papers they haven't (`papers`: [{ title, id }]), from the
 * admin asking (`from`: their name): its button opens the paper itself, ready to read and sign (more than one:
 * Documents, where they're listed to sign). One who has never been on the board page (`firstTime`) is told how its
 * sign-in works; `test`: a preview
 */
export function signAskEmail({ name = '', email = '', papers = [], from = '', firstTime = false, test = false, reminder = false } = {}) {
  const year = todayEastern().slice(0, 4);
  const first = firstName(name);
  const one = papers.length === 1 ? papers[0] : null;
  const what = one ? `the ${one.title.replace(/^the\s+/i, '')}` : `${papers.length} papers`;
  // (/board/<id>, which keeps its place through Cloudflare's sign-in; a #/ link lands on Home)
  const url = `${SITE}/board/${one ? one.id : 'documents'}`;
  const heading = `${reminder ? 'A reminder: ' : ''}${first ? `${first}, please` : 'Please'} sign ${what} for ${year}`;
  const it = one ? 'it' : 'them';
  // (by when: the earliest due date among them)
  const due = one ? one.due || '' : '';
  // (a date gone by is said as one: "It was due January 31.", never "by January 31" as though it were ahead)
  const past = !!due && due < todayEastern();
  const by = due && !past ? ` by ${dueWords(due)}` : '';
  const intro = `Every board member reads and signs ${it} once a year${by}.${past ? ` It was due ${dueWords(due)}.` : ''} On the board page it takes a few minutes: read ${one ? 'it' : 'each one'}, then sign at the end.`;
  const paper = `Signed ${it} on paper already? Add a photo or PDF of the signed page there instead.`;
  const signIn = `The board page opens with your email address${email ? `, ${email}` : ''}: Cloudflare emails you a six-digit code to type in. No password.`;
  const reply = 'Questions? Reply to this email.';
  return {
    subject: `${test ? '[Preview] ' : ''}${reminder ? 'Reminder: please' : 'Please'} sign ${what} for ${year}${by}`,
    from: viaBoard(from),
    html: emailShell({
      eyebrow: 'SOARD Board',
      preheader: `${one ? one.title : `${papers.length} papers`}: read and sign on the board page. A few minutes.`,
      heading,
      intro: esc(intro),
      bodyHtml: (one ? '' : panel(kicker(`To sign for ${year}`) + para(papers.map((x) => esc(`${x.title}${dueNote(x.due)}`)).join('<br>'), { top: 0 }), { accent: true }))
        + `<div style="margin:${one ? 4 : 18}px 0 0;">${button(one ? 'Read and sign it' : 'Read and sign them', url)}</div>`
        + small(esc(paper))
        + (firstTime ? ruled(`<p class="ink" style="margin:0 0 6px;font-weight:700;">The first time</p><p class="ink" style="margin:0;">${esc(signIn).replace(esc(email), `<strong style="word-break:break-all;">${esc(email)}</strong>`)}</p>`) : '')
        + small(esc(reply)),
      footerHtml: FOOTER,
    }),
    text: [
      heading,
      intro,
      one ? '' : `To sign for ${year}:\n${papers.map((x) => `- ${x.title}${dueNote(x.due)}`).join('\n')}`,
      `${one ? 'Read and sign it' : 'Read and sign them'}: ${url}`,
      paper,
      firstTime ? `The first time: ${signIn}` : '',
      reply,
    ].filter(Boolean).join('\n\n'),
  };
}

/**
 * A member opening a paper they sign each year, kept once a year (the first time): evidence they had it in front of
 * them, on the record page (never on Members: Peter, Nov 3 2026, no activity there) → true when it was the first
 */
export async function noteOpened(DB, docId, member, evidence = {}) {
  await ensureSchema(DB);
  const doc = (await listDocs(DB)).find((d) => d.id === docId);
  // (a paper not on the board page isn't there for them, whether it exists or not)
  if (member?.slug && !doc?.shared) throw Object.assign(new Error('That paper isn’t on the board page'), { status: 404 });
  if (!doc?.sign || !doc.shared || !member?.slug) return false;
  const year = thisYear();
  return appendEvents(DB, async () => {
    const had = await DB.prepare("SELECT seq FROM board_sign_events WHERE kind = 'opened' AND doc_id = ? AND slug = ? AND year = ? LIMIT 1").bind(docId, member.slug, year).first();
    if (had) return { result: false };
    return { events: [{ kind: 'opened', docId, slug: member.slug, year, version: doc.version, by: evidence.signerEmail || member.email || '', ip: evidence.ip, device: evidence.device }], result: true };
  });
}

/** Who has been asked to sign this year, and when last: { slug: { at, by, n } } */
export async function signAsks(DB, year = thisYear()) {
  await ensureSchema(DB);
  return Object.fromEntries((((await DB.prepare('SELECT slug, at, by, n, reminders FROM board_sign_asks WHERE year = ?').bind(year).all()).results) || []).map((r) => [r.slug, { at: r.at, by: r.by || '', n: Number(r.n) || 1, reminders: Number(r.reminders) || 0 }]));
}

/**
 * Email each board member picked (`slugs`; none: the whole board) who hasn't signed this year's papers, asking them
 * to, from the admin asking (`by`). Whoever has signed them all, or was asked in the last ten minutes (a double
 * click, two admins at once), isn't emailed. `test`: a preview to `to` only.
 * → { sent, failed, errors, signed: n already signed, recent: [names], noEmail: [names], unsure }
 */
export async function askToSign(env, { slugs = null, by = '', replyTo = [], to = null } = {}) {
  if (!emailConfigured(env)) throw Object.assign(new Error('Email isn’t set up (RESEND_API_KEY)'), { status: 503 });
  await ensureSchema(env.DB);
  const test = Array.isArray(to);
  const year = thisYear();
  const [board, people, settings, docs, asks, seen] = await Promise.all([
    activeBoard(env.DB), roster(env.DB), getSettings(env.DB), listDocs(env.DB), signAsks(env.DB, year),
    env.DB.prepare('SELECT slug FROM board_seen').all().then((r) => new Set((r.results || []).map((x) => x.slug))),
  ]);
  const signable = signablePapers(docs);
  if (!signable.length) throw Object.assign(new Error('There’s nothing for the board to sign: tick Required on a paper in Documents, with its words or its file'), { status: 409 });
  const one = Array.isArray(slugs) && slugs.length === 1;
  const papersOf = (slug) => signable.filter((d) => !d.signed[slug] && (one || !d.declined?.[slug])).map((d) => ({ title: d.title, id: d.id, due: dueOn(d, year) }));
  // Who it's from: the admin asking, else the one the invites come from
  const sender = staffFor(people, by) || staffFor(people, settings.invitesFrom);
  if (test) {
    const items = to.map((email) => ({ to: email, ...signAskEmail({ name: staffFor(people, email)?.name || '', email, papers: signable.map((d) => ({ title: d.title, id: d.id, due: dueOn(d, year) })), from: sender?.name || '', firstTime: true, test }) }));
    const r = await sendEmailItems(env, items, { from: items[0].from, tags: [{ name: 'kind', value: 'board-sign-ask-preview' }], replyTo });
    return { ...r, to };
  }
  const picked = board.filter((p) => !slugs || slugs.includes(p.slug));
  if (!picked.length) throw Object.assign(new Error('They aren’t on People → Board now'), { status: 409 });
  const left = picked.filter((p) => papersOf(p.slug).length);
  const noEmail = left.filter((p) => !isEmail(p.email)).map((p) => p.name);
  const recent = left.filter((p) => isEmail(p.email) && asks[p.slug] && Date.now() - Date.parse(asks[p.slug].at) < 10 * 60 * 1000);
  const recipients = left.filter((p) => isEmail(p.email) && !recent.includes(p));
  const base = { signed: picked.length - left.length, recent: recent.map((p) => p.name), noEmail };
  if (!recipients.length) return { sent: 0, failed: 0, errors: [], ...base };
  const items = recipients.map((p) => ({ to: p.email, ...signAskEmail({ name: p.name, email: p.email, papers: papersOf(p.slug), from: sender?.name || '', firstTime: !seen.has(p.slug) }) }));
  const r = await sendEmailItems(env, items, { from: items[0].from, tags: [{ name: 'kind', value: 'board-sign-ask' }], replyTo });
  // Asked, once Resend took it, or when it may have (no answer is no sure no); Resend's own error is a sure no
  const unsure = r.failed > 0 && r.errors.some((e) => !/^Resend \d+:/.test(String(e)) || /^Resend 50[234]:/.test(String(e)));
  if (r.sent || unsure) {
    const at = nowIso();
    // (each ask in the chain too: about every paper they have to sign, so no one paper's)
    await appendEvents(env.DB, async () => ({
      stmts: recipients.map((p) => env.DB.prepare('INSERT INTO board_sign_asks (slug, year, at, by, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT(slug, year) DO UPDATE SET at = excluded.at, by = excluded.by, n = board_sign_asks.n + 1').bind(p.slug, year, at, String(by || '').slice(0, 200))),
      events: recipients.map((p) => ({ kind: 'asked', docId: null, slug: p.slug, year, at, by, detail: { to: p.email, papers: papersOf(p.slug).map((x) => x.id), unsure: unsure || undefined } })),
    }));
  }
  return { sent: r.sent, failed: r.failed, errors: r.errors, unsure: unsure || undefined, ...base };
}

// ─── What the Advisory Board's page shows of SOARD ──────────────────

/**
 * Public things only, for ./_advisory-portal.js: reveals (a kid's name and photo only with a published page; the rest
 * are a date), events, this year's finished rooms, and the public filings. Nothing here reads the board's tables.
 */
/**
 * The board's papers that can be offered to advisors: each one's own file, shared on the board page, never a paper the
 * board signs or a staff-only file. Which of these advisors see is chosen one by one (settings.boardDocs).
 */
export async function sharableBoardDocs(DB) {
  await ensureSchema(DB);
  const [rows, files] = await Promise.all([DB.prepare('SELECT data FROM board_docs').all().then((r) => r.results || []), filesOf(DB, 'doc')]);
  return rows.map((r) => cleanDoc(parse(r.data))).filter((d) => !d.sign && d.shared && !d.body)
    .map((d) => ({ id: d.id, title: d.title, file: (files[d.id] || []).at(-1) || null }))
    .filter((d) => d.file && !d.file.staffOnly)
    .map(({ id, title, file: { id: fileId, name, type, size } }) => ({ id, title, file: { id: fileId, name, type, size } }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function advisoryBits(env, { now = Date.now() } = {}) {
  const today = todayEastern(now);
  const year = today.slice(0, 4);
  const [reveals, events, pages, filings, media, counts] = await Promise.all([
    cachedReveals(env, now).catch(() => ({ upcoming: [], past: [] })),
    eventsList(env.DB, today),
    loadKids(env.DB).catch(() => []),
    siteDoc(env.DB, 'financials').catch(() => null),
    siteDoc(env.DB, 'media').catch(() => null),
    impact(env.DB).catch(() => null),
  ]);
  const published = new Map(pages.map((k) => [k.slug, k]));
  // This year's finished rooms, from their public pages: the reveal list only reaches back so far
  const kidRows = ((await env.DB.prepare('SELECT slug, data FROM kids').all().catch(() => ({ results: [] }))).results || []).map((r) => ({ slug: r.slug, ...parse(r.data) }));
  const rooms = kidRows.filter((k) => published.has(k.slug) && k.status === 'completed' && String(k.year) === year)
    .map((k) => ({ date: '', name: k.name, slug: k.slug, url: `/kids/${k.slug}/`, ...photoField(published.get(k.slug).heroImage) }));
  const row = (r) => {
    const k = published.get(r.slug);
    return { date: r.date || '', time: r.time || '', window: r.window || null, confirmed: r.confirmed !== false,
      ...(k ? { name: r.name, slug: r.slug, url: `/kids/${r.slug}/`, ...photoField(k.heroImage) } : {}) };
  };
  return {
    published,
    reveals: (reveals.upcoming || []).map(row),
    rooms,
    // SOARD's kids and rooms, as the website counts them
    impact: counts?.kids ? { kids: counts.kids, rooms: counts.rooms, byYear: counts.byYear?.length ? [{ year: counts.byYear[0].year }] : [] } : null,
    // The photos SOARD offers on /branding/, by their place in that list: only a child whose page is public
    photos: (media?.brandingPhotos || []).map((p, i) => ({ ...p, i })).filter((p) => p.cfId && published.has(p.kidSlug))
      // (their name from their own page: these captions go on to name a diagnosis, and this page is for sharing)
      .map((p) => ({ photo: `/cdn-cgi/imagedelivery/ROYFuPmfN2vPS6mt5sCkZQ/${p.cfId}/public`, caption: String(published.get(p.kidSlug).name || ''), download: `/api/download-branding-photos?photo=${p.i}` })),
    events: events.upcoming,
    filings: (filings?.documents || []).map((d) => ({ title: d.title, year: d.year, type: d.type, url: String(d.url || '').replace(/^https:\/\/files\.sunshineonaranneyday\.com\/financials\//, '/files/financials/') }))
      .filter((d) => /^(https:\/\/|\/files\/financials\/)/.test(d.url)),
  };
}

// ─── The board page ─────────────────────────────────────────────────

async function siteDoc(DB, key) {
  try { return parse((await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(key).first())?.data, null); } catch { return null; }
}
/** SOARD's public tax returns and audits (Site → Financials), through the site's own /files/ route so the page's viewer opens them */
export const filingsOf = (doc) => (doc?.documents || []).map((d) => ({ title: d.title, year: d.year, type: d.type, url: String(d.url || '').replace(/^https:\/\/files\.sunshineonaranneyday\.com\/financials\//, '/files/financials/') }))
  .filter((d) => /^(https:\/\/|\/files\/financials\/)/.test(d.url));

/**
 * The words inside the files this board page has (`?words`), for its search: the shared meetings' files the board
 * sees (never a staff-only one), SOARD's papers on the page, and its public tax returns and audits
 * → { files: { [file id]: words }, filings: { [the filing's url on the page]: words }, reading: files still to read }
 */
export async function portalWords(env, { member = null } = {}) {
  await ensureSchema(env.DB);
  const [meetings, docs, financials] = await Promise.all([listMeetings(env.DB), listDocs(env.DB), siteDoc(env.DB, 'financials')]);
  const ids = [
    ...meetings.map(boardCopy).filter(Boolean).flatMap((m) => m.files.map((f) => f.id)),
    ...docs.filter((d) => (d.shared || !member) && d.file && !d.file.staffOnly).map((d) => d.file.id),
  ];
  const { wordsFor, filingWordsFor, stillToRead } = await import('./_board-file-words.js');
  return { files: await wordsFor(env.DB, ids), filings: await filingWordsFor(env.DB, filingsOf(financials).map((f) => f.url)), reading: await stillToRead(env.DB) };
}

/**
 * A member on the board page at `t` (ms): the page read (portalData), or something they did on it (./_board-activity.js:
 * a look the page's tracker reports, an answer, a meeting followed live, a file opened). A visit lasts while they're
 * there, each of these keeping it going, and ends once VISIT_GAP_MS goes by with none (../../public/admin/board-shared.js:
 * the same sittings Board → Members counts). The first after that starts the next, and this one becomes the one before
 * (in one statement, so two at once agree; each column set from the row as it was). One older than the visit's last (a
 * report sent again late) changes nothing
 */
export async function keepVisit(DB, who, t = Date.now()) {
  await ensureSchema(DB);
  await stateReady(DB);
  const at = new Date(t).toISOString();
  const gap = new Date(t - VISIT_GAP_MS).toISOString();
  // (only at the address that's theirs this moment, never one a rename is moving or has moved: ./_member-write.js ownRow)
  const [own, mine] = await ownRow(DB, who);
  await DB.prepare(`INSERT INTO board_seen (slug, at, prev, last) SELECT me.s, ?, NULL, ? ${own} ON CONFLICT(slug) DO UPDATE SET
      prev = CASE WHEN COALESCE(board_seen.last, board_seen.at, '') < ? THEN board_seen.at ELSE board_seen.prev END,
      at = CASE WHEN COALESCE(board_seen.last, board_seen.at, '') < ? THEN excluded.at ELSE board_seen.at END,
      last = MAX(COALESCE(board_seen.last, ''), excluded.last)`)
    .bind(at, at, ...mine, gap, gap).run();
}
/** Everything the board page shows, for a member (`member`) or an admin looking (`admin`) */
export async function portalData(env, { member = null, admin = false, adminEmail = '', now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  const today = todayEastern(now);
  const [meetings, docs, numbers, history, people, filings, snapshot, settings, gifts] = await Promise.all([
    listMeetings(env.DB), listDocs(env.DB), liveNumbers(env, { now }), cashHistory(env.DB), roster(env.DB, { withEmails: true }),
    siteDoc(env.DB, 'financials'), siteDoc(env.DB, 'financial-snapshot'), getSettings(env.DB), giftsNow(env.DB, { now }).catch(() => null),
  ]);
  // The visit before this one, for what's new since: the same for the whole visit, every reload, tab and device. This
  // read is a look too (a reload, a tab coming back, the page reading itself again), and so is everything they do on
  // the page while it's open (./keepVisit)
  let lastSeen = null;
  if (member) {
    await keepVisit(env.DB, member, now);
    lastSeen = (await env.DB.prepare('SELECT prev FROM board_seen WHERE slug = ?').bind(member.slug).first())?.prev || null;
  }
  // A member's own documents (put with an item they present) are marked, so they can take them off again
  const own = member?.email ? new Set(((await env.DB.prepare('SELECT id FROM board_files WHERE lower(by) = ?').bind(String(member.email).toLowerCase()).all()).results || []).map((r) => r.id)) : new Set();
  const shared = meetings.map(boardCopy).filter(Boolean).map((m) => (own.size ? { ...m, files: m.files.map((f) => (own.has(f.id) ? { ...f, mine: true } : f)) } : m))
    .map((m) => (m.snapshot ? { ...m, snapshot: snapshotFor(m.snapshot, meetings) } : m));
  // Their adopted signature and initials (from the last time they signed), and whether they've agreed to sign electronically
  const marked = member?.slug ? await env.DB.prepare('SELECT mark, initials, consent_at FROM board_member_marks WHERE slug = ?').bind(member.slug).first().catch(() => null) : null;
  const myMark = marked ? { ...parse(marked.mark, {}), initials: marked.initials || '', consented: !!marked.consent_at } : null;
  // Their signed copies, every year's (this year's and earlier wordings' too): each to open again
  const myCopies = member?.slug ? ((await env.DB.prepare('SELECT doc_id, year, version, record_id, at FROM board_signatures WHERE slug = ?1 AND record_id IS NOT NULL UNION ALL SELECT doc_id, year, version, record_id, at FROM board_signatures_earlier WHERE slug = ?1 AND record_id IS NOT NULL ORDER BY year DESC, at DESC').bind(member.slug).all().catch(() => ({ results: [] }))).results || []) : [];
  const mine = member?.slug || null;
  // A paper read as its PDF: its words, as read, to find it by them
  const fileWords = {};
  const pdfIds = docs.filter((d) => d.shared && !d.body && d.file).map((d) => d.file.id);
  if (pdfIds.length) for (const r of ((await env.DB.prepare(`SELECT id, COALESCE(NULLIF(words, ''), words_part) AS words FROM board_files WHERE id IN (${pdfIds.map(() => '?').join(',')})`).bind(...pdfIds).all()).results || [])) if (r.words) fileWords[r.id] = r.words.slice(0, 60000);
  // The words a member signed, for each paper they're asked to sign again: what changed, shown beside the new (from the
  // last version their signature counted on: a typo kept since isn't a change to them)
  const signedBodies = {};
  for (const d of docs) {
    // (or, in a new year, the wording they signed last time, when it's known and there's a newer one)
    const last = mine && d.prior?.[mine];
    const v = mine && d.body && !d.signed[mine] && (d.before?.[mine] ? Math.max(d.before[mine].version, d.signFrom - 1) : last && last.version && last.version < d.version ? last.version : 0);
    if (!v) continue;
    const row = await env.DB.prepare('SELECT body FROM board_doc_versions WHERE doc_id = ? AND version = ?').bind(d.id, v).first();
    if (row?.body) signedBodies[d.id] = row.body;
  }
  // The Board area's admins by their names on People; who to ask is the one the invites come from
  const nameOf = (e) => people.staff.find((p) => e.startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`))?.name || e.split('@')[0];
  const admins = settings.admins.map((e) => ({ email: e, name: nameOf(e) }));
  const contact = admins.find((a) => a.email === settings.invitesFrom) || admins[0] || null;
  // The next meeting ahead the board already has on its calendars, before it's shared here: when and where only,
  // never its agenda, notes, files or numbers. None once a shared meeting comes first (or the same day)
  const sharedNext = nextMeeting(shared, today);
  const ahead = meetings.filter((m) => !m.shared && onBoardPage(m, today)).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const pending = ahead && !(sharedNext && sharedNext.date <= ahead.date) ? ahead : null;
  const pendingInvite = pending && mine ? repliesOf(pending)[mine] || '' : '';
  // An admin looking at the board page: today's practice meeting, if they've started one (members never see it)
  const practice = admin && !member ? await todayPractice(env.DB, now) : null;
  const staffSlug = admin && !member ? people.staff.find((p) => String(adminEmail).toLowerCase().startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`))?.slug || null : null;
  return {
    ...(admin && !member ? {
      practice: practice ? { id: practice.id, title: meetingName(practice), date: practice.date, live: practice.live } : null,
      // Board's "See it as the board will" on a meeting ahead not shared yet: what the board will see once it is, by its
      // link only (never in the lists, the search or Home, which stay as the board has them)
      previews: meetings.filter((m) => !m.shared && !m.notBoard && isDate(m.date) && m.date >= today)
        .map((m) => ({ ...forBoard({ ...m, shared: true }), shared: false, preview: true, myInvite: '', onCalendar: false })),
    } : {}),
    contact,
    admins: admins.map((a) => a.name),
    nextPending: pending ? {
      id: pending.id, date: pending.date, start: pending.start, end: pending.end, title: pending.title, name: meetingName(pending),
      location: pending.location, address: pending.address, video: pending.video || pending.invite?.meet || '',
      onCalendar: !!pendingInvite, myInvite: pendingInvite, inviteOut: inviteOut(pending), inviteBy: inviteFrom(pending, people, settings),
    } : null,
    // lastSeen: when the visit before this one began (above), for what's new since
    // An admin looking: who they are on People (`as`), so the item they present asks them for its report too
    me: member ? { name: member.name, slug: member.slug, title: member.title, email: member.email, admin, lastSeen, ...(myMark ? { mark: myMark } : {}) }
      : { name: null, slug: null, admin, as: people.staff.find((p) => String(adminEmail).toLowerCase().startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`))?.slug || null },
    today,
    // Their own answer here, else how they answered the calendar invite (which also means it's on their calendar)
    meetings: shared.map((m) => {
      const full = meetings.find((x) => x.id === m.id);
      const invite = mine ? repliesOf(full)[mine] || '' : '';
      return { ...m, myInvite: invite, onCalendar: !!invite, inviteOut: inviteOut(full), inviteBy: inviteFrom(full, people, settings) };
    }),
    next: nextMeeting(shared, today)?.id || null,
    quorum: settings.quorum,
    // (a founder has no member sign-in: their own come by who they are on People, the same as a report they present)
    actions: openActions(shared).map((a) => ({ ...a, mine: !!(mine || staffSlug) && a.owner === (mine || staffSlug) })),
    // Who has signed is Board's to see: a member sees how many of the board have, and their own (its copy, if one's in)
    // (and whether they signed an earlier wording, before the board was asked to sign again)
    docs: docs.filter((d) => d.shared || !member).map(({ signed, earlier, before, prior, kept, declined, wordsBy, ...d }) => ({
      ...(d.shared ? {} : { hidden: true }),
      ...d, file: d.file && !d.file.staffOnly ? d.file : null,
      signedByMe: mine && signed[mine] ? { ...signed[mine], drive: !!signed[mine].drive } : null,
      signedEarlier: !!mine && !signed[mine] && earlier.includes(mine),
      // They told SOARD they can't sign it as written: when, and what they said (they can still sign it)
      declinedByMe: mine && declined[mine] ? declined[mine] : null,
      // Not signed this year, but in an earlier one: when, and on which wording (0: not known)
      signedBefore: mine && !signed[mine] && !earlier.includes(mine) && prior[mine] ? { year: prior[mine].year, at: prior[mine].how === 'drive' ? '' : prior[mine].at, version: prior[mine].version } : null,
      ...(signedBodies[d.id] ? { signedBody: signedBodies[d.id] } : {}),
      ...(myCopies.some((c) => c.doc_id === d.id) ? { myCopies: myCopies.filter((c) => c.doc_id === d.id).map((c) => ({ year: Number(c.year), version: Number(c.version) || 0, id: c.record_id, at: c.at })) } : {}),
      ...(!d.body && d.file && fileWords[d.file.id] ? { fileWords: fileWords[d.file.id] } : {}),
      signedCount: people.board.filter((p) => signed[p.slug]).length,
    })),
    numbers,
    // Cash at each month's end: QuickBooks' own month-ends once it's connected (13 of them, the books'), else the banks' history
    cashHistory: numbers.books?.months?.length > 1 ? [...numbers.books.months].reverse().map((r) => ({ month: r.month, total: r.total, at: r.end })) : history,
    // The public copies, through the site's own /files/ route so the page's viewer can open them
    filings: filingsOf(filings),
    snapshot: snapshot || null,
    // This year's gifts of $1,000 or more, from Zeffy (./_board-gifts.js)
    gifts,
    people: {
      board: people.board.map(({ email, ...p }) => ({ ...p, email: email || null })),
      staff: people.staff.map(({ email, ...p }) => p),
      advisory: people.advisory.map(({ email, ...p }) => p),
    },
  };
}

// ─── A meeting as it's held ─────────────────────────────────────────
//
// The chair runs the meeting from the Board area (public/admin/board-meeting.js, During): starts it, moves item by
// item, opens and closes votes. Board members follow it on the board page (GET /api/board-portal?live=<id>, every
// few seconds): the item being discussed, who's here, the vote that's open. They check in and vote there; the chair's
// screen sees both (GET /api/board-admin?live=<id>). A practice meeting runs the same way with simulated members.

const fnv = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const isoOf = (ms) => new Date(ms).toISOString();
const HOW = ['present', 'remote'];
const VOTE_CHOICES = ['for', 'against', 'abstain'];
const err = (message, status) => Object.assign(new Error(message), { status });
/**
 * What a page is told of an error the code never meant to say (a program's own, the database's): plain words, and the
 * real one in the log. Anything Board says on purpose is said as it is
 */
export function sayable(e) {
  const raw = e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError || /D1_ERROR|SQLITE|constraint failed|no such (table|column)|Cannot read propert/i.test(String(e?.message || e));
  if (!raw) return String(e?.message || e || '');
  console.error('[board]', e?.stack || e);
  return 'Something went wrong on the site’s side. Reload the page to see what was saved, then try again.';
}

/**
 * A practice meeting's simulated board members, worked out from the clock (never stored, the same on every
 * screen): each checks in 3 to 40 seconds after the chair starts, most in the room, some by video, one or two
 * never. → [{ slug, name, how, at, simulated }]
 */
export function simulatedCheckins(m, now = Date.now()) {
  const t0 = Date.parse(m?.live?.startedAt || '');
  if (!m?.practice || !Number.isFinite(t0)) return [];
  const hashed = m.attendance.filter((p) => p.kind === 'board' && p.slug).map((p) => ({ p, h: fnv(`${m.id}:${p.slug}`) }));
  // One never comes, so the admin practising (checking in as one more) never makes more here than the board has
  const never = hashed.length > 1 ? hashed.reduce((a, b) => (b.h < a.h ? b : a)).p.slug : '';
  return hashed.flatMap(({ p, h }) => {
    const r = h % 100;
    if (p.slug === never || r < 7) return [];
    const t = t0 + (3 + ((h >>> 8) % 38)) * 1000;
    return t <= now ? [{ slug: p.slug, name: p.name, how: r < 27 ? 'remote' : 'present', at: isoOf(t), simulated: true }] : [];
  });
}
/** …and each simulated member who's here votes 2 to 14 seconds after the vote opens (or after arriving), mostly for */
export function simulatedVotes(m, vote, checkins, now = Date.now()) {
  const t1 = Date.parse(vote?.openedAt || '');
  if (!m?.practice || !Number.isFinite(t1)) return [];
  return checkins.filter((c) => c.simulated).flatMap((c) => {
    const h = fnv(`${m.id}:${vote.motionId}:${c.slug}`);
    const t = Math.max(t1, Date.parse(c.at)) + (2 + (h % 13)) * 1000;
    if (t > now) return [];
    const r = (h >>> 8) % 20;
    return [{ slug: c.slug, name: c.name, vote: r === 0 ? 'against' : r === 1 ? 'abstain' : 'for', at: isoOf(t), simulated: true }];
  });
}

/** An admin practising, as one more member: { slug: 'admin:peter', name: their name on People } */
async function adminVoter(DB, email) {
  const e = String(email || '').toLowerCase();
  const local = e.split('@')[0].replace(/[^a-z0-9.-]/g, '') || 'you';
  const people = await roster(DB);
  const name = people.staff.find((p) => e.startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`))?.name || local[0].toUpperCase() + local.slice(1);
  return { slug: `admin:${local}`, name };
}

/** The meeting someone follows live: a member, a shared one (acting); an admin, a shared one (looking) or a practice one (acting) */
async function liveMeeting(DB, id, { member = null, admin = false } = {}) {
  if (!ID.test(String(id || ''))) throw err('Which meeting?', 400);
  const m = await getMeeting(DB, id);
  if (m) {
    // An admin previews it on the screen before it's shared (as the board will see it), acting in nothing
    if (!boardCopy(m) && !(admin && !member)) throw err('That meeting isn’t on the board page', 404);
    return { m, canAct: !!member };
  }
  const p = admin && !member ? await getPractice(DB, id) : null;
  if (!p) throw err('That meeting isn’t on the board page', 404);
  return { m: p, canAct: true };
}

/** Check-ins (real, and a practice meeting's simulated ones), who's here, and the votes by motion */
async function liveRows(DB, m, now) {
  const [ci, vs] = await Promise.all([
    DB.prepare('SELECT slug, name, how, at FROM board_checkins WHERE meeting_id = ?').bind(m.id).all().then((r) => r.results || []),
    DB.prepare('SELECT motion_id, slug, name, vote, at FROM board_votes WHERE meeting_id = ?').bind(m.id).all().then((r) => r.results || []),
  ]);
  const real = new Map(ci.map((c) => [c.slug, { slug: c.slug, name: c.name || '', how: c.how, at: c.at || '' }]));
  const checkins = [...simulatedCheckins(m, now).filter((c) => !real.has(c.slug)), ...real.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // Here: board members the chair marked there, then anyone who checked in (practising, the admin is one more)
  const board = m.attendance.filter((p) => p.kind === 'board');
  const here = new Map();
  for (const p of board) if (p.status === 'present' || p.status === 'remote') here.set(p.slug || p.key, p.status);
  for (const c of checkins) {
    if (here.has(c.slug)) continue;
    if (board.some((p) => p.slug === c.slug) || (m.practice && c.slug.startsWith('admin:'))) here.set(c.slug, c.how);
  }
  // Votes by motion: an open vote counts only what came in since it opened (a vote taken again starts over)
  const vote = isLive(m) && m.live.vote && m.motions.some((x) => x.id === m.live.vote.motionId) ? m.live.vote : null;
  const votes = {};
  for (const v of vs) {
    if (vote && v.motion_id === vote.motionId && vote.openedAt && String(v.at) < vote.openedAt) continue;
    (votes[v.motion_id] ||= []).push({ slug: v.slug, name: v.name || '', vote: v.vote, at: v.at || '' });
  }
  if (vote) {
    const cast = new Set((votes[vote.motionId] || []).map((v) => v.slug));
    votes[vote.motionId] = [...(votes[vote.motionId] || []), ...simulatedVotes(m, vote, checkins, now).filter((v) => !cast.has(v.slug))]
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return { checkins, here, votes, vote, board };
}

/**
 * GET /api/board-portal?live=<id>: the meeting as it's held, for the board page (cheap: no JobTread or Mercury).
 * Never a private note. The quorum is Settings' number when set, else a majority of the board on the list.
 * `here.met` is null only when the meeting has no board members on its list.
 */
export async function liveView(env, id, { member = null, admin = false, adminEmail = '', now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  const { m, canAct } = await liveMeeting(env.DB, id, { member, admin });
  const [settings, rows] = await Promise.all([getSettings(env.DB), liveRows(env.DB, m, now)]);
  const { here, votes, vote, board, checkins } = rows;
  const me = member ? { slug: member.slug, name: member.name } : canAct ? await adminVoter(env.DB, adminEmail) : null;
  // As the board sees it (an admin's preview of one not shared yet too: never a private note or a staff-only file)
  const seen = m.practice ? m : forBoard({ ...m, shared: true });
  const sections = seen.sections.map((sec) => ({
    id: sec.id, title: sec.title, minutes: sec.minutes || 0,
    items: sec.items.filter(isFilled).map((it) => ({ id: it.id, title: it.title, motion: it.motion || '', presenter: it.presenter, who: it.who, guests: it.guests || [], notes: it.notes, confidential: it.confidential, live: it.live, also: it.also, about: it.about, docs: it.docs,
      report: it.report, reportBy: it.reportBy, reportAt: it.reportAt, reportLook: it.reportLook || '', slideOrder: it.slideOrder || [] })),
  }));
  // The last meeting's minutes, for an item that asks the board to approve them (only from a meeting the board can see)
  const prior = [];
  for (const id of new Set(seen.sections.flatMap((sec) => sec.items.filter((it) => it.live === 'minutes' && it.about).map((it) => it.about)))) {
    const prev = await getMeeting(env.DB, id);
    if (!boardCopy(prev)) continue;
    const f = minutesFileOf(prev);
    // Its date and name for the screen's "since we last met"; its minutes for the item that approves them
    prior.push({ id: prev.id, date: prev.date, name: meetingName(prev), files: f ? [f] : [] });
  }
  const motion = vote ? m.motions.find((x) => x.id === vote.motionId) : null;
  const cast = motion ? votes[motion.id] || [] : [];
  const n = (v) => cast.filter((x) => x.vote === v).length;
  const marked = me ? m.attendance.find((p) => p.slug === me.slug && HOW.includes(p.status))?.status : '';
  const q = settings.quorum || majority(board.length);
  return {
    id: m.id, practice: !!m.practice, updatedAt: m.updatedAt, title: meetingName(m), date: m.date, start: m.start, end: m.end,
    live: { startedAt: m.live.startedAt, endedAt: m.live.endedAt, itemId: m.live.itemId, fileId: m.live.fileId, page: m.live.page, part: m.live.part, screen: m.live.screen, sectionId: m.live.sectionId, sectionAt: m.live.sectionAt, floor: m.live.floor },
    sections,
    // What the screen shows: the board's files (never a staff-only one), the last meeting's minutes, the locked numbers
    files: seen.files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, kind: f.kind, at: f.at })),
    prior,
    snapshot: m.practice ? m.snapshot || null : await boardSnapshot(env.DB, m.snapshot),
    here: { board: here.size, of: board.length, quorum: q, met: q ? here.size >= q : null, remote: [...here.values()].filter((h) => h === 'remote').length },
    // The roll call on the screen: the board on the meeting's list, each one here (in the room or by video) or not yet
    roll: board.map((p) => ({ slug: p.slug || '', name: p.name, how: here.get(p.slug || p.key) || '' })),
    me: { how: (me && (checkins.find((c) => c.slug === me.slug)?.how || marked)) || '', canAct: !!(canAct && me), name: me?.name || '' },
    vote: motion ? {
      motionId: motion.id, text: motion.text, by: motion.by, second: motion.second, openedAt: vote.openedAt,
      counts: { for: n('for'), against: n('against'), abstain: n('abstain'), voted: cast.length, of: here.size },
      mine: (me && cast.find((x) => x.slug === me.slug)?.vote) || '',
    } : null,
    motions: m.motions.map((x) => ({ id: x.id, text: x.text, by: x.by, second: x.second, result: x.result, tally: x.tally })),
    actions: m.actions.map((a) => ({ id: a.id, text: a.text, ownerName: a.ownerName, owner: a.owner, due: a.due, done: a.done })),
  };
}

async function liveActor(env, m, canAct, { member, adminEmail, now }) {
  if (!canAct) throw err('Board members answer for themselves.', 403);
  const who = member ? { slug: member.slug, name: member.name } : await adminVoter(env.DB, adminEmail);
  const rl = await limit(env.DB, `board-live:${m.id}:${who.slug}`, 40, 60, { now });
  if (!rl.ok) throw err('That’s a lot of taps. Wait a few seconds and try again.', 429);
  return who;
}

/** POST { action: 'checkin', meetingId, how }: here in the room, or on video (a member on the meeting's day; an admin practising) */
export async function liveCheckIn(env, id, { member = null, admin = false, adminEmail = '', how, now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  if (!HOW.includes(how)) throw err('In the room, or on video?', 400);
  const { m, canAct } = await liveMeeting(env.DB, id, { member, admin });
  if (!m.practice && !isLive(m) && m.date !== todayEastern(now)) throw err('Checking in opens on the meeting’s day', 409);
  const who = await liveActor(env, m, canAct, { member, adminEmail, now });
  await env.DB.prepare('INSERT OR REPLACE INTO board_checkins (meeting_id, slug, name, how, at) VALUES (?, ?, ?, ?, ?)').bind(m.id, who.slug, who.name, how, isoOf(now)).run();
  return liveView(env, id, { member, admin, adminEmail, now });
}

/** POST { action: 'vote', meetingId, motionId, vote }: for, against or abstain, while the chair has that vote open (a change of mind counts) */
export async function liveVote(env, id, motionId, choice, { member = null, admin = false, adminEmail = '', now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  if (!VOTE_CHOICES.includes(choice)) throw err('For, against, or abstain?', 400);
  const { m, canAct } = await liveMeeting(env.DB, id, { member, admin });
  if (!isLive(m) || m.live.vote?.motionId !== motionId) throw err('That vote isn’t open', 409);
  const who = await liveActor(env, m, canAct, { member, adminEmail, now });
  const { here } = await liveRows(env.DB, m, now);
  if (!here.has(who.slug)) throw err('Check in first (in the room or on video), then vote', 409);
  await env.DB.prepare('INSERT OR REPLACE INTO board_votes (meeting_id, motion_id, slug, name, vote, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(m.id, motionId, who.slug, who.name, choice, isoOf(now)).run();
  return liveView(env, id, { member, admin, adminEmail, now });
}

/** GET /api/board-admin?live=<id>: the chair's screen, every few seconds: who checked in, and every vote by motion */
export async function chairLive(env, id, { now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  if (!ID.test(String(id || ''))) throw err('Which meeting?', 400);
  const m = (await getMeeting(env.DB, id)) || (await getPractice(env.DB, id));
  if (!m) throw err('That meeting is gone', 404);
  const { checkins, votes } = await liveRows(env.DB, m, now);
  return {
    checkins: checkins.map(({ slug, name, how, at }) => ({ slug, name, how, at })),
    votes: Object.fromEntries(Object.entries(votes).map(([k, list]) => [k, list.map(({ slug, name, vote, at }) => ({ slug, name, vote, at }))])),
  };
}

const easternHm = (ms) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/New_York' }).format(new Date(ms));
async function clearPractice(DB, id, { remove = false } = {}) {
  await DB.prepare('DELETE FROM board_checkins WHERE meeting_id = ?').bind(id).run();
  await DB.prepare('DELETE FROM board_votes WHERE meeting_id = ?').bind(id).run();
  if (remove) await DB.prepare('DELETE FROM board_practice WHERE id = ?').bind(id).run();
}

/**
 * POST /api/board-admin { action: 'practice' }: today's practice meeting, made the first time. Only the admins see
 * it: the next meeting's agenda (else one drafted from the last, else Settings' outline), the real board as its
 * members (simulated once it starts), a motion to vote on. A week later it's cleared away. → the meeting
 */
export async function createPractice(env, { by = '', now = Date.now(), fresh = false } = {}) {
  await ensureSchema(env.DB);
  const today = todayEastern(now);
  if (!fresh) {
    const cur = await todayPractice(env.DB, now);
    if (cur?.borrowed) return cur;
    // One made before practice meetings had documents: a new one that has them
    if (cur) await clearPractice(env.DB, cur.id, { remove: true });
  }
  const weekAgo = todayEastern(now - 7 * 86_400_000);
  for (const r of (await env.DB.prepare('SELECT id FROM board_practice WHERE date < ?').bind(weekAgo).all()).results || []) await clearPractice(env.DB, r.id, { remove: true });
  const [meetings, settings, people] = await Promise.all([listMeetings(env.DB), getSettings(env.DB), roster(env.DB)]);
  const withAgenda = meetings.filter((x) => isDate(x.date) && x.sections.some((sec) => sec.items.length));
  const ahead = withAgenda.filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const last = withAgenda.filter((x) => x.date < today)[0];
  const base = newMeeting({
    date: today, template: settings.template, meetings: [], defaults: settings.defaults,
    board: people.board.map((p) => ({ slug: p.slug, name: p.name, org: p.organization })),
    staff: people.staff.filter((p) => /founder/i.test(p.title)).map((p) => ({ slug: p.slug, name: p.name })),
  });
  // Its documents are borrowed, never copied: the files stay the real meeting's (getPractice reads them as they are now)
  const shown = (x) => (x?.files || []).filter((f) => !f.staffOnly && f.kind !== 'signed');
  const borrowed = shown(ahead).map((f) => f.id);
  // Its own ids, and no link back to a real meeting (its minutes item can't approve anything). The minutes it would
  // approve stay on that item, as the screen shows them at the real meeting
  const own = (sections) => sections.map((sec) => ({ ...sec, id: uid('s_'), items: sec.items.filter(isFilled).map((it) => {
    const prev = it.live === 'minutes' && it.about ? meetings.find((x) => x.id === it.about) : null;
    const f = prev?.shared ? minutesFileOf(prev) : null;
    if (f && !borrowed.includes(f.id)) borrowed.push(f.id);
    return { ...it, id: uid('i_'), title: it.title || LIVE_TITLES[it.live] || '', about: '', docs: f ? [f.id, ...(it.docs || []).filter((d) => d !== f.id)] : it.docs };
  }) }));
  const sections = own(ahead ? ahead.sections : last ? draftAgenda(last, { template: settings.template }) : base.sections);
  const startMin = Math.floor(((([h, mm]) => h * 60 + mm)(easternHm(now).split(':').map(Number))) / 5) * 5;
  const hm = (min) => `${String(Math.floor(Math.min(min, 1439) / 60)).padStart(2, '0')}:${String(Math.min(min, 1439) % 60).padStart(2, '0')}`;
  const m = cleanMeeting({
    ...base, id: uid('m_'), date: today, start: hm(startMin), end: hm(startMin + 60), title: 'Practice meeting', location: '', address: '', video: '',
    practice: true, shared: false, sections, actions: [],
    motions: [{ id: uid('v_'), text: last ? `Approve the minutes of the ${meetingName(last)}` : 'Approve the agenda as written', by: '', second: '', result: 'passed' }],
    agendaFrom: { kind: 'typed', name: '', at: isoOf(now) }, createdAt: isoOf(now), updatedAt: isoOf(now), updatedBy: by,
  });
  // The next meeting has no documents yet: the last meeting's, each with the item it fits (as an upload is placed)
  let docsFrom = '';
  if (!shown(ahead).length) {
    const prev = meetings.find((x) => isDate(x.date) && x.date < today && !x.notBoard && shown(x).some((f) => f.kind !== 'agenda' && !borrowed.includes(f.id)));
    // (never its old agenda: the practice has its own)
    for (const f of shown(prev).filter((x) => x.kind !== 'agenda' && !borrowed.includes(x.id))) {
      borrowed.push(f.id);
      const at = guessItem(m, f, today);
      if (at) m.sections = m.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.id === at ? { ...it, docs: [...it.docs, f.id] } : it)) }));
    }
    if (prev) docsFrom = prev.date;
  }
  if (!(await writeOver(env.DB, { ...m, borrowed, docsFrom }, null))) throw new Error('A practice meeting with that id is already there; try again');
  return getPractice(env.DB, m.id);
}

/** POST { action: 'practice-reset', id }: start over (a new practice meeting; the old one's taps and votes go) */
export async function resetPractice(env, id, { by = '', now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  if (!(await getPractice(env.DB, id))) throw err('That practice meeting is gone', 404);
  await clearPractice(env.DB, id, { remove: true });
  return createPractice(env, { by, now, fresh: true });
}

/**
 * For the admin's Members tab: each active board member, their email on file, last visit, when they were last asked
 * to sign this year's papers (`asked`: { at, by, n }), and what they signed in the years before this one (`pastYears`,
 * newest first: [{ year, docId, title, name, at, how, copy, drive }]; this year's are on the documents)
 */
export async function memberStatus(DB) {
  await ensureSchema(DB);
  const [board, seen, past, titles, copies, asks] = await Promise.all([
    activeBoard(DB),
    DB.prepare('SELECT slug, at FROM board_seen').all().then((r) => Object.fromEntries((r.results || []).map((x) => [x.slug, x.at]))),
    DB.prepare('SELECT * FROM board_signatures WHERE year < ? ORDER BY year DESC, at').bind(thisYear()).all().then((r) => r.results || []),
    DB.prepare('SELECT data FROM board_docs').all().then((r) => Object.fromEntries((r.results || []).map((x) => cleanDoc(parse(x.data))).map((d) => [d.id, d.title]))),
    filesOf(DB, 'signed').then((by) => Object.fromEntries(Object.values(by).flat().map((f) => [f.id, f]))),
    signAsks(DB),
  ]);
  return board.sort(comparePeople).map((p) => ({
    slug: p.slug, name: p.name, title: p.title || '', seat: p.seat || '', email: p.email, lastSeen: seen[p.slug] || null,
    pastYears: past.filter((s) => s.slug === p.slug && titles[s.doc_id]).map((s) => ({ year: Number(s.year), docId: s.doc_id, title: titles[s.doc_id], ...signatureOf(s, copies) })),
    // Asked by email to sign this year's: when last, how many times
    asked: asks[p.slug] || null,
  }));
}

// ─── The heartbeat ──────────────────────────────────────────────────

/** A fresh agenda keeps the documents already put with its items (by item name), so starting it again never strands a file */
function keepDocs(was, draft) {
  const docsOf = new Map(was.flatMap((s) => s.items).filter((it) => it.docs?.length).map((it) => [it.title.toLowerCase(), it.docs]));
  return draft.map((s) => ({ ...s, items: s.items.map((it) => (docsOf.has(it.title.toLowerCase()) ? { ...it, docs: docsOf.get(it.title.toLowerCase()) } : it)) }));
}

/**
 * On a meeting's day, its numbers are locked by themselves (the makeovers, reveals, events and money as they stand
 * that morning), so the minutes keep what the board saw. Once; the chair's Start locks them too if this hasn't yet
 */
export async function maybeLockNumbers(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const today = todayEastern(now);
  const locked = [];
  try {
    for (const m of (await listMeetings(env.DB)).filter((x) => x.date === today && !x.snapshot && !x.notBoard && x.sections.some((s) => s.items.length))) {
      await takeSnapshot(env, m.id, { by: 'Board', fetchImpl, now });
      locked.push(m.id);
    }
  } catch (err) {
    console.error('[board] locking numbers', err.message);
  }
  return locked;
}

/**
 * Each meeting still ahead keeps the board as People → Board has it written down (the list withState shows), each
 * heartbeat it differs: so the day it's held, the record it keeps is the board of that day, never the board from when it
 * was made. People reading empty is taken for a bad read and nothing is written. Never throws. → ids written
 */
export async function maybeKeepRolls(env, { now = Date.now() } = {}) {
  const kept = [];
  try {
    const today = todayEastern(now);
    const rows = (await env.DB.prepare('SELECT data FROM board_meetings WHERE date >= ?').bind(today).all()).results || [];
    const ahead = rows.map((r) => cleanMeeting(parse(r.data))).filter((m) => stillAhead(m, now));
    const board = ahead.length ? await activeBoard(env.DB) : [];
    if (!board.length) return kept;
    const { followRoll } = await import('./_board-invite.js');
    // (written from the meeting as it's read now, which has the board as it is: patchMeeting writes it over only that copy)
    for (const m of ahead) if (followRoll(m.attendance, board) && (await patchMeeting(env.DB, m.id, (cur) => cur, { by: 'Board' }))) kept.push(m.id);
  } catch (err) {
    console.error('[board] keeping the board on meetings ahead', err.message);
  }
  return kept;
}

/**
 * Each meeting ahead that nobody has written an agenda for is on the template (templateAgenda): one drafted from the
 * last agenda goes back to it, a changed template reaches it, and when a meeting is added or moved before it, its
 * minutes item follows. A person's change makes the agenda theirs and it's left alone. Every ten minutes at most, or
 * now (force: the template was just saved). → ids changed
 */
export async function maybeTemplateAgendas(env, { now = Date.now(), force = false } = {}) {
  try {
    const runs = await readState(env.DB, 'runs');
    if (!force && runs.draftAt && now - Date.parse(runs.draftAt) < 10 * 60 * 1000) return [];
    await writeState(env.DB, 'runs', { ...runs, draftAt: new Date(now).toISOString() });
    const [meetings, settings] = await Promise.all([listMeetings(env.DB), getSettings(env.DB)]);
    const today = todayEastern(now);
    const changed = [];
    const real = meetings.filter((x) => !x.notBoard);
    for (const m of real.filter((x) => x.date >= today && agendaIsDraft(x, settings.template))) {
      const prev = previousMeeting(m, real);
      const name = prev ? draftName(prev) : '';
      const fresh = keepDocs(m.sections, templateAgenda(prev, { template: settings.template, date: m.date }));
      if (m.agendaFrom?.kind === 'template' && m.agendaFrom.name === name && agendaSkeleton({ sections: fresh }) === agendaSkeleton(m)) continue;
      const done = await patchMeeting(env.DB, m.id, (cur) => (agendaIsDraft(cur, settings.template)
        ? { ...cur, sections: keepDocs(cur.sections, templateAgenda(prev, { template: settings.template, date: cur.date })), agendaFrom: { kind: 'template', name, at: new Date(now).toISOString() } }
        : cur));
      if (done) changed.push(m.id);
    }
    return changed;
  } catch (err) {
    console.error('[board] agendas on the template', err.message);
    return [];
  }
}

/**
 * Once for each newer agenda reader (board-shared.js AGENDA_READER): an agenda
 * an older reader filled from an emailed file, nobody has changed since, read
 * again from the copy Board keeps. Kept as it was when it reads no better.
 * → ids read again
 */
export async function maybeRereadEmailAgendas(env, { now = Date.now() } = {}) {
  const done = [];
  try {
    for (const m of (await listMeetings(env.DB)).filter((x) => x.agendaFrom?.kind === 'email' && readAgain(x) && !x.minutesFrom?.typed)) {
      const f = m.files.find((x) => x.name === m.agendaFrom.name);
      let parsed = null;
      // (People not answering: nothing is marked read again, and the next heartbeat reads it: never an agenda read
      // against nobody, nor one that's done with for want of a read. Round 10)
      if (f) { try { parsed = await readFileAsAgenda(env, f.id); } catch (err) { if (err?.unread) throw err; console.error('[board] reading again', f.name, err.message); } }
      const better = !!parsed?.sections.some((s) => s.items.length);
      await patchMeeting(env.DB, m.id, (cur) => (cur.agendaFrom?.kind === 'email' && readAgain(cur) && !cur.minutesFrom?.typed
        ? { ...cur, ...(better ? { sections: parsed.sections } : {}), agendaFrom: { ...cur.agendaFrom, ...(better ? { at: new Date(now).toISOString() } : {}), v: AGENDA_READER } }
        : cur));
      if (better) done.push(m.id);
    }
  } catch (err) {
    console.error('[board] email agendas', err.message);
  }
  return done;
}

/**
 * The heartbeat, in order:
 *   - every 5 minutes at most, Access's board list kept in step with People → Board (./_board-access.js),
 *     and so is the board's Google Group, board@soardcharity.com (./_board-group.js)
 *   - hourly, the board meetings on Peter and Holly's calendars (./_board-calendar.js)
 *   - every 5 minutes at most, the invites and attendance lists ahead kept in step with People → Board (./_board-invite.js)
 *   - the day after each meeting's date, the same quarter next year added and invited (./_board-schedule.js)
 *   - each minute, a new place onto an invite that's out once it has settled; hourly until it
 *     passes, the check that Calendar, Meet and attendance work (./_board-invite.js)
 *   - once a newer agenda reader ships, emailed agendas it reads better (maybeRereadEmailAgendas); then
 *   - every ten minutes, agendas nobody wrote kept on the template (maybeTemplateAgendas), a meeting's
 *     numbers locked on its day (maybeLockNumbers), and
 *     who joined a Google Meet that ended (./_board-attendance.js)
 *   - hourly in business hours when it's on, action item reminders (./_board-actions.js); a signed copy of the minutes
 *     that didn't get made as it was signed (./_board-minutes-sign.js)
 *   - last, board mail (./_board-mail.js): every minute while there's a backlog, hourly after; then minutes read without
 *     Workers AI read again for their motions and action items (./_board-minutes.js maybeFinishMinutes)
 *   - hourly, QuickBooks' revenue and expenses for the year so far (./_quickbooks.js)
 *   - every 15 minutes, the year's major gifts from Zeffy (./_board-gifts.js), and what completed makeovers cost from
 *     JobTread (./_makeover-costs.js), so the board page reads it without waiting
 *   - first, alongside the rest: each minute until all are read, a few board files' words, for the board page's search (./_board-file-words.js)
 *   - once a day, the month's bank balance for the board page's history
 * Never throws.
 */
export async function maybeRunBoard(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  let reading = null;
  try {
    if (!env.DB) return;
    await ensureSchema(env.DB);
    // Board files' words, a few each minute until every one is read, for finding them on the board page: first,
    // alongside the rest, since a scan's page takes the vision model up to 20 s and this work has about 30
    reading = import('./_board-file-words.js').then((m) => m.readBoardWords(env, { limit: 6 })).catch(() => 0);
    await maybeSyncBoardAccess(env, { fetchImpl, now });
    await (await import('./_board-group.js')).maybeSyncBoardGroup(env, { fetchImpl, now });
    await maybeSyncBoardCalendar(env, { fetchImpl, now });
    // A People rename whose board and Advisory Board page records didn't all follow it: finished (./_rename-finish.js);
    // one that can't be finished as it stands is said to the staff once, in Needs attention, as Board's alerts are
    const renames = await import('./_rename-finish.js');
    await renames.maybeFinishRenames(env.DB, { now, ...renames.alertsFor(env) }).catch((e) => console.error('[board] renames', e?.message));
    const invites = await import('./_board-invite.js');
    await invites.maybeRefreshInvites(env, { fetchImpl, now });
    await invites.maybeFollowBoard(env, { fetchImpl, now });
    await maybeKeepRolls(env, { now });
    await (await import('./_board-schedule.js')).maybeScheduleAhead(env, { fetchImpl, now });
    await invites.maybeCheckInvites(env, { fetchImpl, now });
    await maybeSendApprovedAgendas(env, { now });
    await maybeRereadEmailAgendas(env, { now });
    await maybeTemplateAgendas(env, { now });
    await maybeLockNumbers(env, { fetchImpl, now });
    await (await import('./_board-attendance.js')).maybeFillAttendance(env, { fetchImpl, now });
    // Remind by email, when it's on: its own try, so a failure there never holds up mail or the banks
    try { await (await import('./_board-sign.js')).maybeRemindSigners(env, { now }); } catch (err) { console.error('[board] reminders', err?.message || err); }
    try { await (await import('./_board-actions.js')).maybeRemindActions(env, { now }); } catch (err) { console.error('[board] action reminders', err?.message || err); }
    // A signed copy of the minutes that didn't get made as it was signed
    try { await (await import('./_board-minutes-sign.js')).maybeFinishSignedMinutes(env, { now }); } catch (err) { console.error('[board] signed minutes', err?.message || err); }
    // Last: board mail (it reads for seconds while it has a backlog), then minutes read without Workers AI (it ran out
    // of time): their motions and action items, one meeting at a time
    await maybeReadBoardMail(env, { fetchImpl, now });
    await (await import('./_board-minutes.js')).maybeFinishMinutes(env, { now });
    // The banks connected through Plaid every six hours (they keep their own times), then the day's cash
    await (await import('./_plaid.js')).maybeReadBanks(env, { fetchImpl, now });
    // QuickBooks' year so far, hourly once it's connected
    await (await import('./_quickbooks.js')).maybeReadBooks(env, { fetchImpl, now });
    // The year's gifts of $1,000 or more, from Zeffy every 15 minutes
    await (await import('./_board-gifts.js')).maybeReadGifts(env, { fetchImpl, now });
    // What completed makeovers cost, from JobTread every 15 minutes (its own try: JobTread down holds up nothing)
    try { await makeoverCostsNow(env, { fetchImpl, now }); } catch (err) { console.error('[board] costs', err?.message || err); }
    if (!String(env.MERCURY_API_TOKEN || '').trim() && !plaidConfigured(env)) return;
    const runs = await readState(env.DB, 'runs');
    if (runs.cashAt && now - Date.parse(runs.cashAt) < 20 * 60 * 60 * 1000) return;
    await writeState(env.DB, 'runs', { ...runs, cashAt: new Date(now).toISOString() });
    const cash = await cashNow(env, { fetchImpl });
    if (!cash) return;
    await writeState(env.DB, 'cash', { at: new Date(now).toISOString(), value: cash });
    // Months with nothing in the bank aren't history (Mercury's accounts were opened before the money moved)
    if (!(cash.total > 0)) { await env.DB.prepare('DELETE FROM board_cash WHERE total <= 0').run(); return; }
    await env.DB.prepare('INSERT OR REPLACE INTO board_cash (month, total, accounts, at) VALUES (?, ?, ?, ?)')
      .bind(todayEastern(now).slice(0, 7), cash.total, JSON.stringify(cash.accounts), new Date(now).toISOString()).run();
  } catch (err) {
    console.error('[board] heartbeat', err.message);
  } finally {
    await reading;
    // Last and on its own: nothing of the board's waits on the Advisory Board's group, money, invites or nudges (./_advisory-heartbeat.js)
    try { await (await import('./_advisory-heartbeat.js')).maybeRunAdvisory(env, { fetchImpl, now }); } catch (err) { console.error('[board] advisory', err?.message || err); }
  }
}

export { LIMITS };

/** For Site → Automations: the board's sign-in list and its bank history, as counts, times and on/off (never an email) */
export async function boardFacts(env) {
  const { accessStatus } = await import('./_board-access.js');
  await ensureSchema(env.DB);
  const { inviteCheck } = await import('./_board-invite.js');
  const [a, cash, stored, cal, mail, pending, check, banks, books] = await Promise.all([
    accessStatus(env),
    env.DB.prepare('SELECT count(*) AS n, max(at) AS last FROM board_cash WHERE total > 0').first(),
    env.DB.prepare('SELECT data FROM board_meetings').all().then((r) => (r.results || []).map((x) => parse(x.data))),
    calendarStatus(env.DB),
    mailStatus(env.DB),
    import('./_board-invite.js').then((x) => x.pendingInvites(env.DB)),
    inviteCheck(env.DB),
    bankFacts(env),
    booksFacts(env),
  ]);
  const packet = stored.map((m) => m.packetSentAt).filter(Boolean).sort().at(-1) || null;
  const today = todayEastern();
  const invites = stored.filter((m) => m.invite?.eventId && m.date >= today);
  return {
    access: { configured: a.configured, ok: !!a.ok, attached: !!a.attached, current: !!a.current, emails: a.emails, missing: (a.missing || []).length, syncedAt: a.syncedAt || null, error: a.error ? String(a.error).replace(/\S+@\S+/g, '…').slice(0, 200) : null },
    // board@soardcharity.com following the board (./_board-group.js): counts and times, never a name or an email
    group: await (await import('./_board-group.js')).groupStatus(env).then((g) => ({
      configured: g.configured, ok: g.ok, current: g.current, needs: g.needs, members: g.members, wanted: g.wanted, missing: g.missing.length,
      syncedAt: g.syncedAt, failedAt: g.failedAt, error: g.error ? String(g.error).replace(/\S+@\S+/g, '…').slice(0, 200) : null,
      lastChangeAt: g.changes[0]?.at || null, added: g.changes[0]?.added.length || 0, removed: g.changes[0]?.removed.length || 0,
    })),
    cash: { mercury: Boolean(String(env.MERCURY_API_TOKEN || '').trim() && String(env.MERCURY_RELAY_KEY || '').trim()), months: cash?.n || 0, lastAt: cash?.last || null, empty: !((await readState(env.DB, 'cash')).value?.total > 0), readAt: (await readState(env.DB, 'cash')).at || null, banks },
    // QuickBooks' year so far for the board page (./_quickbooks.js): on/off, the company and times only
    books,
    lastPacketAt: packet,
    ahead: await (await import('./_board-schedule.js')).scheduleStatus(env.DB),
    invite: {
      ahead: invites.length,
      follow: await readState(env.DB, 'invite-follow').then((f) => ({ at: f.at || null, lastChangeAt: f.lastChangeAt || null, added: f.lastAdded || 0, removed: f.lastRemoved || 0, held: f.held || 0, error: f.error ? String(f.error).replace(/\S+@\S+/g, '…').slice(0, 200) : null })),
      waiting: Object.keys(pending || {}).length, lastAt: stored.map((m) => m.invite?.updatedAt).filter(Boolean).sort().at(-1) || null,
      check: check ? { ok: !!check.ok, attendance: check.attendance || '', checkedAt: check.checkedAt || null, error: check.error ? String(check.error).replace(/\S+@\S+/g, '…').slice(0, 200) : null } : null,
    },
    // The agendas still on the template, and who joined by Meet, for the meetings that had it
    drafts: { ahead: stored.filter((m) => m.date >= today && m.agendaFrom?.kind === 'template').length, lastAt: stored.map((m) => (m.agendaFrom?.kind === 'template' ? m.agendaFrom.at : '')).filter(Boolean).sort().at(-1) || null },
    attendance: {
      read: stored.filter((m) => m.fromMeet?.status === 'ok').length, needsSetup: stored.filter((m) => m.fromMeet?.status === 'needs-setup').length,
      failing: stored.filter((m) => m.fromMeet?.status === 'error').length, lastAt: stored.map((m) => m.fromMeet?.at).filter(Boolean).sort().at(-1) || null,
    },
    calendar: { configured: Boolean(env.GOOGLE_CALENDAR_KEY), ok: !!cal.ok, checkedAt: cal.checkedAt || null, invites: cal.invites || 0, gone: cal.gone || 0, failing: (cal.errors || []).length, unread: cal.unread && !cal.ok ? cal.failingSince || null : null },
    mail: {
      configured: Boolean(env.GOOGLE_CALENDAR_KEY), ok: !!mail.ok, needsScope: !!mail.needsScope, checkedAt: mail.checkedAt || null, waiting: mail.backlog ?? mail.waiting ?? 0, failing: (mail.errors || []).length,
      meetings: mail.totals?.meetings || 0, files: mail.totals?.files || 0, skipped: mail.totals?.skipped || 0,
    },
  };
}
