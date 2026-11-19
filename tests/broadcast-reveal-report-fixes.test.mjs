/**
 * Fixes from Dylan's reveal report (Nov 19 2026, Peter: "fix 2 through 7"): staff hear before test mode turns itself
 * off and when it has; a mic check only passes in the range the crew aims for; and the site notices when Stream's
 * notifications stop reaching it. (The early hold on the sign-ups' "we're live", the list email after one minute and
 * the Y answer not waiting 15 minutes are in kit-live.test.mjs and broadcast-over-text.test.mjs.)
 * Run: node --test tests/broadcast-reveal-report-fixes.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';

const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const travel = (ms) => { offset += ms; };
const H = 3600e3, M = 60e3;

const posts = []; // { url, body }
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  posts.push({ url, body: typeof init.body === 'string' ? init.body : String(init.body || '') });
  if (url.startsWith('https://api.twilio.com/')) return new Response(JSON.stringify({ sid: 'SM1' }), { status: 201, headers: { 'content-type': 'application/json' } });
  return new Response('ok', { status: 200 });
};
const slackSays = (re) => posts.filter((p) => p.url === 'https://hook.test/slack' && re.test(p.body)).length;

let env, b, monitor, preflight, config;
before(async () => {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  env = { DB, SLACK_WEBHOOK_URL: 'https://hook.test/slack' };
  b = await import('../functions/api/_broadcast.js');
  monitor = await import('../functions/api/_broadcast-monitor.js');
  preflight = await import('../functions/api/_broadcast-preflight.js');
  await b.ensureSchema(DB);
  config = await b.readConfig(DB);
});
after(() => { Date.now = realNow; globalThis.fetch = realFetch; });

// ─── 2. Test mode turning itself off ───────────────────────────────────

test('test mode: staff hear 10 minutes before it turns itself off, and again when it has, each once', async () => {
  const state = b.defaultState();
  let q = { ...b.defaultQuiet(), until: new Date(Date.now() + 2 * H).toISOString(), by: 'peter@test' };
  const work = [];
  q = await b.warnQuietEnding(env, config, q, state, work);
  assert.equal(slackSays(/Test mode/), 0, 'nothing with two hours left');
  travel(2 * H - 9 * M);
  q = await b.warnQuietEnding(env, config, q, state, work);
  assert.equal(slackSays(/Test mode ends in 9 minutes/), 1, 'warned before it runs out');
  assert.ok(work.includes('test-ending-warned'));
  q = await b.warnQuietEnding(env, config, q, state, work);
  assert.equal(slackSays(/Test mode ends in/), 1, 'once');
  travel(10 * M);
  q = await b.warnQuietEnding(env, config, q, state, work);
  assert.equal(slackSays(/Test mode is off/), 1, 'told when it has');
  assert.equal(slackSays(/goes out for real/), 2, 'both say what that means');
  q = await b.warnQuietEnding(env, config, q, state, work);
  assert.equal(slackSays(/Test mode is off/), 1, 'once (a claim: whichever tick or isolate gets there first)');
});

test('test mode: turned off by hand says nothing; a switch that ran out long ago is old news (a deploy never brings it up)', async () => {
  const n = posts.length;
  const state = b.defaultState();
  await b.warnQuietEnding(env, config, { ...b.defaultQuiet(), until: null }, state, []);
  await b.warnQuietEnding(env, config, { ...b.defaultQuiet(), until: new Date(Date.now() - 3 * H).toISOString() }, state, []);
  assert.equal(posts.length, n);
});

test('test mode: a test still streaming when the switch runs out is told it stays a test until the phone stops', async () => {
  const state = { ...b.defaultState(), phase: 'live', quiet: true, source: 'stream' };
  const q = { ...b.defaultQuiet(), until: new Date(Date.now() + 5 * M).toISOString() };
  await b.warnQuietEnding(env, config, q, state, []);
  assert.equal(slackSays(/stays a test until the phone stops/), 1);
});

test('test mode ended by the planned reveal\'s own window: the phone streaming then is the reveal, and the words say so', async () => {
  const kidAt = Date.now() + 40 * M; // the reveal at +40: the switch ends at +10 (30 minutes before)
  const resume = { ...b.defaultState(), phase: 'scheduled', kidName: 'Max', scheduledAt: new Date(kidAt).toISOString() };
  const state = { ...b.defaultState(), phase: 'live', quiet: true, source: 'stream', resume };
  const q = { ...b.defaultQuiet(), until: new Date(Date.now() + 90 * M).toISOString() };
  assert.equal(b.quietUntil(q, state), kidAt - 30 * M, 'clipped to 30 minutes before');
  travel(1 * M);
  await b.warnQuietEnding(env, config, q, state, []);
  assert.equal(slackSays(/30 minutes before Max's reveal/), 1);
  assert.equal(slackSays(/becomes the reveal then: stop it before then if it is only a test/), 1);
  assert.equal(slackSays(/stays a test until the phone stops.*30 minutes before/), 0);
});

test('a Y for a stop before the planned start sends nothing out early: setup footage, and the real start is the same reveal', () => {
  const start = Date.now() + 20 * M;
  const live = { ...b.defaultState(), phase: 'ending', source: 'stream', broadcastId: 'live-9', scheduledAt: new Date(start).toISOString(), liveAt: new Date(Date.now() - 12 * M).toISOString(), disconnectedAt: new Date(Date.now() - 15e3).toISOString() };
  const early = b.tAnswer(live, 'yes', config, { asked: true });
  assert.equal(early.outcome, 'ended');
  assert.equal(early.state.overSaid, false, 'before the start: waits for the window as before');
  assert.equal(b.waitsForPhone(early.state), true);
  const after = b.tAnswer({ ...live, scheduledAt: new Date(Date.now() - 11 * M).toISOString() }, 'yes', config, { asked: true });
  assert.equal(after.state.overSaid, true, 'after the start: over now');
  assert.equal(b.waitsForPhone(after.state), false);
});

// ─── 5. The mic check ───────────────────────────────────────────────────

test('mic check: "ok" under -24 LUFS is "a little quiet" and doesn\'t pass; -18 passes; the reveal\'s own verdicts are untouched', () => {
  const health = {};
  monitor.noteRehearsal(health, { ok: true, at: '2026-11-17T18:05:32.616Z', audio: { verdict: 'ok', lufs: -30.5 } });
  assert.equal(health.rehearsal.verdict, 'low', 'Nov 17\'s -30.5 no longer passes');
  assert.equal(health.rehearsal.goodAt, null);
  monitor.noteRehearsal(health, { ok: true, at: '2026-11-19T15:00:00.000Z', audio: { verdict: 'ok', lufs: -18 } });
  assert.equal(health.rehearsal.verdict, 'ok');
  assert.equal(health.rehearsal.goodAt, '2026-11-19T15:00:00.000Z');
  assert.equal(health.rehearsal.goodLufs, -18);
  monitor.noteRehearsal(health, { ok: true, at: '2026-11-19T15:01:00.000Z', audio: { verdict: 'quiet', lufs: -40 } });
  assert.equal(health.rehearsal.verdict, 'quiet', 'very quiet stays very quiet');
  assert.equal(health.rehearsal.goodAt, '2026-11-19T15:00:00.000Z', 'the last good check is kept');
});

// ─── 7. Stream's notifications reaching the site ─────────────────────────

test('webhook: a phone live with no notification for it is a problem; one heard around then, or no phone lately, is fine', async () => {
  const live = new Date(Date.now() - 2 * H).toISOString();
  await env.DB.prepare(`INSERT INTO broadcasts (id, kid_slug, kid_name, title, phase, live_at, ended_at, source, created_at, updated_at) VALUES ('live-1', 'remi', 'Remi', 't', 'replay', ?, ?, 'stream', ?, ?)`).bind(live, new Date(Date.parse(live) + 10 * M).toISOString(), live, live).run();
  const silent = await preflight.webhookProblem(env.DB, { webhook: { lastReceivedAt: '2026-10-21T16:18:16.796Z' } });
  assert.match(silent, /aren't reaching the site/);
  assert.match(silent, /Oct 21/);
  assert.match(await preflight.webhookProblem(env.DB, {}), /never/);
  assert.equal(await preflight.webhookProblem(env.DB, { webhook: { lastReceivedAt: new Date(Date.parse(live) - 20e3).toISOString() } }), null, 'the connect notification just before the go-live');
  assert.equal(await preflight.webhookProblem(env.DB, { webhook: {} }, Date.now() + 40 * 24 * H), null, 'no phone in 30 days: nothing to judge by');
});
