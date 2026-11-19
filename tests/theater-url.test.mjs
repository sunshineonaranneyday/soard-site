/**
 * A reveal card opens its kid's Theater (/live/<slug>/) only for one kid with one (src/utils/theater-url.ts;
 * Peter, Nov 19 2026: "yes pointing to their theater").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/utils/theater-url.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' }).outputFiles[0].text;
const { theaterUrlFor } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('one kid with a Theater: their live page', () => {
  assert.equal(theaterUrlFor(['dylan-2026'], new Set(['dylan-2026'])), '/live/dylan-2026/');
});

test('no Theater, a group video, or an empty list: the card keeps the video pop-up', () => {
  const kids = new Set(['dylan-2026']);
  assert.equal(theaterUrlFor(['cayden'], kids), null);
  assert.equal(theaterUrlFor(['dylan-2026', 'max'], kids), null);
  assert.equal(theaterUrlFor([], kids), null);
  assert.equal(theaterUrlFor(['dylan-2026'], new Set()), null);
});

test('the slug is a path segment, never more', () => {
  assert.equal(theaterUrlFor(['a/../b'], new Set(['a/../b'])), '/live/a%2F..%2Fb/');
});
