/**
 * Advisory Board QA round 19 (Nov 21 2026): how the application greets people by name (greetName and the name reader,
 * functions/api/_advisory-form.js), as the thank-you, the applicant's copy, the welcome and the monthly ask do. This round
 * changed the approach: a greeting is used only when the reader is confident it's a name the person goes by; anything
 * else gets no name ("Thank you.", "Hello,"). Every row of the tester's 64 (test-results/qa19-public/n06-findings.mjs),
 * more of each kind, the applicant's copy for each, the stop-word check over every list (rule 11), and Add's web address
 * and the name it keeps for the findings' names (rule 12); and the lead's decisions on the round's open points (Nov 21 2026:
 * capitals after a title and one word, "Ma" alone, dashes between letters, everyday words in small letters). Made-up people
 * only; Resend, Cloudflare Access and Images are
 * faked, nothing leaves this machine.
 * Round 20 (Nov 21 2026): the lead replaced this round's reader for the greeting with "greet only on positive evidence"
 * (a given name on a list, in one plain shape: _advisory-form.js greetName). The tests below keep round 19's rows; each
 * row whose greeting the new rule changes says so, /* r20: why * /, and the tests' titles still name round 19's rules.
 * Run: node --test tests/advisory-round19-names.test.mjs
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { AWKWARD } from './lib/advisory-awkward-names.mjs';
import { greetName, readName } from '../functions/api/_advisory-form.js';
import { applicantEmail, readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import * as adminApi from '../functions/api/advisory-applications-admin.js';

// ── Rule 11's check, written here on its own (never the form's own lists) ──
// No greeting has a word from rule 1's list of everyday words, a piece of a title, or a title on its own (one that's a
// first name too, "Pastor", "Bishop", "Major", is a first name). Each person in it: the words of a title set apart, then
// their name. → null, or what's wrong
const EVERYDAY = new Set(('prefer preferred not say no none name nickname call me please just fine is or either matter first legal go by needed same any '
  + 'wife husband kids children spouse partner fam family household foundation group realty inc llc co company corp church ministries team state former most council member lady '
  + 'nope nah names called my mine myself pls plz only simply ok okay good great are am be neither nor but matters doesn\'t doesnt don\'t dont does last middle full given real '
  + 'goes going need necessary required anything anyone whatever both all it its this that the of for with from in on at up you your choice thanks thank yes yeah sure nothing nobody '
  + 'null unknown anonymous test testing tbd applicable use usual default etc et hubby kid kiddos child son sons daughter daughters fiance fiancé boyfriend girlfriend families folks '
  + 'parents mom dad baby friend friends crew guest plus other others incorporated llp ltd limited companies corporation ministry association society club fund enterprises holdings '
  + 'services solutions consulting properties investments ventures agency insurance school academy university college institute committee nonprofit charity temple parish chapel '
  + 'fellowship congregation chamber center studio associates trust pronoun pronouns').split(' '));
const PIECES = new Set('rt pro tem tempore elect vice deputy acting interim retired assistant associate executive very right second honorable honourable excellency eminence holiness majesty highness worshipful presiding superior emeritus county city district federal national us u.s congressional petty warrant command gunnery rear flight squadron staff grand past youth head lead police fire special supervisory med dent rer jur theol habil ssa ing dipl univ'.split(' '));
const ONLY_TITLE = /^(?:dr|drs|mr|mrs|ms|mx|miss|messrs|rev|prof|sir|dame|honorable|reverend|doctor|professor|captain|capt|cpt|lieutenant|lt|sergeant|sgt|colonel|col|admiral|adm|cmdr|commander|commissioner|councilwoman|councilman|councilmember|councilor|alderman|alderwoman|sheriff|marshal|constable|trooper|chief|ambassador|consul|president|premier|provost|principal|superintendent|director|secretary|magistrate|general|brigadier|corporal|cpl|private|pvt|pfc|specialist|ensign|airman|seaman|apostle|evangelist|prophet|prophetess|archbishop|cardinal|monsignor|msgr|vicar|rector|abbot|venerable|sheikh|shaykh|mufti|hajji|swami|guru|pandit|mother|uncle|aunt|auntie|nurse|agent|inspector|lord|baroness|countess|count|duchess|herr|frau|fräulein|mme|mlle|madame|madam|monsieur|mister|señor|señora|señorita|doña|signor|signora|cllr|congressman|congresswoman|delegate|speaker|attorney|pope|msg|ssg|sfc|ltc|csm|sgm|ltg)$/iu;
const NAMES_TOO = /^(?:pastor|father|rabbi|bishop|deacon|elder|minister|chaplain|imam|cantor|canon|sister|brother|coach|chef|senator|representative|governor|mayor|officer|detective|major|master|don|dean|justice|prince|king|queen|duke|earl|baron|bg|mg|gen)$/iu;
const plain = (w) => w.normalize('NFC').toLowerCase().replace(/’/g, "'").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
const titlePart = (w) => { const x = plain(w); return ONLY_TITLE.test(x) || NAMES_TOO.test(x) || PIECES.has(x) || /^(?:first|lady|state|former|most|council|member|gentleman|his|her|the|woman|man|judge|justice|honor|honour|deputy|chief)$/.test(x) || (/\.$/.test(w) && x.length <= 6 && !/^(?:\p{L}\.)+\p{L}?\.?$/u.test(w)); };
function ruleEleven(g) {
  if (!g) return null;
  for (const p of g.split(' and ')) {
    const ws = p.split(' ');
    let k = 0;
    while (k < ws.length - 1 && titlePart(ws[k])) k++;
    // (a couple's first title, "Mr." of "Mr. and Mrs. Quill")
    if (ws.length === 1 && titlePart(ws[0]) && g.includes(' and ') && !g.endsWith(p)) continue;
    const name = ws.slice(k);
    if (!k && name.length === 1 && !NAMES_TOO.test(plain(name[0])) && titlePart(name[0]) && !/^(?:judge|justice)$/i.test(name[0])) return `a title on its own, or a piece of one, "${name[0]}"`;
    for (const w of name) {
      const x = plain(w);
      if (EVERYDAY.has(x)) return `the everyday word "${w}"`;
      if (PIECES.has(x)) return `a piece of a title, "${w}"`;
      if (k && ONLY_TITLE.test(x)) return `a title as a family name, "${w}"`;
    }
    if (!k && name.length === 1 && ONLY_TITLE.test(plain(name[0]))) return `a title on its own, "${name[0]}"`;
  }
  return null;
}

// ── Each row: [full name, preferred name, the greeting] ──
const J = 'Joanna Ames';
const say = (rows) => {
  for (const [fullName, preferredName, want] of rows) {
    const got = greetName({ fullName, preferredName });
    assert.equal(got, want, `${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)}`);
    assert.equal(ruleEleven(got), null, `${JSON.stringify(fullName)}: ${got}`);
    // (the applicant's copy, its first line, greets them the same way)
    assert.equal(applicantEmail({ answers: { fullName, preferredName }, headshot: null }).text.split('\n')[0], want ? `Thank you, ${want}${want.endsWith('.') ? '' : '.'}` : 'Thank you.', fullName);
  }
};

test('G1 (rule 2): words around a preferred name are never the name; with a name in them it is greeted, with none their full name is used', () => say([
  // (the tester's rows, word for word)
  [J, 'Prefer not to say', 'Joanna'], [J, 'No preferred name', 'Joanna'], [J, 'Not needed', 'Joanna'], [J, 'Either is fine', 'Joanna'], [J, 'Doesn’t matter', 'Joanna'],
  [J, 'First name', 'Joanna'], [J, 'Legal name', 'Joanna'], [J, 'Call me Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'Please call me Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'I go by Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'Jo or Joanna', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */,
  [J, 'Jo please', 'Joanna'] /* r20: "Jo please" isn't two given names people go by together (words around it, a title, or a whole name): set aside, their full name's "Joanna" */, [J, 'Jo is fine', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'Just Jo', 'Joanna'] /* r20: "Just Jo" isn't two given names people go by together (words around it, a title, or a whole name): set aside, their full name's "Joanna" */, [J, 'Nickname: Jo', 'Joanna'] /* r20: a colon in the name they go by: set aside, their full name's "Joanna" */, [J, 'Preferred: Jo', 'Joanna'] /* r20: a colon in the name they go by: set aside, their full name's "Joanna" */, [J, 'Not Joanna', 'Joanna'],
  // (more of each kind)
  [J, 'My friends call me Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'You can call me Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'I usually go by Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'Known as Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'AKA Jo', 'Joanna'] /* r20: "AKA Jo" isn't two given names people go by together (words around it, a title, or a whole name): set aside, their full name's "Joanna" */, [J, 'Nickname - Jo', 'Joanna'] /* r20: a dash or an apostrophe at a word's end in the name they go by: set aside, their full name's "Joanna" */,
  [J, 'My preferred name is Jo', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, "It's Jo", 'Joanna'] /* r20: "It's Jo" isn't two given names people go by together (words around it, a title, or a whole name): set aside, their full name's "Joanna" */, [J, 'Jo, please', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, [J, 'Jo, thanks', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, [J, 'Jo for short', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'Either Jo or Joanna', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */,
  [J, 'Jo or Joanna is fine', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, [J, 'Call me Dr. Ames', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, [J, 'Just T.J', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, [J, 'Nickname: Mary Beth', 'Joanna'] /* r20: a colon in the name they go by: set aside, their full name's "Joanna" */, [J, 'Jo and kids', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */,
  [J, 'Prefer not to answer', 'Joanna'], [J, "I'd rather not say", 'Joanna'], [J, 'Not necessary', 'Joanna'], [J, 'Whatever', 'Joanna'], [J, 'Does not matter', 'Joanna'],
  [J, "Don't have one", 'Joanna'], [J, 'Use my first name', 'Joanna'], [J, 'Full name', 'Joanna'], [J, 'Real name', 'Joanna'], [J, 'Up to you', 'Joanna'], [J, 'Your choice', 'Joanna'],
  [J, 'Thanks', 'Joanna'], [J, 'Yes', 'Joanna'], [J, 'Test', 'Joanna'], [J, 'Me', 'Joanna'], [J, 'Call me anything', 'Joanna'], [J, 'Just call me by my name', 'Joanna'],
  [J, 'N/A - use first name', 'Joanna'], [J, 'Nickname', 'Joanna'], [J, 'It', 'Joanna'], [J, 'Any', 'Joanna'], [J, 'Not Jo', 'Joanna'],
  // (a phrase, never a name: what's typed there not written as a name is, "A match.", "Mary beth")
  [J, 'A match.', 'Joanna'], [J, 'Applying again.', 'Joanna'],
  // (a comma before a name or a title: a full name written last name first, read as one, never its family name)
  [J, 'Ames, Jordan', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, [J, 'Van Dyke, Dr.', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, [J, 'Quill, Jordan & Amy', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, [J, "O'Brien, T.J.", 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, [J, 'March, Jordan', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */,
  // (as before)
  [J, 'Jo', 'Jo'], [J, 'Mary Beth', 'Mary Beth'], [J, 'Jo (Joanna)', 'Joanna'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Joanna" */, [J, 'Jo, she/her', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, [J, 'Dr. Jordan Lee', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, [J, 'N/A', 'Joanna'], [J, 'Coach', 'Joanna'] /* r20: "Coach" isn't on the given-names list: set aside, their full name's "Joanna" */,
]));

test('G2 (rule 3): titles the reader knows now, of one word or more, before a whole name or a family name; never a title or a piece of one as the greeting', () => say([
  ['State Rep. Jordan Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['First Lady Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['Pastor & First Lady Ames', '', ''] /* r20: two people ("&" or "+"): no name */, ['Mayor Pro Tem Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */,
  ['Former Mayor Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['Rt. Hon. Jordan Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['Cmdr. Jordan Ames', '', 'Jordan'], ['Most Rev. Jordan Ames', '', ''] /* r20: initials or a word with a full stop: no name */,
  ['Council Member Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['Commissioner Jordan Ames', '', ''] /* r20: "Commissioner" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Councilwoman Jordan Ames', '', ''] /* r20: "Councilwoman" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Apostle Jordan Ames', '', ''] /* r20: "Apostle" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */,
  ['Bishop & Lady Ames', '', ''] /* r20: two people ("&" or "+"): no name */, ['Sheriff Jordan Ames', '', ''] /* r20: "Sheriff" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Dr. med. Hans Müller', '', ''] /* r20: initials or a word with a full stop: no name */, ['Herr Hans Müller', '', 'Hans'],
  // (more: multi-word, military with and without dots, religious, civic, courtesy, other languages)
  ['State Senator Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['U.S. Rep. Jordan Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['Rt Hon Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['The Very Rev. Jordan Ames', '', ''] /* r20: initials or a word with a full stop: no name */,
  ['Chief Justice Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['Lieutenant Governor Ames', '', ''] /* r20: "Lieutenant" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Sergeant Major Jordan Ames', '', 'Jordan'] /* r27: finding 4, the lead's rule: one list of the military's ranks, read the same way by the greeting and Add */, ['Lance Cpl. Jordan Ames', '', 'Jordan'] /* r27: finding 4, the lead's rule: one list of the military's ranks, read the same way by the greeting and Add */,
  ['Special Agent Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */, ['Senior Pastor Ames', '', ''] /* r20: "Senior" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Elder & Sister Ames', '', ''] /* r20: two people ("&" or "+"): no name */, ['His Excellency Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */,
  ['Doña María López', '', 'María'], ['Dott. Mario Rossi', '', 'Mario'], ['Dr.ssa Maria Rossi', '', ''] /* r20: initials or a word with a full stop: no name */, ['Mme Marie Curie', '', 'Marie'], ['Señor José García', '', 'José'],
  ['MSG Jordan Ames', '', 'Jordan'] /* r27: finding 4, the lead's rule: one list of the military's ranks, read the same way by the greeting and Add */, ['MSG Ames', '', ''] /* r20: "MSG" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['CPT Jordan Ames', '', 'Jordan'] /* r27: finding 4, the lead's rule: one list of the military's ranks, read the same way by the greeting and Add */, ['LTC Jordan Ames', '', 'Jordan'] /* r27: finding 4, the lead's rule: one list of the military's ranks, read the same way by the greeting and Add */, ['GEN Jordan Ames', '', ''] /* r20: "GEN" without its stop is a name too ("Gen Tanaka"), so no title, and not a given name: no name */,
  ['Sheriff Ames', '', ''] /* r20: "Sheriff" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Commissioner Ames', '', ''] /* r20: "Commissioner" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Lady Gaga', '', ''] /* r20: a title and a family name is no given name: no name */, ['Ames, State Rep.', '', ''] /* r20: a comma: no name */,
  ['Ames, Commissioner', '', ''] /* r20: a comma: no name */, ['Mayor & First Gentleman Ames', '', ''] /* r20: two people ("&" or "+"): no name */,
  // (a title that's a first name as often, before a whole name: nothing says which, no name; before one word, the first
  // name; "Lady" before a whole name, "Lady Bird Johnson"; a word with a full stop the reader doesn't know: no name)
  ['Don José García', '', 'José'] /* r20: a title on the short list, then a whole name: its first name */, ['Don Draper', '', ''] /* r20: a title and a family name is no given name: no name */, ['Major Jordan Ames', '', 'Jordan'] /* r20: a title on the short list, then a whole name: its first name */, ['Major Harris', '', ''] /* r20: a title and a family name is no given name: no name */, ['Lady Bird Johnson', '', ''], ['Xyz. Jordan Ames', '', ''],
  ['Ed. Ames', '', ''],
  // (as before)
  ['Gen Tanaka', '', ''] /* r20: "Gen" (a title only with its stop) isn't on the given-names list: no name */, ['Hon Lam Wong', '', ''] /* r20: "Hon" (a title only with its stop) isn't on the given-names list: no name */, ['Hon. Jordan Smith', '', 'Jordan'], ['Bishop John Briggs', '', 'John'], ['Bishop Briggs', '', ''] /* r20: a title and a family name is no given name: no name */, ['Pastor Ames', '', ''] /* r20: a title and a family name is no given name: no name */,
  ['Dr. Del MD', '', ''] /* r20: "Del" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Lt. Col. Jordan Ames', '', 'Jordan'] /* r27: finding 4, the lead's rule: one list of the military's ranks, read the same way by the greeting and Add */, ['Rev. Dr. Ames', '', ''] /* r20: more than one title: no name */, ['Judge Judy', '', ''] /* r20: a title and a family name is no given name: no name */,
]));

test('G3 (rule 4): initials with or without their last full stop are a first name', () => say([
  [J, 'T.J', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, [J, 'A.J', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, [J, 'C.J', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['T.J Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['A.J Smith', '', ''] /* r20: initials or a word with a full stop: no name */,
  ['C.J Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['D.J Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['J.R Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['K.C Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['J.R.R Tolkien', '', ''] /* r20: initials or a word with a full stop: no name */, ['Ames, T.J', '', ''] /* r20: a comma: no name */, ['Dr. T.J Ames', '', ''] /* r20: initials or a word with a full stop: no name */,
  [J, 'K.C', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, [J, 't.j', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['t.j ames', '', ''] /* r20: initials or a word with a full stop: no name */,
  // (what's typed for no name, never initials: "N.A")
  ['N.A', '', ''], [J, 'N.A', 'Joanna'],
  // (as before)
  [J, 'T.J.', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['J. Ames', '', ''] /* r20: initials or a word with a full stop: no name */, ['J.R. Smithers', '', ''] /* r20: initials or a word with a full stop: no name */, ['T.J.O\'Brien', '', ''] /* r20: initials or a word with a full stop: no name */,
]));

test('G4 (rule 5): spaces around a comma never change the reading', () => say([
  ['Ames , Jordan', '', ''] /* r20: a comma: no name */, ['AMES , JORDAN', '', ''] /* r20: a comma: no name */, ['Ames , Dr.', '', ''] /* r20: a comma: no name */, ['Quill , Mrs.', '', ''] /* r20: a comma: no name */, ['Ames , Jordan & Amy', '', ''] /* r20: two people ("&" or "+"): no name */,
  ['Ames ,Jordan', '', ''] /* r20: a comma: no name */, ['Ames  ,  Jordan', '', ''] /* r20: a comma: no name */, ['Ames , Jordan , MD', '', ''] /* r20: a comma: no name */, ['Van Dyke , Dr.', '', ''] /* r20: a comma: no name */, ['Quill , Mr. & Mrs.', '', ''] /* r20: two people ("&" or "+"): no name */,
  ['Jordan Ames , MD', '', 'Jordan'], [J, 'Ames , Jordan', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */,
  // (as before)
  ['Ames, Jordan', '', ''] /* r20: a comma: no name */, ['Ames,Jordan', '', ''] /* r20: a comma: no name */, ['Ames, Dr.', '', ''] /* r20: a comma: no name */,
]));

test('G5 (rule 6): "and" or "&" before someone not named is no second person', () => say([
  ['Jordan Rowe and wife', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan Rowe & kids', '', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan Rowe & spouse', '', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan & husband', '', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan Rowe & fam', '', ''] /* r20: two people ("&" or "+"): no name */,
  [J, 'Jo and kids', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */,
  ['Jordan Rowe and my wife', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan Rowe & the kids', '', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan Rowe and wife and kids', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Rowe, Jordan and wife', '', ''] /* r20: two people, or someone not named ("and"): no name */,
  ['Mr. Rowe and wife', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan and Amy Rowe and kids', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan Rowe and wife, MD', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan Rowe + wife', '', ''] /* r20: two people ("&" or "+"): no name */,
  ['Jordan Rowe with wife', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan Rowe & partner', '', ''] /* r20: two people ("&" or "+"): no name */,
  // (someone not named who isn't a wife, husband or the children: no name, never "Jordan and Son"; three people listed: none)
  ['Jordan Rowe and son', '', ''], ['Jordan Rowe and friends', '', ''], ['Jordan, Amy and Sam Rowe', '', ''],
  // (as before: a couple is greeted both)
  ['Jordan Rowe and family', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan & Amy Rowe', '', ''] /* r20: two people ("&" or "+"): no name */, ['Rowe, Amy and Sam', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan Rowe and Amy', '', ''] /* r20: two people, or someone not named ("and"): no name */,
]));

test('G6 (rule 7): a family or a company as the name: no name', () => say([
  ['Rowe Family', '', ''], ['Rowe Household', '', ''], ['Rowe Family Foundation', '', ''], ['Acme Inc.', '', ''],
  ['The Rowe Family', '', ''], ['Rowe Realty Group', '', ''], ['Rowe & Co.', '', ''], ['Rowe & Associates', '', ''], ['Rowe & Sons', '', ''], ['Rowe Construction', '', ''],
  ['Grace Church', '', ''], ['Team Rowe', '', ''], ['Jordan Rowe LLC', '', ''], ['Acme, Inc.', '', ''], ['Jordan Rowe Family', '', ''], ['Rowe Ministries', '', ''],
  [J, 'Rowe Family', 'Joanna'],
  // (where they work after a whole name and a comma is no name of theirs, as round 12 has it: they're greeted)
  ['Jordan Quill, Acme Inc.', '', ''] /* r20: a comma: no name */, ['Jordan Quill, Inc.', '', ''] /* r20: a comma: no name */,
]));

test('G7 (rule 8): letters after a family name are never a name: known letters, or ones only letters can be ("ThM", "Ph D"), leave the title and family name; an unknown word in capitals after a title and one word may be letters or a family name, so no name', () => say([
  // (the tester's rows: "Quill" alone never; known ones, or ones no name is written as, greet the title and family name)
  ['Dr. Quill FACC', '', ''], ['Mrs. Ames LMHC', '', ''], ['Mrs Quill Ph D', '', ''] /* r20: "Quill" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Rev. Quill ThM', '', ''] /* r20: "Quill" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Mr. & Mrs. Quill LMHC', '', ''],
  ['Dr. Quill FACC, FACP', '', ''], ['Mrs. Quill MAT', '', ''], ['Mrs Quill M D', '', ''] /* r20: "Quill" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Dr. Quill Psy D', '', ''] /* r20: "Quill" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Dr. Quill Ed D', '', ''] /* r20: "Quill" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */,
  ['Jordan Ames LMHC', '', 'Jordan'], ['Dr. Jordan Ames FACC', '', 'Jordan'], ['Bishop Quill FACC', '', ''],
  // (the lead, Nov 21 2026, open points 1 and 2: a family name in capitals or letters, nothing says which: no name; in a
  // name typed all in capitals too, "Dr. JORDAN AMES" (round 11 had it Jordan); letters the file knows still read as letters)
  ['Dr. Marie CURIE', '', 'Marie'] /* r20: a title on the short list, then a whole name: its first name */, ['Mr. & Mrs. John SMITH', '', ''], ['DR. QUILL FACC', '', ''], ['MRS. QUILL LMHC', '', ''], ['Dr. JORDAN AMES', '', 'Jordan'] /* r20: a title on the short list, then a whole name: its first name */, ['DR. JORDAN AMES', '', 'Jordan'] /* r20: a title on the short list, then a whole name: its first name */,
  ['Dr. Jordan AMES', '', 'Jordan'] /* r20: a title on the short list, then a whole name: its first name */, ['Dr. JACK MA', '', 'Jack'] /* r20: a title on the short list, then a whole name: its first name, never the title */, ['Mrs. QUILL MBA', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['DR. QUILL MD', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['MRS. QUILL PhD', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */,
  // (a word in capitals too long to be letters is a family name; a title and a whole name, or no title, greet the first name)
  ['Dr. Jordan ABERNATHY', '', 'Jordan'], ['Dr. JORDAN LEE AMES', '', 'Jordan'], ['Mr. and Mrs. Jordan Ames', '', ''] /* r20: two people, or someone not named ("and"): no name */,
  // (as before: a family name in capitals after a first name is a family name; a title and a family name both clear)
  ['Jean DUPONT', '', 'Jean'], ['Dr. QUILL MD', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Mrs. Quill Ph. D.', '', ''] /* r20: initials or a word with a full stop: no name */, ['Dr. Quill', '', ''] /* r20: a title and a family name is no given name: no name */, ['MRS. QUILL', '', ''] /* r20: a title and a family name is no given name: no name */,
]));

test('G8 (rule 9): marks with no width are gone before reading; a middle dot inside a word is part of it', () => say([
  ['Jor\u200Bdan Ames', '', 'Jordan'], ['Gal·la Puig', '', 'Gal·la'], [J, 'Gal·la', 'Gal·la'],
  ['\u200BJordan Ames', '', 'Jordan'], ['Jordan\uFEFF Ames', '', 'Jordan'], ['Jor\u2060dan Ames', '', 'Jordan'], ['Jo\u200Ddan Ames', '', ''] /* r20: "Jodan" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Marcel·lí Puig', '', ''] /* r20: "Marcel·lí" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */,
  [J, 'Jo\u200Bdy', 'Jody'], [J, 'Jo\u200B', 'Jo'],
]));

test('G9 (rule 10): a short way of writing a first name: "Ma." with the name after it is the first name; "Wm.", "Chas.", "Thos." alone are no name', () => say([
  ['Ma. Teresa Cruz', '', ''] /* r20: initials or a word with a full stop: no name */, ['Wm. Ames', '', ''], [J, 'Ma. Teresa', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */,
  ['Ma. Cristina Santos', '', ''] /* r20: initials or a word with a full stop: no name */, ['MA. TERESA CRUZ', '', ''] /* r20: initials or a word with a full stop: no name */, ['Cruz, Ma. Teresa', '', ''] /* r20: a comma: no name */, ['Dr. Ma. Teresa Cruz', '', ''] /* r20: initials or a word with a full stop: no name */,
  ['Wm. Jordan Ames', '', ''], ['Chas. Ames', '', ''], ['Thos. Jefferson', '', ''], [J, 'Wm.', 'Joanna'], [J, 'Wm. Ames', 'Joanna'],
  // (the lead, open point 3: "Ma" without its full stop is never greeted alone as a first name; "Ma" as a family name)
  ['Ma Teresa Cruz', '', ''], ['Ma Long', '', ''], [J, 'Ma', 'Joanna'], ['Jack Ma', '', 'Jack'], ['Jack MA', '', 'Jack'],
]));

test('rule 1, confident or none: a word cut at a mark is never greeted, nor a sentence, nor a family name written first', () => say([
  // (a full stop inside a word or after a first name: it's a short way of writing something, no name)
  ['Jordan.Ames', '', ''], ['Jo.Ann Ames', '', ''], ['Jo. Ann Ames', '', ''], ['jordan.ames@example.org', '', ''],
  // (one word of two joined by a mark, as a full name: nothing says which is a first name; as a preferred name, the first)
  ['Ames/Rowe', '', ''], ['Jordan_Ames', '', ''], [J, 'Jo\\Joanna', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Jordan/Amy Rowe', '', ''] /* r20: a slash: no name */, ['Jordan Ames/Acme', '', ''] /* r20: a slash: no name */,
  // (a sentence typed as a full name; one everyday word may be a family name)
  ['I go by Jo', '', ''], ['Prefer Not To Say', '', ''], ['Jordan Rowe on behalf of Acme', '', ''], ['Julia Child', '', ''] /* r20: a word after the first is a business, family, office or everyday word, or isn't written as a name: no name */, ['Rick Husband', '', ''] /* r20: a word after the first is a business, family, office or everyday word, or isn't written as a name: no name */,
  // (words on rule 1's list are never greeted, even where they're names: the cost, "Thank you." without one)
  ['Or Cohen', '', ''], ['Charlotte Church', '', ''],
  // (a name in Chinese, Japanese or Korean letters with a space is family name first; written as one, it's greeted whole)
  ['山田 太郎', '', ''], ['박 지성', '', ''], ['陈小明', '', ''] /* r20: one word: no name */,
  // (Georgian is written without capitals: greeted as written)
  ['გიორგი ბერიძე', '', ''] /* r20: "გიორგი" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */,
  // ("Abd" is never a name alone)
  ['Abd al-Rahman Ali', '', ''], ['عبد الله', '', ''], [J, 'Abd al-Rahman', 'Joanna'] /* r20: "Abd al-Rahman" isn't two given names people go by together (words around it, a title, or a whole name): set aside, their full name's "Joanna" */,
  // (the lead, open point 8: an en or em dash between letters, as a paste makes one, is the name's hyphen, greeted with an
  // ordinary one, never a dash; an everyday word typed in small letters is never greeted, a name in small letters is)
  ['Jo\u2013Ann Ames', '', 'Jo-Ann'], ['Jo\u2014Ann Ames', '', 'Jo-Ann'], [J, 'Jo\u2013Ann', 'Jo-Ann'], [J, 'Jo\u2014Ann', 'Jo-Ann'], ['jo\u2013ann ames', '', 'Jo-Ann'],
  ['Ames, Jo\u2014Ann', '', ''] /* r20: a comma: no name */, [J, 'Jo \u2014 Joanna', 'Joanna'] /* r20: a dash or an apostrophe at a word's end in the name they go by: set aside, their full name's "Joanna" */, [J, 'Jo\u2014Joanna', 'Joanna'] /* r20: "Jo-Joanna" isn't on the given-names list: set aside, their full name's "Joanna" */, [J, 'Jo \u2013 she/her', 'Joanna'] /* r20: a dash or an apostrophe at a word's end in the name they go by: set aside, their full name's "Joanna" */,
  [J, 'only "new" fits', 'Joanna'], ['only "new" fits', '', ''], [J, 's own box isn', 'Joanna'], ['s own box isn', '', ''], ['new ames', '', ''], [J, 'new', 'Joanna'],
  [J, 'just jo', 'Joanna'] /* r20: "just jo" isn't two given names people go by together (words around it, a title, or a whole name): set aside, their full name's "Joanna" */, [J, 'jo', 'Jo'], ['jordan ames', '', 'Jordan'], ['will smith', '', 'Will'], ['grace jones', '', 'Grace'], [J, 'mary beth', 'Mary Beth'],
  // (as before)
  ['Jordan Ames', '', 'Jordan'], ['jordan ames', '', 'Jordan'], ['Will Smith', '', 'Will'], ['Do Kwon', '', ''] /* r20: a family name that comes first ("Do"): no name */, ['Al Gore', '', ''] /* r20: "Al" is a title or an office as often as a given name: no name */, ['Jordan.', '', ''] /* r20: initials or a word with a full stop: no name */, ['Jordan Ames.', '', ''] /* r20: initials or a word with a full stop: no name */,
]));

// ── Rule 11 on every list: the tests' strings (this file's among them) and this round's own awkward list ──
test('rule 11: no greeting, of any string in the Advisory Board tests or the round\'s 1,100 awkward names, as a full name or a preferred name, has a word from rule 1\'s list, a title on its own or a piece of one', () => {
  const dir = new URL('.', import.meta.url);
  const seen = new Set();
  for (const f of readdirSync(dir).filter((x) => /^advisory.*\.test\.mjs$/.test(x))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      let s;
      try { s = JSON.parse(`"${(m[1] ?? m[2]).replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"')}"`); } catch { continue; }
      if (s.length <= 120 && /\p{L}/u.test(s)) seen.add(s);
    }
  }
  assert.ok(AWKWARD.length >= 500, `the awkward list has ${AWKWARD.length}`);
  const cases = [];
  for (const s of seen) cases.push([s, ''], [J, s]);
  for (const s of AWKWARD) {
    if (s.startsWith('|')) cases.push([J, s.slice(1)]);
    else if (s.includes('|')) cases.push(s.split('|'));
    else cases.push([s, ''], [J, s]);
  }
  const wrong = [];
  for (const [fullName, preferredName] of cases) {
    const g = greetName({ fullName, preferredName });
    const why = ruleEleven(g);
    if (why) wrong.push(`${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)} → ${JSON.stringify(g)}: ${why}`);
  }
  assert.ok(cases.length > 4000, `${cases.length} cases read`);
  assert.equal(wrong.length, 0, `${wrong.length} greetings break rule 11, for example:\n${wrong.slice(0, 25).join('\n')}`);
});

// ── Rule 12: Add keeps the name and its web address as before (greeting only) ──
const BASE = {
  phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
  introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes',
  refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true,
};
let SHOT;
before(async () => {
  const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
  SHOT = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
});
let env;
let delivered;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't', RESEND_API_KEY: 'r', CF_ACCESS_API_TOKEN: 'access-token', CF_ACCESS_AUD: 'aud-admin' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  delivered = [];
  const access = { groups: [], policies: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'api.resend.com') { const list = [JSON.parse(init.body)].flat(); delivered.push(...list); return Response.json({ data: list.map((_, i) => ({ id: `em_${delivered.length}_${i}` })) }); }
    if (url.host === 'api.cloudflare.com' && url.pathname.includes('/images/v1')) {
      if (init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } }); }
      return Response.json({ success: true, result: {} });
    }
    if (url.host === 'api.cloudflare.com' && url.pathname.startsWith('/client/v4/accounts/acct/access/')) {
      const method = init.method || 'GET';
      const path = url.pathname.replace('/client/v4/accounts/acct', '');
      const ok = (result) => Response.json({ success: true, result });
      if (path === '/access/groups' && method === 'GET') return ok(access.groups);
      if (path === '/access/groups' && method === 'POST') { const g = { id: 'g1', ...JSON.parse(init.body) }; access.groups.push(g); return ok(g); }
      if (path === '/access/groups/g1' && method === 'GET') return ok(access.groups[0]);
      if (path === '/access/groups/g1' && method === 'PUT') { Object.assign(access.groups[0], JSON.parse(init.body)); return ok(access.groups[0]); }
      if (path === '/access/policies' && method === 'GET') return ok(access.policies);
      if (path === '/access/policies' && method === 'POST') { const p = { id: 'p1', ...JSON.parse(init.body) }; access.policies.push(p); return ok(p); }
      if (path === '/access/apps' && method === 'GET') return ok([{ aud: 'aud-admin', name: 'SOARD admin', policies: access.policies.map((p) => ({ id: p.id })) }]);
    }
    throw new Error(`no route for ${url.href}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });
const applied = async (fullName, email, extra = {}) => (await submitApplication(env, { ...BASE, fullName, email, signature: fullName, ...extra }, { headshot: SHOT })).app;
const ctx = (method, body, query = '') => ({
  env,
  request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
  data: { userEmail: 'linzi@soardcharity.com' },
  waitUntil: () => {},
});
const plan = async (id) => (await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${id}`))).json()).plan;

test('rule 12: Add keeps each finding\'s name as before, at the same web address (as the code before this round read them)', async () => {
  let k = 0;
  // [as typed, the address, the name kept when it isn't as typed]: what the code before this round gave (test-results/r19-names/rule12.mjs
  // compared every one of the lists' 5,078 names, readName whole, before and after)
  for (const [typed, slug, asName] of [
    ['State Rep. Jordan Ames', 'state-rep-jordan-ames', null], ['First Lady Jordan Ames', 'first-lady-jordan-ames', null], ['Pastor & First Lady Ames', 'first-lady-ames', null],
    ['Mayor Pro Tem Jordan Ames', 'pro-tem-jordan-ames', null], ['Rt. Hon. Jordan Ames', 'rt-hon-jordan-ames', null], ['Cmdr. Jordan Ames', 'jordan-ames', null] /* r27: finding 4, the lead's rule: one list of the military's ranks, read the same way by the greeting and Add */,
    ['Dr. med. Hans Müller', 'med-hans-muller', null], ['Herr Hans Müller', 'herr-hans-muller', null], ['T.J Ames', 't-j-ames', null], ['A.J Smith', 'a-j-smith', null],
    ['Ames , Jordan', 'jordan-ames', 'Jordan Ames'], ['Ames , Dr.', 'ames', null], ['Ames , Jordan & Amy', 'jordan-ames', 'Jordan & Amy Ames'], ['Jordan Rowe and wife', 'jordan-rowe', null],
    ['Jordan & husband', 'jordan', null], ['Rowe Family', 'rowe-family', null], ['Acme Inc.', 'acme-inc', null], ['Dr. Quill FACC', 'quill-facc', null], ['Mrs Quill Ph D', 'quill-ph-d', null],
    ['Mr. & Mrs. Quill LMHC', 'quill-lmhc', null], ['Jor\u200Bdan Ames', 'jor-dan-ames', null], ['Gal·la Puig', 'gal-la-puig', null], ['Ma. Teresa Cruz', 'ma-teresa-cruz', null],
    ['Wm. Ames', 'wm-ames', null], ['Don José García', 'don-jose-garcia', null],
  ]) {
    const app = await applied(typed, `r19.${++k}@example.org`);
    const p = await plan(app.id);
    assert.deepEqual([p.kind, p.slug, p.asName ?? null], ['new', slug, asName], typed);
    assert.equal(readName(typed).shown, asName ?? typed, typed);
  }
});

test('where it shows: "Mayor Pro Tem Jordan Ames" is thanked, sent their copy, and welcomed once added as Jordan, never "Pro"; "Rowe Family" with no name', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  await writeState(env.DB, 'advisory', { emails: true });
  // (r20: "Mayor Pro Tem" is a title of more than one word the short list doesn't have, so no name: never "Pro" still)
  for (const [typed, email, thanks, hi] of [['Mayor Pro Tem Jordan Ames', 'mpt@example.org', 'Thank you.', /^Hello,/], ['Rowe Family', 'rowes@example.org', 'Thank you.', /^Hello,/]]) {
    const app = await applied(typed, email);
    assert.equal(applicantEmail(app).text.split('\n')[0], thanks, typed);
    const p = await plan(app.id);
    const r = await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: p.key } }));
    assert.equal((await r.json()).success, true, typed);
    await sendWelcome(env, { slugs: [p.slug] });
    const welcome = delivered.find((e) => /page is ready/.test(e.subject) && [e.to].flat().includes(email));
    assert.match(String(welcome?.text || ''), hi, typed);
  }
});
