/**
 * plan-compare.worker.ts — lining two plans up, away from the page
 * ================================================================
 * plan-compare.ts asks; the work itself is plan-compare-core.ts. Two kinds of ask, one answer each ({ id, ok, ... }):
 *
 *   whole    the two pictures' addresses: fetched, read, lined up and made into PNGs here, so the page only shows them
 *            (where a worker can draw: OffscreenCanvas; else it answers { ok: false, error: 'no-canvas' })
 *   pixels   the two pictures' pixels, read by the page: lined up here, the pixels handed back (an older browser)
 *   sheet    a designer's whole sheet's address: fetched, the pig taken out, made into a PNG (the viewer's sheets;
 *            no OffscreenCanvas: { ok: false, error: 'no-canvas' }, and the sheet shows as it is)
 */
import { lineUp, withoutPig, type Pixels } from './plan-compare-core';

type Ask =
  | { id: number; kind: 'whole'; a: string; b: string; ox: number; oy: number; aw: number; ah: number; bw: number; bh: number }
  | { id: number; kind: 'pixels'; A: Pixels; B: Pixels; ox: number; oy: number }
  | { id: number; kind: 'sheet'; a: string };

const say = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

/** A picture's pixels, read here; w, h: the size it must be (0: whatever size it comes at) */
async function pixelsOf(url: string, w: number, h: number): Promise<Pixels> {
  const res = await fetch(url, { headers: { Accept: 'image/png' }, credentials: 'omit' });
  if (!res.ok) throw new Error(`${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  if (!w || !h) { w = bmp.width; h = bmp.height; }
  if (bmp.width !== w || bmp.height !== h) throw new Error('size');
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no-canvas');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}
function png(p: Pixels): Promise<Blob> {
  const c = new OffscreenCanvas(p.width, p.height);
  (c.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e: MessageEvent<Ask>) => {
  const ask = e.data;
  try {
    if (ask.kind === 'sheet') {
      if (typeof OffscreenCanvas === 'undefined') { say({ id: ask.id, ok: false, error: 'no-canvas' }); return; }
      const sheet = await png(withoutPig(await pixelsOf(ask.a, 0, 0)));
      say({ id: ask.id, ok: true, sheet });
      return;
    }
    if (ask.kind === 'whole') {
      if (typeof OffscreenCanvas === 'undefined') { say({ id: ask.id, ok: false, error: 'no-canvas' }); return; }
      const [A, B] = await Promise.all([pixelsOf(ask.a, ask.aw, ask.ah), pixelsOf(ask.b, ask.bw, ask.bh)]);
      const r = lineUp(A, B, ask.ox, ask.oy);
      if (!r) { say({ id: ask.id, ok: false }); return; }
      const [before, after] = await Promise.all([png(r.before), png(r.after)]);
      say({ id: ask.id, ok: true, before, after, dx: r.dx, dy: r.dy, overlap: r.overlap });
      return;
    }
    const r = lineUp(ask.A, ask.B, ask.ox, ask.oy);
    if (!r) { say({ id: ask.id, ok: false }); return; }
    say({ id: ask.id, ok: true, before: r.before, after: r.after, dx: r.dx, dy: r.dy, overlap: r.overlap }, [r.before.data.buffer, r.after.data.buffer]);
  } catch (err) {
    const m = String((err as Error)?.message || err);
    say({ id: ask.id, ok: false, error: m === 'no-canvas' ? 'no-canvas' : 'failed', detail: m });
  }
};
