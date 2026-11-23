/**
 * The board page as a member found it (QA round 1, Nov 19 2026): the pure logic under each fix, made-up numbers only.
 *   - a file named with a whole date ("Minutes 2025-09-25.pdf") keeps it
 *   - The year so far: three figures that add up, in kind left out of both sides as the tiles do, said once
 *   - "underway" means being built (Design to Build), the same count on Home, the makeovers board and What makeovers
 *     cost; awaiting funding hasn't started; every sub-line adds up
 *   - a held meeting with nothing written isn't "Draft minutes"
 *   - "A family's makeover comes next." (no comma left from a missing price)
 *   - a budget by its year, never QuickBooks' file name; nothing empty said with a dash
 * The page itself is walked in scripts/test-board-member-qa.mjs.
 *
 *   node --test tests/board-member-qa.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docTitle } from '../public/admin/board-shared.js';
import { yearFigures, inKindWords, budgetName, overIn, moneyTiles } from '../public/admin/board/money.js';
import { underwayOf } from '../public/admin/board/stages.js';
import { sumLine } from '../public/admin/board/lifecycle.js';
import { minutesState, MINUTES_SAID } from '../public/admin/board/minutes.js';
import { answerText, screenText } from '../public/admin/board/costs.js';
import { yearSeries } from '../public/admin/board/books.js';

test('a file named with a whole date keeps it whole', () => {
  assert.equal(docTitle('Minutes 2025-09-25.pdf'), 'Minutes 2025-09-25', 'never "Minutes 2025-09 25"');
  assert.equal(docTitle('2025-09-25 Board Minutes.docx'), '2025-09-25 Board Minutes');
  assert.equal(docTitle('Board_Minutes_2024-01-07 (1).pdf'), 'Board Minutes 2024-01-07');
  // (what it did already, unchanged)
  assert.equal(docTitle('Statement of Activity 2025-11.xlsx'), 'Statement of Activity 2025-11');
  assert.equal(docTitle('Minutes-2-9-26.pdf'), 'Minutes 2/9/26');
  assert.equal(docTitle('Budget_2026-27.xlsx'), 'Budget 2026-27');
  assert.equal(docTitle('Q4 2026 Board Meeting minutes (2026-11-05).docx'), 'Q4 2026 Board Meeting minutes (2026-11-05)');
});

// The books as QuickBooks' read has them: revenue with the in-kind gifts in it, expenses with what never left the bank
const cat = (key, amount) => ({ key, name: key, amount });
const BOOKS = {
  year: '2026', revenue: 1876045, expenses: 1200000, net: 676045, nonCash: 220000,
  sources: [cat('donations', 700000), cat('store', 415000), cat('gala', 400000), cat('inkind', 220000), cat('grants', 90000), cat('account:rent', 51045)],
  lastYear: { year: '2025', revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, sources: [cat('donations', 1430000), cat('inkind', 70000)] },
};

test('the year so far: three figures that add up, in kind left out of both sides as the tiles leave it out', () => {
  const y = yearFigures(BOOKS);
  assert.equal(y.revenue, 1656045, 'revenue without the $220K given in kind (the tiles’ $1.66M)');
  assert.equal(y.expenses, 980000, 'expenses without the $220K used in kind');
  assert.equal(y.net, 676045);
  assert.equal(y.revenue - y.expenses, y.net, 'revenue less expenses is the net');
  assert.deepEqual(y.last, { revenue: 1430000, expenses: 1030000, net: 400000 }, 'last year’s same days counted the same way');
  assert.deepEqual(y.books, { revenue: 1876045, expenses: 1200000, net: 676045 }, 'QuickBooks’ own three kept beside them');
  // The tiles' figures (./money.js withBooks, against QuickBooks' own budget) are the same two numbers
  const tiles = moneyTiles({ cash: null, budget: { year: '2026', asOf: 'Nov 19, 2026', revenue: { actual: 1656045, budget: 1800000, inKind: 220000 }, expenses: { actual: 980000, budget: 1300000, inKind: 220000 } }, n: null });
  assert.deepEqual(tiles.map((t) => t.value), ['$1,656,045', '$980,000']);
  assert.equal(inKindWords(y.inKind), 'Not counting the $220K in kind on either side.', 'said once, for both sides');
});

test('the year so far with depreciation too: still adds up, and says what each side leaves out', () => {
  const y = yearFigures({ ...BOOKS, nonCash: 230000, net: 666045 });
  assert.equal(y.expenses, 970000);
  assert.equal(y.revenue - y.expenses, y.net);
  assert.equal(inKindWords(y.inKind), 'Not counting $220K given in kind and $230K of in kind and depreciation in expenses.');
  // A read from before the books kept what never left the bank: QuickBooks' own three, nothing left out to say
  const old = yearFigures({ year: '2026', revenue: 1000, expenses: 600, net: 400 });
  assert.deepEqual([old.revenue, old.expenses, old.net, old.inKind], [1000, 600, 400, null]);
  // Last year read before its categories were kept: not compared, rather than compared another way
  assert.equal(yearFigures({ ...BOOKS, lastYear: { ...BOOKS.lastYear, sources: undefined } }).last.revenue, null);
});

test('the chart under the figures: its revenue leaves in kind out once the months say how much (else says it’s in)', () => {
  const books = (months, last) => ({ year: '2026', lastYear: { year: '2025' }, monthly: { year: '2026', lastYear: '2025', months, last } });
  const withIt = yearSeries(books([{ month: '2026-01', revenue: 1000, spent: 450, nonCash: 100, nonCashIncome: 100 }], [{ month: '2025-01', revenue: 800, spent: 400, nonCash: 50, nonCashIncome: 50 }]));
  assert.equal(withIt.cashIn, true);
  assert.deepEqual([withIt.revenue.now[0], withIt.revenue.then[0], withIt.spent.now[0]], [900, 750, 350], 'in kind out of both lines, as the figures');
  const without = yearSeries(books([{ month: '2026-01', revenue: 1000, spent: 450, nonCash: 100 }], [{ month: '2025-01', revenue: 800, spent: 400, nonCash: 50 }]));
  assert.equal(without.cashIn, false);
  assert.equal(without.revenue.now[0], 1000, 'a read without it: QuickBooks’ own revenue (the chart says in kind is in it)');
});

test('underway means being built, Design to Build, and its parts add up', () => {
  const building = [{ status: 'Build' }, { status: 'Design' }, { status: 'Design' }];
  const u = underwayOf(building);
  assert.equal(u.count, 3, 'awaiting funding is never in it (projects.waiting is its own list)');
  assert.deepEqual(u.parts, ['1 in build', '2 in design'], 'furthest along first');
  const sum = u.parts.reduce((t, p) => t + Number(p.split(' ')[0]), 0);
  assert.equal(sum, u.count, 'the sub-line adds up to the figure');
  assert.deepEqual(underwayOf([{ status: 'Design' }, { status: 'Mobilization' }, { status: 'Finalization' }, { status: 'Build' }, { status: 'Approval' }]).parts, ['1 in build', '1 in mobilization', '1 in approval', '1 in finalization', '1 in design']);
  assert.deepEqual(underwayOf([]), { count: 0, parts: [] });
});

test('the makeovers board’s line: approved and awaiting funding said on their own, never counted as being built', () => {
  const fam = (stage) => ({ id: `f-${stage}-${Math.random()}`, stage });
  const list = [fam('applied'), fam('review'), fam('approved'), fam('funding'), fam('design'), fam('design'), fam('build'), fam('revealed')];
  assert.equal(sumLine(list, 'all', null), '2 families applying · 1 approved · 1 awaiting funding · 3 makeovers being built · 1 revealed');
  const parts = sumLine(list, 'all', null).split(' · ').map((p) => Number(p.split(' ')[0]));
  assert.equal(parts.reduce((a, b) => a + b, 0), list.length, 'every family counted once');
});

test('a held meeting with nothing written yet is never "Draft minutes"', () => {
  const held = { date: '2026-06-22', minutes: 'draft', files: [], sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }], attendance: [{ name: 'A', status: 'present' }], motions: [{ text: 'Adopt the plan', result: 'tabled' }] };
  assert.equal(minutesState(held), 'none');
  assert.equal(MINUTES_SAID[minutesState(held)], 'No minutes yet');
  assert.equal(minutesState({ ...held, minutesFrom: { name: 'Minutes.docx' } }), 'draft', 'read in from a file');
  assert.equal(minutesState({ ...held, files: [{ id: 'f1', kind: 'minutes', name: 'Minutes.pdf' }] }), 'draft', 'a file of them kept with it');
  // (words under the agenda with nothing read in or typed are its background, written before the meeting: QA round 2)
  assert.equal(minutesState({ ...held, sections: [{ title: 'Call to order', items: [{ title: 'Roll call', notes: '- All here' }] }] }), 'none', 'the agenda’s background is never minutes');
  assert.equal(minutesState({ ...held, minutesFrom: { name: 'Minutes (typed)', typed: true }, sections: [{ title: 'Call to order', items: [{ title: 'Roll call', notes: '- All here' }] }] }), 'draft', 'typed in the notes and sent');
  assert.equal(minutesState({ ...held, minutes: 'approved' }), 'approved');
});

test('who comes next when nothing is free: no comma left over from a missing price', () => {
  const plan = { free: -125000, over: -125000, operating: 500000, families: [{ name: 'A family', type: 'mixed', net: null, covered: false }], jobs: [] };
  assert.match(answerText(plan, null), /A family’s makeover comes next\.$/);
  assert.equal(screenText(plan, null), 'Under the $500,000 kept to run SOARD. A family’s makeover comes next.');
  // With a price, it's said between commas
  const priced = { ...plan, families: [{ name: 'Ava', type: 'therapy', net: 18000, covered: false }, { name: 'Ben', type: 'bedroom', net: 9000, covered: false }] };
  assert.match(answerText(priced, null), /Ava’s therapy room, about \$18,000, comes next, then 1 more family\.$/);
  assert.ok(!/, comes next/.test(answerText(plan, null)) && !/, comes next/.test(screenText(plan, null)));
});

test('a budget by its year in plain words, never QuickBooks’ file name; nothing empty said with a dash', () => {
  assert.equal(budgetName({ name: 'Budget_FY26_P&L', from: '2026-01-01', to: '2026-12-31' }), 'QuickBooks’ 2026 budget');
  assert.equal(budgetName({ name: 'Budget_FY27_P&L', from: '2026-08-01', to: '2027-07-31' }), 'QuickBooks’ budget for August 2026 to July 2027');
  assert.equal(budgetName(null, '2026'), 'QuickBooks’ 2026 budget');
  assert.ok(!/_|P&L/.test(budgetName({ name: 'Budget_FY26_P&L' }, '2026')));
  // Nothing to set against: '' for the cell to say so, never "–" (read out as "en dash")
  assert.equal(overIn(null, 5, 'usd'), '');
  const tile = moneyTiles({ cash: { total: NaN, asOf: 'Nov 2, 2026', live: true, accounts: [] }, budget: null, n: null })[0];
  assert.ok(!/[–—]/.test(tile.value) && tile.value, `the cash tile says so in words (${tile.value})`);
});
