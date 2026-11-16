/**
 * Admin → Kids, a kid's design for their reveal: /api/reveal-design-admin
 * (what JobTread has for the kid) and the drawing helpers that take the
 * family's address off a sheet (public/admin/reveal-design-draw.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './lib/d1-shim.mjs';
import { onRequestGet, familyName, sortFiles } from '../functions/api/reveal-design-admin.js';
import { isAddressText, addressHit, wipeBoxes, findAddress, findTitleBlock, contentBox, keepBox, captionOf, plainWords, sheetTitle, kindFromSheet, coverRects, isDocumentName } from '../public/admin/reveal-design-draw.js';
import { addressWords, kindFromText, suggestBefores } from '../public/admin/reveal-design.js';

// ── The endpoint ──────────────────────────────────────────────────────

const DYLAN_JOB = '22PRvFGUC3WP';
const OTHER_JOB = '22PRvFFPZsEA';
const file = (id, name, type, tags, createdAt = '2026-07-01T16:00:00Z') => ({
  id, name, type, size: 1000, createdAt, url: `https://cdn.jobtread.com/f/${id}`, thumb: `https://cdn.jobtread.com/f/${id}?size=600`, big: `https://cdn.jobtread.com/f/${id}?size=2048`,
  fileTags: { nodes: tags.map((name) => ({ name })) },
});
const FILES = [
  file('PLANSET', 'Dylan 2026_Plan Set_09302026.pdf', 'application/pdf', ['Plans'], '2026-10-19T17:00:00Z'),
  file('WORKING', 'Dylan working plans.pdf', 'application/pdf', ['Plans'], '2026-09-01T17:00:00Z'),
  file('BOARD', 'Therapy room board.png', 'image/png', ['Design'], '2026-10-01T17:00:00Z'),
  file('EST', 'Estimate 1140.pdf', 'application/pdf', ['Costs']),
  file('B2', 'CompanyCam 2873182422', 'image/jpeg', ['Before'], '2026-07-01T16:25:00Z'),
  file('B1', 'CompanyCam 2873111820', 'image/jpeg', ['Before'], '2026-07-01T16:24:00Z'),
  file('PROG', 'IMG_0037.JPG', 'image/jpeg', ['During']),
  file('BPDF', 'before notes.pdf', 'application/pdf', ['Before']),
];

/** A fake JobTread: jobs (for finding the kid's), one job's details, its files in two pages */
function fakeJobTread({ jobs = [{ id: DYLAN_JOB, name: 'Dylan Hartwell (2026)' }, { id: OTHER_JOB, name: 'Max Daniel (2026)' }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const q = JSON.parse(init.body).query;
    calls.push(q);
    const reply = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (q.organization?.jobs) return reply({ organization: { jobs: { nodes: jobs.map((j) => ({ ...j, closedOn: null, customFieldValues: { nodes: [] } })), nextPage: null } } });
    const id = q.job?.$?.id;
    const job = jobs.find((j) => j.id === id);
    if (!job) return reply({ job: null });
    if (q.job.files) {
      const page = q.job.files.$.page;
      return reply({ job: { files: page ? { nodes: FILES.slice(4), nextPage: null } : { nodes: FILES.slice(0, 4), nextPage: 'p2' } } });
    }
    return reply({ job: {
      id: job.id, name: job.name,
      location: { street: '731 Juniper Hill Ln', city: 'Marietta', postalCode: '30064', account: { name: 'Dylan Hartwell' } },
      plans: { nodes: [{ name: 'EXISTING FLOOR PLAN', page: 2, file: { id: 'PLANSET' } }, { name: 'PROPOSED FLOOR PLAN', page: 3, file: { id: 'PLANSET' } }] },
    } });
  };
  return { fetchImpl, calls };
}

async function world() {
  const DB = await createD1({ schemaFiles: ['scripts/schema.sql'] });
  const add = (slug, data) => DB.prepare('INSERT INTO kids (slug, name, year, data) VALUES (?, ?, ?, ?)').bind(slug, data.name, data.year, JSON.stringify({ slug, ...data })).run();
  await add('dylan-2026', { name: 'Dylan', year: 2026, status: 'in-progress' });
  await add('max', { name: 'Max', year: 2026, status: 'in-progress' });
  return { DB, JOBTREAD_GRANT_KEY: 'grant' };
}
const get = async (env, qs, jt = fakeJobTread()) => {
  const res = await onRequestGet({ env, request: new Request(`https://x.test/api/reveal-design-admin?${qs}`) }, { fetchImpl: jt.fetchImpl });
  return { status: res.status, body: await res.json(), headers: res.headers, calls: jt.calls };
};

test('a kid’s job: drawings under a plans tag, before photos, the address and the sheet names', async () => {
  const env = await world();
  const { status, body, headers, calls } = await get(env, `kid=dylan-2026&job=${DYLAN_JOB}`);
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'private, no-store');
  assert.equal(body.job.id, DYLAN_JOB);
  // The job asked for is checked, not looked up among every job
  assert.ok(!calls.some((q) => q.organization?.jobs));
  // Plans first (the newest set first), then design boards; costs and photos from the build left out
  assert.deepEqual(body.drawings.map((d) => d.id), ['PLANSET', 'WORKING', 'BOARD']);
  assert.deepEqual(body.drawings[0].tags, ['Plans']);
  // Before photos in the order taken; a PDF tagged Before isn't a photo
  assert.deepEqual(body.befores.map((b) => b.id), ['B1', 'B2']);
  assert.ok(body.befores[0].big.includes('size=2048'));
  assert.deepEqual(body.address, { street: '731 Juniper Hill Ln', city: 'Marietta', zip: '30064', family: 'Hartwell' });
  assert.deepEqual(body.sheets, [{ fileId: 'PLANSET', page: 2, name: 'EXISTING FLOOR PLAN' }, { fileId: 'PLANSET', page: 3, name: 'PROPOSED FLOOR PLAN' }]);
});

test('another kid’s job is never used: the kid’s own is found instead', async () => {
  const env = await world();
  const { body, calls } = await get(env, `kid=dylan-2026&job=${OTHER_JOB}`);
  assert.equal(body.job.id, DYLAN_JOB);
  assert.ok(calls.some((q) => q.organization?.jobs), 'looked through every job');
});

test('no job: an answer the dialog can say plainly; bad input refused', async () => {
  const env = await world();
  const none = await get(env, 'kid=dylan-2026', fakeJobTread({ jobs: [{ id: OTHER_JOB, name: 'Max Daniel (2026)' }] }));
  assert.equal(none.status, 200);
  assert.equal(none.body.success, true);
  assert.equal(none.body.job, null);
  assert.deepEqual(none.body.drawings, []);
  assert.equal((await get(env, 'kid=../etc')).status, 400);
  assert.equal((await get(env, 'kid=dylan-2026&job=a b')).status, 400);
  assert.equal((await get(env, 'kid=nobody')).status, 404);
  const noKey = await onRequestGet({ env: { DB: env.DB }, request: new Request('https://x.test/api/reveal-design-admin?kid=dylan-2026') });
  assert.equal(noKey.status, 500);
});

test('JobTread failing comes back as an error the dialog shows, not a crash', async () => {
  const env = await world();
  const fetchImpl = async () => new Response('down', { status: 503 });
  const res = await onRequestGet({ env, request: new Request('https://x.test/api/reveal-design-admin?kid=dylan-2026') }, { fetchImpl });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /JobTread returned 503/);
});

test('the family’s name is the customer’s, not the kid’s', () => {
  assert.equal(familyName('Dylan Hartwell', 'Dylan'), 'Hartwell');
  assert.equal(familyName('Remi & Nico Smith (2025)', 'Remi and Nico'), 'Smith');
  assert.equal(familyName('', 'Dylan'), '');
  assert.equal(sortFiles([]).drawings.length, 0);
});

// ── Taking the address off a drawing ──────────────────────────────────

const WORDS = addressWords({ street: '731 Juniper Hill Ln', city: 'Marietta', zip: '30064', family: 'Hartwell' });

test('address words: the street, its number and name, city, zip, family', () => {
  assert.ok(WORDS.includes('731 juniper hill ln'));
  assert.ok(WORDS.includes('731'));
  assert.ok(WORDS.includes('juniper hill'));
  assert.ok(WORDS.includes('marietta'));
  assert.ok(WORDS.includes('30064'));
  assert.ok(WORDS.includes('hartwell'));
});

test('what gives the address away, and what doesn’t', () => {
  for (const t of ['731 JUNIPER HILL LN', '731 Juniper Hill Ln, Marietta GA 30064', 'HARTWELL RESIDENCE', 'JUNIPER', 'Marietta,', '30064']) assert.ok(isAddressText(t, WORDS), t);
  for (const t of ['PROPOSED FLOOR PLAN', 'HILL', 'ELEVATION VIEW', '7310', 'A1.0', 'BATH']) assert.ok(!isAddressText(t, WORDS), t);
  assert.equal(plainWords('Café — 731!'), 'cafe 731');
});

// pdf.js-like items in a flat (unrotated) page: viewport flips y; scale 2
const VT = [2, 0, 0, -2, 0, 1000];
const item = (str, x, y, size = 10, width = str.length * 6) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size });

test('wipe boxes: every word of an address line, and the address alone in a note', () => {
  const items = [
    item('PROPOSED FLOOR PLAN', 40, 450, 14),
    item('731', 300, 40), item('JUNIPER', 322, 40), item('HILL', 374, 40), item('LN', 402, 40), // one line, word by word
    item('Bath', 120, 300),
    item('Site: 731 Juniper Hill Ln', 40, 200),
  ];
  const boxes = wipeBoxes(items, VT, 2, WORDS);
  assert.equal(boxes.length, 5);
  // A box covers its letters: the "731" at x 300..318, baseline y 40 → canvas x 600..636, baseline 1000 - 80 = 920, letters above
  const b = boxes.find((bx) => Math.abs(bx[0][0] - 600) < 10);
  const xs = b.map((p) => p[0]); const ys = b.map((p) => p[1]);
  assert.ok(Math.min(...xs) < 600 && Math.max(...xs) > 636, 'covers the width');
  assert.ok(Math.min(...ys) < 900 && Math.max(...ys) > 920, 'covers the height, above and below the baseline');
});

test('wipe boxes: a rotated title block line still matches as a line', () => {
  // Text running up the page (90°): each word's transform rotated
  const up = (str, y) => ({ str, transform: [0, 10, -10, 0, 580, y], width: str.length * 6, height: 10 });
  const boxes = wipeBoxes([up('426', 100), up('Juniper Hill', 122), up('Ln', 205)], VT, 2, WORDS);
  assert.equal(boxes.length, 3);
});

/** Pixels: white, with dark lines drawn in */
function sheet(w, h, draw) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  const px = (x, y, v = 0) => { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; };
  draw(px);
  return d;
}

test('title block: a rule across the bottom fifth, or down the right third, with writing beyond it', () => {
  const w = 200, h = 100;
  // Writing in the block: a few dark marks below the rule
  const bottom = sheet(w, h, (px) => { for (let x = 0; x < w; x++) px(x, 85); for (let x = 30; x < 90; x++) px(x, 90); for (let x = 30; x < 60; x++) px(x, 40); });
  assert.deepEqual(findTitleBlock(bottom, w, h), { bottom: 85, right: null });
  const right = sheet(w, h, (px) => { for (let y = 0; y < h; y++) px(170, y); for (let y = 20; y < 60; y++) px(180, y); });
  assert.deepEqual(findTitleBlock(right, w, h), { bottom: null, right: 170 });
});

test('title block: a sheet’s own border is never one (QA: a scan’s border 3% from the edge was cut as a block)', () => {
  const w = 400, h = 300;
  // A border inset 3%, with drawing inside, and nothing past it
  const inset = sheet(w, h, (px) => {
    const [x0, x1, y0, y1] = [12, w - 13, 9, h - 10];
    for (let x = x0; x <= x1; x++) { px(x, y0); px(x, y1); }
    for (let y = y0; y <= y1; y++) { px(x0, y); px(x1, y); }
    for (let x = 60; x < 200; x++) for (let y = 60; y < 64; y++) px(x, y);
  });
  assert.deepEqual(findTitleBlock(inset, w, h), { bottom: null, right: null });
  // A thick rule at 88% with nothing under it isn't a block either (its own thickness isn't writing)
  const thick = sheet(w, h, (px) => { for (let y = 262; y < 270; y++) for (let x = 0; x < w; x++) px(x, y); });
  assert.deepEqual(findTitleBlock(thick, w, h), { bottom: null, right: null });
  assert.equal(keepBox(thick, w, h).titleBlock, false);
});

test('keep box: above the title block, trimmed to what’s drawn', () => {
  const w = 200, h = 100;
  const d = sheet(w, h, (px) => { for (let x = 0; x < w; x++) px(x, 85); for (let x = 50; x < 150; x++) for (let y = 20; y < 60; y++) px(x, y, 40); for (let x = 20; x < 120; x++) px(x, 90); });
  const k = keepBox(d, w, h);
  assert.equal(k.titleBlock, true);
  assert.ok(k.y + k.h <= 84, 'stops above the rule');
  assert.ok(k.x >= 46 && k.x <= 50 && k.x + k.w >= 150 && k.x + k.w <= 154, `trimmed sides ${k.x}..${k.x + k.w}`);
  const blank = contentBox(new Uint8ClampedArray(40 * 40 * 4).fill(255), 40, 40);
  assert.deepEqual(blank, { x: 0, y: 0, w: 40, h: 40 });
});

test('sheet names read as captions; kinds from sheet names', () => {
  assert.equal(captionOf('PROPOSED FLOOR PLAN'), 'Proposed floor plan');
  assert.equal(captionOf('A1.2 - Existing Plan'), 'Existing Plan');
  assert.equal(captionOf('Therapy_room_board.png'), 'Therapy room board');
  assert.equal(kindFromText('EXISTING FLOOR PLAN'), 'as-built');
  assert.equal(kindFromText('PROPOSED FLOOR PLAN'), 'proposed');
  assert.equal(kindFromText('Bathroom Design Board'), 'board');
  assert.equal(kindFromText('ELECTRICAL PLAN'), null);
  assert.deepEqual(suggestBefores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 6), [1, 3, 5, 8, 10, 12]);
});

test('letters set one at a time or spaced out still give the address away (QA: "M A R I E T T A ,  G A   3 0 0 6 4")', () => {
  assert.equal(addressHit('M A R I E T T A ,  G A   3 0 0 6 4', WORDS), 'marietta');
  assert.equal(addressHit('7 3 1   J U N I P E R   H I L L   L N', WORDS), '731 juniper hill ln');
  assert.equal(addressHit('3 0 0 6 4', WORDS), '30064');
  // A number only as itself
  assert.equal(addressHit('1 3 0 0 6 4 9', WORDS), null);
  assert.equal(addressHit('PROJECT 300645', WORDS), null);
  // CAD letters, one item each, on one line: the line is found, and every letter is painted out
  const letters = [...'731JUNIPERHILLLN'].map((ch, i) => item(ch, 300 + i * 7, 60, 10, 6));
  const { boxes, hits } = findAddress(letters, VT, 2, WORDS);
  assert.equal(boxes.length, letters.length);
  assert.ok(hits.has('731 juniper hill ln'));
});

test('found: which address words were found, so a sheet counts as wiped only when its street was', () => {
  const { hits } = findAddress([item('HARTWELL RESIDENCE', 40, 40), item('MARIETTA GEORGIA', 40, 30)], VT, 2, WORDS);
  assert.deepEqual([...hits].sort(), ['hartwell', 'marietta']);
  const street = new Set(addressWords({ street: '731 Juniper Hill Ln' }));
  assert.ok(![...hits].some((w) => street.has(w)), 'no street word: not wiped');
});

// A designer's set with no JobTread sheet names (QA round 1, case 4)
const pageItems = (title, lines = [], rooms = []) => [
  item(title, 40, 560, 16, title.length * 9),
  ...rooms.map((r, i) => item(r, 120 + i * 220, 320, 14, r.length * 8)),
  ...lines.map((t, i) => item(t, 60, 500 - i * 18, 10, t.length * 5.5)),
];
const kindOf = (items, sheet = '') => kindFromSheet({ sheet, title: sheetTitle(items, VT, 2, WORDS), body: items.map((i) => i.str).join(' ') }, kindFromText);

test('sheets are sorted by their titles: cover, notes, elevations and trade plans are never the reveal’s', () => {
  const cover = pageItems('A0.0 COVER SHEET', ['SCOPE OF WORK: CONVERT EXISTING BEDROOM INTO ACCESSIBLE THERAPY ROOM.', 'SHEET INDEX', 'A0.0 COVER SHEET', 'A1.0 EXISTING FLOOR PLAN', 'A2.0 PROPOSED FLOOR PLAN', 'E1.0 ELECTRICAL PLAN']);
  assert.equal(kindOf(cover).kind, null);
  assert.equal(kindOf(pageItems('G0.1 GENERAL NOTES', ['1. CONTRACTOR TO VERIFY ALL EXISTING CONDITIONS PRIOR TO START.'])).kind, null);
  const existing = kindOf(pageItems('A1.0 EXISTING FLOOR PLAN', [], ['BEDROOM', 'BATH']));
  assert.deepEqual([existing.kind, captionOf(existing.title)], ['as-built', 'Existing floor plan']);
  const proposed = kindOf(pageItems('A2.0 PROPOSED FLOOR PLAN', [], ['THERAPY', 'BATH']));
  assert.deepEqual([proposed.kind, captionOf(proposed.title)], ['proposed', 'Proposed floor plan']);
  assert.equal(kindOf(pageItems('E1.0 ELECTRICAL PLAN', ['NOTE: REMOVE EXISTING RECEPTACLES, SEE FLOOR PLAN'])).kind, null);
  assert.equal(kindOf(pageItems('A3.0 INTERIOR ELEVATIONS', ['3D PERSPECTIVE - LOOKING NORTH'])).kind, null);
  // A small title in the title block, under a bigger room name, still counts
  const small = [item('THERAPY', 200, 320, 20, 90), item('A1.0 EXISTING FLOOR PLAN', 560, 40, 9, 120)];
  assert.equal(kindOf(small).kind, 'as-built');
  // JobTread's sheet name comes first
  assert.equal(kindOf(pageItems('SHEET 3'), 'PROPOSED FLOOR PLAN').kind, 'proposed');
  assert.equal(kindOf(pageItems('PROPOSED FLOOR PLAN'), 'COVER').kind, null);
  // With no title to go by, only an exact name for a kind in the words
  assert.equal(kindOf([item('see existing floor plan for dimensions', 60, 300, 10, 200)]).kind, 'as-built');
  assert.equal(kindOf([item('verify existing conditions', 60, 300, 10, 200)]).kind, null);
});

// Max's real plan set (Nov 10 2026): what the import got wrong, and Dylan's had the same contents page
test('a contents page isn’t the as-built; a "ceiling height" note doesn’t throw out the floor plan; "PROPOSED V1" is a proposed plan', () => {
  const contents = [item('TABLE OF CONTENTS', 60, 560, 18, 170), item('1 PROJECT SUMMARY', 60, 520, 12, 130), item('2 EXISTING LAYOUT', 60, 500, 12, 130), item('3 DIMENTIONED PROPOSED LAYOUT', 60, 480, 12, 200), item('5 ELECTRICAL PLAN', 60, 460, 12, 130)];
  assert.equal(kindOf(contents).kind, null, 'the contents page lists the sheets; it is none of them');
  const existing = [item('*CEILING HEIGHT: 8 FT*', 300, 560, 16, 170), item('EXISTING LAYOUT', 60, 540, 16, 140), item('BATH', 200, 320, 10, 40)];
  assert.equal(kindOf(existing).kind, 'as-built');
  assert.equal(kindOf(pageItems('RCP-1 REFLECTED CEILING PLAN')).kind, null, 'a real ceiling plan is still a trade plan');
  assert.equal(kindOf(pageItems('A3 CEILING PLAN')).kind, null);
  assert.equal(kindOf(pageItems('DIMENTIONED PROPOSED LAYOUT')).kind, 'proposed');
  assert.equal(kindOf(pageItems('PROPOSED V1')).kind, 'proposed');
  assert.equal(kindOf(pageItems('DIMENSIONED EXISTING PLAN')).kind, 'as-built');
  assert.equal(kindOf(pageItems('PROPOSED LAYOUT DETAILS')).kind, null, 'details stay out');
  assert.equal(kindOf([item('Remove existing outlet here', 60, 560, 16, 200), item('ELECTRICAL PLAN', 60, 540, 16, 140)]).kind, null);
});

test('a document by its name is never guessed to be a drawing', () => {
  for (const n of ['Max 2026_Scope of Work.pdf', 'Max 2026_Project Summary Letter_notes.pdf', "Max's Resume.pdf", 'Max_2026 Countertop Template.pdf', 'W9.pdf', 'COI 2026.pdf']) assert.ok(isDocumentName(n), n);
  for (const n of ['Max 2026_Plan Set_08172026.pdf', 'Max 2026_Existing & Proposed.pdf', 'Max 2026_Proposed.pdf', 'Max 2026_Design Board.png', 'Max 2026_Signed Final Layout.pdf', 'Dylan 2026_Plan Set_09302026.pdf']) assert.ok(!isDocumentName(n), n);
});

test('captions lose sheet numbers', () => {
  assert.equal(captionOf('A1.0 EXISTING FLOOR PLAN'), 'Existing floor plan');
  assert.equal(captionOf('A2.0 - Proposed Floor Plan'), 'Proposed Floor Plan');
  assert.equal(captionOf('E1.0 ELECTRICAL PLAN'), 'Electrical plan');
  assert.equal(captionOf('2 EXISTING LAYOUT'), 'Existing layout');
  assert.equal(captionOf('3. DIMENTIONED PROPOSED LAYOUT'), 'Dimentioned proposed layout');
  assert.equal(captionOf('2026 Bathroom board'), '2026 Bathroom board', 'a year is not a sheet number');
});

test('covered areas: kept inside the picture, in pixels; a speck is dropped', () => {
  assert.deepEqual(coverRects([{ x: 0.5, y: 0.5, w: 0.25, h: 0.1 }], 400, 200), [{ x: 200, y: 100, w: 100, h: 20 }]);
  assert.deepEqual(coverRects([{ x: 0.9, y: -0.1, w: 0.3, h: 0.3 }], 100, 100), [{ x: 90, y: 0, w: 10, h: 20 }]);
  assert.deepEqual(coverRects([{ x: 0.5, y: 0.5, w: 0.001, h: 0.2 }], 100, 100), []);
});

test('keep box: inside the sheet’s border, cropped to the drawing (a legend box and a note set apart are left out)', () => {
  const w = 400, h = 300;
  const d = sheet(w, h, (px) => {
    // The sheet's border
    for (let x = 10; x < w - 10; x++) { px(x, 10); px(x, 11); px(x, h - 11); px(x, h - 12); }
    for (let y = 10; y < h - 10; y++) { px(10, y); px(11, y); px(w - 11, y); px(w - 12, y); }
    // A legend box top left
    for (let x = 20; x < 70; x++) { px(x, 20); px(x, 40); }
    for (let y = 20; y < 41; y++) { px(20, y); px(69, y); }
    // The floor plan: walls in the middle, with a label beside it
    for (let x = 150; x < 260; x++) { px(x, 120); px(x, 200); }
    for (let y = 120; y < 201; y++) { px(150, y); px(259, y); px(200, y); }
    for (let x = 265; x < 280; x++) px(x, 160);
    // A note bottom right
    for (let x = 330; x < 380; x++) px(x, 270);
  });
  const k = keepBox(d, w, h);
  assert.ok(k.x > 120 && k.x < 150, `left edge near the plan, not the border or legend: ${k.x}`);
  assert.ok(k.y > 95 && k.y < 120, `top near the plan: ${k.y}`);
  assert.ok(k.x + k.w > 280 && k.x + k.w < 320, `right takes the label beside it, not the note: ${k.x + k.w}`);
  assert.ok(k.y + k.h > 200 && k.y + k.h < 240, `bottom near the plan: ${k.y + k.h}`);
});

test('keep box: a board of several pictures stays whole', () => {
  const w = 400, h = 300;
  const d = sheet(w, h, (px) => {
    for (const [x0, y0] of [[30, 30], [220, 30], [30, 170], [220, 170]]) for (let x = x0; x < x0 + 140; x++) for (let y = y0; y < y0 + 100; y++) px(x, y, 90);
  });
  const k = keepBox(d, w, h);
  assert.ok(k.x <= 30 && k.y <= 30 && k.x + k.w >= 360 && k.y + k.h >= 270, JSON.stringify(k));
});

// ── Whole sheets (Peter, Nov 16 2026: "is there a way to make this look more like an official plan set") ──
import { restOfLine, isContactText, findContact, relabelLines, cellOf, drawingFocus, keptSpan } from '../public/admin/reveal-design-draw.js';
import { isTrimmed, isSheet, sheetFocus, needsTitleCrop, revealSlides } from '../public/admin/reveal-design.js';
import { isFloorPlan } from '../public/admin/kids-shared.js';

// A made-up family and street (the repo is public: never a real one)
const FAKE = addressWords({ street: '731 Juniper Hill Ln', city: 'Roswell', zip: '30075', family: 'Hartwell' });

test('the address line written back without the address: what’s left, never the address, nothing when only where was said', () => {
  assert.equal(restOfLine('DYLAN 2026: 731 JUNIPER HILL LN', FAKE), 'DYLAN 2026');
  assert.equal(restOfLine('DYLAN 2026 - 731 Juniper Hill Lane', FAKE), 'DYLAN 2026');
  assert.equal(restOfLine('DYLAN 2026: 731 JUNIPER HILL LN, ROSWELL, GA 30075', FAKE), 'DYLAN 2026');
  assert.equal(restOfLine('ADDRESS: 731 Juniper Hill Ln', FAKE), '');
  assert.equal(restOfLine('Site: 731 Juniper Hill Ln', FAKE), '');
  assert.equal(restOfLine('HARTWELL RESIDENCE', FAKE), '');
  assert.equal(restOfLine('CLIENT: Dylan Hartwell', FAKE), 'CLIENT: Dylan');
  // Spaced out, or only part of it found: nothing that still gives it away is ever written back
  assert.equal(restOfLine('7 3 1 J U N I P E R H I L L L N', FAKE), '');
  assert.equal(restOfLine('JUNIPERHILL 731', FAKE), '');
});

test('phone numbers and email addresses are painted out too; dimensions, scales and dates are not', () => {
  for (const s of ['(770) 555-0123', '770.555.0123', '770-555-0123', '+1 770 555 0123', 'CALL 7705550123', 'jo@example.com']) assert.ok(isContactText(s), s);
  for (const s of ['152 1/2"', 'SCALE: 1/2" = 1\'-0"', 'DATE: September 30, 2026', 'A-2', '129 1/2"', 'SHEET 2 OF 7']) assert.ok(!isContactText(s), s);
  // One item, or a number split across a line's items
  assert.equal(findContact([item('DESIGNER: (770) 555-0123', 40, 40)], VT, 2).length, 1);
  assert.equal(findContact([item('(770)', 40, 40, 10, 30), item('555-0123', 74, 40, 10, 48), item('EXISTING LAYOUT', 400, 40)], VT, 2).length, 2);
});

test('the lines the address was on, upright ones, with what goes back and where', () => {
  const lines = relabelLines([item('DYLAN 2026: 731 JUNIPER HILL LN', 300, 50), item('EXISTING LAYOUT', 100, 50, 10, 90), item('**CEILING HEIGHT 8 FT', 300, 300)], VT, 2, FAKE);
  assert.equal(lines.length, 1);
  const [l] = lines;
  assert.equal(l.text, 'DYLAN 2026');
  assert.equal(l.size, 20);
  assert.equal(l.baseline, 900);
  assert.ok(l.x0 < 600 && l.x1 > 600 + 31 * 6 * 2 - 10 && l.y0 < 880 && l.y1 > 900, JSON.stringify(l));
  // Only the address: painted out, nothing written back. Running up the page: painted out, not written back
  assert.deepEqual(relabelLines([item('ADDRESS: 731 Juniper Hill Ln', 300, 50)], VT, 2, FAKE), []);
  const up = { str: 'DYLAN 2026: 731 JUNIPER HILL LN', transform: [0, 10, -10, 0, 580, 100], width: 186, height: 10 };
  assert.deepEqual(relabelLines([up], VT, 2, FAKE), []);
});

test('written back in the middle of its title block cell (the rules either side), else where it was', () => {
  const w = 400, h = 100;
  const d = sheet(w, h, (px) => { for (let y = 70; y < 98; y++) { px(150, y); px(330, y); } });
  const l = { x0: 170, x1: 300, y0: 78, y1: 92, size: 10 };
  const c = cellOf(d, w, h, l);
  assert.equal(c.mid, 240);
  assert.ok(c.room > 150 && c.room < 180);
  const open = cellOf(sheet(w, h, () => {}), w, h, l);
  assert.equal(open.mid, 235);
});

test('a whole sheet’s drawing: found inside its border, above its title block, as fractions of the sheet', () => {
  const w = 400, h = 260;
  const d = sheet(w, h, (px) => {
    for (let x = 8; x < w - 8; x++) { px(x, 8); px(x, h - 9); px(x, 220); }
    for (let y = 8; y < h - 8; y++) { px(8, y); px(w - 9, y); }
    // The title block's writing, and a drawing in the middle
    for (let x = 30; x < 120; x++) px(x, 240);
    for (let x = 150; x < 260; x++) for (let y = 70; y < 160; y += 1) if (x === 150 || x === 259 || y === 70 || y === 159) px(x, y);
  });
  const f = drawingFocus(d, w, h);
  assert.ok(f.x > 0.34 && f.x < 0.38 && f.y > 0.24 && f.y < 0.28, JSON.stringify(f));
  assert.ok(f.x + f.w > 0.64 && f.x + f.w < 0.68 && f.y + f.h > 0.6 && f.y + f.h < 0.64, JSON.stringify(f));
});

test('a whole sheet is never cut anywhere it shows, and says where its drawing is', () => {
  const url = 'https://imagedelivery.net/HASH/kids/remy/plan-1-ab12-existing-layout-sheet.png/public';
  const sheetPlan = { url, label: 'Existing layout', type: 'as-built', addressCheck: 'wiped', w: 3200, h: 2071, focus: { x: 0.3, y: 0.15, w: 0.36, h: 0.5 } };
  assert.ok(isTrimmed(url) && isSheet(url));
  assert.ok(isTrimmed(url.replace('-sheet', '-notitle')) && !isSheet(url.replace('-sheet', '-notitle')));
  assert.equal(needsTitleCrop(sheetPlan), false);
  assert.equal(isFloorPlan(sheetPlan), false, 'the kid page crops nothing off it');
  assert.deepEqual(sheetFocus(sheetPlan), sheetPlan.focus);
  // Only a whole sheet's, and only a real place on it
  assert.equal(sheetFocus({ ...sheetPlan, url: url.replace('-sheet', '-notitle') }), null);
  for (const focus of [null, { x: 0.3, y: 0.1, w: 0.8, h: 0.5 }, { x: -0.1, y: 0, w: 0.5, h: 0.5 }, { x: 0.3, y: 0.1, w: 0.01, h: 0.5 }, { x: 0.3, y: 0.1, w: '0.4', h: 0.5 }]) {
    assert.equal(sheetFocus({ ...sheetPlan, focus }), null, JSON.stringify(focus));
  }
  const slides = revealSlides({ name: 'Remy', plans: [sheetPlan, { ...sheetPlan, url: url.replace('existing-layout-sheet', 'proposed-layout-notitle'), type: 'proposed', focus: undefined }] });
  assert.deepEqual(slides.map((s) => [s.kind, s.crop, s.focus || null]), [['as-built', false, sheetPlan.focus], ['proposed', false, null]]);
});

test('the address line’s own letters that stay are found by its spaces: the widest gaps, each wider than any inside a word', () => {
  // Letters as runs of ink on a 20-row band: [start, width] each, a space after a word
  const band = (runs, w = 400, h = 20) => sheet(w, h, (px) => { for (const [x, wd] of runs) for (let x2 = x; x2 < x + wd; x2++) for (let y = 4; y < 16; y++) px(x2, y); });
  // "DYLAN 2026: 731 JUNIPER": D Y L A N | 2 0 2 6 : | 7 3 1 (a "1" with room either side) | J U N I P E R
  const runs = [];
  let x = 4;
  const word = (letters, gapsInside = 2, last = 9) => { letters.forEach((wd, i) => { runs.push([x, wd]); x += wd + (i < letters.length - 1 ? gapsInside : last); }); };
  word([10, 10, 8, 10, 10]);
  word([9, 9, 9, 9, 3], 2, 8);
  runs.push([x, 9]); x += 11; runs.push([x, 9]); x += 15; runs.push([x, 4]); x += 4 + 8;
  word([8, 10, 10, 4, 9, 9, 10]);
  const d = band(runs);
  const k = keptSpan(d, 400, 20, 'DYLAN 2026: 731 JUNIPER', 'DYLAN 2026', 20);
  assert.equal(k.x0, 4, 'from the D');
  assert.equal(k.x1, runs[8][0] + runs[8][1] - 1, 'to the 6, the colon left off');
  // Words that can't be told apart (one space no wider than a gap in a word): typed instead
  assert.equal(keptSpan(band([[4, 10], [16, 10], [32, 10], [48, 10]]), 400, 20, 'AB CD', 'AB', 20), null);
  // A rest that isn't the line's own words in order: typed instead
  assert.equal(keptSpan(d, 400, 20, 'DYLAN 2026: 731 JUNIPER', 'THERAPY ROOM', 20), null);
});

