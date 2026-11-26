/**
 * board/unread.js: a read that failed is said so, never drawn as a fact
 * =====================================================================
 * When one of the board page's reads fails (the money, the makeovers, the kids served, the major gifts, their givers'
 * names, the tax returns, the events), the server marks that part in the page's data (functions/api/_board.js portalData `unread`,
 * a flag a part, as round 11's emailAll `unread` does), and the page says in that part's place that it couldn't load
 * just now: never a zero, an empty list, "none yet" or "Anonymous". Nothing worked out from a part that failed (a
 * total, a share, a search entry) is drawn or found (./figures.js, ./portal.js searchIndex). Board QA round 12, from
 * the privacy tester's sweep: every statement of the page's read failing once in turn drew "0 kids served", no
 * makeovers, no gifts and no money as if that were so.
 */

import { h, htm } from '../vendor.js';

const html = htm.bind(h);

/** The parts a read can fail in, each with the words its place says then */
export const UNREAD_WORDS = {
  money: 'The money couldn’t load just now. Reload in a moment.',
  projects: 'The makeovers couldn’t load just now. Reload in a moment.',
  kids: 'The kids served couldn’t load just now. Reload in a moment.',
  gifts: 'The major gifts couldn’t load just now. Reload in a moment.',
  // (Keep anonymous not read: every gift's amount and day, no giver's name, and never "Anonymous", which would say each
  // giver chose it)
  givers: 'The givers’ names couldn’t load just now. Reload in a moment.',
  sources: 'The tax returns and audits couldn’t load just now. Reload in a moment.',
  events: 'The events couldn’t load just now. Reload in a moment.',
  // Board QA round 13: every part of the page's read its own part (functions/api/_board.js portalData, board-portal.js,
  // _board-asks.js portalExtras), each said in its place, the rest of the page open
  history: 'The month-end balances couldn’t load just now. Reload in a moment.',
  meetings: 'The meetings couldn’t load just now. Reload in a moment.',
  docs: 'The documents couldn’t load just now. Reload in a moment.',
  settings: 'The board’s settings couldn’t load just now, so the quorum isn’t said here. Reload in a moment.',
  ownFiles: 'Which of these files are yours couldn’t load just now, so they can’t be taken off here. Reload in a moment.',
  paperWords: 'The words inside SOARD’s papers couldn’t load just now, so those were found by their names only. Reload in a moment.',
  mark: 'Your adopted signature couldn’t load just now. Reload in a moment.',
  copies: 'Your signed copies couldn’t load just now. Reload in a moment.',
  signedBodies: 'What you signed before couldn’t load just now, so what changed isn’t shown. Reload in a moment.',
  practice: 'Today’s practice meeting couldn’t load just now. Reload in a moment.',
  notesWaiting: 'The notes typed for the minutes couldn’t load just now. Reload in a moment.',
  corrections: 'The corrections suggested to the minutes couldn’t load just now. Reload in a moment.',
  minutesSigned: 'Who has signed the minutes couldn’t load just now. Reload in a moment.',
  lineNotes: 'The notes on these lines couldn’t load just now. Reload in a moment.',
  myAsks: 'When your reports are due couldn’t load just now. Reload in a moment.',
  presenting: 'The meetings you present in before they’re shared couldn’t load just now. Reload in a moment.',
  review: 'The chair’s review couldn’t load just now. Reload in a moment.',
  facts: 'Some of SOARD’s facts couldn’t load just now. Reload in a moment.',
};
/**
 * Which parts failed in the page's data, or in a meeting's numbers (`n`: a meeting today or ahead has today's, and its
 * flags; a past meeting's locked numbers have none) → { money?: true, projects?: true, ... }
 */
export const unreadOf = (data, n = null) => ({ ...(data?.numbers?.unread || {}), ...(data?.unread || {}), ...(n?.unread || {}) });
/** Whether `part` failed */
export const failed = (data, part, n = null) => !!unreadOf(data, n)[part];
/** The words for a part that failed, in its place: plain, said once to a screen reader as it appears */
export const CouldntLoad = ({ part, cls = '' }) => html`<p class=${`bp-unloaded ${cls}`} role="status" data-unread=${part}>${UNREAD_WORDS[part] || ''}</p>`;
