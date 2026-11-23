/**
 * Board QA round 10 / Advisory Board round 22 merged (Nov 23 2026): a write about a member reads who they are first
 * (./functions/api/_member-write.js memberNow): naming who runs the group, an answer, an introduction. That read failing
 * was a raw database error (staff saw "That didn't go through", a member the same), where every other read of People
 * says it couldn't check People (round 10's rule, ./functions/api/_board-roles.js). Now it does here too, 503, nothing
 * written. Made-up people only (the repo is public). Run: node --test tests/advisory-round22-reads.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { saveSettings, getSettings } from '../functions/api/_advisory.js';
import { memberNow } from '../functions/api/_member-write.js';
import { stateReady, PEOPLE_DOWN } from '../functions/api/_board-roles.js';

async function world() {
  const real = await createD1();
  await real.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await real.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await stateReady(real);
  const person = (slug, name, group, email) => Promise.all([
    real.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, name, group, JSON.stringify({ name, group, status: 'active' })).run(),
    real.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run(),
  ]);
  await person('pia-board', 'Pia Board', 'board', 'pia.board@example.com');
  await person('ada-example', 'Ada Example', 'advisory', 'ada.adv@example.org');
  let fail = null;
  const prepare = real.prepare.bind(real);
  // (the read of who a member is: by their email, or by their address)
  const DB = new Proxy(real, { get: (t, k) => (k === 'prepare' ? (sql) => {
    const st = prepare(sql);
    if (!fail || !fail.test(sql)) return st;
    const no = async () => { throw new Error('D1_ERROR: Network connection lost.'); };
    const wrap = (s) => new Proxy(s, { get: (x, m) => (m === 'all' || m === 'first' || m === 'run' ? no : m === 'bind' ? (...a) => wrap(x.bind(...a)) : typeof x[m] === 'function' ? x[m].bind(x) : x[m]) });
    return wrap(st);
  } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  return { DB, failOn: (re) => { fail = re; }, real };
}

test('naming who runs the group with the read of People failing: 503 in the People words, nothing saved (never a raw error)', async () => {
  const { DB, failOn } = await world();
  const before = await getSettings(DB);
  // (who runs the group is read by address alone, in one statement)
  for (const re of [/FROM team t WHERE t\.slug = \?/]) {
    failOn(re);
    const err = await saveSettings(DB, { lead: 'pia-board' }, { naming: 'pia-board', as: 'lead' }).then(() => null, (e) => e);
    failOn(null);
    assert.ok(err, `refused (${re})`);
    assert.deepEqual([err.status, err.message, err.unread], [503, PEOPLE_DOWN, true], `${re}: ${err.message}`);
    assert.equal((await getSettings(DB)).lead, before.lead, 'nothing saved');
  }
  // …and once People answers, it saves
  await saveSettings(DB, { lead: 'pia-board' }, { naming: 'pia-board', as: 'lead' });
  assert.equal((await getSettings(DB)).lead, 'pia-board');
});

test('a member write reading who they are, with that read failing: 503 in the People words, never "not on the Advisory Board"', async () => {
  const { DB, failOn } = await world();
  // (by their email; and by their address alone, which looks up their email first)
  for (const [re, who] of [[/FROM reveal_board_emails e JOIN team t/, { slug: 'ada-example', email: 'ada.adv@example.org' }], [/FROM reveal_board_emails WHERE slug = \?/, 'ada-example']]) {
    failOn(re);
    const err = await memberNow(DB, who).then(() => null, (e) => e);
    failOn(null);
    assert.deepEqual([err?.status, err?.message, err?.unread], [503, PEOPLE_DOWN, true], String(re));
  }
  assert.equal((await memberNow(DB, { slug: 'ada-example', email: 'ada.adv@example.org' }))?.slug, 'ada-example', 'read once People answers');
});
