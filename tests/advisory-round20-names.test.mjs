/**
 * Advisory Board QA round 20 (Nov 21 2026): the greeting greets only on positive evidence (the lead's rule, replacing
 * round 19's reader: functions/api/_advisory-form.js greetName, with the given-names list in _given-names.js). A missed
 * name is fine, a wrong one never is. One test per rule, each from the tester's round 20 findings (test-results/qa20-public
 * n10-evidence.mjs, F1 to F13) and the families of each; then every row of the round's own awkward list
 * (tests/lib/advisory-r20-names.mjs) against its answer key; and rule 8, People's name for a name written with a comma.
 * Made-up people only; nothing leaves this machine.
 * Run: node --test tests/advisory-round20-names.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetName, readName } from '../functions/api/_advisory-form.js';
import { applicantEmail } from '../functions/api/_advisory-applications.js';
import { listSizes } from '../functions/api/_given-names.js';
import { R20_ROWS } from './lib/advisory-r20-names.mjs';

const J = 'Joanna Ames';
// Each row: [full name, preferred name, the greeting]; the applicant's copy's first line says the same
const say = (rows) => {
  for (const [fullName, preferredName, want] of rows) {
    assert.equal(greetName({ fullName, preferredName }), want, `${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)}`);
    assert.equal(applicantEmail({ answers: { fullName, preferredName }, headshot: null }).text.split('\n')[0], want ? `Thank you, ${want}.` : 'Thank you.', fullName);
  }
};

test('rules 1 and 2: a word is greeted only when it is on the given-names list (thousands of them, in their usual capitals), never because nothing said it isn\'t a name', () => {
  const n = listSizes();
  assert.ok(n.given >= 4000, `${n.given} given names`);
  assert.ok(n.familyFirst >= 250, `${n.familyFirst} family names that come first`);
  say([
    // (F7: titles and offices no list has, before a whole name or a family name)
    ['Fulton County Commissioner Jordan Ames', '', ''], ['DeKalb County Commissioner Jordan Ames', '', ''], ['Georgia State Senator Jordan Ames', '', ''],
    ['Cobb County Sheriff Jordan Ames', '', ''], ['Board Chair Jordan Ames', '', ''], ['Trustee Jordan Ames', '', ''], ['Treasurer Ames', '', ''], ['Mayor-elect Jordan Ames', '', ''],
    ['Overseer Jordan Ames', '', ''], ['Missionary Ames', '', ''], ['Worship Pastor Ames', '', ''], ['CEO Jordan Ames', '', ''], ['Realtor Jordan Ames', '', ''],
    ['Alhaji Jordan Ames', '', ''], ['Senhora Ames', '', ''], ['LtCol Jordan Ames', '', ''], ['SgtMaj Ames', '', ''], ['CPO Ames', '', ''],
    // (F8: families and companies)
    ['Rowe Fam', '', ''], ['Rowe Clan', '', ''], ['Rowe Crew', '', ''], ['Familia Rowe', '', ''], ['Rowe-Family', '', ''], ['Rowe L.L.C.', '', ''], ['Rowe LP', '', ''],
    ['Rowe PC', '', ''], ['Rowe Law Firm', '', ''], ['Law Offices of Jordan Rowe', '', ''], ['Rowe Real Estate', '', ''], ['Rowe Bros.', '', ''],
    // (given names on the list are greeted, a title the short list has set apart)
    ['Jordan Ames', '', 'Jordan'], ['Revd Jordan Ames', '', 'Jordan'], ['Shri Ravi Kumar', '', 'Ravi'], ['Don José García', '', 'José'], ['Amartya Sen', '', 'Amartya'],
    ['Chioma Okafor', '', 'Chioma'], ['Kwame Mensah', '', 'Kwame'], ['Priya Patel', '', 'Priya'], ['Thanh Nguyen', '', 'Thanh'], ['Yusuf Ali', '', 'Yusuf'],
    // (a given name that's a title or an office as often, before a name: nothing says which)
    ['Tuan Jordan Ames', '', ''], ['Hakim Ames', '', ''], ['Tito Jordan Ames', '', ''], ['ADA Jordan Ames', '', ''], ['ada jordan ames', '', ''], ['Ada Lovelace', '', 'Ada'],
  ]);
});

test('rule 3: a full name whose first word is a family name that comes first gets no name, even when that word is a given name too', () => say([
  ['Nguyễn Văn An', '', ''], ['NGUYỄN VĂN AN', '', ''], ['Trần Thị Mai', '', ''], ['Kim Min-jun', '', ''], ['Lee Ji-eun', '', ''], ['Park Seo-yeon', '', ''],
  ['Zhang Wei', '', ''], ['Kim Jordan', '', ''], ['Lee Jordan', '', ''], ['Mai Thi Thu', '', ''], ['Do Kwon', '', ''],
  // (written given name first, it's theirs; a hyphenated given name on the list is never cut at a family name)
  ['Min-jun Kim', '', 'Min-jun'], ['Jo-Ann Ames', '', 'Jo-Ann'], ['Lee-Ann Rowe', '', 'Lee-Ann'], [J, 'Kim', 'Kim'], [J, 'Lee', 'Lee'],
]));

test('rule 4: the name they go by is greeted only when, its hidden marks gone and its dashes, apostrophes and middle dots plain, it is one or two given names people go by; anything else is set aside and their full name read', () => say([
  // (F5: hidden marks of every kind, dashes, apostrophes, middle dots)
  [J, 'Jo\u00ADdy', 'Jody'], [J, 'Jo\u200Edy', 'Jody'], [J, 'Jo\u202Edy', 'Jody'], [J, 'Jo\u2066dy', 'Jody'], [J, 'Jo\u3164dy', 'Jody'], [J, 'Jo\uFE0Fdy', 'Jody'],
  [J, 'Jo\u2212Ann', 'Jo-Ann'], [J, 'Jo\uFF0DAnn', 'Jo-Ann'], [J, 'Mary\u2012Kate', 'Mary-Kate'], [J, 'D\u2018Andre', "D'Andre"], [J, 'D\u02BCAndre', "D'Andre"],
  [J, 'Gal\u2022la', 'Gal·la'], [J, 'Ka\u2018iulani', 'Joanna'],
  // (F10, F11: letters, and words around a name)
  [J, 'III', 'Joanna'], [J, 'CPA', 'Joanna'], [J, 'MBA', 'Joanna'], [J, 'Esq.', 'Joanna'], [J, 'USMC', 'Joanna'], [J, 'Jo USMC', 'Joanna'], [J, 'Jordan Ames LMHC', 'Joanna'],
  [J, "Hi, I'm Jo", 'Joanna'], [J, 'Nick: Jo', 'Joanna'], [J, 'Hi Jo', 'Joanna'], [J, 'Dear Jo', 'Joanna'], [J, 'Mostly Jo', 'Joanna'], [J, "Lil' Jo", 'Joanna'],
  [J, 'Blank', 'Joanna'], [J, 'Pass', 'Joanna'], [J, 'Pending', 'Joanna'], [J, 'Unsure', 'Joanna'], [J, 'Surname', 'Joanna'], [J, 'Hello', 'Joanna'], [J, 'Call me Jo', 'Joanna'],
  // (F6: a comma of any kind in the name they go by)
  [J, 'AMES, JORDAN', 'Joanna'], [J, 'SMITH, JOHN', 'Joanna'], [J, 'Ames, Jordan', 'Joanna'], [J, 'Ames\uFF0C Jo', 'Joanna'],
  // (two words: only a pair people go by together; never a name and a family name, nor the full name's family name)
  [J, 'Mary Beth', 'Mary Beth'], [J, 'mary beth', 'Mary Beth'], [J, 'Juan Carlos', 'Juan Carlos'], [J, 'Katie Harrison', 'Joanna'], [J, 'Dana Kim', 'Joanna'],
  [J, 'Jo\u2014Joanna', 'Joanna'], [J, 'ADA Jo', 'Joanna'], ['Jordan Taylor', 'Taylor', 'Jordan'], ['Jordan Taylor', 'Jordan Taylor', 'Jordan'],
  ['Garcia Lopez, Maria', 'Maria', 'Maria'], [J, 'Tuan', 'Tuan'],
]));

test('rule 5: a full name is greeted by its first word only in the plain shape (one courtesy title at most, two or three words of letters, letters the file knows); a comma of any script, a semicolon, "and", "&", brackets or a digit: no name', () => say([
  // (F1: letters after a title and a family name, any capitals)
  ['MRS QUILL PH D', '', ''], ['mrs quill ph d', '', ''], ['Mrs Quill Ph D.', '', ''], ['REV. QUILL THM', '', ''], ['Rev. Quill ThM.', '', ''], ['DR. QUILL PSY D', '', ''],
  ['MR. & MRS. QUILL PH D', '', ''], ['Mrs. Quill', '', ''], ['Dr. Jordan Ames PhD', '', 'Jordan'], ['Jordan Ames Ph. D.', '', 'Jordan'], ['Jordan Ames Jr.', '', 'Jordan'],
  // (F2: "Ma." and other short forms before a particle)
  ['Ma. del Carmen Reyes', '', ''], ['MA. DEL CARMEN REYES', '', ''], ['Ma. de los Angeles Cruz', '', ''], ['Cruz, Ma. del Carmen', '', ''], ['Ma. Teresa Cruz', '', ''],
  ['Wm Ames', '', ''], ['Robt Ames', '', ''], ['Chas Ames', '', ''], ['Fco Javier López', '', ''], ['Mª José García', '', ''],
  // (F3: ranks with numbers)
  ['2nd Lt. Jordan Ames', '', ''], ['1st Lt. Jordan Ames', '', ''], ['Sgt. 1st Class Jordan Ames', '', ''], ['1SG Jordan Ames', '', ''], ['CW3 Jordan Ames', '', ''],
  ['PO2 Jordan Ames', '', ''], [J, 'CW2 Jo', 'Joanna'],
  // (F4, F9: three people, or someone not named after "and")
  ['Jordan, Amy and Sam Rowe', '', ''], ['Jordan, Amy, and Sam Rowe', '', ''], ['Jordan and Amy, Sam Rowe', '', ''], ['Jordan Rowe and grandkids', '', ''],
  ['Jordan & grandchildren', '', ''], ['Jordan Rowe and loved ones', '', ''], ['Jordan & hubs', '', ''], ['Jordan & Amy Rowe', '', ''], ['José y María Cruz', '', ''],
  // (F5: hidden marks and look-alikes in a full name)
  ['Jor\u00ADdan Ames', '', 'Jordan'], ['Jor\u200Edan Ames', '', 'Jordan'], ['Jo\u2212Ann Ames', '', 'Jo-Ann'], ['Mary\u2012Kate Olsen', '', 'Mary-Kate'], ['De`Aaron Fox', '', "De'Aaron"],
  ['Ka\u2018iulani Kalani', '', ''], ['Dr.\u3164 Ames', '', ''],
  // (F6: commas and semicolons of every script)
  ['Ames\uFF0C Jordan', '', ''], ['Ames\u3001 Jordan', '', ''], ['علي\u060C محمد', '', ''], ['Ames; Jordan', '', ''], ['AMES; JORDAN', '', ''],
  ['Ames, Jordan', '', ''], ['Jordan Ames, Realtor', '', ''], ['Jordan Ames, M.Tech', '', ''],
  // (brackets around another name, a title of more than one word, one word)
  ['Mrs. John (Amy) Ames', '', ''], ['Mrs. Robert (Mary Beth) Ames', '', ''], ['State Rep. Jordan Ames', '', ''], ['Jordan', '', ''],
]));

test('rule 5, the coordinator\'s two shapes (Nov 22 2026): one middle initial between the first and family names, with or without its stop; and a comma at the end with only letters the file knows after it', () => say([
  ['Jordan A. Ames', '', 'Jordan'], ['Jordan A Ames', '', 'Jordan'], ['jordan a. ames', '', 'Jordan'], ['JORDAN A. AMES', '', 'Jordan'], ['Dr. Jordan A. Ames', '', 'Jordan'],
  ['Jordan A. Ames Jr.', '', 'Jordan'], ['Jordan A. Ames, PhD', '', 'Jordan'],
  // (never two initials, never an initial first or last)
  ['Jordan A. B. Ames', '', ''], ['Jordan A B Ames', '', ''], ['A. Jordan Ames', '', ''], ['J. A. Ames', '', ''], ['Jordan Ames A.', '', ''],
  ['Jordan Ames, PhD', '', 'Jordan'], ['Jordan Ames, Jr.', '', 'Jordan'], ['Jordan Ames, MBA, CPA', '', 'Jordan'], ['jordan ames, phd', '', 'Jordan'], ['JORDAN AMES, PHD', '', 'Jordan'],
  ['Dr. Jordan Ames, PhD', '', 'Jordan'], ['Jordan Ames, Ph. D.', '', 'Jordan'], ['Jordan Ames Jr., PhD', '', 'Jordan'], ['Jordan Quill, Senior', '', 'Jordan'],
  // (anything else after a comma, or nothing: no name; the first word still a given name, the other checks as before)
  ['Jordan Ames,', '', ''], ['Jordan Ames, Atlanta', '', ''], ['Jordan Ames, B.Com', '', ''], ['Mrs. Lee, PhD', '', ''], ['Ames, Jordan, PhD', '', ''], ['Rowe Family, LLC', '', ''],
  ['Jordan Ames\uFF0C PhD', '', ''], ['Kim Min-jun, PhD', '', ''],
  // (and the name they go by is still set aside when it's their family name: "Taylor" for "Jordan Taylor, PhD")
  ['Jordan Taylor, PhD', 'Taylor', 'Jordan'], ['Dr. Jordan Taylor', 'Taylor', 'Jordan'],
]));

test('rule 6: in the list\'s own capitals when typed all in capitals or all in small letters, as typed otherwise', () => say([
  ['TJ AMES', '', 'TJ'], ['tj ames', '', 'TJ'], ['TJ Ames', '', 'TJ'], ['AJ SMITH', '', 'AJ'], ['JR AMES', '', ''], ['DESHAWN AMES', '', 'DeShawn'], ['deshawn ames', '', 'DeShawn'],
  ['Deshawn Ames', '', 'Deshawn'], ['MCKENZIE AMES', '', 'McKenzie'], ['LATOYA AMES', '', 'LaToya'], ['JOSE CRUZ', '', 'Jose'], ['JOSÉ CRUZ', '', 'José'], ['D\u2019ANDRE SMITH', '', "D'Andre"],
  ['jordan ames', '', 'Jordan'], ['JORDAN Ames', '', ''], [J, 'jo-ann', 'Jo-Ann'], [J, 'JOANNA', 'Joanna'], [J, 'TJ', 'TJ'],
]));

test('rule 7, and every row of the round\'s own awkward list (13 kinds and their families): no name or the answer key\'s, never anything else', () => {
  assert.ok(R20_ROWS.length >= 2000, `${R20_ROWS.length} rows`);
  const plain = (s) => String(s).normalize('NFC').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const wrong = [];
  for (const [fullName, preferredName, ...ok] of R20_ROWS) {
    const g = greetName({ fullName, preferredName });
    if (g && !ok.some((k) => plain(k) === plain(g))) wrong.push(`${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)} \u2192 ${JSON.stringify(g)} (ok ${JSON.stringify(ok)})`);
  }
  assert.equal(wrong.length, 0, `${wrong.length} greetings not in the answer key:\n${wrong.slice(0, 20).join('\n')}`);
});

test('rule 8: People puts a name written last name first in order only when it is one family name and the given names of one person or a couple who share it; anything else with a comma stays as typed, and what Add matches on is as before', () => {
  for (const [typed, shown] of [
    ['Ames, Jordan', 'Jordan Ames'], ['Rowe, Amy & Sam', 'Amy & Sam Rowe'], ['Rowe, Jordan and Amy', 'Jordan & Amy Rowe'], ['Ames, Jordan, MD', 'Jordan Ames, MD'],
    ['Rowe, Jordan & Dr. Amy', 'Jordan & Dr. Amy Rowe'], ['Quill, Jordan & Mrs.', 'Jordan & Mrs. Quill'], ['Quill, Jordan & Mrs. Quill', 'Jordan Quill & Mrs. Quill'],
    // (three people, a second with a family name of their own, or more after another comma: the order typed)
    ['Jordan, Amy and Sam Rowe', 'Jordan, Amy and Sam Rowe'], ['Rowe, Jordan & Amy & Sam', 'Rowe, Jordan & Amy & Sam'], ['Ames, Jordan, Amy and Sam', 'Ames, Jordan, Amy and Sam'],
    ['Jordan, Amy, and Sam Rowe', 'Jordan, Amy, and Sam Rowe'], ['Quill, Jordan & Mrs. Lee', 'Quill, Jordan & Mrs. Lee'], ['Rowe, Jordan & Amy Lee', 'Rowe, Jordan & Amy Lee'],
    ['Ames, Jordan, Atlanta', 'Ames, Jordan, Atlanta'],
  ]) assert.equal(readName(typed).shown, shown, typed);
  // (the words matching and the web address use are as before: Jordan Ames is still the first one of "Ames, Jordan, Amy and Sam")
  assert.deepEqual(readName('Ames, Jordan, Amy and Sam').words, ['Jordan', 'Ames']);
  assert.deepEqual(readName('Quill, Jordan & Mrs. Lee').words, ['Jordan', 'Quill']);
  // (the coordinator, Nov 22 2026: a name kept in the order typed has its web address from that order, its titles and
  // letters set apart; one put in order has none of its own, `words` making it as before)
  for (const [typed, address] of [['Jordan, Amy and Sam Rowe', 'Jordan Amy and Sam Rowe'], ['Rowe, Jordan & Amy & Sam', 'Rowe Jordan Amy Sam'],
    ['Ames, Jordan, Amy and Sam', 'Ames Jordan Amy and Sam'], ['Quill, Jordan & Mrs. Lee, PhD', 'Quill Jordan Lee'], ['Ames, Jordan', null], ['Rowe, Amy & Sam', null]]) {
    assert.equal(readName(typed).address?.join(' ') ?? null, address, typed);
  }
});
