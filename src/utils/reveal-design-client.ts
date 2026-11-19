/**
 * reveal-design-client.ts — a kid's design, read and drawn in the browser
 * =======================================================================
 * The live page's "The design" section (LiveDesign.astro) and the strip beside
 * its video (LiveDesignRail.astro) ask
 * /api/reveal-design for the before photos and drawings, which it only
 * gives once the reveal is confirmed (public/admin/reveal-design.js has the
 * rules). This is the one place that asks, and the one place that
 * turns a slide into a picture address.
 *
 * The family's address: a floor plan that still has its title block is only
 * ever asked of Cloudflare cropped above it (the bottom TITLE_BLOCK), never
 * whole. Its shape is known from the profile, or read off a 96px copy first
 * (too small to read anything on).
 */
import { cfRaw } from './cf-image';

export type DesignKind = 'before' | 'as-built' | 'proposed' | 'board';
export interface DesignSlide {
  kind: DesignKind;
  url: string;
  alt: string;
  /** What it is, in one word, on the picture itself: 'Before', 'Existing', 'Proposed' ('' or missing: a board) */
  badge?: string;
  kicker: string;
  caption: string;
  /** Still has its title block: shown cropped above it */
  crop: boolean;
  w?: number;
  h?: number;
  /** A whole sheet (its address painted out): where its drawing is on it, as fractions, for the views that zoom to it */
  focus?: { x: number; y: number; w: number; h: number };
}
export interface DesignAnswer {
  open: boolean;
  /** The reveal has started: the room is "before", not "today" */
  after?: boolean;
  name?: string;
  slides?: DesignSlide[];
}

const TITLE_BLOCK = 0.10;

/** Ask whether a kid's design is open; null when the answer couldn't be had (try again later) */
export async function fetchDesign(kid: string, signal?: AbortSignal): Promise<DesignAnswer | null> {
  if (!kid) return null;
  try {
    const res = await fetch(`/api/reveal-design?kid=${encodeURIComponent(kid)}`, { cache: 'no-store', signal });
    if (res.status === 404) return { open: false };
    if (!res.ok) return null;
    const d = await res.json();
    return { open: !!d?.open, after: !!d?.after, name: d?.name || '', slides: Array.isArray(d?.slides) ? d.slides.filter(validSlide) : [] };
  } catch {
    return null;
  }
}

const KINDS = new Set(['before', 'as-built', 'proposed', 'board']);
export const validSlide = (s: any): s is DesignSlide => !!s && KINDS.has(s.kind) && typeof s.url === 'string' && !!s.url && !/^(blob|data):/.test(s.url);

/** A whole sheet's drawing place, when it's a real one (fractions of the sheet, inside it); else null */
export function focusOf(s: DesignSlide | null | undefined): { x: number; y: number; w: number; h: number } | null {
  const f = s?.focus;
  if (!f || ![f.x, f.y, f.w, f.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (f.w <= 0.02 || f.h <= 0.02 || f.x < 0 || f.y < 0 || f.x + f.w > 1.0001 || f.y + f.h > 1.0001) return null;
  return f;
}

/**
 * A whole plan sheet: the designer's own, border, title block and wall legend, its address painted out (a -sheet file,
 * or one whose drawing's place is known). Shown whole everywhere, filling its card, its badge in the sheet's empty
 * top-right corner (the legend is top-left). The kid page has the same rule (src/pages/kids/[slug].astro isWholeSheet,
 * public/admin/kids-shared.js for its Preview)
 */
export const isWholeSheet = (s: DesignSlide | null | undefined): boolean =>
  !!s && (s.kind === 'as-built' || s.kind === 'proposed') && (!!focusOf(s) || /-sheet\./i.test(s.url || ''));

/**
 * height ÷ width of a plan's picture as it shows, when its stored size says it: a whole sheet as it is, a plan still to
 * be cropped above its title block (slideSrc). null when only the picture can tell (one trimmed of its white edges,
 * read off a tiny copy). The server draws the card this shape (live-design-html.ts) and the page keeps it
 */
export function knownRatio(s: DesignSlide | null | undefined): number | null {
  const w = Number(s?.w) || 0, h = Number(s?.h) || 0;
  if (!s || !(w > 0 && h > 0)) return null;
  if (focusOf(s)) return h / w;
  if (s.crop) return (h / w) * (1 - TITLE_BLOCK);
  return null;
}

// ── The plan, before and after, on one picture (Peter, Nov 18 2026: "should we do a before/after plans slider?") ──
// The designer draws the existing and the proposed floor plan on two sheets of the same plan set: the same paper, the
// same scale, the drawing a few pixels apart (Dylan's 22 px, Max's 15 px of 3200). The compare slider shows the two
// drawings one over the other, lined up on the drawing itself (plan-compare.ts measures how far apart they are), cut
// to the part of the sheet where the drawing is, so it's big enough to read. Plain functions: the server draws the
// card its shape from these too (live-design-html.ts)

export interface PlanPair { existing: DesignSlide; proposed: DesignSlide }

/** The existing and the proposed plan, when there's one of each, both whole sheets of the same paper: they compare */
export function planPairOf(slides: DesignSlide[]): PlanPair | null {
  const existing = slides.find((s) => s.kind === 'as-built');
  const proposed = slides.find((s) => s.kind === 'proposed');
  if (!existing || !proposed || !focusOf(existing) || !focusOf(proposed)) return null;
  const w = Number(existing.w) || 0, h = Number(existing.h) || 0;
  if (!(w > 0 && h > 0) || Math.abs((Number(proposed.w) || 0) - w) > 2 || Math.abs((Number(proposed.h) || 0) - h) > 2) return null;
  return { existing, proposed };
}

/**
 * Where the compare is cut from the existing sheet, as fractions of it: both drawings' boxes together, with a margin,
 * inside the sheet's border and above its title block. The proposed sheet is cut the same size, moved by what lines
 * the drawings up
 */
export function compareBox(pair: PlanPair): { x: number; y: number; w: number; h: number } {
  const a = focusOf(pair.existing)!, b = focusOf(pair.proposed)!;
  const W = Number(pair.existing.w), H = Number(pair.existing.h);
  // (just clear of its outermost lines: the drawing as big as its card allows, Peter, Nov 18 2026: "the drawing trimmed to its lines")
  const padX = 0.008, padY = (0.008 * W) / H;
  const x0 = Math.max(0.028, Math.min(a.x, b.x) - padX), x1 = Math.min(0.972, Math.max(a.x + a.w, b.x + b.w) + padX);
  const y0 = Math.max(0.04, Math.min(a.y, b.y) - padY), y1 = Math.min(0.915, Math.max(a.y + a.h, b.y + b.h) + padY);
  // In whole pixels of the sheet, so every place that cuts it cuts the same rectangle
  const px = (n: number, of: number) => Math.round(n * of);
  const left = px(x0, W), top = px(y0, H), right = px(x1, W), bottom = px(y1, H);
  return { x: left / W, y: top / H, w: (right - left) / W, h: (bottom - top) / H };
}

/** The compare's picture, in pixels of the sheet (left, top, width, height) */
export function comparePixels(pair: PlanPair): { left: number; top: number; width: number; height: number } {
  const W = Number(pair.existing.w), H = Number(pair.existing.h);
  const b = compareBox(pair);
  return { left: Math.round(b.x * W), top: Math.round(b.y * H), width: Math.round(b.w * W), height: Math.round(b.h * H) };
}

/** height ÷ width of the compare's picture */
export function compareRatio(pair: PlanPair): number {
  const p = comparePixels(pair);
  return p.height / p.width;
}

/** Same slides, same order: nothing to redraw */
export const designSignature = (slides: DesignSlide[]) => slides.map((s) => `${s.kind}|${s.url}|${s.crop ? 1 : 0}|${s.caption}|${focusOf(s) ? Object.values(focusOf(s)!).join(',') : ''}`).join('\n');

const ratios = new Map<string, Promise<number | null>>();
/** height ÷ width of a picture, read off a tiny copy */
function ratioOf(url: string): Promise<number | null> {
  let p = ratios.get(url);
  if (!p) {
    p = new Promise((done) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => done(img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : null);
      img.onerror = () => done(null);
      img.src = cfRaw(url, 'w=96,fit=scale-down,q=40');
    });
    ratios.set(url, p);
  }
  return p;
}

/**
 * A slide's picture at about w pixels across. Photos and boards as they are;
 * a floor plan with its title block cut off above it. null: a plan whose shape
 * couldn't be read, which is left out rather than shown whole.
 */
export async function slideSrc(slide: DesignSlide, w: number): Promise<string | null> {
  const width = Math.max(64, Math.round(w));
  if (slide.kind === 'before') return cfRaw(slide.url, `w=${width},fit=scale-down,q=85`);
  // Plain white edges trimmed off, so the drawing fills its paper (never on a plan still to be cropped: trimming first
  // would change its shape, and the crop below could then miss the title block). A whole sheet as it is: its drawing's
  // place is a fraction of exactly that
  if (focusOf(slide)) return cfRaw(slide.url, `w=${Math.min(width, slide.w || width)},fit=scale-down,q=90`);
  if (!slide.crop) return cfRaw(slide.url, `trim=border,w=${width},fit=scale-down,q=90`);
  const r = slide.w && slide.h ? slide.h / slide.w : await ratioOf(slide.url);
  if (!r) return null;
  const h = Math.max(32, Math.round(width * r * (1 - TITLE_BLOCK)));
  return cfRaw(slide.url, `w=${width},h=${h},fit=cover,gravity=top,q=90`);
}

/** The part of a whole sheet its drawing's pictures show (just clear of its lines, never its border or title block: a
 * whole sheet that small is white paper with a speck on it), as fractions of the sheet in whole pixels of it; null when
 * its drawing's place or its size isn't known */
export function drawingBox(slide: DesignSlide): { x: number; y: number; w: number; h: number } | null {
  const f = focusOf(slide);
  const W = Number(slide.w) || 0, H = Number(slide.h) || 0;
  if (!f || !(W > 0 && H > 0)) return null;
  const padX = 0.01, padY = (0.01 * W) / H;
  const left = Math.round(Math.max(0, f.x - padX) * W), top = Math.round(Math.max(0, f.y - padY) * H);
  const right = Math.round(Math.min(1, f.x + f.w + padX) * W), bottom = Math.round(Math.min(1, f.y + f.h + padY) * H);
  return { x: left / W, y: top / H, w: (right - left) / W, h: (bottom - top) / H };
}

/** A sheet cut to a box of it (fractions, as drawingBox and compareBox give), at about w pixels across */
export function cutSrc(slide: DesignSlide, box: { x: number; y: number; w: number; h: number }, w: number): string {
  const W = Number(slide.w) || 0, H = Number(slide.h) || 0;
  const left = Math.round(box.x * W), top = Math.round(box.y * H), width = Math.round(box.w * W), height = Math.round(box.h * H);
  return cfRaw(slide.url, `trim.left=${left},trim.top=${top},trim.width=${width},trim.height=${height},w=${Math.max(64, Math.round(w))},fit=scale-down,q=85`);
}

/** Load a picture fully before it's shown; false when it can't be */
export function preload(src: string): Promise<boolean> {
  return new Promise((done) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { (img.decode ? img.decode().catch(() => undefined) : Promise.resolve()).then(() => done(img.naturalWidth > 0)); };
    img.onerror = () => done(false);
    img.src = src;
  });
}
