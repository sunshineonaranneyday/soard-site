/**
 * plan-compare-core.ts — the pixel work of lining two plans up (plan-compare.ts)
 * ===============================================================================
 * Plain functions on pixels, nothing of the page's: a background worker runs them (plan-compare.worker.ts), so lining
 * up the plans never holds the page up (it took the page 1.5 to 2.7 s on a phone's speed, the reveal playing), and the
 * page itself only if a worker can't be had.
 */

/** The site's yellow, which the pig is printed in */
const PIG = [255, 218, 36] as const;
/** Fewer than this share of the lines landing on each other: not the same room drawn the same way (Max's bathroom,
 *  most changed, is 0.40; Dylan's room 0.78) */
export const MIN_OVERLAP = 0.3;
/** How far apart the drawings can be, either way, in pixels of the sheet (seen: 22); the first look's step */
export const REACH = 96;
const STEP = 6;

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

const dark = (d: Uint8ClampedArray, i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 110;

/** 1 for each pixel that's part of a line */
function maskOf(img: Pixels): Uint8Array {
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) m[i] = dark(img.data, i * 4) ? 1 : 0;
  return m;
}

/**
 * Where B's lines best land on A's: A's line pixels (at most `most` of them, evenly spread), looked for in B at
 * (x + ox + dx, y + oy + dy) for dx, dy from c − reach to c + reach in steps of `step`
 */
function bestShift(ad: Uint8Array, aw: number, ah: number, bd: Uint8Array, bw: number, bh: number, ox: number, oy: number, cx: number, cy: number, reach: number, step: number, most: number) {
  let total = 0;
  for (let i = 0; i < ad.length; i++) total += ad[i];
  if (!total) return { dx: cx, dy: cy, overlap: 0 };
  const every = Math.max(1, Math.ceil(total / most));
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0, seen = 0; i < ad.length; i++) if (ad[i] && seen++ % every === 0) { xs.push(i % aw); ys.push((i / aw) | 0); }
  const n = xs.length;
  let best = { dx: cx, dy: cy, overlap: -1 };
  for (let dy = cy - reach; dy <= cy + reach; dy += step) {
    for (let dx = cx - reach; dx <= cx + reach; dx += step) {
      let hit = 0;
      for (let i = 0; i < n; i++) {
        const bx = xs[i] + ox + dx, by = ys[i] + oy + dy;
        if (bx >= 0 && by >= 0 && bx < bw && by < bh && bd[by * bw + bx]) hit++;
      }
      const o = hit / n;
      // (a tie keeps the smaller shift)
      if (o > best.overlap + 1e-9 || (Math.abs(o - best.overlap) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, overlap: o };
    }
  }
  return best;
}

/** Each 1 in `m` spread to every pixel within r (grow), or kept only where all within r are 1 (shrink); rows then columns */
function boxPass(m: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  // (past the edge counts as neither: a window there is only its pixels inside)
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    let s = 0;
    const row = y * w;
    for (let x = -r; x < w + r; x++) {
      const add = x + r, sub = x - r - 1;
      if (add >= 0 && add < w) s += m[row + add];
      if (sub >= 0 && sub < w) s -= m[row + sub];
      if (x >= 0 && x < w) {
        const span = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
        tmp[row + x] = grow ? (s > 0 ? 1 : 0) : (s >= span ? 1 : 0);
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y < h + r; y++) {
      const add = y + r, sub = y - r - 1;
      if (add >= 0 && add < h) s += tmp[add * w + x];
      if (sub >= 0 && sub < h) s -= tmp[sub * w + x];
      if (y >= 0 && y < h) {
        const span = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
        out[y * w + x] = grow ? (s > 0 ? 1 : 0) : (s >= span ? 1 : 0);
      }
    }
  }
  return out;
}

/**
 * The pig taken out of a cut of the sheet. Under it every pixel is the drawing's colour c mixed with the yellow Y at a
 * strength a: p = a·Y + (1 − a)·c. The drawing is grey (walls, lines, words), so for a grey c, red − blue = a·(255 − 36)
 * gives a, and c follows; that it really is a grey under yellow is checked on green. The few coloured lines under it
 * (the designer's blue measurements) can't be read that way: they're undone with the pig's own strength, read off the
 * pixels around them
 */
export function withoutPig(img: Pixels): Pixels {
  const { data: d, width: w, height: h } = img;
  const n = w * h;
  const span = PIG[0] - PIG[2];
  const alpha = new Float32Array(n);
  const hist = new Uint32Array(64);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const r = d[k], g = d[k + 1], b = d[k + 2];
    const a = (r - b) / span;
    if (a <= 0.004) { alpha[i] = Math.abs(r - g) <= 8 && Math.abs(r - b) <= 8 ? 0 : -1; continue; }
    if (a > 0.32) { alpha[i] = -1; continue; }
    const c = (r - a * PIG[0]) / (1 - a);
    alpha[i] = Math.abs(g - (a * PIG[1] + (1 - a) * c)) <= 7 ? a : -1;
    if (alpha[i] > 0.06) hist[Math.min(63, Math.round(alpha[i] * 200))]++;
  }
  // The pig's own strength: the commonest under it
  let top = 0;
  for (let i = 1; i < 64; i++) if (hist[i] > hist[top]) top = i;
  const A0 = hist[top] > 200 ? top / 200 : 0;
  if (!A0) return img; // no pig on this sheet
  // Inside the pig: pixels at (nearly) its full strength, the small gaps in it (a coloured line crossing it) closed
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = alpha[i] >= A0 * 0.75 ? 1 : 0;
  const closed = boxPass(boxPass(inside, w, h, 4, true), w, h, 4, false);
  // Only there (and its soft edge, 3px out): a warm colour of the drawing's own elsewhere (a beige fill) stays as it is
  const pig = boxPass(closed, w, h, 3, true);
  for (let i = 0; i < n; i++) {
    if (!pig[i]) continue;
    const k = i * 4;
    const a = alpha[i];
    if (a > 0) {
      const c = Math.max(0, Math.min(255, Math.round((d[k] - a * PIG[0]) / (1 - a))));
      d[k] = d[k + 1] = d[k + 2] = c;
    } else if (a < 0 && closed[i]) {
      for (let j = 0; j < 3; j++) d[k + j] = Math.max(0, Math.min(255, Math.round((d[k + j] - A0 * PIG[j]) / (1 - A0))));
    }
  }
  return img;
}

/**
 * The existing cut A and the proposed cut B (B reaching further each way: its pixel (x, y) is the existing sheet's
 * (x − ox, y − oy) in A's terms), lined up: the proposed picture the same size as A with its drawing on A's, both with
 * the pig taken out. null: they don't line up
 */
export function lineUp(A: Pixels, Bwide: Pixels, ox: number, oy: number): { before: Pixels; after: Pixels; dx: number; dy: number; overlap: number } | null {
  const ad = maskOf(A), bd = maskOf(Bwide);
  // 1. Every STEP pixels across the whole reach, a line counting as landing within STEP / 2 of one (B's lines
  //    thickened), so no shift between two tried is missed. 2. Every pixel near the best of those, exactly
  const near = bestShift(ad, A.width, A.height, boxPass(bd, Bwide.width, Bwide.height, STEP / 2, true), Bwide.width, Bwide.height, ox, oy, 0, 0, REACH, STEP, 4000);
  const fine = bestShift(ad, A.width, A.height, bd, Bwide.width, Bwide.height, ox, oy, near.dx, near.dy, STEP / 2 + 1, 1, 40000);
  if (fine.overlap < MIN_OVERLAP) return null;
  // The proposed picture: the same size as the existing one, its drawing on the existing one's (white past its sheet)
  const w = A.width, h = A.height;
  const B: Pixels = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) };
  const sx = ox + fine.dx, sy = oy + fine.dy;
  for (let y = 0; y < h; y++) {
    const fy = y + sy;
    if (fy < 0 || fy >= Bwide.height) continue;
    for (let x = 0; x < w; x++) {
      const fx = x + sx;
      if (fx < 0 || fx >= Bwide.width) continue;
      const o = (y * w + x) * 4, f = (fy * Bwide.width + fx) * 4;
      B.data[o] = Bwide.data[f]; B.data[o + 1] = Bwide.data[f + 1]; B.data[o + 2] = Bwide.data[f + 2]; B.data[o + 3] = Bwide.data[f + 3];
    }
  }
  return { before: withoutPig(A), after: withoutPig(B), dx: fine.dx, dy: fine.dy, overlap: fine.overlap };
}
