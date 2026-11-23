/**
 * Board QA round 7, the privacy tester's four (Nov 21 2026): who has a People web address, and renames, on the server.
 *   B1  a new person on People at an old address (someone deleted, or a rename still finishing) never gets the last
 *       person's board records; the same person put back (Recently deleted's copy, the list's Undo) does
 *   m2  a rename changes only the agenda template's presenters, written over the settings as read: a founder's save
 *       meanwhile (Who runs Board included) stays
 *   m3  the board's sign-in email sent while its member is renamed: its marks, confirmed, at the member it went to
 *   m6  a Photos-review save racing a rename never brings the old People record back as a second person
 * Made-up people only (the repo is public); Resend is faked, nothing leaves this machine.
 * Run: node --test tests/board-round7-privacy.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

let env;
let sent;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), RESEND_API_KEY: 're_test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  const { ensureSchema } = await import('../functions/api/_board.js');
  await ensureSchema(env.DB);
  sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (!url.startsWith('https://api.resend.com/')) throw new Error(`unexpected fetch ${url}`);
    const b = JSON.parse(init.body);
    sent.push(...(Array.isArray(b) ? b : [b]));
    return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `em_${i}` })) } : { id: 'em_0' });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const person = async (slug, d, email) => {
  await env.DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, 0, JSON.stringify({ slug, status: 'active', publishStatus: 'published', ...d })).run();
  if (email) await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
};
const req = (url, body) => ({ env, request: new Request(`https://site.test${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), data: { userEmail: 'jane@soardcharity.com' }, waitUntil: () => {} });
const save = async (slug, content) => {
  const { onRequestPost } = await import('../functions/api/save-content.js');
  const r = await onRequestPost(req('/api/save-content', { path: `src/content/team/${slug}.json`, content, message: `Add person: ${slug}` }));
  return { status: r.status, ...(await r.json()) };
};
const ren = async (from, to) => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, 'jane@soardcharity.com', async () => Response.json({ success: true }));
const onPeople = async (prefix) => ((await env.DB.prepare('SELECT slug FROM team WHERE slug LIKE ? ORDER BY slug').bind(`${prefix}%`).all()).results || []).map((r) => r.slug);
// (a meeting naming them, saved as Board saves one: a to-do of theirs, an item they present, the roll call)
async function meetingFor(slug, name) {
  const { saveMeeting } = await import('../functions/api/_board.js');
  const { newMeeting } = await import('../public/admin/board-shared.js');
  const m = newMeeting({ date: '2026-12-01' });
  const sections = m.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'it-r7', title: `${name}’s report`, who: [slug] }] } : sec));
  const saved = await saveMeeting(env.DB, { ...m, attendance: [{ slug, key: slug, name, kind: 'board', status: 'remote' }], sections, actions: [{ id: 'a-r7', owner: slug, text: `${name}’s to-do` }] }, { by: 'jane@soardcharity.com' });
  return saved.id;
}
const theirs = (m) => [m.actions.find((a) => /’s to-do$/.test(a.text))?.owner, m.sections.flatMap((x) => x.items).find((it) => /’s report$/.test(it.title))?.who?.[0], m.attendance.find((a) => a.kind === 'board')?.slug];
const inMeeting = async (id) => (await import('../functions/api/_board.js')).getMeeting(env.DB, id);

// ─── B1 ─────────────────────────────────────────────────────────────

test('B1: someone deleted from People: a new person at their address is refused in words, never given their board records; the same person put back (Recently deleted’s copy) is theirs again', async () => {
  const { deleteItem } = await import('../functions/api/delete-content.js');
  await person('kim-park', { name: 'Kim Park', group: 'board', title: 'Board Member' });
  const mid = await meetingFor('kim-park', 'Kim Park');
  await deleteItem(env, { path: 'src/content/team/kim-park.json', message: 'Remove Kim Park' }, 'jane@soardcharity.com', (p) => p?.catch?.(() => {}));
  assert.deepEqual(await onPeople('kim-'), []);
  // A different Kim Park, as Paste a list adds one (save-content, no sha)
  const fresh = await save('kim-park', JSON.stringify({ slug: 'kim-park', name: 'Kim Park', group: 'board', title: 'Board Member', organization: 'Another Co' }));
  assert.deepEqual([fresh.status, fresh.error], [409, '“kim-park” was someone’s address on People, and History keeps their versions under it. Give this person another address.']);
  assert.deepEqual(await onPeople('kim-'), [], 'nobody given her address');
  // Restore: the very record History's delete kept, at that very address, as Recently deleted and the list's Undo send it
  const kept = await env.DB.prepare("SELECT data FROM content_versions WHERE collection = 'team' AND slug = 'kim-park' AND action = 'delete' ORDER BY id DESC LIMIT 1").first();
  const back = await save('kim-park', JSON.stringify(JSON.parse(kept.data), null, 2));
  assert.equal(back.status, 200, JSON.stringify(back));
  assert.deepEqual(await onPeople('kim-'), ['kim-park']);
  assert.deepEqual(theirs(await inMeeting(mid)), ['kim-park', 'kim-park', 'kim-park'], 'her own records, hers again');
});

test('B1: a rename still finishing: a new person at the old address is refused in words, and the moves reach the renamed member', async () => {
  const { maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  await person('taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Member' });
  const mid = await meetingFor('taylor-nguyen', 'Taylor Nguyen');
  // The meetings' move not answering once (the tester's MEET_MOVE)
  const real = env.DB.prepare;
  let left = 1;
  env.DB.prepare = (sql) => {
    const st = real(sql);
    if (!/FROM board_meetings WHERE instr\(data, \?\) > 0$/.test(sql)) return st;
    return { ...st, bind: (...p) => { const b = st.bind(...p); return { ...b, all: async () => { if (left-- > 0) throw new Error('D1_ERROR: qa fault'); return b.all(); } }; } };
  };
  const r = await ren('taylor-nguyen', 'taylor-quinn');
  env.DB.prepare = real;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.note || '', /still moving to the new address/);
  const fresh = await save('taylor-nguyen', JSON.stringify({ slug: 'taylor-nguyen', name: 'Taylor Nguyen', group: 'board', title: 'Board Member' }));
  assert.deepEqual([fresh.status, fresh.error], [409, '“taylor-nguyen” was a former board member’s address, and their board records are kept under it. Give this person another address.']);
  assert.deepEqual(await onPeople('taylor-'), ['taylor-quinn']);
  assert.deepEqual(await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000 }), ['taylor-nguyen']);
  assert.deepEqual(theirs(await inMeeting(mid)), ['taylor-quinn', 'taylor-quinn', 'taylor-quinn'], 'the real Taylor’s, at her new address');
});

// ─── m2 ─────────────────────────────────────────────────────────────

test('m2: a rename changes only the agenda template’s presenters, written over the settings as they are: a founder’s save meanwhile stays, Who runs Board included; one that can’t get its write in finishes later', async () => {
  const { writeState, readState } = await import('../functions/api/_board-roles.js');
  const { saveSettings } = await import('../functions/api/_board.js');
  const { maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  await person('taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Treasurer' });
  await writeState(env.DB, 'settings', { admins: ['jane@soardcharity.com', 'pat@soardcharity.com'], asks: 'on', remind: '7', template: [{ title: 'Reports', items: [{ title: 'Treasurer’s report', who: ['taylor-nguyen'] }] }] });
  // A founder's save landing between the rename's read of the settings and its write (the tester's /__qa/yield)
  const real = env.DB.prepare;
  let saves = 1;
  const settingsWrite = (sql, p) => (/^INSERT OR REPLACE INTO board_state/.test(sql) && p[0] === 'settings') || /WHERE key = 'settings' AND data = \?/.test(sql);
  env.DB.prepare = (sql) => {
    const st = real(sql);
    return { ...st, bind: (...p) => {
      const b = st.bind(...p);
      if (!settingsWrite(sql, p)) return b;
      return { ...b, run: async () => { if (saves-- > 0) await saveSettings(env.DB, { admins: ['jane@soardcharity.com'], asks: 'off', remind: '3' }, 'jane@soardcharity.com'); return b.run(); } };
    } };
  };
  const r = await ren('taylor-nguyen', 'taylor-quinn');
  env.DB.prepare = real;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let s = await readState(env.DB, 'settings');
  assert.deepEqual([s.admins, s.asks, s.remind], [['jane@soardcharity.com'], 'off', '3'], `the founder’s save stays (${JSON.stringify(s)})`);
  assert.deepEqual(s.template[0].items[0].who, ['taylor-quinn'], 'and the presenter moved');
  // The settings changing every time it tries: it says so through the finish note, and the heartbeat finishes it
  await person('sam-ortiz', { name: 'Sam Ortiz', group: 'board', title: 'Secretary' });
  await saveSettings(env.DB, { template: [{ title: 'Reports', items: [{ title: 'Minutes', who: ['sam-ortiz'] }] }] }, 'jane@soardcharity.com');
  let n = 0;
  env.DB.prepare = (sql) => {
    const st = real(sql);
    return { ...st, bind: (...p) => {
      const b = st.bind(...p);
      if (!/WHERE key = 'settings' AND data = \?/.test(sql) || n < 0) return b;
      return { ...b, run: async () => { n++; await real("UPDATE board_state SET data = json_set(data, '$.quorum', ?) WHERE key = 'settings'").bind(n).run(); return b.run(); } };
    } };
  };
  const r2 = await ren('sam-ortiz', 'sam-lee');
  env.DB.prepare = real;
  assert.equal(r2.status, 200);
  assert.match(r2.body.note || '', /still moving to the new address/);
  assert.deepEqual((await readState(env.DB, 'settings')).template[0].items[0].who, ['sam-ortiz'], 'not written over a row it didn’t read');
  assert.deepEqual(await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000 }), ['sam-ortiz']);
  s = await readState(env.DB, 'settings');
  assert.deepEqual(s.template[0].items[0].who, ['sam-lee'], 'finished later, never the old address left in the template');
  assert.deepEqual(s.admins, ['jane@soardcharity.com']);
});

// ─── m3 ─────────────────────────────────────────────────────────────

test('m3: the board’s sign-in email sent while its member is renamed: one email, marked and confirmed at the address they have now, nothing left unconfirmed', async () => {
  const { sendWelcome } = await import('../functions/api/_board.js');
  const { readState } = await import('../functions/api/_board-roles.js');
  await person('jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' });
  for (const delay of [0, 60, 1500]) {
    // (one member for each moment the rename lands, each with their own email)
    const from = `sam-ortiz-${delay}`;
    const to = `sam-lee-${delay}`;
    const email = `sam.${delay}@example.org`;
    await person(from, { name: `Sam Ortiz${'abc'[[0, 60, 1500].indexOf(delay)]}`, group: 'board', title: 'Board Treasurer' }, email);
    // Resend slow to answer; the rename lands `delay` ms into it
    const inner = globalThis.fetch;
    let release;
    const gate = new Promise((r) => { release = r; });
    let asked = false;
    globalThis.fetch = async (input, init) => { if (!asked) { asked = true; await gate; } return inner(input, init); };
    const before = sent.length;
    const going = sendWelcome(env, { slugs: [from], by: 'jane@soardcharity.com' });
    for (let i = 0; i < 200 && !asked; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(asked, 'the email is on its way');
    await new Promise((r) => setTimeout(r, delay));
    const r = await ren(from, to);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    release();
    const out = await going;
    globalThis.fetch = inner;
    assert.equal(out.sent, 1);
    assert.equal(sent.length - before, 1, 'one email');
    const w = await readState(env.DB, 'welcome');
    assert.ok(w.members?.[to] && w.addresses?.[to] === email, `marked at ${to} (${JSON.stringify(w)})`);
    assert.equal(w.members?.[from], undefined, 'nothing at the old address');
    assert.ok(!(w.unconfirmed || []).length, `confirmed: nothing unconfirmed (${JSON.stringify(w.unconfirmed)})`);
  }
});

// ─── m6 ─────────────────────────────────────────────────────────────

test('m6: a Photos-review save racing a rename never brings the old record back as a second person, and says which wasn’t saved', async () => {
  const { batch } = await import('../functions/api/people-batch.js');
  await person('taylor-nguyen', { name: 'Taylor Nguyen', group: 'board', title: 'Board Member', photo: 'team/taylor-nguyen/1' });
  await person('alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair', photo: 'team/alex-rivera/1' });
  // The rename lands between the batch's read and its write
  const realBatch = env.DB.batch;
  env.DB.batch = async (stmts) => { env.DB.batch = realBatch; await ren('taylor-nguyen', 'taylor-quinn'); return realBatch(stmts); };
  const crop = { photoCrop: { x: 0.1, y: 0.05, size: 0.6 }, photoSize: [1200, 1600] };
  const r = await batch(env, { updates: [{ slug: 'taylor-nguyen', set: crop }, { slug: 'alex-rivera', set: crop }] }, 'jane@soardcharity.com');
  env.DB.batch = realBatch;
  assert.deepEqual(await onPeople('taylor-'), ['taylor-quinn'], 'never a second Taylor');
  assert.deepEqual([r.status, r.body.error], [409, 'Taylor Nguyen was renamed or deleted on People since this list was read, so their photo change wasn’t saved (everyone else’s were). Look again.']);
  assert.deepEqual(r.body.changed, ['alex-rivera']);
  assert.deepEqual(JSON.parse((await env.DB.prepare("SELECT data FROM team WHERE slug = 'alex-rivera'").first()).data).photoCrop, crop.photoCrop, 'Alex’s saved');
});
