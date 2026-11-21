/**
 * The site's numbers, Nov 21 2026 (Peter: "check the other stats on the site are accurate too", then "Fix A now"):
 * children served and rooms built count finished makeovers only; rooms of each kind count rooms, not makeovers; a
 * typed Now Building date belongs to its own build; each event sponsor counts once however it's written; the store's
 * Google rating is read, not typed; a partner with no category isn't counted as Build.
 * Run: node --test tests/site-numbers.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const tsModule = async (path, replace = (s) => s) => {
  const src = replace(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code);
  return import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}#${Math.random()}`);
};

test('stats: finished makeovers only, and rooms of each kind counted as rooms', async () => {
  // The collections, as Astro would give them: Max finished, Colin in build, Jackson awaiting funding
  const kids = [
    { data: { slug: 'sofia', status: 'completed', childCount: 3, roomCount: 3, roomTypes: ['Dream Bedroom'], bedroomCount: 3, bathroomCount: 0, therapyRoomCount: 0 } },
    { data: { slug: 'max', status: 'completed', childCount: 1, roomCount: 1, roomTypes: ['Accessible Bathroom'], bedroomCount: 0, bathroomCount: 1, therapyRoomCount: 0 } },
    { data: { slug: 'marilyn', status: 'completed', childCount: 1, roomCount: 1, roomTypes: ['Chair Lift', 'Dream Bedroom', 'Accessible Bathroom'], bedroomCount: 1, bathroomCount: 0, therapyRoomCount: 0 } },
    { data: { slug: 'colin', status: 'in-progress', childCount: 1, roomCount: 1, roomTypes: ['Accessible Bathroom'], bedroomCount: 0, bathroomCount: 1, therapyRoomCount: 0 } },
    { data: { slug: 'axel', status: 'in-progress', childCount: 1, roomCount: 2, roomTypes: ['Dream Bedroom', 'Accessible Bathroom'], bedroomCount: 1, bathroomCount: 1, therapyRoomCount: 0 } },
    { data: { slug: 'jackson', status: 'needs-funding', childCount: 1, roomCount: 1, roomTypes: ['Therapy Room'], bedroomCount: 0, bathroomCount: 0, therapyRoomCount: 1 } },
  ];
  const community = [{ data: {} }, { data: {} }];
  globalThis.__kids = kids; globalThis.__community = community;
  const m = await tsModule('src/utils/stats.ts', (s) => s.replace(/import \{[^}]*\} from ['"]\.\/collections['"];?/, 'const getPublishedKids = async () => globalThis.__kids; const getPublishedCommunity = async () => globalThis.__community;'));
  const s = await m.getSiteStats();
  assert.equal(s.totalKids, 5, 'Sofia 3 (siblings count), Max, Marilyn: not Colin, Axel or Jackson');
  assert.equal(s.totalRooms, 5);
  assert.deepEqual([s.inWorksKids, s.inWorksRooms, s.inWorksMakeovers], [3, 4, 3]);
  assert.deepEqual(s.roomsByType, { 'Dream Bedroom': 4, 'Accessible Bathroom': 2, 'Chair Lift': 1 },
    'Sofia\'s three bedrooms are three; a kind listed with no count (Marilyn\'s bathroom) is one');
  assert.equal(s.communityProjects, 2);
  assert.equal('livesImpacted' in s, false, 'no sum of community figures');
  assert.equal(m.isFinished({}), true, 'no status is a finished makeover, as the schema\'s default');
  assert.equal(m.isFinished({ status: 'needs-funding' }), false);
});

test('Now Building: a typed date line shows only for the build it was typed for', async () => {
  const S = await import('../public/admin/site-config-shared.js');
  // Live on Nov 21 2026: typed for Dylan, whose reveal was Nov 18; the strip now shows Colin
  const live = { kidSlug: 'dylan-2026', dateText: 'Reveal November 18 at 4:00' };
  assert.equal(S.upNextDate(live, 'colin'), '');
  assert.equal(S.upNextDate(live, 'dylan-2026'), 'Reveal November 18 at 4:00');
  // Typed with the build picked automatically: saved with the build shown then (dateKid)
  assert.equal(S.upNextDate({ dateText: 'Reveal Dec 1', dateKid: 'colin' }, 'colin'), 'Reveal Dec 1');
  assert.equal(S.upNextDate({ dateText: 'Reveal Dec 1', dateKid: 'colin' }, 'peter'), '');
  assert.equal(S.upNextDate({ dateText: 'Reveal Dec 1', dateKid: 'colin', kidSlug: 'peter' }, 'colin'), 'Reveal Dec 1', 'the build it was typed for wins');
  // One from before either was saved: shows as it always did
  assert.equal(S.upNextDate({ dateText: 'Reveal soon' }, 'anyone'), 'Reveal soon');
  assert.equal(S.upNextDate({ dateText: '  ' }, 'colin'), '');
  assert.equal(S.upNextDate(null, 'colin'), '');
});

test('event sponsors: one each, however the name is written', async () => {
  const E = await import('../public/admin/events-shared.js');
  const k = E.sponsorKey;
  assert.equal(k({ name: 'Paul & Adro Nielsen' }), k({ name: 'Adro & Paul Nielsen' }));
  assert.equal(k({ name: 'Pella' }), k({ name: 'Pella, Inc.' }));
  assert.equal(k({ name: 'The Home Depot' }), k({ name: 'Home Depot' }));
  assert.notEqual(k({ name: 'Real Floors Inc.' }), k({ name: 'Real Floors Commercial' }), 'a different name stays a different sponsor');
  assert.notEqual(k({ logo: 'a.png' }), k({ logo: 'b.png' }), 'logos with no name count by their file');
  const tiers = [{ tier: 'Gold', names: [{ name: 'Paul & Adro Nielsen' }, { name: 'Pella' }] }, { tier: 'Silver', names: [{ name: 'Adro & Paul Nielsen' }, { name: 'Pella, Inc.' }, { name: 'STAG Partners' }] }];
  assert.equal(E.sponsorCount(tiers), 3);
});

test('the store\'s Google rating is read from its own page, never typed; nothing shown when it can\'t be read', async () => {
  const m = await tsModule('src/utils/store-rating.ts');
  const page = '<html><script type="application/ld+json">{"@type":"FurnitureStore","name":"Sunny & Ranney","aggregateRating":{"@type":"AggregateRating","ratingValue":5,"bestRating":5,"ratingCount":121}}</script></html>';
  assert.deepEqual(m.ratingFromHtml(page), { rating: 5, count: 121 });
  assert.deepEqual(m.ratingFromHtml('<script type="application/ld+json">[{"@graph":[{"aggregateRating":{"ratingValue":"4.9","reviewCount":"88"}}]}]</script>'), { rating: 4.9, count: 88 }, 'nested, as strings, reviewCount');
  assert.equal(m.ratingFromHtml('<p>Based on 121 reviews</p>'), null, 'only the page\'s own data, not its words');
  assert.equal(m.ratingFromHtml('<script type="application/ld+json">{"aggregateRating":{"ratingValue":7,"ratingCount":3}}</script>'), null, 'a rating past 5 isn\'t one');
  assert.equal(m.ratingFromHtml('<script type="application/ld+json">not json</script>'), null);
  assert.deepEqual(await m.storeRating(async () => new Response(page)), { rating: 5, count: 121 });
  const m2 = await tsModule('src/utils/store-rating.ts');
  assert.equal(await m2.storeRating(async () => { throw new Error('offline'); }), null);
  const m3 = await tsModule('src/utils/store-rating.ts');
  assert.equal(await m3.storeRating(async () => new Response('down', { status: 503 })), null);
});

test('partners: no category is no category (not Build)', () => {
  const src = readFileSync('src/content.config.ts', 'utf8');
  const block = src.slice(src.indexOf("level: z.enum(['signature', 'champion', 'builder', 'friend'])"));
  assert.match(block.slice(0, 900), /\(v\) => Array\.isArray\(v\) \? v : \(v \? \[v\] : \[\]\)/);
  assert.match(block.slice(0, 900), /\.default\(\[\]\)/);
});
