/**
 * Advisory Board QA round 23 (Nov 23 2026), the admin tester's minor 1, on the server: a member's term write answers
 * with the term that very write saved, never one read again by the address afterwards.
 *   1  Pia presses Renew, held at each statement it makes while staff swap her address with Quin's, or rename her: the
 *      page's answer and the notice to whoever runs the group give her new date (the notice had given Quin's, or the
 *      group's default dates)
 *   1  Staff set her term on Members, held the same way: the answer is the term the write saved, wherever it landed,
 *      never the other member's
 * Add to Advisory Board's findings (minors 2 to 4) are in tests/advisory-round23-add.test.mjs.
 * Made-up people only (the repo is public); Resend, Slack and Google are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round23.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { P, Q, fresh, quietly, RENAMES, slugOf, sent, restoreFetch } from './lib/advisory-r21-world.mjs';

after(restoreFetch);

// (Quin's own term, so the other member's date is never the one Pia's is mistaken for)
const QUIN_TERM = { started: '2026-03-03', ends: '2027-03-03' };
const world = async () => {
  const w = await fresh();
  await w.env.DB.prepare('INSERT INTO advisory_terms (slug, started_on, ends_on) VALUES (?, ?, ?)').bind(Q.slug, QUIN_TERM.started, QUIN_TERM.ends).run();
  return w;
};
const portal = async (env, body) => {
  const { onRequestPost } = await import('../functions/api/advisory-portal.js');
  const { advisorFor } = await import('../functions/api/_board-roles.js');
  const advisor = await advisorFor(env.DB, P.email);
  if (!advisor) throw Object.assign(new Error('not on the sign-in list'), { status: 403 });
  const waits = [];
  const res = await onRequestPost({ env, request: new Request('https://site.test/api/advisory-portal', { method: 'POST', body: JSON.stringify(body) }), data: { advisor, userEmail: P.email }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const j = await res.json();
  if (!res.ok) throw Object.assign(new Error(j.error), { status: res.status, moving: !!j.moving });
  return j;
};
const termAt = async (DB, slug) => DB.prepare('SELECT started_on, ends_on, renewed_on, left_on FROM advisory_terms WHERE slug = ?').bind(slug).first();
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plusYear = (d) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;

for (const ren of ['swap', 'plain']) {
  test(`1: a renewal held at each of its statements while ${ren === 'swap' ? 'two members swap addresses' : 'her address is renamed'}: the page’s answer and the notice give her new date, never ${ren === 'swap' ? 'Quin’s' : 'the group’s default dates'}`, async (t) => {
    const a = await world();
    const was = (await termAt(a.env.DB, P.slug)).ends_on;
    const n = (await a.h.count('write', () => quietly(() => portal(a.env, { action: 'renew' })))).n;
    a.close();
    assert.ok(n > 3, `${n} statements`);
    let held = 0;
    for (let k = 1; k <= n; k++) {
      const { h, env, close } = await world();
      try {
        const r = await h.heldAt('write', k, () => quietly(() => portal(env, { action: 'renew' })), () => RENAMES[ren](env));
        assert.ok(!r.second.err, r.second.err?.message);
        let answer = r.first.ok;
        // (told a change of address was under way: nothing written, and the press made again, as told)
        if (r.first.err) {
          assert.ok(r.first.err.status === 503 && r.first.err.moving, `held at ${k} of ${n}: ${r.first.err.status} ${r.first.err.message}`);
          sent.length = 0;
          answer = await quietly(() => portal(env, { action: 'renew' }));
        }
        held += r.hit ? 1 : 0;
        const at = await slugOf(env.DB, P.email);
        const row = await termAt(env.DB, at);
        assert.equal(row.ends_on, plusYear(was), `held at ${k} of ${n}: her row has her new date`);
        assert.deepEqual(answer.term, { started: row.started_on, ends: row.ends_on, renewedOn: row.renewed_on, left: '' }, `held at ${k} of ${n}: the page’s answer is her term as saved`);
        assert.notEqual(answer.term.ends, QUIN_TERM.ends, `held at ${k} of ${n}: never Quin’s date`);
        const told = sent.filter((m) => /renewed$/.test(m.subject));
        assert.equal(told.length, 1, `held at ${k} of ${n}: one notice`);
        assert.match(told[0].subject, /^Pia /, `held at ${k} of ${n}: names Pia`);
        assert.ok(told[0].text.startsWith(`${P.name} renewed for another year, through ${longDay(row.ends_on)}.`), `held at ${k} of ${n}: the notice gives her date (${told[0].text.split('\n')[0]})`);
        // (Quin's term is Quin's, at Quin's address now)
        const quin = await termAt(env.DB, await slugOf(env.DB, Q.email));
        assert.deepEqual([quin.started_on, quin.ends_on], [QUIN_TERM.started, QUIN_TERM.ends], `held at ${k} of ${n}: Quin’s term untouched`);
      } finally { close(); }
    }
    t.diagnostic(`${n} statements, each held in turn`);
    assert.equal(held, n, 'every statement was held in turn');
  });
}

test('1: staff set her term on Members, held at each statement while two members swap addresses: the answer is the term that write saved, wherever it landed, never the other member’s', async (t) => {
  const { getSettings, setTerm } = await import('../functions/api/_advisory.js');
  const write = async (env) => setTerm(env.DB, P.slug, { ends: '2028-03-01' }, await getSettings(env.DB));
  const a = await world();
  const n = (await a.h.count('write', () => quietly(() => write(a.env)))).n;
  a.close();
  assert.ok(n > 2, `${n} statements`);
  let landed = 0;
  for (let k = 1; k <= n; k++) {
    const { h, env, close } = await world();
    try {
      const r = await h.heldAt('write', k, () => quietly(() => write(env)), () => RENAMES.swap(env));
      assert.ok(!r.second.err, r.second.err?.message);
      // (refused in words: nobody it could be for at that address then, or it's changing: staff are told, nothing written)
      if (r.first.err) {
        assert.ok([403, 503].includes(r.first.err.status), `held at ${k} of ${n}: ${r.first.err.status} ${r.first.err.message}`);
        continue;
      }
      landed += 1;
      const rows = ((await env.DB.prepare("SELECT slug, started_on, ends_on FROM advisory_terms WHERE ends_on = '2028-03-01'").all()).results || []);
      assert.equal(rows.length, 1, `held at ${k} of ${n}: one term set`);
      assert.deepEqual(r.first.ok, { started: rows[0].started_on, ends: '2028-03-01', renewedOn: '', left: '' }, `held at ${k} of ${n}: the answer is the term that write saved (${JSON.stringify(r.first.ok)})`);
    } finally { close(); }
  }
  t.diagnostic(`${n} statements, each held in turn: ${landed} landed, the rest refused in words`);
  assert.ok(landed > 0, 'some landed');
});
