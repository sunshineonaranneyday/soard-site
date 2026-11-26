/**
 * Advisory Board QA round 25 (Nov 24 2026), the admin tester's findings, on the server:
 *   1  the monthly ask emailed twice: putting it out and emailing it is one write (the ask out, and an email owed to each
 *      member, claimed), then each goes under its own key and is marked with its send. The write failing: 503, nothing
 *      changed. Landed, anything failing after it is said as what was done (200), the heartbeat sends what's still owed,
 *      once, and `mailed` (the card's "Email it") comes from the claim, never from a log written after the send
 *   2  an update email lost: an introduction's or a fundraiser's status and the member's update email are one write, the
 *      email's reads before it; it goes keyed by the record, the status and that change; pressed again with no change, one
 *      left owed goes; changed again before it went, only the newest goes. The lead's notices, the nudge, a gift's note
 *      and the goal's emails are owed and sent the same way
 *   4  a new ask, wish or paper saved twice: its id is the page's, made once for the form; one already at that id is
 *      answered as saved; an id-less one (a tab opened before) with the same words as one the same person just saved is
 *      that one. A note's own key the same
 *   5  "a welcome will go" is one fact: an email on file that signs them in, and a welcome owed (the box's welcomeWaiting);
 *      with none that does, it waits for their own, and adding it on People sends it, once
 *   7  who hears about new applications: Save answers from its own write (RETURNING), never a read after it
 * 3 and 6 (the page re-reading after a failed press, and the panel's partway line) are in the page:
 * scripts/test-advisory-round25.mjs. Every statement of each press failing in turn: tests/advisory-round25-sweeps.test.mjs.
 * Made-up people only (the repo is public); Resend and Access are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round25.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, press, runIt, appsPress, heartbeat, memberMakes, faulty, quietly, resend, mails, restoreFetch, MEMBERS } from './lib/advisory-r25-world.mjs';
import { readState, writeState } from '../functions/api/_board-roles.js';

after(restoreFetch);

const [ONA, REX] = MEMBERS;
const ASK = /^This month’s ask: /;
const LOG_WRITE = "UPDATE board_state SET data = json_set(CASE WHEN json_valid(data) THEN data ELSE '{}' END, ?, json(?)), updated_at = ? WHERE key = ?";
const LOOKUP = 'SELECT t.slug AS slug, t.data AS data, e.email AS email FROM team AS t LEFT JOIN reveal_board_emails AS e ON e.slug = t.slug';
/** The k-th statement with exactly this SQL (1 = its first) fails, `how` */
const nth = (sql, k = 1, how = 'before') => { let seen = 0; return (x) => (x === sql && ++seen === k ? how : null); };
const askNow = async (env, id) => env.DB.prepare('SELECT sent_at, closed_at, data FROM advisory_asks WHERE id = ?').bind(id).first();
const each = (re) => Object.fromEntries(MEMBERS.map((m) => [m.email, mails(m.email, re)]));

async function draftAsk(env, title = 'Do you know a roofer?') {
  const r = await press(env, { action: 'save-ask', ask: { id: 'ask_roofqaaaaa', title, body: 'Can you share this?', link: '' } });
  assert.equal(r.status, 200, r.error);
  return r.ask.id;
}

// ─── 1: the monthly ask ─────────────────────────────────────────────

test('1: put out and emailed, the mail log\'s write failing after the emails went: 200, said as emailed, each member once; the card never offers Email it, and Email it pressed anyway emails nobody a second time', async () => {
  const env = await world();
  const id = await draftAsk(env);
  const f = faulty(env.DB, nth(LOG_WRITE));
  const r = await quietly(() => press({ ...env, DB: f.DB }, { action: 'send-ask', id, emailsOk: true }));
  assert.equal(f.state.hit.length, 1, 'the mail log\'s write failed');
  assert.deepEqual([r.status, r.said], [200, 'It’s out, and emailed to 2 Advisory Board members.'], JSON.stringify(r).slice(0, 300));
  assert.deepEqual(each(ASK), { [ONA.email]: 1, [REX.email]: 1 });
  const card = (await runIt(env)).asks.find((a) => a.id === id);
  assert.equal(card.mailed, true, 'the card: emailed (no "Email it to the Advisory Board")');
  const again = await press(env, { action: 'email-ask', id });
  assert.deepEqual([again.status, again.said], [200, 'The Advisory Board already had this email.']);
  await heartbeat(env);
  assert.deepEqual(each(ASK), { [ONA.email]: 1, [REX.email]: 1 }, 'never a second');
});

test('1: People not answering as the ask goes out: nothing changed (503: the ask isn\'t out, nothing sent); pressed again, it\'s out and each member has it once', async () => {
  const env = await world();
  const id = await draftAsk(env);
  const f = faulty(env.DB, nth(LOOKUP));
  const r = await quietly(() => press({ ...env, DB: f.DB }, { action: 'send-ask', id, emailsOk: true }));
  assert.equal(f.state.hit.length, 1);
  assert.deepEqual([r.status, r.error], [503, 'We couldn’t check People just now, so the ask isn’t out and nothing was sent. Please try again in a moment.']);
  assert.equal((await askNow(env, id)).sent_at, null, 'not out');
  assert.deepEqual(each(ASK), { [ONA.email]: 0, [REX.email]: 0 });
  const r2 = await press(env, { action: 'send-ask', id, emailsOk: true });
  assert.deepEqual([r2.status, r2.said], [200, 'It’s out, and emailed to 2 Advisory Board members.']);
  await heartbeat(env);
  assert.deepEqual(each(ASK), { [ONA.email]: 1, [REX.email]: 1 });
});

test('1: one member\'s email not going just now: 200, "It went to 1 Advisory Board member; the other 1 gets it in a few minutes", the card emailed; the heartbeat sends it, once', async () => {
  const env = await world();
  const id = await draftAsk(env);
  resend.refuse.add(REX.email);
  const r = await quietly(() => press(env, { action: 'send-ask', id, emailsOk: true }));
  assert.deepEqual([r.status, r.said], [200, 'The ask is out. It went to 1 Advisory Board member; the other 1 gets it in a few minutes.']);
  assert.equal((await runIt(env)).asks.find((a) => a.id === id).mailed, true, 'owed is emailed: never offered again');
  resend.refuse.clear();
  await heartbeat(env);
  await heartbeat(env, 20 * 60 * 1000);
  assert.deepEqual(each(ASK), { [ONA.email]: 1, [REX.email]: 1 });
});

test('1: the email service down for the whole ask: it\'s out, its emails go in a few minutes; the heartbeat sends each once; an ask closed meanwhile sends nothing more', async () => {
  const env = await world();
  const id = await draftAsk(env);
  resend.down = true;
  const r = await quietly(() => press(env, { action: 'send-ask', id, emailsOk: true }));
  assert.deepEqual([r.status, r.said], [200, 'The ask is out. Its email goes to 2 Advisory Board members in a few minutes.']);
  resend.down = false;
  await heartbeat(env);
  await heartbeat(env, 30 * 60 * 1000);
  assert.deepEqual(each(ASK), { [ONA.email]: 1, [REX.email]: 1 });
  // (closed before its emails went: nothing goes for it)
  const env2 = await world();
  const id2 = await draftAsk(env2);
  resend.down = true;
  await quietly(() => press(env2, { action: 'send-ask', id: id2, emailsOk: true }));
  resend.down = false;
  assert.equal((await press(env2, { action: 'close-ask', id: id2 })).status, 200);
  await heartbeat(env2);
  assert.equal(resend.delivered.length, 0, 'a closed ask emails nobody');
});

test('1: put out with the emails off, then Email it: one write claims each member\'s email, each goes once, and a second Email it sends nobody anything', async () => {
  const env = await world({ emails: false });
  const id = await draftAsk(env);
  const r = await press(env, { action: 'send-ask', id });
  assert.deepEqual([r.status, r.said], [200, 'It’s on the page. Emails are off, so nothing was sent.']);
  await writeState(env.DB, 'advisory', { ...(await readState(env.DB, 'advisory')), emails: true });
  assert.equal((await runIt(env)).asks.find((a) => a.id === id).mailed, false, 'offered: never emailed');
  const e1 = await press(env, { action: 'email-ask', id });
  assert.deepEqual([e1.status, e1.said], [200, 'Emailed to 2 Advisory Board members.']);
  const e2 = await press(env, { action: 'email-ask', id });
  assert.deepEqual([e2.status, e2.said], [200, 'The Advisory Board already had this email.']);
  await heartbeat(env);
  assert.deepEqual(each(ASK), { [ONA.email]: 1, [REX.email]: 1 });
});

test('1: Email it with the emails switched off sends nothing; an ask with nobody it can go to is never marked emailed, so Email it stays offered', async () => {
  const env = await world({ emails: false });
  const id = await draftAsk(env);
  await press(env, { action: 'send-ask', id });
  const off = await press(env, { action: 'email-ask', id });
  assert.deepEqual([off.status, off.said], [200, 'Nothing went out: emails are off.']);
  assert.equal(resend.delivered.length, 0);
  const none = await world({ members: [{ slug: 'nan-noemailqa', name: 'Nan Noemailqa' }] });
  const id2 = await draftAsk(none);
  const r = await press(none, { action: 'send-ask', id: id2, emailsOk: true });
  assert.deepEqual([r.status, r.said], [200, 'It’s on the page, but no Advisory Board member has an email the site can send it to.']);
  assert.equal((await runIt(none)).asks.find((a) => a.id === id2).mailed, false, 'still offered');
});

test('1: each ask email goes under its own key, from the ask and the member', async () => {
  const env = await world();
  const id = await draftAsk(env);
  await press(env, { action: 'send-ask', id, emailsOk: true });
  assert.deepEqual(resend.delivered.filter((m) => ASK.test(m.subject)).map((m) => m.key).sort(), MEMBERS.map((m) => `advisory-ask:${id}:${m.email}:0`).sort());
});

// ─── 2: an introduction's and a fundraiser's update email ─────────────

for (const [kind, action, status, re, marked] of [['intro', 'intro-status', 'talking', /^An update on /, 'talking'], ['hosted', 'hosted-status', 'not-now', /^Your fundraiser: /, 'not-now']]) {
  const table = kind === 'intro' ? 'advisory_intros' : 'advisory_hosted';
  const body = (id) => ({ action, id, status, note: '', ...(kind === 'hosted' ? { date: '', giveUrl: '' } : {}) });
  const statusOf = async (env, id) => (await env.DB.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(id).first()).status;
  const made = async (env) => (await memberMakes(env, ONA, kind === 'intro' ? 'intro' : 'host')).id;

  test(`2 (${kind}): People not answering for the update email: nothing changed (503, "nothing was changed"), the status as it was; pressed again, it's set and Ona is emailed once`, async () => {
    const env = await world();
    const id = await made(env);
    const was = await statusOf(env, id);
    const f = faulty(env.DB, nth(LOOKUP));
    const r = await quietly(() => press({ ...env, DB: f.DB }, body(id)));
    assert.equal(f.state.hit.length, 1);
    assert.deepEqual([r.status, r.error], [503, 'We couldn’t check People just now, so nothing was changed. Please try again in a moment.']);
    assert.equal(await statusOf(env, id), was, 'nothing changed');
    const r2 = await press(env, body(id));
    assert.deepEqual([r2.status, r2.said], [200, 'Ona was emailed.']);
    assert.equal(await statusOf(env, id), marked);
    await heartbeat(env);
    assert.equal(mails(ONA.email, re), 1);
  });

  test(`2 (${kind}): the update email not going just now: set, "Ona's email goes in a few minutes", and the heartbeat sends it once`, async () => {
    const env = await world();
    const id = await made(env);
    resend.down = true;
    const r = await quietly(() => press(env, body(id)));
    assert.deepEqual([r.status, r.said], [200, 'Ona’s email goes in a few minutes.']);
    assert.equal(await statusOf(env, id), marked);
    resend.down = false;
    await heartbeat(env);
    await heartbeat(env, 20 * 60 * 1000);
    assert.equal(mails(ONA.email, re), 1);
  });

  test(`2 (${kind}): pressed again with no change, the update an earlier press left owed goes (it's owed by the write, never by "changed")`, async () => {
    const env = await world();
    const id = await made(env);
    resend.down = true;
    await quietly(() => press(env, body(id)));
    resend.down = false;
    const r = await press(env, body(id));
    assert.deepEqual([r.status, r.said], [200, 'Ona was emailed.']);
    await heartbeat(env);
    assert.equal(mails(ONA.email, re), 1);
  });

  test(`2 (${kind}): the status changed again before its update went: only the newest goes, one email saying where it stands now`, async () => {
    const env = await world();
    const id = await made(env);
    resend.down = true;
    await quietly(() => press(env, body(id)));
    const next = kind === 'intro' ? 'yes' : 'approved';
    await quietly(() => press(env, { ...body(id), status: next }));
    resend.down = false;
    await heartbeat(env);
    await heartbeat(env, 20 * 60 * 1000);
    const got = resend.delivered.filter((m) => [m.to].flat().includes(ONA.email) && re.test(m.subject));
    assert.equal(got.length, 1, 'one email');
    assert.match(got[0].html, kind === 'intro' ? /Said yes/ : /Approved/, 'where it stands now');
  });

  test(`2 (${kind}): its key is the record, the status and that change`, async () => {
    const env = await world();
    const id = await made(env);
    await press(env, body(id));
    const m = resend.delivered.find((x) => re.test(x.subject));
    assert.match(m.key, new RegExp(`^advisory-update:${kind}:${id}:${status}:\\d{4}-\\d\\d-\\d\\dT[^:]+:\\d\\d:\\d\\d\\.\\d{3}Z:0$`));
  });
}

test('2: the lead\'s notice, owed in the member\'s own write and keyed by what it\'s about: Resend down when a member makes an introduction, the heartbeat sends it once', async () => {
  const env = await world();
  const portal = await import('../functions/api/advisory-portal.js');
  resend.down = true;
  const res = await quietly(() => portal.onRequestPost({ env, data: { advisor: { slug: ONA.slug, name: ONA.name, email: ONA.email } }, waitUntil: () => {},
    request: new Request('https://site.test/api/advisory-portal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'intro', id: 'in_noticeqaaaa', name: 'Pat Introqa', company: 'Testco' }) }) }));
  assert.equal(res.status, 200);
  resend.down = false;
  await heartbeat(env);
  await heartbeat(env, 20 * 60 * 1000);
  const got = resend.delivered.filter((m) => / made an introduction$/.test(m.subject));
  assert.deepEqual([got.length, got[0]?.key], [1, 'advisory-notice:intro:in_noticeqaaaa:0']);
});

test('2: the weekly nudge is owed with when it was owed, in one write: its email not going, the heartbeat sends it once and the next look nudges nobody again', async () => {
  const env = await world();
  const mail = await import('../functions/api/_advisory-mail.js');
  await env.DB.prepare("INSERT INTO advisory_intros (id, slug, status, data, at, updated_at) VALUES ('in_oldqaaaaa', ?, 'thanks', '{\"name\":\"Pat\"}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").bind(ONA.slug).run();
  resend.down = true;
  assert.ok(await quietly(() => mail.maybeNudgeLead(env)), 'nudged');
  resend.down = false;
  assert.equal(await mail.maybeNudgeLead(env), null, 'not again: its time is written with it');
  await heartbeat(env);
  assert.equal(resend.delivered.filter((m) => m.subject === 'The Advisory Board has things waiting').length, 1);
});

test('2: a gift\'s note and the goal\'s emails are owed in the money\'s own write, and the heartbeat sends each once', async () => {
  const env = await world();
  const mail = await import('../functions/api/_advisory-mail.js');
  const { getSettings } = await import('../functions/api/_advisory.js');
  const stmts = [...await mail.giftOwed(env, { [ONA.slug]: { n: 2, ids: ['pay_a', 'pay_b'] } }), ...await mail.goalOwed(env, await getSettings(env.DB), { raised: 30000 })];
  // (the same gifts seen twice are one note)
  stmts.push(...await mail.giftOwed(env, { [ONA.slug]: { n: 2, ids: ['pay_b', 'pay_a'] } }));
  await env.DB.batch(stmts);
  await heartbeat(env);
  await heartbeat(env, 20 * 60 * 1000);
  assert.equal(mails(ONA.email, /^A gift came through your page$/), 1);
  assert.deepEqual(each(/^You reached the goal$/), { [ONA.email]: 1, [REX.email]: 1 });
  assert.deepEqual(resend.delivered.filter((m) => m.subject === 'The Advisory Board reached its goal').map((m) => [m.to].flat()[0]).sort(), ['info@soardcharity.com', 'quinn.founderqa@soardcharity.com'], 'the notice to whoever runs the group (info@ while nobody does) and the admins, once each');
});

// ─── 4: a new ask, wish or paper, saved once ─────────────────────────

const SAVES = [
  ['an ask', 'save-ask', 'ask', { id: 'ask_newqaaaaaa', title: 'Do you know a painter?', body: 'Two rooms.', link: '' }, "INSERT INTO advisory_asks (id, data, at, by) VALUES (?, ?, ?, ?) ON CONFLICT(id)", 'advisory_asks'],
  ['a wish', 'save-wish', 'wish', { id: 'w_newqaaaaaaa', title: 'A licensed electrician', detail: 'North Fulton' }, 'INSERT INTO advisory_wishlist (id, data, sort, at, by)', 'advisory_wishlist'],
  ['a paper', 'save-doc', 'doc', { id: 'ad_newqaaaaaa', kind: 'pitch', title: 'Our 30-second pitch', body: 'Kids, rooms, joy.', shared: true }, 'INSERT OR REPLACE INTO advisory_docs', 'advisory_docs'],
];
for (const [label, action, field, raw, insert, table] of SAVES) {
  for (const withId of [true, false]) {
    test(`4: ${label} saved new${withId ? ' (the page\'s id)' : ' with no id (a tab opened before)'}, its write landing with its answer lost: pressed again, it\'s the one saved, never a second`, async () => {
      const env = await world();
      const sent = withId ? raw : Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'id'));
      const f = faulty(env.DB, (sql) => (sql.startsWith(insert) && !f.state.hit.length ? 'after' : null));
      const r1 = await quietly(() => press({ ...env, DB: f.DB }, { action, [field]: sent }));
      assert.equal(f.state.hit.length, 1, 'its write landed, its answer lost');
      // (said as saved: looked for at its id. Pressed again as the page would, the same)
      if (withId) assert.equal(r1.status, 200, r1.error);
      const r2 = await press(env, { action, [field]: sent });
      assert.equal(r2.status, 200, r2.error);
      const n = (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE json_extract(data, '$.title') = ?`).bind(raw.title).first()).n;
      assert.equal(n, 1, 'one, never a second');
    });
  }
}

test('4: a note on an application, its write landing with its answer lost: pressed again with its key, it\'s there once', async () => {
  const env = await world();
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  await ensureAdvisorySchema(env.DB);
  await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, created_at, updated_at) VALUES ('adv-noteqa-0001', 'site', 'Nora Noteqa', 'nora.noteqa@example.org', '{}', 'new', ?, ?)").bind(new Date().toISOString(), new Date().toISOString()).run();
  const note = { id: 'adv-noteqa-0001', text: 'Called her, she can start in March.', key: 'n0123456789abcdef' };
  const f = faulty(env.DB, (sql) => (/^UPDATE advisory_applications SET notes/.test(sql) && !f.state.hit.length ? 'after' : null));
  await quietly(() => appsPress({ ...env, DB: f.DB }, { note }));
  assert.equal(f.state.hit.length, 1);
  const r2 = await appsPress(env, { note });
  assert.equal(r2.status, 200, r2.error);
  assert.equal(r2.application.notes.filter((x) => x.text === note.text).length, 1, 'once');
});

// ─── 5: "a welcome will go", one fact ───────────────────────────────

test('5: a Joined application whose person has no email that signs them in: the box never says their welcome goes by itself (welcomeWaiting false); with one that does, it does', async () => {
  const env = await world({ members: [...MEMBERS, { slug: 'wren-partqa', name: 'Wren Partqa' }, { slug: 'sol-partqa', name: 'Sol Partqa', email: 'sol.partqa@soardcharity.com' }] });
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  const { addPlan } = await import('../functions/api/_advisory-add.js');
  const { queueWelcome } = await import('../functions/api/_advisory-mail.js');
  await ensureAdvisorySchema(env.DB);
  const at = new Date().toISOString();
  for (const [id, name, email, slug] of [['adv-wrenqa-0001', 'Wren Partqa', 'wren.partqa@soardcharity.com', 'wren-partqa'], ['adv-solqa-00001', 'Sol Partqa', 'sol.own@example.org', 'sol-partqa'], ['adv-onaqa-00001', 'Ona Askqa', ONA.email, ONA.slug]]) {
    await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, person_slug, created_at, updated_at) VALUES (?, 'site', ?, ?, '{}', 'joined', ?, ?, ?)").bind(id, name, email, slug, at, at).run();
    await queueWelcome(env.DB, slug, { by: 'x' });
  }
  const plan = async (id) => addPlan(env, id);
  assert.deepEqual([(await plan('adv-wrenqa-0001')).kind, (await plan('adv-wrenqa-0001')).welcomeWaiting], ['joined', false], 'no email on file: nothing goes by itself');
  assert.deepEqual([(await plan('adv-solqa-00001')).kind, (await plan('adv-solqa-00001')).welcomeWaiting], ['joined', false], 'a SOARD address on file: nothing goes by itself');
  assert.deepEqual([(await plan('adv-onaqa-00001')).kind, (await plan('adv-onaqa-00001')).welcomeWaiting], ['joined', true], 'their own on file: it goes');
});

test('5: "their sign-in email goes once it\'s there" is true: their own email added on People, the heartbeat sends their welcome, once', async () => {
  const env = await world({ members: [...MEMBERS, { slug: 'wren-partqa', name: 'Wren Partqa' }] });
  const { queueWelcome } = await import('../functions/api/_advisory-mail.js');
  const { setBoardEmail } = await import('../functions/api/_reveal-invites.js');
  const { syncBoardAccess } = await import('../functions/api/_board-access.js');
  await queueWelcome(env.DB, 'wren-partqa', { by: 'x', greet: 'Wren' });
  await syncBoardAccess(env);
  await heartbeat(env);
  const welcomes = () => resend.delivered.filter((m) => m.subject === 'Your Advisory Board page is ready' && [m.to].flat().includes('wren.own@example.org')).length;
  assert.equal(welcomes(), 0, 'none yet: no email');
  await setBoardEmail(env.DB, 'wren-partqa', 'wren.own@example.org');
  await syncBoardAccess(env);
  await heartbeat(env);
  await syncBoardAccess(env);
  await heartbeat(env, 20 * 60 * 1000);
  assert.equal(welcomes(), 1, 'once it\'s there, once');
});

// ─── 7: who hears about new applications ──────────────────────────

test('7: who hears about new applications: Save answers from its own write; the settings not read again after it never make a save that landed say it didn\'t', async () => {
  const env = await world();
  const READ = "SELECT key, value, updated_at, updated_by FROM advisory_settings WHERE key IN ('staffEmails', 'committee')";
  await appsPress(env, { settings: { staffEmails: 'first.hears@example.org', committee: '' } });
  // (the read that a save made before its write is let through; every one after it fails)
  let wrote = false;
  const f = faulty(env.DB, (sql) => { if (/^\[batch\] INSERT INTO advisory_settings/.test(sql)) { wrote = true; return null; } return wrote && sql === READ ? 'before' : null; });
  const r = await quietly(() => appsPress({ ...env, DB: f.DB }, { settings: { staffEmails: 'hears.qa@example.org', committee: '' } }));
  assert.deepEqual([r.status, r.settings?.staffEmails], [200, ['hears.qa@example.org']], JSON.stringify(r).slice(0, 200));
  const saved = await env.DB.prepare("SELECT value FROM advisory_settings WHERE key = 'staffEmails'").first();
  assert.deepEqual(JSON.parse(saved.value), ['hears.qa@example.org']);
  // (and its write landing with its answer lost: looked for, said as saved)
  const g = faulty(env.DB, (sql) => (/^\[batch\] INSERT INTO advisory_settings/.test(sql) ? 'after' : null));
  const r2 = await quietly(() => appsPress({ ...env, DB: g.DB }, { settings: { staffEmails: 'hears.two@example.org', committee: '' } }));
  assert.deepEqual([r2.status, r2.settings?.staffEmails], [200, ['hears.two@example.org']]);
});

// ─── An application's notices ───────────────────────────────────────

test('an application\'s notices go under their own keys: their note not saving, the heartbeat\'s next try sends the applicant and staff nothing twice', async () => {
  const env = await world();
  const { ensureAdvisorySchema, retryNotices } = await import('../functions/api/_advisory-applications.js');
  await ensureAdvisorySchema(env.DB);
  const at = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const answers = { fullName: 'Ivy Applyqa', email: 'ivy.applyqa@example.org', phone: '(770) 555-0142', why: 'To help.' };
  await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, created_at, updated_at) VALUES ('adv-applyqa-0001', 'site', ?, ?, ?, 'new', ?, ?)").bind(answers.fullName, answers.email, JSON.stringify(answers), at, at).run();
  const f = faulty(env.DB, (sql) => (/^UPDATE advisory_applications SET notified/.test(sql) && !f.state.hit.length ? 'before' : null));
  await quietly(() => retryNotices({ ...env, DB: f.DB }));
  assert.equal(f.state.hit.length, 1, 'the note didn\'t save');
  await quietly(() => retryNotices(env));
  assert.equal(mails('ivy.applyqa@example.org', /^We have your Advisory Board application$/), 1, 'the applicant\'s copy, once');
  assert.equal(resend.delivered.filter((m) => /^New Advisory Board application: Ivy Applyqa$/.test(m.subject)).length, 1, 'the staff email, once');
});
