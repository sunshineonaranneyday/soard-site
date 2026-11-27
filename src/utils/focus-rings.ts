/**
 * focus-rings.ts — the focus ring is for people moving around with the keyboard
 * =============================================================================
 * The site draws its ring with :focus-visible, so a click or a tap never shows one. Chrome (and Firefox) also turn the
 * ring on for whatever was last clicked as soon as any key is pressed: an arrow, Page Down or Space to scroll, Shift,
 * Escape. And when Escape closes a photo viewer, a menu or a calendar list, the focus goes back to the photo or button
 * that opened it with a ring round it, because the last thing pressed was a key. Peter, Nov 26 2026: "there seems to
 * be left over hover rings on a bunch of stuff ... i hate it!" (a gala photo after its viewer closed, the header's
 * About Us after its menu closed, Add to calendar).
 *
 * The rule here: rings follow the Tab key. Once someone has clicked or tapped, the keys they press to scroll, to close
 * something or to press what they clicked again (Space) don't ring it, and Escape hands the focus back to the opener
 * without one. Tab (or
 * Shift+Tab) brings rings back at once, and focus that arrow keys move along a menu or a row of choices keeps its
 * ring, so a keyboard user always sees where they are. Text fields keep theirs too: it shows where the typing goes.
 *
 * How: the browser's own "show a ring" flag is turned off by focusing the element again with focusVisible: false
 * (Chrome, Firefox and Safari 18.4+; elsewhere the browser decides as before), so every ring style on the site, and
 * every :has(:focus-visible), follows without a change of its own.
 *
 * Loaded once by BaseLayout (src/components/global/FocusRings.astro). Listens on the window and the document, which the
 * site's in-page moves (Astro's ClientRouter) keep, so it works on every page a tab shows.
 */

/** How the person last moved: a click or tap, the Tab key, or nothing yet (the browser decides) */
let way: 'pointer' | 'keys' | '' = '';
/** When someone who clicks pressed Escape (a close): focus that lands soon after goes back without a ring */
let escapedAt = -Infinity;
const ESCAPE_WINDOW = 2000;

const TEXT_TYPES = /^(text|search|email|url|tel|password|number|date|datetime-local|month|week|time)$/;
/** Where typing goes: its ring stays */
const takesText = (el: HTMLElement) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.test(el.type)) || el.isContentEditable;
/** What a key opens a list or a picker from (a select, a colour or a file input): focusing it again would close it */
const opensPicker = (el: HTMLElement) => el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && /^(color|file)$/.test(el.type));
/** What Space presses, on its key up, which focusing it again in between would cancel. On a link Space scrolls the page */
const pressedBySpace = (el: HTMLElement) =>
  el.matches('button, summary, input:is([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="image"]), [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]');

/** Focus el again without its ring, if it still has the focus and shows one */
function settle(el: Element | null): void {
  if (!(el instanceof HTMLElement) || el === document.body || document.activeElement !== el) return;
  // (a heading or a section the page moved focus to has no ring of its own to lose; a text field keeps its ring)
  if (el.tabIndex < 0 || takesText(el) || !el.matches(':focus-visible')) return;
  el.blur();
  el.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
}

export function startFocusRings(): void {
  if ((window as { __focusRings?: boolean }).__focusRings) return;
  (window as { __focusRings?: boolean }).__focusRings = true;

  addEventListener('pointerdown', () => { way = 'pointer'; escapedAt = -Infinity; }, true);

  addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { way = 'keys'; escapedAt = -Infinity; return; }
    if (way !== 'pointer') return;
    if (e.key === 'Escape') escapedAt = performance.now();
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || opensPicker(el) || (e.key === ' ' && pressedBySpace(el))) return;
    // After the key has done its work (a scroll, a step of a slider), before the next frame is drawn: no flash of a ring
    requestAnimationFrame(() => settle(el));
  }, true);
  // Space has pressed what it's on (a button, a question that opens, a checkbox) when it comes back up: its ring goes then
  addEventListener('keyup', (e) => {
    if (way !== 'pointer' || e.key !== ' ') return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && !opensPicker(el)) requestAnimationFrame(() => settle(el));
  }, true);

  // Escape closed something (a photo viewer, a menu, a dialog): the focus it hands back to what opened it comes in here,
  // by the page's script or by the browser itself (a <dialog>)
  document.addEventListener('focusin', (e) => {
    if (way !== 'pointer' || performance.now() - escapedAt > ESCAPE_WINDOW) return;
    const el = e.target as Element | null;
    queueMicrotask(() => settle(el));
  }, true);
}
