/**
 * A kid page's Partners section by level (Peter, Nov 26 2026: "on the kids pages in the partners section can you
 * list it out by partner level"): partnerTiers in public/admin/partners-shared.js, which the page
 * (src/pages/kids/[slug].astro), its admin Preview (public/admin/kid-preview.js) and the Theater's sponsors column
 * (src/utils/live-sponsors-html.ts sponsorTiers) all sort with.
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { partnerTiers, tierTitle, logoMatcher, kidUsage, TIERS } from '../public/admin/partners-shared.js';

const load = (entry) => import(`data:text/javascript,${encodeURIComponent(buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', packages: 'external' }).outputFiles[0].text)}`);

const HASH = 'ROYFuPmfN2vPS6mt5sCkZQ';
const img = (id) => `https://imagedelivery.net/${HASH}/${id}/public`;

const PARTNERS = [
  { slug: 'detwiler-family-foundation', name: 'Detwiler Family Foundation', level: 'friend', logo: img('partners/detwiler-family-foundation/1794846186413'), website: 'https://detwiler.org' },
  { slug: 'construction-resources', name: 'Construction Resources', level: 'signature', order: 2, logo: img('partners/construction-resources'), website: 'https://constructionresources.com' },
  { slug: 'msi', name: 'MSI', level: 'signature', order: 1, logo: img('partners/msi'), website: 'javascript:alert(1)' },
  // Cambria's logo lives under a newer folder than the one kid pages copied ("cambria")
  { slug: 'cambria-black', name: 'Cambria', level: 'champion', logo: img('partners/cambria-black') },
  { slug: 'top-knobs', name: 'Top Knobs', level: 'builder', logo: img('partners/top-knobs'), website: 'http://topknobs.com' },
  { slug: 'asv-productions', name: 'ASV Productions', level: 'friend', logo: img('partners/asv-productions') },
  { slug: 'no-logo-family', name: 'The Smith Family', level: 'friend' },
];

test('a kid page lists its partners by level, the room sponsor first', () => {
  const logos = [
    { url: img('partners/asv-productions'), name: 'ASV' },
    { url: img('partners/top-knobs') },
    { url: img('partners/cambria/public-old') },
    { url: img('partners/construction-resources') },
    { url: img('partners/msi'), name: 'Msi' },
    { url: img('kids/max/partner-123-roswell-firelabs.png'), name: 'Roswell Firelabs' },
    { url: img('partners/detwiler-family-foundation/1794846186413'), name: 'Detwiler' },
  ];
  const tiers = partnerTiers(logos, ['detwiler-family-foundation'], PARTNERS);
  assert.deepEqual(tiers.map((g) => g.tier), ['room', 'signature', 'champion', 'builder', 'friend']);
  assert.deepEqual(tiers.map((g) => g.list.map((p) => p.name)), [
    ['Detwiler Family Foundation'],
    // the Partners page's order (order, then A to Z)
    ['MSI', 'Construction Resources'],
    ['Cambria'],
    ['Top Knobs'],
    // a logo with no partner record is a Friend, under the name it was given; Friends A to Z
    ['ASV Productions', 'Roswell Firelabs'],
  ]);
  // the room sponsor shows once, in its own tier, though its logo is on the page too
  assert.equal(tiers.flatMap((g) => g.list).filter((p) => p.slug === 'detwiler-family-foundation').length, 1);
});

test('a card links only to an http(s) website, and keeps the logo the kid page has', () => {
  const tiers = partnerTiers([{ url: img('partners/msi') }, { url: img('partners/top-knobs') }, { url: img('partners/cambria/x') }], [], PARTNERS);
  const all = tiers.flatMap((g) => g.list);
  assert.equal(all.find((p) => p.name === 'MSI').website, '');
  assert.equal(all.find((p) => p.name === 'Top Knobs').website, 'http://topknobs.com');
  assert.equal(all.find((p) => p.name === 'Cambria').url, img('partners/cambria/x'));
});

test('the same partner twice (two copies of its logo) shows once; a logo with no name goes last', () => {
  const tiers = partnerTiers([
    { url: img('kids/a/partner-1.png') },
    { url: img('partners/asv-productions') },
    { url: img('partners/asv-productions/1234') },
    { url: img('kids/a/partner-2.png'), name: 'Acme' },
  ], [], PARTNERS);
  assert.deepEqual(tiers, [{ tier: 'friend', list: [
    { name: 'Acme', url: img('kids/a/partner-2.png'), slug: '', website: '' },
    { name: 'ASV Productions', url: img('partners/asv-productions'), slug: 'asv-productions', website: '' },
    { name: '', url: img('kids/a/partner-1.png'), slug: '', website: '' },
  ] }]);
});

test('a room sponsor without a logo is still credited (url empty); unknown sponsors and empty logos are left out', () => {
  const tiers = partnerTiers([{ url: '' }, null], ['no-logo-family', 'not-a-partner'], PARTNERS);
  assert.deepEqual(tiers, [{ tier: 'room', list: [{ name: 'The Smith Family', url: '', slug: 'no-logo-family', website: '' }] }]);
  assert.deepEqual(partnerTiers(undefined, undefined, undefined), []);
});

test('tier titles', () => {
  assert.deepEqual(TIERS, ['room', 'signature', 'champion', 'builder', 'friend']);
  assert.equal(tierTitle('room', 1), 'Room sponsor');
  assert.equal(tierTitle('signature', 3), 'Signature partners');
  assert.equal(tierTitle('friend', 1), 'Friend');
  assert.equal(tierTitle('friend', 2), 'Friends');
});

test('logoMatcher is the rule kidUsage counts with', () => {
  const match = logoMatcher(PARTNERS);
  assert.equal(match(img('partners/cambria')), 'cambria-black');
  assert.equal(match(img('partners/msi')), 'msi');
  assert.equal(match(img('kids/max/partner-1.png')), null);
  const { byPartner } = kidUsage([{ slug: 'max', name: 'Max', partnerLogos: [{ url: img('partners/cambria') }] }], PARTNERS);
  assert.deepEqual([...byPartner.keys()], ['cambria-black']);
});

test("the Theater's sponsors column sorts the same way, logos only", async () => {
  const { sponsorTiers } = await load('src/utils/live-sponsors-html.ts');
  const tiers = sponsorTiers([{ url: img('partners/cambria/x') }, { url: img('partners/top-knobs') }], ['no-logo-family', 'construction-resources'], PARTNERS);
  assert.deepEqual(tiers, [
    { tier: 'room', list: [{ name: 'Construction Resources', url: img('partners/construction-resources') }] },
    { tier: 'champion', list: [{ name: 'Cambria', url: img('partners/cambria/x') }] },
    { tier: 'builder', list: [{ name: 'Top Knobs', url: img('partners/top-knobs') }] },
  ]);
});
