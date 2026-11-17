/**
 * reveal-design-client.ts — a kid's design, read and drawn in the browser
 * =======================================================================
 * The starting-soon screen (SlateScreen.astro, via slate-design.ts) and the
 * live page's "The design" section (LiveDesign.astro) both ask
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
