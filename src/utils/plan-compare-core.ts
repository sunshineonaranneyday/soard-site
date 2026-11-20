/**
 * plan-compare-core.ts — the pixel work of lining two plans up, for the site's code with its types
 * =================================================================================================
 * The work itself is public/admin/plan-compare-core.js: the same code lines a kid's plans up when they come in
 * (functions/api/_reveal-design-auto.js, in Cloudflare's browser) and on a visitor's page for a pair not lined up yet
 * (plan-compare.worker.ts, plan-compare.ts).
 */
// @ts-ignore (plain JS, typed here)
import * as core from '../../public/admin/plan-compare-core.js';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

/** Fewer than this share of the lines landing on each other: not the same room drawn the same way */
export const MIN_OVERLAP: number = core.MIN_OVERLAP;
/** How far apart the drawings can be, either way, in pixels of the sheet */
export const REACH: number = core.REACH;
/** The pig taken out of a cut of the sheet (the same pixels, changed) */
export const withoutPig: (img: Pixels) => Pixels = core.withoutPig;
/** The existing cut A and the proposed cut B lined up, both with the pig taken out; null: they don't line up */
export const lineUp: (A: Pixels, Bwide: Pixels, ox: number, oy: number) => { before: Pixels; after: Pixels; dx: number; dy: number; overlap: number } | null = core.lineUp;
