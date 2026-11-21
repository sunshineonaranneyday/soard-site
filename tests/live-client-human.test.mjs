/**
 * The live page's first sign of a person (src/utils/live-stats.ts humanSign, src/utils/live-client.ts): Reveal stats
 * counts a visit once its page has seen a person (Peter, Nov 21 2026, "yes, fix 1 to 4": email security software was
 * counted as people). The visits a page reported before it hear it the moment it happens, each for its own reveal and
 * child's page; visits after it carry it themselves; a script's event is never it.
 * Run: node --test tests/live-client-human.test.mjs
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
const LIVE = { phase: 'live', live: true, upcoming: false, replay: false, id: 'live-77', kidSlug: 'max', kidName: 'Max', liveAt: new Date(Date.now() - 60e3).toISOString(), source: 'stream', player: { kind: 'live', uid: 'in1', customerCode: 'cc' } };

test('a page\'s first touch tells the visits it already reported, once each; later ones carry it; a script\'s event never', async () => {
  const listeners = {};
  class FakeSocket { send() {} close() {} }
  globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((x) => x !== f); } };
  window.parent = window; window.top = window;
  globalThis.WebSocket = FakeSocket;
  window.WebSocket = FakeSocket;
  globalThis.document = { hidden: false, visibilityState: 'visible', referrer: '', activeElement: null, addEventListener() {} };
  globalThis.location = { protocol: 'https:', host: 'sunshineonaranneyday.com', hostname: 'sunshineonaranneyday.com', pathname: '/live/max/', search: '?src=email' };
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
  const sent = [];
  Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: (url, blob) => { sent.push(blob.text().then((t) => ({ url: String(url), body: JSON.parse(t) }))); return true; } }, configurable: true, writable: true });
  globalThis.fetch = async (url) => (String(url).startsWith('/api/broadcast') ? Response.json({ state: LIVE, reminders: null, timezone: 'America/New_York' }) : new Response('{}'));
  const { getLiveClient } = await import(`data:text/javascript,${encodeURIComponent(code)}#${Math.random()}`);
  const client = getLiveClient();
  await wait(20);
  const fire = (t, e = {}) => { for (const f of [...(listeners[t] || [])]) f({ isTrusted: true, ...e }); };
  const bodies = async () => (await Promise.all(sent)).map((x) => x.body);

  client.beacon('view_live_page', { phase: 'live', kid: 'max' }, null); // this reveal, on Max's page
  client.beacon('view_live_page', { phase: 'replay', kid: 'dylan-2026' }, 'live-70'); // Dylan's past reveal, on his page
  client.beacon('click_watch', { kid: 'max' }, null); // not a visit
  let b = await bodies();
  assert.ok(b.filter((x) => x.type === 'view_live_page').every((x) => !x.h), 'no person seen yet');

  fire('pointerdown', { isTrusted: false }); // a script's click
  assert.equal((await bodies()).filter((x) => x.type === 'human').length, 0, 'a script\'s event isn\'t a person');

  fire('touchstart');
  b = await bodies();
  const human = b.filter((x) => x.type === 'human');
  assert.deepEqual(human.map((x) => [x.broadcastId, x.meta?.kid, x.h, x.src]), [['live-77', 'max', 1, 'email'], ['live-70', 'dylan-2026', 1, 'email']],
    'each visit already reported hears it, for its own reveal and child\'s page');
  assert.ok(human.every((x) => x.vid === b[0].vid), 'the same browser');

  fire('keydown');
  client.beacon('view_live_page', { phase: 'live', kid: 'max' }, null);
  b = await bodies();
  assert.equal(b.filter((x) => x.type === 'human').length, 2, 'told once');
  assert.equal(b.at(-1).type, 'view_live_page');
  assert.equal(b.at(-1).h, 1, 'a visit after it carries it');
  // The seconds watched carry it too
  client.watched('live', 20, 'live-77');
  b = await bodies();
  assert.equal(b.at(-1).h, 1);
  delete globalThis.window; delete globalThis.document; delete globalThis.location; delete globalThis.localStorage; delete globalThis.sessionStorage;
});
