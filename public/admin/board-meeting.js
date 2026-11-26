/**
 * Board → one meeting (#board/meeting/<id>)
 * ===========================================================================
 * One page that follows the meeting's date. Nothing here is a secretary's job:
 * the agenda builds itself from the last one (the last minutes up for
 * approval, the makeovers and the money live), the numbers lock themselves on
 * the day, and the minutes, dropped in after, fill in who was there, the
 * notes, the motions and the action items. Nothing is run from here during
 * the meeting: the presentation moves itself (./board/screen.js PRESENT).
 *   The line under its name: the agenda, the invite, the approval, the board page,
 *            the email, the day, the minutes; done, next, or to come
 *   The agenda beside the presentation as it's written (AgendaStage: the
 *            slide for the item being worked on, every slide in order, Play
 *            from here), the board page or a phone; never the board's until
 *            the meeting is shared
 *   Ahead    then getting it to the board (the invite, the approval, then the board
 *            page and the email, the reports), who's coming, the minutes template
 *            (./board-minutes-template.js), the packet
 *   On the day  Present: the presentation in its own window, shared or not
 *   Held     drop the minutes in (PDF or Word) first: Board reads them into
 *            the meeting; then shared, emailed, approved, the signed copy
 * Everything saves by itself a moment after a change (no Save button to
 * forget in a meeting). Two people editing at once merge item by item
 * (mergeMeeting); only the same thing changed both ways asks.
 * Server: /api/board-admin. Rules: ./board-shared.js. Shared bits: ./board-ui.js.
 */

import { useState, useEffect, useRef, useMemo } from './vendor.js';
import { ask } from './ask.js';
import { viewerLink, sizeText } from './file-viewer.js';
import {
  html, call, upload, ago, savedAt, dayOf, firstOf, youAnd, hashFor, PAGE, viewerFiles, CHECK, NotesBox, Menu, callName, daysFrom, whenWords, Notes,
  PersonPicker, ItemChooser, DocChip, pickable, Face, ShowsPicker, answerLost, sentence, nameIn, FitBox, approvedAlready,
} from './board-ui.js';
import {
  RESULTS, FILE_KINDS, LIVE, minutesIn, cleanMeeting, meetingName, longDate, shortDate, timeRange, plural, uid, clock,
  todayEastern, attendanceCounts, quorumFor, majority, answerOf, repliesOf, fileTitle, mergeMeeting, agendaIsDraft,
  isLive, agendaItems, isFilled, hasSince, reportsOn, showsOf, slidesOf, booksDraw, isStatement, LIVE_TITLES, SHOW_KINDS, tallyText, cleanLive, presentersOf, namesText, itemFiles, guessItem, deckOf, stopIndex, liveOfStop, pagesText, MORE,
  sectionPlan, sectionOf, sectionClock, clockText, facesOf, itemDocs, docTitle, formatOf, docsOf, looseFiles, NOTHING_NEW, isNothingNew, copyOfItem, minutesToRead, packetDocs, minutesFileOf, ownMinutesFile, minutesStaffOnly, staffOnlyWords, approvedNotShared,
  signInKnown, minutesTarget, meetingOver, meetingHeld, inviteIsRecord, shareWaits, cleanTemplate, followAddresses,
  noInviteFor, waitsForApproval, minutesApprover, heldOn, chairReviewDay, approvedFileOf, FILE_STAYS, askedOf, heldNoSend,
  UNSURE_SAVED, sendUntilAnswered, uploadId, uploadKey,
  minutesKept, MINUTES_STAY,
} from './board-shared.js';
import { openScreen, mirrorUrl, useScreen, usePages, stepKey, useCover } from './board-present.js';
import { printMinutesTemplate, downloadMinutesDocx, withStated, typedOver } from './board-minutes-template.js';
import { ReportEditor, ReportCoach, Report } from './board-report.js';
import { partFor } from './board-coach.js';
import { mdWords } from './board-md.js';
import { booksTitle } from './board/books.js';
import { pageWordOf } from './board/docs.js';

/** How a send whose answer never came back starts (./board-ui.js answerLost): it may have gone all the same */
const LOST = 'No answer came back from the site';
/** Where every email that went can be checked, before one is sent again */
const WENT_OUT = 'Emails & invites → What went out lists every email that went';
/**
 * Why a save didn't go, as the end of "Not saved: …": never a code, and no full stop (the sentence goes on). A refusal by
 * a page that isn't the site's own answer (./board-ui.js call's `page`) says only what happened: what happens next is
 * the save's to say (GOES_AGAIN), so it never reads as two instructions that disagree
 */
const notSavedWhy = (j) => (j.offline ? 'no connection' : j.unknown ? 'the site didn’t answer' : String((j.page && j.what) || j.error || 'the site didn’t say why').trim().replace(/[.\s]+$/, ''));
/** This meeting as the site has it now (Board's data read again), or null when that read fails (undefined: not there) */
async function siteNow(ctx, id) {
  const look = await ctx.load?.({ quick: true }).catch(() => null);
  return look?.ok ? (look.meetings || []).find((x) => x.id === id) : null;
}
/** The page's own ids for files whose last send got no answer, so choosing one again is the same upload (uploadId) */
const UNSURE_IDS = new Map();
/**
 * A file chosen on this page, sent up under the page's own id for it, made once here (./board-ui.js upload): sent again,
 * the site answers with the file it kept, never a second copy. An answer lost on the way back isn't a refusal: the page
 * looks at the site (Board's data read again), and a file there by that id is this one, kept, and goes on as if the
 * answer had come (onto its item, for an item's upload); not there yet, or the look failing too, it goes again under the
 * same id, and keeps looking, however many answers are lost (./board-shared.js sendUntilAnswered). Only the site's own
 * no says to try again; still no answer after that, it says it can't tell yet (UNSURE_SAVED), and the same file chosen
 * again goes under the same id. Board QA rounds 13 and 14, Nov 24 2026: two lost answers said "Try again", and pressed
 * again it kept the file twice, one loose under Also for this meeting. → upload's answer
 */
export async function sendUp(ctx, f, { place = '', ...opts }) {
  // (`place`: the item it's for, if any: the same file chosen again for the same place is the same upload)
  const key = uploadKey(f, `${opts.ownerType}:${opts.ownerId}:${opts.kind || ''}:${place}`);
  const fileId = uploadId(UNSURE_IDS, key);
  const j = await sendUntilAnswered(() => upload(f, { ...opts, fileId }), {
    lost: answerLost,
    look: async () => { const now = await siteNow(ctx, opts.ownerId); return now === null ? undefined : now?.files?.find((x) => x.id === fileId) || null; },
  });
  uploadId(UNSURE_IDS, key, { id: fileId, unsure: !!j.unsure });
  return j;
}
/** A meeting's files with one more, once (a file the page looked up may have come in with the site's copy already) */
const withFile = (x, f) => ({ ...x, files: x.files.some((y) => y.id === f.id) ? x.files : [...x.files, f] });
/**
 * What kind of failure a save's answer is, to say each new kind once (no connection, no answer, the site failing, or a
 * refusal in its own words): a refusal and then no connection are both said, a retry failing the same way again isn't
 */
const failKind = (j) => (j.offline ? 'offline' : j.unknown ? 'unknown' : j.status >= 500 ? 'failing' : `no:${notSavedWhy(j)}`);

// What a person edits (the server keeps files, the packet's numbers and sent records, and done ticks)
const EDITABLE = ['date', 'start', 'end', 'title', 'location', 'address', 'inviteNote', 'video', 'shared', 'noSince', 'minutes', 'approvedOn', 'attendance', 'sections', 'motions', 'actions', 'live'];
/**
 * One field of a clean meeting as a person edits it, to compare: who wrote a report when (_board.js stampReports), an
 * action's done tick and an answer to the invite are the server's to say, never a change to save
 */
const fieldOf = (c, f) => JSON.stringify(f === 'actions' ? c.actions.map(({ done, doneOn, ...a }) => a)
  : f === 'attendance' ? c.attendance.map(({ rsvp, ...p }) => p)
    : f === 'sections' ? c.sections.map((s) => ({ ...s, items: s.items.map(({ reportBy, reportAt, ...it }) => it) })) : c[f]);
/** What a person edits on a meeting, as one string: what a save sends, to know whether the site has it */
const editable = (m) => { const c = cleanMeeting(m); return JSON.stringify(EDITABLE.map((f) => fieldOf(c, f))); };
/** Each report's writer and time from the server's copy, onto the one being edited (where the words still match) */
const stampsFrom = (sections, saved) => {
  const by = new Map(saved.sections.flatMap((s) => s.items).map((it) => [it.id, it]));
  return sections.map((s) => ({ ...s, items: s.items.map((it) => { const x = by.get(it.id); return x && (x.report || '') === (it.report || '') ? { ...it, reportBy: x.reportBy, reportAt: x.reportAt } : it; }) }));
};
/** What only the server sets on a meeting, from its copy: every field a person doesn't edit here */
const serverSet = (sv) => Object.fromEntries(Object.entries(sv || {}).filter(([k]) => !EDITABLE.includes(k)));
/** What a person edits on a meeting, from a copy (a merge's) */
const editableOf = (mm) => Object.fromEntries(EDITABLE.filter((k) => k in mm).map((k) => [k, mm[k]]));
/**
 * The site's copy of a meeting (`sv`, a save's or an action's answer) onto the one on the page (`x`), against the copy
 * the page last had from the site (`was`, its base): every field changed here since then is kept (and goes with the next
 * save); every other field takes the site's, so nothing the site changed by itself is left stale here, never to match
 * (Who's coming as People → Board has it now, the approval day the site filled in). QA round 4, Nov 21 2026: a tab open
 * while People → Board changed kept its own Who's coming, said Saved and still asked "Leave site?"
 */
const onto = (x, sv, was) => {
  const cx = cleanMeeting(x);
  const cw = cleanMeeting(was);
  return { ...x, ...serverSet(sv), ...Object.fromEntries(EDITABLE.filter((f) => fieldOf(cx, f) === fieldOf(cw, f)).map((f) => [f, sv[f]])) };
};
/** Who's on the board on a meeting's list, as one string, to tell when the site's copy names another board */
const boardOf = (m) => (m?.attendance || []).filter((p) => p.kind === 'board').map((p) => p.slug).sort().join(' ');
const blankItem = () => ({ id: uid('i_'), title: '', presenter: '', who: [], guests: [], notes: '', staffNote: '', confidential: false, live: '', docs: [] });
const move = (list, i, d) => { const out = [...list]; const [x] = out.splice(i, 1); out.splice(i + d, 0, x); return out; };

/**
 * The question when a save meets the same thing changed both ways (`clashes`) by whoever saved meanwhile (`by`, their
 * sign-in): by name, or "you" when it was this founder's own other tab, never their own name as if someone else's
 * (QA round 6, Nov 21 2026). Everyone whose saves changed what clashes is named (`who`: clashWho's, [{ by, clashes }]),
 * each with what they changed, never only whoever saved last, so Keep mine never drops a change whose maker the question
 * didn't name (Board QA round 10, Nov 22 2026). `unknown`: Board can't tell who saved since this page's copy (clashWho
 * null): said in words, nobody named, never "your other tab" guessed (Board QA round 11, Nov 23 2026)
 */
export function clashQuestion({ by = '', me = '', what = 'this meeting', clashes = [], who = null, unknown = false }) {
  const listOf = (l) => `${l.slice(0, 3).join(', ')}${l.length > 3 ? ' and more' : ''}`;
  const list = listOf(clashes);
  // (Board can't tell who saved since this page's copy, clashWho: said so, never a name guessed. Board QA round 11)
  if (unknown) {
    return {
      title: `${what.charAt(0).toUpperCase()}${what.slice(1)} changed since this page opened it`,
      text: `${list.charAt(0).toUpperCase()}${list.slice(1)} changed here and on the site since this page opened it, too long ago for Board to know who changed ${clashes.length === 1 ? 'it' : 'them'}. Keep what’s here, or take what’s saved? Everything else from both is kept.`,
      yes: 'Keep what’s here', no: 'Take what’s saved',
    };
  }
  const mine = (x) => !!x && !!me && sameBy(x, me);
  const people = Array.isArray(who) && who.length ? who : [{ by, clashes }];
  if (people.length === 1 && mine(people[0].by)) {
    return { title: `You changed ${what} in another tab too`, text: `You changed ${list} here and in the other tab. Keep what’s here, or take the other tab’s? Everything else from both is kept.`, yes: 'Keep what’s here', no: 'Take the other tab’s' };
  }
  const nameOf = (x) => (x ? firstOf(x) : 'Someone');
  if (people.length === 1) return { title: `${nameOf(people[0].by)} changed ${what} too`, text: `You both changed ${list}. Keep yours there, or take theirs? Everything else from both of you is kept.`, yes: 'Keep mine', no: 'Take theirs' };
  // Several: this founder's other tab first, then each in the order they saved, with what each changed
  const order = [...people.filter((x) => mine(x.by)), ...people.filter((x) => !mine(x.by))];
  const parts = order.map((x, i) => {
    const same = i > 0 && listOf(x.clashes) === listOf(order[i - 1].clashes);
    const them = same ? (x.clashes.length === 1 ? 'it' : 'them') : listOf(x.clashes);
    return mine(x.by) ? `You changed ${them} in another tab` : `${nameOf(x.by)} changed ${them}${same ? ' too' : ''}`;
  });
  const names = order.map((x) => (mine(x.by) ? 'Your other tab' : nameOf(x.by)));
  return {
    title: `${names.slice(0, -1).join(', ')} and ${names.at(-1)} changed ${what} too`,
    text: `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}. Keep what’s here, or take theirs? Everything else from all of them is kept.`,
    yes: 'Keep what’s here', no: 'Take theirs',
  };
}
const sameBy = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
/**
 * Who changed each thing that clashes (`clashes`, mergeMeeting's words), save by save since the copy this page opened
 * (`was`): each save the site kept since (`saves`, oldest first, a 409's: functions/api/_board.js savesChain) against
 * the one before it and what's on this page now (`mine`), each with every rename followed first (`follow`), so a
 * rename that only moved an address never counts (Board QA round 9). `shape`: a save's data as a meeting to merge.
 * When the site knows everyone who saved since but not each save's words (`saves` null, `savers` a list): each of them
 * (and `by`, the last), with every clash, so no change is dropped without its maker named. When it doesn't know who
 * saved since at all (both null: this page's copy is older than the history it keeps): null, for clashQuestion to say
 * so, never a name guessed from the saves it has (Board QA round 11, Nov 23 2026: past 30 saves, only "your other tab"
 * was named, and Keep what's here dropped Pat's change). → [{ by, clashes }] in the order they saved, for clashQuestion,
 * or null. Board QA round 10, Nov 22 2026: a rename that only followed an address was named for the founder's change in
 * another tab, and Keep mine dropped that change
 */
export function clashWho({ clashes = [], was, mine, saves = null, savers = null, by = '', shape = (x) => x, follow = (x) => x }) {
  const out = [];
  const add = (who, list) => {
    const had = out.find((x) => sameBy(x.by, who));
    if (had) had.clashes = [...new Set([...had.clashes, ...list])];
    else out.push({ by: who || '', clashes: [...list] });
  };
  if (!clashes.length) return out;
  if (!Array.isArray(saves)) {
    if (!Array.isArray(savers)) return null;
    for (const who of [...savers, by]) add(who, clashes);
    return out;
  }
  let prev = was;
  for (const s of saves) {
    if (s?.data == null) continue;
    const next = follow(shape(s.data));
    const theirs = mergeMeeting(prev, mine, next).clashes.filter((c) => clashes.includes(c));
    if (theirs.length) add(s.by, theirs);
    prev = next;
  }
  // (one no save accounts for: whoever saved last, as before)
  const named = new Set(out.flatMap((x) => x.clashes));
  const left = clashes.filter((c) => !named.has(c));
  if (left.length) add(by, left);
  // (each one's in the order the question lists them)
  for (const x of out) x.clashes.sort((a, b) => clashes.indexOf(a) - clashes.indexOf(b));
  return out;
}

/** A save that didn't go is tried again by itself: 3 seconds later, then 10, then every 30 (and the moment the connection is back) */
const RETRY_MS = [3000, 10000, 30000];
/**
 * The answers to a save that mean what it saves is gone: the meeting deleted in another tab or by someone else. The site
 * refuses the save rather than bringing the meeting back (functions/api/board-admin.js save-meeting), so trying again can
 * never work: the page says so, stops saving, and offers the way back to every meeting
 */
export const GONE_STATUS = [404, 410];
export const saveGone = (j) => !!j && !j.ok && !j.unknown && !j.offline && GONE_STATUS.includes(j.status);
/** What's said when a save finds the meeting deleted */
export const GONE_WORDS = 'This meeting was deleted, in another tab or by someone else, so nothing here can be saved any more.';

/** What's said when a save went and the site's answer hasn't all of it (something sent that it didn't keep): never "Saved" */
const NOT_KEPT = 'The site didn’t keep all of this change';
/** What sends again a save that came back refused or failed (useAutosave): never the page by itself */
const GOES_AGAIN = 'It goes again once you change something or press Try again.';

/**
 * Saving by itself, the one way for a meeting's page and the agenda template (Peter: no Save button to forget). A
 * moment after a change it saves (`soon`); one with no answer (no connection, or none came back) says so once and is
 * tried again by itself (RETRY_MS); reloading or closing the tab with a change not saved yet saves it and asks the
 * browser's "Leave site?"; leaving for another page in Board or the admin saves it on the way out, and keeps trying after
 * if that doesn't go. A save that came back refused or failed (the site answered no), or that the site didn't keep all
 * of, is never sent again by itself as it went: only once something new is typed, or the person presses to try again
 * (Try again, ⌘S, the button again). QA round 4, Nov 21 2026: a refusal put back as it went was sent again at once,
 * thousands of times. Only while Board can't save (a save failed, and nothing has gone since) does leaving ask, "Leave
 * without saving?" (markDirty), and leaving then drops those changes, never sent after. ⌘S / Ctrl+S saves now.
 *   pending()  whether there's a change the site hasn't got
 *   contents() what a save would send now, as one string, to know a save that came back no from something new
 *   check()    why it can't be saved as it is, in words ("A meeting needs a date"): shown, never sent (optional)
 *   send()     one save → call()'s answer (./board-ui.js), with `sent`: contents() of what went (a merge changes it)
 *   took(j)    a save that went, onto the page's own copies, as the SITE answered it (never as it was sent, so what
 *              the site didn't keep is still pending, and said) → when it was saved (ISO)
 *   where      what leaving would drop, as "Leave without saving?" names it ("this meeting", "the agenda template")
 *   gone       words for a save refused because what it saves was deleted (saveGone): said, and saving stops for good
 *   refused(j) a save the site refused for good, naming what it won't take (j.refused: sharing before the agenda is
 *              approved, minutes approved that aren't in Board): puts that back as the site has it now (j.meeting) →
 *              what didn't happen, in words ("Not on the board page"), said with the site's why. Never sent again as it
 *              went, and the rest saves at once, so nothing typed after it waits behind it. '' for anything else
 * → { st: { s: saved | unsaved | saving | error | gone, at, why }, save({ own, again }), soon(ms), savedAt(at), cancel(),
 *     stop(): never again, stopped(): whether it has stopped (left without saving, deleted, or stopped) }
 *   save() → the last answer (null when nothing went). `again`: pressed (Try again, ⌘S), so it goes even as it came back
 *   no before. `own(j)`: a change pressed (Share, Mark them approved), which goes as pressed, and says for itself what a
 *   save that doesn't go means for it, in place of "Not saved", the first time one doesn't
 */
function useAutosave({ pending, contents = null, check = null, send, took, where, gone = '', refused = null, markDirty = () => {}, addToast = () => {}, at = '' }) {
  const [st, setSt] = useState({ s: 'saved', at });
  const fns = useRef(null);
  fns.current = { pending, contents, check, send, took, gone, refused, markDirty, addToast };
  const box = useRef(null);
  // One set for the page's life and after it: a save that goes out as the page closes, or keeps trying, finishes on its own
  if (!box.current) {
    // (held: what a save that came back no sent, and why: never sent again by itself. told: the kind of failure last
    // said (failKind), so a new kind is said too, and the same one isn't said again until a save goes)
    const k = { s: 'saved', timer: 0, retry: 0, busy: null, again: false, failing: 0, dropped: false, here: true, own: null, held: null, why: '', told: '' };
    const put = (s, more = {}) => { k.s = s; setSt((x) => ({ at: x.at, why: x.why, ...more, s })); };
    // What a save would send now
    const now = () => (fns.current.contents ? fns.current.contents() : null);
    // Nothing new since a save came back refused or failed, or the site didn't keep all of it: never sent again by itself
    const asHeld = () => k.held !== null && now() === k.held;
    // Can't save right now: the last try failed and nothing has gone since (typing after it doesn't change that)
    const unsavable = () => k.s === 'error' || (k.failing > 0 && k.s !== 'saved');
    const back = () => { if (k.failing) save(); };
    const stop = () => { k.dropped = true; k.own = null; clearTimeout(k.timer); clearTimeout(k.retry); removeEventListener('online', back); };
    // A change pressed whose save didn't go says so in its own words, once (it's put back as the site has it), else "Not saved"
    const ownSays = (j) => { const own = k.own; k.own = null; if (!own) return false; own(j); return true; };
    // Nothing left that the site hasn't got (a change pressed was put back): saved, with nothing to try again
    const settle = () => { if (!k.dropped && !k.busy && !fns.current.pending()) { k.failing = 0; k.held = null; k.told = ''; clearTimeout(k.retry); put('saved'); } };
    // (the site's why, as the status line's title says it)
    const whyOf = (said) => sentence(said.charAt(0).toUpperCase() + said.slice(1));
    async function save({ own = null, again = false } = {}) {
      clearTimeout(k.timer);
      if (typeof own === 'function') k.own = own;
      if (k.dropped) return null;
      if (k.busy) { k.again = true; return k.busy; }
      const f = fns.current;
      // Nothing new (a save already took it): said, in case a change was announced before that save landed (and nothing
      // is left failing)
      if (!f.pending()) { if (k.s === 'unsaved' || k.s === 'error') put('saved'); k.failing = 0; k.held = null; k.told = ''; k.own = null; clearTimeout(k.retry); return null; }
      // As it came back refused or failed, nothing new since: only a press sends it again (a change pressed goes as pressed)
      if (!again && !k.own && asHeld()) { put('error', { why: k.why }); return null; }
      const why = f.check?.();
      if (why) { put('error', { why }); if (ownSays({ ok: false, error: why })) setTimeout(settle, 0); return null; }
      put('saving');
      k.busy = (async () => {
        const went = now();
        const j = await f.send();
        // (what went: a merge with a save made meanwhile changes it on the way)
        const sent = typeof j.sent === 'string' ? j.sent : went;
        k.busy = null;
        if (k.dropped) return null;
        if (f.gone && saveGone(j)) {
          stop();
          put('gone', { why: f.gone });
          f.markDirty(false);
          f.addToast(f.gone, 'error');
          return j;
        }
        // Refused for good (the agenda isn't approved yet, the minutes aren't in Board): that change is put back as the
        // site has it and said in words, and whatever else is waiting goes now. What went is never sent again by itself
        // (it could never go), and every change after it would wait behind it, never saved
        const no = !j.ok && f.refused ? f.refused(j) : '';
        if (no) {
          k.own = null;
          k.again = false;
          k.failing = 0;
          k.told = '';
          clearTimeout(k.retry);
          k.held = sent;
          k.why = sentence(notSavedWhy(j));
          f.addToast(`${no}: ${k.why}`, 'error');
          put('unsaved');
          setTimeout(() => { if (!fns.current.pending()) settle(); else if (asHeld()) put('error', { why: k.why }); else save(); }, 0);
          return j;
        }
        if (!j.ok) {
          // No answer (no connection, or none came back), or the site itself failing (a 5xx in its own words: its
          // database didn't answer): said once per outage, then tried again by itself, a while later each time (sooner
          // when the connection comes back). An answer that says no (a 4xx): said, and never sent again by itself as it
          // went. Each new kind of failure is said, not only the first (QA round 5, Nov 21 2026: a refusal, then no
          // connection, said only the refusal)
          const lost = !!(j.offline || j.unknown || j.status >= 500);
          // (the site failing, whatever its words, is said as that: never "Reload the page" while a change isn't saved,
          // round 5's rule, since Board goes on trying by itself. Board QA round 13: "Not saved: Something went wrong …
          // Reload the page to see what was saved … Board keeps trying.")
          const said = lost && !j.offline && !j.unknown ? 'we couldn’t save that just now' : notSavedWhy(j);
          const told = ownSays(j);
          const kind = failKind(j);
          if (!lost) { k.held = sent; k.why = whyOf(said); }
          if (kind !== k.told && !told) {
            f.addToast(lost ? `Not saved: ${said}. Board keeps trying${j.offline ? ', and saves as soon as the connection is back' : ''}.`
              : `Not saved: ${whyOf(said)} ${k.here ? GOES_AGAIN : `Open ${where} again to make that change again.`}`, 'error');
          }
          k.told = kind;
          k.failing += 1;
          put('error', { why: whyOf(said) });
          clearTimeout(k.retry);
          if (lost) k.retry = setTimeout(save, RETRY_MS[Math.min(k.failing - 1, RETRY_MS.length - 1)]);
          if (told) setTimeout(settle, 0);
          return j;
        }
        const wasFailing = k.failing;
        k.failing = 0;
        k.held = null;
        k.told = '';
        clearTimeout(k.retry);
        const at = f.took(j) || new Date().toISOString();
        // Went, and the site's answer hasn't all of what went, with nothing typed since: not saved, said so (never
        // "Saved"), and never sent again by itself
        if (f.pending() && now() !== null && now() === sent) {
          k.held = sent;
          k.why = `${NOT_KEPT}.`;
          k.again = false;
          k.own = null;
          f.addToast(`Not saved: ${NOT_KEPT.charAt(0).toLowerCase()}${NOT_KEPT.slice(1)}. ${GOES_AGAIN}`, 'error');
          put('error', { why: k.why, at });
          return j;
        }
        if (wasFailing) f.addToast('Saved', 'info');
        put('saved', { at });
        if (k.again) { k.again = false; return save(); }
        k.own = null;
        // (gone from the page and nothing more to send: nothing listens for the connection any more)
        if (!k.here) removeEventListener('online', back);
        return j;
      })();
      return k.busy;
    }
    const soon = (ms = 1200) => {
      if (k.dropped || !fns.current.pending() || asHeld()) return;
      if (k.s !== 'saving') put('unsaved');
      clearTimeout(k.timer);
      k.timer = setTimeout(save, ms);
    };
    // (the server's copy taken some other way, an action's answer: saved as of then, unless saving has stopped for good)
    box.current = { k, put, unsavable, back, save, soon, stop, stopped: () => k.dropped, cancel: () => clearTimeout(k.timer), savedAt: (when) => { if (!k.dropped) put('saved', { at: when }); } };
  }
  const { k, unsavable, back, save } = box.current;
  const waiting = pending();
  useEffect(() => { fns.current.markDirty(unsavable(), where); }, [waiting, st.s]);
  useEffect(() => {
    // (pressed: it goes, even as it came back no before)
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save({ again: true }); } };
    // Reloading or closing the tab with a change not saved yet: it goes now, and the browser asks before the page goes
    const onLeave = (e) => { if (!k.dropped && fns.current.pending()) { save(); e.preventDefault(); e.returnValue = ''; } };
    addEventListener('keydown', onKey);
    addEventListener('beforeunload', onLeave);
    addEventListener('online', back);
    return () => {
      k.here = false;
      removeEventListener('keydown', onKey);
      removeEventListener('beforeunload', onLeave);
      clearTimeout(k.retry);
      // Gone while Board couldn't save: only ever after "Leave without saving?" was answered (Board's own question or the
      // admin's, ./board-admin.js and index.html leaveThen), so those changes go, as it said. Otherwise what's typed saves
      // now, and keeps trying (and the moment the connection is back) if it doesn't go
      if (unsavable()) { k.dropped = true; clearTimeout(k.timer); } else save();
      if (k.dropped || !k.busy) removeEventListener('online', back);
      fns.current.markDirty(false);
    };
  }, []);
  const { soon, savedAt: savedNow, cancel, stop, stopped } = box.current;
  return { st, save, soon, savedAt: savedNow, cancel, stop, stopped };
}

/** The line that says whether it's saved, at the top of a meeting and the agenda template: `saved` says a save that went */
function SaveState({ st, save, saved = null }) {
  return html`<span class=${`bm-saved ${st.s === 'error' || st.s === 'gone' ? 'is-error' : st.s === 'saved' ? 'is-quiet' : ''}`} role="status" aria-live="polite" tabindex="-1">
    ${st.s === 'saving' ? 'Saving…'
      : st.s === 'unsaved' ? 'Saving in a moment'
      : st.s === 'gone' ? html`<span title=${st.why}>Not saved: deleted</span>`
      : st.s === 'error' ? html`<span title=${st.why}>Not saved</span> <button type="button" class="btn btn-ghost btn-sm" onClick=${async () => { await save({ again: true }); requestAnimationFrame(() => document.querySelector('.bm-saved')?.focus()); }}>Try again</button>`
      : saved || `Saved ${st.at ? savedAt(st.at) : ''}`}
  </span>`;
}

export function MeetingEditor({ meeting, ctx, step: asked }) {
  const { data, addToast, go, putMeeting, markDirty } = ctx;
  const [m, setMeeting] = useState(meeting);
  const mRef = useRef(m);
  mRef.current = m;
  // Every change to the copy here reaches mRef as it's made (Preact runs an updater when it's set), not at the next draw:
  // a save, and a merge with someone else's, always start from what's on the page now
  const setM = (fn) => setMeeting((x) => (mRef.current = typeof fn === 'function' ? fn(x) : fn));
  const saved = useRef(cleanMeeting(meeting)); // the server's copy as last seen
  const base = useRef(meeting.updatedAt);
  const [editWhere, setEditWhere] = useState(!meeting.date);
  const practice = !!meeting.practice;
  const set = (patch) => setM((x) => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) }));
  // What the board page follows (the item, a vote opening or closing) saves at once, not a moment later
  const right = useRef(false);
  const setNow = (patch) => { right.current = true; set(patch); };
  // Who's on the board on the copy a save sent, and the copy of this meeting the page last put in Board's data itself
  const sentBoard = useRef('');
  const ours = useRef(meeting);
  // What was typed into approved minutes and couldn't be saved (approved in another tab meanwhile): kept here to copy
  const [typed, setTyped] = useState([]);

  // ── Saving by itself (useAutosave, as the agenda template does) ──
  // Leaving for another page in Board or the admin: a change made a moment ago saves on the way out, so nothing asks.
  // Only while Board can't save does leaving ask, "Leave without saving?", and leaving then drops those changes
  const { st, save, soon, savedAt: savedNow, cancel, stopped } = useAutosave({
    where: 'this meeting', gone: GONE_WORDS, markDirty: (d) => markDirty(d), addToast, at: meeting.updatedAt,
    pending: () => editable(mRef.current) !== editable(saved.current),
    contents: () => editable(mRef.current),
    check: () => (mRef.current.date ? '' : 'A meeting needs a date'),
    send: async () => {
      let sent = editable(mRef.current);
      sentBoard.current = boardOf(mRef.current);
      let j = await call({ action: 'save-meeting', meeting: mRef.current, base: base.current });
      // (saved meanwhile again while this one merged: merged again, a few times at most)
      for (let n = 0; n < 3 && j.status === 409 && j.current; n++) {
        // Saved meanwhile (Holly, the calendar, board mail, another tab taking it off the board page): both sets of
        // changes, item by item. Merged with what's on the page now, never the copy that went: anything typed while that
        // save was on its way is kept, and goes with this one (only the same thing changed both ways asks). A field
        // changed only there is theirs, so a tab opened before never sends back what it had (the site judges a save by
        // what it changes: functions/api/_board.js saveMeeting)
        // (someone renamed on People since this copy was read: followed here too, in what it opened and what's on it now,
        // as the site followed them in this save, before anything is merged. Board QA round 9)
        const opened = saved.current;
        if (j.addressesNow) {
          const moves = j.addressesNow;
          saved.current = cleanMeeting(followAddresses(saved.current, moves, { people: pickable(data.people) }));
          setM((x) => followAddresses(x, moves, { people: pickable(data.people) }));
        }
        const was = saved.current;
        const theirs = cleanMeeting(j.current);
        const { clashes } = mergeMeeting(was, cleanMeeting(mRef.current), theirs);
        let prefer = 'mine';
        if (clashes.length) {
          // (everyone whose save changed what clashes: the copy this page opened and each save since, every one with the
          // renames' addresses followed as the site follows them, so a rename's own rewrite is never a change of its own)
          const follow = (x) => (j.addressesNow ? cleanMeeting(followAddresses(x, j.addressesNow)) : x);
          const who = clashWho({ clashes, was: follow(opened), mine: cleanMeeting(mRef.current), saves: j.saves, savers: j.savers, by: j.current.updatedBy, shape: (d) => cleanMeeting(d), follow });
          const keepMine = await ask(clashQuestion({ by: j.current.updatedBy, me: data.me, what: 'this meeting', clashes, who, unknown: who === null }));
          if (!keepMine) prefer = 'theirs';
        }
        saved.current = theirs;
        base.current = j.current.updatedAt;
        setM((x) => ({ ...x, ...serverSet(j.current), ...editableOf(mergeMeeting(was, cleanMeeting(x), theirs, { prefer }).merged) }));
        sent = editable(mRef.current);
        sentBoard.current = boardOf(mRef.current);
        j = await call({ action: 'save-meeting', meeting: mRef.current, base: base.current });
      }
      return { ...j, sent };
    },
    took: (j) => {
      const was = saved.current;
      saved.current = cleanMeeting(j.meeting);
      base.current = j.meeting.updatedAt;
      // The site's copy onto the one being edited (onto): what only the server sets (its files, the packet, the invite, the
      // minutes read in, whether it's a board meeting at all), and every field not changed here since the copy this save
      // went from, as the site has it now (Who's coming follows People → Board); what's been changed here is kept, typed
      // since included. Each report's writer and time come from the site's copy
      // (someone renamed on People named here at an address they've left: at their new one, as the site saved it,
      // functions/api/_board.js addressesNow)
      setM((x) => {
        const next = onto(x, j.meeting, was);
        return followAddresses(next.sections === x.sections ? { ...next, sections: stampsFrom(x.sections, j.meeting) } : next, j.meeting.addressesNow, { people: pickable(data.people) });
      });
      ours.current = j.meeting;
      putMeeting(j.meeting);
      // The site's copy names another board than the one this save sent: People → Board changed since Board's data was
      // read, so it's read again, and everything here that names the board (the invite and who's missing from it, the
      // email's "It goes to", the secretary, every send's question) follows the site's list. QA round 5, Nov 21 2026: a
      // tab open while People → Board changed showed Who's coming right, and named the old board everywhere else
      if (!practice && boardOf(j.meeting) !== sentBoard.current) ctx.load();
      return j.meeting.updatedAt;
    },
    // Refused for good, by name (functions/api/_board.js holdShare, saveMeeting): those fields put back as the site has
    // them now (the refusal carries the meeting as it is), never from this tab's own copy, which may be older
    refused: (j) => {
      // (what approved minutes state changed here: refused whole by the site, in its words, nothing changed. That part is
      // put back as the site has it, what was typed into it kept beside the agenda to copy (typedOver), and the rest goes.
      // A tab whose minutes were approved elsewhere meanwhile, above all. functions/api/_board.js keepStated, Board QA
      // round 15)
      if (j.status === 409 && Array.isArray(j.refused) && j.refused.includes('stated')) {
        const sv = saved.current;
        const over = typedOver(mRef.current, sv);
        if (over.length) setTyped((t) => [...t.filter((x) => !over.some((y) => y.key === x.key)), ...over]);
        setM((x) => withStated(x, sv));
        return 'Not saved';
      }
      // (approved minutes' own file put on an item: it comes off the items here, as the site has it on none, and the rest
      // goes. functions/api/_board.js saveMeeting, Board QA round 11)
      if (j.status === 409 && Array.isArray(j.refused) && j.refused.includes('docs') && j.fileId) {
        setM((x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => ((it.docs || []).includes(j.fileId) ? { ...it, docs: it.docs.filter((d) => d !== j.fileId) } : it)) })) }));
        return 'Not put with the item';
      }
      const fields = j.status === 409 && Array.isArray(j.refused) ? j.refused.filter((f) => EDITABLE.includes(f)) : [];
      if (!fields.length) return '';
      const sv = j.meeting ? cleanMeeting(j.meeting) : saved.current;
      setM((x) => ({ ...x, ...Object.fromEntries(fields.map((f) => [f, sv[f]])) }));
      return fields.includes('shared') ? (sv.shared ? 'Still on the board page' : 'Not on the board page')
        : fields.includes('minutes') ? (sv.minutes === 'approved' ? 'Still approved' : 'Not marked approved') : 'Not saved';
    },
  });
  const key = editable(m);
  useEffect(() => {
    // (checked in soon, not at render: a save may have landed in between)
    soon(right.current ? 0 : 1200);
    right.current = false;
  }, [key]);
  // Deleted elsewhere: back to every meeting, as the site has them now
  const gone = () => { ctx.load(); go({}); };

  /**
   * The server's copy of this meeting (an action's answer) onto the one here. It's the site's copy, so it's what the
   * page has from the site now (saved, base, Board's data); anything changed here that the site hasn't got (typed since
   * the last save, or a save that didn't go: no connection, refused) is merged onto it item by item (mergeMeeting, as a
   * save meeting someone else's does), stays pending and saves after, never "Saved" while it waits. QA round 6, Nov 21
   * 2026: an answer taken while typing hadn't saved put the site's copy over the typing and said Saved
   */
  // (`looked`: the copy came from Board's data read again, which is in Board's data already and names the board as the
  // site has it: nothing to put there or read again)
  const take = (sv, { looked = false } = {}) => {
    const was = saved.current;
    saved.current = cleanMeeting(sv);
    base.current = sv.updatedAt;
    setM((x) => {
      if (editable(x) === editable(was)) return { ...x, ...sv };
      const { merged } = mergeMeeting(was, cleanMeeting(x), saved.current);
      return { ...x, ...serverSet(sv), ...editableOf(merged) };
    });
    ours.current = sv;
    if (!looked) putMeeting(sv);
    if (editable(mRef.current) !== editable(saved.current)) setTimeout(save, 0); else savedNow(sv.updatedAt);
    // The site's copy names another board than the page had: People → Board changed since Board's data was read, so it's
    // read again, as a save's answer does (took), and the status line, "It goes to N" and the secretary follow who it
    // went to. QA round 6, Nov 21 2026: an invite sent to the new board left the page naming the old one
    if (!practice && !looked && boardOf(sv) !== boardOf(was)) ctx.load();
  };
  // Board's data read again (the tab back in view, the window's focus, before a send's question, a save showing People →
  // Board changed): this meeting as the site has it now comes onto the page. The copy the page last had from the site
  // (the same updatedAt): what the site works out for it (Who's coming as People → Board has it, its files, its invite)
  // is shown, and what's been changed here stays (onto). A copy saved since, elsewhere (another tab sent the invite,
  // emailed the board, marked the minutes approved): with nothing unsaved here it simply takes the page's place; with
  // typing not saved yet it comes in under it, item by item, as a save's merge does (take), so nothing typed is lost
  // and nothing done elsewhere is hidden. Only the same thing changed both ways waits for the save, whose merge asks
  // which to keep (what only the site sets comes in now all the same). An older copy than the page's (a look that left
  // before a save landed) changes nothing. QA round 7, Nov 21 2026: a tab never showed the invite another had sent,
  // and its stale Email the board asked the first-time question and emailed the board twice
  useEffect(() => {
    if (meeting === ours.current) return;
    ours.current = meeting;
    // (a practice meeting too: its page reads it again with Board's data, ./board-admin.js PracticeMeeting. Round 9)
    if (stopped()) return;
    const at = String(meeting.updatedAt || '');
    if (at < String(base.current || '')) return;
    if (at === base.current) {
      const was = saved.current;
      saved.current = cleanMeeting(meeting);
      setM((x) => onto(x, meeting, was));
      return;
    }
    const mine = cleanMeeting(mRef.current);
    if (editable(mine) !== editable(saved.current) && mergeMeeting(saved.current, mine, cleanMeeting(meeting)).clashes.length) {
      setM((x) => ({ ...x, ...serverSet(meeting) }));
      return;
    }
    take(meeting, { looked: true });
  }, [meeting]);
  /**
   * A send told it's going out from somewhere else (another tab, the other founder, the agenda's approval: 409
   * `sending`, `lookAgain`): Board's data looked at again by itself every two seconds until this meeting as the site has
   * it shows the send gone (what it keeps on the meeting, written once it has: the meeting then comes onto the page, so
   * it shows it sent with its "again" press), or the send's hold has lapsed (two minutes). Board QA round 12, Nov 23
   * 2026: that tab said "Board emailed: Not yet" with the first-time button for good
   */
  const following = useRef(0);
  useEffect(() => () => { following.current = -1; }, []);
  const sentOf = (x) => JSON.stringify([x?.packetSentAt || '', x?.minutesSentAt || '', x?.invite?.updatedAt || '']);
  const followSend = (was) => {
    if (following.current < 0) return;
    const run = ++following.current;
    const until = Date.now() + 130 * 1000;
    const tick = async () => {
      if (following.current !== run || Date.now() > until) return;
      const look = await ctx.load({ quick: true }).catch(() => null);
      const now = look?.ok ? (look.meetings || []).find((x) => x.id === m.id) : null;
      if (now && sentOf(now) !== sentOf(was)) return;
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
  };
  /**
   * An action the server takes on the saved meeting: anything typed is saved first. → the answer, or null when it didn't
   * happen. An answer that never came back (./board-ui.js answerLost) may have happened all the same: the page looks at
   * what the site has now and puts it here, and `lost({ was, now, look })` says what that shows in place of an error
   * ({ text, known: the record says whether it went, bad: it didn't happen }), so nothing reads "HTTP 502" and nothing
   * looks undone that may be done. `settled(j)`: the site answered that it went (or is going out right now)
   */
  const act = async (body, { keep = null, lost = null, settled = null } = {}) => {
    // A change made a moment ago (Start, just before the numbers lock) reaches the copy being saved first
    await new Promise((r) => setTimeout(r, 0));
    await save();
    const was = mRef.current;
    const j = await call(body);
    if (!j.ok && answerLost(j)) {
      const look = await ctx.load();
      const now = look?.ok ? (look.meetings || []).find((x) => x.id === m.id) || null : null;
      if (now) take(now);
      const said = lost?.({ was, now, look }) || { text: `${LOST}, so this page can’t tell whether that went through.${now ? ' It shows what the site has now.' : ' Reload the page to see what the site has now.'}`, known: false };
      addToast(said.text, said.known && !said.bad ? 'info' : 'error');
      return null;
    }
    if (!j.ok) {
      // The site's own no can carry the meeting as it is now: the same email going out right now, or gone in the last ten
      // minutes (functions/api/_board.js sendOnce: 409 { sending | already }), or Resend not answering, or minutes a read
      // can't go over (approved, typed, read in meanwhile). It goes on the page (a second tab shows "Email again", not
      // "Email the board"; approved minutes show as approved), whoever says the no, and a send already going or gone is
      // said as news. Board QA round 12: a no kept for the press's own words left the page as it was
      if (j.meeting) take(j.meeting);
      else if (j.reread) ctx.load({ quick: true });
      if (keep?.(j)) return j;
      const went = !!(j.sending || j.already);
      if (went) settled?.(j);
      if (j.sending && j.lookAgain) followSend(j.meeting || mRef.current);
      addToast(sentence(j.error || 'That didn’t go through. Try again.'), went ? 'info' : 'error');
      return null;
    }
    if (j.meeting) take(j.meeting);
    settled?.(j);
    // Done, and a read for the answer didn't answer (functions/api/board-admin.js after): the page looks again by itself,
    // and shows what the site has a moment later (Board QA round 11)
    if (j.reread) ctx.load({ quick: true });
    return j;
  };
  const remove = async () => {
    // Named with its day: two meetings in one quarter can have the same name. Its invite is cancelled unless it's a
    // record (./board-shared.js inviteIsRecord), judged on the meeting as the site has it, as the site judges it
    const cancels = !!saved.current.invite?.eventId && !inviteIsRecord(saved.current);
    if (!(await ask({ title: `Delete the ${meetingName(m)}${m.date ? ` on ${longDate(m.date)}` : ''}?`, text: `Its agenda, notes, minutes and files go for good. Board members stop seeing it.${cancels ? ' Its calendar invite is cancelled too, and Google emails everyone on it.' : ''}`, yes: 'Delete', danger: true }))) return;
    cancel();
    saved.current = cleanMeeting(mRef.current);
    const j = await call({ action: 'delete-meeting', id: m.id });
    if (!j.ok) { addToast(sentence(j.error), 'error'); return; }
    markDirty(false);
    ctx.setData((d) => ({ ...d, meetings: d.meetings.filter((x) => x.id !== m.id) }));
    addToast(`Deleted the ${meetingName(m)}${m.date ? ` (${shortDate(m.date)})` : ''}`, 'info');
    // (its invite's cancel still to go, by itself: said. Board QA round 15)
    if (j.later) addToast(j.later, 'info');
    // (back on the list, the focus goes to its heading: ./board-admin.js BoardArea)
    go({});
  };
  /**
   * A change the server already has (a file added, renamed or deleted, a ticked action): onto the page's copy, and onto
   * the site's copy the page last had (saved, and Board's data), so it isn't "unsaved". What goes into Board's data is
   * the SITE's copy with that change, never the page's own: the page's may have typing the site hasn't got, which
   * Board's data then passed back as the site's ([meeting] below), and that typing was never saved. QA round 6, Nov 21
   * 2026: a file added before the autosave (or with no connection) lost what was typed, and the line said Saved
   */
  const keepSaved = (fn) => {
    const once = (x) => { const y = fn(x); return { ...y, files: (y.files || []).filter((f, i, all) => all.findIndex((g) => g.id === f.id) === i) }; };
    saved.current = cleanMeeting(once(saved.current));
    setM((x) => once(x));
    const site = once(ours.current);
    ours.current = site;
    putMeeting(site);
  };

  const numbers = m.snapshot || data.numbers;
  const [focusId, setFocusId] = useState('');
  // The presentation in its own window: shared with the board or not (only Board's admins can open one that isn't)
  const present = () => openScreen(m.id);
  // Approved minutes in Board: what they state shows read-only, with the way to take the approval back (MinutesStay)
  const stay = {
    locked: !practice && minutesKept(m), typed, forget: () => setTyped([]),
    unlock: async () => { if (await pressSave({ set, save, saved, addToast }, ...approvalPress(false))) addToast('Back to draft minutes', 'info'); },
  };
  const p = { m, set, setNow, ctx, act, take, save, numbers, keepSaved, saved, practice, stay, onFocusItem: setFocusId, openWhere: () => setEditWhere(true), closeWhere: () => { setEditWhere(false); requestAnimationFrame(() => document.getElementById('bm-where-toggle')?.focus()); } };

  const days = daysFrom(m.date);
  // Where it is in its life: ahead (getting it to the board), its day (present it), held (the minutes): a meeting is
  // held once its day is over, or once its end time has passed on the day (the secretary's minutes may come that
  // afternoon), or once the chair has ended it (one moved up and held early is held, whatever its date says). The same
  // rule the site keeps its invite by (./board-shared.js meetingHeld)
  const phase = practice ? 'today' : meetingHeld(m) ? 'held' : !m.date || days > 0 ? 'ahead' : 'today';
  const when = phase === 'held' ? ['Held', 'is-held'] : [whenWords(days), days === 0 ? 'is-today' : days > 0 ? 'is-ahead' : ''];
  const place = [m.location, m.address].filter(Boolean).join(', ');
  const path = pathOf(m, data, phase);
  // The status line stays at the top as the page scrolls. Its height goes on the page (--bm-path-h) for whatever sticks
  // or is scrolled to below it. Too narrow for every step (one row that scrolls sideways), the next one is brought into
  // view, and again when the window turns; with a mouse, ‹ and › at its ends go to the steps out of sight
  const pathRef = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const edges = () => {
    const ol = pathRef.current?.querySelector('ol');
    if (!ol) return;
    const l = ol.scrollLeft > 2;
    const r = ol.scrollLeft + ol.clientWidth < ol.scrollWidth - 2;
    setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
  };
  const slide = (d) => {
    const ol = pathRef.current?.querySelector('ol');
    ol?.scrollBy({ left: d * ol.clientWidth * 0.7, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const nextStep = path.find((s) => s.state === 'next')?.id || '';
  const showNext = () => {
    const ol = pathRef.current?.querySelector('ol');
    const li = ol?.querySelector('.is-next');
    if (!li || ol.scrollWidth <= ol.clientWidth) return;
    const o = ol.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    ol.scrollLeft += r.left - o.left - (o.width - r.width) / 2;
  };
  useEffect(() => {
    const nav = pathRef.current;
    if (!nav) return undefined;
    const root = document.documentElement;
    let wide = 0;
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--bm-path-h', `${nav.offsetHeight}px`);
      if (nav.offsetWidth !== wide) { wide = nav.offsetWidth; showNext(); }
      edges();
    });
    ro.observe(nav);
    // What the keyboard or the page focuses comes out from under the line, all of it (the browser's own scroll stops at
    // the window's top). A step on the line is always in view, yet the browser scrolls the page for it anyway: the page
    // goes back to where it was before it draws, and the step slides into the line's view, clear of ‹ and ›. Never a
    // click, so nothing moves under the pointer
    let pointer = 0;
    let tabY = 0;
    let tabAt = 0;
    const down = () => { pointer = performance.now(); };
    const key = (e) => { if (e.key === 'Tab') { tabY = scrollY; tabAt = performance.now(); } };
    const onFocus = (e) => {
      const el = e.target;
      if (performance.now() - pointer < 600) return;
      if (nav.contains(el)) {
        const y = performance.now() - tabAt < 300 ? tabY : scrollY;
        requestAnimationFrame(() => {
          el.closest('li')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          scrollTo({ top: y, behavior: 'instant' });
        });
        return;
      }
      if (!el.closest?.('.bd') || el.closest('[popover], dialog')) return;
      requestAnimationFrame(() => clearOfLine(el));
    };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    addEventListener('focusin', onFocus);
    return () => { ro.disconnect(); root.style.removeProperty('--bm-path-h'); removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); removeEventListener('focusin', onFocus); };
  }, [practice]);
  useEffect(showNext, [nextStep]);
  // The status line's steps go to the card that does them
  // (lit once the page stops there: a long way on a phone scrolls longer than the light lasts. A second step a moment
  // later lights its card the whole time, not cut short by the first one's timer)
  const lit = useRef({});
  const toCard = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    clearTimeout(lit.current.t);
    cancelAnimationFrame(lit.current.f);
    lit.current.el?.classList.remove('is-found');
    el.classList.remove('is-found');
    let y = NaN;
    let still = 0;
    let frames = 0;
    const there = () => {
      still = scrollY === y ? still + 1 : 0;
      y = scrollY;
      if (still < 3 && ++frames < 180) { lit.current.f = requestAnimationFrame(there); return; }
      el.classList.add('is-found');
      lit.current.t = setTimeout(() => el.classList.remove('is-found'), 1600);
    };
    lit.current = { el, f: requestAnimationFrame(there) };
  };
  const work = html`<div class="bm-work" id="bm-work">
    <${AgendaEditor} ...${p} />
    <${AgendaStage} m=${m} focusId=${focusId} meetings=${data.meetings} onOrder=${(id, order) => set(withItem(id, () => ({ slideOrder: order })))} onSince=${(off) => set({ noSince: off })} />
  </div>`;
  return html`
    <div class="bm-top" data-meeting=${m.id}>
      <div class="bm-top__bar">
        <a class="bd-back" href="#board" onClick=${(e) => { e.preventDefault(); go({}); }}>← All meetings</a>
        <div class="bd-actions">
          <${SaveState} st=${st} save=${save} />
          <button type="button" class=${`btn btn-sm bm-present ${phase === 'today' ? 'btn-primary' : 'btn-ghost'}`} onClick=${present}
            title="The agenda and its documents as slides, in their own window: → and ← or a clicker move them. Share it on Google Meet or put it on the TV">${phase === 'ahead' ? 'Preview the presentation' : phase === 'today' ? 'Present' : 'See the presentation'}</button>
          <${Menu} label="More for this meeting" items=${[
            { icon: 'open', label: 'Open it on the board page', run: () => window.open(`${PAGE}${m.shared ? '' : '?as-board'}#/meetings/${m.id}`, '_blank', 'noopener') },
            !practice && { divider: true },
            !practice && { icon: 'trash', label: 'Delete this meeting', danger: true, run: remove },
          ]} />
        </div>
      </div>
      <div class="bm-title">
        <span class=${`bm-when ${when[1]}`}>${when[0]}</span>
        <h2 tabindex="-1" data-page-head>${meetingName(m)}</h2>
        <p class="bm-facts">
          <span>${[longDate(m.date), timeRange(m.start, m.end)].filter(Boolean).join(' · ') || 'No date yet'}</span>
          <span>${place || html`<button type="button" class="bm-link" onClick=${() => setEditWhere(true)}>Add the place</button>`}</span>
          ${/^https?:\/\/\S+\.\S+/i.test(m.video || '') ? html`<span><a class="link" href=${m.video} target="_blank" rel="noopener">${callName(m.video)}</a></span>` : null}
          <button type="button" class="bm-link" id="bm-where-toggle" aria-expanded=${editWhere} aria-controls="bm-where" onClick=${() => setEditWhere(!editWhere)}>Change when and where</button>
        </p>
      </div>
    </div>
    ${st.s === 'gone' ? html`<div class="notice notice--warn bm-gone" role="alert"><div class="notice__body"><strong>This meeting was deleted</strong> in another tab or by someone else, so what’s typed here can’t be saved.
      <div class="bd-inline" style="margin-top:0.5rem"><button type="button" class="btn btn-primary btn-sm" onClick=${gone}>Back to all meetings</button></div></div></div>` : null}
    ${practice ? null : html`<nav class="bm-path" aria-label="Where this meeting stands" ref=${pathRef}>
      <ol onScroll=${edges}>${path.map((s) => html`<li key=${s.id} class=${`bm-path__step is-${s.state}`} aria-current=${s.state === 'next' ? 'step' : null}>
        <${s.card ? 'button' : 'span'} type=${s.card ? 'button' : null} class="bm-path__btn" onClick=${s.card ? () => toCard(s.card) : null}>
          <span class="bm-path__dot" aria-hidden="true">${s.state === 'done' ? CHECK : null}</span>
          <span class="bm-path__words"><span class="bm-path__t">${s.title}</span><span class="bm-path__s">${s.sub}</span></span>
        </${s.card ? 'button' : 'span'}>
      </li>`)}</ol>
      ${edge.l ? html`<button type="button" class="bm-path__more is-back" tabindex="-1" aria-label="The steps before these" onClick=${() => slide(-1)}>‹</button>` : null}
      ${edge.r ? html`<button type="button" class="bm-path__more is-on" tabindex="-1" aria-label="The steps after these" onClick=${() => slide(1)}>›</button>` : null}
    </nav>`}
    ${editWhere ? html`<${WhenWhere} ...${p} />` : null}
    ${phase === 'held' ? html`
      <div class="bm-row">
        <div class="bm-row__main" id="bm-minutes"><${MinutesDrop} ...${p} /><${MinutesDoc} ...${p} /></div>
        <div class="bm-row__side" id="bm-after"><${WrapUp} ...${p} />${m.minutesFrom ? null : html`<${MinutesTemplate} ...${p} />`}</div>
      </div>
      ${work}
      <${FilesCard} ...${p} title="Every file" sub="All of this meeting’s files. A staff-only file never reaches the board page." />`
    : html`
      ${work}
      ${phase === 'today' ? html`<div class="bm-row">
        <div class="bm-row__main" id="bm-minutes"><${MinutesDrop} ...${p} /></div>
        <div class="bm-row__side"><${WrapUp} ...${p} /></div>
      </div>` : null}
      <div class="bm-row" id="bm-ready">
        <div class="bm-row__main"><${GettingReady} ...${p} /></div>
        <div class="bm-row__side"><${Coming} ...${p} />${m.minutesFrom ? null : html`<${MinutesTemplate} ...${p} />`}</div>
      </div>
      <${FilesCard} ...${p} goes title="The packet" sub="Each file goes under its agenda item, on the board page and on the screen. PDF, pictures, Word, Excel or PowerPoint, up to 50 MB." />`}`;
}

/** Who a meeting's invite goes to: the board members with an email, and Board's admins */
const inviteGuests = (data) => [...new Set([...data.members.map((x) => x.email).filter(Boolean), ...data.settings.admins])];
/** Who should be on a meeting's invite and isn't (someone added to the board after it went): none before it's sent */
export const inviteMissing = (m, data) => (m.invite ? inviteGuests(data).filter((e) => !(m.invite.emails || []).includes(e) && e !== m.invite.organizer) : []);
/** A guest by name: the board member's, else the first part of their email */
const guestName = (e, data) => data.members.find((x) => x.email === e)?.name || firstOf(e);

/**
 * Where a meeting stands, step by step: the agenda, the invite, the approval, the board page, the email, the day, the
 * minutes. The one rule for what's next: the line under a meeting's name, its Getting ready, and the next meeting on
 * Board's home (./board-admin.js NextCard) all read it, so they never name different next steps. Each step is done,
 * the next one, still to come, or (`skip`) left undone by a meeting that's been held: something that no longer applies
 * (an invite Board never sent, an email that didn't go before it), said as what happened, never as a chore. `card` is
 * where it's done (none once the meeting is held and its card is gone; the board page is After the meeting's, beside the
 * minutes); `todo` says it as the next thing to do ("approve the agenda"). `phase`: ahead | today | held (MeetingEditor)
 */
export function pathOf(m, data, phase) {
  const items = agendaItems(m);
  const itemOf = (x) => m.sections[x.si].items[x.ii];
  const asked = items.filter((x) => reportsOn(itemOf(x)));
  const reportsIn = asked.filter((x) => itemOf(x).report).length;
  const inv = m.invite;
  const held = phase === 'held';
  // Not a board meeting: no calendar invite goes out for it (./board-shared.js noInviteFor, the site's rule), so it's
  // never the next step, here or on Board's home, and nothing offers one
  const offBoard = !!m.notBoard;
  const missing = held || offBoard ? [] : inviteMissing(m, data);
  const ready = held ? '' : 'bm-ready';
  const approval = data.approvals?.[m.id];
  // Held: what the agenda was, and the reports written for it (never "0 of 3": reports were asked for before the day,
  // and an item the minutes add after was never asked for one)
  const written = items.filter((x) => itemOf(x).report).length;
  const steps = [
    held ? { id: 'agenda', card: 'bm-work', title: 'Agenda', done: items.length > 0, skip: !items.length, sub: items.length ? [plural(items.length, 'item'), written ? plural(written, 'report') : ''].filter(Boolean).join(' · ') : 'None in Board' }
      : { id: 'agenda', card: 'bm-work', title: 'Agenda', done: items.length > 0 && reportsIn === asked.length, sub: !items.length ? 'Nothing on it yet' : asked.length ? `${plural(items.length, 'item')} · ${reportsIn} of ${plural(asked.length, 'report')} in` : plural(items.length, 'item'), todo: !items.length ? 'put something on the agenda' : `the reports, ${reportsIn} of ${asked.length} in so far` },
    { id: 'invite', card: ready, title: 'Invite', done: !!inv && !missing.length, skip: (held || offBoard) && !inv,
      sub: inv ? [`On ${firstOf(inv.organizer)}’s calendar`, missing.length ? `${andList(missing.map((e) => guestName(e, data)))} not on it` : ''].filter(Boolean).join(' · ') : held ? 'None sent from Board' : offBoard ? 'None: not a board meeting' : m.inviteGone ? 'Deleted in Google Calendar' : 'Not sent',
      todo: inv ? `add ${andList(missing.map((e) => guestName(e, data)))} to the invite` : m.inviteGone ? 'send the invite again (it was deleted in Google Calendar)' : 'send the invite' },
    ...(held ? [] : [{ id: 'approved', card: ready, title: 'Approved', done: !!approval, sub: approval ? `${String(approval.by).split(' ')[0]}, ${dayOf(approval.at)}` : 'Not yet', todo: 'approve the agenda' }]),
    { id: 'shared', card: held ? 'bm-after' : 'bm-ready', title: 'Board page', done: !!m.shared, sub: m.shared ? 'The board can see it' : 'Only you can see it', todo: 'put the meeting on the board page' },
    { id: 'emailed', card: ready, title: 'Board emailed', done: !!m.packetSentAt, skip: held && !m.packetSentAt, sub: m.packetSentAt ? `${plural(m.packetSentTo || 0, 'member')}, ${dayOf(m.packetSentAt)}` : held ? 'Not before the meeting' : 'Not yet', todo: 'email the board the link to the agenda and documents' },
    { id: 'day', card: 'bm-work', title: phase === 'today' ? 'Today' : held ? 'Held' : 'The meeting', done: held, sub: [m.date ? shortDate(m.date) : 'No date yet', m.start ? clock(m.start) : ''].filter(Boolean).join(' · ') },
    // (whether they're in is one fact, minutesIn, as After the meeting's card and Home go by: a file of them filed by its
    // name is the minutes in, never "Drop them in" (Board QA round 13); a file the board can't read, kept Staff only, is
    // said as that, never "In": minutesStaffOnly, round 14; approved ones too, which the board can't read yet: round 15)
    { id: 'minutes', card: phase === 'ahead' ? 'bm-work' : 'bm-minutes', title: 'Minutes', done: m.minutes === 'approved', sub: m.minutes === 'approved' ? `Approved${m.approvedOn ? ` ${shortDate(m.approvedOn)}` : ''}${approvedNotShared(m) ? ', staff only' : ''}` : minutesStaffOnly(m) ? 'Staff only, not shared' : !minutesIn(m) ? (held ? 'Drop them in' : 'After the meeting') : m.minutesFrom?.typed ? `${typedWords(m, data)}, to approve next time` : m.minutesFrom ? 'Read in, to approve next time' : 'In, to approve next time' },
  ];
  // The next step: the first one not done (before the day, the agenda's reports count only once the rest is out)
  const order = (held ? ['minutes'] : phase === 'today' ? ['invite', 'approved', 'shared', 'emailed', 'day'] : ['invite', 'approved', 'shared', 'emailed', 'agenda'])
    .filter((id) => !(id === 'invite' && offBoard && !inv));
  const next = order.find((id) => !steps.find((s) => s.id === id).done) || (held ? '' : 'day');
  return steps.map(({ skip, ...s }) => ({ ...s, state: s.done ? 'done' : s.id === next ? 'next' : skip ? 'skip' : 'todo' }));
}

// ─── When and where ─────────────────────────────────────────────────

function WhenWhere({ m, set, closeWhere, stay = null }) {
  // Opened: the focus goes into it; Escape closes it
  const head = useRef(null);
  useEffect(() => { head.current?.focus(); }, []);
  const meet = m.invite?.meet || '';
  // Held, with its invite at the time it was held: the invite is a record, and a correction here stays here (the site's
  // rule, ./board-shared.js inviteIsRecord, on the meeting as typed: what the site has once it's saved)
  const record = inviteIsRecord(m);
  const field = (id, label, input) => html`<div class="form-group"><label class="form-label" for=${id}>${label}</label>${input}</div>`;
  // Approved minutes state the meeting's day, time, place and name: shown as they are, never a box to type in, until the
  // approval is taken back (MinutesStay). Board QA round 15
  const locked = !!stay?.locked;
  const fixed = (id, label, text) => html`<div class="form-group" id=${id}><span class="form-label">${label}</span><p class="bm-fixed">${text || html`<span class="bd-muted">None</span>`}</p></div>`;
  return html`<div class="card" id="bm-where" onKeyDown=${(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeWhere(); } }}>
    <div class="bd-card-head bm-where__head"><div><h3 tabindex="-1" ref=${head}>When and where</h3>${m.invite ? html`<p>${record ? 'This meeting has been held, so its calendar invite stays as it was: a change here doesn’t go on it, and nobody is emailed.' : 'A new day, time or place goes on the invite a couple of minutes after you stop typing, and Google emails the guests once.'}</p>` : null}</div>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${closeWhere}>Done</button></div>
    ${locked ? html`<${MinutesStay} stay=${stay} />` : null}
    <div class="bd-grid3">
      ${locked ? fixed('bd-date', 'Date', longDate(m.date)) : field('bd-date', 'Date', html`<input id="bd-date" class="form-input" type="date" value=${m.date} onInput=${(e) => set({ date: e.target.value })} />`)}
      ${locked ? fixed('bd-start', 'Starts', clock(m.start)) : field('bd-start', 'Starts', html`<input id="bd-start" class="form-input" type="time" value=${m.start} onInput=${(e) => set({ start: e.target.value })} />`)}
      ${locked ? fixed('bd-end', 'Ends', clock(m.end)) : field('bd-end', 'Ends', html`<input id="bd-end" class="form-input" type="time" value=${m.end} onInput=${(e) => set({ end: e.target.value })} />`)}
      ${locked ? fixed('bd-loc', 'Place', m.location) : field('bd-loc', 'Place', html`<input id="bd-loc" class="form-input" value=${m.location} placeholder="Whose office" onInput=${(e) => set({ location: e.target.value })} />`)}
      ${locked ? fixed('bd-addr', 'Address', m.address) : field('bd-addr', 'Address', html`<input id="bd-addr" class="form-input" value=${m.address} placeholder="Street, city" onInput=${(e) => set({ address: e.target.value })} />`)}
      <div class="form-group"><span class="form-label">Video call</span><p class="bm-fixed">${meet ? html`<a class="link" href=${meet} target="_blank" rel="noopener">Google Meet</a>` : html`<span>Google Meet, added with the invite</span>`}</p></div>
      ${locked ? html`<div class="form-group span-3" id="bd-title"><span class="form-label">Name</span><p class="bm-fixed">${meetingName(m)}</p></div>`
        : html`<div class="form-group span-3"><label class="form-label" for="bd-title">Name</label><input id="bd-title" class="form-input" value=${m.title} placeholder=${meetingName({ ...m, title: '' })} aria-describedby="bd-title-hint" onInput=${(e) => set({ title: e.target.value })} />
        <p class="form-hint bm-hint" id="bd-title-hint">${m.title ? 'Empty it to go back to the quarter’s name.' : `Left empty, it’s the “${meetingName({ ...m, title: '' })}”.`}</p></div>`}
      <div class="form-group span-3"><label class="form-label" for="bd-invite-note">Notes for the invite</label><${FitBox} id="bd-invite-note" maxlength="1000" value=${m.inviteNote} placeholder="Parking, which door to use, a gate code" aria-describedby="bd-invite-note-hint" onInput=${(e) => set({ inviteNote: e.target.value })} />
        <p class="form-hint bm-hint" id="bd-invite-note-hint">${record ? 'On the board page and the meeting emails. The calendar invite stays as it was, since the meeting has been held.' : 'On the calendar invite, the board page and the meeting emails. A change updates the invite without emailing anyone.'}</p></div>
    </div>
  </div>`;
}
/** "the day, the times and the place" */
const andList = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] || '');

// ─── Before: the agenda ─────────────────────────────────────────────

/** Where the agenda came from, in words (and whether it's still a draft) */
export function agendaSource(m) {
  const f = m.agendaFrom;
  // Nothing on it (every part taken out): never "Ready", as the status line says
  if (!agendaItems(m).length) return { draft: false, empty: true, label: 'Empty', text: 'Nothing on it yet.' };
  if (agendaIsDraft(m)) {
    const from = f?.kind === 'last-meeting' ? `Built from the ${f.name} agenda: the last minutes up for approval, the makeovers and the money filled in live.` : 'SOARD’s agenda template, with the makeovers and the money filled in live.';
    return { draft: true, label: 'Ready', text: `${from} It’s ready as it is: two weeks before the meeting, whoever presents is asked for a report. Change anything and it saves as you type.` };
  }
  if (f?.kind === 'email') return { draft: false, label: 'From email', text: `From ${fileTitle(f.name)}, emailed${f.at ? ` ${dayOf(f.at)}` : ''}.` };
  if (f?.kind === 'drive') return { draft: false, label: 'From the minutes', text: `Read from ${fileTitle(f.name)} in Google Drive.` };
  return { draft: false, label: 'Ready', text: m.shared ? 'Changes go on the board page as you make them.' : 'Changes save as you type. The board sees them once the meeting is on the board page.' };
}

/**
 * The chip on the item that puts the last minutes to the board: "Up for approval" until they're approved, then said as
 * that ("Approved Dec 3"), as the agenda email and the board page go by (minutesToRead skips approved minutes)
 */
function minutesState(m, it, meetings = []) {
  const prev = it.about ? meetings.find((x) => x.id === it.about) : m.date ? minutesTarget(m, meetings) : null;
  return prev?.minutes === 'approved' ? `Approved${prev.approvedOn ? ` ${shortDate(prev.approvedOn)}` : ''}` : 'Up for approval';
}

/** What a file is, by its name, when it's uploaded (it can be changed after) */
const kindOfName = (name) => (/financ|balance|income|p&l|profit|loss|budget|statement/i.test(name) ? 'financials' : /minutes/i.test(name) ? 'minutes' : /agenda/i.test(name) ? 'agenda' : 'other');
/** One item changed, found by its id (so a change after an upload lands on the right item even if the agenda moved) */
const withItem = (id, fn) => (x) => ({ sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...fn(it) } : it)) })) });

/** An item's name as tall as its words: a long one wraps instead of being cut off (CSS field-sizing where there is it) */
const FITS = typeof CSS !== 'undefined' && !!CSS.supports?.('field-sizing', 'content');
const grow = (el) => { if (!el || FITS) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };

/** A change that moves things (an item or a part dragged, moved up or down), as a view transition: each slides to its place */
function withMotion(fn) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return Promise.resolve(); }
  const t = document.startViewTransition(async () => { fn(); await new Promise((r) => setTimeout(r, 0)); });
  t.ready.catch(() => {});
  setTimeout(() => t.skipTransition?.(), 1200);
  return t.finished.catch(() => {});
}
/** Out from under the meeting's status line, which stays at the top: what moved there or took the focus there */
function clearOfLine(el) {
  const line = document.querySelector('.bm-path');
  if (!el || !line) return;
  const under = line.getBoundingClientRect().bottom + 12 - el.getBoundingClientRect().top;
  if (under > 0) scrollBy({ top: -under, behavior: 'instant' });
}
const LIVE_SHORT = { projects: 'Makeovers board', cash: 'The money', reveals: 'Reveals', events: 'Events', meetings: 'Board meetings' };
const DRAG_ITEM = 'text/x-board-item';
const DRAG_PART = 'text/x-board-part';
const dragKind = (e) => { const t = [...(e.dataTransfer?.types || [])]; return t.includes(DRAG_ITEM) ? 'item' : t.includes(DRAG_PART) ? 'part' : t.includes('Files') ? 'files' : ''; };

/**
 * The agenda, built the way it reads on the board page: the run of show along the top (each part's share of the
 * meeting, its time and where it ends), then the parts as numbered chapters with their minutes, and each item as
 * a card: its number, its name, who presents it (faces, from People), what it shows live, its documents, the
 * background for the board and a private note. Everything is edited in place and saves as you type. Items and
 * parts move by dragging their grip (or ⋯ → Move, or Alt ↑ ↓ in an item's name), and slide to their new places.
 * A file dropped on an item is uploaded and goes with it.
 */
function AgendaEditor({ m, set, ctx, keepSaved, take = null, onFocusItem = () => {}, template = false, stay = null }) {
  const { data, addToast } = ctx;
  // Approved minutes in Board (board-shared.js minutesKept): what their Word file prints from the agenda is what they
  // state (./board-minutes-template.js minutesStated): each part and item printed, in order, its name, time and who
  // presents it, the words under it and the vote it asks for. All of it shows as it is, never a box to type in, and nothing
  // here adds, moves, copies or takes out a part or item that prints, until the approval is taken back (MinutesStay). What
  // the file never prints still changes as ever: a report, a document, Board only, a private note. Board QA round 15
  const locked = !template && !!stay?.locked;
  const printed = (s) => !!(s.title || s.notes || s.items.some(isFilled));
  const setSection = (si, patch) => set((x) => ({ sections: x.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) }));
  const setItem = (si, ii, patch) => set((x) => ({ sections: x.sections.map((s, i) => (i === si ? { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : s)) }));
  const others = youAnd(data.settings.admins, data.me);
  const src = agendaSource(m);
  const people = useMemo(() => pickable(data.people), [data.people]);
  // Who presents, pressed or reached: Board's data read again (ctx.fresh, a quick read, once a few seconds at most), so
  // the list picked from is People as it is now, never the one this page read before a rename on People. Board QA round
  // 8, Nov 21 2026: the template page's list still had a renamed member at their old address, and picking them put it
  // back, for the meetings on the template to follow
  const peopleRead = useRef(0);
  const readPeople = (e) => {
    if (!e.target.closest?.('.bd-who') || Date.now() - peopleRead.current < 5000) return;
    peopleRead.current = Date.now();
    ctx.fresh?.();
  };
  // Each part's time: its own minutes, else its share of the meeting's
  const plan = useMemo(() => sectionPlan(m), [m.sections, m.start, m.end]);
  const labels = useMemo(() => new Map(agendaItems(m).map((x) => [x.id, x.label])), [m.sections]);
  const vf = viewerFiles(m.files);
  const [over, setOver] = useState('');
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(null); // { kind: 'item' | 'part', id }
  const [hint, setHint] = useState(null); // { id, after } where the dragged one would land
  // Items whose report is open to write in (a report reads until Edit, so a long one never fills the agenda)
  const [writing, setWriting] = useState(() => new Set());
  const write = (id, on) => setWriting((w) => { const n = new Set(w); if (on) n.add(id); else n.delete(id); return n; });
  // Getting ready's Reports: a row goes to its item, and one to write opens its editor there, ready to type
  useEffect(() => {
    const go = (e) => {
      const { id, write: open } = e.detail || {};
      if (open) write(id, true);
      setTimeout(() => {
        const li = document.querySelector(`[data-item="${id}"]`);
        li?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        if (!open) li?.querySelector('.agx-item__title')?.focus({ preventScroll: true });
      }, 80);
    };
    addEventListener('agx-report', go);
    // A slide picked beside the agenda: its item brought into view and lit a moment (the focus stays where it is)
    const show = (e) => {
      const li = document.querySelector(`[data-item="${e.detail?.id}"]`);
      if (!li) return;
      const r = li.getBoundingClientRect();
      // Out of view: above the meeting's status line (it stays at the top) or below the window
      const clear = Math.max(80, (document.querySelector('.bm-path')?.getBoundingClientRect().bottom || 0) + 16);
      if (r.top < clear || r.bottom > innerHeight - 24) li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      li.classList.remove('is-found');
      requestAnimationFrame(() => li.classList.add('is-found'));
      setTimeout(() => li.classList.remove('is-found'), 1400);
    };
    addEventListener('agx-go', show);
    return () => { removeEventListener('agx-report', go); removeEventListener('agx-go', show); };
  }, []);
  // After the editor closes (Done, Delete): the focus on what's there now, never lost to the page
  const refocus = (id, sel) => setTimeout(() => document.querySelector(`[data-item="${id}"]`)?.querySelector(sel)?.focus(), 60);
  // Moved up or down: where it went, out from under the status line once the move has played
  const keepClear = (done, sel) => done?.then(() => setTimeout(() => clearOfLine(document.querySelector(sel)), 30));
  // Without field-sizing, each part's and item's name is sized to its words by hand, again when the window changes
  useEffect(() => {
    if (FITS) return undefined;
    const all = () => document.querySelectorAll('.agx-item__title, .agx-sec__title').forEach(grow);
    addEventListener('resize', all);
    return () => removeEventListener('resize', all);
  }, []);
  const attach = async (id, list) => {
    const files = [...(list || [])];
    if (!files.length) return;
    setBusy(id);
    for (const f of files) {
      // (for this item: on a meeting whose minutes are approved, never their minutes. Board QA round 11. Its answer lost:
      // looked for at the site before anything says to try again, never kept twice: sendUp, round 13)
      const j = await sendUp(ctx, f, { ownerType: 'meeting', ownerId: m.id, kind: kindOfName(f.name), forItem: true, place: id });
      if (!j.ok) { addToast(`${f.name}: ${j.error}`, 'error'); continue; }
      // (sent as the minutes when the minutes are approved: an ordinary file of the meeting, and said. Board QA round 10)
      if (j.asFile) addToast(`${docTitle(j.file.name)}: ${j.asFile}`, 'info');
      keepSaved((x) => withFile(x, j.file));
      set(withItem(id, (it) => ({ docs: (it.docs || []).includes(j.file.id) ? it.docs : [...(it.docs || []), j.file.id] })));
    }
    setBusy('');
  };
  // An item taken out of its place and put before `beforeId` in part `toPart` ('' puts it last)
  const moveItem = (id, toPart, beforeId) => withMotion(() => set((x) => {
    let item = null;
    const lifted = x.sections.map((s) => ({ ...s, items: s.items.filter((it) => (it.id === id ? ((item = it), false) : true)) }));
    if (!item) return {};
    return { sections: lifted.map((s) => {
      if (s.id !== toPart) return s;
      const items = [...s.items];
      const at = beforeId ? items.findIndex((it) => it.id === beforeId) : -1;
      items.splice(at < 0 ? items.length : at, 0, item);
      return { ...s, items };
    }) };
  }));
  const movePart = (id, beforeId) => withMotion(() => set((x) => {
    const part = x.sections.find((s) => s.id === id);
    if (!part) return {};
    const rest = x.sections.filter((s) => s.id !== id);
    const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, part);
    return { sections: rest };
  }));
  const endDrag = () => { setDrag(null); setHint(null); setOver(''); };
  /** Where a drag over a row would land it: before or after that row, by which half the pointer is in */
  const half = (e) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  const itemTarget = (s, it) => ({
    onDragOver: (e) => {
      const k = dragKind(e);
      if (k === 'files') { if (template) return; e.preventDefault(); setOver(it.id); return; }
      if (k !== 'item' || drag?.id === it.id) return;
      e.preventDefault();
      const after = half(e);
      if (hint?.id !== it.id || hint.after !== after) setHint({ id: it.id, after });
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setOver(''); } },
    onDrop: (e) => {
      const k = dragKind(e);
      e.preventDefault();
      if (k === 'files') { setOver(''); if (!template) attach(it.id, e.dataTransfer.files); return; }
      if (k !== 'item' || !drag) return;
      const after = half(e);
      const i = s.items.findIndex((x) => x.id === it.id);
      const next = after ? s.items.slice(i + 1).find((x) => x.id !== drag.id) : it;
      moveItem(drag.id, s.id, next?.id || '');
      endDrag();
    },
  });
  // An empty part, or the space under a part's last item, takes an item dropped at its end
  const partEnd = (s) => ({
    onDragOver: (e) => { if (dragKind(e) === 'item') { e.preventDefault(); if (hint?.id !== `end:${s.id}`) setHint({ id: `end:${s.id}`, after: false }); } },
    onDrop: (e) => { if (dragKind(e) !== 'item' || !drag) return; e.preventDefault(); moveItem(drag.id, s.id, ''); endDrag(); },
  });
  const partTarget = (s, si) => ({
    onDragOver: (e) => {
      if (dragKind(e) !== 'part' || drag?.id === s.id) return;
      e.preventDefault();
      const after = half(e);
      if (hint?.id !== s.id || hint.after !== after) setHint({ id: s.id, after });
    },
    onDrop: (e) => {
      if (dragKind(e) !== 'part' || !drag) return;
      e.preventDefault();
      const after = half(e);
      const next = after ? m.sections.slice(si + 1).find((x) => x.id !== drag.id) : s;
      movePart(drag.id, next?.id || '');
      endDrag();
    },
  });
  const grip = (kind, id, label) => html`<button type="button" class="agx-grip" draggable="true" aria-label=${label} title="Drag to move"
    onDragStart=${(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(kind === 'item' ? DRAG_ITEM : DRAG_PART, id); const row = e.currentTarget.closest(kind === 'item' ? '.agx-item' : '.agx-sec'); if (row) e.dataTransfer.setDragImage(row, 24, 20); setDrag({ kind, id }); }}
    onDragEnd=${endDrag}><svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4" /><circle cx="7.5" cy="3" r="1.4" /><circle cx="2.5" cy="8" r="1.4" /><circle cx="7.5" cy="8" r="1.4" /><circle cx="2.5" cy="13" r="1.4" /><circle cx="7.5" cy="13" r="1.4" /></svg></button>`;
  // A report's word beside it (./board-report.js ReportCoach), under it as it reads and as it's written
  const coachFor = (si, ii, it) => ({ part: partFor(m, it.id), admin: true, id: m.id, itemId: it.id, title: it.title, confidential: !!it.confidential, look: it.reportLook || '', onLook: (k) => setItem(si, ii, { reportLook: k }) });
  // A copy of an item right under it, with all it has, its name selected to type over
  const duplicate = (s, si, it) => {
    const copy = copyOfItem(it, uid('i_'));
    keepClear(withMotion(() => setSection(si, { items: s.items.flatMap((x) => (x.id === it.id ? [x, copy] : [x])) })), `[data-item="${copy.id}"]`);
    setTimeout(() => { const name = document.querySelector(`[data-item="${copy.id}"] .agx-item__title`); name?.focus(); name?.select(); }, 140);
  };
  // An item's ⋯: what it can have and doesn't yet; who sees it; moving it; taking things off it
  const itemMenu = (s, si, it, ii) => {
    const named = it.title || LIVE_TITLES[it.live] || 'this item';
    const first = ii === 0 && si === 0;
    const last = ii === s.items.length - 1 && si === m.sections.length - 1;
    // Words typed under it go only once asked: what took a while to write is never one slip away
    const clear = async (what, text, patch) => {
      if (String(text || '').replace(/[-\s]/g, '') && !(await ask({ title: `Remove ${what} on “${named}”?`, text: 'What’s written there goes with it.', yes: 'Remove', danger: true }))) return;
      setItem(si, ii, patch);
      refocus(it.id, '.agx-item__title');
    };
    // (approved minutes: a row that doesn't print stays one; one that prints keeps all it prints. `fixed`)
    const row = locked && !isFilled(it);
    const fixed = locked && isFilled(it);
    return html`<${Menu} label=${`More for ${named}`} items=${row ? [deleteItem(s, si, it, ii, named)] : [
      !locked && !it.presenter && !it.who?.length && !it.showWho && { icon: 'person', label: 'Add who presents', run: () => setItem(si, ii, { showWho: true }) },
      !template && { icon: 'doc', label: 'Add a document', run: () => setItem(si, ii, { showDocs: true }) },
      !template && !it.report && !writing.has(it.id) && { icon: 'report', label: 'Write the report', run: () => write(it.id, true) },
      // What the presenter asks the board to vote on: one line, on the board page, the screen, paper and the minutes template
      !template && !locked && !it.motion && !it.showMotion && { icon: 'report', label: 'Ask the board to vote', run: () => setItem(si, ii, { showMotion: true }) },
      // The live lists are on the item itself (Shows); here only the way in for an item that shows none yet
      !template && !locked && it.live !== 'minutes' && !showsOf(it).length && !it.showShows && { icon: 'live', label: 'Show live numbers…', run: () => setItem(si, ii, { showShows: true }) },
      { divider: true },
      !template && { icon: 'lock', label: 'Board only', hint: 'Its name is never emailed', checked: !!it.confidential, run: () => setItem(si, ii, { confidential: !it.confidential }) },
      // (into the note at once, as "Ask the board to vote" goes into its box: the focus left on ⋯ would open it again)
      !template && !(it.staffNote || it.showStaff) && { icon: 'private', label: 'Private note', hint: `Only ${others}`, run: () => { setItem(si, ii, { showStaff: true }); refocus(it.id, '.bd-notes.is-private'); } },
      !template && { divider: true },
      !locked && { pair: [
        { icon: 'up', label: 'Move up', disabled: first, title: 'Move up (Alt ↑ in its name does it too)', run: () => { keepClear(ii > 0 ? withMotion(() => setSection(si, { items: move(s.items, ii, -1) })) : moveItem(it.id, m.sections[si - 1].id, ''), `[data-item="${it.id}"]`); refocus(it.id, '.bd-menu > summary'); } },
        { icon: 'down', label: 'Move down', disabled: last, title: 'Move down (Alt ↓ in its name does it too)', run: () => { keepClear(ii < s.items.length - 1 ? withMotion(() => setSection(si, { items: move(s.items, ii, 1) })) : moveItem(it.id, m.sections[si + 1].id, m.sections[si + 1].items[0]?.id || ''), `[data-item="${it.id}"]`); refocus(it.id, '.bd-menu > summary'); } },
      ] },
      // (the minutes come up for approval once)
      it.live !== 'minutes' && !locked && { icon: 'copy', label: 'Duplicate', run: () => duplicate(s, si, it) },
      { divider: true },
      !locked && (it.notes || it.showNotes) && { icon: 'remove', label: 'Remove the background', run: () => clear('the background', it.notes, { notes: '', showNotes: false }) },
      !locked && (it.motion || it.showMotion) && { icon: 'remove', label: 'Remove the motion', run: () => clear('the motion', it.motion, { motion: '', showMotion: false }) },
      (it.staffNote || it.showStaff) && { icon: 'remove', label: 'Remove your private note', run: () => clear('your private note', it.staffNote, { staffNote: '', showStaff: false }) },
      it.report && !(fixed && !isFilled({ ...it, report: '' })) && { icon: 'trash', label: 'Delete the report', danger: true, run: async () => { if (await ask({ title: `Delete the report on “${named}”?`, text: `${it.reportBy ? `${it.reportBy} wrote it. ` : ''}The board stops seeing it.`, yes: 'Delete', danger: true })) { write(it.id, false); setItem(si, ii, { report: '' }); refocus(it.id, '.agx-item__title'); } } },
      !fixed && deleteItem(s, si, it, ii, named),
    ]} />`;
  };
  const deleteItem = (s, si, it, ii, named) => ({ icon: 'trash', label: 'Delete the item', danger: true, run: async () => {
    if ((it.notes || it.report) && !(await ask({ title: `Delete “${named}”?`, text: `${it.report ? 'Its report goes with it.' : 'Its notes go with it.'} Its documents stay with the meeting.`, yes: 'Delete', danger: true }))) return;
    // The focus onto what's there now: the next item's name, else the last one's, else the part's "Add an item"
    const next = s.items[ii + 1]?.id || s.items[ii - 1]?.id;
    withMotion(() => setSection(si, { items: s.items.filter((_, j) => j !== ii) }));
    setTimeout(() => (next ? document.querySelector(`[data-item="${next}"] .agx-item__title`) : document.querySelector(`#agx-${s.id} .agx-add`))?.focus(), 140);
  } });
  // Alt ↑ ↓ in an item's name moves it, across parts too
  const keys = (s, si, it, ii) => (e) => {
    // A name is one line, however it wraps
    if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); return; }
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const up = e.key === 'ArrowUp';
    let done = null;
    if (up && ii > 0) done = withMotion(() => setSection(si, { items: move(s.items, ii, -1) }));
    else if (!up && ii < s.items.length - 1) done = withMotion(() => setSection(si, { items: move(s.items, ii, 1) }));
    else if (up && si > 0) done = moveItem(it.id, m.sections[si - 1].id, '');
    else if (!up && si < m.sections.length - 1) done = moveItem(it.id, m.sections[si + 1].id, m.sections[si + 1].items[0]?.id || '');
    keepClear(done, `[data-item="${it.id}"]`);
    // Back into its name once it has moved (the move runs inside a view transition)
    setTimeout(() => document.querySelector(`[data-item="${it.id}"] .agx-item__title`)?.focus(), 120);
  };
  const deletePart = (s, si) => ({ icon: 'trash', label: 'Delete the part', danger: true, run: async () => {
    if ((s.notes || s.items.some((it) => it.notes || it.report)) && !(await ask({ title: `Delete “${s.title || 'this part'}”?`, text: 'Its items and their notes go with it. Their documents stay with the meeting.', yes: 'Delete', danger: true }))) return;
    // The focus onto what's there now: the next part's name, else the last one's, else "Add a part"
    const near = m.sections[si + 1]?.id || m.sections[si - 1]?.id;
    withMotion(() => set((x) => ({ sections: x.sections.filter((_, i) => i !== si) })));
    setTimeout(() => (near ? document.querySelector(`#agx-${near} .agx-sec__title`) : document.querySelector('.agx-addsec'))?.focus(), 140);
  } });
  // The run of show: the meeting's time and what's planned in it
  const total = [...plan.values()].reduce((n, p) => n + p.minutes, 0);
  const s0 = /^\d{2}:\d{2}$/.test(m.start) ? m.start : '';
  const e0 = /^\d{2}:\d{2}$/.test(m.end) ? m.end : '';
  const length = s0 && e0 ? (Number(e0.slice(0, 2)) * 60 + Number(e0.slice(3))) - (Number(s0.slice(0, 2)) * 60 + Number(s0.slice(3))) : 120;
  const overBy = total - length;
  const lastEnd = [...plan.values()].at(-1)?.end || '';
  // Items with something in them, as the board page and the slides count them (a blank row isn't one)
  const itemCount = agendaItems(m).length;
  return html`<div class="card agx">
    ${template ? null : html`    <div class="agx-head">
      <div class="bd-card-head"><h3>Agenda <span class=${`tag ${src.empty ? '' : src.label === 'From email' ? 'tag--info' : 'tag--success'}`}>${src.label}</span></h3>${src.text && !locked ? html`<p>${src.text}</p>` : null}</div>
    </div>
    <nav class="agx-run" aria-label="The run of show">
      ${m.sections.map((s, si) => html`<a class=${`agx-run__part ${s.minutes ? 'is-own' : ''}`} key=${s.id} href=${`#agx-${s.id}`} style=${`flex:${plan.get(s.id)?.minutes || 5} 1 0`} title=${`${s.title || 'A part'}: ${plan.get(s.id)?.minutes} min`}
        onClick=${(e) => { e.preventDefault(); document.getElementById(`agx-${s.id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); }}>
        <b>${String(si + 1).padStart(2, '0')}</b>${(plan.get(s.id)?.minutes || 0) / Math.max(1, total) >= 0.085 ? html`<span>${plan.get(s.id)?.minutes} min</span>` : null}<span class="sr-only">, ${s.title || 'a part'}, ${plan.get(s.id)?.minutes} minutes</span>
      </a>`)}
    </nav>
    <p class="agx-runmeta">
      <span>${s0 ? `Starts ${clock(s0)}` : 'Two hours'}</span>
      <span>${plural(m.sections.length, 'part')} · ${plural(itemCount, 'item')}</span>
      <span class=${overBy > 0 ? 'is-over' : ''}>${overBy > 0 ? `${overBy} min over the meeting’s ${length}` : lastEnd ? `Ends ${clock(lastEnd)}` : `${total} min`}</span>
    </p>`}
    ${!template && stay && (locked || stay.typed.length) ? html`<${MinutesStay} stay=${stay} typedHere />` : null}
    <div class="agx-edit" onFocusIn=${(e) => { const li = e.target.closest?.('[data-item]'); if (li) onFocusItem(li.dataset.item); readPeople(e); }} onPointerDown=${(e) => { const li = e.target.closest?.('[data-item]'); if (li) onFocusItem(li.dataset.item); readPeople(e); }}>
    <ol class="agx-secs">
      ${m.sections.map((s, si) => {
        const t = plan.get(s.id);
        return html`<li class=${`agx-sec ${drag?.id === s.id ? 'is-dragging' : ''} ${hint?.id === s.id ? (hint.after ? 'drop-after' : 'drop-before') : ''}`} key=${s.id} id=${`agx-${s.id}`} style=${`view-transition-name: agx-${s.id}`} ...${partTarget(s, si)}>
        <div class="ag-sec__head agx-sec__head">
          ${locked ? null : grip('part', s.id, `Move the part ${s.title || si + 1}`)}
          <span class="agx-sec__n" aria-hidden="true">${String(si + 1).padStart(2, '0')}</span>
          ${locked ? html`<span class="ag-input ag-input--sec agx-sec__title is-fixed">${s.title || html`<span class="bd-muted">No name</span>`}</span>` : html`<textarea class="ag-input ag-input--sec agx-sec__title" rows="1" aria-label=${`Section ${si + 1}`} aria-describedby=${template && !s.title.trim() ? `agx-unnamed-${s.id}` : null} value=${s.title} placeholder="Name this part" ref=${grow}
            onInput=${(e) => { grow(e.target); setSection(si, { title: e.target.value.replace(/\s*\n\s*/g, ' ') }); }} onKeyDown=${(e) => { if (e.key === 'Enter') e.preventDefault(); }} />`}
          ${template ? null : locked ? html`<span class="ag-mins is-fixed">${t?.start ? html`<span class="ag-mins__at">${clock(t.start)}</span>` : null}<b>${t?.minutes || ''}</b><span>min</span></span>` : html`<label class="ag-mins" title=${s.minutes ? 'The time this part has. Empty shares out the meeting’s time by itself.' : 'Shared out from the meeting’s time by itself. Type minutes to give it its own.'}>
            ${t?.start ? html`<span class="ag-mins__at">${clock(t.start)}</span>` : null}
            <input type="number" min="1" max="600" inputmode="numeric" aria-label=${`Minutes for ${s.title || `section ${si + 1}`}`} value=${s.minutes || ''} placeholder=${String(t?.minutes || '')} onInput=${(e) => setSection(si, { minutes: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })} />
            <span>min</span>
          </label>`}
          ${locked && printed(s) ? null : html`<${Menu} label=${`More for the part ${s.title || si + 1}`} items=${locked ? [deletePart(s, si)] : [
            { pair: [
              { icon: 'up', label: 'Move up', disabled: si === 0, run: () => keepClear(withMotion(() => set((x) => ({ sections: move(x.sections, si, -1) }))), `#agx-${s.id}`) },
              { icon: 'down', label: 'Move down', disabled: si === m.sections.length - 1, run: () => keepClear(withMotion(() => set((x) => ({ sections: move(x.sections, si, 1) }))), `#agx-${s.id}`) },
            ] },
            { divider: true },
            deletePart(s, si),
          ]} />`}
        </div>
        ${template && !s.title.trim() ? html`<p class="agx-sec__unnamed" id=${`agx-unnamed-${s.id}`}>This part isn’t added to new meetings until it has a name.</p>` : null}
        <ul class="ag-items agx-items">
          ${s.items.map((it, ii) => {
            const files = itemFiles(m, it, data.meetings);
            // (never the approved minutes' own file: it stays their minutes, board-shared.js approvedFileOf. Round 11)
            const free = m.files.filter((f) => !(it.docs || []).includes(f.id) && f.kind !== 'signed' && f.id !== approvedFileOf(m));
            const live = it.live && it.live !== 'minutes' ? it.live : '';
            const shows = showsOf(it);
            return html`<li class=${`ag-item agx-item ${over === it.id ? 'is-over' : ''} ${live ? 'has-live' : ''} ${drag?.id === it.id ? 'is-dragging' : ''} ${hint?.id === it.id ? (hint.after ? 'drop-after' : 'drop-before') : ''}`} key=${it.id} data-item=${it.id} style=${`view-transition-name: agx-${it.id}`} ...${itemTarget(s, it)}>
            <div class="ag-item__row agx-item__row">
              ${locked ? null : grip('item', it.id, `Move ${it.title || 'this item'}`)}
              ${labels.get(it.id) ? html`<span class="agx-item__n" aria-hidden="true">${labels.get(it.id)}</span>` : html`<span class="agx-item__n is-blank" aria-hidden="true"></span>`}
              ${locked ? html`<span class="ag-input agx-item__title is-fixed">${it.title || LIVE_TITLES[it.live] || html`<span class="bd-muted">Empty row</span>`}</span>
              ${presentersOf(it, people).length ? html`<span class="ag-item__who agx-who-fixed">${namesText(presentersOf(it, people).map((x) => x.name))}</span>` : null}` : html`<textarea class="ag-input agx-item__title" rows="1" aria-label=${labels.get(it.id) ? `Item ${labels.get(it.id)}` : 'New item'} value=${it.title} placeholder=${LIVE_TITLES[it.live] || 'What’s it about?'} ref=${grow}
                onInput=${(e) => { grow(e.target); setItem(si, ii, { title: e.target.value.replace(/\s*\n\s*/g, ' ') }); }} onKeyDown=${keys(s, si, it, ii)} />
              <${PersonPicker} people=${people} value=${presentersOf(it, people)} label=${`Who presents ${it.title || 'this item'}`} startOpen=${!!it.showWho}
                onClosed=${() => { if (it.showWho) setItem(si, ii, { showWho: false }); }}
                onChange=${(list) => setItem(si, ii, { who: list.filter((x) => x.slug).map((x) => x.slug), guests: list.filter((x) => !x.slug).map((x) => x.name), presenter: namesText(list.map((x) => x.name)) })} />`}
              ${itemMenu(s, si, it, ii)}
            </div>
            ${it.confidential || shows.length || it.showShows || it.live === 'minutes' ? html`<div class="ag-tags agx-tags">
              ${locked ? shows.map((k) => html`<span class="tag" key=${k}>${LIVE_SHORT[k] || LIVE_TITLES[k] || k}</span>`)
              : it.live !== 'minutes' && (shows.length || it.showShows) ? html`<${ShowsPicker} value=${shows} label=${`What ${it.title || 'this item'} shows live`} startOpen=${!!it.showShows}
                onClosed=${() => { if (it.showShows) setItem(si, ii, { showShows: false }); }}
                onChange=${(list) => setItem(si, ii, { live: list[0] || '', also: list.slice(1), showShows: true })} />` : null}
              ${it.live === 'minutes' ? html`<span class="agx-live is-minutes"><span class="agx-live__dot" aria-hidden="true"></span>${minutesState(m, it, data.meetings)}</span>` : null}
              ${it.confidential ? html`<span class="tag tag--warn">Board only</span>` : null}
            </div>` : null}
            ${files.length || it.showDocs || busy === it.id ? html`<div class="ag-docs agx-docs">
              ${files.map((f) => {
                const mine = m.files.some((x) => x.id === f.id);
                return html`<${DocChip} key=${f.id} f=${f} link=${mine ? viewerLink(vf, m.files.indexOf(f)) : viewerLink(viewerFiles([f]), 0)} note=${mine ? '' : 'from the last meeting'}
                  onRemove=${mine ? () => set(withItem(it.id, (x) => ({ docs: (x.docs || []).filter((d) => d !== f.id) }))) : null} />`;
              })}
              ${busy === it.id ? html`<span class="bd-muted">Uploading…</span>` : null}
              ${it.showDocs ? html`<${DocAdder} free=${free} onPick=${(f) => set(withItem(it.id, (x) => ({ docs: [...(x.docs || []), f.id] })))} onUpload=${(list) => attach(it.id, list)} onDone=${() => setItem(si, ii, { showDocs: false })} />` : null}
            </div>` : null}
            ${writing.has(it.id) ? html`<div class="agx-report is-writing">
              <${ReportEditor} value=${it.report} onChange=${(md) => setItem(si, ii, { report: md })} label=${`The report on ${it.title || 'this item'}`} autofocus minHeight=${150} starter=${true}
                onNothing=${async (current) => {
                  if (mdWords(current) && !isNothingNew(current) && !(await ask({ title: `Swap the report on “${it.title || 'this item'}” for “${NOTHING_NEW}”?`, text: 'The words written there go.', yes: 'Swap it', careful: true }))) return;
                  setItem(si, ii, { report: NOTHING_NEW });
                  write(it.id, false);
                  refocus(it.id, '.agx-report__head button, .agx-item__title');
                }}
                status=${html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => { write(it.id, false); refocus(it.id, '.agx-report__head button, .agx-item__title'); }}>Done</button>`}
                coach=${coachFor(si, ii, it)} />
            </div>`
            : it.report ? html`<div class="agx-report">
              <div class="agx-report__head"><span class="agx-report__label">Report</span><span class="agx-report__by">${[it.reportBy, it.reportAt ? ago(it.reportAt) : ''].filter(Boolean).join(' · ')}</span>
                <button type="button" class="btn btn-ghost btn-sm" aria-label=${`Edit the report on ${it.title || 'this item'}`} onClick=${() => write(it.id, true)}>Edit</button></div>
              <${Report} text=${it.report} clamp=${50} />
              <${ReportCoach} ...${coachFor(si, ii, it)} value=${it.report} onChange=${(md) => setItem(si, ii, { report: md })} />
            </div>` : null}
            ${locked ? (it.motion ? html`<div class="agx-motion is-said"><span class="agx-motion__label">The board votes on</span><p class="agx-motion__said">${it.motion}</p></div>` : null)
            : it.motion || it.showMotion ? html`<div class="agx-motion">
              <label class="agx-motion__label" for=${`agx-mo-${it.id}`}>The board votes on</label>
              <textarea id=${`agx-mo-${it.id}`} class="ag-input agx-motion__box" rows="1" maxlength="1000" value=${it.motion || ''} placeholder="Move to …"
                ref=${(el) => { grow(el); if (el && it.showMotion && !it.motion && !el.dataset.focused) { el.dataset.focused = '1'; el.focus({ preventScroll: true }); } }}
                onKeyDown=${(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                onInput=${(e) => { grow(e.target); setItem(si, ii, { motion: e.target.value.replace(/\s*\n\s*/g, ' ') }); }} />
            </div>` : null}
            ${locked ? (it.notes ? html`<div class="agx-said" role="group" aria-label=${`What the minutes say under ${it.title || 'this item'}`}><${Notes} text=${it.notes} /></div>` : null)
            : it.notes || it.showNotes ? html`<${NotesBox} label=${`Background for ${it.title || 'this item'}`} value=${it.notes} placeholder="Background for the board" onChange=${(v) => setItem(si, ii, { notes: v, showNotes: true })} />` : null}
            ${it.staffNote || it.showStaff ? html`<p class="bd-private-label">Only ${others} see this</p><${NotesBox} tone="is-private" label="Your private note" value=${it.staffNote} placeholder="A private note" onChange=${(v) => setItem(si, ii, { staffNote: v, showStaff: true })} />` : null}
            ${over === it.id ? html`<p class="agx-dropnote" aria-hidden="true">Drop to put it with ${it.title || 'this item'}</p>` : null}
          </li>`;
          })}
          ${locked ? null : html`<li class=${`agx-end ${hint?.id === `end:${s.id}` ? 'drop-before' : ''}`} ...${partEnd(s)}><button type="button" class="ag-add agx-add" onClick=${() => { const it = blankItem(); withMotion(() => setSection(si, { items: [...s.items, it] })); setTimeout(() => document.querySelector(`[data-item="${it.id}"] .agx-item__title`)?.focus(), 140); }}>+ Add an item</button></li>`}
        </ul>
      </li>`;
      })}
    </ol>
    ${locked ? null : html`<button type="button" class="ag-add ag-add--sec agx-addsec" onClick=${() => { const id = uid('s_'); withMotion(() => set((x) => ({ sections: [...x.sections, { id, title: '', minutes: 0, items: [blankItem()] }] }))); setTimeout(() => document.querySelector(`#agx-${id} .agx-sec__title`)?.focus(), 140); }}>+ Add a part</button>`}
    ${template ? null : html`<${MoreCard} m=${m} set=${set} ctx=${ctx} keepSaved=${keepSaved} take=${take} />`}
    </div>
  </div>`;
}

/**
 * Approved minutes in Board (board-shared.js minutesKept): one line saying what they state can't change here, with the
 * way to take the approval back (Mark as draft), above the agenda and in When and where, where what they state shows as
 * it is. What was typed into them and refused (approved in another tab meanwhile: functions/api/_board.js keepStated)
 * stays under it (`typedHere`), each piece to copy, until it's put away, whether or not they're still approved.
 * Board QA round 15
 */
function MinutesStay({ stay, typedHere = false }) {
  const [copied, setCopied] = useState('');
  const copy = async (t) => { try { await navigator.clipboard.writeText(t.text); setCopied(t.key); setTimeout(() => setCopied((x) => (x === t.key ? '' : x)), 1500); } catch { /* the words are there to select */ } };
  const typed = typedHere ? stay.typed : [];
  return html`<div class="bm-stay">
    ${stay.locked ? html`<p class="bm-note bm-stay__line" role="note"><span>${MINUTES_STAY}</span><button type="button" class="btn btn-ghost btn-sm" onClick=${stay.unlock}>Mark as draft</button></p>` : null}
    ${typed.length ? html`<div class="bm-stay__typed" role="group" aria-label="Typed here and not saved">
      <p class="bm-stay__head"><strong>Typed here and not saved.</strong> ${stay.locked ? 'Copy what you need, and mark the minutes as draft to change them.' : 'Copy what you need into the minutes.'}</p>
      ${typed.map((t) => html`<div class="bm-stay__piece" key=${t.key}>
        <span class="form-label">${t.label}</span>
        <p class="bm-stay__text">${t.text}</p>
        <button type="button" class="btn btn-ghost btn-sm" onClick=${() => copy(t)}>${copied === t.key ? 'Copied' : 'Copy'}</button>
      </div>`)}
      <button type="button" class="btn btn-ghost btn-sm bm-stay__done" onClick=${stay.forget}>Done with these</button>
    </div>` : null}
  </div>`;
}

/**
 * The agenda template left with a change still on its way (a save on the way out that hasn't gone yet, and keeps trying):
 * opened again before it goes, the template opens with that change, saves it from here, and the one left behind stops,
 * so an older copy never lands over what's typed now. It carries the template as the site had it then and when that was
 * saved, so what it saves still merges with anything saved since
 */
let templateLeft = null; // { sections, stop, seen, base }
/** The template's parts as a meeting's, to merge (mergeMeeting) */
const asMeeting = (sections) => cleanMeeting({ sections });
/** The template as the site keeps it, as one string, to compare (board-shared.js cleanTemplate) */
const templateKey = (sections) => JSON.stringify(cleanTemplate(sections));
/**
 * The agenda every meeting ahead starts from, in the editor a meeting's agenda has (AgendaEditor): its parts and items,
 * and who presents each committee. Saves by itself, as a meeting does (useAutosave), and the meetings nobody has written
 * an agenda for follow at once (functions/api/_board.js maybeTemplateAgendas). Two tabs (or both founders) on it at once
 * merge item by item, as a meeting's agenda does: each save goes over only the template it opened (templateAt), and one
 * saved meanwhile comes back to merge with what's on the page now; only the same thing changed both ways asks.
 */
export function AgendaTemplate({ ctx }) {
  const { data, setData, addToast, go, load, markDirty } = ctx;
  const [left] = useState(() => { const x = templateLeft; templateLeft = null; x?.stop(); return x; });
  const [m, setMeeting] = useState(() => ({ ...cleanMeeting({ sections: left?.sections || data.settings.template }), start: '08:00', end: '10:00', files: [] }));
  // How many meetings ahead took the last save that changed any (functions/api/_board.js maybeTemplateAgendas)
  const [followed, setFollowed] = useState(0);
  const latest = useRef(m);
  latest.current = m;
  // (every change reaches `latest` as it's made, as a meeting's does: a save and a merge start from what's on the page now)
  const setM = (fn) => setMeeting((x) => (latest.current = typeof fn === 'function' ? fn(x) : fn));
  const set = (patch) => setM((x) => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) }));
  // The template as the site has it, last seen (what a merge goes from), and when it was saved then (each save's base)
  const seen = useRef(left?.seen || asMeeting(data.settings.template));
  const base = useRef(left ? left.base : data.settings.templateAt || '');
  // What the site has of it, as it keeps it (board-shared.js cleanTemplate), to know what's changed since: as the site
  // last answered, never as it was sent, so anything the site didn't keep is still a change, and never "Saved"
  const sent = useRef(templateKey(left ? seen.current.sections : m.sections));
  const moved = useRef(false);
  const here = useRef(true);
  // Saved the way a meeting is (useAutosave): a moment after a change, tried again by itself, asked about only while it can't save
  const { st, save, soon, stop, stopped } = useAutosave({
    where: 'the agenda template', markDirty: (d, where) => markDirty?.(d, where), addToast,
    pending: () => templateKey(latest.current.sections) !== sent.current,
    contents: () => templateKey(latest.current.sections),
    send: async () => {
      let sections = latest.current.sections;
      let j = await call({ action: 'save-settings', settings: { template: sections }, base: base.current });
      // (saved meanwhile again while this one merged: merged again, a few times at most)
      for (let n = 0; n < 3 && j.status === 409 && j.current?.template; n++) {
        // Saved meanwhile (another tab, the other founder, a rename on People moving who presents): both sets of changes,
        // item by item, with what's on the page now (anything typed while that save was on its way is kept). Board's data
        // read again too, so who the page offers to present is People as it is now (a renamed member at their new address)
        ctx.fresh?.();
        // (someone renamed on People since the template here was read: the site followed them in this save, so the page
        // does too, in what it opened and what's on it now, before anything is merged: never a question about a rename,
        // never a newcomer at the old address. Board QA round 9)
        const opened = seen.current;
        if (j.addressesNow) {
          const moves = j.addressesNow;
          seen.current = asMeeting(followAddresses({ sections: seen.current.sections }, moves, { people: pickable(ctx.data?.people) }).sections);
          setM((x) => ({ ...x, sections: followAddresses({ sections: x.sections }, moves, { people: pickable(ctx.data?.people) }).sections }));
        }
        const was = seen.current;
        const theirs = asMeeting(j.current.template);
        const { clashes } = mergeMeeting(was, asMeeting(latest.current.sections), theirs);
        let prefer = 'mine';
        if (clashes.length) {
          // (everyone whose save changed what clashes: the copy this page opened and each save since, every one with the
          // renames' addresses followed as the site follows them, so a rename's own rewrite is never a change of its own)
          const follow = (x) => (j.addressesNow ? asMeeting(followAddresses({ sections: x.sections }, j.addressesNow).sections) : x);
          const who = clashWho({ clashes, was: follow(opened), mine: asMeeting(latest.current.sections), saves: j.saves, savers: j.savers, by: j.current.by, shape: (d) => asMeeting(d), follow });
          const keepMine = await ask(clashQuestion({ by: j.current.by, me: ctx.data?.me, what: 'the agenda template', clashes, who, unknown: who === null }));
          if (!keepMine) prefer = 'theirs';
        }
        seen.current = theirs;
        base.current = j.current.at || '';
        setM((x) => ({ ...x, sections: mergeMeeting(was, asMeeting(x.sections), theirs, { prefer }).merged.sections }));
        sections = latest.current.sections;
        j = await call({ action: 'save-settings', settings: { template: sections }, base: base.current });
      }
      return { ...j, sent: templateKey(sections) };
    },
    took: (j) => {
      // (someone renamed on People picked here at an address they've left: at their new one, as the site saved it)
      if (j.settings.addressesNow) setM((x) => ({ ...x, sections: followAddresses({ sections: x.sections }, j.settings.addressesNow, { people: pickable(ctx.data?.people) }).sections }));
      // (what the site answered it keeps: a part, an item or a live list it didn't keep stays a change, said as not saved)
      sent.current = templateKey(j.settings.template);
      seen.current = asMeeting(j.settings.template);
      base.current = j.settings.templateAt || '';
      if (!here.current && !pendingNow()) templateLeft = null;
      setData((d) => ({ ...d, settings: j.settings }));
      if (j.followed) {
        moved.current = true;
        setFollowed(j.followed);
        // Saved on the way out: the meetings it changed come back for the list
        if (!here.current) load();
      }
      return new Date().toISOString();
    },
  });
  const pendingNow = () => templateKey(latest.current.sections) !== sent.current;
  // Board's data read again (the tab back in view, the window's focus, a list that reads People again): the template as
  // the site has it now comes onto the page, as a meeting's does in its editor. Saved since (a rename on People moving who
  // presents, another tab): with nothing waiting here it takes the page's place; with a change waiting it comes in under
  // it, item by item; only the same thing changed both ways waits for the save's merge. So who the page offers to present
  // and who it has presenting are read together, never a renamed member's old address shown as the newcomer who has it
  // now (Board QA round 9)
  const settings = data.settings;
  useEffect(() => {
    const at = String(settings.templateAt || '');
    if (!at || at <= String(base.current || '') || stopped()) return;
    const theirs = asMeeting(settings.template);
    const was = seen.current;
    if (pendingNow()) {
      if (mergeMeeting(was, asMeeting(latest.current.sections), theirs).clashes.length) return;
      setM((x) => ({ ...x, sections: mergeMeeting(was, asMeeting(x.sections), theirs).merged.sections }));
    } else setM((x) => ({ ...x, sections: theirs.sections }));
    seen.current = theirs;
    base.current = at;
    sent.current = templateKey(theirs.sections);
  }, [settings]);
  // (opened with a change left behind: it goes from here at once)
  const first = useRef(!!left);
  useEffect(() => { soon(first.current ? 0 : 1200); first.current = false; }, [m.sections]);
  // Leaving: what's typed goes on the way out (useAutosave), and the meetings it changed come back for the list. A change
  // still on its way (never one "Leave without saving?" dropped) is what this template opens with if it's opened again
  // before it goes. (Once every cleanup has run: the save on the way out starts in useAutosave's)
  useEffect(() => () => {
    here.current = false;
    if (moved.current) load();
    setTimeout(() => { if (pendingNow() && !stopped()) templateLeft = { sections: latest.current.sections, stop, seen: seen.current, base: base.current }; }, 0);
  }, []);
  return html`<div class="bd-template">
    <a class="bd-back" href="#board" onClick=${(e) => { e.preventDefault(); go({}); }}>← All meetings</a>
    <div class="page-header">
      <div>
        <h2 tabindex="-1" data-page-head>Agenda template</h2>
        <p class="page-sub">Every meeting ahead starts from this until someone writes in its agenda. Set who presents each committee here: two weeks before a meeting, they’re asked for their report.</p>
      </div>
      <${SaveState} st=${st} save=${save} saved=${followed ? `Saved, and on ${plural(followed, 'meeting')} ahead` : 'Saved'} />
    </div>
    <${AgendaEditor} m=${m} set=${set} ctx=${ctx} keepSaved=${() => {}} template />
  </div>`;
}

/**
 * The presentation beside the agenda, as it's written: the slide for the item being worked on, ← → through every
 * slide, Play from here (the presentation in its own window, on that slide), and every slide in order to pick from;
 * or the board page, as a laptop or a phone shows it. Each change reaches it a moment later, before it's saved. Never
 * saved from there, and never the board's: they see nothing of a meeting until it's shared
 */
const STAGE_AS = [['screen', 'Presentation'], ['page', 'Board page'], ['phone', 'Phone']];
const SLIDE_KIND = { cover: 'Cover', since: 'Since we met', section: 'Part', item: 'Item', report: 'Report', decision: 'Vote', doc: 'Page', live: 'Live', books: 'QuickBooks', end: 'Close' };
function AgendaStage({ m, focusId, meetings, onOrder = null, onSince = null }) {
  const [as, setAs] = useState(() => { try { const k = localStorage.getItem('bd-stage-as'); return STAGE_AS.some(([x]) => x === k) ? k : 'screen'; } catch { return 'screen'; } });
  const pick = (k) => { setAs(k); try { localStorage.setItem('bd-stage-as', k); } catch { /* private browsing */ } };
  const frame = useRef(null);
  const ready = useRef(false);
  const mRef = useRef(m);
  mRef.current = m;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  const [box, setBox] = useState({ w: 560, h: 640 });
  const holder = useRef(null);
  const list = useRef(null);
  // The screen in the frame tells its slides and where it is: { stops, at, pages, shows, words } (a page's or a slide's)
  const [deck, setDeck] = useState(null);
  const src = `${PAGE}?preview#/meetings/${encodeURIComponent(m.id)}${as === 'screen' ? '/screen' : ''}`;
  const post = (msg) => frame.current?.contentWindow?.postMessage(msg, location.origin);
  // The frame's size: the screen's 1280 × 720 (or the board page at a laptop's width, or a phone's), scaled to fit
  useEffect(() => {
    const el = holder.current;
    if (!el) return undefined;
    const measure = () => setBox({ w: el.clientWidth, h: Math.max(360, innerHeight - el.getBoundingClientRect().top - 24) });
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    addEventListener('resize', measure);
    return () => { ro?.disconnect(); removeEventListener('resize', measure); };
  }, []);
  // Once the page in the frame has its data: the draft, and the item worked on; then its slides as they change
  useEffect(() => {
    ready.current = false;
    setDeck(null);
    const on = (e) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === 'board-preview-ready') {
        ready.current = true;
        post({ type: 'board-preview', meeting: mRef.current });
        if (focusRef.current) post({ type: 'board-preview-focus', itemId: focusRef.current });
      }
      if (e.data?.type === 'board-preview-deck' && e.data.id === mRef.current.id && Array.isArray(e.data.stops)) setDeck(e.data);
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [src]);
  useEffect(() => { if (!ready.current) return undefined; const t = setTimeout(() => post({ type: 'board-preview', meeting: m }), 180); return () => clearTimeout(t); }, [m]);
  useEffect(() => { if (ready.current && focusId) post({ type: 'board-preview-focus', itemId: focusId }); }, [focusId]);
  const stops = as === 'screen' ? deck?.stops || [] : [];
  const at = Math.min(deck?.at || 0, Math.max(0, stops.length - 1));
  const items = useMemo(() => agendaItems(m), [m.sections]);
  const files = useMemo(() => [...m.files, ...(meetings || []).flatMap((x) => x.files || [])], [m.files, meetings]);
  const words = (s) => stopWords(s, m, items, deck?.pages || {}, files, deck?.shows || {}, deck?.words || {});
  const step = (dir) => post({ type: 'board-preview-step', dir });
  // A slide picked: on the screen here, and its item brought into view in the agenda
  const goTo = (s) => { post({ type: 'board-preview-stop', key: s.key }); if (s.itemId) dispatchEvent(new CustomEvent('agx-go', { detail: { id: s.itemId } })); };
  // The slide on, kept in view in the list (the list scrolls, never the page)
  useEffect(() => {
    const el = list.current?.querySelector('.is-on');
    const box2 = list.current;
    if (!el || !box2) return;
    const top = el.offsetTop - box2.offsetTop;
    if (top < box2.scrollTop + 8 || top + el.offsetHeight > box2.scrollTop + box2.clientHeight - 8) box2.scrollTop = Math.max(0, top - box2.clientHeight / 3);
  }, [at, stops.length]);
  const onKeys = (e) => {
    if (as !== 'screen' || e.altKey || e.metaKey || e.ctrlKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); }
  };
  // The board page at a small laptop's width (its words read at the size they're shown here), a phone's, or the screen's
  const base = as === 'phone' ? { w: 390, h: 844 } : as === 'screen' ? { w: 1280, h: 720 } : { w: 1024, h: 0 };
  const scale = Math.min(1, (box.w - (as === 'phone' ? 28 : 2)) / base.w);
  const h = as === 'page' ? box.h : Math.round(base.h * scale);
  const now = stops[at] ? words(stops[at]) : null;
  return html`<aside class=${`agx-stage is-${as}`} aria-label="The presentation, as you build the agenda" onKeyDown=${onKeys}>
    <div class="agx-stage__bar">
      <div class="bd-seg" role="group" aria-label="Show">
        ${STAGE_AS.map(([k, label]) => html`<button type="button" key=${k} aria-pressed=${as === k} class=${as === k ? 'is-on' : ''} onClick=${() => pick(k)}>${label}</button>`)}
      </div>
      <span class="agx-stage__note">${m.shared ? 'As the board sees it' : 'Only you see this until it’s shared'}</span>
    </div>
    <div class=${`agx-stage__frame is-${as}`} ref=${holder} style=${`height:${h + (as === 'phone' ? 28 : 2)}px`}>
      <iframe ref=${frame} src=${src} key=${src} title=${as === 'screen' ? 'The presentation' : `The board page, as ${as === 'phone' ? 'a phone' : 'a laptop'} shows it`}
        style=${`width:${base.w}px;height:${Math.round(h / scale)}px;transform:scale(${scale})`}></iframe>
    </div>
    ${as === 'screen' ? html`
      <div class="agx-stage__nav">
        <button type="button" class="bd-icon-btn agx-stage__step" disabled=${!stops.length || at <= 0} onClick=${() => step(-1)} aria-label="Back a slide" title="Back a slide (←)">‹</button>
        <span class="agx-stage__count" aria-live="polite">${stops.length ? html`<b>${at + 1}</b> of ${stops.length}` : 'Opening…'}</span>
        <button type="button" class="bd-icon-btn agx-stage__step" disabled=${!stops.length || at >= stops.length - 1} onClick=${() => step(1)} aria-label="Next slide" title="Next slide (→)">›</button>
        <span class="agx-stage__now">${now ? html`${now.label ? html`<b>${now.label}</b>` : null}<span>${now.title}</span>` : null}</span>
        <button type="button" class="btn btn-primary btn-sm agx-stage__play" disabled=${!stops.length} onClick=${() => openScreen(m.id, stops[at]?.key || '')} title="The presentation in its own window, from this slide: share it on Google Meet or put it on the TV">Play from here</button>
      </div>
      ${m.noSince && hasSince(m) && onSince ? html`<p class="agx-slides__off"><span>Since we last met is off for this meeting.</span> <button type="button" class="bd-linkbtn" onClick=${() => onSince(false)}>Put it back</button></p>` : null}
      <ol class="agx-slides" ref=${list} aria-label="Every slide, in order">
        ${stops.map((s, i) => {
          const w = words(s);
          // An item's slides move in pieces (board-shared.js orderUnits): one earlier or later, by the first slide's arrows
          const first = s.itemId && s.unit && !(stops[i - 1]?.itemId === s.itemId && stops[i - 1]?.unit === s.unit);
          const pieces = first ? [...new Set(stops.filter((x) => x.itemId === s.itemId && x.unit).map((x) => x.unit))] : [];
          const k = pieces.indexOf(s.unit);
          const move = (to) => { const ids = [...pieces]; ids.splice(k, 1); ids.splice(to, 0, s.unit); onOrder(s.itemId, ids); };
          const what = s.kind === 'item' ? 'its own slide' : s.kind === 'report' ? 'the report' : s.kind === 'decision' ? 'the vote' : `“${w.title}”`;
          return html`<li key=${s.key} class="agx-slides__row"><button type="button" class=${`agx-slide is-${s.kind} ${i === at ? 'is-on' : ''}`} aria-current=${i === at ? 'step' : null} onClick=${() => goTo(s)}>
            <span class="agx-slide__n">${i + 1}</span>
            <span class="agx-slide__t">${w.label && s.kind !== 'doc' && s.kind !== 'live' && s.kind !== 'books' ? html`<b>${w.label}</b>` : null}${w.title}${s.kind === 'doc' && w.sub ? html`<small>${w.sub.split(' · ').slice(1).join(' · ')}</small>` : null}</span>
            <span class="agx-slide__k">${SLIDE_KIND[s.kind] || ''}</span>
          </button>${s.kind === 'since' && onSince ? html`<span class="agx-slide__off"><button type="button" class="bd-linkbtn" title="Take this slide out of this meeting’s presentation" aria-label="Remove Since we last met from this meeting’s presentation" onClick=${() => onSince(true)}>Remove</button></span>` : null}${onOrder && pieces.length > 1 && s.itemId !== MORE.id ? html`<span class="agx-slide__move">
            <button type="button" class="bd-icon-btn" disabled=${k === 0} aria-label=${`Move ${what} earlier in the item`} title="Earlier in its item" onClick=${() => move(k - 1)}>↑</button>
            <button type="button" class="bd-icon-btn" disabled=${k === pieces.length - 1} aria-label=${`Move ${what} later in the item`} title="Later in its item" onClick=${() => move(k + 1)}>↓</button>
          </span>` : null}</li>`;
        })}
      </ol>` : null}
  </aside>`;
}

/** Adding a document to an item: one of the meeting's files, or a new one uploaded */
function DocAdder({ free, onPick, onUpload, onDone }) {
  return html`<div class="bd-docadd" role="group" aria-label="Add a document">
    ${free.map((f) => html`<button type="button" class="ag-add-doc" key=${f.id} onClick=${() => onPick(f)}>+ ${fileTitle(f.name)}</button>`)}
    <label class="btn btn-ghost btn-sm">Upload a file<input type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx,.pptx,.doc,.xls" onChange=${(e) => { onUpload(e.target.files); e.target.value = ''; }} /></label>
    <button type="button" class="btn btn-ghost btn-sm" onClick=${onDone}>Done</button>
  </div>`;
}

// ─── Files ──────────────────────────────────────────────────────────

/** A file onto one item (or none): off every other item first */
const placeFile = (fileId, itemId) => (x) => ({ sections: x.sections.map((s) => ({ ...s, items: s.items.map((it) => {
  const rest = (it.docs || []).filter((d) => d !== fileId);
  return { ...it, docs: it.id === itemId ? [...rest, fileId] : rest };
}) })) });

/**
 * The meeting's files. Before the meeting (`goes`), each shows the agenda item it goes with, and a new one goes
 * with the item it most likely belongs to (financial statements with the money item, and so on).
 */
/** What a board file can be (as the server takes it): PDFs, pictures, Word, Excel and PowerPoint */
const FILE_OK = /\.(pdf|jpe?g|png|webp|heic|docx?|xlsx?|pptx)$/i;
const extOf = (name) => (String(name).match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
/** What a file in the packet can be filed as: nothing that's this meeting's own minutes */
const PACKET_KINDS = FILE_KINDS.filter((x) => ['financials', 'agenda', 'side', 'other'].includes(x.id));

/**
 * One of the meeting's files, as a row: its name (renamed in place), the agenda item it goes with when `goes`, whether
 * the board sees it, what it's filed under, and deleting it. `vf`, `i`: the viewer's list and its place there; `n`: its
 * place among the card's rows, where the focus goes after a delete; `cardId`: the card it's in
 */
function FileRow({ f, i, n, vf, kinds, cardId, goes, m, set, ctx, keepSaved, take = null }) {
  const { addToast, data } = ctx;
  const [renaming, setRenaming] = useState('');
  const renamed = useRef(''); // a rename saves once: Enter, or the box losing the focus, whichever comes first
  const items = agendaItems(m);
  const whereOf = (x) => items.find((it) => m.sections[it.si].items[it.ii].docs?.includes(x.id))?.id || '';
  const name = docTitle(f.name);
  // Approved minutes' own file stays their minutes while they're approved: nothing that takes it off them is offered
  // (another kind, Delete, an agenda item), as the site refuses them (functions/api/_board-minutes.js approvedFileNo).
  // Filed under Minutes it can be, when it isn't. Board QA round 11
  const stays = f.id === approvedFileOf(m);
  // A no from the site that knows more than this page does (the minutes approved in another tab, the file signed): the
  // meeting as the site has it comes onto the page with it, so the card and this menu show what's so and offer only
  // what's allowed (Board QA round 12: still "Draft", with Delete offered, after "their file stays")
  const refused = (j) => {
    if (j.meeting) take?.(j.meeting); else if (j.reread) ctx.load({ quick: true });
    addToast(j.error, 'error');
  };
  const update = async (f, patch, said = '', undo = null) => {
    const j = await call({ action: 'update-file', id: f.id, ...patch });
    if (!j.ok) { refused(j); return false; }
    keepSaved((x) => ({ ...x, files: x.files.map((y) => (y.id === f.id ? { ...y, ...j.file } : y)) }));
    if (said) addToast(said, 'info', undo ? { label: 'Undo', fn: () => update({ ...f, ...j.file }, undo) } : undefined);
    return true;
  };
  const remove = async (f, at) => {
    if (!(await ask({ title: `Delete ${docTitle(f.name)}?`, text: 'It goes for good, from the board page too.', yes: 'Delete', danger: true }))) return;
    const j = await call({ action: 'delete-file', id: f.id });
    if (!j.ok) { refused(j); return; }
    // (off its items on the site in the same write: the meeting as the site has it now, when it came)
    if (j.meeting && take) take(j.meeting);
    keepSaved((x) => ({ ...x, files: x.files.filter((y) => y.id !== f.id) }));
    set(placeFile(f.id, ''));
    // The focus goes to the file that took its place, else to adding one
    requestAnimationFrame(() => (document.querySelectorAll(`#${cardId} .bd-file-name`)[at] || document.querySelector(`#${cardId} .bd-drop .btn`))?.focus());
  };
  const rename = async (f, typed) => {
    if (renamed.current === f.id) return;
    renamed.current = f.id;
    const name = typed.trim();
    setRenaming('');
    if (name && name !== docTitle(f.name)) await update(f, { name: `${name}${extOf(f.name)}` }, `Renamed ${name}`, { name: f.name });
    requestAnimationFrame(() => document.querySelector(`#${cardId} [data-file="${f.id}"]`)?.focus());
  };
  // Which item it goes with, said (a file leaves "Also for this meeting" for its item), and undone from there
  const place = (id) => {
    const was = whereOf(f);
    set(placeFile(f.id, id));
    const to = items.find((it) => it.id === id);
    addToast(to ? `${name} goes with ${to.label} ${to.title}` : `${name} is on no item: it comes after the agenda`, 'info', { label: 'Undo', fn: () => set(placeFile(f.id, was)) });
  };
  return html`<li class="bf-file" key=${f.id}>
    <div class="bf-file__main">${renaming === f.id
      ? html`<input class="form-input bf-rename" aria-label=${`New name for ${name}`} value=${name} ref=${(el) => { if (el && !el.dataset.on) { el.dataset.on = '1'; renamed.current = ''; el.focus(); el.select(); } }}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(f, e.target.value); } if (e.key === 'Escape') { e.preventDefault(); setRenaming(''); } }} onBlur=${(e) => rename(f, e.target.value)} />`
      : html`<a class="bd-file-name" data-file=${f.id} ...${viewerLink(vf, i)}>${name}</a>`}<div class="bd-row__meta">${[sizeText(f.size), f.at ? `added ${dayOf(f.at)}` : ''].filter(Boolean).join(' · ')}</div></div>
    ${goes && f.kind !== 'signed' && !stays ? html`<${ItemChooser} items=${items} value=${whereOf(f)} label=${`Which agenda item ${name} goes with`} onChange=${place} />` : null}
    <button type="button" role="switch" class=${`bf-seen ${f.staffOnly ? 'is-staff' : ''}`} aria-checked=${!f.staffOnly} aria-label=${`The board sees ${name}`}
      onClick=${() => update(f, { staffOnly: !f.staffOnly }, f.staffOnly ? `The board sees ${name}` : `${name} is staff only: only ${youAnd(data.settings.admins, data.me)} see it`, { staffOnly: !!f.staffOnly })}>
      <span class="bf-seen__track" aria-hidden="true"><span class="bf-seen__dot"></span></span><span class="bf-seen__t">${f.staffOnly ? 'Staff only' : 'Board sees it'}</span></button>
    <${Menu} label=${`More for ${name}`} items=${[
      { icon: 'rename', label: 'Rename', run: () => setRenaming(f.id) },
      { divider: true },
      { heading: 'File it under' },
      ...(stays ? FILE_KINDS.filter((x) => x.id === f.kind || x.id === 'minutes') : kinds).filter((x) => x.id !== 'side' || /^image\//i.test(f.type || ''))
        .map((x) => ({ label: x.label, chosen: x.id === f.kind, title: stays ? FILE_STAYS : null, run: () => { if (x.id !== f.kind) update(f, { kind: x.id }, `${name} is under ${x.label}`, stays ? null : { kind: f.kind }); } })),
      { divider: true },
      stays ? null : { icon: 'trash', label: 'Delete the file', danger: true, run: () => remove(f, n) },
    ]} />
  </li>`;
}

/**
 * The meeting's files on no item, as a card under the agenda: what the presentation shows after the last part as
 * "Also for this meeting" (MORE) is seen and changed here like any item, and a slide of it picked beside the agenda
 * comes here. Only when there are some: no files, no such slides
 */
function MoreCard({ m, set, ctx, keepSaved, take }) {
  const files = looseFiles(m);
  if (!files.length) return null;
  const vf = viewerFiles(files);
  return html`<section class="agx-sec agx-more" id="agx-more" data-item=${MORE.id} aria-labelledby="agx-more-h">
    <div class="agx-more__head">
      <span class="agx-sec__n" aria-hidden="true">+</span>
      <h3 class="agx-more__title" id="agx-more-h">${MORE.title}</h3>
      <span class="bd-muted">${plural(files.length, 'document')}, after the agenda</span>
    </div>
    <ul class="bf-list">${files.map((f, i) => html`<${FileRow} key=${f.id} f=${f} i=${i} n=${i} vf=${vf} kinds=${PACKET_KINDS} cardId="agx-more" goes m=${m} set=${set} ctx=${ctx} keepSaved=${keepSaved} take=${take} />`)}</ul>
  </section>`;
}

function FilesCard({ m, set, ctx, keepSaved, take, title, sub, goes = false }) {
  const { addToast } = ctx;
  const [uploading, setUploading] = useState([]); // the names on their way up
  const [over, setOver] = useState(false);
  const items = agendaItems(m);
  const add = async (list) => {
    const all = [...(list || [])];
    const bad = all.filter((f) => !FILE_OK.test(f.name));
    if (bad.length) addToast(`${bad.length === 1 ? bad[0].name : plural(bad.length, 'file')} can’t go in: a PDF, a picture, or a Word, Excel or PowerPoint file can.`, 'error');
    const files = all.filter((f) => FILE_OK.test(f.name));
    if (!files.length) return;
    setUploading((u) => [...u, ...files.map((f) => f.name)]);
    const added = [];
    // (sent as the minutes when the minutes are approved: kept as an ordinary file, and said, never "added" alone. The
    // site's to say: functions/api/_board-minutes.js minutesKindNo. Board QA round 10)
    const asFiles = [];
    // (kept as a file because the minutes are approved, maybe in another tab: the meeting as the site has it comes too)
    let siteHas = null;
    for (const f of files) {
      const kind = kindOfName(f.name);
      // (its answer lost: looked for at the site before anything says to try again, never kept twice: sendUp. Round 13)
      const j = await sendUp(ctx, f, { ownerType: 'meeting', ownerId: m.id, kind: goes && (kind === 'minutes' || kind === 'signed') ? 'other' : kind });
      if (j.ok) { added.push(j.file); if (j.asFile) asFiles.push([j.file, j.asFile]); if (j.meeting) siteHas = j.meeting; } else addToast(`${f.name}: ${j.error}`, 'error');
      setUploading((u) => { const i = u.indexOf(f.name); return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)]; });
    }
    if (siteHas) take?.(siteHas);
    if (added.length) keepSaved((x) => added.reduce(withFile, x));
    // The focus goes to the file that came in
    if (added.length) requestAnimationFrame(() => document.querySelector(`#${cardId} [data-file="${added[0].id}"]`)?.focus());
    for (const [f, why] of asFiles) addToast(`${docTitle(f.name)}: ${why}`, 'info');
    const plain = added.filter((f) => !asFiles.some(([x]) => x.id === f.id));
    if (!goes) { if (plain.length) addToast(`${plain.length === 1 ? docTitle(plain[0].name) : plural(plain.length, 'file')} added`, 'info'); return; }
    const placed = added.map((f) => [f, guessItem(m, f)]).filter(([, id]) => id);
    for (const [f, id] of placed) set(placeFile(f.id, id));
    // What went where, and what's on no item yet, in one message
    const loose = added.filter((f) => !placed.some(([x]) => x.id === f.id));
    const said = [
      placed.length === 1 ? `${docTitle(placed[0][0].name)} goes with ${items.find((it) => it.id === placed[0][1])?.title || 'its item'}` : placed.length ? `${plural(placed.length, 'file')} put with their agenda items` : '',
      loose.length ? `${loose.length === 1 ? docTitle(loose[0].name) : plural(loose.length, 'file')} ${loose.length === 1 ? 'is' : 'are'} on no item yet: choose one, or leave ${loose.length === 1 ? 'it' : 'them'} for the end` : '',
    ].filter(Boolean);
    if (said.length) addToast(`${said.join('. ')}.`, 'info');
  };
  // A file dropped anywhere on Before goes in the packet (an agenda item dragged never carries files)
  useEffect(() => {
    if (!goes) return undefined;
    const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => { if (has(e)) { e.preventDefault(); setOver(true); } };
    const leave = (e) => { if (!e.relatedTarget) setOver(false); };
    const drop = (e) => { if (!has(e)) return; e.preventDefault(); setOver(false); add(e.dataTransfer.files); };
    window.addEventListener('dragover', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [goes, m.id, m.sections]);
  // The packet is what goes out before the meeting: this meeting's own minutes and their signed copy are After's
  const files = goes ? m.files.filter((f) => f.kind !== 'minutes' && f.kind !== 'signed') : m.files;
  const vf = viewerFiles(files);
  // The packet is one list (what matters there is the item each goes with); Every file is by kind
  const groups = goes ? [[null, files.map((f, i) => ({ f, i }))]].filter(([, l]) => l.length)
    : FILE_KINDS.map((k) => [k, files.map((f, i) => ({ f, i })).filter(({ f }) => (FILE_KINDS.some((x) => x.id === f.kind) ? f.kind : 'other') === k.id)]).filter(([, l]) => l.length);
  // What a file can be filed as: before the meeting, nothing that's this meeting's own minutes
  const kinds = goes ? PACKET_KINDS : FILE_KINDS;
  const cardId = goes ? 'bm-packet' : 'bm-files';
  let at = -1;
  return html`<div class=${`card bm-files ${over ? 'is-over' : ''}`} id=${cardId}>
    <div class="bd-card-head"><h3>${title}${files.length ? html` <span class="count">${files.length}</span>` : null}</h3><p>${sub}</p></div>
    ${groups.map(([k, list]) => html`<div class="bf-group">
      ${k && groups.length > 1 ? html`<p class="bm-group">${k.label}</p>` : null}
      <ul class="bf-list">${list.map(({ f, i }) => {
        const n = (at += 1);
        return html`<${FileRow} key=${f.id} f=${f} i=${i} n=${n} vf=${vf} kinds=${kinds} cardId=${cardId} goes=${goes} m=${m} set=${set} ctx=${ctx} keepSaved=${keepSaved} take=${take} />`;
      })}</ul>
    </div>`)}
    ${uploading.length ? html`<ul class="bf-list bf-up" aria-live="polite">${uploading.map((name, i) => html`<li class="bf-file is-up" key=${`${name}-${i}`}><span class="spinner" aria-hidden="true"></span><div class="bf-file__main"><span class="bd-file-name">${docTitle(name)}</span><div class="bd-row__meta">Uploading…</div></div></li>`)}</ul>` : null}
    <div class=${`bd-drop ${over ? 'is-over' : ''}`} style=${files.length || uploading.length ? 'margin-top:0.75rem' : ''} onDragOver=${(e) => { e.preventDefault(); if (!goes) setOver(true); }} onDragLeave=${() => { if (!goes) setOver(false); }}
      onDrop=${(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); add(e.dataTransfer.files); }}>
      <label class="btn btn-ghost btn-sm bd-pick">Add files<input type="file" class="sr-only" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx,.pptx,.doc,.xls" onChange=${(e) => { add(e.target.files); e.target.value = ''; }} /></label>
      <span class="bd-muted bd-drop__hint">${over ? 'Let go to add them' : goes ? 'or drop them anywhere on this page' : 'or drop them here'}</span>
    </div>
  </div>`;
}

// ─── The checklists ─────────────────────────────────────────────────

/** One thing to do: done, the next one (its button stands out), or still to come */
const Task = ({ state, title, sub, children }) => {
  const kids = [].concat(children ?? []).filter(Boolean);
  return html`<li class=${`bm-task is-${state}`}>
    <span class="bm-task__mark" aria-hidden="true">${state === 'done' ? CHECK : null}</span>
    <div class="bm-task__body">
      <div class="bm-task__t" tabindex="-1">${title}</div>
      ${sub ? html`<div class="bm-task__s">${sub}</div>` : null}
      ${kids.length ? html`<div class="bm-task__do">${kids}</div>` : null}
    </div>
  </li>`;
};
/** States for a list of done flags: the first not done is next */
const statesOf = (dones) => { const first = dones.indexOf(false); return dones.map((d, i) => (d ? 'done' : i === first ? 'next' : 'todo')); };
const btn = (state) => `btn btn-sm ${state === 'next' ? 'btn-primary' : 'btn-ghost'}`;
/**
 * Once one's done, the focus goes to what's next: its name, never a button (a space or Enter typed a moment later
 * mustn't send anything), and never the undo that just took the done one's place
 */
const focusNext = (sel) => requestAnimationFrame(() => (document.querySelector(`${sel} .bm-task.is-next .bm-task__t`) || document.querySelector(`${sel} h3`))?.focus());
/**
 * After a send that's done nothing to move on to (a test to yourself, one that failed or whose answer was lost): the focus
 * on the name of the task it's in (`task`, the one its button sits in), else on the card's heading; never the button
 * itself, nor the next one along (one key a moment later mustn't send anything)
 */
const focusTask = (task, sel) => requestAnimationFrame(() => ((task?.isConnected ? task.querySelector('.bm-task__t') : null) || document.querySelector(`${sel} h3`))?.focus());
/** The task a send was pressed in: its button has the focus (ask() puts it back there once it's answered) */
const pressedTask = () => document.activeElement?.closest?.('.bm-task') || null;
/**
 * Before a send's question: Board's data as the site has it now (./board-admin.js ctx.fresh: read again unless it was
 * read a moment ago), so the question, its toast and the page name who the site sends to, never the board this tab first
 * read (Board QA round 5, Nov 21 2026: a tab open while People → Board changed asked to invite someone who'd left).
 * Nothing is disabled while it looks, so the focus stays on the button pressed (ask() puts it back there). A read that
 * fails asks nothing and sends nothing, and says so (ctx.fresh), never a question from the board this tab read before
 * (Board QA round 10, Nov 22 2026: one failed read named Maria, who had left the board, and the send went to three).
 * → [the send being looked up for ('' when none), look(name) → the data, or null while one is already looking or the
 * site couldn't be read]
 */
function useFresh(ctx) {
  const [looking, setLooking] = useState('');
  const busy = useRef(false);
  const look = async (name) => {
    if (busy.current) return null;
    busy.current = true;
    setLooking(name);
    try { return ctx.fresh ? await ctx.fresh({ say: 'sent' }) : ctx.data; } finally { busy.current = false; setLooking(''); }
  };
  return [looking, look];
}
/**
 * This meeting as Board's data read at a press has it (useFresh's `d`): the site's copy, so a send's question says
 * what's so now (the invite out, the board emailed, on the board page, the minutes approved), never what this tab last
 * saw. QA round 7, Nov 21 2026: a tab open while another emailed the board asked the first-time question, and emailed
 * them a second time
 */
const siteCopy = (d, m) => (d?.meetings || []).find((x) => x.id === m.id) || m;
/** A send's button while Board looks up who it goes to */
const CHECKING = 'Checking…';
/**
 * The packet, the minutes notice and the reminder each go once (functions/api/_board.js sendOnce): pressed again within
 * ten minutes of one that went, the site says it went and sends no one a second copy (Resend's idempotency keys too)
 */
const ONCE_MS = 10 * 60 * 1000;
/** A lost answer to one of those, said: pressing it again is how to find out, and safe */
const lostOnce = (what) => `${LOST}, so this page can’t tell whether ${what}. Press it again in the next 10 minutes to find out: if it went, the site says so and sends no one a second copy.`;
/**
 * What's said at the top of a send's question when the last press of it got no answer: it may have gone. One that goes
 * once (`once`), pressed again within ten minutes, can't go twice; after that, or any other, look before sending it again
 */
const doubtWords = (at, what, { once = false } = {}) => (!at ? ''
  : once && Date.now() - Date.parse(at) < ONCE_MS ? `The last time, at ${savedAt(at)}, no answer came back. If ${what} went then, the site says so and sends no one a second copy. `
    : `The last time, at ${savedAt(at)}, no answer came back, so ${what} may have gone then. ${WENT_OUT}: look there first. `);
/**
 * A change pressed that the board sees (the meeting on the board page or off it, its minutes approved or not), saved now
 * and said once the site has it, never before: `has(copy)` is whether the site's copy (MeetingEditor's saved) has it.
 * One that doesn't go is put back as the site has it (`back(copy)` → the fields) and said in words: refused for good by
 * useAutosave's refused ("Not on the board page: The agenda goes to the board once it’s approved."), else here: `what`
 * is what's still so, `also` what that means, `again` how to do it again. An answer lost on the way back may have landed
 * all the same, so the page looks at the site before it says anything (`look`, Board's data read again: this meeting as
 * the site has it) and shows what the site has (`take`): there, it's done; not there, it's put back as the site has it
 * and said as not saved. Only when that look fails too does it say it can't tell yet (UNSURE_SAVED): nothing is put back
 * that the site may not have, the save line says "Not saved" (never "Saved") and Board keeps trying by itself, which
 * finds what the site has. Board QA round 14, Nov 24 2026: Mark them approved landed with its answer lost, and the page
 * put the minutes back to draft beside "Saved", and only told the founder to reload. Before each look, and after the
 * last, the page checks the copy it already has from the site: Board's own try again (useAutosave) may have had the
 * site's answer meanwhile (saved), and a copy that shows the press done settles it, in the press's own words, with no
 * look needed; "can't tell yet" only when neither that copy nor the looks can tell. Board QA round 15, Nov 26 2026: the
 * page said "Saved", then a second later that it couldn't tell whether that was saved. → whether the site has it
 */
export async function pressSave({ set, save, saved, addToast, look = null, take = null }, patch, { has, back, what, again, also = '' }) {
  set(patch);
  await new Promise((r) => setTimeout(r, 0));
  let lost = false;
  await save({ own: (j) => {
    if (j.unknown && look && take) { lost = true; return; }
    set(back(saved.current));
    addToast(j.unknown ? UNSURE_SAVED
      : j.offline ? `${what}: no connection.${also ? ` ${also}` : ''} ${again} once you’re back online.`
        : `${what}: ${sentence(notSavedWhy(j))}${also ? ` ${also}` : ''}`, 'error');
  } });
  if (!lost) return has(saved.current);
  // (the site's copy the page has now, from Board's own try again: it shows the press done, so the site has it. One that
  // doesn't show it says nothing yet: it may be from before the press, or from another change)
  const told = () => has(saved.current);
  if (told()) return true;
  // (a look that fails is tried once more a moment later, before the page says it can't tell)
  let now = await look();
  if (!now) {
    if (told()) return true;
    await new Promise((r) => setTimeout(r, 1500));
    if (told()) return true;
    now = await look();
  }
  if (!now) { if (told()) return true; addToast(UNSURE_SAVED, 'error'); return false; }
  // (Board's data was read for it: the copy is there already. One older than the copy the page has had from the site
  // since, Board's own try again landing while the look was out, changes nothing: the page goes by the newer one)
  const sv = String(now.updatedAt || '') < String(saved.current?.updatedAt || '') ? saved.current : now;
  if (sv === now) take(now, { looked: true });
  if (has(sv)) return true;
  set(back(sv));
  addToast(`${what}: the site didn’t answer, so that wasn’t saved.${also ? ` ${also}` : ''} ${again}.`, 'error');
  return false;
}
/** What a pressed change needs to look at the site when its answer is lost (pressSave): this meeting as the site has it, and the way onto the page */
const pressOf = ({ set, save, saved, take, ctx, m }) => ({ set, save, saved, addToast: ctx.addToast, take, look: () => siteNow(ctx, m.id) });
const ON_PAGE = {
  true: { what: 'Not on the board page', again: 'Share it again' },
  false: { what: 'Still on the board page', also: 'The board can still see it.', again: 'Take it off again' },
};
/** The meeting put on the board page or taken off it, from a button → whether the site has it so now (pressSave) */
const putOnPage = (p, v) => pressSave(p, { shared: v }, { has: (sv) => sv.shared === v, back: (sv) => ({ shared: sv.shared }), ...ON_PAGE[v] });
/**
 * The minutes marked approved (on `day`) or as draft, pressed: pressSave's change and its words, the one press After the
 * meeting's Mark them approved and Mark as draft and approved minutes' own line (MinutesStay) share
 */
const approvalPress = (v, day = '') => [v ? { minutes: 'approved', approvedOn: day } : { minutes: 'draft', approvedOn: '' }, {
  has: (sv) => (sv.minutes === 'approved') === v, back: (sv) => ({ minutes: sv.minutes, approvedOn: sv.approvedOn }),
  what: v ? 'Not marked approved' : 'Still approved', again: v ? 'Mark them approved again' : 'Mark them as draft again',
}];
const NO_MAIL = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /><path d="M3 21 21 3" /></svg>`;
/** Board members with no email on file: named where it matters, each with the way to add theirs */
function NoEmail({ ctx, what }) {
  const none = ctx.data.members.filter((x) => !x.email);
  if (!none.length) return null;
  const one = none.length === 1;
  return html`<p class="bm-note is-warn" role="note">${NO_MAIL}<span><strong>${namesText(none.map((x) => x.name))} ${one ? 'has' : 'have'} no email on file</strong>, so ${one ? 'gets' : 'get'} ${what}.${none.map((x) => html` <a class="link" href=${`#people/board/${x.slug}`}>${one ? 'Add it' : `Add ${x.name.split(' ')[0]}’s`}</a>`)}</span></p>`;
}

function GettingReady({ m, set, ctx, act, save, saved, take }) {
  const { data, addToast } = ctx;
  const [working, setWorking] = useState('');
  // Each send whose last press got no answer, and when ({ invite, approve, send }): its next press says so first
  const [doubt, setDoubt] = useState({});
  /**
   * A send from a task: done, the focus goes on to what's next (focusNext). A test to yourself, a refusal or an answer that
   * never came: the focus on its own task's name. `lost` says what the site's record shows when the answer was lost
   */
  const run = async (name, body, ok, lost = null) => {
    const task = pressedTask();
    setWorking(name);
    // (the site saying it went, or is going out right now, settles any doubt about the last press)
    const j = await act(body, { lost: lost && ((x) => { const said = lost(x); setDoubt((d) => ({ ...d, [name]: said.known ? null : new Date().toISOString() })); return said; }), settled: () => setDoubt((d) => ({ ...d, [name]: null })) });
    setWorking('');
    // (what it says: words, or { text, kind } for one that went but not all the way: an approval whose email didn't go)
    const said = j && ok ? (typeof ok === 'function' ? ok(j) : ok) : '';
    // (`later`: what shows here once the page looks again, when the site's read for the answer didn't answer)
    const text = typeof said === 'string' ? said : said?.text;
    if (said) addToast(j.later ? `${sentence(text)} ${j.later}` : text, typeof said === 'string' ? 'info' : said.kind);
    if (j && !body.test) { setDoubt((d) => ({ ...d, [name]: null })); focusNext('.bm-ready'); } else focusTask(task, '.bm-ready');
    return j;
  };
  // A test to yourself: a lost answer can't be looked up (it leaves no record), and only you get a second one
  const testLost = () => ({ text: `${LOST}, so this page can’t tell whether the test went. Look in your inbox before sending it again.`, known: false });
  // Shared says so once the site has it, and moves on to what's next; taking it off asks first (its button is where Share
  // was). One that didn't go says why, and the page shows what the site has (putOnPage)
  const pressed = pressOf({ set, save, saved, take, ctx, m });
  const share = async (v) => {
    if (!v && !(await ask({ title: 'Take it off the board page?', text: 'Board members stop seeing its agenda and files until you share it again.', yes: 'Take it off' }))) return;
    if (!(await putOnPage(pressed, v))) return;
    addToast(v ? 'On the board page: board members see the agenda and files' : 'Taken off the board page', 'info', v ? { label: 'Undo', fn: async () => { if (await putOnPage(pressed, false)) addToast('Taken off the board page', 'info'); } } : undefined);
    focusNext('.bm-ready');
  };
  // The invite: who's on it, and who should be
  const inv = m.invite;
  const from = inv?.organizer || data.settings.invitesFrom;
  // The organizer reads "your calendar"; anyone else reads whose it is
  const whoseOf = (e) => (String(e || '').toLowerCase() === String(data.me || '').toLowerCase() ? 'your' : `${firstOf(e)}’s`);
  const whose = whoseOf(from);
  const nameOf = (e) => guestName(e, data);
  // Who's added besides the board: the other admins (the organizer is on it already)
  const alsoAdded = data.settings.admins.filter((e) => e !== from).map(firstOf);
  const adds = `the board${alsoAdded.length ? ` and ${andList(alsoAdded)}` : ''}`;
  // (none for a meeting that isn't a board meeting: nothing goes on its invite, as pathOf has it)
  const missing = m.notBoard ? [] : inviteMissing(m, data);
  const placeNow = [m.location, m.address].filter(Boolean).join(', ');
  // A new day, time or place: onto the invite once the typing has stopped (functions/api/_board-invite.js, whose "when"
  // is "YYYY-MM-DD HH:MM-HH:MM")
  const changed = !inv ? [] : [m.date !== String(inv.when).slice(0, 10) && 'day', `${m.start || ''}-${m.end || ''}` !== String(inv.when).slice(11) && 'time', !!placeNow && placeNow !== inv.place && 'place'].filter(Boolean);
  const where = !inv ? '' : changed.length ? `the new ${andList(changed)} ${changed.length > 1 ? 'go' : 'goes'} on it a couple of minutes after you stop typing` : inv.place ? `at ${inv.place}` : 'the place goes on it when you add one';
  // Board meeting invites Board didn't send, on an admin's calendar on this meeting's day (functions/api/_board-calendar.js)
  const others = data.calendar?.others?.[m.id] || [];
  const senders = [...new Set(others.map((o) => o.by).filter(Boolean))];
  const mineOnly = senders.length === 1 && senders[0] === String(data.me || '').toLowerCase();
  const senderName = (e) => (/@soardcharity\.com$/i.test(e) ? firstOf(e) : data.members.find((x) => x.email === e)?.name || e);
  // What the board gets: the packet, as they see it (never this meeting's own minutes, nor a staff-only file)
  const inEmail = packetDocs(m);
  // (a board-only document is counted in the email, never named)
  const docs = [inEmail.names.length ? `${plural(inEmail.names.length, 'document')} by name` : '', inEmail.hidden ? `${plural(inEmail.hidden, 'board-only document')}, counted only` : ''].filter(Boolean).join(' and ');
  const toRead = minutesToRead(m, data.meetings);
  // Nothing reaches the board before the agenda is approved, and approving sends it: the board page and the email follow.
  // Which is next is the meeting's one rule (pathOf), as its status line and Board's home say it
  const approval = data.approvals?.[m.id];
  const path = pathOf(m, data, 'ahead');
  const [sInvite, sApproved, sShared, sSent] = ['invite', 'approved', 'shared', 'emailed'].map((id) => path.find((x) => x.id === id).state);
  // The reports: each presenter writes theirs on the board page (it asks them there); here, which are in
  const people = useMemo(() => pickable(data.people), [data.people]);
  const asked = agendaItems(m).map((x) => ({ x, it: m.sections[x.si].items[x.ii] })).filter(({ it }) => reportsOn(it));
  // Who can sign in to the board page to write theirs: a board member with an email on file, or one of Board's admins
  const admins = data.settings.admins.map((e) => String(e).toLowerCase());
  const signsIn = (p) => !!p.slug && (data.members.some((x) => x.slug === p.slug && x.email) || data.people.staff.some((x) => x.slug === p.slug && admins.some((e) => e.startsWith(`${String(x.name).split(/\s+/)[0].toLowerCase()}@`))));
  const here = (it) => !presentersOf(it, people).some(signsIn);
  const inCount = asked.filter(({ it }) => it.report).length;
  // What approving does (functions/api/_board.js sendApprovedAgenda), said before it's pressed: the board page and the
  // email, unless the board hasn't had the email on how to sign in yet (it waits for that), the email isn't set up (it
  // waits on the board page too), or the board was emailed the link already
  // (`d`: Board's data, as the site has it now for a send's question: useFresh)
  const signInOf = (d) => signInKnown(d.welcome, d.members, { sending: !!d.welcomeSending });
  const signIn = signInOf(data);
  // A meeting already on the board page is seen there now, approved or not (the board page shows every shared meeting:
  // functions/api/_board.js boardCopy), so approving it sends only the email; one that isn't goes there too
  // (one that isn't a board meeting is made one by its approval, as sharing it would: functions/api/_board-asks.js
  // chairApprove. Said first, in plain words. QA round 6, Nov 21 2026)
  // (`sm`: this meeting as the site has it at the press: siteCopy)
  const approveSays = (d, sm = m) => {
    const says = approveWhat(d, sm);
    return { ...says, text: `${sm.notBoard ? 'It isn’t a board meeting now: approving its agenda makes it one. ' : ''}${says.text}` };
  };
  const approveWhat = (d, sm = m) => {
    const told = signInOf(d);
    if (sm.packetSentAt) return { text: `The board was emailed the link already, ${dayOf(sm.packetSentAt)}, so no email goes again.${sm.shared ? '' : ' It goes on the board page from here (Share with the board).'}`, yes: 'Approve it' };
    if (!d.setup.email) return { text: sm.shared ? 'It’s on the board page already. Email isn’t set up yet (Site → Automations says what’s missing), so no email goes to the board.' : 'Email isn’t set up yet (Site → Automations says what’s missing), so nothing goes to the board by itself: once it’s approved, Share with the board puts it on the board page.', yes: 'Approve it' };
    if (!told.told) {
      const who = d.welcomeSending ? 'The email on how to sign in is going out now' : told.waiting.length ? `${andList(told.waiting.map((x) => x.name))} ${told.waiting.length === 1 ? 'hasn’t' : 'haven’t'} had the email on how to sign in` : 'The board hasn’t had the email on how to sign in';
      return { text: `${sm.shared ? 'It’s on the board page already, and no email goes yet' : 'Nothing goes to the board yet'}. ${who}${d.welcomeSending ? '' : ' (Members sends it)'}. Once ${d.welcomeSending ? 'it’s gone' : 'they’ve had it'}, ${sm.shared ? '' : 'the agenda goes on the board page and '}${plural(d.packetTo, 'board member')} get the link by email, by itself.`, yes: 'Approve it' };
    }
    return { text: `${sm.shared ? 'It’s on the board page already, and' : 'It goes on the board page, and'} ${plural(d.packetTo, 'board member')} get the link by email.`, yes: 'Approve and send' };
  };
  // What Approve the agenda says before it's pressed, true for this meeting as the board page has it. The chair's
  // review is named only when it will happen, with its day (./board-shared.js chairReviewDay)
  const reviewDay = chairReviewDay(m, { asks: data.settings.asks, chair: data.members.some((p) => p.seat === 'chair' && p.email), approved: !!approval });
  const approveSub = `${m.notBoard ? 'It isn’t a board meeting, so the board sees none of it. Approving its agenda makes it one' : m.shared ? 'It’s on the board page already, so the board can see it now' : 'The board sees none of it until it’s approved'}. ${reviewDay ? `The chair gets it to review on ${shortDate(reviewDay)}, or approve it here: ` : 'Approve it here: '}${m.packetSentAt ? 'the board was emailed the link already.'
    : !data.setup.email ? (m.shared ? 'no email goes, since email isn’t set up yet.' : 'then share it with the board.')
      : `${signIn.told ? '' : 'once the board has had the email on how to sign in, '}that ${m.shared ? '' : 'puts it on the board page and '}emails them the link, once.`}`;
  // Email the board waits while the site would hold it (./board-shared.js waitsForApproval, the rule
  // functions/api/_board.js holdUntilApproved refuses it by), so it isn't offered then: the approval sends it by itself
  const emailWaits = !approval && waitsForApproval(m);
  const [looking, look] = useFresh(ctx);
  const approve = async () => {
    const d = await look('approve');
    if (!d) return;
    // Approved meanwhile (another tab, the chair on the review page): said, and nothing asked or sent. This founder's own
    // other tab is "you", never their own name (QA round 6, Nov 21 2026)
    const yes = d.approvals?.[m.id];
    if (yes) {
      // (whose approval it is by its address, when the site says: the name's first word only for one kept before it did)
      const mine = yes.email ? yes.email === String(data.me || '').toLowerCase() : String(yes.by || '').split(/\s+/)[0].toLowerCase() === String(data.me || '').split('@')[0].toLowerCase();
      addToast(approvedAlready({ by: yes.by, at: yes.at, mine }), 'info');
      focusNext('.bm-ready');
      return;
    }
    // (held since this page read it: nothing asking the board to read ahead goes, said as the site says it. Round 12)
    const heldNow = heldNoSend(siteCopy(d, m));
    if (heldNow) { addToast(heldNow, 'info'); return; }
    const says = approveSays(d, siteCopy(d, m));
    if (!(await ask({ title: 'Approve the agenda?', text: `${doubtWords(doubt.approve, 'the approval and its email')}${says.text}`, yes: says.yes, careful: !!doubt.approve }))) return;
    const j = await run('approve', { action: 'approve-agenda', id: m.id }, (r) => (r.already ? approvedAlready({ by: r.approvedBy, at: r.approvedAt, mine: !!r.mine }) : r.madeBoard && r.agenda !== 'failed' ? `Approved, and it’s a board meeting now${r.agenda === 'sent' ? ': on the board page, and on its way to the board' : r.agenda === 'waiting' ? '. It goes to the board as soon as they’ve had the email on how to sign in' : ''}`
      : r.agenda === 'sent' ? 'Approved, and on its way to the board'
      // (approved, its email refused or stopped: what the site says happened, and what happens next)
      : r.agenda === 'failed' ? { text: r.agendaError || 'The agenda is approved, but its email to the board didn’t go. Board tries again by itself in a few minutes, or press Email the board.', kind: 'error' }
        : r.agenda === 'waiting' ? 'Approved. It goes to the board as soon as they’ve had the email on how to sign in' : 'Approved'),
      ({ was, now, look }) => {
        // (no look at the site either: nothing can be said either way)
        if (!look?.ok) return { text: `${LOST}, so this page can’t tell whether the agenda was approved and sent to the board. Reload the page to see.`, known: false };
        const yes = look.approvals?.[m.id];
        if (!yes) return { text: `${LOST}, and the site has no approval for this agenda, so nothing went to the board. Approve it again when you’re ready.`, known: true, bad: true };
        const emailed = now?.packetSentAt && now.packetSentAt !== was.packetSentAt;
        return { text: `${LOST}, but the agenda is approved${emailed ? `, and the link was emailed to ${plural(now.packetSentTo || 0, 'board member')}` : signInOf(look).told ? '. Its email to the board goes by itself' : '. It goes to the board as soon as they’ve had the email on how to sign in'}.`, known: true };
      });
    if (j?.approvals) ctx.setData((d) => ({ ...d, approvals: j.approvals }));
  };
  // Emailing the link puts the meeting on the board page first: one press, not two
  const email = async () => {
    const d = await look('send');
    if (!d) return;
    // (emailed already, or on the board page, as the site has it at the press: siteCopy)
    const sm = siteCopy(d, m);
    // (held since this page read it: nothing asking the board to read ahead goes, said as the site says it. Round 12)
    if (heldNoSend(sm)) { addToast(heldNoSend(sm), 'info'); return; }
    const to = d.members.filter((x) => x.email).map((x) => x.name);
    const none = d.members.filter((x) => !x.email).map((x) => x.name);
    if (!to.length) { addToast('No board member has an email on file (People → Board), so there’s no one to email.', 'error'); return; }
    const went = sm.packetSentAt ? `${plural(sm.packetSentTo || 0, 'board member')} ${sm.packetSentTo === 1 ? 'was' : 'were'} emailed the link ${ago(sm.packetSentAt)}. ` : '';
    if (!(await ask({ title: `Email ${andList(to)} the link${went ? ' again' : ''}?`, text: `${doubtWords(doubt.send, 'the email', { once: true })}${went}${sm.shared ? 'They get' : 'The meeting goes on the board page, and they get'} the agenda${docs ? `, ${docs}` : ' (no documents yet)'} and the link to the board page${toRead ? `, the ${nameIn(toRead, d.meetings)} minutes to read before the vote` : ''}, and their own list of what’s left to do: reports to write, papers to sign, and the calendar invite if they haven’t answered it. Nothing is attached.${none.length ? ` ${andList(none)} ${none.length === 1 ? 'has' : 'have'} no email, so ${none.length === 1 ? 'gets' : 'get'} nothing.` : ''}`, yes: went || doubt.send ? 'Email them again' : 'Email the board', careful: !!(went || doubt.send) }))) return;
    // (on the board page first, or nothing goes: why it didn't is said)
    if (!sm.shared && !(await putOnPage(pressed, true))) return;
    // (again on purpose: the send this page showed, so only a send it knew of goes again: functions/api/_board.js
    // sendOnce. A press that never showed it sends it to nobody who has it. Board QA round 12)
    run('send', { action: 'send-packet', id: m.id, ...(sm.packetSentAt ? { seen: sm.packetSentAt } : {}) }, (j) => `Emailed ${plural(j.sent, 'board member')}`, ({ was, now }) => (now?.packetSentAt && now.packetSentAt !== was.packetSentAt
      ? { text: `${LOST}, but it went: the link was emailed to ${plural(now.packetSentTo || 0, 'board member')} ${ago(now.packetSentAt)}.`, known: true }
      : { text: lostOnce('the board was emailed'), known: false }));
  };
  /** What the site's record of the invite shows after a press whose answer never came */
  const inviteLost = ({ was, now }) => (now?.invite && JSON.stringify(now.invite) !== JSON.stringify(was.invite || null)
    ? { text: `${LOST}, but the invite went: it’s on ${whoseOf(now.invite.organizer)} calendar now.`, known: true }
    : { text: `${LOST}, so this page can’t tell whether the invite went. Look on ${whose} Google Calendar before sending it again.`, known: false });
  // Why no invite goes out for this meeting ('' when one can: ./board-shared.js noInviteFor, the site's rule): said in the
  // invite's step, with nothing to press
  const noInvite = m.date ? noInviteFor(m) : '';
  // The invite names who Google emails before it goes (the board as the site has it now: useFresh), and who it can't
  // reach; once it's gone, its toast names who the site's answer says is on it now, never the question's guess
  const invite = async () => {
    const d = await look('invite');
    if (!d) return;
    // (the invite as the site has it at the press, sent from another tab or not: siteCopy)
    const sm = siteCopy(d, m);
    const inv = sm.invite;
    const by = inv?.organizer || d.settings.invitesFrom;
    const name = (e) => guestName(e, d);
    const to = inv ? inviteMissing(sm, d) : inviteGuests(d).filter((e) => e !== by);
    if (inv && !to.length) {
      addToast(m.invite ? 'Everyone on the board is on the invite now, so there’s no one to add.' : `The invite went out${inv.sentAt ? ` ${ago(inv.sentAt)}` : ' already'}, and everyone on the board is on it, so nothing went again.`, 'info');
      focusTask(pressedTask(), '.bm-ready');
      return;
    }
    const names = andList(to.map(name));
    const noEmail = d.members.filter((x) => !x.email).map((x) => x.name);
    if (!(await ask({
      title: !inv ? 'Send the invite?' : `Add ${names} to the invite?`,
      text: `${doubt.invite ? `The last time, at ${savedAt(doubt.invite)}, no answer came back, so the invite may have gone then. Look on ${whose} Google Calendar first. ` : ''}${!inv ? `Google emails the invite to ${names}, with Google Meet, the place and the link to the agenda.${noEmail.length ? ` ${andList(noEmail)} ${noEmail.length === 1 ? 'has' : 'have'} no email, so ${noEmail.length === 1 ? 'gets' : 'get'} no invite.` : ''}` : `Google emails ${to.length === 1 ? 'the invite to them' : 'each of them the invite'}. Nobody else hears about it.`}`,
      yes: !inv ? 'Send the invite' : 'Add them',
      careful: !!doubt.invite,
    }))) return;
    const had = new Set(inv?.emails || []);
    run('invite', { action: 'send-invite', id: m.id }, (j) => {
      const now = j.meeting?.invite;
      const got = (now?.emails || []).filter((e) => e !== now.organizer && !had.has(e));
      return got.length ? `Invite sent to ${andList(got.map(name))}` : 'Invite sent';
    }, inviteLost);
  };
  // Held (its day gone by, or run here and ended): what was done, nothing left to send
  if (((m.date && m.date < todayEastern()) || m.live.endedAt) && !isLive(m)) {
    return html`<div class="card bm-check bm-ready">
      <div class="bd-card-head"><h3 tabindex="-1">Getting ready</h3><p>${m.live.endedAt ? 'This meeting was held' : `This meeting was on ${longDate(m.date)}`}. ${minutesIn(m) ? 'Its minutes are in After.' : 'Its minutes go in After.'}</p></div>
      <ol class="bm-tasks">
        <${Task} state=${inv ? 'done' : 'skip'} title=${inv ? `Invite sent from ${whoseOf(inv.organizer)} calendar` : 'No invite went out from Board'} />
        <${Task} state=${m.shared ? 'done' : 'skip'} title=${m.shared ? 'On the board page' : 'Not on the board page'} sub=${m.shared ? '' : 'It goes there with its minutes, from After.'} />
        <${Task} state=${m.packetSentAt ? 'done' : 'skip'} title=${m.packetSentAt ? `${plural(m.packetSentTo, 'board member')} emailed the link` : 'The board wasn’t emailed the link'} />
      </ol>
    </div>`;
  }
  return html`<div class="card bm-check bm-ready">
    <div class="bd-card-head"><h3 tabindex="-1">Getting ready</h3><p>${[sInvite, sApproved, sShared, sSent].every((x) => x === 'done') ? 'The invite, the approval, the board page and the email are done. The numbers lock on the meeting day.' : 'The agenda is ready, and the numbers lock on the meeting day. What’s left:'}</p></div>
    <${NoEmail} ctx=${ctx} what="no invite or email, and can’t check in on the board page" />
    <ol class="bm-tasks">
      <${Task} state=${sInvite} title=${inv ? `Invite sent from ${whoseOf(inv.organizer)} calendar` : noInvite ? 'No calendar invite' : m.inviteGone ? 'The invite was deleted' : 'Send the invite'}
        sub=${inv ? [plural(inv.guests, 'guest'), inv.meet ? 'Google Meet' : '', where, missing.length ? `${andList(missing.map(nameOf))} not on it yet` : '', inv.putBackAt ? `changed in Google Calendar, Board’s put back ${ago(inv.putBackAt)}` : '', noInvite].filter(Boolean).join(' · ')
          : noInvite || (m.inviteGone ? `Someone deleted it in Google Calendar ${ago(m.inviteGone)}, so it’s off the board’s calendars. Send it again, or delete this meeting (⋯ at the top).`
            : `From ${whose} calendar to ${adds}: Google Meet, the place and the link to the agenda.`)}>
        ${!noInvite && (!inv || missing.length) ? html`<button class=${btn(sInvite)} disabled=${!!working || !data.setup.calendar || !m.date} onClick=${invite}>
          ${working === 'invite' ? 'Sending…' : looking === 'invite' ? CHECKING : !inv ? (m.inviteGone ? 'Send it again' : 'Send the invite') : `Add ${missing.length === 1 ? nameOf(missing[0]).split(' ')[0] : `the ${missing.length} missing`}`}</button>` : null}
        ${!data.setup.calendar && !noInvite ? html`<span class="bd-muted">Board can’t reach Google Calendar yet (Site → Automations says what’s missing).</span>` : null}
        ${inv?.differs && !noInvite ? html`<div class="bm-note is-warn" role="note"><span>Someone changed this invite in Google Calendar again after Board put its day, time and place back. Change them here (Change when and where) and they go on it, or send Board’s again.</span>
          <button class="btn btn-sm btn-primary" disabled=${!!working} onClick=${() => run('invite', { action: 'send-invite', id: m.id }, 'Board’s day, time and place are back on the invite', inviteLost)}>${working === 'invite' ? 'Sending…' : 'Send Board’s again'}</button></div>` : null}
        ${others.length ? html`<p class="bm-note is-warn" role="note">${others.length === 1 ? 'Another invite for this meeting is' : `${others.length} other invites for this meeting are`} on ${andList([...new Set(others.map((o) => whoseOf(o.on)))])} calendar: ${andList(others.map((o) => `“${o.title}”`))}${senders.length && !mineOnly ? `, sent by ${andList(senders.map(senderName))}` : ''}. ${mineOnly ? `Cancel ${others.length === 1 ? 'it' : 'them'}` : `Ask ${senders.length ? (senders.length === 1 ? 'them' : 'each') : 'whoever sent it'} to cancel ${others.length === 1 ? 'it' : 'theirs'}`}, so the board has one invite and one call.</p>` : null}
      </${Task}>
      <${Task} state=${sApproved} title=${approval ? `Agenda approved by ${approval.by}` : 'Approve the agenda'}
        sub=${approval ? ago(approval.at) : approveSub}>
        ${approval ? null : html`<button class="btn btn-ghost btn-sm" disabled=${!!working || !data.setup.email} onClick=${() => run('preview', { action: 'send-packet', id: m.id, test: true }, (j) => `Sent to ${j.to?.[0] || 'you'}`, testLost)}>${working === 'preview' ? 'Sending…' : 'Send me the email'}</button>`}
        ${approval ? null : html`<button class=${btn(sApproved)} disabled=${!!working || !agendaItems(m).length} onClick=${approve}>${working === 'approve' ? 'Approving…' : looking === 'approve' ? CHECKING : 'Approve the agenda'}</button>`}
      </${Task}>
      ${approval || m.shared ? html`<${Task} state=${sShared} title=${m.shared ? 'On the board page' : 'Put it on the board page'} sub=${m.shared ? 'Board members see the agenda and files (never a private note or a staff-only file).' : 'Board members see nothing of this meeting until then. Emailing the board puts it there too.'}>
        ${m.shared ? html`<button class="btn btn-ghost btn-sm" onClick=${() => share(false)}>Take it off</button>` : html`<button class=${btn(sShared)} onClick=${() => share(true)}>Share with the board</button>`}
      </${Task}>
      <${Task} state=${sSent} title=${m.packetSentAt ? `${plural(m.packetSentTo, 'board member')} emailed the link` : 'Email the board the link'}
        sub=${m.packetSentAt ? ago(m.packetSentAt) : `${emailWaits ? (data.setup.email ? `It goes once its agenda is approved: approving it sends it by itself${signIn.told ? '' : ', as soon as the board has had the email on how to sign in'}. ` : '') : 'It goes by itself as soon as it can, or now from here. '}The agenda itself${docs ? `, ${docs}` : ''} and the link to the board page (nothing attached)${toRead ? `, the ${nameIn(toRead, data.meetings)} minutes to read before the vote` : ''}, and a nudge to answer the calendar invite for anyone who hasn’t. It goes to ${plural(data.packetTo, 'board member')}.`}>
        <button class="btn btn-ghost btn-sm" disabled=${!!working || !data.setup.email} onClick=${() => run('preview', { action: 'send-packet', id: m.id, test: true }, (j) => `Sent to ${j.to?.[0] || 'you'}`, testLost)}>${working === 'preview' ? 'Sending…' : 'Send me the email'}</button>
        ${emailWaits ? html`<span class="bd-muted">Once its agenda is approved, above.</span>`
          : html`<button class=${btn(sSent)} disabled=${!!working || !data.packetTo || !data.setup.email} onClick=${email}>${working === 'send' ? 'Sending…' : looking === 'send' ? CHECKING : m.packetSentAt ? 'Email again' : 'Email the board'}</button>`}
        ${!data.setup.email ? html`<span class="bd-muted">Email isn’t set up yet (Site → Automations says what’s missing).</span>` : null}
      </${Task}>` : null}
    </ol>
    <div class="bm-reports">
      <p class="bm-reports__h"><strong>Reports</strong>${asked.length ? html`<span class=${inCount === asked.length ? 'is-all' : ''}>${inCount} of ${asked.length} in</span>` : null}</p>
      ${asked.length ? html`<p class="bd-muted">${asked.every(({ it }) => here(it)) ? 'These presenters don’t sign in to the board page, so their reports are written here: tap one to write it.' : `${m.shared ? 'Each presenter writes theirs on the board page, where it asks them.' : 'Once the meeting is on the board page, each presenter writes theirs there.'}${asked.some(({ it }) => here(it)) ? ' Where it says “Write it here”, the presenter doesn’t sign in to the board page: tap it to write theirs here.' : ''}`}</p>
      <ul class="bm-reports__list">${asked.map(({ x, it }) => html`<li key=${it.id}>
        <a class=${`bm-reports__row ${it.report ? 'is-in' : ''}`} href=${`#agx-${m.sections[x.si].id}`} onClick=${(e) => { e.preventDefault(); dispatchEvent(new CustomEvent('agx-report', { detail: { id: it.id, write: !it.report } })); }}>
          <span class="bm-reports__n">${x.label}</span>
          <span class="bm-reports__t"><span>${x.title}</span><small>${namesText(presentersOf(it, people).map((p) => (presentersOf(it, people).length > 1 ? p.name.split(' ')[0] : p.name)))}</small></span>
          <span class="bm-reports__s">${it.report ? html`${CHECK}<span>${ago(it.reportAt) || 'In'}</span>` : here(it) ? 'Write it here' : 'Not yet'}</span>
        </a>
      </li>`)}</ul>` : html`<p class="bd-muted">None asked for yet: an item asks for one once someone on the board presents it.</p>`}
      <${ReportEmails} ctx=${ctx} />
    </div>
  </div>`;
}

/**
 * The emails asking presenters for their reports, and the chair's review (functions/api/_board-asks.js): from the admin
 * the invites don't come from, the organizer copied. Test sends each one to that admin alone, once a meeting; On sends
 * them to the board, so it asks first; Off sends none. One switch for every meeting, beside the reports it asks for.
 */
function ReportEmails({ ctx }) {
  const { data, setData, addToast } = ctx;
  const s = data.settings;
  const [busy, setBusy] = useState(false);
  const asker = s.admins.find((e) => e !== s.invitesFrom) || s.invitesFrom || s.admins[0] || '';
  const mine = asker === data.me;
  const who = mine ? 'you' : firstOf(asker);
  const copied = s.invitesFrom && s.invitesFrom !== asker ? (s.invitesFrom === data.me ? 'you' : firstOf(s.invitesFrom)) : '';
  const from = `${mine ? 'your' : `${firstOf(asker)}’s`} Gmail${copied ? `, ${copied} copied` : ''}`;
  const mode = ['on', 'off'].includes(s.asks) ? s.asks : 'test';
  const hint = {
    test: `Each email comes to ${who} alone, once a meeting, its subject saying who it’s for. The board gets nothing yet.`,
    on: `From ${from}: two weeks before each meeting, each presenter is asked for their report, due a week before; then a reminder. Six days before, the chair gets the whole agenda to review.`,
    off: 'No emails. Presenters write their reports on the board page.',
  };
  const change = async (v) => {
    if (v === mode) return;
    if (v === 'on' && !(await ask({ title: 'Email the board for their reports?', text: `From ${from}: two weeks before each meeting, each board member presenting an item is asked for their report, then reminded, and six days before, the chair gets the whole agenda to review. Their replies go on the agenda.`, yes: 'Turn them on', no: 'Not yet' }))) return;
    setBusy(true);
    const j = await call({ action: 'save-settings', settings: { asks: v } });
    setBusy(false);
    if (!j.ok) { addToast(j.error, 'error'); return; }
    setData((d) => ({ ...d, settings: j.settings }));
    addToast(v === 'on' ? 'Report emails are on: the board gets them' : v === 'off' ? 'Report emails are off' : `Report emails go to ${who} only`, 'info');
  };
  return html`<div class="bm-asks">
    <div class="bm-asks__row"><label class="bm-asks__l" for="bm-asks">Emails asking for them</label>
      <select id="bm-asks" class="form-select bm-asks__pick" value=${mode} disabled=${busy} onChange=${(e) => change(e.target.value)}>
        <option value="test">Test: to ${mine ? 'me' : firstOf(asker)} only</option>
        <option value="on">On: to the board</option>
        <option value="off">Off</option>
      </select></div>
    <p class="bd-muted bm-asks__hint">${hint[mode]}</p>
  </div>`;
}

/** Who's coming: answers on the board page and replies to the calendar invite */
function Coming({ m, ctx, act }) {
  const { data, addToast } = ctx;
  const [working, setWorking] = useState('');
  const [doubt, setDoubt] = useState(''); // when the last reminder's answer never came back: it may have gone
  const head = useRef(null);
  const said = useRef(null);
  const board = m.attendance.filter((x) => x.kind === 'board');
  // Their reply to the calendar invite, the only answer SOARD goes by (Peter, Nov 2 2026); checked in on the day, there
  const replies = repliesOf(m);
  const answer = (x) => (x.status === 'present' ? 'Coming' : x.status === 'remote' ? 'By video' : answerOf('', replies[x.slug]));
  const emailOf = (x) => data.members.find((y) => y.slug === x.slug)?.email || '';
  // Before any invite went out nobody is "not on" it; for a meeting no invite goes out for (one that isn't a board
  // meeting: ./board-shared.js noInviteFor), it's said, never "yet" (QA round 6, Nov 21 2026)
  const invited = !!m.invite?.eventId;
  const none = !invited && m.notBoard;
  const groups = [['Coming', board.filter((x) => answer(x) === 'Coming')], ['By video', board.filter((x) => answer(x) === 'By video')], ['Maybe', board.filter((x) => answer(x) === 'Maybe')], ['Can’t come', board.filter((x) => answer(x) === 'Can’t come')],
    ['No answer', board.filter((x) => !answer(x) && replies[x.slug])], [invited ? 'Not on the invite' : none ? 'No calendar invite' : 'No invite yet', board.filter((x) => !answer(x) && !replies[x.slug])]];
  // Who a reminder goes to, as the site sends it (functions/api/_board.js notAnswered): on People → Board now with an
  // email, on the invite, and not answered it, from Board's data (`d`: as the site has it now, for its question)
  // (`r`: the replies as the site has them at the press: siteCopy)
  const toAsk = (d, r = replies) => d.members.filter((p) => p.email && r[p.slug] === 'invited');
  const quiet = toAsk(data);
  // Who the reminder went to and when, as the site keeps it (functions/api/_board.js remindedOf: the send's own record),
  // so every tab says so, after a reload too, as Email the board does. Board QA round 8, Nov 21 2026: "Asked … just now"
  // lived only in the tab that sent it, and another tab asked the whole board again with the first-time question
  const reminded = askedOf(m, data.members);
  const lastAsked = Object.values(reminded).sort().at(-1) || '';
  const askedLast = lastAsked ? board.filter((x) => reminded[x.slug] === lastAsked).map((x) => x.name.split(' ')[0]) : [];
  const allAsked = quiet.length > 0 && quiet.every((p) => reminded[p.slug]);
  const off = invited ? groups.at(-1)[1] : [];
  // Only someone with an email on file can be added (Getting ready's button adds them)
  const addable = off.filter(emailOf);
  const them = addable.length === 1 ? 'them' : 'them all';
  const adds = !addable.length ? 'they have no email on file' : `Send the invite adds ${them}${addable.length < off.length ? ` (${off.length - addable.length} with no email can’t be)` : ''}`;
  const [looking, look] = useFresh(ctx);
  // A reminder names who gets it before it goes: the board as the site has it now (useFresh)
  const remind = async (test) => {
    let who = quiet;
    // (asked again on purpose: the last ask this page showed them, so only one it knew of goes again. Board QA round 12)
    let seen = '';
    if (!test) {
      const d = await look('send');
      if (!d) return;
      const sm = siteCopy(d, m);
      // (held since this page read it: nobody is asked whether they'll come, said as the site says it. Round 12)
      if (heldNoSend(sm)) { addToast(heldNoSend(sm), 'info'); requestAnimationFrame(() => head.current?.focus()); return; }
      who = toAsk(d, repliesOf(sm));
      if (!who.length) { addToast('Everyone on the invite has answered it, so there’s no one to ask.', 'info'); requestAnimationFrame(() => head.current?.focus()); return; }
      // Asked already, as the site has it at the press: said with when, as the other sends' "again" questions are, and
      // asked carefully (the focus on Cancel); someone not asked yet is asked plainly
      const had = askedOf(sm, d.members);
      const again = who.filter((x) => had[x.slug]);
      const when = new Map();
      for (const x of again) when.set(ago(had[x.slug]), [...(when.get(ago(had[x.slug])) || []), x.name]);
      const before = [...when].map(([w, names]) => `${andList(names)} ${names.length === 1 ? 'was' : 'were'} asked ${w}.`).join(' ');
      const all = again.length === who.length;
      seen = again.map((x) => had[x.slug]).sort().at(-1) || '';
      if (!(await ask({ title: `Ask ${all && who.length > 1 ? 'them' : andList(who.map((x) => x.name))}${all ? ' again' : ''}?`, text: `${doubtWords(doubt, 'the reminder', { once: true })}${before ? `${before} ` : ''}${who.length === 1 ? 'They get' : 'Each gets'} an email asking them to answer the calendar invite. Their answer shows here.`, yes: all ? 'Ask them again' : who.length === 1 ? 'Ask them' : `Ask all ${who.length}`, careful: !!doubt || again.length > 0 }))) return;
    }
    setWorking(test ? 'preview' : 'send');
    // (who was asked when is the send's record, read at the next press: a lost answer says it may have gone, and the next
    // question says who the site has as asked)
    // A lost answer: the site's record of who was asked when says what really happened, as Email the board's does
    // (coordinator, Board QA round 8); with nothing new in it, it may have gone
    const j = await act({ action: 'remind-rsvp', id: m.id, test, ...(seen ? { seen } : {}) }, { lost: ({ was, now }) => {
      if (test) return { text: `${LOST}, so this page can’t tell whether the test went. Look in your inbox before sending it again.`, known: false };
      const members = look?.ok ? look.members || data.members : data.members;
      const last = (x) => Object.values(askedOf(x, members)).sort().at(-1) || '';
      const at = last(now);
      if (at && at > last(was)) {
        const names = board.filter((x) => askedOf(now, members)[x.slug] === at).map((x) => x.name);
        return { text: `${LOST}, but it went: ${andList(names)} ${names.length === 1 ? 'was' : 'were'} asked ${ago(at)}.`, known: true };
      }
      setDoubt(new Date().toISOString());
      return { text: lostOnce('the reminder went'), known: false };
    }, settled: () => { if (!test) setDoubt(''); } });
    setWorking('');
    if (j) addToast(test ? `Sent to ${j.to?.[0] || 'you'}` : `Asked ${plural(j.sent, 'board member')}${j.notOnInvite?.length ? `. Not on the invite: ${j.notOnInvite.join(', ')}` : ''}${j.later ? `. ${j.later}` : ''}`, 'info');
    if (j && !test) setDoubt('');
    // The focus on what the press did ("Asked … just now"), else the card's name: never on Ask, nor one key from it
    // (Enter on Ask opens its question on "Ask all 4", and a second Enter sends it to the board)
    requestAnimationFrame(() => ((j && !test && said.current) || head.current)?.focus());
  };
  const answered = board.length - groups.at(-2)[1].length - groups.at(-1)[1].length;
  // Past (and not run here): who was there is the minutes' to say
  if (m.date && m.date < todayEastern() && !m.live.startedAt) return null;
  return html`<div class="card bm-coming">
    <div class="bd-card-head"><h3 tabindex="-1" ref=${head}>Who’s coming</h3><p>${none ? 'It isn’t a board meeting, so no calendar invite goes out for it' : answered ? `${answered} of ${board.length} board members ${answered === 1 ? 'has' : 'have'} answered the calendar invite` : 'Nobody has answered the calendar invite'}${none ? '' : !invited ? '. The invite hasn’t gone out yet' : off.length ? `. ${off.length === 1 ? `${off[0].name} isn’t` : `${off.length} aren’t`} on it: ${adds}` : ''}.</p></div>
    <div class="bm-bar" role="img" aria-label=${groups.filter(([, l]) => l.length).map(([t, l]) => `${l.length} ${t.toLowerCase()}`).join(', ')}>
      ${groups.map(([t, l]) => (l.length ? html`<span class=${`bm-bar__part is-${t === 'Coming' || t === 'By video' ? 'yes' : t === 'Can’t come' ? 'no' : t === 'Maybe' ? 'maybe' : 'none'}`} style=${`flex:${l.length}`}></span>` : null))}
    </div>
    <dl class="bm-who">${groups.filter(([, l]) => l.length).map(([t, l]) => html`<div><dt>${t} <b>${l.length}</b></dt><dd>${l.map((x, i) => html`${i ? ', ' : ''}${x.name}${emailOf(x) ? null : html` <span class="bm-who__no">(no email)</span>`}`)}</dd></div>`)}</dl>
    <${Quorum} m=${m} ctx=${ctx} coming=${groups[0][1].length + groups[1][1].length} />
    ${quiet.length && m.date >= todayEastern() && !m.live.startedAt ? (m.shared ? html`${askedLast.length ? html`<p class="bd-muted bm-coming__wait" role="status" tabindex="-1" ref=${said}>Asked ${andList(askedLast)} ${ago(lastAsked)}.</p>` : null}<div class="bd-actions" style="margin-top:0.75rem">
      <button class=${`btn btn-sm ${allAsked ? 'btn-ghost' : 'btn-primary'}`} disabled=${!!working} onClick=${() => remind(false)}>${working === 'send' ? 'Sending…' : looking ? CHECKING : allAsked ? 'Ask again' : quiet.length === 1 ? `Ask ${quiet[0].name.split(' ')[0]}` : `Ask the ${quiet.length} who haven’t answered`}</button>
      <button class="btn btn-ghost btn-sm" disabled=${!!working} onClick=${() => remind(true)}>${working === 'preview' ? 'Sending…' : 'Send me the reminder'}</button>
    </div>` : html`<p class="bd-muted bm-coming__wait">Once it’s on the board page, you can ask the ones who haven’t answered.</p>`) : null}
  </div>`;
}

/**
 * How many make a quorum, beside who's coming: a majority of the board on the meeting's list, or the number the bylaws
 * set (saved for every meeting; empty goes back to a majority). Said as what it means for this meeting.
 */
function Quorum({ m, ctx, coming }) {
  const { data, setData, addToast } = ctx;
  const [editing, setEditing] = useState(false);
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef(null);
  const board = attendanceCounts(m).board;
  if (!board) return null;
  const set = Number(data.settings.quorum) > 0;
  const need = quorumFor(m, data.settings.quorum);
  const open = () => { setN(set ? String(data.settings.quorum) : ''); setEditing(true); requestAnimationFrame(() => field.current?.focus()); };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const j = await call({ action: 'save-settings', settings: { quorum: Number(n) || 0 } });
    setBusy(false);
    if (!j.ok) { addToast(j.error, 'error'); return; }
    setData((d) => ({ ...d, settings: j.settings }));
    setEditing(false);
    addToast(j.settings.quorum ? `A quorum is ${j.settings.quorum} board members, for every meeting` : 'A quorum is a majority of the board again', 'info');
  };
  if (editing) {
    return html`<form class="bm-quorum-set" onSubmit=${save}>
      <label class="bm-asks__l" for="bm-q">Board members for a quorum</label>
      <div class="bd-inline"><input id="bm-q" ref=${field} class="form-input bm-quorum-set__n" type="number" min="1" max="50" inputmode="numeric" placeholder=${`${majority(board)}`} value=${n} onInput=${(e) => setN(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }} />
        <button class="btn btn-primary btn-sm" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save'}</button>
        <button class="btn btn-ghost btn-sm" type="button" onClick=${() => setEditing(false)}>Cancel</button></div>
      <p class="bd-muted bm-asks__hint">Empty is a majority of the board on each meeting’s list (${majority(board)} of ${board} now). A number only if the bylaws say so; it’s for every meeting.</p>
    </form>`;
  }
  return html`<p class="bm-quorum-line"><span><strong>${need} of ${board}</strong> make a quorum${set ? '' : ' (a majority)'}${coming >= need ? '. Enough are coming.' : coming ? `. ${need - coming} more needed.` : '.'}</span>
    <button type="button" class="bd-linkbtn" onClick=${open}>Change</button></p>`;
}

// ─── The presentation's slides, in words ──────────────────────────

/** What a stop is, in words: { label: '3.2' | '', title, sub } */
function stopWords(stop, m, items, pages, files, shows = {}, words = {}) {
  if (!stop || stop.kind === 'cover') return { label: '', title: 'The cover', sub: `${meetingName(m)} and the agenda` };
  if (stop.kind === 'end') return { label: '', title: 'The close', sub: 'What the board decided, and the next meeting' };
  if (stop.kind === 'since') return { label: '', title: 'Since we last met', sub: 'The reveals and events since, and the action items' };
  if (stop.kind === 'section') { const si = m.sections.findIndex((x) => x.id === stop.sectionId); const sec = m.sections[si]; return { label: String(si + 1).padStart(2, '0'), title: sec?.title || 'Agenda', sub: sec?.items.filter(isFilled).length ? `Opens the part: ${plural(sec.items.filter(isFilled).length, 'item')}` : 'Open to the floor' }; }
  // By its item's id, not its place: the presentation's list can be a moment behind the agenda (an item just deleted
  // or moved); a stop whose item has just gone reads as nothing until the list catches up
  const it = stop.n < 0 && !items.some((x) => x.id === stop.itemId) ? { label: '', title: MORE.title }
    : items.find((x) => x.id === stop.itemId) || { label: '', title: '', section: '', presenter: '' };
  if (stop.kind === 'item') return { label: it.label, title: it.title, sub: [it.section !== it.title ? it.section : '', it.presenter].filter(Boolean).join(' · ') };
  if (stop.kind === 'books') return { label: it.label, title: booksTitle(stop), sub: `${it.title} · from QuickBooks` };
  if (stop.kind === 'live') return { label: it.label, title: LIVE_TITLES[stop.fileId.slice(5)], sub: it.title };
  // The report on an item that shows live facts, its own slide after them
  if (stop.kind === 'report') return { label: it.label, title: `${stop.of > 1 ? `Report, ${(stop.page || 0) + 1} of ${stop.of}` : 'Report'} · ${it.title}`, sub: it.presenter || '' };
  // Its motion, a slide of its own after all it shows
  if (stop.kind === 'decision') return { label: it.label, title: `The decision · ${it.title}`, sub: it.presenter || '' };
  const f = files.find((x) => x.id === stop.fileId);
  // Its pages on, two side by side as an open book (or one; the rest of a very tall one, continued), in the screen's
  // words: counted to its last page with anything on it, a deck's slides as slides, nothing for a file of one page
  const ns = shows[stop.fileId];
  const n = Array.isArray(ns) && ns.length ? ns.reduce((last, x, i) => (x !== 0 ? i + 1 : last), 0) || ns.length : pages[stop.fileId] || 0;
  const on = n > 1 ? `${pagesText(stop.pages || [stop.page], words[stop.fileId] || (f ? pageWordOf(f) : 'page'))} of ${n}` : '';
  return { label: it.label, title: f ? docTitle(f.name) : 'A document', sub: [it.title, [on, stop.part ? 'continued' : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ') };
}


// ─── After ──────────────────────────────────────────────────────────

/** There's something to read once the minutes are in: read in, or their file here (an approval is not minutes, nor an item's notes before the meeting) */

/** Who typed minutes sent from the notes on the board page, as the send kept it, in words: never a guess at whoever holds the seat now */
const typedWords = (m, data) => (data.minutesTypedBy?.[m.id] ? `Typed by ${data.minutesTypedBy[m.id]}` : 'Typed on the board page');
/** The day they were sent, as Atlanta says it: "Nov 5" */
// When they first went in, and when they last changed if that was another day (a correction never takes the first date's place)
const sentDay = (m) => {
  const day = (iso) => dayOf(iso).replace(/, \d{4}$/, '');
  const first = day(m.minutesFrom?.first || m.minutesFrom?.at);
  const last = day(m.minutesFrom?.at);
  return first && last && first !== last ? `${first}, corrected ${last}` : first;
};

/** The minutes, as the board will read them on their page */
function MinutesDoc({ m, ctx }) {
  const { data } = ctx;
  // Who wasn't there is known only once someone was recorded there, the board page's own rule (portal.js: attendance shows
  // when a board member was there): minutes whose roll names nobody never read as the whole board away
  const c = attendanceCounts(m);
  const held = (!!m.minutesFrom || !!m.live.endedAt || m.attendance.some((x) => x.status)) && !isLive(m);
  const quorum = quorumFor(m, ctx.data.settings.quorum);
  const people = useMemo(() => pickable(ctx.data.people), [ctx.data.people]);
  const groups = [['Present', 'present'], ['By video', 'remote'], ['Absent', 'absent'], ['Excused', 'excused']].map(([t, s]) => [t, m.attendance.filter((x) => x.status === s)])
    .concat(held && c.boardHere ? [['Not there', m.attendance.filter((x) => x.kind === 'board' && !x.status)]] : []).filter(([, l]) => l.length);
  // Minutes in, and nobody on the board recorded there: said as that, never as everyone absent
  const noRoll = held && !!m.minutesFrom && !c.boardHere && !!c.board;
  const names = new Map(agendaItems(m).map((x) => [x.id, x.title]));
  const written = (minutesIn(m) || m.motions.length || m.actions.length) && (m.sections.some((s) => s.notes || s.items.some((it) => it.notes)) || m.motions.length || m.actions.length);
  // The minutes file by the one rule (typed: the file the send kept, wherever it's put), the one the board reads; one kept
  // Staff only is named as that (Board QA round 14)
  const minutesFile = ownMinutesFile(m);
  const staffNote = minutesFile?.staffOnly ? ' (staff only: the board can’t read it)' : '';
  const vf = viewerFiles(minutesFile ? [minutesFile] : []);
  return html`<div class="card bm-minutes">
    <div class="bd-card-head"><h3>The minutes ${m.minutes === 'approved' ? html`<span class="tag tag--success">Approved${m.approvedOn ? ` ${shortDate(m.approvedOn)}` : ''}</span>` : written ? html`<span class="tag">Draft</span>` : null}</h3>
      <p>${m.shared ? 'This is what board members read on their page.' : 'What board members will read once you share the meeting.'}${m.minutesFrom?.typed ? html` ${typedWords(m, data)}.${minutesFile ? html` <a class="link" ...${viewerLink(vf, 0)}>The minutes as written</a>${staffNote}.` : ''}` : m.minutesFrom ? ` Read from ${fileTitle(m.minutesFrom.name)}.` : minutesFile ? html` Written up in <a class="link" ...${viewerLink(vf, 0)}>${fileTitle(minutesFile.name)}</a>${staffNote}.` : ''}</p></div>
    ${groups.length ? html`<dl class="bm-who bm-who--doc">${groups.map(([t, l]) => html`<div><dt>${t} <b>${l.length}</b></dt><dd>${l.map((x) => x.name).join(', ')}</dd></div>`)}</dl>` : null}
    ${noRoll ? html`<p class="bd-muted bm-noroll">The minutes don’t say who was there.</p>` : null}
    ${written ? html`<ol class="bm-doc__sections">${m.sections.map((s) => html`<li key=${s.id}>
      <h4>${s.title}</h4>
      ${s.items.some(isFilled) ? html`<ul class="bm-doc__items">${s.items.filter(isFilled).map((it) => html`<li key=${it.id}>
        <div class="bm-doc__item">${it.title || names.get(it.id)}${presentersOf(it, people).length ? html`<span class="ag-item__who">${namesText(presentersOf(it, people).map((x) => x.name))}</span>` : null}${it.confidential ? html` <span class="tag tag--warn">Board only</span>` : null}</div>
        <${Notes} text=${it.notes} />
      </li>`)}</ul>` : null}
      ${s.notes ? html`<${Notes} text=${s.notes} />` : null}
    </li>`)}</ol>
    ${m.motions.length ? html`<h4 class="bm-doc__h">Decisions</h4><ul class="bm-doc__items">${m.motions.map((x) => html`<li key=${x.id}>${x.text} <span class="bd-muted">(${[x.by && `moved by ${x.by}`, x.second && `seconded by ${x.second}`, x.tally ? `${tallyText(x)}${quorum && x.tally.at && x.tally.of < quorum ? ', no quorum checked in' : ''}` : RESULTS.find((r) => r.id === x.result)?.label.toLowerCase()].filter(Boolean).join(', ')})</span></li>`)}</ul>` : null}
    ${m.actions.length ? html`<h4 class="bm-doc__h">Action items</h4><ul class="bm-doc__items">${m.actions.map((a) => html`<li key=${a.id}>${a.text} <span class="bd-muted">(${[a.ownerName || 'no one yet', a.due ? `by ${shortDate(a.due)}` : '', a.done ? 'done' : ''].filter(Boolean).join(', ')})</span></li>`)}</ul>` : null}
    ${lateWords(m) ? html`<p class="bd-muted bm-minutes__late">${lateWords(m)}</p>` : null}`
      : html`<div class="empty empty--inline"><p class="empty__title">${m.minutesFrom?.typed ? (m.minutes === 'approved' ? 'Only who was there' : 'Only who was there so far') : 'Nothing here yet'}</p><p class="empty__text">${m.minutesFrom?.typed ? (m.minutes === 'approved' ? 'These minutes are approved.' : m.shared ? 'The rest goes in from the notes on the board page.' : 'Share the meeting, then add the rest from the notes on the board page.') : 'Drop the minutes in (above): who was there, what was said under each item, the decisions and the action items fill in by themselves.'}</p></div>`}
    ${mailedWords(m) ? html`<p class="bd-muted bm-minutes__late">${mailedWords(m)}</p>` : null}
  </div>`;
}

/**
 * Minutes files that came by email after these were approved, kept for staff and never read in (functions/api/
 * _board-mail.js lateMinutesFiles): one quiet line under the minutes, for the founders only, while the file is still
 * kept with the meeting. Board QA round 9, Nov 22 2026
 */
function mailedWords(m) {
  const names = (m.lateMinutesFiles || []).filter((x) => (m.files || []).some((f) => f.name === x.name)).map((x) => fileTitle(x.name));
  if (!names.length) return '';
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return names.length === 1 ? `A newer minutes file came by email after these were approved, so Board didn’t read it in: ${list}. It’s kept with the meeting for staff.`
    : `Newer minutes files came by email after these were approved, so Board didn’t read them in: ${list}. They’re kept with the meeting for staff.`;
}

/**
 * What the heartbeat read from the minutes after they were approved, and so didn't add (functions/api/_board-minutes.js
 * maybeFinishMinutes): one quiet line under the minutes, for the founders only. Board QA round 8, Nov 21 2026
 */
function lateWords(m) {
  const late = m.minutesFrom?.late;
  const q = (t) => `“${t}”`;
  const list = [...(late?.motions || []).map((t) => `the decision ${q(t)}`), ...(late?.actions || []).map((t) => `the action item ${q(t)}`)];
  if (!list.length) return '';
  const words = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return `Read after they were approved, so not added: ${words}. Add ${list.length === 1 ? 'it' : 'them'} by hand if ${list.length === 1 ? 'it belongs' : 'they belong'}.`;
}

/**
 * "10 of 12 board members there, notes under 9 items, 3 decisions and 2 action items". A roll that names nobody there is
 * said as that ("they don't say who was there"), never as "0 of 12 there": nothing recorded isn't everyone absent
 */
function readWords(r, then = '') {
  if (!r) return '';
  const parts = [
    r.attendance?.of && r.attendance.here ? `${r.attendance.here} of ${r.attendance.of} board members there` : '',
    r.notes ? `notes under ${plural(r.notes, 'item')}` : '',
    r.motions ? plural(r.motions, 'decision') : '',
    r.actions ? plural(r.actions, 'action item') : '',
  ].filter(Boolean);
  // (`then`: what the read did beside, ", and marked the Sep 22 minutes approved, as these say")
  const said = `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || 'nothing Board could use'}${then}`;
  return r.attendance?.of && !r.attendance.here && parts.length ? `${said}. They don’t say who was there` : said;
}
/**
 * What a read or an Undo did to the last meeting's minutes, from the site's answer (never guessed): ", and marked the
 * Sep 22 minutes approved, as these say" or ", and the Sep 22 minutes are a draft again". Board QA round 8, Nov 21 2026:
 * both happened without a word
 */
const prevWords = ({ approved = null, back = null, again = null } = {}) => (approved ? `, and marked the ${shortDate(approved.date)} minutes approved, as these say`
  : back ? `, and the ${shortDate(back.date)} minutes are a draft again` : again ? `, and the ${shortDate(again.date)} minutes are approved again` : '');

/**
 * The minutes, dropped in: uploaded, then read into the meeting by the server straight away (who was there, the
 * notes under each item, the decisions, the action items). Undo puts back what was there
 */
function MinutesDrop({ m, set, ctx, act, keepSaved }) {
  const { addToast } = ctx;
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [lastRead, setLastRead] = useState(null);
  const c = attendanceCounts(m);
  // Typed and sent, they change in the notes on the board page: no file goes over them (the server says the same to a tab left open)
  if (m.minutesFrom?.typed) {
    const day = sentDay(m);
    return html`<div class="bm-minutes-drop bm-minutes-drop--typed is-done">
      <span class="bm-minutes-drop__icon" aria-hidden="true">${CHECK}</span>
      <span class="bm-minutes-drop__text"><strong>${typedWords(m, ctx.data)}</strong>
        <span>${[day ? `Sent ${day}` : 'Sent', c.boardHere ? `${c.boardHere} of ${c.board} board members there` : ''].filter(Boolean).join(': ')}.</span></span>
      ${m.minutes === 'approved' || !m.shared ? null : html`<a class="btn btn-ghost btn-sm bm-minutes-drop__btn" href=${`/admin/board/#/meetings/${m.id}`}>Open the board page</a>`}
    </div>`;
  }
  const readIn = async (file) => {
    if (!file) return;
    setBusy(true);
    // Unfiled until it's read in: a question left unanswered never leaves it as this meeting's minutes
    const up = await sendUp(ctx, file, { ownerType: 'meeting', ownerId: m.id, kind: 'other' });
    if (!up.ok) { setBusy(false); addToast(up.error, 'error'); return; }
    keepSaved((x) => withFile(x, up.file));
    const body = { action: 'read-minutes', id: m.id, fileId: up.file.id };
    const dropHere = async () => {
      const d = await call({ action: 'delete-file', id: up.file.id });
      if (d.ok) keepSaved((x) => ({ ...x, files: x.files.filter((f) => f.id !== up.file.id) }));
      return d;
    };
    // A clear no from the server (not minutes, or typed minutes a tab left open couldn't know about): the file doesn't stay
    // on the meeting, where the board would see it. A dropped connection isn't a no: that file may well have been read
    const refused = (r) => r.status === 409 || r.status === 422;
    const refuse = async (r) => { setBusy(false); const d = await dropHere(); addToast(`${r.error}${d.ok ? ` ${fileTitle(up.file.name)} isn’t kept.` : ''}`, 'error'); };
    let j = await act(body, { keep: refused });
    if (j && !j.ok && !j.other) { await refuse(j); return; }
    if (j && !j.ok) {
      setBusy(false);
      // The meeting they name: by its day, else by its name when only one meeting has it (two in a quarter share one)
      const others = ctx.data.meetings.filter((x) => x.id !== m.id);
      const byName = others.filter((x) => meetingName(x) === j.other.name);
      const other = (j.other.date && others.find((x) => x.date === j.other.date)) || (byName.length === 1 ? byName[0] : null);
      // Where they belong, first: that meeting, when Board has it
      if (other && !other.minutesFrom?.typed && await ask({ title: `Put them on the ${meetingName(other)} (${shortDate(other.date)})?`, text: `${j.error} Board can read them into that meeting instead, and this one stays as it is.`, yes: `Put them on the ${shortDate(other.date)} meeting`, no: 'Not those' })) {
        setBusy(true);
        const there = await sendUp(ctx, file, { ownerType: 'meeting', ownerId: other.id, kind: 'other' });
        const k = there.ok ? await call({ action: 'read-minutes', id: other.id, fileId: there.file.id }) : there;
        setBusy(false);
        if (!k.ok) {
          if (k.meeting) ctx.putMeeting(k.meeting);
          // A clear no: neither copy stays where the board would see it
          if (there.ok && refused(k)) { await call({ action: 'delete-file', id: there.file.id }); await dropHere(); }
          addToast(k.error || 'Couldn’t read them in there', 'error');
          return;
        }
        if (k.meeting) ctx.putMeeting(k.meeting);
        await call({ action: 'update-file', id: there.file.id, kind: 'minutes' });
        await dropHere();
        addToast(`Read into the ${meetingName(other)} (${shortDate(other.date)}): ${readWords(k.read)}`, 'info');
        return;
      }
      if (!(await ask({ title: 'Read them into this meeting?', text: `${other && !other.minutesFrom?.typed ? '' : `${j.error} `}Board would fill in this meeting’s attendance, notes, decisions and action items from them.`, yes: 'Read them into this one', no: 'Remove the file', careful: true }))) {
        const d = await dropHere();
        addToast(d.ok ? `${fileTitle(up.file.name)} is removed. Nothing changed on this meeting.` : d.error, d.ok ? 'info' : 'error');
        requestAnimationFrame(() => document.querySelector('.bm-minutes-drop input')?.focus());
        return;
      }
      setBusy(true);
      j = await act({ ...body, anyway: true }, { keep: refused });
      if (j && !j.ok) { await refuse(j); return; }
    }
    setBusy(false);
    if (!j) return;
    // Read in: this file is the minutes now, and a newer copy takes the last one's place
    await call({ action: 'update-file', id: up.file.id, kind: 'minutes' });
    keepSaved((x) => ({ ...x, files: x.files.map((f) => (f.id === up.file.id ? { ...f, kind: 'minutes' } : f)) }));
    // The earlier minutes' file came off on the site, in the same step as the read (functions/api/_board-minutes.js
    // readMinutesInto filesOff): which file the meeting keeps is the site's to say, never this page's copy, which may
    // not have the email reader's minutes, nor know they're approved. Board QA round 9, Nov 22 2026
    const off = new Set(j.filesOff || []);
    if (off.size) keepSaved((x) => ({ ...x, files: x.files.filter((f) => !off.has(f.id)) }));
    if (j.approvedPrev || j.replaced?.prevBack) ctx.load();
    // Undo is the site's, in one step (functions/api/_board-minutes.js undoMinutes): the meeting as the site kept it at
    // the read, the file off, and the last meeting's minutes back to draft if these approved them. Said once the site has
    // done it, with whatever was changed since and stays; never "Put back" for what the site still has. QA round 6, Nov
    // 21 2026: Undo put the page back and sent nothing, so the site kept the minutes and a reload brought them back
    let undoing = false;
    const undo = async () => {
      if (undoing) return;
      undoing = true;
      setLastRead(null);
      // (its Undo button goes: the focus on choosing the minutes again, never left on the page)
      requestAnimationFrame(() => document.querySelector('.bm-minutes-drop input')?.focus());
      const u = await act({ action: 'undo-minutes', id: m.id, fileId: up.file.id });
      undoing = false;
      if (!u) return;
      if (u.prev) ctx.putMeeting(u.prev);
      const left = Array.isArray(u.left) ? u.left : [];
      // (what Board read from them afterwards, on its own, came off too: said, as it was never said when it came in. QA
      // round 7, Nov 21 2026. Every change since that it kept is named, and the last meeting's minutes back to draft: round 8)
      const back = `Put back as it was before they were read in${prevWords({ back: u.prevBack, again: u.prevAgain })}`;
      const said = left.length ? `${back}, except: ${left.join(' ')}` : u.prevBack || u.prevAgain || u.also ? `${back}.` : back;
      addToast(u.also ? `${said} ${u.also}` : said, left.length ? 'error' : 'info');
    };
    setLastRead({ name: up.file.name, read: j.read, undo });
    // What it did to the last meeting's minutes, and (replacing) what the earlier read left that's kept, named
    const then = prevWords({ approved: j.prevApproved, back: j.replaced?.prevBack });
    const kept = j.replaced?.left?.length ? ` ${fileTitle(j.replaced.name)} came off first, except: ${j.replaced.left.join(' ')}` : '';
    addToast(`Read from the minutes: ${readWords(j.read, then)}${kept ? `.${kept}` : ''}`, 'info', { label: 'Undo', fn: undo });
  };
  return html`<label class=${`bm-minutes-drop ${over ? 'is-over' : ''} ${busy ? 'is-busy' : ''} ${m.minutesFrom && !busy ? 'is-done' : ''}`}
    onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${(e) => { e.preventDefault(); setOver(false); readIn(e.dataTransfer.files[0]); }}>
    <input type="file" class="sr-only" accept=".pdf,.docx" disabled=${busy} onChange=${(e) => { readIn(e.target.files[0]); e.target.value = ''; }} />
    <span class="bm-minutes-drop__icon" aria-hidden="true">${m.minutesFrom && !busy ? CHECK : html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8z" /><path d="M14 3.5V8h4.5M12 17v-6M9.5 13.5 12 11l2.5 2.5" /></svg>`}</span>
    <span class="bm-minutes-drop__text">
      <strong>${busy ? 'Reading the minutes…' : m.minutesFrom ? 'Read from the minutes' : 'Drop the minutes here'}</strong>
      <span>${busy ? 'Who was there, the notes under each item, the decisions and the action items.'
        : lastRead ? `${fileTitle(lastRead.name)}: ${readWords(lastRead.read)}.`
        : m.minutesFrom ? `${fileTitle(m.minutesFrom.name)}${c.board ? (c.boardHere ? `: ${c.boardHere} of ${c.board} board members there` : ': they don’t say who was there') : ''}.`
        : 'A PDF or Word file. Board fills in who was there, the notes under each item, the decisions and the action items.'}</span>
    </span>
    ${busy ? html`<span class="spinner" aria-hidden="true"></span>` : html`<span class="btn btn-ghost btn-sm bm-minutes-drop__btn" aria-hidden="true">${m.minutesFrom ? 'Replace the minutes' : 'Choose the file'}</span>`}
    ${lastRead?.undo && !busy ? html`<button type="button" class="btn btn-ghost btn-sm bm-minutes-drop__undo" onClick=${(e) => { e.preventDefault(); lastRead.undo(); }}>Undo</button>` : null}
  </label>`;
}

/** The minutes template (./board-minutes-template.js): this agenda to take the minutes on, on paper or typed into Word */
function MinutesTemplate({ m, ctx }) {
  const { data, addToast } = ctx;
  const [printing, setPrinting] = useState(false);
  const opts = { meetings: data.meetings, quorum: data.settings.quorum, people: pickable(data.people) };
  const print = async () => {
    setPrinting(true);
    try { await printMinutesTemplate(m, opts); } catch (err) { addToast(`Couldn’t print it: ${err.message}`, 'error'); }
    setPrinting(false);
  };
  const word = () => { try { downloadMinutesDocx(m, opts); } catch (err) { addToast(`Couldn’t make the Word file: ${err.message}`, 'error'); } };
  // The board's secretary has it on the board page too, and sends the typed minutes from there: said so only once the
  // meeting is on it (shared); until then, that they'll have it there once it's shared. Never for a meeting the board page
  // doesn't show: a practice, or one that isn't a board meeting (QA round 6, Nov 21 2026: it said "has it on the board
  // page" for a meeting only the founders could see)
  const secretary = m.practice || m.notBoard ? null : data.members.find((p) => p.seat === 'secretary' && p.email);
  const secWords = !secretary ? '' : m.shared ? `${secretary.name} (Board Secretary) has it on the board page too, and can send the typed minutes from there.`
    : `Once the meeting is shared, ${secretary.name} (Board Secretary) has it on the board page too, and can send the typed minutes from there.`;
  return html`<div class="card">
    <div class="bd-card-head"><h3>Minutes template</h3><p>This agenda with room under each item, the roll, the motions and the action items. Type into the Word file and drop it in after the meeting: every note lands on its item.${secWords ? ` ${secWords}` : ''}</p></div>
    <div class="bd-actions">
      <button type="button" class="btn btn-ghost btn-sm" disabled=${printing} onClick=${print}>${printing ? 'Printing…' : 'Print'}</button>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${word}>Word file</button>
    </div>
  </div>`;
}

function WrapUp({ m, set, ctx, act, save, saved, keepSaved, take }) {
  const { data, addToast } = ctx;
  const [working, setWorking] = useState('');
  const approved = m.minutes === 'approved';
  // The meeting whose agenda puts these minutes to the vote (./board-shared.js minutesApprover: minutesTarget's rule from
  // the other side), and the day it was held, once it has been
  const ap = minutesApprover(m, data.meetings);
  const apDay = ap ? heldOn(ap) : '';
  const signed = m.files.filter((f) => f.kind === 'signed').at(-1);
  const signature = data.minutesSigned?.[m.id] || null;
  // What the board suggested on the board page, where the secretary or a founder decides it
  const fixes = data.corrections?.[m.id] || [];
  const fixing = fixes.filter((c) => c.state === 'waiting').length;
  const fixed = fixes.filter((c) => c.state === 'made').length;
  const [doubt, setDoubt] = useState(''); // when the last notice's answer never came back: it may have gone
  const [looking, look] = useFresh(ctx);
  // Who it goes to, named before it goes: the board as the site has it now (useFresh)
  const send = async (test) => {
    const d = test ? data : await look('send');
    if (!d) return;
    // (approved or draft, and told already, as the site has them at the press: siteCopy)
    const sm = siteCopy(d, m);
    const to = d.members.filter((x) => x.email).map((x) => x.name);
    const none = d.members.filter((x) => !x.email).map((x) => x.name);
    if (!test && !to.length) { addToast('No board member has an email on file (People → Board), so there’s no one to email.', 'error'); return; }
    const told = sm.minutesSentAt ? `The board was told ${ago(sm.minutesSentAt)}. ` : '';
    if (!test && !(await ask({ careful: true, title: `Email ${andList(to)} that the minutes are up${told ? ' again' : ''}?`, text: `${doubtWords(doubt, 'the email', { once: true })}${told}Each gets the link to the ${sm.minutes === 'approved' ? 'approved' : 'draft'} minutes on the board page. Nothing is attached.${none.length ? ` ${andList(none)} ${none.length === 1 ? 'has' : 'have'} no email, so ${none.length === 1 ? 'gets' : 'get'} nothing.` : ''}`, yes: told || doubt ? 'Email them again' : 'Email the board' }))) return;
    const task = pressedTask();
    setWorking(test ? 'preview' : 'send');
    // (again on purpose: the send this page showed, so only one it knew of goes again. Board QA round 12)
    const j = await act({ action: 'send-minutes', id: m.id, test, ...(!test && sm.minutesSentAt ? { seen: sm.minutesSentAt } : {}) }, { lost: ({ was, now }) => {
      if (test) return { text: `${LOST}, so this page can’t tell whether the test went. Look in your inbox before sending it again.`, known: false };
      if (now?.minutesSentAt && now.minutesSentAt !== was.minutesSentAt) return { text: `${LOST}, but it went: the board was told ${ago(now.minutesSentAt)}.`, known: true };
      setDoubt(new Date().toISOString());
      return { text: lostOnce('the board was emailed'), known: false };
    }, settled: () => { if (!test) setDoubt(''); } });
    setWorking('');
    if (j) { if (!test) setDoubt(''); addToast(test ? `Sent to ${j.to?.[0] || 'you'}` : `Emailed ${plural(j.sent, 'board member')}${j.later ? `. ${j.later}` : ''}`, 'info'); focusNext('.bm-wrap'); } else focusTask(task, '.bm-wrap');
  };
  // Said once the site has it, never before; one that didn't go says why, and the page shows what the site has (putOnPage)
  const pressed = pressOf({ set, save, saved, take, ctx, m });
  const share = async (v) => {
    if (!(await putOnPage(pressed, v))) return;
    addToast(v ? 'On the board page' : 'Taken off the board page', 'info', v ? { label: 'Undo', fn: () => share(false) } : undefined);
    focusNext('.bm-wrap');
  };
  const hasMinutes = minutesIn(m);
  // (in only as a file kept Staff only: the board can't read them, said with what to do. Board QA round 14)
  const staffOnly = minutesStaffOnly(m);
  const today = todayEastern();
  // Not held yet: its day is ahead and it hasn't been run here (a meeting held early is held)
  const ahead = !!m.date && m.date > today && !m.live.startedAt;
  // On its day (not ended in Board), the board gets it only once its agenda is approved, as the site holds it
  // (shareWaits: one that isn't a board meeting is one once it's shared, so it waits too): Share isn't offered before
  // then, and it says when it can go, in the words a board meeting's gets
  const heldBack = !m.shared && !ahead && shareWaits(m, today) && !data.approvals?.[m.id];
  // Who sees what isn't on the board page: Board's admins (the founders), as the status line says it
  const few = youAnd(data.settings.admins, data.me);
  // Approved minutes off the board page say so: the board sees them approved only once they're shared
  const onceShared = 'Once they’re shared, the board sees them as approved.';
  // Approved on the day the meeting that had them to approve was held, once it has been (never today's date then, unless
  // that's today); else today
  const approvedDay = apDay || today;
  const approve = async (v) => {
    if (v && !(await ask({ title: 'Mark the minutes approved?', text: `As approved on ${shortDate(approvedDay)}${apDay ? `, at the ${nameIn(ap, data.meetings)}` : ''}. ${m.shared ? 'The board page shows them approved.' : onceShared}${fixes.some((c) => c.state === 'waiting') ? ' A correction to them is still waiting on the board page, and approving them leaves it out.' : ''}${data.notesWaiting?.includes(m.id) ? ' The secretary has typed notes on this meeting that were never sent: approved, they can’t be sent any more.' : ''}`, yes: 'Mark them approved' }))) return;
    // Said once the site has it, never before: minutes it won't take as approved (not in Board) say why, and stay draft
    const went = await pressSave(pressed, ...approvalPress(v, approvedDay));
    if (!went) return;
    // The board was told about draft minutes: offer to tell them they're approved
    addToast(v ? `Marked approved, ${shortDate(saved.current.approvedOn || approvedDay)}` : 'Back to draft minutes', 'info', v && m.shared && m.minutesSentAt ? { label: 'Tell the board', fn: () => send(false) } : undefined);
    focusNext('.bm-wrap');
  };
  const takeSigned = async (file) => {
    if (!file) return;
    setWorking('signed');
    // Named for what it is, whatever the file was called
    const named = new File([file], `Signed minutes, ${meetingName(m)}${(String(file.name).match(/\.[a-z0-9]{2,5}$/i) || [''])[0]}`, { type: file.type });
    const up = await sendUp(ctx, named, { ownerType: 'meeting', ownerId: m.id, kind: 'signed' });
    setWorking('');
    if (!up.ok) { addToast(up.error, 'error'); return; }
    keepSaved((x) => withFile(x, up.file));
    addToast('The signed copy is kept with the meeting', 'info');
  };
  const vf = viewerFiles([signed].filter(Boolean));
  const [sIn, sShared, sApproved] = statesOf([hasMinutes, m.shared, approved]);
  // Who approves them, as true for this meeting: the meeting that has them on its agenda, still ahead; or held, and
  // they aren't marked approved (said plainly, with the day Mark them approved gives them); or none in Board yet
  const approvesWhere = approved ? (m.shared ? 'Marked on the board page.' : onceShared)
    : ap && !apDay ? `On the agenda of the ${meetingName(ap)} (${shortDate(ap.date)}). Approving them there marks them here too.`
      : ap ? `The ${nameIn(ap, data.meetings)} on ${shortDate(apDay)} was held, and they aren’t marked approved. If the board approved them there, Mark them approved dates them ${shortDate(apDay)}.`
        : data.meetings.some((x) => x.date > m.date) ? 'At the next meeting: its agenda asks for this approval.' : 'The next meeting isn’t in Board yet. Its agenda asks for this approval once it’s added.';
  const nextVote = apDay ? '' : ' The board approves them at the next meeting.';
  return html`<div class="card bm-check bm-wrap">
    <div class="bd-card-head"><h3 tabindex="-1">After the meeting</h3><p>${approved ? (approvedNotShared(m) ? 'The minutes are approved, but the board can’t read them until their file is shared.' : m.shared ? 'Done: the minutes are approved.' : 'The minutes are approved. Share them with the board next.') : hasMinutes || staffOnly ? (apDay ? 'They aren’t marked approved yet.' : nextVote.trim()) : `Drop the minutes in and Board does the rest.${nextVote}`}</p></div>
    <ol class="bm-tasks">
      <${Task} state=${sIn} title=${hasMinutes ? 'The minutes are in' : staffOnly ? 'The minutes are staff only' : 'The minutes'} sub=${m.minutesFrom?.typed ? `${typedWords(m, data)}.` : m.minutesFrom ? `Read from ${fileTitle(m.minutesFrom.name)}.` : hasMinutes ? '' : staffOnly ? staffOnlyWords(staffOnly) : ahead ? 'After the meeting, drop them in: a PDF or Word file.' : 'Drop them in: a PDF or Word file.'} />
      <${Task} state=${sShared} title=${m.shared ? 'On the board page' : 'Share them with the board'} sub=${m.shared ? (m.minutesSentAt ? `The board was told ${ago(m.minutesSentAt)}.` : hasMinutes ? (ap && !apDay && !ap.packetSentAt && !approved && minutesToRead(ap, data.meetings)?.id === m.id ? 'The board can read them now, and the next agenda email asks them to before the vote.' : 'The board can read them now.') : staffOnly ? 'The board can’t read them while their file is staff only.' : 'The minutes show there once they’re in.') : approved ? `They’re approved, and only ${few} can see them until they’re shared.` : 'As draft minutes until they’re approved.'}>
        ${m.shared || ahead || heldBack ? null : html`<button class=${btn(sShared)} onClick=${() => share(true)}>Share with the board</button>`}
        <button class="btn btn-ghost btn-sm" disabled=${!!working || !data.setup.email || !hasMinutes} onClick=${() => send(true)}>${working === 'preview' ? 'Sending…' : 'Send me the email'}</button>
        <button class="btn btn-ghost btn-sm" disabled=${!!working || !m.shared || !data.packetTo || !data.setup.email || !hasMinutes} onClick=${() => send(false)}>${working === 'send' ? 'Sending…' : looking ? CHECKING : m.minutesSentAt ? 'Email the board again' : 'Email the board'}</button>
        ${ahead && !m.shared ? html`<span class="bd-muted">After the meeting.</span>`
          : heldBack ? html`<span class="bd-muted">${meetingOver(m) ? 'Its agenda was never approved, so it can go on the board page from tomorrow.' : 'Once its agenda is approved, in Getting ready.'}</span>`
          : staffOnly ? html`<span class="bd-muted">Once their file isn’t staff only.</span>` : !hasMinutes ? html`<span class="bd-muted">Once the minutes are in.</span>` : !m.shared ? html`<span class="bd-muted">Share them first, so the email has something to open.</span>` : null}
      </${Task}>
      <${Task} state=${sApproved} title=${approved ? `Approved${m.approvedOn ? ` ${shortDate(m.approvedOn)}` : ''}` : 'The board approves them'} sub=${approvesWhere}>
        ${approved ? html`<button class="btn btn-ghost btn-sm" onClick=${() => approve(false)}>Mark as draft</button>` : html`<button class="btn btn-ghost btn-sm" disabled=${ahead || !(hasMinutes || staffOnly)} onClick=${() => approve(true)}>Mark them approved</button>`}
        ${!approved && ahead ? html`<span class="bd-muted">The meeting hasn’t happened yet.</span>` : !approved && !hasMinutes && !staffOnly ? html`<span class="bd-muted">Once the minutes are in.</span>` : null}
      </${Task}>
      ${fixing || fixed ? html`<${Task} state=${fixing ? 'todo' : 'done'} title=${fixing ? `${plural(fixing, 'correction')} waiting` : `${plural(fixed, 'correction')} made`} sub=${fixing ? `${fixing === 1 ? 'A board member suggested it' : 'Board members suggested them'} on the board page. Decide ${fixing === 1 ? 'it' : 'them'} there.` : 'Suggested on the board page, and on the minutes now.'}>
        ${fixing ? html`<a class="btn btn-ghost btn-sm" href=${`/admin/board/#/meetings/${m.id}`}>Open the board page</a>` : null}
      </${Task}>` : null}
      <${Task} state=${signed ? 'done' : 'todo'} title=${signature && !signature.changed ? `Signed by ${signature.name}` : signed ? 'Signed copy kept' : 'The signed copy (optional)'} sub=${signature?.changed ? 'The minutes changed after they were signed. The secretary is asked to sign them again.' : signed ? html`<a class="link" ...${viewerLink(vf, 0)}>${fileTitle(signed.name)}</a>` : signature ? 'The signed copy is being made.' : data.members.some((p) => p.seat === 'secretary') ? 'The secretary signs them on the board page once they’re approved, or a PDF or a photo can go here.' : 'The secretary’s signed minutes, as a PDF or a photo.'}>
        ${ahead ? html`<span class="bd-muted">After the meeting.</span>` : html`<label class="btn btn-ghost btn-sm bd-pick">${working === 'signed' ? 'Uploading…' : signed ? 'Replace it' : 'Upload it'}<input type="file" class="sr-only" accept=".pdf,.jpg,.jpeg,.png,.heic,.docx" onChange=${(e) => { takeSigned(e.target.files[0]); e.target.value = ''; }} /></label>`}
      </${Task}>
    </ol>
  </div>`;
}

// The motion under an item in the agenda editor (the editor's other styles are board-ui.js's)
const MOTION_CSS = `
.agx-motion { margin: 0.45rem 0 0.25rem 2.95rem; padding: 0.5rem 0.75rem 0.55rem; border-left: 4px solid var(--color-primary, #FFDA24); border-radius: 0 10px 10px 0; background: #FFFAE0; }
.agx-motion__label { display: block; margin: 0 0 0.25rem; font-size: var(--fs-2xs, 0.72rem); font-weight: 750; letter-spacing: 0.07em; text-transform: uppercase; color: #765C00; }
.agx-motion__box { display: block; width: 100%; min-height: 2.4rem; resize: none; background: #fff; font-weight: 600; }
.agx-sec__unnamed { margin: 0.1rem 0 0.4rem 2.95rem; font-size: var(--fs-sm, 0.85rem); color: #765C00; }
.agx-motion__said { margin: 0; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.agx-sec__title.is-fixed, .agx-item__title.is-fixed { cursor: default; overflow-wrap: anywhere; }
.ag-mins.is-fixed { cursor: default; }
.ag-mins.is-fixed b { color: var(--color-text); }
.agx-who-fixed { flex: none; align-self: center; max-width: 45%; overflow-wrap: anywhere; text-align: right; }
.agx-said { margin: 0.4rem 0 0.25rem 2.95rem; font-size: var(--fs-sm, 0.85rem); line-height: 1.55; overflow-wrap: anywhere; }
.agx-said .bm-notes { margin: 0; }
.bm-stay { margin: 0 0 0.85rem; }
.bm-stay__line { align-items: center; flex-wrap: wrap; margin: 0; }
.bm-stay__line > span { flex: 1 1 16rem; min-width: 0; }
.bm-stay__typed { margin-top: 0.5rem; padding: 0.6rem 0.75rem; border: 1px solid var(--color-border, #E4E4DF); border-radius: var(--radius-md, 10px); background: var(--color-bg, #fff); }
.bm-stay__head { margin: 0 0 0.35rem; font-size: var(--fs-sm, 0.85rem); line-height: 1.45; }
.bm-stay__piece { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.15rem 0.6rem; align-items: start; padding: 0.45rem 0; border-top: 1px solid var(--color-border, #E4E4DF); }
.bm-stay__piece .form-label { grid-column: 1 / -1; margin: 0; }
.bm-stay__text { margin: 0; font-size: var(--fs-sm, 0.85rem); white-space: pre-wrap; overflow-wrap: anywhere; }
.bm-stay__done { margin-top: 0.35rem; }
@media (max-width: 640px) { .agx-sec__unnamed { margin-left: 0; } }
@media (max-width: 640px) { .agx-motion { margin-left: 0; } }
@media (max-width: 640px) { .agx-said { margin-left: 0.4rem; } }
`;
if (typeof document !== 'undefined' && !document.getElementById('board-motion-css')) {
  const st = document.createElement('style');
  st.id = 'board-motion-css';
  st.textContent = MOTION_CSS;
  document.head.append(st);
}
