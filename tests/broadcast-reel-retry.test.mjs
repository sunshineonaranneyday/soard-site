/**
 * Reveals → Now → Instagram Reel → "Choose the cut yourself": the reelRetry admin action
 * (Peter, Nov 21 2026: Max's Reel posted by the site as the 7:24 to 7:43 cut he saw).
 * Run: node --test tests/broadcast-reel-retry.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 599 });
const LIVE_HUB = { idFromName: () => 'main', get: () => ({ fetch: async () => Response.json({ ok: true, changed: true, clients: 0 }) }) };

let env, b;
// Max's replay as production held it on Nov 21 2026: Reels were off when it ended, so no Reel
const MAX_REPLAY = {
  phase: 'replay', broadcastId: 'live-1795122303951', kidSlug: 'max', kidName: 'Max', title: "Max's room reveal", source: 'stream',
  liveAt: '2026-11-20T21:00:31.926Z', endedAt: '2026-11-20T21:12:37.934Z', replayUid: '36aff9b744e9b92770833f27e0eeede7',
  replayUntil: new Date(Date.now() + 48 * 3600e3).toISOString(), replayOut: true, overSaid: true, reel: null, revealAtSeconds: null,
};

before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  env = { DB, LIVE_HUB, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok' };
  b = await import('../functions/api/_broadcast.js');
  await b.ensureSchema(DB);
});
after(() => { globalThis.fetch = realFetch; });

const reset = async () => b.writeState(env.DB, { ...(await b.readState(env.DB)), ...MAX_REPLAY });

test('a chosen cut starts a Reel with that window, cover and caption, and the audit log names the cut', async () => {
  await reset();
  const r = await b.adminAction(env, 'reelRetry', { start: '7:24', end: '7:43', cover: '7:34', caption: '  Max rolled into his new bathroom.  ' }, 'peter@test');
  assert.equal(r.success, true, r.error);
  const st = await b.readState(env.DB);
  assert.equal(st.reel.stage, 'pending');
  assert.equal(st.reel.sourceUid, '36aff9b744e9b92770833f27e0eeede7');
  assert.deepEqual(st.reel.cut, { start: 444, end: 463, coverSeconds: 454 });
  assert.equal(st.reel.caption, 'Max rolled into his new bathroom.');
  const row = await env.DB.prepare("SELECT entity_name, changes, user_email FROM audit_log WHERE entity_type = 'instagram-reel' ORDER BY id DESC LIMIT 1").first();
  assert.equal(row.entity_name, 'Reel cut 7:24 to 7:43');
  assert.equal(row.user_email, 'peter@test');
  assert.match(row.changes, /Max rolled/);
  const saved = await env.DB.prepare('SELECT data FROM broadcasts WHERE id = ?').bind(MAX_REPLAY.broadcastId).first();
  assert.deepEqual(JSON.parse(saved.data).reel.cut, { start: 444, end: 463, coverSeconds: 454 }, 'the History row carries it too');
});

test('seconds work as well as minutes:seconds; the cover is optional', async () => {
  await reset();
  const r = await b.adminAction(env, 'reelRetry', { start: 444, end: '463' }, 'peter@test');
  assert.equal(r.success, true, r.error);
  const st = await b.readState(env.DB);
  assert.deepEqual(st.reel.cut, { start: 444, end: 463, coverSeconds: null });
  assert.equal(st.reel.caption, null);
});

test('plain Retry (no cut) finds the reveal by itself, as before', async () => {
  await reset();
  const r = await b.adminAction(env, 'reelRetry', {}, 'peter@test');
  assert.equal(r.success, true, r.error);
  const st = await b.readState(env.DB);
  assert.equal(st.reel.cut, null);
  assert.equal(st.reel.overrideSeconds, null);
});

test('bad cuts are refused in plain words and leave the state alone', async () => {
  await reset();
  for (const [body, re] of [
    [{ start: '7:24' }, /start and the end/],
    [{ start: '7:24', end: 'later' }, /start and the end/],
    [{ start: '7:43', end: '7:24' }, /at least 3 seconds after/],
    [{ start: '7:24', end: '7:25' }, /at least 3 seconds after/],
    [{ start: '0:00', end: '15:10' }, /at most 14:55/],
    [{ start: '7:24', end: '7:43', cover: '8:00' }, /cover time/],
    [{ start: '7:24', end: '7:43', caption: 42 }, /caption/],
  ]) {
    const r = await b.adminAction(env, 'reelRetry', body, 'peter@test');
    assert.equal(r.success, false, JSON.stringify(body));
    assert.match(r.error, re, JSON.stringify(body));
  }
  assert.equal((await b.readState(env.DB)).reel, null);
});
