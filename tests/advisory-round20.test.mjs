/**
 * Advisory Board QA round 20 (Nov 21 2026), the admin findings, on the server:
 *   M1  where a member's things live is one list (./functions/api/_member-places.js): the monthly ask email's links and
 *       the meetings are held by the address rule, counted on People's note and moved by a rename; a move that fails
 *       stops (the note stays, the heartbeat finishes it), never skipped; a meeting is moved as data, the newer answer kept
 *   m2  greetings, confident or none: the form's "no name" is kept and honored by the welcome and the monthly ask (one
 *       function); someone added by hand is greeted by the confident reader on their People name
 *   m3  a Move whose records clash with ones at the new address: the newer kept, the older folded in and in the audit
 *       log; a term keeps the earlier start; the words say what actually happened
 *   m4  a rename that loses its address to People's own add at that moment says so, as the check before it does
 * Made-up people only (the repo is public); Resend and Slack are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round20.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const BY = 'linzi@soardcharity.com';
let env;
let sent;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), RESEND_API_KEY: 're_test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  const { ensureSchema } = await import('../functions/api/_board.js');
  await ensureSchema(env.DB);
  await (await import('../functions/api/_advisory.js')).ensureAdvisory(env.DB);
  // (the ask email's links and the meetings, as ./_advisory-mail.js and ./_advisory-meetings.js make them)
  await env.DB.exec('CREATE TABLE IF NOT EXISTS advisory_links (hash TEXT PRIMARY KEY, ask_id TEXT NOT NULL, slug TEXT NOT NULL, expires TEXT NOT NULL)');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS advisory_meetings (id TEXT PRIMARY KEY, date TEXT, data TEXT NOT NULL, updated_at TEXT, updated_by TEXT)');
  sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'api.resend.com') { const b = JSON.parse(init.body); sent.push(...(Array.isArray(b) ? b : [b])); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `e${i}` })) } : { id: 'e0' }); }
    if (url.host === 'slack.com') return Response.json({ ok: true, ts: '1.1' });
    throw new Error(`no route for ${url.href}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const person = (slug, d, email) => Promise.all([
  env.DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, 0, JSON.stringify({ slug, status: 'active', publishStatus: 'published', ...d })).run(),
  email ? env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run() : null,
]);
const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };
const ren = (from, to) => quietly(async () => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, BY, async () => Response.json({ success: true })));
const notes = async () => ((await env.DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'rename-finish:%'").all()).results || []).map((r) => ({ key: r.key, ...JSON.parse(r.data) }));
const slugsIn = async (table, where = '1 = 1', ...binds) => ((await env.DB.prepare(`SELECT slug FROM ${table} WHERE ${where} ORDER BY slug`).bind(...binds).all()).results || []).map((r) => r.slug);
const meeting = async (id) => JSON.parse((await env.DB.prepare('SELECT data FROM advisory_meetings WHERE id = ?').bind(id).first()).data);
const fault = (table) => env.DB.exec(`CREATE TRIGGER qa_${table} BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END;`);
const unfault = (table) => env.DB.exec(`DROP TRIGGER qa_${table};`);
const finishLater = () => quietly(async () => (await import('../functions/api/_rename-finish.js')).maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000 }));
const taken = async (slug) => (await import('../functions/api/_people-address.js')).addressTaken(env.DB, slug);
const leftAt = async (slug) => (await import('../functions/api/_rename-finish.js')).leftAt(env.DB, slug);

/** Jordan Ames, an Advisory Board member, with this month's ask's link in his email and an RSVP to a meeting */
async function jordan(slug = 'jordan-ames') {
  await person(slug, { name: 'Jordan Ames', group: 'advisory', title: 'Advisory Board Member' }, 'jordan.ames@example.org');
  await env.DB.prepare('INSERT INTO advisory_asks (id, data, sent_at, at, by) VALUES (?, ?, ?, ?, ?)').bind('ask_qa20', JSON.stringify({ title: 'Host a dinner' }), '2026-11-20T12:00:00.000Z', '2026-11-20T12:00:00.000Z', BY).run();
  await env.DB.prepare('INSERT INTO advisory_links (hash, ask_id, slug, expires) VALUES (?, ?, ?, ?)').bind('hash-jordan', 'ask_qa20', slug, '2027-01-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_meetings (id, date, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)')
    .bind('m_qa20', '2026-12-10', JSON.stringify({ id: 'm_qa20', date: '2026-12-10', sections: [{ items: [{ title: 'The ask', who: [slug] }] }], invite: { eventId: 'e1', replies: { [slug]: 'accepted' }, who: { [slug]: 'jordan.ames@example.org' } }, updatedAt: '2026-11-20T12:00:00.000Z' }), '2026-11-20T12:00:00.000Z', BY).run();
}

// ─── M1: the ask's links and the meetings, one list ───────────────────

for (const table of ['advisory_links', 'advisory_meetings']) {
  test(`M1: a rename whose move of ${table === 'advisory_links' ? 'the monthly ask email’s links' : 'the Advisory Board meetings'} fails keeps its finish note (the address held), and the heartbeat finishes it`, async () => {
    await jordan();
    await env.DB.prepare('UPDATE team SET name = ?, data = json_set(data, \'$.name\', ?) WHERE slug = ?').bind('Jordan Smith', 'Jordan Smith', 'jordan-ames').run();
    await fault(table);
    const r = await ren('jordan-ames', 'jordan-smith');
    await unfault(table);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.note || '', /still moving to the new address/, 'staff are told some records are still moving');
    assert.deepEqual((await notes()).map((n) => `${n.from}>${n.to}`), ['jordan-ames>jordan-smith'], 'the note stays');
    assert.ok(['advisory', 'renaming'].includes((await taken('jordan-ames'))?.why), 'the old address is held: nobody new is given it');
    // The heartbeat finishes it: the link and the RSVP follow him, and the note goes
    await finishLater();
    assert.deepEqual(await notes(), []);
    assert.deepEqual(await slugsIn('advisory_links'), ['jordan-smith'], 'his email’s link answers as him');
    const m = await meeting('m_qa20');
    assert.deepEqual([Object.keys(m.invite.replies), Object.keys(m.invite.who), m.sections[0].items[0].who], [['jordan-smith'], ['jordan-smith'], ['jordan-smith']]);
    assert.equal(await taken('jordan-ames'), null, 'free now, with nothing of his under it');
  });
}

test('M1: an address that holds only an ask email’s link, or only a meeting RSVP, is taken, and People’s note counts each', async () => {
  await env.DB.prepare('INSERT INTO advisory_links (hash, ask_id, slug, expires) VALUES (?, ?, ?, ?)').bind('h1', 'ask_1', 'only-link', '2027-01-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_meetings (id, date, data) VALUES (?, ?, ?)').bind('m_rsvp', '2026-12-10', JSON.stringify({ id: 'm_rsvp', invite: { replies: { 'only-rsvp': 'accepted' } } })).run();
  // (a longer address with it inside is someone else's: never counted)
  await env.DB.prepare('INSERT INTO advisory_meetings (id, date, data) VALUES (?, ?, ?)').bind('m_other', '2026-12-11', JSON.stringify({ id: 'm_other', title: 'only-rsvp-2 notes', invite: { replies: { 'only-rsvp-2': 'accepted' } } })).run();
  assert.equal((await taken('only-link'))?.why, 'advisory');
  assert.equal((await taken('only-rsvp'))?.why, 'advisory');
  assert.deepEqual(await leftAt('only-link'), ['1 link to answer a monthly ask by email']);
  assert.deepEqual(await leftAt('only-rsvp'), ['1 Advisory Board meeting they’re on']);
  // People's own add at it, and Add's address for a namesake, say so
  const { onRequestPost } = await import('../functions/api/save-content.js');
  const res = await onRequestPost({ env, request: new Request('https://x/api/save-content', { method: 'POST', body: JSON.stringify({ path: 'src/content/team/only-link.json', content: JSON.stringify({ slug: 'only-link', name: 'Only Link', group: 'advisory' }), message: 'Add', create: true }) }), data: { userEmail: BY }, waitUntil: () => {} });
  assert.deepEqual([res.status, (await res.json()).error], [409, '“only-link” was an Advisory Board member’s address, and their records on the Advisory Board page are kept under it. Give this person another address.']);
});

test('M1: the settings’ addresses (a Zeffy page matched to them, who runs the group) are held, counted and moved too', async () => {
  const { saveSettings, getSettings } = await import('../functions/api/_advisory.js');
  await person('pat-page', { name: 'Pat Page', group: 'advisory' });
  await saveSettings(env.DB, { pages: { camp_1: 'pat-page' }, lead: 'pat-page' });
  assert.deepEqual(await leftAt('pat-page'), ['1 Zeffy fundraising page matched to them', '1 setting that names them as who runs the Advisory Board']);
  const r = await ren('pat-page', 'pat-lane');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await getSettings(env.DB);
  assert.deepEqual([s.pages.camp_1, s.lead], ['pat-lane', 'pat-lane']);
  assert.deepEqual(await leftAt('pat-page'), []);
});

test('M1: a swap of two members’ addresses with the first step’s link move failing: each keeps their own link and RSVP', async () => {
  const join = async (slug, name, email, tag) => {
    await person(slug, { name, group: 'advisory' }, email);
    await env.DB.prepare('INSERT INTO advisory_links (hash, ask_id, slug, expires) VALUES (?, ?, ?, ?)').bind(`hash-${tag}`, 'ask_1', slug, '2027-01-01T00:00:00.000Z').run();
    await env.DB.prepare('INSERT INTO advisory_meetings (id, date, data) VALUES (?, ?, ?)').bind(`m_${tag}`, '2026-12-10', JSON.stringify({ id: `m_${tag}`, invite: { replies: { [slug]: 'accepted' } } })).run();
  };
  await join('pia-swapp', 'Pia Swapp', 'pia@example.org', 'pia');
  await join('quin-swapq', 'Quin Swapq', 'quin@example.org', 'quin');
  await fault('advisory_links');
  assert.equal((await ren('pia-swapp', 'pia-temp')).status, 200);
  await unfault('advisory_links');
  for (const [from, to] of [['quin-swapq', 'pia-swapp'], ['pia-temp', 'quin-swapq']]) assert.equal((await ren(from, to)).status, 200, `${from} → ${to}`);
  await finishLater();
  const linkOf = async (tag) => (await env.DB.prepare('SELECT slug FROM advisory_links WHERE hash = ?').bind(`hash-${tag}`).first()).slug;
  assert.deepEqual([await linkOf('pia'), await linkOf('quin')], ['quin-swapq', 'pia-swapp'], 'Pia’s link answers as Pia, Quin’s as Quin');
  assert.deepEqual([Object.keys((await meeting('m_pia')).invite.replies), Object.keys((await meeting('m_quin')).invite.replies)], [['quin-swapq'], ['pia-swapp']]);
  assert.deepEqual(await notes(), []);
});

test('M1: "Leave them" on a stuck note frees nothing that holds a link or an RSVP: a namesake is refused the address', async () => {
  const { finishNote, maybeFinishRenames, noteReady, settleStuck, stuckRenames } = await import('../functions/api/_rename-finish.js');
  await noteReady(env.DB);
  await env.DB.prepare('INSERT INTO advisory_links (hash, ask_id, slug, expires) VALUES (?, ?, ?, ?)').bind('h-gil', 'ask_1', 'gil-garnet', '2027-01-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_meetings (id, date, data) VALUES (?, ?, ?)').bind('m_gil', '2026-12-10', JSON.stringify({ id: 'm_gil', invite: { replies: { 'gil-garnet': 'accepted' } } })).run();
  // (renamed to gil-brook, then gone from there: nobody at either address)
  await finishNote(env.DB, 'gil-garnet', 'gil-brook', { at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), by: BY }).run();
  await quietly(() => maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell: async () => {} }));
  const [s] = await stuckRenames(env.DB);
  assert.deepEqual(s.left, ['1 link to answer a monthly ask by email', '1 Advisory Board meeting they’re on'], 'the note counts the link and the RSVP');
  assert.equal((await settleStuck(env, { from: 'gil-garnet', at: s.at, choice: 'leave' }, BY)).status, 200);
  assert.equal((await taken('gil-garnet'))?.why, 'advisory', 'left there, so still held: never given to someone new');
});

test('M1, rule 3: a meeting is moved as data, never as text: each key and list entry, the newer answer kept (an "invited" never over an answer), the older in the audit log', async () => {
  const { moveSlug } = await import('../functions/api/_advisory.js');
  const data = {
    id: 'm_both', title: 'jordan-ames-2 and “jordan-ames” notes', updatedAt: '2026-11-20T12:00:00.000Z',
    sections: [{ items: [{ who: ['jordan-ames', 'jordan-smith'] }, { who: ['jordan-ames-2'] }] }],
    invite: { replies: { 'jordan-smith': 'declined', 'jordan-ames': 'accepted', 'jordan-ames-2': 'accepted' }, who: { 'jordan-ames': 'j@x.org' } },
    calendar: { replies: { 'jordan-smith': 'invited', 'jordan-ames': 'tentative' } },
  };
  await env.DB.prepare('INSERT INTO advisory_meetings (id, date, data, updated_at) VALUES (?, ?, ?, ?)').bind('m_both', '2026-12-10', JSON.stringify(data), data.updatedAt).run();
  const report = await moveSlug(env.DB, 'jordan-ames', 'jordan-smith', { by: BY });
  const m = await meeting('m_both');
  assert.equal(m.title, data.title, 'words that only contain the address are words');
  assert.deepEqual(m.sections[0].items.map((it) => it.who), [['jordan-smith'], ['jordan-ames-2']], 'never listed twice; someone else’s address left alone');
  assert.deepEqual(m.invite.replies, { 'jordan-smith': 'declined', 'jordan-ames-2': 'accepted' }, 'the newer answer, at the new address, kept');
  assert.deepEqual(m.invite.who, { 'jordan-smith': 'j@x.org' });
  assert.deepEqual(m.calendar.replies, { 'jordan-smith': 'tentative' }, 'an answer is kept over an "invited" with none');
  assert.notEqual(m.updatedAt, data.updatedAt, 'when it changed, so an editor open on it is told');
  assert.deepEqual(report.map((e) => [e.kind, e.moved, e.folded]), [['advisory_meetings', 0, 1]]);
  const audit = (await env.DB.prepare("SELECT entity_name, changes FROM audit_log WHERE entity_name LIKE 'The older of two%'").all()).results;
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(JSON.parse(audit[0].changes)[0].from), data, 'the meeting as it was, as data');
});

// ─── m3: clashes on a Move ──────────────────────────────────────────

test('m3, rule 4: Move with records at both addresses: the newer answer kept, a term with the earlier start, nothing left at the old address, the older in the audit log, and the words say so', async () => {
  const { finishNote, maybeFinishRenames, noteReady, settleStuck, stuckRenames } = await import('../functions/api/_rename-finish.js');
  await noteReady(env.DB);
  await person('hal-hill', { name: 'Hal Hill', group: 'advisory' }, 'hal@example.org');
  await person('hal-hollow', { name: 'Quinn Hollow', group: 'advisory' }, 'quinn@example.org');
  const ans = (slug, answer, note, at) => env.DB.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at, via) VALUES (?, ?, ?, ?, ?, ?)').bind('ask_shared', slug, answer, note, at, 'page').run();
  await ans('hal-hollow', 'no', 'Hal before', '2026-11-01T10:00:00.000Z');
  await ans('hal-hill', 'yes', 'Hal after', '2026-11-10T10:00:00.000Z');
  await env.DB.prepare("INSERT INTO advisory_terms (slug, started_on, ends_on) VALUES ('hal-hollow', '2025-01-01', '2026-01-01')").run();
  await env.DB.prepare("INSERT INTO advisory_terms (slug, started_on, ends_on, renewed_on) VALUES ('hal-hill', '2026-01-01', '2027-01-01', '2026-01-01')").run();
  await finishNote(env.DB, 'hal-hollow', 'hal-hill', { at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), by: 'pat@soardcharity.com' }).run();
  await quietly(() => maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell: async () => {} }));
  const [s] = await stuckRenames(env.DB);
  const r = await settleStuck(env, { from: 'hal-hollow', at: s.at, choice: 'move' }, BY);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((await env.DB.prepare('SELECT slug, answer, note FROM advisory_answers WHERE ask_id = ?').bind('ask_shared').all()).results, [{ slug: 'hal-hill', answer: 'yes', note: 'Hal after' }]);
  assert.deepEqual((await env.DB.prepare('SELECT slug, started_on, ends_on, renewed_on FROM advisory_terms').all()).results, [{ slug: 'hal-hill', started_on: '2025-01-01', ends_on: '2027-01-01', renewed_on: '2026-01-01' }]);
  assert.deepEqual(await leftAt('hal-hollow'), [], 'nothing left under the old address, which is Quinn’s now');
  const audit = (await env.DB.prepare("SELECT user_email, entity_slug, entity_name, changes FROM audit_log WHERE entity_name LIKE 'The older of two%' ORDER BY id").all()).results;
  assert.equal(audit.length, 2);
  assert.deepEqual(audit.map((a) => JSON.parse(JSON.parse(a.changes)[0].from)).map((x) => [x.slug, x.note || x.started_on]), [['hal-hollow', 'Hal before'], ['hal-hollow', '2025-01-01']], 'the older rows, as data');
  assert.deepEqual(audit.map((a) => a.user_email), [BY, BY], 'under the person who chose Move');
  assert.equal(r.body.said, 'Hal Hill’s records still at “hal-hollow” moved to “hal-hill”. For 1 answer to a monthly ask, 1 term on the Advisory Board, “hal-hill” had one already: the newer of each was kept (a term keeps the earlier start date), and the older is in the audit log.');
});

test('m3: an older answer at the new address is replaced by the newer one from the old address (the newer stays, whichever address)', async () => {
  const { moveSlug } = await import('../functions/api/_advisory.js');
  await env.DB.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind('ask_x', 'kai-old', 'yes', 'newer', '2026-11-12T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind('ask_x', 'kai-new', 'no', 'older', '2026-11-02T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_signatures (doc_id, slug, year, name, version, at) VALUES (?, ?, ?, ?, ?, ?)').bind('agreement', 'kai-old', 2026, 'Kai Old', 2, '2026-11-12T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_signatures (doc_id, slug, year, name, version, at) VALUES (?, ?, ?, ?, ?, ?)').bind('agreement', 'kai-new', 2026, 'Kai New', 1, '2026-11-01T00:00:00.000Z').run();
  await moveSlug(env.DB, 'kai-old', 'kai-new', { by: BY });
  assert.deepEqual((await env.DB.prepare('SELECT slug, note FROM advisory_answers').all()).results, [{ slug: 'kai-new', note: 'newer' }]);
  assert.deepEqual((await env.DB.prepare('SELECT slug, version FROM advisory_signatures').all()).results, [{ slug: 'kai-new', version: 2 }]);
});

// ─── m4: a rename that loses its address at that moment ───────────────

test('m4, rule 7: a rename that loses the address to People’s own add at that very moment says the address is taken, as the check before it does', async () => {
  await person('ray-rename', { name: 'Ray Rename', group: 'advisory' });
  // People's add of someone else at "ray-new" lands right after the rename's address check (its History table check)
  const real = env.DB.prepare.bind(env.DB);
  let once = true;
  env.DB.prepare = (sql) => {
    if (once && /CREATE TABLE IF NOT EXISTS content_versions/.test(sql)) {
      once = false;
      return { run: async () => { await real('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind('ray-new', 'Someone Else', 'advisory', 0, JSON.stringify({ slug: 'ray-new', name: 'Someone Else', group: 'advisory' })).run(); return real(sql).run(); } };
    }
    return real(sql);
  };
  const { onRequestPost } = await import('../functions/api/rename-content.js');
  const res = await quietly(() => onRequestPost({ env, request: new Request('https://x/api/rename-content', { method: 'POST', body: JSON.stringify({ collection: 'team', from: 'ray-rename', to: 'ray-new' }) }), data: { userEmail: BY } }));
  env.DB.prepare = real;
  assert.deepEqual([res.status, (await res.json()).error], [409, 'Someone already has the address “ray-new”. Pick another.']);
  assert.deepEqual(await slugsIn('team', "slug LIKE 'ray-%'"), ['ray-new', 'ray-rename'], 'both still there, nothing changed');
});

// ─── m2: greetings, confident or none ─────────────────────────────────
// (which names greet is _advisory-form.js greetName's alone, another fixer's this round: these check the emails greet
// exactly as greetName reads the application's answers, never a particular name)

const BASE = {
  phone: '(770) 555-0142', heardFrom: 'A friend', why: 'To help.', connection: 'Neighbors.', involved: 'No', strengths: 'Events.', fundraising: 'A match.',
  introductions: 'Yes', networks: 'No', conflict: 'No', hostEvent: 'No', meetings: 'Yes', ambassador: 'Yes',
  refName: 'Sam Lee', refRelationship: 'Former manager', refEmail: 'sam@example.org', acknowledge: true,
};
const line = (g) => (g ? `Hi ${g},` : 'Hello,');
const heading = (g) => (g ? `Welcome, ${g}` : 'Welcome to the Advisory Board');
// (how the copy greets a member, as an email's first line and its heading)
const firstLine = (to, subject) => sent.filter((e) => subject.test(e.subject) && [].concat(e.to).includes(to)).map((e) => e.text.split('\n')[0]).pop();
const h1 = (to) => (sent.filter((e) => /page is ready/.test(e.subject) && [].concat(e.to).includes(to)).pop()?.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || null;

test('m2, rule 5: the welcome and the monthly ask greet by greetName of the application’s answers, "no name" included, kept with the welcome record through a rename and the application’s delete; someone added by hand by greetName of their People name', async () => {
  const sharp = (await import('sharp')).default;
  const { readHeadshot, submitApplication } = await import('../functions/api/_advisory-applications.js');
  const adminApi = await import('../functions/api/advisory-applications-admin.js');
  const { greetName } = await import('../functions/api/_advisory-form.js');
  const mail = await import('../functions/api/_advisory-mail.js');
  const { saveSettings } = await import('../functions/api/_advisory.js');
  const { readState } = await import('../functions/api/_board-roles.js');
  const jpg = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#c4aa8c' } }).jpeg().toBuffer());
  const shot = (await readHeadshot(new File([jpg], 'h.jpg', { type: 'image/jpeg' }))).headshot;
  Object.assign(env, { CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 't' });
  globalThis.fetch = ((inner) => async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.includes('/images/v1') && init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } }); }
    return inner(input, init);
  })(globalThis.fetch);
  const ctx = (method, body, query = '') => ({ env, request: new Request(`https://site.test/api/advisory-applications-admin${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), data: { userEmail: BY }, waitUntil: () => {} });
  const members = [];
  // (names the form greets, names it doesn't, and the name they asked to be called)
  for (const [k, extra] of [{ fullName: 'Jordan, Amy and Sam Rowe' }, { fullName: 'Garcia Lopez, Maria & Jose' }, { fullName: 'Joanna Ames', preferredName: 'Jo' }, { fullName: 'Rowe, Jordan & Amy & Sam' }].entries()) {
    const email = `member${k}@example.org`;
    const answers = { ...BASE, ...extra, email, signature: extra.fullName };
    const app = (await submitApplication(env, answers, { headshot: shot })).app;
    const plan = (await (await adminApi.onRequestGet(ctx('GET', undefined, `?plan=${app.id}`))).json()).plan;
    const r = await (await adminApi.onRequestPost(ctx('POST', { add: { id: app.id, as: 'new', seen: plan.key } }))).json();
    assert.equal(r.success, true, r.error);
    members.push({ slug: r.person.slug, email, greet: greetName(answers), app: app.id });
  }
  for (const m of members) assert.equal((await readState(env.DB, 'advisory-mail')).names[m.slug], m.greet, `${m.slug}: the form’s decision kept with the welcome record`);
  // Someone added on People by hand: no application
  await person('jordan-hand', { name: 'Jordan Hand', group: 'advisory', title: 'Advisory Board Member' }, 'jordan.hand@example.org');
  const hand = greetName({ fullName: 'Jordan Hand' });
  // Renamed, and their applications gone, before anything is sent: the decision stays theirs
  const moved = members[0];
  assert.equal((await ren(moved.slug, `${moved.slug}-x`)).status, 200);
  moved.slug = `${moved.slug}-x`;
  await env.DB.prepare('DELETE FROM advisory_applications').run();
  await saveSettings(env.DB, { emails: true });
  await mail.sendWelcome(env, { slugs: [...members.map((m) => m.slug), 'jordan-hand'], anyway: true });
  await env.DB.prepare('INSERT INTO advisory_asks (id, data, sent_at, at, by) VALUES (?, ?, ?, ?, ?)').bind('ask_greet', JSON.stringify({ title: 'Host a dinner' }), '2026-11-20T12:00:00.000Z', '2026-11-20T12:00:00.000Z', BY).run();
  await mail.sendAsk(env, { id: 'ask_greet', title: 'Host a dinner', body: 'Can you?' });
  for (const m of [...members, { slug: 'jordan-hand', email: 'jordan.hand@example.org', greet: hand }]) {
    assert.equal(firstLine(m.email, /page is ready/), line(m.greet), `${m.slug}: the welcome greets as greetName does`);
    assert.equal(h1(m.email), heading(m.greet), `${m.slug}: its heading`);
    assert.equal(firstLine(m.email, /This month’s ask/), line(m.greet), `${m.slug}: the ask greets the same`);
  }
});

test('m2: a "no name" decision kept with the welcome record is never turned into a guess from the People name, and the one greeting function reads it', async () => {
  const mail = await import('../functions/api/_advisory-mail.js');
  const { greetName } = await import('../functions/api/_advisory-form.js');
  const { readState } = await import('../functions/api/_board-roles.js');
  // (a People name the confident reader would greet, beside an application that greets none)
  const peopleName = 'Jordan Ames';
  assert.ok(greetName({ fullName: peopleName }), 'setup: the People name alone would greet someone');
  await person('jordan-none', { name: peopleName, group: 'advisory' }, 'jordan.none@example.org');
  await mail.queueWelcome(env.DB, 'jordan-none', { by: BY, greet: '' });
  const log = await readState(env.DB, 'advisory-mail');
  assert.deepEqual([log.names['jordan-none'], log.waiting['jordan-none'].greet], ['', ''], 'kept as a decision, with the name and the waiting welcome');
  await mail.sendWelcome(env, { slugs: ['jordan-none'], anyway: true });
  assert.equal(firstLine('jordan.none@example.org', /page is ready/), 'Hello,');
  assert.equal(mail.greetingOf({ slug: 'jordan-none', name: peopleName }, { 'jordan-none': '' }), '');
  assert.equal(mail.greetingOf({ slug: 'someone', name: peopleName }, {}), greetName({ fullName: peopleName }), 'no decision: greetName of the People name');
});

// ─── An editor open on an Advisory Board meeting across a rename (Board QA round 8's T1, the same rule here): the move
// stamps the meeting's time, so the open page's save is told someone saved it since, and never puts the old address back ───
test('an Advisory Board meeting editor open across a rename is told, and never saves the old address back', async () => {
  await jordan('jordan-ames');
  const { saveAdvisoryMeeting, getAdvisoryMeeting } = await import('../functions/api/_advisory-meetings.js');
  const opened = await getAdvisoryMeeting(env.DB, 'm_qa20');
  assert.equal(opened.updatedAt, '2026-11-20T12:00:00.000Z');
  const r = await ren('jordan-ames', 'jordan-smith');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await getAdvisoryMeeting(env.DB, 'm_qa20');
  assert.notEqual(after.updatedAt, opened.updatedAt, 'the move says when it changed the meeting');
  // The open page saves a change to another part, from what it read before the rename
  const stale = { ...opened, title: 'December gathering' };
  await assert.rejects(() => saveAdvisoryMeeting(env.DB, stale, { by: BY, base: opened.updatedAt }), (e) => e.status === 409 && /saved this meeting since you opened it/.test(e.message));
  const kept = await meeting('m_qa20');
  assert.deepEqual(kept.sections[0].items[0].who, ['jordan-smith'], 'the presenter keeps the new address');
  assert.deepEqual(Object.keys(kept.invite.replies), ['jordan-smith'], 'and the answer too');
});
