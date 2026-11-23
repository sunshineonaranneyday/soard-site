/**
 * The makeovers as a board: a column per stage, Awaiting funding, then Design
 * to Build, from JobTread (numbers.projects, see _board.js projectsNow). Each
 * card leads with the kid's photo, then their name and the reveal: the day
 * and time once it's set, else the part of the month. A kid or organization
 * with no photo yet has a flat block with initials in its place.
 *
 * One board, three places: Home (`home`), the makeovers item of a meeting's
 * agenda (`agenda`), and the meeting on the screen (`screen`, sized to fill a
 * TV without scrolling: the busier the columns, the smaller the cards).
 */

import { h, htm, useRef, useEffect } from '../vendor.js';
import { sized, shortDate } from './parts.js';
import { clock, plural, initialsOf } from '../board-shared.js';

const html = htm.bind(h);
export { sized };
// "+2 more families", "10 AM": the number kept with its word
const kept = (s) => s.replace(/(\d) (\S+)/, '$1 $2');

export const AWAITING = 'Awaiting Funding';
const STAGE_FLOW = ['Design', 'Finalization', 'Approval', 'Mobilization', 'Build'];
// The narrowest a makeover's card goes on the screen, in the screen's units (175px at 1080p)
const CARD_MIN = 11;
// The narrowest a stage with nobody in it goes on the screen's track, and the room between two columns, in its units
const SLIVER = 8.5;
const GAP = 1.81;
/**
 * Each capital's width in Outfit at weight 800, in em, as measured: a stage's name on the screen's track is set that
 * way, in capitals 1.2 units tall spaced 0.11em apart, and never breaks inside a word (portal.css .bs-pipe__stage), so
 * its column can be made as wide as it before anything is drawn. Anything not here counts as wide as a W
 */
const CAP_EM = {
  A: 0.742, B: 0.65, C: 0.692, D: 0.761, E: 0.627, F: 0.602, G: 0.791, H: 0.739, I: 0.305, J: 0.55, K: 0.721, L: 0.567, M: 0.866,
  N: 0.748, O: 0.812, P: 0.64, Q: 0.819, R: 0.663, S: 0.596, T: 0.649, U: 0.708, V: 0.722, W: 1.012, X: 0.724, Y: 0.694, Z: 0.617,
  0: 0.671, 1: 0.39, 2: 0.576, 3: 0.569, 4: 0.613, 5: 0.568, 6: 0.579, 7: 0.53, 8: 0.569, 9: 0.579,
  ' ': 0.185, '&': 0.701, '/': 0.376, '-': 0.463, "'": 0.254, '’': 0.266, '.': 0.304, ',': 0.287, '(': 0.315, ')': 0.315,
};
const STAGE_SIZE = 1.2;
const STAGE_SPACING = 0.11;
/**
 * How wide a stage's name is on the screen's track, in the screen's units: its longer line, whole on one line or
 * broken at a space onto two (the track keeps two lines for it), the narrower of the two, with a hair to spare for how
 * each browser draws the font. "Mobilization" is 10.6: wider than a sliver, so its column is that wide
 */
export function stageNameWidth(label) {
  const em = (s) => [...s.toUpperCase()].reduce((t, c) => t + (CAP_EM[c] ?? 1.02) + STAGE_SPACING, 0);
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  let widest = em(words.join(' '));
  for (let k = 1; k < words.length; k++) widest = Math.min(widest, Math.max(em(words.slice(0, k).join(' ')), em(words.slice(k).join(' '))));
  return widest * STAGE_SIZE + 0.25;
}
const u2 = (n) => Number(n.toFixed(2));
/**
 * Each letter's width in Outfit at the reveal tag's weight (750), in em, as measured: a card's tag (portal.css
 * .bs-pipe__when, 1.2 units tall in a pill 0.75em each side, kept 1.68 units inside the card) says the reveal in full
 * only when its card has room for all of it. Anything not here counts as wide as an m
 */
const TAG_EM = {
  A: 0.735, B: 0.645, C: 0.691, D: 0.758, E: 0.621, F: 0.596, G: 0.788, H: 0.735, I: 0.299, J: 0.541, K: 0.713, L: 0.564, M: 0.862,
  N: 0.743, O: 0.809, P: 0.634, Q: 0.819, R: 0.658, S: 0.589, T: 0.644, U: 0.705, V: 0.717, W: 1.007, X: 0.719, Y: 0.69, Z: 0.612,
  a: 0.599, b: 0.599, c: 0.498, d: 0.599, e: 0.551, f: 0.444, g: 0.586, h: 0.577, i: 0.268, j: 0.28, k: 0.554, l: 0.268, m: 0.876,
  n: 0.577, o: 0.579, p: 0.599, q: 0.599, r: 0.448, s: 0.464, t: 0.404, u: 0.545, v: 0.543, w: 0.792, x: 0.543, y: 0.538, z: 0.488,
  0: 0.668, 1: 0.384, 2: 0.57, 3: 0.564, 4: 0.611, 5: 0.564, 6: 0.576, 7: 0.528, 8: 0.566, 9: 0.576,
  ' ': 0.188, '\u00a0': 0.188, '·': 0.19, '&': 0.696, '/': 0.38, '-': 0.462, "'": 0.252, '’': 0.263, '.': 0.302, ',': 0.285, ':': 0.295,
};
/** A reveal tag's width at `size` (in the screen's units, or a phone's pixels): its words, its pill's padding, and a hair to spare */
const tagWidth = (words, size = 1.2) => size * ([...words].reduce((t, c) => t + (TAG_EM[c] ?? 0.88), 0) + 1.5) + size / 12;
/**
 * How wide the grid makes a column that shares the slide 1fr, in the screen's units: `tracks`, each column's least and
 * its share ([min, fr]); a column whose share would be less than its least keeps its least, and the rest share what's
 * left of `free` (the slide less its gaps), as CSS grid does
 */
function shareOut(tracks, free) {
  const held = new Set();
  for (;;) {
    const flex = tracks.reduce((t, [, fr], i) => t + (held.has(i) ? 0 : fr), 0);
    const size = (free - tracks.reduce((t, [min], i) => t + (held.has(i) ? min : 0), 0)) / (flex || 1);
    const i = tracks.findIndex(([min, fr], k) => !held.has(k) && fr * size < min);
    if (i < 0) return size;
    held.add(i);
  }
}
// A reveal's part of a month as the day it starts ("2026-11" late → "2026-11-21"), to put reveals in order
const windowStartOf = (w) => (/^\d{4}-\d{2}$/.test(String(w?.month || '')) ? `${w.month}-${{ early: '01', mid: '11', late: '21' }[w.part] || '01'}` : '');
const hueOf = (s) => [42, 28, 96, 152, 200, 18][[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % 6];
const CAL = html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>`;

/** Where a makeover's link goes: a kid's page, or a community project's page once it's public */
/** A makeover's card on Home, for a search to land on */
/**
 * A name's widest line, in letters, set in two lines (the break that leaves the shorter longest line) and in one: the
 * reveals slide sets it no bigger than its card fits ("Perfect Harmony / Health" whole, not "Perfect / Harmony…").
 * The makeovers slide measures its names instead (fitPipe)
 */
export function nameFit(name) {
  const words = String(name || '').trim().split(/\s+/);
  const one = words.join(' ').length;
  let two = one;
  for (let k = 1; k < words.length; k++) two = Math.min(two, Math.max(words.slice(0, k).join(' ').length, words.slice(k).join(' ').length));
  // (and its longest piece no line can break inside: a hyphenated name breaks after its hyphen)
  const piece = Math.max(...words.flatMap((w) => w.split(/(?<=-)/)).map((w) => w.length));
  return `--c1:${Math.max(4, one)};--c2:${Math.max(4, two)};--w:${Math.max(4, piece)}`;
}
export const cardId = (b) => `kb-${String(b.slug || b.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
export const hrefOf = (b) => (b.kind === 'community' ? b.url || '' : b.url || (b.slug ? `/kids/${b.slug}/` : ''));

/** The columns, in order, each with its cards: [{ stage, label, list }] */
export function columnsOf(projects) {
  const building = projects?.building || [];
  const waiting = projects?.waiting || [];
  const all = [...waiting, ...building];
  const stages = [AWAITING, ...STAGE_FLOW.filter((st) => st !== 'Finalization' || building.some((b) => b.status === st)), ...new Set(building.map((b) => b.status).filter((st) => !STAGE_FLOW.includes(st)))];
  return stages.map((stage) => ({ stage, label: stage === AWAITING ? 'Awaiting funding' : stage, list: all.filter((b) => b.status === stage) }));
}
/** "6 in progress · 3 awaiting funding" */
export function kanbanLine(projects) {
  const building = projects?.building || [];
  const waiting = projects?.waiting || [];
  return [building.length ? `${building.length} in progress` : '', waiting.length ? `${waiting.length} awaiting funding` : ''].filter(Boolean).join(' · ');
}

/**
 * A makeover's reveal on its card: the day and time once it's set, else the part of the month, else "date to come"
 * (none while it's awaiting funding: its column says why). `reveals`: numbers.reveals. Also Home's Makeovers card
 * (./lifecycle.js)
 */
export function revealTag(b, reveals = []) {
  if (b.kind === 'community') return html`<span class="bk-card__reveal is-quiet">Community project</span>`;
  const r = b.slug ? reveals.find((x) => x.slug === b.slug) : null;
  if (r?.confirmed && r.date) return html`<span class="bk-card__reveal is-set">${CAL}Reveal ${shortDate(r.date).replace(/, \d{4}$/, '').replace(' ', '\u00a0')}${r.time ? `\u00a0· ${kept(clock(r.time).replace(':00', ''))}` : ''}</span>`;
  if (r?.window?.label) return html`<span class="bk-card__reveal">${CAL}Reveal ${r.window.label}</span>`;
  return b.status === AWAITING ? null : html`<span class="bk-card__reveal is-quiet">Reveal date to come</span>`;
}

/**
 * The board itself. `reveals` are numbers.reveals (a kid's reveal on their card); `variant` is home, agenda or
 * screen; `links` makes each card open its page (never on the screen).
 */
export function Kanban({ projects, reveals = [], variant = 'home', links = variant !== 'screen' }) {
  if (!projects) return html`<p class="bk-none">The makeovers from JobTread aren’t available right now.</p>`;
  const cols = columnsOf(projects);
  const reveal = (b) => revealTag(b, reveals);
  // The screen's cards are wide and short: the crop is that shape, around the face, so nobody's head is cut off
  const photoSize = variant === 'screen' ? 'w=720,h=300,fit=cover,gravity=face' : 'w=560,h=380,fit=cover,gravity=face';
  const card = (b) => {
    const href = links ? hrefOf(b) : '';
    const inner = html`<span class="bk-card__photo">${b.photo
      ? html`<img src=${sized(b.photo, photoSize)} alt="" loading=${variant === 'screen' ? 'eager' : 'lazy'} decoding="async" width="280" height="190" />`
      : html`<span class="bk-card__initials" style=${`--hue:${hueOf(b.name)}`} aria-hidden="true">${initialsOf(b.name)}</span>`}</span>
      <span class="bk-card__body"><span class="bk-card__name" title=${b.name}>${b.name}</span>${reveal(b)}</span>`;
    // (an id a search for them lands on: Home's board brought round to their card)
    return html`<li key=${b.slug || b.name} id=${variant === 'home' ? cardId(b) : null}>${href ? html`<a class="bk-card" href=${href} target="_blank" rel="noopener">${inner}</a>` : html`<div class="bk-card">${inner}</div>`}</li>`;
  };
  // On the screen every card has to fit: the fullest column decides how big they all are
  const most = Math.max(1, ...cols.map((c) => c.list.filter((b) => b.name).length + (c.list.some((b) => !b.name) ? 1 : 0)));
  return html`<div class=${`bk bk--${variant}`} style=${`--cols:${cols.length};--rows:${Math.max(2, most)}`} data-dense=${most > 3 ? (most > 5 ? 'more' : 'yes') : null}>
    ${cols.map(({ stage, label, list }) => {
      const named = list.filter((b) => b.name);
      const unnamed = list.filter((b) => !b.name && b.kind !== 'community').length;
      const orgs = list.filter((b) => !b.name && b.kind === 'community').length;
      return html`<div class=${`bk-col ${list.length ? '' : 'is-empty'}`} key=${stage}>
        <p class="bk-col__head"><span title=${label}>${label}</span><span class="bk-col__n">${list.length}</span></p>
        <ul class="bk-col__cards">
          ${named.map(card)}
          ${unnamed ? html`<li><span class="bk-card is-quiet"><span class="bk-card__body"><span class="bk-card__name">${kept(named.length ? `+${unnamed} more ${unnamed === 1 ? 'family' : 'families'}` : plural(unnamed, 'family', 'families'))}</span><span class="bk-card__reveal is-quiet">Named once their page is up</span></span></span></li>` : null}
          ${orgs ? html`<li><span class="bk-card is-quiet"><span class="bk-card__body"><span class="bk-card__name">${kept(plural(orgs, 'community project'))}</span><span class="bk-card__reveal is-quiet">Not on Community yet</span></span></span></li>` : null}
          ${list.length ? null : html`<li class="bk-col__none">None now</li>`}
        </ul>
      </div>`;
    })}
  </div>`;
}

/**
 * The makeovers' slide fitted to its cards, measured as it's drawn (QA round 6): each family's name at its row's size
 * and never wider than its card (its widest word measured whole at that size; a word wider than the card sets the name
 * that much smaller, so "Montgomery" never runs past it), drawn whole when it fits its lines (data-whole: the clamp's
 * edge never cuts a y's tail), and each reveal tag the most of it its card has room for, on any number of rows ("Reveal
 * Nov 26 · 6 PM", else "Nov 26 · 6 PM", else "Nov 26": its wordings, longest first, in data-forms). Every measurement
 * is read before anything is written, so the slide costs the same two or three layouts however many families there
 * are, never one a name (a phone's slide of 14 froze doing that)
 */
export function fitPipe(root) {
  if (!root?.isConnected) return;
  const names = [...root.querySelectorAll('.bs-pipe__namebox > .bs-pipe__name')];
  const tags = [...root.querySelectorAll('.bs-pipe__photo > .bs-pipe__when[data-forms]')];
  const formsOf = (t) => t.dataset.forms.split('\n');
  // Everything at its full size: each name as wide as its widest word, each tag's every wording beside it, unseen
  root.setAttribute('data-measure', '');
  for (const el of names) { el.style.removeProperty('--nf'); el.removeAttribute('data-whole'); }
  const clone = (t, cls, words) => {
    const p = t.cloneNode(false);
    p.removeAttribute('data-forms');
    p.classList.add(cls);
    p.setAttribute('aria-hidden', 'true');
    p.textContent = words;
    t.after(p);
    return p;
  };
  const probes = tags.map((t) => formsOf(t).map((f) => clone(t, 'is-probe', f)));
  // Each tag's room as its CSS limits it: the tag itself as wide as it's let be (is-room: its max-width, from the same
  // box, to the fraction of a pixel; never whole pixels measured another way, which once chose a wording a pixel too
  // long and cut it with "…")
  const rooms = tags.map((t) => clone(t, 'is-room', ''));
  // (read, all of it at once)
  const wide = names.map((el) => [el.parentElement.clientWidth, el.getBoundingClientRect().width]);
  const room = tags.map((t, i) => [rooms[i].getBoundingClientRect().width, probes[i].map((p) => p.getBoundingClientRect().width)]);
  // (then written, all of it at once)
  root.removeAttribute('data-measure');
  for (const p of [...probes.flat(), ...rooms]) p.remove();
  const scale = names.map((el, i) => { const [box, word] = wide[i]; return word > box + 0.5 && word > 0 ? Math.floor((box / word) * 995) / 1000 : 1; });
  names.forEach((el, i) => { if (scale[i] < 1) el.style.setProperty('--nf', String(scale[i])); });
  tags.forEach((t, i) => {
    const forms = formsOf(t);
    // (the longest that truly fits: no more than its room, give or take a float's last digit)
    const k = room[i][1].findIndex((w) => w <= room[i][0] + 0.001);
    const f = forms[k < 0 ? forms.length - 1 : k];
    if (t.firstChild?.nodeType === 3 && t.childNodes.length === 1) { if (t.firstChild.data !== f) t.firstChild.data = f; } else t.textContent = f;
  });
  // Drawn: a name still a hair wider than its card (a browser's own rounding) a little smaller again; whole where it
  // fits its lines
  const lines = () => names.map((el) => [el.scrollWidth - el.clientWidth, el.clientWidth, el.scrollHeight < el.clientHeight + parseFloat(getComputedStyle(el).lineHeight) / 2]);
  let now = lines();
  if (now.some(([over]) => over > 0.5)) {
    names.forEach((el, i) => { const [over, w] = now[i]; if (over > 0.5 && w > 0) el.style.setProperty('--nf', String(Math.floor(scale[i] * (w / (w + over)) * 990) / 1000)); });
    now = lines();
  }
  names.forEach((el, i) => el.toggleAttribute('data-whole', now[i][2]));
}

/**
 * `fit(el)` run on the element the ref is given once it's drawn, then only on a real change: `deps` (new families, a
 * new size of screen for the slide's columns), the stage's size (the window, full screen) and the fonts coming in;
 * never on a render that changed nothing (the screen draws itself every second and a half, following the meeting)
 */
export function useFitted(fit, deps) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const stage = el.closest('.bs-stage') || el.parentElement;
    const size = () => `${innerWidth}x${innerHeight} ${stage.clientWidth}x${stage.clientHeight}`;
    let was = '';
    const run = () => { if (!el.isConnected) return; was = size(); fit(el); };
    run();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (size() !== was) run(); }) : null;
    ro?.observe(stage);
    let live = true;
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (live) run(); });
    return () => { live = false; ro?.disconnect(); };
  }, deps);
  return ref;
}

/**
 * The makeovers on the meeting's screen: the stages as one track left to right toward the reveal, each with how many
 * and its families under it, photo first and as big as the screen allows. Every card fits without scrolling: the
 * more families, the more rows (one, two or three), and a stage with none is a sliver of the track, not a column.
 * Past what fits at a size the room can read, each stage shows its soonest reveals and "+N more"
 */
export function Pipeline({ projects, reveals = [] }) {
  const vw = typeof innerWidth === 'number' ? innerWidth : 1600;
  const vh = typeof innerHeight === 'number' ? innerHeight : 900;
  // (its names and tags measured once it's drawn, and again only when the families or the screen's size change)
  const ref = useFitted(fitPipe, [JSON.stringify([projects, reveals]), vw, vh]);
  if (!projects) return html`<p class="bs-quiet">The makeovers from JobTread aren’t available right now.</p>`;
  const revealOf = (b) => (b.slug ? reveals.find((r) => r.slug === b.slug) : null);
  // In each stage the soonest reveal first (a set day, then the part of the month), so a full stage shows who's next
  const soon = (b) => { const r = revealOf(b); return r?.confirmed && r.date ? r.date : windowStartOf(r?.window) || '9999'; };
  const all = columnsOf(projects).map((c) => {
    const named = c.list.filter((b) => b.name).sort((a, b) => soon(a).localeCompare(soon(b)));
    const families = c.list.filter((b) => !b.name && b.kind !== 'community').length;
    const orgs = c.list.filter((b) => !b.name && b.kind === 'community').length;
    return { ...c, named, families, orgs, cards: named.length + (families ? 1 : 0) + (orgs ? 1 : 0) };
  });
  const total = all.reduce((n, c) => n + c.cards, 0);
  if (!total) return html`<p class="bs-quiet bs-pipe__none">No makeovers in progress right now.</p>`;
  // Every stage's name fits its own column, so no two names ever run together: a stage with nobody in it is a sliver
  // as wide as its name at least ("Mobilization" is wider than a sliver), and one with families gives its name that
  // much across its columns
  const named = all.map((c) => stageNameWidth(c.label));
  const sliverOf = (i) => u2(Math.max(SLIVER, named[i]));
  const shareOf = (i, across) => u2(Math.max(0, (named[i] - GAP * (across - 1)) / across));
  // How many cards fit across: each at least CARD_MIN of the screen's units wide (a "Date to come" tag and a name at
  // its full size), in the slide's width (an item is at most 98 units, inside the stage's 3.8 each side) less the empty
  // stages' slivers and the reveal's end. A phone stacks the stages, so only the old limit of ten across holds there
  const unit = Math.min(vh * 0.0148, vw * 0.0083);
  const slivers = all.reduce((t, c, i) => t + (c.cards ? 0 : sliverOf(i) + GAP), 0);
  const fits = vw <= 900 ? 10 : Math.max(1, Math.floor((Math.min(98, vw / unit - 7.6) - 7 - slivers) / (CARD_MIN + GAP)));
  // One row, two or three as the families need; when even three won't hold them all, two (a photo in three rows is a
  // sliver) and each stage's soonest
  const need = (r) => all.reduce((t, c) => t + (c.cards ? Math.ceil(c.cards / r) : 0), 0);
  const rows = total <= 6 && need(1) <= fits ? 1 : total <= 14 && need(2) <= fits ? 2 : need(3) <= fits ? 3 : 2;
  // Each stage the columns its cards need; when that's more than fit, a column each and the rest one at a time to the
  // stage with the most families still out of view (the later stage on a tie: it's nearer its reveal)
  const width = all.map((c) => (c.cards ? Math.ceil(c.cards / rows) : 0));
  if (need(rows) > fits) {
    width.forEach((w, i) => { width[i] = Math.min(w, 1); });
    for (let left = fits - width.reduce((a, b) => a + b, 0); left > 0; left--) {
      let k = -1;
      all.forEach((c, i) => { if (c.cards > width[i] * rows && (k < 0 || c.cards - width[i] * rows >= all[k].cards - width[k] * rows)) k = i; });
      if (k < 0) break;
      width[k]++;
    }
  }
  // A stage with more families than its cards: its soonest, and "+N more" in the last card
  const cols = all.map((c, i) => {
    const room = width[i] * rows;
    if (!c.cards || c.cards <= room) return { ...c, over: 0, across: Math.max(1, width[i]) };
    return { ...c, named: c.named.slice(0, room - 1), families: 0, orgs: 0, over: c.list.length - (room - 1), cards: room, across: width[i] };
  });
  // One column a card across every stage (each stage spans its own), so every card is the same width; a stage with none
  // a sliver, never narrower than its name; the reveal the line's end, a column of its own past the last stage's cards
  const template = [...cols.map((c, i) => (c.cards ? Array(c.across).fill(`minmax(calc(var(--bs-u) * ${shareOf(i, c.across)}), 1fr)`).join(' ') : `minmax(calc(var(--bs-u) * ${sliverOf(i)}), 0.45fr)`)), 'minmax(calc(var(--bs-u) * 7), 0.4fr)'].join(' ');
  // (the slide no wider than its columns want: a sliver its share, or its name's when that's wider)
  const units = cols.reduce((t, c, i) => t + (c.cards ? c.across : Math.max(0.45, sliverOf(i) / 23)), 0.4);
  // How wide each card is, in the screen's units, as the grid shares the slide out (the columns above, and the gaps)
  const tracks = [...cols.flatMap((c, i) => (c.cards ? Array(c.across).fill([shareOf(i, c.across), 1]) : [[sliverOf(i), 0.45]])), [7, 0.4]];
  const cardWide = shareOut(tracks, Math.min(98, vw / unit - 7.6, units * 23) - GAP * (tracks.length - 1));
  // The reveal's tag: as much of it as its card has room for, on one row of cards, two or three ("Reveal mid November",
  // else "Mid November", else "Mid Nov"; "Reveal Nov 6 · 1 PM", "Nov 6 · 1 PM", "Nov 6"), so a tag is said shorter, never
  // cut short and never shorter than it need be (QA round 6: two rows always had the shortest). Said here as the card's
  // width works out, and measured once it's drawn (fitPipe: its wordings in data-forms). Three rows set it a little
  // smaller; a phone's cards are two across a stage of their own, its tags in rem (portal.css)
  const tagSize = rows === 3 ? 1.15 : 1.2;
  const phoneCard = (vw - 3 * 16) / 2;
  const said = (...forms) => forms.find((f, i) => i === forms.length - 1 || (vw <= 900 ? tagWidth(f, 12.48) <= phoneCard - 9.6 * 1.68 : tagWidth(f, tagSize) <= cardWide - 1.68));
  const tag = (cls, ...forms) => html`<span class=${cls} data-forms=${forms.join('\n')}>${said(...forms)}</span>`;
  const monthOf = (w) => (/^\d{4}-\d{2}$/.test(String(w?.month || '')) ? new Date(`${w.month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : '');
  const when = (b) => {
    if (b.kind === 'community') return tag('bs-pipe__when is-quiet', 'Community project', 'Community');
    const r = revealOf(b);
    // (the day alone on a small card: the reveals slide has its time)
    if (r?.confirmed && r.date) {
      const date = shortDate(r.date).replace(/, \d{4}$/, '');
      const time = r.time ? ` · ${kept(clock(r.time).replace(':00', ''))}` : '';
      return tag('bs-pipe__when is-set', `Reveal ${date}${time}`, `${date}${time}`, date);
    }
    if (r?.window?.label) {
      const label = String(r.window.label);
      const part = r.window.part && monthOf(r.window) ? `${r.window.part.charAt(0).toUpperCase()}${r.window.part.slice(1)} ${monthOf(r.window)}` : label;
      return tag('bs-pipe__when', `Reveal ${label}`, `${label.charAt(0).toUpperCase()}${label.slice(1)}`, part);
    }
    return b.status === AWAITING ? null : tag('bs-pipe__when is-quiet', 'Reveal date to come', 'Date to come');
  };
  // Each photo cut to its card's shape around the face: tall on one row, wider on two or three
  const crop = rows === 1 ? 'w=640,h=760' : rows === 2 ? 'w=640,h=520' : 'w=640,h=380';
  // The reveal on the photo's corner, the name under it in a box of its own, measured against (fitPipe): no box here is a
  // container a name or a card is sized by (a phone's nested ones made each of its layouts take seconds: QA round 6)
  const card = (b) => html`<li class="bs-pipe__card" key=${b.slug || b.name}>
    <span class="bs-pipe__photo">${b.photo
      ? html`<img src=${sized(b.photo, `${crop},fit=cover,gravity=face`)} alt="" decoding="async" />`
      : html`<span class="bs-pipe__initials" style=${`--hue:${hueOf(b.name)}`} aria-hidden="true">${initialsOf(b.name)}</span>`}${when(b)}</span>
    <span class="bs-pipe__namebox"><span class="bs-pipe__name">${b.name}</span></span>
  </li>`;
  const quiet = (words, sub) => html`<li class="bs-pipe__card is-quiet"><span class="bs-pipe__name">${words}</span><span class="bs-pipe__when is-quiet">${sub}</span></li>`;
  return html`<div class="bs-pipe" data-rows=${rows} style=${`--tmpl:${template};--rows:${rows};--units:${units}`} ref=${ref}>
    <ol class="bs-pipe__track" aria-label="The makeovers by stage">${cols.map((c) => html`<li class=${c.cards ? '' : 'is-empty'} style=${`--across:${c.cards ? c.across : 1}`} key=${c.stage}>
      <span class="bs-pipe__n">${c.list.length}</span><span class="bs-pipe__stage">${c.label}</span>
    </li>`)}<li class="is-end"><span class="bs-pipe__end">Reveal</span></li></ol>
    <div class="bs-pipe__cols">${cols.map((c) => html`<div class=${`bs-pipe__col ${c.cards ? '' : 'is-empty'}`} style=${`--across:${c.cards ? c.across : 1}`} key=${c.stage}>
      <p class="bs-pipe__colhead"><span>${c.label}</span><span class="bs-pipe__n">${c.list.length}</span></p>
      <ul>
        ${c.named.map(card)}
        ${c.families ? quiet(c.named.length ? `+${c.families} more ${c.families === 1 ? 'family' : 'families'}` : plural(c.families, 'family', 'families'), 'Named once their page is up') : null}
        ${c.orgs ? quiet(plural(c.orgs, 'community project'), 'Not on Community yet') : null}
        ${c.over > 0 ? quiet(`+${c.over} more`, 'in this stage') : null}
      </ul>
    </div>`)}<div class="bs-pipe__col is-end" aria-hidden="true"></div></div>
  </div>`;
}
