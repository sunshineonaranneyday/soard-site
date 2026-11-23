/**
 * Board QA round 8, the privacy tester's address, rename and save findings (Nov 21 2026), on the server:
 *   B1  adding a person never writes over anyone: a People save with no sha onto a record that's there is refused (the
 *       very record sent again is done already), and so is one at an address a rename has just given someone
 *   B2  a save made while the person is being renamed is never lost: refused in words while the rename holds them, and a
 *       save that got in just before is carried by the rename (its final write only over the record as read); its
 *       History version is written with the record, so it's never left at the address they left
 *   B4  the one list of where a person's things live covers every Board record: a line note, a practice meeting, the
 *       secretary's notes and the agenda template hold an address, and People's note counts them
 *   B6  the clash rule covers Board's tables: "Move them" folds a board_seen row the new address already had (the newer
 *       kept, the older in the audit log) and says so, never claiming a row moved that stayed
 *   B7  the stuck-rename alert email goes only while the note is unsettled
 * Made-up people only (the repo is public); Resend, Slack and Cloudflare Images are faked, nothing leaves this machine.
 * Run: node --test tests/board-round8-addresses.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const BY = 'jane@soardcharity.com';
let env;
let sent;
let slack;
let onImage = null;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), RESEND_API_KEY: 're_test', SLACK_BOT_TOKEN: 'xoxb-test', CF_ACCOUNT_ID: 'acct', CF_IMAGES_TOKEN: 'tok' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  const { ensureSchema } = await import('../functions/api/_board.js');
  await ensureSchema(env.DB);
  await (await import('../functions/api/_advisory.js')).ensureAdvisory(env.DB);
  await (await import('../functions/api/_board-activity.js')).ensureActivitySchema(env.DB);
  await (await import('../functions/api/_board-asks.js')).ensureAsks(env.DB);
  const { writeSlackConfig } = await import('../functions/api/_broadcast-notify.js');
  await writeSlackConfig(env.DB, { attention: { id: 'C_ATTN', name: 'needs-attention' } });
  sent = [];
  slack = [];
  onImage = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'api.resend.com') { const b = JSON.parse(init.body); sent.push(...(Array.isArray(b) ? b : [b])); return Response.json(Array.isArray(b) ? { data: b.map((_, i) => ({ id: `e${i}` })) } : { id: 'e0' }); }
    if (url.host === 'slack.com') {
      const method = url.pathname.split('/').pop();
      const body = JSON.parse(init.body);
      slack.push({ method, body });
      if (slack.during) await slack.during(method);
      return Response.json({ ok: true, channel: body.channel, ts: method === 'chat.update' ? body.ts : `17000000${slack.length}.000100` });
    }
    // Cloudflare Images: the photo's original, then its copy (a save can land in between: onImage)
    if (url.host === 'api.cloudflare.com' && url.pathname.endsWith('/blob')) { if (onImage) await onImage(); return new Response(new Blob([new Uint8Array([1, 2, 3])])); }
    if (url.host === 'api.cloudflare.com' && init.method === 'POST') { const id = init.body.get('id'); return Response.json({ success: true, result: { id, variants: [`https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/${id}/public`] } }); }
    if (url.host === 'api.cloudflare.com' && init.method === 'DELETE') return Response.json({ success: true, result: {} });
    throw new Error(`no route for ${url.href}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const person = (slug, d, email) => Promise.all([
  env.DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, 0, JSON.stringify({ slug, status: 'active', publishStatus: 'published', ...d })).run(),
  email ? env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run() : null,
]);
const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };
const save = async (slug, record, extra = {}) => {
  const { onRequestPost } = await import('../functions/api/save-content.js');
  const r = await onRequestPost({ env, request: new Request('https://x/api/save-content', { method: 'POST', body: JSON.stringify({ path: `src/content/team/${slug}.json`, content: typeof record === 'string' ? record : JSON.stringify(record, null, 2), message: `Save ${slug}`, ...extra }) }), data: { userEmail: BY }, waitUntil: () => {} });
  return { status: r.status, ...(await r.json()) };
};
const ren = (from, to) => quietly(async () => (await import('../functions/api/rename-content.js')).rename(env, { collection: 'team', from, to }, BY, globalThis.fetch));
const rec = async (slug) => JSON.parse((await env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first())?.data || 'null');
const rawOf = async (slug) => (await env.DB.prepare('SELECT data FROM team WHERE slug = ?').bind(slug).first())?.data;
const taken = async (slug) => (await import('../functions/api/_people-address.js')).addressTaken(env.DB, slug);
const leftAt = async (slug) => (await import('../functions/api/_rename-finish.js')).leftAt(env.DB, slug);
const notes = async () => ((await env.DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'rename-finish:%'").all()).results || []).map((r) => ({ key: r.key, ...JSON.parse(r.data) }));
/** A rename that couldn't finish as things stood, waiting for a person (as the heartbeat leaves one): → its note */
async function stuck(from, to) {
  const { finishNote, maybeFinishRenames, noteReady } = await import('../functions/api/_rename-finish.js');
  await noteReady(env.DB);
  await finishNote(env.DB, from, to, { at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), by: 'pat@soardcharity.com' }).run();
  await quietly(() => maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell: async () => {} }));
  return (await notes()).find((n) => n.from === from);
}

// ─── B1 ─────────────────────────────────────────────────────────────

test('B1: People’s add (no sha) at an address someone was given since the list was read is refused, never written over; the very record sent again is done already', async () => {
  const pat = { name: 'Jordan Ames', slug: 'jordan-ames', title: 'Advisory Board Member', group: 'advisory', order: 3, status: 'active', publishStatus: 'draft', organization: 'Ames Realty' };
  assert.equal((await save('jordan-ames', pat, { create: true })).status, 200);
  await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('jordan-ames', 'jordan.ames@example.com').run();
  // Jane's Add dialog, from a list read before that: a different Jordan Ames, to the board
  const jane = await save('jordan-ames', { name: 'Jordan Ames', slug: 'jordan-ames', title: 'Board Member', group: 'board', order: 9, status: 'active', publishStatus: 'published', seat: '' });
  assert.deepEqual([jane.status, jane.error], [409, 'There’s one at that address already: someone added it since this list was read. Nothing was changed.']);
  assert.deepEqual([(await rec('jordan-ames')).group, (await rec('jordan-ames')).organization], ['advisory', 'Ames Realty'], 'Pat’s Jordan untouched');
  // Pat's own save sent again (its answer lost): done already, nothing written twice
  const again = await save('jordan-ames', pat);
  assert.deepEqual([again.status, again.same], [200, true]);
});

test('B1: People’s add at an address a rename has just moved someone into is refused, and their record and sign-in stay theirs', async () => {
  await person('ren-src', { name: 'Renamed Person', group: 'board', title: 'Board Member' }, 'renamed@example.org');
  assert.equal((await ren('ren-src', 'ren-dst')).status, 200);
  const add = await save('ren-dst', { name: 'Brand New', slug: 'ren-dst', title: 'Board Member', group: 'board', order: 9, status: 'active', publishStatus: 'draft', seat: '' });
  assert.equal(add.status, 409);
  assert.equal((await rec('ren-dst')).name, 'Renamed Person');
  assert.equal((await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind('ren-dst').first()).email, 'renamed@example.org');
});

// ─── B2 ─────────────────────────────────────────────────────────────

test('B2: while a rename holds a person, People’s editor and the Photos review are refused in words, and nothing is written', async () => {
  await person('pia-photo', { name: 'Pia Photo', group: 'team', title: 'Volunteer' });
  const raw = await rawOf('pia-photo');
  const { generateSha } = await import('../functions/api/_collections.js');
  const { holdForPeople, letGo } = await import('../functions/api/_advisory-add.js');
  const keys = await holdForPeople(env.DB, ['pia-photo', 'pia-new']);
  const editor = await save('pia-photo', { ...JSON.parse(raw), title: 'Volunteer Lead' }, { sha: await generateSha(raw) });
  assert.deepEqual([editor.status, editor.error], [409, 'Their web address is changing right now, so nothing was saved. Try again in a moment.']);
  const { batch } = await import('../functions/api/people-batch.js');
  const photos = await batch(env, { updates: [{ slug: 'pia-photo', set: { photoCrop: { x: 0.25, y: 0.25, size: 0.5 } } }] }, BY);
  assert.equal(photos.status, 409);
  assert.equal(photos.body.error, 'Pia Photo’s web address is changing right now, so nothing was saved. Try again in a moment.');
  assert.equal(await rawOf('pia-photo'), raw, 'nothing written');
  const create = await save('pia-new', { name: 'Someone', slug: 'pia-new', group: 'team' }, { create: true });
  assert.equal(create.status, 409, 'nor anyone added at the address it’s going to');
  await letGo(env.DB, keys);
});

test('B2: a save that got in while the rename copied the photo is carried to the new address, never undone, and its History version goes with them', async () => {
  const photo = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/team/rio-race/1/public';
  await person('rio-race', { name: 'Rio Race', group: 'team', title: 'Volunteer', photo });
  // (a save that passed its hold check a moment before the rename took the hold: its record and its version written together)
  onImage = async () => {
    onImage = null;
    const before = await rawOf('rio-race');
    const next = JSON.stringify({ ...JSON.parse(before), title: 'Volunteer Lead', photoCrop: { x: 0.25, y: 0.25, size: 0.5 } });
    const { ensureHistory } = await import('../functions/api/_content-history.js');
    await ensureHistory(env.DB);
    await env.DB.batch([env.DB.prepare('UPDATE team SET data = ? WHERE slug = ? AND data = ?').bind(next, 'rio-race', before),
      env.DB.prepare("INSERT INTO content_versions (collection, slug, data, action, user_email, created_at) VALUES ('team', 'rio-race', ?, 'save', ?, ?)").bind(next, 'pat@soardcharity.com', new Date().toISOString())]);
  };
  const r = await ren('rio-race', 'rio-new');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const at = await rec('rio-new');
  assert.deepEqual([at.title, at.photoCrop, at.slug], ['Volunteer Lead', { x: 0.25, y: 0.25, size: 0.5 }, 'rio-new'], 'the save made meanwhile is on their record');
  assert.match(at.photo, /team\/rio-new\//, 'with the photo’s copy at the new address');
  assert.equal(await rec('rio-race'), null);
  const versions = (await env.DB.prepare("SELECT slug FROM content_versions WHERE collection = 'team' ORDER BY id").all()).results.map((v) => v.slug);
  assert.ok(versions.length >= 1 && versions.every((s) => s === 'rio-new'), `no History left at the old address (${versions})`);
});

test('B2: a People editor save keeps its History version with the record (one transaction), so a rename moving History takes it', async () => {
  await person('ida-hist', { name: 'Ida Hist', group: 'team', title: 'Volunteer' });
  const raw = await rawOf('ida-hist');
  const { generateSha } = await import('../functions/api/_collections.js');
  // The rename runs while the save waits on GitHub (after its record is written, before anything after it)
  const { onRequestPost } = await import('../functions/api/save-content.js');
  const real = env.DB.prepare.bind(env.DB);
  let renamed = null;
  env.DB.prepare = (sql) => {
    const st = real(sql);
    if (!renamed && /^INSERT INTO audit_log/.test(sql)) { renamed = 'pending'; return { bind: (...a) => ({ run: async () => { env.DB.prepare = real; renamed = await ren('ida-hist', 'ida-new'); return st.bind(...a).run(); } }) }; }
    return st;
  };
  const res = await onRequestPost({ env, request: new Request('https://x/api/save-content', { method: 'POST', body: JSON.stringify({ path: 'src/content/team/ida-hist.json', content: JSON.stringify({ ...JSON.parse(raw), title: 'Volunteer Lead' }), message: 'Update', sha: await generateSha(raw) }) }), data: { userEmail: 'pat@soardcharity.com' }, waitUntil: () => {} });
  env.DB.prepare = real;
  assert.equal(res.status, 200);
  assert.equal(renamed?.status, 200, JSON.stringify(renamed));
  assert.equal((await rec('ida-new')).title, 'Volunteer Lead');
  const versions = (await env.DB.prepare("SELECT slug, json_extract(data, '$.title') AS title FROM content_versions WHERE collection = 'team' ORDER BY id").all()).results;
  assert.ok(versions.some((v) => v.title === 'Volunteer Lead'), 'the save’s version is kept');
  assert.deepEqual([...new Set(versions.map((v) => v.slug))], ['ida-new'], 'and none at the old address');
});

// ─── B4 ─────────────────────────────────────────────────────────────

test('B4: every Board record holds an address: a line note, a practice meeting, the secretary’s notes, the agenda template; People’s note counts each', async () => {
  await env.DB.prepare('INSERT INTO board_line_notes (meeting_id, item_id, key, line, text, by_slug, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('m1', 'i1', 'k1', 'Year to date', 'Ask about this', 'noor-hale', 'Noor Hale', '2026-11-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO board_practice (id, date, data, updated_at) VALUES (?, ?, ?, ?)').bind('p1', '2026-12-01', JSON.stringify({ id: 'p1', sections: [{ items: [{ who: ['pat-practice'] }] }], actions: [] }), 'x').run();
  await env.DB.prepare('INSERT INTO board_minutes_notes (meeting_id, data) VALUES (?, ?)').bind('m2', JSON.stringify({ 'r:sam-notes': { status: 'present' } })).run();
  const { writeState } = await import('../functions/api/_board-roles.js');
  await writeState(env.DB, 'settings', { template: [{ title: 'Money', items: [{ title: 'Treasurer’s report', who: ['tia-template'] }] }] });
  for (const [slug, words] of [['noor-hale', '1 note on a line of the money report'], ['pat-practice', '1 practice board meeting they’re on'], ['sam-notes', '1 meeting’s minutes notes that name them'], ['tia-template', '1 item they present on the agenda template']]) {
    assert.equal((await taken(slug))?.why, 'board', slug);
    assert.deepEqual(await leftAt(slug), [words], slug);
  }
  // (an address that only contains theirs is someone else's)
  assert.equal(await taken('noor'), null);
});

test('B4: "Leave them" with nobody there keeps a line note’s address held: a different Noor Hale is refused it', async () => {
  const { settleStuck } = await import('../functions/api/_rename-finish.js');
  await env.DB.prepare('INSERT INTO board_line_notes (meeting_id, item_id, key, line, text, by_slug, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('m1', 'i1', 'k1', 'Year to date', 'Ask about this', 'noor-hale-n2', 'Noor Hale', '2026-11-01T00:00:00.000Z').run();
  const n = await stuck('noor-hale-n2', 'noor-elsewhere');
  assert.equal(n?.stuck, 'not at the new address');
  assert.equal((await settleStuck(env, { from: 'noor-hale-n2', at: n.at, choice: 'leave' }, BY)).status, 200);
  const fresh = await save('noor-hale-n2', { name: 'Noor Hale', slug: 'noor-hale-n2', group: 'board', title: 'Board Member' }, { create: true });
  assert.deepEqual([fresh.status, fresh.error], [409, '“noor-hale-n2” was a former board member’s address, and their board records are kept under it. Give this person another address.']);
});

// ─── B6 ─────────────────────────────────────────────────────────────

test('B6: "Move them" folds a board_seen row the new address already has (the newer kept, the older in the audit log), and says what actually happened', async () => {
  const { settleStuck } = await import('../functions/api/_rename-finish.js');
  await person('gil-new', { name: 'Gil Guard', group: 'board', title: 'Board Member' });
  await person('gil-guard', { name: 'Gil Other', group: 'board', title: 'Board Member' });
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind('gil-guard', '2026-11-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind('gil-new', '2026-11-20T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO board_signins (slug, iat, at, device) VALUES (?, ?, ?, ?)').bind('gil-guard', 1763700000, '2026-11-20T15:00:00.000Z', 'phone').run();
  const n = await stuck('gil-guard', 'gil-new');
  assert.equal(n?.stuck, 'someone at the old address');
  const r = await settleStuck(env, { from: 'gil-guard', at: n.at, choice: 'move' }, BY);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((await env.DB.prepare('SELECT slug, at FROM board_seen').all()).results, [{ slug: 'gil-new', at: '2026-11-20T00:00:00.000Z' }], 'nothing left at the old address');
  assert.deepEqual(await leftAt('gil-guard'), []);
  const audit = (await env.DB.prepare("SELECT changes FROM audit_log WHERE entity_name LIKE 'The older of two%'").all()).results;
  assert.deepEqual(audit.map((a) => { const row = JSON.parse(JSON.parse(a.changes)[0].from); return [row.slug, row.at]; }), [['gil-guard', '2026-11-01T00:00:00.000Z']], 'the older row, as data');
  assert.equal(r.body.said, 'Gil Guard’s records still at “gil-guard” moved to “gil-new”: 1 sign-in to the board page. For 1 other Board record (like when they last visited), “gil-new” had one already: the newer of each was kept, and the older is in the audit log.');
});

// ─── B7 ─────────────────────────────────────────────────────────────

test('B7: settled on People while the heartbeat’s alert was posting: no alert email asks staff to settle it', async () => {
  env.ALERT_EMAILS = 'ops@example.org';
  const { finishNote, maybeFinishRenames, noteReady, alertsFor, settleStuck } = await import('../functions/api/_rename-finish.js');
  await noteReady(env.DB);
  await person('gil-new', { name: 'Gil Guard', group: 'board', title: 'Board Member' });
  await person('gil-guard', { name: 'Gil Other', group: 'board', title: 'Board Member' });
  const at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await finishNote(env.DB, 'gil-guard', 'gil-new', { at, by: 'pat@soardcharity.com' }).run();
  let settled = null;
  slack.during = async (method) => { if (method === 'chat.postMessage' && !settled) { slack.during = null; settled = await settleStuck(env, { from: 'gil-guard', at, choice: 'leave' }, BY); } };
  const heartbeat = alertsFor(env);
  await quietly(() => maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell: heartbeat.tell, resolve: heartbeat.resolve }));
  assert.equal(settled?.status, 200, JSON.stringify(settled));
  assert.equal(sent.filter((e) => /didn’t finish: “gil-guard” to “gil-new”/.test(e.subject || '')).length, 0, 'no email after it was settled');
  // Still unsettled when it goes: the email goes
  await finishNote(env.DB, 'gil-guard', 'gil-new', { at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), by: 'pat@soardcharity.com' }).run();
  await quietly(() => maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell: heartbeat.tell, resolve: heartbeat.resolve }));
  assert.equal(sent.filter((e) => /didn’t finish: “gil-guard” to “gil-new”/.test(e.subject || '')).length, 1);
});

// ─── A meeting still ahead keeps a roll call stored from before (Board QA round 8's fixer asked): a rename moves the
// stored one too, on the board or off it since, so no finish note is left and the old address is free ───
for (const [group, status] of [['board', 'active'], ['team', 'alumni']]) {
  test(`a rename moves a meeting ahead's stored roll call (${group}, ${status}): no note left, the old address free`, async () => {
    await person('sam-ortiz', { name: 'Sam Ortiz', group, status });
    const { saveMeeting } = await import('../functions/api/_board.js');
    const { cleanMeeting } = await import('../public/admin/board-shared.js');
    const ahead = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const m = await saveMeeting(env.DB, cleanMeeting({ date: ahead, attendance: [{ slug: 'sam-ortiz', key: 'sam-ortiz', name: 'Sam Ortiz', kind: 'board', status: 'present' }], sections: [{ title: 'Call to order', items: [{ title: 'Roll call' }] }] }), BY);
    const stored = async () => (await env.DB.prepare('SELECT data FROM board_meetings WHERE id = ?').bind(m.id).first()).data;
    assert.ok((await stored()).includes('"sam-ortiz"'), 'stored with the old address');
    const r = await ren('sam-ortiz', 'sam-ortiz-new');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(!(await stored()).includes('"sam-ortiz"') && (await stored()).includes('"sam-ortiz-new"'), 'the stored roll moved');
    assert.deepEqual(await notes(), [], 'no finish note left');
    assert.deepEqual(await leftAt('sam-ortiz'), []);
    assert.equal(await taken('sam-ortiz'), null, 'the old address is free');
  });
}
