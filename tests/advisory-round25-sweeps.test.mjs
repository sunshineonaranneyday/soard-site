/**
 * Advisory Board QA round 25: every press this round touches, with the database failing at each of its statements in
 * turn (reads, writes and batches, after a clean control run): once before the statement runs (nothing of it lands), and,
 * for each write, once after it runs (it landed, its answer lost). At every point the answer's words match what the
 * database and the fake email service show happened: a press that answers "not done" changed nothing and sent nothing;
 * one that answers done says what went and what goes in a few minutes, exactly. Pressed again as the words say, then the
 * heartbeat: every member has each email exactly once, nothing owed is left, and nothing is ever made twice.
 * The presses: putting the ask out and emailing it, Email it, an introduction's status, a fundraiser's status, who hears
 * about new applications, a new ask, wish or paper (with the page's id, and with none), and a note on an application.
 * Made-up people only (the repo is public); nothing leaves this machine.
 * Run: node --test tests/advisory-round25-sweeps.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, press, appsPress, heartbeat, memberMakes, faulty, isWrite, quietly, resend, mails, restoreFetch, MEMBERS } from './lib/advisory-r25-world.mjs';
import { readState, writeState } from '../functions/api/_board-roles.js';

after(restoreFetch);

const [ONA] = MEMBERS;
const many = (n) => (n === 1 ? '1 Advisory Board member' : `${n} Advisory Board members`);
const owedLeft = async (DB) => (await DB.prepare('SELECT count(*) AS n FROM advisory_outbox WHERE sent_at IS NULL AND outcome IS NULL').first().catch(() => ({ n: 0 }))).n;
const owedAny = async (DB) => (await DB.prepare('SELECT count(*) AS n FROM advisory_outbox').first().catch(() => ({ n: 0 }))).n;

/**
 * The press `go(env, w)` on a fresh world (`setup()` → w, its env in w.env) with each statement failing in turn. `check`
 * asserts, for each point, what the first answer said against what happened, and what's so once it's pressed again (as
 * its words say) and the heartbeat has run. → { points, bad: [descriptions] }
 */
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
    const where = `#${p.k} ${p.how} "${f.state.hit[0].slice(0, 90)}"`;
    try { await check(w, r1, { where, again: () => quietly(() => go(w.env, w)) }); } catch (e) { bad.push(`${where}: ${e.message.split('\n')[0]}`); }
  }
  return { points: points.length, hit, bad };
}

// ─── Putting the ask out and emailing it; Email it ─────────────────────

const ASK = /^This month’s ask: /;
const askSaid = (sent, owed, out = true) => (!owed ? `${out ? 'It’s out, and emailed to' : 'Emailed to'} ${many(sent)}.`
  : !sent ? `${out ? 'The ask is out. Its email goes to' : 'Its email goes to'} ${many(owed)} in a few minutes.`
    : `${out ? 'The ask is out. ' : ''}It went to ${many(sent)}; the other ${owed} ${owed === 1 ? 'gets' : 'get'} it in a few minutes.`);
const ID = 'ask_sweepqaaaa';
const askSetup = (emails) => async () => {
  const env = await world({ emails });
  const r = await press(env, { action: 'save-ask', ask: { id: ID, title: 'Do you know a roofer?', body: 'Can you share this?', link: '' } });
  assert.equal(r.status, 200, r.error);
  if (!emails) {
    assert.equal((await press(env, { action: 'send-ask', id: ID })).status, 200);
    await writeState(env.DB, 'advisory', { ...(await readState(env.DB, 'advisory')), emails: true });
  }
  return { env };
};
const askCheck = (out) => async (w, r1, { again }) => {
  const DB = w.env.DB;
  const counts = MEMBERS.map((m) => mails(m.email, ASK));
  const row = await DB.prepare('SELECT sent_at, data FROM advisory_asks WHERE id = ?').bind(ID).first();
  const mailed = !!JSON.parse(row.data).mailed;
  if (r1.status === 200) {
    assert.ok(row.sent_at && mailed, 'said done: out, and marked emailed');
    const sent = counts.filter((n) => n === 1).length;
    assert.equal(r1.said, askSaid(sent, MEMBERS.length - sent, out), 'its words: what went, and what goes in a few minutes');
  } else {
    assert.ok(!mailed && counts.every((n) => n === 0) && !(await owedAny(DB)), `said "${r1.error}": nothing marked, nothing sent, nothing owed`);
    if (out) assert.equal(row.sent_at, null, `said "${r1.error}": the ask isn't out`);
    // (nothing done, said so: "That didn't go through" before anything began, or the press's own words, 503)
    assert.ok([500, 503].includes(r1.status) && /didn’t go through|nothing was sent|isn’t out|nothing was changed|couldn’t check your sign-in/.test(r1.error), `said in words: ${r1.status} ${r1.error}`);
    const r2 = await again();
    assert.equal(r2.status, 200, `pressed again: ${r2.error}`);
  }
  assert.ok(counts.every((n) => n <= 1), `never twice: ${counts}`);
  await heartbeat(w.env);
  await heartbeat(w.env, 25 * 60 * 1000);
  assert.deepEqual(MEMBERS.map((m) => mails(m.email, ASK)), MEMBERS.map(() => 1), 'every member, once');
  assert.equal(await owedLeft(DB), 0, 'nothing owed is left');
};

test('sweep: putting the ask out and emailing the Advisory Board', async () => {
  const r = await sweep({ setup: askSetup(true), go: (env) => press(env, { action: 'send-ask', id: ID, emailsOk: true }), check: askCheck(true) });
  console.log(`[sweep] ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `: ${r.bad.slice(0, 3).join(' | ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
  assert.ok(r.hit > 20, `${r.hit} points hit`);
});

test('sweep: Email it, for an ask out with the emails off', async () => {
  const r = await sweep({ setup: askSetup(false), go: (env) => press(env, { action: 'email-ask', id: ID }), check: askCheck(false) });
  console.log(`[sweep] ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `: ${r.bad.slice(0, 3).join(' | ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
  assert.ok(r.hit > 15, `${r.hit} points hit`);
});

// ─── An introduction's status; a fundraiser's ──────────────────────────

for (const [kind, action, status, re, table] of [['intro', 'intro-status', 'talking', /^An update on /, 'advisory_intros'], ['hosted', 'hosted-status', 'not-now', /^Your fundraiser: /, 'advisory_hosted']]) {
  test(`sweep: ${kind === 'intro' ? 'an introduction' : 'a fundraiser'}'s status, and the member's update email`, async () => {
    const setup = async () => {
      const env = await world();
      const rec = await memberMakes(env, ONA, kind === 'intro' ? 'intro' : 'host');
      return { env, id: rec.id, was: rec.status };
    };
    const go = (env, w) => press(env, { action, id: w.id, status, note: 'We called them.', ...(kind === 'hosted' ? { date: '', giveUrl: '' } : {}) });
    const r = await sweep({
      setup, go,
      check: async (w, r1, { again }) => {
        const DB = w.env.DB;
        const now = (await DB.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(w.id).first()).status;
        const n = mails(ONA.email, re);
        if (r1.status === 200) {
          assert.equal(now, status, 'said done: set');
          assert.equal(r1.said, n === 1 ? 'Ona was emailed.' : 'Ona’s email goes in a few minutes.', 'its words: emailed, or goes in a few minutes');
        } else {
          assert.ok(now === w.was && n === 0 && !(await owedAny(DB)), `said "${r1.error}": nothing changed, nothing sent, nothing owed`);
          assert.ok([500, 503].includes(r1.status) && /didn’t go through|nothing was changed|couldn’t check your sign-in/.test(r1.error), `said in words: ${r1.status} ${r1.error}`);
          const r2 = await again();
          assert.equal(r2.status, 200, `pressed again: ${r2.error}`);
        }
        assert.ok(n <= 1, 'never twice');
        await heartbeat(w.env);
        await heartbeat(w.env, 25 * 60 * 1000);
        assert.equal(mails(ONA.email, re), 1, 'Ona, once');
        assert.equal(await owedLeft(DB), 0, 'nothing owed is left');
      },
    });
    console.log(`[sweep] ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `: ${r.bad.slice(0, 3).join(' | ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
    assert.ok(r.hit > 8, `${r.hit} points hit`);
  });
}

// ─── Who hears about new applications ──────────────────────────────

test('sweep: who hears about new applications (People → Applications), Save', async () => {
  const listNow = async (DB) => { const x = await DB.prepare("SELECT value FROM advisory_settings WHERE key = 'staffEmails'").first().catch(() => null); return x ? JSON.parse(x.value) : null; };
  const r = await sweep({
    setup: async () => ({ env: await world() }),
    go: (env) => appsPress(env, { settings: { staffEmails: 'hears.sweepqa@example.org', committee: '' } }),
    check: async (w, r1, { again }) => {
      const saved = JSON.stringify(await listNow(w.env.DB)) === JSON.stringify(['hears.sweepqa@example.org']);
      if (r1.status === 200) assert.ok(saved && JSON.stringify(r1.settings.staffEmails) === JSON.stringify(['hears.sweepqa@example.org']), 'said saved: saved, and answered with it');
      else {
        assert.ok(!saved, `said "${r1.error}", but it saved`);
        assert.equal((await again()).status, 200, 'pressed again');
      }
    },
  });
  console.log(`[sweep] ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `: ${r.bad.slice(0, 3).join(' | ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
});

// ─── A new ask, wish or paper; a note ──────────────────────────────

for (const [label, action, field, raw, table] of [
  ['an ask', 'save-ask', 'ask', { id: 'ask_newsweepqa', title: 'Do you know a painter?', body: 'Two rooms.', link: '' }, 'advisory_asks'],
  ['a wish', 'save-wish', 'wish', { id: 'w_newsweepqaa', title: 'A licensed electrician', detail: 'North Fulton' }, 'advisory_wishlist'],
  ['a paper', 'save-doc', 'doc', { id: 'ad_newsweepqa', kind: 'pitch', title: 'Our 30-second pitch', body: 'Kids, rooms, joy.', shared: true }, 'advisory_docs'],
]) {
  for (const withId of [true, false]) {
    test(`sweep: ${label}, saved new${withId ? ' (the page\'s id)' : ' with no id'}`, async () => {
      const sent = withId ? raw : Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'id'));
      const count = async (DB) => (await DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE json_extract(data, '$.title') = ?`).bind(raw.title).first()).n;
      const r = await sweep({
        setup: async () => ({ env: await world() }),
        go: (env) => press(env, { action, [field]: sent }),
        check: async (w, r1, { again }) => {
          const n = await count(w.env.DB);
          if (r1.status === 200) assert.equal(n, 1, 'said saved: one');
          else {
            if (withId) assert.equal(n, 0, `said "${r1.error}", but it saved`);
            assert.equal((await again()).status, 200, 'pressed again');
          }
          assert.equal(await count(w.env.DB), 1, 'one, never a second');
        },
      });
      console.log(`[sweep] ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `: ${r.bad.slice(0, 3).join(' | ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
    });
  }
}

test('sweep: a note on an application, with its key', async () => {
  const { ensureAdvisorySchema } = await import('../functions/api/_advisory-applications.js');
  const note = { id: 'adv-sweepqa-0001', text: 'Called her, she can start in March.', key: 'n0123456789abcdef' };
  const r = await sweep({
    setup: async () => {
      const env = await world();
      await ensureAdvisorySchema(env.DB);
      await env.DB.prepare("INSERT INTO advisory_applications (id, source, name, email, answers, status, created_at, updated_at) VALUES ('adv-sweepqa-0001', 'site', 'Nora Noteqa', 'nora.noteqa@example.org', '{}', 'new', ?, ?)").bind(new Date().toISOString(), new Date().toISOString()).run();
      return { env };
    },
    go: (env) => appsPress(env, { note }),
    check: async (w, r1, { again }) => {
      const notes = async () => JSON.parse((await w.env.DB.prepare("SELECT notes FROM advisory_applications WHERE id = 'adv-sweepqa-0001'").first()).notes || '[]').filter((x) => x.text === note.text).length;
      if (r1.status === 200) assert.equal(await notes(), 1, 'said saved: once');
      else {
        assert.equal(await notes(), 0, `said "${r1.error}", but it saved`);
        assert.equal((await again()).status, 200, 'pressed again');
      }
      assert.equal(await notes(), 1, 'once, never twice');
    },
  });
  console.log(`[sweep] ${r.hit} points hit (${r.points} run), ${r.bad.length} BAD${r.bad.length ? `: ${r.bad.slice(0, 3).join(' | ')}` : ''}`);
  assert.deepEqual(r.bad, [], `${r.bad.length} of ${r.hit} points`);
});
