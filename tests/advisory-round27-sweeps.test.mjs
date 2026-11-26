/**
 * Advisory Board QA round 27: every press this round touches, swept. After a clean control run, the database fails at
 * each of the press's statements in turn: once before it runs (nothing of it lands), and, for each write, once after it
 * runs (it landed, its answer lost). Then the press runs with Resend answering 502, 429 or its own 422 for one person
 * (the 422 every time it's asked), or taking the email and the answer being lost. At every point the answer's words
 * match what the database and the fake email service show; pressed again as the words say, then the heartbeat 3
 * minutes, 11 minutes, 2 days and 3 days on (Resend forgetting its keys after the first day): nobody gets an email
 * twice, and nothing owed is lost silently (it went once, or it's a refusal said in words, never tried again, or it may
 * not have gone and is on Run it to send again).
 * The presses: the monthly ask put out and emailed, Email it, an introduction's and a fundraiser's status, a member's
 * answer to the ask after they were renamed on People (and the rename itself), a member's sign-in email from their
 * row, and the heartbeat at 3 minutes, 11 minutes, 2 days and 3 days.
 * Made-up people only (the repo is public); nothing leaves this machine.
 * Run: node --test tests/advisory-round27-sweeps.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  world, press, runIt, faulty, isWrite, quietly, resend, mails, restoreFetch, MEMBERS, resendClear, WELCOME, NOTICE, LEAD, signInKnows,
  memberPress, memberMakes, welcomeState, refuse, once, refuseClear, forget, beat, beats, MIN, DAY, renameTo, outboxRows, emailsSet,
} from './lib/advisory-r27-world.mjs';

after(restoreFetch);

const [ONA, REX] = MEMBERS;
const ASK = /^This month’s ask: /;
const UPDATE = /^(An update on |Your fundraiser: )/;
const MODES = [502, 429, 422, 'lose'];
const arm = (mode, to) => { if (mode === 422) refuse.set(to, 422); else once.set(to, mode); };

/** `go(env, w)` on a fresh world (`setup`) with each statement failing in turn, then with each of Resend's answers */
async function sweep({ setup, go, check, target, modes = MODES }) {
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
    const where = `#${p.k} ${p.how} "${f.state.hit[0].slice(0, 70)}"`;
    try { await check(w, r1, { mode: null, again: () => quietly(() => go(w.env, w)) }); } catch (e) { bad.push(`${where}: ${e.message.split('\n')[0]} (${r1.status} ${r1.error || r1.said || ''})`); }
  }
  for (const mode of modes) {
    const w = await setup();
    arm(mode, target);
    const r1 = await quietly(() => go(w.env, w));
    hit += 1;
    try { await check(w, r1, { mode, again: () => quietly(() => go(w.env, w)) }); } catch (e) { bad.push(`Resend ${mode}: ${e.message.split('\n')[0]} (${r1.status} ${r1.error || r1.said || ''})`); }
  }
  return { points: points.length + modes.length, hit, bad };
}
const report = (name, r) => {
  console.log(`[sweep] ${name}: ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `:\n  ${r.bad.join('\n  ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
};
/** Nothing owed left, and every email that may not have gone listed on Run it (never lost silently) */
async function nothingLost(env) {
  const rows = await outboxRows(env.DB);
  const owed = rows.filter((r) => !r.sent_at && !r.outcome);
  assert.deepEqual(owed.map((r) => r.key), [], 'nothing left owed');
  const unsure = rows.filter((r) => r.outcome === 'unsure').map((r) => r.key).sort();
  assert.deepEqual(((await runIt(env)).unsure || []).map((u) => u.key).sort(), unsure, 'each one that may not have gone is on Run it');
  const st = await welcomeState(env.DB);
  assert.deepEqual(Object.keys(st.waiting), [], 'no welcome left owed');
}
const NOT_SENT = /nothing was (sent|changed)|isn’t out and nothing was sent|can’t tell yet|couldn’t check/;

// ─── The monthly ask, put out and emailed; Email it ──────────────────

const ID = 'ask_r27sweepqa';
const many = (n) => (n === 1 ? '1 Advisory Board member' : `${n} Advisory Board members`);
/** The ask's words as decided (round 26's, with round 27's refusal): `sent` went, `owed` go in a few minutes, `refused` named */
const askSaid = ({ sent, owed, refused }, out) => {
  const no = refused.length ? ` The email service refused the email to ${refused.join(' and ')}, so it didn’t go. Check their email on People.` : '';
  if (!sent && !owed) return `${out ? 'It’s on the page, but its email didn’t go.' : 'Nothing went out.'}${no}`;
  if (!owed) return `${out ? 'It’s out, and emailed to' : 'Emailed to'} ${many(sent)}.${no}`;
  if (!sent) return `${out ? 'The ask is out. Its email goes to' : 'Its email goes to'} ${many(owed)} in a few minutes.${no}`;
  return `${out ? 'The ask is out. ' : ''}It went to ${many(sent)}; ${refused.length ? `${owed} more` : `the other ${owed}`} ${owed === 1 ? 'gets' : 'get'} it in a few minutes.${no}`;
};
const askCheck = (out) => async (w, r1, { mode, again }) => {
  let r = r1;
  if (r.status !== 200) {
    assert.match(r.error || '', NOT_SENT, 'a failure in true words');
    if (!/can’t tell yet/.test(r.error)) assert.deepEqual(MEMBERS.map((m) => mails(m.email, ASK)), [0, 0], `said "${r.error}", but it went`);
    r = await again();
    assert.equal(r.status, 200, 'pressed again, as the words say');
  }
  const now = MEMBERS.map((m) => mails(m.email, ASK));
  assert.ok(now.every((n) => n <= 1), 'never twice');
  const rows = (await outboxRows(w.env.DB)).filter((x) => x.kind === 'ask' && x.ref === ID);
  const refused = rows.filter((x) => x.outcome === 'refused').map((x) => JSON.parse(x.msg).name.split(' ')[0]);
  // (one Resend took whose answer was lost went, and is said as owed: it may have gone)
  const lost = mode === 'lose' ? 1 : 0;
  const sent = now.filter((n) => n === 1).length - lost;
  if (r !== r1 || !/already had this email/.test(r.said)) assert.equal(r.said, askSaid({ sent, owed: MEMBERS.length - sent - refused.length, refused }, out), 'its words: what went, what goes in a few minutes, what was refused');
  const log = (await runIt(w.env)).mail.find((l) => l.id === ID && /^ask/.test(l.kind));
  if (log) assert.equal(log.kind === 'ask' ? log.sent : 0, MEMBERS.length - refused.length, 'What’s gone out: never one refused');
  await beats(w.env);
  const end = MEMBERS.map((m) => mails(m.email, ASK));
  if (mode === 422) {
    assert.deepEqual(end, [1, 0], 'Rex refused: never sent, never tried again');
    assert.deepEqual(refused, ['Rex'], 'and said so');
    assert.equal((await outboxRows(w.env.DB)).find((x) => x.key === `ask:${ID}:${REX.email}`).outcome, 'refused');
  } else assert.deepEqual(end, [1, 1], 'once each in the end, never twice, never lost');
  await nothingLost(w.env);
};

test('sweep: the monthly ask put out and emailed to the Advisory Board', async () => {
  report('the ask put out and emailed', await sweep({
    target: REX.email,
    setup: async () => {
      resendClear(); refuseClear();
      const env = await world();
      assert.equal((await press(env, { action: 'save-ask', ask: { id: ID, title: 'Do you know a roofer?', body: 'Can you share this?', link: '' } })).status, 200);
      return { env };
    },
    go: (env) => press(env, { action: 'send-ask', id: ID, emailsOk: true }),
    check: askCheck(true),
  }));
});

test('sweep: Email it, for an ask that went out while emails were off', async () => {
  report('Email it', await sweep({
    target: REX.email,
    setup: async () => {
      resendClear(); refuseClear();
      const env = await world({ emails: false });
      await press(env, { action: 'save-ask', ask: { id: ID, title: 'Do you know a roofer?', body: 'Can you share this?', link: '' } });
      assert.equal((await press(env, { action: 'send-ask', id: ID })).status, 200);
      await emailsSet(env, true);
      return { env };
    },
    go: (env) => press(env, { action: 'email-ask', id: ID }),
    check: askCheck(false),
  }));
});

// ─── An introduction's and a fundraiser's status ──────────────────────

for (const kind of ['intro', 'hosted']) {
  test(`sweep: ${kind === 'intro' ? 'an introduction' : 'a fundraiser request'}'s status, its update email to the member`, async () => {
    report(`the ${kind} status`, await sweep({
      target: REX.email,
      setup: async () => {
        resendClear(); refuseClear();
        const env = await world();
        const x = await memberMakes(env, REX, kind);
        return { env, id: x.id };
      },
      go: (env, w) => press(env, kind === 'intro' ? { action: 'intro-status', id: w.id, status: 'talking', note: 'We called them.' } : { action: 'hosted-status', id: w.id, status: 'not-now', note: 'Next year.' }),
      check: async (w, r1, { mode, again }) => {
        let r = r1;
        if (r.status !== 200) {
          assert.match(r.error || '', NOT_SENT, 'a failure in true words');
          if (!/can’t tell yet/.test(r.error)) assert.equal(mails(REX.email, UPDATE), 0, `said "${r.error}", but it went`);
          r = await again();
          assert.equal(r.status, 200);
        }
        const n = mails(REX.email, UPDATE);
        const row = (await outboxRows(w.env.DB)).find((x) => x.key === `update:${kind}:${w.id}`);
        if (r.said === 'Rex was emailed.') assert.equal(n, 1, 'said emailed: it went');
        else if (r.said === 'Rex’s email goes in a few minutes.') assert.ok(row && !row.sent_at && !row.outcome, 'said in a few minutes: it is owed');
        else if (/^The email service refused the email to Rex, so it didn’t go\. Check their email on People\.$/.test(r.said)) assert.equal(row?.outcome, 'refused', 'said refused: it is');
        else if (r.said === '') assert.ok(r !== r1 && (n === 1 || row?.outcome === 'sent' || (row && !row.sent_at && !row.outcome)), 'pressed again with nothing new: the first press’s email went or is owed');
        else assert.fail(`words that aren't what happened: "${r.said}"`);
        assert.ok(n <= 1, 'never twice');
        await beats(w.env);
        assert.equal(mails(REX.email, UPDATE), mode === 422 ? 0 : 1, mode === 422 ? 'refused: never tried again' : 'once in the end');
        await nothingLost(w.env);
      },
    }));
  });
}

// ─── A member's answer to the ask after they were renamed on People ───

const HELP = 'ask_r27helpswp';
const NEW = 'ona-sweptqa';
const told = (re) => resend.delivered.filter((m) => [m.to].flat().includes(LEAD) && re.test(m.subject || '')).length;
const CAN = /can help with this month’s ask$/;
const CHANGED = /changed their answer to this month’s ask$/;
async function helpSetup({ rename = true } = {}) {
  resendClear(); refuseClear();
  const env = await world();
  await press(env, { action: 'save-ask', ask: { id: HELP, title: 'Do you know a roofer?', body: '', link: '' } });
  await press(env, { action: 'send-ask', id: HELP, emailsOk: true });
  assert.equal((await memberPress(env, ONA, { action: 'answer', askId: HELP, answer: 'yes', note: 'I know one.' })).status, 200);
  await beat(env, 3 * MIN);
  assert.equal(told(CAN), 1, 'whoever runs the group was told she can help');
  if (rename) await renameTo(env, ONA.slug, NEW);
  return { env };
}
const answerNow = async (env) => (await env.DB.prepare('SELECT slug, answer FROM advisory_answers WHERE ask_id = ?').bind(HELP).first()) || null;
for (const [what, body, changed] of [['no, after a yes whose notice went', { answer: 'no' }, 1], ['the same yes again', { answer: 'yes', note: 'I know one.' }, 0]]) {
  test(`sweep: a member's answer to the ask after they were renamed on People: ${what}`, async () => {
    report(`the answer after a rename (${what})`, await sweep({
      target: LEAD,
      setup: () => helpSetup(),
      go: (env) => memberPress(env, ONA, { action: 'answer', askId: HELP, ...body }),
      check: async (w, r1, { mode, again }) => {
        if (r1.status === 200) assert.deepEqual(await answerNow(w.env), { slug: NEW, answer: body.answer }, 'said taken: it is, at her address now');
        else {
          assert.equal((await answerNow(w.env)).answer, 'yes', `said "${r1.error}", but it was taken`);
          assert.equal((await again()).status, 200);
        }
        await beats(w.env);
        assert.equal(told(CAN), 1, 'one "can help", never a second');
        assert.equal(told(CHANGED), mode === 422 ? 0 : changed, changed ? 'one "changed their answer"' : 'nothing more');
        const notices = (await outboxRows(w.env.DB)).filter((x) => x.kind === 'notice');
        assert.deepEqual(notices.map((x) => x.key), [`notice:answer:${HELP}:${NEW}`], 'one notice, at her address now');
        if (mode === 422 && changed) assert.equal(notices[0].outcome, 'refused');
        else await nothingLost(w.env);
      },
    }));
  });
}

test('sweep: the rename itself, with her notice had: each of its statements failing, then her no', async () => {
  const { maybeFinishRenames } = await import('../functions/api/_rename-finish.js');
  report('the rename', await sweep({
    target: LEAD,
    modes: [],
    setup: () => helpSetup({ rename: false }),
    go: async (env) => { try { await renameTo(env, ONA.slug, NEW); return { status: 200 }; } catch (e) { return { status: 500, error: e.message }; } },
    check: async (w, r1) => {
      // (whatever the rename said, the heartbeat finishes what's left of it, and her answer goes on from there)
      await maybeFinishRenames(w.env.DB, { now: Date.now() + 2 * MIN }).catch(() => {});
      const slug = (await w.env.DB.prepare('SELECT slug FROM reveal_board_emails WHERE email = ?').bind(ONA.email).first()).slug;
      if (r1.status === 200) assert.equal(slug, NEW, 'said renamed: it is');
      const r = await memberPress(w.env, ONA, { action: 'answer', askId: HELP, answer: 'no' });
      assert.equal(r.status, 200, r.error);
      await beats(w.env);
      assert.equal(told(CAN), 1);
      assert.equal(told(CHANGED), 1, 'her no after the yes they were told of: one "changed their answer"');
      const notices = (await outboxRows(w.env.DB)).filter((x) => x.kind === 'notice');
      assert.deepEqual(notices.map((x) => x.key), [`notice:answer:${HELP}:${slug}`], 'her notice, at her address now');
      await nothingLost(w.env);
    },
  }));
});

// ─── A member's sign-in email from their row ──────────────────────────

test('sweep: a member\'s sign-in email from their row', async () => {
  report('the row\'s sign-in email', await sweep({
    target: ONA.email,
    setup: async () => { resendClear(); refuseClear(); const env = await world(); await signInKnows(env); return { env }; },
    go: (env) => press(env, { action: 'send-welcome-to', slug: ONA.slug }),
    check: async (w, r1, { mode, again }) => {
      const n = mails(ONA.email, WELCOME);
      if (r1.status === 200 && r1.sent) assert.equal(n, 1, 'said sent: it went');
      else if (r1.status === 200 && r1.owed) assert.ok(n <= 1 && (await welcomeState(w.env.DB)).waiting[ONA.slug]?.key, 'said in a few minutes: it is owed');
      else if (r1.status === 200 && r1.refused) assert.equal(n, 0, 'said refused: nothing went');
      else if (r1.status === 200 && r1.notReady) assert.equal(n, 0);
      else if (r1.status === 200) assert.fail(`an answer that isn't what happened: ${JSON.stringify(r1)}`);
      else {
        assert.match(r1.error || '', NOT_SENT);
        if (!/can’t tell yet/.test(r1.error)) assert.equal(n, 0, 'said nothing was sent, but it went');
      }
      if (!(r1.status === 200 && (r1.sent || r1.refused))) await again();
      await beats(w.env);
      assert.equal(mails(ONA.email, WELCOME), mode === 422 ? 0 : 1, mode === 422 ? 'refused: never sent by itself' : 'once in the end');
      await nothingLost(w.env);
    },
  }));
});

// ─── The heartbeat, 3 minutes, 11 minutes, 2 days and 3 days on ───────

for (const [label, ahead] of [['3 minutes', 3 * MIN], ['11 minutes', 11 * MIN], ['2 days', 2 * DAY], ['3 days', 3 * DAY]]) {
  test(`sweep: the heartbeat ${label} on, with an ask and an update owed after Resend's 502 and a welcome whose answer was lost`, async () => {
    report(`the heartbeat ${label} on`, await sweep({
      target: REX.email,
      setup: async () => {
        resendClear(); refuseClear();
        const env = await world();
        await signInKnows(env);
        await press(env, { action: 'save-ask', ask: { id: ID, title: 'Do you know a roofer?', body: '', link: '' } });
        once.set(REX.email, 502);
        await press(env, { action: 'send-ask', id: ID, emailsOk: true });
        const intro = await memberMakes(env, REX, 'intro');
        once.set(REX.email, 502);
        await press(env, { action: 'intro-status', id: intro.id, status: 'talking', note: '' });
        const mail = await import('../functions/api/_advisory-mail.js');
        once.set(ONA.email, 'lose');
        await quietly(() => mail.welcomeOnJoin(env, ONA.slug, { by: 'x' }));
        refuseClear();
        // (past a day, Resend no longer keeps the keys)
        if (ahead > DAY) forget();
        return { env };
      },
      go: async (env) => { await beat(env, ahead); return { status: 200 }; },
      check: async (w, r1, { mode }) => {
        assert.ok(mails(REX.email, ASK) <= 1 && mails(REX.email, UPDATE) <= 1 && mails(ONA.email, WELCOME) <= 1, 'never twice');
        // (the heartbeats after it, in time's order)
        await beats(w.env, { from: ahead });
        await beat(w.env, ahead + 4 * DAY);
        assert.equal(mails(REX.email, ASK), mode === 422 ? 0 : 1, 'the ask: once when it can');
        assert.equal(mails(REX.email, UPDATE), mode === 422 ? 0 : 1, 'the update: once when it can');
        assert.equal(mails(ONA.email, WELCOME), 1, 'the welcome that may have gone: never a second by itself');
        assert.equal(mails(ONA.email, ASK), 1);
        const rows = await outboxRows(w.env.DB);
        assert.deepEqual(rows.filter((x) => !x.sent_at && !x.outcome).map((x) => x.key), [], 'nothing left owed');
        if (mode === 422) assert.deepEqual(rows.filter((x) => x.email === REX.email).map((x) => x.outcome), ['refused', 'refused']);
      },
    }));
  });
}
