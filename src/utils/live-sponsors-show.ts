/**
 * live-sponsors-show.ts — the Theater's sponsor column, laid out and turned (LiveSponsors.astro)
 * =============================================================================================
 * Peter, Nov 20 2026, of Max's twenty logos in the column: "how can we better display and showcase these logos on
 * larger ipad and desktop? they are still too small to actually see, i need your best here, fresh eyes, amazing uiux,
 * motion, no patches". Twenty logos in a column 258px wide and as tall as the video can't all be big at once: shown all
 * together they were 25 to 30px tall. So the column shows fewer at a time, each at least twice that size:
 *
 *   - the room's sponsors stay at the top, always on screen, their cells as big as any below them (bigger when there
 *     are one or two);
 *   - under them the partners, by tier, in pages: every partner's cell the same height (Peter, Nov 19 2026: "signature
 *     and down, the logos should be the same size"), a wide wordmark a whole row, a square mark half of one, as many
 *     rows as the column holds at that height; a page that is all one tier says so, a tier too long for one page
 *     continues on the next under its name again;
 *   - the pages turn by themselves: each holds for a few seconds while a thin bar beside its tier's name fills, then its
 *     logos lift away and the next page's rise in one after another. A pointer resting on the partners holds the page,
 *     the bars are buttons to go to any page, and anyone who asked for less motion gets every partner at the same size
 *     in one still list they scroll by hand.
 *
 * Everything that fits on one page stays still, with no bars. The sizes come from the column's own height: they're
 * worked out again whenever the column changes size (shown, the window resized) and when a logo fails to load.
 * The pure parts (rowsOf, cellSizes, paginate) are exported for tests (tests/live-sponsors-show.test.mjs).
 */

/** A card's row cost: a wide logo takes a whole row, two square ones share one (the grid packs them densely) */
export const rowsOf = (wide: readonly boolean[]): number => {
  let w = 0, n = 0;
  for (const x of wide) { if (x) w++; else n++; }
  return w + Math.ceil(n / 2);
};

/** Gaps (px): between cells, between the column's parts (head, room's sponsors, partners), a tier's name and its
 *  logos, two tiers on one page */
export const GAP = { cell: 6, stack: 14, label: 6, section: 14 } as const;

/** The room's sponsors' cell against the partners': bigger when there are few of them, never smaller */
export const roomFactor = (k: number) => (k <= 0 ? 0 : k === 1 ? 1.45 : k === 2 ? 1.22 : k === 3 ? 1.08 : 1);

/**
 * The cells' heights for a column: h for every partner, hr for the room's sponsors.
 * colH the column's height; headH its heading's; labelH a tier name's; k how many room sponsors; rows how many rows
 * the partners take in all (rowsOf, tier by tier). The partners' rows per page are picked so their cell is closest to
 * a height that grows with the screen (70px on a short laptop, 96px on a tall monitor); the room's sponsors and one
 * page of partners then fill the column.
 */
export function cellSizes(m: { colH: number; headH: number; labelH: number; k: number; rows: number; tiers?: number }): { h: number; hr: number; perPage: number } {
  const f = roomFactor(m.k);
  const lb = m.labelH + GAP.label;
  const avail = m.colH - m.headH - GAP.stack - (m.k ? lb + (m.k - 1) * GAP.cell + GAP.stack : 0) - lb;
  const target = Math.min(96, Math.max(70, m.colH / 9.6));
  const at = (r: number) => (avail - (r - 1) * GAP.cell) / (m.k * f + r);
  let best = 2;
  for (let r = 2; r <= 10; r++) if (Math.abs(at(r) - target) <= Math.abs(at(best) - target)) best = r;
  let raw = at(best);
  // (a build whose partners all fit on one page at about that size, every tier's name with them: one still page, its
  // rows as tall as that leaves room for, to a point)
  const t = Math.max(1, m.tiers || 1);
  const one = m.rows > 0 ? (avail - (t - 1) * (lb + GAP.section) - (m.rows - 1) * GAP.cell) / (m.k * f + m.rows) : 0;
  if (one >= Math.min(raw, target) * 0.9) { raw = one; best = m.rows; }
  const h = Math.floor(Math.min(104, Math.max(52, raw)));
  const hr = m.k ? Math.floor(Math.min(132, h * f)) : 0;
  return { h, hr, perPage: best };
}

/** One tier's run of cards on a page: the tier's index, its cards from..to (to not included) */
export interface Run { tier: number; from: number; to: number }

/**
 * The partners in pages. tiers: each tier's cards as wide (true) or not; space the showcase's height; h a cell's;
 * lb a tier name's height with its gap. Tiers keep their order and stay whole on one page; one too long for any page
 * fills a page at a time, in order, its last part sharing a page with the tiers after it. As few pages as that allows,
 * and among those the most even (the emptiest page as full as it can be), so no page is nearly bare beside full ones.
 */
export function paginate(tiers: readonly (readonly boolean[])[], space: number, h: number, lb: number): Run[][] {
  const fit = (room: number) => Math.max(0, Math.floor((room + GAP.cell) / (h + GAP.cell)));
  const fullRows = Math.max(1, fit(space - lb));
  // (the parts that never break: a whole tier, or a page's worth of a long one)
  const atoms: Run[] = [];
  tiers.forEach((cards, t) => {
    let i = 0;
    while (i < cards.length) {
      let j = i + 1;
      while (j < cards.length && rowsOf(cards.slice(i, j + 1)) <= fullRows) j++;
      atoms.push({ tier: t, from: i, to: j });
      i = j;
    }
  });
  const tall = (r: Run) => { const rows = rowsOf(tiers[r.tier].slice(r.from, r.to)); return lb + rows * h + (rows - 1) * GAP.cell; };
  const pageTall = (a: number, b: number) => { let s = 0; for (let x = a; x < b; x++) s += (x > a ? GAP.section : 0) + tall(atoms[x]); return s; };
  // (fewest pages, then the emptiest page as full as it can be: least[p][b] is that page's height for the first b parts
  // in p pages, -1 when they can't be)
  const n = atoms.length;
  if (!n) return [];
  const least: number[][] = [[Infinity, ...Array(n).fill(-1)]];
  const from: number[][] = [[]];
  for (let p = 1; p <= n; p++) {
    least.push(Array(n + 1).fill(-1));
    from.push(Array(n + 1).fill(-1));
    for (let b = 1; b <= n; b++) {
      for (let a = b - 1; a >= 0; a--) {
        const t = pageTall(a, b);
        if (t > space && b - a > 1) break;
        if (least[p - 1][a] < 0) continue;
        const v = Math.min(least[p - 1][a], t);
        if (v > least[p][b]) { least[p][b] = v; from[p][b] = a; }
      }
    }
    if (least[p][n] >= 0) {
      const pages: Run[][] = [];
      for (let b = n, q = p; b > 0; q--) { const a = from[q][b]; pages.unshift(atoms.slice(a, b)); b = a; }
      return pages;
    }
  }
  return atoms.map((a) => [a]);
}

/** Wide: a logo that, in half a row, would be held by the half's width to under about three quarters of the height it
 *  could have. A cell keeps 4px at its sides and 9% of its height above and below (LiveSponsors). r: width ÷ height,
 *  0 when not known yet (taken as wide: never too big for its cell) */
export const isWide = (r: number, h: number, colW: number) => {
  const pad = Math.max(5, h * 0.09);
  return !r || r >= (((colW - GAP.cell) / 2 - 8) / (h - 2 * pad)) * 1.3;
};

/**
 * The whole column's layout: the cells' heights, which logos are wide, and the partners' pages. ratios: each partner
 * tier's logos' width ÷ height. The cells start at cellSizes' height; then they grow, a pixel at a time to 104px, for
 * as long as the partners still take no more pages, so a build with fewer partners gets bigger logos rather than
 * emptier pages.
 */
export function layoutFor(m: { colH: number; colW: number; headH: number; labelH: number; k: number; ratios: readonly (readonly number[])[] }) {
  const lb = m.labelH + GAP.label;
  const f = roomFactor(m.k);
  const wideAt = (h: number) => m.ratios.map((t) => t.map((r) => isWide(r, h, m.colW)));
  const hrOf = (h: number) => (m.k ? Math.floor(Math.min(132, h * f)) : 0);
  const spaceAt = (h: number) => m.colH - m.headH - GAP.stack - (m.k ? lb + m.k * hrOf(h) + (m.k - 1) * GAP.cell + GAP.stack : 0);
  const count = m.ratios.reduce((s, t) => s + t.length, 0);
  let size = cellSizes({ colH: m.colH, headH: m.headH, labelH: m.labelH, k: m.k, rows: count, tiers: m.ratios.length });
  size = cellSizes({ colH: m.colH, headH: m.headH, labelH: m.labelH, k: m.k, rows: wideAt(size.h).reduce((s, w) => s + rowsOf(w), 0), tiers: m.ratios.length });
  let h = size.h, wide = wideAt(h), pages = paginate(wide, spaceAt(h), h, lb);
  for (let x = h + 1; x <= 104 && count; x++) {
    if (spaceAt(x) < lb + x) break;
    const wx = wideAt(x), px = paginate(wx, spaceAt(x), x, lb);
    if (px.length <= pages.length) { h = x; wide = wx; pages = px; }
  }
  return { h, hr: hrOf(h), wide, pages, space: spaceAt(h), lb };
}

/** How long a page holds before the next (ms; the bar's fill, LiveSponsors) */
export const HOLD_MS = 6000;

interface Tier { tier: string; label: string; cards: HTMLElement[] }

/**
 * Lays out and turns the sponsor column `col` (LiveSponsors' aside). Weighs each logo as it loads (--r), drops one that
 * fails (and its tier when it was the last; onDrop then), and lays out again whenever the column's size changes.
 * Returns relayout() for the page to call (fonts loaded, the column shown).
 */
export function sponsorShow(col: HTMLElement, opts: { onDrop?: () => void } = {}): { relayout: () => void } {
  const show = col.querySelector<HTMLElement>('[data-lsp-show]');
  const room = col.querySelector<HTMLElement>('.lsp-tier--room');
  const head = col.querySelector<HTMLElement>('.lsp-head');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // The partners' tiers as the server drew them; their cards move into pages from here
  const tiers: Tier[] = show
    ? [...show.querySelectorAll<HTMLElement>(':scope > .lsp-tier')].map((s) => ({
      tier: s.dataset.tier || '', label: s.querySelector('.lsp-label')?.textContent || '', cards: [...s.querySelectorAll<HTMLElement>('.lsp-card')],
    }))
    : [];
  const ratio = (card: HTMLElement) => parseFloat(card.querySelector('img')?.style.getPropertyValue('--r') || '') || 0;
  let pages: HTMLElement[] = [], dots: HTMLButtonElement[] = [], cur = 0, laid = false, ready = false, key = '';
  const timers = new WeakMap<HTMLElement, number>();

  // ── Each logo weighed as it loads; one that fails leaves ──
  const pending = new Set<HTMLImageElement>();
  let settle: () => void = () => {};
  const settled = new Promise<void>((res) => { settle = res; });
  const check = () => { if (!pending.size) settle(); };
  col.querySelectorAll<HTMLImageElement>('img[data-lsp-logo]').forEach((img) => {
    const weigh = () => { if (img.naturalWidth && img.naturalHeight) img.style.setProperty('--r', (img.naturalWidth / img.naturalHeight).toFixed(3)); pending.delete(img); check(); if (ready) relayout(); };
    const drop = () => {
      pending.delete(img);
      const card = img.closest<HTMLElement>('.lsp-card');
      for (const t of tiers) { const i = card ? t.cards.indexOf(card) : -1; if (i >= 0) t.cards.splice(i, 1); }
      const sec = img.closest('.lsp-tier');
      card?.remove();
      if (sec && !sec.querySelector('.lsp-card')) sec.remove();
      for (let i = tiers.length - 1; i >= 0; i--) if (!tiers[i].cards.length) tiers.splice(i, 1);
      opts.onDrop?.();
      check();
      if (ready) relayout(true);
    };
    if (img.complete && img.naturalWidth) { weigh(); return; }
    pending.add(img);
    img.addEventListener('load', weigh, { once: true });
    img.addEventListener('error', drop, { once: true });
    if (img.complete && img.getAttribute('src')) img.decode().then(weigh, () => { if (!img.naturalWidth) drop(); });
  });
  check();

  // ── A page's runs drawn: each tier's name, then its cards (moved, never copied: each logo loads once) ──
  const section = (t: Tier, cards: HTMLElement[]) => {
    const s = document.createElement('section');
    s.className = `lsp-tier lsp-tier--${t.tier}`;
    s.dataset.tier = t.tier;
    const p = document.createElement('p');
    p.className = 'lsp-label';
    p.textContent = t.label;
    const ul = document.createElement('ul');
    ul.className = 'lsp-grid';
    // (an odd square mark out, the last, has its row to itself, centred, never half a row with nothing beside it)
    const narrow = cards.filter((c) => !c.hasAttribute('data-wide'));
    cards.forEach((c) => c.toggleAttribute('data-solo', narrow.length % 2 === 1 && c === narrow[narrow.length - 1]));
    ul.append(...cards);
    s.append(p, ul);
    return s;
  };
  // (each name and logo's place in its page's cascade; `from` continues the room's when the column first comes in)
  const number = (root: Element, from = 0) => {
    root.querySelectorAll<HTMLElement>('.lsp-label, .lsp-card').forEach((n, i) => n.style.setProperty('--i', String(from + i)));
  };

  function go(i: number, calm = false) {
    if (!pages.length) return;
    const next = ((i % pages.length) + pages.length) % pages.length;
    const prev = pages[cur];
    if (prev && next !== cur) {
      prev.removeAttribute('data-on');
      prev.setAttribute('data-out', '');
      clearTimeout(timers.get(prev));
      timers.set(prev, window.setTimeout(() => prev.removeAttribute('data-out'), 520));
    }
    const page = pages[next];
    // (the same tier's name at the top of both pages stays where it is through the turn)
    show?.querySelectorAll('.lsp-label[data-keep]').forEach((l) => l.removeAttribute('data-keep'));
    const was = prev && next !== cur ? prev.querySelector('.lsp-label') : null, now = page.querySelector('.lsp-label');
    if (was && now && was.textContent === now.textContent) { was.setAttribute('data-keep', ''); now.setAttribute('data-keep', ''); }
    clearTimeout(timers.get(page));
    page.removeAttribute('data-out');
    page.toggleAttribute('data-calm', calm);
    // (the same page again restarts its rise and its bar)
    if (next === cur && page.hasAttribute('data-on')) { page.removeAttribute('data-on'); void page.offsetWidth; }
    page.setAttribute('data-on', '');
    cur = next;
    dots.forEach((d, k) => {
      if (k === next) { d.removeAttribute('aria-current'); void d.offsetWidth; d.setAttribute('aria-current', 'true'); } else d.removeAttribute('aria-current');
    });
  }

  function relayout(force = false) {
    if (!show && !room) return;
    const colH = col.clientHeight, colW = col.clientWidth;
    if (!colH || !colW || col.hidden) return;
    const labelEl = col.querySelector<HTMLElement>('.lsp-label');
    const labelH = labelEl?.offsetHeight || 15;
    const headH = head?.offsetHeight || 0;
    const k = room?.querySelectorAll('.lsp-card').length || 0;
    const all = tiers.map((t) => t.cards);
    const L = layoutFor({ colH, colW, headH, labelH, k, ratios: all.map((cards) => cards.map(ratio)) });
    const still = reduced.matches;
    const next = `${colH}|${colW}|${labelH}|${headH}|${still}|${L.h}|${L.hr}|${L.wide.map((w) => w.map(Number).join('')).join('/')}`;
    if (next === key && !force) return;
    key = next;
    col.style.setProperty('--lsp-h', `${L.h}px`);
    col.style.setProperty('--lsp-hr', `${L.hr}px`);
    all.forEach((cards, t) => cards.forEach((c, i) => c.toggleAttribute('data-wide', L.wide[t][i])));
    const first = !laid;
    if (room) number(room);
    if (show) {
      // (the pages as worked out, unless the showcase came out shorter than counted, then again for its real height)
      const space = show.clientHeight;
      const runs = still ? [tiers.map((t, i) => ({ tier: i, from: 0, to: t.cards.length }))]
        : space + 0.5 < L.space ? paginate(L.wide, space, L.h, L.lb) : L.pages;
      const keepAt = Math.min(cur, Math.max(0, runs.length - 1));
      pages.forEach((p) => clearTimeout(timers.get(p)));
      const built = runs.map((page, n) => {
        const el = document.createElement('div');
        el.className = 'lsp-page';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', `${page.map((r) => tiers[r.tier].label).filter((l, i, a) => a.indexOf(l) === i).join(', ')}${runs.length > 1 ? ` (${n + 1} of ${runs.length})` : ''}`);
        el.append(...page.map((r) => section(tiers[r.tier], tiers[r.tier].cards.slice(r.from, r.to))));
        number(el, first && n === keepAt ? k + 1 : 0);
        return el;
      });
      const bar = document.createElement('div');
      bar.className = 'lsp-dots';
      dots = built.length > 1 ? built.map((el, n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lsp-dot';
        b.setAttribute('aria-label', `Show ${el.getAttribute('aria-label')}`);
        b.title = el.getAttribute('aria-label') || '';
        b.append(document.createElement('i'));
        b.addEventListener('click', () => go(n));
        return b;
      }) : [];
      bar.append(...dots);
      bar.hidden = !dots.length;
      show.replaceChildren(...built, bar);
      show.toggleAttribute('data-still', still);
      show.setAttribute('data-built', '');
      pages = built;
      cur = keepAt;
      // (the first time in: the room's sponsors then the first page rise in one after another; after that a new layout
      // stands in place on the page it was on)
      go(keepAt, !first);
    }
    if (first) {
      col.setAttribute('data-laid', '');
      col.setAttribute('data-lsp-in', '');
      window.setTimeout(() => col.removeAttribute('data-lsp-in'), 2200);
    }
    laid = true;
  }

  // A page's bar filled: the next page
  show?.addEventListener('animationend', (e) => {
    const t = e.target as Element;
    if (t.parentElement?.matches('.lsp-dot[aria-current]') && e.animationName === 'lspFill') go(cur + 1);
  });
  // (the first layout once every logo's shape is known, or after a second and a half with what's known; any logo that
  // comes later is laid out again with the rest)
  // (a column not on screen yet, before a reveal goes live or on a narrower window, is laid out when it shows: its size
  // changes from nothing)
  Promise.race([settled, new Promise((r) => setTimeout(r, 1500))]).then(() => { ready = true; relayout(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (ready) relayout(); }).observe(col);
  reduced.addEventListener?.('change', () => relayout(true));
  return { relayout: () => { if (ready) relayout(); } };
}
