// The Theater's sponsor column: the cells' sizes and the partners' pages (src/utils/live-sponsors-show.ts), and the
// markup the server and the build draw for it (src/utils/live-sponsors-html.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = (entry) => import(`data:text/javascript,${encodeURIComponent(buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', packages: 'external' }).outputFiles[0].text)}`);
const { rowsOf, cellSizes, paginate, layoutFor, isWide, GAP } = await load('src/utils/live-sponsors-show.ts');
const { sponsorsInner } = await load('src/utils/live-sponsors-html.ts');

const W = true, N = false;
// Max's partners as they were on Nov 20 2026 (wide = too wide to read at half a row, at 1440x900's cells)
const MAX = [
  [N, N, N, N, W, W, W], // Signature: CR, MSI, Real Floors, Sherwin Williams, Randall Brothers, Walk Your Plans, Kids R Kids
  [N, W], //                 Champion: Cambria, Niki Murphy
  [W, W, W, W], //           Builder: Legacy, Top Knobs, Pulley, Nothing Bundt Cakes
  [N, W, N], //              Friends: Nationwide, ASV, Bin There Dump That
];
const LB = 15 + GAP.label;
const pageHeight = (tiers, page, h) => page.reduce((s, r, i) => {
  const rows = rowsOf(tiers[r.tier].slice(r.from, r.to));
  return s + (i ? GAP.section : 0) + LB + rows * h + (rows - 1) * GAP.cell;
}, 0);

test('rows: a wide logo a whole row, two square ones share one', () => {
  assert.equal(rowsOf([]), 0);
  assert.equal(rowsOf([N]), 1);
  assert.equal(rowsOf([N, N]), 1);
  assert.equal(rowsOf([N, W, N]), 2);
  assert.equal(rowsOf([W, W, N, N, N]), 4);
});

test('cell sizes: Max at 1440x900 (column 747px, four room sponsors) gets partner cells about 78px, twice the old ~40', () => {
  const rows = MAX.reduce((s, t) => s + rowsOf(t), 0);
  const s = cellSizes({ colH: 747, headH: 16, labelH: 15, k: 4, rows, tiers: 4 });
  assert.ok(s.h >= 70 && s.h <= 90, `h ${s.h}`);
  assert.ok(s.hr >= s.h, 'the room sponsors are never smaller than a partner');
  // (the room's four and one page of partners fill the column, never past it)
  const used = 16 + GAP.stack + LB + 4 * s.hr + 3 * GAP.cell + GAP.stack + LB + s.perPage * s.h + (s.perPage - 1) * GAP.cell;
  assert.ok(used <= 747, `used ${used}`);
});

test('cell sizes: one room sponsor gets the biggest cell, never past 132px; partners never past 104px', () => {
  const s = cellSizes({ colH: 964, headH: 16, labelH: 15, k: 1, rows: 10, tiers: 4 });
  assert.ok(s.hr > s.h && s.hr <= 132, `hr ${s.hr} h ${s.h}`);
  assert.ok(s.h <= 104);
  const big = cellSizes({ colH: 2000, headH: 16, labelH: 15, k: 1, rows: 3, tiers: 1 });
  assert.equal(big.h, 104);
  assert.equal(big.hr, 132);
});

test('cell sizes: a short laptop window still gets cells of at least 52px and two rows a page', () => {
  const s = cellSizes({ colH: 520, headH: 16, labelH: 15, k: 4, rows: 13, tiers: 4 });
  assert.ok(s.h >= 52, `h ${s.h}`);
  assert.ok(s.perPage >= 2);
});

test('cell sizes: no room sponsors, the partners take the column', () => {
  const s = cellSizes({ colH: 747, headH: 16, labelH: 15, k: 0, rows: 13, tiers: 4 });
  assert.equal(s.hr, 0);
  assert.ok(s.h >= 70);
});

test('cell sizes: a build whose partners all fit on one page at about that size is one still page', () => {
  const s = cellSizes({ colH: 900, headH: 16, labelH: 15, k: 1, rows: 3, tiers: 2 });
  assert.equal(s.perPage, 3);
});

test('pages: Max at 1440x900 in four pages, every one inside the showcase, every partner once and in order', () => {
  const h = 78, space = LB + 4 * h + 3 * GAP.cell;
  const pages = paginate(MAX, space, h, LB);
  assert.equal(pages.length, 4);
  for (const pg of pages) assert.ok(pageHeight(MAX, pg, h) <= space, `page ${JSON.stringify(pg)} ${pageHeight(MAX, pg, h)} > ${space}`);
  const seen = pages.flat().flatMap((r) => Array.from({ length: r.to - r.from }, (_, i) => `${r.tier}:${r.from + i}`));
  assert.deepEqual(seen, MAX.flatMap((t, ti) => t.map((_, i) => `${ti}:${i}`)));
  // (Signature too long for one page fills it and goes on; Champion joins its rest; Builder and Friends each whole)
  assert.deepEqual(pages.map((pg) => pg.map((r) => r.tier)), [[0], [0, 1], [2], [3]]);
});

test('pages: a tier that fits on a page of its own is never split across two', () => {
  const tiers = [[W, W, W], [W, W, W]];
  const h = 80, space = LB + 4 * h + 3 * GAP.cell;
  const pages = paginate(tiers, space, h, LB);
  assert.deepEqual(pages, [[{ tier: 0, from: 0, to: 3 }], [{ tier: 1, from: 0, to: 3 }]]);
});

test('pages: everything on one page when it fits; one row a page at the very least', () => {
  assert.equal(paginate([[N, N], [W]], 600, 80, LB).length, 1);
  const tiny = paginate([[W, W, W]], LB + 60, 80, LB);
  assert.equal(tiny.length, 3);
  assert.equal(paginate([], 600, 80, LB).length, 0);
});

test('pages: as even as they can be, never one full beside one nearly bare (Colin\'s twelve)', () => {
  // Signature 3 rows, Champion 1, Builder 2, Friends 2; a page holds 7 rows with one tier's name
  const COLIN = [[N, N, N, N, W], [N], [N, N, W], [W, W]];
  const h = 73, space = LB + 7 * h + 6 * GAP.cell;
  const pages = paginate(COLIN, space, h, LB);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((pg) => pg.map((r) => r.tier)), [[0, 1], [2, 3]]);
});

test('layout: Max at 1440x900, real logo shapes: four pages, cells about 78px, every page inside the showcase', () => {
  const ratios = [[1, 1.79, 0.6, 0.7, 3.66, 3.16, 2.41], [2.16, 2.56], [3.48, 2.96, 2.49, 2.81], [1.51, 2.52, 1.57]];
  const L = layoutFor({ colH: 747, colW: 258, headH: 16, labelH: 15, k: 4, ratios });
  assert.equal(L.pages.length, 4);
  assert.ok(L.h >= 74 && L.h <= 84, `h ${L.h}`);
  assert.ok(L.hr >= L.h);
  for (const pg of L.pages) assert.ok(pageHeight(L.wide, pg, L.h) <= L.space, `page over: ${JSON.stringify(pg)}`);
  // (the wordmarks a whole row, the square marks two to a row: CR, MSI, Real Floors, Sherwin Williams share rows;
  // Randall Brothers, Walk Your Plans and Kids R Kids, at 2.41 to 1 just past the line at this size, a row each)
  assert.deepEqual(L.wide[0], [false, false, false, false, true, true, true]);
  assert.equal(isWide(0, 78, 258), true, 'a logo not loaded yet is taken as wide');
});

test('layout: fewer partners get bigger cells, not emptier pages', () => {
  const colin = [[1.79, 1, 0.6, 2.41, 3.16], [2.16], [2.49, 2.96, 1.13], [3.38, 3.83]];
  const L = layoutFor({ colH: 747, colW: 258, headH: 16, labelH: 15, k: 1, ratios: colin });
  const base = cellSizes({ colH: 747, headH: 16, labelH: 15, k: 1, rows: 12, tiers: 4 });
  assert.ok(L.h > base.h, `grew from ${base.h} to ${L.h}`);
  assert.ok(L.h <= 104 && L.hr <= 132);
  for (const pg of L.pages) assert.ok(pageHeight(L.wide, pg, L.h) <= L.space);
});

test('markup: the room sponsors stand alone, the partners\' tiers go in the showcase, each tier named', () => {
  const html = sponsorsInner([
    { tier: 'room', list: [{ name: 'Detwiler Family Foundation', url: 'https://imagedelivery.net/x/partners/detwiler/public' }] },
    { tier: 'signature', list: [{ name: 'MSI', url: 'https://imagedelivery.net/x/partners/msi/public' }] },
    { tier: 'friend', list: [{ name: 'A & B', url: 'https://imagedelivery.net/x/partners/ab/public' }] },
  ]);
  assert.match(html, /^<p class="lsp-head">Built with help from<\/p><section class="lsp-tier lsp-tier--room" data-tier="room"/);
  assert.match(html, /<div class="lsp-show" data-lsp-show><section class="lsp-tier lsp-tier--signature" data-tier="signature"[^>]*><p class="lsp-label">Signature partner<\/p>/);
  assert.match(html, /<p class="lsp-label">Friend<\/p>/);
  assert.match(html, /alt="A &amp; B"/);
  // (only partners: no room tier, the showcase holds them; only a room sponsor: no showcase)
  assert.doesNotMatch(sponsorsInner([{ tier: 'builder', list: [{ name: 'X', url: 'https://imagedelivery.net/x/y/public' }] }]), /lsp-tier--room/);
  assert.doesNotMatch(sponsorsInner([{ tier: 'room', list: [{ name: 'X', url: 'https://imagedelivery.net/x/y/public' }] }]), /lsp-show/);
  assert.equal(sponsorsInner([]), '');
});
