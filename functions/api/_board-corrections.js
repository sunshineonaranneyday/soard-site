/**
 * Corrections to the minutes, suggested on the board page
 * ===========================================================================
 * Peter, Nov 6 2026: "yes i want this best in class". The board reads the draft
 * before it votes on it, and until now a correction meant replying to an email.
 *
 * A member suggests new words under the item they're about (or marks who was
 * there, or says anything else), and the whole board sees it, so nobody suggests
 * it twice. The secretary or a founder makes it in one press, or keeps the minutes
 * as they are and may say why. Nobody retypes anything, and the page says it was
 * corrected and who suggested it. Nothing here changes the minutes until someone
 * decides.
 *
 * A correction writes one box and nothing else, and never runs a send: a send goes over
 * the whole meeting, so it can wake words held back from an earlier send, change another
 * meeting's approval, or carry what's typed and unsent. It goes on the meeting, its box in
 * the notes says the same, what the last send kept records it just as a send would have,
 * and the Word file is rewritten from what the meeting now says. One at a time with any
 * send (the same claim), and safe to press again if it stopped partway.
 *
 * board_minutes_corrections, one row a correction:
 *   target   n:<item or part id> | r:<person's key> | general
 *   kind     words (`words`: all the new words) | roll (`words`: present, remote, excused, absent) | other (anything else)
 *   was      what it said when suggested: changed since, it's not made over the change
 *   state    waiting → made | declined | withdrawn (making: claimed, for the moment it's being made)
 */

import { getMeeting, listMeetings, patchTogether, roster, ensureSchema, ID, SITE, nothingDone, landedOr, NOTHING_SAVED } from './_board.js';
import { claimSending, releaseSending, boxPath, withBox, anythingIn, keptFile, mergePatch, stageMinutesFile, AGAIN } from './_board-notes.js';
import { minutesIn, meetingName, uid } from '../../public/admin/board-shared.js';
import { noteLines } from '../../public/admin/board-minutes-template.js';
import { limit } from './_rate-limit.js';
import { noticeName, dueRow, dueStmt, sendNotice, laterWords } from './_board-notices.js';
import { readState, readDown } from './_board-roles.js';
import { emailConfigured } from './_broadcast-notify.js';
import { emailShell, button, esc } from './_email-shell.js';

const ROLL = ['present', 'remote', 'excused', 'absent'];
const MAX_WORDS = 20000;
const MAKING_MS = 2 * 60 * 1000;
const HOW = { present: 'here', remote: 'on video', excused: 'excused', absent: 'not there' };

const no = (message, status, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });
const iso = (t) => new Date(t).toISOString();
const parse = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const cleanWords = (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, MAX_WORDS);
const sameNote = (a, b) => noteLines(a).join('\n') === noteLines(b).join('\n');
/** Who decides: the secretary's seat, or one of Board's admins, the same people who keep the notes */
export const canDecide = (w) => !!w?.admin || w?.member?.seat === 'secretary';

/** What a target is on this meeting now → { kind, where, now, secret, person } | null (it isn't there any more) */
export function targetOf(m, target) {
  const t = String(target || '');
  if (t === 'general') return { kind: 'other', where: '', now: '', secret: false };
  if (t.startsWith('r:')) {
    // (the board and staff: a guest is a line of the notes, not someone on the roll)
    const p = (m.attendance || []).find((x) => x.key === t.slice(2) && x.kind !== 'guest');
    return p ? { kind: 'roll', where: `who was there (${p.name})`, now: p.status || '', secret: false, person: p } : null;
  }
  if (!t.startsWith('n:')) return null;
  const id = t.slice(2);
  for (const s of m.sections || []) {
    if (s.id === id) return { kind: 'words', where: s.title || 'the meeting', now: s.notes || '', secret: s.items.some((it) => it.confidential) };
    const it = s.items.find((x) => x.id === id);
    if (it) return { kind: 'words', where: it.title || s.title || 'an item', now: it.notes || '', secret: !!it.confidential };
  }
  return null;
}

/** Whether the meeting says what the correction says */
const holds = (m, c) => { const t = targetOf(m, c.target); return !!t && (c.kind === 'roll' ? (t.now || '') === c.words : sameNote(t.now, c.words)); };
/** The meeting with the correction on it (typed minutes say when they last changed; when they first went in stays) */
function withCorrection(m, c, now) {
  const key = c.target.slice(2);
  const from = m.minutesFrom?.typed ? { minutesFrom: { ...m.minutesFrom, first: m.minutesFrom.first || m.minutesFrom.at, at: iso(now) } } : {};
  if (c.kind === 'roll') return { ...m, ...from, attendance: m.attendance.map((p) => (p.key === key ? { ...p, status: c.words } : p)) };
  return { ...m, ...from, sections: m.sections.map((s) => (s.id === key ? { ...s, notes: c.words } : { ...s, items: s.items.map((it) => (it.id === key ? { ...it, notes: c.words } : it)) })) };
}

/** Who's writing: a member, or a founder or staff member looking at the page */
async function authorOf(env, w) {
  if (w?.member) return { slug: w.member.slug, name: w.member.name, email: w.member.email || '' };
  if (!w?.admin) throw no('The board page is for SOARD’s board members', 403);
  const email = String(w.adminEmail || '').toLowerCase();
  const staff = (await roster(env.DB)).staff.find((p) => email.startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`));
  return { slug: staff?.slug || email, name: staff?.name || email, email };
}

/**
 * The corrections as a person's board page shows them: a decline is for who suggested it and who decides; one taken back
 * is nobody's; a member sees only meetings on the board page, since these carry the minutes' words. One nobody decided
 * before the board approved the minutes is `closed` (back to waiting if they go back to draft). → { meetingId: [...] }
 */
export async function correctionsForPage(DB, w, meetings = null) {
  await ensureSchema(DB);
  const rows = (await DB.prepare("SELECT * FROM board_minutes_corrections WHERE state != 'withdrawn' ORDER BY at").all()).results || [];
  if (!rows.length) return {};
  const on = new Map((meetings || await listMeetings(DB)).map((m) => [m.id, m]));
  const decider = canDecide(w);
  const me = w?.member?.slug || '';
  const email = String(w?.adminEmail || '').toLowerCase();
  const out = {};
  for (const r of rows) {
    const m = on.get(r.meeting_id);
    if (!m || (!w?.admin && (!m.shared || m.notBoard))) continue;
    const mine = !!me && r.by_slug === me || (!!email && String(r.by_email || '').toLowerCase() === email);
    if (r.state === 'declined' && !decider && !mine) continue;
    const open = r.state === 'waiting' || r.state === 'making';
    (out[r.meeting_id] ||= []).push({
      id: r.id, target: r.target, kind: r.kind, was: r.was || '', words: r.words || '', by: r.by_name || '', mine, at: r.at,
      state: open ? (m.minutes === 'approved' ? 'closed' : 'waiting') : r.state, decidedBy: r.decided_by || '', decidedAt: r.decided_at || '', ...(r.state === 'declined' ? { reason: r.reason || '' } : {}),
    });
  }
  return out;
}

/** How many wait on one meeting */
export async function waitingOn(DB, id) {
  const r = await DB.prepare("SELECT count(*) AS n FROM board_minutes_corrections WHERE meeting_id = ? AND state IN ('waiting', 'making')").bind(id).first();
  return Number(r?.n) || 0;
}

/**
 * POST { action: 'correction', meetingId, target, words, was }: a correction, while the minutes are in, on the board page
 * and not approved. Their own waiting one on the same words is replaced. `was`: what their page showed (changed since:
 * 409 { changed }). → { correction }
 * The correction and the email it owes the secretary and the founders are one write (its notice due), every read before
 * it: the database failing anywhere kept nothing, said so. Pressed again, the notice is owed if the record doesn't have
 * it yet (told_at), never skipped (Board QA round 13, Nov 24 2026: kept, its notice's write failing, and pressed again as
 * told, nobody was ever emailed)
 */
export async function suggestCorrection(env, args, w, opts = {}) {
  return suggesting(env, args, w, opts).catch(nothingDone());
}
async function suggesting(env, { meetingId, target, words, was = null } = {}, w, { now = Date.now(), waitUntil = null } = {}) {
  await ensureSchema(env.DB);
  const id = String(meetingId || '');
  if (!ID.test(id)) throw no('Which meeting?', 400);
  const m = await getMeeting(env.DB, id);
  if (!m || m.practice || m.notBoard || !m.shared) throw no('That meeting isn’t on the board page', 404);
  if (m.minutes === 'approved') throw no('These minutes are approved, so they can’t change here', 409);
  if (!minutesIn(m)) throw no('The minutes aren’t in yet', 409);
  const t = targetOf(m, target);
  if (!t) throw no('That part of the minutes has changed. Reload the page.', 409, { reload: true });
  const me = await authorOf(env, w);
  const rl = await limit(env.DB, `board-correct:${me.slug}`, 30, 3600, { now });
  if (!rl.ok) throw no('That’s a lot of corrections at once. Try again in a while.', 429);
  const said = cleanWords(words);
  if (t.kind === 'words') {
    if (was === null) throw no('Reload the page, then suggest your correction.', 409, { reload: true });
    if (!sameNote(was, t.now)) throw no('These words changed while you had them open. Read them again, then suggest your correction.', 409, { changed: true });
    if (sameNote(said, t.now)) throw no('That’s what it says now. Change the words first.', 400);
  } else if (t.kind === 'roll') {
    // (the page offers this only once someone's marked as there: with nobody yet, one mark changes everyone at the next send)
    if (!m.attendance.some((p) => p.status === 'present' || p.status === 'remote')) throw no('Nobody is marked as there yet.', 409);
    if (!ROLL.includes(said)) throw no('Here, on video, excused or not there?', 400);
    if (said === (t.now || 'absent')) throw no('That’s what it says now.', 400);
  } else if (said.length < 3) throw no('What needs correcting?', 400);

  const at = iso(now);
  const before = t.kind === 'other' ? '' : t.now;
  // (saying it again in other words: theirs is replaced, never a second one to decide)
  const had = t.kind === 'other' ? null : await env.DB.prepare("SELECT id, told_at FROM board_minutes_corrections WHERE meeting_id = ? AND target = ? AND by_slug = ? AND state = 'waiting'").bind(id, String(target), me.slug).first();
  const cid = had?.id || uid('c_');
  // Its email, to the secretary and the founders, written down as due in the same write: a new one owes it; one reworded
  // owes it only if the record has none yet (a word changed in one already told isn't news: the email said to open the
  // page). Due before People is read, so a read that fails or a send that doesn't go is sent by the signing look, once
  // (ON CONFLICT keeps the first; each address its own key: ./_board-notices.js)
  const owes = emailConfigured(env) && !had?.told_at;
  const noticeId = `correction:${cid}`;
  if (owes) await readState(env.DB, `notice-due:${noticeId}`); // (makes board_state)
  const waiting = { sql: "EXISTS (SELECT 1 FROM board_minutes_corrections WHERE id = ? AND state = 'waiting')", bind: [cid] };
  // (only with the correction as written: one decided a moment ago owes nothing new)
  const due = owes ? dueStmt(env.DB, noticeId, { kind: 'correction', meetingId: id, cid, by: { name: me.name, email: me.email || '' }, where: whereOf(t) }, now, had ? waiting : null) : null;
  // (its answer lost: written if the correction there is this one, words and time; its notice with it, one batch)
  const done = await landedOr(() => env.DB.batch([
    had
      ? env.DB.prepare("UPDATE board_minutes_corrections SET was = ?, words = ?, at = ?, told_at = COALESCE(told_at, ?) WHERE id = ? AND state = 'waiting'").bind(before, said, at, owes ? at : null, cid)
      : env.DB.prepare('INSERT INTO board_minutes_corrections (id, meeting_id, target, kind, was, words, by_slug, by_name, by_email, at, state, told_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(cid, id, String(target), t.kind, before, said, me.slug, me.name, me.email, at, 'waiting', owes ? at : null),
    ...(due ? [due] : []),
  ]), async () => !!(await env.DB.prepare("SELECT 1 AS y FROM board_minutes_corrections WHERE id = ? AND words = ? AND at = ? AND state = 'waiting'").bind(cid, said, at).first()));
  if (had && !done.lost && !((done[0]?.meta?.changes ?? done[0]?.changes ?? 0) > 0)) throw no('That correction was decided a moment ago. Reload the page to see it.', 409, { reload: true });
  // Written: its email is due, and goes now if People can be read (else the signing look sends it)
  let later = '';
  if (owes) {
    try { later = (await sendNotice(env, noticeId, { waitUntil, who: 'the secretary and the founders', now })).later || ''; } catch (err) {
      console.error('[board-corrections] the notice', cid, err?.message || err);
      later = laterWords('the secretary and the founders');
    }
  }
  return { correction: { id: cid, target: String(target), kind: t.kind, was: before, words: said, by: me.name, mine: true, at, state: 'waiting', decidedBy: '', decidedAt: '' }, ...(later ? { later } : {}) };
}

/** POST { action: 'correction-withdraw', id }: theirs, while it's waiting (one write: the database failing changed nothing) */
export async function withdrawCorrection(env, id, w) {
  return withdrawing(env, id, w).catch(nothingDone());
}
async function withdrawing(env, id, w) {
  await ensureSchema(env.DB);
  const me = await authorOf(env, w);
  // (its answer lost: taken back if the site has it so, which is what they asked)
  const r = await landedOr(() => env.DB.prepare("UPDATE board_minutes_corrections SET state = 'withdrawn' WHERE id = ? AND by_slug = ? AND state = 'waiting'").bind(String(id || ''), me.slug).run(),
    async () => (await env.DB.prepare('SELECT state FROM board_minutes_corrections WHERE id = ? AND by_slug = ?').bind(String(id || ''), me.slug).first())?.state === 'withdrawn');
  if (!r?.lost && !((r?.meta?.changes ?? r?.changes ?? 0) > 0)) {
    // (already taken back, in another tab: that's what they asked for)
    const c = await env.DB.prepare('SELECT state FROM board_minutes_corrections WHERE id = ? AND by_slug = ?').bind(String(id || ''), me.slug).first();
    if (c?.state !== 'withdrawn') throw no('That correction has already been decided', 409, { reload: true });
  }
  return { id: String(id) };
}

/** A box of the notes as words, empty or not */
const boxOf = (notes, key) => { const v = notes?.[key]; return v === undefined || v === null ? '' : String(v); };

const STALE = 'The minutes changed there after this was suggested, so it can’t go over them. Read them, then change them in the notes or keep them as they are.';
/** A decision that didn't land (one step: nothing of it was done), in round 11's words */
const NOT_DECIDED = NOTHING_SAVED;
/** Whether the meeting no longer says what the correction was suggested against */
const changedSince = (m, c) => { const t = targetOf(m, c.target); return !t || (c.kind === 'roll' ? (t.now || '') !== (c.was || '') : !sameNote(t.now, c.was)); };

/** A draft's words, for telling whether anything in it is still to send */
const typedOf = (x) => JSON.stringify(Object.entries(x).filter(([k]) => k !== 'skipped').sort(([a], [b]) => a.localeCompare(b)));

/**
 * What a send would have recorded had this box been sent: the next send then sees a box it put there, so it can't read as
 * someone else's change or put old words back. `before`: what the meeting said there. Null takes a field off.
 */
function keptFor(m, c, last, before, mark) {
  const box = c.target;
  const id = box.slice(2);
  const words = c.words;
  if (c.kind === 'roll') {
    if (!mark) return {};
    return { notes: { [box]: words }, ...((last.extra || []).includes(id) ? {} : { rollPut: { [id]: words }, ...(id in (last.rollWas || {}) ? {} : { rollWas: { [id]: before } }) }) };
  }
  const notes = { [box]: words || null };
  if ((m.sections || []).some((s) => s.id === id)) return { notes, ...(last.parts ? { parts: { [id]: words } } : {}) };
  // (taken out: gone, never the agenda's words back, as they would be from a box emptied at a send)
  if (!words) return { notes, put: { [id]: null }, items: { [id]: null }, cleared: { [id]: id in (last.items || {}) ? last.items[id] : before }, ...(last.left ? { left: { [id]: '' } } : {}) };
  return { notes, put: { [id]: words }, ...(id in (last.put || {}) ? {} : { items: { [id]: before }, ...(last.left ? { left: { [id]: null } } : {}) }) };
}

/**
 * What a correction does to the meeting as it is (`m`), pure: the meeting with it on (`next`, null when it says that
 * already), the patch to what the last send kept (`kept`, null for none) and the notes' statements that write both.
 * Throws, in words, when it can't go on these minutes as they are (changed since, unsent words in its box, or minutes it
 * would leave with nothing in them). `ctx`: the notes as read (draft, last), whether they're typed, and `now`
 */
function correctionPlan(m, c, { typed, draft, last, now }) {
  const id = m.id;
  const box = c.target;
  const here = boxOf(draft, box);
  const sent = boxOf(last.notes, box);
  const left = last.notes ? withBox(last.notes, box, c.words) : null;
  let next = null;
  if (!holds(m, c)) {
    const t = targetOf(m, box);
    if (!t) throw no('That part of the minutes isn’t on the meeting any more. Keep the minutes as they are, or change them in the notes.', 409, { stale: true });
    // (a founder's save can land at any moment: looked at again as it's written)
    if (changedSince(m, c)) throw no(STALE, 409, { stale: true });
    if (left) {
      if (here !== sent && here !== c.words) throw no('There are words in the notes there that aren’t sent yet. Send them first, then make this one.', 409, { unsent: true });
      // (the notes with nothing left in them would take the whole minutes off the meeting at the next send)
      if (!anythingIn(left) || !anythingIn(withBox(draft, box, c.words))) throw no('That would leave these minutes with nothing in them. Change them in the notes instead.', 409, { empties: true });
    }
    next = withCorrection(m, c, now);
  }
  const notes = [];
  let kept = null;
  if (typed && left && anythingIn(left)) {
    // A person on the roll: their box says it too, or the next send puts the old mark back. With nobody marked in the notes
    // the list is the meeting's own and stays so: one mark there would turn everyone unmarked into not there
    const person = (m.attendance || []).find((p) => p.key === box.slice(2));
    const named = String(draft.guests || '').toLowerCase().split(/[;\n]+/).map((x) => x.trim()).includes(String(person?.name || '').toLowerCase());
    const mark = c.kind === 'roll' && (box in draft || named || (last.extra || []).includes(box.slice(2)) || Object.keys(draft).some((k) => k.startsWith('r:')));
    const k = keptFor(m, c, last, c.was || '', mark);
    if (Object.keys(k).length) {
      const carried = here === sent || here === c.words;
      // (nothing else waiting in the notes: nothing left to send)
      if (typedOf(carried ? withBox(draft, box, c.words) : draft) === typedOf(left)) k.at = iso(now);
      kept = k;
      notes.push(
        { sql: 'UPDATE board_minutes_notes SET sent = json_patch(sent, ?) WHERE meeting_id = ?', bind: [JSON.stringify(k), id] },
        { sql: "UPDATE board_minutes_notes SET data = json_patch(data, ?) WHERE meeting_id = ? AND COALESCE(json_extract(data, ?), '') = ?", bind: [JSON.stringify({ [box]: c.words || null }), id, boxPath(box), sent] },
      );
    }
  }
  return { next, kept, notes };
}

/**
 * Put a correction on the meeting, safe to press again: words already there are only brought into step. Words that changed
 * since it was suggested, or unsent words in the same box, are never gone over, and it can't empty the minutes. Minutes read
 * from a file: on the meeting; the file stays as it was, and the answer says so.
 * The meeting, the notes' record of it, the Word file a send kept and `also` (the decision, and the notice it owes) are
 * one step: all of it lands or none of it (./_board.js patchTogether). The Word file's new bytes are made first, from the
 * very copy of the meeting the step writes over and every read they go by, so a file that can't be made leaves nothing
 * made (Board QA round 12, Nov 23 2026: its rewrite came after the step and failed quietly, and the file kept the old words)
 */
async function makeIt(env, id, c, w, { now, also = [] }) {
  const typed = !!(await getMeeting(env.DB, id))?.minutesFrom?.typed;
  if (typed && !await claimSending(env.DB, id, now)) throw no('These are being sent right now. Give it a moment.', 409);
  try {
    for (let tries = 1; ; tries++) {
      // (read with the claim held: nothing can have been sent since)
      const row = typed ? await env.DB.prepare('SELECT data, sent FROM board_minutes_notes WHERE meeting_id = ?').bind(id).first() : null;
      const ctx = { typed, draft: parse(row?.data), last: parse(row?.sent), now };
      let fresh = null;
      let from = '';
      if (typed && ctx.last.fileId && ctx.last.notes) {
        const m0 = await getMeeting(env.DB, id);
        if (keptFile(m0, ctx.last)) {
          // (as the step will leave them: the minutes with it on, and what the last send kept with it in)
          const p = correctionPlan(m0, c, ctx);
          from = m0.updatedAt || '';
          // (`was`: approved minutes' file is their record, never made again: ./_board-notes.js fileMayChange)
          fresh = await stageMinutesFile(env, p.next || m0, { was: m0, last: mergePatch(ctx.last, p.kept || {}), now });
        }
      }
      try {
        await patchTogether(env.DB, [id], ([m]) => {
          if (!m) throw no('That meeting is gone', 404);
          // (approved since the decision read them: approved minutes change only once the approval is taken back. Board QA round 14)
          if (m.minutes === 'approved') throw no('These minutes are approved, so they can’t change here', 409, { reload: true });
          // (changed since its Word file was made from it: made again)
          if (fresh && (m.updatedAt || '') !== from) throw AGAIN;
          const p = correctionPlan(m, c, ctx);
          return { writes: p.next ? [[m, p.next]] : [], also: [...p.notes, ...(fresh?.also || []), ...also] };
        }, { by: w?.member?.email || w?.adminEmail || '' });
      } catch (err) {
        await fresh?.drop();
        if (err === AGAIN && tries < 3) continue;
        throw err === AGAIN ? no('The minutes kept changing while this was made, so nothing was changed. Try again in a moment.', 409) : err;
      }
      // (in: the Word file's old words go, now that nothing names them)
      await fresh?.done();
      return typed ? {} : { fileKeeps: true };
    }
  } finally {
    if (typed) await releaseSending(env.DB, id).catch((err) => console.error('[board-corrections] the notes claim', id, err?.message || err));
  }
}

/**
 * POST { action: 'correction-decide', id, make, reason, saw }: the secretary or a founder. `make`: on the meeting (a
 * correction that's about anything else: they've changed it themselves); not `make`: the minutes stay as they are, with why
 * if they say. Words already on the minutes are made, whichever was pressed: "kept as they are" would be untrue. `saw`: the
 * words on their page: reworded since, they read it first. → { id, state, fileKeeps }
 * Every read the decision needs (who's deciding, the correction, the meeting) is made before anything changes, and the
 * minutes, the decision and the notice owed to whoever suggested it are written in one step: decided whole, or not at all
 * and waiting again. Board QA round 11, Nov 23 2026: who was deciding was read after the minutes changed, and its failure
 * left them changed, the correction stuck being made, "nothing was changed" said, and Sam never told
 */
export async function decideCorrection(env, { id, make = false, reason = '', saw = null } = {}, w, { now = Date.now(), waitUntil = null } = {}) {
  if (!canDecide(w)) throw no('Only the board’s secretary or a founder decides a correction', 403);
  // (nothing is decided until the one step below lands: a database that didn't answer before it is said in words, never
  // "something went wrong" over a decision that changed nothing. Board QA round 12)
  const unsaid = (err) => (err?.status ? err : readDown(NOT_DECIDED, err));
  await ensureSchema(env.DB).catch((err) => { throw unsaid(err); });
  const me = await authorOf(env, w).catch((err) => { throw unsaid(err); });
  const cid = String(id || '');
  const claim = await env.DB.prepare("UPDATE board_minutes_corrections SET state = 'making', decided_at = ?1 WHERE id = ?2 AND (state = 'waiting' OR (state = 'making' AND decided_at < ?3))").bind(iso(now), cid, iso(now - MAKING_MS)).run()
    .catch((err) => { throw unsaid(err); });
  if (!((claim?.meta?.changes ?? claim?.changes ?? 0) > 0)) {
    const was = await env.DB.prepare('SELECT state FROM board_minutes_corrections WHERE id = ?').bind(cid).first().catch((err) => { throw unsaid(err); });
    throw no(was?.state === 'making' ? 'That one is being made right now. Give it a moment.' : 'That one has already been decided', 409, { reload: was?.state !== 'making' });
  }
  // (only a claim still being made goes back: never one this press decided)
  const back = () => env.DB.prepare("UPDATE board_minutes_corrections SET state = 'waiting', decided_at = NULL WHERE id = ? AND state = 'making'").bind(cid).run();
  let c = null;
  let made = {};
  let doing = !!make;
  let owed = null;
  try {
    c = await env.DB.prepare('SELECT * FROM board_minutes_corrections WHERE id = ?').bind(cid).first();
    const m = await getMeeting(env.DB, c.meeting_id);
    if (!m) throw no('That meeting is gone', 404);
    if (!w?.admin && (!m.shared || m.notBoard || m.practice)) throw no('That meeting isn’t on the board page', 404);
    if (m.minutes === 'approved') throw no('These minutes are approved, so they can’t change here', 409, { reload: true });
    if (saw !== null && cleanWords(saw) !== c.words) throw no('That correction was reworded a moment ago. Read it again.', 409, { reload: true });
    doing = !!make || (c.kind !== 'other' && holds(m, c));
    // (taken back off the meeting since it was suggested: there are no minutes for it to go on)
    if (doing && !minutesIn(m)) throw no('These minutes aren’t on the meeting any more.', 409, { reload: true });
    // The decision, and (to whoever suggested it, through the list of notices due: ./_board-notices.js) its notice, in
    // the same step as the minutes
    const decided = { sql: 'UPDATE board_minutes_corrections SET state = ?, decided_by = ?, decided_at = ?, reason = ? WHERE id = ?', bind: [doing ? 'made' : 'declined', me.name, iso(now), doing ? '' : cleanWords(reason).slice(0, 1000), cid] };
    if (c.by_slug !== me.slug && emailConfigured(env)) {
      owed = { id: `correction-decided:${cid}`, notice: { kind: 'correction-decided', meetingId: m.id, cid, made: doing, byName: me.name, toEmail: c.by_email || '', toSlug: c.by_slug } };
      await readState(env.DB, `notice-due:${owed.id}`); // (makes board_state)
    }
    const due = owed ? dueRow(owed.id, owed.notice, now) : null;
    const also = [decided, ...(due ? [{ sql: 'INSERT OR IGNORE INTO board_state (key, data, updated_at) SELECT ?, ?, ? WHERE 1', bind: [due.key, due.data, due.at] }] : [])];
    if (doing && c.kind !== 'other') made = await makeIt(env, c.meeting_id, c, w, { now, also });
    else await env.DB.batch(also.map((x) => env.DB.prepare(x.sql).bind(...x.bind)));
  } catch (err) {
    await back().catch((e) => console.error('[board-corrections] putting it back', cid, e?.message || e));
    throw unsaid(err);
  }
  // Decided: its notice is due already, and goes now if People can be read (else the signing look sends it)
  let later = '';
  if (owed) {
    try { later = (await sendNotice(env, owed.id, { waitUntil, who: noticeName(c.by_name), now })).later || ''; } catch (err) {
      console.error('[board-corrections] the notice', cid, err?.message || err);
      later = laterWords(noticeName(c.by_name));
    }
  }
  return { id: cid, state: doing ? 'made' : 'declined', ...made, ...(later ? { later } : {}) };
}

// ─── The two emails: who and where, never the words ─────────────────
// The minutes stay on the board page; an email can be forwarded and can't be taken back.

const FOOTER = 'You’re getting this as a member of the Sunshine on a Ranney Day Board of Directors.';
const whereOf = (t) => (!t?.where ? '' : t.secret ? 'a board-only item' : t.where);

/** To the secretary and the founders: who suggested one, and where */
export function correctionEmail(m, { by = '', where = '', test = false } = {}) {
  const name = meetingName(m);
  const url = `${SITE}/board/${m.id}`;
  const intro = `${by} suggested a correction to the minutes of the ${name}${where ? `, under ${where}` : ''}.`;
  return {
    subject: `${test ? '[Preview] ' : ''}A correction to the minutes: ${name}`,
    html: emailShell({
      eyebrow: 'SOARD Board', preheader: intro, heading: 'A correction to the minutes', intro: esc(intro),
      bodyHtml: `<div style="margin:18px 0 0;">${button('Read it', url)}</div>`
        + '<p class="muted" style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#5A5B61;">One press there makes it, or keeps the minutes as they are.</p>',
      footerHtml: FOOTER,
    }),
    text: `${intro}\n\nRead it: ${url}\n\nOne press there makes it, or keeps the minutes as they are.`,
  };
}

/** To who suggested it: what was decided (why, if it was kept as it is, stays on the page) */
export function correctionDecidedEmail(m, { made = false, by = '', test = false } = {}) {
  const name = meetingName(m);
  const url = `${SITE}/board/${m.id}`;
  const heading = made ? 'Your correction was made' : 'The minutes stay as they are';
  const intro = made ? `${by} made your correction to the minutes of the ${name}.` : `${by} read your correction to the minutes of the ${name} and kept them as they are.`;
  return {
    subject: `${test ? '[Preview] ' : ''}${made ? 'Your correction was made' : 'Your correction to the minutes'}: ${name}`,
    html: emailShell({ eyebrow: 'SOARD Board', preheader: intro, heading, intro: esc(intro), bodyHtml: `<div style="margin:18px 0 0;">${button('See the minutes', url)}</div>`, footerHtml: FOOTER }),
    text: `${intro}\n\nSee the minutes: ${url}`,
  };
}

// (who's told, and when: ./_board-notices.js sends both emails, from the list of notices due)

/** For Board's own words, and a test: what a roll correction says */
export const rollWords = (status) => HOW[status] || status;
