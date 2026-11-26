/**
 * board/figures.js: the money the board page shows, as the figures search finds
 * ===============================================================================
 * Every money figure Home, Financials and a meeting's money (its slide too) draw, each with what it is, where it's
 * drawn and how it's written there, made by the same functions that draw it: Home's and Financials' tiles
 * (./figureTiles, drawn by ./portal.js Figures, and ./money.js moneyTiles, the meeting's, each figure kept as it's
 * written), and the cards under them from the models they're drawn from (./money.js yearFigures, mixOf, storeOf, the
 * budget and the cash; ./books.js yearEnds; QuickBooks' statements; ../makeover-costs-shared.js planOf; the tax return's
 * year). The search (./portal.js searchIndex) finds the page's money by this list alone, so a figure drawn is a figure
 * found, in every form it's written: its exact amount, its short form, its words, below zero with its sign, and any
 * other way a tile writes it (Board QA round 9: the budgets, last year, the gifts' total, what makeovers cost, the tax
 * return, the changes and the forecast were drawn but never found, and "$1.88M", the chart's 2026 so far, found only a
 * statement's $1,884,217). Round 10: one entry a figure, landing on its own place (the store's three of a year were one),
 * and the month-by-month tables, the month-end balances and Mercury's record found too. Round 11: every figure lands on
 * a place of its own (a meeting's money tile, a line of a card, never the card or the meeting's whole agenda item), one
 * key a figure wherever it's drawn (Mercury's year), this month's cash so far, never a month's end, and no amount above
 * zero in brackets. Round 12: real money has cents, so each figure is as it's written and the parts of a total add up as
 * written (./money.js addingUp, cashLines, mixOf, wentParts, ioOf); a room's row in What makeovers cost found; one name for
 * what's left out of expenses (./money.js nonCashName); one amount said once; and a part whose read failed never found
 * (./unread.js). DOM-free: it runs in node too (tests/board-round9-member.test.mjs to board-round12-member.test.mjs)
 */

import { money, plural, showsOf, meetingName } from '../board-shared.js';
import { compact, writer, moneyTiles, yearFigures, mixOf, storeOf, storeChange, pctOf, paceOf, growthText, monthsPhrase, spentOf, budgetDue, shortAsOf, andText, monthSoFar, cashLines, nonCashName, nonCashOf, yearLabel, lessWritten, asWritten, ioOf, wentParts } from './money.js';
import { unreadOf, unreadWords } from './unread.js';
import { yearEnds } from './books.js';
import { planOf, typicalLately, statsOf, operatingOf, recentSeasons, rowsOf } from '../makeover-costs-shared.js';
import { answerText, screenText, toComeText, answerSub } from './costs.js';
import { underwayOf } from './stages.js';
import { windowStart, shortDate, dayText } from './parts.js';
import { prep, termsOf, norm } from './find.js';

const dayMonth = (d) => dayText(d, 'md');
/** Dollars with a true minus: "−$12,000" */
export const dollars = (n) => `${n < 0 ? '−' : ''}${money(Math.abs(n))}`;
/** The amount a short form says: "$1.88M" → 1880000 */
const shortValue = (c) => { const m = String(c).match(/([\d.,]+)\s?([KMB])?$/); return m ? Number(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1) : NaN; };
/** A figure's short form, its sign with it: "−$12K", "$1.88M" */
const shortSigned = (v) => `${v < 0 ? '−' : ''}${compact(Math.abs(v))}`;
/**
 * An amount as a result's line says it: exact, with the short form after it only when that rounds ("$1,656,045, or
 * $1.66M", never "$415,000, or $415K"); `short`, the short form a tile writes it in ("+$676K", "$62K"). Never in
 * brackets, which on this page say below zero (Board QA round 11: "($1.66M)" reads as a loss)
 */
// (the two compared as they're written: under $10,000 the short form is the same dollars, "$46", never "$46, or $46":
// Board QA round 12)
export const both = (v, short = shortSigned(v)) => (shortValue(short) !== shortValue(dollars(v)) ? `${dollars(v)}, or ${short}` : dollars(v));
/** A line's amount and the words after it: a comma between when the amount ends with its short form ("…, or $1.66M, on 2025’s same days") */
const joined = (said, tail) => (/, or \S+$/.test(said) && tail && !/^[,.:;]/.test(tail) ? `${said},${tail}` : `${said}${tail}`);
/**
 * An amount as it's written and said, for finding it typed any of those ways: exact ("$1,656,045"), in short as a tile
 * writes it ("$1.66M", "$676K"), in words ("1.66 million", "676 thousand"), and below zero with its sign ("−$12,000")
 */
export const amountWords = (v) => {
  const a = Math.abs(v);
  const c = compact(a);
  const sign = v <= -0.5 ? '−' : '';
  return [`${sign}${money(a)}`, `${sign}${c}`, ...(a >= 1e4 ? [c.replace(/^\$/, '').replace(/K$/, ' thousand').replace(/M$/, ' million').replace(/B$/, ' billion')] : [])].join(' ');
};
/** Whether a figure is written in one of the ways its amount always is (exact or short, signed or not) */
const plainForm = (said, v) => { const s = String(said).replace(/^[+−-]/, ''); return s === money(Math.abs(v)) || s === compact(Math.abs(v)); };

// ─── Home's and Financials' tiles ───
/**
 * The four figures a board member wants first, as Home draws them (./portal.js Figures): the cash, the year's revenue and
 * expenses against their budget, and the makeovers underway. `variant` 'fin': Financials' own, the year's net in the
 * makeovers' place. Each tile keeps its figures as it writes them (`figs`: ./money.js writer), so search finds each in
 * the words it's drawn in. → [{ key, label, value, sub, note, aside, words, href, focus, meter, tone, spark?, figs }]
 */
export function figureTiles({ data, cash, budget, variant = 'home' }) {
  const n = data.numbers;
  // A part whose read failed says so in its tile, never a zero or "None" (./unread.js): the money's tiles one tile of
  // words (Financials says it in its own card), the makeovers' tile the same
  const lost = unreadOf(data);
  const notLoaded = (key, label, href) => ({ key, label, value: 'Couldn’t load just now', words: true, sub: 'Reload in a moment.', href, unread: key === 'money' ? 'money' : 'projects', figs: [] });
  if (lost.money && variant === 'fin') return [];
  // The makeovers underway: being built, Design to Build, by stage so the parts add up (./stages.js underwayOf, the
  // meaning What makeovers cost has too). Awaiting funding hasn't started: said beside them, never counted in them
  const underway = underwayOf(n.projects?.building || []);
  const waitingFunds = n.projects?.waiting || [];
  const next = [...(n.reveals || [])].sort((a, b) => String(a.confirmed && a.date ? a.date : windowStart(a.window) || '9').localeCompare(String(b.confirmed && b.date ? b.date : windowStart(b.window) || '9')))[0];
  const nextWhen = next ? (next.confirmed && next.date ? shortDate(next.date).replace(/, \d{4}$/, '') : next.window?.label || '') : '';
  // While the budget sheet is read, QuickBooks' year so far shows at once, its bar waiting for the budget: the
  // figures never change from three to four once the sheet arrives
  const books = budget === undefined && typeof n.books?.revenue === 'number' ? n.books : null;
  const waiting = (actual) => ({ actual, budget: null, waiting: true });
  // Without QuickBooks, a budget sheet still being read keeps its two figures' places
  const sheet = budget === undefined && !books && budgetDue(data);
  // (the revenue counted one way, as it will be once the budget is in: ./money.js withBooks, yearFigures)
  const rev = budget?.revenue || (books ? { ...waiting(yearFigures(books).revenue), inKind: yearFigures(books).inKind?.given || 0 } : sheet ? waiting(null) : null);
  // Expenses as the budget counts them, without in kind (./money.js spentOf), and saying what's left out
  const exp = budget?.expenses || (books && typeof books.expenses === 'number' ? { ...waiting(spentOf(books)), inKind: books.nonCash > 0 ? books.nonCash : 0 } : sheet ? waiting(null) : null);
  // (the year the budget or QuickBooks says, never one guessed while a sheet is read: ./money.js yearLabel)
  const yr = budget?.year || books?.year || '';
  // Against the budget once there is one for the year (QuickBooks' figures can come before the year's sheet: then
  // against last year's same days), and last year's pace by now on a line of its own
  // (the budget sheet's own actuals say how old they are; QuickBooks' are this hour's)
  const asOf = budget && !budget.live && budget.asOf ? `, as of ${shortAsOf(budget.asOf).replace(/^(\w{3})\w*/, '$1')}` : '';
  const against = ($, k, x) => (x.waiting ? 'The year so far' : x.budget ? `${pctOf(x)}% of the ${$(`${k}:bud`, x.budget)} budget${asOf}` : growthText(x) || `Through ${shortAsOf(budget.asOf)}`);
  // (a line kept for it while the budget is read)
  const pace = (x) => (x.waiting ? ' ' : x.budget && paceOf(x) != null ? `Last year by now: ${Math.round(paceOf(x) * 100)}% of its year` : '');
  // (a change in dollars, "Even" when it rounds to nothing, as every change is: QA round 9)
  // (in dollars as both are written: ./money.js lessWritten)
  const moved = ($, k, a, p, words, even) => (asWritten(a) === asWritten(p) ? even : `${a > p ? '▲' : '▼'} ${$(k, Math.abs(lessWritten(a, p)))} ${words}`);
  const tile = (t, fill) => { const figs = []; return { ...t, ...fill(writer(figs)), figs }; };
  const tiles = lost.money ? [notLoaded('money', 'The money', '#/financials'), lost.projects ? notLoaded('build', 'Makeovers underway', '#makeovers') : null].filter(Boolean) : null;
  if (tiles) return [...tiles, ...(lost.projects ? [] : [{ key: 'build', label: 'Makeovers underway', value: String(underway.count), sub: underway.count ? underway.parts.join(' · ') : 'None right now', aside: waitingFunds.length ? `${waitingFunds.length} more awaiting funding` : '', href: '#makeovers', figs: [] }])];
  const all = [
    tile({ key: 'cash', label: 'Cash in the bank', words: cash === null, href: '#/financials', tone: cash && cash.prior != null && Math.round(cash.total) !== Math.round(cash.prior) ? (cash.total > cash.prior ? 'up' : 'down') : '' }, ($) => ({
      value: cash ? $('cash', cash.total) : cash === null ? 'Not in yet' : '…',
      sub: cash ? (cash.months != null ? `${monthsPhrase(cash.months)} of spending` : cash.asOf ? `As of ${shortAsOf(cash.asOf)}` : '') : 'From the balance sheet',
      // (the month-end balances not read just now: the change on a year says so where it would be, never just gone:
      // Board QA round 14)
      note: cash && cash.prior != null ? moved($, 'cash:chg', cash.total, cash.prior, 'from a year ago', 'Even with a year ago') : cash?.priorLost ? unreadWords('history', 'change') : '',
      noteUnread: cash && cash.prior == null && cash.priorLost ? 'history' : '',
    })),
    rev ? tile({ key: 'rev', label: yearLabel(yr, 'revenue'), meter: rev, note: pace(rev), href: '#/financials', focus: rev.budget ? 'budget' : '' }, ($) => ({
      value: rev.actual == null ? '…' : $('rev', rev.actual), sub: against($, 'rev', rev), aside: rev.inKind ? `Not counting ${$('inkind', rev.inKind)} in kind` : '',
    }))
      : lost.projects ? notLoaded('reveals', 'Reveals ahead', '#makeovers') : { key: 'reveals', label: 'Reveals ahead', value: String((n.reveals || []).length), sub: next ? `Next ${nextWhen || 'date to come'}` : 'None scheduled', href: '#makeovers', figs: [] },
    exp ? tile({ key: 'exp', label: yearLabel(yr, 'expenses'), meter: exp, note: pace(exp), href: '#/financials', focus: exp.budget ? 'budget' : '' }, ($) => ({
      // (what's left out named as everywhere on the page: ./money.js nonCashName)
      value: exp.actual == null ? '…' : $('exp', exp.actual), sub: against($, 'exp', exp), aside: exp.inKind ? `Not counting ${$('exp:nc', exp.inKind)} ${nonCashOf(n.books)}` : '',
    })) : null,
    lost.projects ? notLoaded('build', 'Makeovers underway', '#makeovers') : { key: 'build', label: 'Makeovers underway', value: String(underway.count), sub: underway.count ? underway.parts.join(' · ') : 'None right now', note: rev && nextWhen ? `Next reveal ${nextWhen}` : '', aside: waitingFunds.length ? `${waitingFunds.length} more awaiting funding` : '', href: '#makeovers', figs: [] },
  ].filter(Boolean);
  if (variant !== 'fin') return all;
  // Financials: the net so far beside last year's same days in the makeovers' place, each figure to its card. The net
  // between the revenue and expenses beside it, in kind left out of both (./money.js yearFigures, as The year so far)
  const b = n.books;
  const yf = b ? yearFigures(b) : null;
  const lyNet = yf?.last?.net ?? null;
  const net = typeof yf?.net === 'number' ? tile({ key: 'net', label: `${b.year} net so far`, href: '#year', tone: lyNet != null && Math.round(yf.net) !== Math.round(lyNet) ? (yf.net > lyNet ? 'up' : 'down') : '',
    sub: b.through ? `January 1 to ${dayMonth(b.through)}` : 'The year so far' }, ($) => ({
    value: $('net', yf.net, (v) => `${v < 0 ? '−' : '+'}${compact(Math.abs(v))}`),
    note: lyNet != null ? moved($, 'net:chg', yf.net, lyNet, `on ${b.lastYear.year}’s same days`, `Even with ${b.lastYear.year}’s same days`) : '',
  })) : null;
  return [...all.filter((t) => t.key === 'cash' || t.key === 'rev' || t.key === 'exp').map((t) => ({ ...t, href: { cash: '#cash', rev: '#year', exp: '#budget' }[t.key], focus: '', ...(t.key === 'cash' ? { spark: data.cashHistory } : {}) })), ...(net ? [net] : [])];
}

// ─── Every figure, for the search ───
/**
 * The board page's money as search entries, one a figure, never several together (Board QA round 10: the store's three
 * of a year were one entry, so a figure found by it landed on another and marked all three): { group: 'Money', exact,
 * key, title, sub (its line), hay, href, focus, icon, marks (what to mark where it lands, its amount the ways it's
 * written), sp0 (what its first line is found by), says: [{ sp, sub, marks }] (its other lines, each said when that's
 * what was typed: a statement line's last year or change, a mix part's last year, the form a tile writes it in) }. A
 * line with more than one amount (a statement's, a mix part's) is a row a figure is drawn on, each of its amounts found
 * and marked by itself. `cash` and `budget` as the page has them (./money.js cashKnown, budgetKnown: undefined while
 * being read)
 */
export function moneyFigures(data, { cash = null, budget = null } = {}) {
  // (a part whose read failed is never found: none of the money when it failed, only the gifts, and not them when theirs
  // did: ./unread.js)
  const lost = unreadOf(data);
  if (lost.money) return lost.gifts ? [] : giftsFound(data, !lost.givers);
  const list = [];
  const byId = new Map();
  const FIN = '#/financials';
  const books = data.numbers?.books || null;
  // The year every figure is said in, the one the tiles use: QuickBooks', else the budget sheet's, never one guessed
  // (Board QA round 14: with no year in the sheet, search said "2026 revenue budget", today's year, where the tile said
  // "Revenue")
  const YB = books?.year || budget?.year || '';
  const Y = YB;
  const ly = books?.lastYear || null;
  const LY = ly?.year || (Y ? String(Number(Y) - 1) : '');
  const span = books?.through ? `January 1 to ${dayMonth(books.through)}` : Y ? `${Y} so far` : 'the year so far';
  const mercY = data.numbers?.finance?.ytd?.year || Y;
  /**
   * A figure (`k`, what it is; `v`, its amount): its title, the words before and after its amount in its line (`head`, a
   * change's way, "Up "; `tail`), the words it's found by, where it lands, and the ways it's written there (`said`;
   * `mark`, words written there beside it that are it but aren't an amount: a change's "▼ 50%"). The same figure from
   * another card (the same k and amount) adds the ways it's written there; its first place is where it lands. `cols`:
   * its other amounts in the same line (a statement's last year and change), each with its own head and tail, found and
   * marked each by itself
   */
  // (`zero`: a figure drawn as "$0" that's found all the same, a bank account by its name: ./money.js accountsListed)
  const put = (k, v, o = {}) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || (Math.abs(v) < 0.5 && !o.cols?.length && !o.zero)) return;
    const id = `${k}|${Math.round(v)}`;
    let e = byId.get(id);
    if (!e) {
      const want = o.key || k;
      e = { key: list.some((x) => x.key === want) ? id : want, k, v, title: o.title, head: o.head || '', tail: o.tail || '', words: o.words || '', href: o.href || FIN, focus: o.focus || '', short: o.short || null, said: new Set(), mark: o.mark || '', cols: o.cols || [], icon: o.icon || 'financials' };
      byId.set(id, e);
      list.push(e);
    }
    for (const s of [].concat(o.said || [])) if (s) e.said.add(s);
  };
  // A change, each way said as the page says it ("▲ $376K on 2025’s same days" is "Up $376,045 on 2025’s same days"):
  // its amount, and the way it went before it; nothing when it rounds to nothing (the page says Even)
  const way = (a, p) => (a > p ? 'Up ' : 'Down ');
  const change = (k, a, p, o = {}) => {
    if (!(typeof a === 'number' && typeof p === 'number') || asWritten(a) === asWritten(p)) return;
    put(k, Math.abs(lessWritten(a, p)), { ...o, head: way(a, p) });
  };
  // A tile's figures, each kept as it's written there (./money.js writer)
  const fromTiles = (tiles, at) => { for (const t of tiles) for (const f of t.figs || []) put(f.k, f.v, { ...WHAT(f.k, f.v), ...at(t), said: f.said }); };

  const y = books ? yearFigures(books) : null;
  const ends = books ? yearEnds(books) : null;
  const store = storeOf(books);
  const mix = mixOf(books);
  const nc = typeof books?.nonCash === 'number';
  const cashAsOf = cash?.asOf ? `, as of ${shortAsOf(cash.asOf)}` : '';
  // (a change's way, when both are known)
  const dirOf = (a, p) => (typeof a === 'number' && typeof p === 'number' ? way(a, p) : '');
  // What each of the year's figures leaves out, said with its change, as its card says it: the year so far's three
  // without the in kind (./money.js yearFigures), the year's charts as their captions say (./books.js YearCompare). So
  // two changes are never worded the same for different figures (Board QA round 10: "2026 revenue so far, against
  // 2025’s same days" and "2026 revenue, against 2025’s same days", $376,045 and $226,045, read as contradicting)
  // (what never left the bank named as the page names it: ./money.js nonCashName, this year's, last year's, both)
  const nc0 = nonCashName(y?.inKind);
  const ncLy = nonCashOf(ly);
  const ncBoth = nc0 === ncLy ? nc0 : 'in kind and depreciation';
  const leftRev = y?.inKind?.given > 0 ? ', in kind left out' : '';
  const leftExp = y?.inKind ? `, ${ncBoth} left out` : '';
  const chartRev = ends ? (ends.s.cashIn ? ', in kind left out' : y?.inKind?.given > 0 ? ', in kind included' : '') : '';
  const chartExp = ends ? (ends.s.cash ? `, ${ncBoth} left out` : ', in kind included') : '';
  /** What each figure is, by its `k`: its title, the words before and after its amount, the words it's found by */
  function WHAT(k, v) {
    const acct = k.match(/^cash:([^:]*):(.+)$/);
    // (one below zero said so, as the card and the meeting's tile say it: Board QA round 13; one at $0, or rounding to it,
    // drawn as "$0" and found by its name, never overdrawn: round 14, ./money.js accountsListed)
    if (acct) return { title: acct[2], tail: `, ${v < 0 ? 'overdrawn, ' : ''}a bank account in Cash in the bank${cashAsOf}`, words: `${acct[2]} ${acct[1]} bank account cash balance${v < 0 ? ' overdrawn' : ''}`, focus: 'cash', zero: true };
    return ({
      cash: { title: 'Cash in the bank', tail: ` in the bank${cashAsOf}`, words: 'cash in the bank bank accounts balance total', focus: 'cash' },
      'cash:chg': { title: 'Cash in the bank, against a year ago', head: dirOf(cash?.total, cash?.prior), tail: ` from a year ago${cash?.priorAsOf ? `, ${cash.priorAsOf}` : ''}`, words: 'cash in the bank change a year ago earlier up down', focus: 'cash' },
      'cash:month': { title: 'Cash out a month', tail: ', what left the bank each month, the last 12 months', words: 'cash out a month monthly spending months of cash', focus: 'cash' },
      rev: { key: 'yr:rev', title: yearLabel(YB, 'revenue'), tail: `, ${span}${y?.inKind?.given > 0 && v === y?.revenue ? `, not counting ${money(y.inKind.given)} in kind` : ''}`, words: 'revenue income raised came in year so far', focus: 'year' },
      exp: { key: 'yr:exp', title: yearLabel(YB, 'expenses'), tail: `, ${span}${y?.inKind && v === y?.expenses ? `, not counting ${nc0}` : ''}`, words: 'expenses spending spent costs went out year so far', focus: 'year' },
      net: { key: 'yr:net', title: `${Y} net`, tail: `, ${span}, revenue less expenses`, words: 'net income surplus deficit result bottom line year so far', short: (x) => `${x < 0 ? '−' : '+'}${compact(Math.abs(x))}`, focus: 'year' },
      // (no year read: "the revenue budget", as its tile says "Revenue", never a year)
      'rev:bud': { title: Y ? `${Y} revenue budget` : 'The revenue budget', tail: Y ? `, the budget for ${Y}’s revenue` : ', the budget for the revenue', words: 'budget budgeted plan planned revenue income', focus: 'budget' },
      'exp:bud': { title: Y ? `${Y} expenses budget` : 'The expenses budget', tail: Y ? `, the budget for ${Y}’s expenses` : ', the budget for the expenses', words: 'budget budgeted plan planned expenses spending', focus: 'budget' },
      inkind: { key: 'mix:inkind', title: 'In kind', tail: ` given in kind, ${Y} so far, not counted in the revenue`, words: 'in kind in-kind donated gifts goods services', focus: 'year' },
      'exp:nc': { title: `${nc0.replace(/^./, (c) => c.toUpperCase())} in ${Y}’s expenses`, tail: `, ${Y} so far, not counted in the expenses`, words: 'in kind in-kind depreciation non cash expenses', focus: 'year' },
      'net:chg': { title: `${Y} net, against ${LY}’s same days`, head: dirOf(y?.net, y?.last?.net), tail: ` on ${LY}’s same days${leftExp}`, words: 'net change last year same days up down', focus: 'year' },
      'rev:chg': { title: `${Y} revenue, against ${LY}’s same days`, head: dirOf(y?.revenue, y?.last?.revenue), tail: ` on ${LY}’s same days${leftRev}`, words: 'revenue change last year same days up down', focus: 'year' },
      'exp:chg': { title: `${Y} expenses, against ${LY}’s same days`, head: dirOf(y?.expenses, y?.last?.expenses), tail: ` on ${LY}’s same days${leftExp}`, words: 'expenses change last year same days up down', focus: 'year' },
      'rev:chgly': { title: `${yearLabel(Y, 'revenue')}, against last year by now`, head: dirOf(budget?.revenue?.actual, budget?.revenue?.last), tail: ' on last year by now', words: 'revenue change last year by now up down', focus: 'year' },
      'exp:chgly': { title: `${yearLabel(Y, 'expenses')}, against last year by now`, head: dirOf(budget?.expenses?.actual, budget?.expenses?.last), tail: ' on last year by now', words: 'expenses change last year by now up down', focus: 'year' },
      'rev:books': { title: `${Y} revenue, in kind included`, tail: `, ${span}, as QuickBooks has it`, words: 'revenue income quickbooks books in kind included so far chart', focus: 'year' },
      'exp:books': { title: `${Y} expenses, ${nc0} included`, tail: `, ${span}, as QuickBooks has them`, words: 'expenses spending quickbooks books in kind depreciation included so far', focus: 'year' },
      'net:books': { title: `${Y} net, as QuickBooks has it`, tail: `, ${span}, ${nc0} in`, words: 'net income quickbooks books', focus: 'year' },
      'rev:ly': { title: `${LY} revenue, same days`, tail: `, January 1 to ${dayMonth(ly?.through)}, ${LY}${y?.inKind ? ', in kind left out' : ''}`, words: 'revenue income last year same days by now', focus: 'year' },
      'exp:ly': { title: `${LY} expenses, same days`, tail: `, January 1 to ${dayMonth(ly?.through)}, ${LY}${nc ? `, ${ncLy} left out` : ''}`, words: 'expenses spending last year same days by now', focus: 'year' },
      'net:ly': { title: `${LY} net, same days`, tail: `, January 1 to ${dayMonth(ly?.through)}, ${LY}`, words: 'net income last year same days by now', focus: 'year' },
      'rev:lybooks': { title: `${LY} revenue by ${dayMonth(books?.through)}, in kind included`, tail: `, ${LY}’s same days as QuickBooks has them`, words: 'revenue income last year by now same days quickbooks chart', focus: 'year' },
      'exp:lybooks': { title: `${LY} expenses by ${dayMonth(books?.through)}, in kind included`, tail: `, ${LY}’s same days as QuickBooks has them`, words: 'expenses spending last year by now same days quickbooks chart', focus: 'year' },
      'rev:lyall': { title: `${LY} revenue, the whole year`, tail: `, all of ${LY}`, words: 'revenue income last year whole year in all full', focus: 'year' },
      'exp:lyall': { title: `${LY} expenses, the whole year`, tail: `, all of ${LY}`, words: 'expenses spending last year whole year in all full', focus: 'year' },
      'rev:yearchg': { title: `${Y} revenue so far on the year’s chart, against ${LY}’s same days`, head: dirOf(ends?.rev.now, ends?.rev.by), tail: ` on ${LY}’s same days${chartRev}`, words: 'revenue change chart last year up down', focus: 'year' },
      'exp:yearchg': { title: `${Y} expenses so far on the year’s chart, against ${LY}’s same days`, head: dirOf(ends?.exp.now, ends?.exp.by), tail: ` on ${LY}’s same days${chartExp}`, words: 'expenses change chart last year up down', focus: 'year' },
      // (Mercury's record of the year, as Financials' "Money in and out" and a meeting's tile both key it: one figure,
      // one result, Board QA round 11)
      'io:net': { title: `Net, ${mercY} so far`, tail: ', money in less money out, Mercury’s record', words: 'net year so far mercury money in less money out', focus: 'io-net' },
      'io:in': { title: `Money in, ${mercY} so far`, tail: ', Mercury’s record', words: 'money in income mercury year so far', focus: 'io-in' },
      'io:out': { title: `Money out, ${mercY} so far`, tail: ', Mercury’s record', words: 'money out spending mercury year so far', focus: 'io-out' },
      low: { title: 'Lowest ahead', tail: ', the lowest the cash goes in the next 13 weeks', words: 'lowest ahead forecast low point cash 13 weeks', focus: 'cashtime' },
      in13: { title: 'Cash in 13 weeks', tail: ', in the cash forecast', words: 'in 13 weeks forecast cash ahead', focus: 'cashtime' },
    })[k] || { title: k, tail: '', words: '' };
  }

  // Financials' tiles first (each lands on its own tile), then the cards under them
  fromTiles(figureTiles({ data, cash, budget, variant: 'fin' }), (t) => ({ focus: `fin-${t.key}` }));

  // The cash card: the total, against a year before, each account (the smaller ones together), the cards owed
  if (cash && Number.isFinite(cash.total)) {
    put('cash', cash.total, { ...WHAT('cash'), focus: 'cash' });
    if (cash.prior != null) put('cash:chg', Math.abs(lessWritten(cash.total, cash.prior)), { ...WHAT('cash:chg'), focus: 'cash' });
    if (cash.perMonth) put('cash:month', cash.perMonth, { ...WHAT('cash:month'), focus: 'cash-months' });
    // (each line of the card as ./portal.js CashCard draws it, from the one list both are made from (./money.js
    // cashLines): an account by its name on #cash-a<its place among them>, the smaller ones together on #cash-a-rest,
    // each as it's written there; one account alone is the total, drawn as that. Board QA round 12)
    for (const l of cashLines(cash)) {
      if (l.rest) put('cash:small', l.said, { title: l.name, tail: `, the smaller accounts together, in Cash in the bank${cashAsOf}`, words: 'bank accounts cash smaller together', focus: l.id });
      else put(l.k, l.said, { ...WHAT(l.k, l.said), focus: l.id });
    }
    (cash.owed || []).forEach((o, i) => put(`owed:${o.name}`, o.balance, { title: o.name, tail: ', owed on the card', words: `${o.name} owed card credit card`, focus: `cash-owed${i}`, cols: o.limit ? [{ v: o.limit, tail: `, the card’s limit, ${o.name}` }] : [] }));
  }

  // The year so far: the three figures, each against last year's same days, what they leave out; the year's two charts'
  // ends; QuickBooks' own three; last year's whole
  if (y) {
    const yl = y.last;
    const three = [['rev', y.revenue, yl?.revenue], ['exp', y.expenses, yl?.expenses], ['net', y.net, yl?.net]];
    for (const [k, v] of three) put(k, v, { ...WHAT(k, v), focus: `yf-${k}` });
    if (y.inKind?.given > 0) put('inkind', y.inKind.given, { ...WHAT('inkind'), focus: 'yf-left' });
    if (y.inKind?.used > 0 && Math.round(y.inKind.used) !== Math.round(y.inKind.given)) put('exp:nc', y.inKind.used, { ...WHAT('exp:nc'), focus: 'yf-left' });
    if (ends) {
      for (const [key, e, same] of [['rev', ends.rev, ends.sameRev], ['exp', ends.exp, ends.sameExp]]) {
        const own = key === 'rev' ? (ends.s.cashIn ? 'rev' : 'rev:books') : (ends.s.cash ? 'exp' : 'exp:books');
        put(own, e.now, { ...WHAT(own, e.now), focus: `fy-${key}-cap` });
        if (typeof e.by === 'number') {
          const lk = (key === 'rev' ? ends.s.cashIn : ends.s.cash) ? `${key}:ly` : `${key}:lybooks`;
          put(lk, e.by, { ...WHAT(lk), focus: `fy-${key}-cap` });
          // (its change: the year so far's own when the chart counts it the same way, else one of its own, saying so)
          const ck = own === key ? `${key}:chg` : `${key}:yearchg`;
          put(ck, Math.abs(lessWritten(e.now, e.by)), { ...WHAT(ck), focus: own === key ? `yf-${key}` : `fy-${key}-cap` });
        }
        if (typeof e.all === 'number') put(`${key}:lyall`, e.all, { ...WHAT(`${key}:lyall`), focus: `fy-${key}-cap` });
        void same;
      }
      monthCells();
    }
    // (last year's same days, the way the three count it, in "Line by line"; each change, as % | $ has it in dollars)
    for (const [k, v, p] of three) if (typeof p === 'number') { put(`${k}:ly`, p, { ...WHAT(`${k}:ly`), focus: `yl-${k}` }); put(`${k}:chg`, Math.abs(lessWritten(v, p)), { ...WHAT(`${k}:chg`), focus: `yf-${k}` }); }
    if (y.inKind && typeof y.books.revenue === 'number' && typeof y.books.expenses === 'number') {
      put('rev:books', y.books.revenue, { ...WHAT('rev:books'), focus: 'year-own' });
      put('exp:books', y.books.expenses, { ...WHAT('exp:books'), focus: 'year-own' });
      if (Math.round(y.books.net) !== Math.round(y.net)) put('net:books', y.books.net, { ...WHAT('net:books'), focus: 'year-own' });
      else put('net', y.net, { ...WHAT('net', y.net), focus: 'year-own' });
    }
    if (ly?.full?.revenue > 0) put('rev:lyall', ly.full.revenue, { ...WHAT('rev:lyall'), focus: 'year-ly' });
  }

  /**
   * "The numbers, month by month" under the year's two charts: every amount in it a figure of its own, landing on its
   * cell (./books.js YearCompare, #fy-m3-rl, the fold opened), read from the same series the table is drawn from (Board
   * QA round 10: none of its 42 amounts was found). One the same as its chart's caption (the year so far, last year by
   * the same day) is that figure, landing on the caption, its first place
   */
  function monthCells() {
    const { s: ser } = ends;
    const through = books.through || '';
    const longMonth = (i) => new Date(Date.UTC(2001, i, 15)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    const longDay = (d) => dayText(d, 'MD');
    const sameDay = through && Number(through.slice(5, 7)) - 1 === ser.upTo;
    for (const [key, m, same, what, basis] of [['rev', ser.revenue, ends.sameRev, 'revenue', chartRev], ['exp', ser.spent, ends.sameExp, 'expenses', chartExp]]) {
      const e = ends[key];
      const c = key === 'rev' ? 'r' : 'e';
      const own = key === 'rev' ? (ser.cashIn ? 'rev' : 'rev:books') : (ser.cash ? 'exp' : 'exp:books');
      const lk = (key === 'rev' ? ser.cashIn : ser.cash) ? `${key}:ly` : `${key}:lybooks`;
      const words = (i) => `${what} month by month numbers table ${longMonth(i)}`;
      for (let i = 0; i < 12; i++) {
        const v = m.now[i];
        const by = i === ser.upTo && sameDay ? longDay(through) : `the end of ${longMonth(i)}`;
        if (typeof v === 'number') {
          if (i === ser.upTo && Math.round(v) === Math.round(e.now)) put(own, v, { ...WHAT(own, v), focus: `fy-${key}-cap` });
          else put(`${key}:m${i}`, v, { title: `${ser.year} ${what} by ${by}`, tail: `, added up month by month${basis}`, words: words(i), focus: `fy-m${i}-${c}n` });
        }
        if (!m.then) continue;
        const whole = m.then[i];
        const lv = i === ser.upTo && typeof same === 'number' && through ? same : whole;
        if (typeof lv === 'number') {
          if (i === ser.upTo && typeof e.by === 'number' && Math.round(lv) === Math.round(e.by)) put(lk, lv, { ...WHAT(lk), focus: `fy-${key}-cap` });
          // (December's is last year's whole, as the caption has it)
          else if (i === 11 && typeof e.all === 'number' && Math.round(lv) === Math.round(e.all)) put(`${key}:lyall`, lv, { ...WHAT(`${key}:lyall`), focus: `fy-${key}-cap` });
          else put(`${key}:mly${i}`, lv, { title: `${ser.lastYear} ${what} by ${lv === whole ? `the end of ${longMonth(i)}` : longDay(`${ser.lastYear}${through.slice(4)}`)}`, tail: `, added up month by month${basis}`, words: `${words(i)} last year`, focus: `fy-m${i}-${c}l` });
        }
        // (its whole month beside the same days: "$1,364,400 by November 30")
        if (typeof whole === 'number' && lv !== whole) {
          const end = new Date(Date.UTC(Number(ser.lastYear) || 2001, i + 1, 0)).getUTCDate();
          put(`${key}:mall${i}`, whole, { title: `${ser.lastYear} ${what} by ${longMonth(i)} ${end}`, tail: `, added up month by month${basis}`, words: `${words(i)} last year whole month`, focus: `fy-m${i}-${c}lw` });
        }
      }
    }
  }

  // The year against its budget
  for (const [k, x] of [['rev', budget?.revenue], ['exp', budget?.expenses]]) {
    if (!(x?.budget > 0)) continue;
    put(k, x.actual, { ...WHAT(k, x.actual), focus: `bud-${k}` });
    put(`${k}:bud`, x.budget, { ...WHAT(`${k}:bud`), title: yearLabel(budget.year || YB, `${k === 'rev' ? 'revenue' : 'expenses'} budget`), focus: `bud-${k}` });
    if (x.inKind) put(k === 'rev' ? 'inkind' : 'exp:nc', x.inKind, { ...WHAT(k === 'rev' ? 'inkind' : 'exp:nc'), focus: `bud-${k}` });
  }

  // The store: each of its lines a figure of its own, this year's and last year's same days (Board QA round 10: a year's
  // three were one entry, so "$380,000", last year's cost of goods, landed on the sales row with only its $830,000
  // marked, and this year's on the whole card with all three marked). This year's lands on its tile (#store-sales), last
  // year's on its own cell in "Line by line" (#stl-sales-ly, the fold opened), each marked alone, in the form written
  // there; a line's change on its tile, which says how it stands against last year (a percent for its sales and cost,
  // "▼ 50%", dollars for its profit, which can cross zero: ./money.js storeChange)
  if (store) {
    const name = { sales: 'sales', cost: 'cost of goods', profit: 'profit before staff and rent' };
    const found = { sales: `sales ${store.lines[0].accounts.join(' ')}`, cost: `cost of goods cogs ${store.lines[1].accounts.join(' ')}`, profit: 'profit before staff and rent margin' };
    const lyDays = ly?.through && store.lastYear === LY ? `, January 1 to ${dayMonth(ly.through)}, ${LY}` : `, ${store.lastYear}’s same days`;
    for (const x of store.lines) {
      put(`store:${x.k}`, x.amount, { title: `The store’s ${name[x.k]}`, tail: `, ${store.year} so far`, words: `store shop ${found[x.k]}`, focus: `store-${x.k}` });
      if (!store.lastYear || typeof x.last !== 'number') continue;
      put(`store:${x.k}:ly`, x.last, { title: `The store’s ${name[x.k]}, ${store.lastYear}’s same days`, tail: lyDays, words: `store shop ${found[x.k]} last year same days by now`, focus: `stl-${x.k}-ly` });
      const pct = storeChange(x);
      change(`store:chg:${x.k}`, x.amount, x.last, { title: `The store’s ${name[x.k]}, against ${store.lastYear}`, tail: ` on ${store.lastYear} by now`, words: `store shop ${name[x.k]} change last year by now up down`, focus: `store-${x.k}`, mark: /%$/.test(pct) ? pct : '' });
    }
  }

  // Where the revenue came from: each part (last year's same days beside it), what's below zero, the smaller accounts
  if (mix) {
    // (each part as its row writes it, the parts adding up to the revenue: ./money.js mixOf `said`)
    for (const x of mix.parts) put(`mix:${x.key}`, x.said, { key: `mix:${x.key}`, title: x.name, tail: `, ${x.share} of ${mix.year}’s revenue so far`, words: [x.name, ...(x.key === 'rest' ? [] : x.accounts || []), 'revenue raised income money'].join(' '), focus: `mix-${x.key}`, cols: typeof x.last === 'number' && x.last ? [{ v: x.last, tail: `, ${x.name} in ${mix.lastYear}’s same days` }] : [] });
    if (mix.inKind) put('inkind', mix.inKind, { ...WHAT('inkind'), focus: 'yf-left' });
    for (const x of mix.less) put(`less:${x.key}`, -x.said, { title: x.name || 'Income accounts below zero', tail: `, ${mix.year}’s revenue so far, said under where it came from`, words: [x.name, ...(x.accounts || []), 'revenue less below zero refunds'].join(' '), focus: 'mix-less' });
    const named = new Set(mix.parts.filter((x) => x.key !== 'rest').map((x) => x.key));
    for (const src of (books?.sources || []).filter((x) => !named.has(x.key) && x.amount > 0 && !(mix.inKind && x.key === 'inkind'))) put(`src:${src.key}`, src.amount, { key: `src:${src.key}`, title: src.name, tail: ` of ${mix.year}’s revenue so far, in Everything else`, words: [src.name, ...(src.accounts || []), 'revenue'].join(' '), focus: 'mix-rest' });
  }
  // Where it went, by purpose
  // (as ./portal.js PartsBar draws them: the first three by name, #fn-0 to #fn-2, the rest together, #fn-rest)
  // (as it's drawn, from the same list: the first three by name, the rest together, adding up: ./money.js wentParts)
  const went = wentParts(books?.functions);
  const fns = books?.functions?.list || [];
  if (went) {
    put('fn:total', went.total, { title: 'Where it went, by purpose', tail: `, ${Y} so far`, words: 'where it went purpose spending', focus: 'fn-total' });
    for (const x of went.list) {
      if (x.rest) put('fn:rest', x.said, { title: 'Everything else, by purpose', tail: `, where ${Y}’s money went${fns.length > 3 ? `: ${andText(fns.slice(3).map((f) => f.name))}` : ''}`, words: `${fns.slice(3).map((f) => f.name).join(' ')} everything else where it went purpose spending`, focus: 'fn-rest' });
      else put(`fn:${x.name}`, x.said, { title: x.name, tail: `, where ${Y}’s money went, by purpose`, words: `${x.name} where it went purpose spending`, focus: `fn-${x.i}` });
    }
  }

  // The major gifts: the year's total, and each gift (none when their read failed)
  const g = lost.gifts ? null : data.gifts;
  if (g?.count) put('gifts', g.total / 100, { title: 'Major gifts', tail: ` from ${plural(g.count, 'gift')} of $1,000 or more in ${g.year}`, words: 'major gifts zeffy donations donors total year', focus: 'gifts-total' });

  // What makeovers cost, as its card works it out (./costs.js useCosts) and writes it, each figure landing on the part
  // of the card it's written in (./costs.js: #bc-free, the answer and what it rests on; #bc-says, its sentence;
  // #bc-median; #bc-under-sum and a makeover underway's row, #bc-j-…; a family waiting, #bc-f-…; a completed makeover's
  // row, #bc-m-…), never the whole card (Board QA round 11)
  const c = data.numbers?.costs;
  if (c) {
    const operating = operatingOf(data.numbers);
    const makeovers = c.makeovers || [];
    const plan = planOf({ cash: asWritten(cash?.total), operating, makeovers, waiting: c.waiting || [], underway: c.underway || [] });
    const typical = typicalLately(makeovers);
    const stats = statsOf(typical?.seasons ? makeovers.filter((x) => typical.seasons.includes(Number(x.season))) : makeovers);
    const icon = 'financials';
    const said = new Set();
    // (the card's lines, each where it's written: an amount lands on the first that writes it, or nowhere when none does)
    const lines = plan ? [['bc-free', answerSub(cash, operating, plan)], ['bc-says', answerText(plan, typical)], ...(screenText(plan, typical) !== answerText(plan, typical) ? [['bc-says-short', screenText(plan, typical)]] : []), ...(plan.jobs?.length ? [['bc-under-sum', toComeText(plan)]] : [])] : [];
    const written = (v) => lines.find(([, t]) => String(t).includes(dollars(Math.abs(v))))?.[0] || '';
    const cost = (k, v, title, tail, words = '', focus = written(v)) => { if (typeof v === 'number' && Math.abs(v) >= 0.5 && focus) { said.add(Math.round(Math.abs(v))); put(k, v, { title, tail, words: `what makeovers cost ${words}`, focus, icon }); } };
    if (plan) {
      if (plan.free != null) cost('costs:free', plan.free < 0 ? -plan.free : plan.free, 'For makeovers now', plan.free < 0 ? ` short: ${dollars(plan.cash)} in the bank, less ${dollars(operating)} kept to run SOARD${plan.committed > 0 ? ` and ${dollars(plan.committed)} still to come` : ''}` : `, what’s over the ${dollars(operating)} kept to run SOARD and what’s underway`, 'free for makeovers now short over', 'bc-free');
      if (plan.over > 0) cost('costs:over', plan.over, 'Over the operating balance', `, the cash in the bank over the ${dollars(operating)} kept to run SOARD`, 'over operating balance');
      cost('costs:tocome', plan.committed, 'Still to come on the makeovers underway', `, what the ${plural(plan.jobs.length - (plan.unknown || 0), 'makeover')} underway still need`, 'still to come underway committed');
      cost('costs:paid', plan.paid, 'Paid so far on the makeovers underway', ', what’s been paid on the makeovers underway', 'paid so far underway');
      const next = (plan.families || []).find((f) => !f.covered);
      // (on that family's line, "Needs $X more", only while something's free: else the card says nothing is)
      cost('costs:need', plan.need, 'Needed for the next family', ', what the next family waiting needs more', 'needs more next family waiting', written(plan.need || 0) || (next && plan.free >= 0 ? `bc-f-${next.key}` : ''));
      cost('costs:left', plan.left, 'Left for makeovers', ', left once the families covered are started', 'left over');
      for (const j of plan.jobs || []) { cost(`costs:j:${j.key}`, j.left, `${j.name}’s makeover, still to come`, `, still to come, ${j.status}`, `${j.name} underway still to come`, `bc-j-${j.key}`); cost(`costs:jp:${j.key}`, Number(j.paid) || 0, `${j.name}’s makeover, paid so far`, `, paid so far, ${j.status}`, `${j.name} underway paid`, `bc-j-${j.key}`); }
      for (const f of plan.families || []) {
        if (!f.estimate) continue;
        cost(`costs:f:${f.key}`, f.net, `${f.name}’s makeover, about`, ', about what it will likely cost, waiting on the money', `${f.name} waiting family`, `bc-f-${f.key}`);
        if (f.pledged) cost(`costs:fp:${f.key}`, f.pledged, `Pledged for ${f.name}`, ', pledged by a sponsor', `${f.name} pledged sponsor`, `bc-f-${f.key}`);
        if (f.pledged && f.estimate.cost) cost(`costs:fe:${f.key}`, f.estimate.cost, `${f.name}’s makeover, before what’s pledged`, ', the median of its rooms', `${f.name} estimate`, `bc-f-${f.key}`);
      }
    }
    cost('costs:keep', operating, 'Kept to run SOARD', ', the operating balance What makeovers cost keeps aside', 'kept to run soard operating balance reserve');
    if (typical?.cost) cost('costs:median', typical.cost, 'Median makeover', ', what the median completed makeover cost lately', 'median typical makeover', 'bc-median');
    if (stats) { cost('costs:avg', stats.average, 'Average makeover', ', of the completed makeovers lately', 'average', 'bc-median'); cost('costs:low', stats.low, 'Lowest-cost makeover', `, ${stats.lowOf?.name || ''}`, 'low lowest', 'bc-median'); cost('costs:high', stats.high, 'Highest-cost makeover', `, ${stats.highOf?.name || ''}`, 'high highest', 'bc-median'); }
    // (each completed makeover in "Every completed makeover", the seasons it opens on: ./costs.js CostsCard)
    const recent = recentSeasons(makeovers);
    for (const m of recent?.length ? makeovers.filter((x) => recent.includes(Number(x.season))) : makeovers) cost(`costs:m:${m.key}`, m.cost, `${m.name}’s makeover`, `, what SOARD paid, ${m.season}`, `${m.name} completed makeover paid`, `bc-m-${m.key}`);
    // (each room's row of "Each completed makeover, by room", the seasons it opens on: how many, its median and its
    // average, landing on that row, #bc-r-<room>, as ./costs.js CostChart draws it from the same rows. Board QA round
    // 12: a room's median was drawn and never found; one makeover alone is its own figure, found above)
    for (const r of rowsOf(makeovers, recent?.length ? recent : null)) {
      const st = statsOf(r.list);
      if (!st || st.count < 2) continue;
      const what = `${r.label}, ${plural(st.count, 'makeover')}`;
      const same = Math.round(st.average) === Math.round(st.median);
      cost(`costs:r:${r.id}`, st.median, what, `, the median${same ? ' and the average' : ''} of what each cost`, `${r.label} ${r.short || ''} room median${same ? ' average' : ''} ${st.count} makeovers by room`, `bc-r-${r.id}`);
      if (!same) cost(`costs:ra:${r.id}`, st.average, what, ', the average of what each cost', `${r.label} ${r.short || ''} room average ${st.count} makeovers by room`, `bc-r-${r.id}`);
    }
    // (and any amount the card's lines write that isn't one of those: what they say, by itself, where it's said, its title
    // its own, never one title for two amounts; the cash in the bank they start from is the cash's own figure)
    if (cash && Number.isFinite(cash.total)) said.add(Math.round(cash.total));
    for (const [focus, text] of lines) {
      for (const m of String(text).matchAll(/\$[\d,]+/g)) { const v = Number(m[0].replace(/[$,]/g, '')); if (!said.has(v)) { said.add(v); put(`costs:said:${v}`, v, { title: `What makeovers cost, ${dollars(v)}`, tail: `: ${text.slice(0, 140)}`, words: 'what makeovers cost', focus, icon }); } }
    }
  }

  // QuickBooks' latest statements, every line by each of its amounts: this year's, last year's or the budget's column,
  // and the change between (QA round 9: a line found by last year's column showed only this year's, nothing marked)
  const stmts = books?.statements;
  if (stmts) {
    const bud = books.budget?.rows?.length && books.budget.asOf === stmts.asOf ? books.budget : null;
    const priorYear = String(stmts.priorAsOf || '').slice(0, 4);
    for (const [which, name, rows, when, then] of [
      ['act', 'on the statement of activities', stmts.activity, `January 1 to ${dayMonth(stmts.asOf)}`, `the same days in ${priorYear}`],
      ['bud', 'on the budget against actual', bud?.rows, bud ? `January 1 to ${dayMonth(bud.asOf)}` : '', 'its budget'],
      ['pos', 'on the statement of financial position', stmts.position, `as of ${dayMonth(stmts.asOf)}`, `a year before, as of ${shortDate(stmts.priorAsOf)}`],
    ]) (rows || []).forEach((r, i) => {
      if (r.k === 'head' || typeof r.a !== 'number' || !r.label) return;
      const other = which === 'bud' ? r.b : r.p;
      const cols = [];
      if (typeof other === 'number') {
        cols.push({ v: other, tail: `, ${then}, ${name}` });
        // (the change as its column has it in dollars: the budget's over (under), or on the year before)
        const d = lessWritten(r.a, other);
        // (over or under the budget as its column writes it, with its sign, "−$50,000": typed with it, found and marked)
        if (Math.round(d) !== 0) cols.push(which === 'bud' ? { v: d, head: d > 0 ? '+' : '', tail: ` ${d > 0 ? 'over' : 'under'} its budget, ${name}` } : { v: Math.abs(d), tail: ` ${d > 0 ? 'more' : 'less'} than ${then}, ${name}` });
      }
      put(`st:${which}:${i}`, r.a, { key: `st:${which}:${i}`, title: r.label, tail: `, ${name}, ${when}`, words: r.label, focus: `st-${which}-r${i}`, cols });
    });
  }

  // The tax return's year (Financials' "2025 at a glance")
  const s = data.snapshot;
  if (s) {
    const from = `, from the ${s.year} tax return`;
    const other = (s.totalRevenue || 0) - (s.contributions || 0) - (s.storeRevenue || 0);
    const left = (s.totalRevenue || 0) - (s.totalExpenses || 0);
    for (const [k, v, title, words] of [
      ['in', s.totalRevenue, `${s.year} money in`, 'revenue income total'], ['contrib', s.contributions, `${s.year} contributions`, 'contributions donations'], ['store', s.storeRevenue, `${s.year} store revenue`, 'store'],
      ['other', other > 0 ? other : null, `${s.year} everything else`, 'other revenue'], ['out', s.totalExpenses, `${s.year} money out`, 'expenses spending total'],
      ['programs', s.programExpenses, `${s.year} programs`, 'program expenses'], ['management', s.managementExpenses, `${s.year} management`, 'management expenses'], ['fundraising', s.fundraisingExpenses, `${s.year} fundraising`, 'fundraising expenses'],
      ['left', s.totalRevenue && s.totalExpenses ? left : null, `${s.year} ${left >= 0 ? 'left over' : 'spent beyond income'}`, 'net left over surplus deficit'], ['assets', s.netAssets, `${s.year} net assets at year end`, 'net assets year end'],
    ]) put(`tax:${k}`, v, { title, tail: from, words: `${words} tax return 990 at a glance`, focus: `gl-${k}` });
  }

  // Cash at each month's end (Cash over time: its chart, and "Month-end balances", each month's change on the one before
  // beside it), and the next 13 weeks: Financials draws them without QuickBooks. Each lands on its own line (Board QA
  // round 10: on the whole card, a month's −$20,000 marked the $20,000 of another figure too)
  const monthOf = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const hist = [...(data.cashHistory || [])].sort((a, b) => b.month.localeCompare(a.month));
  // (this month's, still under way, is so far this month, never a month's end, as the chart and the table say it:
  // ./money.js monthSoFar, Board QA round 11)
  const cashIn = (r) => (monthSoFar(r, data.today) ? `Cash so far this month, ${monthOf(r.month)}` : `Cash at the end of ${monthOf(r.month)}`);
  if (hist.length > 1) hist.forEach((r, i) => {
    const now = monthSoFar(r, data.today);
    put(`month:${r.month}`, r.total, { title: cashIn(r), tail: now ? `, as of ${dayMonth(r.at) || dayMonth(data.today)}, in Cash over time` : ', at the month’s end, in Cash over time', words: `cash month end balance ${monthOf(r.month)}${now ? ' so far this month now' : ''}`, focus: `cm-${r.month}` });
    const was = hist[i + 1];
    // (its way said as the table says it, with its sign, "−$11,250" or "+$11,000": typed with it, it's found and marked)
    const d = was ? lessWritten(r.total, was.total) : 0;
    if (Math.round(d)) put(`month:chg:${r.month}`, d, { title: `${cashIn(r)}, against the month before`, head: d > 0 ? '+' : '', tail: ` on ${monthOf(was.month)}, in Month-end balances`, words: `cash month end balance change month before ${monthOf(r.month)} up down`, focus: `cm-${r.month}-chg` });
  });
  const funded = !!data.numbers?.mercury && !data.numbers.mercury.empty;
  const f = funded && !books ? data.numbers.finance : null;
  if (f?.cash) {
    put('low', f.cash.lowest?.dollars, { ...WHAT('low'), tail: `${f.cash.lowest?.week ? `, the week of ${shortDate(f.cash.lowest.week)}` : ''}, the lowest point in the next 13 weeks`, focus: 'ct-low' });
    if (f.cash.cautiousLowest && f.cash.cautiousLowest.dollars !== f.cash.lowest?.dollars) put('low:cautious', f.cash.cautiousLowest.dollars, { title: 'Lowest ahead, a cautious guess', tail: ', in the next 13 weeks', words: 'lowest cautious forecast', focus: 'ct-low' });
    put('in13', f.cash.in13Weeks, { ...WHAT('in13'), focus: 'ct-in13' });
    if (f.cash.floor) put('floor', f.cash.floor, { title: 'The least we keep in the bank', tail: ', the floor the forecast is measured against', words: 'floor least keep minimum forecast', focus: 'ct-floor' });
  }
  // Without QuickBooks, Mercury's own record of the year, each line on its row (#io-in), what a makeover finished this
  // year cost on average, and month by month (Board QA round 10: those two were drawn and never found)
  if (!books && f?.ytd) {
    // (each as the table writes it: money out its three parts adding up, the net in less out: ./money.js ioOf)
    const rows = [['in', 'Money in', (p) => ioOf(p).in], ['out', 'Money out', (p) => ioOf(p).out], ['makeovers', 'Makeovers', (p) => ioOf(p).makeovers], ['store', 'The Sunny & Ranney store', (p) => ioOf(p).store], ['operating', 'Running SOARD', (p) => ioOf(p).operating], ['net', 'Net', (p) => ioOf(p).net]];
    for (const [k, label, val] of rows) {
      // (money in, out and the net as WHAT has them, the keys a meeting's tile writes them by: ./money.js moneyTiles)
      const own = WHAT(`io:${k}`);
      put(`io:${k}`, val(f.ytd), { title: `${label}, ${f.ytd.year} so far`, tail: ', Mercury’s record', words: `${label} mercury year so far`, ...(own.title !== `io:${k}` ? own : {}), focus: `io-${k}`, cols: f.lastYtd && typeof val(f.lastYtd) === 'number' ? [{ v: val(f.lastYtd), tail: `, ${label}, ${f.lastYtd.year}’s same days` }] : [] });
    }
    if (f.perMakeover?.average) put('io:per', f.perMakeover.average, { title: `A makeover finished in ${f.ytd.year}, on average`, tail: `, each of the ${plural(f.perMakeover.count, 'makeover')} finished this year, Mercury’s record`, words: 'average makeover finished this year each cost mercury', focus: 'io-note' });
    const short = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    for (const r of f.months || []) {
      for (const [k, label, v] of [['in', 'Money in', ioOf(r).in], ['out', 'Money out', ioOf(r).out], ['net', 'Net', ioOf(r).net]]) put(`io:m:${r.month}:${k}`, v, { title: `${label}, ${short(r.month)}`, tail: ', Mercury’s record, month by month', words: `${label} mercury month by month ${monthOf(r.month)}`, focus: `io-m-${r.month}-${k}` });
    }
  }

  // The meeting's money (its Financial item, and its slide on the screen): the next meeting's, each figure as its tile
  // writes it, landing on that tile (./portal.js CashBlock, #mt-<meeting>-<tile>), never the whole item (Board QA round
  // 11: on a phone, the item 2,000px tall, centered, put the figure above the screen)
  const m = [...(data.meetings || [])].filter((x) => x.date >= data.today).sort((a, b) => a.date.localeCompare(b.date)).find((x) => (x.sections || []).some((sec) => (sec.items || []).some((it) => showsOf(it).includes('cash'))));
  if (m) {
    const n = m.snapshot || data.numbers;
    const where = `, in the ${meetingName(m)}’s money`;
    fromTiles(moneyTiles({ cash, budget, n }), (t) => ({ href: `#/meetings/${m.id}`, focus: moneyTileId(m, t) }));
    for (const e of list) if (e.href === `#/meetings/${m.id}` && !e.tail.includes(where)) e.tail += where;
  }

  // Each major gift, by who gave it and its amount (by its amount alone when the givers' names couldn't be read)
  return [...list.map(entryOf), ...giftEntries(g, !lost.givers)];
}

/** The major gifts' total, as Financials draws it (#gifts-total), when the money's read failed and theirs didn't */
function giftsFound(data, names = true) {
  const g = data.gifts;
  if (!g?.count) return [];
  const total = { key: 'gifts', k: 'gifts', v: g.total / 100, title: 'Major gifts', head: '', tail: ` from ${plural(g.count, 'gift')} of $1,000 or more in ${g.year}`, words: 'major gifts zeffy donations donors total year', href: '#/financials', focus: 'gifts-total', short: null, said: new Set(), mark: '', cols: [], icon: 'financials' };
  return [entryOf(total), ...giftEntries(g, names)];
}
/**
 * Each major gift, by who gave it and its amount. `names` false: Keep anonymous couldn't be read, so every name is kept
 * hidden (functions/api/_board-gifts.js giftsNow, namesUnread): each by its amount and day alone, found by those, never
 * a name, a campaign or "Anonymous", which would say each giver chose it (Board QA round 12)
 */
function giftEntries(g, names = true) {
  return (g?.list || []).map((x) => {
    const v = x.cents / 100;
    const day = giftDay(x.at);
    const base = { group: 'Money', exact: true, key: `g:${x.id}`, date: x.at ? new Date(x.at * 1000).toISOString().slice(0, 10) : '', href: '#/financials/gifts', focus: `gift-${x.id}`, icon: 'financials', marks: marksOf(v) };
    if (!names) return { ...base, title: `A gift of ${money(v)}`, sub: [giftKind(x), day].filter(Boolean).join(' · '), hay: norm(['major gift', giftKind(x), amountWords(v)].join(' ')) };
    return { ...base, title: `${money(v)} from ${giftWho(x)}`, sub: [giftAbout(x), day].filter(Boolean).join(' · '), hay: norm([giftWho(x), x.name, x.company, x.campaign, 'gift', amountWords(v)].join(' ')) };
  });
}

/** Where a meeting's money tile is drawn (./portal.js CashBlock), and where a search for its figures lands */
export const moneyTileId = (m, t) => `mt-${m.id}-${t.k}`;

// (a gift as the board page names it: ./portal.js has the same)
const GIFT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const giftDay = (s) => GIFT_DAY.format(new Date(s * 1000));
export const giftWho = (g) => g.company || g.name || (g.anonymous ? 'Anonymous' : 'No name given');
export const giftAbout = (g) => [g.company && g.name ? g.name : '', g.campaign, g.every && !String(g.campaign || '').toLowerCase().includes(g.every) ? g.every : '', g.inKind ? 'in kind' : ''].filter(Boolean).join(' · ');
/** What a gift is without who gave it or what for (the givers' names not read): "monthly · in kind", '' for neither */
export const giftKind = (g) => [g.every || '', g.inKind ? 'in kind' : ''].filter(Boolean).join(' · ');

/** What to mark where a figure lands: its amount every way it's written there (exact, short, below zero with its sign) */
const marksOf = (v, said = []) => [...new Set(termsOf([dollars(v), money(Math.abs(v)), shortSigned(v), ...said].join(' ')))];

/**
 * A figure as a search entry (./moneyFigures): its line says its amount (a change with its way before it, "Up
 * $376,045"), and marks only it, the ways it's written where it lands (and `mark`, the words there that are it: a change
 * written there as a percent). Its other amounts in the same row (`cols`) are each found and said by themselves
 */
function entryOf(e) {
  const cols = [{ v: e.v, head: e.head, tail: e.tail, said: [...e.said] }, ...e.cols];
  const shortFor = (c) => (c === cols[0] && e.short ? e.short(c.v) : shortSigned(c.v));
  const line = (c, form) => `${c.head || ''}${joined(form ? `${dollars(c.v)}, or ${form}` : both(c.v, shortFor(c)), c.tail)}`;
  const base = `${e.title} ${e.words}`;
  const says = [];
  for (const c of cols) {
    // (a form a tile writes it in besides its exact and its short one, "$62K": its line says it that way)
    for (const s of c.said || []) if (!plainForm(s, c.v) && !(c === cols[0] && e.short && s === e.short(c.v))) says.push({ sp: prep(`${base} ${s}`), sub: line(c, s), marks: marksOf(c.v, [s]) });
    if (c !== cols[0]) says.push({ sp: prep(`${base} ${amountWords(c.v)} ${(c.said || []).join(' ')}`), sub: line(c), marks: marksOf(c.v, c.said) });
  }
  return {
    // (`exact`: its amounts are all in its words in full, so an amount typed exactly finds it by those alone, never by a
    // short form that rounds to it: "$25,000" isn't the $25,486 its line writes "$25K")
    group: 'Money', exact: true, key: e.key, title: e.title, sub: line(cols[0]), href: e.href, focus: e.focus, icon: e.icon,
    hay: norm([base, ...cols.flatMap((c) => [amountWords(c.v), ...(c.said || [])]), ...(e.short ? [e.short(e.v)] : [])].join(' ')),
    marks: [...new Set([...marksOf(e.v, [...e.said, ...(e.short ? [e.short(e.v)] : [])]), ...(e.mark ? termsOf(e.mark) : [])])],
    sp0: prep(`${base} ${amountWords(e.v)} ${e.short ? e.short(e.v) : ''}`),
    ...(says.length ? { says } : {}),
  };
}
