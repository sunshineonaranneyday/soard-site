/**
 * Advisory Board QA round 24 (Nov 23 2026), decided 5: the Advisory Board is "the Advisory Board" and each person on it
 * "an Advisory Board member", never "advisor" or "advisors", in every word a person reads in the staff admin
 * (public/admin) and everything the site's functions say (functions/): Admin → Automations had "active, published
 * advisors", and Board → Advisory, Emails & invites and the invites' own words had more.
 * What a person reads: every string and template literal in the code (comments are not read), and the text of the admin's
 * HTML pages. Not words: a value code compares ("advisor", the kind of sign-in), names in code (activeAdvisors,
 * data.advisor) and the server's own log lines (console.*). The word itself, quoted as a word, is a mention ("never
 * “advisors”", the rule as the site's guide for Claude states it).
 * Run: node --test tests/advisory-round24-words.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { parse } from '@babel/parser';

const ROOT = new URL('..', import.meta.url).pathname;
const WORD = /\badvisors?\b/i;
// (a value code compares, never shown: one word and nothing else)
const CODE_VALUE = /^\s*advisors?\s*$/i;
// (the word quoted as a word, “advisors”: a mention, not the word used)
const MENTION = /[“"‘']advisors?[”"’']/gi;

function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    // (the admin's third-party bundle, built from node_modules, isn't the site's words)
    else if (/\.(m?js|html)$/.test(f) && f !== 'vendor.js') out.push(p);
  }
  return out;
}

/** Every string a person can read in this code, with its line: string and template literals, outside console.* calls */
function stringsOf(src, offset = 0) {
  const ast = parse(src, { sourceType: 'module', errorRecovery: true, plugins: ['jsx'] });
  const out = [];
  const visit = (n, inLog) => {
    if (!n || typeof n.type !== 'string') return;
    const log = inLog || (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.object?.name === 'console');
    if (!log && n.type === 'StringLiteral') out.push({ line: n.loc.start.line + offset, text: n.value });
    if (!log && n.type === 'TemplateElement') out.push({ line: n.loc.start.line + offset, text: n.value.cooked ?? n.value.raw });
    for (const [k, v] of Object.entries(n)) {
      if (['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments', 'extra'].includes(k)) continue;
      if (Array.isArray(v)) for (const c of v) visit(c, log);
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, log);
    }
  };
  visit(ast.program, false);
  return out;
}

/** The words of an HTML page outside its scripts, styles and comments, by line; and its scripts' strings */
function htmlWords(src) {
  const blank = (x) => x.replace(/[^\n]/g, ' ');
  const out = [];
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) out.push(...stringsOf(m[1], src.slice(0, m.index).split('\n').length - 1));
  const text = src.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, blank).replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, blank).replace(/<!--[\s\S]*?-->/g, blank);
  // (attributes a person reads too: titles, labels, placeholders, alt text)
  text.split('\n').forEach((l, i) => {
    const seen = [l.replace(/<[^>]*>/g, ' '), ...[...l.matchAll(/\b(?:title|aria-label|placeholder|alt|content)="([^"]*)"/g)].map((m) => m[1])];
    for (const t of seen) out.push({ line: i + 1, text: t });
  });
  return out;
}

export function advisorWords(root = ROOT) {
  const found = [];
  for (const f of [...files(join(root, 'public/admin')), ...files(join(root, 'functions'))]) {
    const src = readFileSync(f, 'utf8');
    const strings = extname(f) === '.html' ? htmlWords(src) : stringsOf(src);
    for (const s of strings) {
      if (CODE_VALUE.test(s.text)) continue;
      if (WORD.test(s.text.replace(MENTION, ''))) found.push(`${relative(root, f)}:${s.line} ${JSON.stringify(s.text.slice(0, 140))}`);
    }
  }
  return found;
}

test('5: nothing a person reads in the staff admin or from the site\'s functions says "advisor" or "advisors": "Advisory Board member" or "the Advisory Board"', () => {
  const found = advisorWords();
  assert.deepEqual(found, [], `"advisor" where a person reads it:\n${found.join('\n')}`);
});

test('5: the scan finds the word where a person reads it, and only there (its own check, on made-up code)', () => {
  const said = (src) => stringsOf(src).filter((s) => !CODE_VALUE.test(s.text) && WORD.test(s.text.replace(MENTION, ''))).map((s) => s.text);
  assert.deepEqual(said("const a = { does: 'Adds active, published advisors to the list' };"), ['Adds active, published advisors to the list']);
  assert.deepEqual(said('const t = html`<p>No advisors yet, ${n} of them</p>`;'), ['<p>No advisors yet, ']);
  assert.deepEqual(said("if (w.kind === 'advisor') x(); // an advisor's routes"), [], 'a value code compares, and a comment');
  assert.deepEqual(said("console.error('[board] advisors’ papers', e);"), [], 'a log line');
  assert.deepEqual(said("const activeAdvisors = (advisor) => advisor.slug;"), [], 'names in code');
  assert.deepEqual(said("const rule = 'The Advisory Board is the Advisory Board, never “advisors”.';"), [], 'the word quoted as a word');
  assert.deepEqual(htmlWords('<p title="For advisors">Hi</p><script>const x = 1;</script>').map((s) => s.text).filter((t) => WORD.test(t)), ['For advisors']);
});
