/**
 * Live page first paint — when the server lays the page out for the video
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

// (bundled as the site bundles it: it uses the page script's own rule, live-hero-text.ts)
const load = (entry) => import(`data:text/javascript,${encodeURIComponent(buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', packages: 'external' }).outputFiles[0].text)}`);
const { watchParty } = await load('functions/live/_watch-party.js');

const now = Date.parse('2026-10-14T18:00:00Z');
const at = (min) => new Date(now + min * 60e3).toISOString();
const pub = (extra) => ({ phase: 'idle', kidSlug: 'axel', player: null, scheduledAt: null, orientation: 'portrait', ...extra });
const live = pub({ phase: 'live', player: { kind: 'live', uid: 'in1', customerCode: 'c' } });

test('live with a video: watch party on /live/ and on that kid\'s page', () => {
  assert.deepEqual(watchParty(live, { now }), { mode: 'live', orientation: 'portrait', eyebrow: 'Live now', ended: false, replaySoon: false });
  assert.equal(watchParty(live, { pageKid: 'axel', now }).mode, 'live');
  assert.equal(watchParty({ ...live, phase: 'ending' }, { now }).mode, 'live', 'a dropped camera is still the live reveal');
});

test('never on another kid\'s page', () => {
  assert.equal(watchParty(live, { pageKid: 'dana', now }), null);
});

test('a Facebook-only broadcast keeps the photo hero', () => {
  assert.equal(watchParty(pub({ phase: 'live', player: null }), { now }), null);
  assert.equal(watchParty(pub({ phase: 'live', player: null, source: 'manual' }), { now }), null);
  assert.equal(watchParty(pub({ phase: 'replay', player: null, source: 'manual', endedAt: new Date(Date.now() - 60e3).toISOString() }), { now }), null, 'and its end: no video here to come back to');
});

test('the reveal over, its replay not here yet: the watch party all the same, "That\'s the reveal!" in the frame (Peter, Nov 18 2026)', () => {
  const justEnded = new Date(Date.now() - 2 * 60e3).toISOString();
  const pending = pub({ phase: 'replay', player: null, source: 'stream', endedAt: justEnded });
  assert.deepEqual(watchParty(pending, { now }), { mode: 'replay', orientation: 'portrait', eyebrow: 'Replay', ended: true, replaySoon: true }, 'on /live/');
  assert.equal(watchParty(pending, { pageKid: 'axel', now }).ended, true, "on the kid's own page, for those arriving after the end");
  assert.equal(watchParty(pending, { pageKid: 'dana', now }), null, "never on another kid's page");
  // Overdue (no replay hours after the end): the note stays, with no promise of a replay
  const overdue = watchParty(pub({ phase: 'replay', player: null, source: 'stream', endedAt: new Date(Date.now() - 7 * 3600e3).toISOString() }), { now });
  assert.equal(overdue.ended, true);
  assert.equal(overdue.replaySoon, false);
});

test('replay with a video', () => {
  const r = watchParty(pub({ phase: 'replay', player: { kind: 'replay', uid: 'v1', customerCode: 'c' }, orientation: 'landscape' }), { now });
  assert.deepEqual(r, { mode: 'replay', orientation: 'landscape', eyebrow: 'Replay', ended: false, replaySoon: false });
});

test('on the reveal\'s day, before the camera comes on: the Theater with the photo (Peter, Nov 20 2026: "i want all reveals to have theater the day of the reveal")', () => {
  const tz = 'America/New_York'; // now is 2 PM there
  const waiting = { mode: 'upcoming', orientation: 'portrait', eyebrow: '', ended: false, replaySoon: false, waiting: true };
  assert.deepEqual(watchParty(pub({ phase: 'scheduled', scheduledAt: at(45) }), { tz, now }), waiting, 'on /live/');
  assert.deepEqual(watchParty(pub({ phase: 'armed', scheduledAt: at(10) }), { pageKid: 'axel', tz, now }), waiting, "on the child's own page, camera connected");
  assert.deepEqual(watchParty(pub({ phase: 'armed', scheduledAt: at(-35) }), { pageKid: 'axel', tz, now }), waiting, 'running late too');
  // From midnight of the day, in the visitor's zone
  assert.deepEqual(watchParty(pub({ phase: 'scheduled', scheduledAt: '2026-10-14T23:30:00Z' }), { tz, now: Date.parse('2026-10-14T04:05:00Z') }), waiting, '12:05 AM, the reveal at 7:30 PM');
  assert.equal(watchParty(pub({ phase: 'scheduled', scheduledAt: '2026-10-14T23:30:00Z' }), { tz, now: Date.parse('2026-10-14T03:55:00Z') }), null, '11:55 PM the night before: the plain hero');
  assert.equal(watchParty(pub({ phase: 'scheduled', scheduledAt: at(24 * 60) }), { tz, now }), null, 'the day before');
});

test('before the reveal, the plain hero on another child\'s page, with no child named, no time, or a sideways broadcast', () => {
  const tz = 'America/New_York';
  assert.equal(watchParty(pub({ phase: 'scheduled', scheduledAt: at(45) }), { pageKid: 'dana', tz, now }), null);
  assert.equal(watchParty(pub({ phase: 'scheduled', scheduledAt: at(45), kidSlug: null }), { tz, now }), null);
  assert.equal(watchParty(pub({ phase: 'scheduled', scheduledAt: null }), { tz, now }), null);
  assert.equal(watchParty(pub({ phase: 'scheduled', scheduledAt: at(45), orientation: 'landscape' }), { tz, now }), null);
});

test('idle is the plain hero', () => {
  assert.equal(watchParty(pub({}), { now }), null);
  assert.equal(watchParty(null, { now }), null);
});
