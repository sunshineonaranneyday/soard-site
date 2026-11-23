// Advisory Board round 21 (Nov 22 2026), run as a child by tests/advisory-round21-names.test.mjs: every exported function
// of the name files (functions/api/_advisory-form.js and _given-names.js) on adversarial names at the field's full length
// (120 characters): long runs of letters with dots, hyphens, apostrophes, spaces and commas, ending in a digit or a
// symbol, the shapes a pattern that backtracks takes exponential time on (round 21's major 1: "Jordan Ames aaaa…1").
// Prints one JSON line: { calls, slowest, over } (over: every call that took more than LIMIT_MS, timed again twice and its
// fastest kept, so a pause of the machine's own is never taken for one). Before each name it writes the name to stderr,
// so a parent that has to stop it can say which one never finished.
import * as form from '../../functions/api/_advisory-form.js';
import * as given from '../../functions/api/_given-names.js';

const LIMIT_MS = 100;
const MAX = 120;
// (pieces a name is made of, repeated to the full length, then ended with something that isn't a letter)
const UNITS = ['a', 'ab', 'abc', 'abcdefgh', 'é', 'aé', 'a.', 'ab.', 'abc.', 'a-', 'ab-', "a'", "ab'", 'a·', 'a ', 'ab ', 'a,', 'ab,', 'a, ', 'a.b', 'a-b', "a'b",
  'a. ', 'a.-', 'a-.', '.', '-', ',', ' ,', ', ', "'", '. ', 'Ph.D. ', 'M.', 'Ab.', 'Dr. ', 'Pastor ', 'Mrs. ', 'Jr. ', 'MBA ', 'and ', '& ', 'A', 'AB.', 'Ab-', 'aB'];
const LEADS = ['', 'Jordan Ames ', 'Jordan Ames, ', 'Jordan Ames-', 'Dr. ', 'Mrs. Jordan ', 'Ames, ', 'Jordan ', 'Jordan A. ', 'Mary Beth '];
const ENDS = ['1', '!', '#', '😊', '.1', ',1', '-1', "'1", ' 1', '_'];
const names = new Set();
for (const u of UNITS) for (const l of LEADS) for (const e of ENDS) {
  const room = MAX - [...l].length - [...e].length;
  names.add(l + u.repeat(Math.ceil(room / u.length)).slice(0, room) + e);
}
// (and made-up mixes of letters, dots, hyphens, apostrophes, spaces and commas: the same every run)
let seed = 21;
const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const MIX = ['a', 'a', 'a', 'B', 'é', '.', '-', "'", ' ', ',', '·'];
for (let i = 0; i < 400; i++) {
  let s = '';
  while (s.length < MAX - 1) s += MIX[rand(MIX.length)];
  names.add(s + ENDS[i % ENDS.length]);
}

// (every exported function of both files, with words for each of its arguments; the form's own with the shapes they take)
const SHAPED = {
  // (a preferred name that's a given name too, so the full name is read for its family-name words)
  greetName: (s) => [[{ fullName: s }], [{ fullName: 'Joanna Ames', preferredName: s }], [{ fullName: s, preferredName: s }], [{ fullName: s, preferredName: s.slice(0, 60) }],
    [{ fullName: s, preferredName: 'Jo' }], [{ fullName: s, preferredName: 'Mary Beth' }]],
  fieldProblem: (s) => form.ADVISORY_FIELDS.filter((f) => f.type === 'text').map((f) => [f, s]),
  checkAnswers: (s) => [[{ fullName: s, preferredName: s, signature: s, refName: s, refRelationship: s }]],
  answerSections: (s) => [[{ fullName: s, preferredName: s }]],
};
const calls = [];
for (const [file, m] of [['_advisory-form.js', form], ['_given-names.js', given]]) {
  for (const [name, fn] of Object.entries(m)) {
    if (typeof fn !== 'function') continue;
    calls.push([`${file} ${name}`, fn, SHAPED[name] || ((s) => [[s], [s, s]])]);
  }
}

const time = (fn, args) => {
  const t = performance.now();
  try { fn(...args); } catch { /* (an answer it refuses is still an answer, in time) */ }
  return performance.now() - t;
};
let n = 0;
const slowest = [];
const over = [];
for (const s of names) {
  process.stderr.write(`${JSON.stringify(s)}\n`);
  for (const [label, fn, shapes] of calls) {
    for (const args of shapes(s)) {
      n++;
      let ms = time(fn, args);
      if (ms > LIMIT_MS) ms = Math.min(ms, time(fn, args), time(fn, args));
      if (ms > LIMIT_MS) over.push({ fn: label, input: s, ms: Math.round(ms) });
      if (!slowest.length || ms > slowest[slowest.length - 1].ms || slowest.length < 5) {
        slowest.push({ fn: label, input: s, ms: Math.round(ms * 1000) / 1000 });
        slowest.sort((a, b) => b.ms - a.ms);
        slowest.splice(5);
      }
    }
  }
}
process.stdout.write(`${JSON.stringify({ names: names.size, functions: calls.map((c) => c[0]), calls: n, slowest, over })}\n`);
