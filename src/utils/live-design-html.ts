/**
 * live-design-html.ts — "The design" section's cards, as markup
 * ==============================================================
 * The live page's design section (LiveDesign.astro) is drawn from this one
 * function in both places: functions/live/[[path]].js writes it into the page
 * before it goes out, so the room's design is there from the first paint and
 * nothing under the hero moves when it arrives; live-design.ts writes the same
 * (or keeps the server's, when the pictures are the same) and then wires it
 * up: the viewer, the pictures at the size each card shows, a picture that
 * can't load leaving. The cards go out empty, each already its picture's
 * shape when that's known (a photo is always 4:3), so the pictures fill them
 * in place. Plain functions, nothing of the browser's.
 */
import { compareRatio, isWholeSheet, knownRatio, planPairOf, type DesignSlide, type PlanPair } from './reveal-design-client';

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
// The rest of /live/ writes names with a straight apostrophe ("Don't miss Dylan's reveal")
export const straight = (s: string) => String(s ?? '').replace(/’/g, "'");
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

export const PLANS_NOTE = 'Before and after, from above';
/** Under the plan's compare: what to do with it */
export const COMPARE_NOTE = 'Drag the line to see what changes';
export type PartKey = 'photos' | 'plans' | 'boards';
export interface DesignPart { key: PartKey; slides: DesignSlide[] }

/** The section's parts, in order, each with its slides (a part with none is left out) */
export function designPartsOf(slides: DesignSlide[]): DesignPart[] {
  const parts: DesignPart[] = [
    { key: 'photos', slides: slides.filter((x) => x.kind === 'before') },
    { key: 'plans', slides: slides.filter((x) => x.kind === 'as-built' || x.kind === 'proposed') },
    { key: 'boards', slides: slides.filter((x) => x.kind === 'board') },
  ];
  return parts.filter((p) => p.slides.length);
}

/** The heading's name ("Dylan's", or "The" without one) */
export const designName = (name: string) => (name ? possessive(straight(name)) : 'The');

/** The line under the heading, as it is now: "looks today" until the reveal starts, then "looked" (Peter, Nov 16 2026) */
export function designLead(slides: DesignSlide[], isAfter: boolean): string {
  const room = isAfter ? 'How the room looked' : 'How the room looks today';
  const hasBefores = slides.some((x) => x.kind === 'before');
  const hasPlans = slides.some((x) => x.kind === 'as-built' || x.kind === 'proposed');
  const said = hasBefores && hasPlans ? `${room} and the plan the designers drew.` : hasBefores ? `${room}.` : hasPlans ? 'The plan the designers drew.' : '';
  return `${said}${said ? ' ' : ''}Watch the reveal to see it finished.`;
}

/** A part's title, its grid's classes and its note, for the slides still in it */
export function partTitle(key: PartKey, isAfter: boolean): string {
  return key === 'photos' ? (isAfter ? 'The room before' : 'The room today') : key === 'plans' ? 'The plan' : 'The look';
}
export function gridClass(key: PartKey, left: DesignSlide[]): string {
  if (key === 'photos') return 'ldz-grid ldz-grid--photos';
  if (key === 'plans') return `ldz-grid ${left.length === 1 ? 'ldz-grid--one' : 'ldz-grid--plans'}`;
  return `ldz-grid ldz-boards ${left.length === 1 ? 'ldz-grid--one' : 'ldz-grid--boards'}`;
}
export function partNote(key: PartKey, left: DesignSlide[]): string {
  return key === 'plans' && left.some((y) => y.kind === 'as-built') && left.some((y) => y.kind === 'proposed') ? PLANS_NOTE : '';
}

/** A card's words: what the viewer button says, and the caption under a drawing or a board */
export function cardLabel(s: DesignSlide, key: PartKey, at: number, of: number): string {
  return key === 'photos' ? `photo ${at + 1} of ${of}` : straight(s.caption);
}

/** One card: the picture's button (badge, picture box) and, under a drawing or a board, its caption */
function cardHtml(s: DesignSlide, i: number, key: PartKey, at: number, of: number): string {
  const label = cardLabel(s, key, at, of);
  const cls = `ldz-item${s.kind === 'before' ? '' : ' ldz-paper'}${isWholeSheet(s) ? ' ldz-sheet' : ''}`;
  const badge = s.badge ? `<span class="ldz-badge ldz-badge--${esc(s.kind)}">${esc(s.badge)}</span>` : '';
  const r = s.kind === 'before' ? null : knownRatio(s);
  const shape = r ? ` style="aspect-ratio:1 / ${r.toFixed(4)}"` : '';
  const cap = key === 'photos' ? '' : `<p class="ldz-cap">${esc(straight(s.caption))}</p>`;
  return `<li data-i="${i}"><button class="${cls}" type="button" aria-label="${esc(`Enlarge: ${s.badge ? `${s.badge}, ` : ''}${label}`)}">${badge}<span class="ldz-pic"${shape}><img alt="${esc(straight(s.alt))}" decoding="async" loading="lazy"></span></button>${cap}</li>`;
}

const ARROWS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>';
const ENLARGE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';

/**
 * The plan before and after on one picture (plan-compare.ts lines them up and fills it in; compare-slider.ts moves the
 * line). The same markup in the design section, the room beside the video and the viewer, so each looks and works the
 * same. It's its final shape from the start (compareRatio), so nothing moves when the pictures come. `enlarge`: a
 * button in its corner that opens it big (where a tap on it isn't already that)
 */
export function compareHtml(pair: PlanPair, enlarge = false, extraClass = ''): string {
  const r = compareRatio(pair);
  const alt = (s: DesignSlide, word: string) => esc(straight(s.alt || `${word} floor plan`));
  return `<div class="pcmp${extraClass ? ` ${extraClass}` : ''}" data-pcmp style="--pcmp-r:${r.toFixed(4)}">`
    + '<div class="pcmp__pics" data-pcmp="pics">'
    + `<img class="pcmp__img pcmp__img--after" data-pcmp="after" alt="${alt(pair.proposed, 'The new')}" draggable="false" decoding="async">`
    + `<img class="pcmp__img pcmp__img--before" data-pcmp="before" alt="${alt(pair.existing, "Today's")}" draggable="false" decoding="async">`
    + '</div>'
    + '<input class="pcmp__range" data-pcmp="range" type="range" min="0" max="100" step="1" value="50" aria-label="Compare the floor plan before and after: left shows it today, right the new plan">'
    + `<div class="pcmp__line" aria-hidden="true"><span class="pcmp__knob">${ARROWS}</span></div>`
    + `<span class="pcmp__tag pcmp__tag--before" data-pcmp="tag-before" aria-hidden="true">${esc(pair.existing.badge || 'Existing')}</span>`
    + `<span class="pcmp__tag pcmp__tag--after" data-pcmp="tag-after" aria-hidden="true">${esc(pair.proposed.badge || 'Proposed')}</span>`
    + (enlarge ? `<button class="pcmp__enlarge" type="button" data-pcmp="enlarge" aria-label="See the plans big">${ENLARGE}</button>` : '')
    + '</div>';
}

/** The section's parts as markup: each card carries its slide's place in `slides` (data-i) for the page script */
export function designPartsHtml(slides: DesignSlide[], isAfter: boolean): string {
  return designPartsOf(slides).map(({ key, slides: list }) => {
    const pair = key === 'plans' ? planPairOf(list) : null;
    const note = pair ? COMPARE_NOTE : partNote(key, list);
    const n = key === 'photos' ? ` data-n="${list.length}"` : '';
    const cards = list.map((s, at) => cardHtml(s, slides.indexOf(s), key, at, list.length)).join('');
    const head = `<div class="ldz-part__head"><h3 class="ldz-part__title">${esc(partTitle(key, isAfter))}</h3><p class="ldz-part__note"${note ? '' : ' hidden'}>${esc(note)}</p></div>`;
    // The plan: the two drawings on one picture to compare first, then the designer's two sheets as they drew them
    // (border, title block and all: the official plan set, Peter, Nov 16 2026)
    const compare = pair
      ? `<div class="ldz-compare" data-ldz-compare="${slides.indexOf(pair.existing)},${slides.indexOf(pair.proposed)}">${compareHtml(pair, true)}</div><p class="ldz-sheets">The designer's sheets</p>`
      : '';
    return `<div class="ldz-part" data-part="${key}">${head}${compare}<ul class="${gridClass(key, list)}${pair ? ' ldz-grid--sheets' : ''}"${n}>${cards}</ul></div>`;
  }).join('');
}
