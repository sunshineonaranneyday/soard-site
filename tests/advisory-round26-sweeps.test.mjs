/**
 * Advisory Board QA round 26: every press this round touches, with the database failing at each of its statements in
 * turn (after a clean control run): once before the statement runs (nothing of it lands), and, for each write, once
 * after it runs (it landed, its answer lost). At every point the answer's words match what the database and the fake
 * email service show; pressed again as the words say, then the heartbeat now, 11 minutes on and 2 days on: nobody gets an
 * email twice, and nothing owed is lost. The presses: a member's sign-in email from their row and from Reaching the
 * group, the monthly ask put out to members with every kind of address, a member's "I can help" answer pressed twice,
 * a gift credit, and an application's status. (Add's welcome: tests/advisory-round26-add.test.mjs.)
 * Made-up people only (the repo is public); nothing leaves this machine.
 * Run: node --test tests/advisory-round26-sweeps.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, press, appsPress, faulty, isWrite, quietly, resend, mails, restoreFetch, MEMBERS, resendClear, WELCOME, NOTICE, LEAD, KINDS, signInKnows, memberPress, heartbeats, welcomeState } from './lib/advisory-r26-world.mjs';

after(restoreFetch);

const [ONA, REX] = MEMBERS;
const ASK = /^This month’s ask: /;

/** The press `go(env, w)` on a fresh world with each statement failing in turn; `check` asserts each point */
async function sweep({ setup, go, check }) {
  const c = await setup();
  const f0 = faulty(c.env.DB);
  const r0 = await quietly(() => go({ ...c.env, DB: f0.DB }, c));
  assert.equal(r0.status, 200, `the control press: ${r0.error}`);
  const trace = f0.state.trace;
  const points = [];
  for (let k = 1; k <= trace.length; k++) {
    points.push({ k, how: 'before' });
    if (isWrite(trace[k - 1])) points.push({ k, how: 'after' });
  }
  const bad = [];
  let hit = 0;
  for (const p of points) {
    const w = await setup();
    const f = faulty(w.env.DB, (sql, n) => (n === p.k ? p.how : null));
    const r1 = await quietly(() => go({ ...w.env, DB: f.DB }, w));
    if (!f.state.hit.length) continue;
    hit += 1;
    const where = `#${p.k} ${p.how} "${f.state.hit[0].slice(0, 80)}"`;
    try { await check(w, r1, { where, again: () => quietly(() => go(w.env, w)) }); } catch (e) { bad.push(`${where}: ${e.message.split('\n')[0]} (${r1.status} ${r1.error || r1.said || ''})`); }
  }
  return { points: points.length, hit, bad };
}
const report = (name, r) => {
  console.log(`[sweep] ${name}: ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `:\n  ${r.bad.join('\n  ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
};
/** Nothing of a welcome left owed or on its way */
const nothingOwed = async (DB, slugs) => {
  const st = await welcomeState(DB);
  for (const s of slugs) {
    assert.equal(st.waiting[s], undefined, `${s}: nothing left owed`);
    assert.ok(!st.welcomed[s]?.sending, `${s}: nothing left on its way`);
  }
};

// ─── A member's sign-in email, sent by hand ─────────────────────────

const welcomeSetup = async () => { resendClear(); const env = await world(); await signInKnows(env); return { env }; };

test('sweep: a member\'s sign-in email from their row', async () => {
  report('the row\'s sign-in email', await sweep({
    setup: welcomeSetup,
    go: (env) => press(env, { action: 'send-welcome-to', slug: ONA.slug }),
    check: async (w, r1, { again }) => {
      const n = mails(ONA.email, WELCOME);
      if (r1.status === 200 && r1.sent) assert.equal(n, 1, 'said sent: it went');
      else if (r1.status === 200 && r1.owed) assert.ok(n <= 1, 'said it goes in a few minutes');
      // (the sign-in's own check, a read that fails taken as "not yet": nothing was sent, said so)
      else if (r1.status === 200 && r1.notReady) assert.equal(n, 0, 'said nothing was sent, but it went');
      else if (r1.status === 200) assert.fail(`an answer that isn't sent or owed: ${JSON.stringify(r1)}`);
      else if (/nothing was (sent|changed)|couldn’t check your sign-in/.test(r1.error || '')) {
        assert.equal(r1.status, 503);
        assert.equal(n, 0, 'said nothing was sent, but it went');
        const st = await welcomeState(w.env.DB);
        assert.equal(st.welcomed[ONA.slug], undefined, 'said nothing was sent, but it was claimed');
        assert.equal(st.waiting[ONA.slug], undefined, 'said nothing was sent, but it was owed');
      } else assert.match(r1.error || '', /can’t tell yet|couldn’t check your sign-in/, 'a failure said in true words');
      if (!(r1.status === 200 && r1.sent)) await again();
      await heartbeats(w.env);
      assert.equal(mails(ONA.email, WELCOME), 1, 'once in the end, never twice, never lost');
      await nothingOwed(w.env.DB, [ONA.slug]);
    },
  }));
});

test('sweep: Reaching the group\'s "Send the sign-in email to 2"', async () => {
  report('the group\'s sign-in email', await sweep({
    setup: welcomeSetup,
    go: (env) => press(env, { action: 'send-welcome', slugs: [ONA.slug, REX.slug] }),
    check: async (w, r1, { again }) => {
      const each = MEMBERS.map((m) => mails(m.email, WELCOME));
      assert.ok(each.every((n) => n <= 1), 'never twice');
      if (r1.status === 200) {
        assert.ok(each.filter((n) => n === 1).length >= r1.sent, 'said sent: they went');
        assert.ok(!/had it already/.test(r1.said) || each.every((n) => n === 1), `"${r1.said}" said of someone who hadn't`);
      } else if (/nothing was (sent|changed)|couldn’t check your sign-in/.test(r1.error || '')) {
        assert.deepEqual(each, [0, 0], 'said nothing was sent, but it went');
        const st = await welcomeState(w.env.DB);
        for (const m of MEMBERS) assert.equal(st.welcomed[m.slug], undefined, 'said nothing was sent, but it was claimed');
      }
      await again();
      await heartbeats(w.env);
      assert.deepEqual(MEMBERS.map((m) => mails(m.email, WELCOME)), [1, 1], 'once each in the end, never twice, never lost');
      await nothingOwed(w.env.DB, MEMBERS.map((m) => m.slug));
    },
  }));
});

// ─── The monthly ask, to members with every kind of address ─────────

const ID = 'ask_kindsweepq';
const many = (n) => (n === 1 ? '1 Advisory Board member' : `${n} Advisory Board members`);
const askSaid = (sent, owed) => (!owed ? `It’s out, and emailed to ${many(sent)}.` : !sent ? `The ask is out. Its email goes to ${many(owed)} in a few minutes.` : `The ask is out. It went to ${many(sent)}; the other ${owed} ${owed === 1 ? 'gets' : 'get'} it in a few minutes.`);
test('sweep: the monthly ask put out to members with their own address, a SOARD group inbox, a staff address and none', async () => {
  report('the ask to every kind of address', await sweep({
    setup: async () => {
      resendClear();
      const env = await world({ members: KINDS });
      assert.equal((await press(env, { action: 'save-ask', ask: { id: ID, title: 'Do you know a roofer?', body: 'Can you share this?', link: '' } })).status, 200);
      return { env };
    },
    go: (env) => press(env, { action: 'send-ask', id: ID, emailsOk: true }),
    check: async (w, r1, { again }) => {
      const own = MEMBERS.map((m) => mails(m.email, ASK));
      assert.ok(own.every((n) => n <= 1), 'never twice');
      if (r1.status === 200) assert.equal(r1.said, askSaid(own.filter((n) => n === 1).length, own.filter((n) => n === 0).length), 'its words: what went, what goes in a few minutes');
      else assert.deepEqual(own, [0, 0], `said "${r1.error}", but it went`);
      if (r1.status !== 200) assert.equal((await again()).status, 200, 'pressed again');
      await heartbeats(w.env);
      assert.deepEqual(MEMBERS.map((m) => mails(m.email, ASK)), [1, 1], 'once each in the end');
      assert.equal(mails('advisory@soardcharity.com', ASK) + mails('ivy.kindqa@soardcharity.com', ASK), 0, 'never to a group inbox or a staff address');
      assert.equal((await w.env.DB.prepare('SELECT count(*) AS n FROM advisory_outbox WHERE kind = ? AND sent_at IS NULL AND outcome IS NULL').bind('ask').first()).n, 0, 'nothing owed left');
    },
  }));
});

// ─── A member's "I can help", pressed twice ─────────────────────────

const HELP = 'ask_helpsweepq';
test('sweep: a member\'s "I can help" answer, pressed twice with the same words', async () => {
  report('the can-help answer', await sweep({
    setup: async () => {
      resendClear();
      const env = await world();
      await press(env, { action: 'save-ask', ask: { id: HELP, title: 'Do you know a roofer?', body: '', link: '' } });
      await press(env, { action: 'send-ask', id: HELP, emailsOk: true });
      return { env };
    },
    go: (env) => memberPress(env, ONA, { action: 'answer', askId: HELP, answer: 'yes', note: 'I know one.' }),
    check: async (w, r1, { again }) => {
      const answers = async () => (await w.env.DB.prepare("SELECT count(*) AS n FROM advisory_answers WHERE ask_id = ? AND answer = 'yes'").bind(HELP).first()).n;
      const told = () => resend.delivered.filter((m) => [m.to].flat().includes(LEAD) && NOTICE.test(m.subject || '')).length;
      if (r1.status === 200) assert.equal(await answers(), 1, 'said taken: it is');
      else assert.equal(await answers(), 0, `said "${r1.error}", but it was taken`);
      assert.ok(told() <= 1);
      await again();
      await again();
      await heartbeats(w.env);
      assert.equal(await answers(), 1);
      assert.equal(told(), 1, 'one answer, one notice: never two');
    },
  }));
});

// ─── A gift credit, and an application's status ─────────────────────

test('sweep: a gift credited to a member', async () => {
  report('the gift credit', await sweep({
    setup: async () => ({ env: await world() }),
    go: (env) => press(env, { action: 'credit', paymentId: 'pay_sweepqa01', slug: ONA.slug }),
    check: async (w, r1, { again }) => {
      const n = async () => (await w.env.DB.prepare('SELECT count(*) AS n FROM advisory_credits WHERE payment_id = ? AND slug = ?').bind('pay_sweepqa01', ONA.slug).first()).n;
      if (r1.status === 200) assert.equal(await n(), 1, 'said done: it is');
      else {
        assert.equal(await n(), 0, `said "${r1.error}", but it saved`);
        assert.match(r1.error, /nothing was changed|can’t tell yet|couldn’t check your sign-in/, 'in true words');
        assert.equal((await again()).status, 200);
      }
      assert.equal(await n(), 1, 'once');
    },
  }));
});

test('sweep: an application\'s status (Not now)', async () => {
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  report('the application status', await sweep({
    setup: async () => {
      const env = await world();
      await ensureAdvisorySchema(env.DB);
      await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, created_at, updated_at) VALUES ('adv-sweepqa-0002', 'site', 'Nia Statusqa', 'nia.statusqa@example.org', '{}', 'new', ?, ?)").bind(new Date().toISOString(), new Date().toISOString()).run();
      return { env };
    },
    go: (env) => appsPress(env, { status: { id: 'adv-sweepqa-0002', status: 'not-now' } }),
    check: async (w, r1, { again }) => {
      const st = async () => (await w.env.DB.prepare("SELECT status FROM advisory_applications WHERE id = 'adv-sweepqa-0002'").first()).status;
      if (r1.status === 200) { assert.equal(await st(), 'not-now', 'said saved: it is'); assert.equal(r1.application.status, 'not-now'); }
      else {
        assert.equal(await st(), 'new', `said "${r1.error}", but it saved`);
        assert.equal((await again()).status, 200);
      }
      assert.equal(await st(), 'not-now');
    },
  }));
});
