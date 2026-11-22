// testFbLiveCreate: the admin check that the site can start a Facebook live. It must create the live video
// UNPUBLISHED (never LIVE_NOW), delete what it made, and report a refusal with its code.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testFbLiveCreate } from '../functions/api/_broadcast-fb.js';

const env = { FB_PAGE_ID: '113519518789613', FB_PAGE_TOKEN: 'test-token' };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fakeGraph(handler) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const params = Object.fromEntries(new URLSearchParams(init.body ? String(init.body) : url.search));
    const call = { method: init.method || 'GET', path: url.pathname.replace(/^\/v[\d.]+\//, ''), params };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

test('creates the live video unpublished, then deletes it', async () => {
  const calls = fakeGraph((c) => c.method === 'POST' ? { body: { id: '999' } } : { body: { success: true } });
  const r = await testFbLiveCreate(env);
  assert.deepEqual(r, { ok: true, created: true, id: '999', deleted: true, deleteError: null });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, `${env.FB_PAGE_ID}/live_videos`);
  assert.equal(calls[0].params.status, 'UNPUBLISHED');
  assert.notEqual(calls[0].params.status, 'LIVE_NOW');
  assert.equal(calls[1].method, 'DELETE');
  assert.equal(calls[1].path, '999');
});

test('a refusal is reported with its code and nothing is deleted', async () => {
  const calls = fakeGraph(() => ({ status: 400, body: { error: { message: '(#10) Application does not have permission for this action', code: 10 } } }));
  const r = await testFbLiveCreate(env);
  assert.equal(r.ok, false);
  assert.equal(r.created, false);
  assert.equal(r.code, 10);
  assert.equal(r.needsReview, true);
  assert.equal(calls.length, 1);
});

test('a failed delete is reported', async () => {
  fakeGraph((c) => c.method === 'POST' ? { body: { id: '999' } } : { status: 400, body: { error: { message: 'Unsupported delete request', code: 100 } } });
  const r = await testFbLiveCreate(env);
  assert.equal(r.created, true);
  assert.equal(r.deleted, false);
  assert.equal(r.deleteError, 'Unsupported delete request');
});

test('not configured: no call at all', async () => {
  const calls = fakeGraph(() => ({ body: {} }));
  const r = await testFbLiveCreate({});
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});
