/**
 * books.js — the money as QuickBooks keeps it, beside last year
 * ===========================================================================
 * The money item on the board page (./portal.js), on the screen (./screen.js) and on paper (./print.js), drawn
 * from QuickBooks' own numbers (functions/api/_quickbooks.js) instead of statements attached as files:
 *
 *   YearCompare     the year so far against last year, month by month: revenue and expenses each a small chart
 *                   (this year solid, last year dashed, one axis each), a crosshair to read any month (pointer or
 *                   ← →), and the same numbers as a table
 *   StatementLines  a statement's main lines (activities, or financial position) beside the same day a year before
 *   BooksSlide      one of those as a slide, at the size of a room (deckOf's 'books' stops)
 *
 * Colors (checked with the dataviz validator, light on the page's cream and white, dark on the screen): this year
 * gold #8A6A00 / #B08F00, last year blue #2B6CB0 / #5994DA, last year dashed too, and every line named at its end.
 */

import { h, htm, useState, useEffect, useRef } from '../vendor.js';
import { money, mainLines, statementBreaks, linePlaces } from '../board-shared.js';
import { More, shortDate, dayText } from './parts.js';
import { compact, storeOf, storeChange, budgetMonthsText, marginText, changeIn, overIn, Both, Blank, budgetName, yearFigures, spentOf, nonCashName, nonCashOf, lessWritten } from './money.js';
import { lineKeysOf, notesByKey, NoteLine } from './review.js';
import { UNREAD_WORDS } from './unread.js';

const html = htm.bind(h);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayMonth = (d) => dayText(d, 'MD');

/** "▲ 25%" against last year ('Even', or '' with nothing to set it beside) */
export const changeWords = (a, p) => {
  if (!(typeof a === 'number' && typeof p === 'number' && p > 0)) return '';
  const c = Math.round(((a - p) / p) * 100);
  return c === 0 ? 'Even' : `${c > 0 ? '▲' : '▼'} ${Math.abs(c)}%`;
};

/**
 * Month by month, each added to the months before it: this year through the month it's in, last year all twelve.
 * Expenses leave out what never left the bank (in kind, depreciation) once the read has it by month, as the board's
 * figures do (`cash`); an older read has it in. Revenue leaves out its in-kind gifts the same way once the read has
 * them by month (`cashIn`: each month's nonCashIncome); before that it's QuickBooks' own, in kind in.
 * → { year, lastYear, upTo, cash, cashIn, revenue: { now, then }, spent: { now, then } } (arrays of 12, this year null after
 * upTo), or null without the months (an older read, a locked meeting's numbers from before they were kept)
 */
export function yearSeries(books) {
  const mo = books?.monthly;
  if (!mo?.months?.length) return null;
  const at = (m) => Number(String(m || '').slice(5, 7)) - 1;
  const upTo = Math.max(...mo.months.map((x) => at(x.month)).filter((i) => i >= 0 && i < 12));
  const cash = [...mo.months, ...(mo.last || [])].every((x) => typeof x.nonCash === 'number');
  const cashIn = cash && [...mo.months, ...(mo.last || [])].every((x) => typeof x.nonCashIncome === 'number');
  const run = (list, value, last) => {
    const by = Array(12).fill(0);
    for (const x of list || []) { const i = at(x.month); if (i >= 0 && i < 12) by[i] += value(x); }
    let t = 0;
    return by.map((v, i) => { t += v; return i <= last ? Math.round(t) : null; });
  };
  const rev = (x) => (Number(x.revenue) || 0) - (cashIn ? Number(x.nonCashIncome) || 0 : 0);
  const out = (x) => (Number(x.spent) || 0) - (cash ? Number(x.nonCash) || 0 : 0);
  const has = (mo.last || []).length > 0;
  return {
    year: mo.year || books.year || '', lastYear: mo.lastYear || books.lastYear?.year || '', upTo, cash, cashIn,
    revenue: { now: run(mo.months, rev, upTo), then: has ? run(mo.last, rev, 11) : null },
    spent: { now: run(mo.months, out, upTo), then: has ? run(mo.last, out, 11) : null },
  };
}

/** A round end for the axis: 1, 2, 2.5 or 5 times a power of ten, at or past `v` (over 0) */
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= v * 1.04) || 10 * p;
}
/** The axis: round ends past the highest and the lowest, $0 always on it; one mark, $0, for a year of nothing */
function axisOf(values) {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const top = hi > 0 ? niceMax(hi) : 0;
  const bottom = lo < 0 ? -niceMax(-lo) : 0;
  if (top === bottom) return { top: 1, bottom: 0, ticks: [0] };
  return { top, bottom, ticks: bottom < 0 ? (top > 0 ? [bottom, 0, top] : [bottom, bottom / 2, 0]) : [0, top / 2, top] };
}
/** Dollars with a real minus: "−$250,000" ('' with none) */
const sm = (v) => (typeof v !== 'number' ? '' : v < 0 ? `−${money(-v)}` : money(v));
/** A line's name free to wrap after each "/" too ("Individual/" "Corporate Revenue"), so on a phone it's never the
 *  longest word that sets how much room the figures have */
const wrapAt = (s) => String(s ?? '').split('/').map((x, i) => (i ? html`/<wbr />${x}` : x));
/** A table's cell of dollars, or its blank (a month still to come: "Not yet") */
const cellOf = (v, say = 'None') => (typeof v === 'number' ? sm(v) : html`<${Blank} say=${say} />`);

/**
 * One measure, this year against last, added up month by month, drawn at the size it's shown (its words stay their
 * size on a phone and in a room), on the axis it shares with its neighbor (`ax`, so revenue and expenses read against
 * each other). This year's last point is the year so far, at its own day in the month (a month two days in isn't a
 * flat line); last year beside it is its same days (`sameDays`, through `through`), and its line goes on to the end
 */
function YearLines({ id, title, now, then, year, lastYear, upTo, ax, sameDays = null, through = '', tall = false, as = 'pct' }) {
  const [at, setAt] = useState(-1);
  const [w, setW] = useState(0);
  // On the screen, the height left on its slide under the words above it (the chart never runs past the bottom)
  const [room, setRoom] = useState(0);
  const box = useRef(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const slide = tall ? el.closest('.by-slide') : null;
    const measure = () => {
      setW(Math.round(el.clientWidth));
      if (slide && getComputedStyle(slide).overflow === 'hidden') setRoom(Math.floor(slide.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 2));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (slide) ro.observe(slide);
    return () => ro.disconnect();
  }, []);
  // (before it's measured, and on paper: the width it's mostly shown at)
  const W = Math.max(260, w || 560);
  // On the screen, the words a room reads from its seats; on the page, the page's
  const fs = tall ? Math.round(Math.max(16, Math.min((typeof innerHeight === 'number' ? innerHeight : 800) * 0.0148, (typeof innerWidth === 'number' ? innerWidth : 1280) * 0.0083) * 1.75)) : 12;
  const H = tall ? Math.round(Math.max(room > 0 ? 140 : 220, Math.min(W * 0.62, room > 0 ? room : (typeof innerHeight === 'number' ? innerHeight : 800) * 0.5))) : Math.round(Math.max(180, Math.min(250, W * 0.5)));
  const tickText = (v) => (v ? compact(v) : '$0');
  // (room at the right for December's name, centered under its point)
  const pad = { l: Math.ceil(Math.max(...ax.ticks.map((v) => tickText(v).length)) * fs * 0.62) + 12, r: Math.max(14, Math.ceil(fs * 1.15)), t: Math.round(fs * 0.9), b: Math.round(fs * 2.3) };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const x = (i) => pad.l + (i / 11) * pw;
  const y = (v) => pad.t + ((ax.top - v) / (ax.top - ax.bottom)) * ph;
  // This year's last point at its day: the end of the month before, and the share of this month gone by
  const td = through && Number(through.slice(5, 7)) - 1 === upTo ? Number(through.slice(8, 10)) : 0;
  const inMonth = new Date(Date.UTC(Number(year) || 2001, upTo + 1, 0)).getUTCDate();
  const pos = (i) => (i === upTo && td ? Math.max(0, upTo - 1 + td / inMonth) : i);
  const xn = (i) => x(pos(i));
  const path = (list, xs) => list.map((v, i) => (v === null ? '' : `${i && list[i - 1] !== null ? 'L' : 'M'}${xs(i).toFixed(1)} ${y(v).toFixed(1)}`)).join(' ');
  // Last year's line where this year's point is (between its month ends, a straight line)
  const thenAt = (p) => { const i = Math.floor(p); const f = p - i; return i >= 11 || !f ? then[Math.min(11, i)] : then[i] + (then[i + 1] - then[i]) * f; };
  const nowEnd = now[upTo];
  const thenEnd = then ? then[11] : null;
  const same = then && typeof sameDays === 'number' && through ? sameDays : null;
  const said = `${title}: ${year} so far ${sm(nowEnd)}${then ? `, ${lastYear} ${same !== null ? `by ${dayMonth(through)} ${sm(same)}` : `by the end of ${MONTH[upTo]} ${sm(then[upTo])}`}, ${lastYear} in all ${sm(thenEnd)}` : ''}`;
  // The month being read: this year's against last year's by the same point. The year so far's own month sets it
  // beside last year's same days, then says last year's whole month too
  const cur = at === upTo && same !== null;
  const read = at >= 0 ? {
    month: at === upTo && through ? `${MONTH[at]} (through ${dayMonth(through)})` : MONTH[at],
    a: now[at], b: then ? (cur ? same : then[at]) : null, whole: cur ? then[at] : null,
  } : null;
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setAt(Math.max(0, Math.min(11, Math.round(((px - pad.l) / pw) * 11))));
  };
  const keys = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (e.key === 'Escape') { setAt(-1); return; }
    if (!step) return;
    e.preventDefault();
    setAt((i) => Math.max(0, Math.min(11, (i < 0 ? upTo : i) + step)));
  };
  // The note beside the month read, on whichever side has the room, never past the chart's edges (a phone's July)
  const place = (el) => {
    if (!el || at < 0) return;
    const width = el.parentElement.clientWidth;
    const tw = el.offsetWidth;
    const px = (xn(at) / W) * width;
    const right = px + 14;
    const left = px - 14 - tw;
    el.style.left = `${Math.max(0, Math.min(width - tw, right + tw <= width || width - px > px ? right : left))}px`;
  };
  // The month names a room can read: whole on a wide chart, the first letter on a narrow one
  const short = pw / 12 < fs * 2.1;
  return html`<div class="by-chart" ref=${box} onPointerMove=${pick} onPointerLeave=${() => setAt(-1)}>
    <svg viewBox=${`0 0 ${W} ${H}`} width=${W} height=${H} role="img" aria-labelledby=${`${id}-t`} tabindex="0" onKeyDown=${keys} onFocus=${() => setAt(upTo)} onBlur=${() => setAt(-1)} style=${`--fs:${fs}px`}>
      <title id=${`${id}-t`}>${said}</title>
      ${ax.ticks.map((v) => html`<g key=${v}><line class=${`by-grid ${v === 0 && ax.bottom < 0 ? 'is-zero' : ''}`} x1=${pad.l} x2=${W - pad.r} y1=${y(v)} y2=${y(v)} /><text class="by-axis" x=${pad.l - 8} y=${y(v) + fs * 0.35} text-anchor="end">${tickText(v)}</text></g>`)}
      ${MON.map((mo, i) => html`<text class=${`by-axis ${i === upTo ? 'is-now' : ''}`} key=${mo} x=${x(i)} y=${H - fs * 0.6} text-anchor="middle">${short ? mo.slice(0, 1) : mo}</text>`)}
      ${read ? html`<line class="by-guide" x1=${xn(at)} x2=${xn(at)} y1=${pad.t} y2=${H - pad.b} />` : null}
      ${then ? html`<path class="by-line by-line--then" d=${path(then, x)} />` : null}
      <path class="by-line by-line--now" d=${path(now, xn)} />
      ${then ? html`<circle class="by-dot by-dot--then" cx=${x(11)} cy=${y(thenEnd)} r="4" />` : null}
      <circle class="by-dot by-dot--now" cx=${xn(upTo)} cy=${y(nowEnd)} r="4.5" />
      ${read && then ? html`<circle class="by-dot by-dot--then" cx=${xn(at)} cy=${y(thenAt(pos(at)))} r="4" />` : null}
      ${read && read.a !== null ? html`<circle class="by-dot by-dot--now" cx=${xn(at)} cy=${y(read.a)} r="4.5" />` : null}
    </svg>
    ${read ? html`<div class="by-tip" ref=${place} aria-hidden="true">
      <strong>${read.month}</strong>
      ${read.a !== null ? html`<span><i class="by-key by-key--now"></i>${year} ${sm(read.a)}</span>` : html`<span class="by-tip__soft">${year}: not yet</span>`}
      ${read.b !== null ? html`<span><i class="by-key by-key--then"></i>${lastYear}${cur ? ` by ${dayMonth(through)}` : ''} ${sm(read.b)}${read.a !== null ? html` <b><${Both} as=${as} pct=${changeIn(read.a, read.b, 'pct')} usd=${changeIn(read.a, read.b, 'usd')} /></b>` : null}</span>` : null}
      ${read.whole !== null ? html`<span class="by-tip__soft">${lastYear}, all of ${MONTH[at]}: ${sm(read.whole)}</span>` : null}
    </div>` : null}
  </div>`;
}

/**
 * What the year's two charts end at, as their captions say it: this year so far, last year by the same day (its revenue
 * without its in-kind gifts, its expenses without in kind, once the months leave them out, as the year's figures have
 * them) and last year's whole. The captions are drawn from this and the search finds them by it (./figures.js).
 * → { s (./yearSeries), sameRev, sameExp, rev: { now, by, all }, exp: { now, by, all } } | null without the months
 */
export function yearEnds(books) {
  const s = yearSeries(books);
  if (!s) return null;
  const ly = books.lastYear;
  const through = books.through || '';
  const sameRev = typeof ly?.revenue !== 'number' ? null : !s.cashIn ? ly.revenue : yearFigures(books).last?.revenue ?? null;
  const sameExp = typeof ly?.expenses !== 'number' ? null : !s.cash ? ly.expenses : typeof ly.nonCash === 'number' ? lessWritten(ly.expenses, ly.nonCash) : null;
  // (this year's end is the year so far, as the figures have it: QuickBooks' month by month adds up to it; last year's
  // whole its full year's, counted the same way, else the months' own)
  const y = yearFigures(books);
  const nowRev = s.cashIn ? y.revenue : books.revenue;
  const nowExp = s.cash ? spentOf(books) : books.expenses;
  const fullExp = typeof ly?.full?.expenses !== 'number' ? null : !s.cash ? ly.full.expenses : typeof ly.full.nonCash === 'number' ? lessWritten(ly.full.expenses, ly.full.nonCash) : null;
  const end = (m, same, now, full) => ({ now: typeof now === 'number' ? now : m.now[s.upTo], by: typeof same === 'number' && through ? same : m.then?.[s.upTo] ?? null, all: m.then ? (typeof full === 'number' ? full : m.then[11]) : null });
  return { s, sameRev, sameExp, rev: end(s.revenue, sameRev, nowRev, s.cashIn ? null : ly?.full?.revenue), exp: end(s.spent, sameExp, nowExp, fullExp) };
}

/**
 * The year so far against last year, month by month: revenue and expenses side by side (two charts on one axis, so
 * the bigger reads bigger), each with its figures in words above it, the numbers as a table under, in a fold Back and
 * a reload keep open (./parts.js More, `${idp}-months`: Board QA round 11 found it the one fold that came back shut).
 * Null without the months
 */
export function YearCompare({ books, idp = 'by', tall = false, as = 'pct' }) {
  const ends = yearEnds(books);
  if (!ends) return null;
  const { s, sameRev, sameExp } = ends;
  const through = books.through || '';
  // What the revenue line has in it, when the figures above it leave in kind out
  const revSays = s.cashIn ? 'in kind left out' : yearFigures(books).inKind?.given > 0 ? 'in kind included, as the books have them' : '';
  // (what the expenses leave out, named as the page names it, for both years' lines: ./money.js nonCashName)
  const expSays = [nonCashName(yearFigures(books).inKind), nonCashOf(books.lastYear)].includes('in kind and depreciation') ? 'in kind and depreciation' : 'in kind';
  const ax = axisOf([s.revenue, s.spent].flatMap((m) => [...m.now, ...(m.then || [])]).filter((v) => v !== null));
  const lastAt = (series, same, i) => (i === s.upTo && typeof same === 'number' && through ? same : series?.[i] ?? null);
  const monthEnd = (i) => `${MONTH[i]} ${new Date(Date.UTC(Number(s.lastYear) || 2001, i + 1, 0)).getUTCDate()}`;
  // (each amount in the month-by-month table in a place of its own, #fy-m3-rl, where search lands on it: ./figures.js
  // monthCells, read from the same series)
  const lastCell = (series, same, i, id) => {
    const v = lastAt(series, same, i);
    const whole = series?.[i] ?? null;
    return html`<td class="num" id=${`${idp}-${id}`}>${cellOf(v)}${v !== whole && whole !== null ? html`<small class="by-table__whole" id=${`${idp}-${id}w`}>${sm(whole)} by ${monthEnd(i)}</small>` : null}</td>`;
  };
  // Above each chart, what its lines end at: this year so far, last year by the same day (with the change), its year
  const figs = (m, same, e) => {
    const { now: nowEnd, by } = e;
    return html`<span class="by-cap__figs"><span class="by-cap__now">${s.year} so far <b>${compact(nowEnd)}</b></span>${m.then ? html`<span class="by-cap__then">${s.lastYear} ${typeof same === 'number' && through ? `by ${dayMonth(through)}` : `by the end of ${MONTH[s.upTo]}`} <b>${compact(by)}</b>${changeIn(nowEnd, by, as, { short: true }) ? html` <em><${Both} as=${as} pct=${changeIn(nowEnd, by, 'pct', { short: true })} usd=${changeIn(nowEnd, by, 'usd', { short: true })} /></em>` : null} ·\u00a0${compact(e.all)}\u00a0in\u00a0all</span>` : null}</span>`;
  };
  return html`<section class="by" aria-label=${`${s.year} against ${s.lastYear}, month by month`}>
    <p class="by-legend" aria-hidden="true"><span><i class="by-key by-key--now"></i>${s.year} so far</span>${s.revenue.then ? html`<span><i class="by-key by-key--then"></i>${s.lastYear}</span>` : null}<span class="by-legend__how">Added up month by month, from QuickBooks</span></p>
    <div class="by-charts">
      <figure class="by-fig">
        <figcaption class="by-cap" id=${`${idp}-rev-cap`}><span class="by-cap__t">Revenue${revSays ? html`<small>${revSays}</small>` : null}</span>${figs(s.revenue, sameRev, ends.rev)}</figcaption>
        <${YearLines} id=${`${idp}-rev`} title="Revenue" now=${s.revenue.now} then=${s.revenue.then} year=${s.year} lastYear=${s.lastYear} upTo=${s.upTo} ax=${ax} sameDays=${sameRev} through=${through} tall=${tall} as=${as} />
      </figure>
      <figure class="by-fig">
        <figcaption class="by-cap" id=${`${idp}-exp-cap`}><span class="by-cap__t">Expenses<small>${s.cash ? `${expSays} left out` : 'in kind included, as the books have them'}</small></span>${figs(s.spent, sameExp, ends.exp)}</figcaption>
        <${YearLines} id=${`${idp}-exp`} title="Expenses" now=${s.spent.now} then=${s.spent.then} year=${s.year} lastYear=${s.lastYear} upTo=${s.upTo} ax=${ax} sameDays=${sameExp} through=${through} tall=${tall} as=${as} />
      </figure>
    </div>
    <${More} k=${`${idp}-months`} cls="by-table" summary="The numbers, month by month">
      <div class="by-table__scroll"><table>
        <thead><tr><th scope="col">By the end of</th><th scope="col" class="num">Revenue ${s.year}</th>${s.revenue.then ? html`<th scope="col" class="num">${s.lastYear}</th>` : null}<th scope="col" class="num">Expenses ${s.year}</th>${s.spent.then ? html`<th scope="col" class="num">${s.lastYear}</th>` : null}</tr></thead>
        <tbody>${MON.map((mo, i) => html`<tr key=${mo} class=${i === s.upTo ? 'is-now' : ''}><th scope="row">${MONTH[i]}${i === s.upTo && through ? html`<small> through ${dayMonth(through)}</small>` : null}</th>
          <td class="num" id=${`${idp}-m${i}-rn`}>${cellOf(s.revenue.now[i], 'Not yet')}</td>${s.revenue.then ? lastCell(s.revenue.then, sameRev, i, `m${i}-rl`) : null}
          <td class="num" id=${`${idp}-m${i}-en`}>${cellOf(s.spent.now[i], 'Not yet')}</td>${s.spent.then ? lastCell(s.spent.then, sameExp, i, `m${i}-el`) : null}</tr>`)}</tbody>
      </table></div>
    </${More}>
  </section>`;
}

/**
 * A statement's main lines (each heading, its total, the sums) or every line, beside the same day a year before.
 * `page`: one slide of them (board-shared.js statementBreaks, as the deck has them), a heading cut short there said
 * again, continued
 */
export function StatementLines({ rows, asOf, priorAsOf, all = false, cls = '', heads = null, which = '', notes = null, as = 'pct', page = -1 }) {
  if (!rows?.length) return null;
  const prior = rows.some((r) => r.p != null);
  // The presenter's notes (./review.js, which: 'act' | 'pos'), each under its line; a line with one is a main line too
  const said = notesByKey(notes);
  const keys = which && said.size ? lineKeysOf(rows, which) : [];
  const noteOf = (r) => (keys.length ? said.get(keys[rows.indexOf(r)]) : null);
  const whole = all ? rows : mainLines(rows, noteOf);
  let shown = whole;
  if (!all && page >= 0) {
    const breaks = statementBreaks(rows);
    const from = breaks[page] ?? Infinity;
    const to = breaks[page + 1] ?? Infinity;
    const at = linePlaces(rows, shown);
    const head = page > 0 ? rows.slice(0, Math.ceil(from)).findLast((r) => r.k === 'head' && r.d === 0) : null;
    shown = shown.filter((_, i) => at[i] >= from && at[i] < to);
    if (head && shown[0] && !(shown[0].k === 'head' && shown[0].d === 0)) shown = [{ ...head, label: `${head.label}, continued` }, ...shown];
  }
  const cols = prior ? 4 : 2;
  const signed = (v) => (typeof v === 'number' ? (v < 0 ? `(${money(-v)})` : money(v)) : '');
  // One unit down the change column: a percent only when every line has a base above zero to take it of, else dollars;
  // chosen over the whole statement, so its continued slides never change unit from the first
  const nums = whole.filter((r) => typeof r.a === 'number' && typeof r.p === 'number' && Math.round(r.a) !== Math.round(r.p));
  const unit = as !== 'usd' && nums.every((r) => r.p > 0) ? 'pct' : 'usd';
  // Each change both ways in its cell, the column as wide as the longer (money.js Both), so % | $ moves no column
  const pctUnit = nums.every((r) => r.p > 0) ? 'pct' : 'usd';
  const chgCell = (r, u) => (heads ? overIn(r.a, r.p, u) : changeIn(r.a, r.p, u));
  // (nothing to set it beside: a blank, said so to a screen reader)
  const chg = (r) => (chgCell(r, pctUnit) || chgCell(r, 'usd') ? html`<${Both} as=${unit} pct=${chgCell(r, pctUnit)} usd=${chgCell(r, 'usd')} />` : html`<${Blank} say="Nothing to compare" />`);
  return html`<table class=${`by-stmt ${cls}`}>
    <thead><tr><th scope="col"><span class="sr-only">Line</span></th><th scope="col" class="num">${heads ? heads[0] : shortDate(asOf)}</th>${prior ? html`<th scope="col" class="num">${heads ? heads[1] : shortDate(priorAsOf)}</th><th scope="col" class="num">${heads ? heads[2] : 'Change'}</th>` : null}</tr></thead>
    <tbody>${shown.map((r, i) => (r.k === 'head'
      ? html`<tr class="by-stmt__h" key=${i} data-d=${r.d}><th scope="colgroup" colspan=${cols}>${r.label}</th></tr>`
      : [html`<tr class=${`by-stmt__${r.k}`} key=${i} style=${`--d:${r.d}`} data-d=${r.k === 'sum' ? -1 : r.d} data-a=${Math.abs(Number(r.a) || 0)}><th scope="row">${wrapAt(r.label)}</th><td class="num">${signed(r.a)}</td>${prior ? html`<td class="num by-stmt__prior">${signed(r.p)}</td><td class="num by-stmt__chg">${chg(r)}</td>` : null}</tr>`,
        noteOf(r) ? html`<tr class="by-stmt__note" key=${`${i}-n`} style=${`--d:${r.d}`} data-d=${r.k === 'sum' ? -1 : r.d}><td colspan=${cols}><${NoteLine} note=${noteOf(r)} /></td></tr>` : null]))}</tbody>
  </table>`;
}

/**
 * A statement on the screen at a size a room reads (the deck gives it as many slides as its lines take), fitted to it
 * only past that: first to its width, every column on the screen (a phone's: the figures as much smaller as it takes,
 * the columns' long headers on two lines and the lines' names wrapped already, ./portal.css); then a little smaller
 * (to 90% of that) while it runs past the bottom, then as few lines off as it takes (the deepest first, the smallest
 * of those first; never a heading of the statement or its bottom lines), then as big again as the width lets it be; it
 * says how many are off and where every line is
 */
function FitLines(props) {
  const ref = useRef(null);
  const [off, setOff] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const over = () => el.scrollHeight > el.clientHeight + 1;
    // How much wider the table is than its box (over 1: a column past the screen's edge)
    const width = () => { const t = el.querySelector('table'); const w = el.getBoundingClientRect().width; return t && w > 0 ? t.getBoundingClientRect().width / w : 1; };
    // A line and the presenter's note under it go together
    const show = (r, on) => { r.hidden = !on; const n = r.nextElementSibling; if (n?.classList.contains('by-stmt__note')) n.hidden = !on; };
    const size = (k) => el.style.setProperty('--fit', String(k));
    const fit = () => {
      const rows = [...el.querySelectorAll('tr[data-d]:not(.by-stmt__note)')];
      rows.forEach((r) => show(r, true));
      let k = 1;
      size(k);
      // The width first: a table too wide is as wide as its figures, and they're sized in em, so it narrows with the
      // font; down to the size that fits (a hundredth at a time from there, never under half)
      const w = width();
      if (w > 1.001) {
        k = Math.max(0.5, Math.floor((k / w) * 100) / 100);
        size(k);
        while (k > 0.5 && width() > 1.001) { k = Math.round((k - 0.01) * 100) / 100; size(k); }
      }
      const top = k;
      while (k > top - 0.1 && over()) { k = Math.round((k - 0.05) * 100) / 100; size(k); }
      let hid = 0;
      const deep = rows.filter((r) => Number(r.dataset.d) >= 1).sort((x, y) => Number(y.dataset.d) - Number(x.dataset.d) || Number(x.dataset.a || 0) - Number(y.dataset.a || 0));
      for (const r of deep) { if (!over()) break; show(r, false); hid++; }
      // (never a line cut in half: smaller still, the last resort)
      while (k > Math.min(top, 0.6) && over()) { k = Math.round((k - 0.05) * 100) / 100; size(k); }
      // With lines off, back up toward the size the width allows while it still fits
      while (hid && k < top) { const up = Math.min(top, Math.round((k + 0.05) * 100) / 100); size(up); if (over()) { size(k); break; } k = up; }
      setOff(hid || (over() ? -1 : 0));
    };
    fit();
    // Again when its box changes (the window) and once the fonts are in; never on its own size (no loop)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    ro?.observe(el.parentElement);
    document.fonts?.ready.then(fit);
    return () => ro?.disconnect();
  }, [props.rows, props.as, props.page]);
  return html`<div class="by-fit" ref=${ref}><${StatementLines} ...${props} cls="is-big" /></div>${off ? html`<p class="by-fit__more">${off > 0 ? `${off} smaller ${off === 1 ? 'line' : 'lines'} left off here. ` : ''}Every line is on the board page</p>` : null}`;
}

/** What a 'books' stop is called (the chair's run of show, the screen's foot) */
export const BOOKS_TITLES = { year: 'The year against last year', store: 'The store', act: 'Statement of activities', budget: 'Budget against actual', pos: 'Statement of financial position' };
/** The same for one stop: a statement's second slide on is its title, continued */
export const booksTitle = (stop) => `${BOOKS_TITLES[String(stop?.fileId || '').slice(6)] || ''}${stop?.page ? ', continued' : ''}`;

/** One of QuickBooks' slides after the money, at the size of a room (the screen is dark: its colors are its own) */
export function BooksSlide({ books, kind, page = 0, notes = null, as = 'pct', lostNotes = false }) {
  const s = books?.statements;
  // (the notes on the lines not read just now: the slide says so, never its lines as if nobody had noted them: Board QA round 13)
  const lost = lostNotes ? html`<p class="bs-quiet by-slide__lost" role="status">${UNREAD_WORDS.lineNotes}</p>` : null;
  if (kind === 'store') {
    // Its sales on yellow, its cost of goods, the profit before the staff and rent the books keep with SOARD's
    const st = storeOf(books);
    return html`<div class="by-slide by-slide--store">
      <p class="bs-eyebrow">From QuickBooks${books.through ? `, January 1 to ${dayMonth(books.through)}` : ''}</p>
      <h1 class="bs-display by-slide__title">The store, ${st?.lastYear ? `${books.year} against ${st.lastYear}` : `${books.year} so far`}</h1>
      ${st ? html`<ul class="bs-figs" style="--n:3">${st.lines.map((x) => html`<li key=${x.k}>
        <span class="bs-figs__label">${x.name}</span><span class="bs-figs__value">${compact(x.amount)}</span><span class="bs-figs__sub">${x.last != null ? html`${st.lastYear} by now: ${compact(x.last)} · <${Both} as=${as} pct=${storeChange(x, 'pct')} usd=${storeChange(x, 'usd')} />` : `${books.year} so far`}</span>${x.k === 'profit' && st.margin != null ? html`<span class="bs-figs__sub">${marginText(st)}</span>` : null}
      </li>`)}</ul>` : null}
    </div>`;
  }
  if (kind === 'year') {
    // Without the months (a read from before them): the year so far against last year's same days, as the figures
    // have them (./money.js yearFigures: in kind left out of both)
    const ser = yearSeries(books);
    return html`<div class="by-slide">
      <p class="bs-eyebrow">From QuickBooks${books.through ? `, January 1 to ${dayMonth(books.through)}` : ''}</p>
      <h1 class="bs-display by-slide__title">${books.year} against ${books.lastYear?.year || 'last year'}</h1>
      ${ser ? html`<${YearCompare} books=${books} idp="bys" tall as=${as} />` : html`<${FitLines} all as=${as} rows=${[
        { k: 'line', d: 0, label: 'Revenue', a: yearFigures(books).revenue, p: yearFigures(books).last?.revenue ?? null },
        { k: 'line', d: 0, label: 'Expenses', a: yearFigures(books).expenses, p: yearFigures(books).last?.expenses ?? null },
      ]} asOf=${books.through} priorAsOf=${books.lastYear?.through} />`}
    </div>`;
  }
  if (kind === 'budget') {
    // QuickBooks' budget (the board's) against the actuals, to the statements' day: the main lines, over (under) beside each
    const b = books?.budget;
    return html`<div class="by-slide">
      <p class="bs-eyebrow">${budgetName(b, books?.year)}, January 1 to ${dayMonth(b?.asOf)}${b ? `: ${budgetMonthsText(b.months)} of ${b.of} months` : ''}</p>
      <h1 class="bs-display by-slide__title">Budget against actual${page ? ', continued' : ''}</h1>
      ${lost}
      <${FitLines} rows=${(b?.rows || []).map((r) => ({ ...r, p: r.b }))} heads=${['Actual', 'Budget', 'Over (under)']} which="bud" notes=${notes} as=${as} page=${page} />
    </div>`;
  }
  const act = kind === 'act';
  const rows = act ? s?.activity : s?.position;
  return html`<div class="by-slide">
    <p class="bs-eyebrow">${act ? `From QuickBooks, January 1 to ${dayMonth(s?.asOf)}, beside the same days a year before` : `From QuickBooks, as of ${dayMonth(s?.asOf)}, beside the same day a year before`}</p>
    <h1 class="bs-display by-slide__title">${act ? 'Statement of activities' : 'Statement of financial position'}${page ? ', continued' : ''}</h1>
    ${lost}
    <${FitLines} rows=${rows} asOf=${s?.asOf} priorAsOf=${s?.priorAsOf} which=${act ? 'act' : 'pos'} notes=${notes} as=${as} page=${page} />
  </div>`;
}
