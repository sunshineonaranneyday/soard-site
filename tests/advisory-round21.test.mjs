/**
 * Advisory Board QA round 21 (Nov 22 2026), the admin tester's findings, on the server:
 *   1  a write about a member lands at the address that member has at the moment it's written, whatever order it and a
 *      People rename (or a swap of two people's addresses) happen in: each kind of write, held at every statement it
 *      makes while the rename runs, and the rename held at every statement it makes while the write runs
 *      (tests/lib/interleave.mjs). After either: the record at their address, nothing left to finish, the old address
 *      free; a press that meets a rename still moving records off its address is told so (503) and nothing is written;
 *      the notice to whoever runs the group names whose record the answer landed on
 *   2  true words when a link can't take an answer: expired, left the Advisory Board, a change of address under way,
 *      nobody's; GET and POST the same
 *   8  (Board QA round 9) an Advisory Board meeting saved with an address its person has left saves their new one, as a
 *      Board meeting's save does; a check of People that fails refuses the save in words
 * Made-up people only (the repo is public); Resend, Slack and Google are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round21.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BY, P, Q, TOKEN, TOKEN_Q, hashOf, fresh, quietly, RENAMES, slugs, team, KINDS, SAVES, STAFF, sweep, restoreFetch, sent,
} from './lib/advisory-r21-world.mjs';
import * as W from './lib/advisory-r21-world.mjs';

after(restoreFetch);

// (every kind against a rename; the two the tester reported against a swap as well, here: every kind against a swap
// is test-results/qa21-fix/11-unit-sweep.mjs, a few minutes)
const SWAPPED = ['an “I can help” press in the monthly ask’s email', 'the monthly ask going out (each member’s link)'];
for (const [name, kind] of Object.entries(KINDS)) {
  for (const renameKind of SWAPPED.includes(name) ? ['plain', 'swap'] : ['plain']) {
    test(`1: ${name} at the moment of a ${renameKind === 'plain' ? 'rename' : 'swap of two addresses'}: lands at the member’s address now, every order`, async () => {
      const r = await sweep(name, kind, renameKind);
      assert.ok(r.nw > 0 && r.nr > 0);
    });
  }
}
for (const [name, kind] of Object.entries(SAVES)) {
  test(`8: ${name} at the moment of a rename: saved at her address now, every order`, async () => {
    const r = await sweep(name, kind, 'plain');
    assert.ok(r.nw > 0 && r.nr > 0);
  });
}
for (const [name, kind] of Object.entries(STAFF)) {
  test(`1: ${name} at the moment of a rename: at someone’s address now, or refused in words, every order`, async () => {
    const r = await sweep(name, kind, 'plain', { staff: true });
    assert.ok(r.nw > 0 && r.nr > 0);
  });
}

// ─── The press: what the old code did, what it does now ───────────────────

test('1: a press during a rename: the old address’s answer was nobody’s; now it’s his, and the notice names him', async () => {
  const { h, env } = await fresh();
  // (held just before it writes, as the tester's sqlslow held it: the rename runs meanwhile)
  const mail = await import('../functions/api/_advisory-mail.js');
  const nw = (await h.count('write', () => mail.answerFromLink(env.DB, TOKEN, { answer: 'no', note: 'count' }))).n;
  const { h: h2, env: env2 } = await fresh();
  const r = await h2.heldAt('write', nw, () => mail.answerFromLink(env2.DB, TOKEN, { answer: 'yes', note: 'held' }), () => RENAMES.plain(env2));
  assert.ok(r.hit && r.first.ok, JSON.stringify(r.first.err?.message));
  assert.deepEqual(await slugs(env2.DB, "SELECT slug FROM advisory_answers WHERE note = 'held'"), ['pia-new']);
  assert.equal(r.first.ok.name, P.name);
  assert.equal(await (await import('../functions/api/_people-address.js')).addressTaken(env2.DB, P.slug), null);
});

test('1: while a rename’s records are still moving off its address, a press is told to try again in a few minutes and nothing is written', async () => {
  const { env } = await fresh();
  // (a rename that stopped partway: its note there, the person moved, their link not yet)
  await env.DB.prepare("INSERT INTO board_state (key, data, updated_at) VALUES ('rename-finish:pia-swap', ?, ?)").bind(JSON.stringify({ from: P.slug, to: 'pia-new', at: new Date().toISOString(), by: BY }), new Date().toISOString()).run();
  await env.DB.prepare("UPDATE team SET slug = 'pia-new', data = json_set(data, '$.slug', 'pia-new') WHERE slug = ?").bind(P.slug).run();
  await env.DB.prepare("UPDATE reveal_board_emails SET slug = 'pia-new' WHERE slug = ?").bind(P.slug).run();
  const { onRequestGet, onRequestPost } = await import('../functions/api/advisory-action.js');
  const url = `https://x/api/advisory-action?t=${encodeURIComponent(TOKEN)}&do=yes`;
  const form = new FormData(); form.set('t', TOKEN); form.set('do', 'yes'); form.set('note', 'My cousin <b>');
  for (const res of [await onRequestGet({ env, request: new Request(url) }), await onRequestPost({ env, request: new Request(url, { method: 'POST', body: form }) })]) {
    const page = await res.text();
    assert.equal(res.status, 503);
    assert.match(page, /<h1>We couldn’t take your answer just now<\/h1><p>Please try again in a few minutes\.<\/p>/);
    assert.match(page, /Try again/);
  }
  const post = await (await onRequestPost({ env, request: new Request(url, { method: 'POST', body: form }) })).text();
  assert.match(post, /name="note" value="My cousin &lt;b&gt;"/, 'what they typed is kept for the press again, escaped');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_answers').first()).n, 0, 'nothing half-written');
  // Finished: the press goes through, at his new address
  await (await import('../functions/api/_rename-finish.js')).finishRename(env.DB, P.slug, 'pia-new', { by: BY });
  assert.equal((await onRequestPost({ env, request: new Request(url, { method: 'POST', body: form }) })).status, 200);
  assert.deepEqual(await slugs(env.DB, 'SELECT slug FROM advisory_answers'), ['pia-new']);
});

test('1: the ask’s log says who got no link, and why: never a link at an address nobody has', async () => {
  const mail = await import('../functions/api/_advisory-mail.js');
  // (held just after the first link is written: both then leave the Advisory Board, as the ask is going out)
  const links = (env) => env.DB.prepare("SELECT COUNT(*) AS n FROM advisory_links WHERE ask_id = 'ask_left'").first().then((r) => r.n);
  let done = null;
  for (let k = 1; k < 60 && !done; k++) {
    const { h, env } = await fresh();
    let seen = -1;
    const r = await h.heldAt('write', k, () => mail.sendAsk(env, { id: 'ask_left', title: 'Know a painter?' }), async () => {
      seen = await links(env);
      if (seen === 1) for (const who of [P, Q]) await env.DB.prepare("UPDATE team SET data = json_set(data, '$.status', 'alumni') WHERE slug = ?").bind(who.slug).run();
    });
    if (r.hit && seen === 1) done = { r, env };
  }
  assert.ok(done, 'held just after the first link');
  assert.ok(done.r.first.ok, done.r.first.err?.message);
  const entry = (await mail.mailLog(done.env.DB)).find((x) => x.id === 'ask_left');
  assert.equal(entry?.skipped?.length, 1, JSON.stringify(entry));
  assert.match(entry.what, /^This month’s ask: Know a painter\?\. Not sent to (Pia|Quin) Swap \(not on the Advisory Board by then\)\.$/);
  assert.equal(sent.length, 1, 'one email, to the one whose link was written');
  const people = await team(done.env.DB);
  assert.deepEqual((await slugs(done.env.DB, "SELECT slug FROM advisory_links WHERE ask_id = 'ask_left'")).filter((x) => !people.includes(x)), []);
});

// ─── 2: true words for each link that can't take an answer ───────────────────

test('2: each case its own words, GET and POST the same', async () => {
  const { env } = await fresh();
  const { onRequestGet, onRequestPost } = await import('../functions/api/advisory-action.js');
  const both = async (t) => {
    const url = `https://x/api/advisory-action?t=${encodeURIComponent(t)}&do=yes`;
    const form = new FormData(); form.set('t', t); form.set('do', 'yes');
    const g = await onRequestGet({ env, request: new Request(url) });
    const p = await onRequestPost({ env, request: new Request(url, { method: 'POST', body: form }) });
    const [gt, pt] = [await g.text(), await p.text()];
    const words = (x) => (x.match(/<h1>[\s\S]*?<\/p>/) || [''])[0];
    assert.equal(words(gt), words(pt), 'GET and POST say the same');
    assert.equal(g.status, p.status);
    return { status: g.status, words: words(gt), page: gt };
  };
  // Expired by date
  await env.DB.prepare("UPDATE advisory_links SET expires = '2020-01-01T00:00:00.000Z' WHERE hash = ?").bind(await hashOf(TOKEN)).run();
  let r = await both(TOKEN);
  assert.equal(r.status, 410);
  assert.equal(r.words, '<h1>This link has expired</h1><p>You can still answer on the Advisory Board page.</p>');
  assert.match(r.page, /Open the page/);
  // Left the Advisory Board (alumni): no page to answer on, and no link to it
  await env.DB.prepare("UPDATE advisory_links SET expires = '2099-01-01T00:00:00.000Z' WHERE hash = ?").bind(await hashOf(TOKEN)).run();
  await env.DB.prepare("UPDATE team SET data = json_set(data, '$.status', 'alumni') WHERE slug = ?").bind(P.slug).run();
  r = await both(TOKEN);
  assert.equal(r.status, 410);
  assert.equal(r.words, '<h1>Thank you for your time on SOARD’s Advisory Board</h1><p>This link was for current Advisory Board members, so it doesn’t take answers anymore.</p>');
  assert.doesNotMatch(r.page, /Open the page|admin\/advisory/);
  // (expired as well as left: still the words for someone who left)
  await env.DB.prepare("UPDATE advisory_links SET expires = '2020-01-01T00:00:00.000Z' WHERE hash = ?").bind(await hashOf(TOKEN)).run();
  assert.match((await both(TOKEN)).words, /Thank you for your time/);
  // Nobody's: an unknown token, and an address left with nobody there ("Leave them")
  for (const t of ['nope-not-a-link', TOKEN_Q]) {
    if (t === TOKEN_Q) await env.DB.prepare('DELETE FROM team WHERE slug = ?').bind(Q.slug).run();
    r = await both(t);
    assert.equal(r.status, 410);
    assert.equal(r.words, '<h1>This link doesn’t work anymore</h1><p>If you’re on SOARD’s Advisory Board, you can answer on the Advisory Board page.</p>');
    assert.match(r.page, /Open the page/);
  }
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_answers').first()).n, 0);
  // (no dashes, and "Advisory Board member" never shortened, in any of them)
  for (const t of ['nope', TOKEN, TOKEN_Q]) assert.doesNotMatch((await both(t)).page.replace(/<style[\s\S]*?<\/style>/, ''), /[—–]|advisor\b|advisors\b/);
});

// ─── 8: an Advisory Board meeting saved with an address its person has left ───────────────────

test('8: a meeting saved after a rename, from a page that named the old address, saves the new one (as Board’s), and the old address is free', async () => {
  const { env } = await fresh();
  const meet = await import('../functions/api/_advisory-meetings.js');
  const m = await meet.getAdvisoryMeeting(env.DB, W.MEETING);
  await RENAMES.plain(env);
  // (a fresh base, as the tester's: the meeting as it is after the rename, and an item the page still lists her under)
  const base = (await meet.getAdvisoryMeeting(env.DB, W.MEETING)).updatedAt;
  const sections = m.sections.map((s, i) => (i === 0 ? { ...s, items: [{ ...s.items[0], who: [P.slug] }] } : s));
  const saved = await meet.saveAdvisoryMeeting(env.DB, { ...m, sections }, { by: BY, base });
  assert.deepEqual(saved.sections[0].items[0].who, ['pia-new']);
  assert.deepEqual(saved.addressesNow, { [P.slug]: 'pia-new' }, 'said, so the page takes the same');
  const stored = JSON.parse((await env.DB.prepare('SELECT data FROM advisory_meetings WHERE id = ?').bind(W.MEETING).first()).data);
  assert.deepEqual(stored.sections[0].items[0].who, ['pia-new']);
  await quietly(() => heartbeat(env));
  assert.equal(await (await import('../functions/api/_people-address.js')).addressTaken(env.DB, P.slug), null, 'nothing holds the old address');
});
const heartbeat = async (env) => (await import('../functions/api/_rename-finish.js')).maybeFinishRenames(env.DB, { now: Date.now() + 10 * 60 * 1000 });

test('8: a check of People that can’t be made refuses the save in words, and nothing is saved', async () => {
  const { env } = await fresh();
  const meet = await import('../functions/api/_advisory-meetings.js');
  const m = await meet.getAdvisoryMeeting(env.DB, W.MEETING);
  await RENAMES.plain(env);
  const sections = m.sections.map((s, i) => (i === 0 ? { ...s, items: [{ ...s.items[0], title: 'Typed words', who: [P.slug] }] } : s));
  // (the read of who was renamed, the audit log, fails)
  const real = env.DB.prepare;
  env.DB.prepare = (sql) => { if (/FROM audit_log/.test(sql)) throw new Error('D1_ERROR: the database didn’t answer'); return real(sql); };
  const base = (await meet.getAdvisoryMeeting(env.DB, W.MEETING)).updatedAt;
  const r = await quietly(() => meet.meetingAction({ env }, { action: 'save-meeting', body: { meeting: { ...m, sections }, base }, by: BY, w: { runs: true } }));
  env.DB.prepare = real;
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, error: 'We couldn’t check People just now, so nothing was changed. Please try again in a moment.' });
  const stored = JSON.parse((await env.DB.prepare('SELECT data FROM advisory_meetings WHERE id = ?').bind(W.MEETING).first()).data);
  assert.notEqual(stored.sections[0].items[0].title, 'Typed words', 'nothing saved');
});
