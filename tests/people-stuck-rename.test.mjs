/**
 * People: a way for staff to settle a rename that couldn't finish by itself (fix-stuck-rename, Nov 21 2026).
 * A rename whose board and Advisory Board page records couldn't follow it as things stood (someone else at the old
 * address now, or the person no longer at the new one) waits for a person (functions/api/_rename-finish.js); People's
 * note at the top settles it through /api/rename-settle (functions/api/rename-settle.js):
 *   Move them to <to>     everything at <from> moved there (finishRename), the signing chain's "renamed" event once
 *   Leave them at <from>  nothing moved, they stay with whoever is at <from>, or with nobody
 *   either way            the note goes, the addresses are no longer held for it, the Needs attention post resolves,
 *                         and the audit log says who chose which
 *   who                   staff only, as People's rename: board and Advisory Board sign-ins are refused in words
 * Made-up people only; Slack is faked, nothing leaves this machine.
 * Run: node --test tests/people-stuck-rename.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const BY = 'linzi@soardcharity.com';
let env;
let slack;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  env = { DB: await createD1(), SLACK_BOT_TOKEN: 'xoxb-test' };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_slug TEXT, entity_name TEXT, changes TEXT, path TEXT, git_status TEXT, created_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  const { ensureSchema } = await import('../functions/api/_board.js');
  const { ensureAdvisory } = await import('../functions/api/_advisory.js');
  await ensureSchema(env.DB);
  await ensureAdvisory(env.DB);
  await (await import('../functions/api/_board-activity.js')).ensureActivitySchema(env.DB);
  // Slack's Needs attention channel, as Reveals → Settings → Alerts picks it; every call Slack gets is kept
  const { writeSlackConfig } = await import('../functions/api/_broadcast-notify.js');
  await writeSlackConfig(env.DB, { attention: { id: 'C_ATTN', name: 'needs-attention' } });
  slack = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'slack.com') {
      const method = url.pathname.split('/').pop();
      const body = JSON.parse(init.body);
      slack.push({ method, body });
      return Response.json({ ok: true, channel: body.channel, ts: method === 'chat.update' ? body.ts : `17000000${slack.length}.000100` });
    }
    throw new Error(`no route for ${url.href}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const person = (slug, d, email) => Promise.all([
  env.DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, ?, ?)').bind(slug, d.name, d.group, 0, JSON.stringify({ slug, status: 'active', publishStatus: 'published', ...d })).run(),
  email ? env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run() : null,
]);
/** A board meeting they're on, presenting an item, with a to-do of theirs (as Board saves one) */
async function meetingFor(slug, name) {
  const { saveMeeting } = await import('../functions/api/_board.js');
  const { newMeeting } = await import('../public/admin/board-shared.js');
  const m = newMeeting({ date: '2026-12-01' });
  const sections = m.sections.map((sec, i) => (i === 0 ? { ...sec, items: [...sec.items, { id: 'it-st', title: `${name}’s report`, who: [slug] }] } : sec));
  return (await saveMeeting(env.DB, { ...m, attendance: [{ slug, key: slug, name, kind: 'board', status: 'remote' }], sections, actions: [{ id: 'a-st', owner: slug, text: `${name}’s to-do` }] }, { by: 'jane@soardcharity.com' })).id;
}
const inMeeting = async (id) => {
  const m = await (await import('../functions/api/_board.js')).getMeeting(env.DB, id);
  return [m.actions.find((a) => /’s to-do$/.test(a.text))?.owner, m.sections.flatMap((x) => x.items).find((it) => /’s report$/.test(it.title))?.who?.[0], m.attendance.find((a) => a.kind === 'board')?.slug];
};
const slugIn = async (table, where, ...binds) => (await env.DB.prepare(`SELECT slug FROM ${table} WHERE ${where}`).bind(...binds).first())?.slug || null;
const notesNow = async () => ((await env.DB.prepare("SELECT key, data FROM board_state WHERE key LIKE 'rename-finish:%'").all()).results || []).map((r) => ({ key: r.key, ...JSON.parse(r.data) }));
const renamedEvents = async (to) => Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM board_sign_events WHERE kind = 'renamed' AND slug = ?").bind(to).first()).n);
const openPosts = async () => ((await env.DB.prepare('SELECT key, ts FROM slack_open_posts').all().catch(() => ({ results: [] }))).results || []);
const audits = async () => (await env.DB.prepare("SELECT user_email, action, entity_type, entity_slug, entity_name, changes FROM audit_log WHERE entity_name LIKE '%records%' ORDER BY id").all()).results || [];

/**
 * Gil Guard, a board member, renamed "gil-guard" → "gil-new", his records left behind: a board meeting he's on (and his
 * to-do in it), a sign-in, a signature with its signing chain, an answer on the Advisory Board page; someone else, Gil
 * Other, at "gil-guard" now. The heartbeat finds it stuck and tells the staff in Needs attention, through the board's
 * own alert (./_board.js maybeRunBoard's tell)
 */
async function gilStuck() {
  const { finishNote, maybeFinishRenames, noteReady } = await import('../functions/api/_rename-finish.js');
  await noteReady(env.DB);
  const { appendEvents } = await import('../functions/api/_board-sign.js');
  await person('gil-new', { name: 'Gil Guard', group: 'board', title: 'Board Member' }, 'gil.guard@example.org');
  await person('gil-guard', { name: 'Gil Other', group: 'advisory', title: 'Advisory Board member' }, 'gil.other@example.org');
  const mid = await meetingFor('gil-guard', 'Gil Guard');
  await env.DB.prepare('INSERT INTO board_signins (slug, iat, at, device) VALUES (?, ?, ?, ?)').bind('gil-guard', 1763700000, '2026-11-20T15:00:00.000Z', 'phone').run();
  await env.DB.prepare('INSERT INTO board_signatures (doc_id, slug, year, name, at) VALUES (?, ?, ?, ?, ?)').bind('conflict-policy', 'gil-guard', 2026, 'Gil Guard', '2026-11-20T15:01:00.000Z').run();
  await appendEvents(env.DB, async () => ({ events: [{ kind: 'signed', slug: 'gil-guard', docId: 'conflict-policy', year: 2026, version: 1, by: 'gil-guard', detail: { name: 'Gil Guard' } }] }));
  await env.DB.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind('ask-gil', 'gil-guard', 'yes', 'gil', '2026-11-01T00:00:00.000Z').run();
  await finishNote(env.DB, 'gil-guard', 'gil-new', { at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), by: 'pat@soardcharity.com' }).run();
  const tell = async (card) => {
    const [{ alertAdmins }, { readConfig }] = await Promise.all([import('../functions/api/_broadcast-notify.js'), import('../functions/api/_broadcast.js')]);
    await alertAdmins(env, await readConfig(env.DB).catch(() => ({})), card);
  };
  assert.deepEqual(await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell }), [], 'setup: never finished by itself');
  const [n] = await notesNow();
  assert.deepEqual([n?.stuck, !!n?.told], ['someone at the old address', true], 'setup: stuck, and the staff told');
  assert.deepEqual((await openPosts()).map((p) => p.key), ['rename-finish:gil-guard'], 'setup: its Needs attention post is open');
  const post = slack.find((c) => c.method === 'chat.postMessage');
  assert.match(JSON.stringify(post.body), /Settle it in the admin on People: the note at the top lets you move them to “gil-new” or leave them at “gil-guard”/, 'setup: the post names where to settle it');
  return { mid, at: n.at, ts: (await openPosts())[0].ts };
}
const GIL_LEFT = ['1 board meeting they’re on', '1 to-do from a board meeting', '1 sign-in to the board page', '1 signature on a board paper', '1 answer to a monthly ask'];

// ─── The routes, as staff call them ───────────────────────────────────

const call = async (method, body) => {
  const route = await import('../functions/api/rename-settle.js');
  const request = new Request('https://sunshineonaranneyday.com/api/rename-settle', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await route[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request, data: { userEmail: BY }, waitUntil: () => {} });
  return { status: res.status, ...(await res.json()) };
};

test('People’s note lists a rename that couldn’t finish: who, why it stopped (someone else at the old address), and what’s still there by kind', async () => {
  const { at } = await gilStuck();
  const list = await call('GET');
  assert.equal(list.status, 200, JSON.stringify(list));
  assert.deepEqual(list.stuck, [{ from: 'gil-guard', to: 'gil-new', at, name: 'Gil Guard', here: true, other: 'Gil Other', left: GIL_LEFT }]);
  // The words the note and its questions say (public/admin/people-stuck.js)
  const { stuckWords } = await import('../public/admin/people-stuck.js');
  const w = stuckWords(list.stuck[0]);
  assert.equal(w.lead, 'Gil Guard’s web address was changed from “gil-guard” to “gil-new”, but some of their records are still at “gil-guard”.');
  assert.equal(w.why, 'It stopped because someone else, Gil Other, is at “gil-guard” now, so the site can’t tell whose they are.');
  assert.equal(w.move.text, `Gil Other is at “gil-guard” now, so anything of theirs there moves to Gil Guard at “gil-new” too. Still at “gil-guard”: ${GIL_LEFT.join(', ')}.`);
  assert.equal(w.leave.text, `They stay at “gil-guard”, with Gil Other, who is at that address now. Nothing moves to Gil Guard at “gil-new”. Still at “gil-guard”: ${GIL_LEFT.join(', ')}.`);
  assert.deepEqual([w.move.yes, w.leave.yes], ['Move them to “gil-new”', 'Leave them at “gil-guard”']);
  for (const words of [w.lead, w.why, w.move.text, w.leave.text, ...GIL_LEFT]) assert.doesNotMatch(words, /[–—]|advisor\b|advisors\b|\bPete\b/i, words);
});

test('Move them to <to>: everything at the old address moves to the person, the signing chain says "renamed" once, the note and the hold on both addresses go, Needs attention resolves the same post, and the audit log says who chose it', async () => {
  const { mid, at, ts } = await gilStuck();
  const before = await renamedEvents('gil-new');
  const r = await call('POST', { from: 'gil-guard', at, choice: 'move' });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.said, `Gil Guard’s records still at “gil-guard” moved to “gil-new”: ${GIL_LEFT.join(', ')}.`);
  // The records: at the new address
  assert.deepEqual(await inMeeting(mid), ['gil-new', 'gil-new', 'gil-new'], 'the meeting: his to-do, the item he presents, the attendance');
  assert.equal(await slugIn('board_signins', 'iat = ?', 1763700000), 'gil-new');
  assert.equal(await slugIn('board_signatures', 'doc_id = ?', 'conflict-policy'), 'gil-new');
  assert.equal(await slugIn('advisory_answers', 'ask_id = ?', 'ask-gil'), 'gil-new');
  const { leftAt } = await import('../functions/api/_rename-finish.js');
  assert.deepEqual(await leftAt(env.DB, 'gil-guard'), [], 'nothing left at the old address');
  // The signing chain: one "renamed" event, from the rename itself (its moment and who renamed him)
  assert.equal(await renamedEvents('gil-new') - before, 1);
  const ev = await env.DB.prepare("SELECT by, detail FROM board_sign_events WHERE kind = 'renamed' AND slug = 'gil-new'").first();
  assert.deepEqual([ev.by, JSON.parse(ev.detail)], ['pat@soardcharity.com', { from: 'gil-guard', to: 'gil-new', at }]);
  const { slugsOf } = await import('../functions/api/_board-sign.js');
  assert.ok((await slugsOf(env.DB, 'gil-new')).some((x) => x.slug === 'gil-guard'), 'his signatures under the old address are his');
  // The note gone, and the addresses no longer held for it
  assert.deepEqual(await notesNow(), []);
  const { addressTaken } = await import('../functions/api/_people-address.js');
  assert.deepEqual(await addressTaken(env.DB, 'gil-guard', { only: ['renaming'] }), null);
  assert.deepEqual(await addressTaken(env.DB, 'gil-new', { only: ['renaming'] }), null);
  const { rename } = await import('../functions/api/rename-content.js');
  const again = await rename(env, { collection: 'team', from: 'gil-new', to: 'gil-guard-b' }, BY, async () => Response.json({ success: true }));
  assert.equal(again.status, 200, `People renames him again (${JSON.stringify(again.body)})`);
  // Needs attention: the same post, edited to Resolved, and a reply under it
  assert.deepEqual(await openPosts(), [], 'no post left open');
  const edit = slack.find((c) => c.method === 'chat.update');
  assert.equal(edit?.body.ts, ts, 'the same post');
  assert.match(JSON.stringify(edit.body), /Resolved: A change of web address on People didn’t finish: “gil-guard” to “gil-new”/);
  const reply = slack.filter((c) => c.method === 'chat.postMessage' && c.body.thread_ts === ts);
  assert.equal(reply.length, 1);
  assert.match(JSON.stringify(reply[0].body), /linzi@soardcharity\.com chose this on People/);
  // The audit log: who chose which
  const [a] = await audits();
  assert.deepEqual([a.user_email, a.action, a.entity_type, a.entity_slug, a.entity_name], [BY, 'updated', 'team', 'gil-new', 'Gil Guard: records moved from “gil-guard” to “gil-new”']);
  assert.deepEqual(JSON.parse(a.changes), [{ field: 'records still at “gil-guard”', from: GIL_LEFT.join(', '), to: 'moved to “gil-new”' }]);
  // Pressed again (another tab): already settled, said so, and nothing written twice
  const twice = await call('POST', { from: 'gil-guard', at, choice: 'move' });
  assert.deepEqual([twice.status, twice.error, twice.settled], [409, 'This was settled already, in another tab or by someone else. People shows where things stand now.', true]);
  assert.equal(await renamedEvents('gil-new') - before, 1, 'still once');
  assert.equal((await audits()).length, 1);
});

test('Move them to <to> that stops partway: said so, the note stays, and pressing it again finishes it with the "renamed" event still written once', async () => {
  const { mid, at } = await gilStuck();
  const before = await renamedEvents('gil-new');
  await env.DB.exec("CREATE TRIGGER qa_s BEFORE UPDATE ON board_signins BEGIN SELECT RAISE(ABORT, 'D1_ERROR: qa fault'); END;");
  const quiet = console.error;
  console.error = () => {};
  const r = await call('POST', { from: 'gil-guard', at, choice: 'move' });
  console.error = quiet;
  await env.DB.exec('DROP TRIGGER qa_s;');
  assert.deepEqual([r.status, r.error], [503, 'Not everything moved: the site’s database didn’t answer partway. Press Move them to “gil-new” again to finish.']);
  assert.equal((await notesNow()).length, 1, 'the note stays');
  assert.equal(await slugIn('board_signins', 'iat = ?', 1763700000), 'gil-guard', 'the sign-in didn’t move yet');
  assert.equal((await openPosts()).length, 1, 'Needs attention still open');
  assert.equal((await audits()).length, 0, 'nothing said as chosen yet');
  const list = await call('GET');
  assert.deepEqual(list.stuck.map((s) => s.left), [['1 sign-in to the board page', '1 answer to a monthly ask']], 'the note says what’s still there');
  const done = await call('POST', { from: 'gil-guard', at, choice: 'move' });
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.deepEqual(await inMeeting(mid), ['gil-new', 'gil-new', 'gil-new']);
  assert.equal(await slugIn('board_signins', 'iat = ?', 1763700000), 'gil-new');
  assert.equal(await slugIn('advisory_answers', 'ask_id = ?', 'ask-gil'), 'gil-new');
  assert.equal(await renamedEvents('gil-new') - before, 1, 'once');
  assert.deepEqual(await notesNow(), []);
});

test('Leave them at <from>: nothing moves, they stay with whoever is at the old address, the note and the hold go, Needs attention resolves, and the audit log says who chose it', async () => {
  const { mid, at, ts } = await gilStuck();
  const before = await renamedEvents('gil-new');
  const r = await call('POST', { from: 'gil-guard', at, choice: 'leave' });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.said, 'Gil Guard’s records were left at “gil-guard”, with Gil Other, who is at that address now.');
  assert.deepEqual(await inMeeting(mid), ['gil-guard', 'gil-guard', 'gil-guard'], 'nothing moved');
  assert.equal(await slugIn('board_signins', 'iat = ?', 1763700000), 'gil-guard');
  assert.equal(await slugIn('advisory_answers', 'ask_id = ?', 'ask-gil'), 'gil-guard');
  assert.equal(await renamedEvents('gil-new'), before, 'no "renamed" event: the old address isn’t said to be his');
  assert.deepEqual(await notesNow(), []);
  const { addressTaken } = await import('../functions/api/_people-address.js');
  assert.deepEqual(await addressTaken(env.DB, 'gil-new'), { why: 'person' }, 'Gil Guard’s own address is his, no longer held for the rename');
  assert.deepEqual(await addressTaken(env.DB, 'gil-guard', { only: ['renaming'] }), null);
  // Both people can be changed on People again
  const { rename } = await import('../functions/api/rename-content.js');
  const fetchImpl = async () => Response.json({ success: true });
  assert.equal((await rename(env, { collection: 'team', from: 'gil-new', to: 'gil-guard-b' }, BY, fetchImpl)).status, 200);
  assert.deepEqual(await openPosts(), []);
  assert.equal(slack.find((c) => c.method === 'chat.update')?.body.ts, ts, 'the same post resolved');
  const [a] = await audits();
  assert.deepEqual([a.user_email, a.entity_slug, a.entity_name], [BY, 'gil-new', 'Gil Guard: records left at “gil-guard”']);
  assert.deepEqual(JSON.parse(a.changes), [{ field: 'records still at “gil-guard”', from: GIL_LEFT.join(', '), to: 'left at “gil-guard”, with Gil Other' }]);
});

test('nobody at the new address any more: only Leave is offered, Move is refused in words, and Leave keeps the records under the old address, which is never given out while they’re there', async () => {
  const { finishNote, maybeFinishRenames, noteReady } = await import('../functions/api/_rename-finish.js');
  await noteReady(env.DB);
  const { ensureHistory } = await import('../functions/api/_content-history.js');
  // Uma renamed "uma-left" → "uma-nowhere", then deleted (History keeps her last version); her page records left behind
  await ensureHistory(env.DB);
  await env.DB.prepare("INSERT INTO content_versions (collection, slug, data, action, user_email, created_at) VALUES ('team', 'uma-nowhere', ?, 'delete', ?, ?)")
    .bind(JSON.stringify({ slug: 'uma-nowhere', name: 'Uma Left', group: 'advisory' }), BY, '2026-11-20T12:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_answers (ask_id, slug, answer, note, at) VALUES (?, ?, ?, ?, ?)').bind('ask-uma', 'uma-left', 'yes', 'uma', '2026-11-01T00:00:00.000Z').run();
  await env.DB.prepare('INSERT INTO advisory_intros (id, slug, status, data, at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind('intro-uma', 'uma-left', 'thanks', JSON.stringify({ name: 'A neighbor' }), '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z').run();
  await finishNote(env.DB, 'uma-left', 'uma-nowhere', { at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }).run();
  await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000 });
  const list = await call('GET');
  const at = (await notesNow())[0].at;
  assert.deepEqual(list.stuck, [{ from: 'uma-left', to: 'uma-nowhere', at, name: 'Uma Left', here: false, other: null, left: ['1 answer to a monthly ask', '1 introduction'] }]);
  const { stuckWords } = await import('../public/admin/people-stuck.js');
  const w = stuckWords(list.stuck[0]);
  assert.equal(w.why, 'It stopped because Uma Left isn’t at “uma-nowhere” any more.');
  assert.equal(w.leave.text, 'They stay at “uma-left”, with nobody: nobody is at that address on People now. Still at “uma-left”: 1 answer to a monthly ask, 1 introduction.');
  const move = await call('POST', { from: 'uma-left', at, choice: 'move' });
  assert.deepEqual([move.status, move.error], [409, 'Nobody is at “uma-nowhere” on People now, so the records can’t be moved there. Leave them at “uma-left” instead.']);
  assert.equal((await notesNow()).length, 1, 'nothing changed');
  // A press made from a note read before it changed (another tab's), never acts on a newer one
  const stale = await call('POST', { from: 'uma-left', at: '2026-01-01T00:00:00.000Z', choice: 'leave' });
  assert.deepEqual([stale.status, stale.settled], [409, true]);
  const leave = await call('POST', { from: 'uma-left', at, choice: 'leave' });
  assert.equal(leave.status, 200, JSON.stringify(leave));
  assert.equal(leave.said, 'Uma Left’s records were left at “uma-left”, with nobody: nobody is at that address on People.');
  assert.equal(await slugIn('advisory_answers', 'ask_id = ?', 'ask-uma'), 'uma-left');
  assert.deepEqual(await notesNow(), []);
  const { addressTaken } = await import('../functions/api/_people-address.js');
  assert.deepEqual(await addressTaken(env.DB, 'uma-left'), { why: 'advisory' }, 'her records are still under it: never given to someone new');
  assert.equal((await addressTaken(env.DB, 'uma-nowhere', { only: ['renaming'] })), null, 'no longer held for the rename');
  assert.deepEqual((await call('GET')).stuck, []);
});

test('a choice that isn’t one of the two, or no rename named, is refused in words and changes nothing', async () => {
  const { at } = await gilStuck();
  for (const [body, error] of [[{ from: 'gil-guard', at, choice: 'delete' }, 'Choose Move them or Leave them.'], [{ at, choice: 'leave' }, 'Say which change of web address to settle: reload People and press its button again.']]) {
    const r = await call('POST', body);
    assert.deepEqual([r.status, r.error], [400, error]);
  }
  assert.equal((await notesNow()).length, 1);
});

// ─── Who can: staff only, as People's rename ──────────────────────────

test('only staff can see or settle it: board and Advisory Board sign-ins, and anyone else, are refused in words and change nothing', async () => {
  const { onRequest, _resetKeyCacheForTests } = await import('../functions/api/_middleware.js');
  const { BOARD_ROUTES, ADVISORY_ROUTES, routesFor } = await import('../functions/api/_board-roles.js');
  const route = await import('../functions/api/rename-settle.js');
  assert.ok(!BOARD_ROUTES.includes('/api/rename-settle') && !ADVISORY_ROUTES.includes('/api/rename-settle'));
  assert.ok(!routesFor({ member: { slug: 'm', committees: ['Advisory Board'] } }).includes('/api/rename-settle'));
  const { at } = await gilStuck();
  // Cloudflare Access, as the admin's sign-in: a key of its own, and a token signed for each address
  const TEAM = 'soard';
  const AUD = 'aud-tag';
  const ISS = `https://${TEAM}.cloudflareaccess.com`;
  const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const signIn = async (email) => {
    const now = Math.floor(Date.now() / 1000);
    const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const p = b64u(JSON.stringify({ iss: ISS, aud: [AUD], email, iat: now, nbf: now, exp: now + 3600 }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
  };
  const slackFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => (String(input) === `${ISS}/cdn-cgi/access/certs` ? Response.json({ keys: [jwk] }) : slackFetch(input, init));
  Object.assign(env, { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
  _resetKeyCacheForTests();
  const through = async (email, method, body) => {
    const headers = { 'CF-Access-JWT-Assertion': await signIn(email), Origin: 'https://sunshineonaranneyday.com' };
    if (body) headers['Content-Type'] = 'application/json';
    const request = new Request('https://sunshineonaranneyday.com/api/rename-settle', { method, headers, body: body ? JSON.stringify(body) : undefined });
    const ctx = { request, env, data: {}, waitUntil: () => {} };
    ctx.next = async () => route[method === 'GET' ? 'onRequestGet' : 'onRequestPost'](ctx);
    const res = await onRequest(ctx);
    return { status: res.status, ...(await res.json()) };
  };
  // A board member (Gil Guard himself) and an Advisory Board member (Gil Other), each by their private email
  for (const [email, error] of [
    ['gil.guard@example.org', 'This sign-in opens the board page only.'],
    ['gil.other@example.org', 'This sign-in opens the Advisory Board page only.'],
    ['someone@example.com', 'This sign-in isn’t on SOARD’s team or board list.'],
  ]) {
    const seen = await through(email, 'GET');
    assert.deepEqual([seen.status, seen.error, seen.stuck], [403, error, undefined], `${email} can’t see it`);
    const pressed = await through(email, 'POST', { from: 'gil-guard', at, choice: 'leave' });
    assert.deepEqual([pressed.status, pressed.error], [403, error], `${email} can’t settle it`);
  }
  assert.equal((await notesNow()).length, 1, 'nothing changed');
  assert.equal((await audits()).length, 0);
  // Staff, as on People's rename
  const staff = await through(BY, 'GET');
  assert.deepEqual([staff.status, staff.stuck?.map((s) => s.from)], [200, ['gil-guard']]);
  const done = await through(BY, 'POST', { from: 'gil-guard', at, choice: 'leave' });
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal((await audits())[0].user_email, BY, 'the audit log has the staff member’s own sign-in');
});

test('settled on People while its Needs attention post was going out: the post still ends Resolved, never left open over records already settled', async () => {
  // Gil's rename, stuck and not yet told; the staff settle it (Leave) in the moment between the heartbeat claiming the
  // telling and its post reaching Slack, so the settle's own "Resolved" finds no post yet
  const { finishNote, maybeFinishRenames, noteReady, alertsFor, settleStuck } = await import('../functions/api/_rename-finish.js');
  await noteReady(env.DB);
  await person('gil-new', { name: 'Gil Guard', group: 'board', title: 'Board Member' }, 'gil.guard@example.org');
  await person('gil-guard', { name: 'Gil Other', group: 'advisory', title: 'Advisory Board member' }, 'gil.other@example.org');
  await meetingFor('gil-guard', 'Gil Guard');
  const at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await finishNote(env.DB, 'gil-guard', 'gil-new', { at, by: 'pat@soardcharity.com' }).run();
  const heartbeat = alertsFor(env);
  let settled = null;
  const tell = async (card) => {
    settled = await settleStuck(env, { from: 'gil-guard', at, choice: 'leave' }, BY);
    assert.deepEqual(await openPosts(), [], 'the settle went first: no post yet for it to resolve');
    await heartbeat.tell(card);
  };
  await maybeFinishRenames(env.DB, { now: Date.now() + 2 * 60 * 1000, tell, resolve: heartbeat.resolve });
  assert.equal(settled?.status, 200, JSON.stringify(settled));
  assert.deepEqual(await notesNow(), [], 'settled: no note');
  const posted = slack.filter((c) => c.method === 'chat.postMessage' && /didn’t finish: “gil-guard” to “gil-new”/.test(JSON.stringify(c.body)));
  assert.equal(posted.length, 1, 'the heartbeat\'s post went out once');
  assert.deepEqual(await openPosts(), [], 'and is no longer open');
  const update = slack.find((c) => c.method === 'chat.update');
  assert.match(JSON.stringify(update?.body || {}), /Resolved/, 'the same post edited to Resolved');
});

test('a post that goes out with the rename still waiting stays open: nothing says it\'s settled when it isn\'t', async () => {
  await gilStuck();
  assert.equal(slack.filter((c) => c.method === 'chat.update').length, 0);
  assert.deepEqual((await openPosts()).map((p) => p.key), ['rename-finish:gil-guard']);
});
