/**
 * functions/api/_image-types.js: imageSize reads a picture's size from its header (the Advisory Board
 * application's headshot is checked by it on the server), on real files sharp makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { imageSize, imageKind, checkImage, imageWhole } from '../functions/api/_image-types.js';

const W = 1234;
const H = 567;
const solid = (channels = 3) => sharp({ create: { width: W, height: H, channels, background: channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0.5 } : { r: 200, g: 100, b: 50 } } });
const bytes = async (img) => new Uint8Array(await img.toBuffer());

test('a JPEG: baseline, progressive, and with EXIF in front of its frame', async () => {
  assert.deepEqual(imageSize(await bytes(solid().jpeg())), { width: W, height: H });
  assert.deepEqual(imageSize(await bytes(solid().jpeg({ progressive: true }))), { width: W, height: H });
  // An orientation tag is reported as stored, not as shown (the page draws a headshot upright before it's sent)
  assert.deepEqual(imageSize(await bytes(solid().withMetadata({ orientation: 6 }).jpeg())), { width: W, height: H });
});

test('a PNG, and WebP of each kind (lossy, lossless, and with see-through)', async () => {
  assert.deepEqual(imageSize(await bytes(solid().png())), { width: W, height: H });
  assert.deepEqual(imageSize(await bytes(solid().webp())), { width: W, height: H });
  assert.deepEqual(imageSize(await bytes(solid().webp({ lossless: true }))), { width: W, height: H });
  assert.deepEqual(imageSize(await bytes(solid(4).webp())), { width: W, height: H });
});

test('the largest sizes the formats hold come through whole', async () => {
  const tall = await bytes(sharp({ create: { width: 3, height: 16383, channels: 3, background: '#fff' } }).webp({ lossless: true }));
  assert.deepEqual(imageSize(tall), { width: 3, height: 16383 });
  const wide = await bytes(sharp({ create: { width: 9000, height: 2, channels: 3, background: '#fff' } }).jpeg());
  assert.deepEqual(imageSize(wide), { width: 9000, height: 2 });
});

test('anything else, or a header cut short, is null (never a guess)', async () => {
  const jpeg = await bytes(solid().jpeg());
  assert.equal(imageSize(jpeg.subarray(0, 20)), null, 'cut before the frame');
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
  assert.equal(imageSize(new Uint8Array(0)), null);
  assert.equal(imageSize(await bytes(solid().gif())), null, 'a GIF isn’t read');
  // A JPEG whose markers run into the picture's data before any frame
  const broken = new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0, 0]);
  assert.equal(imageSize(broken), null);
  // Garbage after the start, not at a marker
  assert.equal(imageSize(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0, 0, 0x12, 0x34, 0, 0, 0, 0])), null);
});

test('imageKind and checkImage are as they were', async () => {
  assert.equal(imageKind(await bytes(solid().jpeg())), 'jpeg');
  assert.deepEqual(checkImage(await bytes(solid().png()), 'image/png'), { ok: true, kind: 'png', type: 'image/png' });
  assert.equal(checkImage(await bytes(solid().png()), 'image/jpeg').ok, false, 'a PNG said to be a JPEG');
});

test('imageWhole: a whole JPEG, PNG or WebP is whole; one cut off partway isn’t (its header alone says nothing)', async () => {
  for (const img of [solid().jpeg(), solid().jpeg({ progressive: true }), solid().png(), solid().webp(), solid().webp({ lossless: true })]) {
    const b = await bytes(img);
    assert.equal(imageWhole(b), true);
    for (const cut of [0.3, 0.7, 0.99]) assert.equal(imageWhole(b.subarray(0, Math.floor(b.length * cut))), false, `cut at ${cut}`);
  }
  // A camera's extra data after the end (some phones add it) is still a whole picture
  const jpg = await bytes(solid().jpeg());
  assert.equal(imageWhole(new Uint8Array([...jpg, 0x53, 0x45, 0x46, 0x54, 1, 2, 3, 4])), true);
  // A header claiming a size, and nothing else
  assert.equal(imageWhole(new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0, 17, 8, 3, 0xE8, 3, 0xE8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9])), false);
  assert.equal(imageWhole(new TextEncoder().encode('not a picture')), true, 'other kinds aren’t judged here');
});

test('imageWhole: an iPhone photo (HEIC, made by macOS) and an AVIF are whole; cut off partway, they aren’t', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const avif = await bytes(solid().avif());
  assert.equal(imageWhole(avif), true, 'AVIF whole');
  for (const cut of [0.3, 0.7, 0.99]) assert.equal(imageWhole(avif.subarray(0, Math.floor(avif.length * cut))), false, `AVIF cut at ${cut}`);
  const dir = mkdtempSync(join(tmpdir(), 'heic-'));
  try {
    writeFileSync(join(dir, 'a.png'), await solid().png().toBuffer());
    try { execFileSync('sips', ['-s', 'format', 'heic', join(dir, 'a.png'), '--out', join(dir, 'a.heic')], { stdio: 'ignore' }); } catch { t.skip('no sips here (not macOS)'); return; }
    const heic = new Uint8Array(readFileSync(join(dir, 'a.heic')));
    assert.equal(imageKind(heic), 'heic');
    assert.equal(imageWhole(heic), true, 'HEIC whole');
    for (const cut of [0.3, 0.7, 0.99]) assert.equal(imageWhole(heic.subarray(0, Math.floor(heic.length * cut))), false, `HEIC cut at ${cut}`);
    assert.equal(imageWhole(heic.subarray(0, heic.length - 1)), false, 'one byte short');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('imageWhole: a GIF needs its trailer; a PNG needs picture data; a WebP needs its picture, not only its header', async () => {
  const gif = await bytes(solid().gif());
  assert.equal(imageWhole(gif), true);
  assert.equal(imageWhole(gif.subarray(0, gif.length - 1)), false, 'GIF without its trailer');
  assert.equal(imageWhole(gif.subarray(0, Math.floor(gif.length / 2))), false, 'GIF cut in half');
  // A PNG with its header and end, nothing between (no IDAT)
  const png = await bytes(solid().png());
  const ihdrEnd = 8 + 12 + 13; // signature, then IHDR's length, type, 13 bytes and CRC
  const iend = png.subarray(png.length - 12);
  assert.equal(imageWhole(new Uint8Array([...png.subarray(0, ihdrEnd), ...iend])), false, 'PNG with no picture data');
  // A WebP whose RIFF length is right but holds only the extended header (VP8X), no picture chunk
  const vp8x = new Uint8Array([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0xD1, 0x04, 0, 0x36, 0x02, 0]);
  const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4 + vp8x.length, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...vp8x]);
  assert.equal(imageSize(riff)?.width, W, 'its header alone says a size');
  assert.equal(imageWhole(riff), false, 'and it isn’t a picture');
  // A WebP with the see-through kind (VP8X + ALPH + VP8) is whole
  assert.equal(imageWhole(await bytes(solid(4).webp())), true);
});

test('imageWhole: a GIF walked to its trailer: cut anywhere it isn’t whole (even ending on a 3B byte); bytes after the trailer are fine', async () => {
  const gif = await bytes(sharp({ create: { width: 300, height: 300, channels: 3, background: '#c4aa8c' } }).composite([{ input: await sharp({ create: { width: 120, height: 90, channels: 3, background: '#2a6' } }).png().toBuffer(), top: 40, left: 60 }]).gif());
  assert.equal(imageWhole(gif), true);
  for (let cut = 20; cut < gif.length - 1; cut += Math.max(1, Math.floor(gif.length / 40))) assert.equal(imageWhole(gif.subarray(0, cut)), false, `cut at ${cut}`);
  // Cut just after a 3B byte inside the picture's data: still not whole
  const at = gif.findIndex((x, k) => x === 0x3B && k > 40 && k < gif.length - 2);
  if (at > 0) assert.equal(imageWhole(gif.subarray(0, at + 1)), false, 'ends on a 3B byte, but partway');
  assert.equal(imageWhole(new Uint8Array([...gif, 0, 0])), true, 'two padding bytes after the trailer');
});
