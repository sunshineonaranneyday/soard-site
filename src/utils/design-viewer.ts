/**
 * design-viewer.ts — the design viewer's pictures: swipe, zoom, compare
 * =====================================================================
 * The live page's design viewer (LiveDesign.astro, opened by live-design.ts)
 * shows the room's pictures one at a time, big. This is the part that holds
 * them and answers the hands, as the phone's own photo viewer does:
 *
 *   - A strip of panes, one per picture. A sideways drag moves the strip with
 *     the finger (the next picture comes in beside it); let go past a fifth of
 *     the way, or with a flick, it goes on, else it springs back. At either
 *     end it gives a little and springs back (no wrapping round).
 *   - Pinch, a double tap or double click, Ctrl/⌘ + the wheel (a trackpad's
 *     pinch) or + and − zoom the picture itself, about the fingers or the
 *     pointer, up to where a pixel of the picture is bigger than a pixel of
 *     the screen; one finger then moves it about, and it never leaves a gap
 *     at an edge. A whole plan sheet's double tap goes to its drawing (and
 *     back), as its Zoom in button does.
 *   - A drag down (a touch, not zoomed) lifts the picture away with the
 *     background fading; let go far enough and the viewer closes.
 *   - The plan's compare (plan-compare.ts): a drag on it moves its line; once
 *     zoomed, only a drag that starts on the line does, any other moves it.
 *   - Each pane shows a small copy at once (the one already loaded in the
 *     strip or the section) and its big one fades in over it, so a badge and
 *     a caption never sit on the wrong picture. The pictures either side are
 *     fetched before they're needed.
 *   - It opens from the card that was tapped, the picture growing out of it
 *     (and goes back into it), unless motion is reduced.
 */
import { attachCompare, type CompareHandle } from './compare-slider';
import { compareFor } from './plan-compare';
import { compareHtml, type PartKey } from './live-design-html';
import { compareRatio, focusOf, knownRatio, type DesignSlide, type PlanPair } from './reveal-design-client';
import { MOTION } from './motion';

export type GalleryItem =
  | { kind: 'slide'; s: DesignSlide; part: PartKey }
  | { kind: 'compare'; pair: PlanPair; part: PartKey };

export interface GalleryHooks {
  /** A slide's picture at about w pixels across (null: it can't be had) */
  src(s: DesignSlide, w: number): Promise<string | null>;
  /** A small copy already loaded somewhere on the page, to stand in at once */
  small(s: DesignSlide): string | null;
  /** The picture showing changed */
  onChange(i: number): void;
  /** Zoomed or not, and whether this picture zooms to a drawing (the Zoom in / Whole sheet button) */
  onZoom(zoomed: boolean, sheet: boolean): void;
  /** Dragged down far enough: close */
  onDismiss(): void;
  /** While being dragged down, how far (0–1): the background fades */
  onDismissProgress(p: number): void;
  /** A picture that can't load */
  onFail(s: DesignSlide): void;
  /** The plan's compare can't be made: the caller drops it */
  onCompareFail(pair: PlanPair): void;
  /** Where the compare's line was left on the page (0–100), so the big one starts there; null: it sweeps in */
  comparePos(): number | null;
  /** The viewer's compare line moved (the page's follow it) */
  onCompareMove(pos: number): void;
}

interface Pane {
  item: GalleryItem;
  el: HTMLElement;
  fly: HTMLElement;
  /** What's zoomed: the picture (a slide's), or the compare's two pictures (its line and labels stay their size) */
  zoom: HTMLElement;
  /** The picture's own height ÷ width, once known */
  ratio: number | null;
  /** The size it fits in the pane at (k = 1), and the zoom: x, y where its top left is, k its scale */
  cw: number; ch: number;
  k: number; x: number; y: number;
  loaded: number;
  /** How big the picture showing is (1 small, 2 big, 3 the biggest): a later, smaller one never replaces it */
  shownLevel: number;
  /** Opened at its drawing (toDrawing): the pane's size settling keeps it there, until it's zoomed by hand or left */
  drawing?: boolean;
  img?: HTMLImageElement;
  cmp?: { root: HTMLElement; handle: CompareHandle | null; ready: boolean };
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = MOTION.move;
/** The gap between two pictures while one slides in */
const GAP = 24;

export function createGallery(stage: HTMLElement, hooks: GalleryHooks) {
  const track = document.createElement('div');
  track.className = 'ldg-track';
  stage.append(track);
  let panes: Pane[] = [];
  let at = 0;
  let pw = 0, ph = 0;

  const kindOf = (it: GalleryItem) => (it.kind === 'compare' ? 'compare' : it.s.kind === 'before' ? 'photo' : focusOf(it.s) ? 'sheet' : 'paper');

  function setItems(items: GalleryItem[], start: number) {
    for (const p of panes) p.cmp?.handle?.destroy();
    panes = items.map((item) => {
      const el = document.createElement('div');
      el.className = 'ldg-pane';
      el.dataset.kind = kindOf(item);
      const fly = document.createElement('div');
      fly.className = 'ldg-fly';
      let zoom: HTMLElement = document.createElement('div');
      zoom.className = 'ldg-zoom';
      fly.append(zoom);
      el.append(fly);
      const p: Pane = { item, el, fly, zoom, ratio: null, cw: 0, ch: 0, k: 1, x: 0, y: 0, loaded: 0, shownLevel: 0 };
      if (item.kind === 'slide') {
        const s = item.s;
        p.ratio = knownRatio(s);
        const img = document.createElement('img');
        img.className = 'ldg-img';
        img.alt = s.alt.replace(/’/g, "'");
        img.decoding = 'async';
        img.draggable = false;
        zoom.append(img);
        p.img = img;
      } else {
        // The compare fills the pane; its two pictures are what zooms, its line drawn over them at the place it marks
        p.ratio = compareRatio(item.pair);
        zoom.className = 'ldg-cmp';
        zoom.innerHTML = compareHtml(item.pair, false, 'pcmp--viewer');
        const root = zoom.firstElementChild as HTMLElement;
        p.cmp = { root, handle: null, ready: false };
        p.zoom = zoom = root.querySelector<HTMLElement>('[data-pcmp="pics"]')!;
      }
      return p;
    });
    track.replaceChildren(...panes.map((p) => p.el));
    at = Math.max(0, Math.min(start, panes.length - 1));
    layout();
    place(false);
    warm();
  }

  // ── Sizes ──
  function fitPane(p: Pane) {
    // (a photo whose shape isn't known yet fills the pane, the picture fitted inside it: the same place it ends up)
    const r = p.ratio;
    const cw = r ? Math.min(pw, ph / r) : pw;
    p.cw = cw; p.ch = r ? cw * r : ph;
    p.zoom.style.width = `${p.cw}px`;
    p.zoom.style.height = `${p.ch}px`;
    p.k = 1;
    p.x = (pw - p.cw) / 2; p.y = (ph - p.ch) / 2;
    if (p.drawing) { zoomIn(p, pw / 2, ph / 2, false); return; }
    paint(p, false);
  }
  function layout() {
    if (!stage.clientWidth || !stage.clientHeight) return;
    pw = stage.clientWidth; ph = stage.clientHeight;
    panes.forEach((p, i) => { p.el.style.left = `${i * (pw + GAP)}px`; p.el.style.width = `${pw}px`; fitPane(p); });
    place(false);
  }

  // ── Zoom ──
  const maxK = (p: Pane) => {
    if (p.item.kind === 'compare') return Math.max(2, Math.min(6, (p.cmp?.root.querySelector<HTMLImageElement>('[data-pcmp="before"]')?.naturalWidth || 1400) / p.cw * 1.5));
    const natural = p.item.s.w || p.img?.naturalWidth || 2400;
    return Math.max(2, Math.min(6, (Math.max(natural, 2400) / p.cw) * 1.25));
  };
  function clamp(p: Pane) {
    p.k = Math.max(1, Math.min(maxK(p), p.k));
    const w = p.cw * p.k, h = p.ch * p.k;
    p.x = w <= pw ? (pw - w) / 2 : Math.min(0, Math.max(pw - w, p.x));
    p.y = h <= ph ? (ph - h) / 2 : Math.min(0, Math.max(ph - h, p.y));
  }
  function paint(p: Pane, animate: boolean) {
    p.zoom.style.transition = animate && !reduced() ? `transform ${MOTION.medium}ms ${EASE}` : 'none';
    p.zoom.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${p.k.toFixed(4)})`;
    if (p.cmp) placeLine(p, animate);
    if (panes[at] === p) hooks.onZoom(p.k > 1.01, p.item.kind === 'slide' && !!focusOf(p.item.s));
    if (p.k > 1.4) sharpen(p);
  }
  function zoomAt(p: Pane, k: number, cx: number, cy: number, animate = true) {
    p.drawing = false;
    // The point under (cx, cy) stays there: the scale's limits first, then the move about the point, then the edges
    const k1 = Math.max(1, Math.min(maxK(p), k));
    const f = k1 / p.k;
    p.x = cx - (cx - p.x) * f;
    p.y = cy - (cy - p.y) * f;
    p.k = k1;
    clamp(p);
    paint(p, animate);
  }
  function reset(p: Pane, animate = true) { p.drawing = false; p.k = 1; clamp(p); paint(p, animate); }
  /** A whole sheet's drawing filling the pane (its Zoom in), else twice as big about the middle */
  function zoomIn(p: Pane, cx = pw / 2, cy = ph / 2, animate = true) {
    const f = p.item.kind === 'slide' ? focusOf(p.item.s) : null;
    if (f) {
      p.k = Math.max(1, Math.min(pw / (f.w * p.cw), ph / (f.h * p.ch)) * 0.94);
      p.x = pw / 2 - p.k * (f.x + f.w / 2) * p.cw;
      p.y = ph / 2 - p.k * (f.y + f.h / 2) * p.ch;
      clamp(p);
      paint(p, animate);
      return;
    }
    // (a point outside the picture zooms about the nearest point of it)
    zoomAt(p, 2.5, Math.max(p.x, Math.min(p.x + p.cw * p.k, cx)), Math.max(p.y, Math.min(p.y + p.ch * p.k, cy)));
  }
  function toggleZoom(cx?: number, cy?: number) {
    const p = panes[at];
    if (!p) return;
    if (p.k > 1.01) reset(p); else zoomIn(p, cx, cy);
  }

  // ── Pictures ──
  async function load(p: Pane, big: boolean) {
    const want = big ? 2 : 1;
    if (p.loaded >= want) return;
    p.loaded = want;
    if (p.cmp) {
      if (!big || p.cmp.ready) return;
      const pair = (p.item as { pair: PlanPair }).pair;
      const made = await compareFor(pair);
      if (!panes.includes(p)) return; // (the pictures changed meanwhile)
      if (!made) { hooks.onCompareFail(pair); return; }
      const a = p.cmp.root.querySelector<HTMLImageElement>('[data-pcmp="before"]')!;
      const b = p.cmp.root.querySelector<HTMLImageElement>('[data-pcmp="after"]')!;
      a.src = made.before; b.src = made.after;
      await Promise.all([a.decode?.().catch(() => {}), b.decode?.().catch(() => {})]);
      if (!panes.includes(p) || !p.cmp) return;
      p.cmp.ready = true;
      p.cmp.root.dataset.state = 'ready';
      if (!p.cmp.handle) p.cmp.handle = wireCompare(p);
      return;
    }
    const s = (p.item as { s: DesignSlide }).s;
    const img = p.img!;
    const small = hooks.small(s);
    if (small && !p.shownLevel) { img.src = small; p.shownLevel = 1; if (!p.ratio) noteRatio(p, img); }
    if (!big) return;
    const dpr = devicePixelRatio || 1;
    const f = focusOf(s);
    // A whole sheet big enough that its drawing is sharp when zoomed to it; a photo as big as the screen
    const w = f ? Math.min(s.w || 3200, 3200, Math.round((Math.max(innerWidth, innerHeight) * dpr) / Math.max(f.w, 0.2)))
      : Math.min(2400, Math.round(Math.max(innerWidth, innerHeight) * dpr));
    const src = await hooks.src(s, w);
    if (!src) { hooks.onFail(s); return; }
    const pre = new Image();
    pre.decoding = 'async';
    pre.src = src;
    try { await pre.decode(); } catch { if (!pre.naturalWidth) { if (panes.includes(p)) hooks.onFail(s); return; } }
    if (!panes.includes(p)) return;
    if (p.shownLevel < 2) { img.src = src; p.shownLevel = 2; }
    if (!p.ratio && pre.naturalWidth) { p.ratio = pre.naturalHeight / pre.naturalWidth; fitPane(p); }
  }
  function noteRatio(p: Pane, img: HTMLImageElement) {
    const done = () => { if (!p.ratio && img.naturalWidth) { p.ratio = img.naturalHeight / img.naturalWidth; fitPane(p); } };
    if (img.complete) done(); else img.addEventListener('load', done, { once: true });
  }
  /** Zoomed in a lot: the biggest copy there is */
  function sharpen(p: Pane) {
    if (p.item.kind !== 'slide' || p.loaded >= 3) return;
    p.loaded = 3;
    const s = p.item.s;
    void hooks.src(s, Math.min(focusOf(s) ? s.w || 3200 : 3200, 3200)).then((src) => {
      if (!src || !p.img) return;
      const pre = new Image(); pre.src = src;
      pre.decode().then(() => { if (p.img && panes.includes(p) && p.shownLevel < 3) { p.img.src = src; p.shownLevel = 3; } }).catch(() => {});
    });
  }
  /** The one showing and its neighbours big, the next ones out small */
  function warm() {
    panes.forEach((p, i) => {
      const d = Math.abs(i - at);
      if (d <= 1) void load(p, true); else if (d === 2) void load(p, false);
    });
  }

  // ── Moving between them ──
  let trackX = 0;
  function place(animate: boolean, extra = 0) {
    // Only the one showing can be reached (Tab, a screen reader): focus in one beside it would scroll the strip
    panes.forEach((p, i) => { p.el.inert = i !== at; });
    trackX = -at * (pw + GAP) + extra;
    track.style.transition = animate && !reduced() ? `transform ${MOTION.medium}ms ${EASE}` : 'none';
    track.style.transform = `translate3d(${trackX.toFixed(1)}px, 0, 0)`;
  }
  function go(i: number, animate = true) {
    const next = Math.max(0, Math.min(panes.length - 1, i));
    if (next !== at) {
      const was = panes[at];
      if (was) reset(was, false);
      at = next;
      hooks.onChange(at);
      warm();
    }
    place(animate);
    const p = panes[at];
    if (p) hooks.onZoom(p.k > 1.01, p.item.kind === 'slide' && !!focusOf(p.item.s));
  }

  // ── The plan's compare ──
  /** Its line at the place it marks on the zoomed pictures, its labels on the pictures' visible corners */
  // (at: the line's place as the slider has just set it. While the slider is being made, the pane doesn't hold it yet, and
  // a compare opened where the line was left on the page (not the middle) had its pictures cut there and its line and knob
  // drawn in the middle until the first drag, Nov 20 2026)
  function placeLine(p: Pane, animate = false, at?: number) {
    const root = p.cmp!.root;
    const pos = at ?? p.cmp!.handle?.pos ?? 50;
    const left = Math.max(0, p.x), right = Math.min(pw, p.x + p.cw * p.k), top = Math.max(0, p.y), bottom = Math.min(ph, p.y + p.ch * p.k);
    const lineX = p.x + (p.k * p.cw * pos) / 100;
    root.style.setProperty('--line', `${lineX.toFixed(1)}px`);
    root.style.setProperty('--knob-dx', `${(Math.max(left + 23, Math.min(right - 23, lineX)) - lineX).toFixed(1)}px`);
    root.style.setProperty('--pics-l', `${left.toFixed(1)}px`);
    root.style.setProperty('--pics-r', `${(pw - right).toFixed(1)}px`);
    root.style.setProperty('--pics-t', `${top.toFixed(1)}px`);
    root.style.setProperty('--pics-b', `${(ph - bottom).toFixed(1)}px`);
    root.toggleAttribute('data-moving', !animate);
  }
  function wireCompare(p: Pane): CompareHandle | null {
    const root = p.cmp!.root;
    const pics = root.querySelector<HTMLElement>('[data-pcmp="pics"]');
    const from = hooks.comparePos();
    const h = attachCompare(root, {
      range: root.querySelector<HTMLInputElement>('[data-pcmp="range"]'),
      labelBefore: root.querySelector<HTMLElement>('[data-pcmp="tag-before"]'),
      labelAfter: root.querySelector<HTMLElement>('[data-pcmp="tag-after"]'),
      // (it starts where the line was left on the page; it sweeps in only if no one has seen it yet)
      intro: from == null,
      onTap: () => {},
      onMove: (pos) => { placeLine(p, false, pos); hooks.onCompareMove(pos); },
      // A finger moves the line only from the line itself: anywhere else it swipes on to the next picture, drags down to
      // close, or (zoomed) moves the picture, as on any other. A mouse drags it from anywhere, unless it's zoomed
      grabs: (e) => grabsLine(p, e),
      posAt: (x) => {
        const r = (pics || root).getBoundingClientRect();
        return r.width ? ((x - r.left) / r.width) * 100 : 50;
      },
    });
    if (from != null) h.set(from);
    return h;
  }
  const grabsLine = (p: Pane, e: PointerEvent) => (e.pointerType === 'mouse' ? p.k <= 1.01 || nearLine(p, e.clientX) : nearLine(p, e.clientX, 36));
  const nearLine = (p: Pane, clientX: number, reach = 28) => {
    const pics = p.cmp?.root.querySelector<HTMLElement>('[data-pcmp="pics"]');
    if (!pics || !p.cmp?.handle) return false;
    const r = pics.getBoundingClientRect();
    // (the knob is kept inside the picture at either end, so it's grabbed where it's drawn)
    const x = Math.max(r.left + 23, Math.min(r.right - 23, r.left + (r.width * p.cmp.handle.pos) / 100));
    return Math.abs(clientX - x) <= reach;
  };

  // ── Hands ──
  const pointers = new Map<number, { x: number; y: number }>();
  let g: null | {
    mode: 'undecided' | 'swipe' | 'pan' | 'dismiss' | 'pinch' | 'line';
    x0: number; y0: number; t0: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number;
    px0?: number; py0?: number; k0?: number; d0?: number; mx0?: number; my0?: number; touch: boolean;
  } = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  // Whether the last press ended a drag (a swipe, a move, a pinch), so the click that follows it isn't taken as a tap
  let lastWasDrag = false;
  // What the last press was made with (a touch's double tap is handled here; the browser's dblclick after it isn't)
  let lastPointer = 'mouse';
  const local = (x: number, y: number) => { const r = stage.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
  const onCompare = (e: PointerEvent) => !!(e.target as Element)?.closest?.('[data-pcmp]');

  function onDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    lastPointer = e.pointerType;
    if ((e.target as Element)?.closest?.('button, a, input')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = panes[at];
    if (!p) return;
    if (pointers.size === 2) {
      // Two fingers: a pinch, whatever one finger was doing (a drag down put back, a swipe back in place)
      p.cmp?.handle?.cancel?.();
      p.fly.style.transition = 'none';
      p.fly.style.transform = '';
      hooks.onDismissProgress(0);
      const [a, b] = [...pointers.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      g = { mode: 'pinch', x0: m.x, y0: m.y, t0: performance.now(), lastX: m.x, lastY: m.y, lastT: performance.now(), vx: 0, vy: 0, k0: p.k, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, px0: p.x, py0: p.y, mx0: m.x, my0: m.y, touch: true };
      place(false);
      return;
    }
    if (pointers.size > 2) return;
    // The compare's own line takes this one
    if (p.cmp && onCompare(e) && p.cmp.handle && grabsLine(p, e)) { g = { mode: 'line', x0: e.clientX, y0: e.clientY, t0: performance.now(), lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0, touch: e.pointerType !== 'mouse' }; return; }
    // (the stage takes the pointer only once it's a drag: a click stays the picture's, or the dark's around it)
    g = { mode: 'undecided', x0: e.clientX, y0: e.clientY, t0: performance.now(), lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0, px0: p.x, py0: p.y, touch: e.pointerType !== 'mouse' };
  }
  function onMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = panes[at];
    if (!g || !p) return;
    if (g.mode === 'line') return;
    // (moved or pinched by hand: it stays where it's put)
    if (g.mode === 'pinch' || g.mode === 'pan') p.drawing = false;
    if (g.mode === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const k = Math.max(0.85, Math.min(maxK(p) * 1.15, g.k0! * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0!)));
      // The point under the fingers' middle stays under it, and follows it
      const f = k / g.k0!;
      p.k = k;
      p.x = m.x - (g.mx0! - g.px0!) * f;
      p.y = m.y - (g.my0! - g.py0!) * f;
      paint(p, false);
      return;
    }
    const now = performance.now();
    const dt = Math.max(1, now - g.lastT);
    g.vx = (e.clientX - g.lastX) / dt; g.vy = (e.clientY - g.lastY) / dt;
    g.lastX = e.clientX; g.lastY = e.clientY; g.lastT = now;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (g.mode === 'undecided') {
      if (Math.hypot(dx, dy) < 8) return;
      if (p.k > 1.01) g.mode = 'pan';
      else if (Math.abs(dx) >= Math.abs(dy)) g.mode = panes.length > 1 ? 'swipe' : 'undecided';
      else if (g.touch && dy > 0) g.mode = 'dismiss';
      if (g.mode === 'undecided') return;
      try { stage.setPointerCapture(e.pointerId); } catch { /* gone */ }
    }
    if (g.mode === 'swipe') {
      // At either end it gives a third as much
      const end = (at === 0 && dx > 0) || (at === panes.length - 1 && dx < 0);
      place(false, end ? dx / 3 : dx);
    } else if (g.mode === 'pan') {
      p.x = g.px0! + dx; p.y = g.py0! + dy;
      clamp(p);
      paint(p, false);
    } else if (g.mode === 'dismiss') {
      const d = Math.max(0, dy);
      p.fly.style.transition = 'none';
      p.fly.style.transform = `translate3d(${(dx * 0.4).toFixed(1)}px, ${d.toFixed(1)}px, 0) scale(${Math.max(0.8, 1 - d / 1600).toFixed(4)})`;
      hooks.onDismissProgress(Math.min(1, d / 320));
    }
  }
  function onUp(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const pt = pointers.get(e.pointerId)!;
    pointers.delete(e.pointerId);
    try { stage.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    const p = panes[at];
    if (!g || !p) return;
    const cancel = e.type === 'pointercancel';
    if (g.mode === 'pinch') {
      if (pointers.size) return; // until the last finger lifts
      g = null;
      lastWasDrag = true;
      if (p.k < 1.02) reset(p); else { clamp(p); paint(p, true); }
      return;
    }
    const dx = pt.x - g.x0, dy = pt.y - g.y0;
    const mode = g.mode;
    const vx = g.vx, vy = g.vy;
    const tapped = (mode === 'undecided' || mode === 'line') && Math.hypot(dx, dy) < 8 && performance.now() - g.t0 < 400;
    lastWasDrag = Math.hypot(dx, dy) >= 8;
    g = null;
    if (cancel) { place(true); p.fly.style.transform = ''; hooks.onDismissProgress(0); return; }
    if (mode === 'swipe') {
      const far = Math.abs(dx) > pw * 0.18 || Math.abs(vx) > 0.45;
      go(far ? at + (dx < 0 ? 1 : -1) : at);
      return;
    }
    if (mode === 'dismiss') {
      if (dy > 110 || vy > 0.6) { hooks.onDismiss(); return; }
      p.fly.style.transition = reduced() ? 'none' : `transform ${MOTION.short}ms ${EASE}`;
      p.fly.style.transform = '';
      hooks.onDismissProgress(0);
      return;
    }
    if (tapped) {
      // A double tap (or a double click, below): zoom there, or back
      const now = Date.now();
      const l = local(pt.x, pt.y);
      if (e.pointerType !== 'mouse' && now - lastTap.t < 320 && Math.hypot(l.x - lastTap.x, l.y - lastTap.y) < 30) { lastTap.t = 0; toggleZoom(l.x, l.y); } else lastTap = { t: now, x: l.x, y: l.y };
    }
  }
  const onDbl = (e: MouseEvent) => {
    if (lastPointer !== 'mouse') { e.preventDefault(); return; }
    if ((e.target as Element)?.closest?.('button, a, input')) return;
    if (!(e.target as Element)?.closest?.('.ldg-zoom, [data-pcmp]')) return;
    e.preventDefault();
    const l = local(e.clientX, e.clientY);
    toggleZoom(l.x, l.y);
  };
  // Ctrl/⌘ + the wheel (and a trackpad's pinch, which arrives as one): zoom about the pointer. The wheel alone, zoomed:
  // move the picture about
  const onWheel = (e: WheelEvent) => {
    const p = panes[at];
    if (!p) return;
    e.preventDefault();
    const l = local(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) { zoomAt(p, p.k * Math.exp(-e.deltaY * 0.01), l.x, l.y, false); return; }
    if (p.k > 1.01) { p.drawing = false; p.x -= e.deltaX; p.y -= e.deltaY; clamp(p); paint(p, false); }
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('dblclick', onDbl);
  stage.addEventListener('wheel', onWheel, { passive: false });
  // (the browser's own pinch and double-tap zoom of the page stay out of it)
  const sizeWatch = new ResizeObserver(() => { if (stage.clientWidth !== pw || stage.clientHeight !== ph) layout(); });
  sizeWatch.observe(stage);

  // ── Opening from a card, closing back into it ──
  /** Where the picture shows in its pane, on screen */
  function shownRect(p: Pane) {
    const r = stage.getBoundingClientRect();
    return new DOMRect(r.left + p.x, r.top + p.y, p.cw * p.k, p.ch * p.k);
  }
  function flyFrom(from: DOMRect | null) {
    const p = panes[at];
    if (!p || !from || !from.width || reduced()) return;
    const to = shownRect(p);
    if (!to.width) return;
    const s = from.width / to.width;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    p.fly.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: MOTION.medium, easing: EASE });
  }
  function flyTo(to: DOMRect | null): Promise<void> {
    const p = panes[at];
    if (!p || reduced()) return Promise.resolve();
    const from = shownRect(p);
    if (!to || !to.width || !from.width || to.bottom < 0 || to.top > innerHeight) {
      return p.fly.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], { duration: MOTION.quick, easing: MOTION.fade, fill: 'forwards' }).finished.then(() => {}, () => {});
    }
    const s = to.width / from.width;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const now = getComputedStyle(p.fly).transform;
    return p.fly.animate([{ transform: now === 'none' ? 'none' : now }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], { duration: MOTION.short, easing: EASE, fill: 'forwards' }).finished.then(() => {}, () => {});
  }

  return {
    setItems,
    go,
    get index() { return at; },
    get item(): GalleryItem | null { return panes[at]?.item || null; },
    get zoomed() { return (panes[at]?.k || 1) > 1.01; },
    get wasDrag() { return lastWasDrag; },
    toggleZoom: () => toggleZoom(),
    /** The sheet showing opened at its drawing, at once (opened from a picture of only its drawing: "see it big" is
     *  bigger, never the drawing smaller on its whole sheet); Zoom out shows the whole sheet */
    toDrawing() { const p = panes[at]; if (p && p.item.kind === 'slide' && focusOf(p.item.s)) { p.drawing = true; if (p.cw) zoomIn(p, pw / 2, ph / 2, false); } },
    zoomBy(f: number) { const p = panes[at]; if (p) zoomAt(p, p.k * f, pw / 2, ph / 2); },
    layout,
    flyFrom,
    flyTo,
    /** Back to rest: no zoom, no drag, nothing lifted (the viewer closing) */
    settle() {
      g = null;
      pointers.clear();
      for (const p of panes) { p.fly.getAnimations().forEach((a) => a.cancel()); p.fly.style.transform = ''; p.fly.style.transition = ''; reset(p, false); }
      hooks.onDismissProgress(0);
    },
    /** A pane's compare (to replay its sweep) */
    compareAt(i: number) { return panes[i]?.cmp?.handle || null; },
    destroy() {
      sizeWatch.disconnect();
      for (const p of panes) p.cmp?.handle?.destroy();
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('dblclick', onDbl);
      stage.removeEventListener('wheel', onWheel);
      track.remove();
    },
  };
}
export type Gallery = ReturnType<typeof createGallery>;
