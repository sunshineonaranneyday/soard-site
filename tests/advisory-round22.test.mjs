/**
 * Advisory Board QA round 22 (Nov 22 2026), the admin tester's findings, on the server:
 *   1  the notice to whoever runs the group names the person whose record a member's write landed on, as that very
 *      write found them: an introduction, a hosting request, a renewal and a press of the email's button, each held at
 *      every statement it makes while two members swap addresses (the notice had named the other one, read again by
 *      the record's address afterwards)
 *   2  the email's buttons answer in words on every path, opening and pressing alike: the database failing at each
 *      statement a fresh worker's first request makes, its table setup included (it had been a raw error)
 *   3  naming who runs the group in the moment her address changes: "This board member's web address on People
 *      changed just now..." in every order, never "isn't on the Advisory Board" or "Pick an active board member" (that
 *      only for someone who truly isn't an active board member now)
 *   4  a closed ask: opening the button and pressing it say the same, as does every other state an ask can be in
 * Made-up people only (the repo is public); Resend, Slack and Google are faked, nothing leaves this machine.
 * Run: node --test tests/advisory-round22.test.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { BY, P, Q, TOKEN, ASK, hashOf, fresh, quietly, RENAMES, slugs, slugOf, sent, restoreFetch } from './lib/advisory-r21-world.mjs';

after(restoreFetch);

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
const action = async () => import('../functions/api/advisory-action.js');
const form = (t, { note = '', yes = true } = {}) => { const f = new FormData(); f.set('t', t); f.set('do', yes ? 'yes' : 'no'); f.set('note', note); return f; };
const press = async (env, t = TOKEN, note = '') => {
  const waits = [];
  const res = await (await action()).onRequestPost({ env, request: new Request('https://x/api/advisory-action', { method: 'POST', body: form(t, { note }) }), waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { status: res.status, text: await res.text() };
};
const open = async (env, t = TOKEN) => {
  const res = await (await action()).onRequestGet({ env, request: new Request(`https://x/api/advisory-action?t=${encodeURIComponent(t)}&do=yes`) });
  return { status: res.status, text: await res.text() };
};
const words = (html) => (html.match(/<h1>[\s\S]*?<\/p>/) || [''])[0];

// ─── 1: the notice names whose record the write landed on ───────────────────

const NOTICES = {
  'an introduction': {
    write: (env) => portal(env, { action: 'intro', name: 'Pias Contact' }),
    where: (DB) => slugs(DB, "SELECT slug FROM advisory_intros WHERE instr(data, 'Pias Contact') > 0"),
    subject: /made an introduction$/,
  },
  'a request to host a fundraiser': {
    write: (env) => portal(env, { action: 'host', title: 'Pias Dinner' }),
    where: (DB) => slugs(DB, "SELECT slug FROM advisory_hosted WHERE instr(data, 'Pias Dinner') > 0"),
    subject: /wants to host a fundraiser$/,
  },
  'a renewal': {
    write: (env) => portal(env, { action: 'renew' }),
    where: (DB) => slugs(DB, 'SELECT slug FROM advisory_terms WHERE renewed_on IS NOT NULL'),
    subject: /renewed$/,
  },
  'an “I can help” press in the monthly ask’s email': {
    write: async (env) => { const r = await press(env, TOKEN, 'P pressed'); if (r.status !== 200) throw Object.assign(new Error(words(r.text)), { status: r.status, moving: r.status === 503 }); return r; },
    where: (DB) => slugs(DB, "SELECT slug FROM advisory_answers WHERE note = 'P pressed'"),
    subject: /can help with this month’s ask$/,
  },
};
for (const [name, kind] of Object.entries(NOTICES)) {
  test(`1: ${name} while two members swap addresses, held at each of its statements: the notice names her, never the other one`, async () => {
    const a = await fresh();
    const n = (await a.h.count('write', () => quietly(() => kind.write(a.env)))).n;
    a.close();
    assert.ok(n > 3);
    for (let k = 1; k <= n; k++) {
      const { h, env, close } = await fresh();
      try {
        const r = await h.heldAt('write', k, () => quietly(() => kind.write(env)), () => RENAMES.swap(env));
        assert.ok(!r.second.err, r.second.err?.message);
        // (told a change of address was under way: nothing written, and the press made again, as told)
        if (r.first.err) {
          assert.ok(r.first.err.status === 503 && r.first.err.moving, `held at ${k} of ${n}: ${r.first.err.status} ${r.first.err.message}`);
          assert.deepEqual(await kind.where(env.DB), []);
          await quietly(() => kind.write(env));
        }
        const at = await slugOf(env.DB, P.email);
        assert.deepEqual(await kind.where(env.DB), [at], `held at ${k} of ${n}: at Pia’s address now`);
        const told = sent.filter((m) => kind.subject.test(m.subject));
        assert.equal(told.length, 1, `held at ${k} of ${n}: one notice`);
        assert.match(told[0].subject, /^Pia /, `held at ${k} of ${n}: the notice names Pia (${told[0].subject})`);
        assert.ok(told[0].text.includes(P.name) && !told[0].text.includes(Q.name), `held at ${k} of ${n}: ${told[0].text.split('\n')[0]}`);
      } finally { close(); }
    }
  });
}

// ─── 2: the email's buttons, in words on every path ───────────────────

/** The database as a fresh worker meets it (a new binding: the Advisory Board's table setup runs again), its k-th statement failing */
function failingAt(DB, k) {
  const state = { n: 0, hit: false };
  const gate = () => { state.n += 1; if (state.n === k) { state.hit = true; throw new Error('D1_ERROR: the database didn’t answer'); } };
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: async (c) => { gate(); return st.first(c); }, all: async () => { gate(); return st.all(); }, run: async () => { gate(); return st.run(); } });
  return { DB: { ...DB, prepare: (sql) => wrap(DB.prepare(sql)), batch: async (s) => { gate(); return DB.batch(s); } }, state };
}
const LATER = '<h1>We couldn’t take your answer just now</h1><p>Please try again in a few minutes.</p>';
for (const [how, go] of [['opening the link (GET)', open], ['pressing the button (POST)', (env) => press(env, TOKEN, 'My cousin <b>')]]) {
  test(`2: ${how} on a fresh worker, the database failing at each statement it makes, its table setup included: in words, with Try again`, async () => {
    const a = await fresh();
    const count = failingAt(a.env.DB, 0);
    const done = await quietly(() => go({ ...a.env, DB: count.DB }));
    a.close();
    assert.equal(done.status, 200);
    const n = count.state.n;
    assert.ok(n > 12, `the table setup is in it (${n} statements)`);
    for (let k = 1; k <= n; k++) {
      const { env, close } = await fresh();
      try {
        const f = failingAt(env.DB, k);
        const r = await quietly(() => go({ ...env, DB: f.DB }));
        assert.ok(f.state.hit);
        const saved = (await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_answers').first()).n;
        if (r.status === 200) {
          // (only once the answer is saved: the notice to whoever runs the group, which never fails the press)
          assert.ok(go !== open && saved === 1 && /<h1>Thank you<\/h1>/.test(r.text), `failing at ${k} of ${n}: ${r.status} ${words(r.text)}`);
          continue;
        }
        assert.equal(r.status, 503, `failing at ${k} of ${n}`);
        assert.equal(words(r.text), LATER, `failing at ${k} of ${n}`);
        assert.doesNotMatch(r.text, /D1_ERROR|didn’t answer|Error/);
        assert.equal(saved, 0, 'nothing saved');
        if (go === open) assert.ok(r.text.includes(`/api/advisory-action?t=${encodeURIComponent(TOKEN)}&amp;do=yes">Try again</a>`), 'Try again opens the question again');
        else assert.match(r.text, /<form method="post">[\s\S]*name="note" value="My cousin &lt;b&gt;"[\s\S]*<button type="submit">Try again<\/button>/, 'Try again makes the press again, what they typed kept');
      } finally { close(); }
    }
  });
}

test('2: a press the site’s limit on presses a minute stops is told in words on the page, what they typed kept, never JSON', async () => {
  const { onRequest } = await import('../functions/api/_middleware.js');
  const pressFrom = (ip) => onRequest({
    request: new Request('https://sunshineonaranneyday.com/api/advisory-action', { method: 'POST', body: form(TOKEN, { note: 'My cousin <b>' }), headers: { 'CF-Connecting-IP': ip } }),
    env: {}, data: {}, next: async () => new Response('the press', { status: 200 }),
  });
  const seen = [];
  for (let i = 0; i < 8; i++) seen.push(await pressFrom('198.51.100.222'));
  const stopped = seen.filter((r) => r.status !== 200);
  assert.ok(stopped.length > 0, 'some were stopped');
  for (const r of stopped) {
    assert.equal(r.status, 429);
    assert.match(r.headers.get('Content-Type'), /^text\/html/);
    assert.ok(Number(r.headers.get('Retry-After')) > 0);
    const text = await r.text();
    assert.equal(words(text), LATER);
    assert.match(text, /<form method="post">[\s\S]*name="note" value="My cousin &lt;b&gt;"[\s\S]*<button type="submit">Try again<\/button>/);
  }
});

// ─── 3: naming who runs the group in the moment her address changes ───────────────────

const BEA = { slug: 'bea-board', name: 'Bea Board', email: 'bea@example.org' };
const CAL = { slug: 'cal-board', name: 'Cal Board', email: 'cal@example.org' };
const ADMIN = 'jane@soardcharity.com';
const LEAD_MOVED = 'This board member’s web address on People changed just now, so nothing was saved. Reload and pick them again.';
async function boardWorld() {
  const w = await fresh();
  for (const p of [BEA, CAL]) {
    await w.env.DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(p.slug, p.name, 'board', JSON.stringify({ slug: p.slug, name: p.name, group: 'board', status: 'active', publishStatus: 'published', title: 'Board Member' })).run();
    await w.env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(p.slug, p.email).run();
  }
  return w;
}
const renameTo = async (env, from, to) => {
  const { rename } = await import('../functions/api/rename-content.js');
  const r = await rename(env, { collection: 'team', from, to }, BY, async () => Response.json({ success: true }));
  if (r.status !== 200) throw new Error(`rename ${from} → ${to}: ${r.status} ${r.body.error}`);
};
const BOARD_RENAMES = {
  plain: (env) => renameTo(env, BEA.slug, 'bea-new'),
  swap: async (env) => { await renameTo(env, BEA.slug, 'bea-temp'); await renameTo(env, CAL.slug, BEA.slug); await renameTo(env, 'bea-temp', CAL.slug); },
};
const nameLead = async (env, slug = BEA.slug) => {
  const { onRequestPost } = await import('../functions/api/advisory-admin.js');
  const res = await onRequestPost({ env, data: { userEmail: ADMIN }, request: new Request('https://x/api/advisory-admin', { method: 'POST', body: JSON.stringify({ action: 'save-settings', settings: { lead: slug } }) }) });
  return { status: res.status, body: await res.json() };
};
const leadNow = async (DB) => (await (await import('../functions/api/_advisory.js')).getSettings(DB)).lead;

for (const [ren, holds] of [['plain', ['write', 'rename']], ['swap', ['write', 'rename']]]) {
  test(`3: who runs the group named while her address changes (${ren === 'plain' ? 'a rename' : 'a swap of two board members’ addresses'}), each held at every statement: saved where a board member is now, or “changed just now”, never other words`, async () => {
    const a = await boardWorld();
    const nw = (await a.h.count('write', () => quietly(() => nameLead(a.env)))).n;
    a.close();
    const b = await boardWorld();
    const nr = (await b.h.count('rename', () => BOARD_RENAMES[ren](b.env))).n;
    b.close();
    let refused = 0;
    for (const op of holds) {
      for (let k = 1; k <= (op === 'write' ? nw : nr); k++) {
        const { h, env, close } = await boardWorld();
        try {
          const save = () => quietly(() => nameLead(env));
          const r = op === 'write' ? await h.heldAt('write', k, save, () => BOARD_RENAMES[ren](env)) : await h.heldAt('rename', k, () => BOARD_RENAMES[ren](env), save);
          const [w, rn] = op === 'write' ? [r.first, r.second] : [r.second, r.first];
          const how = `${op} held at ${k} of ${op === 'write' ? nw : nr}`;
          assert.ok(!rn.err, `${how}: the rename: ${rn.err?.message}`);
          assert.ok(w.ok, `${how}: ${w.err?.message}`);
          const lead = await leadNow(env.DB);
          if (w.ok.status === 200) {
            const ok = ren === 'plain' ? [await slugOf(env.DB, BEA.email)] : [await slugOf(env.DB, BEA.email), await slugOf(env.DB, CAL.email)];
            assert.ok(ok.includes(lead), `${how}: saved at ${lead}, a board member’s address now`);
          } else {
            refused += 1;
            assert.deepEqual([w.ok.status, w.ok.body.error], [409, LEAD_MOVED], `${how}: the words for what happened`);
            assert.equal(lead, 'mary-lead', `${how}: nothing saved`);
          }
          assert.deepEqual(await slugs(env.DB, "SELECT key AS slug FROM board_state WHERE key LIKE 'rename-finish:%'"), [], `${how}: nothing left to finish`);
        } finally { close(); }
      }
    }
    assert.ok(ren === 'swap' || refused > 0, 'some were in the moment her address changed');
  });
}

test('3: “Pick an active board member” only for someone who truly isn’t one now, and a page’s person keeps its own words', async () => {
  const { env, close } = await boardWorld();
  try {
    await env.DB.prepare("UPDATE team SET data = json_set(data, '$.status', 'alumni') WHERE slug = ?").bind(CAL.slug).run();
    for (const slug of [P.slug, CAL.slug, 'nobody-here', '']) {
      const r = await quietly(() => nameLead(env, slug));
      assert.deepEqual([r.status, r.body.error], [400, 'Pick an active board member'], slug || '(none)');
    }
    // Renamed, and nobody at the old address: her address changed. Then someone else is put there, who isn't a board
    // member: the address is theirs now, and they aren't one
    await renameTo(env, BEA.slug, 'bea-new');
    const moved = await quietly(() => nameLead(env, BEA.slug));
    assert.deepEqual([moved.status, moved.body.error], [409, LEAD_MOVED]);
    await env.DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(BEA.slug, 'Newer Person', 'advisory', JSON.stringify({ slug: BEA.slug, name: 'Newer Person', group: 'advisory', status: 'active' })).run();
    assert.deepEqual((await quietly(() => nameLead(env, BEA.slug))).body.error, 'Pick an active board member');
    const r = await quietly(() => nameLead(env, 'bea-new'));
    assert.equal(r.status, 200);
    assert.equal(await leadNow(env.DB), 'bea-new');
    // (a Zeffy page matched to an address nobody has: its own words)
    const money = await import('../functions/api/_advisory-money.js');
    const s = await (await import('../functions/api/_advisory.js')).getSettings(env.DB);
    await assert.rejects(money.matchPage(env, s, { campaignId: 'camp_x', slug: 'nobody-here' }), /isn’t on the Advisory Board at this address now/);
  } finally { close(); }
});

// ─── 4: a closed ask, opened and pressed ───────────────────

test('4: a closed ask, opening the button and pressing it say the same, as every other state an ask can be in', async () => {
  const both = async (env, t = TOKEN) => {
    const g = await open(env, t);
    const p = await quietly(() => press(env, t, 'typed'));
    assert.equal(words(g.text), words(p.text), 'GET and POST say the same');
    assert.equal(g.status, p.status, 'with the same status');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM advisory_answers').first()).n, 0, 'nothing answered');
    assert.doesNotMatch(g.text.replace(/<style[\s\S]*?<\/style>/, '') + p.text.replace(/<style[\s\S]*?<\/style>/, ''), /[—–]|advisor\b|advisors\b|didn’t go through/);
    return { status: g.status, words: words(g.text), page: p.text };
  };
  const CLOSED = '<h1>That ask has closed</h1><p>Thank you for looking. Your page always has what’s current.</p>';
  const NOBODY = '<h1>This link doesn’t work anymore</h1><p>If you’re on SOARD’s Advisory Board, you can answer on the Advisory Board page.</p>';
  const close = async (env) => env.DB.prepare('UPDATE advisory_asks SET closed_at = ? WHERE id = ?').bind(new Date().toISOString(), ASK).run();
  // Closed
  let w = await fresh();
  await close(w.env);
  let r = await both(w.env);
  assert.equal(r.status, 410);
  assert.equal(r.words, CLOSED);
  assert.match(r.page, /Open the page/);
  // Closed, and expired too: it has closed (never "You can still answer")
  await w.env.DB.prepare("UPDATE advisory_links SET expires = '2020-01-01T00:00:00.000Z' WHERE hash = ?").bind(await hashOf(TOKEN)).run();
  assert.equal((await both(w.env)).words, CLOSED);
  w.close();
  // Closed while a change of her address is still moving her records: it has closed (never "try again in a few minutes")
  w = await fresh();
  await close(w.env);
  await w.env.DB.prepare("INSERT INTO board_state (key, data, updated_at) VALUES ('rename-finish:pia-swap', ?, ?)").bind(JSON.stringify({ from: P.slug, to: 'pia-new', at: new Date().toISOString(), by: BY }), new Date().toISOString()).run();
  await w.env.DB.prepare("UPDATE team SET slug = 'pia-new', data = json_set(data, '$.slug', 'pia-new') WHERE slug = ?").bind(P.slug).run();
  assert.equal((await both(w.env)).words, CLOSED);
  w.close();
  // Closed, and she has left the Advisory Board: thanked, never sent to a page she can't open
  w = await fresh();
  await close(w.env);
  await w.env.DB.prepare("UPDATE team SET data = json_set(data, '$.status', 'alumni') WHERE slug = ?").bind(P.slug).run();
  assert.match((await both(w.env)).words, /^<h1>Thank you for your time on SOARD’s Advisory Board<\/h1>/);
  w.close();
  // Its ask gone, or never out: the link doesn't work anymore, opened or pressed
  for (const sql of ['DELETE FROM advisory_asks WHERE id = ?', 'UPDATE advisory_asks SET sent_at = NULL WHERE id = ?']) {
    w = await fresh();
    await w.env.DB.prepare(sql).bind(ASK).run();
    r = await both(w.env);
    assert.deepEqual([r.status, r.words], [410, NOBODY], sql);
    w.close();
  }
  // (and open, in date: the question, then the thank-you)
  w = await fresh();
  assert.match((await open(w.env)).text, /<h1>Host a dinner<\/h1><p>Can you\?<\/p>/);
  assert.equal((await quietly(() => press(w.env))).status, 200);
  w.close();
});
