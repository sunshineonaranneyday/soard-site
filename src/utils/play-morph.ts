/**
 * play-morph.ts — the replay's play button turning into pause and back
 * =====================================================================
 * One icon, two pieces, each four points: play is a triangle cut down the middle (the right piece's tip is its last two
 * points, together), pause is two bars. Between them every point moves in a straight line, so the triangle splits into
 * the bars and the bars close back into the triangle (the way the best players do it), instead of one icon blinking
 * out and the other in. Drawn filled and stroked 4 units wide with round joins: the points sit 2 units inside the
 * outline, and the corners are as round as the site's old play and pause icons' were. Outlines measured against those
 * (Nov 18 2026): pause, two bars 6 by 18 with 2 between; play, the same triangle, as far right of centre as before
 *
 * LiveStage.astro draws the play shape at first paint; live-stage.ts moves it (morphPath for each frame).
 */

type Pt = [number, number];
/** Play: a little right of centre, as a triangle reads centred (its weight is left of its middle) */
const PLAY: Pt[][] = [
  [[9.5, 5.4], [15.03, 8.7], [15.03, 15.3], [9.5, 18.6]],
  [[15.03, 8.7], [20.55, 12], [20.55, 12], [15.03, 15.3]],
];
/** Pause: two bars */
const PAUSE: Pt[][] = [
  [[7, 5], [9, 5], [9, 19], [7, 19]],
  [[15, 5], [17, 5], [17, 19], [15, 19]],
];

const n = (v: number) => Math.round(v * 100) / 100;

/** The icon's path at t: 0 is play, 1 is pause (anything between, part way) */
export function morphPath(t: number): string {
  const k = Math.min(1, Math.max(0, t));
  return PLAY.map((piece, i) => {
    const pts = piece.map(([x, y], j) => [n(x + (PAUSE[i][j][0] - x) * k), n(y + (PAUSE[i][j][1] - y) * k)]);
    return `M${pts.map((p) => p.join(' ')).join('L')}Z`;
  }).join('');
}

/** Ease in and out (the shape starts and lands softly), cubic-bezier(0.4, 0, 0.2, 1) closely enough for 200 ms */
export function morphEase(x: number): number {
  const k = Math.min(1, Math.max(0, x));
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}
