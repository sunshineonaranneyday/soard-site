/**
 * compare-slider.ts — one picture over another, a line between them to drag
 * ==========================================================================
 * The site's before/after slider, as one behaviour: the kid page's
 * Transformation (a room's before and after photos) and the live page's plan
 * (the existing and the proposed floor plan) both use it.
 *
 *   - Drag anywhere on the picture: the line follows the finger or the mouse,
 *     and keeps going a little when let go with speed, springing back off
 *     either edge (the kid page's physics, unchanged).
 *   - A double tap brings the line back to the middle.
 *   - With onTap, a tap that isn't a drag (a click) is the caller's instead
 *     (the live page opens the picture big).
 *   - The keyboard: the range input (focused by Tab) moves it, Shift + an arrow
 *     by ten.
 *   - intro: the line starts at the right edge (all "before") and sweeps to the
 *     middle once the picture is well in sight, so it's plain there's a second
 *     picture under it. Never with reduced motion.
 *
 * Position is 0–100 (the before picture's share, from the left), written to
 * the container as a CSS variable (`--ba-pos` by default) and to the range.
 */

const FRICTION = 0.92, MIN_VEL = 0.1, SPRING = 0.15, VEL_SCALE = 0.4;
/** How far a press can move and still be a tap */
const TAP_SLOP = 6;

export interface CompareOptions {
  /** The range input that carries the position for the keyboard and a screen reader */
  range?: HTMLInputElement | null;
  /** The two labels on the picture: each fades when the line comes close to its side */
  labelBefore?: HTMLElement | null;
  labelAfter?: HTMLElement | null;
  /** The CSS variable the position is written to */
  varName?: string;
  /** Sweep in from the right edge once it's in sight (and introReady says its pictures are there) */
  intro?: boolean;
  /** Whether the pictures are in, so the sweep shows something (default: yes). The caller calls intro() once they are */
  introReady?: () => boolean;
  /** A tap (no drag): the caller's. Without it, a double tap centres the line */
  onTap?: (e: PointerEvent) => void;
  /** Called on every move, with the position (0–100) */
  onMove?: (pos: number) => void;
  /** Whether a press here should move the line (default: always). false leaves it to the page (a pan, a swipe) */
  grabs?: (e: PointerEvent) => boolean;
  /** Where the line is for a pointer at clientX (default: across the container's own box) */
  posAt?: (clientX: number) => number;
}

export interface CompareHandle {
  /** Where the line is (0–100) */
  readonly pos: number;
  /** Move the line; animate: glide there */
  set(pos: number, animate?: boolean): void;
  /** The pictures are in: the sweep plays once it's in sight (at once if it is) */
  intro(): void;
  /** Let go of a drag in progress where the line is (a second finger came down: a pinch, the page's) */
  cancel(): void;
  destroy(): void;
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function attachCompare(container: HTMLElement, opts: CompareOptions = {}): CompareHandle {
  const { range = null, labelBefore = null, labelAfter = null, varName = '--ba-pos' } = opts;
  let pos = 50;
  let vel = 0;
  let raf = 0;
  let drag: { id: number; x0: number; y0: number; t0: number; moved: boolean; scrolled?: boolean; lastX: number; lastT: number; vels: number[] } | null = null;
  let lastTap = 0;
  let introPlayed = !opts.intro || reduced();
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  const update = (v: number, sync = true) => {
    pos = Math.max(0, Math.min(100, v));
    container.style.setProperty(varName, `${pos}%`);
    if (sync && range) range.value = String(Math.round(pos * 10) / 10);
    labelBefore?.toggleAttribute('data-fade', pos < 20);
    labelAfter?.toggleAttribute('data-fade', pos > 80);
    if (range) range.setAttribute('aria-valuetext', `${Math.round(pos)}% before, ${Math.round(100 - pos)}% after`);
    opts.onMove?.(pos);
  };
  const posAt = opts.posAt || ((x: number) => { const r = container.getBoundingClientRect(); return r.width ? ((x - r.left) / r.width) * 100 : pos; });

  const glide = (to: number, ms = 300, ease = (p: number) => 1 - Math.pow(1 - p, 3)) => {
    stop();
    if (reduced()) { update(to); return; }
    const from = pos;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / ms, 1);
      update(from + (to - from) * ease(p));
      raf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  };
  const momentum = () => {
    vel *= FRICTION;
    let p = pos + vel;
    if (p < 0) { p = 0; vel = -vel * SPRING; } else if (p > 100) { p = 100; vel = -vel * SPRING; }
    update(p);
    raf = Math.abs(vel) > MIN_VEL ? requestAnimationFrame(momentum) : 0;
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag) return;
    if ((e.target as HTMLElement).closest?.('button, a')) return;
    if (opts.grabs && !opts.grabs(e)) return;
    stop();
    vel = 0;
    // (someone has found the line: its sweep, still to come while its pictures load, never takes it from where they leave it)
    if (!introPlayed) { introPlayed = true; io?.disconnect(); }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, lastX: e.clientX, lastT: performance.now(), vels: [] };
    try { container.setPointerCapture(e.pointerId); } catch { /* a pointer already gone */ }
    container.classList.add('is-dragging');
    // (a mouse press would otherwise start a text or image drag; on a range laid over the picture, the kid page's, the
    // press is the range's own too: a click jumps the line there and gives the range the keyboard, as it always did)
    if (e.pointerType === 'mouse' && e.target !== range) e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    if (!drag.moved) {
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      // A finger going up or down is the page's (or a strip's) scroll, never the line: it waits for the browser to take
      // it (pointercancel) and it's no tap either. Before, the line leapt to the finger in the moves before the browser
      // took over (Nov 20 2026, the live page's plan on a phone). A mouse has no scroll to share: it always drags
      if (e.pointerType !== 'mouse' && Math.abs(dy) > Math.abs(dx)) { drag.scrolled = true; return; }
      if (drag.scrolled) return;
    }
    drag.moved = true;
    const dt = now - drag.lastT, dx = e.clientX - drag.lastX;
    const r = container.getBoundingClientRect();
    if (dt > 0 && r.width) { drag.vels.push(((dx / r.width) * 100 / dt) * 16); if (drag.vels.length > 5) drag.vels.shift(); }
    drag.lastX = e.clientX; drag.lastT = now;
    update(posAt(e.clientX));
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try { container.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    container.classList.remove('is-dragging');
    if (e.type === 'pointercancel') return;
    if (!d.moved) {
      if (d.scrolled) return;
      // A tap: the caller's, or (without one) a double tap centres the line
      if (opts.onTap) { opts.onTap(e); return; }
      const now = Date.now();
      if (now - lastTap < 300) { lastTap = 0; glide(50); } else lastTap = now;
      return;
    }
    if (d.vels.length && !reduced()) {
      vel = (d.vels.reduce((a, b) => a + b, 0) / d.vels.length) * VEL_SCALE;
      if (Math.abs(vel) > MIN_VEL) raf = requestAnimationFrame(momentum);
    }
  };
  // The keyboard: the range's own arrows (one step), with Shift ten
  const onInput = () => { if (range) { stop(); update(parseFloat(range.value), false); } };
  const onKey = (e: KeyboardEvent) => {
    if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    stop();
    update(pos + (e.key === 'ArrowLeft' ? -10 : 10));
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  range?.addEventListener('input', onInput);
  range?.addEventListener('keydown', onKey);

  // The sweep: from all "before" to the middle, overshooting a touch (the kid page's easeOutBack, 1.6 s)
  const easeOutBack = (t: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  let seen = typeof IntersectionObserver === 'undefined';
  const playIntro = () => {
    if (introPlayed || !seen || (opts.introReady && !opts.introReady())) return;
    introPlayed = true;
    io?.disconnect();
    // (someone already has hold of it: theirs)
    if (drag) return;
    update(100);
    glide(50, 1600, easeOutBack);
  };
  let io: IntersectionObserver | null = null;
  if (!introPlayed) {
    update(100);
    if (!seen) {
      io = new IntersectionObserver((list) => { if (list.some((x) => x.isIntersecting)) { seen = true; playIntro(); } }, { threshold: 0.4 });
      io.observe(container);
    } else playIntro();
  } else update(50);

  return {
    get pos() { return pos; },
    set(v: number, animate = false) { if (animate) glide(v); else { stop(); update(v); } },
    intro: playIntro,
    cancel() {
      if (!drag) return;
      try { container.releasePointerCapture(drag.id); } catch { /* gone */ }
      drag = null;
      container.classList.remove('is-dragging');
    },
    destroy() {
      stop();
      io?.disconnect();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      range?.removeEventListener('input', onInput);
      range?.removeEventListener('keydown', onKey);
    },
  };
}
