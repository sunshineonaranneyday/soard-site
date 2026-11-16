/**
 * The image types the site takes from outside (a board member's own photo on
 * /profile-update/, an article's preview image for a press card): JPEG, PNG,
 * WebP, HEIC/HEIF and GIF. Never SVG, which is a document that can carry
 * script, nor anything else a browser might be talked into running.
 *
 * Both the declared type and the file's first bytes must say the same
 * allowed type: a renamed or mislabeled file is turned away.
 *
 *   imageKind(bytes)                 'jpeg' | 'png' | 'webp' | 'heic' | 'gif' | null
 *   checkImage(bytes, declaredType)  { ok, kind, type } | { ok: false, why }
 *   imageSize(bytes)                 { width, height } of a JPEG, PNG or WebP, from its header; null when it can't be read
 *   imageWhole(bytes)                false for a picture cut off before its end: JPEG, PNG, WebP, HEIC/AVIF (any
 *                                    ISO "ftyp" file) and GIF (true for anything else)
 */

export const IMAGE_TYPES = Object.freeze({
  jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  heic: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  gif: ['image/gif'],
});
const TYPE_FOR = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif' };
// ISO-BMFF brands for HEIC/HEIF stills and sequences (the "ftyp" box)
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));

/** What the file's first bytes say it is, or null when it isn't one we take */
export function imageKind(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 4, 8) === 'ftyp') {
    // The major brand, then the compatible brands, up to the box's own size.
    // AVIF shares the "mif1" brand with HEIF, and isn't one we take.
    const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 || 32, 64);
    const brands = [ascii(b, 8, 12)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, i + 4));
    if (brands.some((x) => x === 'avif' || x === 'avis')) return null;
    if (brands.some((x) => HEIF_BRANDS.has(x))) return 'heic';
  }
  return null;
}

/** The declared type (a File's or a response's Content-Type), bare and lowercase */
export function bareType(type) {
  return String(type || '').split(';')[0].trim().toLowerCase();
}

/**
 * Is this an image we take? The bytes decide the kind; a declared type, when
 * there is one, must agree. → { ok, kind, type } (type: the clean MIME type
 * to upload with) | { ok: false, why }
 */
export function checkImage(bytes, declaredType = '') {
  const kind = imageKind(bytes);
  if (!kind) return { ok: false, why: 'not a JPG, PNG, WebP, HEIC or GIF image' };
  const declared = bareType(declaredType);
  if (declared && declared !== 'application/octet-stream' && !IMAGE_TYPES[kind].includes(declared)) {
    return { ok: false, why: `says ${declared} but is a ${kind.toUpperCase()}` };
  }
  return { ok: true, kind, type: TYPE_FOR[kind] };
}

// JPEG's start-of-frame markers (C0 to CF, but C4 is a Huffman table, C8 is reserved and CC an arithmetic table):
// the one in the file says the picture's size
const SOF = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const sized = (width, height) => (width > 0 && height > 0 ? { width, height } : null);

/**
 * A picture's size in pixels as its file stores it ({ width, height }), read from the header alone: a JPEG's
 * start-of-frame, a PNG's IHDR, a WebP's VP8, VP8L or VP8X chunk. null for anything else or a header that's cut
 * short. A JPEG turned by its EXIF orientation is reported as stored (the site's own uploads are drawn upright first).
 */
export function imageSize(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const kind = imageKind(b);
  if (kind === 'png') return b.length >= 24 && ascii(b, 12, 16) === 'IHDR' ? sized(u32be(b, 16), u32be(b, 20)) : null;
  if (kind === 'webp') {
    const chunk = ascii(b, 12, 16);
    if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9D && b[24] === 0x01 && b[25] === 0x2A) return sized(u16le(b, 26) & 0x3FFF, u16le(b, 28) & 0x3FFF);
    if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2F) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return sized((bits & 0x3FFF) + 1, ((bits >>> 14) & 0x3FFF) + 1);
    }
    if (chunk === 'VP8X' && b.length >= 30) return sized(u24le(b, 24) + 1, u24le(b, 27) + 1);
    return null;
  }
  if (kind !== 'jpeg') return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) return null; // lost: not at a marker
    let m = b[i + 1];
    while (m === 0xFF && i + 2 < b.length) { i++; m = b[i + 1]; } // fill bytes before a marker
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; } // markers with no length
    if (m === 0xD9 || m === 0xDA) return null; // the end, or the picture's data, before any frame
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (SOF.has(m)) return i + 9 <= b.length ? sized(u16be(b, i + 7), u16be(b, i + 5)) : null;
    i += 2 + len;
  }
  return null;
}

const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** An ISO media file (HEIC, AVIF): its boxes, one after another, reach exactly to its end */
function isoWhole(b) {
  let at = 0;
  while (at < b.length) {
    if (at + 8 > b.length) return false;
    let size = u32be(b, at);
    if (size === 1) { // a 64-bit size follows the box's type
      if (at + 16 > b.length) return false;
      size = u32be(b, at + 8) * 2 ** 32 + u32be(b, at + 12);
    } else if (size === 0) return true; // runs to the end of the file
    if (size < 8) return false;
    at += size;
  }
  return at === b.length;
}
const fourcc = (b, at, s) => b[at] === s.charCodeAt(0) && b[at + 1] === s.charCodeAt(1) && b[at + 2] === s.charCodeAt(2) && b[at + 3] === s.charCodeAt(3);

/**
 * A GIF, block by block to its trailer (its header, the colour table, each picture and its data in sub-blocks): whole
 * when a picture's data ends and the trailer comes (bytes after it are harmless), never judged by its last byte alone
 */
function gifWhole(b) {
  if (b.length < 14) return false;
  const table = (packed) => (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  let i = 13 + table(b[10]);
  let picture = false;
  const subBlocks = () => { // → false if they run past the end
    for (;;) {
      if (i >= b.length) return false;
      const n = b[i++];
      if (!n) return true;
      i += n;
    }
  };
  while (i < b.length) {
    const tag = b[i];
    if (tag === 0x3B) return picture;
    if (tag === 0x21) { i += 2; if (!subBlocks()) return false; continue; }
    if (tag === 0x2C) {
      if (i + 10 > b.length) return false;
      i += 10 + table(b[i + 9]) + 1; // the picture's descriptor, its own colour table, its LZW code size
      if (!subBlocks()) return false;
      picture = true;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Did the whole file come? A JPEG has its end-of-image marker after its picture data begins (inside that data an FF
 * byte is always followed by 00 or a restart marker, so FF D9 there is the real end); a PNG has picture data (IDAT)
 * and its IEND chunk; a WebP is as long as its RIFF header says, with picture data in it; a HEIC or AVIF's boxes reach
 * exactly to its end; a GIF ends with its trailer. A file cut off partway (a download stopped, a copy that failed)
 * shows its size from its header, but isn't a picture: a browser fills the rest in with a block of colour. Other kinds
 * are taken as whole.
 */
export function imageWhole(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') return isoWhole(b);
  const kind = imageKind(b);
  if (kind === 'gif') return gifWhole(b);
  if (kind === 'webp') {
    if (b.length < u32le(b, 4) + 8) return false;
    for (let i = 12; i + 8 <= b.length; i++) if (fourcc(b, i, 'VP8 ') || fourcc(b, i, 'VP8L')) return u32le(b, i + 4) > 0 && i + 8 + u32le(b, i + 4) <= b.length;
    return false;
  }
  if (kind === 'png') {
    let data = false;
    for (let i = 8; i + 8 <= b.length;) { // chunk by chunk: length, type, data, CRC
      const len = u32be(b, i);
      if (fourcc(b, i + 4, 'IDAT') && len > 0) data = true;
      if (fourcc(b, i + 4, 'IEND')) return data;
      i += 12 + len;
      if (i > b.length) return false;
    }
    return false;
  }
  if (kind !== 'jpeg') return true;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) return false;
    let m = b[i + 1];
    while (m === 0xFF && i + 2 < b.length) { i++; m = b[i + 1]; }
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    if (m === 0xD9) return false; // ended before any picture data
    const len = u16be(b, i + 2);
    if (len < 2) return false;
    if (m === 0xDA) {
      for (let j = i + 2 + len; j + 1 < b.length; j++) if (b[j] === 0xFF && b[j + 1] === 0xD9) return true;
      return false;
    }
    i += 2 + len;
  }
  return false;
}
