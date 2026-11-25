/**
 * Meet the Kids in reveal order (Peter, Nov 25 2026: "update the order so that it shows in order of reveal by
 * default", then "all kids by reveal date"): kids still to be revealed first, the next reveal first, then finished
 * rooms, the newest reveal first in each year. The build's reveal days come from JobTread's copy, our own stream and
 * the reviewed past-jobs list, the surest winning.
 * Run: node --test tests/kid-order.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { revealDays } from '../scripts/d1-helpers.js';

const load = (entry) => import(`data:text/javascript,${encodeURIComponent(buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', packages: 'external' }).outputFiles[0].text)}`);
const { compareKids, cardOrderKey } = await load('src/utils/kid-order.ts');

const kid = (name, status, year, extra = {}) => ({ status, year, name: name.toLowerCase(), next: null, revealed: null, sortOrder: null, ...extra });
const order = (kids, sort) => [...kids].sort((a, b) => compareKids(a, b, sort)).map((k) => k.name);

// The page as it was on Nov 25 2026: five kids in build in a hand-set order, the finished ones A to Z in each year
const colin = kid('Colin', 'in-progress', 2026, { next: 0, sortOrder: 4 });
const axel = kid('Axel', 'in-progress', 2026, { next: 4, sortOrder: 6 });
const peter = kid('Peter', 'in-progress', 2026, { next: 1, sortOrder: 7 });
const lizzie = kid('Lizzie', 'in-progress', 2026, { next: 2, sortOrder: 9 });
const jackson = kid('Jackson', 'in-progress', 2026, { next: 3, sortOrder: 11 });
const dex = kid('Dex', 'completed', 2026, { sortOrder: 5 });
const dylan = kid('Dylan', 'completed', 2026, { revealed: '2026-11-18', sortOrder: 8 });
const max = kid('Max', 'completed', 2026, { revealed: '2026-11-20', sortOrder: 10 });
const leland = kid('Leland', 'completed', 2026, { revealed: '2026-05-03', sortOrder: 0 });
const remi = kid('Remi and Nico', 'completed', 2026, { revealed: '2026-09-28', sortOrder: 3 });
const amari = kid('Amari', 'completed', 2025, { revealed: '2025-12-22' });
const emery = kid('Emery', 'completed', 2025, { revealed: '2025-02-06' });
const matthew = kid('Matthew', 'completed', 2024, { revealed: '2025-01-27' }); // a December build revealed in January
const hannah = kid('Hannah', 'completed', 2024, { revealed: '2024-12-23' });
const all = [dex, remi, hannah, axel, max, emery, jackson, leland, colin, amari, lizzie, matthew, peter, dylan];

test('by default: the next reveal first, then the newest reveal first in each year', () => {
  assert.deepEqual(order(all), ['colin', 'peter', 'lizzie', 'jackson', 'axel', 'max', 'dylan', 'remi and nico', 'leland', 'dex', 'amari', 'emery', 'matthew', 'hannah']);
  assert.deepEqual(order(all, 'newest'), order(all), 'Newest first is the default');
  assert.deepEqual(order(all, 'something old in a link'), order(all));
});

test('a kid whose reveal day isn’t known comes after the ones that are in its year; the year still groups them', () => {
  const [first] = order([dex, max, amari]);
  assert.equal(first, 'max');
  assert.deepEqual(order([dex, leland, amari]), ['leland', 'dex', 'amari']);
  // Matthew (2024) was revealed after Hannah, and before every 2025 kid on the page
  assert.deepEqual(order([hannah, emery, matthew]), ['emery', 'matthew', 'hannah']);
});

test('oldest first runs each year the other way, kids still to be revealed staying first, the next reveal first', () => {
  assert.deepEqual(order(all, 'oldest'), ['colin', 'peter', 'lizzie', 'jackson', 'axel', 'hannah', 'matthew', 'emery', 'amari', 'leland', 'remi and nico', 'dylan', 'max', 'dex']);
});

test('the name sorts go by name, kids still to be revealed first', () => {
  assert.deepEqual(order([max, colin, amari, axel], 'name-az'), ['axel', 'colin', 'amari', 'max']);
  assert.deepEqual(order([max, colin, amari, axel], 'name-za'), ['colin', 'axel', 'max', 'amari']);
});

test('awaiting funding first; a kid with no reveal on the schedule after the ones with one, in the admin’s order', () => {
  const funding = kid('Zoe', 'needs-funding', 2026);
  const unplanned = kid('Ava', 'in-progress', 2026, { sortOrder: 1 });
  const unplanned2 = kid('Bo', 'in-progress', 2026, { sortOrder: 2 });
  assert.deepEqual(order([unplanned2, axel, unplanned, colin, funding]), ['zoe', 'colin', 'axel', 'ava', 'bo']);
});

test('a card’s key from its data attributes', () => {
  assert.deepEqual(cardOrderKey({ status: 'in-progress', year: 'year-2026', name: 'colin', next: '0', sort: '4' }),
    { status: 'in-progress', year: 2026, name: 'colin', next: 0, revealed: null, sortOrder: 4 });
  assert.deepEqual(cardOrderKey({ status: 'completed', year: 'year-2026', name: 'max', sort: '', revealed: '2026-11-20' }),
    { status: 'completed', year: 2026, name: 'max', next: null, revealed: '2026-11-20', sortOrder: null });
  assert.deepEqual(cardOrderKey({}), { status: 'completed', year: 0, name: '', next: null, revealed: null, sortOrder: null });
});

test('the build’s reveal days: our own stream, else JobTread’s confirmed reveal, else the reviewed past-jobs date, else the Reveal task', () => {
  const now = Date.parse('2026-11-25T17:00:00Z');
  const pastJobs = [
    { slug: 'mathew', draft_date: '2012-07-14' },
    { slug: 'amari', draft_date: '2025-12-22' },
    { slug: 'max', draft_date: '2026-11-19' },
    { slug: 'dylan-2026', draft_date: '2026-11-01' },
    { slug: 'bad', draft_date: 'sometime' },
  ];
  const taskDays = { dex: '2026-07-09', amari: '2026-02-16', isla: '2026-08-11', nope: 'soon' };
  const stream = (kid_slug, live_at, extra = {}) => ({ id: `b-${kid_slug}-${live_at}`, kid_slug, live_at, scheduled_at: live_at, ended_at: live_at, replay_uid: 'r', source: 'stream', data: '{}', ...extra });
  const broadcasts = [
    stream('max', '2026-11-21T02:00:00.000Z'), // 9 PM Eastern on the 20th
    stream('dylan-2026', '2026-11-18T21:00:35.968Z'),
    stream('test-kid', '2026-11-10T21:00:00.000Z', { data: '{"test":true}' }),
    stream('fb-kid', '2026-11-10T21:00:00.000Z', { source: 'facebook' }),
  ];
  const reveals = { reveals: [{ slug: 'dylan-2026', date: '2026-11-17' }, { slug: 'colin', date: '2026-12-04' }], past: [{ slug: 'isla', date: '2026-08-12' }] };
  const days = revealDays({ pastJobs, taskDays, siteRows: [{ key: 'reveals', data: JSON.stringify(reveals) }], broadcasts, now });
  assert.deepEqual(days, {
    amari: '2025-12-22', // the photos' day over the task's
    dex: '2026-07-09', // the Reveal task, the only word
    'dylan-2026': '2026-11-18', // the day it went out live, over JobTread's and the photos'
    isla: '2026-08-12', // JobTread's confirmed reveal over the task
    mathew: '2012-07-14',
    max: '2026-11-20', // the Eastern day of the stream
  });
  assert.equal(days.colin, undefined, 'a reveal still ahead has no day yet');
  assert.deepEqual(revealDays({}), {});
  assert.deepEqual(revealDays({ taskDays: null }), {});
});
