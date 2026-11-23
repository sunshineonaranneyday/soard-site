// Board QA round 9, the members' page: the revenue's parts when a category is below zero (3), an amount typed any way
// that writes it exactly (5), typed with a sign (6), a change that rounds to nothing (7), and the search's money made
// from what draws it, so every figure drawn is found (2). The landing and the marks are checked in the browser
// (scripts/test-board-round9-member.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as money from '../public/admin/board/money.js';
import { termsOf, prep, planOf, matches, termRe } from '../public/admin/board/find.js';

// (each by name, so a part that isn't there fails its own test, never the file)
const { mixOf, changeOf, storeChange, compact, moneyTiles, withBooks, booksBudget, sharesOf } = money;
const mixLessWords = (...a) => { assert.equal(typeof money.mixLessWords, 'function', 'money.js says what the revenue is less than its parts (mixLessWords)'); return money.mixLessWords(...a); };
const ptsOf = (...a) => { assert.equal(typeof money.ptsOf, 'function', 'money.js says a change in points (ptsOf)'); return money.ptsOf(...a); };
const figures = await import('../public/admin/board/figures.js').catch(() => null);
const need = () => assert.ok(figures, 'the search’s money comes from what draws it (./figures.js)');

const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const Y0 = Number(day(0).slice(0, 4));
const cat = (key, name, amount, accounts = [name]) => ({ key, name, amount, accounts });
const LAST = { year: String(Y0 - 1), through: `${Y0 - 1}${day(0).slice(4)}`, revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, full: { revenue: 2000000, expenses: 1500000, net: 500000, nonCash: 100000 },
  sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)],
  store: { sales: 830000, cost: 380000, profit: 450000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
const pcts = (mix) => mix.parts.reduce((t, x) => t + Number(String(x.share).replace('%', '')), 0);
const finds = (hay, typed) => matches(prep(hay), planOf(termsOf(typed)));

// ─── 3: a category below zero ───
test('a revenue category below zero is kept by the books’ read, and the mix says it apart: its parts add to 100%, less it the revenue', async () => {
  const { sourcesOf } = await import('../functions/api/_quickbooks.js');
  const acct = (label, value) => ({ type: 'Data', ColData: [{ value: label }, { value }] });
  const report = { Rows: { Row: [{ type: 'Section', group: 'Income', Header: { ColData: [{ value: 'Income' }, { value: '' }] }, Rows: { Row: [acct('4010 Individual/Corporate Revenue', '600000.00'), acct('4210 Store Income', '420000.00'), acct('4900 Refunds', '-20000.00')] }, Summary: { ColData: [{ value: 'Total Income' }, { value: '1000000.00' }] } }] } };
  const s = sourcesOf(report);
  assert.deepEqual(s.map((c) => [c.name, c.amount]), [['Donations', 600000], ['Store sales', 420000], ['Refunds', -20000]], 'the refunds kept, below zero, last');
  assert.equal(s.reduce((t, c) => t + c.amount, 0), 1000000, 'the categories add up to the revenue');

  // sh-neg.json as the books' read now keeps it: $1,000,000 of revenue, $600,000 and $420,000 in, $20,000 of refunds
  const neg = { year: String(Y0), revenue: 1000000, sources: s, lastYear: LAST };
  const mix = mixOf(neg);
  assert.deepEqual(mix.parts.map((x) => [x.name, x.amount, x.share]), [['Donations', 600000, '59%'], ['Store sales', 420000, '41%']]);
  assert.equal(pcts(mix), 100, 'the shares add up to 100% (they were 60% + 42%)');
  assert.ok(Math.abs(mix.parts.reduce((t, x) => t + x.w, 0) - 100) < 1e-9, 'the bar ends at its end');
  assert.equal(mixLessWords(mix), 'Less $20,000 in Refunds.');
  assert.equal(mixLessWords(mix, compact), 'Less $20K in Refunds.', 'in short beside parts in short (Home)');
  assert.equal(mix.parts.reduce((t, x) => t + x.amount, 0) - mix.less.reduce((t, x) => t + x.amount, 0), 1000000, 'the parts less it are the revenue tile');

  // sh-neg2.json ($965,000; Donations $500,000, Store sales $300,000, Gala $200,000; a $35,000 refund)
  const neg2 = mixOf({ year: String(Y0), revenue: 965000, sources: [cat('donations', 'Donations', 500000), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 200000), cat('account:refunds', 'Refunds', -35000)], lastYear: LAST });
  assert.deepEqual(neg2.parts.map((x) => x.share), ['50%', '30%', '20%'], 'they were 52% + 31% + 21% = 104%');
  assert.equal(mixLessWords(neg2), 'Less $35,000 in Refunds.');
  // A read kept from before the books kept those below zero: what the categories don't account for, said the same way
  const old = mixOf({ year: String(Y0), revenue: 965000, sources: [cat('donations', 'Donations', 500000), cat('store', 'Store sales', 300000), cat('gala', 'Gala', 200000)], lastYear: LAST });
  assert.equal(pcts(old), 100);
  assert.equal(mixLessWords(old), 'Less $35,000 in income accounts below zero.');
  // (and nothing below zero: nothing said, the parts as before)
  const plain = mixOf({ year: String(Y0), revenue: 1000000, sources: [cat('donations', 'Donations', 600000), cat('store', 'Store sales', 400000)], lastYear: LAST });
  assert.equal(mixLessWords(plain), '');
  assert.deepEqual(plain.parts.map((x) => x.share), ['60%', '40%']);
});

// ─── 5: any way of writing the same amount ───
test('an amount in short that writes it exactly finds it: decimal k, m under 1, a space before the letter, "mil"', () => {
  for (const [typed, hay] of [
    ['$312.5K', 'Operating $312,500 $313K'], ['62.5k', 'Reserve $62,500 $63K'], ['$1.75K', '$1,750 from Casey Example'],
    ['$0.98M', '2026 expenses $980,000 $980K 980 thousand'], ['0.98 million', '2026 expenses $980,000 $980K'], ['$0.4M', 'Gala $400,000 $400K'],
    ['$676 K', '2026 net $676,045 $676K +$676K'], ['1.66mil', '2026 revenue $1,656,045 $1.66M'], ['1.66 mil', '2026 revenue $1,656,045 $1.66M'], ['$1.66 M', '$1,656,045 $1.66M'],
    ['1800000', 'the budget $1.8M'], ['$1.8M', 'the budget $1,800,000'],
  ]) assert.ok(finds(hay, typed), `${typed} finds ${hay}`);
});

test('a near one still finds nothing: a short form finds a figure only when it is that figure', () => {
  for (const [typed, hay] of [
    ['$1.656M', '$1,656,045 $1.66M 1.66 million'], ['1,656K', '$1,656,045 $1.66M'], ['1.7 million', '$1,656,045 $1.66M'], ['$1.65M', '$1,656,045 $1.66M'],
    ['$870.8K', 'TOTAL ASSETS $870,767 $871K'], ['$233.5K', 'Chase $233,532 $234K'], ['1,656,046', '$1,656,045'], ['375,000.50', '$375,000'],
  ]) assert.ok(!finds(hay, typed), `${typed} finds nothing in ${hay}`);
});

test('each found is marked: the exact amount a short form stands for, and the short form where it is written', () => {
  const marks = (typed, text) => { const plan = planOf(termsOf(typed)); const pats = plan.terms.flatMap((t) => [termRe(t.w), ...t.alts.map((a) => termRe(a.w))]); return new RegExp(pats.join('|'), 'i').exec(text.toLowerCase())?.[0] || null; };
  assert.equal(marks('$312.5K', 'Operating $312,500 ($313K)'), '312,500');
  assert.equal(marks('$0.98M', '$980,000, January 1'), '980,000');
  assert.equal(marks('$676 K', '$676,045 (+$676K)'), '676k');
  assert.equal(marks('1.66mil', '$1,656,045 ($1.66M)'), '1.66m');
});

// ─── 6: a sign typed ───
test('a sign typed (−, - or brackets) finds only an amount below zero; with none typed, either', () => {
  const discounts = '4210 Store Discounts −$12,000 −$12K 12 thousand';
  const prepaid = '1450 Prepaid Expenses and Deposits $12,000 $12K';
  for (const typed of ['−$12,000', '-12,000', '(12,000)', '-$12K']) {
    assert.ok(finds(discounts, typed), `${typed} finds −$12,000`);
    assert.ok(!finds(prepaid, typed), `${typed} never finds $12,000`);
  }
  assert.ok(finds(discounts, '12,000') && finds(prepaid, '12,000'), 'no sign: both');
  assert.ok(finds('Accumulated Depreciation (20,000)', '-$20K'), 'brackets are below zero too, in what\'s written');
  assert.ok(!finds('2026 net $676,045 +$676K', '-676k'), 'a figure above zero never by its amount below');
  assert.deepEqual(termsOf('(2024)'), ['2024'], 'a year in brackets is a year');
  const mark = (t, text) => new RegExp(termRe(termsOf(t)[0]), 'i').exec(text)?.[0] || null;
  assert.equal(mark('-12,000', '4210 Store Discounts −$12,000, on the statement'), '−$12,000');
  assert.equal(mark('(12,000)', 'Discounts (12,000)'), '(12,000)');
  assert.equal(mark('−$12,000', '1450 Prepaid $12,000'), null);
});

// ─── 7: a change that rounds to nothing ───
test('a change that rounds to 0% says Even, the same rule everywhere one is shown', () => {
  assert.equal(changeOf(200000, 200000), 'Even', 'Gala beside its $200,000 (sh-neg2.json)');
  assert.equal(changeOf(401234, 400000), 'Even', 'Donations $401,234 beside $400,000 (sh-many.json)');
  assert.equal(changeOf(415000, 830000), '▼ 50%');
  assert.equal(changeOf(90000, 0), '', 'nothing to set it beside');
  assert.equal(ptsOf(0.401, 0.398), 'Even');
  assert.equal(ptsOf(0.4, 0.54), '▼ 14 pts');
  assert.equal(storeChange({ k: 'sales', amount: 401234, last: 400000 }), 'Even');
  assert.equal(storeChange({ k: 'profit', amount: 165000, last: 450000 }), '▼ $285K');
  // (the cash against a year before, the same way: never "▼ $0")
  const cashEven = { live: false, total: 375000, prior: 375000.2, asOf: 'Sep 23, 2026', accounts: [] };
  assert.equal(moneyTiles({ cash: cashEven, budget: null, n: null })[0].sub, 'As of Sep\u00a023 · Even with a year before');
  assert.equal(moneyTiles({ cash: cashEven, budget: null, n: null })[0].tone, '');
  // (shares unchanged by it: round 8's rule)
  assert.deepEqual(sharesOf([600, 395, 5], 1000), ['60%', '40%', 'under 1%']);
});

// ─── 2: the search's money is made from what draws it ───
const BOOKS = {
  company: 'Example Charity', year: String(Y0), from: `${Y0}-01-01`, through: day(0), revenue: 1876045, expenses: 1200000, net: 676045, nonCash: 220000, at: new Date().toISOString(), stale: false,
  sources: [cat('donations', 'Donations', 700000), cat('store', 'Store sales', 415000, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000), cat('inkind', 'In kind', 220000), cat('grants', 'Grants', 90000), cat('account:golf classic', 'Golf Classic', 30000), cat('account:rent', 'Rent', 16000), cat('account:interest', 'Interest', 5000), cat('account:makeover', 'Makeover', 45)],
  store: { sales: 415000, cost: 250000, profit: 165000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] }, lastYear: LAST,
  monthly: { year: String(Y0), lastYear: String(Y0 - 1), months: Array.from({ length: 11 }, (_, i) => ({ month: `${Y0}-${String(i + 1).padStart(2, '0')}`, revenue: 170550, spent: 109091, nonCash: 20000 })), last: Array.from({ length: 12 }, (_, i) => ({ month: `${Y0 - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000, spent: 125000, nonCash: 8000 })) },
  statements: { asOf: day(-30), closed: false, priorAsOf: `${Y0 - 1}${day(-30).slice(4)}`,
    position: [{ k: 'head', label: 'Assets', d: 0 }, { k: 'acct', label: '1450 Prepaid Expenses and Deposits', d: 3, a: 12000, p: 0 }, { k: 'total', label: 'TOTAL ASSETS', d: 0, a: 870767, p: 794994 }],
    activity: [{ k: 'head', label: 'Income', d: 0 }, { k: 'acct', label: '4210 Store Discounts', d: 1, a: -12000, p: -9000 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, p: 1909703 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, p: 176000 }] },
  budget: { name: 'Budget_FY26_P&L', from: `${Y0}-01-01`, to: `${Y0}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 }, rows: [{ k: 'head', label: 'Income', d: 0 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }] },
};
const CASH = { live: true, total: 375000, asOf: shortDay(day(0)), today: true, at: new Date().toISOString(), prior: null, priorAsOf: '', accounts: [{ bank: 'Mercury', name: 'Operating', balance: 312500 }, { bank: 'Mercury', name: 'Reserve', balance: 62500 }], owed: [], banks: ['Mercury'], stale: [] };
function shortDay(d) { return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
const DATA = {
  today: day(0), cashHistory: [], snapshot: { year: Y0 - 1, totalRevenue: 1000000, totalExpenses: 900000, programExpenses: 750000, netAssets: 400000, contributions: 600000, storeRevenue: 300000, programPct: 83 },
  gifts: { year: Y0, count: 2, total: 2675000, list: [{ id: 'g1', at: Date.now() / 1000, cents: 2500000, name: 'Lee Sample', company: '', campaign: 'Evening of Sunshine' }, { id: 'g2', at: Date.now() / 1000, cents: 175000, name: 'Casey Example', company: '', campaign: '' }] },
  meetings: [{ id: 'm_next', date: day(9), title: 'Board meeting', sections: [{ id: 's1', title: 'Finance', items: [{ id: 'i_cash', title: 'Year to date', live: 'cash' }] }] }],
  numbers: { books: BOOKS, mercury: { empty: false }, finance: { ytd: { year: Y0, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 }, cash: { lowest: { dollars: 210000, week: day(40) }, in13Weeks: 260000, floor: 150000 } },
    projects: { building: [], waiting: [] }, reveals: [], operating: { balance: 500000 },
    costs: { makeovers: [], waiting: [], underway: [], reveals: [], plan: {} } },
};
const BUDGET = withBooks(booksBudget(BOOKS), BOOKS);
const FIGS = figures ? figures.moneyFigures(DATA, { cash: CASH, budget: BUDGET }) : [];
/** The figure search finds for what's typed, as the finder does: its title and its line as what was typed found it */
const search = (typed) => {
  need();
  const plan = planOf(termsOf(typed));
  // (an amount typed exactly finds a figure by that amount alone, as the finder reads it: ./portal.js Finder)
  const exact = { ...plan, terms: plan.terms.map((t) => (/^(minus)?\d{3,}$/.test(t.w) ? { w: t.w, alts: [], small: t.small } : t)) };
  return FIGS.filter((x) => matches(prep(x.hay), x.exact ? exact : plan)).map((x) => { const p = x.exact ? exact : plan; return { ...x, said: (x.says && !matches(x.sp0, p) && x.says.find((a) => matches(a.sp, p))) || x }; });
};
const AMOUNT = /[−-]?\+?\$\d[\d,]*(?:\.\d+)?(?:\s?[KMB])?/g;

test('every figure a tile writes, on Home, on Financials and in a meeting’s money (its slide), is found by search as it is written', () => {
  need();
  const tiles = [
    ...figures.figureTiles({ data: DATA, cash: CASH, budget: BUDGET, variant: 'home' }), ...figures.figureTiles({ data: DATA, cash: CASH, budget: BUDGET, variant: 'fin' }),
    ...moneyTiles({ cash: CASH, budget: BUDGET, n: DATA.numbers }), ...moneyTiles({ cash: CASH, budget: BUDGET, n: DATA.numbers, as: 'usd' }),
  ];
  let seen = 0;
  for (const t of tiles) {
    const words = [t.value, t.sub, t.note, t.aside].filter(Boolean).join(' · ');
    const written = words.match(AMOUNT) || [];
    // (every amount in a tile's words is one it kept as it wrote it: nothing written past ./money.js writer)
    assert.deepEqual(written.map((w) => w.replace(/^\+/, '')).sort(), (t.figs || []).map((f) => f.said.replace(/^\+/, '')).sort(), `${t.key || t.k}: “${words}”`);
    for (const f of t.figs || []) {
      seen += 1;
      const hit = search(f.said).find((x) => x.said.sub.includes(f.said.replace(/^\+/, '')) || x.said.sub.includes(`$${Math.abs(f.v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`));
      assert.ok(hit, `“${f.said}” (${t.label}) is found, its line saying it`);
    }
  }
  assert.ok(seen >= 20, `the tiles' figures, ${seen} of them`);
});

test('a short form finds the figure whose shown short form it is, and its exact amount too ("$1.88M", "1876045": the chart’s 2026 so far)', () => {
  const chart = (typed) => search(typed).find((x) => /revenue, in kind included/.test(x.title));
  assert.ok(chart('$1.88M') && chart('1876045') && chart('1.88 million'), JSON.stringify(search('$1.88M').map((x) => x.title)));
  assert.equal(chart('1876045').focus, 'fy-rev-cap', 'landing on the chart’s caption');
  assert.ok(chart('$1.88M').marks.includes('1876045'), 'marked there in its exact form too');
  for (const [typed, title] of [['$1.8M', `${Y0} revenue budget`], ['1,300,000', `${Y0} expenses budget`], ['$1.5M', `${Y0 - 1} revenue by`], ['$2M', `${Y0 - 1} revenue, the whole year`], ['$1.03M', `${Y0 - 1} expenses, same days`], ['$1.4M', `${Y0 - 1} expenses, the whole year`],
    ['$26,750', 'Major gifts'], ['$500,000', 'Kept to run SOARD'], ['$125,000', 'For makeovers now'], ['$1,000,000', `${Y0 - 1} money in`], ['$750,000', `${Y0 - 1} programs`], ['$276K', `${Y0} net, against`], ['$285K', 'The store’s profit'], ['$830,000', /* r10: each store line its own entry, so last year's sales are by name */ 'The store’s sales, '],
    ['$210,000', 'Lowest ahead'], ['$260K', 'Cash in 13 weeks'], ['$62K', 'Reserve'], ['$62.5K', 'Reserve']]) {
    const hit = search(typed).find((x) => x.title.startsWith(title));
    assert.ok(hit, `“${typed}” finds ${title} (${JSON.stringify(search(typed).map((x) => x.title))})`);
    assert.ok(hit.href && hit.focus, `${title} lands somewhere`);
  }
  // (the form a tile writes it in, said in its line: the meeting's cash writes Reserve as "$62K", its accounts adding up)
  assert.match(search('$62K').find((x) => x.title === 'Reserve').said.sub, /^\$62,500 \(\$62K\)/);
});

test('a statement line found by its other column says that column, marked, the short form beside it when it rounds', () => {
  const line = (typed, title) => search(typed).find((x) => x.title === title)?.said;
  assert.match(line('$1,909,703', 'Total Income').sub, /^\$1,909,703 \(\$1\.91M\), the same days in \d{4}, on the statement of activities/);
  assert.ok(line('$1,909,703', 'Total Income').marks.includes('1909703'));
  assert.match(line('176000', 'Net Income').sub, /^\$176,000, the same days in/);
  assert.match(line('1.88M', 'Total Income').sub, /^\$1,884,217 \(\$1\.88M\), on the statement of activities/, 'this year’s, its short form beside it');
  assert.match(line('$25,486', 'Total Income').sub, /^\$25,486 \(\$25K\) less than the same days/, 'the change, in dollars');
  assert.match(line('$1,666,667', 'Total Income').sub, /^\$1,666,667 \(\$1\.67M\), its budget, on the budget against actual/, 'the budget’s column');
  assert.match(line('total income', 'Total Income').sub, /^\$1,884,217/, 'by its name: this year’s');
  // (an amount typed exactly is that amount: "$25,000" is never the $25,486 change its line writes "$25K", nor "1,884,000"
  // the $1,884,217 written "$1.88M")
  assert.ok(!search('$25,000').some((x) => x.title === 'Total Income'), JSON.stringify(search('$25,000').map((x) => x.title)));
  assert.ok(search('$25,000').some((x) => /from Lee Sample/.test(x.title)), 'the $25,000 gift');
  assert.ok(search('$25K').some((x) => x.title === 'Total Income'), 'its short form still finds it');
  // (below zero, by its sign: only the store's discounts, never the prepaid $12,000)
  assert.deepEqual(search('−$12,000').map((x) => x.title), ['4210 Store Discounts']);
  assert.deepEqual(search('12,000').map((x) => x.title).sort(), ['1450 Prepaid Expenses and Deposits', '4210 Store Discounts']);
});

test('every entry is a figure with somewhere to land; none twice by the same key', () => {
  need();
  const keys = new Set();
  for (const x of FIGS) {
    assert.ok(x.title && x.sub && x.hay && x.href && x.focus, JSON.stringify(x).slice(0, 200));
    assert.ok(!keys.has(x.key), `one ${x.key}`);
    keys.add(x.key);
    assert.ok(!/[\u2013\u2014]/.test(`${x.title} ${x.sub}`), `no dashes: ${x.title} ${x.sub}`);
  }
});
