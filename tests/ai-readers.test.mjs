/**
 * The two picture readers and their stand-ins (functions/api/_ai.js)
 * Nov 25 2026: Cloudflare retired Kimi K2.6, one of the two readers, on Nov 20 ("5028: Model has been deprecated"), and
 * from the next check on every check deposited in Mercury waited on it. Peter: "the mercury/zeffy check reader automation
 * seems to be broken, can you review, test and repair?". Now a retired reader's stand-in reads in its place, and Slack
 * hears once. Names and amounts are made up.
 * Run: node --test tests/ai-readers.test.mjs
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { READERS, SPARE_READERS, modelGone, runReader, viaGateway } from '../functions/api/_ai.js';
import { READERS as SCORE_READERS } from '../functions/api/_score-scans.js';
import { W, setup, run, rowOf, post, fakeFetch, TX, NOW, MIN, readState } from './lib/check-gifts-harness.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = fakeFetch;
after(() => { globalThis.fetch = realFetch; });

const [A, B] = Object.keys(READERS);
const maker = (m) => m.split('/')[1];
// Cloudflare's words for a retired model, as it answered on Nov 25 2026
const RETIRED = `5028: Model has been deprecated: ${A} was deprecated on 2026-11-20. See the model catalog for alternatives`;

test('two readers from two makers, neither one thinking, and the scoresheets read with the same two', () => {
  assert.equal(Object.keys(READERS).length, 2);
  assert.notEqual(maker(A), maker(B));
  // DeepSeek thinks unless told not to; Llama 4 Scout doesn't think. Thinking spent 19 to 71 seconds of a check's 24 (Qwen, Nov 25)
  assert.deepEqual(READERS['@cf/deepseek-ai/deepseek-v4.1-flash-1017'], { chat_template_kwargs: { enable_thinking: false } });
  for (const m of [A, B]) assert.ok(!READERS[m].reasoning_effort && READERS[m].chat_template_kwargs?.enable_thinking !== true, m);
  assert.equal(SCORE_READERS, READERS);
  assert.ok(!Object.keys(READERS).some((m) => /kimi-k2\.6/.test(m)), 'Kimi K2.6 was retired on Nov 20 2026');
});

test('each reader has its own stand-in, from a maker neither reader is from', () => {
  const stands = Object.keys(READERS).map((m) => SPARE_READERS[m]?.[0]);
  assert.equal(new Set(stands).size, 2, 'never one stand-in for both, so two readings stay two models');
  for (const s of stands) assert.ok(s && ![A, B].map(maker).includes(maker(s)), s);
});

test('a model gone for good is told from any other failure', () => {
  assert.equal(modelGone(new Error(RETIRED)), true);
  assert.equal(modelGone(new Error('AiError: Model has been deprecated: @cf/x was deprecated on 2026-11-20.')), true);
  assert.equal(modelGone(new Error('5007: No such model @cf/x')), true);
  for (const m of ['3040: Capacity temporarily exceeded', "2045: Spend limit exceeded: rule 'site-day'", 'timeout', 'Network connection lost']) assert.equal(modelGone(new Error(m)), false, m);
  assert.equal(modelGone(null), false);
});

test('a retired reader is answered by its stand-in, with the stand-in’s settings in place of the reader’s, through the same gateway', async () => {
  const calls = [];
  const env = { AI: { run: async (model, input, opts) => { calls.push({ model, input, opts }); if (model === A) throw new Error(RETIRED); return { response: { ok: model } }; } } };
  const input = { messages: [{ role: 'user', content: 'Read this check.' }], max_tokens: 800, temperature: 0, ...READERS[A], response_format: { type: 'json_schema' } };
  const out = await runReader(env, A, input, viaGateway('check-gifts'));
  const [stand, settings] = SPARE_READERS[A];
  assert.deepEqual(out, { response: { ok: stand } });
  assert.deepEqual(calls.map((c) => c.model), [A, stand]);
  assert.deepEqual(calls[1].input, { messages: input.messages, max_tokens: 800, temperature: 0, response_format: input.response_format, ...settings });
  assert.deepEqual(calls[1].opts, viaGateway('check-gifts'));
});

test('anything else a reader answers is thrown as it came, and nothing stands in', async () => {
  const calls = [];
  const env = { AI: { run: async (model) => { calls.push(model); throw new Error('3040: Capacity temporarily exceeded'); } } };
  await assert.rejects(runReader(env, A, { ...READERS[A] }, viaGateway('check-gifts')), /3040/);
  assert.deepEqual(calls, [A]);
  // A model that isn't a reader has no stand-in
  const other = { AI: { run: async () => { throw new Error(RETIRED); } } };
  await assert.rejects(runReader(other, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {}, viaGateway('mail-sweep')), /5028/);
});

// ── The check reader, end to end, with one reader retired ─────────────────────────────────────────────────────────────

beforeEach(async () => { await setup(); });

test('a check is still read with one reader retired: the stand-in reads it, and Slack hears once which reader went', async () => {
  const asked = [];
  W.env.AI.run = async (model) => {
    asked.push(model);
    if (model === A) throw new Error(RETIRED);
    return { response: W.world.reading };
  };
  post();
  await run(NOW);
  const r = await rowOf(TX);
  assert.equal(r.state, 'read', `the check was left "${r.state}" (${r.reason || 'no reason'})`);
  assert.equal(r.payer, 'Pine Foundation');
  assert.deepEqual([...new Set(asked)].sort(), [A, B, SPARE_READERS[A][0]].sort());
  const st = await readState(W.env.DB, 'ai-readers');
  assert.equal(st.gone?.[A]?.stand, SPARE_READERS[A][0]);
  const said = W.world.slack.join('\n');
  assert.match(said, /retired one of the site/);
  assert.ok(said.includes(A) && said.includes(SPARE_READERS[A][0]), 'names the reader that went and the one reading in its place');
  // The card made on the next run reads nothing; the run after, nothing more is said either
  await run(NOW + 10 * MIN);
  await run(NOW + 20 * MIN);
  assert.equal(W.world.slack.filter((b) => /retired one of the site/.test(b)).length, 1);
});

test('a reader and its stand-in both gone is still a reader outage: the check waits without spending a try', async () => {
  W.env.AI.run = async (model) => {
    if (model === A || model === SPARE_READERS[A][0]) throw new Error(RETIRED);
    return { response: W.world.reading };
  };
  post();
  await assert.rejects(run(NOW), (e) => e.readers === true && /reader didn’t answer/.test(e.message));
  const r = await rowOf(TX);
  assert.equal(r.state, 'new');
  assert.equal(r.tries, 0, 'an outage never spends a check’s try');
});
