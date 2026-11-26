/**
 * Advisory Board QA round 26 (Nov 24 2026), the admin tester's findings, on the server:
 *   1  a sign-in email sent by hand from Run it (a member's row, and Reaching the group's "Send the sign-in email to N")
 *      follows the send rule: every read it needs comes before the claim; the claim and the email being owed are one
 *      write (written down as waiting, with its key); a claim whose write landed with its answer lost is looked at and
 *      carried on; anything claimed and not sent is owed, and the heartbeat sends it once with the same key. The row and
 *      the group button's words come from those facts
 *   4  every Advisory Board email to a member goes only to their own address (the welcome's rule): never a SOARD group
 *      inbox or a staff address; People's editor says so when one is saved
 *   5  the "can help" notice is keyed by the ask, the member and the answer, never the moment of the press
 *   6  only Resend's yes says a welcome went (the row's press here; Add's: tests/advisory-round26-add.test.mjs)
 *   7  a gift credit and an application's status answer from their own write; one whose answer was lost is looked at
 * 2 and 3 (the partway panel's line, the ask card and its confirm) are page words: the tester's 35-* and 42-* scripts.
 * Every statement of each press failing in turn: tests/advisory-round26-sweeps.test.mjs.
 * Made-up people only (the repo is public); Resend and Access are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round26.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, press, runIt, appsPress, faulty, quietly, resend, mails, restoreFetch, MEMBERS, ctl, resendClear, WELCOME, NOTICE, LEAD, KINDS, signInKnows, memberPress, heartbeats, welcomeState, STAFF } from './lib/advisory-r26-world.mjs';
import { readState, writeState } from '../functions/api/_board-roles.js';

after(restoreFetch);

const [ONA, REX] = MEMBERS;
const ASK = /^This month’s ask: /;
// (People's private emails, read for who runs the group: the read the tester failed, after the claims in the old code)
const LEAD_READ = 'SELECT slug, email FROM reveal_board_emails';
// (the claim's own write: its conditions say which)
const isClaim = (sql) => /^UPDATE board_state SET data = json_set\(json_set\(/.test(sql) && /IS NULL OR \(json_type\(data, \?\) = 'object'/.test(sql);
const welcomeWorld = async (opts) => { resendClear(); const env = await world(opts); await signInKnows(env); return env; };
const rowPress = (env, slug = ONA.slug) => press(env, { action: 'send-welcome-to', slug });
const groupPress = (env, slugs = [ONA.slug]) => press(env, { action: 'send-welcome', slugs });
const rowOf = async (env, slug = ONA.slug) => (await runIt(env)).advisors.find((a) => a.slug === slug);

// ─── 1: the sign-in email sent by hand ────────────────────────────────

for (const [how, go] of [['their row', rowPress], ['Reaching the group', groupPress]]) {
  test(`1 (${how}): who runs the group's email failing to read changes nothing: 503 "nothing was sent", nothing claimed, the row offers the button, and the press again sends it once`, async () => {
    // (where that read is in a clean press: its last one)
    const c = await welcomeWorld();
    const f0 = faulty(c.DB);
    await quietly(() => go({ ...c, DB: f0.DB }));
    const k = f0.state.trace.lastIndexOf(LEAD_READ) + 1;
    assert.ok(k > 0, 'the press reads it');
    const env = await welcomeWorld();
    const f = faulty(env.DB, (sql, n) => (n === k ? 'before' : null));
    const r1 = await quietly(() => go({ ...env, DB: f.DB }));
    assert.equal(f.state.hit.length, 1, 'the read failed');
    assert.equal(r1.status, 503, JSON.stringify(r1));
    assert.match(r1.error, /nothing was sent/);
    assert.equal(mails(ONA.email, WELCOME), 0);
    const st = await welcomeState(env.DB);
    assert.equal(st.welcomed[ONA.slug], undefined, 'nothing claimed');
    assert.equal(st.waiting[ONA.slug], undefined, 'nothing owed');
    assert.deepEqual((await rowOf(env)).welcome, {}, 'the row offers the button, never "going out now"');
    const r2 = await go(env);
    assert.equal(r2.status, 200);
    assert.equal(r2.sent, 1, 'pressed again, as the words say: it goes');
    await heartbeats(env);
    assert.equal(mails(ONA.email, WELCOME), 1, 'once');
  });

  test(`1 (${how}): the claim's write landing with its answer lost is looked at and carried on: said sent, and sent once`, async () => {
    const env = await welcomeWorld();
    const f = faulty(env.DB, (sql) => (isClaim(sql) && !f.state.hit.length ? 'after' : null));
    const r1 = await quietly(() => go({ ...env, DB: f.DB }));
    assert.equal(f.state.hit.length, 1, 'the claim landed, its answer lost');
    assert.equal(r1.status, 200, JSON.stringify(r1));
    assert.equal(r1.sent, 1);
    assert.equal(mails(ONA.email, WELCOME), 1);
    await go(env);
    await heartbeats(env);
    assert.equal(mails(ONA.email, WELCOME), 1, 'once, never twice');
    assert.ok((await welcomeState(env.DB)).welcomed[ONA.slug]?.at, 'marked had');
  });
}

test('1: a claim left on its way past its window, by a request that died, is owed: the heartbeat sends it once, under the same key', async () => {
  const env = await welcomeWorld();
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  await writeState(env.DB, 'advisory-mail', { welcomed: { [ONA.slug]: { sending: old, sendingTo: ONA.email } } });
  assert.deepEqual((await rowOf(env)).welcome, { owed: true }, 'the row: goes in a few minutes, never "going out now"');
  await heartbeats(env);
  assert.equal(mails(ONA.email, WELCOME), 1);
  assert.deepEqual(resend.delivered.filter((m) => WELCOME.test(m.subject)).map((m) => m.key), [`advisory-welcome:${ONA.email}:0`]);
  assert.ok((await welcomeState(env.DB)).welcomed[ONA.slug]?.at, 'marked had');
});

test('1: a press that dies after its claim leaves the welcome written down as owed, with its key, in the claim\'s own write', async () => {
  const env = await welcomeWorld();
  // (the email service never answering, and the request ending there: the claim, and what it wrote with it)
  let seen = null;
  ctl.status = 503; ctl.times = 1;
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => { if (new URL(typeof input === 'string' ? input : input.url).host === 'api.resend.com') seen = await welcomeState(env.DB); return real(input, init); };
  try { await rowPress(env); } finally { globalThis.fetch = real; }
  assert.ok(seen.welcomed[ONA.slug]?.sending, 'claimed as it went');
  assert.equal(seen.waiting[ONA.slug]?.key, `advisory-welcome:${ONA.email}`, 'and owed, with its key, before it went');
  assert.equal(seen.waiting[ONA.slug]?.hand, true, 'a person\'s press: it goes with the emails off too');
});

test('1: the group button\'s words come from what happened: "they\'ve all had it already" only when they have', async () => {
  const env = await welcomeWorld();
  await writeState(env.DB, 'advisory-mail', { welcomed: { [ONA.slug]: { sending: new Date().toISOString(), sendingTo: ONA.email } } });
  const going = await groupPress(env);
  assert.equal(going.status, 200);
  assert.doesNotMatch(going.said, /had it already/, 'one on its way is never "had it"');
  assert.match(going.said, /on its way/);
  const r = await groupPress(env, [REX.slug]);
  assert.equal(r.said, 'Sent to 1 Advisory Board member.');
  const had = await groupPress(env, [REX.slug]);
  assert.equal(had.said, 'Nothing went out: they’ve all had it already.');
});

// ─── 6: only Resend's yes says a welcome went (the row's press) ────────

test('6: a gateway\'s 502 for the row\'s sign-in email: owed, never "sent", and the heartbeat sends it once under the same key', async () => {
  const env = await welcomeWorld();
  ctl.status = 502; ctl.times = 1;
  const r = await rowPress(env);
  assert.equal(r.status, 200);
  assert.equal(r.owed, 1, JSON.stringify(r));
  assert.equal(r.sent, undefined, 'never said sent');
  assert.deepEqual((await rowOf(env)).welcome, { owed: true });
  await heartbeats(env);
  assert.equal(mails(ONA.email, WELCOME), 1, 'it went, once');
  // (taken by Resend, the answer lost: owed, and the retry under the same key sends nothing twice)
  const env2 = await welcomeWorld();
  ctl.lose = 1;
  assert.equal((await quietly(() => rowPress(env2))).owed, 1);
  await heartbeats(env2);
  assert.equal(mails(ONA.email, WELCOME), 1, 'once, never twice');
});

test('6: Resend\'s own 422 for the row\'s sign-in email is said as a refusal: nothing owed, nothing sent by itself', async () => {
  const env = await welcomeWorld();
  ctl.status = 422; ctl.times = 1;
  const r = await rowPress(env);
  assert.equal(r.refused, 1, JSON.stringify(r));
  const st = await welcomeState(env.DB);
  assert.equal(st.welcomed[ONA.slug], undefined);
  assert.equal(st.waiting[ONA.slug], undefined, 'not owed');
  await heartbeats(env);
  assert.equal(mails(ONA.email, WELCOME), 0, 'nothing sent it by itself');
  assert.equal((await rowPress(env)).sent, 1, 'pressed again, it goes');
});

// ─── 4: only to a member's own address ────────────────────────────────

test('4: the monthly ask, with its personal yes/no link, goes only to members\' own addresses: never a SOARD group inbox or a staff address', async () => {
  const env = await world({ members: KINDS });
  await press(env, { action: 'save-ask', ask: { id: 'ask_kindsqaaaa', title: 'Do you know a plumber?', body: '', link: '' } });
  const r = await press(env, { action: 'send-ask', id: 'ask_kindsqaaaa', emailsOk: true });
  assert.equal(r.status, 200);
  assert.equal(r.said, 'It’s out, and emailed to 2 Advisory Board members.');
  await heartbeats(env);
  assert.deepEqual(KINDS.map((m) => (m.email ? mails(m.email, ASK) : 0)), [1, 1, 0, 0, 0]);
  // (what the card and its confirm count, from the same rule)
  const why = Object.fromEntries((await runIt(env)).advisors.map((a) => [a.slug, a.emailWhy]));
  assert.deepEqual(why, { 'ona-askqa': '', 'rex-askqa': '', 'hal-kindqa': 'group', 'ivy-kindqa': 'staff', 'mo-kindqa': 'none' });
});

test('4: update, gift and goal emails go only to a member\'s own address', async () => {
  const env = await world({ members: KINDS });
  const mail = await import('../functions/api/_advisory-mail.js');
  const { getSettings } = await import('../functions/api/_advisory.js');
  assert.equal((await mail.giftOwed(env, { 'hal-kindqa': { n: 1, ids: ['p1'] }, 'ivy-kindqa': { n: 1, ids: ['p2'] }, 'ona-askqa': { n: 1, ids: ['p3'] } })).length, 1, 'a gift note to Ona alone');
  const goal = (await mail.goalOwed(env, await getSettings(env.DB))).length;
  await env.DB.batch(await mail.goalOwed(env, await getSettings(env.DB)));
  const owed = (await env.DB.prepare("SELECT email FROM advisory_outbox WHERE kind = 'goal'").all()).results.map((x) => x.email).sort();
  assert.ok(goal >= 2);
  assert.deepEqual(owed, [ONA.email, REX.email]);
  // An introduction from Hal: its update emails nobody, and says why
  const A = await import('../functions/api/_advisory.js');
  const intro = await A.addIntro(env.DB, { slug: 'hal-kindqa', email: 'advisory@soardcharity.com' }, { name: 'Pat Introqa', company: 'Testco', email: 'pat.introqa@example.org', how: 'A neighbor', help: ['donor'] });
  assert.ok(intro.id);
  const r = await press(env, { action: 'intro-status', id: intro.id, status: 'talking', note: '' });
  assert.equal(r.status, 200);
  assert.equal(r.said, 'Hal’s email on file is a SOARD group inbox, so no email went.');
  await heartbeats(env);
  assert.equal(mails('advisory@soardcharity.com', /^An update on /), 0);
});

test('4: People\'s editor saving a group inbox as an Advisory Board member\'s email saves it, and says their Advisory Board emails won\'t go there', async () => {
  const env = await world();
  const api = await import('../functions/api/reveal-invites-admin.js');
  const post = async (body) => {
    const res = await api.onRequestPost({ env, data: { userEmail: STAFF }, waitUntil: () => {}, request: new Request('https://site.test/api/reveal-invites-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, ...(await res.json()) };
  };
  const g = await quietly(() => post({ boardEmail: { slug: ONA.slug, email: 'advisory@soardcharity.com' } }));
  assert.equal(g.ok, true, g.error);
  assert.equal(g.note, 'Saved. advisory@soardcharity.com is a SOARD group inbox, so Ona Askqa’s Advisory Board emails won’t go there: everyone in the group reads it. Put their own email here for those.');
  assert.equal((await env.DB.prepare('SELECT email FROM reveal_board_emails WHERE slug = ?').bind(ONA.slug).first()).email, 'advisory@soardcharity.com', 'it still saves');
  const own = await quietly(() => post({ boardEmail: { slug: ONA.slug, email: 'ona.own@example.org' } }));
  assert.equal(own.ok, true);
  assert.equal(own.note, undefined, 'their own: nothing to say');
});

// ─── 5: one notice per answer ─────────────────────────────────────────

async function askWorld() {
  resendClear();
  const env = await world();
  await press(env, { action: 'save-ask', ask: { id: 'ask_helpqaaaaa', title: 'Do you know a roofer?', body: 'Can you share this?', link: '' } });
  await press(env, { action: 'send-ask', id: 'ask_helpqaaaaa', emailsOk: true });
  return env;
}
const notices = () => resend.delivered.filter((m) => [m.to].flat().includes(LEAD) && NOTICE.test(m.subject || ''));
const answer = (env, a, note = '') => memberPress(env, ONA, { action: 'answer', askId: 'ask_helpqaaaaa', answer: a, note });

test('5: the same answer again sends no second notice; a changed one sends one, saying where it stands now', async () => {
  const env = await askWorld();
  assert.equal((await answer(env, 'yes', 'I know one.')).status, 200);
  assert.equal((await answer(env, 'yes', 'I know one.')).status, 200);
  await heartbeats(env);
  assert.equal(notices().length, 1, 'pressed twice, one notice');
  assert.match(notices()[0].subject, /can help with this month’s ask$/);
  await answer(env, 'yes', 'I know two.');
  await heartbeats(env);
  assert.equal(notices().length, 2, 'a changed answer: one notice');
  assert.match(notices()[1].text, /Where it stands now: they can help\. They wrote: “I know two\.”/);
  await answer(env, 'yes', 'I know two.');
  await answer(env, 'no');
  await heartbeats(env);
  assert.equal(notices().length, 3, 'the same again: nothing; a no after a yes they were told of: one');
  assert.match(notices()[2].text, /Where it stands now: not this time\./);
  // (a first answer of no owes nothing)
  const r = await memberPress(env, REX, { action: 'answer', askId: 'ask_helpqaaaaa', answer: 'no' });
  assert.equal(r.status, 200);
  await heartbeats(env);
  assert.equal(notices().length, 3);
});

test('5: the email\'s "I can help" button pressed twice sends one notice', async () => {
  const env = await askWorld();
  const text = resend.delivered.find((m) => [m.to].flat().includes(ONA.email) && ASK.test(m.subject)).text;
  const token = decodeURIComponent(text.match(/advisory-action\?t=([^&\s]+)&do=yes/)[1]);
  const mail = await import('../functions/api/_advisory-mail.js');
  for (let i = 0; i < 2; i++) {
    const r = await mail.answerFromLink(env.DB, token, { answer: 'yes' });
    await mail.sendNotice(env, r.notice);
  }
  await heartbeats(env);
  assert.equal(notices().length, 1);
});

// ─── 7: two saves that answer from their own write ─────────────────────

test('7: a gift credit whose write landed with its answer lost is answered as done (and pressed again, still one)', async () => {
  const env = await world();
  const f = faulty(env.DB, (sql) => (/^INSERT OR REPLACE INTO advisory_credits/.test(sql) && !f.state.hit.length ? 'after' : null));
  const r = await quietly(() => press({ ...env, DB: f.DB }, { action: 'credit', paymentId: 'pay_creditqa01', slug: ONA.slug }));
  assert.equal(f.state.hit.length, 1);
  assert.equal(r.status, 200, r.error);
  assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM advisory_credits WHERE payment_id = ?').bind('pay_creditqa01').first()).n, 1);
  // (not there: nothing changed, said so)
  const g = faulty(env.DB, (sql) => (/^INSERT OR REPLACE INTO advisory_credits/.test(sql) && !g.state.hit.length ? 'before' : null));
  const r2 = await quietly(() => press({ ...env, DB: g.DB }, { action: 'credit', paymentId: 'pay_creditqa02', slug: ONA.slug }));
  assert.equal(r2.status, 503);
  assert.match(r2.error, /nothing was changed/);
});

test('7: an application\'s status whose write landed with its answer lost is answered as saved', async () => {
  const env = await world();
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  await ensureAdvisorySchema(env.DB);
  await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, created_at, updated_at) VALUES ('adv-statusqa-001', 'site', 'Nia Statusqa', 'nia.statusqa@example.org', '{}', 'new', ?, ?)").bind(new Date().toISOString(), new Date().toISOString()).run();
  const f = faulty(env.DB, (sql) => (/^UPDATE advisory_applications SET status = \?/.test(sql) && !f.state.hit.length ? 'after' : null));
  const r = await quietly(() => appsPress({ ...env, DB: f.DB }, { status: { id: 'adv-statusqa-001', status: 'not-now' } }));
  assert.equal(f.state.hit.length, 1);
  assert.equal(r.status, 200, r.error);
  assert.equal(r.application.status, 'not-now');
  const g = faulty(env.DB, (sql) => (/^UPDATE advisory_applications SET status = \?/.test(sql) && !g.state.hit.length ? 'before' : null));
  const r2 = await quietly(() => appsPress({ ...env, DB: g.DB }, { status: { id: 'adv-statusqa-001', status: 'new' } }));
  assert.equal(r2.status, 503);
  assert.match(r2.error, /nothing was changed/);
});

// (the mail log and the record a test above changed are read as the site reads them)
void readState;

// ─── 7's sweep: every other Advisory Board admin save ─────────────────

test('7: every other Advisory Board admin save whose write landed with its answer lost is answered as done, never "That didn\'t go through"', async () => {
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  const app = async (env) => {
    await ensureAdvisorySchema(env.DB);
    await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, created_at, updated_at) VALUES ('adv-savesqa-0001', 'site', 'Nia Savesqa', 'nia.savesqa@example.org', '{}', 'new', ?, ?)").bind(new Date().toISOString(), new Date().toISOString()).run();
  };
  const draft = async (env) => press(env, { action: 'save-ask', ask: { id: 'ask_savesqaaaa', title: 'Do you know a roofer?', body: '', link: '' } });
  const settings = async (env) => JSON.parse((await env.DB.prepare("SELECT data FROM board_state WHERE key = 'advisory'").first()).data);
  const hosted = async (env) => {
    const A = await import('../functions/api/_advisory.js');
    const h = await A.requestHost(env.DB, { slug: ONA.slug, email: ONA.email }, { title: 'A backyard dinner', when: 'Spring', where: 'Home' });
    await env.DB.prepare("UPDATE advisory_hosted SET id = 'h_savesqa0001', status = 'approved' WHERE id = ?").bind(h.id).run();
  };
  const GIVE = 'https://www.zeffy.com/en-US/peer-to-peer/savesqa';
  const cases = [
    ['the settings (the goal)', null, { action: 'save-settings', settings: { goal: 31000 } }, /^UPDATE board_state SET data = \?, updated_at = \? WHERE key = \? AND data = \?/, async (env) => (await settings(env)).goal === 31000],
    ['a board paper taken off', null, { action: 'board-doc', id: 'nothing-shared', on: false }, /^UPDATE board_state SET data = \?, updated_at = \? WHERE key = \? AND data = \?/, async (env) => Array.isArray((await settings(env)).boardDocs)],
    ['a Zeffy page matched', null, { action: 'match-page', campaignId: 'camp_savesqa1', slug: ONA.slug }, /^UPDATE board_state SET data = \?, updated_at = \? WHERE key = \? AND data = \?/, async (env) => (await settings(env)).pages?.camp_savesqa1 === ONA.slug],
    ['a draft ask deleted', draft, { action: 'delete-ask', id: 'ask_savesqaaaa' }, /^DELETE FROM advisory_asks WHERE id = \?/, async (env) => !(await env.DB.prepare("SELECT 1 AS x FROM advisory_asks WHERE id = 'ask_savesqaaaa'").first())],
    ['a member\'s term', null, { action: 'set-term', slug: ONA.slug, ends: '2027-12-31' }, /^INSERT INTO advisory_terms/, async (env) => (await env.DB.prepare('SELECT ends_on FROM advisory_terms WHERE slug = ?').bind(ONA.slug).first())?.ends_on === '2027-12-31'],
    ['a fundraiser\'s Zeffy page', hosted, { action: 'hosted-link', id: 'h_savesqa0001', giveUrl: GIVE }, /^UPDATE advisory_hosted SET data = \?/, async (env) => JSON.parse((await env.DB.prepare("SELECT data FROM advisory_hosted WHERE id = 'h_savesqa0001'").first()).data).giveUrl === GIVE],
    ['an application deleted', app, { remove: { id: 'adv-savesqa-0001' } }, /^DELETE FROM advisory_applications WHERE id = \?/, async (env) => !(await env.DB.prepare("SELECT 1 AS x FROM advisory_applications WHERE id = 'adv-savesqa-0001'").first()), 'apps'],
  ];
  const bad = [];
  for (const [name, before, body, write, there, where] of cases) {
    const env = await world();
    if (before) await before(env);
    const f = faulty(env.DB, (sql) => (write.test(sql) && !f.state.hit.length ? 'after' : null));
    const r = await quietly(() => (where === 'apps' ? appsPress : press)({ ...env, DB: f.DB }, body));
    if (!f.state.hit.length) { bad.push(`${name}: its write never ran`); continue; }
    if (!(await there(env))) { bad.push(`${name}: it didn't land`); continue; }
    if (r.status !== 200) bad.push(`${name}: landed, said ${r.status} "${r.error}"`);
  }
  assert.deepEqual(bad, []);
});
