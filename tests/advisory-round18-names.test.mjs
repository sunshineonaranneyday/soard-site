/**
 * Advisory Board QA round 18 (Nov 21 2026): how the application greets people by name (greetName and the name reader,
 * functions/api/_advisory-form.js), as the thank-you, the applicant's copy, the welcome and the monthly ask do. Every row
 * of the tester's 60 (test-results/qa18-public/n03-findings.mjs) and the brief's other names, the applicant's copy for
 * each, Add's web address and the name it keeps for the names whose reading changed, the welcome for the regression, and
 * the one last check (rule 1) on every name in the Advisory Board tests' lists. Made-up people only; Resend, Cloudflare
 * Access and Images are faked, nothing leaves this machine.
 * Round 20 (Nov 21 2026): the greeting now greets only on positive evidence (_advisory-form.js greetName); each row whose
 * greeting that changes says why, /* r20: ... * /.
 * Run: node --test tests/advisory-round18-names.test.mjs
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { createD1 } from './lib/d1-shim.mjs';
import { greetName, readName, TITLE, AFTER_NAME, ALSO_A_NAME } from '../functions/api/_advisory-form.js';
import { applicantEmail, readHeadshot, submitApplication } from '../functions/api/_advisory-applications.js';
import * as adminApi from '../functions/api/advisory-applications-admin.js';

// ── Rule 1, written here on its own (never the form's own check): what a greeting may be ──
// A first name (or a couple's two), or a title and a family name, in letters, spaces, apostrophes, hyphens inside a word
// and the full stops of a title or initials; never a pronoun, letters that go after a name, a title alone or before a
// whole name, "The", "Family" or "Pronouns". '' is no name ("Thank you."), always fine. → null, or what's wrong
// (titles that are names too, and the first words of a family name in parts: as _advisory-form.js has them)
const RANK = /^(?:pastor|father|rabbi|bishop|deacon|elder|minister|chaplain|imam|cantor|canon|sister|brother|coach|chef|senator|representative|governor|mayor|officer|detective)$/i;
const PARTS = /^(?:de|di|da|du|des|della|delle|degli|dei|dos|das|von|der|den|ter|ten|st|ste|saint|sainte|bin|ibn|van|vander|del|la|le|lo)\.?$/i;
const PRONOUNS = /^(?:she|her|hers|he|him|his|they|them|their|theirs|ze|zir|hir|xe|xem|xyr|xir)$/i;
function ruleOne(g) {
  if (g === '') return null;
  // (round 19, Nov 21 2026: a middle dot inside a word is part of it, rule 9, "Gal·la")
  if (!/^[\p{L}\p{M}\u200C\u200D '’.\-\u2010\u2011]+$/u.test(g.replace(/(\p{L})\u00B7(?=\p{L})/gu, '$1'))) return 'a mark that isn’t a letter, a space, an apostrophe, a hyphen or a full stop';
  const ws = g.split(' ');
  if (ws.some((w) => !w)) return 'a space at an end, or two together';
  const small = /\p{Ll}/u.test(g);
  const plain = (w) => w.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}]/gu, '');
  const known = (w) => AFTER_NAME.test(plain(w)) || ALSO_A_NAME.test(plain(w));
  const title = (w) => TITLE.test(w);
  for (const [k, w] of ws.entries()) {
    const start = k === 0 || ws[k - 1] === 'and';
    if (/^['’\-\u2010\u2011]|['’\-\u2010\u2011]$/u.test(w)) return `a mark at an end of “${w}”`;
    if (/^(?:the|family|families|pronouns?)$/i.test(w)) return `“${w}”`;
    if (PRONOUNS.test(w) && !(k > 0 && title(ws[k - 1]))) return `the pronoun “${w}”`;
    // (round 19: initials without their last full stop, rule 4, "T.J"; and "Ma." before the rest of the first name, rule 10,
    // "Ma. Teresa")
    if (w.includes('.') && !title(w) && !/^(?:\p{L}\.)+\p{L}?$/u.test(w) && !/^(?:st|ste)\.$/i.test(w) && !(/^ma\.$/i.test(w) && ws[k + 1] && ws[k + 1] !== 'and')) return `a full stop in “${w}”`;
    if (!title(w) && AFTER_NAME.test(plain(w)) && !(start && plain(w).length <= 3)) return `letters after a name, “${w}”`;
    if (/\p{Ll}\p{Lu}/u.test(w) && known(w)) return `letters after a name, “${w}”`;
    if (small && plain(w).length > 1 && w === w.toUpperCase() && known(w) && (title(w) || !start)) return `letters after a name, “${w}”`;
  }
  for (let k = 0; k < ws.length;) {
    let j = k;
    while (j < ws.length && title(ws[j])) { j++; if (ws[j] === 'and' && title(ws[j + 1] || '')) j++; }
    let e = j;
    while (e < ws.length && ws[e] !== 'and') e++;
    if (j > k) {
      const name = ws.slice(j, e);
      if (!name.length && !ws.slice(k, j).every((w) => RANK.test(w))) return 'a title on its own';
      if (name.length > 1 && !PARTS.test(name[0])) return 'a title before a whole name';
    }
    k = e + 1;
  }
  return null;
}

// ── Each row: [full name, preferred name, the greeting] (the tester's n03, word for word, then more of each kind) ──
const say = (rows) => {
  for (const [fullName, preferredName, want] of rows) {
    const got = greetName({ fullName, preferredName });
    assert.equal(got, want, `${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)}`);
    assert.equal(ruleOne(got), null, `${JSON.stringify(fullName)}: ${got}`);
    // (the applicant's copy, its first line, greets them the same: "Thank you, Jordan.", "Thank you, J.J." with one full
    // stop, or "Thank you." with no name)
    assert.equal(applicantEmail({ answers: { fullName, preferredName }, headshot: null }).text.split('\n')[0], want ? `Thank you, ${want}${want.endsWith('.') ? '' : '.'}` : 'Thank you.', fullName);
  }
};

test('F1: letters after a comma that follows a whole name are letters, never a title ("Jordan Ames, MS" is Jordan, as live greets it); a title alone after one family name is still one ("Ames, Dr." is Dr. Ames)', () => say([
  ['Jordan Ames, MS', '', 'Jordan'], ['Jane Doe, MS', '', 'Jane'], ['Jordan Ames, MS, LPC', '', 'Jordan'], ['Jordan Ames, MS, CCC-SLP', '', 'Jordan'],
  ['Dr. Jordan Ames, MS', '', 'Jordan'], ['Mrs. Quill, MS', '', ''] /* r20: a comma: no name */, ['Mr. & Mrs. Quill, MS', '', ''] /* r20: two people ("&" or "+"): no name */,
  ['Jordan & Amy Rowe, MS', '', ''] /* r20: two people ("&" or "+"): no name */, ['Jordan Ames Jr., MS', '', 'Jordan'],
  // (the brief's: more letters, and a title written after a whole name)
  ['Jordan Ames, MS, PE', '', 'Jordan'], ['Jordan Ames, Dr.', '', ''] /* r20: a comma: no name */, ['Jordan Ames, Capt, USN', '', ''] /* r20: a comma: no name */, ['Jordan Ames, Ms', '', 'Jordan'],
  ['Jordan Ames, Mx', '', ''] /* r20: a comma: no name */, ['Jordan Ames, Prof', '', ''] /* r20: a comma: no name */, ['Jordan Ames, Rev', '', ''] /* r20: a comma: no name */, ['Jordan Ames, Dr. & Mrs.', '', ''] /* r20: two people ("&" or "+"): no name */,
  ['Dana Price, MS', '', 'Dana'],
  // (as before: right on live and HEAD)
  ['Jordan Ames MS', '', 'Jordan'], ['Jordan Ames, MA', '', 'Jordan'], ['Jordan Ames, M.S.', '', 'Jordan'], ['Ames, Dr.', '', ''] /* r20: a comma: no name */, ['Quill, Mrs.', '', ''] /* r20: a comma: no name */,
  ['Van Dyke, Dr.', '', ''] /* r20: a comma: no name */, ['St. James, Rev.', '', ''] /* r20: initials or a word with a full stop: no name */, ['Ames, Ms.', '', ''] /* r20: a comma: no name */, ['Ames, Ms', '', ''] /* r20: a comma: no name */, ['Mrs. Ames, Dr.', '', ''] /* r20: a comma: no name */,
  ['Lee, MD', '', ''] /* r20: a comma: no name */, ['Quill, Dr., MD', '', ''] /* r20: a comma: no name */,
]));

test('F2: a preferred name loses its pronouns wherever they are and however they’re written, and what’s left is greeted; nothing left, their first name', () => say([
  ['Joanna Ames', 'Jo she/her', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo he/him', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo they/them', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'jo she/her', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */,
  ['Joanna Ames', 'Jo; she/her', 'Joanna'] /* r20: a semicolon in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo: she/her', 'Joanna'] /* r20: a colon in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo. she/her', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Pronouns: she/her', 'Joanna'],
  ['Joanna Ames', 'she/her Jo', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'she/her.', 'Joanna'], ['Joanna Ames', 'She/her.', 'Joanna'], ['Joanna Ames', 'they/them.', 'Joanna'],
  // (more of the same)
  ['Joanna Ames', 'Jo she / her', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo | she/her', 'Joanna'] /* r20: a mark that isn't part of a name in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'They/Them Jo', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Mary Beth she/her', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */,
  ['Joanna Ames', 'she', 'Joanna'], ['Joanna Ames', 'they', 'Joanna'], ['Joanna Ames', 'any pronouns', 'Joanna'], ['Joanna Ames', 'my pronouns are she/her', 'Joanna'],
  ['Joanna Ames', 'Liz (pronouns: she/her)', 'Joanna'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Joanna" */,
  // (as before)
  ['Joanna Ames', 'Jo \u2014 she/her', 'Joanna'] /* r20: a dash or an apostrophe at a word's end in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo, she/her', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo (she/her)', 'Joanna'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'she/her', 'Joanna'],
  ['Joanna Ames', 'Mary Beth', 'Mary Beth'], ['Joanna Ames', 'Em', 'Em'], ['Joanna Ames', 'Zé', 'Zé'], ['Joanna Ames', 'J.J.', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Dr. Jo', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */,
  ['Joanna Ames', 'Jo\u2010Ann', 'Jo-Ann'] /* r20: every dash, apostrophe and middle dot is read as its plain form */,
]));

test('F3: a title, one family name, then letters typed in pieces ("Ph. D.", "M. D.", "M. Eng") greets by the title and the name', () => say([
  ['Mrs. Quill Ph. D.', '', ''] /* r20: initials or a word with a full stop: no name */, ['Dr. Quill Ph. D.', '', ''] /* r20: initials or a word with a full stop: no name */, ['Mrs. Quill M. D.', '', ''] /* r20: initials or a word with a full stop: no name */, ['Mrs. Quill M. Eng', '', ''] /* r20: initials or a word with a full stop: no name */,
  ['Mr. & Mrs. Quill Ph. D.', '', ''] /* r20: two people ("&" or "+"): no name */, ['mrs. quill ph. d.', '', ''] /* r20: initials or a word with a full stop: no name */,
  ['Mrs. Quill Ph. D', '', ''] /* r20: initials or a word with a full stop: no name */, ['MRS. QUILL M. ENG', '', ''] /* r20: initials or a word with a full stop: no name */, ['Jordan Ames, Ph. D.', '', 'Jordan'], ['Jordan Ames, M. D.', '', 'Jordan'],
  // (as before; and single letters after a first name may be initials, kept: "Ames, M. D.", "Jordan T. Lee")
  ['Mrs. Quill Ph.D.', '', ''] /* r20: initials or a word with a full stop: no name */, ['Mrs. Quill M.Eng', '', ''] /* r20: initials or a word with a full stop: no name */, ['Jordan Ames Ph. D.', '', 'Jordan'], ['Ames, M. D.', '', ''] /* r20: a comma: no name */, ['Salinger, J. D.', '', ''] /* r20: a comma: no name */,
  ['Jordan T. Lee', '', 'Jordan'], ['J. D. Salinger', '', ''] /* r20: initials or a word with a full stop: no name */, ['Bishop Quill PhD', '', ''] /* r20: "Quill" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Bishop Quill Ph. D.', '', ''] /* r20: initials or a word with a full stop: no name */,
]));

test('F4: the first word of a full name is read without the marks around it, a leading aside in brackets goes as for a preferred name, and a slash or "&" with no spaces between two first names is a couple', () => say([
  ['(Jo) Joanna Ames', '', ''] /* r20: brackets or quotes: no name */, ['Dr. (Jo) Ames', '', ''] /* r20: brackets or quotes: no name */, ['[Jo] Ames', '', ''] /* r20: brackets or quotes: no name */, ['Ames, (Jo) Joanna', '', ''] /* r20: a comma: no name */, ['"Jo" Ames', '', ''] /* r20: brackets or quotes: no name */,
  ['Jordan/Amy Rowe', '', ''] /* r20: a slash: no name */, ['Rowe, Jordan/Amy', '', ''] /* r20: a comma: no name */, ['-Jordan Ames', '', ''] /* r20: a dash or an apostrophe at a word's end: no name */,
  // (the brief's, and more)
  ['Jordan&Amy Rowe', '', ''] /* r20: two people ("&" or "+"): no name */, ['“Jo” Ames', '', ''] /* r20: brackets or quotes: no name */, ["'Jo' Ames", '', ''] /* r20: a dash or an apostrophe at a word's end: no name */, ['(Jordan) & Amy Rowe', '', ''] /* r20: two people ("&" or "+"): no name */,
  ['Jordan Ames, she/her', '', ''] /* r20: a comma: no name */, ['Jordan Ames (he/him)', '', ''] /* r20: brackets or quotes: no name */,
  // (as before)
  ['Joanna (Jo) Ames', '', ''] /* r20: brackets or quotes: no name */, ['Jordan / Amy Rowe', '', ''] /* r20: a slash: no name */, ['Joanna "Jo" Ames', '', ''] /* r20: brackets or quotes: no name */, ['Jordan Ames/Acme', '', ''] /* r20: a slash: no name */,
]));

test('F5: last name first with titles and then letters, typed together or not, greets by the titles and the family name ("Quill, Mr. & Mrs. B.Arch" is Mr. and Mrs. Quill)', () => say([
  ['Quill, Mr. & Mrs. B.Arch', '', ''] /* r20: two people ("&" or "+"): no name */, ['Quill, Mr. & Mrs. MBA', '', ''] /* r20: two people ("&" or "+"): no name */, ['Quill, Mrs. PhD', '', ''] /* r20: a comma: no name */,
  ['Quill, Mrs. M.Eng', '', ''] /* r20: a comma: no name */, ['Quill, Dr. & Mrs. PhD', '', ''] /* r20: two people ("&" or "+"): no name */, ['Quill, Dr. MBA', '', ''] /* r20: a comma: no name */, ['Quill, Mrs. Ph. D.', '', ''] /* r20: a comma: no name */,
  // (as before)
  ['Quill, Mr. & Mrs.', '', ''] /* r20: two people ("&" or "+"): no name */, ['Quill, Mr. & Mrs., B.Arch', '', ''] /* r20: two people ("&" or "+"): no name */, ['Quill, Dr., MD', '', ''] /* r20: a comma: no name */,
  ['Quill, Jordan & T.J.', '', ''] /* r20: two people ("&" or "+"): no name */, ['Ames, Dr. Jordan', '', ''] /* r20: a comma: no name */, ['Dr. Ames, Jordan', '', ''] /* r20: a comma: no name */,
]));

test('F6: a title, a family name in capitals, then letters that are names too ("Dr. QUILL MD") greets by the title and the name', () => say([
  ['Dr. QUILL MD', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Mrs. QUILL MBA', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Mr. & Mrs. QUILL MBA', '', ''] /* r20: two people ("&" or "+"): no name */,
  ['Mrs. QUILL MD', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['Mr. and Mrs. QUILL MD', '', ''] /* r20: two people, or someone not named ("and"): no name */,
  // (as before)
  ['Mrs. QUILL PhD', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['MRS. QUILL MBA', '', ''] /* r20: "QUILL" isn't on the given-names list (a title it doesn't know, a short form, a family name, or not a name): no name */, ['JORDAN AMES MD', '', 'Jordan'], ['Jack MA', '', 'Jack'],
]));

test('lower: "The Rowe Family" greets with no name, "Jordan Rowe and family" greets Jordan', () => say([
  ['The Rowe Family', '', ''], ['Jordan Rowe and family', '', ''] /* r20: two people, or someone not named ("and"): no name */, ['Jordan Rowe & Family', '', ''] /* r20: two people ("&" or "+"): no name */, ['The Rock', '', ''],
  // (as before)
  ['Jordan & Amy Rowe', '', ''] /* r20: two people ("&" or "+"): no name */, ['Garcia Lopez, Maria', '', ''], ['The Honorable Jordan Ames', '', ''] /* r20: more than a title and three words (a title it doesn't know, of more than one word, among them): no name */,
]));

test('rule 1, the next simpler reading: a greeting that fails the check is read the simpler way (a preferred name as a full name is, the first clean word, a couple’s two first names), and failing that, no name', () => say([
  // (a whole name typed as the preferred one: read as a full name is)
  ['Joanna Ames', 'Dr. Jordan Lee', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Mrs. Quill M.Eng', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jordan & Amy Rowe', 'Joanna'] /* r20: two people ("&" or "+") in the name they go by: set aside, their full name's "Joanna" */,
  ['Joanna Ames', 'Mr. & Mrs. Ames', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Dana Price PhD', 'Joanna'] /* r20: more than two words in the name they go by (words around it, or a whole name): set aside, their full name's "Joanna" */, ['Joanna Ames', 'Ames Jr., Jordan', 'Joanna'] /* r20: a comma in the name they go by: set aside, their full name's "Joanna" */,
  // (marks the cleanup doesn't know: the first clean word)
  ['Joanna Ames', 'Jo 🌻', 'Joanna'] /* r20: a mark that isn't part of a name in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', '« Jo »', 'Joanna'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo\\Joanna', 'Joanna'] /* r20: a slash in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo（Joanna）', 'Joanna'] /* r20: brackets or quotes in the name they go by: set aside, their full name's "Joanna" */, ['Joanna Ames', 'Jo. she/her', 'Joanna'] /* r20: initials or a word with a full stop in the name they go by: set aside, their full name's "Joanna" */,
  // (nothing clean left: their first name, or no name at all)
  ['Joanna Ames', 'The Rock', 'Joanna'], ['Joanna Ames', 'Mrs.', 'Joanna'], ['Joanna Ames', 'Pronouns', 'Joanna'], ['N/A Rowe', '', ''], ['He Wei', '', ''],
]));

// ── Rule 1 on every name the Advisory Board tests have, as a full name and as a preferred name ──
test('rule 1: every string in the Advisory Board tests (their names among them), read as a full name and as a preferred name, is greeted cleanly or with no name', () => {
  const dir = new URL('.', import.meta.url);
  const seen = new Set();
  for (const f of readdirSync(dir).filter((x) => /^advisory.*\.test\.mjs$/.test(x))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      let s;
      try { s = JSON.parse(`"${(m[1] ?? m[2]).replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"')}"`); } catch { continue; }
      if (s.length <= 120 && /\p{L}/u.test(s)) seen.add(s);
    }
  }
  assert.ok(seen.size > 1000, `the tests' strings read (${seen.size})`);
  const wrong = [];
  // (names first in what's said: words that start with a capital, as people type a name)
  const nameLike = (s) => /^\p{Lu}[\p{L}'’.-]*(?:,? (?:&|and|\p{Lu}[\p{L}'’.-]*))*$/u.test(s);
  for (const s of seen) {
    for (const [fullName, preferredName] of [[s, ''], ['Joanna Ames', s]]) {
      const g = greetName({ fullName, preferredName });
      const why = ruleOne(g);
      if (why) wrong.push([nameLike(s) ? 0 : 1, `${JSON.stringify(fullName)} pref=${JSON.stringify(preferredName)} → ${JSON.stringify(g)}: ${why}`]);
    }
  }
  wrong.sort((x, y) => x[0] - y[0]);
  assert.equal(wrong.length, 0, `${wrong.length} greetings break rule 1 (${wrong.filter((w) => !w[0]).length} of names), for example:\n${wrong.slice(0, 25).map((w) => w[1]).join('\n')}`);
});

// ── Add, the name it keeps and its web address; and the welcome (the same greetName) ──
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

test('rule 7: Add keeps the name as typed; its web address changes only where these fixes read letters as letters, and stays as before for the rest', async () => {
  let k = 0;
  for (const [typed, slug] of [
    // (letters in pieces, after a family name in capitals, after titles written last name first: the name alone's address)
    ['Mrs. Quill Ph. D.', 'quill'], ['Mrs. Quill M. Eng', 'quill'], ['Dr. QUILL MD', 'quill'], ['Mr. & Mrs. QUILL MBA', 'quill'], ['Quill, Mr. & Mrs. B.Arch', 'quill'],
    ['Jordan Ames Ph. D.', 'jordan-ames'],
    // (as before: the greeting's reading of marks, pronouns and commas never moves an address)
    ['Jordan Ames, MS', 'jordan-ames'], ['Dr. Jordan Ames, MS', 'jordan-ames'], ['(Jo) Joanna Ames', 'jo-joanna-ames'], ['Jordan/Amy Rowe', 'jordan-amy-rowe'],
    ['-Jordan Ames', 'jordan-ames'], ['Jordan Rowe and family', 'jordan-rowe'], ['Mrs. Quill M.Eng', 'quill'],
  ]) {
    const app = await applied(typed, `r18.${++k}@example.org`);
    const p = await plan(app.id);
    assert.deepEqual([p.kind, p.slug, p.asName], ['new', slug, undefined], `${typed}: at ${slug}, the name kept as typed`);
    assert.equal(readName(typed).shown, typed, typed);
  }
});

test('F1 where it shows: "Jordan Ames, MS" is thanked, sent their copy, and welcomed once added as Jordan, never "MS Jordan Ames"', async () => {
  const { writeState } = await import('../functions/api/_board-roles.js');
  const { sendWelcome } = await import('../functions/api/_advisory-mail.js');
  await writeState(env.DB, 'advisory', { emails: true });
  const app = await applied('Jordan Ames, MS', 'jordan.ms@example.org');
  assert.equal(applicantEmail(app).text.split('\n')[0], 'Thank you, Jordan.');
  const p = await plan(app.id);
  const r = await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: p.key } }));
  assert.equal((await r.json()).success, true);
  await sendWelcome(env, { slugs: [p.slug] });
  const welcome = delivered.find((e) => /page is ready/.test(e.subject));
  assert.match(String(welcome?.text || ''), /^Hi Jordan,/);
});
