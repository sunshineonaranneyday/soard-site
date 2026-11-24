/**
 * The board page as a member found it, QA round 2 (Nov 19 2026): the pure logic under each fix, made-up numbers only.
 *   1. A phone's makeovers track counts what the line above it counts: Building is those being built (Design to
 *      Build), approved and awaiting funding said under it, never in it; everything adds up
 *   2. Words under a held meeting's agenda are its background until minutes are read in or typed and sent: never
 *      "Draft minutes" for background alone
 *   5. What makeovers cost never counts an amount that isn't known as $0, nor says it in a sum
 *   6. Where the revenue came from is of the same revenue as the figure above it: in kind left out when it's left out
 * The page itself is walked in scripts/test-board-member-qa.mjs.
 *
 *   node --test tests/board-member-qa2.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// (whole modules, so a part missing from an older copy fails only the test that needs it)
import * as stages from '../public/admin/board/stages.js';
import * as lifecycle from '../public/admin/board/lifecycle.js';
import * as minutes from '../public/admin/board/minutes.js';
import * as costs from '../public/admin/board/costs.js';
import * as money from '../public/admin/board/money.js';
import { planOf } from '../public/admin/makeover-costs-shared.js';

const fam = (stage, i = 0) => ({ id: `f-${stage}-${i}`, stage });
const many = (stage, n) => Array.from({ length: n }, (_, i) => fam(stage, i));
// "1 awaiting funding · 3 makeovers being built" → { 'awaiting funding': 1, 'being built': 3, ... }
const said = (line) => Object.fromEntries(line.split(' · ').map((p) => { const m = p.match(/^(\d+) (.*)$/); return [m[2].replace(/^(makeovers?|famil(y|ies)) /, ''), Number(m[1])]; }));

test('1. a phone’s track says the same counts as the line above it, and they add up', () => {
  assert.equal(typeof stages.phaseCount, 'function', 'stages.js phaseCount: a stretch of the way in one count');
  for (const list of [
    [fam('funding'), ...many('design', 2), fam('build')], // the tester's: 1 awaiting funding, 3 being built
    [...many('applied', 2), fam('review'), fam('approved'), fam('funding'), fam('design'), fam('mobilization'), ...many('revealed', 4)],
    [...many('approved', 3)], // nothing being built yet
    [fam('finalization'), fam('approval'), fam('build')],
  ]) {
    const counts = stages.countsOf(list);
    const line = said(lifecycle.sumLine(list, 'all', null));
    const building = stages.phaseCount(counts, 'building');
    assert.equal(building.n, line['being built'] || 0, `Building on a phone is the line’s “being built” (${lifecycle.sumLine(list, 'all', null)})`);
    const waiting = Object.fromEntries(building.also.map((x) => { const m = x.match(/^(\d+) (.*)$/); return [m[2], Number(m[1])]; }));
    assert.deepEqual(waiting, Object.fromEntries(['approved', 'awaiting funding'].filter((k) => line[k]).map((k) => [k, line[k]])), 'approved and awaiting funding said under it, as the line says them');
    assert.equal(stages.phaseCount(counts, 'applying').n, line.applying || 0);
    assert.equal(stages.phaseCount(counts, 'revealed').n, line.revealed || 0);
    const all = ['applying', 'building', 'revealed'].reduce((t, p) => t + stages.phaseCount(counts, p).n, 0) + Object.values(waiting).reduce((t, n) => t + n, 0);
    assert.equal(all, list.length, 'every family counted once on the phone’s track');
  }
});

test('2. a held meeting’s agenda background is never minutes, and never “Draft minutes”', () => {
  const held = { date: '2026-11-18', minutes: 'draft', files: [], attendance: [], motions: [],
    sections: [{ title: 'Finance', notes: '', items: [{ id: 'i1', title: 'Year to date', notes: '- Revenue against budget\n- Cash over the next 13 weeks' }] }] };
  assert.equal(minutes.minutesState(held), 'none', 'background points from the agenda, nothing read in or typed');
  assert.equal(minutes.MINUTES_SAID[minutes.minutesState(held)], 'No minutes yet');
  assert.equal(minutes.minutesState({ ...held, sections: [{ title: 'Open forum', notes: 'Questions welcome', items: [] }] }), 'none', 'a part’s own background too');
  // Minutes in: read from a file, typed in the notes and sent, or a file of them kept with it
  assert.equal(minutes.minutesState({ ...held, minutesFrom: { name: 'Minutes.docx', at: '2026-11-18T15:00:00Z' } }), 'draft');
  assert.equal(minutes.minutesState({ ...held, minutesFrom: { name: 'Minutes (typed)', typed: true } }), 'draft');
  const filed = { ...held, files: [{ id: 'f1', kind: 'minutes', name: 'Minutes.pdf' }] };
  assert.equal(minutes.minutesState(filed), 'draft', 'a file of them kept with it');
  // Which words on the page are the minutes: only once they're read in or typed (a file kept beside them leaves the
  // agenda's words its background, so a correction goes under Anything else, never under the background)
  assert.equal(typeof minutes.minutesOnPage, 'function', 'minutes.js minutesOnPage');
  assert.equal(minutes.minutesOnPage(held), false);
  assert.equal(minutes.minutesOnPage(filed), false);
  assert.equal(minutes.minutesOnPage({ ...held, minutesFrom: { name: 'Minutes (typed)', typed: true } }), true);
  assert.equal(minutes.minutesState({ ...held, minutes: 'approved' }), 'approved');
});

test('5. what’s still to come on the makeovers underway: never an unknown counted as $0, nor said in a sum', () => {
  // The tester's: three underway, no budget in JobTread and no completed makeover to go by
  const none = planOf({ cash: 375000, makeovers: [], underway: [{ key: 'a', name: 'Maya', type: 'mixed', paid: 0, budget: null }, { key: 'b', name: 'Leo', type: 'mixed', paid: 0, budget: null }, { key: 'c', name: 'A family', type: 'mixed', paid: 0, budget: null }] });
  assert.equal(none.unknown, 3);
  assert.equal(typeof costs.toComeText, 'function', 'costs.js toComeText: the Underway line');
  const line = costs.toComeText(none);
  assert.ok(!/\$0 still to come|about \$0/.test(line), `no “about $0 still to come” (${line})`);
  assert.ok(!/in all/.test(line), `no total with unknowns in it (${line})`);
  assert.equal(line, '$0 paid so far · what’s still to come isn’t known yet');
  // Some with a budget, some without: the known ones summed and counted, the rest said apart
  const some = planOf({ cash: 700000, makeovers: [], underway: [{ key: 'a', name: 'Kim', type: 'therapy', paid: 8000, budget: 30000 }, { key: 'b', name: 'Lee', type: 'mixed', paid: 0, budget: null }, { key: 'c', name: 'Mo', type: 'mixed', paid: 0, budget: null }] });
  assert.equal(costs.toComeText(some), '$8,000 paid so far · about $22,000 still to come on 1, not known yet on 2');
  // All known: as before, with the whole
  const known = planOf({ cash: 700000, makeovers: [], underway: [{ key: 'a', name: 'Kim', type: 'therapy', paid: 8000, budget: 30000 }] });
  assert.equal(costs.toComeText(known), '$8,000 paid so far · about $22,000 still to come · about $30,000 in all');
  assert.equal(costs.unknownText(none), 'What the 3 makeovers underway still need isn’t known yet');
  assert.equal(costs.unknownText(some), 'What 2 more makeovers underway still need isn’t known yet');
  assert.equal(costs.unknownText(known), '');
});

test('5. what makeovers can use now: what isn’t known is said, never added in as $0', () => {
  const job = (key, budget) => ({ key, name: key, type: 'mixed', paid: 0, budget });
  // Over the operating balance by $100K, $150K budgeted underway, one more without a figure: short, by more than $50K
  const short = planOf({ cash: 600000, makeovers: [], underway: [job('a', 150000), job('b', null)] });
  assert.equal(short.free, -50000);
  const a = costs.answerText(short, null);
  assert.match(a, /takes more than the \$100,000 over the \$500,000 kept to run SOARD: about \$150,000 on 1, and what 1 more needs isn’t known yet\. So nothing is free for new makeovers yet\./);
  assert.ok(!/\$50,000 more than/.test(a), `never a shortfall that counts the unknown as $0 (${a})`);
  // Over it, with only unknowns underway: how much is free isn't known either
  const over = planOf({ cash: 650000, makeovers: [], underway: [job('a', null)], waiting: [{ key: 'w', name: 'Ann', type: 'therapy' }] });
  assert.equal(over.free, 150000);
  assert.equal(costs.answerText(over, null), 'What the makeover underway still needs isn’t known yet, so how much is free for new makeovers isn’t either. Ann’s therapy room comes next.');
  // Every amount known: the sentence as it was
  const plain = planOf({ cash: 600000, makeovers: [], underway: [job('a', 150000)] });
  assert.match(costs.answerText(plain, null), /^Finishing the 1 makeover underway takes about \$150,000 more, \$50,000 more than the \$100,000 over/);
});

// The books as QuickBooks' read has them: revenue with the in-kind gifts in it; QuickBooks' own budget for the year
const cat = (key, name, amount) => ({ key, name, amount, accounts: [name] });
const YEAR = '2026';
const BOOKS = {
  year: YEAR, revenue: 1876045, expenses: 1200000, net: 676045, nonCash: 220000,
  sources: [cat('donations', 'Donations', 700000), cat('store', 'Store sales', 415000), cat('gala', 'Gala', 400000), cat('inkind', 'In kind', 220000), cat('grants', 'Grants', 90000), cat('account:golf classic', 'Golf Classic', 30000), cat('account:rent', 'Rent', 16000), cat('account:interest', 'Interest', 5000), cat('account:makeover', 'Makeover', 45)],
  lastYear: { year: '2025', revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)] },
  budget: { name: 'Budget_FY26_P&L', from: `${YEAR}-01-01`, to: `${YEAR}-12-31`, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 } },
};

test('6. where the revenue came from is of the same revenue as the figure above it', () => {
  // Against QuickBooks' own budget the revenue figure leaves in kind out ($1.66M, "Not counting $220K in kind"): so does the mix
  const tile = money.withBooks(money.booksBudget(BOOKS), BOOKS).revenue;
  assert.equal(tile.actual, 1656045);
  const mix = money.mixOf(BOOKS);
  assert.equal(mix.total, tile.actual, `its shares are of the tile’s $1.66M, never $1.88M (${mix.total})`);
  assert.equal(mix.total, money.yearFigures(BOOKS).revenue, 'and of The year so far’s revenue');
  assert.ok(!mix.parts.some((x) => x.key === 'inkind'), 'in kind isn’t one of its parts');
  assert.equal(mix.inKind, 220000, 'what it leaves out, to say');
  assert.equal(mix.parts.reduce((t, x) => t + x.amount, 0), mix.total, 'its parts add up to it');
  // (rounded together so they make 100%: Grants' 5.43 is 6%, the largest remainder; QA round 8 found 42 + 25 + 24 + 5 + 3)
  assert.deepEqual(mix.parts.map((x) => [x.name, x.share]), [['Donations', '42%'], ['Store sales', '25%'], ['Gala', '24%'], ['Grants', '6%'], ['Everything else', '3%']]);
  // Last year's the same way: its Everything else is without its in kind too
  assert.equal(mix.parts.find((x) => x.key === 'rest').last, 0, 'last year: 1,500,000 less 70,000 in kind less its named parts');
  /* r11: one revenue, counted one way: with no budget the revenue leaves the in kind out too, as The year so far and
     the net beside it do (Board QA round 11 found the tile's $1.88M beside a net of $676K), and so does the mix */
  const sheet = { ...BOOKS, budget: null };
  assert.equal(money.withBooks(null, sheet).revenue.actual, 1656045);
  const all = money.mixOf(sheet);
  assert.equal(all.total, 1656045);
  assert.ok(!all.parts.some((x) => x.key === 'inkind'), 'in kind isn’t one of them, as the figure leaves it out');
  assert.equal(all.inKind, 220000);
});
