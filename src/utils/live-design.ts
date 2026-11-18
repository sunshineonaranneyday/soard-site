/**
 * live-design.ts — the room's design on a reveal's live page
 * ==========================================================
 * The page says which kid it's showing and what moment it's in (setKid: its
 * own kid, or on /live/ the one being revealed); this asks /api/reveal-design
 * for them, draws the room as it was and the plan once it's open (once the
 * reveal is confirmed), and asks again: when the moment changes (live,
 * replay), and every few minutes, so the confirm and a change in
 * Admin → Kids show up on their own.
 *
 * Two places, the same pictures:
 *   - The strip beside the video (LiveDesignRail.astro), during the watch
 *     party: the hero gets data-design while there's something to show, and
 *     its CSS makes room in the frame. The server marks the hero the same way
 *     at first paint, so the strip's place is there before the pictures.
 *   - "The design" under the hero (LiveDesign.astro), in three parts, each
 *     shown only when it has something:
 *       The room today   before photos ("The room before" once the reveal has started)
 *       The plan         the as-built and proposed drawings, side by side
 *       The look         the design boards
 *     Every picture carries its badge, on it, in each place (the section, the
 *     strip, the viewer): BEFORE on the room's photos, EXISTING and PROPOSED
 *     on the plans (Peter, Nov 11 2026).
 *     Each card keeps its picture's shape before the picture arrives (read off
 *     a tiny copy first), so nothing below it jumps.
 * A picture that can't load leaves both, and the viewer.
 *
 * What's downloaded (Peter, Nov 16 2026: "wicked fast"): each of the
 * section's pictures comes at the size it shows at on this screen (a photo
 * covering its card counts the part cropped off), never bigger than it was
 * before, and lazily; if the card grows (a phone turned) a bigger one is
 * taken. A tiny copy of each is read first, so one that can't load leaves at
 * once. The strip's pictures come only once it shows (the watch party, out of
 * full screen), all at once, so none pops in while it's scrolled.
 *
 * The viewer: any picture opens large. During the watch party the reveal
 * keeps playing in sight (Peter, Nov 9 2026: the design has to be seen
 * during the reveal): on a laptop the viewer opens beside the video, over
 * the messages, and the strip stays usable and marks the picture being
 * looked at; on a phone it fills the screen with the video held in a small
 * player in its top corner (a tap on it goes back). Otherwise it's a plain
 * full-screen viewer. The page holds still behind it either way.
 */
import { fetchDesign, slideSrc, designSignature, focusOf, isWholeSheet, knownRatio, type DesignSlide } from './reveal-design-client';
import { designPartsHtml, designPartsOf, designName, designLead, gridClass, partNote, possessive, straight, type PartKey } from './live-design-html';
import { holdPlace } from './hold-place';
import type { Stage } from './live-stage';
import { DESK } from './live-media';

const ASK_OPEN_MS = 3 * 60_000;
const ASK_CLOSED_MS = 10 * 60_000;
const ASK_FAILED_MS = 2 * 60_000;
/** The viewer opens beside the video only with at least this much room to its left */
const SIDE_MIN_W = 420;

/** The widths a card's picture is offered at; the browser takes the one it needs (sizes, set from the card) */
const WIDTHS = [320, 480, 640, 800, 960, 1200, 1600, 1800];
/** A card's picture as a set: every width up to most (what the card always took before). null: one that can't be had */
async function pictureSet(s: DesignSlide, most: number): Promise<{ src: string; srcset: string } | null> {
  const widths = [...WIDTHS.filter((w) => w < most && (!isWholeSheet(s) || !s.w || w <= s.w)), most];
  const urls = await Promise.all(widths.map((w) => slideSrc(s, w)));
  if (urls.some((u) => !u)) return null;
  return { src: urls[urls.length - 1]!, srcset: urls.map((u, i) => `${u} ${widths[i]}w`).join(', ') };
}

/** height ÷ width of a slide's picture as it will show, from a tiny copy of the same picture */
function shapeOf(s: DesignSlide): Promise<number | null> {
  return slideSrc(s, 96).then((src) => new Promise((done) => {
    if (!src) { done(null); return; }
    const img = new Image();
    img.onload = () => done(img.naturalWidth ? img.naturalHeight / img.naturalWidth : null);
    img.onerror = () => done(null);
    img.src = src;
  }));
}

interface Options {
  /** The live hero: data-design on it gives the strip its place during the watch party (data-party) */
  hero?: HTMLElement | null;
  /** The strip beside the video (LiveDesignRail.astro) */
  rail?: HTMLElement | null;
  /** The hero's frame, video and strip: on a laptop the viewer opens to its left */
  frame?: HTMLElement | null;
  /** The video: held in a small player while the viewer covers a phone's screen */
  stage?: Stage | null;
}

type ViewerMode = 'modal' | 'side' | 'pinned';

export function createLiveDesign(section: HTMLElement, opts: Options = {}) {
  const { hero = null, rail = null, frame = null, stage = null } = opts;
  const parts = section.querySelector<HTMLElement>('[data-ldz="parts"]')!;
  const nameEl = section.querySelector<HTMLElement>('[data-ldz="name"]');
  const leadEl = section.querySelector<HTMLElement>('[data-ldz="lead"]');
  const railName = rail?.querySelector<HTMLElement>('[data-hds="name"]') || null;
  const railScroll = rail?.querySelector<HTMLElement>('[data-hds="scroll"]') || null;
  const viewer = document.querySelector<HTMLDialogElement>('[data-ldz-viewer]');
  const laptop = matchMedia(DESK);
  let kid = '';
  let moment = '';
  let firstAsk = true;
  let sig = '';
  let slides: DesignSlide[] = [];
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  let asking: AbortController | null = null;
  // Every card showing a slide (in the section and the strip), and each part's own count, for a picture that fails
  const cards = new Map<DesignSlide, HTMLElement[]>();
  const railCards = new Map<DesignSlide, HTMLButtonElement>();
  let recounts: (() => void)[] = [];
  // Each section picture's sizes follows its card: the width it shows at, and a photo covering its 4:3 card (cover: its
  // height ÷ width) shows wider than the card when it's wider than 4:3. Only ever grows (a phone turned, a card that
  // widens when another drops), so the browser takes a bigger picture when it needs one and never swaps for a smaller
  const fits = new WeakMap<Element, { img: HTMLImageElement; cover: number | null; px: number }>();
  function fit(pic: Element) {
    const f = fits.get(pic);
    if (!f) return;
    const r = pic.getBoundingClientRect();
    const need = Math.ceil(f.cover ? Math.max(r.width, r.height / f.cover) : r.width);
    if (need > f.px) { f.px = need; f.img.sizes = `${need}px`; }
  }
  const sizeWatch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((list) => { for (const e of list) fit(e.target); }) : null;

  /** The strip's place in the hero: for this kid, while there's a picture to show */
  function mark(on: boolean) {
    if (!hero) return;
    const want = on && kid ? kid : '';
    if ((hero.dataset.design || '') === want) return;
    holdPlace(() => { if (want) hero.dataset.design = want; else delete hero.dataset.design; });
  }

  /** Nothing to show. keepPlace: the strip's place stays (the server gave it for this kid; the pictures are coming) */
  function hide(keepPlace = false) {
    if (viewer?.open) viewer.close();
    holdPlace(() => {
      section.hidden = true;
      parts.replaceChildren();
      delete parts.dataset.sig;
      delete parts.dataset.kid;
      railScroll?.replaceChildren();
    });
    cards.clear();
    railCards.clear();
    recounts = [];
    sizeWatch?.disconnect();
    sig = '';
    slides = [];
    if (!keepPlace) mark(false);
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  const track = (s: DesignSlide, li: HTMLElement) => { const l = cards.get(s); if (l) l.push(li); else cards.set(s, [li]); };

  /** A picture that can't load leaves the viewer, every card of it, and any part it was the last of */
  function drop(s: DesignSlide) {
    if (!slides.includes(s)) return;
    slides = slides.filter((y) => y !== s);
    const gone = cards.get(s) || [];
    cards.delete(s);
    railCards.delete(s);
    if (shown === s && viewer?.open) {
      if (slides.length) void show(slides[0]); else viewer.close();
    }
    holdPlace(() => {
      for (const li of gone) li.remove();
      for (const r of recounts) r();
      if (!slides.length) { section.hidden = true; mark(false); }
    });
  }

  /** What a picture is, on it ('Before', 'Existing', 'Proposed'): the same badge in the section, the strip and the viewer */
  const badge = (s: DesignSlide, cls: string) => (s.badge ? el('span', `${cls} ${cls}--${s.kind}`, s.badge) : null);

  /**
   * One card in the section (drawn by designPartsHtml, here or by the server), wired up: it opens the viewer at its
   * place among the pictures that loaded, and its picture comes at the size the card shows
   */
  function wireCard(li: HTMLElement, s: DesignSlide, width: number) {
    const b = li.querySelector<HTMLButtonElement>('.ldz-item');
    const pic = li.querySelector<HTMLElement>('.ldz-pic');
    const img = pic?.querySelector('img');
    if (!b || !pic || !img) { li.remove(); return; }
    const gone = () => drop(s);
    img.addEventListener('error', gone, { once: true });
    // The card already has the picture's shape when its stored size says it (knownRatio, the same the server drew)
    const known = s.kind === 'before' ? null : knownRatio(s);
    // A tiny copy first: the card takes the picture's shape (a photo's card is always 4:3; its shape says how much
    // the card crops off), and one that can't load leaves now, not when it's scrolled to. Then the picture comes
    void shapeOf(s).then((r) => {
      if (!cards.get(s)?.includes(li)) return; // redrawn or dropped meanwhile
      if (!r) { gone(); return; }
      if (s.kind !== 'before' && !known) pic.style.aspectRatio = `1 / ${r.toFixed(4)}`;
      return pictureSet(s, width).then((set) => {
        if (!set) { gone(); return; }
        if (!cards.get(s)?.includes(li)) return;
        // sizes before srcset and src (the card is in the page by now). Not laid out yet: the screen's width, never
        // more than the card always took
        fits.set(pic, { img, cover: s.kind === 'before' ? r : null, px: 0 });
        fit(pic);
        if (!img.sizes) img.sizes = '100vw';
        img.srcset = set.srcset;
        img.src = set.src;
        sizeWatch?.observe(pic);
      });
    });
    b.addEventListener('click', () => open(s));
    track(s, li);
  }

  /** Every part's cards wired, and each part recounted as pictures that can't load leave it */
  function wireParts(next: DesignSlide[]) {
    const byKey = new Map(designPartsOf(next).map((p) => [p.key, p.slides]));
    for (const wrap of parts.querySelectorAll<HTMLElement>(':scope > .ldz-part[data-part]')) {
      const key = wrap.dataset.part as PartKey;
      const mine = byKey.get(key) || [];
      const ul = wrap.querySelector<HTMLElement>('ul');
      if (!ul) continue;
      const noteEl = wrap.querySelector<HTMLElement>('.ldz-part__note');
      const width = key === 'photos' ? (mine.length === 1 ? 1600 : 900) : mine.length === 1 ? 1800 : 1200;
      for (const li of ul.querySelectorAll<HTMLElement>(':scope > li[data-i]')) {
        const s = next[Number(li.dataset.i)];
        if (s && mine.includes(s)) wireCard(li, s, width); else li.remove();
      }
      const recount = () => {
        const left = slides.filter((y) => mine.includes(y));
        if (key === 'photos') ul.dataset.n = String(ul.children.length); else ul.className = gridClass(key, left);
        const note = partNote(key, left);
        if (noteEl) { noteEl.textContent = note; noteEl.hidden = !note; }
        if (!ul.children.length) wrap.remove();
      };
      recount();
      recounts.push(recount);
    }
  }

  /** One picture in the strip beside the video: a small card with its badge */
  function railItem(s: DesignSlide, label: string) {
    const li = el('li');
    const b = el('button', `hds-item${s.kind === 'before' ? '' : ' hds-paper'}${isWholeSheet(s) ? ' hds-sheet' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-label', `See it big: ${s.badge ? `${s.badge}, ` : ''}${label}`);
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    b.append(img);
    const tag = badge(s, 'hds-tag');
    if (tag) b.append(tag);
    img.addEventListener('error', () => drop(s), { once: true });
    // Its picture waits for the strip to show (fillRail)
    void slideSrc(s, 320).then((src) => { if (!cards.get(s)?.includes(li)) return; if (!src) { drop(s); return; } img.dataset.src = src; fillRail(); });
    b.addEventListener('click', () => open(s));
    li.append(b);
    track(s, li);
    railCards.set(s, b);
    return li;
  }

  /**
   * The strip's pictures, once it shows: every one at once. It's hidden outside the watch party (the hero without
   * data-party and data-design, LiveDesignRail.astro) and in full screen (LiveStage.astro), and gets a size the moment
   * it shows, however that happens (railWatch). Without ResizeObserver: at once, as before
   */
  function fillRail() {
    if (!railScroll || (railWatch && !rail?.getClientRects().length)) return;
    for (const img of railScroll.querySelectorAll<HTMLImageElement>('img[data-src]')) {
      img.src = img.dataset.src!;
      delete img.dataset.src;
    }
  }
  const railWatch = rail && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fillRail()) : null;
  if (rail) railWatch?.observe(rail);

  function drawRail(next: DesignSlide[]) {
    if (!railScroll) return;
    const groups: [string, DesignSlide[]][] = [
      ['Before', next.filter((x) => x.kind === 'before')],
      ['The plan', next.filter((x) => x.kind === 'as-built' || x.kind === 'proposed')],
      ['The look', next.filter((x) => x.kind === 'board')],
    ];
    const out: HTMLElement[] = [];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      const wrap = el('div', 'hds-group');
      const ul = el('ul', 'hds-list');
      ul.setAttribute('aria-label', title);
      wrap.append(el('p', 'hds-label', title), ul);
      ul.append(...list.map((x, i) => {
        const caption = straight(x.caption);
        const label = x.kind === 'before' ? `photo ${i + 1} of ${list.length}, ${caption}` : caption;
        return railItem(x, label);
      }));
      recounts.push(() => { if (!ul.children.length) wrap.remove(); });
      out.push(wrap);
    }
    railScroll.replaceChildren(...out);
    railScroll.scrollTo({ top: 0, left: 0 });
  }

  function draw(name: string, next: DesignSlide[], isAfter: boolean) {
    const s = designSignature(next) + (isAfter ? '|after' : '');
    if (s === sig) return;
    if (!next.length) { hide(); return; }
    // Someone looking at a picture keeps it when the design is redrawn (the reveal starting turns "today" into "before")
    const looking = viewer?.open && shown ? `${shown.kind}|${shown.url}` : '';
    // The server drew these same cards into the page (functions/live/[[path]].js): they're kept, not drawn again
    const served = !sig && parts.dataset.sig === s && !!parts.firstElementChild;
    sig = s;
    slides = next.slice();
    cards.clear();
    railCards.clear();
    recounts = [];
    sizeWatch?.disconnect();
    if (nameEl) nameEl.textContent = designName(name);
    // The line under the heading says what's here, as it is now (designLead), and again as pictures leave
    const lead = () => { if (leadEl) leadEl.textContent = designLead(slides, isAfter); };
    lead();
    recounts.push(lead);
    if (railName) railName.textContent = name ? `${possessive(name)} design` : 'The design';
    holdPlace(() => {
      if (!served) { parts.innerHTML = designPartsHtml(next, isAfter); parts.dataset.sig = s; parts.dataset.kid = kid; }
      wireParts(next);
      drawRail(next);
      section.hidden = false;
    });
    mark(true);
    if (looking) {
      const again = slides.find((x) => `${x.kind}|${x.url}` === looking);
      if (again) void show(again); else viewer?.close();
    }
  }

  async function ask() {
    clearTimeout(askTimer);
    if (!alive || !kid) return;
    asking?.abort();
    asking = new AbortController();
    const forKid = kid;
    const d = await fetchDesign(forKid, asking.signal);
    if (!alive || forKid !== kid) return;
    let wait = ASK_FAILED_MS;
    if (d) {
      if (d.open) { draw(d.name || '', d.slides || [], !!d.after); wait = ASK_OPEN_MS; } else { hide(); wait = ASK_CLOSED_MS; }
    } else if (!slides.length) {
      // No answer and nothing drawn: a place kept for the pictures shouldn't stand empty
      mark(false);
    }
    askTimer = setTimeout(ask, wait);
  }

  // ── Viewer ──
  let shown: DesignSlide | null = null;
  let mode: ViewerMode = 'modal';
  const vq = <T extends Element>(k: string) => viewer?.querySelector<T>(`[data-ldv="${k}"]`) || null;
  let opener: HTMLElement | null = null;
  let held: { y: number; overflow: string } | null = null;

  /** The strip marks the picture open in the viewer, and scrolls it into its own view (never the page) */
  function markShown(s: DesignSlide | null) {
    for (const [x, b] of railCards) {
      if (x === s) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
    const b = s ? railCards.get(s) : null;
    if (!b || !railScroll) return;
    const r = b.getBoundingClientRect();
    const c = railScroll.getBoundingClientRect();
    const behavior = (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior;
    if (r.top < c.top) railScroll.scrollBy({ top: r.top - c.top - 6, behavior });
    else if (r.bottom > c.bottom) railScroll.scrollBy({ top: r.bottom - c.bottom + 6, behavior });
    if (r.left < c.left) railScroll.scrollBy({ left: r.left - c.left - 6, behavior });
    else if (r.right > c.right) railScroll.scrollBy({ left: r.right - c.right + 6, behavior });
  }

  // ── A whole plan sheet (Peter, Nov 16 2026: the plans shown as the official plan set) ──
  // It opens as the designer drew it, title block and all; "Zoom in" (or a double-click or double-tap) moves in on its
  // drawing, big enough to read the dimensions, and "Whole sheet" goes back. The picture is moved, never cropped, so
  // it's the same sheet either way
  let zoomed = false;
  /** Where the picture goes: the drawing filling the stage when zoomed, else the whole sheet fitted in it */
  function applyZoom() {
    const img = vq<HTMLImageElement>('img');
    const stg = vq<HTMLElement>('stage');
    const f = focusOf(shown);
    if (!img || !stg) return;
    const W = stg.clientWidth, H = stg.clientHeight;
    const sw = shown?.w || img.naturalWidth, sh = shown?.h || img.naturalHeight;
    if (!f || !zoomed || !W || !H || !sw || !sh) { img.style.transform = ''; return; }
    const fit = Math.min(W / sw, H / sh);
    const dw = sw * fit, dh = sh * fit;
    const k = Math.max(1, Math.min(W / (f.w * dw), H / (f.h * dh)) * 0.94);
    const cx = (W - dw) / 2 + (f.x + f.w / 2) * dw, cy = (H - dh) / 2 + (f.y + f.h / 2) * dh;
    img.style.transform = `translate(${(W / 2 - k * cx).toFixed(1)}px, ${(H / 2 - k * cy).toFixed(1)}px) scale(${k.toFixed(4)})`;
  }
  /** The button says what it does next, and is there only for a whole sheet */
  function zoomUi() {
    const b = vq<HTMLButtonElement>('zoom');
    if (!b) return;
    const f = !!focusOf(shown);
    b.hidden = !f;
    const t = b.querySelector<HTMLElement>('[data-ldv="zoom-text"]');
    if (t) t.textContent = zoomed ? 'Whole sheet' : 'Zoom in';
    b.dataset.zoomed = zoomed ? 'true' : 'false';
    vq<HTMLElement>('stage')?.toggleAttribute('data-sheet', f);
    vq<HTMLElement>('stage')?.toggleAttribute('data-zoomed', f && zoomed);
  }
  function toggleZoom() {
    if (!focusOf(shown)) return;
    zoomed = !zoomed;
    zoomUi();
    applyZoom();
  }
  const zoomWatch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (viewer?.open) applyZoom(); }) : null;
  const stageEl = vq<HTMLElement>('stage');
  if (stageEl) zoomWatch?.observe(stageEl);
  const onZoomClick = () => toggleZoom();
  const onDbl = (e: MouseEvent) => { if (focusOf(shown) && (e.target as Element)?.closest?.('[data-ldv="img"]')) { e.preventDefault(); toggleZoom(); } };
  // A double tap on the picture (two taps close together, neither a swipe): the same as the button
  let lastTap = 0;
  const onTap = (e: TouchEvent) => {
    if (e.changedTouches.length !== 1 || !(e.target as Element)?.closest?.('[data-ldv="img"]') || !focusOf(shown)) return;
    const now = Date.now();
    if (now - lastTap < 320) { lastTap = 0; e.preventDefault(); toggleZoom(); } else lastTap = now;
  };

  async function show(s: DesignSlide) {
    const img = vq<HTMLImageElement>('img');
    if (!img) return;
    // A new picture comes in where it belongs, without sliding there from the last one's place
    const moving = shown !== s;
    shown = s;
    if (moving) {
      zoomed = false;
      img.classList.add('is-still');
      zoomUi();
      applyZoom();
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.remove('is-still')));
    }
    const i = slides.indexOf(s);
    // The badge leads the caption ("BEFORE  Dylan's room today", "PROPOSED  The new floor plan"); a board keeps its kicker
    const k = vq<HTMLElement>('kicker'); if (k) { k.textContent = s.badge || s.kicker; k.dataset.kind = s.badge ? s.kind : ''; }
    const c = vq<HTMLElement>('caption'); if (c) c.textContent = straight(s.caption);
    const n = vq<HTMLElement>('count'); if (n) n.textContent = slides.length > 1 ? `${i + 1} of ${slides.length}` : '';
    img.alt = straight(s.alt);
    for (const k2 of ['prev', 'next']) { const b = vq<HTMLButtonElement>(k2); if (b) b.hidden = slides.length < 2; }
    markShown(s);
    // A whole sheet comes big enough that its drawing is sharp when zoomed to it (as wide as the sheet is, at most)
    const dpr = devicePixelRatio || 1;
    const f = focusOf(s);
    const want = f ? Math.min(s.w || 3200, 3200, Math.round((Math.max(innerWidth, innerHeight) * dpr) / Math.max(f.w, 0.2)))
      : Math.min(2400, Math.round(Math.max(innerWidth, innerHeight) * dpr));
    const src = await slideSrc(s, want);
    if (shown === s && src) { img.src = src; if (f) img.decode?.().then(() => { if (shown === s) applyZoom(); }).catch(() => {}); }
  }

  /** How the viewer opens now: beside the video (laptop), over a phone with the video kept small, or alone */
  function modeNow(): ViewerMode {
    if (!hero?.hasAttribute('data-party')) return 'modal';
    if (laptop.matches) return frame && sideWidth() >= SIDE_MIN_W ? 'side' : 'modal';
    return stage ? 'pinned' : 'modal';
  }
  // From the screen's left edge to the frame (the video and its strip), with a margin each side
  const sideWidth = () => Math.floor((frame?.getBoundingClientRect().left || 0) - 24);
  const fitSide = () => { if (viewer && mode === 'side') viewer.style.setProperty('--ldv-w', `${Math.max(SIDE_MIN_W, sideWidth())}px`); };
  // On a phone the small video's shape decides the room the viewer leaves it, and that shape can change while the viewer
  // is open (the picture's real shape arrives after the setting's), so it's followed, not read once
  const wideNow = () => mode === 'pinned' && hero?.dataset.orientation === 'landscape';
  const fitPin = () => { if (viewer?.open) viewer.classList.toggle('ldv--wide', wideNow()); };
  // (and the watch party ending or starting while it's open, a live reveal ending before its replay is ready, changes the
  // way that fits: it kept the small video's place, empty, until the replay came)
  const shapeWatch = hero ? new MutationObserver(() => { fitPin(); onLayout(); }) : null;
  // An iPad turned (or a window resized) across the laptop/phone line while it's open, or the watch party ending or
  // starting: it opens again, on the same picture, in the way that fits now (beside the video, over it with the video
  // pinned, or alone)
  const onLayout = () => {
    if (!viewer?.open || !shown) return;
    if (modeNow() === mode) { fitSide(); return; }
    const again = shown;
    viewer.addEventListener('close', () => { if (alive) open(again); }, { once: true });
    viewer.close();
  };
  laptop.addEventListener('change', onLayout);
  if (hero) shapeWatch?.observe(hero, { attributes: true, attributeFilter: ['data-orientation', 'data-party'] });

  function open(s: DesignSlide) {
    if (!viewer || !slides.includes(s)) return;
    if (viewer.open) { void show(s); return; }
    opener = document.activeElement as HTMLElement | null;
    mode = modeNow();
    viewer.classList.toggle('ldv--side', mode === 'side');
    viewer.classList.toggle('ldv--pinned', mode === 'pinned');
    viewer.classList.toggle('ldv--wide', wideNow());
    viewer.setAttribute('aria-modal', mode === 'modal' ? 'true' : 'false');
    fitSide();
    void show(s);
    // The page holds still behind it: no wheel or swipe scrolls what's underneath
    held = { y: scrollY, overflow: document.documentElement.style.overflow };
    document.documentElement.style.overflow = 'hidden';
    if (mode === 'modal') { viewer.showModal(); return; }
    // Not modal: the video stays in sight and in reach (its sound, its controls), and so does the strip
    viewer.show();
    if (mode === 'pinned') stage?.pin(true, 'design');
    vq<HTMLElement>('close')?.focus({ preventScroll: true });
    document.addEventListener('keydown', onDocKey);
    document.addEventListener('click', onDocClick, true);
    addEventListener('resize', fitSide);
  }
  const step = (d: number) => {
    if (!shown || slides.length < 2) return;
    const i = Math.max(0, slides.indexOf(shown));
    void show(slides[(i + d + slides.length) % slides.length]);
  };
  const onPrev = () => step(-1);
  const onNext = () => step(1);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } };
  // Not modal, the keys work wherever focus is (the strip, the video), except in a field someone is typing in
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]');
  const onDocKey = (e: KeyboardEvent) => {
    if (!viewer?.open) return;
    if (e.key === 'Escape') { e.preventDefault(); viewer.close(); return; }
    if (viewer.contains(e.target as Node) || typing(e.target)) return;
    onKey(e);
  };
  // On a phone, a tap on the small video goes back to it (rather than the mini player's own scroll to it)
  const onDocClick = (e: MouseEvent) => {
    if (!viewer?.open || mode !== 'pinned') return;
    if (!(e.target as Element).closest?.('[data-stage] [data-s="picture"]')) return;
    e.preventDefault();
    e.stopPropagation();
    viewer.close();
  };
  let touchX: number | null = null;
  const onTouchStart = (e: TouchEvent) => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; };
  const onTouchEnd = (e: TouchEvent) => {
    if (touchX == null || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    // A swipe, not a pinch or a tap
    if (Math.abs(dx) > 50 && (!window.visualViewport || window.visualViewport.scale <= 1.01)) step(dx < 0 ? 1 : -1);
  };
  // A click on the dark around the picture closes it
  const onBackdrop = (e: MouseEvent) => { if (e.target === viewer || e.target === vq('stage')) viewer?.close(); };
  const onClose = () => {
    document.removeEventListener('keydown', onDocKey);
    document.removeEventListener('click', onDocClick, true);
    removeEventListener('resize', fitSide);
    if (mode === 'pinned') stage?.pin(false);
    mode = 'modal';
    markShown(null);
    shown = null;
    if (held) {
      document.documentElement.style.overflow = held.overflow;
      if (Math.abs(scrollY - held.y) > 1) scrollTo({ top: held.y, behavior: 'instant' as ScrollBehavior });
      held = null;
    }
    opener?.focus({ preventScroll: true });
    opener = null;
  };
  vq('prev')?.addEventListener('click', onPrev);
  vq('next')?.addEventListener('click', onNext);
  vq('zoom')?.addEventListener('click', onZoomClick);
  viewer?.addEventListener('dblclick', onDbl);
  viewer?.addEventListener('touchend', onTap);
  viewer?.addEventListener('keydown', onKey);
  viewer?.addEventListener('touchstart', onTouchStart, { passive: true });
  viewer?.addEventListener('touchend', onTouchEnd);
  viewer?.addEventListener('click', onBackdrop);
  viewer?.addEventListener('close', onClose);

  const onVisible = () => { if (document.visibilityState === 'visible' && kid) void ask(); };
  document.addEventListener('visibilitychange', onVisible);

  return {
    /** The kid the page is showing now ('' for none), and its moment (upcoming, live, replay…): a change asks again */
    setKid(slug: string, now = '') {
      // The first time: the server may have drawn a kid's design into the page (functions/live/[[path]].js, data-kid on
      // its parts). This kid's stays, as it is, while it's asked for again (draw keeps the same cards); anyone else's,
      // or one for a page now showing no kid, goes
      const servedFor = firstAsk ? parts.dataset.kid || '' : null;
      firstAsk = false;
      const sameKid = slug === kid;
      if (sameKid && now === moment && !servedFor) return;
      kid = slug;
      moment = now;
      asking?.abort();
      clearTimeout(askTimer);
      // A place the server kept for this kid's pictures stays while they're asked for
      if (servedFor ? servedFor !== slug : !sameKid) hide(!!slug && hero?.dataset.design === slug);
      if (kid) void ask();
    },
    destroy() {
      alive = false;
      shapeWatch?.disconnect();
      railWatch?.disconnect();
      sizeWatch?.disconnect();
      laptop.removeEventListener('change', onLayout);
      asking?.abort();
      clearTimeout(askTimer);
      document.removeEventListener('visibilitychange', onVisible);
      vq('prev')?.removeEventListener('click', onPrev);
      vq('next')?.removeEventListener('click', onNext);
      vq('zoom')?.removeEventListener('click', onZoomClick);
      viewer?.removeEventListener('dblclick', onDbl);
      viewer?.removeEventListener('touchend', onTap);
      zoomWatch?.disconnect();
      viewer?.removeEventListener('keydown', onKey);
      viewer?.removeEventListener('touchstart', onTouchStart);
      viewer?.removeEventListener('touchend', onTouchEnd);
      viewer?.removeEventListener('click', onBackdrop);
      if (viewer?.open) viewer.close();
      onClose();
      viewer?.removeEventListener('close', onClose);
    },
  };
}
