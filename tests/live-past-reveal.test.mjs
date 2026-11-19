/**
 * A child's own reveal on their live page, for good (functions/live/_past-reveal.js; Peter, Nov 18 2026: "can it be
 * there forever as dylans?"): which reveal a child's page falls back to, and the APIs reading it by its id.
 * Run: node --test tests/live-past-reveal.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = (entry) => import(`data:text/javascript,${encodeURIComponent(buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', packages: 'external' }).outputFiles[0].text)}`);
const { ownCurrent, pickPastRow, pastStateOf, pastReveal, revealRow, BROADCAST_ID_RE } = await load('functions/live/_past-reveal.js');
const { watchParty } = await load('functions/live/_watch-party.js');

const row = (extra = {}) => ({
  id: 'live-1795000000000', kid_slug: 'dylan-2026', kid_name: 'Dylan', title: "Dylan's room reveal", message: null, image: null,
  scheduled_at: '2026-11-18T21:00:00.000Z', live_at: '2026-11-18T21:01:00.000Z', ended_at: '2026-11-18T21:30:00.000Z',
  replay_uid: 'abc123', source: 'stream', data: JSON.stringify({ test: false, reel: null, revealAtSeconds: 742 }), ...extra,
});
const config = { customerCode: 'cust1', orientation: 'portrait' };

// A D1 stand-in: the rows a query would return, and what was asked
function fakeDB(rows) {
  const asked = [];
  return {
    asked,
    prepare(sql) {
      return {
        bind(...args) {
          asked.push({ sql, args });
          const hits = /WHERE id = \?/.test(sql) ? rows.filter((r) => r.id === args[0]) : rows.filter((r) => r.kid_slug === args[0] && r.replay_uid && r.ended_at);
          return { all: async () => ({ results: hits }), first: async () => hits[0] || null };
        },
      };
    },
  };
}

test('the current broadcast is the child\'s own while it is on; anything else falls back to their past reveal', () => {
  assert.equal(ownCurrent({ kidSlug: 'dylan-2026', phase: 'replay' }, 'dylan-2026'), true, 'their replay window');
  assert.equal(ownCurrent({ kidSlug: 'dylan-2026', phase: 'live' }, 'dylan-2026'), true);
  assert.equal(ownCurrent({ kidSlug: 'dylan-2026', phase: 'scheduled' }, 'dylan-2026'), true);
  assert.equal(ownCurrent({ kidSlug: 'max', phase: 'scheduled' }, 'dylan-2026'), false, 'the next child\'s reveal');
  assert.equal(ownCurrent({ kidSlug: null, phase: 'idle' }, 'dylan-2026'), false, 'nothing on');
  assert.equal(ownCurrent({ kidSlug: 'dylan-2026', phase: 'idle' }, 'dylan-2026'), false);
  assert.equal(ownCurrent(null, 'dylan-2026'), false);
});

test('only a real reveal from our own stream with a recording counts: never a test, a Facebook-only one, or one still on', () => {
  assert.equal(pickPastRow([row()]).id, 'live-1795000000000');
  assert.equal(pickPastRow([row({ data: JSON.stringify({ test: true }) })]), null, 'a test');
  assert.equal(pickPastRow([row({ source: 'manual' })]), null, 'Facebook only');
  assert.equal(pickPastRow([row({ replay_uid: null })]), null, 'no recording');
  assert.equal(pickPastRow([row({ ended_at: null })]), null, 'not ended');
  assert.equal(pickPastRow([row({ data: '{not json' })]).id, 'live-1795000000000', 'unreadable extras: still a reveal');
  // Newest first, as the query orders them: the first real one
  assert.equal(pickPastRow([row({ id: 'live-2', data: JSON.stringify({ test: true }) }), row({ id: 'live-1' })]).id, 'live-1');
});

test('a past reveal is its replay, for good: the page script\'s state, the Theater from the first paint', async () => {
  const past = await pastReveal(fakeDB([row()]), 'dylan-2026', config);
  assert.equal(past.pub.past, true);
  assert.equal(past.pub.phase, 'replay');
  assert.equal(past.pub.id, 'live-1795000000000');
  assert.equal(past.pub.kidSlug, 'dylan-2026');
  assert.equal(past.pub.replayUntil, null, 'no window');
  assert.deepEqual(past.pub.player, { kind: 'replay', uid: 'abc123', customerCode: 'cust1' });
  assert.equal(past.state.revealAtSeconds, 742);
  const party = watchParty(past.pub, { pageKid: 'dylan-2026' });
  assert.equal(party.mode, 'replay');
  assert.equal(party.ended, false, 'its replay, not "That\'s the reveal!"');
  assert.equal(await pastReveal(fakeDB([]), 'dylan-2026', config), null, 'a child with no reveal yet: the page as before');
  assert.equal(await pastReveal(fakeDB([row()]), '', config), null, '/live/ itself follows the current reveal');
});

test('?b= names only a real reveal by its id: never a test, never something that isn\'t an id', async () => {
  const db = fakeDB([row(), row({ id: 'live-1795000000001', data: JSON.stringify({ test: true }) })]);
  assert.equal((await revealRow(db, 'live-1795000000000')).replay_uid, 'abc123');
  assert.equal(await revealRow(db, 'live-1795000000001'), null, 'a test');
  assert.equal(await revealRow(db, 'live-9'), null, 'none');
  for (const bad of ["live-1' OR 1=1", 'abc', '', null, 'live-12345678901234567']) assert.equal(await revealRow(db, bad), null, String(bad));
  assert.ok(BROADCAST_ID_RE.test('live-1795000000000'));
  assert.equal(pastStateOf(row()).phase, 'replay');
});

test('/api/live-replay?b= answers for that past reveal\'s replay, and nothing for a test', async () => {
  const { onRequestGet } = await load('functions/api/live-replay.js');
  const db = fakeDB([row(), row({ id: 'live-1795000000001', replay_uid: 'testvid', data: JSON.stringify({ test: true }) })]);
  // (the replay-meta row: site_config, no Stream configured, so nothing is asked of Stream)
  const DB = {
    prepare(sql) {
      if (/site_config/.test(sql)) return { bind: () => ({ first: async () => ({ data: JSON.stringify({ captions: 'ready', moment: { seconds: 742, method: 'captions+ai', confidence: 0.9 }, detectedAt: 'x' }) }), run: async () => ({}) }) };
      return db.prepare(sql);
    },
  };
  const get = async (q) => (await onRequestGet({ env: { DB }, request: new Request(`https://x.test/api/live-replay${q}`), waitUntil() {} })).json();
  const a = await get('?b=live-1795000000000');
  assert.equal(a.uid, 'abc123');
  assert.equal(a.revealAt, 742);
  assert.equal(a.captions, true);
  const t = await get('?b=live-1795000000001');
  assert.equal(t.uid, null, 'a test\'s recording is never named');
  const bad = await get('?b=nope');
  assert.equal(bad.uid, null);
});

test('/api/live-messages?b= lists that past reveal\'s shown messages, closed; anything not an id reads the current reveal', async () => {
  const { createD1 } = await import('./lib/d1-shim.mjs');
  const endpoint = await load('functions/api/live-messages.js');
  const m = await load('functions/api/_live-messages.js');
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  await m.ensureMessagesSchema(DB);
  await DB.prepare(`INSERT INTO broadcast_messages (id, broadcast_id, name, body, status, created_at) VALUES ('m1', 'live-1795000000000', 'Ana', 'So proud of you', 'shown', '2026-11-18T21:10:00.000Z')`).run();
  await DB.prepare(`INSERT INTO broadcast_messages (id, broadcast_id, name, body, status, created_at) VALUES ('m2', 'live-1795000000000', 'Bo', 'held one', 'held', '2026-11-18T21:11:00.000Z')`).run();
  const get = async (q) => (await endpoint.onRequestGet({ env: { DB }, request: new Request(`https://x.test/api/live-messages${q}`) })).json();
  const past = await get('?b=live-1795000000000');
  assert.equal(past.broadcastId, 'live-1795000000000');
  assert.equal(past.open, false, 'read-only');
  assert.deepEqual(past.messages.map((x) => x.name), ['Ana'], 'shown ones only');
  const odd = await get("?b=live-1'--");
  assert.notEqual(odd.broadcastId, "live-1'--");
});
