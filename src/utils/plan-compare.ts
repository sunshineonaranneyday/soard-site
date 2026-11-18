/**
 * plan-compare.ts — the existing and the proposed floor plan, lined up
 * ====================================================================
 * Peter, Nov 18 2026: "should we do a before/after plans slider?" The two
 * plans are the designer's own sheets (border, title block, the SOARD pig
 * printed faintly under the drawing), the same paper at the same scale. But
 * on each sheet the drawing sits a few pixels from where it sits on the other
 * (Dylan's 22 px across and down of 3200, Max's 15), and the pig doesn't move
 * with it. Laid one over the other as they are, the walls jump at the slider's
 * line. So, in the browser, once per pair:
 *
 *   1. How far apart: the existing drawing's dark lines (the walls, the doors,
 *      the words) looked for on the proposed sheet at every shift up to 96 px
 *      each way, every 6 px first (with a 3 px allowance, so nothing between
 *      is missed), then every pixel near the best; the shift where most of
 *      them land on lines wins. Full-size pixels throughout: a resized sheet
 *      loses its thin lines, and Max's then lined up 32 px wrong. A pair
 *      whose drawings don't land on each other (a different scale, a
 *      different room) isn't compared at all: compareFor answers null and the
 *      sheets show as before.
 *   2. Cut: the part of each sheet where the drawing is (compareBox: both
 *      drawings, a margin, inside the border and above the title block, the
 *      family's address never in it), the proposed one moved by the shift, so
 *      the two pictures are the same size and the drawings sit exactly on each
 *      other. Cut by Cloudflare at full size, as PNG (lossless), so step 3 is
 *      exact.
 *   3. The pig taken out: it's printed as the site's yellow (#FFDA24) at about
 *      15% over the drawing, so each of its pixels is the drawing's own colour
 *      mixed with that yellow, and the mix can be undone exactly (a grey wall
 *      under it is grey again, a black line black). It stays on the designer's
 *      whole sheets, which show as they are.
 *
 * Steps 1 and 3 run in a background worker (plan-compare.worker.ts, the work
 * itself in plan-compare-core.ts): on the page they held it up for 0.4 s on a
 * computer and 1.5 to 2.7 s at a phone's speed, the reveal playing.
 *
 * The two pictures come back as blob: addresses (the CSP allows blob: images),
 * kept for the page's life, and shared by every place the compare shows (the
 * design section, the room beside the video, the viewer).
 */
import { CF_HASH, cfId } from './cf-image';
import { comparePixels, focusOf, type PlanPair } from './reveal-design-client';
import { lineUp, REACH, type Pixels } from './plan-compare-core';

export interface PlanCompare {
  /** The existing plan's picture and the proposed one's, the same size, lined up */
  before: string;
  after: string;
  width: number;
  height: number;
  /** How far the proposed drawing sits from the existing one, in pixels of the sheet */
  dx: number;
  dy: number;
  /** How much of the existing drawing's lines land on the proposed one's (0–1) */
  overlap: number;
}

// The pictures come straight from Cloudflare Images as PNG: on the site through its own address (the CSP's 'self'),
// anywhere else (a preview, a local copy) from imagedelivery.net, which the CSP allows too and which allows any origin
const imagesBase = () => (typeof location !== 'undefined' && location.origin === 'https://sunshineonaranneyday.com'
  ? `https://sunshineonaranneyday.com/cdn-cgi/imagedelivery/${CF_HASH}`
  : `https://imagedelivery.net/${CF_HASH}`);

async function pixelsOf(url: string): Promise<ImageData> {
  const res = await fetch(url, { headers: { Accept: 'image/png' }, credentials: 'omit' });
  if (!res.ok) throw new Error(`${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** A line of the drawing (dark): what the two sheets are lined up on */
function toUrl(img: Pixels): Promise<string> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return new Promise((done, fail) => c.toBlob((b) => (b ? done(URL.createObjectURL(b)) : fail(new Error('no blob'))), 'image/png'));
}

// ── The worker: one for the page, made the first time it's wanted. It fetches, reads, lines up and draws the two
// pictures itself where it can (OffscreenCanvas), so the page only shows them; in an older browser the page reads the
// pixels and the worker lines them up; if no worker can be had (a blocked script), the page does it all, as before
type Answer = { ok: boolean; error?: string; before?: Blob | Pixels; after?: Blob | Pixels; dx?: number; dy?: number; overlap?: number };
let worker: Worker | null | undefined;
let asks = 0;
const waiting = new Map<number, (r: Answer) => void>();
function workerNow(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./plan-compare.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const done = waiting.get(e.data?.id); if (done) { waiting.delete(e.data.id); done(e.data); } };
    // (a worker that can't start: everything waiting on it is done on the page, and everything after)
    worker.onerror = () => { worker = null; for (const [, done] of waiting) done({ ok: false, error: 'worker' }); waiting.clear(); };
  } catch { worker = null; }
  return worker;
}
function ask(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Answer> {
  const w = workerNow();
  if (!w) return Promise.resolve({ ok: false, error: 'worker' });
  const id = ++asks;
  return new Promise((done) => { waiting.set(id, done); w.postMessage({ ...msg, id }, transfer); });
}

async function build(pair: PlanPair): Promise<PlanCompare | null> {
  const P = comparePixels(pair);
  // The existing cut, and the proposed one REACH bigger each way (inside the proposed sheet, which can be a pixel or two
  // off the existing one's size), so any shift up to it is in hand
  const Wb = Number(pair.proposed.w) || Number(pair.existing.w), Hb = Number(pair.proposed.h) || Number(pair.existing.h);
  const bl = Math.max(0, P.left - REACH), bt = Math.max(0, P.top - REACH);
  const br = Math.min(Wb, P.left + P.width + REACH), bb = Math.min(Hb, P.top + P.height + REACH);
  const cut = (l: number, t: number, w: number, h: number) => `trim.left=${l},trim.top=${t},trim.width=${w},trim.height=${h},q=100`;
  const a = `${imagesBase()}/${cfId(pair.existing.url)}/${cut(P.left, P.top, P.width, P.height)}`;
  const b = `${imagesBase()}/${cfId(pair.proposed.url)}/${cut(bl, bt, br - bl, bb - bt)}`;
  // (A's pixel x is the sheet's P.left + x; B's is bl + x)
  const ox = P.left - bl, oy = P.top - bt;
  const done = (before: string, after: string, r: Answer) => ({ before, after, width: P.width, height: P.height, dx: r.dx!, dy: r.dy!, overlap: r.overlap! });
  // 1. All of it in the worker
  const whole = await ask({ kind: 'whole', a, b, ox, oy, aw: P.width, ah: P.height, bw: br - bl, bh: bb - bt });
  if (whole.ok && whole.before instanceof Blob && whole.after instanceof Blob) return done(URL.createObjectURL(whole.before), URL.createObjectURL(whole.after), whole);
  if (!whole.error || whole.error === 'failed') return null; // (they don't line up, or a picture can't be had)
  // 2. The page reads the pixels; the lining up in the worker, or (no worker) here
  const [A, Bwide] = await Promise.all([pixelsOf(a), pixelsOf(b)]);
  if (A.width !== P.width || A.height !== P.height || Bwide.width !== br - bl || Bwide.height !== bb - bt) return null;
  let r: Answer = whole.error === 'no-canvas'
    ? await ask({ kind: 'pixels', A: { width: A.width, height: A.height, data: A.data }, B: { width: Bwide.width, height: Bwide.height, data: Bwide.data }, ox, oy }, [A.data.buffer, Bwide.data.buffer])
    : { ok: false, error: 'worker' };
  if (r.error === 'worker') {
    // (its pixels went to a worker that never answered: read again)
    const [A2, B2] = whole.error === 'no-canvas' ? await Promise.all([pixelsOf(a), pixelsOf(b)]) : [A, Bwide];
    const here = lineUp(A2, B2, ox, oy);
    r = here ? { ok: true, ...here } : { ok: false };
  }
  if (!r.ok || !r.before || !r.after || r.before instanceof Blob || r.after instanceof Blob) return null;
  const [before, after] = await Promise.all([toUrl(r.before), toUrl(r.after)]);
  return done(before, after, r);
}

const made = new Map<string, Promise<PlanCompare | null>>();
/** The pair's compare, made once per page; null when it can't be (it doesn't line up, a picture can't be had) */
export function compareFor(pair: PlanPair): Promise<PlanCompare | null> {
  const key = `${pair.existing.url}|${pair.proposed.url}|${JSON.stringify(focusOf(pair.existing))}|${JSON.stringify(focusOf(pair.proposed))}`;
  let p = made.get(key);
  if (!p) {
    p = build(pair).catch((e) => { console.info('plan compare unavailable:', e?.message || e); return null; });
    made.set(key, p);
  }
  return p;
}
