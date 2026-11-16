/**
 * A photo made ready to send, in the browser (the trade-partner pages' files, the Advisory Board
 * application's headshot):
 *   - an iPhone photo (HEIC) becomes a JPEG: Safari draws it itself, any other browser fetches
 *     libheif (./heic-to.js, 3 MB) the first time. The page needs `worker-src blob:` in its CSP
 *     (public/_headers), since libheif decodes in a worker it makes itself.
 *   - it goes as a JPEG at most 2400 px across, on white, drawn upright (a phone's sideways photo
 *     with an orientation tag comes out the way it looks). A headshot (keepShort) keeps its short
 *     side up to keepShort, so a wide photo isn't shrunk too small to use, within what Cloudflare
 *     Images takes (maxLong: 12,000 px a side, 10 MB) and what every browser's canvas draws (iOS
 *     Safari's is about 16.7 million pixels)
 *   - one too large for <img> to decode (a 100-megapixel photo) is decoded straight to its size
 *   - its real size, read from the file itself, comes back with it: a headshot is judged on what it
 *     is, never on the copy made of it
 * Read into memory first, so a file that moves or changes after it's picked fails here, in words,
 * not halfway through sending.
 */

import { imageSize, imageWhole } from '../../functions/api/_image-types.js';

const MAX_SIDE = 2400;
// The largest canvas every browser draws: iOS Safari's is about 16.7 million pixels, and no side over 16,384
const MAX_AREA = 16_000_000;
const MAX_CANVAS = 16_384;

/** An iPhone photo (HEIC), by its first bytes as well as its name */
export async function isHeic(f: File) {
  if (/^image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name)) return true;
  const s = String.fromCharCode(...new Uint8Array(await f.slice(0, 12).arrayBuffer()));
  return s.slice(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(s.slice(8, 12));
}

/** The JPEG drawn (width, height), and the photo's own size (sourceWidth, sourceHeight: upright, as it really is) */
export interface DrawnPhoto { file: File; width: number; height: number; sourceWidth: number; sourceHeight: number }
export interface DrawOptions {
  /** never shrink the short side below this (a headshot: a wide photo stays sharp enough to use) */
  keepShort?: number;
  /** the longest side it may have (Cloudflare Images takes 12,000 px) */
  maxLong?: number;
  /** the most bytes the JPEG may be (Cloudflare Images takes 10 MB): drawn again a little smaller until it fits */
  maxBytes?: number;
}

/** How much to shrink a picture: its long side to MAX_SIDE (its short side never below keepShort), and never past maxLong or a canvas's limits */
export function scaleFor(w: number, h: number, { keepShort = 0, maxLong = MAX_CANVAS }: DrawOptions = {}) {
  let s = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (keepShort) s = Math.max(s, Math.min(1, keepShort / Math.min(w, h)));
  return Math.min(1, s, Math.sqrt(MAX_AREA / (w * h)), Math.min(maxLong, MAX_CANVAS) / Math.max(w, h));
}

interface Source { draw: CanvasImageSource; w: number; h: number; done: () => void }

/**
 * A picture this browser can draw, upright, with its real size. One too large for <img> to decode (often over
 * 150 megapixels) is decoded straight to the size it'll be drawn at: its size from the file's own header, turned
 * upright as a tiny first decode shows it.
 */
async function source(f: Blob, header: { width: number; height: number } | null, opts: DrawOptions): Promise<Source | null> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.naturalWidth) return { draw: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch { /* too large for <img>, or not a picture */ }
  URL.revokeObjectURL(url);
  try {
    const probe = await createImageBitmap(f, { resizeWidth: 64, resizeQuality: 'low', imageOrientation: 'from-image' } as ImageBitmapOptions);
    const upright = probe.height >= probe.width;
    const ratio = probe.height / probe.width;
    probe.close();
    // Its real size: the header's (turned as it shows), else as wide as it'll be drawn
    let w = header?.width || 0;
    let h = header?.height || 0;
    if (w && h && (h >= w) !== upright) [w, h] = [h, w];
    if (!w || !h) { w = MAX_SIDE; h = Math.round(MAX_SIDE * ratio); }
    const s = scaleFor(w, h, opts);
    // (the long side asked for: a browser that sizes before turning it still has enough pixels, and the canvas scales)
    const bmp = await createImageBitmap(f, { resizeWidth: Math.max(1, Math.round(Math.max(w, h) * s)), resizeQuality: 'high', imageOrientation: 'from-image' } as ImageBitmapOptions);
    if (bmp.width) return { draw: bmp, w, h, done: () => bmp.close() };
  } catch { /* not a picture this browser reads */ }
  return null;
}

const encode = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));

/**
 * A photo drawn as a JPEG no bigger than the options allow, with its size and its own → DrawnPhoto; one already
 * small enough goes as it is unless `always`; null when this browser can't draw it
 */
export async function drawJpeg(f: Blob, name: string, always = false, opts: DrawOptions = {}): Promise<DrawnPhoto | null> {
  let header: { width: number; height: number } | null = null;
  try { header = imageSize(new Uint8Array(await f.slice(0, 512 * 1024).arrayBuffer())); } catch { header = null; }
  const src = await source(f, header, opts);
  if (!src) return null;
  try {
    let scale = scaleFor(src.w, src.h, opts);
    if (scale === 1 && !always && f.size < 4 * 1024 * 1024 && f instanceof File) {
      return { file: new File([await f.arrayBuffer()], f.name, { type: f.type }), width: src.w, height: src.h, sourceWidth: src.w, sourceHeight: src.h };
    }
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    // Drawn, then a little smaller (quality, then size) until it's within maxBytes
    for (let tries = 0; tries < 8; tries++) {
      c.width = Math.max(1, Math.round(src.w * scale));
      c.height = Math.max(1, Math.round(src.h * scale));
      // White under it: a JPEG has no see-through, and a transparent PNG would come out black
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src.draw, 0, 0, c.width, c.height);
      for (const q of [0.88, 0.8, 0.72]) {
        const blob = await encode(c, q);
        if (!blob) return null;
        if (!opts.maxBytes || blob.size <= opts.maxBytes) {
          return { file: new File([blob], `${name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' }), width: c.width, height: c.height, sourceWidth: src.w, sourceHeight: src.h };
        }
      }
      scale *= 0.85;
    }
    return null;
  } catch {
    return null;
  } finally {
    src.done();
  }
}

/** A photo as a JPEG no bigger than the reader needs (drawJpeg's file alone); null when this browser can't draw it */
export async function toJpeg(f: Blob, name: string, always = false): Promise<File | null> {
  return (await drawJpeg(f, name, always))?.file || null;
}

export type PhotoResult = { photo: DrawnPhoto } | { error: 'not-photo' | 'cut' | 'converter' | 'unreadable' };

/**
 * Any photo someone picked, drawn afresh as an upright JPEG with its size → { photo }, or why not:
 *   'not-photo'  nothing could open it (not a photo; a drawing (SVG); a kind no browser reads)
 *   'cut'        a picture cut off partway (JPEG, PNG, WebP, HEIC, AVIF, GIF): it would show part of a picture,
 *                the rest a block of colour
 *   'converter'  an iPhone photo, and the part of the page that reads them didn't load (a connection that dropped)
 */
export async function photoAsJpeg(f: File, opts: DrawOptions = {}): Promise<PhotoResult> {
  // A drawing, not a photo (and a picture that can run script)
  if (/^image\/svg/i.test(f.type) || /\.svgz?$/i.test(f.name)) return { error: 'not-photo' };
  // (a file that changed or moved since it was picked, a cloud photo still syncing: it couldn't be read, said as that)
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await f.arrayBuffer()); } catch { return { error: 'unreadable' }; }
  if (!imageWhole(bytes)) return { error: 'cut' };
  const own = await drawJpeg(f, f.name, true, opts);
  if (own) return { photo: own };
  if (!(await isHeic(f).catch(() => false))) return { error: 'not-photo' };
  let heicTo: (o: { blob: Blob; type: string; quality: number }) => Promise<Blob>;
  try {
    ({ heicTo } = await import('./heic-to.js'));
  } catch {
    return { error: 'converter' };
  }
  try {
    const drawn = await drawJpeg(await heicTo({ blob: f, type: 'image/jpeg', quality: 0.92 }), f.name, true, opts);
    return drawn ? { photo: drawn } : { error: 'not-photo' };
  } catch {
    return { error: 'not-photo' };
  }
}
