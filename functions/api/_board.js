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
  addressesIn, followAddresses, approvedFileAfter, approvedFileOf, FILE_STAYS, minutesStaffOnly, staffOnlyWords, minutesDocOf, minutesKept,
} from '../../public/admin/board-shared.js';
// (what approved minutes state is what their Word file prints, so the rule lives with the template: keepStated)
import { minutesStay } from '../../public/admin/board-minutes-template.js';
import { welcomeHad, REPORT_LOOKS, SLIDE_PIECE, VISIT_GAP_MS, waitsForApproval, shareWaits, cleanTemplate, meetingHeld, heldNoSend } from '../../public/admin/board-shared.js';
import { comparePeople, photoUrl } from '../../public/admin/team-shared.js';
import { reachedCount } from '../../public/admin/community-shared.js';
import { peopleRows, privateEmails, activeBoard, boardAdmins, readState, writeState, readSettings, normEmail, readDown, asSend, PEOPLE_DOWN, stateReady, adminsOf, adminsSaved, organizerOf } from './_board-roles.js';
import { dueStmt } from './_board-notices.js';
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
import { SIG_EVIDENCE, putSignature, addColumns, appendEvents, sha256Hex, cleanMark, CONSENT_TEXT, PROCESS_V, declinedOf, dueOn, dueWords, slugsOf } from './_board-sign.js';
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
    by_slug TEXT, by_name TEXT, by_email TEXT, at TEXT, state TEXT NOT NULL, decided_by TEXT, decided_at TEXT, reason TEXT, told_at TEXT)`,
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
/**
 * Said when Board's own tables couldn't be set up (a fresh server's first request, the database not answering): a 503 in
 * words for every route that answers with Board's errors, never the platform's error page (Board QA round 12)
 */
export const SETUP_DOWN = 'The site couldn’t open the board’s records just now. Please try again in a moment.';
/** Round 12's words for a press that didn't land: nothing of it was done */
export const NOTHING_SAVED = 'We couldn’t save that just now, so nothing was changed. Please try again in a moment.';
/** A signature (a paper's, the minutes') that didn't land */
export const NOTHING_SIGNED = 'We couldn’t save your signature just now, so nothing was signed. Please try again in a moment.';
/** A press whose work is an email (Send to SOARD, a question to a presenter) that didn't land or go */
export const NOTHING_SENT = 'We couldn’t send that just now, so nothing was sent. Please try again in a moment.';
/**
 * A write the database may have taken whose answer didn't come, and the look to see failing too: it can't be told yet,
 * so neither "saved" nor "nothing was changed" (a 503 in words, `unsure`). Board QA round 13
 */
export const UNSURE_SAVED = 'The site didn’t answer, so we can’t tell yet whether that was saved. Reload the page in a moment to see.';
/** The database's own failure (D1 not answering, SQLite refusing a statement), never a program's error */
export const dbFailed = (e) => !(e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError)
  && /\bD1_|SQLITE|constraint failed|Network connection lost|database is locked/i.test(String(e?.message || e));
/**
 * For a press made whole in one write with every read before it (or a send it can tell went): the database failing in
 * it is said in the press's own words (readDown: a 503, `unread`). What it says on purpose, Board's tables not set up
 * (SETUP_DOWN) and a program's own error pass as they are (thrown again). `.catch(nothingDone(words))`
 */
export const nothingDone = (words = NOTHING_SAVED) => (e) => { throw (e?.status || e?.setup || !dbFailed(e) ? e : readDown(words, e)); };
/**
 * A press's one write (`write()`), with its answer lost looked at (`look()` → whether the write is there): the database
 * took it and the connection dropped before it said so is answered as written (→ { lost: true }), never "nothing was
 * changed" over a change the site has; not there, the database's own error as it was (nothingDone says it); the look
 * failing too, UNSURE_SAVED. Board QA round 13
 */
export async function landedOr(write, look) {
  try { return await write(); } catch (err) {
    if (!dbFailed(err)) throw err;
    let there;
    try { there = await look(); } catch { throw Object.assign(new Error(UNSURE_SAVED), { status: 503, unread: true, extra: { unsure: true }, cause: err }); }
    if (there) { tookIt(err); return { lost: true }; }
    throw notThere(err);
  }
}

/**
 * A press's own claim or marker (one send at a time, a correction being made, the notes being sent), written carrying a
 * token the press made (claimToken) so the press can tell its own: `write()` the claim, `mine()` → whether the claim
 * there now is this press's token. Its answer lost, the press looks and, finding its own token, carries on as if the
 * write answered, never "being made right now" to the press that made it (Board QA round 14, Nov 24 2026: the
 * secretary's decision, her notes' send and Email all each said nothing happened, then refused the retry they asked for
 * for two minutes); not there, the database's error as it was; the look failing too, UNSURE_SAVED. → whether it's theirs
 */
export async function claimOwn(write, mine) {
  // (a claim is no one's work: what of the press landed is what it claimed it for)
  const r = await notWork(() => landedOr(write, mine));
  return !!r?.lost || (r?.meta?.changes ?? r?.changes ?? 0) > 0;
}
/** A token for a press's own claim: its own, whatever else claims the same thing at the same moment */
export const claimToken = () => `${uid('k_')}${Math.random().toString(36).slice(2, 8)}`;

// ─── What of a press landed ─────────────────────────────────────────
// Board QA round 14 (Nov 24 2026): the routes say a database failure in a press in words by default (errorAnswer), so
// none is left out. A default can only say "nothing was changed" when nothing was, so the press's database is watched
// while it runs (watchPress): each write that landed (a person's work, never a visit, a rate limit, the audit log or a
// save's history), and each write whose answer didn't come and nobody looked at (it may have landed). A press that read
// first, wrote once and looked at a lost answer (landedOr) has the default say exactly what happened; one that didn't
// is never told "nothing was changed" over a change, only that the site can't tell yet (UNSURE_SAVED)

import { AsyncLocalStorage } from 'node:async_hooks';
const PRESS = new AsyncLocalStorage();
const WATCHED = new WeakMap();
const UNWATCHED = Symbol('the database itself');
// Tables a press writes without changing anything a person did: its rate limit, a visit, a sign-in, what they looked
// at, the audit log, a meeting's save history
const NOT_WORK = /^(rate_limits|board_seen|board_signins|board_activity|board_activity_reports|audit_log|board_saves)$/i;
const tableOf = (sql) => String(sql || '').match(/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?([a-z_0-9]+)/i)?.[1] || '';
const isWork = (sql) => { const t = tableOf(sql); return !!t && !NOT_WORK.test(t); };
/** A write whose answer was lost, looked at and there: it landed */
function tookIt(err) { const s = PRESS.getStore(); if (s) { s.unsure.delete(err); s.wrote = true; } }
/**
 * A write whose answer was lost, looked at and not there: it didn't land (the error as it was, marked so). Every look
 * that finds a write's work missing says so with this, so the default answer can say nothing was changed
 */
export function notThere(err) {
  const s = PRESS.getStore();
  if (s && err && typeof err === 'object') s.unsure.delete(err);
  return err;
}
/** The database as a press sees it, each statement's outcome noted for the press running it (PRESS) */
export function watchedDB(DB) {
  if (!DB || typeof DB.prepare !== 'function' || DB[UNWATCHED]) return DB;
  let w = WATCHED.get(DB);
  if (w) return w;
  const real = new WeakMap(); // a statement handed out here → { stmt: the database's own, sql }
  const note = (sql, err = null) => {
    const s = PRESS.getStore();
    if (!s || !isWork(sql)) return;
    if (!err) s.wrote = true;
    else if (dbFailed(err) && typeof err === 'object') s.unsure.add(err);
  };
  const stmtOf = (stmt, sql) => {
    const p = new Proxy(stmt, {
      get(o, k) {
        if (k === 'bind') return (...a) => stmtOf(o.bind(...a), sql);
        if (k === 'run' || k === 'first' || k === 'all' || k === 'raw') {
          return async (...a) => { try { const r = await o[k](...a); note(sql); return r; } catch (e) { note(sql, e); throw e; } };
        }
        const v = o[k];
        return typeof v === 'function' ? v.bind(o) : v;
      },
    });
    real.set(p, { stmt, sql });
    return p;
  };
  w = new Proxy(DB, {
    get(o, k) {
      if (k === UNWATCHED) return o;
      if (k === 'prepare') return (sql) => stmtOf(o.prepare(sql), sql);
      if (k === 'batch') {
        return async (stmts) => {
          const list = (stmts || []).map((x) => real.get(x) || { stmt: x, sql: x?._sql ?? x?.statement ?? '' });
          const work = list.find((x) => isWork(x.sql));
          try {
            const r = await o.batch(list.map((x) => x.stmt));
            if (work) note(work.sql);
            return r;
          } catch (e) { if (work) note(work.sql, e); throw e; }
        };
      }
      const v = o[k];
      return typeof v === 'function' ? v.bind(o) : v;
    },
  });
  WATCHED.set(DB, w);
  return w;
}
/** The database a watched one stands for (the same one when it isn't watched) */
export const baseDB = (DB) => DB?.[UNWATCHED] || DB;
/**
 * A press run with its database watched (watchedDB): `fn(env)` with env's DB watched, inside the press's own record of
 * what landed, which errorAnswer reads for its default. → fn's answer
 */
export function watchPress(env, fn) {
  return PRESS.run({ wrote: false, unsure: new Set() }, () => fn({ ...env, DB: watchedDB(env?.DB) }));
}
/**
 * `fn()` run as no part of the press's work: a claim and its letting go, a copy the site keeps of what it read elsewhere
 * (the bank's numbers, the projects): what it writes is never "what landed" for the press's answer
 */
export function notWork(fn) {
  return PRESS.getStore() ? PRESS.run({ wrote: false, unsure: new Set() }, fn) : fn();
}
/** What of the press running now landed: 'none', 'some' (a write landed), 'unsure' (one may have), or '' (not watched) */
export function pressLanded(err = null) {
  const s = PRESS.getStore();
  if (!s) return '';
  if (s.done) return 'done';
  if (s.wrote) return 'some';
  return s.unsure.size ? 'unsure' : 'none';
}
/**
 * The press running now has landed whole: its one write is in (or its answer was lost and the look found it). Whatever
 * stops it after this (a read for its answer) is said by errorAnswer as done, 200 with the page told to look again,
 * never "we can't tell yet" over a press the site knows landed. Called by the one write of a press that reads first and
 * lands in one step (saveDoc, deleteDoc, deleteMeeting). Board QA round 15, Nov 26 2026
 */
export function pressDone() {
  const s = PRESS.getStore();
  if (s) { s.done = true; s.wrote = true; }
}
/** What a press that landed says when what it reads for its answer didn't come: the page looks again by itself */
export const LOOK_AGAIN = 'This page shows it in a moment.';

export async function ensureSchema(DB) {
  // (the database itself, watched or not: its tables are made once, and their setup is no press's work)
  const base = baseDB(DB);
  if (_ready.has(base)) return;
  try {
    await makeSchema(base);
  } catch (err) {
    console.error('[board] setting up its tables', err?.message || err);
    // (`setup`: each route says it as a 503 in its own words, ./board-admin.js fromError; a caller with words of its own
    // for "nothing was saved" keeps them)
    throw Object.assign(new Error(SETUP_DOWN), { setup: true, cause: err });
  }
}
async function makeSchema(DB) {
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
  // When a correction's email to the secretary and the founders was written down as owed, in the correction's own write
  // (./_board-corrections.js suggestCorrection). One from before this column: its first press owed it (as a step after
  // it, which only a failing write ever lost), so it's taken as owed, never a second email on a rewording. Board QA round 13
  const corr = new Set((((await DB.prepare('PRAGMA table_info(board_minutes_corrections)').all()).results) || []).map((c) => c.name));
  if (!corr.has('told_at')) {
    await addColumns(DB, 'board_minutes_corrections', { told_at: 'TEXT' });
    await DB.prepare('UPDATE board_minutes_corrections SET told_at = at WHERE told_at IS NULL').run();
  }
  // The token of the press deciding one while it's being made (./_board-corrections.js decideCorrection): its claim
  // written with its answer lost is known as its own. Board QA round 14
  await addColumns(DB, 'board_minutes_corrections', { claim: 'TEXT' });
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
  return settingsFrom(s, await settingsPeople(DB, s));
}
/**
 * People as the settings' answer needs them (who runs Board while Settings has none saved, who sends the invites while
 * Settings names none of them), read for certain ([] when neither needs it). A save reads this before its write
 */
const settingsPeople = async (DB, s) => (adminsSaved(s) && s.invitesFrom && adminsOf(s, []).includes(normEmail(s.invitesFrom)) ? [] : peopleRows(DB));
/**
 * The settings as getSettings answers them, from the row and People as already read: a save's answer is made from what
 * it wrote and what it read before writing, never a read after it (Board QA round 14, Nov 24 2026: the quorum, the
 * agenda template and the operating balance were saved, then a read of People failed, and the founder was told
 * "nothing was changed")
 */
function settingsFrom(s, people) {
  const admins = adminsOf(s, people);
  return {
    quorum: Number(s.quorum) > 0 ? Math.round(s.quorum) : 0,
    defaults: { ...DEFAULT_SETTINGS.defaults, ...(s.defaults || {}) },
    template: templateOf(s),
    // When the template was last saved, and by whom: an editor's save of it goes over only the one it opened (saveSettings)
    templateAt: String(s.templateAt || ''),
    templateBy: String(s.templateBy || ''),
    admins,
    adminsSaved: Array.isArray(s.admins) && s.admins.length > 0,
    invitesFrom: organizerOf(s, admins, people),
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
  // (one write, every read before it: the database failing anywhere changed nothing, said so; a write whose answer was
  // lost is looked at, writeSettings. Board QA round 14)
  return savingSettings(DB, patch, by, { base }).catch(nothingDone());
}
async function savingSettings(DB, patch, by, { base = null } = {}) {
  // (who presents, at the address their person has now: addressesNow, renames since the template the page opened too)
  const template = Array.isArray(patch.template);
  const stored = template && base ? { sections: templateOf(await readSettings(DB)) } : null;
  const moved = template ? await addressesNow(DB, addressesIn({ sections: patch.template }), { since: base || '', moved: (slug) => !!stored && namesIn(stored, slug) }) : {};
  const mine = Object.keys(moved).length ? { ...patch, template: followAddresses({ sections: patch.template }, moved, { people: await namesNow(DB) }).sections } : patch;
  // Everything the answer needs from People (who runs Board, who sends the invites), read before the write: a read that
  // fails changed nothing, and once it's written nothing is read again (Board QA round 14)
  const people = await peopleRows(DB);
  // (saved meanwhile: the page merges with theirs, and follows the same renames in what it has first; the template's
  // save kept once it's written, keptTemplate)
  const keep = {};
  const done = await withMoves(templateClash(DB, writeSettings(DB, (s) => { keep.save = null; return settingsAfter(s, mine, by, base, keep); }), base || ''), moved, DB, base || '', (cur) => ({ sections: cur.template }));
  await keptTemplate(DB, keep);
  // (the answer is the settings as written, with who runs Board as read before)
  const out = settingsFrom(done.settings, people);
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
    const was = parse(row?.data, {});
    const next = make(was);
    if (next === null) return { wrote: false, settings: was };
    const json = JSON.stringify(next);
    // (its answer lost: written if the row is exactly this write's. Board QA round 14)
    const r = await landedOr(() => (row
      ? DB.prepare("UPDATE board_state SET data = ?, updated_at = ? WHERE key = 'settings' AND data = ?").bind(json, nowIso(), row.data).run()
      : DB.prepare("INSERT OR IGNORE INTO board_state (key, data, updated_at) VALUES ('settings', ?, ?)").bind(json, nowIso()).run()),
    async () => (await DB.prepare("SELECT data FROM board_state WHERE key = 'settings'").first())?.data === json);
    if (r?.lost || (r?.meta?.changes ?? r?.changes ?? 0) > 0) return { wrote: true, settings: next };
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
  const keep = {};
  const { wrote } = await writeSettings(DB, (s) => {
    keep.save = null;
    if (!Array.isArray(s.template)) return null;
    const template = change(s.template);
    if (!template || JSON.stringify(template) === JSON.stringify(s.template)) return null;
    return templateSaved({ ...s, template }, s, by, keep);
  });
  if (wrote) await keptTemplate(DB, keep);
  return wrote;
}
/**
 * The template's save: when and by whom (templateAt, templateBy), and the save itself (`keep`, for keptTemplate to keep
 * once it's written: each as it was left, by whom, over which), for a 409's question to name everyone whose save changed
 * what clashes, never only the last to save (keepSave says why). Kept as a meeting's saves are, by turns, not in the
 * settings (round 10 kept the last 30 there, templateSaves: moved over as the next save is kept). Board QA rounds 10, 11
 */
function templateSaved(next, s, by, keep) {
  const at = stampAfter(s.templateAt);
  keep.save = { at, was: String(s.templateAt || ''), by: by || '', data: JSON.stringify(templateIds(next.template)), earlier: Array.isArray(s.templateSaves) ? s.templateSaves : [] };
  // (`templateWas`: the save this one went over, so the same save sent again from the same page is known as this one)
  return { ...next, templateAt: at, templateBy: by || '', templateWas: String(s.templateAt || ''), templateSaves: undefined };
}
/** The template's save, written: kept (keepSave), with the saves round 10 kept in the settings before it, once */
async function keptTemplate(DB, keep) {
  const x = keep.save;
  if (!x) return;
  for (const e of x.earlier) {
    await DB.prepare('INSERT OR IGNORE INTO board_saves (record, at, was, by, data) VALUES (?, ?, ?, ?, ?)')
      .bind(TEMPLATE_SAVES, String(e?.at || ''), String(e?.was || ''), String(e?.by || ''), e?.data == null ? null : JSON.stringify(e.data)).run().catch(() => {});
  }
  await keepSave(DB, TEMPLATE_SAVES, { at: x.at, was: x.was, by: x.by, data: x.data });
}
/** A template save's 409, with every save since the copy the page opened (savesSince), as a meeting's has */
const templateClash = (DB, going, base) => going.catch(async (e) => {
  if (e?.status === 409 && e.current && e.templateSaves !== undefined) e.extra = { ...(e.extra || {}), ...(await savesSince(DB, TEMPLATE_SAVES, base, e.current.at, { more: e.templateSaves })) };
  throw e;
});
/** The settings `s` with a save's changes on them (saveSettings) */
function settingsAfter(s, patch, by, base, keep = {}) {
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
    // Their own save of these very words, written over this same base, its answer lost and pressed again (the page's
    // retry): that save, with nothing more to write, never "saved the agenda template since you opened it" under their own
    // name (Board QA round 14, Nov 24 2026). Anyone else's save since, or theirs with other words, is the 409 below
    if (base !== null && String(s.templateAt || '') !== base && String(s.templateWas ?? '') === base && sameSaver(s.templateBy, by)
      && JSON.stringify(templateIds(cleanTemplate(patch.template))) === JSON.stringify(templateOf(s))) return next;
    if (base !== null && String(s.templateAt || '') !== base) {
      // (with every save since, for the question to name whoever changed what clashes: templateClash, savesChain)
      throw Object.assign(new Error(`${s.templateBy || 'Someone'} saved the agenda template since you opened it`), { status: 409, current: { template: templateOf(s), at: String(s.templateAt || ''), by: String(s.templateBy || '') }, templateSaves: Array.isArray(s.templateSaves) ? s.templateSaves : [] });
    }
    // Everything its editor sets, as typed, a part or item not named yet too (work in progress: a meeting made from it
    // leaves those out, board-shared.js namedTemplate). Each part and item keeps its id, so the next tab's change to it
    // is known as a change to it
    return templateSaved({ ...next, template: cleanTemplate(patch.template) }, s, by, keep);
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
 * Board meetings (withState's) with approved minutes whose approval kept no file (approved before approvedFile was kept,
 * or with none of theirs in Board yet): the file the meeting has for them (board-shared.js approvedFileOf), fixed as
 * theirs the first time it's found, so nothing done to the files after (filed under Other, put on an item, renamed)
 * makes another one theirs. Never a change anyone made: the meeting's time stays as it was. Board QA round 11, Nov 23 2026
 */
async function approvedFixed(DB, meetings) {
  const out = [];
  for (const m of meetings) {
    const found = !m.practice && m.minutes === 'approved' && !m.approvedFile ? approvedFileOf(m) : '';
    if (found) {
      await DB.prepare("UPDATE board_meetings SET data = json_set(data, '$.approvedFile', ?) WHERE id = ? AND json_extract(data, '$.minutes') = 'approved' AND COALESCE(json_extract(data, '$.approvedFile'), '') = ''")
        .bind(found, m.id).run().catch((e) => console.error('[board] approved file', e?.message || e));
    }
    out.push(found ? { ...m, approvedFile: found } : m);
  }
  return out;
}

/**
 * Who each meeting's reminder to answer the invite went to, and when (Who's coming → Ask the ones who haven't answered),
 * as the send itself keeps it (sendOnce's record, board-send:remind:<id>). That record is the one record of it, read by
 * every tab at the press and after a reload, as Email the board's and the minutes email's are; never kept on the meeting
 * (stored leaves it off) nor shown on the board page (forBoard). Board QA round 8, Nov 21 2026: "Asked … just now" lived
 * only in the tab that sent it, so a second tab asked the first-time question 11 minutes on and the whole board was
 * asked twice.
 * By email, as it went: { meetingId: { email: when } }. Board's page matches each to the board member at that address
 * now, from its own list of the board, read for certain (public/admin/board-meeting.js askedOf). It's a label on the
 * admin's card, and every meeting read comes through here, so People is never read for it (Board QA round 11, Nov 23
 * 2026: one failed read of People failed every meeting read, the re-reads after a send's write too, and a reminder that
 * had gone to the board was answered "nothing was sent"). Sending it again is guarded by the send's own record (sendOnce)
 */
async function remindedOf(DB, ids) {
  const want = new Set(ids);
  const prefix = 'board-send:remind:';
  const rows = ((await DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'board-send:remind:%'").all().catch(() => null))?.results || [])
    .map((r) => [r.key.slice(prefix.length), parse(r.data)]).filter(([id, d]) => want.has(id) && d?.had && Object.keys(d.had).length);
  const out = {};
  for (const [id, d] of rows) {
    const had = Object.fromEntries(Object.entries(d.had).map(([e, at]) => [normEmail(e), String(at || '')]).filter(([e, at]) => isEmail(e) && Number.isFinite(Date.parse(at))));
    if (Object.keys(had).length) out[id] = had;
  }
  return out;
}

/** Every meeting, newest first, with its files, done states and answers. Practice meetings only when asked ({ practice: true }) */
export async function listMeetings(DB, { practice = false } = {}) {
  await ensureSchema(DB);
  const rows = (await DB.prepare('SELECT data FROM board_meetings ORDER BY date DESC').all()).results || [];
  const more = practice ? (await DB.prepare('SELECT data FROM board_practice ORDER BY date DESC').all()).results || [] : [];
  return approvedFixed(DB, await withState(DB, [...rows, ...more].map((r) => cleanMeeting(parse(r.data)))));
}

export async function getMeeting(DB, id) {
  await ensureSchema(DB);
  const row = await DB.prepare('SELECT data FROM board_meetings WHERE id = ?').bind(id).first();
  return row ? (await approvedFixed(DB, await withState(DB, [cleanMeeting(parse(row.data))])))[0] : null;
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
 * A meeting as a read just after its write would find it (getMeeting), from what was written (`next`) and what lives
 * beside it as it was read just before (`cur`: its files, done states, who was reminded). The answer of a write whose
 * read back didn't answer: the write stands, so its answer is the meeting it wrote, never an error that reads as nothing
 * done (Board QA round 11, Nov 23 2026: the reminder went and the invite went out, and the founder was told nothing was
 * sent, because the read after the write failed).
 * Only for a write guarded on exactly the copy `next` was made from (patchMeeting, saveMeeting, patchTogether: written
 * only while the row's updatedAt is still `cur`'s), so `next` is the row as written. A write that isn't (setOnMeeting's
 * json_set lands on whatever the row has by then) answers from the write itself (fromRow), never from here: Board QA
 * round 12, Nov 23 2026, the invite's answer was the meeting as read before Google, under the site's real updatedAt, and
 * a change saved meanwhile in another tab was lost on that tab's next save
 */
const asWritten = (cur, next) => {
  const c = cleanMeeting({ ...next, files: cur?.files || next.files || [], attendance: (next.attendance || []).map((p) => ({ ...p, rsvp: '' })) });
  return cur?.reminded ? { ...c, reminded: cur.reminded } : c;
};
/**
 * A meeting as an unguarded write left it (`row`: its data and updated_at, from the write's own RETURNING), with what
 * lives beside it as it was read before (`beside`: its files, done states, who was reminded). Whatever was saved
 * meanwhile is in it, under the time it has now
 */
const fromRow = (row, beside) => asWritten(beside, { ...parse(row.data), updatedAt: row.updated_at || parse(row.data).updatedAt || '' });
/** The meeting read back after its guarded write, or (that read failing) as it was written: asWritten */
const readBack = (DB, id, cur, next) => getMeeting(DB, id).catch((err) => {
  console.error('[board] reading a meeting back after its write', id, err?.message || err);
  return asWritten(cur, next);
});
/**
 * A meeting written only over the copy it was made from: `was` is the updatedAt read (null: a new meeting, written only
 * if there's none with its id). Anything written in between (an editor's save, a send's record, the calendar's answers)
 * is never written over: nothing is written, and it says so. Each write is kept in the meeting's save history (keepSave:
 * `prev`, the meeting it went over, so a write that changed nothing a person edits keeps nothing to compare; named as
 * the meeting names who saved it last). → whether it was written
 */
async function writeOver(DB, m, was, { prev = null, also = [], takesBack = false, follows = null } = {}) {
  // Practice meetings live in their own table (see SCHEMA): getMeeting, and every action built on it, never finds one
  const table = m.practice ? 'board_practice' : 'board_meetings';
  // (approved minutes state what they stated: refused before anything is written. keepStated)
  keepStated(prev, m, { takesBack, follows });
  const data = stored(m);
  const write = was === null
    ? DB.prepare(`INSERT OR IGNORE INTO ${table} (id, date, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`).bind(m.id, m.date || '', data, m.updatedAt, m.updatedBy || '')
    : DB.prepare(`UPDATE ${table} SET date = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND COALESCE(updated_at, '') = ?`).bind(m.date || '', data, m.updatedAt, m.updatedBy || '', m.id, was || '');
  // `also`: what goes with the write in the same step (the minutes' Word file, saveMeetingAs), each statement only once
  // the meeting is as this write leaves it: all of it lands, or none of it
  // (its answer lost: the row looked at, written if it's exactly this write, its time and its words; with `also` it was
  // one step, so the meeting there as written means all of it landed. Board QA round 13)
  const r = await landedOr(
    async () => (also.length
      ? (await DB.batch([write, ...also.map((s) => DB.prepare(`${s.sql} AND (SELECT COUNT(*) FROM ${table} WHERE id = ? AND COALESCE(updated_at, '') = ?) = 1`).bind(...s.bind, m.id, m.updatedAt))]))[0]
      : await write.run()),
    async () => { const row = await DB.prepare(`SELECT updated_at, data FROM ${table} WHERE id = ?`).bind(m.id).first(); return !!row && row.updated_at === m.updatedAt && row.data === data; });
  const wrote = !!r?.lost || (r?.meta?.changes ?? r?.changes ?? 0) > 0;
  if (wrote) await keepSave(DB, `${table}:${m.id}`, { at: m.updatedAt, was: was || '', by: m.updatedBy, data: editedOf(m), prev: prev && editedOf(prev) });
  return wrote;
}
/**
 * Approved minutes are the record (rounds 8, 11 and 14): what they state (../../public/admin/board-minutes-template.js
 * minutesStated: everything their Word file prints from the meeting but its to-dos, its words, decisions, roll, its
 * name, day, time and place, and each part and item printed, in order, with its name, time and who presents it) never
 * changes while they're approved, by any route. The one guard every write of a whole meeting goes through (writeOver: a person's
 * save and patchMeeting, so every step of the server's; patchTogether), on the meeting as the write found it (`cur`) and
 * as it leaves it (`next`), before anything is written: refused (409) in MINUTES_STAY's words with nothing changed, the
 * whole write (a to-do, a report, a document, the board page with it, never half of it). `refused: ['stated']` names it, so Board's editor puts back only that, as the site has it, and
 * saves the rest. Taking the approval back (Mark as draft) is how they change. Board QA round 15, Nov 26 2026: a plain
 * save of Board's agenda editor changed approved minutes' words, a decision and the roll, and their approved Word file
 * didn't say any of it
 */
function keepStated(cur, next, { takesBack = false, follows = null } = {}) {
  if (!cur || next?.practice) return;
  // (a rename on People moving addresses, { old: new }: ./_board-rename.js moveBoardSlug. Judged with them followed first,
  // so a person at a new address is the same person, and nothing else the step changes goes by)
  if (follows && Object.keys(follows).length) cur = followAddresses(cur, follows);
  // The one opt-out: Undo of the read that put minutes approved with none in Board into it (./_board-minutes.js
  // undoMinutes, only when they were approved before that read: undoRefused). It takes them out of Board as they came,
  // with none read in left (`minutesFrom` gone), never other words in their place: "minutes approved with none in Board
  // take the first that comes, and Undo of its read leaves them with none again, truthfully" (Board QA round 11)
  if (takesBack && !next?.minutesFrom) return;
  const no = minutesStay(cur, next);
  if (no) throw Object.assign(new Error(no), { status: 409, extra: { refused: ['stated'] } });
}
/**
 * Whether a write whose answer didn't come back landed all the same: each meeting it wrote has the time it wrote (every
 * write's time is its own: stampAfter), read once. A read that fails says no: the caller's error stands, and what it
 * takes back never goes over anything a row names (dropStaged). Board QA round 13, Nov 24 2026: the rule that a press
 * whose work landed answers with what it did, for a step whose database answer was lost
 */
async function landedAs(DB, table, written) {
  if (!written.length) return false;
  try {
    const rows = (await DB.prepare(`SELECT id, updated_at FROM ${table} WHERE id IN (${written.map(() => '?').join(', ')})`).bind(...written.map((m) => m.id)).all()).results || [];
    return written.every((m) => rows.some((x) => x.id === m.id && String(x.updated_at || '') === String(m.updatedAt || '')));
  } catch (err) {
    console.error('[board] looking whether a write landed', err?.message || err);
    // (couldn't look: neither yes nor no, so the caller's error stands as one that can't be told)
    return null;
  }
}

/**
 * Each write of a meeting, a practice meeting and the agenda template, kept (a month at most): what a person edits as it
 * was left (`data`, none when the write didn't change it), who made it and over which write (`was`). So a page whose save
 * meets one made meanwhile is told everyone whose save changed what clashes, save by save (public/admin/board-meeting.js
 * clashWho), never only whoever saved last. Board QA round 10, Nov 22 2026: the agenda template's question named a
 * rename on People that had only moved an address, for a change the founder made in another tab, and Keep mine dropped
 * it. One person's saves one after another (a tab saving by itself as they type) are kept as one, the last of them over
 * the write before the first (`was`): who changed each thing is the same, and how many saves they made never pushes an
 * earlier person's out (SAVES_KEPT is turns, one person's run each). Board QA round 11, Nov 23 2026: 31 saves in another
 * tab pushed out Pat's, and the question named only the other tab. Never in the way of the write itself: one that can't
 * be kept leaves the page told Board can't say who saved since (savesChain)
 */
const SAVES_KEPT = 100;
const EDITED = ['date', 'start', 'end', 'title', 'location', 'address', 'inviteNote', 'video', 'shared', 'noSince', 'minutes', 'approvedOn', 'attendance', 'sections', 'motions', 'actions'];
/** What a person edits on a meeting, as one string to keep and compare (as mergeMeeting goes by: never an answer or a tick) */
const editedOf = (m) => {
  const c = cleanMeeting(m);
  return JSON.stringify(Object.fromEntries(EDITED.map((k) => [k, k === 'attendance' ? c.attendance.map(({ rsvp, ...p }) => p) : k === 'actions' ? c.actions.map(({ done, doneOn, ...a }) => a) : c[k]])));
};
async function keepSave(DB, record, { at, was, by, data, prev }) {
  try {
    const kept = prev === data ? null : data;
    // (the same person's save right after their last one, nothing kept between: one run, kept as one)
    const last = was ? await DB.prepare('SELECT at, was, by, data FROM board_saves WHERE record = ? ORDER BY at DESC LIMIT 1').bind(record).first() : null;
    const run = !!last && String(last.at) === String(was) && sameSaver(last.by, by);
    await DB.batch([
      ...(run ? [DB.prepare('DELETE FROM board_saves WHERE record = ? AND at = ?').bind(record, last.at)] : []),
      DB.prepare('INSERT OR REPLACE INTO board_saves (record, at, was, by, data) VALUES (?, ?, ?, ?, ?)').bind(record, at, run ? last.was || '' : was || '', by || '', run && kept == null ? last.data : kept),
      DB.prepare('DELETE FROM board_saves WHERE record = ? AND at < (SELECT at FROM board_saves WHERE record = ? ORDER BY at DESC LIMIT 1 OFFSET ?)').bind(record, record, SAVES_KEPT - 1),
      DB.prepare('DELETE FROM board_saves WHERE at < ?').bind(new Date(Date.now() - 31 * 86400000).toISOString()),
    ]);
  } catch (err) { console.error('[board] save history', err?.message || err); }
}
const sameSaver = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
/** The most a 409 sends of the saves' words: more, and it names everyone who saved since instead (savesChain) */
const SAVES_SENT = 2_000_000;
/**
 * The saves since a page's copy (`base`) up to the one it meets (`at`), as a 409 tells the page: `saves`, each in turn
 * ({ at, by, data: what it left, null when unchanged }), when every one is known, and `savers`, everyone who saved since.
 * The first may be one person's run that the page's copy is part of (a save of theirs kept as one with the ones after
 * it, keepSave): it went over a write before `base`, and what changed between the page's copy and it is theirs. Every
 * one known, but more words than a page should be sent: `saves` null, and `savers` names them all. One not known (the
 * page's copy older than the history kept, or the history not kept): both null, for the page to say Board can't tell
 * who saved since, never a guess from the saves it has. Board QA round 11, Nov 23 2026
 */
export function savesChain(rows, base, at) {
  const seen = new Set();
  const list = (rows || []).filter((r) => String(r.at || '') > String(base || '') && String(r.at || '') <= String(at || '') && !seen.has(String(r.at)) && seen.add(String(r.at)))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let link = String(base || '');
  for (const [i, r] of list.entries()) {
    const was = String(r.was || '');
    if (was !== link && !(i === 0 && was < link)) return { saves: null, savers: null };
    link = String(r.at);
  }
  if (!list.length || link !== String(at || '')) return { saves: null, savers: null };
  const savers = [...new Set(list.map((r) => String(r.by || '')))];
  if (list.reduce((n, r) => n + (r.data == null ? 0 : typeof r.data === 'string' ? r.data.length : JSON.stringify(r.data).length), 0) > SAVES_SENT) return { saves: null, savers };
  return { saves: list.map((r) => ({ at: String(r.at), by: String(r.by || ''), data: r.data == null ? null : typeof r.data === 'string' ? parse(r.data, null) : r.data })), savers };
}
/**
 * A record's saves since `base` (savesChain), for its 409: a meeting's, a practice meeting's, the agenda template's
 * (`more`: the template's saves as kept before they were kept here, round 10)
 */
async function savesSince(DB, record, base, at, { more = [] } = {}) {
  const rows = (await DB.prepare('SELECT at, was, by, data FROM board_saves WHERE record = ? AND at > ?').bind(record, String(base || '')).all().catch(() => null))?.results || null;
  if (!rows) return { saves: null, savers: null };
  return savesChain([...rows, ...(Array.isArray(more) ? more : [])], base, at);
}
/** Where the agenda template's saves are kept, as a meeting's are (keepSave) */
const TEMPLATE_SAVES = 'board_settings:template';
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
export async function patchMeeting(DB, id, fn, { by = '', also = [], takesBack = false, follows = null } = {}) {
  for (let i = 0; i < 5; i++) {
    const cur = await getMeeting(DB, id);
    if (!cur) return null;
    const out = fn(cur);
    // (which file approved minutes are: the server's, never the function's copy. Board QA round 10)
    const next = { ...out, id, practice: false, approvedFile: approvedFileAfter(cur, out), updatedAt: stampAfter(cur.updatedAt), updatedBy: by || cur.updatedBy || '' };
    // (written: its answer is the meeting it wrote, even when the read back fails. Board QA round 11. Written only over
    // exactly `cur`, so `next` is the row as written: asWritten may stand in for the read back. Round 12. `also`: what
    // goes in the same write, a staged file's row (./_board-minutes.js secretarySends), each only with it. Round 14.
    // `takesBack`: keepStated's one opt-out, Undo of the read that put approved minutes into Board. `follows`: a rename's addresses)
    if (await writeOver(DB, next, cur.updatedAt || '', { prev: cur, also, takesBack, follows })) return readBack(DB, id, cur, next);
  }
  throw new Error(KEPT_CHANGING);
}

/**
 * Board meetings written in one step with what goes with them (a send's record, the file it made): all of it lands, or
 * none of it (Board QA round 11, Nov 23 2026: Send the minutes put the notes on the meeting, then a read failed, and the
 * last meeting's minutes stayed draft, the send's record wasn't kept and the Word file the meeting named was deleted).
 * `plan(curs)` is given each meeting of `ids` as it is now (getMeeting; null when gone), and everything it needs is read
 * before this, so nothing is read between the plan and the write. → { writes: [[cur, out]], also: [{ sql, bind }], ... }:
 * each `out` written only over the `cur` it was made from, as patchMeeting writes one, and each `also` statement (its
 * sql ending in a WHERE) only with them. Overtaken by a write in between (an editor's save): read and planned again,
 * five times at most. → the plan's own fields, and `meetings`: { id: the meeting as written (asWritten) }
 */
export async function patchTogether(DB, ids, plan, { by = '', landed = null } = {}) {
  const changed = (x) => (x?.meta?.changes ?? x?.changes ?? 0) > 0;
  for (let i = 0; i < 5; i++) {
    const curs = await Promise.all(ids.map((id) => (id ? getMeeting(DB, id) : null)));
    const { writes = [], also = [], ...rest } = plan(curs);
    const nexts = writes.map(([cur, out]) => ({ ...out, id: cur.id, practice: false, approvedFile: approvedFileAfter(cur, out), updatedAt: stampAfter(cur.updatedAt), updatedBy: by || cur.updatedBy || '' }));
    // (approved minutes state what they stated, each meeting of the step, before any of it is written: keepStated)
    for (const [k, m] of nexts.entries()) keepStated(writes[k][0], m);
    // Each statement goes only while every meeting is as this step has it by then: the ones before it written, the rest
    // as they were read. One meeting overtaken, and none of it goes (one batch, nothing in between)
    const as = (k) => writes.map(([cur], j) => [cur.id, j < k ? nexts[j].updatedAt : cur.updatedAt || '']).filter((_, j) => j !== k);
    const guard = (pairs) => (pairs.length ? ` AND (SELECT COUNT(*) FROM board_meetings WHERE ${pairs.map(() => "(id = ? AND COALESCE(updated_at, '') = ?)").join(' OR ')}) = ${pairs.length}` : '');
    const stmts = [
      ...nexts.map((m, k) => DB.prepare(`UPDATE board_meetings SET date = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND COALESCE(updated_at, '') = ?${guard(as(k))}`)
        .bind(m.date || '', stored(m), m.updatedAt, m.updatedBy || '', m.id, writes[k][0].updatedAt || '', ...as(k).flat())),
      ...also.map((s) => DB.prepare(`${s.sql}${guard(as(nexts.length))}`).bind(...s.bind, ...as(nexts.length).flat())),
    ];
    let r;
    try {
      r = stmts.length ? await DB.batch(stmts) : [];
    } catch (err) {
      // The step landed and its answer was lost on the way back: landed (every meeting it wrote has its time; a step that
      // writes none says by `landed`, its own look). Never taken back as not done: what it made, a row now names. Board
      // QA round 13, Nov 24 2026
      const yes = nexts.length ? await landedAs(DB, 'board_meetings', nexts) : landed ? await landed().catch(() => null) : null;
      if (!yes) throw yes === false ? notThere(err) : err;
      r = nexts.map(() => ({ meta: { changes: 1 } }));
    }
    if (!nexts.length || changed(r[0])) {
      for (const [k, m] of nexts.entries()) await keepSave(DB, `board_meetings:${m.id}`, { at: m.updatedAt, was: writes[k][0].updatedAt || '', by: m.updatedBy, data: editedOf(m), prev: editedOf(writes[k][0]) });
      // (each written only over the copy it was made from, so each is the row as written: asWritten)
      return { ...rest, meetings: Object.fromEntries(nexts.map((m, k) => [m.id, asWritten(writes[k][0], m)])) };
    }
  }
  throw new Error(KEPT_CHANGING);
}

/**
 * Fields only the server sets (a send's record, the invite, the approval's share), written onto the meeting as it is
 * now in one statement: nothing in between to be overtaken, so a record of something that went (the board's emails,
 * Google's invite) is never lost to edits saved meanwhile, however many come at once (patchMeeting reads, then writes,
 * and gives up after five tries of being overtaken). Its time after the last one (stampAfter, in SQL), so a copy open
 * in an editor merges. Only for fields whose value doesn't come from the meeting: anything worked out from it is
 * patchMeeting's. → the meeting, or null when it's gone (deleted meanwhile: nothing written).
 * `was`: the meeting as the caller read it before (what it sent, say): what lives beside it (its files, who was
 * reminded) when the read back fails. The answer is the meeting as this write left it, from the write itself (RETURNING
 * its data and time), never the copy read before: the write lands on whatever the row has by then, a change saved
 * meanwhile in another tab included, and an answer of the older copy under the row's real time would have that tab's
 * next save go over the change unasked (Board QA round 12, Nov 23 2026). Once written, a read back that fails answers
 * with that row, never an error: the write stands, and so does what it records (Board QA round 11)
 */
export async function setOnMeeting(DB, id, fields, { by = '', was = null } = {}) {
  await ensureSchema(DB);
  const keys = Object.keys(fields).filter((k) => /^[a-zA-Z]+$/.test(k));
  const record = `board_meetings:${id}`;
  // (the history's time and the write's from the same moment, so they match)
  const now = nowIso();
  await saveHistoryOf(DB, id, { by, now });
  // (its answer lost: written if the meeting has these fields as set, its row as it is now. Board QA round 14)
  let seen = null;
  const wrote = await landedOr(() => onMeetingStmt(DB, id, fields, { by, now, returning: true }).first(), async () => {
    seen = await DB.prepare('SELECT data, updated_at FROM board_meetings WHERE id = ?').bind(id).first();
    const d = seen ? parse(seen.data) : null;
    return !!d && keys.every((k) => JSON.stringify(d[k] ?? null) === JSON.stringify(fields[k] ?? null));
  });
  const row = wrote?.lost ? seen : wrote;
  if (!row) return null;
  // (the meeting as it is now, or as this write left it when that read fails: never the copy read before)
  const after = await getMeeting(DB, id).catch((err) => {
    if (!was) throw err;
    console.error('[board] reading a meeting back after its write', id, err?.message || err);
    return fromRow(row, was);
  });
  if (after && keys.some((k) => EDITED.includes(k))) await DB.prepare('UPDATE board_saves SET data = ? WHERE record = ? AND at = ?').bind(editedOf(fromRow(row, after)), record, row.updated_at).run().catch(() => {});
  return after;
}
/** What setOnMeeting may write: fields only the server sets, none of them what minutes state (an invite, a send's record, the share) */
const NOT_STATED = new Set(['snapshot', 'shared', 'notBoard', 'invite', 'inviteGone', 'video', 'packetSentAt', 'packetSentTo', 'minutesSentAt']);
/** setOnMeeting's time for a write: now, or a millisecond after the row's last one when that's now or later (stampAfter, in SQL) */
const STAMP = "COALESCE(CASE WHEN COALESCE(updated_at, '') < ? THEN ? ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') END, ?)";
/**
 * setOnMeeting's write, as one statement (a send's record and its time on the meeting go in one batch: sendOnce):
 * `fields` onto the meeting as it is now, under a time after its last. `returning`: the row as written
 */
function onMeetingStmt(DB, id, fields, { by = '', now = nowIso(), returning = false, also = null } = {}) {
  const keys = Object.keys(fields).filter((k) => /^[a-zA-Z]+$/.test(k));
  // Written unread onto the meeting as it is, so never a field minutes state (keepStated can't judge a write it doesn't
  // read): those are patchMeeting's, which reads the meeting and goes by the rule. Board QA round 15
  const stated = keys.filter((k) => !NOT_STATED.has(k));
  if (stated.length) throw new Error(`setOnMeeting writes only what minutes never state, not ${stated.join(', ')}: use patchMeeting`);
  const sets = [...keys.map((k) => [`$.${k}`, JSON.stringify(fields[k] ?? null)]), ...(by ? [['$.updatedBy', JSON.stringify(by)]] : [])];
  return DB.prepare(`UPDATE board_meetings SET data = json_set(data, ${sets.map(() => '?, json(?)').join(', ')}, '$.updatedAt', ${STAMP}),
    updated_at = ${STAMP}${by ? ', updated_by = ?' : ''} WHERE id = ?${also ? ` AND ${also.sql}` : ''}${returning ? ' RETURNING data, updated_at' : ''}`)
    .bind(...sets.flat(), now, now, now, now, now, now, ...(by ? [by] : []), id, ...(also ? also.bind : []));
}
/**
 * setOnMeeting's write as one statement, for a step that writes it with something else in one batch (the agenda's
 * approval making a meeting a board meeting: ./_board-asks.js chairApprove), its save history kept first. `also`: a
 * condition ({ sql, bind }) it's written under, besides its id
 */
export async function setOnMeetingStmt(DB, id, fields, { by = '', also = null } = {}) {
  await ensureSchema(DB);
  const now = nowIso();
  await saveHistoryOf(DB, id, { by, now });
  return onMeetingStmt(DB, id, fields, { by, now, also });
}
/**
 * The meeting's save history for a setOnMeeting write (keepSave): over which write, at the time the write gives it, by
 * whom; what a person edits, after it, when one of these is. Never in the way of the write (Board QA round 10)
 */
async function saveHistoryOf(DB, id, { by = '', now = nowIso() } = {}) {
  await DB.prepare(`INSERT OR REPLACE INTO board_saves (record, at, was, by, data) SELECT ?, ${STAMP}, COALESCE(updated_at, ''), COALESCE(NULLIF(?, ''), updated_by, ''), NULL FROM board_meetings WHERE id = ?`)
    .bind(`board_meetings:${id}`, now, now, now, by, id).run().catch((err) => console.error('[board] save history', err?.message || err));
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
  // A person's save marking the minutes approved (Mark them approved) that stopped before its one write landed: nothing
  // was changed, said in the approval's words, as Board's approve and the approving send say it (Board QA round 13).
  // `seen.approving`: whether it was approving them, once the meeting as the site has it is read
  const seen = { approving: (!!opts.edit || typeof opts.base === 'string') && cleanMeeting(raw).minutes === 'approved' };
  return savingMeeting(DB, raw, { ...opts, seen }).catch((err) => { throw seen.approving && !err?.status && !err?.setup ? readDown(MINUTES_NOT_APPROVED, err) : err; });
}
async function savingMeeting(DB, raw, opts) {
  // Its presenters, roll and to-dos at the addresses their people have now (addressesNow), and said (`addressesNow`) so
  // the page that sent it takes the same. With a base, a rename made since the copy the page opened is followed even
  // when someone new has the old address, where the rename moved this meeting (Board QA round 9: a practice meeting's
  // presenter became the newcomer)
  const base = typeof opts.base === 'string' ? opts.base : '';
  const id = cleanMeeting(raw).id;
  const stored = base && id ? (await getPractice(DB, id)) || (await getMeeting(DB, id)) : null;
  // (minutes approved already, as the site has them: a save that stops isn't an approval that didn't go)
  if (stored?.minutes === 'approved' && opts.seen) opts.seen.approving = false;
  const moved = await addressesNow(DB, addressesIn(raw), { since: base, moved: (slug) => !!stored && namesIn(stored, slug) });
  if (!Object.keys(moved).length) return withMoves(saveMeetingAs(DB, raw, opts), moved, DB, base);
  const out = await withMoves(saveMeetingAs(DB, followAddresses(raw, moved, { people: await namesNow(DB) }), opts), moved, DB, base);
  return out ? { ...out, addressesNow: moved } : out;
}
async function saveMeetingAs(DB, raw, { by, base = null, edit = false, env = null, seen = {} } = {}) {
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
    // (approving them, by the minutes the site has: anything that stops this save from here on is said in those words)
    const approving = !!current && person && m.minutes === 'approved' && current.minutes !== 'approved';
    seen.approving = approving;
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
    // Approved minutes' own file put on one of the agenda items by this save: refused by name (`refused: docs`, with the
    // file), with the meeting as it is now, so the editor takes only that back and the rest of the save goes. It stays
    // their minutes while they're approved (board-shared.js approvedFileOf, ./_board-minutes.js approvedFileNo). Board
    // QA round 11, Nov 23 2026: put on an item, it stopped being the minutes, and a new file went in as them
    if (current && person && current.minutes === 'approved' && m.minutes === 'approved') {
      const own = approvedFileOf(current);
      const onItems = (x) => new Set((x.sections || []).flatMap((sec) => sec.items.flatMap((it) => it.docs || [])));
      if (own && onItems(m).has(own) && !onItems(current).has(own)) throw Object.assign(new Error(FILE_STAYS), { status: 409, extra: { refused: ['docs'], fileId: own, meeting: current } });
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
    // An item names only files the meeting has: never one taken off since (a tab that still showed it on the item, a
    // send that replaced it). Nothing can name a file that's gone (Board QA round 13, Nov 24 2026: a later save kept a
    // deleted minutes file's id on its item, and the board page dropped it quietly)
    if (current) {
      const has = new Set((current.files || []).map((f) => f.id));
      next.sections = next.sections.map((s) => ({ ...s, items: s.items.map((it) => ((it.docs || []).every((d) => has.has(d)) ? it : { ...it, docs: it.docs.filter((d) => has.has(d)) })) }));
    }
    // The minutes' Word file says what this save leaves them saying: its new bytes put first, under a key of their own,
    // and the file's row moved onto them in the same one write as the meeting. Marked approved here (Mark them approved)
    // is the one way minutes are approved, as Board's approve and the secretary's approving send are: brought up in the
    // same step, or refused in words with nothing changed. Board QA round 13, Nov 24 2026: approved minutes said "fifty
    // thousand" while their Word file, put after the save and failing quietly, said "forty"
    // A new day, time or place (or name and notes) for an invite that's out is owed to it by this save's own write, read
    // first: the heartbeat takes it to Google once it has stood two minutes (./_board-invite.js inviteStep). Board QA
    // round 15, Nov 26 2026: noted by a step after the save that caught its own failure, a new place never reached the
    // invite and nobody heard
    const invite = current?.invite ? await (await import('./_board-invite.js')).inviteStep(DB, asWritten(current, next)) : null;
    const file = current && env ? await minutesFileWith(env, current, next, { approving }) : null;
    // (written: its answer is the meeting it wrote, even when the read back fails. Board QA round 11)
    // (written only over exactly `current`, or only as a new one: `next` is the row as written, so asWritten may stand in
    // for the read back. Board QA round 12)
    let wrote = false;
    try {
      wrote = await writeOver(DB, next, current ? current.updatedAt || '' : null, { prev: current, also: [...(file?.also || []), ...(invite?.also || [])] });
    } catch (err) {
      await file?.drop();
      throw file || approving ? notChanged(err, approving) : err;
    }
    if (wrote) {
      // (in: the file's old bytes go, now that nothing names them; one that doesn't is the heartbeat's)
      await file?.done();
      // (nothing left to go onto the invite: the staff told it couldn't go hear so)
      if (env && invite?.after) await invite.after(env);
      return readBack(DB, m.id, current, next);
    }
    await file?.drop();
    // Written meanwhile (or made, or deleted): read again. An editor's (a base) is told, with theirs to merge
  }
  throw Object.assign(new Error(KEPT_CHANGING), { status: 409 });
}
/** The minutes not approved, or a save not made: nothing was changed, in words (a 503 the page shows and tries again) */
export const MINUTES_NOT_APPROVED = 'We couldn’t approve the minutes just now, so nothing was changed. Please try again in a moment.';
const SAVE_NOT_MADE = 'We couldn’t save that just now, so nothing was changed. Please try again in a moment.';
const notChanged = (err, approving) => (err?.status ? err : readDown(approving ? MINUTES_NOT_APPROVED : SAVE_NOT_MADE, err));
/**
 * A save's minutes' Word file (typed minutes with the file a send kept: ./_board-notes.js minutesFileStep), made from
 * the meeting as the save leaves it, staged for the save's own write; null when there's none, or it says that already,
 * or the minutes are approved and stay so (their file is their record: fileMayChange, by `current`, the minutes as the
 * site has them). Everything it goes by is read here, before the write: a read or the file store failing refuses the
 * save in words (`approving`: the approval's), nothing changed. → { also, drop, done } | null
 */
async function minutesFileWith(env, current, next, { approving }) {
  if (!current.minutesFrom?.typed || current.practice) return null;
  try {
    const { minutesFileStep } = await import('./_board-notes.js');
    return await minutesFileStep(env, asWritten(current, next), { was: current });
  } catch (err) {
    console.error('[board] the minutes’ Word file for a save', current.id, err?.message || err);
    throw notChanged(err, approving);
  }
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

/** Where a deleted meeting's invite waits for its cancel (./_board-invite.js cancelOwed), written by its delete */
export const INVITE_CANCEL = (id) => `invite-cancel:${id}`;
/** Tables kept beside a meeting by its id, each gone with it */
const BESIDE_MEETING = ['board_rsvps', 'board_rsvp_links', 'board_minutes_notes', 'board_minutes_corrections', 'board_minutes_signed', 'board_checkins', 'board_votes'];
/**
 * A meeting and everything kept beside it, gone in ONE write: its files' rows (their bytes marked to go, deleted once
 * it lands: bytesOff), its RSVPs and old answer links, the secretary's notes and her signature on its minutes, the
 * board's corrections, check-ins and votes, a change still waiting for its invite, and (when it has an invite) that
 * invite's cancel owed, from the meeting as the write finds it (INVITE_CANCEL: the meeting as it went, so an invite
 * recorded a moment before comes off too; ./_board-invite.js deleteWithInvite sends it once, after). All of it lands, or
 * none of it: never files, answers or notes left behind a meeting that's gone, and one left by a delete that stopped
 * partway before (Board QA round 15, Nov 26 2026) goes on the next press. Its answer lost: deleted if the meeting isn't
 * there (`was`: the meeting as read before, for the answer). → the meeting as it was when it went, or null when there
 * was none
 */
export async function deleteMeeting(env, id, { was = null } = {}) {
  const DB = env.DB;
  await ensureSchema(DB);
  await stateReady(DB);
  const at = nowIso();
  const stmts = [
    // (first, from the meeting as this write finds it)
    DB.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) SELECT ?, json_object('at', ?, 'meeting', json(data)), ? FROM board_meetings WHERE id = ? AND json_valid(data) AND json_extract(data, '$.invite.eventId') IS NOT NULL").bind(INVITE_CANCEL(id), at, at, id),
    DB.prepare("INSERT OR REPLACE INTO board_state (key, data, updated_at) SELECT ? || r2_key, json_object('key', r2_key), ? FROM board_files WHERE owner_type = 'meeting' AND owner_id = ?").bind(BYTES_OFF, at, id),
    DB.prepare("DELETE FROM board_files WHERE owner_type = 'meeting' AND owner_id = ? RETURNING r2_key").bind(id),
    ...BESIDE_MEETING.map((t) => DB.prepare(`DELETE FROM ${t} WHERE meeting_id = ?`).bind(id)),
    // (./_board-invite.js pendingKey: nothing left for it to go onto)
    DB.prepare('DELETE FROM board_state WHERE key = ?').bind(`invite-pending:${id}`),
    DB.prepare('DELETE FROM board_meetings WHERE id = ? RETURNING data').bind(id),
  ];
  const r = await landedOr(() => DB.batch(stmts), async () => !(await DB.prepare('SELECT 1 AS x FROM board_meetings WHERE id = ?').bind(id).first()));
  pressDone();
  if (r?.lost) return was ? cleanMeeting(was) : null;
  await bytesOff(env, (r[2]?.results || []).map((x) => x.r2_key).filter(Boolean));
  const row = r.at(-1)?.results?.[0];
  return row ? cleanMeeting(parse(row.data)) : null;
}

/**
 * Done or not, by action id: an admin for any action, a member for their own. A member reaches only the action items
 * the board page shows (a shared meeting's): one on a meeting they can't see isn't there for them (404), never "someone else's"
 */
export async function setActionDone(DB, actionId, done, who = {}) {
  // (its reads, then one write, its answer from what was written: the database failing changed nothing, said so)
  return actionDone(DB, actionId, done, who).catch(nothingDone());
}
async function actionDone(DB, actionId, done, { by, slug = null } = {}) {
  await ensureSchema(DB);
  if (!ID.test(String(actionId || ''))) throw Object.assign(new Error('Which action item?'), { status: 400 });
  const meetings = await listMeetings(DB, { practice: !slug });
  const action = (slug ? meetings.filter((m) => boardCopy(m)) : meetings).flatMap((m) => m.actions).find((a) => a.id === actionId);
  if (!action) throw Object.assign(new Error('That action item is gone'), { status: 404 });
  // (theirs at the moment of their own rename too: the to-do still at the old address, or the sign-in: sameMember)
  if (slug && !(await sameMember(DB, action.owner, slug))) throw Object.assign(new Error('Only the person it’s assigned to can tick it off'), { status: 403 });
  const on = done ? todayEastern() : null;
  // (its answer lost: done as asked if the site has it so)
  await landedOr(() => DB.prepare('INSERT OR REPLACE INTO board_action_state (action_id, done, done_on, by) VALUES (?, ?, ?, ?)').bind(actionId, done ? 1 : 0, on, by || '').run(),
    async () => { const r = await DB.prepare('SELECT done, done_on, by FROM board_action_state WHERE action_id = ?').bind(actionId).first(); return !!r && Number(r.done) === (done ? 1 : 0) && (r.done_on ?? null) === on && (r.by || '') === (by || ''); });
  return { id: actionId, done: !!done, doneOn: on || '' };
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
export async function attachToItem(env, id, itemId, file, who = {}) {
  // (nothing is kept until its one write lands: a database that didn't answer before it is said in words)
  return attaching(env, id, itemId, file, who).catch((e) => { throw e?.status ? e : readDown(NOT_SAVED, e); });
}
async function attaching(env, id, itemId, file, { member = null, admin = false, adminEmail = '', fileId = '' } = {}) {
  await ensureSchema(env.DB);
  const { it } = await presenterGate(env, id, itemId, { member, admin });
  // The file's row and its place on the item in one write over the meeting as read: never a file nothing shows, nor a
  // second copy when it's pressed again (Board QA round 12). The page's own id for the file (`fileId`): sent again after
  // its answer was lost, it's the file already kept, on its item (Board QA round 13)
  if ((it.docs || []).length >= 20 && !(fileId && it.docs.includes(fileId))) throw err('That item has 20 documents already', 409);
  const { file: stored, meetings, cur } = await putFileWith(env, { ownerType: 'meeting', ownerId: id, file, kind: kindOfName(file?.name || ''), by: member?.email || adminEmail, fileId },
    (also, f) => patchTogether(env.DB, [id], ([m]) => {
      if (!m) throw err('That meeting isn’t on the board page', 404);
      if (!m.sections.some((s) => s.items.some((x) => x.id === itemId))) throw err('That item isn’t on the agenda any more', 404);
      // (on the item already: the file this press kept a moment ago, its answer lost on the way back)
      const on = m.sections.some((s) => s.items.some((x) => x.id === itemId && (x.docs || []).includes(f.id)));
      return { cur: m, writes: on ? [] : [[m, { ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, docs: [...(x.docs || []), f.id] } : x)) })) }]], also };
    }, { by: member?.name || adminEmail }));
  return { file: stored, docs: (meetings[id] || cur).sections.flatMap((s) => s.items).find((x) => x.id === itemId)?.docs || [] };
}
/** A file step that didn't land: nothing of it was done (round 11's words) */
const NOT_SAVED = NOTHING_SAVED;

/**
 * A document taken off an item on the board page: its presenter, only one they put there themselves (and it's gone
 * for good once nothing else has it); an admin, any (it stays with the meeting, as in Board). → { docs }
 */
export async function detachFromItem(env, id, itemId, fileId, who = {}) {
  // (one write: a database that didn't answer before it landed left nothing changed, and is said in words)
  return detaching(env, id, itemId, fileId, who).catch((e) => { throw e?.status ? e : readDown(NOT_SAVED, e); });
}
async function detaching(env, id, itemId, fileId, { member = null, admin = false, adminEmail = '' } = {}) {
  await ensureSchema(env.DB);
  const { m, it } = await presenterGate(env, id, itemId, { member, admin });
  // (a member: only one the board page shows with it, never a staff-only file)
  const there = (it.docs || []).filter((d) => !member || m.files.some((f) => f.id === d && !f.staffOnly));
  if (!there.includes(fileId)) throw err('That document isn’t with this item', 404);
  const row = await env.DB.prepare('SELECT by FROM board_files WHERE id = ?').bind(fileId).first();
  if (member && (!row || String(row.by || '').toLowerCase() !== String(member.email || '').toLowerCase())) throw err('Only Board’s admins can take off a document someone else put there', 403);
  // Off the item, and (theirs, on no other item now) the file's row with it, in one write; its bytes once that lands
  // (Board QA round 12: off the item, then a delete that failed left the file with the meeting for good)
  const file = member ? await fileRowOf(env.DB, fileId) : null;
  let gone = false;
  const saved = stillThere((await patchTogether(env.DB, [id], ([cur]) => {
    if (!cur) throw err('That meeting isn’t on the board page', 404);
    const next = { ...cur, sections: cur.sections.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, docs: (x.docs || []).filter((d) => d !== fileId) } : x)) })) };
    gone = !!file && !onAnItem(next, fileId);
    return { writes: [[cur, next]], also: gone ? fileOff(fileId, file) : [] };
  }, { by: member?.name || adminEmail })).meetings[id]);
  if (gone) await bytesOff(env, [file.r2_key]);
  return { docs: saved.sections.flatMap((s) => s.items).find((x) => x.id === itemId)?.docs || [] };
}

/**
 * The order of an item's slides on the screen (board-shared.js orderUnits), set on the board page by who presents it
 * (presenterGate, as their report), or by one of Board's admins: never a clash, nothing else about the item changes
 * → { itemId, slideOrder }
 */
export async function saveSlideOrder(env, id, itemId, order, who = {}) {
  // (read first, then one write over the meeting as read (patchMeeting): the database failing changed nothing)
  return slideOrder(env, id, itemId, order, who).catch(nothingDone());
}
async function slideOrder(env, id, itemId, order, { member = null, admin = false, adminEmail = '' } = {}) {
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
export async function saveReport(env, id, itemId, text, who = {}) {
  // (read first, then one write over the meeting as read (patchMeeting): the database failing changed nothing)
  return reporting(env, id, itemId, text, who).catch(nothingDone());
}
async function reporting(env, id, itemId, text, { member = null, admin = false, adminEmail = '', base = null, look = undefined } = {}) {
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
export async function saveMotion(env, id, itemId, text, who = {}) {
  // (read first, then one write over the meeting as read (patchMeeting): the database failing changed nothing)
  return moving(env, id, itemId, text, who).catch(nothingDone());
}
async function moving(env, id, itemId, text, { member = null, admin = false, adminEmail = '', base = null } = {}) {
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
  return docsOf(await docsRead(DB, year));
}
/** What listDocs reads (every paper, their files, this year's signatures and the rest), to be made into papers by docsOf */
async function docsRead(DB, year = thisYear()) {
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
  return { rows, files, sigs, copies, prior, keptRows, declined };
}
/** The papers as listDocs gives them, from what it read (docsRead) */
function docsOf({ rows, files, sigs, copies, prior, keptRows, declined }) {
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
 *   - new words, or a new file (`newFile`: its name; its bytes put by `stage` once the save is to go, saveDocWithFile),
 *     on a paper some of the board signed this year: a 409 with { ask: { names, since } } until the admin says whether
 *     they sign again (`askAgain` true or false; true: signatures on earlier wordings stop counting, a new file a
 *     wording of its own). `fromFile`: the words are its own file's, as read (the paper is the same, so nobody signs
 *     again); `wordsFrom`: the file's name, for the record
 *   - a paper everyone signs keeps its words or its file: one with neither can't be required
 * Every read first, then ONE write: the paper, its new wording (and the file it is), a new file's row, and the paper
 * off the Advisory Board's papers when it should be, written only over the paper as it was read, so all of it lands or
 * none of it (Board QA round 15, Nov 26 2026: the wording and the paper were two writes, and a wording was left with no
 * paper; a read after it said "can't tell" over a save that landed). The paper read back for the answer, or (that read
 * failing) the paper as written, with `seen.reread` for the page to look again
 */
export async function saveDoc(DB, raw, opts = {}) {
  // (its reads, then one write: the database failing before it landed changed nothing, said so; its answer lost, looked
  // at; a read for the answer after it, the paper as written. Board QA round 15)
  return savingDoc(DB, raw, opts).catch(nothingDone());
}
/**
 * A paper saved with a new file (Board → Documents): the file's bytes put first, under a key of their own (putFile's
 * stage), and its row written in the paper's own one write (saveDoc's `stage`), with the paper's new wording and that
 * wording's link to it, its words' source when they were read from it (`wordsFromNew`), and "the board signs again".
 * Should that write not land, the bytes go back and nothing changed: no wording that says it's a file the site hasn't
 * got, no signature stopping counting over it, and the auditor's download has every wording members sign (Board QA round
 * 15, Nov 26 2026: the file's row failed, and the paper moved to a wording that named the new file while its file stayed
 * the old one, every signature voided)
 */
export async function saveDocWithFile(env, raw, file, opts = {}) {
  const name = String(file?.name || 'file').slice(0, 200);
  return saveDoc(env.DB, raw, {
    ...opts, newFile: name,
    stage: (ownerId) => putFile(env, { ownerType: 'doc', ownerId, file, by: opts.by || '', stage: true, ownerLater: true }).catch((e) => { throw e?.status || e?.setup ? e : readDown(NOTHING_SAVED, e); }),
  });
}
const DOC_KEPT_CHANGING = 'The paper kept changing while it was saved. Nothing was lost: try again.';
/** The Advisory Board's settings (./_advisory.js getSettings: board_state `advisory`), as one statement's place */
const ADVISORY_STATE = 'advisory';
/**
 * A paper off the Advisory Board's papers (closeToAdvisors), as one statement for the step that makes it so (`only`: the
 * condition it goes under, { sql, bind }): written only when the list has it, the rest of their settings as they are
 */
const advisoryOffStmt = (DB, id, only, at = nowIso()) => DB.prepare(`UPDATE board_state SET data = json_set(data, '$.boardDocs', json((SELECT COALESCE(json_group_array(j.value), '[]') FROM json_each(board_state.data, '$.boardDocs') j WHERE j.value <> ?))), updated_at = ?
  WHERE key = ? AND json_valid(data) AND EXISTS (SELECT 1 FROM json_each(board_state.data, '$.boardDocs') x WHERE x.value = ?) AND ${only.sql}`).bind(id, at, ADVISORY_STATE, id, ...only.bind);
async function savingDoc(DB, raw, { by = '', askAgain = null, base = null, fromFile = false, wordsFrom = '', newFile = '', stage = null, wordsFromNew = false, seen = {} } = {}) {
  await ensureSchema(DB);
  await stateReady(DB);
  const d0 = cleanDoc(raw);
  if (!d0.title) throw Object.assign(new Error('A document needs a title'), { status: 400 });
  // (a new file's bytes, put once the save is to go, and named only by its one write)
  let staged = null;
  let landed = false;
  try {
    for (let i = 0; i < 5; i++) {
      const d = { ...d0 };
      const row = await DB.prepare('SELECT data, updated_at FROM board_docs WHERE id = ?').bind(d.id).first();
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
      // Every paper as it is now, read before the write: who signed it (for the question), and the answer should the
      // read after the write not come
      const reads = await docsRead(DB);
      // (a new file coming with this save is its file)
      if (was && d.sign && !body && !newFile && !(reads.files[d.id] || []).length) throw Object.assign(new Error('A paper every member signs needs its words or its file: write them, add the file, or untick Required'), { status: 400 });
      // A new file changes what the board reads only when it reads the paper as its file (written here, it reads the words)
      const newRead = !!newFile && !body;
      // Required after this save, and what the board reads changes now (new words, a new file) or changed while it wasn't
      // required (made required again): whoever's signature would count on it is asked about
      const reRequired = !!was && !was.sign && d.sign;
      const changesNow = changed || newRead;
      if (was && d.sign && (changesNow || reRequired) && askAgain == null && !(fromFile && !newFile && !was.body)) {
        const current = docsOf(reads).find((x) => x.id === d.id);
        const board = await activeBoard(DB);
        const names = board.filter((p) => current?.signed[p.slug] && (changesNow || current.signed[p.slug].version < was.version)).map((p) => p.name);
        // since: what they signed (the earlier words, or the file); now: what the board will read; newFile: a new file;
        // paused: its words changed while it wasn't required
        if (names.length) throw Object.assign(new Error('Do they sign the new version?'), { status: 409, extra: { ask: { names, since: was.body ? 'words' : 'file', now: body ? 'words' : 'file', newFile: newFile ? String(newFile) : '', paused: reRequired && !changesNow, fields: fieldsMoved(was.body, body) } } });
      }
      // The new file's bytes, put first, once (the step made again after another save keeps them)
      if (newFile && stage && !staged) staged = await stage(d.id);
      if (staged && wordsFromNew) d.wordsFile = staged.id;
      // (its own time, after the last: what the step goes by, and what the look at a lost answer finds)
      const at = stampAfter(row?.updated_at);
      // The wording's number, and who wrote it when, are the server's
      const next = { ...d, body, version: was?.version || 0, signFrom: was?.signFrom || 0, readFrom: was?.readFrom || 0, wordsAt: was?.wordsAt || '', wordsBy: was?.wordsBy || '', createdAt: row ? parse(row.data).createdAt : at, updatedAt: at };
      // A new version: new words, or a new file for a paper read as its file (whether or not the board signs it again:
      // a page still showing the old file can't sign the new one unread)
      // (required again, the board asked to sign again: from the version it is)
      if (reRequired && !changesNow && askAgain === true) { next.signFrom = next.version; next.readFrom = next.version; }
      let wording = null;
      if (changed || (was && newRead)) {
        next.version += 1;
        if (changed) { next.wordsAt = at; next.wordsBy = String(by || '').slice(0, 200); }
        // (its note: where its words came from, or the file it was; and that the board signed again from it)
        const note = [changed ? (wordsFrom ? `From ${String(wordsFrom).slice(0, 200)}` : '') : `A new file: ${String(newFile).slice(0, 200)}`, askAgain === true ? 'The board signs again from here' : ''].filter(Boolean).join(' · ');
        // (with its SHA-256: what a signature on this wording signed, exactly; a paper read as its file, the file it is)
        wording = { version: next.version, body, note, hash: body ? await sha256Hex(body) : null, fileId: !body && staged ? staged.id : null };
        if (askAgain === true) next.signFrom = next.version;
        // A page still on an earlier version re-reads before signing, unless the admin said the change doesn't need it
        // (and always when what they initial or answer moved: a page from before can't sign without them)
        if (askAgain !== false || fieldsMoved(was?.body, body)) next.readFrom = next.version;
      } else if (staged && !body) {
        // (a paper read as its file, made with it: its wording 0 is that file, so what a signature on it signed is never a
        // later file)
        wording = { version: next.version, body: '', note: `Its file: ${String(newFile).slice(0, 200)}`, hash: null, fileId: staged.id };
      }
      // One write, each statement only while the paper is as it was read (a new one: while there's none), the paper's
      // own last: all of it lands, or none of it (Board QA round 15)
      const pre = row
        ? { sql: "EXISTS (SELECT 1 FROM board_docs WHERE id = ? AND COALESCE(updated_at, '') = ?)", bind: [d.id, row.updated_at || ''] }
        : { sql: 'NOT EXISTS (SELECT 1 FROM board_docs WHERE id = ?)', bind: [d.id] };
      const data = JSON.stringify(next);
      const stmts = [
        ...(wording ? [DB.prepare(`INSERT OR REPLACE INTO board_doc_versions (doc_id, version, body, at, by, note, hash, file_id) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${pre.sql}`)
          .bind(d.id, wording.version, wording.body, at, String(by || '').slice(0, 200), wording.note, wording.hash, wording.fileId, ...pre.bind)] : []),
        ...(staged ? [DB.prepare(`${staged.insert.sql} AND ${pre.sql}`).bind(...staged.insert.bind, ...pre.bind)] : []),
        // (a paper the board now signs, hides or reads here is off the Advisory Board's papers in the same step)
        ...(next.sign || next.shared === false || body ? [advisoryOffStmt(DB, d.id, pre, at)] : []),
        row
          ? DB.prepare("UPDATE board_docs SET data = ?, updated_at = ? WHERE id = ? AND COALESCE(updated_at, '') = ?").bind(data, at, d.id, row.updated_at || '')
          : DB.prepare('INSERT INTO board_docs (id, data, updated_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM board_docs WHERE id = ?)').bind(d.id, data, at, d.id),
      ];
      // (its answer lost: written if the paper there is exactly this write)
      const r = await landedOr(() => DB.batch(stmts), async () => {
        const x = await DB.prepare('SELECT data, updated_at FROM board_docs WHERE id = ?').bind(d.id).first();
        return !!x && x.updated_at === at && x.data === data;
      });
      // Saved meanwhile (another tab, the other admin): read again and made again from what's there now
      if (!r?.lost && !((r?.at?.(-1)?.meta?.changes ?? 0) > 0)) continue;
      landed = true;
      pressDone();
      // The paper as it is now for the answer; that read failing, as this write left it, the page told to look again
      try {
        const now = (await listDocs(DB)).find((x) => x.id === d.id);
        if (now) return now;
      } catch (err) { console.error('[board] reading a paper back after its save', d.id, err?.message || err); }
      seen.reread = true;
      const file = staged ? (({ insert, drop, ...f }) => ({ id: f.id, name: f.name, type: f.type, size: f.size || 0, kind: f.kind || 'other', staffOnly: !!f.staffOnly, at: f.at }))(staged) : null;
      return docsOf({ ...reads, rows: [{ data }], files: file ? { ...reads.files, [d.id]: [...(reads.files[d.id] || []), file] } : reads.files })[0];
    }
    throw Object.assign(new Error(DOC_KEPT_CHANGING), { status: 409 });
  } catch (err) {
    // (not written: the new file's bytes go back. One the site can't tell yet keeps them: its row may name them, and
    // bytes no row names are the heartbeat's: takeLooseBytes)
    if (staged && !landed && !err?.extra?.unsure) await staged.drop().catch((e) => console.error('[board] a staged paper file', e?.message || e));
    throw err;
  }
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

/** Said when a paper the board has signed is to be deleted: it's SOARD's record */
const SIGNED_KEPT = 'The board has signed this paper, so it’s kept as SOARD’s record. Take it off the board page instead (the switch on its row), or untick Required.';
/** Said when a member signed it the moment it was to be deleted: the signature landed first, so the paper stays */
const signedJustNow = (name) => `${String(name || '').trim().split(/\s+/)[0]} signed this paper a moment ago, so it can’t be deleted. Take it off the board page instead.`;
/** Anyone ever signed it, as a statement's condition (everSigned, read as the write goes) */
const SIGNED_ONCE = "(EXISTS (SELECT 1 FROM board_signatures WHERE doc_id = ?) OR EXISTS (SELECT 1 FROM board_signatures_earlier WHERE doc_id = ?) OR EXISTS (SELECT 1 FROM board_sign_events WHERE doc_id = ? AND kind IN ('signed', 'superseded', 'taken-off')))";
/**
 * A paper nobody has signed, deleted: ONE write that takes it away only while nobody has signed it (any year, any
 * wording, a signature since replaced or taken off: everSigned, as the write's own condition), and with it, only once
 * it's gone, its file's rows (their bytes marked to go, deleted once the write lands: bytesOff), its wordings and its
 * place among the Advisory Board's papers. Nothing is left behind for a paper that's gone, and a partial delete can't
 * leave a paper without its file. A member signing it at the same moment: whichever lands first stands; the signature
 * first keeps the paper, said by name (signedJustNow), and a signature after the delete finds no paper to sign
 * (signing). Every read before the write: the database failing anywhere changed nothing, said so; its answer lost,
 * looked at. Board QA round 15, Nov 26 2026: the delete and a signature both answered 200, and the signature, its
 * agreement to sign electronically and their events stayed for a paper whose words were gone
 */
export async function deleteDoc(env, id) {
  return deletingDoc(env, id).catch(nothingDone());
}
async function deletingDoc(env, id) {
  const DB = env.DB;
  await ensureSchema(DB);
  await stateReady(DB);
  if (await everSigned(DB, id)) throw Object.assign(new Error(SIGNED_KEPT), { status: 409, extra: { signed: true } });
  // (its files' bytes as read, to delete once the write lands; any put on it since are marked by the write itself)
  const had = ((await DB.prepare("SELECT r2_key FROM board_files WHERE owner_type = 'doc' AND owner_id = ?").bind(id).all()).results || []).map((r) => r.r2_key);
  const at = nowIso();
  const gone = { sql: 'NOT EXISTS (SELECT 1 FROM board_docs WHERE id = ?)', bind: [id] };
  const stmts = [
    DB.prepare(`DELETE FROM board_docs WHERE id = ? AND NOT ${SIGNED_ONCE}`).bind(id, id, id, id),
    DB.prepare(`INSERT OR REPLACE INTO board_state (key, data, updated_at) SELECT ? || r2_key, json_object('key', r2_key), ? FROM board_files WHERE owner_type = 'doc' AND owner_id = ? AND ${gone.sql}`).bind(BYTES_OFF, at, id, ...gone.bind),
    DB.prepare(`DELETE FROM board_files WHERE owner_type = 'doc' AND owner_id = ? AND ${gone.sql} RETURNING r2_key`).bind(id, ...gone.bind),
    DB.prepare(`DELETE FROM board_doc_versions WHERE doc_id = ? AND ${gone.sql}`).bind(id, ...gone.bind),
    advisoryOffStmt(DB, id, gone, at),
  ];
  // (its answer lost: deleted if the paper isn't there now)
  const r = await landedOr(() => DB.batch(stmts), async () => !(await DB.prepare('SELECT 1 AS x FROM board_docs WHERE id = ?').bind(id).first()));
  if (!r?.lost && !((r?.[0]?.meta?.changes ?? 0) > 0)) {
    // Not taken: gone already (another tab), or signed between the look and the write. Which, read now (failing: the
    // delete didn't land, so nothing was changed, said so)
    const now = await DB.prepare('SELECT (SELECT COUNT(*) FROM board_docs WHERE id = ?) AS there, (SELECT name FROM board_signatures WHERE doc_id = ? ORDER BY at DESC LIMIT 1) AS name').bind(id, id).first();
    if (Number(now?.there) > 0) throw Object.assign(new Error(now.name ? signedJustNow(now.name) : SIGNED_KEPT), { status: 409, extra: { signed: true } });
  }
  pressDone();
  const keys = [...new Set([...had, ...(r?.lost ? [] : (r?.[2]?.results || []).map((x) => x.r2_key))])].filter(Boolean);
  await bytesOff(env, keys);
  return true;
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
 * `with(was)`: what goes in the same write as the signature ({ stmts, events, need }: their agreement to sign
 * electronically and its event, markPlan; the notice a signature it replaces owes), asked as the step is made, with the
 * row it replaces, so it decides on what's there then. A repeat writes only what it
 * still needs (`need`: an agreement the record doesn't have yet), never skipping it. Board QA round 13, Nov 24 2026:
 * the agreement was a second and third write after the signature, and one failing left a signature without it for good
 */
async function writeSignature(DB, sig, { keep = false, same = null, with: also = null, only = null } = {}) {
  const { docId, slug, year } = sig;
  const e = sig.evidence || {};
  // `only` ({ sql, bind }: its paper still there, paperThere): every statement and event of the write goes only while it
  // holds, so a signature never lands for a paper deleted between its read and its write; `{ written: false, gone }`
  // when it didn't hold (Board QA round 15)
  const guarded = (plan) => (only && (plan.stmts?.length || plan.events?.length) ? { ...plan, guard: only, after: (res) => ((res?.[0]?.meta?.changes ?? 0) > 0 ? plan.result : { written: false, gone: true }) } : plan);
  return appendEvents(DB, async () => {
    const was = await DB.prepare('SELECT * FROM board_signatures WHERE doc_id = ? AND slug = ? AND year = ?').bind(docId, slug, year).first();
    if (was && keep) return { result: { written: false, was } };
    const repeat = was && same ? same(was) : null;
    const more = also ? await also(was) : null;
    if (repeat) return more?.need ? guarded({ stmts: more.stmts, events: more.events, result: { written: false, was, same: repeat } }) : { result: { written: false, was, same: repeat } };
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
        stmts.push(putSignature(DB, 'board_signatures_earlier', { ...was, version: wasV }, undefined, only));
      } else {
        events.push({ kind: 'superseded', docId, slug, year, version: wasV, at, by: row.added_by, detail: { row: was } });
        if (was.file_id && was.file_id !== row.file_id) stmts.push(DB.prepare(`UPDATE board_files SET superseded_at = ? WHERE (id = ? OR id = (SELECT original_id FROM board_files WHERE id = ?)) AND superseded_at IS NULL${only ? ` AND ${only.sql}` : ''}`).bind(at, was.file_id, was.file_id, ...(only ? only.bind : [])));
        // (its signed copy too: kept, as an earlier signature's)
        if (was.record_id) stmts.push(DB.prepare(`UPDATE board_files SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL${only ? ` AND ${only.sql}` : ''}`).bind(at, was.record_id, ...(only ? only.bind : [])));
      }
    }
    stmts.push(putSignature(DB, 'board_signatures', row, undefined, only));
    events.push({
      kind: 'signed', docId, slug, year, version: row.version, at, by: row.added_by, ip: e.ip, device: e.device,
      detail: { how: row.how, name: row.name, hash: row.hash, file: row.file_id, drive: row.drive_id, signerEmail: row.signer_email, signinAt: row.signin_at, ...(sig.detail || {}) },
    });
    return guarded({ stmts: [...stmts, ...(more?.stmts || [])], events: [...events, ...(more?.events || [])], result: { written: true, row, was } });
  });
}
/** A paper still there, as the condition a signature's write goes under (writeSignature's `only`) */
const paperThere = (docId) => ({ sql: 'EXISTS (SELECT 1 FROM board_docs WHERE id = ?)', bind: [docId] });
/** Said when the paper was deleted between a member's page and their signature's write: nothing was signed */
export const PAPER_DELETED = 'That paper was deleted a moment ago, so there’s nothing to sign.';
const paperDeleted = () => Object.assign(new Error(PAPER_DELETED), { status: 404, extra: { gone: true } });

/**
 * Whether a member's agreement to sign electronically is on record: kept with them (board_member_marks' consent_at)
 * and in the signing chain ('consented', under any address they've had). One without the other is a record that
 * doesn't show it (Board QA round 13: a signature landed and its agreement's own write didn't), so it's asked for again
 * and written whole. A read that fails throws
 */
export async function agreedOnRecord(DB, slug, marks) {
  if (!marks?.consent_at) return false;
  const slugs = await slugsOf(DB, slug);
  const where = slugs.map((x) => (x.before ? '(slug = ? AND seq < ?)' : 'slug = ?')).join(' OR ');
  return !!(await DB.prepare(`SELECT 1 AS y FROM board_sign_events WHERE kind = 'consented' AND (${where}) LIMIT 1`).bind(...slugs.flatMap((x) => (x.before ? [x.slug, x.before] : [x.slug]))).first());
}

/**
 * Their adopted signature and initials, for next time, and their agreement to sign electronically when the record
 * hasn't got it (agreedOnRecord), with its 'consented' event: statements and events for the one write that signs
 * (writeSignature's `with`, the secretary's on the minutes: ./_board-minutes-sign.js), never steps of their own. Read
 * as the step is made, so a second device's agreement written first is the agreement. → { stmts, events, need }
 * (`need`: the agreement is to be written)
 */
export async function markPlan(DB, member, { mark, typed, at, evidence = {}, consentHash, docId, year, version, only = null }) {
  const marks = await DB.prepare('SELECT consent_at FROM board_member_marks WHERE slug = ?').bind(member.slug).first();
  const first = !(await agreedOnRecord(DB, member.slug, marks));
  // (`only`: the condition the signature goes under, so the agreement never lands without it: writeSignature)
  return {
    need: first,
    stmts: [DB.prepare(`INSERT INTO board_member_marks (slug, mark, initials, consent_at, consent_ip, consent_hash, updated_at) ${only ? `SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${only.sql}` : 'VALUES (?, ?, ?, ?, ?, ?, ?)'} ON CONFLICT(slug) DO UPDATE SET mark = excluded.mark, initials = excluded.initials, consent_at = COALESCE(board_member_marks.consent_at, excluded.consent_at), consent_ip = COALESCE(board_member_marks.consent_ip, excluded.consent_ip), consent_hash = COALESCE(board_member_marks.consent_hash, excluded.consent_hash), updated_at = excluded.updated_at`)
      .bind(member.slug, JSON.stringify({ type: mark.type, style: mark.style, text: typed, ...(mark.path ? { path: mark.path } : {}) }), mark.initials, first ? at : null, first ? evidence.ip || '' : null, first ? consentHash : null, at, ...(only ? only.bind : []))],
    events: first ? [{ kind: 'consented', docId, slug: member.slug, year, version, at, by: member.email || '', ip: evidence.ip, device: evidence.device, detail: { consentHash, text: CONSENT_TEXT } }] : [],
  };
}

/**
 * A member's signature for this year on the board page. Today's page sends their adopted `mark` ({ type: 'typed' |
 * 'drawn', style, text: their name as typed (signsAs: their own), path, initials }), each of the paper's `fields`
 * ({ [n]: value }: every initial and answer it marks, required), `consent` (agreeing once to sign electronically,
 * the first time) and the `year` on the page. A page from before marks (`name` only) still signs a paper that asks
 * for nothing else. A signed copy already in (theirs, or one in Drive) stays: it's the better record.
 * → { docId, year, name, at, how, version, mark, fields, copy, drive }
 */
export async function signDoc(DB, docId, member, name, opts = {}) {
  // (one write, every read before it: the database failing anywhere signed nothing, and says so in words)
  return signing(DB, docId, member, name, opts).catch(nothingDone(NOTHING_SIGNED));
}
async function signing(DB, docId, member, name, { version = null, evidence = {}, bucket = null, mark: rawMark = null, fields: given = null, consent = false, year: pageYear = null } = {}) {
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
  // Agreeing to sign electronically, once, kept with when and where from: asked again when the record doesn't show it
  // (agreedOnRecord: kept with them and in the chain)
  const marks = mark ? await DB.prepare('SELECT * FROM board_member_marks WHERE slug = ?').bind(member.slug).first() : null;
  // (the words they agreed to, the first time: kept, so a later wording of the consent never stands in for theirs)
  const consentHash = mark ? marks?.consent_hash || await sha256Hex(CONSENT_TEXT) : null;
  if (mark && !consent && !(await agreedOnRecord(DB, member.slug, marks))) throw Object.assign(new Error('Tick that you agree to sign electronically, then sign'), { status: 409, extra: { consent: true } });
  const at = nowIso();
  const on = signedOn(doc, version);
  const hash = await versionHash({ DB, bucket }, doc, on);
  const how = mark?.type === 'drawn' ? 'drawn' : 'typed';
  const markKept = mark ? { type: mark.type, style: mark.style, text: typed, initials: mark.initials, ...(mark.path ? { path: mark.path } : {}) } : null;
  // The signature, its event, their adopted mark and (when the record hasn't got it) their agreement and its event: one
  // write, so a signature is never kept without the agreement it was given with (Board QA round 13, Nov 24 2026)
  const r = await writeSignature(DB, {
    docId, slug: member.slug, year, name: typed, how, by: member.email || '', at, version: on, signFrom: doc.signFrom, evidence, hash,
    fields: fields.length ? fields : null, mark: markKept, consentHash, processV: mark ? PROCESS_V : null,
    detail: mark ? { mark: { type: mark.type, style: mark.style }, fields: fields.map((f) => ({ n: f.n, kind: f.kind, value: f.value })), consentHash } : undefined,
  }, {
    same: (was) => (onPage(was.how) && (Number(was.version) || 0) === on ? was : null),
    with: mark ? () => markPlan(DB, member, { mark, typed, at, evidence, consentHash, docId, year, version: on, only: paperThere(docId) }) : null,
    // (only while the paper is there: deleted since this read it, nothing is signed, said so. Board QA round 15)
    only: paperThere(docId),
  });
  if (r?.gone) throw paperDeleted();
  // (Sign pressed twice, or from two devices: the first one is the signature; an agreement the record didn't have with
  // it was written above, never skipped)
  if (r?.same) return { docId, year, name: r.same.name, at: r.same.at, how: r.same.how, version: on, copy: null, drive: null };
  return { docId, year, name: typed, at, how, version: on, mark: markKept, fields, copy: null, drive: null };
}

/**
 * A signed copy as this year's signature: a board member's own, added on the board page (`member`), or one a Board
 * admin was handed for a member (`slug`, `by`). Kept staff-only beside the paper (the member opens their own);
 * it replaces a copy added for them before. A PDF or a photo of the signed page. `version`: the wording on the
 * member's page (as signDoc). → { docId, year, name, at, how, copy, drive }
 */
export async function signWithCopy(env, docId, file, opts = {}) {
  // (one write, every read before it, as signDoc: the database failing anywhere signed nothing, said in a signature's
  // words for a member's own copy, and in round 12's for one SOARD adds. Board QA round 14)
  return signingWithCopy(env, docId, file, opts).catch(nothingDone(opts.member ? NOTHING_SIGNED : NOTHING_SAVED));
}
async function signingWithCopy(env, docId, file, { member = null, slug = '', by = '', version = null, replace = false, evidence = {}, original = null, tell = false } = {}) {
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
  // Each file's bytes kept first, and its row written in the signature's own write (putFile's stage): a signature that
  // doesn't land leaves no file, and pressing again never keeps a second copy (Board QA round 13: a file and its record
  // change together)
  const staged = [];
  const stage = async (o) => { const f = await putFile(env, { ...o, stage: true }); staged.push(f); return f; };
  const dropAll = () => Promise.all(staged.map((f) => f.drop().catch((e) => console.error('[board] a staged copy', e?.message || e))));
  let kept = null;
  let copy = null;
  try {
    kept = original && typeof original.arrayBuffer === 'function' ? await stage({ ownerType: 'signed', ownerId: docId, file: original, staffOnly: true, by: by || who.email || '', slug: who.slug }) : null;
    copy = await stage({ ownerType: 'signed', ownerId: docId, file, staffOnly: true, by: by || who.email || '', slug: who.slug, originalId: kept?.id || null });
  } catch (err) { await dropAll(); throw err; }
  // (each only while the paper is there, as the signature: a copy never lands for a paper deleted meanwhile. Round 15)
  const there = paperThere(docId);
  const rows = staged.map((f) => env.DB.prepare(`${f.insert.sql} AND ${there.sql}`).bind(...f.insert.bind, ...there.bind));
  const at = nowIso();
  const on = member ? signedOn(doc, version) : doc.version;
  const hash = await versionHash(storeOf(env), doc, on);
  // (the copy it replaces is marked superseded inside writeSignature: kept, never deleted)
  // One they gave themselves (typed, drawn, their own copy), replaced by a copy SOARD added (`tell`): they're told, as a
  // signature taken off is, by the notice it owes written down as due in the same write as the copy's signature, so
  // it's never kept without it (./_board-notices.js; Board QA round 13)
  let owed = null;
  const telling = tell && !member && emailConfigured(env) && isEmail(who.email || '');
  const withIt = async (was) => {
    owed = null;
    if (!telling || !was || !(onPage(was.how) || was.how === 'copy')) return { stmts: rows, events: [] };
    await stateReady(env.DB);
    owed = `void:${docId}:${who.slug}:${year}:${was.at}`;
    return { stmts: [...rows, dueStmt(env.DB, owed, { kind: 'void', docId, slug: who.slug, year, at: was.at, to: who.email, replacedByCopy: true, reason: 'SOARD put a signed copy it was given in its place', by }, Date.now(), there)], events: [] };
  };
  let w;
  try {
    w = await writeSignature(env.DB, { docId, slug: who.slug, year, name: who.name, how: member ? 'copy' : 'staff', fileId: copy.id, by: by || who.email || '', at, version: on, signFrom: doc.signFrom, evidence, hash, detail: { copySha256: copy.sha256, original: kept ? { id: kept.id, sha256: kept.sha256 } : null } }, { with: withIt, only: there });
    if (w?.gone) throw paperDeleted();
  } catch (err) {
    // (not written: its bytes go back. One the site can't tell yet keeps them: its rows may name them)
    if (!err?.extra?.unsure) await dropAll();
    throw err;
  }
  const plain = (f) => { const { insert, drop, ...x } = f; return x; };
  const gone = w?.was && (onPage(w.was.how) || w.was.how === 'copy') ? w.was : theirs && (onPage(theirs.how) || theirs.how === 'copy') ? theirs : null;
  return { docId, year, name: who.name, at, how: member ? 'copy' : 'staff', version: on, copy: plain(copy), drive: null, ...(gone ? { replaced: { how: gone.how, at: gone.at, slug: who.slug, email: who.email || '' } } : {}), ...(owed ? { owed } : {}) };
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
export async function unsignDoc(env, docId, slug, year = thisYear(), { by = '', evidence = {}, reason = '', tell = false } = {}) {
  await ensureSchema(env.DB);
  const DB = env.DB;
  // (a signature they gave themselves, typed, drawn or their own copy, taken off (`tell`): the notice it owes them is
  // written down as due in the same write as taking it off, never a step after it. Board QA round 13)
  const telling = tell && emailConfigured(env);
  if (telling) await stateReady(DB);
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
    const owed = telling && ['typed', 'drawn', 'copy'].includes(row.how) ? `void:${docId}:${row.slug}:${row.year}:${row.at}` : null;
    if (owed) stmts.push(dueStmt(DB, owed, { kind: 'void', docId, slug: row.slug, year: row.year, at: row.at, reason, by }, Date.now()));
    return { stmts, events, result: { row, earlier, ...(owed ? { owed } : {}) } };
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

// ─── A file's bytes and its row, never one without the other ────────
//
// Board QA round 12, Nov 23 2026: deleting a file took its bytes first and its row after, so a row's delete that
// failed left the board page listing minutes that opened 404; and a file's new words were put over the old bytes
// apart from the step that said what they were, so a correction stood while the Word file kept the old words. Now a
// row goes before its bytes, and a file's bytes change only in the same step as what they say: each is a statement
// for that one step (patchTogether's `also`, or a batch). Bytes whose rows have gone are marked to go in that same
// step (board_state `file-bytes:<key>`), deleted once it lands, and a delete that doesn't go is the heartbeat's
// (finishBytesOff): bytes no row names are never opened, and never left for good.

const BYTES_OFF = 'file-bytes:';
/** A statement marking a stored file's bytes to go, for the step that takes its row off (`key`: the bytes) */
const markOff = (key, at = nowIso()) => ({ sql: 'INSERT OR REPLACE INTO board_state (key, data, updated_at) SELECT ?, ?, ? WHERE 1', bind: [`${BYTES_OFF}${key}`, JSON.stringify({ key }), at] });
/** A file's row as a delete goes by: its bytes and what owns it (null: there's none) */
export const fileRowOf = (DB, id) => DB.prepare('SELECT r2_key, owner_type, owner_id FROM board_files WHERE id = ?').bind(id).first();
/** A statement marking the bytes a file's row has as the step runs, whatever moved them since it was read, to go */
const markRowOff = (id, at = nowIso(), only = '') => ({ sql: `INSERT OR REPLACE INTO board_state (key, data, updated_at) SELECT ? || r2_key, json_object('key', r2_key), ? FROM board_files WHERE id = ?${only}`, bind: [BYTES_OFF, at, id] });
/**
 * A file taken off, as statements for one step (`row`: fileRowOf's, read before): its bytes marked to go, its row, and
 * approved minutes whose file it was left with none on record, as before it came, never a record of a file that's gone
 * (a person's Delete of it is refused: ./_board-minutes.js approvedFileNo. Board QA round 11). Once the step lands,
 * bytesOff deletes the bytes. Its places on its meeting's agenda come off in the same step: takeFileOff, the one way a
 * file is taken off a meeting. `only` { kind, name }: taken off only while it's still that (a step whose file a
 * founder has filed under something else or renamed since it was read leaves it theirs). → [{ sql ending in a WHERE, bind }]
 */
export function fileOff(id, row, at = nowIso(), { only = null } = {}) {
  const still = only ? { sql: ' AND kind = ? AND name = ?', bind: [only.kind, only.name] } : { sql: '', bind: [] };
  const mark = markRowOff(id, at, still.sql);
  return [
    { ...mark, bind: [...mark.bind, ...still.bind] },
    { sql: `DELETE FROM board_files WHERE id = ?${still.sql}`, bind: [id, ...still.bind] },
    ...(row.owner_type === 'meeting' ? [{ sql: "UPDATE board_meetings SET data = json_set(data, '$.approvedFile', '') WHERE id = ? AND json_extract(data, '$.approvedFile') = ? AND NOT EXISTS (SELECT 1 FROM board_files WHERE id = ?)", bind: [row.owner_id, id, id] }] : []),
  ];
}
/**
 * A meeting's file taken off in one step (deleteFile, the secretary's next send): the meeting as the step writes it,
 * with the file on none of its items (`next`, null when no item has it), and fileOff's statements. Nothing can name a
 * file that's gone (Board QA round 13, Nov 24 2026: a send deleted the last Word file a founder had put on an item, and
 * the item kept naming it). → { next, also }
 */
export function takeFileOff(m, id, row, opts = {}) {
  return { next: m && onAnItem(m, id) ? offItems(m, id) : null, also: fileOff(id, row, opts.at, opts) };
}
/**
 * Bytes whose rows went in a step that landed (fileOff, stageRewrite), deleted with their marks: never bytes a row
 * names (a step that left a file theirs, `only`), and one that doesn't go is the heartbeat's
 */
export async function bytesOff(env, keys) {
  const bucket = boardFiles(env);
  for (const key of keys) {
    try {
      if (!(await env.DB.prepare('SELECT 1 AS x FROM board_files WHERE r2_key = ?').bind(key).first())) await bucket?.delete(key);
      await env.DB.prepare('DELETE FROM board_state WHERE key = ?').bind(`${BYTES_OFF}${key}`).run();
    } catch (err) { console.error('[board] a file’s bytes, left for the heartbeat', key, err?.message || err); }
  }
}
/**
 * Bytes a step made that didn't land, deleted; marked to go should that not go either. Never bytes a row names: a step
 * that landed with its answer lost on the way back has them as its file (Board QA round 13), and a look that fails
 * leaves them to the heartbeat, which deletes only bytes no row names (finishBytesOff)
 */
async function dropStaged(env, key) {
  let named = null;
  try { named = !!(await env.DB.prepare('SELECT 1 AS x FROM board_files WHERE r2_key = ?').bind(key).first()); } catch (err) { console.error('[board] staged bytes, looking who names them', key, err?.message || err); }
  if (named) return;
  try {
    if (named === null) throw new Error('not known whether a row names them');
    await boardFiles(env)?.delete(key);
  } catch (err) {
    console.error('[board] staged bytes, left for the heartbeat', key, err?.message || err);
    const m = markOff(key);
    await env.DB.prepare(m.sql).bind(...m.bind).run().catch((e) => console.error('[board] staged bytes, unmarked', key, e?.message || e));
  }
}
/** Heartbeat: bytes marked to go whose delete didn't (bytesOff, dropStaged), deleted now; never bytes a row names. → how many */
export async function finishBytesOff(env, { limit = 50 } = {}) {
  await stateReady(env.DB);
  const rows = (await env.DB.prepare('SELECT key, updated_at FROM board_state WHERE key >= ? AND key < ? ORDER BY updated_at LIMIT ?').bind(BYTES_OFF, 'file-bytes;', limit).all()).results || [];
  let n = 0;
  for (const r of rows) {
    const key = r.key.slice(BYTES_OFF.length);
    if (!(await env.DB.prepare('SELECT 1 AS x FROM board_files WHERE r2_key = ?').bind(key).first())) await boardFiles(env)?.delete(key);
    await env.DB.prepare('DELETE FROM board_state WHERE key = ? AND updated_at = ?').bind(r.key, r.updated_at).run();
    n += 1;
  }
  return n;
}
/**
 * How old bytes under board/ have to be, with no row naming them, before the heartbeat takes them (takeLooseBytes): far
 * longer than any press takes to name what it put (a Worker stops within minutes), so bytes on their way to their row
 * are never taken
 */
export const LOOSE_AFTER_MS = 60 * 60 * 1000;
/** How often the heartbeat looks the file store over, a few pages of keys each time until it has seen them all */
const LOOSE_EVERY_MS = 60 * 60 * 1000;
const LOOSE_STATE = 'loose-bytes-look';
/**
 * Heartbeat: bytes in the file store under board/ (every Board file's bytes: putFile's and stageRewrite's keys, the only
 * ways Board puts bytes, the Advisory Board's papers among them) that no row names, LOOSE_AFTER_MS after they were put,
 * deleted. The one place for bytes put first whose row never came, whatever route put them and however it ended: a put
 * that landed with its answer lost, a step after it that didn't land, a drop of them that failed, the Worker stopped in
 * between. Nothing is written for it before a put, so no press says or does anything differently. The file store is
 * looked over a few pages at a time (where it got to kept in board_state), once an hour; never bytes a row names (each
 * page's keys checked against board_files just before they go). A file store with no list (a test's) is left as it is.
 * Board QA round 14, Nov 24 2026: a put that landed with its answer lost left bytes nothing named, for good, since only
 * bytes known to have landed were ever marked to go. → how many were deleted
 */
export async function takeLooseBytes(env, { now = Date.now(), pages = 4, limit = 500 } = {}) {
  const bucket = boardFiles(env);
  if (typeof bucket?.list !== 'function') return 0;
  const was = await readState(env.DB, LOOSE_STATE);
  // (a look over all of them done within the hour: nothing to do yet; one part way through goes on)
  if (!was.cursor && was.at && now - Date.parse(was.at) < LOOSE_EVERY_MS) return 0;
  let cursor = was.cursor || '';
  let n = 0;
  for (let i = 0; i < pages; i++) {
    const page = await bucket.list({ prefix: 'board/', limit, ...(cursor ? { cursor } : {}) });
    const old = (page.objects || []).filter((o) => { const t = new Date(o.uploaded || 0).getTime(); return t > 0 && t < now - LOOSE_AFTER_MS; }).map((o) => o.key);
    for (let j = 0; j < old.length; j += 50) {
      const part = old.slice(j, j + 50);
      const named = new Set(((await env.DB.prepare(`SELECT r2_key FROM board_files WHERE r2_key IN (${part.map(() => '?').join(', ')})`).bind(...part).all()).results || []).map((r) => r.r2_key));
      for (const key of part) {
        if (named.has(key)) continue;
        await bucket.delete(key);
        n += 1;
      }
    }
    cursor = page.truncated && page.cursor ? page.cursor : '';
    if (!cursor) break;
  }
  await writeState(env.DB, LOOSE_STATE, { cursor, at: cursor ? was.at || new Date(now).toISOString() : new Date(now).toISOString() });
  return n;
}

/**
 * New bytes for a file already kept (the same file, wherever it's linked, its words to be read again), staged: kept
 * under a key of their own now, and the row moved onto them in the caller's one step (`also`, statements ending in a
 * WHERE: patchTogether's, or a batch), the bytes it had marked to go in that same step. Once the step lands, `done`
 * deletes the old bytes; should it not, `drop` takes the new ones back, and the file is as it was. Never the old bytes
 * written over in place: nothing changes a file apart from what says what it is. → null when there's no such file
 */
export async function stageRewrite(env, id, bytes, { unlessSame = false } = {}) {
  const bucket = boardFiles(env);
  const row = await env.DB.prepare('SELECT r2_key, type, name, owner_type, owner_id, sha256 FROM board_files WHERE id = ?').bind(id).first();
  if (!bucket || !row) return null;
  const sha256 = await sha256Hex(new Uint8Array(bytes));
  // (`unlessSame`: the file says that already, byte for byte: nothing to bring up)
  if (unlessSame && row.sha256 && row.sha256 === sha256) return null;
  await stateReady(env.DB);
  const key = `board/${row.owner_type}/${row.owner_id}/${id}-${uid('v')}-${safeName(row.name)}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: row.type } });
  const at = nowIso();
  return {
    also: [
      // (the bytes the row has as the step lands are the ones that go, whatever moved it meanwhile)
      markRowOff(id, at),
      { sql: 'UPDATE board_files SET r2_key = ?, size = ?, sha256 = ?, words = NULL, words_v = NULL, words_next = NULL, words_try = NULL, words_at = NULL, words_fail = NULL, words_part = NULL WHERE id = ?', bind: [key, bytes.byteLength, sha256, id] },
      // (the file deleted meanwhile: these bytes are nobody's, and go too)
      { sql: 'INSERT OR REPLACE INTO board_state (key, data, updated_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM board_files WHERE id = ? AND r2_key = ?)', bind: [`${BYTES_OFF}${key}`, JSON.stringify({ key }), at, id, key] },
    ],
    drop: () => dropStaged(env, key),
    done: () => bytesOff(env, [row.r2_key]),
  };
}

/**
 * Store an uploaded file for a meeting, a document, or a member's signed copy of a document (`signed`, always
 * staff-only: signWithCopy) → its row as the admin shows it
 */
export async function putFile(env, { ownerType, ownerId, file, kind = 'other', staffOnly = false, by = '', slug = null, originalId = null, stage = false, fileId = '', ownerLater = false }) {
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
  // (`ownerLater`, staged only: what it's for is written in the same step as its row, a new paper saved with its file:
  // saveDocWithFile)
  const owner = stage && ownerLater ? true : ownerType === 'meeting'
    ? await env.DB.prepare('SELECT id FROM board_meetings WHERE id = ?').bind(ownerId).first()
    : await env.DB.prepare(`SELECT id FROM ${ADVISORY_OWNERS[ownerType] || 'board_docs'} WHERE id = ?`).bind(ownerId).first();
  if (!owner) throw Object.assign(new Error(`Save the ${ownerType === 'meeting' || ownerType === 'advisory-meeting' ? 'meeting' : 'document'} first`), { status: 404 });
  if (!file || typeof file.arrayBuffer !== 'function') throw Object.assign(new Error('No file came with that'), { status: 400 });
  if (file.size > MAX_FILE) throw Object.assign(new Error('That file is over 50 MB'), { status: 413 });
  const bytes = await file.arrayBuffer();
  const type = fileTypeOf(new Uint8Array(bytes), file.name);
  if (!type) throw Object.assign(new Error(await boardFileProblem(file)), { status: 415 });
  const sha256 = await sha256Hex(new Uint8Array(bytes));
  // The page's own id for the file it chose, made once (`fileId`): sent again (its answer lost on the way back, a press
  // again), it's the file already kept, never a second copy (Board QA round 13, Nov 24 2026: an item's upload whose
  // answer was lost, pressed again as the page said, kept the file twice). Read before anything is put
  const asked = PAGE_FILE_ID.test(String(fileId || '')) ? String(fileId) : '';
  const same = { ownerType, ownerId, by, sha256 };
  if (asked) { const kept = await keptUpload(env.DB, asked, same); if (kept) return kept; }
  // (an id that's another file's, never this one's: a new one, as for any upload)
  const id = asked && !(await env.DB.prepare('SELECT 1 AS x FROM board_files WHERE id = ?').bind(asked).first()) ? asked : uid('f_');
  let name = String(file.name || 'file').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 200) || 'file';
  const ext = EXT_OF[type];
  // (a signed copy: a photo of the page named .pdf is kept as the .jpg it is)
  if (ownerType === 'signed' && ext && !name.toLowerCase().endsWith(ext) && !(ext === '.jpg' && /\.jpeg$/i.test(name))) name = `${name.replace(/\.[a-z0-9]{2,5}$/i, '')}${ext}`;
  // (the page's id may come twice at once: each try's bytes under a key of their own, so one that loses never takes the other's)
  const key = `board/${ownerType}/${ownerId}/${id}-${id === asked ? `${uid('u')}-` : ''}${safeName(name)}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  const fileKind = (ownerType === 'meeting' || ownerType === 'advisory-meeting' ? FILE_KINDS.map((k) => k.id) : ['other']).includes(kind) ? kind : 'other';
  const at = nowIso();
  const row = [id, ownerType, ownerId, key, name, type, bytes.byteLength, fileKind, staffOnly ? 1 : 0, at, by, slug, sha256, originalId];
  const out = { id, name, type, size: bytes.byteLength, kind: fileKind, staffOnly: !!staffOnly, at, sha256 };
  // (`stage`: the bytes are kept, and its row is the caller's to write in the same step as what names it, as `insert`
  // ({ sql ending in a WHERE, bind }: ./_board.js patchTogether); `drop` takes the bytes back should that step not land.
  // ./_board-notes.js sendNotes, Board QA round 11)
  if (stage) {
    await stateReady(env.DB);
    return { ...out, insert: { sql: 'INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by, slug, sha256, original_id) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE 1', bind: row }, drop: () => dropStaged(env, key) };
  }
  // (its row didn't go in: its bytes go back, never bytes nothing names. Board QA round 12. In, with its answer lost on
  // the way back: in. The same page's id kept a moment ago by the same press sent twice at once: that one. Round 13)
  try {
    await env.DB.prepare('INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by, slug, sha256, original_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(...row).run();
  } catch (err) {
    let looked = true;
    const there = await env.DB.prepare('SELECT r2_key FROM board_files WHERE id = ?').bind(id).first().catch(() => { looked = false; return null; });
    if (there?.r2_key === key) return out;
    await dropStaged(env, key);
    const kept = there && id === asked ? await keptUpload(env.DB, asked, same).catch(() => null) : null;
    if (kept) return kept;
    throw looked ? notThere(err) : err;
  }
  return out;
}
/** A page's own id for a file it chose (../../public/admin/board-ui.js upload): "f_" and the page's random letters */
const PAGE_FILE_ID = /^f_[a-z0-9]{8,32}$/;
/**
 * The file a page's id already names, as putFile answers (`again`: kept before), when it's the same upload: the same
 * owner, sent by the same person, the same bytes. Anything else isn't this upload's (null)
 */
async function keptUpload(DB, id, { ownerType, ownerId, by, sha256 }) {
  const r = await DB.prepare('SELECT * FROM board_files WHERE id = ?').bind(id).first();
  if (!r || r.owner_type !== ownerType || r.owner_id !== ownerId || String(r.by || '').toLowerCase() !== String(by || '').toLowerCase() || (r.sha256 && r.sha256 !== sha256)) return null;
  return { id: r.id, name: r.name, type: r.type, size: r.size, kind: r.kind, staffOnly: !!r.staff_only, at: r.at, sha256: r.sha256, again: true };
}

/**
 * A file put on a meeting in one step with what names it (an agenda item): its bytes kept first (putFile's stage), then
 * ONE write, `withRow(also, file)`: the meeting's own write over the copy it read, with `also` (the file's row) in the
 * same step. Should that not land, the bytes go back and nothing was stored, so pressing again never keeps a second
 * copy (Board QA round 12: the row went in, the item's write failed, and the press again kept the file twice). Board's
 * meetings (attachToItem) and the Advisory Board's (./_advisory-meetings.js upload) → { file, ...withRow's answer }
 */
export async function putFileWith(env, opts, withRow) {
  const { insert, drop, ...file } = await putFile(env, { ...opts, stage: true });
  // (the page's id for it already kept: that file, on what names it, never a second copy. Board QA round 13)
  if (file.again) return { file, ...(await withRow([], file)) };
  try {
    return { file, ...(await withRow([insert], file)) };
  } catch (err) {
    await drop();
    // (the same page's id kept meanwhile, by the same press sent twice at once: that one)
    const kept = file.id === opts.fileId && !err?.status ? await keptUpload(env.DB, file.id, { ownerType: opts.ownerType, ownerId: opts.ownerId, by: opts.by || '', sha256: file.sha256 }).catch(() => null) : null;
    if (kept) return { file: kept, ...(await withRow([], kept)) };
    throw err;
  }
}
/** A meeting with a file on none of its agenda items */
const offItems = (m, fileId) => ({ ...m, sections: m.sections.map((s) => ({ ...s, items: s.items.map((it) => ((it.docs || []).includes(fileId) ? { ...it, docs: it.docs.filter((d) => d !== fileId) } : it)) })) });
const onAnItem = (m, fileId) => (m?.sections || []).some((s) => s.items.some((it) => (it.docs || []).includes(fileId)));

export async function updateFile(DB, id, { kind, staffOnly, name } = {}) {
  await ensureSchema(DB);
  const row = await DB.prepare('SELECT * FROM board_files WHERE id = ?').bind(id).first();
  if (!row) throw Object.assign(new Error('That file is gone'), { status: 404 });
  const next = {
    kind: kind !== undefined && FILE_KINDS.some((k) => k.id === kind) ? kind : row.kind,
    staff: staffOnly !== undefined ? (staffOnly ? 1 : 0) : row.staff_only,
    name: name !== undefined && String(name).trim() ? String(name).replace(/[\u0000-\u001F]/g, '').trim().slice(0, 200) : row.name,
  };
  // (its answer lost: changed if the row says so now. Board QA round 14)
  await landedOr(() => DB.prepare('UPDATE board_files SET kind = ?, staff_only = ?, name = ? WHERE id = ?').bind(next.kind, next.staff, next.name, id).run(),
    async () => { const r = await DB.prepare('SELECT kind, staff_only, name FROM board_files WHERE id = ?').bind(id).first(); return !!r && r.kind === next.kind && Number(r.staff_only) === Number(next.staff) && r.name === next.name; });
  if (next.staff && row.owner_type === 'doc') await closeToAdvisors(DB, row.owner_id);
  return { id, kind: next.kind, staffOnly: !!next.staff, name: next.name };
}

/**
 * A file deleted: its row (and approved minutes' record of it) and its places on its meeting's agenda in one step first,
 * then its bytes (fileOff, bytesOff). A step that fails leaves the file as it was, on its items; bytes whose delete
 * fails after it are the heartbeat's, never a row naming bytes that are gone, nor an item naming a file that is (Board
 * QA round 12, Nov 23 2026: a press again said "That file is gone" of a file still on its item). A Board meeting's file
 * comes off its items in the meeting's own write (patchTogether); `withMeeting(also, row)`: another meeting's write with
 * `also` in the same step (the Advisory Board's, ./_advisory-meetings.js). → withMeeting's answer, or whether there was one
 */
export async function deleteFile(env, id, { withMeeting = null } = {}) {
  const row = await fileRowOf(env.DB, id);
  if (!row) return false;
  await stateReady(env.DB);
  const also = fileOff(id, row);
  let out = true;
  // (its row gone: the step landed, its answer lost on the way back. Board QA round 13)
  const gone = async () => !(await fileRowOf(env.DB, id));
  if (withMeeting) out = await withMeeting(also, row);
  else if (row.owner_type === 'meeting') {
    await patchTogether(env.DB, [row.owner_id], ([cur]) => {
      const off = takeFileOff(cur, id, row);
      return { writes: off.next ? [[cur, off.next]] : [], also: off.also };
    }, { landed: gone });
  } else {
    try { await env.DB.batch(also.map((s) => env.DB.prepare(s.sql).bind(...s.bind))); } catch (err) {
      let looked = true;
      if (!(await gone().catch(() => { looked = false; return false; }))) throw looked ? notThere(err) : err;
    }
  }
  await bytesOff(env, [row.r2_key]);
  return out ?? true;
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
    // (the banks' record not read is thrown, never taken for no bank connected: a total of Mercury's alone, or none,
    // said as SOARD's cash. Board QA round 15: a packet locked the numbers a read that failed left)
    bankBalances(env.DB),
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
  let value;
  try {
    // (the kids' and projects' pages read whole or not at all: a failed read never names every makeover "a family".
    // Board QA round 12)
    const [jobs, kids, projects] = await Promise.all([fetchJobs(env.JOBTREAD_GRANT_KEY, fetchImpl), loadKids(env.DB), loadProjects(env.DB, { drafts: true })]);
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
    value = { byStatus, building, waiting, open };
  } catch (err) {
    // (the last copy when there is one; with none, the read failed: thrown, never said as no makeovers)
    console.error('[board] projects', err.message);
    if (cached.value) return cached.value;
    throw err;
  }
  // (a copy not kept is read again next time: what was read stands)
  await notWork(() => writeState(env.DB, 'projects', { at: new Date(now).toISOString(), value })).catch((err) => console.error('[board] keeping the projects copy', err?.message || err));
  return value;
}

/**
 * Kids served and rooms built, the way the site counts them (src/utils/stats.ts): finished makeovers only (one in
 * build or awaiting funding isn't served or built yet). The community projects' own figures aren't added up: they're
 * yearly rates, families and clients, not one count of children (Nov 21 2026)
 */
async function impact(DB) {
  // (a table not made yet is none; any other failure is thrown, never counted as no kids served: Board QA round 12)
  const read = async (table) => { try { return ((await DB.prepare(`SELECT slug, data FROM ${table}`).all()).results || []).map((r) => ({ slug: r.slug, ...parse(r.data) })).filter((d) => d.publishStatus !== 'draft'); } catch (err) { if (/no such table/i.test(String(err?.message || err))) return []; throw err; } };
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
  // (no events table is none; a read that failed is thrown, never said as nothing on the calendar: Board QA round 12)
  try { rows = ((await DB.prepare('SELECT slug, data FROM events').all()).results || []).map((r) => ({ slug: r.slug, ...parse(r.data) })); } catch (err) { if (/no such table/i.test(String(err?.message || err))) return { upcoming: [], recent: [] }; throw err; }
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
  let value;
  try {
    value = (await financeSource(env, { now })) || null;
  } catch (err) {
    // (the last copy when there is one; with none, the read failed: thrown, never said as no record. Board QA round 12)
    console.error('[board] finance', err.message);
    if (c.value) return c.value;
    throw err;
  }
  // (a copy not kept is read again next time: what was read stands, never dropped for it. Board QA round 12: a failed
  // write of the copy answered the board page with no money at all)
  await notWork(() => writeState(env.DB, 'finance', { at: new Date(now).toISOString(), value })).catch((err) => console.error('[board] keeping the finance copy', err?.message || err));
  return value;
}

/**
 * Each of today's numbers' reads by what it is (liveNumbers `notRead`), as an answer names one it couldn't read: a press
 * that needs them all (takeSnapshot) and the SOARD connection (./_mcp/money.js soard_numbers). A part of the board page
 * (`unread`) can be more than one of them: the money is the cash, Mercury's record and the books; what makeovers cost,
 * JobTread's figures and the operating balance; the makeovers, JobTread's projects and the reveals
 */
export const NUMBERS_READS = {
  cash: 'the bank balances',
  finance: 'Mercury’s record of money in and out',
  books: 'the year’s books from QuickBooks',
  projects: 'the makeovers in JobTread',
  reveals: 'the reveals',
  events: 'the events',
  meetings: 'the board’s meetings',
  kids: 'the kids served',
  costs: 'the makeover costs',
  operating: 'the operating balance kept to run SOARD',
};
/** "a", "a and b", "a, b and c" */
const andWords = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] || '');
/** What of today's numbers couldn't be read just now, in words (`notRead`: liveNumbers'), in NUMBERS_READS' order */
export const notReadWords = (notRead) => andWords(Object.keys(NUMBERS_READS).filter((k) => notRead?.[k]).map((k) => NUMBERS_READS[k]));

/**
 * Everything an agenda's live items show, as of now. A read whose connection isn't set up at all answers none (null,
 * or an empty list), and is never a failure: cashNow with neither Mercury's token nor a bank connected in Settings,
 * projectsNow and makeoverCostsNow with no JobTread key and no copy kept, booksNow with QuickBooks not connected,
 * boardFinanceNow before Mercury's record is there, no events or kids table. A read that fails throws (each falls back
 * on its last good copy first, said with when it was read), and only a throw is marked (`lost`): so none is never a
 * failure, and a failure is never none. `reads`: each read that failed by what it is too (`notRead`, NUMBERS_READS), for
 * an answer that names the figure it couldn't read; the board page goes by the parts (`unread`) alone
 */
export async function liveNumbers(env, { fetchImpl = fetch, now = Date.now(), reads = false } = {}) {
  const today = todayEastern(now);
  // A read that fails marks its part (`unread`), never a part drawn empty or as zero: the board page says that part
  // couldn't load just now (public/admin/board/unread.js). Each read marks the part it's read for, by its own name, never
  // a bigger part beside it, nor a name the page's own read has (portalData merges these flags with its own): the money
  // is the cash, the books and Mercury's record; what makeovers cost (`costs`) is JobTread's figures and the operating
  // balance kept to run SOARD, its only user; the makeovers are JobTread's projects and the reveals; the kids, those
  // served; the events, the calendar's; the meetings on the calendar (`meetingDates`), an agenda item's list of the
  // meetings ahead and the screen's year of them. Board QA round 12 (the privacy tester's sweep: each statement failing
  // once in turn drew "0 kids served", no makeovers and no money as facts); round 15 (Nov 26 2026: this list of the
  // meetings failing said every meeting couldn't load, under a full list, and hid every meeting's file on Documents; the
  // operating balance's setting failing hid all the money)
  const unread = {};
  const notRead = {};
  // (`part`: the board page's, ./unread.js; `read`: which of NUMBERS_READS it was)
  const lost = (part, read, fallback = null) => (err) => { console.error(`[board] ${read}`, err?.message || err); unread[part] = true; notRead[read] = true; return fallback; };
  const [cash, projects, reveals, events, meetings, kids, finance, pages, books, costs, settings] = await Promise.all([
    cachedCash(env, { fetchImpl, now }).catch(lost('money', 'cash')),
    projectsNow(env, { fetchImpl, now }).catch(lost('projects', 'projects')),
    cachedReveals(env, now).then((r) => { if (r?.unread) { unread.projects = true; notRead.reveals = true; } return r; }, lost('projects', 'reveals', { upcoming: [], past: [] })),
    eventsList(env.DB, today).catch(lost('events', 'events', { upcoming: [], recent: [] })),
    // (the meetings ahead and the year's, an item's live list: not read, its part says so, Board QA round 13; that list's
    // own part, never the page's meetings, which are read apart and drawn whole: round 15)
    listMeetings(env.DB).catch((e) => { if (e?.setup) throw e; return lost('meetingDates', 'meetings', [])(e); }),
    impact(env.DB).catch(lost('kids', 'kids')),
    boardFinanceNow(env, { now }).catch(lost('money', 'finance')),
    loadKids(env.DB).catch(() => []),
    // The year's revenue and expenses so far, as QuickBooks last answered (Settings → QuickBooks)
    booksNow(env.DB, { now }).catch(lost('money', 'books')),
    // What finished makeovers cost, and the families waiting on the money (./_makeover-costs.js)
    // (the heartbeat's copy: a page never waits on JobTread for it)
    makeoverCostsNow(env, { fetchImpl, now, maxAge: PAGE_MAX_AGE_MS }).catch(lost('costs', 'costs')),
    // (the operating balance kept to run SOARD: What makeovers cost rests on it, and nothing else does. Not read, it's
    // none (null), never SOARD's default in its place: Board QA round 15, the SOARD connection said the default
    // $500,000 as the operating balance when the settings couldn't be read)
    readSettings(env.DB).catch(lost('costs', 'operating')),
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
    // (read: the one Board's settings keep, else SOARD's default, `set` false; not read: none)
    operating: settings ? operatingIn(settings) : null,
    unread,
    ...(reads ? { notRead } : {}),
  };
}
/** The operating balance as Board's settings keep it: theirs (`set`), else SOARD's default, which the board page goes by until one is set */
const operatingIn = (s) => (Number(s?.operatingBalance) > 0 ? { balance: Math.round(Number(s.operatingBalance)), set: true } : { balance: OPERATING_BALANCE, set: false });

/** Read the cash now and keep it as the board page's copy (System → Settings calls this when a bank is connected, read or disconnected) */
export async function saveCashNow(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const value = await cashNow(env, { fetchImpl });
  await writeState(env.DB, 'cash', { at: new Date(now).toISOString(), value });
  return value;
}

async function cachedCash(env, { fetchImpl, now }) {
  const c = await readState(env.DB, 'cash');
  if (c.at && now - Date.parse(c.at) < 60 * 60 * 1000) return c.value || null;
  let value;
  try {
    value = await cashNow(env, { fetchImpl });
  } catch (err) {
    // (the last copy when there is one; with none, the read failed: thrown, never said as no bank connected)
    console.error('[board] cash', err.message);
    if (c.value) return c.value;
    throw err;
  }
  // (a copy not kept is read again next time: the banks' answer stands, never dropped for it. Board QA round 12)
  await notWork(() => writeState(env.DB, 'cash', { at: new Date(now).toISOString(), value })).catch((err) => console.error('[board] keeping the cash copy', err?.message || err));
  return value;
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
 * snapshot is put onto the meeting as it is then (patchMeeting): what was saved meanwhile stays. It locks only numbers
 * that were read: any part it keeps not read just now (liveNumbers `unread`, each read named by `notRead`) refuses it in
 * words that name what, and nothing is written; a part with no connection set up is none, and locked as none (Board QA
 * round 13: the meetings; round 15: every part, after the default operating balance was locked when the settings
 * couldn't be read)
 */
export async function takeSnapshot(env, id, { by, fetchImpl = fetch, now = Date.now() } = {}) {
  const m = await getMeeting(env.DB, id);
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  const n = await liveNumbers(env, { fetchImpl, now, reads: true });
  if (Object.values(n.unread || {}).some(Boolean)) throw Object.assign(new Error(`We couldn’t read ${notReadWords(n.notRead) || 'today’s numbers'} just now, so nothing was changed. Please try again in a moment.`), { status: 503, unread: true });
  const snapshot = { at: n.at, by: by || '', cash: n.cash, mercury: n.mercury, finance: n.finance, books: n.books, projects: n.projects, reveals: n.reveals, pastReveals: n.pastReveals, events: n.events, recentEvents: n.recentEvents, meetings: n.meetings.filter((x) => x.id !== id), thisYear: n.thisYear || [], impact: n.impact, costs: n.costs, operating: n.operating };
  // (the server's own field, from the numbers, never from the meeting: one write, never lost to an edit saved meanwhile)
  const saved = await setOnMeeting(env.DB, id, { snapshot }, { by, was: m });
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
    // (`email`: whose approval it is, so Board's page says "You approved it already" to the founder who did, in another
    // tab, never their own name. Board QA round 12)
    const rows = (await DB.prepare("SELECT meeting_id, name, email, in_at FROM board_asks WHERE kind = 'chair' AND status = 'approved'").all()).results || [];
    return Object.fromEntries(rows.map((r) => [r.meeting_id, { by: r.name || '', at: r.in_at || '', email: normEmail(r.email || '') }]));
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
/** The kinds whose words look ahead (come to it, read before it): never once the meeting is held (heldNoSend) */
const SEND_AHEAD = new Set(['packet', 'remind']);
/** No answer from Resend (a timeout, a dropped connection, a gateway's 502, 503 or 504): it may have gone */
const noAnswer = (e) => !/^Resend \d+:/.test(String(e)) || /^Resend 50[234]:/.test(String(e));
const agoWords = (ms) => { const n = Math.floor(ms / 60000); return n < 1 ? 'a moment ago' : n === 1 ? 'a minute ago' : `${n} minutes ago`; };
/** When a send went, in words: "12 minutes ago" within the hour, else "on Nov 23 at 4:12 PM" (Eastern; its year when not this one's) */
export function sentWhen(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  if (now - t < 60 * 60 * 1000) return agoWords(now - t);
  const tz = 'America/New_York';
  const year = (x) => new Date(x).toLocaleDateString('en-US', { year: 'numeric', timeZone: tz });
  const day = new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year(t) === year(now) ? {} : { year: 'numeric' }), timeZone: tz });
  const clockAt = new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(/\s+/g, ' ');
  return `on ${day} at ${clockAt}`;
}
/** A meeting Board keeps off the board page (notBoard), shared or not: an email to the board about it would open nothing */
const OFF_PAGE = 'This meeting is kept off the board page (it isn’t a board meeting), so an email about it would open nothing for the board.';
/** What an admin is told when Resend didn't answer a send to the board */
export const UNSURE_SEND = 'Resend didn’t answer, so these emails may have gone. Press it again: Resend sends each one only if it hasn’t already.';
/** What an admin is told when the emails went and the site's record of them couldn't be written: shown once the site has it */
export const NOTED_LATER = 'The site couldn’t note it just now; it does by itself within a few minutes, and this page shows it then. It won’t go to them again.';

/** The admin who sent it, by first name ('' for none, or the agenda's approval: `by` 'Board') */
async function senderFirst(DB, by) {
  if (!by || by === 'Board') return '';
  return firstName(staffFor(await roster(DB), by)?.name || '') || String(by).split('@')[0];
}

/** What a send of each kind keeps on its meeting once it has gone (the page's "Board emailed …"), from its own record */
const SEND_NOTES = {
  packet: ({ at, reached }) => ({ packetSentAt: at, packetSentTo: reached }),
  minutes: ({ at }) => ({ minutesSentAt: at }),
  // (who was reminded is the send's record itself: remindedOf)
  remind: null,
};
/** The meeting's own time of a send, as SEND_NOTES keeps it ('' for none) */
const notedAt = (kind, m) => (kind === 'packet' ? m?.packetSentAt : kind === 'minutes' ? m?.minutesSentAt : '') || '';
/** The last time a send's record has anyone having it, and how many of `emails` (all of them: none given) have */
const lastHad = (had, emails = null) => {
  const list = Object.entries(had || {}).filter(([e, t]) => (!emails || emails.has(e)) && Number.isFinite(Date.parse(t)));
  return { at: list.map(([, t]) => String(t)).sort().at(-1) || '', n: list.length };
};

/**
 * The send's record, and what it keeps on its meeting (SEND_NOTES), written together in one step: both land or neither.
 * Tried three times (a database that didn't answer for a moment); → whether it was written. Never throws: by now the
 * emails have gone, or Resend said no
 */
async function noteSend(DB, { key, record, id, fields }) {
  const stmts = [DB.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(key, JSON.stringify(record), nowIso())];
  if (fields) {
    const now = nowIso();
    await saveHistoryOf(DB, id, { now });
    stmts.push(onMeetingStmt(DB, id, fields, { now }));
  }
  for (let i = 0; i < 3; i++) {
    try {
      await DB.batch(stmts);
      return true;
    } catch (err) {
      console.error('[board] noting a send', key, err?.message || err);
      if (i < 2) await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
  return false;
}

/**
 * A board email (the packet, the minutes notice, the reminder: `kind`) to `people` ([{ email, name, slug }]), each
 * their own (`itemFor(person)` → { to, subject, html, text }), sent once whatever presses it:
 *   - one send at a time per meeting and kind: another (a double press, a second tab, the other admin, the agenda's
 *     approval) is told it's going out (409), and a send that never finished lets the next go after two minutes
 *   - who it goes to, and under which number, kept before Resend is asked (board_state `board-send:<kind>:<meeting>`):
 *     a send cut off midway counts as gone. Once Resend has answered, that record and what the send keeps on its
 *     meeting (packetSentAt, packetSentTo, minutesSentAt: SEND_NOTES) are written together in one step, tried three
 *     times; when even that can't be written, the emails went and the answer says so (`unrecorded`), and the record
 *     kept before they went still says who has it, so nobody gets it again; the heartbeat puts it on the meeting
 *     (settleSends). Board QA round 12, Nov 23 2026: the emails went, the meeting's "emailed" write failed once, the
 *     founder was told they "may have gone", the page kept offering the send, and ten minutes on the board had it twice
 *   - a member who has had it gets it again only when the press knew they had (`seen`: the time of the last send the
 *     page showed, as its "Email again" or "Ask again" says), and never within ten minutes of the last; a press that
 *     didn't know (a tab that never heard it went, the agenda's approval, a request made again) sends it only to who
 *     has never had it, at any time after, and is told when it went (409 `already`)
 *   - each send has its own number, and its Resend calls carry it as their idempotency key; a send Resend never
 *     answered, or one cut off after its record was kept, is asked for again with the same number (to the same
 *     people) within the day, so Resend sends each only if it didn't
 * → { sent, failed, errors, unsure, reached: how many of `people` have had it, skipped: [names had it], unrecorded? }
 */
async function sendOnce(env, { kind, m, by = '', people, itemFor, tags, replyTo, seen = '', now = Date.now() }) {
  const DB = env.DB;
  // (one that looks ahead, the packet and the reminder, never once the meeting is held, from the read made at the press:
  // board-shared.js heldNoSend, the one check every such send makes. Board QA round 12)
  const held = SEND_AHEAD.has(kind) ? heldNoSend(m, now) : '';
  if (held) throw Object.assign(new Error(held), { status: 409, extra: { held: true } });
  const key = `board-send:${kind}:${m.id}`;
  const hold = `${key}:sending`;
  await readState(DB, key); // (makes the table)
  const at = new Date(now).toISOString();
  // (the press's own token in its claim: written with its answer lost, it's this press's, and the send goes on. Round 14)
  const token = claimToken();
  const claimed = await claimOwn(() => DB.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE board_state.updated_at < ?')
    .bind(hold, JSON.stringify({ by, claim: token }), at, new Date(now - SEND_HOLD_MS).toISOString()).run(),
  async () => parse((await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(hold).first())?.data, {}).claim === token);
  // (whoever pressed it, by name: "you" when it's the one pressing now, in another tab. QA round 6, Nov 21 2026: Jane
  // was told "(Jane sent it)" as if someone else had)
  const mine = (e) => !!by && !!e && e !== 'Board' && normEmail(e) === normEmail(by);
  if (!claimed) {
    // (the hold and the send's record from one moment: a send that finished and whose hold didn't come off is said as
    // gone, never as going out. Board QA round 12)
    const rows = (await DB.prepare('SELECT key, data, updated_at FROM board_state WHERE key IN (?, ?)').bind(hold, key).all()).results || [];
    const held = rows.find((x) => x.key === hold);
    const rec = parse(rows.find((x) => x.key === key)?.data, {});
    const other = parse(held?.data, {}).by;
    const name = await senderFirst(DB, other);
    const last = lastHad(rec.had).at;
    if (!rec.sending && last && held && last >= String(held.updated_at || '')) {
      if (mine(other)) throw Object.assign(new Error(`You sent this email to ${SEND_TO[kind]} ${agoWords(now - Date.parse(last))}, maybe in another tab, so it didn’t go again. It can go again 10 minutes after the last one.`), { status: 409, extra: { already: true } });
      throw Object.assign(new Error(`This email went to ${SEND_TO[kind]} ${agoWords(now - Date.parse(last))}${other === 'Board' ? ' when its agenda was approved' : name ? ` (${name} sent it)` : ''}, so it didn’t go again. It can go again 10 minutes after the last one.`), { status: 409, extra: { already: true } });
    }
    // (`lookAgain`: what it keeps on its meeting is written once it has gone, so the page looks again by itself until it
    // shows it sent, with its "again" press. Board QA round 12: that tab said "Not yet" for good)
    const going = { sending: true, ...(SEND_NOTES[kind] ? { lookAgain: true } : {}) };
    if (mine(other)) throw Object.assign(new Error(`You’re sending this email to ${SEND_TO[kind]} right now, maybe in another tab. It goes once, so there’s nothing to press.`), { status: 409, extra: going });
    const who = other === 'Board' ? ': the agenda’s approval is sending it' : name ? ` (${name} is sending it)` : '';
    throw Object.assign(new Error(`This email is going out to ${SEND_TO[kind]} right now${who}. It goes once, so there’s nothing to press.`), { status: 409, extra: going });
  }
  try {
    const was = await readState(DB, key);
    // Who has had it, and when: kept for good (never "had it two days ago, so it goes again")
    const had = Object.fromEntries(Object.entries(was.had || {}).map(([e, t]) => [normEmail(e), String(t || '')]).filter(([e, t]) => isEmail(e) && Number.isFinite(Date.parse(t))));
    const byEmail = new Map(people.filter((p) => isEmail(p.email)).map((p) => [normEmail(p.email), p]));
    const note = SEND_NOTES[kind];
    // A send Resend never answered, or one cut off after its record was kept, asked for again: the same people under the
    // same number (Resend sends each only if it didn't)
    const again = (was.unsure || was.sending) && Number(was.n) > 0 && now - Date.parse(was.at) < SEND_REPLAY_MS ? (was.to || []).map((e) => byEmail.get(normEmail(e))).filter(Boolean) : [];
    const replay = again.length > 0;
    let recipients = again;
    let skipped = [];
    if (!replay) {
      const knew = String(seen || '');
      // (had it, and the press didn't know: the page that pressed never showed this one)
      const unknown = (e) => !!had[e] && !(knew && had[e] <= knew);
      const recent = (e) => !!had[e] && now - Date.parse(had[e]) < SEND_AGAIN_MS;
      const kept = [...byEmail.entries()].filter(([e]) => unknown(e) || recent(e));
      recipients = [...byEmail.entries()].filter(([e]) => !unknown(e) && !recent(e)).map(([, p]) => p);
      skipped = kept.map(([, p]) => p.name);
      if (!recipients.length && kept.length) {
        const last = lastHad(had, new Set(kept.map(([e]) => e)));
        // Gone, and the meeting doesn't say so yet (its own write didn't land when it went): it does now, from this
        // record, so the page shows it (never in the way of the answer)
        if (note && notedAt(kind, m) < last.at) await noteSend(DB, { key, record: was, id: m.id, fields: note({ at: last.at, reached: lastHad(had, new Set(byEmail.keys())).n }) });
        const name = await senderFirst(DB, was.by);
        const soon = kept.every(([e]) => recent(e));
        const lastMs = Date.parse(last.at);
        if (soon) {
          if (mine(was.by)) throw Object.assign(new Error(`You sent this email to ${SEND_TO[kind]} ${agoWords(now - lastMs)}, maybe in another tab, so it didn’t go again. It can go again 10 minutes after the last one.`), { status: 409, extra: { already: true } });
          const who = was.by === 'Board' ? ' when its agenda was approved' : name ? ` (${name} sent it)` : '';
          throw Object.assign(new Error(`This email went to ${SEND_TO[kind]} ${agoWords(now - lastMs)}${who}, so it didn’t go again. It can go again 10 minutes after the last one.`), { status: 409, extra: { already: true } });
        }
        // (a press that didn't know it went: never a second copy, at any time after. Board QA round 12)
        const when = sentWhen(last.at, now);
        const verb = kind === 'remind' ? 'asked' : 'emailed';
        const what = kind === 'remind' ? SEND_TO[kind] : `${SEND_TO[kind]} this`;
        if (mine(was.by)) throw Object.assign(new Error(`You ${verb} ${what} ${when}. It goes once, so there’s nothing to press.`), { status: 409, extra: { already: true, sentAt: last.at } });
        const who = was.by === 'Board' ? `${kind === 'remind' ? 'Board' : 'The agenda’s approval'} ${verb}` : name ? `${name} ${verb}` : `Someone ${verb}`;
        throw Object.assign(new Error(`${who} ${what} ${when}. It goes once, so there’s nothing to press.`), { status: 409, extra: { already: true, sentAt: last.at } });
      }
    }
    if (!recipients.length) return { sent: 0, failed: 0, errors: [], reached: 0, skipped };
    const n = replay ? Number(was.n) : (Number(was.n) || 0) + 1;
    const emails = recipients.map((p) => normEmail(p.email));
    // (every email made before anything is kept: one that can't be made sends nothing, and keeps nothing)
    const items = recipients.map(itemFor);
    // Kept before it goes: a send cut off midway (the page closed, the Worker stopped, no answer) counts as gone, and is
    // asked for again under its number (`sending`: Resend's answer not noted yet)
    const record = { n, at, by, to: emails, sending: true, had: { ...had, ...Object.fromEntries(emails.map((e) => [e, replay ? had[e] || at : at])) } };
    // (this send's own marker: written with its answer lost, it's there as this send's, and the send goes on, never
    // "nothing was sent" over a record that says it's going. Board QA round 14)
    const kept = JSON.stringify(record);
    await landedOr(() => DB.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(key, kept, nowIso()).run(),
      async () => (await DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(key).first())?.data === kept);
    try {
      const r = await sendEmailItems(env, items, { from: fromBoard(), tags, replyTo, idempotencyKey: `board-${kind}:${m.id}:${n}` });
      const unsure = r.failed > 0 && r.errors.some(noAnswer);
      const refused = new Set((r.refused || []).map(normEmail));
      // Resend's own no: nobody in that call has it. (Asked again under the same key, Resend would have answered with the
      // first try's success had that gone: its no means the first try didn't either.) They're as they were before it
      const after = { ...record.had };
      for (const e of refused) { if (!replay && had[e]) after[e] = had[e]; else delete after[e]; }
      const sent = r.sent + (r.already || 0);
      const reached = [...byEmail.keys()].filter((e) => after[e]).length;
      // The record, and the send's time on its meeting, in one step (SEND_NOTES): the page shows what Resend took
      const settled = { ...record, sending: undefined, had: after, unsure: unsure || undefined };
      const noted = await noteSend(DB, { key, record: settled, id: m.id, fields: note && sent ? note({ at, reached }) : null });
      return { sent, failed: r.failed, errors: r.errors, unsure: unsure || undefined, reached, skipped, ...(noted ? {} : { unrecorded: true }), ...(replay ? { replayed: String(was.at) } : {}) };
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
 * A board email whose Resend answer was never noted (its record still `sending` two minutes on: the Worker stopped, or
 * the database didn't answer when it went): what it keeps on its meeting written from the record kept before it went,
 * so the page shows it, as a send cut off midway counts as gone. Never sends anything (a press asks Resend again under
 * the same number). Never throws
 */
export async function settleSends(env, { now = Date.now() } = {}) {
  try {
    const rows = (await env.DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'board-send:%' AND key NOT LIKE '%:sending'").all()).results || [];
    for (const row of rows) {
      const [, kind, id] = String(row.key).split(':');
      const rec = parse(row.data, {});
      if (!SEND_NOTES[kind] || !rec.sending || !ID.test(String(id || '')) || now - Date.parse(rec.at) < SEND_HOLD_MS) continue;
      const m = await getMeeting(env.DB, id);
      const last = lastHad(rec.had);
      if (!m || !last.at || notedAt(kind, m) >= last.at) continue;
      await noteSend(env.DB, { key: row.key, record: rec, id, fields: SEND_NOTES[kind]({ at: last.at, reached: last.n }) });
    }
  } catch (err) {
    if (!/no such table/i.test(err?.message || '')) console.error('[board] settling sends', err?.message || err);
  }
}

/**
 * Email the board the link to the agenda and documents, what the documents are, and (to who hasn't answered it) the
 * calendar invite to answer (test: only `to`), once (sendOnce). What it keeps on the meeting is its own two fields,
 * written with the send's own record in one step (sendOnce, SEND_NOTES), onto the meeting as it is now: a report or an
 * edit saved while it was going out stays. `seen`: the last send the page showed (its Email again)
 */
export async function sendPacket(env, id, { by, to = null, replyTo = [], reads = null, seen = '' } = {}) {
  // (`reads.meeting`: the agenda's approval sending it, everything read before its approval was written: agendaReads)
  const m = reads?.meeting || await getMeeting(env.DB, id);
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  if (!emailConfigured(env)) throw Object.assign(new Error('Email isn’t set up (RESEND_API_KEY)'), { status: 503 });
  const test = Array.isArray(to);
  // (held: nothing asking the board to read ahead goes, checked before anything else is read. Board QA round 12)
  if (!test && heldNoSend(m)) throw Object.assign(new Error(heldNoSend(m)), { status: 409, extra: { held: true } });
  if (!test && !reads?.meeting) await holdUntilApproved(env.DB, m);
  if (!test && m.notBoard) throw Object.assign(new Error(OFF_PAGE), { status: 409 });
  if (!test && !m.shared) throw Object.assign(new Error('Share the meeting with the board first, so the button has something to open'), { status: 409 });
  // (`reads`: who gets it and who it's from, read before the approval that sends it: agendaReads)
  const people = test ? to.map((email) => ({ email, name: '' })) : reads?.people || await packetList(env.DB);
  if (!people.length) throw Object.assign(new Error('No board member has an email on file (People → Board)'), { status: 409 });
  const docs = packetDocs(m);
  // An email saying "read the agenda" with no agenda helps no one (Send me the email still shows how it would look).
  // The same test Board's Approve goes by, so an agenda that can be approved can always be sent
  if (!test && !agendaItems(m).length && !agendaParts(m).length && !docs.names.length && !docs.hidden) throw Object.assign(new Error('The agenda is empty: add to it before emailing the board'), { status: 409 });
  // Only someone on the invite who hasn't answered it is asked to
  const open = test ? [] : (reads ? reads.people.filter((p) => repliesOf(m)[p.slug] === 'invited') : await notAnswered(env, m)).map((p) => p.slug);
  const team = reads?.team || await roster(env.DB);
  const from = inviteFrom(m, team, reads?.settings || await getSettings(env.DB));
  // Each presenter's own copy asks for their report (a preview shows none: it's for no one in particular); the agenda names them
  const everyone = [...team.board, ...team.staff];
  // …and each member's, the papers they haven't signed this year (a preview shows them all)
  const signable = signablePapers(reads?.docs || await listDocs(env.DB));
  const year = signYear(m, test);
  const toSign = (p) => signable.filter((d) => !(p.slug && (d.signed[p.slug] || d.declined?.[p.slug])))
    .map((d) => ({ title: d.title, id: d.id, written: !!d.body, due: dueOn(d, year), changed: !!(p.slug && d.earlier?.includes(p.slug)) }));
  const minutes = minutesToRead(m, reads?.meetings || await listMeetings(env.DB));
  const itemFor = (p) => ({ to: p.email, ...packetEmail(m, { test, files: docs.names, private: docs.hidden, name: p.name, from, ask: test || open.includes(p.slug), reports: reportsFor(m, p.slug, everyone), toSign: toSign(p), minutes, people: everyone }) });
  const tags = [{ name: 'kind', value: test ? 'board-packet-preview' : 'board-packet' }];
  if (test) {
    const r = await sendEach(env, people.map(itemFor), { tags, replyTo });
    return { sent: r.sent, failed: r.failed, errors: r.errors, to, documents: docs.names.length + docs.hidden };
  }
  // (its record, and the time it went on the meeting as it is now, in one step: sendOnce)
  const r = await sendOnce(env, { kind: 'packet', m, by, people, itemFor, tags, replyTo, seen });
  return { sent: r.sent, failed: r.failed, errors: r.errors, unsure: r.unsure, ...(r.skipped.length ? { skipped: r.skipped } : {}), ...(r.unrecorded ? { unrecorded: true } : {}), ...(r.replayed ? { replayed: r.replayed } : {}), documents: docs.names.length + docs.hidden };
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

/**
 * Everything that decides who gets an approved agenda's email, and when, and what it says, read for certain
 * (./_board-asks.js chairApprove reads it before the approval is written, so People not answering refuses the approval
 * with nothing saved, never "approved, but its email didn't go": Board QA round 11, Nov 23 2026; and the papers and
 * meetings the email names too, so a read that fails refuses the approval, never leaves it approved and its email for
 * later: round 12). → { told, people, team, settings, docs, meetings }
 */
export async function agendaReads(env) {
  const [told, people, team, settings, docs, meetings] = await Promise.all([boardTold(env.DB), packetList(env.DB), roster(env.DB), getSettings(env.DB), listDocs(env.DB), listMeetings(env.DB)]);
  return { told, people, team, settings, docs, meetings };
}
/** An approved agenda's email claimed for one send (the approval's, or the heartbeat's): one a send left behind ten minutes on is taken again */
export const AGENDA_CLAIM_MS = 10 * 60 * 1000;
export const agendaClaimKey = (id) => `agenda-email:${id}`;
/** Whether an approved agenda goes to the board now (the approval sends it), as sendApprovedAgenda decides it */
export const agendaGoesNow = (m, told, now = Date.now()) => !!m && !m.practice && !m.notBoard && !m.packetSentAt && isDate(m.date) && !heldNoSend(m, now) && !!told;

export async function sendApprovedAgenda(env, id, { now = Date.now(), reads = null, meeting = null, claimed = false } = {}) {
  // (`meeting`: as the approval read it a moment ago, so whether it goes now or waits is decided on what was read before
  // the approval was written)
  const m = meeting || await getMeeting(env.DB, id);
  // (held, today's included: its agenda never goes. Board QA round 12)
  if (!m || m.practice || m.notBoard || m.packetSentAt || !isDate(m.date) || heldNoSend(m, now) || !emailConfigured(env)) return null;
  // (`reads`: agendaReads, made before the approval: nothing here reads People again)
  if (!(reads ? reads.told : await boardTold(env.DB))) return { waiting: 'sign-in' };
  // Once, even when the approval and the heartbeat reach it together (`claimed`: the approval took it with its own
  // write, and put the meeting on the board page with it). One a send left behind is taken again ten minutes on: the
  // send's own record (sendOnce) says who has it, so it never goes twice
  const key = agendaClaimKey(m.id);
  const at = new Date(now).toISOString();
  if (!claimed) {
    const token = claimToken();
    const claim = await claimOwn(() => env.DB.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE board_state.updated_at < ?')
      .bind(key, JSON.stringify({ at, claim: token }), at, new Date(now - AGENDA_CLAIM_MS).toISOString()).run(),
    async () => parse((await env.DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(key).first())?.data, {}).claim === token);
    if (!claim) return null;
  }
  try {
    if (!m.shared) await setOnMeeting(env.DB, m.id, { shared: true }, { by: 'Board', was: m });
    const r = await sendPacket(env, m.id, { by: 'Board', replyTo: reads ? reads.settings.admins : await boardAdmins(env.DB), reads: reads && reads.docs ? { ...reads, meeting: { ...m, shared: true } } : reads });
    // (none went: Resend said no to every one, or didn't answer, when asking again sends each only if it hasn't gone)
    if (!r.sent) throw Object.assign(new Error(r.errors?.[0] || 'No email went'), { status: 502, result: r });
    return r;
  } catch (err) {
    // Not sent: the heartbeat tries again (it finds the agenda emailed, when an admin's send of it is what was going out).
    // Never when it may have gone (an error after its emails: `went`) or the board had it a moment ago (an admin's send):
    // the claim stays, so the agenda never goes twice. (A claim that won't come off is taken again ten minutes on)
    if (!err.went && !err.extra?.already) await env.DB.prepare('DELETE FROM board_state WHERE key = ?').bind(key).run().catch((e) => console.error('[board] approved agenda claim', e?.message || e));
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
 * meeting goes by (public/admin/board-meeting.js), for a tab left open or a request made by hand. Minutes kept only as a
 * staff-only file (minutesStaffOnly) can be marked approved, as ever, but the board is never told they're up: they can't
 * read them (`toBoard`, the minutes notice), said in words with what to do (Board QA round 14, Nov 24 2026), approved
 * or not (round 15, Nov 26 2026: once marked approved, all four were emailed "Read them" for minutes they couldn't read)
 */
export function minutesNotReady(m, today = todayEastern(), { toBoard = false } = {}) {
  if (!m) return 'That meeting is gone';
  if (!isDate(m.date) || (m.date > today && !m.live?.startedAt)) return 'This meeting hasn’t happened yet, so it has no minutes to approve or send.';
  const staff = minutesStaffOnly(m);
  if (staff) return toBoard ? staffOnlyWords(staff) : '';
  if (!minutesIn(m)) return 'This meeting’s minutes aren’t in Board yet. Drop them in first.';
  return '';
}

/**
 * The board approved a meeting's minutes (at a later meeting, on its date): only those two, on the meeting as it is.
 * `press`: a person asked (Board's approve-minutes), so only minutes there are, of a meeting held (minutesNotReady)
 */
export async function approveMinutes(env, id, opts) {
  // (a person's press stopped before its one step landed: nothing was approved, said in words, the same as Mark them
  // approved's and the approving send's. Board QA round 13)
  return approving(env, id, opts).catch((err) => { throw opts?.press && !err?.status ? readDown(MINUTES_NOT_APPROVED, err) : err; });
}
async function approving(env, id, { on, by, press = false }) {
  const gone = () => Object.assign(new Error('That meeting is gone'), { status: 404 });
  const { freshMinutesFile, AGAIN } = await import('./_board-notes.js');
  for (let tries = 1; ; tries++) {
    const was = await getMeeting(env.DB, String(id || ''));
    if (!was) throw gone();
    // Typed minutes are approved as a Word file that says what they say: their kept file brought up first, in the same
    // step, from the copy it approves (Board QA round 12, Nov 23 2026: approved as a file that kept words corrected since)
    const fresh = await freshMinutesFile(env, was);
    try {
      const r = await patchTogether(env.DB, [was.id], ([cur]) => {
        if (!cur) throw gone();
        const why = press ? minutesNotReady(cur) : '';
        if (why) throw Object.assign(new Error(why), { status: 409 });
        if (fresh && (cur.updatedAt || '') !== (was.updatedAt || '')) throw AGAIN;
        return { writes: [[cur, { ...cur, minutes: 'approved', approvedOn: isDate(on) ? on : todayEastern() }]], also: fresh?.also || [] };
      }, { by });
      await fresh?.done();
      return r.meetings[was.id];
    } catch (err) {
      await fresh?.drop();
      if (err === AGAIN && tries < 3) continue;
      throw err === AGAIN ? new Error(KEPT_CHANGING) : err;
    }
  }
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
export async function remindRsvp(env, id, { to = null, replyTo = [], by = '', seen = '' } = {}) {
  const m = await getMeeting(env.DB, id);
  if (m?.notBoard) throw Object.assign(new Error(OFF_PAGE), { status: 409 });
  if (!m?.shared) throw Object.assign(new Error('Share the meeting with the board first, so the button has something to open'), { status: 409 });
  const test = Array.isArray(to);
  // (held: nobody is asked whether they'll come. Board QA round 12)
  if (!test && heldNoSend(m)) throw Object.assign(new Error(heldNoSend(m)), { status: 409, extra: { held: true } });
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
  const r = test ? await sendEach(env, people.map(itemFor), { tags, replyTo }) : await sendOnce(env, { kind: 'remind', m, by, people, itemFor, tags, replyTo, seen });
  // (the meeting as the site has it now, with who was asked when: remindedOf, for the page's card. A read that fails once
  // they've gone is the page's to make again, `reread`, never an answer that says nothing went: Board QA round 11)
  const now = test ? null : await getMeeting(env.DB, id).catch((err) => { console.error('[board] reminder, reading the meeting back', err?.message || err); return undefined; });
  return { sent: r.sent, failed: r.failed, errors: r.errors, unsure: r.unsure, ...(r.skipped?.length ? { skipped: r.skipped } : {}), ...(r.unrecorded ? { unrecorded: true } : {}), ...(r.replayed ? { replayed: r.replayed } : {}), to: test ? to : undefined, notOnInvite: missing, ...(test ? {} : now === undefined ? { reread: true } : { meeting: now }) };
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
 * Tell the board the minutes are on the board page (test: only `to`), once (sendOnce); its sent time is written with the
 * send's own record in one step, onto the meeting as it is now, never over what was saved while it went. `seen`: the
 * last send the page showed
 */
export async function sendMinutesNotice(env, id, { to = null, replyTo = [], by = '', seen = '' } = {}) {
  const m = await getMeeting(env.DB, id);
  if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
  // (never "the minutes are up" before there are any the board can read, from a tab left open or a request made by hand)
  const why = minutesNotReady(m, todayEastern(), { toBoard: true });
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
  const r = await sendOnce(env, { kind: 'minutes', m, by, people, itemFor, tags, replyTo, seen });
  return { sent: r.sent, failed: r.failed, errors: r.errors, unsure: r.unsure, ...(r.skipped.length ? { skipped: r.skipped } : {}), ...(r.unrecorded ? { unrecorded: true } : {}), ...(r.replayed ? { replayed: r.replayed } : {}) };
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

/**
 * Whether the sign-in email holding its claim has finished: everyone on the claim has it marked at or after the claim,
 * and confirmed (Resend said it took it). A read that fails says no (it's said as going out, for two minutes at most)
 */
async function welcomeFinished(DB) {
  const rows = (await DB.prepare("SELECT key, data, updated_at FROM board_state WHERE key IN ('welcome', 'welcome-sending')").all().catch(() => null))?.results || [];
  const claim = rows.find((r) => r.key === 'welcome-sending');
  const to = parse(claim?.data, {}).to || [];
  const w = parse(rows.find((r) => r.key === 'welcome')?.data, {});
  return !!claim && to.length > 0 && to.every((slug) => String(w.members?.[slug] || '') >= String(claim.updated_at) && !(w.unconfirmed || []).includes(slug));
}
/** Email each active board member (on their own) how to sign in, from the admin sending it (`by`); test: only `to` */
export async function sendWelcome(env, opts = {}) {
  if (Array.isArray(opts.to)) return sendWelcomeNow(env, opts);
  // One send at a time: a second (another tab, the table during the panel's, a re-posted request) is turned away, and
  // the next finds who already has it. The claim lapses after two minutes if a send never finishes.
  await readState(env.DB, 'welcome');
  const now = nowIso();
  // (its own token: written with its answer lost, it's this press's. Board QA round 14)
  const token = claimToken();
  const got = await claimOwn(() => env.DB.prepare("INSERT INTO board_state (key, data, updated_at) VALUES ('welcome-sending', ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE board_state.updated_at < ?")
    .bind(JSON.stringify({ claim: token }), now, new Date(Date.parse(now) - 2 * 60 * 1000).toISOString()).run(),
  async () => parse((await env.DB.prepare("SELECT data FROM board_state WHERE key = 'welcome-sending'").first())?.data, {}).claim === token);
  if (!got) {
    // (a send that finished, whose claim didn't come off: said as gone, never as going out. Board QA round 12)
    if (await welcomeFinished(env.DB)) throw Object.assign(new Error('The sign-in email went a moment ago, so it didn’t go again. Board access shows who has it now.'), { status: 409, extra: { already: true } });
    throw Object.assign(new Error('Another sign-in email was going out at the same moment, so this one wasn’t sent. Board access shows who has it now.'), { status: 409 });
  }
  try {
    if (opts.check) await opts.check();
    return await sendWelcomeNow(env, opts);
  } finally {
    // (a claim that won't come off holds the next send two minutes at most, never this one's answer: by now its emails
    // may have gone. Board QA round 12)
    await env.DB.prepare("DELETE FROM board_state WHERE key = 'welcome-sending'").run().catch((err) => console.error('[board] sign-in email claim', err?.message || err));
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
  // members it went to, wherever their record is now (a People rename while it went moved their marks). Tried three
  // times; when even that can't be written, the emails went (or surely didn't) and the answer says so, never "Something
  // went wrong … then try again": the marks kept before they went still say who has it, so nobody gets it again, and
  // Members shows it as sent, not confirmed (Board QA round 12, Nov 23 2026)
  let unrecorded = false;
  if (!test && !unsure) {
    for (let i = 0; ; i++) {
      try { await settleWelcomeMarks(env.DB, { at: marked, recipients, was, went: !!r.sent }); break; } catch (err) {
        console.error('[board] a sign-in email send’s marks', err?.message || err);
        if (i >= 2) { unrecorded = true; break; }
        await new Promise((res) => setTimeout(res, 40 * (i + 1)));
      }
    }
  }
  return { sent: r.sent, ...(!test && r.sent && recipients.length !== items.length ? { reached: recipients.length } : {}), failed: r.failed, errors: r.errors, unsure: unsure || undefined, ...(unrecorded && r.sent ? { unrecorded: true } : {}), ...(unusable.length ? { unusable } : {}), ...(signedIn.length ? { signedIn } : {}), to: test ? to : undefined };
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
  if (Array.isArray(to)) return askToSignNow(env, { slugs, by, replyTo, to });
  // One ask at a time, whoever presses (two tabs, both founders, the whole board and one member's own ask), as the
  // board's other emails go (sendOnce): a second is told it's going out, and once it has, who had it in the last ten
  // minutes isn't asked again. Board QA round 11, Nov 23 2026: two tabs a moment apart emailed each member twice
  const at = new Date().toISOString();
  await readState(env.DB, SIGN_ASK_HOLD); // (makes the table)
  // (its own token: written with its answer lost, it's this press's. Board QA round 14)
  const token = claimToken();
  const claimed = await claimOwn(() => env.DB.prepare('INSERT INTO board_state (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE board_state.updated_at < ?')
    .bind(SIGN_ASK_HOLD, JSON.stringify({ by, claim: token }), at, new Date(Date.parse(at) - SEND_HOLD_MS).toISOString()).run(),
  async () => parse((await env.DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(SIGN_ASK_HOLD).first())?.data, {}).claim === token);
  if (!claimed) {
    const other = (await readState(env.DB, SIGN_ASK_HOLD)).by;
    // (`lookAgain`: who was asked is written once it has gone, so Members looks again by itself until it shows. Round 12)
    if (other && normEmail(other) === normEmail(by)) throw Object.assign(new Error('You’re asking the board to sign right now, maybe in another tab. It goes once, so there’s nothing to press.'), { status: 409, extra: { sending: true, lookAgain: true } });
    const name = await senderFirst(env.DB, other);
    throw Object.assign(new Error(`The email asking the board to sign is going out right now${name ? ` (${name} is sending it)` : ''}. It goes once, so there’s nothing to press.`), { status: 409, extra: { sending: true, lookAgain: true } });
  }
  try {
    return await askToSignNow(env, { slugs, by, replyTo, to: null });
  } finally {
    // (a hold that won't come off stops the next ask for two minutes at most, never this one's answer)
    await env.DB.prepare('DELETE FROM board_state WHERE key = ?').bind(SIGN_ASK_HOLD).run().catch((err) => console.error('[board] ask to sign, its hold', err?.message || err));
  }
}
/** The ask to sign that's going out now (askToSign's hold), and who had it when, kept before it goes (a send cut off counts) */
const SIGN_ASK_HOLD = 'board-send:sign-ask:sending';
const SIGN_ASK_HAD = 'board-send:sign-ask';
async function askToSignNow(env, { slugs, by, replyTo, to }) {
  const test = Array.isArray(to);
  const year = thisYear();
  const [board, people, settings, docs, asks, seen, was] = await Promise.all([
    activeBoard(env.DB), roster(env.DB), getSettings(env.DB), listDocs(env.DB), signAsks(env.DB, year),
    env.DB.prepare('SELECT slug FROM board_seen').all().then((r) => new Set((r.results || []).map((x) => x.slug))),
    test ? {} : readState(env.DB, SIGN_ASK_HAD),
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
  // Asked in the last ten minutes: by the ask's own record (Members' "asked"), or by what the last one kept before it went
  const now = Date.now();
  const had = Object.fromEntries(Object.entries(was.had || {}).filter(([, t]) => now - Date.parse(t) < SEND_AGAIN_MS));
  const lately = (p) => (asks[p.slug] && now - Date.parse(asks[p.slug].at) < SEND_AGAIN_MS) || !!had[normEmail(p.email)];
  const recent = left.filter((p) => isEmail(p.email) && lately(p));
  const recipients = left.filter((p) => isEmail(p.email) && !recent.includes(p));
  const base = { signed: picked.length - left.length, recent: recent.map((p) => p.name), noEmail };
  if (!recipients.length) return { sent: 0, failed: 0, errors: [], ...base };
  // Kept before it goes: one cut off midway (the page closed, the Worker stopped, no answer) counts as gone for ten minutes
  const at = new Date(now).toISOString();
  const keep = { at, by, had: { ...had, ...Object.fromEntries(recipients.map((p) => [normEmail(p.email), at])) } };
  // (this send's own marker: written with its answer lost, it's there as this send's and the send goes on. Round 14)
  const kept = JSON.stringify(keep);
  await landedOr(() => env.DB.prepare('INSERT OR REPLACE INTO board_state (key, data, updated_at) VALUES (?, ?, ?)').bind(SIGN_ASK_HAD, kept, nowIso()).run(),
    async () => (await env.DB.prepare('SELECT data FROM board_state WHERE key = ?').bind(SIGN_ASK_HAD).first())?.data === kept);
  const items = recipients.map((p) => ({ to: p.email, ...signAskEmail({ name: p.name, email: p.email, papers: papersOf(p.slug), from: sender?.name || '', firstTime: !seen.has(p.slug) }) }));
  const r = await sendEmailItems(env, items, { from: items[0].from, tags: [{ name: 'kind', value: 'board-sign-ask' }], replyTo });
  // Asked, once Resend took it, or when it may have (no answer is no sure no); Resend's own error is a sure no
  const unsure = r.failed > 0 && r.errors.some((e) => !/^Resend \d+:/.test(String(e)) || /^Resend 50[234]:/.test(String(e)));
  // (Resend's own no to all of them: nobody has it, and the record says so)
  if (!r.sent && !unsure) await writeState(env.DB, SIGN_ASK_HAD, { ...keep, had }).catch((err) => console.error('[board] ask to sign, putting its record back', err?.message || err));
  if (r.sent || unsure) {
    // (each ask in the chain too: about every paper they have to sign, so no one paper's)
    try {
      await appendEvents(env.DB, async () => ({
        stmts: recipients.map((p) => env.DB.prepare('INSERT INTO board_sign_asks (slug, year, at, by, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT(slug, year) DO UPDATE SET at = excluded.at, by = excluded.by, n = board_sign_asks.n + 1').bind(p.slug, year, at, String(by || '').slice(0, 200))),
        events: recipients.map((p) => ({ kind: 'asked', docId: null, slug: p.slug, year, at, by, detail: { to: p.email, papers: papersOf(p.slug).map((x) => x.id), unsure: unsure || undefined } })),
      }));
    } catch (err) {
      // The emails went and Members' record of them didn't (the database didn't answer): said as that, never "nothing
      // was sent" nor "try again". What was kept before they went stops them going again for ten minutes (Board QA round 11)
      console.error('[board] asked to sign, its record', err?.message || err);
      const n = r.sent || recipients.length;
      throw Object.assign(new Error(`The email went to ${plural(n, 'board member')}, but the site couldn’t note it on Members just now, so it doesn’t show them as asked. It won’t go to them again for ten minutes.`), { went: true, extra: { sent: r.sent, failed: r.failed, unrecorded: true } });
    }
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
  // (no site_config table is no document; a read that failed is thrown, for its caller to say so: Board QA round 12)
  try { return parse((await DB.prepare('SELECT data FROM site_config WHERE key = ?').bind(key).first())?.data, null); } catch (err) { if (/no such table/i.test(String(err?.message || err))) return null; throw err; }
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
  // Each read its own part, as the page's own read has them: the meetings or the papers not read just now leave their
  // files' words out and say so (`unread`), the page already saying that part couldn't load; the words' own reads not
  // answering are a 503 in words, never "Something went wrong … Reload the page to see what was saved" for a look
  // (Board QA round 14: with the meetings' read failing, ?words answered 500)
  const unread = {};
  const lost = (part, also) => (err) => { if (err?.setup) throw err; console.error(`[board] words: ${part}`, err?.message || err); unread[part] = true; return also; };
  const [meetings, docs, financials] = await Promise.all([listMeetings(env.DB).catch(lost('meetings', [])), listDocs(env.DB).catch(lost('docs', [])), siteDoc(env.DB, 'financials').catch(lost('sources', null))]);
  const ids = [
    ...meetings.map(boardCopy).filter(Boolean).flatMap((m) => m.files.map((f) => f.id)),
    ...docs.filter((d) => (d.shared || !member) && d.file && !d.file.staffOnly).map((d) => d.file.id),
  ];
  const { wordsFor, filingWordsFor, stillToRead } = await import('./_board-file-words.js');
  const down = (e) => { throw e?.setup || !dbFailed(e) ? e : readDown(WORDS_DOWN, e); };
  const [files, filings, reading] = await Promise.all([wordsFor(env.DB, ids), filingWordsFor(env.DB, filingsOf(financials).map((f) => f.url)), stillToRead(env.DB)]).catch(down);
  return { files, filings, reading, ...(Object.keys(unread).length ? { unread } : {}) };
}
/** The words inside the files not read just now (the page finds the files by their names, and says so) */
export const WORDS_DOWN = 'The words inside the files couldn’t load just now, so search finds the files by their names. Please try again in a moment.';

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
/**
 * Everything the board page shows, for a member (`member`) or an admin looking (`admin`). Every part of its read is its
 * own part: one that fails is marked in `unread` and the rest of the page opens (Board QA round 13: one failed read of
 * the month-end balances, the papers' words, the member's own files, the minutes' corrections or the signed minutes
 * answered the whole page with a 500). The meetings, the papers, the settings, the month-end balances, which files are
 * the member's own, the papers' words, their adopted mark and their signed copies each say so in their place
 * (../../public/admin/board/unread.js). `meetingsRead`: the meetings' read when the caller has one under way (./board-
 * portal.js reads them once for the page and what's beside it)
 */
export async function portalData(env, { member = null, admin = false, adminEmail = '', now = Date.now(), meetingsRead = null } = {}) {
  await ensureSchema(env.DB);
  const today = todayEastern(now);
  const unreadHere = {};
  // (Board's tables not set up is no part: the page's 503 in words, as every route says it, ./SETUP_DOWN)
  const lostHere = (part, also = null) => (err) => { if (err?.setup) throw err; console.error(`[board] ${part}`, err?.message || err); unreadHere[part] = true; return also; };
  const [meetingsNow, docsNow, numbers, history, people, filings, snapshot, settingsNow, gifts] = await Promise.all([
    (meetingsRead || listMeetings(env.DB)).catch(lostHere('meetings')), listDocs(env.DB).catch(lostHere('docs')), liveNumbers(env, { now }), cashHistory(env.DB).catch(lostHere('history')), roster(env.DB, { withEmails: true }),
    // (the tax returns and the tax return's year, and the year's major gifts: a read that failed marks its part, as
    // liveNumbers' do, never an empty list: Board QA round 12)
    // (the year at a glance, from the latest tax return, its own part: never the tax returns and audits beside it, which
    // are read apart: Board QA round 15)
    siteDoc(env.DB, 'financials').catch(lostHere('sources')), siteDoc(env.DB, 'financial-snapshot').catch(lostHere('glance')), getSettings(env.DB).catch(lostHere('settings')), giftsNow(env.DB, { now }).catch(lostHere('gifts')),
  ]);
  const meetings = meetingsNow || [];
  const docs = docsNow || [];
  // (the settings not read: no admins named, no quorum, no one the invites come from, never a default said as SOARD's)
  const settings = settingsNow || { quorum: null, admins: [], invitesFrom: '' };
  // (the month-end balances only matter without QuickBooks' own months: the cash a year back, Cash over time)
  if (unreadHere.history && numbers.books?.months?.length > 1) delete unreadHere.history;
  // The visit before this one, for what's new since: the same for the whole visit, every reload, tab and device. This
  // read is a look too (a reload, a tab coming back, the page reading itself again), and so is everything they do on
  // the page while it's open (./keepVisit)
  let lastSeen = null;
  if (member) {
    // (a visit not kept, or the last one not read, is a line missed: the page opens either way. Round 9's rule; Board QA
    // round 11, Nov 23 2026: a failed write of the visit answered the whole page with a 500)
    await keepVisit(env.DB, member, now).catch((err) => console.error('[board] keeping the visit', err?.message || err));
    lastSeen = (await env.DB.prepare('SELECT prev FROM board_seen WHERE slug = ?').bind(member.slug).first().catch((err) => { console.error('[board] the last visit', err?.message || err); return null; }))?.prev || null;
  }
  // A member's own documents (put with an item they present) are marked, so they can take them off again (not read: none
  // marked, and the page says which are theirs couldn't load)
  const own = member?.email ? new Set(((await env.DB.prepare('SELECT id FROM board_files WHERE lower(by) = ?').bind(String(member.email).toLowerCase()).all().catch(lostHere('ownFiles', { results: [] }))).results || []).map((r) => r.id)) : new Set();
  const shared = meetings.map(boardCopy).filter(Boolean).map((m) => (own.size ? { ...m, files: m.files.map((f) => (own.has(f.id) ? { ...f, mine: true } : f)) } : m))
    .map((m) => (m.snapshot ? { ...m, snapshot: snapshotFor(m.snapshot, meetings) } : m));
  // Their adopted signature and initials (from the last time they signed), and whether they've agreed to sign electronically
  // (either not read is marked, never said as no mark adopted or no copy kept)
  const marked = member?.slug ? await env.DB.prepare('SELECT mark, initials, consent_at FROM board_member_marks WHERE slug = ?').bind(member.slug).first().catch(lostHere('mark')) : null;
  const myMark = marked ? { ...parse(marked.mark, {}), initials: marked.initials || '', consented: !!marked.consent_at } : null;
  // Their signed copies, every year's (this year's and earlier wordings' too): each to open again
  const myCopies = member?.slug ? ((await env.DB.prepare('SELECT doc_id, year, version, record_id, at FROM board_signatures WHERE slug = ?1 AND record_id IS NOT NULL UNION ALL SELECT doc_id, year, version, record_id, at FROM board_signatures_earlier WHERE slug = ?1 AND record_id IS NOT NULL ORDER BY year DESC, at DESC').bind(member.slug).all().catch(lostHere('copies', { results: [] }))).results || []) : [];
  const mine = member?.slug || null;
  // A paper read as its PDF: its words, as read, to find it by them
  const fileWords = {};
  const pdfIds = docs.filter((d) => d.shared && !d.body && d.file).map((d) => d.file.id);
  // (not read: search finds those papers by their names alone, and says so)
  if (pdfIds.length) for (const r of ((await env.DB.prepare(`SELECT id, COALESCE(NULLIF(words, ''), words_part) AS words FROM board_files WHERE id IN (${pdfIds.map(() => '?').join(',')})`).bind(...pdfIds).all().catch(lostHere('paperWords', { results: [] }))).results || [])) if (r.words) fileWords[r.id] = r.words.slice(0, 60000);
  // The words a member signed, for each paper they're asked to sign again: what changed, shown beside the new (from the
  // last version their signature counted on: a typo kept since isn't a change to them)
  const signedBodies = {};
  for (const d of docs) {
    // (or, in a new year, the wording they signed last time, when it's known and there's a newer one)
    const last = mine && d.prior?.[mine];
    const v = mine && d.body && !d.signed[mine] && (d.before?.[mine] ? Math.max(d.before[mine].version, d.signFrom - 1) : last && last.version && last.version < d.version ? last.version : 0);
    if (!v) continue;
    // (not read: the paper says what they signed before couldn't load, never that nothing changed)
    const row = await env.DB.prepare('SELECT body FROM board_doc_versions WHERE doc_id = ? AND version = ?').bind(d.id, v).first().catch(lostHere('signedBodies'));
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
  const practice = admin && !member ? await todayPractice(env.DB, now).catch(lostHere('practice')) : null;
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
    // (the month-end balances not read are today's numbers' part too: a meeting's money goes by those flags)
    numbers: unreadHere.history ? { ...numbers, unread: { ...(numbers.unread || {}), history: true } } : numbers,
    // Each part whose read failed just now (the money, the makeovers, the kids served, the gifts, the tax returns, the
    // events, and round 13's: the meetings, the papers, the settings, the month-end balances, which files are theirs,
    // the papers' words, their mark, their signed copies; round 15's: what makeovers cost, the meetings on the calendar,
    // the year at a glance): the page says so in its place and leaves it out of search (public/admin/board/unread.js).
    // Today's numbers' parts are named apart from the page's own (liveNumbers), so one never marks the other here
    // (the givers' names among them: Keep anonymous not read, every name kept hidden and said so, ./_board-gifts.js)
    unread: { ...(numbers.unread || {}), ...unreadHere, ...(gifts?.namesUnread ? { givers: true } : {}) },
    // Cash at each month's end: QuickBooks' own month-ends once it's connected (13 of them, the books'), else the banks' history
    cashHistory: numbers.books?.months?.length > 1 ? [...numbers.books.months].reverse().map((r) => ({ month: r.month, total: r.total, at: r.end })) : history || [],
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

// ─── A press that changed nothing, said so ──────────────────────────
// Board QA round 13 (Nov 24 2026): every press on the board page answered the database not answering, before anything
// changed, with "Something went wrong … Reload the page to see what was saved", and the meeting page's own save said
// to reload with its change not saved. Each press below reads first and lands in one write (or a send it can tell went),
// so the database failing in it changed nothing: said in its words, a 503 the page offers Try again for. Only a
// program's own error is "Something went wrong"

/**
 * The answer for an error, the same for the board page and Board (board-portal.js, board-admin.js): Board's tables not
 * set up, and anything said on purpose (a 4xx, or a 503 in words), as it is; anything else is the program's own, said
 * in sayable's words (500). `current`: a 409's copy of what's there now, for Board's merge (never the board page's).
 * `press`: the answer to a press (every POST of both routes). The database failing in one is said in round 12's words,
 * a 503 the page offers Try again for, by default, so no press can be left out (Board QA round 14, Nov 24 2026: a
 * check-in, a vote, a line note, the secretary's notes and her minutes, a signed copy, the operating balance and Take it
 * off still said "Something went wrong … Reload the page"). "Nothing was changed" only when nothing of the press landed
 * (pressLanded: its database watched while it ran, watchPress); a write that landed, or one whose answer was lost and
 * that nobody looked at, is never told as nothing: the site can't tell yet (UNSURE_SAVED). A press that reads first,
 * lands in one write and looks at a lost answer (landedOr) answers as written before it gets here; one whose one write
 * has landed (pressDone) and that something after it stopped is told so: 200, the page told to look again (LOOK_AGAIN),
 * never "can't tell" when the site can (Board QA round 15).
 * tests/board-round14-privacy.test.mjs walks every action of both routes to keep it so
 */
export function errorAnswer(err, { current = false, press = false } = {}) {
  if (err?.setup) return Response.json({ ok: false, error: err.message }, { status: 503 });
  if (err?.status && (err.status < 500 || (err.status === 503 && err.unread))) return Response.json({ ok: false, error: err.message, ...(current && err.current ? { current: err.current } : {}), ...(err.extra || {}) }, { status: err.status });
  if (press && !err?.status && dbFailed(err)) {
    const landed = pressLanded(err);
    console.error('[board] a press the database stopped', landed || 'not watched', err?.message || err);
    // (its one write in, and a read after it didn't answer: done, the page told to look again. Board QA round 15)
    if (landed === 'done') return Response.json({ ok: true, reread: true, later: LOOK_AGAIN });
    return landed === 'none' || landed === ''
      ? Response.json({ ok: false, error: NOTHING_SAVED }, { status: 503 })
      : Response.json({ ok: false, error: UNSURE_SAVED, unsure: true }, { status: 503 });
  }
  return Response.json({ ok: false, error: sayable(err) }, { status: 500 });
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

/** A meeting's check-ins and votes as stored: { ci: [{ slug, name, how, at }], vs: [{ motion_id, slug, name, vote, at }] } */
async function liveStored(DB, id) {
  const [ci, vs] = await Promise.all([
    DB.prepare('SELECT slug, name, how, at FROM board_checkins WHERE meeting_id = ?').bind(id).all().then((r) => r.results || []),
    DB.prepare('SELECT motion_id, slug, name, vote, at FROM board_votes WHERE meeting_id = ?').bind(id).all().then((r) => r.results || []),
  ]);
  return { ci, vs };
}
/** Check-ins (real, and a practice meeting's simulated ones), who's here, and the votes by motion */
async function liveRows(DB, m, now) {
  const { ci, vs } = await liveStored(DB, m.id);
  return rowsOf(m, ci, vs, now);
}
/** liveRows from the rows as read (or as a press's own write leaves them) */
function rowsOf(m, ci, vs, now) {
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
  return liveOf(await liveReads(env, m, canAct, { member, adminEmail, now }), now);
}
/**
 * Everything the meeting as it's held is made from, read: what a check-in or a vote answers with is read before its
 * write, never after it (Board QA round 14, Nov 24 2026: the check-in and the vote were kept, then a read of People for
 * the answer failed, and the member was told "nothing was changed"). Only the quorum is read from Settings: nothing of
 * People. `me`: who's acting, as the press already has them. → what liveOf makes the view from
 */
async function liveReads(env, m, canAct, { member = null, adminEmail = '', me = undefined } = {}) {
  const [settings, stored] = await Promise.all([readSettings(env.DB), liveStored(env.DB, m.id)]);
  const who = me !== undefined ? me : member ? { slug: member.slug, name: member.name } : canAct ? await adminVoter(env.DB, adminEmail) : null;
  // As the board sees it (an admin's preview of one not shared yet too: never a private note or a staff-only file)
  const seen = m.practice ? m : forBoard({ ...m, shared: true });
  // The last meeting's minutes, for an item that asks the board to approve them (only from a meeting the board can see)
  const prior = [];
  for (const id of new Set(seen.sections.flatMap((sec) => sec.items.filter((it) => it.live === 'minutes' && it.about).map((it) => it.about)))) {
    const prev = await getMeeting(env.DB, id);
    if (!boardCopy(prev)) continue;
    // (the document the board reads for them, by the one rule the board page and Print go by: ../../public/admin/
    // board-shared.js minutesDocOf, with no signature to go by here, so the minutes as written. Board QA round 15)
    const f = minutesDocOf(prev, null, { known: false }).file;
    // Its date and name for the screen's "since we last met"; its minutes for the item that approves them
    prior.push({ id: prev.id, date: prev.date, name: meetingName(prev), files: f ? [f] : [] });
  }
  const snapshot = m.practice ? m.snapshot || null : await boardSnapshot(env.DB, m.snapshot);
  return { m, canAct, quorum: Number(settings.quorum) > 0 ? Math.round(settings.quorum) : 0, ...stored, me: who, seen, prior, snapshot };
}
/** The meeting as it's held, for the board page, from what liveReads read (pure) */
function liveOf({ m, canAct, quorum, ci, vs, me, seen, prior, snapshot }, now) {
  const { here, votes, vote, board, checkins } = rowsOf(m, ci, vs, now);
  const sections = seen.sections.map((sec) => ({
    id: sec.id, title: sec.title, minutes: sec.minutes || 0,
    items: sec.items.filter(isFilled).map((it) => ({ id: it.id, title: it.title, motion: it.motion || '', presenter: it.presenter, who: it.who, guests: it.guests || [], notes: it.notes, confidential: it.confidential, live: it.live, also: it.also, about: it.about, docs: it.docs,
      report: it.report, reportBy: it.reportBy, reportAt: it.reportAt, reportLook: it.reportLook || '', slideOrder: it.slideOrder || [] })),
  }));
  const motion = vote ? m.motions.find((x) => x.id === vote.motionId) : null;
  const cast = motion ? votes[motion.id] || [] : [];
  const n = (v) => cast.filter((x) => x.vote === v).length;
  const marked = me ? m.attendance.find((p) => p.slug === me.slug && HOW.includes(p.status))?.status : '';
  const q = quorum || majority(board.length);
  return {
    id: m.id, practice: !!m.practice, updatedAt: m.updatedAt, title: meetingName(m), date: m.date, start: m.start, end: m.end,
    live: { startedAt: m.live.startedAt, endedAt: m.live.endedAt, itemId: m.live.itemId, fileId: m.live.fileId, page: m.live.page, part: m.live.part, screen: m.live.screen, sectionId: m.live.sectionId, sectionAt: m.live.sectionAt, floor: m.live.floor },
    sections,
    // What the screen shows: the board's files (never a staff-only one), the last meeting's minutes, the locked numbers
    files: seen.files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, kind: f.kind, at: f.at })),
    prior,
    snapshot,
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

/**
 * POST { action: 'checkin', meetingId, how }: here in the room, or on video (a member on the meeting's day; an admin
 * practising). Every read first (the meeting, who's acting, what the answer shows), then one write, looked at when its
 * answer is lost; the answer is the meeting as those reads and this write leave it, never a read after it: the database
 * failing before the write is "nothing was changed", and a check-in that's kept is answered as kept (Board QA round 14)
 */
export async function liveCheckIn(env, id, opts = {}) {
  return checkingIn(env, id, opts).catch(nothingDone());
}
async function checkingIn(env, id, { member = null, admin = false, adminEmail = '', how, now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  if (!HOW.includes(how)) throw err('In the room, or on video?', 400);
  const { m, canAct } = await liveMeeting(env.DB, id, { member, admin });
  if (!m.practice && !isLive(m) && m.date !== todayEastern(now)) throw err('Checking in opens on the meeting’s day', 409);
  const who = await liveActor(env, m, canAct, { member, adminEmail, now });
  const reads = await liveReads(env, m, canAct, { member, adminEmail, me: who });
  const at = isoOf(now);
  const kept = await landedOr(() => env.DB.prepare('INSERT OR REPLACE INTO board_checkins (meeting_id, slug, name, how, at) VALUES (?, ?, ?, ?, ?) RETURNING slug, name, how, at').bind(m.id, who.slug, who.name, how, at).first(),
    async () => !!(await env.DB.prepare('SELECT 1 AS y FROM board_checkins WHERE meeting_id = ? AND slug = ? AND how = ? AND at = ?').bind(m.id, who.slug, how, at).first()));
  const mine = kept?.slug ? kept : { slug: who.slug, name: who.name, how, at };
  return liveOf({ ...reads, ci: [...reads.ci.filter((c) => c.slug !== who.slug), mine] }, now);
}

/**
 * POST { action: 'vote', meetingId, motionId, vote }: for, against or abstain, while the chair has that vote open (a
 * change of mind counts). As a check-in: every read first, one write looked at, the answer from those reads and it
 */
export async function liveVote(env, id, motionId, choice, opts = {}) {
  return voting(env, id, motionId, choice, opts).catch(nothingDone());
}
async function voting(env, id, motionId, choice, { member = null, admin = false, adminEmail = '', now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  if (!VOTE_CHOICES.includes(choice)) throw err('For, against, or abstain?', 400);
  const { m, canAct } = await liveMeeting(env.DB, id, { member, admin });
  if (!isLive(m) || m.live.vote?.motionId !== motionId) throw err('That vote isn’t open', 409);
  const who = await liveActor(env, m, canAct, { member, adminEmail, now });
  const reads = await liveReads(env, m, canAct, { member, adminEmail, me: who });
  const { here } = rowsOf(m, reads.ci, reads.vs, now);
  if (!here.has(who.slug)) throw err('Check in first (in the room or on video), then vote', 409);
  const at = isoOf(now);
  const kept = await landedOr(() => env.DB.prepare('INSERT OR REPLACE INTO board_votes (meeting_id, motion_id, slug, name, vote, at) VALUES (?, ?, ?, ?, ?, ?) RETURNING motion_id, slug, name, vote, at')
    .bind(m.id, motionId, who.slug, who.name, choice, at).first(),
  async () => !!(await env.DB.prepare('SELECT 1 AS y FROM board_votes WHERE meeting_id = ? AND motion_id = ? AND slug = ? AND vote = ? AND at = ?').bind(m.id, motionId, who.slug, choice, at).first()));
  const mine = kept?.slug ? kept : { motion_id: motionId, slug: who.slug, name: who.name, vote: choice, at };
  return liveOf({ ...reads, vs: [...reads.vs.filter((v) => !(v.motion_id === motionId && v.slug === who.slug)), mine] }, now);
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
export async function createPractice(env, { by = '', now = Date.now(), fresh = false, clearFirst = '' } = {}) {
  await ensureSchema(env.DB);
  const today = todayEastern(now);
  // (what it's made from, read before anything is cleared: a read that fails changed nothing. Board QA round 14)
  const clear = [];
  if (!fresh) {
    const cur = await todayPractice(env.DB, now);
    if (cur?.borrowed) return cur;
    // One made before practice meetings had documents: a new one that has them
    if (cur) clear.push(cur.id);
  }
  const weekAgo = todayEastern(now - 7 * 86_400_000);
  for (const r of (await env.DB.prepare('SELECT id FROM board_practice WHERE date < ?').bind(weekAgo).all()).results || []) clear.push(r.id);
  const [meetings, settings, people] = await Promise.all([listMeetings(env.DB), getSettings(env.DB), roster(env.DB)]);
  for (const id of [...new Set([...clear, ...(clearFirst ? [clearFirst] : [])])]) await clearPractice(env.DB, id, { remove: true });
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
  // (made: read back with the documents it borrows, or as written when that read fails, never an error over a practice
  // meeting that's there: the page reads it again. Board QA round 14)
  return getPractice(env.DB, m.id).catch((e) => {
    console.error('[board] reading a practice meeting back', m.id, e?.message || e);
    return { ...cleanMeeting({ ...m, practice: true }), borrowed, docsFrom, reread: true };
  });
}

/** POST { action: 'practice-reset', id }: start over (a new practice meeting; the old one's taps and votes go) */
export async function resetPractice(env, id, { by = '', now = Date.now() } = {}) {
  await ensureSchema(env.DB);
  if (!(await getPractice(env.DB, id))) throw err('That practice meeting is gone', 404);
  // (cleared once the new one's reads are in: Board QA round 14)
  return createPractice(env, { by, now, fresh: true, clearFirst: id });
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
    // (never approved minutes' meeting, held earlier today: its parts carry what they state. minutesKept, round 15)
    for (const m of real.filter((x) => x.date >= today && agendaIsDraft(x, settings.template) && !minutesKept(x))) {
      const prev = previousMeeting(m, real);
      const name = prev ? draftName(prev) : '';
      const fresh = keepDocs(m.sections, templateAgenda(prev, { template: settings.template, date: m.date }));
      if (m.agendaFrom?.kind === 'template' && m.agendaFrom.name === name && agendaSkeleton({ sections: fresh }) === agendaSkeleton(m)) continue;
      const done = await patchMeeting(env.DB, m.id, (cur) => (agendaIsDraft(cur, settings.template) && !minutesKept(cur)
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
      // against nobody, nor one that's done with for want of a read. Round 10. Approved minutes' meeting is never read
      // again: its parts carry what they state, minutesKept, round 15. It's marked read all the same)
      if (f && !minutesKept(m)) { try { parsed = await readFileAsAgenda(env, f.id); } catch (err) { if (err?.unread) throw err; console.error('[board] reading again', f.name, err.message); } }
      let better = false;
      await patchMeeting(env.DB, m.id, (cur) => {
        if (!(cur.agendaFrom?.kind === 'email' && readAgain(cur) && !cur.minutesFrom?.typed)) return cur;
        better = !!parsed?.sections.some((s) => s.items.length) && !minutesKept(cur);
        return { ...cur, ...(better ? { sections: parsed.sections } : {}), agendaFrom: { ...cur.agendaFrom, ...(better ? { at: new Date(now).toISOString() } : {}), v: AGENDA_READER } };
      });
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
    // A board email whose noting didn't land when it went: on its meeting now, from its own record (never sent again)
    await settleSends(env, { now });
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
    // A typed minutes' Word file behind what the minutes say (anything that wrote them without it): brought up now, so the
    // board page's "The minutes as written" never keeps words the minutes don't have (./_board-notes.js, Board QA round 13)
    try { await (await import('./_board-notes.js')).maybeBringUpMinutesFiles(env, { now }); } catch (err) { console.error('[board] minutes files', err?.message || err); }
    // Bytes of files taken off whose delete didn't go just after (bytesOff): deleted now
    try { await finishBytesOff(env); } catch (err) { console.error('[board] file bytes', err?.message || err); }
    // Bytes put first whose row never came (a put that landed with its answer lost, a step after it that didn't): taken
    // once they're old enough that no press is still on its way to naming them (takeLooseBytes, Board QA round 14)
    try { await takeLooseBytes(env, { now }); } catch (err) { console.error('[board] loose file bytes', err?.message || err); }
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
