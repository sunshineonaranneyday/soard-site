/**
 * The site's bot trap: one hidden box on every public form. People never see it or reach it, so they leave it empty;
 * a bot fills in every box it finds, and its send is answered like a person's and dropped.
 *
 * Built so a real person is never caught by it (Peter, Nov 16 2026: "make it best in class"):
 *   - its name and label match nothing a browser's autofill or a password manager fills ("website", "url", "company",
 *     "name", "email" all do: a box called "website" can be filled from a saved identity, and the person dropped)
 *   - and it carries each password manager's own "leave this alone" flag (1Password, LastPass, Bitwarden, Dashlane)
 *   - it's out of sight off the page, never display:none (some bots skip a box that isn't laid out), hidden from
 *     screen readers, and out of the Tab order
 *   - one place for all of it: src/components/global/BotTrap.astro on each page's form, trapHtml() in a form the
 *     server writes itself, trapValue() for a page's script, trapFilled() for a form posted straight to the server
 *     (which also takes the old names, so a page loaded before this changed is still read right)
 * Shared by the pages and the server (no imports).
 */

export const TRAP_NAME = 'leave-this-empty';
// (the names the trap had before: a page still open from then sends one of these)
const OLD_NAMES = ['website', 'website2'];

/** The box's own attributes (BotTrap.astro and trapHtml write the same) */
export const TRAP_INPUT_ATTRS = {
  type: 'text', name: TRAP_NAME, 'data-bot-trap': '', tabindex: '-1', autocomplete: 'off',
  'data-1p-ignore': '', 'data-lpignore': 'true', 'data-bwignore': '', 'data-form-type': 'other',
};
/** Out of sight and out of reach, but laid out (a bot that skips hidden boxes still finds it) */
export const TRAP_STYLE = 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden';

/** The trap as HTML, for a form the server writes itself */
export function trapHtml() {
  const attrs = Object.entries(TRAP_INPUT_ATTRS).map(([k, v]) => (v === '' ? k : `${k}="${v}"`)).join(' ');
  return `<div style="${TRAP_STYLE}" aria-hidden="true"><label>Leave this empty <input ${attrs}></label></div>`;
}

/** In a page's script: what's in the form's trap ('' from people) */
export function trapValue(root) {
  const el = root?.querySelector?.('[data-bot-trap]');
  return String(el?.value || '').trim();
}

/**
 * On the server, for a form sent as it is (posted FormData, or its boxes as an object): whether the trap, or a box of
 * one of its old names, was filled
 */
export function trapFilled(form) {
  const get = (n) => (typeof form?.get === 'function' ? form.get(n) : form?.[n]);
  return [TRAP_NAME, ...OLD_NAMES].some((n) => typeof get(n) === 'string' && get(n).trim() !== '');
}
