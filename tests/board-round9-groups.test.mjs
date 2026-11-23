/**
 * Board QA round 9 (Nov 22 2026): who belongs in board@ and advisory@ was read as People, then the emails, in two
 * statements. A People rename between them (it moves a member's record and their email together) left the member with
 * no email in what was read, so the next sync took them off the group; with the Advisory Board's emails off they were
 * never put back. People and the emails are now read in one statement (./functions/api/_board-roles.js peopleWithEmails).
 * Made-up people only (the repo is public). Run: node --test tests/board-round9-groups.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { groupWanted, advisoryGroupWanted } from '../functions/api/_board-group.js';
import { stateReady, writeState } from '../functions/api/_board-roles.js';

let DB;
let renameDuringRead = null;
const person = (slug, name, group, email) => Promise.all([
  DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, name, group, JSON.stringify({ name, group, status: 'active' })).run(),
  DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run(),
]);

beforeEach(async () => {
  const real = await createD1();
  await real.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await real.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await stateReady(real);
  renameDuringRead = null;
  // (a People rename landing just before the emails are read, after People was: as ./rename-content.js writes it, the
  // record and its email at the new address in one batch. Read in one statement, there's no "between")
  const prepare = real.prepare.bind(real);
  const renameNow = async () => {
    const r = renameDuringRead;
    if (!r) return;
    renameDuringRead = null;
    await real.batch([real.prepare('UPDATE team SET slug = ? WHERE slug = ?').bind(r.to, r.from), real.prepare('UPDATE reveal_board_emails SET slug = ? WHERE slug = ?').bind(r.to, r.from)]);
  };
  DB = new Proxy(real, { get: (t, k) => (k === 'prepare' ? (sql) => {
    const st = prepare(sql);
    if (!/^SELECT\b[\s\S]*\breveal_board_emails\b/.test(sql)) return st;
    const wrap = (s) => new Proxy(s, { get: (x, m) => (m === 'all' || m === 'first' ? (...a) => renameNow().then(() => x[m](...a)) : m === 'bind' ? (...a) => wrap(x.bind(...a)) : typeof x[m] === 'function' ? x[m].bind(x) : x[m]) });
    return wrap(st);
  } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  await writeState(DB, 'settings', { admins: ['jane@soardcharity.com'] });
  await person('alex-rivera', 'Alex Rivera', 'board', 'alex.board@example.com');
  await person('ada-example', 'Ada Example', 'advisory', 'ada.adv@example.org');
});

test('board@: a member renamed between the reads is still in the group, at their email', async () => {
  renameDuringRead = { from: 'alex-rivera', to: 'alex-rivera-ames' };
  const w = await groupWanted(DB);
  assert.ok(w.members.some((m) => m.email === 'alex.board@example.com'), JSON.stringify(w));
  assert.deepEqual(w.missing, [], 'nobody read as having no email');
});

test('advisory@: an Advisory Board member renamed between the reads is still in the group, at their email', async () => {
  renameDuringRead = { from: 'ada-example', to: 'ada-example-rowe' };
  const w = await advisoryGroupWanted(DB);
  assert.ok(w.members.some((m) => m.email === 'ada.adv@example.org'), JSON.stringify(w));
  assert.deepEqual(w.missing, [], 'nobody read as having no email');
});

test('with no rename, both groups are as before (control)', async () => {
  assert.ok((await groupWanted(DB)).members.some((m) => m.email === 'alex.board@example.com'));
  assert.ok((await advisoryGroupWanted(DB)).members.some((m) => m.email === 'ada.adv@example.org'));
});
