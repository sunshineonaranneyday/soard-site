/**
 * float.js — menus, dropdown lists and popovers that always draw on top
 * ===========================================================================
 * A pop-up opens in the browser's top layer (popover="manual"), so no sticky
 * bar, toast, clipping card or stacking context can cover it. It stays where
 * it is in the page, so focus, Tab order and events work as before. It is
 * pinned to its anchor: below it, or above when there's more room there, and
 * it scrolls inside when neither side fits. It follows the anchor whatever
 * moves it: the page scrolling, the window resizing, its own size changing,
 * and the anchor itself moving (content filling in above it, a late layout
 * shift). Once the anchor goes off screen or under a sticky bar, whatever
 * took it there (a scroll, content above it, the window getting shorter or a
 * tablet turned), it calls onHide, or without one it's hidden until the anchor
 * is back in view: never left over another part of the page. QA round 7, Nov
 * 21 2026: menus opened while a meeting's presentation list filled in above
 * stayed where they were, 35 px or more from their button, and at 768 wide
 * over other items. Round 8: a window made shorter left them open, cut off,
 * over other items. The one exception: a window made shorter, or turned, while
 * the focus is in a text box inside it (a phone's keyboard opening as someone
 * types in its search) leaves it open, placed inside what's visible
 * (visualViewport). A turn is a resize, with the scroll the browser fires as it
 * turns; a scroll that moves nothing never closes one (round 9).
 *
 *   const listRef = useMemo(() => floatRef({ align: 'stretch' }), []);
 *   html`<ul class="ppl-listbox" role="listbox" ref=${listRef}>…</ul>`
 *
 * Make the ref once per component (useMemo/useCallback): a new one on every
 * render would hide and re-show the pop-up each time.
 *
 * Options (an object, or a function returning one, read when it opens):
 *   anchor  element (or () => element) to pin to; default the box its CSS
 *           positions it against (its offsetParent), else its parent
 *   align   'stretch' takes the anchor's width (dropdown lists), 'end' lines
 *           up right edges, 'start' left edges
 *   width   px for 'start'/'end'; default the pop-up's own CSS width
 *   gap     px between anchor and pop-up (default 4)
 *   sheet   a media query under which the CSS places it (a phone bottom
 *           sheet): it's only lifted to the top layer
 *   onHide  called when the anchor is no longer visible (without it, the
 *           pop-up is hidden from view until the anchor is back)
 */

const EDGE = 8;
/** How long after a resize a scroll is still the browser's own, keeping the page in place as a tablet or phone turns (ms) */
const TURN_MS = 600;

/** A text box (where a phone's keyboard opens), the focus in it, inside `el` */
const typingIn = (el) => {
  const f = document.activeElement;
  return !!f && f !== el && el.contains(f) && (f.isContentEditable || f.tagName === 'TEXTAREA' || (f.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/i.test(f.type || '')));
};

// Undo the browser's own popover look (centered, bordered, padded) with no
// specificity, so each pop-up's class styles it as before, in any order
function addReset() {
  if (document.getElementById('float-reset')) return;
  const s = document.createElement('style');
  s.id = 'float-reset';
  s.textContent = ':where([popover]) { inset: auto; margin: 0; padding: 0; border: 0; width: auto; height: auto; overflow: visible; color: inherit; background: none; }';
  document.head.prepend(s);
}

// Under a sticky bar, or a fixed bar along the top (a toast doesn't count)
function underBar(n) {
  for (; n && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === 'sticky') return true;
    if (p === 'fixed') return n.getBoundingClientRect().top <= 1;
  }
  return false;
}

/** Is this off screen, or under a sticky bar or the top bar? (`pop` may sit over it) */
export function hiddenAnchor(a, pop) {
  const r = a.getBoundingClientRect();
  const y = r.top + r.height / 2;
  if (y < 0 || y >= innerHeight) return true;
  const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y);
  return !hit || (!a.contains(hit) && !pop?.contains(hit) && underBar(hit));
}

export function float(el, { anchor, align = 'stretch', width, gap = 4, sheet, onHide } = {}) {
  // By default the box its CSS placed it against (top: 100% of what?)
  const own = el.offsetParent || el.parentElement;
  const anchorEl = () => (typeof anchor === 'function' ? anchor() : anchor) || own;
  // Its CSS height limit, not the one the last open left on it (a pop-up kept in the page, opened again elsewhere)
  el.style.maxHeight = '';
  const cssMax = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
  const isSheet = () => !!sheet && matchMedia(sheet).matches;
  addReset();
  if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
  try { el.showPopover?.(); } catch { /* already showing */ }
  el.style.zIndex = '1010'; // only matters where there's no top layer

  // Where the anchor was when the pop-up was last placed, to know when it has moved
  let at = '';
  const spot = (r) => `${Math.round(r.top)} ${Math.round(r.left)} ${Math.round(r.width)} ${Math.round(r.height)}`;
  // `moved`: the anchor scrolled or moved since, or the window changed size (`resized`), so it may have gone out of view
  // (never on opening). A window made shorter while someone types in it is a phone's keyboard opening: it stays, kept
  // inside what's visible. A scroll closes it all the same (round 7's rule)
  const place = (moved, resized = false) => {
    const a = anchorEl();
    if (!a || !el.isConnected) return;
    const r = a.getBoundingClientRect();
    at = spot(r);
    if (isSheet()) {
      for (const k of ['position', 'boxSizing', 'top', 'left', 'right', 'bottom', 'width', 'maxHeight', 'overflowY', 'visibility']) el.style[k] = '';
      return;
    }
    const typing = typingIn(el);
    if (moved && !(resized && typing) && hiddenAnchor(a, el)) {
      if (onHide) {
        // (the focus that was in it goes back to its button, never to the page)
        const f = document.activeElement;
        if (f && el.contains(f)) (a.matches?.('button, summary, [tabindex]') ? a : a.querySelector?.('button, summary, [tabindex]:not([tabindex="-1"])'))?.focus({ preventScroll: true });
        onHide();
        return;
      }
      // (no onHide: out of view with its anchor, placed with it all the same, and back the moment it is)
      el.style.visibility = 'hidden';
    } else el.style.visibility = '';
    // border-box, so the width it's given is the width it measures (no creep)
    Object.assign(el.style, { position: 'fixed', boxSizing: 'border-box', right: 'auto', bottom: 'auto', left: '0px', top: '0px', maxHeight: 'none' });
    if (align === 'stretch' || width) el.style.width = `${Math.min(align === 'stretch' ? r.width : width, innerWidth - EDGE * 2)}px`;
    else el.style.width = '';
    const w = Math.min(el.offsetWidth, innerWidth - EDGE * 2);
    el.style.width = `${w}px`;
    const tall = Math.min(el.offsetHeight, cssMax);
    // What's visible: the window, or with someone typing in it, the part a phone's keyboard leaves (visualViewport)
    const vv = typing ? window.visualViewport : null;
    const top0 = vv ? vv.offsetTop : 0;
    const bottom0 = vv ? vv.offsetTop + vv.height : innerHeight;
    const below = bottom0 - r.bottom - gap - EDGE, above = r.top - top0 - gap - EDGE;
    const up = tall > below && above > below;
    const room = Math.max(up ? above : below, 120);
    const h = Math.min(tall, room);
    el.style.maxHeight = `${Math.min(cssMax, room)}px`;
    el.style.overflowY = tall > room ? 'auto' : ''; // cut short: it scrolls inside
    const y = up ? Math.max(top0 + EDGE, r.top - gap - h) : r.bottom + gap;
    // (typing, its anchor under the keyboard or above the view: inside what's visible all the same)
    el.style.top = `${typing ? Math.min(Math.max(y, top0 + EDGE), Math.max(top0 + EDGE, bottom0 - EDGE - Math.min(h, bottom0 - top0 - EDGE * 2))) : y}px`;
    const x = align === 'end' ? r.right - w : r.left;
    el.style.left = `${Math.max(EDGE, Math.min(x, innerWidth - w - EDGE))}px`;
    el.dataset.side = up ? 'top' : 'bottom';
  };

  // Whether the anchor is somewhere else than where the pop-up was last placed against it
  const moved = () => { const a = anchorEl(); return !!a?.isConnected && spot(a.getBoundingClientRect()) !== at; };
  let frame = 0;
  // A resize (or a turn) since it was last placed, and until when a scroll is the turn's own: turning a tablet or phone
  // resizes the window, then the browser scrolls to keep the page where it was, a frame or several later. What came in
  // one frame is placed once, as a resize when any of it was, never as only its last event's kind. Board QA round 9,
  // Nov 22 2026: a turn while typing in Who presents' search box closed it, the typing lost
  let resized = false;
  let turning = 0;
  const follow = (e) => {
    if (e?.target instanceof Node && el.contains(e.target)) return; // its own list scrolling
    const t = performance.now();
    if (e?.type === 'resize') { resized = true; turning = t + TURN_MS; } else if (e?.type === 'scroll' && t < turning) resized = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!el.isConnected) { stop(); return; }
      const turned = resized;
      resized = false;
      // (a resize or a turn counts as a move: a window made shorter takes the anchor out of view as a scroll does. A
      // scroll only when it moved the anchor: one that moves nothing never closes a pop-up)
      place(turned || moved(), turned);
    });
  };
  // Content that grows or shrinks (a list filtering as you type) is placed again
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => follow()) : null;
  ro?.observe(el);
  addEventListener('scroll', follow, true);
  addEventListener('resize', follow);
  // (a phone's keyboard changes only what's visible, not the window: placed again inside it)
  const vview = typeof window !== 'undefined' ? window.visualViewport : null;
  vview?.addEventListener('resize', follow);
  // The anchor moved with nothing scrolled or resized (something above it filled in, a late layout shift): each frame
  // while it's open, it's placed again once its anchor isn't where it was (an event's own placement goes first)
  let watch = 0;
  const look = () => {
    watch = requestAnimationFrame(look);
    if (frame) return;
    if (!el.isConnected) { stop(); return; }
    if (moved()) place(true);
  };
  place();
  watch = requestAnimationFrame(look);
  // Also runs on its own if the pop-up leaves the page while open
  function stop() {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(watch);
    el.style.visibility = '';
    ro?.disconnect();
    removeEventListener('scroll', follow, true);
    removeEventListener('resize', follow);
    vview?.removeEventListener('resize', follow);
    try { el.hidePopover?.(); } catch { /* already gone */ }
  }
  return stop;
}

/** A ref callback for preact: float() while the element is in the page */
export function floatRef(opts) {
  let stop = null;
  return (el) => {
    stop?.();
    stop = el ? float(el, typeof opts === 'function' ? opts() : opts) : null;
  };
}
