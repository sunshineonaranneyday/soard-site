/**
 * test-board-member-qa.mjs — the board page as a member found it, in a real browser (QA round 1, Nov 19 2026)
 * ==========================================================================================================
 * The real handlers behind the real sign-in middleware on an in-memory D1 and R2, seeded as the QA tester's copy was
 * (made-up people, meetings and money; Google, Mercury, JobTread, QuickBooks and Zeffy faked). Each check is one of
 * the tester's findings, and fails on the code they found it on:
 *   1. The year so far on a phone (320, 375, 390): the three figures inside their boxes, no sideways scroll
 *   2. Print it all on a held meeting: its record (where its minutes are, who was there, the decisions, the action
 *      items) and the minutes themselves (Minutes.docx), not only the planned agenda and the files
 *   3. The year so far adds up and agrees with the tiles: in kind left out of both sides, said once
 *   4. Documents at 320: a long file name wraps inside its card
 *   5. "Underway" means the same on Home, the makeovers board and What makeovers cost, and every sub-line adds up
 *   6. During the meeting its page stops asking "Will you be there?" (as Home does), and asks again before it starts
 *   7. A held meeting with nothing written isn't "Draft minutes": Home, the Meetings list, its page
 *   8. "A family’s makeover comes next." (no comma left from a missing price)
 *   9. No en or em dash in the page's words or what a screen reader hears, on every page
 *  10. "Minutes 2025-09-25.pdf" reads "Minutes 2025-09-25" in Documents and on its meeting
 *  11. "Mobilization" whole on the makeovers board at 768 and on paper
 *  12. No empty, unnamed season button in What makeovers cost before a completed makeover has its bills
 *  13. The biggest donor's whole name at 1024 and 1440, never cut with an ellipsis
 *  14. The budget by its year, never QuickBooks' file name
 * QA round 2 (Nov 19 2026), each failing on the copy round 1 left:
 *  R2.1 The makeovers card on a phone counts what its line counts ("3 makeovers being built", never "4 Building"), and
 *       every count on it agrees and adds up at every width
 *  R2.2 A held meeting whose agenda has background but no minutes is "No minutes yet": its page, the Meetings list, the
 *       year it's folded in, Home; background is never offered a correction as if it were the minutes
 *  R2.3 A meeting not shared yet: who presents in it is asked for their report on Home, and its report's Done and name
 *       lead to the meeting (their items only, numbered as the whole agenda), never "That meeting isn't on the board page"
 *  R2.4 Once today's meeting is over: no Join, no Google Meet in its facts, no Add it to my calendar, no directions,
 *       no report asked for
 *  R2.5 What makeovers cost never says an amount that isn't known as $0, nor adds it into a sum
 *  R2.6 Where the revenue came from is of the same revenue as the figure above it ($1.66M, in kind left out)
 *  R2.7 "5 of 6 board members" over five faces: staff there said apart, on the page and on paper
 *  R2.8 Financials' statements said for what they are: QuickBooks' latest, the packet's in the fold
 *  R2.9 On paper a long item title wraps beside its number, and who presents it never starts a line with "·"
 * QA round 3 (Nov 20 2026), each failing on the copy round 2 left:
 *  R3.1 What's new stays new while a member reads one page past the visit's gap: the page's tracker reports keep the
 *       visit going (the server's clock moved on while the page stays open), and a gap longer than it starts the next
 *  R3.2 Where the revenue came from says, in words a reader sees, what it leaves out: a meeting's money item, Home and
 *       on paper (Print it all), as Financials says it
 *  R3.3 After the chair presses End: no thanks to a member who never checked in, who checked in (never the live count
 *       or how many more for a quorum), and the decisions in the past tense; one who checked in is thanked
 *  R3.4 A link to a co-presenter's item in a meeting not shared yet never says the item and its report were deleted
 *  R3.5 Changed while you were writing, by the same member in another tab: "You changed this report", never their own
 *       name as someone else's; the motion's box never says "someone else" (who changed it isn't kept)
 *  R3.6 Search finds a presenter's own items in a meeting not shared yet, and nothing else of it, nor for anyone else
 *  R3.7 "awaiting funding" and "awaiting" find the makeover awaiting funding (not named yet) and What makeovers cost
 *  R3.8 What makeovers cost on a phone: each underway row's From labeled, "Not known yet" said once
 *  R3.9 Once a meeting is over (by the chair, by the clock, or weeks ago) its address is said, never a map link
 *  R3.10 The chair approves and Resend refuses the agenda's email (the server's answer stubbed: agenda 'failed',
 *       agendaError): the server's words, not "get word by email"; the usual answers still say theirs
 * And a sweep of every page at 320, 375, 390, 768, 1024 and 1440: no sideways scroll, nothing past its card.
 * Screenshots land in test-results/board-member-qa/. Exits non-zero on any failure.
 *
 *   node scripts/test-board-member-qa.mjs
 */
import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createD1 } from '../tests/lib/d1-shim.mjs';
import { onRequest as middleware, _resetKeyCacheForTests } from '../functions/api/_middleware.js';
import * as boardAdmin from '../functions/api/board-admin.js';
import * as bankAdmin from '../functions/api/bank-admin.js';
import * as booksAdmin from '../functions/api/books-admin.js';
import * as boardPortal from '../functions/api/board-portal.js';
import * as boardFile from '../functions/api/board-file.js';
import { provideBoardFinance, saveMeeting, patchMeeting, putFile } from '../functions/api/_board.js';
import { maybeReadGifts } from '../functions/api/_board-gifts.js';
import { FIELD_JOB_STATUS } from '../functions/api/_reveals.js';
import { cleanMeeting } from '../public/admin/board-shared.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'test-results/board-member-qa/');
mkdirSync(OUT, { recursive: true });
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const YEAR = Number(day(0).slice(0, 4));

const FOUNDER = 'jane@soardcharity.com';
const ALEX = 'alex.board@example.com';
const PEOPLE = {
  'jane-doe': { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President', order: 1 },
  'alex-rivera': { name: 'Alex Rivera', group: 'board', title: 'Board Chair', organization: 'Rivera Builders', committees: ['Governance'], order: 1 },
  'sam-ortiz': { name: 'Sam Ortiz', group: 'board', title: 'Board Treasurer', organization: 'Ortiz & Co', committees: ['Finance'], order: 2 },
  'taylor-nguyen': { name: 'Taylor Nguyen', group: 'board', title: 'Board Secretary', organization: 'Nguyen Law', order: 3 },
  'maria-de-la-cruz-whitfield': { name: 'Maria-Fernanda de la Cruz Whitfield', group: 'board', title: 'Board Member', organization: 'The Whitfield, Ashbury and Montgomery Family Charitable Foundation of Greater Atlanta', committees: ['Finance', 'Events', 'Governance'], order: 4 },
  'kim-park': { name: 'Kim Park', group: 'board', title: 'Board Member', organization: 'Park Media', order: 5 },
  'chris-okafor': { name: 'Chris Okafor', group: 'board', title: 'Board Member', organization: 'Okafor Health', order: 6 },
};
const EMAILS = [['alex-rivera', ALEX], ['sam-ortiz', 'sam.board@example.org'], ['maria-de-la-cruz-whitfield', 'maria.board@example.com'], ['taylor-nguyen', 'taylor.board@example.net']];
const KIDS = { 'maya-2026': { name: 'Maya', year: 2026, childCount: 1, roomCount: 1 }, 'leo-2026': { name: 'Leo', year: 2026, childCount: 2, roomCount: 2 }, 'zoe-2025': { name: 'Zoe', year: 2025 } };

// ── Sign-in: an RS256 Access token made here, for whoever the request says it is ──
const certsKey = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', certsKey.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
async function tokenFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: 'https://soard.cloudflareaccess.com', aud: ['aud-tag'], email, iat: now, nbf: now, exp: now + 3600 }));
  return `${h}.${p}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', certsKey.privateKey, new TextEncoder().encode(`${h}.${p}`))))}`;
}
class FakeR2 {
  constructor() { this.map = new Map(); }
  async put(key, bytes, opts) { const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes?.arrayBuffer ? new Uint8Array(await bytes.arrayBuffer()) : new Uint8Array(bytes); this.map.set(key, { bytes: b, type: opts?.httpMetadata?.contentType }); }
  async get(key) { const o = this.map.get(key); return o ? { body: o.bytes, size: o.bytes.length, httpMetadata: { contentType: o.type }, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength) } : null; }
  async head(key) { const o = this.map.get(key); return o ? { size: o.bytes.length, httpMetadata: { contentType: o.type } } : null; }
  async delete(key) { this.map.delete(key); }
}

const DB = await createD1();
for (const sql of [
  'CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)',
  'CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)',
  'CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT)',
  'CREATE TABLE community (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE events (slug TEXT PRIMARY KEY, data TEXT)',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)',
]) await DB.exec(sql);
for (const [slug, d] of Object.entries(PEOPLE)) await DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
for (const [slug, email] of EMAILS) await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
for (const [slug, d] of Object.entries(KIDS)) await DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.year, JSON.stringify(d)).run();
await DB.prepare('INSERT INTO events (slug, data) VALUES (?, ?)').bind('golf', JSON.stringify({ title: 'Sunshine Golf Classic', date: day(20), time: '8:00 AM', location: 'Example Country Club' })).run();
const site = {
  reveals: { reveals: [], upcoming: [{ slug: 'maya-2026', name: 'Maya', confirmed: true, date: day(9), time: '10:00', kidUrl: '/kids/maya-2026/' }, { slug: 'leo-2026', name: 'Leo', confirmed: false, window: { label: 'mid December', through: day(60) }, kidUrl: '/kids/leo-2026/' }], updatedAt: new Date().toISOString() },
  financials: { documents: [{ title: '2025 990 Tax Return', year: 2025, type: '990', url: 'https://files.sunshineonaranneyday.com/financials/example-990.pdf' }, { title: '2024 990 Tax Return', year: 2024, type: '990', url: 'https://files.sunshineonaranneyday.com/financials/example-990-2024.pdf' }, { title: '2024 Audit', year: 2024, type: 'audit', url: 'https://files.sunshineonaranneyday.com/financials/example-audit-2024.pdf' }] },
  'financial-snapshot': { year: 2025, totalRevenue: 1000000, totalExpenses: 900000, programExpenses: 750000, netAssets: 400000, contributions: 600000, storeRevenue: 300000, programPct: 83, managementPct: 9, fundraisingPct: 8 },
};
for (const [key, data] of Object.entries(site)) await DB.prepare('INSERT INTO site_config (key, data) VALUES (?, ?)').bind(key, JSON.stringify(data)).run();

// ── The outside world, faked ──
const { privateKey: saPem } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = { GOOGLE_CALENDAR_KEY: JSON.stringify({ type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', client_id: '1234567890', project_id: 'example-project', private_key: saPem }), DB, FILES: new FakeR2(), CF_ACCESS_TEAM_DOMAIN: 'soard', CF_ACCESS_AUD: 'aud-tag', RESEND_API_KEY: 're_test', MERCURY_API_TOKEN: 'mercury-test', MERCURY_RELAY_KEY: 'relay-test', JOBTREAD_GRANT_KEY: 'jt-test' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url === 'https://soard.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  if (url.startsWith('https://api.resend.com/')) return Response.json({ id: 'em_1' });
  if (url === 'https://mercury-relay.sunshineonaranneyday.com/api/v1/accounts') return Response.json({ accounts: [{ name: 'Operating', kind: 'checking', type: 'mercury', status: 'active', currentBalance: 312500 }, { nickname: 'Reserve', kind: 'savings', type: 'mercury', status: 'active', currentBalance: 62500 }] });
  if (url.startsWith('https://mercury-relay.sunshineonaranneyday.com/')) return Response.json({ transactions: [], accounts: [] });
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-test', expires_in: 3600 });
  if (/googleapis\.com/.test(url)) return Response.json({ items: [], messages: [], members: [], files: [], conferenceRecords: [] });
  if (url === 'https://api.jobtread.com/pave') {
    const job = (id, name, status) => ({ id, name, customFieldValues: { nodes: [{ value: status, customField: { id: FIELD_JOB_STATUS } }] } });
    return Response.json({ organization: { jobs: { nodes: [job('j1', 'Maya (2026)', 'Build'), job('j2', 'Leo (2026)', 'Design'), job('j3', 'Someone Else (2026)', 'Awaiting Funding'), job('j4', 'Not Published Yet (2026)', 'Design')], nextPage: null } } });
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return Response.json({ error: 'test: no outside calls' }, { status: 502 });
  return realFetch(input, init);
};
_resetKeyCacheForTests();
provideBoardFinance(async () => ({
  at: new Date().toISOString(),
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 15)).toISOString().slice(0, 7), income: 80000 + i * 1000, makeovers: 40000, store: 12000, operating: 18000, storeSales: 25000, net: 10000 + i * 1000 })),
  ytd: { year: YEAR, through: day(0), income: 900000, makeovers: 500000, store: 150000, operating: 200000, net: 50000 },
  lastYtd: { year: YEAR - 1, through: day(-365), income: 800000, makeovers: 480000, store: 140000, operating: 200000, net: -20000 },
  cash: { today: 375000, lowest: { dollars: 210000, week: day(40) }, cautiousLowest: { dollars: 180000, week: day(47) }, in13Weeks: 260000, floor: 150000, belowFloor: false },
  perMakeover: { count: 12, average: 21000 },
}));

// ── Files, made here ──
async function pdf(title, lines, pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([612, 792]);
    page.drawText(title, { x: 72, y: 700, size: 20, font });
    lines.forEach(([label, amount], i) => { const y = 630 - i * 24; page.drawText(label, { x: 72, y, size: 12, font }); if (amount) page.drawText(amount, { x: 430, y, size: 12, font }); });
  }
  return Buffer.from(await doc.save());
}
function zip(files) {
  const enc = new TextEncoder();
  const locals = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name); const raw = enc.encode(text); const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
function minutesDocx() {
  const wp = (text, ilvl) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const lvls = ['decimal', 'decimal', 'lowerLetter', 'lowerRoman'].map((f, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${f}"/></w:lvl>`).join('');
  const body = [wp('CALL TO ORDER', 0), wp('Roll Call', 1), wp('COMMITTEE REPORTS', 0), wp('Financial (Sam)', 1), wp('Reserves grew this quarter', 2), wp('OPEN FORUM', 0), wp('Questions from the board', 1)].join('');
  return zip({ 'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>`, 'word/numbering.xml': `<w:numbering><w:abstractNum w:abstractNumId="0">${lvls}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`, '[Content_Types].xml': '<Types/>' });
}
const file = (bytes, name, type) => new File([bytes], name, { type });

// ── The board's year: meetings held, the next one, one in progress today ──
const board = (status) => (slug) => ({ slug, name: PEOPLE[slug].name, org: PEOPLE[slug].organization, kind: 'board', status });
const LONG_WORD = 'Supercalifragilisticexpialidocious-Reimbursement-Reconciliation-Worksheet';
async function meeting(raw, files = []) {
  const m = await saveMeeting(DB, cleanMeeting(raw), { by: FOUNDER });
  for (const f of files) await putFile(env, { ownerType: 'meeting', ownerId: m.id, file: f.file, kind: f.kind, staffOnly: !!f.staffOnly, by: FOUNDER });
  return m;
}
const everyone = ['alex-rivera', 'sam-ortiz', 'taylor-nguyen', 'maria-de-la-cruz-whitfield', 'kim-park', 'chris-okafor'];
const statement = await pdf('Statement of Financial Position', [['Bank Accounts', ''], ['  Example Operating', '$250,000.00'], ['  Example Reserve', '$125,000.00'], ['Total for Bank Accounts', '$375,000.00']], 2);
const packet = await pdf('Board Packet', [['Agenda', ''], ['Financials', ''], ['Reports', '']], 3);
// Held 60 days ago, minutes approved: who was there, two decisions, two action items, Minutes.docx and four other files
const approved = await meeting({ date: day(-60), start: '08:00', end: '10:00', location: 'Example Hall', address: '100 Example Street, Atlanta, GA 30301', shared: true, minutes: 'approved', approvedOn: day(-30),
  attendance: [...everyone.slice(0, 4).map(board('present')), board('remote')('kim-park'), board('absent')('chris-okafor'), { name: 'Jane Doe', kind: 'staff', status: 'present', slug: 'jane-doe' }],
  sections: [
    { title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes' }] },
    { title: 'Committee reports', notes: 'Both committees reported.', items: [
      { title: 'Finance', presenter: 'Sam Ortiz', who: ['sam-ortiz'], notes: '- Cash is healthy\n- Store sales are down on last year' },
      { title: 'Events: the Evening of Sunshine gala, the golf classic, and the spring volunteer day with every partner who said yes this year', presenter: 'Alex Rivera', who: ['alex-rivera', 'maria-de-la-cruz-whitfield'], notes: 'The gala sold out.' },
    ] },
  ],
  motions: [{ text: 'Approve the minutes of the last meeting', by: 'Alex Rivera', second: 'Sam Ortiz', result: 'passed' }, { text: 'Approve the 2027 budget as presented', by: 'Sam Ortiz', second: 'Taylor Nguyen', result: 'passed' }],
  actions: [{ text: 'Send the venue contract to the board', owner: 'alex-rivera', ownerName: 'Alex Rivera', due: day(5) }, { text: 'Share the store plan', owner: 'sam-ortiz', ownerName: 'Sam Ortiz', due: day(-10), done: true, doneOn: day(-12) }],
  agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
}, [
  { file: file(statement, 'Statement of Financial Position.pdf', 'application/pdf'), kind: 'financials' },
  { file: file(packet, 'Board Packet.pdf', 'application/pdf'), kind: 'packet' },
  { file: file(minutesDocx(), 'Minutes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), kind: 'minutes' },
  { file: file(await pdf('A long name', [['Example', '']]), `2026 Q3 ${LONG_WORD} for the board, final final (1) (1).pdf`, 'application/pdf'), kind: 'other' },
]);
// Held 150 days ago: who was there and a decision, but no minutes written (nothing read in, typed or kept)
const unwritten = await meeting({ date: day(-150), start: '17:30', end: '19:00', location: 'Rivera Builders, 2nd floor', shared: true,
  attendance: [...everyone.slice(0, 3).map(board('present')), ...everyone.slice(3).map(board('excused'))],
  sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }, { title: 'Strategic plan', items: [{ title: 'The next five years', presenter: 'Jane Doe' }] }],
  motions: [{ text: 'Adopt the strategic plan', by: 'Taylor Nguyen', second: 'Alex Rivera', result: 'tabled' }],
  agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
}, [{ file: file(statement, 'Statement of Financial Position.pdf', 'application/pdf'), kind: 'financials' }]);
// Older years, each with its minutes as a PDF named by its date ("Minutes 2025-09-25.pdf")
const dated = [];
for (const [i, back] of [[1, 420], [2, 800]]) {
  const m = await meeting({ date: day(-back), start: '08:00', end: '09:30', location: 'Example Hall', shared: true, minutes: 'approved', approvedOn: day(-back + 60),
    attendance: everyone.slice(0, 4).map(board('present')), sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }],
    agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
  }, [{ file: file(await pdf(`Minutes ${i}`, [['Approved', '']]), `Minutes ${day(-back)}.pdf`, 'application/pdf'), kind: 'minutes' }]);
  dated.push({ id: m.id, name: `Minutes ${day(-back)}` });
}
// In progress today: from half an hour ago to an hour from now, by the clock in Atlanta
const nowET = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'America/New_York' }).formatToParts(new Date());
const minsNow = Number(nowET.find((x) => x.type === 'hour').value) * 60 + Number(nowET.find((x) => x.type === 'minute').value);
const hhmm = (n) => `${String(Math.floor(Math.max(0, Math.min(1439, n)) / 60)).padStart(2, '0')}:${String(Math.max(0, Math.min(1439, n)) % 60).padStart(2, '0')}`;
const todays = await meeting({ date: day(0), start: hhmm(minsNow - 30), end: hhmm(minsNow + 60), location: 'Example Hall', address: '100 Example Street, Atlanta, GA 30301', shared: true,
  attendance: everyone.map((s) => ({ ...board('')(s), rsvp: '' })),
  sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }, { title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash' }] }, { title: 'Programs', items: [{ title: 'Makeovers in progress', live: 'projects' }] }],
  agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
}, [{ file: file(packet, 'Board Packet.pdf', 'application/pdf'), kind: 'packet' }]);
// Ahead, in 9 days
const next = await meeting({ date: day(9), start: '08:00', end: '10:00', location: 'Example Hall', shared: true,
  attendance: everyone.map((s) => ({ ...board('')(s), rsvp: '' })),
  sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }, { title: 'Approve the last meeting’s minutes', live: 'minutes' }] }, { title: 'Open forum', items: [{ title: 'Questions from the board' }] }],
  agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
}, [{ file: file(packet, 'Board Packet.pdf', 'application/pdf'), kind: 'packet' }]);
// R2.2: held in an earlier year, its agenda's background points under its items (as an imported agenda writes them), no
// minutes read in, typed or kept
const background = await meeting({ date: day(-760), start: '08:00', end: '09:30', location: 'Example Hall', shared: true,
  attendance: everyone.slice(0, 4).map(board('present')),
  sections: [{ title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], notes: '- Revenue against budget\n- Cash over the next 13 weeks' }] }, { title: 'Open forum', notes: 'Questions from the board, as time allows', items: [] }],
  agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
});
// R2.2: held, its minutes only a file kept with it (not read in): the words under its agenda are still its background
const filed = await meeting({ date: day(-100), start: '08:00', end: '09:30', location: 'Example Hall', shared: true,
  attendance: everyone.slice(0, 4).map(board('present')),
  sections: [{ title: 'Programs', items: [{ title: 'Makeovers this season', presenter: 'Alex Rivera', who: ['alex-rivera'], notes: '- Two in design, one in build' }] }],
  agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
}, [{ file: file(await pdf('Minutes', [['Draft', '']]), 'Minutes.pdf', 'application/pdf'), kind: 'minutes' }]);
// R2.3: in 12 days, not shared with the board yet; Sam presents one item, Alex another
const unshared = await meeting({ date: day(12), start: '18:00', end: '19:00', location: 'Example Hall', title: 'Special Meeting on the Building Fund', shared: false,
  sections: [{ title: 'Welcome', items: [{ title: 'Roll call' }] }, { title: 'Money', items: [{ title: 'Where the building fund stands', presenter: 'Alex Rivera', who: ['alex-rivera'] }, { title: 'Building fund numbers', presenter: 'Sam Ortiz', who: ['sam-ortiz'], notes: '- What came in this fall' }] }],
  agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
});
const SAM = 'sam.board@example.org';
await DB.prepare('INSERT OR REPLACE INTO board_seen (slug, at) VALUES (?, ?)').bind('alex-rivera', new Date(Date.now() - 3 * 864e5).toISOString()).run();

// This year's major gifts, the biggest from a foundation with a long name
const zeffyPay = (id, daysAgo, dollars, o = {}) => ({ id, created: Math.floor((Date.now() - daysAgo * 864e5) / 1000), amount: dollars * 100, currency: 'usd', status: 'succeeded', type: 'online', refund_status: 'none', refunds: [], description: 'Evening of Sunshine', buyer: { first_name: 'Dana', last_name: 'Example', email: 'dana@example.com', is_corporate: false }, buyer_questions: [], items: [], recurring: null, ...o });
const GIVER = 'The Sample Family Foundation for Children and Families of the Southeast';
await maybeReadGifts({ DB, ZEFFY_API_KEY: 'zk-test' }, { fetchImpl: async () => Response.json({ object: 'list', data: [
  zeffyPay('pay_q0001', 1, 25000, { buyer: { first_name: 'Lee', last_name: 'Sample', is_corporate: true, company_name: GIVER } }),
  zeffyPay('pay_q0002', 2, 5000, { description: 'Help build Maya’s room' }),
  ...Array.from({ length: 6 }, (_, i) => zeffyPay(`pay_q01${i}0`, 10 + i * 9, 1000 + i * 750, { buyer: { first_name: ['Robin', 'Casey', 'Jordan', 'Morgan', 'Avery', 'Quinn'][i], last_name: 'Example', email: `giver${i}@example.com`, is_corporate: false } })),
], has_more: false, next_cursor: null }) });

// QuickBooks: the year so far ($220K of its revenue given in kind, the same used in its expenses), last year, the
// statements and QuickBooks' own budget (its file name "Budget_FY26_P&L")
{
  const cat = (key, name, amount, accounts) => ({ key, name, amount, accounts });
  const ytdBooks = { year: String(YEAR), from: `${YEAR}-01-01`, through: day(0), revenue: 1876045, spent: 1200000, net: 676045, basis: 'Accrual', nonCash: 220000, sources: [
    cat('donations', 'Donations', 700000, ['Individual/Corporate Revenue']), cat('store', 'Store sales', 415000, ['Store Income', 'Store Discounts']), cat('gala', 'Gala', 400000, ['Gala Income']),
    cat('inkind', 'In kind', 220000, ['In-Kind Contribution']), cat('grants', 'Grants', 90000, ['Grant Revenue']), cat('account:golf classic', 'Golf Classic', 30000, ['Golf Classic Income']),
    cat('account:rent', 'Rent', 16000, ['Rent Income']), cat('account:interest', 'Interest', 5000, ['Interest Income']), cat('account:makeover', 'Makeover', 45, ['Makeover Revenue']),
  ], store: { sales: 415000, cost: 250000, profit: 165000, salesAccounts: ['Store Income', 'Store Discounts'], costAccounts: ['Store COGS'] } };
  const lastBooks = { year: String(YEAR - 1), through: `${YEAR - 1}${day(0).slice(4)}`, revenue: 1500000, expenses: 1100000, net: 400000, nonCash: 70000, full: { revenue: 2000000, expenses: 1500000, net: 500000, nonCash: 100000 },
    sources: [cat('donations', 'Donations', 400000), cat('store', 'Store sales', 830000), cat('gala', 'Gala', 200000), cat('inkind', 'In kind', 70000)],
    store: { sales: 830000, cost: 380000, profit: 450000, salesAccounts: ['Store Income'], costAccounts: ['Store COGS'] } };
  await DB.exec('CREATE TABLE IF NOT EXISTS books_link (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, company TEXT, fiscal_start INTEGER, access_token TEXT, access_expires TEXT, refresh_token TEXT NOT NULL, refresh_expires TEXT, ytd TEXT, read_at TEXT, tried_at TEXT, error TEXT, error_at TEXT, error_detail TEXT, told TEXT, linked_at TEXT, linked_by TEXT)');
  await DB.exec('CREATE TABLE IF NOT EXISTS books_daily (id TEXT PRIMARY KEY, data TEXT, day TEXT, read_at TEXT, tried_at TEXT, error TEXT)');
  const readAt = new Date().toISOString();
  await DB.prepare('INSERT OR REPLACE INTO books_link (id, realm_id, company, refresh_token, ytd, read_at, tried_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('qbo', '9130350000000001', 'Example Charity', 'refresh-test', JSON.stringify(ytdBooks), readAt, readAt).run();
  const thisMonth = Number(day(0).slice(5, 7));
  const monthly = { year: String(YEAR), lastYear: String(YEAR - 1),
    months: Array.from({ length: thisMonth }, (_, i) => ({ month: `${YEAR}-${String(i + 1).padStart(2, '0')}`, revenue: Math.round(1876045 / thisMonth), spent: Math.round(1200000 / thisMonth), nonCash: Math.round(220000 / thisMonth) })),
    last: Array.from({ length: 12 }, (_, i) => ({ month: `${YEAR - 1}-${String(i + 1).padStart(2, '0')}`, revenue: [90, 110, 150, 140, 160, 170, 150, 160, 180, 190, 240, 260][i] * 1000, spent: 125000, nonCash: 8000 })) };
  const statements = { asOf: day(-30), closed: false, priorAsOf: `${YEAR - 1}${day(-30).slice(4)}`,
    position: [{ k: 'head', label: 'Assets', d: 0 }, { k: 'total', label: 'Total Bank Accounts', d: 1, a: 608532, p: 655431 }, { k: 'total', label: 'TOTAL ASSETS', d: 0, a: 870767, p: 794994 }],
    activity: [{ k: 'head', label: 'Income', d: 0 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, p: 1909703 }, { k: 'acct', label: 'New Account This Year', d: 1, a: 5000, p: null }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, p: 176000 }] };
  const budget = { name: 'Budget_FY26_P&L', from: `${YEAR}-01-01`, to: `${YEAR}-12-31`, asOf: day(-30), step: 1, monthly: true, months: 10, of: 12, totals: { revenue: 2000000, spending: 1500000, nonCash: 200000, nonCashIncome: 200000 },
    rows: [{ k: 'head', label: 'Income', d: 0 }, { k: 'acct', label: 'Individual/Corporate Revenue', d: 1, a: 700000, b: 500000, y: 600000 }, { k: 'total', label: 'Total Income', d: 0, a: 1884217, b: 1666667, y: 2000000 }, { k: 'sum', label: 'Net Income', d: 0, a: 189248, b: 150000, y: 180000 }] };
  await DB.prepare('INSERT OR REPLACE INTO books_daily (id, data, day, read_at, tried_at) VALUES (?, ?, ?, ?, ?)').bind('qbo', JSON.stringify({ shape: 3, day: day(0), lastYear: lastBooks, trailing: null, months: [], statements, functions: null, monthly, budget }), day(0), readAt, readAt).run();
}

// ── The server ──
const ROUTES = { '/api/board-admin': boardAdmin, '/api/board-portal': boardPortal, '/api/board-file': boardFile, '/api/bank-admin': bankAdmin, '/api/books-admin': booksAdmin };
const csp = (() => {
  const lines = readFileSync(join(ROOT, 'public/_headers'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === '/admin/*');
  return lines.slice(at + 1).find((l) => /^\s+Content-Security-Policy:/.test(l)).split('Content-Security-Policy:')[1].trim();
})();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const who = req.headers['x-test-user'] || '';
    if (url.pathname === '/cdn-cgi/access/get-identity') { res.writeHead(who ? 200 : 401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(who ? { email: who, name: '' } : {})); return; }
    if (url.pathname.startsWith('/cdn-cgi/imagedelivery/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers.set(k, v);
      if (who) headers.set('CF-Access-JWT-Assertion', await tokenFor(who));
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), duplex: 'half' });
      const ctx = { request, env, data: {}, waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
      ctx.next = async () => {
        const mod = ROUTES[url.pathname];
        const fn = mod?.[`onRequest${req.method[0]}${req.method.slice(1).toLowerCase()}`] || mod?.onRequest;
        return fn ? fn(ctx) : Response.json({ success: true, ok: true, items: [], pages: 1, files: [], entries: [] });
      };
      const out = await middleware(ctx);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let path = join(ROOT, 'public', decodeURIComponent(url.pathname));
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) { res.writeHead(404); res.end('Not found'); return; }
    const head = { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' };
    if (url.pathname.startsWith('/admin/')) head['Content-Security-Policy'] = csp;
    res.writeHead(200, head);
    res.end(readFileSync(path));
  } catch (err) {
    console.error('server', err);
    res.writeHead(500); res.end(String(err?.stack || err));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;
// The board's papers, added through Board admin's own route as a founder would
for (const [doc, title] of [[{ title: 'Board Member Expectations', kind: 'policy', sign: true, due: '01-31' }, 'Board Expectations.pdf'], [{ title: 'Bylaws', kind: 'governance' }, 'Bylaws (signed 2019).pdf']]) {
  const fd = new FormData();
  fd.set('saveDoc', JSON.stringify({ doc }));
  fd.set('file', new File([await pdf(doc.title, [['Article I', '']])], title, { type: 'application/pdf' }));
  const r = await fetch(`${SITE}/api/board-admin`, { method: 'POST', headers: { 'x-test-user': FOUNDER, Origin: SITE }, body: fd });
  if (!r.ok) console.error('paper', doc.title, r.status, await r.text());
}

const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 240000, args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-vsync', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
const consoleErrors = [];
async function tab(email, width = 1440, height = 1000) {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
  await page.setExtraHTTPHeaders({ 'x-test-user': email });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Content Security Policy|imagedelivery/.test(m.text())) consoleErrors.push(`${email} ${width}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${email} ${width}: ${e.message}`));
  return page;
}
async function open(page, hash) {
  // (a fresh load each time: a goto that only changes the hash would keep the data the page already has)
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.goto(`${SITE}/admin/board/${hash}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('.bp-boot') && document.querySelector('main')?.innerText.length > 50, { timeout: 30000 }).catch(() => {});
  await sleep(900);
}
async function go(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector('.bp-boot'), { timeout: 30000 }).catch(() => {});
  await sleep(1200);
}
const textOf = (page, sel = 'main') => page.$eval(sel, (e) => e.innerText.replace(/ /g, ' ')).catch(() => '');
// Sideways scroll, and anything past the right edge of the window or of the card it's in (a box that scrolls or
// clips sideways on purpose holds what's past its edge)
const spill = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = { scroll: document.scrollingElement.scrollWidth - vw, past: [] };
  const held = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/auto|scroll|hidden|clip/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
  for (const e of document.querySelectorAll('main *')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).position === 'fixed' || held(e)) continue;
    const card = e.parentElement?.closest('.bp-card, .bp-fig, .bp-yfigs li');
    const edge = card ? card.getBoundingClientRect().right : vw;
    if (r.right > edge + 1 || r.right > vw + 1) out.past.push(`${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).split(' ')[0]} "${(e.innerText || e.textContent || '').trim().slice(0, 40)}" ${Math.round(r.right - Math.min(edge, vw))}px`);
  }
  out.past = out.past.slice(0, 6);
  return out;
});
// Every dash a reader sees, and every one a screen reader hears (aria-labels, titles of what's shown, hidden words)
const dashes = (page) => page.evaluate(() => {
  const found = [];
  const main = document.querySelector('main') || document.body;
  const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (/[–—]/.test(n.textContent) && n.parentElement?.closest('[aria-hidden="true"], style, script') === null) found.push(n.textContent.trim().slice(0, 60)); }
  for (const e of main.querySelectorAll('[aria-label]')) if (/[–—]/.test(e.getAttribute('aria-label'))) found.push(`aria-label: ${e.getAttribute('aria-label').slice(0, 60)}`);
  return found.slice(0, 8);
});
async function shot(page, sel, name) {
  const el = typeof sel === 'string' ? await page.$(sel) : sel;
  if (!el) return;
  await el.evaluate((e) => { const r = e.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 90); });
  await sleep(400);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

try {
  // ─── 1, 3: The year so far on Financials ───
  console.log('Financials: The year so far');
  for (const w of [320, 375, 390, 768, 1440]) {
    const p = await tab(ALEX, w, 900);
    await open(p, '#/financials');
    await p.waitForSelector('.bp-yfigs li', { timeout: 20000 }).catch(() => {});
    const figs = await p.$$eval('.bp-yfigs li', (l) => l.map((li) => {
      const v = li.querySelector('.bp-yfigs__value');
      const r = li.getBoundingClientRect(); const rv = v.getBoundingClientRect();
      return { label: li.querySelector('.bp-yfigs__label').textContent, value: v.textContent, inside: rv.left >= r.left - 0.5 && rv.right <= r.right + 0.5, fits: li.scrollWidth <= li.clientWidth + 1 };
    }));
    const s = await spill(p);
    ok(figs.length === 3 && figs.every((f) => f.inside && f.fits) && s.scroll <= 0, `${w}px: the year’s three figures inside their boxes, no sideways scroll (${figs.map((f) => `${f.label} ${f.value}${f.inside ? '' : ' PAST ITS BOX'}`).join(', ')}; scroll ${s.scroll})`);
    await shot(p, '.bp-yearcard', `yfigs-${w}`);
    if (w === 1440) {
      const num = (t) => Number(String(t).replace(/[^0-9.−-]/g, '').replace('−', '-'));
      const [rev, exp, net] = figs.map((f) => num(f.value));
      ok(rev - exp === net, `the three add up: ${figs.map((f) => f.value).join(' less ')} (${rev} − ${exp} = ${net})`);
      const tiles = await p.$$eval('.bp-fig', (l) => Object.fromEntries(l.map((f) => [f.querySelector('.bp-fig__label').textContent, f.querySelector('.bp-fig__value').textContent])));
      const revTile = Object.entries(tiles).find(([k]) => /revenue/.test(k))?.[1];
      const expTile = Object.entries(tiles).find(([k]) => /expenses/.test(k))?.[1];
      const netTile = Object.entries(tiles).find(([k]) => /net so far/.test(k))?.[1];
      ok(revTile === '$1.66M' && figs[0].value === '$1,656,045' && expTile === '$980K' && figs[1].value === '$980,000' && netTile === '+$676K' && figs[2].value === '$676,045', `the figures agree with the tiles above (${JSON.stringify(tiles)} | ${figs.map((f) => f.value).join(', ')})`);
      const card = await textOf(p, '.bp-yearcard');
      ok((card.match(/in kind on either side/g) || []).length === 1 && /Not counting the \$220K in kind on either side\./.test(card), 'what the figures leave out is said once, for both sides');
      const fin = await textOf(p);
      ok(!/Budget_FY26|P&L/.test(fin) && /QuickBooks’ \d{4} budget/.test(fin), 'the budget by its year, never QuickBooks’ file name');
      // 9 (Financials' own cases): the change for a category new this year, a statement line with nothing beside it
      await p.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
      await sleep(400);
      const mix = await p.$$eval('.bp-mixtable tbody tr', (r) => r.map((x) => x.textContent));
      ok(mix.some((r) => /Everything else/.test(r)) && mix.every((r) => !/[–—]/.test(r)), `where the money came from: no dash for a change (${JSON.stringify(mix.slice(-2))})`);
      ok((await dashes(p)).length === 0, `Financials: no en or em dash anywhere (${JSON.stringify(await dashes(p))})`);
      // 8, 12: What makeovers cost
      const costs = await textOf(p, '#costs');
      ok(/makeover comes next\./.test(costs) && !/, comes next/.test(costs) && !/makeover, comes next/.test(costs), `What makeovers cost: a whole sentence with no price in it (${(costs.match(/[^.]*comes next[^.]*\./) || [''])[0].trim()})`);
      const seg = await p.$$eval('#costs .bc-seg button', (l) => l.map((b) => b.textContent.trim()));
      ok(seg.every(Boolean), `What makeovers cost: no empty, unnamed season button (${JSON.stringify(seg)})`);
      // 5: what makeovers cost says the same count as Home
      ok(/Underway: 3 makeovers/.test(costs), `What makeovers cost: 3 underway (${(costs.match(/Underway: \d+ \w+/) || [''])[0]})`);
    }
    await p.close();
  }

  // ─── 5, 7, 13: Home ───
  console.log('Home');
  for (const w of [1024, 1440]) {
    const p = await tab(ALEX, w, 1000);
    await open(p, '#/');
    await p.waitForSelector('.bp-figs', { timeout: 20000 });
    const giver = await p.evaluate((name) => { const s = [...document.querySelectorAll('.bp-gift__who strong')].find((x) => x.textContent.startsWith('The Sample')); return s ? { text: s.textContent, whole: s.scrollWidth <= s.clientWidth + 1 && getComputedStyle(s).textOverflow !== 'ellipsis', shown: s.innerText === name } : null; }, GIVER);
    ok(giver?.whole && giver.shown, `${w}px Home: the biggest donor’s whole name, never cut short (${JSON.stringify(giver)})`);
    if (w === 1440) {
      const fig = await p.evaluate(() => { const f = [...document.querySelectorAll('.bp-fig')].find((x) => /Makeovers/.test(x.querySelector('.bp-fig__label').textContent)); return f && { label: f.querySelector('.bp-fig__label').textContent, value: f.querySelector('.bp-fig__value').textContent, sub: f.querySelector('.bp-fig__sub').textContent.replace(/ /g, ' '), rest: [...f.querySelectorAll('.bp-fig__note')].map((n) => n.textContent.replace(/ /g, ' ')) }; });
      const parts = (fig?.sub || '').split(' · ').map((x) => Number(x.split(' ')[0]));
      ok(fig?.value === '3' && parts.reduce((a, b) => a + b, 0) === 3 && fig.sub === '1 in build · 2 in design', `Home: 3 makeovers underway, its line adding up to 3 (${JSON.stringify(fig)})`);
      ok(fig?.rest.includes('1 more awaiting funding'), 'Home: the one awaiting funding said beside them, not counted in them');
      await p.waitForSelector('#makeovers .lc-sum', { timeout: 20000 }).catch(() => {});
      const sum = await textOf(p, '#makeovers .lc-sum');
      ok(/1 awaiting funding · 3 makeovers being built/.test(sum), `the makeovers board: the same 3 being built (${sum})`);
      // 7: the last meeting (approved) says so; move the one with nothing written to be the last held
      ok(/Minutes approved/.test(await textOf(p, '.bp-since')), 'Home: the last meeting, its minutes approved');
      ok((await dashes(p)).length === 0, `Home: no en or em dash anywhere (${JSON.stringify(await dashes(p))})`);
      await shot(p, '.bp-figs', 'home-figs-1440');
    }
    await p.close();
  }
  {
    const p = await tab(ALEX, 1440, 1000);
    await open(p, '#/financials/gifts');
    await sleep(800);
    const giver = await p.evaluate(() => { const s = [...document.querySelectorAll('.bp-gift__who strong')].find((x) => x.textContent.startsWith('The Sample')); return s ? { whole: s.scrollWidth <= s.clientWidth + 1 && getComputedStyle(s).textOverflow !== 'ellipsis' } : null; });
    ok(giver?.whole, `Financials’ gifts at 1440: the biggest donor’s whole name (${JSON.stringify(giver)})`);
    await p.close();
  }

  // ─── 7: a held meeting with nothing written ───
  console.log('A held meeting with no minutes written');
  {
    const p = await tab(ALEX, 1440, 1000);
    await open(p, '#/meetings');
    const row = await p.evaluate((id) => document.getElementById(`mr-${id}`)?.innerText.replace(/\n+/g, ' | ') || '', unwritten.id);
    ok(row && !/Draft minutes/.test(row) && /No minutes yet/.test(row), `the Meetings list: “No minutes yet”, never “Draft minutes” (${row})`);
    await go(p, `#/meetings/${unwritten.id}`);
    const eyebrow = await textOf(p, '.bp-eyebrow');
    ok(!/Draft minutes/.test(eyebrow) && /No minutes yet/.test(eyebrow), `its page: “${eyebrow.replace(/\n/g, ' ')}”`);
    await go(p, `#/meetings/${approved.id}`);
    ok(/Minutes approved/.test(await textOf(p, '.bp-eyebrow')), 'a meeting with its minutes approved still says so');
    // The one with nothing written as the last held: Home's Last meeting says so too
    await patchMeeting(DB, unwritten.id, (x) => ({ ...x, date: day(-5) }));
    await open(p, '#/');
    const since = await textOf(p, '.bp-since');
    ok(/No minutes yet/.test(since) && !/Draft minutes/.test(since), `Home’s Last meeting: “No minutes yet” (${since.replace(/\n+/g, ' | ').slice(0, 120)})`);
    await patchMeeting(DB, unwritten.id, (x) => ({ ...x, date: day(-150) }));
    await p.close();
  }

  // ─── 6: during the meeting ───
  console.log('During the meeting');
  {
    const p = await tab(ALEX, 1280, 900);
    await open(p, '#/');
    const home = await textOf(p, '.bp-nextup');
    ok(/Happening now/.test(home) && !/Will you be there\?/.test(home), `Home: “Happening now”, no question (${home.replace(/\n+/g, ' | ').slice(0, 100)})`);
    await go(p, `#/meetings/${todays.id}`);
    const page = await textOf(p, '.bp-aghero');
    ok(!/Will you be there\?/.test(page) && /Happening now/.test(page), `its page: “Happening now”, no longer asking (${page.replace(/\n+/g, ' | ').slice(0, 160)})`);
    await shot(p, '.bp-aghero', 'meeting-now-1280');
    // Before it starts, it asks (when there's still time left today to move it to)
    if (minsNow + 180 < 1430) {
      await patchMeeting(DB, todays.id, (x) => ({ ...x, start: hhmm(minsNow + 120), end: hhmm(minsNow + 180) }));
      await open(p, `#/meetings/${todays.id}`);
      ok(/Will you be there\?/.test(await textOf(p, '.bp-aghero')), 'before it starts, its page still asks');
      await patchMeeting(DB, todays.id, (x) => ({ ...x, start: hhmm(minsNow - 30), end: hhmm(minsNow + 60) }));
    }
    await p.close();
  }

  // ─── 2: Print it all on a held meeting ───
  console.log('Print it all on a held meeting');
  {
    const p = await tab(ALEX, 1280, 900);
    await open(p, `#/meetings/${approved.id}`);
    await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Print it all/.test(b.textContent))?.click());
    ok(await p.waitForFunction(() => window.__printed > 0, { timeout: 90000 }).then(() => true, () => false), 'Print it all opens the print window');
    const paper = await p.evaluate(() => ({ all: document.querySelector('.bpp')?.innerText || '', agenda: document.querySelector('.bpp-agenda')?.innerText || '', caps: [...document.querySelectorAll('.bpp-cap')].map((c) => c.textContent) }));
    ok(/Minutes approved/.test(paper.agenda), 'on paper: where its minutes are');
    ok(/Who was there/.test(paper.agenda) && /5 of 6 board members, a quorum, 1 by video\./.test(paper.agenda) && /Here\s*Alex Rivera, Sam Ortiz, Taylor Nguyen, Maria-Fernanda de la Cruz Whitfield\s*By video/.test(paper.agenda) && /By video\s*Kim Park/.test(paper.agenda) && /Not there\s*Chris Okafor/.test(paper.agenda), 'on paper: who was there, as its page says it');
    // R2.7: staff there said apart, never among the board members counted
    const rows = await p.$$eval('.bpp-rec__who > div', (l) => Object.fromEntries(l.map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])));
    ok(rows['Also there'] === 'Jane Doe' && !/Jane Doe/.test(rows.Here || ''), `R2.7 on paper: Jane Doe (staff) under Also there, not under Here (${JSON.stringify(rows)})`);
    ok(/Decisions/.test(paper.agenda) && /Approve the 2027 budget as presented/.test(paper.agenda) && /Passed, moved by Sam Ortiz, seconded by Taylor Nguyen/.test(paper.agenda), 'on paper: the decisions, how each went and who moved it');
    ok(/Action items/.test(paper.agenda) && /Send the venue contract to the board/.test(paper.agenda) && /Share the store plan/.test(paper.agenda) && /Alex Rivera · due/.test(paper.agenda), 'on paper: the action items, whose and by when');
    ok(/Both committees reported\./.test(paper.agenda) && /Cash is healthy/.test(paper.agenda), 'on paper: the minutes under each part and item');
    ok(!/\d{1,2}:\d{2} [AP]M · \d+ min/.test(paper.agenda), 'on paper: no planned times for a meeting that’s been held');
    ok(paper.caps.some((c) => /^The minutes as written · Minutes/.test(c)) && /CALL TO ORDER|Call to order/i.test(paper.all.split('The minutes as written')[1] || '') && /Reserves grew this quarter/.test(paper.all), `on paper: the minutes themselves, Minutes.docx (${JSON.stringify(paper.caps)})`);
    await p.emulateMediaType('print');
    // (a Word page is drawn as itself in a frame: on paper the frame keeps its height, or the page prints blank)
    const frames = await p.$$eval('.bpp-page .bdoc-frame', (l) => l.filter((f) => f.querySelector('.bdoc-page--word')).map((f) => Math.round(f.getBoundingClientRect().height)));
    ok(frames.length > 0 && frames.every((hgt) => hgt > 500), `on paper: the Word minutes’ page drawn at its height, never blank (${JSON.stringify(frames)})`);
    await p.pdf({ path: join(OUT, 'print-held.pdf'), format: 'letter', printBackground: true });
    await p.emulateMediaType('screen');
    await p.evaluate(() => dispatchEvent(new Event('afterprint')));
    await p.close();
  }

  // ─── 10: a date in a file's name ───
  console.log('A date in a file’s name');
  {
    const p = await tab(ALEX, 1440, 1000);
    await open(p, '#/documents');
    await p.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; [...document.querySelectorAll('main button')].find((b) => /^Show\s\d+\searlier/.test(b.textContent.trim()))?.click(); });
    await sleep(800);
    const docs = await textOf(p);
    ok(dated.every((x) => docs.includes(x.name)) && !/Minutes \d{4}-\d{2} \d{2}/.test(docs), `Documents: ${dated.map((x) => x.name).join(', ')} as written`);
    await go(p, `#/meetings/${dated[0].id}`);
    const mt = await textOf(p);
    ok(mt.includes(dated[0].name) && !/Minutes \d{4}-\d{2} \d{2}/.test(mt), `its meeting: “${dated[0].name}”`);
    await p.close();
  }

  // ─── 11: "Mobilization" whole ───
  console.log('The makeovers board’s steps');
  for (const w of [768, 1024]) {
    const p = await tab(ALEX, w, 1000);
    await open(p, '#/');
    await p.waitForSelector('#makeovers .lc-step', { timeout: 20000 });
    const broken = await p.$$eval('#makeovers .lc-step span:not(.sr-only)', (l) => l.filter((s) => s.textContent.trim() && !/\s/.test(s.textContent.trim())).map((s) => { const lh = parseFloat(getComputedStyle(s).lineHeight); return { t: s.textContent, lines: Math.round(s.getBoundingClientRect().height / lh) }; }).filter((x) => x.lines > 1));
    ok(broken.length === 0, `${w}px: each one-word step on one line, "Mobilization" whole (${JSON.stringify(broken)})`);
    ok((await spill(p)).scroll <= 0, `${w}px: the track stays inside the page`);
    if (w === 768) {
      await shot(p, '#makeovers .lc-track', 'track-768');
      await p.emulateMediaType('print');
      await sleep(400);
      const onPaper = await p.$$eval('#makeovers .lc-step span:not(.sr-only)', (l) => l.filter((s) => s.textContent.trim() && !/\s/.test(s.textContent.trim())).map((s) => { const lh = parseFloat(getComputedStyle(s).lineHeight); return { t: s.textContent, lines: Math.round(s.getBoundingClientRect().height / lh) }; }).filter((x) => x.lines > 1));
      ok(onPaper.length === 0, `on paper: each one-word step on one line (${JSON.stringify(onPaper)})`);
      await p.emulateMediaType('screen');
    }
    await p.close();
  }

  // ═══ QA round 2 ═══
  // ─── R2.1: the makeovers card's counts agree and add up, at every width ───
  console.log('R2.1 The makeovers card’s counts');
  // "1 awaiting funding · 3 makeovers being built" → { 'awaiting funding': 1, 'being built': 3 }
  const lineCounts = (line) => Object.fromEntries(String(line).split(' · ').filter(Boolean).map((x) => { const m = x.match(/^(\d+) (.*)$/); return m ? [m[2].replace(/^(makeovers?|famil(y|ies)) /, '').replace(/ for \d{4}$/, ''), Number(m[1])] : [x, NaN]; }));
  for (const w of [320, 375, 390, 768, 1024, 1440]) {
    const p = await tab(ALEX, w, 900);
    await open(p, '#/');
    await p.waitForSelector('#makeovers .lc-track', { timeout: 20000 }).catch(() => {});
    await sleep(600);
    const card = await p.evaluate(() => {
      const shown = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const num = (e) => Number((e?.textContent || '').trim());
      return {
        line: document.querySelector('#makeovers .lc-sum')?.textContent.replace(/\u00a0/g, ' ') || '',
        phases: [...document.querySelectorAll('#makeovers .lc-phase')].map((s) => ({
          label: s.getAttribute('aria-label'),
          n: shown(s.querySelector('.lc-phase__n')) ? num(s.querySelector('.lc-phase__n')) : null,
          also: shown(s.querySelector('.lc-phase__also')) ? s.querySelector('.lc-phase__also').textContent.replace(/\u00a0/g, ' ') : '',
          steps: [...s.querySelectorAll('.lc-step')].filter(shown).map((st) => ({ n: num(st.querySelector('b')), label: st.querySelector('span:not(.sr-only)')?.textContent })),
        })),
        cols: [...document.querySelectorAll('#makeovers .bk-col')].map((c) => ({ label: c.querySelector('.bk-col__head span')?.textContent, n: num(c.querySelector('.bk-col__n')) })),
      };
    });
    const said = lineCounts(card.line);
    const ph = Object.fromEntries(card.phases.map((x) => [x.label, x]));
    const total = Object.values(said).reduce((a, b) => a + b, 0);
    if (w <= 640) {
      const also = lineCounts(ph.Building?.also.replace(/ · /g, ' · ') || '');
      ok(ph.Building?.n === (said['being built'] || 0) && ph.Applying?.n === (said.applying || 0) && ph.Revealed?.n === (said.revealed || 0),
        `R2.1 ${w}px: the phone’s track counts what its line says (“${card.line}”; ${card.phases.map((x) => `${x.n} ${x.label}${x.also ? ` (${x.also})` : ''}`).join(', ')})`);
      ok((also['awaiting funding'] || 0) === (said['awaiting funding'] || 0) && (also.approved || 0) === (said.approved || 0)
        && card.phases.reduce((t, x) => t + (x.n || 0), 0) + Object.values(also).reduce((t, n) => t + n, 0) === total,
      `R2.1 ${w}px: those approved or awaiting funding said under Building, never in it, and it all adds up to ${total}`);
      if (w === 320) await shot(p, '#makeovers', 'r2-makeovers-320');
    } else {
      const step = (label) => card.phases.flatMap((x) => x.steps).find((st) => st.label === label)?.n || 0;
      const built = ['Design', 'Finalization', 'Approval', 'Mobilization', 'Build'].reduce((t, l) => t + step(l), 0);
      const stepsAll = card.phases.flatMap((x) => x.steps).reduce((t, st) => t + st.n, 0);
      ok(built === (said['being built'] || 0) && step('Awaiting funding') === (said['awaiting funding'] || 0) && step('Approved') === (said.approved || 0) && stepsAll === total,
        `R2.1 ${w}px: each step’s count agrees with the line and they add up (${card.line}; ${card.phases.flatMap((x) => x.steps).filter((st) => st.n).map((st) => `${st.n} ${st.label}`).join(', ')})`);
      ok(card.cols.every((c) => step(c.label) === c.n || c.label === 'Applying'), `R2.1 ${w}px: each column’s count is its step’s (${card.cols.map((c) => `${c.label} ${c.n}`).join(', ')})`);
      if (w === 1440) await shot(p, '#makeovers', 'r2-makeovers-1440');
    }
    await p.close();
  }

  // ─── R2.2: background is never minutes ───
  console.log('R2.2 A held meeting with its agenda’s background and no minutes');
  {
    const p = await tab(ALEX, 1440, 1000);
    await open(p, '#/meetings');
    const y = background.date.slice(0, 4);
    await p.evaluate(() => { for (const d of document.querySelectorAll('main details')) d.open = true; });
    await sleep(500);
    const row = await p.evaluate((id) => document.getElementById(`mr-${id}`)?.innerText.replace(/\n+/g, ' | ') || '', background.id);
    ok(row && /No minutes yet/.test(row) && !/Draft minutes/.test(row), `R2.2 the Meetings list: “No minutes yet”, never “Draft minutes” (${row})`);
    const fold = await p.evaluate((yr) => [...document.querySelectorAll('.bp-yearfold summary')].find((x) => x.querySelector('.bp-yearfold__y')?.textContent === yr)?.innerText.replace(/\n+/g, ' | ').replace(/\u00a0/g, ' ') || '', y);
    ok(fold ? !/draft/.test(fold) && /1 without minutes/.test(fold) : true, `R2.2 its year’s fold: none a draft, one without minutes (${fold || `${y} isn’t folded on this day`})`);
    await go(p, `#/meetings/${background.id}`);
    const eyebrow = await textOf(p, '.bp-eyebrow');
    ok(/No minutes yet/.test(eyebrow) && !/Draft minutes|minutes$/i.test(eyebrow.split('\n')[0]), `R2.2 its page: “${eyebrow.replace(/\n/g, ' ')}”`);
    ok(/Revenue against budget/.test(await textOf(p)), 'R2.2 its background still shows under the item');
    // Its minutes only a file kept with it: draft minutes, and the background isn't offered a correction as if it were them
    await go(p, `#/meetings/${filed.id}`);
    ok(/Draft minutes/.test(await textOf(p, '.bp-eyebrow')), 'R2.2 minutes in a file kept with it: “Draft minutes”');
    const offers = await p.$$eval('main .mfix-open', (l) => l.map((b) => ({ label: b.getAttribute('aria-label') || b.textContent.trim(), under: b.closest('#corrections') ? 'anything else' : b.closest('#who') ? 'who' : b.closest('.bp-agitem, .bp-agsec')?.querySelector('h2, h3')?.textContent || '?' })));
    ok(offers.length > 0 && offers.every((o) => o.under === 'anything else' || o.under === 'who'), `R2.2 its background isn’t offered a correction as the minutes (${JSON.stringify(offers)})`);
    ok(/Suggest a correction under Anything else/.test(await textOf(p, '.bp-aghero')), 'R2.2 Read before the vote points to Anything else');
    // The one with only background as the last held: Home's Last meeting says so too
    await patchMeeting(DB, background.id, (x) => ({ ...x, date: day(-5) }));
    await open(p, '#/');
    const since = await textOf(p, '.bp-since');
    ok(/No minutes yet/.test(since) && !/Draft minutes/.test(since), `R2.2 Home’s Last meeting: “No minutes yet” (${since.replace(/\n+/g, ' | ').slice(0, 120)})`);
    await patchMeeting(DB, background.id, (x) => ({ ...x, date: day(-760) }));
    await p.close();
  }

  // ─── R2.3: a meeting not shared yet, for who presents in it ───
  console.log('R2.3 A meeting not shared yet, for its presenter');
  {
    const samsItem = unshared.sections[1].items[1];
    for (const w of [390, 1280]) {
      const p = await tab(SAM, w, 900);
      await open(p, '#/');
      const ask = await p.evaluate((id) => { const a = [...document.querySelectorAll('.bp-forme a')].find((x) => (x.getAttribute('href') || '').includes(id)); return a ? { href: a.getAttribute('href'), text: a.innerText.replace(/\n+/g, ' | ') } : null; }, unshared.id);
      ok(ask && /Write your report: Building fund numbers/.test(ask.text) && ask.href === `#/meetings/${unshared.id}/report/${samsItem.id}`, `R2.3 ${w}px Home: For you asks Sam for his report on it (${JSON.stringify(ask)})`);
      await go(p, `#/meetings/${unshared.id}/report/${samsItem.id}`);
      const links = await p.evaluate(() => ({ back: document.querySelector('.bp-back')?.getAttribute('href'), done: [...document.querySelectorAll('main a')].find((a) => a.textContent.trim() === 'Done')?.getAttribute('href') }));
      ok(links.back === `#/meetings/${unshared.id}` && links.done === `#/meetings/${unshared.id}`, `R2.3 ${w}px its report page: its name and Done go to the meeting (${JSON.stringify(links)})`);
      await p.evaluate(() => [...document.querySelectorAll('main a')].find((a) => a.textContent.trim() === 'Done')?.click());
      await p.waitForFunction((id) => location.hash === `#/meetings/${id}`, { timeout: 10000 }, unshared.id).catch(() => {});
      await sleep(1200);
      const page = await textOf(p);
      ok(!/isn’t on the board page/.test(page) && /Special Meeting on the Building Fund/.test(page) && /Not shared yet/.test(page), `R2.3 ${w}px Done lands on the meeting, never a dead end (${page.replace(/\n+/g, ' | ').slice(0, 160)})`);
      const item = await p.evaluate((id) => { const li = document.getElementById(`i-${id}`); return li ? { n: li.querySelector('.bp-agitem__n')?.textContent, part: li.closest('.bp-agsec')?.querySelector('.bp-agsec__n')?.textContent } : null; }, samsItem.id);
      ok(item?.n === '2.2' && item.part === '02', `R2.3 ${w}px his item numbered as the whole agenda numbers it (${JSON.stringify(item)})`);
      ok(!/Where the building fund stands|Roll call/.test(page), 'R2.3 nothing of the meeting but his own items');
      ok(!/Will you be there|Add it to my calendar|Print it all/.test(page), 'R2.3 no answer, calendar or print for a meeting the board can’t see yet');
      const s = await spill(p);
      ok(s.scroll <= 0 && s.past.length === 0, `R2.3 ${w}px: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
      await p.screenshot({ path: join(OUT, `r2-presenter-${w}.png`) });
      await p.close();
    }
    // Someone who doesn't present in it: still not theirs
    const q = await tab(ALEX, 1280, 900);
    await open(q, `#/meetings/${unshared.id}`);
    ok(!/Building fund numbers/.test(await textOf(q)), 'R2.3 another presenter sees only their own item, never his');
    await q.close();
  }

  // ─── R2.4: once today's meeting is over ───
  console.log('R2.4 Once today’s meeting is over');
  if (minsNow >= 95) {
    const ended = { start: hhmm(minsNow - 90), end: hhmm(minsNow - 15) };
    await patchMeeting(DB, todays.id, (x) => ({ ...x, video: 'https://meet.google.com/abc-defg-hij', inviteNote: 'Park in the side lot; ring the bell.' }));
    // (while it runs, there is a way to join: what's checked after it is gone)
    {
      const p = await tab(ALEX, 1280, 900);
      await open(p, `#/meetings/${todays.id}`);
      ok(await p.$('main a[href*="meet.google.com"]') !== null, 'R2.4 while it runs: its page has the way to join');
      await p.close();
    }
    await patchMeeting(DB, todays.id, (x) => ({ ...x, ...ended }));
    for (const w of [390, 1280]) {
      const p = await tab(ALEX, w, 900);
      await open(p, '#/');
      const home = await p.evaluate(() => { const c = document.querySelector('.bp-nextup'); return c ? { text: c.innerText.replace(/\n+/g, ' | '), meet: !!c.querySelector('a[href*="meet.google.com"]') } : null; });
      ok(home && /Earlier today/.test(home.text) && !home.meet && !/Google Meet|Join/.test(home.text), `R2.4 ${w}px Home: over, and no way to join it (${home?.text.slice(0, 160)})`);
      await go(p, `#/meetings/${todays.id}`);
      const hero = await p.evaluate(() => { const h = document.querySelector('.bp-aghero'); return h ? { text: h.innerText.replace(/\n+/g, ' | '), meet: !!h.querySelector('a[href*="meet.google.com"]') } : null; });
      ok(hero && /Earlier today/.test(hero.text) && !hero.meet && !/Google Meet|Join/.test(hero.text), `R2.4 ${w}px its page: no Google Meet, no Join (${hero?.text.slice(0, 200)})`);
      ok(!/Add it to my calendar|Google Calendar|Park in the side lot/.test(hero?.text || ''), 'R2.4 its page: no calendar to add it to, no directions to the room');
      ok(!/Write your report/.test(await textOf(p)), 'R2.4 its page: no report asked for once it’s over');
      if (w === 390) await p.screenshot({ path: join(OUT, 'r2-ended-390.png') });
      await p.close();
    }
    const s = await tab(SAM, 1280, 900);
    await open(s, '#/');
    ok(!/Write your report: Year to date/.test(await textOf(s, '.bp-forme')), 'R2.4 Home: Sam isn’t asked for a report on a meeting that’s over');
    await s.close();
    await patchMeeting(DB, todays.id, (x) => ({ ...x, start: hhmm(minsNow - 30), end: hhmm(minsNow + 60), video: '', inviteNote: '' }));
  } else console.log('  (R2.4 needs today’s meeting to have ended: too early in the day in Atlanta to set one, so not checked on this run)');

  // ─── R2.5, R2.6, R2.8: Financials ───
  console.log('R2.5, R2.6, R2.8 Financials');
  for (const w of [390, 1440]) {
    const p = await tab(ALEX, w, 1000);
    await open(p, '#/financials');
    await p.evaluate(() => { for (const d of document.querySelectorAll('main details')) d.open = true; });
    await sleep(600);
    // R2.5
    const costs = await textOf(p, '#costs');
    const under = (await textOf(p, '#costs .bc-under__sum')).trim();
    ok(under && !/\$0 still to come|about \$0/.test(costs) && !(/Not known yet/.test(costs) && /in all/.test(under)), `R2.5 ${w}px: nothing not known said as $0 or added into a sum (${under})`);
    ok(/what’s still to come isn’t known yet/.test(under), `R2.5 ${w}px: the Underway line says what isn’t known (${under})`);
    const fig = await textOf(p, '#costs .bc-answer--money');
    ok(/At least \$125,000 short/.test(fig) && /What the 3 makeovers underway still need isn’t known yet/.test(fig), `R2.5 ${w}px For makeovers now: at least short, the rest not known (${fig.replace(/\n+/g, ' | ')})`);
    if (w === 390) await shot(p, '#costs .bc-under', 'r2-costs-underway-390');
    // R2.6: Financials' mix is of the year's $1,656,045, in kind left out and said so
    const mix = await p.evaluate(() => { const card = document.querySelector('.bp-mixcard'); return card ? { sub: card.querySelector('.bp-sechead__sub, p')?.textContent || card.innerText.split('\n')[1], rows: [...card.querySelectorAll('.bp-mixtable tbody tr')].map((r) => ({ name: r.querySelector('.bp-mixtable__name')?.textContent.trim(), amount: Number((r.querySelector('td.num')?.childNodes[0]?.textContent || '').replace(/[^0-9.]/g, '')) })) } : null; });
    const sum = (mix?.rows || []).reduce((t, r) => t + r.amount, 0);
    ok(mix && sum === 1656045 && !mix.rows.some((r) => /In kind/.test(r.name)), `R2.6 ${w}px Financials: where it came from adds up to the year’s $1,656,045, in kind not one of them (${sum}: ${(mix?.rows || []).map((r) => r.name).join(', ')})`);
    ok(/not counting \$220K in kind/.test(await textOf(p, '.bp-mixcard')), 'R2.6 Financials: its card says what it leaves out');
    // R2.8
    const st = await textOf(p, '.bp-latest');
    ok(!/locked on its day|each meeting’s packet holds/.test(st) && /The latest from QuickBooks/.test(st), `R2.8 ${w}px: the statements said as QuickBooks’ latest (${st.split('\n').slice(0, 2).join(' | ')})`);
    const fold = await p.$eval('.bp-latest details summary', (e) => e.textContent.trim()).catch(() => '');
    ok(/^The statements in the .+ packet, /.test(fold), `R2.8 ${w}px: the packet’s files said as the packet’s (${fold})`);
    if (w === 1440) await shot(p, '.bp-latest', 'r2-statements-1440');
    await p.close();
  }
  for (const w of [390, 1440]) {
    const p = await tab(ALEX, w, 1000);
    await open(p, '#/');
    const home = await p.evaluate(() => { const sp = (t) => String(t || '').replace(/\u00a0/g, ' '); return { tile: sp([...document.querySelectorAll('.bp-fig')].find((f) => /revenue/.test(f.querySelector('.bp-fig__label')?.textContent))?.innerText.replace(/\n+/g, ' | ')), key: [...document.querySelectorAll('.bp-sum__mix .bp-mix__key li')].map((li) => sp(li.innerText.replace(/\n+/g, ' '))), label: sp(document.querySelector('.bp-sum__mix .bp-mix__bar')?.getAttribute('aria-label')) }; });
    const pct = home.key.map((k) => Number((k.match(/(\d+)%/) || [])[1] || 0));
    ok(/\$1\.66M/.test(home.tile) && /Not counting \$220K in kind/.test(home.tile) && !home.key.some((k) => /In kind/.test(k)) && /^Donations \$700K 42%/.test(home.key[0] || '') && Math.abs(pct.reduce((a, b) => a + b, 0) - 100) <= 2,
      `R2.6 ${w}px Home: the shares are of the tile’s $1.66M, in kind left out as the tile leaves it (${home.key.join('; ')})`);
    ok(/not counting \$220,000 in kind/.test(home.label), 'R2.6 Home: a screen reader hears what it leaves out');
    if (w === 390) await shot(p, '.bp-sum__mix', 'r2-mix-390');
    await p.close();
  }

  // ─── R2.7: the board members counted, their faces, and the staff there apart ───
  console.log('R2.7 Who was there');
  {
    const p = await tab(ALEX, 1280, 900);
    await open(p, `#/meetings/${approved.id}`);
    const who = await p.evaluate(() => { const c = document.getElementById('who'); return c ? { big: c.querySelector('.bp-aghero__big')?.textContent.replace(/\u00a0/g, ' '), faces: c.querySelectorAll('.bp-faces .bp-avatar').length + Number((c.querySelector('.bp-faces__more')?.textContent || '0').replace(/\D/g, '')), heard: c.querySelector('.bp-faces')?.getAttribute('aria-label') || '', text: c.innerText.replace(/\n+/g, ' | ') } : null; });
    const n = Number((who?.big || '').match(/^(\d+)/)?.[1]);
    ok(who && n === 5 && who.faces === n, `R2.7 “${who?.big}” over ${who?.faces} faces`);
    ok(!/Jane Doe/.test(who?.heard || '') && /Also there: Jane Doe/.test(who?.text || ''), `R2.7 a screen reader hears the board members counted; Jane Doe (staff) said apart (${who?.heard} | ${who?.text})`);
    await shot(p, '#who', 'r2-who-1280');
    await p.close();
  }

  // ─── R2.9: a long item title on paper ───
  console.log('R2.9 A long item title on paper');
  {
    const p = await tab(ALEX, 1280, 900);
    await open(p, `#/meetings/${approved.id}`);
    await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Print it all/.test(b.textContent))?.click());
    ok(await p.waitForFunction(() => window.__printed > 0, { timeout: 90000 }).then(() => true, () => false), 'R2.9 Print it all opens the print window');
    // (a letter page's width less its margins, as the print window lays it out)
    await p.setViewport({ width: 720, height: 900 });
    await p.emulateMediaType('print');
    await sleep(300);
    const titles = await p.$$eval('.bpp-item__title', (l) => l.map((t) => {
      const num = t.querySelector('.bpp-num');
      const name = [...t.querySelectorAll('span')].find((x) => x.textContent && !x.classList.contains('bpp-num') && !x.classList.contains('bpp-who') && !x.querySelector('span'));
      const who = t.querySelector('.bpp-who');
      const nr = name.getClientRects();
      const first = nr[0];
      const last = nr[nr.length - 1];
      const wr = who ? who.getClientRects() : [];
      // where each of who's lines starts, against the title's left edge: a line of it that starts there starts with "·"
      const lefts = [...wr].map((r) => Math.round(r.left));
      return { t: t.textContent.slice(0, 50), lines: nr.length, numBeside: Math.abs(num.getBoundingClientRect().top - first.top) < 3, whoFollows: !who || Math.abs(wr[0].top - last.top) < 3, whoLineStart: who ? Math.round(wr[0].left) <= Math.round(first.left) + 1 : false, lefts };
    }));
    const long = titles.find((x) => /^2\.2/.test(x.t));
    ok(long && long.lines > 1, `R2.9 the long title wraps at a page’s width (${JSON.stringify(long)})`);
    ok(titles.every((x) => x.numBeside), `R2.9 each number beside its title, never alone on its line (${JSON.stringify(titles.filter((x) => !x.numBeside))})`);
    ok(titles.every((x) => x.whoFollows && !x.whoLineStart), `R2.9 who presents follows on from the title, no line starting “·” (${JSON.stringify(titles.filter((x) => !x.whoFollows || x.whoLineStart))})`);
    await p.pdf({ path: join(OUT, 'r2-print-titles.pdf'), format: 'letter', printBackground: true, pageRanges: '1' });
    await p.emulateMediaType('screen');
    await p.evaluate(() => dispatchEvent(new Event('afterprint')));
    await p.close();
  }

  // ═══ QA round 3 ═══
  const TAYLOR = 'taylor.board@example.net';
  const MARIA = 'maria.board@example.com';
  const samsItem = unshared.sections[1].items[1];
  const alexsItem = unshared.sections[1].items[0];
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
  // The search, as a member uses it: its button, the words typed, each result's words; Escape closes it
  async function search(page, q) {
    await page.evaluate(() => document.querySelector('button.bp-find')?.click());
    await page.waitForSelector('dialog.bp-finder[open] input', { timeout: 15000 });
    await page.$eval('dialog.bp-finder input', (i) => { i.value = ''; });
    await page.focus('dialog.bp-finder input');
    await page.keyboard.type(q, { delay: 8 });
    await sleep(1400);
    return page.$$eval('dialog.bp-finder [role="option"]', (l) => l.map((x) => ({ title: x.querySelector('.bp-finder__title')?.textContent.trim() || '', text: x.innerText.replace(/\s+/g, ' ').trim(), group: x.closest('[role="group"]')?.querySelector('.bp-finder__group span')?.textContent.trim() || '' })));
  }
  const closeSearch = async (page) => { await page.keyboard.press('Escape'); await sleep(500); };

  // ─── R3.2: the mix says what it leaves out wherever it's shown ───
  console.log('R3.2 Where the revenue came from, in kind left out and said so');
  for (const w of [320, 390, 1280]) {
    const p = await tab(ALEX, w, 900);
    await open(p, `#/meetings/${todays.id}`);
    await p.waitForSelector('.bp-agmix .bp-mixhead', { timeout: 20000 }).catch(() => {});
    const head = await p.evaluate(() => { const hd = document.querySelector('.bp-agmix .bp-mixhead'); const sm = hd?.querySelector('small'); const r = sm?.getBoundingClientRect(); return hd ? { text: hd.textContent.replace(/\s+/g, ' ').trim(), seen: !!r && r.width > 0 && r.height > 0 && getComputedStyle(sm).visibility !== 'hidden' } : null; });
    ok(head && /^Where \d{4}’s revenue came from not counting \$220K in kind$/.test(head.text) && head.seen, `R3.2 ${w}px a meeting’s money item: the mix says, in words a reader sees, what it leaves out (${JSON.stringify(head)})`);
    const s = await spill(p);
    ok(s.scroll <= 0 && s.past.length === 0, `R3.2 ${w}px its money item: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
    if (w === 390) await shot(p, '.bp-agmix', 'r3-mix-meeting-390');
    await go(p, '#/');
    const home = await p.evaluate(() => document.querySelector('.bp-sum__mix .bp-mixhead')?.textContent.replace(/\s+/g, ' ').trim() || '');
    ok(/^Where \d{4}’s revenue came from not counting \$220K in kind$/.test(home), `R3.2 ${w}px Home: the same heading (${home})`);
    const hs = await spill(p);
    ok(hs.scroll <= 0 && hs.past.length === 0, `R3.2 ${w}px Home: no sideways scroll, nothing past its card${hs.scroll > 0 || hs.past.length ? ` (scroll ${hs.scroll}; ${hs.past.join('; ')})` : ''}`);
    if (w === 320) await shot(p, '.bp-sum__mix', 'r3-mix-home-320');
    await p.close();
  }
  {
    const p = await tab(ALEX, 1280, 900);
    await open(p, '#/financials');
    const card = await textOf(p, '.bp-mixcard');
    ok((card.match(/not counting \$220K in kind/g) || []).length === 1, `R3.2 Financials: said once, as before (${card.split('\n').slice(0, 2).join(' | ')})`);
    // On paper: Print it all on the meeting with the money item
    await go(p, `#/meetings/${todays.id}`);
    await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
    await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Print it all/.test(b.textContent))?.click());
    ok(await p.waitForFunction(() => window.__printed > 0, { timeout: 90000 }).then(() => true, () => false), 'R3.2 Print it all opens the print window');
    const paper = await p.$$eval('.bpp-mix__h', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /^Where /.test(t)));
    ok(paper.length > 0 && paper.every((t) => /^Where \d{4}’s revenue came from not counting \$220K in kind$/.test(t)), `R3.2 on paper: the mix says what it leaves out (${JSON.stringify(paper)})`);
    await p.emulateMediaType('print');
    await shot(p, '.bpp-mix', 'r3-mix-paper');
    await p.emulateMediaType('screen');
    await p.evaluate(() => dispatchEvent(new Event('afterprint')));
    await p.close();
  }

  // ─── R3.4: a link to a co-presenter's item in a meeting not shared yet ───
  console.log('R3.4 A co-presenter’s item, in a meeting not shared yet');
  for (const [who, item, w] of [[ALEX, samsItem, 320], [ALEX, samsItem, 390], [SAM, alexsItem, 1280]]) {
    const p = await tab(who, w, 900);
    await open(p, `#/meetings/${unshared.id}/report/${item.id}`);
    const page = await textOf(p);
    ok(/That item isn’t one you present/.test(page) && /only the items you present show here/.test(page) && !/isn’t on the agenda any more|Its report went with it/.test(page), `R3.4 ${w}px ${who.split('.')[0]}: never says the item and its report were deleted (${page.replace(/\n+/g, ' | ').slice(0, 200)})`);
    const s = await spill(p);
    ok(s.scroll <= 0 && s.past.length === 0, `R3.4 ${w}px: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
    await p.close();
  }
  {
    // (an item really gone from a meeting the board has still says so)
    const p = await tab(ALEX, 1280, 900);
    await open(p, `#/meetings/${next.id}/report/i_gone00001`);
    ok(/That item isn’t on the agenda any more/.test(await textOf(p)), 'R3.4 an item gone from a shared meeting: still “isn’t on the agenda any more”');
    await p.close();
  }

  // ─── R3.6, R3.7: the search ───
  console.log('R3.6 Search: a presenter’s own items in a meeting not shared yet; R3.7 “awaiting funding”');
  {
    const sam = await tab(SAM, 1280, 900);
    await open(sam, '#/');
    for (const q of ['Building fund numbers', 'what came in this fall', 'special meeting building fund']) {
      const res = await search(sam, q);
      ok(res.some((r) => r.title === 'Building fund numbers' && r.group === 'In agendas and minutes'), `R3.6 Sam searches “${q}”: his own item in the meeting not shared yet (${res.slice(0, 4).map((r) => `${r.group}: ${r.title}`).join('; ') || 'nothing'})`);
      if (q === 'special meeting building fund') ok(res.some((r) => r.group === 'Meetings' && r.title === 'Special Meeting on the Building Fund'), 'R3.6 …and the meeting itself, as For you links to it');
      ok(!res.some((r) => r.title === 'Where the building fund stands' || r.title === 'Roll call' && /Special Meeting/.test(r.text)), `R3.6 Sam never finds what isn’t his in it (${res.map((r) => r.title).join('; ')})`);
      await closeSearch(sam);
    }
    // Chosen: it lands on his item on the meeting's page
    await search(sam, 'Building fund numbers');
    await sam.evaluate(() => [...document.querySelectorAll('dialog.bp-finder [role="option"]')].find((o) => o.querySelector('.bp-finder__title')?.textContent.trim() === 'Building fund numbers')?.click());
    await sam.waitForFunction((id) => document.getElementById(`i-${id}`)?.classList.contains('is-found'), { timeout: 10000 }, samsItem.id).catch(() => {});
    ok(await sam.evaluate((id) => location.hash.includes(id) === false && !!document.getElementById(`i-${id}`)?.classList.contains('is-found'), samsItem.id) && (await sam.evaluate(() => location.hash)) === `#/meetings/${unshared.id}`, `R3.6 chosen, it lands on his item on the meeting’s page (${await sam.evaluate(() => location.hash)})`);
    await sam.close();
    const alex = await tab(ALEX, 390, 900);
    await open(alex, '#/');
    let res = await search(alex, 'Building fund numbers');
    ok(!res.some((r) => r.title === 'Building fund numbers'), `R3.6 Alex never finds Sam’s item (${res.slice(0, 4).map((r) => r.title).join('; ') || 'nothing'})`);
    await closeSearch(alex);
    res = await search(alex, 'where the building fund stands');
    ok(res.some((r) => r.title === 'Where the building fund stands' && r.group === 'In agendas and minutes'), `R3.6 Alex finds his own (${res.slice(0, 4).map((r) => r.title).join('; ') || 'nothing'})`);
    await closeSearch(alex);
    // R3.7: the makeover waiting on funding (no page up, so not named), and what makeovers cost
    for (const q of ['awaiting funding', 'awaiting']) {
      res = await search(alex, q);
      ok(res.some((r) => r.group === 'Makeovers' && r.title === 'Awaiting funding: 1 family') && res.some((r) => r.title === 'What makeovers cost'), `R3.7 “${q}” finds the makeover awaiting funding and What makeovers cost (${res.slice(0, 6).map((r) => `${r.group}: ${r.title}`).join('; ') || 'nothing'})`);
      await closeSearch(alex);
    }
    await search(alex, 'awaiting funding');
    await alex.evaluate(() => [...document.querySelectorAll('dialog.bp-finder [role="option"]')].find((o) => o.querySelector('.bp-finder__title')?.textContent.trim() === 'Awaiting funding: 1 family')?.click());
    await alex.waitForFunction(() => document.getElementById('lc-col-funding')?.classList.contains('is-found'), { timeout: 12000 }).catch(() => {});
    ok(await alex.evaluate(() => location.hash === '#/' && !!document.getElementById('lc-col-funding')?.classList.contains('is-found')), 'R3.7 chosen, it lands on the Awaiting funding column of Home’s makeovers board');
    await shot(alex, '#makeovers', 'r3-awaiting-landed-390');
    // (the results fit a 320 phone: nothing past the search's own edge)
    await alex.setViewport({ width: 320, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await sleep(400);
    await search(alex, 'awaiting funding');
    const fits = await alex.evaluate(() => { const dlg = document.querySelector('dialog.bp-finder'); const edge = Math.min(innerWidth, dlg.getBoundingClientRect().right); return { scroll: dlg.scrollWidth - dlg.clientWidth, past: [...dlg.querySelectorAll('[role="option"] *')].filter((e) => e.getBoundingClientRect().right > edge + 1).map((e) => e.textContent.trim().slice(0, 30)) }; });
    ok(fits.scroll <= 0 && fits.past.length === 0, `R3.7 320px: the results fit the search (${JSON.stringify(fits)})`);
    await alex.screenshot({ path: join(OUT, 'r3-awaiting-search-320.png') });
    await closeSearch(alex);
    await alex.close();
    const maria = await tab(MARIA, 1280, 900);
    await open(maria, '#/');
    res = await search(maria, 'building fund');
    ok(!res.some((r) => /Building fund numbers|Where the building fund stands|Special Meeting on the Building Fund/.test(r.title)), `R3.6 Maria, who presents nothing in it, finds none of it (${res.map((r) => r.title).join('; ') || 'nothing'})`);
    await maria.close();
  }

  // ─── R3.5: changed while you were writing, by you elsewhere ───
  console.log('R3.5 The same member in two tabs');
  {
    const route = `#/meetings/${unshared.id}/report/${samsItem.id}`;
    const editor = '.bp-rp [contenteditable="true"], .bp-rp textarea.rp-edit';
    const A = await tab(SAM, 1280, 900);
    const B = await tab(SAM, 390, 900);
    await open(A, route);
    await open(B, route);
    await A.bringToFront();
    await A.click(editor);
    await A.keyboard.type('Alpha from the first tab. ', { delay: 10 });
    await sleep(3500);
    await B.bringToFront();
    await B.click(editor);
    await B.keyboard.type('Bravo from the second tab. ', { delay: 10 });
    await B.waitForSelector('.bp-rp__clash[role="alert"]', { timeout: 15000 }).catch(() => {});
    const box = await B.evaluate(() => { const c = document.querySelector('.bp-rp__clash[role="alert"]'); return c ? { text: c.innerText.replace(/\s+/g, ' ').trim(), buttons: [...c.querySelectorAll('button, summary')].map((b) => b.textContent.trim()) } : null; });
    ok(box && /^You changed this report at \d{1,2}:\d{2} [AP]M in another tab or on another device while you were writing here\./.test(box.text) && !/Sam Ortiz changed|Sam’s version|theirs/i.test(box.text) && box.buttons.join('|') === 'See the other one|Use the other one|Keep this one', `R3.5 the same member in another tab: “You changed this report…”, never named as someone else (${JSON.stringify(box)})`);
    const s = await spill(B);
    ok(s.scroll <= 0 && s.past.length === 0, `R3.5 390px the box: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
    await shot(B, '.bp-rp__clash', 'r3-same-member-390');
    await B.setViewport({ width: 320, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await sleep(500);
    const s320 = await spill(B);
    ok(s320.scroll <= 0 && s320.past.length === 0, `R3.5 320px the box: no sideways scroll, nothing past its card${s320.scroll > 0 || s320.past.length ? ` (scroll ${s320.scroll}; ${s320.past.join('; ')})` : ''}`);
    // Someone else (Board's founder, writing it in Board) is still named
    await patchMeeting(DB, unshared.id, (x) => ({ ...x, sections: x.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.id === samsItem.id ? { ...it, report: 'Jane’s words on it.', reportBy: 'Jane Doe', reportAt: new Date().toISOString() } : it)) })) }));
    await A.bringToFront();
    await A.click(editor);
    await A.keyboard.type('More from the first tab. ', { delay: 10 });
    await A.waitForSelector('.bp-rp__clash[role="alert"]', { timeout: 15000 }).catch(() => {});
    const other = await A.evaluate(() => document.querySelector('.bp-rp__clash[role="alert"]')?.innerText.replace(/\s+/g, ' ').trim() || '');
    ok(/^Jane Doe changed this report at \d{1,2}:\d{2} [AP]M while you were writing\./.test(other) && /Use theirs/.test(other) && /Keep mine/.test(other), `R3.5 someone else is still named (${other.slice(0, 160)})`);
    // (what each tab kept on this device goes, so the pages after start from what's saved)
    await A.evaluate(() => localStorage.clear());
    await A.close();
    await B.close();
    // The motion: who changed it isn't kept, so never "someone else"
    const C = await tab(SAM, 1280, 900);
    const D = await tab(SAM, 390, 900);
    await open(C, route);
    await open(D, route);
    const ask = async (page, words) => {
      await page.bringToFront();
      await page.evaluate(() => document.querySelector('.bp-rp__motion-add')?.click());
      await page.waitForSelector('#rp-motion', { timeout: 10000 });
      await page.type('#rp-motion', words, { delay: 8 });
      await page.keyboard.press('Enter');
      await sleep(2500);
    };
    await ask(C, 'Approve the building fund plan');
    await ask(D, 'Approve a smaller plan');
    const motion = await D.evaluate(() => { const c = document.querySelector('.bp-rp__motion-clash'); return c ? { text: c.innerText.replace(/\s+/g, ' ').trim(), buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null; });
    ok(motion && /^The motion was changed somewhere else while you were writing: in another tab, on another device or by someone else\./.test(motion.text) && /The other one: “Approve the building fund plan”/.test(motion.text) && !/Someone else changed|Theirs/.test(motion.text) && motion.buttons.join('|') === 'Use the other one|Keep this one', `R3.5 the motion box: never “someone else” when it can’t know (${JSON.stringify(motion)})`);
    const ms = await spill(D);
    ok(ms.scroll <= 0 && ms.past.length === 0, `R3.5 390px the motion box: no sideways scroll, nothing past its card${ms.scroll > 0 || ms.past.length ? ` (scroll ${ms.scroll}; ${ms.past.join('; ')})` : ''}`);
    await D.evaluate(() => document.querySelector('.bp-rp__motion-clash')?.scrollIntoView({ block: 'center' }));
    await D.screenshot({ path: join(OUT, 'r3-motion-390.png') });
    await D.setViewport({ width: 320, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await sleep(500);
    const m320 = await spill(D);
    ok(m320.scroll <= 0 && m320.past.length === 0, `R3.5 320px the motion box: no sideways scroll, nothing past its card${m320.scroll > 0 || m320.past.length ? ` (scroll ${m320.scroll}; ${m320.past.join('; ')})` : ''}`);
    await C.evaluate(() => localStorage.clear());
    await C.close();
    await D.close();
  }

  // ─── R3.8: What makeovers cost on a phone, each cell labeled ───
  console.log('R3.8 What makeovers cost, underway, on a phone');
  for (const w of [320, 390, 1280]) {
    const p = await tab(ALEX, w, 900);
    await open(p, '#/financials');
    await p.evaluate(() => { for (const d of document.querySelectorAll('main details')) d.open = true; });
    await p.waitForSelector('.bc-under__table tbody tr', { timeout: 20000 }).catch(() => {});
    await sleep(500);
    const rows = await p.$$eval('.bc-under__table tbody tr', (l) => l.map((tr) => { const from = tr.querySelector('td.bc-under__from'); const before = from ? getComputedStyle(from, '::before').content : ''; return { text: tr.innerText.replace(/\s+/g, ' ').trim(), notKnown: (tr.innerText.match(/Not known yet/g) || []).length, label: from?.getAttribute('data-label') || '', before }; }));
    const phone = w <= 640;
    ok(rows.length > 0 && rows.every((r) => r.notKnown <= 1 && r.label === 'From' && (!phone || r.before === '"From"')), `R3.8 ${w}px: each underway row says “Not known yet” once and its From is labeled${phone ? ' on the phone' : ''} (${JSON.stringify(rows.slice(0, 2))})`);
    const s = await spill(p);
    ok(s.scroll <= 0 && s.past.length === 0, `R3.8 ${w}px Financials: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
    if (w === 390) await shot(p, '.bc-under', 'r3-costs-underway-390');
    await p.close();
  }

  // ─── R3.3, R3.9: today's meeting after the chair pressed End ───
  console.log('R3.3, R3.9 After the chair presses End');
  {
    // (while it's still ahead or on: the address is a way there)
    {
      const p = await tab(ALEX, 1280, 900);
      await open(p, '#/');
      ok(await p.$('.bp-nextup a[href*="google.com/maps"]') !== null, 'R3.9 before it’s over: Home’s card links the address to the map');
      await p.close();
    }
    await patchMeeting(DB, todays.id, (x) => ({ ...x, live: { ...x.live, startedAt: isoAgo(25 * 60_000), endedAt: isoAgo(5 * 60_000), itemId: '', screen: '' } }));
    for (const [who, w] of [[SAM, 390], [MARIA, 1280], [SAM, 320]]) {
      const p = await tab(who, w, 900);
      await open(p, `#/meetings/${todays.id}`);
      await p.waitForSelector('.bp-livehead.is-ended', { timeout: 20000 }).catch(() => {});
      const room = await p.evaluate(() => ({ title: document.getElementById('now-h')?.textContent.trim() || '', here: document.querySelector('.bp-livehead__here')?.innerText.replace(/\s+/g, ' ').trim() || '', decisions: document.querySelector('[aria-labelledby="dec-h"]')?.innerText.replace(/\s+/g, ' ').trim() || '', all: document.querySelector('main')?.innerText || '' }));
      ok(room.title && room.title !== 'Thank you for being here' && !/Thank you for being here/.test(room.all), `R3.3 ${w}px ${who.split('.')[0]}, who never checked in: no thanks for being there (“${room.title}”)`);
      ok(/^0 of 6 board members checked in$/.test(room.here) && !/more for a quorum/i.test(room.all), `R3.3 ${w}px: who checked in, never the live count or how many more for a quorum (${room.here})`);
      ok(!/as the board makes them/.test(room.decisions) && /No votes were taken here/.test(room.decisions), `R3.3 ${w}px: Decisions in the past tense (${room.decisions})`);
      const s = await spill(p);
      ok(s.scroll <= 0 && s.past.length === 0, `R3.3 ${w}px the ended room: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
      if (w === 390) await p.screenshot({ path: join(OUT, 'r3-ended-room-390.png') });
      // R3.9 Home's card, ended by the chair: the place said, never a map link
      await go(p, '#/');
      const home = await p.evaluate(() => { const c = document.querySelector('.bp-nextup'); return c ? { text: c.innerText.replace(/\s+/g, ' '), maps: !!c.querySelector('a[href*="google.com/maps"]') } : null; });
      ok(home && /Earlier today/.test(home.text) && /Example Hall/.test(home.text) && !home.maps, `R3.9 ${w}px Home, ended by the chair: where it was, with no directions (${home?.text.slice(0, 120)})`);
      await p.close();
    }
    // Who checked in: thanked, in the past tense
    await DB.prepare('INSERT OR REPLACE INTO board_checkins (meeting_id, slug, name, how, at) VALUES (?, ?, ?, ?, ?)').bind(todays.id, 'alex-rivera', 'Alex Rivera', 'present', isoAgo(20 * 60_000)).run();
    {
      const p = await tab(ALEX, 1280, 900);
      await open(p, `#/meetings/${todays.id}`);
      await p.waitForSelector('.bp-livehead.is-ended', { timeout: 20000 }).catch(() => {});
      const room = await p.evaluate(() => ({ title: document.getElementById('now-h')?.textContent.trim() || '', here: document.querySelector('.bp-livehead__here')?.innerText.replace(/\s+/g, ' ').trim() || '', me: document.querySelector('.bp-here')?.innerText.trim() || '' }));
      ok(room.title === 'Thank you for being here' && room.me === 'You were here, in the room.' && /^1 of 6 board members checked in$/.test(room.here), `R3.3 Alex, who checked in: thanked, in the past tense (${JSON.stringify(room)})`);
      await p.close();
    }
    await DB.prepare('DELETE FROM board_checkins WHERE meeting_id = ?').bind(todays.id).run();
    await patchMeeting(DB, todays.id, (x) => ({ ...x, live: { ...x.live, startedAt: '', endedAt: '' } }));
    // R3.9 the meeting's page once it's over by the clock, and a meeting held weeks ago: the place said, never a map link
    if (minsNow >= 95) {
      await patchMeeting(DB, todays.id, (x) => ({ ...x, start: hhmm(minsNow - 90), end: hhmm(minsNow - 15) }));
      for (const w of [320, 390, 1280]) {
        const p = await tab(SAM, w, 900);
        await open(p, `#/meetings/${todays.id}`);
        const hero = await p.evaluate(() => { const h = document.querySelector('.bp-aghero__facts'); return h ? { text: h.innerText.replace(/\s+/g, ' '), maps: !!h.querySelector('a[href*="google.com/maps"]') } : null; });
        ok(hero && /Earlier today|Example Hall/.test(hero.text) && /100 Example Street/.test(hero.text) && !hero.maps, `R3.9 ${w}px its page, over by the clock: the address said, no directions (${hero?.text})`);
        const hs = await spill(p);
        ok(hs.scroll <= 0 && hs.past.length === 0, `R3.9 ${w}px its page: no sideways scroll, nothing past its card${hs.scroll > 0 || hs.past.length ? ` (scroll ${hs.scroll}; ${hs.past.join('; ')})` : ''}`);
        await go(p, '#/');
        ok(!(await p.$('.bp-nextup a[href*="google.com/maps"]')), `R3.9 ${w}px Home, over by the clock: no directions`);
        await p.close();
      }
      await patchMeeting(DB, todays.id, (x) => ({ ...x, start: hhmm(minsNow - 30), end: hhmm(minsNow + 60) }));
    } else console.log('  (R3.9 by the clock needs today’s meeting to have ended: too early in the day in Atlanta to set one, so not checked on this run)');
    {
      const p = await tab(SAM, 390, 900);
      await open(p, `#/meetings/${approved.id}`);
      const hero = await p.evaluate(() => { const h = document.querySelector('.bp-aghero__facts'); return h ? { text: h.innerText.replace(/\s+/g, ' '), maps: !!h.querySelector('a[href*="google.com/maps"]') } : null; });
      ok(hero && /Example Hall/.test(hero.text) && /100 Example Street/.test(hero.text) && !hero.maps, `R3.9 a meeting held weeks ago: where it was, no directions (${hero?.text})`);
      await p.close();
    }
  }

  // ─── R3.1: what's new stays new while a member reads one page past the visit's gap ───
  console.log('R3.1 New stays new while a member reads one page');
  {
    // Taylor's visit before this one, three days ago; the server's clock moved on while the page stays open (its tracker
    // reports as it does each minute; the page reads itself again only when its tab comes back)
    await DB.prepare('INSERT OR REPLACE INTO board_seen (slug, at) VALUES (?, ?)').bind('taylor-nguyen', isoAgo(3 * 864e5)).run();
    const realNow = Date.now;
    let ahead = 0;
    const p = await tab(TAYLOR, 1280, 900);
    try {
      await open(p, '#/financials/gifts');
      const news = () => p.$$eval('main .bp-gift__new', (l) => l.length);
      const n0 = await news();
      ok(n0 > 0, `R3.1 Taylor opens the gifts: ${n0} marked New`);
      Date.now = () => realNow.call(Date) + ahead;
      // Forty minutes on the page, reading and scrolling
      for (let k = 1; k <= 4; k++) {
        ahead += 10 * 60_000;
        await p.bringToFront();
        await p.keyboard.press('ArrowDown');
        await p.mouse.wheel({ deltaY: k % 2 ? 300 : -300 });
        await sleep(2500);
        const sent = p.waitForResponse((r) => r.url().includes('/api/board-portal') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
        await p.evaluate(() => window.__boardActivity?.flush());
        const r = await sent;
        ok(!!r && r.ok(), `R3.1 the page’s tracker reports at ${k * 10} minutes (${r ? r.status() : 'nothing sent'})`);
      }
      // Over to another tab a moment and back: the page reads itself again
      await sleep(10500);
      const read = p.waitForResponse((r) => /\/api\/board-portal$/.test(r.url()) && r.request().method() === 'GET', { timeout: 15000 }).catch(() => null);
      await p.evaluate(() => dispatchEvent(new Event('focus')));
      await read;
      await sleep(1200);
      const n1 = await news();
      ok(n1 === n0, `R3.1 back to the tab forty minutes on, still reading: still ${n0} New (${n1})`);
      // Away longer than the gap, the tab in the background: back, a new visit (what was new is seen)
      const other = await tab(TAYLOR, 1280, 900);
      await other.bringToFront();
      await sleep(1500);
      ahead += 31 * 60_000;
      await sleep(9500);
      await p.bringToFront();
      const again = p.waitForResponse((r) => /\/api\/board-portal$/.test(r.url()) && r.request().method() === 'GET', { timeout: 15000 }).catch(() => null);
      await p.evaluate(() => dispatchEvent(new Event('focus')));
      await again;
      await sleep(1200);
      ok(await news() === 0, `R3.1 back after more than thirty minutes away: a new visit, nothing marked New (${await news()})`);
      await other.close();
    } finally {
      Date.now = realNow;
      await p.close();
    }
  }

  // ─── R3.10 (with the Board server's m5): the chair approves, and Resend refuses the agenda's email ───
  console.log('R3.10 The chair approves; the agenda’s email doesn’t go');
  {
    // The server's answers, stubbed here (its side is the server fixer's): the chair's review of the next meeting, and
    // what approving answers. Alex is the chair for it
    const REFUSED = 'The agenda is approved. Resend said no to these emails, so they didn’t go. Board tries again by itself in a few minutes, or press Email the board.';
    for (const [answer, want, w] of [
      [{ agenda: 'failed', agendaError: REFUSED }, (t) => t === REFUSED, 320],
      [{ agenda: 'failed', agendaError: REFUSED }, (t) => t === REFUSED, 390],
      [{ agenda: 'sent' }, (t) => t === 'The agenda is approved and on its way to the board.', 1280],
      [{ agenda: 'waiting' }, (t) => t === 'The agenda is approved. The board gets it as soon as they’ve had the email on how to sign in.', 390],
      // (one founder on the test's Board, so “gets”: Peter and Holly “get”)
      [{ agenda: '' }, (t) => t === 'The agenda is approved. Jane gets word by email.', 1280],
    ]) {
      const p = await tab(ALEX, w, 900);
      await p.setRequestInterception(true);
      p.on('request', async (req) => {
        try {
          const u = new URL(req.url());
          if (u.pathname !== '/api/board-portal') return await req.continue();
          if (req.method() === 'GET' && !u.search) {
            const j = await (await fetch(`${SITE}/api/board-portal`, { headers: { 'x-test-user': ALEX } })).json();
            j.people.board = j.people.board.map((x) => (x.slug === 'alex-rivera' ? { ...x, seat: 'chair' } : x));
            j.review = { meeting: j.meetings.find((x) => x.id === next.id), sentAt: '', approvedAt: '', approvedBy: '', notes: {}, questions: [], reports: [] };
            return await req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
          }
          if (req.method() === 'POST' && /"chair-approve"/.test(req.postData() || '')) return await req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, approvedAt: new Date().toISOString(), approvedBy: 'Alex Rivera', ...answer }) });
          return await req.continue();
        } catch { /* (the page already gone) */ }
      });
      await open(p, `#/meetings/${next.id}/review`);
      await p.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Approve the agenda')?.click());
      await p.waitForSelector('.bp-toast.is-on', { timeout: 10000 }).catch(() => {});
      const toast = await p.evaluate(() => { const t = document.querySelector('.bp-toast.is-on'); if (!t) return null; const r = t.getBoundingClientRect(); return { text: t.textContent.replace(/\s+/g, ' ').trim(), inside: r.left >= 0 && r.right <= document.documentElement.clientWidth, warn: t.classList.contains('bp-toast--warn') }; });
      ok(toast && want(toast.text) && toast.inside && toast.warn === (answer.agenda === 'failed'), `R3.10 ${w}px the chair approves, the server answering ${JSON.stringify(answer.agenda)}: “${toast?.text}”${toast && !toast.inside ? ' (PAST THE WINDOW)' : ''}`);
      if (w <= 390) { await sleep(500); await p.screenshot({ path: join(OUT, `r3-chair-${answer.agenda || 'usual'}-${w}.png`) }); }
      // (time to read it: a short note goes in 4.5 s, a long one stays as long as its words take to read)
      if (answer.agenda === 'failed') {
        await sleep(5500);
        ok(await p.evaluate((t) => document.querySelector('.bp-toast.is-on')?.textContent.replace(/\s+/g, ' ').trim() === t, REFUSED), `R3.10 ${w}px the refused send’s words are still there 5.5 s on, time to read them`);
      }
      await p.close();
    }
  }

  // ─── 4 and the sweep: every page at every width ───
  console.log('Every page at every width');
  // (a paper's own page: the first one Documents links to)
  const paperHash = await (async () => { const p = await tab(ALEX); await open(p, '#/documents'); const h = await p.evaluate(() => [...document.querySelectorAll('main a[href^="#/documents/d_"]')].map((a) => a.getAttribute('href'))[0] || ''); await p.close(); return h; })();
  ok(!!paperHash, `a paper to open (${paperHash})`);
  const pages = [['home', '#/'], ['meetings', '#/meetings'], ['held', `#/meetings/${approved.id}`], ['unwritten', `#/meetings/${unwritten.id}`], ['background', `#/meetings/${background.id}`], ['filed', `#/meetings/${filed.id}`], ['today', `#/meetings/${todays.id}`], ['ahead', `#/meetings/${next.id}`], ['financials', '#/financials'], ['gifts', '#/financials/gifts'], ['people', '#/people'], ['documents', '#/documents'], ['a paper', paperHash || '#/documents']];
  for (const w of [320, 375, 390, 768, 1024, 1440]) {
    const p = await tab(ALEX, w, 900);
    await open(p, '#/');
    for (const [name, hash] of pages) {
      await go(p, hash);
      await p.evaluate(() => { for (const d of document.querySelectorAll('main details')) d.open = true; });
      await sleep(500);
      const s = await spill(p);
      ok(s.scroll <= 0 && s.past.length === 0, `${w}px ${name}: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
      if (w === 320 && name === 'documents') {
        const file = await p.evaluate(() => { const t = [...document.querySelectorAll('.bp-file__title')].find((x) => /Supercalifragilistic/.test(x.textContent)); const card = t?.closest('.bp-card'); return t && card ? { inside: t.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5 } : null; });
        ok(file?.inside, 'Documents at 320: the long file name wraps inside its card');
        await shot(p, await p.evaluateHandle(() => [...document.querySelectorAll('.bp-file__title')].find((x) => /Supercalifragilistic/.test(x.textContent))?.closest('.bp-card')), 'documents-320');
      }
      if (w === 1440 && name !== 'financials' && name !== 'home') ok((await dashes(p)).length === 0, `${name}: no en or em dash anywhere (${JSON.stringify(await dashes(p))})`);
    }
    await p.close();
  }
  // (Sam, who presents in the meeting not shared yet: his Home and its page)
  for (const w of [320, 375, 390, 768, 1024, 1440]) {
    const p = await tab(SAM, w, 900);
    await open(p, '#/');
    for (const [name, hash] of [['Sam’s home', '#/'], ['not shared yet', `#/meetings/${unshared.id}`], ['his report', `#/meetings/${unshared.id}/report/${unshared.sections[1].items[1].id}`]]) {
      await go(p, hash);
      const s = await spill(p);
      ok(s.scroll <= 0 && s.past.length === 0, `${w}px ${name}: no sideways scroll, nothing past its card${s.scroll > 0 || s.past.length ? ` (scroll ${s.scroll}; ${s.past.join('; ')})` : ''}`);
      if (w === 1440) ok((await dashes(p)).length === 0, `${name}: no en or em dash anywhere (${JSON.stringify(await dashes(p))})`);
    }
    await p.close();
  }
  // ─── After round 3: the presenting screen's money item with its presenter's notes never draws one over another ───
  console.log('The presenting screen: the money, the mix and the notes, never over each other');
  {
    const money = await meeting({ date: day(0), start: hhmm(minsNow - 30), end: hhmm(minsNow + 60), location: 'Example Hall', shared: true,
      attendance: everyone.map((s) => ({ ...board('')(s), rsvp: '' })),
      sections: [{ title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash', notes: '- Revenue against budget\n- Cash over the next 13 weeks' }] }],
      agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
    });
    for (const [w, h, roomy] of [[1920, 1080, false], [1280, 720, false], [1366, 768, false], [1920, 1600, true]]) {
      const p = await tab(FOUNDER, w, h);
      await p.goto(`${SITE}/admin/board/?present#/meetings/${money.id}/screen`, { waitUntil: 'networkidle0' });
      for (let i = 0; i < 12 && !(await p.evaluate(() => !!document.querySelector('.bs-money'))); i++) { await p.keyboard.press('ArrowRight'); await sleep(600); }
      await sleep(2500);
      const lay = await p.evaluate(() => {
        const seen = (e) => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
        const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        const cut = (a, b) => a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right - 0.5 && b.left < a.right - 0.5;
        const parts = [...document.querySelectorAll('.bs-money .bs-figs li, .bs-money .bs-mix')].filter(seen).map(r);
        const notes = [...document.querySelectorAll('.bs-item__body :is(li, p)')].filter(seen).map(r);
        const stage = document.querySelector('.bs-stage').getBoundingClientRect();
        return { parts: parts.length, notes: notes.length, over: notes.some((n) => parts.some((q) => cut(n, q))), inside: [...parts, ...notes].every((x) => x.bottom <= stage.bottom + 0.5), mix: seen(document.querySelector('.bs-mix')) };
      });
      ok(lay.notes === 2 && lay.parts >= 4 && !lay.over && lay.inside, `${w}×${h} the money item: its notes and the figures${lay.mix ? ' and the mix' : ''} each in their own place, inside the screen (${JSON.stringify(lay)})`);
      if (roomy) ok(lay.mix, `${w}×${h} with room for it, where the revenue came from shows too`);
      if (w === 1920 && h === 1080) await p.screenshot({ path: join(OUT, 'screen-money-notes-1920.png') });
      await p.close();
    }
  }

  // ─── After round 4: longer notes on the money item. The figures give way first (closer, the documents, the mix),
  // then the notes (smaller, then fewer, the rest said to be on the board page): never drawn over the figures ───
  console.log('The presenting screen: long notes on the money item');
  {
    const LONG = [
      'Revenue against budget, line by line, with the gala and the store against what we planned in January',
      'Cash over the next 13 weeks, and the lowest week ahead',
      'Why expenses are behind the budget this year',
      'Questions from the finance committee',
      'What the auditor asked for, and when it is due',
      'The reserve policy, and where we stand against it',
    ];
    for (const [count, sizes] of [[4, [[1280, 720], [1366, 768], [1920, 1080]]], [6, [[960, 540], [1440, 900], [1600, 900], [2560, 1440], [1280, 720]]]]) {
      const money = await meeting({ date: day(0), start: hhmm(minsNow - 30), end: hhmm(minsNow + 60), location: 'Example Hall', shared: true,
        attendance: everyone.map((s) => ({ ...board('')(s), rsvp: '' })),
        sections: [{ title: 'Finance', items: [{ title: 'Year to date', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live: 'cash', notes: LONG.slice(0, count).map((x) => `- ${x}`).join('\n') }] }],
        agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
      });
      for (const [w, h] of sizes) {
        const p = await tab(FOUNDER, w, h);
        await p.goto(`${SITE}/admin/board/?present#/meetings/${money.id}/screen`, { waitUntil: 'networkidle0' });
        for (let i = 0; i < 12 && !(await p.evaluate(() => !!document.querySelector('.bs-money'))); i++) { await p.keyboard.press('ArrowRight'); await sleep(600); }
        await sleep(2500);
        const lay = await p.evaluate(() => {
          const seen = (e) => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
          const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
          const cut = (a, b) => a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right - 0.5 && b.left < a.right - 0.5;
          const parts = [...document.querySelectorAll('.bs-money .bs-figs li, .bs-money .bs-mix')].filter(seen).map(r);
          const points = [...document.querySelectorAll('.bs-item__body .bs-points li')];
          const shown = points.filter(seen);
          const more = document.querySelector('.bs-item__body .bs-points__more');
          const cell = document.querySelector('.bs-item--facts > .bs-item__facts');
          const stage = document.querySelector('.bs-stage').getBoundingClientRect();
          const said = seen(more) ? Number((more.textContent.match(/^(\d+) more on the board page$/) || [])[1] || NaN) : 0;
          return {
            parts: parts.length, shown: shown.length, of: points.length, said,
            over: [...shown, ...(seen(more) ? [more] : [])].map(r).some((n) => parts.some((q) => cut(n, q))),
            squeezed: !!cell && cell.scrollHeight > cell.clientHeight + 1,
            inside: [...parts, ...shown.map(r)].every((x) => x.bottom <= stage.bottom + 0.5),
          };
        });
        ok(lay.parts >= 4 && lay.shown >= 1 && !lay.over && !lay.squeezed && lay.inside && lay.shown + lay.said === lay.of,
          `${w}×${h} ${count} long notes on the money item: none drawn over the figures, every one shown or said to be on the board page, inside the screen (${JSON.stringify(lay)})`);
        if (count === 4 && w === 1920) await p.screenshot({ path: join(OUT, 'screen-money-long-notes-1920.png') });
        await p.close();
      }
    }
  }

  // ─── After round 5: notes written as one point with its own points under it, or one paragraph, give way too (by
  // sub-point, by sentence, then at a whole line with the rest said to be on the board page), on the money item and on
  // a board slide (the makeovers) alike ───
  console.log('The presenting screen: notes as one point, or one paragraph');
  {
    const LINES = [
      'Revenue against budget, line by line, with the gala and the store against what we planned in January.',
      'Cash over the next 13 weeks, and the lowest week ahead.',
      'Why expenses are behind the budget this year.',
      'Questions from the finance committee.',
      'What the auditor asked for, and when it is due.',
      'The reserve policy, and where we stand against it.',
      'The insurance renewal, and what it costs this year.',
      'What the board is asked to approve today.',
    ];
    const shapes = [
      ['one point, 4 under it', 'cash', `- The money this quarter\n${LINES.slice(0, 4).map((x) => `  - ${x}`).join('\n')}`, [[1920, 1080], [1280, 720]]],
      ['one point, 8 under it', 'cash', `- The money this quarter\n${LINES.map((x) => `  - ${x}`).join('\n')}`, [[1280, 720], [960, 540], [1440, 900], [1920, 1080]]],
      ['one paragraph', 'cash', LINES.join(' '), [[1280, 720], [960, 540]]],
      ['makeovers, one point, 6 under it', 'projects', `- Where every makeover stands\n${LINES.slice(0, 6).map((x) => `  - ${x}`).join('\n')}`, [[1280, 720], [1920, 1080]]],
    ];
    for (const [name, live, notes, sizes] of shapes) {
      const m = await meeting({ date: day(0), start: hhmm(minsNow - 30), end: hhmm(minsNow + 60), location: 'Example Hall', shared: true,
        attendance: everyone.map((s) => ({ ...board('')(s), rsvp: '' })),
        sections: [{ title: 'Finance', items: [{ title: live === 'cash' ? 'Year to date' : 'Makeovers in progress', presenter: 'Sam Ortiz', who: ['sam-ortiz'], live, notes }] }],
        agendaFrom: { kind: 'typed', name: '', at: new Date().toISOString() },
      });
      for (const [w, h] of sizes) {
        const p = await tab(FOUNDER, w, h);
        await p.goto(`${SITE}/admin/board/?present#/meetings/${m.id}/screen`, { waitUntil: 'networkidle0' });
        const sel = live === 'cash' ? '.bs-money' : '.bs-item--board .bs-points';
        for (let i = 0; i < 12 && !(await p.evaluate((x) => !!document.querySelector(x), sel)); i++) { await p.keyboard.press('ArrowRight'); await sleep(600); }
        await sleep(2500);
        const lay = await p.evaluate(() => {
          const seen = (e) => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
          const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
          const cut = (a, b) => a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right - 0.5 && b.left < a.right - 0.5;
          const box = document.querySelector('.bs-points');
          const parts = [...document.querySelectorAll('.bs-money .bs-figs li, .bs-money .bs-mix')].filter(seen).map(r);
          const units = [...box.querySelectorAll('li, .bs-points__s')];
          const shown = units.filter(seen);
          const more = box.querySelector('.bs-points__more');
          const said = seen(more) ? more.textContent.trim() : '';
          const n = Number((said.match(/^(\d+) more on the board page$/) || [])[1] || 0);
          const clamped = !!box.querySelector('.is-clamped') && said === 'The rest is on the board page.';
          const stage = document.querySelector('.bs-stage').getBoundingClientRect();
          const bar = document.querySelector('.bs-stage .bs-item__bar')?.getBoundingClientRect();
          const cell = document.querySelector('.bs-item--facts > .bs-item__facts');
          const boxR = box.getBoundingClientRect();
          return {
            parts: parts.length, shown: shown.length, of: units.length, said,
            told: shown.length + n === units.length || clamped,
            over: [...shown, ...(seen(more) ? [more] : [])].map(r).some((x) => parts.some((q) => cut(x, q))),
            squeezed: !!cell && cell.scrollHeight > cell.clientHeight + 1,
            inside: [...parts, ...shown.map(r)].every((x) => x.bottom <= stage.bottom + 0.5) && (!bar || bar.top >= stage.top - 0.5),
            unclipped: [...shown, ...(seen(more) ? [more] : [])].every((x) => x.getBoundingClientRect().bottom <= boxR.bottom + 1),
          };
        });
        ok(lay.shown >= 1 && lay.told && !lay.over && !lay.squeezed && lay.inside && lay.unclipped,
          `${w}×${h} ${name}: nothing drawn over the figures or cut off unsaid, every note shown or said to be on the board page, inside the screen (${JSON.stringify(lay)})`);
        if (w === 1280 && h === 720) await p.screenshot({ path: join(OUT, `screen-notes-${live}-${name.replace(/\W+/g, '-')}-1280.png`) });
        await p.close();
      }
    }
  }

  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.slice(0, 4).join(' | ')}` : ''}`);
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join('\n- ')}` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
