/**
 * A main-feed test's end on the live page (src/utils/live-client.ts, functions/api/broadcast-test-end.js): Peter
 * (Nov 18 2026) wants "Test the main feed" to end with the theater, the thank-you and the replay, while the public
 * goes straight back to the countdown. A signed-in staff page goes from the test straight to its end (never the
 * countdown in between); anyone else is refused once and keeps the countdown.
 * Run: node --test tests/live-client-test-end.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const realSetTimeout = globalThis.setTimeout;
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));
for (const name of ['setTimeout', 'setInterval']) {
  const real = globalThis[name];
  globalThis[name] = (...args) => { const t = real(...args); t?.unref?.(); return t; };
}

const code = buildSync({ entryPoints: ['src/utils/live-client.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' }).outputFiles[0].text;

const REMINDERS = { enabled: true, email: true, sms: false, push: false, pushKey: null };
const LIVE = { phase: 'live', live: true, upcoming: false, replay: false, id: 'bt1', kidSlug: 'dylan-2026', kidName: 'Dylan', liveAt: new Date(Date.now() - 60e3).toISOString(), source: 'stream', player: { kind: 'live', uid: 'in1', customerCode: 'cc' } };
const until = () => new Date(Date.now() + 10 * 60e3).toISOString();
const COUNTDOWN = (extra = {}) => ({ phase: 'scheduled', live: false, upcoming: true, replay: false, id: 'bp1', kidSlug: 'dylan-2026', kidName: 'Dylan', scheduledAt: '2026-11-18T21:00:00Z', player: null, ...extra });
const END = { phase: 'replay', live: false, upcoming: false, replay: true, id: 'bt1', kidSlug: 'dylan-2026', kidName: 'Dylan', endedAt: new Date().toISOString(), source: 'stream', player: null, testEnded: true };

/** A browser on `pathname` where /api/broadcast-test-end answers with `testEnd()` */
async function browser({ pathname = '/live/dylan-2026/', testEnd }) {
  const sockets = [];
  class FakeSocket { constructor() { sockets.push(this); } send() {} close() {} }
  globalThis.window = { parent: null, top: null, addEventListener() {} };
  window.parent = window; window.top = window;
  globalThis.WebSocket = FakeSocket;
  window.WebSocket = FakeSocket;
  globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener() {} };
  globalThis.location = { protocol: 'https:', host: 'example.org', pathname, search: '' };
  const asked = [];
  Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: (url) => { asked.push(String(url)); return true; } }, configurable: true, writable: true });
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url) === '/api/broadcast-test-end') return testEnd();
    if (String(url).startsWith('/api/broadcast')) return Response.json({ state: LIVE, reminders: REMINDERS, timezone: 'America/New_York' });
    return new Response('{}');
  };
  const { getLiveClient } = await import(`data:text/javascript,${encodeURIComponent(code)}#${Math.random()}`);
  const client = getLiveClient();
  const heard = [];
  client.subscribe((state) => heard.push(state));
  await wait(20);
  const hub = sockets[0];
  hub.onopen?.();
  const say = async (state) => { hub.onmessage({ data: JSON.stringify({ type: 'state', state }) }); await wait(20); };
  return { client, heard, say, asked: () => asked.filter((u) => u === '/api/broadcast-test-end').length, all: asked };
}

test('signed-in staff: the test goes straight to its end (never the countdown in between), then back to the countdown', async () => {
  const b = await browser({ testEnd: () => Response.json({ state: END }) });
  assert.equal(b.heard.at(-1).phase, 'live');
  await b.say(COUNTDOWN({ testEndUntil: until() }));
  assert.deepEqual(b.heard.map((s) => s.phase), ['live', 'replay'], 'live, then the test\'s end: no countdown flash');
  assert.equal(b.heard.at(-1).testEnded, true);
  assert.equal(b.client.state.id, 'bt1', 'the page reads the end too');
  // Nothing of a test's end is counted
  const before = b.all.length;
  b.client.watched('replay', 30, 'bt1');
  b.client.beacon('play');
  assert.equal(b.all.length, before, 'no watch time or events sent');
  // The same public state again (the hub repeating itself): still the end
  await b.say(COUNTDOWN({ testEndUntil: until() }));
  assert.equal(b.heard.at(-1).phase, 'replay');
  // Its window over: the countdown
  await b.say(COUNTDOWN());
  assert.equal(b.heard.at(-1).phase, 'scheduled');
  assert.equal(b.client.state.id, 'bp1');
});

test('anyone else: refused once, the countdown straight away, never asked again', async () => {
  const b = await browser({ testEnd: () => Response.json({ success: false, error: 'Access denied' }, { status: 403 }) });
  await b.say(COUNTDOWN({ testEndUntil: until() }));
  assert.deepEqual(b.heard.map((s) => s.phase), ['live', 'scheduled']);
  assert.equal(b.heard.at(-1).testEnded, undefined);
  await b.say(COUNTDOWN({ testEndUntil: until(), title: 'changed' }));
  assert.equal(b.asked(), 1, 'asked only once');
});

test('the staff address down or unreachable: the countdown, not a frozen page', async () => {
  const b = await browser({ testEnd: () => { throw new TypeError('Failed to fetch'); } });
  await b.say(COUNTDOWN({ testEndUntil: until() }));
  assert.equal(b.heard.at(-1).phase, 'scheduled');
});

test('the LIVE pill on other pages never asks', async () => {
  const b = await browser({ pathname: '/about/', testEnd: () => Response.json({ state: END }) });
  await b.say(COUNTDOWN({ testEndUntil: until() }));
  assert.equal(b.heard.at(-1).phase, 'scheduled');
  assert.equal(b.asked(), 0);
});

test('a new test going live replaces the end at once', async () => {
  const b = await browser({ testEnd: () => Response.json({ state: END }) });
  await b.say(COUNTDOWN({ testEndUntil: until() }));
  assert.equal(b.heard.at(-1).phase, 'replay');
  await b.say({ ...LIVE, id: 'bt2' });
  assert.equal(b.heard.at(-1).phase, 'live');
  assert.equal(b.heard.at(-1).id, 'bt2');
});
