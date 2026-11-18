/**
 * How messages for the family look, for the server and the page alike (src/utils/live-message-look.ts), and the story
 * under the kid's name in its sentences (src/utils/live-hero-text.ts leadSentences).
 * Run: node --test tests/live-message-look.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = (entry) => import(`data:text/javascript,${encodeURIComponent(buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', packages: 'external' }).outputFiles[0].text)}`);
const { messageInitial, messageTone, latestLine, LATEST_HEART } = await load('src/utils/live-message-look.ts');
const { leadSentences } = await load('src/utils/live-hero-text.ts');

test('the writer\'s letter is the first whole character a person sees', () => {
  assert.equal(messageInitial('ana'), 'A');
  assert.equal(messageInitial('  élodie'), 'É');
  assert.equal(messageInitial('e\u0301lodie'), 'É', 'a letter and its accent written apart stay one');
  assert.equal(messageInitial('🇺🇸 Sam'), '🇺🇸', 'a flag, not half of one');
  assert.equal(messageInitial('❤️ Nana'), '❤️', 'the emoji with its colour selector');
  assert.equal(messageInitial('👍🏽 Jo'), '👍🏽', 'with its skin tone');
  assert.equal(messageInitial('ilkay'), 'I', 'the same capital in every language\'s browser');
  assert.equal(messageInitial(''), '');
  assert.equal(messageInitial(null), '');
});

test('the colour follows the name, the same everywhere', () => {
  assert.equal(messageTone('Ana'), 3);
  assert.equal(messageTone(' Ana '), 3);
  assert.ok([0, 1, 2, 3, 4].includes(messageTone('A much longer name here')));
});

test('the newest-message line: the newest, an invitation while the box is open, or nothing', () => {
  const line = latestLine('Dylan', { id: 'm9', name: 'Bea', body: 'So proud!' }, true);
  assert.deepEqual({ ...line }, { id: 'm9', initial: 'B', heart: false, tone: 3, name: 'Bea', text: 'So proud!', label: 'Newest message, from Bea: So proud!. See every message' });
  const first = latestLine('Dylan', null, true);
  assert.equal(first.id, 'first:Dylan');
  assert.equal(first.heart, true);
  assert.equal(first.text, "Be the first to write to Dylan's family");
  assert.equal(latestLine(null, null, true).text, 'Be the first to leave a message');
  assert.equal(latestLine('Dylan', null, false), null, 'closed and empty: no line');
  assert.match(LATEST_HEART, /^<svg [^>]*aria-hidden="true"/);
});

test('the story in its sentences (the narrow column shows the first whole one)', () => {
  assert.deepEqual(leadSentences('Dylan has a condition requiring care at home. SOARD is building a therapy room.'), ['Dylan has a condition requiring care at home.', 'SOARD is building a therapy room.']);
  assert.deepEqual(leadSentences('  One   sentence only  '), ['One sentence only']);
  assert.deepEqual(leadSentences('Wow! "Quoted" next. 3 cats.'), ['Wow!', '"Quoted" next.', '3 cats.']);
  assert.deepEqual(leadSentences('See you at 3.5 miles out. Then home.'), ['See you at 3.5 miles out.', 'Then home.']);
  assert.deepEqual(leadSentences(''), []);
});
