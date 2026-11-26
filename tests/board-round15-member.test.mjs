/**
 * Board QA round 15 (Nov 26 2026), the members' board page: a failed read is named for what it feeds, and marks only that.
 *   1  Makeovers with the reveals (or JobTread's projects the page matches them by) not read: the page says the makeovers
 *      couldn't load in its place, and no card says "Reveal date to come" from a read that failed (kanban.js revealTag
 *      takes the flag; lifecycle.js LifeBoard passes it; families.js and portal.js carry it)
 *   2  Home's For you with the meetings not read: it says the member's to-dos and reports couldn't load, and gives no
 *      count while it can't count them all (unread.js forYou)
 *   3  Today's numbers' list of the meetings (an agenda item's, the screen's year) not read marks its own part
 *      (`meetingDates`), never the page's meetings: Meetings, Documents and Financials draw every meeting and file that
 *      loaded; the meeting's item says so (unread.js LIVE_PARTS, the one list the page, Print and the screen go by)
 *   4  The operating balance's setting not read marks What makeovers cost (`costs`), its only user, never all the money;
 *      "2025 at a glance" not read marks that summary (`glance`), never the Form 990s and the audit
 *   5  Every statement of the page's read failing in turn (Sam, the founder, Taylor): a statement read for today's numbers
 *      marks only today's numbers' parts (unread.js NUMBERS_PARTS), one read for the page's own parts never marks one of
 *      today's numbers', and the decided reads mark exactly their own part
 * The page itself (each failing one read at a time, at 1280 and 390): scripts/test-board-round15-member.mjs.
 * Made-up people only (the repo is public). Run: node --test tests/board-round15-member.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as unread from '../public/admin/board/unread.js';
import * as figures from '../public/admin/board/figures.js';
import * as kanban from '../public/admin/board/kanban.js';
import * as lifecycle from '../public/admin/board/lifecycle.js';
import * as shared from '../public/admin/board-shared.js';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequest, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as portal from '../functions/api/board-portal.js';
import * as board from '../functions/api/_board.js';
import { stateReady, writeState } from '../functions/api/_board-roles.js';
import { ensureAsks } from '../functions/api/_board-asks.js';
import { ensureApplicantSchema } from '../functions/api/_applicants.js';

Error.stackTraceLimit = 80;
const { cleanMeeting, todayEastern } = shared;
const ROOT = new URL('..', import.meta.url).pathname;
const src = (f) => readFileSync(`${ROOT}${f}`, 'utf8');
const day = (n) => new Date(Date.parse(`${todayEastern()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const Y0 = Number(day(0).slice(0, 4));

/** The words a vnode tree says, as a person reads it (function components without hooks drawn; `skip`: ones not drawn) */
function textOf(v, skip = new Set()) {
  if (v == null || v === false || v === true) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => textOf(x, skip)).join(' ').replace(/\s+/g, ' ').trim();
  if (typeof v.type === 'function') return skip.has(v.type.name) ? '' : textOf(v.type(v.props), skip);
  return textOf(v.props?.children, skip);
}
/** Every vnode of a tree, components not drawn (their props as given) */
function nodesOf(v, out = []) {
  if (v == null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v) nodesOf(x, out); return out; }
  out.push(v);
  nodesOf(v.props?.children, out);
  return out;
}

// ─── 1: Makeovers with the reveals not read ─────────────────────────
const REVEALS = [{ slug: `maya-${Y0}`, name: 'Maya', confirmed: true, date: day(9), time: '10:00' }, { slug: `leo-${Y0}`, name: 'Leo', confirmed: false, window: { label: 'mid December' } }];
test('r15 1: a makeover’s card never says “Reveal date to come” from a read that failed: with the makeovers not read it says no reveal at all', () => {
  const maya = { slug: `maya-${Y0}`, name: 'Maya', status: 'Build' };
  const leo = { slug: `leo-${Y0}`, name: 'Leo', status: 'Design' };
  // Read: the day, or the part of the month; none known, "date to come"
  assert.match(textOf(kanban.revealTag(maya, REVEALS)), /^Reveal /);
  assert.match(textOf(kanban.revealTag(leo, REVEALS)), /Reveal mid December/);
  assert.equal(textOf(kanban.revealTag({ ...maya, slug: 'nobody' }, REVEALS)), 'Reveal date to come', 'read, and no reveal on the calendar: date to come');
  // Not read (the reveals, or the projects that match a card to its reveal): nothing said on the card
  for (const b of [maya, leo, { ...maya, slug: null }, { name: 'A family', status: 'Design' }]) {
    const t = kanban.revealTag(b, [], true);
    assert.equal(t, null, `${b.name}: ${textOf(t)}`);
    assert.ok(!/date to come/.test(textOf(kanban.revealTag(b, REVEALS, true))));
  }
  // (a community project is still said as one)
  assert.match(textOf(kanban.revealTag({ kind: 'community', name: 'Example Center' }, [], true)), /Community project/);
});

test('r15 1: the Makeovers board passes the makeovers’ flag to every card, and the page says in its place that they couldn’t load', () => {
  // The board as the page draws it: Maya being built, her reveal set, and Leo in design with his part of the month
  const fam = { families: [{ id: 'acctMaya01', name: 'Maya Example', stage: 'build', jobId: 'j1', season: String(Y0), page: `/kids/maya-${Y0}/` }, { id: 'acctLeo01', name: 'Leo Example', stage: 'design', jobId: 'j2', season: String(Y0), page: `/kids/leo-${Y0}/` }], makeovers: [], jobs: true };
  const projects = { building: [{ jobId: 'j1', name: 'Maya', slug: `maya-${Y0}`, status: 'Build' }, { jobId: 'j2', name: 'Leo', slug: `leo-${Y0}`, status: 'Design' }], waiting: [] };
  const list = lifecycle.itemsOf(fam, projects);
  const cardsOf = (v) => nodesOf(v).filter((x) => typeof x.type === 'function' && x.type.name === 'PhotoCard');
  const read = cardsOf(lifecycle.LifeBoard({ list, reveals: REVEALS }));
  assert.equal(read.length, 2, 'two cards');
  assert.ok(read.every((c) => !c.props.lost));
  const lost = cardsOf(lifecycle.LifeBoard({ list: lifecycle.itemsOf(fam, null), reveals: [], revealsLost: true }));
  assert.equal(lost.length, 2);
  assert.ok(lost.every((c) => c.props.lost === true), 'every card knows the makeovers didn’t load');
  // (what each card then says: no reveal, never "date to come")
  for (const c of lost) { const x = c.props.x.card || {}; assert.equal(kanban.revealTag({ slug: x.slug, kind: x.kind, status: x.status || 'Design' }, c.props.reveals, c.props.lost), null); }
  // The page carries the flag: Makeovers and a family's page take it with the reveals (portal.js), say it in their place
  // (families.js), as Home, the meeting's item, Print and the slides do
  const page = src('public/admin/board/portal.js');
  assert.match(page, /<\$\{FamiliesPage\}[^`]*reveals=\$\{ctx\.data\?\.numbers\?\.reveals \|\| \[\]\} lost=\$\{failed\(ctx\.data, 'projects'\)\}/);
  assert.match(page, /<\$\{FamilyPage\}[^`]*lost=\$\{failed\(ctx\.data, 'projects'\)\}/);
  const fams = src('public/admin/board/families.js');
  assert.match(fams, /export function FamiliesPage\(\{[^}]*lost = false \}\)/);
  assert.match(fams, /\$\{lost \? html`<\$\{CouldntLoad\} part="projects"/);
  assert.match(fams, /<\$\{LifeBoard\}[^`]*reveals=\$\{reveals\} revealsLost=\$\{lost\}/);
  assert.match(src('public/admin/board/lifecycle.js'), /revealTag\(\{[^}]*\}, reveals, lost\)/);
  assert.equal(unread.unreadWords('projects'), 'The makeovers couldn’t load just now. Reload in a moment.');
  assert.ok(unread.ROUTE_PARTS.families.includes('projects') && unread.ROUTE_PARTS.family.includes('projects'));
});

// ─── 2: Home's For you with the meetings not read ───────────────────
test('r15 2: For you with the meetings not read says the to-dos and reports couldn’t load, and gives no count while it can’t count them all', () => {
  const data = (u = {}) => ({ unread: u, numbers: { unread: {} } });
  // Read: the count of what it lists, nothing said
  assert.deepEqual(unread.forYou(data(), { member: true }, 4), { lost: [], count: 4 });
  // The meetings not read (the member's to-dos and the reports they write): said in its place, no count
  const m = unread.forYou(data({ meetings: true, presenting: true }), { member: true }, 2);
  assert.deepEqual(m.lost.map((x) => x.part), ['meetings', 'presenting']);
  assert.equal(m.count, 0, 'never “For you 2” counted from what’s left');
  assert.equal(unread.unreadWords(m.lost[0].part, m.lost[0].of), 'Your to-dos and reports couldn’t load just now. Reload in a moment.');
  // …for a founder too (their own to-dos and the corrections to decide come from the meetings)
  assert.deepEqual(unread.forYou(data({ meetings: true }), { canFix: true }, 0).lost.map((x) => x.part), ['meetings']);
  // Any part of it not read: no count (the papers, as round 13 decided, now uncounted too)
  for (const [u, opts] of [[{ docs: true }, { member: true }], [{ corrections: true }, { canFix: true }], [{ minutesSigned: true }, { seat: 'secretary' }], [{ notesWaiting: true }, { seat: 'secretary' }], [{ review: true }, { seat: 'chair' }]]) {
    const r = unread.forYou(data(u), opts, 3);
    assert.equal(r.count, 0, JSON.stringify(u));
    assert.deepEqual(r.lost.map((x) => x.part), Object.keys(u));
  }
  // (a part that isn't theirs doesn't stop the count: the secretary's minutes for a member)
  assert.deepEqual(unread.forYou(data({ minutesSigned: true, review: true }), { member: true }, 3), { lost: [], count: 3 });
  // Home draws it so: each part in its place with its place's words, the count from it (portal.js HomePage)
  const page = src('public/admin/board/portal.js');
  assert.match(page, /const \{ lost: lostTodo, count: todoCount \} = forYou\(data, /);
  assert.match(page, /For you\$\{todoCount \? html`<span class="bp-count">\$\{todoCount\}<\/span>` : null\}/);
  assert.match(page, /lostTodo\.map\(\(x\) => html`<\$\{CouldntLoad\} part=\$\{x\.part\} of=\$\{x\.of\}/);
});

// ─── The world: a board, its meetings, papers, money and makeovers (made up), behind the real sign-in ─
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
let raw;
let env;
// The database not answering one statement: `fault.test(sql, args, stack)` picks the statements (each failing), or
// `fault.k` the k-th of a read (round 13's sweep); each failed one kept with who read it (its stack)
let fault = null;
const SETUP = /^\s*(CREATE|ALTER|PRAGMA)\b/i;
function check(sql, args) {
  if (!fault || SETUP.test(String(sql || ''))) return;
  const stack = new Error().stack;
  if (fault.test && !fault.test(String(sql || ''), args, stack)) return;
  if (!fault.test) { const i = fault.seen++; if (i !== fault.k) return; }
  fault.failed.push({ sql: String(sql), args, stack });
  throw new Error('D1_ERROR: Network connection lost.');
}
const wrap = (st, args = []) => new Proxy(st, { get: (s, m) => (['all', 'first', 'run', 'raw'].includes(m) ? async (...a) => { check(s._sql, args); return s[m](...a); }
  : m === 'bind' ? (...a) => wrap(s.bind(...a), a) : typeof s[m] === 'function' ? s[m].bind(s) : s[m]) });
const hookedDB = () => new Proxy({}, {
  get: (_, k) => (k === 'prepare' ? (sql) => wrap(raw.prepare(sql))
    : k === 'batch' ? async (stmts) => { for (const s of stmts) check(s._sql, s._params || []); return raw.batch(stmts); }
      : typeof raw[k] === 'function' ? raw[k].bind(raw) : raw[k]),
});
const realFetch = globalThis.fetch;
function fakeFetch() {
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    if (url === `${ISS}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    return new Response('{}', { status: 503 });
  };
}
const ORG = { name: 'Example Charity', legalName: 'Example Charity Incorporated', ein: '12-3456789', phone: '404-555-0100', email: 'hello@example.org', address: { street: '1 Example Way', city: 'Roswell', state: 'GA', zip: '30075' } };
const SNAPSHOT = { year: Y0 - 1, totalRevenue: 1000000, totalExpenses: 900000, programExpenses: 750000, managementExpenses: 90000, fundraisingExpenses: 60000, netAssets: 400000, contributions: 600000, storeRevenue: 300000, programPct: 83, managementPct: 9, fundraisingPct: 8 };
const FILINGS = { documents: [{ title: `${Y0 - 1} 990 Tax Return`, year: Y0 - 1, type: '990', url: 'https://files.sunshineonaranneyday.com/financials/example-990.pdf' }, { title: `${Y0 - 2} 990 Tax Return`, year: Y0 - 2, type: '990', url: 'https://files.sunshineonaranneyday.com/financials/example-990-b.pdf' }, { title: `${Y0 - 2} Audit`, year: Y0 - 2, type: 'audit', url: 'https://files.sunshineonaranneyday.com/financials/example-audit.pdf' }] };
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
  await raw.prepare('INSERT INTO events (slug, data) VALUES (?, ?)').bind('spring-gala', JSON.stringify({ title: 'The Spring Gala', date: day(40), location: 'Example Hall' })).run();
  for (const [key, data] of [['settings', ORG], ['media', { mission: 'Dream rooms for kids.', bio: { founded: '2008', boilerplate: 'An example charity.' } }], ['financials', FILINGS], ['financial-snapshot', SNAPSHOT],
    ['reveals', { reveals: [], upcoming: REVEALS.map((r) => ({ ...r, kidUrl: `/kids/${r.slug}/` })), updatedAt: new Date().toISOString() }]]) await raw.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind(key, JSON.stringify(data)).run();
  await board.ensureSchema(env.DB);
  await ensureApplicantSchema(env.DB);
  await stateReady(env.DB);
  await ensureAsks(env.DB);
  // The board's settings: a quorum, the founder runs Board, and SOARD keeps $150,000 to run on (What makeovers cost)
  await writeState(env.DB, 'settings', { quorum: 3, admins: [FOUNDER], invitesFrom: FOUNDER, asks: 'on', operatingBalance: 150000 });
  // What makeovers cost, as the heartbeat keeps it from JobTread (made up)
  const at = new Date().toISOString();
  const done = (key, name, season, cost) => ({ key, name, slug: null, kind: 'kid', season, rooms: ['Bedroom'], roomCount: 1, type: 'bedroom', cost, jobs: 1, closed: `${season}-10-01` });
  await writeState(env.DB, 'costs', { at, value: { at, makeovers: [done('k:ava', 'Ava', Y0, 21500), done('k:ben', 'Ben', Y0 - 1, 26400)], noBills: [], reveals: [], skipped: 0,
    underway: [{ revealOn: null, season: Y0, key: 'u:eve', name: 'Eve', jobId: null, kind: 'kid', status: 'Build', rooms: ['Bedroom'], type: 'bedroom', paid: 8200, budget: 23000 }], waiting: [] } });
  await writeState(env.DB, 'projects', { at, value: { byStatus: { Build: 1, Design: 1 }, building: [{ jobId: 'j1', name: 'Maya', slug: `maya-${Y0}`, status: 'Build' }, { jobId: 'j2', name: 'Leo', slug: `leo-${Y0}`, status: 'Design' }], waiting: [], open: { j1: 'Build', j2: 'Design' } } });
  const board5 = EMAILS.map(([slug]) => ({ slug, name: PEOPLE.find((x) => x[0] === slug)[1].name, kind: 'board' }));
  // The next meeting, shared: the money (Sam presents it), what makeovers cost, the meetings ahead; a to-do for Sam
  const next = await board.saveMeeting(env.DB, cleanMeeting({ date: day(9), start: '08:00', end: '10:00', shared: true, attendance: board5,
    sections: [{ id: 's_fin', title: 'Finance', items: [{ id: 'i_fin', title: 'Year to date', live: 'cash', who: ['sam-ortiz'] }, { id: 'i_cost', title: 'What makeovers cost', live: 'costs' }] },
      { id: 's_cal', title: 'Calendar', items: [{ id: 'i_meet', title: 'Board meetings ahead', live: 'meetings' }] }],
    actions: [{ id: 'a_sam', text: 'Send the audit letter', owner: 'sam-ortiz', ownerName: 'Sam Ortiz' }] }), { by: 'test' });
  // One after it, shared (the item's list of the meetings ahead), and one held, with its packet's statements
  await board.saveMeeting(env.DB, cleanMeeting({ date: day(100), start: '08:00', end: '10:00', shared: true, attendance: board5, sections: [{ title: 'Agenda', items: [{ title: 'Roll call' }] }] }), { by: 'test' });
  const held = await board.saveMeeting(env.DB, cleanMeeting({ date: day(-60), start: '08:00', end: '10:00', shared: true, minutesFrom: { name: 'Minutes.docx', at }, attendance: board5, sections: [{ title: 'Reports', items: [{ title: 'Treasurer' }] }] }), { by: 'test' });
  for (const [id, name, kind] of [['f_stmt1', 'Statement of Activities.pdf', 'financials'], ['f_stmt2', 'Statement of Financial Position.pdf', 'financials'], ['f_minutes', 'Minutes.pdf', 'minutes']]) {
    await raw.prepare("INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, at, by) VALUES (?, 'meeting', ?, ?, ?, 'application/pdf', 1200, ?, ?, ?)").bind(id, held.id, `k/${id}`, name, kind, at, FOUNDER).run();
  }
  // SOARD's papers: one to read and sign
  await raw.prepare('INSERT INTO board_docs (id, data, updated_at) VALUES (?, ?, ?)').bind('d_coi', JSON.stringify({ id: 'd_coi', title: 'Conflict of Interest Policy', kind: 'policy', shared: true, sign: true, body: '# Conflict of interest\n\nEach member tells the board of any conflict.', version: 1, signFrom: 1 }), at).run();
  // The month-end balances (no QuickBooks)
  for (const [month, total] of [[day(-60).slice(0, 7), 350000], [day(-30).slice(0, 7), 362000], [day(0).slice(0, 7), 375000]]) await raw.prepare('INSERT INTO board_cash (month, total, at) VALUES (?, ?, ?)').bind(month, total, at).run();
  _resetKeyCacheForTests();
  // (one read first, as a running site has had: the tables each part makes on its first read are there, as they are live)
  const was = globalThis.fetch;
  fakeFetch();
  try { await route('/api/board-portal', SAM); } finally { globalThis.fetch = was; }
  return { next, held, bytes: raw._db.export() };
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
/** Who read a statement: today's numbers (liveNumbers), or the page's own read */
const inLive = (stack) => /\bliveNumbers\b/.test(stack);
/** The page's read as `who` with the statements `when` picks failing (each, every time), and which failed */
async function pageWith(who, when, bytes) {
  raw = await createD1({ bytes });
  _resetKeyCacheForTests();
  fault = { test: when, failed: [] };
  try {
    const r = await route('/api/board-portal', who);
    return { ...r, failed: fault.failed };
  } finally { fault = null; }
}

// ─── 3: today's numbers' list of the meetings not read ──────────────
test('r15 3: today’s numbers’ list of the meetings not read marks its own part, never the page’s meetings: every meeting and file that loaded is there, and the routes that draw them say nothing’s missing', async () => {
  fakeFetch();
  try {
    const w = await world();
    const control = await pageWith(SAM, () => false, w.bytes);
    assert.equal(control.status, 200);
    assert.deepEqual(control.body.unread, {}, 'a clean read marks nothing');
    assert.ok(control.body.numbers.meetings.length >= 2, 'the meetings ahead, for the item’s list');
    // Only the numbers' own read of the meetings (the tester's nth=1), every statement of it
    const r = await pageWith(SAM, (sql, a, stack) => /FROM board_meetings ORDER BY date DESC|FROM board_files WHERE owner_type|FROM board_action_state/.test(sql) && inLive(stack), w.bytes);
    assert.ok(r.failed.length >= 1, 'the numbers’ read of the meetings was made, and failed');
    assert.ok(r.failed.every((f) => inLive(f.stack)));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.unread, { meetingDates: true }, `its own part only: ${JSON.stringify(r.body.unread)}`);
    assert.deepEqual(r.body.numbers.unread, { meetingDates: true });
    // The page's meetings, read apart, are whole, files and all
    assert.deepEqual(r.body.meetings.map((m) => [m.id, m.files.length]), control.body.meetings.map((m) => [m.id, m.files.length]));
    assert.equal(r.body.next, control.body.next);
    assert.deepEqual(r.body.actions, control.body.actions);
    // As the page reads it: the meetings loaded; Meetings, Documents and Financials draw from nothing that failed; the
    // meeting's page has its item's list to say so
    const data = r.body;
    assert.equal(unread.failed(data, 'meetings'), false, 'never “the meetings couldn’t load” under a full list');
    for (const route of ['home', 'meetings', 'documents', 'financials', 'report', 'review']) assert.deepEqual(unread.lostOn(data, route), [], route);
    assert.deepEqual(unread.lostOn(data, 'meeting'), ['meetingDates']);
    const n = data.numbers;
    assert.equal(unread.liveLost('meetings', n), 'meetingDates', 'the board meetings item says so');
    for (const kind of ['cash', 'costs', 'projects', 'reveals', 'events']) assert.equal(unread.liveLost(kind, n), '', `${kind} loaded`);
    assert.equal(unread.unreadWords('meetingDates'), 'The board meetings on the calendar couldn’t load just now. Reload in a moment.');
    // (and a packet is never locked with no meetings: the same flag, by its own name)
    raw = await createD1({ bytes: w.bytes });
    fault = { test: (sql, a, stack) => /FROM board_meetings ORDER BY date DESC/.test(sql) && inLive(stack), failed: [] };
    const err = await board.takeSnapshot(env, w.next.id, { by: FOUNDER }).then(() => null, (e) => e);
    fault = null;
    assert.equal(err?.status, 503, String(err?.message));
    assert.match(err.message, /couldn’t read the board’s meetings just now, so nothing was changed/);
  } finally { globalThis.fetch = realFetch; fault = null; }
});

test('r15 3: the meeting’s page, Print it all and the screen go by one list of the parts each live item draws from', () => {
  assert.deepEqual(unread.LIVE_PARTS, { cash: ['money'], costs: ['money', 'costs'], projects: ['projects'], reveals: ['projects'], events: ['events'], meetings: ['meetingDates'] });
  for (const [f, re] of [['public/admin/board/portal.js', /const part = liveLost\(kind, n\);/], ['public/admin/board/print.js', /const part = liveLost\(kind, n\);/], ['public/admin/board/screen.js', /const part = liveLost\(kind, n\);/]]) {
    const s = src(f);
    assert.match(s, re, f);
    assert.ok(!/\{ cash: 'money', costs: 'money'/.test(s), `${f}: no list of its own`);
  }
  // Meetings, Documents and Financials draw what loaded and say what didn't beside it, the same way
  const page = src('public/admin/board/portal.js');
  assert.ok(!/if \(failed\(data, 'meetings'\)\) return html`<section class="bp-card bp-library"/.test(page), 'Documents never hides the files it has behind the words');
  assert.match(page, /if \(lost && !meetings\.length\) return html`<section class="bp-card bp-library"/);
  assert.match(page, /\$\{lost \? html`<\$\{CouldntLoad\} part="meetings" of="files" \/>` : null\}/);
});

// ─── 4: the operating balance, and the year at a glance ─────────────
test('r15 4: the operating balance’s setting not read marks What makeovers cost, its only user: the cash, the books and the money’s tiles are all there', async () => {
  fakeFetch();
  try {
    const w = await world();
    const control = await pageWith(SAM, () => false, w.bytes);
    assert.equal(control.body.numbers.operating.balance, 150000);
    assert.ok(control.body.numbers.costs?.makeovers?.length, 'what makeovers cost, read');
    // Only the numbers' read of the board's settings (the tester's nth=1: the page's own read of them is apart)
    const r = await pageWith(SAM, (sql, a, stack) => /FROM board_state WHERE key/.test(sql) && a[0] === 'settings' && inLive(stack), w.bytes);
    assert.equal(r.failed.length, 1, 'one read failed');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.unread, { costs: true }, `What makeovers cost only: ${JSON.stringify(r.body.unread)}`);
    const data = r.body;
    assert.equal(unread.failed(data, 'money'), false, 'never all the money');
    assert.equal(data.quorum, 3, 'the page’s own read of the settings stands');
    // The money's tiles as Home and Financials draw them: the cash and the year, never one "The money couldn’t load" tile
    const view = { ...data, cashHistory: control.body.cashHistory };
    const tiles = figures.figureTiles({ data: view, cash: { live: true, total: 375000, asOf: 'Nov 26', today: true, at: new Date().toISOString(), prior: null, accounts: [], owed: [], banks: [], stale: [] }, budget: null });
    assert.ok(!tiles.some((t) => t.unread === 'money'), JSON.stringify(tiles.map((t) => t.key)));
    // What makeovers cost says so in its place (its card, the meeting's item, Print, the slide), and search finds none of it
    assert.equal(unread.liveLost('costs', data.numbers), 'costs');
    assert.equal(unread.liveLost('cash', data.numbers), '', 'the meeting’s money item draws');
    assert.equal(unread.unreadWords('costs'), 'What makeovers cost couldn’t load just now. Reload in a moment.');
    const found = figures.moneyFigures(view, { cash: { total: 375000, accounts: [], owed: [] }, budget: null }).map((x) => x.key);
    assert.ok(!found.some((k) => k.startsWith('costs:')), `nothing worked out on a balance guessed: ${found.filter((k) => k.startsWith('costs:'))}`);
    assert.ok(figures.moneyFigures({ ...control.body, cashHistory: control.body.cashHistory }, { cash: { total: 375000, accounts: [], owed: [] }, budget: null }).some((x) => x.key.startsWith('costs:')), 'read, its figures are found');
    assert.deepEqual(unread.lostOn(data, 'financials'), ['costs']);
    assert.deepEqual(unread.lostOn(data, 'home'), []);
    // JobTread's figures for it not read: the same part, never all the money
    const c = await pageWith(SAM, (sql, a) => /FROM board_state WHERE key/.test(sql) && a[0] === 'costs', w.bytes);
    assert.ok(c.failed.length >= 1);
    assert.deepEqual(c.body.unread, { costs: true }, JSON.stringify(c.body.unread));
    // The card goes by it whichever numbers it's drawn from (costs.js useCosts: today's for a meeting today or ahead)
    const costs = src('public/admin/board/costs.js');
    assert.match(costs, /const lost = liveLost\('costs', src\);/);
    assert.match(costs, /if \(lost\) \{\s*return variant === 'home' \? html`<section class="bp-card bc"[^`]*<\$\{CouldntLoad\} part=\$\{lost\} \/>/);
    assert.match(src('public/admin/board/print.js'), /books: live\.books \?\? numbers\?\.books, unread: live\.unread \}/);
  } finally { globalThis.fetch = realFetch; fault = null; }
});

test('r15 4: the year at a glance not read marks that summary, never the Form 990s and the audit, which are read apart', async () => {
  fakeFetch();
  try {
    const w = await world();
    const control = await pageWith(SAM, () => false, w.bytes);
    assert.equal(control.body.filings.length, 3);
    assert.equal(control.body.snapshot?.year, Y0 - 1);
    const r = await pageWith(SAM, (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'financial-snapshot', w.bytes);
    assert.equal(r.failed.length, 1);
    assert.deepEqual(r.body.unread, { glance: true }, JSON.stringify(r.body.unread));
    assert.equal(r.body.snapshot, null);
    assert.deepEqual(r.body.filings, control.body.filings, 'every tax return and audit, as read');
    assert.equal(unread.failed(r.body, 'sources'), false);
    assert.deepEqual(unread.lostOn(r.body, 'financials'), ['glance']);
    assert.match(unread.unreadWords('glance'), /^The year at a glance, from the latest tax return, couldn’t load just now\./);
    // …and the tax returns not read leave the year at a glance, read apart, standing
    const s = await pageWith(SAM, (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'financials', w.bytes);
    assert.deepEqual(s.body.unread, { sources: true });
    assert.deepEqual(s.body.snapshot, control.body.snapshot);
    // Financials draws each in its own place (portal.js FinancialsPage)
    const page = src('public/admin/board/portal.js');
    assert.match(page, /const s = lost\.glance \? null : data\.snapshot;/);
    assert.match(page, /: lost\.glance \? html`<section class="bp-card" aria-labelledby="yr-h" key="yr" id="glance"><h2 class="bp-h2" id="yr-h">At a glance<\/h2><\$\{CouldntLoad\} part="glance" \/>/);
    assert.match(page, /const years = lost\.sources \? \[\] :/);
  } finally { globalThis.fetch = realFetch; fault = null; }
});

// ─── 5: every statement failing in turn ─────────────────────────────
/** The decided reads, each marking exactly its own part: [what it is, (sql, args, stack) → true, the part] */
const DECIDED = [
  ['today’s numbers’ list of the meetings', (sql, a, st) => /FROM board_meetings ORDER BY date DESC|FROM board_files WHERE owner_type|FROM board_action_state/.test(sql) && inLive(st), 'meetingDates'],
  ['the operating balance', (sql, a, st) => /FROM board_state WHERE key/.test(sql) && a[0] === 'settings' && inLive(st), 'costs'],
  ['what makeovers cost', (sql, a) => /FROM board_state WHERE key/.test(sql) && a[0] === 'costs', 'costs'],
  ['the year at a glance', (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'financial-snapshot', 'glance'],
  ['the tax returns and audits', (sql, a, st) => /FROM site_config WHERE key/.test(sql) && a[0] === 'financials' && !/portalWords/.test(st), 'sources'],
  ['the reveals', (sql, a) => /FROM site_config WHERE key/.test(sql) && a[0] === 'reveals', 'projects'],
];
async function sweep(who, least) {
  const w = await world();
  const bytes = w.bytes;
  const control = await pageWith(who, () => false, bytes);
  assert.equal(control.status, 200);
  assert.deepEqual(control.body.unread, {}, 'a clean read marks nothing');
  const NP = new Set(unread.NUMBERS_PARTS);
  const problems = [];
  const seen = new Map();
  let runs = 0;
  for (let k = 0; k < 400; k++) {
    raw = await createD1({ bytes });
    _resetKeyCacheForTests();
    fault = { k, seen: 0, failed: [] };
    let r;
    try { r = await route('/api/board-portal', who); } catch (err) { r = { status: 'threw', body: { error: String(err?.message || err) } }; }
    const f = fault.failed[0];
    fault = null;
    if (!f) break;
    runs += 1;
    if (r.status !== 200) continue; // (who's signed in, People: the page's own 503 in words, round 13's sweep keeps them so)
    const parts = Object.keys(r.body.unread || {});
    const live = inLive(f.stack);
    const name = `k=${k} [${f.sql.replace(/\s+/g, ' ').slice(0, 70)} ${JSON.stringify(f.args).slice(0, 30)}${live ? ' in today’s numbers' : ''}] → ${JSON.stringify(parts)}`;
    // Today's numbers' reads mark only today's numbers' parts; the page's own reads never one of today's numbers' (the
    // month-end balances are both: the page reads them for the cash a year back, and a meeting's money goes by them)
    if (live && parts.some((p) => !NP.has(p))) problems.push(`${name}: a part of the page’s own from today’s numbers`);
    if (!live && parts.some((p) => NP.has(p) && p !== 'history')) problems.push(`${name}: one of today’s numbers’ parts from the page’s own read`);
    for (const [what, when, part] of DECIDED) {
      if (!when(f.sql, f.args, f.stack)) continue;
      seen.set(what, (seen.get(what) || 0) + 1);
      if (JSON.stringify(parts) !== JSON.stringify([part])) problems.push(`${name}: ${what} marks ${part} alone`);
    }
  }
  console.log(`# ${who}: swept ${runs} statements, ${problems.length} wrong; decided reads seen: ${[...seen].map(([w, n]) => `${w} ${n}`).join(', ')}`);
  assert.deepEqual(problems, [], problems.join('\n'));
  assert.ok(runs >= least, `swept ${runs}`);
  for (const [what] of DECIDED) assert.ok(seen.get(what), `${who}: ${what} was read and failed in the sweep`);
}
test('r15 5: every statement of the page’s read failing once in turn, Sam: each marks only the part it was read for', async () => {
  fakeFetch();
  try { await sweep(SAM, 40); } finally { globalThis.fetch = realFetch; fault = null; }
});
test('r15 5: …the founder’s', async () => {
  fakeFetch();
  try { await sweep(FOUNDER, 40); } finally { globalThis.fetch = realFetch; fault = null; }
});
test('r15 5: …and Taylor’s, the secretary', async () => {
  fakeFetch();
  try { await sweep(TAYLOR, 40); } finally { globalThis.fetch = realFetch; fault = null; }
});

test('r15: today’s numbers’ parts and the page’s own are named apart, each has its words, and every route declares what it draws', () => {
  const own = ['meetings', 'docs', 'sources', 'glance', 'settings', 'gifts', 'givers', 'ownFiles', 'mark', 'copies', 'paperWords', 'signedBodies', 'practice', 'lineNotes', 'myAsks', 'presenting', 'review', 'corrections', 'minutesSigned', 'notesWaiting', 'facts'];
  for (const p of own) assert.ok(!unread.NUMBERS_PARTS.includes(p), p);
  for (const p of [...unread.NUMBERS_PARTS, ...own]) assert.ok(unread.UNREAD_WORDS[p], `${p} has its words`);
  for (const parts of Object.values(unread.LIVE_PARTS)) for (const p of parts) assert.ok(unread.NUMBERS_PARTS.includes(p));
  assert.ok(unread.ROUTE_PARTS.meeting.includes('meetingDates') && unread.ROUTE_PARTS.meeting.includes('costs'));
  assert.ok(unread.ROUTE_PARTS.financials.includes('costs') && unread.ROUTE_PARTS.financials.includes('glance'));
  for (const w of [...Object.values(unread.UNREAD_WORDS), ...Object.values(unread.UNREAD_PLACE)]) {
    assert.ok(!/[–—]/.test(w), `no em or en dash: ${w}`);
    assert.ok(!/advisor/i.test(w), w);
  }
});

// ─── 6: the secretary signs only minutes the board can read ─────────
// (from the round 15 admin fixer: approved minutes whose only file is Staff only are not in for the board, by
// board-shared.js minutesIn, which board-r15-admin.patch makes so for approved minutes; the board page never asks the
// secretary to sign them, by that same rule, never one of its own)
const STAFF_FILE = { id: 'f_staff0001', kind: 'minutes', staffOnly: true, name: 'Minutes.pdf', type: 'application/pdf', at: `${day(-5)}T12:00:00Z` };
const approvedWith = (over = {}) => cleanMeeting({ id: 'm_appr0001', date: day(-30), start: '08:00', end: '10:00', shared: true, minutes: 'approved', approvedOn: day(-5) >= shared.MINUTES_SIGN_FROM ? day(-5) : shared.MINUTES_SIGN_FROM,
  approvedFile: STAFF_FILE.id, files: [STAFF_FILE], sections: [{ title: 'Agenda', items: [{ title: 'Roll call' }] }], ...over });
test('r15 6: minutesToSign goes by minutesIn, the one rule for whether the board can read minutes, never a rule of its own', () => {
  const s = src('public/admin/board-shared.js');
  /* r15: the rule moved into minutesCantSign, the one function the page's asking (minutesToSign) and the site's signing
     (signMinutes) both call, so they can't drift (Board QA round 15 extra: the site signed what the page never offered) */
  const at = s.indexOf('export function minutesCantSign');
  assert.ok(at > 0);
  assert.match(s.slice(at, s.indexOf('\n}\n', at)), /if \(minutesHeld\(m\) && !minutesIn\(m\)\) return 'staff';/, 'held in Board but not in for the board: not asked');
  const ask = s.indexOf('export const minutesToSign');
  assert.match(s.slice(ask, s.indexOf('\n\n', ask)), /=> !minutesCantSign\(m\)/, 'the asking goes by it');
  // Still asked, as before: shared minutes, minutes read in or typed (the board reads their words whatever their file),
  // and approved minutes with none in Board yet
  for (const m of [approvedWith({ files: [{ ...STAFF_FILE, staffOnly: false }] }), approvedWith({ minutesFrom: { typed: true, name: 'Minutes typed on the board page', at: new Date().toISOString() } }), approvedWith({ approvedFile: '', files: [] })]) {
    assert.equal(shared.minutesToSign(m), true, JSON.stringify({ files: m.files.length, from: !!m.minutesFrom }));
    assert.equal(shared.minutesToSign(shared.forBoard(m)), true, 'the board’s copy alike');
  }
});
// (runs once approved minutes kept Staff only are not in, board-r15-admin.patch's minutesIn: checked in the merge)
const adminRule = !shared.minutesIn(approvedWith()) && !shared.minutesIn(shared.forBoard(approvedWith()));
test('r15 6: approved minutes whose only file is Staff only are never offered to the secretary to sign, on the founders’ copy or the board’s', { skip: adminRule ? false : 'needs round 15 admin’s minutesIn for approved minutes (board-r15-admin.patch): checked in the merge' }, () => {
  const m = approvedWith();
  assert.equal(shared.minutesToSign(m), false, 'the founders’ copy: their file is staff only');
  assert.equal(shared.minutesToSign(shared.forBoard(m)), false, 'the board’s copy (the page’s): none of theirs to read');
  // Shared, they're asked; signed and changed after, asked again only while the board can read them
  assert.equal(shared.minutesToSign(approvedWith({ files: [{ ...STAFF_FILE, staffOnly: false }] })), true);
  assert.equal(shared.minutesToSign(m, { name: 'Taylor Nguyen', changed: true }), false);
});
