/**
 * Advisory Board QA round 27 (Nov 26 2026), the admin tester's findings, on the server:
 *   1  Resend's own no (a 4xx, not 429) or email not set up, for the ask, Email it and an update: the same rule as the
 *      welcome's (one rule for every Advisory Board email, ./_advisory-mail.js sendOutcome): a refusal in words with what
 *      staff can do, nothing owed, never tried again, never counted as sent in What's gone out; 5xx and 429 stay owed
 *   3  the outbox is a record of the person like every other: on the one list of where their things live, moved with a
 *      rename, so the "can help" notice's key follows them
 *   4  a welcome whose answer was lost is asked again only under a key Resend still keeps: past that, never sent again
 *      by itself, said on their row, and Send it again sends it with a new key
 *   5  an ask or update owed after a 5xx didn't reach Resend: it stays owed past a day, and goes once when it can, with a
 *      new key once its old one is past its day
 *   6  People's one save of a private email keeps the server's note (team-shared.js savePersonEmail), for every caller
 *   8  Add refused because the person's sign-in email went from Run it while its box was open says so
 *  10  a row's sign-in email whose email changed on People mid-press says so: the email service was never asked
 * 2, 7 and 9 are page behaviour: the tester's 35-*, 54-* and 61-* scripts (and scripts/test-advisory-round27.mjs).
 * Every press swept: tests/advisory-round27-sweeps.test.mjs. Made-up people only (the repo is public); Resend and
 * Access are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round27.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  world, press, runIt, appsPress, quietly, resend, mails, restoreFetch, MEMBERS, ctl, resendClear, WELCOME, NOTICE, LEAD, signInKnows,
  memberPress, memberMakes, welcomeState, refuse, asked, refuseClear, forget, keysTo, beat, beats, MIN, DAY, renameTo, outboxRows, emailsSet,
} from './lib/advisory-r27-world.mjs';

after(restoreFetch);

const [ONA, REX] = MEMBERS;
const ASK = /^This month’s ask: /;
const UPDATE = /^An update on /;
const fresh = async (opts) => { resendClear(); refuseClear(); return world(opts); };
const putAsk = async (env, id = 'ask_r27qaaaaaa') => {
  assert.equal((await press(env, { action: 'save-ask', ask: { id, title: 'Do you know a roofer?', body: 'Can you share this?', link: '' } })).status, 200);
  return id;
};
const rowOf = async (env, key) => (await outboxRows(env.DB)).find((r) => r.key === key) || null;

// ─── 1: Resend's own no, or email not set up, is a refusal ──────────

for (const code of [422, 403]) {
  test(`1: the ask put out and emailed with Resend's own ${code} for Rex every time: said as a refusal, nothing owed, never tried again, and What's gone out counts Ona alone`, async () => {
    const env = await fresh();
    const id = await putAsk(env);
    refuse.set(REX.email, code);
    const r = await press(env, { action: 'send-ask', id, emailsOk: true });
    assert.equal(r.status, 200, r.error);
    assert.equal(r.said, 'It’s out, and emailed to 1 Advisory Board member. The email service refused the email to Rex, so it didn’t go. Check their email on People.');
    assert.doesNotMatch(r.said, /in a few minutes/);
    assert.equal((await rowOf(env, `ask:${id}:${REX.email}`)).outcome, 'refused', 'nothing owed');
    for (const ahead of [3 * MIN, 11 * MIN, 60 * MIN, 6 * 60 * MIN, 12 * 60 * MIN, 2 * DAY]) await beat(env, ahead);
    assert.equal(asked.get(REX.email), 1, 'Resend asked once, never again by itself');
    assert.equal(mails(ONA.email, ASK), 1);
    assert.equal(mails(REX.email, ASK), 0);
    const log = (await runIt(env)).mail.find((l) => l.kind === 'ask' && l.id === id);
    assert.equal(log.sent, 1, 'What’s gone out: never counted as sent');
    assert.equal(log.owed, undefined);
    assert.match(log.what, /Not sent to Rex Askqa \(the email service refused it\)/);
  });
}

test('1: Email it with Resend\'s own 422 for Rex: a refusal in words, never "in a few minutes"', async () => {
  const env = await fresh({ emails: false });
  const id = await putAsk(env);
  assert.equal((await press(env, { action: 'send-ask', id })).status, 200);
  await emailsSet(env, true);
  refuse.set(REX.email, 422);
  const r = await press(env, { action: 'email-ask', id });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.said, 'Emailed to 1 Advisory Board member. The email service refused the email to Rex, so it didn’t go. Check their email on People.');
  await beats(env);
  assert.equal(asked.get(REX.email), 1);
});

test('1: an introduction\'s update with Resend\'s own 422: "The email service refused the email to Rex, so it didn\'t go. Check their email on People."', async () => {
  const env = await fresh();
  const intro = await memberMakes(env, REX, 'intro');
  refuse.set(REX.email, 422);
  const r = await press(env, { action: 'intro-status', id: intro.id, status: 'talking', note: 'We called them.' });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.said, 'The email service refused the email to Rex, so it didn’t go. Check their email on People.');
  assert.equal((await rowOf(env, `update:intro:${intro.id}`)).outcome, 'refused');
  await beats(env);
  assert.equal(asked.get(REX.email), 1, 'never tried again');
});

test('1: email not set up: the ask and an update say so, nothing is owed, and nothing goes by itself', async () => {
  const env = { ...(await fresh()), RESEND_API_KEY: '' };
  const id = await putAsk(env);
  const r = await press(env, { action: 'send-ask', id, emailsOk: true });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.said, 'It’s on the page, but its email didn’t go. The site’s email isn’t set up, so the email to Ona and Rex didn’t go.');
  const intro = await memberMakes(env, REX, 'intro');
  const u = await press(env, { action: 'intro-status', id: intro.id, status: 'talking', note: '' });
  assert.equal(u.said, 'The site’s email isn’t set up, so the email to Rex didn’t go.');
  assert.deepEqual((await outboxRows(env.DB)).filter((x) => x.kind !== 'notice').map((x) => x.outcome), ['refused', 'refused', 'refused']);
  const log = (await runIt(env)).mail.find((l) => l.id === id);
  assert.equal(log.kind, 'ask-failed', 'What’s gone out: the ask didn’t send');
  await beats(env);
  assert.equal(resend.delivered.length, 0);
});

for (const code of [500, 429]) {
  test(`1: Resend's ${code} for the ask stays owed: "in a few minutes", and the heartbeat sends it once`, async () => {
    const env = await fresh();
    const id = await putAsk(env);
    ctl.status = code; ctl.times = 1;
    const r = await press(env, { action: 'send-ask', id, emailsOk: true });
    assert.equal(r.status, 200);
    assert.match(r.said, /the other 1 gets it in a few minutes\.$/);
    await beats(env);
    assert.deepEqual([mails(ONA.email, ASK), mails(REX.email, ASK)], [1, 1]);
  });
}

// ─── 3: the "can help" notice across a rename ─────────────────────────

const HELP = 'ask_r27helpqaa';
async function helpWorld() {
  const env = await fresh();
  await putAsk(env, HELP);
  await press(env, { action: 'send-ask', id: HELP, emailsOk: true });
  return env;
}
const told = (re = NOTICE) => resend.delivered.filter((m) => [m.to].flat().includes(LEAD) && re.test(m.subject || ''));
const answer = (env, a, note = '') => memberPress(env, ONA, { action: 'answer', askId: HELP, answer: a, note });
const NEW = 'ona-renamedqa';

test('3: yes, renamed on People, the same yes again: one "can help", never two', async () => {
  const env = await helpWorld();
  assert.equal((await answer(env, 'yes', 'I know one.')).status, 200);
  await beats(env, { keysFor: false });
  await renameTo(env, ONA.slug, NEW);
  assert.equal((await answer(env, 'yes', 'I know one.')).status, 200);
  await beats(env, { keysFor: false });
  assert.equal(told().length, 1, told().map((m) => m.subject).join(' | '));
  assert.deepEqual((await outboxRows(env.DB)).filter((x) => x.kind === 'notice').map((x) => x.key), [`notice:answer:${HELP}:${NEW}`], 'the notice moved with them');
});

test('3: yes, renamed on People, then no: one "can help" and one "changed their answer"', async () => {
  const env = await helpWorld();
  await answer(env, 'yes', 'I know one.');
  await beats(env, { keysFor: false });
  await renameTo(env, ONA.slug, NEW);
  await answer(env, 'no');
  await beats(env, { keysFor: false });
  assert.deepEqual(told().map((m) => /changed their answer/.test(m.subject) ? 'changed' : 'can help'), ['can help', 'changed']);
  assert.match(told()[1].text, /Where it stands now: not this time\./);
});

test('3: the email\'s buttons: yes, renamed, no: "changed their answer" goes', async () => {
  const env = await helpWorld();
  const mail = await import('../functions/api/_advisory-mail.js');
  const text = resend.delivered.find((m) => [m.to].flat().includes(ONA.email) && ASK.test(m.subject)).text;
  const token = decodeURIComponent(text.match(/advisory-action\?t=([^&\s]+)&do=yes/)[1]);
  await mail.sendNotice(env, (await mail.answerFromLink(env.DB, token, { answer: 'yes' })).notice);
  await renameTo(env, ONA.slug, NEW);
  await mail.sendNotice(env, (await mail.answerFromLink(env.DB, token, { answer: 'no' })).notice);
  await beats(env, { keysFor: false });
  assert.deepEqual(told().map((m) => /changed their answer/.test(m.subject) ? 'changed' : 'can help'), ['can help', 'changed']);
});

test('3: a yes whose notice was owed (a 502), renamed, then no: never "said yes" after they said no', async () => {
  const env = await helpWorld();
  ctl.status = 502; ctl.times = 1;
  await answer(env, 'yes', 'I know one.');
  await renameTo(env, ONA.slug, NEW);
  await answer(env, 'no');
  await beats(env);
  assert.equal(told(/can help with this month’s ask$/).length, 0, 'never told "can help" of a no');
  const row = await rowOf(env, `notice:answer:${HELP}:${NEW}`);
  assert.ok(!row || row.sent_at === null || /not this time/.test(row.msg), 'only where it stands now');
});

test('3: the outbox is on the one list of where a person\'s things live: counted under their address, and none left after a rename', async () => {
  const env = await helpWorld();
  await answer(env, 'yes', 'I know one.');
  const { keptAt } = await import('../functions/api/_member-places.js');
  const before = (await keptAt(env.DB, ONA.slug)).find((k) => k.kind === 'advisory_outbox');
  assert.equal(before?.n, 1, `the notice of their answer is kept under their address (${JSON.stringify(before)})`);
  assert.deepEqual(before.words, ['Advisory Board email about them', 'Advisory Board emails about them']);
  await renameTo(env, ONA.slug, NEW);
  assert.equal((await keptAt(env.DB, ONA.slug)).find((k) => k.kind === 'advisory_outbox'), undefined, 'nothing left at the old address');
  assert.equal((await keptAt(env.DB, NEW)).find((k) => k.kind === 'advisory_outbox')?.n, 1, 'moved with them');
  // (and People's note on what's still at an old address says it in words)
  const { leftAt } = await import('../functions/api/_rename-finish.js');
  assert.equal(typeof leftAt, 'function');
});

// ─── 4: a welcome whose answer was lost, past the day Resend keeps its key ─

test('4: Add\'s welcome taken by Resend with its answer lost, emails off, back on two days later: never a second by itself; the row says it may not have gone, and Send it again sends it with a new key', async () => {
  const env = await fresh();
  await signInKnows(env);
  const mail = await import('../functions/api/_advisory-mail.js');
  // (two days ago: Run it reads the row as of now)
  const T0 = -(2 * DAY + 60 * MIN);
  ctl.lose = 1;
  const w = await quietly(() => mail.welcomeOnJoin(env, ONA.slug, { by: 'quinn.founderqa@soardcharity.com', now: Date.now() + T0 }));
  assert.deepEqual(w, { waiting: true, why: 'owed' });
  assert.equal(mails(ONA.email, WELCOME), 1, 'it went, its answer lost');
  await emailsSet(env, false);
  await beat(env, T0 + 3 * MIN);
  forget();
  await emailsSet(env, true);
  await beat(env, 0);
  await beat(env, DAY);
  assert.equal(mails(ONA.email, WELCOME), 1, 'never a second by itself');
  const row = (await runIt(env)).advisors.find((a) => a.slug === ONA.slug);
  assert.equal(row.welcome.unsure, true, `the row says so (${JSON.stringify(row.welcome)})`);
  const r = await press(env, { action: 'send-welcome-to', slug: ONA.slug });
  assert.equal(r.sent, 1, JSON.stringify(r));
  assert.equal(mails(ONA.email, WELCOME), 2, 'a person asked for it again');
  assert.match(keysTo(ONA.email, WELCOME).at(-1), new RegExp(`^advisory-welcome:${ONA.email}:re\\d+:0$`), 'with a new key');
  assert.deepEqual((await welcomeState(env.DB)).waiting, {}, 'nothing left owed');
});

test('4: the same within the day Resend keeps its key: the heartbeat asks again under the same key, which sends nothing twice', async () => {
  const env = await fresh();
  await signInKnows(env);
  const mail = await import('../functions/api/_advisory-mail.js');
  ctl.lose = 1;
  await quietly(() => mail.welcomeOnJoin(env, ONA.slug, { by: 'x' }));
  await beat(env, 11 * MIN);
  await beat(env, 6 * 60 * MIN);
  assert.equal(mails(ONA.email, WELCOME), 1);
  assert.ok((await welcomeState(env.DB)).welcomed[ONA.slug]?.at, 'marked had');
});

test('4: a welcome Resend answered 502 (it never reached Resend), emails off for two days: it goes once, with a new key', async () => {
  const env = await fresh();
  await signInKnows(env);
  const mail = await import('../functions/api/_advisory-mail.js');
  ctl.status = 502; ctl.times = 1;
  assert.deepEqual(await mail.welcomeOnJoin(env, ONA.slug, { by: 'x' }), { waiting: true, why: 'owed' });
  await emailsSet(env, false);
  await beat(env, 3 * MIN);
  forget();
  await emailsSet(env, true);
  await beat(env, 2 * DAY);
  await beat(env, 3 * DAY);
  assert.equal(mails(ONA.email, WELCOME), 1);
});

// ─── 5: an ask or update owed after a 5xx, emails off for more than a day ─

for (const kind of ['ask', 'update']) {
  test(`5: ${kind === 'ask' ? 'the ask' : 'an introduction\'s update'} owed after Resend's 502, emails off for two days: it goes once when they're back on`, async () => {
    const env = await fresh({ members: [ONA] });
    let go;
    let n;
    if (kind === 'ask') {
      const id = await putAsk(env);
      go = () => press(env, { action: 'send-ask', id, emailsOk: true });
      n = () => mails(ONA.email, ASK);
    } else {
      const intro = await memberMakes(env, ONA, 'intro');
      go = () => press(env, { action: 'intro-status', id: intro.id, status: 'talking', note: 'We called.' });
      n = () => mails(ONA.email, UPDATE);
    }
    ctl.status = 502; ctl.times = 1;
    const r = await go();
    assert.match(r.said, /in a few minutes/);
    await emailsSet(env, false);
    for (const ahead of [3 * MIN, 11 * MIN, 60 * MIN]) await beat(env, ahead);
    assert.equal(n(), 0, 'held while emails are off');
    forget();
    await emailsSet(env, true);
    await beat(env, 2 * DAY);
    await beat(env, 3 * DAY);
    assert.equal(n(), 1, 'it goes once');
    assert.ok((await outboxRows(env.DB)).every((x) => x.kind === 'notice' || x.outcome === 'sent'), 'nothing owed lost');
  });
}

test('5: the ask taken by Resend with its answer lost, emails off for two days: never a second by itself; Run it lists it, and Send it again sends it with a new key', async () => {
  const env = await fresh({ members: [ONA] });
  const id = await putAsk(env);
  ctl.lose = 1;
  const r = await quietly(() => press(env, { action: 'send-ask', id, emailsOk: true }));
  assert.match(r.said, /in a few minutes/);
  assert.equal(mails(ONA.email, ASK), 1);
  await emailsSet(env, false);
  await beat(env, 3 * MIN);
  forget();
  await emailsSet(env, true);
  await beat(env, 2 * DAY);
  await beat(env, 3 * DAY);
  assert.equal(mails(ONA.email, ASK), 1, 'never a second by itself');
  const unsure = (await runIt(env)).unsure;
  assert.deepEqual(unsure?.map((u) => [u.key, u.kind, u.ref, u.name]), [[`ask:${id}:${ONA.email}`, 'ask', id, 'Ona']], 'on Run it, never lost silently');
  const again = await press(env, { action: 'send-again', key: `ask:${id}:${ONA.email}` });
  assert.equal(again.status, 200, again.error);
  assert.equal(again.said, 'Sent to Ona.');
  assert.equal(mails(ONA.email, ASK), 2);
  assert.match(keysTo(ONA.email, ASK).at(-1), new RegExp(`^advisory-ask:${id}:${ONA.email}:re\\d+:0$`));
  assert.deepEqual((await runIt(env)).unsure, []);
});

// ─── 6: People's one save of a private email keeps the server's note ──

test('6: People\'s save of a private email (team-shared.js savePersonEmail) keeps the server\'s note, and the end of a list says each one', async () => {
  const shared = await import('../public/admin/team-shared.js');
  assert.equal(typeof shared.savePersonEmail, 'function', 'one save, shared');
  const note = 'Saved. advisory+hal@soardcharity.com is a SOARD group inbox, so Hal Pasteqa’s Advisory Board emails won’t go there: everyone in the group reads it. Put their own email here for those.';
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return Response.json({ ok: true, note }); };
  assert.deepEqual(await shared.savePersonEmail('hal-pasteqa', 'advisory+hal@soardcharity.com', { fetchImpl }), { ok: true, note });
  assert.deepEqual(calls, [['/api/reveal-invites-admin', { boardEmail: { slug: 'hal-pasteqa', email: 'advisory+hal@soardcharity.com' } }]]);
  assert.deepEqual(await shared.savePersonEmail('x', 'y@example.org', { fetchImpl: async () => Response.json({ ok: false, error: 'Nope' }, { status: 400 }) }), { ok: false, error: 'Nope' });
  assert.deepEqual(shared.savedWords('3 Advisory Board members added.', [note, '']), { words: `3 Advisory Board members added. ${note.replace(/^Saved\. /, '')}`, tone: 'info' });
  // (every caller on People takes it: the one-person editor and Paste a list, and none posts the email itself)
  const page = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  assert.equal((page.match(/boardEmail: \{/g) || []).length, 0, 'no People save posts a private email but the shared one');
  assert.equal((page.match(/await tsSavePersonEmail\(/g) || []).length, 2);
  assert.match(page, /if \(d\.note\) said\[p\.slug\] = d\.note;/, 'Paste a list keeps each note');
});

// ─── 8: Add refused for what really changed ───────────────────────────

test('8: Add\'s box opened, then their sign-in email sent from Run it: Add is refused with that, never "Who this matches on People changed"', async () => {
  const env = await fresh();
  await signInKnows(env);
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  await ensureAdvisorySchema(env.DB);
  const at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, created_at, updated_at) VALUES ('adv-r27addqa-001', 'site', 'Ona Askqa', ?, '{}', 'new', ?, ?)").bind(ONA.email, at, at).run();
  const { addPlan } = await import('../functions/api/_advisory-add.js');
  const plan = await addPlan(env, 'adv-r27addqa-001');
  assert.equal(plan.kind, 'same');
  assert.equal((await press(env, { action: 'send-welcome-to', slug: ONA.slug })).sent, 1);
  const r = await quietly(() => appsPress(env, { add: { id: 'adv-r27addqa-001', as: 'same', seen: plan.key } }));
  assert.notEqual(r.status, 200);
  assert.equal(r.error, 'Ona Askqa was sent their sign-in email from Run it a moment ago. Read it again and press Add.');
  // (People changing is still said as that)
  const plan2 = await addPlan(env, 'adv-r27addqa-001');
  await env.DB.prepare("UPDATE team SET data = json_set(data, '$.organization', 'Testco') WHERE slug = ?").bind(ONA.slug).run();
  const r2 = await quietly(() => appsPress(env, { add: { id: 'adv-r27addqa-001', as: 'same', seen: plan2.key } }));
  assert.match(r2.error, /^Who this matches on People changed since the box opened/);
});

// ─── 10: an email changed on People mid-press ─────────────────────────

test('10: a row\'s sign-in email whose email changes on People between its reads and its claim: { changed }, nothing sent, and the email service never asked', async () => {
  const env = await fresh();
  await signInKnows(env);
  // (the claim held until their email on People is changed, as the tester's real setBoardEmail did)
  const isClaim = (sql) => /^UPDATE board_state SET data = json_set\(json_set\(/.test(sql) && /IS NULL OR \(json_type\(data, \?\) = 'object'/.test(sql);
  let changed = false;
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), run: async () => { if (!changed && isClaim(st._sql)) { changed = true; await env.DB.prepare('UPDATE reveal_board_emails SET email = ? WHERE slug = ?').bind('ona.new@example.org', ONA.slug).run(); } return st.run(); }, first: (c) => st.first(c), all: () => st.all() });
  const DB = { ...env.DB, prepare: (sql) => wrap(env.DB.prepare(sql)), batch: (s) => env.DB.batch(s) };
  const calls = resend.calls;
  const r = await press({ ...env, DB }, { action: 'send-welcome-to', slug: ONA.slug });
  assert.ok(changed, 'their email changed mid-press');
  assert.equal(r.status, 200);
  assert.equal(r.changed, 1, JSON.stringify(r));
  assert.equal(r.failed, undefined);
  assert.equal(resend.calls, calls, 'the email service was never asked');
  assert.equal(mails(ONA.email, WELCOME) + mails('ona.new@example.org', WELCOME), 0);
  // (the page's words for it, from the same answer)
  const page = readFileSync(new URL('../public/admin/advisory-admin.js', import.meta.url), 'utf8');
  assert.match(page, /j\.changed \? `\$\{a\.name\}’s email changed on People just now, so nothing was sent\. Check it and press again\.`/);
  assert.doesNotMatch(page, /the email service didn’t take it/);
});
