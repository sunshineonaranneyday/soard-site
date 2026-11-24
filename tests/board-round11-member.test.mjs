// Board QA round 11, the members' page: the money figures and search. Every figure search finds has a place of its own
// to land on, a meeting's money figure its tile, never the whole agenda item (1); one revenue, counted one way, the
// tiles adding up under every switch (2); the short form rounds to the unit it shows (3); one figure, one search key
// (4); every fold on the page kept (5); days read by one helper, a day or a full time alike (6); this month is never a
// month-end (7); brackets around an amount mean below zero (8). The landing, the folds, the labels and the screen
// reader's names in the browser: scripts/test-board-round11-member.mjs (W1 to W9)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as money from '../public/admin/board/money.js';
import * as figures from '../public/admin/board/figures.js';
import * as parts from '../public/admin/board/parts.js';
import { termsOf, prep, planOf, matches } from '../public/admin/board/find.js';

const { compact, withBooks, booksBudget, yearFigures, mixOf } = money;
const { moneyFigures, figureTiles } = figures;
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const Y0 = Number(day(0).slice(0, 4));
const cat = (key, name, amount, accounts = [name]) => ({ key, name, amount, accounts });
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthName = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const LAST = { year: String(Y0 - 1), through: `${Y0 - 1}${day(0).slice(4)}`, revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, full: { revenue: 2000000, expenses: 1500000, net: 500000, nonCash: 100000 },
  sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)],
  store: { sales: 830000, cost: 380000, profit: 450000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
const SOURCES = [cat('donations', 'Donations', 700000), cat('store', 'Store sales', 415000, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000), cat('inkind', 'In kind', 220000), cat('grants', 'Grants', 90000), cat('account:golf classic', 'Golf Classic', 30000), cat('account:rent', 'Rent', 16000), cat('account:interest', 'Interest', 5000), cat('account:makeover', 'Makeover', 45)];
const L = (k, label, d, a, p) => ({ k, label, d, a, p });
const STATEMENTS = (big) => ({ asOf: day(-30), closed: false, priorAsOf: `${Y0 - 1}${day(-30).slice(4)}`,
  position: [L('head', 'Assets', 0), ...(big ? [L('acct', '1010 Mercury Checking (Operating) - 4321', 3, 312500, 401000), L('acct', '1450 Prepaid Expenses and Deposits', 3, 12000, 0), L('acct', '1690 Accumulated Depreciation', 2, -20000, -28000), L('acct', 'Net Income', 2, 189248, 176000)] : []), L('total', 'TOTAL ASSETS', 0, 870767, 794994)],
  activity: [L('head', 'Income', 0), L('acct', '4210 Store Discounts', 1, -12000, -9000), ...(big ? [L('acct', '4300 In-Kind Contribution', 1, 220000, 70000), L('total', 'Total Expenses', 0, 1444969, 1245703)] : []), L('total', 'Total Income', 0, 1884217, 1909703), L('sum', 'Net Income', 0, 189248, 176000)] });
/**
 * QuickBooks' read under each switch (made up): `budget` QuickBooks' own for the year or none; `inKind` gifts in kind
 * among the revenue or none; `big` statements as long as a real one's
 */
function booksOf({ budget = true, inKind = true, big = false } = {}) {
  const sources = inKind ? SOURCES : SOURCES.filter((x) => x.key !== 'inkind');
  const revenue = sources.reduce((t, x) => t + x.amount, 0);
  return {
    company: 'Example Charity', year: String(Y0), from: `${Y0}-01-01`, through: day(0), revenue, expenses: 1200000, net: revenue - 1200000, nonCash: inKind ? 220000 : 8000, at: new Date().toISOString(), stale: false,
    sources, store: { sales: 415000, cost: 250000, profit: 165000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] }, lastYear: LAST,
    monthly: { year: String(Y0), lastYear: String(Y0 - 1), months: Array.from({ length: Number(day(0).slice(5, 7)) }, (_, i) => ({ month: `${Y0}-${String(i + 1).padStart(2, '0')}`, revenue: 170550, spent: 109091, nonCash: 20000 })), last: Array.from({ length: 12 }, (_, i) => ({ month: `${Y0 - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000, spent: 125000, nonCash: 8000 })) },
    statements: STATEMENTS(big),
    budget: budget ? { name: 'Budget_FY26_P&L', from: `${Y0}-01-01`, to: `${Y0}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 }, rows: [L('head', 'Income', 0), { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, b: 150000, y: 180000 }] } : null,
    functions: { list: [{ name: 'Programs', amount: 820000 }, { name: 'Management', amount: 110000 }, { name: 'Fundraising', amount: 40000 }, { name: 'Events', amount: 10000 }], total: 980000 },
  };
}
const CASH = { live: true, total: 375000, asOf: shortDay(day(0)), today: true, at: new Date().toISOString(), prior: 340000, priorAsOf: monthName(`${Y0 - 1}${day(0).slice(4, 7)}`), accounts: [{ bank: 'Mercury', name: 'Operating', balance: 312500 }, { bank: 'Mercury', name: 'Reserve', balance: 62500 }], owed: [], banks: ['Mercury'], stale: [] };
const FINANCE = {
  ytd: { year: Y0, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 },
  lastYtd: { year: Y0 - 1, through: day(-365), income: 800000, makeovers: 480000, store: 140000, operating: 200000, net: -20000 },
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(Y0 - 1, 10 + i, 15)).toISOString().slice(0, 7), income: 80000 + i * 1000, makeovers: 40000, store: 12000, operating: 18000, net: 10000 + i * 1000 })),
  cash: { lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000 },
  perMakeover: { count: 12, average: 21000 },
};
// The cash at each month's end as the heartbeat keeps it: this month's row stamped with the time it was read
const HISTORY = (() => {
  const totals = [340000, 351000, 339750, 360000, 340000, 352500, 362500, 342500, 355000, 365000, 345000, 370000, 375000];
  const base = new Date(`${day(0).slice(0, 7)}-15T12:00:00Z`);
  return totals.map((total, i) => { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() - (totals.length - 1 - i)); const ym = d.toISOString().slice(0, 7); return { month: ym, total, at: i === totals.length - 1 ? `${day(0)}T15:04:00.000Z` : `${ym}-28T12:00:00Z` }; }).reverse();
})();
// The next meeting, its money item (made up)
const MEETING = { id: 'm_next0001', date: day(9), title: '', sections: [{ id: 's_call', title: 'Call to order', items: [{ id: 'i_roll', title: 'Roll call' }] }, { id: 's_fin', title: 'Finance', items: [{ id: 'i_fin0001', title: 'Year to date', live: 'cash' }] }], files: [], motions: [], actions: [] };
const COSTS = {
  makeovers: [{ key: 'k:ava', name: 'Ava', season: Y0, rooms: ['Bedroom'], type: 'bedroom', cost: 21500 }, { key: 'k:ben', name: 'Ben', season: Y0, rooms: ['Bathroom'], type: 'bathroom', cost: 34250 }, { key: 'k:cal', name: 'Cal', season: Y0 - 1, rooms: ['Therapy Room'], type: 'therapy', cost: 18750 }],
  underway: [{ key: 'u:eve', name: 'Eve', season: Y0, status: 'Build', rooms: ['Bedroom'], type: 'bedroom', paid: 8200, budget: 23000 }],
  waiting: [{ key: 'k:fay', name: 'Fay', season: Y0 + 1, rooms: ['Bedroom'], type: 'bedroom', sponsors: [] }],
};
const dataOf = (books, { history = HISTORY, costs = COSTS } = {}) => ({
  today: day(0), cashHistory: history, meetings: [MEETING], gifts: { count: 2, total: 3000000, year: Y0, list: [{ id: 'p1', cents: 2500000, name: 'Lee Sample', at: Math.floor(Date.now() / 1000) - 86400 }, { id: 'p2', cents: 500000, name: 'Dana Example', at: Math.floor(Date.now() / 1000) - 2 * 86400 }] },
  snapshot: { year: Y0 - 1, totalRevenue: 1000000, totalExpenses: 900000, programExpenses: 750000, managementExpenses: 90000, fundraisingExpenses: 60000, netAssets: 400000, contributions: 600000, storeRevenue: 300000 },
  numbers: { books, mercury: { empty: false }, finance: FINANCE, projects: { building: [], waiting: [] }, reveals: [], operating: { balance: 300000 }, costs },
});
const budgetOf = (books) => (books ? withBooks(booksBudget(books), books) : null);
const figsOf = (books, o) => moneyFigures(dataOf(books, o), { cash: CASH, budget: budgetOf(books) });
/** Every switch the brief names: a budget or none, QuickBooks or none, in kind or none, big books */
const SWITCHES = [];
for (const qbo of [true, false]) for (const budget of [true, false]) for (const inKind of [true, false]) for (const big of [false, true]) if (qbo || (budget && inKind && !big)) SWITCHES.push({ qbo, budget, inKind, big });
const nameOf = (s) => (s.qbo ? `QuickBooks, ${s.budget ? 'a budget' : 'no budget'}, ${s.inKind ? 'in kind' : 'no in kind'}${s.big ? ', big books' : ''}` : 'no QuickBooks (Mercury)');
const amountOf = (line) => { const m = String(line).match(/(−)?\$([\d,]+)/); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) : NaN; };
/** Lines of two different statements that write the same line (Net Income on the activities, the budget and the position): each its own row, landing on it (Board QA round 9) */
const STATEMENT = /on the (statement of activities|budget against actual|statement of financial position)/;
const whichStatement = (sub) => (sub.match(STATEMENT) || [])[1] || '';
const BOARD = new URL('../public/admin/board/', import.meta.url);
const SOURCE = readdirSync(BOARD).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(new URL(f, BOARD), 'utf8')]);

// ─── 1: every figure a place of its own ───
test('1. a meeting’s money figure lands on its own tile, never the whole agenda item; no figure lands on a whole card', () => {
  for (const s of SWITCHES) {
    const books = s.qbo ? booksOf(s) : null;
    const figs = figsOf(books);
    const mtg = figs.filter((x) => x.href === `#/meetings/${MEETING.id}`);
    for (const x of mtg) assert.match(x.focus, new RegExp(`^mt-${MEETING.id}-\\w+$`), `${nameOf(s)}: ${x.title} lands on its tile, ${x.focus}`);
    if (s.qbo) assert.ok(mtg.some((x) => x.title === 'Lowest ahead' && x.focus === `mt-${MEETING.id}-low`), `${nameOf(s)}: Lowest ahead on its tile (${JSON.stringify(mtg.map((x) => [x.title, x.focus]))})`);
    // (the cards themselves: the cash, the year, the budget, the mix, the gifts, what makeovers cost, the tax return's year, the agenda item)
    const cards = figs.filter((x) => /^(cash|year|budget|mixcard|gifts|costs|glance|cashtime|store|i-.*)$/.test(x.focus));
    assert.deepEqual(cards.map((x) => `${x.title} → #${x.focus}`), [], `${nameOf(s)}: no figure lands on a whole card`);
  }
  assert.equal(typeof figures.moneyTileId, 'function', 'the tile’s place named in one place, for the page and the search');
  assert.equal(figures.moneyTileId(MEETING, { k: 'low' }), `mt-${MEETING.id}-low`);
});

// ─── 2: one revenue, counted one way ───
test('2. one revenue, counted one way: the tiles add up and match The year so far and the mix under every switch, in kind said once', () => {
  for (const s of SWITCHES) {
    const books = s.qbo ? booksOf(s) : null;
    const data = dataOf(books);
    const tiles = figureTiles({ data, cash: CASH, budget: budgetOf(books), variant: 'fin' });
    const fig = (key, k) => tiles.find((t) => t.key === key)?.figs.find((f) => f.k === k)?.v;
    if (!books) { assert.ok(!tiles.some((t) => t.key === 'net'), 'no net tile without QuickBooks'); continue; }
    const [rev, exp, net] = [fig('rev', 'rev'), fig('exp', 'exp'), fig('net', 'net')];
    const y = yearFigures(books);
    assert.equal(Math.round((rev - exp) * 100) / 100, net, `${nameOf(s)}: revenue ${rev} less expenses ${exp} is the net ${net}`);
    assert.deepEqual([rev, exp, net], [y.revenue, y.expenses, y.net], `${nameOf(s)}: the tiles are The year so far's`);
    const mix = mixOf(books);
    assert.equal(mix.total, rev, `${nameOf(s)}: the mix is of the same revenue`);
    assert.ok(!mix.parts.some((x) => x.key === 'inkind'), `${nameOf(s)}: in kind is never a part of a revenue that leaves it out`);
    // (what's left out, said the same on the tile, the mix and The year so far)
    const given = y.inKind?.given || 0;
    assert.equal(mix.inKind || 0, given, `${nameOf(s)}: the mix leaves out what the figures leave out`);
    const rt = tiles.find((t) => t.key === 'rev');
    assert.equal(rt.aside.replace(/\s/g, ' '), given ? `Not counting ${compact(given)} in kind` : '', `${nameOf(s)}: the revenue tile says it`);
    // Search: one amount for one figure's title
    const byTitle = new Map();
    for (const x of figsOf(books)) { const v = amountOf(x.sub); if (!byTitle.has(x.title)) byTitle.set(x.title, new Set()); byTitle.get(x.title).add(v); }
    const two = [...byTitle].filter(([, vs]) => vs.size > 1).map(([t, vs]) => `${t}: ${[...vs].join(', ')}`);
    assert.deepEqual(two, [], `${nameOf(s)}: a figure's title has one amount in search`);
  }
});

// ─── 3: the short form rounds to the unit it shows ───
test('3. the short form rounds to the unit it shows and carries to the next: never “$1000K” or “$1000M”', () => {
  assert.equal(compact(999700), '$1M');
  assert.equal(compact(999499), '$999K');
  assert.equal(compact(999500), '$1M');
  assert.equal(compact(-999700), '−$1M');
  assert.equal(compact(999950000), '$1B');
  assert.equal(compact(999949999), '$999.9M');
  assert.equal(compact(9999600), '$10M');
  assert.equal(compact(1656045), '$1.66M');
  assert.equal(compact(415000), '$415K');
  assert.equal(compact(9999.6), '$10,000');
  // (a sweep: every short form a figure is said in is under 1000 of its unit, and within half its step of the amount)
  const step = (s) => { const m = s.match(/\$([\d.]+)([KMB])$/); if (!m) return 1; const dec = (m[1].split('.')[1] || '').length; return { K: 1e3, M: 1e6, B: 1e9 }[m[2]] / 10 ** dec; };
  const val = (s) => { const m = s.match(/\$([\d.,]+)([KMB])?$/); return Number(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1); };
  for (let v = 9000; v < 5e10; v *= 1.0037) {
    for (const a of [Math.round(v), Math.round(v / 1e3) * 1e3 - 300, Math.round(v / 1e6) * 1e6 - 30000]) {
      if (a < 0) continue;
      const c = compact(a);
      assert.ok(!/\$1000(\.0)?[KMB]/.test(c), `${a} is never ${c}`);
      // (a step of the unit said: 2 places under 10M or 10B, 1 above; at most a step's half off, a cent for a float)
      assert.ok(Math.abs(val(c) - a) <= step(c) / 2 + 1e-6 * a, `${a} said ${c}`);
    }
  }
  // Search reads the new forms: Donations $999,700 is found by "$1M", its line "$999,700, or $1M", never "$1000K"
  const books = { ...booksOf(), sources: [cat('donations', 'Donations', 999700), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 196000), cat('account:interest', 'Interest', 3)], revenue: 1495703 };
  const don = figsOf(books).find((x) => x.title === 'Donations');
  assert.match(don.sub, /^\$999,700, or \$1M, /);
  assert.ok(matches(prep(don.hay), planOf(termsOf('$1M'))), 'found by “$1M”');
  assert.ok(!/1000k/.test(don.hay), `its words never say “1000K” (${don.hay})`);
});

// ─── 4: one figure, one search key ───
test('4. one figure, one result: no two search entries with the same title and the same amount, with QuickBooks or without, the meeting’s money in it', () => {
  for (const s of SWITCHES) {
    const figs = figsOf(s.qbo ? booksOf(s) : null);
    const seen = new Map();
    const twice = [];
    for (const x of figs) {
      // (a line two statements both write is each statement's own row: Board QA round 9's every line lands on its row)
      const k = `${x.title}|${amountOf(x.sub)}|${whichStatement(x.sub)}`;
      if (seen.has(k)) twice.push(`${x.title}: ${x.sub.slice(0, 70)} || ${seen.get(k).slice(0, 70)}`);
      seen.set(k, x.sub);
    }
    assert.deepEqual(twice, [], `${nameOf(s)}: one result a figure`);
  }
  // Mercury's year, keyed as Financials keys it: the meeting's tile adds its "+$50,000" to the same one
  const figs = figsOf(null);
  const net = figs.filter((x) => x.title === `Net, ${Y0} so far`);
  assert.equal(net.length, 1);
  assert.equal(net[0].focus, 'io-net');
  assert.ok(net[0].marks.includes('50000'));
  for (const t of [`Money in, ${Y0} so far`, `Money out, ${Y0} so far`]) assert.equal(figs.filter((x) => x.title === t).length, 1, t);
});

// ─── 5: every fold kept ───
test('5. every fold on the board page is one kind, kept on Back, Forward and a reload: no <details> drawn without data-kept', () => {
  const bad = [];
  for (const [f, src] of SOURCE) {
    src.split('\n').forEach((line, i) => {
      if (!/<details\b/.test(line) || /^\s*(\*|\/\/)/.test(line)) return;
      // (parts.js More, the one fold, keeps itself; a list's folds say their key and item, data-kept and data-kept-item)
      if (/data-kept=/.test(line)) return;
      bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, []);
  assert.match(parts.More.toString(), /data-kept=/, 'More keeps itself');
  assert.match(parts.More.toString(), /cls/, 'a fold of its own look is still More (“The numbers, month by month”: by-table)');
});

// ─── 6: days read by one helper ───
test('6. a day or a full time read alike, by one helper: the heartbeat’s “2026-11-23T15:04:00Z” is Nov 23', () => {
  const { dayIn, dayText } = parts;
  assert.equal(typeof dayIn, 'function');
  assert.equal(dayIn('2026-11-23'), '2026-11-23');
  assert.equal(dayIn('2026-11-23T15:04:00Z'), '2026-11-23');
  assert.equal(dayIn('2026-11-24T03:00:00Z'), '2026-11-23', '10 PM in Atlanta is that day, never the UTC day after');
  assert.equal(dayIn('2026-07-05T03:30:00Z'), '2026-07-04');
  for (const x of ['', null, undefined, 'not a day', '2026-13-01', 'Nov 23']) assert.equal(dayIn(x), '', String(x));
  assert.equal(dayText('2026-11-23T15:04:00Z', 'md'), 'Nov 23');
  assert.equal(dayText('2026-11-23', 'md'), 'Nov 23');
  assert.equal(dayText('2026-11-23', 'mdy'), 'Nov 23, 2026');
  assert.equal(dayText('2026-11-23', 'MD'), 'November 23');
  assert.equal(dayText('2026-11-23', 'wMDY'), 'Monday, November 23, 2026');
  assert.equal(parts.shortDate('2026-11-23T15:04:00Z'), 'Nov 23, 2026');
  // Every day on the board page goes through it: no page file reads one itself (its first ten characters, a day at noon
  // UTC of its own) or board-shared.js's day-only words
  const bad = [];
  for (const [f, src] of SOURCE) {
    if (f === 'parts.js') continue;
    src.split('\n').forEach((line, i) => {
      if (/\$\{[^}]+\}T12:00:00Z/.test(line.replace(/\$\{[^}]+\}-15T12:00:00Z/g, ''))) bad.push(`${f}:${i + 1}: a day at noon of its own: ${line.trim().slice(0, 90)}`);
      if (/(?:shortDate|longDate|dayText|dayMonth|day)\([^()]*\.slice\(0,\s*10\)/.test(line)) bad.push(`${f}:${i + 1}: a time's first ten characters: ${line.trim().slice(0, 90)}`);
      if (/import\s*\{[^}]*\b(shortDate|longDate)\b[^}]*\}\s*from '\.\.\/board-shared\.js'/.test(line)) bad.push(`${f}:${i + 1}: board-shared.js's day-only ${RegExp.$1}`);
    });
  }
  assert.deepEqual(bad, []);
});

// ─── 7: this month is never a month-end ───
test('7. this month’s row is so far this month, never a month-end, in search; finished months are their month’s end', () => {
  const figs = figsOf(null);
  const now = monthName(day(0).slice(0, 7));
  const md = new Date(`${day(0)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const mine = figs.filter((x) => x.title.includes(now) && /^Cash/.test(x.title));
  assert.ok(mine.length >= 1, JSON.stringify(figs.filter((x) => /^Cash/.test(x.title)).map((x) => x.title)));
  for (const x of mine) {
    assert.ok(x.title.startsWith(`Cash so far this month, ${now}`), x.title);
    assert.ok(!/month’s end|at the end of/.test(`${x.title} ${x.sub}`), x.sub);
  }
  assert.ok(mine.find((x) => x.title === `Cash so far this month, ${now}`).sub.includes(`as of ${md}`), 'said as of its day, read from the heartbeat’s full time');
  const before = monthName(HISTORY[1].month);
  assert.ok(figs.some((x) => x.title === `Cash at the end of ${before}` && x.sub.includes('at the month’s end')), `${before} is a month-end`);
  assert.equal(money.monthSoFar({ month: day(0).slice(0, 7) }, day(0)), true);
  assert.equal(money.monthSoFar({ month: HISTORY[1].month }, day(0)), false);
});

// ─── 8: brackets mean below zero ───
test('8. no line search writes puts a positive amount in brackets, nor does any sentence the page or its print view writes', () => {
  const BRACKETED = /\((?!\s*[−-])[^()]*\$\d[^()]*\)/;
  for (const s of SWITCHES) {
    for (const x of figsOf(s.qbo ? booksOf(s) : null)) {
      for (const line of [x.sub, ...(x.says || []).map((a) => a.sub)]) assert.ok(!BRACKETED.test(line), `${nameOf(s)}: ${x.title} | ${line}`);
    }
  }
  // (the page's and the print view's own sentences: an amount put in brackets in a template's words, "(${compact(…)})"
  // or "(a cautious guess: ${money(…)})"; a statement's below zero, "(${money(-v)})", is what brackets mean)
  const bad = [];
  for (const [f, src] of SOURCE) {
    src.split('\n').forEach((line, i) => {
      const t = line.replace(/\(\$\{money\(-v\)\}\)/g, '');
      if (/\([^()`]*\$\{(?:compact|money|dollars|amount|both)\([^`]*?\)\}[^()`]*\)/.test(t)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(bad, []);
});
