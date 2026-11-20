/**
 * Local build keys (scripts/d1-helpers.js): never from a file in the repo. On a Mac the build reads the three D1
 * values from the Keychain (service "soard-site"); a value already in the environment always wins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keychainValue, loadEnv, LOCAL_KEYS, KEYCHAIN_SERVICE } from '../scripts/d1-helpers.js';

function withEnv(values, fn) {
  const saved = Object.fromEntries(LOCAL_KEYS.map((k) => [k, process.env[k]]));
  for (const k of LOCAL_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const k of LOCAL_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('reads one item from the soard-site Keychain service, by name', () => {
  let asked = null;
  const run = (cmd, args) => { asked = [cmd, ...args]; return 'tok-123\n'; };
  assert.equal(keychainValue('CLOUDFLARE_API_TOKEN', { run, platform: 'darwin' }), 'tok-123');
  assert.deepEqual(asked, ['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'CLOUDFLARE_API_TOKEN', '-w']);
});

test('no Keychain item, access refused, or not a Mac: null, never a throw', () => {
  const missing = () => { throw new Error('The specified item could not be found in the keychain.'); };
  assert.equal(keychainValue('CLOUDFLARE_API_TOKEN', { run: missing, platform: 'darwin' }), null);
  assert.equal(keychainValue('CLOUDFLARE_API_TOKEN', { run: () => '  \n', platform: 'darwin' }), null);
  let ran = false;
  assert.equal(keychainValue('CLOUDFLARE_API_TOKEN', { run: () => { ran = true; return 'x'; }, platform: 'linux' }), null);
  assert.equal(ran, false);
});

test('loadEnv fills only what the environment lacks, from the Keychain', () => {
  withEnv({ CLOUDFLARE_ACCOUNT_ID: 'from-env' }, () => {
    const asked = [];
    loadEnv({ keychain: (name) => { asked.push(name); return `kc-${name}`; } });
    assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, 'from-env');
    assert.equal(process.env.CLOUDFLARE_API_TOKEN, 'kc-CLOUDFLARE_API_TOKEN');
    assert.equal(process.env.CLOUDFLARE_D1_ID, 'kc-CLOUDFLARE_D1_ID');
    assert.deepEqual(asked, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_D1_ID']);
  });
});

test('loadEnv with nothing in the Keychain leaves the keys unset (prebuild then says how to add them)', () => {
  withEnv({}, () => {
    loadEnv({ keychain: () => null });
    for (const k of LOCAL_KEYS) assert.equal(process.env[k], undefined);
  });
});
