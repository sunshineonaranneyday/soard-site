/**
 * Board QA round 4 (Nov 21 2026), the board page as members see it, the server's part: reading Makeovers (the board,
 * the list, the map, a family's page) keeps a visit going, as reading any other page does, and Board → Members says
 * where they were. Made-up people only (the repo is public).
 * Run: node --test tests/board-round4-member.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { portalData, ensureSchema } from '../functions/api/_board.js';
import { noteEvents, pageOk } from '../functions/api/_board-activity.js';
import { pageOf } from '../public/admin/board/activity.js';
import { said } from '../public/admin/board-activity.js';

const PEOPLE = [
  ['jane-doe', { name: 'Jane Doe', group: 'team', title: 'Co-Founder/President' }],
  ['alex-rivera', { name: 'Alex Rivera', group: 'board', title: 'Board Chair' }],
];
const ALEX = { slug: 'alex-rivera', name: 'Alex Rivera', email: 'alex.board@example.com', title: 'Board Chair' };
const MIN = 60_000;
const GAP_MIN = 30;

let env;
beforeEach(async () => {
  env = { DB: await createD1() };
  await env.DB.exec('CREATE TABLE team (slug TEXT PRIMARY KEY, name TEXT, "group" TEXT, order_num INTEGER, data TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE reveal_board_emails (slug TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at TEXT)');
  await env.DB.exec('CREATE TABLE site_config (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  for (const [slug, d] of PEOPLE) await env.DB.prepare('INSERT INTO team (slug, name, "group", data) VALUES (?, ?, ?, ?)').bind(slug, d.name, d.group, JSON.stringify(d)).run();
  await env.DB.prepare('INSERT INTO reveal_board_emails (slug, email) VALUES (?, ?)').bind('alex-rivera', ALEX.email).run();
  await ensureSchema(env.DB);
});

const request = () => new Request('https://sunshineonaranneyday.com/api/board-portal', { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh)' } });
const pageAt = async (t) => (await portalData(env, { member: ALEX, now: t })).me.lastSeen;
const reportAt = (t, look, from, ref) => noteEvents(env, ALEX, request(), { events: [{ id: look, kind: 'view', ref, at: from, end: t, secs: Math.round((t - from) / 1000), touched: Math.round((t - from) / 1000) }], touch: false, now: t }, { now: t });

test('round 4: every Makeovers view is one page the tracker reports, and the server keeps it', () => {
  for (const hash of ['#/families', '#/families/list', '#/families/map', '#/families/map/acc_123', '#/families/acc_123', '#/families/list?x=1']) {
    assert.equal(pageOf(hash), 'families', hash);
  }
  assert.equal(pageOk('families'), true);
  assert.equal(pageOk('families/acc_123'), false, 'only the page itself, as the tracker names it');
});

test('round 4: what’s new stays new while a member reads Makeovers past the gap', async () => {
  const threeDays = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await env.DB.prepare('INSERT INTO board_seen (slug, at) VALUES (?, ?)').bind(ALEX.slug, threeDays).run();
  const t0 = Date.now() - 2 * 3600_000;
  assert.equal(await pageAt(t0), threeDays);
  for (let k = 1; k <= 34; k++) assert.equal((await reportAt(t0 + k * MIN, 'lookfamily1', t0, 'families')).kept, 1, `the report at ${k} minutes is kept`);
  assert.equal(await pageAt(t0 + 35 * MIN), threeDays, 'back on Home after 34 minutes on Makeovers: still new since three days ago');
  assert.equal(await pageAt(t0 + (35 + GAP_MIN + 1) * MIN), new Date(t0).toISOString(), 'and the gap after that still ends the visit');
});

test('round 4: Board → Members says they looked at Makeovers', () => {
  const L = { meetings: new Map(), files: new Map(), items: new Map(), actions: new Map(), motions: new Map(), docs: new Map() };
  assert.equal(said({ kind: 'view', ref: 'families', secs: 600 }, L).text, 'Looked at Makeovers');
});
