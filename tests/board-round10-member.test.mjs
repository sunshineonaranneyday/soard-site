// Board QA round 10, the members' page: search and the money figures. Each of the store's lines a figure of its own,
// landing on it and marking only it (1); Everything else drawn whenever anything is in it, so the parts add up (2);
// every amount the month-by-month tables and the figures without QuickBooks write is found, landing on it (3); a sign
// or bracket typed with a space (4); the ways an amount is typed ("676 K", "$.98M", "$1.66MM", "… dollars",
// "negative") (5); a change says which way, and two results are never worded the same (6); a link cut off in a %-code
// (7). The landing and the marks in the browser: scripts/test-board-round9-member.mjs (its R2 walk, R10 to R13)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { money } from '../public/admin/board-shared.js';
import { mixOf, compact, withBooks, booksBudget, storeOf } from '../public/admin/board/money.js';
import { yearEnds } from '../public/admin/board/books.js';
import { moneyFigures } from '../public/admin/board/figures.js';
import { termsOf, prep, planOf, matches } from '../public/admin/board/find.js';

const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const Y0 = Number(day(0).slice(0, 4));
const cat = (key, name, amount, accounts = [name]) => ({ key, name, amount, accounts });
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const LAST = { year: String(Y0 - 1), through: `${Y0 - 1}${day(0).slice(4)}`, revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, full: { revenue: 2000000, expenses: 1500000, net: 500000, nonCash: 100000 },
  sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)],
  store: { sales: 830000, cost: 380000, profit: 450000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
// (the tester's books, as round 9's suite has them: made up)
const BOOKS = {
  company: 'Example Charity', year: String(Y0), from: `${Y0}-01-01`, through: day(0), revenue: 1876045, expenses: 1200000, net: 676045, nonCash: 220000, at: new Date().toISOString(), stale: false,
  sources: [cat('donations', 'Donations', 700000), cat('store', 'Store sales', 415000, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000), cat('inkind', 'In kind', 220000), cat('grants', 'Grants', 90000), cat('account:golf classic', 'Golf Classic', 30000), cat('account:rent', 'Rent', 16000), cat('account:interest', 'Interest', 5000), cat('account:makeover', 'Makeover', 45)],
  store: { sales: 415000, cost: 250000, profit: 165000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] }, lastYear: LAST,
  monthly: { year: String(Y0), lastYear: String(Y0 - 1), months: Array.from({ length: Number(day(0).slice(5, 7)) }, (_, i) => ({ month: `${Y0}-${String(i + 1).padStart(2, '0')}`, revenue: 170550, spent: 109091, nonCash: 20000 })), last: Array.from({ length: 12 }, (_, i) => ({ month: `${Y0 - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000, spent: 125000, nonCash: 8000 })) },
  statements: { asOf: day(-30), closed: false, priorAsOf: `${Y0 - 1}${day(-30).slice(4)}`,
    position: [{ k: 'head', label: 'Assets', d: 0 }, { k: 'acct', label: '1450 Prepaid Expenses and Deposits', d: 3, a: 12000, p: 0 }, { k: 'total', label: 'TOTAL ASSETS', d: 0, a: 870767, p: 794994 }],
    activity: [{ k: 'head', label: 'Income', d: 0 }, { k: 'acct', label: '4210 Store Discounts', d: 1, a: -12000, p: -9000 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, p: 1909703 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, p: 176000 }] },
  budget: { name: 'Budget_FY26_P&L', from: `${Y0}-01-01`, to: `${Y0}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 }, rows: [{ k: 'head', label: 'Income', d: 0 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }] },
};
const CASH = { live: true, total: 375000, asOf: shortDay(day(0)), today: true, at: new Date().toISOString(), prior: null, priorAsOf: '', accounts: [{ bank: 'Mercury', name: 'Operating', balance: 312500 }, { bank: 'Mercury', name: 'Reserve', balance: 62500 }], owed: [], banks: ['Mercury'], stale: [] };
const FINANCE = {
  ytd: { year: Y0, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 },
  lastYtd: { year: Y0 - 1, through: day(-365), income: 800000, makeovers: 480000, store: 140000, operating: 200000, net: -20000 },
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(Y0 - 1, 10 + i, 15)).toISOString().slice(0, 7), income: 80000 + i * 1000, makeovers: 40000, store: 12000, operating: 18000, net: 10000 + i * 1000 })),
  cash: { lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000 },
  perMakeover: { count: 12, average: 21000 },
};
const dataOf = (books, { history = [] } = {}) => ({
  today: day(0), cashHistory: history, snapshot: null, gifts: null, meetings: [],
  numbers: { books, mercury: { empty: false }, finance: FINANCE, projects: { building: [], waiting: [] }, reveals: [], operating: { balance: 500000 } },
});
const DATA = dataOf(BOOKS);
const BUDGET = withBooks(booksBudget(BOOKS), BOOKS);
const FIGS = moneyFigures(DATA, { cash: CASH, budget: BUDGET });
/** The figures search finds for what's typed, as the finder does (./portal.js Finder): each with its line as typed found it */
const searchIn = (figs, typed) => {
  const plan = planOf(termsOf(typed));
  const exact = { ...plan, terms: plan.terms.map((t) => (/^(minus)?\d{3,}$/.test(t.w) ? { w: t.w, alts: [], small: t.small } : t)) };
  return figs.filter((x) => matches(prep(x.hay), x.exact ? exact : plan)).map((x) => { const p = x.exact ? exact : plan; return { ...x, said: (x.says && !matches(x.sp0, p) && x.says.find((a) => matches(a.sp, p))) || x }; });
};
const search = (typed) => searchIn(FIGS, typed);
const finds = (hay, typed) => matches(prep(hay), planOf(termsOf(typed)));
/** A mark's amount: "415000", "415k", "1d66m", "minus12000"; NaN for a word */
const markValue = (m) => { const x = String(m).match(/^(?:minus)?(\d+)(?:d(\d+))?([kmb])?$/); return x ? Number(`${x[1]}${x[2] ? `.${x[2]}` : ''}`) * ({ k: 1e3, m: 1e6, b: 1e9 }[x[3]] || 1) : NaN; };
const roughly = (m, v) => { const u = String(m).slice(-1); const tol = u === 'k' ? 500 : u === 'm' ? (v >= 1e7 ? 5e4 : 5e3) : u === 'b' ? 5e7 : 0.5; return Math.abs(markValue(m) - Math.abs(v)) <= tol; };
const amountOf = (line) => { const m = String(line).match(/(−)?\$([\d,]+)/); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) : NaN; };

// ─── 1: the store, a figure a line ───
test('each of the store’s lines, this year’s and last year’s, is a figure of its own: it lands where that figure is drawn and marks only it', () => {
  const st = storeOf(BOOKS);
  const name = { sales: 'sales', cost: 'cost of goods', profit: 'profit before staff and rent' };
  for (const x of st.lines) {
    for (const [v, title, focus] of [[x.amount, `The store’s ${name[x.k]}`, `store-${x.k}`], [x.last, `The store’s ${name[x.k]}, ${Y0 - 1}’s same days`, `stl-${x.k}-ly`]]) {
      for (const typed of [money(v), compact(v), String(v)]) {
        const hit = search(typed).find((y) => y.title === title);
        assert.ok(hit, `“${typed}” finds ${title} (${JSON.stringify(search(typed).map((y) => y.title))})`);
        assert.equal(hit.focus, focus, `${title} lands on its own place`);
        assert.equal(amountOf(hit.said.sub), v, `its line says its own amount: ${hit.said.sub}`);
        assert.ok(hit.said.marks.length && hit.said.marks.every((m) => roughly(m, v)), `${title} marks only its ${money(v)}: ${JSON.stringify(hit.said.marks)}`);
      }
    }
  }
  // (the tester's: "$380,000" was the sales row with only its $830,000 marked)
  const cost = search('$380,000').find((y) => /store/i.test(y.title));
  assert.deepEqual([cost.title, cost.focus], [`The store’s cost of goods, ${Y0 - 1}’s same days`, 'stl-cost-ly']);
  assert.ok(!cost.marks.some((m) => roughly(m, 830000)), 'never the sales beside it');
  // (a line's change lands on its tile, which says it: the profit's in dollars, the sales' as its percent)
  const profit = search('$285K').find((y) => /store/i.test(y.title));
  assert.deepEqual([profit.focus, profit.sub], ['store-profit', `Down $285,000 on ${Y0 - 1} by now`]);
  assert.ok(search('$415,000').find((y) => y.title === `The store’s sales, against ${Y0 - 1}`).marks.includes('50'), 'its ▼ 50% marked where it lands');
});

test('no search entry is several figures together: each marks one amount, its own (a change also its percent where that is how its place writes it)', () => {
  for (const figs of [FIGS, moneyFigures(dataOf(null, { history: HISTORY }), { cash: CASH, budget: null })]) {
    for (const x of figs) {
      for (const [line, marks] of [[x.sub, x.marks], ...(x.says || []).map((s) => [s.sub, s.marks])]) {
        const v = amountOf(x.key.startsWith('g:') ? x.title : line.replace(/^(Up|Down) /, ''));
        const amounts = marks.filter((m) => Number.isFinite(markValue(m)));
        const odd = amounts.filter((m) => !roughly(m, v) && !(/^(Up|Down) /.test(line) && /^\d{1,2}$/.test(m)));
        assert.deepEqual(odd, [], `${x.key} “${x.title} | ${line}” marks only its ${money(Math.abs(v))}: ${JSON.stringify(marks)}`);
      }
    }
  }
});

// ─── 2: Everything else whenever anything is in it ───
test('a small category is never dropped: Everything else is drawn whenever anything is in it, “under 1%”, so the parts add up to the revenue', () => {
  // sh-r10c.json: Donations $500,000, Store $300,000, Gala $196,000, Interest $4,000; revenue $1,000,000
  const books = { year: String(Y0), revenue: 1000000, sources: [cat('donations', 'Donations', 500000), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 196000), cat('account:interest', 'Interest', 4000, ['Interest Income'])], lastYear: LAST };
  const mix = mixOf(books);
  assert.deepEqual(mix.parts.map((x) => [x.name, x.amount, x.share]), [['Donations', 500000, '50%'], ['Store sales', 300000, '30%'], ['Gala', 196000, '20%'], ['Everything else', 4000, 'under 1%']]);
  assert.equal(mix.parts.reduce((t, x) => t + x.amount, 0), 1000000, 'the parts add up to the revenue');
  assert.deepEqual(mix.parts.at(-1).accounts, ['Interest']);
  // …and search lands on it: the row it's drawn on is Everything else's (#mix-rest)
  const figs = moneyFigures(dataOf(books), { cash: CASH, budget: null });
  const hit = searchIn(figs, 'Interest').find((x) => x.title === 'Interest');
  assert.equal(hit.focus, 'mix-rest');
  assert.ok(mix.parts.some((x) => `mix-${x.key}` === hit.focus), 'a row that is drawn');
  assert.ok(searchIn(figs, '$4,000').some((x) => x.title === 'Everything else' && x.focus === 'mix-rest'));
  // (a cent's worth isn't anything: no part of $0)
  assert.ok(!mixOf({ ...books, revenue: 996000.3, sources: books.sources.slice(0, 3) }).parts.some((x) => x.key === 'rest'));
});

// ─── 3: every amount the page writes is found ───
const HISTORY = Array.from({ length: 14 }, (_, i) => ({ month: new Date(Date.UTC(Y0, Number(day(0).slice(5, 7)) - 1 - i, 15)).toISOString().slice(0, 7), total: 300000 + ((i * 37) % 9) * 11000 + (i === 3 ? 0 : 0) }));
test('every amount in “The numbers, month by month” is found, landing on its own cell (or the caption that says it)', () => {
  const e = yearEnds(BOOKS);
  const { s } = e;
  const through = BOOKS.through;
  let n = 0;
  for (const [key, c, m, same] of [['rev', 'r', s.revenue, e.sameRev], ['exp', 'e', s.spent, e.sameExp]]) {
    for (let i = 0; i < 12; i++) {
      // (as books.js YearCompare writes them: this year's, last year's by then, its whole month beside the same days)
      const lv = i === s.upTo && typeof same === 'number' && through ? same : m.then[i];
      const cells = [[m.now[i], `fy-m${i}-${c}n`], [lv, `fy-m${i}-${c}l`], ...(lv !== m.then[i] ? [[m.then[i], `fy-m${i}-${c}lw`]] : [])].filter(([v]) => typeof v === 'number');
      for (const [v, cell] of cells) {
        n += 1;
        const hits = search(money(v)).filter((x) => x.focus === cell || x.focus === `fy-${key}-cap` || x.focus === `yf-${key}`);
        assert.ok(hits.some((x) => x.said.marks.some((mk) => roughly(mk, v))), `${money(v)} (#${cell}) is found and marked where it lands: ${JSON.stringify(search(money(v)).map((x) => `${x.title} → ${x.focus}`))}`);
      }
    }
  }
  assert.ok(n >= 40, `the table's ${n} amounts`);
});

test('without QuickBooks: Mercury’s year, a makeover’s average, the months, the month-end balances and the forecast are each found, landing on their own line', () => {
  const figs = moneyFigures(dataOf(null, { history: HISTORY }), { cash: CASH, budget: null });
  const at = (typed, focus) => { const hit = searchIn(figs, typed).find((x) => x.focus === focus); assert.ok(hit, `“${typed}” lands on #${focus} (${JSON.stringify(searchIn(figs, typed).map((x) => `${x.title} → ${x.focus}`))})`); return hit; };
  // (the tester's: "12 makeovers finished this year, $21,000 each on average", "$91,000" and "$70,000" in Month by month)
  assert.match(at('$21,000', 'io-note').title, /on average/);
  const spent = (p) => p.makeovers + p.store + p.operating;
  for (const r of FINANCE.months) for (const [k, v] of [['in', r.income], ['out', spent(r)], ['net', r.net]]) at(money(v), `io-m-${r.month}-${k}`);
  for (const [k, v] of [['in', 900000], ['out', 850000], ['makeovers', 500000], ['store', 150000], ['operating', 200000], ['net', 50000]]) at(money(v), `io-${k}`);
  at('−$20,000', 'io-net');
  // (each month-end balance, and its change on the month before, as the table writes it: "+$11,000")
  const hist = [...HISTORY].sort((a, b) => b.month.localeCompare(a.month));
  hist.forEach((r, i) => {
    at(money(r.total), `cm-${r.month}`);
    const d = hist[i + 1] ? r.total - hist[i + 1].total : 0;
    // (its way as the table writes it, its sign)
    if (Math.round(d)) assert.ok(at(`${d > 0 ? '+' : '−'}${money(Math.abs(d))}`, `cm-${r.month}-chg`).said.sub.startsWith(`${d > 0 ? '+' : '−'}${money(Math.abs(d))} on `));
  });
  for (const [v, focus] of [[210000, 'ct-low'], [180000, 'ct-low'], [260000, 'ct-in13'], [150000, 'ct-floor']]) at(money(v), focus);
});

// ─── 4: a sign or bracket typed with a space ───
test('a sign or bracket anywhere around an amount, with or without spaces, finds only what is below zero', () => {
  const discounts = '4210 Store Discounts −$12,000 −$12K 12 thousand';
  const prepaid = '1450 Prepaid Expenses and Deposits $12,000 $12K';
  for (const typed of ['- $12,000', '$-12,000', '− 12,000', '- 12,000', '( 12,000 )', '( $12,000 )', '($ 12,000)', '$(12,000)', '(-12,000)', '$ - 12,000', '-$12,000', '(12,000)', 'negative 12,000', 'minus 12,000', '- $12K']) {
    assert.deepEqual(termsOf(typed).filter((t) => /\d/.test(t)), [/k$/.test(typed.trim().toLowerCase()) ? 'minus12k' : 'minus12000'], typed);
    assert.ok(finds(discounts, typed), `${typed} finds −$12,000`);
    assert.ok(!finds(prepaid, typed), `${typed} never finds $12,000`);
  }
  // (never a dash between two numbers: a range, or a year to a year)
  assert.deepEqual(termsOf('2024 - 2025'), ['2024', '2025']);
  assert.deepEqual(termsOf('$10,000 - $12,000'), ['10000', '12000']);
  assert.deepEqual(termsOf('minutes - 2024'), ['minutes', '2024'], 'a dash between words, a dash');
  assert.deepEqual(termsOf('discounts - $12,000'), ['discounts', 'minus12000'], 'before a dollar sign, its sign');
  assert.deepEqual(termsOf('(2024)'), ['2024'], 'a year in brackets is a year');
  // (the tester's QA_BOOKS=big: only the discounts, never the prepaid $12,000)
  for (const typed of ['- $12,000', '$-12,000', '− 12,000', '- 12,000', '( 12,000 )']) assert.deepEqual(search(typed).map((x) => x.title), ['4210 Store Discounts'], typed);
});

// ─── 5: the ways an amount is typed ───
test('an amount typed any common way finds the figure it says, and a near one still finds nothing', () => {
  for (const [typed, title] of [['676 K', `${Y0} net`], ['676 k', `${Y0} net`], ['$.98M', `${Y0} expenses`], ['.98M', `${Y0} expenses`], ['$.375M', 'Cash in the bank'], ['$1.66MM', `${Y0} revenue`],
    ['1.66 million dollars', `${Y0} revenue`], ['676 thousand dollars', `${Y0} net`], ['$676 K', `${Y0} net`], ['$0.98M', `${Y0} expenses`], ['1.66MM', `${Y0} revenue`], ['$1.88 MM', `${Y0} revenue, in kind included`]]) {
    assert.ok(search(typed).some((x) => x.title === title), `“${typed}” finds ${title} (${JSON.stringify(search(typed).map((x) => x.title))})`);
  }
  assert.ok(search('negative 12,000').some((x) => x.title === '4210 Store Discounts') && !search('negative 12,000').some((x) => /Prepaid/.test(x.title)));
  // (round 8's rule: a short form is the same figure or nothing)
  for (const typed of ['$1.65MM', '.96M', '$.99M', '677 K', '1.7 million dollars', '$1.656MM']) assert.deepEqual(search(typed).map((x) => x.title), [], typed);
  // (and what isn't money stays as it was: "12mm" plywood, "Room 5 B")
  assert.ok(finds('Cabinets in 12mm plywood', '12mm plywood'));
  assert.ok(finds('Room 5 B, upstairs', 'room 5 b'));
});

// ─── 6: a change says which way, and what it's of ───
test('a change result says which way and what it is of, the way the page says it, and two results are never worded the same', () => {
  const chart = search('$376K').find((x) => /chart/.test(x.title));
  assert.ok(chart, `the chart’s change names the chart (${JSON.stringify(search('$376K').map((x) => x.title))})`);
  assert.equal(chart.title, `${Y0} revenue so far on the year’s chart, against ${Y0 - 1}’s same days`);
  assert.equal(chart.said.sub, `Up $376,045, or $376K, on ${Y0 - 1}’s same days, in kind included` /* r11: never in brackets, which say below zero */);
  assert.equal(search('376045').find((x) => /chart/.test(x.title))?.key, chart.key);
  const three = search('$226K').find((x) => x.title === `${Y0} revenue, against ${Y0 - 1}’s same days`);
  assert.equal(three.said.sub, `Up $226,045, or $226K, on ${Y0 - 1}’s same days, in kind left out` /* r11: the short form after a comma, never in brackets */);
  // ("$50K": one figure, counted the same way on the chart and above it, one result saying which way)
  assert.deepEqual(search('$50K').map((x) => x.said.sub), [`Down $50,000 on ${Y0 - 1}’s same days, in kind and depreciation left out`]);
  for (const figs of [FIGS, moneyFigures(dataOf(null, { history: HISTORY }), { cash: CASH, budget: null })]) {
    const seen = new Map();
    for (const x of figs) {
      // every change says its way first: "Up", "Down", or the sign its table writes it with ("−$11,250")
      if (/:chg|chgly|yearchg/.test(x.key)) assert.match(x.sub, x.key.startsWith('month:') ? /^[+−]\$/ : /^(Up|Down) \$/, `${x.key}: ${x.sub}`);
      const said = `${x.title} | ${x.sub}`;
      assert.ok(!seen.has(said), `two figures worded the same: ${said} (${seen.get(said)} and ${x.key})`);
      seen.set(said, x.key);
    }
    const titles = figs.filter((x) => /:chg|chgly|yearchg/.test(x.key)).map((x) => x.title);
    assert.ok(titles.length >= (figs === FIGS ? 7 : 10), `the changes (${titles.length})`);
    assert.equal(new Set(titles).size, titles.length, `each change named for what it is: ${JSON.stringify(titles)}`);
  }
});

// ─── 7: a link that can't be read ───
test('every decode of a link on the board page is guarded: one cut off in a %-code is a dead link, never a blank page', () => {
  const dir = new URL('../public/admin/board/', import.meta.url);
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => new URL(f, dir)), new URL('../public/admin/board-shared.js', import.meta.url)];
  let n = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/decodeURI(?:Component)?\(/g)) {
      n += 1;
      assert.match(src.slice(Math.max(0, m.index - 20), m.index), /try \{ return $/, `${f.pathname.split('/').slice(-2).join('/')}: a decode outside a try, at “${src.slice(m.index - 60, m.index + 30).replace(/\s+/g, ' ')}”`);
    }
  }
  assert.ok(n >= 2, `the board page's decodes (${n})`);
  // …and what the guard keeps: a part it can't read stays as written, so it matches nothing and says so
  const readPart = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  assert.deepEqual(['m_p6pvq352%2', '%', '%E2%80', 'm_ok'].map(readPart), ['m_p6pvq352%2', '%', '%E2%80', 'm_ok']);
});
