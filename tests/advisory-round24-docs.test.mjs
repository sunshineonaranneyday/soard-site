/**
 * Advisory Board QA round 24, a follow-up to decided 1 (a read that fails is a read failure everywhere): the Advisory
 * Board's papers (listDocs). A read of a paper's files that didn't answer showed every paper with no files, on the
 * members' page and on Run it; now it, and a read of the papers themselves, is said as that: a 503 in words ("The
 * Advisory Board's papers couldn't load just now"), as every read the pages rest on is (Board QA round 11). A database
 * with no table of files yet has none.
 * Made-up people only (the repo is public); nothing leaves this machine.
 * Run: node --test tests/advisory-round24-docs.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import * as A from '../functions/api/_advisory.js';
import { writeState } from '../functions/api/_board-roles.js';

const WORDS = 'The Advisory Board’s papers couldn’t load just now. Please try again in a moment.';
const D1_DOWN = () => new Error('D1_ERROR: the database didn’t answer');
/** The database with every read matching `re` failing */
const failing = (DB, re) => {
  const wrap = (st) => ({ ...st, bind: (...p) => wrap(st.bind(...p)), first: (c) => (re.test(st._sql) ? Promise.reject(D1_DOWN()) : st.first(c)), all: () => (re.test(st._sql) ? Promise.reject(D1_DOWN()) : st.all()), run: () => st.run() });
  return { ...DB, prepare: (sql) => wrap(DB.prepare(sql)) };
};
const quietly = async (fn) => { const q = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = q; } };

async function world({ files = true } = {}) {
  const DB = await createD1();
  await DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await DB.exec('CREATE TABLE kids (slug TEXT PRIMARY KEY, name TEXT, year INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  const person = async (slug, d, email) => {
    await DB.prepare('INSERT INTO team (slug, name, "group", order_num, data) VALUES (?, ?, ?, 0, ?)').bind(slug, d.name, d.group, JSON.stringify({ status: 'active', ...d })).run();
    await DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind(slug, email).run();
  };
  await person('ivy-member', { name: 'Ivy Member', group: 'advisory' }, 'ivy.m@example.org');
  await person('jane-founder', { name: 'Jane Founder', group: 'team', role: 'founder' }, 'jane.founder@soardcharity.com');
  await writeState(DB, 'settings', { admins: ['jane.founder@soardcharity.com'] });
  await A.ensureAdvisory(DB);
  if (files) await (await import('../functions/api/_board.js')).ensureSchema(DB);
  const doc = await A.saveDoc(DB, { kind: 'pitch', title: 'Our 30-second pitch', body: 'Kids, rooms, joy.' }, { by: 'x' });
  if (files) await DB.prepare("INSERT INTO board_files (id, owner_type, owner_id, r2_key, name, type, size, kind, staff_only, at, by) VALUES ('f_pitchfile1', 'advisory-doc', ?, 'k', 'pitch.pdf', 'application/pdf', 10, 'other', 0, ?, 'x')").bind(doc.id, new Date().toISOString()).run();
  return { DB, doc };
}

test('the papers: a read of their files that fails is said as that (503, `unread`, in words), never a paper with no files', async () => {
  const { DB, doc } = await world();
  assert.deepEqual((await A.listDocs(DB)).find((d) => d.id === doc.id).files.map((f) => f.id), ['f_pitchfile1'], 'its file, as read');
  for (const [what, re] of [['their files', /FROM board_files/], ['the papers', /FROM advisory_docs/]]) {
    const e = await quietly(() => A.listDocs(failing(DB, re)).then(() => null, (x) => x));
    assert.ok(e, `${what}: never answered as if read`);
    assert.deepEqual([e.status, e.unread, e.message], [503, true, WORDS], what);
  }
  // (a database with no table of files yet: the papers, with none)
  const bare = await world({ files: false });
  assert.deepEqual((await A.listDocs(bare.DB)).find((d) => d.id === bare.doc.id).files, []);
});

test('the members\' page and Run it: the papers\' files not read is said in words, 503, never the page with papers and no files', async () => {
  const { DB } = await world();
  const portal = await import('../functions/api/advisory-portal.js');
  const admin = await import('../functions/api/advisory-admin.js');
  const broken = failing(DB, /FROM board_files WHERE owner_type = 'advisory-doc'/);
  const ctx = (path, data) => ({ env: { DB: broken }, request: new Request(`https://site.test${path}`), data, waitUntil: () => {} });
  for (const [label, res] of [
    ['the members’ page', await quietly(() => portal.onRequestGet(ctx('/api/advisory-portal', { advisor: { slug: 'ivy-member', name: 'Ivy Member', email: 'ivy.m@example.org' } })))],
    ['Run it', await quietly(() => admin.onRequestGet(ctx('/api/advisory-admin', { userEmail: 'jane.founder@soardcharity.com' })))],
  ]) {
    const j = await res.json();
    assert.deepEqual([res.status, j.error], [503, WORDS], `${label}: ${JSON.stringify(j).slice(0, 160)}`);
  }
});
