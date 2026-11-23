/**
 * Action item reminders
 * ===========================================================================
 * Peter, Nov 6 2026: "yes i want this best in class". An action item with an owner
 * reminds them by itself: a week before it's due, the day before, then weekly for
 * three weeks once it's late, and it stops the moment they tick it done on the
 * board page. One with no date is due by the next meeting, without the nagging
 * after. Each person gets one email with all of theirs, never one per item.
 *
 * Off until an admin turns it on (Board → the action items' list; emails to board
 * members never start by themselves). Weekdays in business hours only, as signing
 * reminders are. Its words are the owner's own to-dos, but an item from a board-only
 * part of the agenda is never quoted: an email can be forwarded and can't be taken back.
 */

import { getSettings, listMeetings, roster, boardSees, SITE } from './_board.js';
import { readState, writeState, BOARD_PAGE } from './_board-roles.js';
import { businessHours } from './_board-sign.js';
import { openActions, todayEastern, shortDate, meetingName } from '../../public/admin/board-shared.js';
import { sendEmailOne, emailConfigured, EMAIL_FROM } from './_broadcast-notify.js';
import { emailShell, button, esc } from './_email-shell.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FOOTER = 'You’re getting this as a member of the Sunshine on a Ranney Day Board of Directors.';
const fromBoard = () => EMAIL_FROM.replace(/^[^<]*/, 'SOARD Board ');
const daysTo = (due, today) => Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
const short = (d) => shortDate(d).replace(/, \d{4}$/, '');

/**
 * Which reminder a to-do is on today, '' for none. `soft`: its date is only the next meeting, so nothing follows it
 * after. Anything more than three weeks late has had its last.
 */
export function stageFor(due, today, { soft = false } = {}) {
  if (!due) return '';
  const d = daysTo(due, today);
  if (d > 7) return '';
  if (d >= 2) return 'week';
  if (d >= 0) return 'day';
  if (soft) return '';
  if (d >= -7) return 'late1';
  if (d >= -14) return 'late8';
  return d >= -21 ? 'late15' : '';
}

/** The meetings whose to-dos the reminders write about: those on the board page (_board.js boardCopy) */
const reminded = (meetings) => meetings.filter((m) => m.shared && boardSees(m));

/** The next meeting after a to-do's own among `meetings`, still to come (today or after), or null */
const nextAfter = (meetings, a, today) => meetings.filter((m) => !m.notBoard && !m.practice && m.date > a.meetingDate && m.date >= today).sort((x, y) => x.date.localeCompare(y.date))[0] || null;

/** Each open action item the board can see (a meeting on the board page: _board.js boardCopy), with its date and the owner's slug */
function dueList(meetings, today) {
  const shared = reminded(meetings);
  return openActions(shared).filter((a) => a.owner).map((a) => {
    const of = shared.find((m) => m.id === a.meetingId);
    // (caught under a part: the same as a correction there, any board-only item in it makes it board-only)
    const secret = !!a.from && (of?.sections || []).some((s) => (s.id === a.from && s.items.some((it) => it.confidential)) || s.items.some((it) => it.id === a.from && it.confidential));
    const next = nextAfter(shared, a, today);
    return { ...a, secret, soft: !a.due, date: a.due || next?.date || '' };
  });
}

/** What a to-do says in the email */
const rowWords = (a) => (a.secret ? 'A to-do from a board-only item' : a.text);
function dueWords(a, today) {
  if (!a.date) return '';
  if (a.soft) return `before the ${short(a.date)} meeting`;
  const d = daysTo(a.date, today);
  return d < 0 ? `was due ${short(a.date)}` : d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `due ${short(a.date)}`;
}

/** The email: all of one person's open to-dos, soonest first */
export function actionReminderEmail({ name = '', rows = [], today = todayEastern(), test = false } = {}) {
  const sorted = [...rows].sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  const url = `${SITE}${BOARD_PAGE}`;
  const first = String(name).split(/\s+/)[0];
  const late = sorted.filter((a) => a.date && !a.soft && daysTo(a.date, today) < 0).length;
  const n = sorted.length;
  const intro = `${first ? `${first}, you` : 'You'} have ${n === 1 ? 'a to-do' : `${n} to-dos`} from the board${late ? `, ${late === 1 ? 'one' : late} past ${late === 1 ? 'its' : 'their'} date` : ''}.`;
  const lines = sorted.map((a) => [rowWords(a), dueWords(a, today)]);
  return {
    subject: `${test ? '[Preview] ' : ''}Your board to-dos: ${n === 1 ? (dueWords(sorted[0], today) || 'one open') : `${n} open`}`,
    html: emailShell({
      eyebrow: 'SOARD Board', preheader: intro, heading: 'Your to-dos from the board', intro: esc(intro),
      bodyHtml: `<ul style="margin:14px 0 0;padding:0 0 0 18px;">${lines.map(([what, when]) => `<li style="margin:0 0 8px;">${esc(what)}${when ? ` <span style="color:#5A5B61;">(${esc(when)})</span>` : ''}</li>`).join('')}</ul>`
        + `<div style="margin:18px 0 0;">${button('Open your to-dos', url)}</div>`
        + '<p class="muted" style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#5A5B61;">Tick one done on the board page and these stop for it. Sign in with this email address.</p>',
      footerHtml: FOOTER,
    }),
    text: [intro, lines.map(([what, when]) => `- ${what}${when ? ` (${when})` : ''}`).join('\n'), `Open your to-dos: ${url}`, 'Tick one done on the board page and these stop for it. Sign in with this email address.'].join('\n\n'),
  };
}

/** Everyone who can own a to-do, with an address: staff have theirs by their Google sign-in */
async function addresses(DB, settings) {
  const people = await roster(DB, { withEmails: true });
  const out = new Map();
  for (const p of [...people.board, ...people.staff]) {
    const staffMail = (settings.admins || []).find((e) => String(e).toLowerCase().startsWith(`${String(p.name).split(/\s+/)[0].toLowerCase()}@`));
    const email = p.email || (people.staff.includes(p) ? staffMail : '') || '';
    if (email) out.set(p.slug, { name: p.name, email });
  }
  return out;
}

/**
 * Hourly, when it's on: each person with a to-do at a new reminder gets one email, all of theirs. A reminder is claimed
 * before its email (two heartbeats never send two) and given back if it doesn't go. → { sent } | { off } | { waiting }
 */
export async function maybeRemindActions(env, { now = Date.now(), limit = 10 } = {}) {
  const { DB } = env;
  const settings = await getSettings(DB);
  if (settings.actionRemind !== 'on') return { off: true };
  if (!emailConfigured(env)) return { off: true, why: 'email' };
  if (!businessHours(now)) return { waiting: 'hours' };
  const state = await readState(DB, 'action-reminds');
  if (state.at && now - Date.parse(state.at) < HOUR) return { waiting: 'hour' };
  // Who has which address, read before the hour is marked: People not answering throws, nothing is marked or sent, and
  // the next heartbeat tries again (never an hour of reminders lost, nor "no email" for anyone: round 10)
  const who = await addresses(DB, settings);
  await writeState(DB, 'action-reminds', { at: new Date(now).toISOString() });
  const today = todayEastern(now);
  const all = dueList(await listMeetings(DB), today);
  if (!all.length) return { sent: 0 };
  const had = new Set(((await DB.prepare('SELECT action_id, stage FROM board_action_reminders').all()).results || []).map((r) => `${r.action_id}|${r.stage}`));
  // (by the date too: a to-do given a new date is reminded of that one)
  const firing = all.map((a) => { const stage = stageFor(a.date, today, { soft: a.soft }); return { a, stage: stage ? `${stage}@${a.date}` : '' }; }).filter(({ a, stage }) => stage && !had.has(`${a.id}|${stage}`));
  let sent = 0;
  for (const owner of [...new Set(firing.map((x) => x.a.owner))]) {
    if (sent >= limit) break;
    const person = who.get(owner);
    if (!person) continue;
    const mine = firing.filter((x) => x.a.owner === owner);
    const at = new Date(now).toISOString();
    const claimed = [];
    for (const { a, stage } of mine) {
      const r = await DB.prepare('INSERT OR IGNORE INTO board_action_reminders (action_id, stage, at) VALUES (?, ?, ?)').bind(a.id, stage, at).run();
      if (r?.meta?.changes ?? r?.changes) claimed.push({ a, stage });
    }
    if (!claimed.length) continue;
    const mail = actionReminderEmail({ name: person.name, rows: all.filter((a) => a.owner === owner), today });
    const r = await sendEmailOne(env, { to: person.email, from: fromBoard(), ...mail, replyTo: settings.admins, tags: [{ name: 'kind', value: 'board-action-reminder' }], idempotencyKey: `action-remind:${owner}:${today}:${claimed.map(({ a, stage }) => `${a.id}.${stage}`).join(',').slice(0, 180)}` });
    if (!r.sent && !r.already) {
      for (const { a, stage } of claimed) await DB.prepare('DELETE FROM board_action_reminders WHERE action_id = ? AND stage = ? AND at = ?').bind(a.id, stage, at).run().catch(() => {});
      continue;
    }
    sent += 1;
  }
  return { sent };
}

/** "A, B and C" */
const andList = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] || '');
/** The people a group of to-dos is for, each once, as Home names them */
const namesOf = (l) => [...new Set(l.map((a) => String(a.ownerName || a.owner || '').trim()).filter(Boolean))];

/**
 * Every open to-do Home lists, sorted by whether a reminder can go for it: the one rule the preview, the question on
 * turning reminders on, and the hourly sends follow (dueList for which meetings, addresses for who can be written to).
 * `to`: slug -> name of each person who'd get one. Each of the rest is in the first group that fits: from a meeting
 * not on the board page (hidden), with a name on it that isn't linked to anyone on People (typed: the minutes reader
 * leaves a name it can't match that way), with no name at all (nameless), for someone not on the board or staff now
 * (unlisted), or for someone on the board or staff with no email on file (noEmail)
 */
function reachOf(meetings, people, who, today = todayEastern()) {
  const on = new Set([...people.board, ...people.staff].map((p) => p.slug));
  const page = new Set(reminded(meetings).map((m) => m.id));
  const dated = new Map(dueList(meetings, today).map((a) => [a.id, a]));
  const r = { to: new Map(), hidden: [], typed: [], nameless: [], unlisted: [], noEmail: [], late: [], undated: [], unshared: [] };
  for (const a of openActions(meetings)) {
    if (!page.has(a.meetingId)) r.hidden.push(a);
    else if (!a.owner) (String(a.ownerName || '').trim() ? r.typed : r.nameless).push(a);
    else if (!who.has(a.owner)) (on.has(a.owner) ? r.noEmail : r.unlisted).push(a);
    // (no date of its own: due by the next meeting on the board page. One in Board that isn't on it yet is named, never
    // "no meeting after it". QA round 6, Nov 21 2026)
    else if (!dated.get(a.id)?.date) { const later = nextAfter(meetings, a, today); if (later) r.unshared.push({ ...a, later }); else r.undated.push(a); }
    else if (!remindsLeft(dated.get(a.id), today)) r.late.push(a);
    else r.to.set(a.owner, who.get(a.owner).name);
  }
  return r;
}
/**
 * Whether a to-do (as dueList dates it) has a reminder still to come, today's or a later one (stageFor's): one more than
 * three weeks late has had its last (Board QA round 5, Nov 21 2026: "Turn reminders on?" named someone whose only to-do
 * would never be reminded)
 */
function remindsLeft(a, today) {
  if (!a?.date) return false;
  const d = daysTo(a.date, today);
  return d >= 0 || (!a.soft && d >= -21);
}

/** Why each open to-do that gets no reminder gets none, a sentence for each reason */
function whyNone(r) {
  const out = [];
  const said = (l, one, many) => { const n = namesOf(l); if (n.length) out.push(`${andList(n)} ${n.length === 1 ? one : many}.`); };
  said(r.noEmail, 'has no email on file', 'have no email on file');
  said(r.unlisted, 'isn’t on the board or staff now', 'aren’t on the board or staff now');
  if (r.typed.length) out.push(`The ${r.typed.length === 1 ? 'to-do' : 'to-dos'} for ${andList(namesOf(r.typed))} ${r.typed.length === 1 ? 'isn’t' : 'aren’t'} linked to anyone on People.`);
  if (r.nameless.length) out.push(`${r.nameless.length === 1 ? 'One open to-do has' : `${r.nameless.length} open to-dos have`} no one’s name on ${r.nameless.length === 1 ? 'it' : 'them'}.`);
  if (r.late.length) out.push(`The ${r.late.length === 1 ? 'to-do' : 'to-dos'} for ${andList(namesOf(r.late))} ${r.late.length === 1 ? 'is' : 'are'} more than three weeks late, so ${r.late.length === 1 ? 'its' : 'their'} reminders have stopped.`);
  if (r.undated.length) out.push(`The ${r.undated.length === 1 ? 'to-do' : 'to-dos'} for ${andList(namesOf(r.undated))} ${r.undated.length === 1 ? 'has' : 'have'} no due date and no meeting after ${r.undated.length === 1 ? 'it' : 'them'} yet, so there’s nothing to remind them of.`);
  for (const id of [...new Set(r.unshared.map((a) => a.later.id))]) {
    const l = r.unshared.filter((a) => a.later.id === id);
    const n = l[0].later;
    out.push(`The ${l.length === 1 ? 'to-do' : 'to-dos'} for ${andList(namesOf(l))} ${l.length === 1 ? 'has' : 'have'} no due date, so ${l.length === 1 ? 'it’s' : 'they’re'} due by the next meeting, the ${meetingName(n)} on ${short(n.date)}, and that isn’t on the board page yet: no reminder goes until it is.`);
  }
  if (r.hidden.length) {
    const from = new Set(r.hidden.map((a) => a.meetingId)).size === 1 ? 'a meeting' : 'meetings';
    const named = r.hidden.every((a) => String(a.ownerName || a.owner || '').trim());
    out.push(named
      ? `The ${r.hidden.length === 1 ? 'to-do' : 'to-dos'} for ${andList(namesOf(r.hidden))} ${r.hidden.length === 1 ? 'is' : 'are'} from ${from} not on the board page.`
      : `${r.hidden.length === 1 ? 'One open to-do is' : `${r.hidden.length} open to-dos are`} from ${from} not on the board page.`);
  }
  return out;
}

/** Someone on the board with no email on file: where theirs goes */
const addHint = (r, people) => (r.noEmail.some((a) => people.board.some((p) => p.slug === a.owner)) ? ' Add theirs in People → Board, and the reminder shows here.' : '');

/**
 * Why there's no reminder to show, as it is (Board's home lists every open action item beside the button, so "nobody has
 * one" is never said while it shows some, and every one it lists is accounted for): one reason is said in one sentence;
 * several, each in its own
 */
function noneWords(r, people) {
  const kinds = ['hidden', 'typed', 'nameless', 'unlisted', 'noEmail', 'late', 'undated', 'unshared'].filter((k) => r[k].length);
  if (!kinds.length) return 'Nobody has an open to-do from a meeting on the board page, so there’s no reminder to show yet.';
  const hint = addHint(r, people);
  if (kinds.every((k) => k === 'noEmail' || k === 'unlisted' || k === 'typed')) {
    const n = r.noEmail.length + r.unlisted.length + r.typed.length;
    const whose = (l, one, many) => { const names = namesOf(l); return names.length ? `${andList(names)}, ${names.length === 1 ? one : many}` : ''; };
    const words = [
      whose(r.noEmail, 'who has no email on file', 'who have no email on file'),
      whose(r.unlisted, 'who isn’t on the board or staff now', 'who aren’t on the board or staff now'),
      whose(r.typed, 'whose name isn’t linked to anyone on People', 'whose names aren’t linked to anyone on People'),
    ].filter(Boolean).join(', and ');
    return `No reminder can go: the open ${n === 1 ? 'to-do is' : 'to-dos are'} for ${words}.${hint}`;
  }
  if (kinds.length === 1 && kinds[0] === 'nameless') return `No reminder goes: ${r.nameless.length === 1 ? 'the open to-do has no one’s name on it' : 'none of the open to-dos has anyone’s name on it'}.`;
  if (kinds.length === 1 && kinds[0] === 'hidden') return `No reminder goes yet: the open ${r.hidden.length === 1 ? 'to-do is' : 'to-dos are'} from ${new Set(r.hidden.map((a) => a.meetingId)).size === 1 ? 'a meeting' : 'meetings'} not on the board page.`;
  return `No reminder can go. ${whyNone(r).join(' ')}${hint}`;
}

/**
 * For Board's home: who the reminders would write to now and why the other open to-dos get none, so turning them on
 * names only the people who'd get an email (the same rule as the sends) → { to: [names], who: "A and B", why: sentences }
 */
export async function reminderReach(DB, meetings) {
  const settings = await getSettings(DB);
  const [people, who] = await Promise.all([roster(DB), addresses(DB, settings)]);
  const r = reachOf(meetings, people, who, todayEastern());
  const to = [...r.to.values()];
  return { to, who: andList(to), why: `${whyNone(r).join(' ')}${addHint(r, people)}` };
}

/**
 * "Send me the email": the reminder as it would go, with real to-dos only (never made-up ones, nor a meeting that isn't
 * there): the asker's own when they have any, else the next person's the reminders would write to (soonest due first),
 * sent to the asker as a [Preview]. None the reminders would send: nothing is sent, and it says why (`none`, noneWords).
 * → { sent, failed, errors, to, as: whose to-dos it shows } | { none: true, error }
 */
export async function sendActionPreview(env, to) {
  const settings = await getSettings(env.DB);
  const today = todayEastern();
  const first = String(to).split('@')[0].toLowerCase();
  const people = await roster(env.DB);
  const me = people.staff.find((p) => String(p.name).toLowerCase().startsWith(first));
  const meetings = await listMeetings(env.DB);
  const all = dueList(meetings, today);
  const who = await addresses(env.DB, settings);
  const soonest = [...all].sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  // (only someone a reminder would still go to: the same rule as the question on turning them on)
  const reach = reachOf(meetings, people, who, today);
  const owner = me && reach.to.has(me.slug) ? me.slug : soonest.map((a) => a.owner).find((o) => reach.to.has(o));
  if (!owner) return { sent: 0, none: true, error: noneWords(reach, people) };
  const name = owner === me?.slug ? me.name : who.get(owner).name;
  const rows = all.filter((a) => a.owner === owner);
  const r = await sendEmailOne(env, { to, from: fromBoard(), ...actionReminderEmail({ name, rows, today, test: true }), replyTo: settings.admins, tags: [{ name: 'kind', value: 'board-action-reminder-preview' }] });
  return { sent: r.sent ? 1 : 0, failed: r.sent ? 0 : 1, errors: r.errors, to: [to], as: name };
}
