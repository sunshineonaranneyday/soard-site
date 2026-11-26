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
/**
 * A part's words where its own would read oddly in that place (`of`): the meetings' files on Documents, the packets'
 * statements on Financials, a paper's own page, Suggest a correction, the cash's change on a year, the order of a
 * report's slides (Board QA round 14)
 */
export const UNREAD_PLACE = {
  'meetings:files': 'The meetings’ files couldn’t load just now. Reload in a moment.',
  'meetings:statements': 'The statements in the meetings’ packets couldn’t load just now. Reload in a moment.',
  'docs:budgets': 'The budgets and audits among SOARD’s papers couldn’t load just now. Reload in a moment.',
  'docs:paper': 'The documents couldn’t load just now, so this one didn’t open. Reload in a moment.',
  'corrections:suggest': 'The corrections couldn’t load, so you can’t suggest one just now.',
  'history:change': 'The change from a year ago couldn’t load just now.',
  'money:order': 'The money couldn’t load just now, so the order of these slides can’t be changed here.',
  'settings:invite': 'The board’s settings couldn’t load just now, so who sends the invite isn’t said here.',
  'settings:contact': 'The board’s settings couldn’t load just now, so who to tell isn’t said here.',
};
/** The words a place says for a part that failed (`of`: the place, ./UNREAD_PLACE) */
export const unreadWords = (part, of = '') => UNREAD_PLACE[`${part}:${of}`] || UNREAD_WORDS[part] || '';
/** The words for a part that failed, in its place: plain, said once to a screen reader as it appears */
export const CouldntLoad = ({ part, of = '', cls = '' }) => html`<p class=${`bp-unloaded ${cls}`} role="status" data-unread=${part}>${unreadWords(part, of)}</p>`;
const sizeOf = (x) => (Array.isArray(x) || typeof x === 'string' ? x.length : x instanceof Map || x instanceof Set ? x.size : typeof x === 'number' ? x : x && typeof x === 'object' ? Object.keys(x).length : x ? 1 : 0);
/**
 * Whether an empty state may be said ("No notes on these numbers yet.", "Past meetings show here once they’re added.",
 * any "none yet"): only when its part was read and is really empty. A part that failed isn't empty, it isn't known, and
 * its place says it couldn't load; every empty state on the board page asks this one question, so none shows beside
 * "couldn't load" (Board QA round 14: the treasurer's report page said both, the notes' "couldn't load" at its top and
 * "No notes on these numbers yet." under the statement). `list`: what was read (an array, a Map or Set, a count, an
 * object); `n`: a meeting's numbers when the part is theirs
 */
export const emptyRead = (data, part, list = null, n = null) => !failed(data, part, n) && !sizeOf(list);
/**
 * Each route of the board page and the parts of the page's read it draws from. With one of them failed, the route says
 * so where that part is drawn (`data-unread`), never draws as though it were empty, and its lede still names it (Board
 * QA round 14: Documents and Financials dropped every meeting's files and statements without a word, and their ledes
 * rewrote themselves to leave them out; a paper's own page said it may have been taken off the board page). The page
 * marks the route's failed parts on <main data-lost> (./portal.js App), and scripts/test-board-round14-member.mjs walks
 * every route with every part failing in turn against this list
 */
export const ROUTE_PARTS = {
  home: ['money', 'projects', 'kids', 'gifts', 'givers', 'history', 'meetings', 'docs', 'settings', 'presenting', 'corrections', 'minutesSigned', 'notesWaiting', 'review'],
  meetings: ['meetings', 'presenting', 'settings'],
  meeting: ['meetings', 'presenting', 'money', 'projects', 'events', 'settings', 'lineNotes', 'corrections', 'minutesSigned', 'notesWaiting'],
  report: ['meetings', 'presenting', 'money', 'lineNotes', 'myAsks', 'ownFiles'],
  review: ['meetings', 'review'],
  financials: ['money', 'history', 'gifts', 'givers', 'sources', 'meetings', 'docs'],
  people: [],
  documents: ['docs', 'meetings', 'facts', 'kids', 'settings', 'paperWords'],
  paper: ['docs', 'mark', 'copies', 'signedBodies'],
  families: ['projects'],
  family: ['projects'],
};
/** A route's name in ./ROUTE_PARTS, from the page's route ({ page, id, sub }) */
export const routeName = (r) => (r.sub === 'report' ? 'report' : r.sub === 'review' ? 'review' : r.page === 'meetings' ? (r.id ? 'meeting' : 'meetings')
  : r.page === 'documents' ? (r.id ? 'paper' : 'documents') : r.page === 'families' ? (r.id ? 'family' : 'families') : r.page || 'home');
/** The parts `route` draws from that failed just now */
export const lostOn = (data, route, n = null) => (ROUTE_PARTS[route] || []).filter((p) => failed(data, p, n));
