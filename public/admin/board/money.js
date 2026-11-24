/**
 * The money as the board page shows it (./portal.js Home and Financials, a meeting's Financial item, and the
 * screen, ./screen.js): the cash, live from the banks once one holds SOARD's money (numbers.cash), else the bank
 * accounts on the newest Statement of Financial Position in a meeting's packet; and the year against its budget,
 * from the newest "budget & actual" sheet. Both read in the browser from QuickBooks' Excel copies. Once QuickBooks
 * itself is connected (Settings → QuickBooks, numbers.books), the year's revenue and expenses so far are
 * its own, read hourly, against the same sheet's budget.
 */

import { h, htm, useState, useEffect } from '../vendor.js';
import { money, todayEastern, unzip } from '../board-shared.js';
import { nbw, shortDate } from './parts.js';

const html = htm.bind(h);

const fileUrl = (f) => `/api/board-file?id=${encodeURIComponent(f.id)}`;
const isExcel = (f) => /sheet|excel|csv/i.test(String(f?.type || '')) || /\.(xlsx?|csv)$/i.test(String(f?.name || ''));
const monthOf = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// ─── Cash: live from the banks, else QuickBooks, else the newest balance sheet ───
// Once a bank is connected (Chase through Plaid in Settings, Mercury once it holds the money), the cash is theirs
// (numbers.cash). With QuickBooks connected (Settings → QuickBooks), it's the bank accounts on the books, read hourly
// (numbers.books.cash). Else it's the bank-account total on the newest Statement of Financial Position in a meeting's
// packet (QuickBooks' Excel copy), read in the browser
export const compact = (n) => {
  const a = Math.abs(n);
  // (no minus on what rounds to nothing: "$0", never "−$0")
  const s = n <= -0.5 ? '−' : '';
  if (a < 1e4) return `${s}${money(a)}`;
  // Rounded to the step its unit is said at, which can carry it to the next unit: $999,700 is "$1M", $999,950,000
  // "$1B", never "$1000K" or "$1000M" (Board QA round 11)
  const units = [['K', 1e3, () => 0], ['M', 1e6, (x) => (x >= 10 ? 1 : 2)], ['B', 1e9, (x) => (x >= 10 ? 1 : 2)]];
  let u = a >= 1e9 ? 2 : a >= 1e6 ? 1 : 0;
  let said = '';
  for (; u < units.length; u++) {
    const [, size, places] = units[u];
    const x = a / size;
    said = x.toFixed(places(x));
    if (Number(said) < 1000 || u === units.length - 1) break;
  }
  return `${s}$${said.includes('.') ? said.replace(/\.?0+$/, '') : said}${units[u][0]}`;
};
/**
 * An amount as a figure (the money's tiles): whole dollars with a true minus, "−$48,210"; from $10M up the short
 * form, "$1.4B", so a figure always fits its tile
 */
export const amount = (n) => (typeof n !== 'number' || !Number.isFinite(n) ? '' : Math.abs(n) >= 1e7 ? compact(n) : `${n <= -0.5 ? '−' : ''}${money(Math.abs(n))}`);
// (the step compact rounds an amount to: whole dollars under $10K, thousands under $1M, then $10K, $100K...)
const stepOf = (v) => { const a = Math.abs(v); return a >= 1e10 ? 1e8 : a >= 1e9 ? 1e7 : a >= 1e7 ? 1e5 : a >= 1e6 ? 1e4 : a >= 1e4 ? 1e3 : 1; };
/** An amount already rounded to `step`, said at that step: compact's own words when they say it exactly */
function atStep(v, step) {
  const own = stepOf(v);
  if (Math.round(v / own) * own === v) return compact(v);
  const s = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (step < 1e3) return `${s}${money(a)}`;
  if (step < 1e4) return `${s}$${(a / 1e3).toLocaleString('en-US')}K`;
  return `${s}$${(a / 1e6).toFixed(Math.max(0, 6 - Math.round(Math.log10(step))))}M`;
}
/**
 * An amount as the page writes it, to the dollar: what money() shows ($45.50 is "$46", half a dollar away from zero),
 * its sign kept. Real money has cents (Mercury's balances, QuickBooks' figures: Board QA round 12), so a figure worked
 * out from others on the page is worked out from them as written (./lessWritten), never from their cents
 */
export const asWritten = (n) => (typeof n === 'number' && Number.isFinite(n) ? (n < 0 ? -1 : 1) * Math.round(Math.round(Math.abs(n) * 100) / 100) || 0 : n);
/** One figure less another, as both are written (revenue less expenses is the net: $1,656,049 less $980,000 is $676,049) */
export const lessWritten = (a, b) => (typeof a === 'number' && typeof b === 'number' ? asWritten(a) - asWritten(b) : null);
/**
 * Parts rounded to `step` (whole dollars unless said) so they add up to their total written the same way: each rounded
 * down, then the largest remainders up (a tie to the first) until they make it. The total is `total` as it's written
 * when the parts can make it so (it's theirs, give or take their cents), else their own sum's. Board QA round 12: with
 * cents, Operating $312,500.49 and Reserve $62,500.49 read "$312,500" and "$62,500" beside "$375,001" → the parts'
 * amounts, in order
 */
export function addingUp(values, { total = null, step = 1 } = {}) {
  const vals = (values || []).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  if (!vals.length) return [];
  // (in cents, so no part's float noise moves a remainder)
  const per = Math.round(step * 100);
  const cents = vals.map((v) => Math.round(v * 100));
  const out = cents.map((c) => Math.floor(c / per));
  // (what's over each one's step, in whole cents: two that are the same tie, the first first)
  const rest = cents.map((c, i) => c - out[i] * per);
  const floor = out.reduce((t, f) => t + f, 0);
  const rounds = (c) => (c < 0 ? -1 : 1) * Math.round(Math.abs(c) / per);
  const own = rounds(cents.reduce((t, c) => t + c, 0));
  const want = typeof total === 'number' && Number.isFinite(total) ? rounds(Math.round(total * 100)) : own;
  let left = (want - floor >= 0 && want - floor <= vals.length ? want : own) - floor;
  const order = rest.map((r, i) => [r, i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out.map((n) => n * step);
}
/**
 * Parts said rounded that add up to their total said the same way (QA round 7: "$375,000 / Operating $313K · Reserve
 * $63K", which reads as $376K): each at the step the smallest of them is said at (./compact), rounded by the largest
 * remainder (./addingUp), so they sum to their total (`total`, as it's written beside them) rounded to that step,
 * never a dollar off it → each one's words, in order
 */
export function partsAddingUp(values, { total = null } = {}) {
  const vals = (values || []).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  if (!vals.length) return [];
  const step = Math.min(...vals.map(stepOf));
  return addingUp(vals, { total, step }).map((n) => atStep(n, step));
}
/**
 * What a meeting's money, Financials and search say of the year's money that never left the bank, in expenses: "in kind
 * and depreciation" when more went out that way than came in as gifts in kind (QuickBooks' non-cash expenses, its
 * NON_CASH accounts: in kind, donated, depreciation, amortization; in kind is taken in and used at the same value), "in
 * kind" when it's the in kind alone. One name everywhere (Board QA round 12: the tile said $228K "in kind", $8K of it
 * depreciation, beside "in kind and depreciation" on the same page). `k`: { given, used } (./yearFigures inKind)
 */
export const nonCashName = (k) => (k && k.used >= 0.5 && !(k.given >= 0.5 && Math.round(k.used) <= Math.round(k.given)) ? 'in kind and depreciation' : 'in kind');
/** The same for a year of QuickBooks (numbers.books, or its lastYear): its expenses' non-cash, by what it gave in kind */
export const nonCashOf = (b) => nonCashName({ given: inKindOf(b?.sources), used: typeof b?.nonCash === 'number' ? b.nonCash : 0 });
/**
 * The end of a period that runs to `through` (a day), as the page says it: this month's to its day, so far ("through
 * November 23"), a month that's over by its name ("through October"). Board QA round 12: Mercury's year on the
 * meeting's tile said "through November" on November 23, where Financials said the day
 */
export function throughWords(through, today = todayEastern()) {
  const d = String(through || '');
  if (!/^\d{4}-\d{2}/.test(d)) return '';
  const month = new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  return d.slice(0, 7) === String(today || '').slice(0, 7) && /^\d{4}-\d{2}-\d{2}/.test(d) ? `through ${month} ${Number(d.slice(8, 10))}` : `through ${month}`;
}
/**
 * A budget sheet's year, from its heading or its name: "FY2026", "FY 2026", "FY26" and "FY'26" (the fiscal year ending
 * in 2026, said "FY2026"), "2025-26", "2025/2026" and "2025–2026" (said "2025-26"), or a calendar year ("2026 Budget").
 * → { year: the year it ends in, label: its fiscal name ('' for a calendar year) }, both '' when none can be read (Board
 * QA round 12: "FY2026 Budget" read as no year, the tiles' year blank and the heading "against its budget")
 */
export function sheetYear(...texts) {
  for (const t of texts) {
    const s = String(t ?? '');
    const fy = s.match(/\bFY\s?'?(\d{4}|\d{2})(?!\d)/i);
    if (fy) { const y = fy[1].length === 2 ? `20${fy[1]}` : fy[1]; return { year: y, label: `FY${y}` }; }
    const span = s.match(/(?<!\d)(20\d{2})\s*[-–/]\s*(20\d{2}|\d{2})(?!\d)/);
    if (span) {
      const end = span[2].length === 2 ? `${span[1].slice(0, 2)}${span[2]}` : span[2];
      if (Number(end) === Number(span[1]) + 1) return { year: end, label: `${span[1]}-${end.slice(2)}` };
    }
    const one = s.match(/(?<!\d)(20\d{2})(?!\d)/);
    if (one) return { year: one[1], label: '' };
  }
  return { year: '', label: '' };
}
/**
 * The budget card's heading: "2026 against its budget", "FY2026 against its budget"; with no year the sheet says, a
 * whole sentence in its own case, never a fragment or a year guessed (Board QA round 12: "against its budget")
 */
export const budgetHeading = (year) => (year ? `${year} against its budget` : 'The budget, against what’s come in');
/** A year's figure as a tile names it: "2026 revenue", "FY2026 expenses", or "Revenue" with no year to say (never a guess) */
export const yearLabel = (yr, word) => (yr ? `${yr} ${word}` : word.replace(/^./, (c) => c.toUpperCase()));
function balanceSheet(data, upTo = '') {
  return data.meetings.filter((m) => !upTo || m.date <= upTo).flatMap((m) => m.files.filter((f) => f.kind === 'financials' && isExcel(f) && /financial position|balance sheet/i.test(f.name)).map((f) => ({ f, m })))
    .sort((a, b) => b.m.date.localeCompare(a.m.date) || String(b.f.at || '').localeCompare(String(a.f.at || '')))[0] || null;
}
/** An .xlsx's first sheet as rows of cells, each at its column (A = 0): strings and numbers */
async function sheetGrid(bytes) {
  const z = await unzip(bytes, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  const dec = new TextDecoder();
  const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const strings = [...dec.decode(z['xl/sharedStrings.xml'] || new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheet = dec.decode(z['xl/worksheets/sheet1.xml'] || new Uint8Array());
  const colOf = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const raw = (c[3] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? (c[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      const v = /t="s"/.test(c[2]) ? strings[Number(raw)] ?? '' : /t="(inlineStr|str)"/.test(c[2]) ? unxml(raw) : raw === '' ? '' : Number(raw);
      if (v !== '') row[colOf(c[1])] = typeof v === 'string' ? v.trim() : v;
    }
    return row;
  });
}
/** The same, each row's cells side by side (no gaps) */
const sheetRows = async (bytes) => (await sheetGrid(bytes)).map((r) => r.filter((x) => x !== undefined));
const fetchBytes = async (f) => { const r = await fetch(fileUrl(f)); if (!r.ok) throw new Error(`HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
/** "1001 SR4_Long Reserve (8861)" → "Long Reserve": no ledger number, no account's last digits */
const accountName = (s) => String(s).replace(/^\d+\s+/, '').replace(/^SR\d+_/i, '').replace(/\s*\(\d{3,}\)\s*$/, '').replace(/_/g, ' ').trim();
const cashOnce = new Map();
function readCash(data, upTo = '') {
  const src = balanceSheet(data, upTo);
  if (!src) return Promise.resolve(null);
  if (!cashOnce.has(src.f.id)) cashOnce.set(src.f.id, (async () => {
    const rows = await sheetRows(await fetchBytes(src.f));
    const asOf = rows.flat().filter((x) => typeof x === 'string').map((x) => x.match(/^As of (.+?)(?: \(PY\))?$/)?.[1]).filter(Boolean);
    const head = rows.findIndex((r2) => /^bank accounts$/i.test(String(r2[0])));
    const totalAt = rows.findIndex((r2) => /^total (for )?(bank accounts|cash( and cash equivalents)?)$/i.test(String(r2[0])));
    if (totalAt < 0 || typeof rows[totalAt][1] !== 'number') return null;
    const accounts = head >= 0 ? rows.slice(head + 1, totalAt).filter((r2) => typeof r2[1] === 'number').map((r2) => ({ name: accountName(r2[0]), balance: r2[1], prior: typeof r2[2] === 'number' ? r2[2] : null })) : [];
    return { total: rows[totalAt][1], prior: typeof rows[totalAt][2] === 'number' ? rows[totalAt][2] : null, asOf: asOf[0] || '', priorAsOf: asOf.find((x, i) => i > 0 && x !== asOf[0]) || '', accounts, meeting: src.m, file: src.f };
  })().catch(() => null).then((v) => { cashRead.set(src.f.id, v); return v; }));
  return cashOnce.get(src.f.id);
}
// (each balance sheet's cash once it's read, for what can't wait for it: ./cashKnown)
const cashRead = new Map();
function useCash(data, upTo = '') {
  const [cash, setCash] = useState(undefined);
  useEffect(() => { let on = true; readCash(data, upTo).then((c) => { if (on) setCash(c); }); return () => { on = false; }; }, [upTo]);
  return cash;
}
export const andText = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] || '');
/**
 * A bank's account as the board reads it: "Chase SR2_Makeover" → "Chase Makeover" (SOARD's SR1–SR5 numbering, as the
 * balance sheet drops it), and with two banks each says its own ("Mercury Opex" beside "Chase Opex"). Two that would
 * read the same keep the bank's own names
 */
function bankNames(list, banks) {
  const named = list.map((a) => {
    const bank = a.bank || 'Mercury';
    const n = String(a.name || '').replace(/\bSR\d+_/gi, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || String(a.name || '');
    return { ...a, name: banks.length > 1 && !n.toLowerCase().startsWith(bank.toLowerCase()) ? `${bank} ${n}` : n };
  });
  return named.map((a, i) => (named.filter((b) => b.name === a.name).length > 1 ? { ...a, name: list[i].name } : a));
}
/** The banks' own numbers (numbers.cash) in the balance sheet's shape, with the month a year back from the history */
export function liveCash(data) {
  const c = data.numbers.cash;
  if (!(c?.total > 0)) return null;
  // As of the oldest read among them: Plaid's refresh of Chase can be hours older than Mercury's live answer
  const at = String(c.banksAt && c.banksAt < c.at ? c.banksAt : c.at || '');
  const day = at ? todayEastern(Date.parse(at)) : '';
  const ym = day.slice(0, 7);
  const then = ym ? (data.cashHistory || []).find((r) => r.month === `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`) : null;
  const banks = [...new Set((c.accounts || []).map((a) => a.bank || 'Mercury'))];
  return {
    live: true, total: c.total, asOf: day ? shortDate(day) : '', today: day === todayEastern(), at, prior: then ? then.total : null, priorAsOf: then ? monthOf(then.month) : '',
    accounts: bankNames(c.accounts || [], banks), owed: bankNames((c.owed || []).filter((o) => o.balance > 0), banks), banks, stale: c.stale || [],
  };
}
/**
 * QuickBooks' bank accounts as last read (numbers.books.cash, or a past meeting's locked books), in the banks' shape,
 * with the month a year back and the months of cash it holds
 */
export function booksCash(data, b) {
  const c = b?.cash;
  if (!c || typeof c.total !== 'number') return null;
  const at = String(c.at || b.at || '');
  const day = at ? todayEastern(Date.parse(at)) : '';
  const ym = day.slice(0, 7);
  const then = ym ? (data.cashHistory || []).find((r) => r.month === `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`) : null;
  return {
    live: true, total: c.total, asOf: day ? shortDate(day) : '', today: day === todayEastern(), at, prior: then ? then.total : null, priorAsOf: then ? monthOf(then.month) : '',
    accounts: c.accounts || [], owed: (c.owed || []).filter((o) => o.balance > 0), banks: ['QuickBooks'], stale: b.stale ? ['QuickBooks'] : [],
    months: typeof b.monthsOfCash === 'number' ? b.monthsOfCash : null, perMonth: b.perMonth || null,
  };
}
/**
 * The cash card's lines, one list for the card (./portal.js CashCard) and the search (./figures.js): with two or more
 * accounts, each one holding at least 1% of the cash by its name (#cash-a<its place among the accounts>), and beside
 * five or more the smaller ones together on one line (#cash-a-rest), every line rounded so they add up to the cash as
 * it's written (./addingUp). One account is the cash itself: no lines. Board QA round 12: one account and four small
 * ones drew no lines at all while search sent "the smaller accounts together" to a line never drawn
 * → [{ id, k, name, names, balance, said, rest }]
 */
export function cashLines(cash) {
  const held = (cash?.accounts || []).map((a, i) => ({ a, i })).filter(({ a }) => typeof a.balance === 'number' && Math.abs(a.balance) >= 0.005);
  if (held.length < 2) return [];
  const small = held.length > 4 ? held.filter(({ a }) => a.balance < cash.total * 0.01) : [];
  // (a single small one is a line of its own, by its name: "together" takes two)
  const together = small.length > 1 ? small : [];
  const lines = [
    ...held.filter((x) => !together.includes(x)).map(({ a, i }) => ({ id: `cash-a${i}`, k: `cash:${a.bank || ''}:${a.name}`, name: a.name || 'Account', names: [a.name || 'Account'], balance: a.balance, rest: false })),
    ...(together.length ? [{ id: 'cash-a-rest', k: 'cash:small', name: andText(together.map(({ a }) => a.name || 'Account')), names: together.map(({ a }) => a.name || 'Account'), balance: together.reduce((t, { a }) => t + a.balance, 0), rest: true }] : []),
  ];
  const said = addingUp(lines.map((l) => l.balance), { total: cash.total });
  return lines.map((l, j) => ({ ...l, said: said[j] }));
}
/** 16.8 → "17", 8.46 → "8.5": months of cash, to a tenth under ten; what rounds to none (or less) "Under a month" */
export const monthsText = (m) => { const r = m >= 10 ? Math.round(m) : Math.round(m * 10) / 10; return r > 0 ? String(r) : 'Under a month'; };
/** The same in a sentence: "Under a month", "1 month", "8.5 months" (the board page's "… of spending") */
export const monthsPhrase = (m) => { const t = monthsText(m); return t === 'Under a month' ? t : `${t} ${t === '1' ? 'month' : 'months'}`; };
/** "From QuickBooks, as of 3:05 PM" (today) or "…, as of Oct 28": where the cash comes from when it's the books' */
export const fromBooks = (cash) => (cash?.banks?.length === 1 && cash.banks[0] === 'QuickBooks'
  ? `From QuickBooks, as of ${cash.today ? new Date(cash.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : shortAsOf(cash.asOf)}` : '');
/**
 * Home's cash figure: a bank's live balances once one holds SOARD's money, else QuickBooks', else the newest balance
 * sheet's. `upTo` (a past meeting's date) keeps to the balance sheet that meeting had, never today's
 */
export function useCashNow(data, upTo = '', n = null) {
  const sheet = useCash(data, upTo);
  const now = !upTo || upTo >= todayEastern();
  return cashToShow(now ? liveCash(data) : null, sheet, booksCash(data, now ? data.numbers?.books : n?.books));
}
/**
 * A bank's live balances speak for SOARD only once they hold its money: a bank besides Mercury (Chase through
 * Plaid), or Mercury holding at least half what the newest balance sheet has in the bank. QuickBooks is the books,
 * so its bank accounts come next, before the balance sheet and before Mercury on its own (a test deposit, the first
 * transfer). Else the balance sheet's figure stands. `sheet` is undefined while it's read
 */
function cashToShow(live, sheet, books = null) {
  if (live && live.banks.some((b) => b !== 'Mercury')) {
    // The cards: each bank's own, and QuickBooks' for a card no connected bank reads (Ramp; Chase's until it's shared)
    const read = [...new Set(live.owed.map((o) => String(o.bank || '').toLowerCase()).filter(Boolean))];
    const owed = [...live.owed, ...(books?.owed || []).filter((o) => !read.some((b) => String(o.name).toLowerCase().includes(b)))];
    // The banks' cash, and how many months of QuickBooks' spending it holds (the books' 12 months out, whichever bank)
    return { ...live, owed, ...(books?.perMonth > 0 ? { months: Math.round((live.total / books.perMonth) * 10) / 10, perMonth: books.perMonth } : {}) };
  }
  if (books) return books;
  if (sheet === undefined) return undefined;
  if (!live) return sheet;
  return !sheet || live.total >= sheet.total * 0.5 ? live : sheet;
}
/**
 * The cash as the board shows it (./useCashNow), when it can be said now: the banks', QuickBooks', or the balance
 * sheet's once it's been read (it's asked for meanwhile); null till then. For what can't wait on it (the search)
 */
export function cashKnown(data) {
  const src = balanceSheet(data);
  const sheet = !src ? null : cashRead.has(src.f.id) ? cashRead.get(src.f.id) : undefined;
  if (sheet === undefined) readCash(data);
  return cashToShow(liveCash(data), sheet, booksCash(data, data.numbers?.books)) || null;
}
/**
 * Whether a row of month-end cash (data.cashHistory: the heartbeat's, or QuickBooks' months) is this month's, still
 * under way: its balance is so far this month, never a month's end, wherever it's shown (Board QA round 11: Month-end
 * balances and search called November's on November 23 "at the month's end")
 */
export const monthSoFar = (r, today = todayEastern()) => !!r?.month && String(r.month) === String(today || '').slice(0, 7);
/** "Nov 2, 2026" → "Nov 2", the month and day never apart on two lines */
export const shortAsOf = (s) => String(s || '').replace(/, \d{4}$/, '').replace(/^([A-Za-z]{3,9}\.?) (\d)/, '$1\u00a0$2');

// The year against its budget: the newest "budget & actual" sheet in a meeting's packet (SOARD's own layout: a
// heading row naming the Budgeted and Actual columns, then "Revenue Total", "Total Expenses", "Program Total"…)
const budgetOnce = new Map();
/** The budget sheet the year is read from: the newest in a meeting's packet (up to `upTo`) */
const budgetSheetOf = (data, upTo = '') => data.meetings.filter((m) => !upTo || m.date <= upTo).flatMap((m) => m.files.filter((f) => isExcel(f) && /budget/i.test(f.name)).map((f) => ({ f, m })))
  .sort((a, b) => b.m.date.localeCompare(a.m.date) || String(b.f.at || '').localeCompare(String(a.f.at || '')))[0] || null;
/** Whether there's a budget to come while it's read (its figures' places are kept, so nothing moves when they arrive) */
export const budgetDue = (data, upTo = '') => !!budgetSheetOf(data, upTo);
function readBudget(data, upTo = '') {
  const src = budgetSheetOf(data, upTo);
  if (!src) return Promise.resolve(null);
  if (!budgetOnce.has(src.f.id)) budgetOnce.set(src.f.id, (async () => {
    const grid = await sheetGrid(await fetchBytes(src.f));
    // The heading row names Budget and Actual in two different cells (the title above says both in one)
    const colOf = (r, re) => r.findIndex((c) => re.test(String(c ?? '')));
    const head = grid.findIndex((r) => { const b = colOf(r, /budget/i); const a = colOf(r, /actual/i); return b >= 0 && a >= 0 && a !== b; });
    if (head < 0) return null;
    const bCol = colOf(grid[head], /budget/i);
    const aCol = colOf(grid[head], /actual/i);
    // A row's label is its first words (SOARD's sheet starts in column B), its numbers sit under the headings
    const label = (r) => String(r.find((c) => typeof c === 'string') ?? '');
    const line = (re) => {
      const r = grid.find((x) => re.test(label(x)));
      return r && typeof r[bCol] === 'number' && typeof r[aCol] === 'number' ? { budget: r[bCol], actual: r[aCol] } : null;
    };
    // Its year, from the budget's heading, else the sheet's title above it, else the file's name (./sheetYear): the year
    // it ends in, and its own name for it when that's a fiscal year ("FY2027", "2026-27")
    const yr = sheetYear(grid[head][bCol], ...grid.slice(0, head).flat().filter((c) => typeof c === 'string'), src.f.name);
    const out = {
      // (as the tiles and the heading say it, its fiscal name when it has one; `calYear` the year it ends in)
      year: yr.label || yr.year, calYear: yr.year,
      label: yr.label,
      asOf: String(grid[head][aCol]).replace(/^actual\s*(as of\s*)?/i, '').trim(),
      revenue: line(/^(revenue total|total revenue|total income)\b/i),
      expenses: line(/^(total expenses|expense total|expenses total)\b/i),
      programs: line(/^program(s)? total\b/i),
      meeting: src.m, file: src.f,
    };
    return out.revenue || out.expenses ? out : null;
  })().catch(() => null).then((v) => { budgetRead.set(src.f.id, v); return v; }));
  return budgetOnce.get(src.f.id);
}
// (each budget sheet once it's read, for what can't wait on it: ./budgetKnown)
const budgetRead = new Map();
/**
 * The year against its budget as the board page shows it (./useBudget), when it can be said now: QuickBooks' own
 * budget, or the packet's sheet once it's been read (it's asked for meanwhile: undefined till then). For what can't wait
 * on it (the search: ./figures.js)
 */
export function budgetKnown(data) {
  const books = booksFor(data);
  const own = booksBudget(books);
  if (own) return withBooks(own, books);
  const src = budgetSheetOf(data);
  if (!src) return withBooks(null, books);
  if (!budgetRead.has(src.f.id)) { readBudget(data); return undefined; }
  return withBooks(budgetRead.get(src.f.id), books);
}

// The year so far from QuickBooks itself (numbers.books, read hourly once it's connected), for today and meetings
// ahead; a past meeting keeps to the books locked into it (n, its snapshot), else its own packet
const booksFor = (data, upTo = '', n = null) => (!upTo || upTo >= todayEastern() ? data.numbers?.books || null : n?.books || null);
/**
 * Whether a budget sheet is for QuickBooks' current year: its "Actual as of" day falls in that fiscal year (SOARD's
 * starts in August, so a calendar year in the heading can't say). A sheet without a readable day goes by its year
 */
function sameYear(sheet, books) {
  if (!sheet) return false;
  // "September 30, 2026" reads as that day's midnight where the page is open: its own year, month and day
  const d = new Date(Date.parse(String(sheet.asOf || '')));
  if (Number.isFinite(d.getTime()) && books.from && books.through) {
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return day >= books.from && day <= books.through;
  }
  return (sheet.calYear || sheet.year || String(sheet.meeting?.date || '').slice(0, 4)) === books.year;
}
// (one figure less another as both are written, to the dollar: what's worked out from figures on the page adds up with
// them as they read, Board QA round 12)
const less = lessWritten;
/**
 * The year's expenses the way SOARD's budget counts them: QuickBooks' less what never left the bank (the in-kind gifts
 * it takes in and uses at the same value, and depreciation: numbers.books.nonCash). A read from before it kept that
 * (or a meeting's numbers locked then) gives QuickBooks' own
 */
export const spentOf = (books) => (typeof books?.nonCash === 'number' ? less(books.expenses, books.nonCash) : books?.expenses);
/**
 * QuickBooks' revenue and expenses so far in place of the sheet's actuals. The budget beside them stays the
 * sheet's, and only for the same fiscal year: a new year's figures are never measured against last year's budget
 */
/** The year's in-kind gifts among its revenue (QuickBooks' categories, ./mixOf) */
const inKindOf = (sources) => (sources || []).filter((x) => x.key === 'inkind').reduce((t, x) => t + x.amount, 0);
/**
 * The year so far as three figures that add up, the way the figures above them count it (./withBooks): revenue
 * without its in-kind gifts, expenses without what never left the bank (in kind, depreciation: ./spentOf), and the net
 * between the two; last year's same days the same way. A read from before the books kept what never left the bank
 * gives QuickBooks' own three. → { revenue, expenses, net, last: { revenue, expenses, net } | null, inKind: { given,
 * used } | null, books: { revenue, expenses, net } (QuickBooks' own, in kind in) }
 */
export function yearFigures(books) {
  const ly = books?.lastYear || null;
  // (each net the revenue less the expenses beside it, as written: QuickBooks' own Net Income only without them)
  const netOf = (x) => (typeof x?.revenue === 'number' && typeof x?.expenses === 'number' ? less(x.revenue, x.expenses) : typeof x?.net === 'number' ? x.net : null);
  const own = { revenue: books?.revenue ?? null, expenses: books?.expenses ?? null, net: netOf(books) };
  const lyNet = netOf;
  if (typeof books?.nonCash !== 'number') {
    return { ...own, last: ly ? { revenue: ly.revenue ?? null, expenses: ly.expenses ?? null, net: lyNet(ly) } : null, inKind: null, books: own };
  }
  const given = inKindOf(books.sources);
  const revenue = less(books.revenue, given);
  const expenses = spentOf(books);
  // (last year's the same way only once its read kept both: its categories and what never left its bank)
  const lyRev = ly && Array.isArray(ly.sources) ? less(ly.revenue, inKindOf(ly.sources)) : null;
  const lyExp = typeof ly?.nonCash === 'number' ? less(ly.expenses, ly.nonCash) : null;
  return {
    revenue, expenses, net: less(revenue, expenses),
    last: ly ? { revenue: lyRev, expenses: lyExp, net: less(lyRev, lyExp) } : null,
    inKind: given > 0 || books.nonCash > 0 ? { given, used: books.nonCash } : null, books: own,
  };
}
/** What the year's figures leave out, said once: "Not counting the $220K in kind on either side." ('' with none) */
export function inKindWords(k) {
  if (!k) return '';
  if (k.given > 0 && Math.round(k.given) === Math.round(k.used)) return `Not counting the ${compact(k.given)} in kind on either side.`;
  return `Not counting ${andText([k.given > 0 ? `${compact(k.given)} given in kind` : '', k.used > 0 ? `${compact(k.used)} of ${nonCashName(k)} in expenses` : ''].filter(Boolean))}.`;
}
/**
 * A QuickBooks budget in words, never its file name ("Budget_FY26_P&L"): "QuickBooks’ 2026 budget"; one that isn't a
 * calendar year by its months ("QuickBooks’ budget for August 2026 to July 2027"). `bud`: { from, to } when known
 */
export function budgetName(bud, year = '') {
  const from = String(bud?.from || '');
  const to = String(bud?.to || '');
  const ym = (d) => new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (/^\d{4}-01-01$/.test(from) && (!to || to.slice(0, 4) === from.slice(0, 4))) return `QuickBooks’ ${from.slice(0, 4)} budget`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) return `QuickBooks’ budget for ${ym(from)} to ${ym(to)}`;
  return /^\d{4}$/.test(String(year)) ? `QuickBooks’ ${year} budget` : 'QuickBooks’ budget';
}
/**
 * Nothing to show in a table's cell: blank to the eye, said to a screen reader (`say`). Never a dash, which a screen
 * reader reads out as "en dash"
 */
export const Blank = ({ say = 'None' }) => html`<span class="bp-blank"><span class="sr-only">${say}</span></span>`;
export function withBooks(sheet, books) {
  if (!books || typeof books.revenue !== 'number') return sheet;
  const same = sameYear(sheet, books);
  // Beside each: last year's same days, and its whole year (how far along last year was by now)
  const ly = books.lastYear;
  const line = (actual, x, last, lastFull) => ({ actual, budget: same && x ? x.budget : null, last: typeof last === 'number' ? last : null, lastFull: typeof lastFull === 'number' ? lastFull : null });
  // Expenses as SOARD's budget counts them, without in kind (last year's the same way, once the daily read has it)
  const lyCash = typeof books.nonCash !== 'number' ? [ly?.expenses, ly?.full?.expenses]
    : typeof ly?.nonCash === 'number' && typeof ly?.full?.nonCash === 'number' ? [less(ly.expenses, ly.nonCash), less(ly.full.expenses, ly.full.nonCash)] : [null, null];
  // One revenue, counted one way: the year so far's (./yearFigures), its in-kind gifts left out whenever QuickBooks
  // says what's in kind, whatever the budget is (QuickBooks', a sheet's) or with none, so the tiles, The year so far,
  // the mix and the search have the same figure and revenue less expenses is the net (Board QA round 11: with no budget
  // the tile's $1.88M kept the in kind the net beside it left out). Last year's same days the same way, to set it
  // beside; how far along last year was by now (its pace, a share) is its whole revenue's, as QuickBooks has it, since
  // its whole year's in kind isn't read
  const yf = yearFigures(books);
  const given = yf.inKind?.given || 0;
  const revenue = typeof books.nonCash === 'number'
    ? { ...line(yf.revenue, sheet?.revenue, yf.last?.revenue, null), ...(ly?.full?.revenue > 0 && typeof ly.revenue === 'number' ? { share: ly.revenue / ly.full.revenue } : {}), ...(given > 0 ? { inKind: given } : {}) }
    : line(books.revenue, sheet?.revenue, ly?.revenue, ly?.full?.revenue);
  return {
    year: same && sheet.label ? sheet.label : books.year, asOf: shortDate(books.through), live: true, at: books.at,
    revenue,
    expenses: { ...line(spentOf(books), sheet?.expenses, ...lyCash), inKind: books.nonCash > 0 ? books.nonCash : 0 }, programs: null,
    meeting: sheet?.meeting || null, file: sheet?.file || null, qbo: sheet?.qbo || '',
  };
}
/**
 * How far along last year was by this day, as a share of its whole year (0.75), for a figure against its budget: its
 * same days over its whole year, or the share kept when its whole year isn't counted the same way (./withBooks); null
 * with neither
 */
export const paceOf = (x) => (x?.last != null && x.lastFull > 0 ? x.last / x.lastFull : typeof x?.share === 'number' ? x.share : null);
export function useBudget(data, upTo = '', n = null) {
  const books = booksFor(data, upTo, n);
  const own = booksBudget(books);
  const [b, setB] = useState(undefined);
  useEffect(() => { if (own) return undefined; let on = true; readBudget(data, upTo).then((x) => { if (on) setB(x); }); return () => { on = false; }; }, [upTo, !!own]);
  if (own) return withBooks(own, books);
  // While the sheet is read, its budget is still to come: the figures wait for it rather than showing twice
  return b === undefined ? b : withBooks(b, books);
}
/**
 * QuickBooks' own budget for the books' year (functions/api/_quickbooks.js budgetOf: the board's budget since Nov 2
 * 2026), as a budget sheet reads (./withBooks): the year's revenue, and its spending without the in kind, the way SOARD's
 * budget counts expenses. Null without one for that year (then the packet's sheet, as before)
 */
export function booksBudget(books) {
  if (!books?.year) return null;
  // This year's in brief (the daily read's budgetNow), else the statements' own when it's this year's
  const now = books.budgetNow?.year === books.year ? books.budgetNow : null;
  const st = !now && books.budget?.from === `${books.year}-01-01` ? { name: books.budget.name, ...books.budget.totals } : null;
  const t = now || st;
  if (!(t?.revenue > 0)) return null;
  return { year: books.year, label: '', asOf: '', revenue: { budget: Math.max(0, t.revenue - (t.nonCashIncome || 0)) }, expenses: { budget: Math.max(0, t.spending - (t.nonCash || 0)) }, programs: null, meeting: null, file: null, qbo: t.name };
}
export const pctOf = (x) => (x?.budget ? Math.round((x.actual / x.budget) * 100) : null);
/** "31% by now last year": how much of last year's whole year had come in (or gone out) by this day, beside this year's share of its budget */
export const paceText = (x) => (x?.budget && paceOf(x) != null ? `${Math.round(paceOf(x) * 100)}% by now last year` : '');
/** "▲ 12% on last year by now": this year's so far against last year's same days, when there's no budget to measure by */
export const growthText = (x, as = 'pct') => {
  if (!(x?.last > 0)) return '';
  const c = changeIn(x.actual, x.last, as, { short: true });
  return c === 'Even' ? 'Even with last year by now' : `${c} on last year by now`;
};

/**
 * A figure as it's written, kept with what it is (`k`) and its amount, so the words drawn and the search's come from
 * one call (./figures.js: QA round 9 found figures drawn that search didn't have). → (k, v, fmt) → the words
 */
export const writer = (figs) => (k, v, fmt = compact) => { const said = fmt(v); figs.push({ k, v, said }); return said; };
/** A change in dollars as written ("▲ $45K"), its figure kept by `$`; '' when it rounds to nothing (the caller says Even) */
const moved = ($, k, a, p) => (asWritten(a) === asWritten(p) ? '' : `${a > p ? '▲' : '▼'} ${$(k, Math.abs(lessWritten(a, p)))}`);
/**
 * A meeting's money as figures, for its Financial item and the screen: the cash, the year's revenue and expenses
 * against the budget, and (once Mercury holds SOARD's money, so its record is the books') the year's net and the
 * lowest the forecast goes. `cash` and `budget` are undefined while they're read. A bank account below zero says so,
 * "Overdrawn", in a plain tile (`quiet`: never the celebratory first one). → [{ k, label, value, sub, tone, quiet,
 * figs: [{ k, v, said }] (each figure in it as it's written: ./figures.js finds them by these) }]
 */
/** "August 3, 2026" → ", as of Aug 3" ('' when there's no date) */
const asOfWords = (s) => { const t = Date.parse(String(s || '')); return Number.isFinite(t) ? `, as of ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).replace(' ', '\u00a0')}` : s ? `, ${s}` : ''; };
/**
 * Mercury's record of a stretch (finance.ytd, its last year, a month) as Financials' "Money in and out" writes it: money
 * out is its three parts (makeovers, the store, running SOARD), each rounded so they add up to it as written
 * (./addingUp), and the net is money in less money out as written (Board QA round 12) → { in, out, makeovers, store,
 * operating, net }
 */
export function ioOf(p) {
  if (!p) return null;
  const parts = [p.makeovers || 0, p.store || 0, p.operating || 0];
  const out = asWritten(parts.reduce((t, x) => t + x, 0));
  const [makeovers, store, operating] = addingUp(parts, { total: out });
  return { in: asWritten(p.income || 0), out, makeovers, store, operating, net: lessWritten(p.income || 0, out) };
}
/**
 * Where the year's money went, by purpose (QuickBooks' classes, numbers.books.functions), as Financials draws it and
 * search finds it: the first three by name, the rest together as Everything else (when it's half a percent or more),
 * each rounded so they add up to the total as written (./addingUp) → { total, list: [{ name, amount, said, i, tone,
 * rest }] } | null
 */
export function wentParts(f) {
  if (!(f?.total > 0)) return null;
  const named = (f.list || []).slice(0, 3);
  const rest = Math.max(0, f.total - named.reduce((t, p) => t + p.amount, 0));
  const list = [...named.map((p, i) => ({ ...p, i, tone: ['a', 'b', 'd'][i], rest: false })), ...(rest >= f.total * 0.005 ? [{ name: 'Everything else', amount: rest, tone: 'c', rest: true }] : [])];
  const said = addingUp(list.map((p) => p.amount), { total: f.total });
  return { total: asWritten(f.total), list: list.map((p, j) => ({ ...p, said: said[j] })) };
}
export function moneyTiles({ cash, budget, n, due = false, as = '' }) {
  const out = [];
  const tile = (t, fill) => { const figs = []; out.push({ ...t, ...fill(writer(figs)), figs }); };
  if (cash !== null) {
    // (overdrawn by what rounds to nothing is $0 in the bank; a total that isn't a figure says so, never a blank tile)
    const over = !!cash && cash.total <= -0.5;
    tile({ k: 'bank', label: over ? 'Overdrawn' : 'Cash in the bank', quiet: over, tone: cash && cash.prior != null && Math.round(cash.total) !== Math.round(cash.prior) ? (cash.total > cash.prior ? 'up' : 'down') : '' }, ($) => {
      // (against a year before: the pick's way, % or $; "Even" when it rounds to nothing, as every change is)
      const year = () => (as === 'pct' && cash.prior > 0 ? changeIn(cash.total, cash.prior, 'pct', { short: true }) : moved($, 'cash:chg', cash.total, cash.prior) || 'Even');
      return {
        value: !cash ? '…' : Number.isFinite(cash.total) ? $('cash', cash.total, (v) => amount(Math.abs(v))) : 'Not known',
        sub: !cash ? 'From the balance sheet' : fromBooks(cash) || (cash.live
          // (each account rounded so they add up to the cash beside them: ./partsAddingUp)
          // (and each kept for search as it's written to the dollar, the card's own figure: ./cashLines)
          ? [(cash.accounts || []).length > 1 ? ((each) => partsAddingUp(each, { total: cash.total }).map((w, i) => `${cash.accounts[i].name} ${$(`cash:${cash.accounts[i].bank || ''}:${cash.accounts[i].name}`, each[i], () => w)}`).join(' · '))(addingUp(cash.accounts.map((a) => a.balance), { total: cash.total })) : '', cash.asOf ? `as of ${shortAsOf(cash.asOf)}` : ''].filter(Boolean).join(', ')
          : `${cash.asOf ? `As of ${shortAsOf(cash.asOf)}` : 'From the balance sheet'}${cash.prior != null ? ` · ${((c) => (c === 'Even' ? 'Even with a year before' : `${c} on a year`))(year())}` : ''}`),
      };
    });
  }
  // How long the cash would last at the last 12 months' cash spending (QuickBooks')
  if (cash?.months != null) tile({ k: 'months', label: 'Months of cash', value: monthsText(cash.months) }, ($) => ({ sub: cash.perMonth ? `At ${$('cash:month', cash.perMonth)} a month, the last 12 months’ cash out` : 'At the last 12 months’ cash out' }));
  const yr = budget?.year || '';
  // While a budget sheet is read: its two figures' places, so the tiles never move when they arrive
  // (QuickBooks' figures at once when it's connected, as Home has them; the budget's share follows)
  const books = typeof n?.books?.revenue === 'number' ? n.books : null;
  // (the revenue counted as it will be once the budget is in, ./yearFigures: the figure never changes when it arrives)
  // (no year guessed while a sheet is read: QuickBooks' when it's connected, else none till the sheet says its own)
  if (budget === undefined && (due || books)) for (const [k, word, v] of [['rev', 'revenue', books ? yearFigures(books).revenue : null], ['exp', 'expenses', books ? spentOf(books) : null]]) tile({ k, label: yearLabel(books?.year || '', word), pct: 0, sub: '\u00a0' }, ($) => ({ value: typeof v === 'number' ? $(k, v, amount) : '…' }));
  for (const [k, x, word] of [['rev', budget?.revenue, 'revenue'], ['exp', budget?.expenses, 'expenses']]) {
    if (!x) continue;
    // (against last year's same days in dollars, the pick's way, when there's no budget to measure by)
    const growth = ($) => { if (as !== 'usd') return growthText(x, as || 'pct'); if (!(x.last > 0)) return ''; const c = moved($, `${k}:chgly`, x.actual, x.last); return c ? `${c} on last year by now` : 'Even with last year by now'; };
    tile({ k, label: yearLabel(yr, word), pct: pctOf(x) }, ($) => ({
      value: $(k, x.actual, amount),
      sub: [x.budget ? [`${pctOf(x)}% of the ${$(`${k}:bud`, x.budget)} budget${asOfWords(budget.asOf)}`, paceText(x)].filter(Boolean).join(' · ') : growth($) || `The year so far${asOfWords(budget.asOf)}`, x.inKind ? `not counting ${$(k === 'rev' ? 'inkind' : 'exp:nc', x.inKind)} ${k === 'rev' ? 'in kind' : nonCashOf(books || n?.books)}` : ''].filter(Boolean).join(' · '),
    }));
  }
  const f = n?.finance;
  // Mercury's own record (the year so far, the forecast) only once its banks are the cash shown
  if (cash?.live && cash.banks?.includes('Mercury') && !n?.mercury?.empty && f?.ytd) {
    // (each figure keyed as Financials' "Money in and out" keys it, io:net, io:in, io:out, so search has it once:
    // Board QA round 11 found each twice, this tile's and Financials' row; each as that table writes it, ./ioOf, and
    // this month's end said so far, ./throughWords: Board QA round 12)
    const io = ioOf(f.ytd);
    if (!budget?.revenue) tile({ k: 'ytd', label: `${f.ytd.year} so far`, tone: io.net >= 0 ? 'up' : 'down' }, ($) => ({ value: $('io:net', io.net, (v) => `${v >= 0.5 ? '+' : ''}${amount(v)}`), sub: `${$('io:in', io.in)} in · ${$('io:out', io.out)} out, ${throughWords(f.ytd.through)}` }));
    if (f.cash?.lowest) tile({ k: 'low', label: 'Lowest ahead', tone: f.cash.belowFloor ? 'down' : '' }, ($) => ({ value: $('low', f.cash.lowest.dollars, amount), sub: `${f.cash.lowest.week ? `Week of ${shortDate(f.cash.lowest.week).replace(/, \d{4}$/, '')}` : 'In the forecast'} · ${$('in13', f.cash.in13Weeks)} in 13 weeks` }));
  }
  return out;
}

/** The cash and the budget at once, outside a component (Print it all): { cash, budget }, each null when there's none */
export async function moneyFor(data, upTo = '', n = null) {
  // QuickBooks' own budget when the books have one for their year (as Home and the screen), else the packet's sheet
  const books = booksFor(data, upTo, n);
  const own = booksBudget(books);
  const [sheet, budget] = await Promise.all([readCash(data, upTo), own ? null : readBudget(data, upTo)]);
  const now = !upTo || upTo >= todayEastern();
  return { cash: cashToShow(now ? liveCash(data) : null, sheet, booksCash(data, now ? data.numbers?.books : n?.books)) || null, budget: withBooks(own || budget, books) };
}
/** How a budget's months read: "10", "9.5" */
export const budgetMonthsText = (m) => String(Math.round(m * 10) / 10);
/** How QuickBooks keeps a budget, said after its months: by the month says nothing more */
export const stepText = (step) => (step === 3 ? ', each quarter’s figure spread over its months' : step === 12 ? ', each month an even share of the year (QuickBooks keeps one figure for it)' : '');

// ─── Where the revenue came from: QuickBooks' income accounts by category (functions/api/_quickbooks.js sourcesOf) ───
// Home, a meeting's money item and Financials (./portal.js), the screen (./screen.js) and Print it all (./print.js).
// Each category keeps its color wherever it shows (the dark screen has the same hues stepped for it), checked together
// for lightness, strength and color-blind separation; two are light on white, so every part also carries its name and
// amount. An account outside them takes a color left free; whatever is left over is Everything else, in gray
const MIX_TONE = { donations: 1, store: 2, gala: 3, inkind: 4, grants: 5 };
/**
 * Whether the year's revenue is said without its in-kind gifts, as the revenue figure beside it says it (./withBooks,
 * ./yearFigures): whenever QuickBooks says what's in kind, with a budget or without one ("Not counting $220K in kind").
 * Board QA round 11: with no budget the mix counted in kind as 12% of a revenue the figures beside it left it out of
 */
export const inKindLeftOut = (books) => (yearFigures(books).inKind?.given || 0) > 0;
/**
 * The year's revenue as parts, in their colors' order: the categories of 2% or more (five at most), then Everything
 * else; each with the same days last year when the daily read has them. The same revenue as the figure above it, so
 * its shares are of that: in kind left out when that leaves it out (./inKindLeftOut, `inKind` the amount), last
 * year's the same way. Null before QuickBooks' categories are in (a read kept by an older deploy, or a past meeting's
 * locked numbers)
 *
 * The parts are the money that came in (`came`): the categories above zero, their shares of their own total, adding up
 * to 100%. A category below zero (refunds: functions/api/_quickbooks.js sourcesOf keeps it) is never a part: it's
 * `less`, said under the mix by its own name (./mixLessWords), so the parts less it are the revenue beside them (QA
 * round 9: dropped, the shares beside a $1,000,000 revenue added up to 102% and the bar ran past its end). What the
 * categories don't account for is said the same way below zero (a read kept from before they kept those), else it's
 * in Everything else
 */
export function mixOf(books) {
  const all = books?.sources || [];
  if (!all.length || !all.every((x) => x.key)) return null;
  const out = inKindLeftOut(books);
  const inKind = out ? inKindOf(all) : 0;
  const src = out ? all.filter((x) => x.key !== 'inkind') : all;
  // (the revenue as the figures beside it write it, in kind left out as written: ./lessWritten)
  const total = typeof books?.revenue === 'number' ? lessWritten(books.revenue, inKind) : null;
  const sum = (list) => list.reduce((t, x) => t + x.amount, 0);
  const pos = src.filter((x) => x.amount > 0);
  if (!pos.length || !(total > 0)) return null;
  const neg = src.filter((x) => x.amount < 0);
  const gap = Math.round((total - sum(pos) - sum(neg)) * 100) / 100;
  const came = sum(pos) + Math.max(0, gap);
  const less = [...neg.map((x) => ({ key: x.key, name: x.name, amount: -x.amount, accounts: x.accounts || [] })), ...(gap <= -0.5 ? [{ key: 'below', name: '', amount: -gap, accounts: [] }] : [])];
  const big = pos.filter((x) => x.amount >= came * 0.02);
  const free = [1, 2, 3, 4, 5].filter((t) => !big.some((x) => MIX_TONE[x.key] === t));
  const named = big.map((x) => ({ ...x, tone: MIX_TONE[x.key] || free.shift() })).filter((x) => x.tone).sort((a, b) => a.tone - b.tone);
  const lys = books.lastYear?.sources?.every((x) => x.key) ? books.lastYear.sources : null;
  const lyOf = (key) => (lys ? lys.find((x) => x.key === key)?.amount || 0 : null);
  const parts = named.map((x) => ({ ...x, last: lyOf(x.key) }));
  // Everything else, whenever anything is in it: the parts are every category above zero, so they always add up to the
  // money that came in (Board QA round 10: Interest's $4,000 of $1,000,000 was dropped, under 0.5%, so the parts added
  // up to $996,000 and search sent its $4,000 to a row never drawn). Its share is "under 1%" when it rounds below
  // (./sharesOf)
  const rest = came - sum(named);
  if (rest >= 0.5) {
    const left = pos.filter((x) => !named.some((n) => n.key === x.key));
    // (last year's the same way: its categories above zero that aren't named this year, and what they don't account
    // for above zero; its in kind left out when this year's leaves it out)
    const lyPos = lys ? lys.filter((x) => x.amount > 0 && !(out && x.key === 'inkind')) : null;
    const lyGap = lys ? books.lastYear.revenue - (out ? inKindOf(lys) : 0) - sum(lys.filter((x) => !(out && x.key === 'inkind'))) : 0;
    const lastRest = lys ? sum(lyPos.filter((x) => !named.some((n) => n.key === x.key))) + Math.max(0, lyGap) : null;
    parts.push({ key: 'rest', name: 'Everything else', amount: rest, tone: 0, accounts: left.map((x) => x.name), last: lastRest });
  }
  let at = 0;
  const whole = sum(parts);
  const shares = sharesOf(parts.map((x) => x.amount), whole);
  // Each part as it's written (`said`, whole dollars), rounded so the parts less what's below zero make the revenue
  // beside them as it's written, never a dollar off it (./addingUp; Board QA round 12: with cents, $700,000 + $415,000
  // + $400,000 + $90,000 + $51,047 made $1,656,047 beside a revenue of $1,656,049)
  const lessSaid = less.map((x) => ({ ...x, said: asWritten(x.amount) }));
  const said = addingUp(parts.map((x) => x.amount), { total: total + lessSaid.reduce((t, x) => t + x.said, 0) });
  return { total, came: whole, less: lessSaid, inKind, year: books.year, lastYear: books.lastYear?.year || '', parts: parts.map((x, i) => { const w = (x.amount / whole) * 100; const mid = at + w / 2; at += w; return { ...x, said: said[i], w, mid, share: shares[i] }; }) };
}
/**
 * The mix's parts in short, as Home's key writes them: each its own written amount (`said`) in short, as the table beside
 * it on Financials writes it in full. (Each in its own unit: "$1M" beside "$3", never one part's unit forced on all,
 * Board QA round 11's "$1M")
 */
export const mixShort = (mix) => (mix ? mix.parts.map((x) => compact(x.said)) : []);
/**
 * What the revenue is less than its parts, in words under the mix: "Less $20,000 in Refunds." ('' with nothing below
 * zero). `fmt`: how its amounts are written, as the parts beside it are (Home's in short)
 */
export function mixLessWords(mix, fmt = money) {
  const l = mix?.less || [];
  if (!l.length) return '';
  return `Less ${andText(l.map((x) => `${fmt(x.said ?? x.amount)} in ${x.name || 'income accounts below zero'}`))}.`;
}
/**
 * Each part's share of their whole, in whole percents that add up to 100, as partsAddingUp does for amounts (QA round
 * 8: Donations 42%, Store sales 25%, Gala 24%, Grants 5% and Everything else 3% read as 99% of the revenue, Grants'
 * 5.43 rounded on its own): rounded down, then the largest remainders up until they make the whole. A part above
 * nothing and under 1% is said so → each one's words, in order
 */
export function sharesOf(amounts, total) {
  const ps = (amounts || []).map((a) => (total > 0 && Number.isFinite(Number(a)) ? (Number(a) / total) * 100 : 0));
  const out = ps.map((p) => Math.floor(p + 1e-9));
  let left = Math.round(ps.reduce((t, p) => t + p, 0)) - out.reduce((t, n) => t + n, 0);
  // (the biggest remainders first; a tie to the first of them)
  const order = ps.map((p, i) => [p - out[i], i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return ps.map((p, i) => (p > 0 && p < 1 ? 'under 1%' : `${out[i]}%`));
}
/**
 * A part against last year as a percent: "▲ 25%", what rounds to none "Even" (as ./changeIn says it: QA round 9, Gala's
 * $200,000 beside $200,000 read "▲ 0%"), '' without last year above zero
 */
export const changeOf = (a, p) => (p > 0 ? changeIn(a, p, 'pct') : '');
/** A share against last year's in points: "▲ 7 pts", what rounds to none "Even" (the store's profit of its sales) */
export const ptsOf = (m, lm) => { const c = Math.round((m - lm) * 100); return c === 0 ? 'Even' : `${c > 0 ? '▲' : '▼'} ${Math.abs(c)} pts`; };

// ─── A change said as a percent or in dollars: the presenter's pick on the screen, the reader's on the board page ───
// One choice on this device ('pct' or 'usd'), so the screen, the board page's statements and Print it all say the same
const AS_KEY = 'bd-change-as';
export const readChangeAs = () => { try { return localStorage.getItem(AS_KEY) === 'usd' ? 'usd' : 'pct'; } catch { return 'pct'; } };
export const keepChangeAs = (as) => {
  try { localStorage.setItem(AS_KEY, as === 'usd' ? 'usd' : 'pct'); } catch { /* private browsing */ }
  // (other windows hear it as a storage event; this one's other controls, this)
  dispatchEvent(new Event(AS_KEY));
};
/** The pick as state, kept in step with every other % | $ on this page and in other windows: [as, setAs] */
export function useChangeAs() {
  const [as, setAs] = useState(readChangeAs);
  useEffect(() => {
    const on = (e) => { if (!e.key || e.key === AS_KEY) setAs(readChangeAs()); };
    addEventListener('storage', on);
    addEventListener(AS_KEY, on);
    return () => { removeEventListener('storage', on); removeEventListener(AS_KEY, on); };
  }, []);
  return [as, keepChangeAs];
}
/**
 * Against last year: "▲ 25%" or "▲ $25,486" ("▲ $25K" when `short`), 'Even', or '' with nothing to set it beside. A
 * percent needs last year above zero; without it the change is said in dollars
 */
export function changeIn(a, p, as = 'pct', { short = false } = {}) {
  if (!(typeof a === 'number' && typeof p === 'number')) return '';
  if (as !== 'usd' && p > 0) { const c = Math.round(((a - p) / p) * 100); return c === 0 ? 'Even' : `${c > 0 ? '▲' : '▼'} ${Math.abs(c)}%`; }
  // (in dollars, the one less the other as both are written: ./lessWritten)
  if (asWritten(a) === asWritten(p)) return 'Even';
  return `${a > p ? '▲' : '▼'} ${(short ? compact : money)(Math.abs(lessWritten(a, p)))}`;
}
/** Over (under) a budget: "+$217,340" or "+12%" (of the budget; dollars when it's zero), 'Even', or '' with nothing */
export function overIn(a, b, as = 'usd', { short = false } = {}) {
  if (!(typeof a === 'number' && typeof b === 'number')) return '';
  if (asWritten(a) === asWritten(b)) return 'Even';
  if (as === 'pct' && b > 0) { const c = Math.round(((a - b) / b) * 100); return c === 0 ? 'Even' : `${c > 0 ? '+' : '−'}${Math.abs(c)}%`; }
  return `${a > b ? '+' : '−'}${(short ? compact : money)(Math.abs(lessWritten(a, b)))}`;
}
/**
 * A change both ways, `as` showing its pick and the other kept in its place unseen (portal.css .by-both, drawn from
 * data-alt, so it's never in the page's words): the place is the size of the longer, so choosing % or $ moves nothing
 * on the slide or the page (Peter: "the numbers move position!"). Given two whole lines ("As of Nov 2 · ▲ 12% on a
 * year"), only where they differ is doubled, the arrow with its figure, so the words around it stay as they are and the
 * line breaks in the same place either way. Said the same both ways ("▼ $285K", a profit's), its arrow still stays
 * with its figure
 */
export function Both({ as, pct, usd }) {
  const a = String(pct ?? '');
  const b = String(usd ?? '');
  if (a === b) {
    const m = /[▲▼] \S+/.exec(a);
    return m ? html`${a.slice(0, m.index)}<span class="by-both"><span>${m[0]}</span></span>${a.slice(m.index + m[0].length)}` : a;
  }
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  p = a.lastIndexOf(' ', p - 1) + 1;
  if (/[▲▼] $/.test(a.slice(0, p))) p -= 2;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  // (the same end from a word's start: "…K on a year" of $450K and $45K is the whole figure's)
  let q = a.length - s;
  if (q < a.length && a[q] !== ' ') { const sp = a.indexOf(' ', q); q = sp === -1 ? a.length : sp; }
  s = a.length - q;
  const [on, off] = as === 'usd' ? [b.slice(p, b.length - s), a.slice(p, q)] : [a.slice(p, q), b.slice(p, b.length - s)];
  return html`${a.slice(0, p)}<span class="by-both" data-alt=${off}><span>${on}</span></span>${a.slice(q)}`;
}

/**
 * What the revenue mix leaves out, in words a reader sees wherever it's shown: "not counting $220K in kind" ('' when it
 * leaves nothing out), its amount kept with its word on a phone. Its shares are of the revenue without the in kind
 * (./mixOf), while the year's chart beside it and QuickBooks' statement under it have the books' revenue, in kind in
 */
export const mixLeftOut = (mix) => (mix?.inKind ? nbw(`not counting ${compact(mix.inKind)} in kind`) : '');
/**
 * The mix's heading, the same everywhere it's shown (Home, a meeting's money item, the screen; Print it all has its
 * words): "Where 2026’s revenue came from", and what it leaves out beside it, as the year's charts say what's in theirs
 * (./books.js YearCompare). `as`, `cls`, `id`: the heading's own tag, look and id where it is
 */
export function MixHead({ books, as = 'p', cls = 'bp-fig__label', id = null }) {
  const mix = mixOf(books);
  if (!mix) return null;
  const left = mixLeftOut(mix);
  return html`<${as} class=${`${cls} bp-mixhead`} id=${id}>Where ${mix.year}’s revenue came from${left ? html` <small>${left}</small>` : null}<//>`;
}

/**
 * The revenue as one bar, a part per category, and a key giving each its amount and share; over a part, its exact
 * amount and the same days last year. `table` (Financials): every category beside last year, with its accounts, each
 * amount and its share apart by a real space (Board QA round 11: on a phone, where the share sits beside it, a screen
 * reader heard "$700,00042%")
 */
export function RevenueMix({ books, table = false }) {
  const mix = mixOf(books);
  const [on, setOn] = useState(-1);
  if (!mix) return null;
  const { parts } = mix;
  const tip = parts[on];
  const said = `${mix.year} revenue by category${mix.inKind ? `, not counting ${money(mix.inKind)} in kind` : ''}: ${parts.map((x) => `${x.name} ${money(x.said)} (${x.share})`).join(', ')}${mix.less.length ? `. ${mixLessWords(mix)}` : ''}`;
  const short = mixShort(mix);
  // (what's below zero said under it, by its name, as the parts beside it are written)
  const less = mix.less.length ? html`<p class="bp-mix__less" id=${table ? 'mix-less' : null}>${nbw(mixLessWords(mix, table ? money : compact))}</p>` : null;
  return html`<div class="bp-mix" onMouseLeave=${() => setOn(-1)}>
    <div class="bp-mix__bar" role="img" aria-label=${said}>
      ${parts.map((x, i) => html`<span class=${`bp-mix__seg bp-tone--${x.tone} ${on >= 0 && i !== on ? 'is-dim' : ''}`} style=${`--p:${x.w}%`} key=${x.key} onMouseEnter=${() => setOn(i)}></span>`)}
      ${tip ? html`<div class="bp-mix__tip" style=${`--x:${tip.mid}%`} aria-hidden="true"><strong>${tip.name}</strong>${money(tip.said)} · ${tip.share}${tip.last != null ? html`<span>${mix.lastYear}, same days: ${money(tip.last)}${changeOf(tip.amount, tip.last) ? ` · ${changeOf(tip.amount, tip.last)}` : ''}</span>` : null}</div>` : null}
    </div>
    ${table ? html`<table class="bp-table bp-mixtable bp-cmp">
      <thead><tr><th scope="col">Category</th><th scope="col" class="num">${mix.year} so far</th>${parts.some((x) => x.last != null) ? html`<th scope="col" class="num">${mix.lastYear}, same days</th><th scope="col" class="num">Change</th>` : null}</tr></thead>
      <tbody>${parts.map((x) => html`<tr key=${x.key} id=${`mix-${x.key}`}>
        <th scope="row"><span class="bp-mixtable__name"><i class=${`bp-tone--${x.tone}`} aria-hidden="true"></i>${x.name}</span>${x.accounts?.length && !(x.accounts.length === 1 && x.accounts[0] === x.name) ? html`<small>${x.accounts.join(', ')}</small>` : null}</th>
        <td class="num">${`${money(x.said)} `}<small>${x.share}</small></td>
        ${x.last != null ? html`<td class="num bp-cmp__ly" data-label=${`${mix.lastYear}, same days`}>${money(x.last)}</td><td class="num bp-cmp__chg">${changeOf(x.amount, x.last) || (x.last === 0 && x.amount > 0 ? 'New' : html`<${Blank} say="Nothing to compare" />`)}</td>` : null}
      </tr>`)}</tbody>
    </table>`
    : html`<ul class="bp-mix__key">${parts.map((x, i) => html`<li key=${x.key} class=${i === on ? 'is-on' : ''} onMouseEnter=${() => setOn(i)}><i class=${`bp-tone--${x.tone}`} aria-hidden="true"></i>${x.name}<strong>${short[i]}</strong><span>${x.share}</span></li>`)}</ul>`}
    ${less}
  </div>`;
}

// ─── The store: QuickBooks' accounts named for it (functions/api/_quickbooks.js storeOf) ───
// Home, a meeting's money item and Financials (./portal.js), the screen (./screen.js) and Print it all (./print.js).
// Its staff, rent and utilities are in SOARD's shared accounts, so its profit is said to be before them wherever it shows
/**
 * The store's year so far beside last year's same days → { year, lastYear, lines: [{ k, name, amount, last, accounts }] }
 * (its sales, its cost of goods, the profit between), or null before the store has a figure in QuickBooks (or from a
 * read an older deploy kept, or a past meeting's numbers locked before)
 */
export function storeOf(books) {
  const s = books?.store;
  if (!s || !(s.sales || s.cost)) return null;
  const ly = typeof books.lastYear?.store?.sales === 'number' ? books.lastYear.store : null;
  // (its profit is its sales less its cost of goods as they're written beside it: Board QA round 12)
  const profitOf = (x) => (typeof x.sales === 'number' && typeof x.cost === 'number' ? lessWritten(x.sales, x.cost) : x.profit);
  return { year: books.year, lastYear: ly ? books.lastYear.year : '', lines: [
    { k: 'sales', name: 'Sales', amount: asWritten(s.sales), last: ly ? asWritten(ly.sales) : null, accounts: s.salesAccounts || [] },
    { k: 'cost', name: 'Cost of goods', amount: asWritten(s.cost), last: ly ? asWritten(ly.cost) : null, accounts: s.costAccounts || [] },
    { k: 'profit', name: 'Profit before staff and rent', amount: profitOf(s), last: ly ? profitOf(ly) : null, accounts: [] },
  ], margin: s.sales > 0 ? profitOf(s) / s.sales : null, lastMargin: ly?.sales > 0 ? profitOf(ly) / ly.sales : null };
}
/** A store line against last year's same days: a share for its sales and cost, dollars for the profit (which can cross zero) */
export const storeChange = (x, as = '') => (x.last == null ? '' : x.amount === x.last ? 'Even' : as === 'usd' || x.k === 'profit' ? changeIn(x.amount, x.last, 'usd', { short: true }) : changeOf(x.amount, x.last));

/**
 * The store's three figures in a row (Home, a meeting's money item, Financials), each with how it stands against last
 * year by now. `idp`: each figure's id (Financials' "store": #store-sales, #store-cost, #store-profit), where search
 * lands on it (./figures.js)
 */
export function StoreFigures({ books, idp = '' }) {
  const st = storeOf(books);
  if (!st) return null;
  return html`<ul class="bp-store">${st.lines.map((x) => html`<li key=${x.k} class=${`bp-store__${x.k}`} id=${idp ? `${idp}-${x.k}` : null}>
    <span class="bp-store__name">${x.name}</span><strong class="bp-store__value">${compact(x.amount)}</strong>${storeChange(x) ? html`<span class="bp-store__ly">${storeChange(x)} on ${st.lastYear} by now</span>` : null}${x.k === 'profit' && st.margin != null ? html`<span class="bp-store__ly">${marginText(st)}</span>` : null}
  </li>`)}</ul>`;
}
/** "41% of sales (58% in 2025)": the store's profit as a share of its sales, beside last year's */
export function marginText(st) {
  const pct = (m) => `${Math.round(m * 100)}%`;
  return `${pct(st.margin)} of sales${st.lastMargin != null ? ` (${pct(st.lastMargin)} in ${st.lastYear})` : ''}`;
}

/**
 * Financials: the store's lines beside last year's same days, each with the QuickBooks accounts in it; each line's last
 * year in a cell of its own (#stl-sales-ly), where search lands on it (./figures.js)
 */
export function StoreTable({ books }) {
  const st = storeOf(books);
  if (!st) return null;
  const signed = (n) => `${n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  return html`<table class="bp-table bp-cmp bp-storetable">
    <thead><tr><th scope="col"><span class="sr-only">What</span></th><th scope="col" class="num">${st.year} so far</th>${st.lastYear ? html`<th scope="col" class="num">${st.lastYear}, same days</th><th scope="col" class="num">Change</th>` : null}</tr></thead>
    <tbody>${[...st.lines, ...(st.margin != null ? [{ k: 'margin', name: 'Profit as a share of sales', margin: true }] : [])].map((x) => x.margin ? html`<tr key="margin" class="bp-storetable__margin">
      <th scope="row">${x.name}</th><td class="num">${Math.round(st.margin * 100)}%</td>
      ${st.lastYear ? html`<td class="num bp-cmp__ly" data-label=${`${st.lastYear}, same days`}>${st.lastMargin == null ? html`<${Blank} />` : `${Math.round(st.lastMargin * 100)}%`}</td><td class="num bp-cmp__chg">${st.lastMargin == null ? html`<${Blank} say="Nothing to compare" />` : ptsOf(st.margin, st.lastMargin)}</td>` : null}
    </tr>` : html`<tr key=${x.k} id=${`stl-${x.k}`} class=${x.k === 'profit' ? 'bp-row--net' : ''}>
      <th scope="row">${x.name}${x.accounts.length ? html`<small>${x.accounts.join(', ')}</small>` : null}</th>
      <td class="num">${signed(x.amount)}</td>
      ${st.lastYear ? html`<td class="num bp-cmp__ly" data-label=${`${st.lastYear}, same days`} id=${`stl-${x.k}-ly`}>${x.last == null ? html`<${Blank} />` : signed(x.last)}</td><td class="num bp-cmp__chg">${storeChange(x) || html`<${Blank} say="Nothing to compare" />`}</td>` : null}
    </tr>`)}</tbody>
  </table>`;
}
