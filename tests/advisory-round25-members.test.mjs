/**
 * Advisory Board QA round 25, the coordinator's follow-up: the members' own presses on their page (/api/advisory-portal)
 * and the "I can help" button in the monthly ask's email (/api/advisory-action).
 *   1  the notice to whoever runs the group (an introduction, a request to host, a yes to the ask on the page or in the
 *      email, a renewal) is owed in the SAME write as the member's change that makes it owed, so it can never be lost:
 *      the email service down as they press, the heartbeat sends it, once
 *   2  a member's new introduction or request to host is made once: its id is the page's, made once for the form; one
 *      already at that id is answered as done (no second record, no second notice); a write whose answer was lost is
 *      looked for at its id and answered as done; someone else's id is refused
 * Every one of these presses with the database failing at each of its statements in turn, before it runs and (each
 * write) with its answer lost: the press answers done only when its change landed and "didn't go through" only when it
 * didn't; pressed again as the words say, then the heartbeat: the change there once, and whoever runs the group told
 * exactly once, never lost, never twice.
 * Made-up people only (the repo is public); nothing leaves this machine.
 * Run: node --test tests/advisory-round25-members.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { world, heartbeat, faulty, isWrite, quietly, resend, restoreFetch, MEMBERS } from './lib/advisory-r25-world.mjs';

after(restoreFetch);

const [ONA] = MEMBERS;
const TOKEN = 'tok_ona_rtwentyfive_link_0001';
const ASK = 'ask_memberqaaaa';
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const told = (re) => resend.delivered.filter((m) => re.test(m.subject || '')).length;

/** A world with Ona's term ending in a month (Renew open), an ask out, and her link for it in the ask's email */
async function memberWorld() {
  const env = await world();
  const A = await import('../functions/api/_advisory.js');
  const at = new Date().toISOString();
  await env.DB.prepare('INSERT INTO advisory_asks (id, data, sent_at, at, by) VALUES (?, ?, ?, ?, ?)').bind(ASK, JSON.stringify({ title: 'Do you know a roofer?', body: '', link: '' }), at, at, 'x').run();
  await env.DB.prepare('INSERT INTO advisory_terms (slug, started_on, ends_on) VALUES (?, ?, ?)').bind(ONA.slug, '2026-01-02', new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)).run();
  await env.DB.prepare('INSERT INTO advisory_links (hash, ask_id, slug, expires) VALUES (?, ?, ?, ?)').bind(await sha(TOKEN), ASK, ONA.slug, '2099-01-01T00:00:00.000Z').run();
  await A.ensureAdvisory(env.DB);
  return { env };
}
/** A press on Ona's own page → { status, ...answer } */
async function portal(env, body) {
  const api = await import('../functions/api/advisory-portal.js');
  const waits = [];
  const res = await api.onRequestPost({ env, data: { advisor: { slug: ONA.slug, name: ONA.name, email: ONA.email } }, waitUntil: (p) => waits.push(p),
    request: new Request('https://site.test/api/advisory-portal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  await Promise.all(waits);
  return { status: res.status, ...(await res.json()) };
}
/** "I can help" pressed in the ask's email → { status } (its page: 200 thank you, else in words) */
async function emailYes(env) {
  const api = await import('../functions/api/advisory-action.js');
  const form = new FormData(); form.set('t', TOKEN); form.set('do', 'yes'); form.set('note', 'My cousin');
  const waits = [];
  const res = await api.onRequestPost({ env, request: new Request('https://site.test/api/advisory-action', { method: 'POST', body: form }), waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const text = await res.text();
  return { status: res.status, ok: res.status === 200 && /Thank you/.test(text), error: (text.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '' };
}

const PRESSES = {
  'an introduction': {
    go: (env) => portal(env, { action: 'intro', id: 'in_memberqaaaa', name: 'Pat Introqa', company: 'Testco', how: 'A neighbor' }),
    landed: async (DB) => (await DB.prepare("SELECT count(*) AS n FROM advisory_intros WHERE instr(data, 'Pat Introqa') > 0").first()).n,
    notice: / made an introduction$/,
  },
  'a request to host a fundraiser': {
    go: (env) => portal(env, { action: 'host', id: 'h_memberqaaaaa', title: 'A backyard dinner', when: 'Spring' }),
    landed: async (DB) => (await DB.prepare("SELECT count(*) AS n FROM advisory_hosted WHERE instr(data, 'A backyard dinner') > 0").first()).n,
    notice: / wants to host a fundraiser$/,
  },
  'a yes to the ask on their page': {
    go: (env) => portal(env, { action: 'answer', askId: ASK, answer: 'yes', note: 'My cousin' }),
    landed: async (DB) => (await DB.prepare("SELECT count(*) AS n FROM advisory_answers WHERE ask_id = ? AND answer = 'yes'").bind(ASK).first()).n,
    notice: / can help with this month’s ask$/,
  },
  'a renewal': {
    go: (env) => portal(env, { action: 'renew' }),
    landed: async (DB) => (await DB.prepare('SELECT count(*) AS n FROM advisory_terms WHERE slug = ? AND renewed_on IS NOT NULL').bind(ONA.slug).first()).n,
    notice: / renewed$/,
  },
  '"I can help" in the ask\'s email': {
    go: (env) => emailYes(env),
    landed: async (DB) => (await DB.prepare("SELECT count(*) AS n FROM advisory_answers WHERE ask_id = ? AND answer = 'yes' AND via = 'email'").bind(ASK).first()).n,
    notice: / can help with this month’s ask$/,
  },
};

// ─── 1: never lost ────────────────────────────────────────────────

for (const [label, p] of Object.entries(PRESSES)) {
  test(`1: ${label}, the email service down as it's pressed: done, and whoever runs the group is told once, by the heartbeat`, async () => {
    const { env } = await memberWorld();
    resend.down = true;
    const r = await quietly(() => p.go(env));
    assert.ok(r.ok, `done: ${r.status} ${r.error}`);
    assert.equal(await p.landed(env.DB), 1);
    assert.equal(told(p.notice), 0, 'nothing went just now');
    resend.down = false;
    await heartbeat(env);
    await heartbeat(env, 30 * 60 * 1000);
    assert.equal(told(p.notice), 1, 'told once');
  });
}

// ─── 2: a new introduction or request, made once ─────────────────────

for (const [label, kind, body, table, re] of [
  ['an introduction', 'intro', { name: 'Pat Introqa', company: 'Testco', how: 'A neighbor' }, 'advisory_intros', / made an introduction$/],
  ['a request to host', 'host', { title: 'A backyard dinner', when: 'Spring' }, 'advisory_hosted', / wants to host a fundraiser$/]]) {
  const count = async (DB) => (await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  const insert = `INSERT INTO ${table} (id, slug, status, data, at, updated_at)`;
  for (const withId of [true, false]) {
    test(`2: ${label}${withId ? ' (the page\'s id)' : ' with no id (a tab opened before)'}, its write landing with its answer lost: answered as done${withId ? '' : ' when pressed again'}, one record, one notice`, async () => {
      const { env } = await memberWorld();
      const sent = { action: kind, ...(withId ? { id: kind === 'intro' ? 'in_onceqaaaaaa' : 'h_onceqaaaaaaa' } : {}), ...body };
      const f = faulty(env.DB, (sql) => (sql.replace(/^\[batch\] /, '').startsWith(insert) && !f.state.hit.length ? 'after' : null));
      const r1 = await quietly(() => portal({ ...env, DB: f.DB }, sent));
      assert.equal(f.state.hit.length, 1, 'its write landed, its answer lost');
      if (withId) assert.equal(r1.status, 200, `answered as done: ${r1.error}`);
      const r2 = await portal(env, sent);
      assert.equal(r2.status, 200, r2.error);
      await heartbeat(env);
      assert.equal(await count(env.DB), 1, 'one, never a second');
      assert.equal(told(re), 1, 'one notice');
    });
  }
  test(`2: ${label} at an id that's someone else's is refused, and nothing is made`, async () => {
    const { env } = await memberWorld();
    const A = await import('../functions/api/_advisory.js');
    const other = MEMBERS[1];
    const theirs = kind === 'intro' ? await A.addIntro(env.DB, { slug: other.slug, email: other.email }, { id: 'in_theirsqaaaa', name: 'Lou Contact' })
      : await A.requestHost(env.DB, { slug: other.slug, email: other.email }, { id: 'h_theirsqaaaaa', title: 'Their dinner' });
    const r = await quietly(() => portal(env, { action: kind, id: theirs.id, ...body }));
    assert.equal(r.status, 409, r.error);
    assert.equal(await count(env.DB), 1, 'only theirs');
  });
}

// ─── Every statement of each press, failing in turn ────────────────────

for (const [label, p] of Object.entries(PRESSES)) {
  test(`sweep: ${label}, each statement failing before it runs and each write with its answer lost: done only when it landed, and whoever runs the group told exactly once`, async () => {
    const c = await memberWorld();
    const f0 = faulty(c.env.DB);
    const r0 = await quietly(() => p.go({ ...c.env, DB: f0.DB }));
    assert.ok(r0.ok, `the control: ${r0.status} ${r0.error}`);
    const trace = f0.state.trace;
    const points = [];
    for (let k = 1; k <= trace.length; k++) { points.push({ k, how: 'before' }); if (isWrite(trace[k - 1])) points.push({ k, how: 'after' }); }
    const bad = [];
    let hit = 0;
    for (const pt of points) {
      const { env } = await memberWorld();
      const f = faulty(env.DB, (sql, n) => (n === pt.k ? pt.how : null));
      const r1 = await quietly(() => p.go({ ...env, DB: f.DB }));
      if (!f.state.hit.length) continue;
      hit += 1;
      const where = `#${pt.k} ${pt.how} "${f.state.hit[0].slice(0, 80)}"`;
      try {
        const n1 = await p.landed(env.DB);
        if (r1.ok) assert.equal(n1, 1, 'said done: it landed');
        else {
          assert.equal(n1, 0, `said "${r1.error}", but it landed`);
          const r2 = await quietly(() => p.go(env));
          assert.ok(r2.ok, `pressed again: ${r2.status} ${r2.error}`);
        }
        assert.ok(told(p.notice) <= 1, 'never twice');
        await heartbeat(env);
        await heartbeat(env, 30 * 60 * 1000);
        assert.equal(await p.landed(env.DB), 1, 'there once');
        assert.equal(told(p.notice), 1, 'whoever runs the group told exactly once');
      } catch (e) { bad.push(`${where}: ${e.message.split('\n')[0]}`); }
    }
    console.log(`[sweep] ${label}: ${hit} points hit (${points.length} run), ${bad.length} BAD${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`);
    assert.deepEqual(bad, []);
    assert.ok(hit > 10, `${hit} points hit`);
  });
}
