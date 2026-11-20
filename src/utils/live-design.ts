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
 * The plan, when there's an existing and a proposed sheet that line up, is
 * first of all one picture of both, a line between them to drag (Peter, Nov
 * 18 2026: "should we do a before/after plans slider?"): in the section, the
 * strip, the room and the viewer (plan-compare.ts, compare-slider.ts). The
 * designer's two sheets follow it as they were.
 *
 * The viewer: any picture opens large. During the watch party the reveal
 * keeps playing in sight (Peter, Nov 9 2026: the design has to be seen
 * during the reveal): on a laptop the viewer opens beside the video, over
 * the messages, and the strip stays usable and marks the picture being
 * looked at; on a phone it fills the screen with the video held in a small
 * player in its top corner (a tap on it goes back). Otherwise it's a plain
 * full-screen viewer. The page holds still behind it either way.
 */
import { fetchDesign, slideSrc, drawingBox, cutSrc, compareBox, designSignature, isWholeSheet, knownRatio, planPairOf, type DesignSlide, type PlanPair } from './reveal-design-client';
import { designPartsHtml, designPartsOf, designName, designLead, gridClass, partNote, partTitle, possessive, straight, compareHtml, COMPARE_NOTE, type PartKey } from './live-design-html';
import { compareFor, sheetWithoutPig } from './plan-compare';
import { attachCompare, type CompareHandle } from './compare-slider';
import { createGallery, type GalleryItem } from './design-viewer';
import { holdPlace } from './hold-place';
import type { Stage } from './live-stage';
import { DESK } from './live-media';

const ASK_OPEN_MS = 3 * 60_000;
const ASK_CLOSED_MS = 10 * 60_000;
const ASK_FAILED_MS = 2 * 60_000;
/** The viewer opens beside the video only with at least this much room to its left */
const SIDE_MIN_W = 320;

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
  /** The room beside the video on a computer (LiveRoom.astro): one big picture, a switch between the parts, the rest small */
  room?: HTMLElement | null;
}

type ViewerMode = 'modal' | 'side' | 'pinned';

export function createLiveDesign(section: HTMLElement, opts: Options = {}) {
  const { hero = null, rail = null, frame = null, stage = null, room = null } = opts;
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
  // The plan's compare, while its two sheets are here and line up; every compare drawn (section, strip, room)
  let pair: PlanPair | null = null;
  // Where the compare's line was last left (any of them: the section's, the room's, the viewer's), so the next one to
  // show starts there; null until one has swept in or been moved
  let cmpPos: number | null = null;
  let compares: { root: HTMLElement; handle: CompareHandle; near: IntersectionObserver | null }[] = [];
  // The compare's two pictures once made, for what can use them at once (the room's sheets)
  let madeNow: { p: PlanPair; before: string; after: string } | null = null;
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
    forgetCompares();
    pair = null;
    if (!keepPlace) mark(false);
    drawRoom();
    railFace();
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
    if (pair && (pair.existing === s || pair.proposed === s)) dropCompare(false);
    holdPlace(() => {
      for (const li of gone) li.remove();
      for (const r of recounts) r();
      if (!slides.length) { section.hidden = true; mark(false); }
    });
    refreshViewer();
    railFace();
  }

  // ── The plan's compare ──
  function forgetCompares() {
    for (const c of compares) { c.handle.destroy(); c.near?.disconnect(); }
    compares = [];
    // (the room's is drawn again when it's next wanted)
    room?.querySelector('[data-lrm="cmp"]')?.replaceChildren();
  }
  /** It can't be (it doesn't line up, a sheet can't be had): every compare goes, the sheets stay */
  function dropCompare(redraw = true) {
    if (!pair) return;
    pair = null;
    forgetCompares();
    // (the room's plan loses its first picture: the one it showed keeps its place)
    const at = roomAt.get('plans');
    if (at) roomAt.set('plans', at - 1);
    holdPlace(() => {
      for (const e of document.querySelectorAll('.ldz-compare, .ldz-sheets, .hds-cmp-li')) e.remove();
      for (const ul of parts.querySelectorAll('.ldz-grid--sheets')) ul.classList.remove('ldz-grid--sheets');
      const note = parts.querySelector<HTMLElement>('.ldz-part[data-part="plans"] .ldz-part__note');
      if (note) { note.textContent = partNote('plans', slides.filter((x) => x.kind === 'as-built' || x.kind === 'proposed')); note.hidden = !note.textContent; }
      const cmp = rq('cmp'); if (cmp) { cmp.replaceChildren(); cmp.hidden = true; }
      roomSig = ''; roomTabsSig = '';
      if (redraw) drawRoom();
    });
    if (redraw) refreshViewer();
  }
  /**
   * One compare wired: its line moves under a finger or the mouse (and with the keyboard), its pictures come from
   * plan-compare.ts (lined up, the pig taken out), then it sweeps once from today's plan to the middle. `open`: a
   * click that isn't a drag, or its corner button, opens it big
   */
  function mountCompare(root: HTMLElement, open: (from: Element) => void) {
    const p = pair;
    if (!p) return;
    const before = root.querySelector<HTMLImageElement>('[data-pcmp="before"]');
    const after = root.querySelector<HTMLImageElement>('[data-pcmp="after"]');
    // (its knob kept inside the picture at either end, where the line itself goes to the edge)
    const knob = (pos: number) => {
      const w = root.clientWidth;
      const x = (w * pos) / 100;
      root.style.setProperty('--knob-dx', `${(Math.max(23, Math.min(w - 23, x)) - x).toFixed(1)}px`);
    };
    const handle = attachCompare(root, {
      range: root.querySelector<HTMLInputElement>('[data-pcmp="range"]'),
      labelBefore: root.querySelector<HTMLElement>('[data-pcmp="tag-before"]'),
      labelAfter: root.querySelector<HTMLElement>('[data-pcmp="tag-after"]'),
      // It sweeps in only if no compare on the page has been seen yet; else it starts where the line was left
      intro: cmpPos == null,
      introReady: () => root.dataset.state === 'ready',
      onTap: () => open(root),
      onMove: (pos) => { knob(pos); if (root.dataset.state === 'ready') cmpPos = pos; },
    });
    if (cmpPos != null) handle.set(cmpPos);
    root.querySelector('[data-pcmp="enlarge"]')?.addEventListener('click', () => open(root));
    // Its pictures are made once it's nearly in sight (the section's, far down the page, waits; the room's is in sight)
    const fill = () => {
      void wantCompare().then(async (made) => {
        if (pair !== p || !made || !root.isConnected || !before || !after) return;
        before.src = made.before;
        after.src = made.after;
        await Promise.all([before.decode?.().catch(() => {}), after.decode?.().catch(() => {})]);
        if (pair !== p) return;
        root.dataset.state = 'ready';
        handle.intro();
      });
    };
    let near: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      near = new IntersectionObserver((list) => { if (list.some((x) => x.isIntersecting)) { near?.disconnect(); fill(); } }, { rootMargin: '600px 0px' });
      near.observe(root);
    } else fill();
    compares.push({ root, handle, near });
  }
  /**
   * The compare's two pictures, made (once: plan-compare.ts keeps them) when something is about to show them; every
   * small picture of it on the page filled then. It can't be made: every compare goes, the sheets stay
   */
  function wantCompare() {
    const p = pair;
    if (!p) return Promise.resolve(null);
    return compareFor(p).then((made) => {
      if (pair !== p) return null;
      if (!made) { dropCompare(); return null; }
      madeNow = { p, before: made.before, after: made.after };
      // (the viewer's two sheets made ready behind it, the pig out of them too, so opening one never waits on it)
      for (const x of [p.existing, p.proposed]) void viewerSrc(x, 0);
      for (const im of document.querySelectorAll<HTMLImageElement>('img[data-cmp-half]')) {
        const want = im.dataset.cmpHalf === 'before' ? made.before : made.after;
        if (im.getAttribute('src') !== want) im.src = want;
      }
      return made;
    });
  }
  /** A small picture of the compare (the strip, the room's small ones): the two plans half and half, once they're made */
  function compareThumb(halfClass: string): HTMLElement[] {
    const a = el('img', halfClass), b = el('img');
    for (const [im, w] of [[b, 'after'], [a, 'before']] as const) { im.alt = ''; im.decoding = 'async'; im.dataset.cmpHalf = w; }
    return [b, a];
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
      const cmp = key === 'plans' ? wrap.querySelector<HTMLElement>('.ldz-compare .pcmp') : null;
      if (cmp && pair) mountCompare(cmp, (from) => open('cmp', from));
      const width = key === 'photos' ? (mine.length === 1 ? 1600 : 900) : mine.length === 1 ? 1800 : 1200;
      for (const li of ul.querySelectorAll<HTMLElement>(':scope > li[data-i]')) {
        const s = next[Number(li.dataset.i)];
        if (s && mine.includes(s)) wireCard(li, s, width); else li.remove();
      }
      const recount = () => {
        const left = slides.filter((y) => mine.includes(y));
        if (key === 'photos') ul.dataset.n = String(ul.children.length); else ul.className = `${gridClass(key, left)}${key === 'plans' && pair ? ' ldz-grid--sheets' : ''}`;
        const note = key === 'plans' && pair ? COMPARE_NOTE : partNote(key, left);
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

  /** The strip's compare: the two plans half and half, a line between; it opens the compare big */
  let railCmp: HTMLButtonElement | null = null;
  function railCompare() {
    const li = el('li', 'hds-cmp-li');
    const b = el('button', 'hds-item hds-paper hds-cmp');
    b.type = 'button';
    b.setAttribute('aria-label', 'See it big: the floor plan before and after, a line to drag between them');
    b.append(...compareThumb('hds-half'), el('span', 'hds-tag hds-tag--cmp', 'Before & after'));
    b.addEventListener('click', () => open('cmp', b));
    li.append(b);
    railCmp = b;
    // Its pictures are made once it's in the strip's view (the strip shows, and it's scrolled to)
    if (typeof IntersectionObserver !== 'undefined') {
      const near = new IntersectionObserver((list) => { if (list.some((x) => x.isIntersecting)) { near.disconnect(); void wantCompare(); } }, { rootMargin: '200px' });
      near.observe(b);
      compares.push({ root: b, handle: { pos: 50, set() {}, intro() {}, cancel() {}, destroy() {} }, near });
    }
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
      if (title === 'The plan' && pair) ul.prepend(railCompare());
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
    const now = viewer?.open ? gallery?.item : null;
    const looking = !now ? '' : now.kind === 'compare' ? 'cmp' : `${now.s.kind}|${now.s.url}`;
    // The server drew these same cards into the page (functions/live/[[path]].js): they're kept, not drawn again
    const served = !sig && parts.dataset.sig === s && !!parts.firstElementChild;
    sig = s;
    slides = next.slice();
    cards.clear();
    railCards.clear();
    recounts = [];
    sizeWatch?.disconnect();
    forgetCompares();
    pair = planPairOf(slides);
    railCmp = null;
    if (nameEl) nameEl.textContent = designName(name);
    // The line under the heading says what's here, as it is now (designLead), and again as pictures leave
    const lead = () => { if (leadEl) leadEl.textContent = designLead(slides, isAfter); };
    lead();
    recounts.push(lead);
    if (railName) railName.textContent = name ? `${possessive(name)} design` : 'The design';
    roomAfter = isAfter;
    roomName = name;
    recounts.push(drawRoom);
    holdPlace(() => {
      if (!served) { parts.innerHTML = designPartsHtml(next, isAfter); parts.dataset.sig = s; parts.dataset.kid = kid; }
      wireParts(next);
      drawRail(next);
      drawRoom();
      section.hidden = false;
    });
    mark(true);
    railFace();
    // Someone looking keeps what they were looking at (the compare, or the same picture), else the first
    if (viewer?.open) {
      const again = looking === 'cmp' ? (pair ? 'cmp' : null) : slides.find((x) => `${x.kind}|${x.url}` === looking) || null;
      if (again) refreshViewer(again); else requestClose();
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

  // ── The room beside the video (LiveRoom.astro) ──
  // One part at a time (the room, the plan, the look), its picture big and the rest small; the plan's first is its
  // compare, when there is one. Its pictures come only once it shows (a computer, the watch party, an upright video), at
  // the size it shows at; a new one fades in over the last
  type RoomEntry = DesignSlide | 'cmp';
  const rq = <T extends HTMLElement = HTMLElement>(k: string) => room?.querySelector<T>(`[data-lrm="${k}"]`) || null;
  const touchy = matchMedia('(hover: none)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let roomPart: PartKey | '' = '';
  const roomAt = new Map<PartKey, number>();
  let roomAfter = false;
  let roomName = '';
  let roomSig = '';
  let roomTabsSig = '';
  let roomShown: DesignSlide | null = null;
  const roomShowing = () => !!room && !room.hidden && room.getClientRects().length > 0;
  /** A part's pictures in the room, in order: the plan's compare first */
  const entriesOf = (p: { key: PartKey; slides: DesignSlide[] }): RoomEntry[] => (p.key === 'plans' && pair ? ['cmp', ...p.slides] : p.slides);
  // Each picture's small one, once loaded: it stands in, at once, while its big one comes
  const roomSmall = new Map<DesignSlide, string>();
  // Every big picture is fetched the first time the room shows, so a switch never waits on the network
  let roomWarm = '';
  const roomWant = (big: HTMLElement) => Math.min(1600, Math.max(480, Math.round(big.clientWidth * (devicePixelRatio || 1))));
  /** Which of the compare's two pictures a sheet is (its drawing, lined up and the pig taken out), if it's one of them */
  const halfOf = (s: DesignSlide) => (pair && s === pair.existing ? 'before' : pair && s === pair.proposed ? 'after' : '');
  /** The compare's own picture of a sheet, when it's made already */
  const madeOf = (s: DesignSlide) => { const h = halfOf(s); return h && madeNow && madeNow.p === pair ? (h === 'before' ? madeNow.before : madeNow.after) : ''; };
  /**
   * The part of a sheet the room shows (fractions of it), or null for the whole picture. A plan's sheet shows as its
   * drawing, as big as the photo's place allows (Peter, Nov 18 2026: "the drawing trimmed to its lines"; the viewer
   * still opens the whole sheet): the compare's two sheets cut as the compare is, so its own pictures (lined up, the
   * pig taken out) take their place without a jump; another sheet cut to its drawing
   */
  const cutOf = (s: DesignSlide) => (halfOf(s) && pair ? compareBox(pair) : drawingBox(s));
  /** A picture of the room at about `want` across: the compare's when made, else cut as cutOf says, else as it is */
  function roomSrc(s: DesignSlide, want: number): Promise<string | null> {
    const made = madeOf(s);
    if (made) return Promise.resolve(made);
    const box = cutOf(s);
    return box ? Promise.resolve(cutSrc(s, box, want)) : slideSrc(s, want);
  }
  function warmRoom(big: HTMLElement) {
    const want = roomWant(big);
    const sig = `${want}|${slides.map((x) => x.url).join(',')}`;
    if (sig === roomWarm) return;
    roomWarm = sig;
    for (const p of designPartsOf(slides)) for (const x of p.slides) void roomSrc(x, want).then((src) => { if (src && !/^blob:/.test(src)) { const i = new Image(); i.decoding = 'async'; i.src = src; } });
  }
  // The part of the sheet each big picture shows, for the viewer's way in and out (rectOf)
  const cutBoxes = new WeakMap<HTMLImageElement, { x: number; y: number; w: number; h: number }>();
  function roomPicture(s: DesignSlide) {
    const pic = rq('pic');
    const big = rq('big');
    if (!pic || !big || !roomShowing()) return;
    if (roomShown === s && pic.querySelector('img:not(.is-out)')) return;
    roomShown = s;
    // What showed goes at once (a badge must never sit on the wrong picture); the new one's small picture stands in
    for (const old of [...pic.querySelectorAll('img')]) { old.classList.remove('is-in', 'is-stand'); old.classList.add('is-out'); setTimeout(() => old.remove(), 160); }
    const small = roomSmall.get(s);
    if (small) {
      const stand = el('img');
      stand.alt = '';
      stand.dataset.kind = s.kind;
      stand.className = 'is-stand';
      stand.src = small;
      pic.append(stand);
    }
    const want = roomWant(big);
    warmRoom(big);
    const box = cutOf(s);
    // (only the last asked for takes the place: the cut, loading late, never covers the compare's picture again)
    let last: HTMLImageElement | null = null;
    const show = (src: string) => {
      const img = el('img');
      last = img;
      img.alt = straight(s.alt);
      img.decoding = 'async';
      img.dataset.kind = s.kind;
      if (box) cutBoxes.set(img, box);
      img.addEventListener('error', () => drop(s), { once: true });
      img.addEventListener('load', () => {
        if (roomShown !== s || img !== last) { img.remove(); return; }
        img.classList.add('is-in');
        // The one it replaces goes once the new one has faded in over it
        for (const old of [...pic.querySelectorAll('img')]) if (old !== img) setTimeout(() => old.remove(), 400);
      }, { once: true });
      img.src = src;
      pic.append(img);
    };
    void roomSrc(s, want).then((src) => {
      if (roomShown !== s) return;
      if (!src) { drop(s); return; }
      show(src);
      // One of the compare's sheets, shown before the compare was made: its own picture fades in over it once it is
      // (the same cut, so only the pig goes); never made, the cut stays
      if (halfOf(s) && !/^blob:/.test(src)) {
        void wantCompare().then(() => { const made = madeOf(s); if (made && roomShown === s) show(made); });
      }
    });
  }
  /** The compare in the big picture's place (drawn the first time it's wanted), or the big picture back */
  function roomCompare(on: boolean) {
    const cmp = rq('cmp'), big = rq('big');
    if (!cmp || !big) return;
    big.hidden = on;
    cmp.hidden = !on;
    if (on && pair && !cmp.firstElementChild) {
      cmp.innerHTML = compareHtml(pair, true);
      const root = cmp.querySelector<HTMLElement>('.pcmp');
      if (root) mountCompare(root, (from) => open('cmp', from));
    }
  }
  function drawRoom() {
    if (!room) return;
    const partsNow = designPartsOf(slides);
    const tabs = rq('tabs'), thumbs = rq('thumbs'), big = rq('big');
    if (!partsNow.length || !tabs || !thumbs || !big) {
      room.hidden = true;
      tabs?.replaceChildren(); thumbs?.replaceChildren(); rq('pic')?.replaceChildren(); rq('cmp')?.replaceChildren();
      roomSig = ''; roomTabsSig = ''; roomShown = null; roomPart = ''; roomAt.clear();
      railFace();
      return;
    }
    if (!partsNow.some((p) => p.key === roomPart)) roomPart = partsNow[0].key;
    const part = partsNow.find((p) => p.key === roomPart)!;
    const entries = entriesOf(part);
    const at = Math.max(0, Math.min(roomAt.get(part.key) ?? 0, entries.length - 1));
    roomAt.set(part.key, at);
    const e = entries[at];
    const title = partTitle(part.key, roomAfter);
    const nameEl2 = rq('name');
    if (nameEl2) nameEl2.textContent = roomName ? `${possessive(straight(roomName))} room` : 'The room';
    // The switch and the small pictures are drawn again only when what's in them changes (picking a part only marks
    // it), so focus stays where it was
    // (only which parts there are: their names change in place when the reveal starts, "today" becoming "before")
    const tabsSig = partsNow.map((p) => p.key).join(',');
    if (tabsSig !== roomTabsSig) {
      roomTabsSig = tabsSig;
      tabs.hidden = partsNow.length < 2;
      tabs.replaceChildren(...partsNow.map((p) => {
        const b = el('button', 'lrm-tab');
        b.type = 'button';
        b.id = `lrm-tab-${p.key}`;
        b.dataset.part = p.key;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-controls', 'lrm-stage');
        b.addEventListener('click', () => { roomPart = p.key; drawRoom(); });
        return b;
      }));
    }
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('.lrm-tab')) {
      const key = b.dataset.part as PartKey;
      const on = key === part.key;
      const words = partTitle(key, roomAfter);
      if (b.textContent !== words) b.textContent = words;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    rq('stage')?.setAttribute('aria-labelledby', partsNow.length > 1 ? `lrm-tab-${part.key}` : 'lrm-name');
    const sig = `${part.key}|${entries.map((x) => (x === 'cmp' ? 'cmp' : x.url)).join(',')}`;
    if (sig !== roomSig) {
      roomSig = sig;
      thumbs.toggleAttribute('data-paper', part.key !== 'photos');
      thumbs.replaceChildren(...entries.map((x, i) => {
        const li = el('li');
        const b = el('button', `lrm-thumb${x === 'cmp' ? ' lrm-thumb--cmp' : ''}`);
        b.type = 'button';
        b.setAttribute('aria-label', x === 'cmp' ? 'Show the floor plan before and after' : `Show ${x.kind === 'before' ? `photo ${i + 1} of ${entries.length}` : straight(x.caption)}`);
        if (x === 'cmp') { b.append(...compareThumb('lrm-half')); if (roomShowing()) void wantCompare(); }
        else {
          const img = el('img');
          img.alt = '';
          img.decoding = 'async';
          // (the compare's two sheets: their drawings as the compare has them, lined up and the pig taken out, once made)
          const half = halfOf(x);
          if (half) img.dataset.cmpHalf = half;
          img.addEventListener('error', () => drop(x), { once: true });
          b.append(img);
          // (a plan's says which it is: the existing and the proposed look alike that small)
          if (x.kind !== 'before' && x.badge) { const t = el('span', 'lrm-thumb-tag', x.badge); t.dataset.kind = x.kind; b.append(t); }
        }
        b.addEventListener('click', () => { roomAt.set(part.key, i); drawRoom(); });
        li.append(b);
        return li;
      }));
      thumbs.scrollTop = 0;
    }
    // The small ones' column shows while any part has more than one picture; a part with one keeps its place empty, so
    // the big picture is the same size whichever part shows (nothing moves at a switch)
    thumbs.hidden = !partsNow.some((p) => entriesOf(p).length > 1);
    thumbs.toggleAttribute('data-one', entries.length < 2);
    // The one showing big is marked among the small ones (the one the Tab key stops at: the arrows go through the
    // rest), and kept in sight among them, clear of a faded edge
    const tbs = [...thumbs.querySelectorAll<HTMLButtonElement>('.lrm-thumb')];
    tbs.forEach((b, i) => { if (i === at) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); b.tabIndex = i === at ? 0 : -1; });
    const cur = tbs[at]?.parentElement;
    if (cur && thumbs.scrollHeight > thumbs.clientHeight + 1) {
      const room = 36;
      const top = cur.offsetTop - room, bottom = cur.offsetTop + cur.offsetHeight + room;
      const most = thumbs.scrollHeight - thumbs.clientHeight;
      const to = top < thumbs.scrollTop ? Math.max(0, top) : bottom > thumbs.scrollTop + thumbs.clientHeight ? Math.min(most, bottom - thumbs.clientHeight) : null;
      if (to != null && Math.abs(to - thumbs.scrollTop) > 1) thumbs.scrollTo({ top: to, behavior: still.matches ? 'auto' : 'smooth' });
    }
    railMore();
    const how = touchy.matches ? 'tap' : 'click';
    const cap = rq('cap');
    const count = rq('count');
    const b = rq('badge');
    // (the switch above says which part this is already, and the badge on the picture what it shows: the line under it
    // names it only when there's no switch)
    if (cap) cap.textContent = partsNow.length > 1 ? '' : title;
    if (e === 'cmp') {
      roomCompare(true);
      if (b) b.hidden = true;
      if (count) count.textContent = `${at + 1} of ${entries.length} · drag the line`;
      big.setAttribute('aria-label', '');
    } else {
      roomCompare(false);
      big.toggleAttribute('data-paper', e.kind !== 'before');
      // (a sheet shows whole only when its drawing's place isn't known: its badge then goes in the sheet's empty corner)
      big.toggleAttribute('data-sheet', isWholeSheet(e) && !cutOf(e));
      big.setAttribute('aria-label', `See it big: ${e.badge ? `${e.badge}, ` : ''}${title}${entries.length > 1 ? `, ${at + 1} of ${entries.length}` : ''}`);
      if (b) { b.textContent = e.badge || ''; b.dataset.kind = e.kind; b.hidden = !e.badge; }
      if (count) count.textContent = entries.length > 1 ? `${at + 1} of ${entries.length} · ${how} to see it big` : `${how[0].toUpperCase()}${how.slice(1)} to see it big`;
    }
    room.hidden = false;
    if (roomShowing()) {
      if (e !== 'cmp') roomPicture(e);
      [...thumbs.querySelectorAll<HTMLButtonElement>('.lrm-thumb')].forEach((tb, i) => {
        const x = entries[i];
        const img = tb.querySelector('img');
        if (!x || x === 'cmp' || !img || img.getAttribute('src')) return;
        // (cut as its big picture is: it stands in for it while that comes)
        void roomSrc(x, 220).then((src) => {
          if (src && !img.getAttribute('src')) { img.src = src; img.addEventListener('load', () => roomSmall.set(x, img.currentSrc || src), { once: true }); } else if (!src) drop(x);
        });
      });
      if (pair && thumbs.querySelector('img[data-cmp-half]')) void wantCompare();
    }
    railFace();
  }
  rq('big')?.addEventListener('click', () => {
    const part = designPartsOf(slides).find((p) => p.key === roomPart);
    const e = part ? entriesOf(part)[roomAt.get(part.key) ?? 0] : null;
    if (e) open(e, rq('big'));
  });
  // A tab list's keys: the arrows go round, Home and End to the first and the last
  rq('tabs')?.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const keys = designPartsOf(slides).map((p) => p.key);
    const i = keys.indexOf(roomPart as PartKey);
    if (i < 0 || keys.length < 2) return;
    e.preventDefault();
    roomPart = e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : keys[(i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length];
    drawRoom();
    rq('tabs')?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  });
  // The small ones' column: the arrows up and down go through them (Home and End to the first and the last), as the
  // switch's left and right go through the parts
  rq('thumbs')?.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const part = designPartsOf(slides).find((p) => p.key === roomPart);
    const n = part ? entriesOf(part).length : 0;
    if (!part || n < 2) return;
    e.preventDefault();
    // (from the one with the focus: a click or Tab can have put it elsewhere)
    const btns = [...(rq('thumbs')?.querySelectorAll<HTMLElement>('.lrm-thumb') || [])];
    const f = btns.indexOf(document.activeElement as HTMLElement);
    const i = f >= 0 ? f : roomAt.get(part.key) ?? 0;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : Math.max(0, Math.min(n - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    roomAt.set(part.key, j);
    drawRoom();
    rq('thumbs')?.querySelectorAll<HTMLElement>('.lrm-thumb')[j]?.focus({ preventScroll: true });
  });
  // More of them than fit: the edge that has more is faded
  function railMore() {
    const t = rq('thumbs');
    if (!t) return;
    const up = t.scrollTop > 2, down = t.scrollTop + t.clientHeight < t.scrollHeight - 2;
    const v = up && down ? 'both' : up ? 'up' : down ? 'down' : '';
    if ((t.dataset.more || '') !== v) { if (v) t.dataset.more = v; else delete t.dataset.more; }
  }
  rq('thumbs')?.addEventListener('scroll', railMore, { passive: true });
  // Its pictures come the moment it shows (the watch party starting, a window widened past the phone layout); the
  // rail's way in steps aside while it shows
  const roomWatch = room && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (roomShowing()) drawRoom(); else railFace(); }) : null;
  if (room) roomWatch?.observe(room);

  // ── The rail's way in (LiveStage's "The room" button) ──
  // The rail beside a live upright video sits where the design's strip did, so it carries a button with the room's first
  // picture for its face; it opens the viewer at that picture (the video kept small in the corner). Not while the room
  // beside the video (a computer's Theater) shows the design already
  const railBtn = frame?.querySelector<HTMLButtonElement>('[data-s="design"]') || null;
  function railFace() {
    if (!stage) return;
    const first = slides.find((x) => x.kind === 'before') || slides[0];
    if (!first || roomShowing()) { stage.setDesign(''); return; }
    void slideSrc(first, 140).then((src) => { if (alive && (slides.find((x) => x.kind === 'before') || slides[0]) === first && !roomShowing()) stage.setDesign(src || ''); });
  }
  const onRailBtn = () => {
    const first = itemsNow()[0];
    if (first) open(first.kind === 'compare' ? 'cmp' : first.s, railBtn?.querySelector('img') || railBtn);
  };
  railBtn?.addEventListener('click', onRailBtn);

  // ── Viewer (its pictures: design-viewer.ts) ──
  let mode: ViewerMode = 'modal';
  const vq = <T extends Element>(k: string) => viewer?.querySelector<T>(`[data-ldv="${k}"]`) || null;
  let opener: HTMLElement | null = null;
  /** The card it opened from: it goes back into it (or into the one showing what it shows by then) */
  let origin: Element | null = null;
  let held: { y: number; overflow: string } | null = null;
  let closing = false;
  let items: GalleryItem[] = [];
  const stageEl = vq<HTMLElement>('stage');

  /** Every picture the viewer goes through, in order: the room, the plan (its compare first), the look */
  function itemsNow(): GalleryItem[] {
    const out: GalleryItem[] = [];
    for (const p of designPartsOf(slides)) {
      if (p.key === 'plans' && pair) out.push({ kind: 'compare', pair, part: 'plans' });
      for (const s of p.slides) out.push({ kind: 'slide', s, part: p.key });
    }
    return out;
  }
  const indexIn = (list: GalleryItem[], t: RoomEntry) => list.findIndex((x) => (t === 'cmp' ? x.kind === 'compare' : x.kind === 'slide' && x.s === t));
  /** A small copy of a picture the page has already loaded (the strip's, a section card's, the room's), to show at once:
   *  the same picture, whole (the room's small one of a sheet is its drawing only, a different shape: not that) */
  function smallOf(s: DesignSlide): string | null {
    // (a sheet made ready without the pig: that, at once, so it flies in with its picture and never shows the pig)
    const clean = cleanSheets.get(s);
    if (clean) return clean;
    const imgs = [railCards.get(s)?.querySelector('img'), ...(cards.get(s) || []).map((li) => li.querySelector('img'))];
    for (const im of imgs) if (im && im.complete && im.naturalWidth && (im.currentSrc || im.src)) return im.currentSrc || im.src;
    return cutOf(s) ? null : roomSmall.get(s) || null;
  }
  /**
   * The viewer's picture: a designer's whole sheet with the pig taken out, as the compare and the room's sheets have it
   * (Peter, Nov 19 2026: "Yes, hide it"), at its own size or 3200 across at most (2400 on a phone: the worker's memory),
   * whatever size is asked, so it's made once; anything else, or a sheet that can't be, as it is
   */
  const coarse = matchMedia('(pointer: coarse)');
  const cleanSheets = new Map<DesignSlide, string>();
  function viewerSrc(s: DesignSlide, w: number): Promise<string | null> {
    if (!isWholeSheet(s)) return slideSrc(s, w);
    const want = Math.min(Number(s.w) || 3200, coarse.matches ? 2400 : 3200);
    return sheetWithoutPig(s.url, want).then((u) => { if (u) cleanSheets.set(s, u); return u || slideSrc(s, w || want); });
  }
  const gallery = stageEl ? createGallery(stageEl, {
    src: (s, w) => viewerSrc(s, w),
    small: smallOf,
    onChange: (i) => paintBar(i),
    onZoom: (z, sheet) => zoomUi(z, sheet),
    onDismiss: () => requestClose(),
    onDismissProgress: (p) => viewer?.style.setProperty('--ldv-dim', (1 - p * 0.92).toFixed(3)),
    onFail: (s) => drop(s),
    onCompareFail: () => dropCompare(),
    comparePos: () => cmpPos,
    onCompareMove: (pos) => { cmpPos = pos; },
  }) : null;

  /** The strip and the room mark what the viewer shows (the strip scrolls it into its own view, never the page's) */
  function markShown(it: GalleryItem | null) {
    if (it && room) {
      const p = designPartsOf(slides).find((x) => x.key === it.part);
      const i = p ? entriesOf(p).indexOf(it.kind === 'compare' ? 'cmp' : it.s) : -1;
      if (p && i >= 0) { roomPart = p.key; roomAt.set(p.key, i); drawRoom(); }
    }
    const current = !it ? null : it.kind === 'compare' ? railCmp : railCards.get(it.s) || null;
    for (const b of [...railCards.values(), railCmp]) {
      if (!b) continue;
      if (b === current) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
    if (!current || !railScroll || !current.getClientRects().length) return;
    const r = current.getBoundingClientRect();
    const c = railScroll.getBoundingClientRect();
    const behavior = (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior;
    if (r.top < c.top) railScroll.scrollBy({ top: r.top - c.top - 6, behavior });
    else if (r.bottom > c.bottom) railScroll.scrollBy({ top: r.bottom - c.bottom + 6, behavior });
    if (r.left < c.left) railScroll.scrollBy({ left: r.left - c.left - 6, behavior });
    else if (r.right > c.right) railScroll.scrollBy({ left: r.right - c.right + 6, behavior });
  }

  // The bar: what it is (its badge leading the caption: "BEFORE  Dylan's room today", "PROPOSED  The new floor plan"),
  // the parts with a count each (one tap to each; the one showing yellow) and where in its part this one is
  const shortPart: Record<PartKey, string> = { photos: 'The room', plans: 'The plan', boards: 'The look' };
  let partsSig = '';
  function paintBar(i: number) {
    const it = items[i];
    if (!it) return;
    const k = vq<HTMLElement>('kicker'), c = vq<HTMLElement>('caption');
    if (it.kind === 'compare') {
      if (k) { k.textContent = ''; k.dataset.kind = ''; }
      if (c) c.textContent = 'The floor plan, before and after';
    } else {
      if (k) { k.textContent = it.s.badge || it.s.kicker; k.dataset.kind = it.s.badge ? it.s.kind : ''; }
      if (c) c.textContent = straight(it.s.caption);
    }
    const keys = [...new Set(items.map((x) => x.part))];
    const inPart = items.filter((x) => x.part === it.part);
    const partsEl = vq<HTMLElement>('parts');
    if (partsEl) {
      const want = keys.length > 1 ? keys.map((key) => `${key}:${items.filter((x) => x.part === key).length}`).join(',') : '';
      if (want !== partsSig) {
        partsSig = want;
        partsEl.replaceChildren(...(want ? keys : []).map((key) => {
          const b = el('button', 'ldv__part');
          b.type = 'button';
          b.dataset.part = key;
          const n = items.filter((x) => x.part === key).length;
          b.append(document.createTextNode(shortPart[key]), el('span', 'ldv__part-at', String(n)));
          b.setAttribute('aria-label', `${shortPart[key]}: ${n} picture${n === 1 ? '' : 's'}`);
          b.addEventListener('click', () => gallery?.go(items.findIndex((x) => x.part === key)));
          return b;
        }));
      }
      for (const b of partsEl.querySelectorAll<HTMLButtonElement>('.ldv__part')) b.setAttribute('aria-current', String(b.dataset.part === it.part));
    }
    // Where in its part (in its own place, its numbers all one width, so nothing moves as it changes)
    const n = vq<HTMLElement>('count');
    if (n) n.textContent = inPart.length > 1 ? `${inPart.indexOf(it) + 1} of ${inPart.length}` : '';
    const prev = vq<HTMLButtonElement>('prev'), next = vq<HTMLButtonElement>('next');
    // (aria-disabled, not disabled: a disabled button drops the keyboard's focus out of the viewer, and the arrows with it)
    if (prev) { prev.hidden = items.length < 2; prev.setAttribute('aria-disabled', String(i <= 0)); }
    if (next) { next.hidden = items.length < 2; next.setAttribute('aria-disabled', String(i >= items.length - 1)); }
    markShown(it);
  }
  /** The zoom button says what it does next: a whole sheet goes to its drawing and back, anything else in and out */
  function zoomUi(zoomed: boolean, sheet: boolean) {
    const b = vq<HTMLButtonElement>('zoom');
    if (!b) return;
    b.hidden = false;
    const t = b.querySelector<HTMLElement>('[data-ldv="zoom-text"]');
    if (t) t.textContent = zoomed ? (sheet ? 'Whole sheet' : 'Zoom out') : 'Zoom in';
    b.dataset.zoomed = zoomed ? 'true' : 'false';
    stageEl?.toggleAttribute('data-zoomed', zoomed);
  }

  /** How the viewer opens now: beside the video (laptop), over a phone with the video kept small, or alone */
  function modeNow(): ViewerMode {
    if (!hero?.hasAttribute('data-party')) return 'modal';
    if (laptop.matches) return frame && sideWidth() >= SIDE_MIN_W ? 'side' : 'modal';
    return stage ? 'pinned' : 'modal';
  }
  // From the screen's left edge to the frame (the video and its strip), with a margin each side
  const sideWidth = () => Math.floor((frame?.getBoundingClientRect().left || 0) - 24);
  const fitSide = () => {
    if (!viewer || mode !== 'side') return;
    // Over the Theater's left column exactly (the kid's name, the room and the messages, LivePage), so it never hangs past
    // the panel's edge; anywhere else, from the window's edge to the video
    const col = hero?.querySelector('.hero-head')?.getBoundingClientRect();
    const f0 = frame?.getBoundingClientRect();
    const onCol = !!col && !!f0 && col.width >= SIDE_MIN_W && col.right <= f0.left;
    viewer.style.setProperty('--ldv-left', `${onCol ? Math.round(col!.left) : 12}px`);
    viewer.style.setProperty('--ldv-w', `${onCol ? Math.round(col!.width) : Math.max(SIDE_MIN_W, sideWidth())}px`);
    // Top and bottom with the video (the Theater's columns are as tall as it), never past it onto the page below
    const f = frame?.getBoundingClientRect();
    const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 80;
    const top = Math.max(head + 12, f ? f.top : head + 12);
    const bottom = Math.min(innerHeight - 12, f && f.height > 200 ? f.bottom : innerHeight - 12);
    viewer.style.setProperty('--ldv-top', `${Math.round(top)}px`);
    viewer.style.setProperty('--ldv-h', `${Math.round(Math.max(320, bottom - top))}px`);
  };
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
    if (!viewer?.open || !gallery?.item) return;
    if (modeNow() === mode) { fitSide(); return; }
    const it = gallery.item;
    const again: RoomEntry = it.kind === 'compare' ? 'cmp' : it.s;
    viewer.addEventListener('close', () => { if (alive) open(again); }, { once: true });
    viewer.close();
  };
  laptop.addEventListener('change', onLayout);
  if (hero) shapeWatch?.observe(hero, { attributes: true, attributeFilter: ['data-orientation', 'data-party'] });

  // ── What's under the viewer can't be reached while it's open (Tab, a screen reader): only the viewer, and what stays
  // in sight with it, the video (with its controls and strip) and, beside the video on a laptop, the messages and the
  // site's header. (Tab into the page under it scrolled the page and typed into fields no one could see)
  let inerted: HTMLElement[] = [];
  function hold(keep: (Element | null | undefined)[]) {
    unhold();
    const kept = [viewer, ...keep].filter((e): e is Element => !!e);
    const onPath = new Set<Element>();
    for (const k of kept) for (let e: Element | null = k; e && e !== document.body; e = e.parentElement) onPath.add(e);
    for (const e of onPath) {
      for (const sib of e.parentElement ? [...e.parentElement.children] : []) {
        if (onPath.has(sib) || !(sib instanceof HTMLElement) || sib.inert || sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') continue;
        sib.inert = true;
        inerted.push(sib);
      }
    }
  }
  function unhold() {
    for (const e of inerted) e.inert = false;
    inerted = [];
  }

  const rectOf = (e: Element | null): DOMRect | null => {
    if (!e || !e.isConnected) return null;
    const pic = e.matches('img, .pcmp') ? e : e.querySelector('.pcmp, .lrm-pic img.is-in, img') || e;
    const r = pic.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    // The room's sheet shows only its drawing, and the viewer the whole sheet: where the whole sheet would be, its
    // drawing exactly on the picture, so it flies out of it (and back) without a jump
    const box = pic instanceof HTMLImageElement ? cutBoxes.get(pic) : undefined;
    if (box && pic instanceof HTMLImageElement && pic.naturalWidth && pic.naturalHeight) {
      const cs = getComputedStyle(pic);
      const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
      const cw = r.width - pl - pr, ch = r.height - pt - pb;
      const k = Math.min(cw / pic.naturalWidth, ch / pic.naturalHeight);
      const dw = pic.naturalWidth * k, dh = pic.naturalHeight * k;
      const W = dw / box.w, H = dh / box.h;
      return new DOMRect(r.left + pl + (cw - dw) / 2 - box.x * W, r.top + pt + (ch - dh) / 2 - box.y * H, W, H);
    }
    return r;
  };

  function open(target: RoomEntry, from?: Element | null) {
    if (!viewer || !gallery) return;
    const list = itemsNow();
    const i = indexIn(list, target);
    if (i < 0) return;
    if (viewer.open) { gallery.go(i); return; }
    opener = document.activeElement as HTMLElement | null;
    origin = from || null;
    mode = modeNow();
    viewer.classList.toggle('ldv--side', mode === 'side');
    viewer.classList.toggle('ldv--pinned', mode === 'pinned');
    viewer.classList.toggle('ldv--wide', wideNow());
    viewer.setAttribute('aria-modal', mode === 'modal' ? 'true' : 'false');
    viewer.style.setProperty('--ldv-dim', '1');
    fitSide();
    // The page holds still behind it: no wheel or swipe scrolls what's underneath
    held = { y: scrollY, overflow: document.documentElement.style.overflow };
    document.documentElement.style.overflow = 'hidden';
    if (mode === 'modal') viewer.showModal();
    else {
      // Not modal: the video stays in sight and in reach (its sound, its controls), and so does the strip
      viewer.show();
      if (mode === 'pinned') stage?.pin(true, 'design');
      const stageRoot = frame?.querySelector('[data-stage]');
      hold(mode === 'side' ? [frame, hero?.querySelector('.hero-party'), document.querySelector('body > header, .site-header')] : [stageRoot]);
      vq<HTMLElement>('close')?.focus({ preventScroll: true });
      document.addEventListener('keydown', onDocKey);
      document.addEventListener('click', onDocClick, true);
      addEventListener('resize', fitSide);
    }
    items = list;
    gallery.setItems(items, i);
    paintBar(i);
    // (the room's sheet showed only its drawing: the viewer opens at it, bigger, its whole sheet a Zoom out away)
    if (origin && origin === rq('big') && target !== 'cmp' && cutOf(target)) gallery.toDrawing();
    gallery.flyFrom(rectOf(origin));
  }
  /** The pictures changed while it's open (one couldn't load, the design was redrawn): the same one stays if it can */
  function refreshViewer(target?: RoomEntry) {
    if (!viewer?.open || !gallery) return;
    const list = itemsNow();
    if (!list.length) { requestClose(); return; }
    const it = gallery.item;
    const now: RoomEntry | null = target || (it ? (it.kind === 'compare' ? 'cmp' : it.s) : null);
    let i = now ? indexIn(list, now) : -1;
    if (i < 0) i = Math.min(gallery.index, list.length - 1);
    items = list;
    gallery.setItems(items, i);
    paintBar(i);
  }
  /** Where it goes back to: the card it opened from while that shows what it shows, else the one that does, if in sight */
  function closeTarget(): DOMRect | null {
    const it = gallery?.item;
    if (!it) return null;
    const mine = (e: Element | null | undefined) => {
      if (!e) return null;
      const r = rectOf(e);
      return r && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? r : null;
    };
    const originShows = origin && (it.kind === 'compare' ? !!origin.closest('.pcmp, .hds-cmp') || origin === rq('big') : origin === rq('big') || (cards.get(it.s) || []).some((li) => li.contains(origin)) || railCards.get(it.s)?.contains(origin));
    if (originShows || origin === railBtn?.querySelector('img')) { const r = mine(origin); if (r) return r; }
    if (roomShowing()) return mine(it.kind === 'compare' ? rq('cmp') : rq('big'));
    const cardEl = it.kind === 'compare' ? railCmp || parts.querySelector('.ldz-compare .pcmp') : railCards.get(it.s) || cards.get(it.s)?.[0];
    return mine(cardEl);
  }
  function requestClose() {
    if (!viewer?.open || closing) return;
    closing = true;
    const to = closeTarget();
    void (gallery ? gallery.flyTo(to) : Promise.resolve()).then(() => { closing = false; if (viewer.open) viewer.close(); });
  }

  const onPrev = () => gallery?.go(gallery.index - 1);
  const onNext = () => gallery?.go(gallery.index + 1);
  const onZoomClick = () => gallery?.toggleZoom();
  const onKey = (e: KeyboardEvent) => {
    // (on the compare's line, the arrows move the line)
    if ((e.target as Element)?.closest?.('[data-pcmp="range"]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); gallery?.zoomBy(1.6); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); gallery?.zoomBy(1 / 1.6); }
  };
  // Not modal, the keys work wherever focus is (the strip, the video), except in a field someone is typing in
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input:not([data-pcmp]), textarea, select, [contenteditable="true"]');
  const onDocKey = (e: KeyboardEvent) => {
    if (!viewer?.open) return;
    if (e.key === 'Escape') { e.preventDefault(); requestClose(); return; }
    if (viewer.contains(e.target as Node) || typing(e.target)) return;
    onKey(e);
  };
  // On a phone, a tap on the small video goes back to it (rather than the mini player's own scroll to it)
  const onDocClick = (e: MouseEvent) => {
    if (!viewer?.open || mode !== 'pinned') return;
    if (!(e.target as Element).closest?.('[data-stage] [data-s="picture"]')) return;
    e.preventDefault();
    e.stopPropagation();
    requestClose();
  };
  // A click on the dark around the picture closes it (never the end of a drag)
  const onBackdrop = (e: MouseEvent) => {
    const t = e.target as Element;
    if (t === viewer || ((t.classList?.contains('ldg-pane') || t.classList?.contains('ldg-fly') || t.classList?.contains('ldg-cmp')) && !gallery?.wasDrag)) requestClose();
  };
  // Esc on a modal one, and its close button: it goes back into its card first
  const onCancel = (e: Event) => { e.preventDefault(); requestClose(); };
  const onCloseBtn = (e: MouseEvent) => { e.preventDefault(); requestClose(); };
  const onClose = () => {
    document.removeEventListener('keydown', onDocKey);
    document.removeEventListener('click', onDocClick, true);
    removeEventListener('resize', fitSide);
    if (mode === 'pinned') stage?.pin(false);
    mode = 'modal';
    closing = false;
    gallery?.settle();
    markShown(null);
    if (cmpPos != null) for (const c of compares) if (c.root.matches('.pcmp') && Math.abs(c.handle.pos - cmpPos) > 0.1) c.handle.set(cmpPos);
    unhold();
    viewer?.style.removeProperty('--ldv-dim');
    if (held) {
      document.documentElement.style.overflow = held.overflow;
      if (Math.abs(scrollY - held.y) > 1) scrollTo({ top: held.y, behavior: 'instant' as ScrollBehavior });
      held = null;
    }
    opener?.focus({ preventScroll: true });
    opener = null;
    origin = null;
  };
  vq('prev')?.addEventListener('click', onPrev);
  vq('next')?.addEventListener('click', onNext);
  vq('zoom')?.addEventListener('click', onZoomClick);
  vq<HTMLElement>('close')?.addEventListener('click', onCloseBtn);
  viewer?.addEventListener('keydown', onKey);
  viewer?.addEventListener('click', onBackdrop);
  viewer?.addEventListener('cancel', onCancel);
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
      roomWatch?.disconnect();
      sizeWatch?.disconnect();
      laptop.removeEventListener('change', onLayout);
      asking?.abort();
      clearTimeout(askTimer);
      document.removeEventListener('visibilitychange', onVisible);
      vq('prev')?.removeEventListener('click', onPrev);
      vq('next')?.removeEventListener('click', onNext);
      vq('zoom')?.removeEventListener('click', onZoomClick);
      vq<HTMLElement>('close')?.removeEventListener('click', onCloseBtn);
      railBtn?.removeEventListener('click', onRailBtn);
      viewer?.removeEventListener('keydown', onKey);
      viewer?.removeEventListener('click', onBackdrop);
      viewer?.removeEventListener('cancel', onCancel);
      if (viewer?.open) viewer.close();
      onClose();
      forgetCompares();
      gallery?.destroy();
      viewer?.removeEventListener('close', onClose);
    },
  };
}
