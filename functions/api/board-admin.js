/**
 * /api/board-admin (Cloudflare Access) — the admin's Board area: meetings,
 * documents, members, settings. Only the Board area's admins (Members →
 * Who runs Board; the founders until saved): every other staff sign-in
 * gets 403, and the middleware never lets a board member's sign-in this far.
 *
 * GET                       → { settings, meetings, docs, members, staff, access, numbers, mercury, email }
 * GET ?me=1                 → { admin } for any staff sign-in (the menu shows Board only to admins)
 * GET ?numbers=1            → the live numbers (cash, makeovers, reveals, events) right now
 * GET ?activity=<slug>      → { signIns, events } one board member's sign-ins and what they did on the board page
 *                             (_board-activity.js)
 * GET ?activity=             → { activity, activityBegan } everyone's summary (Members asks when it opens)
 * GET ?live=<id>            → { checkins, votes } for the chair's screen while a meeting is held (_board.js chairLive)
 * POST { action, ... } (JSON):
 *   new-meeting { date }                      a meeting from the template, saved, not shared
 *   import-meeting { meeting }                an old agenda read by parseAgendaText, saved
 *   save-meeting { meeting, base }            base = the updatedAt the editor loaded (409 when someone saved since)
 *   delete-meeting { id }
 *   snapshot { id }                           lock today's numbers into the packet
 *   approve-agenda { id }                     approve the agenda: it goes on the board page and the board is emailed, once
 *   send-packet { id, test }                  email the board, once its agenda is approved (test: only you)
 *   send-minutes { id, test }, remind-rsvp { id, test }   the minutes are up; answer the invite (test: only you)
 *                                             Each of these three goes once (_board.js sendOnce): pressed again while it's
 *                                             going out, or within ten minutes of it, → 409 { sending | already, meeting }
 *   email-all { subject, message, test }      a note to the whole board from your own Gmail (test: only you)
 *   action-done { actionId, done }
 *   save-doc { doc, askAgain, base, fromFile, wordsFrom, newFile }, delete-doc { id }   doc.body: its words, written here (a change is the next wording;
 *                                             409 { conflict } or { ask }: see saveDoc);
 *                                             askAgain: the board signs the new wording again
 *   doc-versions { id }                      a paper's wordings written here, newest first
 *   unsign { docId, slug }                    a member's signature this year taken off (its copy goes with it)
 *   ask-to-sign { slugs?, test? }             an email to each picked member (none: everyone) who hasn't signed this
 *                                             year's papers, asking them to; test: to the admin only
 *   update-file { id, kind, staffOnly, name }, delete-file { id }
 *   save-settings { settings, base }          base = the agenda template's templateAt the editor opened (409 with
 *                                             theirs, { current: { template, at, by } }, when someone saved it since)
 *   sync-access                               try the sign-in list again (offered only when it failed)
 *   sync-group                                bring board@soardcharity.com up to the board now (offered when it failed)
 *   practice                                  today's practice meeting (made the first time): only the admins see it
 *   practice-reset { id }                     start the practice over (a new one; its check-ins and votes go)
 *   read-minutes { id, fileId }               that file read as the meeting's minutes and put on it (_board-minutes.js):
 *                                             → { meeting, approvedPrev, read: { attendance: { here, of }, notes, motions, actions, ai } }
 *                                             another meeting's minutes (their heading or file name) → 409 { error, other:
 *                                             { date, name }, fileId }, nothing put on it; anyway: true reads them in all the same
 *                                             dry: true reads it without saving → { dry, read, would }
 *   undo-minutes { id, fileId }               that read put back, in one step: → { meeting, prev, left: [what stays, in words] }
 * POST multipart (?upload=1): file, ownerType (meeting|doc), ownerId, kind, staffOnly → the stored file
 * POST multipart: file, signFor (a document), slug   the copy a member signed on paper, as their signature this year
 *
 * The audit log gets what changed by name only: its readers are every staff
 * member, and board notes are for the board.
 */

import { notesState } from './_board-notes.js';
import { correctionsForPage } from './_board-corrections.js';
import { signedMinutes } from './_board-minutes-sign.js';
import { sendActionPreview, reminderReach } from './_board-actions.js';
import {
  ensureSchema, getSettings, saveSettings, listMeetings, getMeeting, saveMeeting, createMeeting, importMeeting,
  setActionDone, listDocs, saveDoc, deleteDoc, boardFileProblem, fillDocWords, docVersions, signWithCopy, unsignDoc, putFile, updateFile, deleteFile, fileRowOf, fileLocked, liveNumbers, takeSnapshot, sendPacket,
  memberStatus, roster, packetList, ID, readFileAsAgenda, sendWelcome, askToSign, approveMinutes, remindRsvp, sendMinutesNotice, patchMeeting,
  chairLive, createPractice, getPractice, resetPractice, agendaApprovals, maybeTemplateAgendas, UNSURE_SEND, NOTED_LATER, sentWhen, errorAnswer, nothingDone, NOTHING_SAVED,
} from './_board.js';
import { chairApprove, APPROVE_DOWN } from './_board-asks.js';
import { isBoardAdmin, isStaffEmail, readState, asSend, readDown, PEOPLE_DOWN, PEOPLE_DOWN_SENT, SIGN_IN_DOWN } from './_board-roles.js';
import { sendNotice, noticeName } from './_board-notices.js';
import { accessStatus, syncBoardAccess, accessConfigured } from './_board-access.js';
import { groupStatus, syncBoardGroup } from './_board-group.js';
import { emailAll } from './_board-email-all.js';
import { maybeSyncBoardCalendar, calendarStatus } from './_board-calendar.js';
import { maybeReadBoardMail, mailStatus, mailLog, clientIdOf } from './_board-mail.js';
import { sendInvite, deleteWithInvite, noteInviteChange, projectOf, inviteCheck, maybeCheckInvites } from './_board-invite.js';
import { meetingName } from '../../public/admin/board-shared.js';
import { readMinutesInto, undoMinutes, minutesKindNo, uploadKind, approvedFileNo } from './_board-minutes.js';
import { activityOverview, memberActivity, deviceOf, accessIat } from './_board-activity.js';
import { evidenceOf, exportYear, recordDown } from './_board-sign.js';
import { sendTrouble } from './_broadcast-notify.js';
// Where an admin's change to a signature came from: its evidence, under the admin's own name
const evidence = (context) => evidenceOf(context, { deviceOf, accessIat });
import { shorterFor } from './_board-shorter.js';
import { emailConfigured } from './_broadcast-notify.js';
import { logAudit } from './_audit.js';

/**
 * Who has had the sign-in email and whether one is going out, read in one query so both are from the same moment (a
 * send that's put back can never show as done). `welcomeAt` orders it against other looks. A read that fails is said
 * as that (`welcomeUnread`), with no record and no time, so the page keeps what it last knew: never "nobody has had it"
 * stamped now, which the page would take over the true record (Board QA round 12, Nov 23 2026: Members said "Needs
 * you: Sam and Maria haven't had it" a minute after they had). No board state yet is none
 */
async function welcomeNow(DB) {
  let rows = [];
  try { rows = (await DB.prepare("SELECT key, data, updated_at FROM board_state WHERE key IN ('welcome', 'welcome-sending')").all()).results || []; } catch (err) {
    if (!/no such table/i.test(err?.message || '')) { console.error('[board-admin] the sign-in email’s record', err?.message || err); return { welcomeUnread: true }; }
  }
  const w = rows.find((r) => r.key === 'welcome');
  const c = rows.find((r) => r.key === 'welcome-sending');
  let welcome = {};
  try { welcome = w ? JSON.parse(w.data) || {} : {}; } catch { /* a broken record reads as none */ }
  let sendingTo = [];
  try { sendingTo = c ? JSON.parse(c.data || '{}').to || [] : []; } catch { /* a claim without its list */ }
  const sending = !!c && Date.now() - Date.parse(c.updated_at) < 2 * 60 * 1000;
  return { welcome, welcomeSending: sending, welcomeSendingTo: sending ? sendingTo : [], welcomeAt: Date.now() };
}

/** save-doc's options from what the page sent (its words' source, the wording it started from, its answer to "sign again?") */
const docOptions = (body, me) => ({
  by: me, askAgain: typeof body.askAgain === 'boolean' ? body.askAgain : null, base: Number.isInteger(body.base) ? body.base : null,
  fromFile: body.fromFile === true, wordsFrom: String(body.wordsFrom || '').slice(0, 200),
});
const fail = (error, status = 400, extra = {}) => Response.json({ ok: false, error, ...extra }, { status });
// (a 503 is ours and in words: a read that decides something didn't answer, so nothing was done. Board QA round 9. The
// same answer as the board page's, from one place: ./_board.js errorAnswer. Board QA round 13)
const fromError = (err) => errorAnswer(err, { current: true });
// A page's read of People that didn't answer: the sign-in's words with Try again on the page, never Board with nobody on it
// (Board QA round 10: Members empty, "has no email" on every to-do)
const pageError = (err) => (err?.unread && [PEOPLE_DOWN, PEOPLE_DOWN_SENT].includes(err.message) ? fail(SIGN_IN_DOWN, 503) : fromError(err));

/**
 * What a press reads for its answer once its work is done (the meeting as it is now, the approvals, who has signed): a
 * read that fails leaves it to the page's next look, said in words (`later`) with `reread` for the page to look again
 * by itself, never an error that reads as nothing done (Board QA round 11, Nov 23 2026: the reminder had gone to the
 * board, and the founder was told nothing was sent). → { v } or { reread, later }
 */
const readAfter = (read, later) => read.then((v) => ({ v }), (err) => {
  console.error('[board-admin] reading the answer after a press', err?.message || err);
  return { reread: true, later };
});
const SHOWS_SOON = 'This page shows it in a moment.';
/** A step on a meeting's files that didn't land: nothing of it was done (round 11's words) */
const NOTHING_CHANGED = NOTHING_SAVED;
/**
 * A refusal on one of a meeting's files, with the meeting as the site has it (its approval, its files) for the page to
 * take, so what it offers then is only what's allowed; a read of it that fails leaves it to the page's next look
 * (`reread`). Board QA round 12 (admin 3, Nov 23 2026): "These minutes are approved, so their file stays." was said to a
 * tab that still showed them as draft, and still offered Delete and every other kind. → { meeting } | { reread, later } | {}
 */
async function fileMeetingNow(env, fileId) {
  const row = await readAfter(env.DB.prepare('SELECT owner_type, owner_id FROM board_files WHERE id = ?').bind(fileId).first(), SHOWS_SOON);
  if (row.reread) return answerOf({ row });
  return row.v?.owner_type === 'meeting' ? answerOf({ meeting: await readAfter(getMeeting(env.DB, row.v.owner_id), SHOWS_SOON) }) : {};
}
/**
 * Who runs Board, for a send's replies: read before the send, so People not answering is said as a send's refusal ("so
 * nothing was sent"), as every other read of the press is (Board QA round 11: Email the board said "nothing was changed")
 */
const sendersOf = (DB) => getSettings(DB).then((s) => s.admins, (e) => { throw sendRefusal(e); });
/** A press's answer: what it read, or `reread` with its words when a read failed (readAfter) */
const answerOf = (reads) => {
  const missed = Object.values(reads).find((x) => x.reread);
  return missed ? { reread: true, later: missed.later } : Object.fromEntries(Object.entries(reads).map(([k, x]) => [k, x.v]));
};
/** Answers with words for later put together: each said once, and the page looks again when any asks it to */
const laterOf = (...parts) => {
  const out = Object.assign({}, ...parts);
  const words = [...new Set(parts.map((p) => p?.later).filter(Boolean))];
  if (words.length) out.later = words.join(' ');
  if (parts.some((p) => p?.reread)) out.reread = true;
  return out;
};

async function gate(context) {
  const me = context.data?.userEmail || '';
  // (its tables made on a fresh server: one that doesn't answer is said in words by whoever asked, fromError, never the
  // platform's error page. Board QA round 12, Nov 23 2026)
  await ensureSchema(context.env.DB);
  // (who they are is Members → Who runs Board: the founders until someone is added or taken off. A read of it that
  // failed is said as that, with Try again on the page, never "open only to the staff who run Board": Board QA round 9)
  let admin = false;
  try { admin = isStaffEmail(me) && await isBoardAdmin(context.env.DB, me); } catch (err) { if (err.status === 503) return { me, refused: fail(err.message, 503) }; throw err; }
  if (!admin) return { me, refused: fail('The Board area is open only to the staff who run Board', 403) };
  return { me };
}

/**
 * A send to the board, finished even if the page goes away mid-send (so the emails and their record always match).
 * The same email already going out, or gone a moment ago (_board.js sendOnce), comes back as a 409 with the meeting as
 * it is now, so a second tab sees it was sent. Stopped after its emails may have gone (`went`): said so, never "try
 * again" → the send's result, or that Response
 */
async function once(context, id, send) {
  const going = send();
  context.waitUntil?.(going.catch(() => {}));
  try {
    return await going;
  } catch (err) {
    // (going out from somewhere else, gone a moment ago, or the meeting held since the page read it: with the meeting as it
    // is now, for the page to show)
    if (err.status === 409 && (err.extra?.sending || err.extra?.already || err.extra?.held)) return fail(err.message, 409, { ...err.extra, ...answerOf({ meeting: await readAfter(getMeeting(context.env.DB, id), SHOWS_SOON) }) });
    if (err.went) {
      // (only when the site truly can't tell whether Resend took them: once Resend has answered, the send says what it
      // did, ./_board.js sendOnce. Pressed again, it's asked for under the same number, so nobody gets it twice)
      console.error('[board-admin] send', id, err.message);
      return fail('These emails may have gone: the site stopped partway through sending them. Press it again: Resend sends each one only if it hasn’t already.', 500, { unsure: true, ...answerOf({ meeting: await readAfter(getMeeting(context.env.DB, id), SHOWS_SOON) }) });
    }
    // (People not answering, or anything else before the emails were kept: nothing went, said so)
    throw sendRefusal(err);
  }
}
/**
 * A send refused before anything of it went (a read that didn't answer, its record not kept), in words: People's own,
 * a refusal of its own, or "so nothing was sent", never the site's "something went wrong … then try again" (Board QA
 * round 12)
 */
const WELCOME_UNREAD = 'We couldn’t check who has had the sign-in email just now. Please try again in a moment.';
const SEND_DOWN = 'The site couldn’t get this email ready just now, so nothing was sent. Please try again in a moment.';
const INVITE_DOWN = 'The site couldn’t get the invite ready just now, so nothing was sent. Please try again in a moment.';
const sendRefusal = (err) => {
  const e = asSend(err);
  if (e?.status) return e;
  console.error('[board-admin] send refused', e?.message || e);
  return Object.assign(new Error(SEND_DOWN), { status: 503, unread: true, cause: e });
};
/** A send whose emails went and whose record couldn't be written just now: said with what went (`later`), the page to look again */
const notedLater = (r) => laterOf(
  r?.unrecorded ? { later: NOTED_LATER, reread: true } : {},
  // (a send cut off before its answer was noted, asked for again under its number: said as that, never as a second copy)
  r?.replayed ? { later: `These were the emails pressed ${sentWhen(r.replayed)}: Resend sends each one only once, so nobody gets it twice.` } : {},
);
/** When a page's press says which send it saw last (its Email again, Ask again): an ISO time, or '' */
const seenOf = (body) => (typeof body.seen === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(body.seen) ? body.seen : '');
/**
 * What an admin is told when some of a send's emails didn't go, in words (_broadcast-notify.js sendTrouble: never
 * Resend's code or its raw answer): Resend said no, so they didn't go; or no answer, so they may have gone, and what
 * pressing it again does (`again`)
 */
const AGAIN = {
  // A send to the board goes once (_board.js sendOnce): asked again, Resend sends each one only if it hasn't already
  once: UNSURE_SEND.slice(UNSURE_SEND.indexOf('Press it again')),
  // "Send me the email", and the emails with no idempotency key: nothing stops a second copy
  test: 'Look in your inbox before sending it again.',
  ask: 'Ask whether it came before sending it again.',
};
const sendError = (r, again = AGAIN.once, { one = false } = {}) => sendTrouble(r.errors, { sent: r.sent, failed: r.failed, again, one }).words;
/** A send's answer for the page: its own fields, its trouble said in words (never Resend's raw errors). `one`: one email */
const sendAnswer = (r, again, { one = false } = {}) => (r.failed ? { ...r, errors: [sendError(r, again, { one })], error: sendError(r, again, { one }) } : { ...r, errors: [] });

const audit = (env, me, action, name) => logAudit(env.DB, { userEmail: me, action, entityType: 'board', entitySlug: 'board', entityName: name, gitStatus: 'ok' }).catch(() => {});

export async function onRequestGet(context) {
  const { env } = context;
  const q = new URL(context.request.url).searchParams;
  try {
    if (q.has('me')) {
      const me = context.data?.userEmail || '';
      await ensureSchema(env.DB);
      // (couldn't check: 503, so the menu keeps what it showed, never Board taken away for a moment the database didn't answer)
      try { return Response.json({ ok: true, admin: await isBoardAdmin(env.DB, me) }); } catch (err) { if (err.status === 503) return fail(err.message, 503); throw err; }
    }
    const { me, refused } = await gate(context);
    if (refused) return refused;
    if (q.has('numbers')) return Response.json({ ok: true, numbers: await liveNumbers(env) });
    // The practice meeting as the site has it now, read again with Board's data so its editor follows renames (round 9)
    if (q.has('practice')) {
      const pm = ID.test(String(q.get('practice') || '')) ? await getPractice(env.DB, String(q.get('practice'))) : null;
      return pm ? Response.json({ ok: true, meeting: pm }, { headers: { 'Cache-Control': 'no-store' } }) : fail('That practice meeting is gone', 404);
    }
    // A paper's signing record for a year, for an auditor: one ZIP (./_board-sign.js exportYear)
    if (q.has('record')) {
      const docId = String(q.get('record') || '');
      if (!ID.test(docId)) return Response.json({ ok: false, error: 'Which paper?' }, { status: 400 });
      await audit(env, me, 'exported', `Board signing record downloaded: ${docId} ${q.get('year') || ''}`.trim());
      // (awaited, so a read that fails is answered in words below, never a request that just breaks)
      return await exportYear(env, docId, Number(q.get('year')) || null, { waitUntil: (p) => context.waitUntil?.(p) });
    }
    // Papers' PDFs read for the board page's search, a few each time an admin comes by
    context.waitUntil?.(fillDocWords(env));
    // Board access's quick look while a sign-in email is going out (and as the panel opens)
    // (its read failing: said as that, and the panel keeps what it showed)
    if (q.has('welcome')) {
      const w = await welcomeNow(env.DB);
      return w.welcomeUnread ? fail(WELCOME_UNREAD, 503, { unread: true }) : Response.json({ ok: true, ...w }, { headers: { 'Cache-Control': 'no-store' } });
    }
    // One board member's sign-ins and what they did on the board page (Members → their row)
    if (q.has('activity') && !q.get('activity')) {
      const activity = await activityOverview(env.DB);
      return Response.json({ ok: true, activity, activityBegan: activity.began || null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (q.has('activity')) {
      const slug = String(q.get('activity') || '');
      if (!(await memberStatus(env.DB)).some((p) => p.slug === slug)) return Response.json({ ok: false, error: 'That isn’t a board member now' }, { status: 404 });
      return Response.json({ ok: true, ...(await memberActivity(env.DB, slug)) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (q.has('live')) return Response.json({ ok: true, ...(await chairLive(env, q.get('live'))) }, { headers: { 'Cache-Control': 'no-store' } });
    // The invites' answers read again when the last look is over 10 minutes old (at most 6 seconds; the rest finishes after).
    // ?quick (a send's question, the tab coming back: ./board-admin.js fresh): never waited on, it shows on the next read
    const looking = maybeSyncBoardCalendar(env, { minAgeMs: 10 * 60 * 1000 });
    context.waitUntil?.(looking);
    if (!q.has('quick')) await Promise.race([looking, new Promise((r) => setTimeout(r, 6000))]);
    // Board mail is slower (files to read): it runs after the answer, and shows on the next open
    context.waitUntil?.(maybeReadBoardMail(env, { minAgeMs: 10 * 60 * 1000 }));
    // The invite check, when it hasn't passed: a change made in Google shows on the next open
    context.waitUntil?.(maybeCheckInvites(env, { retryMs: 10 * 60 * 1000 }));
    const [settings, meetings, docs, members, people, access, numbers, recipients, calendar] = await Promise.all([
      getSettings(env.DB), listMeetings(env.DB), listDocs(env.DB), memberStatus(env.DB), roster(env.DB),
      accessStatus(env), liveNumbers(env), packetList(env.DB), calendarStatus(env.DB),
    ]);
    const [mail, mailRecent, welcome, check, group] = await Promise.all([mailStatus(env.DB), mailLog(env.DB), readState(env.DB, 'welcome'), inviteCheck(env.DB), groupStatus(env)]);
    return Response.json({
      ok: true, me, settings, meetings, docs, members, access, numbers, calendar, mail, mailRecent, welcome, ...(await notesState(env.DB).then((n) => ({ notesWaiting: n.waiting, minutesTypedBy: n.typedBy }))),
      // Whose approval each agenda has: nothing reaches the board before it (_board.js holdUntilApproved)
      approvals: await agendaApprovals(env.DB),
      // Corrections suggested to minutes not approved yet, and who signed the ones that were
      corrections: await correctionsForPage(env.DB, { admin: true, adminEmail: me }, meetings),
      minutesSigned: await signedMinutes(env.DB, meetings),
      // Who the to-do reminders would write to now, and why the other open to-dos get none (_board-actions.js)
      reminders: await reminderReach(env.DB, meetings),
      // board@soardcharity.com following the board (_board-group.js)
      group,
      // Who has had the sign-in email and whether one is going out right now (its claim, _board.js sendWelcome), from one
      // moment: Board access says so instead of offering another
      ...(await welcomeNow(env.DB)),
      // For the one-time Google setup: the service account's client ID and its Cloud project (neither is secret),
      // and the heartbeat's check that the invite's Calendar, Meet and attendance work
      google: env.GOOGLE_CALENDAR_KEY ? { clientId: clientIdOf(env), project: projectOf(env), check } : null,
      people: { board: people.board, staff: people.staff },
      // Mercury answers only through SOARD's relay (_mercury.js), so the balance needs both keys
      setup: { calendar: Boolean(env.GOOGLE_CALENDAR_KEY), mercury: Boolean(String(env.MERCURY_API_TOKEN || '').trim() && String(env.MERCURY_RELAY_KEY || '').trim()), email: emailConfigured(env), jobtread: Boolean(env.JOBTREAD_GRANT_KEY) },
      packetTo: recipients.length,
    });
  } catch (err) {
    // (a signing record for an auditor is never one missing people: refused in People's words, as any other press is;
    // anything else that stopped it is said as nothing downloaded, in words: Board QA round 11)
    return q.has('record') ? fromError(err.status ? err : recordDown(err)) : pageError(err);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  // (who it is, checked inside the answer's own catch: Board's tables not set up on a fresh server is said in words, never
  // the platform's error page. Board QA round 12)
  let me;
  try {
    const g = await gate(context);
    if (g.refused) return g.refused;
    me = g.me;
  } catch (err) { return fromError(err); }
  try {
    if ((request.headers.get('Content-Type') || '').includes('multipart/form-data')) {
      const form = await request.formData();
      // A paper a member signed and handed in: their signature for this year
      if (form.get('signFor')) {
        const docId = String(form.get('signFor'));
        if (!ID.test(docId)) return fail('Which document?');
        const original = form.get('original');
        // (one they gave themselves, replaced by a copy SOARD added: they're told, as a signature taken off is. Its notice
        // written down as due in the copy's own write, so a send that doesn't go is sent by the signing look, and the
        // signature is never kept without it: ./_board-notices.js, Board QA round 13)
        const signed = await signWithCopy(env, docId, form.get('file'), { slug: String(form.get('slug') || ''), by: me, replace: form.get('replace') === '1', evidence: evidence(context), original: original && typeof original.arrayBuffer === 'function' ? original : null, tell: true });
        await audit(env, me, 'updated', `Board signature added for ${signed.name}`);
        const owed = signed.owed ? await sendNotice(env, signed.owed, { waitUntil: (p) => context.waitUntil?.(p), who: noticeName(signed.name) }).catch((e) => { console.error('[board-admin] the notice', e?.message || e); return { later: 'The email to them goes by itself in a few minutes.' }; }) : {};
        return Response.json({ ok: true, signed, doc: (await listDocs(env.DB)).find((d) => d.id === docId), ...(owed.later ? { later: owed.later } : {}) });
      }
      // A paper saved with its new file, in one: the file checked first, so nothing changes (no new version, nobody
      // asked to sign again) unless it can go up; a new paper whose file then didn't go isn't left without it
      if (form.get('saveDoc')) {
        let req = {};
        try { req = JSON.parse(String(form.get('saveDoc'))); } catch { return fail('Expected the paper with its file'); }
        const upload = form.get('file');
        const why = await boardFileProblem(upload);
        if (why) return fail(why, 415);
        const d = await saveDoc(env.DB, req.doc || {}, { ...docOptions(req, me), newFile: String(upload.name || 'file').slice(0, 200) });
        let put;
        try { put = await putFile(env, { ownerType: 'doc', ownerId: d.id, file: upload, by: me }); } catch (err) { if (!req.doc?.id) await deleteDoc(env, d.id); throw err; }
        // (a new version that's this file: which file it was, for what a signature on it signed)
        // (a paper's first file, version 0, gets its row too: what a signature on it signed is never a later file)
        if (!d.body) await env.DB.prepare("INSERT OR IGNORE INTO board_doc_versions (doc_id, version, body, at, by, note) VALUES (?, ?, '', ?, ?, ?)").bind(d.id, d.version, new Date().toISOString(), me, `Its file: ${String(upload.name || 'file').slice(0, 200)}`).run();
        await env.DB.prepare("UPDATE board_doc_versions SET file_id = ? WHERE doc_id = ? AND version = ? AND (body IS NULL OR body = '')").bind(put.id, d.id, d.version).run();
        let doc = (await listDocs(env.DB)).find((x) => x.id === d.id);
        // Its words read from this file: where they came from
        if (req.wordsFromNew) doc = await saveDoc(env.DB, { ...doc, body: undefined, wordsFile: put.id }, { by: me });
        await audit(env, me, 'updated', `Board document saved with a new file: ${doc.title}`);
        return Response.json({ ok: true, doc });
      }
      // A meeting's file only: a paper's file goes with its save (above), a signed copy with its signature, and a
      // signing record is the site's own
      if (String(form.get('ownerType') || '') !== 'meeting') return fail('Add a paper’s file from Documents, and a signed copy from Who’s signed', 400);
      // (sent as the minutes of a meeting whose minutes are approved and in Board: kept as an ordinary file, and said;
      // for one of an approved meeting's items (`forItem`, an item's upload): never its own minutes. ./_board-minutes.js
      // uploadKind. Board QA rounds 10 and 11)
      const unsaid = (err) => (err?.status || err?.setup ? err : readDown(NOTHING_CHANGED, err));
      const { kind, asFile } = await uploadKind(env, { meetingId: String(form.get('ownerId') || ''), kind: String(form.get('kind') || 'other'), forItem: form.get('forItem') === 'true' }).catch((err) => { throw unsaid(err); });
      // (`fileId`: the page's own id for the file it chose, made once: sent again after an answer lost on the way back,
      // it's the file already kept, never a second copy. Nothing kept until its row is in: a read or the write that
      // didn't answer is said in words. Board QA round 13)
      const file = await putFile(env, {
        ownerType: 'meeting', ownerId: String(form.get('ownerId') || ''), file: form.get('file'),
        kind, staffOnly: form.get('staffOnly') === 'true', by: me, fileId: String(form.get('fileId') || ''),
      }).catch((err) => { throw unsaid(err); });
      if (!file.again) await audit(env, me, 'created', `Board file added: ${file.name}`);
      // (kept as an ordinary file because the minutes are approved: with the meeting as the site has it, for a tab that
      // still shows them as draft. Board QA round 12)
      return Response.json({ ok: true, file, ...(asFile ? { asFile, ...(await fileMeetingNow(env, file.id)) } : {}) });
    }
    let body = {};
    try { body = await request.json(); } catch { return fail('Expected JSON'); }
    const id = String(body.id || '');
    const needId = () => { if (!ID.test(id)) throw Object.assign(new Error('Which one?'), { status: 400 }); };
    switch (body.action) {
      case 'new-meeting': {
        // One meeting a day: one already on that day opens instead, so the board never gets two invites for it
        const same = (await listMeetings(env.DB)).find((x) => x.date === body.date && !x.notBoard && !x.practice);
        if (same) return Response.json({ ok: true, meeting: same, existing: true });
        const m = await createMeeting(env, { date: body.date, by: me });
        await audit(env, me, 'created', `Board meeting added: ${meetingName(m)}`);
        return Response.json({ ok: true, meeting: m });
      }
      case 'import-meeting': {
        const m = await importMeeting(env, body.meeting || {}, { by: me });
        await audit(env, me, 'created', `Board meeting brought in from an old agenda: ${meetingName(m)}`);
        return Response.json({ ok: true, meeting: m });
      }
      case 'save-meeting': {
        // What only the server sets never comes from the editor (where the agenda came from, who joined by Meet)
        const { agendaFrom, fromMeet, ...mine } = body.meeting || {};
        const base = typeof body.base === 'string' ? body.base : null;
        // (a person's save, with its base or without one: the same rules either way, never a new meeting. A copy saved
        // meanwhile is told to merge first; then what it changes is judged: only an approved agenda goes on the board
        // page, and minutes are marked approved only when there are some, each refused by name: _board.js saveMeeting)
        // (typed minutes corrected here, or marked approved: their Word file says the same, in the save's own one write, or
        // nothing is saved and it says so in words: _board.js saveMeeting, `env` for the file store. The database failing
        // changed nothing and says so in words, a 503 the page goes on trying after, never "Reload the page" with a change
        // not saved. Board QA round 13)
        const m = await saveMeeting(env.DB, mine, { by: me, base, edit: true, env }).catch(nothingDone());
        // A practice meeting is the admins' alone: nothing for the audit log
        if (m.practice) return Response.json({ ok: true, meeting: m });
        await audit(env, me, 'updated', `Board meeting saved: ${meetingName(m)}`);
        // An invite already out follows a new place, once it has settled (./_board-invite.js)
        if (m.invite) await noteInviteChange(env, m);
        return Response.json({ ok: true, meeting: m });
      }
      case 'delete-meeting': {
        needId();
        // Its invite comes off the board's calendars first (Google tells them): should Google refuse, nothing is deleted.
        // An invite pressed at the same moment never outlives it (_board-invite.js deleteWithInvite)
        const { meeting: m, cancelled } = await deleteWithInvite(env, id);
        await audit(env, me, 'deleted', `Board meeting deleted: ${m ? meetingName(m) : id}${cancelled ? ', its calendar invite cancelled' : ''}`);
        return Response.json({ ok: true, cancelled });
      }
      case 'keep-agenda': {
        // The draft agenda, as it is, becomes the meeting's (an emailed agenda no longer replaces it)
        needId();
        const m = await patchMeeting(env.DB, id, (cur) => ({ ...cur, agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() } }));
        if (!m) throw Object.assign(new Error('That meeting is gone'), { status: 404 });
        return Response.json({ ok: true, meeting: m });
      }
      case 'snapshot': {
        needId();
        return Response.json({ ok: true, meeting: await takeSnapshot(env, id, { by: me }) });
      }
      case 'approve-agenda': {
        // Board's own way to approve, the same as on the chair's review: it's what sends the agenda to the board
        needId();
        // (anything that stops it before the approval is written, or the approval's own write: nothing was changed, said
        // so in words. Once it's written, the approval answers with what it did. Board QA round 12)
        const r = await chairApprove(env, { meetingId: id }, { admin: true, adminEmail: me }, { always: true }).catch((e) => {
          if (e?.status || e?.setup) throw e;
          console.error('[board-admin] approve', e?.message || e);
          throw Object.assign(new Error(APPROVE_DOWN), { status: 503, unread: true });
        });
        // (approved: what it reads for its answer never says it wasn't. Board QA round 11)
        const [m, approvals] = await Promise.all([readAfter(getMeeting(env.DB, id), SHOWS_SOON), readAfter(agendaApprovals(env.DB), SHOWS_SOON)]);
        if (!r.already) await audit(env, me, 'updated', `Board agenda approved: ${m.v ? meetingName(m.v) : id}`);
        return Response.json({ ok: true, ...laterOf(r, answerOf({ meeting: m, approvals })) });
      }
      case 'send-packet': {
        needId();
        const admins = await sendersOf(env.DB);
        const r = await once(context, id, () => sendPacket(env, id, { by: me, to: body.test ? [me] : null, replyTo: admins, seen: seenOf(body) }));
        if (r instanceof Response) return r;
        if (!body.test && r.sent) await audit(env, me, 'updated', `Board emailed the link to the agenda and documents (${r.sent} board members)`);
        return Response.json({ ok: r.failed === 0, ...sendAnswer(r, body.test ? AGAIN.test : AGAIN.once), ...laterOf(answerOf({ meeting: await readAfter(getMeeting(env.DB, id), SHOWS_SOON) }), notedLater(r)) });
      }
      case 'action-done':
        return Response.json({ ok: true, ...(await setActionDone(env.DB, String(body.actionId || ''), !!body.done, { by: me })) });
      // "Send me the email": what a reminder looks like (_board-actions.js)
      case 'action-remind-preview': {
        const r = await sendActionPreview(env, me).catch((e) => { throw asSend(e); });
        if (r.none) return Response.json({ ok: false, ...r });
        return Response.json({ ok: r.sent > 0, ...sendAnswer(r, AGAIN.test, { one: true }) });
      }
      case 'save-doc': {
        const d = await saveDoc(env.DB, body.doc || {}, docOptions(body, me));
        await audit(env, me, 'updated', `Board document saved: ${d.title}`);
        return Response.json({ ok: true, doc: d });
      }
      case 'delete-doc': {
        needId();
        await deleteDoc(env, id);
        await audit(env, me, 'deleted', 'Board document deleted');
        return Response.json({ ok: true });
      }
      case 'doc-versions':
        needId();
        return Response.json({ ok: true, versions: await docVersions(env.DB, id) });
      case 'unsign': {
        const docId = String(body.docId || '');
        if (!ID.test(docId)) return fail('Which document?');
        const reason = String(body.reason || '').slice(0, 500);
        // A signature they gave themselves (typed, drawn, their own copy) taken off: they're told (a copy filed under
        // the wrong member isn't theirs to hear about). Its notice written down as due in the same write as taking it
        // off (./_board.js unsignDoc), so a read that fails or a send that doesn't go is sent by the signing look, and
        // they're said to be told later, never told now (Board QA rounds 10 and 13: ./_board-notices.js)
        const off = await unsignDoc(env, docId, String(body.slug || ''), undefined, { by: me, evidence: evidence(context), reason, tell: true });
        if (!off) return fail('That signature is gone', 404);
        await audit(env, me, 'deleted', 'Board signature taken off');
        const owed = off.owed ? await sendNotice(env, off.owed, { waitUntil: (p) => context.waitUntil?.(p), who: noticeName(off.row.name) }).catch((e) => { console.error('[board-admin] the notice', e?.message || e); return { later: 'The email to them goes by itself in a few minutes.' }; }) : {};
        return Response.json({ ok: true, doc: (await listDocs(env.DB)).find((d) => d.id === docId), ...(owed.later ? { later: owed.later } : {}) });
      }
      case 'update-file': {
        needId();
        // (filed under Minutes on a meeting whose minutes are approved and in Board: refused, nothing changed. Round 10.
        // The approved minutes' own file filed under anything else: refused alike, it stays theirs. Round 11)
        const no = body.kind === undefined ? '' : body.kind === 'minutes' ? await minutesKindNo(env, { fileId: id }) : await approvedFileNo(env, id, { kind: String(body.kind) });
        if (no) return fail(no, 409, await fileMeetingNow(env, id));
        return Response.json({ ok: true, file: await updateFile(env.DB, id, { kind: body.kind, staffOnly: body.staffOnly, name: body.name }) });
      }
      case 'delete-file': {
        needId();
        // (a signed copy, a record, or a signed paper's file is SOARD's record: kept; and approved minutes' own file stays
        // theirs while they're approved, ./_board-minutes.js approvedFileNo. Round 11)
        // (its row and its places on the agenda in one write, its bytes after: ./_board.js deleteFile. Nothing is changed
        // until that lands: a read before it, or the write, that didn't answer says so. Board QA round 12)
        const unsaid = (err) => (err?.status ? err : readDown(NOTHING_CHANGED, err));
        const locked = await fileLocked(env.DB, id).catch((err) => { throw unsaid(err); });
        if (locked) return fail(locked, 409, { kept: true, ...(await fileMeetingNow(env, id)) });
        const stays = await approvedFileNo(env, id).catch((err) => { throw unsaid(err); });
        if (stays) return fail(stays, 409, { kept: true, ...(await fileMeetingNow(env, id)) });
        const row = await fileRowOf(env.DB, id).catch((err) => { throw unsaid(err); });
        await deleteFile(env, id).catch((err) => { throw unsaid(err); });
        await audit(env, me, 'deleted', 'Board file deleted');
        // (with the meeting as the site has it now, off its items, for the page to take)
        return Response.json({ ok: true, ...(row?.owner_type === 'meeting' ? answerOf({ meeting: await readAfter(getMeeting(env.DB, row.owner_id), SHOWS_SOON) }) : {}) });
      }
      case 'save-settings': {
        // base: the templateAt the agenda template's editor opened (409 with theirs when someone saved it since)
        const s = await saveSettings(env.DB, body.settings || {}, me, { base: typeof body.base === 'string' ? body.base : null });
        await audit(env, me, 'updated', 'Board settings saved');
        // The template changed: the meetings still on it follow now, not at the next heartbeat
        const followed = Array.isArray(body.settings?.template) ? (await maybeTemplateAgendas(env, { force: true })).length : 0;
        return Response.json({ ok: true, settings: s, followed });
      }
      case 'read-file': {
        // The minutes (or an old agenda) uploaded to a meeting, read for the admin to look over before it fills the meeting
        needId();
        const parsed = await readFileAsAgenda(env, id);
        return parsed ? Response.json({ ok: true, parsed }) : fail('Couldn’t read an agenda in that file. Is it the minutes, as a PDF or Word file?', 422);
      }
      case 'read-minutes': {
        // The minutes, uploaded after the meeting: who was there, the notes under each item, the motions and the
        // action items read in by themselves (./_board-minutes.js), the last meeting's minutes approved when they say so
        needId();
        let r;
        try {
          r = await readMinutesInto(env, id, String(body.fileId || ''), { by: me, dry: body.dry === true, anyway: body.anyway === true });
        } catch (err) {
          // Another meeting's minutes, by their heading or file name: say whose, and read them in only when asked again with anyway
          if (err.status === 409 && err.other) return fail(err.message, 409, { other: err.other, fileId: err.fileId });
          throw err;
        }
        if (!r.dry) await audit(env, me, 'updated', `Board minutes read in: ${meetingName(r.meeting)}`);
        return Response.json({ ok: true, ...r });
      }
      case 'undo-minutes': {
        // Undo, right after reading the minutes in: the meeting as the site kept it at the read, the file off, and the
        // last meeting's minutes back to draft if the read approved them (./_board-minutes.js undoMinutes)
        needId();
        const r = await undoMinutes(env, id, String(body.fileId || ''), { by: me });
        await audit(env, me, 'updated', `Board minutes read in, then undone: ${meetingName(r.meeting)}`);
        return Response.json({ ok: true, ...r });
      }
      case 'send-invite': {
        needId();
        let m;
        try {
          m = await sendInvite(env, id, { by: me, press: true });
        } catch (err) {
          // Already out, with nothing to change (a second tab that never heard it went), or going out right now from
          // another tab or from Board by itself (one send at a time): said, with the meeting as it is now
          if (err.status === 409 && (err.extra?.already || err.extra?.sending)) return fail(err.message, 409, { ...err.extra, ...answerOf({ meeting: await readAfter(getMeeting(env.DB, id), SHOWS_SOON) }) });
          // Google has it, and the site couldn't note it on the meeting just now: said as sent, the page to look again
          // (never "something went wrong … then try again". Board QA round 12)
          if (err.went) {
            await audit(env, me, 'updated', `Board meeting invite sent or updated: ${id}`);
            return Response.json({ ok: true, sent: true, later: err.message, reread: true });
          }
          // (anything else stopped it before Google had it: nothing was sent, said so)
          if (!err.status) { console.error('[board-admin] invite refused', err?.message || err); throw Object.assign(new Error(INVITE_DOWN), { status: 503, unread: true }); }
          throw err;
        }
        await audit(env, me, 'updated', `Board meeting invite sent or updated: ${meetingName(m)}`);
        return Response.json({ ok: true, meeting: m });
      }
      case 'approve-minutes': {
        needId();
        const m = await approveMinutes(env, id, { on: body.on, by: me, press: true });
        await audit(env, me, 'updated', `Board minutes approved: ${meetingName(m)}`);
        return Response.json({ ok: true, meeting: m });
      }
      case 'remind-rsvp': {
        needId();
        const admins = await sendersOf(env.DB);
        const r = await once(context, id, () => remindRsvp(env, id, { to: body.test ? [me] : null, replyTo: admins, by: me, seen: seenOf(body) }));
        if (r instanceof Response) return r;
        // (gone, and the meeting not read back: who was asked shows on the page's next look. Board QA round 11)
        return Response.json({ ok: r.failed === 0, ...sendAnswer(r, body.test ? AGAIN.test : AGAIN.once), ...laterOf(r.reread ? { reread: true, later: 'Who was asked shows here in a moment.' } : {}, notedLater(r)) });
      }
      case 'send-minutes': {
        needId();
        const admins = await sendersOf(env.DB);
        const r = await once(context, id, () => sendMinutesNotice(env, id, { to: body.test ? [me] : null, replyTo: admins, by: me, seen: seenOf(body) }));
        if (r instanceof Response) return r;
        if (!body.test && r.sent) await audit(env, me, 'updated', `Board told the minutes are up (${r.sent})`);
        return Response.json({ ok: r.failed === 0, ...sendAnswer(r, body.test ? AGAIN.test : AGAIN.once), ...laterOf(answerOf({ meeting: await readAfter(getMeeting(env.DB, id), SHOWS_SOON) }), notedLater(r)) });
      }
      case 'ask-to-sign': {
        // An email asking each board member picked (none: the whole board) who hasn't signed this year's papers to;
        // `test`: to the admin asking only. Their codes have to come: a member added minutes ago is put on Access's list first
        const admins = await sendersOf(env.DB);
        if (!body.test && accessConfigured(env)) {
          // (the sign-in list's own record not answering: nothing was sent, said so)
          let st = await accessStatus(env).catch((e) => { throw sendRefusal(e); });
          if (!st.current || !st.ok) st = await syncBoardAccess(env).catch((e) => { throw sendRefusal(e); });
          if (!st.ok) return Response.json({ ok: false, sent: 0, error: st.unread ? PEOPLE_DOWN_SENT : `Cloudflare doesn’t have the board’s addresses yet (${String(st.error || 'it didn’t answer').replace(/^Cloudflare \w+ \S+: /, '')}), so their sign-in codes wouldn’t come. Try again in a minute.` }, { status: 503 });
          if (!st.attached) return Response.json({ ok: false, sent: 0, error: 'The board’s sign-in list isn’t on the admin app in Cloudflare (Board access), so their sign-in codes wouldn’t come.' }, { status: 409 });
        }
        let r;
        try {
          const going = askToSign(env, { slugs: Array.isArray(body.slugs) ? body.slugs.map(String) : null, by: me, replyTo: admins, to: body.test ? [me] : null });
          // Finished even if the page goes away mid-send, so the emails and the record always match
          context.waitUntil?.(going.catch(() => {}));
          r = await going;
        } catch (e) {
          // (the emails went and their record didn't: said as that, with how many went. Board QA round 11)
          if (e?.went && e.extra?.unrecorded) return Response.json({ ok: false, ...e.extra, error: e.message }, { status: 500 });
          // (anything else stopped it before its emails went: nothing was sent, said so)
          const err = sendRefusal(e);
          return Response.json({ ok: false, sent: 0, error: err.message, ...(err.extra || {}) }, { status: err.status });
        }
        if (!body.test && r.sent) await audit(env, me, 'updated', `Board asked ${r.sent === 1 ? 'a board member' : `${r.sent} board members`} by email to sign this year’s papers`);
        // (asked: Members read back for the answer, or on the page's next look when that read fails. Board QA round 11)
        return Response.json({ ok: r.failed === 0, ...sendAnswer(r, body.test ? AGAIN.test : AGAIN.ask), ...(body.test ? {} : answerOf({ members: await readAfter(memberStatus(env.DB), 'Members shows who was asked in a moment.') })) });
      }
      case 'email-all': {
        let r;
        try {
          const going = emailAll(env, { me, subject: body.subject, message: body.message, test: body.test === true });
          // Finished even if the page goes away mid-send, so the email and the record always match
          context.waitUntil?.(going.catch(() => {}));
          r = await going;
        } catch (err) {
          // (said in words: Gmail's own answer that can't be told is ./_board-email-all.js's 503, "may have gone"; the
          // database failing before anything went is "so nothing was sent"; a program's own error, Something went wrong.
          // Never "the connection dropped" for a send that never began. Board QA round 13)
          if (err.status) return Response.json({ ok: false, error: err.message }, { status: err.status });
          console.error('email-all', err);
          return fromError(err);
        }
        if (!r.test && !r.already) await audit(env, me, 'updated', `Board emailed (${r.sent}): ${String(body.subject).replace(/\s+/g, ' ').trim().slice(0, 120)}`);
        return Response.json({ ok: true, ...r });
      }
      case 'send-welcome': {
        const admins = await sendersOf(env.DB);
        // Only once their codes will come: a member added minutes ago is put on Access's list now (not at the next
        // heartbeat), and the list has to be on the admin app. Checked inside the send's claim, so the page shows it going out
        const check = body.test || !accessConfigured(env) ? null : async () => {
          let st = await accessStatus(env).catch((e) => { throw sendRefusal(e); });
          if (!st.current || !st.ok) st = await syncBoardAccess(env).catch((e) => { throw sendRefusal(e); });
          // (who signs in couldn't be read: Cloudflare was asked nothing, and nobody is sent an email whose sign-in may not know them)
          if (!st.ok) throw Object.assign(new Error(st.unread ? PEOPLE_DOWN_SENT : `Cloudflare doesn’t have the board’s addresses yet (${String(st.error || 'it didn’t answer').replace(/^Cloudflare \w+ \S+: /, '')}), so their codes wouldn’t come. Try again in a minute.`), { status: 503 });
          if (!st.attached) throw Object.assign(new Error('The board’s sign-in list isn’t on the admin app in Cloudflare (Board access), so their codes wouldn’t come.'), { status: 409 });
        };
        let r;
        try {
          const going = sendWelcome(env, { to: body.test ? [me] : null, slugs: Array.isArray(body.slugs) ? body.slugs.map(String) : null, due: body.due === true, again: body.again === true, check, replyTo: admins, by: me, click: typeof body.click === 'string' ? body.click : '' });
          // Finished even if the page goes away mid-send, so the emails and the record always match
          context.waitUntil?.(going.catch(() => {}));
          r = await going;
        } catch (e) {
          // (stopped before its emails went: nothing was sent, said so. Once they've gone, the send answers with what
          // went, ./_board.js sendWelcomeNow)
          const err = sendRefusal(e);
          return Response.json({ ok: false, sent: 0, error: err.message, ...(err.extra || {}) }, { status: err.status });
        }
        if (!body.test && r.sent) await audit(env, me, 'updated', `Board page sign-in email sent to ${r.sent} board members`);
        // Who has it now, with the answer: the page shows it even if its next look is dropped (a read that fails is the
        // page's to make again, never "nobody has it": Board QA round 12)
        const now = body.test ? {} : await welcomeNow(env.DB);
        return Response.json({ ok: r.failed === 0, ...sendAnswer(r, body.test ? AGAIN.test : AGAIN.ask), ...laterOf(now.welcomeUnread ? { reread: true, later: 'Board access shows who has it in a moment.' } : now, notedLater(r)) });
      }
      case 'practice':
        return Response.json({ ok: true, meeting: await createPractice(env, { by: me }) });
      case 'practice-reset':
        needId();
        return Response.json({ ok: true, meeting: await resetPractice(env, id, { by: me }) });
      case 'sync-access':
        return Response.json({ ok: true, access: { ...(await syncBoardAccess(env)), ...(await accessStatus(env)) } });
      // A shorter version of a report being written in the agenda (nothing saved; the item may not be saved yet)
      case 'report-shorter':
        return Response.json(await shorterFor(env, { id, itemId: String(body.itemId || ''), text: body.text, title: String(body.title || '') }, { admin: true, adminEmail: me }));
      case 'sync-group':
        await syncBoardGroup(env);
        return Response.json({ ok: true, group: await groupStatus(env) });
      default:
        return fail('Unknown action');
    }
  } catch (err) {
    return fromError(err);
  }
}
