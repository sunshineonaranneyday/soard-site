/**
 * Board QA round 14 (Nov 24 2026), the members' board page: what it reads and what it draws.
 *   1  A correction that replaces the member's own waiting one says so (`replaced`, `where`), swept: every statement
 *      failing once in turn and each landing with its answer lost, the answer matching what the database has
 *   2  An empty state only when its part was read and is really empty: one helper (unread.js emptyRead), and every
 *      empty state of a part that can fail asks it
 *   3  Each route knows the parts it draws from (unread.js ROUTE_PARTS, routeName, lostOn)
 *   4  The month-end balances not read: the cash's change on a year says it couldn't load where it would be
 *   5  Every way a fiscal year is written ("Fiscal Year 2026", "Fiscal 2026", "FY-2026", "FY-26", "FY.26", "F.Y. 2026",
 *      "Fiscal Year 2025-26" and round 13's) is read as that year, in the heading, the title rows and the file's name,
 *      and search finds it by every spelling
 *   6  Search never invents a year: with none read, "the revenue budget", as the tile says "Revenue"
 *   7  One function says the quorum: with the settings not read, the page, Print and the minutes' outline say it isn't
 *      said here, never a majority guessed
 *   8  One list of accounts: an account at $0 (or rounding to it) is listed as "$0" on Financials and the meeting's tile,
 *      and found by its name; only a written figure below zero is overdrawn
 * The page itself (each route with each part failing, the presses, the words): scripts/test-board-round14-member.mjs.
 * Made-up people only (the repo is public). Run: node --test tests/board-round14-member.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import * as money from '../public/admin/board/money.js';
import * as figures from '../public/admin/board/figures.js';
import * as find from '../public/admin/board/find.js';
import * as unread from '../public/admin/board/unread.js';
import * as shared from '../public/admin/board-shared.js';
import * as template from '../public/admin/board-minutes-template.js';
import { createD1 } from './lib/d1-shim.mjs';
import * as board from '../functions/api/_board.js';
import { suggestCorrection } from '../functions/api/_board-corrections.js';
import { stateReady } from '../functions/api/_board-roles.js';

const { cleanMeeting, todayEastern } = shared;
const ROOT = new URL('..', import.meta.url).pathname;
const day = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const Y0 = Number(day(0).slice(0, 4));
const r2 = (n) => Math.round(n * 100) / 100;
const src = (f) => readFileSync(`${ROOT}${f}`, 'utf8');

// ─── The database not answering one statement, or answering it and losing the answer (round 13's sweep) ───
let raw;
let fault = null; // { k, seen, failed, mode }
const SETUP = /^\s*(CREATE|ALTER|PRAGMA)\b/i;
const hit = (sql) => {
  if (!fault || SETUP.test(String(sql || ''))) return false;
  const i = fault.seen++;
  if (i !== fault.k) return false;
  fault.failed.push(String(sql));
  return true;
};
const LOST = () => new Error('D1_ERROR: Network connection lost.');
const wrap = (st) => new Proxy(st, {
  get: (s, m) => (['all', 'first', 'run'].includes(m) ? async (...a) => {
    if (!hit(s._sql)) return s[m](...a);
    if (fault.mode === 'lost') await s[m](...a);
    throw LOST();
  } : m === 'bind' ? (...a) => wrap(s.bind(...a)) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]),
});
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => {
      let lost = false;
      for (const s of stmts) if (hit(s._sql)) { if (fault.mode !== 'lost') throw LOST(); lost = true; }
      const r = await raw.batch(stmts);
      if (lost) throw LOST();
      return r;
    }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});

// ─── 1: a correction that replaces their own waiting one says so ─────
const SAM = { member: { slug: 'sam-ortiz', name: 'Sam Ortiz', email: 'sam.board@example.org' } };
const TAYLOR = 'taylor.board@example.net';
const OLD = 'The board talked about Roll call. Motion carried 5 to 0. Sam asked for the vote count to be added.';
const NEW = 'The board talked about Roll call. Taylor took the roll.';
let mail = [];
const realFetch = globalThis.fetch;
async function correctionWorld() {
  raw = await createD1();
  const env = { DB: hookedDB(), RESEND_API_KEY: 're_test' };
  for (const sql of [
    'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
    'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
  ]) await raw.exec(sql);
  for (const [slug, name, group, title, seat] of [['jane-doe', 'Jane Doe', 'team', 'Co-Founder/President', ''], ['sam-ortiz', 'Sam Ortiz', 'board', 'Board Treasurer', ''], ['taylor-nguyen', 'Taylor Nguyen', 'board', 'Board Secretary', 'secretary']]) {
    await raw.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, name, group, JSON.stringify({ slug, name, group, title, status: 'active', ...(seat ? { seat } : {}) })).run();
  }
  for (const [slug, email] of [['sam-ortiz', SAM.member.email], ['taylor-nguyen', TAYLOR]]) await raw.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  await board.ensureSchema(env.DB);
  await stateReady(env.DB);
  const held = await board.saveMeeting(env.DB, cleanMeeting({ date: day(-30), start: '08:00', end: '10:00', shared: true, minutesFrom: { typed: true, name: 'Typed', at: new Date().toISOString() },
    attendance: [['sam-ortiz', 'Sam Ortiz'], ['taylor-nguyen', 'Taylor Nguyen']].map(([slug, name]) => ({ slug, key: slug, name, kind: 'board', status: 'present' })),
    sections: [{ title: 'Call to order', items: [{ title: 'Roll call', notes: 'The board talked about Roll call. Motion carried 5 to 0.' }] }] }), { by: 'test' });
  const item = held.sections[0].items[0];
  // Sam's own correction, waiting
  const first = await suggestCorrection(env, { meetingId: held.id, target: `n:${item.id}`, words: OLD, was: item.notes }, SAM);
  return { env, held, item, first, bytes: raw._db.export() };
}
const fakeMail = () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); for (const e of [].concat(b)) mail.push([].concat(e.to)); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_1' }); }
    return new Response('{}', { status: 503 });
  };
};
const pressed = async (fn) => { try { return { status: 200, body: await fn() }; } catch (err) { return { status: err?.status || 500, body: { error: String(err?.message || err), ...(err?.extra || {}) } }; } };
const waitingOf = async () => (await raw.prepare("SELECT id, words FROM board_minutes_corrections WHERE by_slug = 'sam-ortiz' AND state = 'waiting'").all()).results || [];

test('r14 1: a correction that replaces the member’s own waiting one on the same words says so, and where', async () => {
  fakeMail();
  try {
    const w = await correctionWorld();
    assert.equal(w.first.replaced, undefined, 'the first one replaces nothing');
    const r = await suggestCorrection(w.env, { meetingId: w.held.id, target: `n:${w.item.id}`, words: NEW, was: w.item.notes }, SAM);
    assert.equal(r.correction.id, w.first.correction.id, 'his own, reworded');
    assert.equal(r.replaced, true, `the answer says it replaced his waiting one: ${JSON.stringify(r)}`);
    assert.equal(r.where, 'Roll call');
    assert.deepEqual((await waitingOf()).map((c) => c.words), [NEW]);
    // The page's words for it (public/admin/board/minutes.js Box)
    assert.match(src('public/admin/board/minutes.js'), /j\.replaced \? ` This replaced your waiting correction on \$\{j\.where \|\| 'these words'\}\.`/);
  } finally { globalThis.fetch = realFetch; fault = null; }
});

test('r14 1: the replacing correction swept, every statement failing once in turn and each landing with its answer lost: the answer says replaced exactly when the database has it so', async () => {
  fakeMail();
  try {
    const w = await correctionWorld();
    const NOTHING = /nothing was changed/;
    const UNSURE = /can’t tell yet whether that was saved/;
    const problems = [];
    let runs = 0;
    for (const mode of ['fail', 'lost']) {
      for (let k = mode === 'fail' ? -1 : 0; k < 300; k++) {
        raw = await createD1({ bytes: w.bytes });
        mail = [];
        fault = k < 0 ? null : { k, seen: 0, failed: [], mode };
        const r = await pressed(() => suggestCorrection(w.env, { meetingId: w.held.id, target: `n:${w.item.id}`, words: NEW, was: w.item.notes }, SAM));
        const failedSql = fault?.failed?.[0] || '';
        fault = null;
        if (k >= 0 && !failedSql) break;
        runs += 1;
        const rows = await waitingOf();
        const name = `${mode} k=${k} [${failedSql.replace(/\s+/g, ' ').slice(0, 80) || 'control'}] → ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
        if (rows.length !== 1) { problems.push(`${name}: ${rows.length} waiting`); continue; }
        const landed = rows[0].words === NEW;
        if (r.status === 503 && UNSURE.test(r.body.error)) continue; // (the look failing too: neither said)
        if (landed && !(r.status === 200 && r.body.replaced === true && r.body.where === 'Roll call' && r.body.correction?.id === rows[0].id)) problems.push(`${name}: it replaced his waiting one, and the answer didn’t say so`);
        if (!landed && !(r.status >= 400 && NOTHING.test(r.body.error) && rows[0].words === OLD)) problems.push(`${name}: nothing landed, and it answered so`);
      }
    }
    console.log(`# swept: ${runs} runs, ${problems.length} wrong`);
    assert.ok(runs >= 8, `only ${runs} runs`);
    assert.deepEqual(problems, [], problems.join('\n'));
  } finally { globalThis.fetch = realFetch; fault = null; }
});

// ─── 2: an empty state only when its part was read ──────────────────
test('r14 2: an empty state may be said only when its part was read and is really empty: one helper', () => {
  const data = (u = {}) => ({ unread: u, numbers: { unread: {} } });
  assert.equal(unread.emptyRead(data(), 'lineNotes', []), true, 'read and empty');
  assert.equal(unread.emptyRead(data(), 'lineNotes', [{ key: 'x' }]), false, 'read, not empty');
  assert.equal(unread.emptyRead(data({ lineNotes: true }), 'lineNotes', []), false, 'not read: never said empty');
  assert.equal(unread.emptyRead(data({ lineNotes: true }), 'lineNotes', new Map()), false);
  assert.equal(unread.emptyRead(data(), 'meetings', new Set()), true);
  assert.equal(unread.emptyRead(data(), 'meetings', 0), true);
  assert.equal(unread.emptyRead({ numbers: { unread: { history: true } } }, 'history', []), false, 'a part of today’s numbers');
  assert.equal(unread.emptyRead(data(), 'money', [], { unread: { money: true } }), false, 'a meeting’s numbers');
  // Every empty state of a part that can fail asks it, beside its words (the round 14 tester's and what that sweep found)
  const EMPTY = [
    ['public/admin/board/review.js', 'No notes on these numbers yet.', 'lineNotes'],
    ['public/admin/board/portal.js', 'The income statement and balance sheet from each meeting show here.', 'meetings'],
    ['public/admin/board/portal.js', 'Bylaws and policies show here', 'docs'],
    ['public/admin/board/portal.js', 'Past meetings show here once they’re added.', 'meetings'],
  ];
  for (const [file, words, part] of EMPTY) {
    const s = src(file);
    const at = s.indexOf(words);
    assert.ok(at > 0, `${file}: “${words}”`);
    assert.match(s.slice(Math.max(0, at - 700), at), new RegExp(`emptyRead\\([^)]*'${part}'`), `${file}: “${words}” is said only when ${part} was read and is empty (./unread.js emptyRead)`);
  }
  // …and the report page's foot passes whether the notes were read (portal.js → review.js FinanceReview notesLost)
  assert.match(src('public/admin/board/portal.js'), /notesLost=\$\{failed\(data, 'lineNotes'\)\}/);
});

// ─── 3: each route knows the parts it draws from ────────────────────
test('r14 3: each route names the parts it draws from; the ones failed just now are the route’s lost parts', () => {
  const R = (hash) => { const [page = '', id = null, sub = '', item = ''] = hash.replace(/^#\/?/, '').split('/'); return { page, id, sub: page === 'meetings' && id && ['report', 'review', 'screen'].includes(sub) ? sub : page === 'families' && id === 'map' ? 'map' : sub, item }; };
  const want = { '#/': 'home', '#/meetings': 'meetings', '#/meetings/m_1': 'meeting', '#/meetings/m_1/report/i_1': 'report', '#/meetings/m_1/review': 'review', '#/financials': 'financials', '#/people': 'people', '#/documents': 'documents', '#/documents/d_1': 'paper', '#/families': 'families', '#/families/acct1': 'family' };
  for (const [hash, name] of Object.entries(want)) {
    assert.equal(unread.routeName(R(hash)), name, hash);
    assert.ok(Array.isArray(unread.ROUTE_PARTS[name]), `${name} has its parts`);
  }
  for (const [name, parts] of Object.entries(unread.ROUTE_PARTS)) for (const p of parts) assert.ok(unread.UNREAD_WORDS[p], `${name}: ${p} has its words`);
  // The tester's three: Documents and Financials draw on the meetings, a paper's page on the papers
  assert.ok(unread.ROUTE_PARTS.documents.includes('meetings') && unread.ROUTE_PARTS.financials.includes('meetings') && unread.ROUTE_PARTS.paper.includes('docs'));
  assert.deepEqual(unread.lostOn({ unread: { meetings: true, lineNotes: true } }, 'documents'), ['meetings']);
  assert.deepEqual(unread.lostOn({ unread: {}, numbers: { unread: { history: true } } }, 'financials'), ['history']);
  // The page's words in place: the meetings' files, the packets' statements, a paper's page
  assert.match(unread.unreadWords('meetings', 'files'), /^The meetings’ files couldn’t load just now\./);
  assert.match(unread.unreadWords('meetings', 'statements'), /statements in the meetings’ packets couldn’t load/);
  assert.match(unread.unreadWords('docs', 'paper'), /didn’t open/);
  assert.equal(unread.unreadWords('docs', 'nowhere'), unread.UNREAD_WORDS.docs);
  // No em or en dash a person reads
  for (const w of [...Object.values(unread.UNREAD_WORDS), ...Object.values(unread.UNREAD_PLACE)]) assert.ok(!/[–—]/.test(w), w);
});

// ─── 4: the cash's change on a year, its month-end balances not read ─
const cashNumbers = (accts) => ({ total: r2(accts.reduce((t, [, b]) => t + b, 0)), at: new Date().toISOString(), accounts: accts.map(([name, balance]) => ({ bank: 'Mercury', name, balance })), owed: [] });
const MEETING = { id: 'm_next0001', date: day(9), title: '', sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_fin0001', title: 'Year to date', live: 'cash' }] }], files: [], motions: [], actions: [] };
const yearAgo = () => { const ym = todayEastern().slice(0, 7); return `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`; };
test('r14 4: with the month-end balances not read, the cash’s change on a year says it couldn’t load on Home’s and Financials’ tiles, never just gone', () => {
  const live = cashNumbers([['Operating', 312500], ['Reserve', 62500]]);
  const base = { today: day(0), meetings: [MEETING], gifts: null, snapshot: null, numbers: { cash: live, books: null, mercury: { empty: false }, finance: null, projects: { building: [], waiting: [] }, reveals: [], unread: {} } };
  // Read: the change from a year ago
  const read = { ...base, unread: {}, cashHistory: [{ month: yearAgo(), total: 340000 }] };
  const c1 = money.liveCash(read);
  assert.equal(c1.prior, 340000);
  assert.ok(!c1.priorLost);
  const t1 = figures.figureTiles({ data: read, cash: c1, budget: null }).find((t) => t.key === 'cash');
  assert.match(t1.note, /▲ \$35K from a year ago/);
  assert.ok(!t1.noteUnread);
  // Not read (the server's flag, its history empty): said where the change would be, on both tiles
  const lost = { ...base, unread: { history: true }, numbers: { ...base.numbers, unread: { history: true } }, cashHistory: [] };
  const c2 = money.liveCash(lost);
  assert.equal(c2.prior, null);
  assert.equal(c2.priorLost, true, 'the cash knows its change on a year couldn’t load');
  for (const variant of ['home', 'fin']) {
    const t2 = figures.figureTiles({ data: lost, cash: c2, budget: null, variant }).find((t) => t.key === 'cash');
    assert.equal(t2.note, 'The change from a year ago couldn’t load just now.', `${variant}: ${JSON.stringify(t2)}`);
    assert.equal(t2.noteUnread, 'history');
  }
  // QuickBooks' cash the same, and search never finds a change it doesn't have
  const books = { cash: { total: 375000, at: new Date().toISOString(), accounts: [] }, at: new Date().toISOString() };
  assert.equal(money.booksCash(lost, books).priorLost, true);
  assert.equal(money.booksCash(read, books).priorLost, false);
  assert.ok(!figures.moneyFigures(lost, { cash: c2, budget: null }).some((x) => x.key === 'cash:chg'));
  // (the Cash in the bank card says it in its place: ./portal.js CashCard)
  assert.match(src('public/admin/board/portal.js'), /cash\.priorLost \? html`[^`]*<span data-unread="history" role="status">\$\{unreadWords\('history', 'change'\)\}/);
});

// ─── 5: every way a fiscal year is written ──────────────────────────
/** A real ZIP of { name: text } (an .xlsx's parts) */
function zip(files) {
  const enc = new TextEncoder();
  const locals = []; const central = []; let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const nameB = enc.encode(name); const rawB = enc.encode(body); const data = deflateRawSync(rawB);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(rawB.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(rawB.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
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
// Round 14's spellings, then round 12's and 13's: each, and what it names (the year it ends in, the page's name for it)
const SPELLINGS = {
  'Fiscal Year 2026 Budget': ['2026', 'FY2026'], 'Fiscal 2026 Budget': ['2026', 'FY2026'], 'FY-2026 Budget': ['2026', 'FY2026'], 'FY-26 Budget': ['2026', 'FY2026'], 'FY.26 Budget': ['2026', 'FY2026'],
  'F.Y. 2026 Budget': ['2026', 'FY2026'], 'F.Y.2026 Budget': ['2026', 'FY2026'], 'fiscal year 2026 budget': ['2026', 'FY2026'], 'Fiscal Year 2025-26 Budget': ['2026', '2025-26'], 'Fiscal 2025/26 Budget': ['2026', '2025-26'],
  'FY-2025-26 Budget': ['2026', '2025-26'], 'F.Y. 2025-2026 Budget': ['2026', '2025-26'],
  'FY 2025-26 Budget': ['2026', '2025-26'], 'FY25-26 Budget': ['2026', '2025-26'], 'FY2025-26': ['2026', '2025-26'], 'FY 2025/26': ['2026', '2025-26'],
  '2025-26 Budget': ['2026', '2025-26'], 'Budget 2025-26': ['2026', '2025-26'], '2025/2026 Budget': ['2026', '2025-26'], '2025-2026 Budget': ['2026', '2025-26'], '2025–2026': ['2026', '2025-26'],
  'FY2026 Budget': ['2026', 'FY2026'], 'FY 2026 Budget': ['2026', 'FY2026'], 'FY26 Budget': ['2026', 'FY2026'], "FY'26": ['2026', 'FY2026'], 'FY’26 Budget': ['2026', 'FY2026'],
  '2026 Budget': ['2026', ''], Budget: ['', ''],
};
test('r14 5: every way a fiscal year is written is read as that year, in the heading, the title rows and the file’s name alike', async () => {
  for (const [s, [year, label]] of Object.entries(SPELLINGS)) assert.deepEqual(money.sheetYear(s), { year, label }, s);
  // (never a word that only starts like one: "fyi", "Fiscal years", "Fiscal sponsor" are no fiscal year)
  for (const s of ['fyi 2026 notes', 'Fiscal sponsor 2026', 'Fiscal years 2026']) assert.deepEqual(money.sheetYear(s), { year: '2026', label: '' }, s);
  assert.deepEqual(money.sheetYear('Budget_Fiscal_Year_2026.xlsx'), { year: '2026', label: 'FY2026' });
  assert.deepEqual(money.sheetYear('FY-26_P&L.xlsx'), { year: '2026', label: 'FY2026' });
  for (const [s, [year, label]] of Object.entries(SPELLINGS)) {
    if (!year) continue;
    const want = label || year;
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
const TYPED = ['Fiscal Year 2026', 'fiscal year 2026', 'Fiscal 2026', 'FY-2026', 'FY-26', 'FY.26', 'F.Y. 2026', 'F.Y.2026', 'fiscal year 2025-26', 'Fiscal Year 2025-2026',
  'FY2026', 'FY 2026', 'FY26', 'FY 26', "FY'26", '2025-26', '2025-2026', '2025/26', '2025/2026', 'FY 2025-26', 'FY25-26', 'FY2025-26'];
const BUDGET_KEYS = ['yr:rev', 'yr:exp', 'rev:bud', 'exp:bud'];
const finds = (entry, q) => find.matches(find.prep(entry.hay), find.planOf(find.termsOf(q)));
test('r14 5: search finds the budget’s figures by every spelling of its fiscal year, whichever way the sheet writes it, and never another year’s', async () => {
  for (const head of ['Fiscal Year 2026 Budget', 'FY-2026 Budget', 'FY-26 Budget', 'F.Y. 2026 Budget', 'Fiscal Year 2025-26 Budget', 'FY 2026 Budget', '2025/2026 Budget']) {
    const { data, budget } = await budgetFrom({ head });
    const list = figures.moneyFigures(data, { cash: null, budget }).filter((x) => BUDGET_KEYS.includes(x.key));
    assert.equal(list.length, 4, `${head}: the budget’s four figures (${list.map((x) => x.key)})`);
    for (const q of [...TYPED, 'Fiscal Year 2026 revenue', 'FY-26 revenue']) {
      const hit = list.filter((x) => finds(x, q));
      assert.ok(hit.length >= (/revenue/.test(q) ? 2 : 4), `${head}: “${q}” finds ${hit.map((x) => x.title).join(', ') || 'nothing'}`);
    }
    for (const q of ['FY2025', 'Fiscal Year 2027', 'FY-27', '2024-25', 'F.Y. 2025']) assert.ok(!list.some((x) => finds(x, q)), `${head}: “${q}” finds ${list.filter((x) => finds(x, q)).map((x) => x.title)}`);
  }
  // Any text, the way it's written there: a file's name, a meeting's words, a heading
  for (const text of ['Budget_FY-26_P&L.xlsx', 'Fiscal Year 2026 Budget vs Actual', 'The F.Y. 2026 budget passed', 'Fiscal Year 2025-26 report']) for (const q of TYPED) assert.ok(find.matches(find.prep(text), find.planOf(find.termsOf(q))), `“${q}” finds “${text}”`);
  // …and marked where it's shown, however it's written there
  const re = new RegExp(find.termRe(find.termsOf('Fiscal Year 2026')[0]), 'gi');
  for (const t of ['fiscal year 2026', 'fiscal 2026', 'fy-2026', 'fy-26', 'fy.26', 'f.y. 2026', 'fiscal year 2025-26', 'fy2026', 'fy 26', '2025/2026']) { re.lastIndex = 0; assert.ok(re.test(t), `marked in “${t}”`); }
  re.lastIndex = 0;
  assert.ok(!re.test('fiscal year 2027'));
  // (a word that's no fiscal year is read as it's typed)
  assert.deepEqual(find.termsOf('fyi 2026'), ['fyi', '2026']);
});

// ─── 6: search never invents a year ─────────────────────────────────
test('r14 6: with no year in the budget sheet, search names none: “the revenue budget”, as the tile says “Revenue”', async () => {
  const { data, budget } = await budgetFrom({ head: 'Budget', title: 'SOARD Budget vs. Actuals', name: 'Budget vs Actual.xlsx' });
  assert.equal(budget?.year, '');
  const tiles = figures.figureTiles({ data, cash: null, budget }).filter((t) => t.key === 'rev' || t.key === 'exp');
  assert.deepEqual(tiles.map((t) => t.label), ['Revenue', 'Expenses']);
  const list = figures.moneyFigures(data, { cash: null, budget });
  const bud = list.filter((x) => BUDGET_KEYS.includes(x.key) || /chgly/.test(x.key));
  assert.ok(bud.length >= 4, bud.map((x) => x.key).join());
  for (const x of bud) assert.ok(!/\b20\d\d\b/.test(`${x.title} ${x.sub}`), `no year guessed: ${x.title} | ${x.sub}`);
  assert.deepEqual(list.filter((x) => x.key === 'rev:bud' || x.key === 'exp:bud').map((x) => x.title), ['The revenue budget', 'The expenses budget']);
  assert.ok(list.some((x) => x.key === 'rev:bud' && finds(x, 'revenue budget')));
  assert.ok(!list.some((x) => BUDGET_KEYS.includes(x.key) && finds(x, `${Y0} revenue`)), `“${Y0} revenue” finds no budget figure`);
});

// ─── 7: one function says the quorum ────────────────────────────────
const board6 = (here) => ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => ({ key: k, slug: k, name: `Person ${k.toUpperCase()}`, kind: 'board', status: i < here ? 'present' : 'absent' }));
const unzipText = (bytes, name) => {
  const b = Buffer.from(bytes);
  for (let i = 0; i < b.length - 4; i++) {
    if (b.readUInt32LE(i) !== 0x04034b50) continue;
    const method = b.readUInt16LE(i + 8); const size = b.readUInt32LE(i + 18); const nl = b.readUInt16LE(i + 26); const xl = b.readUInt16LE(i + 28);
    const n = b.slice(i + 30, i + 30 + nl).toString();
    const body = b.slice(i + 30 + nl + xl, i + 30 + nl + xl + size);
    if (n === name) return (method === 8 ? inflateRawSync(body) : body).toString();
  }
  return '';
};
test('r14 7: one function says the quorum; with the board’s settings not read, it isn’t said, in the outline and the Word file too, never a majority guessed', () => {
  const m = cleanMeeting({ date: day(-30), attendance: board6(3), sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }] });
  assert.deepEqual(shared.quorumOf(m, { quorum: 3 }), { need: 3, met: true, after: ', a quorum', unsaid: '' });
  assert.deepEqual(shared.quorumOf(m, { quorum: 0 }), { need: 4, met: false, after: ', short of a quorum (4)', unsaid: '' }, 'a majority, Settings saying none');
  const lost = shared.quorumOf(m, { quorum: 0, lost: true });
  assert.equal(lost.need, null);
  assert.equal(lost.met, null);
  assert.equal(lost.after, '');
  assert.equal(lost.unsaid, 'The board’s settings couldn’t load just now, so the quorum isn’t said here.');
  // The minutes' outline: the notes panel, the printed form and the Word file
  assert.equal(template.minutesOutline(m, { quorum: 3 }).quorum, 3);
  assert.equal(template.minutesOutline(m, { quorum: 0, quorumLost: true }).quorum, null);
  const doc = (o) => unzipText(template.minutesDocx(m, o), 'word/document.xml');
  assert.match(doc({ quorum: 3 }), /Quorum: 3 of 6 board members/);
  const xml = doc({ quorum: 0, quorumLost: true });
  assert.ok(!/Quorum: \d/.test(xml), 'no number said');
  assert.match(xml, /so the quorum isn’t said here/);
  // Every place it's said goes by it: the meeting's page, Home, Print, the notes panel, the outline
  const page = src('public/admin/board/portal.js');
  assert.ok(!/quorumFor\(/.test(page), 'the page never works one out itself');
  assert.ok(!/quorumFor\(/.test(src('public/admin/board/print.js')), 'nor Print');
  assert.match(src('public/admin/board/print.js'), /quorumOf\(m, \{ quorum, lost: quorumLost \}\)/);
  assert.match(src('public/admin/board/print.js'), /quorumLost: !!data\?\.unread\?\.settings/);
  assert.match(src('public/admin/board/notes.js'), /quorumLost = failed\(data, 'settings'\)/);
  assert.match(page, /\.\.\.quorumOpts\(data\)/);
});

// ─── 8: one list of accounts ────────────────────────────────────────
const cashOf = (accts) => ({ live: true, total: r2(accts.reduce((t, [, b]) => t + b, 0)), asOf: 'Nov 24, 2026', today: true, at: new Date().toISOString(), prior: null, priorAsOf: '', accounts: accts.map(([name, balance]) => ({ bank: 'Mercury', name, balance })), owed: [], banks: ['Mercury'], stale: [] });
const dataOf = () => ({ today: day(0), cashHistory: [], meetings: [MEETING], gifts: null, snapshot: null, unread: {}, numbers: { books: null, mercury: { empty: false }, finance: null, projects: { building: [], waiting: [] }, reveals: [], unread: {} } });
test('r14 8: one list of accounts: one at $0, or rounding to it, is listed as $0 on Financials and the meeting’s tile alike, found by its name, and never overdrawn', () => {
  for (const [accts, name] of [[[['Operating', 312500], ['Reserve', 62500], ['Old Savings', 0]], 'Old Savings'], [[['Operating', 312500], ['Reserve', 62500], ['Savings', 1500], ['Petty Cash', 900], ['PayPal', 700], ['Venmo', -0.3]], 'Venmo']]) {
    const cash = cashOf(accts);
    const lines = money.cashLines(cash);
    const tile = money.moneyTiles({ cash, budget: null, n: {} }).find((t) => t.k === 'bank');
    const listed = money.accountsListed(cash).map((x) => x.name);
    // Financials' card and the meeting's tile list the same accounts, the $0 one by its name
    const onCard = lines.flatMap((l) => l.names);
    assert.deepEqual([...onCard].sort(), [...listed].sort(), `Financials lists every account: ${JSON.stringify(lines.map((l) => [l.name, l.said]))}`);
    for (const n of listed) assert.ok(tile.sub.includes(`${n} $`) || tile.sub.includes(`${n} −$`), `the meeting’s tile lists ${n}: ${tile.sub}`);
    const line = lines.find((l) => l.name === name);
    assert.ok(line, `${name} is its own line on Financials`);
    assert.equal(line.said, 0);
    assert.equal(line.over, false, 'never overdrawn');
    assert.match(tile.sub, new RegExp(`${name} \\$0\\b`));
    // Search finds it by its name, $0, landing on its line
    const found = figures.moneyFigures(dataOf(), { cash, budget: null }).filter((x) => x.title === name);
    assert.equal(found.length, 1, `${name}: one entry`);
    assert.match(found[0].sub, /^\$0, a bank account in Cash in the bank/);
    assert.equal(found[0].focus, line.id);
    assert.ok(find.matches(find.prep(found[0].hay), find.planOf(find.termsOf(name))), `“${name}” finds it`);
    // …and the lines and the tile's figures still add up to the cash as written
    assert.equal(lines.reduce((t, l) => t + l.said, 0), Math.round(cash.total));
  }
  // Only a written figure below zero is overdrawn
  const over = money.cashLines(cashOf([['Operating', 312500], ['Reserve', 62500], ['PayPal', -700]]));
  assert.equal(over.find((l) => l.name === 'PayPal').over, true);
});
