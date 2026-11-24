// Board QA round 12, the members' page: real money has cents, so every figure here does (the tester's QA_CENTS: Mercury
// $312,500.49 and $62,500.49, QuickBooks' categories .45, expenses $1,200,000.60). Wherever a total and its parts are
// drawn together they add up as written, and a figure worked out from others (the net, a change, the store's profit,
// money out) is worked out from them as written (1); what's left out of expenses named by one helper (2); the cash
// card's lines and search from one list, the smaller accounts together (3); What makeovers cost's rooms found (4); this
// month's end said so far (5); a budget sheet's year read from its heading (6); one amount said once (7); a read that
// failed is said so, never drawn as a fact, and never found (8). The drawing, the landing and the words in the browser:
// scripts/test-board-round12-member.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import * as money from '../public/admin/board/money.js';
import * as figures from '../public/admin/board/figures.js';
import * as board from '../functions/api/_board.js';
import { createD1 } from './lib/d1-shim.mjs';
import { writeState } from '../functions/api/_board-roles.js';

const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const Y0 = Number(day(0).slice(0, 4));
const r2 = (n) => Math.round(n * 100) / 100;
const cat = (key, name, amount, accounts = [name]) => ({ key, name, amount, accounts });
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
/** "$1,656,049" → 1656049, "−$12" → -12, "+$676K" → 676000 */
const amountOf = (s) => { const m = String(s).match(/([−-])?\+?\$([\d,.]+)([KMB])?/); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]] || 1) : NaN; };

// QuickBooks' year with cents (the tester's QA_CENTS), and with $8,000 of depreciation among its non-cash (QA_SOURCES=sh-dep)
const SOURCES = [cat('donations', 'Donations', 700000.45), cat('store', 'Store sales', 415000.45, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000.45), cat('inkind', 'In kind', 220000.3),
  cat('grants', 'Grants', 90000.45), cat('account:golf classic', 'Golf Classic', 30000.45), cat('account:rent', 'Rent', 16000.45), cat('account:interest', 'Interest', 5000.45), cat('account:makeover', 'Makeover', 45.5)];
const REVENUE = r2(SOURCES.reduce((t, x) => t + x.amount, 0));
const LAST = { year: String(Y0 - 1), through: `${Y0 - 1}${day(0).slice(4)}`, revenue: 1500001, expenses: 1100000.4, net: 399999.6, nonCash: 70000.25, full: { revenue: 2000000.5, expenses: 1500000.5, net: 500000, nonCash: 100000.5 },
  sources: [cat('donations', 'Donations', 400000.25), cat('store', 'Store sales', 830000.25), cat('gala', 'Gala', 200000.25), cat('inkind', 'In kind', 70000.25)],
  store: { sales: 830000.45, cost: 380000.5, profit: 449999.95, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
function booksOf({ dep = false, budget = true } = {}) {
  return {
    company: 'Example Charity', year: String(Y0), from: `${Y0}-01-01`, through: day(0), revenue: REVENUE, expenses: 1200000.6, net: r2(REVENUE - 1200000.6), nonCash: dep ? 228000.3 : 220000.3, at: new Date().toISOString(), stale: false,
    sources: SOURCES, store: { sales: 415000.45, cost: 250000.5, profit: 164999.95, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] }, lastYear: LAST,
    monthly: { year: String(Y0), lastYear: String(Y0 - 1), months: Array.from({ length: Number(day(0).slice(5, 7)) }, (_, i) => ({ month: `${Y0}-${String(i + 1).padStart(2, '0')}`, revenue: 170550.45, spent: 109091.15, nonCash: 20000.05 })), last: Array.from({ length: 12 }, (_, i) => ({ month: `${Y0 - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000 + 0.45, spent: 125000.35, nonCash: 8000.05 })) },
    budget: budget ? { name: 'Budget_FY26_P&L', from: `${Y0}-01-01`, to: `${Y0}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 }, rows: [] } : null,
    functions: { list: [{ name: 'Program Services', amount: 760000.45 }, { name: 'Management and General', amount: 130000.45 }, { name: 'Fundraising', amount: 70000.45 }, { name: 'Store Operations', amount: 15000.45 }, { name: 'Unassigned', amount: 4999.2 }], total: 980001 },
  };
}
const cashOf = (accts) => ({ live: true, total: r2(accts.reduce((t, [, b]) => t + b, 0)), asOf: 'Nov 23, 2026', today: true, at: new Date().toISOString(), prior: 340000.25, priorAsOf: `November ${Y0 - 1}`, accounts: accts.map(([name, balance]) => ({ bank: 'Mercury', name, balance })), owed: [], banks: ['Mercury'], stale: [] });
const CASH = cashOf([['Operating', 312500.49], ['Reserve', 62500.49]]);
const FINANCE = { ytd: { year: Y0, through: day(0), income: 900000.6, makeovers: 500000.5, store: 150000.5, operating: 200000.4, net: 49999.2 }, lastYtd: { year: Y0 - 1, through: day(-365), income: 800000.4, makeovers: 480000.35, store: 140000.35, operating: 200000.35, net: -20000.65 },
  months: [{ month: day(0).slice(0, 7), income: 80000.45, makeovers: 40000.45, store: 12000.45, operating: 18000.45, net: 9999.65 }], cash: { lowest: { dollars: 210000, week: day(40) }, in13Weeks: 260000, floor: 150000 }, perMakeover: { count: 12, average: 21000 } };
const MEETING = { id: 'm_next0001', date: day(9), title: '', sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_fin0001', title: 'Year to date', live: 'cash' }] }], files: [], motions: [], actions: [] };
// What makeovers cost (the tester's QA_COSTS: two dream bedrooms, three bathrooms, one therapy room)
const COSTS = {
  makeovers: [{ key: 'k:ava', name: 'Ava', season: Y0, rooms: ['Bedroom'], type: 'bedroom', cost: 21500 }, { key: 'k:bea', name: 'Bea', season: Y0, rooms: ['Bedroom'], type: 'bedroom', cost: 26400 },
    { key: 'k:ben', name: 'Ben', season: Y0, rooms: ['Bathroom'], type: 'bathroom', cost: 34250 }, { key: 'k:dee', name: 'Dee', season: Y0 - 1, rooms: ['Bathroom'], type: 'bathroom', cost: 30100 }, { key: 'k:eli', name: 'Eli', season: Y0 - 1, rooms: ['Bathroom'], type: 'bathroom', cost: 41000 },
    { key: 'k:cal', name: 'Cal', season: Y0 - 1, rooms: ['Therapy Room'], type: 'therapy', cost: 18750 }],
  underway: [], waiting: [],
};
const GIFTS = { count: 2, total: 3000000, year: Y0, list: [{ id: 'p1', cents: 2500000, name: 'Lee Sample', at: Math.floor(Date.now() / 1000) - 86400 }, { id: 'p2', cents: 500000, name: 'Dana Example', at: Math.floor(Date.now() / 1000) - 2 * 86400 }] };
const dataOf = (books, { costs = COSTS, unread = {}, finance = FINANCE } = {}) => ({
  today: day(0), cashHistory: [], meetings: [MEETING], gifts: GIFTS, snapshot: null, unread,
  numbers: { books, mercury: { empty: false }, finance, projects: { building: [], waiting: [] }, reveals: [], operating: { balance: 150000 }, costs, unread: {} },
});
const budgetOf = (books) => (books ? money.withBooks(money.booksBudget(books), books) : null);
const figsOf = (books, o = {}, cash = CASH) => figures.moneyFigures(dataOf(books, o), { cash, budget: budgetOf(books) });
const entry = (figs, key) => figs.find((x) => x.key === key);

// ─── 1: with cents, a total and its parts add up as written ───
test('r12 1: the cash, the year so far, where the money came from, where it went, the store and Mercury’s year add up as written, in search as on the page', () => {
  const books = booksOf();
  const figs = figsOf(books);
  // The cash in the bank: $375,001, its accounts $312,501 and $62,500 (search's lines are the card's)
  const cashSaid = amountOf(entry(figs, 'cash').sub);
  assert.equal(cashSaid, 375001);
  const accts = ['Operating', 'Reserve'].map((n) => amountOf(figs.find((x) => x.title === n && /bank account/.test(x.sub)).sub));
  assert.equal(accts[0] + accts[1], cashSaid, `the accounts, ${accts.join(' + ')}, are the cash beside them`);
  // The meeting's cash tile in short: $313K and $62K, $375K
  const tile = money.moneyTiles({ cash: CASH, budget: budgetOf(books), n: { books } }).find((t) => t.k === 'bank');
  const short = [...tile.sub.matchAll(/\$[\d.]+K/g)].map((m) => amountOf(m[0]));
  assert.equal(short.reduce((t, x) => t + x, 0), 375000, tile.sub);
  // The year so far: revenue less expenses is the net, as written ($1,656,049 less $980,000 is $676,049)
  const y = money.yearFigures(books);
  assert.equal(amountOf(usd(y.revenue)) - amountOf(usd(y.expenses)), amountOf(usd(y.net)), `${usd(y.revenue)} less ${usd(y.expenses)} is ${usd(y.net)}`);
  // (each of them worked out from QuickBooks' own, as written beside them: $1,876,049 less $220,000 in kind, and
  // $1,200,001 less $220,000 of in kind)
  assert.equal(y.revenue, amountOf(usd(books.revenue)) - amountOf(usd(220000.3)));
  assert.equal(y.expenses, amountOf(usd(books.expenses)) - amountOf(usd(books.nonCash)));
  assert.equal(amountOf(entry(figs, 'yr:net').sub), amountOf(usd(y.net)), 'search says the net the page draws');
  assert.equal(amountOf(entry(figs, 'yr:rev').sub), amountOf(usd(y.revenue)));
  // QuickBooks' own three (in kind in), as written, and last year's same days
  assert.equal(amountOf(usd(y.books.revenue)) - amountOf(usd(y.books.expenses)), amountOf(usd(y.books.net)));
  assert.equal(amountOf(usd(y.last.revenue)) - amountOf(usd(y.last.expenses)), amountOf(usd(y.last.net)));
  // Where the money came from: the parts are the revenue beside them ($1,656,049), never $1,656,047
  const mix = money.mixOf(books);
  assert.equal(mix.parts.reduce((t, x) => t + x.said, 0), amountOf(usd(y.revenue)), JSON.stringify(mix.parts.map((x) => [x.name, x.said])));
  for (const x of mix.parts) assert.equal(amountOf(entry(figs, `mix:${x.key}`).sub), x.said, `${x.name}: search says it as its row does`);
  // …and in short, on Home's key, each from its written amount
  assert.deepEqual(money.mixShort(mix), mix.parts.map((x) => money.compact(x.said)));
  // Where it went: the parts are the total
  const went = money.wentParts(books.functions);
  assert.equal(went.list.reduce((t, x) => t + x.said, 0), went.total);
  assert.equal(amountOf(entry(figs, 'fn:total').sub), went.total);
  // The store: its profit is its sales less its cost of goods as written ($415,000 less $250,001)
  const st = money.storeOf(books);
  assert.equal(st.lines[0].amount - st.lines[1].amount, st.lines[2].amount, JSON.stringify(st.lines.map((l) => l.amount)));
  assert.equal(st.lines[0].last - st.lines[1].last, st.lines[2].last);
  // A change in dollars is one figure less the other as written
  assert.equal(money.changeIn(375000.98, 340000.25, 'usd'), '▲ $35,001', '$375,001 less $340,000');
});

test('r12 1: Mercury’s year: money out is its three parts and the net is money in less money out, as written, on the tile, Financials and search', () => {
  const data = dataOf(null);
  const tile = money.moneyTiles({ cash: CASH, budget: null, n: data.numbers }).find((t) => t.k === 'ytd');
  const [inSaid, outSaid] = [...tile.sub.matchAll(/\$[\d.,]+K?/g)].map((m) => amountOf(m[0]));
  assert.equal(Math.round(inSaid / 1000) - Math.round(outSaid / 1000), Math.round(amountOf(tile.value) / 1000), `${tile.value} / ${tile.sub}`);
  const figs = figures.moneyFigures(data, { cash: CASH, budget: null });
  const row = (k) => amountOf(figs.find((x) => x.focus === `io-${k}`).sub);
  assert.equal(row('makeovers') + row('store') + row('operating'), row('out'), `search, as Financials’ table: ${['in', 'out', 'makeovers', 'store', 'operating', 'net'].map(row).join(', ')}`);
  assert.equal(row('in') - row('out'), row('net'));
  const io = money.ioOf?.(FINANCE.ytd);
  assert.equal(io.makeovers + io.store + io.operating, io.out);
  assert.equal(io.in - io.out, io.net);
});

// ─── 2: what's left out of expenses, named one way ───
test('r12 2: what’s left out of expenses is “in kind and depreciation” only when depreciation is among it, the same on the tiles, the budget, the meeting, the words and search', () => {
  for (const [dep, name] of [[true, 'in kind and depreciation'], [false, 'in kind']]) {
    const books = booksOf({ dep });
    const data = dataOf(books);
    const budget = budgetOf(books);
    const home = figures.figureTiles({ data, cash: CASH, budget }).find((t) => t.key === 'exp');
    assert.equal(home.aside, `Not counting ${dep ? '$228K' : '$220K'} ${name}`, 'the expenses tile on Home and Financials');
    const meet = money.moneyTiles({ cash: CASH, budget, n: { books } }).find((t) => t.k === 'exp');
    assert.ok(meet.sub.endsWith(`not counting ${dep ? '$228K' : '$220K'} ${name}`), `the meeting’s tile: ${meet.sub}`);
    assert.equal(money.nonCashOf?.(books), name, 'the budget card (its expenses line, from the same books)');
    assert.equal(money.nonCashName?.(money.yearFigures(books).inKind), name);
    const figs = figsOf(books);
    const nc = figs.find((x) => x.key.startsWith('exp:nc'));
    assert.equal(nc.title, `${name[0].toUpperCase()}${name.slice(1)} in ${Y0}’s expenses`, 'search');
    // (no word of depreciation anywhere when there's none)
    if (!dep) for (const x of figs) assert.ok(!/depreciation/.test(`${x.title} ${x.sub}`), `${x.title} | ${x.sub}`);
  }
  assert.equal(money.inKindWords({ given: 220000.3, used: 228000.3 }), 'Not counting $220K given in kind and $228K of in kind and depreciation in expenses.');
});

// ─── 3: the smaller accounts, one list for the card and search ───
test('r12 3: the cash card lists its accounts whenever there are two or more, the smaller ones together, and every search entry for them lands on a line it draws', () => {
  const many = cashOf([['Operating', 370000.45], ['Savings', 1500.25], ['Petty Cash', 900.25], ['PayPal', 700.25], ['Square', 400.25]]);
  const lines = money.cashLines?.(many) || [];
  assert.deepEqual(lines.map((l) => [l.id, l.name]), [['cash-a0', 'Operating'], ['cash-a-rest', 'Savings, Petty Cash, PayPal and Square']]);
  assert.equal(lines.reduce((t, l) => t + l.said, 0), amountOf(usd(many.total)), 'the lines are the total as written');
  const figs = figsOf(booksOf(), {}, many);
  const ours = figs.filter((x) => /^cash-a/.test(x.focus));
  assert.ok(ours.some((x) => x.focus === 'cash-a-rest' && amountOf(x.sub) === lines[1].said), JSON.stringify(ours.map((x) => [x.title, x.focus])));
  for (const x of ours) assert.ok(lines.some((l) => l.id === x.focus && amountOf(x.sub) === l.said), `${x.title} lands on a line the card draws, as it says it (${x.focus})`);
  // Two accounts: both by name; one: none (the total is it); one small among five: by its name
  assert.deepEqual((money.cashLines?.(CASH) || []).map((l) => l.id), ['cash-a0', 'cash-a1']);
  assert.deepEqual(money.cashLines?.(cashOf([['Operating', 375000]])) || [], []);
  assert.deepEqual((money.cashLines?.(cashOf([['A', 100000], ['B', 100000], ['C', 100000], ['D', 100000], ['E', 900]])) || []).map((l) => l.name), ['A', 'B', 'C', 'D', 'E']);
});

// ─── 4: every figure What makeovers cost draws is found ───
test('r12 4: each room’s row of What makeovers cost, its median and average, is found and lands on that row', () => {
  const figs = figsOf(booksOf());
  const bed = figs.find((x) => x.focus === 'bc-r-bedroom');
  assert.ok(bed, `the dream bedrooms’ row (${JSON.stringify(figs.filter((x) => /^bc-/.test(x.focus)).map((x) => x.focus))})`);
  assert.equal(bed.title, 'Dream bedroom, 2 makeovers');
  assert.equal(amountOf(bed.sub), 23950, bed.sub);
  // the bathrooms: the median and the average apart ($34,250 and $35,117)
  const bath = figs.filter((x) => x.focus === 'bc-r-bathroom').map((x) => amountOf(x.sub)).sort();
  assert.deepEqual(bath, [34250, 35117]);
  // (one therapy room is its own makeover, found as that)
  assert.ok(!figs.some((x) => x.focus === 'bc-r-therapy'));
});

// ─── 5: this month is so far ───
test('r12 5: a period that runs to this month ends on its day, so far; a month that’s over by its name', () => {
  assert.equal(money.throughWords?.('2026-11-23', '2026-11-23'), 'through November 23');
  assert.equal(money.throughWords?.('2026-10-31', '2026-11-23'), 'through October');
  const tile = money.moneyTiles({ cash: CASH, budget: null, n: dataOf(null).numbers }).find((t) => t.k === 'ytd');
  const today = new Date(`${day(0)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  assert.ok(tile.sub.endsWith(`, through ${today}`), tile.sub);
});

// ─── 6: a budget sheet's year ───
/** A real ZIP of { name: text } (an .xlsx's parts) */
function zip(files) {
  const enc = new TextEncoder();
  const locals = []; const central = []; let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const nameB = enc.encode(name); const raw = enc.encode(body); const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const sheet = (rows) => zip({ 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => (c === '' ? '' : typeof c === 'number' ? `<c r="${String.fromCharCode(65 + ci)}${ri + 1}"><v>${c}</v></c>` : `<c r="${String.fromCharCode(65 + ci)}${ri + 1}" t="inlineStr"><is><t>${c}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>` });
/** The budget the page reads from a packet's sheet headed `head` (named `name`), without QuickBooks */
async function budgetFrom(head, name = 'Budget vs Actual.xlsx', id = `bf_${Math.random().toString(36).slice(2, 10)}`) {
  const bytes = sheet([['SOARD Budget vs. Actuals'], ['', head, 'Actual as of September 30, 2026'], ['Revenue Total', 2000000, 1500000], ['Total Expenses', 1500000, 1100000]]);
  const was = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes);
  try {
    const data = { today: day(0), meetings: [{ id: 'm_old', date: day(-60), files: [{ id, name, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'financials' }] }], numbers: {} };
    for (let k = 0; k < 20 && money.budgetKnown(data) === undefined; k++) await new Promise((r) => setTimeout(r, 20));
    return { data, budget: money.budgetKnown(data) };
  } finally { globalThis.fetch = was; }
}
test('r12 6: a budget sheet’s year is read from its heading or its name, so the tiles and the heading carry it; with none, no fragment and no year guessed', async () => {
  const forms = { 'FY2026 Budget': ['2026', 'FY2026'], 'FY 2026 Budget': ['2026', 'FY2026'], 'FY26 Budget': ['2026', 'FY2026'], "FY'26": ['2026', 'FY2026'], '2026 Budget': ['2026', ''], 'Budget 2025-26': ['2026', '2025-26'], '2025/2026 Budget': ['2026', '2025-26'], '2025–2026': ['2026', '2025-26'], Budget: ['', ''] };
  for (const [s, [year, label]] of Object.entries(forms)) assert.deepEqual(money.sheetYear?.(s), { year, label }, s);
  // The tester's sheet: "FY2026 Budget", no QuickBooks
  const { data, budget } = await budgetFrom('FY2026 Budget');
  assert.equal(budget?.year, 'FY2026', JSON.stringify(budget));
  const tiles = figures.figureTiles({ data, cash: null, budget });
  assert.deepEqual(tiles.filter((t) => t.key === 'rev' || t.key === 'exp').map((t) => t.label), ['FY2026 revenue', 'FY2026 expenses']);
  assert.deepEqual(money.moneyTiles({ cash: null, budget, n: {} }).map((t) => t.label), ['FY2026 revenue', 'FY2026 expenses']);
  assert.equal(money.budgetHeading?.(budget.year), 'FY2026 against its budget');
  // …the year in the sheet's name when its heading has none
  assert.equal((await budgetFrom('Budget', '2026 Budget vs Actual.xlsx')).budget?.year, '2026');
  // None at all: whole words in their own case, never "revenue" alone or a year guessed
  const none = await budgetFrom('Budget', 'Budget vs Actual.xlsx');
  assert.deepEqual(figures.figureTiles({ data: none.data, cash: null, budget: none.budget }).filter((t) => t.key === 'rev' || t.key === 'exp').map((t) => t.label), ['Revenue', 'Expenses']);
  assert.equal(money.budgetHeading?.(none.budget.year), 'The budget, against what’s come in');
});

// ─── 7: one amount said once ───
test('r12 7: a search line gives the short form only when it reads differently from the full one', () => {
  const figs = figsOf(booksOf());
  const mk = figs.find((x) => x.title === 'Makeover');
  assert.equal(mk.sub, `$46 of ${Y0}’s revenue so far, in Everything else`);
  for (const x of figs) assert.ok(!/(\$[\d,.]+[KMB]?), or \1\b/.test(x.sub), `said twice: ${x.sub}`);
  assert.equal(figures.both(1656045), '$1,656,045, or $1.66M');
  assert.equal(figures.both(45.5), '$46');
  assert.equal(figures.both(9999.5), '$10,000, or $10K'.replace(', or $10K', ''), 'under $10K the short form is the same dollars');
});

// ─── 8: a read that failed ───
test('r12 8: a part whose read failed is never drawn as a figure nor found: the money one tile of words, the gifts apart', () => {
  const books = booksOf();
  const lost = dataOf(books, { unread: { money: true } });
  const home = figures.figureTiles({ data: lost, cash: CASH, budget: budgetOf(books) });
  assert.deepEqual(home.map((t) => [t.key, t.value]), [['money', 'Couldn’t load just now'], ['build', '0']]);
  assert.ok(home.every((t) => !t.figs.length));
  assert.deepEqual(figures.figureTiles({ data: lost, cash: CASH, budget: budgetOf(books), variant: 'fin' }), []);
  const figs = figures.moneyFigures(lost, { cash: CASH, budget: budgetOf(books) });
  assert.deepEqual([...new Set(figs.map((x) => x.focus.replace(/-.*/, '')))], ['gifts', 'gift'], 'only the gifts');
  const noGifts = figures.moneyFigures(dataOf(books, { unread: { gifts: true } }), { cash: CASH, budget: budgetOf(books) });
  assert.ok(noGifts.length > 50 && !noGifts.some((x) => /^gift/.test(x.focus)), 'the money, none of the gifts');
  assert.deepEqual(figures.moneyFigures(dataOf(books, { unread: { money: true, gifts: true } }), { cash: CASH, budget: null }), []);
  // the makeovers' tile says so, never "0" or "None right now"
  const proj = figures.figureTiles({ data: dataOf(books, { unread: { projects: true } }), cash: CASH, budget: budgetOf(books) }).find((t) => t.key === 'build');
  assert.equal(proj.value, 'Couldn’t load just now');
});

// The server: each part a read failed in marked, never a part said empty or as zero
const PEOPLE = [['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }], ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }]];
const SAM = { slug: 'sam-ortiz', name: 'Sam Ortiz', email: 'sam.board@example.org', title: 'Board Treasurer' };
/** A database whose statements matching `when(sql, args)` fail (D1's own words), the rest as they are */
function failing(DB, when) {
  const wrap = (st, sql, args = []) => new Proxy(st, { get(t, p) {
    if (p === 'bind') return (...a) => wrap(t.bind(...a), sql, a);
    if (['first', 'all', 'run', 'raw'].includes(p)) return async (...a) => { if (when(sql, args, p)) throw new Error('D1_ERROR: Network connection lost.'); return t[p](...a); };
    const v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
  } });
  return new Proxy(DB, { get(t, p) { if (p === 'prepare') return (sql) => wrap(t.prepare(sql), sql); const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
}
async function world() {
  const DB = await createD1();
  for (const sql of ['CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)', 'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)', 'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)', 'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)', 'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)']) await DB.exec(sql);
  for (const [slug, d] of PEOPLE) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(SAM.slug, SAM.email).run();
  for (const [slug, name] of [['maya-2026', 'Maya'], ['leo-2025', 'Leo']]) await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, Number(slug.slice(-4)), JSON.stringify({ name, year: Number(slug.slice(-4)), childCount: 1, roomCount: 1 })).run();
  await DB.prepare('INSERT INTO events (slug, data) VALUES (?, ?)').bind('golf', JSON.stringify({ title: 'Sunshine Golf Classic', date: day(20) })).run();
  await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('financials', JSON.stringify({ documents: [{ title: '2025 990 Tax Return', year: 2025, type: '990', url: 'https://files.sunshineonaranneyday.com/financials/example-990.pdf' }] })).run();
  await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('financial-snapshot', JSON.stringify({ year: 2025, totalRevenue: 1000000, totalExpenses: 900000 })).run();
  await board.ensureSchema(DB);
  await writeState(DB, 'gifts', { year: Y0, at: new Date().toISOString(), triedAt: new Date().toISOString(), list: [{ id: 'p1', cents: 2500000, name: 'Lee Sample', at: Math.floor(Date.now() / 1000) - 86400, anonymous: false }] });
  return { DB };
}
const portalWith = async (when) => { const env = await world(); return board.portalData({ ...env, DB: failing(env.DB, when) }, { member: SAM }); };
test('r12 8: the server marks each part whose read failed, and draws none of it as a fact: the kids, the events, the money, the gifts, the tax returns', async () => {
  const clean = await portalWith(() => false);
  assert.deepEqual(clean.unread, {}, 'a clean read marks nothing');
  assert.equal(clean.numbers.impact.kids, 2);
  const kids = await portalWith((sql) => /SELECT slug, data FROM kids/.test(sql));
  assert.equal(kids.unread?.kids, true, JSON.stringify(kids.unread));
  assert.equal(kids.numbers.impact, null, 'never 0 kids served');
  const events = await portalWith((sql) => /FROM events/.test(sql));
  assert.equal(events.unread?.events, true);
  const books = await portalWith((sql) => /FROM books_link/.test(sql));
  assert.equal(books.unread?.money, true, 'QuickBooks’ year not read is the money not loaded');
  const gifts = await portalWith((sql, args) => /FROM board_state/.test(sql) && args[0] === 'gifts');
  assert.equal(gifts.unread?.gifts, true);
  const sources = await portalWith((sql, args) => /FROM site_config/.test(sql) && args[0] === 'financials');
  assert.equal(sources.unread?.sources, true);
  assert.deepEqual(sources.filings, []);
  const env = await world();
  const settings = await board.liveNumbers({ ...env, DB: failing(env.DB, (sql, args) => /FROM board_state/.test(sql) && args[0] === 'settings') });
  assert.equal(settings.unread?.money, true, 'the operating balance not read: What makeovers cost would rest on a guessed one');
});
test('r12 8: a copy the page keeps that fails to save never loses what was just read: Mercury’s record and the makeovers stand', async () => {
  const env = await world();
  board.provideBoardFinance(async () => ({ at: new Date().toISOString(), ytd: FINANCE.ytd }));
  const JOB = { id: 'j1', name: `Maya (${Y0})`, customFieldValues: { nodes: [{ value: 'Build', customField: { id: (await import('../functions/api/_reveals.js')).FIELD_JOB_STATUS } }] } };
  const fetchImpl = async (url) => (String(url).includes('jobtread') ? Response.json({ organization: { jobs: { nodes: [JOB], nextPage: null } } }) : Response.json({ accounts: [] }));
  try {
    const n = await board.liveNumbers({ ...env, JOBTREAD_GRANT_KEY: 'jt-test', DB: failing(env.DB, (sql, args, how) => how === 'run' && /INTO board_state/.test(sql) && ['finance', 'projects'].includes(args[0])) }, { fetchImpl });
    assert.deepEqual(n.unread, {}, JSON.stringify(n.unread));
    assert.equal(n.finance?.ytd?.income, FINANCE.ytd.income, 'the finance read stands');
    assert.equal(n.projects?.building?.[0]?.name, 'Maya', 'the makeovers read stands');
    // …and the kids' pages not read: the makeovers aren't drawn unnamed, they're marked
    const m = await board.liveNumbers({ ...env, JOBTREAD_GRANT_KEY: 'jt-test', DB: failing(env.DB, (sql) => /FROM kids/.test(sql)) }, { fetchImpl, now: Date.now() + 3600_000 });
    assert.equal(m.unread?.projects, true, JSON.stringify(m.unread));
  } finally { board.provideBoardFinance(null); }
});

// ─── 8: the givers' names, when Keep anonymous can't be read ───
test('r12 8: Keep anonymous not read: the gifts come with every name hidden and say so (`namesUnread`), the page’s data marks the givers unread, and the page and search show each gift’s amount and day, never a name or “Anonymous”', async () => {
  const { giftsNow } = await import('../functions/api/_board-gifts.js');
  const clean = await world();
  const named = await giftsNow(clean.DB);
  assert.equal(named.list[0].name, 'Lee Sample', 'read, the name is shown');
  assert.ok(!named.namesUnread);
  // Keep anonymous's read failing (the privacy tester's k=74-75: donor_orgs; and the other reads it rests on)
  for (const re of [/FROM donor_orgs/, /FROM donor_calls/, /FROM partners/]) {
    const env = await world();
    const g = await giftsNow(failing(env.DB, (sql) => re.test(sql)));
    assert.equal(g.namesUnread, true, `${re}: said so`);
    assert.equal(g.count, 1, 'the gifts themselves stand');
    for (const x of g.list) assert.ok(!x.name && !x.company, `${re}: no name in the data (${JSON.stringify(x)})`);
    const page = await board.portalData({ ...(await world()), DB: failing((await world()).DB, (sql) => re.test(sql)) }, { member: SAM });
    assert.equal(page.unread?.givers, true, `${re}: the page’s data marks the givers unread (${JSON.stringify(page.unread)})`);
    assert.ok(!page.unread?.gifts, 'the gifts did load');
    assert.ok(page.gifts.list.every((x) => !x.name && !x.company));
    // Search: each gift by its amount and day, no name, no campaign, never "Anonymous"
    const data = { ...dataOf(booksOf()), gifts: page.gifts, unread: page.unread };
    const found = figures.moneyFigures(data, { cash: CASH, budget: budgetOf(booksOf()) }).filter((x) => x.focus.startsWith('gift-'));
    assert.equal(found.length, 1);
    assert.equal(found[0].title, 'A gift of $25,000');
    assert.ok(!/anonymous|Lee Sample|A gift ·/i.test(`${found[0].sub} ${found[0].hay}`), JSON.stringify(found[0]));
    assert.ok(found[0].hay.includes('25,000') || found[0].hay.includes('25000'), 'its amount is found');
  }
});
