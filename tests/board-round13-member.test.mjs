/**
 * Board QA round 13 (Nov 24 2026), the members' board page: what it reads and what it draws.
 *   1  One account, one amount: each account's figure decided once over every account (money.js accountsSaid), the cash
 *      card's lines, the meeting's tile and search all take theirs from it; the smaller ones together are the sum of theirs
 *   2  An account below zero is its own line, by its name, with its minus, never in "the smaller accounts together"
 *   3  A budget year written as a span ("FY 2025-26", "FY25-26", "2025/2026") is read as that span before any single year
 *   4  Search finds a fiscal year however it's typed and however the page or the sheet writes it (find.js)
 *   5  The seasons switch: one style wherever it's drawn, never wider than its card (portal.css .bc-seg)
 *   6  The presenting screen's deck goes by the same unread flags as the meeting's page and Print (deckOf `unread`)
 *   7  A family's page when JobTread can't be read: familyOne carries the list's `jobs` flag
 *   8  The notes on the lines, the member's asks and the meetings they present in: each its own part (portalExtras)
 *   9  SOARD's facts: each of their reads its own part; the Impact fact says it couldn't load; Copy all says what's missing
 *  10  One failed read never keeps the board page from opening: every statement of the page's read failing once in turn
 *      (as a member, the secretary and a founder), the page opens, and every part that differs is marked unread
 * The page itself (the drawing, the words, 320 px, the screen): scripts/test-board-round13-member.mjs. Made-up people
 * only (the repo is public). Run: node --test tests/board-round13-member.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import * as money from '../public/admin/board/money.js';
import * as figures from '../public/admin/board/figures.js';
import * as find from '../public/admin/board/find.js';
import * as facts from '../public/admin/board/facts.js';
import * as stages from '../public/admin/board/stages.js';
import * as shared from '../public/admin/board-shared.js';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as portal from '../functions/api/board-portal.js';
import * as board from '../functions/api/_board.js';
import { stateReady, writeState } from '../functions/api/_board-roles.js';
import { ensureAsks, portalExtras } from '../functions/api/_board-asks.js';
import { orgFacts } from '../functions/api/_org-facts.js';
import { familyOne } from '../functions/api/_board-families.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';

const { cleanMeeting, todayEastern } = shared;
const ROOT = new URL('..', import.meta.url).pathname;
const day = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const Y0 = Number(day(0).slice(0, 4));
const r2 = (n) => Math.round(n * 100) / 100;
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
/** "$1,656,049" → 1656049, "−$12" → -12, "$313K" → 313000 */
const amountOf = (s) => { const m = String(s).match(/([−-])?\+?\$([\d,.]+)([KMB])?/); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]] || 1) : NaN; };
const cashOf = (accts) => ({ live: true, total: r2(accts.reduce((t, [, b]) => t + b, 0)), asOf: 'Nov 24, 2026', today: true, at: new Date().toISOString(), prior: null, priorAsOf: '', accounts: accts.map(([name, balance]) => ({ bank: 'Mercury', name, balance })), owed: [], banks: ['Mercury'], stale: [] });
const MEETING = { id: 'm_next0001', date: day(9), title: '', sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_fin0001', title: 'Year to date', live: 'cash' }] }], files: [], motions: [], actions: [] };
const dataOf = (cash, { unread = {} } = {}) => ({ today: day(0), cashHistory: [], meetings: [MEETING], gifts: null, snapshot: null, unread, numbers: { books: null, mercury: { empty: false }, finance: null, projects: { building: [], waiting: [] }, reveals: [], unread: {} } });

// ─── 1: one account, one amount ─────────────────────────────────────
// (the tester's QA_ACCTS: five Mercury accounts with cents, as real balances have; and nine)
const FIVE = [['Operating', 312500.49], ['Reserve', 62500.49], ['Savings', 1500.49], ['Petty Cash', 900.49], ['PayPal', 700.49]];
const NINE = [['Operating Checking', 312500.49], ['Long Reserve Savings', 62500.49], ['Makeover Fund', 20500.49], ['Store Payouts', 1500.49], ['Petty Cash', 900.49], ['PayPal Giving', 700.49], ['Square', 400.49], ['Venmo', 250.49], ['Event Float', 100.49]];
/** Each account's figure as the meeting's tile writes it for search ({ name: dollars }), and its words in the tile */
function tileAccounts(cash) {
  const tile = money.moneyTiles({ cash, budget: null, n: {} }).find((t) => t.k === 'bank');
  return { tile, figs: Object.fromEntries(tile.figs.filter((f) => /^cash:[^:]*:/.test(f.k)).map((f) => [f.k.replace(/^cash:[^:]*:/, ''), f.v])) };
}
test('r13 1: an account is one amount wherever it is drawn: the cash card, the meeting’s tile, its slide and search (five accounts, and nine)', () => {
  for (const accts of [FIVE, NINE]) {
    const cash = cashOf(accts);
    const total = amountOf(usd(cash.total));
    const lines = money.cashLines(cash);
    const { tile, figs } = tileAccounts(cash);
    // The card's named lines are the tile's figures for those accounts, to the dollar
    for (const l of lines.filter((x) => !x.rest)) assert.equal(l.said, figs[l.name], `${l.name}: the card says ${l.said}, the meeting’s tile ${figs[l.name]} (${tile.sub})`);
    // The smaller ones together are the sum of their own figures, as the tile writes each of them
    const rest = lines.find((x) => x.rest);
    if (rest) assert.equal(rest.said, rest.names.reduce((t, n) => t + figs[n], 0), `the smaller accounts together, ${rest.said}, are ${rest.names.map((n) => figs[n]).join(' + ')}`);
    // …and each place still adds up to the cash as written
    assert.equal(lines.reduce((t, l) => t + l.said, 0), total, 'the card’s lines are the cash');
    assert.equal(Object.values(figs).reduce((t, v) => t + v, 0), total, 'the tile’s accounts are the cash');
    // Search: one entry an account, its one amount
    const found = figures.moneyFigures(dataOf(cash), { cash, budget: null });
    for (const [name] of accts) {
      const own = found.filter((x) => x.title === name);
      assert.ok(own.length <= 1, `${name}: ${own.length} search entries (${own.map((x) => x.sub).join(' | ')})`);
      if (own.length) assert.equal(amountOf(own[0].sub), figs[name], `${name}: search says ${own[0].sub}`);
    }
  }
  // The tester's own: Reserve $62,500.49 among the five is $62,501 everywhere (the two largest remainders, ties to the first)
  const five = cashOf(FIVE);
  assert.deepEqual(money.accountsSaid(five), [312501, 62501, 1500, 900, 700]);
  assert.equal(money.cashLines(five).find((l) => l.rest).said, 3100);
});

// ─── 2: an account below zero ───────────────────────────────────────
test('r13 2: an overdrawn account is its own line, named with its minus, never netted into the smaller accounts together; the rule of two holds for the rest', () => {
  const cash = cashOf([['Operating', 312500.49], ['Reserve', 62500.49], ['Savings', 1500.49], ['Petty Cash', 900.49], ['PayPal', -700.49]]);
  const lines = money.cashLines(cash);
  const pay = lines.find((l) => l.name === 'PayPal');
  assert.ok(pay && !pay.rest, `PayPal is a line of its own (${JSON.stringify(lines.map((l) => [l.name, l.said]))})`);
  assert.equal(pay.over, true, 'said overdrawn');
  assert.ok(pay.said < 0, `with its minus (${pay.said})`);
  const rest = lines.find((l) => l.rest);
  assert.deepEqual(rest?.names, ['Savings', 'Petty Cash'], 'the smaller ones above zero together');
  assert.equal(lines.reduce((t, l) => t + l.said, 0), amountOf(usd(cash.total)), 'the lines still add up to the cash');
  // the meeting's tile says it the same: its figure, with its minus
  const { tile, figs } = tileAccounts(cash);
  assert.equal(figs.PayPal, pay.said);
  assert.match(tile.sub, /PayPal −\$700/);
  // Search: the account below zero, found with its minus, said overdrawn
  const e = figures.moneyFigures(dataOf(cash), { cash, budget: null }).find((x) => x.title === 'PayPal');
  assert.match(e.sub, /^−\$700, overdrawn/, e.sub);
  // One small one left above zero beside the overdrawn one: by its name (the rule of two)
  const one = money.cashLines(cashOf([['Operating', 312500], ['Reserve', 62500], ['Savings', 1500], ['PayPal', -700], ['Square', 20000]]));
  assert.ok(!one.some((l) => l.rest), JSON.stringify(one.map((l) => l.name)));
});

// ─── 3: a budget year written as a span ─────────────────────────────
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
/** The budget the page reads from a packet's sheet: its budget column headed `head`, a title row `title` above, named `name` */
async function budgetFrom({ head = 'Budget', title = 'SOARD Budget vs. Actuals', name = 'Budget vs Actual.xlsx' } = {}) {
  const bytes = sheet([[title], ['', head, 'Actual as of September 30, 2026'], ['Revenue Total', 2000000, 1500000], ['Total Expenses', 1500000, 1100000]]);
  const was = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes);
  try {
    const data = { today: day(0), meetings: [{ id: 'm_old', date: day(-60), files: [{ id: `bf_${Math.random().toString(36).slice(2, 10)}`, name, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'financials' }] }], numbers: {}, cashHistory: [], unread: {} };
    for (let k = 0; k < 40 && money.budgetKnown(data) === undefined; k++) await new Promise((r) => setTimeout(r, 15));
    return { data, budget: money.budgetKnown(data) };
  } finally { globalThis.fetch = was; }
}
// Every spelling rounds 12 and 13 listed, and what each names: the year it ends in, and the page's own name for it
const SPELLINGS = {
  'FY 2025-26 Budget': ['2026', '2025-26'], 'FY25-26 Budget': ['2026', '2025-26'], 'FY2025-26': ['2026', '2025-26'], 'FY 2025/26': ['2026', '2025-26'],
  '2025-26 Budget': ['2026', '2025-26'], 'Budget 2025-26': ['2026', '2025-26'], '2025/2026 Budget': ['2026', '2025-26'], '2025-2026 Budget': ['2026', '2025-26'], '2025–2026': ['2026', '2025-26'],
  'FY2026 Budget': ['2026', 'FY2026'], 'FY 2026 Budget': ['2026', 'FY2026'], 'FY26 Budget': ['2026', 'FY2026'], "FY'26": ['2026', 'FY2026'], 'FY’26 Budget': ['2026', 'FY2026'],
  '2026 Budget': ['2026', ''], Budget: ['', ''],
};
test('r13 3: a budget year written as a span is read as that span, before any single year in it, from the heading, the title rows and the file’s name alike', async () => {
  for (const [s, [year, label]] of Object.entries(SPELLINGS)) assert.deepEqual(money.sheetYear(s), { year, label }, s);
  // (the file's name, with its underscores: "Budget_FY26_P&L.xlsx", "FY_2025-26_Budget.xlsx")
  assert.deepEqual(money.sheetYear('Budget_FY26_P&L.xlsx'), { year: '2026', label: 'FY2026' });
  assert.deepEqual(money.sheetYear('FY_2025-26_Budget.xlsx'), { year: '2026', label: '2025-26' });
  // The sheet read three ways: the spelling in its budget column's heading, in the title above it, or in its file's name
  for (const [s, [year, label]] of Object.entries(SPELLINGS)) {
    if (!year) continue;
    const want = label || year;
    // (the heading names its column Budget: a spelling without the word has it after)
    for (const where of [{ head: /budget/i.test(s) ? s : `${s} Budget` }, { head: 'Budget', title: `SOARD ${s}` }, { head: 'Budget', name: `${s}${/budget/i.test(s) ? '' : ' Budget'} vs Actual.xlsx` }]) {
      // (a file's name can't hold a slash or an apostrophe: those spellings are read from the heading and the title)
      if (where.name && /[/'’]/.test(s)) continue;
      const { data, budget } = await budgetFrom(where);
      assert.equal(budget?.year, want, `${JSON.stringify(where)} → ${budget?.year}`);
      const tiles = figures.figureTiles({ data, cash: null, budget }).filter((t) => t.key === 'rev' || t.key === 'exp').map((t) => t.label);
      assert.deepEqual(tiles, [`${want} revenue`, `${want} expenses`], JSON.stringify(where));
      assert.equal(money.budgetHeading(budget.year), `${want} against its budget`);
    }
  }
});

// ─── 4: search finds the budget year however it's typed ─────────────
const TYPED = ['FY2026', 'FY 2026', 'FY26', 'FY 26', "FY'26", '2025-26', '2025-2026', '2025/26', '2025/2026', 'FY 2025-26', 'FY25-26', 'FY2025-26', 'fiscal year 2026'];
const BUDGET_KEYS = ['yr:rev', 'yr:exp', 'rev:bud', 'exp:bud'];
const finds = (entry, q) => find.matches(find.prep(entry.hay), find.planOf(find.termsOf(q)));
test('r13 4: every spelling of a fiscal year finds the budget’s figures, whichever way the sheet or the page writes it, and never another year’s', async () => {
  for (const head of ['FY2026 Budget', 'FY 2026 Budget', 'FY26 Budget', '2025-26 Budget', '2025/2026 Budget', 'FY 2025-26 Budget', 'FY25-26 Budget']) {
    const { data, budget } = await budgetFrom({ head });
    const list = figures.moneyFigures(data, { cash: null, budget }).filter((x) => BUDGET_KEYS.includes(x.key));
    assert.equal(list.length, 4, `${head}: the budget’s four figures (${list.map((x) => x.key)})`);
    for (const q of [...TYPED, `${TYPED[1]} revenue`, '2025/2026 revenue', 'FY26 revenue', '2026 revenue']) {
      const hit = list.filter((x) => finds(x, q));
      assert.ok(hit.length >= (/revenue/.test(q) ? 2 : 4), `${head}: “${q}” finds ${hit.map((x) => x.title).join(', ') || 'nothing'}`);
    }
    // never the year before's, nor the one after
    for (const q of ['FY2025', 'FY 2027', '2024-25', '2026/2027']) assert.ok(!list.some((x) => finds(x, q)), `${head}: “${q}” finds ${list.filter((x) => finds(x, q)).map((x) => x.title)}`);
  }
  // Any text with a fiscal year, not only the budget's figures: a file's name, a meeting's words
  for (const text of ['Budget_FY26_P&L.xlsx', 'FY 2025-26 Budget vs Actual', 'Approved the 2025/2026 budget']) for (const q of TYPED) assert.ok(find.matches(find.prep(text), find.planOf(find.termsOf(q))), `“${q}” finds “${text}”`);
  // Letters and digits joined or apart: "Q4" and "Q 4", "Level10" and "level 10"
  for (const [text, q] of [['Q4 Board Meeting', 'q 4'], ['Q 4 report', 'q4'], ['Level10 meeting', 'level 10']]) assert.ok(find.matches(find.prep(text), find.planOf(find.termsOf(q))), `“${q}” finds “${text}”`);
  // …and marked where it's shown, however it's written there
  const re = new RegExp(find.termRe(find.termsOf('FY 2026')[0]), 'g');
  for (const t of ['fy2026', 'fy 2026', 'fy26', "fy'26", '2025-26', '2025/2026', 'fy 2025-26', 'fy25-26']) { re.lastIndex = 0; assert.ok(re.test(t), `marked in “${t}”`); }
  re.lastIndex = 0;
  assert.ok(!re.test('fy2027'));
});

// ─── 5: the seasons switch at 320 ───────────────────────────────────
test('r13 5: the seasons switch has one style wherever it is drawn: never wider than its card, no copy of it beside', () => {
  const css = readFileSync(`${ROOT}public/admin/board/portal.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const base = rules.find((r) => r.sel === '.bc-seg');
  assert.match(base?.body || '', /max-width:\s*100%/, 'the switch is never wider than what holds it');
  assert.match(base.body, /flex:\s*0 1 auto/, 'and gives way in a row');
  const copies = rules.filter((r) => r.sel !== '.bc-seg' && /(^|[\s,])\.(bc-seg|lc-seasons)\b(?![\w-])(?![^,]*\s)/.test(r.sel) && /max-width|border-radius|flex:/.test(r.body));
  assert.deepEqual(copies.map((r) => r.sel), [], 'no second copy of its size');
});

// ─── 6: the presenting screen follows the page's flags ──────────────
const ROWS = [{ k: 'head', label: 'Income', d: 0 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, p: 1909703 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, p: 176000 }];
const BOOKS = { year: String(Y0), revenue: 1884217, expenses: 972001, store: { sales: 415000, cost: 250000 }, lastYear: { year: String(Y0 - 1), revenue: 1500000, expenses: 1100000 }, statements: { asOf: day(-20), priorAsOf: day(-385), activity: ROWS, position: ROWS } };
test('r13 6: with the money not loaded, no slide of QuickBooks’ figures follows the money’s own slide; with it loaded, they do', () => {
  const kinds = (unread) => shared.deckOf(MEETING, { books: BOOKS, unread }).map((s) => s.kind);
  assert.ok(kinds({}).includes('books'), `loaded: QuickBooks’ slides (${kinds({})})`);
  for (const unread of [{ money: true }, { money: true, gifts: true }]) assert.ok(!kinds(unread).includes('books'), `${JSON.stringify(unread)}: ${kinds(unread)}`);
  // (the money's own slide stays, saying it couldn't load: screen.js liveSlide; another part not loaded changes nothing here)
  assert.ok(kinds({ money: true }).includes('item'));
  assert.deepEqual(kinds({ kids: true }), kinds({}));
});

// ─── The database, one statement failing ────────────────────────────
let raw;
let fault = null; // { k, seen, failed: [{ sql, args }], test }
function check(sql, args) {
  if (!fault || (fault.test && !fault.test(String(sql || ''), args))) return;
  const i = fault.seen++;
  if (i === fault.k) { fault.failed.push({ sql: String(sql), args, stack: process.env.R13_STACK ? new Error().stack : '' }); throw new Error('D1_ERROR: Network connection lost.'); }
}
// (`fault.landed`: a write runs, and then its answer is lost, as D1's can be after it landed)
const wrap = (st, args = []) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run', 'raw'].includes(m) ? async (...a) => {
  if (fault?.landed && m === 'run') { const out = await s[m](...a); check(s._sql, args); return out; }
  check(s._sql, args); return s[m](...a);
} : m === 'bind' ? (...a) => wrap(s.bind(...a), a) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => { for (const s of stmts) check(s._sql, []); return raw.batch(stmts); }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});

// ─── 7: a family's page when JobTread can't be read ─────────────────
test('r13 7: a family’s own page carries the list’s jobs flag: JobTread not read, their step is their application’s and said so, never as where they are', async () => {
  raw = await createD1();
  const env = { DB: hookedDB() };
  await raw.exec('CREATE TABLE IF NOT EXISTS site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await board.ensureSchema(env.DB);
  await ensureApplicantSchema(env.DB);
  await raw.prepare('INSERT INTO applicants (account_id, name, status, year, types, fields, created_at, synced_at, job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('acctMaya01', 'Maya Example', 'Approved', String(Y0), JSON.stringify(['Bedroom']), JSON.stringify({ diagnosis: 'An example diagnosis' }), `${day(-40)}T14:00:00Z`, new Date().toISOString(), 'j1').run();
  const fetchImpl = async () => { throw new Error('JobTread not answering'); };
  // JobTread not read (no copy kept, and none to read): the family's step is their application's, and it says so
  const lost = (await familyOne({ ...env, JOBTREAD_GRANT_KEY: 'jt-test' }, 'acctMaya01', { fetchImpl })).family;
  assert.equal(lost.jobs, false, JSON.stringify({ jobs: lost.jobs, stage: lost.stage }));
  assert.equal(lost.stage, 'approved');
  assert.equal(stages.stageKnown(lost, lost.jobs), false, 'the page says so, never “where they are”');
  // Read: JobTread's step, and nothing to say
  await writeState(env.DB, 'projects', { at: new Date().toISOString(), value: { byStatus: { Build: 1 }, building: [{ jobId: 'j1', name: 'Maya', slug: null, status: 'Build' }], waiting: [], open: { j1: 'Build' } } });
  const read = (await familyOne({ ...env, JOBTREAD_GRANT_KEY: 'jt-test' }, 'acctMaya01', { fetchImpl })).family;
  assert.equal(read.jobs, true);
  assert.equal(read.stage, 'build');
  assert.equal(stages.stageKnown(read, read.jobs), true);
  // a family with no job has their application's step whatever JobTread does
  assert.equal(stages.stageKnown({ stage: 'review', jobId: null }, false), true);
});

// ─── The world: a board, its meetings, papers, notes, asks and money (made up) ─
const TEAM = 'soard';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const SAM = 'sam.board@example.org';
const TAYLOR = 'taylor.board@example.net';
const KIM = 'kim.board@example.com';
const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', role: 'founder' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', seat: 'chair' }],
  ['sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer' }],
  ['taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', seat: 'secretary' }],
  ['kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' }],
];
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', SAM], ['taylor-nguyen', TAYLOR], ['kim-park', KIM]];
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function signIn(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}
let env;
const realFetch = globalThis.fetch;
function fakeFetch() {
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    return new Response('{}', { status: 503 });
  };
}
const ORG = { name: 'Example Charity', shortName: 'EC', legalName: 'Example Charity Incorporated', ein: '12-3456789', phone: '404-555-0100', email: 'hello@example.org', address: { street: '1 Example Way', city: 'Roswell', state: 'GA', zip: '30075' } };
async function world() {
  raw = await createD1();
  env = { DB: hookedDB(), CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)',
    'CREATE TABLE community (slug TEXT PRIMARY KEY, name TEXT, data TEXT)',
    'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  ]) await raw.exec(sql);
  for (const [slug, d] of PEOPLE) await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify({ slug, status: 'active', ...d })).run();
  for (const [slug, email] of EMAILS) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  for (const [slug, name] of [[`maya-${Y0}`, 'Maya'], [`leo-${Y0}`, 'Leo']]) await raw.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, name, Y0, JSON.stringify({ name, year: Y0, childCount: 1, roomCount: 1 })).run();
  await raw.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('settings', JSON.stringify(ORG)).run();
  await raw.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('media', JSON.stringify({ mission: 'Dream rooms for kids.', bio: { founded: '2008', boilerplate: 'An example charity.' } })).run();
  await raw.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind('financials', JSON.stringify({ documents: [{ title: '2025 990 Tax Return', year: 2025, type: '990', url: 'https://files.sunshineonaranneyday.com/financials/example-990.pdf' }] })).run();
  await board.ensureSchema(env.DB);
  await stateReady(env.DB);
  await ensureAsks(env.DB);
  await writeState(env.DB, 'settings', { quorum: 3, admins: [FOUNDER], asks: 'on' });
  const board5 = EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' }));
  // The next meeting, shared: the money (Sam presents it), a note on its Total Income line, an ask for Sam's report, and
  // a file Sam put with it
  const next = await board.saveMeeting(env.DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', shared: true, attendance: board5,
    sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_fin', title: 'Year to date', live: 'cash', who: ['sam-ortiz'] }, { id: 'i_prog', title: 'Programs', who: ['kim-park'] }] }],
    actions: [{ id: 'a_sam', text: 'Send the audit letter', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }] }), { by: 'test' });
  await raw.prepare('INSERT INTO board_line_notes (meeting_id, item_id, key, line, text, by_slug, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(next.id, 'i_fin', 'act:Total Income', 'Total Income', 'Down 1% on last year: the gala moved to January.', 'sam-ortiz', 'Sam Ortiz', new Date().toISOString()).run();
  await raw.prepare("INSERT INTO board_asks (id, kind, meeting_id, item_id, slug, name, email, title, due, status, asked_at) VALUES ('ask_sam', 'report', ?, 'i_fin', 'sam-ortiz', 'Sam Ortiz', ?, 'Year to date', ?, 'asked', ?)").bind(next.id, SAM, `${day(5)}T12:00:00-05:00`, new Date().toISOString()).run();
  await raw.prepare("INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, at, by) VALUES ('f_samfile', 'meeting', ?, 'k/f_samfile', 'Audit letter.pdf', 'application/pdf', 1200, 'other', ?, ?)").bind(next.id, new Date().toISOString(), SAM).run();
  // A meeting ahead not shared yet, where Sam presents an item with its motion written (so its agenda isn't a draft)
  await board.saveMeeting(env.DB, cleanMeeting({ date: day(6), start: '18:00', end: '19:00', shared: false, attendance: board5,
    sections: [{ id: 's_x', title: 'Special', items: [{ id: 'i_x', title: 'The reserve policy', who: ['sam-ortiz'], motion: 'To adopt the reserve policy.' }] }] }), { by: 'test' });
  // A meeting held, its minutes a draft, with a correction waiting; one long ago, its minutes approved and signed
  const draft = await board.saveMeeting(env.DB, cleanMeeting({ date: day(-30), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Q3 minutes.docx', at: new Date().toISOString() }, attendance: board5, sections: [{ title: 'New business', items: [{ title: 'Gala' }] }] }), { by: 'test' });
  await raw.prepare("INSERT INTO board_minutes_corrections (id, meeting_id, target, kind, words, by_slug, by_name, by_email, at, state) VALUES ('c_one', ?, 'general', 'add', 'Kim moved the gala vote.', 'kim-park', 'Kim Park', ?, ?, 'waiting')").bind(draft.id, KIM, new Date().toISOString()).run();
  const old = await board.saveMeeting(env.DB, cleanMeeting({ date: day(-120), start: '08:00', end: '10:00', shared: true, minutes: 'approved', approvedOn: day(-90), minutesFrom: { name: 'Q2 minutes.docx', at: new Date().toISOString() }, attendance: board5, sections: [{ title: 'Reports', items: [{ title: 'Treasurer' }] }] }), { by: 'test' });
  await raw.prepare("INSERT INTO board_minutes_signed (meeting_id, slug, name, at, how, hash, file_id) VALUES (?, 'taylor-nguyen', 'Taylor Nguyen', ?, 'typed', 'h0', 'f_signedmin')").bind(old.id, new Date().toISOString()).run();
  // SOARD's papers: one to read and sign, one a PDF whose words search reads
  await raw.prepare('INSERT INTO board_docs (id, data, updated_at) VALUES (?, ?, ?)').bind('d_coi', JSON.stringify({ id: 'd_coi', title: 'Conflict of Interest Policy', kind: 'policy', shared: true, sign: true, body: '# Conflict of interest\n\nEach member tells the board of any conflict.', version: 2, signFrom: 2 }), new Date().toISOString()).run();
  await raw.prepare('INSERT INTO board_doc_versions (doc_id, version, body, at, by) VALUES (?, ?, ?, ?, ?)').bind('d_coi', 1, '# Conflict of interest\n\nEach member tells the chair.', new Date().toISOString(), FOUNDER).run();
  await raw.prepare('INSERT INTO board_signatures (doc_id, slug, year, name, at) VALUES (?, ?, ?, ?, ?)').bind('d_coi', 'sam-ortiz', Y0, 'Sam Ortiz', new Date().toISOString()).run().catch(() => {});
  await raw.prepare('INSERT INTO board_docs (id, data, updated_at) VALUES (?, ?, ?)').bind('d_bylaws', JSON.stringify({ id: 'd_bylaws', title: 'Bylaws', kind: 'governing', shared: true }), new Date().toISOString()).run();
  await raw.prepare("INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, at, by) VALUES ('f_bylaws', 'doc', 'd_bylaws', 'k/f_bylaws', 'Bylaws.pdf', 'application/pdf', 5000, 'other', ?, ?)").bind(new Date().toISOString(), FOUNDER).run();
  await raw.prepare("UPDATE board_files SET words = 'Article One. The fiscal year runs from August.' WHERE id = 'f_bylaws'").run().catch(() => {});
  await raw.prepare('INSERT INTO board_member_marks (slug, mark, initials, consent_at) VALUES (?, ?, ?, ?)').bind('sam-ortiz', JSON.stringify({ type: 'typed', text: 'Sam Ortiz', style: 'a' }), 'SO', new Date().toISOString()).run();
  // The month-end balances (no QuickBooks), and today's practice meeting for the founder
  for (const [month, total] of [[day(-60).slice(0, 7), 350000], [day(-30).slice(0, 7), 362000], [day(0).slice(0, 7), 375000]]) await raw.prepare('INSERT INTO board_cash (month, total, at) VALUES (?, ?, ?)').bind(month, total, new Date().toISOString()).run();
  await raw.prepare('INSERT INTO board_practice (id, date, data, updated_at) VALUES (?, ?, ?, ?)').bind('p_today01', day(0), JSON.stringify(cleanMeeting({ id: 'p_today01', date: day(0), start: '09:00', end: '10:00', practice: true, sections: [{ title: 'Practice', items: [{ title: 'A vote' }] }] })), new Date().toISOString()).run();
  _resetKeyCacheForTests();
  return raw._db.export();
}
async function route(path, who) {
  const request = new Request(`https://sunshineonaranneyday.com${path}`, { headers: { 'CF-Access-JWT-Assertion': await signIn(who), Origin: 'https://sunshineonaranneyday.com' } });
  const later = [];
  const ctx = { request, env, data: {}, waitUntil: (p) => { later.push(p); } };
  ctx.next = async () => portal.onRequestGet(ctx);
  const res = await onRequest(ctx);
  const text = await res.text();
  await Promise.allSettled(later);
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body };
}

// ─── 8: the notes, the asks and the meetings they present in ────────
test('r13 8: the notes on the lines, my asks and the meetings I present in are each their own part: one not read is marked, the others stand', async () => {
  fakeFetch();
  try {
    await world();
    const meetings = await board.listMeetings(env.DB);
    const sam = { member: { slug: 'sam-ortiz', name: 'Sam Ortiz', email: SAM }, admin: false, meetings };
    const clean = await portalExtras(env, sam);
    assert.equal(clean.unread, undefined, 'a clean read marks nothing');
    assert.equal(Object.values(clean.lineNotes).flatMap((x) => Object.values(x)).flat().length, 1, 'the note');
    assert.equal(clean.myAsks.length, 1, 'Sam’s ask');
    assert.equal(clean.presenting.length, 1, 'the meeting Sam presents in before it’s shared');
    for (const [part, re, keep] of [['lineNotes', /FROM board_line_notes/, ['myAsks', 'presenting']], ['myAsks', /FROM board_asks/, ['lineNotes', 'presenting']], ['presenting', /FROM board_state WHERE key/, ['lineNotes', 'myAsks']]]) {
      fault = { test: (sql) => re.test(sql), k: 0, seen: 0, failed: [] };
      const x = await portalExtras(env, sam);
      fault = null;
      assert.deepEqual(Object.keys(x.unread || {}), [part], `${re}: ${JSON.stringify(x.unread)}`);
      for (const k of keep) assert.deepEqual(x[k], clean[k], `${part} not read: ${k} stands`);
    }
  } finally { globalThis.fetch = realFetch; fault = null; }
});

// ─── 9: SOARD's facts ───────────────────────────────────────────────
test('r13 9: SOARD’s facts mark each read that failed; the card’s Impact says it couldn’t load with the kids served, and Copy all says what it leaves out', async () => {
  await world();
  const clean = await orgFacts(env);
  assert.equal(clean.unread, undefined);
  assert.equal(clean.ein, ORG.ein);
  for (const [key, part] of [['settings', 'settings'], ['media', 'media'], ['org-check', 'irs']]) {
    fault = { test: (sql, args) => /FROM site_config WHERE key/.test(sql) && args[0] === key, k: 0, seen: 0, failed: [] };
    const o = await orgFacts(env);
    fault = null;
    assert.deepEqual(o.unread, { [part]: true }, `${key}: ${JSON.stringify(o.unread)}`);
    const missing = facts.factsMissing(o, {});
    assert.equal(missing.length, 1);
    const text = facts.factsText(facts.factsOf(o, {}), missing);
    assert.match(text, /Not included, as it couldn’t load just now: /, text);
  }
  // The kids served not read: the Impact fact says so, has nothing to copy, and Copy all says it's left out
  const all = facts.factsOf(clean, { impact: null, unread: { kids: true } });
  const imp = all.find((x) => x.id === 'impact');
  assert.equal(imp?.unloaded, true, JSON.stringify(imp));
  assert.equal(imp.value, 'Couldn’t load just now');
  const text = facts.factsText(all, facts.factsMissing(clean, { unread: { kids: true } }));
  assert.ok(!/Impact:/.test(text) && /the kids served/.test(text), text);
  // and read: as before
  assert.match(facts.factsText(facts.factsOf(clean, { impact: { kids: 4, rooms: 4, byYear: [] } })), /Impact: 4 kids served and 4 rooms built/);
});

// ─── 10: the page always opens ──────────────────────────────────────
/**
 * The page's data, flattened (only what a failed read could change: no clock, no visit), each value at its path
 */
const SKIP = /^(numbers\.at|me\.lastSeen|.*\.at$|.*At$|.*readAt|today)$|^(unread|numbers\.unread)\./;
const flat = (o, p = '', out = {}) => { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); } else out[p] = o; return out; };
/** The parts a value at this path belongs to: one of them must be marked when it changed */
function partsOf(path) {
  const top = path.split('.')[0];
  if (/^meetings\.\d+\.files\.\d+\.mine$/.test(path)) return ['ownFiles', 'meetings'];
  if (/^meetings\.\d+\.invite(By|Out)/.test(path)) return ['settings', 'meetings'];
  if (/^docs\.\d+\.fileWords/.test(path)) return ['paperWords', 'docs'];
  if (/^docs\.\d+\.myCopies/.test(path)) return ['copies', 'docs'];
  if (/^docs\.\d+\.signedBody/.test(path)) return ['signedBodies', 'docs'];
  if (/^me\.mark/.test(path)) return ['mark'];
  if (/^numbers\.(cash|mercury|finance|operating|costs|books)/.test(path)) return ['money'];
  if (/^numbers\.(projects|reveals|pastReveals)/.test(path)) return ['projects'];
  if (/^numbers\.(impact|rooms|photos)/.test(path)) return ['kids'];
  if (/^numbers\.(events|recentEvents)/.test(path)) return ['events'];
  if (/^numbers\.(meetings|thisYear)/.test(path)) return ['meetings'];
  return ({
    meetings: ['meetings'], next: ['meetings'], actions: ['meetings'], nextPending: ['meetings'], previews: ['meetings'], docs: ['docs'], cashHistory: ['history', 'money'],
    filings: ['sources'], snapshot: ['sources'], gifts: ['gifts', 'givers'], lineNotes: ['lineNotes'], myAsks: ['myAsks'], presenting: ['presenting'], review: ['review'], reviewShut: ['review'],
    corrections: ['corrections'], minutesSigned: ['minutesSigned'], org: ['facts'], notesWaiting: ['notesWaiting'], minutesTypedBy: ['notesWaiting'], admins: ['settings'], contact: ['settings'], quorum: ['settings'],
    practice: ['practice'], emailAll: ['emailAll'],
  })[top] || [];
}
async function pageSweep(who, least, { landed = false } = {}) {
  await world();
  // (one read first, as a running site has had: the tables each part makes on its first read are there, as they are live)
  await route('/api/board-portal', who);
  const bytes = raw._db.export();
  raw = await createD1({ bytes });
  _resetKeyCacheForTests();
  const control = await route('/api/board-portal', who);
  assert.equal(control.status, 200, JSON.stringify(control.body).slice(0, 300));
  assert.deepEqual(control.body.unread, {}, 'a clean read marks nothing');
  const C = flat(control.body);
  const problems = [];
  let runs = 0;
  const signIn = [];
  for (let k = 0; k < 400; k++) {
    // (the same database, as a running site has it: Board's tables set up once, never again a statement of this read)
    raw = await createD1({ bytes });
    _resetKeyCacheForTests();
    // (`landed`: only the read's writes, each landing with its answer lost)
    fault = { k, seen: 0, failed: [], landed, ...(landed ? { test: (sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql) } : {}) };
    let r;
    try { r = await route('/api/board-portal', who); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
    const f = fault.failed[0];
    fault = null;
    if (!f) break;
    runs += 1;
    const name = `k=${k} [${f.sql.replace(/\s+/g, ' ').slice(0, 80)} ${JSON.stringify(f.args).slice(0, 40)}]`;
    if (process.env.R13_LIST) console.log(`${name} → ${r.status} ${JSON.stringify(r.body?.unread || {})}`);
    // (who's signed in not checked, or People not answering: the sign-in's own words with Try again, decided in rounds 9
    // and 10, never a page for someone not known nor one with the board's names missing)
    if (r.status === 503 && /couldn’t check (your sign-in|People|who runs Board)/.test(r.body?.error || '')) { signIn.push(name); continue; }
    if (r.status !== 200) { problems.push(`${name} → ${r.status} ${JSON.stringify(r.body).slice(0, 160)}${f.stack ? `\n${f.stack.split('\n').slice(2, 9).join('\n')}` : ''}`); continue; }
    const unread = new Set(Object.keys(r.body.unread || {}));
    if (r.body.emailAll?.unread) unread.add('emailAll');
    const F = flat(r.body);
    const differ = [...new Set([...Object.keys(C), ...Object.keys(F)])].filter((p) => !SKIP.test(p) && !/^unread\./.test(p) && JSON.stringify(C[p]) !== JSON.stringify(F[p]));
    const unmarked = differ.filter((p) => !partsOf(p).some((x) => unread.has(x)));
    if (unmarked.length) problems.push(`${name} → 200, unread ${JSON.stringify([...unread])}, but changed without a word: ${unmarked.slice(0, 5).map((p) => `${p}=${JSON.stringify(C[p])?.slice(0, 30)}→${JSON.stringify(F[p])?.slice(0, 30)}`).join(' ; ')}`);
  }
  console.log(`# ${who}: swept ${runs} statements (${signIn.length} of them the sign-in's), ${problems.length} wrong`);
  // (a founder's: who runs Board, Board's settings, as round 9 decided)
  assert.ok(signIn.every((x) => /FROM team|reveal_board_emails|staff_state/.test(x) || (who === FOUNDER && /FROM board_state WHERE key = \? \["settings"\]/.test(x))), `only the sign-in's and People's own reads: ${signIn.join('\n')}`);
  assert.deepEqual(problems, [], `${problems.length} of ${runs}:\n${problems.join('\n')}`);
  assert.ok(runs >= least, `swept every statement of the page’s read (${runs})`);
}
test('r13 10: every statement of the page’s read failing once in turn, a member’s page always opens, every part that changed marked unread', async () => {
  fakeFetch();
  try { await pageSweep(SAM, 40); } finally { globalThis.fetch = realFetch; fault = null; }
});
test('r13 10: …the secretary’s too (the notes typed, the minutes to sign, the corrections to decide)', async () => {
  fakeFetch();
  try { await pageSweep(TAYLOR, 40); } finally { globalThis.fetch = realFetch; fault = null; }
});
test('r13 10: …and a founder’s (the previews, today’s practice meeting, the chair’s review)', async () => {
  fakeFetch();
  try { await pageSweep(FOUNDER, 40); } finally { globalThis.fetch = realFetch; fault = null; }
});
test('r13 10: each write the page’s read makes (the visit kept, the sign-in noted) landing with its answer lost: the page opens, nothing marked that was read', async () => {
  fakeFetch();
  try {
    // (a founder looking keeps no visit: none to make)
    for (const [who, least] of [[SAM, 2], [TAYLOR, 2], [FOUNDER, 0]]) await pageSweep(who, least, { landed: true });
  } finally { globalThis.fetch = realFetch; fault = null; }
});
test('r13 10: the five the tester found each mark their own part: the month-end balances, which files are mine, the papers’ words, the corrections, the signed minutes', async () => {
  fakeFetch();
  try {
    for (const [who, re, part] of [[SAM, /FROM board_cash WHERE total/, 'history'], [SAM, /SELECT id FROM board_files WHERE lower\(by\)/, 'ownFiles'], [SAM, /COALESCE\(NULLIF\(words/, 'paperWords'],
      [TAYLOR, /FROM board_minutes_corrections WHERE state/, 'corrections'], [TAYLOR, /FROM board_minutes_signed/, 'minutesSigned']]) {
      await world();
      fault = { test: (sql) => re.test(sql), k: 0, seen: 0, failed: [] };
      const r = await route('/api/board-portal', who);
      const failed = fault.failed.length;
      fault = null;
      assert.ok(failed, `${re} was read`);
      assert.equal(r.status, 200, `${re}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.deepEqual(Object.keys(r.body.unread || {}), [part], `${re}: ${JSON.stringify(r.body.unread)}`);
    }
  } finally { globalThis.fetch = realFetch; fault = null; }
});

