/**
 * plan-pair.js — which two plans compare, and where the compare is cut from them
 * ==============================================================================
 * The rules the plan before and after on one picture follows (Peter, Nov 18 2026: "should we do a before/after plans
 * slider?"), in one place for every side of it: a visitor's page and the server's first paint (through
 * src/utils/reveal-design-client.ts, which gives them with their types), and the automatic import that lines the two
 * plans up once when they come in (functions/api/_reveal-design-auto.js). Plain functions over the slides
 * (./reveal-design.js revealSlides).
 *
 * The designer draws the existing and the proposed floor plan on two sheets of the same plan set: the same paper, the
 * same scale, the drawing a few pixels apart (Dylan's 22 px, Max's 15 px of 3200). The compare shows the two drawings
 * one over the other, lined up on the drawing itself, cut to the part of the sheet where the drawing is, so it's big
 * enough to read.
 */

/** A whole sheet's drawing place, when it's a real one (fractions of the sheet, inside it); else null */
export function focusOf(s) {
  const f = s?.focus;
  if (!f || ![f.x, f.y, f.w, f.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (f.w <= 0.02 || f.h <= 0.02 || f.x < 0 || f.y < 0 || f.x + f.w > 1.0001 || f.y + f.h > 1.0001) return null;
  return f;
}

/** The existing and the proposed plan, when there's one of each, both whole sheets of the same paper, and not two
 *  found not to line up when they came in: they compare → { existing, proposed } or null */
export function planPairOf(slides) {
  const existing = slides.find((s) => s.kind === 'as-built');
  const proposed = slides.find((s) => s.kind === 'proposed');
  if (!existing || !proposed || !focusOf(existing) || !focusOf(proposed)) return null;
  const w = Number(existing.w) || 0, h = Number(existing.h) || 0;
  if (!(w > 0 && h > 0) || Math.abs((Number(proposed.w) || 0) - w) > 2 || Math.abs((Number(proposed.h) || 0) - h) > 2) return null;
  if (existing.cmp?.none && existing.cmp.proposed === proposed.url) return null;
  return { existing, proposed };
}

/** The pair's line-up made when they came in, with its two pictures, when it's this pair's; else null (made on the page) */
export function storedCompareOf(pair) {
  const c = pair.existing.cmp;
  if (!c || c.none || c.proposed !== pair.proposed.url || !c.box || !c.before || !c.after) return null;
  return c;
}

/**
 * Where the compare is cut from the existing sheet, as fractions of it: both drawings' boxes together, with a margin,
 * inside the sheet's border and above its title block. The proposed sheet is cut the same size, moved by what lines
 * the drawings up
 */
export function compareBox(pair) {
  // (lined up when they came in: cut where that cut them, so every place that shows them agrees with its pictures)
  const kept = storedCompareOf(pair);
  if (kept) return { ...kept.box };
  const a = focusOf(pair.existing), b = focusOf(pair.proposed);
  const W = Number(pair.existing.w), H = Number(pair.existing.h);
  // (just clear of its outermost lines: the drawing as big as its card allows, Peter, Nov 18 2026: "the drawing trimmed to its lines")
  const padX = 0.008, padY = (0.008 * W) / H;
  const x0 = Math.max(0.028, Math.min(a.x, b.x) - padX), x1 = Math.min(0.972, Math.max(a.x + a.w, b.x + b.w) + padX);
  const y0 = Math.max(0.04, Math.min(a.y, b.y) - padY), y1 = Math.min(0.915, Math.max(a.y + a.h, b.y + b.h) + padY);
  // In whole pixels of the sheet, so every place that cuts it cuts the same rectangle
  const px = (n, of) => Math.round(n * of);
  const left = px(x0, W), top = px(y0, H), right = px(x1, W), bottom = px(y1, H);
  return { x: left / W, y: top / H, w: (right - left) / W, h: (bottom - top) / H };
}

/** The compare's picture, in pixels of the sheet (left, top, width, height) */
export function comparePixels(pair) {
  const W = Number(pair.existing.w), H = Number(pair.existing.h);
  const b = compareBox(pair);
  return { left: Math.round(b.x * W), top: Math.round(b.y * H), width: Math.round(b.w * W), height: Math.round(b.h * H) };
}
