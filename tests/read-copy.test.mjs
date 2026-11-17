/**
 * Reads from the database's nearest copy (functions/api/_read-copy.js)
 * Run: node --test tests/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearDB, nearEnv } from '../functions/api/_read-copy.js';
import { shownMessages } from '../functions/api/_live-messages.js';

test('a database with sessions reads through one that may start at any copy', () => {
  const asked = [];
  const session = { prepare: () => ({}) };
  const DB = { withSession: (c) => { asked.push(c); return session; } };
  assert.equal(nearDB(DB), session);
  assert.deepEqual(asked, ['first-unconstrained']);
  const env = { DB, FILES: 'files' };
  const near = nearEnv(env);
  assert.equal(near.DB, session);
  assert.equal(near.FILES, 'files', 'the rest of the env rides along');
  assert.equal(env.DB, DB, 'the env itself is left alone (writes stay on the main copy)');
});

test('without sessions (tests, local, no binding) it is the database as it was', () => {
  const DB = { prepare: () => ({}) };
  assert.equal(nearDB(DB), DB);
  const env = { DB };
  assert.equal(nearEnv(env), env);
  assert.equal(nearDB(null), null);
  assert.deepEqual(nearEnv({}), {});
  const throws = { withSession: () => { throw new Error('beta off'); } };
  assert.equal(nearDB(throws), throws, 'a session that cannot be had falls back to the database');
});

test('shownMessages is the read alone: oldest first, nothing asked for without a reveal', async () => {
  const seen = [];
  const DB = {
    prepare: (sql) => ({
      bind: (...args) => ({
        all: async () => { seen.push({ sql, args }); return { results: [{ id: 'b', name: 'Bo', body: 'Second', created_at: '2026-11-16T20:01:00Z' }, { id: 'a', name: 'Al', body: 'First', created_at: '2026-11-16T20:00:00Z' }] }; },
      }),
    }),
  };
  const list = await shownMessages(DB, 'b1');
  assert.deepEqual(list.map((m) => m.id), ['a', 'b']);
  assert.equal(seen.length, 1, 'one read, no schema and no tidying');
  assert.match(seen[0].sql, /^SELECT/);
  assert.deepEqual(seen[0].args, ['b1', 100]);
  assert.deepEqual(await shownMessages(DB, null), []);
  assert.equal(seen.length, 1);
});
