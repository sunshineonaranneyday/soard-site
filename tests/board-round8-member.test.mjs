// Board QA round 8, the members' page: the revenue's shares add up to 100%, and an amount typed in short ("1.66m",
// "676k") is marked where a tile writes it ("$1.66M", "+$676K"). The search entries themselves are checked in the
// browser (scripts/test-board-round7-member.mjs, the r8 steps)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharesOf } from '../public/admin/board/money.js';
import { termRe, termsOf, prep, termIn } from '../public/admin/board/find.js';

test('shares rounded together add up to 100%: the largest remainder takes the last point (Grants 5.43% is 6%)', () => {
  const parts = [700000, 415000, 400000, 90000, 51045];
  const total = parts.reduce((t, x) => t + x, 0);
  assert.deepEqual(sharesOf(parts, total), ['42%', '25%', '24%', '6%', '3%']);
  assert.equal(sharesOf(parts, total).reduce((t, s) => t + Number(s.replace('%', '')), 0), 100);
});

test('a share above nothing and under 1% says so; the others still make the whole', () => {
  const s = sharesOf([600, 395, 5], 1000);
  assert.deepEqual(s, ['60%', '40%', 'under 1%']);
  assert.deepEqual(sharesOf([1, 1, 1], 3), ['34%', '33%', '33%'], 'a tie goes to the first');
  assert.deepEqual(sharesOf([0, 10], 10), ['0%', '100%']);
  assert.deepEqual(sharesOf([5], 0), ['0%'], 'no total: nothing, never NaN');
});

test('an amount typed in short is marked where a tile writes it, and nowhere it isn’t', () => {
  const marks = (typed, text) => { const [t] = termsOf(typed); const m = new RegExp(termRe(t)).exec(text.toLowerCase()); return m ? m[0] : null; };
  assert.equal(marks('$1.66M', '$1,656,045 ($1.66M), January 1'), '1.66m');
  assert.equal(marks('1.66m', '$1,656,045 ($1.66M)'), '1.66m');
  assert.equal(marks('+$676K', '$676,045 (+$676K)'), '676k');
  assert.equal(marks('676k', 'it was $676 K'), '676 k');
  assert.equal(marks('1.4b', '$1.4B'), '1.4b');
  assert.equal(marks('1.66m', '$11.66M'), null, 'never inside a bigger number');
  assert.equal(marks('676k', '$1,676K'), null);
  assert.equal(marks('66m', '$1.66M'), null, 'never the decimals of another');
});

test('the short and spoken forms in an entry’s words are found typed either way', () => {
  const hay = prep('2026 revenue income $1,656,045 $1.66M 1.66 million');
  for (const q of ['$1.66M', '1.66m', '1.66 million', '1656045', '$1,656,045.00']) assert.ok(termsOf(q).every((t) => termIn(hay, t)), q);
  const net = prep('2026 net income $676,045 $676K 676 thousand +$676K');
  for (const q of ['+$676K', '676k', '676 thousand', 'net income']) assert.ok(termsOf(q).every((t) => termIn(net, t)), q);
});

test('an amount said in words is read as the amount in short', () => {
  assert.deepEqual(termsOf('1.66 million'), ['1d66m']);
  assert.deepEqual(termsOf('676 thousand'), ['676k']);
  assert.deepEqual(termsOf('2 billion'), ['2b']);
  assert.deepEqual(termsOf('a thousand thanks'), ['a', 'thousand', 'thanks'], 'never without its number');
  // ("700 thousand" finds and marks "$700,000": 700k is 700000 too)
  const hay = prep('Donations $700,000 $700K 700 thousand');
  assert.ok(termsOf('700 thousand').every((t) => termIn(hay, t)));
});
