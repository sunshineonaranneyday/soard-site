/**
 * /trade-partners/: the insurance a certificate has to show, put in before the
 * page arrives (functions/trade-partners/_middleware.js), from the same minimums
 * /api/trade-partner?config gives the page script, so nothing moves after load.
 * Run: node --test tests/trade-partners-requirements.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

// The module imports the page's own TypeScript words: bundle it for node
const code = buildSync({ entryPoints: ['functions/trade-partners/_middleware.js'], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' }).outputFiles[0].text;
const { minimums, onRequest } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
// Lets the code run up to its next wait (setImmediate isn't one of the mocked timers)
const turns = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const { DEFAULTS } = await import('../functions/api/_vendor-defaults.js');
const { DEFAULTS: VENDOR_DEFAULTS } = await import('../functions/api/_vendors.js');

/** A database holding the vendor record with these settings (or no record), counting reads */
function db(docSettings, { slow = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        first: async () => {
          calls.push(sql);
          if (slow) await new Promise(() => {});
          return docSettings === undefined ? null : { s: JSON.stringify(docSettings) };
        },
      };
    },
  };
}
const ctx = (DB, path = '/trade-partners/', extra = {}) => ({ env: { DB }, request: new Request(`https://example.org${path}`), next: async () => new Response('as built'), waitUntil() {}, ...extra });

test('the vendor engine and the page read the same defaults', () => {
  assert.equal(VENDOR_DEFAULTS, DEFAULTS);
});

test('the minimums are the saved ones over the defaults, and only the settings are read', async () => {
  const saved = db({ glOccurrence: 2000000, workersComp: false });
  const m = await minimums(ctx(saved));
  assert.equal(m.glOccurrence, 2000000);
  assert.equal(m.glAggregate, DEFAULTS.glAggregate);
  assert.equal(m.workersComp, false);
  assert.match(saved.calls[0], /json_extract\(data, '\$\.docSettings'\)/);
  assert.match(saved.calls[0], /FROM spend_state WHERE key = 'vendors'/);
  assert.deepEqual(await minimums(ctx(db(undefined))), DEFAULTS, 'never saved: the defaults');
});

test('an edge reads the database once, then answers from its copy', async () => {
  const realCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = { default: { match: async (k) => store.get(k.url)?.clone(), put: async (k, r) => { store.set(k.url, r); } } };
  try {
    const saved = db({ glOccurrence: 3000000 });
    const puts = [];
    const c = ctx(saved, '/trade-partners/', { waitUntil: (p) => puts.push(p) });
    assert.equal((await minimums(c)).glOccurrence, 3000000);
    await Promise.all(puts);
    assert.equal((await minimums(c)).glOccurrence, 3000000);
    assert.equal(saved.calls.length, 1, 'the second page came from the edge copy');
    assert.match(store.get('https://example.org/api/trade-partner?edge=minimums').headers.get('Cache-Control'), /max-age=300/);
  } finally {
    globalThis.caches = realCaches;
  }
});

test('other pages, other methods, a database that fails or is slow: the page as built', async () => {
  for (const c of [ctx(db({}), '/trade-partners/account/'), { ...ctx(db({})), request: new Request('https://example.org/trade-partners/', { method: 'POST' }) }, ctx({ prepare() { throw new Error('no table'); } }), ctx(undefined)]) {
    assert.equal(await (await onRequest(c)).text(), 'as built');
  }
  // A database that never answers: the page waits exactly its time, then goes out as built. The timer is the test's
  // (node:test's mock timers), so this holds however busy the machine is (a stopwatch here failed under the full run)
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let done = false;
    const page = onRequest(ctx(db({}, { slow: true })), 50).then((r) => { done = true; return r; });
    await turns();
    mock.timers.tick(49);
    await turns();
    assert.equal(done, false, 'still waiting just before its time');
    mock.timers.tick(1);
    await turns();
    assert.equal(done, true, 'gave up at its time');
    assert.equal(await (await page).text(), 'as built', 'the page as built');
  } finally {
    mock.timers.reset();
  }
});
